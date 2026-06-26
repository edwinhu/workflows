export const meta = {
  name: 'wc-audit',
  description: "workflow-creator's Mode 2 audit as an ultracode workflow: discover the target workflow's skill files, fan out one read-only reviewer per audit dimension (P01-P30 architecture incl. the runner-architecture/executionClass detector — recognizes BOTH the code and DATA compile variants, the 13-pattern enforcement checklist, path portability, the Ultracode-Workflow Candidacy Scan), adversarially verify critical/major gaps against the actual files, then compute the composite + verdict in pure JS. Flags the retired generic-interpreter shape as a critical. Honors workflow-creator's meta-tool exemptions. Read-only; does NOT fix.",
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
//   rubricPath?: "/abs/.../workflow-creator/SKILL.md",  // optional — the Mode 2 rubric source. Defaults to the
//                                                //   workflows repo. Set for a CROSS-PLUGIN audit where the audited
//                                                //   PROJECT has no workflow-creator skill (e.g. the teaching plugin).
//   workflowsRepo?: "/abs/.../workflows",        // optional — cross-repo fallback root for the rubric + enforcement
//                                                //   checklist + migration playbook when PROJECT lacks them.
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
// Cross-repo fallback root: where workflow-creator's rubric + enforcement checklist + migration playbook live when the
// audited PROJECT has none of its own (cross-plugin audit). Defaults to the audited PROJECT; a cross-plugin caller MUST pass workflowsRepo (or rubricPath) so the rubric resolves.
const WF_REPO = cfg.workflowsRepo || PROJECT
// The Mode 2 rubric source. A CROSS-PLUGIN target's PROJECT has no skills/workflow-creator, so resolve the rubric from
// the workflows repo by default; an explicit rubricPath wins.
const RUBRIC = cfg.rubricPath || `${WF_REPO}/skills/workflow-creator/SKILL.md`
const RUBRIC_IS_CROSS_REPO = !RUBRIC.startsWith(PROJECT)
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

// Ultracode-workflow candidacy reviewer — scans BOTH worker modes (review + write/transform).
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
    summary: { type: 'string', description: '"no ultracode-workflow candidates" if none qualify — silence is ambiguous' },
  },
}

// Runner-architecture reviewer — classifies the target's EXECUTION shape, then conditionally scores the
// compiled-runner principles P22-P30 (only when the workflow executes a plan-table DAG of mechanical work).
const RUNNER_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['dimension', 'executionClass', 'applicable', 'principles', 'findings'],
  properties: {
    dimension: { type: 'string', description: 'echo "runner-architecture" verbatim' },
    executionClass: {
      type: 'string',
      enum: ['generic-interpreter', 'already-a-fan-out', 'compiled-runner', 'not-applicable'],
      description: 'generic-interpreter = an in-workflow LLM "discovery" agent re-parses a plan/spec each invocation → per-level fan-out → heavyweight re-analysis verifier (the retired anti-pattern). already-a-fan-out = a per-item fan-out that STILL LLM-enumerates each call (no deterministic compile/parser shared by the guard; harden, do NOT force an engine swap). compiled-runner = a deterministic compile/parser REPLACED the LLM discovery and the guard imports it; emit form is CODE (run.js) OR DATA (work-list a generic engine consumes — writing/workshop/teaching; absent run.js is NOT a gap). not-applicable = conversational / single-pass / pure-creative (P22-P30 N/A).',
    },
    applicable: { type: 'boolean', description: 'true iff the workflow executes a DAG of mechanical work between human gates (classes generic-interpreter | already-a-fan-out | compiled-runner). false ⇒ P22-P30 are N/A and excluded from the composite.' },
    principles: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'score', 'evidence', 'gap', 'naForDomain'],
        properties: {
          id: { type: 'string', description: 'P22..P30' },
          score: { type: 'integer', description: '0-10 grounded in line-number evidence; ignored when applicable=false' },
          evidence: { type: 'string', description: 'file:line citations justifying the score' },
          gap: { type: 'string', description: 'the specific fixable gap if score < threshold, else ""' },
          naForDomain: { type: 'boolean', description: 'true iff this principle is N/A because the workflow does not execute a plan-table DAG (mirrors applicable=false)' },
        },
      },
    },
    findings: { type: 'array', items: FINDING },
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
// Cross-repo fallbacks: when the audited PROJECT has no enforcement checklist / migration playbook of its own (e.g. a
// cross-plugin audit of the teaching plugin), resolve them from the workflows repo. Prefer an in-PROJECT copy if one
// exists; otherwise fall back to ${WF_REPO}.
const checklistHint = PLUGIN
  ? `${PLUGIN}/../references/enforcement-checklist.md (or ${PLUGIN}/references/enforcement-checklist.md)`
  : `${PROJECT}/references/enforcement-checklist.md if it exists, ELSE the cross-repo fallback ${WF_REPO}/references/enforcement-checklist.md (use whichever Read succeeds)`
