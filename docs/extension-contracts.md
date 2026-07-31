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
| `approved-artifact-policy` | Receipt-selected built-in state; ApprovalPolicyDescriptor schema 1 for external workflows | `2` | Explicit project root + workflow identity + current session; descriptor only for external workflows | ApprovedArtifact with receipt-selected built-in plan identity | ArtifactError { code, message } | Security invariants cannot be disabled; generated-plan receipt support is contract 2 |
| `workflow-policy-loader` | WorkflowPolicyDescriptor schema 1 | `1` | Explicit descriptor file path or one built-in workflow argument | Frozen WorkflowPolicy | Thrown Error prefixed Invalid workflow policy descriptor | Descriptor remains identity/path-only and built-ins remain immutable within contract 1 |
| `beat-implement-runner` | runner args + ApprovalPolicyDescriptor schema 1 | `1` | Explicit projectDir + workflow + readyWave + immutable planReset; descriptor for external workflows | Structured runner result with per-task records and mutation evidence | Thrown Error before dispatch or failed per-task result record | Built-in entry points and fail-closed enforcement remain compatible within contract 1 |

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

The runner requires explicit `projectDir`, workflow identity, complete `readyWave`, and immutable `planReset`. An external workflow must also provide a schema-1 approval policy matching that identity. Success is the existing structured runner result with complete per-task records and mutation observation. Invalid top-level inputs fail before dispatch; an individual dispatch failure is represented by its structured failed task record. External policy cannot expand writable authority or bypass approval authentication.

## Compatibility

Manifest schema 1 and each capability contract version 1 are independently versioned. Additive documentation or implementation changes that preserve the documented inputs, evidence shapes, rejection categories, and fail-closed security invariants may ship under contract 1. A breaking change requires a new capability contract version (or manifest schema version when discovery itself changes). Existing built-in workflow entry points remain behavior-compatible; external descriptors only add explicit identity and project-relative path configuration.

## Release boundary

This extension contract describes discovery and invocation boundaries; it does not create a planning,
candidate, or release-evidence ledger. Release authorization remains outside this API contract and must
not be inferred from an approval receipt, implementation record, or a passing mechanical check.