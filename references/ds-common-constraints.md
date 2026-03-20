# DS Workflow: Common Constraints

Behavioral rules for the DS skill family. Each constraint is self-contained in its own file under `constraints/`.

**Skills that load this file:** ds (brainstorm), ds-fix (midpoint), ds-plan, ds-implement, ds-review, ds-verify, ds-delegate

After reading this index, load the specific constraint files needed for your current phase.

---

## Index

| ID | Constraint | File | Description |
|----|------------|------|-------------|
| C1 | Assumption Over Evidence | [constraints/ds-assumption-over-evidence.md](constraints/ds-assumption-over-evidence.md) | Never treat assumptions as evidence — profile/verify fresh every time |
| C2 | Deferred Verification | [constraints/ds-deferred-verification.md](constraints/ds-deferred-verification.md) | Verify after EVERY step — "later" means never |
| C3 | Impatience Over Process | [constraints/ds-impatience-over-process.md](constraints/ds-impatience-over-process.md) | Follow process — speed without correctness is malpractice |
| C4 | Data Quality Checks | [constraints/ds-data-quality-checks.md](constraints/ds-data-quality-checks.md) | Canonical DQ1-DQ6, M1, R1 definitions — load from ds-checks.md, never inline |
| C5 | Post-Subagent Boundary | [constraints/ds-post-subagent-boundary.md](constraints/ds-post-subagent-boundary.md) | After subagent returns, main chat MUST NOT read source/data — verify via state files only |
| C6 | Topic Change Protocol | [constraints/ds-topic-change-protocol.md](constraints/ds-topic-change-protocol.md) | Off-topic messages require announce-pause-handle-resume protocol |
| C7 | DS Escape Patterns | [constraints/ds-escape-patterns.md](constraints/ds-escape-patterns.md) | Four observed escape patterns — verification rationalization, silent topic change, urgency bypass, pre-delegation investigation |
| C8 | Deviation Rules | [constraints/ds-deviation-rules.md](constraints/ds-deviation-rules.md) | R1-R3 auto-fix, R4 STOP for user decision — track all deviations in LEARNINGS.md |

## Phase Loading Guide

Not every phase needs every constraint. Load by relevance:

| Phase | Must Load | Why |
|-------|-----------|-----|
| **ds (brainstorm)** | C1, C2, C3 | Brainstorm risks: assumptions, deferred checks, impatience |
| **ds-fix (midpoint)** | C1-C8 (all) | Midpoint can route to any phase — needs full constraint set |
| **ds-plan** | C1, C3 | Planning risks: assumptions, rushing past questions |
| **ds-implement** | C1, C2, C4, C5, C6, C7, C8 | Implementation: all delegation + verification constraints |
| **ds-review** | C1, C2, C4, C5 | Review: evidence-based, verify claims, post-subagent boundary |
| **ds-verify** | C1, C2, C5 | Verification: fresh evidence, no deferred checks, delegation boundary |
| **ds-delegate** | C5, C7, C8 | Delegation: post-subagent boundary, escape patterns, deviation rules |
