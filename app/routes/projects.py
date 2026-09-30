"""Private business/team workspaces with explicit delivery and acceptance."""
import json
from datetime import date
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import ConfigDict, Field, HttpUrl, field_validator

from app.db import connection, now
from app.routes.auth import current_session, require_csrf, error
from app.routes.profiles import profile_for
from app.schemas import InputModel

router = APIRouter(prefix='/api/me')
JOIN = '''SELECT pr.*, p.task_id,p.team_id,p.status AS proposal_status,p.milestone_confirmed,
                 t.owner_user_id AS business_id,tm.owner_user_id AS team_user_id,tm.name AS team_name
          FROM projects pr JOIN proposals p ON p.id=pr.proposal_id
          JOIN tasks t ON t.id=p.task_id JOIN teams tm ON tm.id=p.team_id'''


class Version(InputModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    expected_revision: int = Field(ge=0, strict=True)


class MilestoneInput(Version):
    title: str = Field(min_length=3, max_length=160)
    description: str = Field(min_length=3, max_length=2000)
    due_date: date | None = None


class ActionInput(Version):
    action: Literal['start', 'submit', 'approve', 'revise']
    note: str = Field(default='', max_length=3000)
    result_url: str = Field(default='', max_length=500)

    @field_validator('result_url')
    @classmethod
    def url(cls, value):
        return str(HttpUrl(value)) if value else ''


class StatusInput(Version):
    status: Literal['active', 'completed']


def session(request, mutate=False):
    user, token = current_session(request)
    if mutate:
        require_csrf(request, token)
    return user


def owned(db, project_id, user):
    row = db.execute(JOIN + ' WHERE pr.id=? AND (t.owner_user_id=? OR tm.owner_user_id=?)',
                     (project_id, user['id'], user['id'])).fetchone()
    if not row:
        error(404, 'NOT_FOUND', 'Проект не найден')
    return row


def guard(row, user, payload, role=None, active=True):
    if role and user['role'] != role:
        error(403, 'FORBIDDEN', 'Это действие выполняет другая сторона проекта')
    if row['revision'] != payload.expected_revision:
        error(409, 'CONFLICT', 'Проект изменился. Обновите его перед сохранением; ваш ввод остаётся в форме.')
    if active and row['status'] != 'active':
        error(409, 'CONFLICT', 'Проект завершён. Бизнес может открыть его снова.')


def event(db, row, user, kind, content, milestone_id=None):
    if db.execute('SELECT COUNT(*) FROM project_events WHERE project_id=?', (row['id'],)).fetchone()[0] >= 1000:
        error(409, 'CONFLICT', 'Достигнут предел истории проекта')
    db.execute('INSERT INTO project_events(project_id,milestone_id,kind,actor_role,content,created_at) VALUES(?,?,?,?,?,?)',
               (row['id'], milestone_id, kind, user['role'], json.dumps(content, ensure_ascii=False), now()))
    db.execute('UPDATE projects SET revision=revision+1 WHERE id=?', (row['id'],))


def summary(db, row):
    snapshot = json.loads(row['snapshot'])
    counts = db.execute("SELECT COUNT(*),COALESCE(SUM(status='done'),0),COALESCE(SUM(status='review'),0) FROM project_milestones WHERE project_id=?", (row['id'],)).fetchone()
    return {'id': row['id'], 'proposal_id': row['proposal_id'], 'task_id': row['task_id'],
            'title': snapshot['card']['title'], 'team_name': row['team_name'], 'status': row['status'],
            'revision': row['revision'], 'created_at': row['created_at'],
            'total': counts[0], 'done': counts[1], 'review': counts[2]}


def detail(db, row):
    return {**summary(db, row), 'snapshot': json.loads(row['snapshot']),
            'business': profile_for(db, row['business_id']), 'team': profile_for(db, row['team_user_id']),
            'points_awarded': bool(row['milestone_confirmed']),
            'milestones': [dict(r) for r in db.execute('SELECT * FROM project_milestones WHERE project_id=? ORDER BY id', (row['id'],))],
            'events': [{**dict(r), 'content': json.loads(r['content'])} for r in db.execute('SELECT * FROM project_events WHERE project_id=? ORDER BY id DESC', (row['id'],))]}


@router.get('/projects')
def list_projects(request: Request):
    user = session(request)
    with connection() as db:
        return {'projects': [summary(db, row) for row in db.execute(JOIN + ' WHERE t.owner_user_id=? OR tm.owner_user_id=? ORDER BY pr.id DESC', (user['id'], user['id']))]}


@router.post('/proposals/{proposal_id}/project')
def create(request: Request, proposal_id: int):
    user = session(request, True)
    if user['role'] != 'BUSINESS':
        error(403, 'FORBIDDEN', 'Проект начинает бизнес')
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        proposal = db.execute('SELECT p.*,t.card,t.topic FROM proposals p JOIN tasks t ON t.id=p.task_id WHERE p.id=? AND t.owner_user_id=?', (proposal_id,user['id'])).fetchone()
        if not proposal:
            error(404, 'NOT_FOUND', 'Отклик не найден')
        if proposal['status'] != 'selected':
            error(409, 'CONFLICT', 'Сначала выберите команду по её отклику')
        existing = db.execute('SELECT id FROM projects WHERE proposal_id=?', (proposal_id,)).fetchone()
        if existing:
            return detail(db, owned(db, existing['id'], user))
        snapshot = {'card':json.loads(proposal['card']), 'topic':proposal['topic'],
                    'proposal':{key:proposal[key] for key in ('idea','plan','duration_days','prototype_url')}}
        cursor = db.execute('INSERT INTO projects(proposal_id,snapshot,created_at) VALUES(?,?,?)', (proposal_id,json.dumps(snapshot,ensure_ascii=False),now()))
        row = owned(db,cursor.lastrowid,user)
        event(db,row,user,'created',{})
        return detail(db,owned(db,row['id'],user))


@router.get('/projects/{project_id}')
def get_project(request: Request, project_id: int):
    user = session(request)
    with connection() as db:
        return detail(db,owned(db,project_id,user))


@router.patch('/projects/{project_id}')
def project_status(request: Request, project_id: int, payload: StatusInput):
    user = session(request,True)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE'); row=owned(db,project_id,user)
        guard(row,user,payload,'BUSINESS',active=False)
        if payload.status == row['status']:
            return detail(db,row)
        if payload.status == 'completed':
            counts=summary(db,row)
            if not counts['total'] or counts['done'] != counts['total']:
                error(409,'CONFLICT','Сначала примите результаты всех этапов')
        db.execute('UPDATE projects SET status=? WHERE id=?',(payload.status,project_id))
        event(db,row,user,payload.status,{})
        return detail(db,owned(db,project_id,user))


@router.post('/projects/{project_id}/milestones')
def add_milestone(request: Request, project_id: int, payload: MilestoneInput):
    user=session(request,True)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE');row=owned(db,project_id,user);guard(row,user,payload,'BUSINESS')
        if db.execute('SELECT COUNT(*) FROM project_milestones WHERE project_id=?',(project_id,)).fetchone()[0] >= 30:
            error(409,'CONFLICT','В проекте может быть не более 30 этапов')
        cursor=db.execute('INSERT INTO project_milestones(project_id,title,description,due_date) VALUES(?,?,?,?)',
                          (project_id,payload.title,payload.description,payload.due_date.isoformat() if payload.due_date else None))
        event(db,row,user,'milestone_added',payload.model_dump(mode='json',exclude={'expected_revision'}),cursor.lastrowid)
        return detail(db,owned(db,project_id,user))


@router.put('/projects/{project_id}/milestones/{milestone_id}')
def edit_milestone(request: Request, project_id: int, milestone_id: int, payload: MilestoneInput):
    user=session(request,True)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE');row=owned(db,project_id,user);guard(row,user,payload,'BUSINESS')
        stage=stage_for(db,project_id,milestone_id)
        if stage['status'] != 'planned':
            error(409,'CONFLICT','Начатый этап нельзя изменить; обсудите результат через сдачу и замечания')
        db.execute('UPDATE project_milestones SET title=?,description=?,due_date=? WHERE id=?',
                   (payload.title,payload.description,payload.due_date.isoformat() if payload.due_date else None,milestone_id))
        event(db,row,user,'milestone_edited',payload.model_dump(mode='json',exclude={'expected_revision'}),milestone_id)
        return detail(db,owned(db,project_id,user))


def stage_for(db, project_id, milestone_id):
    stage=db.execute('SELECT * FROM project_milestones WHERE id=? AND project_id=?',(milestone_id,project_id)).fetchone()
    if not stage:
        error(404,'NOT_FOUND','Этап не найден')
    return stage


@router.post('/projects/{project_id}/milestones/{milestone_id}/action')
def milestone_action(request: Request, project_id: int, milestone_id: int, payload: ActionInput):
    user=session(request,True)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE');row=owned(db,project_id,user)
        guard(row,user,payload,'TEAM' if payload.action in ('start','submit') else 'BUSINESS')
        stage=stage_for(db,project_id,milestone_id)
        allowed={'start':('planned','changes_requested'),'submit':('planned','in_progress','changes_requested'),'approve':('review',),'revise':('review',)}
        if stage['status'] not in allowed[payload.action]:
            error(409,'CONFLICT','Этот переход этапа сейчас недоступен')
        if payload.action=='submit':
            if len(payload.note)<10:
                error(422,'VALIDATION_ERROR','Опишите результат: не менее 10 символов')
            db.execute("UPDATE project_milestones SET status='review',result_note=?,result_url=?,feedback='' WHERE id=?",(payload.note,payload.result_url,milestone_id))
        elif payload.action=='revise':
            if len(payload.note)<3:
                error(422,'VALIDATION_ERROR','Напишите, что нужно доработать')
            db.execute("UPDATE project_milestones SET status='changes_requested',feedback=? WHERE id=?",(payload.note,milestone_id))
        elif payload.action=='start':
            db.execute("UPDATE project_milestones SET status='in_progress' WHERE id=?",(milestone_id,))
        else:
            db.execute("UPDATE project_milestones SET status='done' WHERE id=?",(milestone_id,))
            if not row['milestone_confirmed']:
                db.execute('UPDATE proposals SET milestone_confirmed=1,points=10 WHERE id=?',(row['proposal_id'],))
                db.execute('UPDATE teams SET points=points+10 WHERE id=?',(row['team_id'],))
        event(db,row,user,payload.action,{'title':stage['title'],'note':payload.note,'result_url':payload.result_url},milestone_id)
        return detail(db,owned(db,project_id,user))
