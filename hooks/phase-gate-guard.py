#!/usr/bin/env -S uv run python3
"""
PreToolUse hook: Block code-modifying tools if a required gate artifact is missing.

Generic phase-gate enforcer. Each skill that needs a gate passes the required
artifact path and a human-readable gate description via environment variables:

  GATE_ARTIFACT=.planning/PLAN_REVIEWED.md
  GATE_STATUS=APPROVED           (optional: required frontmatter status value)
  GATE_REQUIRE_FIELDS=codex_second_pass:enabled|declined|unavailable
                                 (optional: frontmatter keys that must be present,
                                  optionally constrained to an allowed value set)
  GATE_DESCRIPTION=Plan review   (human-readable name for error messages)
  GATE_REMEDY=Return to dev-design and run dev-plan-reviewer
  GATE_BLOCKED_TOOLS=Write,Edit,Bash,Agent  (optional: default Write|Edit)

GATE_REQUIRE_FIELDS syntax: comma-separated entries, each either `name` (key must
be present and non-empty) or `name:v1|v2` (must also be one of the listed values).
It answers a question GATE_STATUS cannot: "was this decision *recorded*, or
silently skipped?" A phase can legitimately end in several dispositions, so
pinning one `status:` value is wrong — but leaving the field absent entirely
means the phase never ran and nobody noticed.

Constraining the value set also catches the copy-paste failure: SKILL.md YAML
templates are written as `field: a | b | c`, and an agent that pastes the
template verbatim without substituting leaves a literal `a | b | c` that matches
no single allowed value — so the gate blocks instead of accepting a placeholder
as a real answer.

Scoped to individual phase skills via frontmatter hooks. The skill sets env vars
in the hook command, making this one script reusable across all workflow phases.

Usage in SKILL.md frontmatter:
  hooks:
    PreToolUse:
      - matcher: "Write|Edit|Agent"
        hooks:
          - type: command
            command: >-
              GATE_ARTIFACT=.planning/PLAN_REVIEWED.md
              GATE_STATUS=APPROVED
              GATE_DESCRIPTION="Plan review"
              GATE_REMEDY="Return to dev-design and run dev-plan-reviewer"
              GATE_BLOCKED_TOOLS=Agent
              uv run python3 ${CLAUDE_PLUGIN_ROOT}/hooks/phase-gate-guard.py

LANDMINE: GATE_REQUIRE_FIELDS values contain `|`, which bash reads as a PIPE. The
assignment MUST be quoted in the hook command:

    GATE_REQUIRE_FIELDS="codex_second_pass:enabled|declined|unavailable"   # correct
    GATE_REQUIRE_FIELDS=codex_second_pass:enabled|declined|unavailable     # BROKEN

Unquoted, bash parses it as a pipeline, the env var is never set, this script sees
no field requirement, and the gate silently allows everything — a phantom gate that
looks wired but never blocks. `tests/phase_gate_guard_test.py` executes the real
command strings out of the SKILL.md frontmatter to catch exactly this.

LANDMINE: the `matcher` alone does NOT block a tool — it only decides which tool calls invoke this
script. Blocking is decided here, by GATE_BLOCKED_TOOLS, which DEFAULTS to Write,Edit only (see
DEFAULT_BLOCKED_TOOLS below). A matcher of "Write|Edit|Agent" with no GATE_BLOCKED_TOOLS=...,Agent
fires this script on every Agent call but silently allows it through (tool_name not in blocked_tools
=> sys.exit(0)) — a phantom gate that looks wired but never actually blocks the fan-out it names in
its matcher. Always list every tool named in `matcher` in GATE_BLOCKED_TOOLS too.

Grounded in: April 2026 meta-audit — workflow-creator found that advisory gates
("you must run X first") were systematically skipped under context pressure.
Hooks are runtime-enforced by Claude Code; Claude cannot rationalize past them.

FRONTMATTER READING — behavior notes for the skills already wiring this hook:

The reader is hand-rolled and fails closed: absent, nested, duplicated, or
non-scalar keys all read as '' and the gate blocks. Three consequences, all
verified in tests/phase_gate_guard_test.py:

  - STRICTER (bug fix): a nested `status: APPROVED` no longer satisfies the
    status gate. The previous reader stripped every line before matching, so any
    indented `status:` under any parent key passed the gate — a real bypass in
    every skill that wires it.
  - STRICTER (bug fix): `---` is a delimiter only as a standalone line. The
    previous `text.split('---', 2)` cut on any occurrence, so the scalar
    `status: APPROVED---nope` was truncated to a passing `APPROVED`.
  - STRICTER: a plain scalar's indented continuation lines (`status: APPROVED`
    / `  nope` — one value, `APPROVED nope`) now block instead of reading as
    `APPROVED`. Same for quoted scalars with escapes or trailing junk.
  - STRICTER: duplicate keys now block instead of resolving to one of them.
    Ambiguous evidence is not evidence.
  - STRICTER (bug fix): `status:APPROVED` no longer matches. A block mapping
    needs whitespace after the colon, so YAML reads that line as the plain
    scalar "status:APPROVED" — the document has no `status` key at all, and the
    old reader handed back `APPROVED` from it.
  - LOOSER (YAML correctness): `status: APPROVED # signed off` now passes. YAML
    says that value is `APPROVED`; the old reader compared the whole string
    including the comment and blocked. A quoted `'APPROVED # invalid'` still
    blocks — inside quotes the '#' is literal text, not a comment.

  - STRICTER: the frontmatter must be a FLAT mapping of scalars. If any
    top-level line opens a flow collection or leaves a quote unterminated, the
    whole block is refused — such a construct captures the lines beneath it, so
    `broken: [` followed by `status: APPROVED` has no top-level `status` at all,
    yet a line-wise reader would find one. Indented content (block scalars,
    nested mappings) is fine: it cannot masquerade as a top-level key.

Decorated YAML — anchors (`&a`), tags (`!!str`), aliases (`*a`), flow
collections (`[x]`, `{k: v}`) — is not a plain scalar and fails closed. Gate
artifacts never legitimately use them, and a resolver for them is surface to get
subtly wrong. One accepted leniency: a stray trailing tab (`status: APPROVED\t`)
is read as `APPROVED` where PyYAML rejects the document outright; it cannot
smuggle a different value (`status: APPROVED\tx` still blocks).

tests/phase_gate_guard_differential_test.py pins all of this against PyYAML over
a generated corpus: the reader must never accept a value PyYAML disagrees with.

KNOWN RESIDUAL — the reader can accept a gate value from a document that is
malformed SOMEWHERE ELSE. Its checks cover every column-0 line, but indented
lines are skipped by design (they belong to a parent key), so:

    status: APPROVED
    prior:
      broken: 'x' junk        <- invalid YAML; PyYAML rejects the whole document

still reads `status: APPROVED`. Closing this means validating the entire
document — i.e. a real YAML parser, which is the dependency this hook avoids on
purpose (it fires on every tool call; a gate that must resolve a package before
answering can fail OPEN, which is strictly worse than this).

The residual is bounded and does not fabricate verdicts. Everything that could
make a line MEAN something other than what it says — capture by a multi-line
construct, quoting, escapes, comments, duplicate keys — fails closed. What
remains is only: a gate line that genuinely says `APPROVED`, in a file whose
unrelated line is corrupt. It cannot smuggle a value the artifact does not
contain, which is what the gate exists to prevent.
"""

