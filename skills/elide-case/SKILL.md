---
name: elide-case
description: >
  Use when a court opinion that is not in the casebook has to become a casebook-style
  excerpt for students — "add this case to the addendum", "elide this opinion for class",
  "cut this case down to four pages the students can read", "make a casebook excerpt of
  X", "this case isn't in Choi, put it in the reader", "excerpt the Howey analysis from
  this opinion", "the TM mentions a case we don't have", "I want to teach this new
  decision next week". NEGATIVE ROUTING: compiling an addendum whose readings are already
  written is teaching:generate-addendum; retrieving an opinion with no elision is
  workflows:courtlistener.
argument-hint: 'the case to excerpt, the insertion point, and the page target'
allowed-tools: [Bash, Read, Write, Edit, Grep, Glob, AskUserQuestion, EnterPlanMode, ExitPlanMode, Agent, Monitor]
---

# elide-case — a court opinion cut into a student reading, on the craft spine

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

**Typst rules in force here** — read the one that governs what you are writing; they are independent:
!`k=notes,prose; command -v typst-rules >/dev/null 2>&1 && exec typst-rules "$k"; r=$HOME/.claude/skills/typst/scripts/load-constraints; [ -x "$r" ] && exec "$r" "$k"; r=$HOME/projects/typst/scripts/load-constraints; [ -x "$r" ] && exec "$r" "$k"; echo "(typst corpus unavailable: NO Typst rule is listed here — install the typst plugin, or start a new session so its bin/ reaches PATH)"`

The lifecycle is [craft](/home/eh/.claude/skills/workflows/skills/work/SKILL.md). Read it and
follow it. This file supplies craft's spine with the domain and nothing else — the three CLARIFY
questions, the plan grammar, the task rows, the two scored checks, the one mechanical entry point, the refs
and the authority text. **It ships no `workflow.js` and no `.js` of any kind**, and restates none of
craft's mechanics.

The domain rules live in `references/` and reach every dispatched agent through `refs`:

| ref | what it carries |
|---|---|
| [`references/authenticity.md`](references/authenticity.md) | the two Iron Laws — authentic reporter text, and compile-before-table |
| [`references/retrieval.md`](references/retrieval.md) | `workflows:westlaw` as the first route and the `.westlaw.docx` as the ONLY stored source, the corpus fallback (opinions vs RECAP, the 404, token gating, telling a clean source) and what that fallback's PDF cannot carry, and the two reasons to run on Gemini — a scanned source or a filter-tripping subject |
| [`references/editing-marks.md`](references/editing-marks.md) | one elision mark per addendum, `[ ]` conventions, never altering subject/tense/sentence boundary, the editors'-note rule (a note is the EXCEPTION, for background), where the mechanical conventions live (the preamble, once), the layout-only widow rule, and the source-mapping marker `// elide-source:` that check.sh reads |
| [`references/verification.md`](references/verification.md) | what each gate leg decides, and how to read a miss rate |

<EXTREMELY-IMPORTANT>
**The Iron Law of Authentic Text.** Every word of the excerpt is authentic reporter text, retrieved
this run and saved under `docs/`. Never drafted from memory, from a Teacher's Manual summary, or from
a casebook note. A plausible paraphrase handed to students as a quoted opinion is fabricated
authority in a course reader.

**The Iron Law of Compile-Before-Table.** The summary table is written AFTER the compile, from the
checker's computed output. Never before, never from an estimate.

Both are stated in full in `references/authenticity.md`, which is the `refs` entry every implementer
and the fidelity lens must read. Refactoring this file never weakens them.
</EXTREMELY-IMPORTANT>

## Phase 1 — CLARIFY: three questions, asked with AskUserQuestion, never self-answered

**This interview is the point of the workflow.** Ask exactly these three, with `AskUserQuestion`, and
record every answer verbatim in the plan:

1. **What is the doctrinal thread, in your own words — and which assigned reading does it cut
   against?** One thread, named by the instructor, plus the case or casebook page it is in tension
   with. This is what decides every sentence that survives the cut.
2. **Is this case taught for its HOLDING or for its REASONING?** Holding means the disposition and
   the rule statement survive and the analytical march may be compressed. Reasoning means the
   analytical steps survive and the disposition may be a sentence.
3. **What is the page target for each reading?** One MIN-MAX per reading, offered with **2-6 as the
   default** option — the skill's established range — since a reading whose length he does not care
   about takes the default. A lead case and a short blog post reasonably differ, which is why the
   plan carries one target per row. When the request or the schedule already gives a target,
   **pre-fill the options from it** rather than posing the question blind; nothing is inferred
   silently, and nothing is typed at a command line.

**Do not ask anything else.** On 2026-09-09 the instructor declined a passage he wants kept, and
declined insertion point and length as an interview axis — then **reversed the length half the same
day**: the per-reading page target is now question 3 above, set in the interview and enforced from
the plan, because a number typed at the command line is a number an agent can invent. Insertion point
and class number still come from the request, or off the schedule if the request omits them.

### THE INTERVIEW, AND EXACTLY WHAT ENFORCES IT

Never self-answer either question, never state an assumption and continue, never infer the thread
from the Teacher's Manual or from the case itself. Craft's CLARIFY is conversational and **a
dispatched agent cannot call `AskUserQuestion`** — a run started from a farmed-out agent has nobody
to ask, and its only correct move is to stop and report that the interview is unanswered. Elevating
the run to a session that can reach the user is the fix; guessing is not.

