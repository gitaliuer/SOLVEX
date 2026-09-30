"""Server-side accounts and sessions for the protected application."""

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from sqlite3 import IntegrityError

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import APIRouter, HTTPException, Request, Response

from app.db import connection, now
from app.schemas import LoginInput, RegisterInput

router = APIRouter(prefix="/api/auth")
PASSWORD_HASHER = PasswordHasher(time_cost=2, memory_cost=19 * 1024, parallelism=1)
SESSION_SECONDS = 7 * 24 * 60 * 60
LOGIN_WINDOW = timedelta(minutes=15)
LOGIN_LIMIT_BY_EMAIL = 5
LOGIN_LIMIT_BY_IP = 30
DUMMY_HASH = PASSWORD_HASHER.hash("unused-login-verification-value")


def error(status: int, code: str, message: str):
    raise HTTPException(status_code=status, detail={"code": code, "message": message})


def cookie_name() -> str:
    return "__Host-solvex_session" if secure_cookie() else "solvex_session"


def secure_cookie() -> bool:
    return os.getenv("APP_ENV") == "production" or bool(os.getenv("VERCEL"))


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def csrf_token(token: str) -> str:
    return hashlib.sha256(("csrf:" + token).encode("utf-8")).hexdigest()


def attempt_keys(request: Request, email: str) -> tuple[str, str]:
    ip = request.client.host if request.client else "unknown"
    return (token_hash("email:" + ip + ":" + email), token_hash("ip:" + ip))


def rate_limited(db, key: str, limit: int, current: datetime) -> bool:
    row = db.execute("SELECT failures,window_started_at FROM auth_attempts WHERE identity_hash=?",
                     (key,)).fetchone()
    return bool(row and row["failures"] >= limit and
                datetime.fromisoformat(row["window_started_at"]) + LOGIN_WINDOW > current)


def record_failure(keys: tuple[str, str], current: datetime) -> None:
    with connection() as db:
        db.execute("BEGIN IMMEDIATE")
        for key in keys:
            row = db.execute("SELECT failures,window_started_at FROM auth_attempts WHERE identity_hash=?",
                             (key,)).fetchone()
            failures = (row["failures"] + 1 if row and
                        datetime.fromisoformat(row["window_started_at"]) + LOGIN_WINDOW > current else 1)
            started = row["window_started_at"] if row and failures > 1 else current.isoformat()
            db.execute("""INSERT INTO auth_attempts(identity_hash,failures,window_started_at)
                          VALUES(?,?,?) ON CONFLICT(identity_hash) DO UPDATE SET
                          failures=excluded.failures, window_started_at=excluded.window_started_at""",
                       (key, failures, started))


def public_user(row) -> dict:
    return {"id": row["id"], "email": row["email"], "role": row["role"],
            "created_at": row["created_at"]}


def start_session(response: Response, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(seconds=SESSION_SECONDS)).isoformat()
    with connection() as db:
        db.execute("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
                   (token_hash(token), user_id, now(), expires_at))
    response.set_cookie(cookie_name(), token, max_age=SESSION_SECONDS, path="/",
                        httponly=True, secure=secure_cookie(), samesite="strict")
    return token


def current_session(request: Request) -> tuple[dict, str]:
    token = request.cookies.get(cookie_name(), "")
    if not token:
        error(401, "UNAUTHORIZED", "Войдите в аккаунт")
    with connection() as db:
        row = db.execute("""SELECT u.id,u.email,u.role,u.created_at,s.expires_at
                            FROM sessions s JOIN users u ON u.id=s.user_id
                            WHERE s.token_hash=?""", (token_hash(token),)).fetchone()
    if row is None or datetime.fromisoformat(row["expires_at"]) <= datetime.now(timezone.utc):
        error(401, "UNAUTHORIZED", "Сессия истекла. Войдите снова")
    return public_user(row), token


def require_business(request: Request, *, mutate: bool = False) -> dict:
    user, token = current_session(request)
    if user["role"] != "BUSINESS":
        error(403, "FORBIDDEN", "Действие доступно бизнес-аккаунту")
    if mutate:
        require_csrf(request, token)
    return user


def require_csrf(request: Request, token: str) -> None:
    supplied = request.headers.get("X-CSRF-Token", "")
    if not hmac.compare_digest(supplied, csrf_token(token)):
        error(403, "FORBIDDEN", "Обновите страницу и повторите действие")


@router.post("/register", status_code=201)
def register(payload: RegisterInput, response: Response):
    password_hash = PASSWORD_HASHER.hash(payload.password)
    try:
        with connection() as db:
            cursor = db.execute("INSERT INTO users(email,password_hash,role,created_at) VALUES(?,?,?,?)",
                                (str(payload.email), password_hash, payload.role, now()))
            user = db.execute("SELECT * FROM users WHERE id=?", (cursor.lastrowid,)).fetchone()
    except IntegrityError:
        error(409, "CONFLICT", "Аккаунт с таким email уже существует")
    token = start_session(response, user["id"])
    return {"user": public_user(user), "csrf_token": csrf_token(token)}


@router.post("/login")
def login(payload: LoginInput, request: Request, response: Response):
    keys = attempt_keys(request, str(payload.email))
    current = datetime.now(timezone.utc)
    with connection() as db:
        if rate_limited(db, keys[0], LOGIN_LIMIT_BY_EMAIL, current) or rate_limited(
                db, keys[1], LOGIN_LIMIT_BY_IP, current):
            error(429, "RATE_LIMITED", "Слишком много попыток входа. Попробуйте позже")
        user = db.execute("SELECT * FROM users WHERE email=?", (str(payload.email),)).fetchone()
    try:
        PASSWORD_HASHER.verify(user["password_hash"] if user else DUMMY_HASH, payload.password)
    except (VerificationError, InvalidHashError):
        record_failure(keys, current)
        error(401, "UNAUTHORIZED", "Неверный email или пароль")
    if user is None:
        record_failure(keys, current)
        error(401, "UNAUTHORIZED", "Неверный email или пароль")
    with connection() as db:
        db.execute("DELETE FROM auth_attempts WHERE identity_hash=?", (keys[0],))
    token = start_session(response, user["id"])
    return {"user": public_user(user), "csrf_token": csrf_token(token)}


@router.get("/me")
def me(request: Request):
    user, token = current_session(request)
    return {"user": user, "csrf_token": csrf_token(token)}


@router.post("/logout")
def logout(request: Request, response: Response):
    _, token = current_session(request)
    require_csrf(request, token)
    with connection() as db:
        db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(token),))
    response.delete_cookie(cookie_name(), path="/", secure=secure_cookie(),
                           httponly=True, samesite="strict")
    return {"status": "ok"}
