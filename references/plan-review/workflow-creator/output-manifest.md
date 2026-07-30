# Workflow output manifest constraints

- Plan contains one canonical `Workflow Output Manifest` with ID, Kind, Path, Depends On, Work, Criteria, Evidence, Writable Paths, Instruction Files, Model, and Effort.
- IDs and outputs are unique; paths are project-relative, concrete, and traversal-free.
- Every task has observable criteria and evidence, exact mutation authority, and declared dependencies.
- Missing or malformed manifests fail closed; no LLM, Python, or legacy enumeration fallback exists.
