"""Durable, owner-scoped conversations with idempotent message delivery."""

import asyncio
import json
from datetime import datetime, timezone
from uuid import UUID, uuid4
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import Field

from app.ai.agent import respond
from app.ai.service import AIServiceError
from app.db import connection, now, task_from_row
from app.routes.auth import error, require_business
from app.routes.me import owned_task
from app.routes.research import agent_evidence
from app.schemas import Card, InputModel
from app import usage

router = APIRouter(prefix='/api/me/agent')


class StartInput(InputModel):
    request_id: UUID


class MessageInput(StartInput):
    locale: Literal['ru', 'en'] = 'ru'
    text: str = Field(min_length=1, max_length=6000)
    revision: int = Field(ge=0, strict=True)


def expire_runs(db, task_id):
    for row in db.execute("SELECT * FROM agent_runs WHERE task_id=? AND status='pending'", (task_id,)).fetchall():
        if (datetime.now(timezone.utc) - datetime.fromisoformat(row['started_at'])).total_seconds() > 90:
            usage.finish(db, row['attempt'], False)
            db.execute("UPDATE agent_runs SET status='failed',error=? WHERE task_id=? AND request_id=?",
                       ('Запрос прерван. Сообщение сохранено; можно повторить.', task_id, row['request_id']))


def snapshot(db, task_id, user_id):
    task = task_from_row(db, owned_task(db, task_id, user_id))
    messages = [dict(row) for row in db.execute(
        'SELECT id,role,text,created_at FROM agent_messages WHERE task_id=? ORDER BY id', (task_id,))]
    run = db.execute('SELECT request_id,status,error FROM agent_runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1', (task_id,)).fetchone()
    return {'task': task, 'messages': messages, 'run': dict(run) if run else None}


@router.post('')
def start(request: Request, payload: StartInput):
    user = require_business(request, mutate=True)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        existing = db.execute('SELECT task_id FROM agent_sessions WHERE owner_user_id=? AND request_id=?',
                              (user['id'], str(payload.request_id))).fetchone()
        if existing:
            return snapshot(db, existing['task_id'], user['id'])
        cursor = db.execute("INSERT INTO tasks(topic,card,confirmed_fields,status,created_at,owner_user_id) VALUES(?,?,'[]','draft',?,?)",
                            ('Без темы', Card().model_dump_json(), now(), user['id']))
        task_id = cursor.lastrowid
        db.execute('INSERT INTO agent_sessions VALUES(?,?,?)', (user['id'], str(payload.request_id), task_id))
        return snapshot(db, task_id, user['id'])


@router.get('/{task_id}')
def get_conversation(request: Request, task_id: int):
    user = require_business(request)
    with connection() as db:
        owned_task(db, task_id, user['id'])
        expire_runs(db, task_id)
        return snapshot(db, task_id, user['id'])


@router.post('/{task_id}/messages')
async def send(request: Request, task_id: int, payload: MessageInput):
    user = require_business(request, mutate=True)
    request_id, attempt = str(payload.request_id), str(uuid4())
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        task_row = owned_task(db, task_id, user['id'])
        expire_runs(db, task_id)
        old = db.execute('SELECT * FROM agent_runs WHERE task_id=? AND request_id=?', (task_id, request_id)).fetchone()
        if old:
            previous = db.execute("SELECT text FROM agent_messages WHERE task_id=? AND request_id=? AND role='user'", (task_id, request_id)).fetchone()
            if previous['text'] != payload.text:
                error(409, 'CONFLICT', 'ID сообщения уже использован с другим текстом.')
            if old['status'] in ('completed', 'pending'):
                return snapshot(db, task_id, user['id'])
            latest = db.execute('SELECT request_id FROM agent_runs WHERE task_id=? ORDER BY rowid DESC LIMIT 1', (task_id,)).fetchone()
            if latest['request_id'] != request_id:
                error(409, 'CONFLICT', 'Этот запрос устарел. Отправьте новое сообщение.')
        if db.execute("SELECT 1 FROM agent_runs WHERE task_id=? AND status='pending'", (task_id,)).fetchone():
            error(409, 'CONFLICT', 'Агент уже отвечает на сообщение. Дождитесь ответа.')
        if task_row['revision'] != payload.revision:
            error(409, 'CONFLICT', 'Карточка изменилась. Обновите задачу перед отправкой.')
        usage.reserve(db, user['id'], 'chat', attempt)
        if not old:
            count = db.execute("SELECT COUNT(*) FROM agent_messages WHERE task_id=? AND role='user'", (task_id,)).fetchone()[0]
            if count >= 100:
                error(422, 'VALIDATION_ERROR', 'Достигнут предел 100 сообщений. Карточку можно продолжить вручную.')
            db.execute("INSERT INTO agent_messages(task_id,request_id,role,text,created_at) VALUES(?,?,'user',?,?)",
                       (task_id, request_id, payload.text, now()))
        db.execute("INSERT INTO agent_runs VALUES(?,?,'pending',?,?,'') ON CONFLICT(task_id,request_id) DO UPDATE SET status='pending',attempt=excluded.attempt,started_at=excluded.started_at,error=''",
                   (task_id, request_id, attempt, now()))
        initial = snapshot(db, task_id, user['id'])
    try:
        with connection() as db:
            evidence = agent_evidence(db, initial['task'])
        localized_task = {**initial['task'], 'locale': payload.locale, 'research_context': evidence}
        answer = await asyncio.wait_for(respond(localized_task, initial['messages']), timeout=45)
        with connection() as db:
            db.execute('BEGIN IMMEDIATE')
            current = owned_task(db, task_id, user['id'])
            run = db.execute('SELECT * FROM agent_runs WHERE task_id=? AND request_id=?', (task_id, request_id)).fetchone()
            if run['attempt'] != attempt or run['status'] != 'pending':
                return snapshot(db, task_id, user['id'])
            if current['revision'] != payload.revision:
                raise AIServiceError('CONFLICT', 'Карточка изменилась во время ответа. Ваши правки сохранены. Повторите запрос для новой версии.')
            if not usage.finish(db, attempt, True):
                raise AIServiceError('AI_TIMEOUT', 'Запрос устарел. Повторите сообщение.')
            card = json.loads(current['card'])
            updates = answer['updates'] if current['status'] == 'draft' else {}
            changed = {key for key, value in updates.items() if card.get(key) != value}
            card.update(updates)
            confirmed = [key for key in json.loads(current['confirmed_fields']) if key not in changed]
            db.execute('UPDATE tasks SET card=?,confirmed_fields=?,revision=revision+1 WHERE id=?',
                       (Card(**card).model_dump_json(), json.dumps(confirmed), task_id))
            db.execute("INSERT INTO agent_messages(task_id,request_id,role,text,created_at) VALUES(?,?,'assistant',?,?)",
                       (task_id, request_id, answer['text'], now()))
            db.execute("UPDATE agent_runs SET status='completed' WHERE task_id=? AND request_id=?", (task_id, request_id))
    except Exception as exc:
        reason = exc.message if isinstance(exc, AIServiceError) else 'AI временно недоступен. Сообщение сохранено; попробуйте ещё раз.'
        if isinstance(exc, (TimeoutError, asyncio.TimeoutError)):
            reason = 'AI не ответил вовремя. Сообщение сохранено; попробуйте ещё раз.'
        with connection() as db:
            usage.finish(db, attempt, False)
            db.execute("UPDATE agent_runs SET status='failed',error=? WHERE task_id=? AND request_id=? AND attempt=? AND status='pending'",
                       (reason, task_id, request_id, attempt))
    with connection() as db:
        return snapshot(db, task_id, user['id'])
