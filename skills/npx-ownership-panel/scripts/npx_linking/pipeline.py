"""End-to-end runner for the NPX <-> CRSP linking chain.

The four builders are validated, committed and *procedural* — they execute at
import time and are meant to be run as scripts. This module does not rewrite
them. It declares the dependency order, runs them as subprocesses, and adds the
two things a reusable asset needs and a sequence of scripts does not:

* :func:`run_all` — one call (or ``python -m scripts.linking run``) that
  rebuilds every master from the raw inputs, in order, with the chain's own
  invariants asserted between stages;
* :func:`verify` — a **sandboxed** re-run into a shadow project root, so the
  committed masters can be reproduced and diffed without being overwritten.

The shadow root is what makes the sandbox work with no builder changes. Every
path in `config_obs` is derived from ``Path(__file__).resolve().parents[2]``,
and `build_sec_series_master.py` derives its own the same way — so copying
`config_obs.py` and the builders into ``<sandbox>/scripts/...`` relocates the
entire output tree automatically. Read-only inputs are symlinked back to the
real `data/`, and the chain's own outputs are written fresh.
"""
import hashlib
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import polars as pl

from ._config import CIT_DIR, LINKING_DIR, PROJ, cfg

__all__ = ["Stage", "STAGES", "stage", "run_stage", "run_all", "fingerprint",
           "fingerprints", "verify"]


@dataclass(frozen=True)
class Stage:
    """One builder in the chain."""
    key: str
    script: str
    title: str
    inputs: tuple = ()
    outputs: tuple = ()
    approx_seconds: int = 60
    notes: str = ""

    @property
    def path(self):
        return LINKING_DIR / self.script


