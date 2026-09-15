#!/usr/bin/env python3
"""Build the hand-review page's data: one row per citation SITE.

    python3 review_build.py --root /path/to/manuscript     # default: cwd

WRITES two things into the manuscript repo, both OUTPUT and both overwritten
every build: `scratch/review-data.json`, and a copy of the page itself at
`scratch/review/index.html` taken from this skill's asset. Serving the repo root
is then all the author does:

    python3 ../assets/review/serve.py 8765 /path/to/manuscript   # serve the REPO ROOT
    # http://localhost:8765/scratch/review/index.html

Serve with `serve.py`, never `python3 -m http.server`: the page autosaves by POSTing
to the server, and plain http.server answers that POST with 501, silently discarding
every edit the author makes.

Identity is (fn, citekey, occurrence) throughout -- never a byte offset, which
every inserted `, at N` invalidates.

Two prior-run artifacts are OPTIONAL. `scratch/percite-classified.json` supplies
the classifier's decision and reason; `scratch/pincite.json` supplies pages the
model found and verify confirmed. A fresh manuscript has neither: the page still
builds, with no decision column and the bibliography's start page as the
best-guess page to open each PDF at.

Offsets: pincite.page_offset first; when it refuses, pincite.vision_offset with
a Gemini key from $GOOGLE_API_KEY, else the file named by $GEMINI_API_KEY_FILE,
else $XDG_RUNTIME_DIR/agenix/gemini-api-key. Every resolved offset is written
into review-data.json and reused on the next build, so the page never calls the
API and a rebuild rarely does.
"""
import argparse
import html
import json
import os
import pathlib
import re
import shutil
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pincite as P  # noqa: E402

ASSET = HERE.parent / 'assets/review/index.html'


def api_key():
    """The Gemini key, or None. Only the vision offset route ever needs it."""
    if os.environ.get('GOOGLE_API_KEY'):
        return os.environ['GOOGLE_API_KEY'].strip()
    named = os.environ.get('GEMINI_API_KEY_FILE')
    runtime = os.environ.get('XDG_RUNTIME_DIR')
    for p in (named, f'{runtime}/agenix/gemini-api-key' if runtime else None,
              '/run/user/1000/agenix/gemini-api-key'):
        if not p:
            continue
        try:
            return pathlib.Path(p).read_text().strip()
        except OSError:
            continue
    print('  (no Gemini key: vision offset route unavailable)', file=sys.stderr)
    return None


# ------------------------------------------------------------------- sites
# The per-SITE inventory. pincite's `footnotes`, `strip_markup`, `claim_of`,
# `pin_span` and `bib_index` do the parsing; what is added here is the site
# enumeration, the governing Bluebook signal and the explanatory parenthetical.

SITE = re.compile(r'#ref\(<([^>]+)>\)')
AT = re.compile(r'\s*,\s*at\s+\d')
# The same page cite with the required comma missing. The strict rule above reads
# these as UNPINNED, so they must be named or a later pass pins on top of a page.
AT_NO_COMMA = re.compile(r'\s+at\s+\*?[\d,]+(?:\s*(?:--|–|-)\s*\d+)?')
# A cite separator is a semicolon that is not Typst's `];` markup terminator.
SEP = re.compile(r'(?<!\]);')
EMPH = re.compile(r'#(?:emph|strong)\[([^\]]*)\]')

# Bluebook Rule 1.2 signals, longest first -- alternation is leftmost-first, so
# `see generally` must precede `see also`, which must precede `see`.
SIGNALS = [
    ('see generally', r'see\s+generally'),
    ('but cf.', r'but\s+cf\.'),
    ('but see', r'but\s+see'),
    ('see, e.g.,', r'see,?\s*e\.g\.,?'),
    ('see also', r'see\s+also'),
    ('accord', r'accord'),
    ('compare', r'compare'),
    ('contra', r'contra'),
    ('cf.', r'cf\.'),
    ('e.g.,', r'e\.g\.,?'),
    ('see', r'see'),
]
SIGNAL_RX = re.compile(r'(?<![\w.])(' + '|'.join(p for _, p in SIGNALS) + r')(?![\w])',
                       re.IGNORECASE)
# `See supra Section I.A` points INTO this article: a signal, but it governs no
# source cite, so it never propagates.
CROSS_REF = re.compile(r'\s*(infra|supra)\b', re.IGNORECASE)


def canon(tok):
    t = re.sub(r'\s+', ' ', tok.strip().lower())
    for name, pat in SIGNALS:
        if re.fullmatch(pat, t, re.IGNORECASE):
            return name
    return ''


