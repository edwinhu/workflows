export const meta = {
  name: 'writing-draft',
  description: "writing-draft's prose generation as an ultracode TRANSFORM workflow: discover the section set from the approved outlines, assert each outline is paragraph-granular-with-sources (the executable-spec gate), then fan out one write-agent per section that EXPANDS its outline into prose — fed its own outline + the prior/next section outlines (for transitions) + PRECIS + the domain style rules. The 'what' comes from the outline; the agent adds only local prose craft, citations, and bridges — NO structural latitude. A read-only verify stage confirms each draft covers every outline point, cites only the outline's pinned sources, and connects to its neighbors. Returns per-section transform + verify records and a computed gate.",
  whenToUse: "Called by the writing-draft skill AFTER outlines are complete and OUTLINE_REVIEWED.md is APPROVED. Returns { overallPass, verdict, scoreTable, sections, findings, reviews, sectionsThatFailed, underGranular }. The skill keeps context-loading, the domain-skill load, strategy choice, and the /goal loop conversational; it writes the DRAFT_COMPLETE gate artifact only when overallPass. On a re-run it passes onlyChecks (failed section names) + priorReviews. The workflow never reviews document quality — that is writing-review's job; here verify means execution-fidelity to the spec.",
  phases: [
    { title: 'Discover', detail: 'enumerate sections from outlines/; resolve PRECIS/OUTLINE/domain; assert paragraph-granularity per outline (executable-spec gate)' },
    { title: 'Transform', detail: 'one write-agent per section — expands its outline to prose from the pinned spec + prior/next outlines for transitions, NOT from judgment' },
    { title: 'Verify', detail: 'read-only: every outline point expanded, only the outline-pinned sources cited, first/last sentences connect to neighbors' },
    { title: 'Gate', detail: 'all sections drafted AND coverage/fidelity/transition substrate clean — computed in JS' },
  ],
}

// ── Inputs ──────────────────────────────────────────────────────────────────
// args = {
//   projectDir: "/abs/writing-project-dir",     // REQUIRED — holds .planning/, outlines/, drafts/
//   pluginRoot: "/abs/.../workflows",            // optional — for resolving the domain skill (writing-{style})
//   outputSubdir: "drafts",                      // optional — where draft files land (pilot can pass "drafts-pilot")
//   onlyChecks?: ["Part II", ...],                // re-run loop: re-draft only these sections; carry the rest
//   priorReviews?: [<section objects>],           // re-run loop: prior per-section results to carry forward
// }
let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`writing-draft requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0, 200)}`)
const PLUGIN = cfg.pluginRoot || ''
const OUTDIR = cfg.outputSubdir || 'drafts'
const ONLY = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(s => [String(s.section), s]))
// Deterministic section index from scripts/writing/writing_section_index.py — the compiled "Discover".
// When the skill passes it, we skip the LLM Discover entirely (the writing analog of ds/dev's compile
// step, except the output is DATA — a section index — not a generated run.js). Back-compat: absent ⇒
// the LLM Discover still runs, so old callers and projects without a compiled index keep working.
const SECTION_INDEX = (cfg.sectionIndex && Array.isArray(cfg.sectionIndex.sections) && cfg.sectionIndex.sections.length) ? cfg.sectionIndex : null

// ── Schemas ───────────────────────────────────────────────────────────────────
const FINDING = {
  type: 'object', additionalProperties: false, required: ['severity', 'detail'],
  properties: {
    severity: { type: 'string', enum: ['critical', 'major', 'minor'] },
    detail: { type: 'string' },
    location: { type: 'string', description: 'file:line or outline point id, if applicable' },
  },
}

