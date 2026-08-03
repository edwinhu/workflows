#!/usr/bin/env -S uv run python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["lxml"]
# ///
"""Extract a document's comments as structured data — from a .docx or from Google Drive.

WHY ONE SCHEMA FOR TWO BACKENDS

A coauthor's substantive feedback lives in comments, not in the tracked text, and it
arrives by whichever route they used: a Word file or a Drive link. Those two APIs
describe the same thing in different shapes (`w:commentRangeStart` + `commentsExtended`
vs. `quotedFileContent` + `resolved`). Anything downstream that has to branch on the
backend will drift, so both are normalized to ONE schema and the tests assert the two
key sets are equal:

    {"source", "file", "comments": [
        {"id", "author", "created", "modified", "text", "quoted", "resolved",
         "replies": [{"id", "author", "created", "modified", "text"}]}
    ]}

`quoted` is the load-bearing field: a comment without the text it points at cannot be
acted on. In a docx that text is not stored with the comment — it is delimited in
document.xml by `w:commentRangeStart`/`w:commentRangeEnd` bracketing the commented
runs, so it has to be reassembled by walking the body in document order.

`resolved` comes from `word/commentsExtended.xml` (`w15:done`), a part Word writes
separately from comments.xml and keys by the `w14:paraId` of a comment's LAST
paragraph — NOT by comment id. That part also carries threading: a reply's
`w15:paraIdParent` points at the paragraph of the comment it answers. A file written by
an older Word, or by pandoc, has no commentsExtended at all; then nothing is resolved
and nothing is threaded, which is reported faithfully rather than guessed.

DRIVE IS READ-ONLY

`--from-drive` shells out to `gws drive comments list`. There is no write path here on
purpose: Drive is a place comments are read out of, never a content round trip.

Usage:
    comments.py --from-docx returned.docx
    comments.py --from-drive <fileId>
    comments.py --from-drive-json recorded.json     # map a saved API response
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from pathlib import Path

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"
W15 = "http://schemas.microsoft.com/office/word/2012/wordml"

COMMENT_KEYS = ["id", "author", "created", "modified", "text", "quoted", "resolved", "replies"]
REPLY_KEYS = ["id", "author", "created", "modified", "text"]
TOP_KEYS = ["source", "file", "comments"]


def _para_text(el) -> str:
    """Visible text of an element, with paragraph breaks preserved as newlines."""
    paras = el.findall(f".//{{{W}}}p")
    if not paras:
        return "".join(t.text or "" for t in el.findall(f".//{{{W}}}t"))
    return "\n".join(
        "".join(t.text or "" for t in p.findall(f".//{{{W}}}t")) for p in paras
    ).strip()


def _quoted_ranges(document_xml: bytes) -> dict[str, str]:
    """Map comment id -> the document text its range brackets.

    Walks the body in document order tracking which ranges are open, because a comment
    range can span runs, paragraphs, and other comments' ranges.
    """
    root = etree.fromstring(document_xml)
    open_ids: set[str] = set()
    acc: dict[str, list[str]] = {}

    for el in root.iter():
        tag = etree.QName(el).localname if isinstance(el.tag, str) else ""
        ns = etree.QName(el).namespace if isinstance(el.tag, str) else ""
        if ns != W:
            continue
        if tag == "commentRangeStart":
            cid = el.get(f"{{{W}}}id")
            if cid is not None:
                open_ids.add(cid)
                acc.setdefault(cid, [])
        elif tag == "commentRangeEnd":
            cid = el.get(f"{{{W}}}id")
            open_ids.discard(cid)
        elif tag == "t" and open_ids:
            for cid in open_ids:
                acc[cid].append(el.text or "")
        elif tag == "p" and open_ids:
            # A range that spans paragraphs should not run words together.
            for cid in open_ids:
                if acc[cid] and not acc[cid][-1].endswith(" "):
                    acc[cid].append(" ")

    return {cid: "".join(parts).strip() for cid, parts in acc.items()}


def from_docx(path: Path) -> dict:
    path = Path(path)
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        if "word/comments.xml" not in names:
            return {"source": "docx", "file": str(path), "comments": []}
        comments_xml = z.read("word/comments.xml")
        document_xml = z.read("word/document.xml") if "word/document.xml" in names else b"<a/>"
        extended_xml = (
            z.read("word/commentsExtended.xml") if "word/commentsExtended.xml" in names else None
        )

    quoted = _quoted_ranges(document_xml)

    # paraId of each comment's LAST paragraph — the key commentsExtended uses.
    root = etree.fromstring(comments_xml)
    by_id: dict[str, dict] = {}
    para_of: dict[str, str] = {}
    order: list[str] = []
    for c in root.findall(f"{{{W}}}comment"):
        cid = c.get(f"{{{W}}}id")
        if cid is None:
            continue
        paras = c.findall(f"{{{W}}}p")
        if paras:
            pid = paras[-1].get(f"{{{W14}}}paraId")
            if pid:
                para_of[pid] = cid
        by_id[cid] = {
            "id": cid,
            "author": c.get(f"{{{W}}}author") or "",
            "created": c.get(f"{{{W}}}date"),
            "modified": None,
            "text": _para_text(c),
            "quoted": quoted.get(cid, ""),
            "resolved": False,
            "replies": [],
        }
        order.append(cid)

    parent_of: dict[str, str] = {}
    if extended_xml is not None:
        ext = etree.fromstring(extended_xml)
        for ex in ext.findall(f"{{{W15}}}commentEx"):
            pid = ex.get(f"{{{W15}}}paraId")
            cid = para_of.get(pid)
            if cid is None:
                continue
            done = ex.get(f"{{{W15}}}done")
            by_id[cid]["resolved"] = done in ("1", "true")
            parent_pid = ex.get(f"{{{W15}}}paraIdParent")
            if parent_pid and parent_pid in para_of:
                parent_of[cid] = para_of[parent_pid]

    # Fold replies into their parents. A reply's own `resolved`/`quoted` are not part of
    # the reply schema: Word resolves a THREAD, and the anchor belongs to the thread head.
    top = []
    for cid in order:
        parent = parent_of.get(cid)
        if parent and parent in by_id:
            r = by_id[cid]
            by_id[parent]["replies"].append({k: r[k] for k in REPLY_KEYS})
            # A resolved reply means the thread is resolved.
            by_id[parent]["resolved"] = by_id[parent]["resolved"] or r["resolved"]
        else:
            top.append(by_id[cid])

    return {"source": "docx", "file": str(path), "comments": top}


def _drive_comment(c: dict) -> dict:
    return {
        "id": c.get("id") or "",
        "author": (c.get("author") or {}).get("displayName") or "",
        "created": c.get("createdTime"),
        "modified": c.get("modifiedTime"),
        "text": c.get("content") or "",
        "quoted": (c.get("quotedFileContent") or {}).get("value") or "",
        "resolved": bool(c.get("resolved")),
        "replies": [
            {
                "id": r.get("id") or "",
                "author": (r.get("author") or {}).get("displayName") or "",
                "created": r.get("createdTime"),
                "modified": r.get("modifiedTime"),
                "text": r.get("content") or "",
            }
            for r in (c.get("replies") or [])
        ],
    }


def from_drive_payload(payload: dict, file_id: str) -> dict:
    """Map a Drive `comments.list` response onto the shared schema."""
    return {
        "source": "drive",
        "file": file_id,
        "comments": [_drive_comment(c) for c in (payload.get("comments") or [])],
    }


def from_drive(file_id: str) -> dict:
    """Live read via the gws CLI. Drive is read-only here — there is no write path."""
    params = json.dumps({
        "fileId": file_id,
        "fields": "*",
        "includeDeleted": False,
    })
    proc = subprocess.run(
        ["gws", "drive", "comments", "list", "--params", params, "--format", "json"],
        capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"gws drive comments list failed: {proc.stderr.strip()}")
    return from_drive_payload(json.loads(proc.stdout), file_id)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--from-docx", type=Path)
    g.add_argument("--from-drive", metavar="FILE_ID")
    g.add_argument("--from-drive-json", type=Path, help="map a recorded API response instead of calling Drive")
    ap.add_argument("--file-id", default="", help="with --from-drive-json: the id to record in `file`")
    ap.add_argument("--output", type=Path)
    ap.add_argument("--unresolved-only", action="store_true", help="drop resolved threads")

    args = ap.parse_args(argv)

    try:
        if args.from_docx:
            result = from_docx(args.from_docx)
        elif args.from_drive:
            result = from_drive(args.from_drive)
        else:
            payload = json.loads(args.from_drive_json.read_text(encoding="utf-8"))
            result = from_drive_payload(payload, args.file_id)
    except (RuntimeError, OSError, json.JSONDecodeError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 2

    if args.unresolved_only:
        result["comments"] = [c for c in result["comments"] if not c["resolved"]]

    text = json.dumps(result, indent=2, ensure_ascii=False)
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
