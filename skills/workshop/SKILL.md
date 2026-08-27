---
name: workshop
description: "ALWAYS use when the deliverable is a research talk - Typst slides and teleprompter speaker notes built from a paper. Use when the user says \"create workshop slides\", \"build the deck\", \"make slides for my paper\", \"presentation from this paper\", \"write the speaker notes\", \"I'm presenting this at a seminar\", \"turn the paper into a 40-minute talk\", \"I have a workshop next week and nothing to show\", or \"/workshop\". Use proactively whenever a conference, seminar, job talk or brown bag comes up, even if the user never says \"slides\". NEGATIVE ROUTING: course lecture slides and lecture notes are teaching:slides and teaching:notes; grading a deck that is already built is the workshop-reviewer agent; a one-slide tweak on a deck that already exists goes to the workshop agent, since this skill runs a full clarify/plan/dispatch/human-review lifecycle; the paper's own prose is writing-econ or writing-legal."
argument-hint: 'the paper to turn into a workshop deck'
allowed-tools: [Bash, Read, Edit, Write, Grep, Glob, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Monitor]
---

# workshop — a talk, run through craft with a computed deck gate

The lifecycle is [craft](${CLAUDE_PLUGIN_ROOT}/skills/craft/SKILL.md). Read it and follow it.
This file is a **delta**: it supplies the domain — the CLARIFY axes, the plan grammar, the lenses,
the mechanical checks, the refs, the authority text. It ships no `workflow.js` and restates none of
craft's mechanics.

What makes a run `workshop` rather than plain craft is one thing: **the built deck is verified
against the approved plan by a computed probe, not by the agent that generated it.**
`scripts/workshop-deck.py` parses the plan's `## Source Paper`, `## Source Inventory`, `## Slide Spec`
and `## Outputs and Verification`, opens the built artifacts itself, and fails closed on a missing
tool, a missing file, an unreadable PDF or a malformed Slide Spec; craft's JS reads its exit code.

## Write surface

Main chat clarifies, plans and dispatches. It does not build the deck, and it **never writes a
`.typ` file** — not by Write/Edit, and not by Bash (`cat >`, a heredoc, `sed -i`, `tee`). Slides and
notes are written by dispatched agents. Craft's dispatch is already structural and its judges are
pinned to `Explore`, so this is a rule on you, not a hook — reach for the workflow first rather than
after a refusal.

## Phase 1 — CLARIFY

Craft's Phase 1, on these axes. Ask in one `AskUserQuestion` call where answers are independent;
ask cascading ones separately — the venue decides the duration, and the duration decides the slide
count the Proportions split is drawn from.

| Axis | Establish with the user |
|---|---|
| Paper | The source paper's path, its argument, and which of its results the talk is actually about |
| Audience | Who is in the room, what they already accept, and what they will push back on |
| Venue | Workshop, seminar, job talk or conference; projector scale; whether the paper is pre-read |
| Duration | Talk length, Q&A split, and the hard stop |
| Proportions | The time and slide split across sections — motivation, data, results, implications |
| Visual expectations | Which figures and tables must appear, which are redrawn as diagrams, and what may be text-only |
| Outputs | The deck source, the notes source and their rendered PDFs, by path relative to the project root |
| Review evidence | What makes each section credible at review: a named figure, a quoted statistic, or user judgment |

Craft's remaining axes are taken as craft states them, with two domain bindings.

Craft axis 4 (observable success criteria) is answered by the deck probe, the constraint runner and
the probe's own suite. **All three `mechanicalChecks` are fixed strings, and nothing is collected
from the user here.** The one per-run value is the approved plan's path, which craft already resolved
and hashed in Phase 2; every other argument is literal. `## Outputs and Verification` is an
`Artifact | Path` table of **artifact paths, not commands** — the probe opens those paths itself, so
no cell of it is ever substituted into a `cmd`, and there is no per-project test or lint entry to
collect or omit. Adding a command collected at CLARIFY would change the gate's shape from the one the
plan's Run sizing recorded.

Craft axis 5 (review surface) is answered by the plan's `## Review Surfaces` section.

Gather planning evidence read-only: extract the paper's figures, tables, results and assertions into
the F/T/R/A inventory the plan will declare. Building a slide is not planning evidence.

## Phase 2 — PLAN

