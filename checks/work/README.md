# work

The workflow a plan names when no domain fits (`workflow: work`). It has no constraints and no rules: `bin/workflow-check work` resolves and prints an explicit empty scope rather than refusing an unknown workflow. A check that belongs to every `/work` run goes in `checks/work/constraints/` or `checks/work/rules/`.
