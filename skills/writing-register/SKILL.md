---
name: writing-register
description: The three measured prose registers — general (comment letters, memos, briefs), legal (T14 law review), econ (finance/accounting journals) — plus the shared Strunk/Volokh/McCloskey base filtered through 14.29M sentences of human scholarship. Preloaded into the writing subagents; grade or draft against the section matching the dispatched domain.
---

# Writing registers

Three registers in one file, because the register facts are **contrastive by construction**: every
row below is a law-vs-finance comparison, and splitting them would mean carrying the same corpus
numbers three times.

**Use the section matching the domain named in your prompt — `general`, `legal` or `econ` — and the
shared base at the end, which applies to all three. Never grade or draft against a domain other
than the one your prompt names; importing a rule across that line is the single most damaging thing
you can do here.**

---

# General register (`general`)

You are drafting and revising **serious professional prose that is neither a law review article nor
a journal submission**: an SEC comment letter, a policy memo, a white paper, a letter to a regulator,
a board memorandum. It has no house register of its own, so it borrows discipline from both scholarly
registers without adopting either one's markers.

Everything below is measured, not asserted. The sources are two control corpora — **6,563 pre-2020
articles / 5,560,816 sentences** from all 14 T14 flagship law reviews plus four business-law journals
(`/data/eh2889/aitic_corpus_law` on rjds), and **11,198 pre-2017 articles / 8,733,332 sentences** of
finance and accounting scholarship (`/data/eh2889/aitic_corpus`). Percentages are share of sentences
containing the feature. Rates written `n/M` are hits per million sentences.

## Register: borrow from both, commit to neither

| feature | law | finance | do |
|---|---|---|---|
| `we` | 0.87% | 7.75% | Use the institutional first person (`we write to comment`) if you are writing for an institution; otherwise avoid it. Neither corpus's default is yours. |
| `we find / show / document` | 0.02% | 0.58% | Only if you actually ran the analysis. A comment letter cites others' findings; it does not announce its own. |
| `supra` / `infra` / `id.` | 1.91% | 0.00% | Do not use Bluebook short forms outside a law review. Give the full cite or a short name. |
| quotation marks | 8.36% | 1.68% | Quote the rule text or the release you are responding to directly. Quote everything else sparingly. |
| `This Article` / `This paper` | 0.06% / 0.02% | 0.00% / 0.28% | Neither. Say `This letter`, `This memorandum`, or name the thing. |
| cross-references | `Part I` 0.20% | `Section 2` 0.27% | Number your sections and refer to them by number. Do not import `Part II.B`. |
| semicolons | 4.33% | 2.27% | Somewhere between. A long coordinate list is fine; two sentences are usually better. |
| `may` / `might` | 3.56% | 1.99% | Hedge where the law or the evidence is genuinely unsettled, and nowhere else. |

## What the corpora say is NOT a register marker

Do not "fix" these. They are statistically indistinguishable between the two registers, so any advice
keyed on them is style preference wearing empirical clothes.

- **Passive voice**: 7.91% law vs 8.55% finance. Both registers use it steadily and deliberately.
  Rewrite a passive when the agent matters, not on principle. Strunk's active-voice rule survives as
  a question ("who did this?"), not as a rule.
- **`however,`** 1.08% vs 1.01%; **`thus`** 0.75% vs 0.83%; **`moreover,`** 0.20% vs 0.16%.
  Connectives are not a tell in either direction.
- **Em dashes**: 0.51% vs 0.46%. Near-identical. The em-dash budget in `prose-audit.py` targets
  *clustering* inside a paragraph, which is a different claim from the overall rate.

Two measurements that look tempting and are **confounded** — ignore them:

- **Sentence length** (mean 10.3 law / 10.9 finance): an artifact. The corpora are `fitz.get_text()`
  PDF output, which breaks lines mid-sentence, so measured length is a floor, not a distribution.
- **Contractions** (4.04% vs 0.86%): the regex catches possessive `'s`, and legal prose is dense with
  `the court's`, `plaintiff's`. It is not measuring contractions.

## Conventions

- **Lead with the ask.** A comment letter's first paragraph says what you want changed and why. The
  analysis follows; it does not build up to the point.
- **Number the sections** and refer to them by number.
- **Cite in full the first time**, then by short name. No `supra`, no author-date, unless the
  document is going to a venue that expects one.
- **One word per concept.** No synonym cycling — if it is the "passive block" in Section 2, it is not
  the "index cohort" in Section 5.
