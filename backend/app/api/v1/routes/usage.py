"""Only authenticated navigation opens with a fixed module identifier."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_member
from app.core.config import settings
from app.db.session import get_db
from app.models.family import Member
from app.schemas.support import UsageOpen
from app.services import usage, ratelimit

router = APIRouter(prefix="/usage", tags=["usage"])


@router.post("/open", status_code=204)
def opened(body: UsageOpen, member: Member = Depends(get_current_member), db: Session = Depends(get_db)) -> None:
    ratelimit.hit(db, "usage_open", str(member.id), limit=settings.rl_usage_open_per_member)
    usage.record(body.module, "open")
