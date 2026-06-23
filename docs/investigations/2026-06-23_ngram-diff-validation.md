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

## Full-scale run (rjds) — DONE

Moved to **rjds** (64 cores, 251 GB RAM). Decoupled cleanly: rjds does the
CLI-free human side (`rclone` all 13,109 PDFs by folder-id → harvest →
`/data/eh2889/aitic_corpus`); the Mac keeps the CLI-bound elicitation and syncs
its few-MB LLM cache over. `AITIC_CORPUS_DIR` / `AITIC_CACHE_DIR` env overrides
let the tested CLI run against the out-of-repo corpus unchanged.

**Harvest perf fix (the run that mattered).** The first harvest used
`pymupdf4llm.to_markdown` and crawled — 2 h 22 m for ~1,800 articles — because
(a) markdown layout analysis is slow and (b) its in-order `ex.map` stalled
whenever a malformed PDF (broken LZW stream) hung a worker. Rewrote to raw
`fitz.get_text()` + `as_completed` + a SIGALRM per-PDF watchdog: **480 PDFs went
from 2 h 22 m → 3.7 s** (~1000×), and the full 13,109-PDF corpus harvested in
minutes → **11,229 articles / 103 M tokens / 8.73 M sentences** (~14 % skipped as
scanned/short).

## Full-corpus result — the sample lied, and that's the point

Re-running `ngram-diff` against 103 M human tokens (vs 3.4 M in the sample)
**corrected the sample's false positives** — exactly the reason to scale the
human side:

| candidate | sample human | FULL human | verdict |
|---|---|---|---|
| `this study contributes to the growing literature` | **0** | **6** | NOT a tic — real authors write it |
| `implications for both theory/practice` | **0** | **6 FP** | NOT a tic — standard academic phrasing |
| `by demonstrating that` | low | 213 | common human prose |
| `these findings carry [significant] implications` | 0 | **0** | **real tic — shipped** |

The poster-child candidate from the sample (`contributes to the growing
literature`) turned out to be genuine human scholarship. A rule shipped off the
339-article sample would have been a false positive on the user's own writing.

## Shipped rule

`these findings carry significant implications` (and `findings/analysis carry
<adj> implications`) — the AI academic closer that asserts importance instead of
saying what the findings imply. **0 hits in 8,733,332 human sentences**,
cross-model (GPT + Gemini), recall 9/80 academic samples. Added to
`_STRUCTURAL_PATTERNS` (SOFT) + pytest case (incl. a negative asserting the
killed siblings are NOT flagged).

## Lessons

1. **A big human FP corpus is load-bearing, not optional.** Three of four top
   candidates that looked clean on 339 articles were real human phrasing at 11k.
   The FP gate must be large and genre-matched or the rule fires on real writing.
2. **The diff is a candidate *generator*, not a *judge*.** It ranks; the
   full-corpus FP gate decides. Net yield here: 1 solid rule from ~20 ranked
   candidates — the right ratio for a conservative, soft linter.
3. **Plain `get_text()` beats markdown extraction for this** by ~1000× and is
   adequate for n-gram counting.
4. Single-threaded Python n-gram counting over 103 M tokens took ~12 min / 35 GB
   RAM. Fine on rjds; for routine reuse, parallelize the count (per-doc Counters
   merged) or prune n-grams seen <2 during counting.

## Expanded elicitation (182-sample LLM denominator)

Bumped the LLM side ~6× via multi-paragraph contexts (7 `*_multi` contexts, 6
paragraphs/call) → 182 academic samples / ~630 K chars. Re-ran the diff against
the same 103 M-token human corpus.

**New rule shipped:** AI gap-statement / results-framing cliché —
`a critical gap in the literature` + `Practically, these findings…`. FP = **1**
in 8,733,332 sentences (a structurally-identical human "fill a critical gap"),
cross-model, recall 19/182. SOFT, so the lone near-miss is acceptable. Added to
`_STRUCTURAL_PATTERNS` + pytest (36 passing).

**Most expanded candidates still failed the gate** — `study advances the`
(18 FP), `remain poorly understood` (4), `significant gap` (3), `we therefore
hypothesize` (34): all genuine human phrasing. `contributes to the growing
literature` reconfirmed human. The 0-FP bar keeps doing its job.

**New noise source — topic drift.** Letting the multi-prompts choose topics made
the models reach for *modern* subjects (machine learning, NLP, ESG, remote work,
`et al 2021/2022/2023`) that barely exist in a **pre-2017** corpus, so they rank
high without being tics. Lesson: for stylistic-tic mining, either constrain
prompt topics to timeless ones or down-weight content-word-heavy n-grams; judge
function-word patterns, not topic words. (The `et al <recent-year>` cluster is a
real tell on its own — LLMs fabricating recent citations — but needs a dedicated
detector, not the generic diff.)

## Next

1. Constrain elicitation topics (or filter content-word n-grams) to suppress the
   pre-2017 topic-drift noise before the next mining pass.
2. Split hallucinated-citation artifacts (`et al <recent year>`) into their own
   candidate — LLMs inventing recent citations is itself a worth-flagging tell.
3. Parallelize/prune the n-gram counter for faster reuse.

## Harness additions this round

`harvest.py` (parallel, standalone `--out`/`--skip-existing`, journal-prefixed
names), `ngram.py` (count + rate-ratio diff + cross-model gate + nested dedupe),
`ngram-diff` CLI, 7 academic contexts, `tests/test_ai_tic_discovery.py`
(stdlib-only: models/_clean, evaluate_regex, ngram).
