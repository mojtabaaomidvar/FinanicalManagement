"""Real PostgreSQL notifications, independent workers and tenant/session boundaries."""
import asyncio
from types import SimpleNamespace

import pytest
from sqlalchemy import text

from app.core.errors import AppError
from tests.test_shopping import new_stock


def test_stream_requires_bearer_and_rejects_client_selected_family(client, home_a):
    assert client.get('/api/v1/household/changes').status_code == 401
    assert client.get('/api/v1/household/changes', headers={'Authorization':'Bearer invalid'}).status_code == 401
    assert client.get('/api/v1/household/changes?family_id=other', headers=home_a.h).status_code == 422


def test_committed_changes_reach_independent_workers_but_not_other_households(client, home_a, home_b, database):
    from app.services.household_changes import HouseholdChanges

    async def exercise():
        first, second = HouseholdChanges(), HouseholdChanges()
        try:
            async with first.subscribe(__import__('uuid').UUID(home_a.family_id)) as own, \
                       second.subscribe(__import__('uuid').UUID(home_a.family_id)) as other_worker, \
                       first.subscribe(__import__('uuid').UUID(home_b.family_id)) as unrelated:
                stock = await asyncio.to_thread(new_stock, client, home_a, title='Private stock', quantity=2)
                assert await asyncio.wait_for(own.get(), 3) is True
                assert await asyncio.wait_for(other_worker.get(), 3) is True
                assert unrelated.empty()
                # Nothing is published for aborted writes or metadata-only no-ops.
                with database.connect() as connection:
                    transaction = connection.begin()
                    connection.execute(text('UPDATE inventory_items SET quantity=7 WHERE id=:id'), {'id':stock['id']})
                    transaction.rollback()
                with database.begin() as connection:
                    connection.execute(text('UPDATE inventory_items SET updated_at=now() WHERE id=:id'), {'id':stock['id']})
                with pytest.raises(TimeoutError):
                    await asyncio.wait_for(own.get(), .2)
                with database.begin() as connection:
                    connection.execute(text('DELETE FROM inventory_items WHERE id=:id'), {'id':stock['id']})
                assert await asyncio.wait_for(own.get(), 3) is True
                assert await asyncio.wait_for(other_worker.get(), 3) is True
                assert unrelated.empty()
        finally:
            await first.close()
            await second.close()
        assert first.subscribers == second.subscribers == {}

    asyncio.run(exercise())


def test_stream_contains_no_household_content_and_stops_when_membership_revoked(client, home_a, database):
    from app.api.v1.routes.household_changes import changes
    from app.services.household_changes import HouseholdChanges

    async def exercise():
        hub = HouseholdChanges()
        async def connected():
            return False
        request = SimpleNamespace(query_params={}, app=SimpleNamespace(state=SimpleNamespace(household_changes=hub)),
                                  is_disconnected=connected)
        try:
            response = await changes(request, home_a.token)
            assert response.headers['cache-control'] == 'no-store'
            assert response.headers['x-accel-buffering'] == 'no'
            stream = response.body_iterator
            assert await anext(stream) == 'event: ready\ndata: {}\n\n'
            await asyncio.to_thread(new_stock, client, home_a, title='Never transmitted', note='Private note', quantity=3)
            assert await asyncio.wait_for(anext(stream), 3) == 'event: invalidate\ndata: {}\n\n'
            with database.begin() as connection:
                connection.execute(text("UPDATE members SET membership_state='suspended' WHERE id=:id"), {'id':home_a.member_id})
            with pytest.raises(StopAsyncIteration):
                await asyncio.wait_for(anext(stream), 3)
            assert hub.subscribers == {}
            with pytest.raises(AppError):
                await changes(request, home_a.token)
        finally:
            await hub.close()

    asyncio.run(exercise())
