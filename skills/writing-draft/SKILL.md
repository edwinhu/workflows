---
name: writing-draft
description: Internal writing phase that expands authenticated PLAN-bound section outlines into prose.
user-invocable: false
disable-model-invocation: true
hooks:
  PreToolUse:
    - matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash|Agent|Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/approved-artifact-gate.ts --workflow writing"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/orchestrator-mutation-guard.ts --workflow writing"
    - matcher: "Write"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-outline-guard.ts"
    - matcher: "Workflow"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-mechanical-gate.ts"
  PostToolUse:
    - matcher: "Edit|Write|MultiEdit|NotebookEdit"
      hooks:
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-suggest-verify.ts"
        - type: command
          command: "bun ${CLAUDE_PLUGIN_ROOT}/hooks/writing-claim-id-guard.ts"
---

# Writing Draft

!`bun ${CLAUDE_SKILL_DIR}/../../scripts/load-constraints.ts writing-draft`

Expand each PLAN-bound detailed outline into prose through `workflows/writing-draft.js`. The workflow receives the authenticated `planPath` and deterministic section index; it never discovers canonical structure through an LLM or retired planning file.

## Iron Laws

- **NO PROSE WITHOUT AN AUTHENTICATED, INDEPENDENTLY REVIEWED WRITING PLAN.**
- **NO PROSE WITHOUT THE MATCHING DETAILED OUTLINE.**
- **NO LLM OR LEGACY DISCOVERY FALLBACK.** Missing or malformed canonical inputs block.
- **NO STRUCTURAL PLAN CHANGES DURING DRAFTING.** Replace and re-review the plan instead.

## Inputs

1. Run approved-artifact admission for `writing`.
2. Load the domain skill from index `style` and load `workflows:ai-anti-patterns`.
3. Reconcile draft tasks in TaskList by `(planHash, section name, item_kind=draft)`.

## Invocation

**NO WORKFLOW WITHOUT AN AUTHENTICATE PRE-STEP AND A `--verify` POST-STEP.** The
workflow script is pure control flow — the Workflow runtime forbids `import()`,
`import.meta`, `process`, and `Buffer`, so the orchestrator cannot open, hash, or
re-stat a file. Artifact authentication and output verification therefore run in
the deterministic compiler on either side of the dispatch. They are never
delegated to an agent: the section index itself comes from an agent, and asking
the untrusted party to vouch for its own artifacts is not authentication — which
matters most here, because the party writing the drafts is the party being checked.

**1. Authenticate (pre-step).** Snapshot every artifact this run READS under TOCTOU
discipline (`O_NOFOLLOW` open, fstat-vs-lstat identity comparison across the read,
realpath containment, sha256 of the bytes actually opened):

```bash
# Full draft run — the drafts are OUTPUTS; authenticate none of them.
python3 ${CLAUDE_SKILL_DIR}/../../scripts/writing/writing_section_index.py \
  --authenticate "<absolute project root>" --drafts none > /tmp/writing-draft-auth.json

# Selective retry — authenticate ONLY the carried sections' drafts (comma-separated,
# exactly the sections NOT in onlyChecks).
python3 ${CLAUDE_SKILL_DIR}/../../scripts/writing/writing_section_index.py \
  --authenticate "<absolute project root>" --drafts "<carried section>,<carried section>" \
  > /tmp/writing-draft-auth.json
```

**`--drafts` is not a convenience flag; it is the input/output boundary.** A draft
this run produces cannot be in an entry bundle — the file does not exist yet on a
first run, and on a retry a pre-run snapshot of a draft the agents are about to
rewrite would be reported as drift by the post-step, failing a good run. Passing
`--drafts all` here (the default, and correct for `writing-verify`) is a bug:
it makes a first run impossible and a clean re-draft un-passable.

Non-zero exit or `ok !== true` blocks drafting — read `violations` and stop. The
bundle carries `projectReal`, `planPath`, `planHash`, `index` (the same
deterministic section index the bare invocation compiles — require `ok: true`,
`reviewStatus: APPROVED`, the current generated `planFile`, and every plan
section), `draftsAuthenticated` (echoes the selection — check it against your
carried set), and `artifacts`, keyed `receipt`, `plan`, `bib`,
`section:<name>:outline`, and `section:<name>:draft` for carried sections only.

**2. Run the shared IMPLEMENT beat's pre-step.** This is what binds each drafting agent to the one
draft file it is allowed to write — read `${CLAUDE_SKILL_DIR}/../beat-implement/SKILL.md` for the
full contract. Build one task per section being drafted, with `id` equal to the section name so it
matches the `TASK` marker the workflow emits:

```bash
echo "$PREFLIGHT_REQUEST_JSON" | bun ${CLAUDE_SKILL_DIR}/../../scripts/beat/preflight.ts
```

`PREFLIGHT_REQUEST_JSON` is `{projectDir, workflow: "writing", planReset: {planFile, planHash},
dispatchOwnership: "caller", readyWave: [...]}`, where each task declares
`writablePaths: ["<outputSubdir>/<section>.md"]` and the same path as its `outputs`.

