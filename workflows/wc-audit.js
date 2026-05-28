export const meta = {
  name: 'wc-audit',
  description: "workflow-creator's Mode 2 audit as a dynamic workflow: discover the target workflow's skill files, fan out one read-only reviewer per audit dimension (P01-P21 architecture, the 13-pattern enforcement checklist, path portability, the Dynamic-Workflow Candidacy Scan), adversarially verify critical/major gaps against the actual files, then compute the composite + verdict in pure JS. Honors workflow-creator's meta-tool exemptions. Read-only; does NOT fix.",
  whenToUse: "Called by workflow-creator Mode 2 (Steps 1-4) and Mode 3 Phase A. Returns { overallPass, composite, verdict, scoreTable, reportMarkdown, candidacyTable, findings, reviews, reviewersThatFlagged }. The skill renders AUDIT.md from the result and drives the Mode 3 /goal fix loop; on a re-audit it passes onlyChecks (flagged dimension keys) + priorReviews. The workflow never fixes and the gate is computed in JS — never trust a self-reported composite.",
  phases: [
    { title: 'Discover', detail: "enumerate the target workflow's entry/midpoint/phase skills + references; resolve Mode 2 criteria, enforcement-checklist, migration playbook; detect the meta-tool" },
    { title: 'Review', detail: 'one read-only reviewer per dimension (4 architecture clusters + enforcement + portability + candidacy), in parallel — RAW per-principle scores, never a composite' },
    { title: 'Verify', detail: 'adversarially re-check each critical/major gap against the cited files; drop unconfirmed (the verifier supplies a corrected score)' },
    { title: 'Gate', detail: 'composite = mean of non-exempt, non-ceiling principle scores, computed in JS; verdict + AUDIT.md report + candidacy table' },
  ],
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// args = {
//   targetWorkflow: "dev" | "ds" | "writing" | "workflow-creator" | ...,  // REQUIRED — the workflow to audit
//   projectDir: "/abs/plugin-repo-root",        // REQUIRED — holds skills/, references/
//   pluginRoot: "/abs/.../workflows",            // optional — for resolving enforcement-checklist.md / migration playbook
//   threshold?: 9.5,                             // optional — composite gate (default 9.5; Step 7 self-audit uses 8.0)
//   onlyChecks?: ["arch-decomp-gates", ...],     // re-audit loop: re-run only these dimension keys; carry the rest
//   priorReviews?: [<dimension objects>],        // re-audit loop: prior per-dimension results to carry forward
// }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`wc-audit requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const TARGET = cfg.targetWorkflow
if (!TARGET) throw new Error(`wc-audit requires args.targetWorkflow. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const THRESHOLD = typeof cfg.threshold === 'number' ? cfg.threshold : 9.5
const PLUGIN = cfg.pluginRoot || ''
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(d => [String(d.dimension), d]))

// ── Schemas ───────────────────────────────────────────────────────────────────
const FINDING = {
  type: 'object', additionalProperties: false, required: ['severity', 'location', 'detail'],
  properties: {
    severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
    location: { type: 'string', description: 'file:line — the evidence the score/gap rests on' },
    detail: { type: 'string' },
    fix: { type: 'string' },
  },
}

const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['isMetaTool', 'wcSkillPath', 'enforcementChecklistPath', 'migrationPlaybookPath', 'skillFiles', 'phases'],
  properties: {
    isMetaTool: { type: 'boolean', description: 'true iff targetWorkflow === "workflow-creator" (meta-tool exemptions apply)' },
    wcSkillPath: { type: 'string', description: 'absolute path to skills/workflow-creator/SKILL.md (the Mode 2 rubric source)' },
    enforcementChecklistPath: { type: 'string', description: 'absolute path to references/enforcement-checklist.md, or "" if absent' },
    migrationPlaybookPath: { type: 'string', description: 'absolute path to the dynamic-workflow-migration.md playbook, or "" if absent' },
    skillFiles: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['path', 'role'],
        properties: {
          path: { type: 'string', description: 'absolute path to a SKILL.md or references/*.md belonging to the target' },
          role: { type: 'string', enum: ['entry', 'midpoint', 'phase', 'reference', 'constraint'] },
        },
      },
    },
    phases: { type: 'array', items: { type: 'string' }, description: 'phase / mode names in execution order (for the enforcement matrix columns)' },
  },
}

// Architecture-cluster reviewer — returns RAW per-principle scores (0-10) + evidence. NEVER a composite.
const ARCH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['dimension', 'principles', 'findings'],
  properties: {
    dimension: { type: 'string', description: 'echo the dispatched dimension key verbatim — the gate keys on it' },
    principles: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'score', 'evidence', 'gap', 'domainCeiling'],
        properties: {
          id: { type: 'string', description: 'P01..P21 or P19b' },
          score: { type: 'integer', description: '0-10, grounded in line-number evidence' },
          evidence: { type: 'string', description: 'file:line citations justifying the score (Iron Law of Thorough Scoring)' },
          gap: { type: 'string', description: 'the specific gap if score < threshold, else ""' },
          domainCeiling: { type: 'boolean', description: 'true iff the score reflects a justified domain ceiling, not a fixable gap' },
        },
      },
    },
    findings: { type: 'array', items: FINDING },
  },
}

// Enforcement-checklist reviewer — 13 patterns × phases.
const ENFORCEMENT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['dimension', 'patterns', 'findings'],
  properties: {
    dimension: { type: 'string' },
    patterns: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['pattern', 'status', 'weakOrAbsentPhases', 'note'],
        properties: {
          pattern: { type: 'string', description: 'one of the 13 enforcement-checklist patterns' },
          status: { type: 'string', enum: ['Present', 'Weak', 'Absent'], description: 'worst status across the high-drift phases that need it' },
          weakOrAbsentPhases: { type: 'array', items: { type: 'string' } },
          note: { type: 'string' },
        },
      },
    },
    findings: { type: 'array', items: FINDING },
  },
}

// Path-portability reviewer.
const PORTABILITY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['dimension', 'status', 'violations', 'hookCommandViolations', 'findings'],
  properties: {
    dimension: { type: 'string' },
    status: { type: 'string', enum: ['Clean', 'Partial', 'Broken'] },
    violations: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['file', 'pattern', 'detail'],
        properties: { file: { type: 'string' }, pattern: { type: 'string' }, detail: { type: 'string' } },
      },
      description: 'relative-path script/Read patterns that break from the user CWD',
    },
    hookCommandViolations: {
      type: 'array', items: { type: 'string' },
      description: 'hook command: fields using ${CLAUDE_SKILL_DIR} instead of ${CLAUDE_PLUGIN_ROOT} — any hit is a critical defect',
    },
    findings: { type: 'array', items: FINDING },
  },
}

// Dynamic-workflow candidacy reviewer — scans BOTH worker modes (review + write/transform).
const CANDIDACY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['dimension', 'candidates', 'summary'],
  properties: {
    dimension: { type: 'string' },
    candidates: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['phase', 'fanOut', 'workerMode', 'valueDriver', 'recommend', 'note'],
        properties: {
          phase: { type: 'string' },
          fanOut: { type: 'boolean', description: 'true iff the phase dispatches N agents "one per X" over a known list' },
          workerMode: { type: 'string', enum: ['review', 'transform', 'none'], description: 'read-only reviewers OR write/transform agents OR neither' },
          valueDriver: { type: 'string', description: 'parallelism | context | gate | per-item-mutation | none' },
          recommend: { type: 'string', enum: ['strong', 'moderate', 'leave', 'already-migrated'] },
          note: { type: 'string' },
        },
      },
    },
    summary: { type: 'string', description: '"no dynamic-workflow candidates" if none qualify — silence is ambiguous' },
  },
}

// Verifier adjudicates one critical/major gap against the cited files.
const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['principleId', 'confirmed', 'correctedScore', 'note'],
  properties: {
    principleId: { type: 'string', description: 'echo the dispatched principle id verbatim' },
    confirmed: { type: 'boolean', description: 'true iff the gap is real after re-reading the cited evidence' },
    correctedScore: { type: 'integer', description: 'use ONLY if confirmed=false — the score the principle actually deserves (0-10)' },
    note: { type: 'string' },
  },
}

// ── Audit dimensions ────────────────────────────────────────────────────────
// Architecture clusters group P01-P21 (+P19b) into thematic reviewers. Every principle is covered exactly once;
// each reviewer reads the authoritative Mode 2 definitions from wcSkillPath and scores with line-number evidence.
const ARCH_CLUSTERS = [
  { key: 'arch-decomp-gates', label: 'decomposition + gates', ids: ['P01', 'P02', 'P03', 'P09', 'P14'] },
  { key: 'arch-verify-review', label: 'verification + artifact review', ids: ['P04', 'P05', 'P10', 'P17'] },
  { key: 'arch-skill-family', label: 'entry points + skill-family enforcement wiring', ids: ['P06', 'P07', 'P08', 'P20', 'P21'] },
  { key: 'arch-state-traceability', label: 'state, traceability, autonomy', ids: ['P11', 'P12', 'P13', 'P15', 'P16', 'P18', 'P19', 'P19b'] },
]

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
phase('Discover')
const checklistHint = PLUGIN
  ? `${PLUGIN}/../references/enforcement-checklist.md (or ${PLUGIN}/references/enforcement-checklist.md)`
  : 'command ls -d ~/.claude/plugins/cache/*/workflows/*/references/enforcement-checklist.md | sort -V | tail -1 (or the in-repo references/enforcement-checklist.md)'
const playbookHint = PLUGIN
  ? `${PLUGIN}/../skills/workflow-creator/references/dynamic-workflow-migration.md`
  : 'command ls -d ~/.claude/plugins/cache/*/workflows/*/skills/workflow-creator/references/dynamic-workflow-migration.md | sort -V | tail -1 (or the in-repo path)'
const disc = await agent(
  `Enumerate the "${TARGET}" workflow's skill files and resolve the audit inputs. Working directory: ${PROJECT}

1. isMetaTool = true iff "${TARGET}" === "workflow-creator".
2. wcSkillPath = absolute path to ${PROJECT}/skills/workflow-creator/SKILL.md (the Mode 2 rubric — reviewers read it for principle definitions).
3. enforcementChecklistPath = ${checklistHint}.
4. migrationPlaybookPath = ${playbookHint} (or "" if not found).
5. Enumerate the target's skill files via Glob(${PROJECT}/skills/${TARGET}*/SKILL.md): classify the entry skill (skills/${TARGET}/SKILL.md → role "entry"), the midpoint (skills/${TARGET}-fix|−debug|−revise/SKILL.md → role "midpoint"), and every other phase skill (role "phase"). Also list the target's references/*.md (role "reference") and references/constraints/* files (role "constraint") if a constraints dir exists for this workflow. Use ABSOLUTE paths. For workflow-creator specifically there is one entry skill + its references/ — list them all.
6. phases = the phase (or mode) names in execution order — these become the enforcement-matrix columns. For a multi-phase workflow use the phase skill names; for workflow-creator use its modes/steps as the columns.

Read enough of the files to enumerate accurately — do NOT guess counts. Return DISCOVERY_SCHEMA. Absolute paths only.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
if (!disc.skillFiles.length) throw new Error(`No skill files discovered for "${TARGET}" — check ${PROJECT}/skills/${TARGET}*/SKILL.md exists`)
const fileList = disc.skillFiles.map(f => `${f.path} (${f.role})`).join('\n')
const phaseList = disc.phases.length ? disc.phases.join(', ') : '(single-entry meta-tool — score modes/steps as columns)'
log(`Target: ${TARGET} (${disc.isMetaTool ? 'META-TOOL — P01/P06 exempt' : 'standard workflow'}); ${disc.skillFiles.length} files, ${disc.phases.length} phases; ${ONLY ? `re-audit ${ONLY.size}` : 'full audit'}`)

// ── Phase 2: Review (per-dimension, parallel, read-only) ───────────────────────
phase('Review')
const READONLY = 'You are a READ-ONLY workflow auditor. You have Read/Grep/Glob only. Do NOT create, edit, or overwrite any files. If you find a violation, REPORT it — never silently fix it.'
const groundIn = `Read the authoritative Mode 2 audit criteria from ${disc.wcSkillPath} (the P01-P21 + P19b definitions), then audit "${TARGET}" by reading ALL its files:\n${fileList}\nPhases/columns: ${phaseList}.`

const DIMENSIONS = [
  ...ARCH_CLUSTERS.map(c => ({
    key: c.key, schema: ARCH_SCHEMA,
    prompt:
`${READONLY}
Set dimension="${c.key}" verbatim in your record (the gate keys on it).
${groundIn}

Score ONLY these architecture principles, each 0-10, grounded in SPECIFIC line-number evidence (Iron Law of Thorough Scoring — a score without a cited line is a guess): ${c.ids.join(', ')} — ${c.label}.
Read each principle's full definition in ${disc.wcSkillPath} Mode 2 Step 2 before scoring it. For each principle return: id, score (integer 0-10), evidence (file:line citations), gap (the specific fixable gap if score < ${THRESHOLD}, else ""), domainCeiling (true ONLY if the ceiling is a justified domain characteristic, not a fixable gap — and say why in evidence).
${disc.isMetaTool ? 'NOTE: the target is workflow-creator itself, a META-TOOL. P01 (single responsibility — it has 3 modes) and P06 (two entry points — it has one entry with mode detection) are DOCUMENTED EXEMPTIONS. Still score them honestly, but mark domainCeiling=true and note the exemption; the gate excludes them from the composite.' : ''}
Add a findings[] entry (severity critical for score<7, major for 7-8.9, minor for 9-9.4) for every principle below ${THRESHOLD}, each with file:line and the gap. Return ARCH_SCHEMA.`,
  })),
  {
    key: 'enforcement-checklist', schema: ENFORCEMENT_SCHEMA,
    prompt:
`${READONLY}
Set dimension="enforcement-checklist" verbatim.
${groundIn}
Read the 13 enforcement patterns from ${disc.enforcementChecklistPath || `${disc.wcSkillPath} (enforcement-checklist reference)`}.
For EACH of the 13 patterns, determine its worst status (Present / Weak / Absent) across the high-drift phases that need it, list the phases where it is Weak/Absent, and give a 1-line note with file:line. A high-drift phase (implementation, verification, fix) missing Iron Laws / Rationalization Tables / Gate Functions / Drive-Aligned Framing is a critical finding. Add findings[] for each Weak/Absent pattern in a phase that needs it. Return ENFORCEMENT_SCHEMA.`,
  },
  {
    key: 'path-portability', schema: PORTABILITY_SCHEMA,
    prompt:
`${READONLY}
Set dimension="path-portability" verbatim.
${groundIn}
Scan every SKILL.md and references/*.md for path-portability defects (Mode 2 Step 3b):
- Relative script paths: \`uv run python3 scripts/\`, \`../\`, \`../../\` referencing plugin scripts (break from the user CWD).
- Relative Read() paths: \`Read("../../skills/...")\`.
- Hook command: fields using \${CLAUDE_SKILL_DIR} instead of \${CLAUDE_PLUGIN_ROOT} — run \`grep -rn "command:.*\\\${CLAUDE_SKILL_DIR}" ${PROJECT}/skills/${TARGET}*/SKILL.md\`; ANY hit is a critical defect (silent-failure landmine). Put each in hookCommandViolations.
status: Clean (no broken paths AND no \${CLAUDE_SKILL_DIR} in hook commands), Partial (some fixed, some remain), Broken (relative paths in skill instructions OR \${CLAUDE_SKILL_DIR} in hook commands). Each violation → a findings[] entry (hook-command violations are critical). Return PORTABILITY_SCHEMA.`,
  },
  {
    key: 'candidacy-scan', schema: CANDIDACY_SCHEMA,
    prompt:
`${READONLY}
Set dimension="candidacy-scan" verbatim.
${groundIn}
Run the Dynamic-Workflow Candidacy Scan (read ${disc.migrationPlaybookPath || `${disc.wcSkillPath} migration reference`} §1). Scan EVERY phase for dynamic-workflow migration candidates in BOTH worker modes — workflows are NOT read-only:
- REVIEW fan-out: N read-only agents (one per section/lecture/question/source/footnote/file) whose aggregated results feed a gate/findings.
- WRITE/TRANSFORM fan-out: N write-agents that create or transform artifacts from a FIXED spec (codemod, migration, per-item spec-driven generation) — worktree-isolated. These are often the STRONGEST candidates; do not dump them into "leave".
Flag a phase when the SHAPE qualifies (N agents "one per X" over a known list) AND it wins ≥1 value driver: parallelism, context isolation, a deterministic gate replacing a model-reported "recompute by hand" score, or independent per-item mutation at scale. SPLIT the generation line: mechanical/spec-driven per-item creation → flag as transform candidate; only CREATIVE/judgment generation (brainstorm, novel prose) stays conversational. A mid-run user STRATEGY choice and a phase WRITING files are NOT disqualifiers.
For each candidate set: phase, fanOut, workerMode (review/transform/none), valueDriver, recommend (strong/moderate/leave/already-migrated — use "already-migrated" if the phase already calls a Workflow({scriptPath}) dynamic workflow), note. If the target is workflow-creator, check whether Mode 2's audit fan-out and Mode 1 Step 6's file-generation fan-out call dynamic workflows (wc-audit.js / wc-generate.js) — mark them already-migrated if so. summary = "no dynamic-workflow candidates" if none qualify. Return CANDIDACY_SCHEMA.`,
  },
]

