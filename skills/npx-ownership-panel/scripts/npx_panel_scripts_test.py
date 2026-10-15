# /// script
# requires-python = ">=3.10"
# dependencies = ["pytest", "polars", "pandas", "numpy", "pyarrow", "pyreadstat"]
# ///
"""Contract tests for the npx-ownership-panel Python scripts: canonical_hash, dq_panel,
npx_link_to_csv, the pure parts of build_inst_own / build_short_interest, and run_sas.sh.

Offline by construction: synthetic frames in tmp, `src.wrds_pull` replaced by an inert stub
(the two builders refuse to import without it), `sas` replaced by a stub on PATH. Nothing here
opens a WRDS connection, runs SAS, or reads a real data path. The WRDS queries, the SGE
wrappers and the SAS programs are not exercised."""

import datetime as dt
import importlib
import json
import os
import subprocess
import sys
import types
from pathlib import Path

import polars as pl
import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import canonical_hash as ch  # noqa: E402


# ------------------------------------------------------------------ canonical_hash

def frame(**cols):
    return pl.DataFrame(cols)


def test_hash_ignores_row_and_column_order():
    a = frame(k=[1, 2, 3], v=[1.5, 2.5, 3.5])
    b = frame(v=[3.5, 1.5, 2.5], k=[3, 1, 2])
    assert ch.digest(a, ["k"], 12, None)["sha256"] == ch.digest(b, ["k"], 12, None)["sha256"]


def test_hash_ignores_ulp_noise_but_sees_real_change():
    a = frame(k=[1, 2], v=[0.1 + 0.2, 1.0])
    b = frame(k=[1, 2], v=[0.3, 1.0])
    assert a["v"][0] != b["v"][0]
    assert ch.digest(a, ["k"], 12, None)["sha256"] == ch.digest(b, ["k"], 12, None)["sha256"]
    c = frame(k=[1, 2], v=[0.3001, 1.0])
    assert ch.digest(c, ["k"], 12, None)["sha256"] != ch.digest(b, ["k"], 12, None)["sha256"]


def test_hash_renders_null_and_nan_alike_and_booleans_as_01():
    d = frame(k=[1, 2, 3], v=[None, float("nan"), 2.0], f=[True, None, False])
    canon = ch.canonical_frame(d, ["k"], 12)
    assert canon["v"].to_list() == ["", "", "2"]
    assert canon["f"].to_list() == ["1", "", "0"]


def test_hash_without_keys_is_a_total_order():
    a = frame(x=[2, 1, 1], y=["b", "z", "a"])
    b = frame(x=[1, 2, 1], y=["a", "b", "z"])
    assert ch.digest(a, None, 12, None)["sha256"] == ch.digest(b, None, 12, None)["sha256"]


def test_unknown_sort_key_refuses():
    with pytest.raises(SystemExit, match="sort keys not in data"):
        ch.canonical_frame(frame(a=[1]), ["nope"], 12)


def test_profile_and_group_counts():
    d = frame(g=["x", "x", "y"], v=[1.0, None, 4.0])
    r = ch.digest(d, ["g"], 12, "g")
    assert r["rows"] == 3 and r["cols"] == 2
    assert r["columns"]["v"] == {"nulls": 1, "sum": 5.0, "min": 1.0, "max": 4.0}
    assert r["columns"]["g"] == {"nulls": 0, "n_unique": 2}
    assert r["groups"] == {"x": 2, "y": 1}


def test_load_dispatch_and_unsupported(tmp_path):
    p = tmp_path / "a.csv"
    p.write_text("k,v\n1,2\n")
    assert ch._load(p).to_dicts() == [{"k": 1, "v": 2}]
    with pytest.raises(SystemExit, match="unsupported format"):
        ch._load(tmp_path / "a.xlsx")


def test_load_falls_back_to_verbatim_strings_for_dot_columns(tmp_path):
    p = tmp_path / "a.csv"
    # an int column polars infers, then a literal "." deep enough to defeat inference
    p.write_text("k,v\n" + "".join(f"{i},{i}\n" for i in range(200)) + "999,.\n")
    d = ch._load(p)
    assert d["v"].dtype == pl.String and d["v"][-1] == "."


def run_cli(*args):
    return subprocess.run([sys.executable, str(HERE / "canonical_hash.py"), *args],
                          capture_output=True, text=True)


def test_cli_exit_codes_identical_vs_different(tmp_path):
    a, b, c = (tmp_path / n for n in ("a.csv", "b.csv", "c.csv"))
    a.write_text("k,v\n1,1.0\n2,2.0\n")
    b.write_text("v,k\n2.0,2\n1.0,1\n")
    c.write_text("k,v\n1,1.0\n2,9.0\n")
    ok = run_cli(str(a), str(b), "--keys", "k")
    assert ok.returncode == 0 and "IDENTICAL" in ok.stdout
    bad = run_cli(str(a), str(c), "--keys", "k")
    assert bad.returncode == 1 and "DIFFERENT" in bad.stdout
    assert "v.sum: 3.0 vs 10.0" in bad.stdout


