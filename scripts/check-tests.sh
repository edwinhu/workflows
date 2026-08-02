#!/usr/bin/env bash
# Run EVERY suite in tests/ — JS, TS AND PYTHON — routing each file to the runner it actually needs.
#
#   ./scripts/check-tests.sh              # all suites
#   ./scripts/check-tests.sh session-flag # only suites whose path matches the filter
#
# WHY THIS EXISTS
#   The repo had disjoint suite styles and no command that ran them all. `bun test <file>` drives a
#   file that imports from "bun:test"; `bun <file>` drives a file that asserts at top level. Each
#   style FAILS under the other runner — `bun test` on a top-level-assert file reports "0 tests" and
#   exits 0, which is the dangerous direction: a suite that is never executed and never complains.
#   So `tests/bash-mutation-matrix.test.mjs`, `tests/implementer-identity-contract.test.mjs`,
#   `tests/lineage-contract.test.mjs`, `tests/session-flag-key.test.ts` and their siblings were
#   reachable only by being typed out by hand, and `scripts/check-all.sh` globs `checks/check-*.py`
#   only, so nothing repo-wide touched them.
#
#   The header then CLAIMED to run every suite while globbing `tests/*.test.{ts,mjs,js}` only, which
#   silently skipped the 20 Python suites in the same directory — the same "asserts coverage it does
#   not have" defect one directory over. Python is now globbed and routed too.
#
#   The routing is DERIVED, not a maintained list:
#     *.test.ts|mjs|js   imports "bun:test" or calls describe/test/it at top level -> `bun test`,
#                        otherwise executed directly with `bun`. (Both signals are needed: two
#                        suites use bun's injected `describe` global with no import at all.)
#     *.py               a file that DEFINES `def test_` functions is collected by pytest; every
#                        other Python file is a top-level-assert script and is executed directly.
#                        Keying on `def test_` rather than on the absence of `sys.exit(` matters:
#                        `tests/workflow_return_shape_test.py` and
#                        `tests/codex_second_pass_join_test.py` have neither, and under pytest they
#                        report "no tests ran" — the same silent-zero failure mode this script was
#                        written to eliminate on the JS side.
#                        pytest is invoked through `uv run --with pytest --with pyyaml` when `uv`
#                        is available — the same invocation `scripts/check-hooks.sh` uses — because
#                        the system interpreter has neither pytest nor pyyaml, and a bare `python3 -m
#                        pytest` fails suites for a reason that has nothing to do with the code.
#   A new suite in any style is picked up with no edit here.
#
# THE QUARANTINE, AND WHY IT IS NOT "CORRECTING THE CLAIM" BY LOWERING IT
#   Running the 20 Python suites for the first time surfaced 6 that FAIL, 4 of them for one
#   pre-existing reason: they open `hooks/<name>.py` for a hook that was migrated to
#   `hooks/<name>.ts` and never had its test updated. Nobody noticed because nothing ran them. That
#   is the finding, not an obstacle to it.
#
#   The list grew to NINE when three TypeScript suites were found failing at HEAD for their own
#   unrelated reasons, and is back to SIX now that the v5.103.1 line fixed three of them. Count the
#   `quarantine_reason` cases, not this sentence: it has been wrong before, which is why the
#   un-quarantine rule below exists and why it, not a comment, is the authority.
#
#   Fixing them is a change to the writing / overflow hooks, unrelated to the work that added this
#   script, so they are QUARANTINED rather than silently dropped: each is named with its reason, the
#   script still runs it, and a quarantined suite that starts PASSING is a FAILURE here. That last
#   rule is what stops the list from becoming permanent — a quarantine you cannot exit is a denylist
#   of inconvenient facts, and it already earned its keep: it caught three suites that were
#   quarantined on a wrong diagnosis (missing `pyyaml`, not a moved path) the moment the runner was
#   corrected to `--with pyyaml`.
#
#   Verified against a clean `git worktree` at HEAD: all 9 fail there identically.
#
# THE ownership_dq_test.py CASE, WHICH IS NOT PAPERED OVER
#   `tests/ownership_dq_test.py` ends in `sys.exit(1 if F else 0)` at module scope. That breaks
#   pytest collection REPO-WIDE (`pytest tests/` aborts on it), and it is pre-existing. The routing
#   above handles it correctly by running it as a script, which is how its own docstring says to run
#   it. It is NOT converted to pytest here: that is a change to a data-quality suite unrelated to
#   this work. The consequence to know is that a bare `pytest tests/` still aborts; use this script.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FILTER="${1:-}"