import json
import os
import re
import sys
from pathlib import Path


# Tools that this hook can block (configured per-skill via env var)
DEFAULT_BLOCKED_TOOLS = {'Write', 'Edit'}

# Files that are always allowed (workflow state, not project code)
ALWAYS_ALLOWED_DIRS = {'.planning', '.claude'}


def check_artifact_exists(artifact_path: str) -> bool:
    """Check if the gate artifact file exists."""
    return Path(artifact_path).is_file()


def read_frontmatter(artifact_path: str) -> str:
    """Return the artifact's YAML frontmatter block, or '' if there isn't one.

    A delimiter is a LINE that is exactly `---`, not any `---` substring: the
    latter truncates scalars that merely contain the sequence, so
    `status: APPROVED---nope` would be cut down to a passing `APPROVED` when
    YAML says the value is `APPROVED---nope`.
    """
    try:
        text = Path(artifact_path).read_text()
    except Exception:
        return ''

    # rstrip, not strip: trailing whitespace after `---` is still a delimiter,
    # but an INDENTED `  ---` is a plain-scalar continuation line — YAML reads
    # `status: APPROVED` + `  ---` as the single value `APPROVED ---`, so
    # treating it as the closing delimiter would pass a gate on a value the
    # document doesn't contain.
    lines = text.splitlines()
    if not lines or lines[0].rstrip() != '---':
        return ''
    for i in range(1, len(lines)):
        if lines[i].rstrip() == '---':
            return '\n'.join(lines[1:i])
    return ''  # unterminated frontmatter — no readable evidence