const playbookHint = PLUGIN
  ? `${PLUGIN}/../skills/workflow-creator/references/dynamic-workflow-migration.md`
  : `${PROJECT}/skills/workflow-creator/references/dynamic-workflow-migration.md if it exists, ELSE the cross-repo fallback ${WF_REPO}/skills/workflow-creator/references/dynamic-workflow-migration.md`
const disc = await agent(
  `Enumerate the "${TARGET}" workflow's skill files and resolve the audit inputs. Working directory: ${PROJECT}

1. isMetaTool = true iff "${TARGET}" === "workflow-creator".
2. wcSkillPath = ${RUBRIC} — the Mode 2 rubric source reviewers read for principle definitions. ${RUBRIC_IS_CROSS_REPO ? `This is a CROSS-PLUGIN audit: the rubric lives in a DIFFERENT repo (${WF_REPO}) than the audited target (${PROJECT}). Use this absolute path verbatim — do NOT look for skills/workflow-creator inside ${PROJECT}, it does not exist there.` : ''} Verify the path is readable; if not, report it in wcSkillPath anyway and note the failure.
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
const READONLY = 'You are a READ-ONLY workflow auditor. You have Read/Grep/Glob only. Do NOT create, edit, or overwrite any files. If you find a violation, REPORT it — never silently fix it.\nHARD REQUIREMENT: your turn MUST end with a single call to the StructuredOutput tool carrying your full record. Do NOT write your findings as a prose message — a prose answer is a FAILED run. Budget your reads so you have room to emit the structured record. If you are running low on turn budget, STOP reading and emit StructuredOutput with what you have.'
// The Mode 2 rubric can be very large (the workflow-creator SKILL.md is ~160KB). Reading it end-to-end starves the
// reviewer's turn budget and it never emits StructuredOutput. Read it SURGICALLY — grep the specific principle sections.
const groundIn = `First, read the authoritative Mode 2 audit criteria from ${disc.wcSkillPath}. This file is LARGE — do NOT read it end to end. Instead grep it for the specific principle IDs you are scoring (e.g. \`grep -n "P03\\|P09" ${disc.wcSkillPath}\`) and Read only those line windows (the "Mode 2 Step 2" principle definitions). Then audit "${TARGET}" by reading its files (these are small — read them fully):\n${fileList}\nPhases/columns: ${phaseList}.`

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
For EACH of the 13 patterns, determine its worst status (Present / Weak / Absent) — but ONLY across the phases whose DRIFT TIER actually requires that pattern. Apply the rubric's own drift-tiering (the target's Step-4 guidance), do not demand every pattern on every phase:
- HIGH-drift phases (implementation, scoring/auditing, fixing, file-generation): require Iron Laws + incident-grounded Fact Rows (a "### <Topic> Facts" section of declarative bullets with drive-consequence vocabulary) + Gate Functions. Missing any of these here is a critical finding. FORMAT EQUIVALENCE (v5.36.0): Fact Rows are the current canon; legacy excuse/reality "Rationalization Tables" and standalone "Drive-Aligned Framing" tables ALSO satisfy the requirement in not-yet-converted skills — flag those as "legacy format, convert to fact rows" at LOW severity, never as missing enforcement. Conversely, a phase with fact rows and no Rationalization Table is fully compliant — do NOT flag fact-format skills for lacking the deprecated tables.
- MEDIUM-drift phases (design, artifact-review-gate design, entry-point design, verification): require Gate Functions + Red Flags + Staged Review where applicable. Red Flags must be action-targeted ("about to X"); intention-targeted ("if you catch yourself thinking") is the deprecated form — LOW-severity legacy-format note, not a gap.
- LOW-drift CREATIVE/planning phases (brainstorm, interview, decomposition): correctly need **Red Flags only** — "creative phases need freedom." A creative/low-drift phase that has Red Flags but NO fact rows and NO legacy tables is **Present/correct, NOT Weak** — do NOT flag it for lacking patterns its tier does not require (that would be speculative over-enforcement, itself an anti-pattern).
Mark a pattern Weak/Absent ONLY when a phase whose tier REQUIRES it is missing it or has it in soft form. Add findings[] only for those genuine gaps. List the phases where Weak/Absent. 1-line note with file:line. Return ENFORCEMENT_SCHEMA.`,
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
Run the Ultracode-Workflow Candidacy Scan (read ${disc.migrationPlaybookPath || `${disc.wcSkillPath} migration reference`} §1). Scan EVERY phase for ultracode-workflow migration candidates in BOTH worker modes — workflows are NOT read-only:
- REVIEW fan-out: N read-only agents (one per section/lecture/question/source/footnote/file) whose aggregated results feed a gate/findings.
- WRITE/TRANSFORM fan-out: N write-agents that create or transform artifacts from a FIXED spec (codemod, migration, per-item spec-driven generation) — worktree-isolated. These are often the STRONGEST candidates; do not dump them into "leave".
Flag a phase when the SHAPE qualifies (N agents "one per X" over a known list) AND it wins ≥1 value driver: parallelism, context isolation, a deterministic gate replacing a model-reported "recompute by hand" score, or independent per-item mutation at scale. SPLIT the generation line: mechanical/spec-driven per-item creation → flag as transform candidate; only CREATIVE/judgment generation (brainstorm, novel prose) stays conversational. A mid-run user STRATEGY choice and a phase WRITING files are NOT disqualifiers.
For each candidate set: phase, fanOut, workerMode (review/transform/none), valueDriver, recommend (strong/moderate/leave/already-migrated — use "already-migrated" if the phase already calls a Workflow({scriptPath}) ultracode workflow), note. If the target is workflow-creator, check whether Mode 2's audit fan-out and Mode 1 Step 6's file-generation fan-out call ultracode workflows (wc-audit.js / wc-generate.js) — mark them already-migrated if so. summary = "no ultracode-workflow candidates" if none qualify. Return CANDIDACY_SCHEMA.`,
  },
  {
    key: 'runner-architecture', schema: RUNNER_SCHEMA,
    prompt:
`${READONLY}
Set dimension="runner-architecture" verbatim.
${groundIn}
Read the Mode 2 "Compiled-runner architecture (P22-P30)" criteria and the executionClass detector in ${disc.wcSkillPath} (grep \`grep -n "P22\\|P23\\|P24\\|P25\\|P26\\|P27\\|P28\\|P29\\|P30\\|executionClass" ${disc.wcSkillPath}\`). Also read ${disc.migrationPlaybookPath || `${disc.wcSkillPath} migration reference`} §0 (the compile-vs-interpret rule).

STEP A — CLASSIFY the target's EXECUTION shape (executionClass). Glob ${PROJECT}/workflows/${TARGET}*.js and ${PROJECT}/workflows/*${TARGET}*.js and Read any that drive this workflow's execution (e.g. ${TARGET}-implement.js / ${TARGET}-generate.js / ${TARGET}-verify.js / ${TARGET}-run*.js / a compiled .planning/run.js the skill invokes). ALSO Glob ${PROJECT}/scripts/${TARGET}/*.py and ${PROJECT}/hooks/${TARGET}*guard*.py — a deterministic compile/parser lives there. Read the implement/transform/generate phase skill. Then classify.

⚠️ THE DEFINING PROPERTY of compiled-runner (BOTH variants) is: **a DETERMINISTIC compile/parser REPLACED the in-workflow LLM "discovery" agent, AND the GUARD SHARES that parser** (validate = parse()/build_index().violations). Key on THAT — NOT on whether a generated run.js file exists. There are TWO valid compile-output forms (S5): a **CODE variant** emits a self-contained \`.planning/run.js\` (ds/dev); a **DATA variant** emits a work-list / index (JSON/section-index/slide-table) that a GENERIC fan-out engine consumes via args (writing/workshop/teaching). **Absence of a generated run.js is NOT a gap** — it is the data-variant emit form. Misclassifying a data-variant as generic-interpreter or already-a-fan-out because "there's no run.js" is the #1 detector error.

- **generic-interpreter** — an in-workflow LLM "discovery" agent re-parses a PLAN/spec into a DAG/work-list EVERY invocation, then per-level/per-item fan-out, then a heavyweight re-analysis LLM verifier computes the gate. (Tell-tale: \`agent('Enumerate…/re-parse PLAN.md…')\` as step 1 of a workflow; a per-task verify subagent that re-loads data.) THIS IS THE RETIRED ANTI-PATTERN.
- **already-a-fan-out** — a genuine per-item fan-out that STILL LLM-enumerates/structures the work-list each call (no deterministic compile/parser; the guard does NOT share a parser). Correct shape, but NOT yet compiled — needs the deterministic-compile + shared-guard hardening, NOT an engine swap. **The line vs compiled-runner-data is exactly "does a deterministic compile/parser exist that replaced the Discover, shared by the guard?" — if yes, it is compiled-runner, not already-a-fan-out.**
- **compiled-runner** — a deterministic compile/parser replaced the LLM discovery and the guard imports it; output is **CODE (run.js)** OR **DATA (work-list consumed by a generic engine via args)**; gates on real exit codes / a domain gateProbe; pause/resume. Score P22-P30 UNIFORMLY for both emit forms.
- **not-applicable** — the workflow is conversational / single-pass / pure-creative and executes no plan-table/work-list of mechanical work.

Set applicable = (executionClass !== 'not-applicable'). If applicable=false, set every P22-P30 naForDomain=true, score=0, gap="" and emit NO findings — they do not apply.

STEP B — if applicable=true, score P22-P30 each 0-10 with file:line evidence:
- **P22 Compile-vs-interpret fit** — is the work-list deterministically COMPILED (parser → run.js OR data index), NOT re-discovered by an in-workflow LLM agent each call? A generic-interpreter scores LOW; a data-variant with a deterministic compile scores HIGH (do NOT penalize the absence of run.js).
- **P23 Single-source plan parser** — does the executable-guard import the SAME parser the compiler/runner uses (compiles ⇔ passes gate; validate = parse().violations), rather than a second drifting regex?
- **P24 Honest gate** — (a) is \`pass\` ALWAYS DETERMINISTIC — a real exit code OR a mechanical floor, NEVER a returned LLM judgment (a runner whose gateProbe returns a judgment = the haiku-judging-prose anti-pattern → score LOW)? (b) does the contract return \`{pass, artifactsPresent/outputsPresent, evidence, scope}\` with **pass ⊥ artifactsPresent as TWO INDEPENDENT booleans the core conjoins (pass && artifactsPresent), never trusting pass alone**? (c) does a mechanical floor DISCLOSE its blind spot via \`scope\` (a clean pass must not over-claim coverage)? (d) FLOOR-vs-ASSIST / inverted-G2: a deterministic candidate-narrowing list (uncitedCandidates[]/bibUnresolved) that feeds the OUTSIDE semantic authority for PER-ITEM adjudication is an ASSIST, lives in evidence+scope.notChecked, and must NOT bear the gate — a probe that FAILS the gate on those candidates is the inverted-G2 defect (a false-negative gate, inverse of funnel-clobber; score LOW). NOTE the assist (per-item judgment — feeding it is GOOD) is distinct from a P27 join-MENU (closed-set correspondence — feeding it force-matches, BAD); don't conflate them.
- **P25 Pause/resume + payload>pass-fail** — pauses carry deviations + a NUMBERED summary (not a bare pass/fail); two-kinds-of-decision routing (layer-agnostic: data Verify or spec sentinel) + stale-gate backstop + gate-first idempotent short-circuit; the skill switches on RETURN-REASON (done|hard-fail|pause-human|yield-for-recheck) and does NOT mux an automated recheck onto the human-pause channel.
- **P26 Adversarial layer outside the runner** — the full-suite/review/verify adversarial layer lives OUTSIDE run.js, and is the PRIMARY arbiter (not a backstop) when the gate trust-class is semantic.
- **P27 Join trust-class** — a work-list row's downstream JOIN (work-item ↔ produced artifact) is MECHANICAL (deterministic key) only when the work-list enumerates from a SINGLE source; if it enumerates from MORE THAN ONE source (generate←spec AND verify←built-artifact) the join is SEMANTIC and an LLM must do it OUTSIDE the parser. Score: does the workflow correctly keep a multi-source join semantic (parser ENUMERATES, never key-matches a drifting identifier) and NOT feed the deterministic artifact as a candidate MENU into the join-agent (post-filter in JS outside)? A join-MENU constrains a correspondence to a CLOSED SET ("match X to one of these") → force-matching that masks a dropped item — distinct from a P24(d) ASSIST (per-item adjudication, which IS good to feed). The menu bias is workshop-measured (appendix over-match n=3). Do NOT penalize a multi-source domain for lacking a deterministic join. A born-canonical byte-stable join-key anchor (converts semantic→mechanical) scores high.
- **P28 Emitter-canonical hardened** — is the EMITTER hardened to born-canonical (doctrine #6), or ONLY the parser+guard? Parser-only RELOCATES the LLM's tolerance into regex. Two valid shapes by producer: machine producer → eliminate tolerance + a STRICT guard; hand-editable producer → canonical emitter + intentional back-compat tolerance, whose guard correctly stays STRUCTURE-ONLY + tolerant (do NOT ding it for not being strict — that's the right shape for a hand-edited producer). Trap (both shapes): was the guard golden-tested against a REAL pre-canonical artifact (not the template, which is already canonical)?
- **P29 Guard passes REAL artifacts (phantom-canonical)** — does the EXISTING SHIPPED data in the repo PASS its own guard/parser? Run the guard against real artifacts, not just the template. A guard encoding a canonical FORMAT the real authoring never used (false-denying shipped specs) is the phantom-canonical defect (score LOW). This is a DEFAULT check.
- **P30 Gate covers all declared outputs** — does the gate validate EVERY declared first-class output's compile/validation (not just the primary)? An un-gated compiled deliverable (e.g. notes alongside slides) is a hole.

CRITICAL FINDING RULE: if executionClass === 'generic-interpreter' AND applicable=true, emit a **critical** findings[] entry ("execution is the retired generic-interpreter shape — LLM discovery between a structured producer and a strict checker masks spec-drift; port to spec→plan→compile"). This MUST fail the substrate gate. For 'already-a-fan-out', do NOT emit a critical for the shape itself — only score the applicable sub-principles (P23/P24/P28 hardening) and recommend harden-not-swap in notes. A P29 phantom-canonical failure (shipped data fails its own guard) is a **critical**. Add a findings[] entry (critical <7, major 7-8.9, minor 9-9.4) for each applicable principle below ${THRESHOLD}. Return RUNNER_SCHEMA.`,
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
  tasks.push(() => agent(d.prompt, { label: d.key, phase: 'Review', schema: d.schema }))
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

// Runner-architecture principles (P22-P30). When the target executes no plan-table DAG (applicable=false /
// executionClass 'not-applicable'), they are DETERMINISTICALLY N/A — added to RUNNER_NA and excluded from the
// composite denominator (same discipline as the EXEMPT set: deterministic, not LLM-flagged, so the denominator
// can't drift run-to-run). When applicable, they score like any other principle and feed the composite + gate.
const runnerDim = byDim['runner-architecture']
const executionClass = runnerDim?.executionClass || 'not-applicable'
const runnerApplicable = runnerDim?.applicable === true
const RUNNER_NA = new Set()
for (const p of (runnerDim?.principles || [])) {
  scoreById[p.id] = { id: p.id, score: p.score, rawScore: p.score, evidence: p.evidence, gap: p.gap, domainCeiling: false, cluster: 'runner-architecture' }
  ALL_IDS.push(p.id)
  if (!runnerApplicable || p.naForDomain) RUNNER_NA.add(p.id)
}

// Composite = mean over ALL non-EXEMPT scored principles. We intentionally do NOT drop LLM-flagged
// `domainCeiling` principles from the DENOMINATOR — that let the denominator drift run-to-run (a top cause of
// composite noise; see project_wc_mode3_asymptote). Only the DETERMINISTIC EXEMPT set (meta-tool P01/P06) and the
// DETERMINISTIC RUNNER_NA set (P22-P30 when the workflow runs no plan-table DAG) are excluded. domainCeiling is
// display-only annotation. The composite is advisory anyway — the substrate gate below is the real signal.
const counted = ALL_IDS.filter(id => !EXEMPT.has(id) && !RUNNER_NA.has(id))
const excluded = ALL_IDS.filter(id => EXEMPT.has(id) || RUNNER_NA.has(id))
const ceilingNoted = ALL_IDS.filter(id => !EXEMPT.has(id) && scoreById[id].domainCeiling)
const composite = counted.length ? Math.round((counted.reduce((a, id) => a + scoreById[id].score, 0) / counted.length) * 100) / 100 : 0

// Findings: dimension findings + confirmed principle gaps (refuted ones already dropped via gap="").
const findings = []
const SEV_RANK = { critical: 0, major: 1, minor: 2 }
for (const r of reviews) for (const f of (r.findings || [])) findings.push({ ...f, dimension: r.dimension })
// Re-emit principle gaps that survived verification (so refutations actually remove findings).
for (const id of ALL_IDS) {
  const p = scoreById[id]
  if (p.gap && p.score < THRESHOLD && !EXEMPT.has(id) && !RUNNER_NA.has(id) && !p.domainCeiling) {
    const sev = p.score < 7 ? 'critical' : (p.score < 9 ? 'major' : 'minor')
    findings.push({ severity: sev, dimension: p.cluster, location: p.evidence, detail: `${id} (${p.score}/10): ${p.gap}` })
  }
}
// Portability hook-command violations are always critical.
const port = byDim['path-portability']
for (const hv of (port?.hookCommandViolations || [])) findings.push({ severity: 'critical', dimension: 'path-portability', location: hv, detail: `hook command uses \${CLAUDE_SKILL_DIR} — silent-failure landmine; use \${CLAUDE_PLUGIN_ROOT}` })
findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])
const criticalCount = findings.filter(f => f.severity === 'critical').length