def signals_in(body):
    """(offset, canonical signal, raw emph text, is_cross_ref) for each signal.

    Read off `#emph[...]` rather than prose, which is what keeps the word "see"
    inside a quotation from being taken for a Rule 1.2 signal."""
    out = []
    for m in EMPH.finditer(body):
        content = m.group(1)
        hits = list(SIGNAL_RX.finditer(content))
        if not hits:
            continue
        last = hits[-1]
        name = canon(last.group(1))
        if not name:
            continue
        out.append((m.start(1) + last.start(), name, content,
                    bool(CROSS_REF.match(content[last.end():]))))
    return out


def footnote_spans(text):
    """(fn, body_start, body_end, body, preceding prose) for every footnote.

    pincite.footnotes does the parse; this only recovers where each body sits,
    and asserts that the two agree rather than trusting the arithmetic."""
    out, cursor = [], 0
    for fn, body, before in P.footnotes(text):
        j = text.index('#footnote[', cursor)
        a = j + len('#footnote[')
        b = a + len(body)
        if text[a:b] != body:
            raise AssertionError(f'fn {fn}: parsed body does not sit at {a}')
        out.append((fn, a, b, body, before))
        cursor = b + 1
    return out


def segment_bounds(body, at):
    """Body-relative (start, end) of the one cite in the string that owns `at`."""
    start = 0
    for m in SEP.finditer(body):
        if m.end() > at:
            break
        start = m.end()
    end = len(body)
    for m in SEP.finditer(body):
        if m.start() > at:
            end = m.start()
            break
    return start, end


# An explanatory parenthetical belongs to THIS site only when it follows the cite
# directly, past at most a pin: `supra note 5, at 12 (noting ...)`. Taking the
# first `(` anywhere in the segment instead hands a site the `(2025)` from a full
# cite two clauses later.
PAREN_HEAD = re.compile(r'\s*(?:,?\s*at\s+\*?[\d,]+(?:\s*(?:--|–|-)\s*\d+)?)?\s*\(')


def parenthetical(body, ref_end, seg_end):
    """Evidence of specificity, so it is recorded rather than judged."""
    m = PAREN_HEAD.match(body, ref_end, seg_end)
    if not m:
        return ''
    depth, k = 0, m.end() - 1
    while k < seg_end:
        if body[k] == '(':
            depth += 1
        elif body[k] == ')':
            depth -= 1
            if depth == 0:
                return P.strip_markup(body[m.end() - 1:k + 1])
        k += 1
    return ''


# The prose window pincite hands to claim_of runs back through whatever precedes
# the footnote, which can be a Typst heading and its anchor. The sentence splitter
# does not break on those, so the heading is glued onto the front of the claim.
# Strip the markup BEFORE the split, so claim_of sees prose.
HEADING_LINE = re.compile(r'^\s*=+\s.*$', re.MULTILINE)
ANCHOR_LINE = re.compile(r'^\s*<[\w\-.]*>\s*$', re.MULTILINE)
# A full cite's label trails its footnote, so it opens the NEXT prose chunk.
INLINE_LABEL = re.compile(r'(?<!#ref\()<[A-Za-z][\w\-.]*>')
# ...and the 700-char window can cut an anchor in half, leaving `visory-industry>`.
TRUNC_ANCHOR = re.compile(r'^\S*>\s*')


def prose_of(before):
    b = HEADING_LINE.sub(' ', before)
    b = ANCHOR_LINE.sub(' ', b)
    b = INLINE_LABEL.sub(' ', b)
    return TRUNC_ANCHOR.sub('', b.lstrip())


def rel(path):
    return str(path.relative_to(P.ROOT)) if path and P.ROOT in path.parents else (
        str(path) if path else None)