On a selective retry the wave is **exactly `onlyChecks`** — the sections being re-drafted. It is the
complement of `--drafts` above, for the same reason: a carried section is an input, and giving an
agent write authority over a file it is not supposed to touch is the bounds check declining to do its
job.

`dispatchOwnership: "caller"` is correct here: this workflow owns Transform, Verify and Gate phases,
so the beat must not route it or emit a script. Everything that enforces is identical to a beat-owned
dispatch.

**A non-zero exit blocks drafting.** Skipping this step does not fail — the workflow runs, the hooks
find no expectation, and every drafting agent writes with no bounds checked. That is the state
writing was in before this step existed.

This **subsumes** the old per-draft content check: `enforceTaskOutputs` already cross-checks the
agent's reported changes against the observed filesystem delta, which is the misreporting check the
post-step's `reportedContent` comparison was doing. Keep one, not both.

**3. Dispatch.** Pass the bundle's fields straight through:

```text
Workflow({
  scriptPath: "${CLAUDE_SKILL_DIR}/../../workflows/writing-draft.js",
  args: {
    projectDir: "<absolute project root>",
    projectReal: <bundle.projectReal>,
    pluginRoot: "${CLAUDE_SKILL_DIR}/../../workflows",
    planPath: <bundle.planPath>,
    planHash: <bundle.planHash>,
    sectionIndex: <bundle.index>,
    artifacts: <bundle.artifacts>,
    outputSubdir: "drafts"
  }
})
```

On selective retry, pass `onlyChecks` and `priorReviews` only when they carry the
same `planHash`, and pass the carried section names to `--drafts` so the bundle
supplies their `section:<name>:draft`. The two lists are complements: every section
in `onlyChecks` is being re-drafted (an output) and must NOT be in `--drafts`;
every other section is carried (an input) and must be. A replacement plan
invalidates prior retries and review records.

**4. Verify (post-step).** The returned verdict is provisional — it carries
`verifyRequired: true` and `driftVerified: false`. Write the return value to disk
and re-snapshot:

```bash
python3 ${CLAUDE_SKILL_DIR}/../../scripts/writing/writing_section_index.py \
  --verify /tmp/writing-draft-auth.json --findings /tmp/writing-draft-result.json \
  > /tmp/writing-draft-final.json
```

The post-step owns two distinct checks, and the gate is unsafe until both have run:

- **Input drift.** Every authenticated input (plan, receipt, bib, each outline,
  each carried draft) is re-snapshotted. Anything that moved gets its hash zeroed,
  its section's findings discarded — they describe bytes that no longer exist — and
  a critical `artifact-integrity` finding in their place. Drifted sections are
  re-drafted from a fresh authenticate, never patched from the discarded findings.
- **Output verification.** For each section listed in `pendingDraftVerification`,
  the post-step reads that row's `draftFile` and confirms the bytes on disk equal
  its `reportedContent`, then records the file's hash as that review's `draftHash`.
  A live section's `drafted` is the drafting agent's own account of its work until
  this check passes; an empty `draftHash` means "not yet verified", never "verified".

## Drafting Contract

- Expand every outline claim in proportion to its weight; avoid stubs and uniform one-paragraph-per-point padding.
- Lead units with topic sentences and preserve explicit bridges across dependency order.
- Use only real sources from Source Plan and the section outline. Leave `[CITE-NEEDED: ...]` rather than inventing authority.
- Preserve exact mapped `CLAIM-NN` identifiers and current `plan_hash` in draft frontmatter; `implements` must equal the mapping exactly, including `[]` for claimless sections.
- Introduction and Conclusion use continuous prose; only body Parts receive domain-appropriate subsection headings.
- Record workflow results, blockers, and retry fingerprints in TaskList rather than PLAN or a Markdown status ledger.

## Mechanical and Semantic Verification

For every draft, dispatch a read-only verifier agent to run the deterministic floor against PLAN with `python3 ${CLAUDE_SKILL_DIR}/../../scripts/writing/writing_gate_probe.py "<exact section.draftFile from Section Outputs>" --bib "<index.bibPath>" --plan "<index.planPath>" --plan-hash "<index.planHash>"` and return its JSON without writing files. The orchestrator does not run this Bash command directly.

A false result returns to the same current-hash draft task. Numeric consistency is advisory and explicitly not dataset provenance. Then run `workflows:source-verify`; citation existence is not source support.

## Exit Gate

Read the gate from the **finalized** post-step output, never from the raw workflow
return (`verifyRequired: true` means neither the drift check nor output verification
has run, and the verdict is not yet trustworthy). Read the workflow result, not a
self-report. `overallPass` must be true, `driftVerified` true, `driftedArtifacts`
empty, every `pendingDraftVerification` section resolved to a non-empty `draftHash`,
`underGranular` empty, the generated plan hash unchanged, every reviewed outline unchanged after asynchronous verification, exact draft frontmatter valid, the deterministic probe clean, and semantic source verification clean. Store the evidence and result in TaskList. These checks replace the retired marker-based validation phase; continue directly to independent `writing-verify` without creating a completion marker.