STAGES = (
    Stage(
        key="header_series_master",
        script="build_header_series_master.py",
        title="L2a-headers — the pre-2010 series vocabulary (OPTIONAL)",
        inputs=("data/raw/forty_act_series.tsv",),
        outputs=("header_series_names.parquet",),
        approx_seconds=30,
        notes=("The SEC Series/Class report is a snapshot of THEN-ACTIVE "
               "registrants from 2010, so a fund that died before it is in no "
               "vintage. Series IDs were mandatory from 2006-02-06 and every "
               "40-Act filing carries the block in its SGML header. Measured "
               "2026-08-28 over 224,103 filings 2006-2009: 2,889 series absent "
               "from every SEC vintage, 2,754 of them open-end. OPTIONAL — its "
               "input comes from skills/wrds/scripts/scan_headers over "
               "/wrds/sec/archives, so it needs the grid; absent the TSV the "
               "chain builds as before, one vocabulary source lighter."),
    ),
    Stage(
        key="sec_master",
        script="build_sec_series_master.py",
        title="L2a — consolidate the SEC Series/Class annual masters",
        inputs=("data/raw/sec_series_class/investment_company_series_class_*.csv",),
        outputs=("sec_series_master.parquet", "sec_series_master_series.parquet",
                 "sec_series_names_long.parquet"),
        approx_seconds=30,
        notes=("15 annual CSVs, 2010-2025 (2016 is absent from the SEC page), in "
               "five different schemas. Snapshots of then-active registrants: a "
               "fund liquidated before 2010 is absent entirely."),
    ),
    Stage(
        key="fundid_seriesid",
        script="build_fundid_seriesid.py",
        title="L2 — resolve every ISS fundid to a SEC seriesId",
        inputs=("npx_seriesid.parquet", "npx.parquet",
                "sec_series_names_long.parquet", "sec_series_master_series.parquet",
                "crsp_cik_map.parquet", "fund_summary2.parquet"),
        outputs=("fundid_seriesid.parquet",),
        approx_seconds=90,
        notes=("Tier ladder iss_seriesid -> propagated -> cik_scoped_name -> "
               "inst_scoped_name -> crsp_name -> global_name. fundid and seriesId "
               "are both time-invariant, so this is a per-fund resolution applied "
               "across all 21 years, never a per-year match."),
    ),
    Stage(
        key="npx_crsp_link",
        script="build_npx_crsp_link.py",
        title="L3 — attach crsp_fundno, index_fund_flag, tna_latest, block",
        inputs=("fundid_seriesid.parquet", "crsp_cik_map.parquet",
                "fund_summary2.parquet", "mflink1_cache.parquet",
                "npx_seriesid.parquet"),
        outputs=("npx_crsp_link.parquet",),
        approx_seconds=120,
        notes=("seriesId -> crsp_cik_map -> fund_summary2, plus a ticker tier and "
               "two scoped/global CRSP name tiers. Collapses CRSP share classes to "
               "the fund before emitting (TNA summed, flag modal)."),
    ),
    Stage(
        key="npx_crsp_link_gap",
        script="build_npx_crsp_link_gap.py",
        title="L3b — the feeder_master_name tier (UPDATES npx_crsp_link in place)",
        inputs=("npx_crsp_link.parquet", "fund_summary2.parquet",
                "npx_seriesid.parquet"),
        outputs=("npx_crsp_link.parquet",),
        approx_seconds=300,
        notes=("Matches an ISS master's name to its CRSP feeder at a 0.97 IDENTITY "
               "bar, under a hard cross-family veto with an ID-attested succession "
               "exception. Rewrites npx_crsp_link.parquet in place: same rows, same "
               "columns, 0 pre-existing links altered (all asserted)."),
    ),
    Stage(
        key="npx_crsp_link_gap2",
        script="build_npx_crsp_link_gap2.py",
        title="L3c — the digit_split_name tier (UPDATES npx_crsp_link in place)",
        inputs=("npx_crsp_link.parquet", "crsp_cik_map.parquet",
                "fundid_seriesid.parquet", "fund_summary2.parquet",
                "mflink1_cache.parquet"),
        outputs=("npx_crsp_link.parquet",),
        approx_seconds=300,
        notes=("L3b's engine with one change: a boundary is inserted at every "
               "alpha<->digit transition on both corpora before tokenising, so "
               "ISS 'RUSSELL 2000' and CRSP 'Russell2000' stop failing the "
               "digit-token guard. 6 fundids / 319,391 vote rows, +0.23pp."),
    ),
    Stage(
        key="npx_crsp_link_ticker",
        script="build_npx_crsp_link_ticker.py",
        title="L3d — the via_sec_ticker tier (UPDATES npx_crsp_link in place)",
        inputs=("npx_crsp_link.parquet", "crsp_cik_map.parquet",
                "fundid_seriesid.parquet", "fund_summary2.parquet",
                "sec_series_names_long.parquet", "mflink1_cache.parquet"),
        outputs=("npx_crsp_link.parquet",),
        approx_seconds=180,
        notes=("Exact-ID route seriesid -> SEC class_ticker -> fund_summary2.ticker "
               "-> crsp_fundno, bypassing crsp_cik_map for Gap A. 172 fundids / "
               "402,176 vote rows, +0.28pp. REFUSES to run if npx_crsp_link "
               "already carries via_sec_ticker links, so re-running the chain "
               "over the committed master aborts here by design — a sandboxed "
               "`verify` rebuilds the master from L3 and passes the guard."),
    ),
)

STAGE_BY_KEY = {s.key: s for s in STAGES}

# The masters this chain produces. Anything else under data/processed is a
# read-only input and is symlinked, not rebuilt, when running sandboxed.
CHAIN_OUTPUTS = tuple(dict.fromkeys(o for s in STAGES for o in s.outputs))

# The three masters a verification run must reproduce exactly, and the key
# columns whose sorted content is checksummed.
MASTER_KEYS = {
    "sec_series_master_series.parquet": ["series_id", "series_name", "cik"],
    "fundid_seriesid.parquet": ["fundid", "seriesid", "match_tier"],
    "npx_crsp_link.parquet": ["fundid", "seriesid", "crsp_fundno", "block",
                              "match_tier", "crsp_match_tier"],
}


def stage(key):
    """Look a stage up by key, with a useful error."""
    try:
        return STAGE_BY_KEY[key]
    except KeyError:
        raise KeyError(f"unknown stage {key!r}; expected one of "
                       f"{', '.join(STAGE_BY_KEY)}") from None