- **Attribute every number.** A quantity with no source is not evidence.

---

# Legal register (`legal`)

You are drafting and revising **law review prose**: a flagship article, a student note, a seminar
paper, a piece of legal scholarship carrying footnotes. Voice, citation form and register follow the
conventions below.

Everything here is measured, not asserted. The source is a control corpus of **6,563 pre-2020
articles / 5,560,816 sentences** from all 14 T14 flagship law reviews plus four business-law journals
(`/data/eh2889/aitic_corpus_law` on rjds), contrasted against **8,733,332 sentences** of
finance/accounting scholarship. Percentages are share of sentences containing the feature, law corpus
first. Rates written `n/M` are hits per million sentences.

## Register: what actually distinguishes this corpus

| feature | law | finance | do |
|---|---|---|---|
| `we` | **0.87%** | 7.75% | Avoid the authorial `we`. It is nine times rarer here. Prefer the impersonal construction or `This Article`. |
| `we find / show / document` | **0.02%** | 0.58% | Effectively absent — 29× rarer. Never open a claim this way. Say what is true, then cite. |
| `supra` / `infra` / `id.` | **1.91%** | 0.00% | Bluebook short forms are the norm and appear in roughly one sentence in fifty. |
| quotation marks | **8.36%** | 1.68% | Quote sources directly and often — five times the rate of the finance register. |
| `court` / `holding` / `held` / `statute` / `doctrine` | **6.41%** | 0.73% | The vocabulary of authority is the substance, not decoration. |
| semicolons | **4.33%** | 2.27% | Twice the finance rate. Long coordinate structures are idiomatic here. |
| `may` / `might` | **3.56%** | 1.99% | Hedging is register-appropriate. Do not strip it out to sound decisive. |
| `Part I` / `Part II` | **0.20%** | 0.00% | Cross-reference by **Part**, never by "Section 2". |
| `This Article` | **0.06%** | 0.00% | The self-reference. Capital A. `This Note` for student work. |
| `This paper` | 0.02% | **0.28%** | Wrong register. Do not write it. |
| parentheticals | 1.93% | **4.73%** | Less parenthetical throat-clearing than the finance register; put the qualification in a footnote. |
| `regression` / `coefficient` | 0.05% | **2.25%** | Empirical vocabulary is 45× rarer here. If the Article is empirical, it still narrates rather than tabulates. |

## Conventions

- **Footnotes carry the citations.** Substantive text goes in the body; support, parentheticals and
  qualifications go below the line. Never inline a full citation in body prose.
- **Cross-reference by Part** (`Part II.B`), not section number.
- **Signals matter**: `see`, `see also`, `cf.`, `but see`, `e.g.` — italicised, and each means
  something different. Do not use `see` where the source states the proposition directly.
- **`supra` / `infra` / `id.`** for short forms once a source is established.
- **Small caps** for journal names in citations.
- **Three body Parts is the default** — Background, the Argument with counterarguments folded in, the
  Prescription. Splitting into four or five Parts is an exception you reach, not a starting point.

## Volokh, run through the law corpus

`writing-legal` is Volokh's *Academic Legal Writing*. Its prescriptions were checked against the same
corpora and sorted the same three ways.

### Ship

| rule | why it holds |
|---|---|
| Never open with `This article discusses…` | It is throat-clearing, and the corpus opens with the concrete problem. Hook with the question or the controversy. |
| Confront counterarguments **in the Part that makes the claim** | Deferring them to a separate Part reads as evasion and forces the reader to hold the objection unanswered. |
| Read the original source | A case cited from a headnote, a treatise, or training data is an unverified claim presented as fact. Even Supreme Court opinions misstate precedents. |
| Synthesize precedents; do not summarize case by case | `Courts generally hold X, except when Y` — not a sequential digest. |
| Be precise with terms | `murder` ≠ `homicide` ≠ `killing`; `foreign-born` ≠ `noncitizen`; `children` is ambiguous until you give the age range. |
| Understate criticism | `mistaken`, not `idiotic`. Overstating raises your own burden of proof. |
| Unpack the metaphor | `slippery slope` and `chilling effect` hide the argument rather than making it. Name the mechanism. |

### Advisory