Measured 2026-09-09: the old Phase 1 had the model state the doctrinal target *to itself*. It guessed
"pre-purchase efforts, against Life Partners", happened to be right, and nothing in the skill made it
ask. That silent-guess path is the defect this workflow exists to remove.

**The chain, with each link's real strength named.** Three things carry the interview, and only one of
them is software:

1. **The answers are recorded in the plan**, under `## Doctrinal target`, on the three labelled lines
   Phase 2 specifies.
2. **The instructor reads and approves that plan before the run arms**, and the spec hash binds what
   he approved. *This is the link that makes the answers his.* It is a human gate, and it is the only
   one there is: an instructor who approves a plan whose `## Doctrinal target` holds answers he never
   gave defeats the whole chain, and **no software in this design closes that.**
3. **`scripts/check.sh --plan <path>` refuses a plan whose section is missing or unfilled** — absent
   section, or `Doctrinal thread:` / `Cuts against:` missing, empty or a placeholder, or `Taught for:`
   missing or saying neither holding nor reasoning. The leg fails closed: passing neither `--plan` nor
   `--no-plan` is itself a FAIL naming the missing flag, and `--no-plan` (for fixture and dev runs
   that check an addendum alone) prints a loud NOT CHECKED line.

**What that leg proves, and what it does not.** It proves the section exists and every required answer
is non-empty. It is a backstop against an **orchestrator that skipped the question** — nothing more.
The plan file is written by the orchestrator, so no grep of it can tell the user's answers from the
orchestrator's own, and craft's `mechanicalChecks` run at gate time, *after* IMPLEMENT, so no
mechanical leg can refuse to proceed past CLARIFY. Do not close the gap with a second
`mechanicalChecks` entry — P10 refuses one, and the leg belongs inside the single entry point.

## Phase 2 — PLAN

Craft's Phase 2. Domain requirements on the plan:

- **A `## Readings In Scope` section**, one row per reading: `caption | source docs/*.westlaw.docx (a docs/*.txt from an
  earlier run, or from the fallback route, still resolves) | page
  target`. **This section is the source of truth for the page target**, and the `--plan` leg enforces
  it exactly as it enforces the three Doctrinal target lines: an absent section, a row with no page
  target, or a placeholder one (`TBD`, `<…>`, `N/A`) FAILS the leg naming the offending row. The
  target is per reading, from interview question 3; `check.sh` maps each `.typ` caption to its row and
  passes that row's own MIN-MAX to `check-addendum.py`. The caption is the identifier the `.typ` and the mechanical entry point key on — the entry
  point derives its per-reading checks from the captions in the `.typ`. Each row also generates one
  `cut-<slug>` task, which is how a per-reading re-run reaches craft's `onlyTasks`.
- **The first two CLARIFY answers, quoted** (the third is the `page target` column above), under `## Doctrinal target`, on three labelled lines the
  `--plan` leg parses — `Doctrinal thread:`, `Cuts against:`, `Taught for:` (holding or reasoning).
  A placeholder (`TBD`, `<…>`, `N/A`) reads as absent and fails the leg.
- **A `## Non-court readings` section whenever a reading is not court text** — one `- <caption> —
  <why>` bullet each, and omitted entirely when every reading is an opinion. **Declaring a reading
  non-court text is the INSTRUCTOR's call, recorded in the plan, never a marker the implementer
  writes into the `.typ`**: a self-exempting marker would let fabricated text switch the verbatim
  check off on itself, which is the first Iron Law defeated by the file it governs. The quotes leg
  reads this list from `--plan` and reports those captions `DECLARED-UNCHECKED`; a
  `// elide-unchecked:` marker in the `.typ` is no longer honoured and its presence is itself a
  FAIL naming the reading.
- **Run sizing** naming the one mechanical entry point, the two `scoredChecks` keys on the `Scored
  checks:` line marked ADVISORY, the two craft default lenses on the `Review lenses:` line, and the
  task rows. R readings give R + 2 tasks — one `retrieve`, R `cut-<slug>`, one `compile-table` — and
  2R scored items; with craft's two default lenses and one mechanical check the floor is
  2(R + 2) + 1 + 2 + 2R = 4R + 7 agents — 11 for a single reading, 19 for four readings.
- **The wave assignment, stated**: `retrieve` in wave 1, every `cut-<slug>` in wave 2, `compile-table`
  in wave 3. `work-dispatch.sh` prints the wave graph it computes; if it does not match those three
  lines, the `dependsOn` edges are wrong, not the prose.

**Writable paths for a generated run are `addenda/`, `output/addenda/` and `docs/` only.** `notes/`,
`slides/` and `templates/` are excluded, and so is everything else in the course tree.

## Phase 3 — GOAL

Craft's Phase 3, on the PASS phrasing: a run that writes can turn a FAIL into a PASS, and craft's
outer fix loop is what does it.

**Condition: `work-result.sh` returned 0 for the plan path, and the tuicr gate returned approved.**

```
/goal work-result.sh has returned 0 for <plansDirectory>/<slug>.md at its current hash, and the
tuicr gate has returned approved, or stop after N turns
```

