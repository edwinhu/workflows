---
name: writing-shortjournal
description: Every @article bib entry should carry a non-blank `shortjournal` field so Bluebook CSLs can render abbreviated journal names
applies-to: [writing-draft, writing-review, writing-revise]
severity: soft
---

## Rule

Every `@article{...}` entry in `references/sources.bib` that declares a `journal` field must also declare a non-blank `shortjournal` field. The `shortjournal` value should be the Bluebook T.13 abbreviation for the journal name.

Exempt (no `shortjournal` required):
- Working papers — `SSRN (Working Paper)`, `arXiv`, `Social Science Research Network`
- Research paper series — `USC CLASS Research Paper`, similar
- Book chapters rendered as `@article` — e.g., `Cambridge University Press`, `Oxford University Press`

The check fires a soft warning rather than hard failure so working papers and non-standard venues don't block the build.

## Rationale

The Bluebook law-review CSL declares journal names with `<text variable="container-title" form="short"/>` for `article-journal` entries. Citeproc looks up the short form via (in order):
1. BibTeX `shortjournal` field on the entry
2. A Zotero-style citation-abbreviations JSON file (if `--citation-abbreviations=PATH` is passed)
3. Fallback: use the full `container-title` value

When neither source #1 nor #2 exists, the citation silently renders "Columbia Law Review" instead of "Colum. L. Rev." This is a Bluebook-fidelity bug that may not surface until a reviewer flags the finished article. The check closes the gap at draft time.

## Examples

Wrong (journal without shortjournal):
```bibtex
@article{Example2025,
  author = {Jane Doe},
  title = {{On Corporate Governance}},
  journal = {Columbia Law Review},
  volume = {125},
  year = {2025}
}
```

Right:
```bibtex
@article{Example2025,
  author = {Jane Doe},
  title = {{On Corporate Governance}},
  journal = {Columbia Law Review},
  shortjournal = {Colum. L. Rev.},
  volume = {125},
  year = {2025}
}
```

Exempt (no shortjournal required):
```bibtex
@article{WorkingPaper2025,
  author = {Jane Doe},
  title = {{Preliminary Results}},
  journal = {SSRN (Working Paper)},
  year = {2025}
}
```

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "The CSL will figure out the abbreviation" | CSLs don't synthesize abbreviations from full names; they look up a stored short form | Add `shortjournal` to the bib entry |
| "I use a separate abbreviations JSON" | JSON works but requires coordination between bib and JSON; bib-local data is more robust | Prefer `shortjournal` in bib; use JSON only as a fallback |
| "Working paper, no abbreviation needed" | Correct — the check exempts SSRN, arXiv, working-paper venues | Keep the full name; the check will pass |
| "One missing shortjournal won't hurt" | It silently degrades to the full name and slips past review | Fix at draft time, not during proofs |
