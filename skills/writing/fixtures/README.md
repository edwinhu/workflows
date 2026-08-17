# writing fixtures — the mechanical checks, demonstrated flipping

One fixture writing project, kept in the tree as a deliverable rather than scratch: craft's verifier is read-only and must be able to re-run every check against it.
substitute for observing it. Every line here runs as written from this directory.

`clean/` is a complete, well-formed writing project — the fixture every mechanical check runs
against, and the one artifact this directory stores.

**The broken variants are generated, not stored.** `scripts/writing_flip_test.py` copies `clean/` to
a temp dir once per check, applies exactly one defect, and asserts the check exits **0 on clean and
non-zero on the break**. A check demonstrated only passing is indistinguishable from one that always
errors, so the flip is a gate that runs every time rather than a claim in this file that nothing
re-checks:

| check | the single defect the generator applies |
|---|---|
| `GRAMMAR` | `## Counterarguments` removed from the plan |
| `RECEIPT` | `.planning/.state/review.json` `status` set to `PENDING` |
| `CITE` | a line citing `@nosuchkey2021`, absent from `references/sources.bib` |
| `CLAIM` | `drafts/Part I. The Gap (Draft).md` set to `implements: []`, dropping `CLAIM-01` |
| `PROSE` | one sentence carrying `stands as a testament to` — rated `hard` by `prose-audit.py` |

Each variant differs from `clean/` in exactly one dimension; otherwise a single shared defect would
drive every check non-zero for the same reason and the flip would demonstrate nothing about the
check's own subject. The generator refuses if a break's anchor text is missing, so a break that
silently applied to nothing fails loudly instead of reading as "did not flip".

```sh
uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_flip_test.py
```

## Plan hash

`clean/`'s plan hash, which every command below needs — or just compute it:
`sha256sum clean/.planning/writing-fixture-plan.md`.

```
clean   4d62f89c677d8622691503d5a7568f09ba56c6ba07a82efbe8a8597bc471fd81
```

The generated break variants each re-derive their own hash at run time, so no hash here goes stale
when a fixture changes — `writing_flip_test.py` reads it off the copy it just made.

## The command lines

`<P>` is the fixture project root, `clean`. The draft argument is the `Draft` cell of that section's
`## Section Outputs` row, verbatim, which for these fixtures is `drafts/<S> (Draft).md`; quote it,
because it contains spaces.

```bash
# GRAMMAR
uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_section_index.py <P>

# CITE + CLAIM — one invocation per section; <S> is one of
# "Introduction", "Part I. The Gap", "Part II. The Repair", "Conclusion"
uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_gate_probe.py "<P>/drafts/<S> (Draft).md" --bib <P>/references/sources.bib --plan <P>/.planning/writing-fixture-plan.md --plan-hash <H>

# PROSE-HARD — <D> is the plan's `Domain:`, which is `legal` for every fixture here.
# The wrapper runs prose-audit.py itself under `uv run --with lxml --with pyyaml`,
# so this command line does not carry those flags.
uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_prose_gate.py --project <P> --style <D>
```

## The flip evidence

`writing_flip_test.py` is the evidence, and it re-derives it on every run rather than asserting a
table that nothing re-checks. Each check is run twice — against a fresh copy of `clean/`, and against
a copy carrying exactly one defect — and three things are asserted: exit 0 on clean, non-zero on the break, and that the failure names the check's OWN subject. The third matters — GRAMMAR once passed both exit-code assertions while the plan edit invalidated the receipt hash, so the parser aborted before parsing grammar and the row silently duplicated RECEIPT:

```
$ uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_flip_test.py
  ok  GRAMMAR: exits 0 on a clean project
  ok  GRAMMAR: exits non-zero on a project broken in exactly this way
  ok  GRAMMAR: the failure names its own subject ('sections in order')
  ...  (same three for RECEIPT, CITE, CLAIM, PROSE)

15 passed, 0 failed
```

The suite was itself checked for discrimination: neutering one break to a no-op produces
`FAIL  PROSE: … exit 0 — the check did not detect its own subject`, so a check that stopped flipping
would be caught rather than reported clean.

A note on collateral, which the old stored-fixture matrix recorded and is worth keeping: the gate
probe re-authenticates the plan and the receipt before it looks at a draft, so a broken grammar or a
`PENDING` receipt legitimately blocks every section too. That is why each variant breaks exactly one
dimension — the flip must be attributable to the check's own subject, not to shared collateral.
