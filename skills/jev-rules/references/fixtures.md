# Fixtures and real accepted cases

The calibration set lives in `tests/fixtures/jev/calibration.json` (or a plugin's own manifest with a
`root` key, resolved relative to the manifest file — teaching uses `"root": "../../.."`). Each rule
lists cases `{kind: violating|compliant, path, source?, base?}`.

## Twins: `vio` and `sat`

- **Minimal and paired.** The two share one skeleton (a `csv-audit` skill, a proxy-advisor talk) and
  differ only in the construct the rule judges. The scaffold writes identical placeholders, so its
  stub test stays red until the twins differ in what the extractor extracts.
- **Each violating twin breaks only its own rule.** The cross-rule matrix checks it. N-COLD's twin
  carried a genuinely hollow Recap bullet and N-HOLLOW scored it 0.94; the fix rewrote that bullet,
  not N-COLD's own violation.
- **Layouts.** `files`: every file in the case dir goes to the extractor, `plan.md` as `--plan`.
  `diff`: `before/` is committed in a temp repo and `after/` laid over it; files carry a `.fixture`
  suffix so no probe reads a fixture SKILL.md as a live skill. A path the repo `.gitignore` ignores
  (`.planning/`) must be force-added.
- **Never loosened.** A twin is not edited after its first score. A twin that turns out wrong — the
  old ds `vio` files had zero sites of the construct (DEN, R1, UNI, DQ4, DQ6, E7), so they read
  NOT_APPLICABLE — gets a corrected **new** pair (`vio2`/`sat2`) beside it, and the old one stays,
  reported as weak.

## Real accepted cases

A rule passes only if real accepted work scores < 0.5: twins alone measure the author's imagination.

- **Bounded excerpt, read-only.** `sed -n 'A,Bp'` or `git show <commit>:<path>` from the source; never
  edit the source. Keep it self-contained: start at line 1 when footnote or note numbering matters.
- **The source note lives in the manifest**, because every file in a case dir reaches the extractor:
  repo, path, commit or sha256, lines, and the acceptance status ("accepted at Georgetown L.J.",
  "presented deck", "released as Addendum III", "submitted 2026-08-08", "draft").
- **Public vs private.** The workflows repo is public: redact contacts and secrets; course material
  stays in the private teaching repo's own manifest.
- **A real violating case is fine** when the accepted work genuinely breaks the rule (E7's
  `cl_download_opinion_pdfs.py` cites no ceiling, 1.00).
- **Check the case exercises the rule.** E-CITEFORM's AGK appendix has no author-year citations, so it
  tests only the not-applicable path; say so in the report.

## Accepted work that breaks the written rule: legacy-base pairs

When an accepted excerpt contains the violation (T-CALLOUT: the Tornetta deck quotes the opinion in a
callout, 0.94–0.97), it stops being a standalone compliant case and becomes a `base`:

```json
{ "kind": "compliant", "path": "tests/fixtures/jev/real/T-legacy-callout-tornetta/ok", "base": "tests/fixtures/jev/real/T-tornetta-short-deck", "source": "... accepted legacy deck that breaks the written rule: callout at 135 quotes the opinion; the new span adds a question callout" },
{ "kind": "violating", "path": "tests/fixtures/jev/real/T-legacy-callout-tornetta/bad", "base": "tests/fixtures/jev/real/T-tornetta-short-deck", "source": "... same legacy base, the new span adds a callout quoting the opinion" }
```

The base is committed and the case dir laid over it, so a diff-scoped rule sees only the new span:
`bad` must score >= 0.85, `ok` < 0.5. This needs the extractor to take `changed`. Use it only after
the user has accepted that new work follows the rule while legacy work stays (N-UNCITED: 208 of 221
answer blocks in lectures 14–15 were uncited; the user decided, then changed-lines scoping wired it).

## An accepted case the user rules violating

When a real case scores high because it really breaks the rule (Mirror's "119th Congress, supra note
3" for an unenacted bill, 0.82/0.83 on that span alone), ask. With the ruling: relabel the case
`violating`, add a cured twin that changes only that span (`L-opv-glj-fn20-cured`: one line, the
full Federal Register cite), and record the ruling in both `source` notes and the module docstring.