# ---------------------------------------------------------------------------
# running
# ---------------------------------------------------------------------------
def run_stage(key, root=None, python=None, capture=False, env=None):
    """Run one builder. `root` selects a shadow project root (see :func:`verify`)."""
    st = stage(key)
    root = Path(root) if root else PROJ
    script = root / "scripts" / "linking" / st.script
    python = python or sys.executable
    run_env = dict(os.environ, **(env or {}))

    t0 = time.time()
    print(f"\n{'#' * 78}\n# {st.key}: {st.title}\n#   {script}\n{'#' * 78}", flush=True)
    proc = subprocess.run(
        [python, str(script)], cwd=str(root), env=run_env,
        capture_output=capture, text=True,
    )
    elapsed = time.time() - t0
    if proc.returncode != 0:
        if capture:
            sys.stderr.write(proc.stdout or "")
            sys.stderr.write(proc.stderr or "")
        raise RuntimeError(f"stage {st.key} failed (exit {proc.returncode})")
    print(f"# {st.key} done in {elapsed:,.0f}s", flush=True)
    return proc


def run_all(stages=None, root=None, python=None, capture=False, env=None):
    """Rebuild the whole chain in dependency order.

    >>> from scripts.linking import run_all
    >>> run_all()                                  # everything
    >>> run_all(stages=["npx_crsp_link", "npx_crsp_link_gap"])   # from L3 on
    """
    keys = [s.key for s in STAGES] if stages is None else list(stages)
    for k in keys:
        stage(k)  # validate before running anything
    t0 = time.time()
    for k in keys:
        run_stage(k, root=root, python=python, capture=capture, env=env)
    print(f"\nchain complete: {len(keys)} stage(s) in {time.time() - t0:,.0f}s")
    return fingerprints(root=root)


# ---------------------------------------------------------------------------
# fingerprints
# ---------------------------------------------------------------------------
def fingerprint(path, keys=None):
    """Row count + a checksum of the sorted key columns of a parquet master."""
    path = Path(path)
    if not path.exists():
        return {"path": str(path), "exists": False}
    df = pl.read_parquet(path)
    keys = keys or MASTER_KEYS.get(path.name) or df.columns[:3]
    keys = [k for k in keys if k in df.columns]
    lines = (df.select(keys).sort(keys)
             .with_columns(pl.all().cast(pl.Utf8).fill_null("<NULL>"))
             .select(pl.concat_str(keys, separator="\x1f").alias("k"))["k"]
             .to_list())
    h = hashlib.sha256()
    for line in lines:
        h.update(line.encode())
        h.update(b"\n")
    return {
        "path": str(path),
        "exists": True,
        "rows": df.height,
        "cols": df.width,
        "keys": keys,
        "sha256": h.hexdigest(),
    }


def fingerprints(root=None, names=None):
    """Fingerprint every master, under `root` (defaults to the real project)."""
    root = Path(root) if root else PROJ
    proc = root / "data" / "processed"
    names = names or list(MASTER_KEYS)
    return {n: fingerprint(proc / n) for n in names}


# Float columns are summed over a fund's CRSP share classes, and floating-point
# addition is not associative — a different grouping order gives a different
# last bit. Content equality on floats is therefore checked to a relative
# tolerance rather than exactly. 1e-9 is ~7 orders of magnitude looser than the
# observed 2.2e-16 and still far tighter than any economically meaningful
# difference in a $-millions TNA.
FLOAT_RTOL = 1e-9


