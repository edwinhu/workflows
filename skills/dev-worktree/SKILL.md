---
name: dev-worktree
description: "Internal /dev workspace isolation with a verified baseline."
user-invocable: false
---

# Development worktree

Use normal Git worktree isolation only when the approved generated dev plan declares it. The branch
name is derived from the receipt-selected plan's immutable intent, never a fixed `.planning/PLAN.md`.
Keep `{planFile, planHash}` in the returned worktree context and reconcile TaskList after switching
workspaces; no `STATE.md`, `HANDOFF.md`, or copied plan is created.

1. Resolve and rehash the current approved receipt before creating the worktree.
2. Ensure the worktree directory is ignored without committing unrelated changes automatically.
3. Create the branch/worktree, install only project-declared dependencies, and run the plan's baseline
   verify command fresh. Report failures as inherited baseline evidence; do not call it clean otherwise.
4. Return `{worktreePath, branch, planFile, planHash, baselineEvidence}` to the caller.

Worktree setup never changes plan authority or bypasses the shared sequential runner and independent
verification requirements.
