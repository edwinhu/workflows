---
description: Set up the workflows plugin for a project — plansDirectory, governance opt-in, session persona, install check
---

# /start — Project Onboarding

Configure the **current project directory** to run this plugin's workflows: the
`plansDirectory` craft needs, the committed governance opt-in, the session persona, and a
verification that the plugin's agents and their preloaded skills actually resolve.

Idempotent — safe to re-run. Every step reads what is already there first, shows it, and
offers to keep it. Nothing is overwritten without an answer from the user.

---

<EXTREMELY-IMPORTANT>
## The Iron Law of No Assumptions

**DO NOT ASSUME A PATH, A PROJECT ROOT, A DOMAIN, OR A SETTINGS FILE'S CONTENTS. Read it or
ask. This is not negotiable.**

Every project is laid out differently and settings files carry keys this command did not put
there. Never guess where the project root is, never guess whether a key exists, and never
write a settings file you have not first parsed. A malformed settings file is a **refusal**,
never an overwrite — a file that failed to parse is far more likely to be mid-edit than to be
garbage, and replacing it destroys work.

The only acceptable defaults are this plugin's own conventions: `./.planning` for
`plansDirectory`, `.claude-workflows.json` at the repo root.
</EXTREMELY-IMPORTANT>

---

## Step 1: Check Existing Configuration

Establish the project root first — do not assume it is the shell's cwd:

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd); echo "ROOT=$ROOT"
cat "$ROOT/.claude/settings.json" 2>/dev/null || echo "NO .claude/settings.json"
cat "$ROOT/.claude-workflows.json" 2>/dev/null || echo "NO .claude-workflows.json"
```

Confirm `ROOT` with the user if the project is not a git repo, or if the reported root is not
where they think the project lives.

**If either file already carries workflows configuration** (`plansDirectory`, `agent`,
`outputStyle`, or any key in `.claude-workflows.json`): show the user exactly what is there,
then ask via AskUserQuestion:

"This project already has workflows configuration. What would you like to do?"
- **Keep current config** — exit, no changes; report what exists (Step 6 format)
- **Update specific settings** — ask which of Steps 2–4 to run, then run only those
- **Reconfigure from scratch** — proceed through all steps below

**If neither file exists or neither carries these keys:** proceed to Step 2.

---

## Step 2: `plansDirectory`

**Why.** Craft's approved plan must *be* the plan the workflow parser authenticates. If
`plansDirectory` is unset, plan mode writes to `~/.claude/plans/` — outside the project — and
the workflow either cannot find the plan or someone copies it in. **A copy drifts from what
the user approved.** One file, hashed in place, is the run's only authority.

Any value works: the plugin resolves `plansDirectory` (project local, then shared project, then
user tier; relative to the project root; default `.claude/plans`) rather than assuming a path.
`./.planning` is this command's recommended default — the domain workflows (`/writing`, `/ds`,
`/workshop`) describe the plan as living there and `.planning/` is already gitignored — but
`./.claude/plans` is equally valid, and a project that already sets one should keep it.

Read the file, then merge **exactly one key**:

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
rg -n '"plansDirectory"' "$ROOT/.claude/settings.json" ~/.claude/settings.json 2>/dev/null \
  || echo "plansDirectory: UNSET at both tiers"
```

If it is already set at either tier, say so and do nothing — the value is honoured whatever it
is. Only if the user asks to change it, show the current value and confirm the new one first;
**never silently rewrite a set value.**