def _yaml_scalar(raw: str) -> str:
    """Extract the scalar from a YAML `key:` right-hand side.

    Deliberately hand-rolled: every hook here is dependency-free, and this one
    fires on every tool call — a hook that must resolve a package before it can
    answer is a hook that can fail open. Handles exactly what gate fields are:
    short quoted-or-bare scalars. Anything else returns '' and the gate blocks.
    """
    raw = raw.strip()
    if not raw:
        return ''

    # Quoted scalar: the value is what's between the quotes. A '#' inside is
    # literal text, NOT a comment — `'enabled # error'` is one value, not
    # `enabled` with a note. Quotes are not merely delimiters to scan past:
    # YAML escapes a quote by doubling it ('' inside '...') or with a backslash
    # (\" inside "..."), so `'APPROVED'' # invalid'` is the single value
    # `APPROVED' # invalid` — reading it as `APPROVED` would pass a gate the
    # artifact does not actually satisfy.
    if raw[0] in ('"', "'"):
        quote = raw[0]
        chars = []
        i = 1
        while i < len(raw):
            ch = raw[i]
            if quote == "'" and ch == "'" and raw[i + 1:i + 2] == "'":
                chars.append("'")          # '' -> literal '
                i += 2
                continue
            if quote == '"' and ch == '\\':
                # A double-quoted YAML scalar can escape a newline (\n), a tab,
                # a codepoint (✓)... Decoding that table by hand is a way to
                # be subtly wrong: naively dropping the backslash turns
                # "decli\ned" into `declined`, when YAML says it contains a
                # newline and is NOT `declined`. Gate values are short enums —
                # `APPROVED`, `enabled` — that never legitimately need an escape,
                # so refuse the whole scalar instead of decoding it.
                return ''
            if ch == quote:
                # Closing quote: only whitespace and an optional comment may
                # follow, and YAML needs whitespace before that comment.
                # Anything else means this isn't the scalar we think.
                if not _rest_is_clean(raw[i + 1:]):
                    return ''
                return ''.join(chars)
            chars.append(ch)
            i += 1
        return ''                          # unterminated quote

    # Bare scalar: YAML only starts a comment at a '#' preceded by whitespace,
    # so `enabled#1` is a value while `enabled # note` is a value + comment.
    for i, ch in enumerate(raw):
        if ch == '#' and (i == 0 or raw[i - 1] in ' \t'):
            return raw[:i].strip()
    return raw


def _quote_scan(value: str):
    """(closed, raw_text_after_closing_quote) for a quoted scalar.

    The remainder is returned UNSTRIPPED: whether whitespace separated the
    closing quote from what follows is load-bearing (see _rest_is_clean).
    """
    quote = value[0]
    i = 1
    while i < len(value):
        if quote == "'" and value[i] == "'" and value[i + 1:i + 2] == "'":
            i += 2          # '' escape
            continue
        if quote == '"' and value[i] == '\\':
            i += 2          # \x escape
            continue
        if value[i] == quote:
            return True, value[i + 1:]
        i += 1
    return False, ''


