#!/usr/bin/env python3
"""Supply pincites for the manuscript's footnotes.

Four subcommands, run in order:

  candidates  parse opv-body.typ -> footnotes needing a pin, each paired with the
              claim it supports and the source PDF on disk
  triage      what the author must actually do, per source kind -- including the
              kinds that need NOTHING, which are most of them
  run         ask Gemini for the page, one request per candidate (Files API)
  verify      re-find each returned quote in the PDF and confirm the page
  report      the confirmed pincites, ready to paste

...and one the author drives, after reviewing by hand on the page
`review_build.py` writes:

  apply       a pincites.json export -> the manuscript. `set` inserts `, at N`,
              `keep` and `skip` edit nothing, all three are recorded. DRY RUN
              unless --confirm.

Every stage writes into ONE state file (--state, default scratch/pincite.json), so
a rerun resumes rather than re-uploading.

The verify stage is what makes the model's answer usable: it reports a page and a
quote, and only the quote can be checked mechanically. A quote that re-finds on a
page printing the claimed number is a confirmed pincite; anything else is a
human's problem.

Model choice is deliberate. gemini-batch's benchmark measured Pro as the most
CONSERVATIVE extractor (47% detection vs Flash's 70% on identical documents), and
under-extraction is the silent failure here -- a missed pincite looks like "the
source doesn't support it". A weaker quote is not silent; verify() catches it.
"""
import argparse, collections, concurrent.futures as cf, difflib, json, mimetypes, os, pathlib, re, subprocess, sys, time, urllib.error, urllib.request

# Layout is a convention, not a constant: every path is overridable, so the tool
# works on any manuscript rather than only the one it was written for.
ROOT = pathlib.Path.cwd()
BODY = PDFDIR = FRDIR = BIB = None

DEFAULTS = dict(
    body='paper/typst/body.typ',
    bib='paper/references/sources.bib',
    pdf_dir='paper/references/sources/pdf',
    fedreg_dir='paper/references/sources/fedreg',
)
BASE = 'https://generativelanguage.googleapis.com'
MODEL = 'gemini-3.5-flash'
# Author-identification footnotes render as *, dagger, double-dagger and take no
# Arabic number, so the body sequence is offset by however many a journal uses.
BIO = 3


def configure(root, body=None, bib=None, pdf_dir=None, fedreg_dir=None,
              bio_offset=None):
    """Point every module global at ONE manuscript repo.

    The globals are the tool's only notion of where a manuscript lives, so every
    caller -- the CLI, review_build.py, a test fixture -- retargets them here
    rather than assigning them one at a time and forgetting one."""
    global ROOT, BODY, BIB, PDFDIR, FRDIR, BIO
    ROOT = pathlib.Path(root).resolve()
    pick = lambda flag, key: (pathlib.Path(flag).resolve() if flag
                              else ROOT / DEFAULTS[key])
    BODY, BIB = pick(body, 'body'), pick(bib, 'bib')
    if not body and not BODY.exists():
        # A manuscript names its body file after itself -- `opv-body.typ`. Take
        # the one such file when there is exactly one, and never a generated
        # `-resolved` sibling; anything else is the author's `--body` to settle.
        found = [p for p in sorted(BODY.parent.glob('*body*.typ'))
                 if 'resolved' not in p.name]
        if len(found) == 1:
            BODY = found[0]
    PDFDIR, FRDIR = pick(pdf_dir, 'pdf_dir'), pick(fedreg_dir, 'fedreg_dir')
    if bio_offset is not None:
        BIO = bio_offset
    return ROOT


def thinking_level(model):
    """Lowest level the model accepts; Pro rejects MINIMAL (gemini-batch Gotcha 17)."""
    return 'LOW' if 'pro' in model else 'MINIMAL'

# ----------------------------------------------------------- source kinds
# A footnote without a resolvable PDF is not automatically a gap. Most of them
# need nothing at all, so they get a KIND and a disposition instead of one
# undifferentiated "no local PDF" bucket that reports false work.
#
# First match wins, top to bottom. This table is the whole classifier -- edit it
# here, not in classify().

KIND_PATTERNS = [
    ('case', re.compile(
        r'\b\d+\s+(?:F\.\s?\d?d|F\. ?Supp\.|U\.S\.|S\. ?Ct\.|A\.\d?d'
        r'|N\.E\.\d?d|Del\. ?Ch\.|WL)\s+\d+'
        r'|\bv\.\s+[A-Z]')),
    ('statute', re.compile(r'\b\d+\s+U\.S\.C\.|\bPub\. ?L\.|§+\s*\d|\bStat\.\s+\d')),
    ('regulation', re.compile(r'\bC\.F\.R\.|Fed\.\s*Reg\.|Release No|Exec\. Order')),
    ('legislative', re.compile(r'\bHearing\b|\bCong\.\b|H\.R\.|S\. ?Rep|GAO-|Cong\. Rsch')),
    ('web', re.compile(
        r'https?://|perma\.cc|N\.Y\. Times|Wall St\. J\.|Reuters|Bloomberg|Forum on Corp')),
    # Deliberately narrow, and deliberately last of the source types: a misfire
    # here sends a real article to the stub pile. Require an explicit book
    # signal AND the absence of a volume-reporter-page string.
    ('book', re.compile(
        # The book shape is `Author, Title Page (Year)` -- a bare page number
        # against a parenthetical year -- or an explicit edition/press marker.
        r'(?=.*(?:\b\d{1,4}\s*\(\d{4}\)|\b\d(?:st|nd|rd|th)\s+ed\.|\bed\.\s*\d{4}'
        r'|\bUniv(?:ersity|\.)\s+Press\b|\bPress,\s|\bPublish(?:ing|ers)\b))'
        # ...and nothing that looks like `Volume Reporter Page`, which is what
        # every journal article and every reporter cite carries.
        r'(?!.*\b\d+\s+[A-Z][\w.&\'’]*(?:\s+[A-Z\d][\w.&\'’]*)*\s+\d+\b)', re.S)),
    ('short-form', re.compile(r'\bsupra note|\bId\.|\binfra\b')),
]

DISPOSITION = {
    'none': 'NOTHING. Explanatory text or an internal cross-reference. Not a gap.',
    'short-form': 'NOTHING here. Inherits the parent cite\'s pin; `Id. at N` follows '
                  'the preceding note. Not a gap.',
    'pdf': 'The Gemini pipeline: `run`, then `verify`, then `report`.',
    'web': 'NOTHING to fetch. The perma.cc link IS the pin. Add a paragraph cite '
           'only if the journal asks for one.',
    'statute': 'NOTHING to fetch. The section number IS the pin.',
    'regulation': 'NOTHING to fetch. The section or the Fed. Reg. page IS the pin. '
                  '(A Fed. Reg. PDF already in --fedreg-dir resolves and becomes `pdf`.)',
    'case': 'OUT OF SCOPE. Needs Westlaw/Lexis STAR PAGINATION, which this tool '
            'cannot derive from a PDF. Flag it and stop.',
    'legislative': 'FETCHABLE from govinfo as a PDF. Drop it in --pdf-dir, add the bib '
                   'entry, re-run `candidates`.',
    'book': 'STUB. Needs a scan. No scan, no pincite from this tool.',
}