| rule | measured reality | what to actually do |
|---|---|---|
| Cut the hedges (`may`, `might`, `arguably`) | `may`/`might` in **3.56%** of law sentences, 1.8× the finance rate | Hedging is register-appropriate here. Cut `arguably` where it substitutes for the argument; leave the rest. |
| Prefer active voice | passive 7.91% law vs 8.55% finance — not a register marker | Ask who acted. Do not convert on principle. |
| Avoid long coordinate sentences | semicolons **4.33%**, twice the finance rate | Long coordinate structures are idiomatic in this corpus. Break the ones that lose the reader, not the ones that are merely long. |

### Dropped

| rule | why it is dropped |
|---|---|
| Avoid `pursuant to` | 837/M in the law corpus — **26× the finance rate**. This is not legalese to be purged; it is the legal register. Flagging it teaches the drafter to write like an economist. |
| Avoid the passive throughout | See above. The measurement refutes the rule as a register claim. |

## Vindicated in this corpus specifically

Beyond the shared list below: `To be sure,` runs **194.0/M** here (against 11.5/M in finance) and
`Admittedly,` **63.3/M**. `cuts against` (13.1/M) and `cuts the other way` are standard analytical
vocabulary. A reviewer who flags any of these as an AI tell is wrong, and the corpus says so.

---

# Econ register (`econ`)

You are drafting and revising **finance / accounting journal prose** — the register of the *Journal
of Finance*, *JFE*, *RFS*, *Journal of Accounting Research*, *The Accounting Review*, *JAE*, *CAR*
and *RAST*, and of the working papers and job-market papers aimed at them.

Everything here is measured, not asserted. The source is a control corpus of **11,198 pre-2017
articles / 8,733,332 sentences** (`/data/eh2889/aitic_corpus` on rjds), contrasted against
**5,560,816 sentences** of T14 law review scholarship. Percentages are share of sentences containing
the feature, finance corpus first. Rates written `n/M` are hits per million sentences.

## Register: what actually distinguishes this corpus

| feature | finance | law | do |
|---|---|---|---|
| `we` | **7.75%** | 0.87% | The authorial `we` is standard — nine times the law rate. Use it. |
| `we find / show / document` | **0.58%** | 0.02% | The idiomatic way to state a result, 29× the law rate. `We find that…`, `We document…` |
| `regression` / `coefficient` / `standard error` | **2.25%** | 0.05% | 45× the law rate. The vocabulary of the method is the substance. |
| parentheticals | **4.73%** | 1.93% | Qualifications and magnitudes ride in parentheses rather than footnotes. |
| `e.g.` / `i.e.` | **1.23%** | 0.58% | Twice the law rate. |
| `suggests that` | **0.70%** | 0.20% | Standard hedge for an inference from evidence. |
| `Section 2` | **0.27%** | 0.09% | Cross-reference by **Section**, numerically. Never "Part II". |
| `This paper` | **0.28%** | 0.02% | The self-reference. Lowercase p. |
| `This Article` | 0.00% | **0.06%** | Wrong register. Do not write it. |
| `supra` / `infra` / `id.` | **0.00%** | 1.91% | Absent. Never use Bluebook short forms here. |
| quotation marks | 1.68% | **8.36%** | Quote sparingly — a fifth of the law rate. Paraphrase and cite. |
| semicolons | 2.27% | **4.33%** | Half the law rate. Prefer two sentences. |
| `may` / `might` | 1.99% | **3.56%** | Hedge less than law prose does. State the estimate and its standard error. |

## Conventions

- **Lead with the finding, not the literature.** McCloskey's rule: no "this paper discusses"
  boilerplate, no table-of-contents paragraph. Say what you found.
- **Inline citations** (`Fama and French (1993)`), not footnotes. Footnotes carry robustness
  qualifications and data caveats.
- **Cross-reference by Section**, numerically (`Section 3.2`).
- **Report magnitudes with their uncertainty.** A coefficient without a standard error is not a
  result. Give the economic magnitude, not just the significance.
- **Name the identification assumption.** Describing an empirical strategy without stating what makes
  it identify anything is the canonical fatal omission; referees reject papers for it.
- **Tables are self-explanatory.** Words in headings, not acronyms — `Logarithm of Domestic Price`,
  not `LPDOM`.

## McCloskey, run through the finance corpus

`writing-econ` is McCloskey's *Economical Writing*. Its prescriptions were checked against the same
corpora and sorted the same three ways.

### Ship

