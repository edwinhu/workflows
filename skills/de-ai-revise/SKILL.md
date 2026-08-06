---
name: de-ai-revise
description: "Revise prose to read less AI-generated using corpus-validated scorers. Use when the user asks to 'de-AI this', 'make it sound less like AI', 'remove AI-isms', 'de-tic this draft', 'humanize the prose', 'fix AI writing tells', or 'less AI-sounding'. Also the standard AI-prose pass inside /writing-verify and /writing-revise."
allowed-tools: Read, Edit, Write, Bash, Grep, Glob
---

# de-ai-revise — make prose read less AI-generated

A writing-**improvement** tool. It audits a draft with three corpus-validated
scorers, then rewrites only the flagged spans so the prose reads less like an LLM
wrote it — plainer diction, burstier rhythm, fewer machine tics — while leaving
already-human passages untouched.

This is the GENERATION side of the AI-writing apparatus, not detection. Detecting
polished AI was proven near-impossible (60%+ false-positive rates on real human
writing); this skill never renders a verdict on authorship. It improves readability
for a human reader. The scorers GUIDE which spans to revise; they are not a target
to maximize.

**This is a BACKSTOP, not the main event.** The primary lever for human-reading prose is the
GENERATION contract upstream — writing-draft now drafts topic-sentence-led and *proportional*
(varied paragraph/sentence length), which is what produces human burstiness in the first place. A
draft generated well needs little here. If de-ai-revise is finding a lot, the fix usually belongs
upstream (the outline's POINTs aren't real topic sentences, or the draft padded uniformly), not in
a heavy span-by-span rewrite here. Use this to catch residue, not to manufacture rhythm a flat draft
never had.

<law>
## The Iron Law of Goodhart

**THE SCORERS GUIDE; THEY DO NOT GRADE. NO EDIT THAT IMPROVES A NUMBER BUT NOT THE
READING. This is not negotiable.**

A human reads the output. Mechanically maxing burstiness (chop every sentence),
nuking every em-dash, or swapping every flagged word degrades prose to win a
composite — that is the failure this skill exists to prevent. Revise a span only
when the rewrite reads better to a person. Leave a flagged span alone when the
author's choice is the right one (see Preserve-Human below).
</law>

## The three scorers (all corpus-gated — do NOT re-derive)

`scripts/de_ai_audit.py` folds them into one line-anchored span list. Every signal
was gated against a 14.3M-sentence law+finance corpus, so flags are AI defaults
real scholars don't write — not generic "fancy word" lint.

The scorers themselves now live in `scripts/prose-audit.py`, the plugin's single deterministic
prose audit, and `de_ai_audit.py` is a thin wrapper over its `--profile de-ai` view. The output
shape below is unchanged and will stay that way — this skill needs the REWRITE view (a worklist of
spans with plain replacements), which is a different shape from the audit's severity-ranked,
id-bearing span list. Use `prose-audit.py` directly for anything that is not a de-AI rewrite: it
also carries the wikipedia AI-tell tables, the domain style guides, and the provenance-leak class
this profile is blind to.

| Scorer | Catches | Remedy |
|--------|---------|--------|
| **Scored AI-tics** (`ai-anti-patterns/references/scored-tics-patterns.py`) | phrase/structure tics that passed the ~0-human-rate gate (`sev1-5`) | rewrite the construction; these have no honest use |
| **Tiered diction** (`references/diction.yaml`) | fancy→plain words, tiered by corpus rate | `always_flag` → swap on sight; `cluster` → fix when 2+/para; `density` → vary at saturation; `dropped` → **never touch** (legal-normal) |
| **British spelling** (`BRITISH` in `de_ai_audit.py`) | locale mismatch in US-register prose (`recognise`, `behaviour`, `whilst`, `labelled`) — LLMs emit these into US documents from mixed training corpora | swap for the US form; **drop the check for a UK-register document** |
| **Stylometrics** (`ai-anti-patterns/scripts/style_metrics.py`) | rhythm/structure: `composite_human_likeness` 0-100, em-dash, metronomic runs, opener transitions, nominalization, false precision, burstiness/passive advisories | vary sentence length toward bursty; em-dash → semicolon/period; plainer Latinate→Anglo-Saxon; round a summarising figure to a fraction |

## Modes

| Mode | Trigger | Behavior |
|------|---------|----------|
| **rewrite** (default) | "de-AI this", "make it less AI" | audit → rewrite flagged spans → one corrective 2nd pass → return an edits-made + verification report (NOT the whole file) |
| **detect-only** | "just flag", "scan", "what AI tells are in this", "audit only" | audit only; report flagged spans + composite/tic-density; no edits |
| **edit-in-place** | "fix `draft.md` directly", "clean the file in place" | minimal targeted Edits to the file; preserve already-human paragraphs; re-audit after |

Default to rewrite when unspecified.

## Process (the spec)

