# Workshop Deck Checks

Canonical definitions for deck verification. The probe at
`${CLAUDE_PLUGIN_ROOT}/skills/workshop/scripts/workshop-deck.py` OWNS the computed rows; the
`deck-fidelity`, `deck-convention` and `visual-integrity` lenses OWN the three it cannot settle. Both
load these definitions by the path
`${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/workshop-checks.md`. The plan grammar the probe
parses, the deck's inventory emission, the title-matching key and the handout build are specified
once, in
`${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/slide-spec-grammar.md`.

**Iron Law: read this file before evaluating a deck claim. Inlined copies drift.**

## Computed vs model-evaluated

The **Runner** column is the load-bearing distinction, not a convenience. The probe COMPUTES the
mechanical checks over the artifacts declared in the approved plan's `## Outputs and Verification`
table and emits a machine-generated reason for every `N/A`. `FID`, `CONV` and `VIS` are judgements a
model makes; the probe emits a `MODEL-EVALUATED` line for each and **never** `PASS`, so no reader can
mistake a judgement for a computation. `ENUM` asserts both that a line exists for every ID *and* that
the three model IDs carry `MODEL-EVALUATED` status — a later edit cannot route a model ID through a
`PASS` result unnoticed.

**Every computed check FAILS CLOSED.** A missing tool, a missing file, an unreadable PDF, a malformed
Slide Spec, an unparseable `## Source Inventory` or `## Outputs and Verification`, or a driver exit
code the probe does not recognise is a FAIL — never a clean line, never a skip. The defect this probe
exists to remove is upstream's `typst-widow-detection.py`, which reports *no violations* when its
detector is absent and therefore passes vacuously. **A check that cannot fail is not a check.**

**`N/A` is not a third kind of pass.** An `N/A` line carries a machine-generated reason and is still
owed a disposition by the verifier against task-local evidence, exactly like a `MODEL-EVALUATED` row.
It is not permission to stop looking. No computed check in this matrix is `always N/A`: each of
`CMP CON SPEC NOTE INV WID OVR ENUM` has a fixture that makes it FAIL.

**A `MODEL-EVALUATED` line is never `PASS`.** Reporting `FID`, `CONV` or `VIS` as PASS — in the
probe, in a task report, or in a verifier summary — is a defect of the same class as a vacuous
computed pass.

## Check matrix

| Check ID | Description | Runner |
|---|---|---|
| CMP | `slides.typ` and `notes.typ` compile clean | computed |
| CON | Vendored Typst constraints report no failure, no error, no skip, over a non-zero inspected-file count | computed |
| SPEC | Slide Spec rows and built slides correspond one-to-one by normalized title | computed |
| NOTE | Every built slide has a `notes.typ` section under the same normalized title key | computed |
| INV | Each built slide's emitted ID set equals that slide's Slide Spec `Inventory` cell | computed |
| WID | Zero widow lines in the handout build of the deck PDF | computed |
| OVR | Zero frame-overflowing slides | computed |
| ENUM | A line was emitted for every ID, and FID/CONV/VIS carry MODEL-EVALUATED status | computed |
| FID | Claim fidelity: every factual claim traces to a Source Inventory item and to the paper | MODEL-EVALUATED |
| CONV | Convention: the deck follows the Typst/Touying conventions and the plan's proportions | MODEL-EVALUATED |
| VIS | Visual integrity: diagrams and figures are legible and say what the slide claims | MODEL-EVALUATED |

**R11 — every computed check asserts non-vacuity.** A check that can report clean without having
measured anything is the defect class this port exists to remove. The rule covers **every** computed
ID, `CMP` and `ENUM` included; an enumeration that exempted one would leave exactly the hole it
exists to close. Each computed section below states its own non-vacuity rule.

## Computed checks

### CMP: Both documents compile — computed

**Means:** `slides.typ` and `notes.typ`, at the paths declared under `deck` and `notes` in
`## Outputs and Verification`, each compile with `typst compile` with no diagnostic on stderr and
exit status 0, and each produces its declared output file.

**Evidence:** the captured stderr and exit status of each `typst compile` invocation, both source
paths, and both produced output paths.

**Non-vacuity (R11).** `CMP` FAILs — never skips, never passes — when:

- the `typst` binary is absent. A `FileNotFoundError` raised by the subprocess call is a **FAIL**,
  not a skip. This is precisely upstream's failure mode.
- a source the plan declares under `## Outputs and Verification` does not exist on disk;
- either compile produced **no output file**. Compiling zero files is a FAIL, not a clean run;
- either compile exits non-zero, or writes to stderr;
- the probe would open an artifact that no `## Outputs and Verification` row declares.

### CON: Vendored constraints, over files actually inspected — computed

**Means:** `references/constraints/run-constraints.py`, invoked against the **resolved presentation
directory** (not the project root), reports for every co-located `typst-*.py` module an empty
`failed[]`, an empty `errors[]`, an empty `skipped[]`, and a summed `inspected` count greater than
zero.

**Evidence:** the runner's JSON — per-module `passed`/`failed`/`errors`/`skipped` membership, each
module's `inspected` file count, and the summed inspected count.

The probe reads the runner's **JSON**, and must not treat the runner's exit 1 as a crash: a violation
exit and an infrastructure failure are distinguished by the JSON, not by the status.

**Non-vacuity (R11).** `CON` FAILs when:

- the summed `inspected` count is **zero**;
- `errors[]` is non-empty. A module that raised is not "infra, therefore fine": it checked nothing,
  so it cannot certify anything;
- `skipped[]` is non-empty;
- any module reports a failure.

Every vendored module locates its own inputs by globbing `cwd` and `cwd/presentation` and returns
`[]` when it finds nothing, so a deck the runner never found reports clean having opened no file. The
inspected count is what distinguishes "checked and clean" from "checked nothing".

`typst-widow-detection.py` and `typst-overflow.py` are **deliberately not vendored** — both fail
open, and `WID`/`OVR` own those dimensions natively. 15 modules are vendored, not 17.

### SPEC: Slide Spec ↔ built deck, one-to-one, by title — computed

**Means:** every `## Slide Spec` body row has a built slide, and every built slide has a spec row.
The join is on the **normalized title key** defined in `slide-spec-grammar.md`, applied to **both
sides** — the `Slide` cell and the slide's `=== ` title line are each normalized before comparison.
Never ordinal position; never row count; never a verbatim comparison.

**Evidence:** the two directions reported separately and named — spec rows with no built slide, and
built slides with no spec row.

**Non-vacuity (R11).** `SPEC` FAILs when:

- either direction is non-empty;
- the Slide Spec is **malformed** by any clause of the exhaustive list in `slide-spec-grammar.md`
  (absent heading, no pipe table, wrong header names, wrong header order, a body row without exactly
  seven cells, an empty cell, zero body rows);
- `## Source Paper` is **unparseable** by any clause of its list in `slide-spec-grammar.md` — absent
  heading, no pipe table, header row not exactly `Field | Value`, a row without exactly two cells, an
  empty cell, a missing mandatory `path` or `title` row, or a `path` that does not resolve on disk.
  `FID` is judged by a lens that reads the paper at that path; an unresolvable path leaves the lens
  judging the deck against nothing, so the computed side fails closed here rather than letting the
  model side run blind;
- the built deck contains zero `=== ` title lines. Comparing an empty set against an empty set is a
  pass having compared nothing.

A slide count that matches while the titles do not is a FAIL. `SPEC` must never degenerate into a
count comparison; matching cardinality is not correspondence.

### NOTE: Speaker notes, keyed by the same title — computed

**Means:** every built slide has a `== <title>` section in `notes.typ` under the **same normalized
title key** used by `SPEC`.

**Evidence:** the built slide titles, the notes headings, and the list of slides with no matching
notes section.

**Non-vacuity (R11).** `NOTE` FAILs when:

- any built slide has no notes section under its normalized key;
- `notes.typ` is absent or unreadable;
- the built deck has zero titles, or `notes.typ` has zero `== ` headings — an empty comparison is not
  a pass.

The match is on the key, **never on topic similarity** — a topic match is a judgement, and this row
is computed.

### INV: Emitted IDs equal the slide's declared inventory — computed