def test_cli_json_single_file(tmp_path):
    a = tmp_path / "a.csv"
    a.write_text("k,v\n1,1.0\n")
    r = run_cli(str(a), "--json")
    assert r.returncode == 0
    assert json.loads(r.stdout)["rows"] == 1


# ------------------------------------------------------------------ npx_link_to_csv

def link_cli(tmp_path, df, *args, name="link.parquet"):
    src = tmp_path / name
    df.write_parquet(src)
    out = tmp_path / "out" / "npx_link.csv"
    r = subprocess.run([sys.executable, str(HERE / "npx_link_to_csv.py"), "--in", str(src),
                        "--out", str(out), *args], capture_output=True, text=True)
    return r, out


def test_link_csv_shape_sort_and_dedup(tmp_path):
    df = pl.DataFrame({"fundid": ["30", "10", "10", "x"], "block": [" b ", "a", "dup", "c"],
                       "tna_latest": [3.0, 1.0, 2.0, 9.0]})
    r, out = link_cli(tmp_path, df)
    assert r.returncode == 0, r.stderr
    lines = out.read_text().splitlines()
    assert lines[0] == "fundid,block,tna_w"
    assert lines[1:] == ["10.0,a,1.0", "30.0,b,3.0"]        # sorted, stripped, first dup kept
    assert "non-numeric fundid" in r.stderr
    assert "row(s) dropped" in r.stdout


def test_link_csv_missing_column_and_missing_weight(tmp_path):
    r, _ = link_cli(tmp_path, pl.DataFrame({"fundid": [1]}))
    assert r.returncode != 0 and "lacks ['block']" in r.stderr
    r, out = link_cli(tmp_path, pl.DataFrame({"fundid": [1], "block": ["a"]}))
    assert r.returncode == 0 and "tna_w written empty" in r.stdout
    assert out.read_text().splitlines()[1] == "1,a,"


@pytest.mark.parametrize("label,msg", [("x" * 25, "exceed SAS length $24"),
                                       ("a,b", "comma/quote/newline")])
def test_link_csv_refuses_labels_sas_would_corrupt(tmp_path, label, msg):
    r, out = link_cli(tmp_path, pl.DataFrame({"fundid": [1], "block": [label]}))
    assert r.returncode != 0 and msg in r.stderr
    assert not out.exists()


def test_link_csv_null_block_gets_sentinel(tmp_path):
    r, out = link_cli(tmp_path, pl.DataFrame({"fundid": [1], "block": [None]},
                                             schema={"fundid": pl.Int64, "block": pl.String}))
    assert r.returncode == 0 and "__nogroup__" in out.read_text()


# ------------------------------------------------------------------ dq_panel

import dq_panel  # noqa: E402


def panel(n_periods=6, io=0.5, tso=100.0):
    rows = []
    dates = [20230331, 20230630, 20230930, 20231231, 20240331, 20240630][:n_periods]
    for permno in (1, 2, 3):
        for rdate in dates:
            rows.append({"permno": permno, "rdate": rdate, "io_total": io * tso,
                         "io_total_net": io * tso, "numowners": 10, "tso": tso, "me": 5000.0})
    return pl.DataFrame(rows)


def run_dq(monkeypatch, capsys, path, year2="2024"):
    monkeypatch.setenv("INST_OWN_PARQUET", str(path))
    monkeypatch.setenv("YEAR2", year2)
    rc = dq_panel.main()
    return rc, capsys.readouterr()


def test_dq_missing_panel_exits_2(monkeypatch, capsys, tmp_path):
    rc, cap = run_dq(monkeypatch, capsys, tmp_path / "absent.parquet")
    assert rc == 2 and "leg 2 output not found" in cap.err


def test_dq_schema_refusal(monkeypatch, capsys, tmp_path):
    p = tmp_path / "p.parquet"
    panel().drop("tso").write_parquet(p)
    monkeypatch.setenv("INST_OWN_PARQUET", str(p))
    with pytest.raises(Exception, match="missing \\['tso'\\]"):
        dq_panel.main()


def test_dq_clean_panel_reports_zero_impossible(monkeypatch, capsys, tmp_path):
    p = tmp_path / "p.parquet"
    panel().write_parquet(p)
    rc, cap = run_dq(monkeypatch, capsys, p)
    assert rc == 0
    assert "p.parquet: 18 rows x 7 cols" in cap.out
    assert "NOTE: DQ impossible_ratio=0/18=0.000% testable=100.0%_of_panel" in cap.out
    assert "NOTE: DQ impossible_ratio_EXTREME=0/18" in cap.out


