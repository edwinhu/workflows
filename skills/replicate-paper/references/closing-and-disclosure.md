# Closing a loop: scoreboard rows, matched nulls, and the disclosure paragraph

## Scoreboard rows for a hit

When a project keeps a scoreboard of locked replications (one main row per published cell, scored by a pre-registered bar):

- A hit never edits a main row. Append one row per gated cell **after** the main rows, with `headline_cell` prefixed `in-design search hit:`.
- `lock_status` = `searched` (the other statuses are `locked_before_estimation`, `pre_specified_robustness`, `post_lock`). `n_specs_searched` = the distinct `g_` steps in the ledger, excluding disclosed robustness rows and the baseline. Read it from the ledger, never hand-typed.
- `bar_pass` applies the main rows' rule to the ledger row's coef and se, and the row reports the published 95% CI. The verdict column stays `untestable`: a searched specification supports nothing.
- On a joint hit, the rows name each other and the step key (`step=<g_NN>;cell=<c>;window=<w>;class_rule=<r>`). Record the user's acceptance ("fragile and user-accepted <date>").
- The build asserts that the main tally (pass and fail counts) is identical before and after the hit rows are appended.

## Matched-null rule

A cell the published paper prints as a null (|t| < 1.96, or p >= 0.05 where only p is printed) passes when ours is also insignificant at 5% and fails when ours is significant, of either sign. Cells significant in print keep the significant-in-print rule. A cell with neither t nor p printed carries its printed p in an explicit table, so the rule never assumes one. A published null is never a grind target.

## Disclosure paragraph (appendix)

State, in this order:
1. The rule: deviations allowed only inside the paper's design, every specification priced and recorded, the count disclosed beside any hit, and a declaration before each step citing the paper's page.
2. The fence for this paper: allowed readings with pages, and the forbidden classes.
3. The stopping rule: one step in the original window with every gated cell at the published sign, |t| >= 1.96, inside the published CI. The SE is backed out of t or p. Published nulls never count. The search is outcome-conditioned, so a hit is a searched specification.
4. Any further rules applied: `inference_only` rows, no threshold tuning, joint gates the user added (quoted, dated), and steps rejected as out of fence (kept in the count).
5. Per paper: the hit, or the best row per cell; the count of steps and pulls; the switches the hit stacks; what it does not survive (another window, another construction).
