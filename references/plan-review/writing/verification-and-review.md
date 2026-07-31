# Writing verification and review

The authenticated generated PLAN must separate drafting fidelity, automated semantic review,
revision, final validation, and human acceptance. Reviewers bind every operation to the
receipt-selected `{planFile, planHash}`, compile the deterministic section index, and inspect the
PLAN's Review Surfaces for the Markdown, DOCX, Typst/TeX, and rendered artifacts the user will
inspect. The returned result records concrete surface evidence and proves freshness against the
same plan and indexed outline/draft deliverable bytes.

Automated findings are normalized and reconciled into TaskList with `planHash`, stable retry
identity, location/review area, affected section/claim IDs, severity, evidence, and disposition.
The workflow returns the structured result to the human review surface. It does not create a
mutable review ledger; visible automated or human review files cannot be authority in a canonical
writing episode.
