---
name: writing
description: ALWAYS use for ANY substantial prose a human will read - "write the article", "draft this section", "outline the paper", "turn these notes into prose", "write up the memo", "draft the comment letter", "write the brief", "expand this into a chapter", "I need a few pages on X", "put this argument in writing", "/writing". Use proactively even when the user asks casually and never says "article" - do not start drafting paragraphs first. NOT for code, data work or course materials.
argument-hint: 'the document, article or chapter to write'
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Monitor]
---

# writing — a document, run through craft with a computed grammar and citation gate

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

The lifecycle is [craft](${CLAUDE_SKILL_DIR}/../work/SKILL.md). Read it and follow it.
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
not by Bash (`cat >`, a heredoc, `sed -i`, `tee`). The one exception is
`writing_bench_compile.py` under Phase 2 Path A, which is a compiler, not an author. Drafting runs in
a dispatched agent. Craft's
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
| Planning surface | `bench` (default) or `plan file` — where the outline gets authored |

`bench` is the recommended answer and Phase 2's default path; `plan file` is the escape hatch for a
document short enough that an artifact is overhead.

Ask in one `AskUserQuestion` call when answers are independent. Ask cascading questions separately:
the venue decides the length, and the length decides the section count.

Craft's remaining axes are taken as craft states them, with two domain bindings: craft axis 4
(observable success criteria) is answered by the four mechanical checks below — `GRAMMAR`, `CITE`,
`CLAIM` and `PROSE-HARD`, defined in
[`references/writing-checks.md`](${CLAUDE_SKILL_DIR}/references/writing-checks.md)
— whose command strings become `mechanicalChecks` verbatim; craft axis 6 (third-party review) is
answered **not opted in**, so no `thirdParty` key is passed.

Then gather sources — **through the librarian, never from recall**. Dispatch the
`workflows:librarian` agent for each source area the plan will rely on, and have it leave real files
under the writing project's `references/` plus the bibliography entries the Source Plan will name. A
source area the librarian could not fill is a planned evidence task, not a claim you write anyway.

## Phase 2 — PLAN

Craft's Phase 2. The plan opens with frontmatter `workflow: writing` — required, so a context clear
at approval resumes here and not in craft.

The plan must be written in the **required plan grammar** below, because
`scripts/writing_section_index.py` **parses it** and is the only canonical grammar parser — there is
no LLM discovery fallback and no second reader. A heading it cannot find is a section nothing checks.

That grammar is the **contract both planning surfaces satisfy**. Path A (bench) reaches it through a
compiler; Path B (plan file) reaches it by writing the plan. Either way ExitPlanMode approves a plan
the parser accepts, and nothing downstream can tell which path produced it.

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
- **`plansDirectory` is `"./.planning"`** for a writing project — so craft's
  approved plan is already the generated plan the parser authenticates. Craft honours whatever the
  setting says (default `.claude/plans`), so read the configured value rather than assuming this
  one. **Never copy the plan.**

### Path A — bench (default)

<EXTREMELY-IMPORTANT>
**THE OUTLINE IS THE USER'S, NOT YOURS. Claude PROPOSES; only text the user ACCEPTS compiles.**

Authoring both the outline and the detailed outline yourself, and reducing the user to approving at
ExitPlanMode, is what this path exists to end. It is not faster — it hands the user an argument they
did not make and must now argue with.
</EXTREMELY-IMPORTANT>

Main chat, in order:

1. **Publish** `${CLAUDE_SKILL_DIR}/assets/bench.html` with the `Artifact` tool,
   `capabilities: {"db": {}, "sample": {}}`. Persona agents hold no `Artifact` tool, so this is
   main-chat work by construction, not a delegation you forgot to make.
2. **Seed it** — `write_db` to collection `plan`, doc `bench`: the CLARIFY answers as `intent`
   (`thesis`, `audience`, `purpose`, `hook`, `scope`, `domain`, `genre`), the librarian's returned
   sources as `sources` `[{id, key, cite, artifact}]`, and `srcmeta.bibliography`. **The user never
   retypes the interview into the bench.**
