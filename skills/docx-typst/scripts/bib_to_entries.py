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
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from canonicalize import PandocError, require_pandoc

# A locator citeproc will place for us, so the seam does not have to be guessed.
# It MUST be numeric: the style treats a non-numeric locator as an appendage and
# renders it after the date -- `(2019), ZQPINQZ` -- while a numeric one goes
# where a page belongs, `2029, 9990001 (2019)`. Long enough not to collide with
# a real page, volume, or year in the rendered output, which is asserted.
PIN_SENTINEL = "9990001"

ENTRY_RE = re.compile(r"^@(\w+)\{([^,\s]+)\s*,", re.MULTILINE)
LINE_RE = re.compile(r"^(PIN|SHORT)::([^:]+)::#footnote\[(.*)\]$")
SUPRA_RE = re.compile(r"^(?P<short>.*?),?\s*#emph\[supra\]\s*note\s*\d+", re.DOTALL)
MISSING_RE = re.compile(r"#strong\[[^\]]*\?\];")

# pandoc's typst WRITER unsmartens `’` to `'`, and the docx round trip then reads a
# word-final `'` back as a closing DOUBLE quote -- `Investors' Attention` becomes
# `Investors” Attention`. canonicalize.py restores a word-final apostrophe it finds,
# but by then the character is `”` and the damage is already unrecoverable: the
# restore only protects source that was ALREADY curly. So the curly form has to be
# put back here, at the point the string is generated, not downstream.
#
# Scoped to word-FINAL only, verified against the round trip: `Comm'n`, `Ass'n`,
# `Nat'l` and `S'holder` -- Bluebook's abbreviations, where the apostrophe sits
# between letters -- survive the trip untouched and must not be rewritten.
_WORD_FINAL_APOSTROPHE = re.compile(r"(?<=\w)'(?![\w'])")

# pandoc's typst writer terminates every markup call with `;` -- `#emph[Title];` --
# but the terminator is only load-bearing when the next character could continue the
# expression. Before a space it is redundant, and the docx round trip drops it, which
# leaves a generated body one step off its canonical fixed point for exactly the
# entries that end in markup: books and working papers, where `full` closes with a
# title rather than a page. Emitting the form the round trip converges on keeps
# `canonicalize.py --check` and `expand_citations.py --check` in agreement.
_REDUNDANT_TERMINATOR = re.compile(r"\];(?=\s)")


# A BibTeX name separator is the word ` and `, and nothing else. So an `&` or a
# `;` sitting at depth 0 of a name field is never read as a separator -- BibTeX
# folds the whole field into ONE name and reads it as `Last, First`, which moves
# the first author to the end: `{A. Bebchuk, A. Cohen & S. Hirst}` renders
# `Alma Cohen & Scott Hirst Lucian A. Bebchuk` with short form `Lucian A. Bebchuk`.
# Nothing errors, and the output stays plausible, so the defect is invisible
# without this check. Depth matters: `{{Gibson, Dunn & Crutcher LLP}}` is a single
# braced institutional name whose `&` is literal and correct.
_NAME_FIELDS = ("author", "editor")


def _field_value(entry: str, field: str) -> str | None:
    """The brace-balanced value of `field = {...}`, outer braces stripped."""
    m = re.search(rf"\b{field}\s*=\s*\{{", entry, re.IGNORECASE)
    if not m:
        return None
    depth, i = 1, m.end()
    while i < len(entry) and depth:
        depth += {"{": 1, "}": -1}.get(entry[i], 0)
        i += 1
    return entry[m.end() : i - 1] if not depth else None


def _bad_separators(value: str) -> str | None:
    """The depth-0 separator character being misread as part of a name."""
    depth = 0
    for ch in value:
        depth += {"{": 1, "}": -1}.get(ch, 0)
        if depth == 0 and ch in "&;":
            return ch
    return None


