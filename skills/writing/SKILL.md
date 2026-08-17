---
name: writing
description: Long-form writing — articles, essays, briefs and chapters — run through craft with a computed plan-grammar and citation gate. Use when the user says "write the article", "draft this section", "outline the paper", "turn these notes into prose", "/writing", or wants a document taken through clarification, an approved plan, delegated drafting, independent verification and human review.
argument-hint: 'the document, article or chapter to write'
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Monitor]
---

# writing — a document, run through craft with a computed grammar and citation gate

The lifecycle is [craft](${CLAUDE_PLUGIN_ROOT}/skills/craft/SKILL.md). Read it and follow it.
This file is a **delta**: it supplies the domain — the CLARIFY axes, the plan grammar, the lenses,
the mechanical checks, the refs, the authority text. It ships no `workflow.js` and restates none of
craft's mechanics.

What makes a run `writing` rather than plain craft is one thing craft cannot supply: **a PLAN
GRAMMAR that a program parses.** Eight required headings, stable `CLAIM-NN` ids, a total
claim→section map and a section-outputs table are read by
`scripts/writing_section_index.py`; the drafts are then checked against that parse by
`scripts/writing_gate_probe.py` and `scripts/writing_prose_gate.py`. Craft's JS reads their exit
codes.

## Write surface

Main chat clarifies, plans and dispatches. It does not write the document. It never creates or edits
a file under the writing project's `drafts/`, `outlines/` or `references/` — not by Write/Edit, and
not by Bash (`cat >`, a heredoc, `sed -i`, `tee`). Drafting runs in a dispatched agent. Craft's
dispatch is already structural and its judges are pinned to `Explore`, so this is a rule on you, not
a hook — a skill-frontmatter hook is measured not to reach dispatched agents, so there is nothing to
attach it to.

## Phase 1 — CLARIFY

Craft's Phase 1, on these axes.

<EXTREMELY-IMPORTANT>
**ASK BEFORE YOU DRAFT, AND GATHER SOURCES BEFORE YOU CLAIM. This is not negotiable.**

Prose written before the thesis is settled anchors the argument to whatever sentence came out first,
and every later correction has to fight it. **Training-data recall is not a source.** A citation you
remember is a claim about a document nobody opened; source gathering goes through the
`workflows:librarian` agent and must materialise real artifacts under the writing project's
`references/`, with a bibliography file the gate can resolve keys against.
</EXTREMELY-IMPORTANT>

| Axis | Establish with the user |
|---|---|
| Thesis | The single claim the document argues, or the angle if it is not an argument |
| Audience | Who reads it, what they already accept, and what would persuade them |
| Purpose | The decision, submission or publication the document serves |
| Scope | Length, venue, format, deadline, and what the document covers |
| Exclusions | What is deliberately out of the argument, and must not creep in |
| Domain | `legal` \| `econ` \| `general` — selects the style guide each drafting task loads and the prose gate's `--style` |
| Sources | What must be cited, what already exists, and what the librarian must go find |
| Deliverables | The outline files, the draft files, and the assembled document |
| Evidence | What makes each section credible: a pinned source, a quoted authority, or user judgment |
| Review surfaces | What the user will actually read at Phase 5 |

Ask in one `AskUserQuestion` call when answers are independent. Ask cascading questions separately:
the venue decides the length, and the length decides the section count.

Craft's remaining axes are taken as craft states them, with two domain bindings: craft axis 4
(observable success criteria) is answered by the four mechanical checks below — `GRAMMAR`, `CITE`,
`CLAIM` and `PROSE-HARD`, defined in
[`references/writing-checks.md`](${CLAUDE_PLUGIN_ROOT}/skills/writing/references/writing-checks.md)
— whose command strings become `mechanicalChecks` verbatim; craft axis 6 (third-party review) is
answered **not opted in**, so no `thirdParty` key is passed.

Then gather sources — **through the librarian, never from recall**. Dispatch the
`workflows:librarian` agent for each source area the plan will rely on, and have it leave real files
under the writing project's `references/` plus the bibliography entries the Source Plan will name. A
source area the librarian could not fill is a planned evidence task, not a claim you write anyway.

## Phase 2 — PLAN

Craft's Phase 2. The plan must be written in the **required plan grammar** below, because
`scripts/writing_section_index.py` **parses it** and is the only canonical grammar parser — there is
no LLM discovery fallback and no second reader. A heading it cannot find is a section nothing checks.

### The required plan grammar

Exactly these eight headings, each appearing **once**, in this order:

