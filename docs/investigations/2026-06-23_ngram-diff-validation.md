# 2026-06-23 — N-gram diff: automated tic discovery validated

Second harness milestone: automate the DISCOVERY step itself. Instead of Claude
reading samples and noticing a pattern (how the "false-unity closer" was found),
count n-grams in a large human corpus vs LLM output and let the **rate ratio**
surface over-used constructions automatically.

## Question being answered

Does the n-gram diff actually beat eyeballing — surface real tic candidates, not
noise? (The sizing decision hinged on this: only worth the full-scale build if
the method produces clean candidates.)

## Setup (sample slice, on the Mac)

- **Human corpus:** 339 finance/accounting journal articles (pre-2017),
  3.4M tokens. Harvested locally with the parallel extractor.
- **LLM corpus:** 70 academic paragraphs — 7 genre-matched contexts
  (intro / hypothesis / results / discussion / conclusion / lit-review /
  contribution) × 5 samples × {copilot (GPT), agy (Gemini)}. Zero elicitation
  errors.
- **Method:** `ngram-diff` — count 3–8-grams both sides, rank by
  `(LLM rate + k)/(human rate + k)` with a **cross-model gate** (phrase must
  appear in ≥2 models) and a human-rarity filter.

## Result: YES, it works

Top candidates (cross-model, ~absent from human prose) — all recognizable
AI-academic boilerplate, found with **no manual reading**:

| phrase | n | LLM | human | note |
|---|---|---|---|---|
| `this study contributes to the growing literature on` | 8 | 7 | 0 | the canonical AI contribution-statement tell |
| `these findings carry significant implications for both` | 7 | 4 | 0 | AI implications-closer |
| `implications for both theoretical` (and practical) | 4 | 6 | 0 | same family |
| `practically these results` | 3 | 5 | 0 | AI "theoretically X, practically Y" cadence |
| `by demonstrating that` | 3 | 21 | 11 | elevated but present in human prose |
| `study addresses this` (gap) | 3 | 5 | 1 | AI gap-statement |
| `extensive research has` | 3 | 4 | 1 | AI lit-review opener |

**Signal-to-noise is good.** The noise that appears is explainable and
filterable: `et al 2019` (hallucinated-citation artifact — LLMs invent cites),
`real earnings management` (a topic term, 7 LLM / 8 human — correctly NOT
ranked high). The cross-model gate + human-rarity filter do most of the work.

**Conclusion: the automated diff beats eyeballing.** "this study contributes to
the growing literature on" is exactly the kind of phrase a human reviewer would
take many samples to notice, and it fell straight out of the ranking.

## Why nothing shipped as a rule yet

The first rule (false-unity closer) was gated on **15,162** human sentences. The
339-article sample here is too small a false-positive gate — a phrase that's
0/339 may still appear in the full corpus. So candidates wait for the
**full ~13.8k-article FP gate** before becoming rules.

## Full-scale run (in progress, on rjds)

The sample proved the method; the full run sharpens the human-rate denominator
(rarer phrases get measured; topic words get properly down-weighted). Moved to
**rjds** (64 cores, 251 GB RAM) — the harvest is the CPU/RAM hog, and at 13.8k
articles it's ~30× the sample. Decoupled cleanly:

- **rjds** (CLI-free): `rclone` all ~13.8k PDFs by folder-id → 60-worker harvest
  → `/data/eh2889/aitic_corpus`. Running detached (`setsid nohup`,
  `aitic/run_overnight.sh`). 251 GB RAM means the full n-gram diff also fits in
  memory — no streaming/DuckDB needed.
- **Mac** (CLI-bound): elicitation stays where copilot/agy are authed; the LLM
  cache (a few MB) syncs to rjds for the diff.

## Next

1. When the rjds harvest finishes: sync the LLM cache to rjds, run `ngram-diff`
   against the full corpus.
2. Promote the shortlist (`contributes to the growing literature on`, `these
   findings carry significant implications for both`, …) to candidate regexes;
   `fp-hunt` each against the full corpus; lock in the 0-FP ones as SOFT rules
   with pytest cases — same discipline as the false-unity closer.
3. Filter the hallucinated-citation artifacts (`et al <year>`) out of the
   ranking, or split them into their own candidate (LLMs inventing citations is
   itself a worth-flagging tell).

## Harness additions this round

`harvest.py` (parallel, standalone `--out`/`--skip-existing`, journal-prefixed
names), `ngram.py` (count + rate-ratio diff + cross-model gate + nested dedupe),
`ngram-diff` CLI, 7 academic contexts, `tests/test_ai_tic_discovery.py`
(stdlib-only: models/_clean, evaluate_regex, ngram).
