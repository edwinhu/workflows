# Dynamic-Workflow Migration Playbook

> **For Claude:** Load this when migrating a fan-out review/diagnosis phase into a Claude Code **dynamic workflow** (a JavaScript script the `Workflow` tool runs, orchestrating subagents in the background). This is workflow-creator's migration capability — applied during **Mode 1** decomposition (decide workflow-vs-dispatch) or as a **Mode 3** improvement (migrate an existing fan-out phase). It is grounded in a shipped migration (teaching plugin: `lecture-verify` + 5 siblings).

A **dynamic workflow** is a JS script that orchestrates subagents at scale: it holds the loop, the fan-out, and the intermediate results in *script variables*, computes the gate in *code*, runs in the background, and is resumable. It is NOT a SKILL-based multi-phase workflow (those are what Modes 1-3 create). The two compose: a skill stays the conversational shell and *calls* a dynamic workflow for the deterministic fan-out stage.

This connects directly to the **Iron Law of Flat Dispatch**: "an agent that spawns other agents is a dispatcher — and dispatchers fail." A dynamic workflow is the structural answer — it is a *script*, not a middle dispatcher agent, so reviewer results land in variables and can never be lost to a sub-sub-agent.

---

## 1. Decision rubric — MIGRATE vs LEAVE

**Migrate a phase when the SHAPE qualifies AND it gets a meaningful win from at least ONE value driver:**

| Test | Migrate | Leave conversational |
|------|---------|----------------------|
| Shape (required) | Fan-out: "one agent per X" (section, lecture, question, source, footnote) over a list, whose **aggregated results the skill consumes** | Single pass / single agent, or a few dependent steps |
| Output | A **computed gate** (numeric threshold, pass/fail, composite) **OR structured findings** the skill renders/acts on (e.g. a per-section REVIEW.md diagnosis) | Prose judgment with no structure, a creative artifact, a routing decision |
| Reviewers | **Read-only** verification/audit/diagnosis | Generation, drafting, brainstorming |

**The three value drivers — a qualifying fan-out needs a real win from AT LEAST ONE:**
1. **Parallelism** — many items reviewed concurrently (wall-clock).
2. **Context isolation** — the fan-out's transcripts would otherwise blow the main conversation's context (e.g. a 40-section paper, a 100-item chapter). *This alone justifies migration even with no numeric gate* — the workflow returns structured findings, the skill renders the artifact.
3. **Deterministic gate** — eliminates honor-system score inflation. **Strongest/cleanest** signal, but NOT required.

**Strong "migrate" smell (driver 3):** the phase tells the model to **self-report a score and then "recompute it yourself"** or "verify the arithmetic." That honor-system gate is exactly what a JS gate eliminates — the auditor returns *raw counts*, the script computes the score. If you see a manual-recompute step, migrating is a correctness win, not just a context win.

**A mid-run user *strategy* choice is NOT a disqualifier.** If the phase asks the user "review sequentially or in parallel?", that decision stays in the skill — the skill makes the call, then invokes the always-parallel workflow. Only a user *approval/judgment* gate on the phase's *content* (does this draft pass? is this issue real?) keeps the phase conversational. Don't reject a fan-out just because the skill currently wraps it in an AskUserQuestion about *how* to run it.

**Hard "leave" cases** (these stay in the skill): brainstorm, drafting/creative prose, style application, user interviews, approval gates, lookup/reference skills, and the `/goal` fix loop itself.

**Anti-pattern:** do NOT migrate a "fan-out" that is actually a *single* agent — wrapping one agent in a workflow adds a script + path resolution for no parallelism or gate win. **Read the actual phase file to count the fan-out** — never decide from a one-line summary. (A real incident: a phase summarized as "single coverage agent" actually fanned out one auditor *per lecture* AND carried a self-reported composite — it was the best candidate, nearly skipped.)

---

## 2. The hybrid split (non-negotiable)

