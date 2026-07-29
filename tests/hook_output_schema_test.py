#!/usr/bin/env -S uv run --with pytest --with pyyaml python3
"""Contract test: every wired hook must emit a payload its event actually accepts.

    Run:  ./scripts/check-hooks.sh
    or:   uv run --with pytest --with pyyaml python3 -m pytest tests/hook_output_schema_test.py
    or:   uv run --with pyyaml python3 tests/hook_output_schema_test.py     (prints a report table)

WHAT IT CATCHES
    An invalid hook payload does not raise, does not exit non-zero, and does not warn.
    The harness rejects the whole object ("Hook JSON output validation failed --
    (root): Invalid input") and the hook's message vanishes. hooks/pre-compact.py sat
    broken in production this way: it emitted hookSpecificOutput.additionalContext on
    PreCompact, which does not accept it, so the "reload the active workflow" reminder
    never landed and the workflow Iron Laws stopped being enforced after compaction.

HOW
    1. Discover EVERY wiring -- hooks/hooks.json AND the `hooks:` frontmatter that each
       skills/*/SKILL.md declares (the larger surface; most guards live only there).
    2. Feed each (script, event, matcher) realistic stdin payloads inside a throwaway
       project fixture, so the interesting branches actually fire.
    3. Parse stdout; if it is a JSON object, validate against the per-event schema in
       scripts/checks/hook_output_schema.py.
    4. Also assert the hook exits 0 on payloads it should ignore -- a stray non-zero
       exit is read as a decision (blocks the tool call on PreToolUse).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import yaml

try:
    import pytest
except ModuleNotFoundError:  # standalone report mode does not need pytest
    pytest = None

REPO = Path(__file__).resolve().parents[1]
HOOKS = REPO / 'hooks'
sys.path.insert(0, str(REPO / 'scripts' / 'checks'))
from hook_output_schema import EVENTS, validate_payload  # noqa: E402

TIMEOUT = 90


# --------------------------------------------------------------------------- wiring

def _wirings_from_hooks_json() -> list[tuple[str, str, str, str]]:
    """(source, event, matcher, script) from hooks/hooks.json."""
    out = []
    cfg = json.loads((HOOKS / 'hooks.json').read_text())
    for event, entries in cfg.get('hooks', {}).items():
        for entry in entries:
            matcher = entry.get('matcher', '*')
            for h in entry.get('hooks', []):
                script = _script_of(h.get('command', ''))
                if script:
                    out.append(('hooks.json', event, matcher, script))
    return out


def _wirings_from_skills() -> list[tuple[str, str, str, str]]:
    """(source, event, matcher, script) from every skills/*/SKILL.md `hooks:` frontmatter."""
    out = []
    for skill_md in sorted((REPO / 'skills').glob('*/SKILL.md')):
        text = skill_md.read_text(encoding='utf-8')
        if not text.startswith('---'):
            continue
        parts = text.split('---', 2)
        if len(parts) < 3:
            continue
        try:
            fm = yaml.safe_load(parts[1]) or {}
        except yaml.YAMLError:
            continue
        hooks = fm.get('hooks')
        if not isinstance(hooks, dict):
            continue
        for event, entries in hooks.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                matcher = entry.get('matcher', '*')
                for h in entry.get('hooks', []) or []:
                    if not isinstance(h, dict):
                        continue
                    script = _script_of(h.get('command', ''))
                    if script:
                        out.append((f'skills/{skill_md.parent.name}', event, str(matcher), script))
    return out


def _script_of(command: str) -> str | None:
    """Extract the hook script filename from a wiring command.

    MATCHES BOTH .py AND .ts. The hooks were ported to TypeScript on 2026-07-29 and every wiring
    became `bun .../hooks/x.ts`. This matched only `.py`, so discovery returned [] — the
    parametrised test went SKIPPED[NOTSET], its sibling passed over an empty list, and
    `check-hooks.sh` exited 0 while validating 56 -> 0 wirings.

    That is the precise failure this suite exists to catch, quoted from the enforcement checklist:
    a broken gate "still runs, still exits 0, prints nothing anyone sees, and its `deny` silently
    becomes an allow." The port switched off the only detector for it, and an exit-0 was reported
    four times as a passing gate. If you are adding a third runtime, add it here FIRST.
    """
    for token in command.split():
        if (token.endswith('.py') or token.endswith('.ts')) and '/hooks/' in token:
            return token.rsplit('/hooks/', 1)[1]
    return None


def all_wirings() -> list[tuple[str, str, str, str]]:
    seen, out = set(), []
    for w in _wirings_from_hooks_json() + _wirings_from_skills():
        key = (w[1], w[2], w[3])  # dedupe on event+matcher+script, keep first source
        if key not in seen:
            seen.add(key)
            out.append(w)
    return out