Name the plan by **path**, never by a pinned digest — the FAIL loop amends and re-hashes the plan,
so a named hash self-invalidates. Name **`work-result.sh`'s exit code**, which is the run's verdict:
`overallPass` in `result.json` is not the verdict and must never be read directly (craft/SKILL.md's
`mechanicalChecks` row). Naming the returned verdict is also what makes a gate FAIL reach a stopping
condition at all — including one carried by a lens finding, which otherwise reaches none.

The condition names **no legibility or fidelity finding**. A clause like *"no critical|major finding
survives"* would reinstate the non-terminating prose review this design exists to exclude: round
*n*'s fix gives round *n+1* new things to object to. Those two run as `scoredChecks`, which cannot
reach `overallPass` at all, so their output sits in `result.json` and is **retrievable** at Phase 5 by
a human who runs the command there. Nothing carries it to him. Both named verdicts get printed, so
both are judgeable from the transcript.

## Phase 4 — the craft call

The args go in the plan's `<!-- craft:dispatch -->` block and the dispatch is craft's own
`work-dispatch.sh` — never a hand-written `farm.sh --workflow` line, which drops the TIER 1
plan-lint gate and both probe gates:

```bash
bash ~/.claude/skills/workflows/skills/work/scripts/work-dispatch.sh \
  --run-dir /home/eh/.local/state/craft "$PLAN"     # ABSOLUTE — never the course tree
```

**Forward the provider.** A provider named in this skill's `$ARGUMENTS`, however it is spelled,
becomes `--provider codex` on that line. Omitting it runs the user's codex request on claude. The
content-filter facts that make this matter are in `references/retrieval.md`, alongside the other
reason a run belongs on `--provider gemini`: a source whose text came from OCR.

`--run-dir` is not optional: craft resolves `.craft/<run-id>` against `$PWD`, which on an elide run is
the course directory — a tree this run writes only `addenda/`, `output/addenda/` and `docs/` in.

The args object, complete as it stands.

**One task per reading, in three waves.** The `## Readings In Scope` table generates one `cut-<slug>`
row each — cut that reading and nothing else — above one shared `retrieve` row and below one
`compile-table` row. A second reading therefore adds exactly one task, and adds **no** lens and **no**
mechanical entry: the entry point derives its per-reading legs from the `.typ` itself. This
granularity is not cosmetic. It is what makes a per-reading re-run expressible in craft's own
vocabulary — see *The FAIL loop* below.

**The wave shape is forced by craft's disjointness rule, not chosen for tidiness.** Same-wave tasks
must have pairwise-disjoint `writablePaths`, checked prefix-aware and **refused at arg-validation,
before any agent is dispatched**. Every reading needs its source in `docs/`, so if each reading row
claimed `docs` they would all land in wave 1 claiming the same directory and a two-reading addendum
would be refused before dispatch. One row owns `docs/` instead:

| wave | rows | writable paths | why disjoint |
|---|---|---|---|
| 1 | `retrieve` (one row, however many readings) | `docs` | alone in its wave |
| 2 | one `cut-<slug>` per reading, each `dependsOn: ["retrieve"]` | `addenda/NN-addendum-<slug>.typ` | one file each, slugs distinct |
| 3 | `compile-table`, `dependsOn` every `cut-<slug>` | `output/addenda`, `addenda/NN-addendum.typ` | alone in its wave |

`retrieve` writes `docs/` and nothing else; the cut rows read it and never write it. A single-reading
run keeps all three rows — collapsing them re-introduces the overlap the moment a second reading is
added.

