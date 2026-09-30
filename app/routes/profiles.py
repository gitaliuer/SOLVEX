"""Shared public organization profiles and decoded, metadata-free photographs."""
import io
import json
import warnings
from uuid import UUID, uuid4

from fastapi import APIRouter, Request, Response
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import Field, HttpUrl, field_validator
from starlette.concurrency import run_in_threadpool

from app.db import connection
from app.routes.auth import current_session, require_csrf, error
from app.schemas import TeamProfileInput

router = APIRouter(prefix='/api')


class ProfileInput(TeamProfileInput):
    skills: list[str] = Field(default_factory=list, max_length=16)
    headline: str = Field(default='', max_length=160)
    description: str = Field(default='', max_length=3000)
    industry: str = Field(default='', max_length=100)
    location: str = Field(default='', max_length=100)
    website: str = Field(default='', max_length=500)
    experience: str = Field(default='', max_length=2000)
    team_size: str = Field(default='', max_length=80)
    contact: str = Field(default='', max_length=200)

    @field_validator('website')
    @classmethod
    def safe_website(cls, value):
        if value:
            value = str(HttpUrl(value))
        return value


def profile_for(db, user_id):
    row = db.execute('SELECT * FROM organization_profiles WHERE user_id=?', (user_id,)).fetchone()
    result = json.loads(row['content']) if row else {}
    team = db.execute('SELECT * FROM teams WHERE owner_user_id=?', (user_id,)).fetchone()
    if team:
        result.update({key: json.loads(team[key]) for key in ('skills', 'interests', 'technologies')})
        result['name'] = team['name']
        result['points'] = team['points']
    result['image_url'] = '/api/profile-images/' + row['image_id'] if row and row['image_id'] else ''
    return result


@router.get('/me/profile')
def get_profile(request: Request):
    user, _ = current_session(request)
    with connection() as db:
        return {'profile': profile_for(db, user['id'])}


@router.put('/me/profile')
def save_profile(request: Request, payload: ProfileInput):
    user, token = current_session(request)
    require_csrf(request, token)
    if user['role'] == 'TEAM' and not payload.skills:
        error(422, 'VALIDATION_ERROR', 'Добавьте хотя бы один навык команды')
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('INSERT INTO organization_profiles(user_id,content) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET content=excluded.content',
                   (user['id'], payload.model_dump_json()))
        if user['role'] == 'TEAM':
            db.execute('''INSERT INTO teams(name,interests,skills,technologies,owner_user_id) VALUES(?,?,?,?,?)
                          ON CONFLICT(owner_user_id) DO UPDATE SET name=excluded.name,interests=excluded.interests,
                          skills=excluded.skills,technologies=excluded.technologies''',
                       (payload.name, json.dumps(payload.interests), json.dumps(payload.skills), json.dumps(payload.technologies), user['id']))
        return {'profile': profile_for(db, user['id'])}


def normalize_photo(content):
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(content)) as source:
                if source.format not in ('JPEG', 'PNG', 'WEBP') or source.width * source.height > 16_000_000:
                    raise ValueError('Unsupported image')
                source.load()
                image = ImageOps.exif_transpose(source).convert('RGBA')
                image.thumbnail((768, 768))
                output = io.BytesIO()
                image.save(output, format='WEBP', quality=88)
                return output.getvalue()
    except (ValueError, OSError, UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        error(422, 'VALIDATION_ERROR', 'Выберите корректное фото JPEG, PNG или WebP до 3 МБ и 16 мегапикселей')


@router.post('/me/profile/image')
async def upload_image(request: Request):
    user, token = current_session(request)
    require_csrf(request, token)
    content = await request.body()  # middleware bounds the streamed body before this route
    output = await run_in_threadpool(normalize_photo, content)
    image_id = str(uuid4())
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        old = db.execute('SELECT image_id FROM organization_profiles WHERE user_id=?', (user['id'],)).fetchone()
        db.execute('INSERT INTO profile_images VALUES(?,?)', (image_id, output))
        db.execute('INSERT INTO organization_profiles(user_id,image_id) VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET image_id=excluded.image_id', (user['id'], image_id))
        if old and old['image_id']:
            db.execute('DELETE FROM profile_images WHERE id=?', (old['image_id'],))
        return {'image_url': '/api/profile-images/' + image_id}


@router.delete('/me/profile/image')
def delete_image(request: Request):
    user, token = current_session(request)
    require_csrf(request, token)
    with connection() as db:
        db.execute('BEGIN IMMEDIATE')
        old = db.execute('SELECT image_id FROM organization_profiles WHERE user_id=?', (user['id'],)).fetchone()
        if old and old['image_id']:
            db.execute('DELETE FROM profile_images WHERE id=?', (old['image_id'],))
        db.execute('UPDATE organization_profiles SET image_id=NULL WHERE user_id=?', (user['id'],))
    return {'image_url': ''}


@router.get('/profile-images/{image_id}')
def public_image(image_id: UUID):
    with connection() as db:
        row = db.execute('SELECT content FROM profile_images WHERE id=?', (str(image_id),)).fetchone()
        if not row:
            error(404, 'NOT_FOUND', 'Фото не найдено')
        return Response(bytes(row['content']), media_type='image/webp', headers={'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=3600'})
