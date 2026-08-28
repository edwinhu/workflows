"""Red suite for the canonical EDGAR record-table parquet converter.

Authored with the plan, before dispatch. No task may edit this file.
"""

from __future__ import annotations

import gzip
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import edgar_parquet as ep
from parsers import PARSERS

SCRIPTS_ROOT = Path(__file__).resolve().parent.parent


def cols(key: str) -> list[str]:
    spec = PARSERS[key]
    return ep.go_columns(SCRIPTS_ROOT / spec.types_go, spec.columns_var)


def write_tsv(path: Path, rows: list[list[str]]) -> None:
    body = "\n".join("\t".join(r) for r in rows) + "\n"
    if path.name.endswith(".gz"):
        path.write_bytes(gzip.compress(body.encode()))
    else:
        path.write_text(body)


def row_for(key: str, **over) -> list[str]:
    """A syntactically valid row: every column filled with a plausible value."""
    spec = PARSERS[key]
    out = []
    for c in cols(key):
        if c in over:
            out.append(over[c])
        elif c in spec.int_columns:
            out.append("100")
        elif c in spec.float_columns:
            out.append("66301.000000")
        elif c in spec.bool_columns:
            out.append("true")
        elif c == spec.year_column:
            out.append("20250630")
        else:
            out.append(f"v_{c}")
    return out


# --------------------------------------------------------------------------
# The anti-drift mechanism: the column order is READ from Go, never restated.
# --------------------------------------------------------------------------

def test_go_columns_reads_live_from_source(tmp_path):
    """A changed Go source must change the answer, or it is hard-coded."""
    src = tmp_path / "types.go"
    src.write_text(
        "package main\n\n"
        "var otherColumns = []string{\n\t\"decoy_a\", \"decoy_b\",\n}\n\n"
        "// comment line\n"
        "var wantedColumns = []string{\n"
        "\t\"alpha\", \"beta\",\n"
        "\t\"gamma\",\n"
        "}\n\n"
        "var trailingColumns = []string{\n\t\"zzz\",\n}\n"
    )
    assert ep.go_columns(src, "wantedColumns") == ["alpha", "beta", "gamma"]
    assert ep.go_columns(src, "otherColumns") == ["decoy_a", "decoy_b"]


def test_go_columns_missing_var_is_an_error(tmp_path):
    src = tmp_path / "types.go"
    src.write_text("package main\n\nvar someColumns = []string{\n\t\"a\",\n}\n")
    with pytest.raises(Exception):
        ep.go_columns(src, "noSuchColumns")


def test_go_columns_match_the_real_parsers():
    c13 = cols("13f")
    assert len(c13) == 23, f"13F column count changed: {len(c13)}"
    assert c13[0] == "filepath" and c13[-1] == "parse_mode"
    for name in ("value", "shares", "cusip_valid", "period_of_report"):
        assert name in c13

    cnpx = cols("npx")
    assert len(cnpx) == 32, f"N-PX column count changed: {len(cnpx)}"
    assert cnpx[0] == "filepath" and cnpx[-1] == "layout"
    for name in ("series_id", "class_ids", "cusip", "meeting_date", "how_voted"):
        assert name in cnpx


def test_every_typed_column_exists_in_its_parser():
    """A typing-table entry naming a column the Go schema lacks is silent dead config."""
    for key, spec in PARSERS.items():
        have = set(cols(key))
        declared = spec.int_columns | spec.float_columns | spec.bool_columns | {spec.year_column}
        assert declared <= have, f"{key}: typing table names unknown columns {declared - have}"


# --------------------------------------------------------------------------
# Partition key validation: holdings_13f/ has a `year=3006` because nothing checked.
# --------------------------------------------------------------------------

@pytest.mark.parametrize("value,expect", [
    ("20250630", 2025),
    ("19931231", 1993),
    ("30061231", None),
    ("18000101", None),
    ("", None),
    ("garbage", None),
    ("2025", None),
])
def test_year_of(value, expect):
    assert ep.year_of(value) == expect


