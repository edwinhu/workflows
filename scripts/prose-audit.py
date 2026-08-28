#!/usr/bin/env -S uv run --with lxml,pyyaml python3
"""prose-audit — THE deterministic prose / AI-writing audit for this plugin.

ONE entry point over ALL five pattern systems, emitting ONE span list with stable ids:

  A  scored AI-tics   skills/ai-anti-patterns/references/scored-tics-patterns.py   (system `scored-tic`)
  B  wikipedia-*      skills/ai-anti-patterns/references/wikipedia-*.py            (system `wikipedia-*`)
  D  domain style     skills/writing-{general,legal,econ}/references/*.py          (system `writing-*`)
  E  tiered diction   skills/de-ai-revise/references/diction.yaml                  (system `diction`)
  +  stylometrics     skills/ai-anti-patterns/scripts/style_metrics.py --lint      (system `style`)
  +  US-register spelling and paragraph/section em-dash density                    (`spelling`, `em-dash`)

System C — the four `references/constraints/writing-ai-smell-*` pairs — was ABSORBED INTO B
(v5.127.0). It was the same system built twice; keeping both is what produced the double-reporting
this script exists to end. Its one genuinely better implementation, the superlative
self-attribution heuristic, survived the merge and now lives in wikipedia-promotional-language.py.

WHY ONE SCRIPT. Before this, four loaders each assembled their own subset, so there was no single
answer to "what did this draft score?" — nothing could be injected into a reviewer as evidence, and
overlapping tables reported the same puffery phrase two or three times under three labels with
three severities. See docs/DESIGN-prose-constraint-architecture.md.

THE READER'S RULE: if a finding has a span id it is deterministic; if it does not, it is judgement.

NON-NEGOTIABLES

  * DE-DUPLICATION IS THE POINT. Overlapping hits on the same (line, column range) collapse into
    ONE span carrying every contributing label at the HIGHEST contributing severity.
  * FOOTNOTES ARE MASKED by default (`--keep-footnotes` to disable). Footnotes carry [@bibkey]
    cites, quoted and statutory text, and legal-normal prose; a finding must never land in one.
    Markdown `^[...]` / `[^id]:`, Typst `#footnote[...]`, and docx `footnotes.xml` paragraphs.
  * SPAN IDS ARE STABLE within a run (`S001`… in document order), so a reviewer can cite `S001`
    and the citation can be checked.

SEVERITY. `hard` means "no false positives, indefensible in a shipped draft": the provenance-leak
tables (`wikipedia-chatgpt-artifacts`, `wikipedia-template-artifacts`, the communication module's
`_HARD_PATTERNS`) plus the corpus-gated scored tics at sev>=4, which passed a ~0-human-rate gate
against 14.3M sentences of law + finance prose. Everything else is `soft` and advisory. Only `hard`
may block a gate.

Usage:
  prose-audit.py --json draft.md                       # the span list
  prose-audit.py --json --style legal drafts/*.md      # + Volokh
  prose-audit.py --profile de-ai --json draft.md       # the de-ai-revise rewrite view
  prose-audit.py --profile deck --json lecture.typ     # a slide deck: rhythm systems off
  prose-audit.py draft.docx                            # human-readable report

Exit: 1 if any `hard` span was found, else 0. (2 on a usage error.)
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

WORKFLOWS_ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = WORKFLOWS_ROOT / "scripts"
SKILLS_DIR = WORKFLOWS_ROOT / "skills"
AAP_REFS = SKILLS_DIR / "ai-anti-patterns" / "references"
SCORED_TICS = AAP_REFS / "scored-tics-patterns.py"
STYLE_LINT = SKILLS_DIR / "ai-anti-patterns" / "scripts" / "style_metrics.py"
DICTION_YAML = SKILLS_DIR / "de-ai-revise" / "references" / "diction.yaml"

sys.path.insert(0, str(SCRIPTS_DIR))
sys.path.insert(0, str(SCRIPTS_DIR / "lib"))
import prose_extract
from footnote_mask import (  # noqa: F401  — _INLINE_FN/_REF_FN_DEF are re-exported for de_ai_audit importers
    _INLINE_FN,
    _REF_FN_DEF,
    _blank,
    mask_footnotes,
)

try:
    import yaml
except ImportError:  # pragma: no cover - environment guard
    yaml = None


# ── severity ─────────────────────────────────────────────────────────────────
HARD, SOFT = "hard", "soft"
_SEV_RANK = {SOFT: 0, HARD: 1}


def _worst(a: str, b: str) -> str:
    return a if _SEV_RANK.get(a, 0) >= _SEV_RANK.get(b, 0) else b


# ── pattern tables ───────────────────────────────────────────────────────────
# (system, module path, attribute, severity-or-None, ignore_case)
# severity None ⇒ read the module's own declared SEVERITY. The one split is
# wikipedia-communication, whose module declares `hard` but carries a separate
# _SOFT_PATTERNS table; that table is pinned soft here because the module has no
# second SEVERITY to declare it with.
_WIKI_TABLES = [
    ("wikipedia-structural",         "wikipedia-structural-patterns.py",      "_STRUCTURAL_PATTERNS",  None, True),
    ("wikipedia-puffery",            "wikipedia-puffery-and-exaggeration.py", "_PUFFERY_PATTERNS",     None, True),
    ("wikipedia-promotional",        "wikipedia-promotional-language.py",     "_PROMOTIONAL_PATTERNS", None, True),
    # The artifact/placeholder tables are matched CASE-SENSITIVELY, exactly as their own
    # check() does: `[A-Z][a-zA-Z ']+` is a capitalised-placeholder rule, and folding case
    # would turn it into a match on any bracketed phrase.
    ("wikipedia-chatgpt-artifacts",  "wikipedia-chatgpt-artifacts.py",        "_ARTIFACT_PATTERNS",    None, False),
    ("wikipedia-template-artifacts", "wikipedia-template-artifacts.py",       "_PLACEHOLDER_PATTERNS", None, False),
    ("wikipedia-communication",      "wikipedia-communication-patterns.py",   "_HARD_PATTERNS",        None, True),
    ("wikipedia-communication",      "wikipedia-communication-patterns.py",   "_SOFT_PATTERNS",        SOFT, True),
]

# Domain style guides. Kept a DISTINCT system from the AI-tell tables on purpose: they are
# style-guide advice on a different axis (Strunk/Volokh/McCloskey), already domain-gated, and
# folding them into the AI-tell families would misreport a house-style preference as an AI tell.
_DOMAIN_TABLES = [
    ("writing-general", "writing", "strunk-elements-of-style.py",     "_HARD_VIOLATIONS"),
    ("writing-general", "writing", "strunk-elements-of-style.py",     "_SOFT_VIOLATIONS"),
    ("writing-econ",    "writing",    "mccloskey-economical-writing.py", "_VAGUE_NOUNS"),
    ("writing-econ",    "writing",    "mccloskey-economical-writing.py", "_PRETENTIOUS_VERBS"),
    ("writing-econ",    "writing",    "mccloskey-economical-writing.py", "_ERSATZ_ECON"),
    ("writing-econ",    "writing",    "mccloskey-economical-writing.py", "_STRUCTURAL"),
    ("writing-legal",   "writing",   "volokh-distilled.py",             "_LEGALESE"),
    ("writing-legal",   "writing",   "volokh-distilled.py",             "_LONG_SYNONYMS"),
    ("writing-legal",   "writing",   "volokh-distilled.py",             "_NOMINALIZATION"),
    ("writing-legal",   "writing",   "volokh-distilled.py",             "_HARSH_WORDS"),
    ("writing-legal",   "writing",   "volokh-distilled.py",             "_EMPTY_QUALIFIERS"),
    ("writing-legal",   "writing",   "volokh-distilled.py",             "_DOUBLETS"),
    ("writing-legal",   "writing",   "volokh-distilled.py",             "_INTRO_CLAUSES"),
]

# ── profiles ─────────────────────────────────────────────────────────────────
# A profile selects WHICH systems run. `full` is the default and runs every system; `deck` is the
# restricted ruleset for a Typst slide deck, which used to be skipped outright.
#
# THE SPLIT IS NOT ARBITRARY. The systems that stay on are claims about PROVENANCE and
# CORRECTNESS — A `scored-tic` (corpus-gated AI tics), B `wikipedia-*` (provenance leaks), `style`
# (stylometrics), `spelling` (US register). A sentence that leaks a chatbot's fingerprint or
# misspells a word is just as wrong on a slide as in a paragraph.
#
# The systems that go off are claims about PROSE RHYTHM — D `writing-*` (domain style guides),
# E `diction` (tiered substitution), and the `em-dash` density budgets. A deck is bullets, not
# paragraphs: it legitimately breaks sentence rhythm, so those budgets would fire on register, not
# on a defect. Note `style` KEEPS its metronomic-run and nominalization detection; only the
# separate `em-dash` density system is dropped.
_DECK_OFF_SYSTEMS = frozenset({"diction", "em-dash"})
_DECK_OFF_PREFIXES = ("writing-",)


def system_enabled(system: str, profile: str = "full") -> bool:
    """Does `system` run under `profile`? `full` runs everything (frozen behaviour)."""
    if profile != "deck":
        return True
    return system not in _DECK_OFF_SYSTEMS and not system.startswith(_DECK_OFF_PREFIXES)


_MODULE_CACHE: dict[str, object] = {}


def _load_module(path: Path):
    key = str(path)
    if key not in _MODULE_CACHE:
        spec = importlib.util.spec_from_file_location(
            "prose_audit_" + re.sub(r"\W", "_", path.stem), path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        _MODULE_CACHE[key] = mod
    return _MODULE_CACHE[key]


def _compile_table(path: Path, attr: str, ignore_case: bool):
    """Yield (compiled, label) for one (regex, label) table. A bad regex warns and is skipped
    rather than killing the audit — a single broken pattern must not blind every other one."""
    try:
        mod = _load_module(path)
    except Exception as e:  # pragma: no cover - defensive
        print(f"WARN: failed to load {path}: {e}", file=sys.stderr)
        return
    for pattern, label in (getattr(mod, attr, None) or []):
        flags = re.MULTILINE | (re.IGNORECASE if ignore_case else 0)
        try:
            yield re.compile(pattern, flags), label
        except re.error as e:
            print(f"WARN: bad regex in {path.name}:{attr} — {e}", file=sys.stderr)


def load_pattern_systems(style: str | None = None) -> list[tuple[str, str, str, re.Pattern]]:
    """(system, label, severity, compiled) for every regex table in scope.

    `style` gates the domain guides the way prose-lint and check-all already gate them:
    writing-general always, writing-legal for legal, writing-econ for econ.
    """
    out: list[tuple[str, str, str, re.Pattern]] = []

    # A — scored AI-tics. Severity rides in the label (`ai-tic·sevN·id`); sev>=4 is `hard`
    # because every entry cleared the ~0-human-rate corpus gate, which is the same
    # "no false positives" property the provenance-leak tables have.
    for rx, label in _compile_table(SCORED_TICS, "_TIC_PATTERNS", True):
        m = re.search(r"sev(\d)", label)
        sev = int(m.group(1)) if m else 1
        out.append(("scored-tic", label, HARD if sev >= 4 else SOFT, rx))

    # B — wikipedia tables (severity declared by the module).
    for system, filename, attr, forced, ignore_case in _WIKI_TABLES:
        path = AAP_REFS / filename
        if not path.exists():
            continue
        severity = forced
        if severity is None:
            try:
                severity = str(getattr(_load_module(path), "SEVERITY", SOFT)).lower()
            except Exception:
                severity = SOFT
            severity = HARD if severity == HARD else SOFT
        for rx, label in _compile_table(path, attr, ignore_case):
            out.append((system, f"{system}: {label}", severity, rx))

    # D — domain style guides.
    domain = (style or "general").lower()
    for system, skill, filename, attr in _DOMAIN_TABLES:
        if system == "writing-legal" and domain != "legal":
            continue
        if system == "writing-econ" and domain != "econ":
            continue
        path = SKILLS_DIR / skill / "references" / filename
        if not path.exists():
            continue
        for rx, label in _compile_table(path, attr, True):
            out.append((system, f"{system}: {label}", SOFT, rx))

    return out


# ── diction (tiered fancy→plain) ─────────────────────────────────────────────
def _word_rx(word: str) -> re.Pattern:
    """Match the word and its common inflections (delve->delving, meticulous->meticulously).
    Hyphenated compounds (cutting-edge, ever-evolving) match literally."""
    esc = re.escape(word)
    if "-" in word or word.endswith(("s", "es", "ies")):
        return re.compile(r"\b" + esc + r"\b", re.IGNORECASE)
    return re.compile(r"\b" + esc + r"(?:s|es|ed|d|ing|ly|ies)?\b", re.IGNORECASE)


_DICTION_CACHE: dict | None = None


def load_diction() -> dict:
    global _DICTION_CACHE
    if _DICTION_CACHE is None:
        if yaml is None:
            raise SystemExit("needs PyYAML: run via `uv run --with pyyaml python3 prose-audit.py ...`")
        data = yaml.safe_load(DICTION_YAML.read_text())
        tiers = {}
        for tier in ("always_flag", "cluster", "density"):
            tiers[tier] = [{
                "word": e["word"],
                "replace_with": e.get("replace_with", ""),
                "rate": float(e.get("rate_per_M", 0)),
                "rx": _word_rx(e["word"]),
            } for e in data.get(tier, [])]
        _DICTION_CACHE = tiers
    return _DICTION_CACHE


# --- British spelling in US-register prose -------------------------------
# Not a "fancy word" signal, so it does not belong in diction.yaml's rate tiers: it is a LOCALE
# mismatch. LLMs trained on mixed corpora emit these into US documents, and a US filing or law
# review piece should not carry them.
#
# WORDS CORRECT IN BOTH DIALECTS ARE DELIBERATELY ABSENT and must stay absent:
#   analysis, characteristic, basis, crisis, emphasis, thesis, hypothesis
#   (the -sis nouns are not the -ise verbs), and practice/licence as NOUNS.
# Adding any of them turns this into a false-positive generator.
BRITISH = {
    "recognise": "recognize", "recognised": "recognized", "recognising": "recognizing",
    "organise": "organize", "organised": "organized", "organisation": "organization",
    "normalise": "normalize", "normalised": "normalized", "normalisation": "normalization",
    "summarise": "summarize", "summarised": "summarized",
    "emphasise": "emphasize", "emphasised": "emphasized",
    "minimise": "minimize", "minimised": "minimized",
    "maximise": "maximize", "maximised": "maximized",
    "generalise": "generalize", "generalised": "generalized",
    "specialise": "specialize", "specialised": "specialized",
    "analyse": "analyze", "analysed": "analyzed", "analysing": "analyzing",
    "behaviour": "behavior", "behavioural": "behavioral",
    "colour": "color", "favour": "favor", "favourable": "favorable",
    "labour": "labor", "honour": "honor", "rigour": "rigor", "vigour": "vigor",
    "centre": "center", "centred": "centered", "metre": "meter", "litre": "liter",
    "defence": "defense", "offence": "offense",
    "modelling": "modeling", "modelled": "modeled",
    "labelling": "labeling", "labelled": "labeled",
    "travelling": "traveling", "travelled": "traveled",
    "cancelling": "canceling", "cancelled": "canceled",
    "whilst": "while", "amongst": "among",
    "programme": "program", "sceptical": "skeptical", "sceptic": "skeptic",
    "judgement": "judgment", "grey": "gray",
    # -s forms, needed because the match is strict
    "recognises": "recognizes", "organises": "organizes", "normalises": "normalizes",
    "analyses": "analyzes", "emphasises": "emphasizes", "minimises": "minimizes",
    "behaviours": "behaviors", "colours": "colors", "favours": "favors",
    "centres": "centers", "metres": "meters", "litres": "liters",
    "programmes": "programs", "organisations": "organizations",
    "defences": "defenses", "offences": "offenses", "judgements": "judgments",
}
# STRICT word match, not _word_rx: that helper matches inflections (delve->delving), which is right
# for diction but wrong here, where every form is enumerated above. Without this, "recognise" also
# matches inside "recognised" (two spans, one with the wrong replacement).
_BRITISH_RX = {w: re.compile(r"\b" + re.escape(w) + r"\b", re.IGNORECASE) for w in BRITISH}


# ── footnote masking, all three formats ──────────────────────────────────────
# Typst footnotes are `#footnote[...]`. prose_extract already skips a LINE that starts with `#`,
# but an inline `#footnote[...]` mid-sentence is body text to it, so the citation inside would be
# scored as the author's prose. One level of nested `[...]` covers `#cite[...]` inside the note.
_TYPST_FN = re.compile(r"#footnote\[(?:[^\[\]]|\[[^\]]*\])*\]")


def mask_typst_footnotes(text: str) -> str:
    return _TYPST_FN.sub(lambda m: _blank(m.group(0)), text)


# ── markup neutralisation (Typst, LaTeX) ─────────────────────────────────────
# MEASURED FALSE POSITIVE, and the worst kind. `#emph[First],` in a Typst comment letter matched
# `wikipedia-template-artifacts`' `\[[A-Z][a-zA-Z\s']+\]` rule — a HARD span, which the reviewer
# prompt describes as "a provenance leak … almost never defensible". So ordinary emphasis in a
# regulatory filing was injected into three reviewers as high-confidence evidence of AI authorship.
#
# `prose_extract` skips a Typst line that STARTS with `#`, which is why this only ever showed up
# mid-line — and why it also silently DROPPED the prose on lines that begin with `#emph[`. Both
# problems have the same fix: neutralise the markup DELIMITERS and keep the prose between them, at
# the same offsets. `#emph[First]` becomes `      First `, which is scored as the word it is and no
# longer starts with `#`.
#
# Only the CONTENT-bearing bracket form is touched: `#name` (with an optional `(...)` argument
# group) immediately followed by `[`. `#let`, `#set`, `#show`, `#import` have no `[` in that
# position, so they stay code and stay skipped — which is what keeps a `#let` dict out of the prose.
_TYPST_CALL = re.compile(r"#([a-zA-Z][\w.-]*)\s*(\([^()]*\))?\s*(?=\[)")
_LATEX_CALL = re.compile(r"\\([a-zA-Z@]+)\s*(\[[^\]]*\])?\s*(?=\{)")
_LATEX_ENV = re.compile(r"\\(?:begin|end)\s*\{[^}]*\}")
_LATEX_BARE = re.compile(r"\\[a-zA-Z@]+\*?")


def _blank_span(chars: list[str], start: int, end: int) -> None:
    """Blank chars[start:end] in place, preserving newlines so line numbers never shift."""
    for i in range(start, min(end, len(chars))):
        if chars[i] != "\n":
            chars[i] = " "


def _find_closer(text: str, opener: int, open_ch: str, close_ch: str) -> int:
    """Index of the delimiter closing `text[opener]`, or -1 if the construct never closes.

    ONE implementation, shared by the neutraliser and by collect_emphasis(). Depth-matched, so a
    nested `#emph[a #strong[b] c]` closes on the right bracket. An unbalanced opener returns -1,
    which every caller treats as "blank/keep only the head" rather than eating the rest of the file.
    """
    depth = 0
    for i in range(opener, len(text)):
        if text[i] == open_ch:
            depth += 1
        elif text[i] == close_ch:
            depth -= 1
            if depth == 0:
                return i
    return -1


def _neutralize_calls(text: str, head: re.Pattern, open_ch: str, close_ch: str) -> str:
    """Blank each `<call-head><open>…<close>` wrapper, keeping the content between the delimiters.

    Delimiters are matched by depth, so a nested `#emph[a #strong[b] c]` closes correctly. An
    unbalanced opener (a construct spanning past the end of the text) blanks only its head, which
    degrades to today's behaviour rather than eating the rest of the document.
    """
    chars = list(text)
    for m in head.finditer(text):
        opener = m.end()
        if opener >= len(text) or text[opener] != open_ch:
            continue
        closer = _find_closer(text, opener, open_ch, close_ch)
        _blank_span(chars, m.start(), opener)          # `#emph` + any `(...)` args
        if closer != -1:
            chars[opener] = " "
            chars[closer] = " "
    return "".join(chars)


def neutralize_typst_markup(text: str) -> str:
    return _neutralize_calls(text, _TYPST_CALL, "[", "]")


def neutralize_latex_markup(text: str) -> str:
    """LaTeX gets the same treatment, plus environment delimiters and bare control sequences.

    `.tex` has no dedicated extractor — it falls through to the plain-text reader — so without
    this every `\\emph{…}`, `\\cite[p. 5]{key}` and `\\begin{quote}` is scored as the author's own
    words. Content inside `{…}` is kept for the same reason as Typst: it is prose.
    """
    text = _neutralize_calls(text, _LATEX_CALL, "{", "}")
    text = _LATEX_ENV.sub(lambda m: _blank(m.group(0)), text)
    return _LATEX_BARE.sub(lambda m: _blank(m.group(0)), text)


# ── emphasis / markup, as a SIDE CHANNEL ─────────────────────────────────────
# WHY THIS IS A SIDE CHANNEL AND NOT A PATTERN TABLE. Neutralisation above blanks the call head
# and both delimiters while keeping the inner text, so by the time any scorer runs, emphasis is
# structurally invisible on the `.typ` / `.tex` paths:
#
#     in:  The market saw #strong[546,088 trades] and #emph[substantial] growth.
#     out: The market saw         546,088 trades  and       substantial  growth.
#
# That is CORRECT for `#cite[]` / `#footnote[]` and it is what fixed the v5.127.0 HARD false
# positive documented above — so it is not being changed. Instead the spans are harvested from the
# raw text BEFORE neutralising and carried alongside, and the emphasis rules read that list. The
# prose scorers see exactly what they saw before.
#
# VALIDATION CAVEAT (verbatim, and it is load-bearing):
#
#   These rules cannot be validated by the ai-tic FP-hunt against the rjds corpus. That corpus is
#   raw `fitz.get_text()` output from PDFs, in which bold and italic markup is not preserved; a
#   0-hit result there would mean the signal is absent, not that the rule is clean — a gate that
#   cannot fail. They were FP-hunted instead against locally authored Typst sources that *do*
#   preserve markup, and they ship `soft` because they have not met the corpus-gated bar that
#   `hard` denotes in this script (see the SEVERITY note at the top of the file).
#
# SCOPE IS TEXT FORMATS ONLY (`.md`, `.typ`, `.tex`). `.docx` bold runs are DEFERRED, not
# forgotten: the em-dash system already skips docx for the same reason (`if masked_text is not
# None`), and a docx paragraph list has no column anchoring to hang a span on.
_TYPST_EMPH = re.compile(r"#(strong|emph)\s*(?:\([^()]*\))?\s*(?=\[)")
_LATEX_EMPH = re.compile(r"\\(textbf|bfseries|bf|emph|textit|itshape|it)\s*(?=\{)")
# `{\bf text}` — the declaration form, which has no braces of its own to walk.
_LATEX_DECL = re.compile(r"\{\s*\\(bfseries|bf|itshape|it|em)\s+([^{}]*)\}")
# Markdown STRONG ONLY. Single-character `*` / `_` is too ambiguous in real drafts (globs, math,
# snake_case filenames) to score, and a rule that fires on `path/*.md` is worse than no rule.
_MD_STRONG = re.compile(r"\*\*(?!\s)([^*\n]+?)\*\*|__(?!\s)([^_\n]+?)__")
_STRONG_NAMES = {"strong", "textbf", "bfseries", "bf"}

_TYPST_TABLE = re.compile(r"#(?:table|figure|grid)\s*(?=\()")
_LATEX_TABLE_ENV = re.compile(r"\\begin\s*\{(tabular\*?|tabularx|table\*?|longtable|array)\}")
_LIST_MARKER = re.compile(r"^(?:[+\-*]\s+|\d+[.)]\s+)")
_PARA_BREAK = re.compile(r"^\s*$|^\s*(?:#{1,6}\s|={1,6}\s)")


def _table_ranges(text: str, suffix: str) -> list[tuple[int, int]]:
    """Character ranges that are table/figure markup, not running prose.

    NOT AN OPTIMISATION — the thing that makes the bold rules viable at all. A measured local
    corpus (`~/projects/mirror/paper/typst/body.typ`) carries 258 `#strong[]` spans of which the
    overwhelming majority are table HEADER CELLS (`#strong[(%)]`, `#strong[Items]`). Without this,
    a correctly formatted results table reads as bold saturation.
    """
    ranges: list[tuple[int, int]] = []
    if suffix == ".typ":
        for m in _TYPST_TABLE.finditer(text):
            closer = _find_closer(text, m.end(), "(", ")")
            ranges.append((m.start(), closer + 1 if closer != -1 else len(text)))
    elif suffix in (".tex", ".latex"):
        for m in _LATEX_TABLE_ENV.finditer(text):
            end = re.compile(r"\\end\s*\{" + re.escape(m.group(1)) + r"\}").search(text, m.end())
            ranges.append((m.start(), end.end() if end else len(text)))
    return ranges


def collect_emphasis(text: str, suffix: str) -> list[dict]:
    """Every bold/italic span in `text`, with the structural context the emphasis rules need.

    Returns [{line, col, end, kind: "strong"|"emph", text, in_table, list_item, para_start,
              tail, line_text}] in document order. `line`/`col`/`end` use the same 1-based
    convention as every other span in this script, so an emphasis finding collapses against a
    scored-tic finding on the same words exactly like any other pair.

    Call this on FOOTNOTE-MASKED text and BEFORE neutralisation — masking first is the same
    ordering rationale as the comment above extract_lines: `#footnote[…]` matches the `#name[`
    shape, so a `#strong` inside a note must already be blank by the time this runs.
    """
    lines = text.split("\n")
    line_starts: list[int] = []
    off = 0
    for ln in lines:
        line_starts.append(off)
        off += len(ln) + 1

    import bisect

    def locate(pos: int) -> tuple[int, int]:
        i = bisect.bisect_right(line_starts, pos) - 1
        return i, pos - line_starts[i]

    found: list[tuple[int, int, str, str]] = []   # (start, end, kind, inner)
    if suffix == ".typ":
        for m in _TYPST_EMPH.finditer(text):
            closer = _find_closer(text, m.end(), "[", "]")
            if closer == -1:
                continue
            found.append((m.start(), closer + 1,
                          "strong" if m.group(1) in _STRONG_NAMES else "emph",
                          text[m.end() + 1:closer]))
    elif suffix in (".tex", ".latex"):
        for m in _LATEX_EMPH.finditer(text):
            closer = _find_closer(text, m.end(), "{", "}")
            if closer == -1:
                continue
            found.append((m.start(), closer + 1,
                          "strong" if m.group(1) in _STRONG_NAMES else "emph",
                          text[m.end() + 1:closer]))
        for m in _LATEX_DECL.finditer(text):
            found.append((m.start(), m.end(),
                          "strong" if m.group(1) in _STRONG_NAMES else "emph", m.group(2)))
    else:
        for m in _MD_STRONG.finditer(text):
            found.append((m.start(), m.end(), "strong", m.group(1) or m.group(2) or ""))

    tables = _table_ranges(text, suffix)
    spans: list[dict] = []
    for start, end, kind, inner in sorted(found):
        idx, col0 = locate(start)
        line_text = lines[idx]
        stripped = line_text.lstrip()
        marker = _LIST_MARKER.match(stripped)
        in_table = (any(a <= start < b for a, b in tables)
                    or (suffix not in (".typ", ".tex", ".latex") and stripped.startswith("|")))
        # `para_start`: nothing but whitespace (and at most a list marker) precedes the span on its
        # own line, and that line opens a blank-line-delimited paragraph.
        lead = line_text[:col0].lstrip()
        lead_marker = _LIST_MARKER.match(lead)
        if lead_marker:
            lead = lead[lead_marker.end():]
        para_start = (not lead.strip()
                      and (idx == 0 or bool(_PARA_BREAK.match(lines[idx - 1]))))
        spans.append({
            "line": idx + 1,
            "col": col0 + 1,
            "end": col0 + 1 + (end - start),
            "kind": kind,
            "text": inner,
            "in_table": in_table,
            "list_item": bool(marker),
            "para_start": para_start,
            "tail": line_text[col0 + (end - start):],
            "line_text": line_text,
        })
    return spans


# ── the emphasis rules ───────────────────────────────────────────────────────
# Threshold DERIVED, not tuned to pass. Measured out-of-table `#strong` rates per 1,000 words:
# opv/paper/typst/opv-body.typ 0.03, mirror/paper/typst/body.typ ~0.2 after table exclusion,
# rule611 S7-2026-20_comment.typ 14.1. 3.0 sits an order of magnitude above every clean source and
# well below the motivating case. See docs/investigations/2026-08-05_emphasis-enforcement.md.
_BOLD_DENSITY_PER_1K = 3.0
_BARE_NUMBER = re.compile(
    r"""^\s*[$€£¥]?\s*\d[\d,]*(?:\.\d+)?\s*
        (?:%|×|x|pp|bps|percentage\s+points?)?\s*
        (?:more|less|higher|lower|fewer)?\s*$""",
    re.IGNORECASE | re.VERBOSE)
_BOLD_LEAD_TERM = (".", ":", "?")
# FOUND BY THE FP HUNT, not anticipated: `#strong[Table 1:] Headline reform comparison…` is the
# universal caption convention and accounted for ALL FIVE of mirror/paper/typst/body.typ's
# out-of-table bold-lead hits. An exhibit label is not an inline header, so it is excluded by
# shape rather than by lowering the bar. (The numbered scenario list at body.typ:161-169 was
# already exempt via `list_item`, which is what that exemption exists for.)
_EXHIBIT_LABEL = re.compile(
    r"^(?:table|figure|fig\.?|panel|exhibit|appendix|chart|graph|note|notes|source|sources)\b",
    re.IGNORECASE)
# A document-level RATE needs a document. `mirror/paper/typst/style.typ` is a template with one
# prose word in it, and one bold span over one word is 1,000 per 1,000 — an arithmetic artifact,
# not saturation.
_BOLD_DENSITY_MIN_WORDS = 300


def _emphasis_hits(spans: list[dict], words: int) -> list[dict]:
    """The three emphasis findings, as hit dicts for `add(...)`. All soft — see the caveat above."""
    hits: list[dict] = []
    strong = [s for s in spans if s["kind"] == "strong" and not s["in_table"]]
    for s in strong:
        inner = s["text"].strip()
        context = s["line_text"].strip()[:160]
        if inner and _BARE_NUMBER.match(inner):
            hits.append({"line": s["line"], "col": s["col"], "end": s["end"],
                         "label": f"emphasis·bold-bare-number: bold on the bare quantity "
                                  f"{inner!r} — emphasise the claim, not the digits",
                         "quote": inner, "context": context})
        if (s["para_start"] and not s["list_item"] and inner
                and inner[0].isupper() and inner.endswith(_BOLD_LEAD_TERM)
                and not _EXHIBIT_LABEL.match(inner)
                and re.match(r"\s+\S", s["tail"])):
            hits.append({"line": s["line"], "col": s["col"], "end": s["end"],
                         "label": f"emphasis·bold-lead: paragraph opens with the inline header "
                                  f"{inner!r} — use a prose topic sentence or an italic label",
                         "quote": inner, "context": context})
    rate = len(strong) / max(1, words) * 1000
    if rate > _BOLD_DENSITY_PER_1K and words >= _BOLD_DENSITY_MIN_WORDS:
        hits.append({"line": 0, "col": 0, "end": 0,
                     "label": f"emphasis·bold-density: {len(strong)} out-of-table bold spans "
                              f"({rate:.1f} per 1,000 words; budget {_BOLD_DENSITY_PER_1K})",
                     "quote": f"{len(strong)} bold spans", "context": "document-level"})
    return hits


# ── emojis ───────────────────────────────────────────────────────────────────
# THE ONE `hard` RULE IN THIS SECTION, and it earns it by construction rather than by a corpus
# sweep: an emoji in a law-review draft or an SEC comment letter is indefensible on its face,
# which is exactly the property `hard` denotes here.
#
# Typographic characters that are NOT emoji are excluded by construction: `×` (U+00D7), `—`
# (U+2014), `§` (U+00A7), `†` (U+2020) and `‡` (U+2021) are outside every block below. The
# check/ballot marks U+2713–U+2718 (✓ ✔ ✗ ✘) sit inside Dingbats and ARE excluded by hand — a
# checkmark in a comparison table is defensible prose, and a `hard` rule may not fire on it. Their
# VS16-qualified emoji-presentation forms (`✔️`) still match, via the last alternative.
_EMOJI_RX = re.compile(
    "[\U0001F300-\U0001F5FF]"          # misc symbols & pictographs
    "|[\U0001F600-\U0001F64F]"         # emoticons
    "|[\U0001F680-\U0001F6FF]"         # transport & map
    "|[\U0001F900-\U0001F9FF]"         # supplemental symbols & pictographs
    "|[\U0001FA70-\U0001FAFF]"         # symbols & pictographs extended-A
    "|[\u2700-\u2712\u2719-\u27BF]"    # dingbats, minus the check/ballot marks
    "|[\u2000-\u3300]\uFE0F"           # VS16-qualified BMP emoji presentation
)


# A SLIDE DECK IS NOT A DRAFT, and emoji in one is deliberate. `hooks/writing-prose-check.ts`
# already refuses to lint a deck at all, so nothing automated reaches here; this exists for the
# case that hook cannot cover — running the audit on a deck ON PURPOSE, from the CLI. There,
# `formatting·emoji` drops to `soft`. It stays a finding (you asked for the audit) but it may not
# block a gate, because `hard` means "indefensible in a shipped draft" and a decorated slide
# heading is not that.
#
# TWO IMPLEMENTATIONS IN TWO LANGUAGES, deliberately, and pinned. The hook needs the predicate
# BEFORE it spawns anything (it also skips check-all and the plan lookup), so it cannot ask this
# script. tests/writing-prose-check.test.mjs asserts the two agree over a shared fixture set —
# which is the honest way to carry a duplicated predicate, as against hoping it stays in sync.
_DECK_MARKERS = ("touying", "polylux", "#slide(")
_DECK_DIR_RE = re.compile(r"^(slides|presentation)", re.IGNORECASE)


def is_deck(path: Path) -> bool:
    """True for a Typst SLIDE DECK. Mirrors `isTypDeck` in hooks/writing-prose-check.ts exactly:
    a `slides`/`presentation*` component anywhere in the path, or a deck marker in the content."""
    if path.suffix.lower() != ".typ":
        return False
    if any(_DECK_DIR_RE.match(part) for part in path.parts[:-1]):
        return True
    try:
        text = path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    return any(marker in text for marker in _DECK_MARKERS)


def _emoji_hits(text: str) -> list[dict]:
    """Emoji in prose or headings. Runs over `_prose_only`, so a fenced code block, a quoted
    source and YAML frontmatter are excluded — the same exclusions the em-dash budget uses."""
    hits = []
    for i, line in enumerate(_prose_only(text).split("\n"), 1):
        for m in _EMOJI_RX.finditer(line):
            hits.append({"line": i, "col": m.start() + 1, "end": m.end() + 1,
                         "label": f"formatting·emoji: {m.group(0)!r} in prose",
                         "quote": m.group(0), "context": line.strip()[:160]})
    return hits


def _docx_body_paragraph_count(path: Path) -> int:
    """How many non-empty paragraphs prose_extract will yield from word/document.xml.

    prose_extract.iter_lines numbers document.xml paragraphs first and footnotes.xml after, with
    one shared counter — so every index ABOVE this count is a footnote paragraph, and that is how
    docx footnote masking is done here without forking the extractor.
    """
    from lxml import etree
    ns = prose_extract.W_NS
    count = 0
    with zipfile.ZipFile(path) as z:
        try:
            data = z.read("word/document.xml")
        except KeyError:
            return 0
        for p in etree.fromstring(data).iter(ns + "p"):
            if "".join(t.text or "" for t in p.iter(ns + "t")).strip():
                count += 1
    return count


def extract_lines(path: Path, mask: bool = True
                  ) -> tuple[list[tuple[int, str]], str | None, list[dict]]:
    """Return ([(lineno, text)], masked_full_text_or_None, emphasis_spans).

    Extraction is prose_extract's (docx paragraphs, Typst markup stripping, fenced-code skipping);
    masking runs BEFORE it by rewriting the masked bytes to a temp file with the same suffix, so
    the extractor's own skipping rules apply to exactly the text that will be scored. Masking
    blanks to spaces and preserves line count and offsets, so line/column anchoring stays exact.
    """
    if prose_extract.is_docx(path):
        lines = list(prose_extract.iter_lines(path))
        if mask:
            body = _docx_body_paragraph_count(path)
            lines = [(i, t) for i, t in lines if i <= body]
        return lines, None, []       # docx emphasis is deferred — see collect_emphasis()

    raw = path.read_text(encoding="utf-8", errors="ignore")
    suffix = path.suffix.lower()
    # MARKUP NEUTRALISATION IS NOT FOOTNOTE MASKING and is NOT under `--keep-footnotes`. That flag
    # exists to debug the raw prose signal; markup was never part of the signal, and leaving
    # `#emph[First]` intact would reinstate a HARD false positive whenever the flag is passed.
    #
    # ORDER IS LOAD-BEARING: footnotes are masked FIRST. `#footnote[...]` matches the neutraliser's
    # `#name[` shape, so neutralising first strips the wrapper and leaves the citation text looking
    # like body prose — masking then has nothing left to match, and a finding lands inside a
    # footnote. Caught by test_footnotes_are_masked_in_every_format when this was written the other
    # way round.
    masked = raw
    if mask:
        masked = mask_footnotes(masked)
        if suffix == ".typ":
            masked = mask_typst_footnotes(masked)
    # HARVEST BEFORE NEUTRALISING. Neutralisation blanks the delimiters, so this is the last
    # moment at which emphasis exists in the text at all. Footnotes are already masked above.
    emphasis = collect_emphasis(masked, suffix)
    if suffix == ".typ":
        masked = neutralize_typst_markup(masked)
    elif suffix in (".tex", ".latex"):
        masked = neutralize_latex_markup(masked)
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(suffix=path.suffix or ".md")
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(masked)
        return list(prose_extract.iter_lines(Path(tmp))), masked, emphasis
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass


# ── stylometrics ─────────────────────────────────────────────────────────────
def _run_style(path: Path, lint: bool) -> dict:
    """style_metrics.py, best-effort: {} on any failure (never blocks the audit)."""
    args = [sys.executable, str(STYLE_LINT)] + (["--lint"] if lint else []) + ["--json", str(path)]
    try:
        out = subprocess.run(args, capture_output=True, text=True, timeout=120, check=False)
        if out.returncode not in (0, 1) or not out.stdout.strip():
            return {}
        return json.loads(out.stdout)
    except Exception:
        return {}


def _style_on_text(text: str, suffix: str = ".md") -> tuple[dict, dict]:
    """Run both style_metrics modes over already-masked text. Two calls on purpose: --lint --json
    surfaces only the features that crossed the advisory threshold, plain --json is the full
    per-feature corpus z report."""
    tmp = None
    try:
        fd, tmp = tempfile.mkstemp(suffix=suffix)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        return _run_style(Path(tmp), True), _run_style(Path(tmp), False)
    except Exception:
        return {}, {}
    finally:
        if tmp:
            try:
                os.unlink(tmp)
            except OSError:
                pass


# ── em-dash density (paragraph + section) ────────────────────────────────────
# Absorbed from references/constraints/writing-ai-smell-em-dash.py, thresholds unchanged. It is
# not a per-line regex, so it could not become a wikipedia table entry; it lives here instead.
_EM_DASH = re.compile("—")
_EM_DASH_COLON = re.compile(r"(?:—:|:—)")
_EM_DASH_PARA_THRESHOLD = 4
_EM_DASH_SECTION_THRESHOLD = 4


def _paragraphs(text: str):
    """Yield (start_line, paragraph_text). Blank-line delimited; headings break a paragraph."""
    buf, start = [], 1
    for i, ln in enumerate(text.split("\n"), 1):
        if ln.strip() == "" or ln.lstrip().startswith("#"):
            if buf:
                yield start, "\n".join(buf)
            buf, start = [], i + 1
        else:
            if not buf:
                start = i
            buf.append(ln)
    if buf:
        yield start, "\n".join(buf)


_FRONTMATTER_DELIM = re.compile(r"^---\s*$")
_FENCE = re.compile(r"^(?:```|~~~)")
_BLOCKQUOTE = re.compile(r"^\s*>")
_FOOTNOTE_DEF = re.compile(r"^\s*\[\^")


def _prose_only(text: str) -> str:
    """Blank every line that is not body prose, preserving line count and offsets.

    CARRIED OVER FROM THE DELETED CONSTRAINT, not reinvented: writing-ai-smell-em-dash skipped YAML
    frontmatter, fenced code, blockquotes, footnote definitions and HTML comments before counting.
    Dropping that would have made a quoted statute's dashes count against the author's own budget
    and would have counted a code fence's `—` at all. Blanking rather than deleting keeps paragraph
    starts anchored to real line numbers, and turns each skipped run into a paragraph boundary —
    which is what the original's `flush()` did at the same points.
    """
    out = []
    in_frontmatter = frontmatter_done = in_fence = in_comment = False
    for line in text.split("\n"):
        if not frontmatter_done and _FRONTMATTER_DELIM.match(line):
            in_frontmatter = not in_frontmatter
            if not in_frontmatter:
                frontmatter_done = True
            out.append("")
            continue
        if in_frontmatter:
            out.append("")
            continue
        frontmatter_done = True
        if "<!--" in line:
            in_comment = True
        if in_comment:
            if "-->" in line:
                in_comment = False
            out.append("")
            continue
        stripped = line.strip()
        if _FENCE.match(stripped):
            in_fence = not in_fence
            out.append("")
            continue
        if in_fence or _BLOCKQUOTE.match(line) or _FOOTNOTE_DEF.match(line):
            out.append("")
            continue
        out.append(line)
    return "\n".join(out)


def _em_dash_hits(text: str) -> list[dict]:
    text = _prose_only(text)
    hits = []
    for start_line, para in _paragraphs(text):
        n = len(_EM_DASH.findall(para))
        if n >= _EM_DASH_PARA_THRESHOLD:
            hits.append({"line": start_line, "label": f"em-dash: {n} em-dashes in one paragraph",
                         "quote": para.replace("\n", " ")[:120]})
        elif _EM_DASH_COLON.search(para):
            hits.append({"line": start_line, "label": "em-dash: em-dash adjacent to a colon",
                         "quote": para.replace("\n", " ")[:120]})
    # Per-section budget: LLMs spread em-dashes across adjacent paragraphs even when each one is
    # under the paragraph threshold, which still reads as "every paragraph has one".
    pieces = re.split(r"(^##\s+.+?$)", text, flags=re.MULTILINE)
    sections = [("(preamble)", pieces[0])] if pieces else []
    for i in range(1, len(pieces), 2):
        sections.append((re.sub(r"^##\s+", "", pieces[i]).strip(),
                         pieces[i + 1] if i + 1 < len(pieces) else ""))
    for heading, body in sections:
        n = sum(len(_EM_DASH.findall(p)) for _, p in _paragraphs(body))
        if n > _EM_DASH_SECTION_THRESHOLD:
            hits.append({"line": 0, "label": f"em-dash: {n} em-dashes in section {heading!r} "
                                             f"(budget: {_EM_DASH_SECTION_THRESHOLD})", "quote": heading})
    return hits


# ── hard-wrapped paragraphs ──────────────────────────────────────────────────
# WHO READS THE TEXT, NOT WHAT THE EXTENSION IS. A soft-wrapping reader (an email body, an Obsidian
# note, a web form, a chat message) reflows to its own pane, so a manual break at column 80 lands
# mid-sentence at whatever width the reader happens to use, and a one-word edit forces a re-wrap of
# the whole paragraph. A fixed-width reader (a commit message, a code comment, a SKILL.md, a `.typ`
# or `.tex` source) is read AS SOURCE at a known width, where wrapping is correct — so this rule is
# SKIPPED for those files entirely. The register files that carry this rule are themselves wrapped
# at ~100 columns and correctly so; a rule that fires on them would train the reader to ignore it.
#
# NOT A DICTION TIER. `always_flag` / `cluster` / `density` are rate tiers over diction.yaml's
# word list, and this is not a word signal at all — it is a line-shape signal, so it lives beside
# the other structural rules (em-dash density, emphasis) and carries no tier.
#
# SEVERITY IS `soft`, DELIBERATELY. `hard` in this script means "no false positives, indefensible
# in a shipped draft" and is reserved for the corpus-gated classes. This is a formatting tell whose
# correctness depends on a destination the script cannot see: a `.md` file may be a mail body or a
# design doc read in a terminal. Advisory is the honest severity, and only `hard` may block a gate.
_HARD_WRAP_MIN_COL = 68
_HARD_WRAP_MAX_COL = 100
_HARD_WRAP_RUN = 3
# A line ending a sentence or clause is a deliberate break, not a wrap point. Trailing quotes and
# closers count either way: `…the rule."` and `…(see below)` both end something.
_WRAP_TERMINAL = re.compile(r"""[.!?:;][)\]}"'’”»]*$|["'’”)\]}»]$""")
# Not running prose: a list item, a table row, a heading or setext rule, an image, a link-reference
# definition, or raw HTML. A WRAPPED LIST ITEM IS A DIFFERENT THING and is excluded on purpose,
# together with every indented line (checked separately, since indentation marks a continuation).
_WRAP_NOT_PROSE = re.compile(r"""^(?:[-*+]\s|\d+[.)]\s|\||#|=|!\[|\[[^\]]*\]:|<)""")
_FIXED_WIDTH_SUFFIXES = {".typ", ".tex", ".latex"}
_FIXED_WIDTH_NAMES = {"skill.md", "claude.md", "agents.md", "readme.md",
                      "contributing.md", "changelog.md"}
