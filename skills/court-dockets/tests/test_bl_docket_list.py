"""bl_docket_list.py — the offline decisions: slicing, CSV parsing, the id-set assertion.

    cd skills/court-dockets && python3 -m pytest

No Bloomberg call is made; fixtures are written inline.
"""
import datetime as dt
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / "scripts"))
import bl_docket_list as B

D = dt.date


def test_paging_window_wall():
    assert B.window_ok(100, 100) and B.window_ok(101, 99)
    assert not B.window_ok(101, 100) and not B.window_ok(334, 30)


def test_slicing_threshold():
    assert not B.needs_slicing(9000) and B.needs_slicing(9001)
    assert not B.needs_slicing(481) and B.needs_slicing(25874)


def test_split_slice_halves_and_stops_at_a_day():
    a, b = B.split_slice(D(2020, 1, 1), D(2020, 12, 31))
    assert a[0] == D(2020, 1, 1) and b[1] == D(2020, 12, 31)
    assert b[0] - a[1] == dt.timedelta(days=1)
    assert B.split_slice(D(2020, 5, 5), D(2020, 5, 5)) is None


def fake_probe(counts):
    """probe(lo, hi) over a per-day count table; records the calls."""
    calls = []

    def probe(lo, hi):
        calls.append((lo, hi))
        if lo is None:
            return sum(counts.values())
        return sum(n for d, n in counts.items() if lo <= d <= hi)
    probe.calls = calls
    return probe


def test_plan_unsliced_when_under_cap():
    probe = fake_probe({D(2020, 3, 1): 481})
    assert B.plan_leaves(probe, B.SLICE_MAX, 2019, 2021) == [None]
    assert probe.calls == [(None, None)]


def test_plan_slices_by_year_and_covers_every_docket():
    counts = {D(2019, 6, 1): 4000, D(2020, 2, 1): 5000, D(2021, 7, 1): 3000}
    leaves = B.plan_leaves(fake_probe(counts), B.SLICE_MAX, 2018, 2022)
    assert leaves == [(D(2019, 1, 1), D(2019, 12, 31)), (D(2020, 1, 1), D(2020, 12, 31)),
                      (D(2021, 1, 1), D(2021, 12, 31))]


def test_plan_halves_a_year_over_the_cap_and_keeps_every_row_once():
    counts = {D(2020, 2, 1): 6000, D(2020, 9, 1): 6000}
    leaves = B.plan_leaves(fake_probe(counts), B.SLICE_MAX, 2020, 2020)
    assert len(leaves) == 2
    got = sum(sum(n for d, n in counts.items() if lo <= d <= hi) for lo, hi in leaves)
    assert got == 12000
    assert all(lo <= hi for lo, hi in leaves)


def test_plan_csv_cap_is_stricter_than_paging_cap():
    counts = {D(2020, 2, 1): 700, D(2020, 9, 1): 700}
    assert B.plan_leaves(fake_probe(counts), B.SLICE_MAX, 2020, 2020) == [None]  # fine for paging
    leaves = B.plan_leaves(fake_probe(counts), B.CSV_CAP_SAFE, 2020, 2020)
    assert len(leaves) == 2  # 1,400 > 950: halved so no export can hit the 1,000-row cap


def test_plan_keeps_an_oversized_single_day_instead_of_dropping_it():
    counts = {D(2020, 4, 4): 1200}
    assert B.plan_leaves(fake_probe(counts), B.CSV_CAP_SAFE, 2020, 2020) == [(D(2020, 4, 4), D(2020, 4, 4))]


CSV = (
    "Bloomberg Law Court Dockets export\r\n"
    "Generated 10/09/2026\n"
    "Title,Docket Number,Document URL,Parties\n"
    'A v. B,A-26-1-B,https://www.bloomberglaw.com/product/blaw/document/X1AAA,"Smith / Jones"\n'
    'C v. D,A-26-2-B,https://www.bloomberglaw.com/product/blaw/document/X1BBB,"multi\nline"\n'
    ",,,\n"
)


def test_csv_header_is_line_three_and_preamble_is_skipped():
    header, rows = B.parse_csv_export(CSV)
    assert header == ["Title", "Docket Number", "Document URL", "Parties"]
    assert [B.docket_id_from_url(r["Document URL"]) for r in rows] == ["X1AAA", "X1BBB"]
    assert rows[1]["Parties"] == "multi\nline"   # quoted newline stays in its field


