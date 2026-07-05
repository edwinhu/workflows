#!/usr/bin/env python3
"""Return-shape drift lint (item 7): for each `workflows/*.js`, extract the top-level keys of
the script's FINAL `return { ... }` object, then cross-reference every `returns { key1, key2,
... }` documentation line in `skills/**/SKILL.md` that names that workflow. Every documented key
must actually exist in the real return set.

This would have caught the slidesThatFailed-vs-sectionsThatFailed bug: a doc line quietly
drifted from the workflow's real return shape and nothing caught it until a live run.

Dependency-free stdlib Python. Parse failures (unbalanced braces, no top-level return, etc.) are
warn-and-skip per file — this is a lint, not a JS parser, and must never false-positive on a
workflow it can't confidently parse.

Run: python3 tests/workflow_return_shape_test.py
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS_DIR = ROOT / "workflows"
SKILLS_DIR = ROOT / "skills"

P, F, W = 0, 0, 0


def ok(name, cond, extra=""):
    global P, F
    if cond:
        P += 1
        print(f"  ok  {name}")
    else:
        F += 1
        print(f"  FAIL {name} {extra}")


def warn(msg):
    global W
    W += 1
    print(f"  warn  {msg}")


# ── extract the top-level keys of a JS file's FINAL zero-indent `return {...}` ──────────────
_TOP_RETURN_RE = re.compile(r"^return \{", re.M)


def _brace_match(text: str, open_pos: int) -> int | None:
    """Return the index of the `}` matching the `{` at open_pos, string- and comment-aware
    (an apostrophe inside a `//` line comment or `/* */` block comment must NOT be mistaken for a
    string delimiter — e.g. "don't trust" inside a comment breaks a naive quote-only scanner).
    None if unbalanced."""
    depth = 0
    in_str = None
    in_block_comment = False
    i = open_pos
    n = len(text)
    while i < n:
        c = text[i]
        if in_block_comment:
            if c == "*" and i + 1 < n and text[i + 1] == "/":
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_str:
            if c == "\\" and i + 1 < n:
                i += 2
                continue
            if c == in_str:
                in_str = None
            i += 1
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "/":
            j = text.find("\n", i)
            i = n if j == -1 else j
            continue
        if c == "/" and i + 1 < n and text[i + 1] == "*":
            in_block_comment = True
            i += 2
            continue
        if c in "\"'`":
            in_str = c
            i += 1
            continue
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                return i
        i += 1
    return None


def _split_top_level(body: str) -> list[str]:
    """Split an object body into top-level comma-separated property segments — commas inside
    nested {}/[]/() or string literals don't split. Line-comments (`//...`) are stripped so a
    trailing comment after a key doesn't get mistaken for content."""
    segments: list[str] = []
    depth = 0
    in_str = None
    in_block_comment = False
    buf: list[str] = []
    i, n = 0, len(body)
    while i < n:
        c = body[i]
        if in_block_comment:
            if c == "*" and i + 1 < n and body[i + 1] == "/":
                in_block_comment = False
                i += 2
                continue
            i += 1
            continue
        if in_str:
            buf.append(c)
            if c == "\\" and i + 1 < n:
                buf.append(body[i + 1])
                i += 2
                continue
            if c == in_str:
                in_str = None
            i += 1
            continue
        if c == "/" and i + 1 < n and body[i + 1] == "/":
            j = body.find("\n", i)
            i = n if j == -1 else j
            continue
        if c == "/" and i + 1 < n and body[i + 1] == "*":
            in_block_comment = True
            i += 2
            continue
        if c in "\"'`":
            in_str = c
            buf.append(c)
            i += 1
            continue
        if c in "{[(":
            depth += 1
            buf.append(c)
            i += 1
            continue
        if c in "}])":
            depth -= 1
            buf.append(c)
            i += 1
            continue
        if c == "," and depth == 0:
            segments.append("".join(buf))
            buf = []
            i += 1
            continue
        buf.append(c)
        i += 1
    if "".join(buf).strip():
        segments.append("".join(buf))
    return segments