Craft's Phase 2. Four domain requirements on the plan:

- **The seven required H2 headings**, spelled exactly, in two classes:
  - **Probe-parsed, FAIL CLOSED when absent, empty or unparseable** — `## Source Paper`,
    `## Source Inventory`, `## Slide Spec`, `## Outputs and Verification`. `workshop-deck.py` parses
    these four and nothing else; a heading spelled differently is an absent heading.
  - **Grammar-required and read by the lenses, not by the probe** — `## Presentation Intent`,
    `## Audience, Venue, Duration, and Proportions`, `## Review Surfaces`. No computed check fires on
    their absence: `deck-convention` and Phase 5 are what consume them, and a plan
    missing one is not ready for implementation. Do not claim a check here that does not exist.
- **The plan grammar** — the seven-column Slide Spec, the three-column `## Source Inventory`, the
  two-column `## Source Paper`, the four mandatory `## Outputs and Verification` rows, the inventory
  emission the built slides carry, the normalized title key, and the exhaustive
  malformed/unparseable clauses — is specified once, in
  [references/slide-spec-grammar.md](${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/slide-spec-grammar.md).
  Read it in full before drafting the plan.
- **`refs` per task row and per lens** — required, may be empty. Write `refs: []` to state "no
  domain rules" rather than omitting the key.

The `Section` column is the task decomposition: one implementation task per distinct `Section`
value, plus one assembler. The assembler reads what the section rows write, so it carries
`dependsOn` naming every section task.

## Phase 3 — GOAL

Craft's Phase 3 unchanged.

## Phase 4 — the craft call

Args, then dispatch **exactly as craft's Phase 4 states it** — craft owns the invocation, the result
handling and the return shape.

Paths below are written the way each consumer reads them: `refs` are absolute, because an implementer
resolves them against no particular directory; `writablePaths` and every `mechanicalChecks` `cmd` are
**project-relative**, because craft spawns each leg with its working directory at `projectDir`.

```js
{
  projectDir, planPath: "<the path $PLAN resolved to in Phase 2>", planHash: "<64-hex>",
  goal: "<one sentence>",

  // One row per distinct `Section` value in the plan's ## Slide Spec, plus one assembler.
  // Every task carries refs, empty or not.
  tasks: [
    { id: "section-1",
      name: "Section: <Section>",
      work: "Write the Typst fragments for every ## Slide Spec row whose Section is <Section>. Each slide's `=== ` title line carries that row's Slide cell; SPEC and NOTE join on the normalized title key defined in references/slide-spec-grammar.md, so a retitled slide fails the gate rather than silently passing. IMMEDIATELY AFTER each `=== ` title line, emit `#inv(\"F1\", \"T2\")` listing EXACTLY that row's Inventory IDs as quoted string literals, one argument per ID — no extra ID, none omitted. INV is a per-slide SET EQUALITY between the IDs a built slide emits and its own row's Inventory cell, and it FAILs on a difference in either direction; deck-wide membership in ## Source Inventory is the second half of the check, not the whole of it, so identical boilerplate on every slide FAILs. A slide carrying no `#inv(` call is a FAIL, not an untraced slide, and a call sitting inside a `//` or `/* … */` comment is not an emission. `inv` is the no-op declared in the vendored templates/theme.typ, so it renders nothing. Every emitted ID must also be declared in ## Source Inventory, matched whole-token. Write the matching `== <title>` notes section for each slide under the same title.",
      writablePaths: ["presentation/fragments/section-1.typ",
                      "presentation/fragments/notes-section-1.typ"],
      acceptance: "Each of this section's Slide Spec rows has one slide whose `=== ` line matches its Slide cell under the normalized key, an uncommented `#inv(...)` call immediately after that line whose ID set EQUALS that row's Inventory cell in both directions, and one notes section under the same key; every emitted ID is declared whole-token in ## Source Inventory.",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/workshop-checks.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/slide-spec-grammar.md",
             "~/.claude/skills/typst/references/constraints/typst-slide-format.md",
             "~/.claude/skills/typst/references/constraints/typst-formatting.md",
             "~/.claude/skills/typst/references/constraints/typst-bullet-spacing.md",
             "~/.claude/skills/typst/references/constraints/typst-teleprompter-notes.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/workshop/templates/theme.typ"] },
    // ... one section-<n> row per remaining distinct Section value.

    { id: "assemble",
      dependsOn: ["section-1" /* , … every section row */],
      name: "Assemble the deck and notes",
      work: "Copy ${CLAUDE_PLUGIN_ROOT}/skills/workshop/templates/theme.typ and .../templates/custom-outline.typ into the project's presentation/templates/, and import them from the deck project-relative as `templates/theme.typ`. Typst resolves an absolute import against --root and the probe compiles with --root at the project root, so the skill directory is unreachable from a built deck: a template that is merely readable is not importable. Then assemble the section fragments into the deck and notes sources declared in ## Outputs and Verification, in Slide Spec order, and compile both. Declare the compile artifacts too — a PDF written beside a .typ that no writablePath names is an undeclared change.",
      writablePaths: ["presentation/templates/theme.typ",
                      "presentation/templates/custom-outline.typ",
                      "presentation/slides.typ", "presentation/notes.typ",
                      "presentation/slides.pdf", "presentation/notes.pdf"],
      acceptance: "Both templates exist under the project's presentation/templates/ and the deck imports theme.typ project-relative; both sources compile with no stderr diagnostic; the deck's slide set and the Slide Spec's body rows correspond one-to-one under the normalized title key.",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/workshop-checks.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/slide-spec-grammar.md",
             "~/.claude/skills/typst/references/constraints/typst-section-hierarchy.md",
             "~/.claude/skills/typst/references/constraints/typst-common-elements.md",
             "~/.claude/skills/typst/references/constraints/typst-notes-structure.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/workshop/templates/theme.typ",
             "${CLAUDE_PLUGIN_ROOT}/skills/workshop/templates/custom-outline.typ"] },
  ],

  // The workshop gate. workshop-deck owns the eight computed rows and is never conditional.
  // constraints ships the same runner standalone: it exits 0 ONLY when failed[], errors[] and
  // skipped[] are all empty AND the summed `inspected` is greater than zero, and 1 otherwise, so
  // it is a check capable of failing on a presentation directory that does not resolve or a corpus
  // that lost its modules. The CON verdict is the probe's, read from this runner's JSON and never
  // from its status. `presentation` is PROJECT-RELATIVE and carries no placeholder: craft runs a
  // cmd VERBATIM with the working directory at the project root, so a `<projectDir>/presentation`
  // written literally targets a directory of that name, discovers zero modules, and exits 1 on
  // every conforming run — permanently red, therefore permanently waived. A runner pointed at the
  // project root instead globs an empty tree and reports clean having opened no file.
  // The deck probe needs the run's approved plan — the only per-run value in any cmd. It is a
  // TEMPLATE SLOT in the `<...>` convention this whole object already uses (see planPath above),
  // substituted by the orchestrator when it writes args.json. It is NOT `${planPath}`: that is a
  // property of this same object literal, not a lexical binding, so a template literal ships the
  // characters unresolved into a cmd craft runs VERBATIM.
  // probe-tests is the probe's own contract suite: a gate whose runner is untested is untested.
  mechanicalChecks: [
    { name: "workshop-deck",
      cmd: "uv run --with pypdf python3 ${CLAUDE_PLUGIN_ROOT}/skills/workshop/scripts/workshop-deck.py --plan <the planPath above, substituted when args.json is written> --project-dir ." },
    { name: "constraints",
      cmd: "python3 ~/.claude/skills/typst/references/checkers/workshop/run-constraints.py presentation" },
    { name: "probe-tests",
      cmd: "uv run --with pypdf --with pytest python3 -m pytest ${CLAUDE_PLUGIN_ROOT}/skills/workshop/scripts/workshop_deck_test.py" },
  ],

  // Judged BEFORE any slide is generated; a surviving critical returns FAIL having built nothing.
  // workshop-deck.py parses these four sections, so a defect here un-gates SPEC, NOTE and INV at
  // once. The CRITICAL criterion is bounded to a named concrete input, or plan review does not
  // terminate.
  // Passing reviewLenses REPLACES craft's defaults, so the two defaults are spelled out here.
  // deck-fidelity, deck-convention and visual-integrity OWN FID, CONV and VIS — the probe computes
  // none of the three and emits a MODEL-EVALUATED line for each, so these lenses are the run's ONLY
  // fidelity coverage.
  reviewLenses: [
    { key: "criteria-vs-artifacts",
      agentType: "Explore",
      refs: [],
      prompt: "Judge the deliverable strictly against the success criteria in the plan and goal: for each criterion, is there an artifact in the working tree that satisfies it? Missing or partial satisfaction is a finding. Severity: MAJOR at minimum, CRITICAL where the unsatisfied criterion is one the deliverable cannot stand without." },

    { key: "scope-fidelity",
      agentType: "Explore",
      refs: [],
      prompt: "Judge scope fidelity: did the changes stay inside the plan's task table and writable paths? Out-of-scope edits, unrequested features, and silently skipped plan items are findings. Severity: MAJOR at minimum, CRITICAL where an edit landed outside every declared writable path." },

    { key: "deck-fidelity",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/workshop-checks.md"],
      prompt: "You OWN check FID, defined in the refs. Read them in full first, along with the built slides.typ and notes.typ and the plan's ## Source Inventory. Also read the source paper itself, at the path this run's plan names under ## Source Paper — it is not in refs because refs is a static list of paths and the paper differs per run, so read it from the plan rather than expecting it injected. FID is MODEL-EVALUATED: report it as MODEL-EVALUATED with the evidence you actually read — never as PASS, and never as N/A, which is not a third kind of pass. Findings: a number, holding or conclusion on a slide that traces to no declared Source Inventory ID or to the paper; a slide overstating what its source supports. MAJOR min; CRITICAL where the deck asserts a result the paper does not contain. Quote the claim text with a file:line." },

    { key: "deck-convention",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/workshop-checks.md",
             "~/.claude/skills/typst/references/constraints/typst-bullet-spacing.md",
             "~/.claude/skills/typst/references/constraints/typst-cetz-diagrams.md",
             "~/.claude/skills/typst/references/constraints/typst-common-elements.md",
             "~/.claude/skills/typst/references/constraints/typst-computed-values.md",
             "~/.claude/skills/typst/references/constraints/typst-fletcher-diagrams.md",
             "~/.claude/skills/typst/references/constraints/typst-formatting.md",
             "~/.claude/skills/typst/references/constraints/typst-images.md",
             "~/.claude/skills/typst/references/constraints/typst-label-bullet-spacing.md",
             "~/.claude/skills/typst/references/constraints/typst-no-subtitle-echo.md",
             "~/.claude/skills/typst/references/constraints/typst-notes-structure.md",
             "~/.claude/skills/typst/references/constraints/typst-section-hierarchy.md",
             "~/.claude/skills/typst/references/constraints/typst-slide-format.md",
             "~/.claude/skills/typst/references/constraints/typst-sub-bullets.md",
             "~/.claude/skills/typst/references/constraints/typst-tables.md",
             "~/.claude/skills/typst/references/constraints/typst-teleprompter-notes.md"],
      prompt: "You OWN check CONV, defined in the refs. Read them in full first, along with the built deck and notes and the plan's ## Audience, Venue, Duration, and Proportions and ## Slide Spec. CONV is MODEL-EVALUATED: report it as MODEL-EVALUATED with the evidence you actually read — never as PASS, and never as N/A, which is not a third kind of pass. Findings: a convention violation the 15 modules cannot catch — a takeaway that is not a claim, a bullet restating its title, notes duplicating the slide instead of expanding it. MAJOR min. Quote the offending text with a file:line." },

    { key: "visual-integrity",
      agentType: "Explore",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/workshop-checks.md"],
      prompt: "You OWN check VIS, defined in the refs. Read them in full first, along with the built slides.typ and the Visual cell of each ## Slide Spec row. VIS is MODEL-EVALUATED: report it as MODEL-EVALUATED with the evidence you actually read — never as PASS, and never as N/A, which is not a third kind of pass. Findings, judged on the Typst diagram source: clipped or overlapping labels, arrows routed through nodes, illegible sizing, a diagram contradicting its caption. MAJOR min. Source, not a render — look_at.py is not vendored, so say what you could not determine from source rather than papering over it." },

    // This lens does NOT pin Explore. Explore is a built-in agent with a PREDEFINED prompt that no
    // preloaded skill reaches, and it skips the CLAUDE.md hierarchy — so the three lenses above
    // grade fifteen Typst modules from whatever their refs list actually got read, which is
    // discretionary. workshop-reviewer preloads workshop-constraints (all fifteen, verbatim) and is
    // read-only by tools allowlist AND by tests/agent-contract.test.mjs — the same structural
    // property Explore is pinned for, in an agent that already holds the rules.
    { key: "deck-constraints",
      agentType: "workshop-reviewer",
      refs: [],
      prompt: "Grade the built slides.typ and notes.typ against the fifteen Typst modules in the preloaded workshop-constraints skill, and ONLY on the judgement half no checker reaches: a takeaway that names a topic instead of asserting a claim, a bullet restating its own slide title, notes duplicating the slide instead of carrying the spoken words, outline fragments where speakable sentences belong, a section hierarchy the argument does not have, a table whose numbers are not traceable to the paper or whose synthesis is undocumented, and diagram legibility judged on the Typst SOURCE — clipped or overlapping labels, arrows through nodes, illegible sizing, a diagram contradicting its caption. Do NOT re-derive what run-constraints.py already computed. Report every finding with the quoted text and a file:line, naming the module, and list every module you considered including those you judged satisfied. NEVER report a module judgement as a computation and never as N/A — it is MODEL-EVALUATED, with the evidence you actually read. MAJOR min; CRITICAL where the deck asserts something its source does not support." },
  ],

  authorityExtra: [
    "IRON LAW OF WORKSHOP VERIFICATION — no check result without the probe's own output. A check reported from reading the deck, or an N/A justified by a reason the model composed, is the model certifying its own work. Every computed result is a line ${CLAUDE_PLUGIN_ROOT}/skills/workshop/scripts/workshop-deck.py emitted, quoted as emitted.",
    "Every computed check FAILS CLOSED. A missing tool, a missing file, an unreadable PDF, a malformed Slide Spec, an unparseable ## Source Inventory or ## Outputs and Verification, or a driver exit code the probe does not recognise is a FAIL — never a clean line, never a skip. A check that cannot fail is not a check.",
    "Never report FID, CONV or VIS as PASS. They are MODEL-EVALUATED judgements, reported as such with the evidence read. An N/A is not a third kind of pass: it carries a machine-generated reason and is still owed a disposition against task-local evidence.",
    "SPEC and NOTE join a built slide's `=== ` title line to its Slide Spec row on the NORMALIZED title key defined in ${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/slide-spec-grammar.md — never on ordinal position and never on row count. Retitling a slide fails the gate rather than passing quietly.",
    "Every generated slide emits `#inv(...)` immediately after its `=== ` title line, listing EXACTLY that slide's own Slide Spec Inventory IDs as quoted string literals. INV is a per-slide SET EQUALITY against that row's cell and FAILs on a difference in either direction; membership in ## Source Inventory is the second half of the check, not the whole of it, so the same boilerplate ID repeated deck-wide FAILs. A slide carrying no `#inv(` call FAILs, and a call inside a `//` or `/* … */` comment is not an emission.",
    "The vendored templates are copied into the project's presentation/templates/ by the assemble task and imported project-relative. The probe compiles with --root at the project root, so a template left in the skill directory is unreachable from the built deck.",
    "Craft runs a mechanicalCheck cmd VERBATIM, with the working directory at the project root. Every path in a cmd is therefore project-relative and literal; a placeholder shipped into a cmd targets a directory of that literal name, fails on every conforming run, and is therefore permanently waived.",
    "An artifact absent from the plan's ## Outputs and Verification is one nothing will check and cannot be claimed as verified. Do not verify an output that section never declared.",
    "The deck is built by dispatched agents. Main chat writes no .typ file, by any tool.",
    "Standing workshop doer authority — every deck or notes task loads ${CLAUDE_PLUGIN_ROOT}/skills/workshop-constraints/SKILL.md and follows all fifteen Typst modules: bullet spacing, label bullet spacing, sub-bullets, tables, images, CeTZ diagrams, Fletcher diagrams, formatting, slide format, section hierarchy, notes structure, teleprompter notes, computed values, common elements, no-subtitle-echo. It carries the fifteen vendored modules verbatim in one file, so a doer given one path cannot read four of fifteen and stop; ${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/slide-spec-grammar.md stays a separate load.",
    "Rules: ${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/workshop-checks.md defines all eleven checks and which are computed; ${CLAUDE_PLUGIN_ROOT}/skills/workshop/references/slide-spec-grammar.md defines the plan grammar the probe parses; the canonical Typst constraints under ~/.claude/skills/typst/references/constraints/ govern the source and are the checker's authority, with the same fifteen modules preloadable verbatim as the workshop-constraints skill; the deck templates are ${CLAUDE_PLUGIN_ROOT}/skills/workshop/templates/theme.typ and ${CLAUDE_PLUGIN_ROOT}/skills/workshop/templates/custom-outline.typ.",
  ].join("\n"),

  implementerAgentType: "workshop",   // the doer's own prompt replaces Claude Code's software-engineering one, which frames a talk as a codebase
  verifierAgentType: "Explore",
}
```

`implementerAgentType` names `workshop` because the default agent carries Claude Code's
software-engineering system prompt, and the deliverable here is a deck and speaker notes a room
reads — prose, not code. An agent is justified only by a custom prompt, hooks or preloaded skills;
`workshop` earns it on the first, and it preloads `workshop-constraints`.

`verifierAgentType` and the five FID/CONV/VIS-and-generic lenses pin `Explore` because it has no Edit
and no Write: a judge that structurally cannot modify the tree beats a prompt asking it not to. The
`deck-constraints` lens buys the same property a different way — `workshop-reviewer` is
read-only by tools allowlist — because Explore's prompt is predefined and no preloaded skill or
CLAUDE.md reaches it.

## Phase 5 — HUMAN REVIEW

Craft's Phase 5 unchanged, over the plan's `## Review Surfaces` — the rendered deck and the rendered
notes. A clean deck gate is evidence for that conversation, not human acceptance.

