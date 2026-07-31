# Development task boundaries and review surfaces

Each `TASK-NN` must fit one implementation worker, identify its exact writable authority and
outputs, and state criteria that independently establish completion. Split unrelated work or a
task whose files, ownership, dependency proof, or verification cannot be understood alone.

`## Review Surfaces` must explicitly cover the applicable correctness, regression, security,
compatibility, API/CLI/UI, data, and operational surfaces. `## Evidence Plan` must state the
runtime evidence that will support each requirement. Ambiguous ownership, writable scope, or
unreviewed surface is blocking.
