"""Database fixtures. Tests that use them need the database from docker compose (see README).

Each test runs inside a transaction that is rolled back, so stored data is untouched.
"""
from collections.abc import Iterator

import pytest
from sqlalchemy import Connection
from sqlalchemy.orm import Session, sessionmaker

from app.db import engine


@pytest.fixture
def connection() -> Iterator[Connection]:
    with engine.connect() as conn:
        transaction = conn.begin()
        yield conn
        transaction.rollback()


@pytest.fixture
def session_factory(connection: Connection) -> sessionmaker[Session]:
    # Commits inside the code under test become savepoints, so the outer rollback still undoes them.
    return sessionmaker(bind=connection, join_transaction_mode="create_savepoint", expire_on_commit=False)


@pytest.fixture
def session(session_factory: sessionmaker[Session]) -> Iterator[Session]:
    with session_factory() as db_session:
        yield db_session
