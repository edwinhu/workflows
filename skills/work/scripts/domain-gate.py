#!/usr/bin/env python3
"""The one gate per workflow domain: every constraint, the plan's data checks and the domain's Jev rules.

    domain-gate.py --domain ds|dev --project-dir DIR [--plan PLAN] [--skip-rules]     # a /work run
    domain-gate.py --domain ds|dev --cwd DIR --stamp FILE --log FILE [--expect P ...] # a farmed row
    domain-gate.py --domain ds|dev --list                                             # what it reaches, as JSON

What it runs is COMPUTED, never listed per caller:

- CONSTRAINTS: every constraints/<domain>-*.py, found by glob. A new script is reached the day it is
  written. Three kinds, told apart by name (CHART / PLAN_READERS below, everything else is code):
  chart linters take the directories of touched chart code or figures; plan readers read
  <project>/.planning/PLAN.md and run only when a plan is given; code checkers read .py and run on
  the touched .py files, copied flat into a temp dir because every one prunes a `scratch/` path --
  where ds work lives -- and would otherwise pass having read nothing. Findings are mapped back to the
  original path; waivers (_ds_waivers.py) travel with the copy. R, qmd and notebooks reach only the
  chart linters.
- DATA QUALITY (ds, with --plan): skills/ds/scripts/ds-dq.py over the plan's `## Data Outputs`.
- RULES: the domain's wired Jev directory (RULE_DIRS in hooks/jev/rules.ts) through rule-check.ts.
  --skip-rules is for a caller whose plan already scores them as `ruleChecks`: /work's rule leg would
  otherwise be paid twice for one verdict. A farmed row has no plan and no ruleChecks, so it scores them
  here, on the files it touched.

"Touched" is, in a /work run, the git working tree's changed and untracked files (every file when there
is no git); in a farmed row three sources unioned, because each alone misses a way work is made: files
under --cwd modified after --stamp, Write/Edit/NotebookEdit paths in the child's stream log, and the
row's expect paths.

Exit 0: every check ran and found nothing. 1: findings. 2: a check crashed, timed out, printed no
verdict or could not judge -- an unrun check is never a pass. The first line is the leg's count line
(work/scripts/leg-counts.sh): `<domain>-gate: N check(s) examined`; the findings follow.
"""
import json, os, re, shutil, subprocess, sys, tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
CONSTRAINTS = ROOT / "constraints"
CODE = {".py", ".r", ".qmd", ".rmd", ".ipynb"}
FIGURE = {".svg", ".png", ".pdf"}
DEV_SOURCE = CODE | {".ts", ".tsx", ".js", ".mjs", ".cjs", ".sh", ".bash", ".go", ".rs", ".java", ".rb", ".c", ".cc", ".cpp", ".h"}
CHART = re.compile(r"matplotlib|pyplot|\baltair\b|\bplotly\b|seaborn|ggplot|plotnine|pyobsplot|savefig|"
                   r"\.mark_\w+\(|vl_convert|\bgeom_\w+|ggsave", re.I)
SKIP_PARTS = {".git", ".pixi", "node_modules", "__pycache__", ".venv", "venv", ".cache"}
CHART_ARGS = {"ds-chart-typography.py": ("--render",), "ds-chart-color.py": ()}
PLAN_READERS = {"ds-data-pull-profile.py", "ds-external-skill-discovery.py"}
WRITE_TOOLS = {"Write", "Edit", "MultiEdit", "NotebookEdit"}
DOMAINS = ("ds", "dev")


def constraint_scripts(domain: str) -> list[str]:
    return sorted(p.name for p in CONSTRAINTS.glob(f"{domain}-*.py"))


def rules_dir(domain: str) -> Path | None:
    """RULE_DIRS[domain] from hooks/jev/rules.ts -- the one table that wires a rule set."""
    text = (ROOT / "hooks" / "jev" / "rules.ts").read_text()
    block = re.search(r"RULE_DIRS[^=]*=\s*\{(.*?)\n\}", text, re.S)
    m = block and re.search(rf"^\s*{domain}:\s*'([^']+)'", block.group(1), re.M)
    return ROOT / m.group(1) if m else None


def classify(domain: str) -> dict:
    names = constraint_scripts(domain)
    return {"chart": [n for n in names if n in CHART_ARGS],
            "plan": [n for n in names if n in PLAN_READERS],
            "code": [n for n in names if n not in CHART_ARGS and n not in PLAN_READERS]}


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


