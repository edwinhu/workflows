# Test-driven development

## RED — GREEN — REFACTOR

**No implementation before a genuine RED observation.** A test that passes on its first run does not
prove the intended missing behaviour was ever exercised.

1. Write the smallest real test that exercises the production path the task names. Unit-only or
   mock-only coverage does not substitute for a required integration/E2E path.
2. Run it before implementing and read the output. Accept RED **only** when it fails for the
   intended missing behaviour — not a syntax error, an import error, a broken fixture, an
   unavailable dependency, or an unrelated failure elsewhere in the suite.
3. Implement the minimum that satisfies the task. Changing the architecture or the test contract is
   a stop — return to planning, do not widen the task in place.
4. Run the exact verify command to GREEN and read its output, then the broader suite and any
   required real/E2E test.
5. Refactor only while every required test stays green.

A doer never grades its own task; an independent verifier decides PASS/FAIL.

## Delete and restart

Implementation written before a valid RED is untrusted. Revert that task's implementation, restore
the pre-task state, write the failing test, observe the intended RED, then implement again.

**Never manufacture RED** by weakening an assertion, breaking a fixture, or asserting something the
task is not about. A RED produced that way makes the gate report success on work nothing checked.

## The test must do what the user does

Exercise the **declared production protocol, transport, entry point, and visible outcome**. If the
task ships an HTTP endpoint, the test issues an HTTP request; if it ships a CLI, the test runs the
binary; if it ships a UI action, the test performs the action and asserts the resulting state.

Not behavioural evidence:

- source inspection ("the handler clearly returns 200")
- grep results ("the string is present in the file")
- a screenshot with no runtime setup, or a whole-screen capture that cannot isolate the app
- a log line merely existing, without reading the log for startup failures

For processes and GUI/E2E systems: build, launch with output captured to a file, wait for
readiness, confirm the process is alive, read the whole log, confirm it holds no startup failure —
and only then run the user-facing assertion or capture evidence.

## `redCommand` — the gate that executes

Each task declares `redCommand`: the exact command that fails before the task is implemented and
passes after. It is **not evidence you report**. Craft's spine dispatches a probe that runs the
string verbatim on both sides of the implementer and reads the two exit codes.

| Verdict | Meaning |
|---|---|
| `red-unproven` | a probe died, was skipped, or returned no exit code |
| `red-not-red` | exit 0 **before** implementation — the test does not pin the behaviour being built |
| `green-not-green` | still non-zero **after** implementation |

`red-not-red` is the one to internalise: a test that already passed proves nothing about the work,
and no self-reported "RED confirmed" can rule it out.

**What actually protects the gate — and what does not.** The implementer CAN see the command: the
AUTHORITY block makes the hashed plan every agent's only authority and tells it to read that plan,
which carries the `Test-first:` lines. What it cannot do is change what it is judged by — the plan is
hashed and the args are fixed, so the command cannot be swapped after approval. The RED observation
is also unfakeable by construction rather than by secrecy: the probe runs BEFORE the implementer is
dispatched, so there is no tree state it could have arranged. Narrow `writablePaths` is what limits
the remaining move — targeting GREEN by editing the test itself rather than the behaviour.

**One invocation, not a shell program.** The operators `;` `&` `|` `` ` `` `$` `>` `<` `(` `)` `{`
`}` and newlines are rejected at arg-validation. Flags and quotes are fine —
`pytest tests/x.py -k "a or b"` is valid, `test -f /tmp/m || { touch /tmp/m; exit 1; }` is not. The
probe runs this string with its own authority; an unconstrained one is arbitrary code execution, and
every known way to fabricate RED (marker file, counter alternating across a wave, mutating a
declared output after adjudication) needs an operator. A multi-step check goes in a script you name.

### What this does not close

The command still loads code the implementer may control — a test file, a `conftest.py`, a fixture.
Authenticating the command string does not authenticate what it transitively imports, so an
implementer permitted to edit the test it is judged by can still run code inside the probe. **Narrow
the task's `writablePaths` when that matters** — keep the file the `redCommand` executes outside
them wherever the task allows it.
