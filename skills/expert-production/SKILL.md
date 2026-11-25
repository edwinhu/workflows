---
name: expert-production
description: "ALWAYS use when the code, data and workpapers behind an expert report have to leave the machine as an expert-report production or a court production — 'build the expert production', 'court production', 'data production', 'production package', '7z the production', 'package this for counsel', 'production archive for the opposing expert', 'send the workpapers', 'they want the code and data behind the report', 'put together what the document request asks for', 'make the workbook for counsel', 'write the runbook for the production', 'they need to be able to rerun it'. Use proactively whenever an expert report or a document request implies handing over the underlying work, even when the user only says 'zip it up'. NEGATIVE ROUTING: building the analysis itself is `ds`; a Word deliverable is `expert-report-docx` or `docx-typst`; a single spreadsheet with no archive around it is plain `xlsx`."
user-invocable: true
metadata:
  rule-skills: none
---

# Expert production — a production package, run through `work` with a computed gate

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

The lifecycle is [`work`](${CLAUDE_PLUGIN_ROOT}/skills/work/SKILL.md). Read it and follow it.
This file is a **delta**: the CLARIFY axes, the production SPEC, the task rows, the lens, the one
mechanical entry point, the refs and the authority text. It ships no `workflow.js`.

**The package is judged by one command, never by the agents that built it.**
[`package-check.sh`](${CLAUDE_SKILL_DIR}/scripts/package-check.sh) rebuilds the 7z from the stage,
extracts it fresh and runs four legs over the extraction — `archive`, `code`, `leak`, `rerun` — on
the production SPEC at the sha256 the approved plan records. Its exit code is the whole mechanical
verdict; the lens judges only what no exit code decides. Every SPEC key, the `MANIFEST.csv` format
and the runbook command block: [`references/production-spec.md`](${CLAUDE_SKILL_DIR}/references/production-spec.md).

## Layout

Work in `production/` in the analysis repo, gitignored:

| path | holds | ships |
|---|---|---|
| `production/<name>/` | the stage: `code/` (the closure and its pinned environment), `data/`, `figures/`, the workbook, the runbook PDF, `README.md`, `MANIFEST.csv` | as the archive's one top folder |
| `production/<name>.7z` | the archive, beside the stage, never inside it | yes |
| `production/<name>-runbook/` | the runbook Markdown and its screenshots | never |
| `production/<name>.spec.json` | the production SPEC, the gate's input | never |

## Production rules

**Scope is the computed closure.** Walk the import graph from the SPEC's `entry_scripts` and ship
that closure, the processed data it reads, the figures the deliverable uses, the workbook and the
runbook PDF; nothing else is owed. Delete superseded exhibits, alternate versions and the code that
builds them. Shrink a config shared with another study to the constants the shipped code reads.
Never explain an omission: the explanation names the thing.

**Final work product only.** Ship nothing that records how the result was reached: no drafts, prompt
iterations, agent reports, working notes, batch or job ids, or names of RAs and staff. The replay
set — the decisions file, the `manifest/` dir and the replay command
([`references/replay.md`](${CLAUDE_SKILL_DIR}/references/replay.md)) — is internal: `ds` runs it as
its R1 check, and it never ships. Strip every comment and docstring from the packaged code with
[`strip_code.py`](${CLAUDE_SKILL_DIR}/scripts/strip_code.py), never a regex; never touch the repo's
own code.

**Processed data, never raw.** Ship the processed tables the packaged code loads (CSV or parquet).
Raw sources — filings, downloaded corpora, vendor extracts — stay out; the runbook says how to
retrieve them. Never ship one table in two formats.

**7z, never zip.** Zip stores mtime at two-second resolution with no timezone. Build with
`bsdtar --format 7zip`, one top folder named for the production.

**Stage with `cp -p`; `MANIFEST.csv` is the last write.** Only stripped or rewritten files carry a
staging mtime. Run [`manifest.py`](${CLAUDE_SKILL_DIR}/scripts/manifest.py) after the last change to
the stage; the archive leg checks every row against a fresh extraction, never against the stage.

