# Handoff — Westlaw skill becomes owner of the DOCX format and golden-copy discipline

Date: 2026-09-09

## Files changed

### `skills/westlaw/SKILL.md` (was 167 lines, now 209)

1. **Step 6 measurement table.** Replaced the single-case sentence with a three-row table (docx
   bytes, paragraphs, chars, markers) for Life Partners, Ripple and Mutual Benefits, plus the note
   that all three are flat OPC / 13 parts.
   - **Corrected an existing error:** the file claimed 90,834 chars for Life Partners. Measured
     value is **90,972**. The old number is not reproducible by the shipped script.
2. **New section "Naming and layout of a retrieved case".** The two-file per-case convention in the
   consumer's `docs/` — `<Case-slug>.westlaw.docx` as never-edited golden copy, `<Case-slug>.westlaw.txt`
   as derived output — slug shape `SEC-v-Ripple-682-FSupp3d-308-SDNY-2023`, and the one-sentence
   consequence: the reproduction check is re-running the extractor and diffing, so a Westlaw source
   needs no corrections ledger.
3. **New section "Star pagination".** Markers inline mid-sentence; two interleaved series for a
   case in two reporters; the stripping regex; both consumer uses (strip to match quotes, keep to
   print star pages).
4. **New section "Coverage".** Westlaw is the best available source, not ground truth — one
   publisher's keying of the reporter page, not the page. Does not remove the need to eyeball
   retained passages against a page image.
5. **Related:** added one line pointing at the `lexis` stub.

No changelog or narrated history added. No existing section rewritten except the corrected figure.

### `skills/lexis/SKILL.md` (new, 30 lines)

Deliberate stub. Frontmatter description triggers on Lexis/Lexis+/Nexis/Protégé retrieval requests
and states "NOT IMPLEMENTED" in the description itself so routing is decided before the body loads.
Body: use `workflows:westlaw`; two facts recorded and explicitly flagged UNVERIFIED (comparable
Word/RTF delivery formats; the Protégé MCP connector possibly obviating browser driving); a closing
instruction not to write a procedure by analogy. No selectors, no URLs, no steps.

## Verbatim extractor output

Run read-only against the three existing exports; output written to `/tmp`, nothing written into
`/home/eh/areas/secreg/docs/`.

```
$ for f in /home/eh/areas/secreg/docs/*.westlaw.docx; do echo "=== $(basename "$f")"; \
    python3 skills/westlaw/scripts/westlaw-docx-text.py "$f" -o /tmp/wl-check.txt; done

=== SEC-v-Life-Partners-87-F3d-536-DC-Cir-1996.westlaw.docx
layout: flat OPC (zip root) (13 parts)
paragraphs: 138
characters: 90972
star-page markers: 42
first markers: *537 *303 *538 *304 *539 *305 *540 *306
=== SEC-v-Mutual-Benefits-408-F3d-737-11th-Cir-2005.westlaw.docx
layout: flat OPC (zip root) (13 parts)
paragraphs: 78
characters: 27130
star-page markers: 8
first markers: *738 *739 *740 *741 *742 *743 *744 *745
=== SEC-v-Ripple-682-FSupp3d-308-SDNY-2023.westlaw.docx
layout: flat OPC (zip root) (13 parts)
paragraphs: 202
characters: 76239
star-page markers: 22
first markers: *314 *316 *317 *318 *319 *320 *321 *322
```

All nine figures match the brief exactly, including the 13-part flat OPC layout on all three.

### Correction to the brief's star-marker description

The brief described Life Partners' two series as "F.3d `*537` and U.S.App.D.C. `*303`", both single
asterisk. Measured, the parallel series carries a **double** asterisk:

```
$ python3 .../westlaw-docx-text.py <life-partners> | grep -o '.\{60\}\*5[34][0-9].\{60\}' | head -3
 the direction of its former president and current chairman *538 **304 Brian Pardo, arranges these transactions and performs
o] AIDS patients in their final illness” and that after “an *539 **305 apparently exhaustive two-year investigation” the SEC
nies for their administrative convenience; the investor was *540 **306 at all times the legal owner. Also, once an investor
```

```
$ # per case: single-asterisk-only vs double-asterisk marker counts
Life Partners    single-star only: 21   double-star: 21
Mutual Benefits  single-star only:  8   double-star:  0
Ripple           single-star only: 22   double-star:  0
```

Two consequences, both now in SKILL.md:

- The script's `STAR_RE = \*\d+` matches *inside* `**304`, which is why Life Partners reports 42
  markers rather than 21 + 21. The count is a conflation of the two series, not 42 distinct pages.
- A consumer stripping markers must use `\*\*?\d+`. A `\*\d+` strip leaves a stray leading asterisk
  on every parallel-series marker and would break verbatim matching in exactly the cases where two
  reporters exist. `first markers: *537 *303 ...` in the output above is the same artifact — the
  `*303` shown is the tail of `**303`.

I did **not** change `scripts/westlaw-docx-text.py`. The brief scoped this task to SKILL.md and the
Lexis stub, and changing the regex would change the reported marker count that the consumer
addendum was verified against. Flagging it as a known behavior instead, documented in the skill.

## Not written, because unverifiable

- **Any Lexis procedure, selector, endpoint or delivery-dialog detail.** Nobody has driven the UI.
  The two facts recorded in the stub are flagged UNVERIFIED and nothing else was added.
- **Whether Protégé's MCP connector returns verbatim case text.** Unknown; stated as unknown rather
  than assumed either way.
- **A claim that the byte-for-byte golden copy is bit-identical to what Westlaw sent.** The three
  files on disk were not compared against a fresh export; the convention is stated as the rule the
  files follow, not as a verified property of these particular bytes.
- **Any per-case reproduction claim for the addendum excerpts.** The brief reports Ripple and Mutual
  Benefits verifying verbatim (69 and 0 prior misses); I did not re-run that comparison, and
  `/home/eh/projects/teaching` and `/home/eh/areas/secreg` were left alone as instructed. Those
  numbers appear nowhere in SKILL.md.

## Not done

- No version bump, no commit, no tag. Changes are in the working tree.
- `skills/westlaw/` was already untracked before this session; `skills/lexis/` is likewise
  untracked. Neither has been staged.
- No mechanical check run: this repo's `references/constraints/check-all.py` governs Typst course
  material, not SKILL.md files, and there is no linter for skill prose. The only executable
  verification available was the extractor run, pasted above in full.
