"""AST-only analysis for the local copy editor; never imports application code."""

from __future__ import annotations

import ast
import json
import re
import sys

PERSIAN = re.compile(r"[\u0600-\u06ff]")
VISIBLE_NAMES = {"message", "msg", "detail", "description", "label", "title", "hint", "text", "help_text"}
INTERNAL_NAMES = {"code", "error", "kind", "role", "currency", "relation", "phone", "name", "password", "password_hash", "status", "membership_state", "symbol", "glyph", "id", "key", "route", "url", "path", "pattern", "unit", "source"}
COPY_KEY = r"[A-Za-z0-9_./:@-]+"


def analyze(file: str, source: str) -> dict:
    tree = ast.parse(source, filename=file)
    lines = source.splitlines(keepends=True)
    line_offsets = []
    offset = 0
    for line in lines:
        line_offsets.append(offset)
        offset += len(line.encode("utf-16-le")) // 2

    def position(node: ast.AST, end: bool = False) -> int:
        row = getattr(node, "end_lineno" if end else "lineno") - 1
        column = getattr(node, "end_col_offset" if end else "col_offset")
        prefix = lines[row].encode("utf-8")[:column].decode("utf-8")
        return line_offsets[row] + len(prefix.encode("utf-16-le")) // 2

    def raw_position(node: ast.AST, end: bool = False) -> int:
        row = getattr(node, "end_lineno" if end else "lineno") - 1
        column = getattr(node, "end_col_offset" if end else "col_offset")
        prefix = lines[row].encode("utf-8")[:column].decode("utf-8")
        return sum(len(line) for line in lines[:row]) + len(prefix)

    def utf16_position(raw: int) -> int:
        return len(source[:raw].encode("utf-16-le")) // 2

    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node

    def ancestors(node):
        result = []
        while node in parents:
            node = parents[node]
            result.append(node)
        return result

    def annotation_for(node, chain):
        start, end = raw_position(node), raw_position(node, True)
        generated = re.search(r"\(\s*#\s*@copy-text\s+(" + COPY_KEY + r")\s*\n\s*$", source[:start])
        closing = re.match(r"\s*\)", source[end:])
        if generated and closing:
            return {"id": generated[1], "start": utf16_position(generated.start()), "end": utf16_position(end + closing.end()), "mode": "expression"}
        previous = lines[node.lineno - 2].strip() if node.lineno > 1 else ""
        statement = re.fullmatch(r"#\s*@copy-text\s+(" + COPY_KEY + r")", previous)
        if statement and any(isinstance(parent, (ast.Assign, ast.AnnAssign, ast.Return)) and parent.value is node for parent in chain):
            return {"id": statement[1], "start": position(node), "end": position(node, True), "mode": "statement"}
        return None

    def call_name(call):
        function = call.func
        return function.id if isinstance(function, ast.Name) else function.attr if isinstance(function, ast.Attribute) else ""

    def reason(node, chain):
        parent = parents.get(node)
        if isinstance(parent, ast.Expr) and isinstance(node, ast.Constant):
            grandparent = parents.get(parent)
            if isinstance(grandparent, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and grandparent.body[0] is parent:
                return "توضیح داخلی کد"
        for ancestor in chain:
            if isinstance(ancestor, ast.keyword) and ancestor.arg in INTERNAL_NAMES | {"title", "notes", "avatar_url"}:
                return "مقدار ذخیره‌شونده یا محتوای رکورد کاربر"
            if isinstance(ancestor, (ast.Compare, ast.MatchValue, ast.Subscript)):
                return "مقدار یا شرط داخلی"
            if isinstance(ancestor, ast.Call):
                name = call_name(ancestor)
                if name in {"print", "debug", "info", "warning", "exception", "critical", "compile", "search", "match", "fullmatch", "execute", "text", "startswith", "endswith", "replace", "encode", "decode"}:
                    return "پردازش یا گزارش داخلی"
                if name in {"get", "post", "put", "patch", "delete", "fetch"} and ancestor.args and ancestor.args[0] is node:
                    return "شناسه، مسیر یا کلید پردازش داخلی"
                if name == "AppError":
                    if len(ancestor.args) > 1 and node is ancestor.args[1] or any(k.arg in {"message", "detail"} and k.value is node for k in ancestor.keywords):
                        return None
                    return "کد یا پارامتر داخلی خطا"
                if name == "ValueError" and isinstance(node, ast.Constant) and isinstance(node.value, str) and not PERSIAN.search(node.value):
                    return "اعتبارسنجی فنی؛ پیام نمایشی جداست"
                if name in {"ValueError", "HTTPException"}:
                    return None
                if name in {"literal", "default_factory", "Column", "mapped_column", "Field", "CheckConstraint", "UniqueConstraint", "ForeignKey", "select", "getattr", "setattr"}:
                    return "قرارداد یا پیش‌فرض داده"
            if isinstance(ancestor, ast.Dict):
                if node in ancestor.keys:
                    return "کلید داده"
                for key, value in zip(ancestor.keys, ancestor.values):
                    if value is node and isinstance(key, ast.Constant) and key.value in INTERNAL_NAMES:
                        return "مقدار ذخیره‌شوندهٔ داده"
            if isinstance(ancestor, ast.Assign):
                names = [target.id.lower() for target in ancestor.targets if isinstance(target, ast.Name)]
                literal_assignment = ancestor.value is node or isinstance(ancestor.value, (ast.List, ast.Tuple, ast.Set)) and node in ancestor.value.elts
                if literal_assignment and any(name.endswith(("_pattern", "_regex", "_prefix", "_code", "_currency", "_relation")) or name in INTERNAL_NAMES for name in names):
                    return "قرارداد یا دادهٔ داخلی"
        return None

    def is_visible(node, chain, value):
        if PERSIAN.search(value):
            return True
        for ancestor in chain:
            if isinstance(ancestor, ast.Call) and call_name(ancestor) in {"AppError", "ValueError", "HTTPException"}:
                return True
            if isinstance(ancestor, ast.keyword) and ancestor.arg in VISIBLE_NAMES:
                return True
        return False

    entries, excluded, needs_review = [], [], []
    ordinal = 0
    # Source order makes IDs independent of the edited string length.
    nodes = sorted((n for n in ast.walk(tree) if isinstance(n, ast.JoinedStr) or isinstance(n, ast.Constant) and isinstance(n.value, str)), key=lambda n: (n.lineno, n.col_offset, getattr(n, "end_lineno", 0), getattr(n, "end_col_offset", 0)))
    for node in nodes:
        ordinal += 1
        chain = ancestors(node)
        if any(isinstance(n, (ast.JoinedStr, ast.FormattedValue)) for n in chain):
            continue
        annotation = annotation_for(node, chain)
        if isinstance(node, ast.JoinedStr):
            values = []
            tokens = []
            expressions = []
            for value in node.values:
                if isinstance(value, ast.Constant):
                    values.append(value.value)
                elif isinstance(value, ast.FormattedValue):
                    token = "{slot" + str(len(tokens) + 1) + "}"
                    raw = ast.get_source_segment(source, value)
                    if not raw or not raw.startswith("{") or not raw.endswith("}"):
                        # Python <3.12 has coarse f-string offsets; report instead of guessing ranges.
                        raw = None
                    values.append(token)
                    tokens.append({"token": token, "example": "نمونه"})
                    expressions.append(raw)
            value = "".join(values)
            fixed_text = value
            for token in tokens:
                fixed_text = fixed_text.replace(token["token"], "")
            if tokens and not any(character.isalnum() for character in fixed_text) and not annotation:
                excluded.append({"line": node.lineno, "text": value, "reason": "قالب نمایش دادهٔ پویا بدون نوشتهٔ ثابت"})
                continue
            if any(expression is None for expression in expressions):
                if PERSIAN.search(value):
                    excluded.append({"line": node.lineno, "text": value, "reason": "قالب پویا نیازمند موقعیت دقیق عبارت است"})
                continue
            plan = {"kind": "python-template", "tokens": tokens, "expressions": expressions}
        else:
            value = node.value
            plan = {"kind": "python-string"}
        if not value.strip() and not annotation:
            continue
        why = reason(node, chain)
        if why:
            if PERSIAN.search(value) or annotation:
                excluded.append({"line": node.lineno, "text": value, "reason": why})
            if annotation:
                needs_review.append({"line": node.lineno, "text": value, "reason": "نوشتهٔ ثبت‌شده در مسیر داده یا پردازش داخلی قرار گرفته است."})
            continue
        if not annotation and not is_visible(node, chain, value):
            continue
        function = next((n.name for n in chain if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))), "پیام سرور")
        error_call = next((n for n in chain if isinstance(n, ast.Call) and call_name(n) == "AppError"), None)
        error_code = error_call.args[0].value if error_call and error_call.args and isinstance(error_call.args[0], ast.Constant) and isinstance(error_call.args[0].value, str) else None
        entries.append({"ordinal": ordinal, "line": node.lineno, "start": annotation["start"] if annotation else position(node), "end": annotation["end"] if annotation else position(node, True),
                        "nodeStart": position(node), "nodeEnd": position(node, True), "annotationId": annotation["id"] if annotation else None,
                        "annotationMode": annotation["mode"] if annotation else None, "text": value, "context": function, "errorCode": error_code, **plan})
    return {"file": file, "entries": entries, "excluded": excluded, "needsReview": needs_review}


def main():
    payload = json.load(sys.stdin)
    if payload.get("action") == "validate":
        for file in payload["files"]:
            ast.parse(file["source"], filename=file["file"])
        print(json.dumps({"valid": True}))
    else:
        print(json.dumps([analyze(file["file"], file["source"]) for file in payload["files"]], ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}, ensure_ascii=False))
        raise SystemExit(1)