def test_bad_year_is_quarantined_not_partitioned(tmp_path):
    spec = PARSERS["npx"]
    src = tmp_path / "in.tsv.gz"
    write_tsv(src, [
        row_for("npx", period_of_report="20250630"),
        row_for("npx", period_of_report="30061231"),
    ])
    out = tmp_path / "out"
    q = tmp_path / "quarantine"
    stats = ep.convert([src], spec, out, SCRIPTS_ROOT, quarantine=q)

    assert not (out / "year=3006").exists(), "a corrupt period_of_report minted a partition"
    assert (out / "year=2025").exists()
    assert stats["quarantined"] == 1
    assert stats["rows"] == 1
    assert q.exists() and any(q.iterdir()), "the quarantined row was dropped rather than kept"


# --------------------------------------------------------------------------
# Field-count safety: a headerless TSV mis-assigns silently if arity drifts.
# --------------------------------------------------------------------------

def test_field_count_mismatch_is_an_error(tmp_path):
    spec = PARSERS["npx"]
    src = tmp_path / "in.tsv.gz"
    short = row_for("npx")[:-3]
    write_tsv(src, [row_for("npx"), short])
    with pytest.raises(Exception):
        ep.convert([src], spec, tmp_path / "out", SCRIPTS_ROOT)


# --------------------------------------------------------------------------
# Round trips: the contract, per parser.
# --------------------------------------------------------------------------

def test_convert_13f_roundtrip(tmp_path):
    pa = pytest.importorskip("pyarrow")
    pq = pytest.importorskip("pyarrow.parquet")
    spec = PARSERS["13f"]
    src = tmp_path / "shard.tsv.gz"
    write_tsv(src, [
        row_for("13f", period_of_report="20250331"),
        row_for("13f", period_of_report="20250630"),
        row_for("13f", period_of_report="20250630"),
    ])
    out = tmp_path / "out"
    stats = ep.convert([src], spec, out, SCRIPTS_ROOT)

    assert stats["rows"] == 3
    assert (out / "year=2025" / "Q1.parquet").exists(), "13F must sub-split by quarter"
    assert (out / "year=2025" / "Q2.parquet").exists()

    t = pq.read_table(out / "year=2025" / "Q2.parquet")
    assert t.num_rows == 2
    assert t.column_names == cols("13f"), "parquet columns must be a 1:1 passthrough of the Go order"
    schema = {f.name: f.type for f in t.schema}
    for c in spec.int_columns:
        assert pa.types.is_integer(schema[c]), f"{c} should be int64, got {schema[c]}"
    for c in spec.bool_columns:
        assert pa.types.is_boolean(schema[c]), f"{c} should be bool, got {schema[c]}"
    assert pa.types.is_string(schema["period_of_report"]) or \
        pa.types.is_large_string(schema["period_of_report"]), \
        "dates stay strings, matching the existing holdings_13f dataset"


def test_convert_npx_roundtrip(tmp_path):
    pa = pytest.importorskip("pyarrow")
    pq = pytest.importorskip("pyarrow.parquet")
    spec = PARSERS["npx"]
    src = tmp_path / "shard.tsv.gz"
    write_tsv(src, [row_for("npx"), row_for("npx"), row_for("npx")])
    out = tmp_path / "out"
    stats = ep.convert([src], spec, out, SCRIPTS_ROOT)

    assert stats["rows"] == 3
    year_dir = out / "year=2025"
    assert year_dir.exists()
    files = sorted(year_dir.glob("*.parquet"))
    assert files, "no parquet written"
    assert not list(year_dir.glob("Q*.parquet")), \
        "N-PX is an annual report; there is no quarter to sub-split on"

    t = pq.read_table(files[0])
    assert t.num_rows == 3
    assert t.column_names == cols("npx")
    schema = {f.name: f.type for f in t.schema}
    for c in spec.float_columns:
        assert pa.types.is_floating(schema[c]), \
            f"{c} must be float64 -- real N-PX share counts are decimal (66301.000000)"