```js
{
  projectDir: "/home/eh/areas/secreg",          // the COURSE directory — the tree being edited
  goal: "<one sentence>",

  // ── The deterministic floor: ONE entry point, whose exit code IS the mechanical verdict. ──
  // Five legs — the plan's interview answers, typst compile, check-quotes.py per derived caption,
  // check-addendum.py --target, and the strays leg (canonical widows.py/orphans.py/runts.py
  // plus check-stranded-headings.py) — none short-circuiting. A second entry here would spread the
  // verdict over two commands and lose one silently; P10 refuses it.
  // The plan leg FAILS CLOSED: pass `--plan <md>` on a real run or `--no-plan` on a fixture run,
  // and passing neither is a FAIL naming the missing flag. `--plan` also carries the plan's
  // `## Non-court readings` declarations. It checks that the answers are RECORDED and non-empty;
  // that they are the instructor's is carried by his approval of the plan, not by this command.
  // `--plan` ALSO supplies each reading's page target, from the plan's `## Readings In Scope`
  // rows, so a real run passes NO `--target`. The plan wins if one is passed anyway — the flag is
  // ignored with a loud line naming the plan's values. `--target MIN-MAX` / `--no-target` remain
  // the fail-closed pair on `--no-plan` fixture and dev runs, where passing neither is a FAIL
  // naming the missing flag and the leg must not report length.
  // The WIDOWS leg is ON BY DEFAULT, which is its fail-closed form: an absent flag RUNS the
  // check, so no invocation can quietly certify page breaks nobody looked at. `--no-widows`
  // is the loud waiver for fixture and dev runs; passing it with `--widows` FAILS. Its fix
  // vocabulary is LAYOUT-ONLY — spacing or pagination, never the court's words, and when the
  // two conflict fidelity wins and the widow stands.
  mechanicalChecks: [
    {
      name: "elide-check",
      cmd: "bash /home/eh/projects/workflows/skills/elide-case/scripts/check.sh --addendum /home/eh/areas/secreg/addenda/NN-addendum.typ --pdf /home/eh/areas/secreg/output/addenda/NN-addendum.pdf --plan /home/eh/areas/secreg/.claude/plans/<slug>.md",
    },
  ],

  tasks: [
    // ── WAVE 1: ONE row, whatever the reading count. It is the only row that writes `docs/`,
    // which is what keeps wave 2 pairwise-disjoint. See the wave table above.
    {
      id: "retrieve",
      name: "retrieve every reading's reporter text into docs/",
      work: "For EVERY row of the plan's `## Readings In Scope` table, retrieve the opinion FIRST through the `workflows:westlaw` skill, which owns the export procedure and the .westlaw.docx naming convention and yields publisher-keyed text needing no OCR adjudication. THE DOCX IS THE ONLY ARTIFACT: it is the golden copy, its text projection is in memory, and you write no .txt beside it — a stored twin drops the docx's italic runs, which is how a case name the court italicised reached a compiled reader in roman. Fall back to scripts/fetch-opinion.sh — saving both docs/<name>.pdf and docs/<name>.txt under the naming convention already in docs/ — only when Westlaw does not cover the case or no Westlaw credential is available; that route yields a court PDF with NO formatting layer, so its italics are unrecoverable and the gate says so on every reading cut from one. On that fallback, a citation 404 means 'not in the opinions corpus', not 'no such case' — take the RECAP docket-entry route. Retrieve and nothing else: write no addenda file, cut no text, and do not edit an excerpt. A reading whose source cannot be retrieved is reported as such — never substituted with a related opinion, a Teacher's Manual summary or a previous excerpt.",
      writablePaths: ["docs"],
      acceptance: "Every `## Readings In Scope` row has its retrieved source on disk under /home/eh/areas/secreg/docs/ — <name>.westlaw.docx ALONE on the Westlaw route, or <name>.pdf plus <name>.txt on the corpus fallback — and each is the reporter text of that row's caption. Writing a <name>.westlaw.txt for a source retrieved THIS RUN fails this row — the projection is in memory. A .westlaw.txt already in docs/ from an earlier run is left alone: an addendum whose plan or `// elide-source:` names one still resolves and still passes, and deleting it would break a gate that was green.",
      redDisposition: "Retrieval writes no excerpt, so there is no behaviour a redCommand could hold red: the run's mechanical entry point cannot run at all until wave 2 has produced a .typ to check. The per-task Verify channel adjudicates the files this row is responsible for.",
      refs: [
        "/home/eh/projects/workflows/skills/elide-case/references/authenticity.md",
        "/home/eh/projects/workflows/skills/elide-case/references/retrieval.md",
      ],
    },
    // ── WAVE 2: ONE ROW PER READING. Copy this row for each `## Readings In Scope` line,
    // substituting the slug, caption, source basename and page target. Each row cuts its own
    // reading, so `tasksThatFlagged` on a FAIL names exactly the readings to re-cut. Each writes
    // ONE fragment and never `docs/` — that is what makes the wave disjoint.
    {
      id: "cut-<slug>",
      name: "cut <caption>",
      work: "ONE READING, CUT ONLY. Write the excerpt into addenda/NN-addendum-<slug>.typ, from the docs/<name>.westlaw.docx the `retrieve` task saved and from nothing else; check-quotes.py projects that docx to text in memory, so read it the same way rather than writing one out. THE EXCERPT INHERITS THE COURT'S ITALICS FROM THE SOURCE and must neither invent nor drop them: a case name the projection carries as `_Weinberger_` is set as `_Weinberger_` in the .typ, and emphasis the source does not carry is not added. You do not write docs/; if the source is missing or unreadable, stop and report it rather than retrieving it yourself. Keep only the transaction structure, the analysis of the ONE thread the plan's Doctrinal target section quotes, and the reasoning that puts the case in tension with the assigned reading it names. Holding-taught means the disposition and rule statement survive; reasoning-taught means the analytical steps do. Caption block and judge line follow addenda/01-addendum.typ. EDITORS' NOTE — the default is NO note (instructor, 2026-09-10). Write one only when this reading needs BACKGROUND the student cannot read the case without: prior history of the same litigation, an earlier related decision, or real-world context. The mechanical conventions — the elision mark, footnotes omitted except as indicated and renumbered, record citations dropped without notation — are stated ONCE in the addendum's preamble and cover every reading; do not repeat them per reading. Elision marks and the disclosure rule are in editing-marks.md — record citations, party-brief citations, string cites and internal cross-references may go silently; a dropped substantive footnote, qualifier, alternative holding or dissent may not, and a disclosure specific to THIS reading (e.g. it retains footnote 16 renumbered as 1) goes in this reading's own note. SOURCE MAPPING: check.sh derives each reading's source from its caption and resolves it to the .docx. When that derivation is wrong or ambiguous, declare the file with `// elide-source: <basename.westlaw.docx>`, whose syntax and placement are in editing-marks.md — never point it at a loosely related file to quiet a NOSOURCE, and note that it names a file that must exist, so it cannot exempt anything. You may NOT declare a reading non-court text: `// elide-unchecked:` is no longer honoured and writing one is itself a FAIL, because the agent writing the excerpt cannot be the one who switches the verbatim check off on it. A reading with no reporter source stops and reports to the instructor, who declares it in the plan's `## Non-court readings` section.",
      writablePaths: ["addenda/NN-addendum-<slug>.typ"],
      dependsOn: ["retrieve"],
      // Task-specific: check-quotes.py for THIS caption alone. Not the run's entry point — a task
      // graded by the shared command can be reported done because a DIFFERENT task's work made it
      // pass, which leaves craft's per-task Verify channel nothing task-specific to judge.
      acceptance: "python3 /home/eh/projects/workflows/skills/elide-case/scripts/check-quotes.py /home/eh/areas/secreg/addenda/NN-addendum-<slug>.typ /home/eh/areas/secreg/docs/<name>.westlaw.docx --caption '<this reading's caption>' --skip-editorial exits 0, having checked a non-zero number of sentences for that caption.",
      redDisposition: "The behaviour this task must satisfy is already executed by the run's one mechanical entry point, whose check-quotes.py leg is red before the excerpt exists and green after; a redCommand here would be that same command run a second time by a second agent.",
      refs: [
        "/home/eh/projects/workflows/skills/elide-case/references/authenticity.md",
        "/home/eh/projects/workflows/skills/elide-case/references/editing-marks.md",
      ],
    },
    // ── WAVE 3: alone, so its two writable paths collide with nothing.
    {
      id: "compile-table",
      name: "compile, then write the table from the computed rows",
      work: "Assemble the per-reading fragments into addenda/NN-addendum.typ in the plan's Readings In Scope order, compile via teaching:generate-addendum, then run check-addendum.py --target and paste ITS computed rows into the summary table. THE PREAMBLE CARRIES THE MECHANICAL CONVENTIONS FOR THE WHOLE DOCUMENT — one sentence covering the elision mark, footnotes omitted except as indicated and renumbered, and record citations dropped without notation. This row owns that sentence, because it owns the preamble; a per-reading note repeating it is the boilerplate the 2026-09-10 rule removes. Never hand-edit a range to make the checker pass — the checker is reporting the truth about the PDF. On a length or arity miss, fix the offending READING's fragment and recompile; do not rewrite a fragment this row did not break.",
      writablePaths: ["output/addenda", "addenda/NN-addendum.typ"],
      // Task-specific: check-addendum.py's own arity, table-truth and length legs against the
      // compiled PDF. The run's entry point stays the WHOLE mechanical verdict without also being
      // this task's only grader.
      acceptance: "python3 /home/eh/projects/workflows/skills/elide-case/scripts/check-addendum.py /home/eh/areas/secreg/addenda/NN-addendum.typ /home/eh/areas/secreg/output/addenda/NN-addendum.pdf --target <the page target the plan's `## Readings In Scope` rows carry; when the rows differ, run the run's entry point instead, which reads each row's own target> exits 0 — summary-table rows equal readings found (arity), every stated page range matches the compiled PDF (table truth), and each reading is inside its target (length).",
      dependsOn: ["cut-<slug>" /* , one id per reading row; `retrieve` is reached transitively */],
      redDisposition: "Work whose whole acceptance is the run's mechanical entry point; craft re-runs that command in a shell to adjudicate it, so a redCommand would duplicate the gate rather than gate the task.",
      refs: [
        "/home/eh/projects/workflows/skills/elide-case/references/authenticity.md",
        "/home/eh/projects/workflows/skills/elide-case/references/verification.md",
      ],
    },
  ],

  // ── legibility and fidelity are `scoredChecks`, and that is WHY they are advisory. ──
  // A `reviewLenses` entry gates by construction: craft's workflow.js computes overallPass FROM
  // surviving lens findings, so declaring these two as lenses and calling them advisory in prose
  // would be a claim about the spine rather than a parameter to it. `scoredChecks` is the mechanism
  // that carries the property: overallPass is computed without reading any scored value, there is no
  // threshold and no blockBelow, it opens no selector channel, and a dead agent does not flip the
  // verdict (craft/references/scored-checks.md, S6/S7). That is ~/.claude/CLAUDE.md rule 9 satisfied
  // structurally — an open-ended prose review cannot gate a loop, because round n's fix gives round
  // n+1 new things to object to.
  //
  // ONE ITEM PER READING, so a score reads per reading exactly as a task does. Each agent returns
  // RAW COUNTS and never sees the weights below, which is what stops a self-graded score.
  scoredChecks: [
    {
      key: "legibility",
      items: ["<caption>" /* , one per `## Readings In Scope` row */],
      agentType: "Explore",
      refs: ["/home/eh/projects/workflows/skills/elide-case/references/editing-marks.md"],
      prompt: "Read this reading's excerpt in addenda/NN-addendum.typ as a student would, with no access to the full opinion. Count ONLY these five defect kinds, and report COUNTS plus the offending sentences verbatim: (1) unparsable — a sentence that does not parse as a sentence; (2) fusedElision — an elision that joins two fragments into something the court did not write; (3) danglingReferent — a pronoun or 'it'/'that' whose referent was cut; (4) unattributedQuote — a block quote whose speaker is not identifiable from the excerpt alone; (5) undefinedTermOfArt — a term of art used before it is introduced. Anything outside those five is not counted here. `itemsChecked` is the number of sentences you actually read; report 0 only if you read none, which marks the item unreliable rather than clean.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["itemsChecked", "unparsable", "fusedElision", "danglingReferent", "unattributedQuote", "undefinedTermOfArt"],
        properties: {
          itemsChecked: {type: "integer"},
          unparsable: {type: "integer"},
          fusedElision: {type: "integer"},
          danglingReferent: {type: "integer"},
          unattributedQuote: {type: "integer"},
          undefinedTermOfArt: {type: "integer"},
          offendingSentences: {type: "array", items: {type: "string"}},
        },
      },
      passthrough: ["offendingSentences"],
      components: [
        {name: "reads", weight: 1.0, base: 10, penalties: {unparsable: 2.0, fusedElision: 2.0, danglingReferent: 1.0, unattributedQuote: 1.0, undefinedTermOfArt: 0.5}},
      ],
    },
    {
      key: "fidelity",
      items: ["<caption>" /* , one per `## Readings In Scope` row */],
      agentType: "Explore",
      refs: ["/home/eh/projects/workflows/skills/elide-case/references/authenticity.md"],
      prompt: "Verbatim matching cannot see misrepresentation. Judge whether the CUT misrepresents the opinion, reading this reading's excerpt against its full source docs/<name>.westlaw.docx. Count ONLY these four, and report COUNTS plus the excerpt passage and the source line for each: (1) quotedAsOwnReasoning — a passage the court QUOTES FROM ANOTHER CASE presented as the court's own reasoning; 02-addendum did exactly this, rendering a Life Partners block quote as running text inside the Mutual Benefits excerpt, where the Eleventh Circuit quotes it in order to REJECT it; (2) unqualifiedHolding — a holding stated without the qualifier that limits it; (3) omittedAlternativeHolding — an omitted alternative holding that changes what the case stands for; (4) dissentAsMajority — a dissent's language read as the majority's. `itemsChecked` is the number of excerpt passages you traced back to the source; 0 marks the item unreliable rather than clean.",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["itemsChecked", "quotedAsOwnReasoning", "unqualifiedHolding", "omittedAlternativeHolding", "dissentAsMajority"],
        properties: {
          itemsChecked: {type: "integer"},
          quotedAsOwnReasoning: {type: "integer"},
          unqualifiedHolding: {type: "integer"},
          omittedAlternativeHolding: {type: "integer"},
          dissentAsMajority: {type: "integer"},
          offendingPassages: {type: "array", items: {type: "string"}},
        },
      },
      passthrough: ["offendingPassages"],
      components: [
        {name: "faithful", weight: 1.0, base: 10, penalties: {quotedAsOwnReasoning: 3.0, unqualifiedHolding: 2.0, omittedAlternativeHolding: 2.0, dissentAsMajority: 3.0}},
      ],
    },
  ],

  // ── reviewLenses is DELIBERATELY ABSENT, not `[]`. ──
  // Passing `[]` does not disable review: craft falls back to its own two defaults,
  // `criteria-vs-artifacts` and `scope-fidelity`, and they gate. That fallback is CHOSEN here. Those
  // two judge whether the plan's own stated criteria were met and whether the run stayed inside
  // `addenda/`, `output/addenda/` and `docs/` — both decidable against the plan text, both bounded,
  // and the second is the only thing standing between a dispatched implementer and `notes/`. What
  // must NOT gate is the open-ended prose reading of the excerpt, and that is precisely what moved
  // to `scoredChecks` above.


  authorityExtra: "DOMAIN RULE — every word of the excerpt is authentic reporter text, cut from the .westlaw.docx retrieved THIS RUN into docs/ and projected to text in memory — never from a .txt written beside it, which is not produced. Never from memory, a Teacher's Manual summary, a casebook note, or a previous excerpt. DOMAIN RULE — the summary table is written after the compile, from the checker's computed rows; never hand-edit a range to make the checker pass. WRITE SURFACE — addenda/, output/addenda/ and docs/ only. notes/, slides/ and templates/ are excluded, and notes/07-security.typ may be open in the user's editor. THE TYPST CORPUS IS ONE COMMAND AWAY, AND IS NOT IN YOUR REFS. Run `typst-rules notes,prose` for the index, then read the ones your edit touches; it is on PATH and needs no path or plugin variable. Do not work from a paraphrase of these rules.",

  maxAgents: 50,
}
```

## Phase 5 — HUMAN REVIEW

Craft's Phase 5, on the compiled PDF: the reviewer reads the reading, not the diff. Open the PDF
beside `human-review-gate.sh -w`.

### Where the legibility and fidelity scores actually are

**They are in `result.json` under `scores[]`, and nothing delivers them.** Craft returns each item's
computed score, its raw counts, and — because `passthrough` declared them — the verbatim offending
text under `evidence`. Phase 5 is a human step, so no exit code can compel anyone to look. Print them
with one command:

```bash
jq -r '.scores[] | "\(.key)  \(.item)  composite=\(.composite // "null")  itemsChecked=\(.itemsChecked // "n/a")  \(.reason // "")",
       "  components: \(.components // {} | tojson)",
       "  evidence:   \(.evidence   // {} | tojson)"' \
  /home/eh/.local/state/craft/<run-id>/result.json