def build_sites(text):
    """One row per citation site, in file order."""
    bib = P.bib_index()
    rows = []
    for fn, a, b, body, before in footnote_spans(text):
        if fn < 1:
            continue
        claim = P.claim_of(prose_of(before))
        sigs = signals_in(body)
        seen = {}
        for m in SITE.finditer(body):
            key = m.group(1)
            # 1-based nth appearance of THIS citekey in THIS footnote: the only
            # part of a site's identity no later insertion can move.
            seen[key] = seen.get(key, 0) + 1
            tail = body[m.end():m.end() + 16]
            pinned = bool(AT.match(tail))
            loose = None if pinned else AT_NO_COMMA.match(tail)
            seg_a, seg_b = segment_bounds(body, m.start())
            own = [s for s in sigs if seg_a <= s[0] < m.start() and not s[3]]
            inherited = [s for s in sigs if s[0] < m.start() and not s[3]]
            sig = own[-1] if own else (inherited[-1] if inherited else None)
            hit = bib.get(key.lower())
            pdf = hit[0] if hit else None
            rows.append({
                'fn': fn,
                'citekey': key,
                'occurrence': seen[key],
                'span_offset': m.start(),
                'pinned': pinned,
                'pin': P.pin_span(tail) if pinned else None,
                'pin_no_comma': loose.group(0).strip() if loose else None,
                'signal': sig[1] if sig else '',
                'claim': claim,
                'parenthetical': parenthetical(body, m.end(), seg_b),
                'pdf': rel(pdf),
                'pdf_exists': bool(pdf and pdf.exists()),
                'bib_start': hit[3] if hit else None,
            })
    return rows


# ------------------------------------------------------- footnote -> HTML

LABEL = re.compile(r'(?<!#ref\()<([A-Za-z][\w\-.]*)>')


def label_notes(text):
    """citekey -> the footnote number its label sits in, so `#ref(<k>)` can render
    as the note number a reader sees rather than the raw key."""
    out = {}
    for fn, a, b, body, _before in footnote_spans(text):
        for m in LABEL.finditer(body):
            out.setdefault(m.group(1), fn)
        # `#footnote[...] <kahan2008>` -- the label trails the footnote it names
        tail = text[b:b + 40]
        m = re.match(r'\]\s*<([A-Za-z][\w\-.]*)>', tail)
        if m:
            out[m.group(1)] = fn
    return out


WRAP = {'emph': ('<em>', '</em>'),
        'strong': ('<strong>', '</strong>'),
        'smallcaps': ('<span class="sc">', '</span>'),
        'box': ('', ''),
        '': ('', '')}
CMD = re.compile(r'#(emph|strong|smallcaps|box|link|ref|)\[')
LINK = re.compile(r'#link\("([^"]*)"\)\[')
REF = re.compile(r'#ref\(<([^>]+)>\)')


def render(body, site_at, notes):
    """The footnote body as HTML, with the site at `site_at` marked.

    Typst markup is reduced, not interpreted: emph -> italics, smallcaps -> small
    caps, `#ref(<k>)` -> the note number k resolves to (else the bare key)."""
    out, buf, i, n = [], [], 0, len(body)
    stack = []

    def flush():
        if buf:
            out.append(html.escape(''.join(buf)))
            buf.clear()

    while i < n:
        c = body[i]
        if c == '\\' and i + 1 < n:          # Typst escape: \$ \/ \[ \]
            buf.append(body[i + 1])
            i += 2
            continue
        if c == ']':
            flush()
            if stack:
                out.append(stack.pop())
            # `];` is markup's terminator, not a semicolon in the text
            i += 2 if body[i:i + 2] == '];' else 1
            continue
        if c == '#':
            m = REF.match(body, i)
            if m:
                flush()
                key = m.group(1)
                shown = str(notes[key]) if key in notes else key
                cls = 'ref site' if i == site_at else 'ref'
                out.append(f'<span class="{cls}">{html.escape(shown)}</span>')
                i = m.end()
                continue
            m = LINK.match(body, i)
            if m:
                flush()
                url = html.escape(m.group(1).replace('\\/', '/'))
                out.append(f'<a href="{url}" target="_blank" rel="noopener">')
                stack.append('</a>')
                i = m.end()
                continue
            m = CMD.match(body, i)
            if m:
                flush()
                open_, close = WRAP[m.group(1)]
                out.append(open_)
                stack.append(close)
                i = m.end()
                continue
        buf.append(c)
        i += 1
    flush()
    out.extend(reversed(stack))
    return ''.join(out)


# ------------------------------------------------------------- page numbers