| rule | why it holds |
|---|---|
| No boilerplate opener — `This paper discusses…`, `As we shall see`, `The rest of this paper is organized as follows` | It signals you have not found the hook. Open with the finding. |
| No table-of-contents paragraph | Readers skip it, and it cannot be understood before the paper is read. |
| One concept, one word — no elegant variation | `industrialization` / `structural differentiation` / `development` / `growth` for one thing makes the reader think there are four. Look back and reuse the word. |
| No ersatz economics — `skyrocketing` (2.9/M), `fair prices`, `vicious cycle`, `exploit` as a verb of blame | Rhetoric standing in for a magnitude. Give the number. |
| Repeat key words to link sentences | English coheres by repetition — (AB)(BC)(CD). `Not only… but also` is not cohesion. |
| End the paragraph a notch lower | A technical paragraph closing on a plain-English encapsulation is what makes it land. |
| Avoid invective | `This is pure nonsense` arouses the suspicion that the argument is weak. |

### Advisory

| rule | measured reality | what to actually do |
|---|---|---|
| Delete every `very` | `very <adj>` at 3,277/M | Delete the ones doing no work. A blanket rule fires constantly and is not a tell. |
| Untie Teutonisms / noun pile-ups | `the X process` shape at 4,482/M | Untie the ones that hide an actor. `factor price equalization` is a term of art; leave it. |
| Replace `this` / `these` / `those` with `the` | pervasive in both corpora | Only where the referent is genuinely ambiguous. |
| Never repeat without apologizing | — | Fine as a check on structure, useless as a prose rule. |
| Drop the metric conversions | — | Convert once, then trust the reader. Not worth a finding. |

### Dropped

| rule | why it is dropped |
|---|---|
| `agents` → `people` | **1,728/M** in the finance corpus. `agents` names the modelled decision-maker; `people` is a different claim. This rule rewrites the model, not the prose. |
| `hypothesize` → `suppose` | **683/M** in the finance corpus. It names a specific move in an empirical paper and has no plain-English synonym that keeps the meaning. |
| Avoid the authorial `we` (inherited from the general layer) | `we` runs **7.75%** here, 8.9× the law rate. It is the register. |
| Prefer active voice on principle | passive 8.55% finance vs 7.91% law — not a register marker. |

## Vindicated in this corpus specifically

Beyond the shared list below: `we acknowledge that` runs **72.3/M** here — *sixteen times* the law
rate — and is idiomatic in this register precisely where a reviewer would call it hedging. `Of
course,` runs 299.9/M. `To be sure,` is rarer here (11.5/M) than in law but is still attested and
still not an AI tell.

---

# The shared base — applies to all three registers

## The base layer: Strunk, run through the corpora

`writing-general` is Strunk & White. Its prescriptions were checked against all 14,294,148 sentences
of the combined corpora and split three ways. **A prescription that human scholars violate constantly
is not thereby wrong — these guides are prescriptive — but a rule in the second bucket fires on
roughly one sentence in fifteen, and a preloaded rule that noisy is worse than no rule.**

### Ship — cost-free, so treat these as rules

The measured rate is how often the phrase appears in the combined corpora. A rate under ~50/M means
enforcing the rule costs essentially nothing, because almost nobody writes it. `—` means the swap was
not measured: it is a low-risk judgment call, not a finding.

| never write | write instead | rate |
|---|---|---|
| `at this point in time` | `now` | 1.8/M |
| `skyrocket` / `skyrocketing` | give the number | 2.9/M |
| `different than` | `different from` | 48.7/M |
| `time frame` | `period`, `window`, or the dates | 37/M |
| `due to the fact that` | `because` | — |
| `in the event that` | `if` | — |
| `utilize` | `use` | — |
| `is able to` | `can` | — |
| `a large number of` | `many`, or the count | — |
| `past history` | `history` | — |
| `with regard to` | `about`, `on`, `under` | — |

### Advisory — real signal, constant in human prose, so judge in context

Every one of these is idiomatic at a rate that makes a hard rule pure noise. Flag them when a
sentence is genuinely worse for them; never rewrite on sight, and never report a run of them as a
finding.

| Strunk says | corpus rate | what to actually do |
|---|---|---|
| never open a sentence with `However,` | 6,666/M (finance) | Fine. Vary it, do not ban it. |
| untie noun pile-ups (`the X process`) | 4,482/M | Untie the ones that hide an actor. Leave the terms of art. |
| delete every `very <adj>` | 3,277/M | Delete the ones doing no work. It is not a tell. |
| `in order to` → `to` | 2,472/M | Cut it when the sentence reads the same without it. |
| `the fact that` → recast | 2,176/M | Recast the clumsy ones. This is not a violation. |
| convert passive to active | 7.91% / 8.55% of sentences | See above: both registers use passive steadily. Ask who acted; do not convert on principle. |
| replace `this`/`these`/`those` with `the` | pervasive | Only where the referent is genuinely ambiguous. |

