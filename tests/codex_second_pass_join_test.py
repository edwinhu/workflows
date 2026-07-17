#!/usr/bin/env -S uv run python3
"""The Codex second-pass join protocol, end-to-end against the real gate hook.

Two bypasses motivate this file, both found by adversarial review:

  1. The skill recorded consent (`enabled`) BEFORE invoking Codex, while the
     verify gate treated that value as proof Codex had run. Combined with a
     `status: APPROVED` left over from a previous task — the loop resets
     `iteration`, not `status` — verification was reachable while Codex was
     still running, had crashed, or had never started.
  2. The background path launched a detached run and advanced straight to
     "parse verdict" with no defined way to retrieve it.

So the states are now: `requested` (launched, no answer) -> `completed` (answer
parsed) | `error` (ran, failed). Only terminal states admit verify, and the
skill writes a non-approved `status` BEFORE launching so the window in (1) never
exists.

This test drives the actual verdict-extraction snippet from the SKILL.md files
against real payload shapes, and asserts the hook blocks at every non-terminal
point. Run: uv run python3 tests/codex_second_pass_join_test.py
"""

import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
HOOK = REPO / 'hooks' / 'phase-gate-guard.py'
FIELDS = 'codex_second_pass:completed|declined|unavailable'

F = []


def check(name, cond):
    print(f"{'PASS' if cond else 'FAIL'}  {name}")
    if not cond:
        F.append(name)


def gate_allows(body):
    """Would dev-verify's Agent dispatch be allowed against this REVIEW_STATE.md?"""
    with tempfile.TemporaryDirectory() as td:
        art = Path(td) / 'REVIEW_STATE.md'
        art.write_text(body)
        env = {**os.environ, 'GATE_ARTIFACT': str(art), 'GATE_STATUS': 'APPROVED',
               'GATE_BLOCKED_TOOLS': 'Agent', 'GATE_REQUIRE_FIELDS': FIELDS}
        proc = subprocess.run(
            [sys.executable, str(HOOK)],
            input=json.dumps({'tool_name': 'Agent', 'tool_input': {}}),
            capture_output=True, text=True, env=env,
        )
        out = proc.stdout.strip()
        if not out:
            return True
        return json.loads(out)['hookSpecificOutput'].get('permissionDecision') != 'deny'


def extraction_snippet():
    """The verdict-extraction script that dev-review actually tells agents to run.

    Pulled from the SKILL.md rather than duplicated: if the documented snippet
    and the tested one drift apart, the test is worthless.
    """
    text = (REPO / 'skills' / 'dev-review' / 'SKILL.md').read_text()
    m = re.search(r"### 7\. Join the run.*?```bash\nuv run python3 - <<'PY'\n(.*?)\nPY\n```",
                  text, re.S)
    assert m, "could not find the join snippet in dev-review/SKILL.md"
    return m.group(1)


def run_extraction(output_file, handle='codex-second-pass-iter2.json',
                   state_handle=None, extra_files=None, omit_handle=False):
    """Run the documented snippet against a synthetic .planning/ directory.

    handle       — where the payload is actually written
    state_handle — what REVIEW_STATE.md claims the pass owns (defaults to handle)
    extra_files  — {name: contents} written alongside, e.g. a previous
                   iteration's leftover verdict
    """
    snippet = extraction_snippet()
    with tempfile.TemporaryDirectory() as td:
        planning = Path(td) / '.planning'
        planning.mkdir()
        claimed = state_handle or handle
        handle_line = '' if omit_handle else f"codex_output_file: .planning/{claimed}\n"
        (planning / 'REVIEW_STATE.md').write_text(
            "---\nstatus: SECOND_PASS_PENDING\niteration: 2\n"
            f"codex_second_pass: requested\n{handle_line}"
            "verdict: SECOND_PASS_PENDING\n---\n"
        )
        if output_file is not None:
            (planning / handle).write_text(output_file)
        for name, body in (extra_files or {}).items():
            (planning / name).write_text(body)
        proc = subprocess.run([sys.executable, '-c', snippet],
                              cwd=td, capture_output=True, text=True)
        return proc.stdout.strip()



