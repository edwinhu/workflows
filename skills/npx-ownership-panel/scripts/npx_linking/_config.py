"""Locate the linking chain's inputs and its tuning constants.

VENDORED, NOT REIMPLEMENTED. This package is a copy of mirror's
`scripts/linking/` — the implementation that produced the frozen
`npx_crsp_link` baseline. It replaced a second, flattened single-file linker
that shared ZERO function names with it: not drift, a reimplementation of the
same ladder. Two rival linkers producing the crosswalk that decides every
fund's block is the one duplication worth paying to remove.

`config_obs.py` is vendored alongside for the same reason. The chain reads 26
symbols from it — 15 paths/scalars and 11 L2_/L3B_ tuning constants (TF-IDF
n-gram range, candidate threshold, the legal-suffix and "formerly" regexes,
family stopwords, the succession share bar). Those constants ARE the matching
behaviour, so re-declaring them here would fork the ladder's semantics while
looking like configuration. One copy, taken as a unit.

Upstream is mirror `scripts/linking/`. When syncing, take the whole directory
plus `config_obs.py` together — a partial sync is how the two drifted apart the
first time.

PATHS. mirror runs this inside its own tree, where `parents[2]` is the project
root. Standalone it is not, so the root is overridable:

    NPX_LINK_ROOT=/path/to/project python -m npx_linking run
"""
import os
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent

# In mirror the package sits at <root>/scripts/linking, so the root is two up.
# Standalone it sits wherever it was copied, so honour the env var first.
_env = os.environ.get("NPX_LINK_ROOT")
PROJ = Path(_env).resolve() if _env else _HERE.parents[1]

CIT_DIR = PROJ / "scripts" / "cit"
LINKING_DIR = _HERE

# Prefer the project's own config_obs when running inside mirror, so mirror
# stays the single upstream and this copy cannot silently diverge from it in
# the place it matters most. Fall back to the vendored copy when standalone.
if CIT_DIR.is_dir() and str(CIT_DIR) not in sys.path:
    sys.path.insert(0, str(CIT_DIR))
if str(_HERE) not in sys.path:
    sys.path.append(str(_HERE))

import config_obs as cfg  # noqa: E402

__all__ = ["PROJ", "CIT_DIR", "LINKING_DIR", "cfg"]
