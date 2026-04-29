#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=12"]
# ///
"""
find_and_add.py — citation string → paper in Paperpile with PDF.

Usage:
    find_and_add.py "Robertson, Passive in Name Only, 36 Yale J. on Reg. 795 (2019)"
    find_and_add.py --doi 10.2139/ssrn.5093097
    find_and_add.py --ssrn 5093097
    find_and_add.py --title "Agents Watching Agents" --author "Black" --year 1992

Discovery chain (first hit wins):
    1. CrossRef API (query.bibliographic)
    2. OpenAlex API (search)
    3. SSRN (if ssrn_id provided or detected)
    4. HeinOnline URL construction (for law review articles with volume/page)

Once metadata is found:
    - POST /api/library to add to Paperpile
    - Trigger PDF resolution (find-pdf or resolve chain)
    - Poll for attachment
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = SKILL_DIR / "scripts"
DATA_DIR = (
    Path(os.environ.get("CLAUDE_CONFIG_DIR", str(Path.home() / ".claude-work")))
    / "skills" / "paperpile"
)
CACHE_FILE = DATA_DIR / "cache" / "paperpile-index.json"

# ---------------------------------------------------------------------------
# Citation parsing
# ---------------------------------------------------------------------------

def parse_citation(cite: str) -> dict:
    """Best-effort parse of a free-form citation string."""
    info: dict = {}

    # Extract year
    m = re.search(r'\((\d{4})\)', cite)
    if m:
        info['year'] = m.group(1)

    # Extract SSRN ID
    m = re.search(r'SSRN\s+(\d+)', cite, re.I)
    if m:
        info['ssrn_id'] = m.group(1)

    # Extract volume and page: "36 Yale J. on Reg. 795"
    m = re.search(r'(\d+)\s+(.+?)\s+(\d+)\s*\(', cite)
    if m:
        info['volume'] = m.group(1)
        info['journal_abbrev'] = m.group(2).strip()
        info['start_page'] = m.group(3)

    # Extract author (first comma-separated token, or first word)
    parts = cite.split(',')
    if parts:
        info['author'] = parts[0].strip()

    # Extract title (second comma-separated token, or between first comma and volume/year)
    if len(parts) >= 2:
        title_part = parts[1].strip()
        # Remove volume/page/year suffix
        title_part = re.sub(r'\d+\s+\w.*$', '', title_part).strip()
        if title_part:
            info['title'] = title_part

    return info


# ---------------------------------------------------------------------------
# Discovery: CrossRef
# ---------------------------------------------------------------------------

def search_crossref(query: str, rows: int = 5) -> list[dict]:
    """Search CrossRef by bibliographic query. Returns list of {doi, title, author, year, journal}."""
    url = f"https://api.crossref.org/works?query.bibliographic={urllib.parse.quote(query)}&rows={rows}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "paperpile-find-and-add/0.1 (mailto:ehu@law.virginia.edu)"
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"[crossref] error: {e}", file=sys.stderr)
        return []

    results = []
    for item in data.get("message", {}).get("items", []):
        authors = []
        for a in item.get("author", []):
            name = a.get("family", "")
            if a.get("given"):
                name = f"{a['given']} {name}"
            authors.append(name)

        results.append({
            "doi": item.get("DOI"),
            "title": (item.get("title") or [""])[0],
            "author": authors,
            "year": str(item.get("published-print", item.get("published-online", {})).get("date-parts", [[None]])[0][0] or ""),
            "journal": (item.get("container-title") or [""])[0],
            "score": item.get("score", 0),
        })
    return results


# ---------------------------------------------------------------------------
# Discovery: OpenAlex
# ---------------------------------------------------------------------------

def search_openalex(query: str, per_page: int = 5) -> list[dict]:
    """Search OpenAlex. Returns list of {doi, title, author, year, journal, oa_url}."""
    url = f"https://api.openalex.org/works?search={urllib.parse.quote(query)}&per_page={per_page}"
    req = urllib.request.Request(url, headers={
        "User-Agent": "paperpile-find-and-add/0.1 (mailto:ehu@law.virginia.edu)"
    })
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
    except Exception as e:
        print(f"[openalex] error: {e}", file=sys.stderr)
        return []

    results = []
    for r in data.get("results", []):
        authors = [a.get("author", {}).get("display_name", "") for a in r.get("authorships", [])]
        doi = r.get("doi", "")
        if doi and doi.startswith("https://doi.org/"):
            doi = doi[len("https://doi.org/"):]

        loc = r.get("primary_location") or {}
        src = loc.get("source") or {}

        results.append({
            "doi": doi or None,
            "title": r.get("title", ""),
            "author": authors,
            "year": str(r.get("publication_year", "")),
            "journal": src.get("display_name", ""),
            "oa_url": r.get("open_access", {}).get("oa_url"),
        })
    return results


# ---------------------------------------------------------------------------
# Discovery: match results against citation
# ---------------------------------------------------------------------------

def score_match(result: dict, info: dict) -> float:
    """Score how well a search result matches parsed citation info.

    Requires MAJORITY of title words to overlap (not just 1-2 common words).
    Stopwords are excluded to prevent false matches on 'in', 'of', 'the', etc.
    """
    STOPWORDS = {"a", "an", "the", "of", "in", "on", "for", "and", "or", "to", "is", "by", "with", "from", "at", "as", "not", "but", "its", "that", "this", "into"}
    score = 0.0

    if info.get("title") and result.get("title"):
        cite_tokens = set(info["title"].lower().split()) - STOPWORDS
        result_tokens = set(result["title"].lower().split()) - STOPWORDS
        if cite_tokens and result_tokens:
            overlap_count = len(cite_tokens & result_tokens)
            overlap_ratio = overlap_count / len(cite_tokens)
            # Require at least 50% overlap AND at least 2 matching content words
            if overlap_ratio >= 0.5 and overlap_count >= 2:
                score += overlap_ratio * 8
            else:
                score += overlap_ratio * 2  # Weak match — don't rely on this alone

    if info.get("author") and result.get("author"):
        author_lower = info["author"].lower()
        for a in result["author"]:
            if author_lower in a.lower():
                score += 3
                break

    if info.get("year") and result.get("year"):
        if info["year"] == result["year"]:
            score += 2

    return score


def discover(info: dict, raw_cite: str) -> dict | None:
    """Try CrossRef and OpenAlex to find DOI + metadata."""
    # Build search query
    parts = []
    if info.get("title"):
        parts.append(info["title"])
    if info.get("author"):
        parts.append(info["author"])
    if info.get("journal_abbrev"):
        parts.append(info["journal_abbrev"])
    if info.get("year"):
        parts.append(info["year"])
    query = " ".join(parts) if parts else raw_cite

    print(f"[discover] searching: {query}", file=sys.stderr)

    # CrossRef
    cr_results = search_crossref(query)
    for r in cr_results:
        s = score_match(r, info)
        r["_score"] = s
    cr_results.sort(key=lambda x: x["_score"], reverse=True)

    if cr_results and cr_results[0]["_score"] >= 7 and cr_results[0].get("doi"):
        best = cr_results[0]
        print(f"[crossref] match: {best['doi']} — {best['title'][:60]} (score={best['_score']:.1f})", file=sys.stderr)
        return best
    elif cr_results:
        print(f"[crossref] best candidate below threshold: {cr_results[0].get('title','?')[:50]} (score={cr_results[0]['_score']:.1f})", file=sys.stderr)

    # OpenAlex
    oa_results = search_openalex(query)
    for r in oa_results:
        s = score_match(r, info)
        r["_score"] = s
    oa_results.sort(key=lambda x: x["_score"], reverse=True)

    if oa_results and oa_results[0]["_score"] >= 7 and oa_results[0].get("doi"):
        best = oa_results[0]
        print(f"[openalex] match: {best['doi']} — {best['title'][:60]} (score={best['_score']:.1f})", file=sys.stderr)
        return best
    elif oa_results:
        print(f"[openalex] best candidate below threshold: {oa_results[0].get('title','?')[:50]} (score={oa_results[0]['_score']:.1f})", file=sys.stderr)

    # No DOI found — return best metadata we have (for manual add)
    all_results = cr_results + oa_results
    all_results.sort(key=lambda x: x.get("_score", 0), reverse=True)
    if all_results and all_results[0]["_score"] >= 3:
        best = all_results[0]
        print(f"[discover] partial match (no DOI): {best['title'][:60]} (score={best['_score']:.1f})", file=sys.stderr)
        return best

    print(f"[discover] no match found in CrossRef or OpenAlex", file=sys.stderr)
    return None


# ---------------------------------------------------------------------------
# HeinOnline URL construction
# ---------------------------------------------------------------------------

HEIN_JOURNAL_MAP = {
    # Map journal abbreviations → HeinOnline handles
    "UCLA L. Rev.": "uclalr",
    "UCLA L Rev": "uclalr",
    "Yale J. on Reg.": "yalereg",
    "Yale J. Reg.": "yalereg",
    "Yale J Reg": "yalereg",
    "Yale J. on Regulation": "yalereg",
    "Yale L.J.": "ylj",
    "Yale Law J.": "ylj",
    "Harv. L. Rev.": "hlr",
    "Harvard Law Review": "hlr",
    "Stan. L. Rev.": "stflr",
    "Colum. L. Rev.": "clr",
    "Mich. L. Rev.": "milr",
    "Mich Law Rev": "milr",
    "Va. L. Rev.": "valr",
    "U. Pa. L. Rev.": "uplr",
    "N.Y.U. L. Rev.": "nyulr",
    "Chi. L. Rev.": "uclr",
    "Geo. L.J.": "glj",
    "Duke L.J.": "duklr",
    "Cornell L. Rev.": "conlr",
    "Nw. U. L. Rev.": "illlr",
    "Tex. L. Rev.": "tlr",
    "B.U. L. Rev.": "bulr",
    "BUL Rev": "bulr",
    "Brook. J. Corp. Fin. & Com. L.": "bjcfcl",
    "Brook JCorp Fin & Com L": "bjcfcl",
    "J. Econ. Perspect.": None,  # Not HeinOnline
    "Rev. Financ. Stud.": None,  # Not HeinOnline
    "J. Finance": None,  # Not HeinOnline
    "Colum L Rev Forum": "clrf",
    "Univ PA Law Rev": "uplr",
    "Maryland Law Review": "mdlr",
}


def construct_heinonline_url(info: dict) -> str | None:
    """Construct a HeinOnline search URL from citation components."""
    journal = info.get("journal_abbrev", "")
    volume = info.get("volume")
    page = info.get("start_page")

    # Try to find handle
    handle = None
    for abbrev, h in HEIN_JOURNAL_MAP.items():
        if abbrev.lower() in journal.lower() or journal.lower() in abbrev.lower():
            handle = h
            break

    if not handle or not volume or not page:
        return None

    # Construct proxied HeinOnline URL
    # Pattern: /HOL/Page?handle=hein.journals/<handle><vol>&div=&start_page=<page>&collection=journals
    base = f"https://heinonline-org.proxy1.library.virginia.edu/HOL/Page"
    params = urllib.parse.urlencode({
        "handle": f"hein.journals/{handle}{volume}",
        "start_page": page,
        "collection": "journals",
        "id": "",
    })
    return f"{base}?{params}"


# ---------------------------------------------------------------------------
# Paperpile add (via CLI or API)
# ---------------------------------------------------------------------------

def paperpile_add_doi(doi: str) -> str | None:
    """Add paper by DOI via paperpile CLI. Returns pub_id or None."""
    result = subprocess.run(
        ["paperpile", "add", doi],
        capture_output=True, text=True, timeout=60
    )
    # Output is pub_id on last line
    output = result.stdout.strip()
    if result.returncode == 0 and output:
        pub_id = output.split('\n')[-1].strip()
        print(f"[paperpile] added: {pub_id}", file=sys.stderr)
        return pub_id
    elif "already in library" in result.stdout:
        pub_id = output.split('\n')[-1].strip()
        print(f"[paperpile] already exists: {pub_id}", file=sys.stderr)
        return pub_id
    else:
        print(f"[paperpile] add failed: {result.stderr or result.stdout}", file=sys.stderr)
        return None


def paperpile_add_metadata(metadata: dict) -> str | None:
    """Add paper by metadata via paperpile CLI --force with DOI, or return None if no DOI."""
    doi = metadata.get("doi")
    if doi:
        return paperpile_add_doi(doi)

    # No DOI — try SSRN DOI
    ssrn_id = metadata.get("ssrn_id")
    if ssrn_id:
        return paperpile_add_doi(f"10.2139/ssrn.{ssrn_id}")

    print(f"[paperpile] no DOI available — cannot add via CLI", file=sys.stderr)
    return None


# ---------------------------------------------------------------------------
# PDF resolution
# ---------------------------------------------------------------------------

def resolve_pdf(pub_id: str | None = None, doi: str | None = None,
                ssrn_id: str | None = None, heinonline_url: str | None = None,
                out_dir: str = "/tmp/paperpile-resolve") -> str | None:
    """Try to get the PDF. Returns path or None."""
    resolve_script = SCRIPTS_DIR / "resolve_pdf.py"

    # If we have a DOI, use resolve_pdf.py
    if doi:
        cmd = [str(resolve_script), "--doi", doi, "--out", out_dir, "--via-dia"]
        print(f"[resolve] trying: {' '.join(cmd)}", file=sys.stderr)
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if result.returncode == 0:
            pdf_path = result.stdout.strip()
            print(f"[resolve] success: {pdf_path}", file=sys.stderr)
            return pdf_path
        print(f"[resolve] failed: {result.stderr.strip().split(chr(10))[-1]}", file=sys.stderr)

    # If we have a HeinOnline URL, try downloading via Dia CDP
    if heinonline_url:
        print(f"[heinonline] URL: {heinonline_url}", file=sys.stderr)
        print(f"[heinonline] open this URL in Dia (proxied through UVA) and download the PDF", file=sys.stderr)
        # For now, print the URL — actual CDP download to be added
        # The user can use --manual-hop or browser automation

    return None


def poll_attachment(pub_id: str, timeout: int = 90) -> str | None:
    """Poll for PDF attachment. Returns gdrive_id or None."""
    poll_script = SCRIPTS_DIR / "poll_attachment.sh"
    result = subprocess.run(
        [str(poll_script), pub_id, "--timeout", str(timeout)],
        capture_output=True, text=True, timeout=timeout + 10
    )
    if result.returncode == 0:
        gdrive_id = result.stdout.strip()
        print(f"[poll] PDF attached: {gdrive_id}", file=sys.stderr)
        return gdrive_id
    return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Find a paper, add to Paperpile, and get the PDF."
    )
    parser.add_argument("citation", nargs="?", help="Free-form citation string")
    parser.add_argument("--doi", help="DOI (skip discovery)")
    parser.add_argument("--ssrn", dest="ssrn_id", help="SSRN abstract ID")
    parser.add_argument("--title", help="Paper title")
    parser.add_argument("--author", help="Author last name")
    parser.add_argument("--year", help="Publication year")
    parser.add_argument("--journal", help="Journal abbreviation")
    parser.add_argument("--volume", help="Journal volume")
    parser.add_argument("--page", help="Starting page")
    parser.add_argument("--out", default="/tmp/paperpile-resolve", help="Output directory")
    parser.add_argument("--no-pdf", action="store_true", help="Add to library only, skip PDF resolution")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    args = parser.parse_args()

    # Build citation info from args
    info: dict = {}
    if args.citation:
        info = parse_citation(args.citation)
    if args.doi:
        info["doi"] = args.doi
    if args.ssrn_id:
        info["ssrn_id"] = args.ssrn_id
    if args.title:
        info["title"] = args.title
    if args.author:
        info["author"] = args.author
    if args.year:
        info["year"] = args.year
    if args.journal:
        info["journal_abbrev"] = args.journal
    if args.volume:
        info["volume"] = args.volume
    if args.page:
        info["start_page"] = args.page

    if not info:
        print("Error: provide a citation string, --doi, --ssrn, or --title", file=sys.stderr)
        sys.exit(1)

    raw_cite = args.citation or f"{info.get('author','')} {info.get('title','')} {info.get('year','')}"
    print(f"[find-and-add] parsed: {json.dumps(info, indent=2)}", file=sys.stderr)

    # Step 1: Discovery — find DOI + metadata
    metadata = None
    if info.get("doi"):
        metadata = {"doi": info["doi"]}
        print(f"[discover] DOI provided: {info['doi']}", file=sys.stderr)
    elif info.get("ssrn_id"):
        metadata = {"doi": f"10.2139/ssrn.{info['ssrn_id']}", "ssrn_id": info["ssrn_id"]}
        print(f"[discover] SSRN ID provided: {info['ssrn_id']}", file=sys.stderr)
    elif info.get("volume") and info.get("start_page") and info.get("journal_abbrev"):
        # Law review citation with volume/page — check if HeinOnline journal first
        hein_test = construct_heinonline_url(info)
        if hein_test:
            print(f"[discover] law review citation detected — skipping CrossRef (unreliable for HeinOnline journals)", file=sys.stderr)
            metadata = {
                "title": info.get("title", ""),
                "author": [info["author"]] if info.get("author") else [],
                "year": info.get("year", ""),
                "journal": info.get("journal_abbrev", ""),
            }
        else:
            metadata = discover(info, raw_cite)
    else:
        metadata = discover(info, raw_cite)

    if metadata and metadata.get("doi"):
        info["doi"] = metadata["doi"]

    # Step 2: Add to Paperpile
    pub_id = None
    if info.get("doi") or info.get("ssrn_id"):
        pub_id = paperpile_add_metadata({**info, **(metadata or {})})

    # Step 3: Construct HeinOnline URL (for law review articles without DOI)
    hein_url = None
    if not info.get("doi") and info.get("volume") and info.get("start_page"):
        hein_url = construct_heinonline_url(info)
        if hein_url:
            print(f"[heinonline] constructed URL: {hein_url}", file=sys.stderr)

    # Step 4: PDF resolution (unless --no-pdf)
    pdf_path = None
    if not args.no_pdf:
        pdf_path = resolve_pdf(
            pub_id=pub_id,
            doi=info.get("doi"),
            ssrn_id=info.get("ssrn_id"),
            heinonline_url=hein_url,
            out_dir=args.out,
        )

        # Step 5: Poll for attachment if we added to Paperpile
        if pub_id and not pdf_path:
            print(f"[poll] checking if Paperpile found PDF on its own...", file=sys.stderr)
            gdrive_id = poll_attachment(pub_id, timeout=30)
            if gdrive_id:
                print(f"[find-and-add] PDF found by Paperpile: {gdrive_id}", file=sys.stderr)

    # Output
    result = {
        "pub_id": pub_id,
        "doi": info.get("doi"),
        "title": (metadata or {}).get("title") or info.get("title"),
        "pdf_path": pdf_path,
        "heinonline_url": hein_url,
        "status": "pdf_found" if pdf_path else ("added_no_pdf" if pub_id else "discovery_only"),
    }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        status = result["status"]
        if status == "pdf_found":
            print(f"OK: {pdf_path}")
        elif status == "added_no_pdf":
            print(f"Added to Paperpile (pub_id={pub_id}) but no PDF yet")
            if hein_url:
                print(f"HeinOnline URL (open in Dia via UVA proxy): {hein_url}")
        else:
            print(f"Discovery only — no DOI found")
            if hein_url:
                print(f"HeinOnline URL: {hein_url}")
            if metadata:
                print(f"Best match: {metadata.get('title', '?')}")

    sys.exit(0 if pdf_path else (1 if not pub_id else 2))


if __name__ == "__main__":
    main()
