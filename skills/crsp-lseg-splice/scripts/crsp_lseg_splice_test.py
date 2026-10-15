# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest", "pandas", "numpy", "pyarrow", "psycopg2-binary"]
# ///
"""Contract tests for crsp_lseg_splice.py: return-chained splice, coverage report, CLI dispatch.

Only the file-in/file-out steps run (rebuild_price, _long_hist, step_splice, step_coverage).
universe needs WRDS, map and pull need an LSEG session: not exercised.
"""

import sys
from pathlib import Path

import pandas as pd
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import crsp_lseg_splice as s

ASOF = "2025-12-31"


@pytest.fixture
def out(tmp_path):
    (tmp_path / "asof.txt").write_text(ASOF + "\n")
    link = pd.DataFrame({
        "permno": [1, 2, 3], "RIC": ["AAA.O", "BBB.O", "CCC.TRE"],
        "ticker": ["AAA", "BBB", "CCC"], "issuernm": ["A", "B", "C"],
        "usable": [True, True, False],
        "link_status": ["ok", "ok", "foreign_venue"],
    })
    link.to_parquet(tmp_path / "link.parquet")
    crsp = pd.DataFrame({
        "permno": [1, 1, 2, 2, 3],
        "date": pd.to_datetime(["2025-12-30", ASOF, "2025-12-30", ASOF, ASOF]),
        "dlyprc": [10.0, 10.0, 100.0, 100.0, 5.0],
        "dlyret": [0.0] * 5,
        "dlycap": [1000.0, 1000.0, 5000.0, 5000.0, 50.0],
        "dlyvol": [1.0] * 5,
    })
    crsp.to_parquet(tmp_path / "crsp_panel.parquet")
    idx = pd.DatetimeIndex(["2025-12-31", "2026-01-02", "2026-01-05"], name="Date")
    cols = pd.MultiIndex.from_product([["AAA.O", "BBB.O"], ["TRDPRC_1", "ACVOL_UNS"]])
    # BBB split 2:1 after the cutoff: LSEG states every BBB price on the halved basis.
    H = pd.DataFrame([[10.0, 7, 50.0, 8], [10.1, 7, 50.5, 8], [10.3, 7, 51.0, 8]],
                     index=idx, columns=cols)
    H.to_parquet(tmp_path / "lseg_hist.parquet")
    R = pd.DataFrame({
        "Instrument": ["AAA.O"] * 4 + ["BBB.O"] * 4,
        "Date": ["2025-12-31", "2026-01-02", "2026-01-05", "2026-01-06"] * 2,
        "Daily Total Return": [0.0, 1.0, 2.0, 5.0, 0.0, 1.0, 2.0, 5.0],  # percent
    })
    R.to_parquet(tmp_path / "lseg_ret.parquet")
    return tmp_path


def test_rebuild_price_chains_returns_off_crsp_price():
    g = pd.DataFrame({"p0": [100.0] * 3, "ret": [0.10, -0.50, 0.0]})
    assert s.rebuild_price(g).round(6).tolist() == [110.0, 55.0, 55.0]


def test_us_suffixes_accept_us_venues_and_reject_foreign():
    assert "O" in s.US_SUFFIXES and "" in s.US_SUFFIXES
    assert not {"TRE", "MU", "SG"} & s.US_SUFFIXES


def test_splice_chains_on_returns_and_keeps_crsp_basis(out):
    panel = s.step_splice(out)
    gap = panel[panel.source == "LSEG"].set_index(["permno", "date"])
    d1, d2 = pd.Timestamp("2026-01-02"), pd.Timestamp("2026-01-05")
    assert gap.loc[(1, d1), "dlyprc"] == pytest.approx(10.1)
    assert gap.loc[(1, d2), "dlyprc"] == pytest.approx(10.1 * 1.02)
    # split-affected name: level stays on CRSP's 100 basis, no fake -50% return
    assert gap.loc[(2, d1), "dlyprc"] == pytest.approx(101.0)
    assert gap.loc[(2, d1), "dlyret"] == pytest.approx(0.01)
    assert gap.loc[(2, d1), "adj_ratio"] == pytest.approx(2.0)
    assert gap.loc[(2, d1), "lseg_prc"] == 50.5
    # cap follows the price relative on LSEG's single basis
    assert gap.loc[(2, d1), "dlycap"] == pytest.approx(5000 * 50.5 / 50.0)
    assert gap.loc[(2, d2), "dlyvol"] == 8


