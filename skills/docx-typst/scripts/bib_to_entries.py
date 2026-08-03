#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# ///
"""Generate bluebook.typ's `entries` module from a BibTeX file.

    bib_to_entries.py --bib sources.bib --csl bluebook.csl -o cite-data.typ
    bib_to_entries.py --bib sources.bib --csl bluebook.csl --diff cite-data.typ

Without this, every cite key needs its Bluebook form typed by hand, so a .bib
of 117 entries yields a manuscript that can only reach the few already
transcribed. This closes that gap: the .bib becomes the source again.

WHY IT SHELLS OUT TO CITEPROC INSTEAD OF PARSING BibTeX

Because the output has to match what is already on the page. A hand-written
BibTeX -> Bluebook renderer would have to reproduce citeproc's output byte for
byte, quirks included -- `Lucian A Bebchuk` without the period, `.;` between
adjacent groups -- and every place it normalized instead would silently reword
a live citation nobody asked it to touch.

So it does not imitate citeproc. It RUNS citeproc, with the same CSL style the
docx path already uses. The quirks arrive by construction rather than by
reverse engineering, and the failure mode is a loud pandoc error rather than a
quietly different citation.

The one thing citeproc cannot supply is `supra note N` -- the note number is
assigned during typst's layout, long after citeproc has run. That is exactly
the division of labor bluebook.typ exists for: this script supplies the strings,
the renderer supplies the number. The short form itself IS taken from citeproc,
by citing every key a second time and reading back the author-short it chose,
rather than guessing at one.

NEVER AUTO-APPLY

`--diff` is the intended entry point for a manuscript that already has citation
data. It prints deltas and exits non-zero; it does not write. Regenerating on
top of live data is how a citation gets reworded without anyone reading it.
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
import tempfile
from pathlib import Path

# Rule 15: a book's pincite follows the title with no comma. Everything else
# -- Rule 3.2 cases, articles, statutes -- takes a comma after the first page.
BOOKISH = {"BOOK", "INBOOK", "INCOLLECTION"}

DATE_RE = re.compile(r" \(\d{4}\)")
ENTRY_RE = re.compile(r"^@(\w+)\{([^,\s]+)\s*,", re.MULTILINE)
LINE_RE = re.compile(r"^(FULL|SHORT)::([^:]+)::#footnote\[(.*)\]$")
SUPRA_RE = re.compile(r"^(?P<short>.*?),?\s*#emph\[supra\]\s*note\s*\d+", re.DOTALL)
MISSING_RE = re.compile(r"#strong\[([^\]]*)\?\];")


def bib_entries(bib: Path) -> dict[str, str]:
    """key -> uppercased entry type, in file order. @Comment is not an entry."""
    return {
        m.group(2): m.group(1).upper()
        for m in ENTRY_RE.finditer(bib.read_text(encoding="utf-8"))
        if m.group(1).upper() != "COMMENT"
    }


def render(bib: Path, csl: Path, keys: list[str]) -> dict[str, dict[str, str]]:
    """Run citeproc once over every key, twice each.

    Round 1 gives the full first reference. Round 2 -- separated from round 1 by
    every other key, so citeproc reaches for `supra` rather than `Id.` -- gives
    the author-short. One pandoc invocation, so both rounds share a citation
    state and the short form is the one citeproc would really have used.
    """
    doc = [f"FULL::{k}::[@{k}]\n" for k in keys]
    doc += [f"SHORT::{k}::[@{k}]\n" for k in keys]
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "probe.md"
        src.write_text("\n".join(doc), encoding="utf-8")
        proc = subprocess.run(
            ["pandoc", str(src), "--citeproc", f"--bibliography={bib}",
             f"--csl={csl}", "-t", "typst", "--wrap=none"],
            capture_output=True, text=True, check=False,
        )
    if proc.returncode != 0:
        sys.exit(f"error: pandoc failed:\n{proc.stderr.strip()}")
    for warn in (w for w in proc.stderr.splitlines() if "not found" in w):
        print(f"warning: {warn.strip()}", file=sys.stderr)

    out: dict[str, dict[str, str]] = {}
    for line in proc.stdout.splitlines():
        m = LINE_RE.match(line)
        if not m:
            continue
        kind, key, body = m.group(1), m.group(2), m.group(3)
        out.setdefault(key, {})[kind] = body
    return out


def strip_terminal_period(s: str) -> str:
    """Drop the sentence period the CSL note style appends.

    Only the final character, and only when it is a bare period -- `Id.` and
    `L. Rev.` end in periods that belong to the citation.
    """
    return s.removesuffix(".")


def split_date(full: str) -> tuple[str, str]:
    """Split at the LAST bare `(YYYY)`.

    Everything from there on is the date parenthetical plus whatever trails it
    -- a URL, a `last visited` note. A pincite goes in the seam. Entries with no
    such parenthetical get `date: ""` and take the pin at the end.
    """
    hits = list(DATE_RE.finditer(full))
    if not hits:
        return full, ""
    return full[: hits[-1].start()], full[hits[-1].start() :]


def short_of(rendered: str | None) -> str | None:
    if rendered is None:
        return None
    m = SUPRA_RE.match(strip_terminal_period(rendered))
    return m.group("short").strip() if m else None


def typ_str(s: str) -> str:
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build(bib: Path, csl: Path, only: list[str] | None) -> dict[str, dict]:
    types = bib_entries(bib)
    keys = [k for k in types if only is None or k in only]
    if only:
        for k in only:
            if k not in types:
                print(f"warning: key not in {bib.name}: {k}", file=sys.stderr)
    rendered = render(bib, csl, keys)

    entries: dict[str, dict] = {}
    for k in keys:
        got = rendered.get(k)
        if not got or "FULL" not in got:
            print(f"warning: no rendering for {k}", file=sys.stderr)
            continue
        full = strip_terminal_period(got["FULL"])
        if MISSING_RE.search(full):
            print(f"warning: {k} unresolved by citeproc; skipped", file=sys.stderr)
            continue
        head, date = split_date(full)
        entries[k] = {
            "full": head,
            "date": date,
            "pin-sep": " " if types[k] in BOOKISH else ", ",
            "short": short_of(got.get("SHORT")),
        }
    return entries


def emit(entries: dict[str, dict], bib_name: str) -> str:
    out = [
        (
        f"// GENERATED by bib_to_entries.py from {bib_name} -- do not hand-edit.\n"
        "//\n"
        "// Per cite key: the entry-level first reference split at the date\n"
        "// parenthetical, so a site's pincite lands between them, and the\n"
        "// author-short citeproc used in `X, supra note N`.\n"
        "//\n"
        "// Values are typst SOURCE strings, not content, so the same data can be\n"
        "// eval()'d for the PDF and spliced as markup into the docx build.\n"
        "\n"
        "#let entries = (\n"
        )
    ]
    for k in sorted(entries):
        e = entries[k]
        out.append(f'  "{k}": (\n')
        out.append(f"    full: {typ_str(e['full'])},\n")
        out.append(f"    date: {typ_str(e['date'])},\n")
        if e["pin-sep"] != ", ":
            out.append(f"    pin-sep: {typ_str(e['pin-sep'])},\n")
        short = typ_str(e["short"]) if e["short"] else "none"
        out.append(f"    short: {short},\n")
        out.append("  ),\n")
    out.append(")\n")
    return "".join(out)


def parse_existing(path: Path) -> dict[str, dict]:
    text = path.read_text(encoding="utf-8")
    body = text.partition("#let entries = (\n")[2]
    found: dict[str, dict] = {}
    for m in re.finditer(r'^  "([^"]+)": \(\n((?:    .*\n)+)  \),$', body, re.MULTILINE):
        fields = dict(re.findall(r"^    ([\w-]+): (.*),$", m.group(2), re.MULTILINE))
        found[m.group(1)] = {
            f: (None if v == "none" else v[1:-1].replace('\\"', '"').replace("\\\\", "\\"))
            for f, v in fields.items()
        }
    return found


def diff(entries: dict[str, dict], existing: Path) -> int:
    old = parse_existing(existing)
    added = sorted(set(entries) - set(old))
    dropped = sorted(set(old) - set(entries))
    changed = []
    for k in sorted(set(entries) & set(old)):
        for f in ("full", "date", "pin-sep", "short"):
            want = entries[k][f]
            want = None if f == "short" and not want else want
            have = old[k].get(f, ", " if f == "pin-sep" else "")
            if (want or "") != (have or ""):
                changed.append((k, f, have, want))

    print(f"{existing}: {len(old)} entries; generated {len(entries)}")
    if added:
        print(f"\nNEW -- reachable only after applying ({len(added)}):")
        for k in added:
            print(f"  + {k}")
    if dropped:
        print(f"\nIN DATA BUT NOT GENERATED ({len(dropped)}):")
        for k in dropped:
            print(f"  - {k}")
    if changed:
        print(f"\nCHANGED -- review every one before applying ({len(changed)}):")
        for k, f, have, want in changed:
            print(f"\n  [{k}] {f}\n    have: {have!r}\n    want: {want!r}")
    if not (added or dropped or changed):
        print("\nno deltas.")
        return 0
    print("\nNothing was written. Apply by hand, or with -o to a scratch file first.")
    return 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--bib", type=Path, required=True)
    ap.add_argument("--csl", type=Path, required=True)
    ap.add_argument("--keys", nargs="*", help="limit to these keys (default: all)")
    ap.add_argument("-o", "--out", type=Path, help="write the module here")
    ap.add_argument("--diff", type=Path, metavar="CITE_DATA",
                    help="compare against existing data; never writes")
    args = ap.parse_args()

    for p in (args.bib, args.csl):
        if not p.exists():
            sys.exit(f"error: no such file: {p}")

    entries = build(args.bib, args.csl, args.keys)
    if not entries:
        sys.exit("error: citeproc rendered nothing")

    if args.diff:
        return diff(entries, args.diff)

    text = emit(entries, args.bib.name)
    if args.out:
        args.out.write_text(text, encoding="utf-8")
        print(f"wrote {args.out} ({len(entries)} entries)")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
