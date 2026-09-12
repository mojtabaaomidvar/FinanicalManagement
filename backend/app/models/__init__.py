"""تجمیع همهٔ مدل‌ها تا Base.metadata کامل شود (برای Alembic autogenerate).

هر مدل جدیدی که اضافه شد باید همین‌جا هم import شود.
"""

from __future__ import annotations

from app.db.base import Base
from app.models.account import Account, CardBin
from app.models.auth import (
    AuthAttempt,
    FamilyInvite,
    LookupAttempt,
    OtpCode,
    Session,
)
from app.models.category import CategoryBudget, CustomCategory, Subcategory
from app.models.event import FamilyEvent
from app.models.family import Family, Member
from app.models.holding import Holding
from app.models.messaging import SmsBridge, SmsMessage
from app.models.settings import AppSetting
from app.models.transaction import Transaction, TransactionPhoto

__all__ = [
    "Base",
    "Family",
    "Member",
    "Account",
    "CardBin",
    "Transaction",
    "TransactionPhoto",
    "Subcategory",
    "CustomCategory",
    "CategoryBudget",
    "SmsMessage",
    "SmsBridge",
    "Session",
    "OtpCode",
    "AuthAttempt",
    "LookupAttempt",
    "FamilyInvite",
    "FamilyEvent",
    "AppSetting",
    "Holding",
]
