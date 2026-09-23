# workflows install check — read-only

Run the whole thing: `LINES=1000 COLUMNS=250 upmd --ci --all <this file>`. Every block is read-only and independent, so all of them run, and the exit code is the verdict. Without a tty upmd keeps only a 24x80 screen of each block's output, hence the size.
Without `upmd`, run each bash block below in order by hand.

## agents-listed — what the plugin ships, and what is linked at user scope

```bash [name:agents-listed]
ls -1 ~/.claude/skills/workflows/agents/*.md 2>/dev/null || echo "NO plugin-scoped agents shipped"
ls -1 ~/.claude/skills/workflows/user-agents/*.md 2>/dev/null || echo "NO user-scoped agents shipped"
ls -la ~/.claude/agents/ 2>/dev/null || echo "NO ~/.claude/agents directory"
```

## preloads — every agent's `skills:` entries resolve, and every agent is at its intended scope

```bash [name:preloads]
P=~/.claude/skills/workflows bun -e '
import { readdirSync, readFileSync, existsSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
const root = process.env.P.replace(/^~/, process.env.HOME);
const userDir = join(homedir(), ".claude", "agents");
// NO NAMED EXCEPTIONS: the directory an agent sits in states its scope.
const dirs = [["agents", "plugin"], ["user-agents", "user"]].filter(([d]) => existsSync(join(root, d)));
if (!dirs.length) { console.log(`NO AGENTS: neither agents/ nor user-agents/ exists under ${root}`); process.exit(1); }
const real = p => { try { return realpathSync(p); } catch { return null; } };
let bad = 0, agents = [];
for (const [sub, tier] of dirs) {
  const agentsDir = join(root, sub);
  // ENUMERATED, never listed.
  for (const a of readdirSync(agentsDir).filter(f => f.endsWith(".md")).sort()) {
  agents.push(a);
  const name = a.replace(/\.md$/, "");
  if (tier === "user") {
    const want = real(join(agentsDir, a));
    const got = real(join(userDir, a));
    if (got === null) { console.log(`  UNLINKED  ${name} (no resolving ${userDir}/${a}) — registers nowhere, hooks never fire`); bad++; }
    else if (got !== want) { console.log(`  MISLINKED ${name} -> ${got}, expected ${want}`); bad++; }
    else console.log(`  SCOPED    ${name} (user-level via symlink)`);
  } else {
    console.log(`  PLUGIN    ${name} (plugin-scoped on purpose; dispatch as workflows:${name})`);
  }
  const body = readFileSync(join(agentsDir, a), "utf8");
  const fm = body.startsWith("---") ? body.slice(3, body.indexOf("\n---", 3)) : "";
  const m = fm.match(/^skills:[ \t]*(.*)$((?:\n[ \t]+-[ \t]*.*)*)/m);
  if (!m) { console.log(`  ${a}: no skills: preloads`); continue; }
  const inline = m[1].trim().replace(/^\[|\]$/g, "").split(",");
  const block = m[2].split("\n").map(l => l.replace(/^[ \t]*-[ \t]*/, ""));
  const skills = [...inline, ...block].map(s => s.trim().replace(/^["\x27]|["\x27]$/g, "")).filter(Boolean);
  for (const s of skills) {
    // "plugin:skill" names a skill of another plugin, installed beside this one.
    const [plug, name] = s.includes(":") ? s.split(":", 2) : [null, s];
    const sk = plug ? join(root, "..", plug, "skills", name, "SKILL.md") : join(root, "skills", s, "SKILL.md");
    if (!existsSync(sk)) { console.log(`  DANGLING  ${a} -> ${s} (no ${sk})`); bad++; continue; }
    const head = readFileSync(sk, "utf8").slice(0, 2000);
    if (/^disable-model-invocation:[ \t]*true[ \t]*$/m.test(head)) {
      console.log(`  DISABLED  ${a} -> ${s} (skill sets disable-model-invocation: true)`); bad++; continue;
    }
    console.log(`  OK        ${a} -> ${s}`);
  }
  }
}
console.log(bad ? `\n${bad} problem(s) — an unresolved preload or an unlinked agent both fail silently.`
                : `\nall preloads resolve and every agent is at its intended scope (${agents.length} agent(s)).`);
process.exit(bad ? 1 : 0);
'
```

## plans-directory — report only; unset is a working default

```bash [name:plans-directory]
rg -n '"plansDirectory"' ~/.claude/settings.json 2>/dev/null \
  || echo "plansDirectory: UNSET at the user tier (default .claude/plans applies)"
```

## guard-allowlist — every bare user-tier agent name, plus `workflows:*`, is allowed

```bash [name:guard-allowlist]
G=~/.claude/hooks/main-thread-guard.sh
if [ ! -f "$G" ]; then echo "no main-thread guard at $G — nothing to check"; exit 0; fi
CASE=$(grep -A 4 'subagent_type' "$G" 2>/dev/null | grep 'allow ;;' | head -1)
echo "current: $CASE"
# User-tier personas are denied here BY DESIGN: farm.sh runs them with --agent, which loads the
# real persona. Only the plugin-scoped glob and the reroute itself need checking.
bad=0
if grep -q 'workflows:\*' <<<"$CASE"; then
  echo "workflows:* present (covers the plugin-scoped agents)"
else
  echo "workflows:* MISSING (plugin-scoped agents denied)"; bad=$((bad+1))
fi
if grep -q 'farm-out/scripts/farm.sh' "$G"; then
  echo "deny message routes persona dispatches to farm.sh"
else
  echo "deny message no longer names farm.sh — a denied persona dispatch has no route"; bad=$((bad+1))
fi
[ "$bad" -eq 0 ] || { echo "$bad guard problem(s)"; exit 1; }
```