PASS=0
FAIL=0
SKIP=0
FAILED=()
UNQUARANTINE=()

# suite -> why it fails today. Pre-existing; verified at HEAD in a clean worktree.
quarantine_reason() {
    case "$1" in
        tests/overflow_check_test.py)          echo "opens hooks/overflow-check.py; the hook is now .ts" ;;
        tests/test_mechanical_floor_gate.py)   echo "opens hooks/mechanical-floor-gate.py; the hook is now .ts" ;;
        tests/test_prose_lint_hook.py)         echo "opens hooks/writing-prose-check.py; the hook is now .ts" ;;
        tests/test_writing_mechanical_gate.py) echo "opens hooks/writing-mechanical-gate.py; the hook is now .ts" ;;
        tests/writing_gate_probe_test.py)      echo "probes a writing gate whose response shape changed" ;;
        # tests/workflow-creator-compiler.test.ts was quarantined as "asserts normalizeExpectedOutputs
        # accepts an inventory task-contract.ts now rejects" — a misread. The test asserts REJECTION
        # (ok:false with an "unsafe output path" violation); what actually happened is that
        # compileWorkflowPlan CRASHED on the invalid plan, because it fingerprinted every task before
        # checking violations and fingerprint() throws on exactly those malformed outputs. Reading the
        # throw as "the test is out of date" quarantined a real bug as an obsolete assertion. Fixed by
        # computing fingerprints only for a clean plan; the un-quarantine rule below caught it.
        # FOUR ENTRIES LEFT ON EXIT, NOT DELETED QUIETLY.
        #   tests/load-constraints-applies-to.test.ts, tests/public-extension-contract.test.ts and
        #   tests/test_writing_constraint_lints.py were quarantined at ce17921 and are FIXED by the
        #   v5.103.1 line (external native workflow contracts + the writing constraint rewrite).
        #   The un-quarantine rule below caught all three the first time this ran on the merged tree,
        #   which is exactly what it is for. Verified passing in a clean `git worktree` at 2454e39
        #   before removal, so the credit goes to those commits and not to a dirty working tree.
        *)                                     echo "" ;;
    esac
}

run_suite() {
    local file="$1"; shift
    local -a runner=("$@")
    local output
    local reason; reason="$(quarantine_reason "$file")"
    if output=$("${runner[@]}" 2>&1); then
        if [ -n "$reason" ]; then
            # A quarantined suite that passes must be un-quarantined, or the list rots into a
            # permanent excuse. This is a FAILURE, deliberately.
            printf '  \xe2\x9a\xa0 %s PASSES but is still quarantined (%s) — remove it from the list\n' "$file" "$reason"
            UNQUARANTINE+=("$file")
        else
            printf '  \xe2\x9c\x93 %s (%s %s)\n' "$file" "${runner[0]}" "${runner[1]}"
            PASS=$((PASS + 1))
        fi
    elif [ -n "$reason" ]; then
        printf '  \xe2\x97\x8b %s QUARANTINED: %s\n' "$file" "$reason"
        SKIP=$((SKIP + 1))
    else
        printf '  \xe2\x9c\x97 %s (%s %s)\n' "$file" "${runner[0]}" "${runner[1]}"
        printf '%s\n' "$output" | sed 's/^/    /'
        FAIL=$((FAIL + 1))
        FAILED+=("$file")
    fi
}

