#!/usr/bin/env python3
"""
research.py - Multi-source academic literature search

Usage:
    python3 research.py "<query>" [--n 50] [--min-citations N]

Sources (run in parallel):
    1. scholar lookup  (keyword/citation-ranked)
    2. scholar search  (semantic/NL)
    3. consensus CLI   (empirical, sorted by citations)
    4. Paperpile bib   (personal library, rg keyword search)

Pipeline:
    Step 1 (parallel): Run all four sources
    Step 2: Deduplicate by DOI, then by title
    Step 3 (parallel): CrossRef DOI resolution for SSRN-labeled papers
    Step 4: Output unified JSON for LLM review
"""

import argparse
import json
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

BIB_PATH = Path.home() / "Library/CloudStorage/GoogleDrive-eddyhu@gmail.com/My Drive/resources/My Library.bib"
CONSENSUS_BIN = Path.home() / "projects/consensus-cli/consensus"

SSRN_PATTERNS = re.compile(
    r"eJournal|Topic\)|SSRN Electronic Journal|^PSN:|^ERN:|^ERPN:|^SRPN:|^POL:|^LSN:",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Source 1 & 2: scholar CLI
# ---------------------------------------------------------------------------

def _parse_scholar_authors_field(authors_str: str) -> "tuple[list[str], str, int | None]":
    """Parse scholar's combined 'Author1, Author2 - Journal Name, Year' string.

    Scholar embeds the real journal name and year in the authors field, e.g.:
        "FH Easterbrook, DR Fischel - Virginia Law Review, 1984"
    The `journal` field contains only the host domain (e.g. "JSTOR").
    """
    if not authors_str:
        return [], "", None

    # Scholar uses non-breaking space (\xa0) before the dash separator
    normalized = authors_str.replace("\xa0", " ")
    sep = " - "
    idx = normalized.rfind(sep)
    if idx == -1:
        return _split_authors(authors_str), "", None

    author_part = normalized[:idx]
    journal_year = normalized[idx + len(sep):]

    # Extract trailing year: ", YYYY" (possibly with trailing whitespace)
    year: "int | None" = None
    m = re.search(r",\s*(\d{4})\s*$", journal_year)
    if m:
        year = int(m.group(1))
        journal = journal_year[:m.start()].strip()
    else:
        journal = journal_year.strip()

    return _split_authors(author_part), journal, year


def run_scholar(mode: str, query: str, delay: float = 0) -> list[dict]:
    """Run `scholar lookup` or `scholar search` and return parsed results.

    `delay` (seconds): sleep before running, used to stagger parallel calls
    and avoid 429 Too Many Requests on the scholar search endpoint.
    """
    import time
    if delay:
        time.sleep(delay)

    cmd = ["scholar", mode, query, "--json"]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            stderr = result.stderr.strip()
            if "429" in stderr:
                print(f"[warn] scholar {mode} rate-limited (429); skipping", file=sys.stderr)
            else:
                print(f"[warn] scholar {mode} failed: {stderr}", file=sys.stderr)
            return []
        data = json.loads(result.stdout)
        if not isinstance(data, list):
            return []
    except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception) as e:
        print(f"[warn] scholar {mode} error: {e}", file=sys.stderr)
        return []

    papers = []
    for item in data:
        raw_authors = item.get("authors", "")
        parsed_authors, parsed_journal, parsed_year = _parse_scholar_authors_field(raw_authors)
        papers.append({
            "title": item.get("title", ""),
            "authors": parsed_authors,
            "year": parsed_year if parsed_year is not None else _parse_year(item.get("year")),
            "journal": parsed_journal or item.get("journal", "") or "",
            "doi": item.get("doi") or None,
            "citations": item.get("citations") or 0,
            "takeaway": item.get("snippet") or "",
            "url": item.get("url") or "",
            "source": f"scholar-{mode}",
        })
    return papers


# ---------------------------------------------------------------------------
# Source 3: consensus CLI
# ---------------------------------------------------------------------------