def test_csv_with_only_a_preamble_is_empty():
    assert B.parse_csv_export("pre\namble\n") == ([], [])


def test_id_set_assertion():
    B.check_id_sets(["a", "b"], ["b", "a", "a"])      # order and duplicates do not matter
    with pytest.raises(AssertionError, match="csv-only 1, paged-only 1"):
        B.check_id_sets(["a", "b"], ["b", "c"])


def test_facet_args_default_content_kind_and_multi_value():
    f = B.parse_facet_args(["state_court_county_id=84,85", "court_id=138"])
    assert f == {"state_court_county_id": ["84", "85"], "court_id": ["138"], "content_kind": ["2"]}
    assert B.parse_facet_args(["content_kind=2"]) == {"content_kind": ["2"]}
    with pytest.raises(SystemExit):
        B.parse_facet_args(["oops"])


def test_criteria_term_is_verbatim_and_filing_type_is_top_level():
    f = B.parse_facet_args(["docket_entry_filing_type=complaint"])
    c = B.build_criteria(f, '"Business Court"', [], 3, 100, D(2020, 1, 1), D(2020, 12, 31))["criteria"]
    assert c["term"] == '"Business Court"' and c["page"] == 3
    assert c["docket_entry_filing_type"] == ["complaint"] and "docket_entry_filing_type" not in c["facets"]
    assert c["start_date"] == 1577836800000


def test_flatten_item_parses_docket_number_and_court():
    item = {"id": "X1", "entity_id": "E", "date": "2026-10-06T00:00:00",
            "title": "Daniel Schopf, Plaintiff(s) vs. Nathan Schopf, Defendant(s), "
                     "Docket No. A-26-958691-B (Nev. Dist. Ct. Oct 06, 2026), Court Docket",
            "metadata": [{"key": "judge", "value": ["Maria Gall"]},
                         {"key": "case_type", "value": ["NRS Chapters 78-89"]}]}
    r = B.flatten_item(item)
    assert (r["docket_number"], r["court"], r["date_filed_iso"]) == ("A-26-958691-B", "Nev. Dist. Ct.", "2026-10-06")
    assert (r["judge"], r["case_type"]) == ("Maria Gall", "NRS Chapters 78-89")


class FakeClient:
    """Stands in for the CDP client: serves a fixed docket population, honouring the 10,000 wall."""

    def __init__(self, n, short_by=0):
        self.ids = [f"X{i:05d}" for i in range(n)]
        self.short_by = short_by

    def close(self):
        pass

    def search(self, criteria, what):
        c = criteria["criteria"]
        served = self.ids[:len(self.ids) - self.short_by]   # remote_count still claims all of them
        if c["page"] * c["page_size"] > B.MAX_WINDOW or not served:
            return {"criteria_id": "cid", "docs": None, "facets": None, "components": []}
        lo = (c["page"] - 1) * c["page_size"]
        items = [{"id": i, "title": f"t {i}", "date": "2020-01-01T00:00:00", "metadata": []}
                 for i in served[lo:lo + c["page_size"]]]
        return {"criteria_id": "cid", "docs": {"remote_count": len(self.ids), "items": items},
                "facets": None, "components": ["documents"]}


def _run(tmp_path, monkeypatch, client):
    monkeypatch.setattr(B, "Client", lambda port: client)
    args = B.argparse.Namespace(term="t", source=[], out=str(tmp_path), csv=False, port=0,
                                year_lo=2020, year_hi=2020)
    return B.run_collect(args, {"content_kind": ["2"]})


def test_run_collect_writes_one_row_per_id_and_exits_zero(tmp_path, monkeypatch):
    assert _run(tmp_path, monkeypatch, FakeClient(250)) == 0
    assert len((tmp_path / "items.jsonl").read_text().splitlines()) == 250
    assert len((tmp_path / "dockets.csv").read_text().splitlines()) == 251


def test_run_collect_exits_nonzero_when_ids_fall_short_of_remote_count(tmp_path, monkeypatch):
    assert _run(tmp_path, monkeypatch, FakeClient(250, short_by=3)) == 1


def test_a_checkpoint_from_a_different_search_aborts(tmp_path):
    ck = tmp_path / "_checkpoint.jsonl"
    ck.write_text('{"kind": "config", "sig": {"facets": {}, "term": "other", "sources": []}}\n')
    args = B.argparse.Namespace(term="t", source=[])
    with pytest.raises(B.Abort, match="different search"):
        B.Collector(object(), args, {"content_kind": ["2"]}, tmp_path)
