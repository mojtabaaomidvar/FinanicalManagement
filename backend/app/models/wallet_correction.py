"""Immutable operation receipt. Only standard Transaction rows form the ledger."""
import uuid
from datetime import datetime
from decimal import Decimal

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Numeric, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class WalletCorrection(Base):
    __tablename__ = "wallet_corrections"
    __table_args__ = (
        UniqueConstraint("family_id", "operation_id", name="uq_wallet_family_operation"),
        UniqueConstraint("account_id", "revision", name="uq_wallet_account_revision"),
        CheckConstraint("mode IN ('ledger','reconciliation')", name="wallet_correction_mode"),
        CheckConstraint("length(request_hash)=64", name="wallet_correction_hash"),
        CheckConstraint("revision>0", name="wallet_correction_revision"),
        CheckConstraint("length(description)<=200", name="wallet_correction_description"),
        CheckConstraint("current_after=target_balance", name="wallet_correction_target"),
        CheckConstraint("delta=target_balance-CASE WHEN mode='ledger' THEN ledger_before ELSE current_before END", name="wallet_correction_delta"),
        CheckConstraint("(mode='reconciliation' AND transaction_id IS NULL AND ledger_after=ledger_before) "
                        "OR (mode='ledger' AND ledger_after=target_balance AND "
                        "((delta=0 AND transaction_id IS NULL) OR (delta<>0 AND transaction_id IS NOT NULL)))", name="wallet_correction_shape"),
        ForeignKeyConstraint(["transaction_id", "family_id"], ["transactions.id", "transactions.family_id"],
                             name="fk_wallet_transaction_family", ondelete="RESTRICT"),
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    family_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("families.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("accounts.id", ondelete="RESTRICT"), nullable=False)
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("members.id", ondelete="RESTRICT"), nullable=False)
    operation_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    request_hash: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False)
    target_balance: Mapped[Decimal] = mapped_column(Numeric(28, 2), nullable=False)
    ledger_before: Mapped[Decimal] = mapped_column(Numeric(28, 2), nullable=False)
    current_before: Mapped[Decimal] = mapped_column(Numeric(28, 2), nullable=False)
    ledger_after: Mapped[Decimal] = mapped_column(Numeric(28, 2), nullable=False)
    current_after: Mapped[Decimal] = mapped_column(Numeric(28, 2), nullable=False)
    delta: Mapped[Decimal] = mapped_column(Numeric(28, 2), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    transaction_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("transactions.id", ondelete="RESTRICT"), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())