def _map_consensus_paper(item: dict) -> dict:
    return {
        "title": item.get("title", ""),
        "authors": item.get("authors", []),
        "year": item.get("year"),
        "journal": item.get("journal", "") or "",
        "doi": item.get("doi") or None,
        "citations": item.get("citations") or 0,
        "takeaway": item.get("takeaway") or "",
        "url": item.get("url") or "",
        "source": "consensus",
    }


def run_consensus(query: str, n: int = 50, min_citations: int = 0, stream_cb=None) -> list[dict]:
    """Run consensus CLI and return parsed results.

    If stream_cb is provided, it's called with each intermediate paper batch
    as they arrive (requires --stream flag on the CLI).
    """
    cmd = [str(CONSENSUS_BIN), "search", query, "--n", str(n), "--sort", "citations"]
    if min_citations:
        cmd += ["--min-citations", str(min_citations)]
    if stream_cb is not None:
        cmd += ["--stream"]

    if stream_cb is None:
        # Batch mode: wait for full output
        try:
            result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if result.returncode != 0:
                print(f"[warn] consensus failed: {result.stderr.strip()}", file=sys.stderr)
                return []
            data = json.loads(result.stdout)
        except (subprocess.TimeoutExpired, json.JSONDecodeError, Exception) as e:
            print(f"[warn] consensus error: {e}", file=sys.stderr)
            return []
        return [_map_consensus_paper(item) for item in data]

    # Streaming mode: read NDJSON lines as they arrive
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        last_papers: list = []
        for line in proc.stdout:
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(event, dict) or event.get("event") != "poll":
                continue
            papers = [_map_consensus_paper(p) for p in event.get("papers", [])]
            # Only emit new papers since last poll
            new_papers = papers[len(last_papers):]
            if new_papers:
                stream_cb(new_papers)
            last_papers = papers
        proc.wait(timeout=10)
        if proc.returncode != 0:
            stderr = proc.stderr.read().strip()
            print(f"[warn] consensus failed: {stderr}", file=sys.stderr)
        # Final full JSON array is also on stdout — already consumed above
        return last_papers
    except Exception as e:
        print(f"[warn] consensus stream error: {e}", file=sys.stderr)
        return []




# ---------------------------------------------------------------------------
# Source 4: Paperpile bib file (rg keyword search)
# ---------------------------------------------------------------------------

def search_bib(query: str) -> list[dict]:
    """Search bib file via rg and parse matching entries."""
    if not BIB_PATH.exists():
        print(f"[warn] bib file not found: {BIB_PATH}", file=sys.stderr)
        return []

    # Build rg pattern: all query words must appear somewhere in the entry
    words = [w for w in query.lower().split() if len(w) > 2]
    if not words:
        return []

    # Find line numbers of entries whose blocks contain ALL query words
    try:
        bib_text = BIB_PATH.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        print(f"[warn] bib read error: {e}", file=sys.stderr)
        return []

    # Split into individual entries
    raw_entries = re.split(r"\n(?=@)", bib_text)
    matching = []
    for entry in raw_entries:
        entry_lower = entry.lower()
        if all(w in entry_lower for w in words):
            matching.append(entry)

    papers = []
    for entry in matching:
        parsed = _parse_bib_entry(entry)
        if parsed:
            papers.append(parsed)

    return papers


