# Workshop Plan Grammar

The grammar the approved plan and the built deck must satisfy for
`${CLAUDE_PLUGIN_ROOT}/skills/workshop/scripts/workshop-deck.py` to gate a run. Check semantics
live in `${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/workshop-checks.md`; this file
specifies only the syntax the probe parses and the emission the generated slides must carry.

**Iron Law: the probe parses this grammar and nothing else. A heading spelled differently is an absent
heading, and an absent required heading is a FAIL — never a skipped check.**

## Required H2 headings

The approved plan contains these seven H2 headings, spelled exactly as written:

1. `## Presentation Intent` — what the talk is for and what the audience should leave with.
2. `## Audience, Venue, Duration, and Proportions` — who, where, how long, and the time/slide split
   across sections.
3. `## Source Paper` — the two-column path/title table.
4. `## Source Inventory` — the F/T/R/A inventory table.
5. `## Slide Spec` — the seven-column table.
6. `## Outputs and Verification` — the artifact declarations.
7. `## Review Surfaces` — what a human reviews: the rendered deck and notes.

The probe **parses** four of them — `## Source Paper`, `## Source Inventory`, `## Slide Spec` and
`## Outputs and Verification` — and each is FAIL CLOSED when absent, empty or unparseable. The other
three are required by the plan grammar and read by the lenses; a plan missing one is not ready for
implementation.

A **pipe table follows the heading** means: the first non-blank line after the heading, before any
other H2, is a pipe row; a delimiter row (`|---|...`) follows it; body rows follow until the first
blank line or the next heading.

## R5 — Inventory emission in the built deck

Every generated slide emits its Source Inventory IDs **in the deck itself**, immediately after its
`=== ` title line:

```typst
=== Bidders overpay when the target is opaque
#inv("F1", "T2")
```

`inv` is a no-op declared in the vendored `templates/theme.typ` as `#let inv(..ids) = none`, so it
renders nothing. The arguments are the IDs from that slide's `Inventory` cell, as quoted string
literals, one argument per ID.

This emission exists because the citation set cannot be recovered from prose. Upstream records the
same conclusion: a token grep over slide body text is a known limitation
(`workshop-verify.js:534`), and upstream falls back to an agent join (`:281`). Making the token a
**generation requirement** turns a judgement into something computable. A slide carrying no `#inv(`
call is a FAIL, not an untraced slide.

### The emitted set must equal the slide's own `Inventory` cell

`INV` compares each built slide's emitted ID set against the `Inventory` cell of **that slide's Slide
Spec row**, matched by the normalized title key below, and FAILs on **any difference in either
direction**. Generation must therefore emit that row's IDs exactly — no extra, none omitted.

**Membership is not enough.** Checking only that the emitted IDs appear somewhere in
`## Source Inventory` lets every slide emit the same boilerplate `#inv("A1")` and report clean; the
dimension then measures nothing, which is the grep-on-prose weakness this emission exists to remove.
Deck-wide membership in `## Source Inventory` is still required of every ID on either side — it is
the second half of the check, not the whole of it.

### Comments are stripped before matching

`//`-to-end-of-line and `/* … */` comments are stripped from the deck source **unconditionally**
before `#inv(` is matched, and the stripper does **not** track string literals.

Typst *markup* treats `"` as ordinary text, so a valid deck may carry an odd number of quotes — an
inch mark, an opened quotation. A stripper that enters `in_string` mode on one unpaired `"` leaves
every subsequent comment intact, and a commented `#inv(` then reads as a real emission; this was
verified as a live vacuous pass. The cost of stripping unconditionally is a conservative over-strip
when a quoted string legitimately contains `//` (a URL), which can only *remove* a real call and
produce a **false FAIL** — never a false clean. Failing closed on an ambiguous parse is the whole
point; failing open to protect a URL inverts it.

## R6 — Titles and the matching key

A slide's **title** is the text following `=== ` on its title line. `notes.typ` carries one
`== <title>` heading per slide.

The **matching key** used by `SPEC` and `NOTE` is that text **normalized**:

1. strip leading and trailing whitespace;
2. collapse every internal run of whitespace to a single space;
3. compare **case-sensitively**.

Normalization applies to **both sides** of every comparison — the `Slide` cell, the `=== ` title and
the `== ` notes heading are each normalized before matching. There is **no verbatim comparison
anywhere, and no ordinal-position matching anywhere**. Position matching passes a deck whose slides
are in the wrong order relative to the spec; a verbatim comparison fails a deck over a double space.

