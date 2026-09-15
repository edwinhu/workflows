#!/usr/bin/env python3
"""Own the bibliography as an INDEX: every entry pointing at the right PDF, and
that PDF being the version of record.

Five subcommands, independent of one another:

  audit    the state of the bib -- entries with/without `file`, files that are
           missing on disk, entries without a DOI, and PDFs no entry claims
  link     build citekey -> PDF and write `file = {...}` into each entry
  version  is each entry's PDF the published version, or a preprint/proof?
  doi      backfill missing DOIs from Crossref, and only correct ones
  fedreg   fetch the Federal Register PDFs the entries cite

pincite CONSUMES this bibliography: it resolves footnote -> source through
`file = {...}` and nothing else, so an entry with no file is a footnote pincite
silently cannot supply, and an entry pointing at a preprint is a pincite that is
confidently wrong. This tool owns that index; pincite only reads it.

audit, link and version touch the network never. doi and fedreg do.
"""
import argparse, difflib, importlib.util, json, pathlib, re, shutil, sys, time
import urllib.error, urllib.parse, urllib.request

DEFAULTS = dict(
    bib='paper/references/sources.bib',
    pdf_dir='paper/references/sources/pdf',
    fedreg_dir='paper/references/sources/fedreg',
)

ROOT = pathlib.Path.cwd()

# ---------------------------------------------------------- pincite helpers
#
# The printed-page derivation is pincite's, imported rather than copied:
# page_numbers/page_offset/pages_of are pure functions of a PDF's text, and
# pincite.py does nothing at import time (its globals are None until main()
# runs, which is guarded). Copying them would let the two skills' notions of
# "what page is this" drift apart -- and a `version` verdict that disagreed with
# pincite's would be worse than no verdict.

def _load_pincite():
    here = pathlib.Path(__file__).resolve()
    cand = [here.parent.parent.parent / 'pincite' / 'scripts' / 'pincite.py',
            here.parent / 'pincite.py']
    for p in cand:
        if p.exists():
            spec = importlib.util.spec_from_file_location('pincite', p)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    sys.exit('cannot find pincite.py (expected beside this skill at '
             f'{cand[0]}); pass --pincite')


PIN = None

# ------------------------------------------------------------------- bibtex

ENTRY = re.compile(r'@(\w+)\s*\{\s*([^,\s]+)\s*,(.*?)\n\}', re.S)


def fields(body):
    """name -> value for one entry body.

    The LAST field of an entry has no trailing newline (the entry regex
    consumed it), so the line end must be optional -- the same quirk pincite
    hit. Miss it and every entry silently loses its final field, which here is
    usually `file`."""
    out = {}
    for m in re.finditer(r'\b(\w+)\s*=\s*\{+(.*?)\}+\s*,?\s*(?:\n|$)', body, re.S):
        out[m.group(1).lower()] = re.sub(r'\s+', ' ', m.group(2)).strip()
    return out


def entries(text):
    """[(key, type, fields, span)] in file order, span into `text`."""
    out = []
    for m in ENTRY.finditer(text):
        out.append(dict(key=m.group(2).strip(), type=m.group(1).lower(),
                        f=fields(m.group(3)), span=m.span(), body=m.group(3)))
    return out


def surname(author):
    """First author's surname, lowercased."""
    if not author:
        return ''
    first = re.split(r'\s+and\s+', author)[0]
    if ',' in first:                      # "Rock, Edward B."
        return first.split(',')[0].strip().lower()
    parts = first.split()
    return parts[-1].lower() if parts else ''


