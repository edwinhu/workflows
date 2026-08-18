# Verifying a change to this skill

```bash
./scripts/check-tests.sh docx_typst
```

`tests/docx_typst_test.py` pins the pandoc behaviors this skill rests on — the fixed
point, reference-doc styles, tracked-changes ancestry, comment extraction, and the three
defects above. They are properties of an external binary this repo does not pin, so they
are asserted rather than trusted.

Two of those tests pin a BUG rather than a feature: `test_pandoc_still_emits_an_
unparseable_single_column_table` and `test_pandoc_still_misreads_a_word_final_apostrophe`
fail when pandoc FIXES the defect. That is the intended signal — it is how the
normalization gets retired instead of quietly outliving its reason.

**A second model reviews this skill, and it earns its keep.** The codex and gemini passes
over the change above both independently found the figure-naming defect (an unedited
return read as having every figure edited), the unprotected `columns:` rewrite corrupting
quoted source, and the `image(` call counted from inside a code sample. All three
reproduced and are pinned in C12/C13. One reported finding — "an authored one-cell callout
box is flattened" — did NOT reproduce as written, because a single-line cell never matched
the line shape; the predicate was tightened anyway, since a multi-line one would have.
Verify a third-party finding before acting on it, and pin the ones that survive.

**Test against real Word output, not only the fabricated fixtures.** Every defect in the
list above survived a green suite, because a docx pandoc wrote does not contain the
structures Word writes. A change to the conversion path is not verified until it has run
over an actual Word manuscript with tables and figures in it.
