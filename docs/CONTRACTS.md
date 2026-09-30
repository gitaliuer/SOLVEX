# Контракты AI Sana Challenge Hub

Публикация 30.09.2026 по запросу Али: [Vercel и постоянная база](DEPLOYMENT.md). Локальная SQLite сохраняется для разработки; в Vercel обязательна удалённая libSQL база. В production старое синтетическое demo API закрыто, демонстрационные записи не создаются. Форматы личных API и AI не меняются.

Дополнение 30.09.2026 по запросу Али: [качество источников, даты и сопоставление Research](EVIDENCE_QUALITY.md), [тарифы, дневные квоты и граница оплаты](SUBSCRIPTIONS.md). Старые `/api/ai/questions|card` теперь также требуют BUSINESS+CSRF и учитывают лимит аккаунта; прежняя публичность AI в таблице демо ниже больше не действует.

Дополнение: [постоянный AI Agent](AGENT.md) — новый основной сценарий создания задачи.

Дополнение: [подбор команд и личная подборка](MATCHING.md).

Дополнение: [профили компаний и команд, фото, RU/EN и AI-разбор откликов](PROFILES_REVIEW.md).

Дополнение: [проекты и дорожная карта](PROJECTS.md). Первый рабочий слой [Research / Evidence API](RESEARCH_API.md); полное видение и следующие итерации — [RESEARCH_EVIDENCE](RESEARCH_EVIDENCE.md).

Дополнение по поручению Али: [фото задач и личные сообщения](TASK_COLLABORATION.md).

## Версия 2: аккаунты и личные задачи

### Интерфейс и полный цикл, 30.09.2026

`/` — публичный SOLVEX с регистрацией и входом, `/app` — кабинет с восстановлением сессии. BUSINESS управляет своими задачами и решениями; TEAM заполняет свой профиль, читает опубликованные задачи и отправляет свои отклики. Старые демо-записи не выводятся в новом интерфейсе. До публикации карточку видит только владелец; после публикации все поля карточки доступны в новом каталоге (UI предупреждает об этом перед публикацией).

- `GET /api/catalog/tasks[?topic=&level=&q=]`, `GET /api/catalog/tasks/{id}` — только опубликованные задачи с владельцем; поиск по названию и описанию, прежний порядок по готовности.
- `GET /api/catalog/teams` — профили реальных команд, без email пользователей.
- `GET /api/me/team`, `PUT /api/me/team` — только TEAM. Профиль `{name, interests: string[], skills: string[], technologies: string[]}`; один на аккаунт. До заполнения GET возвращает `{team:null}`, сохранение — `{team:Team}`. Владелец и баллы назначаются только сервером.
- `POST /api/catalog/tasks/{id}/proposals` — TEAM + CSRF. Вход как ProposalInput, но без `team_id`: команда определяется по сессии. Нужен заполненный профиль. Один отклик команды на задачу; повтор даёт 409.
- `GET /api/me/proposals` — только отклики своей команды, дополнены `task_title`.
- `GET /api/me/tasks/{id}/proposals` — только владелец задачи. `PATCH /api/me/proposals/{id}` и `POST /api/me/proposals/{id}/milestones/confirm` — только владелец задачи + CSRF. Правила ручного выбора и однократного +10 сохраняются.
- `POST /api/me/ai/questions`, `POST /api/me/ai/card` — BUSINESS + CSRF, существующий AI-контракт. Сам AI-модуль не меняется.

Старые маршруты решений и этапов не обслуживают отклики к личным задачам. Профили команд с владельцем также недоступны для создания отклика через демо API. Авторизация и личные ответы получают `Cache-Control: no-store`.

Маршруты `/api/auth` и `/api/me` используют аккаунты; прежние `/api/tasks`, `/api/business/tasks` и `/api/teams` остаются общим демо только для записей без владельца. Демо-маршруты не могут читать или изменять задачи с владельцем. Новый интерфейс использует защищённый контур и отдельный каталог `/api/catalog`.