```

The field is `composite`, not `score` — craft emits one `scores[]` entry per (key, item) pair as
`{key, item, components, composite, itemsChecked, evidence, reason?}`, and there is no cross-item
mean or total to read.

**This is an INSTRUCTION, not a gate, and the distinction is the whole design.** The scores cannot
fail the run by construction — that is exactly why they are `scoredChecks` and not `reviewLenses` —
and therefore a reviewer who does not run that command does not see them. That is the accepted cost
of their not gating, and it is stated here rather than papered over with a sentence claiming they are
"reported".

**If that cost is unacceptable on a given run, the remedy is NOT to move them back to `reviewLenses`**
— that reinstates the non-terminating prose gate rule 9 forbids — it is for the instructor to read
the excerpt himself, which is what Phase 5 is for.

When the reviewer does want them in the findings file, write `result.json`'s `scores[]` there before
opening the PDF, one section per reading, naming the fields:

```
## Advisory scores — legibility and fidelity (these gate nothing)

### <caption>
legibility  composite <n>/10   itemsChecked <n>
  unparsable <n> · fusedElision <n> · danglingReferent <n> · unattributedQuote <n> · undefinedTermOfArt <n>
  evidence.offendingSentences:
    - "<verbatim sentence>"
fidelity    composite <n>/10   itemsChecked <n>
  quotedAsOwnReasoning <n> · unqualifiedHolding <n> · omittedAlternativeHolding <n> · dissentAsMajority <n>
  evidence.offendingPassages:
    - "<verbatim excerpt passage, and the source line it was traced to>"
