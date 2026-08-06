export const meta = {
  name: 'writing-lifecycle-e2e',
  description: 'Drive a real /writing episode through all five beats in a live Herdr pane, then judge each beat from hook-written state alone',
  phases: [
    { title: 'Setup', detail: 'pin the working-tree build, seed a governed fixture, bring up a live claude-code session' },
    { title: 'Drive', detail: 'one agent per beat, strictly sequential — reads the pane and decides keys vs words' },
    { title: 'Judge', detail: 'read-only verifiers, one per beat, evidence from episode.json/review.json/transcripts only' },
    { title: 'Critique', detail: 'adversarial completeness pass over the verdicts' },
    { title: 'Teardown', detail: 'restore global settings, close the pane, report what was kept' },
  ],
}

const REPO = (args && args.repo) || '/home/eh/projects/workflows'

// ---------------------------------------------------------------------------------------------
// THE OPERATING MANUAL EVERY DRIVER NEEDS.
//
// Two runs of the bash harness died on the same defect and neither noticed: a step prompt sent
// while the model was mid-tool-call REJECTS that call. The transcript proof is 0.8s between the
// ExitPlanMode tool_use and a `"toolDenialKind": "user-rejected"` record carrying a promptId. No
// keypress was involved. A bash script cannot tell a plan-approval dialog from an AskUserQuestion
// from a genuinely stalled agent; that judgement is why these are agents.
// ---------------------------------------------------------------------------------------------
const DRIVING_RULES = `
HOW TO DRIVE THE SESSION — these rules are load-bearing and were learned by losing two full runs.

The session under test is a real \`claude-code\` process in Herdr pane PANE_ID. Control it ONLY with:
  herdr agent get <pane>          -> JSON; .result.agent.agent_status is idle|working|blocked|done
  herdr agent read <pane> --source recent-unwrapped --lines 160    -> what is on screen
  herdr agent send-keys <pane> <enter|down|up|right|left|escape>
  herdr agent prompt <pane> '<text>' --wait --timeout 300000
  herdr agent wait <pane> --until idle --timeout 300000

IRON RULE — NEVER SEND A PROMPT INTO AN IN-FLIGHT TOOL CALL.
  Claude Code treats an arriving user message as an INTERRUPTION and REJECTS whatever tool call is
  open. Measured: ExitPlanMode at 19:24:41.501, "user-rejected" at 19:24:42.304, promptId attached.
  Before EVERY \`herdr agent prompt\`:
    1. Read the screen. If ANY dialog is open, answer it with KEYS and start over.
    2. Check agent_status. If it is not idle/done, wait and re-check.
    3. Sleep 4s, then re-read the screen and re-check the status. Only prompt if BOTH still agree.
  One idle sample is a snapshot of a moving target. Two agreeing samples with no dialog between
  them is the weakest claim that is actually safe.

DIALOGS TAKE KEYS, NEVER WORDS. Identify which one you are looking at:
  * PLAN APPROVAL — "Would you like to proceed?" / "Ready to code?", options like
      1. Yes, clear context (N% used) and use auto mode
      2. Yes, and use auto mode
      3. Yes, manually approve edits
      4. Tell Claude what to change
    Press \`down\` then \`enter\` to take OPTION 2. Do NOT take option 1: it clears context and ends
    the session, and you would then be driving a session you never handshook. Do NOT take option 4.
  * AskUserQuestion — a question with choices. Press \`enter\` to pick the highlighted choice; if the
    screen then shows "Submit answers", press \`enter\` again. If it shows more questions, repeat.
    Press \`right\` to move between question tabs when one exists.
  * A tool-permission prompt — "Do you want to proceed?" with 1. Yes / 2. No. Press \`enter\` for yes.
  If you are unsure which dialog it is, read more lines before touching a key. A wrong key is
  usually unrecoverable for the run.

WHEN THE AGENT IS IDLE BUT THE BEAT HAS NOT ADVANCED, it is waiting on information, not a keypress.
Send words — but only through the IRON RULE checks above.

NEVER report what you hope happened. Your report is compared against hook-written files by a
separate verifier that cannot see your narration, and disagreements are treated as your error.
`