**Never run, lint or test inside the stage.** A `__pycache__`, `.ruff_cache` or `.pytest_cache`
there fails the archive leg; copy the stage elsewhere to try it.

**Scrub every metadata field but the two dates, inside the build.** Keep the creation and
modification dates; strip author, title, generator and OS strings, PDF Info and XMP, OOXML
`docProps` and PNG text chunks. Scrub after the last generation step and before the manifest:
[`scrub_metadata.py`](${CLAUDE_SKILL_DIR}/scripts/scrub_metadata.py) for the workbook and PNGs;
`build-runbook.sh` scrubs its own PDF. Fix a generator that stamps a fixed creation date (python-docx
does) in the build, never in the scrub.

**Timestamps are not proof.** File mtimes, the manifest column, `dcterms:created` and the PDF
`CreationDate` are the producing party's own assertion: never call them proof of when work was done,
to the client or in a declaration. Anchor time with a party that has no stake — a hash stated in a
filed document; a DKIM-signed email, for what actually arrived; an RFC 3161 token over the archive's
sha256 from a public TSA (`openssl ts -query`, the `.tsr` kept beside the archive), sent only with
the user's approval and never with the file. Git commit dates are not an anchor.

**Redact by destroying pixels.** Crop, or paint the raster with a solid fill before it enters the
document (`magick raw.png -fill '#fff' -draw 'rectangle x1,y1 x2,y2' out.png`). A box drawn over an
image or text still extracts with `pdfimages` or `pdftotext`, and pixelation over a known font is
recoverable. Keep the raw capture outside the stage and the runbook dir.

### The workbook

Build it with the `xlsx` skill: one tab per processed table, then computation tabs recomputing every
headline number with LIVE formulas (`COUNTIFS`, `SUMPRODUCT`) over those tabs, never a typed value.
Zero formula errors; every total equals the deliverable.

**When a deliverable value differs from what the code produces**, the row carries a
`Hand-checked against the filing` flag column and a `Filing quote (hand check)` column filled from
that decision's `quote` field in the internal decisions file — the quote only, never its reason,
decider, date, decision id or pipeline value. List each entity the deliverable excludes as
`Not counted (hand-checked)`. Never copy the decisions file into the package.

### The README

The short path to reproduce the deliverable from the shipped data first, then the provenance table:
one row per figure and headline number, naming the number, the script or function computing it, its
input file and that file's row count. Read every value off the staged data, never out of the report.

### The runbook

A minimal, final PDF for a competent computer user who does not program:

- Write the Markdown at the SPEC's `runbook_source` and build the PDF with
  [`build-runbook.sh`](${CLAUDE_SKILL_DIR}/scripts/build-runbook.sh). Ship no `.md` or `.typ` copy.
- Per step: one sentence of purpose, the command, the output file. Counts only where they define a
  sample. No figures table; the README's provenance table holds it. Short path first.
- Each command alone in a fenced block whose info string is `command`, with no comments and paths
  relative to `runbook_cwd`, never a home path.
- A screenshot only where the layout is the instruction: crop to the element and shoot the vendor's
  documentation, never a signed-in console. A terminal step is text, never a screenshot.
- Disclose every dependency that costs money or gates access, and what a reader without it can do
  by hand.
- No history, reruns, corrections, overrides or decision records; no batch or job ids, personal
  names, validation scores, agreement rates or known-limits list. A check the report mentions gets
  one sentence of method inside its step.
- Never cite the report's paragraph or footnote numbers anywhere in the package; name a figure by
  what it measures.

## Phase 1 — CLARIFY

`work`'s Phase 1, on these axes, before any reconnaissance. Each answer becomes a SPEC key:

