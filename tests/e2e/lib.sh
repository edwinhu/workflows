#!/usr/bin/env bash
# Shared library for workflow end-to-end tests: seed a real project, drive a real Claude Code
# session through Herdr, assert on what the hooks actually did.
#
# WHY THIS LAYER EXISTS
#   Every other suite in this repo asserts about FILES — that a router presents the beats, that a
#   skill reaches a beat, that a hook denies a synthetic payload. On 2026-08-06 all of them were
#   green while enforcement was absent for an entire implementation phase, because none of them can
#   see a SESSION. The defect was that `showClearContextOnPlanAccept` starts a new session with no
#   skill loaded, so the skill-frontmatter guard was never registered; the thing that caught it was
#   a human reading a transcript.
#
#   These tests drive the real binary against a real project and assert on the FILESYSTEM
#   afterwards. The agent's own narration is never the evidence: an agent that says "the edit was
#   blocked" is an untrusted reporter, and the whole codebase's posture is that self-report is not
#   proof. `assert_unchanged`/`assert_changed` hash the file instead.
#
# COST, AND WHY THIS IS OPT-IN
#   Each scenario spends real tokens on a real account. Nothing here runs unless WORKFLOWS_E2E=1,
#   so `scripts/check-tests.sh` and CI stay free.
#
# BINARY
#   `claude-code`, not `claude`: the wrapper routes across several OAuth accounts through
#   CLIProxyAPI, and plain `claude` exhausted a weekly limit mid-run the first time this was tried.
set -uo pipefail

E2E_BIN="${E2E_BIN:-claude-code}"
E2E_TIMEOUT_MS="${E2E_TIMEOUT_MS:-240000}"
PASS=0; FAIL=0

log()  { printf '  %s\n' "$*"; }
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$*"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$*"; }
# A beat whose precondition never happened is UNJUDGED, not passed and not failed. Counting it
# either way invents a result: the first run reported REVIEW as `ok` on an episode that had no
# approved plan and no implementation.
skip() { printf '  skip %s\n' "$*"; }

require_herdr() {
  [ "${HERDR_ENV:-}" = 1 ] || { echo "not inside Herdr (HERDR_ENV != 1); cannot drive a session" >&2; exit 2; }
  command -v herdr >/dev/null || { echo "herdr not on PATH" >&2; exit 2; }
  command -v "$E2E_BIN" >/dev/null || { echo "$E2E_BIN not on PATH" >&2; exit 2; }
}

require_optin() {
  [ "${WORKFLOWS_E2E:-}" = 1 ] || {
    echo "WORKFLOWS_E2E=1 not set — skipping (these tests spend real tokens)."; exit 0; }
}

# ---------------------------------------------------------------------------------------------
# PIN THE BUILD UNDER TEST.
#
# A fixture with no plugin pinned loads whatever is installed at user scope. Measured 2026-08-06:
# this suite ran green against the RELEASED 5.138.0, which does not contain the change under test,
# and the result was read as evidence about the working tree. A test that does not pin its subject
# measures the ambient environment.
#
# Adding the dev checkout as a marketplace OVERWRITES the user's `edwinhu-plugins` entry, because
# the repo's marketplace.json declares that same name. That is a global mutation to the developer's
# config, so it is saved and restored — it was left behind once already.
# ---------------------------------------------------------------------------------------------
E2E_MARKETPLACE_BACKUP="${TMPDIR:-/tmp}/e2e-marketplace-backup.json"

pin_plugin_build() {
  local repo="${1:-$PWD}"
  python3 -c "
import json, pathlib, sys
s = pathlib.Path.home()/'.claude/settings.json'
d = json.loads(s.read_text())
pathlib.Path(sys.argv[1]).write_text(json.dumps(d.get('extraKnownMarketplaces', {}).get('edwinhu-plugins')))
" "$E2E_MARKETPLACE_BACKUP" || return 1
  claude plugin marketplace add "$repo" >/dev/null 2>&1
}

unpin_plugin_build() {
  [ -f "$E2E_MARKETPLACE_BACKUP" ] || return 0
  python3 -c "
import json, pathlib, sys
prev = json.loads(pathlib.Path(sys.argv[1]).read_text())
s = pathlib.Path.home()/'.claude/settings.json'
d = json.loads(s.read_text())
mk = d.setdefault('extraKnownMarketplaces', {})
if prev is None: mk.pop('edwinhu-plugins', None)
else: mk['edwinhu-plugins'] = prev
s.write_text(json.dumps(d, indent=2) + chr(10))
" "$E2E_MARKETPLACE_BACKUP"
  rm -f "$E2E_MARKETPLACE_BACKUP"
  claude plugin marketplace update edwinhu-plugins >/dev/null 2>&1 || true
}