## Red flags

| Situation | Wrong move | Right move |
|---|---|---|
| A slide's title reads better than the Slide Spec cell | improve it in the deck | SPEC and NOTE join on that cell's normalized key — amend the plan's cell, re-hash, then rebuild |
| A slide's inventory IDs | leave them to a grep over the prose, or emit one boilerplate ID deck-wide because it is declared | prose cannot be joined to an inventory, and membership alone measures nothing — emit exactly that row's `Inventory` cell after the `=== ` line, which `INV` compares as a set in both directions |
| A `mechanicalCheck` needs the project directory | write `<projectDir>/presentation` into the `cmd` | craft runs the `cmd` verbatim with the working directory at the project root — emit the project-relative `presentation`. A literal placeholder targets a directory of that name, exits 1 on every conforming run, and is a permanently waived check |
| The templates | import them from the skill directory | the probe compiles with `--root` at the project root — the assemble task copies them into `presentation/templates/` and imports project-relative |
| Naming a produced artifact | name it in prose | a runner given prose cannot open it — add its path to `## Outputs and Verification` before approval |
| The deck verdict | let the generating agent report it | the generator cannot see the assumption it made in both places — the probe is a `mechanicalCheck` and the JS reads its exit code |
| `FID`/`CONV`/`VIS` | report them as `PASS` | that presents a judgement as a computation — `MODEL-EVALUATED` with the evidence read |
| A computed check reported clean with no tool installed | accept it | that is the defect this port exists to remove — a missing `typst` or `pypdf` is a FAIL, never a clean line |
| Widows or overflow | add back upstream's `typst-widow-detection.py` or `typst-overflow.py` | both fail open; the probe owns `WID` and `OVR` natively, so 15 modules are vendored, not 17 |
| A judgement that depends on the Typst modules | dispatch a built-in agent (`Explore`, `Plan`, `general-purpose`) | their prompts are predefined, no preloaded skill reaches them and they skip the CLAUDE.md hierarchy, so fifteen modules are graded from whatever got read — dispatch a custom agent whose body you control, like `workshop-reviewer` |
| Handing a doer the Typst conventions | name the fifteen constraint paths in the task prompt | naming a path is discretionary and a skipped read fails silently — the doer is `workshop`, which preloads `workshop-constraints` deterministically |
| Section tasks and the assembler | rely on their order in `tasks[]` | the assembler reads what they write — give it `dependsOn` naming every section row |
| Something craft does not obviously do | write a `workshop/workflow.js` | ask which craft parameter is missing — `mechanicalChecks` is what makes the deck probe the gate |