1. **Deliverable entry points** — the scripts that are the deliverable (a `.py` that only a shipped
   `.sh` runs is one of them), where their local imports live, the third-party modules they need,
   and the repo file each packaged `.py` comes from → `entry_scripts`, `python_paths`,
   `third_party`, `sources`.
2. **Recipient** — opposing expert, counsel or the court; what the request or order asks for; the
   transmission channel; the production's name → `name`.
3. **Processed data in scope** — the tables the closure loads and the figures the deliverable uses
   → `extra_files`.
4. **Workbook** — which headline numbers it recomputes, from which tabs → `workbook`.
5. **Overridden values** — where the deliverable departs from the code's output, and the internal
   decisions file recording each departure → the hand-check columns. The decisions file is never a
   SPEC path.
6. **Leak terms** — people, internal project and matter names, batch and job id patterns, the
   decisions file's name, `¶` and footnote cites, any username besides `$USER` → `leak_terms`,
   `usernames`.
7. **Offline re-run commands with reference outputs** — each command that regenerates an output from
   the shipped data with no network, the output it writes, the reference copy, and whether the match
   is byte for byte or after dropping volatile columns → `reruns`. Refuse "none": an empty `reruns`
   fails the gate.

Take `work`'s remaining axes as `work` states them, with three bindings: observable success is
`package-check.sh`; the review surface is Phase 5's; skip the agent-team axis, since the run writes.

Do not plan until every SPEC key has an answer.

## Phase 2 — PLAN

`work`'s Phase 2. Open the plan with frontmatter `workflow: expert-production`, so a context clear
at approval resumes here. Three domain additions:

- **Write the SPEC before `EnterPlanMode`** at `production/<name>.spec.json`, every key per
  `references/production-spec.md`. Never under the plans directory, which holds only the plan, and
  never in any task's `writablePaths`: an implementer that could edit it could edit what judges it.
- **Record its sha256 in the dispatch block** as the literal `--spec-sha256` argument of the one
  mechanical check, so approving the plan approves the SPEC.
- **The task table is the four rows of Phase 4**, each with `refs` and a `redDisposition`. Run
  sizing: 4 implementers + 4 verifiers + 1 lens = 9 agents.

## Phase 3 — GOAL

`work`'s Phase 3 unchanged.

## Phase 4 — the work call

Put the args in the plan's `<!-- work:dispatch -->` block and dispatch with `work`'s own
`work-dispatch.sh`, never a hand-written runner line, which skips its plan-lint and probe gates.
`work` owns the wait and the result handling; `work-result.sh` reads the verdict.

```bash
bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/work-dispatch.sh                    # armed plan; or pass one
bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/work-dispatch.sh --provider codex   # "run this through codex"
```

Forward a provider named in `$ARGUMENTS`, however it is spelled, as `--provider <name>`.

