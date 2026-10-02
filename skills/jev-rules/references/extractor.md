# The extractor contract

`evidence(files, plan_lines=None, changed=None)` returns the state Jev judges. The judge sees nothing
else, so every fact the proposition needs must be in it — and nothing the proposition does not need.

## The contract

| Property | Rule | What breaks without it |
|---|---|---|
| Deterministic | regex, AST, tokenize; no model call, no network, no clock | calibration measures noise |
| Bounded | lists capped (`MAX_ITEMS` 25–40), each span clipped (~300 chars) | `rule-check.ts` truncates the whole state at 60000 chars; the per-edit batch splits that cap evenly across the set's rules |
| Spans | each item carries `file` and `line` (relative label), plus `end_line` for multi-line statements | the verdict cannot be acted on |
| Decisive fields | precompute the counts and booleans the proposition reads (`n_transforms_without_output_count`, `every_assertion_on_mock`, `fact_row`) | the judge re-derives them and drifts |
| Absence is a fact | record what was searched and an EMPTY list when nothing matched (`_common._search`, `render_json`) | an empty state reads as "insufficient evidence" |
| Diff-scoped | take `changed`; keep only spans that intersect the changed ranges | accepted legacy material fires the rule |
| Never the whole file | no file text, no raw regex hits over comments and docstrings | ds: 9 of 10 rules did not separate |

## `changed`, exactly

- `rule-check.ts --project-dir` computes `changedRanges` from `git diff -U0 HEAD`; untracked files are
  `[[1, n]]`. `evidence.py` passes `changed=` **only** to a module whose `evidence()` signature declares
  it (`inspect.signature`), so adding the parameter changes nothing for rules that lack it.
- `changed is None` → no diff info → the whole file is in scope (a `--files` run, a files-layout case).
- A file the map does not name has no diff info → all its lines count.
- A pure deletion after line c arrives as `[c + 0.5, c + 0.5]`: it hits only a statement spanning both
  c and c + 1. Use `_authoring.changed_set` (ceil/floor) or the set's `in_changed`/`in_scope` helper.
- With diff info, report legacy items as a count (`n_skipped_unchanged`), never their text. When the
  count itself leaks judgement ("88 notes bullets"), narrow the state to the added items alone — the
  typst `added_state(rule, files, key, items)` helper does this.

## Layout of a set

- One module per rule, `constraints/jev/<set>/<ID>.py`, exporting `PROPOSITION`, `CRITERIA` (the four
  keys VIOLATED / SATISFIED / NOT_APPLICABLE / INSUFFICIENT_EVIDENCE), `evidence`, and optionally
  `SUBJECT` (the preamble's "You are auditing …") and `DELIVERABLE`.
- Shared helpers live in `_<set>.py` beside the rules; `evidence.py` skips every `_*.py` and globs the
  directory non-recursively, so `uncalibrated/` is never read by a workflow — the layout is the wiring.
- A module in `uncalibrated/` reaches its set's helpers through the `sys.path.insert(0, <parent dir>)`
  line the scaffold writes.
- A set without its own `evidence.py` is run by `constraints/jev/evidence.py --rules-dir`.

## Extractor bugs that looked like judge failures

- **Resolution.** An excerpt of Mirror starting at line 31 renumbered the footnotes from 1, so literal
  `supra note N` pointed at the wrong note: 11 of 26 sites carried the wrong antecedent. Excerpt from
  line 1 when numbering matters, or resolve labels (`#ref(<k>)`) in the extractor.
- **Tokenizing.** L-ID's sentence splitter broke on initials ("Eugene F. Fama", "J. Fin. Econ."): the
  OPV real case went 0.73/0.67 → 0.10 once fixed.
- **Windows.** A 6-bullet window cut "Fourth:" off a four-question preview, so T-HOLLOW's judge saw a
  promise unkept. Stop at the next heading; count siblings, not sub-bullets.
- **Header rows.** A markdown table's header (`| About to | Do instead |`) read as a red flag.
- **Word senses.** E-MAGNITUDE's "significant" matched plain English ("significant impacts", 0.88/0.92);
  restrict it to statistical significance.
- **Context that answers for the span.** T-STORY judged a `// Storytelling:` comment, but the state
  also carried the diagram's placed labels ("committee *or* vote"), which supplied the branching the
  comment omitted, against the rule's own test (judge the comment with the diagram deleted). Withholding
  them and adding closed-list flags (`names_visual_property`, `states_audience_conclusion`) took the
  charter case from 0.84–0.89 to 0.99–1.00.
- **Vacuous real cases.** After T-HOLLOW's precision fix the real notes yielded zero candidates, so
  their 0.00 proved nothing; they were replaced with excerpts that contain the construct.

Before blaming the judge, dump the exact state: `python3 constraints/jev/evidence.py --files <f> --root
<dir> --rules-dir <set dir>` (or `collectEvidence` on a `caseInput` replay for a diff or base case).
