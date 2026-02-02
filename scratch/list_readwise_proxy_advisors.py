#!/usr/bin/env python3
"""
Fetch Readwise documents tagged 'proxy advisors', convert HTML to Markdown,
and add each to a NotebookLM notebook using the `nlm` CLI.

Reads Readwise token from:
  /var/folders/01/wzs3mqmn3jx2b81f0dcq9w8h0000gq/T/agenix/readwise-token

NotebookLM notebook id: 1457a61e-02ff-4ef0-a0de-deeb0e931972
nlm CLI path: /Users/vwh7mb/projects/nlm/nlm

This script:
- Lists documents via Readwise `/api/v3/list/` with `withHtmlContent=true`
- Filters by tag `proxy advisors`
- Converts HTML -> Markdown using the `html2text` Python module
- Pipes markdown to `nlm add <notebook> -` for each document

Note: Requires `requests` and `html2text` Python packages and the `nlm` CLI.
"""

import json
import sys
import subprocess
from pathlib import Path
from typing import List, Dict, Any, Optional

import requests


TOKEN_PATH = Path(
    "/var/folders/01/wzs3mqmn3jx2b81f0dcq9w8h0000gq/T/agenix/readwise-token"
)
TAG = "proxy advisors"
READWISE_LIST_URL = "https://readwise.io/api/v3/list/"
NLM_PATH = Path("/Users/vwh7mb/projects/nlm/nlm")
NOTEBOOK_ID = "1457a61e-02ff-4ef0-a0de-deeb0e931972"

if not TOKEN_PATH.exists():
    print(f"Token file not found: {TOKEN_PATH}", file=sys.stderr)
    sys.exit(2)

token = TOKEN_PATH.read_text().strip()
if not token:
    print(f"Token file is empty: {TOKEN_PATH}", file=sys.stderr)
    sys.exit(2)

# html2text: prefer python module; fail with helpful message if missing
try:
    import html2text
except Exception:
    print(
        "The python module 'html2text' is required. Install with: pip install html2text",
        file=sys.stderr,
    )
    sys.exit(3)

session = requests.Session()


def extract_tags(d: Dict[str, Any]) -> List[str]:
    tags = d.get("tags") or d.get("document_tags") or d.get("tags_list") or []
    if isinstance(tags, dict):
        # some APIs return dict of tag->info
        tags = list(tags.keys())
    return [t.lower() for t in tags if isinstance(t, str)]


def extract_title(d: Dict[str, Any]) -> str:
    return (
        d.get("title")
        or d.get("document_title")
        or d.get("name")
        or (d.get("attributes") or {}).get("document_title")
        or "Untitled"
    )


def find_html_in_doc(d: Dict[str, Any]) -> Optional[str]:
    # common fields that might contain HTML
    for key in (
        "html",
        "html_content",
        "document_html",
        "content",
        "full_html",
        "full_content",
        "document_content",
    ):
        v = d.get(key)
        if isinstance(v, str) and "<" in v and ">" in v:
            return v
    # nested attributes
    attrs = d.get("attributes") or {}
    for key in ("html", "document_html", "html_content"):
        v = attrs.get(key)
        if isinstance(v, str) and "<" in v:
            return v
    return None