**Means:** a **per-slide set equality**, not a membership test. For every built slide, the probe
extracts the ID set that slide emits in its `#inv(...)` calls and compares it, as a set, against the
`Inventory` cell of **that slide's own Slide Spec row** — the row matched by the **normalized title
key** of `slide-spec-grammar.md`, the same key `SPEC` and `NOTE` join on. The check FAILs on **any
difference in either direction**: an ID the slide emits that its row does not declare, and an ID its
row declares that the slide does not emit. IDs are compared **whole-token**; both sides are drawn
from the `^[FTRA][0-9]+$` grammar in `slide-spec-grammar.md`.

Membership in `## Source Inventory` alone is **not** the check and never was sufficient. Every slide
could emit the identical boilerplate `#inv("A1")` — one declared ID, repeated deck-wide — and a
membership test reports clean over a deck in which no slide's citations correspond to its content.
The dimension would then measure nothing, which is exactly the grep-on-prose weakness the emission
requirement exists to remove. Set equality against the per-slide cell is what makes a wrong citation
detectable.

`## Source Inventory` remains an operand: every ID on **either** side must also be declared there,
whole-token, so a spec row citing an undeclared ID and a deck emitting one both FAIL. It is the
second half of the check, not the whole of it.

**Evidence:** per built slide — its normalized title key, its emitted ID set, its Slide Spec
`Inventory` set, and the two-way difference, each direction named separately; plus the declared
`## Source Inventory` ID set and any ID from either side missing from it.

**Non-vacuity (R11).** `INV` FAILs when:

- **any built slide carries no `#inv(` call**;
- any built slide's emitted set differs from its spec row's `Inventory` set in either direction;
- a built slide matches no Slide Spec row by the normalized key, or a spec row matches no built
  slide — an unmatched operand has nothing to compare against, so there is no set equality to pass;
- an ID emitted by the deck, or named in an `Inventory` cell, is not declared in
  `## Source Inventory`;
- the built deck emits no IDs at all;
- `## Source Inventory` is absent, empty, or unparseable by any clause in `slide-spec-grammar.md`;
- the built deck contains zero `=== ` title lines.

**A commented-out call is not an emission.** Typst comments (`//` to end of line, `/* … */`) are
stripped **before** matching `#inv(`, per the stripping rule in `slide-spec-grammar.md`, and a slide
whose only `#inv(` call sits inside a comment FAILs as a slide carrying no call. Matching raw source
was verified as a live hole: a slide declaring nothing read clean.

The empty-set cases fail closed because an empty set is contained in anything, and an empty set
equals an empty set — both are a pass having compared nothing.

### WID: Widows in the handout build — computed

**Means:** zero widow lines across the scanned pages of the **handout** build of the deck PDF. A
**widow** is a page's final line consisting of exactly one token of **12 characters or fewer**, after
splitting `page.extract_text()` on `\n` and dropping trailing whitespace-only entries.

The threshold is fixed here, not left to the implementer: an unstated "short" gives two honest
implementers two different checks, and the laxest one never fires.

**Build:** through the wrapper-plus-`--input handout=true` path the overflow driver uses
(`scripts/checks/check-overflow.sh`), per `slide-spec-grammar.md`. The overlay-expanded build
measures a different property.

**Skip set and floor:** as specified in `slide-spec-grammar.md` — only the first page and
section-divider pages are skippable, and the pages **actually scanned** must be at least the Slide
Spec body-row count.

**Evidence:** the handout page count, the body-row count it was compared against, the number of pages
actually scanned, the pages skipped with their reason, and each offending page with its final line.

**Non-vacuity (R11).** `WID` FAILs when:

- `typst` is missing;
- `pypdf` is unimportable;
- the PDF cannot be opened or read;
- **any scanned page yields no extractable text.** Outlined fonts and image-only slides produce zero
  text, hence zero widows — clean because nothing was measured. A no-text page is a FAIL, not a skip;
- the handout page count is **zero, or fewer than** the Slide Spec body-row count (R10). A **greater**
  count is expected and is not a failure: the title slide and section dividers own no spec row;
- the number of pages **actually scanned** is zero, or fewer than the body-row count.

### OVR: Frame overflow — computed

**Means:** zero slides overflow their frame, as determined by the vendored driver
`scripts/checks/check-overflow.sh` and its `overflow.py`/`shared.py`/`validation.typ` parts.

