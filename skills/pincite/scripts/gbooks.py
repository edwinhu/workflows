#!/usr/bin/env python3
"""The BOOK route: a print page for a verbatim quote, from Google Books.

Every other page-derivation route in this skill starts from a PDF. A book has
none, so `book` was a stub. Google Books scanned the print edition and indexes
its pagination, which gives a book the one thing the PDF routes give an article:
a page number the tool did not invent.

Two routes to the same index, tried in order:

  jscmd   books.google.com/books?id=<VOL>&jscmd=SearchWithinVolume&q=<quote>
          -> {"number_of_results": N, "search_results": [{"page_id": "PA120",
              "page_number": "120", "snippet_text": "..."}]}
          Undocumented, and as of this writing 302s to /sorry from this host.
  udm36   www.google.com/search?q=<quote>&udm=36 -- the human-facing Books
          vertical over the same index. The result card's link carries
          `id=<VOL>&pg=PA120`, which is the same `page_id`.

`PA120` is print page 120. Nothing here derives, infers or adjusts a page: a
page is reported only if Google reported it FOR THE REQUESTED VOLUME, and the
answer carries which route said so.

The edition is the whole risk. Google paginates whatever printing it scanned,
which need not be the printing the bibliography cites, and a repaginated
edition fails SILENTLY -- it returns a plausible page that is simply wrong.
`calibrate()` is the answer and it is a computed check: re-find quotes whose
pages are already trusted and compare. Reproduce -> the book's new pages are
usable. A consistent offset -> a different printing, and the offset is the
finding. Anything else -> unusable, and it says so rather than averaging.

Both Google hosts refuse a scripted client (curl gets a JS-redirect stub or
/sorry), so the default transport drives the real browser over CDP. `fetch` is
injectable, which is also how the tests avoid the network entirely.
"""
import argparse
import html as _html
import json
import os
import pathlib
import re
import sys
import time
import urllib.parse
import urllib.request

CDP_PORTS = (9250, 9222)          # headless first; the interactive browser is the user's
CDP_POLLS = 40                    # x 0.4s
MIN_BODY_CHARS = 40               # an empty SPA shell is not a loaded page
REQUEST_GAP = 8.0                 # seconds between searches; see browser_fetch
SNIPPET_MAX = 400

# A page_id is a leaf label, not a page number. Only PA is an arabic print page.
_PAGE_ID_RE = re.compile(r'^(?:(RA\d+)-)?([A-Z]{2})(\d+)$')
_KIND = {'PA': 'arabic', 'PR': 'roman', 'PT': 'unpaginated', 'PP': 'unpaginated'}

_ROMAN = ((1000, 'm'), (900, 'cm'), (500, 'd'), (400, 'cd'), (100, 'c'), (90, 'xc'),
          (50, 'l'), (40, 'xl'), (10, 'x'), (9, 'ix'), (5, 'v'), (4, 'iv'), (1, 'i'))


def _roman(n):
    out = ''
    for v, s in _ROMAN:
        while n >= v:
            out += s
            n -= v
    return out


def parse_page_id(raw):
    """'PA120' -> print page 120. Anything that is not an arabic leaf -> page None.

    Front matter (`PR7`) is a real location with no arabic page, so it is
    reported as roman with its numeral as the label and `page` left None -- a
    pincite cannot be `at 7` when the book prints `vii`.
    """
    raw = (raw or '').strip()
    m = _PAGE_ID_RE.match(raw)
    if not m:
        return {'raw': raw, 'kind': 'unknown', 'page': None, 'label': None}
    section, prefix, num = m.group(1), m.group(2), int(m.group(3))
    kind = _KIND.get(prefix, 'unknown')
    out = {'raw': raw, 'kind': kind,
           'page': num if kind == 'arabic' else None,
           'label': str(num) if kind == 'arabic' else (_roman(num) if kind == 'roman' else None)}
    if section:
        out['section'] = section
    return out