const DISCOVERY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['style', 'precisPath', 'outlinePath', 'domainSkillPath', 'bibPath', 'sections'],
  properties: {
    style: { type: 'string', description: 'legal | econ | general (from .planning/ACTIVE_WORKFLOW.md, else inferred)' },
    precisPath: { type: 'string', description: 'absolute path to .planning/PRECIS.md, or "" if absent' },
    outlinePath: { type: 'string', description: 'absolute path to .planning/OUTLINE.md, or "" if absent' },
    domainSkillPath: { type: 'string', description: 'absolute path to writing-{style}/SKILL.md, or "" if pluginRoot unknown' },
    bibPath: { type: 'string', description: 'absolute path to the project bibliography the draft must cite from (references/sources.bib, or a project .bib), or "" if none found — the transform agent draws real citations from here, never invents' },
    sections: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['name', 'outlineFile', 'draftFile', 'precisClaim', 'outlineGranular', 'sourcesPinned', 'granularityNote', 'prevName', 'nextName'],
        properties: {
          name: { type: 'string', description: 'section label, e.g. "Part II" — the outline stem with " (Outline).md" stripped' },
          outlineFile: { type: 'string', description: 'ABSOLUTE path to the section outline' },
          draftFile: { type: 'string', description: `ABSOLUTE target path for the prose draft (under ${OUTDIR}/)` },
          precisClaim: { type: 'string', description: 'which PRECIS claim this section advances (id or text)' },
          outlineGranular: { type: 'boolean', description: 'STRUCTURE gate only: true iff the outline decomposes the section to roughly paragraph-level units (one bullet-group ≈ one paragraph, with a discernible point per group). Source-pinning is NOT required here — citations are assigned at draft time and verified separately. false ONLY for genuinely structureless outlines (a bare list of section headings, or explicit placeholders like "TBA / develop this").' },
          sourcesPinned: { type: 'boolean', description: 'informational: does the outline already pin a source/citation to its substantive claims? If false, the transform agent must assign citations from the bib (and the fidelity check verifies them).' },
          granularityNote: { type: 'string', description: 'if not granular: exactly what is missing structurally (e.g. "bare section headings, no paragraph-level points" or "placeholder: TBA—develop this section")' },
          prevName: { type: 'string', description: 'name of the preceding section in document order, or "" for the first' },
          nextName: { type: 'string', description: 'name of the following section in document order, or "" for the last' },
        },
      },
    },
  },
}

// Write-agent returns what it wrote + the full content so verify can adjudicate independent of write timing.
const TRANSFORM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['section', 'draftFile', 'status', 'content', 'pointsExpanded', 'summary'],
  properties: {
    section: { type: 'string', description: 'echo the section name verbatim — the gate keys on it' },
    draftFile: { type: 'string' },
    status: { type: 'string', enum: ['drafted', 'skipped', 'error'] },
    content: { type: 'string', description: 'the full prose written (so verify can validate before any merge/read race)' },
    pointsExpanded: { type: 'integer', description: 'count of outline points expanded into prose' },
    summary: { type: 'string', description: 'one line: which PRECIS claim this advances + R1-R3 deviations applied' },
  },
}

const VERIFY_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['section', 'coverageOk', 'fidelityOk', 'transitionOk', 'findings', 'boundary'],
  properties: {
    section: { type: 'string', description: 'echo the section name verbatim' },
    coverageOk: { type: 'boolean', description: "SUBSTANCE coverage: is every outline point's CLAIM actually made and its logic landed in the prose? false ONLY for a genuinely DROPPED point/subsection (claim missing/unsupported). Do NOT require one-paragraph-per-point or a word-count — proportional development (a minor point folded into a clause) is CORRECT coverage, not a gap." },
    fidelityOk: { type: 'boolean', description: 'does every citation trace to a source the outline pinned (no invented/ungrounded cites)?' },
    transitionOk: { type: 'boolean', description: 'does the first sentence connect to what the prior section handed off, and the last set up the next? (true for first/last section if the open/close is sound)' },
    findings: { type: 'array', items: FINDING },
    boundary: {
      type: 'object', additionalProperties: false, required: ['firstSentence', 'lastSentence'],
      properties: { firstSentence: { type: 'string' }, lastSentence: { type: 'string' } },
    },
  },
}

// ── Phase 1: Discover ─────────────────────────────────────────────────────────
// Map the deterministic section index → the DISCOVERY_SCHEMA shape (no LLM). draftFile is
// recomputed from OUTDIR so a pilot subdir (e.g. drafts-pilot) is honored; precisClaim comes
// from the OUTLINE.md Claim→Section Map (primary claims), falling back to the draft's implements.
function discFromIndex(idx) {
  const style = idx.style && idx.style !== 'unspecified' ? idx.style : 'general'
  return {
    style,
    precisPath: idx.precisPath || '',
    outlinePath: idx.outlinePath || '',
    domainSkillPath: PLUGIN ? `${PLUGIN}/../skills/writing-${style}/SKILL.md` : '',
    bibPath: idx.bibPath || '',
    sections: idx.sections.map(s => ({
      name: String(s.name),
      outlineFile: s.outlineFile || '',
      draftFile: `${PROJECT}/${OUTDIR}/${s.name} (Draft).md`,
      precisClaim: ((s.primaryClaims && s.primaryClaims.length ? s.primaryClaims : (s.implements || [])).join(', ')) || String(s.name),
      outlineGranular: s.granular !== false,
      sourcesPinned: !!s.sourcesPinned,
      granularityNote: s.granularityNote || '',
      prevName: s.prevName || '',
      nextName: s.nextName || '',
    })),
  }
}