def _rest_is_clean(rest: str) -> bool:
    """May this text follow a closing quote — i.e. nothing, or a real comment?

    YAML requires whitespace before a trailing `#`, so `'APPROVED'#x` is not a
    value plus a comment: it's a syntax error, and PyYAML rejects the document
    rather than reading `APPROVED` out of it. Accepting the `#` as a comment
    would open a gate on a file YAML refuses to parse.
    """
    if rest == '':
        return True
    if rest[:1] not in (' ', '\t'):
        return False
    tail = rest.strip()
    return tail == '' or tail.startswith('#')


# A gate artifact's top-level line is `key: scalar`. Anything outside that
# subset is refused rather than interpreted — see supported_line().
_KEY_RE = re.compile(r'^[A-Za-z0-9_.\-]+$')
_BLOCK_HEADER_RE = re.compile(r'^[|>][+-]?\d*\s*(#.*)?$')
# Indicators that start something other than a plain scalar: flow collections,
# properties/aliases, complex keys, directives, and YAML's reserved characters.
_NOT_PLAIN = set('!&*[]{}?%@`,>|')


def supported_line(line: str) -> bool:
    """Is this column-0 line inside the narrow `key: scalar` subset we support?

    An ALLOWLIST, deliberately. Enumerating dangerous constructs is endless —
    each new YAML feature is another hole. Enumerating the *supported* ones is
    closed: anything unrecognized fails closed, including syntax that makes the
    document invalid outright (`broken: 'x' junk`, `broken: foo: bar`), because
    a gate must not read a value out of a file YAML itself rejects.
    """
    if ':' not in line:
        return False                       # not a mapping entry at all
    key, value = line.split(':', 1)
    if not _KEY_RE.match(key):
        return False                       # exotic key, or a `%TAG ...` directive
    if value and value[:1] not in (' ', '\t'):
        return False                       # `key:value` — YAML needs the space

    v = value.strip()
    if not v or v.startswith('#'):
        return True                        # empty value, or value-less + comment
    if _BLOCK_HEADER_RE.match(v):
        return True                        # `|`, `>-`: content is indented, safe

    if v[0] in ('"', "'"):
        closed, rest = _quote_scan(v)
        if not closed:
            return False                   # captures the lines below
        if v[0] == '"' and '\\' in v:
            return False                   # escapes we deliberately don't decode
        return _rest_is_clean(rest)        # no trailing tokens, no `'x'#unspaced`

    if v[0] in _NOT_PLAIN:
        return False
    plain = v.split(' #', 1)[0].rstrip()   # drop a trailing comment
    if ': ' in plain or plain.endswith(':'):
        return False                       # `foo: bar` as a value — invalid here
    return True


def frontmatter_is_flat(frontmatter: str) -> bool:
    """Is this frontmatter a flat mapping of scalars — i.e. safe to read line by line?

    Reading a gate field line-by-line is only sound when no line can be captured
    by a construct opened on an earlier one. An unterminated flow collection or
    quote swallows the lines beneath it, so

        broken: [
        status: APPROVED

    has NO top-level `status` — the line belongs to `broken` — yet a line-wise
    reader sees `status: APPROVED` and opens the gate. Rather than re-implement
    YAML to find out, refuse the whole block: a gate that cannot trust its own
    evidence must not pass on it.

    Enforced by supported_line(), which is an ALLOWLIST — that is what makes
    this closed rather than whack-a-mole. Rejecting known-dangerous constructs
    invites an endless series of "one more syntax": a flow collection captures
    the lines below it, a tag hides the quote that captures them, and so on.
    Accepting only `key: scalar` inverts the burden — unrecognized syntax fails
    closed by default, including syntax that makes the document invalid outright,
    which YAML would refuse to read at all.

    Block scalars (`|`, `>`) are allowed and are not a hole: their content must
    be INDENTED, so they can never capture a column-0 line (verified against
    PyYAML). Plain scalars can continue, but only onto INDENTED lines, which
    frontmatter_value() fails closed on.
    """
    for line in frontmatter.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        if line[:1] in (' ', '\t'):
            continue            # indented: belongs to a parent key, not our level
        if not supported_line(line):
            return False
    return True


