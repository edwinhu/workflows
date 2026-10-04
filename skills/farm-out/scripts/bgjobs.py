#!/usr/bin/env python3
"""Background jobs a farm child started and did not wait for.

A farm child is a `-p` session: when its turn ends the session exits, and whatever it backgrounded
dies with it or runs on with nobody to read it. release-6381b (2026-10-03) backgrounded
`scripts/canary.sh --run`, ended on "Still waiting on the canary.", and left a pushed release with
no tag. farm.sh exports FARM_ROW_ID into the child only, so every process the child starts carries
it -- including a `setsid nohup` that escapes the process group.

  bgjobs.py hook                 Stop hook. In a farm child, blocks the turn end while a job lives.
  bgjobs.py reap ROW_ID LOG      farm.sh, after the child exits: prints a JSON array of orphaned jobs
                                 ({cmd, source, status[, pid]}) and kills any still running.

A job is a run_in_background shell (the harness launches every Bash command through a shell that
sources a `shell-snapshots/snapshot-*` file) or a process that left the child's tree. Plain children
of the session -- MCP servers, hooks -- are neither. FARM_BG_IGNORE (a regex over the command line)
exempts daemons a child may legitimately leave behind.
"""
import json
import os
import re
import signal
import sys
import tempfile
import time

MAX_BLOCKS = 8
IGNORE = re.compile(os.environ.get("FARM_BG_IGNORE") or r"\[mux\]|ssh-agent|gpg-agent|\bzg server\b")
SNAPSHOT = "shell-snapshots/snapshot-"


def procs():
    """pid -> (ppid, argv string, env FARM_ROW_ID) for every live, non-zombie process we can read."""
    out = {}
    for d in os.listdir("/proc"):
        if not d.isdigit():
            continue
        try:
            with open(f"/proc/{d}/stat") as fh:
                rest = fh.read().rsplit(")", 1)[1].split()
            if rest[0] == "Z":
                continue
            with open(f"/proc/{d}/cmdline", "rb") as fh:
                argv = fh.read().rstrip(b"\0").replace(b"\0", b" ").decode("utf-8", "replace")
            with open(f"/proc/{d}/environ", "rb") as fh:
                env = fh.read().split(b"\0")
        except (OSError, IndexError):
            continue
        row = next((e[12:].decode("utf-8", "replace") for e in env if e.startswith(b"FARM_ROW_ID=")), None)
        out[int(d)] = (int(rest[1]), argv, row)
    return out


def ancestors(table, pid):
    seen = []
    while pid in table and pid not in seen:
        seen.append(pid)
        pid = table[pid][0]
    return seen


def shown(argv):
    """The command a snapshot shell evals, as the model wrote it; anything else as-is."""
    if SNAPSHOT in argv and "eval '" in argv:
        body = argv.split("eval '", 1)[1]
        body = body.rsplit("' < /dev/null", 1)[0]
        return body.replace("'\"'\"'", "'")
    return argv


def jobs(row, root=None, exclude=()):
    """Live jobs carrying FARM_ROW_ID=row, as [(pid, cmd)], one per job root.

    root: the pid whose subtree is the child's own tree. A process outside it escaped; inside it,
    only a snapshot shell (and what runs under it) is a job. None: every row process is a job.
    """
    table = procs()
    mine = {p for p, (_, _, r) in table.items() if r == row} - set(exclude)
    if root is not None and root in table:
        tree = {p for p in mine if root in ancestors(table, p)}
    else:
        tree = set()
    found = []
    for p in sorted(mine):
        chain = ancestors(table, p)
        if p in tree:
            snaps = [a for a in chain if a in tree and SNAPSHOT in table[a][1]]
            if not snaps or snaps[-1] != p:
                continue  # not under a snapshot shell, or under one we report instead
        else:
            if IGNORE.search(table[p][1]):
                continue
            parent = table[p][0]
            if parent in mine and parent not in tree:
                continue  # its escaped parent is the job
        found.append((p, shown(table[p][1])))
    return found