WIRINGS = all_wirings()


# -------------------------------------------------------------------------- payloads

TOOL_FIXTURES = {
    'Write': {'file_path': 'drafts/section-01.md', 'content': '# Draft\n\nSome prose here.\n'},
    'Edit': {'file_path': 'analysis/model.py', 'old_string': 'a', 'new_string': 'b'},
    'MultiEdit': {'file_path': 'drafts/section-01.md', 'edits': []},
    'Read': {'file_path': 'figures/plot.png'},
    'Bash': {'command': 'pixi run python analysis/model.py', 'description': 'run model'},
    'Task': {'description': 'analyze', 'prompt': 'do the thing', 'subagent_type': 'general-purpose'},
    'Agent': {'description': 'analyze', 'prompt': 'do the thing'},
    'Grep': {'pattern': 'foo'},
    'Glob': {'pattern': '**/*.py'},
    'Workflow': {'workflow': 'ds-validate-coverage'},
    'Skill': {'skill': 'wrds'},
}

# Tools worth exercising per event when the matcher is a wildcard.
DEFAULT_TOOLS = ['Write', 'Edit', 'Bash', 'Read', 'Task']


def tools_for(matcher: str) -> list[str]:
    if not matcher or matcher in ('*', '.*'):
        return DEFAULT_TOOLS
    names = [t.strip() for t in matcher.split('|') if t.strip()]
    known = [t for t in names if t in TOOL_FIXTURES]
    return known or DEFAULT_TOOLS


def payloads_for(event: str, matcher: str, cwd: str) -> list[dict]:
    """Realistic stdin payloads for this event, covering the branches a hook may take."""
    base = {
        'session_id': 'test-session',
        'transcript_path': str(Path(cwd) / 'transcript.jsonl'),
        'cwd': cwd,
        'hook_event_name': event,
        'permission_mode': 'default',
    }
    if event in ('PreToolUse', 'PostToolUse', 'PostToolUseFailure'):
        out = []
        for tool in tools_for(matcher):
            p = dict(base, tool_name=tool, tool_input=TOOL_FIXTURES[tool])
            if event != 'PreToolUse':
                p['tool_response'] = {'stdout': 'https://github.com/o/r/pull/12', 'output': 'ok'}
                p['tool_result'] = p['tool_response']
            out.append(p)
        return out
    if event == 'PostToolBatch':
        return [dict(base, tool_uses=[{'tool_name': 'Write', 'tool_input': TOOL_FIXTURES['Write']}])]
    if event == 'SessionStart':
        return [dict(base, source=s) for s in ('startup', 'resume', 'clear', 'compact')]
    if event == 'SessionEnd':
        return [dict(base, reason=r) for r in ('clear', 'logout', 'other')]
    if event == 'PreCompact':
        return [dict(base, trigger=t, custom_instructions='') for t in ('manual', 'auto')]
    if event in ('SubagentStart',):
        return [dict(base, agent_type='general-purpose', prompt='write the pipeline')]
    if event in ('Stop', 'SubagentStop'):
        return [dict(base, stop_hook_active=False)]
    if event == 'UserPromptSubmit':
        return [dict(base, prompt='run the analysis')]
    return [base]


def make_project(root: Path) -> None:
    """A throwaway project that looks live enough to fire the interesting branches."""
    planning = root / '.planning'
    planning.mkdir(parents=True, exist_ok=True)
    (planning / 'PLAN.md').write_text(
        '## DS Workflow\n\n/ds\n\n### Skills Touched\n\n- `wrds` — TAQ millisecond data\n'
    )
    (planning / 'SPEC.md').write_text('# SPEC\n\n- `wrds` — TAQ data model\n')
    (planning / 'STATE.md').write_text('# STATE\n\n## Active workflow: /ds\n')
    (planning / 'LEARNINGS.md').write_text('# LEARNINGS\n')
    (planning / 'ACTIVE_WORKFLOW.md').write_text(
        '---\nworkflow: writing\nphase: draft\nstyle: volokh\n'
        'edits_since_verify: 9\nverify_threshold: 10\n---\n'
    )
    (planning / 'PRECIS.md').write_text('# PRECIS\n\n## Thesis\n\nx\n')
    (root / '.claude').mkdir(exist_ok=True)
    (root / '.claude' / 'LEARNINGS.md').write_text('# LEARNINGS\n')
    (root / '.claude' / 'PLAN.md').write_text('## DS Workflow\n')
    for d in ('drafts', 'outlines', 'analysis', 'figures'):
        (root / d).mkdir(exist_ok=True)
    (root / 'drafts' / 'section-01.md').write_text('# Section\n\nProse without a claim id.\n')
    (root / 'analysis' / 'model.py').write_text('import pandas as pd\n')
    (root / 'transcript.jsonl').write_text(
        json.dumps({'type': 'human', 'content': "no, don't do that again"}) + '\n'
        + json.dumps({'type': 'human', 'content': 'i already told you, wrong'}) + '\n'
    )


