"""Published account challenges, team profiles and owned proposals."""

import json

from fastapi import APIRouter, Query, Request

from app.db import connection, now, proposal_from_row, task_from_row
from app.routes.auth import current_session, error, require_business, require_csrf
from app.routes.me import owned_task
from app.routes.profiles import profile_for
from app.routes.api import card, questions
from app.schemas import (CardGenerationInput, DecisionInput, DraftInput,
                         ProposalContent, TeamProfileInput)

router = APIRouter(prefix="/api")


def require_team(request: Request, *, mutate: bool = False):
    user, token = current_session(request)
    if user["role"] != "TEAM":
        error(403, "FORBIDDEN", "Действие доступно аккаунту команды")
    if mutate:
        require_csrf(request, token)
    return user


def team_from_row(row):
    if row is None:
        return None
    with connection() as db:
        profile = profile_for(db, row['owner_user_id']) if row['owner_user_id'] else {}
    return {**profile, "id": row["id"], "name": row["name"], "points": row["points"],
            **{key: json.loads(row[key]) for key in ("interests", "skills", "technologies")}}


def published_task(db, task_id):
    row = db.execute("""SELECT * FROM tasks WHERE id=? AND status='published'
                        AND owner_user_id IS NOT NULL""", (task_id,)).fetchone()
    if row is None:
        error(404, "NOT_FOUND", "Опубликованная задача не найдена")
    return row


@router.get("/catalog/tasks")
def catalog(topic: str | None = None, level: str | None = None,
            q: str = Query(default="", max_length=160)):
    if level and level not in ("draft", "working", "ready", "priority"):
        error(422, "VALIDATION_ERROR", "Неизвестный уровень готовности")
    with connection() as db:
        rows = db.execute("SELECT * FROM tasks WHERE status='published' AND owner_user_id IS NOT NULL")
        tasks = [task_from_row(db, row) for row in rows]
    needle = q.strip().casefold()
    tasks = [task for task in tasks if
             (not topic or task["topic"] == topic) and (not level or task["level"] == level) and
             (not needle or needle in " ".join(task["card"].get(key, "") for key in
              ("title", "context", "need")).casefold())]
    return {"tasks": sorted(tasks, key=lambda task: (-task["score"], task["id"]))}


@router.get("/catalog/tasks/{task_id}")
def catalog_task(task_id: int):
    with connection() as db:
        row = published_task(db, task_id)
        return {**task_from_row(db, row), 'organization': profile_for(db, row['owner_user_id'])}


@router.get("/catalog/teams")
def teams():
    with connection() as db:
        return {"teams": [team_from_row(row) for row in db.execute(
            "SELECT * FROM teams WHERE owner_user_id IS NOT NULL ORDER BY id")]}


@router.get("/me/team")
def my_team(request: Request):
    user = require_team(request)
    with connection() as db:
        return {"team": team_from_row(db.execute(
            "SELECT * FROM teams WHERE owner_user_id=?", (user["id"],)).fetchone())}


@router.put("/me/team")
def save_team(request: Request, payload: TeamProfileInput):
    user = require_team(request, mutate=True)
    with connection() as db:
        db.execute("""INSERT INTO teams(name,interests,skills,technologies,owner_user_id)
                      VALUES(?,?,?,?,?) ON CONFLICT(owner_user_id) DO UPDATE SET
                      name=excluded.name,interests=excluded.interests,
                      skills=excluded.skills,technologies=excluded.technologies""",
                   (payload.name, json.dumps(payload.interests), json.dumps(payload.skills),
                    json.dumps(payload.technologies), user["id"]))
        return {"team": team_from_row(db.execute(
            "SELECT * FROM teams WHERE owner_user_id=?", (user["id"],)).fetchone())}


