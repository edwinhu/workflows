# Public Extension Contracts

Version 5.101.0 introduced a domain-neutral capability manifest for plugins that explicitly depend on `workflows`. Consumers must resolve an installed dependency root supplied by their plugin host or installer; these contracts never search upward, inspect cache globs, select a “latest” installation, or assume a marketplace path.

## Discovery

1. Obtain the exact installed root of the declared `workflows` dependency from the host.
2. Call `resolveDependencyCapability(dependencyRoot, capabilityName)` from the resolver implementation at that root.
3. Read the returned canonical implementation path and verify the returned manifest schema and capability contract version before invoking the capability.

Resolution succeeds only when the manifest and implementation are contained by the canonical dependency root. Consumers must not reconstruct implementation paths independently.

## Contract matrix

<!-- public-extension-contract-table -->
| Capability | Descriptor schema | Contract version | Required discovery/root input | Success evidence | Typed rejection/error evidence | Compatibility promise |
|---|---|---:|---|---|---|---|
| `capability-resolver` | capabilities.json schema 1 | `1` | Explicit installed dependency root + capability name | ResolvedDependencyCapability | Thrown Error with stable category text | Additive within contract 1; breaking changes require a new contract version |
| `constraint-loader` | No descriptor; LoadConstraintsOptions API schema 1 | `1` | Explicit constraint directory + skill name; optional marker path | ConstraintLoadResult with ConstraintLoadEvidence | Thrown Error; CLI exits nonzero with Error text | API result and existing CLI output remain compatible within contract 1 |
| `phase-gate-evaluator` | No descriptor; PhaseGateConfig/Payload API schema 1 | `1` | Caller-supplied canonical project root + config + hook payload | PhaseGateDecision allow or deny(reason) | Typed deny decision; malformed invocation fails closed | Decision union and existing hook bytes remain compatible within contract 1 |
| `approved-artifact-policy` | Receipt-selected generated-plan state or ApprovalPolicyDescriptor schema 1 | `3` | Explicit project root + validated workflow policy + current session | ApprovedArtifact bound to the authenticated plan identity and approval mode | ArtifactError { code, message } | Security invariants cannot be disabled; validated external generated-plan workflows are contract 3 |
| `workflow-policy-loader` | WorkflowPolicyDescriptor schema 1 or native schema 2 | `2` | Explicit descriptor file path or one built-in workflow argument | Frozen WorkflowPolicy with explicit approvalMode | Thrown Error prefixed Invalid workflow policy descriptor | Schema 1 fixed artifacts remain compatible; schema 2 adds generated-plan mode without ambient inference |
| `beat-implement-runner` | runner args + validated WorkflowPolicy | `2` | Explicit projectDir + workflow policy + readyWave + immutable approval reset | Structured runner result with per-task records, plan identity, and mutation evidence | Thrown Error before dispatch or failed per-task result record | Schema 1 fixed-artifact workflows remain compatible; native plan identity support is contract 2 |
| `plan-review-composer` | No descriptor; PlanReviewComposition API schema 1 | `1` | Explicit projectDir + validated generated-plan policy + non-empty common/domain checks | Frozen PlanReviewComposition with one verdict, findings, and executed check IDs | ArtifactError { code, message }; no partial evidence or finalization on failure | Common-before-domain ordering, authenticated whole-plan input, and review-owned finalization remain compatible within contract 1 |
| `tasklist-reconciler` | No descriptor; TaskList reconciliation API schema 1 | `1` | Explicit current planHash + plan TaskContracts + existing TaskList snapshot | Frozen tool-neutral actions and current implementation-ID mapping | Thrown Error for invalid input; block action for ambiguous live identity | Identity is exactly planHash + plan_task_id + item_kind; task-kind and supersession changes require a new contract version |

## Evidence and rejection semantics

### Capability resolver

`ResolvedDependencyCapability` contains `canonicalRoot`, plugin name/version, capability name/contract version, canonical `implementationPath`, and `manifestSchema` with schema version and canonical manifest path. Invalid JSON or schema, duplicate or absent capabilities, traversal, absolute implementation paths, missing files, and symlink escape throw an `Error` whose message identifies the rejection category.

### Constraint loader

