# Editing marks and the editors' note

## One elision mark per addendum

**Pick one elision mark and use it everywhere in the addendum.**

02-addendum mixes `[. . .]` in the Ripple section with `[...]` in the Life Partners section.
A student reading straight through sees two conventions and cannot tell whether they mean
different things.

When adding a reading, match whatever mark the addendum already uses. If the addendum is
already inconsistent, fix it rather than adding a third.

## Bracket conventions

- `[ ]` marks **editorial insertion or alteration** — nothing else.
- Retained quotations are reproduced exactly, including the court's own internal
  punctuation.
- A case change is bracketed at the changed letter: `[T]he`.
- A clarifying insertion is bracketed whole: `[, for example,]`, `[the issuer]`.

`check-quotes.py` tries each bracketed `[ ]` span both ways — dropped (an insertion) and
kept without its brackets (a case change) — and a match either way counts as found. That
tolerance exists so correct bracketing does not read as a miss; it is not a licence to
bracket loosely.

## Never alter subject, tense, or sentence boundary

**A quotation's subject, tense or sentence boundary is never altered to make it read
standalone.**

If the sentence does not stand on its own, do one of two things: start the excerpt earlier,
or bracket the substitution — `[That representation] rings hollow`.

A baseline run rewrote

> The representation and warranty that the Initial Purchasers purchased without a view
> towards resale rings hollow ... . From Telegram's perspective

into

> That representation rings hollow ... : from Telegram's perspective

— new subject, `.` changed to `:`, a comma added, nothing marked. That is the first Iron
Law at smaller scale: a student quoting it in a brief is quoting something no court wrote.

An INTERNAL elision inside a retained sentence is checked for integrity by
`check-quotes.py`: every fragment of 25+ characters must be real source text, in increasing
non-overlapping source order. That is the stitched-half-sentence signature, and it is a
FAIL.

## The editors' note — THE EXCEPTION, NOT THE RULE

**The default is NO editors' note.** A reading gets one only when the student needs
BACKGROUND in order to read the case. The note is not disclosure boilerplate.

Reversed by the instructor on 2026-09-10: *"we generally do not need editors note except
for if we need to provide some additional background like if there was a prior case or
something, or like with boeings safety issues in the news etc."* The rule this replaced —
recorded here rather than deleted, so the reversal is legible — read *"Every reading
carries an editors' note,"* which produced a per-reading paragraph of mechanical
boilerplate repeated verbatim down the document.

### When a reading DOES get a note

Background the student cannot read the case without:

- **Prior history of this same litigation** — an earlier opinion, a remand, a reversal
  the excerpt assumes the reader knows about.
- **An earlier related decision** the court is reacting to, where the tension is the point
  and the excerpt alone does not supply it.
- **Real-world context** — the instructor's example: Boeing's safety issues as they were
  in the news.

Where a note exists, it carries that background. It does not restate the elision
convention or the footnote treatment; those are stated once in the preamble (below) and
repeating them per reading is the boilerplate this rule removes.

### Where the mechanical conventions now live: the PREAMBLE, once

A student who meets `[. . .]` or a footnote renumbered to 1 with nothing explaining either
has been left to guess. So the conventions are stated ONCE in the addendum's preamble —
the page that already carries the header block and the summary table — covering every
reading in the document:

- that omissions of text are marked with the addendum's one elision mark;
- that the original opinions' footnotes are omitted except as indicated, and any retained
  footnote is renumbered;
- that record citations to the parties' papers are omitted without notation.

### A per-reading disclosure that is specific to ONE reading

The Must-be-disclosed list below still governs WHAT has to be surfaced. When such an item
is specific to a single reading — *Ripple retains footnote 16, renumbered as 1* — the
preamble's document-wide sentence does not cover it, and it needs a home.

**It goes in that reading's own note**, which is then a note the reading has earned: the
per-reading note exists for background, and a reading-specific disclosure travels in it
when there is one. A reading whose ONLY content would be such a disclosure still gets the
note — a dropped dissent has to be disclosed, and there is nowhere else for it to go.

What is NOT a reason for a note: anything the preamble already covers document-wide.

**The note must disclose omissions that could change the reader's understanding.** That is
the standard, and it is narrower than "enumerate everything dropped."

### Must be disclosed

- A dropped **substantive footnote** — one carrying reasoning, a qualification, or a
  holding, as opposed to a bare citation.
- A dropped **qualifier or limiting clause** that confines the holding.
- An **omitted alternative holding**.
- An **omitted dissent** or separate opinion.

### May go silently

- **Record citations** — `(Doc. 3)`, `(PX 5 ¶ 21)`, `(Tr. 412:9–14)`.
- **Party-brief citations**.
- **String cites** of supporting authority.
- **Internal cross-references** — "see supra Part II.B".

Dropping record citations is standard casebook practice and needs no disclosure when they
are not critical to the point. The instructor ruled on this on 2026-09-09, after the older,
stricter formulation — which demanded every silently dropped category be enumerated,
record citations included — produced a **false finding** against the Ripple excerpt.

The test is not "was something removed" but **"could a reader who knew about this removal
read the case differently."** If yes, disclose it. If a record citation is itself the point
being made — the court is reasoning *about* what the record showed — then it is critical to
the point and its removal is disclosable under the general standard.

## Caption block and structure

Each reading in `addenda/NN-addendum.typ` follows the pattern in `addenda/01-addendum.typ`:

- `#pagebreak()`, then the caption block:
  `#align(center)[ #text(13pt, weight: "bold")[CASE NAME IN CAPS] ... court \ citation \ date ]`