// =============================================================================================
phase('Setup')
const SETUP_SCHEMA = {
  type: 'object',
  required: ['ok', 'projectDir', 'paneId', 'handshake', 'notes'],
  properties: {
    ok: { type: 'boolean' },
    projectDir: { type: 'string' },
    paneId: { type: 'string' },
    handshake: { type: 'boolean', description: 'true only if the live session echoed HANDSHAKE_OK' },
    settingsBackup: { type: 'string', description: 'verbatim prior value of extraKnownMarketplaces["edwinhu-plugins"], or the string null' },
    notes: { type: 'string' },
  },
}

const env = await agent(`Set up a live end-to-end fixture for the workflows plugin. Repo under test: ${REPO}

Do these in order and verify each before moving on.

1. PIN THE BUILD UNDER TEST. A fixture with no plugin pinned loads whatever is installed at user
   scope — a previous run scored green against a RELEASED build that did not contain the change
   under test. First SAVE the current value: read ~/.claude/settings.json and record
   extraKnownMarketplaces["edwinhu-plugins"] verbatim into your report (the string "null" if absent).
   Then: claude plugin marketplace add ${REPO}
   This OVERWRITES that entry because the repo's marketplace.json declares the same name. Teardown
   restores it, so the exact prior value must appear in your report.

2. SEED THE FIXTURE. mktemp -d, then create <dir>/proj containing:
   - .planning/.state/            (empty — NO episode.json, NO review.json; the run must create them)
   - .claude/settings.json  ->  {"plansDirectory": "./.planning"}
   - .claude-workflows.json ->  {"schemaVersion": 1, "governed": true}
   - src/, references/, outlines/, drafts/
   - git init -q
   - references/notes.md with EXACTLY this content:

# Widget adoption, 2025 — research notes

## Measured adoption
- Q1 2025 installed base: 41,200 units (internal telemetry export, 2025-04-02).
- Q4 2025 installed base: 57,900 units (same export, 2026-01-08). Growth of 40.5%.
- Adoption concentrated in mid-market accounts (50-500 seats): 78% of net new units.

## Reliability
- Mean time between failures rose from 1,840h to 2,610h across the year (+42%).

## Cost
- Unit cost fell from $88 to $71, driven by the switch to a single-source magnet supplier.
- That single-source dependency is the main identified supply risk; no second source qualified.

## Open question
- Enterprise (500+ seat) adoption was flat. No instrumented explanation; sales anecdote only.

3. INSTALL THE PINNED BUILD INTO THE FIXTURE so the session loads the working tree, not the release:
   cd <dir>/proj && claude plugin install workflows --scope local
   Then VERIFY: find the installed hooks.json under the fixture or plugin cache and confirm it
   contains an orchestrator-mutation-guard registration. Report what you found. If the installed
   build lacks it, the pin failed and you must say so — ok:false.

4. BRING UP THE SESSION.
   herdr pane split --current --direction right --cwd <dir>/proj --no-focus
   -> take .result.pane.pane_id from the JSON.
   Then: herdr pane run <pane> "claude-code --permission-mode acceptEdits"
   Use claude-code, NOT claude: plain claude burns a weekly subscription limit.
   Wait ~25s, then confirm agent_status is idle.

5. HANDSHAKE. herdr agent prompt <pane> 'Reply with exactly: HANDSHAKE_OK' --wait --timeout 120000
   then read the screen. handshake:true ONLY if HANDSHAKE_OK is actually visible. If the screen
   reads empty, the harness cannot observe this session and every downstream verdict would describe
   an agent nobody can see — report ok:false.

Do NOT send any workflow prompt. Setup only.`, { schema: SETUP_SCHEMA, label: 'setup-fixture' })