def test_splice_row_accounting_and_exclusions(out):
    panel = s.step_splice(out)
    assert (panel.source == "CRSP").sum() == 5 and (panel.source == "LSEG").sum() == 4
    assert set(panel[panel.source == "LSEG"].permno) == {1, 2}  # unusable permno 3 gets no gap
    # 2026-01-06 has a return but no same-day price: dropped by the inner join
    assert pd.Timestamp("2026-01-06") not in set(panel.date)
    # cutoff-day overlap row is the anchor, not part of the gap
    assert not ((panel.source == "LSEG") & (panel.date <= pd.Timestamp(ASOF))).any()
    assert panel.equals(panel.sort_values(["permno", "date"]))
    assert (out / "panel_spliced.parquet").exists()
    pd.testing.assert_frame_equal(
        pd.read_parquet(out / "panel_spliced.parquet").reset_index(drop=True),
        panel.reset_index(drop=True))


def test_splice_missing_column_fails_naming_it(out):
    pd.read_parquet(out / "link.parquet").drop(columns="usable").to_parquet(out / "link.parquet")
    with pytest.raises(KeyError, match=r"link\.parquet: missing \['usable'\]"):
        s.step_splice(out)


def test_splice_missing_input_file_raises(out):
    (out / "lseg_ret.parquet").unlink()
    with pytest.raises(FileNotFoundError):
        s.step_splice(out)


def test_long_hist_drops_unpriced_rows_and_coerces_numbers():
    idx = pd.DatetimeIndex(["2026-01-02", "2026-01-05"], name="Date")
    cols = pd.MultiIndex.from_product([["AAA.O"], ["TRDPRC_1", "ACVOL_UNS"]])
    H = pd.DataFrame([[None, 1], ["10.5", 2]], index=idx, columns=cols)
    lg = s._long_hist(H)
    assert lg.RIC.tolist() == ["AAA.O"] and lg.TRDPRC_1.tolist() == [10.5]
    assert lg.date.iloc[0] == pd.Timestamp("2026-01-05")


def test_coverage_reports_denominator_and_off_basis(out, capsys):
    s.step_splice(out)
    capsys.readouterr()
    link = s.step_coverage(out)
    text = capsys.readouterr().out
    assert len(link) == 3
    assert "denominator = 3 CRSP common stocks trading 2025-12-31" in text
    assert "usable link (US venue)" in text and "  with >=1 gap observation" in text
    assert "last LSEG date in panel: 2026-01-05" in text
    assert "off-basis securities: 1" in text  # BBB: ratio 2.0
    assert "foreign_venue" in text


def test_main_all_runs_five_steps_in_order(monkeypatch, tmp_path):
    calls = []
    for name in ("universe", "map", "pull", "splice", "coverage"):
        monkeypatch.setattr(s, f"step_{name}", lambda *a, _n=name: calls.append((_n, a)))
    monkeypatch.setattr(sys, "argv", ["x", "all", "--out", str(tmp_path), "--user", "u",
                                      "--start", "2021-01-01", "--end", "2026-02-01"])
    s.main()
    assert [c[0] for c in calls] == ["universe", "map", "pull", "splice", "coverage"]
    assert calls[0][1] == (tmp_path, "u", "2021-01-01")
    assert calls[2][1] == (tmp_path, "2026-02-01")


def test_main_rejects_unknown_step(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["x", "bogus"])
    with pytest.raises(SystemExit) as ei:
        s.main()
    assert ei.value.code == 2