def parse_search_within(payload):
    """The jscmd JSON -> hits. Trusts `page_id`, never `page_number` alone."""
    if not isinstance(payload, dict):
        return []
    hits = []
    for r in payload.get('search_results') or []:
        pid = parse_page_id(r.get('page_id'))
        hits.append({
            'page': pid['page'],
            'page_id': pid['raw'] or None,
            'page_kind': pid['kind'],
            'page_label': pid['label'],
            'snippet': _clean(r.get('snippet_text') or ''),
            'volume_id': None,
        })
    return hits


_TAG_RE = re.compile(r'<(script|style)\b.*?</\1>', re.DOTALL | re.IGNORECASE)
_ANCHOR_RE = re.compile(
    r'books\.google\.com/books\?id=([A-Za-z0-9_-]{8,})(?:&amp;|&)pg=((?:RA\d+-)?[A-Z]{2}\d+)')
_FOUND_RE = re.compile(r'Found inside\s*[–—-]?\s*Page\s+([A-Za-z0-9]+)(.*)',
                       re.IGNORECASE | re.DOTALL)
_TITLE_RE = re.compile(r'<title>(.*?)</title>', re.DOTALL | re.IGNORECASE)
_BYLINE_RE = re.compile(r'([A-Z][^|\n]{2,60}?)\s*·\s*(\d{4})')
# The card's title is an <h3> inside the result anchor. Reading it off the
# flattened text instead swallows Google's own nav chrome, which sits immediately
# before the card and has no textual boundary.
_CARD_TITLE_RE = re.compile(r'<h3[^>]*>(.*?)</h3>', re.DOTALL | re.IGNORECASE)
# Each SERP result is its own wrapper div; splitting there keeps a card's snippet
# attached to the card's own volume.
_BLOCK_RE = re.compile(r'(?=<div[^>]*class="[^"]*\bMjjYud\b[^"]*")', re.IGNORECASE)


def _strip_tags(h):
    h = _TAG_RE.sub(' ', h)
    h = re.sub(r'<[^>]+>', ' ', h)
    return _clean(_html.unescape(h))


def _clean(s):
    s = re.sub(r'\s+', ' ', s or '').strip()
    return re.sub(r'\s+([,.;:])', r'\1', s)


def _parse_udm36_card(html):
    """One result block -> its own hits. Parsed per block so a snippet cannot
    drift onto a neighbouring volume, which would be a confidently wrong pin."""
    seen, hits = set(), []
    text = _strip_tags(html)
    snippet, year, title = '', None, None
    m = _FOUND_RE.search(text)
    if m:
        snippet = m.group(2)
        for stop in ('Preview', 'See all results', 'Other editions', 'It looks like'):
            i = snippet.find(stop)
            if i > 0:
                snippet = snippet[:i]
        snippet = _clean(snippet)[:SNIPPET_MAX]
    b = _BYLINE_RE.search(text)
    if b:
        year = int(b.group(2))
    for h3 in _CARD_TITLE_RE.findall(html):
        cand = _clean(_html.unescape(re.sub(r'<[^>]+>', '', h3)))
        if cand:
            title = re.sub(r'\s+-\s+Page\s+[A-Za-z0-9]+$', '', cand)
            break
    for vol, pid in _ANCHOR_RE.findall(html):
        if (vol, pid) in seen:
            continue
        seen.add((vol, pid))
        p = parse_page_id(pid)
        hits.append({'page': p['page'], 'page_id': p['raw'], 'page_kind': p['kind'],
                     'page_label': p['label'], 'snippet': snippet, 'volume_id': vol,
                     'volume': {'id': vol, 'title': title, 'year': year}})
    return hits


def parse_udm36(html):
    """A Books-vertical result page -> hits, each tagged with its volume id."""
    blocks = _BLOCK_RE.split(html)
    if len(blocks) < 2:
        blocks = [html]
    hits, seen = [], set()
    for b in blocks:
        for h in _parse_udm36_card(b):
            key = (h['volume_id'], h['page_id'])
            if key in seen:
                continue
            seen.add(key)
            hits.append(h)
    return hits


# --- transport -------------------------------------------------------------

