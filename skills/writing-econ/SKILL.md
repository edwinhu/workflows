---
name: writing-econ
description: "ALWAYS load BEFORE drafting, revising or grading FINANCE or ACCOUNTING journal prose — 'write the paper', 'draft the introduction of my JF submission', 'revise Section 3', 'polish the job-market paper', 'does this read like a finance paper', 'tighten the abstract', 'is this well written for JFE/RFS/JAR/TAR', 'should I write we find or the paper shows', 'do I cross-reference by Section or Part', 'is agents jargon'. Covers Journal of Finance, JFE, RFS, Journal of Accounting Research, The Accounting Review, JAE, CAR, RAST, and the working and job-market papers aimed at them. This skill carries ONLY what is additional to the base register: load `writing-general` alongside it — the diction, tic, vindicated-phrase and formatting rules live there and are assumed here. Do NOT load this for a law review article or legal scholarship (use `writing-legal`) or for a comment letter, memo, brief or professional email (`writing-general` alone) — importing a finance rule into either of those makes the prose worse."
user-invocable: false
---

# Econ register (`econ`)

**The base is `writing-general`, and it is assumed loaded alongside this file.** Everything below is
what is *additional* for finance and accounting journal prose. Nothing from the base is restated
here.

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

The source guide is McCloskey's *Economical Writing*, vendored in full at
`${CLAUDE_PLUGIN_ROOT}/skills/writing/references/economical-writing-full.md` — read it there for the
full text of any rule below. **Where this file and that guide disagree, this file controls.**
McCloskey's prescriptions were checked against the same corpora and sorted three ways.

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

Beyond the shared list in `writing-general`: `we acknowledge that` runs **72.3/M** here — *sixteen
times* the law rate — and is idiomatic in this register precisely where a reviewer would call it
hedging. `Of course,` runs 299.9/M. `To be sure,` is rarer here (11.5/M) than in law but is still
attested and still not an AI tell.