`User`: `id` integer, `email` string, `role` `BUSINESS|TEAM`, `created_at` ISO 8601. Пароль никогда не возвращается. Регистрация принимает `{ "email", "password", "role" }`, вход — `{ "email", "password" }`. Успешные регистрация и вход возвращают `{ "user": User, "csrf_token": string }` и устанавливают серверную cookie сессии. `GET /api/auth/me` возвращает тот же объект для действующей сессии. `POST /api/auth/logout` отзывает сессию и очищает cookie. Пароль: 12–128 символов; email приводится к нижнему регистру и проверяется. Повтор email даёт `409 CONFLICT`, неверные реквизиты — `401 UNAUTHORIZED` без указания, что именно неверно.

Сессия хранится в SQLite по хешу случайного токена, имеет срок действия и отзывается при выходе. Cookie `HttpOnly`, `SameSite=Strict`, `Path=/`; при `APP_ENV=production` также `Secure` (требуется HTTPS). `POST` и `PUT` в `/api/me/*`, а также logout требуют `X-CSRF-Token` из ответа `/api/auth/me` или входа. Отсутствующая сессия даёт `401 UNAUTHORIZED`, отсутствующий/неверный CSRF или роль — `403 FORBIDDEN`. После пяти неудачных попыток для пары IP/email либо тридцати для IP за 15 минут вход возвращает `429 RATE_LIMITED`. Ни cookie, ни пароль не записываются в журналы приложения.

| Метод и путь | Вход | Успешный ответ |
| --- | --- | --- |
| `POST /api/auth/register` | `{ "email", "password", "role" }` | HTTP 201, `{ "user", "csrf_token" }` + cookie |
| `POST /api/auth/login` | `{ "email", "password" }` | `{ "user", "csrf_token" }` + cookie |
| `GET /api/auth/me` | cookie | `{ "user", "csrf_token" }` |
| `POST /api/auth/logout` | cookie + CSRF | `{ "status": "ok" }` |
| `GET /api/me/tasks` | BUSINESS cookie | `{ "tasks": [Task, ...] }` только свои |
| `POST /api/me/tasks` | BUSINESS cookie + CSRF, `TaskInput` | HTTP 201, `Task` |
| `GET /api/me/tasks/{id}` | BUSINESS cookie | Свой `Task` |
| `PUT /api/me/tasks/{id}` | BUSINESS cookie + CSRF, `TaskInput` | Свой обновлённый `Task` |
| `POST /api/me/tasks/{id}/publish` | BUSINESS cookie + CSRF, `{}` | Свой опубликованный `Task` |

Новая задача содержит `owner_user_id` только в БД; клиент не может назначить или сменить владельца. При обращении к чужому ID возвращается `404 NOT_FOUND`. Рейтинг, подтверждения и публикация следуют прежним правилам, в том числе публикация при низком рейтинге. Синтетические старые записи остаются без владельца и не присваиваются автоматически новым аккаунтам.

Версия 1. Владелец — Али. Базовый адрес `http://127.0.0.1:8000`, фронтенд работает на том же адресе. UTF-8 JSON, заголовок `Content-Type: application/json`; путь `/static/*` для ресурсов. Все бизнес-поля в `card` — строки. Поля отсутствующих сведений — пустая строка, AI ничего не додумывает.

## Карточка и рейтинг

Поля `card`: `title` (название, до 160), `context`, `need`, `users`, `data`, `constraints`, `expected_result`, `success_criteria`, `contact`, `interaction_format` (каждое до 2000 символов). `topic` — строка до 80 символов, например «Образование». `confirmed_fields` — массив уникальных ключей рейтинга: `context`, `need`, `data`, `expected_result`, `success_criteria`, `constraints`, `users`, `contact`, `interaction_format`. Подтвердить можно только непустое содержательное значение поля. Остальные поля можно оставить пустыми. `title` нужен для публикации, низкий `score` её не блокирует.

Серверная формула: `context` 10, `need` 10, `data` 20, `expected_result` 15, `success_criteria` 15, `constraints` 10, `users` 10, `contact` 5, `interaction_format` 5. Всего 100. Для каждого поля начисляется полный вес, только если оно непустое, не равно «не знаю»/«нет данных» после нормализации и входит в `confirmed_fields`. Иначе ноль. `score_breakdown` показывает числа по всем 9 ключам; `missing_fields` — ключи с нулём. `score` пересчитывается сервером после подтверждённого обновления; перед клиентом не доверять готовому баллу. Уровень `draft` 0–39, `working` 40–69, `ready` 70–89, `priority` 90–100. Это оценка заполненности, не проверка правдивости данных.

