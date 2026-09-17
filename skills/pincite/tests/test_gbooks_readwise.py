"""The Readwise half of the BOOK route: a highlight in, a print page out.

A Kindle highlight is a verbatim quote with the book already attached, which is
exactly what `book_page` needs and exactly what a manuscript's paraphrase cannot
give. What stands between the two is Readwise's own storage: flattened em dashes,
spaces lost at line breaks, and ~16 of this book's 92 highlights truncated
mid-sentence with a trailing ellipsis.

No test here touches the network or the `readwise` CLI. Highlights are a recorded
fixture; every lookup is handed a stub finder or a stub `fetch`.
"""
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'scripts'))
import gbooks

FIX = pathlib.Path(__file__).resolve().parent / 'fixtures' / 'gbooks'
ROSENBERG = '0pMEC_mZmaAC'
BOOK_ID = 57553950

# Highlight #51, verbatim as Readwise stores it. Both artifacts are in this one
# record: `people-Monks` (em dash flattened to a hyphen) and `onM Street` (a space
# lost at a line break).
H51 = ('In the fall of 1985, IIS consisted of three people-Monks, Janet Brown, and '
       'Barbara Sleasman, both of whom had worked for him at the Labor Department. '
       'The three of them worked out of a cramped, two-room office onM Street in '
       'Washington.')


def _library():
    return json.loads((FIX / 'readwise_57553950.json').read_text())


def _by_location(loc):
    for h in _library()['highlights']:
        if h.get('location') == loc:
            return h
    raise AssertionError(f'fixture has no highlight at location {loc}')


def _truncated():
    """Readwise stores both forms of the sync artifact: U+2026 and ASCII '...'."""
    return sorted((h for h in _library()['highlights']
                   if (h.get('text') or '').rstrip().endswith(('…', '...'))),
                  key=lambda h: h['location'])


# --- normalisation ---------------------------------------------------------

def test_normalise_flattened_em_dash():
    """`three people-Monks` is an em dash Readwise stored as a hyphen; the scan
    prints `three people - Monks`. Glued, it is one token and matches nothing."""
    out = gbooks.normalize_quote('three people-Monks, Janet Brown')
    assert 'people Monks' in out
    assert 'people-Monks' not in out


def test_normalise_all_dash_variants():
    for dash in ('—', '–', '‒', '−', '‐', '‑', '-'):
        assert gbooks.normalize_quote(f'people{dash}Monks') == 'people Monks'


def test_normalise_smart_quotes_and_ligatures():
    assert gbooks.normalize_quote('“the ‘office’”') == '"the \'office\'"'
    assert gbooks.normalize_quote('ofﬁce ﬂight ﬀ ﬃ ﬄ') == 'office flight ff ffi ffl'


def test_normalise_collapses_lost_and_doubled_spaces():
    assert gbooks.normalize_quote('a  cramped,   two-room   office') \
        == 'a cramped, two room office'


def test_split_lost_space_repairs_a_line_break_join():
    """`office onM Street` -- Readwise lost the space at a line break."""
    assert gbooks.split_lost_space('office onM Street') == 'office on M Street'


def test_split_lost_space_leaves_real_capitals_alone():
    for token in ('McKinsey', 'IIS', 'DeLorean', 'Monks', 'ISS'):
        assert gbooks.split_lost_space(f'the {token} thing') == f'the {token} thing'


# --- search keys -----------------------------------------------------------

def test_search_key_is_the_authors_own_query():
    """The key taken from highlight #51 is the string the author searched by hand."""
    k = gbooks.search_key(H51)
    assert k['key'] == 'In the fall of 1985, IIS consisted of'
    assert k['truncated'] is False
    assert k['words'] == 8


def test_search_key_avoids_a_window_carrying_an_artifact():
    """A window is only usable if nothing in it is a storage artifact."""
    k = gbooks.search_key('three people-Monks, Janet Brown, and Barbara Sleasman were there')
    assert 'people-Monks' not in k['key']
    assert k['artifacts']


def test_search_key_strips_a_trailing_ellipsis_and_says_so():
    k = gbooks.search_key('The Department of Labor had told pension funds that voting…')
    assert '…' not in k['key']
    assert k['truncated'] is True
    assert k['evidence'] == 'prefix'


def test_search_key_evidence_is_full_sentence_when_nothing_was_stripped():
    assert gbooks.search_key(H51)['evidence'] == 'full-sentence'


def test_search_key_refuses_a_stub():
    k = gbooks.search_key('Yes…')
    assert k['key'] is None
    assert 'too short' in k['reason'].lower()


def test_search_key_never_exceeds_the_hyphenation_ceiling():
    """The scan hyphenates across line breaks, so a long phrase silently fails."""
    long = ' '.join(f'word{i}' for i in range(40))
    assert gbooks.search_key(long)['words'] <= gbooks.MAX_KEY_WORDS


# --- highlight_page --------------------------------------------------------

