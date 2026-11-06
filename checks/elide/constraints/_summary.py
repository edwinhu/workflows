"""The editorial summary: `#emph[[Summary: ...]]` standing in for an elided passage (editing-marks.md).

The one parser for every elide check that has to see it: check-marks enforces the form, check-quotes
skips the span as an elision, and the rules' `_elide.parse` masks it to an elision mark. A summary IS
the elision at that point, so `mask` replaces it with one.
"""
import re

OPEN_RX = re.compile(r'#emph\s*\[\s*\[\s*Summary\s*:')
# any summary-labelled span: case-sensitive `Summary` after an opener, so `[S]ummary judgment` never trips
LOOSE_RX = re.compile(r"(?:#emph\s*\[|[\[_*])\s*[_*]?\s*"
                      r"(?:(?:Editor(?:s|'s|’s)?(?:['’]|\\u\{2019\})?|Editorial)\s+[Ss]ummary|Summary)"
                      r"\s*[_*]?\s*:")
MASK = ' [. . .] '
MAX_WORDS = 40


def _close(text, at):
    """Index just past the `]` balancing the `[` at `at`, honouring `\\` escapes; -1 when unclosed."""
    depth, i = 0, at
    while i < len(text):
        c = text[i]
        if c == '\\':
            i += 2
            continue
        if c == '[':
            depth += 1
        elif c == ']':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


def spans(line):
    """[(start, end, inner, well_formed)] for each canonical opener on one line; well-formed means it
    closes as `]]` on the same line. An unclosed span runs to the end of the line."""
    out = []
    for m in OPEN_RX.finditer(line):
        outer = line.index('[', m.start())
        inner_open = line.index('[', outer + 1)
        end, inner_end = _close(line, outer), _close(line, inner_open)
        ok = end != -1 and inner_end != -1 and not line[inner_end:end - 1].strip()
        body = line[m.end():inner_end - 1] if inner_end != -1 else line[m.end():]
        out.append((m.start(), end if ok else len(line), body.strip(), ok))
    return out


def loose(line):
    """[(start, matched text)] for each summary-labelled span NOT in the canonical form."""
    canon = [(s, line.index('[', line.index('[', s) + 1)) for s, _, _, _ in spans(line)]
    return [(m.start(), m.group(0)) for m in LOOSE_RX.finditer(line)
            if not any(s <= m.start() <= inner for s, inner in canon)]


def mask(line, repl=MASK):
    """The line with each well-formed summary replaced by an elision mark; a malformed one is kept."""
    out, at = [], 0
    for s, e, _, ok in spans(line):
        if ok:
            out += [line[at:s], repl]
            at = e
    return ''.join(out) + line[at:]


def words(inner):
    """The words a reader sees: Typst calls, emphasis and escapes folded away."""
    t = re.sub(r'\\u\{([0-9a-fA-F]+)\}', lambda m: chr(int(m.group(1), 16)), inner)
    t = re.sub(r'#[a-zA-Z.]+(\([^)]*\))?\[?', ' ', t)
    t = re.sub(r'[\[\]]', ' ', re.sub(r'[_*]|\\(?=\S)', '', t))
    return [w for w in t.split() if re.search(r'\w', w)]
