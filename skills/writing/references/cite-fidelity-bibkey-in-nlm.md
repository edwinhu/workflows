---
name: cite-fidelity-bibkey-in-nlm
description: Every [@bibkey] in a draft must exist as a source title in the project's NLM notebook so it can be cite-checked.
applies-to: [writing-draft, writing-revise]
type: constraint
check: cite-fidelity-lint:bibkey-not-in-nlm
---

# Bibkey must exist in the NLM notebook

Every `[@bibkey]` in a draft must correspond to a source whose title in the
project NLM notebook *exactly matches* the bibkey. If the notebook does not
contain a source titled with the bibkey, that cite cannot be cite-checked
and the lint hook reports an ERROR.

## Mechanical check

The PostToolUse hook (`cite-fidelity-lint.py`) runs `lint_drafts.py` after
every Edit/Write of `drafts/*.md`. Severity ERROR; surfaces as a hook stderr
warning, non-blocking.

## Why

Stage 3 (`check_section_cites.py`) verifies cites by scoping the NLM
notebook to the named source and asking whether it supports the claim. If
the source isn't in the notebook with the matching title, the verifier can't
do its job — it returns NOT_IN_NOTEBOOK and the cite is unverified.

## Remedies

1. **Add the source to NLM** (preferred) — upload the PDF, then rename the
   source title to match the bibkey exactly.
2. **Pick a different source** that is in the notebook.
3. **Remove the cite** if the claim doesn't actually need a source.

Do not silence this check by hand-editing — the bibkey is canonical.
