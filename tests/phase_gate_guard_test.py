#!/usr/bin/env -S uv run python3
"""Tests for hooks/phase-gate-guard.ts.

Focus: GATE_REQUIRE_FIELDS (the recorded-decision check) and the backward
compatibility of the 12+ skills that wire this hook without it.

Run: uv run python3 tests/phase_gate_guard_test.py
"""

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HOOK = Path(__file__).resolve().parent.parent / 'hooks' / 'phase-gate-guard.ts'

F = []


def run_hook(env_extra, tool_name='Agent', tool_input=None):
    """Invoke the hook; return (allowed: bool, reason: str)."""
    env = {**os.environ, **env_extra}
    payload = json.dumps({'tool_name': tool_name, 'tool_input': tool_input or {}})
    proc = subprocess.run(
        ['bun', str(HOOK)],
        input=payload, capture_output=True, text=True, env=env, check=False,
    )
    out = proc.stdout.strip()
    if not out:
        return True, ''
    try:
        decision = json.loads(out)['hookSpecificOutput']
    except (json.JSONDecodeError, KeyError, TypeError):
        return True, ''
    allowed = decision.get('permissionDecision') != 'deny'
    return allowed, decision.get('permissionDecisionReason', '')


def write_state(tmpdir, body):
    p = Path(tmpdir) / 'REVIEW_STATE.md'
    p.write_text(body)
    return str(p)


def check(name, cond):
    print(f"{'PASS' if cond else 'FAIL'}  {name}")
    if not cond:
        F.append(name)


APPROVED_WITH = """---
status: APPROVED
iteration: 2
codex_second_pass: {value}
verdict: APPROVED
---
"""

APPROVED_WITHOUT = """---
status: APPROVED
iteration: 2
verdict: APPROVED
---
"""

FIELDS = 'codex_second_pass:completed|declined|unavailable'