# The order kinds are reported in: work first, then nothing-to-do.
KIND_ORDER = ['pdf', 'legislative', 'case', 'book', 'web', 'statute', 'regulation',
              'short-form', 'none']


def classify(plain):
    """The kind of source this footnote cites, from the footnote's own text."""
    for kind, rx in KIND_PATTERNS:
        if rx.search(plain):
            return kind
    return 'none'

# ---------------------------------------------------------------- parsing

def strip_markup(s):
    s = re.sub(r'#(?:emph|strong|smallcaps)\[', '', s)
    s = re.sub(r'#ref\(<([^>]+)>\)', r'\1', s)
    s = s.replace('\\', '').replace(']', '')
    return re.sub(r'\s+', ' ', s).strip()


def footnotes(text):
    """(arabic_number, raw_body, preceding_prose) for each #footnote[...].

    The preceding text is PROSE ONLY. Typst footnotes sit inline in the
    paragraph, so a naive backward slice runs into the previous footnote's
    citation and hands the model "Comm. on the Judiciary, 119th Cong. (2025)."
    as though it were the claim. Accumulate only the text between footnotes."""
    out, i, n, prose = [], 0, 0, []
    while True:
        j = text.find('#footnote[', i)
        if j < 0:
            return out
        prose.append(text[i:j])
        k, depth = j + len('#footnote['), 1
        while k < len(text) and depth:
            if text[k] == '[':
                depth += 1
            elif text[k] == ']':
                depth -= 1
            k += 1
        n += 1
        out.append((n - BIO, text[j + len('#footnote['):k - 1],
                    ''.join(prose)[-700:]))
        i = k


def claim_of(before):
    """The sentence the footnote marker is attached to."""
    b = strip_markup(before)
    parts = [p for p in re.split(r'(?<=[.!?])\s+(?=[A-Z])', b) if p.strip()]
    return ' '.join(parts[-2:])[-400:]

# ------------------------------------------------------------- resolution

FR_CITE = re.compile(r'(\d+)\s+Fed\.\s*Reg\.\s*~?([\d,]+)')


def bib_index():
    """citekey -> (pdf path, first-author surname, year, start page or None).

    The bib is the authority: the manuscript cites by citekey and each entry
    carries `file = {...}`. Matching a footnote's prose against filenames was
    guesswork that sent 21 of 88 footnotes to the wrong PDF.

    `pages` is carried because it is the only INDEPENDENT check on the page
    numbering derived from the PDF -- see page_offset()."""
    if not BIB.exists():
        return {}
    out = {}
    for m in re.finditer(r'@\w+\{([^,]+),(.*?)\n\}', BIB.read_text(), re.S):
        key, body = m.group(1).strip(), m.group(2)

        def field(name):
            # the LAST field of an entry has no trailing newline -- the entry
            # regex consumed it -- so the line end must be optional
            f = re.search(r'\b' + name + r'\s*=\s*\{+(.*?)\}+\s*,?\s*(?:\n|$)', body, re.S)
            return re.sub(r'\s+', ' ', f.group(1)).strip() if f else ''

        path = field('file')
        if not path:
            continue
        author = field('author')
        sur = re.split(r'\s+and\s+|,', author)[0].split()[-1].lower() if author else ''
        pm = re.match(r'\s*(\d+)', field('pages'))
        out[key.lower()] = (ROOT / path, sur, field('year'),
                            int(pm.group(1)) if pm else None)
    return out


def bib_starts():
    """resolved PDF path -> the start page the bibliography records for it.

    Keyed by PATH rather than citekey so `verify` can look a row up from the
    `pdf` it already stores, instead of a citekey nobody wrote down. Deriving it
    here beats recording it on every row: a state file written before this
    existed still gets the check."""
    out = {}
    for path, _sur, _yr, start in bib_index().values():
        if start is not None:
            out.setdefault(str(path), start)
    return out


def fedreg_pdf(note):
    """The Federal Register PDF for a footnote citing one, if it has been fetched.

    A footnote citing Fed. Reg. pagination needs a Fed. Reg. pincite, so the SEC's
    own release PDF is the wrong source even when it is the same document -- its
    internal pagination is not the one the citation uses."""
    for vol, pg in FR_CITE.findall(note):
        f = FRDIR / f"fedreg-{vol}-{pg.replace(',', '').rstrip('.')}.pdf"
        if f.exists():
            return f
    return None


def resolve(note, bib):
    """The PDF this footnote cites.

    A footnote is usually a STRING CITE and the claim belongs to the source cited
    FIRST; the rest are "see also" support. So collect every source the note
    names, each with its position, and return the earliest.

    Sources are found two ways, both keyed to the bib: an explicit citekey label
    `<key>`, and -- for a full cite carrying no label -- the entry's own author
    surname with its year nearby. Requiring the year NEAR the name matters: a
    footnote-wide year test pairs one work's author with another work's date
    across a string cite."""
    plain = strip_markup(note)
    cands = []

    fr = fedreg_pdf(plain)
    if fr is not None:
        m = FR_CITE.search(plain)
        cands.append((m.start() if m else 0, fr))

    for m in re.finditer(r'<([a-zA-Z][\w\-]*)>', note):
        hit = bib.get(m.group(1).lower())
        if hit:
            at = plain.lower().find(hit[1]) if hit[1] else -1
            cands.append((at if at >= 0 else m.start(), hit[0]))

    for key, (path, sur, yr, _start) in bib.items():
        if not sur or not yr or len(sur) < 2:
            continue
        for m in re.finditer(r'\b' + re.escape(sur) + r'\b', plain, re.I):
            if yr in plain[m.start():m.start() + 220]:
                cands.append((m.start(), path))
                break

    if not cands:
        return None
    return min(cands, key=lambda c: c[0])[1]


# ------------------------------------------------------------- pin detection
# A footnote can already be pinned in two shapes, and only one of them says
# "at". Missing the other inflates the candidate set, and a bulk apply then
# DOUBLE-pins footnotes that were already correct.
#
#   at-form       `supra note 8, at 1279`      `Id. at *4`
#   journal-form  `51 Rev. Econ. Stud. 393, 394--99 (1984)`   <- pinned at 394
#                 `68 Fed. Reg. 6585, 6587--88 (Feb. 7, 2003)`
#
# The journal form is `<start page>, <pin page>` with no marker word at all, so
# it has to be told apart from three other things that also read as `N, N`.
# Every guard below exists for one of them.

