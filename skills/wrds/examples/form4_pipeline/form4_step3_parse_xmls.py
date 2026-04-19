"""Step 3: Parse Form 3/4/5 SGML/XML to extract rptOwnerCik → build bridge.

Each filing at /wrds/sec/archives/.../<accession>.txt is an SGML
envelope containing one or more XML documents. We only need three
fields per filing:
  - issuerCik
  - rptOwnerCik (one per reporting owner; filings can have multiple)
  - rptOwnerName

Strategy: skip full XML parsing. Each field appears verbatim in the
SGML as `<issuerCik>NNNN</issuerCik>` etc. Regex is an order of
magnitude faster than etree for ~5KB files × 540K.

Output:
  data/processed/form4_owner_bridge.parquet with columns:
    accession, issuer_cik, rpt_owner_cik, rpt_owner_name, norm_name
"""
from __future__ import annotations

import concurrent.futures as cf
import os
import re
import sys
import time
from pathlib import Path

import pandas as pd

PROJ = Path(__file__).resolve().parent.parent
FILINGS_DIR = PROJ / "data/raw/form4_xmls/filings"
OUT = PROJ / "data/processed/form4_owner_bridge.parquet"

ISSUER_CIK_RE = re.compile(r"<issuerCik>\s*(\d+)\s*</issuerCik>", re.IGNORECASE)
RPT_OWNER_BLOCK_RE = re.compile(
    r"<reportingOwner>(.*?)</reportingOwner>", re.IGNORECASE | re.DOTALL
)
RPT_OWNER_CIK_RE = re.compile(r"<rptOwnerCik>\s*(\d+)\s*</rptOwnerCik>", re.IGNORECASE)
RPT_OWNER_NAME_RE = re.compile(
    r"<rptOwnerName>\s*(.*?)\s*</rptOwnerName>", re.IGNORECASE | re.DOTALL
)


def normalize_name(s: str) -> str:
    if not isinstance(s, str) or not s.strip():
        return ""
    s = s.upper()
    s = re.sub(r"[.,'\"()/\\]", " ", s)
    s = re.sub(r"\b(JR|SR|II|III|IV|V|MD|PHD|ESQ|CPA|MR|MRS|MS|DR)\b", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def parse_one(path: str) -> list[dict]:
    """Extract (issuer_cik, rpt_owner_cik, rpt_owner_name) per reporting owner.

    Returns a list because a single filing may have multiple owners.
    """
    try:
        with open(path, "r", errors="replace") as f:
            text = f.read()
    except OSError:
        return []

    m_issuer = ISSUER_CIK_RE.search(text)
    if not m_issuer:
        return []
    issuer_cik = int(m_issuer.group(1))

    accession = Path(path).stem

    rows = []
    for m_block in RPT_OWNER_BLOCK_RE.finditer(text):
        block = m_block.group(1)
        m_cik = RPT_OWNER_CIK_RE.search(block)
        m_name = RPT_OWNER_NAME_RE.search(block)
        if not (m_cik and m_name):
            continue
        name = m_name.group(1).strip()
        rows.append(
            {
                "accession": accession,
                "issuer_cik": issuer_cik,
                "rpt_owner_cik": int(m_cik.group(1)),
                "rpt_owner_name": name,
                "norm_name": normalize_name(name),
            }
        )
    return rows


def main():
    paths = list(FILINGS_DIR.rglob("*.txt"))
    print(f"Files on disk: {len(paths):,}")
    if len(paths) == 0:
        print(f"ERROR: no files in {FILINGS_DIR}. Run step 2 first.")
        sys.exit(1)

    workers = max(1, (os.cpu_count() or 4) - 1)
    print(f"Parsing with {workers} workers")

    t0 = time.time()
    all_rows: list[dict] = []
    with cf.ProcessPoolExecutor(max_workers=workers) as ex:
        results = ex.map(parse_one, [str(p) for p in paths], chunksize=256)
        for i, rows in enumerate(results):
            all_rows.extend(rows)
            if (i + 1) % 25_000 == 0:
                rate = (i + 1) / (time.time() - t0)
                print(f"  {i+1:,}/{len(paths):,} ({rate:.0f}/s)")

    dt = time.time() - t0
    print(f"Parsed {len(paths):,} files in {dt:.1f}s ({len(paths)/dt:.0f}/s)")
    print(f"Owner rows extracted: {len(all_rows):,}")

    df = pd.DataFrame(all_rows)
    # Dedup on (issuer, owner) — same owner can appear in many filings
    n_before = len(df)
    df = df.drop_duplicates(["issuer_cik", "rpt_owner_cik"])
    print(f"After dedup: {len(df):,} unique (issuer, owner_cik) pairs (from {n_before:,})")

    df.to_parquet(OUT)
    print(f"Wrote {OUT.relative_to(PROJ)}")


if __name__ == "__main__":
    main()
