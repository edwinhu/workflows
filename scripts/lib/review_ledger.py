#!/usr/bin/env python3
"""The review core: ledger every review copy's marks under a stable id, then verify an outcomes file covers them.

    review_ledger.py ledger COPY... [--json] [--png-dir DIR]
    review_ledger.py verify (--ledger LEDGER.json | COPY...) --outcomes OUTCOMES.json [--check-cmd CMD] [--json]

Launched by bin/review-ledger, which supplies pymupdf and lxml. COPY is, in the caller's order (oldest
first), a .pdf or .docx read through doc_marks.read(), or a .json already in the doc-marks schema (a Drive
copy, or any backend that emits it). Copies are read concurrently; the ledger keeps argument order. Copy
stems must be distinct, since the stem is half of every id.

ledger emits

    {"copies": [{"file", "marks"}],
     "marks": [{"n", "id", "copy", "source", "kind", "page", "heading", "typed", "under", "png", "rect",
                "author", "created"}]}

`id` is "<copy stem>#<doc-marks mark id>" and `n` numbers the marks 1.. across every copy. `typed` is the
mark's typed note verbatim, null when it has none; `under` is the doc-marks `quoted` text. A PDF copy's page
PNGs go to <png-dir>/<copy stem> (default <tmpdir>/doc-marks/<copy stem>, doc-marks' own). Without --json
it prints markdown: one line per copy (NO MARKS for an unmarked one), then one numbered line per mark.

verify reads OUTCOMES, an object keyed by ledger id, each value {"outcome": "applied"|"answered"|"asked"|
"no-edit", "note": str, ...}; extra keys pass through untouched. Completeness: `missing` (a ledger id with
no outcome), `unknown` (an outcome key naming no ledger id), `invalid` (a value that is not an object, or
whose outcome is not one of the four). --check-cmd is split with shlex and run without a shell, concurrently,
once per `applied` mark, with stdin {"mark": <ledger row>, "outcome": <outcome value>}: exit 0 PASS, 1 FAIL
(its stdout is the reason), anything else could not run. Without it applied marks are UNCHECKED, and the
report says so. A valid non-applied outcome passes: there is nothing to change-check. --json emits

    {"completeness": {"missing", "unknown", "invalid": [{"id", "why"}]},
     "results": [{"n", "id", "outcome", "status", "reason"}],
     "summary": {"ids", "pass", "fail", "completeness_errors", "ok"}}

Exit, ledger: 0 marks found · 1 none (`NO MARKS` on stderr; the empty ledger still prints) · 2 could not run.
Exit, verify: 0 complete and no check failed · 1 an id missing, unknown or invalid, or a check failed ·
2 could not run (bad ledger, copies or outcomes, or a check that exited other than 0 or 1).
"""

from __future__ import annotations

import argparse
import json
import shlex
import subprocess
import sys
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:  # an isolated (-I/-P) launch does not put the script's directory first
    sys.path.insert(0, str(HERE))

import doc_marks
from doc_marks import CouldNotRun

PROG = "review-ledger"
OUTCOMES = ("applied", "answered", "asked", "no-edit")
SUFFIXES = (".pdf", ".docx", ".json")
WORKERS = 8


# ── ledger ────────────────────────────────────────────────────────────────────

def json_copy(path: Path) -> dict:
    try:
        s = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as e:
        raise CouldNotRun(f"{path}: not readable doc-marks JSON ({e})") from None
    marks = s.get("marks") if isinstance(s, dict) else None
    if not isinstance(marks, list) or not all(
            isinstance(mk, dict) and isinstance(mk.get("id"), str) and mk["id"]
            and isinstance(mk.get("where") or {}, dict) for mk in marks):
        raise CouldNotRun(f"{path}: not in the doc-marks schema (an object whose `marks` each carry an `id`)")
    ids = [mk["id"] for mk in marks]
    if len(set(ids)) != len(ids):
        raise CouldNotRun(f"{path}: a mark id repeats, so its ledger ids would collide")
    return s


def read_copy(path: Path, png_dir: Path) -> dict:
    if path.suffix.lower() == ".json":
        return json_copy(path)
    # "--" ends the options, so a copy whose name starts with "-" is still read as the file.
    return doc_marks.read(doc_marks.parser().parse_args(["--png-dir", str(png_dir), "--", str(path)]))