# PREFLIGHT: a success-path `process.exit(0)` at top level in a suite file.
#
# THIS SCRIPT IS IMMUNE TO IT — it runs every suite in its OWN process and checks every exit code,
# which is why the pattern went unnoticed for eleven rounds. The invocation people actually TYPED for
# evidence was `bun test tests/*.test.mjs`, and there all 27 files share ONE process: the first
# top-level `process.exit(0)` terminates the run. Measured at e225afb —
# `tests/wc-audit-verify-batch.test.mjs` ended it after 12 of 27 files, bun exited 0 while
# `implementer-identity-contract` was FAILING, and its internal "16/16" was read as a suite total.
# Fifteen suites never ran at all.
#
# So the guard belongs where the mistake is CHEAP to catch rather than where it happens to be
# survivable: a suite must signal success by RETURNING, never by exiting. `process.exit(1)` on
# failure is fine and is what these files now do.
BAD_EXIT="$(grep -lE '^[[:space:]]*process\.exit\((FAIL \? 1 : )?0\)' tests/*.test.ts tests/*.test.mjs tests/*.test.js 2>/dev/null || true)"
if [ -n "$BAD_EXIT" ]; then
    echo "  ✗ suite files exit 0 at top level; under a shared-process runner this truncates the run:"
    printf '      %s\n' $BAD_EXIT
    echo "    Signal success by returning. Use \`if (FAIL) process.exit(1)\` for the failure path."
    exit 1
fi

for file in tests/*.test.ts tests/*.test.mjs tests/*.test.js; do
    [ -f "$file" ] || continue
    [ -z "$FILTER" ] || [[ "$file" == *"$FILTER"* ]] || continue

    if grep -qE 'from "bun:test"|^[[:space:]]*(describe|test|it)\(' "$file"; then
        run_suite "$file" bun test "$file"
    else
        run_suite "$file" bun "$file"
    fi
done

if ! command -v python3 >/dev/null 2>&1; then
    echo "  ! python3 not found; $(ls tests/*.py 2>/dev/null | wc -l) Python suites SKIPPED"
    SKIP=$((SKIP + $(ls tests/*.py 2>/dev/null | wc -l)))
else
    if command -v uv >/dev/null 2>&1; then
        # `lxml` joins pytest/pyyaml for the same reason they are here: the system interpreter does
        # not have it, and without it `tests/test_law_review_footnote_symbols.py` fails on an import
        # of `skills/docx-repair/scripts/fix_footnotes.py` — a gap in THIS RUNNER, not in the
        # law-review work it was reporting as broken.
        PYTEST=(uv run --with pytest --with pyyaml --with lxml python3 -m pytest)
        PYRUN=(uv run --with pyyaml --with lxml python3)
    else
        PYTEST=(python3 -m pytest)
        PYRUN=()
    fi
    for file in tests/*.py; do
        [ -f "$file" ] || continue
        [ -z "$FILTER" ] || [[ "$file" == *"$FILTER"* ]] || continue

        if grep -qE '^[[:space:]]*def test_' "$file"; then
            run_suite "$file" "${PYTEST[@]}" "$file" -q
        elif [ "${#PYRUN[@]}" -gt 0 ]; then
            run_suite "$file" "${PYRUN[@]}" "$file"
        else
            run_suite "$file" python3 "$file"
        fi
    done
fi

echo ""
echo "Results: $PASS passed, $FAIL failed, $SKIP quarantined (pre-existing, each named above)"
if [ "${#UNQUARANTINE[@]}" -ne 0 ]; then
    printf 'Quarantined but passing (remove from the list): %s\n' "${UNQUARANTINE[*]}"
fi
if [ "$FAIL" -ne 0 ] || [ "${#UNQUARANTINE[@]}" -ne 0 ]; then
    [ "$FAIL" -eq 0 ] || printf 'Failed: %s\n' "${FAILED[*]}"
    exit 1
fi
