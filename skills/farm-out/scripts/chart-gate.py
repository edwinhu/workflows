#!/usr/bin/env python3
"""Output gate for a farmed ds row: lint the chart code and figures the child touched.

    chart-gate.py --cwd DIR --stamp FILE --log FILE [--expect PATH ...]

"Touched" is read off three sources and unioned, because each alone misses a way a figure is made:
files under --cwd modified after --stamp (touched before launch; catches a savefig from a Bash
python call), Write/Edit/NotebookEdit paths in the child's stream log (catches writes outside
--cwd, which mtime-under-cwd cannot see), and the row's expect paths. A touched .py/.R/.qmd/.ipynb
counts only if it draws a chart (CHART); a .mplstyle or a figure file (.svg/.png/.pdf) always counts.

For the directories of the touched chart code (or, with no code, of the touched figures) it runs
the A5 and A6 linters from the plugin's constraints/:

    ds-chart-typography.py <dir> --render      ds-chart-color.py <dir>

Exit 0: nothing chart-shaped was touched, or both linters exit 0. Exit 1: a linter reported
findings. Exit 2: a linter could not run -- an unrun check is never a pass, so the caller fails the
row on both. Findings go to stdout.
"""
import json, os, re, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONSTRAINTS = HERE.parents[2] / "constraints"
CODE = {".py", ".r", ".qmd", ".rmd", ".ipynb"}
FIGURE = {".svg", ".png", ".pdf"}
CHART = re.compile(r"matplotlib|pyplot|\baltair\b|\bplotly\b|seaborn|ggplot|plotnine|pyobsplot|savefig|"
                   r"\.mark_\w+\(|vl_convert|\bgeom_\w+|ggsave", re.I)
SKIP_PARTS = {".git", ".pixi", "node_modules", "__pycache__", ".venv", "venv", ".cache"}
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
    return r.returncode, (r.stdout + r.stderr).strip()


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
    code = {p for p in files if draws_chart(p)}
    figs = {p for p in files if p.suffix.lower() in FIGURE}
    if not code and not figs:
        print("chart-gate: no chart code or figure file touched; nothing to lint")
        return 0
    dirs = sorted({p.parent for p in (code or figs)})
    worst, report = 0, []
    for d in dirs:
        for script, extra in (("ds-chart-typography.py", ("--render",)), ("ds-chart-color.py", ())):
            rc, out = run(script, d, *extra)
            if rc != 0:
                worst = max(worst, 1 if rc == 1 else 2)
                body = "\n".join(l for l in out.splitlines() if l.strip())
                report.append(f"{script} {d}{' --render' if extra else ''} exit {rc}:\n{body}")
    if worst == 0:
        print(f"chart-gate: {len(dirs)} dir(s) clean ({', '.join(map(str, dirs))})")
        return 0
    print("\n\n".join(report))
    return worst


if __name__ == "__main__":
    raise SystemExit(main())