**Evidence:** the driver's exit code, its captured output, and the physical page count it reports.

**Reads the exit code strictly:** `0` = no overflow; `1` = overflow → FAIL; **anything else — `2`, a
timeout, a missing `typst`, a missing vendored `validation.typ` — is FAIL CLOSED**, never clean.

**Non-vacuity (R11).** Exit 0 alone is insufficient. `OVR` FAILs when:

- the driver's reported **physical page count is zero or absent**;
- the driver's `No validation metadata found` warning appears in its output.

`check-overflow.sh:70-73` and `overflow.py:44-45`/`:87-88` both emit that warning having measured
nothing; verified directly, `echo '[]' | python3 overflow.py` prints `Physical pages: 0` and exits 0.

Upstream's `typst-overflow.py` has four clean-return paths: no slides found, `typst` not installed,
and a closing `return []` that treats every exit code other than `1` as clean — including the `2` its
own driver exits on a missing dependency. It reports green precisely when it could not run. That
module is not vendored; the probe owns `OVR` natively, exactly as it owns `WID`.

### ENUM: Every check emitted a line, with the right status — computed

**Means:** the probe emitted exactly one line for every ID in this matrix, **and** each of `FID`,
`CONV` and `VIS` carries `MODEL-EVALUATED` status.

**Evidence:** the emitted line set compared against the matrix, plus the status of the three model
IDs.

**Non-vacuity (R11).** `ENUM` FAILs when:

- any matrix ID produced no line;
- a model ID was routed through `PASS`, or through any status other than `MODEL-EVALUATED`;
- the emitted line set is empty, or the matrix it compares against is empty — an enumeration over
  nothing enumerates nothing.

Silence is indistinguishable from a pass: a check simply absent from the output looks exactly like
one that ran clean. The status clause is one step beyond membership, and it is what stops a later
edit from quietly turning a judgement into a computation.

## Model-evaluated checks

These three are **never reported as PASS**, and an `N/A` is not a substitute. The probe emits a
`MODEL-EVALUATED` line naming the evidence a lens must read; the lens returns findings with a
severity, not a verdict.

### FID: Claim fidelity — MODEL-EVALUATED

**Means:** every factual claim on every slide (empirical numbers, coefficients, percentages, sample
sizes, holdings, author conclusions) traces to an item in `## Source Inventory` and is faithful to
the source paper. `INV` computes only that *emitted tokens are declared*; whether the claim beside
the token is what the source says is a judgement.

**Evidence a lens reads:** the built `slides.typ` and `notes.typ`, the approved plan's
`## Source Inventory` and `## Source Paper`, and the source paper itself. An ungrounded or
misattributed claim is reported with the claim text quoted and a `file:line`; a deck asserting a
result the paper does not contain is critical.

### CONV: Convention — MODEL-EVALUATED

**Means:** the deck follows the Typst/Touying conventions the vendored constraints cannot express and
the plan's declared proportions — the `## Audience, Venue, Duration, and Proportions` split across
sections, takeaway-as-title phrasing, bullet density, notes voice. `CON` computes the mechanically
expressible subset; the rest is judgement: a takeaway that is not a claim, a bullet restating its
title, notes duplicating the slide instead of expanding it.

**Evidence a lens reads:** the built deck and notes, the vendored `typst-*.md` constraint docs under
`references/constraints/`, and the plan's Proportions and Slide Spec.

### VIS: Visual integrity — MODEL-EVALUATED

**Means:** each slide's diagram or figure is legible at venue scale and says what the slide's
takeaway claims — no clipped or overlapping label, no arrow routed through a node, no illegible
sizing, no figure contradicting its caption.

**Evidence a lens reads:** the Typst diagram **source** in `slides.typ` (cetz/fletcher blocks, figure
references) and the `Visual` cell of the corresponding Slide Spec row. Judging from source rather
than from a render is a declared reduction: `look_at.py` is not vendored.

## How to use in subagent prompts

Reference checks by ID and by this file's path:

```
"Evaluate FID and VIS from ${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/workshop-checks.md
against the built deck. Report findings with severity; do not report a PASS."
```

One source of truth means every reader runs identical checks.