// ── Substrate gate (deterministic — the real convergence signal per the Mode-3 doctrine) ─────────────
// The composite is a noisy LLM proxy (±0.2, regenerating findings). The trustworthy, MONOTONIC signals are:
// zero criticals, no enforcement pattern Absent where a phase needs it, and clean path portability. overallPass
// keys on this substrate AND composite >= THRESHOLD (calibrated ceiling, default 9.0 — NOT 9.5). The skill's Mode 3
// loop additionally requires the composite to be FLAT across iterations before declaring done (the workflow can't
// see prior runs). Weak enforcement is advisory (soft) — only Absent (a missing required pattern) blocks.
const enfDim = byDim['enforcement-checklist']
const enfAbsent = (enfDim?.patterns || []).filter(p => p.status === 'Absent').map(p => p.pattern)
const portStatus = port ? port.status : 'n/a'
const substratePass = criticalCount === 0 && enfAbsent.length === 0 && (portStatus === 'Clean' || portStatus === 'n/a')
const overallPass = substratePass && counted.length > 0 && composite >= THRESHOLD
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
  P22: 'Compile-vs-interpret fit', P23: 'Single-source plan parser', P24: 'Honest gate (exit-code/probe)',
  P25: 'Pause/resume + payload>pass-fail', P26: 'Adversarial layer outside runner',
  P27: 'Join trust-class (mechanical/semantic)', P28: 'Emitter-canonical hardened',
  P29: 'Guard passes REAL artifacts (phantom-canonical)', P30: 'Gate covers all declared outputs',
}
const PRINCIPLE_ORDER = ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P13', 'P14', 'P15', 'P16', 'P17', 'P18', 'P19', 'P19b', 'P20', 'P21', 'P22', 'P23', 'P24', 'P25', 'P26', 'P27', 'P28', 'P29', 'P30']
const archRows = PRINCIPLE_ORDER.filter(id => scoreById[id]).map(id => {
  const p = scoreById[id]
  const ex = EXEMPT.has(id) ? ' (EXEMPT — meta-tool)' : (RUNNER_NA.has(id) ? ' (N/A — no plan-table DAG)' : (p.domainCeiling ? ' (domain ceiling — noted, kept in composite)' : ''))
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
        : [`| — | — | — | — | — | ${cand.summary || 'no ultracode-workflow candidates'} |`])].join('\n')
  : '(candidacy scan not run this run)'

