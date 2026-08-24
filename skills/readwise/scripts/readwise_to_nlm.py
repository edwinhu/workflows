#!/usr/bin/env -S uv run python3
"""
Fetch Readwise documents by tag, convert HTML to Markdown, and add to NotebookLM.

Usage:
    python readwise_to_nlm.py --tag "proxy advisors" --notebook <notebook-id>
    python readwise_to_nlm.py --tag "Corps" --notebook abc123 --dry-run

Requirements:
    pip install requests html2text

Token location (agenix-managed):
    /var/folders/01/wzs3mqmn3jx2b81f0dcq9w8h0000gq/T/agenix/readwise-token
"""

from __future__ import annotations

import argparse
import subprocess
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Any, List, Optional

import requests

READWISE_LIST_URL = "https://readwise.io/api/v3/list/"


def _token_path() -> Path:
    """Where the readwise token lives. Both former constants were hardcoded to one
    macOS machine -- a literal /var/folders/... temp dir and a /Users path -- so this
    script could not run anywhere else."""
    env = os.environ.get("READWISE_TOKEN_FILE")
    if env:
        return Path(env)
    tmp = os.environ.get("TMPDIR") or "/tmp"
    return Path(tmp) / "agenix" / "readwise-token"


def _nlm_path() -> Path:
    """nlm is installed per-machine (nix here), so resolve it from PATH."""
    found = shutil.which("nlm")
    if not found:
        print("nlm not found on PATH; install it (cd ~/nix && nix run .#build-switch)", file=sys.stderr)
        sys.exit(2)
    return Path(found)


TOKEN_PATH = _token_path()
NLM_PATH = _nlm_path()


def get_token() -> str:
    if not TOKEN_PATH.exists():
        print(f"Token file not found: {TOKEN_PATH}", file=sys.stderr)
        sys.exit(2)
    token = TOKEN_PATH.read_text().strip()
    if not token:
        print(f"Token file is empty: {TOKEN_PATH}", file=sys.stderr)
        sys.exit(2)
    return token


def extract_tags(doc: dict) -> List[str]:
    tags = doc.get("tags") or doc.get("document_tags") or []
    if isinstance(tags, dict):
        tags = list(tags.keys())
    return [t.lower() for t in tags if isinstance(t, str)]


def extract_title(doc: dict) -> str:
    return doc.get("title") or doc.get("document_title") or "Untitled"


def find_html(doc: dict) -> Optional[str]:
    for key in ("html", "html_content", "content"):
        val = doc.get(key)
        if isinstance(val, str) and "<" in val and ">" in val:
            return val
    return None


def fetch_with_retry(url: str, headers: dict, params: dict, max_retries: int = 5) -> requests.Response:
    """Fetch with exponential backoff for rate limiting."""
    for attempt in range(max_retries):
        resp = requests.get(url, headers=headers, params=params, timeout=60)
        if resp.status_code == 429:
            wait_time = 2 ** attempt  # exponential backoff: 1, 2, 4, 8, 16 seconds
            retry_after = resp.headers.get("Retry-After")
            if retry_after:
                wait_time = max(wait_time, int(retry_after))
            print(f"  Rate limited, waiting {wait_time}s (attempt {attempt + 1}/{max_retries})...")
            time.sleep(wait_time)
            continue
        resp.raise_for_status()
        return resp
    # Final attempt
    resp = requests.get(url, headers=headers, params=params, timeout=60)
    resp.raise_for_status()
    return resp


def fetch_documents_by_tag(token: str, tag: str, with_html: bool = False) -> List[dict]:
    """Fetch documents filtered by tag server-side."""
    headers = {"Authorization": f"Token {token}"}
    params = {"tag": tag}  # type: dict
    if with_html:
        params["withHtmlContent"] = "true"

    all_docs = []  # type: List[dict]
    cursor = None
    page = 0

    for _ in range(100):  # pagination limit
        if cursor:
            params["pageCursor"] = cursor

        page += 1
        print(f"  Fetching page {page} for tag '{tag}'...", end=" ", flush=True)
        resp = fetch_with_retry(READWISE_LIST_URL, headers, params)
        data = resp.json()

        docs = data.get("results", [])
        all_docs.extend(docs)
        print(f"got {len(docs)} documents (total: {len(all_docs)})")

        cursor = data.get("nextPageCursor")
        if not cursor:
            break

        # Small delay between pages to avoid rate limiting
        time.sleep(0.5)

    return all_docs


def html_to_markdown(html: str) -> str:
    try:
        import html2text
    except ImportError:
        print("Missing html2text. Install: pip install html2text", file=sys.stderr)
        sys.exit(3)

    h = html2text.HTML2Text()
    h.body_width = 0
    h.ignore_images = False
    h.ignore_links = False
    return h.handle(html)


def add_to_notebook(notebook_id: str, markdown: str, title: str) -> bool:
    if not NLM_PATH.exists():
        print(f"nlm CLI not found: {NLM_PATH}", file=sys.stderr)
        return False

    proc = subprocess.run(
        [str(NLM_PATH), "add", notebook_id, "-"],
        input=markdown.encode("utf-8"),
        capture_output=True,
    )

    if proc.returncode != 0:
        print(f"Failed to add '{title}': {proc.stderr.decode()}", file=sys.stderr)
        return False

    print(f"Added '{title}' to notebook {notebook_id}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Add Readwise documents to NotebookLM")
    parser.add_argument("--tag", action="append", dest="tags", required=True,
                        help="Tag to filter documents by (can specify multiple with --tag X --tag Y)")
    parser.add_argument("--notebook", required=True, help="NotebookLM notebook ID")
    parser.add_argument("--dry-run", action="store_true", help="List documents without adding")
    parser.add_argument("--verbose", "-v", action="store_true", help="Verbose output")
    args = parser.parse_args()

    token = get_token()

    # Fetch documents for each tag (server-side filtering)
    all_matched = {}  # Use dict to dedupe by ID
    for tag in args.tags:
        print(f"Fetching documents with tag '{tag}'...")
        docs = fetch_documents_by_tag(token, tag, with_html=not args.dry_run)
        for doc in docs:
            doc_id = doc.get("id")
            if doc_id and doc_id not in all_matched:
                all_matched[doc_id] = doc

    matched = list(all_matched.values())
    print(f"\nTotal unique documents: {len(matched)}")

    if args.dry_run:
        print("\nDocuments (dry run):")
        for doc in matched:
            print(f"  - {extract_title(doc)}")
        return

    # Process each document
    added = 0
    skipped = 0
    for i, doc in enumerate(matched, 1):
        title = extract_title(doc)
        html = find_html(doc)

        if not html:
            if args.verbose:
                print(f"[{i}/{len(matched)}] Skipping '{title}' (no HTML content)")
            skipped += 1
            continue

        print(f"[{i}/{len(matched)}] Adding '{title}'...", end=" ", flush=True)
        markdown = f"# {title}\n\n" + html_to_markdown(html)

        if add_to_notebook(args.notebook, markdown, title):
            added += 1
        else:
            skipped += 1

        # Small delay between adds
        time.sleep(0.3)

    print(f"\nDone: {added} added, {skipped} skipped")


if __name__ == "__main__":
    main()
