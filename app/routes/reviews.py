"""Owner-only saved AI reviews with stale-input and concurrent-run protection."""
import asyncio
import hashlib
import json
from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Request, HTTPException

from app.ai.review import analyze
from app.ai.service import AIServiceError
from app.db import connection, now, task_from_row
from app.routes.auth import require_business, error
from app.routes.community import owned_proposal
from app.routes.me import owned_task
from app.schemas import InputModel

router = APIRouter(prefix='/api/me/proposals')


class ReviewInput(InputModel):
    locale: Literal['ru', 'en'] = 'ru'


def inputs(db, proposal_id, user_id):
    proposal = dict(owned_proposal(db, proposal_id, user_id))
    task = task_from_row(db, owned_task(db, proposal['task_id'], user_id))
    source = {'card': task['card'], 'proposal': {key: proposal[key] for key in ('idea', 'plan', 'duration_days', 'prototype_url')}}
    digest = hashlib.sha256(json.dumps(source, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    return task, proposal, digest


@router.get('/{proposal_id}/review')
def get_review(request: Request, proposal_id: int, locale: Literal['ru', 'en'] = 'ru'):
    user = require_business(request)
    with connection() as db:
        _, _, digest = inputs(db, proposal_id, user['id'])
        row = db.execute('SELECT * FROM proposal_reviews WHERE proposal_id=? AND locale=?', (proposal_id, locale)).fetchone()
        return {'review': json.loads(row['content']) if row and row['content'] else None,
                'stale': bool(row and row['content'] and row['digest'] != digest)}


@router.post('/{proposal_id}/review')
async def run_review(request: Request, proposal_id: int, payload: ReviewInput):
    user = require_business(request, mutate=True)
    run_id = str(uuid4())
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        task, proposal, digest = inputs(db, proposal_id, user['id'])
        row = db.execute('SELECT * FROM proposal_reviews WHERE proposal_id=? AND locale=?', (proposal_id, payload.locale)).fetchone()
        if row and row['run_id'] and (datetime.now(timezone.utc) - datetime.fromisoformat(row['started_at'])).total_seconds() < 90:
            error(409, 'CONFLICT', 'Разбор уже выполняется. Подождите и обновите отклики.')
        if row and row['content'] and row['digest'] == digest:
            return {'review': json.loads(row['content']), 'stale': False}
        db.execute('''INSERT INTO proposal_reviews VALUES(?,?,?,NULL,?,?) ON CONFLICT(proposal_id,locale)
                      DO UPDATE SET started_at=excluded.started_at,run_id=excluded.run_id''',
                   (proposal_id, payload.locale, digest, now(), run_id))
    try:
        result = await asyncio.wait_for(analyze(task, proposal, payload.locale), timeout=45)
        result['created_at'] = now()
        with connection() as db:
            db.execute('BEGIN IMMEDIATE')
            _, _, current_digest = inputs(db, proposal_id, user['id'])
            current = db.execute('SELECT run_id FROM proposal_reviews WHERE proposal_id=? AND locale=?', (proposal_id, payload.locale)).fetchone()
            if current['run_id'] != run_id or current_digest != digest:
                error(409, 'CONFLICT', 'Задача изменилась во время разбора. Повторите для актуальной карточки.')
            db.execute("UPDATE proposal_reviews SET content=?,digest=?,run_id='' WHERE proposal_id=? AND locale=?",
                       (json.dumps(result, ensure_ascii=False), digest, proposal_id, payload.locale))
        return {'review': result, 'stale': False}
    except AIServiceError as exc:
        error({'AI_TIMEOUT': 504, 'AI_INVALID_OUTPUT': 502}.get(exc.code, 503), exc.code, exc.message)
    except asyncio.TimeoutError:
        error(504, 'AI_TIMEOUT', 'Разбор не завершился вовремя. Повторите запрос.')
    except HTTPException:
        raise
    except Exception:
        error(503, 'AI_UNAVAILABLE', 'AI временно недоступен. Повторите запрос.')
    finally:
        with connection() as db:
            db.execute("UPDATE proposal_reviews SET run_id='' WHERE proposal_id=? AND locale=? AND run_id=?", (proposal_id, payload.locale, run_id))