# Skill/agent bodies wrap correctly and are read as source. Detected by the frontmatter SHAPE
# rather than by any `---` block, so an Obsidian note's `tags:`/`aliases:` frontmatter does not
# buy an exemption the note has not earned.
_SOURCE_FRONTMATTER = re.compile(r"\A---\s*\n(.*?\n)---\s*$", re.DOTALL | re.MULTILINE)
_SOURCE_FM_KEYS = re.compile(
    r"^\s*(?:name|tools|allowed-tools|user-invocable|model|disable-model-invocation):",
    re.MULTILINE)


def is_fixed_width_source(path: Path, text: str) -> bool:
    """True when the file is read AS SOURCE at a fixed width, so wrapping it is correct."""
    if path.suffix.lower() in _FIXED_WIDTH_SUFFIXES:
        return True
    if path.name.lower() in _FIXED_WIDTH_NAMES:
        return True
    fm = _SOURCE_FRONTMATTER.match(text)
    return bool(fm and re.search(r"^\s*description:", fm.group(1), re.MULTILINE)
                and _SOURCE_FM_KEYS.search(fm.group(1)))


def _hard_wrap_hits(text: str) -> list[dict]:
    """Runs of >=3 consecutive prose lines that each end in the wrap band without terminal
    punctuation — the shape a hard-wrapped paragraph makes and one-paragraph-per-line never does.

    Runs over `_prose_only`, so fenced code, YAML frontmatter, blockquotes, footnote definitions
    and HTML comments are already blank — and a blank line ends a run, which is what keeps a code
    fence or a table from being read as one long paragraph.
    """
    hits: list[dict] = []
    run: list[tuple[int, str]] = []

    def flush() -> None:
        if len(run) >= _HARD_WRAP_RUN:
            cols = [len(t) for _, t in run]
            hits.append({
                "line": run[0][0],
                "label": f"formatting·hard-wrap: {len(run)} consecutive lines end at columns "
                         f"{min(cols)}–{max(cols)} without terminal punctuation — the paragraph is "
                         f"hard-wrapped. A soft-wrapping reader (email body, Obsidian note, web "
                         f"form, chat) reflows to its own pane, so these breaks land mid-sentence "
                         f"at the reader's width and a one-word edit re-wraps the whole paragraph. "
                         f"One paragraph, one line.",
                "quote": run[0][1][:120],
            })
        run.clear()

    for i, line in enumerate(_prose_only(text).split("\n"), 1):
        stripped = line.rstrip()
        if (stripped and not line[:1].isspace()
                and _HARD_WRAP_MIN_COL <= len(stripped) <= _HARD_WRAP_MAX_COL
                and not _WRAP_NOT_PROSE.match(stripped)
                and not _WRAP_TERMINAL.search(stripped)):
            run.append((i, stripped))
        else:
            flush()
    flush()
    return hits


