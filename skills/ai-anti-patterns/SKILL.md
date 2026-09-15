---
name: ai-anti-patterns
description: ALWAYS load before finalizing ANY written prose, and whenever text is suspected of being machine-written - "does this sound like AI", "make this sound human", "clean up the AI-isms", "did a bot write this", "check this draft before I send it", "review this for AI tells", "this reads like ChatGPT", "review this for mannered prose", "is this too writerly", "is this student paper AI-generated", or before handing back any draft, memo, email, or article you wrote. Use proactively even if the user never mentions AI writing.
user-invocable: false
---

# AI Writing Anti-Patterns

**What this skill carries** — grep `references/` for any subject the names below miss:
!`skill-toc ${CLAUDE_SKILL_DIR}`

Field guide for detecting and revising AI-generated content indicators based on Wikipedia's "Signs of AI writing" guide.

## When to Use

Invoke this skill:
- Before finalizing ANY AI-assisted writing
- When reviewing text for AI writing indicators
- When editing content to sound more natural
- After completing writing tasks (automatic via hooks)

## The Iron Law

**Check every piece of AI-assisted writing against these patterns before submission.**

This is not optional. AI writing patterns are detectable and undermine credibility.

## Quick Screening Order

Start with the most objective indicators:

| Priority | Section | What to Check |
|----------|---------|---------------|
| 1 | ChatGPT Artifacts | `turn0search0`, `oaicite`, `contentReference` |
| 2 | Citation Problems | Hallucinated DOIs, dead links, non-existent sources |
| 3 | Prompt Refusals | "As an AI language model...", "I hope this helps" |
| 4 | Puffery | "stands as a testament to", "rich tapestry", "nestled" |
| 5 | Structure | Section summaries, "Despite challenges", rule of three |
| 6 | Mannered Prose | Metaphor where a literal phrase was available (see below) |

## Critical Patterns to Avoid

### CRITICAL Severity (Immediate Revision Required)

These patterns are unambiguous AI artifacts:

**ChatGPT-Specific Artifacts:**
- `turn0search0`, `turn1search2` (internal search references)
- `oaicite:X` (citation placeholders)
- `contentReference[oaicite:X]` (unresolved references)
- JSON attribution blocks in output

**Prompt Refusals:**
- "As an AI language model..."
- "I cannot provide..."
- "I hope this helps!"
- "I hope this email finds you well"

### HIGH Severity (Strong Revision Recommended)

**THE SHIPPED LIST IS `~/.claude/skills/ai-tic/linter/tics.yaml`, NOT THIS TABLE.** That file holds
both halves — the tics that cleared the ~0-human-rate gate against 14,294,148 sentences, and a
`rejected:` block naming the phrases that did not, so they are not re-proposed. Six phrases were
listed here as AI tells while sitting in that `rejected:` block: `serves as` (141.35/M),
`it is important to note that` (44.42/M), `plays a crucial/vital/key role` bare (21.94/M),
`delve into` bare (11.69/M), `underscores the importance` (5.93/M), and `Of course,` (386.94/M).
They are gone from the tables below and from every executable table in the repo. This is the same
correction the User-Voice section thirty lines down already made for a different list — *"Keep
these as voice preferences if you like them … Do not present them as AI detection."* — applied to
this one. To check a phrase, run `/ai-tic <phrase>`; do not add a row here.

**Puffery and Exaggeration** (those that cleared the gate):
- "stands as a testament to"
- "rich tapestry of"
- "nestled in/among"
- "the landscape of"

**Promotional Language:**
- "groundbreaking", "transformative", "revolutionary"
- "unparalleled", "unprecedented"
- "cutting-edge", "state-of-the-art"

### MEDIUM Severity (Review and Consider)

**Structural Patterns:**
- Section summaries that repeat the heading
- "Despite [challenge], [positive outcome]" formula
- Negative parallelisms: "However... Nevertheless..."
- Rule of three: exactly three examples every time
- Weasel wording: "some experts say", "it is believed"

**Stylistic Quirks:**
- False precision — a summarising figure carried to spurious decimal places
  ("a rate of 1.3771 percent", "covering 85.63 percent of the universe").
  Prefer a high-level fraction in the abstract and introduction, where a figure
  summarises rather than reports; keep the exact value next to the exhibit that
  backs it. Enforced as `style·false_precision`.
- Elegant variation (synonym cycling to avoid repetition)
- False ranges ("from X to Y" without real data)
- Title Case In All Headings
- Em dash overuse (—)
- Excessive boldface for emphasis

### User-Voice Preferences (NOT AI tells — corpus-checked 2026-08-05)

**This section is a personal style preference, not a linter, and the name it used to carry
("User-Voice Lint") was doing real damage.** Nothing here was ever in an executable table, so a
`writing-verify` pass ran every scorer and knew none of these phrases — while the heading implied
four enforced rules. Three of the four have now been measured against 14,294,148 sentences of human
scholarship (8.73M finance/accounting + 5.56M law review) and they are **normal human prose**:

