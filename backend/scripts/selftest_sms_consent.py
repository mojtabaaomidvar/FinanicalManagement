"""خودآزمای «دروازهٔ رضایت» پیامک — بدون نیاز به دیتابیس یا وابستگی‌های بک‌اند.

چرا این شکلی نوشته شده: توابع دروازه (_resolve_account و دوستانش) منطق حریم
خصوصی‌اند، ولی برای اجرای واقعی‌شان به Session و مدل‌ها نیاز است. به‌جای
بازنویسی منطق در تست (که آن‌وقت «کپیِ تست» را می‌آزماییم نه کد واقعی را)،
همان تابع‌ها با ast از فایل اصلی بیرون کشیده و اجرا می‌شوند. پس اگر کسی
messaging.py را عوض کند، این فایل همان نسخهٔ تازه را می‌سنجد.

اجرا:  python3 scripts/selftest_sms_consent.py
"""

from __future__ import annotations

import ast
import pathlib
import re
import sys
import types
import uuid

_BACKEND = pathlib.Path(__file__).resolve().parent.parent


def _extract(rel: str, names: set[str]) -> list[ast.stmt]:
    """تعریف‌های خواسته‌شده را از فایل واقعی بیرون می‌کشد."""
    path = _BACKEND / rel
    tree = ast.parse(path.read_text(encoding="utf-8"), str(path))
    out: list[ast.stmt] = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in names:
            out.append(node)
        elif isinstance(node, ast.Assign) and any(
            getattr(t, "id", None) in names for t in node.targets
        ):
            out.append(node)
    found = {getattr(n, "name", None) for n in out} | {
        getattr(t, "id", None) for n in out for t in getattr(n, "targets", [])
    }
    missing = names - found
    if missing:
        raise SystemExit(f"✖ در {rel} پیدا نشد: {sorted(missing)}")
    return out


def _build_namespace() -> dict:
    body: list[ast.stmt] = [
        ast.ImportFrom(
            module="__future__", names=[ast.alias(name="annotations")], level=0
        )
    ]
    body += _extract(
        "app/services/sms_settings.py", {"_fa_digits_to_en", "normalize_sender"}
    )
    body += _extract(
        "app/services/messaging.py",
        {"_norm_bank", "_canon_bank", "_BANK_ALIASES", "_bank_matches",
         "_resolve_account"},
    )
    mod = ast.Module(body=body, type_ignores=[])
    ast.fix_missing_locations(mod)
    ns: dict = {"uuid": uuid, "re": re}
    exec(compile(mod, "<extracted>", "exec"), ns)  # noqa: S102
    return ns


class _Acct:
    def __init__(self, bank: str | None, id_: uuid.UUID | None = None) -> None:
        self.bank = bank
        self.id = id_ or uuid.uuid4()


class _Sndr:
    def __init__(self, sender: str, account_id: uuid.UUID) -> None:
        self.sender = sender
        self.account_id = account_id


def main() -> int:
    ns = _build_namespace()
    state: dict = {"accounts": [], "senders": []}
    ns["settings_service"] = types.SimpleNamespace(
        enabled_accounts=lambda db, fid: state["accounts"],
        list_senders=lambda db, fid: state["senders"],
        normalize_sender=ns["normalize_sender"],
    )
    resolve, nrm = ns["_resolve_account"], ns["normalize_sender"]
    fid = uuid.uuid4()
    results: list[bool] = []

    def case(label, accounts, senders, sender, bank, want_accept, want):
        state["accounts"], state["senders"] = accounts, senders
        accept, account_id = resolve(None, fid, sender, bank)
        got = "unique" if account_id else ("ambiguous" if accept else "rejected")
        ok = accept == want_accept and got == want
        print(f"  {'✅' if ok else '❌'} {label:<52} → {got}")
        results.append(ok)

    mellat, melli = _Acct("بانک ملت"), _Acct("بانک ملی")
    mellat2 = _Acct("بانک ملت")
    mehr = _Acct("بانک قرض‌الحسنه مهر ایران")
    saderat, tosee = _Acct("بانک صادرات"), _Acct("بانک توسعه صادرات")

    print("① دروازه: بدون حسابِ فعال هیچ چیز ذخیره نمی‌شود (بند ۱)")
    case("هیچ حساب فعالی نیست", [], [], "10001234", "بانک ملت", False, "rejected")

    print("② فرستنده")
    case("سرشماره به یک حسابِ فعال بسته است", [mellat, melli],
         [_Sndr(nrm("10001234"), mellat.id)], "10001234", None, True, "unique")
    case("«+98-21-0001» برابر «98210001»", [mellat],
         [_Sndr(nrm("98210001"), mellat.id)], "+98-21-0001", None, True, "unique")
    case("«+989123456789» برابر «09123456789»", [mellat],
         [_Sndr(nrm("09123456789"), mellat.id)], "+989123456789", None,
         True, "unique")
    case("ارقام فارسی «۱۰۰۰۱۲۳۴»", [mellat],
         [_Sndr(nrm("10001234"), mellat.id)], "۱۰۰۰۱۲۳۴", None, True, "unique")
    case("سرشماره به حسابِ غیرفعال بسته است", [melli],
         [_Sndr(nrm("10001234"), mellat.id)], "10001234", None, False, "rejected")
    case("یک سرشماره روی دو حسابِ فعال", [mellat, mellat2],
         [_Sndr("1000", mellat.id), _Sndr("1000", mellat2.id)], "1000", None,
         True, "ambiguous")

    print("③ بانک")
    case("پارسر «قرض‌الحسنه» ↔ حساب «قرض‌الحسنه مهر ایران»", [mehr], [], None,
         "بانک قرض‌الحسنه", True, "unique")
    case("پارسر «مهر ایران» ↔ همان حساب", [mehr], [], None,
         "بانک مهر ایران", True, "unique")
    case("بانک با یک حسابِ فعال می‌خواند", [mellat, melli], [], None,
         "بانک ملت", True, "unique")
    case("بانک با دو حسابِ فعال می‌خواند", [mellat, mellat2], [], None,
         "بانک ملت", True, "ambiguous")

    print("④ تله‌ها: نباید به حساب اشتباه بچسبد")
    case("«صادرات» نباید «توسعه صادرات» شود", [tosee], [], None,
         "بانک صادرات", False, "rejected")
    case("«توسعه صادرات» نباید «صادرات» شود", [saderat], [], None,
         "بانک توسعه صادرات", False, "rejected")
    case("هر دو موجود → دقیقاً یکی برنده", [saderat, tosee], [], None,
         "بانک صادرات", True, "unique")
    case("بانکی که حساب فعالی ندارد", [melli], [], None,
         "بانک سامان", False, "rejected")

    print("⑤ لبه‌ها")
    case("فرستندهٔ ناشناس + بانکِ ناشناس", [mellat], [], "99999", None,
         False, "rejected")
    case("فرستندهٔ ناشناس ولی بانک می‌خواند (بند ۱۰)", [mellat], [], "99999",
         "بانک ملت", True, "unique")
    case("نه فرستنده نه بانک", [mellat], [], None, None, False, "rejected")
    case("حساب با بانکِ NULL هرگز تطبیق نمی‌خورد", [_Acct(None)], [], None,
         "بانک ملت", False, "rejected")
    case("حساب با بانکِ خالی هرگز تطبیق نمی‌خورد", [_Acct("")], [], None,
         "بانک ملت", False, "rejected")

    passed, total = sum(results), len(results)
    print(f"\nنتیجه: {passed}/{total} " + ("✅ همه گذشت" if passed == total else "❌"))
    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(main())
