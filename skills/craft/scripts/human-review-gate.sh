#!/usr/bin/env bash
# Human review gate for the craft skill: launch tuicr BLOCKING (via the tuicr skill's launcher,
# a dotfiles asset), then read the persisted session and emit ONE JSON verdict on stdout:
#
#   {"verdict":"approved",   "reviewed_count":N, ...}   files marked reviewed, zero new comments
#   {"verdict":"findings",   "comments":[...], ...}     new human-authored annotations to address
#   {"verdict":"rejected",   "comments":[...], ...}     a new comment contains \bREJECT\b, or the
#                                                       PR review decision is CHANGES_REQUESTED
#   {"verdict":"unreviewed", ...}                       opened-and-quit: zero comments AND zero
#                                                       files marked reviewed — NOT approval
#
# usage: human-review-gate.sh <tuicr args...>     e.g.  -w | -r <range> | pr <N>   (+ --no-update-check)
#
# Comments are read from files.*.line_comments + files.*.file_comments + top-level review_comments,
# filtered to author=="user" and created_at > launch time. `tuicr review comments` output is NOT
# used — it lacks the author field, so it can't separate human notes from Claude's replies.
set -euo pipefail

SKILLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LAUNCHER="$SKILLS_DIR/tuicr/scripts/launch-tuicr.sh"
RESOLVER="$SKILLS_DIR/tuicr/scripts/resolve-session.sh"
SESSIONS_DIR="$HOME/.local/share/tuicr/reviews/sessions"
[ -x "$LAUNCHER" ] || { echo "error: tuicr launcher not found at $LAUNCHER" >&2; exit 1; }

BEFORE=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Blocking: returns when the user quits the TUI. Launcher prints TUICR_RC=<n>; pass it through
# to stderr so the verdict JSON stays alone on stdout.
"$LAUNCHER" "$@" >&2

# Newest session for this repo (resolver matches by cwd; falls back to newest mtime file).
SLUG=$("$RESOLVER" 2>/dev/null || true)

CRAFT_SCRIPTS=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BEFORE="$BEFORE" SLUG="$SLUG" SESSIONS_DIR="$SESSIONS_DIR" CRAFT_SCRIPTS="$CRAFT_SCRIPTS" python3 - "$@" <<'PY'
import glob, json, os, re, subprocess, sys

before = os.environ["BEFORE"]
slug = os.environ.get("SLUG", "")
sessions_dir = os.environ["SESSIONS_DIR"]

def load(path):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None

# Locate the session file: slug filenames are opaque hex, so pick the session with the newest
# updated_at (we just closed the TUI, so ours is the most recently written).
candidates = [(p, load(p)) for p in glob.glob(os.path.join(sessions_dir, "*.json"))]
candidates = [(p, d) for p, d in candidates if d]
if not candidates:
    print(json.dumps({"verdict": "unreviewed", "error": "no tuicr session files found", "slug": slug}))
    sys.exit(0)
path, sess = max(candidates, key=lambda pd: pd[1].get("updated_at", ""))

comments = []
def collect(items, fpath):
    for c in items or []:
        if c.get("author") != "user":
            continue
        if c.get("created_at", "") <= before:
            continue
        comments.append({
            "path": fpath,
            "line": c.get("_line"),
            "content": c.get("content", ""),
            "type": c.get("comment_type", "note"),
            "created_at": c.get("created_at", ""),
        })

collect(sess.get("review_comments"), None)  # review-level notes
for fpath, f in (sess.get("files") or {}).items():
    collect(f.get("file_comments"), fpath)
    for line, items in (f.get("line_comments") or {}).items():
        for c in items or []:
            c["_line"] = line
        collect(items, fpath)

reviewed_count = sum(1 for f in (sess.get("files") or {}).values() if f.get("reviewed"))

_scripts = os.environ["CRAFT_SCRIPTS"]
sys.path.insert(0, _scripts)
from importlib.machinery import SourceFileLoader
_rv = SourceFileLoader("review_verdict", os.path.join(_scripts, "review-verdict.py")).load_module()
rejected = bool(_rv.REJECT_RE.search(" ".join(c["content"] for c in comments)))

# PR path: request-changes on the forge is also a rejection.
pr = sess.get("pr_session_key") or {}
if not rejected and pr.get("number"):
    try:
        out = subprocess.run(
            ["gh", "pr", "view", str(pr["number"]), "--json", "reviewDecision"],
            capture_output=True, text=True, timeout=30,
        )
        if out.returncode == 0 and json.loads(out.stdout or "{}").get("reviewDecision") == "CHANGES_REQUESTED":
            rejected = True
    except Exception:
        pass  # forge check is best-effort; local comments still decide

verdict = _rv.verdict(comments, reviewed_count, changes_requested=rejected)

print(json.dumps({
    "verdict": verdict,
    "slug": slug,
    "session_file": path,
    "reviewed_count": reviewed_count,
    "comments": comments,
}, indent=1))
PY
