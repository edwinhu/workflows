# The Economist's 2026 corpus study — what moved, and what to lint

**Source.** "How to spot AI writing", *The Economist*, 30 July 2026 (1 Aug 2026 edition),
<https://www.economist.com/culture/2026/07/30/how-to-spot-ai-writing>, and its companion leader
"AI is getting better at writing. Humans must get better at editing", same issue,
<https://www.economist.com/leaders/2026/07/30/ai-is-getting-better-at-writing-humans-must-get-better-at-editing>.

**Method, as reported.** They prompted ChatGPT, Claude, Gemini and Grok — 14 model variants
released since 2024 — to rewrite their own articles without web access, then compared **55,940
sentences / 1.2m words** against *The Economist*'s own prose, against CNN / *New York Times* /
*Washington Post* (2018–2022), and against NYT-bestseller fiction (1950–2022).

> ⚠ **The study publishes NO frequency counts.** Its four charts are unlabelled relative-rank
> plots. The only numbers in either piece are the corpus size, Pangram's claimed 99.98% detector
> accuracy, and "more than a third of new websites". **Nothing here can be turned into a rate
> threshold from the article alone** — any new numeric gate still has to be measured against our
> own control corpus.

---

## 1. What the study says has DECAYED — and what that means for our existing rules

This is the most useful part of the piece, because it dates signals we already ship.

| signal | status per the study | what we should do |
|---|---|---|
| **"delve"** | "they no longer *delve*" | keep the *compound* tic (`delve into the intricacies of`), which is a construction rather than a word; do not treat bare "delve" as evidence |
| **"rich tapestry"** | "there are not as many *tapestries*" | keep — it is `sev4` and near-zero in the human control — but expect its yield to fall |
| **"leveraging"** | "no longer leveraged much" | ditto |
| **em-dashes** | **superseded.** "Many believe LLMs stuff their prose with em-dashes, but that is not true after the most recent updates." | **see §2 — this one needs care, not deletion** |

The general lesson: **a word-level AI tic has a half-life.** Models drop the tells people mock.
A construction-level tic (`not X but Y`, reasoning-chain leakage, the chatbot opener) is stickier
than a vocabulary tic, because it comes from how the model plans a sentence rather than from a
token preference. Weight construction rules above word rules when they conflict.

## 2. Em-dashes: the finding is now MODEL-DEPENDENT, which is not the same as dead

The study's actual claim, precisely: **"Today only Claude uses more em-dashes than human writers,
with ChatGPT using markedly fewer than any other writer in our study."**

So the em-dash signal did not vanish; it split by model. For text drafted by Claude it remains a
live and strong signal, and `de-ai-revise`'s heavy em-dash weighting is *correct* for that case.
For ChatGPT-drafted text the signal has **inverted** — unusually *few* dashes would be the tell.

⚠ **Do not read a low em-dash count as "human".** And do not strip the em-dash weighting from
`de-ai-revise` on the strength of this article: the corpus gate there was measured against real
law/finance prose, and this study measured against news and fiction.

The companion leader's advice to human writers is the inverse and worth carrying: *"Humans
rejoice—and start using dashes again."* Over-correcting to zero em-dashes is itself a tell.

## 3. What the study found that we ALREADY measure

`ai-anti-patterns/scripts/style_metrics.py` already carries all of these, so the study is
independent corroboration rather than new work:

| Economist finding | our existing feature |
|---|---|
| AI uses more long words (8+ letters) | `word_len_mean` (human 5.02 / AI 6.17) |
| "Latin or Greek words are grander than Saxon ones" (Orwell); more Latinate suffixes | `latinate_ratio` (human 0.094 / AI 0.131) |
| fewer semicolons | `semicolon_per_1000` (human 7.32 / AI 0.43) |
| longer sentences, few short punchy ones | `sent_len_mean`, `para_sent_count_mean`, and the burstiness / metronomic-run advisories |
| fond of nominalisations ("expansion" from "expand") | `style:nominalization` |
| rule of three | `triad_per_1000` |

## 4. What we do NOT yet cover — candidate rules

**These are candidates, not rules. None has passed the human-control gate.** The `ai-tic` skill
exists precisely to stop unvalidated phrases shipping; run each through it before adding.

1. **`not X but Y`** — named as an LLM favourite. The leader gives the sharpest example, and it is
   the *redundant* form that matters: *"The mystery has been solved—not partially, not
   ambiguously, but definitively."* Three negations restating one idea.
   ⚠ **High false-positive risk in legal prose**, where "not X but Y" is a legitimate and common
   distinction-drawing move ("the question is not whether, but when"). A naive regex will fire on
   good writing. Any rule needs to target the *redundant-restatement* form, not the construction.
2. **`not only … but also`** — same caveat, more so. Extremely common in human legal and academic
   writing.
3. **Parenthesis rate.** "hardly any parentheses" is a specific, testable claim and we do not
   measure it at all. This is the cleanest addition: a scalar, no regex, no false-positive surface.
   Note `commas_per_sent` exists but was dropped from the composite for a near-zero gap — measure
   parentheses **per 1,000 words**, not per sentence, since AI's longer sentences confound the
   per-sentence denominator.
4. **Redundant triads.** We count triads; we do not test whether the three members are *distinct*.
   The Economist's own defence of its triples is that they group three sensible bits of advice,
   where AI's restate one. Distinguishing those is a semantic test, not a regex.
5. **`"and"` as the most overused word**, driving long unpunctuated sentences.
6. **Sycophancy** — "great observation!", "love the analogy!", exclamation marks. Chat-surface
   rather than prose, and partly covered by the `chatbot-opener` tic.

## 5. The one place this study CONFLICTS with our tiering — do not "fix" it

The study names **"significant"**, "increasingly" and "consequences" as AI-overused polysyllables.

**`de-ai-revise/references/diction.yaml` puts "significant" in the `dropped` tier** — >80 per
million in the law+finance control corpus, i.e. genuinely normal in the register we lint. Both
findings are true: it is AI-overused *relative to news and fiction*, and it is unremarkable *in
scholarly law and finance prose*.

⚠ **Promoting "significant" to `always_flag` on the strength of this article would fire on
essentially every real law-review article and comment letter we touch.** That is the exact
false-positive failure the corpus tiering was built to prevent. The register you are linting
decides, not the study's baseline.

## 6. The line worth keeping

> "So if you want to spot AI writing, look for bland, pretentious prose lavished with Latinate
> words — at least for now."

And the trajectory, which is the reason none of this is permanent: the study's own chart shows AI
prose converging on human prose with every model release, because models are trained on human
writing and tuned on human feedback — "picking up things people find impressive and dropping
things they do not". **Date every rule. Re-measure rather than inherit.**