def norm_title(s):
    """Lowercased, punctuation flattened -- Paperpile renders a colon as ' - '
    and drops apostrophes, so raw string equality never fires."""
    s = s.lower().replace('&', 'and')
    s = re.sub(r"[^a-z0-9]+", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()


# --------------------------------------------------------------- discovery

def all_pdfs(pdf_dir):
    return sorted(p for p in pdf_dir.rglob('*.pdf') if p.is_file())


# `Author Year - Title.pdf` (Paperpile). The year is optional: book chapters
# come out as `Rock - Institutional Investors in Corporate Governance.pdf`.
PAPERPILE = re.compile(r'^(?P<auth>.+?)(?:\s+(?P<year>(?:1[89]|20)\d{2}))?\s+-\s+(?P<title>.+)$')


def parse_stem(stem):
    """(surname, year|None, title) or None when the stem is not Paperpile-shaped."""
    m = PAPERPILE.match(stem)
    if not m:
        return None
    # Paperpile writes SURNAMES ONLY -- "Barzuza et al.", "Bebchuk and Hirst",
    # "Rock" -- so the first-author surname is the FIRST token. Taking the last
    # token (the habit from a bibtex `author` field, where it is right) reads
    # "Barzuza et al." as an author named "al." and unmaps every multi-author
    # PDF -- 14 of 83 here.
    tok = m.group('auth').strip().split()
    if not tok:
        return None
    return tok[0].strip(',.').lower(), m.group('year'), m.group('title').strip()


# A DIFFERENT year means only the title separates two papers by one author, so
# the title must be near-identical. Same year, the year itself is corroboration
# and a looser title match is safe.
SAME_YEAR, DIFF_YEAR = 0.55, 0.95


def build_mapping(ents, pdfs, pdf_dir):
    """citekey -> (path, how, score). Never forces a match.

    Two matchers, in order. Stem == citekey is exact and covers everything a
    fetcher named for its key. The Paperpile matcher is the fuzzy one, and its
    threshold is where the false positives live."""
    by_key = {e['key'].lower(): e for e in ents}
    taken, out, why = {}, {}, []

    for p in pdfs:
        k = p.stem.lower()
        if k in by_key and k not in out:
            out[k] = (p, 'stem==citekey', 1.0)
            taken[p] = k

    # Candidate entries grouped by first-author surname, so the fuzzy pass only
    # ever compares titles within one author.
    by_sur = {}
    for e in ents:
        s = surname(e['f'].get('author', ''))
        if s:
            by_sur.setdefault(s, []).append(e)

    for p in pdfs:
        if p in taken:
            continue
        parsed = parse_stem(p.stem)
        if not parsed:
            why.append((p, 'filename is not `Author Year - Title`'))
            continue
        sur, yr, title = parsed
        best, best_score, best_need = None, 0.0, None
        for e in by_sur.get(sur, []):
            if e['key'].lower() in out:
                continue
            bt = e['f'].get('title', '')
            if not bt:
                continue
            score = difflib.SequenceMatcher(
                None, norm_title(title), norm_title(bt), autojunk=False).ratio()
            need = SAME_YEAR if (yr and yr == e['f'].get('year')) else DIFF_YEAR
            if score >= need and score > best_score:
                best, best_score, best_need = e, score, need
        if best is None:
            near = max(((difflib.SequenceMatcher(None, norm_title(title),
                                                 norm_title(e['f'].get('title', '')),
                                                 autojunk=False).ratio(), e)
                        for e in by_sur.get(sur, []) if e['f'].get('title')),
                       default=(0.0, None))
            if near[1] is None:
                why.append((p, f'no bib entry with first author "{sur}"'))
            else:
                need = SAME_YEAR if (yr and yr == near[1]['f'].get('year')) else DIFF_YEAR
                why.append((p, f'best title match {near[1]["key"]} scored '
                               f'{near[0]:.2f}, below {need:.2f} '
                               f'(pdf year {yr or "-"}, bib year '
                               f'{near[1]["f"].get("year", "-")})'))
            continue
        out[best['key'].lower()] = (p, f'author+title {best_score:.2f}'
                                       f' (>= {best_need:.2f})', best_score)
        taken[p] = best['key'].lower()
    return out, why


# ------------------------------------------------------------------ writing

def replace_field(chunk, name, value):
    """Return one entry's chunk with `name = {...}` rewritten to `value`.

    Only the braced value changes; the field's position, indentation and
    trailing comma are the entry's own bytes and stay as they were."""
    pat = re.compile(r'(\b' + name + r'\s*=\s*)\{+.*?\}+', re.S | re.I)
    new, n = pat.subn(lambda m: m.group(1) + '{' + value + '}', chunk, count=1)
    return new if n else chunk


def insert_file(text, ent, relpath):
    """Return `text` with `file = {relpath}` added to one entry.

    Additive by construction: the entry's existing bytes are untouched except
    for a comma appended to what was the last field. Anything that rewrote the
    entry would reformat 197 entries the user did not ask to have reformatted,
    and the diff would be unreviewable."""
    s, e = ent['span']
    chunk = text[s:e]
    close = chunk.rfind('\n}')
    head, tail = chunk[:close], chunk[close:]
    stripped = head.rstrip()
    if not stripped.endswith(','):
        head = stripped + ','
    else:
        head = stripped
    indent = re.search(r'\n(\s+)\w+\s*=', chunk)
    pad = indent.group(1) if indent else '  '
    return text[:s] + head + f'\n{pad}file = {{{relpath}}}' + tail + text[e:]


# ------------------------------------------------------------------- audit

def cmd_audit(a, bib, pdf_dir, fedreg_dir):
    text = bib.read_text()
    ents = entries(text)
    pdfs = all_pdfs(pdf_dir)

    have_file = [e for e in ents if e['f'].get('file')]
    missing_file = [e for e in ents if not e['f'].get('file')]
    broken = [e for e in have_file if not (ROOT / e['f']['file']).exists()]
    have_doi = [e for e in ents if e['f'].get('doi')]

    claimed = set()
    for e in have_file:
        p = ROOT / e['f']['file']
        try:
            claimed.add(p.resolve())
        except OSError:
            pass
    unclaimed = [p for p in pdfs if p.resolve() not in claimed]

    print(f"bib      {bib}")
    print(f"entries  {len(ents)}")
    print(f"  with file = {{...}}   {len(have_file)}")
    print(f"  without file         {len(missing_file)}")
    print(f"  file missing on disk {len(broken)}")
    print(f"  with a DOI           {len(have_doi)}")
    print(f"  without a DOI        {len(ents) - len(have_doi)}")
    print(f"\npdfs     {len(pdfs)} under {pdf_dir}")
    print(f"  claimed by an entry  {len(pdfs) - len(unclaimed)}")
    print(f"  unclaimed            {len(unclaimed)}")

    fr = sorted(fedreg_dir.glob('fedreg-*.pdf')) if fedreg_dir.exists() else []
    print(f"\nfedreg   {len(fr)} under {fedreg_dir}")

    if broken:
        print("\nFILE MISSING ON DISK")
        for e in broken:
            print(f"  {e['key']:<28} {e['f']['file']}")
    if unclaimed:
        print("\nUNCLAIMED PDFS (no entry points at these)")
        for p in unclaimed:
            print(f"  {p.relative_to(pdf_dir)}")
    if missing_file and a.verbose:
        print("\nENTRIES WITHOUT A FILE")
        for e in missing_file:
            print(f"  {e['key']:<28} {e['f'].get('title', '')[:70]}")
    elif missing_file:
        print(f"\nENTRIES WITHOUT A FILE ({len(missing_file)}; --verbose to list)")
        for e in missing_file[:10]:
            print(f"  {e['key']:<28} {e['f'].get('title', '')[:70]}")
        if len(missing_file) > 10:
            print(f"  ... and {len(missing_file) - 10} more")
    return 0


# -------------------------------------------------------------------- link

def cmd_link(a, bib, pdf_dir, fedreg_dir):
    text = bib.read_text()
    ents = entries(text)
    pdfs = all_pdfs(pdf_dir)
    mapping, why = build_mapping(ents, pdfs, pdf_dir)

    by_key = {e['key'].lower(): e for e in ents}
    already = {k for k, e in by_key.items() if e['f'].get('file')}
    new = {k: v for k, v in mapping.items() if k not in already}

    print(f"entries {len(ents)}, pdfs {len(pdfs)}")
    print(f"mapped  {len(mapping)}  ({len(new)} of them entries that had no file)")
    for k in sorted(mapping):
        p, how, _ = mapping[k]
        mark = ' ' if k in already else '+'
        print(f" {mark} {k:<28} {how:<26} {p.relative_to(pdf_dir)}")

    unmapped_keys = [e['key'] for e in ents if e['key'].lower() not in mapping]
    print(f"\nUNMAPPED ENTRIES ({len(unmapped_keys)}) -- no PDF on disk matched")
    for k in unmapped_keys:
        print(f"  {k}")
    print(f"\nUNMAPPED PDFS ({len(why)}) -- no entry claimed these")
    for p, reason in why:
        print(f"  {p.relative_to(pdf_dir)}\n      {reason}")

    if a.dry_run:
        print("\n--dry-run: nothing written")
        return 0
    if not new:
        print("\nnothing to write")
        return 0
    # Apply back-to-front so earlier spans stay valid.
    for k in sorted(new, key=lambda k: by_key[k]['span'][0], reverse=True):
        p = new[k][0]
        rel = p.resolve().relative_to(ROOT)
        text = insert_file(text, by_key[k], str(rel))
    if a.backup:
        shutil.copy2(bib, str(bib) + '.bak')
    bib.write_text(text)
    print(f"\nwrote {len(new)} file fields into {bib}")
    return 0


# ----------------------------------------------------------------- version

# An Elsevier ARTICLE NUMBER is not a page. `J. Fin. Econ. 154 (2024) 103810`
# is paginated 1-N in its own PDF and IS the version of record -- testing its
# range against "page 103810" reports every such entry as a preprint.
ARTICLE_NUMBER = re.compile(r'^\d{6}$')

# An advance-access proof zeroes the volume and issue it has not been assigned
# yet: OUP served `v 00 n 0 2021`, internal name `RFS-OP-...tex`, pages 1-49.
# Matching a bib journal name against page 1 instead is worthless -- bib names
# are Bluebook abbreviations ("Rev. Fin. Stud.") and mastheads are not ("The
# Review of Financial Studies"); that test flagged 46 of 61 entries.
VOLUME = re.compile(r'\bvol(?:ume)?\.?\s*(\d+)|\bv\s*(\d+)\s+n\s*(\d+)', re.I)
PROOF = re.compile(r'[A-Z]{2,6}-OP-\S*\.tex|advance\s+access|accepted\s+manuscript'
                   r'|author\s+proof|uncorrected\s+proof', re.I)

# How many PDF pages beyond the printed span are still the version of record:
# a cover sheet, and the next article's first page bound into the offprint.
PAGE_COUNT_SLACK = 2


def pin_offset(text_pages):
    """(k, confidence, dominant) from pincite, whichever shape it returns.

    pincite now answers with dict(k, confidence, accepted, ...) and older
    copies answer with the 3-tuple. The two skills ship independently, so
    bibman reads whatever pincite.py is on disk rather than pinning a version.

    Called with the PDF alone -- never the bib's start page. pincite's
    corroboration route REFUSES an offset whose printed range excludes that
    start page, which is precisely the NOT-VOR case this command exists to
    report; feeding it in would turn those verdicts into UNKNOWN."""
    r = PIN.page_offset(text_pages)
    if isinstance(r, dict):
        return r.get('k'), r.get('confidence', 0.0), bool(r.get('accepted'))
    return r


def has_masthead(page1):
    """Does page 1 carry a real (nonzero) volume designation?

    Deliberately NOT a journal-name match."""
    for m in VOLUME.finditer(page1):
        for g in m.groups():
            if g and int(g) > 0:
                return True
    return False


def start_page(pages):
    m = re.match(r'\s*(\d+)', pages or '')
    return int(m.group(1)) if m else None


# `446`, and nothing else. An entry whose `pages` holds a range or a Bluebook
# pincite (`66-67`, `849, 851--52`) is a value someone chose; the range backfill
# must leave it alone rather than overwrite it with the article's full span.
BARE_PAGE = re.compile(r'^\d+$')


def page_range(pages):
    """(lo, hi) from `446-486` / `446--486`, else None.

    `hi > lo` rejects both a degenerate `446-446` and Crossref's occasional
    elided form (`446-86`), where the second number is not a page at all."""
    m = re.match(r'\s*(\d+)\s*-{1,3}\s*(\d+)\s*$', pages or '')
    if not m:
        return None
    lo, hi = int(m.group(1)), int(m.group(2))
    return (lo, hi) if hi > lo else None


def end_page(pages):
    r = page_range(pages)
    return r[1] if r else None


def cmd_version(a, bib, pdf_dir, fedreg_dir):
    ents = entries(bib.read_text())
    rows = []
    for e in ents:
        rel = e['f'].get('file')
        if not rel:
            continue
        p = ROOT / rel
        key, pages = e['key'], e['f'].get('pages', '')
        if a.only and key not in a.only:
            continue
        if not p.exists():
            rows.append((key, 'MISSING', 'file not on disk', ''))
            continue
        if ARTICLE_NUMBER.match(pages.strip()):
            rows.append((key, 'OK', 'article-number journal '
                         f'(pages = {pages}); range test skipped', ''))
            continue
        want = start_page(pages)
        if want is None:
            rows.append((key, 'SKIP', 'entry has no start page to test against', ''))
            continue
        text_pages = PIN.pages_of(p)
        k, conf, dominant = pin_offset(text_pages)
        if k is None or (conf < 0.5 and not dominant):
            rows.append((key, 'UNKNOWN',
                         f'page numbering not readable (confidence {conf:.2f})', ''))
            continue
        lo, hi = 1 + k, len(text_pages) + k
        n = len(text_pages)
        want_hi = end_page(pages)
        if want_hi is None:
            # No end page recorded: the only test available is the one this
            # command has always run. Most entries are still here.
            rng = f'derived pp. {lo}-{hi}, bib says {want}'
            fails = [] if lo <= want <= hi else ['start page outside derived range']
        else:
            span = want_hi - want + 1
            rng = (f'derived pp. {lo}-{hi} ({n} pp.), '
                   f'bib says {want}-{want_hi} ({span} pp.)')
            fails = []
            if not lo <= want <= hi:
                fails.append('start page outside derived range')
            if not lo <= want_hi <= hi:
                fails.append('end page outside derived range')
            # A PDF cannot contain a printed span longer than itself, and one
            # far longer than the span is a different artifact -- a preprint
            # paginated 1-N, or the whole issue. SLACK covers a cover sheet or
            # a trailing page of the next article.
            if n < span:
                fails.append(f'PDF has {n} pages, the span needs {span}')
            elif n > span + PAGE_COUNT_SLACK:
                fails.append(f'PDF has {n} pages for a {span}-page span')
        if not fails:
            rows.append((key, 'OK', rng, ''))
            continue
        note = '; '.join(fails)
        page1 = text_pages[0] if text_pages else ''
        if not has_masthead(page1):
            note += ' | ADVANCE-ACCESS PROOF: page 1 shows no volume'
            m = PROOF.search(page1)
            if m:
                note += f' ({m.group(0).strip()[:40]})'
        rows.append((key, 'NOT-VOR', rng, note))

    bad = [r for r in rows if r[1] in ('NOT-VOR', 'MISSING')]
    print(f"tested {len(rows)} entries with a file")
    for verdict in ('NOT-VOR', 'MISSING', 'UNKNOWN', 'SKIP', 'OK'):
        n = sum(1 for r in rows if r[1] == verdict)
        if n:
            print(f"  {verdict:<8} {n}")
    print()
    for key, verdict, detail, note in rows:
        if verdict == 'OK' and not a.verbose:
            continue
        print(f"  {verdict:<8} {key:<28} {detail}")
        if note:
            print(f"           {'':<28} {note}")
    return 1 if bad and a.strict else 0


# --------------------------------------------------------------------- doi

CROSSREF = 'https://api.crossref.org/works'


def crossref(query, mailto, rows=5):
    url = CROSSREF + '?' + urllib.parse.urlencode(
        {'query.bibliographic': query, 'rows': rows, 'mailto': mailto})
    req = urllib.request.Request(url, headers={
        'User-Agent': f'bibman/1.0 (mailto:{mailto})'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.load(r)['message']['items']
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as ex:
            if attempt == 3:
                raise
            time.sleep(2 ** attempt)


def range_blocked(ent):
    """Why this entry may never be given a page range, or None if it may.

    Decided from the BIB ALONE, before any network call, so an entry whose
    `pages` must be left alone is reported whether or not Crossref answers at
    all. Every condition is about not corrupting a value that is already
    right."""
    pages = (ent['f'].get('pages') or '').strip()
    if ent['type'] != 'article':
        return f'@{ent["type"]}, not @article'
    if ARTICLE_NUMBER.match(pages):
        return 'Elsevier article number, not a page'
    if not pages:
        return 'entry has no pages field to extend'
    if not BARE_PAGE.match(pages):
        return 'pages is already a range or a pincite'
    return None


def range_from(ent, item):
    """`start--end` for this entry's `pages`, or (None, why not).

    The DOI match is the range's only provenance: the caller reaches this only
    with a Crossref record already accepted for this entry, and the start page
    is re-checked here so the two can never disagree."""
    pages = (ent['f'].get('pages') or '').strip()
    got = page_range(item.get('page', ''))
    if not got:
        return None, f'Crossref page {item.get("page") or "-"!r} is not a range'
    if got[0] != int(pages):
        return None, f'Crossref range starts at {got[0]}, bib says {pages}'
    return f'{got[0]}--{got[1]}', ''


def cmd_doi(a, bib, pdf_dir, fedreg_dir):
    text = bib.read_text()
    ents = entries(text)
    todo = [e for e in ents
            if not e['f'].get('doi') and e['f'].get('title')
            and (not a.only or e['key'] in a.only)]
    print(f"{len(todo)} entries without a DOI to query\n")
    found, ranges, range_skips = {}, {}, []
    for e in todo[:a.limit] if a.limit else todo:
        f = e['f']
        want = start_page(f.get('pages', ''))
        # Decided before the query: whether this entry's `pages` may be
        # touched at all is a property of the bib, not of what Crossref says.
        blocked = range_blocked(e)
        if blocked and f.get('pages'):
            range_skips.append((e['key'], f['pages'], blocked))
        # Title alone returns the SSRN PREPRINT DOI (10.2139/ssrn.*) -- that
        # happened on 6 of 7 test entries. Journal, volume and pages are what
        # pull the published record into the result set.
        q = ' '.join(x for x in (f.get('title', ''), f.get('journal', ''),
                                 f.get('volume', ''), f.get('pages', ''),
                                 f.get('year', '')) if x)
        try:
            items = crossref(q, a.mailto)
        except Exception as ex:
            print(f"  {e['key']:<28} QUERY FAILED {type(ex).__name__}: {ex}")
            continue
        pick, rejected = None, []
        for it in items or []:
            doi = it.get('DOI', '')
            got = start_page(it.get('page', ''))
            vol = (it.get('volume') or '').strip()
            ok_page = want is not None and got == want
            ok_vol = not f.get('volume') or not vol or vol == f['volume']
            if ok_page and ok_vol:
                pick = (doi, it)
                break
            rejected.append((doi, it.get('page', '-'), vol,
                             (it.get('title') or [''])[0][:60]))
        if pick:
            found[e['key']] = pick[0]
            print(f"  {e['key']:<28} {pick[0]}")
            print(f"  {'':<28} page {pick[1].get('page')} == bib {f.get('pages')}"
                  f"  vol {pick[1].get('volume')}")
            if blocked:
                print(f"  {'':<28} pages SKIPPED ({blocked}); "
                      f"keeping {{{f.get('pages', '')}}}")
            else:
                rng, why_not = range_from(e, pick[1])
                if rng:
                    ranges[e['key']] = rng
                    print(f"  {'':<28} pages {f.get('pages')} -> {{{rng}}}")
                else:
                    range_skips.append((e['key'], f.get('pages', ''), why_not))
                    print(f"  {'':<28} pages SKIPPED ({why_not}); "
                          f"keeping {{{f.get('pages', '')}}}")
        else:
            print(f"  {e['key']:<28} NO VERIFIED DOI (bib start page "
                  f"{want}); not writing one")
            for doi, page, vol, title in rejected[:3]:
                print(f"  {'':<28}   rejected {doi}  page={page} vol={vol}  {title}")

    by_key = {e['key']: e for e in ents}
    if ranges:
        print(f"\nPAGE RANGES ({len(ranges)}) -- start page unchanged, end page added")
        for k in sorted(ranges, key=lambda k: by_key[k]['span'][0]):
            print(f"  {k:<28} pages = {{{ranges[k]}}}")
    if range_skips:
        print(f"\nPAGE RANGES SKIPPED ({len(range_skips)}) -- existing value preserved")
        for k, pages, why in sorted(range_skips,
                                    key=lambda r: by_key[r[0]]['span'][0]):
            print(f"  {k:<28} pages = {{{pages}}}  ({why})")

    if a.dry_run:
        print(f"\n--dry-run: {len(found)} verified DOIs, {len(ranges)} page "
              f"ranges, nothing written")
        return 0
    if not found:
        print("\nno verified DOIs to write")
        return 0
    for k in sorted(found, key=lambda k: by_key[k]['span'][0], reverse=True):
        e = by_key[k]
        s, en = e['span']
        chunk = text[s:en]
        if k in ranges:
            chunk = replace_field(chunk, 'pages', ranges[k])
        close = chunk.rfind('\n}')
        head, tail = chunk[:close].rstrip(), chunk[close:]
        if not head.endswith(','):
            head += ','
        ind = re.search(r'\n(\s+)\w+\s*=', chunk)
        pad = ind.group(1) if ind else '  '
        text = text[:s] + head + f'\n{pad}doi = {{{found[k]}}}' + tail + text[en:]
    if a.backup:
        shutil.copy2(bib, str(bib) + '.bak')
    bib.write_text(text)
    print(f"\nwrote {len(found)} DOIs and {len(ranges)} page ranges into {bib}")
    return 0


# ------------------------------------------------------------------ fedreg

FR_CITE = re.compile(r'(\d+)\s+Fed\.\s*Reg\.\s*~?\s*([\d,]+)')
GOVINFO = 'https://www.govinfo.gov/link/fr/{vol}/{page}?link-type=pdf'


def cmd_fedreg(a, bib, pdf_dir, fedreg_dir):
    text = bib.read_text()
    cites = []
    seen = set()
    for vol, page in FR_CITE.findall(text):
        page = page.replace(',', '').rstrip('.')
        if (vol, page) not in seen:
            seen.add((vol, page))
            cites.append((vol, page))
    print(f"{len(cites)} distinct Fed. Reg. citations in {bib}\n")
    fedreg_dir.mkdir(parents=True, exist_ok=True)
    for vol, page in cites:
        out = fedreg_dir / f'fedreg-{vol}-{page}.pdf'
        if out.exists() and not a.force:
            print(f"  {vol} Fed. Reg. {page}  have it ({out.name})")
            continue
        url = GOVINFO.format(vol=vol, page=page)
        if a.dry_run:
            print(f"  {vol} Fed. Reg. {page}  would fetch {url}")
            continue
        # federalregister.gov bot-blocks every request and lands on
        # unblock.federalregister.gov; govinfo's link service does not.
        req = urllib.request.Request(url, headers={
            'User-Agent': f'bibman/1.0 ({a.mailto})'})
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
        except Exception as ex:
            print(f"  {vol} Fed. Reg. {page}  FAILED {type(ex).__name__}: {ex}")
            continue
        out.write_bytes(data)
        mb = len(data) / 1e6
        print(f"  {vol} Fed. Reg. {page}  {mb:.1f} MB -> {out.name}")
        if int(vol) < 65 or mb > 50:
            # Pre-2000 volumes are served as the WHOLE ISSUE, 200+ MB, and the
            # cited document is a few pages inside it.
            print(f"      WARNING: this looks like the whole issue, not the "
                  f"document. Trim it:\n"
                  f"      qpdf --empty --pages '{out}' a-b -- '{out}'")
    print("\nNote: the SEC's own release PDF of the same document has different "
          "pagination,\nso it is the wrong source for a Fed. Reg. pincite.")
    return 0


# -------------------------------------------------------------------- main

def main():
    global ROOT, PIN
    ap = argparse.ArgumentParser(
        prog='bibman.py',
        description='Own the bibliography: link entries to PDFs, check the PDF '
                    'is the version of record, backfill DOIs, fetch Fed. Reg.')
    ap.add_argument('cmd', choices=['audit', 'link', 'version', 'doi', 'fedreg'])
    ap.add_argument('--root', default='.', help='manuscript repo root (default: cwd)')
    ap.add_argument('--bib', help=f"bibliography (default: {DEFAULTS['bib']})")
    ap.add_argument('--pdf-dir', help=f"source PDFs (default: {DEFAULTS['pdf_dir']})")
    ap.add_argument('--fedreg-dir', help=f"Fed. Reg. PDFs (default: {DEFAULTS['fedreg_dir']})")
    ap.add_argument('--pincite', help='path to pincite.py (default: the sibling skill)')
    ap.add_argument('--dry-run', action='store_true',
                    help='link/doi/fedreg: report, write nothing')
    ap.add_argument('--backup', action='store_true',
                    help='write <bib>.bak before modifying the bibliography')
    ap.add_argument('--only', default='',
                    help='comma-separated citekeys to restrict version/doi to')
    ap.add_argument('--limit', type=int, default=0, help='doi: stop after N entries')
    ap.add_argument('--force', action='store_true', help='fedreg: refetch what exists')
    ap.add_argument('--strict', action='store_true',
                    help='version: exit 1 if any entry is not the version of record')
    ap.add_argument('--verbose', action='store_true')
    ap.add_argument('--mailto', default='bibman@example.org',
                    help='contact address sent to Crossref/govinfo (be polite)')
    a = ap.parse_args()

    ROOT = pathlib.Path(a.root).resolve()
    pick = lambda flag, key: (pathlib.Path(flag).resolve() if flag
                              else ROOT / DEFAULTS[key])
    bib = pick(a.bib, 'bib')
    pdf_dir = pick(a.pdf_dir, 'pdf_dir')
    fedreg_dir = pick(a.fedreg_dir, 'fedreg_dir')
    a.only = {x.strip() for x in a.only.split(',') if x.strip()}

    if not bib.exists():
        sys.exit(f"no bibliography at {bib} (pass --bib)")
    if a.cmd in ('audit', 'link', 'version') and not pdf_dir.exists():
        if a.cmd != 'version':
            sys.exit(f"no PDF directory at {pdf_dir} (pass --pdf-dir)")
    if a.cmd == 'version':
        if a.pincite:
            spec = importlib.util.spec_from_file_location('pincite', a.pincite)
            PIN = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(PIN)
        else:
            PIN = _load_pincite()

    return {'audit': cmd_audit, 'link': cmd_link, 'version': cmd_version,
            'doi': cmd_doi, 'fedreg': cmd_fedreg}[a.cmd](a, bib, pdf_dir, fedreg_dir)


if __name__ == '__main__':
    sys.exit(main() or 0)