```markdown
## Writing Intent
## Claims
## Counterarguments
## Document Structure
## Claim → Section Map
## Source Plan
## Section Outputs
## Review Surfaces
```

The arrow in `## Claim → Section Map` is U+2192 (`→`), never `->`; the parser matches the heading
literally.

Field rules, all enforced by the parser:

- **`## Writing Intent`** defines `Thesis:`, `Audience:`, `Purpose:`, `Hook:`, `Scope:` and
  `Domain:`. `Domain:` is one of `legal`, `econ`, `general`.
- **`## Claims`** defines the claim set with unique, stable `CLAIM-NN` identifiers. An id means the
  same claim for the life of the document; renumbering is a defect, not a tidy-up.
- **`## Counterarguments`** states the objections the document must meet, in the wording the
  `COUNTER` check will look for.
- **`## Document Structure`** carries one ordered `### Section Name` per output section. Duplicates
  are refused, and the order here is the drafting order.
- **`## Claim → Section Map`** is a table with exactly the columns `Claim` and `Section`, giving
  **one primary section per claim**. It must be total and single-valued: a claim with no section is
  undrafted, and a claim with two has no owner.
- **`## Source Plan`** defines `Bibliography:` (a project-contained, traversal-free path — the file
  every `CITE` check resolves keys against), `Notebook:`, `Notebook URL:` and `Key Sources:`. Write
  `none` for an intentional absence; the parser refuses an empty value.
- **`## Section Outputs`** is a table with exactly the columns `Section | Outline | Draft | Depends On`,
  in the same order as `## Document Structure`. `Outline` paths start with `outlines/`, `Draft` paths
  with `drafts/`, and every `Depends On` entry must point **backward**, to a section already named
  above it — a forward or circular dependency means no drafting order exists. Write `-` for none.
- **`## Review Surfaces`** lists, as bullets, what reviewers actually inspect at Phase 5.

Three further domain requirements on the plan:

- **`refs` per task row and per lens** — required, may be empty. Craft's spine does not validate it;
  `wc-probe` P7 refuses an absent key in THIS file, so a live run assembled from an approved plan is
  unchecked. Write `refs: []` to state "no domain rules" rather than omitting the key.
- **One task row per section**, drawn from `## Section Outputs` — its outline and its draft are that
  one row's work, never two rows. This is where the plugin's per-section drafting fan-out went: craft
  implements the rows sequentially against one tree and verifies each independently. Parallelism
  across sections is the acknowledged loss; a shared spine and a single gate are the gain.
- **`plansDirectory` is `"./.planning"`** for a writing project, so craft's approved plan is already
  the generated plan the parser authenticates. **Never copy it.**

## Phase 3 — GOAL

Craft's Phase 3 unchanged.

## On-disk layout and the literal invocations

Both runners refuse anything else, so this is a contract, not a convention. `<proj>` is the writing
project root.

| Path | What it is |
|---|---|
| `<proj>/.planning/<slug>.md` | craft's approved plan, hashed in place — **the** generated plan the parser authenticates. Never a copy; never the basename `PLAN.md`, which the parser rejects as legacy |
| `<proj>/.planning/.state/review.json` | the receipt, generated by `scripts/writing_receipt.py` from craft's own two approvals. The parser refuses to parse without it |
| `<proj>/.planning/ACTIVE_WORKFLOW.md` | written by the same shim, carrying `workflow: writing` and `style: <Domain>`. The parser reads it as legacy provenance, so the receipt must be well-formed for the layout to read canonical rather than `legacy-only` |
| `<proj>/outlines/…`, `<proj>/drafts/…` | the `Outline` and `Draft` paths `## Section Outputs` names **verbatim** |
| `<proj>/<bib>.bib` | the Source Plan `Bibliography:` path |

The receipt shim, run once after ExitPlanMode and before the craft dispatch:

```bash
uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_receipt.py \
  --project <proj> --plan <planPath> --plan-hash <craft plan hash> \
  --approved-session <the ExitPlanMode approval's session id> \
  --reviewer-session <the craft run id that authorizes implementation> --domain <legal|econ|general>
```

The three commands, quoted exactly as
[`references/writing-checks.md`](${CLAUDE_PLUGIN_ROOT}/skills/writing/references/writing-checks.md)
defines them — one per project for GRAMMAR and PROSE-HARD, one **per section** for CITE+CLAIM:

```
uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_section_index.py <proj>
```
`0` = grammar clean; `1` = violations, listed as JSON on stdout; `2` = usage. **A `2` is a check
defect, not a content failure** — the check did not run, and an unrun check is never a pass.

