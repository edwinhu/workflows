#!/usr/bin/env python3
"""Wrap the commands in a runbook's ```command fences to a fixed width.

    wrap_commands.py [--width N] SOURCE.md > WRAPPED.md

A logical command (physical lines joined at a trailing ` \\`) that has a line
wider than N characters (default 80) is re-broken before flags only, each
broken line ending in ` \\` and continuation lines indented two spaces. A token
is never split, and quoted strings and `#` comments are single tokens. A
command whose lines all fit is left exactly as written.

Exit 1 when a run of tokens between two flags is itself too wide to fit: the
PDF would soft-wrap it mid-token, so the source must be shortened instead.
Exit 2 on a usage error.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

INFO = "command"
INDENT = "  "
CONT = " \\"
FENCE = re.compile(r"^(?P<indent>[ \t]*)(?P<fence>`{3,}|~{3,})(?P<info>.*)$")
FLAG = re.compile(r"--?[A-Za-z]")


class WrapError(ValueError):
    pass


def tokens(cmd: str) -> list[str]:
    out: list[str] = []
    cur: list[str] = []
    quote = None
    i = 0
    while i < len(cmd):
        c = cmd[i]
        if quote:
            cur.append(c)
            if c == "\\" and quote == '"' and i + 1 < len(cmd):
                cur.append(cmd[i + 1])
                i += 1
            elif c == quote:
                quote = None
        elif c in " \t":
            if cur:
                out.append("".join(cur))
                cur = []
        elif c == "#" and not cur:
            out.append(cmd[i:].rstrip())
            return out
        else:
            cur.append(c)
            if c == "\\" and i + 1 < len(cmd):
                cur.append(cmd[i + 1])
                i += 1
            elif c in "'\"":
                quote = c
        i += 1
    if cur:
        out.append("".join(cur))
    return out


def segments(cmd: str) -> list[str]:
    segs: list[list[str]] = []
    for tok in tokens(cmd):
        if not segs or FLAG.match(tok):
            segs.append([tok])
        else:
            segs[-1].append(tok)
    return [" ".join(s) for s in segs]


def wrap_command(cmd: str, width: int, lead: str = "") -> list[str]:
    """Break one logical command into lines of at most `width` characters."""
    segs = segments(cmd)
    if not segs:
        return [lead.rstrip()]
    lines: list[str] = []
    cur = lead + segs[0]
    for n, seg in enumerate(segs[1:], start=2):
        cand = f"{cur} {seg}"
        limit = width if n == len(segs) else width - len(CONT)
        if len(cand) <= limit:
            cur = cand
        else:
            lines.append(cur)
            cur = lead + INDENT + seg
    lines.append(cur)
    for k, line in enumerate(lines):
        last = k == len(lines) - 1
        if len(line) + (0 if last else len(CONT)) > width:
            raise WrapError(
                f"cannot wrap to {width} columns without splitting a token; "
                f"shorten this part of the command: {line.strip()!r}"
            )
    return [line + CONT for line in lines[:-1]] + [lines[-1]]


def continues(line: str) -> bool:
    s = line.rstrip()
    return s == "\\" or s.endswith(CONT) or s.endswith("\t\\")


def wrap_block(body: list[str], width: int, base: str) -> list[str]:
    """Rewrap the content lines of one command fence; `base` is the fence's indent."""
    def visible(line: str) -> str:
        return line[len(base):] if line.startswith(base) else line.lstrip(" \t")

    out: list[str] = []
    i = 0
    while i < len(body):
        group = [body[i]]
        while continues(group[-1]) and i + 1 < len(body):
            i += 1
            group.append(body[i])
        i += 1
        if all(len(visible(line)) <= width for line in group):
            out.extend(group)
            continue
        first = visible(group[0])
        lead = first[: len(first) - len(first.lstrip(" \t"))]
        parts = [g.rstrip()[:-1].strip() if continues(g) else g.strip() for g in group]
        logical = " ".join(p for p in parts if p)
        out.extend(base + line for line in wrap_command(logical, width, lead))
    return out


def wrap_markdown(text: str, width: int = 80) -> str:
    lines = text.splitlines()
    out: list[str] = []
    i = 0
    while i < len(lines):
        m = FENCE.match(lines[i])
        if not m or (m["fence"][0] == "`" and "`" in m["info"]):
            out.append(lines[i])
            i += 1
            continue
        fence = m["fence"]
        close = re.compile(rf"^[ \t]*{re.escape(fence[0])}{{{len(fence)},}}[ \t]*$")
        j = i + 1
        while j < len(lines) and not close.match(lines[j]):
            j += 1
        body = lines[i + 1 : j]
        if m["info"].strip() == INFO:
            body = wrap_block(body, width, m["indent"])
        out.append(lines[i])
        out.extend(body)
        if j < len(lines):
            out.append(lines[j])
        i = j + 1
    return "\n".join(out) + ("\n" if text.endswith("\n") else "")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Wrap ```command fences to a fixed width.")
    ap.add_argument("--width", type=int, default=80)
    ap.add_argument("source", type=Path)
    args = ap.parse_args(argv)
    if args.width < 20:
        print("wrap_commands.py: --width must be at least 20", file=sys.stderr)
        return 2
    if not args.source.is_file():
        print(f"wrap_commands.py: no such file: {args.source}", file=sys.stderr)
        return 2
    try:
        sys.stdout.write(wrap_markdown(args.source.read_text(encoding="utf-8"), args.width))
    except WrapError as e:
        print(f"wrap_commands.py: {args.source}: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
