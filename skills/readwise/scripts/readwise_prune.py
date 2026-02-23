#!/usr/bin/env python3
"""
Prune old Readwise Reader documents with no highlights.

Two-pass approach using updatedAfter to minimize API calls:
  1. Fetch docs updated after cutoff (recently active) → "safe" set
  2. Fetch ALL docs, skip safe set + feed + highlights → candidates

Dry-run by default.

Usage:
    python readwise_prune.py                          # Dry run (later + archive)
    python readwise_prune.py --delete                 # Actually delete
    python readwise_prune.py --months 6               # 6 months instead of 3
    python readwise_prune.py --location later         # Only prune "later" docs
    python readwise_prune.py --location new later archive  # Multiple locations
    python readwise_prune.py --category article       # Only prune articles
    python readwise_prune.py --exclude-tag "keep"     # Skip docs with this tag
    python readwise_prune.py --location later archive feed  # Include feed items

Requirements:
    pip install requests
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import List, Optional, Set

import requests

TOKEN_PATH = Path(
    "/var/folders/01/wzs3mqmn3jx2b81f0dcq9w8h0000gq/T/agenix/readwise-token"
)
API_LIST = "https://readwise.io/api/v3/list/"
API_DELETE = "https://readwise.io/api/v3/delete/"


def get_token() -> str:
    if not TOKEN_PATH.exists():
        print(f"Token file not found: {TOKEN_PATH}", file=sys.stderr)
        sys.exit(2)
    token = TOKEN_PATH.read_text().strip()
    if not token:
        print(f"Token file is empty: {TOKEN_PATH}", file=sys.stderr)
        sys.exit(2)
    return token


def api_request(
    method: str, url: str, headers: dict,
    params: Optional[dict] = None, max_retries: int = 5,
) -> requests.Response:
    for attempt in range(max_retries):
        resp = requests.request(method, url, headers=headers, params=params, timeout=60)
        if resp.status_code == 429:
            wait = max(2**attempt, int(resp.headers.get("Retry-After", 0)))
            print(f"  Rate limited, waiting {wait}s...")
            time.sleep(wait)
            continue
        return resp
    return requests.request(method, url, headers=headers, params=params, timeout=60)


def paginate(token: str, params: dict, label: str = "docs") -> List[dict]:
    headers = {"Authorization": f"Token {token}"}
    results: List[dict] = []
    cursor = None
    page = 0

    while True:
        p = dict(params)
        if cursor:
            p["pageCursor"] = cursor
        page += 1
        print(f"  {label} page {page}...", end=" ", flush=True)
        resp = api_request("GET", API_LIST, headers, p)
        resp.raise_for_status()
        data = resp.json()
        batch = data.get("results", [])
        results.extend(batch)
        print(f"{len(batch)} (total: {len(results)})")
        cursor = data.get("nextPageCursor")
        if not cursor:
            break
        time.sleep(0.5)

    return results


def parse_dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s)
    except (ValueError, TypeError):
        return None


def doc_tags(doc: dict) -> Set[str]:
    tags = doc.get("tags", {})
    if isinstance(tags, dict):
        return {k.lower() for k in tags}
    if isinstance(tags, list):
        return {t.lower() for t in tags if isinstance(t, str)}
    return set()


def main():
    p = argparse.ArgumentParser(description="Prune old Readwise docs with no highlights")
    p.add_argument("--months", type=int, default=3, help="Age threshold (default: 3)")
    p.add_argument("--location", nargs="*", default=["later", "archive"],
                   choices=["new", "later", "shortlist", "archive", "feed"],
                   help="Locations to prune (default: later archive)")
    p.add_argument("--category", help="article, pdf, epub, email, rss, tweet, video")
    p.add_argument("--exclude-tag", action="append", dest="exclude_tags", default=[])
    p.add_argument("--include-feed", action="store_true",
                   help="(deprecated, use --location feed instead)")
    p.add_argument("--delete", action="store_true", help="Actually delete (default: dry-run)")
    p.add_argument("--verbose", "-v", action="store_true")
    p.add_argument("--limit", type=int, default=0, help="Max deletions (0 = unlimited)")
    args = p.parse_args()

    token = get_token()
    cutoff = datetime.now(timezone.utc) - timedelta(days=args.months * 30)
    cutoff_iso = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    exclude = {t.lower() for t in args.exclude_tags}

    locations = set(args.location) if args.location else {"later", "archive"}
    if args.include_feed:
        locations.add("feed")

    print(f"Cutoff: {cutoff.strftime('%Y-%m-%d')} ({args.months} months ago)")
    print(f"Locations: {', '.join(sorted(locations))}")
    if exclude:
        print(f"Excluding tags: {', '.join(sorted(exclude))}")
    print("DRY RUN\n" if not args.delete else "DELETE MODE\n")

    # Pass 1: fetch recently-active docs (updatedAfter=cutoff)
    # These are safe — recently updated means recent activity.
    # Also collect parent_ids from recent highlights.
    print("Pass 1: Fetching recently-active documents...")
    recent = paginate(token, {"updatedAfter": cutoff_iso}, label="recent")
    safe_ids: Set[str] = set()
    highlighted_ids: Set[str] = set()
    for doc in recent:
        did = doc.get("id")
        if did:
            safe_ids.add(did)
        pid = doc.get("parent_id")
        if pid:
            highlighted_ids.add(pid)
    print(f"  Safe (recently active): {len(safe_ids)}")
    print(f"  Parents of recent highlights: {len(highlighted_ids)}\n")

    # Pass 2: fetch docs to find stale candidates.
    # API only supports single location filter, so fetch per-location if multiple.
    print("Pass 2: Fetching documents...")
    all_docs: List[dict] = []
    for loc in sorted(locations):
        params: dict = {"location": loc}
        if args.category:
            params["category"] = args.category
        all_docs.extend(paginate(token, params, label=loc))

    # Also collect parent_ids from ALL highlights (old highlights too)
    for doc in all_docs:
        pid = doc.get("parent_id")
        if pid:
            highlighted_ids.add(pid)

    print(f"  Total fetched: {len(all_docs)}")
    print(f"  Total docs with any highlights: {len(highlighted_ids)}\n")

    # Filter
    candidates = []
    skip = {"safe": 0, "highlight_doc": 0, "highlighted": 0,
            "feed": 0, "tag": 0, "young": 0, "category": 0}

    for doc in all_docs:
        did = doc.get("id", "")
        loc = doc.get("location", "")
        cat = doc.get("category", "")

        # Skip highlight entries themselves
        if doc.get("parent_id"):
            skip["highlight_doc"] += 1
            continue

        # Skip feed unless explicitly included in --location
        if loc == "feed" and "feed" not in locations:
            skip["feed"] += 1
            continue

        # Category filter (belt-and-suspenders; also applied server-side)
        if args.category and cat != args.category:
            skip["category"] += 1
            continue

        # Skip recently active (from pass 1)
        if did in safe_ids:
            skip["safe"] += 1
            continue

        # Age check (belt-and-suspenders with saved_at)
        saved = parse_dt(doc.get("saved_at") or doc.get("created_at"))
        if not saved or saved > cutoff:
            skip["young"] += 1
            continue

        # Has highlights
        if did in highlighted_ids:
            skip["highlighted"] += 1
            continue

        # Excluded tags
        if exclude & doc_tags(doc):
            skip["tag"] += 1
            continue

        candidates.append(doc)

    # Report
    print(f"Candidates for deletion: {len(candidates)}")
    print(f"  Skipped (recently active): {skip['safe']}")
    print(f"  Skipped (has highlights):  {skip['highlighted']}")
    print(f"  Skipped (highlight entry): {skip['highlight_doc']}")
    print(f"  Skipped (too recent):      {skip['young']}")
    print(f"  Skipped (feed):            {skip['feed']}")
    for k in ("tag", "category"):
        if skip[k]:
            print(f"  Skipped ({k}):       {skip[k]}")

    if not candidates:
        print("\nNothing to prune.")
        return

    by_cat: dict[str, int] = {}
    for doc in candidates:
        c = doc.get("category", "unknown")
        by_cat[c] = by_cat.get(c, 0) + 1
    print("\n  By category:")
    for cat, n in sorted(by_cat.items(), key=lambda x: -x[1]):
        print(f"    {cat}: {n}")

    show = candidates[:args.limit] if args.limit else candidates
    if args.verbose or not args.delete:
        print(f"\n  Documents ({len(show)} shown):")
        for doc in show:
            title = (doc.get("title") or "Untitled")[:80]
            saved = (doc.get("saved_at") or "?")[:10]
            print(f"    [{saved}] ({doc.get('category','?')}/{doc.get('location','?')}) {title}")

    if not args.delete:
        print(f"\nDry run complete. Pass --delete to remove {len(candidates)} documents.")
        return

    to_delete = candidates[:args.limit] if args.limit else candidates
    print(f"\nDeleting {len(to_delete)} documents...")
    headers = {"Authorization": f"Token {token}"}
    ok = fail = 0

    for i, doc in enumerate(to_delete, 1):
        title = (doc.get("title") or "Untitled")[:60]
        print(f"  [{i}/{len(to_delete)}] {title}...", end=" ", flush=True)
        resp = api_request("DELETE", f"{API_DELETE}{doc['id']}/", headers)
        if resp.status_code == 204:
            print("ok")
            ok += 1
        else:
            print(f"FAILED ({resp.status_code})")
            fail += 1
        time.sleep(3)  # 20 req/min

    print(f"\nDone: {ok} deleted, {fail} failed")


if __name__ == "__main__":
    main()