const criticalGaps = findings.filter(f => f.severity === 'critical').slice(0, 12)
  .map((f, i) => `${i + 1}. **${f.detail}** — ${f.location} _(${f.dimension})_`).join('\n') || '_None._'

const scoreTable = [
  '| Dimension | Result | Gate |',
  '|-----------|--------|------|',
  `| Architecture composite | ${composite} / 10 (${counted.length} scored${excluded.length ? `, ${excluded.length} excluded` : ''}) | ${composite >= THRESHOLD ? '✅' : '❌'} |`,
  `| Enforcement checklist | ${enf ? `${(enf.patterns || []).filter(p => p.status === 'Present').length}/${(enf.patterns || []).length} Present` : 'n/a'} | ${enf && (enf.patterns || []).every(p => p.status !== 'Absent') ? '✅' : '⚠️'} |`,
  `| Path portability | ${port ? port.status : 'n/a'} | ${port && port.status === 'Clean' ? '✅' : '❌'} |`,
  `| Ultracode-workflow candidacy | ${cand ? `${(cand.candidates || []).filter(c => c.recommend === 'strong' || c.recommend === 'moderate').length} open` : 'n/a'} | ${cand && !(cand.candidates || []).some(c => c.recommend === 'strong') ? '✅' : '⚠️'} |`,
  `| Runner architecture | ${runnerApplicable ? `${executionClass} (P22-26 scored)` : `${executionClass} — N/A`} | ${executionClass === 'generic-interpreter' ? '❌' : '✅'} |`,
  `| Critical findings | ${criticalCount} | ${criticalCount === 0 ? '✅' : '❌'} |`,
  `| **Substrate gate** | 0 crit / ${enfAbsent.length} enf-Absent / portability ${portStatus} | ${substratePass ? '✅' : '❌'} |`,
  `| **Overall** | substrate ${substratePass ? 'clean' : 'FAILED'} + composite ${composite} vs ${THRESHOLD} | ${overallPass ? '✅ PASS' : '❌ NEEDS WORK'} |`,
].join('\n')

