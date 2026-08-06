// Register/voice plumbing contract: output styles, agent skill preloading, generator round-trip.
//
// WHY THIS FILE EXISTS. Three of the four wiring facts this feature depends on are documented
// constraints that fail SILENTLY when violated, so nothing in a normal run would tell you:
//
//   1. `disable-model-invocation: true` skills CANNOT be preloaded ("preloading draws from the
//      same set of skills Claude can invoke"). All three existing style skills set it. Listing one
//      in `skills:` gets it skipped with a warning to the DEBUG LOG only — the agent launches, the
//      guidance never arrives, and the review reads as if it did.
//   2. A missing/disabled skill in `skills:` is likewise skipped with only a debug-log warning.
//   3. `hooks`, `mcpServers` and `permissionMode` are IGNORED for plugin-shipped agents. Three
//      agents in this repo carried a `hooks:` block that had never done anything; the linting it
//      appeared to configure came from `hooks/hooks.json` all along. Dead config that reads like
//      the mechanism is worse than no config, because the next person plans around it.
//
// Assertion 1 is the one that would have caught the blocker before implementation.
//
// Run: bun tests/writing-register-contract.test.mjs
import { readdirSync, readFileSync, existsSync, statSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const AGENTS = join(ROOT, 'agents')
const SKILLS = join(ROOT, 'skills')
const STYLES = join(ROOT, 'output-styles')

let PASS = 0, FAIL = 0
const ok = (name, condition, extra = '') => {
  if (condition) PASS++
  else { FAIL++; console.log(`FAIL  ${name}${extra ? ` — ${extra}` : ''}`) }
}

/** Frontmatter as raw text plus scalars and lists. Deliberately not a YAML parser: every field
 *  under test is a flat scalar, a `- item` block list, or an inline `[a, b]` array, and a
 *  dependency-free reader keeps this test runnable anywhere `bun` is.
 *
 *  INLINE ARRAYS ARE PARSED AS LISTS ON PURPOSE. Both notations are live in this repo right now —
 *  `tools: ["Read", "Write"]` in the dev agents, `skills:` as a block list in the writing agents.
 *  A parser that only understood block lists put an inline `skills: [...]` in `scalars`, so
 *  `fm.lists.skills ?? []` iterated nothing and EVERY per-skill assertion below passed vacuously
 *  for that agent — including the disable-model-invocation check this file exists for. Found by
 *  third-party review of the diff, not by the suite, which is exactly the failure mode:
 *  a vacuous pass is indistinguishable from a real one in the output. */
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

// ── Output styles parse and carry what the loader needs ──────────────────────
{
  ok('output-styles/ exists', existsSync(STYLES))
  const files = readdirSync(STYLES).filter(f => f.endsWith('.md') && f !== 'README.md')
  ok('three register output styles ship', files.length === 3, files.join(','))
  for (const f of files) {
    const fm = frontmatter(join(STYLES, f))
    ok(`${f} has parseable frontmatter`, fm !== null)
    if (!fm) continue
    ok(`${f} has a name`, !!fm.scalars.name)
    ok(`${f} has a description`, !!fm.scalars.description)
    // Optional field, but a non-boolean value is silently wrong rather than an error.
    if ('keep-coding-instructions' in fm.scalars) {
      ok(`${f} keep-coding-instructions is a boolean`,
         ['true', 'false'].includes(fm.scalars['keep-coding-instructions']),
         fm.scalars['keep-coding-instructions'])
    }
    // The generated artifacts must say so, or the next editor edits the copy.
    const body = readFileSync(join(STYLES, f), 'utf8')
    ok(`${f} is marked generated`, body.includes('GENERATED by scripts/emit-registers.py'))
  }
  for (const want of ['law-review.md', 'econ-journal.md', 'general-prose.md']) {
    ok(`${want} ships`, existsSync(join(STYLES, want)))
  }
}

// ── Every preloaded skill resolves AND is preloadable ────────────────────────
{
  const agents = readdirSync(AGENTS).filter(f => f.endsWith('.md'))
  let preloadsSeen = 0
  for (const a of agents) {
    const fm = frontmatter(join(AGENTS, a))
    ok(`agents/${a} has parseable frontmatter`, fm !== null)
    if (!fm) continue
    for (const skill of values(fm, 'skills')) {
      preloadsSeen++
      const dir = join(SKILLS, skill)
      const md = join(dir, 'SKILL.md')
      const resolves = existsSync(dir) && statSync(dir).isDirectory() && existsSync(md)
      ok(`agents/${a}: skills: ${skill} resolves to a real skill`, resolves, dir)
      if (!resolves) continue
      // THE ASSERTION THAT WOULD HAVE CAUGHT THE BLOCKER.
      const sfm = frontmatter(md)
      // `!== 'true'` was not enough: `disable-model-invocation: true  # why` is valid YAML and
      // parses as boolean true, but the raw string is not `'true'`, so the check passed while the
      // skill would be silently skipped at runtime. Compare the YAML VALUE, not the raw line.
      ok(`agents/${a}: skills: ${skill} is not disable-model-invocation`,
         sfm !== null && !isYamlTrue(sfm.scalars['disable-model-invocation']),
         'a disable-model-invocation skill is silently skipped when preloaded')
    }
  }
  ok('at least one agent preloads a skill', preloadsSeen > 0)

  // Fields that are ignored for plugin-shipped agents. Declaring one is dead config that lies.
  for (const a of agents) {
    const fm = frontmatter(join(AGENTS, a))
    if (!fm) continue
    for (const field of ['hooks', 'mcpServers', 'permissionMode']) {
      ok(`agents/${a} does not declare ${field} (ignored for plugin agents)`,
         !(field in fm.scalars) && !(field in fm.lists) && !new RegExp(`^${field}:`, 'm').test(fm.raw))
    }
  }
}

// ── The two agents this feature wires are actually wired ─────────────────────
{
  for (const a of ['writing-drafter.md', 'writing-prose-reviewer.md']) {
    const p = join(AGENTS, a)
    ok(`agents/${a} exists`, existsSync(p))
    if (!existsSync(p)) continue
    const fm = frontmatter(p)
    ok(`agents/${a} preloads writing-register`, values(fm, 'skills').includes('writing-register'))
    ok(`agents/${a} preloads ai-anti-patterns`, values(fm, 'skills').includes('ai-anti-patterns'))
  }
  // writing-prose-reviewer has no Skill tool, so preloading is its ONLY channel. If that ever
  // changes the preload is still correct, but the claim in its body would not be.
  const rfm = frontmatter(join(AGENTS, 'writing-prose-reviewer.md'))
  const rtools = values(rfm, 'tools')
  ok('writing-prose-reviewer declares a tools list at all', rtools.length > 0)
  ok('writing-prose-reviewer still has no Skill tool (preload is its only channel)',
     rtools.length > 0 && !rtools.includes('Skill'), rtools.join(','))

  // Transform routes to the new agent; Verify must NOT, or verification is primed with the same
  // guidance the drafter used.
  const wf = readFileSync(join(ROOT, 'workflows', 'writing-draft.js'), 'utf8')
  ok('writing-draft.js routes Transform to workflows:writing-drafter',
     /phase: 'Transform'[^\n]*agentType: 'workflows:writing-drafter'/.test(wf))
  const verifyLine = wf.split('\n').find(l => l.includes("phase: 'Verify'")) ?? ''
  ok('writing-draft.js leaves Verify on the default agent', !verifyLine.includes('agentType'), verifyLine.trim())
}

// ── style -> output style name: every register mapped, every name shipped ────
{
  const map = JSON.parse(readFileSync(join(ROOT, 'references', 'registers', 'output-style-map.json'), 'utf8'))
  const styles = map.styles ?? {}
  const sources = readdirSync(join(ROOT, 'references', 'registers'))
    .filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
  ok('the map covers every register source', sources.every(s => s in styles),
     `${sources.join(',')} vs ${Object.keys(styles).join(',')}`)
  ok('the map has no register that is not a source', Object.keys(styles).every(s => sources.includes(s)))
  // An unresolvable name is the silent failure this map exists to prevent: the merge writes a
  // string nothing matches and the user stays on the default style with nothing reported.
  const shipped = new Set(readdirSync(STYLES).filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => frontmatter(join(STYLES, f))?.scalars.name))
  for (const [style, name] of Object.entries(styles)) {
    ok(`map[${style}] = "${name}" names a shipped output style`, shipped.has(name), [...shipped].join(' | '))
  }
}

