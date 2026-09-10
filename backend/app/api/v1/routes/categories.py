"""روتِ زیردسته‌ها، دسته‌های سفارشی و بودجهٔ دسته‌ها — خواندن (فاز ۶) + نوشتن (فاز ۷).

همهٔ روت‌ها get_tenant_member می‌گیرند تا زمینهٔ RLS خانواده ست شود (fail-closed).
تعیین/حذفِ بودجه در لایهٔ سرویس فقط برای مدیر مجاز است (FORBIDDEN).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_tenant_member
from app.db.session import get_db
from app.models.family import Member
from app.schemas.data import (
    CategoryBudgetOut,
    CategoryBudgetSet,
    CustomCategoryCreate,
    CustomCategoryOut,
    SubcategoryCreate,
    SubcategoryOut,
)
from app.services import categories as category_service
from app.services.common import to_uuid

router = APIRouter(tags=["categories"])


# ── زیردسته‌ها ───────────────────────────────────────────────
@router.get("/subcategories", response_model=list[SubcategoryOut])
def list_subcategories(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[SubcategoryOut]:
    return [
        SubcategoryOut.of(s)
        for s in category_service.list_subcategories(db, member.family_id)
    ]


@router.post(
    "/subcategories",
    response_model=SubcategoryOut,
    status_code=status.HTTP_201_CREATED,
)
def add_subcategory(
    body: SubcategoryCreate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> SubcategoryOut:
    return SubcategoryOut.of(category_service.add_subcategory(db, member.family_id, body))


@router.delete(
    "/subcategories/{subcategory_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_subcategory(
    subcategory_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    category_service.delete_subcategory(
        db, member.family_id, to_uuid(subcategory_id, "NOT_FOUND", "زیردسته یافت نشد.", 404)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── دسته‌های سفارشی ──────────────────────────────────────────
@router.get("/custom-categories", response_model=list[CustomCategoryOut])
def list_custom_categories(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[CustomCategoryOut]:
    return [
        CustomCategoryOut.of(c)
        for c in category_service.list_custom_categories(db, member.family_id)
    ]


@router.post(
    "/custom-categories",
    response_model=CustomCategoryOut,
    status_code=status.HTTP_201_CREATED,
)
def add_custom_category(
    body: CustomCategoryCreate,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> CustomCategoryOut:
    return CustomCategoryOut.of(
        category_service.add_custom_category(db, member.family_id, body)
    )


@router.delete(
    "/custom-categories/{category_id}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_custom_category(
    category_id: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    category_service.delete_custom_category(
        db, member.family_id, to_uuid(category_id, "NOT_FOUND", "دسته یافت نشد.", 404)
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── بودجهٔ دسته‌ها (فقط مدیر) ────────────────────────────────
@router.get("/category-budgets", response_model=list[CategoryBudgetOut])
def list_category_budgets(
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> list[CategoryBudgetOut]:
    return [
        CategoryBudgetOut.of(b)
        for b in category_service.list_category_budgets(db, member.family_id)
    ]


@router.post("/category-budgets", response_model=CategoryBudgetOut)
def set_category_budget(
    body: CategoryBudgetSet,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> CategoryBudgetOut:
    return CategoryBudgetOut.of(category_service.set_category_budget(db, member, body))


@router.delete(
    "/category-budgets/{category}", status_code=status.HTTP_204_NO_CONTENT
)
def delete_category_budget(
    category: str,
    member: Member = Depends(get_tenant_member),
    db: Session = Depends(get_db),
) -> Response:
    category_service.delete_category_budget(db, member, category)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
