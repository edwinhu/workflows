---
name: setup
description: Use when the user says "set up workflows", "workflows setup", "install the plugin", "is workflows installed correctly", "verify my install", "check the workflows install", "/setup", or asks whether this plugin's agents and preloaded skills actually resolve on this machine.
allowed-tools: [Bash, Read, Grep, Glob, AskUserQuestion]
---

# setup — Machine-Level Install Check

This is a **machine** setup, run once per machine, not per project. It verifies the installed
plugin's agents and their preloaded skills resolve, offers one optional user-tier setting, and
reports one dotfiles line the user may want to add themselves.

Idempotent — safe to re-run. It reads before it writes and it asks before every write.

<EXTREMELY-IMPORTANT>
## Iron Laws

**NO WRITE WITHOUT AN EXPLICIT ANSWER FROM THE USER FIRST.** Every write in this skill is
optional. Asking costs one question; a silent write to a settings file the user shares across
every project costs them keys they cannot restore.

**NO SETTINGS WRITE WITHOUT PARSING THE FILE FIRST — A FILE THAT FAILS TO PARSE IS A REFUSAL,
NEVER AN OVERWRITE.** A malformed settings file is far more likely to be mid-edit in another
window than to be garbage. Overwriting it destroys work and looks like success.

**NO HARDCODED AGENT ROSTER. ENUMERATE `agents/*.md` AT RUNTIME.** A literal list stops
covering agents added later, which is the exact silent drift this skill exists to catch. If you
are about to type an agent name into a check, you have reintroduced the bug.

**THIS SKILL CONFIGURES NO PROJECT.** It does not touch `.claude-workflows.json`, does not set
a per-project persona, and does not write anything under a project directory. Being helpful
about the project in front of you is how a machine-level check became per-project nagging.
</EXTREMELY-IMPORTANT>

---

## Step (a) — Verify the Install

**Why this step is the reason the skill exists.** An agent's `skills:` frontmatter preloads
guidance into that agent. A preload that does not resolve to a real skill — or that names a
skill with `disable-model-invocation: true` — is **skipped with a warning to the debug log
only**. The agent still launches, the guidance never arrives, and the run reads exactly as if
it had. Nothing surfaces this but a check.

Enumerate the installed agents; never name them:

```bash
P=~/.claude/skills/workflows
ls -1 "$P/agents"/*.md 2>/dev/null || echo "NO AGENTS at $P/agents — plugin not installed there"
```

Then check every `skills:` entry of every enumerated agent:

```bash
P=~/.claude/skills/workflows bun -e '
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
const root = process.env.P.replace(/^~/, process.env.HOME);
const agentsDir = join(root, "agents");
if (!existsSync(agentsDir)) { console.log(`NOT INSTALLED: ${agentsDir} does not exist`); process.exit(1); }
// ENUMERATED, never listed.
const agents = readdirSync(agentsDir).filter(f => f.endsWith(".md")).sort();
let bad = 0;
for (const a of agents) {
  const body = readFileSync(join(agentsDir, a), "utf8");
  const fm = body.startsWith("---") ? body.slice(3, body.indexOf("\n---", 3)) : "";
  const m = fm.match(/^skills:[ \t]*(.*)$((?:\n[ \t]+-[ \t]*.*)*)/m);
  if (!m) { console.log(`  ${a}: no skills: preloads`); continue; }
  const inline = m[1].trim().replace(/^\[|\]$/g, "").split(",");
  const block = m[2].split("\n").map(l => l.replace(/^[ \t]*-[ \t]*/, ""));
  const skills = [...inline, ...block].map(s => s.trim().replace(/^["\x27]|["\x27]$/g, "")).filter(Boolean);
  for (const s of skills) {
    const sk = join(root, "skills", s, "SKILL.md");
    if (!existsSync(sk)) { console.log(`  DANGLING  ${a} -> ${s} (no skills/${s}/SKILL.md)`); bad++; continue; }
    const head = readFileSync(sk, "utf8").slice(0, 2000);
    if (/^disable-model-invocation:[ \t]*true[ \t]*$/m.test(head)) {
      console.log(`  DISABLED  ${a} -> ${s} (skill sets disable-model-invocation: true)`); bad++; continue;
    }
    console.log(`  OK        ${a} -> ${s}`);
  }
}
console.log(bad ? `\n${bad} unresolved preload(s) — the agent launches and the guidance never arrives.`
                : `\nall preloads resolve across ${agents.length} agent(s).`);
'
```