3. **Hand over the URL and STOP.** The user outlines level 1, then level 2; Claude proposes in-page;
   the user accepts. This is a real wait for a human — not a poll, not a loop, not a timeout.
4. **On the user's go-ahead**, `read_db` the doc to a file and compile:

   ```bash
   uv run python3 ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/writing_bench_compile.py \
     --bench <file> --project <proj> --slug <slug>
   ```

   A non-zero exit is **not a failure to work around**. It names the unaccepted nodes, unpinned
   sources or missing artifacts by outline position; the answer is to tell the user what to fix in
   the bench and wait again.
5. **Verify and approve** — `writing_section_index.py` exits 0 for the project, then ExitPlanMode on
   the **compiled** plan.

The bench URL is recorded as a `Bench URL:` line in the body of
`<proj>/.planning/ACTIVE_WORKFLOW.md` — the existing file, never a new one. `writing_receipt.py`
rewrites that file, so re-append the line after the receipt shim runs.

### Path B — plan file

Write the plan in the grammar above and approve it at ExitPlanMode. Unchanged.

### The Write-surface rule, reconciled

Main chat never **authors** outline or draft prose. Running
`writing_bench_compile.py` — a deterministic compiler emitting the user's own accepted outline — is
not authoring, and it is the **only** sanctioned main-chat write under `outlines/`. Prose is still
written only by dispatched agents.

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
[`references/writing-checks.md`](${CLAUDE_SKILL_DIR}/references/writing-checks.md)
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
`${CLAUDE_SKILL_DIR}/../../scripts/prose-audit.py` **in place** — never forked, never modified,
that tree is read-only — under its own `uv run --with lxml --with pyyaml python3`, so this command
line does not carry those flags and must not gain them. **Never wire the engine's own exit code to
the gate:** it ends in `sys.exit(worst)` and so conflates hard with soft, which would block a run on
advisory puffery.

One worked in-tree fixture project, `fixtures/clean/`, is what every check runs against; it is
described at [`fixtures/README.md`](${CLAUDE_SKILL_DIR}/fixtures/README.md).
The broken variants are **generated, not stored**:
[`scripts/writing_flip_test.py`](${CLAUDE_SKILL_DIR}/scripts/writing_flip_test.py)
copies the clean fixture once per check, applies exactly one defect, and asserts the check exits 0 on
clean, non-zero on the break, **and that the failure names its own subject** — the last of those
because exit-code-only assertions let a check pass while exercising a different dimension entirely.

## Phase 4 — the craft call

The args go in the plan's `<!-- craft:dispatch -->` arming block, and the dispatch is **craft's own
`work-dispatch.sh`** — never a hand-written runner line. That script owns the TIER 1 plan-lint
gate, which refuses to dispatch on a `major`/`critical` plan finding and fails CLOSED on a verdict it
cannot count; hand-rolling the invocation silently drops it. Craft owns the `Monitor` wait, the
result handling and the return shape too, and `work-result.sh` reads the verdict. This run's
`projectDir` is the session repo, so craft's own run directory is already inside it and no
`--run-dir` override applies. There is no built-in `Workflow` call — the guard at
`~/.claude/hooks/main-thread-guard.sh` denies that tool outright.

**Pass `$PLAN` explicitly.** Bare, `work-dispatch.sh` resolves the armed plan through
`work-pending.sh`, which now reads `plansDirectory` — so a writing project's `./.planning` plan is
found. Naming the path still beats relying on that resolution when you already know it.

```bash
PLAN=<proj>/.planning/<slug>.md
bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/work-dispatch.sh "$PLAN"
bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/work-dispatch.sh --provider codex "$PLAN"   # "run this through codex"
```