`loadConstraints` accepts an explicit `constraintsDir`, `skillName`, and optional `markerPath`. It returns deterministic combined content plus `ConstraintLoadEvidence`: skill name, matched/skipped counts, sorted constraint filenames, marker path, and whether the marker write succeeded. Invalid or escaping roots/files throw; the compatibility CLI preserves its existing stdout and nonzero-error behavior.

### Phase-gate evaluator

`evaluatePhaseGate(projectRoot, config, payload)` returns the closed union `{ kind: "allow" }` or `{ kind: "deny", reason: string }`. Configuration and payload are caller supplied; no ambient descriptor discovery occurs. Unsafe, ambiguous, stale, malformed, or missing gate evidence denies rather than weakening enforcement. The existing hook adapter retains its established allow/deny bytes.

### Approved-artifact policy

External workflows remain descriptor-v1 and supply `ApprovalPolicyDescriptor` schema 1 with exactly `schemaVersion`, `workflow`, `planPath`, `metadataPath`, and `verdictPath`. Built-in modern workflows use no descriptor: a hook-owned receipt selects one generated plan by `{planFile, planHash}`. Success returns the authenticated current `ApprovedArtifact`; rejection returns `ArtifactError { code, message }`. Neither shape can disable current-byte hashing, workflow/session separation, chronology, strict UTC timestamps, review matching, or canonical containment.

### Workflow-policy loader

`loadExternalWorkflowPolicy(descriptorPath)` requires an explicit descriptor file. Schema 1 contains only workflow identity, clarify/reviewer paths and reason, and allowed orchestrator directories. It returns a frozen policy. Unknown keys, built-in replacement, invalid or duplicate paths, malformed JSON, and unsupported schema throw an error prefixed `Invalid workflow policy descriptor:`. `workflowPolicyFromArg` accepts exactly one built-in workflow selection or one explicit external descriptor selection.

### Beat-implement runner

The runner requires explicit `projectDir`, a validated workflow policy, complete `readyWave`, and an immutable approval reset. Fixed-artifact schema-1 workflows retain their captured approval bundle; generated-plan workflows bind every result to workflow, plan file, and plan hash. Invalid top-level inputs fail before dispatch; an individual dispatch failure is represented by its structured failed task record. External policy cannot expand writable authority or bypass approval authentication.

### Plan-review composer

`composePlanReview` accepts an explicit project root, a validated generated-plan workflow policy, and non-empty common and domain check sets. It authenticates the receipt-selected exact plan before dispatch, gives every check the same immutable whole-plan context, runs checks in deterministic common-then-domain lexical order, and re-authenticates plan bytes and receipt before returning one frozen composition. Any missing, duplicate, thrown, or malformed check fails closed as `ArtifactError` without partial evidence. `finalizeComposedPlanReview` re-authenticates again and changes only `status`, `reviewer_session_id`, and `reviewed_at`; it cannot finalize a stale composition.

### TaskList reconciler

`reconcileTaskList` is a pure planner: callers supply the current `planHash`, validated `TaskContract` rows with dependencies and explicit item kinds, and a tool-neutral TaskList snapshot. Canonical identity is exactly `(planHash, plan_task_id, item_kind)`. The result contains deterministic create/update/delete/block actions and mappings only for existing current-plan implementation IDs; the adapter, not this library, executes TaskList tools. Replacement-plan pending items may be deleted, while started or completed work receives an explicit `superseded` disposition. Duplicate live identities block reconciliation, and malformed identities, missing dependencies, or cycles throw before actions are returned.

## Compatibility

Manifest schema 1 and each capability contract version 1 are independently versioned. Additive documentation or implementation changes that preserve the documented inputs, evidence shapes, rejection categories, and fail-closed security invariants may ship under contract 1. A breaking change requires a new capability contract version (or manifest schema version when discovery itself changes). Existing built-in workflow entry points remain behavior-compatible; external descriptors only add explicit identity and project-relative path configuration.

## Release boundary

This extension contract describes discovery and invocation boundaries; it does not create a planning,
candidate, or release-evidence ledger. Release authorization remains outside this API contract and must
not be inferred from an approval receipt, implementation record, or a passing mechanical check.