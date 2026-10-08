"""Section extraction rules (pure functions, deterministic). Ported from hidden-figures scratch/borderline3/jkl6/sections.py;
rule list and measured validation in references/dual-class.md.
R1 split the submission on <DOCUMENT>...</DOCUMENT>, keep <TYPE>. Main doc = first doc whose TYPE starts with 10-K/10K; else first doc.
R2 clean: <PAGE>/<S>/<C>/<CAPTION> markers dropped; block tags (br,p,div,tr,li,h1-6,table,title) -> newline; other tags -> space;
   html entities unescaped (nbsp->space); runs of spaces/tabs -> one space; 3+ newlines -> 2.
R3 cover = main doc start .. first Item 1 heading located >=500 chars in (else first 8000 chars, flag cover_item1=False), cap 8000.
R4 item5 = first 'Item 5 ... market' heading whose next Item 6 heading is >=300 chars later, to that Item 6 (else Item 7 or +8000), cap 8000.
R5 capnotes = heading-like short lines (<=90 chars, starts uppercase, <=25 chars after the keyword, no digits after it, no dot leaders) naming capital stock / common stock / stockholders' equity in main doc after Item 8 (or after 50% of doc if Item 8 absent) or anywhere in EX-13;
   prose test (digit ratio <0.12 in next 1000 chars and >=3 lines of >=60 chars in next 1500); priority capital stock > equity > common stock; <=3, non-overlapping, 6000 chars each.
R6 windows = (weak hits dropped if digit ratio>=0.12 or window lacks 'vot') 600 chars around vote phrases in main, EX-13, EX-3*; skip hits overlapping R3-R5 spans or an earlier window; strong phrases before weak;
   order strong/weak, then doc rank, then position; total cap 6000 (10 windows).
"""
import re, html

BLOCK = re.compile(r'(?i)</?(?:br|p|div|tr|li|h[1-6]|table|title|center)\b[^>]*>')
MARK = re.compile(r'(?i)</?(?:PAGE|S|C|CAPTION|FN|TABLE)\b[^>]*>|<PAGE>')
TAG = re.compile(r'<[^>]{1,2000}>')
DOCRE = re.compile(r'<DOCUMENT>(.*?)</DOCUMENT>', re.S | re.I)
TYPE = re.compile(r'<TYPE>\s*([^\s<]+)', re.I)

def clean(t):
    t = BLOCK.sub('\n', t); t = MARK.sub('\n', t); t = TAG.sub(' ', t)
    t = html.unescape(t).replace('\xa0', ' ').replace('\r', '')
    t = re.sub(r'[ \t\f\v]+', ' ', t); t = re.sub(r' ?\n ?', '\n', t); t = re.sub(r'\n{3,}', '\n\n', t)
    return t

def split_docs(raw):
    docs = []
    for m in DOCRE.finditer(raw):
        b = m.group(1); tm = TYPE.search(b)
        # drop SGML header lines up to <TEXT>
        i = re.search(r'(?i)<TEXT>', b)
        body = b[i.end():] if i else b
        docs.append((tm.group(1).upper() if tm else 'UNKNOWN', body))
    if not docs: docs = [('UNKNOWN', raw)]
    return docs

def is_main(t): return bool(re.match(r'10-?K', t))

I1 = re.compile(r'(?im)^[ \t]*(?:part[ \t]+i\b[ \t.,:\-–—]*)?item[ \t]*1[ \t]*(?:[.:\-–—)]|\b)(?![0-9])')
I2 = re.compile(r'(?im)^[ \t]*(?:part[ \t]+i\b[ \t.,:\-–—]*)?item[ \t]*(?:1[ \t]*a|1[ \t]*b|2)[ \t]*(?:[.:\-–—)]|\b)(?![0-9])')
I5 = re.compile(r'(?im)^[ \t]*(?:part[ \t]+ii\b[ \t.,:\-–—]*)?item[ \t]*5[ \t.:\-–—)]*\s{0,10}market\b')
I6 = re.compile(r'(?im)^[ \t]*item[ \t]*6\b(?![0-9])')
I7 = re.compile(r'(?im)^[ \t]*item[ \t]*7\b(?![0-9])')
I8 = re.compile(r'(?im)^[ \t]*item[ \t]*8\b(?![0-9])')