def test_convert_is_zstd(tmp_path):
    pq = pytest.importorskip("pyarrow.parquet")
    spec = PARSERS["npx"]
    src = tmp_path / "shard.tsv.gz"
    write_tsv(src, [row_for("npx")])
    out = tmp_path / "out"
    ep.convert([src], spec, out, SCRIPTS_ROOT)
    f = next((out / "year=2025").glob("*.parquet"))
    meta = pq.ParquetFile(f).metadata
    assert meta.row_group(0).column(0).compression.upper() == "ZSTD", \
        "the existing holdings_13f dataset is ZSTD; match it"


def test_manifest_converts_separately(tmp_path):
    pq = pytest.importorskip("pyarrow.parquet")
    spec = PARSERS["npx"]
    # manifest columns are the Go manifestColumns, not the vote columns
    man_cols = ep.go_columns(SCRIPTS_ROOT / spec.types_go, "manifestColumns")
    assert man_cols[0] == "filepath" and "n_rows" in man_cols
    src = tmp_path / "manifest.tsv.gz"
    write_tsv(src, [["v_" + c if c != "n_rows" else "7" for c in man_cols]])
    out = tmp_path / "manifest.parquet"
    stats = ep.convert_manifest([src], spec, out, SCRIPTS_ROOT)
    assert stats["rows"] == 1
    t = pq.read_table(out)
    assert t.column_names == man_cols
    assert t.num_rows == 1


def test_multiple_shards_merge_into_one_dataset(tmp_path):
    pq = pytest.importorskip("pyarrow.parquet")
    spec = PARSERS["npx"]
    a, b = tmp_path / "a.tsv.gz", tmp_path / "b.tsv.gz"
    write_tsv(a, [row_for("npx"), row_for("npx")])
    write_tsv(b, [row_for("npx")])
    out = tmp_path / "out"
    stats = ep.convert([a, b], spec, out, SCRIPTS_ROOT)
    assert stats["rows"] == 3, "shards must merge; the grid produces N of them"
    total = sum(pq.read_table(f).num_rows for f in (out / "year=2025").glob("*.parquet"))
    assert total == 3


# --------------------------------------------------------------------------
# The CLI contract, exercised rather than merely documented.
# --------------------------------------------------------------------------

def test_cli_contract(tmp_path):
    """The invocation the reference documents must actually work."""
    import subprocess
    pq = pytest.importorskip("pyarrow.parquet")

    src = tmp_path / "shard.tsv.gz"
    write_tsv(src, [row_for("npx"), row_for("npx")])
    out = tmp_path / "votes_npx"
    man_src = tmp_path / "manifest.tsv.gz"
    man_cols = ep.go_columns(SCRIPTS_ROOT / PARSERS["npx"].types_go, "manifestColumns")
    write_tsv(man_src, [["v_" + c if c != "n_rows" else "2" for c in man_cols]])
    man_out = tmp_path / "parse_npx_manifest.parquet"

    cli = Path(__file__).resolve().parent / "cli.py"
    r = subprocess.run(
        [sys.executable, str(cli),
         "--parser", "npx", "--in", str(src), "--out", str(out),
         "--manifest-in", str(man_src), "--manifest-out", str(man_out),
         "--quarantine", str(tmp_path / "q")],
        capture_output=True, text=True,
    )
    assert r.returncode == 0, f"CLI failed:\nstdout={r.stdout}\nstderr={r.stderr}"
    assert (out / "year=2025").exists(), f"no dataset written; stdout={r.stdout}"
    assert man_out.exists(), "manifest parquet not written"
    assert pq.read_table(man_out).num_rows == 1


def test_cli_rejects_unknown_parser(tmp_path):
    import subprocess
    cli = Path(__file__).resolve().parent / "cli.py"
    r = subprocess.run(
        [sys.executable, str(cli), "--parser", "nope", "--in", str(tmp_path), "--out", str(tmp_path)],
        capture_output=True, text=True,
    )
    assert r.returncode != 0, "an unknown --parser must be rejected"


def _run_cli(*args) -> "subprocess.CompletedProcess":
    import subprocess
    cli = Path(__file__).resolve().parent / "cli.py"
    return subprocess.run([sys.executable, str(cli), *args], capture_output=True, text=True)


