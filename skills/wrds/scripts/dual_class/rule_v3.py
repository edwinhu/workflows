r"""JKL16 dual-class classifier v3. FROZEN once its md5 is recorded in report_jkl4.md.

Input: text of an EDGAR complete submission (first 400,000 bytes, or the full submission).
Spec, all steps in order:
 1. body = text from the first '<DOCUMENT>'; strip tags r'<[^>]+>' -> ' '; '&nbsp;', '&#160;', '&#xa0;', U+00A0 -> ' ';
    '&amp;' -> '&'; collapse whitespace to one space; delete r'voting\s+and\s+non-?voting\s+common\s+equity' (case-insens.).
 2. COVER REGION = body[:E], E = start of the first r'item\s+1\b[\s.:]*(business|description)' that begins after char 1500,
    capped at 50,000 (50,000 if none).
 3. SHARE-COUNT PASSAGE = union of windows [a-250, a+1200] (clipped to the cover region) around every ANCHOR match inside
    the cover region; ANCHOR = the word 'outstanding' | 'indicate the number of'. No anchor -> empty passage -> no tokens.
 4. CLASS TOKENS inside the passage only (case-insens.):
    lettered : 'Class [A-D]'; 'Series [A-D]' when followed by common/ordinary/voting, or preceded by 'common stock,';
    non-lettered: 'non-voting (common|ordinary|class|stock|shares)' not preceded by 'voting and/or' (NONVOTING); 'special common' (SPECIAL);
    '(limited|restricted) voting (common|stock|shares)' (LIMITED); tracking groups '<1-3 Capitalised words> Group (Common)? (Stock|Shares)', case-sensitive capitals
    (one token per distinct group name, needs >=2 to matter);
    PLAIN = 'common stock|shares' not directly attached to any token word (class/series/voting/special/group/preferred/ordinary),
    counted ONLY when it has its own explicit non-zero share count (a number directly before it, or directly after it, optionally after 'outstanding:' or '$.01 par value') and >=1 non-plain token exists (this is the 'Common Stock' + 'Class B Stock' pair).
 5. A token occurrence is IGNORED if (a) it is followed by up to 3 words (none of common/stock/shares) then
    warrant(s)/preferred/unit(s)/right(s)/note(s)/debenture(s), or directly by '(stock )?(purchase )?warrants|rights|units',
    or preceded by 'preferred' / 'warrants to purchase'; (b) its share count is 0: count = number in the 60 chars before it
    when that number directly precedes 'shares of', else the first number after it (skipping $-amounts, 'par', dates and
    years 1900-2030) up to the next token / 140 chars; or a 'none / no shares / zero / nil / not outstanding / -0-' word
    comes before that number; or 'N1 and N2 respectively' lists give counts in order to the tokens just before them; or the token follows
    'no shares of' / '0 shares of'. No number found = not stated zero = counted.
    n_tokens = distinct non-plain tokens counted (+1 if PLAIN counted and >=1 non-plain).
 6. VOTE HITS (capital-stock / Item 5 / equity-note passage): every match, after the cover region, of
    N votes per share (N = two..hundred or digits) | entitled to N votes | one-tenth (of a|one) vote | 1/10 vote | super-voting |
    limited voting | non-voting (not before preferred/debt/notes/units/warrants) | no voting rights/power | without voting rights |
    ten votes | ten-vote | elect(s) [up to] N% / a majority / one-third.. of the (members of the) board/directors,
    KEPT when its window (300 chars before, 150 after) contains common|class [A-D]|series [A-D]|capital stock|ordinary shares and the
    nearest of {preferred, common, ordinary, class X, series X} within the 300 chars before the match is not 'preferred'.
    Up to 8 hit snippets are stored. n_hits = number kept.
 7. positive = (n_tokens >= 2) OR (n_tokens == 1 AND n_hits >= 1).
Files in the cache that hit the 400,000-byte cap with n_tokens == 1 and n_hits == 0 are re-extracted from the full submission.
"""
import re

BOILER = re.compile(r'voting\s+and\s+non-?voting\s+common\s+equity', re.I)
ITEM1 = re.compile(r'item\s+1\b[\s.:]*(?:business|description)', re.I)
ANCHOR = re.compile(r'\boutstanding\b|indicate\s+the\s+number\s+of\b', re.I)
PRE, POST, REGION_CAP = 250, 1200, 50000

TOK = re.compile(
    r'(?P<cls>\bclass\s+(?P<cl>[A-D])\b)'
    r'|(?P<ser>\bseries\s+(?P<sl>[A-D])\b(?=\s*(?:common|ordinary|voting)))'
    r'|(?P<ser2>\bcommon\s+stock,?\s+series\s+(?P<sl2>[A-D])\b)'
    r'|(?P<nv>\bnon-?\s?voting\s+(?:common|ordinary|class|stock|shares)\b)'
    r'|(?P<sp>\bspecial\s+common\b)'
    r'|(?P<lv>\b(?:limited|restricted)\s+voting\s+(?:common|stock|shares)\b)'
    r'|(?P<plain>\bcommon\s+(?:stock|shares)\b)', re.I)