def changed(project: Path) -> set[Path]:
    """The git tree's changed and untracked files; every file when `project` is not a git tree."""
    def git(*a):
        return subprocess.run(["git", "-C", str(project), *a], capture_output=True, text=True)
    top = git("rev-parse", "--show-toplevel")
    if top.returncode != 0:
        found = set()
        for r, ds, fs in os.walk(project):
            ds[:] = [d for d in ds if d not in SKIP_PARTS]
            found |= {Path(r) / f for f in fs}
    else:
        names = git("diff", "--name-only", "--relative", "HEAD", "--", ".").stdout.split("\n") + \
            git("ls-files", "--others", "--exclude-standard").stdout.split("\n")
        found = {project / n for n in names if n}
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


def run(script: str, target: Path, *extra: str, code: bool = False) -> tuple[int, str]:
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
    if r.returncode == 0 and code and "PASS:" not in r.stdout:
        return 2, f"COULD-NOT-CHECK: {script} exited 0 without a PASS verdict\n{out}"
    return r.returncode, out


def block(label: str, rc: int, out: str) -> str:
    return f"{label} exit {rc}:\n" + "\n".join(l for l in out.splitlines() if l.strip())


def check_code(scripts: list[str], files: list[Path]) -> tuple[int, list[str]]:
    """Run `scripts` over a flat copy of `files`; returns (worst exit, report blocks)."""
    stage = Path(tempfile.mkdtemp(prefix="domain-gate-"))
    try:
        names = {}
        for i, p in enumerate(files):
            names[f"f{i:03d}_{p.name}"] = p
            shutil.copy2(p, stage / f"f{i:03d}_{p.name}")
        with ThreadPoolExecutor(len(scripts)) as ex:
            results = list(ex.map(lambda c: (c, *run(c, stage, code=True)), scripts))
        worst, report = 0, []
        for script, rc, out in results:
            if rc == 0:
                continue
            worst = max(worst, 1 if rc == 1 else 2)
            for flat, orig in names.items():
                out = out.replace(f"{stage}/{flat}", str(orig)).replace(flat, str(orig))
            report.append(block(script, rc, out))
        return worst, report
    finally:
        shutil.rmtree(stage, ignore_errors=True)