def prune_empty(d: Path, root: Path) -> None:
    """doc-marks makes a copy's PNG dir before it knows the copy is unmarked; an unmarked copy leaves none."""
    while d != root and root in d.parents:
        try:
            d.rmdir()
        except OSError:
            return
        d = d.parent


def checked_copies(names: list[str]) -> list[Path]:
    copies = [Path(n).expanduser() for n in names]
    for c in copies:
        if c.suffix.lower() not in SUFFIXES:
            raise CouldNotRun(f"{c}: not a .pdf, .docx or doc-marks .json")
        if not c.is_file():
            raise CouldNotRun(f"{c}: no such file")
    stems = [c.stem for c in copies]
    if len(set(stems)) != len(stems):
        dup = next(s for s in stems if stems.count(s) > 1)
        raise CouldNotRun(f"two copies share the stem {dup!r}, so their ledger ids would collide")
    return copies


def ledger(names: list[str], png_dir: Path | None) -> dict:
    copies = checked_copies(names)
    root = png_dir if png_dir else Path(tempfile.gettempdir()) / "doc-marks"
    with ThreadPoolExecutor(max_workers=min(WORKERS, len(copies))) as pool:
        found = list(pool.map(lambda c: read_copy(c, root / c.stem), copies))
    listed, rows = [], []
    for copy, s in zip(copies, found):
        marks = s["marks"]
        if not marks:
            prune_empty(root / copy.stem, root if png_dir else root.parent)
        listed.append({"file": copy.name, "marks": len(marks)})
        for mk in marks:
            w = mk.get("where") or {}
            rows.append({"n": len(rows) + 1, "id": f"{copy.stem}#{mk['id']}", "copy": copy.name,
                         "source": s.get("source"), "kind": mk.get("kind"), "page": w.get("page"),
                         "heading": w.get("heading"), "typed": mk.get("text") or None, "under": mk.get("quoted"),
                         "png": mk.get("png"), "rect": w.get("rect"), "author": mk.get("author"),
                         "created": mk.get("created")})
    return {"copies": listed, "marks": rows}


def n_copies(n: int) -> str:
    return f"{n} copy" if n == 1 else f"{n} copies"


def ledger_md(res: dict) -> str:
    out = ["# Review ledger", "",
           (f"{len(res['marks'])} mark(s) across {n_copies(len(res['copies']))}, in the order given. "
            "Typed text is verbatim; every id needs an outcome."), ""]
    out += [f"- {c['file']}: {c['marks']} mark(s)" if c["marks"] else f"- {c['file']}: NO MARKS" for c in res["copies"]]
    out.append("")
    for r in res["marks"]:
        typed = f'typed: "{r["typed"]}"' if r["typed"] else "UNTYPED"
        out.append(f"{r['n']}. `{r['id']}` [{r['heading'] or '(untitled)'}] {typed}")
    return "\n".join(out)


# ── verify ────────────────────────────────────────────────────────────────────

def load_json(flag: str, path: str):
    try:
        return json.loads(Path(path).expanduser().read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, ValueError) as e:
        raise CouldNotRun(f"{flag} {path}: {e}") from None


def saved_ledger(path: str) -> list[dict]:
    res = load_json("--ledger", path)
    rows = res.get("marks") if isinstance(res, dict) else None
    if not isinstance(rows, list) or not all(isinstance(r, dict) and isinstance(r.get("id"), str) for r in rows):
        raise CouldNotRun(f"--ledger {path}: not a review-ledger JSON (an object whose `marks` rows each carry an `id`)")
    ids = [r["id"] for r in rows]
    if len(set(ids)) != len(ids):
        raise CouldNotRun(f"--ledger {path}: a ledger id repeats")
    return rows


def completeness(ids: list[str], outcomes: dict) -> dict:
    known = set(ids)
    invalid = []
    for i, o in outcomes.items():
        if not isinstance(o, dict):
            invalid.append({"id": i, "why": "the outcome is not an object"})
        elif o.get("outcome") not in OUTCOMES:
            invalid.append({"id": i, "why": f"outcome {o.get('outcome')!r} is not one of {', '.join(OUTCOMES)}"})
    return {"missing": [i for i in ids if i not in outcomes], "unknown": [i for i in outcomes if i not in known],
            "invalid": invalid}