## Интерфейс ↔ сервер

Текстовые входы очищаются от внешних пробелов до проверки минимальной длины. `team_id` и `duration_days` — целые JSON-числа; boolean и числовые строки не принимаются. В рейтинге целиком пустые формулировки («не знаю», «нет данных», «неизвестно» и другие перечисленные в `app/scoring.py`) не учитываются независимо от регистра, лишних пробелов и внешней пунктуации. Содержательные отрицательные ограничения сохраняют вес.

Все ошибки: HTTP код + `{ "error": { "code": "VALIDATION_ERROR", "message": "Читаемое объяснение" } }`. Коды: `VALIDATION_ERROR` 422, `NOT_FOUND` 404, `AI_NOT_CONFIGURED` 503, `AI_UNAVAILABLE` 503, `AI_TIMEOUT` 504, `AI_INVALID_OUTPUT` 502, `CONFLICT` 409. JSON-ответы всегда ограничены сервером. Текст черновика 10–6000 символов; HTTP body до 32 KiB. UI показывает загрузку, отключает кнопку на время ожидания, умеет отменить ожидание после 50 секунд, отображает `error.message` и позволяет повторить вручную. Сервер AI ждёт не более 20 секунд на попытку, допускает один повтор только при временной ошибке, суммарно не более 45 секунд. Сервер и фронтенд не записывают секреты.

| Метод и путь | Вход | Успешный ответ |
| --- | --- | --- |
| `GET /api/health` | — | `{ "status": "ok" }` |
| `POST /api/ai/questions` | `{ "draft": "...", "topic": "Ритейл" }` | `{ "questions": [{"id":"q1","field":"data","text":"Какие данные о списаниях доступны?"}, ...] }` (3–5) |
| `POST /api/ai/card` | `{ "draft":"...", "topic":"Ритейл", "answers":[{"question_id":"q1","answer":"..."}] }` | `{ "card": {...все 10 полей...}, "topic":"Ритейл" }` — только черновик без подтверждения |
| `POST /api/tasks` | `{ "topic":"Ритейл", "card":{...}, "confirmed_fields":[] }` | HTTP 201, `Task` |
| `PUT /api/tasks/{id}` | Полная `{ "topic", "card", "confirmed_fields" }` | `Task` с пересчитанным баллом |
| `POST /api/tasks/{id}/publish` | `{}` | `Task` со `status:"published"`; требуется лишь `title` |
| `GET /api/tasks?topic=Ритейл&level=working` | Необязательные фильтры | `{ "tasks": [Task, ...] }`, только опубликованные, `score` по убыванию, затем `id` по возрастанию |
| `GET /api/tasks/{id}` | — | `Task`, если опубликована или открыта бизнесом в демо-режиме |
| `GET /api/teams` | — | `{ "teams": [Team, ...] }` |
| `GET /api/tasks/{id}/proposals` | — | `{ "proposals": [Proposal, ...] }` |
| `POST /api/tasks/{id}/proposals` | `{ "team_id":1, "idea":"...", "plan":"...", "duration_days":14, "prototype_url":"https://example.org/demo" }` | HTTP 201, `Proposal`; отклики не ограничены количеством, ссылка должна быть URL |
| `PATCH /api/proposals/{id}` | `{ "status":"selected" }` либо `{ "status":"rejected" }` | `Proposal`; решения независимы: можно выбрать несколько, ничего не выбирать |
| `POST /api/proposals/{id}/milestones/confirm` | `{}` | `Proposal` с `milestone_confirmed:true`, `points:10`; повторное подтверждение не увеличивает баллы |