```
START
  │
  ├─ Step 1: AUDIT — run de_ai_audit.py --json on the target
  │     uv run --with pyyaml python3 ${CLAUDE_SKILL_DIR}/scripts/de_ai_audit.py --json <file>
  │     Read: composite_human_likeness, tic_density, spans[], advisories[]
  │
  ├─ detect-only? → report spans + signals, STOP.
  │
  ├─ Step 2: REWRITE the flagged spans (NOT the whole draft)
  │     - tic spans                 → rewrite the construction (no honest use)
  │     - diction:always_flag       → swap for the listed plain replacement
  │     - diction:cluster           → fix enough of the cluster to drop below 2/para
  │     - style:em_dash             → recast as semicolon / period / comma — but NOT all (see Preserve)
  │     - style:false_precision     → round to a high-level fraction ("1.3771 percent" → "about one
  │                                   and a half percent"); KEEP the exact value if the sentence sits
  │                                   next to the exhibit that reports it
  │     - advisories (burstiness)   → vary sentence length where it reads flat; do NOT chop for chop's sake
  │     PRESERVE already-human passages (no spans) untouched.
  │     PRESERVE quoted material, block quotes, code, footnote citations.
  │
  ├─ Step 3: ONE corrective 2nd pass
  │     Re-run de_ai_audit.py. Fix spans the first pass introduced or missed.
  │     STOP at 2 passes — a 3rd rarely finds more and costs a full regeneration.
  │
  └─ Step 4: REPORT (edits-made + verification), NOT the whole file
        - what changed and why (span → before → after, grouped by scorer)
        - before/after composite + tic-density (must improve or hold; if it dropped, you over-edited)
        - spans deliberately LEFT (author's voice / quoted / domain term) and why
```

If text and flowchart disagree, the flowchart wins.

## Preserve-Human (the other half of Goodhart)

The composite penalizes em-dashes hard, and real legal scholarship — including this
user's own published prose — uses them deliberately. Do NOT zero them out.

- **Em-dashes:** thin clusters and the clearest default-connector uses; KEEP em-dashes
  that set off a genuine appositive or a deliberate aside. Target *fewer*, not zero.
- **`dropped`-tier diction** (significant, robust, leverage, comprehensive, …): NEVER
  flag or swap — these are legal/finance-normal; the audit already excludes them.
- **Quoted text, block quotes, statutory language, party names, code, citations:** flag
  at most; never rewrite someone else's words or a term of art.
- **Footnotes are auto-excluded:** the audit MASKS pandoc inline `^[...]` and markdown `[^id]:`
  footnotes before scoring, so findings never land inside them (citation/legal-normal text). You
  will not see footnote spans to triage; if you ever do, do not edit them. (`--keep-footnotes`
  disables masking for debugging the raw signal only.)
- **British spelling in a genuinely UK-register document:** the check assumes US
  register. For a UK journal or an English court filing, ignore `spelling:british`
  entirely — do not "correct" an author writing in their own dialect.
- **A flagged span the author clearly chose** (a fragment for emphasis, a repeated key
  term over elegant variation): leave it; note it in the report.

## Fact rows

- The synthetic-AI baseline scores composite ~27 and tic-density 100; a real human
  legal draft scores ~55-65 with em-dashes as nearly the whole signal. So a composite
  in the 50s is NOT "AI" — it is a human who likes em-dashes. Treating the composite as
  a pass/fail bar instead of a span guide produces voice-destroying edits and is the
  exact failure the corpus tiering was built to prevent.
- `diction.yaml` `dropped` tier exists because "significant/robust/leverage" fire on
  every real law-review article; a linter that flags them is worse than none. The audit
  omits them — if you hand-flag one anyway, you reintroduced the false positive.
- The British-spelling map deliberately EXCLUDES words correct in both dialects —
  `analysis`, `characteristic`, `basis`, `emphasis`, `thesis`, `hypothesis`, and
  `practice`/`licence` as nouns. The -sis nouns are not the -ise verbs. Adding any
  of them turns the check into a false-positive generator, which is the exact
  failure the corpus tiering elsewhere in this skill exists to prevent.
- It matches STRICTLY (`\bword\b`), not via `_word_rx`, because every inflected
  form is enumerated. Using `_word_rx` made "recognise" also match inside
  "recognised" — two spans for one word, one carrying the wrong replacement.
- A 3rd rewrite pass regenerates the whole span set for ~0 new fixes (CAP AT 2). The
  built-in corrective pass IS pass 2; "iterate to convergence" does not stack on it.
- Em-dash count near zero after a de-AI pass is over-editing, not success: you optimized
  the metric and flattened the author's rhythm. Fewer, not none.

## Red Flags — STOP

- About to swap every flagged diction word → STOP. Cluster/density tiers are advisory;
  fix enough to clear the threshold, keep the ones that read right.
- About to delete every em-dash → STOP. Target fewer; keep deliberate appositives.
- About to rewrite a paragraph with zero spans because it "feels AI" → STOP. The audit
  found it human; trust the corpus over the vibe.
- About to run a 3rd rewrite pass → STOP. Cap is 2.
- About to return the whole rewritten file by default → STOP. Return the edits-made
  report unless the user asked for the full text.
- About to rewrite quoted/statutory text → STOP. Flag it; never alter someone else's words.

## When invoked inside the writing workflow

- **/writing-verify** runs `scripts/prose-audit.py` on every draft before dispatching its prose
  reviewers and INJECTS the resulting spans into their prompts as evidence — the reviewer is not
  asked to run a scorer, and a reviewer that cites none of the hard spans it was handed is
  recorded as unreliable. Those spans become AI-ism findings (advisory minors unless they cluster
  into a major).
- **/writing-revise** applies this skill (rewrite mode) as a non-optional pass on every
  edited draft after fixing REVIEW.md issues, then re-audits. The substrate gate is
  unchanged: AI-prose spans are advisory polish, not blocking criticals.
