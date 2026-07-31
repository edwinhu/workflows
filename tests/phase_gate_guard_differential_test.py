#!/usr/bin/env -S uv run python3
"""Differential test: extracted TypeScript phase-gate reader vs PyYAML.

The reader is hand-rolled on purpose — every hook here is dependency-free, and
this one fires on every tool call, so a gate that must resolve a package before
it can answer is a gate that can fail open. That buys safety at the cost of
owning YAML's edge cases, so this pins the reader against the real parser over a
generated corpus.

The oracle is `safe_load_all`: `---` is YAML's own document separator, so
frontmatter is exactly document #1. (`safe_load` raises on a `---`-delimited
file — it's a multi-document stream.)

The bar is NOT "matches PyYAML everywhere". It is "never accepts a value PyYAML
disagrees with":

  exact       — reader and PyYAML agree.
  fail-closed — reader returns '' (gate blocks) where PyYAML has a value. Safe:
                a phase is blocked, never falsely approved. Decorated YAML
                (anchors, tags, aliases, flow collections) lands here by design.
  lenient     — reader returns the same value PyYAML *would* mean, on a document
                PyYAML rejects outright (only: a stray trailing tab). Cannot
                smuggle a wrong value; `status: APPROVED\tx` still blocks.
  UNSAFE      — reader hands back something that satisfies a gate while PyYAML
                disagrees. Must be zero.

Run: uv run --with pyyaml python3 tests/phase_gate_guard_differential_test.py
Skips cleanly when PyYAML isn't installed.
"""

import itertools
import json
import subprocess
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    print('SKIP: PyYAML not installed (run with: uv run --with pyyaml python3 ...)')
    sys.exit(0)

MODULE = Path(__file__).resolve().parent.parent / 'hooks' / 'lib' / 'phase-gate.ts'


def typescript_values(documents):
    """Read status values through the extracted TypeScript evaluator parser."""
    script = r'''
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const { phaseGateFrontmatter } = await import(process.argv[1]);
const docs = JSON.parse(await Bun.stdin.text());
const root = mkdtempSync(join(tmpdir(), "phase-gate-diff-"));
const artifact = join(root, "state.md");
const values = docs.map((doc) => {
  writeFileSync(artifact, doc);
  return phaseGateFrontmatter.value(phaseGateFrontmatter.read(artifact), "status");
});
rmSync(root, { recursive: true, force: true });
process.stdout.write(JSON.stringify(values));
'''
    proc = subprocess.run(
        ['bun', '-e', script, str(MODULE)],
        input=json.dumps(documents), capture_output=True, text=True, check=True,
    )
    return json.loads(proc.stdout)

# Values that would actually satisfy a real gate in this repo.
GATE_VALUES = {'approved', 'enabled', 'declined', 'unavailable'}

# Documents PyYAML rejects but where the gate line itself genuinely says what
# the reader reports. Accepting them tolerates a corrupt file; it cannot
# fabricate a value the artifact does not contain.
#
#   - a stray trailing tab (PyYAML rejects any trailing tab after a scalar);
#   - malformed content in INDENTED lines, which the reader skips by design
#     because indented content belongs to a parent key. Closing this would mean
#     validating the whole document — a real YAML parser, the dependency this
#     hook avoids on purpose (see its docstring's KNOWN RESIDUAL).
#
# Pinned here so the residual stays a known, bounded fact instead of drifting.
LENIENT = {'---\nstatus: APPROVED\t\n---\n',
           '---\nother: 1\nstatus: APPROVED\t\n---\n',
           '--- \nstatus: APPROVED\t\n--- \n',
           "---\nstatus: APPROVED\nprior:\n  broken: 'x' junk\n---\n"}


def oracle(text):
    """The `status` of the first YAML document, or '' when there isn't one."""
    try:
        docs = list(yaml.safe_load_all(text))
    except Exception:
        return '<invalid>'
    if not docs or not isinstance(docs[0], dict):
        return ''                       # not a mapping -> no status key at all
    value = docs[0].get('status')
    return '' if value is None else str(value)


