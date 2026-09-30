"""Run route regressions against the real libSQL driver on disposable files.

This checks SQL/transaction compatibility, not remote credentials or networking.
Run: python -m tests.check_libsql_suite
"""
import sqlite3
import types
import unittest
from unittest.mock import patch
import libsql
from app.cloud_db import Connection


def driver_connect(path, timeout=10):
    return Connection(libsql.connect(str(path), timeout=0.1))


if __name__ == '__main__':
    suite = unittest.defaultTestLoader.discover('tests')
    shim = types.SimpleNamespace(connect=driver_connect, Row=sqlite3.Row, Connection=sqlite3.Connection)
    with patch('app.db.sqlite3', shim):
        result = unittest.TextTestRunner(verbosity=1).run(suite)
    raise SystemExit(not result.wasSuccessful())