if (!env || !env.ok || !env.handshake) {
  log(`SETUP FAILED — ${env ? env.notes : 'setup agent returned nothing'}`)
  return { aborted: true, setup: env }
}
log(`fixture ${env.projectDir} on pane ${env.paneId}`)

const CONTEXT = `Project under test: ${env.projectDir}
Herdr pane (PANE_ID): ${env.paneId}
${DRIVING_RULES}`

// =============================================================================================
// DRIVING IS STRICTLY SEQUENTIAL. Two agents typing into one pane is not a test, it is a race.
phase('Drive')
const OBSERVATION_SCHEMA = {
  type: 'object',
  required: ['beat', 'advanced', 'actions', 'finalState', 'notes'],
  properties: {
    beat: { type: 'string' },
    advanced: { type: 'boolean', description: 'your honest read on whether the beat completed' },
    actions: { type: 'array', items: { type: 'string' }, description: 'every key and prompt you sent, in order' },
    dialogsAnswered: { type: 'array', items: { type: 'string' } },
    interruptsCaused: { type: 'integer', description: 'times you sent a prompt and then saw a rejection or interruption on screen' },
    finalState: { type: 'string' },
    screenTail: { type: 'string', description: 'last ~25 lines of screen when you finished' },
    notes: { type: 'string' },
  },
}

const BEATS = [
  {
    key: 'CLARIFY',
    prompt: `Use the workflows:writing skill. Write a two-page internal decision memo on widget adoption in 2025 for our leadership team, recommending whether to qualify a second magnet supplier. The single complete source is references/notes.md; do not seek other sources and do not ask for more. Audience: internal leadership. Purpose: assess and recommend. Deliverable: markdown. Follow the workflow exactly.`,
    goal: `The session should invoke the writing skill and ASK clarifying questions before reading project files. Answer every AskUserQuestion it raises with keys. It may ask several rounds. The beat is done when it stops asking and is idle, or when it moves on to planning by itself. If it stalls asking for more sources, tell it references/notes.md is complete and sufficient.`,
  },
  {
    key: 'PLAN',
    prompt: `Proceed to the PLAN beat now. Produce the required plan grammar and take it through native Plan mode to approval.`,
    goal: `The session must enter Plan mode, write its plan, call ExitPlanMode, and have that approval ACCEPTED. THIS IS THE BEAT THAT DIED TWICE — both times because a prompt arrived while ExitPlanMode was open and rejected it. Watch for the approval dialog and answer it with down+enter (option 2). After approving, confirm .planning/.state/review.json now exists on disk before you report advanced:true. If it does not exist, say so plainly.`,
  },
  {
    key: 'IMPLEMENT',
    prompt: `Proceed to the IMPLEMENT beat and produce the drafts the approved plan declares.`,
    goal: `The session should DELEGATE the writing to dispatched agents rather than writing files from main chat. Expect to see refusals if it tries to write directly — those refusals are the product working, not a problem. The beat is done when the declared outputs exist under outlines/ or drafts/. Answer any tool-permission prompts with enter.`,
  },
  {
    key: 'REVIEW',
    prompt: `Proceed through the VERIFY and REVIEW beats.`,
    goal: `The session should verify its work and then present a human-review surface using the beat's own decision vocabulary (ACCEPT / REJECT: / human review / Review Surfaces). Do not accept generic uses of the word "review" as evidence.`,
  },
]