def audit(bib: Path, entries: dict[str, dict]) -> list[str]:
    """Defects that render as plausible output rather than as an error.

    Every one of these was found the hard way in a real manuscript, and every
    one of them produced a citation that looked fine. They are reported rather
    than fixed: a name field, a cite key and a short form are all authorial,
    and rewriting one to satisfy a checker is how a citation changes unread.
    """
    text = bib.read_text(encoding="utf-8")
    bounds = [m.start() for m in ENTRY_RE.finditer(text)] + [len(text)]
    problems: list[str] = []

    for m, end in zip(ENTRY_RE.finditer(text), bounds[1:]):
        entry, key = text[m.start() : end], m.group(2)
        for field in _NAME_FIELDS:
            value = _field_value(entry, field)
            if value is None or " and " in value:
                continue
            if bad := _bad_separators(value):
                problems.append(
                    f"{key}: {field} separates names with {bad!r}, which BibTeX "
                    f"reads as one name -- use ' and '"
                )

    # A key differing only in punctuation is a duplicate record, not a second
    # source: `execorder14366_2025` / `execorder143662025` / `eo143662025` were
    # three keys for one executive order, two of them cited nowhere.
    by_norm: dict[str, list[str]] = {}
    for k in bib_entries(bib):
        by_norm.setdefault(re.sub(r"[^a-z0-9]", "", k.lower()), []).append(k)
    for norm, keys in sorted(by_norm.items()):
        if len(keys) > 1:
            problems.append(f"keys differ only in punctuation: {', '.join(sorted(keys))}")

    # Two works sharing a short form is the defect that silently reworks a
    # citation: `Bebchuk & Hirst, supra note 12` cannot say WHICH work. Bluebook
    # Rule 4.2 resolves it by adding the title, which `short` cannot express --
    # so this is reported here rather than papered over downstream, where it
    # surfaces only as audit_crossrefs.py's OK_AMBIG.
    by_short: dict[str, list[str]] = {}
    for k, e in entries.items():
        if e.get("short"):
            by_short.setdefault(e["short"], []).append(k)
    for short, keys in sorted(by_short.items()):
        if len(keys) > 1:
            problems.append(
                f"short form {short!r} is shared by {len(keys)} works "
                f"({', '.join(sorted(keys))}) -- needs a title to disambiguate"
            )
    return problems


def bib_entries(bib: Path) -> dict[str, str]:
    """key -> uppercased entry type, in file order. @Comment is not an entry."""
    return {
        m.group(2): m.group(1).upper()
        for m in ENTRY_RE.finditer(bib.read_text(encoding="utf-8"))
        if m.group(1).upper() != "COMMENT"
    }