`Task`: `id` integer, `topic` string, `card` object, `confirmed_fields` string[], `status` `draft|published`, `score` integer, `level` enum, `score_breakdown` object, `missing_fields` string[], `proposals_count` integer, `created_at` ISO 8601 string. Пример: `{ "id":1, "topic":"Ритейл", "card":{"title":"Сократить списания", "context":"В магазине остаются продукты", "need":"Снизить списания", "users":"Менеджеры", "data":"", "constraints":"", "expected_result":"", "success_criteria":"", "contact":"", "interaction_format":""}, "confirmed_fields":["context","need","users"], "status":"published", "score":30, "level":"draft", "score_breakdown":{"context":10,"need":10,"data":0,"expected_result":0,"success_criteria":0,"constraints":0,"users":10,"contact":0,"interaction_format":0}, "missing_fields":["data","expected_result","success_criteria","constraints","contact","interaction_format"], "proposals_count":0, "created_at":"2026-09-23T13:00:00Z" }`.

`Team`: `id` integer, `name` string, `interests` string[], `skills` string[], `technologies` string[], `points` integer. `Proposal`: `id`, `task_id`, `team_id`, `idea`, `plan`, `duration_days`, `prototype_url`, `status` (`pending|selected|rejected`), `milestone_confirmed` boolean, `points` integer, `created_at` ISO string. `idea` и `plan` — 10–2000 символов; `duration_days` — 1–365. Без регистрации открытый демо-режим явно описывается в README. Отображать пользовательский текст безопасно через `textContent`, не HTML-разметку.

## Возврат к сохранённой задаче, дополнение 23.09.2026

`GET /api/business/tasks` возвращает `{ "tasks": [Task, ...] }` со всеми сохранёнными черновиками и публикациями, по `id` по убыванию. Необязательный `status=draft|published` фильтрует статус; неизвестное значение даёт 422. Это общий список явного демо-режима, не личный кабинет с авторизацией. Публичный `GET /api/tasks` по-прежнему отдаёт только опубликованные задачи, сортируя по рейтингу.

Для продолжения UI получает `GET /api/tasks/{id}`, восстанавливает `topic`, `card`, `confirmed_fields`, `status`, серверный рейтинг и текущий `taskId`. Следующее сохранение — `PUT /api/tasks/{id}`; новая задача не создаётся. Сам список не восстанавливает несохранённый текст вкладки. После загрузки редактора пользовательские изменения должны снова снимать подтверждение только изменённого поля.

## Сервер ↔ AI

Модуль Тимура: `app/ai/service.py`. Обязательные асинхронные функции: `async generate_questions(draft: str, topic: str) -> list[dict[str,str]]` и `async build_card(draft: str, topic: str, answers: list[dict[str,str]]) -> dict[str,str]`. Первая возвращает 3–5 объектов строго с ключами `id`, `field`, `text`; `field` — один из 9 ключей рейтинга. Вторая возвращает все 10 ключей `card`, без `score`, `confirmed_fields`, `status` и `id`. `topic` формируется сервером из запроса; AI не меняет его самовольно. Али валидирует длину запроса до вызова и результат после, Тимур валидирует ответ модели и обрабатывает отказ. Любые факты вне черновика/ответов должны отсутствовать; неизвестное — `""`. Текст пользователя — данные, не инструкции для модели.

AI код читает `OPENAI_API_KEY`, `OPENAI_MODEL` только на сервере. Плановый `OPENAI_MODEL=gpt-4.1-mini-2025-04-14`, реальную доступность подтверждает Тимур. OpenAI SDK использует структурированный JSON по схеме, без лишних ключей. Срок 20 секунд на попытку, не более одного повтора временных сбоев; суммарно до 45 секунд. Содержательные ошибки: `AI_NOT_CONFIGURED`, `AI_UNAVAILABLE`, `AI_TIMEOUT`, `AI_INVALID_OUTPUT` (исключения модуля с `code` и безопасным сообщением; конкретное имя класса согласовать с Али до правок маршрута). При отсутствии ключа HTTP 503, заглушка запрещена без явного режима и метки демо. После смены модели формат функции и HTTP остаётся прежним.

Пример: черновик «В магазине много списаний. Хотим их сократить.» → вопросы о доступных данных, пользователях и признаке успеха. Нельзя объявлять конкретный срок, цифру сокращения или источник данных без ответа бизнеса. Затем бизнес видит черновик карточки, редактирует и подтверждает его. Оценка и публикация — исключительно серверные действия.
