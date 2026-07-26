#!/usr/bin/env python3
"""download_sec_series_class.py — fetch the SEC Investment Company Series/Class masters.

L0 for the SEC leg. Public data, no credentials — this is what makes the
`via_sec_ticker` and SEC-name tiers portable to any project.

    https://www.sec.gov/data-research/sec-markets-data/investment-company-series-class-information

URL naming is inconsistent across vintages — three different folder conventions
(`...-series-class-...` vs `...-series-and-class-...`), two filename conventions
(`investment_company_series_class_YYYY` vs `investment-company-series-class-YYYY`
vs `investmentcompanyseriesclass2010`), and the 2016 file carries NO year at all
(`investment_company_series_class.csv`). So the URLs are SCRAPED from the landing
page rather than constructed, and the year for an unlabelled file is read from
the page text next to its link.

    ./download_sec_series_class.py --out data/raw/sec_series_class
    ./download_sec_series_class.py --out data/raw/sec_series_class --list-only

SEC requires a descriptive User-Agent with contact info. Set SEC_USER_AGENT, or
pass --user-agent; requests without one get blocked.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

LANDING = ("https://www.sec.gov/data-research/sec-markets-data/"
           "investment-company-series-class-information")

CSV_HREF_RE = re.compile(r'href="([^"]*\.csv)"', re.I)
YEAR_RE = re.compile(r"(20\d{2})")
# "…8.18 MB 2016 Updated 09/23/2016" — the year label, not any nearby year.
LABEL_YEAR_RE = re.compile(r"(20\d{2})\s+Updated")
TAG_RE = re.compile(r"<[^>]+>")


def fetch(url: str, ua: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": ua})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def scrape(ua: str) -> dict[int, str]:
    """{year: absolute_url} for every annual CSV on the landing page."""
    html = fetch(LANDING, ua).decode("utf-8", errors="replace")
    out: dict[int, str] = {}
    for m in CSV_HREF_RE.finditer(html):
        href = m.group(1)
        fname = href.rsplit("/", 1)[-1]

        yr_m = YEAR_RE.search(fname)
        if yr_m:
            year = int(yr_m.group(1))
        else:
            # 2016 ships as `investment_company_series_class.csv`. Its year is
            # only in the LINK TEXT, which FOLLOWS the href:
            #     <a href="...series_class.csv" download>2016 Updated 09/23/2016
            # Scan FORWARD, and anchor on "<year> Updated" — the byte size sits
            # before the link, so scanning backwards picks up the neighbouring
            # row's label and silently mis-dates the file (it dated 2016 as
            # 2017, where setdefault then dropped it entirely).
            text = TAG_RE.sub(" ", html[m.end():m.end() + 400])
            labelled = LABEL_YEAR_RE.findall(text)
            if not labelled:
                print(f"  ?? cannot date {fname} — skipped")
                continue
            year = int(labelled[0])
            print(f"  note: {fname} has no year in its name; page labels it {year}")

        url = href if href.startswith("http") else f"https://www.sec.gov{href}"
        out.setdefault(year, url)   # first hit wins (CSV listed before XML)
    return dict(sorted(out.items()))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/raw/sec_series_class")
    ap.add_argument("--user-agent",
                    default=os.environ.get("SEC_USER_AGENT",
                                           "academic-research contact@example.edu"))
    ap.add_argument("--list-only", action="store_true")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--sleep", type=float, default=0.5,
                    help="pause between requests; SEC rate-limits at ~10/s")
    args = ap.parse_args()

    if "example.edu" in args.user_agent:
        print("WARNING: set SEC_USER_AGENT to a real contact address — "
              "SEC blocks generic agents.", file=sys.stderr)

    urls = scrape(args.user_agent)
    print(f"Found {len(urls)} annual CSV(s): {min(urls)}-{max(urls)}")
    if args.list_only:
        for y, u in urls.items():
            print(f"  {y}  {u}")
        return

    dest_dir = Path(args.out)
    dest_dir.mkdir(parents=True, exist_ok=True)
    ok = 0
    for year, url in urls.items():
        # Filename normalised to what build_sec_series_master.py globs for.
        dest = dest_dir / f"investment_company_series_class_{year}.csv"
        if dest.exists() and not args.force:
            print(f"  {year}: cached ({dest.stat().st_size/1e6:.1f} MB)")
            ok += 1
            continue
        try:
            body = fetch(url, args.user_agent)
        except Exception as e:                      # noqa: BLE001
            print(f"  {year}: FAILED {e}\n        <- {url}")
            continue
        # An SEC error page is HTML and would otherwise be parsed as a 0-row CSV.
        if body[:200].lstrip().lower().startswith(b"<!doctype html"):
            print(f"  {year}: FAILED (got an HTML error page)\n        <- {url}")
            continue
        dest.write_bytes(body)
        print(f"  {year}: OK {len(body)/1e6:.1f} MB")
        ok += 1
        time.sleep(args.sleep)

    print(f"\n{ok}/{len(urls)} year(s) available in {dest_dir}")
    print("Next: build_sec_series_master.py")
    if ok == 0:
        sys.exit("no files downloaded")


if __name__ == "__main__":
    main()
