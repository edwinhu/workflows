#!/usr/bin/env -S uv run python3
"""Stage 2: NLM-refined footnote evidence pull.

Given a claim and one or more candidate bibkeys, ask NLM (scoped per source)
whether each source supports the claim and to quote the supporting passage.
Emits ready-to-paste `<!-- nlm-quote @key (anchor): "..." -->` blocks for
SUPPORTED / PARTIAL hits, plus warnings for UNSUPPORTED candidates so the
writer doesn't attach a cite the source doesn't actually back.

Project context comes from `.planning/ACTIVE_WORKFLOW.md`.

Usage (run from inside the writing project):
  uv run nlm_footnote_pull.py --claim "TEXT" --keys k1,k2,k3
  uv run nlm_footnote_pull.py --from-file claims.json   # batch
  uv run nlm_footnote_pull.py --claim "..." --keys k1,k2 --json   # raw json out

Batch JSON file format: list of {"claim": "...", "keys": ["k1","k2"]} entries.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _common import (  # noqa: E402
    ContextError,
    call_nlm_scoped,
    load_active_workflow,
    parse_json_response,
    require_notebook,
    sid_map,
    sleep,
    trim_quote,
)

PROMPT_TEMPLATE = """\
The notebook is scoped to ONE source for this query. Your job is to determine
whether THAT source supports the following claim, and to quote the supporting
passage if it does.

CLAIM: {claim}

Reply in valid JSON only — no prose before or after, no code fences:

{{
  "status": "SUPPORTED" | "PARTIAL" | "UNSUPPORTED",
  "quote": "verbatim passage from the source (≤40 words) — only when SUPPORTED or PARTIAL",
  "anchor": "page or section label if the source provides one, else empty string",
  "why": "one short sentence — required for PARTIAL/UNSUPPORTED, optional for SUPPORTED"
}}

Definitions:
- SUPPORTED: the source directly states or strongly implies the claim.
- PARTIAL: some elements supported but others missing or contradicted; explain in `why`.
- UNSUPPORTED: the source does not address the claim or contradicts it; explain in `why`.

Do NOT invent quotes. If you cannot find a verbatim passage, set "quote" to ""
and downgrade status accordingly.
"""


def pull_one(notebook: str, claim: str, bibkey: str,
             sids: dict[str, str]) -> dict:
    sid = sids.get(bibkey)
    if not sid:
        return {"bibkey": bibkey, "claim": claim, "status": "NOT_IN_NOTEBOOK",
                "quote": "", "anchor": "",
                "why": f"`{bibkey}` is not in the NLM notebook."}
    resp, err = call_nlm_scoped(notebook, sid, PROMPT_TEMPLATE.format(claim=claim.strip()))
    if err:
        return {"bibkey": bibkey, "claim": claim, "status": "ERROR",
                "quote": "", "anchor": "", "why": err}
    parsed = parse_json_response(resp)
    if parsed is None:
        return {"bibkey": bibkey, "claim": claim, "status": "PARSE_FAILED",
                "quote": "", "anchor": "", "why": f"raw: {resp[:300]}"}
    status = (parsed.get("status") or "").upper().strip()
    if status not in {"SUPPORTED", "PARTIAL", "UNSUPPORTED"}:
        status = "UNCLEAR"
    return {
        "bibkey": bibkey,
        "claim": claim,
        "status": status,
        "quote": trim_quote(parsed.get("quote", "") or ""),
        "anchor": (parsed.get("anchor") or "").strip(),
        "why": (parsed.get("why") or "").strip(),
    }


def render_result(r: dict) -> str:
    glyphs = {"SUPPORTED": "✓", "PARTIAL": "⚠", "UNSUPPORTED": "✗",
              "NOT_IN_NOTEBOOK": "⊘", "ERROR": "💥", "PARSE_FAILED": "?",
              "UNCLEAR": "?"}
    glyph = glyphs.get(r["status"], "?")
    out: list[str] = [f"### {glyph} `{r['bibkey']}` — {r['status']}"]
    if r.get("anchor"):
        out.append(f"_anchor: {r['anchor']}_")
    if r.get("why"):
        out.append(f"_why: {r['why']}_")
    out.append("")
    if r["status"] in {"SUPPORTED", "PARTIAL"} and r.get("quote"):
        anchor_suffix = f" ({r['anchor']})" if r.get("anchor") else ""
        out.append("Paste-ready evidence comment:")
        out.append("```markdown")
        out.append(f'<!-- nlm-quote @{r["bibkey"]}{anchor_suffix}: "{r["quote"]}" -->')
        out.append("```")
    elif r["status"] == "UNSUPPORTED":
        out.append(f"**Do not cite `@{r['bibkey']}` for this claim.** "
                   "The source does not support it.")
    out.append("")
    return "\n".join(out)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--claim", help="Claim text to verify.")
    ap.add_argument("--keys", help="Comma-separated bibkeys to test against the claim.")
    ap.add_argument("--from-file", help="JSON file with [{claim, keys}, ...] entries.")
    ap.add_argument("--json", action="store_true",
                    help="Emit raw JSON results instead of markdown.")
    args = ap.parse_args()

    if not args.from_file and (not args.claim or not args.keys):
        ap.error("Provide --claim and --keys, or --from-file.")

    try:
        ctx = load_active_workflow()
        notebook = require_notebook(ctx)
    except ContextError as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    jobs: list[tuple[str, list[str]]] = []
    if args.from_file:
        data = json.loads(Path(args.from_file).read_text())
        for entry in data:
            jobs.append((entry["claim"], list(entry["keys"])))
    else:
        jobs.append((args.claim, [k.strip() for k in args.keys.split(",") if k.strip()]))

    sids = sid_map(notebook)

    all_results: list[dict] = []
    for claim, keys in jobs:
        for k in keys:
            print(f"  · {k}", file=sys.stderr)
            all_results.append(pull_one(notebook, claim, k, sids))
            sleep()

    if args.json:
        print(json.dumps(all_results, indent=2))
        return 0

    grouped: dict[str, list[dict]] = {}
    for r in all_results:
        grouped.setdefault(r["claim"], []).append(r)

    out_lines: list[str] = []
    for claim, rows in grouped.items():
        out_lines.append("## Claim")
        out_lines.append("")
        out_lines.append(f"> {claim.strip()}")
        out_lines.append("")
        for r in rows:
            out_lines.append(render_result(r))
    print("\n".join(out_lines))
    return 0


if __name__ == "__main__":
    sys.exit(main())