def run_check(argv: list[str], row: dict, outcome: dict) -> tuple[str, str]:
    payload = json.dumps({"mark": row, "outcome": outcome}, ensure_ascii=False)
    try:
        p = subprocess.run(argv, input=payload, capture_output=True, encoding="utf-8", errors="replace", check=False)
    except OSError as e:
        return "COULD-NOT-RUN", f"{argv[0]}: {e}"
    if p.returncode == 0:
        return "PASS", p.stdout.strip() or "check passed"
    if p.returncode == 1:
        return "FAIL", p.stdout.strip() or "check failed and printed no reason"
    err = p.stderr.strip()
    return "COULD-NOT-RUN", f"check exited {p.returncode}" + (f": {err[-300:]}" if err else "")


def check_argv(cmd: str | None) -> list[str] | None:
    if cmd is None:
        return None
    try:
        argv = shlex.split(cmd)
    except ValueError as e:
        raise CouldNotRun(f"--check-cmd {cmd!r}: {e}") from None
    if not argv:
        raise CouldNotRun("--check-cmd is empty")
    return argv


def verify(a) -> tuple[dict, bool]:
    outcomes = load_json("--outcomes", a.outcomes)
    if not isinstance(outcomes, dict):
        raise CouldNotRun(f"--outcomes {a.outcomes}: expected an object keyed by ledger id")
    argv = check_argv(a.check_cmd)
    if a.ledger:
        return judged(saved_ledger(a.ledger), outcomes, argv)
    # The rows' PNGs only need to outlive the checks; verify's report names none of them.
    with tempfile.TemporaryDirectory(prefix="review-ledger-") as tmp:
        return judged(ledger(a.copies, Path(tmp))["marks"], outcomes, argv)


def judged(rows: list[dict], outcomes: dict, argv: list[str] | None) -> tuple[dict, bool]:
    gaps = completeness([r["id"] for r in rows], outcomes)
    bad = {b["id"]: b["why"] for b in gaps["invalid"]}
    applied = [r for r in rows if r["id"] not in bad and outcomes.get(r["id"], {}).get("outcome") == "applied"]
    checked: dict[str, tuple[str, str]] = {}
    if argv and applied:
        with ThreadPoolExecutor(max_workers=min(WORKERS, len(applied))) as pool:
            checked = dict(zip((r["id"] for r in applied),
                               pool.map(lambda r: run_check(argv, r, outcomes[r["id"]]), applied)))
    results = []
    for r in rows:
        o = outcomes.get(r["id"])
        name = o.get("outcome") if isinstance(o, dict) else None
        if r["id"] not in outcomes:
            status, reason = "FAIL", "no outcome"
        elif r["id"] in bad:
            status, reason = "FAIL", bad[r["id"]]
        elif name != "applied":
            status, reason = "PASS", f"{name}: nothing to change-check"
        elif argv is None:
            status, reason = "UNCHECKED", "applied, not change-checked: no --check-cmd given"
        else:
            status, reason = checked[r["id"]]
        results.append({"n": r.get("n"), "id": r["id"], "outcome": name, "status": status, "reason": reason})
    count = {s: sum(x["status"] == s for x in results) for s in ("PASS", "FAIL", "UNCHECKED", "COULD-NOT-RUN")}
    errors = sum(len(v) for v in gaps.values())
    ok = not errors and not count["FAIL"] and not count["COULD-NOT-RUN"]
    out = {"completeness": gaps, "results": results,
           "summary": {"ids": len(results), "pass": count["PASS"], "fail": count["FAIL"],
                       "completeness_errors": errors, "ok": ok}}
    return out, count["COULD-NOT-RUN"] == 0