def _cdp(port, url, want):
    """Load `url` in a throwaway tab on a CDP browser and return its content."""
    import websocket  # websocket-client

    base = f'http://127.0.0.1:{port}'
    req = urllib.request.Request(f'{base}/json/new?{urllib.parse.quote(url, safe="")}',
                                 method='PUT')
    tab = json.loads(urllib.request.urlopen(req, timeout=20).read())
    tid = tab['id']
    try:
        ws = websocket.create_connection(tab['webSocketDebuggerUrl'], timeout=30)
        try:
            expr = ('document.documentElement.outerHTML' if want == 'html'
                    else '(document.querySelector("pre")||document.body).innerText')
            # `readyState === "complete"` fires on these pages BEFORE the results
            # render, and returns an empty shell. Wait for actual body text.
            ready = (f'(document.readyState==="complete" && document.body && '
                     f'document.body.innerText.trim().length > {MIN_BODY_CHARS}) '
                     f'? {expr} : ""')
            val = ''
            for i in range(CDP_POLLS):
                ws.send(json.dumps({'id': 1000 + i, 'method': 'Runtime.evaluate',
                                    'params': {'expression': ready, 'returnByValue': True}}))
                while True:
                    msg = json.loads(ws.recv())
                    if msg.get('id') == 1000 + i:
                        break
                val = (msg.get('result', {}).get('result') or {}).get('value') or ''
                if val:
                    return val
                time.sleep(0.4)
            return val
        finally:
            ws.close()
    finally:
        try:
            urllib.request.urlopen(f'{base}/json/close/{tid}', timeout=10).read()
        except OSError as e:        # a leaked tab is not worth failing the lookup
            print(f'gbooks: could not close tab {tid}: {e}', file=sys.stderr)


_last_fetch = 0.0


def browser_fetch(url):
    """Default transport. Google refuses a scripted client, so use a real browser.

    Throttled: a calibration run is a burst of near-identical searches, which is
    exactly the shape that trips `unusual traffic` and costs the whole host its
    Google access for an hour -- including the user's own browsing.
    """
    global _last_fetch
    gap = float(os.environ.get('PINCITE_GBOOKS_GAP', REQUEST_GAP))
    wait = gap - (time.monotonic() - _last_fetch)
    if wait > 0:
        time.sleep(wait)
    _last_fetch = time.monotonic()
    want = 'text' if 'jscmd=' in url else 'html'
    ports = os.environ.get('PINCITE_CDP_PORTS')
    ports = [int(p) for p in ports.split(',')] if ports else list(CDP_PORTS)
    last = None
    for p in ports:
        try:
            out = _cdp(p, url, want)
            if out:
                return out
        except Exception as e:      # noqa: BLE001 -- try the next browser
            last = e
    if last:
        raise RuntimeError(f'no CDP browser answered on {ports}: {last}')
    return ''


# --- the route ------------------------------------------------------------

# A rate-limit interstitial is a page with no results on it. Parsed as results it
# reads as "the quote is not in this book", which is a confident wrong answer.
#
# Matched against RENDERED TEXT, never raw HTML: a healthy SERP's own bundle
# carries the script that DETECTS a /sorry redirect, so a raw-HTML match calls
# every good page blocked -- a refusal to answer a question that was answered.
_BLOCK_MARKERS = ('unusual traffic', 'not a robot',
                  'enable javascript on your web browser', '302 moved')
# The /sorry stub is a redirect document: a link to it, not a mention of it.
_SORRY_HREF_RE = re.compile(r'href\s*=\s*["\']?[^"\'>]*/sorry/index', re.IGNORECASE)


def is_blocked(body):
    body = body or ''
    low = _strip_tags(body).lower()
    return (any(m in low for m in _BLOCK_MARKERS)
            or bool(_SORRY_HREF_RE.search(body)))


def _q(quote):
    return '"' + re.sub(r'\s+', ' ', quote.strip().strip('"')) + '"'