def compare_frames(path_a, path_b, sort_key="fundid", rtol=FLOAT_RTOL):
    """Full-column comparison of two parquet masters.

    Returns a dict with `equal` (exact, order-sensitive), `equal_sorted`
    (exact after sorting on `sort_key`), `equal_within_tol` (float columns
    compared to `rtol`) and, when they differ, the offending columns.
    """
    a, b = pl.read_parquet(path_a), pl.read_parquet(path_b)
    out = {"a": str(path_a), "b": str(path_b),
           "rows_a": a.height, "rows_b": b.height,
           "schema_equal": a.schema == b.schema}
    if not out["schema_equal"] or a.height != b.height:
        out.update(equal=False, equal_sorted=False, equal_within_tol=False)
        return out

    out["equal"] = a.equals(b)
    key = sort_key if sort_key in a.columns else a.columns[0]
    out["row_order_stable"] = a[key].equals(b[key])
    a, b = a.sort(key), b.sort(key)
    out["equal_sorted"] = a.equals(b)

    diffs, worst = {}, 0.0
    for c in a.columns:
        sa, sb = a[c], b[c]
        if sa.equals(sb):
            continue
        if sa.dtype.is_float():
            x = sa.fill_null(0.0).to_numpy()
            y = sb.fill_null(0.0).to_numpy()
            denom = np.maximum(np.abs(x), 1e-30)
            d = np.abs(x - y) / denom
            rel = float(d.max()) if d.size else 0.0
            worst = max(worst, rel)
            diffs[c] = {"kind": "float", "n": int((d > 0).sum()), "max_rel": rel,
                        "within_tol": rel <= rtol}
        else:
            m = ~((sa == sb) | (sa.is_null() & sb.is_null()))
            diffs[c] = {"kind": "exact", "n": int(m.sum()), "within_tol": False}
    out["diff_columns"] = diffs
    out["max_rel_float_diff"] = worst
    out["equal_within_tol"] = all(d.get("within_tol") for d in diffs.values())
    return out


# ---------------------------------------------------------------------------
# sandboxed verification
# ---------------------------------------------------------------------------
def _build_shadow_root(sandbox):
    """Materialise a shadow project root that writes nowhere real.

    `config_obs.py` and `build_sec_series_master.py` both derive every path from
    ``Path(__file__).resolve().parents[2]``, so COPYING them (a symlink would
    resolve back to the real tree) relocates the whole output tree. Read-only
    inputs are symlinked back; the chain's own outputs start absent.
    """
    sandbox = Path(sandbox)
    if sandbox.exists():
        shutil.rmtree(sandbox)
    (sandbox / "scripts" / "cit").mkdir(parents=True)
    (sandbox / "scripts" / "linking").mkdir(parents=True)
    (sandbox / "data").mkdir(parents=True)
    (sandbox / "data" / "processed").mkdir()
    (sandbox / "data" / "output").mkdir()

    shutil.copy2(CIT_DIR / "config_obs.py", sandbox / "scripts" / "cit" / "config_obs.py")
    for st in STAGES:
        shutil.copy2(st.path, sandbox / "scripts" / "linking" / st.script)

    (sandbox / "data" / "raw").symlink_to(PROJ / "data" / "raw")
    real_proc = PROJ / "data" / "processed"
    for src in sorted(real_proc.glob("*.parquet")):
        if src.name in CHAIN_OUTPUTS:
            continue  # the chain rebuilds these; start from nothing
        (sandbox / "data" / "processed" / src.name).symlink_to(src.resolve())
    return sandbox


