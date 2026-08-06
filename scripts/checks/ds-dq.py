#!/usr/bin/env python3
"""Compute the mechanical DS data-quality checks over an approved plan's declared outputs.

WHY THIS EXISTS
    The thirteen checks in skills/ds-verify/references/ds-checks.md had NO runner anywhere in
    scripts/checks/. Every one of them was evaluated by the model reading the analysis code and
    reporting what it believed it saw -- and ENUM, the check whose entire job is "every applicable
    check ran or is N/A with a reason", was therefore the model certifying its own enumeration. A
    check that is simply absent from the output looks exactly like one that ran clean, so an
    analysis could pass verification having computed nothing at all. Worse, the /ds VERIFY step
    lived INSIDE ds-implement, so the agent that wrote the pipeline also graded it.

    This runner removes the self-certification from the checks a machine can settle. It reads the
    approved plan's `## Data Outputs` table -- the one deterministic table /ds requires -- opens
    each declared artifact, and emits a line per check per output. Every N/A carries a reason THIS
    SCRIPT generated; the model never supplies one. ENUM stops being a claim and becomes an
    assertion the script makes about its own output.

WHAT IT DELIBERATELY DOES NOT DO
    M1, UNI, DEN, DEL and R1 are judgements, not computations. No script can know where a universe
    predicate was supposed to be applied, or whether a reported rate named its denominator in prose.
    They are enumerated in the output with the literal status MODEL-EVALUATED -- never PASS -- so a
    reader cannot mistake a judgement for a computation. A runner that printed PASS for M1 would
    recreate, one layer down, exactly the defect it was written to remove.

NOT A HOOK
    This is a standalone CLI. scripts/checks/hook_output_schema.py governs hook payloads and does
    not apply here. The contract is: JSON on stdout, non-zero exit if any COMPUTED check FAILs, so
    a gate can read the exit code without parsing.

USAGE
    ds-dq.py --plan .planning/<plan>.md [--project-dir DIR]
    ds-dq.py --output data/panel.parquet --grain "firm-year" --keys "gvkey,fyear" \
             --window "datadate: 2005-01-01..2025-12-31"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# The matrix in skills/ds-verify/references/ds-checks.md, in matrix order. ENUM asserts that a line
# was emitted for every ID here -- that is the whole point of computing ENUM rather than claiming it.
MATRIX = ["DQ1", "DQ2", "DQ3", "DQ4", "DQ5", "DQ6", "COV", "R1", "M1", "UNI", "DEN", "DEL", "ENUM"]

# Checks no script can settle. Reported as MODEL-EVALUATED, never PASS/FAIL/N/A.
MODEL_EVALUATED = {
    "R1": "Fresh re-run reproducibility: requires executing the analysis twice, which this runner does not do.",
    "M1": "Approved-plan criterion compliance: requires reading the plan's criteria against the outputs.",
    "UNI": "Universe agreement: requires knowing where the universe predicate was meant to be applied.",
    "DEN": "Every reported rate states its denominator: a property of the reported prose, not the artifact.",
    "DEL": "Coverage improved because the base shrank: requires the before/after pair and its bases.",
}

HIGH_NULL_THRESHOLD = 0.5
NEAR_UNIQUE_RATIO = 0.9


def result(status: str, detail: str, evidence: str = "") -> dict:
    """One check line. `reason_source` records WHO wrote `detail` -- always this script."""
    return {
        "status": status,
        "detail": detail,
        "evidence": evidence,
        "reason_source": "runner",
    }


def model_line(check: str) -> dict:
    return {
        "status": "MODEL-EVALUATED",
        "detail": MODEL_EVALUATED[check],
        "evidence": "",
        "reason_source": "model-required",
    }


# --------------------------------------------------------------------------------------------
# Plan parsing
# --------------------------------------------------------------------------------------------

REQUIRED_HEADERS = ["path", "grain", "key columns", "required window"]


def _split_row(line: str) -> list[str]:
    cells = line.strip().strip("|").split("|")
    return [c.strip() for c in cells]


def parse_data_outputs(plan_text: str) -> list[dict]:
    """Parse the `## Data Outputs` table. Raises ValueError on a malformed or absent table."""
    lines = plan_text.splitlines()
    start = None
    for i, line in enumerate(lines):
        if re.match(r"^\s*##\s+Data Outputs\s*$", line):
            start = i + 1
            break
    if start is None:
        raise ValueError("plan has no `## Data Outputs` section")

    table: list[str] = []
    for line in lines[start:]:
        if re.match(r"^\s*#{1,6}\s", line):
            break
        if line.strip().startswith("|"):
            table.append(line)
        elif table:
            break

    if len(table) < 2:
        raise ValueError("`## Data Outputs` contains no markdown table")

    headers = [h.lower() for h in _split_row(table[0])]
    if headers != REQUIRED_HEADERS:
        raise ValueError(
            "`## Data Outputs` must have exactly the columns "
            f"{' | '.join(h.title() for h in REQUIRED_HEADERS)}; found {' | '.join(headers)}"
        )

    rows = []
    for line in table[2:]:
        cells = _split_row(line)
        if len(cells) != len(REQUIRED_HEADERS):
            raise ValueError(f"`## Data Outputs` row has {len(cells)} cells, expected 4: {line.strip()}")
        row = dict(zip(REQUIRED_HEADERS, cells))
        if not row["path"]:
            raise ValueError(f"`## Data Outputs` row has an empty Path: {line.strip()}")
        # The report is keyed by Path. Two rows for one Path would overwrite each other, and the
        # SURVIVOR decides the exit code — so a strict declaration that FAILs can disappear behind
        # a later `n/a` one and the gate reads 0. Reject the ambiguity instead of picking a winner.
        if any(existing["path"] == row["path"] for existing in rows):
            raise ValueError(
                f"`## Data Outputs` declares `{row['path']}` more than once. One row per artifact: "
                f"two rows for one path silently collapse to whichever is parsed last."
            )
        rows.append(row)
    if not rows:
        raise ValueError("`## Data Outputs` table has a header but no rows")
    return rows


def parse_keys(spec: str) -> tuple[list[str], list[str]]:
    """`a, b` -> pk only. `pk: a, b; event: c, d` -> pk and business/event key (DQ3c)."""
    spec = (spec or "").strip().strip("`")
    if not spec or spec.lower() in {"n/a", "na", "none"}:
        return [], []
    if ":" not in spec:
        return [c.strip().strip("`") for c in spec.split(",") if c.strip()], []
    pk: list[str] = []
    event: list[str] = []
    for part in spec.split(";"):
        if ":" not in part:
            continue
        label, cols = part.split(":", 1)
        parsed = [c.strip().strip("`") for c in cols.split(",") if c.strip()]
        if label.strip().lower() in {"pk", "key", "primary key"}:
            pk = parsed
        elif label.strip().lower() in {"event", "event key", "business key"}:
            event = parsed
    return pk, event


DATE_RE = r"\d{4}-\d{2}-\d{2}"


def parse_window(spec: str) -> tuple[str | None, str | None, str | None]:
    """`n/a` -> (None, None, None). `[col: ]YYYY-MM-DD..YYYY-MM-DD` -> (col, start, end)."""
    spec = (spec or "").strip().strip("`")
    if not spec or spec.lower() in {"n/a", "na", "none"}:
        return None, None, None
    col = None
    body = spec
    if ":" in spec:
        col, body = spec.split(":", 1)
        col, body = col.strip().strip("`"), body.strip()
    match = re.match(rf"^({DATE_RE})\s*\.\.\s*({DATE_RE})$", body)
    if not match:
        raise ValueError(
            f"Required Window `{spec}` is neither `n/a` nor `[column: ]YYYY-MM-DD..YYYY-MM-DD`"
        )
    return col, match.group(1), match.group(2)


# --------------------------------------------------------------------------------------------
# Checks
# --------------------------------------------------------------------------------------------


def load_frame(path: Path):
    import polars as pl

    suffix = path.suffix.lower()
    if suffix == ".parquet":
        return pl.read_parquet(path)
    if suffix in {".csv", ".tsv", ".txt"}:
        return pl.read_csv(path, separator="\t" if suffix == ".tsv" else ",", try_parse_dates=True)
    raise ValueError(f"unsupported extension `{suffix}` (expected .parquet, .csv, or .tsv)")


def check_dq1(df) -> dict:
    constant = [c for c in df.columns if df[c].n_unique() <= 1]
    if constant:
        return result(
            "FAIL",
            f"{len(constant)} column(s) carry zero information (constant or empty).",
            f"constant columns: {', '.join(constant)}",
        )
    return result("PASS", "No constant or empty columns.", f"{df.width} columns checked")


def check_dq2(df) -> dict:
    height = df.height
    high = [(c, df[c].null_count() / height) for c in df.columns if df[c].null_count() / height > HIGH_NULL_THRESHOLD]
    if high:
        return result(
            "FAIL",
            f"{len(high)} column(s) exceed the >{HIGH_NULL_THRESHOLD:.0%} null threshold.",
            "; ".join(f"{c}={pct:.1%} null" for c, pct in high),
        )
    return result("PASS", f"No column exceeds the >{HIGH_NULL_THRESHOLD:.0%} null threshold.", f"{df.width} columns checked")


def check_dq3(df, pk: list[str], event: list[str]) -> dict[str, dict]:
    """Three levels. DQ3 is NOT a bare all-columns duplicate check -- see ds-checks.md DQ3."""
    lines: dict[str, dict] = {}

    missing_pk = [c for c in pk if c not in df.columns]
    if not pk:
        lines["DQ3a"] = result(
            "N/A",
            "No primary key declared: the plan's Key Columns cell is empty or `n/a`, so PK uniqueness cannot be computed.",
        )
    elif missing_pk:
        lines["DQ3a"] = result(
            "FAIL",
            f"Declared PK column(s) absent from the artifact: {', '.join(missing_pk)}.",
            f"artifact columns: {', '.join(df.columns)}",
        )
    else:
        dupes = int(df.select(pk).is_duplicated().sum())
        lines["DQ3a"] = (
            result("FAIL", f"{dupes} row(s) violate the declared PK ({', '.join(pk)}) — upstream join fan-out?",
                   f"pk={pk} duplicated_rows={dupes} height={df.height}")
            if dupes
            else result("PASS", f"Declared PK ({', '.join(pk)}) is unique.", f"height={df.height}")
        )

    exact = int(df.is_duplicated().sum())
    lines["DQ3b"] = (
        result("FAIL", f"{exact} byte-identical duplicate row(s).", f"height={df.height} exact_dupe_rows={exact}")
        if exact
        else result("PASS", "No byte-identical duplicate rows.", f"height={df.height}")
    )

    missing_event = [c for c in event if c not in df.columns]
    if not event:
        lines["DQ3c"] = result(
            "N/A",
            "No business/event key declared: Key Columns carries no `event:` clause, so amendment/restatement "
            "collisions cannot be computed. Declare it as `pk: a, b; event: c, d`.",
        )
    elif missing_event:
        lines["DQ3c"] = result(
            "FAIL",
            f"Declared event key column(s) absent from the artifact: {', '.join(missing_event)}.",
            f"artifact columns: {', '.join(df.columns)}",
        )
    else:
        collisions = df.group_by(event).len()
        n_collide = int(collisions.filter(collisions["len"] > 1).height)
        lines["DQ3c"] = (
            result("FAIL", f"{n_collide} event key(s) appear more than once — check for amendments/restatements; "
                           "resolve by supersession, not blind drop_duplicates.",
                   f"event={event} colliding_keys={n_collide}")
            if n_collide
            else result("PASS", f"No business/event key collisions on ({', '.join(event)}).", f"height={df.height}")
        )

    failed = [k for k in ("DQ3a", "DQ3b", "DQ3c") if lines[k]["status"] == "FAIL"]
    if failed:
        lines["DQ3"] = result(
            "FAIL",
            f"Grain integrity failed at {', '.join(failed)}.",
            " | ".join(f"{k}: {lines[k]['detail']}" for k in failed),
        )
    elif all(lines[k]["status"] == "N/A" for k in ("DQ3a", "DQ3c")) and lines["DQ3b"]["status"] == "PASS":
        lines["DQ3"] = result(
            "N/A",
            "Only the byte-identical level (DQ3b) was computable: neither a primary key nor an event key was declared.",
            f"DQ3b: {lines['DQ3b']['detail']}",
        )
    else:
        lines["DQ3"] = result(
            "PASS",
            "Grain integrity holds at every computable level.",
            " | ".join(f"{k}={lines[k]['status']}" for k in ("DQ3a", "DQ3b", "DQ3c")),
        )
    return lines


def check_dq4(df) -> dict:
    return result(
        "N/A",
        "Row-count traceability needs the task-local input -> transform -> output chain, which is not "
        "derivable from the finished artifact alone; the runner reports the observed count only.",
        f"observed rows={df.height} columns={df.width}",
    )


def check_dq5(df, pk: list[str], event: list[str]) -> dict:
    import polars as pl

    keys = set(pk) | set(event)
    categorical = [
        c for c in df.columns
        if df.schema[c] in (pl.String, pl.Categorical, pl.Enum) and c not in keys
    ]
    if not categorical:
        return result(
            "N/A",
            "No non-key string/categorical column to check for suspicious cardinality.",
            f"declared key columns excluded: {', '.join(sorted(keys)) or 'none'}",
        )
    suspicious = [(c, df[c].n_unique()) for c in categorical if df[c].n_unique() > NEAR_UNIQUE_RATIO * df.height]
    if suspicious:
        return result(
            "FAIL",
            f"{len(suspicious)} non-key categorical column(s) have near-unique cardinality — likely IDs, not categories.",
            "; ".join(f"{c}={n}/{df.height} unique" for c, n in suspicious),
        )
    return result("PASS", "No non-key categorical column has near-unique cardinality.",
                  f"{len(categorical)} categorical column(s) checked")


def check_dq6() -> dict:
    return result(
        "N/A",
        "No before/after shape declared: the runner observes only the finished artifact, so an "
        "output-first before/after comparison has no prior state to compare against.",
    )


def check_cov(df, window_spec: str) -> dict:
    import polars as pl

    try:
        col, start, end = parse_window(window_spec)
    except ValueError as exc:
        return result("FAIL", str(exc))
    if start is None:
        return result("N/A", "Required Window is `n/a`: this output declares no sample period to cover.")

    if col is None:
        candidates = [c for c in df.columns if df.schema[c] in (pl.Date, pl.Datetime)]
        if len(candidates) != 1:
            return result(
                "FAIL",
                f"Required Window {start}..{end} declared but the date column is ambiguous: "
                f"{len(candidates)} date/datetime column(s) found. Declare it as `column: {start}..{end}`.",
                f"candidates: {', '.join(candidates) or 'none'}",
            )
        col = candidates[0]
    if col not in df.columns:
        return result("FAIL", f"Declared window column `{col}` is absent from the artifact.",
                      f"artifact columns: {', '.join(df.columns)}")

    series = df[col]
    if series.dtype not in (pl.Date, pl.Datetime):
        try:
            series = series.cast(pl.Date, strict=True)
        except Exception:  # noqa: BLE001 - any cast failure is a FAIL, never a crash of the gate
            return result("FAIL", f"Window column `{col}` is {series.dtype} and could not be cast to a date.")

    lo, hi = series.min(), series.max()
    if lo is None or hi is None:
        return result("FAIL", f"Window column `{col}` is entirely null; the declared span has ZERO data.")
    lo_s, hi_s = str(lo)[:10], str(hi)[:10]
    if lo_s > start or hi_s < end:
        return result(
            "FAIL",
            f"Covers {lo_s}..{hi_s} but is required to cover {start}..{end}. The uncovered span has ZERO data.",
            f"column={col} observed={lo_s}..{hi_s} required={start}..{end}",
        )
    return result("PASS", f"Covers {lo_s}..{hi_s}, spanning the required {start}..{end}.",
                  f"column={col} height={df.height}")


def check_enum(checks: dict) -> dict:
    """Computed, not claimed: assert a line exists for every ID in the matrix."""
    missing = [c for c in MATRIX if c != "ENUM" and c not in checks]
    if missing:
        return result("FAIL", f"No line emitted for {len(missing)} matrix check(s): {', '.join(missing)}.")
    return result(
        "PASS",
        f"A line was emitted for all {len(MATRIX)} matrix checks.",
        " ".join(f"{c}={checks[c]['status']}" for c in MATRIX if c != "ENUM"),
    )


def check_output(path: Path, keys_spec: str, window_spec: str) -> dict:
    checks: dict[str, dict] = {}

    if not path.exists():
        for check in MATRIX:
            if check in MODEL_EVALUATED:
                checks[check] = model_line(check)
            elif check != "ENUM":
                checks[check] = result("FAIL", f"Declared output does not exist at `{path}`.")
        checks["ENUM"] = check_enum(checks)
        return checks

    try:
        df = load_frame(path)
    except Exception as exc:  # noqa: BLE001 - an unreadable artifact is a FAIL, never a crash of the gate
        for check in MATRIX:
            if check in MODEL_EVALUATED:
                checks[check] = model_line(check)
            elif check != "ENUM":
                checks[check] = result("FAIL", f"Could not read `{path}`: {exc}")
        checks["ENUM"] = check_enum(checks)
        return checks

    pk, event = parse_keys(keys_spec)

    if df.height == 0:
        for check in ("DQ1", "DQ2", "DQ3", "DQ5"):
            checks[check] = result("FAIL", f"Artifact `{path}` has zero rows; no data-quality property can hold.")
        checks["DQ4"] = result("FAIL", "Artifact has zero rows, so the row-count chain terminates in nothing.")
        checks["DQ6"] = check_dq6()
        checks["COV"] = result("FAIL", "Artifact has zero rows, so it covers no window at all.")
    else:
        checks["DQ1"] = check_dq1(df)
        checks["DQ2"] = check_dq2(df)
        checks.update(check_dq3(df, pk, event))
        checks["DQ4"] = check_dq4(df)
        checks["DQ5"] = check_dq5(df, pk, event)
        checks["DQ6"] = check_dq6()
        checks["COV"] = check_cov(df, window_spec)

    for check in MODEL_EVALUATED:
        checks[check] = model_line(check)
    checks["ENUM"] = check_enum(checks)
    return checks


# --------------------------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------------------------


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ds-dq.py",
        description=(
            "Compute the mechanical DS data-quality checks (DQ1-DQ6, COV, ENUM) over the outputs "
            "declared in an approved /ds plan's `## Data Outputs` table. M1, UNI, DEN, DEL and R1 "
            "are enumerated as MODEL-EVALUATED and are never computed."
        ),
        epilog="Exits non-zero if any COMPUTED check FAILs.",
    )
    parser.add_argument("--plan", help="Path to the approved plan whose `## Data Outputs` table declares the artifacts.")
    parser.add_argument("--project-dir", default=".", help="Root the declared Paths are relative to (default: cwd).")
    parser.add_argument("--output", help="Check a single artifact instead of a plan (testing).")
    parser.add_argument("--grain", default="", help="Declared row grain for --output (recorded, not computed against).")
    parser.add_argument("--keys", default="", help="Key Columns for --output: `a, b` or `pk: a, b; event: c, d`.")
    parser.add_argument("--window", default="n/a", help="Required Window for --output: `n/a` or `[col: ]YYYY-MM-DD..YYYY-MM-DD`.")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    root = Path(args.project_dir).expanduser().resolve()

    if bool(args.plan) == bool(args.output):
        print("ds-dq.py: supply exactly one of --plan or --output", file=sys.stderr)
        return 2

    if args.output:
        rows = [{"path": args.output, "grain": args.grain, "key columns": args.keys, "required window": args.window}]
    else:
        plan_path = Path(args.plan).expanduser()
        try:
            rows = parse_data_outputs(plan_path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            print(f"ds-dq.py: plan not found at {plan_path}", file=sys.stderr)
            return 2
        except ValueError as exc:
            # Still emit JSON. The contract is "JSON on stdout, non-zero exit"; a bare stderr line
            # left a gate reading an empty stdout, which parses as "no checks" rather than "could
            # not check" — the silence-looks-like-a-pass shape ENUM exists to prevent.
            print(json.dumps({"_error": {"status": "FAIL", "detail": str(exc),
                                         "reason_source": "runner"}}, indent=2))
            print(f"ds-dq.py: {exc}", file=sys.stderr)
            return 2

    report: dict[str, dict] = {}
    for row in rows:
        path = Path(row["path"])
        resolved = path if path.is_absolute() else root / path
        report[row["path"]] = {
            "_declared": {
                "grain": row["grain"],
                "key_columns": row["key columns"],
                "required_window": row["required window"],
                "resolved_path": str(resolved),
            },
            **check_output(resolved, row["key columns"], row["required window"]),
        }

    print(json.dumps(report, indent=2, sort_keys=False))
    failed = any(
        isinstance(entry, dict) and entry.get("status") == "FAIL"
        for output in report.values()
        for entry in output.values()
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