# ── the audit ────────────────────────────────────────────────────────────────
def _collapse(raw: list[dict]) -> list[dict]:
    """Collapse overlapping hits into one span per (line, overlapping column range).

    THIS IS THE POINT OF THE SCRIPT. `rich tapestry` matches wikipedia-promotional AND the sev4
    scored tic; before this, that phrase was reported twice under two labels with two severities.
    The collapsed span carries EVERY contributing label and the HIGHEST contributing severity.

    Spans with col == 0 are line- or document-anchored without a column (stylometrics, diction
    density, em-dash density). They never collapse into a column-anchored span, and never into
    each other — merging an em-dash advisory with a structural hit that happens to start the same
    line would report two unrelated findings as one.
    """
    by_line: dict[int, list[dict]] = {}
    for hit in raw:
        by_line.setdefault(hit["line"], []).append(hit)

    spans: list[dict] = []
    for line in sorted(by_line):
        anchored = sorted([h for h in by_line[line] if h["col"] > 0],
                          key=lambda h: (h["col"], -h["end"]))
        spans.extend(h | {"labels": [h["label"]], "systems": [h["system"]]}
                     for h in by_line[line] if h["col"] == 0)
        group: list[dict] = []
        group_end = -1
        for hit in anchored:
            if group and hit["col"] < group_end:
                group.append(hit)
                group_end = max(group_end, hit["end"])
            else:
                if group:
                    spans.append(_merge(group))
                group, group_end = [hit], hit["end"]
        if group:
            spans.append(_merge(group))

    spans.sort(key=lambda s: (s["line"] if s["line"] else 10 ** 9, s["col"]))
    for i, span in enumerate(spans, 1):
        span["id"] = f"S{i:03d}"
    return [{
        "id": s["id"], "line": s["line"], "col": s["col"], "system": s["system"],
        "systems": s["systems"], "labels": s["labels"], "severity": s["severity"],
        "quote": s["quote"], "context": s.get("context", ""), "replace_with": s.get("replace_with", ""),
    } for s in spans]