const reportMarkdown = [
  `## Audit: ${TARGET}${disc.isMetaTool ? ' (meta-tool — P01/P06 exempt)' : ''}`,
  ``,
  `**Verdict:** ${verdict} &nbsp;·&nbsp; **Substrate gate:** ${substratePass ? '✅ clean' : '❌ ' + criticalCount + ' crit / ' + enfAbsent.length + ' enf-Absent / portability ' + portStatus} &nbsp;·&nbsp; **Composite:** ${composite} / 10 (advisory; threshold ${THRESHOLD}) &nbsp;·&nbsp; **Critical:** ${criticalCount}`,
  `\n_The substrate gate (0 critical · no enforcement Absent · portability Clean) is the convergence signal. The composite is an advisory ±0.2 LLM proxy — see project_wc_mode3_asymptote; do not chase it past the substrate gate._`,
  excluded.length ? `\n_Excluded from composite (deterministic meta-tool exemptions): ${excluded.join(', ')}._` : '',
  ceilingNoted.length ? `_Domain-ceiling-flagged (kept in composite, not penalized as gaps): ${ceilingNoted.join(', ')}._` : '',
  ``,
  `### Architecture Scores (P01-P30)`,
  archTable,
  ``,
  `### Runner Architecture (P22-P30)`,
  `**Execution class:** \`${executionClass}\`${runnerApplicable ? ' — P22-P30 scored above.' : ' — P22-P30 N/A (no plan-table DAG of mechanical work).'}`,
  executionClass === 'generic-interpreter'
    ? '\n⚠️ **This workflow runs the RETIRED generic-interpreter shape** (LLM discovery → per-level fan-out → heavyweight re-analysis verifier). An LLM between a structured producer and a strict checker masks spec-drift. **Recommendation:** port to `spec → plan → deterministic compile → run.js` (see the migration playbook §0). This is a critical finding and fails the substrate gate.'
    : executionClass === 'already-a-fan-out'
      ? '\n_Already a genuine per-item fan-out with no plan-table DAG. **Do NOT force an engine swap.** Recommendation: spec-harden the work-list + reconcile the guard to a single-source parser (P23) where applicable._'
      : executionClass === 'compiled-runner'
        ? '\n_Already on the compiled-runner pattern. P22-P30 score its quality._'
        : '\n_Conversational / single-pass / pure-creative — the compiled-runner principles do not apply._',
  ``,
  `### Enforcement Coverage (13 patterns)`,
  enfTable,
  ``,
  `### Path Portability`,
  portTable,
  ``,
  `### Ultracode-Workflow Migration Candidates`,
  candidacyTable,
  ``,
  `### Critical Gaps`,
  criticalGaps,
].join('\n')

