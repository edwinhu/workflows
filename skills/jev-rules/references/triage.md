# Triage — one bucket per rule, script before Jev

List every rule the sources state (the skill, its references, its reviewer agent, its lens prompt,
the rule corpus it loads), one row each: `# | rule (source) | bucket | one-line reason`. The table is
the deliverable of this step; a rule missing from it was never decided.

## The buckets, checked in this order

| Bucket | Test | Where it goes |
|---|---|---|
| **ALREADY MECHANICAL** | an existing probe, lint, guard or `check.sh` leg already decides it | name the check (`wc-probe P2`, `check-quotes.py`, `teleprompter-notes.py`); build nothing |
| **SCRIPTABLE** | a regex, AST walk, count, schema or file listing settles it, with no reading for meaning | a leg in the workflow's `check.sh`, diff-scoped to added lines |
| **JEV RULE** | a judgement over a bounded set of spans a script can extract | `new-rule.ts`; this skill |
| **COUNTED/ADVISORY** | a rate, a score or a "how much is enough" across a whole document | the workflow's `scoredChecks` or an advisory leg; never a gate |
| **LENS ONLY** | needs a render, an external source, cross-file semantics, or design taste | the lens or reviewer prompt keeps it |

## Deciding the hard cases

- **Scriptable means decidable, not easy.** `INLINE-CITE` (a full volume–reporter–page cite outside
  every footnote), the authoring L1–L4 literals, the workshop `VSL` matrix (a slide builds a visual iff
  its spec row says so) and teaching's `american_english.py` are scripts. A script that gates must read
  only added lines when accepted material already breaks it: 74 legacy `${CLAUDE_SKILL_DIR}/..` climbs,
  6 American-English hits, and lecture 9's Easterbrook CP 199 vs TOC 207 all sit in accepted files.
- **A script that fires on accepted work is not a script yet.** E13 (table headers named by code
  variables) flags the user's own AGK appendix; TOC density flags accepted decks 13 and 14; slide-count
  COLLAPSED resolved 5 of 25 items. Those stayed SCRIPTABLE-not-implemented, with the reason recorded.
- **A rate is advisory.** The authorial `we` (0.87% legal vs 7.75%) and `we find` openers are rates;
  the coauthored accepted articles use `we` throughout, so a gate would block accepted prose.
- **Jev needs a bounded span set.** N5 answer overlap is pairwise over the whole notes corpus: no span
  set fits one proposition under the 60000-char state cap, so it stays LENS ONLY.
- **A Jev rule whose violation a script can detect is the script's.** DQ1 (empty or constant columns)
  never separated in Jev; `ds-dq.py check_dq1` decides it on the output.
- **Sources can contradict the rule.** Before building, check the rule against its own sources and the
  accepted work: exam sentinels ("all of the above") are LEGITIMATE in slate-variety, so a ban
  (EX-SENTINEL) contradicts the professor. Record the conflict in the reason column and ask.

## After triage

Build the JEV rows in the order of what a reviewer re-judges most. Every SCRIPTABLE row is either
implemented or carries its reason for not being. Then trim the lens or reviewer: each item a wired
rule now decides gets one sentence — "X is the `<rule>` verdict in the digest: do not re-grade it" —
and presence questions ("does the skill HAVE red flags") stay with the lens.
