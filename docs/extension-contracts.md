# Public Extension Contracts

Version 5.101.0 introduced a domain-neutral capability manifest for plugins that explicitly depend on `workflows`. Version 6.0.0 retired the beat-spine capabilities with the spine itself and published `craft-spine-runner` in their place. Consumers resolve the installed dependency root from an explicit host/installer value or the `workflows-capability-root` executable that Claude Code publishes on `PATH` while the dependency is enabled. These contracts never search upward, inspect cache globs, select a “latest” installation, or assume a marketplace path.

## Discovery

1. Prefer an exact dependency root supplied explicitly by the host or installer. Otherwise locate `workflows-capability-root` on the host-provided `PATH`, require exactly one canonical executable, invoke it, and require exactly one absolute root line.
2. Validate `.claude-plugin/capabilities.json` at that root, then load its declared `capability-resolver` implementation.
3. Call `resolveDependencyCapability(dependencyRoot, capabilityName)` and verify the returned manifest schema and capability contract version before invoking the canonical implementation path.

`workflows-capability-root` derives its root only from its own installed executable location. Consumers must fail closed when the broker is missing, duplicated on `PATH`, exits nonzero, or returns malformed output. They must not replace the broker with cache scanning or version selection.

Resolution succeeds only when the manifest and implementation are contained by the canonical dependency root. Consumers must not reconstruct implementation paths independently.

## Contract matrix

<!-- public-extension-contract-table -->
| Capability | Descriptor schema | Contract version | Required discovery/root input | Success evidence | Typed rejection/error evidence | Compatibility promise |
|---|---|---:|---|---|---|---|
| `capability-resolver` | capabilities.json schema 1 | `1` | Explicit installed dependency root + capability name | ResolvedDependencyCapability | Thrown Error with stable category text | Additive within contract 1; breaking changes require a new contract version |
| `constraint-loader` | No descriptor; LoadConstraintsOptions API schema 1 | `1` | Explicit constraint directory + skill name; optional marker path | ConstraintLoadResult with ConstraintLoadEvidence | Thrown Error; CLI exits nonzero with Error text | API result and existing CLI output remain compatible within contract 1 |
| `craft-spine-runner` | craft:dispatch args: projectDir + planPath + specHash + goal + tasks, run under the Workflow runtime | `1` | Explicit projectDir + the plan's canonical craft:dispatch specHash + the approved task list; never discovers planning authority | { overallPass, verdict, scoreTable, implemented, verified, findings, refutedFindings, reviews, tasksThatFlagged, carriedForward, domainRun } — the gate computed in JS from raw counts | Thrown Error before any agent is dispatched | The spec block in the approved plan is the sole authority and its hash is verified by every dispatched agent; the returned gate keys and the fail-closed-on-dead-agent rule remain compatible within contract 1 |

## Evidence and rejection semantics

### Capability resolver

`ResolvedDependencyCapability` contains `canonicalRoot`, plugin name/version, capability name/contract version, canonical `implementationPath`, and `manifestSchema` with schema version and canonical manifest path. Invalid JSON or schema, duplicate or absent capabilities, traversal, absolute implementation paths, missing files, and symlink escape throw an `Error` whose message identifies the rejection category.

### Constraint loader

`loadConstraints` accepts an explicit `constraintsDir`, `skillName`, and optional `markerPath`. It returns deterministic combined content plus `ConstraintLoadEvidence`: skill name, matched/skipped counts, sorted constraint filenames, marker path, and whether the marker write succeeded. Invalid or escaping roots/files throw; the compatibility CLI preserves its existing stdout and nonzero-error behavior.

### Craft spine runner

`skills/craft/workflow.js` is a **Workflow script**, not an importable module: its top-level
`phase()`, `agent()` and `args` exist only inside the Workflow runtime, so importing it throws by
construction. What it owes a consumer instead is that it parses, and that its args contract and
returned gate keys are stable within contract 1.

Required args: `projectDir`, `planPath`, `specHash` (the 64-hex sha256 of the plan's canonical
`craft:dispatch` block), `goal`, and `tasks`. `readOnly: true` drops the implement leg and the
per-task verifiers, and is the only mode in which an empty `tasks` list is valid. The runner never
discovers planning authority: a missing or malformed arg throws before any agent is dispatched.

The return is `{ overallPass, verdict, scoreTable, implemented, verified, findings, refutedFindings,
reviews, tasksThatFlagged, carriedForward, domainRun }`. `overallPass` is computed in JS from raw
counts, never asserted by an agent. Three invariants hold on every path and are covered by
`skills/craft/scripts/workflow.test.ts`: a dead agent fails the run closed rather than being skipped;
`overallPass === false` implies a non-empty re-run selector; and `readOnly` dimensions report `n/a`
rather than a vacuous pass.

`skillRoot` is injected by `craft-dispatch.sh` so the prompts the runner builds name paths that
resolve on the installing machine. A caller that builds args by hand and omits it gets
`~/.claude/skills/workflows/skills/craft`.

## Compatibility

Manifest schema 1 and every capability contract are independently versioned. Additive documentation or implementation changes that preserve a capability's documented inputs, evidence shapes, rejection categories, and fail-closed security invariants may ship under its current contract version. A breaking change requires a new capability contract version (or manifest schema version when discovery itself changes). The beat-spine capabilities — `phase-gate-evaluator`, `approved-artifact-policy`, `workflow-policy-loader`, `beat-implement-runner`, `beat-spine-runner`, `beat-spine-args`, `plan-review-composer`, `tasklist-reconciler` — were removed in 6.0.0 along with their implementations. There is no shim: a consumer resolving one of those names now gets the documented absent-capability rejection from `capability-resolver`, which is the honest answer, and must move to `craft-spine-runner`.

## Release boundary

This extension contract describes discovery and invocation boundaries; it does not create a planning,
candidate, or release-evidence ledger. Release authorization remains outside this API contract and must
not be inferred from an approval receipt, implementation record, or a passing mechanical check.