// ── set-output-style merges one key, and refuses rather than clobbering ──────
{
  const { mergeOutputStyle, styleMap } = await import('../scripts/set-output-style.ts')
  const d = mkdtempSync(join(tmpdir(), 'set-style-'))
  const at = n => join(d, n)

  // The whole point: sibling keys survive.
  writeFileSync(at('a.json'), JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] }, model: 'opus' }, null, 2))
  let r = mergeOutputStyle(at('a.json'), 'Law review')
  const a = JSON.parse(readFileSync(at('a.json'), 'utf8'))
  ok('merge writes outputStyle', r.ok && r.changed && a.outputStyle === 'Law review')
  ok('merge preserves permissions', JSON.stringify(a.permissions) === JSON.stringify({ allow: ['Bash(ls:*)'] }))
  ok('merge preserves other keys', a.model === 'opus')

  // Idempotent — a second run is not a spurious change.
  r = mergeOutputStyle(at('a.json'), 'Law review')
  ok('merge is idempotent', r.ok && r.changed === false)

  // Absent file is created; empty file is treated as empty settings, not as corruption.
  r = mergeOutputStyle(at('new.json'), 'Econ journal')
  ok('merge creates a missing settings file', r.ok && JSON.parse(readFileSync(at('new.json'), 'utf8')).outputStyle === 'Econ journal')
  writeFileSync(at('empty.json'), '   \n')
  r = mergeOutputStyle(at('empty.json'), 'General prose')
  ok('an empty settings file is not corruption', r.ok && JSON.parse(readFileSync(at('empty.json'), 'utf8')).outputStyle === 'General prose')

  // REFUSAL, NOT OVERWRITE. Unparseable settings are far more likely mid-edit than garbage.
  const broken = '{ "permissions": { "allow": ["Bash(ls:*)"] },\n'
  writeFileSync(at('broken.json'), broken)
  r = mergeOutputStyle(at('broken.json'), 'Law review')
  ok('unparseable settings are refused', r.ok === false)
  ok('unparseable settings are left byte-identical', readFileSync(at('broken.json'), 'utf8') === broken)
  writeFileSync(at('array.json'), '[1, 2, 3]')
  r = mergeOutputStyle(at('array.json'), 'Law review')
  ok('a non-object settings file is refused', r.ok === false)
  ok('a non-object settings file is left byte-identical', readFileSync(at('array.json'), 'utf8') === '[1, 2, 3]')

  // --dry-run reports without touching the file.
  writeFileSync(at('dry.json'), '{}\n')
  r = mergeOutputStyle(at('dry.json'), 'Law review', true)
  ok('dry-run reports a change', r.ok && r.changed)
  ok('dry-run writes nothing', readFileSync(at('dry.json'), 'utf8') === '{}\n')

  ok('styleMap reads the generated map', Object.keys(styleMap()).length === 3)
  ok('styleMap degrades to empty on a missing file', Object.keys(styleMap(join(d, 'nope.json'))).length === 0)
  // A truthy NON-STRING value would sail past a bare `if (!name)` at the call site and be written
  // as outputStyle — a value no style can match, so the user silently keeps the default.
  writeFileSync(at('badmap.json'), JSON.stringify({ styles: { legal: { oops: true }, econ: '', general: 'General prose' } }))
  const bad = styleMap(at('badmap.json'))
  ok('styleMap drops a non-string name', !('legal' in bad))
  ok('styleMap drops an empty name', !('econ' in bad))
  ok('styleMap keeps the good one', bad.general === 'General prose')
  writeFileSync(at('arrmap.json'), JSON.stringify({ styles: ['legal'] }))
  ok('styleMap rejects a non-object styles value', Object.keys(styleMap(at('arrmap.json'))).length === 0)
}