def fetch_list_with_html(auth_header: str) -> Optional[List[Dict[str, Any]]]:
    headers = {"Authorization": auth_header}
    params: Dict[str, Any] = {"withHtmlContent": "true"}
    all_docs: List[Dict[str, Any]] = []
    cursor = None
    for _ in range(200):
        if cursor:
            params["pageCursor"] = cursor
        try:
            r = session.get(
                READWISE_LIST_URL, headers=headers, params=params, timeout=30
            )
        except Exception as e:
            print(f"Request error: {e}", file=sys.stderr)
            return None
        if r.status_code == 401:
            return None
        if not r.ok:
            print(f"HTTP {r.status_code}: {r.text}", file=sys.stderr)
            return None
        try:
            data = r.json()
        except Exception as e:
            print(f"Invalid JSON response: {e}", file=sys.stderr)
            return None

        docs = None
        if isinstance(data, list):
            docs = data
            cursor = None
        elif isinstance(data, dict):
            if "results" in data:
                docs = data["results"]
                cursor = (
                    data.get("pageCursor") or data.get("next") or data.get("nextCursor")
                )
            elif "documents" in data:
                docs = data["documents"]
                cursor = (
                    data.get("pageCursor") or data.get("next") or data.get("nextCursor")
                )
            elif "data" in data and isinstance(data["data"], list):
                docs = data["data"]
                cursor = (
                    data.get("pageCursor") or data.get("next") or data.get("nextCursor")
                )
            else:
                docs = [data]
                cursor = None
        else:
            print("Unexpected response shape", file=sys.stderr)
            return None

        all_docs.extend(docs)
        if not cursor:
            break
    return all_docs


def fetch_single_doc_by_id(doc_id: str, auth_header: str) -> Optional[Dict[str, Any]]:
    url = f"https://readwise.io/api/v3/documents/{doc_id}"
    headers = {"Authorization": auth_header}
    params = {"withHtmlContent": "true"}
    try:
        r = session.get(url, headers=headers, params=params, timeout=30)
    except Exception as e:
        print(f"Error fetching document {doc_id}: {e}", file=sys.stderr)
        return None
    if not r.ok:
        print(f"HTTP {r.status_code} fetching {doc_id}: {r.text}", file=sys.stderr)
        return None
    try:
        return r.json()
    except Exception as e:
        print(f"Invalid JSON for document {doc_id}: {e}", file=sys.stderr)
        return None


def html_to_markdown(html: str) -> str:
    h = html2text.HTML2Text()
    h.body_width = 0
    h.ignore_images = False
    h.ignore_links = False
    return h.handle(html)


def add_to_notebook(markdown: str, title: str) -> bool:
    if not NLM_PATH.exists():
        print(
            f"nlm CLI not found at {NLM_PATH}; skipping add for '{title}'",
            file=sys.stderr,
        )
        return False
    try:
        proc = subprocess.run(
            [str(NLM_PATH), "add", NOTEBOOK_ID, "-"],
            input=markdown.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except Exception as e:
        print(f"Failed to run nlm for '{title}': {e}", file=sys.stderr)
        return False
    if proc.returncode != 0:
        print(
            f"nlm add failed for '{title}': {proc.returncode} {proc.stderr.decode()}",
            file=sys.stderr,
        )
        return False
    print(f"Added '{title}' to notebook {NOTEBOOK_ID}")
    return True


def main():
    # Try authentication schemes
    for scheme in ("Token", "Bearer"):
        auth = f"{scheme} {token}"
        docs = fetch_list_with_html(auth)
        if docs is None:
            continue

        # Filter docs by tag
        matched = []
        for d in docs:
            try:
                tags = extract_tags(d)
            except Exception:
                tags = []
            if TAG.lower() in tags:
                matched.append(d)

        if not matched:
            print(
                "No documents found with that tag using scheme", scheme, file=sys.stderr
            )
            continue

        # Process each matched document
        for d in matched:
            title = extract_title(d)
            html = find_html_in_doc(d)
            # if no html, try fetching by id
            if not html and d.get("id"):
                single = fetch_single_doc_by_id(str(d.get("id")), auth)
                if single:
                    html = find_html_in_doc(single) or html
                    # if the single doc API wraps document under 'document' key
                    if not html and isinstance(single.get("document"), dict):
                        html = find_html_in_doc(single.get("document"))

            if not html:
                print(f"No HTML content found for '{title}'; skipping", file=sys.stderr)
                continue

            markdown = html_to_markdown(html)
            # Prepend a title header
            md_with_title = f"# {title}\n\n" + markdown

            success = add_to_notebook(md_with_title, title)
            if not success:
                print(f"Failed to add '{title}'", file=sys.stderr)

        # finished processing
        return

    print("Authentication failed or no documents found with that tag.", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