def _parse_bib_entry(entry: str) -> "dict | None":
    """Parse a single BibTeX/biblatex entry into a unified dict."""
    # Entry type and key
    m = re.match(r"@(\w+)\{([^,]+),", entry)
    if not m:
        return None
    entry_type = m.group(1).lower()

    def get_field(name: str) -> str:
        pattern = rf"^\s*{name}\s*=\s*\{{(.*?)\}},?\s*$"
        m = re.search(pattern, entry, re.MULTILINE | re.DOTALL | re.IGNORECASE)
        if m:
            # Clean up nested braces and whitespace
            val = m.group(1).strip()
            val = re.sub(r"\{|\}", "", val)
            val = re.sub(r"\s+", " ", val)
            return val
        return ""

    title = get_field("title") or get_field("shorttitle")
    if not title:
        return None

    # Authors: biblatex uses "family, given and family, given"
    author_raw = get_field("author")
    authors = [a.strip() for a in re.split(r"\s+and\s+", author_raw)] if author_raw else []

    # Journal: biblatex uses journaltitle, bibtex uses journal
    journal = get_field("journaltitle") or get_field("journal") or get_field("booktitle") or ""

    # Year: biblatex uses date, bibtex uses year
    year_raw = get_field("date") or get_field("year") or ""
    year = _parse_year(year_raw[:4] if year_raw else None)

    doi_raw = get_field("doi")
    doi = doi_raw if doi_raw and doi_raw.startswith("10.") else None

    url = get_field("url") or ""
    if doi and not url:
        url = f"https://doi.org/{doi}"

    abstract = get_field("abstract")

    return {
        "title": title,
        "authors": authors,
        "year": year,
        "journal": journal,
        "doi": doi,
        "citations": 0,  # bib doesn't store citation counts
        "takeaway": abstract[:300] + "..." if len(abstract) > 300 else abstract,
        "url": url,
        "source": "bib",
    }


# ---------------------------------------------------------------------------
# Deduplication
# ---------------------------------------------------------------------------

def _normalize_title(title: str) -> str:
    return re.sub(r"[^a-z0-9]", "", title.lower())


def deduplicate(papers: list[dict]) -> list[dict]:
    """Deduplicate by DOI (exact), then by normalized title. Merge sources."""
    seen_doi: dict = {}   # doi -> index in result
    seen_title: dict = {} # normalized title -> index in result
    result: list = []

    for paper in papers:
        doi = (paper.get("doi") or "").strip().lower()
        norm_title = _normalize_title(paper.get("title", ""))
        source = paper.get("source", "unknown")

        matched_idx = None
        if doi and doi in seen_doi:
            matched_idx = seen_doi[doi]
        elif norm_title and norm_title in seen_title:
            matched_idx = seen_title[norm_title]

        if matched_idx is not None:
            # Merge: prefer non-SSRN journal, higher citations, merge sources
            existing = result[matched_idx]
            existing_sources = existing.get("sources", [existing.get("source", "")])
            if source not in existing_sources:
                existing_sources.append(source)
            existing["sources"] = existing_sources

            # Prefer real journal name over SSRN label
            if SSRN_PATTERNS.search(existing["journal"]) and not SSRN_PATTERNS.search(paper["journal"]):
                existing["journal"] = paper["journal"]

            # Keep higher citation count
            if (paper.get("citations") or 0) > (existing.get("citations") or 0):
                existing["citations"] = paper["citations"]

            # Keep DOI if missing
            if not existing.get("doi") and doi:
                existing["doi"] = paper["doi"]
                seen_doi[doi] = matched_idx

            # Keep better takeaway
            if not existing.get("takeaway") and paper.get("takeaway"):
                existing["takeaway"] = paper["takeaway"]
        else:
            idx = len(result)
            paper["sources"] = [source]
            result.append(paper)
            if doi:
                seen_doi[doi] = idx
            if norm_title:
                seen_title[norm_title] = idx

    return result


# ---------------------------------------------------------------------------
# Step 3: CrossRef DOI resolution (parallel)
# ---------------------------------------------------------------------------

def resolve_doi(doi: str) -> "str | None":
    """Return the resolved journal name from CrossRef, or None."""
    try:
        url = f"https://api.crossref.org/works/{doi}"
        with urlopen(url, timeout=10) as resp:
            data = json.loads(resp.read())
        ct = data.get("message", {}).get("container-title", [])
        journal = ct[0] if ct else None
        # Filter out SSRN resolutions
        if journal and SSRN_PATTERNS.search(journal):
            return None
        return journal
    except (URLError, json.JSONDecodeError, Exception):
        return None


