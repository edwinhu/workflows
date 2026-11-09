#!/usr/bin/env python3
"""SHA-256 of a writing plan, ignoring the `work:dispatch` block.

`work` arms a run by appending `<!-- work:dispatch {json} -->` to the plan file; hashing the raw
bytes would stale every outline `plan_hash:` the compiler wrote. A plan with no block hashes
identically to the raw sha256.

CLI: plan_hash.py <plan.md>   prints the hash; exit 2 on usage error.
"""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path

_DISPATCH = re.compile(rb"\n*<!--\s*work:dispatch\b.*?-->[ \t]*\n?", re.S)


def plan_hash(plan_bytes: bytes) -> str:
    stripped = _DISPATCH.sub(b"\n", plan_bytes)
    if stripped != plan_bytes and stripped.startswith(b"\n") and not plan_bytes.startswith(b"\n"):
        stripped = stripped[1:]
    return hashlib.sha256(stripped).hexdigest()


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        print("usage: plan_hash.py <plan.md>", file=sys.stderr)
        return 2
    print(plan_hash(Path(argv[0]).read_bytes()))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