If unset, ask via AskUserQuestion whether to set it and to what (offer `./.planning`, the
recommended default, and `./.claude/plans`), then merge that answer as `PLANS` below. Use the
surgical-merge
discipline of `scripts/set-output-style.ts` (`mergeOutputStyle`, lines 61–105): parse the
existing object, refuse on unparseable JSON or a non-object, spread every sibling key through
unchanged, serialize with two-space indent and a trailing newline, and write via a sibling
temp file plus `rename` so a crash cannot leave a half-written settings file.

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd) PLANS=./.planning bun -e '   # PLANS = the value the user chose
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
// Same discipline as scripts/set-output-style.ts:mergeOutputStyle — one key, siblings preserved,
// refuse rather than overwrite, atomic rename.
const p = join(process.env.ROOT, ".claude", "settings.json");
let existing = {};
if (existsSync(p)) {
  const raw = readFileSync(p, "utf8");
  if (raw.trim() !== "") {
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { console.error(`REFUSED: ${p} is not valid JSON (${e.message}) — not overwriting`); process.exit(1); }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error(`REFUSED: ${p} is not a JSON object — not overwriting`); process.exit(1);
    }
    existing = parsed;
  }
}
const plans = process.env.PLANS;
if (existing.plansDirectory === plans) { console.log(`already ${plans} — nothing to do`); process.exit(0); }
const merged = { ...existing, plansDirectory: plans };
mkdirSync(dirname(p), { recursive: true });
const tmp = `${p}.${process.pid}.tmp`;
try { writeFileSync(tmp, JSON.stringify(merged, null, 2) + "\n", "utf8"); renameSync(tmp, p); }
catch (e) { try { rmSync(tmp, { force: true }); } catch {} ; console.error(`could not write ${p}: ${e.message}`); process.exit(1); }
console.log(`set plansDirectory = "${plans}" in ${p}`);
'
```

**Tell the user it takes effect next session.** Plan mode fixes the plan's path when the
session enters it, so a session that started before this write still writes to
`~/.claude/plans/`. Do not copy the file to make the path look right; start a new session.

Also confirm the configured plans directory is gitignored:

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd); PLANS=./.planning   # the configured value
DIR="${PLANS#./}/"
grep -qx "$DIR" "$ROOT/.gitignore" 2>/dev/null && echo "gitignored" || echo "NOT gitignored"
```

If not, offer to append that directory to `.gitignore`.

---

## Step 3: Governance Opt-In (`.claude-workflows.json`)

**Why this file is different from everything else.** `.claude-workflows.json` lives at the
repo root and is **committed**. Everything under `.planning/` is gitignored and ephemeral —
episode state that dies with the run. This file is the project's permanent, reviewable
statement of how work happens here. That boundary is load-bearing; see the State Files section
of `.claude/CLAUDE.md`. Never put episode state in it.

Explain that to the user, then ask via AskUserQuestion:

"Should this project refuse main-thread implementation (`farmOutOnly`)?"

Explain plainly what the flag does, in these terms:

> With `"farmOutOnly": true`, every `Edit` and `Write` from the **main conversation** is
> denied unless it targets `.claude-workflows.json` itself, `.claude/plans/`, or `.craft/`.
> Implementation must therefore be delegated — farmed out to a runner, or dispatched through
> craft — and what comes back is a diff and command output you verify here. A returned summary
> is not evidence.
>
> Without it, the main-thread guard's `Edit` branch allows unconditionally in every moment
> between craft runs. Measured 2026-08-20: **313 main-thread writes in mail-bridge over 28
> hours with the hook enabled**, the user objecting three times. The hook was on the whole
> time; the flag was not set.

Options:
- **Yes — `farmOutOnly: true`** — right for a project where implementation should always be
  delegated and verified
- **No — `farmOutOnly: false`** — records the opt-in without the write restriction
- **Skip** — write no file at all; state plainly that main-thread writes stay unrestricted

Setting the flag back to `false` later is always permitted, because edits to
`.claude-workflows.json` are exempt from the very rule it enables.

If the user chooses to write it, create or merge `.claude-workflows.json` at `ROOT` with the
same parse-or-refuse, preserve-siblings, atomic-rename discipline as Step 2 — only the key
`farmOutOnly` and the path differ. Then show the resulting file, and remind the user it is
committed: it belongs in the next commit, not in `.gitignore`.

---

## Step 4: Session Persona

**Why.** `claude --agent <name>` replaces the **main session's** system prompt with that
agent's body. A writing project or a data project then runs under the right framing instead of
Claude Code's software-engineering framing. The `agent` key in `.claude/settings.json` makes
that the project's default so it does not have to be typed.

Ask via AskUserQuestion:

"What should this project's default session persona be?"
- **`workflows:writing`** — long-form prose: articles, essays, briefs, memos, chapters
- **`workflows:ds`** — empirical work: panels, pipelines, regressions, figures
- **`workflows:workshop`** — Typst slide decks and speaker notes from a paper
- **None** — leave the persona unset; the plugin's agents remain available for dispatch

If the user picks one, merge the `agent` key into `.claude/settings.json` with the Step 2
mechanism.