### Dropped — these were register mistakes

Each of these guide rules, applied to its own domain's prose, damages the draft. They are recorded
here so nobody re-derives them from the source guides.

| rule | why it is dropped |
|---|---|
| McCloskey: `agents` → `people` | `agents` appears 1,728/M in the finance corpus. It is the term of art for the modelled decision-maker, not jargon to be plain-Englished. |
| McCloskey: `hypothesize` → `suppose` | 683/M in finance. It names a specific move in an empirical paper. |
| Volokh: avoid `pursuant to` | 837/M in the law corpus, 26× the finance rate. It is the legal register itself. |

## Prohibited constructions — the corpus-gated tic table

These cleared a ~0-human-rate gate against all 14,294,148 sentences of the combined corpora: they are
AI defaults that human scholars do not write. `prose-audit.py` flags each with a span id, so cite the
span rather than re-scanning by eye.

| never write | instead |
|---|---|
| `rich tapestry` | describe what it actually contains |
| `stands as a testament to` | `shows`, `demonstrates` |
| `in today's fast-paced / digital / ever-changing …` | delete the clause; start with the subject |
| `findings carry significant implications` | say what the implication is, and for whom |
| `delve into the intricacies of` | `examines` |
| `while X is impressive, Y remains…` | drop the false concession |
| `this represents a broader shift` | say what shifted |
| `a multifaceted issue` | name the facets |
| `plays a pivotal role in shaping` | name the effect |
| `navigate the complexities of` | say what is complex |
| `from X to Y, and everything in between` | give the actual range |
| **the rule / reform `bites`**, `bites hardest` | `binds`, `constrains`, or name the effect. *`the restriction has more bite` is fine — the noun is attested 46 times, the verb once.* |
| **`the sharpest version of`** the objection | `the strongest version of` — that is what the corpus writes, 4 hits out of 4 |
| **`bound` an abstraction** (`limits bound all of it`) | `limit`, `constrain`. *`the statute bound the agency` is fine — obligating a party is core legal vocabulary, 7 hits.* |

Two more, both sev5: chain-of-thought scaffolding leaking into prose (`let's think step by step`,
`breaking this down`, `here's my thought process`) and chatbot openers (`Certainly!`, `Great
question`, `Let's dive in`).

## Phrases the corpus VINDICATED — use them freely

These read as AI to many readers and are in fact standard scholarship. Do not let a reviewer talk you
out of them, and do not "fix" them in someone else's draft.

| phrase | law | finance |
|---|---|---|
| `Of course,` | 523.7/M | 299.9/M |
| `To be sure,` | 194.0/M | 11.5/M |
| `we acknowledge that` | — | 72.3/M |
| `Admittedly,` | 63.3/M | — |
| `cuts against` | 13.1/M | — |
| `cuts the other way` | attested | — |
| `has more bite` | attested | attested |
| `the cut in the tax rate` | attested | attested |

## Formatting

- **Prose, not bullets.** For reports, documents, technical documentation, and explanations, write
  prose without bullets, numbered lists, or excessive bolding, unless the person asks for a list or
  ranking. Use lists, bullets and formatting only when (a) asked, or (b) the content is multifaceted
  enough that they are essential for clarity.
- **No bold inline headers** opening a paragraph (`**The objection.** Text follows…`, `#strong[…]`,
  `\textbf{…}`). Use a prose topic sentence, an italic label, or a real heading. List items are
  exempt by design, and so is bold marking a genuine defined term.
- **No bold on bare numbers.** Emphasise the claim, not the digits. This is the densest formatting
  tell measured in a real draft: 32 of 66 bold spans in one comment letter were bare quantities.
- **No emojis.** Ever, in a draft. (A slide deck is not a draft.)
- **No ALL-CAPS for emphasis** on ordinary words (`is NOT a separate cut`). Acronyms and table
  headers are fine.

## Before you call a draft done

Run the deterministic audit and cite span ids rather than re-reading by eye:

```bash
uv run --with lxml --with pyyaml python3 ~/projects/workflows/scripts/prose-audit.py \
  --json --style legal|econ|general <draft>
```

`hard` spans block; `soft` spans are advisory. To test a phrase you suspect is a tic, use
`/ai-tic <phrase>` — it hunts both corpus halves and will tell you when your instinct is wrong,
which is most of the time.
