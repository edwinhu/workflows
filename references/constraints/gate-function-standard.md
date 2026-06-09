---
name: gate-function-standard
description: Every phase exits through a 6-step evidence-based gate pattern
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-validate, writing-review, writing-revise, writing-precis-reviewer, writing-outline-reviewer]
---

## Rule

Every phase exits through a gate. All gates follow this 6-step pattern:

```
1. IDENTIFY: What artifact proves this phase is complete?
2. RUN: Execute the verification (read file, run test, check output)
3. READ: Examine the actual result
4. VERIFY: Does the result match the gate condition?
5. CLAIM: Only if steps 1-4 pass, proceed to next phase
6. SUMMARY: Append phase summary with YAML frontmatter to .planning/PHASE_SUMMARY.md (see phase-summary-frontmatter convention)
```

**"Looks good" is not verification. "File X contains Y" is verification.** Gates must be evidence-based.

## Rationale

**Why this exists** -- without a formal gate pattern, phases "complete" based on vibes. The agent says "looks good" without checking whether the artifact actually exists, contains required content, or meets the gate condition. This was the root cause of phantom completions where phases claimed success but produced no usable artifact.

## Examples

### Correct

```
1. IDENTIFY: PRECIS.md must exist with at least 3 CLAIM-XX entries
2. RUN: Read(".planning/PRECIS.md")
3. READ: File contains CLAIM-01, CLAIM-02, CLAIM-03 with thesis and audience
4. VERIFY: 3 claims present, thesis stated, audience defined -- gate condition met
5. CLAIM: Setup phase complete. Proceeding to Outline.
6. SUMMARY: Appended setup summary to .planning/PHASE_SUMMARY.md
```

### Incorrect

```
"The PRECIS looks complete. Moving on to outlining."
(No file read. No claim count. No verification. Just vibes.)
```

## Gate Facts

- Having just written the file is not evidence of its contents — you know what you *intended*; the file may differ. RUN the read. Mental verification is not auditable: the SUMMARY step needs written evidence.
- The next phase assumes this gate passed — deferring verification to "the next phase" creates cascading failures, and the phantom completions this pattern caused are exactly why the gate exists. Claiming a gate passed without executing steps 2-4 is an unverified claim presented as fact.

## Red Flags

- **"Looks good, moving on"** -- STOP. That's not verification. What artifact? What content? Cite it.
- **"The phase is basically done"** -- STOP. "Basically" means you skipped VERIFY. Run the gate.
- **"I'll add the summary later"** -- STOP. SUMMARY is step 6, not optional. Append it now.
- **Advancing to next phase without reading the gate artifact** -- STOP. Steps 2-3 are non-negotiable.
- **Claiming completion without stating what was verified** -- STOP. CLAIM requires VERIFY to have passed.
