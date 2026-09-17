"""Does a print/log call in the window actually REPORT the operation next to it?

The ds-* windows used to accept any `print(` within a few lines, so
`print("done, have a nice day")` closed a `.merge()` finding and a stray
`print(f"[sql] querying ...")` closed two `.dropna()` findings. A window test with no
predicate on the call is a test of proximity, not of logging.

THE RULE, stated once so the checkers can cite it:

  A log call satisfies an operation only if BOTH hold of the call's own text
  (the balanced-paren expression, which may span lines):

    1. QUANTITY — it derives a number from data: a size/count expression
       (`len(`, `.shape`, `.height`, `.count(`, `.n_unique(`, `.null_count`, ...)
       or a count word (`rows`, `dropped`, `matched`, `merged`, `coerced`,
       `nulls`, `rate`, ...).
    2. LINK — its CODE (interpolated `{...}` expressions and non-literal argument
       text, never the prose in between) names an identifier from the operation's
       own statement, or one derived from it inside the same window.

Either half alone is vacuous: a bare count nearby is still someone else's count, and a
bare variable mention is `print(df)`.

Two refinements, each of which exists to stop the rule reporting real diagnostics:

  - LINK reads CODE, not prose. `print(f"{c}: {x[c].isna().sum()} unparseable")` links
    through `x`; reading the prose too would also let the letters inside a format
    string like "%d-%b-%y" link to a variable named `d`.
  - LINK follows one or more assignments inside the window. A diagnostic routinely goes
    through an intermediate — `unmatched = votes.permno.isna()` then
    `print(f"{unmatched.sum()} unmatched")` — and that count IS derived from the merge.
"""

from __future__ import annotations

import re

_LOG_CALL = re.compile(r"\b(?:print|(?:logging|logger|log|LOG|LOGGER)\s*\.\s*\w+)\s*\(")

_IDENT = re.compile(r"[A-Za-z_][A-Za-z_0-9]*")

# Size/count expressions — a number read off the data itself.
_QUANTITY_EXPR = re.compile(
    r"""\blen\s*\(
      | \.shape\b | \.height\b | \.width\b | \.size\b | \.num_rows\b
      | \.count\s*\( | \.n_unique\s*\( | \.nunique\s*\( | \.sum\s*\(
      | \.null_count\b | \.isna\s*\( | \.isnull\s*\( | \.is_null\s*\(
      | \.is_duplicated\s*\( | \.duplicated\s*\( | \.value_counts\s*\(
      | \bnrow\s*\( | \.n_rows\b
    """,
    re.VERBOSE,
)

# Words that NAME a quantity produced by one of these operations. Deliberately only
# count-ish nouns and participles: a bare verb ("merge", "keep") or a bare adverb of
# sequence ("before", "after") is satisfied by ordinary narration, which is the vacuity
# being fixed. A real diagnostic says how many.
_QUANTITY_WORD = re.compile(
    r"""\b(?: rows? | row_count | n_rows | nrows | n_obs | obs | records?
            | counts? | dropped | kept | retained | removed | lost
            | matched | unmatched | match_rate
            | merged | joined | coerced | invalid | unparsed | unparseable
            | nulls? | nans? | missing | nonnull | non_null
            | uniques? | dupes? | duplicates? | duplicated
            | pct | percent | rate | ratio
       )\b""",
    re.VERBOSE | re.IGNORECASE,
)

# Names that carry no link on their own: they appear in almost every operation line and
# in almost every log call, so matching on them would restore the vacuity being fixed.
_NOISE_WORDS = (
    "print log logger logging debug info warning warn error critical exception "
    "f r b u rf fr format join strip lower upper str int float bool "
    "pd pl np self cls if else for while return def class import from as in is not and or "
    "true false none "
    # kwarg names: they sit on every operation line and name no data
    "on how axis subset inplace ignore_index errors coerce validate suffixes"
)
_NOISE = frozenset(_NOISE_WORDS.split(" "))


