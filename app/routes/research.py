"""Private, rate-limited research and an explicit saved evidence board."""
import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Request
from pydantic import ConfigDict, Field

from app.ai.research import analyze
from app.ai.service import AIServiceError
from app.db import connection, now, task_from_row
from app.routes.auth import error, require_business
from app.routes.me import owned_task
from app.schemas import InputModel

router = APIRouter(prefix='/api/me/tasks')


class ResearchInput(InputModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    query: str = Field(min_length=10, max_length=500)
    locale: Literal['ru', 'en'] = 'ru'
    expected_revision: int = Field(ge=0, strict=True)
    refresh: bool = False


class EvidenceInput(InputModel):
    model_config = ConfigDict(extra='forbid')
    run_id: str = Field(min_length=1, max_length=40)
    insight_index: int = Field(ge=0, le=2, strict=True)


def digest_task(task):
    content = {'topic': task['topic'], 'card': {k: v for k, v in task['card'].items() if k != 'contact'}}
    return hashlib.sha256(json.dumps(content, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def business_data(db, task):
    data = {'card:'+key: {'text': value, 'confirmed': key in task['confirmed_fields']}
            for key, value in task['card'].items() if value and key != 'contact'}
    rows = db.execute("SELECT id,text FROM agent_messages WHERE task_id=? AND role='user' ORDER BY id DESC LIMIT 12", (task['id'],)).fetchall()
    for row in reversed(rows):
        data['message:'+str(row['id'])] = {'text': row['text'][:2000], 'confirmed': False}
    return data


def expire(db, user_id):
    cutoff = (datetime.now(timezone.utc)-timedelta(seconds=150)).isoformat()
    db.execute("UPDATE research_runs SET status='failed',error=? WHERE user_id=? AND status='pending' AND started_at<?",
               ('Поиск прерван. Повторите запрос.', user_id, cutoff))


def saved_items(db, task):
    digest = digest_task(task)
    items = []
    for row in db.execute('''SELECT e.*,r.content,r.digest,r.locale FROM saved_evidence e
                          JOIN research_runs r ON r.id=e.run_id WHERE e.task_id=? ORDER BY e.id DESC''', (task['id'],)):
        report = json.loads(row['content'])
        insight = report['insights'][row['insight_index']]
        passages = [p for p in report['passages'] if p['id'] in insight['evidence_ids']]
        ids = {sid for p in passages for sid in p['source_ids']}
        items.append({**insight, 'id': row['id'], 'run_id': row['run_id'], 'insight_index': row['insight_index'],
                      'created_at': row['created_at'], 'locale': row['locale'], 'stale': row['digest'] != digest,
                      'passages': passages, 'sources': [s for s in report['sources'] if s['id'] in ids],
                      'business_data': {key: report['business_data'][key] for key in insight['business_ids']}})
    return items


def agent_evidence(db, task):
    # Separate non-factual context; never a source ID permitted in card updates.
    return [{key: item[key] for key in ('factor', 'hypothesis', 'question', 'limitations', 'locale')}
            for item in saved_items(db, task) if not item['stale']][:6]


def snapshot(db, task, locale):
    last = db.execute('SELECT * FROM research_runs WHERE task_id=? AND locale=? ORDER BY started_at DESC LIMIT 1', (task['id'], locale)).fetchone()
    completed = db.execute("SELECT * FROM research_runs WHERE task_id=? AND locale=? AND status='completed' ORDER BY started_at DESC LIMIT 1", (task['id'], locale)).fetchone()
    report = None
    if completed:
        report = {**json.loads(completed['content']), 'id': completed['id'], 'query': completed['query'],
                  'created_at': completed['completed_at'], 'stale': completed['digest'] != digest_task(task),
                  'expired': (datetime.now(timezone.utc)-datetime.fromisoformat(completed['completed_at'])).total_seconds() > 86400}
    return {'report': report, 'run': {k: last[k] for k in ('id', 'status', 'error', 'query', 'started_at')} if last else None,
            'saved': saved_items(db, task), 'business_data': business_data(db, task), 'revision': task['revision']}


@router.get('/{task_id}/research')
def get_research(request: Request, task_id: int, locale: Literal['ru', 'en'] = 'ru'):
    user = require_business(request)
    with connection() as db:
        task = task_from_row(db, owned_task(db, task_id, user['id']))
        expire(db, user['id'])
        return snapshot(db, task, locale)


@router.post('/{task_id}/research')
async def run_research(request: Request, task_id: int, payload: ResearchInput):
    user = require_business(request, mutate=True)
    run_id = str(uuid4())
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        task = task_from_row(db, owned_task(db, task_id, user['id']))
        if task['revision'] != payload.expected_revision:
            error(409, 'CONFLICT', 'Карточка изменилась. Обновите исследование перед запуском.')
        digest = digest_task(task)
        expire(db, user['id'])
        if db.execute("SELECT 1 FROM research_runs WHERE user_id=? AND status='pending'", (user['id'],)).fetchone():
            error(409, 'CONFLICT', 'Поиск уже выполняется. Дождитесь результата.')
        if not payload.refresh:
            cached = db.execute("""SELECT id FROM research_runs WHERE task_id=? AND locale=? AND query=? AND digest=?
                AND status='completed' AND completed_at>? ORDER BY started_at DESC LIMIT 1""",
                (task_id, payload.locale, payload.query, digest, (datetime.now(timezone.utc)-timedelta(days=1)).isoformat())).fetchone()
            if cached:
                # Return the matched cached report even when another query was run more recently.
                data = snapshot(db, task, payload.locale)
                row = db.execute('SELECT * FROM research_runs WHERE id=?', (cached['id'],)).fetchone()
                data['report'] = {**json.loads(row['content']), 'id': row['id'], 'query': row['query'],
                                  'created_at': row['completed_at'], 'stale': False, 'expired': False}
                data['run'] = {'id': row['id'], 'status': 'completed', 'error': '', 'query': row['query'], 'started_at': row['started_at']}
                return data
        hour = (datetime.now(timezone.utc)-timedelta(hours=1)).isoformat()
        if db.execute('SELECT COUNT(*) FROM research_runs WHERE user_id=? AND started_at>?', (user['id'], hour)).fetchone()[0] >= 6:
            error(429, 'RATE_LIMITED', 'Доступно до 6 поисков в час. Сохранённые результаты остаются доступны.')
        business = business_data(db, task)
        db.execute("INSERT INTO research_runs(id,task_id,user_id,locale,query,digest,status,started_at) VALUES(?,?,?,?,?,?,'pending',?)",
                   (run_id, task_id, user['id'], payload.locale, payload.query, digest, now()))
    try:
        result = await asyncio.wait_for(analyze(payload.query, business, payload.locale), timeout=100)
        with connection() as db:
            db.execute("UPDATE research_runs SET status='completed',content=?,completed_at=? WHERE id=? AND status='pending'",
                       (json.dumps(result, ensure_ascii=False), now(), run_id))
    except Exception as exc:
        code = exc.code if isinstance(exc, AIServiceError) else 'AI_UNAVAILABLE'
        reason = exc.message if isinstance(exc, AIServiceError) else 'Исследование не завершилось. Повторите поиск.'
        if isinstance(exc, asyncio.TimeoutError):
            code, reason = 'AI_TIMEOUT', 'Поиск не завершился вовремя. Повторите запрос.'
        with connection() as db:
            db.execute("UPDATE research_runs SET status='failed',error=? WHERE id=? AND status='pending'", (reason, run_id))
        error({'AI_TIMEOUT': 504, 'AI_INVALID_OUTPUT': 502}.get(code, 503), code, reason)
    with connection() as db:
        return snapshot(db, task_from_row(db, owned_task(db, task_id, user['id'])), payload.locale)


@router.post('/{task_id}/evidence')
def save_evidence(request: Request, task_id: int, payload: EvidenceInput):
    user = require_business(request, mutate=True)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        task = task_from_row(db, owned_task(db, task_id, user['id']))
        run = db.execute("SELECT * FROM research_runs WHERE id=? AND task_id=? AND status='completed'", (payload.run_id, task_id)).fetchone()
        if not run or payload.insight_index >= len(json.loads(run['content'])['insights']):
            error(404, 'NOT_FOUND', 'Вывод не найден')
        existing = db.execute('SELECT id FROM saved_evidence WHERE run_id=? AND insight_index=?', (payload.run_id, payload.insight_index)).fetchone()
        if not existing:
            if db.execute('SELECT COUNT(*) FROM saved_evidence WHERE task_id=?', (task_id,)).fetchone()[0] >= 20:
                error(409, 'CONFLICT', 'На доске уже 20 выводов. Удалите ненужные перед добавлением.')
            db.execute('INSERT INTO saved_evidence(task_id,run_id,insight_index,created_at) VALUES(?,?,?,?)', (task_id,payload.run_id,payload.insight_index,now()))
        return {'saved': saved_items(db, task)}


@router.delete('/{task_id}/evidence/{evidence_id}')
def remove_evidence(request: Request, task_id: int, evidence_id: int):
    user = require_business(request, mutate=True)
    with connection() as db:
        task = task_from_row(db, owned_task(db, task_id, user['id']))
        db.execute('DELETE FROM saved_evidence WHERE id=? AND task_id=?', (evidence_id, task_id))
        return {'saved': saved_items(db, task)}