**Forward the provider.** A provider named in this skill's `$ARGUMENTS`, however it is spelled —
`--provider codex`, `--dispatch codex`, "run this on gpt" — is `--provider codex` on the line
above. `--provider` is the only spelling the scripts take, and both reject the others by name.
Omitting it silently runs the user's codex request on claude.

```js
{
  projectDir,
  goal: "<one sentence>",

  // ONE ROW PER SECTION, drawn from the plan's ## Section Outputs, in that table's order — this is
  // the per-section fan-out, expressed as task rows. Outline and draft are the SAME row's work.
  // Every task carries refs. Drafting rows load skills/writing-general/SKILL.md — the base register
  // for every Domain — plus skills/writing-legal/SKILL.md or skills/writing-econ/SKILL.md when the
  // plan's Domain: field names one of those, alongside writing-checks.md, which is unconditional on
  // every row. The raw style guides are NOT loaded for drafting: the register supersedes them and
  // overrides three of their rules.
  // PATH A (bench): the outline files already exist and are the USER'S WORK. The row drafts
  // AGAINST them and writes drafts/<Section>.md ONLY.
  //   work: "Expand <proj>/outlines/<Section>.md — the user's accepted outline, which you must NOT
  //          edit or 'improve' — into <proj>/drafts/<Section>.md, carrying the claims the Claim →
  //          Section Map assigns this section and citing only bibliography keys its outline pinned.
  //          If the draft needs a beat the outline does not have, STOP and raise it; never add one
  //          silently. DRAFT FRONTMATTER CONTRACT — as below."
  //   writablePaths: ["<proj>/drafts/<Section>.md"]
  // PATH B (plan file): the row below, which writes both files.
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
             "${CLAUDE_PLUGIN_ROOT}/skills/writing-general/SKILL.md",
             // plus ONE of these, only when the plan's Domain: says so:
             // "${CLAUDE_PLUGIN_ROOT}/skills/writing-legal/SKILL.md"  (Domain: legal)
             // "${CLAUDE_PLUGIN_ROOT}/skills/writing-econ/SKILL.md"   (Domain: econ)
            ] },
    // ... one T-row per remaining row of ## Section Outputs. No second row for the draft.
  ],

  // The writing gate. GRAMMAR once for the project; CITE+CLAIM once per section (one probe settles
  // both); PROSE-HARD once for the project. Quoted byte-identically from references/writing-checks.md.
  // ONE entry point. The cite-claim leg was one entry PER SECTION, written out by the
  // plan — the purest form of what P10 refuses, since a plan that forgets a row drops
  // that section's citation gate and nothing reports a check it never knew about.
  // check.sh discovers the sections from drafts/ instead, so the set cannot disagree
  // with what is on disk, and no sections at all is a refusal rather than a pass.
  mechanicalChecks: [
    { name: "writing",
      cmd: "bash ${CLAUDE_PLUGIN_ROOT}/skills/writing/scripts/check.sh --project <proj> --bib \"<proj>/<bib>.bib\" --plan \"<proj>/.planning/<slug>.md\" --plan-hash <craft plan hash> --style <domain>" },
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
      prompt: "Judge the deliverable strictly against the success criteria in the plan and goal: for each criterion, is there an artifact in the working tree that satisfies it? Missing or partial satisfaction is a finding. Severity: MAJOR at minimum, CRITICAL where the unsatisfied criterion is one the deliverable cannot stand without." },

    { key: "scope-fidelity",
      agentType: "Explore",
      refs: [],
      prompt: "Judge scope fidelity: did the changes stay inside the plan's task table and writable paths? Out-of-scope edits, unrequested features, and silently skipped plan items are findings. Severity: MAJOR at minimum, CRITICAL where an edit landed outside every declared writable path." },

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

    // This lens does NOT pin Explore. Explore is a built-in agent with a predefined prompt no
    // preloaded skill reaches, so a register-dependent judgement dispatched there is graded from
    // memory. writing-reviewer preloads all three register skills and is read-only by tools allowlist
    // AND by tests/agent-contract.test.mjs — the same structural property Explore is
    // pinned for, in an agent that actually knows the rules.
    { key: "prose-register",
      agentType: "writing-reviewer",
      refs: [],
      prompt: "Grade the drafted prose against the preloaded writing-general base register plus, when the plan's Domain: is legal or econ, the preloaded writing-legal or writing-econ skill for that domain: the Ship table (diction), the prohibited-construction tic table, the VINDICATED phrases — which are standard scholarship and are NEVER findings — and the formatting rules (no bold-lead, no bold bare numbers, no emojis, no ALL-CAPS emphasis). A rule the register marks dropped is not a finding, and an advisory hit is a finding only where that specific sentence is worse for it. Report every finding with the quoted evidence and the span id prose-audit.py emitted for it, and list every span id you considered. NEVER report a register judgement as a computation — it is MODEL-EVALUATED, with the text you actually read. Severity: MAJOR at minimum, CRITICAL where the register defect misstates the authority or the claim it carries." },
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
    "The document is written by dispatched agents. Main chat writes nothing under the project's drafts/, outlines/ or references/, by any tool including Bash heredocs — the sole exception being writing_bench_compile.py, a compiler emitting the user's own accepted outline.",
    "In bench mode the outlines/ files are the USER'S accepted work. A drafting row writes drafts/<Section>.md only; a draft needing a beat the outline does not have is raised, never silently added.",
    "Standing writing doer authority — every drafting task loads ${CLAUDE_PLUGIN_ROOT}/skills/writing/references/writing-checks.md plus ${CLAUDE_PLUGIN_ROOT}/skills/writing-general/SKILL.md, which is the base register for every Domain, and — when the plan's Domain: field is legal or econ — ${CLAUDE_PLUGIN_ROOT}/skills/writing-legal/SKILL.md or ${CLAUDE_PLUGIN_ROOT}/skills/writing-econ/SKILL.md alongside it. The domain files carry only what is additional to the base and are useless without it; Domain: general loads the base alone. It loads the raw style guides — volokh-distilled.md, formatting.md, economical-writing-full.md, elements-of-style.md — NOT AT ALL for drafting, because the register is those guides already filtered through 14.29M sentences and it overrides three of their rules as register mistakes, so loading both puts the drafter under contradictory instructions.",
    "Rules: writing-checks.md defines all eight checks; writing-anchored-numbers.md, writing-citation-tense.md, writing-no-bold-lead.md, writing-outline-sync.md, writing-topic-sentences.md, writing-shortjournal.md and writing-stop-triggers.md are the prose constraints; claim-id-traceability.md and the six cite-fidelity-*.md files govern claim ids and sourcing. All under ${CLAUDE_PLUGIN_ROOT}/skills/writing/references/.",
  ].join("\n"),

  // The plan's Domain: selects the register, so it selects the doer too — each of these three agents
  // preloads exactly the register skill that Domain names. SUBSTITUTE ONE literal name when the plan
  // is armed, exactly as `--style <domain>` above is substituted; craft takes a single string and
  // never branches at runtime.
  //   Domain: general -> "writing"   Domain: legal -> "writing-legal"   Domain: econ -> "writing-econ"
  implementerAgentType: "<writing|writing-legal|writing-econ>",   // the doer's own prompt replaces Claude Code's software-engineering one, which frames an article as a codebase
  verifierAgentType: "Explore",
}
```