def resolve_volume(*, isbn=None, title=None, author=None, fetch=None):
    """isbn / title+author -> the volume Google will actually paginate.

    Recorded, not assumed: the caller gets back which edition answered, so an
    edition mismatch is visible instead of silent.
    """
    fetch = fetch or browser_fetch
    if isbn:
        q = f'isbn:{isbn}'
    elif title:
        q = f'"{title}"' + (f' "{author}"' if author else '')
    else:
        raise ValueError('resolve_volume needs isbn, or title (optionally with author)')
    html = fetch('https://www.google.com/search?udm=36&q=' + urllib.parse.quote(q))
    for vol, _pid in _ANCHOR_RE.findall(html or ''):
        return volume_meta(vol, fetch=fetch)
    m = re.search(r'/books/edition/[^/"]*/([A-Za-z0-9_-]{8,})', html or '')
    return volume_meta(m.group(1), fetch=fetch) if m else None


_META_KEYS = {'ISBN': 'isbn', 'Page count': 'page_count', 'Published': 'published',
              'Publisher': 'publisher', 'Author': 'author', 'Language': 'language'}


def volume_meta(volume_id, *, fetch=None):
    """The edition record: id, title, publisher, year -- so a mismatch is visible."""
    fetch = fetch or browser_fetch
    html = fetch(f'https://www.google.com/books/edition/_/{volume_id}')
    text = _strip_tags(html or '')
    out = {'id': volume_id, 'title': None, 'publisher': None, 'year': None}
    m = re.search(r'About this edition(.*?)(?:Table of contents|Create Citation)',
                  text, re.DOTALL)
    blob = m.group(1) if m else text
    for label, key in _META_KEYS.items():
        mm = re.search(rf'{label}:\s*([^:]{{1,120}}?)(?=\s+(?:{"|".join(_META_KEYS)}):|$)', blob)
        if mm:
            out[key] = _clean(mm.group(1))
    if out.get('published'):
        y = re.search(r'\d{4}', out['published'])
        out['year'] = int(y.group()) if y else None
    b = _BYLINE_RE.search(text)
    if b and not out['year']:
        out['year'] = int(b.group(2))
    page_title = _TITLE_RE.search(html or '')
    if page_title:
        t = re.match(r'(.+?)\s+-\s+Google Books\s*$',
                     _clean(_html.unescape(page_title.group(1))))
        if t:
            out['title'] = t.group(1)
    return out


