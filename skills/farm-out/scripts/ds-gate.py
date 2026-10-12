#!/usr/bin/env python3
"""Output gate for a farmed ds row: run every ds-* constraint checker on what the child touched.

    ds-gate.py --cwd DIR --stamp FILE --log FILE [--expect PATH ...]

"Touched" is read off three sources and unioned, because each alone misses a way work is made:
files under --cwd modified after --stamp (catches a savefig from a Bash python call), Write/Edit/
NotebookEdit paths in the child's stream log (catches writes outside --cwd, which mtime-under-cwd
cannot see), and the row's expect paths.

Two kinds of checker, run on different targets:

- Chart (A5/A6): ds-chart-typography.py --render and ds-chart-color.py, on the directories of the
  touched chart code (CHART below; a .mplstyle or a figure file always counts), or of the touched
  figures when there is no code. They scan a directory, so they get the directory.
- Code (C/V/A/E): CODE_CHECKS, on the touched .py files. Those checkers prune any path with a
  `scratch/` part -- where ds work lives -- so the touched files are copied flat into a temp dir
  and checked there; findings are mapped back to the original path. Waivers (_ds_waivers.py)
  travel with the copy. R, qmd and notebooks are not checked by them (they read .py only).

Left out on purpose: ds-data-pull-profile and ds-external-skill-discovery read .planning/PLAN.md in
the cwd, not code the row touched, so on a farmed row they have nothing to read.

Exit 0: every checker ran and found nothing (a checker with nothing to check says so). Exit 1:
findings. Exit 2: a checker crashed, timed out or printed no verdict -- an unrun check is never a
pass, so the caller fails the row on both. Output goes to stdout.
"""
import json, os, re, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONSTRAINTS = HERE.parents[2] / "constraints"
CODE = {".py", ".r", ".qmd", ".rmd", ".ipynb"}
FIGURE = {".svg", ".png", ".pdf"}
CHART = re.compile(r"matplotlib|pyplot|\baltair\b|\bplotly\b|seaborn|ggplot|plotnine|pyobsplot|savefig|"
                   r"\.mark_\w+\(|vl_convert|\bgeom_\w+|ggsave", re.I)
SKIP_PARTS = {".git", ".pixi", "node_modules", "__pycache__", ".venv", "venv", ".cache"}
CHART_CHECKS = (("ds-chart-typography.py", ("--render",)), ("ds-chart-color.py", ()))
CODE_CHECKS = ("ds-determinism.py", "ds-error-handling.py", "ds-idempotency.py", "ds-join-audits.py",
               "ds-network-politeness.py", "ds-robustness-checks.py", "ds-schema-contracts.py",
               "ds-standard-error-spec.py", "ds-table-figure-pairing.py", "ds-visualization-integrity.py")
WRITE_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}


def logged_writes(log: Path) -> list[Path]:
    out = []
    try:
        lines = log.read_text(errors="replace").splitlines()
    except OSError:
        return out
    for line in lines:
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if ev.get("type") != "assistant":
            continue
        for c in (ev.get("message") or {}).get("content") or []:
            if isinstance(c, dict) and c.get("type") == "tool_use" and c.get("name") in WRITE_TOOLS:
                p = (c.get("input") or {}).get("file_path") or (c.get("input") or {}).get("notebook_path")
                if isinstance(p, str):
                    out.append(Path(p))
    return out


def touched(cwd: Path, stamp: Path, log: Path, expects: list[str]) -> set[Path]:
    found: set[Path] = set()
    mark = stamp.stat().st_mtime if stamp.exists() else None
    if mark is not None:
        for root, dirs, files in os.walk(cwd):
            dirs[:] = [d for d in dirs if d not in SKIP_PARTS]
            for f in files:
                p = Path(root) / f
                try:
                    if p.stat().st_mtime > mark:
                        found.add(p)
                except OSError:
                    pass
    for p in logged_writes(log):
        found.add(p if p.is_absolute() else cwd / p)
    for e in expects:
        found.add(Path(e) if os.path.isabs(e) else cwd / e)
    return {p for p in found if p.is_file() and not SKIP_PARTS & set(p.parts)}