phase('Discover')
const disc = SECTION_INDEX ? discFromIndex(SECTION_INDEX) : await agent(
  `Enumerate the sections the writing-draft phase must produce, reading the APPROVED outlines. Working directory: ${PROJECT}

1. Set style: read ${PROJECT}/.planning/ACTIVE_WORKFLOW.md if present; if ABSENT, INFER style from the material (a law-review / legal paper → "legal"; an economics paper → "econ"; otherwise "general"). Read .planning/PRECIS.md and .planning/OUTLINE.md if present (set their absolute paths, or "" if absent). If OUTLINE.md is absent, derive document order from the outline filenames + their headings.
2. Resolve domainSkillPath: ${PLUGIN ? `"${PLUGIN}/../skills/writing-{style}/SKILL.md" with {style} substituted` : 'leave "" (pluginRoot not provided)'}.
3. Resolve bibPath: look for ${PROJECT}/references/sources.bib, else any *.bib under ${PROJECT}; if none, set "" (the draft agent will fall back to the user's Paperpile bib / mark CITE-NEEDED).
4. List ${PROJECT}/outlines/*.md . Each file named "<Name> (Outline).md" is one section; set name=<Name> (strip " (Outline).md"). Order them in DOCUMENT order using OUTLINE.md (Introduction first, then Part I, II, III, IV, Conclusion — not lexical). Set prevName/nextName from that order ("" at the ends).
5. For EACH section, set draftFile = ${PROJECT}/${OUTDIR}/<Name> (Draft).md (ABSOLUTE), and precisClaim = the claim it advances — from PRECIS/OUTLINE if present, else from the outline's own "Claim Supported" line, else a one-line summary of the section's thesis.
6. The STRUCTURE gate (outlineGranular). Read each outline and judge outlineGranular = TRUE iff it decomposes the section to roughly paragraph-level units — one bullet-group ≈ one paragraph, each group carrying a discernible point. This is a STRUCTURE check ONLY; do NOT require sources to be pinned. Set outlineGranular=FALSE only for genuinely structureless outlines: a bare list of section headings with no paragraph-level points, or explicit placeholders ("TBA", "develop this section", "X pgs"). Also set sourcesPinned = whether the outline already attaches a source/citation to its substantive claims (informational — if false, the draft agent assigns citations from the bib and they get verified). For a non-granular section, set granularityNote with exactly what's missing structurally.

Use ABSOLUTE paths. Return DISCOVERY_SCHEMA.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' }
)
if (!disc.sections.length) throw new Error(`writing-draft: no section outlines found under ${PROJECT}/outlines/. Outlines must exist (and OUTLINE_REVIEWED.md be APPROVED) before drafting.`)
if (SECTION_INDEX) log(`Discover: deterministic section index (${disc.sections.length} sections, ${disc.style}) — no LLM Discover`)
const underGranular = disc.sections.filter(s => s.outlineGranular === false)
const draftable = disc.sections.filter(s => s.outlineGranular !== false)
const outlineByName = Object.fromEntries(disc.sections.map(s => [String(s.name), s]))
log(`${disc.sections.length} section(s); ${draftable.length} structured, ${underGranular.length} structureless (bounce to outline)${ONLY ? `; re-run ${ONLY.size}` : ''}`)
if (underGranular.length) log(`⚠️ structureless outlines (NOT drafted): ${underGranular.map(s => s.name).join(', ')} — add paragraph-level structure in writing-outline first`)
const unpinned = draftable.filter(s => s.sourcesPinned === false).map(s => s.name)
if (unpinned.length) log(`ℹ️ ${unpinned.length} outline(s) don't pin sources — draft agents will assign citations from the bib; fidelity check will verify each resolves: ${unpinned.join(', ')}`)

// ── Phase 2: Transform (one write-agent per executable section, in parallel) ────
// Seams dissolve because the FULL spec exists up front: each agent reads the prior/next OUTLINE (not draft)
// to write correct bridges — no dependency on sibling drafts, so the fan-out is genuinely parallel.
phase('Transform')
const DOMAIN_RULE = {
  legal: 'Legal law-review register: confront counterarguments, NO secondary citations (cite originals), formal but not stuffy. Footnotes carry citations.',
  econ: 'Econ register: NO boilerplate ("This paper discusses…", roadmap paragraphs), NO elegant variation (one concept = one word), lead with the finding.',
  general: 'General academic prose: Strunk & White discipline — concrete, active, no filler/hedging.',
}
const tasks = []
const carried = []
let drafted = 0, carriedCount = 0
for (const s of draftable) {
  if (ONLY && !ONLY.has(String(s.name))) {
    if (PRIOR.has(String(s.name))) { carried.push(PRIOR.get(String(s.name))); carriedCount++ }
    continue
  }
  drafted++
  const prev = s.prevName ? outlineByName[String(s.prevName)] : null
  const next = s.nextName ? outlineByName[String(s.nextName)] : null
  tasks.push(() => agent(
    `You are a writing-draft prose generator. You EXPAND one section outline into prose. The outline pins the WHAT — the claims, their order at the section level, and the pinned sources. WITHIN the section you MAY merge, subordinate, or reorder the outline's points for PROPORTIONAL development: a minor point can become a clause inside a neighbor's paragraph; a pivotal one can run several paragraphs. What you may NOT do: add new claims, change the section-level structure the outline specifies, or invent citations the outline didn't pin. How the pinned points are developed, paced, and sentenced is YOURS — that judgment is what makes the prose read like a person wrote it.
Set section="${s.name}" verbatim in your record (the gate keys on it).

DOMAIN STYLE (${disc.style}): ${DOMAIN_RULE[disc.style] || DOMAIN_RULE.general}
${disc.domainSkillPath ? `Read ${disc.domainSkillPath} and follow its Iron Laws + register before writing a word.` : ''}

THIS SECTION'S OUTLINE (the spec to expand — read it in full): ${s.outlineFile}
PRECIS claim it advances: ${s.precisClaim}
${disc.precisPath ? `Full PRECIS for thesis context: ${disc.precisPath}` : ''}

FOR TRANSITIONS ONLY (read the OUTLINES, not any draft):
${prev ? `- Prior section "${prev.name}" outline: ${prev.outlineFile} — your FIRST sentence should connect to what it establishes.` : '- This is the FIRST section — open the document/argument cleanly (no "as discussed above").'}
${next ? `- Next section "${next.name}" outline: ${next.outlineFile} — your LAST sentence should set it up.` : '- This is the LAST section — close cleanly, no dangling hand-off.'}

Drafting contract (the Iron Laws of writing-draft):
- TOPIC-SENTENCE-LED, PROPORTIONAL development. Lead each unit with its TOPIC SENTENCE — the outline POINT sharpened into a claim that carries the argument — then develop it IN PROPORTION TO ITS WEIGHT: a minor point may be a single clause folded into a neighbor's paragraph; a pivotal one may run several paragraphs. COVER every point's claim and keep every subsection transition as an explicit bridge — but do NOT give every point its own paragraph and do NOT pad to a word-count target. **Uniform one-paragraph-per-point is the FAILURE MODE — it reads flat and machine-made.** A reader should be able to follow the whole argument from the topic sentences alone. (Drop a point entirely and that is a stub; pad a thin point to look complete and that is the flat tell — neither is the goal.)
- RHYTHM (positive target, not just prohibitions): vary sentence and paragraph length deliberately. Mix short, punchy sentences with longer developed ones; let a pivotal claim land in a short sentence. High variance in sentence length (burstiness) is what human legal prose has and machine prose lacks. Use semicolons and colons where two clauses balance.
- EM-DASHES, RARELY. The single most common machine tell in this pipeline is em-dash over-use. Cap them at roughly ONE per 400 words, and only for a genuine appositive or aside — NEVER as a default connector. A comma, colon, semicolon, or period almost always serves better; reach for those first. (Human legal prose averages ~0.25 em-dashes per 1,000 words; a draft with one every other sentence reads machine-made regardless of how good the rhythm is.)
- CITATIONS: this outline may not pin sources to its claims. Where a substantive claim needs a citation, draw it from a REAL source: ${disc.bibPath ? `the project bibliography ${disc.bibPath}` : 'the user\'s Paperpile bibliography (~/Google Drive/My Drive/resources/Paperpile) or the project sources'}, and for legal claims a real, well-formed, verifiable authority (case/statute/article). Carry through any [@bibkey]/[CLAIM-XX] the outline DOES pin. **NEVER fabricate a citation, and NEVER attribute a claim to a source that does not support it.** If you cannot identify a real source for a claim, leave a literal \`[CITE-NEEDED: <what's needed>]\` marker instead of inventing one — the verify stage treats an invented cite as a critical failure but an honest CITE-NEEDED as a flag to resolve.
- Apply R1-R3 deviations inline if drafting surfaces them (R1 factual fix, R2 add a real source, R3 structural bridge). If you hit an R4 (the argument itself needs restructuring), do NOT invent a fix — note it in summary and draft to the outline as written.

Write the full prose to ${s.draftFile} with the Write tool (include frontmatter \`implements: [the outline's CLAIM ids]\`). Then return TRANSFORM_SCHEMA with status="drafted", content=the FULL prose you wrote, and pointsExpanded=the number of outline points you expanded.`,
    { label: String(s.name), phase: 'Transform', schema: TRANSFORM_SCHEMA }))
}
const liveTransforms = (await parallel(tasks)).filter(Boolean)
if (ONLY) log(`Selective re-draft: ${drafted} section(s) live, ${carriedCount} carried`)

// ── Phase 3: Verify (read-only — execution-fidelity to the spec, NOT document quality) ─
phase('Verify')
const specByName = Object.fromEntries(draftable.map(s => [String(s.name), s]))
const verifs = (await parallel(liveTransforms.map(t => () => {
  const s = specByName[String(t.section)]
  const prev = s && s.prevName ? outlineByName[String(s.prevName)] : null
  const next = s && s.nextName ? outlineByName[String(s.nextName)] : null
  return agent(
    `You are a READ-ONLY verifier. Do NOT create, edit, or overwrite any files. Confirm a drafted section faithfully EXECUTED its outline — this is execution-fidelity, NOT a document-quality review (writing-review does that later).
Set section="${t.section}" verbatim.

THE OUTLINE IT HAD TO EXPAND: ${s ? s.outlineFile : '(missing — flag critical)'}
GENERATED PROSE (as written by the draft agent):
${(t.content || '').slice(0, 8000)}
Also try to Read ${t.draftFile} (prefer on-disk content if present).

Check, and report every gap in findings with severity:
1. coverageOk — SUBSTANCE coverage: is every outline point's CLAIM made and its logic landed? Judge whether the ARGUMENT the outline specifies is fully present — NOT whether each point got its own paragraph or hit a word count. Proportional development is CORRECT: a minor point folded into a clause/sentence is covered, not cursory; a uniform one-paragraph-per-point draft is NOT better-covered than a well-paced one. coverageOk=false ONLY when a point or subsection is genuinely DROPPED (its claim is absent/unsupported) ⇒ major; a wholly missing subsection ⇒ critical. Do NOT flag proportional brevity or varied paragraph length as a coverage gap.
2. fidelityOk — CITATION RESOLVABILITY (the chosen "mandatory source-verify" gate). Every citation in the prose must resolve to a REAL, identifiable source: an @bibkey must exist in ${disc.bibPath || 'the project / Paperpile bib'}; a legal authority must be well-formed and verifiable (a real case/statute/article, not a plausible-looking invention). Any citation you cannot confirm resolves — or any unfilled \`[CITE-NEEDED]\` marker left in the prose — ⇒ fidelityOk=false with a CRITICAL finding naming the cite. (Deep quote-in-source verification is the source-verify skill's job, run by the wrapping skill after this gate; here, confirm existence/resolvability and catch fabrication.)
3. transitionOk — ${prev ? `does the FIRST sentence connect to what "${prev.name}" (${prev.outlineFile}) establishes?` : 'is the opening clean (no "as discussed above" with nothing prior)?'} ${next ? `does the LAST sentence set up "${next.name}" (${next.outlineFile})?` : 'is the close clean (no dangling hand-off)?'} A seam (abrupt jump, repeated setup, dangling reference) ⇒ transitionOk=false (major).
Also return boundary.firstSentence and boundary.lastSentence verbatim (for the skill's seam audit).
Return VERIFY_SCHEMA.`,
    { label: `verify:${t.section}`, phase: 'Verify', schema: VERIFY_SCHEMA, model: 'sonnet' }
  )
}))).filter(Boolean)
const verifyByName = Object.fromEntries(verifs.map(v => [String(v.section), v]))

// ── Phase 4: Gate (pure JS — substrate split: drafted + coverage + fidelity + transitions) ─
phase('Gate')
const transformByName = Object.fromEntries([...liveTransforms, ...carried].map(t => [String(t.section), t]))
const SEV_RANK = { critical: 0, major: 1, minor: 2 }
const rows = []
const findings = []

// Structureless outlines are blocking: no paragraph-level spec to expand, so we did NOT draft — bounce to writing-outline.
for (const s of underGranular) {
  rows.push({ section: s.name, drafted: false, coverage: false, fidelity: false, transition: false, pass: false, reason: 'outline lacks paragraph-level structure' })
  findings.push({ severity: 'critical', section: s.name, detail: `${s.name}: outline lacks paragraph-level structure — ${s.granularityNote || 'bare headings / placeholder, no paragraph-level points'}. Add paragraph-level structure in writing-outline before drafting.` })
}

for (const s of draftable) {
  const name = String(s.name)
  const t = transformByName[name]
  const v = verifyByName[name] || (PRIOR.has(name) ? PRIOR.get(name).verify : null)
  const isDrafted = !!t && t.status === 'drafted'
  const coverage = !!v && v.coverageOk === true
  const fidelity = !!v && v.fidelityOk === true
  const transition = !!v && v.transitionOk !== false   // no verify (e.g. not drafted) ⇒ false, matching coverage/fidelity
  const vFindings = v?.findings || []
  const blocking = vFindings.filter(f => f.severity === 'critical' || f.severity === 'major')
  // Substrate: drafted AND coverage AND fidelity AND transitions hold AND no blocking finding.
  // Minor prose nits are advisory here — writing-review owns document-quality polish.
  const pass = isDrafted && coverage && fidelity && transition && blocking.length === 0
  rows.push({ section: name, drafted: isDrafted, coverage, fidelity, transition, pass })
  if (!isDrafted) findings.push({ severity: 'critical', section: name, detail: `${name}: not drafted (status=${t ? t.status : 'missing'})` })
  for (const f of vFindings) findings.push({ severity: f.severity, section: name, detail: `${name}: ${f.detail}`, location: f.location })
}
findings.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity])

