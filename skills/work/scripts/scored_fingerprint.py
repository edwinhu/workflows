#!/usr/bin/env python3
"""scored_fingerprint.py — the input fingerprint behind scoredChecks carry-forward.

  scored_fingerprint.py ARGS     write args["scoredFingerprints"] {"<key>::<item text>": sha256 | null}

A job's fingerprint is sha256 over its check's definition (everything but `items`, plus the bytes of
every `refs` file), the item text, and the bytes of each `inputs` path. Any unreadable input or ref
makes it null, and workflow.js never carries a null: unknown bytes are re-audited. String items have
no inputs and get no entry. dispatch, redispatch and work-checks.sh all call fingerprints(), because
workflow.js has no fs and a second implementation would drift.
"""
import hashlib
import json
import os
import sys

MAX_FILES = 5000


def _canon(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(path, cwd):
    """sha256 of a file, or of a directory's files by relative path; None when unreadable."""
    full = path if os.path.isabs(path) else os.path.join(cwd, path)
    try:
        if os.path.isdir(full):
            parts, walked = [], 0
            for root, dirs, names in os.walk(full):
                dirs[:] = sorted(d for d in dirs if d != ".git")
                for n in sorted(names):
                    walked += 1
                    if walked > MAX_FILES:
                        return None
                    p = os.path.join(root, n)
                    with open(p, "rb") as fh:
                        parts.append([os.path.relpath(p, full), _sha(fh.read())])
            return _sha(_canon(parts).encode())
        with open(full, "rb") as fh:
            return _sha(fh.read())
    except OSError:
        return None


def fingerprints(args):
    cwd = args.get("projectDir") or os.getcwd()
    out = {}
    for check in args.get("scoredChecks") or []:
        if not isinstance(check, dict):
            continue
        refs = {}
        for r in check.get("refs") or []:
            refs[str(r)] = digest(str(r), cwd)
        definition = _sha(_canon({"def": {k: v for k, v in check.items() if k != "items"}, "refs": refs}).encode())
        refs_ok = all(v is not None for v in refs.values())
        for item in check.get("items") or []:
            if not isinstance(item, dict):
                continue
            text, inputs = item.get("text"), item.get("inputs") or []
            digs = {str(p): digest(str(p), cwd) for p in inputs}
            ok = refs_ok and inputs and all(v is not None for v in digs.values())
            out[f"{check.get('key')}::{text}"] = _sha(_canon([definition, text, sorted(digs.items())]).encode()) if ok else None
    return out


def main(argv):
    if len(argv) != 2:
        sys.exit("usage: scored_fingerprint.py ARGS")
    path = argv[1]
    try:
        with open(path) as fh:
            args = json.load(fh)
    except (OSError, json.JSONDecodeError) as exc:
        sys.exit(f"scored-fingerprints: cannot read {path} ({exc})")
    fps = fingerprints(args)
    args.pop("scoredFingerprints", None)
    if fps:
        args["scoredFingerprints"] = fps
    with open(path, "w") as fh:
        json.dump(args, fh, indent=2)
        fh.write("\n")
    if not fps:
        return
    prior = {(s.get("key"), s.get("item")): s for s in ((args.get("priorResults") or {}).get("scores") or []) if isinstance(s, dict)}
    eligible = sum(
        1 for k, v in fps.items()
        if v and (lambda s: s and s.get("fingerprint") == v and isinstance(s.get("composite"), (int, float)))(prior.get(tuple(k.split("::", 1))))
    )
    print(f"  scored-fingerprints: {len(fps)} object-form job(s), {sum(1 for v in fps.values() if v)} fingerprinted, "
          f"{eligible} carry-eligible from the previous round (an input a task may write is re-audited anyway)")


if __name__ == "__main__":
    main(sys.argv)