def test_cli_accepts_a_directory(tmp_path):
    """The grid writes N shards into one output directory; --in must take that directory."""
    pq = pytest.importorskip("pyarrow.parquet")
    shards = tmp_path / "shards"
    shards.mkdir()
    write_tsv(shards / "a.tsv.gz", [row_for("npx"), row_for("npx")])
    write_tsv(shards / "b.tsv.gz", [row_for("npx")])
    write_tsv(shards / "plain.tsv", [row_for("npx")])
    (shards / "notes.md").write_text("not a shard\n")
    (shards / "run.log").write_text("not a shard\n")

    out = tmp_path / "out"
    r = _run_cli("--parser", "npx", "--in", str(shards), "--out", str(out))
    assert r.returncode == 0, f"stdout={r.stdout}\nstderr={r.stderr}"
    total = sum(pq.read_table(f).num_rows for f in (out / "year=2025").glob("*.parquet"))
    assert total == 4, f"directory expansion picked up {total} rows, want 4 (3 gz/tsv shards, non-shards ignored)"


def test_cli_accepts_a_glob(tmp_path):
    """This is the form the reference tells a reader to copy."""
    pq = pytest.importorskip("pyarrow.parquet")
    shards = tmp_path / "shards"
    shards.mkdir()
    write_tsv(shards / "holdings_001.tsv.gz", [row_for("npx")])
    write_tsv(shards / "holdings_002.tsv.gz", [row_for("npx")])
    write_tsv(shards / "other_001.tsv.gz", [row_for("npx")])

    out = tmp_path / "out"
    r = _run_cli("--parser", "npx", "--in", str(shards / "holdings_*.tsv.gz"), "--out", str(out))
    assert r.returncode == 0, f"stdout={r.stdout}\nstderr={r.stderr}"
    total = sum(pq.read_table(f).num_rows for f in (out / "year=2025").glob("*.parquet"))
    assert total == 2, f"glob matched {total} rows, want 2 -- the third shard must not be swept in"


def test_cli_errors_when_nothing_matches(tmp_path):
    """A silently empty input is a silently empty panel."""
    r = _run_cli("--parser", "npx", "--in", str(tmp_path / "nope_*.tsv.gz"),
                 "--out", str(tmp_path / "out"))
    assert r.returncode != 0, "a pattern matching no shards must fail, not produce an empty dataset"
    assert "no TSV shards matched" in (r.stderr + r.stdout)


def test_cli_empty_directory_errors(tmp_path):
    empty = tmp_path / "empty"
    empty.mkdir()
    r = _run_cli("--parser", "npx", "--in", str(empty), "--out", str(tmp_path / "out"))
    assert r.returncode != 0, "an input directory holding no shards must fail"


def test_cli_manifest_flags_are_mutually_required(tmp_path):
    src = tmp_path / "s.tsv.gz"
    write_tsv(src, [row_for("npx")])
    r = _run_cli("--parser", "npx", "--in", str(src), "--out", str(tmp_path / "o"),
                 "--manifest-in", str(src))
    assert r.returncode != 0, "--manifest-in without --manifest-out must be rejected"


def test_quarantine_mkdir_is_amortized(tmp_path, monkeypatch):
    """One directory creation per run, not per bad row.

    The 13F corpus is ~89M holdings rows; a bad period_of_report affecting even a
    small fraction of it costs one stat+mkdir syscall per row if this is not
    hoisted. The write path already amortizes its equivalent call per flush.
    """
    spec = PARSERS["npx"]
    src = tmp_path / "in.tsv.gz"
    bad = [row_for("npx", period_of_report="30061231") for _ in range(200)]
    write_tsv(src, [row_for("npx"), *bad])

    real_mkdir = Path.mkdir
    calls = {"n": 0}

    def counting_mkdir(self, *a, **kw):
        calls["n"] += 1
        return real_mkdir(self, *a, **kw)

    monkeypatch.setattr(Path, "mkdir", counting_mkdir)
    stats = ep.convert([src], spec, tmp_path / "out", SCRIPTS_ROOT,
                       quarantine=tmp_path / "q")

    assert stats["quarantined"] == 200
    assert calls["n"] < 50, (
        f"Path.mkdir called {calls['n']} times for 200 quarantined rows; "
        "directory creation must be amortized, not per-row"
    )
