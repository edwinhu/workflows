---
description: Start the 5-phase data science workflow with output-first verification
allowed-tools: Read
---

**Announce:** "Starting 5-phase DS workflow."

```
┌──────────────┐    ┌──────────┐    ┌──────────────┐    ┌───────────┐    ┌───────────┐
│ ds-brainstorm│───→│ ds-plan  │───→│ ds-implement │───→│ ds-review │───→│ ds-verify │
│  SPEC.md     │    │ PLAN.md  │    │ LEARNINGS.md │    │ APPROVED? │    │ COMPLETE? │
└──────────────┘    └──────────┘    └──────────────┘    └─────┬─────┘    └─────┬─────┘
                                         ↑                    │                │
                                         └── CHANGES REQ'D ───┘                │
                                         ↑                                     │
                                         └──── NEEDS WORK ────────────────────┘
```

Start Phase 1 (brainstorming):

Read("${CLAUDE_PLUGIN_ROOT}/lib/skills/ds-brainstorm/SKILL.md")
