"""Pinned IranianBanks directory; stored names and editable UI labels stay separate."""

from __future__ import annotations

import json
from pathlib import Path

BANKS = json.loads(
    (Path(__file__).resolve().parents[1] / "data/iranian-banks/banks.json").read_text(
        encoding="utf-8"
    )
)
ALIASES = {
    "بانک ملی": "melli",
    "بانک صادرات": "saderat",
    "بانک رفاه": "refah",
    "بانک ایران‌زمین": "iran-zamin",
    "بانک توسعه صادرات": "tosee-saderat",
    "بانک انصاری": "sepah",
    "بانک انصار": "sepah",
    "بانک حکمت": "sepah",
}


def card_matches_bank(card: str, bank_name: str) -> bool:
    selected = next(
        (
            bank
            for bank in BANKS
            if bank["name_fa"] == bank_name
            or bank["id"] == bank_name
            or bank["id"] == ALIASES.get(bank_name)
        ),
        None,
    )
    if selected is None:
        return True
    matches = [
        (len(prefix), bank) for bank in BANKS for prefix in bank["bins"] if card.startswith(prefix)
    ]
    if not matches:
        return True
    longest = max(length for length, _ in matches)
    return any(
        bank["id"] == selected["id"]
        or bank["parent_bank"] == selected["name_fa"]
        or selected["parent_bank"] == bank["name_fa"]
        or (selected["parent_bank"] and selected["parent_bank"] == bank["parent_bank"])
        for length, bank in matches
        if length == longest
    )
