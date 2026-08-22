// Agent contract: the plumbing between skills/*/SKILL.md, agents/*.md and skills/*/ — skill
// preloading, agentType resolution, the read-only writer exclusion, and the retirement of the
// output-style path. (Was writing-register-contract.test.mjs; it is the general agent suite now, and
// ds/workshop ride the same wiring facts writing does.)
//
// WHY THIS FILE EXISTS. The wiring facts this feature depends on fail SILENTLY when violated, so
// nothing in a normal run would tell you:
//
//   1. `disable-model-invocation: true` skills CANNOT be preloaded ("preloading draws from the
//      same set of skills Claude can invoke"). Listing one in `skills:` gets it skipped with a
//      warning to the DEBUG LOG only — the agent launches, the guidance never arrives, and the
//      review reads as if it did.
//   2. A missing/disabled skill in `skills:` is likewise skipped with only a debug-log warning.
//      This is how a dangling `writing-register` preload survived a major version: 87739f29
//      deleted the skill, the generator and this test together.
//   3. `hooks`, `mcpServers` and `permissionMode` are IGNORED for a plugin-scoped agent but
//      HONOURED for a user-level one, and a user-level agent answers to its BARE name. THE
//      DIRECTORY STATES THE SCOPE: `agents/` is auto-discovered by Claude Code and registers
//      plugin-scoped (`workflows:<name>`); `user-agents/` is NOT auto-discovered and reaches
//      Claude Code only through the `~/.claude/agents/` symlink, which registers it user-level.
//      A `user-agents/` file with no link is the silent failure: the bare dispatch falls back
//      and its hooks never fire.
//
// Assertion 1 is the load-bearing one.
//
// Run: bun tests/agent-contract.test.mjs
import { readdirSync, readFileSync, existsSync, realpathSync, statSync, mkdtempSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PLUGIN_AGENTS = join(ROOT, 'agents')
const SCOPED_AGENTS = join(ROOT, 'user-agents')
const USER_AGENTS = join(homedir(), '.claude', 'agents')
const SKILLS = join(ROOT, 'skills')

// THE DIRECTORY STATES THE SCOPE — that is the whole point of the split, and it is why nothing
// below carries a hardcoded roster or a named exception.
//
//   `agents/`      auto-discovered by Claude Code, registers plugin-scoped (`workflows:<name>`).
//                  `hooks:`, `mcpServers:` and `permissionMode:` are IGNORED there.
//   `user-agents/` NOT auto-discovered. It reaches Claude Code only through the symlink into
//                  `~/.claude/agents/`, which registers the file user-level: BARE name, those
//                  fields honoured. One discovery path, and the directory name says which.
//
// Both rosters are ENUMERATED, never listed — a hardcoded set stops covering agents added later.

/** Every agent this repo owns, from both directories. `userScoped` ones must ALSO resolve in
 *  ~/.claude/agents/; the plugin-scoped ones must NOT. */
function roster() {
  const from = (dir, tier) =>
    (existsSync(dir) ? readdirSync(dir) : []).filter(f => f.endsWith('.md')).map(f => ({
      name: f.replace(/\.md$/, ''),
      file: f,
      path: join(dir, f),
      dir: tier === 'user' ? 'user-agents' : 'agents',
      userScoped: tier === 'user',
      tier,
    }))
  return [...from(PLUGIN_AGENTS, 'plugin'), ...from(SCOPED_AGENTS, 'user')]
}
const ROSTER = roster()
/** Path of an owned agent by bare name, whichever directory owns it. */
const agentPath = name => {
  const hit = ROSTER.find(a => a.name === name)
  return hit ? hit.path : join(SCOPED_AGENTS, `${name}.md`)
}

/** Real path of a user-level agent entry, or null when it is missing or dangling. */
const userAgentTarget = name => {
  try { return realpathSync(join(USER_AGENTS, `${name}.md`)) } catch { return null }
}

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

/** Frontmatter as raw text plus scalars and lists. Deliberately not a YAML parser: every field
 *  under test is a flat scalar, a `- item` block list, or an inline `[a, b]` array, and a
 *  dependency-free reader keeps this test runnable anywhere `bun` is.
 *
 *  INLINE ARRAYS ARE PARSED AS LISTS ON PURPOSE. Both notations are live in this repo. A parser
 *  that only understood block lists put an inline `skills: [...]` in `scalars`, so
 *  `fm.lists.skills ?? []` iterated nothing and EVERY per-skill assertion below passed vacuously
 *  for that agent — including the disable-model-invocation check this file exists for. */
function frontmatter(path) {
  const text = readFileSync(path, 'utf8')
  if (!text.startsWith('---\n')) return null
  const end = text.indexOf('\n---\n', 3)
  if (end === -1) return null
  const raw = text.slice(4, end + 1)
  const scalars = {}
  const lists = {}
  let currentList = null
  for (const line of raw.split('\n')) {
    const item = /^\s+-\s+(.*)$/.exec(line)
    if (item && currentList) { lists[currentList].push(item[1].trim()); continue }
    const kv = /^([A-Za-z0-9_-]+):(.*)$/.exec(line)
    if (!kv) continue
    const [, key, rest] = kv
    const value = rest.trim()
    if (value === '') { currentList = key; lists[key] = []; continue }
    currentList = null
    if (value.startsWith('[') && value.endsWith(']')) {
      lists[key] = value.slice(1, -1).split(',')
        .map(s => s.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean)
      continue
    }
    scalars[key] = value
  }
  return { raw, scalars, lists }
}

/** YAML truth, not string equality. `true`, `True`, `yes`, `on`, and any of those followed by a
 *  `# comment` all parse as boolean true; only comparing to the literal `'true'` lets three of
 *  those through. */
function isYamlTrue(value) {
  if (value === undefined) return false
  const bare = value.replace(/\s+#.*$/, '').trim().toLowerCase()
  return ['true', 'yes', 'on', 'y'].includes(bare)
}

/** YAML falsity, the mirror of isYamlTrue. `user-invocable:` absent is NOT false — it is unset,
 *  which still ships a slash command. */
function isYamlFalse(value) {
  if (value === undefined) return false
  const bare = value.replace(/\s+#.*$/, '').trim().toLowerCase()
  return ['false', 'no', 'off', 'n'].includes(bare)
}

/** The WHOLE `description:`, including the continuation lines of a `>` or `|` block scalar.
 *
 *  READING `scalars.description` WOULD BE VACUOUS. The flat reader above matches keys only at
 *  column 0, so for `description: >` it stores the literal `>` and DROPS every indented line —
 *  which is where the text under test actually lives. Most agents in this repo use a block scalar,
 *  so a check against the scalar would pass for them without reading a word of the description. */
function descriptionText(fm) {
  const lines = fm.raw.split('\n')
  const start = lines.findIndex(l => /^description:/.test(l))
  if (start === -1) return ''
  let end = start + 1
  while (end < lines.length && !/^[A-Za-z0-9_-]+:/.test(lines[end])) end++
  return lines.slice(start, end).join('\n')
}

/** A frontmatter field's values however it was written — scalar, block list, or inline array.
 *  Reading only one representation is how a check passes without checking anything. */
function values(fm, key) {
  if (!fm) return []
  const out = [...(fm.lists[key] ?? [])]
  if (key in fm.scalars) out.push(...fm.scalars[key].split(',').map(s => s.trim()).filter(Boolean))
  return out
}

// ── THE LOAD-BEARING ONE: every preloaded skill resolves AND is preloadable ──
{
  ok('the plugin agents/ dir is not empty',
     readdirSync(PLUGIN_AGENTS).filter(f => f.endsWith('.md')).length > 0)
  ok('the user-agents/ dir is not empty',
     existsSync(SCOPED_AGENTS) && readdirSync(SCOPED_AGENTS).filter(f => f.endsWith('.md')).length > 0)
  let preloadsSeen = 0
  for (const { file, path, tier } of ROSTER) {
    const fm = existsSync(path) ? frontmatter(path) : null
    ok(`${tier}:${file} has parseable frontmatter`, fm !== null, path)
    if (!fm) continue
    for (const skill of values(fm, 'skills')) {
      preloadsSeen++
      const dir = join(SKILLS, skill)
      const md = join(dir, 'SKILL.md')
      const resolves = existsSync(dir) && statSync(dir).isDirectory() && existsSync(md)
      ok(`${tier}:${file}: skills: ${skill} resolves to a real skill`, resolves, dir)
      if (!resolves) continue
      const sfm = frontmatter(md)
      // `!== 'true'` is not enough: `disable-model-invocation: true  # why` is valid YAML and
      // parses as boolean true, but the raw string is not `'true'`. Compare the YAML VALUE.
      ok(`${tier}:${file}: skills: ${skill} is not disable-model-invocation`,
         sfm !== null && !isYamlTrue(sfm.scalars['disable-model-invocation']),
         'a disable-model-invocation skill is silently skipped when preloaded')
    }
  }
  ok('at least one agent preloads a skill', preloadsSeen > 0)

  // These fields are honoured only at USER scope. An agent that is deliberately plugin-scoped-only
  // must therefore not declare them: dead config that reads like the mechanism is worse than none.
  // A symlinked agent MAY declare them — that is the whole reason for the link.
  for (const { file, path, dir } of ROSTER.filter(a => !a.userScoped)) {
    const fm = frontmatter(path)
    if (!fm) continue
    for (const field of ['hooks', 'mcpServers', 'permissionMode']) {
      ok(`${dir}/${file} does not declare ${field} (ignored for a plugin-scoped agent)`,
         !(field in fm.scalars) && !(field in fm.lists) && !new RegExp(`^${field}:`, 'm').test(fm.raw))
    }
  }
}

// ── SCOPE: every user-agents/ file resolves through ~/.claude/agents/ ───────────────────────────
//
// Shipping the file is half the job. Without the symlink a `user-agents/` file reaches Claude Code
// through no path at all: the bare-name dispatches this repo's skills issue fall back to a default
// agent, and `hooks:` never fire. The failure is silent at every layer, so it is asserted here.
{
  ok('at least one agent is expected at user scope', ROSTER.some(a => a.userScoped))
  for (const { name, path, userScoped } of ROSTER) {
    const shipped = existsSync(path) ? realpathSync(path) : null
    const linked = userAgentTarget(name)
    if (userScoped) {
      ok(`${name} resolves in ~/.claude/agents/`, linked !== null,
         `~/.claude/agents/${name}.md is missing or dangling — the agent is not user-scoped`)
      ok(`~/.claude/agents/${name}.md points at the shipped file`,
         linked !== null && linked === shipped, `${linked} != ${shipped}`)
    } else {
      // An `agents/` file stays plugin-scoped ON PURPOSE: it must keep answering only to
      // workflows:<name>, and linking it would give one file two discovery paths.
      ok(`${name} is NOT linked into ~/.claude/agents/ (stays plugin-scoped)`,
         linked === null || linked !== shipped, String(linked))
    }
  }
}

// ── The reviewer is wired to the consolidated register skill ─────────────────
{
  const p = agentPath('writing-reviewer')
  ok('user-agents/writing-reviewer.md exists', existsSync(p))
  const fm = existsSync(p) ? frontmatter(p) : null
  // It grades every domain, so it preloads the base AND both domain registers.
  for (const s of ['writing-general', 'writing-legal', 'writing-econ']) {
    ok(`writing-reviewer preloads ${s}`, values(fm, 'skills').includes(s))
  }
  ok('writing-reviewer preloads ai-anti-patterns', values(fm, 'skills').includes('ai-anti-patterns'))

  // It has no Skill tool, so preloading is its ONLY channel.
  const rtools = values(fm, 'tools')
  ok('writing-reviewer declares a tools list at all', rtools.length > 0)
  ok('writing-reviewer still has no Skill tool (preload is its only channel)',
     rtools.length > 0 && !rtools.includes('Skill'), rtools.join(','))

  // IDE access is read-only ONLY. openDiff blocks and auto-saves on accept; saveDocument and
  // openFile write. Any of them turns a reviewer into an editor.
  for (const w of ['mcp__ide__openDiff', 'mcp__ide__saveDocument', 'mcp__ide__openFile']) {
    ok(`writing-reviewer does not list ${w}`, !rtools.includes(w), rtools.join(','))
  }

  // A discretionary Read of a register file is weaker than a deterministic preload; the parallel
  // path must not come back.
  const body = readFileSync(p, 'utf8')
  ok('writing-reviewer does not tell the agent to Read a register file',
     !/references\/registers/.test(body))
}

// ── The three drafting agents: they write, so none may carry the read-only iron law ──────
//
// AGENTS HAVE NO INHERITANCE. `writing-legal inherits writing` is expressed the only way the
// mechanism allows: both load the SAME base skill, and the domain agent loads its domain skill
// ALONGSIDE it. Assert the exact expected preload set per agent — a domain agent that dropped the
// base would draft against half a register and nothing else would say so.
{
  const EXPECTED = {
    'writing':       ['writing-general', 'ai-anti-patterns'],
    'writing-legal': ['writing-general', 'writing-legal', 'ai-anti-patterns'],
    'writing-econ':  ['writing-general', 'writing-econ', 'ai-anti-patterns'],
  }
  for (const [agent, want] of Object.entries(EXPECTED)) {
    const p = agentPath(agent)
    ok(`user-agents/${agent}.md exists`, existsSync(p))
    const fm = existsSync(p) ? frontmatter(p) : null
    const wskills = values(fm, 'skills')
    for (const s of want) ok(`${agent} preloads ${s}`, wskills.includes(s), wskills.join(','))
    ok(`${agent} preloads exactly the expected set`,
       wskills.length === want.length, wskills.join(','))
    for (const s of wskills) {
      ok(`user-agents/${agent}.md: skills: ${s} resolves`, existsSync(join(SKILLS, s, 'SKILL.md')))
    }
    const wtools = values(fm, 'tools')
    ok(`${agent} can actually write`,
       wtools.includes('Write') && wtools.includes('Edit'), wtools.join(','))
    // The read-only iron law and a writer toolset cannot coexist: the block below would fail it,
    // and an agent under contradictory instructions drafts nothing.
    ok(`${agent} does not contain "YOU DO NOT EDIT"`,
       existsSync(p) && !readFileSync(p, 'utf8').includes('YOU DO NOT EDIT'))
    // Trigger-led description, and the source-first guard: recall is not a source for a brief,
    // a law review Part or a job-market paper alike.
    ok(`${agent} description says "use proactively"`, /use proactively/i.test(fm?.raw ?? ''))
    ok(`${agent} carries the source-first PreToolUse guard`,
       (fm?.raw ?? '').includes('writing-source-first-guard.py'))
  }
}

// ── The workflow dispatches the register-aware reviewer, not a built-in ──────────
{
  const p = join(SKILLS, 'writing', 'SKILL.md')
  ok('skills/writing/SKILL.md exists', existsSync(p))
  ok('skills/writing/SKILL.md dispatches writing-reviewer',
     existsSync(p) && readFileSync(p, 'utf8').includes('writing-reviewer'))
}

// ── ds: the constraint skill, the doer, the reviewer, and the lens that dispatches it ──────────
{
  const md = join(SKILLS, 'ds-constraints', 'SKILL.md')
  ok('skills/ds-constraints/SKILL.md exists', existsSync(md))
  if (existsSync(md)) {
    const fm = frontmatter(md)
    ok('ds-constraints has a name', fm?.scalars.name === 'ds-constraints', fm?.scalars.name)
    ok('ds-constraints has a description', !!fm?.scalars.description)
    // The load-bearing one for THIS skill: it is preloaded, and a disable-model-invocation skill
    // listed in `skills:` is skipped with a debug-log warning only.
    ok('ds-constraints is preloadable (no disable-model-invocation)',
       !isYamlTrue(fm?.scalars['disable-model-invocation']))
    const body = readFileSync(md, 'utf8')
    // Every indexed constraint id from the four aggregates, preserved verbatim.
    for (const id of ['C1', 'C2', 'C3', 'C4', 'C5', 'C6',
                      'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8', 'V9',
                      'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
                      'E1', 'E2', 'E3', 'E4', 'E5', 'E6']) {
      ok(`ds-constraints indexes ${id}`, new RegExp(`^\\| ${id} \\|`, 'm').test(body))
    }
    for (const section of ['Common Constraints', 'Common Conventions',
                           'DS Analysis Constraints', 'DS Engineering Constraints']) {
      ok(`ds-constraints carries the ${section} aggregate`,
         new RegExp(`^#+ .*${section}`, 'm').test(body))
    }
  }
  // The four source aggregates stay put — other things read them.
  for (const f of ['ds-common-constraints', 'ds-common-conventions',
                   'ds-analysis-constraints', 'ds-engineering-constraints']) {
    ok(`skills/ds/references/${f}.md is still in place`,
       existsSync(join(SKILLS, 'ds', 'references', `${f}.md`)))
  }

  const doer = agentPath('ds')
  ok('user-agents/ds.md exists', existsSync(doer))
  const dfm = existsSync(doer) ? frontmatter(doer) : null
  ok('ds preloads ds-constraints', values(dfm, 'skills').includes('ds-constraints'))
  const dtools = values(dfm, 'tools')
  ok('ds can actually write', dtools.includes('Write') && dtools.includes('Edit'), dtools.join(','))
  ok('ds can run things', dtools.includes('Bash'), dtools.join(','))
  // Trigger-only description: the proactive-dispatch phrase is what gets it picked.
  ok('ds description says "use proactively"',
     /use proactively/i.test(dfm?.scalars.description ?? '') ||
     /use proactively/i.test((dfm?.raw ?? '')))
  // A writer cannot carry the read-only iron law; the block below would fail it.
  ok('user-agents/ds.md does not contain "YOU DO NOT EDIT"',
     existsSync(doer) && !readFileSync(doer, 'utf8').includes('YOU DO NOT EDIT'))

  const rev = agentPath('ds-reviewer')
  ok('user-agents/ds-reviewer.md exists', existsSync(rev))
  const rfm = existsSync(rev) ? frontmatter(rev) : null
  ok('ds-reviewer preloads ds-constraints', values(rfm, 'skills').includes('ds-constraints'))
  const rtools = values(rfm, 'tools')
  ok('ds-reviewer declares a tools list at all', rtools.length > 0)
  // No Skill tool, so preloading is its ONLY channel.
  ok('ds-reviewer has no Skill tool (preload is its only channel)',
     rtools.length > 0 && !rtools.includes('Skill'), rtools.join(','))
  ok('ds-reviewer carries the read-only iron law',
     existsSync(rev) && readFileSync(rev, 'utf8').includes('YOU DO NOT EDIT'))

  const sk = join(SKILLS, 'ds', 'SKILL.md')
  const sbody = existsSync(sk) ? readFileSync(sk, 'utf8') : ''
  ok('skills/ds/SKILL.md dispatches ds-reviewer',
     sbody.includes('ds-reviewer'))
  ok('skills/ds/SKILL.md keys the new lens "ds-constraints"',
     /key:\s*"ds-constraints"/.test(sbody))
  ok('skills/ds/SKILL.md still keeps its four Explore lenses',
     (sbody.match(/agentType:\s*"Explore"/g) ?? []).length === 4,
     String((sbody.match(/agentType:\s*"Explore"/g) ?? []).length))
  ok('skills/ds/SKILL.md still pins verifierAgentType: Explore',
     /verifierAgentType:\s*"Explore"/.test(sbody))
  // The doer authority names the preloadable skill, not the four discretionary paths.
  ok('ds doer authority points at skills/ds-constraints/SKILL.md',
     sbody.includes('skills/ds-constraints/SKILL.md'))
  for (const gone of ['references/ds-common-constraints.md', 'references/ds-common-conventions.md',
                      'references/ds-analysis-constraints.md', 'references/ds-engineering-constraints.md']) {
    ok(`ds authorityExtra no longer hands doers ${gone} by path`,
       !new RegExp(`Standing DS doer authority[^"]*${gone.replace(/[.]/g, '\\.')}`).test(sbody))
  }
  ok('ds authorityExtra still names ds-checks.md', sbody.includes('ds-checks.md'))
}

// ── workshop: the constraint skill, the doer, the reviewer, and its lens ────────────────────────
{
  const md = join(SKILLS, 'workshop-constraints', 'SKILL.md')
  ok('skills/workshop-constraints/SKILL.md exists', existsSync(md))
  if (existsSync(md)) {
    const fm = frontmatter(md)
    ok('workshop-constraints has a name', fm?.scalars.name === 'workshop-constraints', fm?.scalars.name)
    ok('workshop-constraints has a description', !!fm?.scalars.description)
    ok('workshop-constraints is preloadable (no disable-model-invocation)',
       !isYamlTrue(fm?.scalars['disable-model-invocation']))
    const body = readFileSync(md, 'utf8')
    // Every vendored module, by name. The count is the check: 15 modules, none quietly dropped.
    const vendored = readdirSync(join(SKILLS, 'workshop', 'references', 'constraints'))
      .filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
    ok('15 Typst constraint modules are vendored', vendored.length === 15, String(vendored.length))
    for (const m of vendored) {
      ok(`workshop-constraints carries the ${m} module`, new RegExp(`^# ${m}$`, 'm').test(body))
    }
  }

  const doer = agentPath('workshop')
  ok('user-agents/workshop.md exists', existsSync(doer))
  const dfm = existsSync(doer) ? frontmatter(doer) : null
  ok('workshop preloads workshop-constraints', values(dfm, 'skills').includes('workshop-constraints'))
  const dtools = values(dfm, 'tools')
  ok('workshop can actually write', dtools.includes('Write') && dtools.includes('Edit'), dtools.join(','))
  ok('workshop description says "use proactively"', /use proactively/i.test(dfm?.raw ?? ''))
  ok('user-agents/workshop.md does not contain "YOU DO NOT EDIT"',
     existsSync(doer) && !readFileSync(doer, 'utf8').includes('YOU DO NOT EDIT'))

  const rev = agentPath('workshop-reviewer')
  ok('user-agents/workshop-reviewer.md exists', existsSync(rev))
  const rfm = existsSync(rev) ? frontmatter(rev) : null
  ok('workshop-reviewer preloads workshop-constraints',
     values(rfm, 'skills').includes('workshop-constraints'))
  const rtools = values(rfm, 'tools')
  ok('workshop-reviewer declares a tools list at all', rtools.length > 0)
  ok('workshop-reviewer has no Skill tool (preload is its only channel)',
     rtools.length > 0 && !rtools.includes('Skill'), rtools.join(','))
  ok('workshop-reviewer carries the read-only iron law',
     existsSync(rev) && readFileSync(rev, 'utf8').includes('YOU DO NOT EDIT'))

  const sk = join(SKILLS, 'workshop', 'SKILL.md')
  const sbody = existsSync(sk) ? readFileSync(sk, 'utf8') : ''
  ok('skills/workshop/SKILL.md dispatches workshop-reviewer',
     sbody.includes('workshop-reviewer'))
  ok('skills/workshop/SKILL.md keys the new lens "deck-constraints"',
     /key:\s*"deck-constraints"/.test(sbody))
  ok('skills/workshop/SKILL.md still keeps its five Explore lenses',
     (sbody.match(/agentType:\s*"Explore"/g) ?? []).length === 5,
     String((sbody.match(/agentType:\s*"Explore"/g) ?? []).length))
  ok('skills/workshop/SKILL.md still pins verifierAgentType: Explore',
     /verifierAgentType:\s*"Explore"/.test(sbody))
  ok('workshop doer authority points at skills/workshop-constraints/SKILL.md',
     sbody.includes('skills/workshop-constraints/SKILL.md'))
}

// ── Every agentType any skill names must resolve ────────────────────────────────────────────────
//
// A typo'd or renamed agentType does NOT error: the dispatch falls back, the lens runs on an agent
// that never got the skill, and the review reads as if it did. Same silent-failure shape as a
// dangling `skills:` entry, one layer up.
{
  // Built-ins have PREDEFINED system prompts no repo guidance reaches, and they skip the CLAUDE.md
  // hierarchy. Naming one is a deliberate trade (structural read-only), not a resolution.
  const BUILTINS = new Set(['Explore', 'Plan', 'general-purpose'])
  let seen = 0
  for (const s of readdirSync(SKILLS).filter(d => existsSync(join(SKILLS, d, 'SKILL.md')))) {
    const body = readFileSync(join(SKILLS, s, 'SKILL.md'), 'utf8')
    for (const m of body.matchAll(/[A-Za-z]*[Aa]gentType:\s*"([^"]+)"/g)) {
      const t = m[1]
      // Documented placeholders in a code template are not dispatches.
      if (/[…<]/.test(t)) continue
      seen++
      if (BUILTINS.has(t)) { ok(`skills/${s}: agentType ${t} is a documented built-in`, true); continue }
      // The DIRECTORY the file sits in decides which dispatch form works: a bare name only
      // dispatches for a `user-agents/` file that is symlinked to user scope, and a `workflows:`
      // prefix only dispatches for an `agents/` file. Naming the wrong form fails silently — the
      // dispatch falls back to a default agent.
      const namespaced = t.startsWith('workflows:')
      const bare = namespaced ? t.slice('workflows:'.length) : t
      const owned = ROSTER.find(a => a.name === bare)
      const p = agentPath(bare)
      const resolves = existsSync(p) && frontmatter(p)?.scalars.name === bare
      ok(`skills/${s}: agentType ${t} resolves to ${p} with a matching name:`, resolves, p)
      if (!resolves) continue
      if (namespaced) {
        ok(`skills/${s}: agentType ${t} is namespaced, so ${bare} must live in agents/`,
           owned?.userScoped === false,
           `${bare} is in user-agents/ and symlinked to user scope; dispatch it by the bare name`)
      } else {
        ok(`skills/${s}: agentType ${t} is bare, so it must resolve in ~/.claude/agents/`,
           userAgentTarget(bare) === realpathSync(p),
           `~/.claude/agents/${bare}.md does not point at ${p}`)
      }
    }
  }
  ok('at least one agentType was checked', seen > 0)
}

// ── The general rule: an agent that declares itself read-only must have no writer ──
{
  const WRITERS = ['Edit', 'Write', 'NotebookEdit', 'mcp__ide__openDiff']
  let seen = 0
  // BOTH TIERS. The rule follows the agent, not the directory it happens to live in.
  for (const { file, path, tier } of ROSTER) {
    if (!existsSync(path)) continue
    if (!readFileSync(path, 'utf8').includes('YOU DO NOT EDIT')) continue
    seen++
    const t = values(frontmatter(path), 'tools')
    for (const w of WRITERS) {
      ok(`${tier}:${file} says "YOU DO NOT EDIT" and must not list ${w}`, !t.includes(w), t.join(','))
    }
  }
  ok('at least one agent declares "YOU DO NOT EDIT"', seen > 0)

  // The rule is general, but the roster is not automatic: an agent that drops the literal string
  // exits the loop above silently and keeps whatever tools it likes. Name every reviewer that must
  // be inside it. ds-reviewer and workshop-reviewer join writing-reviewer here.
  for (const r of ['writing-reviewer', 'ds-reviewer', 'workshop-reviewer']) {
    const p = agentPath(r)
    ok(`${r} is covered by the writer-exclusion rule`,
       existsSync(p) && readFileSync(p, 'utf8').includes('YOU DO NOT EDIT'), p)
    const t = existsSync(p) ? values(frontmatter(p), 'tools') : []
    for (const w of WRITERS) {
      ok(`${r} must not list ${w}`, !t.includes(w), t.join(','))
    }
  }
}

// ── The three register skills ────────────────────────────────────────────────
//
// THE SPLIT IS BASE + TWO DOMAIN SKILLS. `writing-general` carries the shared layer and the
// `general` register; `writing-legal` and `writing-econ` carry ONLY what is additional and are
// loaded alongside it. The retired `writing-register` must be gone, not merely unreferenced.
const REGISTER_SKILLS = ['writing-general', 'writing-legal', 'writing-econ']
{
  ok('skills/writing-register/ is retired', !existsSync(join(SKILLS, 'writing-register')))
  for (const s of REGISTER_SKILLS) {
    const md = join(SKILLS, s, 'SKILL.md')
    ok(`skills/${s}/SKILL.md exists`, existsSync(md))
    if (!existsSync(md)) continue
    const fm = frontmatter(md)
    ok(`${s} has a name`, fm?.scalars.name === s, fm?.scalars.name)
    ok(`${s} has a description`, !!fm?.scalars.description)
    ok(`${s} is preloadable (no disable-model-invocation)`,
       !isYamlTrue(fm?.scalars['disable-model-invocation']))
    // Output-style-only frontmatter has no meaning in a skill.
    for (const dead of ['style', 'slug', 'keep-coding-instructions']) {
      ok(`${s} does not carry the output-style field \`${dead}\``, !(dead in (fm?.scalars ?? {})))
    }
    const body = readFileSync(md, 'utf8')
    ok(`${s} carries no STYLE-ONLY region`, !body.includes('STYLE-ONLY'))
    // Trigger-led, and NO mechanism claim: "preloaded into the writing subagents" describes wiring
    // the reader cannot act on and does not help the model decide whether to load the skill.
    const desc = fm?.scalars.description ?? ''
    ok(`${s} description is trigger-led`, /ALWAYS load|Use before|BEFORE/i.test(desc), desc.slice(0, 60))
    ok(`${s} description makes no preload-mechanism claim`,
       !/preloaded into|subagent/i.test(desc), desc.slice(0, 80))
  }

  // NEGATIVE ROUTING between the three, so they do not misfire into each other.
  const desc = s => frontmatter(join(SKILLS, s, 'SKILL.md'))?.scalars.description ?? ''
  ok('writing-general points at writing-legal and writing-econ for the domains',
     desc('writing-general').includes('writing-legal') && desc('writing-general').includes('writing-econ'))
  ok('writing-legal routes finance work away to writing-econ', desc('writing-legal').includes('writing-econ'))
  ok('writing-legal names writing-general as its base', desc('writing-legal').includes('writing-general'))
  ok('writing-econ routes law review work away to writing-legal', desc('writing-econ').includes('writing-legal'))
  ok('writing-econ names writing-general as its base', desc('writing-econ').includes('writing-general'))

  // Each domain skill LINKS its source guide, and says the register's verdict controls.
  for (const [s, guide] of [['writing-general', 'elements-of-style.md'],
                            ['writing-legal', 'volokh-distilled.md'],
                            ['writing-econ', 'economical-writing-full.md']]) {
    const body = readFileSync(join(SKILLS, s, 'SKILL.md'), 'utf8')
    ok(`${s} links its source guide ${guide}`,
       body.includes(`skills/writing/references/${guide}`))
    ok(`${s} says its own verdict controls where they disagree`,
       /this file controls/i.test(body))
    ok(`skills/writing/references/${guide} is actually there`,
       existsSync(join(SKILLS, 'writing', 'references', guide)))
  }
}

// ── ALL 61 CORPUS MEASUREMENTS SURVIVED THE SPLIT ──────────────────────────────────────────────
//
// The measurements are the asset — 14.29M sentences of corpora, not restatable from memory. The
// split moved them between files, so a spot-check of eleven would not have caught a dropped table.
// The baseline is the PRE-SPLIT register at the commit that still had it, read out of git, so this
// check cannot be satisfied by editing a fixture.
{
  const MEASUREMENT = /[0-9][0-9,]*(?:\.[0-9]+)?%|[0-9][0-9,]*(?:\.[0-9]+)?\/M|[0-9]{1,3}(?:,[0-9]{3})+/g
  const distinct = text => new Set(text.match(MEASUREMENT) ?? [])

  // The last commit whose tree still carried the pre-split register.
  const show = rev => spawnSync('git', ['show', `${rev}:skills/writing-register/SKILL.md`],
                                { cwd: ROOT, encoding: 'utf8' })
  let baseline = null
  const log = spawnSync('git', ['log', '--format=%H', '--', 'skills/writing-register/SKILL.md'],
                        { cwd: ROOT, encoding: 'utf8' })
  for (const rev of ['HEAD', ...(log.stdout || '').split('\n').filter(Boolean)]) {
    const r = show(rev)
    if (r.status === 0 && r.stdout.length > 0) { baseline = r.stdout; break }
  }
  ok('the pre-split register is readable from git history', baseline !== null,
     'no revision of skills/writing-register/SKILL.md could be read')

  if (baseline) {
    const want = distinct(baseline)
    ok('the pre-split register carried 61 distinct measurements', want.size === 61, String(want.size))
    const have = new Set()
    for (const s of REGISTER_SKILLS) {
      for (const m of distinct(readFileSync(join(SKILLS, s, 'SKILL.md'), 'utf8'))) have.add(m)
    }
    const missing = [...want].filter(m => !have.has(m))
    ok(`all ${want.size} pre-split measurements survive across the three new skills`,
       missing.length === 0, `missing: ${missing.join(', ')}`)
  }
}

// ── NO SKILL BODY MAY NAME A skills/<x> THAT DOES NOT EXIST ────────────────────────────────────
//
// The general form of the dangling-reference bug this split fixed: the retired register's body
// referred to `writing-general`, `writing-legal` and `writing-econ` as skills when none existed.
// A path in prose resolves for nobody and fails silently, exactly like a dangling `skills:` entry.
// Two forms count as naming a skill OF THIS PLUGIN, and both are unambiguous:
//   ${CLAUDE_PLUGIN_ROOT}/skills/<x>/…   ${CLAUDE_SKILL_DIR}/../<x>/…   skills/<x>/SKILL.md
// A bare `skills/<x>/` with no such anchor is NOT counted: `~/.claude/skills/workflows/skills/…`
// is the install path and `skills/learned/` is a directory the capture skills CREATE, so counting
// those would make this check cry wolf and get switched off.
{
  let checked = 0
  const dangling = []
  const NAMED = [
    /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/([a-z0-9][a-z0-9-]*)\//g,
    /\$\{CLAUDE_SKILL_DIR\}\/\.\.\/([a-z0-9][a-z0-9-]*)\//g,
    /(?:^|[^A-Za-z0-9_/-])skills\/([a-z0-9][a-z0-9-]*)\/SKILL\.md/g,
  ]
  for (const s of readdirSync(SKILLS).filter(d => existsSync(join(SKILLS, d, 'SKILL.md')))) {
    const body = readFileSync(join(SKILLS, s, 'SKILL.md'), 'utf8')
    for (const re of NAMED) {
      for (const m of body.matchAll(re)) {
        checked++
        if (!existsSync(join(SKILLS, m[1], 'SKILL.md'))) dangling.push(`skills/${s} → skills/${m[1]}/`)
      }
    }
  }
  ok('at least one skills/<x> reference was checked', checked > 0, String(checked))
  ok('no skill body names a skills/<x> that does not exist', dangling.length === 0,
     [...new Set(dangling)].join(', '))

  // The bug this split fixed, named directly: the retired register's body pointed at all three of
  // these as skills when none of them existed. They exist now.
  for (const s of REGISTER_SKILLS) {
    ok(`the once-dangling name \`${s}\` is a real skill`, existsSync(join(SKILLS, s, 'SKILL.md')))
  }
}

// ── EVERY user-scoped agent, whoever ships it: preloads resolve, and nobody COPIES the register ──
//
// `~/.claude/agents/` is the one directory Claude Code reads for user-scoped agents, so agents from
// OTHER repos (dotfiles, teaching) land beside this plugin's. The same silent failure applies to
// all of them — a dangling `skills:` entry is skipped with a debug-log warning only.
//
// The second half is the design this feature exists to hold: the register has exactly ONE copy on
// disk, and agents reach it by LOADING it (a `skills:` preload, or the Skill tool in a persona
// session), never by pasting it. Three copies of one text drift. Verbatim slabs are caught by
// proxy — a phrase and a table row that appear nowhere but the register.
{
  const USER_SKILLS = join(homedir(), '.claude', 'skills')

  /** Every directory a `skills:` name can resolve against: the user skill dir itself, the
   *  `skills/` dir of each plugin linked into it, and this repo's. ENUMERATED, never listed. */
  const skillRoots = () => {
    const roots = [USER_SKILLS, SKILLS]
    if (existsSync(USER_SKILLS)) {
      for (const e of readdirSync(USER_SKILLS)) {
        const nested = join(USER_SKILLS, e, 'skills')
        try { if (statSync(nested).isDirectory()) roots.push(nested) } catch { /* dangling link */ }
      }
    }
    return roots
  }
  const ROOTS = skillRoots()
  const skillResolves = name => ROOTS.some(r => existsSync(join(r, name, 'SKILL.md')))

  const userAgentFiles = (existsSync(USER_AGENTS) ? readdirSync(USER_AGENTS) : [])
    .filter(f => f.endsWith('.md'))
    .map(f => ({ file: f, path: (() => { try { return realpathSync(join(USER_AGENTS, f)) } catch { return null } })() }))
    .filter(a => a.path !== null && existsSync(a.path))

  ok('~/.claude/agents/ holds at least one agent', userAgentFiles.length > 0)
  let userPreloads = 0
  for (const { file, path } of userAgentFiles) {
    const fm = frontmatter(path)
    ok(`~/.claude/agents/${file} has parseable frontmatter`, fm !== null, path)
    if (!fm) continue
    for (const skill of values(fm, 'skills')) {
      userPreloads++
      ok(`~/.claude/agents/${file}: skills: ${skill} resolves to a real skill`,
         skillResolves(skill), `searched ${ROOTS.join(', ')}`)
    }
  }
  ok('at least one user-scoped agent preloads a skill', userPreloads > 0)

  // LOAD IT, DO NOT COPY IT. Proxies for a verbatim slab: a sentence from the register's rate
  // legend, and two rows of its Ship tables.
  const REGISTER_SLABS = [
    'hits per million sentences',
    'Never open with `This article discusses',
    'Synthesize precedents; do not summarize case by case',
  ]
  const bodies = new Map()
  for (const { file, path } of userAgentFiles) bodies.set(`~/.claude/agents/${file}`, path)
  for (const { file, path, dir } of ROSTER) if (existsSync(path)) bodies.set(`${dir}/${file}`, path)
  ok('there are agent bodies to check for copied register text', bodies.size > 0)
  for (const [label, path] of bodies) {
    const body = readFileSync(path, 'utf8')
    for (const slab of REGISTER_SLABS) {
      ok(`${label} does not paste register text (${slab.slice(0, 32)}…)`, !body.includes(slab),
         'the register has ONE copy on disk; agents load it, they do not copy it')
    }
  }
  // The proxy is only a proxy if it still matches the source it stands for — now spread across
  // the three register skills, so check the union.
  const regBody = REGISTER_SKILLS.map(s => readFileSync(join(SKILLS, s, 'SKILL.md'), 'utf8')).join('\n')
  for (const slab of REGISTER_SLABS) {
    ok(`the copy-proxy "${slab.slice(0, 32)}…" is still present in the register skills`,
       regBody.includes(slab), 'a proxy that no longer matches the register checks nothing')
  }
}

// ── THE OUTPUT-STYLE PATH IS RETIRED, AND NOTHING STILL POINTS AT IT ──────────
//
// An output style cannot do the job it was kept for: setting one drops Claude Code's `# Doing
// tasks` section but NEVER `# Tone and style`, so it competes with the surviving half of the
// framing instead of replacing it. A subagent's body IS its whole system prompt and has neither.
// Every writing surface now routes through an agent, so the style was a second, weaker mechanism
// for a job something else does properly. See README.md's `## Why subagents`.
{
  ok('output-styles/ no longer exists', !existsSync(join(ROOT, 'output-styles')))
  ok('scripts/set-output-style.ts no longer exists',
     !existsSync(join(ROOT, 'scripts', 'set-output-style.ts')))
  const r = spawnSync('git', ['grep', '-l', '-e', 'set-output-style', '-e', 'output-styles'],
                      { cwd: ROOT, encoding: 'utf8' })
  const hits = (r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)
    // This file names both paths in its own assertions, so it always self-matches once tracked.
    .filter(f => f !== 'CHANGELOG.md' && !f.startsWith('scratch/') && !f.startsWith('.planning/')
                 && f !== 'tests/agent-contract.test.mjs' && !f.startsWith('docs/investigations/'))
  ok('no tracked file outside CHANGELOG.md references the retired output-style path',
     hits.length === 0, hits.join(', '))
  // The README keeps the ARGUMENT — deleting the mechanism without the reasoning invites its return.
  ok('README.md still explains why subagents replace output styles',
     readFileSync(join(ROOT, 'README.md'), 'utf8').includes('## Why subagents'))
}

// ── THE TIC DICTIONARY HAS EXACTLY ONE OWNER ───────────────────────────────────────────────────
//
// `~/.claude/skills/ai-tic/linter/tics.yaml` is the dictionary; `skills/ai-anti-patterns/` is the
// only skill that carries it, and `scripts/tic-add.py` regenerates
// `skills/ai-anti-patterns/references/scored-tics-patterns.py` from it. A SECOND hand-maintained
// copy in a register skill cannot be regenerated, so it drifts silently: a phrase validated through
// `/ai-tic` reaches ai-anti-patterns and never reaches the register. That is not hypothetical — the
// register's copy and the dictionary had already diverged when this check was written.
//
// The rule, therefore: no `skills/writing-*` skill may contain a phrase matching any ACCEPTED tic
// pattern. Accepted means the `tics:` block; the `rejected:` list is deliberately excluded, because
// those ARE things human scholars write and a register is free to discuss them.
{
  const TICS_CANDIDATES = [
    join(homedir(), '.claude', 'skills', 'ai-tic', 'linter', 'tics.yaml'),
    join(homedir(), 'dotfiles', '.claude', 'skills', 'ai-tic', 'linter', 'tics.yaml'),
  ]
  const ticsPath = TICS_CANDIDATES.find(p => existsSync(p)) ?? null

  /** Accepted tic patterns, read out of the `tics:` block. Text-level on purpose: the file carries
   *  load-bearing comments and this repo has no YAML dependency. `(?m)` is a Python inline flag
   *  JavaScript does not accept, so it is lifted onto the RegExp flags instead. */
  const acceptedPatterns = text => {
    const pats = []
    let id = null
    for (const line of text.split(/^rejected:/m)[0].split('\n')) {
      const mi = line.match(/^\s*-\s*id:\s*(\S+)\s*$/)
      if (mi) { id = mi[1]; continue }
      const mp = line.match(/^\s*pattern:\s*(.*)$/)
      if (!mp) continue
      const raw = mp[1].trim()
      let src
      if (raw.startsWith("'")) src = raw.slice(1, raw.lastIndexOf("'")).replace(/''/g, "'")
      else if (raw.startsWith('"')) {
        src = raw.slice(1, raw.lastIndexOf('"'))
          .replace(/\\(.)/g, (_, c) => (c === '\\' ? '\\' : c === '"' ? '"' : '\\' + c))
      } else src = raw
      let flags = 'i'
      if (src.startsWith('(?m)')) { src = src.slice(4); flags += 'm' }
      try { pats.push({ id, re: new RegExp(src, flags) }) } catch { pats.push({ id, re: null }) }
    }
    return pats
  }

  /** Every `skills/writing-*` SKILL.md under `dir` that quotes an accepted tic. */
  const offenders = (dir, pats) => {
    const out = []
    for (const s of readdirSync(dir).filter(d => /^writing-/.test(d))) {
      const p = join(dir, s, 'SKILL.md')
      if (!existsSync(p)) continue
      const body = readFileSync(p, 'utf8')
      for (const { id, re } of pats) {
        if (!re) continue
        const m = body.match(re)
        if (m) out.push(`skills/${s}/SKILL.md: ${id} → ${JSON.stringify(m[0])}`)
      }
    }
    return out
  }

  if (!ticsPath) {
    // NOT a pass. tics.yaml lives outside this repo (dotfiles), so a machine without it must say so
    // out loud rather than let the assertion evaporate into a vacuous true.
    console.log(`SKIP  the tic dictionary is unreadable — looked in ${TICS_CANDIDATES.join(', ')}; ` +
                'the "no duplicated tic table" assertion did NOT run')
  } else {
    const pats = acceptedPatterns(readFileSync(ticsPath, 'utf8'))
    // Guard the parser itself: a parser that silently yields nothing would pass everything.
    ok('the tic dictionary yields accepted patterns', pats.length >= 10, `${pats.length} from ${ticsPath}`)
    ok('every accepted pattern compiled', pats.every(p => p.re !== null),
       pats.filter(p => !p.re).map(p => p.id).join(', '))
    for (const id of ['rich-tapestry', 'delve-into-intricacies', 'chatbot-opener']) {
      ok(`the dictionary parse found the known tic \`${id}\``, pats.some(p => p.id === id))
    }

    const hits = offenders(SKILLS, pats)
    ok('no skills/writing-* skill restates a phrase from the accepted tic dictionary',
       hits.length === 0,
       `${hits.join(' | ')} — the dictionary lives in ai-anti-patterns; a second copy cannot be ` +
       'regenerated by tic-add.py and goes stale silently')

    // NON-VACUITY. The assertion above is only worth its line if it can fail. Inject a known
    // accepted tic into a TEMP COPY of a register skill and prove the same scanner catches it.
    const tmp = mkdtempSync(join(tmpdir(), 'tic-nonvacuity-'))
    mkdirSync(join(tmp, 'writing-fixture'), { recursive: true })
    writeFileSync(join(tmp, 'writing-fixture', 'SKILL.md'),
                  '# fixture\n\nNever write `rich tapestry` — describe what it contains.\n')
    const injected = offenders(tmp, pats)
    ok('the scanner catches an injected tic phrase (the check is not vacuous)',
       injected.some(h => /writing-fixture.*rich-tapestry/.test(h)), JSON.stringify(injected))
    // And it does not fire on a register file with no tic in it.
    mkdirSync(join(tmp, 'writing-clean'), { recursive: true })
    writeFileSync(join(tmp, 'writing-clean', 'SKILL.md'),
                  '# fixture\n\nThe tic dictionary lives in ai-anti-patterns; /ai-tic adds to it.\n')
    ok('the scanner does not fire on a clean register file',
       !offenders(tmp, pats).some(h => /writing-clean/.test(h)))
  }

  // The pointer that replaced the deleted table must actually point somewhere.
  const wg = readFileSync(join(SKILLS, 'writing-general', 'SKILL.md'), 'utf8')
  ok('writing-general names ai-anti-patterns as the dictionary owner', wg.includes('ai-anti-patterns'))
  ok('writing-general points at /ai-tic as the way in', wg.includes('/ai-tic'))
  ok('writing-general no longer ships a tic table',
     !/corpus-gated tic table/.test(wg) && !/rich tapestry/i.test(wg))
}

// ── references/registers/ is gone, and nothing still points at it ────────────
{
  ok('references/registers/ no longer exists', !existsSync(join(ROOT, 'references', 'registers')))
  const r = spawnSync('git', ['grep', '-l', '--', 'references/registers'], { cwd: ROOT, encoding: 'utf8' })
  const hits = (r.stdout || '').split('\n').map(s => s.trim()).filter(Boolean)
    // This file names the path in its own assertion, so it always self-matches once tracked.
    .filter(f => f !== 'CHANGELOG.md' && !f.startsWith('scratch/') && !f.startsWith('.planning/')
                 && f !== 'tests/agent-contract.test.mjs' && !f.startsWith('docs/investigations/'))
  ok('no tracked file outside CHANGELOG.md references references/registers', hits.length === 0, hits.join(', '))
}

// ── The domain axis survives the output-style retirement ────────────────────
//
// `set-output-style.ts` is gone (see the retirement block above); the DOMAIN register axis it
// read is not, and still reaches prose through the audit script and the PostToolUse hook.
{
  ok('prose-audit.py keeps its own --style choices',
     /legal.*econ.*general|"legal"|'legal'/.test(readFileSync(join(ROOT, 'scripts', 'prose-audit.py'), 'utf8')))
  ok('writing-prose-check.ts still derives a domain style',
     readFileSync(join(ROOT, 'hooks', 'writing-prose-check.ts'), 'utf8').includes('--style'))
  // The shared plan-context module MUST survive the script deletion — two live hooks import it.
  ok('hooks/lib/writing-plan-context.ts survives', existsSync(join(ROOT, 'hooks', 'lib', 'writing-plan-context.ts')))
  for (const h of ['writing-prose-check.ts', 'cite-fidelity-lint.ts']) {
    ok(`hooks/${h} still imports authenticatedWritingPlan`,
       readFileSync(join(ROOT, 'hooks', h), 'utf8').includes('authenticatedWritingPlan'))
  }
}

// ── SessionStart install DETECTION: enumerates agents/, silent when clean ──────────────────────
//
// The hook DETECTS and REPORTS; skills/setup/SKILL.md DECIDES and WRITES. Three facts are asserted
// here because all three fail silently: a detector that names agents literally stops covering
// agents added later (the very drift it exists to catch); a detector that is not silent on a clean
// project becomes a banner everyone learns to skip — at which point it is not a check; and a
// detector that reports working defaults (unset `plansDirectory`, absent `.claude-workflows.json`)
// is nagging, which is the same thing by a different route.
{
  const HOOK = join(ROOT, 'hooks', 'session-start.ts')
  const src = readFileSync(HOOK, 'utf8')

  /** A named function's source, brace-balanced, so the assertions below scope to the detector and
   *  not to the rest of the file. */
  const fnSource = name => {
    const at = src.search(new RegExp(`(export )?function ${name}\\b`))
    if (at === -1) return ''
    const open = src.indexOf('{', at)
    let depth = 0
    for (let i = open; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1)
    }
    return src.slice(at)
  }

  const detector = fnSource('buildSetupSection') + '\n' + fnSource('danglingPreloads') +
                   '\n' + fnSource('unlinkedAgents') + '\n' + fnSource('agentFiles')
  ok('hooks/session-start.ts exports buildSetupSection', /export function buildSetupSection/.test(src))
  ok('the detector enumerates the agent directories at runtime', /readdirSync\(/.test(detector))
  ok('the detector reads the plugin-scoped agents directory, not a list',
     /"agents"/.test(detector))
  ok('the detector reads the user-scoped user-agents directory, not a list',
     /"user-agents"/.test(detector))
  // SCOPE is the second half: only `user-agents/` needs the ~/.claude/agents/ link, and a
  // user-agents file without one reaches Claude Code through no path at all.
  ok('the detector also checks the user-level agents directory',
     /homedir\(\)[^)]*"\.claude"/.test(detector))
  ok('the detector resolves the link rather than just testing existence',
     /realpathSync\(/.test(detector))

  // NO HARDCODED ROSTER AND NO NAMED EXCEPTION — the DIRECTORY states the scope, so no agent
  // basename, at either tier, may appear as a quoted/backticked literal anywhere in the hook.
  for (const a of ROSTER.map(x => x.name)) {
    const literal = new RegExp(`["'\`]${a.replace(/[-]/g, '\\-')}(\\.md)?["'\`]`)
    ok(`the detector does not name agent "${a}" literally`, !literal.test(detector))
    ok(`the hook does not name agent "${a}" literally anywhere`, !literal.test(src))
  }
  ok('the hook no longer carries a plugin-scoped exception list',
     !/PLUGIN_SCOPED_ONLY/.test(src))

  // The hook must never write the files the setup skill owns.
  ok('the detector writes nothing', !/writeFileSync|appendFileSync|renameSync|mkdirSync/.test(detector))

  // CONFIGURATION IS NOT A FINDING. `plansDirectory` resolves at either tier and falls back to
  // `.claude/plans`; `.claude-workflows.json` is an opt-in whose absence is the normal state.
  ok('the detector no longer reports plansDirectory', !/plansDirectory/.test(detector))
  ok('the detector no longer reports the governance opt-in',
     !/governance opt-in/.test(detector))

  const { buildSetupSection } = await import('../hooks/session-start.ts')

  // A project that uses the plugin, with every preload resolving.
  const clean = mkdtempSync(join(tmpdir(), 'setup-clean-'))
  writeFileSync(join(clean, '.claude-workflows.json'), '{"farmOutOnly": true}\n')
  spawnSync('mkdir', ['-p', join(clean, '.claude')])
  writeFileSync(join(clean, '.claude', 'settings.json'), '{"plansDirectory": "./.planning"}\n')
  const cleanOut = buildSetupSection(clean, ROOT)
  ok('the detector is SILENT on a healthy project', cleanOut === '', JSON.stringify(cleanOut))

  // Unrelated repo — no governance file, no .planning/, no .craft/: the gate keeps it quiet.
  const unrelated = mkdtempSync(join(tmpdir(), 'setup-unrelated-'))
  ok('the detector does not nag in an unrelated repo', buildSetupSection(unrelated, ROOT) === '')

  // UNSET plansDirectory is a working default, not a finding.
  const noplans = mkdtempSync(join(tmpdir(), 'setup-noplans-'))
  writeFileSync(join(noplans, '.claude-workflows.json'), '{}\n')
  ok('unset plansDirectory is NOT reported', buildSetupSection(noplans, ROOT) === '',
     JSON.stringify(buildSetupSection(noplans, ROOT)))

  // An ABSENT .claude-workflows.json is the normal state for a project that never opted in.
  const nogov = mkdtempSync(join(tmpdir(), 'setup-nogov-'))
  spawnSync('mkdir', ['-p', join(nogov, '.planning')])
  ok('an absent .claude-workflows.json is NOT reported', buildSetupSection(nogov, ROOT) === '',
     JSON.stringify(buildSetupSection(nogov, ROOT)))

  // A DANGLING PRELOAD in a fixture plugin root — the failure that survived a major version, and
  // the ONLY finding this detector still emits.
  const fakePlugin = mkdtempSync(join(tmpdir(), 'setup-plugin-'))
  spawnSync('mkdir', ['-p', join(fakePlugin, 'agents')])
  spawnSync('mkdir', ['-p', join(fakePlugin, 'user-agents')])
  spawnSync('mkdir', ['-p', join(fakePlugin, 'skills', 'real-skill')])
  writeFileSync(join(fakePlugin, 'skills', 'real-skill', 'SKILL.md'), '---\nname: real-skill\n---\n')
  writeFileSync(join(fakePlugin, 'user-agents', 'zz-fixture.md'),
    '---\nname: zz-fixture\nskills:\n  - real-skill\n  - ghost-skill\n---\nbody\n')
  // A PLUGIN-SCOPED agent with a dangling preload: the preload is still a finding, but its
  // ABSENCE from ~/.claude/agents/ is the intended state and must never be reported.
  writeFileSync(join(fakePlugin, 'agents', 'zz-plugin-fixture.md'),
    '---\nname: zz-plugin-fixture\nskills:\n  - phantom-skill\n---\nbody\n')
  const dangling = buildSetupSection(clean, fakePlugin)
  ok('a dangling preload is reported', /ghost-skill/.test(dangling), JSON.stringify(dangling))
  ok('a resolving preload is NOT reported', !/real-skill/.test(dangling), JSON.stringify(dangling))
  ok('the dangling report names the agent it came from', /zz-fixture\.md/.test(dangling))
  ok('the dangling report names the directory that owns the agent',
     /user-agents\/zz-fixture\.md/.test(dangling), JSON.stringify(dangling))
  ok('the dangling report points at the setup skill', /setup/.test(dangling), JSON.stringify(dangling))
  ok('a dangling preload in the plugin-scoped agents/ is reported too',
     /phantom-skill/.test(dangling) && /agents\/zz-plugin-fixture\.md/.test(dangling),
     JSON.stringify(dangling))

  // AN UNLINKED user-agents/ FILE IS THE OTHER FINDING. zz-fixture ships in the fixture plugin's
  // user-agents/ and has no ~/.claude/agents/ entry, so it reaches Claude Code by no path at all.
  ok('a user-agents file with no user-scope symlink is reported',
     /no resolving `~\/\.claude\/agents\/zz-fixture\.md`/.test(dangling), JSON.stringify(dangling))
  ok('the unlinked report explains that hooks do not fire',
     /hooks:` frontmatter is ignored/.test(dangling), JSON.stringify(dangling))
  ok('a plugin-scoped agents/ file is NOT reported as unlinked',
     !/zz-plugin-fixture\.md` ships/.test(dangling), JSON.stringify(dangling))

  // This repo's own agents all resolve, and every user-agents/ file is linked.
  const selfCheck = buildSetupSection(clean, ROOT)
  ok('no agent in this repo has a dangling preload', !/does not resolve/.test(selfCheck))
  ok('every agent in this repo that needs user scope has it',
     !/no resolving/.test(selfCheck), JSON.stringify(selfCheck))
}

// ── /start is gone: no dangling reference to a command that no longer exists ────────────────────
{
  ok('commands/start.md is deleted', !existsSync(join(ROOT, 'commands', 'start.md')))
  ok('the setup skill exists', existsSync(join(SKILLS, 'setup', 'SKILL.md')))

  const setup = readFileSync(join(SKILLS, 'setup', 'SKILL.md'), 'utf8')
  ok('the setup skill enumerates agents at runtime rather than naming them',
     /readdirSync\(/.test(setup))
  ok('the setup skill checks user scope, not just the shipped file',
     /realpathSync\(/.test(setup) && /\.claude", "agents"/.test(setup))
  ok('the setup skill enumerates the user-scoped directory by name',
     /user-agents/.test(setup))
  for (const a of ROSTER.map(x => x.name)) {
    ok(`the setup skill does not name agent "${a}" literally`,
       !new RegExp(`["'\`]${a.replace(/[-]/g, '\\-')}(\\.md)?["'\`]`).test(setup))
  }
  // No named exception survives the split: the directory an agent sits in states its scope.
  ok('the setup skill no longer carries a plugin-scoped exception list',
     !/PLUGIN_SCOPED_ONLY/.test(setup))
  ok('the setup skill refuses rather than overwrites a malformed settings file',
     /REFUSED/.test(setup) && /not valid JSON/.test(setup))
  ok('the setup skill only REPORTS the main-thread guard', /DO NOT EDIT THIS FILE/.test(setup))

  // Every shipped .md/.ts, minus the changelog, scratch, vendored docs and this file: no reference
  // to the dead command. The lookahead keeps unrelated paths like `data_ref/start.html` out.
  const STALE = /commands\/start\.md|\/start(?![\w./-])/
  const stale = []
  const walk = dir => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'scratch', 'vendor', 'external', 'CHANGELOG.md',
           'agent-contract.test.mjs'].includes(e.name)) continue
      const p = join(dir, e.name)
      if (e.isDirectory()) { walk(p); continue }
      if (!/\.(md|ts|mjs)$/.test(e.name)) continue
      if (STALE.test(readFileSync(p, 'utf8'))) stale.push(p.slice(ROOT.length + 1))
    }
  }
  walk(ROOT)
  ok('nothing references the deleted /start command', stale.length === 0, stale.join(', '))
}

// ── AGENTS ARE THE FRONT DOOR: the knowledge registers are agent-internal ───────────────────────
//
// The registers are dispatched-to, not slash-invoked. Loading one into the MAIN chat lands its
// rules on top of Claude Code's own `# Doing tasks` / `# Tone and style` sections and competes with
// them; a custom agent's body IS its whole system prompt, so that framing was never there.
//
//   `user-invocable: false`         removes the slash command. The model and preload paths survive.
//   `disable-model-invocation: true` is the TRAP and is forbidden here. A preloaded skill that sets
//                                   it is skipped with a warning to the DEBUG LOG ONLY — the agent
//                                   launches and the guidance never arrives. It also kills the
//                                   persona path: `claude --agent writing` picks the register up
//                                   through the Skill TOOL, because preloads do not reach a persona
//                                   session. Setting it disables both delivery routes at once.
//
// ENUMERATED, never listed: a hardcoded roster stops covering a register added later.
{
  const REGISTERS = readdirSync(SKILLS)
    .filter(n => /^writing-/.test(n) || n === 'ds-constraints' || n === 'workshop-constraints')
    .filter(n => existsSync(join(SKILLS, n, 'SKILL.md')))
    .sort()
  ok('the agent-internal register set is not empty', REGISTERS.length > 0,
     'nothing was checked — the glob matched no skill')

  for (const name of REGISTERS) {
    const md = join(SKILLS, name, 'SKILL.md')
    const fm = frontmatter(md)
    ok(`skills/${name} has parseable frontmatter`, fm !== null, md)
    if (!fm) continue
    // `user-invocable: false` — the value is YAML false, so assert on the false-ness, not on the
    // key's presence: `user-invocable: true` is present and would pass a presence check.
    ok(`skills/${name} sets user-invocable: false (no slash command; it is agent-internal)`,
       isYamlFalse(fm.scalars['user-invocable']),
       `user-invocable is ${JSON.stringify(fm.scalars['user-invocable'] ?? null)}`)
    ok(`skills/${name} does NOT set disable-model-invocation (it would kill preload AND persona)`,
       !isYamlTrue(fm.scalars['disable-model-invocation']),
       'a preloaded skill that disables model invocation is skipped to the debug log only')
  }
}

// ── DESCRIPTIONS ARE THE ROUTING SURFACE, so they carry no wiring notes ─────────────────────────
//
// With the registers no longer user-invocable, an agent's `description` is the ONLY thing that
// routes work to it. `Also the session persona for \`claude --agent X\`` is wiring: it belongs in
// the body, it does nothing for triggering, and it spends the description's budget.
{
  ok('there are agent descriptions to check', ROSTER.length > 0)
  for (const { name, path, tier } of ROSTER) {
    const fm = existsSync(path) ? frontmatter(path) : null
    if (!fm) continue
    ok(`${tier}:${name} description carries no "session persona for" wiring note`,
       !/session persona for/i.test(descriptionText(fm)),
       'mechanism belongs in the body, not the routing surface')
  }
}

// ── A PROSE IRON LAW MAY NOT STAND UNENFORCED ──────────────────────────────────────────────────
//
// An agent's body is its whole system prompt, so an absolute law written there reads exactly like a
// mechanism. It is not one. The two absolute laws this repo's agents actually declare have DIFFERENT
// enforcement surfaces, and the difference is the rule:
//
//   NEVER-SEND  happens only through `Bash` — no writer tool is involved and none can be removed to
//               stop it, so a `hooks:` PreToolUse guard is the ONLY enforcement available. An agent
//               that declares the law, holds Bash, and declares no hook is running on prose alone.
//               This is the case the rule exists for: `assistant` states "THIS AGENT NEVER SENDS"
//               and routes through himalaya/morgen/gws/beeper with the same Bash tool `email` uses.
//   NEVER-EDIT  is enforced by REMOVING the writer tools, which is strictly stronger than a hook and
//               cannot be argued around. That is already asserted above, and it is why the three
//               reviewers carry no hook and need none.
//
// PLUGIN-SCOPED AGENTS ARE OUT OF SCOPE BY CONSTRUCTION, not by exception: `hooks:` is IGNORED for
// an `agents/` file (asserted above), so requiring one there would demand dead config. THE DIRECTORY
// STATES THE SCOPE, so this loop enumerates the user-scoped tier and names nobody.
//
// The rosters are ENUMERATED across all three repos that ship user-scoped agents — this plugin,
// the teaching plugin, and dotfiles — because ~/.claude/agents/ is one namespace and a law that
// stands unenforced does not care which repo shipped it.
{
  /** An absolute never-send law, however the body words it. Both markers are ABSOLUTE forms: a
   *  conditional rule ("never send unless this turn says to") is a different claim and this set
   *  deliberately does not match it on the heading alone. */
  const SEND_LAW = [
    /\bNEVER SENDS?\b/,
    /\bno outbound authority\b/i,
    /(^|[^\w])[Nn]ever[^\n]{0,60}\b(send|sends|reply|forward|RSVP)\b/m,
  ]
  const declaresSendLaw = body => SEND_LAW.some(re => re.test(body))

  /** Every user-scoped agent file, from every repo that ships one, resolved through the ONE
   *  directory Claude Code reads. Enumerated; no repo is named as a special case. */
  const userScopedFiles = () =>
    (existsSync(USER_AGENTS) ? readdirSync(USER_AGENTS) : [])
      .filter(f => f.endsWith('.md'))
      .map(f => { try { return { file: f, path: realpathSync(join(USER_AGENTS, f)) } } catch { return null } })
      .filter(a => a && existsSync(a.path))

  let lawful = 0
  for (const { file, path } of userScopedFiles()) {
    const text = readFileSync(path, 'utf8')
    const fm = frontmatter(path)
    if (!fm) continue
    // The DESCRIPTION is a routing surface, not the agent's instructions; a law counts only when it
    // is in the body, which is what the agent is actually running under.
    const body = text.slice(text.indexOf('\n---\n', 3) + 5)
    if (!declaresSendLaw(body)) continue
    if (!values(fm, 'tools').includes('Bash')) continue
    lawful++
    ok(`${file} declares a never-send law and holds Bash, so it must declare hooks:`,
       /^hooks:/m.test(fm.raw),
       'sending happens only through Bash; with no PreToolUse guard the Iron Law is prose only')
    // A hook that is declared but points at nothing is the same failure one layer down.
    for (const m of fm.raw.matchAll(/^\s+command:\s*(\S+)/gm)) {
      const script = m[1].replace(/^~/, homedir())
      ok(`${file}: hook command ${m[1]} exists on disk`, existsSync(script), script)
    }
  }
  ok('at least one agent declares a never-send law and holds Bash', lawful > 0,
     'the marker set matched nothing — the rule would pass vacuously')

  // NON-VACUITY. The assertion is worth its line only if it can fail. Run the SAME detector over
  // three temp agent files: the law + Bash + no hook must be caught, and neither control may fire.
  const tmp = mkdtempSync(join(tmpdir(), 'sendlaw-'))
  const fixture = (name, fmText, body) => {
    const p = join(tmp, name)
    writeFileSync(p, `---\n${fmText}---\n\n${body}\n`)
    return p
  }
  /** The detector, factored out so the fixtures exercise the identical predicate. */
  const unenforced = p => {
    const text = readFileSync(p, 'utf8')
    const fm = frontmatter(p)
    const body = text.slice(text.indexOf('\n---\n', 3) + 5)
    return declaresSendLaw(body) && values(fm, 'tools').includes('Bash') && !/^hooks:/m.test(fm.raw)
  }
  const bad = fixture('zz-unenforced.md', 'name: zz-unenforced\ntools: Read, Bash\n',
                      '## Iron Law: THIS AGENT NEVER SENDS\n\nNo outbound authority.')
  const guarded = fixture('zz-guarded.md',
                          'name: zz-guarded\ntools: Read, Bash\nhooks:\n  PreToolUse:\n    - matcher: Bash\n',
                          '## Iron Law: THIS AGENT NEVER SENDS\n\nNo outbound authority.')
  const nolaw = fixture('zz-nolaw.md', 'name: zz-nolaw\ntools: Read, Bash\n',
                        'You draft prose. Send it when the user says to.')
  const notbash = fixture('zz-notbash.md', 'name: zz-notbash\ntools: Read, Grep\n',
                          '## Iron Law: THIS AGENT NEVER SENDS\n\nNo outbound authority.')
  ok('the detector catches a never-send law with Bash and no hook (not vacuous)', unenforced(bad))
  ok('the detector does not fire when the hook is declared', !unenforced(guarded))
  ok('the detector does not fire on an agent with no such law', !unenforced(nolaw))
  ok('the detector does not fire on an agent that cannot run Bash', !unenforced(notbash))
}

// ── EVERY `skills:` ENTRY IN ALL THREE REPOS RESOLVES ───────────────────────────────────────────
//
// The block far above walks ~/.claude/agents/, which reaches the other repos only through their
// symlinks. That is the LIVE path, and it is the right one to assert — but it goes dark the moment
// a link is missing, which is precisely when a broken preload is most likely. This walks the SHIPPED
// directories of all three repos directly, so a dangling `skills:` entry is caught in the file the
// author edits, whether or not the link that would surface it exists.
{
  const REPOS = [
    join(ROOT, 'agents'),
    join(ROOT, 'user-agents'),
    join(homedir(), 'projects', 'teaching', 'user-agents'),
    join(homedir(), 'dotfiles', '.claude', 'agents'),
  ]
  const USER_SKILLS = join(homedir(), '.claude', 'skills')
  /** Every directory a `skills:` name can resolve against. ENUMERATED, never listed. */
  const ROOTS = (() => {
    const roots = [USER_SKILLS, SKILLS]
    if (existsSync(USER_SKILLS)) {
      for (const e of readdirSync(USER_SKILLS)) {
        const nested = join(USER_SKILLS, e, 'skills')
        try { if (statSync(nested).isDirectory()) roots.push(nested) } catch { /* dangling link */ }
      }
    }
    return roots
  })()
  const resolvesIn = (rootSet, name) => rootSet.some(r => existsSync(join(r, name, 'SKILL.md')))

  ok('the skill search path is not empty', ROOTS.length > 1, String(ROOTS.length))
  let repos = 0, entries = 0
  for (const dir of REPOS) {
    if (!existsSync(dir)) { ok(`agent directory ${dir} exists`, false, dir); continue }
    repos++
    for (const f of readdirSync(dir).filter(x => x.endsWith('.md'))) {
      const fm = frontmatter(join(dir, f))
      if (!fm) continue
      for (const skill of values(fm, 'skills')) {
        entries++
        ok(`${dir.replace(homedir(), '~')}/${f}: skills: ${skill} resolves`,
           resolvesIn(ROOTS, skill), `searched ${ROOTS.length} roots`)
        // A preloaded skill that disables model invocation is skipped with a DEBUG-LOG warning
        // only — the agent launches and the guidance never arrives. Same trap, every repo.
        const md = ROOTS.map(r => join(r, skill, 'SKILL.md')).find(existsSync)
        if (!md) continue
        ok(`${dir.replace(homedir(), '~')}/${f}: skills: ${skill} is preloadable`,
           !isYamlTrue(frontmatter(md)?.scalars['disable-model-invocation']),
           'a disable-model-invocation skill is silently skipped when preloaded')
      }
    }
  }
  ok('all three repos shipping agents were walked', repos === REPOS.length, String(repos))
  ok('preload entries were actually checked', entries >= 10, String(entries))

  // NON-VACUITY: the resolver must reject a name that is not there, and accept one that is.
  ok('the resolver rejects a skill that does not exist',
     !resolvesIn(ROOTS, 'zz-ghost-skill-that-does-not-exist'))
  ok('the resolver accepts a skill that does exist', resolvesIn(ROOTS, 'writing-general'))
  // And it must reach ACROSS repos: find-slide-page ships in the teaching plugin, not this one.
  ok('the resolver reaches another plugin\'s skills (find-slide-page)',
     resolvesIn(ROOTS, 'find-slide-page'),
     'teaching agents preload it; a resolver confined to this repo would call it dangling')
  ok('the resolver would NOT find find-slide-page in this repo alone',
     !existsSync(join(SKILLS, 'find-slide-page', 'SKILL.md')),
     'if it were also here, the cross-repo assertion above would prove nothing')
}

// ── THE WRITABLE DEFAULT: every lens declares an agentType, every prose implementer names one ────
//
// The silent failure this closes. Craft's `reviewAgentType(explicit)` returns the explicit type, or
// `Explore` ONLY under `readOnly`, or NULL (skills/craft/workflow.js:264). Null contributes no
// `agentType` key at all, so the dispatcher default applies — and the dispatcher default HOLDS EDIT
// AND WRITE. A lens is a judge: it only READS. An unpinned lens in a writing mode therefore judges
// the deliverable while able to rewrite it, and nothing in a run says so.
//
// The mirror-image rule for the implementer. It WRITES, and the default agent carries Claude Code's
// software-engineering system prompt. Where the output is prose a human reads, that framing is
// wrong and the implementer must be a custom agent whose body replaces it. Where the output is
// CODE, it is right — so `dev` and `workflow-creator` are asserted to have NO override, which makes
// the split a decision the suite defends rather than a list one side of which nobody checks.
{
  const BUILTINS = new Set(['Explore', 'Plan', 'general-purpose'])
  const TEACHING = join(homedir(), 'projects', 'teaching', 'skills')

  /** Resolve one agentType string. A bare name dispatches user-level, so ~/.claude/agents/ is the
   *  live path and the only one that decides whether the dispatch lands. */
  const typeResolves = t => BUILTINS.has(t) || userAgentTarget(t.replace(/^workflows:/, '')) !== null

  /** A dispatch block is a fenced code block containing `reviewLenses:`. */
  const blocksOf = body => {
    const out = []
    let inFence = false, start = 0, buf = []
    body.split('\n').forEach((l, i) => {
      if (/^```/.test(l)) {
        if (!inFence) { inFence = true; start = i + 1; buf = [] }
        else { inFence = false; if (buf.join('\n').includes('reviewLenses:')) out.push({ line: start + 1, text: buf.join('\n'), lines: buf }) }
        return
      }
      if (inFence) buf.push(l)
    })
    return out
  }

  /** Every lens entry of a block as {key, agentType|null}. */
  const lensesOf = b => {
    const heads = b.lines.map((l, i) => ({ l, i })).filter(x => /^\s*\{\s*key:\s*"/.test(x.l))
    return heads.map((x, n) => {
      const seg = b.lines.slice(x.i, n + 1 < heads.length ? heads[n + 1].i : b.lines.length).join('\n')
      const at = seg.match(/agentType:\s*"([^"]+)"/)
      return { key: x.l.match(/key:\s*"([^"]+)"/)[1], agentType: at ? at[1] : null }
    })
  }

  const SKILL_DIRS = [['workflows', SKILLS], ['teaching', TEACHING]]
  let lensCount = 0
  for (const [repo, dir] of SKILL_DIRS) {
    ok(`${repo}: skills directory exists`, existsSync(dir), dir)
    if (!existsSync(dir)) continue
    for (const s of readdirSync(dir).filter(d => existsSync(join(dir, d, 'SKILL.md')))) {
      for (const b of blocksOf(readFileSync(join(dir, s, 'SKILL.md'), 'utf8'))) {
        for (const lens of lensesOf(b)) {
          lensCount++
          const at = `${repo}/skills/${s}:${b.line} lens ${lens.key}`
          // (a) DECLARED. An absent key is the writable default, not a documented choice.
          ok(`${at} declares an agentType`, lens.agentType !== null,
             'absent => no agentType key reaches agent() => the dispatcher default, which holds Edit and Write')
          if (lens.agentType === null) continue
          // (b) RESOLVES. A typo is indistinguishable from an absent key at dispatch time.
          ok(`${at} agentType "${lens.agentType}" resolves`, typeResolves(lens.agentType),
             'not a documented built-in and not linked into ~/.claude/agents/')
        }
      }
    }
  }
  ok('lens entries were actually walked', lensCount >= 70, String(lensCount))

  // (c) PROSE IMPLEMENTERS. Every non-readOnly dispatch block of a prose workflow names one.
  // A readOnly block dispatches no implementer at all (workflow.js:724), so it is exempt BY THE
  // FLAG, never by a listed exception.
  const PROSE = [
    [SKILLS, 'ds'], [SKILLS, 'writing'], [SKILLS, 'workshop'],
    [TEACHING, 'notes'], [TEACHING, 'slides'], [TEACHING, 'exams'],
  ]
  let implBlocks = 0
  for (const [dir, s] of PROSE) {
    const p = join(dir, s, 'SKILL.md')
    ok(`prose workflow ${s} exists`, existsSync(p), p)
    if (!existsSync(p)) continue
    for (const b of blocksOf(readFileSync(p, 'utf8'))) {
      if (/readOnly:\s*true/.test(b.text)) continue
      implBlocks++
      const m = b.text.match(/implementerAgentType:\s*"([^"]+)"/)
      ok(`${s}:${b.line} (writing mode) sets implementerAgentType`, m !== null,
         'its output is prose a human reads, so the implementer must not inherit the default software-engineering prompt')
      if (!m) continue
      // A `<a|b|c>` placeholder is the honest encoding of a value chosen when the plan is armed
      // (writing's Domain: picks the register, so it picks the doer). Every ALTERNATIVE must
      // resolve — a placeholder is not a licence to name an agent that does not exist.
      const alts = /^<.*>$/.test(m[1]) ? m[1].slice(1, -1).split('|') : [m[1]]
      ok(`${s}:${b.line} implementerAgentType "${m[1]}" is not an open-ended placeholder`,
         alts.every(a => /^[\w:-]+$/.test(a)), m[1])
      for (const a of alts) {
        ok(`${s}:${b.line} implementerAgentType alternative "${a}" resolves`, typeResolves(a))
      }
    }
  }
  ok('writing-mode blocks were actually walked', implBlocks >= 8, String(implBlocks))

  // THE OTHER SIDE OF THE SPLIT. Code output => Claude Code's software-engineering prompt is
  // CORRECT, so the absence of an override here is a decision, not the oversight it is above.
  // Asserting it means a future override has to argue with this test rather than slip in.
  for (const s of ['dev', 'workflow-creator']) {
    const body = readFileSync(join(SKILLS, s, 'SKILL.md'), 'utf8')
    for (const b of blocksOf(body)) {
      ok(`${s}:${b.line} sets NO implementerAgentType — its output is code`,
         !/^\s*implementerAgentType:/m.test(b.text),
         'if this workflow now emits prose, change the PROSE list above and say why here')
    }
  }

  // NON-VACUITY, computed rather than asserted: the lens walker must FAIL on a lens whose
  // agentType is removed, and the resolver must reject a name nobody ships.
  {
    const probe = { lines: ['    { key: "probe-lens",', '      refs: [],', '      prompt: "x" },'] }
    ok('the lens walker reports a stripped agentType as absent', lensesOf(probe)[0].agentType === null)
    const pinned = { lines: ['    { key: "probe-lens",', '      agentType: "Explore",', '      prompt: "x" },'] }
    ok('the lens walker reads a present agentType', lensesOf(pinned)[0].agentType === 'Explore')
    ok('the agentType resolver rejects a name nobody ships', !typeResolves('zz-ghost-agent'))
    ok('the agentType resolver accepts a real user-level agent', typeResolves('lecture-impl'))
    ok('the agentType resolver accepts a documented built-in', typeResolves('Explore'))
  }
}

// ── EVERY NAMED HOOK RESOLVES TO A FILE ────────────────────────────────────────────────────────
//
// One shape of bug keeps recurring: a NAME STATED AS FACT that resolves to nothing. A `skills:`
// entry for a deleted skill; three skill names in a register's prose; two hook names in the
// design comment at hooks/_gate_common.ts, reasoned about as if both were live. Nothing breaks at
// runtime — hooks.json's own entries all resolve — so only a reader is misled, which is why it
// survives. The suite already asserts skills and agents resolve; this asserts hooks do.
//
// SCOPE IS DELIBERATE, because a lint that fires on prose gets disabled. Two reference shapes
// count and nothing else:
//   1. a `hooks/<x>.ts` or `hooks/<x>.sh` PATH — but not one under `.claude/`, which is the
//      user-level hooks directory this plugin does not own;
//   2. a BACKTICKED bare name that is unmistakably a hook noun: `<x>-guard`, and `<x>-guard.ts`
//      / `-check.ts` / `-lint.ts` with the extension spelled. Bare `-check`/`-lint` are NOT
//      counted — they collide with CLI flags (`--check`), skills (`cite-check`) and plan-lint
//      finding codes (`acceptance-is-the-mechanical-check`).
// Inside `hooks/` itself the vocabulary is controlled, so ANY backticked kebab-case name there is
// checked — that is what catches a `writing-suggest-verify` whose suffix is not a hook noun.
//
// Exclusions are historical surfaces: CHANGELOG.md, scratch/, .planning/, docs/ (design records
// that state retirements), and tests/ + scripts/ (synthetic fixture paths like `hooks/x.ts`).
{
  const tracked = (spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).stdout || '')
    .split('\n').map(s => s.trim()).filter(Boolean)
  const IN_SCOPE = f =>
    f !== 'CHANGELOG.md' &&
    !/^(scratch|\.planning|docs|tests|scripts)\//.test(f) &&
    (/^(hooks|skills|agents|user-agents|references)\//.test(f) || (!f.includes('/') && f.endsWith('.md')))
  const trackedBasenames = new Set(tracked.map(f => f.split('/').pop().split('.')[0]))
  const hookExists = n => existsSync(join(ROOT, 'hooks', `${n}.ts`)) || existsSync(join(ROOT, 'hooks', `${n}.sh`))

  const PATH_RE = /(?<![\w./-])hooks\/((?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:ts|sh))/g
  const EXT_RE = /`([A-Za-z0-9][A-Za-z0-9_-]*(?:-guard|-check|-lint))\.(?:ts|sh)`/g
  const GUARD_RE = /`([A-Za-z0-9][A-Za-z0-9_-]*-guard)`/g
  const KEBAB_RE = /`([a-z0-9]+(?:-[a-z0-9]+){1,4})`/g

  /** Every hook name a file states as fact that resolves to no file. Exported shape: [file, ref]. */
  const danglingHookRefs = (text, file) => {
    const out = []
    for (const [, rel] of text.matchAll(PATH_RE)) {
      if (!existsSync(join(ROOT, 'hooks', rel))) out.push(`hooks/${rel}`)
    }
    const names = new Set()
    for (const re of [EXT_RE, GUARD_RE]) for (const [, n] of text.matchAll(re)) names.add(n)
    if (file.startsWith('hooks/')) for (const [, n] of text.matchAll(KEBAB_RE)) names.add(n)
    for (const n of names) {
      if (hookExists(n)) continue
      if (text.includes(`.claude/hooks/${n}`)) continue   // user-level hook, not this plugin's
      if (trackedBasenames.has(n)) continue               // resolves as a skill/script/agent
      out.push(`\`${n}\``)
    }
    return out
  }

  const scanned = tracked.filter(IN_SCOPE)
  ok('the hook-reference scan actually has files to scan', scanned.length > 100, `${scanned.length}`)
  const dangling = []
  for (const f of scanned) {
    let text
    // git tracks symlinks and submodule gitlinks too; only regular files have text to scan.
    try { text = statSync(join(ROOT, f)).isFile() ? readFileSync(join(ROOT, f), 'utf8') : null }
    catch { text = null }
    if (text === null) continue
    for (const ref of danglingHookRefs(text, f)) dangling.push(`${f}: ${ref}`)
  }
  ok('no tracked source file names a hook that does not exist', dangling.length === 0, dangling.join('; '))

  // NON-VACUITY, computed rather than asserted: the scanner must FAIL on a fabricated name, in
  // each of the three reference shapes it claims to cover.
  ok('the scanner catches a fabricated hooks/<x>.ts path',
     danglingHookRefs('see hooks/zz-ghost-hook.ts for details', 'README.md').length === 1)
  ok('the scanner catches a fabricated backticked `<x>-guard`',
     danglingHookRefs('the `zz-ghost-guard` denies it', 'skills/x/SKILL.md').length === 1)
  ok('the scanner catches a fabricated bare hook name inside hooks/',
     danglingHookRefs('as `zz-ghost-verify` does', 'hooks/_gate_common.ts').length === 1)
  // ...and must NOT fire on the shapes it deliberately excludes.
  ok('the scanner ignores a real hook', danglingHookRefs('bun hooks/session-start.ts', 'README.md').length === 0)
  ok('the scanner ignores a user-level .claude/hooks path',
     danglingHookRefs('~/.claude/hooks/main-thread-guard.sh and `main-thread-guard`', 'skills/x/SKILL.md').length === 0)
  ok('the scanner ignores a bare --check flag and a -check skill name',
     danglingHookRefs('pass `--check`, see `cite-check`', 'skills/x/SKILL.md').length === 0)
}


// ── EVERY HOOK THAT EXISTS IS REGISTERED, A LIBRARY, OR EXPLICITLY QUARANTINED ─────────────────
//
// The converse of the scan above. That one asserts every NAME resolves to a FILE; this asserts
// every FILE resolves to a REGISTRATION. The failure it catches is the one this repo actually
// shipped: three hook files, cited by four skills as though live, registered in no settings file
// and no hooks.json. Nothing errors — the guard simply never runs, and every reader who saw the
// citation believed it did. Silence is the whole bug, which is why only a test finds it.
//
// A file is legitimate if ANY of:
//   1. hooks/hooks.json names it in a `command`;
//   2. it is a LIBRARY — leading underscore, or under hooks/lib/, or its header declares no hook
//      event (nothing imports it as a gate, so nothing should register it);
//   3. it is on UNREGISTERED_BY_DECISION below — a hook deliberately left unwired.
//
// Case 3 is an ALLOWLIST, not an escape hatch, and it carries its own upkeep: each entry must
// still exist, must still be absent from hooks.json, and must be described as unregistered in the
// skills that cite it. An entry that gets wired, deleted, or quietly re-described as live fails
// here. Adding a name is a deliberate act with a reason recorded next to it; forgetting to wire a
// new hook is not, and lands as a failure.
{
  const HOOK_EVENTS = /\b(PreToolUse|PostToolUse|SessionStart|SessionEnd|Stop|SubagentStop|UserPromptSubmit|PreCompact|Notification|TeammateIdle)\b/

  // name -> why it is not wired. Measured 2026-08-21 against the tree at that commit.
  const UNREGISTERED_BY_DECISION = {
    'plugin-validate.ts':
      'fires on all 89 SKILL.md + agents + manifests and emits the same symlink warning every time (91 firing files); registering it spams every skill edit',
    'validate-skill-paths.ts':
      '22 pre-existing broken refs across 13 files, 13 of them trailing-punctuation or doc-placeholder false positives; too noisy to wire until the FPs are fixed',
  }

  const hooksJson = readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')

  /** Hook files that exist but nothing invokes. Exported shape: [name, reason]. */
  const unwiredHooks = (dir, registryText, allow) => {
    const out = []
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const n = entry.name
      if (!entry.isFile() || !/\.(ts|sh)$/.test(n)) continue
      if (n.startsWith('_')) continue                                  // library by convention
      if (registryText.includes(n)) continue                           // registered
      let header
      try { header = readFileSync(join(dir, n), 'utf8').slice(0, 2000) } catch { continue }
      if (!HOOK_EVENTS.test(header)) continue                          // declares no event: a library
      if (Object.hasOwn(allow, n)) continue                            // quarantined on purpose
      out.push(n)
    }
    return out.sort()
  }

  const HOOK_DIR = join(ROOT, 'hooks')
  const unwired = unwiredHooks(HOOK_DIR, hooksJson, UNREGISTERED_BY_DECISION)
  ok('every hook file is registered in hooks.json, a library, or explicitly quarantined',
     unwired.length === 0,
     `unwired: ${unwired.join(', ')}`)

  // hooks/lib/ is a library directory by construction — assert it is, so a gate dropped in there
  // cannot hide from the scan above.
  if (existsSync(join(HOOK_DIR, 'lib'))) {
    for (const f of readdirSync(join(HOOK_DIR, 'lib'))) {
      ok(`hooks/lib/${f} is a library, not a registered gate`, !hooksJson.includes(`lib/${f}`))
    }
  }

  // The allowlist must not go stale in either direction.
  for (const [n, reason] of Object.entries(UNREGISTERED_BY_DECISION)) {
    ok(`quarantined hook ${n} still exists`, existsSync(join(HOOK_DIR, n)))
    ok(`quarantined hook ${n} is genuinely absent from hooks.json`, !hooksJson.includes(n))
    ok(`quarantined hook ${n} records why it is unwired`, reason.length > 40)
    // ...and no skill may describe it as live. Every citing skill must say it is not registered.
    const citing = spawnSync('git', ['grep', '-l', n, '--', 'skills/'], { cwd: ROOT, encoding: 'utf8' })
      .stdout.split('\n').map(s => s.trim()).filter(Boolean)
    for (const f of citing) {
      ok(`${f} cites ${n} and states plainly that it is not registered`,
         /not\s+\*\*?registered|\*\*not\*\*\s+registered|not registered/i.test(readFileSync(join(ROOT, f), 'utf8')),
         f)
    }
  }

  // NON-VACUITY, computed rather than asserted: a hook file that is neither registered, a library,
  // nor quarantined must be REPORTED. Exercised against the real detector, not a restatement.
  const ghost = 'zz-ghost-unwired.ts'
  const ghostPath = join(HOOK_DIR, ghost)
  writeFileSync(ghostPath, '#!/usr/bin/env bun\n/** PostToolUse hook: a guard nothing invokes. */\n')
  try {
    ok('the detector catches an unregistered hook with an event header (not vacuous)',
       unwiredHooks(HOOK_DIR, hooksJson, UNREGISTERED_BY_DECISION).includes(ghost))
    ok('the detector clears that same file once hooks.json registers it',
       !unwiredHooks(HOOK_DIR, `${hooksJson}\n"bun x/hooks/${ghost}"`, UNREGISTERED_BY_DECISION).includes(ghost))
    ok('the detector clears that same file once it is quarantined',
       !unwiredHooks(HOOK_DIR, hooksJson, { ...UNREGISTERED_BY_DECISION, [ghost]: 'x' }).includes(ghost))
  } finally {
    unlinkSync(ghostPath)
  }
  ok('the non-vacuity fixture was removed', !existsSync(ghostPath))
}


console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