| The WORKFLOW owns | The SKILL keeps |
|-------------------|-----------------|
| Deterministic fan-out (one read-only reviewer per item × check) | DRAFTING / creation / brainstorming |
| Result collection in script variables | The `/goal`-driven fix loop |
| The scored gate, computed in **pure JS** | R4 / user escalation, approval gates |
| Returning structured findings + score table | Rendering prose artifacts (e.g. REVIEW.md) from the findings |

A workflow **cannot host `/goal`** (no mid-run user input; the evaluator lives in the session). So the workflow is review/diagnosis + gate ONLY — it never drafts and never fixes. Name it `*-verify`, `*-diagnose`, `*-audit` — never `*-draft-*`. The skill wraps it: run workflow → read gate → (if fail) `/goal` fix loop → re-run workflow selectively → repeat.

---

## 3. Script conventions (copy from the canonical skeleton below)

1. **`export const meta`** — pure literal (no variables/calls): `name`, `description`, `whenToUse`, `phases[]`.
2. **Args normalization** — the harness may deliver `args` as a JSON *string*:
   ```js
   let cfg = args
   if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
   cfg = cfg || {}
   const PROJECT = cfg.projectDir
   if (!PROJECT) throw new Error(`<name> requires args.projectDir. Got type "${typeof args}": ${JSON.stringify(args)?.slice(0,200)}`)
   ```