```
uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_gate_probe.py "<proj>/drafts/<Section>.md" --bib "<proj>/<bib>.bib" --plan "<proj>/.planning/<slug>.md" --plan-hash <craft plan hash>
```
`0` = pass; `1` = fail, with the offending keys and line numbers under `evidence`. One invocation per
section; the draft argument is the `Draft` cell of that section's `## Section Outputs` row, verbatim.
**QUOTE THE DRAFT PATH, always.** Section names carry spaces and parentheses
(`drafts/Part I. The Gap (Draft).md`); unquoted, the line dies with
`bash: syntax error near unexpected token '('` before python is reached. A probe runs its `cmd`
verbatim and no corrected re-run is permitted, so an unquoted template is a permanent gate defect.

```
uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_prose_gate.py --project <proj> --style <domain>
```
`0` = no hard-severity span; `1` = blocked; `2` = gate defect (missing or unrunnable engine,
unparseable output). Soft findings print as advisory and never set the exit code. `<domain>` is the
plan's `Domain:`. The wrapper invokes
`${CLAUDE_PLUGIN_ROOT}/scripts/prose-audit.py` **in place** — never forked, never modified,
that tree is read-only — under its own `uv run --with lxml --with pyyaml python3`, so this command
line does not carry those flags and must not gain them. **Never wire the engine's own exit code to
the gate:** it ends in `sys.exit(worst)` and so conflates hard with soft, which would block a run on
advisory puffery.