def book_page(quote, *, volume_id=None, isbn=None, title=None, author=None,
              fetch=None, routes=('jscmd', 'udm36')):
    """A verbatim `quote` -> the print page Google reports for it, or None + a reason.

    The quote must be VERBATIM -- this searches a text index, not a summary. A
    manuscript's paraphrase of a claim will not match; the searchable input is
    the sentence as the book prints it (which is exactly what a Kindle highlight
    already is).
    """
    fetch = fetch or browser_fetch
    volume = None
    if not volume_id:
        if not (isbn or title):
            raise ValueError('book_page needs volume_id, or isbn, or title')
        volume = resolve_volume(isbn=isbn, title=title, author=author, fetch=fetch)
        if not volume:
            return _miss(quote, None, None, 'volume not resolved from isbn/title')
        volume_id = volume['id']

    tried, foreign, blocked, dead = [], [], [], []
    for route in routes:
        if route == 'jscmd':
            url = (f'https://books.google.com/books?id={volume_id}'
                   f'&jscmd=SearchWithinVolume&q={urllib.parse.quote(_q(quote))}')
        elif route == 'udm36':
            url = ('https://www.google.com/search?udm=36&q='
                   + urllib.parse.quote(_q(quote)))
        else:
            raise ValueError(f'unknown route {route!r}')
        try:
            body = fetch(url) or ''
        except Exception as e:  # noqa: BLE001 -- a dead route must not kill the run
            # books.google.com refuses this client hard enough to drop the CDP
            # connection. Raising here abandons the route that still works.
            tried.append(f'{route}(transport)')
            dead.append(f'{route}: {e}')
            continue

        if route == 'jscmd':
            try:
                payload = json.loads(body)
            except (ValueError, TypeError):
                tried.append('jscmd(blocked)' if is_blocked(body) else 'jscmd(unavailable)')
                if is_blocked(body):
                    blocked.append(route)
                continue
            hits = parse_search_within(payload)
            for h in hits:
                h['volume_id'] = volume_id
        else:
            if is_blocked(body):
                tried.append('udm36(blocked)')
                blocked.append(route)
                continue
            hits = parse_udm36(body)

        tried.append(route)
        mine = [h for h in hits if h['volume_id'] == volume_id]
        foreign += [h for h in hits if h['volume_id'] != volume_id]
        for h in mine:
            if h['page'] is not None:
                return {'page': h['page'], 'page_id': h['page_id'],
                        'page_kind': h['page_kind'], 'page_label': h['page_label'],
                        'snippet': h['snippet'], 'volume_id': volume_id,
                        'volume': volume or h.get('volume'), 'route': route,
                        'quote': quote, 'reason': None}
        if mine:
            return _miss(quote, volume_id, route,
                         f"found on {mine[0]['page_id']}, which is "
                         f"{mine[0]['page_kind']} -- no arabic print page", volume)

    if dead and not foreign and not blocked and len(dead) == len(routes):
        return _miss(quote, volume_id, tried[-1] if tried else None,
                     f'transport failed on every route ({"; ".join(dead)}) -- '
                     f'no answer either way; this is NOT evidence the quote is absent',
                     volume)
    if blocked and not foreign:
        return _miss(quote, volume_id, tried[-1] if tried else None,
                     f'blocked by Google on every route tried ({", ".join(blocked)}) -- '
                     f'no answer either way; this is NOT evidence the quote is absent',
                     volume)
    if foreign:
        vols = sorted({h['volume_id'] for h in foreign})
        return _miss(quote, volume_id, tried[-1] if tried else None,
                     f'quote found only in another volume ({", ".join(vols)}); '
                     f'refusing to report a page from an edition that was not asked for',
                     volume)
    return _miss(quote, volume_id, tried[-1] if tried else None,
                 f"quote not found in volume {volume_id} (routes tried: {', '.join(tried) or 'none'})",
                 volume)


def _miss(quote, volume_id, route, reason, volume=None):
    return {'page': None, 'page_id': None, 'page_kind': None, 'page_label': None,
            'snippet': None, 'volume_id': volume_id, 'volume': volume,
            'route': route, 'quote': quote, 'reason': reason}


# --- calibration -----------------------------------------------------------

MIN_CALIBRATION_PINS = 2


def _expected_range(v):
    """'145--48' -> (145, 148). A pincite range CLAIMS support across the span, so
    any page inside it is the pin -- scoring against the first number alone turns
    a correct page into a 3-page miss and then into a bogus 'inconsistent'."""
    if isinstance(v, int):
        return v, v
    nums = re.findall(r'\d+', str(v or ''))
    if not nums:
        return None, None
    lo = int(nums[0])
    if len(nums) == 1:
        return lo, lo
    hi = int(nums[1])
    if hi < lo:                       # Bluebook abbreviates the end: 145--48, 1279--302
        head = str(lo)[:len(str(lo)) - len(nums[1])]
        hi = int(head + nums[1]) if head else hi
    return lo, max(lo, hi)