def clear_command():
    """The documented handle-clearing command from dev-review, iteration 2."""
    text = (REPO / 'skills' / 'dev-review' / 'SKILL.md').read_text()
    m = re.search(r"```bash\n# substitute this iteration's N\n(OUT=.*?)\n```", text, re.S)
    assert m, "could not find the handle-clear command in dev-review/SKILL.md"
    return m.group(1).replace('[N]', '2')


def run_clear(make_undeletable, stale=None):
    """Run the documented clear in a .planning/ that may refuse deletion.

    Returns (exit_code, stdout, stale_file_survived).
    """
    with tempfile.TemporaryDirectory() as td:
        planning = Path(td) / '.planning'
        planning.mkdir()
        handle = planning / 'codex-second-pass-iter2.json'
        if stale is not None:
            handle.write_text(stale)
        if make_undeletable:
            os.chmod(planning, 0o500)      # read+execute: cannot unlink entries
        try:
            proc = subprocess.run(['bash', '-c', clear_command()],
                                  cwd=td, capture_output=True, text=True)
            return proc.returncode, proc.stdout.strip(), handle.exists()
        finally:
            os.chmod(planning, 0o700)      # let TemporaryDirectory clean up

# The real envelope shape: codex.stdout is the verdict as a JSON *string*.
def envelope(verdict_obj, status=0):
    return json.dumps({
        'review': 'Adversarial Review',
        'target': {'mode': 'branch', 'label': 'branch diff against main'},
        'threadId': '019f-test',
        'codex': {'status': status, 'stderr': '', 'stdout': json.dumps(verdict_obj)},
    })


APPROVE = {'verdict': 'approve', 'summary': 'ok', 'findings': [], 'next_steps': []}
BLOCKING = {
    'verdict': 'needs-attention', 'summary': 'no', 'next_steps': [],
    'findings': [{'severity': 'high', 'title': 'real bug', 'body': 'b',
                  'file': 'x.py', 'line_start': 1, 'line_end': 2,
                  'confidence': 0.94, 'recommendation': 'fix'}],
}
ADVISORY = {
    'verdict': 'needs-attention', 'summary': 'maybe', 'next_steps': [],
    'findings': [{'severity': 'low', 'title': 'nit', 'body': 'b',
                  'file': 'x.py', 'line_start': 1, 'line_end': 2,
                  'confidence': 0.4, 'recommendation': 'consider'}],
}

# --- The gate at every point in the state machine ------------------------------

# The bypass: consent recorded before the run, stale APPROVED still on disk.
check('requested + stale APPROVED -> BLOCKED (the reported bypass)',
      not gate_allows("---\nstatus: APPROVED\ncodex_second_pass: requested\n---\n"))

# The pending status the skill writes before launching.
check('SECOND_PASS_PENDING -> blocked',
      not gate_allows("---\nstatus: SECOND_PASS_PENDING\ncodex_second_pass: requested\n---\n"))

check('IN_REVIEW (stale verdict invalidated at phase start) -> blocked',
      not gate_allows("---\nstatus: IN_REVIEW\nverdict: IN_REVIEW\n---\n"))

check('error (ran, no verdict) -> blocked',
      not gate_allows("---\nstatus: APPROVED\ncodex_second_pass: error\n---\n"))

check('retired `enabled` -> blocked',
      not gate_allows("---\nstatus: APPROVED\ncodex_second_pass: enabled\n---\n"))

# Terminal states that legitimately admit verify.
for value in ('completed', 'declined', 'unavailable'):
    check(f'{value} + APPROVED -> allowed',
          gate_allows(f"---\nstatus: APPROVED\ncodex_second_pass: {value}\n---\n"))

# A completed pass that BLOCKED must not admit verify either.
check('completed + CHANGES_REQUIRED -> blocked',
      not gate_allows("---\nstatus: CHANGES_REQUIRED\ncodex_second_pass: completed\n---\n"))