```

Three rules on the rendering, because each is a way the output silently stops meaning anything:

- **`evidence.offendingSentences` and `evidence.offendingPassages` are the whole point of the
  passthrough declarations** — the counts say how many, the evidence says which. Render the verbatim
  text. A section showing counts with no evidence gives the reviewer nothing to act on.
- **A `null` `composite` is rendered as `null` WITH its stated `reason`** — never as `0`, never as a blank,
  never omitted. `null` means the item was unreliable or its agent died; `0` means it was measured
  and scored zero. Collapsing them turns "nothing checked this reading" into "this reading is bad",
  and the reviewer cannot tell.
- **`scores: []` with `scoresRun`/`scoresReported` as `null` is n/a, not clean.** Say the phase did
  not run rather than printing an empty section that reads as nothing found.

The reviewer decides what to do with all of it. A low score re-runs nothing by itself — see *The FAIL
loop*.

## The FAIL loop — craft's three selectors, and where the per-reading granularity comes from

The selector is craft's own, all three channels, consumed together: `tasksThatFlagged`,
`mechanicalThatFailed` and `lensesThatFlagged`. A scoped re-run is `onlyTasks` + `priorResults`,
derived by `work-redispatch.sh` from those three. **There is no caption channel** — craft scopes by
task id and nothing else, so a re-run instruction phrased as "re-cut the failing caption" names a
dimension craft does not have and cannot be executed.

**Per-reading re-cutting falls out of one task per reading, not out of any caption machinery.**
Because each reading is its own task row, a reading that fails puts its own id in `tasksThatFlagged`,
and `onlyTasks` re-runs exactly that reading. A four-reading addendum keeps the three readings the
gate already adjudicated — re-cutting them manufactures new surface for the next round.

`mechanicalThatFailed` names `elide-check`, whose leg lines name the failing reading; map that name
back to its task id to read what `onlyTasks` will hold. Two domain rules on the fix, both in
`references/verification.md`:

- A miss rate above roughly a quarter is the wrong source, not bad sentences. **Re-cut the reading
  from `docs/<name>.westlaw.docx`; never patch sentence by sentence.**
- Never trust a corruption tell you have not grepped for in **both** files.

`lensesThatFlagged` names craft's own two defaults, `criteria-vs-artifacts` and `scope-fidelity` —
the only lenses this run declares. **The legibility and fidelity scores appear in no selector at
all**: `scoredChecks` opens no channel, which is the same fact as their not gating. A low score is
read by the human at Phase 5 and acted on there or not at all; it never re-runs anything by itself.
A `null` score with a stated reason means the item was unreliable or its agent died — not clean.

## The rule for whoever edits this next

**Any property this file asserts about craft must be traceable to a parameter craft reads or to a
command's exit code. Otherwise it is decoration.** Three times in this skill's construction a property
was written as a sentence and bound nothing, and a fourth is recorded below: a re-run selector declared to be a "caption", a dimension
craft has no channel for; two lenses declared ADVISORY while sitting in `reviewLenses`, which craft
gates on; and an interview refusal declared absolute when no mechanism could carry it — the plan is
written by the orchestrator, so a grep of it cannot identify the answerer, and `mechanicalChecks` run
after IMPLEMENT, so none of them can stop a run at CLARIFY. The first two now rest on a parameter —
the task-id selector and `scoredChecks`. The third was **scoped down** instead: `check.sh --plan`
proves only that the answers are recorded and non-empty, and the instructor's approval of the plan is
named as the step that carries the rest.

The fourth was the scored checks being "reported to the human". Craft's Phase 5 is a human step, so no
exit code can compel a human to read a score, and three review rounds said so before the claim came
out. It too was scoped down rather than re-promised: the scores are **retrievable** at a named `jq`
command over `result.json`, a reviewer who does not run it does not see them, and that is the accepted
cost of their not gating.

**So: when no parameter and no exit code can carry a property, SCOPE THE CLAIM DOWN to what the
mechanism does prove, and name the human step that carries the remainder.** An honest smaller claim
beats a bigger one nothing enforces. Before writing "this workflow does X", name the parameter or the
command that makes X true — and if there is none, say so plainly where the claim would have gone.

## Red flags — STOP if you catch yourself

| About to | Do instead |
|---|---|
| Answer either CLARIFY question yourself | Stop and ask, or report that the interview is unanswered. Nothing mechanical can catch a self-answer — the plan is written by the orchestrator, so only the instructor's approval distinguishes his answers from yours |
| Ask about a passage to keep, or about the insertion point | Both were declined; insertion point and class number come from the request or the schedule. The page target IS asked — question 3 |
| Type a `--target` on a real run, or invent a range to fit the excerpt | The target lives in the plan, per reading. With `--plan` the flag is ignored and said to be ignored; `--target` is the `--no-plan` fixture override |
| Leave a `## Readings In Scope` page target blank or `TBD` | The `--plan` leg FAILS naming the row. Ask question 3, or take the 2-6 default |
| Let a legibility or fidelity finding block the run | They are `scoredChecks`, which craft's `overallPass` never reads — the deterministic gate is the entry point's exit code |
| Declare legibility or fidelity in `reviewLenses` because it "reads like a lens" | A lens gates by construction; the advisory property has to be a parameter, not a sentence. Keep them in `scoredChecks` |
| Pass `reviewLenses: []` to turn review off | `[]` falls back to craft's two defaults. Omit the key and say in the plan that those two are the chosen set |
| Add a threshold or `blockBelow` to a scored check | No such knob exists, and adding one chases minors. Read the score; gate on the entry point |
| Add a second `mechanicalChecks` entry | The verdict is one command; P10 refuses a list, and a list drops a check without reporting it |
| Write a `workflow.js` for this skill | Craft's spine takes a parameter for it. Name the missing parameter and generalize craft |
| Give every reading row `docs` in its writable paths | Craft refuses a wave with overlapping writable paths before dispatch. `retrieve` owns `docs/` in wave 1; the cut rows write one fragment each |
| Write "this workflow does X" with nothing reading X | Name the parameter or the exit code that makes it true, or record that none does — see *The rule for whoever edits this next* |
| Write that the scores "are reported to the human" | Nothing reports them. They sit in `result.json` under `scores[]`; Phase 5 names the `jq` command that prints them, and a reviewer who does not run it does not see them |
| Re-cut every reading after one FAIL | Re-run `onlyTasks` on the flagged reading's task id — one task per reading is what makes that possible |
| Scope a re-run "by caption" | Craft has no caption channel; the selector is `tasksThatFlagged` + `mechanicalThatFailed` + `lensesThatFlagged` |
| Silently skip a reading that has no reporter source | Stop and report it. The instructor declares it in the plan's `## Non-court readings` section; an undeclared one FAILS, which is the point |
| Write `// elide-unchecked:` into the `.typ` to quiet a reading | That marker is self-exempting and is no longer honoured — its presence FAILS. Non-court text is declared in the plan, by the instructor |
| Omit both `--plan` and `--no-plan` from the entry point's `cmd` | That is a FAIL naming the missing flag — the leg fails closed. Pass `--plan <md>` on a real run; `--no-plan` is the fixture escape and prints a loud NOT CHECKED line |
| Say the workflow "cannot arm" or "does not proceed" without the interview | No mechanism carries that. Say what does: the answers are recorded in the plan, the instructor approves the plan before the run arms, and `check.sh --plan` refuses a plan whose section is missing or unfilled |
| Write an editors' note on every reading | The default is NO note (instructor, 2026-09-10). One exists only for BACKGROUND — prior history, an earlier related decision, real-world context — or a disclosure specific to that one reading |
| Repeat the elision-mark and footnote conventions in each reading's note | They are stated ONCE in the preamble and cover the whole document. That repetition is the boilerplate the reversal removed |
| Reword the court's text to close a widow | The fix vocabulary is LAYOUT-ONLY — spacing, or where the page breaks. Rewording defeats the verbatim gate; if the two conflict, fidelity wins and the widow stands |
| Pass `--no-widows` on a real run | It waives the page-break leg and prints a loud NOT CHECKED line. The leg is on by default; leave it on |
| Write a `.westlaw.txt` beside the docx, or cut from one | The docx is the only stored source and its projection is in memory. The twin that existed dropped the docx's italic runs, and the cut read only the twin — that is how a 27-page excerpt shipped with every case name in roman |
| Add emphasis the source does not carry, or set a source italic in roman | The excerpt inherits the court's typography. Invented emphasis and dropped emphasis are both misquotation, and neither is caught by matching words alone |
| Re-create a `.westlaw.txt` for a case whose docx is in `docs/` | The six that existed were deleted on 2026-09-10 and both gates re-ran green against the docx, so nothing needs one. A `.txt` naming survives only where the fallback route produced it, and `// elide-source: X.westlaw.txt` resolves to the `.docx` rather than failing |
| Read a CourtListener/RECAP `.txt` and assume its typography | That route is a court PDF with **no formatting layer** — italics are unrecoverable there, not merely unchecked. The gate prints ITALICS NOT CHECKED for it; the route stays, because Westlaw does not carry every case |
| Hand-edit a table range so the checker passes | Fix the source and recompile |

## Not invocable yet — read this file by path

`skills/elide-case/` is **untracked in git**, so the plugin does not carry it: `Skill(workflows:elide-case)`
returns *Unknown skill*. Until the user commits the skill and reinstalls the plugin, this file is read
by path — `/home/eh/projects/workflows/skills/elide-case/SKILL.md`. **Do not commit or install it to
fix that.** It is the user's call, and it is recorded here rather than worked around.