with tempfile.TemporaryDirectory() as td:
    base = {'GATE_STATUS': 'APPROVED', 'GATE_BLOCKED_TOOLS': 'Agent'}

    # --- Backward compatibility: no GATE_REQUIRE_FIELDS => unchanged behavior ---
    art = write_state(td, APPROVED_WITHOUT)
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('no GATE_REQUIRE_FIELDS: approved artifact still allowed', allowed)

    art = write_state(td, "---\nstatus: CHANGES_REQUIRED\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('no GATE_REQUIRE_FIELDS: wrong status still blocked', not allowed)

    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': str(Path(td) / 'nope.md')})
    check('missing artifact still blocked', not allowed)

    # --- The new check: every legal disposition passes ---
    for value in ('completed', 'declined', 'unavailable'):
        art = write_state(td, APPROVED_WITH.format(value=value))
        allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art, 'GATE_REQUIRE_FIELDS': FIELDS})
        check(f'codex_second_pass: {value} -> allowed', allowed)

    # --- The bypass this closes: APPROVED with no recorded decision ---
    art = write_state(td, APPROVED_WITHOUT)
    allowed, reason = run_hook({**base, 'GATE_ARTIFACT': art, 'GATE_REQUIRE_FIELDS': FIELDS})
    check('APPROVED without codex_second_pass -> blocked', not allowed)
    check('block reason names the missing field', 'codex_second_pass' in reason)

    # --- error is an absence of evidence, not an approval ---
    art = write_state(td, APPROVED_WITH.format(value='error'))
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art, 'GATE_REQUIRE_FIELDS': FIELDS})
    check('codex_second_pass: error -> blocked (not an approval)', not allowed)

    # --- a launch is not a verdict: `requested` must never admit verify ---
    # This is the partial-failure/resume bypass: Codex is still running, or
    # crashed, or the session died mid-pass. Nothing answered.
    art = write_state(td, APPROVED_WITH.format(value='requested'))
    allowed, reason = run_hook({**base, 'GATE_ARTIFACT': art, 'GATE_REQUIRE_FIELDS': FIELDS})
    check('codex_second_pass: requested -> blocked (launch is not an answer)', not allowed)
    check('requested block reason names the field', 'codex_second_pass' in reason)

    # --- the old `enabled` state is retired and must not admit verify either ---
    art = write_state(td, APPROVED_WITH.format(value='enabled'))
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art, 'GATE_REQUIRE_FIELDS': FIELDS})
    check('retired codex_second_pass: enabled -> blocked', not allowed)

    # --- the pending status alone blocks, whatever the field says ---
    # Belt and braces: dev-review writes SECOND_PASS_PENDING before launching, so
    # even a stale APPROVED from a previous task cannot leave the gate open.
    for pending_status in ('SECOND_PASS_PENDING', 'IN_REVIEW'):
        art = write_state(td, f"---\nstatus: {pending_status}\ncodex_second_pass: requested\n---\n")
        allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art, 'GATE_REQUIRE_FIELDS': FIELDS})
        check(f'status: {pending_status} -> blocked', not allowed)

    # --- an un-substituted SKILL.md template is not a real answer ---
    art = write_state(td, APPROVED_WITH.format(value='enabled | declined | unavailable'))
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art, 'GATE_REQUIRE_FIELDS': FIELDS})
    check('literal template placeholder -> blocked', not allowed)

    # --- empty value is as good as absent ---
    art = write_state(td, APPROVED_WITH.format(value=''))
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art, 'GATE_REQUIRE_FIELDS': FIELDS})
    check('empty codex_second_pass -> blocked', not allowed)

    # --- presence-only syntax (no allowed-value list) ---
    art = write_state(td, APPROVED_WITH.format(value='error'))
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art, 'GATE_REQUIRE_FIELDS': 'codex_second_pass'})
    check('presence-only syntax accepts any non-empty value', allowed)

    # --- unrelated tools are never gated ---
    art = write_state(td, APPROVED_WITHOUT)
    allowed, _ = run_hook(
        {**base, 'GATE_ARTIFACT': art, 'GATE_REQUIRE_FIELDS': FIELDS}, tool_name='Read'
    )
    check('non-blocked tool passes through', allowed)

    # --- value matching is case-insensitive, and quotes/comments tolerated ---
    art = write_state(td, """---
status: APPROVED
codex_second_pass: "Declined"   # user opted out
---
""")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art, 'GATE_REQUIRE_FIELDS': FIELDS})
    check('quoted + commented + mixed-case value -> allowed', allowed)

# --- Adversarial parsing: the gate must not be fooled by YAML shape ---
#
# The frontmatter reader is hand-rolled (hooks stay dependency-free), so each way
# it could mis-read a value is pinned here. Every case below must BLOCK.