const tasks = []
const carried = []
let reran = 0, carriedCount = 0
for (const d of DIMENSIONS) {
  if (ONLY && !ONLY.has(d.key)) {
    if (PRIOR.has(d.key)) { carried.push(PRIOR.get(d.key)); carriedCount++ }
    continue
  }
  reran++
  tasks.push(() => agent(d.prompt, { label: d.key, phase: 'Review', schema: d.schema, model: 'sonnet' }))
}
const live = (await parallel(tasks)).filter(Boolean)
if (ONLY) log(`Selective re-audit: ${reran} dimension(s) live, ${carriedCount} carried`)
const reviews = [...live, ...carried]
const byDim = Object.fromEntries(reviews.map(r => [String(r.dimension), r]))

// ── Phase 3: Verify (adversarially re-check critical/major principle gaps) ─────
phase('Verify')
// Collect principle gaps worth verifying: critical (<7) and major (7-8.9). Refuted gaps get a corrected score.
const gapsToVerify = []
for (const c of ARCH_CLUSTERS) {
  const dim = byDim[c.key]
  if (!dim || ONLY) continue // only verify freshly-reviewed clusters; carried ones keep their prior verdict
  for (const p of (dim.principles || [])) {
    if (p.score < 9 && p.gap && !p.domainCeiling) {
      gapsToVerify.push({ id: p.id, score: p.score, gap: p.gap, evidence: p.evidence })
    }
  }
}
const verifyResults = (await parallel(gapsToVerify.map(g => () =>
  agent(
    `${READONLY}
Set principleId="${g.id}" verbatim. Adversarially re-check this audit gap against the ACTUAL files (self-reports are not ground truth — read the cited lines yourself):
PRINCIPLE ${g.id} was scored ${g.score}/10. Claimed gap: "${g.gap}". Cited evidence: ${g.evidence}.
Open the cited file:line and the surrounding context in:\n${fileList}
Decide: is the gap REAL? Default to skepticism — if the cited evidence does not actually demonstrate the gap (e.g. it claims "no gate" but a hook/artifact exists, or "advisory-only" but a structural marker is present), set confirmed=false and supply the correctedScore the principle truly deserves. If the gap holds, confirmed=true. Return VERIFY_SCHEMA.`,
    { label: `verify:${g.id}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet' }
  )
))).filter(Boolean)
const correction = new Map()
for (const v of verifyResults) if (v && v.confirmed === false) correction.set(String(v.principleId), v.correctedScore)
if (gapsToVerify.length) log(`Verified ${gapsToVerify.length} gap(s); ${correction.size} refuted (re-scored up)`)

// ── Phase 4: Gate (pure JS — composite from raw scores; NEVER trust a self-reported composite) ─
phase('Gate')
// Documented meta-tool exemptions: workflow-creator's single-entry/3-mode structure.
const EXEMPT = disc.isMetaTool ? new Set(['P01', 'P06']) : new Set()

// Assemble the per-principle score map, applying verifier corrections.
const scoreById = {}
const ALL_IDS = []
for (const c of ARCH_CLUSTERS) {
  const dim = byDim[c.key]
  for (const p of (dim?.principles || [])) {
    const corrected = correction.has(p.id) ? correction.get(p.id) : p.score
    scoreById[p.id] = { id: p.id, score: corrected, rawScore: p.score, evidence: p.evidence, gap: correction.has(p.id) ? '' : p.gap, domainCeiling: p.domainCeiling, cluster: c.key }
    ALL_IDS.push(p.id)
  }
}

// Composite = mean of scores for principles that are neither EXEMPT nor a justified domain ceiling (Mode 3 §4).
const counted = ALL_IDS.filter(id => !EXEMPT.has(id) && !scoreById[id].domainCeiling)
const excluded = ALL_IDS.filter(id => EXEMPT.has(id) || scoreById[id].domainCeiling)
const composite = counted.length ? Math.round((counted.reduce((a, id) => a + scoreById[id].score, 0) / counted.length) * 100) / 100 : 0

// Findings: dimension findings + confirmed principle gaps (refuted ones already dropped via gap="").
const findings = []
const SEV_RANK = { critical: 0, major: 1, minor: 2 }
for (const r of reviews) for (const f of (r.findings || [])) findings.push({ ...f, dimension: r.dimension })
// Re-emit principle gaps that survived verification (so refutations actually remove findings).
for (const id of ALL_IDS) {
  const p = scoreById[id]
  if (p.gap && p.score < THRESHOLD && !EXEMPT.has(id) && !p.domainCeiling) {
    const sev = p.score < 7 ? 'critical' : (p.score < 9 ? 'major' : 'minor')
    findings.push({ severity: sev, dimension: p.cluster, location: p.evidence, detail: `${id} (${p.score}/10): ${p.gap}` })
  }
}
// Portability hook-command violations are always critical.
const port = byDim['path-portability']
for (const hv of (port?.hookCommandViolations || [])) findings.push({ severity: 'critical', dimension: 'path-portability', location: hv, detail: `hook command uses \${CLAUDE_SKILL_DIR} — silent-failure landmine; use \${CLAUDE_PLUGIN_ROOT}` })
findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
const criticalCount = findings.filter(f => f.severity === 'critical').length

const overallPass = counted.length > 0 && composite >= THRESHOLD && criticalCount === 0
const verdict = overallPass ? 'PASS' : 'NEEDS WORK'

// ── Render the AUDIT.md-format report ──────────────────────────────────────────
const PRINCIPLE_NAMES = {
  P01: 'Phased decomposition', P02: 'Gates (deterministic/judgment)', P03: 'Structural gate enforcement',
  P04: 'Independent verification', P05: 'Artifact review (4-level)', P06: 'Two entry points',
  P07: 'Cross-skill consistency', P08: 'Constraint/convention coverage', P09: 'Iteration strategy',
  P10: 'Post-subagent enforcement', P11: 'Deviation rules', P12: 'State management', P13: 'Session handoff',
  P14: 'Checkpoint types', P15: 'Context monitoring', P16: 'Summary frontmatter', P17: 'Agent tool restrictions',
  P18: 'Requirement traceability', P19: 'Autonomous phase chaining', P19b: 'Visual output',
  P20: 'Hooks over prompt', P21: 'Auto-loader usage',
}
const PRINCIPLE_ORDER = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P19b', 'P20', 'P21']
const archRows = PRINCIPLE_ORDER.filter(id => scoreById[id]).map(id => {
  const p = scoreById[id]
  const ex = EXEMPT.has(id) ? ' (EXEMPT — meta-tool)' : (p.domainCeiling ? ' (domain ceiling — excluded)' : '')
  const note = (p.gap || p.evidence || '').replace(/\|/g, '\\|').slice(0, 140)
  return `| ${id} | ${PRINCIPLE_NAMES[id] || id} | ${p.score}${ex} | ${note} |`
})
const archTable = ['| ID | Principle | Score | Notes |', '|----|-----------|-------|-------|', ...archRows].join('\n')

const enf = byDim['enforcement-checklist']
const enfTable = enf
  ? ['| Pattern | Status | Weak/Absent in | Note |', '|---------|--------|----------------|------|',
     ...(enf.patterns || []).map(p => `| ${p.pattern} | ${p.status} | ${(p.weakOrAbsentPhases || []).join(', ') || '—'} | ${(p.note || '').replace(/\|/g, '\\|').slice(0, 100)} |`)].join('\n')
  : '(enforcement checklist not scored this run)'

const portTable = port
  ? `Status: **${port.status}**\n\n` + (
      (port.violations || []).length || (port.hookCommandViolations || []).length
        ? ['| File | Pattern | Detail |', '|------|---------|--------|',
           ...(port.violations || []).map(v => `| ${v.file} | ${v.pattern} | ${(v.detail || '').replace(/\|/g, '\\|').slice(0, 100)} |`),
           ...(port.hookCommandViolations || []).map(h => `| ${h} | \${CLAUDE_SKILL_DIR} in hook command | CRITICAL |`)].join('\n')
        : 'No path-portability defects found.')
  : '(path portability not scored this run)'

const cand = byDim['candidacy-scan']
const candidacyTable = cand
  ? ['| Phase | Fan-out? | Worker mode | Value driver | Recommend | Note |', '|-------|----------|-------------|--------------|-----------|------|',
     ...((cand.candidates || []).length
        ? (cand.candidates || []).map(c => `| ${c.phase} | ${c.fanOut ? '✅' : '❌'} | ${c.workerMode} | ${c.valueDriver} | ${c.recommend} | ${(c.note || '').replace(/\|/g, '\\|').slice(0, 100)} |`)
        : [`| — | — | — | — | — | ${cand.summary || 'no dynamic-workflow candidates'} |`])].join('\n')
  : '(candidacy scan not run this run)'

const criticalGaps = findings.filter(f => f.severity === 'critical').slice(0, 12)
  .map((f, i) => `${i + 1}. **${f.detail}** — ${f.location} _(${f.dimension})_`).join('\n') || '_None._'

const scoreTable = [
  '| Dimension | Result | Gate |',
  '|-----------|--------|------|',
  `| Architecture composite | ${composite} / 10 (${counted.length} scored${excluded.length ? `, ${excluded.length} excluded` : ''}) | ${composite >= THRESHOLD ? '✅' : '❌'} |`,
  `| Enforcement checklist | ${enf ? `${(enf.patterns || []).filter(p => p.status === 'Present').length}/${(enf.patterns || []).length} Present` : 'n/a'} | ${enf && (enf.patterns || []).every(p => p.status !== 'Absent') ? '✅' : '⚠️'} |`,
  `| Path portability | ${port ? port.status : 'n/a'} | ${port && port.status === 'Clean' ? '✅' : '❌'} |`,
  `| Dynamic-workflow candidacy | ${cand ? `${(cand.candidates || []).filter(c => c.recommend === 'strong' || c.recommend === 'moderate').length} open` : 'n/a'} | ${cand && !(cand.candidates || []).some(c => c.recommend === 'strong') ? '✅' : '⚠️'} |`,
  `| Critical findings | ${criticalCount} | ${criticalCount === 0 ? '✅' : '❌'} |`,
  `| **Overall** | composite ${composite} vs ${THRESHOLD}; ${criticalCount} critical | ${overallPass ? '✅ PASS' : '❌ NEEDS WORK'} |`,
].join('\n')

const reportMarkdown = [
  `## Audit: ${TARGET}${disc.isMetaTool ? ' (meta-tool — P01/P06 exempt)' : ''}`,
  ``,
  `**Composite:** ${composite} / 10 &nbsp;·&nbsp; **Verdict:** ${verdict} &nbsp;·&nbsp; **Threshold:** ${THRESHOLD} &nbsp;·&nbsp; **Critical findings:** ${criticalCount}`,
  excluded.length ? `\n_Excluded from composite (${excluded.length}): ${excluded.join(', ')}._` : '',
  ``,
  `### Architecture Scores (P01-P21)`,
  archTable,
  ``,
  `### Enforcement Coverage (13 patterns)`,
  enfTable,
  ``,
  `### Path Portability`,
  portTable,
  ``,
  `### Dynamic-Workflow Migration Candidates`,
  candidacyTable,
  ``,
  `### Critical Gaps`,
  criticalGaps,
].join('\n')

log(overallPass
  ? `✅ ${TARGET} PASS — composite ${composite}/10, 0 critical`
  : `❌ ${TARGET} NEEDS WORK — composite ${composite}/10, ${criticalCount} critical / ${findings.length} total finding(s)`)

return {
  overallPass,
  composite,
  verdict,
  threshold: THRESHOLD,
  isMetaTool: disc.isMetaTool,
  summary: { composite, criticalCount, totalFindings: findings.length, scored: counted.length, excluded: excluded.length },
  scoreTable,                 // dimension-level gate table
  reportMarkdown,             // full AUDIT.md body the skill writes verbatim
  candidacyTable,             // the Dynamic-Workflow Migration Candidates table
  findings,                   // severity-ordered, verified
  reviews,                    // raw per-dimension records — pass back as priorReviews on a selective re-audit
  reviewersThatFlagged: reviews
    .filter(r => (r.findings || []).length
      || (r.principles || []).some(p => p.score < THRESHOLD && !EXEMPT.has(p.id) && !p.domainCeiling)
      || (r.violations || []).length || (r.hookCommandViolations || []).length
      || (r.candidates || []).some(c => c.recommend === 'strong'))
    .map(r => String(r.dimension)), // pass as onlyChecks on re-audit
}