```js
const projectDir = /* the analysis repo */
const goal = /* one sentence */
const specPath = /* absolute path of production/<name>.spec.json */
const specSha = /* its sha256, recorded in the plan */
const stage = /* the SPEC's stage, relative to projectDir: production/<name> */
const archive = /* the SPEC's archive, relative to projectDir: production/<name>.7z */
const runbookDir = /* the dir holding the SPEC's runbook_source, relative to projectDir */
const workbook = /* the SPEC's workbook */
const runbookPdf = /* the SPEC's runbook_pdf */
const args = {
  projectDir,
  goal,

  // The plan's table verbatim. Every row carries refs and a redDisposition.
  tasks: [
    { id: "T1",
      name: "stage the code closure",
      work: "Walk the import graph (ast) from the SPEC's entry_scripts, resolving local imports against its python_paths, and stage exactly that closure plus the pinned environment file (pixi.toml and pixi.lock, or requirements.txt) under the stage's code/ dir with cp -p. Reduce a shared config to the constants the shipped code reads. Then strip every staged .py with `python3 -I ${CLAUDE_PLUGIN_ROOT}/skills/expert-production/scripts/strip_code.py --in-place <files>`, which keeps a __doc__ assignment for a module that reads __doc__ and refuses a file that would not parse. Never run, lint or test the staged copy in place, and never edit the repo's own code.",
      writablePaths: [`${stage}/code/`],
      acceptance: "Every .py under code/ is reached by the import walk from an entry script, every local import in code/ resolves to a file under code/, and no staged .py holds a COMMENT token (a line-1 shebang aside) or a docstring.",
      redDisposition: "no-behaviour: a staged artifact; package-check.sh judges the package whole",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/expert-production/SKILL.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/expert-production/references/production-spec.md"] },

    { id: "T2",
      name: "stage processed data, figures and the workbook",
      work: "Copy with cp -p the processed tables the closure loads (the SPEC's extra_files) into data/ and the figures the deliverable uses into figures/: never a raw source, never one table in two formats. Build the workbook with the xlsx skill per this skill's workbook rules: one tab per processed table, live formulas recomputing every headline number, zero formula errors, totals equal to the deliverable. Where the deliverable departs from the code's output, fill the 'Hand-checked against the filing' flag and the 'Filing quote (hand check)' column with that decision's quote alone, read from the internal decisions file, and list each excluded entity as 'Not counted (hand-checked)'. Never copy the decisions file. Last, scrub the workbook and every PNG with `uv run ${CLAUDE_PLUGIN_ROOT}/skills/expert-production/scripts/scrub_metadata.py <files>`.",
      writablePaths: [`${stage}/data/`, `${stage}/figures/`, `${stage}/${workbook}`],
      acceptance: "Every extra_files path exists in the stage; each headline number is a cell holding a formula in the workbook's sheet XML, and no cell holds #REF!, #DIV/0!, #VALUE! or #NAME?; the workbook's docProps/core.xml holds only dcterms:created and dcterms:modified.",
      redDisposition: "no-behaviour: a staged artifact; package-check.sh judges the package whole",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/expert-production/SKILL.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/expert-production/references/production-spec.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/expert-production/references/replay.md"] },

    { id: "T3",
      name: "write and build the runbook",
      work: "Write the runbook Markdown at the SPEC's runbook_source, its screenshots beside it, per this skill's runbook rules: each command alone in a fenced block whose info string is command, paths relative to runbook_cwd. Crop or paint redactions into the raster before embedding. Build the PDF into the stage with `bash ${CLAUDE_PLUGIN_ROOT}/skills/expert-production/scripts/build-runbook.sh --source <runbook_source> --out <stage>/<runbook_pdf> --date <production date>`, which wraps long commands, compiles with Typst and scrubs the metadata. Neither the Markdown nor the screenshots ship.",
      writablePaths: [`${runbookDir}/`, `${stage}/${runbookPdf}`],
      acceptance: "The runbook PDF exists in the stage, pdfinfo prints no Title, Author, Creator or Producer line for it, and every command block of the runbook source appears in its pdftotext output once whitespace and backslash continuations are joined.",
      redDisposition: "no-behaviour: a staged artifact; package-check.sh judges the package whole",
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/expert-production/SKILL.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/expert-production/references/production-spec.md"] },

    { id: "T4",
      name: "README provenance table, MANIFEST and archive",
      work: "Write README.md per this skill's README rules: the short path first, then the provenance table, one row per figure and headline number with the script or function, the input file and its row count, each read off the staged data and never copied from the report; nothing about work outside the deliverable. Then, as the last write to the stage, run `python3 -I ${CLAUDE_PLUGIN_ROOT}/skills/expert-production/scripts/manifest.py <stage>`, and build the archive with `bsdtar --format 7zip -cf <archive> -C <stage parent> <name>`.",
      writablePaths: [`${stage}/README.md`, `${stage}/MANIFEST.csv`, archive],
      acceptance: "README.md holds a provenance table with a row-count column; MANIFEST.csv has the header path,bytes,sha256,modified_utc and exactly one row per staged file but itself; bsdtar -tf on the archive lists a single top folder named for the production.",
      redDisposition: "no-behaviour: a staged artifact; package-check.sh judges the package whole",
      dependsOn: ["T1", "T2", "T3"],
      refs: ["${CLAUDE_PLUGIN_ROOT}/skills/expert-production/SKILL.md",
             "${CLAUDE_PLUGIN_ROOT}/skills/expert-production/references/production-spec.md"] },
  ],

  // ONE entry point: four legs, none short-circuiting; a new deterministic check is a leg of
  // package-check.sh, never a second entry. The sha256 is the literal the plan records.
  mechanicalChecks: [
    { name: "production",
      cmd: `bash ${CLAUDE_PLUGIN_ROOT}/skills/expert-production/scripts/package-check.sh --spec ${specPath} --spec-sha256 ${specSha}` },
  ],

  // One lens after verification and the gate: only the residue no exit code decides.
  lens: {
    agentType: "Explore",
    refs: ["${CLAUDE_PLUGIN_ROOT}/skills/expert-production/SKILL.md",
           "${CLAUDE_PLUGIN_ROOT}/skills/expert-production/references/production-spec.md"],
    prompt: "Judge the staged production at the SPEC's stage path against the approved plan, its production SPEC and the goal. Read both refs in full first. package-check.sh has already decided the archive against MANIFEST.csv, caches, one table in two formats, the import closure resolving, every packaged .py being reached from an entry script or a runbook command, parsing, ruff against the source, comments and docstrings, paths, usernames, leak terms and metadata in every artifact, workbook error cells and a workbook with no formula, the offline reruns, and every runbook command surviving into the PDF and naming a shipped script — never re-judge any of that. CHECKLIST, every item in scope on every run: (1) SCOPE BEYOND THE CLOSURE — the gate proves every shipped .py is reached, not that every other file is owed: a figure or table the deliverable does not use, raw source data, a config constant no shipped code reads, or a README or runbook sentence about work outside the deliverable is a finding. (2) README PROVENANCE — one row per figure and headline number, naming the number, the script or function computing it, its input file and that file's row count; open the input and confirm the number and the row count from the data. (3) WORKBOOK — whether the formulas are the RIGHT ones: read the sheet XML (unzip -p on the workbook) or load it with formulas kept; every headline number is a live formula over the data tabs that computes that number, not a typed value, and totals equal the deliverable; a row where the deliverable departs from the code's output carries 'Hand-checked against the filing' and a 'Filing quote (hand check)' holding the quote alone, with no reason, decider, date or decision id; an excluded entity is listed as 'Not counted (hand-checked)'. (4) RUNBOOK — read its text with pdftotext: per step one sentence of purpose, the command and the output file; no history, reruns, corrections or overrides, no validation scores or agreement rates, no known-limits list, no personal names, and no paragraph or footnote number of the report. (5) SCREENSHOTS — extract the runbook's images with pdfimages into a fresh mktemp -d dir outside the tree and view each, with every shipped figure: a URL bar, avatar, account name, tab strip, home directory, or a redaction drawn over pixels rather than destroying them is a finding. Severity is MAJOR at minimum, CRITICAL where the item puts deliberation, an override's reasoning or raw source data into the package. MODE — RED (a task was flagged or a mechanical check failed): diagnose EVERY failure in the digest and route it, naming cause and fix, to the task id whose writablePaths own the file, or to 'plan' when no task can own the fix. MODE — GREEN (everything passed): make one open-ended pass over the whole checklist and report each finding with an ownerTask. In both modes, rule every carried finding open or closed against evidence you actually read; silence leaves it open.",
  },

  authorityExtra: [
    "FINAL WORK PRODUCT ONLY. The package carries the deliverable's code closure, the processed data it reads, the figures it uses, the workbook, the runbook PDF, README.md and MANIFEST.csv, and nothing that records how the result was reached. The replay set (the decisions file, the replay manifest dir and the replay command) is internal and never ships; neither do drafts, prompt iterations, agent reports, working notes, raw source data, batch or job ids, personal names, override or correction history, validation scores, known-limits lists, or the report's paragraph or footnote numbers.",
    "THE SPEC IS THE GATE'S INPUT. The production SPEC (production/<name>.spec.json, outside the stage) was approved by its sha256; no task writes it, and package-check.sh refuses a SPEC whose hash moved. The production rules are ${CLAUDE_PLUGIN_ROOT}/skills/expert-production/SKILL.md; the SPEC, MANIFEST.csv and command-block formats are ${CLAUDE_PLUGIN_ROOT}/skills/expert-production/references/production-spec.md.",
    "THE STAGE IS NEVER A WORKING DIRECTORY. Copy into it with cp -p; never run, lint or test anything inside it, since a cache written there fails the archive leg. MANIFEST.csv is the last write to the stage. Every change lands in the staged copy, never in the repo's own files.",
  ].join("\n"),

  verifierAgentType: "Explore",
}
```