log(overallPass
  ? `✅ ${TARGET} PASS — composite ${composite}/10, 0 critical`
  : `❌ ${TARGET} NEEDS WORK — composite ${composite}/10, ${criticalCount} critical / ${findings.length} total finding(s)`)

return {
  overallPass,                // substratePass AND composite >= THRESHOLD
  substratePass,              // the deterministic convergence gate — the skill's Mode 3 loop keys on this + flatness
  substrate: { criticalCount, enforcementAbsent: enfAbsent, portability: portStatus },
  composite,                  // advisory ±0.2 LLM proxy — do NOT chase past the substrate gate
  verdict,
  threshold: THRESHOLD,
  isMetaTool: disc.isMetaTool,
  executionClass,             // generic-interpreter | already-a-fan-out | compiled-runner | not-applicable — drives the Mode 2/3 port-vs-harden recommendation
  runnerApplicable,           // whether P22-P30 were scored (true) or N/A (false)
  summary: { composite, substratePass, criticalCount, enfAbsent: enfAbsent.length, totalFindings: findings.length, scored: counted.length, ceilingNoted: ceilingNoted.length, executionClass },
  scoreTable,                 // dimension-level gate table
  reportMarkdown,             // full AUDIT.md body the skill writes verbatim
  candidacyTable,             // the Ultracode-Workflow Migration Candidates table
  findings,                   // severity-ordered, verified
  reviews,                    // raw per-dimension records — pass back as priorReviews on a selective re-audit
  reviewersThatFlagged: reviews
    .filter(r => (r.findings || []).length
      || (r.principles || []).some(p => p.score < THRESHOLD && !EXEMPT.has(p.id) && !p.domainCeiling && !p.naForDomain)
      || (r.violations || []).length || (r.hookCommandViolations || []).length
      || (r.candidates || []).some(c => c.recommend === 'strong'))
    .map(r => String(r.dimension)), // pass as onlyChecks on re-audit
}