# A number may carry thousands separators (`58,503`), so it is ONE token --
# matched atomically and before the bare-integer alternative. Splitting
# `58,503` into `58, 503` is the false pair this whole function guards against,
# and stripping commas globally would manufacture exactly that split.
_NUM = r'\d{1,3}(?:,\d{3})+|\d+'
# The pin separator is a comma followed by WHITESPACE (or a Typst `~` nbsp);
# a thousands separator never has one, which is what keeps the two apart.
PIN_PAIR = re.compile(rf'(?<![\d,])({_NUM}),[\s~ ]+({_NUM})')
# `No.` / `No.~` immediately before the pair means the first number is a
# release or order NUMBER, not a start page: `Exec. Order No. 14,366, 90 Fed.
# Reg. 58,503`, `Release No.~89,372, 85 Fed. Reg. 55,082`.
NO_PREFIX = re.compile(r'\bNos?\.[\s~ ]*$')
AT_PIN = re.compile(r'\bat[\s~ ]+\*?\d')
# The largest plausible distance from a source's first page to its pinned page.
# `Mar. 23, 2024` survives the year test only if the year is out of range, and
# unrelated adjacent numbers (a note number beside a page) are thousands apart.
PIN_MAX_GAP = 1000


def _num(tok):
    return int(tok.replace(',', ''))


def pin_span(cite):
    """The substring showing this footnote is already pinned, or None."""
    m = AT_PIN.search(cite)
    if m:
        # report the whole `at N`, span included: `at 394--99`
        tail = re.match(r'at[\s~ ]+\*?[\d,]+(?:\s*(?:--|–|-)\s*\d+)?',
                        cite[m.start():])
        return tail.group(0) if tail else m.group(0)
    for m in PIN_PAIR.finditer(cite):
        start, pin = _num(m.group(1)), _num(m.group(2))
        # a DATE: `(Feb. 9, 2018)`, `Mar. 23, 2024` -- the second number is a year
        if 1900 <= pin <= 2030 and len(m.group(2)) == 4:
            continue
        # a RELEASE or ORDER NUMBER, not a start page
        if NO_PREFIX.search(cite[:m.start()]):
            continue
        # a pin never precedes the page the source starts on
        if pin < start:
            continue
        # two numbers thousands apart are unrelated, not a page and its pin
        if pin - start > PIN_MAX_GAP:
            continue
        tail = re.match(rf'(?:{_NUM})(?:\s*(?:--|–|-)\s*\d+)?', cite[m.end(1) + 1:].lstrip(' ~ '))
        return f"{m.group(1)}, {tail.group(0) if tail else m.group(2)}"
    return None


def has_pincite(cite):
    """True when the footnote already carries a pincite, in EITHER form."""
    return pin_span(cite) is not None


GENERAL = re.compile(r'\b(see generally|e\.g\.,|cf\.)\b', re.I)


def build_candidates():
    text = BODY.read_text()
    bib = bib_index()
    rows = []
    for num, note, before in footnotes(text):
        if num < 1:
            continue
        pdf = resolve(note, bib)
        plain = strip_markup(note)
        # Resolution succeeding beats every textual label: a footnote whose
        # source is on disk is a `pdf` whatever its prose looks like.
        kind = 'pdf' if pdf is not None else classify(plain)
        # Record the pin, because `cite` is truncated and a Fed. Reg. pin can
        # sit past the cut -- re-deriving it downstream would disagree with the
        # classification made here.
        pin = pin_span(plain)
        why = None
        if pdf is None:
            why = kind
        elif pin:
            why = 'already has a pin'
        elif GENERAL.search(plain):
            why = 'general signal'
        rows.append(dict(fn=num, kind=kind, claim=claim_of(before), cite=plain[:300],
                         pin=pin, pdf=str(pdf.relative_to(ROOT)) if pdf else None,
                         skip=why))
    return rows

# ------------------------------------------------------------------ model

SCHEMA = {
    "type": "object",
    "properties": {
        "supported": {"type": "string", "enum": ["YES", "PARTIAL", "NO"]},
        "page": {"type": "string"},
        "quote": {"type": "string"},
        "note": {"type": "string"},
    },
    "required": ["supported", "page", "quote", "note"],
}

PROMPT = """You are supplying a pincite for a law review article.

CLAIM in the manuscript:
{claim}

FOOTNOTE as it currently reads:
{cite}

The attached PDF is the source this footnote cites. Find the page that most directly supports the CLAIM.

Rules:
- Report the PRINTED page number shown on the page itself (the journal or report page), NOT the PDF page index.
- The quote must be copied verbatim from that page, one or two sentences.
- Prefer the page where the finding or argument is actually stated, not the abstract, not a literature-review mention, not the reference list.
- If the source does not support the claim, answer NO and say why in note. Do not stretch to find something."""


def _post(url, data, headers, retries=5):
    for a in range(retries):
        try:
            req = urllib.request.Request(url, data=data, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=300) as r:
                return json.load(r)
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
            code = getattr(e, 'code', None)
            if a < retries - 1 and (code is None or code in (429, 500, 502, 503)):
                time.sleep(2 ** a * 3)
                continue
            raise


