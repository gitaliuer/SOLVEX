from fastapi import APIRouter, Request
from pydantic import StrictBool

from app.db import connection, now, task_from_row
from app.matching import recommendations
from app.routes.auth import error, require_business
from app.routes.community import team_from_row
from app.routes.me import owned_task
from app.schemas import InputModel

router = APIRouter(prefix='/api/me/tasks')


def matching_task(db, task_id, user_id):
    row = owned_task(db, task_id, user_id)
    if row['status'] != 'published':
        error(409, 'PUBLICATION_REQUIRED', 'Сначала опубликуйте задачу. Подбор доступен с любым рейтингом.')
    return task_from_row(db, row)


@router.get('/{task_id}/matches')
def matches(request: Request, task_id: int):
    user = require_business(request)
    with connection() as db:
        task = matching_task(db, task_id, user['id'])
        teams = [team_from_row(row) for row in db.execute('SELECT * FROM teams WHERE owner_user_id IS NOT NULL')]
        saved = {row['team_id'] for row in db.execute('SELECT team_id FROM team_shortlist WHERE task_id=?', (task_id,))}
        proposals = {row['team_id']: {'id': row['id'], 'status': row['status']} for row in db.execute(
            'SELECT id,team_id,status FROM proposals WHERE task_id=?', (task_id,))}
    results, signals = recommendations(task, teams)
    for item in results:
        team_id = item['team']['id']
        item.update(shortlisted=team_id in saved, proposal=proposals.get(team_id))
    return {'task': task, 'teams': results, 'signals': signals, 'method': 'profile_terms_v1'}


class ShortlistInput(InputModel):
    saved: StrictBool


@router.put('/{task_id}/shortlist/{team_id}')
def shortlist(request: Request, task_id: int, team_id: int, payload: ShortlistInput):
    user = require_business(request, mutate=True)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        matching_task(db, task_id, user['id'])
        if not db.execute('SELECT 1 FROM teams WHERE id=? AND owner_user_id IS NOT NULL', (team_id,)).fetchone():
            error(404, 'NOT_FOUND', 'Команда не найдена')
        if payload.saved:
            db.execute('INSERT INTO team_shortlist(task_id,team_id,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING',
                       (task_id, team_id, now()))
        else:
            db.execute('DELETE FROM team_shortlist WHERE task_id=? AND team_id=?', (task_id, team_id))
    return {'team_id': team_id, 'saved': payload.saved}
