---
name: source-anchored-citations
description: All citations must be anchored to verified sources — no citing from training data
applies-to: [writing, writing-setup, writing-outline, writing-draft, writing-review, writing-revise]
---

## Rule

**NO CITATION WITHOUT A VERIFIED SOURCE ENTRY. This is not negotiable.**

Every citation in a draft must trace to a verified entry in `references/sources.md`. Drafting subagents cite FROM this file, not from training data. Review verifies every footnote against it.

| Iron Law | Means |
|----------|-------|
| NO DRAFT WITHOUT SOURCES | `references/sources.md` must exist before any `drafts/*.md` is created |
| NO CITATION FROM MEMORY | Drafting subagents receive `references/sources.md` as context and use its exact author names, titles, journals, years — never training-data recall |
| NO REVIEW WITHOUT BIB CHECK | Review phase must verify every footnote against `references/sources.md` and flag discrepancies |

`references/sources.md` is built during **writing-setup** from paperpile.bib, Readwise highlights, NLM notebook content, and web-verified non-academic sources (EOs, legislation, SEC releases, blog posts). See the writing-setup skill for the build procedure and format template.

## Rationale

AI drafting agents hallucinate citation details when given only short-form references like "Lund & Robertson 2023." Observed failure modes:

- **Merged authors**: subagent combined "Lund & Pollman" and "Lund & Robertson" into fabricated "Dorothy S. Lund & Elizabeth Pollman Robertson"
- **Fabricated titles**: three different titles generated for the same Copland Manhattan Institute report across three draft sections
- **Wrong coauthors**: "Wei Li" substituted for "Tao Li", "Albert Pan" for "Zikui Pan"
- **Wrong journals**: "72 Emory L.J." cited instead of "102 B.U. L. Rev." for the same article

These errors are undetectable without mechanical verification against authoritative source records. A single hallucinated cite in a published law review destroys the paper's credibility.

## Rationalization Table

| Excuse | Reality | Do Instead |
|--------|---------|------------|
| "I know this citation from training data" | Training data conflates authors, titles, and journals across papers | Use sources.md |
| "The outline has the short cite, that's enough" | "Lund & Robertson 2023" doesn't tell you the coauthor's first name or the journal | Build the full entry from bib |
| "I'll verify citations during review" | Review catches errors but doesn't prevent them — prevention is cheaper than repair | Anchor citations at draft time |
| "sources.md is too much setup work" | Building it takes 15 minutes; fixing 16 hallucinated citations takes hours | Build sources.md |