## R7 — `## Slide Spec`, the seven-column table

A pipe table follows the heading. Its header row is exactly these seven columns, in this order:

```
| Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes |
|---|---|---|---|---|---|---|
```

| Column | Meaning | Gated by |
|---|---|---|
| `Slide` | The slide's title, as it will appear on the built slide's `=== ` line | `SPEC`, `NOTE` — normalized-title join |
| `Section` | The section this slide belongs to; the distinct values are the implementation task rows, and are also the section-divider strings `WID` skips | structural; also feeds `WID`'s skip set |
| `Takeaway` | The one sentence the slide argues | structural; content judged by `FID`/`CONV` |
| `Bullets` | The body points, as a single cell | structural; content judged by `FID`/`CONV` |
| `Inventory` | The F/T/R/A IDs this slide draws on — at least one per row | `INV` — set-equality against the slide's own emitted `#inv(...)` IDs, both directions |
| `Visual` | The figure or diagram, or the literal `none` for a text-only slide | structural; judged by `VIS` |
| `Notes` | What the speaker notes for this slide must cover | structural; judged by `CONV` |

**Every cell is required and non-empty.** A slide with no visual writes `none`; it does not leave the
cell blank.

`Slide` feeds `SPEC`/`NOTE` and `Inventory` feeds `INV` — the latter as a set compared against the
built slide's own emission, so this cell's content is gated, not merely its presence. The other four
columns are gated **structurally** — present, non-empty, in position — because their content is a
judgement, and a computed check must not pretend to settle one.

### Malformed — each clause is a `SPEC` FAIL

The Slide Spec is malformed when any of these holds:

1. the `## Slide Spec` heading is absent;
2. no pipe table follows the heading;
3. the header row is not exactly `Slide | Section | Takeaway | Bullets | Inventory | Visual | Notes`;
4. the header row's columns are not in that order;
5. any body row has other than seven cells;
6. any cell is empty;
7. there are zero body rows.

Left undefined, "malformed" is unfailable: an implementer reading it as "no pipe table under the
heading" accepts a two-column table, and every downstream check still runs against it.

The **body-row count is the floor** for both the handout page count and the pages `WID` actually
scans. It is never an equality — see *R10* below.

## R7c — `## Source Paper`, the two-column field table

`deck-fidelity` reads the paper at the path this section names. The paper is deliberately **not** a
lens `ref` — `refs` is a static list of absolute paths in a template, and the paper differs per run —
so this table is how the lens locates it, and it is load-bearing enough to need a grammar like any
other operand. A lens told to read a paper the plan never located reads nothing and judges `FID` on
the deck alone.

A pipe table follows the heading. Its header row is exactly these two columns, in this order:

```
| Field | Value |
|---|---|
```

Two rows are **mandatory**:

- **`path`** — the source paper, **project-root-relative**, and the file **must exist on disk**.
- **`title`** — the paper's title, non-empty.

Further rows (authors, venue, year) are permitted and unconstrained; the probe reads only `path` and
`title`.

```
| Field | Value |
|---|---|
| path | paper/opacity-bidding.pdf |
| title | Bidder Overpayment under Target Opacity |
```

### Unparseable — each clause is FAIL CLOSED on `SPEC`

The Source Paper section is unparseable when any of these holds:

1. the `## Source Paper` heading is absent;
2. no pipe table follows the heading;
3. the header row is not exactly `Field | Value`;
4. a row has other than two cells;
5. any cell is empty;
6. a mandatory row (`path` or `title`) is missing;
7. the `path` value does not resolve — no file exists at that path under the project root.

Clause 7 is the one that matters most: an unresolvable path is exactly the shape that lets `FID` be
judged against nothing while every line still reads clean.

## R7b — `## Source Inventory`, the three-column table

`INV` compares the deck's emitted IDs against this section, so it has a grammar: without one, `INV`
can report clean on a substring match or an unparsed blob.

A pipe table follows the heading. Its header row is exactly these three columns, in this order:

```
| ID | Kind | Source |
|---|---|---|
```

- **`ID`** matches `^[FTRA][0-9]+$` — one of `F`, `T`, `R`, `A` immediately followed by one or more
  digits (`F1`, `T12`, `R4`, `A10`) — and is **unique** within the table.
- **`Kind`** is one of `figure | table | result | argument`, and **agrees with the ID's letter**:
  `F`→`figure`, `T`→`table`, `R`→`result`, `A`→`argument`.