def calibrate(known_pins, *, finder=None, **kw):
    """Re-find quotes whose pages are already trusted, and compare. Computed, not judged.

    `known_pins`: [{'quote': <verbatim>, 'expected_page': 116 or '145--48'}].
    A range compares on its first number, as elsewhere in this skill.

    verdict:
      reproduces   every found pin lands on its expected page -> new pages usable
      offset       every found pin is off by the SAME k -> a different printing,
                   and k is the finding
      inconsistent the deltas disagree -> this volume cannot pin this edition
      insufficient fewer than two pins were found at all -> no verdict, not a pass
    """
    finder = finder or book_page
    pins = []
    for p in known_pins:
        lo, hi = _expected_range(p.get('expected_page'))
        r = finder(p['quote'], **kw) or {}
        returned = r.get('page')
        delta = None
        if isinstance(returned, int) and isinstance(lo, int):
            delta = 0 if lo <= returned <= hi else (returned - hi if returned > hi
                                                    else returned - lo)
        pins.append({'quote': p['quote'], 'expected_page': lo,
                     'expected_range': [lo, hi],
                     'returned_page': returned, 'delta': delta,
                     'match': delta == 0, 'page_id': r.get('page_id'),
                     'snippet': r.get('snippet'), 'route': r.get('route'),
                     'reason': r.get('reason'), 'label': p.get('label')})

    deltas = [p['delta'] for p in pins if p['delta'] is not None]
    # A lookup that never reached Google -- refused OR disconnected -- is not a
    # negative result. Both must be counted, or a dead browser reads as a clean
    # "nothing mismatched".
    n_blocked = sum(1 for p in pins
                    if re.search(r'blocked|transport', (p.get('reason') or ''), re.IGNORECASE))
    if n_blocked and not deltas:
        # Every lookup was refused transport. "No mismatches found" is true and
        # worthless; calling it insufficient hides WHY nothing came back.
        verdict, offset = 'blocked', None
    elif len(deltas) < MIN_CALIBRATION_PINS:
        verdict, offset = 'insufficient', None
    elif set(deltas) == {0}:
        verdict, offset = 'reproduces', 0
    elif len(set(deltas)) == 1:
        verdict, offset = 'offset', deltas[0]
    else:
        verdict, offset = 'inconsistent', None
    return {'pins': pins, 'verdict': verdict, 'offset': offset,
            'found': len(deltas), 'blocked': n_blocked, 'total': len(pins)}


# --- highlights ------------------------------------------------------------
#
# A Kindle highlight is a verbatim quote with the book already attached, which is
# exactly `book_page`'s input and exactly what a manuscript's paraphrase cannot
# be. Highlights are an INPUT this module is handed -- a list, or a JSON dump a
# `librarian` run produced. Nothing here shells out to `readwise`.
#
# What stands between a highlight and a search key is Readwise's own storage.
# Measured on one book's 92 highlights: em dashes flattened to hyphens
# (`three people-Monks`), spaces lost at line breaks (`office onM Street`), and
# 20 records truncated mid-sentence with a trailing ellipsis.

MAX_KEY_WORDS = 8          # the scan hyphenates across line breaks; longer silently fails
MIN_KEY_WORDS = 4          # shorter is a phrase, not a locator

_LIGATURES = {'ﬀ': 'ff', 'ﬁ': 'fi', 'ﬂ': 'fl', 'ﬃ': 'ffi', 'ﬄ': 'ffl',
              'ﬅ': 'st', 'ﬆ': 'st'}
_QUOTES = {'‘': "'", '’': "'", '‚': "'", '‛': "'", '′': "'",
           '“': '"', '”': '"', '„': '"', '‟': '"', '″': '"'}
_DASHES = '—–‒−‐‑-'
_DASH_RE = re.compile(f'[{_DASHES}]')
_TRUNCATION = ('…', '...')
_GLUED_DASH_RE = re.compile(f'\\w[{_DASHES}]\\w')
_LOST_SPACE_RE = re.compile(r'[a-z][A-Z]')


def normalize_quote(text):
    """Readwise's stored text -> a form Google's index can match.

    Dash variants all become a space: the scan prints an em dash spaced
    (`three people - Monks`) and Google splits a hyphen anyway, so a space is the
    one rendering that matches both a flattened em dash and a real compound.
    """
    s = text or ''
    for src, dst in _LIGATURES.items():
        s = s.replace(src, dst)
    for src, dst in _QUOTES.items():
        s = s.replace(src, dst)
    s = _DASH_RE.sub(' ', s)
    return re.sub(r'\s+', ' ', s).strip()


def split_lost_space(text):
    """`office onM Street` -> `office on M Street`.

    Only a token that STARTS lowercase is repaired: that is what distinguishes a
    line break Readwise swallowed from a name that is genuinely camel-cased
    (`McKinsey`, `DeLorean`), which must be left alone.
    """
    out = []
    for tok in (text or '').split(' '):
        if tok[:1].islower():
            tok = _LOST_SPACE_RE.sub(lambda m: f'{m.group()[0]} {m.group()[1]}', tok)
        out.append(tok)
    return ' '.join(out)


