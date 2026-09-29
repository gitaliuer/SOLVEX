import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import app


class CommunityTest(unittest.TestCase):
    def test_published_flow_and_ownership_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {"DATABASE_PATH": str(Path(directory) / "flow.db")}):
                with TestClient(app) as owner, TestClient(app) as other, TestClient(app) as team, TestClient(app) as guest:
                    def register(client, email, role):
                        response = client.post("/api/auth/register", json={
                            "email": email, "password": "long-test-password", "role": role})
                        self.assertEqual(response.status_code, 201, response.text)
                        return {"X-CSRF-Token": response.json()["csrf_token"]}

                    owner_csrf = register(owner, "owner@example.org", "BUSINESS")
                    other_csrf = register(other, "other@example.org", "BUSINESS")
                    team_csrf = register(team, "team@example.org", "TEAM")
                    self.assertEqual(guest.get("/app", follow_redirects=False).status_code, 303)
                    self.assertEqual(owner.get("/app").status_code, 200)
                    self.assertEqual(owner.get("/api/auth/me").headers["cache-control"], "no-store")
                    self.assertEqual(guest.get("/api/catalog/tasks").json(), {"tasks": []})
                    task = owner.post("/api/me/tasks", headers=owner_csrf, json={
                        "topic": "Экология", "card": {"title": "Снизить списания"}, "confirmed_fields": []}).json()
                    task_id = task["id"]
                    self.assertEqual(guest.get(f"/api/catalog/tasks/{task_id}").status_code, 404)
                    self.assertEqual(guest.get("/api/me/tasks").status_code, 401)
                    self.assertEqual(other.post(f"/api/me/tasks/{task_id}/publish", headers=other_csrf).status_code, 404)
                    self.assertEqual(owner.post(f"/api/me/tasks/{task_id}/publish", headers=owner_csrf).status_code, 200)
                    self.assertEqual(guest.get("/api/catalog/tasks?q=СПИСАНИЯ").json()["tasks"][0]["score"], 0)
                    self.assertEqual(guest.get("/api/catalog/tasks?q=несовпадение").json()["tasks"], [])
                    self.assertEqual(guest.get(f"/api/tasks/{task_id}").status_code, 404)

                    profile = {"name": "Команда тестирования", "skills": ["Аналитика"], "interests": [], "technologies": ["Python"]}
                    self.assertIsNone(team.get("/api/me/team").json()["team"])
                    self.assertEqual(owner.put("/api/me/team", headers=owner_csrf, json=profile).status_code, 403)
                    self.assertEqual(team.put("/api/me/team", json=profile).status_code, 403)
                    saved_team = team.put("/api/me/team", headers=team_csrf, json=profile).json()["team"]
                    profile["name"] = "Обновлённая команда"
                    self.assertEqual(team.put("/api/me/team", headers=team_csrf, json=profile).json()["team"]["id"], saved_team["id"])
                    self.assertNotIn("owner_user_id", saved_team)
                    self.assertEqual(len(guest.get("/api/catalog/teams").json()["teams"]), 1)
                    proposal = {"idea": "Исследовать причины списаний", "plan": "Собрать данные и изучить закономерности",
                                "duration_days": 14, "prototype_url": "https://example.org/test"}
                    endpoint = f"/api/catalog/tasks/{task_id}/proposals"
                    self.assertEqual(team.post(endpoint, json=proposal).status_code, 403)
                    self.assertEqual(team.post(endpoint, headers=team_csrf, json={**proposal, "team_id": 1}).status_code, 422)
                    self.assertEqual(owner.post(endpoint, headers=owner_csrf, json=proposal).status_code, 403)
                    response = team.post(endpoint, headers=team_csrf, json=proposal)
                    self.assertEqual(response.status_code, 201, response.text)
                    pid = response.json()["id"]
                    self.assertEqual(team.post(endpoint, headers=team_csrf, json=proposal).status_code, 409)
                    self.assertEqual(team.get("/api/me/proposals").json()["proposals"][0]["task_title"], "Снизить списания")
                    self.assertEqual(other.get(f"/api/me/tasks/{task_id}/proposals").status_code, 404)
                    self.assertEqual(team.get(f"/api/me/tasks/{task_id}/proposals").status_code, 403)
                    self.assertEqual(len(owner.get(f"/api/me/tasks/{task_id}/proposals").json()["proposals"]), 1)
                    self.assertEqual(other.patch(f"/api/me/proposals/{pid}", headers=other_csrf,
                                                json={"status": "selected"}).status_code, 404)
                    self.assertEqual(guest.patch(f"/api/proposals/{pid}", json={"status": "selected"}).status_code, 404)
                    self.assertEqual(guest.post(f"/api/proposals/{pid}/milestones/confirm").status_code, 404)
                    self.assertEqual(guest.post("/api/tasks/1/proposals", json={
                        **proposal, "team_id": saved_team["id"]}).status_code, 404)
                    owner.patch(f"/api/me/proposals/{pid}", headers=owner_csrf, json={"status": "selected"})
                    for _ in range(2):
                        confirmed = owner.post(f"/api/me/proposals/{pid}/milestones/confirm", headers=owner_csrf)
                        self.assertEqual(confirmed.status_code, 200, confirmed.text)
                    self.assertEqual(team.get("/api/me/team").json()["team"]["points"], 10)
                    self.assertEqual(owner.patch(f"/api/me/proposals/{pid}", headers=owner_csrf,
                                                json={"status": "rejected"}).status_code, 409)
                    self.assertEqual(guest.post("/api/me/ai/questions", json={"draft": "Длинное описание проблемы",
                                                                            "topic": "Тест"}).status_code, 401)


if __name__ == "__main__":
    unittest.main()