const observations = []
for (const beat of BEATS) {
  const previous = observations.length
    ? `\nWhat the previous beat driver reported:\n${JSON.stringify(observations[observations.length - 1]).slice(0, 1200)}\n`
    : ''
  const obs = await agent(`You are driving beat ${beat.key} of a live /writing episode.
${CONTEXT}${previous}
STEP 1. Read the screen and check agent_status before you touch anything. If a dialog is already
open, answer it with keys first — a previous driver may have left one.

STEP 2. Send this prompt, obeying the IRON RULE:
${JSON.stringify(beat.prompt)}

STEP 3. ${beat.goal}

STEP 4. Keep working the session until the beat advances or you have spent about 8 minutes on it.
Answer dialogs with keys. Nudge with words only when idle with no dialog open and the beat has
plainly stalled. Re-read the screen after every action; do not fire keys blind.

STEP 5. Before reporting, LOOK AT THE DISK: ls -la ${env.projectDir}/.planning ${env.projectDir}/.planning/.state
and cat any episode.json / review.json you find. Report what is actually there.

Report honestly, including actions that failed or that you regret. A separate verifier reads the
hook-written files and the session transcript without seeing your report; if you claim a beat
advanced and the files disagree, that is recorded as your error, not the product's.`,
    { schema: OBSERVATION_SCHEMA, label: `drive:${beat.key}`, phase: 'Drive' })
  observations.push(obs || { beat: beat.key, advanced: false, actions: [], finalState: 'agent died', notes: 'driver agent returned nothing' })
  log(`${beat.key}: ${observations[observations.length - 1].advanced ? 'advanced' : 'did NOT advance'}`)
}

// =============================================================================================
// JUDGEMENT IS READ-ONLY AND BLIND TO THE DRIVERS' NARRATION.
phase('Judge')
const VERDICT_SCHEMA = {
  type: 'object',
  required: ['beat', 'pass', 'evidence', 'checked'],
  properties: {
    beat: { type: 'string' },
    pass: { type: 'boolean' },
    evidence: { type: 'string', description: 'verbatim file contents or transcript records that prove it' },
    checked: { type: 'array', items: { type: 'string' } },
    productDefect: { type: 'boolean', description: 'true only if a FAILURE is the plugin\'s fault rather than the harness driving it' },
    defectDetail: { type: 'string' },
  },
}

const CHECKS = [
  {
    key: 'CLARIFY',
    how: `Read ${env.projectDir}/.planning/.state/episode.json. PASS requires phases.clarified to be a
timestamp AND workflow to be exactly "writing". The workflow field matters: it recorded "work" before
v5.139.0 and the ambient mutation guard picks its Bash policy from it, so "work" here is a real defect.
Only a hook that OBSERVED an AskUserQuestion can write phases.clarified, which is why this file is the
evidence and the agent's claim to have asked is not.`,
  },
  {
    key: 'PLAN',
    how: `Read ${env.projectDir}/.planning/.state/review.json. PASS requires a 64-hex plan_hash, a
plan_file naming a real file in .planning/, and workflow "writing". If the receipt is ABSENT, find out
why from the session transcripts under ~/.claude/projects/ (the directory name is the project path with
slashes replaced by dashes): locate every ExitPlanMode tool_use and the record immediately after it.
A "toolDenialKind":"user-rejected" within ~2 seconds carrying a promptId means the HARNESS interrupted
the call — productDefect:false, and say so explicitly. A rejection with no promptId, or an accepted
ExitPlanMode that produced no receipt, is a PRODUCT defect — productDefect:true.`,
  },
  {
    key: 'IMPLEMENT',
    how: `Check whether the plan's declared outputs exist under ${env.projectDir}/outlines or
${env.projectDir}/drafts. Then, from the transcripts, COUNT how many main-chat write attempts the
orchestrator-mutation-guard refused ("toolDenialKind":"permission-rule") and which tools they were.
Report the count in your evidence — it measures how often the model tried to write from main chat
despite the skill now stating the boundary upfront. PASS requires deliverables to exist AND no
evidence that main chat wrote them itself.`,
  },
  {
    key: 'REVIEW',
    how: `Read the last ~200 lines of the pane (herdr agent read ${env.paneId} --source recent-unwrapped
--lines 200) and the tail of the newest session transcript. PASS requires the beat's own decision
vocabulary — ACCEPT, "REJECT:", "human review", or "Review Surfaces". The bare word "review" appears
all over a Claude Code screen and is NOT evidence; an earlier version of this test passed on it while
nothing had been implemented.`,
  },
  {
    key: 'SAFETY-NET',
    how: `Two independent enforcement mechanisms, judged from disk:
(a) episode.json planBindingBlocks — if >0, the turn-end gate refused a turn over a plan-shaped file
    with no receipt. That check was DEAD before v5.139.0 (one capitalised file in .planning/ silenced
    it), so a nonzero value here is positive evidence it is alive.
(b) ls ${env.projectDir}/.planning — every *.md directly inside it. A file named as three lowercase
    hyphenated words is native-plan-shaped. Confirm from the transcripts that any such file was
    written while the session was in plan mode, NOT by a bare Write from main chat: search for a
    denial whose text contains "APPROVAL VIOLATION".
PASS if both mechanisms behaved consistently with the above. Explain what you actually found.`,
  },
]