def resolve_ssrn_dois(papers: list[dict]) -> list[dict]:
    """Resolve SSRN-labeled papers' DOIs via CrossRef in parallel."""
    to_resolve = [
        (i, p) for i, p in enumerate(papers)
        if p.get("doi") and SSRN_PATTERNS.search(p.get("journal", ""))
    ]
    if not to_resolve:
        return papers

    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {
            executor.submit(resolve_doi, p["doi"]): i
            for i, p in to_resolve
        }
        for future in as_completed(futures):
            idx = futures[future]
            resolved = future.result()
            if resolved:
                papers[idx]["journal_resolved"] = resolved

    return papers


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _split_authors(authors_str: str) -> list[str]:
    if not authors_str:
        return []
    return [a.strip() for a in re.split(r",\s*(?=[A-Z])|;\s*", authors_str) if a.strip()]


def _parse_year(val) -> "int | None":
    if val is None:
        return None
    try:
        return int(str(val)[:4])
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Multi-source academic literature search")
    parser.add_argument("query", help="Search query")
    parser.add_argument("--n", type=int, default=50, help="Consensus result count (default: 50)")
    parser.add_argument("--min-citations", type=int, default=0, help="Minimum citation count")
    parser.add_argument("--no-stream", action="store_true", help="Wait for all sources before outputting (default: stream NDJSON as each source completes)")
    parser.add_argument("--scholar-search", action="store_true", help="Also run scholar search (semantic, opt-in — rate-limited)")
    args = parser.parse_args()

    query = args.query
    print(f"[research] Searching: {query!r}", file=sys.stderr)

    streaming = not args.no_stream

    def emit_source(source: str, results: list) -> None:
        print(f"[research] {source}: {len(results)} results", file=sys.stderr)
        all_papers.extend(results)
        if streaming:
            print(json.dumps({"event": "source", "source": source, "papers": results}, ensure_ascii=False), flush=True)

    # Step 1: Run all sources in parallel
    # Consensus uses streaming poll callback when streaming is enabled
    all_papers: list = []

    consensus_interim_count = [0]  # track already-emitted count for incremental emit

    def consensus_poll_cb(new_papers: list) -> None:
        """Called by run_consensus for each poll batch's new papers."""
        if streaming and new_papers:
            print(json.dumps({"event": "consensus-poll", "papers": new_papers}, ensure_ascii=False), flush=True)
        all_papers.extend(new_papers)
        consensus_interim_count[0] += len(new_papers)

    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(run_scholar, "lookup", query): "scholar-lookup",
            executor.submit(search_bib, query): "bib",
        }
        if args.scholar_search:
            futures[executor.submit(run_scholar, "search", query, 2.0)] = "scholar-search"

        # Consensus runs in its own thread with streaming callback
        consensus_future = executor.submit(
            run_consensus, query, args.n, args.min_citations,
            consensus_poll_cb if streaming else None
        )
        futures[consensus_future] = "consensus"

        for future in as_completed(futures):
            source = futures[future]
            results = future.result()
            if source == "consensus":
                # Already extended via callback (streaming) or returned as list (batch)
                if not streaming:
                    emit_source(source, results)
                else:
                    print(f"[research] consensus: {len(results)} results", file=sys.stderr)
            else:
                emit_source(source, results)

    # Step 2: Deduplicate
    papers = deduplicate(all_papers)
    print(f"[research] After dedup: {len(papers)} unique papers", file=sys.stderr)

    # Step 3: Resolve SSRN DOIs in parallel
    papers = resolve_ssrn_dois(papers)
    resolved = sum(1 for p in papers if p.get("journal_resolved"))
    print(f"[research] DOI resolved: {resolved} SSRN labels", file=sys.stderr)

    if not args.no_stream:
        # Final deduped+resolved batch
        print(json.dumps({"event": "final", "papers": papers}, ensure_ascii=False), flush=True)
    else:
        # Output unified JSON
        print(json.dumps(papers, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
