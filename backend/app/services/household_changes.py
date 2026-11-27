"""One PostgreSQL listener per API process; only opaque invalidations leave it."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import threading
import uuid

import psycopg
from sqlalchemy.engine import make_url

from app.core.config import settings
from app.core.errors import AppError
from app.db.session import SessionLocal
from app.models.family import Member
from app.services import sessions


def authorize(raw_token: str) -> tuple[uuid.UUID, uuid.UUID]:
    # Never hold a SQLAlchemy request transaction/pool slot for a live stream.
    with SessionLocal() as db:
        member_id = sessions.resolve_member_id(db, raw_token)
        member = db.get(Member, member_id)
        if member is None or member.membership_state != 'active' or member.status != 'active':
            raise AppError('MEMBERSHIP_INACTIVE', 'عضویت شما در خانواده فعال نیست.', 403)
        return member.id, member.family_id


class HouseholdChanges:
    def __init__(self):
        self.subscribers: dict[uuid.UUID, set[asyncio.Queue]] = {}
        self.ready = asyncio.Event()
        self.stop = threading.Event()
        self.thread: threading.Thread | None = None
        self.loop: asyncio.AbstractEventLoop | None = None

    def _deliver(self, family: uuid.UUID | None):
        queues = (queue for values in self.subscribers.values() for queue in values) if family is None else self.subscribers.get(family, ())
        for queue in queues:
            if queue.full():
                if family is not None:
                    continue
                queue.get_nowait()
            queue.put_nowait(family is not None)

    def _schedule(self, callback, *args):
        if self.loop is not None and not self.loop.is_closed():
            self.loop.call_soon_threadsafe(callback, *args)

    def _listen(self):
        url = make_url(settings.database_url)
        options = {'dbname':url.database, 'user':url.username, 'password':url.password,
                   'host':url.host, 'port':url.port, **url.query, 'connect_timeout':5,
                   'application_name':'khaneyar-household-listener'}
        options = {key:value for key, value in options.items() if value is not None}
        while not self.stop.is_set():
            try:
                with psycopg.connect(**options, autocommit=True) as connection:
                    connection.execute('LISTEN khaneyar_household')
                    self._schedule(self.ready.set)
                    while not self.stop.is_set():
                        for notification in connection.notifies(timeout=1, stop_after=1):
                            try:
                                family = uuid.UUID(notification.payload)
                            except (ValueError, TypeError):
                                continue
                            self._schedule(self._deliver, family)
            except psycopg.Error:
                self._schedule(self.ready.clear)
                self._schedule(self._deliver, None)
                self.stop.wait(2)

    @asynccontextmanager
    async def subscribe(self, family: uuid.UUID):
        if self.thread is None:
            self.loop = asyncio.get_running_loop()
            self.thread = threading.Thread(target=self._listen, name='household-changes', daemon=True)
            self.thread.start()
        queue: asyncio.Queue[bool] = asyncio.Queue(maxsize=1)
        self.subscribers.setdefault(family, set()).add(queue)
        try:
            try:
                await asyncio.wait_for(self.ready.wait(), timeout=6)
            except TimeoutError:
                raise AppError('UNAVAILABLE', 'ارتباط موقتاً در دسترس نیست.', 503) from None
            yield queue
        finally:
            self.subscribers[family].discard(queue)
            if not self.subscribers[family]:
                del self.subscribers[family]

    async def close(self):
        self.stop.set()
        self._deliver(None)
        if self.thread is not None:
            await asyncio.to_thread(self.thread.join, 7)
