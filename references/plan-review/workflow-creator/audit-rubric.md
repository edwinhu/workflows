# Workflow audit rubric

Use 0–10 scores only as diagnostics. A blocking finding or failed mechanical probe makes the gate fail regardless of composite.

- **P01 Decomposition:** phases have one responsibility.
- **P02 Gates:** every phase has observable evidence and mechanical enforcement where possible.
- **P03 Independence:** implementers do not verify their own work.
- **P04 Verification:** approved criteria are checked against artifacts.
- **P05 Human review:** automated PASS advances to explicit human review.
- **P06 Entries:** fresh and corrective entries are distinct and complete.
- **P07 Routing:** entry descriptions and internal phase routing do not compete.
- **P08 Skill family:** dependencies and transitions are explicit.
- **P09 Topology:** serial, parallel, and selective retry choices match filesystem authority.
- **P10 Review continuity:** repeated verification retains provenance.
- **P11 State:** semantic ACTIVE_WORKFLOW is the cursor; TaskList is live work.
- **P12 Resume:** session start and compaction route every semantic phase.
- **P13 Handoff:** HANDOFF is only an explicit context-sensitive pause.
- **P14 Gate classification:** deterministic and judgment gates are distinguished.
- **P15 Traceability:** requirements map to outputs and evidence.
- **P16 Deviation:** structural changes require reapproval.
- **P17 Artifact review:** rendered or executable surfaces are reviewed when relevant.
- **P18 Rejection:** REJECT invalidates intent/criteria and returns to clarification.
- **P19 Context:** compaction and selective retries preserve identity.
- **P19b Memory:** reusable facts use project memory, not mutable authorization files.
- **P20 Enforcement coverage:** every mechanically checkable imperative has a matching hook or deterministic invocation.
- **P21 Mutation ownership:** main chat cannot bypass delegated execution.
- **P22 Compile versus interpret:** structured plans compile deterministically.
- **P23 Single source:** one canonical manifest defines the work set.
- **P24 Task contract:** each task has complete work, criteria, evidence, outputs, and writable paths.
- **P25 Dependencies:** dependency order is explicit and validated.
- **P26 Identity:** task and approved-plan fingerprints are stable.
- **P27 Probe integrity:** probes fail closed and cannot pass on stale artifacts.
- **P28 Mutation isolation:** changed files remain within declared authority.
- **P29 Retry integrity:** retries include only proven attempted work.
- **P30 Completion:** mechanical checks, independent semantic PASS, and human review are all required.
