// Agent contract: the plumbing between skills/*/SKILL.md, agents/*.md and skills/*/ — skill
// preloading, agentType resolution, the read-only writer exclusion, the one output style, the
// settings merge. (Was writing-register-contract.test.mjs; it is the general agent suite now, and
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
import { readdirSync, readFileSync, existsSync, realpathSync, statSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir, homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PLUGIN_AGENTS = join(ROOT, 'agents')
const SCOPED_AGENTS = join(ROOT, 'user-agents')
const USER_AGENTS = join(homedir(), '.claude', 'agents')
const SKILLS = join(ROOT, 'skills')
const STYLES = join(ROOT, 'output-styles')

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
  ok('writing-reviewer preloads writing-register', values(fm, 'skills').includes('writing-register'))
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

// ── The drafting agent: writes, so it must NOT carry the read-only iron law ──────
{
  const p = agentPath('writing')
  ok('user-agents/writing.md exists', existsSync(p))
  const fm = existsSync(p) ? frontmatter(p) : null
  const wskills = values(fm, 'skills')
  ok('writing preloads writing-register', wskills.includes('writing-register'))
  ok('writing preloads ai-anti-patterns', wskills.includes('ai-anti-patterns'))
  for (const s of wskills) {
    ok(`user-agents/writing.md: skills: ${s} resolves`, existsSync(join(SKILLS, s, 'SKILL.md')))
  }
  const wtools = values(fm, 'tools')
  ok('writing can actually write', wtools.includes('Write') && wtools.includes('Edit'), wtools.join(','))
  // The read-only iron law and a writer toolset cannot coexist: the block below would fail it,
  // and an agent under contradictory instructions drafts nothing.
  ok('writing does not contain "YOU DO NOT EDIT"',
     existsSync(p) && !readFileSync(p, 'utf8').includes('YOU DO NOT EDIT'))
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

// ── The register skill itself ────────────────────────────────────────────────
{
  const md = join(SKILLS, 'writing-register', 'SKILL.md')
  ok('skills/writing-register/SKILL.md exists', existsSync(md))
  if (existsSync(md)) {
    const fm = frontmatter(md)
    ok('writing-register has a name', fm?.scalars.name === 'writing-register', fm?.scalars.name)
    ok('writing-register has a description', !!fm?.scalars.description)
    ok('writing-register is preloadable (no disable-model-invocation)',
       !isYamlTrue(fm?.scalars['disable-model-invocation']))
    // Output-style-only frontmatter has no meaning in a skill.
    for (const dead of ['style', 'slug', 'keep-coding-instructions']) {
      ok(`writing-register does not carry the output-style field \`${dead}\``, !(dead in (fm?.scalars ?? {})))
    }
    const body = readFileSync(md, 'utf8')
    for (const section of ['General register', 'Legal register', 'Econ register']) {
      ok(`writing-register has a ${section} section`, new RegExp(`^#+ .*${section}`, 'm').test(body))
    }
    // The corpus numbers are the asset. Spot-check the ones every table hangs off.
    for (const n of ['5,560,816', '8,733,332', '14,294,148', '6,563', '11,198',
                     '1,728/M', '837/M', '683/M', '523.7/M', '194.0/M', '72.3/M']) {
      ok(`writing-register preserves the measurement ${n}`, body.includes(n))
    }
    ok('writing-register carries no STYLE-ONLY region', !body.includes('STYLE-ONLY'))
  }
}

// ── One output style, and it is structural ───────────────────────────────────
{
  ok('output-styles/ exists', existsSync(STYLES))
  const files = readdirSync(STYLES).filter(f => f.endsWith('.md') && f !== 'README.md')
  ok('exactly one output style ships', files.length === 1, files.join(','))
  ok('the one that ships is general-prose.md', files[0] === 'general-prose.md', files.join(','))
  for (const gone of ['law-review.md', 'econ-journal.md']) {
    ok(`output-styles/${gone} is deleted`, !existsSync(join(STYLES, gone)))
  }
  const p = join(STYLES, 'general-prose.md')
  const fm = frontmatter(p)
  ok('general-prose has name "General prose"', fm?.scalars.name === 'General prose', fm?.scalars.name)
  ok('general-prose has a description', !!fm?.scalars.description)
  ok('general-prose does not set keep-coding-instructions',
     !('keep-coding-instructions' in (fm?.scalars ?? {})))
  const lines = readFileSync(p, 'utf8').split('\n').length
  ok('general-prose stays short (<= 50 lines)', lines <= 50, `${lines} lines`)
  const body = readFileSync(p, 'utf8')
  ok('general-prose keeps the prose-shape rule',
     body.includes('write\nprose without bullets') || body.includes('prose without bullets'))
  ok('general-prose points at the writing-register skill', body.includes('writing-register'))
  ok('general-prose carries no corpus table', !/\d\.\d\d%/.test(body) && !/\/M/.test(body))
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

// ── set-output-style: one constant style, merge one key, refuse rather than clobber ──
{
  const mod = await import('../scripts/set-output-style.ts')
  const { mergeOutputStyle } = mod
  ok('set-output-style no longer exports styleMap', !('styleMap' in mod))
  const src = readFileSync(join(ROOT, 'scripts', 'set-output-style.ts'), 'utf8')
  ok('set-output-style reads no style map file', !src.includes('output-style-map'))
  ok('set-output-style hardcodes the single style name', src.includes('"General prose"'))
  ok('set-output-style keeps the approved-plan gate', src.includes('authenticatedWritingPlan'))

  const d = mkdtempSync(join(tmpdir(), 'set-style-'))
  const at = n => join(d, n)

  // The whole point: sibling keys survive.
  writeFileSync(at('a.json'), JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] }, model: 'opus' }, null, 2))
  let r = mergeOutputStyle(at('a.json'), 'General prose')
  const a = JSON.parse(readFileSync(at('a.json'), 'utf8'))
  ok('merge writes outputStyle', r.ok && r.changed && a.outputStyle === 'General prose')
  ok('merge preserves permissions', JSON.stringify(a.permissions) === JSON.stringify({ allow: ['Bash(ls:*)'] }))
  ok('merge preserves other keys', a.model === 'opus')

  r = mergeOutputStyle(at('a.json'), 'General prose')
  ok('merge is idempotent', r.ok && r.changed === false)

  r = mergeOutputStyle(at('new.json'), 'General prose')
  ok('merge creates a missing settings file',
     r.ok && JSON.parse(readFileSync(at('new.json'), 'utf8')).outputStyle === 'General prose')
  writeFileSync(at('empty.json'), '   \n')
  r = mergeOutputStyle(at('empty.json'), 'General prose')
  ok('an empty settings file is not corruption',
     r.ok && JSON.parse(readFileSync(at('empty.json'), 'utf8')).outputStyle === 'General prose')

  // REFUSAL, NOT OVERWRITE. Unparseable settings are far more likely mid-edit than garbage.
  const broken = '{ "permissions": { "allow": ["Bash(ls:*)"] },\n'
  writeFileSync(at('broken.json'), broken)
  r = mergeOutputStyle(at('broken.json'), 'General prose')
  ok('unparseable settings are refused', r.ok === false)
  ok('unparseable settings are left byte-identical', readFileSync(at('broken.json'), 'utf8') === broken)
  writeFileSync(at('array.json'), '[1, 2, 3]')
  r = mergeOutputStyle(at('array.json'), 'General prose')
  ok('a non-object settings file is refused', r.ok === false)
  ok('a non-object settings file is left byte-identical', readFileSync(at('array.json'), 'utf8') === '[1, 2, 3]')

  writeFileSync(at('dry.json'), '{}\n')
  r = mergeOutputStyle(at('dry.json'), 'General prose', true)
  ok('dry-run reports a change', r.ok && r.changed)
  ok('dry-run writes nothing', readFileSync(at('dry.json'), 'utf8') === '{}\n')

  // NO APPROVED PLAN MEANS NO WRITE — the gate that survived the consolidation.
  const { setOutputStyle } = mod
  const project = mkdtempSync(join(tmpdir(), 'reg-noplan-'))
  const out = setOutputStyle(project)
  ok('an unapproved project is refused', out.ok === false, out.ok ? '' : out.reason)
  ok('an unapproved project gets no settings file',
     !existsSync(join(project, '.claude', 'settings.local.json')))
  ok('the refusal names the missing approved plan',
     out.ok === false && /APPROVED/.test(out.reason), out.ok ? '' : out.reason)

  // The domain axis is untouched where it is load-bearing.
  ok('prose-audit.py keeps its own --style choices',
     /legal.*econ.*general|"legal"|'legal'/.test(readFileSync(join(ROOT, 'scripts', 'prose-audit.py'), 'utf8')))
  ok('writing-prose-check.ts still derives a domain style',
     readFileSync(join(ROOT, 'hooks', 'writing-prose-check.ts'), 'utf8').includes('--style'))
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

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
