# Model Profiles

> **Status: design note, not implemented.** Nothing in this repo reads
> `model_profile` or `model_overrides`, and no `.planning/config.json`
> resolution step exists — verified 2026-07-22. Agents pin their model
> directly in `agents/*.md` frontmatter instead (13 × `model: inherit`,
> 7 × `model: sonnet`). Treat the tables below as the proposed design, not
> as a description of current behavior; wiring it up would mean building the
> resolution logic in §Resolution Logic first. Provenance: §4 of
> [gsd-learnings.md](gsd-learnings.md).

Model profiles control which Claude model each agent uses, balancing quality vs token cost.

## Profile Definitions

| Agent | quality | balanced | budget | Role |
|-------|---------|----------|--------|------|
| architect | opus | opus | sonnet | Design judgment, system architecture |
| planner | opus | opus | sonnet | Implementation planning |
| dev-debugger | opus | sonnet | sonnet | Hypothesis-driven debugging |
| code-reviewer | opus | sonnet | sonnet | Code quality, security, performance |
| security-reviewer | opus | sonnet | sonnet | Security vulnerability detection |
| tdd-guide | opus | sonnet | sonnet | TDD enforcement, coverage verification |
| dev-implementer | opus | sonnet | sonnet | Code execution, follows explicit plans |
| build-error-resolver | sonnet | sonnet | sonnet | Build/type error resolution |
| dev-verifier | sonnet | sonnet | haiku | Goal-backward verification (read-only) |
| dev-plan-checker | sonnet | sonnet | haiku | Plan quality gate (read-only) |
| test-gap-auditor | sonnet | sonnet | haiku | Test gap filling (tests only) |
| ds-analyst | sonnet | sonnet | haiku | Data analysis tasks |
| e2e-runner | sonnet | sonnet | haiku | End-to-end test execution |
| refactor-cleaner | sonnet | sonnet | haiku | Dead code cleanup |
| data-explorer | sonnet | haiku | haiku | Data exploration (read-only) |
| doc-updater | sonnet | haiku | haiku | Documentation updates |
| librarian | sonnet | haiku | haiku | Knowledge search (read-only) |

## Profile Philosophy

**quality** — Maximum reasoning power
- Opus for all decision-making and code-writing agents
- Sonnet for read-only verification
- Use when: critical architecture work, complex features, quota available

**balanced** (default) — Smart allocation
- Opus only for architecture and planning (where design decisions happen)
- Sonnet for execution, review, and verification (follows explicit instructions)
- Use when: normal development, good balance of quality and cost

**budget** — Minimal cost
- Sonnet for anything that writes code
- Haiku for research, verification, and exploration
- Use when: high-volume work, less critical phases, conserving quota

**inherit** — Follow session model
- Agent uses whatever model the current session is running
- Use when: non-Anthropic providers, user wants manual control

## Resolution Logic

When spawning an agent:
1. Check if project has `.planning/config.json` with `model_overrides` for this agent
2. If override exists, use it
3. Otherwise, look up agent in profile table using active profile
4. Pass `model` parameter to Agent/Task call

## Per-Project Overrides

Projects can override specific agents without changing the entire profile by adding to `.planning/config.json`:

```json
{
  "model_profile": "balanced",
  "model_overrides": {
    "dev-implementer": "opus",
    "code-reviewer": "haiku"
  }
}
```

Overrides take precedence over the profile. Valid values: `opus`, `sonnet`, `haiku`, `inherit`.

## Design Rationale

**Why Opus for architect/planner?**
Architecture and planning involve design judgment, goal decomposition, and trade-off analysis. This is where model quality has the highest impact on downstream work.

**Why Sonnet for dev-implementer in balanced?**
Implementers follow explicit PLAN.md instructions. The plan already contains the reasoning; execution is implementation. Sonnet handles this well at lower cost.

**Why read-only tools for verifiers?**
Verification agents (dev-verifier, dev-plan-checker) have no Write/Edit tools. This prevents them from "fixing" issues instead of reporting them, which would defeat the purpose of independent verification.

**Why Haiku for explorers?**
data-explorer, doc-updater, and librarian do read-only exploration and structured output extraction. No reasoning required, just pattern matching from file contents.
