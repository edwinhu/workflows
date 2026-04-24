#!/usr/bin/env -S uv run python3
"""Convert writing workflow's `references/sources.md` into a BibTeX `sources.bib`.

Parses the hand-written sources.md format (see writing-setup skill for the
canonical template): each `### Title YEAR` section with `- **Authors:**`,
`- **Title:**`, `- **Journal:**`, `- **Volume/Pages:**`, `- **Year:**`,
`- **Bib key:**`, etc.

Heuristics for BibTeX entry type:
- Has Journal field -> @article
- Has Publisher field -> @book
- Contains "Cong." / "S. N," / "H.R." -> @misc with howpublished
- Contains "Exec. Order" / "C.F.R." / "U.S.C." / "SEC" -> @misc
- Working paper / NBER / SSRN / ECGI -> @unpublished
- Default -> @misc

Bib keys: use the "Bib key:" field if present and non-empty. Otherwise
generate `firstauthorlast<year>` (lowercase, no spaces).

Usage:
    uv run python3 sources_md_to_bib.py path/to/sources.md [--output PATH]
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


FIELD_PATTERNS = {
    "authors": re.compile(r'\*\*Authors?:\*\*\s*(.+?)(?=\n[-*]|\Z)', re.DOTALL),
    "title": re.compile(r'\*\*Title:\*\*\s*(.+?)(?=\n[-*]|\Z)', re.DOTALL),
    "journal": re.compile(r'\*\*Journal:\*\*\s*(.+?)(?=\n[-*]|\Z)', re.DOTALL),
    "publisher": re.compile(r'\*\*Publisher:\*\*\s*(.+?)(?=\n[-*]|\Z)', re.DOTALL),
    "volume_pages": re.compile(r'\*\*Volume/Pages?:\*\*\s*(.+?)(?=\n[-*]|\Z)', re.DOTALL),
    "year": re.compile(r'\*\*Year:\*\*\s*(.+?)(?=\n[-*]|\Z)', re.DOTALL),
    "bibkey": re.compile(r'\*\*Bib key:\*\*\s*(.+?)(?=\n[-*]|\Z)', re.DOTALL),
    "url": re.compile(r'\*\*URL:\*\*\s*(.+?)(?=\n[-*]|\Z)', re.DOTALL),
    "full_cite": re.compile(r'\*\*Full cite[^:]*:\*\*\s*(.+?)(?=\n[-*]|\Z)', re.DOTALL),
    "status": re.compile(r'\*\*Status:\*\*\s*(.+?)(?=\n[-*]|\Z)', re.DOTALL),
    "date": re.compile(r'\*\*Date[^:]*:\*\*\s*(.+?)(?=\n[-*]|\Z)', re.DOTALL),
}


def _clean(value: str) -> str:
    """Normalize a field value: strip whitespace, collapse runs, drop markup."""
    v = value.strip()
    # Drop italics markers
    v = re.sub(r'\*([^*]+)\*', r'\1', v)
    # Collapse internal whitespace
    v = re.sub(r'\s+', ' ', v)
    return v


_NAME_SUFFIXES = {"Jr.", "Sr.", "III", "IV", "II", "Jr", "Sr"}


def _protect_name(name: str) -> str:
    """Wrap a name containing a comma (e.g., 'Berle, Jr.') in double braces so
    BibTeX treats it atomically instead of parsing 'last, first'."""
    if ',' in name:
        return '{' + name + '}'
    return name


def _normalize_authors(raw: str) -> str:
    """Convert 'A, B & C' or 'A, B, and C' to BibTeX 'A and B and C' form.

    Handles names with suffixes ('Adolf A. Berle, Jr.') by wrapping the whole
    name in double braces so BibTeX does not misparse the internal comma.
    """
    if not raw:
        return raw
    parts = re.split(r'\s*&\s*|\s*,\s*and\s+', raw)
    all_authors: list[str] = []
    for part in parts:
        part = part.strip()
        sub = [p.strip() for p in part.split(',') if p.strip()]
        if len(sub) == 1:
            all_authors.append(sub[0])
        elif len(sub) == 2 and sub[1] in _NAME_SUFFIXES:
            # "Berle, Jr." → single author with suffix; brace-protect
            all_authors.append(_protect_name(part))
        elif all(' ' in s and not re.match(r'^[A-Z][a-z]+,', s) for s in sub):
            # Multi-word first-last pieces separated by commas → separate authors
            all_authors.extend(sub)
        else:
            # Fallback: assume it's a single author whose raw string contains commas
            all_authors.append(_protect_name(part))
    return ' and '.join(a for a in all_authors if a)


def _normalize_year(raw: str) -> str:
    """Extract a single 4-digit year from free-text input like '2018/2019' or
    '2017 (bib) / 2018 (Intro fn.8 cites 2018)'."""
    m = re.search(r'\b(19|20)\d{2}\b', raw or '')
    return m.group() if m else (raw or '')


def _protect_title(title: str) -> str:
    """Wrap in double braces so CSL's case-transformer leaves capitalization
    intact. The double-brace form tells BibTeX 'this string is literal'."""
    return '{' + title + '}' if title else title


def _sanitize_bibkey(key: str) -> str:
    """Make a bib key BibTeX-safe: keep letters, digits, dashes, underscores."""
    k = re.sub(r'[^A-Za-z0-9_-]', '', key)
    return k or 'entry'


def _generate_bibkey(authors: str, year: str) -> str:
    """Generate firstauthorlast<year> from parsed metadata."""
    if not authors:
        return f"entry{year or 'nd'}"
    # Take the surname of the first author
    first = authors.split(',')[0].split('&')[0].strip()
    # Last name is the last word
    words = re.findall(r'[A-Za-z]+', first)
    surname = words[-1].lower() if words else 'entry'
    y = re.search(r'\d{4}', year or '')
    return f"{surname}{y.group() if y else 'nd'}"


def _parse_volume_pages(raw: str) -> tuple[str, str]:
    """Split 'Volume, pages' into (volume, pages)."""
    if not raw:
        return "", ""
    # Strip a trailing '.'
    raw = raw.rstrip('.')
    # Patterns: "99, 721" or "121, 111-141" or "74, 2441-2490"
    m = re.match(r'^(\d+)\s*,\s*(.+)$', raw)
    if m:
        return m.group(1), m.group(2).strip()
    # Single number: could be volume only, or pages only
    return raw, ""


def _infer_entry_type(fields: dict) -> str:
    """Pick BibTeX entry type based on the parsed fields."""
    if fields.get("journal"):
        return "article"
    if fields.get("publisher"):
        return "book"
    title = fields.get("title", "").lower()
    full = (fields.get("full_cite", "") + " " + fields.get("status", "")).lower()
    haystack = title + " " + full
    if any(k in haystack for k in ("cong.", "s.", "h.r.", "public law")):
        return "misc"
    if any(k in haystack for k in ("exec. order", "c.f.r.", "u.s.c.", "del. code", "sec no-action", "sec release")):
        return "misc"
    if any(k in haystack for k in ("working paper", "ssrn", "nber", "ecgi")):
        return "unpublished"
    return "misc"


def _escape_bibtex(text: str) -> str:
    """Escape backslashes in BibTeX field values. Braces are NOT escaped because
    they are structural/protective in our pipeline — `_protect_title` and
    `_protect_name` use braces to guard case-transforms and comma-parsing."""
    if not text:
        return text
    return text.replace('\\', '\\\\')


def parse_section(title_line: str, body: str) -> dict | None:
    """Parse one `### ...` section into a fields dict, or None if unparseable."""
    fields: dict = {}
    for name, pat in FIELD_PATTERNS.items():
        m = pat.search(body)
        if m:
            fields[name] = _clean(m.group(1))

    authors = fields.get("authors", "")
    title = fields.get("title", "")
    if not (authors or title):
        return None

    # Use the `### ` heading as the short title / fallback title
    fields["_section_heading"] = title_line.strip()
    return fields


def _is_placeholder_key(key: str) -> bool:
    """Detect bib-key placeholders that should be regenerated from author+year.
    Placeholder-like: empty, 'entry...', 'undated', 'nd', 'unknown', etc."""
    if not key:
        return True
    low = key.lower()
    if any(tok in low for tok in ("not in", "not found")):
        return True
    # Strip trailing suffix (e.g., 'entrynd', 'entry2024', 'Unknown-xx')
    bare = re.sub(r'[-_]?(?:\d+|[a-z]{1,3})$', '', low)
    if bare in ("entry", "undated", "unknown"):
        return True
    return False


def section_to_bibtex(fields: dict, used_keys: set) -> str:
    """Render a parsed section as a BibTeX entry string.

    `used_keys` is mutated in place to track assigned keys across the whole
    conversion and ensure uniqueness.
    """
    entry_type = _infer_entry_type(fields)
    bibkey = fields.get("bibkey", "")
    # Replace placeholder-like keys with a generated firstauthorYEAR key
    if _is_placeholder_key(bibkey):
        bibkey = _generate_bibkey(fields.get("authors", ""), fields.get("year", ""))
    bibkey = _sanitize_bibkey(bibkey)
    # Disambiguate collisions by appending -a, -b, ...
    if bibkey in used_keys:
        base = bibkey
        for suffix_ord in range(ord('a'), ord('z') + 1):
            candidate = f"{base}-{chr(suffix_ord)}"
            if candidate not in used_keys:
                bibkey = candidate
                break
        else:
            bibkey = f"{base}-x"  # fallback
    used_keys.add(bibkey)

    lines = [f"@{entry_type}{{{bibkey},"]

    def add(name: str, value: str) -> None:
        if value:
            lines.append(f"  {name} = {{{_escape_bibtex(value)}}},")

    add("author", _normalize_authors(fields.get("authors", "")))
    add("title", _protect_title(fields.get("title", "")))
    journal = fields.get("journal", "")
    publisher = fields.get("publisher", "")
    if journal:
        add("journal", journal)
    if publisher:
        add("publisher", publisher)
    volume, pages = _parse_volume_pages(fields.get("volume_pages", ""))
    add("volume", volume)
    add("pages", pages)
    add("year", _normalize_year(fields.get("year", "")))
    add("url", fields.get("url", ""))
    if entry_type == "misc":
        howpub = fields.get("full_cite") or fields.get("status") or fields.get("_section_heading")
        add("howpublished", howpub)
    if entry_type == "unpublished":
        note = fields.get("status") or fields.get("full_cite")
        add("note", note)

    # Trim trailing comma on the last field line
    if lines[-1].endswith(","):
        lines[-1] = lines[-1][:-1]
    lines.append("}")
    return "\n".join(lines)


def convert(sources_md: Path) -> str:
    text = sources_md.read_text(encoding="utf-8")
    # Split on `### ` headings (section entries)
    sections = re.split(r'\n### ', '\n' + text)
    # First split is preamble before any ### heading
    entries: list[str] = []
    used_keys: set = set()
    for sec in sections[1:]:
        if not sec.strip():
            continue
        first_nl = sec.find('\n')
        title_line = sec[:first_nl] if first_nl != -1 else sec
        body = sec[first_nl + 1:] if first_nl != -1 else ""
        fields = parse_section(title_line, body)
        if not fields:
            continue
        entries.append(section_to_bibtex(fields, used_keys))

    header = (
        "% Auto-generated from references/sources.md\n"
        "% Do not edit by hand — edit sources.md and re-run sources_md_to_bib.py\n\n"
    )
    return header + "\n\n".join(entries) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Path to sources.md")
    parser.add_argument("--output", "-o", type=Path,
                        help="Output .bib path (default: sibling sources.bib)")
    args = parser.parse_args()
    if not args.source.exists():
        print(f"ERROR: {args.source} not found", file=sys.stderr)
        return 1
    output = args.output or args.source.with_suffix(".bib")
    bib = convert(args.source)
    output.write_text(bib, encoding="utf-8")
    n_entries = bib.count("@")
    print(f"Wrote {n_entries} entries -> {output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