def compare_against(sandbox, names=None, rtol=FLOAT_RTOL, verbose=True):
    """Diff every chain output under `sandbox` against the committed masters.

    Reported per master: the key-column checksum, whether the frames are equal
    exactly, and — when they are not — which columns differ and by how much.
    A float column that differs only within `rtol` counts as reproduced.

    A master the sandbox never produced (``verify --only sec_master``, or a
    stage that did not run) is **not** silently passed over: it is recorded with
    ``skipped=True`` and forces the returned flag to False. "Nothing was
    compared" and "everything compared matched" must not share a return value.
    """
    sandbox = Path(sandbox)
    names = names or list(CHAIN_OUTPUTS)
    rows, ok_all = [], True
    compared, skipped = [], []
    if verbose:
        print(f"\n{'=' * 78}\nVERIFY — committed vs sandbox rebuild\n{'=' * 78}")
    for name in names:
        a_path = PROJ / "data" / "processed" / name
        b_path = sandbox / "data" / "processed" / name
        if not b_path.exists():
            skipped.append(name)
            ok_all = False
            rows.append({"name": name, "skipped": True, "ok": False,
                         "reason": "not produced by this sandbox run"})
            if verbose:
                print(f"  [SKIP  ] {name} — not rebuilt in this run, NOT verified")
            continue
        compared.append(name)
        fa, fb = fingerprint(a_path), fingerprint(b_path)
        key_ok = (fa.get("exists") and fb.get("exists")
                  and fa["rows"] == fb["rows"] and fa["sha256"] == fb["sha256"])
        cmp = compare_frames(a_path, b_path, rtol=rtol)
        ok = bool(key_ok) and cmp["equal_within_tol"]
        ok_all &= ok
        rows.append({"name": name, "skipped": False,
                     "key_checksum_match": bool(key_ok),
                     "committed": fa, "rebuilt": fb, "compare": cmp, "ok": ok})
        if verbose:
            n_a = f"{fa['rows']:,}" if fa.get("exists") else "ABSENT"
            n_b = f"{fb['rows']:,}" if fb.get("exists") else "ABSENT"
            print(f"  [{'MATCH ' if ok else 'DIFFER'}] {name}")
            print(f"      rows {n_a} vs {n_b} · "
                  f"key sha {str(fa.get('sha256'))[:16]} vs {str(fb.get('sha256'))[:16]}")
            print(f"      frames equal exactly: {cmp['equal']}"
                  f" · after sorting: {cmp['equal_sorted']}"
                  f" · row order stable: {cmp['row_order_stable']}")
            for col, d in (cmp.get("diff_columns") or {}).items():
                if d["kind"] == "float":
                    print(f"      float column {col!r}: {d['n']:,} rows differ, "
                          f"max relative {d['max_rel']:.2e} "
                          f"({'within' if d['within_tol'] else 'OUTSIDE'} tol {rtol:.0e})")
                else:
                    print(f"      column {col!r}: {d['n']:,} rows differ (exact dtype)")

    n_bad = sum(1 for r in rows if not r.get("skipped") and not r["ok"])
    if verbose:
        print(f"\n  verified {len(compared)} of {len(names)} chain outputs: "
              f"{', '.join(compared) or '(none)'}")
        if skipped:
            print(f"  NOT verified ({len(skipped)}): {', '.join(skipped)}")
            print("  STATUS: PARTIAL — this run did not reproduce the whole "
                  "chain, so it cannot attest that the masters are unchanged.")
        elif n_bad:
            print(f"  STATUS: DIVERGENCE — {n_bad} master(s) differ.")
        else:
            print("  STATUS: OK — every chain output reproduced.")
    return ok_all, rows


def verify(sandbox=None, stages=None, python=None, keep=False, capture=True,
           rtol=FLOAT_RTOL):
    """Re-run the chain into a sandbox and diff against the committed masters.

    Never writes to `data/processed`. Returns ``(all_reproduced, rows)``, where
    `all_reproduced` is True only when EVERY chain output was rebuilt in the
    sandbox and matched. A subset run (`stages=[...]`) leaves the rest
    unverified and therefore returns False — see :func:`compare_against`.
    """
    sandbox = Path(sandbox or (PROJ / "scratch" / "l4_verify_sandbox"))
    sandbox.parent.mkdir(parents=True, exist_ok=True)
    before = fingerprints()
    print(f"shadow root: {sandbox}")
    _build_shadow_root(sandbox)
    run_all(stages=stages, root=sandbox, python=python, capture=capture)

    ok_all, rows = compare_against(sandbox, rtol=rtol)

    # The committed masters must not have been touched by the run.
    now = fingerprints()
    untouched = all(now[n].get("sha256") == before[n].get("sha256") for n in MASTER_KEYS)
    print(f"\n  committed masters untouched by the verification run: {untouched}")
    assert untouched, "the verification run modified data/processed — this is a bug"

    if not keep and sandbox.exists():
        shutil.rmtree(sandbox)
        print(f"  sandbox removed: {sandbox}")
    return ok_all, rows