| phrase | finance | law | verdict |
|---|---|---|---|
| `has bite` / `have more bite` | 1.9/M | 5.2/M | **human** — incl. a law review title, *"Do the SEC's New Rating Agency Rules Have Any Bite?"* |
| `the cut` (regulatory reduction) | 8.7/M | 4.7/M | **human** — *"the cut in the corporate tax rate"* |
| `Of course,` | 299.9/M | 523.7/M | **human** |
| `To be sure,` ← *this section used to recommend it* | 11.5/M | **194.0/M** | **human**, and 3× commoner in law reviews than what it replaces |
| `Admittedly,` | 15.5/M | 63.3/M | **human** |
| `cuts against` | 0.9/M | 13.1/M | **human** |

Keep these as voice preferences if you like them — they are unfalsifiable and that is fine. Do not
present them as AI detection. Full record: `docs/investigations/2026-08-05_emphasis-enforcement.md`.

**What DID survive the gate**, and is now enforced as a span:

- `ai-tic·sev3·rule-bites` — *"the reform should bite hardest"*. The **verb** is unattested
  (1/14.29M, and that hit is a cited *Financial Times* headline in a footnote). The **noun** above
  is not. That noun/verb split is the whole rule.
- `ai-tic·sev2·sharpest-version` — *"the sharpest version of the objection"*. 0/14.29M, while all
  four hits of `<superlative> version of` are *"the **strongest** version of"* and `the sharpest
  <noun>` at large is 86 hits. The word is ordinary; the collocation is the tell.

**Bridge repetitions** remain the one genuinely enforced entry from the old list —
`skills/writing-verify/scripts/bridge_repetition_check.py`, invoked from
`workflows/writing-verify.js`. It is real logic over section openings, not a phrase table.

**To check a phrase yourself:** `/ai-tic <phrase>` — it runs the FP-hunt against both corpus halves
and refuses to add anything over the eligibility gate.

## How to Revise

### For Puffery

| AI Pattern | Human Alternative |
|------------|-------------------|
| "stands as a testament to" | "shows" or "demonstrates" |
| "rich tapestry of" | describe specifically what it contains |
| "nestled in the heart of" | "in" or "located in" |

### For Structure

| AI Pattern | Human Alternative |
|------------|-------------------|
| Section summary of heading | Start with substance, not meta-commentary |
| "Despite challenges..." | State the reality directly without formula |
| Exactly three examples | Use the number that fits: 2, 4, 5, or just 1 |

### For Mannered Prose

**Definition (Anthropic guidance — quoted, do not paraphrase):**

> Mannered prose substitutes metaphor and flourish for direct statement. Instead of "a parameter
> worth varying," the mannered writer produces "a dial worth turning." Instead of "this point still
> matters," they write "this point earns its keep." The phrases exist to display the writer, not to
> convey the idea, and readers can tell. That is why mannered prose irritates: it makes the reader
> work harder so the writer can perform. It is also imprecise. Metaphors drag in connotations the
> writer did not choose and cannot control. The fix is to say what you mean. When a literal phrase
> is available, use it.

The short form — **"Please remove all mannered prose"** — works on its own and is often enough.

**The mechanism is metaphor-for-literal substitution.** That is narrower than "flourish" generally:
the test is whether a literal phrase was available and passed over. "A dial worth turning" for "a
parameter worth varying" is mannered; a long sentence is not, and an ornate one is *purple*, a
different fault. Puffery inflates ("stands as a testament to"); mannered prose performs.

**The imprecision is the load-bearing objection, not the irritation.** A metaphor imports
connotations the writer did not choose: "the bar routed around the holding" implies coordinated
evasion, where "lawyers filed the same claims as mootness-fee requests" makes no claim about
motive. Revising for taste alone misses that the mannered version often asserts something the
writer cannot support.

**The revision, in order:**

1. Replace every mannered phrase with the literal thing it avoided.
2. Table each swap: the flourish, the plain version, and **the connotation it smuggled in**.
3. Name the habit the writer repeats most.

**The three constraints — violating any makes the pass worse than not running it:**

- **Keep the meaning and the structure.** A diction pass, not a rewrite.
- **Leave direct sentences untouched.** A sentence with no metaphor has nothing to swap.
- **Don't shorten for its own sake.** Literalness is the goal, not brevity. A plain replacement
  that runs longer than the flourish is still the right replacement.

**Why the table is the deliverable, not just the edits.** The third column is the point. Listing
swaps without naming what each smuggled in hides the substantive change. And naming the repeated
habit matters more than any single swap: individual metaphors are cheap to fix and recur
immediately, while the habit is the thing the writer can act on.

**A related failure, one level up (supporting research, not the definition).** Density, not the
device, is what makes rhetorical figures read as machine-written: *"The problem is not that LLMs
use these techniques: it's that they're so robotically consistent in how they use them that it
becomes an abuse… What the LLM lacks is not technical ability, but taste"* (Colin Gorrie, *Why
ChatGPT writes like that*). The figures to watch are **antithesis** ("not X, but Y"),
**tricolon**, **isocolon**, and unearned profundity. A balanced two-part closer at the end of
every section is this failure, not metaphor substitution — so it is out of scope for the swap
table above, and needs naming as a habit instead.

