#!/usr/bin/env python3
"""Per-event output schema for Claude Code hooks, plus a validator.

WHY THIS EXISTS
    A hook that emits a field the harness does not recognise for its event gets its
    ENTIRE payload rejected -- "Hook JSON output validation failed -- (root): Invalid
    input" -- and whatever it was trying to say is silently dropped. Nothing fails
    loudly, so a broken hook can sit in production indefinitely. That is exactly what
    happened to hooks/pre-compact.py, which emitted
    hookSpecificOutput.additionalContext on PreCompact (an event that does not accept
    it), so the "reload the active workflow after compaction" instruction never
    reached Claude and the workflow Iron Laws stopped being enforced after every
    compaction.

SOURCE OF TRUTH
    https://code.claude.com/docs/en/hooks.md -- transcribed 2026-07-21. When the docs
    change, update EVENTS here and the harness (tests/hook_output_schema_test.py)
    picks it up.
"""

from __future__ import annotations

# Fields accepted on EVERY event.
UNIVERSAL_FIELDS = {
    'continue',
    'stopReason',
    'suppressOutput',
    'systemMessage',
    'terminalSequence',
}


class Event:
    __slots__ = ('top', 'hso', 'decision', 'stdout_is_context')

    def __init__(self, top=(), hso=None, decision=(), stdout_is_context=False):
        # Extra top-level fields beyond UNIVERSAL_FIELDS.
        self.top = frozenset(top)
        # None => hookSpecificOutput is NOT supported for this event.
        self.hso = None if hso is None else frozenset(hso)
        # Allowed values for a top-level "decision". Empty => decision unsupported.
        self.decision = frozenset(decision)
        self.stdout_is_context = stdout_is_context


EVENTS: dict[str, Event] = {
    'SessionStart': Event(
        top={'additionalContext', 'initialUserMessage', 'sessionTitle', 'watchPaths', 'reloadSkills'},
        hso={'additionalContext', 'watchPaths', 'reloadSkills'},
        stdout_is_context=True,
    ),
    'Setup': Event(
        top={'additionalContext'},
        hso={'additionalContext'},
        stdout_is_context=True,
    ),
    'UserPromptSubmit': Event(
        top={'decision', 'reason', 'additionalContext'},
        hso={'additionalContext'},
        decision={'block'},
        stdout_is_context=True,
    ),
    'UserPromptExpansion': Event(
        top={'decision', 'reason'},
        hso=None,
        decision={'block'},
    ),
    'PreToolUse': Event(
        top=set(),
        hso={'permissionDecision', 'permissionDecisionReason', 'updatedInput', 'additionalContext'},
        decision=set(),  # PreToolUse uses hookSpecificOutput.permissionDecision, NOT decision
    ),
    'PostToolUse': Event(
        top={'decision', 'reason', 'additionalContext'},
        hso={'updatedToolOutput', 'additionalContext'},
        decision={'block'},
        stdout_is_context=True,
    ),
    'PostToolUseFailure': Event(
        top={'decision', 'reason', 'additionalContext'},
        hso={'additionalContext'},
        decision={'block'},
        stdout_is_context=True,
    ),
    'PostToolBatch': Event(
        top={'decision', 'reason', 'additionalContext'},
        hso={'additionalContext'},
        decision={'block'},
        stdout_is_context=True,
    ),
    'Stop': Event(
        top={'decision', 'reason'},
        hso={'additionalContext'},
        decision={'block'},
        stdout_is_context=True,
    ),
    'SubagentStop': Event(
        top={'decision', 'reason'},
        hso={'additionalContext'},
        decision={'block'},
        stdout_is_context=True,
    ),
    'SubagentStart': Event(
        top={'additionalContext'},
        hso={'additionalContext'},
        stdout_is_context=True,
    ),
    'PreCompact': Event(
        top={'decision', 'reason'},
        hso=None,  # <- the pre-compact.py bug: hookSpecificOutput is NOT accepted here
        decision={'block'},
    ),
    'PostCompact': Event(hso=None),
    'SessionEnd': Event(hso=None),
    'Notification': Event(hso=None),
    'PermissionRequest': Event(hso={'decision'}),
    'PermissionDenied': Event(hso={'retry'}),
}

# permissionDecision values, PreToolUse only.
PERMISSION_DECISIONS = frozenset({'allow', 'deny', 'ask', 'defer'})


def validate_payload(event: str, payload: dict) -> list[str]:
    """Return a list of schema violations for `payload` emitted on `event`.

    Empty list == valid. Mirrors the harness-side check whose failure produces
    "Hook JSON output validation failed -- (root): Invalid input".
    """
    if event not in EVENTS:
        return [f'unknown hook event {event!r}']
    spec = EVENTS[event]
    errors: list[str] = []

    if not isinstance(payload, dict):
        return [f'top-level output must be a JSON object, got {type(payload).__name__}']

    allowed_top = UNIVERSAL_FIELDS | spec.top | {'hookSpecificOutput'}
    for key in payload:
        if key == 'hookSpecificOutput':
            continue
        if key not in allowed_top:
            errors.append(
                f'unsupported top-level field {key!r} on {event} '
                f'(allowed: {", ".join(sorted(allowed_top))})'
            )

    if 'decision' in payload:
        if not spec.decision:
            hint = (
                ' — PreToolUse uses hookSpecificOutput.permissionDecision'
                if event == 'PreToolUse' else ''
            )
            errors.append(f'{event} does not support a top-level "decision" field{hint}')
        elif payload['decision'] not in spec.decision:
            errors.append(
                f'decision={payload["decision"]!r} not allowed on {event} '
                f'(allowed: {", ".join(sorted(spec.decision))})'
            )

    if 'hookSpecificOutput' in payload:
        hso = payload['hookSpecificOutput']
        if spec.hso is None:
            errors.append(
                f'{event} does not support hookSpecificOutput at all '
                f'(this rejects the WHOLE payload — the pre-compact.py bug)'
            )
        elif not isinstance(hso, dict):
            errors.append('hookSpecificOutput must be a JSON object')
        else:
            name = hso.get('hookEventName')
            if name is None:
                errors.append('hookSpecificOutput is missing hookEventName')
            elif name != event:
                errors.append(
                    f'hookSpecificOutput.hookEventName={name!r} but the hook is wired to {event}'
                )
            for key in hso:
                if key == 'hookEventName':
                    continue
                if key not in spec.hso:
                    errors.append(
                        f'unsupported hookSpecificOutput field {key!r} on {event} '
                        f'(allowed: {", ".join(sorted(spec.hso))})'
                    )
            pd = hso.get('permissionDecision')
            if pd is not None and pd not in PERMISSION_DECISIONS:
                errors.append(
                    f'permissionDecision={pd!r} invalid '
                    f'(allowed: {", ".join(sorted(PERMISSION_DECISIONS))})'
                )

    return errors