def _merge(group: list[dict]) -> dict:
    severity = SOFT
    for hit in group:
        severity = _worst(severity, hit["severity"])
    # The reported `system` is the highest-severity contributor, first in load order among ties —
    # so a hard provenance leak names itself even when a soft table matched the same words.
    lead = max(group, key=lambda h: (_SEV_RANK.get(h["severity"], 0), len(h["quote"])))
    widest = max(group, key=lambda h: len(h["quote"]))
    return {
        "line": group[0]["line"], "col": min(h["col"] for h in group),
        "system": lead["system"],
        "systems": sorted({h["system"] for h in group}),
        "labels": [h["label"] for h in group],
        "severity": severity,
        "quote": widest["quote"],
        "context": group[0].get("context", ""),
        "replace_with": next((h.get("replace_with") for h in group if h.get("replace_with")), ""),
    }


def audit_document(path: Path, style: str | None = None, mask: bool = True,
                   tiers_on=("always_flag", "cluster", "density"),
                   profile: str = "full") -> dict:
    """The unified deterministic audit. Returns {file, style, spans, signals, z, counts}.

    `profile` selects which systems contribute (see `system_enabled`). It gates at the single
    `add()` funnel rather than at each call site, so a system added later is covered by
    construction and `full` — which enables everything — keeps its exact behaviour."""
    lines, masked_text, emphasis_spans = extract_lines(path, mask=mask)
    patterns = load_pattern_systems(style)
    diction = load_diction()
    raw: list[dict] = []

    def add(line, col, end, system, label, severity, quote, context, replace_with=""):
        if not system_enabled(system, profile):
            return
        raw.append({"line": line, "col": col, "end": end, "system": system, "label": label,
                    "severity": severity, "quote": quote, "context": context,
                    "replace_with": replace_with})

    # --- A + B + D: regex tables, line-anchored with real columns ---
    for lineno, text in lines:
        context = text.strip()[:160]
        for system, label, severity, rx in patterns:
            for m in rx.finditer(text):
                add(lineno, m.start() + 1, m.end() + 1, system, label, severity,
                    m.group(0), context)
        # --- US-register spelling ---
        for word, rx in _BRITISH_RX.items():
            for m in rx.finditer(text):
                add(lineno, m.start() + 1, m.end() + 1, "spelling",
                    f"spelling·british·{word}", SOFT, m.group(0), context, BRITISH[word])
        # --- E: diction, always_flag tier (every occurrence) ---
        if "always_flag" in tiers_on:
            for e in diction["always_flag"]:
                for m in e["rx"].finditer(text):
                    add(lineno, m.start() + 1, m.end() + 1, "diction",
                        f"diction·always_flag·{e['word']}", SOFT, m.group(0), context,
                        e["replace_with"])

    body = "\n".join(t for _, t in lines)
    words = max(1, len(re.findall(r"\b\w+\b", body)))
    line_text = {i: t for i, t in lines}

    # --- E: diction, cluster tier (2+ fancy words in one paragraph) ---
    if "cluster" in tiers_on:
        for pstart, ptext in _paragraphs("\n".join(
                line_text.get(i, "") for i in range(1, (max(line_text) if line_text else 0) + 1))):
            phits = []
            for e in diction["cluster"]:
                for m in e["rx"].finditer(ptext):
                    # `m.start()` indexes the whole PARAGRAPH; a column has to be relative to its
                    # LINE. Using the paragraph offset put every match after the first line at a
                    # column past the end of its own line, which both mislocated the span and
                    # broke overlap collapse against every other system's real columns.
                    line_start = ptext.rfind("\n", 0, m.start()) + 1
                    phits.append((pstart + ptext[:m.start()].count("\n"),
                                  m.start() - line_start, m.end() - line_start, m.group(0), e))
            if len(phits) >= 2:
                for line, col, end, token, e in phits:
                    add(line, col + 1, end + 1, "diction",
                        f"diction·cluster·{e['word']} ({len(phits)} fancy words this paragraph)",
                        SOFT, token, line_text.get(line, "").strip()[:160], e["replace_with"])

    # --- E: diction, density tier (document-level saturation) ---
    density_words = []
    if "density" in tiers_on:
        seen, dcount = [], 0
        for e in diction["density"]:
            n = len(e["rx"].findall(body))
            if n:
                dcount += n
                seen.append((e["word"], n))
        rate = dcount / words
        if rate >= 0.03:
            density_words = sorted(seen, key=lambda x: -x[1])
            for word, n in density_words:
                add(0, 0, 0, "diction", f"diction·density·{word} ×{n}", SOFT, word,
                    f"density saturation ({rate * 100:.1f}% fancy words)")

    # --- em-dash density (text formats only; a docx paragraph list has no sections) ---
    if masked_text is not None:
        for hit in _em_dash_hits(masked_text):
            add(hit["line"], 0, 0, "em-dash", hit["label"], SOFT, hit["quote"], hit["quote"])

    # --- hard-wrapped paragraphs (soft-wrapping readers only; see is_fixed_width_source) ---
    if masked_text is not None and not is_fixed_width_source(path, masked_text):
        for hit in _hard_wrap_hits(masked_text):
            add(hit["line"], 0, 0, "formatting", hit["label"], SOFT, hit["quote"], hit["quote"])

    # --- emphasis (bold/italic markup) and emojis; text formats only ---
    for hit in _emphasis_hits(emphasis_spans, words):
        add(hit["line"], hit["col"], hit["end"], "emphasis", hit["label"], SOFT,
            hit["quote"], hit["context"])
    if masked_text is not None:
        deck = is_deck(path)
        for hit in _emoji_hits(masked_text):
            add(hit["line"], hit["col"], hit["end"], "formatting",
                hit["label"] + (" (slide deck — advisory)" if deck else ""),
                SOFT if deck else HARD, hit["quote"], hit["context"])

    # --- stylometrics, over the SAME masked text the tables saw ---
    style_lint, style_score = _style_on_text(
        masked_text if masked_text is not None else body,
        path.suffix if path.suffix in (".md", ".txt", ".typ") else ".md")
    for f in style_lint.get("findings", []):
        add(int(f.get("line") or 0), 0, 0, "style", f"style·{f.get('type')}: {f.get('message', '')}",
            SOFT, f.get("excerpt", ""), f.get("excerpt", ""))

    spans = _collapse(raw)
    counts: dict[str, int] = {}
    for span in spans:
        counts[span["system"]] = counts.get(span["system"], 0) + 1
    hard = [s for s in spans if s["severity"] == HARD]
    tic_weighted = sum(
        int(re.search(r"sev(\d)", lab).group(1))
        for s in spans for lab in s["labels"] if lab.startswith("ai-tic·sev"))

    return {
        "file": str(path),
        "style": (style or "general").lower(),
        "words": words,
        "spans": spans,
        "signals": {
            "composite_human_likeness": style_lint.get("composite_human_likeness"),
            "tic_density": round(min(100.0, tic_weighted / words * 1000 * 8), 1),
            "advisories": style_lint.get("advisories", []),
            "density_words": density_words,
        },
        "z": {
            "stylometric_per_feature": style_score.get("per_feature", {}),
            "stylometric_mean_abs_z": style_score.get("mean_abs_z"),
        },
        "counts": counts,
        "n_spans": len(spans),
        "n_hard": len(hard),
    }