with tempfile.TemporaryDirectory() as td:
    base = {'GATE_STATUS': 'APPROVED', 'GATE_BLOCKED_TOOLS': 'Agent'}
    gated = {**base, 'GATE_REQUIRE_FIELDS': FIELDS}

    # A nested key must not satisfy a top-level requirement.
    art = write_state(td, """---
status: APPROVED
prior_review:
  codex_second_pass: completed
---
""")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('nested codex_second_pass does not satisfy top-level -> blocked', not allowed)

    # A '#' inside a quoted scalar is literal text, not a comment.
    art = write_state(td, """---
status: APPROVED
codex_second_pass: 'enabled # error'
---
""")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check("quoted '#' is literal, not a comment -> blocked", not allowed)

    # Duplicate keys are ambiguous — block rather than pick one.
    art = write_state(td, """---
status: APPROVED
codex_second_pass: error
codex_second_pass: completed
---
""")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('duplicate codex_second_pass keys -> blocked', not allowed)

    # A key with no scalar (block/nested value) is not a recorded decision.
    art = write_state(td, """---
status: APPROVED
codex_second_pass:
  - enabled
---
""")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('non-scalar codex_second_pass -> blocked', not allowed)

    # No frontmatter at all.
    art = write_state(td, "status: APPROVED\ncodex_second_pass: completed\n")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('no frontmatter delimiters -> blocked', not allowed)

    # YAML doubles a quote to escape it: 'enabled'' # error' is the single value
    # `enabled' # error`, NOT `enabled`.
    art = write_state(td, """---
status: APPROVED
codex_second_pass: 'enabled'' # error'
---
""")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check("doubled-quote escape not read as 'enabled' -> blocked", not allowed)

    # Junk after a closing quote means this isn't a clean scalar.
    art = write_state(td, """---
status: APPROVED
codex_second_pass: 'enabled' and then some
---
""")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('trailing junk after closing quote -> blocked', not allowed)

    # An unterminated quote is not a value.
    art = write_state(td, """---
status: APPROVED
codex_second_pass: 'enabled
---
""")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('unterminated quote -> blocked', not allowed)

    # YAML resolves \n to a newline, so "decli\ned" is NOT `declined`. A parser
    # that just drops the backslash would let this through.
    art = write_state(td, """---
status: APPROVED
codex_second_pass: "decli\\ned"
---
""")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('escape-synthesized "decli\\ned" -> blocked', not allowed)

    # A plain scalar continues onto indented lines: this value is
    # `completed nope`, not `completed`. (Verified against pyyaml.)
    art = write_state(td, """---
status: APPROVED
codex_second_pass: completed
  nope
---
""")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('multiline plain scalar continuation -> blocked', not allowed)

    # A comment after a closing quote is still fine.
    art = write_state(td, """---
status: APPROVED
codex_second_pass: 'declined'   # user opted out
---
""")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('comment after closing quote -> allowed', allowed)

    # --- The same adversarial shapes against the EXISTING status gate ---
    # These 12+ skills wire the hook without GATE_REQUIRE_FIELDS; the status gate
    # must not be loosened by the parser rewrite.

    art = write_state(td, "---\nnested:\n  status: APPROVED\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('nested status does not satisfy status gate -> blocked', not allowed)

    art = write_state(td, "---\nstatus: 'APPROVED # invalid'\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check("quoted status with literal '#' -> blocked", not allowed)

    art = write_state(td, "---\nstatus: CHANGES_REQUIRED\nstatus: APPROVED\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('duplicate status keys -> blocked', not allowed)

    # A bare inline comment IS a comment (YAML: whitespace before '#').
    art = write_state(td, "---\nstatus: APPROVED # sign-off by RJ\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('bare status with trailing comment -> allowed (YAML semantics)', allowed)

    # '#' with no leading whitespace is part of the value, not a comment.
    art = write_state(td, "---\nstatus: APPROVED#nope\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check("status 'APPROVED#nope' is not APPROVED -> blocked", not allowed)

    # The doubled-quote escape must not fool the status gate either.
    art = write_state(td, "---\nstatus: 'APPROVED'' # invalid'\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('doubled-quote escape does not satisfy status gate -> blocked', not allowed)

    art = write_state(td, "---\nstatus: 'APPROVED' but actually not\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('status with trailing junk after quote -> blocked', not allowed)

    # Double-quoted with a backslash escape: the value is `APPROVED" x`.
    art = write_state(td, '---\nstatus: "APPROVED\\" x"\n---\n')
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('backslash-escaped quote not read as APPROVED -> blocked', not allowed)

    # An unknown escape must not collapse into a passing value: YAML rejects
    # "A\PPROVED"; naive backslash-dropping would read it as APPROVED.
    art = write_state(td, '---\nstatus: "A\\PPROVED"\n---\n')
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('unknown escape "A\\PPROVED" -> blocked', not allowed)

    # `---` inside a scalar is not a frontmatter delimiter: this value is
    # `APPROVED---nope`, not `APPROVED`. (Pre-existing bug; verified vs pyyaml.)
    art = write_state(td, "---\nstatus: APPROVED---nope\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('embedded --- in status scalar -> blocked', not allowed)

    art = write_state(td, "---\nstatus: APPROVED\ncodex_second_pass: completed---nope\n---\n")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('embedded --- in codex_second_pass -> blocked', not allowed)

    # Unterminated frontmatter is not readable evidence.
    art = write_state(td, "---\nstatus: APPROVED\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('unterminated frontmatter -> blocked', not allowed)

    # A construct opened on an earlier line captures the lines below it, so the
    # `status:` here is NOT a top-level key — it belongs to `broken`.
    art = write_state(td, "---\nbroken: [\nstatus: APPROVED\n---\n")
    allowed, reason = run_hook({**base, 'GATE_ARTIFACT': art})
    check('unterminated flow collection swallows status -> blocked', not allowed)
    check('unreadable artifact says so', 'not readable' in reason)

    art = write_state(td, "---\nbroken: 'oops\nstatus: APPROVED\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('unterminated quote swallows status -> blocked', not allowed)

    # A YAML tag/anchor sits before the value and hides the opener from a
    # first-character check: pyyaml reads this whole thing as `broken`.
    art = write_state(td, "---\nbroken: !!str 'oops\nstatus: APPROVED # close'\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('tag-hidden multiline quote swallows status -> blocked', not allowed)

    art = write_state(td, "---\nbroken: &a 'oops\nstatus: APPROVED # close'\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('anchor-hidden multiline quote swallows status -> blocked', not allowed)

    art = write_state(td, "---\nstatus: APPROVED\nbroken: [\ncodex_second_pass: completed\n---\n")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('unterminated flow before field gate -> blocked', not allowed)

    # ...and the readability rule must not reject legitimate artifacts.
    art = write_state(td, """---
status: APPROVED
iteration: 2
notes: |
  a block scalar's content is indented, so it captures nothing at top level
codex_second_pass: declined
---
""")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('block scalar sibling -> allowed (content is indented)', allowed)

    art = write_state(td, "---\nstatus: APPROVED\nprior:\n  note: x\ncodex_second_pass: completed\n---\n")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('nested mapping sibling -> allowed', allowed)

    # `status:APPROVED` (no space) is NOT a mapping — YAML reads the whole line
    # as the plain scalar "status:APPROVED", so the document has no status key.
    # Matching it would open the gate on a doc that never recorded a status.
    art = write_state(td, "---\nstatus:APPROVED\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('status:APPROVED (no space after colon) -> blocked', not allowed)

    art = write_state(td, "---\nstatus:'APPROVED'\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check("status:'APPROVED' (no space, quoted) -> blocked", not allowed)

    art = write_state(td, "---\nstatus: APPROVED\ncodex_second_pass:enabled\n---\n")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check('codex_second_pass:enabled (no space) -> blocked', not allowed)

    # YAML requires whitespace before a trailing comment: `'APPROVED'#x` is a
    # syntax error, so PyYAML never assigns status a value here.
    art = write_state(td, "---\nstatus: 'APPROVED'#x\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check("quoted status with unspaced '#' -> blocked", not allowed)

    art = write_state(td, '---\nstatus: "APPROVED"#x\n---\n')
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('double-quoted status with unspaced # -> blocked', not allowed)

    art = write_state(td, "---\nstatus: APPROVED\ncodex_second_pass: 'enabled'#x\n---\n")
    allowed, _ = run_hook({**gated, 'GATE_ARTIFACT': art})
    check("field with unspaced '#' -> blocked", not allowed)

    # ...but a properly separated comment is still a comment.
    art = write_state(td, "---\nstatus: 'APPROVED' #x\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check("quoted status with spaced '#' -> allowed", allowed)

    # A tab after the colon is valid separation, unlike a missing space.
    art = write_state(td, "---\nstatus:\tAPPROVED\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('status:<tab>APPROVED -> allowed', allowed)

    # Sibling keys sharing a prefix must not collide.
    art = write_state(td, "---\nstatus_extra: APPROVED\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('status_extra does not satisfy status gate -> blocked', not allowed)

    # Decorated YAML (anchor, tag, alias, flow collection) is not a plain
    # scalar. The hook fails closed rather than resolving it — REVIEW_STATE.md
    # never legitimately uses these, and a resolver is surface to get wrong.
    for label, body in [
        ('anchor', "---\nstatus: &a APPROVED\n---\n"),
        ('tag', "---\nstatus: !!str APPROVED\n---\n"),
        ('alias', "---\nx: &a APPROVED\nstatus: *a\n---\n"),
        ('flow seq', "---\nstatus: [APPROVED]\n---\n"),
    ]:
        art = write_state(td, body)
        allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
        check(f'decorated YAML ({label}) -> blocked (fail closed)', not allowed)

    # An INDENTED `---` is a scalar continuation, not a delimiter: pyyaml reads
    # this status as `APPROVED ---`.
    art = write_state(td, "---\nstatus: APPROVED\n  ---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('indented closing --- -> blocked', not allowed)

    art = write_state(td, "  ---\nstatus: APPROVED\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('indented opening --- -> blocked', not allowed)

    # Trailing whitespace after a delimiter is still a delimiter.
    art = write_state(td, "--- \nstatus: APPROVED\n--- \n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('delimiter with trailing whitespace -> allowed', allowed)

    # The status gate must not fall for a continuation line either: this value
    # is `APPROVED nope`. (Verified against pyyaml.)
    art = write_state(td, "---\nstatus: APPROVED\n  nope\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('status multiline plain scalar -> blocked', not allowed)

    # ...but a normal flat artifact with a following top-level key still passes.
    art = write_state(td, "---\nstatus: APPROVED\niteration: 2\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('flat frontmatter with following key -> allowed', allowed)

    # A nested block under a LATER key must not be mistaken for a continuation
    # of an earlier one.
    art = write_state(td, "---\nstatus: APPROVED\nprior:\n  note: x\n---\n")
    allowed, _ = run_hook({**base, 'GATE_ARTIFACT': art})
    check('nested block under a later key -> allowed', allowed)


# --- The wiring is real: execute the command strings from SKILL.md frontmatter ---
#
# GATE_REQUIRE_FIELDS contains `|`. Unquoted, bash reads it as a pipeline, the env
# var never reaches the hook, and the gate silently allows everything. Parsing the
# YAML would not catch that — only running the command as a shell does.

import re

REPO = Path(__file__).resolve().parent.parent


def gate_command(skill_path):
    """Extract the phase-gate-guard command string from a SKILL.md frontmatter."""
    text = (REPO / skill_path).read_text()
    frontmatter = text.split('---', 2)[1]
    for block in re.findall(r'command: >-\n((?:\s{12,}.*\n)+)', frontmatter):
        joined = ' '.join(line.strip() for line in block.strip().splitlines())
        if 'phase-gate-guard.ts' in joined:
            return joined
    return ''


with tempfile.TemporaryDirectory() as td:
    # DS no longer uses a separate verify phase or phase-gate sentinel. Its copied native PLAN
    # carries immutable approval frontmatter and ds-implement performs technical VERIFY inline.
    skill = 'skills/dev-verify/SKILL.md'
    cmd = gate_command(skill)
    check(f'{skill}: gate command found', bool(cmd))
    if cmd:
        check(f'{skill}: GATE_REQUIRE_FIELDS present', 'GATE_REQUIRE_FIELDS' in cmd)

        # Replace the interpreter invocation with `env` so the shell reports the
        # environment the hook would actually receive.
        env_probe = re.sub(r'bun \S+phase-gate-guard\.ts', 'env', cmd)
        env_probe = env_probe.replace('${CLAUDE_PLUGIN_ROOT}', str(REPO))
        proc = subprocess.run(['bash', '-c', env_probe], capture_output=True, text=True, check=False)

        got = [l for l in proc.stdout.splitlines() if l.startswith('GATE_REQUIRE_FIELDS=')]
        check(f'{skill}: GATE_REQUIRE_FIELDS survives shell parsing (quoted)', len(got) == 1)
        if got:
            value = got[0].split('=', 1)[1]
            check(f'{skill}: all three dispositions reach the hook',
                  set(value.split(':', 1)[1].split('|')) ==
                  {'completed', 'declined', 'unavailable'})
        check(f'{skill}: no stray shell errors from the assignment',
              'command not found' not in proc.stderr)

print()
if F:
    print(f"{len(F)} FAILED: {F}")
    sys.exit(1)
print('all phase-gate-guard tests passed')
sys.exit(0)