**Model note.** Claude Fable 5.1 writes denser prose than Fable 5 — longer sentences, fewer
paragraph breaks. Defining the anti-pattern in a user message (preferred) or the system prompt is
the documented mitigation.

### For False Precision

A figure in the abstract or introduction is SUMMARISING; a figure beside its table is REPORTING.
Only the second earns its decimal places. Carrying four of them into a summary implies a precision
the estimate does not have and reads as machine output.

| AI Pattern | Human Alternative |
|------------|-------------------|
| "a rate of 1.3771 percent" | "about one and a half percent" |
| "roughly ten times the 2.7361 percent rate" | "roughly ten times the abstention-wide rate" |
| "6,612 of 575,553 testable items — 1.15 percent — fall below" | "about one percent of testable items fall below" |
| "covering 85.63 percent of the testable universe" | "covering roughly six in seven of the testable universe" |
| "the 28.3328 percent figure" | "that figure" |

Exceptions the rule already carries, and which must stay exceptions: exact values inside a table,
figure caption, code block or footnote; years, statutory and rule cites, docket, page and version
numbers; and money where the cents are the point.

### For Promotional Language

| AI Pattern | Human Alternative |
|------------|-------------------|
| "groundbreaking" | describe what it actually does |
| "revolutionary" | compare to what came before |
| "cutting-edge" | specify the technology |
| "transformative" | show the transformation with evidence |

## Reference Files

For detailed patterns and extensive examples, consult:

**THE "ENFORCED BY" COLUMN IS THE POINT OF THIS TABLE.** Eleven chapters listed as reference
material reads as eleven chapters of coverage; it is not. Four of them have no executable module
and are marked reference-only here so nobody has to rediscover the gap by shipping a draft through
a clean review pass. (That is exactly how chapter 05's boldface entry went unenforced until
v5.134.0 — see `docs/investigations/2026-08-05_emphasis-enforcement.md`.)

| File | Contents | Enforced by |
|------|----------|-------------|
| `references/_index.md` | Overview and quick screening guide | — |
| `references/01-puffery-and-exaggeration.md` | "Stands as", superficial analyses | `wikipedia-puffery` |
| `references/02-promotional-language.md` | "Rich tapestry", disclaimers | `wikipedia-promotional` |
| `references/03-structural-patterns.md` | Section summaries, negative parallelisms | `wikipedia-structural` |
| `references/04-stylistic-quirks.md` | Elegant variation, false ranges | **reference only** — regexable, but must clear the ai-tic corpus gate first |
| `references/05-formatting-and-typography.md` | Boldface, em dashes, emojis | `emphasis`, `formatting`, `em-dash` (boldface/emoji since v5.134.0); inline-header lists partly |
| `references/06-communication-patterns.md` | Subject lines, "I hope this helps" | `wikipedia-communication` |
| `references/07-template-artifacts.md` | Mad Libs patterns, placeholders | `wikipedia-template-artifacts` |
| `references/08-markup-issues.md` | Markdown vs wikitext confusion | **reference only** — wikitext-specific; no in-repo analogue |
| `references/09-chatgpt-specific-artifacts.md` | turn0search, oaicite | `wikipedia-chatgpt-artifacts` |
| `references/10-citation-problems.md` | Hallucinated DOIs, dead links | **reference only** — covered better by `skills/cite-check` + `skills/source-verify` and the `cite-fidelity-*` constraints, which check citations against sources rather than pattern-matching them |
| `references/11-meta-indicators.md` | Abrupt cutoffs, style discrepancies | **reference only** — judgement; lives in the `user-agents/writing-reviewer.md` rubric |

Every named system is a `scripts/prose-audit.py` system, so a finding from it carries a span id.
A chapter marked **reference only** produces no span, which by THE READER'S RULE means anything it
surfaces is judgement, not a deterministic finding.

## Automatic Detection

This plugin includes PostToolUse hooks that automatically scan Write/Edit output for anti-patterns. When patterns are detected:

1. Hook emits a warning with specific patterns found
2. Claude immediately revises the content
3. Revision removes or replaces flagged patterns

The hook checks for all CRITICAL and HIGH severity patterns automatically.

## Review Facts

- A user's style request ("make it punchy", "professional tone") is a request for an outcome, not for AI-smell — delivering it with puffery, hedges, or bold-emphasis patterns intact ships text that reads as obviously AI-generated and damages the user's credibility.
- Skimming is not checking. The check is sentence-by-sentence against the pattern list; a skim that lets puffery pass because flagging it felt pedantic presents unreviewed text as reviewed — an unverified claim.

## Key Principles

From Wikipedia's guide:

1. **These are signs, not proof** - Multiple indicators strengthen the case
2. **Context matters** - Some patterns appear in human writing too
3. **Focus on deeper issues** - Surface defects point to synthesis and quality problems
4. **Don't rely on detection tools** - Human judgment required

## Related Skills

- `/writing` - Core writing principles from Elements of Style
- `/writing-legal` - Legal writing (Phase 2)
- `/writing-econ` - Economics writing (Phase 2)