VALUES = [
    # YAML needs whitespace before a trailing comment, so `'APPROVED'#x` is a
    # syntax error, not a value plus a note.
    "'APPROVED'#x", '"APPROVED"#x', "'APPROVED' #x", "APPROVED#x",
    "APPROVED", "'APPROVED'", '"APPROVED"', "APPROVED # c", "'APPROVED # c'",
    "'APPROVED'' # c'", '"APPR\\nOVED"', '"A\\PPROVED"', "APPROVED---x",
    "&anc APPROVED", "!!str APPROVED", "{a: b}", "[APPROVED]", "APPROVED  ",
    "'APPROVED' junk", "'APPROVED", '"APPROVED', "", "~", "null", "APPROVED\t",
    " APPROVED", "'APPROVED '", "APPROVED#x", "APPROVED\tx",
]
SHAPES = [
    "---\nstatus: {v}\n---\n",              # canonical
    "---\nstatus:{v}\n---\n",               # no space: not a mapping at all
    "---\nstatus: {v}\n  cont\n---\n",      # plain-scalar continuation
    "---\nother: 1\nstatus: {v}\n---\n",    # not the first key
    "---\nstatus: {v}\n  ---\n",            # indented delimiter = continuation
    "--- \nstatus: {v}\n--- \n",            # trailing space on delimiters
    "---\nstatus: {v}\nstatus: OTHER\n---\n",   # duplicate keys
]
DOCS = [s.format(v=v) for s, v in itertools.product(SHAPES, VALUES)] + [
    "---\nstatus: |\n  APPROVED\n---\n",        # block scalar
    "---\nstatus: >-\n  APPROVED\n---\n",       # folded scalar
    "---\nx: &a APPROVED\nstatus: *a\n---\n",   # alias
    "---\nstatus_extra: APPROVED\n---\n",       # prefix collision
    "---\n\tstatus: APPROVED\n---\n",           # tab indent
    "﻿---\nstatus: APPROVED\n---\n",       # BOM
    "---\r\nstatus: APPROVED\r\n---\r\n",       # CRLF
    "---\nSTATUS: APPROVED\n---\n",             # case
    "---\n---\nstatus: APPROVED\n---\n",        # empty first document
    "---\nstatus: APPROVED\n...\n",             # explicit document end
    "---\nstatus: APPROVED",                    # unterminated frontmatter
    "status: APPROVED\n",                       # no frontmatter
    # A construct opened on an earlier line captures the lines below it, so
    # `status:` is not a top-level key in any of these.
    "---\nbroken: [\nstatus: APPROVED\n---\n",
    "---\nbroken: {\nstatus: APPROVED\n---\n",
    "---\nbroken: 'oops\nstatus: APPROVED\n---\n",
    '---\nbroken: "oops\nstatus: APPROVED\n---\n',
    "---\nitems: [\nstatus: APPROVED ]\n---\n",
    "---\nitems: {\nstatus: APPROVED }\n---\n",
    "---\nstatus: APPROVED\nbroken: [\n---\n",
    # A YAML property hides the opener from a first-character check.
    "---\nbroken: !!str 'oops\nstatus: APPROVED # close'\n---\n",
    "---\nbroken: &a 'oops\nstatus: APPROVED # close'\n---\n",
    "---\nbroken: !!seq [\nstatus: APPROVED\n---\n",
    # The known residual, pinned: malformed content in an INDENTED line the
    # reader skips by design. Lands in LENIENT, not UNSAFE.
    "---\nstatus: APPROVED\nprior:\n  broken: 'x' junk\n---\n",
    # Malformed siblings: PyYAML rejects the whole document, so it assigns
    # `status` no value and neither may we.
    "---\nstatus: APPROVED\nbroken: 'x' junk\n---\n",
    '---\nstatus: APPROVED\nbroken: "\\q"\n---\n',
    "---\nstatus: APPROVED\nbroken: foo: bar\n---\n",
    "---\n%TAG !e! tag:example.com,2020:\nstatus: APPROVED\n---\n",
    "---\nstatus: APPROVED\nbroken\n---\n",
    "---\nstatus: APPROVED\n- item\n---\n",
    # ...and legitimate shapes that must NOT be rejected as unreadable.
    "---\nnotes: |\n  status: NOT_THIS\nstatus: APPROVED\n---\n",
    "---\nprior:\n  note: x\nstatus: APPROVED\n---\n",
    "---\nstatus: APPROVED\nsummary: it's done\n---\n",
    "---\nstatus: APPROVED\nurl: http://example.com/x\n---\n",
    "---\nstatus: APPROVED\nlast_review_date: 2026-03-09\n---\n",
    "---\nstatus: APPROVED\nnote: a, b\n---\n",
    "---\nstatus: APPROVED\niteration: 2\nissues_found_count: 0\n---\n",
    "---\nstatus: APPROVED\nnote: 'a: b'\n---\n",
    "---\nstatus: APPROVED\nempty:\n---\n",
    "---\nstatus: APPROVED\n# a comment\nverdict: APPROVED\n---\n",
]

