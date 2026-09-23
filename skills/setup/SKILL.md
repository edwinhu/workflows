---
name: setup
description: "Use when the user says \"set up workflows\", \"workflows setup\", \"is workflows installed correctly\", \"verify my install\", \"check the workflows install\", \"why isn't my agent's guidance loading\", \"my agent dispatch got denied\", \"/setup\", or asks whether this plugin's agents, their preloaded skills and the main-thread guard's allowlist actually resolve on this machine. Use proactively right after installing or updating the plugin — a preload that fails to resolve is logged to the debug log only, and the run reads exactly as if it had loaded. Machine-level and idempotent; offers one optional user-tier plansDirectory write, always behind a question. NEGATIVE ROUTING: setting up a course's teaching plugin is teaching:setup and checking the Codex CLI is codex:setup; actually upgrading to a newer plugin version is plugin-update — this skill only checks what is installed, it never installs."
allowed-tools: [Bash, Read, Grep, Glob, AskUserQuestion]
---

# setup — Machine-Level Install Check

**What this skill carries** — grep `references/` for any subject the names below miss:
!`d=${CLAUDE_SKILL_DIR}; command -v skill-toc >/dev/null 2>&1 && exec skill-toc "$d"; s=$HOME/.claude/skills/plugin-utils/bin/skill-toc; [ -x "$s" ] && exec "$s" "$d"; echo "(skill-toc unavailable: references and scripts are NOT listed here — install the plugin-utils plugin, or start a new session so its bin/ reaches PATH)"`

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

**NO HARDCODED AGENT ROSTER. ENUMERATE `~/.claude/agents/*.md` AT RUNTIME.** A literal list stops
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

**THE DIRECTORY STATES THE SCOPE.** Agents ship in two directories under
`~/.claude/skills/workflows/`, and each has exactly one discovery path:

- `agents/` — **auto-discovered** by Claude Code, registers plugin-scoped. It answers only to
  `workflows:<name>`, and its `hooks:`, `mcpServers:` and `permissionMode:` frontmatter is
  **ignored**. It is deliberately NOT symlinked anywhere.
- `user-agents/` — **not** auto-discovered. It reaches Claude Code only through a symlink into
  `~/.claude/agents/`, which registers it under its **bare** name with those fields honoured.
  This plugin's skills dispatch those bare names, so an unlinked file here registers nowhere:
  the dispatch falls back to a default agent and its guard never fires.

Check both halves. Enumerate the shipped agents; never name them — run
`LINES=1000 COLUMNS=250 upmd --ci --all ${CLAUDE_SKILL_DIR}/references/install-check.md` (no upmd: run that file's bash
blocks in order) and read its `agents-listed` and `preloads` output.

**If an agent is UNLINKED**, the fix is a symlink, never a copy — a copy goes stale on the next
plugin update and nothing reports the drift. `~/dotfiles/scripts/setup-claude-symlinks.sh` links
every `user-agents/*.md` a plugin ships (and nothing from `agents/`); run it and re-check.

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
usually what you want (`skills/work/SKILL.md`).

Read both tiers first — the `plans-directory` block of `references/install-check.md`.

If it is already set, **say so and do nothing.** Only change it if the user asks, and show the
current value before you do.

If unset, ask via AskUserQuestion whether to set it at the user tier, and to what:
- **`./.claude/plans`** — matches the resolver's own default
- **`./.planning`** — what the domain workflows describe
- **Leave unset** — the fallback already works

Only on an explicit choice, merge exactly that one key, and merge it the safe way: **parse or
refuse** — a settings file that fails to parse is far more likely mid-edit than garbage, so leave
it byte-identical and stop rather than overwrite it — and **write atomically**, to a temp file in
the same directory then `renameSync` over the target, so every sibling key survives and no
interrupted write can truncate the user's settings.

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
them to `farm.sh`. That is intended for the user-tier personas (`ds`, `writing`, `teaching`, …):
a `farm.sh` row with `"agent"` runs `claude --agent`, which loads the real persona, so a persona
absent from the allowlist is NOT a defect. What must hold is that `workflows:*` stays allowed and
the deny message still names `farm.sh` — the `guard-allowlist` block of
`references/install-check.md`.

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

agents            <N> enumerated at ~/.claude/agents/
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
| Type an agent name into a check | A literal roster stops covering agents added later — the drift this skill exists to catch | `readdirSync()` over both agent directories |
| Write a settings file you have not parsed | An overwrite destroys keys you did not put there and cannot restore | Parse first; refuse on malformed JSON |
| Edit `~/.claude/hooks/main-thread-guard.sh` | It is the user's dotfiles, with concurrent edits from other sessions | Show the one-line change; let the user apply it |
| Configure `.claude-workflows.json`, a persona, or anything project-local | This is a machine setup; the opt-in's absence is the normal state | Leave the project alone |
| Report the install healthy with a dangling preload present | That preload fails to a debug-log line only — nothing else will surface it | Name it and stop |
| Say a setting is live in this session | User settings are read once at session start | Tell the user to restart |
| Invent work when everything resolves | A check that always finds something stops being read | Report clean and stop |