def run_hook(script: str, payload: dict, cwd: str) -> tuple[int, str, str]:
    env = dict(os.environ)
    env['CLAUDE_PLUGIN_ROOT'] = str(REPO)
    env['CLAUDE_PROJECT_DIR'] = cwd
    env['CLAUDE_SESSION_ID'] = 'hook-schema-test'
    # Some hooks read tool input from this env var instead of stdin. Populate it so the
    # test exercises whatever path they take -- the point is the OUTPUT shape.
    env['CLAUDE_TOOL_INPUT'] = json.dumps(payload.get('tool_input', {}))
    # Dispatch on extension: hooks were ported to TypeScript on 2026-07-29 and now run under bun.
    # Hardcoding `uv run python3` made every .ts wiring fail to execute, so all 56 reported INVALID
    # the moment discovery was fixed — a broken runner is indistinguishable from a broken hook in
    # the report, and the previous state (0/0, exit 0) hid both.
    argv = (['bun', str(HOOKS / script)] if script.endswith('.ts')
            else ['uv', 'run', 'python3', str(HOOKS / script)])
    proc = subprocess.run(
        argv,
        input=json.dumps(payload), capture_output=True, text=True,
        cwd=cwd, env=env, timeout=TIMEOUT,
    )
    return proc.returncode, proc.stdout, proc.stderr


def check_one(script: str, event: str, matcher: str) -> list[str]:
    """Run every payload for this wiring; return schema/exit violations."""
    problems: list[str] = []
    tmp = tempfile.mkdtemp(prefix='hookcheck-')
    try:
        for payload in payloads_for(event, matcher, tmp):
            make_project(Path(tmp))
            try:
                code, stdout, stderr = run_hook(script, payload, tmp)
            except subprocess.TimeoutExpired:
                problems.append(f'{script} [{event}] timed out after {TIMEOUT}s')
                continue

            tool = payload.get('tool_name', '-')
            where = f'{script} [{event}/{tool}]'

            if code not in (0, 2):
                problems.append(f'{where} exited {code} (only 0, or a deliberate 2, are safe)\n{stderr[:400]}')

            text = stdout.strip()
            if not text:
                continue
            try:
                parsed = json.loads(text)
            except json.JSONDecodeError:
                # Plain text on stdout is fine -- it is treated as context (or ignored).
                continue
            if not isinstance(parsed, dict):
                continue
            for err in validate_payload(event, parsed):
                problems.append(f'{where} {err}\n    emitted: {text[:300]}')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return problems


# ----------------------------------------------------------------------------- tests

_parametrize = (
    pytest.mark.parametrize(
        'source,event,matcher,script',
        WIRINGS,
        ids=[f'{w[1]}:{w[3]}:{w[2]}' for w in WIRINGS],
    )
    if pytest is not None
    else (lambda fn: fn)
)


@_parametrize
def test_wired_hook_emits_valid_payload(source, event, matcher, script):
    assert event in EVENTS, f'{source} wires an unknown event {event!r}'
    assert (HOOKS / script).exists(), f'{source} wires a missing script hooks/{script}'
    problems = check_one(script, event, matcher)
    assert not problems, (
        f'{script} wired to {event} (matcher {matcher!r}, from {source}) emits payloads '
        f'the harness will reject:\n  - ' + '\n  - '.join(problems)
    )


def test_every_wiring_names_a_real_event_and_script():
    """Cheap structural check -- catches typos in an event name or a renamed script."""
    bad = [
        f'{src}: {ev}/{scr}'
        for src, ev, _m, scr in WIRINGS
        if ev not in EVENTS or not (HOOKS / scr).exists()
    ]
    assert not bad, 'invalid hook wiring:\n  ' + '\n  '.join(bad)


def test_hookeventname_matches_wired_event():
    """A hookSpecificOutput.hookEventName that disagrees with the wiring is rejected too.

    Static, because the runtime check only sees the branches a fixture happens to
    reach. suggest-compact.py hid here: it hardcoded "PreToolUse" but is ALSO wired to
    PostToolUse by skills/workshop, and only emits after 50 edits — no fixture was ever
    going to trip it.
    """
    by_script: dict[str, set[str]] = {}
    for _src, ev, _m, scr in WIRINGS:
        by_script.setdefault(scr, set()).add(ev)
    bad = []
    for script, events in sorted(by_script.items()):
        src = (HOOKS / script).read_text(encoding='utf-8')
        declared = {
            ev for ev in EVENTS
            if f'"hookEventName": "{ev}"' in src or f"'hookEventName': '{ev}'" in src
        }
        if not declared:
            continue
        # A hook that reads the event off the payload adapts to any wiring.
        if 'hook_event_name' in src:
            continue
        stray = declared - events
        if stray:
            bad.append(f'{script} hardcodes hookEventName {sorted(stray)} but is wired to {sorted(events)}')
        unhandled = events - declared
        if unhandled:
            bad.append(
                f'{script} is wired to {sorted(unhandled)} but only ever emits hookEventName '
                f'{sorted(declared)} — the payload will be rejected under that wiring. '
                f'Read hook_event_name from the payload.'
            )
    assert not bad, '\n'.join(bad)