_KEY_COLON_RE = re.compile(r"^([A-Za-z_$][A-Za-z0-9_$]*)\s*:")
_KEY_BARE_RE = re.compile(r"^([A-Za-z_$][A-Za-z0-9_$]*)$")


def extract_return_keys(js_text: str) -> list[str] | None:
    """Top-level keys of the LAST zero-indent `return {...}` in the file. None on any parse
    failure (caller must warn-and-skip, never false-positive)."""
    matches = list(_TOP_RETURN_RE.finditer(js_text))
    if not matches:
        return None
    m = matches[-1]
    open_pos = m.end() - 1  # index of the '{'
    close_pos = _brace_match(js_text, open_pos)
    if close_pos is None:
        return None
    body = js_text[open_pos + 1:close_pos]
    keys = []
    for seg in _split_top_level(body):
        seg = seg.strip()
        if not seg or seg.startswith("..."):
            continue
        mm = _KEY_COLON_RE.match(seg) or _KEY_BARE_RE.match(seg)
        if mm:
            keys.append(mm.group(1))
    return keys


# ── find `returns { key1, key2, ... }` doc lines in SKILL.md and the workflow they name ──────
_DOC_RETURNS_RE = re.compile(r"returns\s*`?\{([^{}]*)\}`?")


def extract_doc_return_mentions(md_text: str, workflow_names: list[str]):
    """Yield (line_no, workflow_name, [documented_keys]) for every `returns {...}` line whose
    surrounding context (previous 40 lines) contains a concrete `Workflow(...)` INVOCATION of one
    of `workflow_names` — a literal `<name>.js` path or `name="<name>"`/`name='<name>'` — not just
    a prose mention of the name (a doc discussing e.g. a `gateProbe` contract in passing near an
    unrelated workflow's name must NOT be cross-checked against that workflow's real return shape;
    only a line that actually introduces a `Workflow()` call for it counts)."""
    lines = md_text.split("\n")
    for i, line in enumerate(lines):
        m = _DOC_RETURNS_RE.search(line)
        if not m:
            continue
        keys_raw = m.group(1)
        keys = [k.strip().rstrip("?") for k in keys_raw.split(",") if k.strip()]
        if not keys:
            continue
        window = "\n".join(lines[max(0, i - 40):i + 1])
        named = [
            w for w in workflow_names
            if re.search(re.escape(w) + r"\.js\b", window)
            or re.search(r"""name\s*=\s*["']""" + re.escape(w) + r"""["']""", window)
        ]
        if named:
            yield i + 1, named[0], keys


def main() -> int:
    wf_files = sorted(WORKFLOWS_DIR.glob("*.js"))
    if not wf_files:
        warn("no workflows/*.js files found — nothing to lint")
        print(f"\n{P} passed, {F} failed, {W} warned")
        return 0

    real_keys: dict[str, list[str]] = {}
    for wf in wf_files:
        name = wf.stem
        text = wf.read_text(encoding="utf-8", errors="ignore")
        keys = extract_return_keys(text)
        if keys is None:
            warn(f"{name}: could not parse a top-level return — skipped (not a failure)")
            continue
        real_keys[name] = keys
        ok(f"{name}: parsed {len(keys)} top-level return key(s)", len(keys) > 0, keys)

    workflow_names = list(real_keys.keys())
    md_files = sorted(SKILLS_DIR.glob("**/SKILL.md"))
    checked_any = False
    for md in md_files:
        text = md.read_text(encoding="utf-8", errors="ignore")
        for line_no, wf_name, doc_keys in extract_doc_return_mentions(text, workflow_names):
            checked_any = True
            real = set(real_keys[wf_name])
            missing = [k for k in doc_keys if k not in real]
            rel = md.relative_to(ROOT)
            ok(f"{rel}:{line_no} doc return shape ⊆ {wf_name}.js real return keys",
               not missing,
               f"documented-but-absent: {missing} (real: {sorted(real)})")

    ok("at least one doc `returns {...}` line was cross-referenced against a real workflow",
       checked_any)

    print(f"\n{P} passed, {F} failed, {W} warned")
    return 1 if F else 0


if __name__ == "__main__":
    sys.exit(main())
