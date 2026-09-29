"""Challenges owned by a signed-in business user."""

import json

from fastapi import APIRouter, Request

from app.db import connection, now, task_from_row
from app.routes.auth import error, require_business
from app.schemas import TaskInput

router = APIRouter(prefix="/api/me/tasks")


def owned_task(db, task_id: int, user_id: int):
    row = db.execute("SELECT * FROM tasks WHERE id=? AND owner_user_id=?",
                     (task_id, user_id)).fetchone()
    if row is None:
        error(404, "NOT_FOUND", "Задача не найдена")
    return row


@router.get("")
def list_my_tasks(request: Request):
    user = require_business(request)
    with connection() as db:
        rows = db.execute("SELECT * FROM tasks WHERE owner_user_id=? ORDER BY id DESC",
                          (user["id"],)).fetchall()
        return {"tasks": [task_from_row(db, row) for row in rows]}


@router.post("", status_code=201)
def create_my_task(request: Request, payload: TaskInput):
    user = require_business(request, mutate=True)
    with connection() as db:
        cursor = db.execute("""INSERT INTO tasks(topic,card,confirmed_fields,status,created_at,owner_user_id)
                               VALUES(?,?,?,'draft',?,?)""",
                            (payload.topic, payload.card.model_dump_json(),
                             json.dumps(payload.confirmed_fields), now(), user["id"]))
        return task_from_row(db, owned_task(db, cursor.lastrowid, user["id"]))


@router.get("/{task_id}")
def get_my_task(request: Request, task_id: int):
    user = require_business(request)
    with connection() as db:
        return task_from_row(db, owned_task(db, task_id, user["id"]))


@router.put("/{task_id}")
def update_my_task(request: Request, task_id: int, payload: TaskInput):
    user = require_business(request, mutate=True)
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = owned_task(db, task_id, user["id"])
        if payload.expected_revision is not None and payload.expected_revision != row["revision"]:
            error(409, "CONFLICT", "Карточка изменена в другом окне. Откройте задачу заново; ваш текст остаётся в редакторе.")
        db.execute("UPDATE tasks SET topic=?,card=?,confirmed_fields=?,revision=revision+1 WHERE id=?",
                   (payload.topic, payload.card.model_dump_json(),
                    json.dumps(payload.confirmed_fields), task_id))
        return task_from_row(db, owned_task(db, task_id, user["id"]))


@router.post("/{task_id}/publish")
def publish_my_task(request: Request, task_id: int):
    user = require_business(request, mutate=True)
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = owned_task(db, task_id, user["id"])
        if not json.loads(row["card"]).get("title", "").strip():
            error(422, "VALIDATION_ERROR", "Для публикации заполните название задачи")
        db.execute("UPDATE tasks SET status='published',revision=revision+1 WHERE id=?", (task_id,))
        return task_from_row(db, owned_task(db, task_id, user["id"]))