Pin `verifierAgentType` and the lens `agentType` to `Explore`: no Edit and no Write, so a judge
cannot modify the package it judges, and Bash stays for `unzip`, `pdftotext` and `pdfimages`. Leave
`implementerAgentType` unset: the rows copy, strip, build and scrub with scripts, and no custom
prompt, hook or preloaded skill justifies an agent.

Handle the result per `work`'s Phase 4; `mechanicalThatFailed` names `production`, and its
`leg <name> exit=<n>` lines name the failing leg.

## Phase 5 — HUMAN REVIEW

`work`'s Phase 5, with two bindings.

**Review before transmission.** A sent production cannot be recalled, which is the irreversible case
`work` reserves review-before-delivery for.

**Review the extracted archive plus a findings file, never a repo diff.** The stage is gitignored,
so `-w` returns `unreviewed`. Extract the archive the gate rebuilt into a fresh review folder, write
`work`'s read-only findings file into the same folder, and open both with one `--file`:

```bash
V=.work/<run-id>/review; mkdir -p "$V"
bsdtar -xf production/<name>.7z -C "$V"     # exactly what the recipient will open
# write "$V/findings.md": transcribed from result.json per work's findings-file table
bash ${CLAUDE_PLUGIN_ROOT}/skills/work/scripts/human-review-gate.sh --file "$V" --no-update-check
```