# ---------------------------------------------------------------------------------------------
# Fixture: a project in the exact state a cleared-context session inherits.
#
#   seed_project <dir> [--no-marker] [--no-episode] [--exited] [--workflow NAME]
#
# The receipt and the episode record are what a real run leaves on disk: `approved-artifact-persist`
# writes the receipt at ExitPlanMode and `episode-phase` writes the episode from an OBSERVED
# AskUserQuestion. Seeding them directly is legitimate because the guard reads them as evidence; it
# never asks the model what phase it is in.
# ---------------------------------------------------------------------------------------------
seed_project() {
  local dir="$1"; shift
  local marker=1 episode=1 exited=false workflow=writing
  while [ $# -gt 0 ]; do
    case "$1" in
      --no-marker)  marker=0 ;;
      --no-episode) episode=0 ;;
      --exited)     exited=true ;;
      --workflow)   shift; workflow="$1" ;;
      *) echo "seed_project: unknown option $1" >&2; return 2 ;;
    esac
    shift
  done
  mkdir -p "$dir/.planning/.state" "$dir/.claude" "$dir/src"
  [ -d "$dir/.git" ] || git -C "$dir" init -q
  printf '# Plan\n\nThe approved plan for this episode.\n' > "$dir/.planning/approved-plan.md"
  printf 'original\n' > "$dir/src/target.txt"
  printf '{"plansDirectory": "./.planning"}\n' > "$dir/.claude/settings.json"
  [ "$marker" = 1 ] && printf '{"governed": true}\n' > "$dir/.claude-workflows.json"
  [ "$episode" = 1 ] && WF="$workflow" EXITED="$exited" python3 - "$dir" <<'PY'
import json, hashlib, os, pathlib, sys
d = pathlib.Path(sys.argv[1])
h = hashlib.sha256((d/".planning/approved-plan.md").read_bytes()).hexdigest()
exited = os.environ["EXITED"] == "true"
json.dump({"workflow": os.environ["WF"], "plan_file": "approved-plan.md", "plan_hash": h,
           "approved_session_id": "sess-approve", "approved_at": "2026-08-06T04:00:00.000Z",
           "status": "APPROVED", "reviewer_session_id": "sess-review",
           "reviewed_at": "2026-08-06T04:30:00.000Z"},
          open(d/".planning/.state/review.json", "w"))
json.dump({"schemaVersion": 1, "workflow": os.environ["WF"], "planFile": "approved-plan.md",
           "planHash": h, "sessionId": "sess-approve",
           "phases": {"clarified": "2026-08-06T03:50:00.000Z"}, "reviewOwed": False,
           "reviewBlocks": 0,
           "exit": {"at": "2026-08-06T05:00:00.000Z", "reason": "completed"} if exited else None,
           "editsSinceVerify": 0, "planBindingBlocks": 0},
          open(d/".planning/.state/episode.json", "w"))
PY
  # Install the pinned build INTO this fixture so the session under test loads the working tree
  # rather than the released plugin. Local scope keeps it inside the fixture directory.
  ( cd "$dir" && claude plugin install workflows --scope local >/dev/null 2>&1 )
  return 0
}