**Report every unresolved preload by name, and do not claim the install is healthy while one
exists.** If the plugin source checkout is the current project, the authoritative check is
`bun tests/agent-contract.test.mjs` — it asserts the whole wiring, not just the preloads.

An unresolved preload is fixed by reinstalling or updating the plugin, not by editing the
installed copy under `~/.claude/skills/workflows/` — that copy is overwritten on next install.

---

## Step (b) — Offer `plansDirectory` at the USER Tier (optional)

**This is a preference, not a fix.** The resolver honours `plansDirectory` at either tier and
falls back to `.claude/plans` when it is unset, so unset is a working default and nothing is
broken without it. Setting it at the **user** tier covers every project at once, which is
usually what you want (`skills/craft/SKILL.md`).

Read both tiers first:

```bash
rg -n '"plansDirectory"' ~/.claude/settings.json 2>/dev/null \
  || echo "plansDirectory: UNSET at the user tier (default .claude/plans applies)"
```

If it is already set, **say so and do nothing.** Only change it if the user asks, and show the
current value before you do.

If unset, ask via AskUserQuestion whether to set it at the user tier, and to what:
- **`./.claude/plans`** — matches the resolver's own default
- **`./.planning`** — what the domain workflows describe
- **Leave unset** — the fallback already works

Only on an explicit choice, merge exactly that one key with the parse-or-refuse,
preserve-siblings, atomic-rename discipline of `scripts/set-output-style.ts`
(`mergeOutputStyle`):

```bash
PLANS=./.claude/plans bun -e '   # PLANS = the value the user chose
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
const p = join(process.env.HOME, ".claude", "settings.json");
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

**It takes effect next session.** Plan mode fixes the plan's path when the session enters plan
mode, so a session already running keeps writing where it started. Do not copy a plan to make a
path look right — start a new session.

---

## Step (c) — Check the Main-Thread Guard's Allowlist (REPORT ONLY)

**Why.** `~/.claude/hooks/main-thread-guard.sh` denies loose `Agent` dispatches and reroutes
them to `farm.ts`, which never loads an agent body. Without a `workflows:*` entry in its
`subagent_type` case, every proactive dispatch of this plugin's agents is denied and the agent's
own framing is silently lost.

```bash
G=~/.claude/hooks/main-thread-guard.sh
test -f "$G" || echo "no main-thread guard at $G — nothing to check"
grep -n 'subagent_type' -A 4 "$G" 2>/dev/null | grep -n 'workflows:\*' \
  && echo "allowlist OK: workflows:* is present" \
  || echo "allowlist MISSING workflows:* in the subagent_type case"
```

**DO NOT EDIT THIS FILE.** It is the user's dotfiles and other sessions routinely have
concurrent edits in that tree. If the entry is missing, show the one-line change and let the
user make it:

```
      Explore|Plan|librarian|workflows:*|codex:rescue|statusline-setup|plugin-dev:*) allow ;;
```

Quote the file's actual current line alongside it — do not paste a line from this skill as if it
were what is on disk.

---

## Step (d) — Report

Read back what you checked; report from disk, not from intent. Silent success is fine — if
everything resolves and nothing was changed, say so in a few lines and stop.

```
workflows install — <machine>

agents            <N> enumerated at ~/.claude/skills/workflows/agents/
preloaded skills  all resolve            (or: name each dangling/disabled one)
plansDirectory    "<value>" at the user tier   (or: unset — default .claude/plans applies)
main-thread guard workflows:* present     (or: missing — one-line change shown above)
```

Name every step that was **skipped** as explicitly as the ones that ran. Say plainly that user
settings are read at session start, so any write here takes effect in a new session.

---

## Red Flags

| About to | Why wrong | Do instead |
|---|---|---|
| Type an agent name into a check | A literal roster stops covering agents added later — the drift this skill exists to catch | `readdirSync(agents/)` |
| Write a settings file you have not parsed | An overwrite destroys keys you did not put there and cannot restore | Parse first; refuse on malformed JSON |
| Edit `~/.claude/hooks/main-thread-guard.sh` | It is the user's dotfiles, with concurrent edits from other sessions | Show the one-line change; let the user apply it |
| Configure `.claude-workflows.json`, a persona, or anything project-local | This is a machine setup; the opt-in's absence is the normal state | Leave the project alone |
| Report the install healthy with a dangling preload present | That preload fails to a debug-log line only — nothing else will surface it | Name it and stop |
| Say a setting is live in this session | User settings are read once at session start | Tell the user to restart |
| Invent work when everything resolves | A check that always finds something stops being read | Report clean and stop |
