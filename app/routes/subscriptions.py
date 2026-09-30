from fastapi import APIRouter, Request
from app.db import connection
from app.routes.auth import current_session, require_business, error
from app import usage

router = APIRouter(prefix='/api')


@router.get('/plans')
def public_plans():
    return usage.plans()


@router.get('/me/subscription')
def subscription(request: Request):
    user, _ = current_session(request)
    with connection() as db:
        usage.expire(db)
        return usage.snapshot(db, user['id'])


@router.post('/me/subscription/checkout')
def checkout(request: Request):
    require_business(request, mutate=True)
    error(503, 'BILLING_NOT_CONFIGURED', 'Приём оплаты ещё не подключён. Подписка не активирована, деньги не списаны.')