def test_dq_counts_extreme_and_untestable_rows(monkeypatch, capsys, tmp_path):
    p = tmp_path / "p.parquet"
    d = panel()
    d = d.with_columns(
        pl.when((pl.col("permno") == 1) & (pl.col("rdate") == 20230331)).then(600.0)
        .otherwise(pl.col("io_total")).alias("io_total"),          # 6x shares: past lending
        pl.when(pl.col("permno") == 3).then(None).otherwise(pl.col("tso")).alias("tso"),
    )
    d.write_parquet(p)
    rc, cap = run_dq(monkeypatch, capsys, p)
    assert rc == 0
    # permno 3 has no tso: 6 untestable rows, 12 testable of 18
    assert "testable=66.7%_of_panel" in cap.out
    assert "impossible_ratio_EXTREME=1/12=8.333%" in cap.out
    assert "6 rows (33.3%) are invisible" in cap.out


def test_dq_resolves_detectors_by_env_then_fails_loudly(monkeypatch, capsys, tmp_path):
    fake = tmp_path / "ownership_dq.py"
    fake.write_text("MARK = 1\n")
    monkeypatch.setenv("OWNERSHIP_DQ", str(fake))
    assert dq_panel.load_odq().MARK == 1
    # no env, no repo layout, nothing alongside -> exit 2 with the remedy
    monkeypatch.delenv("OWNERSHIP_DQ")
    lonely = tmp_path / "a" / "b" / "scripts"
    lonely.mkdir(parents=True)
    monkeypatch.setattr(dq_panel, "HERE", lonely)
    with pytest.raises(SystemExit) as e:
        dq_panel.load_odq()
    assert e.value.code == 2
    assert "cannot find ownership_dq.py" in capsys.readouterr().err


# ------------------------------------------------------------------ build_inst_own / build_short_interest

@pytest.fixture
def stub_wrds(monkeypatch):
    """Both builders refuse to import without src.wrds_pull; give them an inert one."""
    src = types.ModuleType("src")
    wp = types.ModuleType("src.wrds_pull")

    def connect(*a, **k):
        raise AssertionError("offline suite must never open a WRDS connection")
    wp.connect = connect
    src.wrds_pull = wp
    monkeypatch.setitem(sys.modules, "src", src)
    monkeypatch.setitem(sys.modules, "src.wrds_pull", wp)


def load(name, stub_wrds):
    sys.modules.pop(name, None)
    return importlib.import_module(name)


def test_builders_refuse_without_project_src(monkeypatch):
    monkeypatch.setitem(sys.modules, "src", None)       # makes `from src import ...` fail
    for name in ("build_short_interest", "build_inst_own"):
        sys.modules.pop(name, None)
        with pytest.raises(SystemExit, match="needs src/wrds_pull.py"):
            importlib.import_module(name)


QUARTER_ENDS = [(20230101, 20230331), (20230331, 20230331), (20230401, 20230630),
                (20230630, 20230630), (20230815, 20230930), (20231001, 20231231),
                (20231231, 20231231)]


def test_inst_own_snap_and_quarter_index(stub_wrds):
    m = load("build_inst_own", stub_wrds)
    d = pl.DataFrame({"r": [a for a, _ in QUARTER_ENDS]})
    out = d.with_columns(m.snap_to_quarter_end(pl.col("r")).alias("s"),
                         m.quarter_index(pl.col("r")).alias("q"))
    assert out["s"].to_list() == [b for _, b in QUARTER_ENDS]
    qi = out["q"].to_list()
    assert qi[2] - qi[0] == 1 and qi[0] == qi[1]          # monotonic, one step per quarter


def test_short_interest_snap_survives_int8_month_overflow(stub_wrds):
    m = load("build_short_interest", stub_wrds)
    d = pl.DataFrame({"d": [dt.date(2023, 2, 15), dt.date(2023, 5, 15), dt.date(2023, 8, 15),
                            dt.date(2023, 11, 15), dt.date(2023, 12, 31)]})
    out = d.select(m.snap_to_quarter_end(pl.col("d")).alias("s"))["s"].to_list()
    assert out == [20230331, 20230630, 20230930, 20231231, 20231231]