def hook():
    if os.environ.get("FARM_OUT_CHILD") != "1" or not os.environ.get("FARM_ROW_ID"):
        return
    row = os.environ["FARM_ROW_ID"]
    try:
        payload = json.load(sys.stdin)
    except ValueError:
        payload = {}
    table = procs()
    me = ancestors(table, os.getpid())
    # The topmost ancestor carrying the row id is where farm.sh started the child; everything the
    # child runs without escaping lives under it.
    marked = [a for a in me if table[a][2] == row]
    if not marked:
        return
    live = jobs(row, root=marked[-1], exclude=me)
    if not live:
        return
    sess = re.sub(r"[^A-Za-z0-9._-]", "", str(payload.get("session_id") or "unknown"))[:96] or "unknown"
    counter = os.path.join(os.environ.get("TMPDIR") or tempfile.gettempdir(), f"farm-bgjob-{sess}.json")
    try:
        with open(counter) as fh:
            n = int(json.load(fh).get("blocks", 0))
    except (OSError, ValueError, AttributeError):
        n = 0
    listing = "; ".join(f"{cmd} (pid {pid})" for pid, cmd in live)
    if n >= MAX_BLOCKS:
        note = (f"farm child: ALLOWING the stop with background job(s) still running after {n} blocks: "
                f"{listing}. They die with this session and farm.sh fails the row naming them.")
        print(note, file=sys.stderr)
        print(json.dumps({"systemMessage": note}))
        return
    try:
        with open(counter, "w") as fh:
            json.dump({"blocks": n + 1}, fh)
    except OSError:
        pass
    print(json.dumps({"decision": "block", "reason": (
        f"You are an unattended farm child and a background job you started is still running: {listing}. "
        "Ending your turn now exits this session, kills the job, and fails your row. Wait for it in the "
        "FOREGROUND -- TaskOutput with block=true, or Bash `while kill -0 <pid> 2>/dev/null; do sleep 30; done` "
        "-- then read its output and finish the deliverable. If the job is genuinely not needed, kill it first. "
        f"(block {n + 1}/{MAX_BLOCKS})")}))


def stream_orphans(log):
    """Tasks the harness ended AFTER the child's final result -- the turn ended with them running."""
    events = []
    try:
        with open(log, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                try:
                    events.append(json.loads(line))
                except ValueError:
                    pass
    except OSError:
        return []
    events = [e for e in events if isinstance(e, dict)]
    uses, started, ended = {}, {}, {}
    last_result = -1
    for i, e in enumerate(events):
        t, st = e.get("type"), e.get("subtype")
        if t == "assistant":
            for c in (e.get("message") or {}).get("content") or []:
                if isinstance(c, dict) and c.get("type") == "tool_use":
                    uses[c.get("id")] = c
        elif t == "result":
            last_result = i
        elif t == "system" and st == "task_started" and e.get("task_id"):
            started.setdefault(e["task_id"], (i, e))
        elif t == "system" and st in ("task_updated", "task_notification") and e.get("task_id"):
            status = (e.get("patch") or {}).get("status") if st == "task_updated" else e.get("status")
            if status in ("completed", "failed", "killed", "stopped") and e["task_id"] not in ended:
                ended[e["task_id"]] = (i, status)
    out = []
    for tid, (i, e) in started.items():
        end_i, status = ended.get(tid, (None, "running"))
        if end_i is not None and end_i < last_result:
            continue
        use = uses.get(e.get("tool_use_id")) or {}
        cmd = (use.get("input") or {}).get("command") or e.get("description") or tid
        out.append({"cmd": cmd, "source": "stream", "status": status})
    return out


def reap(row, log):
    out = stream_orphans(log)
    # Grace: a session's own helpers (MCP servers) shut down just after it exits.
    deadline = time.time() + float(os.environ.get("FARM_BG_GRACE") or 2)
    live = jobs(row)
    while live and time.time() < deadline:
        time.sleep(0.1)
        live = jobs(row)
    for pid, cmd in live:
        out.append({"cmd": cmd, "source": "process", "status": "running", "pid": pid})
    # The row is over and nobody will read these: stop them rather than let them write into the
    # tree after the caller has been told the row finished.
    victims = [p for p, (_, _, r) in procs().items() if r == row]
    for p in victims:
        try:
            os.kill(p, signal.SIGTERM)
        except OSError:
            pass
    for _ in range(50):
        if not any(r == row for _, _, r in procs().values()):
            break
        time.sleep(0.1)
    else:
        for p, (_, _, r) in procs().items():
            if r == row:
                try:
                    os.kill(p, signal.SIGKILL)
                except OSError:
                    pass
    print(json.dumps(out))


if __name__ == "__main__":
    if sys.argv[1:2] == ["hook"]:
        try:
            hook()
        except Exception as exc:  # noqa: BLE001 -- a Stop hook fails open
            print(f"bgjobs hook: {exc}", file=sys.stderr)
    elif sys.argv[1:2] == ["reap"] and len(sys.argv) == 4:
        reap(sys.argv[2], sys.argv[3])
    else:
        sys.exit("usage: bgjobs.py hook | bgjobs.py reap ROW_ID LOG")