@router.post("/catalog/tasks/{task_id}/proposals", status_code=201)
def propose(request: Request, task_id: int, payload: ProposalContent):
    user = require_team(request, mutate=True)
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        published_task(db, task_id)
        team = db.execute("SELECT * FROM teams WHERE owner_user_id=?", (user["id"],)).fetchone()
        if team is None:
            error(409, "PROFILE_REQUIRED", "Сначала заполните профиль команды")
        if db.execute("SELECT 1 FROM proposals WHERE task_id=? AND team_id=?",
                      (task_id, team["id"])).fetchone():
            error(409, "CONFLICT", "Ваша команда уже отправила отклик на эту задачу")
        cursor = db.execute("""INSERT INTO proposals(task_id,team_id,idea,plan,duration_days,
                               prototype_url,created_at) VALUES(?,?,?,?,?,?,?)""",
                            (task_id, team["id"], payload.idea, payload.plan, payload.duration_days,
                             str(payload.prototype_url), now()))
        return proposal_from_row(db.execute("SELECT * FROM proposals WHERE id=?",
                                           (cursor.lastrowid,)).fetchone())


@router.get("/me/proposals")
def my_proposals(request: Request):
    user = require_team(request)
    with connection() as db:
        rows = db.execute("""SELECT p.*, t.card AS task_card,
                             (SELECT id FROM projects WHERE proposal_id=p.id) AS project_id FROM proposals p
                             JOIN teams tm ON tm.id=p.team_id JOIN tasks t ON t.id=p.task_id
                             WHERE tm.owner_user_id=? ORDER BY p.id DESC""", (user["id"],))
        result = []
        for row in rows:
            proposal = proposal_from_row(row)
            proposal["task_title"] = json.loads(proposal.pop("task_card")).get("title", "Без названия")
            result.append(proposal)
        return {"proposals": result}


@router.get("/me/tasks/{task_id}/proposals")
def incoming_proposals(request: Request, task_id: int):
    user = require_business(request)
    with connection() as db:
        owned_task(db, task_id, user["id"])
        return {"proposals": [proposal_from_row(row) for row in db.execute(
            "SELECT p.*,(SELECT id FROM projects WHERE proposal_id=p.id) AS project_id FROM proposals p WHERE task_id=? ORDER BY id DESC", (task_id,))]}


def owned_proposal(db, proposal_id, user_id):
    row = db.execute("""SELECT p.* FROM proposals p JOIN tasks t ON t.id=p.task_id
                        WHERE p.id=? AND t.owner_user_id=?""", (proposal_id, user_id)).fetchone()
    if row is None:
        error(404, "NOT_FOUND", "Отклик не найден")
    return row


@router.patch("/me/proposals/{proposal_id}")
def decide(request: Request, proposal_id: int, payload: DecisionInput):
    user = require_business(request, mutate=True)
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = owned_proposal(db, proposal_id, user["id"])
        if payload.status != 'selected' and db.execute('SELECT 1 FROM projects WHERE proposal_id=?',(proposal_id,)).fetchone():
            error(409, 'CONFLICT', 'По этому отклику уже начат проект')
        if row["milestone_confirmed"] and payload.status != "selected":
            error(409, "CONFLICT", "После подтверждения этапа решение изменить нельзя")
        db.execute("UPDATE proposals SET status=? WHERE id=?", (payload.status, proposal_id))
        return proposal_from_row(owned_proposal(db, proposal_id, user["id"]))


@router.post("/me/proposals/{proposal_id}/milestones/confirm")
def confirm(request: Request, proposal_id: int):
    user = require_business(request, mutate=True)
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = owned_proposal(db, proposal_id, user["id"])
        if db.execute('SELECT 1 FROM projects WHERE proposal_id=?',(proposal_id,)).fetchone():
            error(409, 'CONFLICT', 'Подтвердите результат в дорожной карте проекта')
        if row["status"] != "selected":
            error(409, "CONFLICT", "Сначала выберите команду")
        if not row["milestone_confirmed"]:
            db.execute("UPDATE proposals SET milestone_confirmed=1,points=10 WHERE id=?", (proposal_id,))
            db.execute("UPDATE teams SET points=points+10 WHERE id=?", (row["team_id"],))
        return proposal_from_row(owned_proposal(db, proposal_id, user["id"]))


@router.post("/me/ai/questions")
async def private_questions(request: Request, payload: DraftInput):
    require_business(request, mutate=True)
    return await questions(payload)


@router.post("/me/ai/card")
async def private_card(request: Request, payload: CardGenerationInput):
    require_business(request, mutate=True)
    return await card(payload)
