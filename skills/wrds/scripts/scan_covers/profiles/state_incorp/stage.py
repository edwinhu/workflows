"""Build the 10-K filing index for the state-of-incorporation parser.

Queries WRDS SEC EDGAR index for 10-K and 10-K/A filings, deduplicates
to one filing per CIK-year, and writes a TSV for the Go parser.

Output: scripts/state_incorp_go/10k_filings.tsv
    cik  accession  fdate  fiscal_year  wrds_path

Usage:
    pixi run python scripts/state_incorp_go/build_index.py
"""
from __future__ import annotations

import csv
import socket
from pathlib import Path

# Force IPv4 (WRDS IPv6 is unreliable from some networks)
_orig_getaddrinfo = socket.getaddrinfo
def _ipv4_only(host, port, family=0, *a, **k):
    return _orig_getaddrinfo(host, port, socket.AF_INET, *a, **k)
socket.getaddrinfo = _ipv4_only

import psycopg2

HERE = Path(__file__).parent
OUT = HERE / "10k_filings.tsv"

# Match our counterfactual sample: 2005-2025.
# Pull 10-Ks from 2004 onward (fiscal year may be prior year).
YEAR_START = 2004
YEAR_END = 2025


def main():
    conn = psycopg2.connect(
        host="wrds-pgdata.wharton.upenn.edu",
        port=9737,
        database="wrds",
        user="eddyhu",
        sslmode="require",
    )
    cur = conn.cursor()

    # wrdssec_all.forms: cik, fdate, form, fname (path on WRDS SEC archive).
    # No accession column — extract from fname (edgar/data/CIK/accession/file).
    print("Querying WRDS for 10-K filings...")
    cur.execute("""
        SELECT cik, fdate, fname, form
        FROM wrdssec_all.forms
        WHERE form IN ('10-K', '10-K/A', '10-KSB', '10-KSB/A')
          AND fdate >= %s
          AND fdate <= %s
        ORDER BY cik, fdate
    """, (f"{YEAR_START}-01-01", f"{YEAR_END}-12-31"))

    rows = cur.fetchall()
    conn.close()
    print(f"  Fetched {len(rows):,} filings")

    # Deduplicate: prefer 10-K over 10-K/A, one per CIK-year.
    # Fiscal year = filing year (10-Ks are filed within 60-90 days of FYE,
    # so filing date year ≈ fiscal year for most firms).
    seen = {}  # (cik, fiscal_year) -> row
    type_priority = {"10-K": 0, "10-KSB": 1, "10-K/A": 2, "10-KSB/A": 3}
    for cik, fdate, fname, form_type in rows:
        fdate_str = str(fdate)
        fiscal_year = fdate_str[:4]
        # Extract accession from fname: edgar/data/CIK/accession-number.txt
        # or edgar/data/CIK/000xxxxx-xx-xxxxxx.txt
        parts = str(fname).split("/")
        accession = parts[3] if len(parts) > 3 else ""
        # Remove .txt extension from accession if present
        if accession.endswith(".txt"):
            accession = accession[:-4]
        key = (str(cik), fiscal_year)
        priority = type_priority.get(form_type, 9)
        if key not in seen or priority < seen[key][4]:
            seen[key] = (str(cik), accession, fdate_str, fiscal_year, priority)

    print(f"  After dedupe: {len(seen):,} CIK-year filings")

    # Build wrds_clean_filings paths: {cik_padded[:6]}/{cik_int}/{accession}.txt
    # The directory structure uses the CIK zero-padded to 10 digits, first 6 chars.
    # e.g., CIK 34088 -> 000034/34088/0001193125-25-073986.txt
    with open(OUT, "w", newline="") as f:
        w = csv.writer(f, delimiter="\t")
        w.writerow(["cik", "accession", "fdate", "fiscal_year", "wrds_path"])
        for key in sorted(seen.keys()):
            cik, accession, fdate, fy, _ = seen[key]
            cik_int = str(int(cik))
            parent = cik_int.zfill(10)[:6]
            clean_path = f"{parent}/{cik_int}/{accession}.txt"
            w.writerow([cik, accession, fdate, fy, clean_path])

    print(f"  Wrote {OUT}")


if __name__ == "__main__":
    main()