# ---------------------------------------------------------------------------------------------
# Drive one prompt through a Herdr-managed agent and return its pane transcript on stdout.
#
#   drive <project-dir> <prompt>
#
# A fresh pane and a fresh agent per scenario, because the whole point is a session that has never
# loaded a skill. Reusing one agent across scenarios would carry skill activation forward and
# quietly test the opposite of what is claimed.
# ---------------------------------------------------------------------------------------------
drive() {
  local dir="$1" prompt="$2" pane rc
  E2E_LAST_PANE=""; E2E_TRANSCRIPT=""
  local stamp; stamp="e2e-$(date +%s%N | tail -c 8)"
  E2E_TRANSCRIPT="${E2E_TRANSCRIPT_DIR:-/tmp}/$stamp.txt"

  pane=$(herdr pane split --current --direction right --cwd "$dir" --no-focus \
          | python3 -c 'import json,sys; print(json.load(sys.stdin)["result"]["pane"]["pane_id"])') || return 1
  E2E_LAST_PANE="$pane"

  # HEADLESS `-p` INSIDE A HERDR PANE, NOT `herdr agent start`.
  #
  # Two reasons, both learned the hard way:
  #   1. BINARY. `herdr agent start --kind claude` runs the CANONICAL executable for that kind —
  #      plain `claude` — and there is no override. Plain `claude` uses the claude.ai subscription
  #      and exhausted a weekly limit mid-run. `claude-code` wraps several OAuth accounts through
  #      CLIProxyAPI. Running the command ourselves is the only way to choose the binary.
  #   2. TRANSCRIPT. The interactive TUI draws on the terminal's ALTERNATE SCREEN, and rows that
  #      leave it never enter Herdr's scrollback, so `agent read` cannot recover a finished
  #      response. Redirecting `-p` output to a file makes the transcript exact and complete.
  local script="$dir/.e2e-run.sh"
  { printf '#!/usr/bin/env bash\n'
    printf 'cd %q || exit 3\n' "$dir"
    printf '%q -p --permission-mode acceptEdits %q > %q 2>&1\n' "$E2E_BIN" "$prompt" "$E2E_TRANSCRIPT"
    printf 'printf "E2E_DONE_%%s\\n" "$?" >> %q\n' "$E2E_TRANSCRIPT"
  } > "$script"
  chmod +x "$script"

  herdr pane run "$pane" "bash $script" >/dev/null 2>&1 || return 1
  herdr pane wait-output "$pane" --match "E2E_DONE_" --timeout "$E2E_TIMEOUT_MS" >/dev/null 2>&1
  rc=$?
  rm -f "$script"
  return $rc
}

# Read back the last transcript. Empty if `drive` never produced one.
#
# THIS FUNCTION WAS DELETED ONCE, by the edit that rewrote `drive`, because it lived between
# `drive()` and `cleanup_pane()` and the rewrite replaced that whole region. The harness then
# reported "the session never ran" about a session that had just run and written its transcript to
# disk. It sits BELOW cleanup_pane so a future rewrite of `drive` cannot take it along.
transcript() { [ -n "${E2E_TRANSCRIPT:-}" ] && [ -f "$E2E_TRANSCRIPT" ] && cat "$E2E_TRANSCRIPT" || true; }

cleanup_pane() {
  [ -n "${E2E_LAST_PANE:-}" ] && herdr pane close "$E2E_LAST_PANE" >/dev/null 2>&1
  E2E_LAST_PANE=""; E2E_LAST_AGENT=""
}

# ---------------------------------------------------------------------------------------------
# Assertions on the FILESYSTEM, never on the agent's narration.
# ---------------------------------------------------------------------------------------------
hash_of() { sha256sum "$1" | cut -d' ' -f1; }

assert_unchanged() { # <file> <before-hash> <label>
  if [ "$(hash_of "$1")" = "$2" ]; then ok "$3"; else bad "$3 — file WAS modified"; fi
}
assert_changed() {   # <file> <before-hash> <label>
  if [ "$(hash_of "$1")" != "$2" ]; then ok "$3"; else bad "$3 — file was NOT modified"; fi
}
# EVERY SCENARIO MUST CALL THIS BEFORE ANY OTHER ASSERTION.
#
# `assert_unchanged` is satisfied by a session that never ran, so a transport failure would read as
# proof that the guard worked. This turns "the agent never started" into a loud failure instead of a
# silent pass. Measured: the first run of this harness reported 1/2 passed with no session at all.
assert_drove() {   # <transcript> <label>
  case "$1" in
    "") bad "$2 — no transcript: the session never ran; the run proves nothing"; return 1 ;;
    *"weekly limit"*|*"usage limit"*|*"rate limit"*|*"Invalid API key"*|*"Please run /login"*)
       bad "$2 — the session hit a quota or auth error, so nothing was exercised"; return 1 ;;
  esac
  ok "$2"
}

assert_contains() {  # <haystack> <needle> <label>
  case "$1" in *"$2"*) ok "$3" ;; *) bad "$3 — transcript lacks: $2" ;; esac
}

summary() {
  printf '\n%s/%s passed\n' "$PASS" "$((PASS+FAIL))"
  [ "$FAIL" -eq 0 ] || exit 1
}
