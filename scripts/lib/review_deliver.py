#!/usr/bin/env python3
"""Deliver a deck's review copies to the Obsidian vault for the tablet, and tick the round's to-do when it closes.

    review_deliver.py deliver --name NAME --slides SLIDES.pdf [--notes NOTES.pdf] [--label LABEL] [--item ITEM]
                              [--vault-root DIR] [--vault-dir DIR] [--daily-dir DIR] [--date YYYYMMDD]
                              [--cap-bytes N]
    review_deliver.py tick    --file FILE_NAME [--note NOTE.md] [--vault-root DIR] [--daily-dir DIR]

Launched by bin/review-deliver, which supplies pymupdf. The semantics are teaching's review.py deliver and
tick, with `<NAME>` for `Lecture <LL>`, --label for `<Course> L<LL>` and a given slides PDF for a cut.

deliver copies SLIDES, and NOTES when given, into --vault-dir (default <vault-root>/Inbox/Reading/<NAME>
Review; it must sit inside --vault-root, since the Xodo links are vault-relative) as

    <NAME> slides review <YYYYMMDD><letter>.pdf        <NAME> notes review <YYYYMMDD><letter>.pdf

`<letter>` is the one after the highest used by a `<NAME> (slides|notes) review <YYYYMMDD>[letter].pdf` file
in that folder (a bare date counts as `a`; `z` used refuses). Nothing else records a round: the letter is
derived from file names. Each copy is created exclusively, so an existing name refuses and nothing is
written. --cap-bytes (default 5,000,000, the Obsidian Sync Standard per-file cap): a slides copy over it gets
one lossless re-save (garbage=4, deflate, object streams); still over, or a notes copy over (copied
byte-for-byte, never re-saved), refuses OVER CAP and nothing is delivered. Then the daily note
<daily-dir>/<YYYY-MM-DD>.md for --date (default today; --daily-dir default <vault-root>/Resources/Daily
Notes), created from <vault-root>/Resources/Templates/Daily Note.md when absent, gets one line

    - [ ] <LABEL> <item lowercased>: [[<slides file>]] · [Xodo](tasker://assistantactions?task=XodoOpen&par1=<path>) · [[<notes file>]] · [Xodo](...)

after the last non-blank line of its `# 💼 Work` section (directly under the heading when the section is
empty; the section runs to the next `# ` line or EOF). <path> is the copy's vault-relative path URL-quoted
with no safe characters. The daily note is the only tracker: no other markdown file is read or written.
Checked before any write: the daily note or its template exists and has the `# 💼 Work` heading,
--vault-dir is inside --vault-root, the PDFs exist, the names are free and every copy fits the cap. stdout

    {"slides_file", "slides_bytes", "resaved", "notes_file", "notes_bytes", "cap_bytes", "daily_note", "todo_line"}

with the notes fields null without --notes.

tick turns the one checkbox line naming FILE_NAME, across every *.md in --daily-dir or only --note, into
`- [x]` with ` ✅ <today>` appended. stdout {"result": "ticked: <line>"}, or "already ticked: <line>" when it
was.

Exit, every subcommand: 0 done · 1 a refusal the caller must act on (a copy would be overwritten, every
letter used, OVER CAP, no checkbox item or several name the file) · 2 could not run (bad or missing
arguments, a missing PDF, note, daily-notes dir or template, no `# 💼 Work` heading, a --vault-dir outside
--vault-root).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import string
import sys
import tempfile
import urllib.parse
from pathlib import Path

PROG = "review-deliver"
CAP_BYTES = 5_000_000  # Obsidian Sync Standard per-file limit
WORK_HEADING = "# 💼 Work"
XODO = "tasker://assistantactions?task=XodoOpen&par1="
TEMPLATE = Path("Resources") / "Templates" / "Daily Note.md"
DAILY_DIR = Path("Resources") / "Daily Notes"
CONTROL = re.compile(r"[\x00-\x1f\x7f]")


class Refusal(Exception):
    """Exit 1: the caller must act."""


class CouldNotRun(Exception):
    """Exit 2."""


def pymupdf():
    try:
        import pymupdf as m
    except ImportError as e:
        raise CouldNotRun("pymupdf is not importable; launch through bin/review-deliver") from e
    m.set_messages(stream=sys.stderr)  # MuPDF reports a damaged PDF's errors on stdout by default; stdout is the JSON
    return m


# ── delivery ──────────────────────────────────────────────────────────────────

def next_letter(vault: Path, name: str, date: str) -> str:
    """The letter after the highest one used by a file name in the vault folder."""
    pat = re.compile(rf"^{re.escape(name)} (?:slides|notes) review {date}([a-z]?)\.pdf$")
    names = [p.name for p in (vault.iterdir() if vault.is_dir() else [])]
    used = [m.group(1) or "a" for n in names if (m := pat.match(n))]
    if not used:
        return "a"
    top = max(used)
    if top == "z":
        raise Refusal(f"every letter a-z is used for {name} on {date}")
    return string.ascii_lowercase[string.ascii_lowercase.index(top) + 1]


def enforce_cap(path: Path, cap: int, resave: bool) -> dict:
    size = path.stat().st_size
    if size <= cap:
        return {"bytes": size, "resaved": False}
    if resave:
        m = pymupdf()
        tmp = path.with_suffix(".resave.pdf")
        doc = m.open(path)
        doc.save(tmp, garbage=4, deflate=True, deflate_images=True, deflate_fonts=True, use_objstms=1)
        doc.close()
        tmp.replace(path)
        new = path.stat().st_size
        if new <= cap:
            return {"bytes": new, "resaved": True, "bytes_before": size}
        raise Refusal(f"OVER CAP: {path.name} is {new:,} bytes after a lossless re-save ({size:,} before); "
                      f"the Obsidian Sync per-file cap is {cap:,}. Split the deck or shrink its images")
    raise Refusal(f"OVER CAP: {path.name} is {size:,} bytes; the Obsidian Sync per-file cap is {cap:,}")


def write_new(dest: Path, data: bytes) -> None:
    try:
        with open(dest, "xb") as f:
            f.write(data)
    except FileExistsError:
        raise Refusal(f"REFUSED: {dest} exists; a review copy is never overwritten (it may carry ink)") from None


def xodo_link(vault_root: Path, path: Path) -> str:
    try:
        rel = path.resolve().relative_to(vault_root.resolve())
    except ValueError:
        raise CouldNotRun(f"{path} is not inside --vault-root {vault_root}; the Xodo link is vault-relative") from None
    return f"[Xodo]({XODO}{urllib.parse.quote(rel.as_posix(), safe='')})"


def todo_line(label: str, item: str, vault_root: Path, files: list[Path]) -> str:
    parts = [part for f in files for part in (f"[[{f.name}]]", xodo_link(vault_root, f))]
    return f"- [ ] {label} {item.lower()}: " + " · ".join(parts)


def with_todo(text: str, line: str) -> str:
    """`text` with `line` after the last non-blank line of the `# 💼 Work` section (directly under the heading when empty)."""
    lines = text.split("\n")
    at = next((i for i, l in enumerate(lines) if l.rstrip() == WORK_HEADING), None)
    if at is None:
        raise CouldNotRun(f"daily note has no `{WORK_HEADING}` heading to hold the to-do")
    end = next((i for i in range(at + 1, len(lines)) if lines[i].startswith("# ")), len(lines))
    last = max((i for i in range(at + 1, end) if lines[i].strip()), default=at)
    lines.insert(last + 1, line)
    out = "\n".join(lines)
    return out if out.endswith("\n") else out + "\n"


def daily_note_text(daily: Path, template: Path) -> str:
    if daily.is_file():
        return daily.read_text(encoding="utf-8")
    if not template.is_file():
        raise CouldNotRun(f"daily note {daily} does not exist and the template {template} is missing")
    return template.read_text(encoding="utf-8")


def tick(name: str, today: str, note: Path | None, daily_dir: Path) -> str:
    if note is not None:
        if not note.is_file():
            raise CouldNotRun(f"--note {note}: no such file")
        files = [note]
    else:
        if not daily_dir.is_dir():
            raise CouldNotRun(f"--daily-dir {daily_dir}: no such directory")
        files = sorted(daily_dir.glob("*.md"))
    box = re.compile(r"^\s*- \[[ xX]\] ")
    hits = []
    for f in files:
        lines = f.read_text(encoding="utf-8").split("\n")
        hits += [(f, lines, i) for i, l in enumerate(lines) if box.match(l) and name in l]
    where = "in " + note.name if note is not None else f"in {daily_dir}"
    if not hits:
        raise Refusal(f"no checkbox item {where} names {name!r}")
    if len(hits) > 1:
        raise Refusal(f"{len(hits)} checkbox items {where} name {name!r} ({', '.join(f'{f.name}:{i + 1}' for f, _, i in hits)}); name the file exactly")
    f, lines, i = hits[0]
    if re.match(r"^\s*- \[[xX]\] ", lines[i]):
        return f"already ticked: {lines[i].strip()}"
    lines[i] = lines[i].replace("- [ ] ", "- [x] ", 1).rstrip() + f" ✅ {today}"
    f.write_text("\n".join(lines), encoding="utf-8")
    return f"ticked: {lines[i].strip()}"


# ── CLI ───────────────────────────────────────────────────────────────────────

def one_line(flag: str, value: str, file_name: bool = False) -> str:
    """`value`, refused when it would break the one to-do line or, for a file-name part, leave the vault folder."""
    if not value.strip() or CONTROL.search(value):
        raise CouldNotRun(f"{flag} {value!r}: expected non-empty text on one line")
    if file_name and any(sep and sep in value for sep in (os.sep, os.altsep)):
        raise CouldNotRun(f"{flag} {value!r}: it names files, so it cannot carry a path separator")
    return value


def vault_paths(a) -> tuple[Path, Path]:
    root = Path(a.vault_root).expanduser()
    return root, Path(a.daily_dir).expanduser() if a.daily_dir else root / DAILY_DIR


def cmd_deliver(a) -> dict:
    name = one_line("--name", a.name, file_name=True)
    label = one_line("--label", a.label if a.label is not None else name)
    item = one_line("--item", a.item)
    vault_root, daily_dir = vault_paths(a)
    vault = Path(a.vault_dir).expanduser() if a.vault_dir else vault_root / "Inbox" / "Reading" / f"{name} Review"
    date = a.date or dt.datetime.now().astimezone().strftime("%Y%m%d")
    if not re.fullmatch(r"\d{8}", date):
        raise CouldNotRun(f"--date {date!r}: expected YYYYMMDD")
    day = f"{date[:4]}-{date[4:6]}-{date[6:]}"
    daily = daily_dir / f"{day}.md"
    daily_text = daily_note_text(daily, vault_root / TEMPLATE)
    with_todo(daily_text, "")  # the `# 💼 Work` heading must exist; checked before anything is written
    xodo_link(vault_root, vault)  # the vault folder must sit inside the vault root; checked before anything is written
    slides_pdf = Path(a.slides).expanduser()
    notes_pdf = Path(a.notes).expanduser() if a.notes else None
    for flag, src in (("--slides", slides_pdf), ("--notes", notes_pdf)):
        if src is not None and not src.is_file():
            raise CouldNotRun(f"{flag} {src}: no such file")
    vault.mkdir(parents=True, exist_ok=True)
    letter = next_letter(vault, name, date)
    kinds = ("slides", "notes") if notes_pdf is not None else ("slides",)
    dest = {k: vault / f"{name} {k} review {date}{letter}.pdf" for k in kinds}
    for d in dest.values():
        if d.exists():
            raise Refusal(f"REFUSED: {d} exists; a review copy is never overwritten (it may carry ink)")
    ncap = None
    with tempfile.TemporaryDirectory() as tmp:
        copy = Path(tmp) / "slides.pdf"
        copy.write_bytes(slides_pdf.read_bytes())
        cap = enforce_cap(copy, a.cap_bytes, resave=True)
        if notes_pdf is not None:
            ncopy = Path(tmp) / "notes.pdf"
            ncopy.write_bytes(notes_pdf.read_bytes())
            ncap = enforce_cap(ncopy, a.cap_bytes, resave=False)
        write_new(dest["slides"], copy.read_bytes())
        if notes_pdf is not None:
            write_new(dest["notes"], ncopy.read_bytes())
    todo = todo_line(label, item, vault_root, list(dest.values()))
    daily.parent.mkdir(parents=True, exist_ok=True)
    daily.write_text(with_todo(daily_text, todo), encoding="utf-8")
    return {"slides_file": str(dest["slides"]), "slides_bytes": cap["bytes"], "resaved": cap["resaved"],
            "notes_file": str(dest["notes"]) if ncap else None, "notes_bytes": ncap["bytes"] if ncap else None,
            "cap_bytes": a.cap_bytes, "daily_note": str(daily), "todo_line": todo}


def cmd_tick(a) -> dict:
    _, daily_dir = vault_paths(a)
    today = dt.datetime.now().astimezone().strftime("%Y-%m-%d")
    return {"result": tick(a.file, today, Path(a.note).expanduser() if a.note else None, daily_dir)}


def parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog=PROG, description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def vault_args(p):
        p.add_argument("--vault-root", default="~/notes", help="the Obsidian vault root (default ~/notes)")
        p.add_argument("--daily-dir", help=f"daily notes folder (default: <vault-root>/{DAILY_DIR})")

    p = sub.add_parser("deliver", help="copy the slides (and notes) PDF to the vault, add a daily-note to-do")
    p.add_argument("--name", required=True, help='the deck name in file and folder names, e.g. "CELS talk"')
    p.add_argument("--slides", required=True, help="the slides PDF to deliver")
    p.add_argument("--notes", help="the notes PDF to deliver beside it, copied byte-for-byte")
    p.add_argument("--label", help="the to-do's lead text (default: --name)")
    p.add_argument("--item", default="Review copy", help='to-do label, lowercased in the line (default "Review copy")')
    vault_args(p)
    p.add_argument("--vault-dir", help="delivery folder, inside the vault root (default: <vault-root>/Inbox/Reading/<NAME> Review)")
    p.add_argument("--date", help="YYYYMMDD in the file name and the daily note's day (default: today)")
    p.add_argument("--cap-bytes", type=int, default=CAP_BYTES, help=f"per-file cap (default {CAP_BYTES:,})")

    p = sub.add_parser("tick", help="tick the checkbox item naming a file, with a done date")
    vault_args(p)
    p.add_argument("--note", help="the note holding the item (default: search every *.md in the daily-notes dir)")
    p.add_argument("--file", required=True, help="the file name the item links")
    return ap


def main(argv=None) -> int:
    ap = parser()
    if not (argv if argv is not None else sys.argv[1:]):
        ap.print_usage(sys.stderr)
        print(f"{PROG}: COULD-NOT-RUN: no subcommand named (deliver or tick)", file=sys.stderr)
        return 2
    a = ap.parse_args(argv)  # a bad or missing argument exits 2 itself, with usage
    try:
        res = {"deliver": cmd_deliver, "tick": cmd_tick}[a.cmd](a)
    except Refusal as e:
        print(f"{PROG}: {e}", file=sys.stderr)
        return 1
    except CouldNotRun as e:
        print(f"{PROG}: COULD-NOT-RUN: {e}", file=sys.stderr)
        return 2
    except Exception as e:  # noqa: BLE001 -- an uncaught crash exits 1, which every caller reads as a refusal
        print(f"{PROG}: COULD-NOT-RUN: {type(e).__name__}: {e}", file=sys.stderr)
        return 2
    print(json.dumps(res, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