def _artifact(word):
    if _GLUED_DASH_RE.search(word):
        return 'glued-dash'
    if word[:1].islower() and _LOST_SPACE_RE.search(word):
        return 'lost-space'
    return None


def search_key(text, *, max_words=MAX_KEY_WORDS, min_words=MIN_KEY_WORDS):
    """A highlight -> the phrase to search, plus how strong that evidence is.

    Truncation is stripped and REPORTED: a prefix match is weaker evidence than a
    full sentence, because the page it lands on is the page the prefix is on, not
    necessarily the page the whole highlight spans.

    The window is the first run of `max_words` carrying no storage artifact, so a
    flattened dash or a lost space is stepped around rather than searched through.
    """
    raw = (text or '').strip()
    truncated = raw.endswith(_TRUNCATION)
    body = raw
    for mark in _TRUNCATION:
        body = body.removesuffix(mark)
    body = body.lstrip('…. ').strip()

    words = body.split()
    if truncated and words:
        # Readwise truncates on a character budget, so the last token may be half
        # a word. It is never needed -- the key comes off the front.
        words = words[:-1]
    flags = [_artifact(w) for w in words]
    artifacts = sorted({f for f in flags if f})

    chosen = None
    for size in range(min(max_words, len(words)), min_words - 1, -1):
        for start in range(len(words) - size + 1):
            if not any(flags[start:start + size]):
                chosen = words[start:start + size]
                break
        if chosen:
            break
    if chosen is None:
        chosen = words[:max_words]

    key = split_lost_space(normalize_quote(' '.join(chosen)))
    out = {'key': key or None, 'words': len(chosen),
           'normalized': split_lost_space(normalize_quote(body)),
           'truncated': truncated, 'artifacts': artifacts,
           'evidence': 'prefix' if truncated else 'full-sentence', 'reason': None}
    if len(chosen) < min_words:
        out['key'] = None
        out['reason'] = (f'highlight too short to locate: {len(chosen)} usable words, '
                         f'{min_words} needed')
    return out


def load_highlights(path):
    """A librarian-produced dump -> the list of highlight records.

    The handoff: the `librarian` agent runs `readwise` and writes this file; this
    module only ever reads it. Accepts the dump's wrapper or a bare list.
    """
    data = json.loads(pathlib.Path(path).read_text())
    if isinstance(data, list):
        return data
    for key in ('highlights', 'results', 'data'):
        if isinstance(data.get(key), list):
            return data[key]
    raise ValueError(f'{path}: no highlight list found (looked for highlights/results/data)')


def highlight_page(highlight, *, finder=None, **kw):
    """A Readwise highlight -> the print page, or None with a reason.

    `highlight` is the record (or its bare text). The answer carries the key that
    was actually searched and how strong the evidence is, so a prefix match is
    never mistaken for a full-sentence one.
    """
    h = {'text': highlight} if isinstance(highlight, str) else dict(highlight or {})
    k = search_key(h.get('text') or '')
    prov = {'highlight_id': h.get('id'), 'location': h.get('location'),
            'location_type': h.get('location_type'),
            'highlight_text': h.get('text'), 'search_key': k['key'],
            'normalized': k['normalized'], 'truncated': k['truncated'],
            'artifacts': k['artifacts'], 'evidence': k['evidence']}
    if not k['key']:
        return {**_miss(h.get('text'), kw.get('volume_id'), None, k['reason']), **prov}
    r = dict((finder or book_page)(k['key'], **kw) or {})
    r.setdefault('page', None)
    r.setdefault('reason', 'finder returned nothing')
    return {**r, **prov}


