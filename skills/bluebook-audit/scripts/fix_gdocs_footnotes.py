#!/usr/bin/env python3
"""DEPRECATED shim → forwards to the canonical docx-repair footnote fixer.

This was an older near-duplicate of what is now
``skills/docx-repair/scripts/fix_footnotes.py`` — the hardened, canonical
Google-Docs / Word-Online footnote repair. The canonical script is a strict
superset of this one's CLI and additionally:

  * restores author-bio custom marks (*, †, ‡) in the Google-Docs case where the
    symbol run was deleted and the literal mark welded onto adjacent text
    (no more doubled **, ††),
  * supports ``--template`` (restore stripped FNStyleBest definitions) and
    ``--fix-numbering``.

To avoid two diverging copies of the same footnote-repair logic, this file no
longer carries an implementation — it forwards every argument to the canonical
script. Update callers to invoke ``docx-repair/scripts/fix_footnotes.py``
directly; this shim only exists so any lingering reference keeps working.

(Note: the cross-reference tooling in this skill — ``create_crossrefs.py`` +
``audit_crossref_targets.py`` — is a DELIBERATE, actively-used fork with its own
grep/LLM retargeting strategy, NOT a duplicate, and is intentionally left alone.)
"""

import os
import sys
from pathlib import Path

CANONICAL = (
    Path(__file__).resolve().parent.parent.parent
    / "docx-repair" / "scripts" / "fix_footnotes.py"
)


def main():
    if not CANONICAL.exists():
        sys.exit(
            f"fix_gdocs_footnotes.py is deprecated and the canonical script was "
            f"not found at {CANONICAL}. Run docx-repair/scripts/fix_footnotes.py."
        )
    sys.stderr.write(
        "[deprecated] fix_gdocs_footnotes.py forwards to the canonical "
        "docx-repair/scripts/fix_footnotes.py — update your call to use it "
        "directly.\n"
    )
    # `uv run` lets the canonical script resolve its own PEP 723 deps (lxml).
    os.execvp("uv", ["uv", "run", str(CANONICAL), *sys.argv[1:]])


if __name__ == "__main__":
    main()