# --- The documented extraction snippet, against real payloads ------------------

out = run_extraction(envelope(APPROVE))
check('join: approve verdict extracted', out.startswith('verdict: approve'))

out = run_extraction(envelope(BLOCKING))
check('join: needs-attention extracted', out.startswith('verdict: needs-attention'))
check('join: confidence surfaced for the iron law', '0.94' in out)
check('join: finding located', 'x.py:1' in out)

out = run_extraction(envelope(ADVISORY))
check('join: sub-threshold confidence surfaced', '0.40' in out)

# Completion is not the only outcome. Each of these must be distinguishable
# from a verdict, or the loop advances on nothing.
check('join: missing output file -> PENDING (not a verdict)',
      run_extraction(None).startswith('PENDING'))

check('join: empty output file -> PENDING (still running / lost)',
      run_extraction('').startswith('PENDING'))

check('join: truncated JSON -> ERROR (not a verdict)',
      run_extraction('{"codex": {"status": 0, "stdout": "{\\"verd').startswith('ERROR'))

check('join: codex non-zero exit -> ERROR',
      run_extraction(envelope(APPROVE, status=1)).startswith('ERROR'))

check('join: envelope present but stdout not JSON -> ERROR',
      run_extraction(json.dumps({'codex': {'status': 0, 'stdout': 'boom'}})).startswith('ERROR'))

# --- A previous pass's verdict is not this pass's answer -----------------------
#
# The redirect only truncates the output when Codex is actually invoked. With a
# single reused path, stopping between the `requested` write and the launch left
# last iteration's `approve` on disk for the join to parse as the current answer.
# The handle is now per-iteration and cleared before `requested` is recorded.

stale_approve = envelope({'verdict': 'approve', 'summary': 'iteration 1 said yes',
                          'findings': [], 'next_steps': []})

check("stale: iteration 1's verdict is not joinable by iteration 2",
      run_extraction(None, extra_files={'codex-second-pass-iter1.json': stale_approve})
      .startswith('PENDING'))

check('stale: a payload at some other path is never read',
      run_extraction(stale_approve, handle='codex-second-pass.json',
                     state_handle='codex-second-pass-iter2.json').startswith('PENDING'))

check('handle: the join reads the path the state names, not a hardcoded one',
      run_extraction(envelope(APPROVE), handle='codex-second-pass-iter7.json',
                     state_handle='codex-second-pass-iter7.json')
      .startswith('verdict: approve'))

check('handle: no codex_output_file recorded -> ERROR, never a verdict',
      run_extraction(stale_approve, handle='codex-second-pass-iter1.json',
                     omit_handle=True).startswith('ERROR'))

# --- The clear must be a verified precondition, not an assumption -------------
#
# `rm -f` is quiet both when the file never existed and when it cannot be
# removed. If the clear silently fails, the launch redirect fails too, and the
# join reads the OLD envelope as this pass's answer.

code, out, survived = run_clear(make_undeletable=False, stale=None)
check('clear: succeeds on a fresh handle', code == 0)

code, out, survived = run_clear(make_undeletable=False, stale=stale_approve)
check('clear: removes a stale handle', code == 0 and not survived)

code, out, survived = run_clear(make_undeletable=True, stale=stale_approve)
check('clear: FAILS LOUDLY when the handle cannot be removed', code != 0)
check('clear: says why it refused', 'BLOCKED' in out)
check('clear: the stale handle is still there (so requesting would be unsafe)', survived)

# --- Resume: a fresh session finds `requested` and must not walk into verify ---
check('resume: requested with no output file -> gate still shut',
      not gate_allows("---\nstatus: SECOND_PASS_PENDING\ncodex_second_pass: requested\n"
                      "codex_output_file: .planning/codex-second-pass.json\n---\n"))

print()
if F:
    print(f"{len(F)} FAILED: {F}")
    sys.exit(1)
print('all codex second-pass join tests passed')
sys.exit(0)
