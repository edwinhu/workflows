# Lens: tests

Judges only the tests covering the changed code. Not security, not performance — another lens owns
each of those.

## What counts as a finding

A **verified** gap or defect in the tests for **this change**: behaviour that ships unverified, or a
test that will not fail when the behaviour it names breaks. A finding names the test file (or the
untested code) and the specific behaviour left unpinned. Read the tests before claiming a gap —
"there is probably no test for X" is not a finding.

## Finding classes

**Vacuous or non-pinning assertions**

- a test that exercises the path but asserts only that it did not throw, or asserts nothing
- asserting on a mock's call arguments only, never on the observable result
- an assertion so loose it holds for the broken behaviour too (`toBeTruthy` on a computed value,
  `assert result` where the value matters, matching a substring that also appears in the error path)
- a snapshot committed without being read, or regenerated to make a failure go away
- a test whose subject is entirely mocked — the mock, not the code under test, is what passes
- `expect` inside a callback or `catch` that never runs, so absence of the behaviour passes silently

**Mocks that diverge from the real thing**

- a stub returning a shape the real dependency never returns (missing error field, different casing,
  wrong null convention)
- error paths simulated by a mock that throws a type the real client does not throw
- the required real/integration path replaced by a unit test against a mocked transport — for a task
  whose declared production protocol is HTTP/CLI/UI, a mocked-transport test does not substitute

**Fixtures no production path can produce**

Building a fixture directly is normal and not a finding — seeding a corpus, a temp directory, a canned
provider response, a hand-built request. The smell is narrower, and all three parts must hold: the test
writes state the code under test OWNS (raw SQL into its tables, a hand-edited on-disk record, a field
poked past its setter), it does so instead of calling a production writer that exists, and it asserts a
NEGATIVE CAPABILITY from it — "no watermark can see this", "the cache never invalidates", "this is
undetectable". Then ask: **which production code path produces this state?** Check the real writers. If
every one of them makes it unreachable — they all restamp the timestamp, bump the counter, move the row,
delete rather than mutate — the test pins fiction. It passes forever, it shapes the design, and the
defect it was groping toward ships untested. MAJOR: name the writers you read and what each does instead.

**Missing paths for the change**

- the error path of a function whose error handling this change added or altered
- boundary inputs the code branches on: empty collection, single element, null/undefined, zero,
  negative, max length, duplicate keys, unicode/multibyte
- the failure modes of an added integration point: non-2xx response, timeout, malformed payload,
  connection refused, partial write
- a new public entry point (route, CLI subcommand, exported function) with no test invoking it
- a bug fix with no test that fails against the pre-fix code

**Reliability**

- `sleep`/fixed timeouts standing in for waiting on a condition
- dependence on wall-clock time, timezone, locale, or "now" without freezing or injecting it
- unseeded randomness, or iteration order of an unordered collection asserted as a sequence
- shared mutable state across tests — one test's writes making another pass, or a suite that fails
  when run in isolation or in a different order
- unclean setup/teardown: real network, real filesystem outside a temp dir, a live shared database
- brittle UI selectors keyed to class names, nth-child position, or copy text instead of a stable
  test id or role

**Scope of the run**

- a test added but not reachable by the project's test command (wrong directory, filename pattern,
  missing registration)
- a test skipped, `.only`-scoped, or excluded by config so the suite reports green without it

## Not a finding

- a pre-existing coverage gap the change did not create
- "this should have a test" for behaviour the change did not touch
- test naming, file layout, or structure preferences that do not affect what the suite catches
- coverage percentage on its own, absent a named behaviour that ships unverified

If the diff does not show the test file for a hunk you must judge, say what you would need to see
rather than guessing a verdict in either direction.