GRP = re.compile(r"\b(?P<gn>(?:[A-Z][\w&.\-']*\s+){1,3})Group\s+(?:[Cc]ommon\s+)?(?:[Ss]tock|[Ss]hares)\b")
RESP = re.compile(r'((?:\d[\d,]*\s*(?:,\s*and|,|and)\s*)+\d[\d,]*)\s*,?\s*respectively', re.I)
ZB = re.compile(r'\b(?:no|zero|0)\s+shares\s+of\s+(?:the\s+)?(?:registrant[\'’]?s?\s+|company[\'’]?s?\s+)?$', re.I)
NVPRE = re.compile(r'voting\s+(?:and|or|and/or)\s+$', re.I)
ATTACHED = re.compile(r'(?:class\s+[A-D]|series\s+[A-D]|voting|special|group|preferred|ordinary|restricted|non|limited)\s*,?\s*$', re.I)
AFTER_LABEL = re.compile(r'^\s*,?\s*(?:class|series)\s+[A-D]\b', re.I)
EXCL_AFTER = re.compile(r'^\s*(?:(?:(?!common|stock|shares)[\w\-/]+\s+){0,3}(?:warrants?|preferred|units?|rights|notes?|debentures?)\b|'
                        r'(?:(?:stock|shares)\s+)?(?:purchase\s+)?(?:warrants?|rights|units?)\b)', re.I)
EXCL_BEFORE = re.compile(r'(?:preferred|warrants?\s+to\s+purchase(?:\s+shares\s+of)?(?:\s+the)?)\s*$', re.I)
ZEROW = re.compile(r'\b(?:none|no\s+shares|zero|nil|not\s+outstanding)\b|-0-', re.I)
NUM = re.compile(r'(?<![\w$.,])\d[\d,]*(?:\.\d+)?')
MONTH = re.compile(r'(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*$', re.I)
NUM_BEFORE = re.compile(r'(\d[\d,]*\d|\d)\s+(?:shares\s+)?(?:of\s+)?(?:the\s+)?(?:(?:registrant|company|issuer)[\'’]?s?\s+)?(?:\w+\s+){0,2}$', re.I)
PLAIN_AFTER = re.compile(r'^[\s,:\-–.]{0,6}(?:outstanding[\s,:\-–.]{0,6})?(?:\(?\$?\s*[\d.]+\s*par(?:\s+value)?\)?[\s,:\-–]*)?(\d[\d,]*\d)\b')
NUM_BEFORE_TIGHT = re.compile(r'(\d[\d,]*\d|\d)\s+(?:shares\s+)?(?:of\s+)?(?:the\s+)?(?:(?:registrant|company|issuer)[\'’]?s?\s+)?$', re.I)

N = r'(?:two|three|four|five|six|seven|eight|nine|ten|twenty|fifty|hundred|\d{1,3})'
VOTE = re.compile(
    r'\b' + N + r'\s+votes?\s+per\s+share|entitled\s+to\s+' + N + r'\s+votes?\b|\bone[- ]tenth\s+of\s+(?:one|a)\s+vote|\bone[- ]tenth\s+vote|\b1/10\s+(?:of\s+(?:a|one)\s+)?vote|'
    r'\bsuper-?\s?voting|\blimited\s+voting|\bnon-?\s?voting\b(?!\s+(?:preferred|debt|notes?|units?|warrants?))|'
    r'\bno\s+voting\s+(?:rights|power)|\bwithout\s+voting\s+rights|\b(?:ten|10)\s+votes\b|\bten-vote|'
    r'\belect\w*\s+(?:up\s+to\s+)?(?:\d{1,3}(?:\.\d+)?\s*(?:%|percent)|a\s+majority|one[- ](?:third|fourth|quarter|half)|two[- ]thirds|three[- ]fourths)\s+of\s+the\s+(?:members\s+of\s+the\s+)?(?:board|directors)', re.I)
CTX = re.compile(r'common|class\s+[A-D]\b|series\s+[A-D]\b|capital\s+stock|ordinary\s+shares', re.I)
NEAR = re.compile(r'preferred|common|ordinary|class\s+[A-D]\b|series\s+[A-D]\b', re.I)


def normalise(text):
    i = text.find('<DOCUMENT>')
    t = text[i:] if i >= 0 else text
    t = re.sub(r'<[^>]+>', ' ', t)
    t = re.sub(r'&nbsp;|&#160;|&#xa0;', ' ', t, flags=re.I).replace('\xa0', ' ').replace('&amp;', '&')
    t = re.sub(r'\s+', ' ', t)
    return BOILER.sub(' ', t)


def cover_end(t):
    for m in ITEM1.finditer(t[:REGION_CAP + 200]):
        if m.start() > 1500: return min(m.start(), REGION_CAP)
    return REGION_CAP


def passage(t):
    e = cover_end(t); cov = t[:e]; wins = []
    for m in ANCHOR.finditer(cov):
        a, b = max(0, m.start() - PRE), min(e, m.start() + POST)
        if wins and a <= wins[-1][1]: wins[-1][1] = max(wins[-1][1], b)
        else: wins.append([a, b])
    return e, [(a, b) for a, b in wins], ' || '.join(cov[a:b] for a, b in wins)