One worked in-tree fixture project, `fixtures/clean/`, is what every check runs against; it is
described at [`fixtures/README.md`](${CLAUDE_PLUGIN_ROOT}/skills/writing/fixtures/README.md).
The broken variants are **generated, not stored**:
[`scripts/writing_flip_test.py`](${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_flip_test.py)
copies the clean fixture once per check, applies exactly one defect, and asserts the check exits 0 on
clean, non-zero on the break, **and that the failure names its own subject** — the last of those
because exit-code-only assertions let a check pass while exercising a different dimension entirely.

## Phase 4 — the craft call

The args go in the plan's `<!-- craft:dispatch -->` arming block, and the dispatch is **craft's own
`craft-dispatch.sh`** — never a hand-written `farm.ts` line. That script owns the TIER 1 plan-lint
gate, which refuses to dispatch on a `major`/`critical` plan finding and fails CLOSED on a verdict it
cannot count; hand-rolling the invocation silently drops it. Craft owns the `Monitor` wait, the
result handling and the return shape too, and `craft-result.sh` reads the verdict. This run's
`projectDir` is the session repo, so craft's own run directory is already inside it and no
`--run-dir` override applies. There is no built-in `Workflow` call — the guard at
`~/.claude/hooks/main-thread-guard.sh` denies that tool outright.

**Pass `$PLAN` explicitly — the argument is not optional here.** Bare, `craft-dispatch.sh` resolves
the armed plan through `craft-pending.sh`, which looks only in `.claude/plans`; a writing project's
`plansDirectory` is `./.planning`, so a bare invocation exits 2 with "no armed craft run".

```bash
PLAN=<proj>/.planning/<slug>.md
bash ${CLAUDE_PLUGIN_ROOT}/skills/craft/scripts/craft-dispatch.sh "$PLAN"
```

```js
{
  projectDir,
  goal: "<one sentence>",

  // ONE ROW PER SECTION, drawn from the plan's ## Section Outputs, in that table's order — this is
  // the per-section fan-out, expressed as task rows. Outline and draft are the SAME row's work.
  // Every task carries refs. The style guide is selected by the plan's Domain: field — legal ->
  // volokh-distilled.md + formatting.md; econ -> economical-writing-full.md; general ->
  // elements-of-style.md — alongside writing-checks.md, which is unconditional on every row.
  tasks: [
    { id: "T1",
      name: "Section: <Section>",
      work: "Write <proj>/outlines/<Section>.md against the plan's Document Structure entry, pinning a Source Plan source to every beat, then expand it into <proj>/drafts/<Section>.md carrying the claims the Claim → Section Map assigns this section and citing only bibliography keys its outline pinned. DRAFT FRONTMATTER CONTRACT — the draft OPENS with YAML frontmatter carrying `implements: [CLAIM-NN, ...]`, exactly the claim set this section's Claim → Section Map row assigns it, and `plan_hash: <craft's current plan hash>`. writing_gate_probe.py enforces both (implementsMismatch / claimIdsMissing) and fails the section otherwise.",
      writablePaths: ["<proj>/outlines/<Section>.md", "<proj>/drafts/<Section>.md"],
      acceptance: "writing_section_index.py exits 0 for the project, writing_gate_probe.py exits 0 for this section's draft, and writing_prose_gate.py exits 0 for the project.",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/writing/references/writing-checks.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/writing/references/writing-outline-sync.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/writing/references/claim-id-traceability.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/writing/references/writing-topic-sentences.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/writing/references/volokh-distilled.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/writing/references/formatting.md"] },
    // ... one T-row per remaining row of ## Section Outputs. No second row for the draft.
  ],

  // The writing gate. GRAMMAR once for the project; CITE+CLAIM once per section (one probe settles
  // both); PROSE-HARD once for the project. Quoted byte-identically from references/writing-checks.md.
  mechanicalChecks: [
    { name: "grammar",
      cmd: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_section_index.py <proj>" },
    // The draft path is QUOTED — section names carry spaces and parentheses, and an unquoted
    // path dies in bash before python runs. A probe's cmd is verbatim; there is no re-run.
    { name: "cite-claim-<Section>",
      cmd: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_gate_probe.py \"<proj>/drafts/<Section>.md\" --bib \"<proj>/<bib>.bib\" --plan \"<proj>/.planning/<slug>.md\" --plan-hash <craft plan hash>" },
    // ... one cite-claim-<Section> entry per row of ## Section Outputs.
    { name: "prose",
      cmd: "uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_prose_gate.py --project <proj> --style <domain>" },
  ],

  // Judged BEFORE any drafter is dispatched; a surviving critical returns FAIL having written
  // nothing. The grammar lens parses the same headings writing_section_index.py does, so a malformed
  // plan is caught before every section is drafted against it.
  // Passing reviewLenses REPLACES craft's defaults, so the two defaults are spelled out here
  // rather than elided — an array of two would silently drop them.
  reviewLenses: [
    { key: "criteria-vs-artifacts",
      agentType: "Explore",
      refs: [],
      prompt: "Judge the deliverable strictly against the success criteria in the plan and goal: for each criterion, is there an artifact in the working tree that satisfies it? Missing or partial satisfaction is a finding." },

    { key: "scope-fidelity",
      agentType: "Explore",
      refs: [],
      prompt: "Judge scope fidelity: did the changes stay inside the plan's task table and writable paths? Out-of-scope edits, unrequested features, and silently skipped plan items are findings." },

    { key: "writing-judgement",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/writing/references/writing-checks.md"],
      prompt: "Judge ONLY the four checks no runner can settle, against the definitions in the refs. Read them in full first. COVER (every outline point expanded), FIDELITY (no claim beyond the sources its outline pinned), TRANSITION (each section's first and last sentences connect to its neighbours, in Document Structure order), COUNTER (every counterargument the plan names is answered in the prose). Report each as MODEL-EVALUATED with the evidence you actually read — the outline points inspected, the pinned source and what it supports, the quoted sentence pairs at each boundary, the counterargument's plan wording and where it is answered — and NEVER as PASS, which presents a judgement as a computation. Findings: a judgement you cannot support with evidence you actually read is itself a finding, never a pass. Severity: MAJOR at minimum for COVER, TRANSITION and COUNTER; CRITICAL for FIDELITY wherever the overreach reaches the thesis, the claim set or the sourcing — never minor, which would leave the gate passing over an unsupported claim." },

    { key: "source-fidelity",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/writing/references/cite-fidelity-no-handtyped.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/writing/references/cite-fidelity-source-inventory.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/writing/references/cite-fidelity-section-gate.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/writing/references/writing-citation-tense.md"],
      prompt: "Judge only the sourcing, against the rules in the refs. Read them in full first. Findings: a bibliography entry that corresponds to no artifact under the project's references/ — a citation recalled from training data is a claim about a document nobody opened; a quotation or pin cite that the referenced artifact does not contain; a source cited in a section its outline never pinned; a citation whose tense misstates the authority's current standing. Severity: MAJOR at minimum, CRITICAL where an unsourced or misattributed citation carries a claim the thesis rests on." },
  ],

  authorityExtra: [
    "IRON LAW OF WRITING PLANNING — ask before you draft, and gather sources before you claim. Training-data recall is NOT a source: every citation resolves to a real artifact under the project's references/ and to a key in the Source Plan Bibliography.",
    "IRON LAW OF WRITING VERIFICATION — no check result without the runner's own output. A mechanical check reported from reading the plan or the draft is the model certifying its own work. Every COMPUTED result is an exit code observed on this run.",
    "Never report GRAMMAR, CITE, CLAIM or PROSE-HARD from reading the code, and never report COVER, FIDELITY, TRANSITION or COUNTER as PASS — those four are MODEL-EVALUATED judgements and are reported as such, with the evidence read.",
    "The approved plan at .planning/<slug>.md is the authority and craft hashes it in place. It is never copied, never renamed to PLAN.md, and never edited mid-run — the runners re-verify its hash and stop on mismatch.",
    "The generated .planning/.state/review.json receipt is derived from craft's own two approvals. It is an artifact of craft's authority, never a competing one; do not treat it as a second gate and do not hand-edit it.",
    "DRAFT FRONTMATTER CONTRACT — every draft OPENS with YAML frontmatter carrying `implements: [CLAIM-NN, ...]`, exactly matching the claim set the plan's Claim → Section Map assigns that section, and `plan_hash: <craft's current plan hash>`. writing_gate_probe.py enforces both and fails the section otherwise; a draft with prose above its frontmatter has no frontmatter at all.",
    "Every command naming a draft QUOTES that path. Section names carry spaces and parentheses, and an unquoted path dies in bash before python runs — and a probe's cmd is run verbatim, with no corrected re-run.",
    "A section absent from the plan's ## Section Outputs is one nothing will check and cannot be claimed as drafted.",
    "The document is written by dispatched agents. Main chat writes nothing under the project's drafts/, outlines/ or references/, by any tool including Bash heredocs.",
    "Standing writing doer authority — every drafting task loads ${CLAUDE_PLUGIN_ROOT}/skills/writing/references/writing-checks.md plus the style guide the plan's Domain: field selects: legal -> volokh-distilled.md and formatting.md; econ -> economical-writing-full.md; general -> elements-of-style.md, all under ${CLAUDE_PLUGIN_ROOT}/skills/writing/references/.",
    "Rules: writing-checks.md defines all eight checks; writing-anchored-numbers.md, writing-citation-tense.md, writing-no-bold-lead.md, writing-outline-sync.md, writing-topic-sentences.md, writing-shortjournal.md and writing-stop-triggers.md are the prose constraints; claim-id-traceability.md and the six cite-fidelity-*.md files govern claim ids and sourcing. All under ${CLAUDE_PLUGIN_ROOT}/skills/writing/references/.",
  ].join("\n"),

  verifierAgentType: "Explore",
}
```

`verifierAgentType` and every lens `agentType` pin `Explore` because it has no Edit and no Write: a
judge that structurally cannot modify the tree beats a prompt asking it not to.

## Phase 5 — HUMAN REVIEW

Craft's Phase 5 unchanged, over the plan's `## Review Surfaces`. A clean technical verification is
evidence for that conversation, not human acceptance.

