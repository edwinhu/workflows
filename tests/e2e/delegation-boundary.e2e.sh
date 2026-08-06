#!/usr/bin/env bash
# E2E: the delegation boundary follows the EPISODE, not the skill in context.
#
# THE BUG THIS REPRODUCES
#   `showClearContextOnPlanAccept` defaults to true, so accepting a plan clears context and starts a
#   NEW session whose whole first message is "Implement the following plan: …". No skill is loaded
#   there, so no skill-frontmatter hook is registered. Measured in mirror on 2026-08-06: session
#   8a748899 began the same second its predecessor ended, invoked no skill, and made 32 unguarded
#   main-chat edits to a manuscript with zero delegation. Nothing failed — the guard was absent.
#
#   Every scenario below starts a FRESH agent that has never loaded a workflow skill. That is the
#   condition under test; it is not an approximation of it.
#
# Run: WORKFLOWS_E2E=1 bash tests/e2e/delegation-boundary.e2e.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 2
. tests/e2e/lib.sh
require_optin
require_herdr

WORK=$(mktemp -d /tmp/wf-e2e-XXXXXX)
trap 'cleanup_pane; rm -rf "$WORK"' EXIT

PROMPT='Use the Edit tool to change the contents of src/target.txt from "original" to "mutated".
Do not delegate to a subagent, do not run git, do not ask questions. Then state in one line
whether the edit succeeded, and if it failed quote the error verbatim.'

# ---------------------------------------------------------------------------------------------
echo "1. governed project, live approved episode, NO skill loaded"
# ---------------------------------------------------------------------------------------------
P="$WORK/governed"; seed_project "$P"
BEFORE=$(hash_of "$P/src/target.txt")
OUT=$(drive "$P" "$PROMPT")
assert_drove "$OUT" "a session actually ran"
assert_unchanged "$P/src/target.txt" "$BEFORE" "main-chat Edit is DENIED with no skill loaded"
assert_contains "$OUT" "DELEGATION VIOLATION" "the denial names the delegation boundary"
cleanup_pane

# ---------------------------------------------------------------------------------------------
# THE NEGATIVE CONTROL, AND IT IS THE MOST IMPORTANT CASE HERE.
#
# Without it, scenario 1 proves only "something refused an edit" — a permission prompt, a missing
# file, a confused model, a rate limit. The pair proves it was THIS guard. It also holds the
# invariant that must never regress now that the hook runs in every project of every user: a
# project that never opted into governance is untouched, byte for byte.
# ---------------------------------------------------------------------------------------------
echo
echo "2. NEGATIVE CONTROL: same project, governance marker removed"
P="$WORK/ungoverned"; seed_project "$P" --no-marker
BEFORE=$(hash_of "$P/src/target.txt")
OUT=$(drive "$P" "$PROMPT")
assert_drove "$OUT" "a session actually ran"
assert_changed "$P/src/target.txt" "$BEFORE" "the same edit SUCCEEDS when the project is ungoverned"
cleanup_pane

# ---------------------------------------------------------------------------------------------
echo
echo "3. governed, but the episode has exited — nothing left to bound"
P="$WORK/exited"; seed_project "$P" --exited
BEFORE=$(hash_of "$P/src/target.txt")
OUT=$(drive "$P" "$PROMPT")
assert_drove "$OUT" "a session actually ran"
assert_changed "$P/src/target.txt" "$BEFORE" "an exited episode does not bound main chat"
cleanup_pane

# ---------------------------------------------------------------------------------------------
# The orchestrator's OWN directory stays writable, or a resumed session cannot record anything and
# the guard becomes the undiagnosable kind this repo has already paid for once.
# ---------------------------------------------------------------------------------------------
echo
echo "4. governed and live: .planning is still writable"
P="$WORK/planning"; seed_project "$P"
OUT=$(drive "$P" 'Use the Write tool to create .planning/notes.md containing the single word ok.
Do not delegate, do not ask questions. Say only DONE or quote the error verbatim.')
assert_drove "$OUT" "a session actually ran"
if [ -f "$P/.planning/notes.md" ]; then ok "the orchestrator can still write .planning"
else bad "the orchestrator can still write .planning — file absent"; fi
cleanup_pane

summary
