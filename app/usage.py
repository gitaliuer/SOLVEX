"""Account-wide atomic allowances, independent of AI model and answer quality."""
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException
from uuid import uuid4
from app.db import connection

KAZAKHSTAN = timezone(timedelta(hours=5))
PLANS = {'free': {'chat': 10, 'research': 2, 'price_cents': 0},
         'plus': {'chat': 100, 'research': 10, 'price_cents': 399}}


def utcnow():
    return datetime.now(timezone.utc)


def plans():
    return {'plans': [{'id': key, **value, 'currency': 'USD', 'billing_period': 'month', 'quota_period': 'day'}
                      for key, value in PLANS.items()], 'reset_timezone': 'UTC+05:00', 'checkout_available': False}


def expire(db):
    db.execute("UPDATE ai_usage SET status='released' WHERE status='reserved' AND expires_at<=?", (utcnow().isoformat(),))


def snapshot(db, user_id):
    moment = utcnow()
    local = moment.astimezone(KAZAKHSTAN)
    period = local.date().isoformat()
    subscription = db.execute('SELECT * FROM subscriptions WHERE user_id=? AND starts_at<=? AND expires_at>?',
                              (user_id, moment.isoformat(), moment.isoformat())).fetchone()
    plan = subscription['plan'] if subscription else 'free'
    counts = {kind: {'limit': PLANS[plan][kind], 'used': 0, 'reserved': 0} for kind in ('chat', 'research')}
    for row in db.execute("SELECT kind,status,COUNT(*) count FROM ai_usage WHERE user_id=? AND period_key=? AND (status='completed' OR (status='reserved' AND expires_at>?)) GROUP BY kind,status",
                          (user_id, period, moment.isoformat())):
        counts[row['kind']]['used' if row['status'] == 'completed' else 'reserved'] = row['count']
    for count in counts.values():
        count['remaining'] = max(0, count['limit'] - count['used'] - count['reserved'])
    reset = (local + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return {'plan': plan, 'expires_at': subscription['expires_at'] if subscription else None,
            'usage': counts, 'period_key': period, 'resets_at': reset.isoformat(), **plans()}


def reserve(db, user_id, kind, run_id):
    """Caller owns BEGIN IMMEDIATE, including its run record and this reservation."""
    expire(db)
    current = snapshot(db, user_id)
    if current['usage'][kind]['remaining'] == 0:
        raise HTTPException(429, {'code': 'QUOTA_EXCEEDED', 'message': 'Дневной лимит AI исчерпан. Сохранённые данные доступны; лимит обновится в 00:00 по времени Казахстана.',
                                  'kind': kind, 'subscription': current})
    cutoff = (utcnow() - timedelta(minutes=1)).isoformat()
    if db.execute('SELECT COUNT(*) FROM ai_usage WHERE user_id=? AND created_at>?', (user_id, cutoff)).fetchone()[0] >= 20:
        raise HTTPException(429, {'code': 'RATE_LIMITED', 'message': 'Слишком много попыток AI. Подождите минуту и повторите.'})
    moment = utcnow()
    db.execute("INSERT INTO ai_usage VALUES(?,?,?,'reserved',?,?,?)", (run_id, user_id, kind, current['period_key'],
               moment.isoformat(), (moment + timedelta(seconds=200)).isoformat()))


def finish(db, run_id, success):
    cursor = db.execute("UPDATE ai_usage SET status=? WHERE id=? AND status='reserved' AND expires_at>?",
                        ('completed' if success else 'released', run_id, utcnow().isoformat()))
    return cursor.rowcount == 1


async def metered(user_id, operation):
    run_id = str(uuid4())
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        reserve(db, user_id, 'chat', run_id)
    try:
        result = await operation()
        with connection() as db:
            if not finish(db, run_id, True):
                raise HTTPException(504, {'code': 'AI_TIMEOUT', 'message': 'Запрос устарел. Повторите попытку.'})
        return result
    except BaseException:
        with connection() as db:
            finish(db, run_id, False)
        raise