# ═════════════════════════════════════════════════════════════════════════════
# PROFILE: de-ai — the de-ai-revise rewrite view.
#
# A DIFFERENT SHAPE ON PURPOSE, not a subset of the span list above. de-ai-revise consumes a
# rewrite worklist (`type`, `sev_score`, `message`, `replace_with`) plus draft-level signals, and
# skills/de-ai-revise/SKILL.md and two test files are written against those exact keys. Keeping
# the shape is how this consolidation stays behaviour-preserving for that skill. The pattern
# LOADERS are shared with the audit above; only the assembly differs.
# ═════════════════════════════════════════════════════════════════════════════
def _load_tics():
    """[(compiled, label, sev)] from the in-plugin scored table."""
    out = []
    for rx, label in _compile_table(SCORED_TICS, "_TIC_PATTERNS", True):
        m = re.search(r"sev(\d)", label)
        out.append((rx, label, int(m.group(1)) if m else 1))
    return out


def _diction_rate_report(text: str, diction: dict, words: int, tiers_on) -> dict:
    """Draft-vs-corpus RATIO (not a z-score) for every diction word observed in the draft: the
    corpus baseline (diction.yaml rate_per_M) is a single point estimate per word, not a mean+std
    over many documents, so there is no standard deviation to divide by. A corpus rate of 0 is
    reported as `ratio: null` — the word was never observed in 14.3M human sentences at all."""
    report = {}
    for tier_name, entries in diction.items():
        if tier_name not in tiers_on:
            continue
        for e in entries:
            n = len(e["rx"].findall(text))
            if not n:
                continue
            draft_rate = n * 1_000_000 / words
            human_rate = e["rate"]
            report[e["word"]] = {
                "tier": tier_name, "count": n,
                "draft_rate_per_M": round(draft_rate, 1),
                "human_rate_per_M": human_rate,
                "ratio_vs_human": round(draft_rate / human_rate, 1) if human_rate > 0 else None,
            }
    return report