`implementerAgentType` is a placeholder because craft takes a single string: the value is written
into the block when the plan is armed, from the plan's `Domain:` field, and no runtime branch exists
to write it later. The default agent carries Claude Code's software-engineering system prompt and
the deliverable here is prose a human reads, so the implementer must be an agent whose body replaces
that prompt — and *which* agent is not a free choice, because `writing`, `writing-legal` and
`writing-econ` preload `writing-general`, `writing-general`+`writing-legal` and
`writing-general`+`writing-econ` respectively. A `legal` run drafted by `writing` is drafted without
the register the same plan hands the prose-register lens, so the gate grades against rules the
drafter never saw. `Domain:` already selects the drafting refs, the `--style` of the prose gate and
the lens's register; the doer is the fourth thing it selects, not a fourth decision.

`verifierAgentType` and every lens `agentType` pin `Explore` because it has no Edit and no Write: a
judge that structurally cannot modify the tree beats a prompt asking it not to.

## Phase 5 — HUMAN REVIEW

Craft's Phase 5 unchanged, over the plan's `## Review Surfaces`. A clean technical verification is
evidence for that conversation, not human acceptance.

## Red flags

| Situation | Wrong move | Right move |
|---|---|---|
| Getting CLARIFY answers and sources into the bench | ask the user to retype the interview | `write_db` them as `intent`, `sources` and `srcmeta.bibliography` — the user never re-enters what they already told you |
| `writing_bench_compile.py` exits 1 | hand-edit the bench JSON to flip nodes to accepted | that forges the user's acceptance — report the named nodes and wait for them to accept in the bench |
| A drafter needing a beat the outline lacks | add it to `outlines/<Section>.md` | the outline is the user's work — stop and raise it; a drafting row's `writablePaths` is `drafts/` only in bench mode |
| Returning to the bench later in the run | publish a second bench artifact | republish the URL recorded in `.planning/ACTIVE_WORKFLOW.md` — a second artifact is a second, divergent outline |
| A coauthor who should see the bench | send them the URL | a `db` artifact is organization-internal; on a personal account a second signed-in account gets "Page not found" (verified) — export the compiled plan instead |
| Needing a source | cite what you remember | recall is not a source — dispatch `workflows:librarian` and make it leave a real artifact under `references/` |
| The plan's location | copy craft's plan into `.planning/` | set `plansDirectory` to `./.planning` so craft's plan already IS the parsed one; a copy drifts from what the user approved |
| Naming the plan file | `PLAN.md` | the parser rejects that basename as legacy — use the slug plan mode wrote |
| Building the task table | an outline row and a draft row per section | one row per section: outline and draft are the same row's work, and splitting them doubles the fan-out this port exists to collapse |
| A section named only in prose | expect the gate to find it | a runner cannot open what it was never told about — add its row to `## Section Outputs` before approval |
| `writing_section_index.py` exits `2` | read it as a content failure | that is a usage exit: the check did not run, and an unrun check is never a pass |
| Wiring the prose gate | `prose-audit.py` straight into `mechanicalChecks` | it ends in `sys.exit(worst)` and would block on advisory puffery — `writing_prose_gate.py` is the only sanctioned path |
| Running the prose gate | add `--with lxml --with pyyaml` to the gate's own command | the wrapper already runs the engine under them; the gate's command line is the one quoted in `references/writing-checks.md`, byte for byte |
| `COVER`/`FIDELITY`/`TRANSITION`/`COUNTER` | report them as `PASS` | that presents a judgement as a computation — `MODEL-EVALUATED` with the evidence read |
| A judgement that depends on the register | dispatch a built-in agent (`Explore`, `Plan`, `general-purpose`) | their prompts are predefined and no preloaded skill reaches them, so the register is graded from memory — dispatch a custom agent whose body you control, like `writing-reviewer` |
| Sections that could be drafted in parallel | fan out drafters | IMPLEMENT is sequential by design — one row per section, one shared tree, one gate |
| Project state | write a `SPEC.md`, `STATE.md` or `NOTES.md` | competing state makes progress ambiguous — the approved plan is the authority and craft hashes it |
| Something craft does not obviously do | write a `writing/workflow.js` | ask which craft parameter is missing — `tasks[]` + `mechanicalChecks` is what turned the per-section fan-out into rows and the runners into the gate |
