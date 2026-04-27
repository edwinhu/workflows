#!/usr/bin/env -S uv run python3
"""Stage 1: NLM source inventory.

For each NLM source whose title is a recognised bibkey, ask NLM (scoped to
that single source) for a structured summary: thesis, claims it supports,
author/year, and any explicit page/section anchors. Writes one entry per
bibkey to `references/source_summaries.md` in the active writing project.

Idempotent: re-running only re-queries sources that are missing or whose
NLM `LAST UPDATED` timestamp is newer than the cached entry.

Project context comes from `.planning/ACTIVE_WORKFLOW.md` frontmatter
(`project_root`, `bibliography`, `nlm_notebook`).

Usage (run from inside the writing project, or any subdir of it):
  uv run nlm_source_inventory.py            # incremental refresh
  uv run nlm_source_inventory.py --rebuild  # re-query everything
  uv run nlm_source_inventory.py --bibkey Lund2017-ed   # single key
  uv run nlm_source_inventory.py --include-uncited      # all bibkey-titled sources
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    ContextError,
    call_nlm_scoped,
    cited_bibkeys_in_drafts,
    load_active_workflow,
    parse_json_response,
    parse_sources_listing,
    require_notebook,
    sleep,
)

PROMPT = """\
Answer in valid JSON only — no prose before or after, no code fences.

About the single source scoped into this query, return:
{
  "thesis": "1-2 sentence summary of the source's main argument or finding",
  "supports": ["claim 1", "claim 2", "claim 3"],
  "does_not_support": ["common-but-incorrect claim 1", "..."],
  "author": "Last name(s) of primary author(s)",
  "year": "YYYY",
  "anchors": "any page numbers or section labels that ground the claims, or empty string"
}

Rules:
- "supports" should list 3-6 specific propositions the source affirmatively makes,
  each phrased as a complete claim (not a topic).
- "does_not_support" should list 1-3 plausible-sounding claims this source is
  often confused with but does not actually make. Skip if none come to mind.
- If you cannot determine a field, use an empty string or empty list.
"""


def render_entry(bibkey: str, entry: dict) -> str:
    thesis = (entry.get("thesis") or "").strip()
    supports = entry.get("supports") or []
    does_not = entry.get("does_not_support") or []
    author = (entry.get("author") or "").strip()
    year = (entry.get("year") or "").strip()
    anchors = (entry.get("anchors") or "").strip()
    sid = entry.get("sid", "")
    last_updated = entry.get("last_updated", "")

    lines = [f"## `{bibkey}`", ""]
    meta = []
    if author:
        meta.append(f"author: {author}")
    if year:
        meta.append(f"year: {year}")
    if anchors:
        meta.append(f"anchors: {anchors}")
    meta.append(f"nlm_source_id: {sid}")
    meta.append(f"nlm_last_updated: {last_updated}")
    lines.append("```yaml")
    lines.extend(meta)
    lines.append("```")
    lines.append("")
    if thesis:
        lines.append(f"**Thesis.** {thesis}")
        lines.append("")
    if supports:
        lines.append("**Supports:**")
        for s in supports:
            lines.append(f"- {s}")
        lines.append("")
    if does_not:
        lines.append("**Does NOT support (common confusions):**")
        for s in does_not:
            lines.append(f"- {s}")
        lines.append("")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--rebuild", action="store_true",
                    help="Discard cache and re-query every source.")
    ap.add_argument("--bibkey", help="Refresh only this bibkey.")
    ap.add_argument("--limit", type=int, default=0,
                    help="Stop after N new queries (0 = no limit).")
    ap.add_argument("--include-uncited", action="store_true",
                    help="Inventory every NLM source whose title is a bibkey, "
                         "not just those cited in drafts.")
    args = ap.parse_args()

    try:
        ctx = load_active_workflow()
        notebook = require_notebook(ctx)
    except ContextError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    out_path = ctx["references_dir"] / "source_summaries.md"
    cache_path = ctx["references_dir"] / ".source_summaries_cache.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    sources = parse_sources_listing(notebook)
    cited = cited_bibkeys_in_drafts(ctx["drafts_dir"])

    cache: dict[str, dict] = {}
    if cache_path.exists() and not args.rebuild:
        cache = json.loads(cache_path.read_text())

    targets: list[str] = []
    bibkey_re = re.compile(r"^[A-Za-z][A-Za-z0-9_:\-./]+$")
    for title, meta in sources.items():
        if not bibkey_re.match(title):
            continue
        if args.bibkey and title != args.bibkey:
            continue
        if not args.include_uncited and title not in cited and not args.bibkey:
            continue
        cached = cache.get(title)
        if cached and not args.rebuild:
            if cached.get("last_updated") == meta["last_updated"] and cached.get("thesis"):
                continue
        targets.append(title)

    if not targets:
        print("Nothing to do — cache is current.", file=sys.stderr)
    else:
        print(f"Querying {len(targets)} source(s)…", file=sys.stderr)

    new = 0
    for bibkey in targets:
        if args.limit and new >= args.limit:
            break
        meta = sources[bibkey]
        sid = meta["sid"]
        print(f"  · {bibkey}", file=sys.stderr)
        resp, err = call_nlm_scoped(notebook, sid, PROMPT)
        if err:
            print(f"    ERROR: {err}", file=sys.stderr)
            cache[bibkey] = {**(cache.get(bibkey) or {}), "sid": sid,
                             "last_updated": meta["last_updated"], "error": err}
            continue
        parsed = parse_json_response(resp)
        if not parsed:
            print(f"    PARSE FAILED — first 200 chars: {resp[:200]}", file=sys.stderr)
            cache[bibkey] = {**(cache.get(bibkey) or {}), "sid": sid,
                             "last_updated": meta["last_updated"],
                             "error": f"parse_failed: {resp[:300]}"}
            continue
        cache[bibkey] = {
            "sid": sid,
            "last_updated": meta["last_updated"],
            "thesis": parsed.get("thesis", ""),
            "supports": parsed.get("supports", []),
            "does_not_support": parsed.get("does_not_support", []),
            "author": parsed.get("author", ""),
            "year": parsed.get("year", ""),
            "anchors": parsed.get("anchors", ""),
        }
        cache_path.write_text(json.dumps(cache, indent=2, sort_keys=True))
        new += 1
        sleep(1.5)

    render_lines = [
        f"# {ctx['project_root'].name} — NLM Source Summaries",
        "",
        "_Auto-generated by `cite-fidelity/nlm_source_inventory.py` against notebook_",
        f"_`{notebook}`._  ",
        "_Each entry is a per-source NLM round-trip; do not hand-edit._",
        "",
        "Use this file during drafting to confirm which paper actually supports",
        "which claim — especially for authors with multiple cited works.",
        "",
    ]
    for bibkey in sorted(cache.keys()):
        entry = cache[bibkey]
        if entry.get("error"):
            render_lines.extend([f"## `{bibkey}`", "",
                                 f"_inventory error: {entry['error']}_", ""])
            continue
        render_lines.append(render_entry(bibkey, entry))
    out_path.write_text("\n".join(render_lines).rstrip() + "\n")

    print(f"Cache: {len(cache)} entries → {cache_path}", file=sys.stderr)
    print(f"Report: {out_path}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