def verify_md(res: dict, cmd: str | None) -> str:
    g, s = res["completeness"], res["summary"]
    unchecked = sum(x["status"] == "UNCHECKED" for x in res["results"])
    out = ["# Review verify", "",
           f"check: `{cmd}`, once per applied mark" if cmd else
           f"check: none; {unchecked} applied mark(s) not change-checked (no --check-cmd)", ""]
    if any(g.values()):
        out.append("COMPLETENESS: FAIL")
        out += [f"- missing outcome: `{i}`" for i in g["missing"]]
        out += [f"- unknown id (not in the ledger): `{i}`" for i in g["unknown"]]
        out += [f"- invalid: `{b['id']}`: {b['why']}" for b in g["invalid"]]
    else:
        out.append(f"COMPLETENESS: OK ({s['ids']} ids, one valid outcome each)")
    out.append("")
    out += [f"{x['n']}. `{x['id']}` {x['outcome'] or '-'} {x['status']}: {x['reason']}" for x in res["results"]]
    out += ["", (f"SUMMARY: {s['pass']} pass, {s['fail']} fail, {unchecked} unchecked of {s['ids']} ids; "
                 f"{s['completeness_errors']} completeness error(s) → {'OK' if s['ok'] else 'FAIL'}")]
    return "\n".join(out)


# ── CLI ───────────────────────────────────────────────────────────────────────

def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog=PROG, description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", metavar="{ledger,verify}")
    lg = sub.add_parser("ledger", help="number every copy's marks under a stable id")
    lg.add_argument("copies", nargs="*", metavar="COPY", help="a .pdf, .docx or doc-marks .json, oldest first")
    lg.add_argument("--png-dir", help="where each PDF copy's page PNGs go, one subdirectory per copy stem")
    lg.add_argument("--json", action="store_true", help="print JSON instead of markdown")
    lg.set_defaults(usage=lg.format_usage)
    vf = sub.add_parser("verify", help="check an outcomes file covers every ledger id")
    vf.add_argument("copies", nargs="*", metavar="COPY", help="ledger these copies instead of reading --ledger")
    vf.add_argument("--ledger", help="a saved `ledger --json`")
    vf.add_argument("--outcomes", help="an object keyed by ledger id")
    vf.add_argument("--check-cmd", help="run once per applied mark, stdin {mark, outcome}: exit 0 PASS, 1 FAIL")
    vf.add_argument("--json", action="store_true", help="print JSON instead of markdown")
    vf.set_defaults(usage=vf.format_usage)
    return ap


def could_not_run(msg: str, usage: str | None = None) -> int:
    if usage:
        print(usage, file=sys.stderr, end="")
    print(f"{PROG}: COULD-NOT-RUN: {msg}", file=sys.stderr)
    return 2


def main(argv=None) -> int:
    ap = parser()
    a = ap.parse_args(argv)  # a bad argument exits 2 itself
    if not a.cmd:
        return could_not_run("no subcommand named (ledger or verify)", ap.format_usage())
    if a.cmd == "ledger" and not a.copies:
        return could_not_run("no COPY named", a.usage())
    if a.cmd == "verify":
        if not a.copies and not a.ledger:
            return could_not_run("give --ledger LEDGER.json or COPY...", a.usage())
        if a.copies and a.ledger:
            return could_not_run("give --ledger or COPY..., not both", a.usage())
        if not a.outcomes:
            return could_not_run("no --outcomes named", a.usage())
    try:
        if a.cmd == "ledger":
            res = ledger(a.copies, Path(a.png_dir).expanduser() if a.png_dir else None)
            ran = True
        else:
            res, ran = verify(a)
    except CouldNotRun as e:
        return could_not_run(str(e))
    except Exception as e:  # noqa: BLE001 -- an uncaught crash exits 1, which every caller reads as a verdict
        return could_not_run(f"{type(e).__name__}: {e}")
    if a.json:
        print(json.dumps(res, indent=2, ensure_ascii=False))
    else:
        print(ledger_md(res) if a.cmd == "ledger" else verify_md(res, a.check_cmd))
    if a.cmd == "ledger":
        if not res["marks"]:
            print(f"{PROG}: NO MARKS in {n_copies(len(res['copies']))}", file=sys.stderr)
            return 1
        return 0
    if not ran:
        return could_not_run("a --check-cmd run neither passed nor failed (exit other than 0/1); see its results")
    return 0 if res["summary"]["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
