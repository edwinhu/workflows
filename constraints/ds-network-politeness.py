#!/usr/bin/env -S uv run python3
"""Constraint: ds-network-politeness — a concurrent network client states its computed rate."""
import re
import sys
from pathlib import Path

CONSTRAINT = "ds-network-politeness"
APPLIES_TO = ["ds-delegate"]
SEVERITY = "hard"

# A pool/gather that could carry outbound requests.
CONCURRENCY = re.compile(
    r"ThreadPoolExecutor\s*\(|ProcessPoolExecutor\s*\(|asyncio\.gather\s*\(|"
    r"asyncio\.Semaphore\s*\(|CONCURRENT_REQUESTS|n_conn\s*=|limit_per_host\s*="
)
# Something in the file actually goes out to the network.
NETWORK = re.compile(
    r"requests\.(get|post|request|Session)|httpx\.|aiohttp\.|urllib\.request|"
    r"urlopen\s*\(|session\.get\s*\(|session\.post\s*\(|curl_cffi"
)
# The three facts E7 requires, each recognisable without judgement.
RATE = re.compile(r"EFFECTIVE_RPS|EFFECTIVE_RATE|REQUESTS_PER_SECOND|RPS\b")
CEILING = re.compile(r"(?i)documented ceiling|published (?:ceiling|limit)|no documented ceiling")
FAILURE_MODE = re.compile(r"(?i)\b(quota|rate limit|rate-limit)\b")


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []

    py_files = [
        p for p in cwd.rglob("*.py")
        if not any(part in p.parts for part in [".planning", "scratch", "__pycache__", ".pixi"])
        and "constraints" not in str(p)
    ]

    for path in py_files:
        try:
            source = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue

        if not (CONCURRENCY.search(source) and NETWORK.search(source)):
            continue

        rel = path.relative_to(cwd)
        line = next(
            (i for i, ln in enumerate(source.splitlines(), 1) if CONCURRENCY.search(ln)), 1
        )

        if not RATE.search(source):
            violations.append(
                f"{rel}:{line}: concurrent network client with no computed effective request "
                "rate — define EFFECTIVE_RPS = workers / sleep_seconds"
            )
        if not CEILING.search(source):
            violations.append(
                f"{rel}:{line}: no documented ceiling cited for the target — name the ceiling "
                "and its source URL, or state that none is published and hold at 1 req/s"
            )
        if not FAILURE_MODE.search(source):
            violations.append(
                f"{rel}:{line}: neither 'quota' nor 'rate limit' named — concurrency helps one "
                "and hurts the other, so the code must say which it faces"
            )

    return violations


if __name__ == "__main__":
    violations = check({"cwd": sys.argv[1] if len(sys.argv) > 1 else "."})
    if violations:
        for v in violations:
            print(f"FAIL: {v}")
        sys.exit(1)
    print(f"PASS: {CONSTRAINT}")