def calibrate_highlights(known, *, finder=None, **kw):
    """`calibrate`, fed by highlights instead of hand-typed quotes.

    `known`: [{'highlight': <record or text>, 'expected_page': 120}]. The verdict
    logic is `calibrate`'s, unchanged -- reproduces / offset / inconsistent /
    blocked / insufficient. What this adds is `weak`: how many of the pins rested
    on a TRUNCATED highlight, i.e. on a prefix rather than a whole sentence.
    """
    results = [highlight_page(p.get('highlight', p.get('text', p)),
                              finder=finder, **kw) for p in known]
    it = iter(results)
    pins = [{'quote': r['search_key'] or r['highlight_text'],
             'expected_page': p.get('expected_page')}
            for p, r in zip(known, results)]
    out = calibrate(pins, finder=lambda _q, **_k: next(it))
    for pin, r in zip(out['pins'], results):
        pin.update({'highlight_id': r['highlight_id'], 'location': r['location'],
                    'evidence': r['evidence'], 'truncated': r['truncated'],
                    'artifacts': r['artifacts'], 'search_key': r['search_key']})
    out['weak'] = sum(1 for r in results if r['evidence'] == 'prefix')
    return out


# --- CLI -------------------------------------------------------------------

def pick_highlight(highlights, *, location=None, highlight_id=None):
    for h in highlights:
        if highlight_id is not None and h.get('id') == highlight_id:
            return h
        if location is not None and h.get('location') == location:
            return h
    raise SystemExit(f'no highlight with location={location} id={highlight_id}')


def _cli(argv=None):
    ap = argparse.ArgumentParser(prog='gbooks', description=__doc__.splitlines()[0])
    ap.add_argument('cmd', choices=['page', 'volume', 'calibrate',
                                    'highlight', 'calibrate-highlights'])
    ap.add_argument('--quote', help='page: the VERBATIM quote to find')
    ap.add_argument('--volume-id')
    ap.add_argument('--isbn')
    ap.add_argument('--title')
    ap.add_argument('--author')
    ap.add_argument('--routes', default='jscmd,udm36')
    ap.add_argument('--pins', help='calibrate: JSON [{"quote"|"location",…,"expected_page":…}]')
    ap.add_argument('--highlights',
                    help='JSON dump of Readwise highlights, written by a `librarian` run')
    ap.add_argument('--location', type=int, help='highlight: pick by Kindle location')
    ap.add_argument('--highlight-id', type=int, help='highlight: pick by Readwise id')
    ap.add_argument('--text', help='highlight: the highlight text, instead of --highlights')
    a = ap.parse_args(argv)
    routes = tuple(r for r in a.routes.split(',') if r)
    vol = {'volume_id': a.volume_id, 'isbn': a.isbn, 'title': a.title,
           'author': a.author, 'routes': routes}

    if a.cmd == 'volume':
        out = (volume_meta(a.volume_id) if a.volume_id
               else resolve_volume(isbn=a.isbn, title=a.title, author=a.author))
    elif a.cmd == 'page':
        if not a.quote:
            ap.error('page needs --quote')
        out = book_page(a.quote, **vol)
    elif a.cmd == 'highlight':
        if a.text:
            h = {'text': a.text}
        elif a.highlights and (a.location is not None or a.highlight_id is not None):
            h = pick_highlight(load_highlights(a.highlights), location=a.location,
                      highlight_id=a.highlight_id)
        else:
            ap.error('highlight needs --text, or --highlights with --location/--highlight-id')
        out = highlight_page(h, **vol)
    elif a.cmd == 'calibrate-highlights':
        if not a.pins:
            ap.error('calibrate-highlights needs --pins')
        spec = json.loads(pathlib.Path(a.pins).read_text())
        lib = load_highlights(a.highlights) if a.highlights else []
        known = []
        for p in spec:
            h = (p.get('highlight') or p.get('text')
                 or pick_highlight(lib, location=p.get('location'), highlight_id=p.get('id')))
            known.append({'highlight': h, 'expected_page': p.get('expected_page')})
        out = calibrate_highlights(known, **vol)
    else:
        if not a.pins:
            ap.error('calibrate needs --pins')
        out = calibrate(json.loads(pathlib.Path(a.pins).read_text()), **vol)
    print(json.dumps(out, indent=1, ensure_ascii=False))
    ok = out and (out.get('page') is not None or out.get('verdict') in ('reproduces', 'offset')
                  or a.cmd == 'volume')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(_cli())