def data_quality(plan: Path, project: Path) -> tuple[int, str]:
    cmd = ["uv", "run", "--with", "polars", "python3", str(ROOT / "skills" / "ds" / "scripts" / "ds-dq.py"),
           "--plan", str(plan), "--project-dir", str(project)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    except (subprocess.TimeoutExpired, OSError) as e:
        return 2, f"COULD-NOT-CHECK: ds-dq.py did not run: {e}"
    out = (r.stdout + r.stderr).strip()
    return (r.returncode if r.returncode in (0, 1) else 2), out


def score_rules(domain: str, files: list[Path], project: Path | None, plan: Path | None, name: str) -> tuple[int, str, int]:
    """Jev over the domain's rules directory: (exit, report, rules scored)."""
    rdir = rules_dir(domain)
    if rdir is None or not rdir.is_dir():
        return 2, f"COULD-NOT-CHECK: no rule set wired for domain {domain} in hooks/jev/rules.ts RULE_DIRS", 0
    cmd = os.environ.get("DOMAIN_GATE_RULE_CHECK", "").split() or ["bun", str(HERE / "rule-check.ts")]
    cmd += ["--rules", str(rdir)]
    if plan:
        cmd += ["--plan", str(plan)]
    if project:
        cmd += ["--project-dir", str(project)]
    else:
        cmd += ["--project", name, "--files", *map(str, files)]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
    except (subprocess.TimeoutExpired, OSError) as e:
        return 2, f"COULD-NOT-CHECK: rule-check.ts did not run: {e}", 0
    try:
        res = json.loads([l for l in r.stdout.splitlines() if l.strip()][-1])
        verdicts, unavailable = res["verdicts"], res["unavailable"]
    except (IndexError, ValueError, KeyError, TypeError):
        return 2, f"COULD-NOT-CHECK: rule-check.ts exit {r.returncode} printed no verdict line\n{(r.stdout + r.stderr).strip()[-1500:]}", 0
    lines = [f"  {v['rule']} p={v['p']:.2f}" + (f" at {', '.join(v['spans'][:5])}" if v.get("spans") else "")
             for v in verdicts if v.get("verdict") == "VIOLATED"]
    lines += [f"  {u['rule']} could not be judged: {u['reason']}" for u in unavailable]
    rc = 2 if unavailable or r.returncode not in (0, 2) else (1 if lines else 0)
    head = f"jev rules {rdir.relative_to(ROOT)} exit {rc}:\n" + "\n".join(lines) if lines else ""
    return rc, head, len(verdicts)


def main() -> int:
    a = sys.argv[1:]
    def opt(name):
        return a[a.index(name) + 1] if name in a else None
    domain = opt("--domain")
    if domain not in DOMAINS:
        print(__doc__)
        return 2
    kinds = classify(domain)
    if "--list" in a:
        print(json.dumps({"domain": domain, "constraints": sorted(sum(kinds.values(), [])), **kinds,
                          "rulesDir": str(rules_dir(domain).relative_to(ROOT)) if rules_dir(domain) else None,
                          "dq": domain == "ds"}))
        return 0
    project, plan = opt("--project-dir"), opt("--plan")
    cwd, stamp, log = opt("--cwd"), opt("--stamp"), opt("--log")
    if project:
        base = Path(project).resolve()
        files = changed(base)
    elif cwd and stamp and log:
        base = Path(cwd).resolve()
        expects = [a[i + 1] for i, x in enumerate(a) if x == "--expect" and i + 1 < len(a)]
        files = touched(base, Path(stamp), Path(log), expects)
    else:
        print(__doc__)
        return 2
    planp = Path(plan).resolve() if plan else None
    # the code checkers run on a flat copy, away from the project's config: hand them its declared helpers
    sys.path.insert(0, str(CONSTRAINTS))
    from _ds_logging import declared_helpers
    os.environ.setdefault("DS_AUDIT_HELPERS", ",".join(sorted(declared_helpers(base))))
    chart_code = {p for p in files if draws_chart(p)}
    figs = {p for p in files if p.suffix.lower() in FIGURE}
    py = sorted(p for p in files if p.suffix.lower() == ".py")
    worst, report, ran, examined = 0, [], [], 0

    def note(rc, text=""):
        nonlocal worst
        worst = max(worst, 0 if rc == 0 else (1 if rc == 1 else 2))
        if rc != 0 and text:
            report.append(text)

    if kinds["chart"]:
        if chart_code or figs:
            dirs = sorted({p.parent for p in (chart_code or figs)})
            for d in dirs:
                for script in kinds["chart"]:
                    rc, out = run(script, d, *CHART_ARGS[script])
                    note(rc, block(f"{script} {d}{' --render' if CHART_ARGS[script] else ''}", rc, out))
            examined += len(dirs) * len(kinds["chart"])
            ran.append(f"{len(kinds['chart'])} chart linter(s) on {len(dirs)} dir(s)")
        else:
            ran.append("chart linters: no chart code or figure touched")
    if kinds["code"]:
        if py:
            rc, blocks = check_code(kinds["code"], py)
            note(rc)
            report += blocks
            examined += len(kinds["code"])
            ran.append(f"{len(kinds['code'])} code checker(s) on {len(py)} .py file(s)")
        else:
            ran.append("code checkers: no .py touched")
    if kinds["plan"]:
        if planp:
            for script in kinds["plan"]:
                rc, out = run(script, base)
                note(rc, block(script, rc, out))
            examined += len(kinds["plan"])
            ran.append(f"{len(kinds['plan'])} plan checker(s)")
        else:
            ran.append("plan checkers: no plan given")
    if domain == "ds" and planp:
        rc, out = data_quality(planp, base)
        note(rc, block("ds-dq", rc, out))
        counts = [l for l in out.splitlines() if l.startswith("ds-dq: ")]
        if rc == 0 and counts:
            print(counts[-1])
        examined += 1
        ran.append("ds-dq")
    if "--skip-rules" in a:
        ran.append("jev rules: scored by the plan's ruleChecks")
    else:
        pool = [p for p in files if p.suffix.lower() in (DEV_SOURCE if domain == "dev" else CODE)]
        if project or pool:
            rc, out, scored = score_rules(domain, pool, base if project else None, planp, base.name)
            note(rc, out)
            examined += scored
            ran.append(f"jev rules: {scored} scored")
        else:
            ran.append("jev rules: no code touched")
    why = "; ".join(ran) or "no constraint script matches this domain"
    print(f"{domain}-gate: {examined} check(s) examined ({why})" + (f" — nothing in scope ({why})" if examined == 0 else ""))
    if report:
        print("\n\n".join(report))
    return worst


if __name__ == "__main__":
    raise SystemExit(main())