def _finder(pages):
    """A book_page stand-in keyed on the search string it is handed."""
    def find(quote, **kw):
        page = pages.get(quote)
        return {'page': page, 'page_id': f'PA{page}' if page else None,
                'page_kind': 'arabic' if page else None, 'page_label': None,
                'snippet': 'stub snippet' if page else None,
                'volume_id': kw.get('volume_id'), 'volume': None, 'route': 'stub',
                'quote': quote,
                'reason': None if page else f'quote not found in volume {kw.get("volume_id")}'}
    return find


def test_highlight_page_resolves_the_founding_passage_to_120():
    """Calibration point 1: Kindle location 1874 -> print page 120."""
    h = _by_location(1874)
    r = gbooks.highlight_page(h, volume_id=ROSENBERG,
                              finder=_finder({'In the fall of 1985, IIS consisted of': 120}))
    assert r['page'] == 120
    assert r['reason'] is None
    assert r['location'] == 1874
    assert r['evidence'] == 'full-sentence'


def test_highlight_page_resolves_the_antitrust_passage_to_147():
    """Calibration point 2: Kindle location 2263 -> print page 147."""
    h = _by_location(2263)
    key = gbooks.search_key(h['text'])['key']
    r = gbooks.highlight_page(h, volume_id=ROSENBERG, finder=_finder({key: 147}))
    assert r['page'] == 147
    assert r['location'] == 2263


def test_highlight_page_resolves_a_truncated_highlight_via_its_prefix():
    h = _truncated()[0]
    key = gbooks.search_key(h['text'])['key']
    assert '…' not in key
    r = gbooks.highlight_page(h, volume_id=ROSENBERG, finder=_finder({key: 210}))
    assert r['page'] == 210
    assert r['truncated'] is True
    assert r['evidence'] == 'prefix'


def test_highlight_page_not_found_returns_none_with_a_reason():
    r = gbooks.highlight_page({'text': H51, 'id': 1, 'location': 1874},
                              volume_id=ROSENBERG, finder=_finder({}))
    assert r['page'] is None
    assert r['reason']
    assert 'not found' in r['reason'].lower()


def test_highlight_page_refuses_an_unusable_highlight_without_searching():
    def explode(quote, **kw):
        raise AssertionError('should not have searched')
    r = gbooks.highlight_page({'text': 'Yes…', 'id': 2}, volume_id=ROSENBERG,
                              finder=explode)
    assert r['page'] is None
    assert 'too short' in r['reason'].lower()


def test_highlight_page_accepts_a_bare_string():
    r = gbooks.highlight_page(H51, volume_id=ROSENBERG,
                              finder=_finder({'In the fall of 1985, IIS consisted of': 120}))
    assert r['page'] == 120


def test_highlight_page_reports_the_key_it_actually_searched():
    r = gbooks.highlight_page(_by_location(1874), volume_id=ROSENBERG,
                              finder=_finder({'In the fall of 1985, IIS consisted of': 120}))
    assert r['search_key'] == 'In the fall of 1985, IIS consisted of'
    assert r['highlight_text'].startswith('In the fall of 1985')


def test_highlight_page_goes_through_book_page_by_default():
    """The default finder is the Google route, driven by a stub fetch -- no network."""
    html = (FIX / 'udm36_rosenberg_pa120.html').read_text()
    r = gbooks.highlight_page(_by_location(1874), volume_id=ROSENBERG,
                              fetch=lambda url: html, routes=('udm36',))
    assert r['page'] == 120
    assert r['route'] == 'udm36'


# --- calibrate_highlights --------------------------------------------------

def _pins():
    return [{'highlight': _by_location(1874), 'expected_page': 120},
            {'highlight': _by_location(2263), 'expected_page': 147}]


def _keys():
    return [gbooks.search_key(p['highlight']['text'])['key'] for p in _pins()]


def test_calibrate_highlights_reproduces_the_two_known_pairs():
    a, b = _keys()
    out = gbooks.calibrate_highlights(_pins(), volume_id=ROSENBERG,
                                      finder=_finder({a: 120, b: 147}))
    assert out['verdict'] == 'reproduces'
    assert out['offset'] == 0
    assert [p['returned_page'] for p in out['pins']] == [120, 147]
    assert all(p['match'] for p in out['pins'])


def test_calibrate_highlights_detects_a_consistent_offset():
    """Every pin off by the same k means Google scanned a different printing."""
    a, b = _keys()
    out = gbooks.calibrate_highlights(_pins(), volume_id=ROSENBERG,
                                      finder=_finder({a: 126, b: 153}))
    assert out['verdict'] == 'offset'
    assert out['offset'] == 6


def test_calibrate_highlights_detects_an_inconsistent_book():
    a, b = _keys()
    out = gbooks.calibrate_highlights(_pins(), volume_id=ROSENBERG,
                                      finder=_finder({a: 126, b: 200}))
    assert out['verdict'] == 'inconsistent'
    assert out['offset'] is None