// ── End to end against a real APPROVED receipt ───────────────────────────────
// The unit tests above prove the merge; this proves the DERIVATION, which is the part that must
// not be bypassable. `setOutputStyle` takes no style argument on purpose — the register comes from
// the plan's `## Writing Intent` `Domain` through the same `authenticatedWritingPlan()` every gate
// uses, so a clarify answer the user later revised cannot outrank the approved plan.
{
  const { setOutputStyle } = await import('../scripts/set-output-style.ts')
  const { createHash } = await import('node:crypto')
  const { mkdirSync } = await import('node:fs')

  const project = mkdtempSync(join(tmpdir(), 'reg-e2e-'))
  mkdirSync(join(project, '.planning', '.state'), { recursive: true })
  const plan = '# T\n\n## Writing Intent\n\n- **Domain**: legal\n- **Thesis**: t\n\n## Source Plan\n\n- **Notebook**: none\n'
  writeFileSync(join(project, '.planning', 'p.md'), plan)
  const planHash = createHash('sha256').update(Buffer.from(plan, 'utf8')).digest('hex')
  const receipt = (status) => JSON.stringify({
    workflow: 'writing', plan_file: 'p.md', plan_hash: planHash,
    approved_session_id: 'approval-session', approved_at: '2026-08-05T10:00:00.000Z',
    status, reviewer_session_id: 'review-session', reviewed_at: '2026-08-05T10:01:00.000Z',
  })

  // PENDING is not authority. A WELL-FORMED pending receipt leaves the reviewer fields empty
  // (approved-artifact.ts:246) — populating them makes the receipt fail SCHEMA validation instead,
  // so the refusal would prove only that malformed JSON is rejected, not that an unreviewed plan
  // is. Third-party review caught exactly that in the first version of this fixture.
  const pending = JSON.stringify({
    workflow: 'writing', plan_file: 'p.md', plan_hash: planHash,
    approved_session_id: 'approval-session', approved_at: '2026-08-05T10:00:00.000Z',
    status: 'PENDING', reviewer_session_id: '', reviewed_at: '',
  })
  writeFileSync(join(project, '.planning', '.state', 'review.json'), pending)
  let r = setOutputStyle(project)
  ok('a well-formed PENDING receipt is refused', r.ok === false, r.ok ? '' : r.reason)
  ok('a PENDING receipt writes no settings file', !existsSync(join(project, '.claude', 'settings.local.json')))

  // ISSUES_FOUND is a finalized receipt with valid reviewer fields — and still not approval.
  writeFileSync(join(project, '.planning', '.state', 'review.json'), receipt('ISSUES_FOUND'))
  r = setOutputStyle(project)
  ok('an ISSUES_FOUND receipt is refused', r.ok === false, r.ok ? '' : r.reason)
  ok('an ISSUES_FOUND receipt writes no settings file', !existsSync(join(project, '.claude', 'settings.local.json')))

  // APPROVED: the register is derived, not supplied.
  writeFileSync(join(project, '.planning', '.state', 'review.json'), receipt('APPROVED'))
  r = setOutputStyle(project, true)
  ok('dry-run on an APPROVED plan resolves the register', r.ok && r.style === 'legal' && r.name === 'Law review',
     r.ok ? `${r.style}/${r.name}` : r.reason)
  ok('dry-run still writes nothing', !existsSync(join(project, '.claude', 'settings.local.json')))
  r = setOutputStyle(project)
  ok('an APPROVED legal plan sets Law review', r.ok && r.changed && r.name === 'Law review', r.ok ? '' : r.reason)
  ok('the settings file lands under the project root',
     existsSync(join(project, '.claude', 'settings.local.json')))
  ok('the written value is the output style name',
     JSON.parse(readFileSync(join(project, '.claude', 'settings.local.json'), 'utf8')).outputStyle === 'Law review')

  // A Domain the register sources do not define is a refusal, not a default.
  const p2 = mkdtempSync(join(tmpdir(), 'reg-e2e-'))
  mkdirSync(join(p2, '.planning', '.state'), { recursive: true })
  const plan2 = plan.replace('Domain**: legal', 'Domain**: poetry')
  writeFileSync(join(p2, '.planning', 'p.md'), plan2)
  const h2 = createHash('sha256').update(Buffer.from(plan2, 'utf8')).digest('hex')
  writeFileSync(join(p2, '.planning', '.state', 'review.json'), receipt('APPROVED').replace(planHash, h2))
  r = setOutputStyle(p2)
  ok('an unknown Domain is refused rather than defaulted', r.ok === false, r.ok ? '' : r.reason)
  ok('an unknown Domain names the known registers', r.ok === false && /econ, general, legal/.test(r.reason), r.ok ? '' : r.reason)
}

// ── The generator has not drifted ────────────────────────────────────────────
{
  const r = spawnSync('python3', [join(ROOT, 'scripts', 'emit-registers.py'), '--check'],
                      { cwd: ROOT, encoding: 'utf8' })
  ok('emit-registers.py --check passes', r.status === 0, (r.stderr || r.stdout || '').slice(0, 800))
}

console.log(`\n${PASS} passed, ${FAIL} failed`)
process.exit(FAIL ? 1 : 0)