## Red flags

| Situation | Wrong move | Right move |
|---|---|---|
| Needing a source | cite what you remember | recall is not a source — dispatch `workflows:librarian` and make it leave a real artifact under `references/` |
| The plan's location | copy craft's plan into `.planning/` | set `plansDirectory` to `./.planning` so craft's plan already IS the parsed one; a copy drifts from what the user approved |
| Naming the plan file | `PLAN.md` | the parser rejects that basename as legacy — use the slug plan mode wrote |
| Building the task table | an outline row and a draft row per section | one row per section: outline and draft are the same row's work, and splitting them doubles the fan-out this port exists to collapse |
| A section named only in prose | expect the gate to find it | a runner cannot open what it was never told about — add its row to `## Section Outputs` before approval |
| `writing_section_index.py` exits `2` | read it as a content failure | that is a usage exit: the check did not run, and an unrun check is never a pass |
| Wiring the prose gate | `prose-audit.py` straight into `mechanicalChecks` | it ends in `sys.exit(worst)` and would block on advisory puffery — `writing_prose_gate.py` is the only sanctioned path |
| Running the prose gate | add `--with lxml --with pyyaml` to the gate's own command | the wrapper already runs the engine under them; the gate's command line is the one quoted in `references/writing-checks.md`, byte for byte |
| `COVER`/`FIDELITY`/`TRANSITION`/`COUNTER` | report them as `PASS` | that presents a judgement as a computation — `MODEL-EVALUATED` with the evidence read |
| Sections that could be drafted in parallel | fan out drafters | IMPLEMENT is sequential by design — one row per section, one shared tree, one gate |
| Project state | write a `SPEC.md`, `STATE.md` or `NOTES.md` | competing state makes progress ambiguous — the approved plan is the authority and craft hashes it |
| Something craft does not obviously do | write a `writing/workflow.js` | ask which craft parameter is missing — `tasks[]` + `mechanicalChecks` is what turned the per-section fan-out into rows and the runners into the gate |