- an editors' note in `#emph[[Editors' note: ...]]` **only when that reading needs
  background or carries a reading-specific disclosure** — see the rule above; most
  readings have none
- the judge line in bold, then the text

The caption block must match 01's pattern exactly: `check-addendum.py` counts caption blocks
for the arity check, and a caption that does not match the pattern is **invisible** to that
check. `check.sh` also derives its per-reading quote-check list from these blocks — a
malformed caption is a reading nobody checks.

**A caption title also appears in the summary table on page 1**, so the checker searches
monotonically from page 2. Do not "help" by adding a reading's title anywhere else in the
body.

## The one source-mapping marker

`check.sh` maps each reading to its source in `docs/` by scoring caption tokens against
filename tokens. It considers both `.docx` and `.txt`, and **where a stem carries both, the
`.docx` wins** — offering the scorer two files with the same stem would instead make every
such caption `AMBIGUOUS` and fail a run that had been passing. That heuristic is overridable,
and for one case it MUST be. The marker is a Typst line comment placed **immediately above
the `#align(center)[` caption block it governs**; it attaches to the first caption block that
begins after it.

```typst
// elide-source: SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.westlaw.docx
#align(center)[
  #text(13pt, weight: "bold")[SEC v. MUTUAL BENEFITS CORP.]
  ...
]
```

| marker | argument | effect |
|---|---|---|
| `// elide-source:` | a **basename** resolved against the docs dir, not a path — `.westlaw.docx` for a Westlaw source, `.txt` for a fallback-route source or one an existing plan already names | that reading is quote-checked against exactly that file; the line reports mode `declared`. A `.txt` named by an addendum written before the docx became canonical still resolves and still passes — the marker was never migrated and does not need to be |

A `// elide-source:` naming a file that is not in the docs dir is `DECLARED-MISSING` and
FAILS. It names a file that must exist, so it **cannot exempt anything** — a declaration that
resolves is not a way to skip the check, and the quote check still runs against the named
file. Never point it at a loosely related file to quiet a `NOSOURCE` failure; that verifies a
reading against text that is not its own.

### `// elide-unchecked:` is no longer honoured — writing one is itself a FAIL

An earlier version of this skill let the `.typ` exempt a reading from the verbatim check with
`// elide-unchecked: <reason>`. **That marker is dead. `check.sh` now FAILs any reading
carrying it**, naming the reading and the marker.

The reason is the first Iron Law. The marker was **self-exempting**: the agent writing the
excerpt was also the one deciding that excerpt need not be verbatim against any source. That
is the authenticity rule defeated by the very file it governs — fabricated text could switch
the check off on itself, in one line, and the run would still pass.

### A non-court reading is declared by the INSTRUCTOR, in the plan

Anything with no reporter text — a blog post, a press release, an SEC litigation release, the
instructor's own commentary — has no source to be verbatim against. It is exempted in the
**plan**, never in the `.typ`, under a `## Non-court readings` section with one bullet per
reading:

```markdown
## Non-court readings

- SEC v. Ripple: Everyone Loses — law-firm blog post, no reporter text
- SEC Litigation Release No. 25937 — agency press release, not an opinion
```

`check.sh --plan <path>` reads that list and reports those captions `DECLARED-UNCHECKED` on
their own line, without failing. The authority to say "this is not court text" therefore sits
with the human who wrote the plan, in a file the excerpt-writing agent does not own.

An **undeclared** reading with no resolvable source still FAILS, and that asymmetry is the
whole point: a disclosed exemption prints on its own line every run and can be argued with,
while a silent skip is a check nobody knows did not happen.

Two consequences for the implementer cutting a reading:

- **You may not declare a reading non-court text.** If a reading has no reporter source, stop
  and report it to the instructor, who adds the bullet. Do not add it yourself, and do not
  route around it with `// elide-source:`.
- **Omitting `--plan` from the check command disables this leg**, which then prints `NOT
  CHECKED` and enforces nothing. Pass the plan path on every real run.

`check.sh` prints, for every reading, the file it used and whether the mapping was `derived`
or `declared`. Read that block — it is how the mapping stays auditable instead of guessed.

## Widows and orphans are fixed by LAYOUT, never by the court's words

`check-quotes.py` proves the words match the reporter and proves nothing about how Typst
set them. A verbatim-perfect excerpt can still put a paragraph's last line alone at the top
of a page, so `check.sh`'s `widows` leg (`scripts/check-page-breaks.py`) decides three
page-boundary defects: an **orphan** (a paragraph's first line alone at the foot of a
page), a **widow** (its last line alone at the top of the next), and a **stranded heading**
(a caption or section heading at the foot of a page with its text beginning overleaf).

**The fix vocabulary is layout-only: spacing, or where the page breaks.** Never add, cut or
reword the court's text to close a widow. Rewording to improve a page break is the first
Iron Law defeated for typography — a student would be quoting something no court wrote, and
it would defeat the verbatim gate directly.

**If the two ever conflict, fidelity wins and the widow stands.** A page-break defect that
cannot be fixed by spacing or pagination is reported and left; it is not a licence to touch
the text.

The leg is ON BY DEFAULT, which is its fail-closed form — an absent flag runs the check
rather than skipping it. `--no-widows` is the loud explicit waiver for fixture and dev runs.

## Scope of the cut

The target is ONE thread. Keep only the transaction structure, the analysis of that thread,
and the reasoning that puts the case in tension with what is already assigned. Cut
procedural history, remedies, unrelated dissents, string cites, co-defendant sections,
standard-of-review boilerplate.

An excerpt that keeps a second interesting issue is not more generous to the students — it
is more pages of reading the class hour will not reach, displacing the thread they were
assigned to learn.