def test_calibrate_highlights_carries_the_evidence_strength_per_pin():
    """A prefix match is weaker evidence than a full sentence and must say so."""
    h = _truncated()[0]
    key = gbooks.search_key(h['text'])['key']
    a, _ = _keys()
    pins = [{'highlight': _by_location(1874), 'expected_page': 120},
            {'highlight': h, 'expected_page': 210}]
    out = gbooks.calibrate_highlights(pins, volume_id=ROSENBERG,
                                      finder=_finder({a: 120, key: 210}))
    assert [p['evidence'] for p in out['pins']] == ['full-sentence', 'prefix']
    assert out['weak'] == 1


def test_calibrate_highlights_will_not_rule_on_one_pin():
    a = _keys()[0]
    out = gbooks.calibrate_highlights([_pins()[0]], volume_id=ROSENBERG,
                                      finder=_finder({a: 120}))
    assert out['verdict'] == 'insufficient'


def test_calibrate_highlights_reports_a_block_as_a_block():
    def blocked(quote, **kw):
        return {'page': None, 'reason': 'blocked by Google on every route tried'}
    out = gbooks.calibrate_highlights(_pins(), volume_id=ROSENBERG, finder=blocked)
    assert out['verdict'] == 'blocked'


# --- block detection over a HEALTHY page -----------------------------------

def test_a_healthy_serp_is_not_read_as_a_block():
    """Google's own SERP bundle ships a script that mentions `/sorry/index` --
    it is the redirect DETECTOR, not a redirect. Matching markers against raw
    HTML turns every good page into `blocked`, which is a refusal to answer a
    question that was in fact answered. Markers belong to rendered text.

    Fixture: the real script fragment from a live results page, joined to the
    recorded card that page carried.
    """
    html = (FIX / 'udm36_healthy_with_sorry_script.html').read_text()
    assert '/sorry/index' in html
    assert gbooks.is_blocked(html) is False
    assert gbooks.parse_udm36(html)[0]['page'] == 120


def test_a_dead_route_falls_through_instead_of_crashing():
    """`jscmd` lives on a host that refuses this client, which can drop the CDP
    connection outright. An exception there kills a whole calibration run mid-way
    -- the surviving route never gets asked."""
    html = (FIX / 'udm36_healthy_with_sorry_script.html').read_text()

    def fetch(url):
        if 'jscmd=' in url:
            raise RuntimeError('Connection to remote host was lost.')
        return html

    r = gbooks.book_page('In the fall of 1985', volume_id=ROSENBERG, fetch=fetch,
                         routes=('jscmd', 'udm36'))
    assert r['page'] == 120
    assert r['route'] == 'udm36'


def test_every_route_dead_is_reported_not_silently_not_found():
    def fetch(url):
        raise RuntimeError('Connection to remote host was lost.')

    r = gbooks.book_page('anything', volume_id=ROSENBERG, fetch=fetch,
                         routes=('jscmd', 'udm36'))
    assert r['page'] is None
    assert 'not found' not in r['reason'].lower()
    assert 'transport' in r['reason'].lower()


def test_the_real_interstitials_are_still_read_as_blocks():
    for name in ('sorry_interstitial.html', 'blocked_unusual_traffic.html'):
        assert gbooks.is_blocked((FIX / name).read_text()) is True, name


def test_highlight_page_answers_through_a_healthy_serp():
    html = (FIX / 'udm36_healthy_with_sorry_script.html').read_text()
    r = gbooks.highlight_page(_by_location(1874), volume_id=ROSENBERG,
                              fetch=lambda url: html, routes=('udm36',))
    assert r['page'] == 120
    assert r['reason'] is None


# --- the librarian handoff -------------------------------------------------

def test_load_highlights_reads_a_librarian_dump():
    hs = gbooks.load_highlights(FIX / 'readwise_57553950.json')
    assert len(hs) >= 80
    assert any(h.get('location') == 1874 for h in hs)


def test_load_highlights_accepts_a_bare_list():
    import tempfile
    with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False) as f:
        json.dump([{'text': H51, 'location': 1874, 'id': 1}], f)
        path = f.name
    assert gbooks.load_highlights(path)[0]['location'] == 1874


def test_nothing_here_shells_out_to_readwise():
    """Highlights are an INPUT this skill is handed. Standing rule: every Readwise
    call goes through the `librarian` agent, never this module."""
    src = pathlib.Path(gbooks.__file__).read_text()
    for forbidden in ('subprocess', 'os.system', 'os.popen', 'readwise-list',
                      'readwise --', 'readwise_list'):
        assert forbidden not in src, forbidden


# --- the fixture is the evidence -------------------------------------------

def test_fixture_preserves_readwises_storage_artifacts():
    """If these artifacts were cleaned out of the fixture, every normalisation
    test above would be testing a hypothetical instead of the real data."""
    lib = _library()
    texts = [h.get('text') or '' for h in lib['highlights']]
    assert any('people-Monks' in t for t in texts), 'flattened em dash'
    assert any('onM Street' in t for t in texts), 'lost space at a line break'
    assert len(_truncated()) >= 10, 'truncated highlights'
    assert lib['book_id'] == BOOK_ID


if __name__ == '__main__':
    sys.exit(pytest.main([__file__, '-q']))
