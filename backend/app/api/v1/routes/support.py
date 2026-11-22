"""Dedicated support cookie; never family administrator authorization."""

from collections.abc import Iterator
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import SessionLocal, get_db
from app.core.errors import AppError
from app.schemas.support import (SupportLogin, SupportOverview, SupportSessionOut,
                                 SupportTechnical, SupportUsers, SupportUsage)
from app.services import support, usage
from app.services import inventory_catalog
from app.schemas.inventory_catalog import CatalogProposals, CatalogProposalOut, CatalogReview

router = APIRouter(prefix="/support", tags=["support"])


def require_operator(request: Request, db: Session = Depends(get_db)) -> None:
    support.require_session(db, request)


def read_only_db(_operator: None = Depends(require_operator)) -> Iterator[Session]:
    with SessionLocal() as db:
        db.execute(text("SET TRANSACTION READ ONLY"))
        yield db


@router.get("/session", response_model=SupportSessionOut)
def session(request: Request, db: Session = Depends(get_db)) -> SupportSessionOut:
    support.require_enabled()
    support.require_origin(request, allow_absent=True)
    return SupportSessionOut(authenticated=support.authenticated(db, request))


@router.post("/login", response_model=SupportSessionOut)
def login(request: Request, response: Response, body: SupportLogin,
          db: Session = Depends(get_db)) -> SupportSessionOut:
    token = support.login(db, request, body.username, body.password)
    response.set_cookie(support.COOKIE_NAME, token, max_age=support.SESSION_SECONDS,
        httponly=True, secure=support.settings.is_production, samesite="strict", path=support.COOKIE_PATH)
    return SupportSessionOut(authenticated=True)


@router.post("/logout", status_code=204)
def logout(request: Request, db: Session = Depends(get_db)) -> Response:
    support.logout(db, request)
    response = Response(status_code=204)
    response.delete_cookie(support.COOKIE_NAME, path=support.COOKIE_PATH,
        secure=support.settings.is_production, httponly=True, samesite="strict")
    return response


@router.get("/users", response_model=SupportUsers)
def users(code: str = Query(default="", max_length=64),
          membership: Literal["all","pending","active","rejected","expired","suspended","removed"] = "all",
          registration: Literal["all","registered","introduced","managed"] = "all",
          offset: int = Query(default=0, ge=0, le=1000000), limit: int = Query(default=25, ge=1, le=50),
          db: Session = Depends(read_only_db)) -> SupportUsers:
    return support.list_users(db, code=code, membership=membership, registration=registration,
                              offset=offset, limit=limit)


@router.get("/overview", response_model=SupportOverview)
def overview(days: int = Query(default=7, ge=7, le=30), db: Session = Depends(read_only_db)) -> SupportOverview:
    if days not in (7,30):
        raise AppError("INVALID_INPUT", "بازهٔ آمار معتبر نیست.", 422)
    return support.overview(db, days)


@router.get("/technical", response_model=SupportTechnical)
def technical(db: Session = Depends(read_only_db)) -> SupportTechnical:
    return support.technical(db)


@router.get("/usage", response_model=SupportUsage)
def usage_report(days: int = Query(default=7, ge=7, le=30), db: Session = Depends(read_only_db)) -> SupportUsage:
    if days not in (7, 30):
        raise AppError("INVALID_INPUT", "بازهٔ آمار معتبر نیست.", 422)
    return usage.report(db, days)


@router.get("/catalog", response_model=CatalogProposals)
def catalog_proposals(status: Literal["all", "pending", "approved", "rejected"] = "pending",
                      offset: int = Query(default=0, ge=0, le=1000000),
                      limit: int = Query(default=25, ge=1, le=50),
                      db: Session = Depends(read_only_db)) -> CatalogProposals:
    return inventory_catalog.list_proposals(db, status, offset, limit)


@router.post("/catalog/review", response_model=CatalogProposalOut)
def review_catalog(request: Request, body: CatalogReview,
                   _operator: None = Depends(require_operator),
                   db: Session = Depends(get_db)) -> CatalogProposalOut:
    support.require_origin(request)  # Cookie-authenticated writes require CSRF origin validation.
    return inventory_catalog.review(db, body.id, body.status)