def frontmatter_value(frontmatter: str, key: str) -> str:
    """Return the top-level scalar for `key`, or '' when absent or ambiguous.

    Fails closed: an absent, nested, duplicated, or non-scalar key all yield ''
    so the caller blocks. A gate that cannot read its own evidence must not pass.
    """
    if not frontmatter_is_flat(frontmatter):
        return ''

    lines = frontmatter.splitlines()
    matches = []
    for i, line in enumerate(lines):
        # Top-level keys only — an indented `codex_second_pass:` belongs to some
        # nested mapping and must not satisfy a top-level requirement.
        if not line[:1].strip():
            continue
        if line.lstrip().startswith('#'):
            continue
        if not line.startswith(f'{key}:'):
            continue

        # A block mapping needs whitespace (or EOL) after the colon: `status:X`
        # is NOT a key/value pair, it's the plain scalar "status:X", so the
        # document has no `status` key at all. Matching it anyway would read
        # `APPROVED` out of `status:APPROVED` and open a gate on a document
        # that never recorded a status.
        after = line[len(key) + 1:]
        if after and after[:1] not in (' ', '\t'):
            continue

        # A YAML plain scalar continues onto indented following lines, so
        #     status: APPROVED
        #       nope
        # is the single value `APPROVED nope` — reading only the first line
        # would pass a gate on a value the document doesn't contain. Any
        # indented continuation makes this unreadable here: fail closed.
        nxt = lines[i + 1] if i + 1 < len(lines) else ''
        if nxt.strip() and nxt[:1] in (' ', '\t'):
            return ''

        matches.append(_yaml_scalar(line.split(':', 1)[1]))

    # Duplicate keys are ambiguous (real YAML rejects them) — block, don't guess.
    if len(matches) != 1:
        return ''
    return matches[0]


def check_artifact_status(artifact_path: str, required_status: str) -> bool:
    """Check if the artifact's frontmatter contains the required status."""
    frontmatter = read_frontmatter(artifact_path)
    if not frontmatter:
        return False
    value = frontmatter_value(frontmatter, 'status')
    return bool(value) and value.upper() == required_status.upper()


def parse_required_fields(spec: str) -> list:
    """Parse GATE_REQUIRE_FIELDS into [(key, allowed_values_or_None), ...].

    `name` -> presence only; `name:v1|v2` -> presence + membership.
    """
    requirements = []
    for entry in spec.split(','):
        entry = entry.strip()
        if not entry:
            continue
        if ':' in entry:
            key, values = entry.split(':', 1)
            allowed = {v.strip().lower() for v in values.split('|') if v.strip()}
            requirements.append((key.strip(), allowed or None))
        else:
            requirements.append((entry, None))
    return requirements


def check_required_fields(artifact_path: str, spec: str) -> list:
    """Return human-readable problems for each unmet field requirement."""
    frontmatter = read_frontmatter(artifact_path)
    problems = []
    for key, allowed in parse_required_fields(spec):
        value = frontmatter_value(frontmatter, key) if frontmatter else ''
        if not value:
            problems.append(f"`{key}` is missing or empty")
        elif allowed and value.lower() not in allowed:
            expected = ' | '.join(sorted(allowed))
            problems.append(
                f"`{key}: {value}` is not one of: {expected}"
            )
    return problems


def is_allowed_path(file_path: str) -> bool:
    """Check if the target file is in an always-allowed directory."""
    parts = Path(file_path).parts
    return any(d in parts for d in ALWAYS_ALLOWED_DIRS)


