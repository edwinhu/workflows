#!/usr/bin/env python3
"""Did the user approve THIS plan? Exit 0 yes, 1 no.

    plan-approved.py <abs plan path> <transcript.jsonl>

The receipt is an ExitPlanMode tool_use whose planFilePath is the plan, answered by a tool_result that
is not an error. A rejected ExitPlanMode returns is_error; a plan that was only written has no
ExitPlanMode at all. A session re-seeded by approval ("Implement the following plan:") names the
transcript it was cleared from, so that one is read too — one hop, never a chain.

Called by work-pending.sh only after the plan is known to be armed and undispatched, so the cost of
reading a transcript is paid on the rare positive path, never per ordinary Edit.
"""
import json
import re
import sys

REF = re.compile(r"read the full transcript at: (\S+?\.jsonl)")


def scan(path, plan):
    """(approved, referenced transcripts)."""
    uses, refs = set(), []
    try:
        lines = open(path, encoding="utf-8", errors="replace")  # noqa: SIM115 — closed by the with below
    except OSError:
        return False, refs
    with lines:
        for line in lines:
            if "Implement the following plan" in line:
                refs += REF.findall(line)
            if "ExitPlanMode" not in line and not any(u in line for u in uses):
                continue
            try:
                d = json.loads(line)
            except ValueError:
                continue
            content = (d.get("message") or {}).get("content")
            if not isinstance(content, list):
                continue
            for b in content:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use" and b.get("name") == "ExitPlanMode":
                    if (b.get("input") or {}).get("planFilePath") == plan:
                        uses.add(b.get("id"))
                elif b.get("type") == "tool_result" and b.get("tool_use_id") in uses and not b.get("is_error"):
                    return True, refs
    return False, refs


def main():
    plan, transcript = sys.argv[1], sys.argv[2]
    ok, refs = scan(transcript, plan)
    if ok:
        return 0
    for r in refs:
        if r != transcript and scan(r, plan)[0]:
            return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