# Legitimate artifacts the gate MUST still accept — an over-strict reader that
# blocks real REVIEW_STATE.md files is its own outage.
MUST_ACCEPT = [
    "---\nstatus: APPROVED\niteration: 2\nmax_iterations: 3\n"
    "last_review_date: 2026-03-09\nissues_found_count: 0\n"
    "codex_second_pass: enabled\nverdict: APPROVED\n---\n",
    "---\nstatus: APPROVED\ncodex_second_pass: declined\n"
    "summary: it's done\nurl: http://example.com/x\n---\n",
    "---\nstatus: APPROVED\nnotes: |\n  free text\ncodex_second_pass: unavailable\n---\n",
]

buckets = {'exact': 0, 'fail-closed': 0, 'lenient': 0}
unsafe = []

for doc, mine in zip(DOCS, typescript_values(DOCS), strict=True):
    truth = oracle(doc)

    if mine == truth:
        buckets['exact'] += 1
    elif mine == '':
        buckets['fail-closed'] += 1
    elif doc in LENIENT and mine.lower() in GATE_VALUES:
        buckets['lenient'] += 1
    elif mine.lower() in GATE_VALUES:
        unsafe.append((doc, mine, truth))       # would satisfy a gate
    else:
        buckets['fail-closed'] += 1             # junk value -> blocks anyway

# An allowlist's failure mode is over-blocking. Prove the reader still accepts
# artifacts that are unremarkable and valid.
over_blocked = []
for doc, mine in zip(MUST_ACCEPT, typescript_values(MUST_ACCEPT), strict=True):
    if mine != oracle(doc) or mine != 'APPROVED':
        over_blocked.append((doc, mine, oracle(doc)))

print(f"corpus            : {len(DOCS)} documents")
print(f"  exact           : {buckets['exact']}")
print(f"  fail-closed     : {buckets['fail-closed']}  (stricter than YAML — safe)")
print(f"  lenient         : {buckets['lenient']}  (trailing tab; same value, YAML rejects doc)")
print(f"  UNSAFE          : {len(unsafe)}")

print(f"  over-blocked    : {len(over_blocked)}  (valid artifacts wrongly refused)")

if unsafe:
    print()
    for doc, mine, truth in unsafe:
        print(f"  doc={doc!r}\n    hook={mine!r}  yaml={truth!r}")
    print("\nFAILED: the reader accepted a gate value PyYAML disagrees with")
    sys.exit(1)

if over_blocked:
    print()
    for doc, mine, truth in over_blocked:
        print(f"  doc={doc!r}\n    hook={mine!r}  yaml={truth!r}")
    print("\nFAILED: the reader refused a valid artifact — over-strict is an outage")
    sys.exit(1)

print("\nno unsafe divergence from PyYAML; no valid artifact over-blocked")
sys.exit(0)