class Offsets:
    """pdf path -> dict(k, route, reason, n_pages), resolved once and cached.

    The cache is review-data.json's own previous contents: a resolved offset is
    already recorded there per row, so no second state file is needed."""

    def __init__(self, prior):
        self.cache = {}
        self.key = None
        for r in prior:
            p, k = r.get('pdf'), r.get('offset_k')
            if p and k is not None and r.get('offset_route'):
                self.cache.setdefault(p, dict(k=k, route=r['offset_route'],
                                              reason=r.get('offset_reason', ''),
                                              n_pages=r.get('pdf_n_pages')))

    def get(self, rel_pdf, bib_start):
        if rel_pdf in self.cache:
            return self.cache[rel_pdf]
        path = P.ROOT / rel_pdf
        if not path.exists():
            info = dict(k=None, route=None, reason='pdf missing on disk',
                        n_pages=None)
            self.cache[rel_pdf] = info
            return info
        pages = P.pages_of(path)
        n = len(pages)
        res = P.page_offset(pages, bib_start=bib_start)
        if res.get('accepted'):
            info = dict(k=res['k'], route='text', reason=res.get('reason', ''),
                        n_pages=n)
        else:
            refused = res.get('reason', '')
            if self.key is None:
                self.key = api_key() or ''
            v = P.vision_offset(path, n, bib_start, self.key) if self.key else None
            if v and v.get('accepted'):
                info = dict(k=v['k'], route='vision', reason=v.get('reason', ''),
                            n_pages=n)
            else:
                why = (v or {}).get('reason', 'no vision key') if v is not None \
                    else 'vision offset not attempted'
                info = dict(k=None, route=None, n_pages=n,
                            reason=f'text: {refused}; vision: {why}')
            print(f'  offset {rel_pdf}: {info["route"]} k={info["k"]}',
                  file=sys.stderr)
        self.cache[rel_pdf] = info
        return info


def state_pages(state):
    """(fn, pdf) -> printed page, from scratch/pincite.json when it exists.

    verify.page when the quote was actually found in the PDF; the model's
    answer.page otherwise. Keyed by the PDF as well as the footnote because
    pincite works a footnote at a time against ONE source: a page derived for one
    work in a string cite is not the page for the other two."""
    verified, guessed = {}, {}
    if not state.exists():
        return verified, guessed
    for r in json.loads(state.read_text()).get('rows', []):
        ident = (r.get('fn'), r.get('pdf'))
        v = r.get('verify') or {}
        if v.get('ok') and isinstance(v.get('page'), int):
            verified.setdefault(ident, v['page'])
        a = r.get('answer') or {}
        m = re.search(r'\d[\d,]*', str(a.get('page') or ''))
        if m:
            guessed.setdefault(ident, int(m.group(0).replace(',', '')))
    return verified, guessed


# ---------------------------------------------------------------- assembly