const blockingCount = findings.filter(f => f.severity === 'critical' || f.severity === 'major').length
const minorCount = findings.filter(f => f.severity === 'minor').length
const substratePass = rows.length > 0 && rows.every(r => r.pass)
const overallPass = substratePass
const verdict = !substratePass ? 'GAPS FOUND' : (minorCount ? 'DRAFTED (advisory minor notes)' : 'DRAFTED')

const scoreTable = [
  '| Section | Drafted | Coverage | Fidelity | Transition | Gate |',
  '|---------|---------|----------|----------|------------|------|',
  ...rows.map(r => `| ${r.section} | ${r.drafted ? '✅' : '❌'} | ${r.coverage ? '✅' : '❌'} | ${r.fidelity ? '✅' : '❌'} | ${r.transition ? '✅' : '❌'} | ${r.pass ? '✅' : '❌'} |`),
  `| **Overall** | ${rows.filter(r => r.drafted).length}/${rows.length} | blocking ${blockingCount} / advisory ${minorCount} | | | ${overallPass ? '✅ DRAFTED' : '❌ GAPS'} |`,
].join('\n')

log(overallPass
  ? (minorCount ? `✅ writing-draft: all ${rows.length} section(s) drafted; substrate clean; ${minorCount} advisory minor note(s)` : `✅ writing-draft: all ${rows.length} section(s) drafted and verified`)
  : `❌ writing-draft: ${rows.filter(r => !r.pass).length}/${rows.length} section(s) failed — ${blockingCount} blocking finding(s)${underGranular.length ? ` (incl. ${underGranular.length} under-granular outline)` : ''}`)

return {
  overallPass,
  substratePass,
  verdict,
  summary: { total: rows.length, drafted: rows.filter(r => r.drafted).length, passed: rows.filter(r => r.pass).length, blocking: blockingCount, advisoryMinors: minorCount, underGranular: underGranular.length },
  scoreTable,
  sections: rows,                     // per-section status the skill renders
  findings,                           // severity-ordered; blocking = critical+major
  underGranular: underGranular.map(s => ({ section: s.name, note: s.granularityNote })), // bounce-to-outline list
  // raw per-section records (transform + verify) for priorReviews on a selective re-run
  reviews: [...liveTransforms, ...carried].map(t => ({ ...t, verify: verifyByName[String(t.section)] || (PRIOR.get(String(t.section))?.verify ?? null) })),
  sectionsThatFailed: rows.filter(r => !r.pass).map(r => r.section), // pass as onlyChecks on a re-run
}
