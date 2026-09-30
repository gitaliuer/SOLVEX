from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi import Request, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.db import init_db
from app.routes.api import router
from app.routes.auth import router as auth_router
from app.routes.me import router as me_router
from app.routes.community import router as community_router
from app.routes.agent import router as agent_router
from app.routes.matching import router as matching_router
from app.routes.profiles import router as profiles_router
from app.routes.reviews import router as reviews_router
from app.routes.auth import current_session

ROOT = Path(__file__).resolve().parent.parent
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="AI Sana Challenge Hub", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=ROOT / "web"), name="static")
app.include_router(router)
app.include_router(auth_router)
app.include_router(me_router)
app.include_router(community_router)
app.include_router(agent_router)
app.include_router(matching_router)
app.include_router(profiles_router)
app.include_router(reviews_router)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
    return JSONResponse({"error": detail}, status_code=exc.status_code)


@app.exception_handler(RequestValidationError)
async def input_error(request: Request, exc: RequestValidationError):
    return JSONResponse({"error": {"code": "VALIDATION_ERROR", "message": "Проверьте заполнение и формат полей"}}, status_code=422)


@app.middleware("http")
async def input_limit(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH"):
        limit = 3 * 1024 * 1024 if request.url.path == '/api/me/profile/image' and request.method == 'POST' else 32 * 1024
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > limit:
                return JSONResponse({'error': {'code': 'VALIDATION_ERROR', 'message': 'Фото превышает 3 МБ' if limit > 32768 else 'Запрос превышает 32 КБ'}}, status_code=413)
            body.extend(chunk)
        request._body = bytes(body)
    response = await call_next(request)
    if request.url.path.startswith(("/api/auth/", "/api/me/")) or request.url.path == "/app":
        response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/")
def index():
    return FileResponse(ROOT / "web" / "index.html")


@app.get("/app")
def workspace(request: Request):
    try:
        current_session(request)
    except HTTPException as exc:
        if exc.status_code != 401:
            raise
        return RedirectResponse("/?auth=login", status_code=303)
    return FileResponse(ROOT / "web" / "workspace.html")
