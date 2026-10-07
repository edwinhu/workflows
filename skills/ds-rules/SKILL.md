---
name: ds-rules
description: "The DS constraints C1-C6, V1-V9, A1-A6, E1-E7 as binding rule statements. Preloaded by the ds and ds-reviewer agents; load it before any data, table or figure work that is not running inside one."
---

# DS rules

These are binding on every data task, however you were launched. Each entry is the rule statement
from its canonical file, printed at load time from the corpus itself; open that file for the
rationale, the examples and the checker that enforces it. When this skill is invoked with arguments,
they are your task: do it under these rules.

!`c=${CLAUDE_PLUGIN_ROOT}/scripts/load-constraints; [ -x "$c" ] && exec "$c" ds --digest; echo "(rule loader unavailable: NO DS rule was loaded — none of C1-C6, V1-V9, A1-A6, E1-E7 is in your context; read them from the plugin's rules/ before any data work)"`