def de_ai_audit_text(text: str, path: str = "<text>",
                     tiers_on=("always_flag", "cluster", "density"),
                     mask_fn: bool = True) -> dict:
    if mask_fn:
        text = mask_footnotes(text)
    tics = _load_tics()
    diction = load_diction()
    lines = text.split("\n")
    words = max(1, len(re.findall(r"\b\w+\b", text)))
    spans = []

    tic_weighted = tic_flags = 0
    for rx, label, sev in tics:
        for i, ln in enumerate(lines, 1):
            for m in rx.finditer(ln):
                tic_flags += 1
                tic_weighted += sev
                spans.append({
                    "line": i, "type": "tic", "severity": "major" if sev >= 4 else "minor",
                    "sev_score": sev, "label": label, "text": m.group(0), "replace_with": "",
                    "message": f"AI-tic ({label}) — rewrite; real authors do not write this.",
                })

    for w, rx in _BRITISH_RX.items():
        for i, ln in enumerate(lines, 1):
            for m in rx.finditer(ln):
                spans.append({
                    "line": i, "type": "spelling:british", "severity": "major",
                    "sev_score": 3, "label": f"spelling·british·{w}",
                    "text": m.group(0), "replace_with": BRITISH[w],
                    "message": f"British spelling '{m.group(0)}' -> '{BRITISH[w]}' "
                               f"(drop this check for a UK-register document).",
                })

    if "always_flag" in tiers_on:
        for e in diction["always_flag"]:
            for i, ln in enumerate(lines, 1):
                for m in e["rx"].finditer(ln):
                    spans.append({
                        "line": i, "type": "diction:always_flag", "severity": "major",
                        "sev_score": 4, "label": f"diction·always_flag·{e['word']}",
                        "text": m.group(0), "replace_with": e["replace_with"],
                        "message": f"'{m.group(0)}' -> {e['replace_with']}",
                    })

    if "cluster" in tiers_on:
        for pstart, ptext in _de_ai_paragraphs(text):
            phits = []
            for e in diction["cluster"]:
                for m in e["rx"].finditer(ptext):
                    phits.append((pstart + ptext[:m.start()].count("\n"), m.group(0), e))
            if len(phits) >= 2:
                for line, tok, e in phits:
                    spans.append({
                        "line": line, "type": "diction:cluster", "severity": "minor",
                        "sev_score": 2, "label": f"diction·cluster·{e['word']}",
                        "text": tok, "replace_with": e["replace_with"],
                        "message": f"cluster ({len(phits)} fancy words this paragraph): "
                                   f"'{tok}' -> {e['replace_with']}",
                    })

    density_words = []
    if "density" in tiers_on:
        dcount, seen = 0, []
        for e in diction["density"]:
            n = len(e["rx"].findall(text))
            if n:
                dcount += n
                seen.append((e["word"], n))
        density_rate = dcount / words
        if density_rate >= 0.03:
            density_words = sorted(seen, key=lambda x: -x[1])
            for w, n in density_words:
                spans.append({
                    "line": 0, "type": "diction:density", "severity": "minor",
                    "sev_score": 1, "label": f"diction·density·{w}",
                    "text": w, "replace_with": "", "count": n,
                    "message": f"density saturation ({density_rate * 100:.1f}% fancy words): "
                               f"'{w}' x{n} — vary toward plainer diction",
                })

    style = style_score = {}
    if path not in ("<text>",):
        if mask_fn:
            style, style_score = _style_on_text(text)
        else:
            p = Path(path)
            style, style_score = _run_style(p, True), _run_style(p, False)
    for f in style.get("findings", []):
        spans.append({
            "line": f.get("line", 0), "type": f"style:{f.get('type')}",
            "severity": f.get("severity", "minor"),
            "sev_score": 3 if f.get("severity") == "high" else 1,
            "label": f"style·{f.get('type')}", "text": f.get("excerpt", ""),
            "replace_with": "", "message": f.get("message", ""),
        })

    spans.sort(key=lambda s: (s["line"] if s["line"] else 10 ** 9, -s["sev_score"]))
    by_type: dict[str, int] = {}
    for s in spans:
        by_type[s["type"]] = by_type.get(s["type"], 0) + 1

    return {
        "file": path,
        "words": words,
        "composite_human_likeness": style.get("composite_human_likeness"),
        "tic_density": round(min(100.0, tic_weighted / words * 1000 * 8), 1),
        "tic_flags": tic_flags,
        "n_spans": len(spans),
        "by_type": by_type,
        "spans": spans,
        "advisories": style.get("advisories", []),
        "density_words": density_words,
        "z_report": {
            "stylometric_per_feature": style_score.get("per_feature", {}),
            "stylometric_mean_abs_z": style_score.get("mean_abs_z"),
            "diction_rate_vs_human": _diction_rate_report(text, diction, words, tiers_on),
        },
    }