def first_count(s):
    """first count-like number in s (None if none), 0 if a zero-word comes first"""
    zw = ZEROW.search(s)
    for m in NUM.finditer(s):
        if zw and zw.start() < m.start(): return 0
        pre = s[max(0, m.start() - 12):m.start()]
        if MONTH.search(pre): continue
        raw = m.group().replace(',', '')
        try: v = float(raw)
        except ValueError: continue
        if 1900 <= v <= 2030 and ',' not in m.group(): continue
        if re.match(r'\s*(?:par|per|%|percent)', s[m.end():m.end() + 8], re.I): continue
        return v
    return 0 if zw else None


def tokens(p):
    ms = []
    for m in TOK.finditer(p):
        if m.group('cls'): name = 'Class ' + m.group('cl').upper()
        elif m.group('ser'): name = 'Series ' + m.group('sl').upper()
        elif m.group('ser2'): name = 'Series ' + m.group('sl2').upper()
        elif m.group('nv'):
            if NVPRE.search(p[max(0, m.start() - 14):m.start()]): continue
            name = 'NONVOTING'
        elif m.group('sp'): name = 'SPECIAL'
        elif m.group('lv'): name = 'LIMITED'
        else:
            name = 'PLAIN'
            if ATTACHED.search(p[max(0, m.start() - 28):m.start()]) or AFTER_LABEL.match(p[m.end():m.end() + 14]): continue
        ms.append((m.start(), m.end(), name))
    for m in GRP.finditer(p):
        g = re.sub(r'\s+', ' ', m.group('gn').strip().lower())
        if g.split()[0] in ('the', 'our', 'of', 'and'): continue
        ms.append((m.start(), m.end(), 'GRP:' + g))
    ms.sort()
    keep = [(a, b, n) for a, b, n in ms if not (EXCL_AFTER.match(p[b:b + 60]) or EXCL_BEFORE.search(p[max(0, a - 30):a]))]
    # 'N1 and N2 respectively' list: assign counts, in order, to the tokens just before it
    over = {}
    for r in RESP.finditer(p):
        nums = [float(x.replace(',', '')) for x in re.findall(r'\d[\d,]*', r.group(1))]
        prev = [i for i, (a, b, n) in enumerate(keep) if b <= r.start() and r.start() - b < 400]
        prev = [i for i in prev if keep[i][2] != 'PLAIN' or True][-len(nums):]
        if len(prev) == len(nums): over.update(dict(zip(prev, nums)))
    cand = []
    for i, (a, b, name) in enumerate(keep):
        nxt = keep[i + 1][0] if i + 1 < len(keep) else len(p)
        after = p[b:min(b + 140, nxt)]
        c = over.get(i)
        if c is None:
            if ZB.search(p[max(0, a - 40):a]): c = 0
            else:
                mb = (NUM_BEFORE_TIGHT if name == 'PLAIN' else NUM_BEFORE).search(p[max(0, a - 60):a])
                if mb:
                    try: c = float(mb.group(1).replace(',', ''))
                    except ValueError: c = None
                    if c is not None and 1900 <= c <= 2030 and ',' not in mb.group(1): c = None
                if c is None and name == 'PLAIN':
                    ma = PLAIN_AFTER.match(after); c = float(ma.group(1).replace(',', '')) if ma else None
                elif c is None: c = first_count(after)
        if c == 0: continue
        if name == 'PLAIN' and c is None: continue   # plain 'common stock' counts only with its own explicit share count
        cand.append(name)
    nonplain = sorted({n for n in cand if n != 'PLAIN'})
    plain = 'PLAIN' in cand
    return nonplain, plain, len(nonplain) + (1 if plain and nonplain else 0)


def vote_hits(t, e):
    hits = []
    for m in VOTE.finditer(t, e):
        w = t[max(0, m.start() - 300):m.end() + 150]
        if not CTX.search(w): continue
        near = list(NEAR.finditer(t[max(0, m.start() - 300):m.start()]))
        if near and near[-1].group().lower() == 'preferred': continue
        hits.append((m.start(), t[max(0, m.start() - 200):m.end() + 200]))
    return hits


def extract(text):
    t = normalise(text)
    e, wins, p = passage(t)
    nonplain, plain, n = tokens(p)
    hits = vote_hits(t, e)
    return dict(cover_end=e, passage=p[:4000], has_passage=bool(p), tokens=','.join(nonplain), plain=plain, n_tokens=n,
                n_hits=len(hits), hits=[h[1] for h in hits[:8]], body_len=len(t))


def decide(ex):
    if ex['n_tokens'] >= 2: return True, 'ge2_tokens'
    if ex['n_tokens'] == 1 and ex['n_hits'] >= 1: return True, '1token_vote'
    return False, 'neg'


def classify(text):
    ex = extract(text); pos, rule = decide(ex); ex.update(v3_pos=pos, rule=rule); return ex
