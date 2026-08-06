---
name: source-anchored-citations
description: All citations must be anchored to verified sources — no citing from training data
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-verify, writing-revise]
---

## Rule

**NO CITATION WITHOUT A VERIFIED SOURCE ENTRY. This is not negotiable.**

Every citation in a draft must trace to a verified entry in `references/sources.bib` (BibTeX). Drafts use pandoc cite-keys (`[@bibkey]` or `@bibkey`) that pandoc-citeproc resolves against this file at build time. Drafting subagents write cite-keys FROM this file, not from training data. Review verifies every cite-key resolves.

| Iron Law | Means |
|----------|-------|
| NO DRAFT WITHOUT SOURCES | `references/sources.bib` must exist before any `drafts/*.md` is created |
| NO CITATION FROM MEMORY | Drafting subagents receive `references/sources.bib` as context and write `[@bibkey]` cite-keys — never free-form author/year strings that bypass the bib |
| NO REVIEW WITHOUT BIB CHECK | Review phase must verify every `[@key]` resolves to a bib entry and flag unresolved keys or claim-fidelity mismatches |

`references/sources.bib` is built during **writing-setup** from paperpile.bib, Readwise highlights, NLM notebook content, and web-verified non-academic sources (EOs, legislation, SEC releases, blog posts). See the writing-setup skill for the build procedure and the `sources_md_to_bib.py` migration script for projects that have an older `sources.md`.

## Rationale

AI drafting agents hallucinate citation details when given only short-form references like "Lund & Robertson 2023." Observed failure modes:

- **Merged authors**: subagent combined "Lund & Pollman" and "Lund & Robertson" into fabricated "Dorothy S. Lund & Elizabeth Pollman Robertson"
- **Fabricated titles**: three different titles generated for the same Copland Manhattan Institute report across three draft sections
- **Wrong coauthors**: "Wei Li" substituted for "Tao Li", "Albert Pan" for "Zikui Pan"
- **Wrong journals**: "72 Emory L.J." cited instead of "102 B.U. L. Rev." for the same article

These errors are undetectable without mechanical verification against authoritative source records. A single hallucinated cite in a published law review destroys the paper's credibility.

Using `sources.bib` + pandoc-citeproc prevents these failure modes mechanically:

- Every cite in the draft is a `[@bibkey]` cite-key; pandoc errors at build time if the key is not in the bib
- Author names, titles, journals, volumes, and years come from the single canonical .bib entry — never re-typed by the drafting agent
- Short form, supra/id., page pinpoints, and ordering are all produced from the CSL style, not hand-written

## Citation Facts

- Training data conflates authors, titles, and journals across papers — a citation typed "from memory" is a hallucination presented as a source, and hand-typed prose citations skip the bib check entirely. `[@bibkey]` resolved by pandoc/citeproc is the only checked path.
- The outline's short cite ("Lund & Robertson 2023") does not contain the coauthor's first name or the journal — look up the bib key in sources.bib.
- Building sources.bib takes ~15 minutes; fixing 16 hallucinated citations takes hours. Review catches errors but doesn't prevent them — deferring anchoring to review is counterproductive on its own terms.