# ------------------------------------------------------------------- regression cases

def test_precompact_rejects_hookspecificoutput():
    """THE regression: PreCompact does not accept hookSpecificOutput -- at all.

    This is the exact payload hooks/pre-compact.py used to emit. The harness rejected
    the whole object, so the workflow-reload instruction was silently dropped after
    every compaction.
    """
    broken = {
        'hookSpecificOutput': {
            'hookEventName': 'PreCompact',
            'additionalContext': 'the /ds workflow was active before compaction, reload it',
        }
    }
    errors = validate_payload('PreCompact', broken)
    assert errors, 'the validator must reject hookSpecificOutput on PreCompact'
    assert any('does not support hookSpecificOutput' in e for e in errors)


def test_pretooluse_rejects_top_level_decision():
    """PreToolUse gates go through hookSpecificOutput.permissionDecision, not `decision`."""
    errors = validate_payload('PreToolUse', {'decision': 'block', 'message': 'nope'})
    assert any('does not support a top-level "decision"' in e for e in errors)
    assert any("unsupported top-level field 'message'" in e for e in errors)


def test_result_continue_is_not_a_schema():
    """`{"result": "continue"}` is invented -- no event accepts it."""
    for event in ('PostToolUse', 'PreToolUse', 'Stop'):
        assert validate_payload(event, {'result': 'continue', 'message': 'hi'}), event


def test_valid_payloads_pass():
    assert validate_payload('PreCompact', {'systemMessage': 'saved'}) == []
    assert validate_payload('PreCompact', {'decision': 'block', 'reason': 'wait'}) == []
    assert validate_payload('PostToolUse', {
        'hookSpecificOutput': {'hookEventName': 'PostToolUse', 'additionalContext': 'x'}}) == []
    assert validate_payload('PreToolUse', {'hookSpecificOutput': {
        'hookEventName': 'PreToolUse', 'permissionDecision': 'deny',
        'permissionDecisionReason': 'r'}}) == []
    assert validate_payload('SubagentStart', {
        'hookSpecificOutput': {'hookEventName': 'SubagentStart', 'additionalContext': 'x'}}) == []


def test_wc_audit_has_a_hook_contract_dimension():
    """The audit that was supposed to catch this must actually check it.

    workflow-creator's P01-P30 review scored hooks on COVERAGE (P20) and on whether their
    command PATH resolves (path-portability). Neither ever executed a hook, so a hook that
    ran fine and emitted a payload the harness discarded scored clean. This asserts the
    deterministic leg that closes that gap stays wired.
    """
    audit = (REPO / 'workflows' / 'wc-audit.js').read_text(encoding='utf-8')
    assert "key: 'hook-contract'" in audit, 'wc-audit.js lost its hook-contract dimension'
    assert 'check-hooks.sh' in audit, 'the hook-contract dimension must RUN the harness, not read the hooks'
    assert "byDim['hook-contract']" in audit, 'hook-contract results must reach the gate'
    assert "hookStatus === 'Clean'" in audit, 'hook-contract must be part of the substrate gate'

    runner = REPO / 'scripts' / 'check-hooks.sh'
    assert runner.exists(), 'scripts/check-hooks.sh is the documented entry point'
    assert os.access(runner, os.X_OK), 'scripts/check-hooks.sh must be executable'


# ------------------------------------------------------------------- standalone report

def _report() -> int:
    rows, failed = [], 0
    for source, event, matcher, script in WIRINGS:
        if event not in EVENTS or not (HOOKS / script).exists():
            rows.append((script, event, matcher, 'WIRING ERROR', source))
            failed += 1
            continue
        problems = check_one(script, event, matcher)
        rows.append((script, event, matcher, 'VALID' if not problems else 'INVALID', source))
        if problems:
            failed += 1
            for p in problems:
                print(f'  ! {p}')
    print()
    print(f'{"hook script":<38} {"event":<14} {"matcher":<26} {"verdict":<8} source')
    print('-' * 120)
    for r in rows:
        print(f'{r[0]:<38} {r[1]:<14} {r[2][:25]:<26} {r[3]:<8} {r[4]}')
    print()
    print(f'{len(rows) - failed}/{len(rows)} wirings valid')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(_report())
