import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class AuthTest(unittest.TestCase):
    def test_registration_session_logout_and_validation(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "auth.db")}, clear=False):
                with TestClient(app) as client:
                    payload = {"email": "  BUSINESS@Example.org  ",
                               "password": "a-long-test-password", "role": "BUSINESS"}
                    registered = client.post("/api/auth/register", json=payload)
                    self.assertEqual(registered.status_code, 201, registered.text)
                    self.assertEqual(registered.json()["user"]["email"], "business@example.org")
                    self.assertNotIn("password", registered.text)
                    self.assertIn("httponly", registered.headers["set-cookie"].lower())
                    self.assertIn("samesite=strict", registered.headers["set-cookie"].lower())
                    self.assertEqual(client.get("/api/auth/me").json(), registered.json())
                    self.assertEqual(client.post("/api/auth/register", json=payload).status_code, 409)
                    self.assertEqual(client.post("/api/auth/login", json={"email": payload["email"],
                                      "password": "wrong-password"}).status_code, 401)
                    self.assertEqual(client.post("/api/auth/logout").status_code, 403)
                    self.assertEqual(client.post("/api/auth/logout", headers={
                        "X-CSRF-Token": registered.json()["csrf_token"]}).status_code, 200)
                    self.assertEqual(client.get("/api/auth/me").status_code, 401)
                    logged_in = client.post("/api/auth/login", json={
                        "email": "business@example.org", "password": payload["password"]})
                    self.assertEqual(logged_in.status_code, 200, logged_in.text)
                    self.assertEqual(logged_in.json()["user"]["id"], registered.json()["user"]["id"])
                with closing(sqlite3.connect(Path(directory) / "auth.db")) as db:
                    password_hash = db.execute("SELECT password_hash FROM users").fetchone()[0]
                    self.assertTrue(password_hash.startswith("$argon2id$"))
                    self.assertNotIn(payload["password"], password_hash)

    def test_owned_tasks_are_isolated_from_other_users_and_demo(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "tasks.db")}, clear=False):
                with TestClient(app) as alice, TestClient(app) as bob, TestClient(app) as team:
                    alice_auth = alice.post("/api/auth/register", json={
                        "email": "alice@example.org", "password": "alice-test-password", "role": "BUSINESS"}).json()
                    bob_auth = bob.post("/api/auth/register", json={
                        "email": "bob@example.org", "password": "another-test-password", "role": "BUSINESS"}).json()
                    team.post("/api/auth/register", json={
                        "email": "team@example.org", "password": "another-test-password", "role": "TEAM"})
                    card = {"title": "Задача Алисы", "context": "Изучить списания"}
                    task = {"topic": "Ритейл", "card": card, "confirmed_fields": []}
                    self.assertEqual(alice.post("/api/me/tasks", json=task).status_code, 403)
                    created = alice.post("/api/me/tasks", json=task,
                                         headers={"X-CSRF-Token": alice_auth["csrf_token"]})
                    self.assertEqual(created.status_code, 201, created.text)
                    task_id = created.json()["id"]
                    self.assertEqual(created.json()["score"], 0)
                    self.assertEqual(len(alice.get("/api/me/tasks").json()["tasks"]), 1)
                    self.assertEqual(bob.get("/api/me/tasks").json()["tasks"], [])
                    self.assertEqual(bob.get(f"/api/me/tasks/{task_id}").status_code, 404)
                    self.assertEqual(bob.put(f"/api/me/tasks/{task_id}", json=task,
                        headers={"X-CSRF-Token": bob_auth["csrf_token"]}).status_code, 404)
                    self.assertEqual(team.get("/api/me/tasks").status_code, 403)
                    self.assertEqual(alice.get(f"/api/tasks/{task_id}").status_code, 404)
                    self.assertEqual(alice.put(f"/api/tasks/{task_id}", json=task).status_code, 404)
                    self.assertEqual(alice.post(f"/api/tasks/{task_id}/publish", json={}).status_code, 404)
                    self.assertNotIn(task_id, [item["id"] for item in alice.get("/api/tasks").json()["tasks"]])
                    self.assertNotIn(task_id, [item["id"] for item in alice.get("/api/business/tasks").json()["tasks"]])
                    published = alice.post(f"/api/me/tasks/{task_id}/publish", json={},
                                           headers={"X-CSRF-Token": alice_auth["csrf_token"]})
                    self.assertEqual(published.status_code, 200, published.text)
                    self.assertEqual(published.json()["status"], "published")
                    self.assertEqual(published.json()["score"], 0)
                    self.assertEqual(alice.get(f"/api/me/tasks/{task_id}").json()["id"], task_id)

    def test_existing_database_gets_owner_column_without_claiming_demo(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "legacy.db"
            with closing(sqlite3.connect(path)) as db:
                db.execute("""CREATE TABLE tasks(id INTEGER PRIMARY KEY, topic TEXT NOT NULL,
                           card TEXT NOT NULL, confirmed_fields TEXT NOT NULL,
                           status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL)""")
            with patch.dict(os.environ, {"DATABASE_PATH": str(path)}, clear=False):
                with TestClient(app) as client:
                    self.assertEqual(len(client.get("/api/tasks").json()["tasks"]), 5)
                    self.assertEqual(client.get("/api/auth/me").status_code, 401)
                with closing(sqlite3.connect(path)) as db:
                    columns = {row[1] for row in db.execute("PRAGMA table_info(tasks)")}
                    self.assertIn("owner_user_id", columns)
                    self.assertEqual(db.execute("SELECT COUNT(*) FROM tasks WHERE owner_user_id IS NULL")
                                     .fetchone()[0], 5)

    def test_login_attempt_limit_and_expired_session(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "security.db"
            with patch.dict(os.environ, {"DATABASE_PATH": str(path)}, clear=False):
                with TestClient(app) as client:
                    credentials = {"email": "rate@example.org", "password": "correct-test-password"}
                    registered = client.post("/api/auth/register", json={
                        **credentials, "role": "BUSINESS"})
                    self.assertEqual(registered.status_code, 201, registered.text)
                    for _ in range(5):
                        failed = client.post("/api/auth/login", json={
                            **credentials, "password": "wrong-test-password"})
                        self.assertEqual(failed.status_code, 401, failed.text)
                    blocked = client.post("/api/auth/login", json=credentials)
                    self.assertEqual(blocked.status_code, 429, blocked.text)

                    with closing(sqlite3.connect(path)) as db:
                        db.execute("UPDATE sessions SET expires_at=?", ("2000-01-01T00:00:00+00:00",))
                        db.commit()
                    self.assertEqual(client.get("/api/auth/me").status_code, 401)


if __name__ == "__main__":
    unittest.main()