def _de_ai_paragraphs(text: str):
    """Blank-line-delimited paragraphs. Distinct from _paragraphs above, which also breaks on a
    markdown heading; the de-ai cluster tier never did, and changing it would move findings."""
    buf, start = [], 1
    for i, ln in enumerate(text.split("\n"), 1):
        if ln.strip() == "":
            if buf:
                yield start, "\n".join(buf)
            buf, start = [], i + 1
        else:
            if not buf:
                start = i
            buf.append(ln)
    if buf:
        yield start, "\n".join(buf)


def de_ai_audit_file(path: str, tiers_on, mask_fn: bool = True) -> dict:
    return de_ai_audit_text(Path(path).read_text(encoding="utf-8", errors="ignore"),
                            path, tiers_on, mask_fn=mask_fn)


def de_ai_report(res: dict) -> None:
    c = res["composite_human_likeness"]
    print(f"\n{res['file']}")
    print(f"  human-likeness composite: {c if c is not None else 'n/a'}/100   "
          f"AI-tic density: {res['tic_density']}/100   spans: {res['n_spans']}")
    if res["by_type"]:
        print("  " + "  ".join(f"{k}:{v}" for k, v in sorted(res["by_type"].items())))
    for s in res["spans"][:60]:
        loc = f"L{s['line']}" if s["line"] else "doc"
        print(f"    [{s['severity']:<5} {loc:>5}] {s['message']}")
    if res["n_spans"] > 60:
        print(f"    … +{res['n_spans'] - 60} more")
    for a in res["advisories"]:
        print(f"    [advisory] {a.get('message', '')}")
    if not res["spans"] and not res["advisories"]:
        print("    (clean — no AI-prose tells)")
    zr = res.get("z_report", {})
    flagged = {k: v for k, v in zr.get("stylometric_per_feature", {}).items() if v.get("flag")}
    if flagged:
        print("  z-vs-human (stylometric features, |z|>2 on the AI side):")
        for k, v in sorted(flagged.items(), key=lambda kv: -abs(kv[1]["z"])):
            print(f"    z={v['z']:+.2f}  {k}: {v['value']} (human mean {v['human_mean']})")
    rates = zr.get("diction_rate_vs_human", {})
    if rates:
        print("  diction rate vs. human corpus (ratio, not z — no per-word std baseline):")
        for w, v in sorted(rates.items(), key=lambda kv: -(kv[1]["ratio_vs_human"] or 0)):
            ratio = v["ratio_vs_human"]
            shown = f"{ratio}x" if ratio is not None else "unseen in corpus"
            print(f"    {w}: draft {v['draft_rate_per_M']}/M vs human "
                  f"{v['human_rate_per_M']}/M ({shown})")