def draws_chart(p: Path) -> bool:
    if p.suffix.lower() == ".mplstyle":
        return True
    if p.suffix.lower() not in CODE:
        return False
    try:
        return bool(CHART.search(p.read_text(errors="replace")))
    except OSError:
        return False


def run(script: str, target: Path, *extra: str) -> tuple[int, str]:
    try:
        r = subprocess.run([sys.executable, str(CONSTRAINTS / script), str(target), *extra],
                           capture_output=True, text=True, timeout=600)
    except subprocess.TimeoutExpired:
        return 2, f"COULD-NOT-CHECK: {script} timed out"
    out = (r.stdout + r.stderr).strip()
    # An uncaught exception also exits 1, which would read as findings; a clean exit that never
    # printed PASS did not run its check. Neither is a verdict.
    if r.returncode == 1 and "Traceback" in out and "FAIL" not in r.stdout:
        return 2, f"COULD-NOT-CHECK: {script} crashed\n{out}"
    if r.returncode == 0 and script in CODE_CHECKS and "PASS:" not in r.stdout:
        return 2, f"COULD-NOT-CHECK: {script} exited 0 without a PASS verdict\n{out}"
    return r.returncode, out


def check_code(files: list[Path]) -> tuple[int, list[str]]:
    """Run CODE_CHECKS over a flat copy of `files`; returns (worst exit, report blocks)."""
    stage = Path(tempfile.mkdtemp(prefix="ds-gate-"))
    try:
        names = {}
        for i, p in enumerate(files):
            names[f"f{i:03d}_{p.name}"] = p
            shutil.copy2(p, stage / f"f{i:03d}_{p.name}")
        with ThreadPoolExecutor(len(CODE_CHECKS)) as ex:
            results = list(ex.map(lambda c: (c, *run(c, stage)), CODE_CHECKS))
        worst, report = 0, []
        for script, rc, out in results:
            if rc == 0:
                continue
            worst = max(worst, 1 if rc == 1 else 2)
            for flat, orig in names.items():
                out = out.replace(flat, str(orig))
            body = "\n".join(l for l in out.splitlines() if l.strip())
            report.append(f"{script} exit {rc}:\n{body}")
        return worst, report
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def main() -> int:
    a = sys.argv[1:]
    def opt(name):
        return a[a.index(name) + 1] if name in a else None
    cwd, stamp, log = opt("--cwd"), opt("--stamp"), opt("--log")
    if not (cwd and stamp and log):
        print(__doc__)
        return 2
    expects = [a[i + 1] for i, x in enumerate(a) if x == "--expect" and i + 1 < len(a)]
    files = touched(Path(cwd), Path(stamp), Path(log), expects)
    chart_code = {p for p in files if draws_chart(p)}
    figs = {p for p in files if p.suffix.lower() in FIGURE}
    py = sorted(p for p in files if p.suffix.lower() == ".py")
    worst, report, ran = 0, [], []
    if chart_code or figs:
        dirs = sorted({p.parent for p in (chart_code or figs)})
        for d in dirs:
            for script, extra in CHART_CHECKS:
                rc, out = run(script, d, *extra)
                if rc != 0:
                    worst = max(worst, 1 if rc == 1 else 2)
                    body = "\n".join(l for l in out.splitlines() if l.strip())
                    report.append(f"{script} {d}{' --render' if extra else ''} exit {rc}:\n{body}")
        ran.append(f"chart linters on {len(dirs)} dir(s)")
    else:
        ran.append("chart linters: no chart code or figure touched, nothing to lint")
    if py:
        rc, blocks = check_code(py)
        worst = max(worst, rc)
        report += blocks
        ran.append(f"{len(CODE_CHECKS)} code checkers on {len(py)} .py file(s)")
    else:
        ran.append("code checkers: no .py touched, nothing to check")
    if worst == 0:
        print("ds-gate: clean (" + "; ".join(ran) + ")")
        return 0
    print("\n\n".join(report))
    return worst


if __name__ == "__main__":
    raise SystemExit(main())
