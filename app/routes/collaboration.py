"""Task photographs and private business/team conversations. No AI calls."""
import json
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Query, Request, Response
from pydantic import ConfigDict, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

from app.db import connection, now, task_images
from app.routes.auth import current_session, error, require_business, require_csrf
from app.routes.community import published_task, require_team, owned_proposal
from app.routes.me import owned_task
from app.routes.profiles import normalize_photo, profile_for
from app.schemas import InputModel

router = APIRouter(prefix='/api')


class ContactInput(InputModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    phone: str = Field(default='', max_length=40)
    enabled: bool = Field(default=False, strict=True)

    @field_validator('phone')
    @classmethod
    def phone_number(cls, value):
        value = re.sub(r'[\s()+-]', '', value)
        if value and not re.fullmatch(r'[1-9][0-9]{7,14}', value):
            raise ValueError('Use an international phone number')
        return value

    @model_validator(mode='after')
    def enabled_phone(self):
        if self.enabled and not self.phone:
            raise ValueError('Phone is required')
        return self


class MessageInput(InputModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    text: str = Field(min_length=1, max_length=4000)
    request_id: UUID


class ReadInput(InputModel):
    through_id: int = Field(ge=1, strict=True)


@router.post('/me/tasks/{task_id}/images', status_code=201)
async def upload(request: Request, task_id: int):
    user = require_business(request, mutate=True)
    with connection() as db:
        owned_task(db, task_id, user['id'])
    output = await run_in_threadpool(normalize_photo, await request.body(), 1600)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        owned_task(db, task_id, user['id'])
        count = db.execute('SELECT COUNT(*) FROM task_images WHERE task_id=?', (task_id,)).fetchone()[0]
        if count >= 5:
            error(409, 'CONFLICT', 'Можно прикрепить до пяти фотографий')
        db.execute('INSERT INTO task_images VALUES(?,?,?,?,?)', (str(uuid4()), task_id, output, int(count == 0), now()))
        return {'images': task_images(db, task_id)}


@router.api_route('/me/tasks/{task_id}/images/{image_id}', methods=['DELETE', 'PATCH'])
def change_image(request: Request, task_id: int, image_id: UUID):
    user = require_business(request, mutate=True)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        owned_task(db, task_id, user['id'])
        if not db.execute('SELECT 1 FROM task_images WHERE id=? AND task_id=?', (str(image_id), task_id)).fetchone():
            error(404, 'NOT_FOUND', 'Фото не найдено')
        if request.method == 'DELETE':
            db.execute('DELETE FROM task_images WHERE id=?', (str(image_id),))
            remaining = task_images(db, task_id)
            if remaining and not remaining[0]['is_cover']:
                db.execute('UPDATE task_images SET is_cover=1 WHERE id=?', (remaining[0]['id'],))
        else:
            db.execute('UPDATE task_images SET is_cover=(id=?) WHERE task_id=?', (str(image_id), task_id))
        return {'images': task_images(db, task_id)}


@router.get('/task-images/{image_id}')
def photograph(request: Request, image_id: UUID):
    with connection() as db:
        row = db.execute('''SELECT i.content,t.status,t.owner_user_id FROM task_images i
                            JOIN tasks t ON t.id=i.task_id WHERE i.id=?''', (str(image_id),)).fetchone()
        if not row:
            error(404, 'NOT_FOUND', 'Фото не найдено')
        if row['status'] != 'published':
            user, _ = current_session(request)
            if row['owner_user_id'] != user['id']:
                error(404, 'NOT_FOUND', 'Фото не найдено')
        return Response(bytes(row['content']), media_type='image/webp',
                        headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@router.get('/me/tasks/{task_id}/contact')
def contact(request: Request, task_id: int):
    user = require_business(request)
    with connection() as db:
        owned_task(db, task_id, user['id'])
        row = db.execute('SELECT phone,enabled FROM task_contacts WHERE task_id=?', (task_id,)).fetchone()
        return {'phone': row['phone'] if row else '', 'enabled': bool(row and row['enabled'])}


@router.put('/me/tasks/{task_id}/contact')
def save_contact(request: Request, task_id: int, payload: ContactInput):
    user = require_business(request, mutate=True)
    with connection() as db:
        owned_task(db, task_id, user['id'])
        db.execute('''INSERT INTO task_contacts VALUES(?,?,?) ON CONFLICT(task_id)
                      DO UPDATE SET phone=excluded.phone,enabled=excluded.enabled''',
                   (task_id, payload.phone, int(payload.enabled)))
    return payload.model_dump()


def conversation(db, cid, uid):
    row = db.execute('''SELECT c.*,t.owner_user_id,t.card FROM conversations c JOIN tasks t ON t.id=c.task_id
                        WHERE c.id=? AND (t.owner_user_id=? OR c.team_user_id=?)''', (cid, uid, uid)).fetchone()
    if not row:
        error(404, 'NOT_FOUND', 'Переписка не найдена')
    return row


def conversation_info(db, row, uid):
    business = row['owner_user_id'] == uid
    profile = profile_for(db, row['team_user_id'] if business else row['owner_user_id'])
    read_id = row['business_read_id'] if business else row['team_read_id']
    last = db.execute('SELECT text,created_at FROM direct_messages WHERE conversation_id=? ORDER BY id DESC LIMIT 1', (row['id'],)).fetchone()
    unread = db.execute('SELECT COUNT(*) FROM direct_messages WHERE conversation_id=? AND id>? AND sender_id<>?', (row['id'], read_id, uid)).fetchone()[0]
    return {'id': row['id'], 'task_id': row['task_id'], 'task_title': json.loads(row['card']).get('title', ''),
            'peer_name': profile.get('name', ''), 'peer_role': 'TEAM' if business else 'BUSINESS',
            'last_text': last['text'][:180] if last else '', 'updated_at': last['created_at'] if last else row['created_at'], 'unread': unread}


def open_conversation(db, task_id, team_uid, uid):
    db.execute('INSERT OR IGNORE INTO conversations(task_id,team_user_id,created_at) VALUES(?,?,?)', (task_id, team_uid, now()))
    cid = db.execute('SELECT id FROM conversations WHERE task_id=? AND team_user_id=?', (task_id, team_uid)).fetchone()[0]
    return conversation_info(db, conversation(db, cid, uid), uid)


@router.post('/catalog/tasks/{task_id}/conversation')
def start_team(request: Request, task_id: int):
    user = require_team(request, mutate=True)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        published_task(db, task_id)
        if not db.execute('SELECT 1 FROM teams WHERE owner_user_id=?', (user['id'],)).fetchone():
            error(409, 'PROFILE_REQUIRED', 'Сначала заполните профиль команды')
        return open_conversation(db, task_id, user['id'], user['id'])


@router.post('/me/proposals/{proposal_id}/conversation')
def start_business(request: Request, proposal_id: int):
    user = require_business(request, mutate=True)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        proposal = owned_proposal(db, proposal_id, user['id'])
        team = db.execute('SELECT owner_user_id FROM teams WHERE id=?', (proposal['team_id'],)).fetchone()
        if not team or not team['owner_user_id']:
            error(404, 'NOT_FOUND', 'Команда не найдена')
        return open_conversation(db, proposal['task_id'], team['owner_user_id'], user['id'])


@router.get('/me/conversations')
def inbox(request: Request):
    user, _ = current_session(request)
    with connection() as db:
        rows = db.execute('''SELECT c.*,t.owner_user_id,t.card FROM conversations c JOIN tasks t ON t.id=c.task_id
                             WHERE t.owner_user_id=? OR c.team_user_id=?''', (user['id'], user['id'])).fetchall()
        items = [conversation_info(db, row, user['id']) for row in rows]
        return {'conversations': sorted(items, key=lambda item: (item['updated_at'], item['id']), reverse=True)}


def message_info(row, uid):
    return {key: row[key] for key in ('id', 'text', 'created_at')} | {'mine': row['sender_id'] == uid}


@router.get('/me/conversations/{cid}/messages')
def messages(request: Request, cid: int, after_id: int = Query(default=0, ge=0)):
    user, _ = current_session(request)
    with connection() as db:
        row = conversation(db, cid, user['id'])
        items = db.execute('SELECT * FROM direct_messages WHERE conversation_id=? AND id>? ORDER BY id LIMIT 101', (cid, after_id)).fetchall()
        return {'conversation': conversation_info(db, row, user['id']),
                'messages': [message_info(item, user['id']) for item in items[:100]], 'has_more': len(items) > 100}


@router.post('/me/conversations/{cid}/messages')
def send(request: Request, cid: int, payload: MessageInput):
    user, token = current_session(request)
    require_csrf(request, token)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        conversation(db, cid, user['id'])
        old = db.execute('SELECT * FROM direct_messages WHERE sender_id=? AND request_id=?', (user['id'], str(payload.request_id))).fetchone()
        if old:
            if old['conversation_id'] != cid or old['text'] != payload.text:
                error(409, 'CONFLICT', 'Идентификатор сообщения уже использован')
            return message_info(old, user['id'])
        since = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
        if db.execute('SELECT COUNT(*) FROM direct_messages WHERE sender_id=? AND created_at>?', (user['id'], since)).fetchone()[0] >= 30:
            error(429, 'RATE_LIMITED', 'Слишком много сообщений. Подождите минуту')
        cursor = db.execute('INSERT INTO direct_messages(conversation_id,sender_id,request_id,text,created_at) VALUES(?,?,?,?,?)', (cid, user['id'], str(payload.request_id), payload.text, now()))
        return message_info(db.execute('SELECT * FROM direct_messages WHERE id=?', (cursor.lastrowid,)).fetchone(), user['id'])


@router.post('/me/conversations/{cid}/read')
def mark_read(request: Request, cid: int, payload: ReadInput):
    user, token = current_session(request)
    require_csrf(request, token)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        row = conversation(db, cid, user['id'])
        if not db.execute('SELECT 1 FROM direct_messages WHERE id=? AND conversation_id=?', (payload.through_id, cid)).fetchone():
            error(422, 'VALIDATION_ERROR', 'Сообщение не найдено в этой переписке')
        field = 'business_read_id' if row['owner_user_id'] == user['id'] else 'team_read_id'
        db.execute(f'UPDATE conversations SET {field}=MAX({field},?) WHERE id=?', (payload.through_id, cid))
    return {'status': 'ok'}
