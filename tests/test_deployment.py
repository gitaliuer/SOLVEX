import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import libsql
from fastapi.testclient import TestClient
from app.cloud_db import Connection
from app.db import connection, init_db
from app.main import app


class DeploymentTest(unittest.TestCase):
    def test_cloud_driver_rows_blobs_commit_rollback_and_constraint_errors(self):
        with tempfile.TemporaryDirectory() as folder:
            path = str(Path(folder) / 'driver.db')
            db = Connection(libsql.connect(path))
            try:
                db.executescript('CREATE TABLE sample(id INTEGER PRIMARY KEY, name TEXT UNIQUE, photo BLOB);')
                db.execute('BEGIN IMMEDIATE')
                inserted = db.execute('INSERT INTO sample(name,photo) VALUES(?,?)', ('first', b'photo'))
                self.assertEqual(inserted.lastrowid, 1)
                self.assertEqual(inserted.rowcount, 1)
                db.commit()
                row = db.execute('SELECT * FROM sample').fetchone()
                self.assertEqual(row[0], row['id'])
                self.assertEqual(dict(row), {'id': 1, 'name': 'first', 'photo': b'photo'})
                db.execute('BEGIN IMMEDIATE')
                db.execute('UPDATE sample SET name=?', ('not saved',))
                db.rollback()
                self.assertEqual(db.execute('SELECT name FROM sample').fetchone()[0], 'first')
                with self.assertRaises(sqlite3.IntegrityError):
                    db.execute('INSERT INTO sample(name) VALUES(?)', ('first',))
                db.rollback()
                with self.assertRaises(sqlite3.OperationalError):
                    db.executescript('CREATE TABL broken(id INT);')
            finally:
                db.close()

    def test_vercel_requires_remote_storage_and_complete_credentials(self):
        with patch.dict(os.environ, {'VERCEL': '1', 'TURSO_DATABASE_URL': '', 'TURSO_AUTH_TOKEN': ''}):
            with self.assertRaisesRegex(RuntimeError, 'persistent remote'):
                with connection():
                    self.fail('Must not open ephemeral SQLite')
        with patch.dict(os.environ, {'TURSO_DATABASE_URL': 'http://insecure.example', 'TURSO_AUTH_TOKEN': 'test'}):
            with self.assertRaisesRegex(RuntimeError, 'Configure TURSO'):
                with connection():
                    self.fail('Must not transmit credentials without TLS')

    def test_production_disables_demo_preserves_private_api_and_persists(self):
        with tempfile.TemporaryDirectory() as folder:
            env = {'APP_ENV': 'production', 'VERCEL': '', 'DATABASE_PATH': str(Path(folder) / 'production.db'),
                   'TURSO_DATABASE_URL': '', 'TURSO_AUTH_TOKEN': ''}
            with patch.dict(os.environ, env):
                with TestClient(app, base_url='https://solvex.example') as client:
                    self.assertEqual(client.get('/api/health').status_code, 200)
                    self.assertEqual(client.get('/api/catalog/tasks').json()['tasks'], [])
                    for method, route in [('get','/api/tasks'), ('post','/api/tasks'), ('get','/api/teams'),
                                          ('patch','/api/proposals/1'), ('get','/api/business/tasks')]:
                        self.assertEqual(getattr(client, method)(route).status_code, 404)
                    self.assertEqual(client.get('/api/me/tasks').status_code, 401)
                    response = client.post('/api/auth/register', json={'email':'deploy@example.org',
                        'password':'strong-example-password', 'role':'BUSINESS'})
                    self.assertEqual(response.status_code, 201)
                    self.assertIn('Secure', response.headers['set-cookie'])
                    self.assertIn('__Host-solvex_session', response.headers['set-cookie'])
                    self.assertEqual(client.get('/').headers['x-frame-options'], 'DENY')
                init_db()
                with connection() as db:
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0], 1)
                    self.assertEqual(db.execute('SELECT COUNT(*) FROM teams').fetchone()[0], 0)


if __name__ == '__main__':
    unittest.main()