def main():
    # Read hook configuration from environment
    artifact_path = os.environ.get('GATE_ARTIFACT', '')
    required_status = os.environ.get('GATE_STATUS', '')
    required_fields = os.environ.get('GATE_REQUIRE_FIELDS', '')
    gate_description = os.environ.get('GATE_DESCRIPTION', 'Phase gate')
    gate_remedy = os.environ.get('GATE_REMEDY', 'Complete the previous phase first')
    blocked_tools_str = os.environ.get('GATE_BLOCKED_TOOLS', '')

    if not artifact_path:
        # No gate configured — allow everything
        sys.exit(0)

    # Parse blocked tools
    if blocked_tools_str:
        blocked_tools = {t.strip() for t in blocked_tools_str.split(',')}
    else:
        blocked_tools = DEFAULT_BLOCKED_TOOLS

    # Read hook input
    try:
        hook_input = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = hook_input.get('tool_name', '')
    tool_input = hook_input.get('tool_input', {})

    # Only check blocked tools
    if tool_name not in blocked_tools:
        sys.exit(0)

    # Allow writes to workflow state dirs (.planning/, .claude/)
    file_path = tool_input.get('file_path', '')
    if file_path and is_allowed_path(file_path):
        sys.exit(0)

    # For Bash/Agent, always check (no file_path to exempt)
    # For Write/Edit, we already checked the path above

    # --- Gate check ---

    if not check_artifact_exists(artifact_path):
        deny(
            tool_name, file_path,
            f"GATE BLOCKED: {gate_description} artifact missing.\n\n"
            f"Required: `{artifact_path}` — file does not exist.\n\n"
            f"This phase cannot proceed without the gate artifact from the "
            f"previous phase. The artifact proves the gate actually ran — "
            f"instructional text alone is not enforcement.\n\n"
            f"**Remedy:** {gate_remedy}"
        )

    if (required_status or required_fields) and not frontmatter_is_flat(read_frontmatter(artifact_path)):
        deny(
            tool_name, file_path,
            f"GATE BLOCKED: {gate_description} — artifact is not readable.\n\n"
            f"`{artifact_path}` does not parse as a flat YAML mapping of simple "
            f"values: a line opens a flow collection (`[`, `{{`) or leaves a quote "
            f"unterminated, which captures the lines beneath it. The gate cannot "
            f"tell what this file actually records, and evidence it cannot read "
            f"is not evidence.\n\n"
            f"Fix the frontmatter so every top-level line is a plain `key: value` "
            f"pair, then re-run the phase.\n\n"
            f"**Remedy:** {gate_remedy}"
        )

    if required_status and not check_artifact_status(artifact_path, required_status):
        deny(
            tool_name, file_path,
            f"GATE BLOCKED: {gate_description} — wrong status.\n\n"
            f"Required: `{artifact_path}` with `status: {required_status}`\n"
            f"The file exists but does not have the required status.\n\n"
            f"**Remedy:** {gate_remedy}"
        )

    if required_fields:
        problems = check_required_fields(artifact_path, required_fields)
        if problems:
            detail = '\n'.join(f"- {p}" for p in problems)
            deny(
                tool_name, file_path,
                f"GATE BLOCKED: {gate_description} — required decision not recorded.\n\n"
                f"In `{artifact_path}`:\n{detail}\n\n"
                f"The status says this phase passed, but a decision it was required "
                f"to record is missing or unrecognized. A phase that reports success "
                f"without recording what it decided cannot be audited afterwards — "
                f"'it probably ran' is not evidence that it ran.\n\n"
                f"**Remedy:** {gate_remedy}"
            )

    # Gate passed — allow the tool call
    sys.exit(0)


def deny(tool_name: str, file_path: str, reason: str):
    """Emit a PreToolUse deny decision and exit."""
    target = f" on `{file_path}`" if file_path else ""
    result = {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason
        }
    }
    print(json.dumps(result))
    sys.exit(0)


if __name__ == '__main__':
    main()
