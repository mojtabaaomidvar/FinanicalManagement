"""Authenticated contextual reports and separately confirmed, receipted actions."""

import json
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.assistant import (
    AssistantAnalyzeIn,
    ContextAnalyzeIn,
    ExecuteActionIn,
    PrepareActionIn,
)
from app.services import assistant_actions, contextual_assistant, household_assistant

router = APIRouter(prefix="/assistant")
TenantMember = Annotated[Member, Depends(get_tenant_member)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get("/capabilities")
def capabilities(response: Response, member: TenantMember):
    response.headers["Cache-Control"] = "no-store"
    return household_assistant.capabilities()


@router.post("/analyze")
def analyze(body: AssistantAnalyzeIn, member: TenantMember, db: DbSession):
    result = household_assistant.analyze(db, member, body.text, body.scope)
    return Response(
        json.dumps(result, ensure_ascii=False, default=str), media_type="application/json",
        headers={"Cache-Control": "no-store", "Pragma": "no-cache"},
    )


def private_response(value):
    return Response(json.dumps(value, ensure_ascii=False, default=str),
                    media_type="application/json",
                    headers={"Cache-Control": "no-store", "Pragma": "no-cache"})


@router.post("/report")
def report(body: ContextAnalyzeIn, member: TenantMember, db: DbSession):
    return private_response(contextual_assistant.analyze(db, member, body.text))


@router.post("/prepare-action")
def prepare_action(body: PrepareActionIn, member: TenantMember, db: DbSession):
    return private_response(assistant_actions.prepare(db, member, body))


@router.post("/execute")
def execute_action(body: ExecuteActionIn, member: TenantMember, db: DbSession):
    return private_response(assistant_actions.execute(db, member, body.review_token))


@router.get("/receipt/{operation_id}")
def action_receipt(operation_id: UUID, member: TenantMember, db: DbSession):
    return private_response(assistant_actions.receipt(db, member, operation_id))
