"""Bearer-authenticated household stream with no record data in events."""
import asyncio
import time

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_bearer_token
from app.core.errors import AppError
from app.services.household_changes import authorize

router = APIRouter(tags=['household'])


@router.get('/household/changes')
async def changes(request: Request, token: str = Depends(get_bearer_token)):
    if request.query_params:
        raise AppError('INVALID_INPUT', 'اطلاعات ارسالی معتبر نیست.', 422)
    principal = await run_in_threadpool(authorize, token)
    hub = request.app.state.household_changes

    async def events():
        async with hub.subscribe(principal[1]) as queue:
            # A fresh snapshot on every connection closes the missed-event gap.
            yield 'event: ready\ndata: {}\n\n'
            deadline = time.monotonic() + 50
            while time.monotonic() < deadline and not await request.is_disconnected():
                try:
                    changed = await asyncio.wait_for(queue.get(), timeout=12)
                except TimeoutError:
                    changed = None
                try:
                    if await run_in_threadpool(authorize, token) != principal:
                        break
                except AppError:
                    break
                if changed is False:
                    break
                yield 'event: invalidate\ndata: {}\n\n' if changed else ': keepalive\n\n'

    return StreamingResponse(events(), media_type='text/event-stream', headers={
        'Cache-Control':'no-store', 'Pragma':'no-cache', 'X-Accel-Buffering':'no',
    })
