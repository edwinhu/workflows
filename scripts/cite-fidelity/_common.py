"""Shared helpers for the cite-fidelity pipeline (stages 1-4).

Loads project context from `.planning/ACTIVE_WORKFLOW.md` frontmatter so every
script in this directory works for any writing project that uses
`writing-setup` to lay down ACTIVE_WORKFLOW.md.

Required frontmatter fields:
    project_root   absolute path to the writing project root
    bibliography   path to .bib file, relative to project_root
    nlm_notebook   NLM notebook UUID populated with the project sources

Conventional (relative to project_root):
    drafts/        markdown draft sections
    .planning/     workflow state (CITES-*.md gate artifacts land here)
    references/    bib + source_summaries.md
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path
from typing import Iterable


NLM_BIN = os.environ.get("NLM_BIN", str(Path.home() / "projects/nlm/nlm"))
DEFAULT_NLM_TIMEOUT = 240
DEFAULT_NLM_BATCH_TIMEOUT = 360
INTER_CALL_DELAY = 1.0
CROSSREF_PREFIXES = ("tbl:", "fig:", "sec:", "eq:", "lst:")


class ContextError(RuntimeError):
    """Raised when ACTIVE_WORKFLOW.md is missing or malformed."""


def _parse_frontmatter(text: str) -> dict[str, str]:
    if not text.startswith("---"):
        return {}
    parts = text.split("---", 2)
    if len(parts) < 3:
        return {}
    meta: dict[str, str] = {}
    for line in parts[1].splitlines():
        if ":" not in line:
            continue
        key, _, val = line.partition(":")
        meta[key.strip()] = val.strip().strip("'\"")
    return meta


def _find_active_workflow(start: Path) -> Path:
    cur = start.resolve()
    for parent in [cur, *cur.parents]:
        candidate = parent / ".planning" / "ACTIVE_WORKFLOW.md"
        if candidate.exists():
            return candidate
    raise ContextError(
        "Could not find .planning/ACTIVE_WORKFLOW.md walking up from "
        f"{start}. Run /writing-setup to create it, or run this script "
        "from inside the writing project directory."
    )


def load_active_workflow(start: Path | None = None) -> dict:
    """Resolve the writing project context.

    Returns a dict with absolute paths and the NLM notebook id."""
    start = Path(start or os.getcwd())
    aw_path = _find_active_workflow(start)
    meta = _parse_frontmatter(aw_path.read_text())

    project_root = meta.get("project_root", "").strip()
    if not project_root:
        # Fall back to the directory containing .planning/
        project_root = str(aw_path.parent.parent)

    project = Path(project_root).resolve()
    bib_rel = meta.get("bibliography", "references/sources.bib").strip()
    notebook = meta.get("nlm_notebook", "").strip()

    return {
        "project_root": project,
        "bibliography_path": (project / bib_rel).resolve(),
        "nlm_notebook": notebook,
        "drafts_dir": (project / "drafts").resolve(),
        "planning_dir": (project / ".planning").resolve(),
        "references_dir": (project / "references").resolve(),
        "active_workflow_path": aw_path,
    }


def require_notebook(ctx: dict) -> str:
    notebook = ctx.get("nlm_notebook", "")
    if not notebook:
        raise ContextError(
            "ACTIVE_WORKFLOW.md is missing the `nlm_notebook` field. "
            "Add the NLM notebook UUID to the frontmatter to enable "
            "cite-fidelity checks."
        )
    return notebook


# ---------------------------------------------------------------------------
# Bib parsing (lifted from mirror_voting/scratch/parse_bib.py)
# ---------------------------------------------------------------------------

def parse_bib(text: str) -> dict[str, dict[str, str]]:
    """Parse a BibTeX string into {bibkey: {field: value}}."""
    out: dict[str, dict[str, str]] = {}
    pattern = re.compile(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", re.MULTILINE)
    for m in pattern.finditer(text):
        bibtype = m.group(1)
        bibkey = m.group(2)
        start = m.end()
        depth = 1
        i = start
        while i < len(text) and depth > 0:
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
            i += 1
        body = text[start:i - 1]
        fields: dict[str, str] = {"type": bibtype}
        idx = 0
        fpat = re.compile(r"(\w+)\s*=\s*", re.MULTILINE)
        while idx < len(body):
            fm = fpat.search(body, idx)
            if not fm:
                break
            fname = fm.group(1).lower()
            fstart = fm.end()
            while fstart < len(body) and body[fstart] in " \t\n":
                fstart += 1
            if fstart >= len(body):
                break
            opener = body[fstart]
            if opener == "{":
                fdepth = 1
                fend = fstart + 1
                while fend < len(body) and fdepth > 0:
                    if body[fend] == "{":
                        fdepth += 1
                    elif body[fend] == "}":
                        fdepth -= 1
                    fend += 1
                value = body[fstart + 1:fend - 1]
                idx = fend
            elif opener == '"':
                fend = body.find('"', fstart + 1)
                if fend == -1:
                    break
                value = body[fstart + 1:fend]
                idx = fend + 1
            else:
                fend = fstart
                while fend < len(body) and body[fend] not in ",\n":
                    fend += 1
                value = body[fstart:fend].strip()
                idx = fend
            fields[fname] = re.sub(r"[{}]", "", value).strip()
            while idx < len(body) and body[idx] in ", \t\n":
                idx += 1
        out[bibkey] = fields
    return out


def load_bib(ctx: dict) -> dict[str, dict[str, str]]:
    bib_path: Path = ctx["bibliography_path"]
    if not bib_path.exists():
        return {}
    return parse_bib(bib_path.read_text())


# ---------------------------------------------------------------------------
# NLM CLI wrappers
# ---------------------------------------------------------------------------

_SOURCE_LINE_RE = re.compile(
    r"^([0-9a-f-]{36})\s+(.+?)\s+(?:SOURCE_TYPE_\S+|\d+)\s+SOURCE_STATUS_\S+\s+(\S+)$"
)


def parse_sources_listing(notebook_id: str) -> dict[str, dict[str, str]]:
    """Return {title: {sid, last_updated}} for sources in the notebook."""
    out = subprocess.check_output([NLM_BIN, "sources", notebook_id], text=True)
    sources: dict[str, dict[str, str]] = {}
    for line in out.splitlines():
        m = _SOURCE_LINE_RE.match(line)
        if not m:
            continue
        sid, title, ts = m.group(1), m.group(2).strip(), m.group(3)
        sources[title] = {"sid": sid, "last_updated": ts}
    return sources


def sid_map(notebook_id: str) -> dict[str, str]:
    return {title: meta["sid"] for title, meta in parse_sources_listing(notebook_id).items()}


def call_nlm_scoped(notebook_id: str, sid: str, prompt: str,
                    timeout: int = DEFAULT_NLM_TIMEOUT) -> tuple[str, str | None]:
    cmd = [NLM_BIN, "--format", "plain", "--source-id", sid,
           "generate-chat", notebook_id, prompt]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            return "", f"exit={r.returncode}: {r.stderr.strip()[:200]}"
        return r.stdout.strip(), None
    except subprocess.TimeoutExpired:
        return "", f"timeout after {timeout}s"
    except Exception as e:  # noqa: BLE001
        return "", f"exception: {e}"


def call_nlm_batch(notebook_id: str, sids: Iterable[str], prompt: str,
                   timeout: int = DEFAULT_NLM_BATCH_TIMEOUT) -> tuple[str, str | None]:
    cmd = [NLM_BIN, "--format", "plain"]
    for sid in sids:
        cmd += ["--source-id", sid]
    cmd += ["generate-chat", notebook_id, prompt]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0:
            return "", f"exit={r.returncode}: {r.stderr.strip()[:200]}"
        return r.stdout.strip(), None
    except subprocess.TimeoutExpired:
        return "", f"timeout after {timeout}s"
    except Exception as e:  # noqa: BLE001
        return "", f"exception: {e}"


def parse_json_response(text: str) -> dict | None:
    s = text.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```\s*$", "", s)
    lo, hi = s.find("{"), s.rfind("}")
    if lo == -1 or hi == -1 or hi < lo:
        return None
    try:
        return json.loads(s[lo:hi + 1])
    except json.JSONDecodeError:
        return None


def parse_json_array(text: str) -> list | None:
    s = text.strip()
    s = re.sub(r"^```(?:json)?\s*", "", s)
    s = re.sub(r"\s*```\s*$", "", s)
    lo, hi = s.find("["), s.rfind("]")
    if lo == -1 or hi == -1 or hi < lo:
        return None
    try:
        return json.loads(s[lo:hi + 1])
    except json.JSONDecodeError:
        return None


# ---------------------------------------------------------------------------
# Citation extraction (lifted from mirror_voting/scratch/extract_cites.py)
# ---------------------------------------------------------------------------

SIGNALS_SOFT = [
    "but see, e.g.",
    "see, e.g.",
    "see also",
    "but see",
    "see generally",
    "see",
    "cf.",
    "cf",
    "compare",
]
SIGNALS_SOFT_SORTED = sorted(SIGNALS_SOFT, key=len, reverse=True)

CITE_PATTERN = re.compile(
    r"\[([^\[\]]*?@[^\[\]]+?)\]|(?<![\[\w])@([A-Za-z][A-Za-z0-9_:\-./]+)"
)


def _extract_from_text(text: str) -> list[tuple[str, str | None, int]]:
    results: list[tuple[str, str | None, int]] = []
    for m in CITE_PATTERN.finditer(text):
        if m.group(1):
            inner = m.group(1)
            offset = m.start()
            for part in inner.split(";"):
                part = part.strip()
                key_match = re.search(r"@([A-Za-z][A-Za-z0-9_:\-./]+)", part)
                if not key_match:
                    continue
                bibkey = key_match.group(1).rstrip(".,")
                if bibkey.startswith(CROSSREF_PREFIXES):
                    continue
                pre = part[:key_match.start()].strip().lower().rstrip(",").strip()
                pre = re.sub(r"^[*_\s]+|[*_\s]+$", "", pre)
                signal = None
                for sig in SIGNALS_SOFT_SORTED:
                    if pre.endswith(sig) or pre == sig:
                        signal = sig
                        break
                results.append((bibkey, signal, offset))
        else:
            bibkey = m.group(2).rstrip(".,")
            if bibkey.startswith(CROSSREF_PREFIXES):
                continue
            offset = m.start()
            pre_window = text[max(0, offset - 40):offset]
            signal = None
            for sig in SIGNALS_SOFT_SORTED:
                pat = re.compile(r"(^|[\s,;*_])" + re.escape(sig) + r"\s*$",
                                 re.IGNORECASE)
                if pat.search(pre_window):
                    signal = sig
                    break
            results.append((bibkey, signal, offset))
    return results


def _find_parenthetical_after(text: str, end_offset: int) -> str | None:
    i = end_offset
    while i < len(text) and text[i] in " \t":
        i += 1
    if i < len(text) and text[i] == "(":
        depth = 1
        j = i + 1
        while j < len(text) and depth > 0:
            if text[j] == "(":
                depth += 1
            elif text[j] == ")":
                depth -= 1
            j += 1
        if depth == 0:
            return text[i + 1:j - 1].strip()
    return None


def _get_sentence_around(text: str, offset: int) -> str:
    # When called with the position of a Markdown footnote marker `[^...]`, the
    # marker anchors the preceding sentence (e.g., "claim.[^a]"). Step the
    # offset back one char so the walks land inside that sentence.
    if (
        offset > 0
        and text[offset:offset + 2] == "[^"
        and text[offset - 1] in ".?!"
    ):
        offset -= 1
    start = offset
    while start > 0:
        c = text[start - 1]
        if c in ".?!" and (
            start >= len(text)
            or text[start:start + 1] in (" ", "\n", "\t")
            or text[start:start + 2] == "[^"
        ):
            break
        if c == "\n" and start > 1 and text[start - 2] == "\n":
            break
        start -= 1
    end = offset
    while end < len(text):
        c = text[end]
        if c in ".?!" and (
            end + 1 >= len(text)
            or text[end + 1] in (" ", "\n", "\t", "")
            or text[end + 1:end + 3] == "[^"
        ):
            end += 1
            break
        if c == "\n" and end + 1 < len(text) and text[end + 1] == "\n":
            break
        end += 1
    return re.sub(r"\s+", " ", text[start:end].strip())


def _line_of_offset(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _parse_footnote_defs(text: str) -> dict[str, tuple[int, int]]:
    fn_map: dict[str, tuple[int, int]] = {}
    pattern = re.compile(r"^\[\^([^\]]+)\]:\s*(.*)", re.MULTILINE)
    matches = list(pattern.finditer(text))
    for i, m in enumerate(matches):
        label = m.group(1)
        body_start = m.start(2)
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body_text = text[body_start:body_end]
        bb = body_text.find("\n\n")
        if bb != -1:
            body_end = body_start + bb
        fn_map[label] = (body_start, body_end)
    return fn_map


def _find_footnote_marker(text: str, label: str) -> int | None:
    pattern = re.compile(r"\[\^" + re.escape(label) + r"\](?!:)")
    for m in pattern.finditer(text):
        line_after = text[m.end():m.end() + 2]
        if line_after.startswith(":"):
            continue
        return m.start()
    return None


def extract_cites_for_file(path: Path) -> list[dict]:
    """Extract per-cite records: file, line, bibkey, signal, claim, primary, prompt_style."""
    text = path.read_text()
    fn_defs = _parse_footnote_defs(text)
    fn_ranges = [(label, s, e) for label, (s, e) in fn_defs.items()]
    cites = _extract_from_text(text)
    out: list[dict] = []
    for bibkey, signal, offset in cites:
        in_footnote: str | None = None
        for label, s, e in fn_ranges:
            if s <= offset < e:
                in_footnote = label
                break
        cite_end = offset
        bracket_close = text.find("]", offset)
        if bracket_close != -1 and bracket_close - offset < 500:
            cite_end = bracket_close + 1
        else:
            m = re.search(r"@" + re.escape(bibkey), text[offset:offset + 200])
            if m:
                cite_end = offset + m.end()
        parenthetical = _find_parenthetical_after(text, cite_end)
        if in_footnote:
            marker_pos = _find_footnote_marker(text, in_footnote)
            body_sent = _get_sentence_around(text, marker_pos) if marker_pos is not None else ""
            if parenthetical:
                claim = f"{parenthetical} (in footnote, supporting: {body_sent[:300]})"
                primary = parenthetical
            else:
                claim = body_sent
                primary = body_sent
        else:
            body_sent = _get_sentence_around(text, offset)
            if parenthetical:
                claim = f"{parenthetical} (sentence: {body_sent[:300]})"
                primary = parenthetical
            else:
                claim = body_sent
                primary = body_sent
        out.append({
            "file": path.name,
            "line": _line_of_offset(text, offset),
            "bibkey": bibkey,
            "signal": signal,
            "in_footnote": in_footnote,
            "parenthetical": parenthetical,
            "claim": claim,
            "primary": primary,
            "prompt_style": "soft" if signal else "strict",
        })
    return out


# ---------------------------------------------------------------------------
# Bibkey detection in drafts (used by inventory + lint)
# ---------------------------------------------------------------------------

def cited_bibkeys_in_drafts(drafts_dir: Path) -> set[str]:
    """Return all bibkeys actually referenced from drafts (cross-refs filtered)."""
    keys: set[str] = set()
    if not drafts_dir.exists():
        return keys
    for d in drafts_dir.glob("*.md"):
        text = d.read_text()
        for m in re.finditer(r"@([A-Za-z][A-Za-z0-9_:\-./]+)", text):
            k = m.group(1).rstrip(".,")
            if not k.startswith(CROSSREF_PREFIXES):
                keys.add(k)
    return keys


# ---------------------------------------------------------------------------
# Misc helpers
# ---------------------------------------------------------------------------

def trim_quote(quote: str, max_words: int = 40) -> str:
    words = quote.strip().split()
    if len(words) <= max_words:
        return " ".join(words)
    return " ".join(words[:max_words]) + "…"


def section_slug(file_path: Path) -> str:
    """`Part I (Draft).md` → `Part-I`."""
    stem = file_path.stem
    stem = re.sub(r"\s*\(Draft\)\s*$", "", stem)
    return re.sub(r"\s+", "-", stem.strip())


def sleep(seconds: float = INTER_CALL_DELAY) -> None:
    time.sleep(seconds)


__all__ = [
    "ContextError",
    "load_active_workflow",
    "require_notebook",
    "load_bib",
    "parse_bib",
    "parse_sources_listing",
    "sid_map",
    "call_nlm_scoped",
    "call_nlm_batch",
    "parse_json_response",
    "parse_json_array",
    "extract_cites_for_file",
    "cited_bibkeys_in_drafts",
    "trim_quote",
    "section_slug",
    "sleep",
    "CROSSREF_PREFIXES",
    "NLM_BIN",
]