def _balanced(text: str, open_idx: int) -> str:
    """The `(...)` expression starting at `open_idx`, tolerant of an unclosed tail."""
    depth = 0
    for k in range(open_idx, len(text)):
        c = text[k]
        if c == "(":
            depth += 1
        elif c == ")":
            depth -= 1
            if depth == 0:
                return text[open_idx : k + 1]
    return text[open_idx:]


def log_calls(block: str) -> list[str]:
    """Every print/log call expression in `block`, each as its full balanced text."""
    out = []
    for m in _LOG_CALL.finditer(block):
        out.append(_balanced(block, m.end() - 1))
    return out


def _idents(text: str) -> set[str]:
    return {t for t in _IDENT.findall(text) if t.lower() not in _NOISE}


# A string literal, and the `{...}` interpolations inside it.
_STRING = re.compile(r"""(?:[rbuf]{0,3})('''|\"\"\"|'|")(?P<body>.*?)\1""", re.DOTALL)
_INTERP = re.compile(r"\{([^{}]*)\}")


def code_text(text: str) -> str:
    """`text` with literal prose removed, keeping f-string `{...}` expressions.

    The LINK test must not match a word that merely happens to be spelled like a
    variable inside a message ("rows on key" would link through `on`, "%d-%b-%y"
    through `d`). What a log call KNOWS about an operation is in the expressions it
    evaluates, so those are what is read.
    """
    return _STRING.sub(lambda m: " ".join(_INTERP.findall(m.group("body"))), text)


_ASSIGN = re.compile(r"^\s*(?P<lhs>[A-Za-z_][\w,\s\[\]\"'\.]*?)\s*=(?!=)(?P<rhs>.*)$")


def _derived(block: str, seed: set[str]) -> set[str]:
    """`seed` plus every name in `block` assigned from an expression mentioning it.

    Bounded by the window, and a fixpoint over at most that many passes.
    """
    names = set(seed)
    lines = block.split("\n")
    for _ in range(len(lines)):
        grew = False
        for ln in lines:
            m = _ASSIGN.match(ln)
            if not m:
                continue
            if _idents(m.group("rhs")) & names:
                new = _idents(m.group("lhs")) - names
                if new:
                    names |= new
                    grew = True
        if not grew:
            break
    return names


_MAX_SPAN = 6  # lines walked in either direction; a statement longer than this is rare


def statement_text(lines: list[str], idx: int) -> str:
    """The whole logical statement containing 0-based `lines[idx]`.

    The LINK test needs a variable name, and a chained call's own physical line has
    none: `.dropna(subset=["prc"]))` names no frame, so reading the line alone would
    report every fluent-style pipeline as unlogged.
    """
    start = idx
    while start > 0 and idx - start < _MAX_SPAN:
        seg = "\n".join(lines[start : idx + 1])
        prev = lines[start - 1].rstrip()
        cur = lines[start].lstrip()
        if (seg.count("(") - seg.count(")") < 0
                or cur.startswith((".", ")", "]"))
                or prev.endswith(("(", ",", "\\", "=", "["))):
            start -= 1
        else:
            break
    end = idx
    while end + 1 < len(lines) and end - idx < _MAX_SPAN:
        seg = "\n".join(lines[start : end + 1])
        if seg.count("(") - seg.count(")") > 0:
            end += 1
        else:
            break
    return "\n".join(lines[start : end + 1])


def reports_operation(block: str, op_stmt: str) -> bool:
    """True iff some log call in `block` states a quantity AND links to `op_stmt`."""
    op_idents = _idents(op_stmt)
    if not op_idents:
        return False
    linkable = _derived(block, op_idents)
    for call in log_calls(block):
        if not (_QUANTITY_EXPR.search(call) or _QUANTITY_WORD.search(call)):
            continue
        if _idents(code_text(call)) & linkable:
            return True
    return False
