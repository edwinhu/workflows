# 2026-06-22 — Discovering the "false-unity closer" AI tic

First end-to-end run of the **AI-tic discovery harness**
(`scripts/ai-tic-discovery.py` + `scripts/ai_tic_discovery/`). Goal: automate
the hand-validated loop — elicit → measure → judge → detect → lock-in — that
grows the regex rules in `skills/ai-anti-patterns/`.

## The tic

The LLM-default way to *end* an op-ed / essay: enumerate three or more unrelated
items, then assert they share one grand, universal lesson. Both models reached
for it unprompted on the very first elicitation:

> **copilot:** "Whether it's the Fed holding rates, a World Cup upset, or a Mars
> rover finding water, the only constant is our refusal to read the fine print."
>
> **agy/Gemini:** "Whether we are navigating UN inspectors, an executive order,
> or an Ebola outbreak, the ultimate lesson of our era remains the same…"

Surface forms vary; the deep structure is constant: *disparate enumeration →
manufactured shared meaning.* Recurring payloads: "the lesson is the same",
"all point to one uncomfortable truth", "are not separate crises but a single…",
"if X, Y, and Z share anything, it is…".

## Method (what the harness did)

1. **ELICIT** — `elicit --context oped_closer --n 4` → 80 closers (40 copilot,
   40 Gemini), cached under `scratch/ai-tics/cache/` for reproducibility.
2. **MEASURE** — the seed `whether_universal_lesson` regex hit 2/8 samples,
   **copilot-only** → a single-model signal. Reading all 80 raw closers showed
   the schema was far broader than "Whether it's…".
3. **DETECT** — built a conservative pattern FAMILY (the `Whether… or…, [unifier]`
   lead + a manufactured-unity payload alternation) and scored it with
   `evaluate_regex` against (a) the 80 mined positives and (b) the human corpus.
4. **FP-HUNT** — the seed regex drew **1 false positive** on the human corpus:
   *"Whether the Merger was fair is the question that I now answer"* (In re
   Southern Peru Copper, Del. Ch.). Fix: require the `, or …,` enumeration in the
   lead and drop the generic `question` payload. → **0 FP.**
5. **LOCK-IN** — added two tuples (A: lead, B: payload) to `_STRUCTURAL_PATTERNS`
   in `wikipedia-structural-patterns.py`, SOFT severity, plus two pytest cases.

## Result

| metric | value |
|---|---|
| recall over 80 elicited closers | **36 %** (29/80) |
| cross-model | copilot 20/40 **and** Gemini 9/40 → real default, not a quirk |
| false positives | **0 / 15,162** human sentences (pre-2017 finance/accounting + Delaware opinions) |
| severity | soft (warn) |

36 % recall is deliberate: the schema is highly productive, and the remaining
forms (e.g. "As X, Y, and Z, we are reminded that…") overlap with legitimate
prose and can't be separated without false positives. Conservative-and-soft beats
broad-and-wrong — same discipline as the imperative-opener and antithesis rules.

## Human control corpus

Sourced from the user's "ResearchPDFs" Google Drive folder (top finance &
accounting journals, organised by journal). Pre-2017 → no LLM contamination;
domain-matched → the register the hook guards. Extracted text is git-ignored
(copyright); see `corpus/README.md` to rebuild. The Delaware opinions in the
corpus were what caught the seed regex's false positive — legal prose earns its
place in the negatives.

## Harness reuse

```bash
# add a context + candidate to contexts/*.yaml, then:
./scripts/ai-tic-discovery.py elicit  --context <id> --n 6
./scripts/ai-tic-discovery.py measure --candidate <id> --show 30   # cross-model base rate
./scripts/ai-tic-discovery.py judge   --candidate <id>             # "is this a tic? name it"
./scripts/ai-tic-discovery.py eval    --candidate <id>             # recall + FP vs corpus
./scripts/ai-tic-discovery.py fp-hunt --candidate <id>             # every human-corpus hit
```

## Follow-ups

- Elicit the other seeded contexts (`example_intro`, `section_transition`,
  `abstract_closer`) and mine their candidates.
- `judge` was implemented but not needed here (the cross-model base rate + corpus
  FP gate were decisive); use it when a candidate's tic-status is ambiguous.
- The CLI's `eval` mines positives as *lines the regex already matches*, so its
  recall reads 100 %; the meaningful recall is measured over ALL elicited samples
  (the 36 % above). Consider a `--positives-file` of hand-labelled closers for a
  stable recall denominator.
