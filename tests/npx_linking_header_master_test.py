#!/usr/bin/env python3
"""Contract for the pre-2010 header vocabulary stage.

WHY THIS EXISTS
    The SEC Series and Class Report is an annual snapshot of THEN-ACTIVE
    registrants starting 2010, so a fund that died before the first snapshot is
    in no vintage. Series IDs were mandatory from 2006-02-06 and every 40-Act
    filing carries the block in its SGML header, so that vocabulary is
    recoverable. Measured 2026-08-28 over 224,103 filings 2006-2009: 2,889
    series absent from every SEC vintage, 2,754 of them open-end.

    The stage's job is a COLLAPSE, and the collapse is the thing worth pinning.
    The scan emits one row per (filing, series, class), so a series with twelve
    share classes filing quarterly appears dozens of times with one name. Left
    duplicated it would weight that name dozens of times in the IDF and distort
    every score in the corpus.

    uv run --with pandas,pyarrow,pytest python3 -m pytest tests/npx_linking_header_master_test.py -q
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "skills/npx-ownership-panel/scripts/npx_linking"
sys.path.insert(0, str(SCRIPTS))

import build_header_series_master as bh

COLUMNS = ["filepath", "accession", "form_type", "filed_date", "owner_cik",
           "series_id", "series_name", "class_id", "class_name", "class_ticker"]


def write_scan(tmp_path, rows):
    p = tmp_path / "scan.tsv"
    with p.open("w", newline="") as fh:
        w = csv.writer(fh, delimiter="\t")
        w.writerow(COLUMNS)
        w.writerows(rows)
    return str(p)


def row(sid, name, filed, cls="C000000001", cik="0000012345"):
    return ["p.txt", "0001-07-1", "N-PX", filed, cik, sid, name, cls, "Class A", ""]


def test_collapses_share_classes_to_one_name(tmp_path):
    """Twelve classes of one series in one filing is ONE vocabulary entry."""
    rows = [row("S000000042", "Equity Income Portfolio", "20080315",
                cls=f"C00000{i:04d}") for i in range(12)]
    df = bh.read_scan([write_scan(tmp_path, rows)])
    assert len(df) == 1
    assert df.iloc[0]["n_filings"] == 12


def test_keeps_each_distinct_name_a_series_carried(tmp_path):
    """The rename history is the point: both names must survive."""
    df = bh.read_scan([write_scan(tmp_path, [
        row("S000000013", "Dreyfus Municipal Bond Fund", "20070601"),
        row("S000000013", "BNY Mellon Municipal Bond Fund", "20090601"),
    ])])
    assert set(df["series_name"]) == {"Dreyfus Municipal Bond Fund",
                                      "BNY Mellon Municipal Bond Fund"}


def test_keeps_the_same_name_in_different_years_separately(tmp_path):
    """file_year is what lets a match prefer the name current when it voted."""
    df = bh.read_scan([write_scan(tmp_path, [
        row("S000000042", "Equity Income Portfolio", "20070315"),
        row("S000000042", "Equity Income Portfolio", "20080315"),
    ])])
    assert sorted(df["file_year"]) == [2007, 2008]


def test_drops_rows_with_no_series_or_no_name(tmp_path):
    """A 40-Act filing with no series block emits blanks; they are not vocabulary."""
    df = bh.read_scan([write_scan(tmp_path, [
        row("S000000042", "Real Fund", "20080315"),
        row("", "", "20080315"),
        row("S000000099", "", "20080315"),
    ])])
    assert len(df) == 1
    assert df.iloc[0]["series_id"] == "S000000042"


def test_strips_leading_zeros_from_owner_cik(tmp_path):
    """ISS fundcik is unpadded; the header is zero-padded to 10."""
    df = bh.read_scan([write_scan(tmp_path, [
        row("S000000042", "Real Fund", "20080315", cik="0000012345")])])
    assert df.iloc[0]["owner_cik"] == "12345"


def test_merges_several_scan_files(tmp_path):
    """2006-2009 and 2010-2011 are separate scans of the same shape."""
    d = tmp_path / "a"
    d.mkdir()
    a = write_scan(d, [row("S000000042", "Fund A", "20070315")])
    b = write_scan(tmp_path, [row("S000000043", "Fund B", "20110315")])
    df = bh.read_scan([a, b])
    assert set(df["series_id"]) == {"S000000042", "S000000043"}


def test_rejects_a_scan_with_no_series_rows(tmp_path):
    df = bh.read_scan([write_scan(tmp_path, [row("", "", "20080315")])])
    assert df.empty