def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--root', default='.', help='manuscript repo root (default: cwd)')
    ap.add_argument('--body', help=f"manuscript .typ (default: {P.DEFAULTS['body']})")
    ap.add_argument('--bib', help=f"bibliography (default: {P.DEFAULTS['bib']})")
    ap.add_argument('--pdf-dir', help=f"source PDFs (default: {P.DEFAULTS['pdf_dir']})")
    ap.add_argument('--fedreg-dir',
                    help=f"Fed. Reg. PDFs (default: {P.DEFAULTS['fedreg_dir']})")
    ap.add_argument('--bio-offset', type=int, default=P.BIO,
                    help='leading footnotes marked *, dagger etc. taking no number')
    ap.add_argument('--classified', default=None,
                    help='optional classifier output (default <root>/scratch/percite-classified.json)')
    ap.add_argument('--state', default=None,
                    help='optional pincite state (default <root>/scratch/pincite.json)')
    ap.add_argument('--out', default=None,
                    help='(default <root>/scratch/review-data.json)')
    ap.add_argument('--expect', type=int, default=0,
                    help='fail unless exactly this many sites are found')
    a = ap.parse_args()

    root = P.configure(a.root, a.body, a.bib, a.pdf_dir, a.fedreg_dir, a.bio_offset)
    if not P.BODY.exists():
        sys.exit(f'no manuscript at {P.BODY} (pass --body)')
    out_path = pathlib.Path(a.out).resolve() if a.out else root / 'scratch/review-data.json'
    classified_path = pathlib.Path(a.classified).resolve() if a.classified else \
        root / 'scratch/percite-classified.json'
    state_path = pathlib.Path(a.state).resolve() if a.state else \
        root / 'scratch/pincite.json'

    text = P.BODY.read_text()
    rows = build_sites(text)
    notes = label_notes(text)
    spans = {fn: (a_, body) for fn, a_, b, body, _ in footnote_spans(text)}

    # BOTH prior-run artifacts are optional: a fresh manuscript has neither, and
    # the page still builds -- with no decision or reason, and the bibliography's
    # start page as the best guess of where to open each PDF.
    classified = {}
    if classified_path.exists():
        for c in json.loads(classified_path.read_text()):
            classified[(c['fn'], c['citekey'], c.get('occurrence', 1))] = c
    verified_fn, guessed_fn = state_pages(state_path)

    prior = []
    if out_path.exists():
        try:
            prior = json.loads(out_path.read_text())
        except json.JSONDecodeError:
            prior = []
    offsets = Offsets(prior)

    out = []
    for r in rows:
        ident = (r['fn'], r['citekey'], r['occurrence'])
        c = classified.get(ident, {})
        _a, body = spans[r['fn']]
        row = {
            'fn': r['fn'],
            'citekey': r['citekey'],
            'occurrence': r['occurrence'],
            'footnote_html': render(body, r['span_offset'], notes),
            'claim': r['claim'],
            'current_pin': r['pin'] if r['pinned'] else None,
            'pin_no_comma': r['pin_no_comma'],
            'decision': c.get('decision'),
            'reason': c.get('reason'),
            'signal': r['signal'],
            'parenthetical': r['parenthetical'],
            'pdf': r['pdf'] if r['pdf_exists'] else None,
            'bib_start': r['bib_start'],
        }

        printed, src = None, None
        fnpdf = (r['fn'], row['pdf'])
        # An Elsevier `pages` field records an ARTICLE NUMBER (e.g. 103810),
        # which is not a page -- pincite.page_offset refuses it for the same
        # reason. Shown as a printed page it is just a wrong number on screen.
        start = r['bib_start']
        if isinstance(start, int) and start >= P.ARTICLE_NUMBER_FLOOR:
            start = None
        for cand, tag in ((c.get('verified_page'), 'classified verified_page'),
                          (verified_fn.get(fnpdf), 'pincite.json verify.page'),
                          (guessed_fn.get(fnpdf), 'pincite.json answer.page'),
                          (start, 'bib start page')):
            if isinstance(cand, int):
                printed, src = cand, tag
                break
        row['printed_page'] = printed
        row['printed_page_source'] = src

        info = offsets.get(row['pdf'], r['bib_start']) if row['pdf'] else \
            dict(k=None, route=None, reason='no pdf for this citekey', n_pages=None)
        row['offset_k'] = info['k']
        row['offset_route'] = info['route']
        row['offset_reason'] = info['reason']
        row['pdf_n_pages'] = info['n_pages']

        page = None
        if row['pdf'] and printed is not None and info['k'] is not None:
            page = printed - info['k']
            if page < 1 or (info['n_pages'] and page > info['n_pages']):
                row['offset_reason'] = (
                    f"printed {printed} - offset {info['k']} = {page}, outside "
                    f"this PDF's {info['n_pages']} pages")
                page = None
        row['pdf_page'] = page
        out.append(row)

    if a.expect and len(out) != a.expect:
        print(f'FAIL: {len(out)} sites, expected {a.expect}', file=sys.stderr)
        return 1
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, indent=1, ensure_ascii=False) + '\n',
                        encoding='utf-8')

    # The page is the skill's asset and the copy is OUTPUT, never a source:
    # overwrite it every build so an edited copy can never outlive the asset.
    page_path = root / 'scratch/review/index.html'
    page_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ASSET, page_path)
    # index.html imports it, so it travels with the page.
    shutil.copyfile(ASSET.parent / 'persist.js', page_path.parent / 'persist.js')

    have_pdf = sum(1 for r in out if r['pdf'])
    have_page = sum(1 for r in out if r['pdf_page'])
    routes = {}
    for r in out:
        routes[r['offset_route']] = routes.get(r['offset_route'], 0) + 1
    rel_out = out_path.relative_to(root) if root in out_path.parents else out_path
    print(f'{len(out)} sites -> {rel_out}')
    print(f'  pinned already : {sum(1 for r in out if r["current_pin"])}')
    print(f'  with a pdf     : {have_pdf}   (no pdf: {len(out) - have_pdf})')
    print(f'  with a pdf_page: {have_page}')
    print('  offset_route   : ' + ', '.join(
        f'{k or "null"}={v}' for k, v in sorted(routes.items(), key=lambda kv: str(kv[0]))))
    if not classified_path.exists():
        print(f'  (no {classified_path.name}: no decision column)')
    if not state_path.exists():
        print(f'  (no {state_path.name}: best-guess pages are bibliography start pages)')
    print(f'  page           : {page_path.relative_to(root)} (copied from the skill asset)')
    print(f'  serve the REPO ROOT so the PDFs resolve: '
          f'python3 {ASSET.parent / "serve.py"} 8765 {root}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
