---
name: writing-general
description: "ALWAYS load BEFORE writing or revising any serious prose a human will read — 'write the memo', 'draft the comment letter', 'draft this section', 'polish the brief', 'revise this email', 'tighten the introduction', 'is this well written', 'review my prose', 'fix the writing here', 'make this sound less like AI', 'should I say we or the paper'. This is the BASE register: the Strunk-derived diction rules, the prohibited-construction tic table, the vindicated phrases and the formatting rules that hold for every domain, plus the register for prose that is neither a law review article nor a journal submission (comment letters, memos, briefs, white papers, board memoranda, professional email). Load it before the first sentence is written, not after. For a T14 law review article or legal scholarship carrying footnotes, load `writing-legal` ALONGSIDE this one; for a finance or accounting journal submission or job-market paper, load `writing-econ` alongside this one — those two carry only what is ADDITIONAL to this base and are useless without it."
user-invocable: false
---

# Writing register — the base

**This skill is the base every writing task loads.** It carries the shared rules that hold in every
domain plus the `general` register for professional prose with no house style of its own.

Two domain skills sit on top of it and carry only what is *additional*:

- **`writing-legal`** — T14 law review articles, student notes, legal scholarship with footnotes.
- **`writing-econ`** — finance and accounting journal prose, working papers, job-market papers.

Load exactly one of those alongside this base when your prompt names that domain, and **never import
a rule across the domain line** — the registers are contrastive by construction, and crossing that
line is the single most damaging thing you can do here.

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

# The shared base — applies to all three registers

## The base layer: Strunk, run through the corpora

The source guide is Strunk & White, *The Elements of Style*, vendored in full at
`${CLAUDE_PLUGIN_ROOT}/skills/writing/references/elements-of-style.md` — read it there for the full
text of any rule below. **Where this file and that guide disagree, this file controls**: its
prescriptions were checked against all 14,294,148 sentences of the combined corpora and split three
ways. **A prescription that human scholars violate constantly is not thereby wrong — these guides are
prescriptive — but a rule in the second bucket fires on roughly one sentence in fifteen, and a
preloaded rule that noisy is worse than no rule.**

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

## Prohibited constructions — owned by `ai-anti-patterns`

The tic dictionary lives in the `ai-anti-patterns` skill, which every prose agent loads alongside
this one; `prose-audit.py` flags each entry with a span id, so cite the span rather than re-scanning
by eye. `/ai-tic <phrase>` is how a candidate becomes a rule — it runs the FP-hunt against both
corpus halves and refuses anything over that threshold. Do not restate tics here: a second
copy cannot be regenerated from the dictionary and goes stale silently.

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
- **No bold on bare numbers.** Emphasize the claim, not the digits. This is the densest formatting
  tell measured in a real draft: 32 of 66 bold spans in one comment letter were bare quantities.
- **No emojis.** Ever, in a draft. (A slide deck is not a draft.)
- **No ALL-CAPS for emphasis** on ordinary words (`is NOT a separate cut`). Acronyms and table
  headers are fine.
- **Do not hard-wrap prose for a soft-wrapping reader.** The test is who reads the text, not the
  file extension.
  - **Soft-wrapping reader** — an email body, an Obsidian note, a web form, a chat message,
    anything *rendered* rather than read as source: **one paragraph, one line**, no manual breaks
    at any column. Those readers reflow to the pane, so breaks at 80 (or any) columns land
    mid-sentence at whatever width the reader uses, and a one-word edit turns into a re-wrap of
    the whole paragraph. Let the editor wrap it.
  - **Fixed-width reader** — a commit message (72 columns by convention), a code comment, a
    `SKILL.md`, a `.typ` or `.tex` source file: wrapping is correct. Keep it. This file is wrapped
    at ~100 columns for exactly that reason, and `prose-audit.py` exempts such sources by name,
    suffix and frontmatter shape rather than flagging its own register.

## Before you call a draft done

Run the deterministic audit and cite span ids rather than re-reading by eye:

```bash
uv run --with lxml --with pyyaml python3 ~/projects/workflows/scripts/prose-audit.py \
  --json --style legal|econ|general <draft>
```

`hard` spans block; `soft` spans are advisory. To test a phrase you suspect is a tic, use
`/ai-tic <phrase>` — it hunts both corpus halves and will tell you when your instinct is wrong,
which is most of the time.
