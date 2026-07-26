"""L1.4 — Download SEC Investment Company Series/Class annual masters (2010-2025).

The SEC publishes one file per year with basic identification info for all active
registered investment-company series and classes (CIK, Series ID S000..., Series
Name, Class ID C000..., Class Name, Ticker). This is the `fundname/ticker -> seriesId`
bridge for pre-2023 ISS funds (LINK-02).

URL naming is inconsistent across years (three different folder/file conventions),
so we scrape the live landing page for the CSV hrefs and map each to its year rather
than hard-coding a single pattern. 2016 is absent from the page; we try fallback
patterns and log the outcome.

Output: data/raw/sec_series_class/investment_company_series_class_<YYYY>.csv

Usage:
  python scripts/download_sec_series_class.py
"""

from __future__ import annotations

import re
import time
from pathlib import Path

import requests

PROJ = Path(__file__).parent.parent
OUT = PROJ / "data" / "raw" / "sec_series_class"
LANDING = "https://www.sec.gov/data-research/sec-markets-data/investment-company-series-class-information"
UA = "mirror-voting research eddyhu@gmail.com"
YEARS = list(range(2010, 2026))  # 2010-2025 inclusive
HEADERS = {"User-Agent": UA, "Accept-Encoding": "gzip, deflate"}


def scrape_csv_urls() -> dict[int, str]:
    """Return {year: absolute_url} for the annual series/class CSVs on the SEC page."""
    r = requests.get(LANDING, headers=HEADERS, timeout=60)
    r.raise_for_status()
    hrefs = re.findall(r'href="([^"]+\.csv)"', r.text, flags=re.I)
    by_year: dict[int, str] = {}
    for h in hrefs:
        if "series" not in h.lower() and "class" not in h.lower():
            continue
        m = re.search(r"(20\d{2})", h)
        if not m:
            continue
        yr = int(m.group(1))
        if yr not in YEARS:
            continue
        url = h if h.startswith("http") else f"https://www.sec.gov{h}"
        by_year.setdefault(yr, url)  # first hit wins (page lists CSV before XML)
    return by_year


# Fallback URL patterns for years missing from the landing page (e.g. 2016).
FALLBACK_DIRS = [
    "https://www.sec.gov/files/investment/data/other/investment-company-series-and-class-information",
    "https://www.sec.gov/files/investment/data/other/investment-company-series-class-information",
]
FALLBACK_NAMES = [
    "investment_company_series_class_{y}.csv",
    "investment-company-series-class-{y}.csv",
    "investmentcompanyseriesclass{y}.csv",
]


def fallback_urls(year: int) -> list[str]:
    return [f"{d}/{n.format(y=year)}" for d in FALLBACK_DIRS for n in FALLBACK_NAMES]


def download(url: str, dest: Path) -> tuple[bool, int, str]:
    try:
        r = requests.get(url, headers=HEADERS, timeout=120)
    except Exception as e:  # noqa: BLE001
        return False, 0, f"error {e}"
    if r.status_code != 200 or not r.content:
        return False, r.status_code, f"http {r.status_code}"
    dest.write_bytes(r.content)
    nrows = r.text.count("\n")
    return True, r.status_code, f"{len(r.content):,} bytes, ~{nrows:,} lines"


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    urls = scrape_csv_urls()
    print(f"Scraped {len(urls)} year-tagged CSV URLs from SEC landing page.")

    ok, missing = [], []
    for year in YEARS:
        dest = OUT / f"investment_company_series_class_{year}.csv"
        candidates = [urls[year]] if year in urls else []
        candidates += fallback_urls(year)
        succeeded = False
        for url in candidates:
            good, code, msg = download(url, dest)
            if good:
                print(f"  {year}: OK  {msg}\n        <- {url}")
                ok.append(year)
                succeeded = True
                break
            time.sleep(0.3)  # be polite to SEC
        if not succeeded:
            print(f"  {year}: MISSING (all {len(candidates)} candidates 404/err)")
            missing.append(year)
        time.sleep(0.3)

    print(f"\nDownloaded {len(ok)}/{len(YEARS)} years: {ok}")
    if missing:
        print(f"Missing years (logged, continuing): {missing}")


if __name__ == "__main__":
    main()
