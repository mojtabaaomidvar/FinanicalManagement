"""تجمیع همهٔ مدل‌ها تا Base.metadata کامل شود (برای Alembic autogenerate).

هر مدل جدیدی که اضافه شد باید همین‌جا هم import شود.
"""

from __future__ import annotations

from app.db.base import Base
from app.models.assistant_execution import AssistantExecutionReceipt
from app.models.inventory_catalog import InventoryCatalogProposal
from app.models.account import Account, CardBin
from app.models.wallet_correction import WalletCorrection
from app.models.activity_participant import ActivityParticipant
from app.models.auth import (
    AuthAttempt,
    FamilyInvite,
    LookupAttempt,
    OtpCode,
    Session,
)
from app.models.bill import Bill
from app.models.category import CategoryBudget, CustomCategory, Subcategory
from app.models.document import HouseholdDocument
from app.models.equipment import Equipment, MaintenanceRecord
from app.models.event import FamilyEvent
from app.models.family import Family, Member
from app.models.goal import Goal
from app.models.holding import Holding
from app.models.join_request import JoinRequest
from app.models.meal import Dish, MealEntry
from app.models.messaging import SmsBridge, SmsMessage, SmsNumber, SmsSender
from app.models.notification import NotificationDismissal
from app.models.pet import Pet
from app.models.settings import AppSetting
from app.models.shopping import InventoryItem, ShoppingItem, ShoppingList
from app.models.shopping_sync import ShoppingSyncReceipt
from app.models.task import Task
from app.models.support import SupportSession, SupportErrorCounter, SupportUsageCounter
from app.models.transaction import Transaction, TransactionPhoto
from app.models.vehicle import Vehicle

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
    "SmsSender",
    "SmsNumber",
    "Session",
    "OtpCode",
    "AuthAttempt",
    "LookupAttempt",
    "FamilyInvite",
    "FamilyEvent",
    "AppSetting",
    "Holding",
    "JoinRequest",
    "NotificationDismissal",
    "Bill",
    "ShoppingList",
    "ShoppingItem",
    "InventoryItem",
    "InventoryCatalogProposal",
    "ShoppingSyncReceipt",
    "Task",
    "HouseholdDocument",
    "Dish",
    "MealEntry",
    "Equipment",
    "MaintenanceRecord",
    "Vehicle",
    "Goal",
    "ActivityParticipant",
    "Pet",
    "SupportSession",
    "SupportErrorCounter",
    "SupportUsageCounter",
]