def render(bib: Path, csl: Path, keys: list[str]) -> dict[str, dict[str, str]]:
    """Run citeproc once over every key, twice each.

    Round 1 cites each key with a sentinel locator, so citeproc renders the full
    first reference AND shows where a pincite belongs. Round 2 -- separated from
    round 1 by every other key, so citeproc reaches for `supra` rather than
    `Id.` -- gives the author-short. One pandoc invocation, so both rounds share
    a citation state and the short form is the one citeproc would really use.
    """
    doc = [f"PIN::{k}::[@{k}, {PIN_SENTINEL}]\n" for k in keys]
    doc += [f"SHORT::{k}::[@{k}]\n" for k in keys]
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "probe.md"
        src.write_text("\n".join(doc), encoding="utf-8")
        proc = subprocess.run(
            [require_pandoc(), str(src), "--citeproc", f"--bibliography={bib}",
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
        # The key travels through the probe as literal TEXT, and pandoc's typst
        # writer escapes it on the way out -- `execorder14366_2025` comes back
        # `execorder14366\_2025`. Unescaped, the lookup misses and the entry is
        # reported as "no rendering", which reads like a CSL or .bib problem and
        # is neither: every key with an underscore in it silently vanishes from
        # the generated data. A key cannot contain a backslash, so dropping them
        # is the whole inverse.
        kind, key, body = m.group(1), m.group(2).replace("\\", ""), m.group(3)
        out.setdefault(key, {})[kind] = body
    return out


def split_at_sentinel(rendered: str, key: str) -> tuple[str, str, str]:
    """Split citeproc's located rendering into (full, pin-sep, date).

    The sentinel marks the seam, so nothing here has to infer it. An earlier
    version split on the last ` (YYYY)` and read the separator off the BibTeX
    entry type, and both were wrong: a case whose parenthetical carries a court
    (`123 F.3d 456 (2d Cir. 2019)`) has no bare year to find, an entry with no
    date at all put the pincite after the URL, and this style gives books the
    same `, ` separator it gives articles, not Rule 15's bare space. Asking
    citeproc where it actually put a locator settles all three.
    """
    i = rendered.find(PIN_SENTINEL)
    if i < 0:
        raise ValueError(f"{key}: citeproc dropped the sentinel locator")
    head, date = rendered[:i], rendered[i + len(PIN_SENTINEL) :]
    for sep in (", ", " "):
        if head.endswith(sep):
            return head[: -len(sep)], sep, date
    raise ValueError(f"{key}: unrecognized pincite separator before {head[-8:]!r}")


def short_of(rendered: str | None) -> str | None:
    if rendered is None:
        return None
    m = SUPRA_RE.match(rendered)
    return m.group("short").strip() if m else None


def typ_str(s: str) -> str:
    s = _WORD_FINAL_APOSTROPHE.sub("’", s)
    s = _REDUNDANT_TERMINATOR.sub("]", s)
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"') + '"'


def build(bib: Path, csl: Path, only: list[str] | None) -> dict[str, dict]:
    types = bib_entries(bib)
    if PIN_SENTINEL in bib.read_text(encoding="utf-8"):
        sys.exit(f"error: {PIN_SENTINEL} occurs in {bib.name}; pick another sentinel")
    only_set = set(only) if only else None
    keys = [k for k in types if only_set is None or k in only_set]
    for k in only_set or ():
        if k not in types:
            print(f"warning: key not in {bib.name}: {k}", file=sys.stderr)
    rendered = render(bib, csl, keys)

    entries: dict[str, dict] = {}
    for k in keys:
        got = rendered.get(k)
        if not got or "PIN" not in got:
            print(f"warning: no rendering for {k}", file=sys.stderr)
            continue
        # The CSL note style ends the note with a sentence period. Everything
        # else in the string belongs to the citation.
        located = got["PIN"].removesuffix(".")
        if MISSING_RE.search(located):
            print(f"warning: {k} unresolved by citeproc; skipped", file=sys.stderr)
            continue
        try:
            full, sep, date = split_at_sentinel(located, k)
        except ValueError as exc:
            print(f"warning: {exc}; skipped", file=sys.stderr)
            continue
        # `full` and `date` are concatenated at render time, so the seam is where
        # a redundant terminator hides: `#emph[Title];` + ` (2025)`. Normalize
        # across the join, not within either half.
        if full.endswith("];") and date[:1].isspace():
            full = full[:-1]
        entries[k] = {
            "full": full,
            "date": date,
            "pin-sep": sep,
            "short": short_of(got.get("SHORT")),
        }
    return entries


FIELDS = ("full", "date", "pin-sep", "short")


def emit(entries: dict[str, dict], bib_name: str) -> str:
    header = (
        f"// GENERATED by bib_to_entries.py from {bib_name} -- do not hand-edit.\n"
        "//\n"
        "// Per cite key: the entry-level first reference split where citeproc\n"
        "// places a pincite, the separator it used, and the author-short it\n"
        "// chose for `X, supra note N`.\n"
        "//\n"
        "// Values are typst SOURCE strings, not content, so the same data can be\n"
        "// eval()'d for the PDF and spliced as markup into the docx build.\n"
        "\n"
        "#let entries = (\n"
    )
    out = [header]
    for k in sorted(entries):
        e = entries[k]
        fields = "".join(
            f"    {f}: {typ_str(e[f]) if e[f] else 'none'},\n"
            if f == "short"
            else f"    {f}: {typ_str(e[f])},\n"
            for f in FIELDS
        )
        out.append(f'  "{k}": (\n{fields}  ),\n')
    out.append(")\n")
    return "".join(out)


def parse_existing(path: Path) -> dict[str, dict]:
    """Read an existing entries module by asking typst, not by regex.

    The module is typst source, and typst is the only thing that can be trusted
    to read it -- a regex over the emitter's own byte layout fails open on a
    hand-edited or reformatted file, reporting every entry as new. That would
    quietly disarm `--diff`, which exists to stop citations changing unread.
    Same technique as expand_citations.py, for the same reason.
    """
    typst = shutil.which("typst")
    if not typst:
        sys.exit("error: typst not found on PATH")
    path = path.resolve()
    proc = subprocess.run(
        [typst, "eval", f'import "{path.name}": entries; entries',
         "--root", str(path.parent), "--format", "json"],
        capture_output=True, text=True, check=False, cwd=path.parent,
    )
    if proc.returncode != 0:
        sys.exit(f"error: typst could not read {path}:\n{proc.stderr.strip()}")
    return json.loads(proc.stdout)


def diff(entries: dict[str, dict], existing: Path) -> int:
    old = parse_existing(existing)
    added = sorted(set(entries) - set(old))
    dropped = sorted(set(old) - set(entries))
    changed = [
        (k, f, old[k].get(f), entries[k][f])
        for k in sorted(set(entries) & set(old))
        for f in FIELDS
        if (entries[k][f] or "") != (old[k].get(f) or "")
    ]

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
    ap.add_argument("--audit", action="store_true",
                    help="report .bib defects and exit non-zero; never writes")
    args = ap.parse_args()

    for p in (args.bib, args.csl):
        if not p.exists():
            sys.exit(f"error: no such file: {p}")

    try:
        entries = build(args.bib, args.csl, args.keys)
    except PandocError as exc:
        sys.exit(f"error: {exc}")
    if not entries:
        sys.exit("error: citeproc rendered nothing")

    # Always reported, never fatal to generation: these are defects in the .bib,
    # not in the run, and a build that refused to emit would just be worked
    # around. `--audit` is the gate for anyone who wants one.
    problems = audit(args.bib, entries)
    for p in problems:
        print(f"warning: {p}", file=sys.stderr)
    if args.audit:
        print(f"{args.bib.name}: {len(entries)} entries, {len(problems)} problems")
        return 1 if problems else 0

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