const verdicts = await parallel(CHECKS.map(check => () => agent(
  `You are a read-only verifier for beat ${check.key} of a live /writing end-to-end run. You have NOT
seen what the driving agents claim happened, and you must not ask them. Judge only from files on disk
and session transcripts.

${check.how}

Rules: quote evidence verbatim rather than summarising it. Do not modify anything. If the evidence is
absent, say it is absent — an inconclusive verdict reported honestly is worth more than a guess, and
"pass" with no quoted evidence is treated as a failure of this verification.`,
  { schema: VERDICT_SCHEMA, label: `judge:${check.key}`, phase: 'Judge' })))

const judged = verdicts.filter(Boolean)

// =============================================================================================
phase('Critique')
const critique = await agent(`You are the completeness critic for an end-to-end test run of a Claude
Code plugin that enforces workflow beats. Below are the verifiers' verdicts. Your job is to find what
they MISSED or got wrong, not to agree with them.

VERDICTS:
${JSON.stringify(judged, null, 1).slice(0, 6000)}

Ask, and answer from the actual filesystem and transcripts (project: ${env.projectDir}, transcripts
under ~/.claude/projects/):
 1. Did any verifier mark pass:true without quoting evidence that actually supports it?
 2. Did any verifier blame the harness for something that is really a product defect, or the reverse?
    Be specific: a rejection carrying a promptId within ~2s of the tool call is the harness; anything
    else is not.
 3. What was NOT checked at all that a reader would assume was? Name it.
 4. Is there anything in the transcripts that contradicts a verdict?

Return prose. Be concrete and cite file paths and record indices. If the verdicts are sound, say so
plainly rather than inventing a finding.`, { label: 'completeness-critic', phase: 'Critique' })

// =============================================================================================
phase('Teardown')
const teardown = await agent(`Tear down the end-to-end fixture. This mutates the developer's GLOBAL
config, so it must be exact.

1. RESTORE ~/.claude/settings.json. The setup agent recorded the prior value of
   extraKnownMarketplaces["edwinhu-plugins"] as:
   ${JSON.stringify(env.settingsBackup || 'null')}
   If that is the string "null" or JSON null, DELETE the key. Otherwise restore it verbatim.
   Then run: claude plugin marketplace update edwinhu-plugins   (ignore failure)
   VERIFY by reading the file back and quoting the entry.

2. Close the Herdr pane ${env.paneId}:  herdr pane close ${env.paneId}

3. KEEP the fixture ${env.projectDir} and print its path — it is the evidence for this run. Do not
   delete it. List what is in .planning and .planning/.state so the reader knows what survived.

Report exactly what you restored, closed, and kept.`, { label: 'teardown', phase: 'Teardown' })

const passed = judged.filter(v => v.pass).length
const productDefects = judged.filter(v => v.productDefect)
log(`${passed}/${judged.length} beats verified; ${productDefects.length} product defect(s)`)

return {
  fixture: env.projectDir,
  drivers: observations,
  verdicts: judged,
  productDefects,
  critique,
  teardown,
  summary: `${passed}/${judged.length} verified, ${productDefects.length} product defect(s)`,
}
