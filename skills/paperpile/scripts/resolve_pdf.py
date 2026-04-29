#!/usr/bin/env -S uv run --quiet --script
# /// script
# requires-python = ">=3.11"
# dependencies = ["websockets>=12"]
# ///
"""
resolve_pdf.py — bib citation key → local PDF via institutional access.

Usage:
    resolve_pdf.py <BIBKEY> [--bib PATH] [--doi DOI] [--out DIR] [--via-dia] [--try-libkey]
    resolve_pdf.py --doi <DOI> [--out DIR] [--via-dia]

Resolver chain (each step tried in order, first valid PDF wins):
    1. (opt-in) LibKey openurl    — only if --try-libkey is passed
    2. UVA EZproxy → publisher    — needs NetBadge cookie (or --via-dia)
    3. OpenAthens / publisher SSO — direct doi.org → publisher (--via-dia only)
    4. NYU EZproxy → publisher    — needs NetID  cookie (or --via-dia)
    5. SSRN direct                — if entry has SSRN id (auto-derived from
                                    10.2139/ssrn.<id> DOIs)
    6. Virgo article search       — last-ditch fallback when no DOI is known
                                    (e.g. older law reviews; --via-dia only)

`--via-dia` drives Dia (Chrome-based) over CDP at port 9222 for the
institutional steps, automatically handling JS challenges and SSO redirects
that block headless HTTP clients. After a successful Dia fetch the script
snapshots the relevant cookies into ~/.claude-work/skills/paperpile/cookies/
so subsequent runs in the session can re-use them without re-driving the
browser.

If a bib entry lacks a DOI, the script does a CrossRef title lookup and
*writes the resolved DOI back into the bib file* so subsequent runs skip
the lookup hop.

Exit codes:
    0  — PDF written, absolute path printed on stdout (single line)
    1  — usage / config error
    2  — bib lookup failed (no DOI, no SSRN, no resolvable identifier)
    3  — all resolvers exhausted without a valid PDF
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import time
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

# ---------------------------------------------------------------------------
# Paths & config
# ---------------------------------------------------------------------------

SKILL_DIR = Path(__file__).resolve().parent.parent
PROXY_REF = SKILL_DIR / "references" / "proxy_urls.md"
DEFAULT_BIB = (
    Path.home()
    / "Library/CloudStorage/GoogleDrive-eddyhu@gmail.com/My Drive/resources/My Library.bib"
)
PAPERPILE_DIR = (
    Path.home()
    / "Library/CloudStorage/GoogleDrive-eddyhu@gmail.com/My Drive/resources/Paperpile/All Papers"
)
COOKIE_DIR = (
    Path(os.environ.get("CLAUDE_CONFIG_DIR", str(Path.home() / ".claude-work")))
    / "skills" / "paperpile" / "cookies"
)


def load_config() -> dict[str, str]:
    if not PROXY_REF.exists():
        die(f"missing reference file: {PROXY_REF}", code=1)
    text = PROXY_REF.read_text()
    m = re.search(r"```config\n(.*?)\n```", text, re.DOTALL)
    if not m:
        die(f"no ```config``` block in {PROXY_REF}", code=1)
    cfg: dict[str, str] = {}
    for line in m.group(1).splitlines():
        line = line.split("#", 1)[0].strip()
        if not line or "=" not in line:
            continue
        k, v = line.split("=", 1)
        cfg[k.strip()] = v.strip()
    return cfg


# ---------------------------------------------------------------------------
# Bib parsing + back-write
# ---------------------------------------------------------------------------

@dataclass
class BibEntry:
    key: str
    doi: str | None
    title: str
    authors: list[str]
    journal: str
    year: str | None
    ssrn_id: str | None
    url: str | None


def parse_bib_for_key(bib_path: Path, bibkey: str) -> BibEntry | None:
    if not bib_path.exists():
        die(f"bib file not found: {bib_path}", code=1)
    text = bib_path.read_text(encoding="utf-8", errors="replace")
    pat = re.compile(r"@\w+\{" + re.escape(bibkey) + r",(.*?)\n\}", re.DOTALL)
    m = pat.search(text)
    if not m:
        return None
    body = m.group(1)

    def field(name: str) -> str:
        fm = re.search(
            rf"^\s*{name}\s*=\s*\{{(.*?)\}}\s*,?\s*$",
            body, re.MULTILINE | re.DOTALL | re.IGNORECASE,
        )
        if not fm:
            return ""
        v = fm.group(1).strip()
        v = re.sub(r"[{}]", "", v)
        v = re.sub(r"\s+", " ", v)
        return v

    doi = field("doi") or None
    if doi and not doi.startswith("10."):
        doi = None

    author_raw = field("author")
    authors = [a.strip() for a in re.split(r"\s+and\s+", author_raw)] if author_raw else []

    url = field("url") or None
    ssrn_id = None
    if url:
        sm = re.search(r"abstract(?:_id)?=(\d+)", url)
        if sm:
            ssrn_id = sm.group(1)
    if not ssrn_id:
        f = field("ssrn") or field("ssrn_id")
        if f and f.isdigit():
            ssrn_id = f

    return BibEntry(
        key=bibkey, doi=doi,
        title=field("title"),
        authors=authors,
        journal=field("journaltitle") or field("journal"),
        year=(field("date") or field("year"))[:4] or None,
        ssrn_id=ssrn_id,
        url=url,
    )


def writeback_doi(bib_path: Path, bibkey: str, doi: str) -> bool:
    """Insert `doi = {DOI}` into the entry block. Idempotent."""
    text = bib_path.read_text(encoding="utf-8", errors="replace")
    pat = re.compile(r"(@\w+\{" + re.escape(bibkey) + r",)(.*?)(\n\})", re.DOTALL)
    m = pat.search(text)
    if not m:
        return False
    head, body, tail = m.group(1), m.group(2), m.group(3)
    if re.search(r"^\s*doi\s*=", body, re.MULTILINE | re.IGNORECASE):
        return False
    new_body = body.rstrip().rstrip(",") + f",\n  doi = {{{doi}}}"
    bib_path.write_text(text[:m.start()] + head + new_body + tail + text[m.end():])
    return True


def crossref_lookup_doi(title: str, year: str | None) -> str | None:
    if not title:
        return None
    q = urllib.parse.urlencode({"query.title": title, "rows": 5})
    url = f"https://api.crossref.org/works?{q}"
    try:
        r = subprocess.run(
            ["curl", "-sL", "-H",
             "User-Agent: paperpile-resolve/0.2 (mailto:ehu@law.virginia.edu)", url],
            capture_output=True, text=True, timeout=20,
        )
        data = json.loads(r.stdout)
    except Exception as e:
        log(f"[crossref] error: {e}")
        return None
    for it in data.get("message", {}).get("items", []):
        it_year = None
        for k in ("published-print", "published-online", "issued"):
            dp = it.get(k, {}).get("date-parts")
            if dp and dp[0]:
                it_year = str(dp[0][0])
                break
        if year and it_year and abs(int(it_year) - int(year)) > 1:
            continue
        doi = it.get("DOI")
        if doi:
            return doi.lower()
    return None


# ---------------------------------------------------------------------------
# Paperpile API (tier 0): library + attachments index, cached to disk
# ---------------------------------------------------------------------------

PAPERPILE_CACHE = (
    Path(os.environ.get("CLAUDE_CONFIG_DIR", str(Path.home() / ".claude-work")))
    / "skills" / "paperpile" / "cache" / "paperpile-index.json"
)
PAPERPILE_CACHE_TTL = 3600  # 1 hour


def _paperpile_cookie_header() -> str | None:
    """Read plack_session and other paperpile cookies from snapshotted cache."""
    cookie_files = [
        COOKIE_DIR / "api.paperpile.com.json",
        COOKIE_DIR / "paperpile.com.json",
        COOKIE_DIR / "library.paperpile.com.json",
    ]
    cookies: dict[str, str] = {}
    for cf in cookie_files:
        if not cf.exists():
            continue
        try:
            for c in json.loads(cf.read_text()):
                name = c.get("name", "")
                # Keep the most recently set value
                cookies[name] = c.get("value", "")
        except Exception:
            pass
    if not cookies:
        return None
    return "; ".join(f"{k}={v}" for k, v in cookies.items())


def paperpile_api_index(force: bool = False) -> dict | None:
    """Return {library: [...], attachments: [...]}; cached for 1h.

    Returns None if Paperpile is unreachable / not authenticated.
    """
    if not force and PAPERPILE_CACHE.exists():
        age = time.time() - PAPERPILE_CACHE.stat().st_mtime
        if age < PAPERPILE_CACHE_TTL:
            try:
                return json.loads(PAPERPILE_CACHE.read_text())
            except Exception:
                pass

    cookie = _paperpile_cookie_header()
    if not cookie:
        log("[paperpile-api] no plack_session cookie — visit app.paperpile.com in Dia first")
        return None

    headers = [
        "-H", f"Cookie: {cookie}",
        "-H", "User-Agent: paperpile-resolve/0.3 (mailto:ehu@law.virginia.edu)",
        "-H", "Accept: application/json",
    ]

    # Fetch library (single call)
    try:
        r = subprocess.run(
            ["curl", "-sLf", "--connect-timeout", "10", "--max-time", "30",
             *headers, "https://api.paperpile.com/api/library"],
            capture_output=True, text=True, timeout=40,
        )
        if r.returncode != 0:
            log(f"[paperpile-api] library fetch failed: {r.stderr[:200]}")
            return None
        library = json.loads(r.stdout)
    except Exception as e:
        log(f"[paperpile-api] library error: {e}")
        return None

    # Paginate attachments
    attachments: list[dict] = []
    for skip in range(0, 5000, 50):
        try:
            r = subprocess.run(
                ["curl", "-sLf", "--connect-timeout", "10", "--max-time", "30",
                 *headers, f"https://api.paperpile.com/api/attachments?skip={skip}"],
                capture_output=True, text=True, timeout=40,
            )
            if r.returncode != 0:
                break
            batch = json.loads(r.stdout)
        except Exception:
            break
        if not isinstance(batch, list) or not batch:
            break
        attachments.extend(batch)
        if len(batch) < 50:
            break

    PAPERPILE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    index = {"library": library, "attachments": attachments, "fetched_at": time.time()}
    PAPERPILE_CACHE.write_text(json.dumps(index))
    log(f"[paperpile-api] indexed {len(library)} items, {len(attachments)} attachments → {PAPERPILE_CACHE}")
    return index


# ---------------------------------------------------------------------------
# Headless download primitive (Bun-based via `scholar download`)
# ---------------------------------------------------------------------------

def has_scholar() -> bool:
    return shutil.which("scholar") is not None


def is_real_pdf(path: Path) -> bool:
    if not path.exists() or path.stat().st_size < 1024:
        return False
    with path.open("rb") as f:
        return f.read(5) == b"%PDF-"


def resolve_paperpile(entry: "BibEntry | None", out: Path) -> tuple[bool, str]:
    """Look up the PDF in the user's local Paperpile-synced library.

    Match strategy:
    1. Pick first author's family name from `entry.authors`. Paperpile organizes
       by first letter of first author's family name into `A/`, `B/`, etc.
    2. Glob `<Letter>/<FirstAuthor>*<year>*.pdf`.
    3. Among matches, prefer ones whose filename contains a normalized token from
       the title (any 6+ char word from the title, lowercase, alnum-only).
    4. If multiple still match, prefer the largest (PII-named ScienceDirect
       downloads tend to be the canonical-from-publisher; titled ones are also
       valid — both work).
    """
    if entry is None or not PAPERPILE_DIR.exists():
        return False, "no entry or Paperpile dir missing"

    if not entry.title:
        return False, "no title to match"

    if not entry.authors:
        return False, "no authors in bib entry"

    # First author's family name — biblatex format is "First Last" or "Last, First"
    raw = entry.authors[0]
    if "," in raw:
        family = raw.split(",")[0].strip()
    else:
        # "First Middle Last" — last token
        family = raw.strip().split()[-1]
    family = re.sub(r"[^A-Za-z]", "", family)
    if not family:
        return False, "could not parse first author's family name"

    letter_dir = PAPERPILE_DIR / family[0].upper()
    if not letter_dir.exists():
        return False, f"no Paperpile letter dir for '{family[0]}'"

    year = entry.year or ""
    # Glob: family is the prefix; year may appear anywhere
    candidates = list(letter_dir.glob(f"{family}*{year}*.pdf"))
    if not candidates:
        return False, f"no Paperpile match for {family}/{year}"

    # Score by title-token overlap
    title_tokens = {
        re.sub(r"[^a-z0-9]", "", w.lower())
        for w in re.split(r"\W+", entry.title)
        if len(w) >= 6
    }
    title_tokens.discard("")

    def score(p: Path) -> tuple[int, int]:
        name_low = p.stem.lower()
        hits = sum(1 for t in title_tokens if t in re.sub(r"[^a-z0-9]", "", name_low))
        return (hits, p.stat().st_size)

    candidates.sort(key=score, reverse=True)
    chosen = candidates[0]
    if not is_real_pdf(chosen):
        return False, f"matched file not a valid PDF: {chosen.name}"

    shutil.copy(chosen, out)
    return True, f"ok {out} (paperpile: {chosen.name})"


def resolve_paperpile_api(entry: "BibEntry | None", out: Path, via_dia: bool) -> tuple[bool, str]:
    """Match bib entry → Paperpile library → gdrive_id → Drive download via Dia."""
    if entry is None or not entry.title:
        return False, "no entry/title"
    if not via_dia:
        return False, "paperpile-api requires --via-dia for Drive download"

    index = paperpile_api_index()
    if index is None:
        return False, "no Paperpile index (auth or network)"

    if not entry.authors:
        return False, "no authors in bib entry"

    # First author family name
    raw = entry.authors[0]
    if "," in raw:
        family = raw.split(",")[0].strip()
    else:
        family = raw.strip().split()[-1]
    family = re.sub(r"[^A-Za-z]", "", family).lower()
    if not family:
        return False, "could not parse first author family name"

    year = entry.year or ""
    title_tokens = {
        re.sub(r"[^a-z0-9]", "", w.lower())
        for w in re.split(r"\W+", entry.title)
        if len(w) >= 5
    }
    title_tokens.discard("")

    # Score each library item: family match + year match + title-token overlap
    candidates = []
    for item in index["library"]:
        authors = item.get("author") or []
        if not authors:
            continue
        first = (authors[0].get("last") or "").lower()
        if family not in first and first not in family:
            continue
        item_year = (item.get("published") or {}).get("year") or ""
        year_score = 0
        if year and item_year:
            try:
                year_score = -abs(int(item_year) - int(year))
            except Exception:
                pass
        item_title = (item.get("title") or "").lower()
        item_title_norm = re.sub(r"[^a-z0-9]", "", item_title)
        title_score = sum(1 for t in title_tokens if t in item_title_norm)
        # DOI exact match is the strongest signal
        doi_match = entry.doi and item.get("doi") and entry.doi.lower() == item["doi"].lower()
        score = (10 if doi_match else 0) + title_score + year_score
        candidates.append((score, item))

    if not candidates:
        return False, f"no library item matches first-author '{family}'"
    candidates.sort(key=lambda x: x[0], reverse=True)
    score, best = candidates[0]
    if score < 1 and not (entry.doi and best.get("doi") == entry.doi):
        return False, f"best match score {score} too low for '{best.get('title','')[:60]}'"

    # Find PDF attachment for this item
    item_id = best["_id"]
    atts = [
        a for a in index["attachments"]
        if a.get("pub_id") == item_id
        and a.get("mimeType") == "application/pdf"
        and a.get("article_pdf") == 1
        and a.get("gdrive_id")
    ]
    if not atts:
        return False, f"matched item '{best.get('title','')[:60]}' has no PDF attachment in Paperpile"

    gdrive_id = atts[0]["gdrive_id"]
    drive_url = f"https://drive.google.com/uc?export=download&id={gdrive_id}"

    # Drive a navigation to the URL; the browser will save to ~/Downloads/
    # Use a similar pattern to manual_hop — navigate then poll ~/Downloads.
    if not cdp_alive():
        return False, "Dia CDP not on :9222"

    # Open + navigate
    new_tab = subprocess.run(
        ["curl", "-sf", "-X", "PUT", f"{CDP_URL}/json/new"],
        capture_output=True, text=True, timeout=8,
    )
    if new_tab.returncode != 0:
        return False, "could not open Dia tab"
    tab = json.loads(new_tab.stdout)

    async def go():
        import websockets
        async with websockets.connect(tab["webSocketDebuggerUrl"]) as ws:
            await ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": drive_url}}))
            try:
                await asyncio.wait_for(ws.recv(), timeout=8)
            except Exception:
                pass

    try:
        asyncio.run(go())
    except Exception:
        pass  # Drive download navigation 'aborts' navigation, so error is fine

    # Poll ~/Downloads for a recent PDF
    downloads = Path.home() / "Downloads"
    deadline = time.time() + 30
    expected_filename_hint = atts[0].get("filename", "")
    last_seen: Path | None = None
    while time.time() < deadline:
        if downloads.exists():
            recent = sorted(
                (p for p in downloads.glob("*.pdf") if time.time() - p.stat().st_mtime < 30),
                key=lambda p: p.stat().st_mtime, reverse=True,
            )
            if recent:
                src = recent[0]
                # Wait for the file to stop growing (avoid copying mid-download)
                if src != last_seen:
                    last_seen = src
                else:
                    if is_real_pdf(src):
                        shutil.copy(src, out)
                        return True, f"ok {out} (paperpile-api: {src.name})"
        time.sleep(1)

    # Final attempt to copy whatever we found
    if last_seen and is_real_pdf(last_seen):
        shutil.copy(last_seen, out)
        return True, f"ok {out} (paperpile-api: {last_seen.name}, final)"
    return False, f"no PDF appeared in ~/Downloads/ within 30s (expected: {expected_filename_hint[:60]})"


def scholar_download(url: str, out: Path) -> tuple[bool, str]:
    if not has_scholar():
        return False, "scholar CLI not on PATH"
    try:
        r = subprocess.run(
            ["scholar", "download", url, "--output", str(out)],
            capture_output=True, text=True, timeout=90,
        )
    except subprocess.TimeoutExpired:
        return False, "timeout (90s)"
    if r.returncode != 0:
        diag = (r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "non-zero exit")
        return False, diag
    if not is_real_pdf(out):
        if out.exists():
            out.unlink()
        return False, "downloaded file is not a PDF (likely paywall HTML)"
    return True, f"ok {out}"


# ---------------------------------------------------------------------------
# CDP / Dia driving (--via-dia)
# ---------------------------------------------------------------------------

CDP_URL = "http://localhost:9222"


def cdp_alive() -> bool:
    try:
        r = subprocess.run(
            ["curl", "-sf", "--connect-timeout", "2", f"{CDP_URL}/json/version"],
            capture_output=True, text=True, timeout=4,
        )
        return r.returncode == 0
    except Exception:
        return False


async def _extract_publisher_pdf_url(call) -> str | None:
    """Inspect the current page DOM for a direct-PDF link from a known publisher.

    Returns the absolute URL of a PDF if found, else None.
    """
    js = r"""
    (() => {
      const here = location.href;
      const sel = (s) => document.querySelector(s);
      const all = (s) => [...document.querySelectorAll(s)];
      // Elsevier ScienceDirect: "Download PDF" button has a pdfft link
      const sd = all('a').find(a => /\/pdfft\?/.test(a.href));
      if (sd) return sd.href;
      // Elsevier alt: meta citation_pdf_url is universal across many publishers
      const meta = sel('meta[name="citation_pdf_url"]');
      if (meta && meta.content) return new URL(meta.content, here).toString();
      // Wiley: epdf or pdfdirect path
      const wiley = all('a').find(a => /\/(epdf|pdfdirect)\//.test(a.href));
      if (wiley) return wiley.href.replace('/epdf/', '/pdfdirect/');
      // Oxford OUP: PDF link with article-pdf path
      const oup = all('a').find(a => /article-pdf\//.test(a.href));
      if (oup) return oup.href;
      // SSRN: Download button on the abstract page links to Delivery.cfm
      const ssrn = all('a').find(a => /Delivery\.cfm/.test(a.href));
      if (ssrn) return ssrn.href;
      // SSRN fallback: synthesize from abstract_id in URL
      const ssrnMatch = location.href.match(/abstract_id=(\d+)/);
      if (ssrnMatch) {
        return `https://papers.ssrn.com/sol3/Delivery.cfm/${ssrnMatch[1]}.pdf?abstractid=${ssrnMatch[1]}&mirid=1`;
      }
      // Cambridge Core: pdf path
      const cup = all('a').find(a => /\/core\/.+\.pdf/.test(a.href));
      if (cup) return cup.href;
      // SpringerLink: content/pdf path
      const springer = all('a').find(a => /\/content\/pdf\//.test(a.href));
      if (springer) return springer.href;
      // JSTOR: stable/pdf/<id>.pdf path
      const jstor = all('a').find(a => /jstor\.org\/stable\/pdf\//.test(a.href));
      if (jstor) return jstor.href;
      // JSTOR fallback: synthesize PDF URL from /stable/<id>
      const jstorStable = location.href.match(/jstor\.org\/stable\/(\d+)/);
      if (jstorStable) return `https://www.jstor.org/stable/pdf/${jstorStable[1]}.pdf`;
      // UVA Virgo article-record page: look for "View Full Text" / "Online Access" link
      // Pattern: link out to publisher (jstor, sciencedirect, oup, heinonline, etc.)
      if (/\/sources\/articles\/items\//.test(location.href)) {
        const recordLinks = all('a').filter(a =>
          /jstor\.org|sciencedirect|academic\.oup|heinonline|wiley|tandfonline|cambridge|springer/i.test(a.href)
        );
        if (recordLinks.length) return recordLinks[0].href;
      }
      // UVA Virgo article result: first result has a "View Article" or PDF link
      const virgo = all('a').find(a =>
        /search\.lib\.virginia\.edu/.test(location.href) &&
        (/articles\/.+/.test(a.href) || /pdf/i.test(a.textContent))
      );
      if (virgo) return virgo.href;
      return null;
    })()
    """
    try:
        resp = await call("Runtime.evaluate", {"expression": js, "returnByValue": True}, timeout=8)
        return resp.get("result", {}).get("result", {}).get("value")
    except Exception:
        return None


async def _dia_fetch_pdf(url: str, out: Path, timeout_s: int = 60) -> tuple[bool, str]:
    """Open `url` in a fresh Dia tab; capture the PDF response body.

    Strategy: enable Network domain, navigate, watch for any response with
    mimeType `application/pdf` (or url ending `.pdf`), then call
    `Network.getResponseBody`.

    Falls back to `Page.printToPDF` if no PDF response was seen but the
    tab DID render a PDF (e.g. Chrome PDF viewer).
    """
    import websockets

    # Open a fresh tab (about:blank); we'll Page.navigate explicitly.
    new_tab = subprocess.run(
        ["curl", "-sf", "-X", "PUT", f"{CDP_URL}/json/new"],
        capture_output=True, text=True, timeout=8,
    )
    if new_tab.returncode != 0:
        return False, f"could not open new Dia tab via CDP ({new_tab.stderr.strip()})"
    target = json.loads(new_tab.stdout)
    ws_url = target["webSocketDebuggerUrl"]
    target_id = target["id"]

    msg_id = 0
    pdf_request_id: str | None = None
    pdf_url: str | None = None
    final_doc_loaded = False
    diag_log: list[str] = []
    start_time = asyncio.get_event_loop().time()
    last_probe_attempt: float = 0
    tried_navigations: set[str] = set()
    html_interstitial_count = 0

    def next_id() -> int:
        nonlocal msg_id
        msg_id += 1
        return msg_id

    try:
        async with websockets.connect(ws_url, max_size=64 * 1024 * 1024) as ws:
            async def send(method: str, params: dict | None = None) -> int:
                mid = next_id()
                await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
                return mid

            pending_responses: dict[int, asyncio.Future] = {}

            async def call(method: str, params: dict | None = None, timeout: float = 15.0) -> dict:
                mid = next_id()
                fut: asyncio.Future = asyncio.get_event_loop().create_future()
                pending_responses[mid] = fut
                await ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
                # Pump messages until our response arrives
                while not fut.done():
                    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
                    msg = json.loads(raw)
                    if "id" in msg and msg["id"] in pending_responses:
                        f = pending_responses.pop(msg["id"])
                        if not f.done():
                            f.set_result(msg)
                    # else: drop event during call (we only use call() for setup)
                return fut.result()

            await call("Network.enable")
            await call("Page.enable")
            # Allow downloads to be captured rather than triggering OS save dialog
            try:
                await call("Browser.setDownloadBehavior",
                           {"behavior": "allow", "downloadPath": str(out.parent)},
                           timeout=5)
            except Exception:
                pass
            await call("Page.navigate", {"url": url}, timeout=10)

            deadline = asyncio.get_event_loop().time() + timeout_s

            while asyncio.get_event_loop().time() < deadline:
                remaining = max(0.5, deadline - asyncio.get_event_loop().time())

                # Periodic re-probe of the DOM once the page has loaded.
                # SPAs (Virgo) and JS redirect chains (Elsevier linkinghub)
                # often hydrate well after Page.loadEventFired, so a single
                # probe at load-time misses them.
                now = asyncio.get_event_loop().time()
                if final_doc_loaded and not pdf_request_id and (now - last_probe_attempt) >= 2.5:
                    last_probe_attempt = now
                    publisher_pdf_url = await _extract_publisher_pdf_url(call)
                    if publisher_pdf_url:
                        diag_log.append(f"+{now - start_time:.1f}s probe: {publisher_pdf_url[:100]}")
                        # Avoid re-navigating to a URL we already tried
                        if publisher_pdf_url not in tried_navigations:
                            tried_navigations.add(publisher_pdf_url)
                            await call("Page.navigate", {"url": publisher_pdf_url}, timeout=10)
                            final_doc_loaded = False  # reset for the new page

                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=min(remaining, 1.5))
                except asyncio.TimeoutError:
                    # Don't break out — let the probe loop run again until
                    # the outer deadline expires.
                    continue
                msg = json.loads(raw)

                # response to a call
                if "id" in msg and msg["id"] in pending_responses:
                    fut = pending_responses.pop(msg["id"])
                    if not fut.done():
                        fut.set_result(msg)
                    continue

                method = msg.get("method")
                params = msg.get("params", {})

                if method == "Network.responseReceived":
                    resp = params.get("response", {})
                    mime = (resp.get("mimeType") or "").lower()
                    rurl = resp.get("url", "")
                    status = resp.get("status", 0)
                    if mime == "application/pdf" or rurl.lower().endswith(".pdf"):
                        if status >= 200 and status < 400:
                            pdf_request_id = params.get("requestId")
                            pdf_url = rurl
                            diag_log.append(f"PDF response: {status} {rurl[:80]}")

                elif method == "Network.loadingFinished":
                    if pdf_request_id and params.get("requestId") == pdf_request_id:
                        # We have the PDF — fetch it
                        try:
                            body = await call(
                                "Network.getResponseBody",
                                {"requestId": pdf_request_id},
                                timeout=15,
                            )
                            result = body.get("result", {})
                            data = result.get("body", "")
                            if result.get("base64Encoded"):
                                pdf_bytes = base64.b64decode(data)
                            else:
                                pdf_bytes = data.encode("latin-1")
                            if pdf_bytes[:5] == b"%PDF-":
                                out.write_bytes(pdf_bytes)
                                return True, f"ok {out} (via dia, {len(pdf_bytes)} bytes)"
                            diag_log.append(f"PDF body was HTML interstitial ({pdf_bytes[:15]!r}) — listening for next pdf response")
                            pdf_request_id = None  # allow next pdf response to capture
                            html_interstitial_count += 1
                            if html_interstitial_count >= 5:
                                return False, "5 PDF responses in a row had HTML body (likely paywall)"
                        except Exception as e:
                            diag_log.append(f"getResponseBody error: {e}")

                elif method == "Page.loadEventFired":
                    final_doc_loaded = True
                    # The periodic re-probe block at the top of the loop
                    # handles DOM scraping; SPAs/redirect chains often need
                    # multiple probes after load fires.

                elif method == "Page.frameNavigated":
                    nav_url = params.get("frame", {}).get("url", "")
                    if nav_url:
                        elapsed = asyncio.get_event_loop().time() - start_time
                        diag_log.append(f"+{elapsed:.1f}s nav:{nav_url[:100]}")
                        # Detect SSO/login redirects so we fail fast instead
                        # of waiting the full timeout.
                        login_markers = (
                            "netbadge.virginia.edu",
                            "shibboleth.virginia.edu",
                            "shibidp.its.virginia.edu",
                            "login.its.virginia.edu",
                            "shibboleth.nyu.edu",
                            "shibidp.nyu.edu",
                            "login.nyu.edu",
                        )
                        if any(m in nav_url for m in login_markers):
                            return False, f"redirected to SSO login: {nav_url[:80]} (need to log in via Dia)"
                        # EZproxy "Not Authorized" landing page — the proxy
                        # doesn't whitelist this destination (e.g. Elsevier,
                        # SSRN). Fail fast so the chain falls through to
                        # OpenAthens/Virgo instead of waiting the full timeout.
                        if "proxy1.library.virginia.edu/menu" in nav_url or "Not Authorized" in nav_url:
                            return False, f"EZproxy not authorized for destination: {nav_url[:80]}"

            tail = " | ".join(diag_log[-8:]) if diag_log else "no PDF response observed"
            return False, f"timeout ({len(diag_log)} events): {tail}"
    finally:
        # Close the tab we opened
        try:
            subprocess.run(
                ["curl", "-sf", f"{CDP_URL}/json/close/{target_id}"],
                capture_output=True, timeout=4,
            )
        except Exception:
            pass


def dia_fetch_pdf(url: str, out: Path) -> tuple[bool, str]:
    if not cdp_alive():
        return False, "Dia CDP not reachable on :9222 — open Dia with --remote-debugging-port=9222"
    try:
        return asyncio.run(_dia_fetch_pdf(url, out))
    except Exception as e:
        return False, f"dia driver error: {e}"


def manual_hop(url: str, out: Path, timeout_s: int = 120) -> tuple[bool, str]:
    """Open URL in Dia, wait for user to drop the PDF at `out`."""
    if not cdp_alive():
        return False, "Dia CDP not on :9222"
    # Open the URL in a fresh tab
    r = subprocess.run(
        ["curl", "-sf", "-X", "PUT", f"{CDP_URL}/json/new"],
        capture_output=True, text=True, timeout=8,
    )
    if r.returncode != 0:
        return False, f"could not open Dia tab"
    tab = json.loads(r.stdout)
    async def go():
        import websockets
        async with websockets.connect(tab["webSocketDebuggerUrl"]) as ws:
            await ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": url}}))
            await asyncio.wait_for(ws.recv(), timeout=8)
            await ws.send(json.dumps({"id": 2, "method": "Page.bringToFront"}))
            await asyncio.wait_for(ws.recv(), timeout=4)
    try:
        asyncio.run(go())
    except Exception as e:
        return False, f"navigate error: {e}"
    log(f"[manual] Dia opened to {url}")
    log(f"[manual] Click \"Download PDF\" — file expected at {out}. Watching {timeout_s}s...")
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        if is_real_pdf(out):
            return True, f"ok {out} (manual)"
        # Also check ~/Downloads/ for any PDF appearing in the last 30s
        downloads = Path.home() / "Downloads"
        if downloads.exists():
            recent = sorted(
                (p for p in downloads.glob("*.pdf") if time.time() - p.stat().st_mtime < 30),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            if recent:
                src = recent[0]
                shutil.copy(src, out)
                log(f"[manual] auto-copied recent download {src.name} → {out}")
                return True, f"ok {out} (manual via ~/Downloads)"
        time.sleep(1)
    return False, f"timeout — no PDF at {out}"


# ---------------------------------------------------------------------------
# Cookie persistence (CDP snapshot)
# ---------------------------------------------------------------------------

DOMAINS_OF_INTEREST = (
    "proxy1.library.virginia.edu",
    "proxy.library.virginia.edu",
    "proxy.library.nyu.edu",
    "libkey.io",
    "thirdiron.com",
    "shibboleth.virginia.edu",
    "shibidp.its.virginia.edu",
    "netbadge.virginia.edu",
    "shibboleth.nyu.edu",
    "papers.ssrn.com",
    "ssrn.com",
    "api.paperpile.com",
    "library.paperpile.com",
    "paperpile.com",
    "drive.google.com",
    "drive.usercontent.google.com",
    "google.com",
    "accounts.google.com",
)


async def _snapshot_cookies() -> int:
    import websockets
    targets = subprocess.run(
        ["curl", "-sf", f"{CDP_URL}/json"],
        capture_output=True, text=True, timeout=4,
    )
    if targets.returncode != 0:
        return 0
    tlist = json.loads(targets.stdout)
    page = next((t for t in tlist if t.get("type") == "page"), None)
    if not page:
        return 0
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Network.getAllCookies"}))
        while True:
            msg = json.loads(await asyncio.wait_for(ws.recv(), timeout=8))
            if msg.get("id") == 1:
                break
        cookies = msg.get("result", {}).get("cookies", [])
    saved = 0
    COOKIE_DIR.mkdir(parents=True, exist_ok=True)
    os.chmod(COOKIE_DIR, stat.S_IRWXU)
    by_domain: dict[str, list[dict]] = {}
    for c in cookies:
        d = c.get("domain", "").lstrip(".")
        for interest in DOMAINS_OF_INTEREST:
            if d == interest or d.endswith("." + interest):
                by_domain.setdefault(interest, []).append(c)
                break
    for domain, ckies in by_domain.items():
        path = COOKIE_DIR / f"{domain}.json"
        path.write_text(json.dumps(ckies, indent=2))
        os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)
        saved += len(ckies)
    return saved


def snapshot_cookies() -> int:
    if not cdp_alive():
        return 0
    try:
        return asyncio.run(_snapshot_cookies())
    except Exception as e:
        log(f"[cookies] snapshot error: {e}")
        return 0


async def _hydrate_cookies() -> int:
    if not COOKIE_DIR.exists():
        return 0
    import websockets
    targets = subprocess.run(
        ["curl", "-sf", f"{CDP_URL}/json"],
        capture_output=True, text=True, timeout=4,
    )
    if targets.returncode != 0:
        return 0
    tlist = json.loads(targets.stdout)
    page = next((t for t in tlist if t.get("type") == "page"), None)
    if not page:
        return 0
    all_cookies = []
    for f in COOKIE_DIR.glob("*.json"):
        try:
            for c in json.loads(f.read_text()):
                # Map snapshot format → Network.setCookies params
                cookie = {
                    "name": c.get("name", ""),
                    "value": c.get("value", ""),
                    "domain": c.get("domain", ""),
                    "path": c.get("path", "/"),
                    "secure": c.get("secure", False),
                    "httpOnly": c.get("httpOnly", False),
                    "sameSite": c.get("sameSite") or "Lax",
                }
                if c.get("expires") and c["expires"] > 0:
                    cookie["expires"] = c["expires"]
                all_cookies.append(cookie)
        except Exception:
            pass
    if not all_cookies:
        return 0
    async with websockets.connect(page["webSocketDebuggerUrl"], max_size=16 * 1024 * 1024) as ws:
        await ws.send(json.dumps({"id": 1, "method": "Network.setCookies",
                                   "params": {"cookies": all_cookies}}))
        await asyncio.wait_for(ws.recv(), timeout=8)
    return len(all_cookies)


def hydrate_cookies() -> int:
    if not cdp_alive():
        return 0
    try:
        return asyncio.run(_hydrate_cookies())
    except Exception as e:
        log(f"[cookies] hydrate error: {e}")
        return 0


# ---------------------------------------------------------------------------
# Resolvers
# ---------------------------------------------------------------------------

def resolve_libkey(doi: str, library_id: str, out: Path, via_dia: bool) -> tuple[bool, str]:
    if not library_id or library_id == "TODO" or not library_id.isdigit():
        return False, "uva_libkey_id not configured (see references/proxy_urls.md)"
    url = f"https://libkey.io/libraries/{library_id}/openurl?genre=article&doi={doi}"
    return (dia_fetch_pdf(url, out) if via_dia else scholar_download(url, out))


def resolve_ezproxy(doi: str, host: str, out: Path, via_dia: bool) -> tuple[bool, str]:
    if not host:
        return False, "ezproxy host not configured"
    target = f"https://doi.org/{doi}"
    url = f"https://{host}/login?url={urllib.parse.quote(target, safe=':/')}"
    return (dia_fetch_pdf(url, out) if via_dia else scholar_download(url, out))


def resolve_ssrn(ssrn_id: str, out: Path, via_dia: bool) -> tuple[bool, str]:
    if not ssrn_id:
        return False, "no SSRN id"
    url = (
        f"https://papers.ssrn.com/sol3/Delivery.cfm/{ssrn_id}.pdf"
        f"?abstractid={ssrn_id}&mirid=1"
    )
    fetch = dia_fetch_pdf if via_dia else scholar_download
    ok, diag = fetch(url, out)
    if ok:
        return ok, diag
    return fetch(f"https://ssrn.com/abstract={ssrn_id}", out)


def extract_ssrn_id_from_doi(doi: str) -> str | None:
    """SSRN papers are minted with DOIs of the form 10.2139/ssrn.<id>."""
    m = re.match(r"^10\.2139/ssrn\.(\d+)$", doi or "")
    return m.group(1) if m else None


# Publishers that support OpenAthens / institutional SSO directly on the
# publisher landing page. When EZproxy returns "Not Authorized" for these
# destinations, navigating Dia straight to doi.org lets the publisher's
# own SSO redirect pick up cached UVA cookies.
OPENATHENS_DOI_PREFIXES = (
    "10.1016/",   # Elsevier ScienceDirect
    "10.1002/",   # Wiley
    "10.1007/",   # Springer
    "10.1093/",   # Oxford OUP
    "10.1080/",   # Taylor & Francis
    "10.1017/",   # Cambridge Core
    "10.1111/",   # Wiley (alt prefix)
)


def resolve_openathens(doi: str, out: Path, via_dia: bool) -> tuple[bool, str]:
    """Direct publisher SSO: navigate Dia to doi.org and let the publisher's
    own institutional SSO (OpenAthens) take over using cached UVA cookies.
    No proxy involvement — bypasses EZproxy "Not Authorized" pages.
    """
    if not via_dia:
        return False, "openathens requires --via-dia (publisher SSO needs browser)"
    if not doi:
        return False, "no DOI"
    if not any(doi.startswith(p) for p in OPENATHENS_DOI_PREFIXES):
        return False, f"DOI prefix not in OpenAthens publisher list: {doi[:20]}"
    # Just go to doi.org; the browser will follow redirects to the publisher
    # and any institutional SSO will reuse cached UVA cookies/cert.
    return dia_fetch_pdf(f"https://doi.org/{doi}", out)


def resolve_virgo(title: str, out: Path, via_dia: bool) -> tuple[bool, str]:
    """Last-ditch fallback for no-DOI law reviews: drive Dia to UVA's Virgo
    article-search results and let _extract_publisher_pdf_url discover a
    direct PDF link on the landing page.
    """
    if not via_dia or not title:
        return False, "virgo fallback requires --via-dia and a title"
    q = urllib.parse.quote(title)
    url = f"https://search.lib.virginia.edu/search?mode=advanced&q=keyword:{{{q}}}&pool=articles"
    return dia_fetch_pdf(url, out)


# ---------------------------------------------------------------------------
# Plumbing
# ---------------------------------------------------------------------------

def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def die(msg: str, code: int = 1) -> None:
    log(f"error: {msg}")
    sys.exit(code)


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    ap.add_argument("bibkey", nargs="?")
    ap.add_argument("--bib", type=Path, default=DEFAULT_BIB)
    ap.add_argument("--doi", help="DOI override")
    ap.add_argument("--ssrn-id", help="SSRN id override")
    ap.add_argument("--out", type=Path, help="output dir")
    ap.add_argument("--prefer-ssrn", action="store_true")
    ap.add_argument("--try-libkey", action="store_true",
                    help="include LibKey openurl in chain (default off; UVA isn't a Third Iron customer)")
    ap.add_argument("--via-dia", action="store_true",
                    help="drive Dia via CDP for institutional fetches (handles SSO/JS challenges)")
    ap.add_argument("--no-writeback", action="store_true",
                    help="skip writing resolved DOI back into bib file")
    ap.add_argument("--login-only", action="store_true",
                    help="open NetBadge/NetID warmup pages in Dia and exit (no PDF fetch)")
    ap.add_argument("--manual-hop", action="store_true",
                    help="open the URL in Dia and wait for the user to manually click Download (escape hatch for Cloudflare-walled sources like SSRN)")
    args = ap.parse_args()

    cfg = load_config()

    if args.login_only:
        if not cdp_alive():
            die("Dia CDP not on :9222 — start Dia with --remote-debugging-port=9222", code=1)
        warmup_urls = [
            f"https://{cfg.get('uva_ezproxy_host', '')}/login?url=https://www.virginia.edu/",
            f"https://{cfg.get('nyu_ezproxy_host', '')}/login?url=https://www.nyu.edu/",
        ]
        for u in warmup_urls:
            r = subprocess.run(
                ["curl", "-sf", "-X", "PUT", f"{CDP_URL}/json/new"],
                capture_output=True, text=True, timeout=8,
            )
            tab = json.loads(r.stdout)

            async def go(ws_url=tab["webSocketDebuggerUrl"], url=u):
                import websockets
                async with websockets.connect(ws_url) as ws:
                    await ws.send(json.dumps({"id": 1, "method": "Page.navigate", "params": {"url": url}}))
                    await asyncio.wait_for(ws.recv(), timeout=5)
            try:
                asyncio.run(go())
                log(f"[warmup] opened {u}")
            except Exception as e:
                log(f"[warmup] {u}: {e}")
        log("[warmup] log in via Dia, then re-run without --login-only")
        return 0

    if not args.bibkey and not args.doi:
        die("must provide BIBKEY or --doi", code=1)

    out_dir = args.out or Path(cfg.get("default_output_dir", "/tmp/paperpile-resolve"))
    out_dir.mkdir(parents=True, exist_ok=True)

    entry: BibEntry | None = None
    if args.bibkey:
        entry = parse_bib_for_key(args.bib, args.bibkey)
        if entry is None:
            log(f"[bib] key not found in {args.bib}")
            if not args.doi:
                die(f"bib key {args.bibkey!r} not found and no --doi given", code=2)

    doi = args.doi or (entry.doi if entry else None)
    if not doi and entry and entry.title:
        log(f"[crossref] looking up DOI for: {entry.title!r}")
        doi = crossref_lookup_doi(entry.title, entry.year)
        if doi:
            log(f"[crossref] resolved DOI: {doi}")
            if not args.no_writeback and args.bibkey:
                if writeback_doi(args.bib, args.bibkey, doi):
                    log(f"[bib] wrote DOI back into {args.bib.name}")

    ssrn_id = args.ssrn_id or (entry.ssrn_id if entry else None)
    # SSRN-direct routing: when the DOI is SSRN's own (10.2139/ssrn.<id>),
    # auto-derive the SSRN id so we can skip proxies entirely.
    if not ssrn_id and doi:
        ssrn_id = extract_ssrn_id_from_doi(doi)
    if not doi and not ssrn_id:
        if not (entry and entry.title):
            die("no DOI, no SSRN id, no title — nothing to resolve", code=2)
        log("[chain] no DOI/SSRN — will try Virgo title search only")

    if args.bibkey:
        stem = args.bibkey
    elif doi:
        stem = doi.replace("/", "_")
    else:
        stem = f"ssrn-{ssrn_id}"
    out_path = out_dir / f"{stem}.pdf"

    if args.via_dia and cdp_alive():
        n = hydrate_cookies()
        if n:
            log(f"[cookies] hydrated {n} cookies into Dia from {COOKIE_DIR}")

    if args.manual_hop:
        # Choose target URL
        manual_url = None
        if doi and doi.startswith("10.2139/ssrn."):
            manual_url = f"https://ssrn.com/abstract={ssrn_id or extract_ssrn_id_from_doi(doi)}"
        elif ssrn_id:
            manual_url = f"https://ssrn.com/abstract={ssrn_id}"
        elif doi:
            manual_url = f"https://doi.org/{doi}"
        if not manual_url:
            die("--manual-hop needs DOI or SSRN id", code=1)
        ok, diag = manual_hop(manual_url, out_path)
        log(f"[manual ] {'ok   ' if ok else 'fail '} {diag}")
        if cdp_alive():
            n = snapshot_cookies()
            if n:
                log(f"[cookies] snapshotted {n} cookies → {COOKIE_DIR}")
        if ok:
            print(out_path.resolve())
            return 0
        return 3

    chain: list[tuple[str, Callable[[], tuple[bool, str]]]] = []
    if entry:
        chain.append(("paperpile-api", lambda: resolve_paperpile_api(entry, out_path, args.via_dia)))
        chain.append(("paperpile", lambda: resolve_paperpile(entry, out_path)))
    if args.prefer_ssrn and ssrn_id:
        chain.append(("ssrn", lambda: resolve_ssrn(ssrn_id, out_path, args.via_dia)))
    if doi:
        if args.try_libkey:
            chain.append(("libkey", lambda: resolve_libkey(
                doi, cfg.get("uva_libkey_id", ""), out_path, args.via_dia)))
        chain.append(("uva", lambda: resolve_ezproxy(
            doi, cfg.get("uva_ezproxy_host", ""), out_path, args.via_dia)))
        chain.append(("openathens", lambda: resolve_openathens(
            doi, out_path, args.via_dia)))
        chain.append(("nyu", lambda: resolve_ezproxy(
            doi, cfg.get("nyu_ezproxy_host", ""), out_path, args.via_dia)))
    if ssrn_id and not args.prefer_ssrn:
        chain.append(("ssrn", lambda: resolve_ssrn(ssrn_id, out_path, args.via_dia)))
    # Virgo fallback for no-DOI law reviews (older journals not in CrossRef).
    if not doi and entry and entry.title:
        chain.append(("virgo", lambda: resolve_virgo(
            entry.title, out_path, args.via_dia)))

    success = False
    for name, fn in chain:
        ok, diag = fn()
        log(f"[{name:7s}] {'ok   ' if ok else 'fail '} {diag}")
        if ok:
            success = True
            print(out_path.resolve())
            break

    # Always snapshot cookies if Dia is up — even on failure (a partial SSO
    # may still be useful next call) and on success (refreshes the snapshot).
    if cdp_alive():
        n = snapshot_cookies()
        if n:
            log(f"[cookies] snapshotted {n} cookies → {COOKIE_DIR}")

    return 0 if success else 3


if __name__ == "__main__":
    sys.exit(main())
