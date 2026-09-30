"""Small DB-API compatibility layer for remote-only libSQL connections.

No local replicas: accounts, quotas and transactions share one durable primary.
The native driver does not implement sqlite3.Row and reports SQL errors as
ValueError; normalize these at the boundary rather than changing route logic.
"""
import sqlite3
import time
import weakref


class Row:
    def __init__(self, columns, values):
        self._columns = columns
        self._values = values

    def keys(self):
        return list(self._columns)

    def __getitem__(self, key):
        if isinstance(key, str):
            try:
                key = self._columns.index(key)
            except ValueError:
                raise IndexError('No such column') from None
        return self._values[key]

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)


def checked(fn, *args):
    try:
        return fn(*args)
    except ValueError as exc:
        # Do not expose driver errors: they can include SQL or connection URLs.
        message = str(exc).lower()
        integrity = ('constraint failed', 'sqlite_constraint', 'constraint violation')
        if any(marker in message for marker in integrity):
            raise sqlite3.IntegrityError('Database constraint failed') from None
        if 'database is locked' in message or 'sqlite_busy' in message:
            raise sqlite3.OperationalError('database is locked') from None
        raise sqlite3.OperationalError('Cloud database operation failed') from None


class Cursor:
    def __init__(self, cursor):
        self._cursor = cursor
        self._columns = tuple(item[0] for item in (cursor.description or ()))
        self.lastrowid = cursor.lastrowid
        self.rowcount = cursor.rowcount

    def fetchone(self):
        value = checked(self._cursor.fetchone)
        return None if value is None else Row(self._columns, value)

    def fetchall(self):
        return [Row(self._columns, item) for item in checked(self._cursor.fetchall)]

    def close(self):
        if self._cursor is not None:
            checked(self._cursor.close)
            self._cursor = None

    def __iter__(self):
        while (row := self.fetchone()) is not None:
            yield row


class Connection:
    def __init__(self, driver):
        self._driver = driver
        self._cursors = weakref.WeakSet()

    def execute(self, sql, parameters=()):
        deadline = time.monotonic() + 10
        while True:
            try:
                cursor = Cursor(checked(self._driver.execute, sql, tuple(parameters)))
                self._cursors.add(cursor)
                return cursor
            except sqlite3.OperationalError as exc:
                # Only retry failure to acquire a transaction, never a write
                # whose commit status might be unknown after a network error.
                if sql.strip().upper() != 'BEGIN IMMEDIATE' or str(exc) != 'database is locked' or time.monotonic() >= deadline:
                    raise
                time.sleep(0.05)

    def executemany(self, sql, parameters):
        cursor = None
        for values in parameters:
            cursor = self.execute(sql, values)
        return cursor

    def executescript(self, sql):
        # libsql 0.1.11 executescript can discard errors; execute complete
        # statements explicitly and propagate every failure instead.
        self.commit()
        statement = ''
        for character in sql:
            statement += character
            if character == ';' and sqlite3.complete_statement(statement):
                self.execute(statement)
                statement = ''
        if statement.strip():
            self.execute(statement)
        self.commit()

    def commit(self):
        checked(self._driver.commit)

    def rollback(self):
        checked(self._driver.rollback)

    def close(self):
        for cursor in list(self._cursors):
            cursor.close()
        if self._driver is not None:
            checked(self._driver.close)
            self._driver = None


def connect(url, token):
    import libsql
    return Connection(checked(lambda: libsql.connect(url, auth_token=token, timeout=0.1)))