def upload(path, key):
    data = pathlib.Path(path).read_bytes()
    mime = mimetypes.guess_type(str(path))[0] or 'application/pdf'
    req = urllib.request.Request(
        f'{BASE}/upload/v1beta/files?key={key}', method='POST',
        data=json.dumps({'file': {'display_name': os.path.basename(str(path))}}).encode(),
        headers={'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start',
                 'X-Goog-Upload-Header-Content-Length': str(len(data)),
                 'X-Goog-Upload-Header-Content-Type': mime, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        up = r.headers['X-Goog-Upload-URL']
    req = urllib.request.Request(up, method='POST', data=data,
        headers={'Content-Length': str(len(data)), 'X-Goog-Upload-Offset': '0',
                 'X-Goog-Upload-Command': 'upload, finalize'})
    with urllib.request.urlopen(req) as r:
        f = json.load(r)['file']
    for _ in range(60):
        if f.get('state') == 'ACTIVE':
            return f
        time.sleep(2)
        with urllib.request.urlopen(f"{BASE}/v1beta/{f['name']}?key={key}") as r:
            f = json.load(r)
    raise RuntimeError(f"{path} never became ACTIVE")


def ask(row, furi, mime, key):
    cfg = {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0}
    if MODEL.startswith('gemini-3'):
        cfg["thinkingConfig"] = {"thinkingLevel": thinking_level(MODEL)}
    body = {"contents": [{"parts": [
                {"file_data": {"mime_type": mime, "file_uri": furi}},
                {"text": PROMPT.format(claim=row['claim'], cite=row['cite'])}]}],
            "generationConfig": cfg}
    out = _post(f'{BASE}/v1beta/models/{MODEL}:generateContent?key={key}',
                json.dumps(body).encode(), {'Content-Type': 'application/json'})
    cand = (out.get('candidates') or [{}])[0]
    parts = (cand.get('content') or {}).get('parts') or []
    if not parts:
        raise RuntimeError(f"empty response ({cand.get('finishReason')})")
    return json.loads(parts[0]['text'])

# ----------------------------------------------------------- verification

# Publisher watermarks are injected into the text stream MID-SENTENCE, so a real
# quote splits in half and exact matching reports a fabrication.
WATERMARK = re.compile(
    r'Downloaded from \S+.*?(?=\s[A-Z])'
    r'|This content downloaded from[^\n]*'
    r'|All use subject to[^\n]*'
    r'|by [^\n]*user on \d{1,2} \w+ \d{4}', re.I | re.S)


def norm(s):
    s = WATERMARK.sub(' ', s).replace('’', "'").replace('“', '"').replace('”', '"')
    return re.sub(r'\s+', ' ', s.replace('-\n', '')).strip()


def pages_of(pdf):
    return subprocess.run(['pdftotext', '-layout', str(pdf), '-'],
                          capture_output=True, text=True).stdout.split('\f')


# A verso running head carries the volume and the article's START page
# ("SOUTHERN CALIFORNIA LAW REVIEW   [Vol. 82:649"), and that trailing number is
# not this page's folio. Left in, it mints a spurious candidate on every verso.
VOL_HEAD = re.compile(r'\[\s*Vol\.?[^\]\n]*')

# Front matter a scan can carry ahead of the article's first printed page: a
# HeinOnline cover leaf, a journal title page -- plus slack for a bib whose
# `pages` records where the author's own text starts rather than the first
# printed page (fisch1994 is filed at 1012 and prints 1009).
FRONT_MAX = 12
# One stray number in the corroboration window is a coincidence -- footnote page
# cites land there routinely. Two pages agreeing on the same offset is a
# numbering: a CONSTANT number repeated across pages yields a DIFFERENT k on
# every page and can never accumulate, so only a real folio counts twice.
MIN_CORROB_HITS = 2
# Share of pages carrying the modal offset that is convincing on its own. A short
# document cannot clear the dominance test at all -- a 4-page Federal Register
# excerpt has fewer than the 5 votes it demands -- so this route is what covers
# them.
MIN_CONF = 0.50
# Elsevier-style journals record an ARTICLE NUMBER in `pages` (`154 (2024)
# 103810`) and paginate the version of record 1-N. It is not a page: it can
# neither corroborate an offset nor contradict one, so it is treated as no start
# page at all. Without this the 1-N pagination that IS correct for those journals
# reads as a preprint.
ARTICLE_NUMBER_FLOOR = 100_000


def page_numbers(page):
    """Candidate printed numbers for one page.

    The number sits in the running header or footer, usually BESIDE other text
    ("2008]   THE HANGING CHADS OF CORPORATE VOTING   1279"), so a bare-number
    line is the exception, not the rule. Take numbers anchored to the start or
    end of the outermost non-empty lines."""
    lines = [l for l in page.split('\n') if l.strip()]
    out = set()
    for l in lines[:2] + lines[-2:]:
        t = VOL_HEAD.sub('', l).strip()
        m = re.match(r'^(\d{1,6})\b', t)
        if m:
            out.add(int(m.group(1)))
        m = re.search(r'\b(\d{1,6})$', t)
        if m:
            out.add(int(m.group(1)))
    return out


def offset_votes(pages):
    """Counter of k = printed - pdf_index, over every candidate number."""
    c = collections.Counter()
    for i, p in enumerate(pages, 1):
        for n in page_numbers(p):
            c[n - i] += 1
    return c


def page_offset(pages, bib_start=None):
    """Which offset k makes printed_page == pdf_index + k, and whether to trust it.

    Reading one page's header cannot tell a page number from a year or a
    footnote number, so the offset is the MODE of k across the document -- only
    the true numbering advances in lockstep with the PDF index.

    The mode's own share of pages cannot say whether a THIN mode is right. A
    clean article whose scan lost most folios (fisch1994: 15 votes of 42, share
    0.36) and a scan that lost all of them (choi2009: the mode is 2 votes of 56)
    look the same from inside the counter, and one of those answers is correct
    while the other is off by six hundred pages. So bring in evidence from
    OUTSIDE the PDF.

    Two routes, corroboration first because it is the independent one:

      corroboration  the bibliography records where the work STARTS. Under
                     offset k the article's first printed page is k+1, so the
                     cited start page must sit at pdf index `start - k` -- a
                     small positive number, inside the front matter. A garbage
                     offset puts it off the end of the document. This promotes a
                     thin-but-right mode and refuses a thin-and-wrong one, which
                     loosening the dominance threshold cannot do: fisch1994's
                     1008 puts the start at pdf page 4, choi2009's modal 23 puts
                     it at page 626 of a 56-page PDF.
      dominance      no bib start to check against, or the mode is overwhelming
                     anyway. Still refused when the bib start falls outside the
                     printed range the offset implies -- that is the preprint,
                     whose pages are real but are not the published ones.

    Returns dict(k, confidence, hits, accepted, route, reason). `k` is reported
    even when refused, so a caller can say what it rejected."""
    c = offset_votes(pages)
    n = max(1, len(pages))
    if not c:
        return dict(k=None, confidence=0.0, hits=0, accepted=False, route=None,
                    reason='no page numbers found in this PDF')
    top = c.most_common(2)
    mk, hits = top[0]
    runner = top[1][1] if len(top) > 1 else 0
    if bib_start is not None and bib_start >= ARTICLE_NUMBER_FLOOR:
        bib_start = None

    if bib_start is not None:
        # Every offset that would place the bib's start page in the front
        # matter, best-supported first. Ties are refused rather than guessed.
        ok = sorted(((h, k) for k, h in c.items()
                     if h >= MIN_CORROB_HITS and 1 <= bib_start - k <= min(FRONT_MAX, n)),
                    reverse=True)
        if ok and (len(ok) == 1 or ok[0][0] > ok[1][0]):
            h, k = ok[0]
            return dict(k=k, confidence=round(h / n, 2), hits=h, accepted=True,
                        route='corroborated',
                        reason=f'bib start {bib_start} lands on pdf page {bib_start - k}')
        if ok:
            return dict(k=ok[0][1], confidence=round(ok[0][0] / n, 2), hits=ok[0][0],
                        accepted=False, route=None,
                        reason=f'two offsets fit bib start {bib_start}; check the page by hand')

    # A numbering can be right yet rare: papers whose headers carry a number on
    # only a quarter of pages still number those consistently, while a document
    # with no usable numbering produces ties. Dominance over the runner-up
    # catches the first case without admitting the second.
    conf = round(hits / n, 2)
    dominant = (hits >= 5 and hits >= 3 * max(1, runner)) or conf >= MIN_CONF
    if not dominant:
        return dict(k=mk, confidence=conf, hits=hits, accepted=False, route=None,
                    reason='page numbering not readable; check the page by hand')
    # A dominant offset whose printed range does not contain the work's start
    # page is numbering some OTHER version of it -- a preprint, or an
    # advance-access proof paginated 1-N. Its pages are real and still wrong.
    if bib_start is not None and not (mk + 1 <= bib_start <= mk + n):
        return dict(k=mk, confidence=conf, hits=hits, accepted=False, route=None,
                    reason=f'pages {mk + 1}-{mk + n} do not contain bib start '
                           f'{bib_start}; wrong version of this work?')
    return dict(k=mk, confidence=conf, hits=hits, accepted=True, route='dominant',
                reason='')


def coverage(quote, page):
    """Fraction of the quote that appears, IN ORDER, on the page.

    Comparing fixed-width windows fails whenever text is injected INTO a quote --
    a publisher watermark, a column gutter, a footnote marker mid-sentence -- and
    that is common enough to have sunk 11 of 17 real quotes in the first run.
    Summing the matching blocks tolerates insertions but not reordering, which is
    exactly the discrimination wanted."""
    a, b = norm(quote), norm(page)
    if not a:
        return 0.0
    sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
    return sum(bl.size for bl in sm.get_matching_blocks()) / len(a)


# ------------------------------------------------- vision fallback (offset only)
# LAST resort, and only for the offset. Some scans lose every folio from the text
# layer while the page image still shows it plainly, and pdftotext cannot get it
# back. The number the model reads is never believed on its own: two pages are
# read and the folios must advance in lockstep with the pdf index, and the offset
# they imply must still corroborate against the bibliography's start page. A
# single page read would be exactly the unverified number this tool exists to
# refuse.

FOLIO_SCHEMA = {"type": "object",
                "properties": {"page": {"type": "string"}},
                "required": ["page"]}
FOLIO_PROMPT = ("This is one page of a scanned journal article. Report ONLY the printed "
                "page number (the folio) shown in the running head or foot of this page. "
                "Answer with the digits alone, or NONE if the page shows no number.")


def page_image(pdf, index, dpi=150):
    """PNG bytes for one PDF page, cropped to nothing -- the folio is in the margins."""
    out = subprocess.run(
        ['pdftoppm', '-png', '-r', str(dpi), '-f', str(index), '-l', str(index), str(pdf)],
        capture_output=True)
    if out.returncode or not out.stdout:
        raise RuntimeError(f'pdftoppm failed on page {index}: {out.stderr[:200]!r}')
    return out.stdout


def read_folio(pdf, index, key):
    """The printed number the model reads off this page's IMAGE, or None."""
    import base64
    body = {"contents": [{"parts": [
                {"inline_data": {"mime_type": "image/png",
                                 "data": base64.b64encode(page_image(pdf, index)).decode()}},
                {"text": FOLIO_PROMPT}]}],
            "generationConfig": {"responseMimeType": "application/json",
                                 "responseSchema": FOLIO_SCHEMA, "temperature": 0}}
    out = _post(f'{BASE}/v1beta/models/{MODEL}:generateContent?key={key}',
                json.dumps(body).encode(), {'Content-Type': 'application/json'})
    parts = ((out.get('candidates') or [{}])[0].get('content') or {}).get('parts') or []
    if not parts:
        return None
    m = re.search(r'\d{1,6}', json.loads(parts[0]['text']).get('page', ''))
    return int(m.group(0)) if m else None


def vision_offset(pdf, n_pages, bib_start, key, probes=(0.45, 0.75)):
    """The offset read off two page IMAGES, or None when it cannot be corroborated."""
    a, b = (max(2, min(n_pages, int(n_pages * f))) for f in probes)
    if a == b:
        return None
    try:
        fa, fb = read_folio(pdf, a, key), read_folio(pdf, b, key)
    except Exception as e:
        return dict(k=None, accepted=False, route='vision',
                    reason=f'vision read failed: {type(e).__name__}: {str(e)[:120]}')
    if fa is None or fb is None:
        return dict(k=None, accepted=False, route='vision',
                    reason=f'no folio visible on pdf pages {a}/{b}')
    if fb - fa != b - a:
        return dict(k=fa - a, accepted=False, route='vision',
                    reason=f'folios {fa}@{a} and {fb}@{b} do not advance in lockstep')
    k = fa - a
    if bib_start is None or not (1 <= bib_start - k <= min(FRONT_MAX, n_pages)):
        return dict(k=k, accepted=False, route='vision',
                    reason=f'vision offset {k} not corroborated by bib start {bib_start}')
    return dict(k=k, confidence=None, hits=2, accepted=True, route='vision',
                reason=f'folios {fa}@{a}, {fb}@{b}; bib start {bib_start} '
                       f'lands on pdf page {bib_start - k}')


def verify(pdf, quote, claimed, bib_start=None, threshold=0.90, vision_key=None):
    """Confirm a pincite WITHOUT trusting the model's page number.

    Find the quote in the PDF, then compute which printed page it sits on from
    the document's own numbering. The model's page is only ever compared against
    that -- never believed."""
    if not quote.strip():
        return dict(ok=False, score=0.0, reason='empty quote')
    pages = pages_of(pdf)
    score, pg = max(((coverage(quote, p), i) for i, p in enumerate(pages, 1)),
                    default=(0.0, None))
    if score < threshold:
        return dict(ok=False, score=round(score, 3), pdf_page=pg,
                    reason='quote not found in this PDF')
    off = page_offset(pages, bib_start)
    if not off['accepted'] and vision_key:
        v = vision_offset(pdf, len(pages), bib_start, vision_key)
        if v:
            off = {**off, **v}
    if not off['accepted']:
        return dict(ok=False, score=round(score, 3), pdf_page=pg,
                    confidence=off['confidence'], reason=off['reason'])
    actual = pg + off['k']
    want = str(claimed).split('-')[0].strip()
    agree = want.isdigit() and int(want) == actual
    return dict(ok=agree, score=round(score, 3), pdf_page=pg, page=actual,
                confidence=off['confidence'], route=off['route'], reason='' if agree
                else f'model said {claimed}, quote sits on {actual}')


# ------------------------------------------------- sites, and applying pins
# A SITE is one `#ref(<key>)` inside a numbered footnote, and its IDENTITY is
# (fn, citekey, occurrence) -- the nth time that citekey appears in that
# footnote. NEVER a byte offset: every inserted `, at N` shifts every later
# offset, so an offset-keyed decision is invalidated by the work it describes.

SITE_RX = re.compile(r'#ref\(<([^>]+)>\)')
# The Bluebook pin this tool writes, and the strict rule the gate reads.
AT_TIGHT = re.compile(r'\s*,\s*at\s+\d')
# The same page cite with its comma missing -- `supra note 8 at 1279`. Pinning
# on top of one yields `at 12--13, at 5`, which reads as two pins.
AT_LOOSE = re.compile(r'\s+at\s+\*?[\d,]+(?:\s*(?:--|–|-)\s*\d+)?')


def footnote_spans(text):
    """(fn, body_start, body_end) for every `#footnote[...]`, in file order."""
    out, i, n = [], 0, 0
    while True:
        j = text.find('#footnote[', i)
        if j < 0:
            return out
        k, depth = j + len('#footnote['), 1
        while k < len(text) and depth:
            if text[k] == '[':
                depth += 1
            elif text[k] == ']':
                depth -= 1
            k += 1
        n += 1
        out.append((n - BIO, j + len('#footnote['), k - 1))
        i = k


def sites(text):
    """Every citation site, as dicts keyed by (fn, citekey, occurrence)."""
    out = []
    for fn, a, b in footnote_spans(text):
        if fn < 1:
            continue
        body, seen = text[a:b], {}
        for m in SITE_RX.finditer(body):
            key = m.group(1)
            seen[key] = seen.get(key, 0) + 1
            tail = body[m.end():m.end() + 16]
            pinned = bool(AT_TIGHT.match(tail))
            loose = None if pinned else AT_LOOSE.match(tail)
            out.append(dict(fn=fn, citekey=key, occurrence=seen[key],
                            fn_start=a, fn_end=b,
                            ref_start=a + m.start(), ref_end=a + m.end(),
                            pinned=pinned,
                            pin_no_comma=loose.group(0).strip() if loose else None))
    return out


PIN_HEAD = re.compile(r'^\s*(?:,\s*)?(?:at\s+)?', re.I)
PIN_BODY = re.compile(r'^\*?\d[\d,]*(?:\s*(?:--|–|-)\s*\*?\d[\d,]*)?$')


def normalize_pin(pin):
    """`at 1256` / `, at 1256` / `1256` -> `1256`; anything else is refused."""
    p = PIN_HEAD.sub('', str(pin or '')).strip().rstrip('.,;')
    return p if PIN_BODY.match(p) else None


def pin_page(pin):
    """The integer page a pin names, for `verified_page`. A range gives its first."""
    m = re.match(r'\*?(\d[\d,]*)', normalize_pin(pin) or '')
    return int(m.group(1).replace(',', '')) if m else None


def _author_row(dec, page, prior):
    """The classified row an author decision leaves behind.

    A hand-entered pin traces to no model verification, so `set` records the page
    as the AUTHOR'S assertion: `source: author`, and a reason saying so. `source`
    is the field that keeps the two provenances apart, and a report that shows an
    author pin and a machine-verified one as the same thing is the defect it
    exists to prevent -- so a row already carrying a model decision keeps its
    decision, reason and source through a `keep` or a `skip`, which change no
    page and assert none. Those record only what the author did."""
    row = dict(prior) if prior else dict(
        fn=dec['fn'], citekey=dec['citekey'], occurrence=dec['occurrence'])
    note = (dec.get('note') or '').strip()
    if dec['action'] == 'set':
        row['decision'] = 'specific'
        row['verified_page'] = page
        row['reason'] = note or (
            f'Author entered this pincite by hand during review and asserts the '
            f'cited material is on page {page}. Not machine-verified.')
        row['source'] = 'author'
    elif not prior:
        # No prior record: this row IS the author's, and the file's schema wants
        # a decision and a reason on every row.
        row['decision'] = 'specific' if dec['action'] == 'keep' else 'unresolvable'
        if dec['action'] == 'keep' and page is not None:
            row['verified_page'] = page
        row['reason'] = note or (
            'Author reviewed this site and let the existing pincite stand.'
            if dec['action'] == 'keep' else
            'Author reviewed this site and entered no pincite.')
        row['source'] = 'author'
    row['author_action'] = dec['action']
    if note:
        row['author_note'] = note
    return row


def apply_pincites(decisions, confirm=False, classified=None):
    """Apply the review page's export into the manuscript configured by configure().

    `set` inserts `, at <pin>` at its site; `keep` and `skip` edit nothing. All
    three are recorded in scratch/percite-classified.json -- the run's existing
    state file, not a new one -- so a hand-entered pin has a provenance record to
    trace to instead of failing the gate that demands one.

    Nothing is written unless `confirm`. A run that cannot satisfy every one of
    its `set` edits writes NOTHING: a partial application leaves the manuscript
    in a state no export describes."""
    text = BODY.read_text()
    by_id = {(s['fn'], s['citekey'], s['occurrence']): s for s in sites(text)}
    classified = pathlib.Path(classified) if classified else \
        ROOT / 'scratch/percite-classified.json'

    errors, edits, records = [], [], []
    seen = set()
    for i, dec in enumerate(decisions):
        try:
            ident = (dec['fn'], dec['citekey'], int(dec.get('occurrence', 1)))
        except (KeyError, TypeError, ValueError):
            errors.append(f'decision {i}: missing fn/citekey/occurrence')
            continue
        dec = dict(dec, fn=ident[0], citekey=ident[1], occurrence=ident[2])
        where = f'fn {ident[0]} <{ident[1]}> #{ident[2]}'
        if dec.get('action') not in ('keep', 'set', 'skip'):
            errors.append(f'{where}: action {dec.get("action")!r} is not keep/set/skip')
            continue
        site = by_id.get(ident)
        if site is None:
            errors.append(f'{where}: not a citation site in the manuscript')
            continue
        if ident in seen:
            errors.append(f'{where}: decided twice in this export')
            continue
        seen.add(ident)

        page = pin_page(dec.get('pin'))
        if page is None and dec['action'] == 'keep':
            # A `keep` with an empty pin box means "what is in the manuscript
            # stands", so read the page out of the manuscript rather than
            # recording a decision with no page at all.
            m = re.match(r'\s*,\s*at\s+(\d[\d,]*)', text[site['ref_end']:site['ref_end'] + 16])
            page = int(m.group(1).replace(',', '')) if m else None
        if dec['action'] == 'set':
            pin = normalize_pin(dec.get('pin'))
            if not pin:
                errors.append(f'{where}: set with no readable page ({dec.get("pin")!r})')
                continue
            if site['pinned']:
                errors.append(f'{where}: already carries a pincite; pinning again '
                              f'would double-pin')
                continue
            if site['pin_no_comma']:
                errors.append(f'{where}: already carries `{site["pin_no_comma"]}`, a '
                              f'page cite missing its comma; pinning would double-pin')
                continue
            # The match string is the site plus whatever punctuation closes it,
            # and it must be UNIQUE inside this footnote's own span. Two sites a
            # substitution cannot tell apart are two sites this tool refuses.
            body = text[site['fn_start']:site['fn_end']]
            tail = text[site['ref_end']:site['ref_end'] + 1]
            match = f'#ref(<{ident[1]}>)' + (tail if tail in '.,;:' else '')
            n = body.count(match)
            if n != 1:
                errors.append(f'{where}: {n} occurrences of {match!r} in the footnote '
                              f'span, expected exactly 1')
                continue
            edits.append((site['ref_end'], f', at {pin}', where, match))
        records.append((ident, dec, page))

    if errors:
        return dict(ok=False, dry_run=not confirm, errors=errors,
                    edits=[], applied=0, recorded=0, wrote=False)

    out = text
    for at, ins, _where, _match in sorted(edits, reverse=True):
        out = out[:at] + ins + out[at:]
    if out.count('#footnote[') != text.count('#footnote['):
        return dict(ok=False, dry_run=not confirm, applied=0, recorded=0, wrote=False,
                    errors=['the edit changed the footnote count; refusing to write'],
                    edits=[])

    rows = []
    if classified.exists():
        rows = json.loads(classified.read_text())
    index = {(r.get('fn'), r.get('citekey'), r.get('occurrence', 1)): i
             for i, r in enumerate(rows)}
    for ident, dec, page in records:
        row = _author_row(dec, page, rows[index[ident]] if ident in index else None)
        if ident in index:
            rows[index[ident]] = row
        else:
            rows.append(row)

    if confirm:
        BODY.write_text(out)
        classified.parent.mkdir(parents=True, exist_ok=True)
        classified.write_text(json.dumps(rows, indent=1, ensure_ascii=False) + '\n',
                              encoding='utf-8')
    return dict(ok=True, dry_run=not confirm, errors=[], wrote=bool(confirm),
                applied=len(edits), recorded=len(records),
                edits=[dict(where=w, insert=i, match=m) for _a, i, w, m in edits],
                classified=str(classified))


# ------------------------------------------------------------------- main

def load(p):
    return json.loads(pathlib.Path(p).read_text()) if pathlib.Path(p).exists() else {}


def save(p, st):
    pathlib.Path(p).parent.mkdir(parents=True, exist_ok=True)
    pathlib.Path(p).write_text(json.dumps(st, indent=1))


def main():
    global ROOT, BODY, BIB, PDFDIR, FRDIR, BIO, MODEL
    ap = argparse.ArgumentParser()
    ap.add_argument('cmd', choices=['candidates', 'triage', 'run', 'verify', 'report',
                                    'apply'])
    ap.add_argument('--root', default='.', help='manuscript repo root (default: cwd)')
    ap.add_argument('--body', help=f"manuscript .typ (default: {DEFAULTS['body']})")
    ap.add_argument('--bib', help=f"bibliography (default: {DEFAULTS['bib']})")
    ap.add_argument('--pdf-dir', help=f"source PDFs (default: {DEFAULTS['pdf_dir']})")
    ap.add_argument('--fedreg-dir', help=f"Fed. Reg. PDFs (default: {DEFAULTS['fedreg_dir']})")
    ap.add_argument('--bio-offset', type=int, default=3,
                    help='leading footnotes marked *, dagger etc. taking no number (default 3)')
    ap.add_argument('--model', default=MODEL, help=f'Gemini model (default {MODEL})')
    ap.add_argument('--state', default=None, help='state file (default <root>/scratch/pincite.json)')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--only', default='', help='comma-separated footnote numbers')
    ap.add_argument('--workers', type=int, default=6)
    ap.add_argument('--redo', action='store_true', help='re-ask footnotes already answered')
    ap.add_argument('--from', dest='from_', default=None,
                    help="apply: the review page's pincites.json export")
    ap.add_argument('--classified', default=None,
                    help='apply: decision record (default <root>/scratch/percite-classified.json)')
    ap.add_argument('--confirm', action='store_true',
                    help='apply: actually write; without it the run is a dry run')
    ap.add_argument('--vision-fallback', action='store_true',
                    help='when the text route cannot read the numbering, read the folio '
                         'off two page IMAGES and corroborate (verify only; costs API calls)')
    a = ap.parse_args()
    configure(a.root, a.body, a.bib, a.pdf_dir, a.fedreg_dir, a.bio_offset)
    MODEL = a.model
    a.state = a.state or str(ROOT / 'scratch/pincite.json')
    if not BODY.exists():
        sys.exit(f"no manuscript at {BODY} (pass --body)")

    if a.cmd == 'apply':
        if not a.from_:
            sys.exit('apply needs --from <pincites.json>')
        decisions = json.loads(pathlib.Path(a.from_).read_text())
        res = apply_pincites(decisions, confirm=a.confirm, classified=a.classified)
        for e in res['errors']:
            print(f'  {e}', file=sys.stderr)
        if not res['ok']:
            print(f"\nREFUSED — {len(res['errors'])} problem(s); nothing written",
                  file=sys.stderr)
            return 1
        for e in res['edits']:
            print(f"  {e['where']}: {e['match']} -> insert `{e['insert']}`")
        print(f"\n{res['applied']} pin(s) to insert, {res['recorded']} decision(s) "
              f"recorded in {res['classified']}")
        print('WROTE' if res['wrote'] else 'DRY RUN — nothing written; pass --confirm')
        return 0

    st = load(a.state)

    if a.cmd == 'candidates':
        from collections import Counter
        rows = build_candidates()
        old = {r['fn']: r for r in st.get('rows', [])}
        for r in rows:
            prev = old.get(r['fn'])
            if not prev or 'answer' not in prev:
                continue
            # Keep an answer across a re-parse ONLY if it was asked about the same
            # source and the same claim. A resolver fix that repoints a footnote
            # at a different PDF invalidates its answer; silently keeping it is
            # how a stale pincite survives the fix meant to correct it.
            if prev.get('pdf') != r['pdf'] or prev.get('claim') != r['claim']:
                continue
            r['answer'] = prev['answer']
            if 'verify' in prev:
                r['verify'] = prev['verify']
        st['rows'] = rows
        save(a.state, st)
        live = [r for r in rows if not r['skip']]
        kinds = Counter(r['kind'] for r in rows)
        print(f"footnotes: {len(rows)}")
        print("\nby kind:")
        for k in KIND_ORDER:
            if kinds.get(k):
                print(f"  {kinds[k]:4d}  {k:<12s} {DISPOSITION[k].split('.')[0]}")
        print("\nof the pdf footnotes:")
        for why, n in Counter(r['skip'] or 'CANDIDATE' for r in rows
                              if r['kind'] == 'pdf').most_common():
            print(f"  {n:4d}  {why}")
        print(f"\ncandidates: {[r['fn'] for r in live][:40]}{' ...' if len(live) > 40 else ''}")
        print("\n`triage` says what to do about every other kind.")
        return

    rows = st.get('rows') or []
    if not rows:
        sys.exit("run `candidates` first")

    if a.cmd == 'triage':
        by = collections.defaultdict(list)
        for r in rows:
            by[r['kind']].append(r)
        print(f"{len(rows)} footnotes. What is actually left to do:\n")
        for k in KIND_ORDER:
            group = by.get(k)
            if not group:
                continue
            print(f"{k}  ({len(group)})")
            print(f"  -> {DISPOSITION[k]}")
            if k == 'pdf':
                todo = [r['fn'] for r in group if not r['skip']]
                pinned = [r['fn'] for r in group if r['skip'] == 'already has a pin']
                gen = [r['fn'] for r in group if r['skip'] == 'general signal']
                print(f"     {len(todo)} to ask: {todo}")
                if pinned:
                    print(f"     {len(pinned)} already pinned: {pinned}")
                if gen:
                    print(f"     {len(gen)} general signal, no pin wanted: {gen}")
            else:
                print(f"     fn {[r['fn'] for r in group]}")
            print()
        need = sum(len(by.get(k, [])) for k in ('pdf', 'legislative', 'case', 'book'))
        nothing = len(rows) - need
        print(f"{nothing} of {len(rows)} footnotes need NOTHING "
              f"(none, short-form, web, statute, regulation).")
        return

    if a.cmd == 'run':
        key = os.environ['GOOGLE_API_KEY']
        want = [r for r in rows if not r['skip'] and (a.redo or 'answer' not in r)]
        if a.only:
            keep = {int(x) for x in a.only.split(',')}
            want = [r for r in rows if r['fn'] in keep and not r['skip']]
        if a.limit:
            want = want[:a.limit]
        print(f"model {MODEL}; asking for {len(want)} pincites", file=sys.stderr)
        cache = st.setdefault('files', {})
        for pdf in sorted({r['pdf'] for r in want}):
            f = cache.get(pdf)
            if f and f.get('expire', 0) > time.time():
                continue
            up = upload(ROOT / pdf, key)
            cache[pdf] = dict(uri=up['uri'], mime=up['mimeType'], expire=time.time() + 40 * 3600)
            print(f"  uploaded {pathlib.Path(pdf).name}", file=sys.stderr)
            save(a.state, st)

        def work(r):
            c = cache[r['pdf']]
            try:
                return r['fn'], ask(r, c['uri'], c['mime'], key)
            except Exception as e:
                return r['fn'], dict(supported='ERROR', page='', quote='', note=f"{type(e).__name__}: {str(e)[:180]}")

        by = {r['fn']: r for r in rows}
        with cf.ThreadPoolExecutor(a.workers) as ex:
            for fn, ans in ex.map(work, want):
                by[fn]['answer'] = ans
                by[fn].pop('verify', None)
                print(f"  fn{fn}: {ans['supported']} {ans['page']}", file=sys.stderr)
        save(a.state, st)
        return

    if a.cmd == 'verify':
        done = [r for r in rows if r.get('answer')]
        starts = bib_starts()
        vkey = os.environ.get('GOOGLE_API_KEY') if a.vision_fallback else None
        if a.vision_fallback and not vkey:
            sys.exit('--vision-fallback needs GOOGLE_API_KEY')
        for r in done:
            ans = r['answer']
            if ans['supported'] in ('NO', 'ERROR'):
                r['verify'] = dict(ok=False, score=0.0, reason=ans['supported'].lower())
                continue
            r['verify'] = verify(ROOT / r['pdf'], ans['quote'], ans['page'],
                                 bib_start=starts.get(str(ROOT / r['pdf'])),
                                 vision_key=vkey)
        save(a.state, st)
        ok = [r for r in done if r['verify']['ok']]
        print(f"answered {len(done)}, CONFIRMED {len(ok)}")
        for r in done:
            if not r['verify']['ok']:
                print(f"  fn{r['fn']:3d} {r['answer']['supported']:8s} "
                      f"p{(r['answer']['page'] or '-'):>6s}  score {r['verify'].get('score','-'):<6} "
                      f"{r['verify'].get('reason','')}")
        return

    if a.cmd == 'report':
        def block(r):
            print(f"    claim : {r['claim'][:150]}")
            print(f"    source: {pathlib.Path(r['pdf']).name}")
            print(f"    quote : “{r['answer']['quote'][:200]}”")
            print()

        # `pin` is recorded by `candidates`; a state file written before it
        # existed has none, so fall back to the (truncated) cite rather than
        # reporting every stale row as clean.
        def row_pin(r):
            return r['pin'] if 'pin' in r else pin_span(r['cite'])

        confirmed = [r for r in rows if (r.get('verify') or {}).get('ok')]
        # A confirmed row that ALREADY carries a pin is not a pincite to paste.
        # Either the tool agrees (nothing to do) or it disagrees with the
        # author's own page -- and a disagreement is a question for the author,
        # never an automatic edit. Both belong out of the clean list, because
        # pasting either one double-pins the footnote.
        clean = [r for r in confirmed if not row_pin(r)]
        conflicts = [r for r in confirmed if row_pin(r)]

        for r in clean:
            print(f"fn {r['fn']}  ->  at {r['verify']['page']}")
            block(r)
        print(f"{len(clean)} confirmed pincites")

        if conflicts:
            print("\nCONFLICTS — existing pin vs computed page")
            print("These footnotes are ALREADY pinned. Do not bulk-apply; a human decides.\n")
            for r in conflicts:
                have, want = row_pin(r), r['verify']['page']
                agree = str(want) in re.findall(r'\d+', have)
                print(f"fn {r['fn']}  existing `{have}`  vs  computed {want}"
                      f"  {'(agrees)' if agree else '<-- DISAGREES'}")
                block(r)
            print(f"{len(conflicts)} conflicts")


if __name__ == '__main__':
    main()