def cover(t):
    for m in I1.finditer(t):
        if m.start() >= 500: return t[:m.start()][:8000], True, (0, min(m.start(), 8000))
    return t[:8000], False, (0, min(len(t), 8000))

def item5(t):
    for m in I5.finditer(t):
        n = I6.search(t, m.end())
        if n and n.start() - m.start() >= 300:
            e = min(n.start(), m.start() + 8000); return t[m.start():e], True, (m.start(), e)
        if not n:
            n7 = I7.search(t, m.end())
            if n7 and n7.start() - m.start() >= 300:
                e = min(n7.start(), m.start() + 8000); return t[m.start():e], True, (m.start(), e)
    return None, False, None

CAPH = re.compile(r"(?i)^[\s\W\d]*(?:note\s*\d*[\s.:\-–—]*)?(?:[ivx]+[\s.:\-–—]+|\d+[\s.:\-–—]+|\(?[a-z]\)[\s]+)?"
                  r"(?P<k>(?:description of )?capital stock|capital structure|share capital|(?:stockholders|shareholders|shareowners|stockholder|shareholder)['’`]?s?['’`]? ?equity|(?:common|preferred and common|common and preferred) (?:stock|shares)|capitalization)\b")
def capnotes(t, start_at, doc_label, taken):
    out = []; pos = 0
    for m in re.finditer(r'[^\n]+', t):
        if m.start() < start_at or len(m.group()) > 90: continue
        ln = m.group().strip(); h = CAPH.match(ln)
        if not h or '...' in ln or len(ln) - h.end('k') > 25 or any(c.isdigit() for c in ln[h.end('k'):]): continue
        fa = next((c for c in ln[h.start('k'):] if c.isalpha()), 'a')
        if not fa.isupper(): continue
        seg = t[m.start():m.start() + 6000]; nxt = t[m.end():m.end() + 1000]
        if len(nxt) < 300: continue
        if sum(c.isdigit() for c in nxt) / max(len(nxt), 1) >= 0.12: continue
        if sum(1 for l in t[m.end():m.end() + 1500].split('\n') if len(l) >= 60) < 3: continue  # prose test: table-like text has few long lines
        k = h.group('k').lower()
        pri = 0 if 'capital stock' in k or 'capital structure' in k or 'share capital' in k else 1 if 'equity' in k else 2
        out.append((pri, doc_label, m.start(), m.group().strip(), seg))
    return out

VOTE_S = re.compile(r"(?i)votes?\s+per\s+share|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty|fifty|\d+)\s+votes?\b|one[\s-]+tenth\s+(?:of\s+)?(?:one\s+|a\s+)?vote|non[\s-]?voting|no\s+voting\s+rights|limited\s+voting|super[\s-]?voting|(?:without|no)\s+(?:the\s+)?right\s+to\s+vote")
VOTE_W = re.compile(r"(?i)\belect(?:s|ed|ion\s+of)?\b[^.]{0,80}?\bdirectors?\b|\bclass\s+[ab]\b")