3. **Selective re-run** — accept `cfg.onlyChecks` (array of `"ID:check"`) + `cfg.priorReviews` (array of prior REVIEW objects). On a selective run, re-run only flagged pairs live; carry the rest forward from priorReviews so the gate still sees every check.
4. **Discovery agent** (`model:'sonnet'`) — resolves check/agent files and **enumerates the items** to review. Never hardcode a count.
5. **Read-only reviewers** — `model:'sonnet'`, schema-validated structured output, prompts open with: *"You are a READ-ONLY reviewer. Do NOT create, edit, or overwrite any files."* Optional `cfg.useTeachingAgents`-style flag routes to a real `agentType`.
6. **Fan-out via `parallel()`** (barrier — the gate needs all results); flatten `(item × check)` into a task list.
7. **Gate in pure JS** — the script computes every score/threshold from the **raw counts** the reviewers return. Reviewers MUST return counts, not scores. Reliability flag: a check is unreliable only if `itemsChecked === 0` (NEVER a findings/items ratio — a clean check has few findings and would false-positive). *(Divergence note: the shipped `lecture-verify.js` schema still carries a per-check `score` field for display, but the gate recomputes the composite from counts regardless. If you copy that example, drop or ignore the reviewer-supplied score — never let it feed the gate. This skeleton's counts-only contract is the stricter, preferred form.)*
8. **Return shape:** `{ overallPass, scoreTable (markdown w/ Gate column), findings (non-pass, severity-ordered), reviews (raw, for priorReviews), reviewersThatFlagged ("ID:check" pairs, for onlyChecks) }`.
9. **Mechanical checks that already exist** (shell scripts, linters) run inside a reviewer/discovery agent's Bash — do NOT reimplement them in the script.
10. `node --check <script>` MUST pass.

### Canonical annotated skeleton

```js
export const meta = {
  name: 'X-verify',
  description: 'Review fan-out + scored gate. Read-only; does NOT fix.',
  whenToUse: 'Run during/after <phase>. The <skill> drives the /goal fix loop and re-invokes this to re-verify.',
  phases: [{ title: 'Discover' }, { title: 'Review' }, { title: 'Gate' }],
}

let cfg = args
if (typeof cfg === 'string') { try { cfg = JSON.parse(cfg) } catch { cfg = {} } }
cfg = cfg || {}
const PROJECT = cfg.projectDir
if (!PROJECT) throw new Error(`X-verify requires args.projectDir. Got "${typeof args}": ${JSON.stringify(args)?.slice(0,200)}`)
const SCOPE = Array.isArray(cfg.items) ? cfg.items.map(String) : null
const ONLY  = Array.isArray(cfg.onlyChecks) && cfg.onlyChecks.length ? new Set(cfg.onlyChecks.map(String)) : null
const PRIOR = new Map((Array.isArray(cfg.priorReviews) ? cfg.priorReviews : []).map(r => [`${r.item}:${r.check}`, r]))

const DISCOVERY_SCHEMA = { /* enumerate items + resolve file paths */ }
const REVIEW_SCHEMA   = { /* REQUIRED fields: item, check, itemsChecked, findings[], reportMarkdown + RAW COUNT fields — NOT scores.
                             item/check MUST echo the dispatched values so PRIOR (line above) and the gate can key on `${r.item}:${r.check}`. */ }

phase('Discover')
const disc = await agent(`Enumerate items in ${PROJECT}; resolve check files. Return DISCOVERY_SCHEMA. Absolute paths.`,
  { label: 'discover', phase: 'Discover', schema: DISCOVERY_SCHEMA, model: 'sonnet' })
let items = disc.items
if (SCOPE) items = items.filter(i => SCOPE.includes(String(i.id)))
if (!items.length) throw new Error('No items in scope')

phase('Review')
const CHECKS = [ /* {key, agentType, ...} per dimension */ ]
const tasks = []; const carried = []; let reran = 0, carriedCount = 0
for (const it of items) for (const c of CHECKS) {
  const pair = `${it.id}:${c.key}`
  if (ONLY && !ONLY.has(pair)) { if (PRIOR.has(pair)) { carried.push(PRIOR.get(pair)); carriedCount++ } continue }
  reran++
  tasks.push(() => agent(
    `You are a READ-ONLY reviewer. Do NOT create, edit, or overwrite any files.\n`
    + `Set item="${it.id}" and check="${c.key}" verbatim in your returned record (the gate keys on them).\n`
    + `Return RAW COUNTS per REVIEW_SCHEMA (the script computes scores). itemsChecked = items verified (0 ⇒ unreliable).`,
    { label: pair, phase: 'Review', schema: REVIEW_SCHEMA, model: 'sonnet', agentType: c.agentType }))
}
const reviews = [...(await parallel(tasks)).filter(Boolean), ...carried]
if (ONLY) log(`Selective re-run: ${reran} live, ${carriedCount} carried`)

phase('Gate')   // pure JS — compute scores from counts; NEVER trust a score the agent reports
const rows = [], findings = []
for (const r of reviews) {
  const score = /* compute from r's raw counts */ 0
  const unreliable = !(r.itemsChecked > 0)
  const pass = /* binary gates */ true && score >= 9.5 && !unreliable
  rows.push({ item: r.item, check: r.check, score, pass, unreliable })
  for (const f of (r.findings || [])) if (f.status !== 'MATCH') findings.push({ item: r.item, check: r.check, ...f })
}
findings.sort(/* severity, then check */)
const overallPass = rows.length > 0 && rows.every(r => r.pass)
const scoreTable = /* markdown table with a Gate ✅/❌ column */ ''
log(overallPass ? '✅ gate PASSED' : `❌ gate FAILED — ${findings.length} finding(s)`)
return {
  overallPass, scoreTable, findings, reviews,
  reviewersThatFlagged: rows.filter(r => !r.pass).map(r => `${r.item}:${r.check}`),
}
```

---

## 4. Packaging & invocation

- The script lives in the plugin's **`workflows/` asset dir** (e.g. `workflows/X-verify.js`). It is NOT a distributable plugin component and NOT a `/command`; it ships in the plugin cache like any other file.
- **Do NOT put it in dotfiles or `~/.claude/workflows/`** — that decouples it from the plugin version it depends on.
- The skill invokes it by resolving the cached path (same glob convention the plugin already uses) and calling the `Workflow` tool with `scriptPath`:
  ```bash
  WF=$(command ls -d ~/.claude/plugins/cache/<owner>/<plugin>/*/workflows/X-verify.js 2>/dev/null | sort -V | tail -1)
  ```
  ```
  Workflow({ scriptPath: "<WF>", args: { projectDir: "<abs>", items: [...], useTeachingAgents: true } })
  ```
- **Local-plugin edge case:** when the plugin runs from its source dir (not installed to the cache), the `~/.claude/plugins/cache/...` glob resolves empty and `WF` is blank → the `Workflow` call fails. Guard it: if the glob is empty, fall back to the in-repo path (`<plugin-root>/workflows/X-verify.js`) or instruct the user to install/refresh the plugin. The `<owner>/<plugin>` slug is the plugin's marketplace identifier (e.g. `edwinhu-plugins/workflows`), not its display name.
- Ships via the normal version-bump procedure (no nix rebuild). New workflow + skill wiring = minor bump.

---

## 5. Wiring the skill

In the target phase/SKILL file, **replace** (a) the section that hand-dispatches the parallel reviewers and (b) the section that computes/states the gate, with:
1. **"Run the X-verify workflow"** — resolve the cached path + `Workflow({scriptPath, args})`.
2. **"Read the gate"** — print `result.scoreTable`; the gate is `result.overallPass`, computed in JS — *do not recompute or rationalize it*.
3. **Rewrite the `/goal` fix loop** so each iteration calls the workflow: full pass first, then on re-runs pass `onlyChecks: <prev result.reviewersThatFlagged>` + `priorReviews: <prev result.reviews>`.

**Preserve verbatim:** drafting/creation steps, Iron Laws, rationalization/red-flag tables, deviation rules, R4 escalation, and the `/goal` primitive. Only the reviewer dispatch + gate computation move into the workflow. **If a self-report-then-recompute gate step existed, DELETE it** — note in the rewrite that the JS now owns the arithmetic. If a parent SKILL.md describes the phase as "spawn N agents," update that prose too (and reframe any Flat-Dispatch Iron Law: a workflow is a script, not a dispatcher agent).

---

## 6. Red flags — STOP if you catch yourself

| Rationalization | Reality | Do instead |
|-----------------|---------|------------|
| "The workflow logged 4/4 passed, so it's done." | Self-report ≠ ground truth. (A script wrote to `workflows/workflows/` because a spec carried a stray prefix; its verifier passed the *doubled* path.) | Verify artifacts exist at the **expected** path; `node --check` them yourself. |
| "I'll decide migrate/leave from the audit summary." | Summaries under-describe fan-out. | Read the actual phase file; count the agents. |
| "The reviewer reports a composite, I'll trust it." | Self-reported scores inflate — that's the smell that justified migrating. | Reviewer returns counts; the JS computes the score. |
| "I'll return only the final verify stage." | You lose the generate stage's wiring guide / artifacts. | Thread every stage's output through the pipeline return. |
| "Wrapping this one agent in a workflow is cleaner." | One agent = no fan-out, no win. | Leave it conversational. |

---

## 7. Migration gate (exit checklist)

Before claiming a migration complete, ALL must hold:
1. `node --check workflows/X.js` exits 0.
2. The script meets every convention in §3 (args-normalize, onlyChecks/priorReviews, read-only reviewers, JS gate from raw counts, `itemsChecked===0` reliability, return shape, no `/goal` inside).
3. **Field-key consistency:** the key the loop builds (`${item.id}:${check.key}`) matches the fields each reviewer returns (`item`, `check`) and the fields PRIOR + the gate read (`r.item`, `r.check`). A mismatch silently breaks `priorReviews` carry-forward on re-run — the reviewer prompt MUST inject the dispatched `item`/`check` into its record.
4. The artifact exists at the **expected** path (not a doubled/typo path) — confirmed by `ls`, not by the build's self-report.
5. The wired skill references the correct script, keeps `/goal`, drafting, and R4, and any self-report-recompute gate step was removed.
6. Decision rubric (§1) was applied from the **actual file**, not a summary.
