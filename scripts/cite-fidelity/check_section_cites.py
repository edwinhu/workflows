#!/usr/bin/env -S uv run python3
"""Stage 3: Per-section cite-check gate.

Runs the NLM cite-verification pipeline (extract → batch-check → report)
against one or more draft sections. Writes `.planning/CITES-<section>.md`
with the per-section verdict and frontmatter `status: PASSED|FAILED`.

Exits 1 if any UNSUPPORTED occurrences remain, so writing-revise can use
this as a hard gate before declaring COMPLETE.

Project context comes from `.planning/ACTIVE_WORKFLOW.md`.

Usage (run from inside the writing project):
  uv run check_section_cites.py "drafts/Part I (Draft).md"
  uv run check_section_cites.py --all
  uv run check_section_cites.py "drafts/Part I (Draft).md" --batch-size 3
  uv run check_section_cites.py "drafts/Part I (Draft).md" --allow-unsupported
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    ContextError,
    call_nlm_batch,
    extract_cites_for_file,
    load_active_workflow,
    load_bib,
    parse_json_array,
    require_notebook,
    section_slug,
    sid_map,
    sleep,
)

DEFAULT_BATCH = 5
MAX_RETRIES = 2
VALID_STATUSES = {"SUPPORTED", "PARTIAL", "UNSUPPORTED", "NOT_FOUND"}


def short_authors(field: str) -> str:
    if not field:
        return ""
    parts = [a.strip() for a in re.split(r"\s+and\s+", field)]
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]} and {parts[1]}"
    return f"{parts[0]} et al."


def source_descriptor(bibkey: str, bib: dict) -> str:
    meta = bib.get(bibkey, {})
    title = meta.get("title", "").strip()
    authors = short_authors(meta.get("author", ""))
    year = meta.get("year", "").strip()
    if title and authors and year:
        return f'"{title}" by {authors} ({year})'
    if title and authors:
        return f'"{title}" by {authors}'
    if title:
        return f'"{title}"'
    return f"the source `{bibkey}`"


def build_batch_prompt(batch: list[tuple[int, dict]], bib: dict) -> str:
    blocks = []
    for n, (_idx, c) in enumerate(batch, 1):
        bibkey = c["bibkey"]
        descriptor = source_descriptor(bibkey, bib)
        claim = (c.get("primary") or c.get("claim") or "").strip()[:600]
        signal = c.get("signal")
        if c.get("prompt_style") == "soft" and signal:
            mode = (f"SOFT (Bluebook signal '{signal}'): conceptual alignment "
                    "/ general support / illustration suffices.")
        else:
            mode = "STRICT: source must directly state or strongly imply the claim."
        blocks.append(
            f"### Claim {n}\n"
            f"- Cited source (bibkey `{bibkey}`): {descriptor}\n"
            f"- Mode: {mode}\n"
            f"- Claim text: {claim}"
        )
    return (
        "Verify multiple citation claims in this single response. The notebook "
        "has been scoped to ONLY the sources cited by the claims below. For "
        "each numbered claim, examine ONLY the source whose bibkey is named "
        "for that claim — never use a different source's content to answer.\n\n"
        + "\n\n".join(blocks)
        + "\n\n---\n\n"
        "OUTPUT — reply with ONLY a JSON array, one element per claim in order:\n"
        '[{"claim": 1, "bibkey": "...", "status": "SUPPORTED|PARTIAL|UNSUPPORTED|NOT_FOUND", '
        '"quote_or_reason": "..."}, ...]\n\n'
        "Status definitions:\n"
        "- SUPPORTED: cited source directly supports (STRICT) or generally supports (SOFT) the claim.\n"
        "- PARTIAL: some elements supported but others missing or contradicted.\n"
        "- UNSUPPORTED: cited source does not address the claim or contradicts it.\n"
        "- NOT_FOUND: the cited source is not among the available sources.\n\n"
        "quote_or_reason: a short verbatim passage (≤40 words) when SUPPORTED or PARTIAL; "
        "a brief reason otherwise."
    )


def normalise_status(s: str) -> str:
    s = (s or "").upper().strip()
    if s == "NOT_FOUND":
        return "NOT_IN_NOTEBOOK"
    return s if s in VALID_STATUSES else "UNCLEAR"


def process_batch(notebook: str, batch, sids: dict[str, str], bib: dict) -> list[dict]:
    sid_set = sorted({sids[c["bibkey"]] for _, c in batch if sids.get(c["bibkey"])})
    missing = [(i, c) for i, c in batch if c["bibkey"] not in sids]
    callable_ = [(i, c) for i, c in batch if c["bibkey"] in sids]

    rows: list[dict] = []
    for _, c in missing:
        rows.append({**c, "status": "NOT_IN_NOTEBOOK",
                     "response": f"Bibkey `{c['bibkey']}` not in NLM notebook.",
                     "attempts": 0})
    if not callable_:
        return rows

    prompt = build_batch_prompt(callable_, bib)
    response, error, attempts = "", None, 0
    for attempt in range(MAX_RETRIES + 1):
        attempts = attempt + 1
        response, error = call_nlm_batch(notebook, sid_set, prompt)
        if error is None:
            break
        sleep(2 if attempt == 0 else 4)

    if error:
        for _, c in callable_:
            rows.append({**c, "status": "ERROR",
                         "response": f"ERROR after {attempts} attempts: {error}",
                         "attempts": attempts})
        return rows

    parsed = parse_json_array(response)
    if parsed is None or len(parsed) != len(callable_):
        for _, c in callable_:
            rows.append({**c, "status": "UNCLEAR",
                         "response": f"PARSE_FAILED. Raw: {response[:1000]}",
                         "attempts": attempts})
        return rows

    for (_, c), entry in zip(callable_, parsed):
        status = normalise_status(entry.get("status"))
        quote = (entry.get("quote_or_reason") or entry.get("quote")
                 or entry.get("reason") or "").strip()
        reported = (entry.get("bibkey") or "").strip()
        prefix = (f"[bibkey-mismatch: model said `{reported}`] "
                  if reported and reported != c["bibkey"] else "")
        rows.append({**c, "status": status,
                     "response": prefix + quote, "attempts": attempts})
    return rows


def render_report(section: str, results: list[dict], notebook: str) -> str:
    counts = Counter(r["status"] for r in results)
    total = len(results)
    glyphs = {"SUPPORTED": "✓ SUPPORTED", "UNSUPPORTED": "✗ UNSUPPORTED",
              "PARTIAL": "⚠ PARTIAL", "ERROR": "💥 ERROR",
              "NOT_IN_NOTEBOOK": "⊘ NOT_IN_NOTEBOOK", "UNCLEAR": "? UNCLEAR"}
    order = ["UNSUPPORTED", "PARTIAL", "UNCLEAR", "ERROR",
             "NOT_IN_NOTEBOOK", "SUPPORTED"]
    unsupported_count = counts.get("UNSUPPORTED", 0)
    status_label = "FAILED" if unsupported_count else "PASSED"

    lines = ["---",
             f"status: {status_label}",
             f"section: {section}",
             f"total_cites: {total}",
             f"unsupported: {unsupported_count}",
             f"partial: {counts.get('PARTIAL', 0)}",
             f"supported: {counts.get('SUPPORTED', 0)}",
             "---",
             "",
             f"# Cite Check — {section}",
             "",
             f"**Notebook:** `{notebook}`",
             f"**Total citation occurrences:** {total}",
             "",
             "## Summary",
             "",
             "| Status | Count | % |",
             "|---|---:|---:|"]
    for st in order:
        n = counts.get(st, 0)
        if n:
            pct = (n / total * 100) if total else 0
            lines.append(f"| {glyphs[st]} | {n} | {pct:.1f}% |")
    lines.append(f"| **Total** | **{total}** | **100.0%** |")
    lines.append("")

    blockers = [r for r in results if r["status"] == "UNSUPPORTED"]
    if blockers:
        lines.extend(["## ✗ UNSUPPORTED — must fix or remove", ""])
        for r in blockers:
            claim = (r.get("primary") or r.get("claim") or "").replace("\n", " ")[:220]
            lines.append(f"- **L{r['line']}** `{r['bibkey']}` — {claim}")
            lines.append(f"  - NLM: {r['response'][:280]}")
        lines.append("")

    partials = [r for r in results if r["status"] == "PARTIAL"]
    if partials:
        lines.extend(["## ⚠ PARTIAL — review or override", ""])
        for r in partials:
            claim = (r.get("primary") or r.get("claim") or "").replace("\n", " ")[:220]
            lines.append(f"- **L{r['line']}** `{r['bibkey']}` — {claim}")
            lines.append(f"  - NLM: {r['response'][:280]}")
        lines.append("")

    not_in = [r for r in results if r["status"] == "NOT_IN_NOTEBOOK"]
    if not_in:
        lines.extend(["## ⊘ NOT_IN_NOTEBOOK — add to NLM or remove cite", ""])
        for r in not_in:
            lines.append(f"- **L{r['line']}** `{r['bibkey']}`")
        lines.append("")

    errors = [r for r in results if r["status"] in {"ERROR", "UNCLEAR"}]
    if errors:
        lines.extend(["## 💥 ERROR / UNCLEAR — re-run", ""])
        for r in errors:
            lines.append(f"- **L{r['line']}** `{r['bibkey']}` — {r['response'][:200]}")
        lines.append("")

    lines.append("## Full results")
    lines.append("")
    lines.append("| Status | Line | Bibkey | Signal | Claim | NLM Response |")
    lines.append("|---|---:|---|---|---|---|")
    for r in sorted(results, key=lambda r: r["line"]):
        signal = r.get("signal") or "—"
        claim = (r.get("primary") or r.get("claim") or "").replace("\n", " ")[:200]
        resp = (r.get("response") or "").replace("\n", " ").replace("|", "/")[:240]
        lines.append(f"| {glyphs.get(r['status'], r['status'])} | "
                     f"{r['line']} | `{r['bibkey']}` | {signal} | "
                     f"{claim} | {resp} |")
    return "\n".join(lines) + "\n"


def check_one(file_path: Path, ctx: dict, sids: dict[str, str], bib: dict,
              batch_size: int) -> int:
    cites = extract_cites_for_file(file_path)
    if not cites:
        print(f"  {file_path.name}: no cites found", file=sys.stderr)
        return 0
    print(f"  {file_path.name}: {len(cites)} cite occurrences "
          f"({len({c['bibkey'] for c in cites})} unique bibkeys)",
          file=sys.stderr)

    results: list[dict] = []
    pending = list(enumerate(cites, 1))
    bs = max(1, batch_size)
    batches = [pending[i:i + bs] for i in range(0, len(pending), bs)]
    notebook = require_notebook(ctx)
    for bn, batch in enumerate(batches, 1):
        print(f"    batch {bn}/{len(batches)} ({len(batch)} claims)…",
              file=sys.stderr)
        results.extend(process_batch(notebook, batch, sids, bib))

    slug = section_slug(file_path)
    out_path = ctx["planning_dir"] / f"CITES-{slug}.md"
    ctx["planning_dir"].mkdir(parents=True, exist_ok=True)
    out_path.write_text(render_report(file_path.stem, results, notebook))
    print(f"    → {out_path}", file=sys.stderr)

    counts = Counter(r["status"] for r in results)
    print("    summary: " +
          ", ".join(f"{k}={v}" for k, v in counts.most_common()),
          file=sys.stderr)
    return counts.get("UNSUPPORTED", 0)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("files", nargs="*", type=Path,
                    help="Draft files to check (relative to project root, "
                         "or absolute).")
    ap.add_argument("--all", action="store_true",
                    help="Check every drafts/*.md.")
    ap.add_argument("--batch-size", type=int, default=DEFAULT_BATCH)
    ap.add_argument("--allow-unsupported", action="store_true",
                    help="Exit 0 even if UNSUPPORTED occurrences remain.")
    args = ap.parse_args()

    try:
        ctx = load_active_workflow()
        require_notebook(ctx)
    except ContextError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    if args.all:
        files = sorted(ctx["drafts_dir"].glob("*.md"))
    else:
        files = [f if f.is_absolute() else (ctx["project_root"] / f) for f in args.files]
    if not files:
        ap.error("Provide file paths or --all.")

    bib = load_bib(ctx)
    sids = sid_map(require_notebook(ctx))

    total_unsupported = 0
    for f in files:
        if not f.exists():
            print(f"  MISSING: {f}", file=sys.stderr)
            continue
        total_unsupported += check_one(f, ctx, sids, bib, args.batch_size)

    if total_unsupported and not args.allow_unsupported:
        print(f"\nFAIL: {total_unsupported} UNSUPPORTED cites — fix before "
              "advancing the writing-revise step.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