Write `findings.md` per `work`'s *What the findings file must contain* — transcription, not
judgement — with the four `leg <name> exit=<n>` lines copied verbatim from `mechanical[]`. Open the
runbook PDF and the workbook beside tuicr. On `approved`, transmit through counsel's file-transfer
service and confirm receipt; mail filters strip archive attachments.

## Red flags

| Situation | Wrong move | Right move |
|---|---|---|
| About to run, lint or test the staged code | run it in the stage | copy the stage elsewhere first |
| A staged file needs a fix after `MANIFEST.csv` was written | edit it and move on | edit it, then re-run `manifest.py` |
| The SPEC needs a change after approval | edit it and dispatch | re-hash it, amend `--spec-sha256` in the plan, re-hash the plan; a moved hash is exit 2 |
| About to write the SPEC beside the plan | "it belongs with the plan" | `production/<name>.spec.json`; the plans directory holds only the plan |
| A deliverable value departs from the code's output | type the decided value into the workbook | flag it `Hand-checked against the filing`, the quote alone in `Filing quote (hand check)`; an excluded entity is `Not counted (hand-checked)` |
| About to explain an override in the README or runbook | a sentence on why the value changed | nothing: the flag and the quote are the whole shipped record |
| About to stage the whole repo, or a figure the deliverable does not use | "more is safer" | the closure; delete the figure and the code that builds it |
| Another deterministic check is needed | a second `mechanicalChecks` entry | a leg of `package-check.sh`; P10 refuses a second entry |
| Something `work` does not obviously do | write an `expert-production/workflow.js` | ask which `work` parameter is missing |
