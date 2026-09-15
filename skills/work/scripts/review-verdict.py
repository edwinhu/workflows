#!/usr/bin/env python3
"""The review gate's verdict rule, in one place so the gate and its tests share it.

Extracted from human-review-gate.sh rather than copied: a hand-copied predicate drifts the moment
one sibling gains a guard the other lacks, and a test over a copy proves the copy works.

Approval must be expressible in words. The gate matched \\bREJECT\\b and had no counterpart while
ANY comment forced `findings`, so a reviewer could reject in one word but could not approve in any
number of them — measured on a live episode where "looks good to me, ship" and "all good" both read
as outstanding work and left the run unable to close.

REJECT keeps precedence over APPROVE: reading a rejection as approval costs an unreviewed change,
reading an approval as a rejection costs one more review.
"""
import re

# Anchored, case-sensitive, whole-word: a shouted token, never prose. "approve" in a sentence is
# discussion; APPROVE on its own is a decision. Same discipline the REJECT token already had.
REJECT_RE = re.compile(r"\bREJECT\b")
APPROVE_RE = re.compile(r"\b(?:APPROVE|APPROVED|LGTM)\b")


def verdict(comments, reviewed_count, changes_requested=False):
    """comments: [{content, ...}] already filtered to human authors created after launch."""
    bodies = [c.get("content") or "" for c in comments]
    if changes_requested or any(REJECT_RE.search(b) for b in bodies):
        return "rejected"
    if any(APPROVE_RE.search(b) for b in bodies):
        return "approved"
    if comments:
        return "findings"
    if reviewed_count > 0:
        return "approved"
    return "unreviewed"