def extract(raw):
    docs = split_docs(raw)
    types = [d[0] for d in docs]
    mi = next((i for i, d in enumerate(docs) if is_main(d[0])), 0)
    main = clean(docs[mi][1]); main_type = docs[mi][0]
    ex13 = [(d[0], clean(d[1])) for d in docs if d[0].startswith('EX-13')]
    ex3 = [(d[0], clean(d[1])) for d in docs if d[0].startswith('EX-3')]
    sec = {}; spans = {'main': [], 'ex13': {}, 'ex3': {}}
    ctext, cfound, csp = cover(main); sec['cover'] = {'text': ctext, 'item1_found': cfound}; spans['main'].append(csp)
    itext, ifound, isp = item5(main)
    sec['item5'] = {'text': itext, 'found': ifound}
    if isp: spans['main'].append(isp)
    # capital notes
    st = next((m.start() for m in I8.finditer(main) if not re.search(r'(?i)item[ \t]*9\b', main[m.end():m.end() + 500])), len(main) // 2)
    cands = capnotes(main, st, 'main', None)
    for i, (ty, tx) in enumerate(ex13): cands += capnotes(tx, 0, ty + '#' + str(i), None)
    cands.sort(key=lambda x: (x[0], x[1] != 'main', x[2]))
    sel = []; used = []
    for pri, lab, pos, head, seg in cands:
        if len(sel) == 3: break
        if any(l == lab and abs(pos - p) < 6000 for l, p in used): continue
        used.append((lab, pos)); sel.append({'doc': lab, 'heading': head, 'text': seg, 'pos': pos})
        if lab == 'main': spans['main'].append((pos, pos + len(seg)))
        else: spans['ex13'].setdefault(lab, []).append((pos, pos + len(seg)))
    sec['capnotes'] = sel
    # windows
    hits = []
    pools = [('main', main)] + [(ty + '#' + str(i), tx) for i, (ty, tx) in enumerate(ex13)] + [(ty + '#' + str(i), tx) for i, (ty, tx) in enumerate(ex3)]
    for rank, (lab, tx) in enumerate(pools):
        sp = spans['main'] if lab == 'main' else spans['ex13'].get(lab, [])
        for strength, rx in ((0, VOTE_S), (1, VOTE_W)):
            for m in rx.finditer(tx):
                a = max(0, m.start() + (m.end() - m.start()) // 2 - 300); b = min(len(tx), a + 600)
                if any(a < e and b > s for s, e in sp): continue
                w = tx[a:b]
                if strength == 1 and (sum(c.isdigit() for c in w) / max(len(w), 1) >= 0.12 or 'vot' not in w.lower()): continue  # weak hits: no numeric tables, must mention vot*
                hits.append((strength, rank, a, b, lab, m.group().strip()[:40], tx))
    hits.sort(key=lambda h: (h[0], h[1], h[2]))
    wins = []; tot = 0; taken = {}
    for strength, rank, a, b, lab, ph, tx in hits:
        if tot + (b - a) > 6000: break
        if any(a < e and b > s for s, e in taken.get(lab, [])): continue
        taken.setdefault(lab, []).append((a, b)); wins.append({'doc': lab, 'phrase': ph, 'strong': strength == 0, 'text': tx[a:b], 'pos': a}); tot += b - a
    sec['windows'] = wins
    meta = {'doc_types': types, 'main_type': main_type, 'has_ex13': bool(ex13), 'n_ex13': len(ex13), 'n_ex3': len(ex3), 'main_chars': len(main), 'n_windows_candidates': len(hits)}
    return sec, meta

def sizes(sec):
    c = len(sec['cover']['text']); i = len(sec['item5']['text'] or ''); k = sum(len(x['text']) for x in sec['capnotes']); w = sum(len(x['text']) for x in sec['windows'])
    return {'chars_cover': c, 'chars_item5': i, 'chars_capnotes': k, 'chars_windows': w, 'chars_total': c + i + k + w}


def assemble(sec):
    """The text the classifier sees: labelled segments in a fixed order. Absent sections are marked, never silently skipped."""
    out = [f"=== COVER PAGE (Item 1 boundary found: {sec['cover']['item1_found']}) ===", sec['cover']['text'].strip()]
    out.append('=== ITEM 5 (MARKET FOR COMMON EQUITY) ===')
    out.append(sec['item5']['text'].strip() if sec['item5']['text'] else '[Item 5 not located in the main document]')
    out.append('=== CAPITAL STOCK / STOCKHOLDERS EQUITY NOTES ===')
    if sec['capnotes']:
        for c in sec['capnotes']:
            out.append(f"--- [{c['doc']}] {c['heading']} ---"); out.append(c['text'].strip())
    else:
        out.append('[no capital stock / equity note located]')
    out.append('=== VOTING-PHRASE WINDOWS ===')
    if sec['windows']:
        for w in sec['windows']:
            out.append(f"--- [{w['doc']}] near '{w['phrase']}' ---"); out.append(w['text'].strip())
    else:
        out.append('[no voting-phrase windows]')
    return '\n'.join(out)