**If the project is a writing project, additionally offer `outputStyle: "General prose"`.**
The persona only applies to sessions launched with `--agent` (or covered by the `agent`
setting); `outputStyle` is the fallback that still suppresses the software-engineering framing
for any other session. It is the plugin's one shipped style (`output-styles/general-prose.md`)
and it is structural, not a register — the measured registers reach the writing subagents
through the preloaded `writing-register` skill either way.

**Do not contradict `scripts/set-output-style.ts`.** That script derives the style from an
**APPROVED, receipt-selected** writing plan's `## Writing Intent` Domain and **refuses without
one**, and it writes `.claude/settings.local.json`. This command is the manual path for a
project that has **no plan yet** — the user chose the style here explicitly, so nothing is
being inferred from absent authority. Once the project has an approved plan, that script is the
route, and it is the one that reports the Domain. Say this to the user rather than leaving them
with two apparently competing mechanisms.

Both the persona and the output style are part of the system prompt, read once at session
start: **they take effect in a new session, not this one.**

---

## Step 5: Verify the Install

Check that the plugin's six agents resolve and that each agent's preloaded `skills:` entries
name real skills. A missing or disabled skill in `skills:` is skipped with a warning to the
**debug log only** — the agent launches, the guidance never arrives, and the run reads as if it
had. That is precisely the failure this step exists to catch.

```bash
P=~/.claude/skills/workflows
for a in writing writing-reviewer ds ds-reviewer workshop workshop-reviewer; do
  test -f "$P/agents/$a.md" && echo "agent OK   $a" || echo "agent MISSING  $a"
done
for a in writing writing-reviewer ds ds-reviewer workshop workshop-reviewer; do
  sed -n '/^skills:/,/^---/p' "$P/agents/$a.md" 2>/dev/null | sed -n 's/^  - //p' | while read -r s; do
    test -f "$P/skills/$s/SKILL.md" && echo "  skill OK   $a -> $s" || echo "  skill MISSING  $a -> $s"
  done
done
```

**Report anything missing rather than proceeding silently.** If any agent or skill is missing,
the plugin is not fully installed at `~/.claude/skills/workflows/` — say so plainly and stop
before claiming the project is configured.

The authoritative check is the contract test, run from the plugin's **source** checkout:

```bash
bun tests/agent-contract.test.mjs
```

It asserts the whole wiring — skill preloading, `agentType` resolution, the read-only writer
exclusion, the one output style, the settings merge. Point the user at it; run it only if the
plugin source repo is the current project.

---

## Step 6: Report

Read the files back and quote the resulting keys verbatim — do not report what you intended to
write:

```bash
ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
cat "$ROOT/.claude/settings.json" 2>/dev/null
cat "$ROOT/.claude-workflows.json" 2>/dev/null
```

Then report:

```
workflows configured for {{ROOT}}

.claude/settings.json
  "plansDirectory": "./.planning"          (or: unchanged — was {{VALUE}} / not set)
  "agent": "workflows:{{PERSONA}}"         (or: not set)
  "outputStyle": "General prose"           (or: not set)

.claude-workflows.json  (COMMITTED — include it in your next commit)
  "farmOutOnly": {{true|false}}            (or: not written)

install check
  agents: 6/6 resolve
  preloaded skills: all resolve            (or: name each missing one)

plansDirectory, agent and outputStyle are read at session start.
START A NEW SESSION before running a workflow.

Run /start again at any time to update this configuration.
```

Name every step that was **skipped** as explicitly as the ones that ran.

---

## Red Flags

- **About to write a settings file you have not parsed** → STOP. Parse first; refuse on
  malformed JSON. An overwrite destroys keys this command did not put there and cannot restore.
- **About to change an existing `plansDirectory` value without asking** → STOP. The user may
  have set it deliberately; show it and ask.
- **About to copy a plan into `.planning/` to make a path look right** → STOP. The approved
  plan must be the parsed plan; a copy drifts from what the user approved.
- **About to report success without re-reading the files** → STOP. Quote the keys back from
  disk, not from intent.
- **About to say a setting is live in this session** → STOP. `plansDirectory`, `agent` and
  `outputStyle` are read once at session start. Tell the user to restart.
- **About to put episode state in `.claude-workflows.json`** → STOP. That file is committed and
  permanent; episode state belongs in `.planning/.state/episode.json`.