- **`Source`** is free text naming where in the paper the item comes from (page, figure number,
  quoted statistic), and is **non-empty**.

IDs are stable for the plan's lifetime: renumbering an inventory invalidates every citation in a
built deck.

**Every Slide Spec row declares at least one inventory ID** in its `Inventory` cell. A slide grounded
in nothing is a slide whose claims cannot be traced.

### Unparseable — each clause is FAIL CLOSED

The Source Inventory is unparseable when any of these holds:

1. the `## Source Inventory` heading is absent;
2. no pipe table follows the heading;
3. the header row is not exactly `ID | Kind | Source`;
4. a row has other than three cells;
5. any cell is empty;
6. an `ID` fails `^[FTRA][0-9]+$`;
7. an `ID` is a duplicate of an earlier one;
8. a `Kind` disagrees with its ID's letter;
9. there are zero rows.

### Whole-token matching

`INV` matches IDs **whole-token, never by substring** — on both of its comparisons: the emitted set
against the slide's `Inventory` cell, and either side against this declared set. `F1` must not
satisfy a citation of `F10`, and `F10` must not be admitted by a declared `F1`. Compare the extracted
argument string to the declared `ID` string for equality; do not use containment, `startswith`, or an
unanchored regex.

## R8 — `## Outputs and Verification`, the artifact declarations

A pipe table follows the heading. Its header row is exactly these two columns, in this order:

```
| Artifact | Path |
|---|---|
```

- **`Artifact`** is drawn from the fixed set `deck | notes | deck-pdf | notes-pdf`, and **all four
  rows are mandatory**. The probe compiles both sources and reads the deck PDF, so each is an
  artifact it opens; a runner given prose cannot open a file.
- **`Path`** is project-root-relative and non-empty.

Conventionally: `presentation/slides.typ`, `presentation/notes.typ` and their rendered PDFs. The
directory these paths resolve under is the **presentation directory** the constraint runner is
invoked with — `CON` runs against that directory, not the project root, or every module globs an
empty tree and reports clean having opened no file.

### Unparseable — each clause is FAIL CLOSED

The Outputs and Verification section is unparseable when any of these holds:

1. the `## Outputs and Verification` heading is absent;
2. no pipe table follows the heading;
3. the header row is not exactly `Artifact | Path`;
4. a row has other than two cells;
5. any cell is empty;
6. an `Artifact` value is outside `deck | notes | deck-pdf | notes-pdf`;
7. an `Artifact` value is a duplicate;
8. there are fewer than the four required rows.

**Opening an artifact no row declares is likewise a FAIL.** The fixed grammar is what gives this
section the force `## Data Outputs` has in `ds-dq.py:96-123`.

## The handout build

Handout mode is not a default. It is an explicit input on a wrapper: `check-overflow.sh:60` runs
`typst compile "$WRAPPER" --input handout=true`, and the theme reads `sys.inputs`. A bare
`typst compile slides.typ` yields the **overlay-expanded** build, in which each `#pause` step is its
own page and most pages end mid-build.

`WID` measures the **handout** build, through that same wrapper path. Measuring the overlay-expanded
build measures a different property: the final line of an incomplete overlay is not a widow.

## R10 — the page count is an inequality, and skipping has a floor

`theme.typ:115` (`title-slide`) and `:165` (`new-section-slide`) emit pages owning no Slide Spec row,
and `overflow.py:33-36` documents the same for this corpus. A conforming deck therefore has
**strictly more pages than Slide Spec body rows**.

- `WID` **FAILs closed** when the handout page count is **zero, or fewer than** the body-row count.
- A **greater** count is expected and is **not** a failure.

An equality test would be permanently red, which is how a check gets waived.

### The skip set

A page is skipped by the widow scan **only** when:

1. it is the **first page** (the title slide); or
2. its extracted text is a **section divider**: a single non-empty line that equals, after the
   normalization above, one of the distinct `Section` cell values in the Slide Spec.

**Nothing else is skippable.** A page with no extractable text is not a skip — it is a `WID` FAIL
(see `workshop-checks.md`).

### The scanned floor

Skipping is bounded. `WID` **FAILs closed** when the number of pages **actually scanned** — pages
opened, text extracted, and widow-tested, excluding every skipped page — is **zero, or fewer than the
Slide Spec body-row count**.

Without that floor, a skip-everything bug scans nothing and reports clean: the vacuous-pass defect
class this port exists to remove, reappearing inside the check's own exemption path.
