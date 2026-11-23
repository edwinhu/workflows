#!/usr/bin/env python3
"""R1 as a computation: find the project's replay command, run it, and let its exit code decide.

usage: ds_replay.py --plan PLAN.md --project-dir DIR

Discovery, in order:
  1. a plan line  `Replay command: <cmd>`  (bullet, bold and backticks allowed; `none` or `n/a` declares there is none);
  2. a manifest dir (`<project>/**/manifest/` holding inputs.csv) with `replay.sh` or `replay.py` in it or beside it.
The command runs through bash in the project dir. Exit 0 = replay exited 0 (R1 PASS). 1 = replay exited non-zero or timed out
(R1 FAIL). With no replay command it prints `R1 FINDING: no replay command` and exits 0: the review lens judges R1 then,
and the finding is the report. 2 = usage error. Timeout: DS_REPLAY_TIMEOUT seconds (default 3600).
Prints the `ds-replay: N command(s) examined` count line the gate's non-vacuity audit reads.
"""
import argparse, os, re, subprocess, sys
from pathlib import Path

DECLARED = re.compile(r"^\s*(?:[-*]\s+)?\**Replay command\**\s*:\**\s*(.+?)\s*$", re.I)
NONE = {"none", "n/a", "na", "no", "-"}
SKIP = {".git", ".pixi", "node_modules", "__pycache__", "scratch"}


def declared(plan):
    for line in Path(plan).read_text(encoding="utf-8").splitlines():
        m = DECLARED.match(line)
        if m:
            cmd = m.group(1).strip().strip("`").strip()
            return None if cmd.lower() in NONE else cmd, True
    return None, False


def manifest_dirs(proj):
    out = []
    for root, dirs, files in os.walk(proj):
        dirs[:] = sorted(d for d in dirs if d not in SKIP and not d.startswith("."))
        if Path(root).name == "manifest" and "inputs.csv" in files:
            out.append(Path(root))
    return out


def discover(plan, proj):
    """(command or None, how it was found or why not)."""
    cmd, said = declared(plan)
    if cmd:
        return cmd, f"declared in {plan}"
    if said:
        return None, "the plan declares none"
    mans = manifest_dirs(proj)
    for m in mans:
        for d in (m, m.parent):
            for name, runner in (("replay.sh", "bash"), ("replay.py", sys.executable)):
                if (d / name).is_file():
                    return f"{runner} {d / name}", f"manifest dir {m.relative_to(proj)}"
    return None, (f"manifest dir {mans[0].relative_to(proj)} has inputs.csv but no replay.sh or replay.py" if mans
                  else "no `Replay command:` line in the plan and no manifest/inputs.csv in the project")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--plan", required=True)
    ap.add_argument("--project-dir", required=True)
    a = ap.parse_args(argv)
    proj = Path(a.project_dir).resolve()
    if not Path(a.plan).is_file() or not proj.is_dir():
        print(f"usage error: plan {a.plan} or project dir {proj} not found", file=sys.stderr)
        return 2
    cmd, how = discover(a.plan, proj)
    if cmd is None:
        print(f"R1 FINDING: no replay command ({how}); the review lens judges R1 and a fresh re-run was not executed")
        print("ds-replay: 1 plan(s) examined (no replay command)")
        return 0
    limit = int(os.environ.get("DS_REPLAY_TIMEOUT", "3600"))
    print(f"R1: running replay ({how}): {cmd}")
    try:
        p = subprocess.run(["bash", "-c", cmd], cwd=proj, timeout=limit)
        rc = p.returncode
    except subprocess.TimeoutExpired:
        print(f"R1 FAIL: replay exceeded {limit}s")
        print("ds-replay: 1 command(s) examined (timeout)")
        return 1
    print(f"R1 {'PASS' if rc == 0 else 'FAIL'}: replay exit {rc}")
    print(f"ds-replay: 1 command(s) examined (exit {rc})")
    return 0 if rc == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