# ── CLI ──────────────────────────────────────────────────────────────────────
def _report(res: dict) -> None:
    print(f"\n{res['file']}  ({res['style']} · {res['words']} words)")
    sig = res["signals"]
    print(f"  human-likeness composite: {sig['composite_human_likeness'] or 'n/a'}/100   "
          f"AI-tic density: {sig['tic_density']}/100   "
          f"spans: {res['n_spans']} ({res['n_hard']} hard)")
    if res["counts"]:
        print("  " + "  ".join(f"{k}:{v}" for k, v in sorted(res["counts"].items())))
    for s in res["spans"]:
        loc = f"L{s['line']}:{s['col']}" if s["line"] else "doc"
        print(f"    [{s['severity']:<4} {s['id']} {loc:>10}] {' | '.join(s['labels'])}")
        if s["quote"]:
            print(f"        {s['quote'][:110]!r}"
                  + (f"  →  {s['replace_with']}" if s["replace_with"] else ""))
    for a in sig["advisories"]:
        print(f"    [advisory] {a.get('message', '')}")
    if not res["spans"] and not sig["advisories"]:
        print("    (clean — no deterministic prose findings)")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("files", nargs="+")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--profile", default="full", choices=("full", "de-ai", "deck"),
                    help="full (default) = the unified span list; de-ai = the de-ai-revise "
                         "rewrite view (the legacy de_ai_audit.py JSON shape); deck = the "
                         "restricted ruleset for a Typst slide deck (provenance and correctness "
                         "on, prose-rhythm budgets off)")
    ap.add_argument("--style", default=None, choices=("legal", "econ", "general"),
                    help="domain style guide to load on top of the always-on tables")
    ap.add_argument("--tier", default="always_flag,cluster,density",
                    help="diction tiers to apply (comma-sep)")
    ap.add_argument("--keep-footnotes", action="store_true",
                    help="do NOT mask footnotes before scoring (debugging the raw signal)")
    a = ap.parse_args()
    tiers_on = tuple(t.strip() for t in a.tier.split(",") if t.strip())

    results: dict[str, dict] = {}
    worst = 0
    for name in a.files:
        path = Path(name)
        if not path.exists():
            print(f"WARN: {path} not found", file=sys.stderr)
            continue
        if a.profile == "de-ai":
            res = de_ai_audit_file(str(path), tiers_on, mask_fn=not a.keep_footnotes)
            worst = max(worst, 1 if res["n_spans"] else 0)
            if not a.json:
                de_ai_report(res)
        else:
            res = audit_document(path, style=a.style, mask=not a.keep_footnotes,
                                 tiers_on=tiers_on, profile=a.profile)
            worst = max(worst, 1 if res["n_hard"] else 0)
            if not a.json:
                _report(res)
        results[str(path)] = res

    if a.json:
        print(json.dumps(results if len(results) != 1 else next(iter(results.values())), indent=2))
    sys.exit(worst)


if __name__ == "__main__":
    main()