def test_net_of_lending_clamp_null_and_missing_flag(stub_wrds, monkeypatch, tmp_path):
    m = load("build_inst_own", stub_wrds)
    si = tmp_path / "short_interest.parquet"
    pl.DataFrame({"permno": [1, 2, 3], "rdate": [20230331] * 3, "shortint": [10.0, 500.0, 5.0]}
                 ).write_parquet(si)
    monkeypatch.setattr(m, "SHORTINT_CACHE", si)
    panel_ = pl.DataFrame({
        "permno": [1, 2, 3, 4], "rdate": [20230331] * 4,
        "io_total": [100.0, 100.0, None, 80.0], "cfacshr": [2.0, 1.0, 1.0, 1.0],
        "tso": [1000.0, 1000.0, 1000.0, 0.0],
    })
    out = m.add_net_of_lending(panel_).sort("permno")
    assert out["io_total_net"].to_list() == [80.0, 0.0, None, 80.0]   # 100-10*2; clamp; unknown stays null; no SI
    assert out["si_missing"].to_list() == [False, False, False, True]
    assert out["net_clamped"].to_list() == [False, True, False, False]
    assert out["ior_net"].to_list() == [0.08, 0.0, None, None]        # tso=0 -> no ratio
    assert out["si_frac"][0] == pytest.approx(0.02)


def test_net_of_lending_skips_when_cache_absent(stub_wrds, monkeypatch, tmp_path, capsys):
    m = load("build_inst_own", stub_wrds)
    monkeypatch.setattr(m, "SHORTINT_CACHE", tmp_path / "absent.parquet")
    d = pl.DataFrame({"permno": [1]})
    assert m.add_net_of_lending(d).equals(d)
    assert "skipping lending netting" in capsys.readouterr().out


def test_dead_tail_guard(stub_wrds, capsys):
    m = load("build_inst_own", stub_wrds)
    live = pl.DataFrame({"rdate": [1, 1, 2, 2, 3, 3], "io_total": [1.0] * 6})
    m._assert_no_dead_tail(live)
    assert "no dead tail" in capsys.readouterr().out
    dead = pl.DataFrame({"rdate": [1, 1, 2, 2, 3, 3], "io_total": [1.0, 1.0, 1.0, 1.0, None, None]},
                        schema={"rdate": pl.Int64, "io_total": pl.Float64})
    with pytest.raises(ValueError, match="last 1 quarter"):
        m._assert_no_dead_tail(dead)
    never = pl.DataFrame({"rdate": [1, 2], "io_total": [None, None]}, schema={"rdate": pl.Int64, "io_total": pl.Float64})
    m._assert_no_dead_tail(never)        # all-null is a different defect; deliberately silent


def test_finalize_io_metrics_hhi_and_dbreadth(stub_wrds):
    m = load("build_inst_own", stub_wrds)
    io = pl.DataFrame({
        "permno": [1, 1], "rdate_int": [20230331, 20230630],
        "numowners": [10, 12], "NumInst": [10, 12], "NewInst": [0, 4], "OldInst": [0, 2],
        "io_total": [100.0, 100.0], "io_ss": [2500.0, 2500.0],
    })
    out = m.finalize_io_metrics(io).sort("rdate_int")
    assert out["ioc_hhi"].to_list() == [0.25, 0.25]
    # ((12-4) - (10-0)) / 10 = -0.2 ; first quarter has no lag
    assert out["dbreadth"].to_list() == [None, pytest.approx(-0.2)]


# ------------------------------------------------------------------ run_sas.sh (stubbed sas)

def stub_sas(tmp_path):
    bindir = tmp_path / "bin"
    bindir.mkdir(exist_ok=True)
    sas = bindir / "sas"
    sas.write_text('#!/bin/bash\nprintf "%s\\n" "$@" > "$STUB_OUT"\n')
    sas.chmod(0o755)
    return bindir


def run_sas(tmp_path, *args):
    env = {**os.environ, "PATH": f"{stub_sas(tmp_path)}:{os.environ['PATH']}",
           "STUB_OUT": str(tmp_path / "argv.txt")}
    return subprocess.run(["bash", str(HERE / "run_sas.sh"), *args], cwd=tmp_path, env=env,
                          capture_output=True, text=True)


def test_run_sas_requires_a_script(tmp_path):
    r = run_sas(tmp_path)
    assert r.returncode == 1 and "Usage:" in r.stdout
    assert not (tmp_path / "argv.txt").exists()            # sas never ran


def test_run_sas_names_logs_per_sysparm(tmp_path):
    r = run_sas(tmp_path, "dir/build_npx.sas")
    assert r.returncode == 0
    assert (tmp_path / "argv.txt").read_text().split() == [
        "-log", "logs/build_npx.log", "-print", "logs/build_npx.lst", "dir/build_npx.sas"]
    r = run_sas(tmp_path, "build_npx.sas", "07")
    assert (tmp_path / "argv.txt").read_text().split() == [
        "-sysparm", "07", "-log", "logs/build_npx-07.log", "-print", "logs/build_npx-07.lst",
        "build_npx.sas"]
