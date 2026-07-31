# Dev executable task grammar

A native dev plan is executable only when its `## Implementation Tasks` section contains one
stable `TASK-NN` block for every task. Each block must name: **Dependencies**, **Work**,
**Criteria**, **Outputs**, **Writable paths**, **First failing test / RED expectation**,
**Verify command**, **Instruction files**, **Model**, and **Effort**.

`Outputs` and `Writable paths` must be nonempty concrete project-relative paths; instruction
files must be absolute paths. Dependencies must name existing `TASK-NN` blocks and form an
acyclic DAG. The fields must compile directly into the shared `TaskContract`: `id`, `name`,
`work`, `criteria`, `outputs`, `writablePaths`, `instructionFiles`, `model`, and `effort`.

Every behavioral task requires a meaningful RED before implementation and the precise command
that establishes GREEN. Missing fields, prose-only tasks, placeholder commands, or an unresolvable
dependency are blocking.
