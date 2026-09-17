"""The BOOK route's gate: page-id parsing, refusal, and the calibration verdict.

No test here touches the network. The Google responses are recorded fixtures in
`fixtures/gbooks/`; every `book_page` call is handed a stub `fetch`.
"""
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'scripts'))
import gbooks

FIX = pathlib.Path(__file__).resolve().parent / 'fixtures' / 'gbooks'
ROSENBERG = '0pMEC_mZmaAC'


# --- page_id parsing -------------------------------------------------------

def test_page_id_arabic():
    assert gbooks.parse_page_id('PA120') == {
        'raw': 'PA120', 'kind': 'arabic', 'page': 120, 'label': '120'}


def test_page_id_roman_front_matter():
    # PR<n> is the nth front-matter leaf; the book prints it as a roman numeral
    # and it is NOT an arabic page, so `page` stays None.
    r = gbooks.parse_page_id('PR7')
    assert r['kind'] == 'roman'
    assert r['page'] is None
    assert r['label'] == 'vii'


def test_page_id_unpaginated_forms():
    # PT = ebook page token, PP = preliminary leaf. Neither carries a print page.
    for raw in ('PT45', 'PP1'):
        r = gbooks.parse_page_id(raw)
        assert r['kind'] == 'unpaginated', raw
        assert r['page'] is None, raw


def test_page_id_appended_section():
    # RA<k>-PA<n> is page n of an appended/reprinted section k.
    r = gbooks.parse_page_id('RA1-PA5')
    assert r['kind'] == 'arabic'
    assert r['page'] == 5
    assert r['section'] == 'RA1'


def test_page_id_garbage_is_not_a_page():
    assert gbooks.parse_page_id('frontcover')['page'] is None
    assert gbooks.parse_page_id('')['page'] is None


# --- response parsing ------------------------------------------------------

def test_parse_search_within_json():
    payload = json.loads((FIX / 'searchwithin_shape.json').read_text())
    hits = gbooks.parse_search_within(payload)
    assert len(hits) == 1
    assert hits[0]['page'] == 120
    assert hits[0]['page_id'] == 'PA120'
    assert 'In the fall of 1985' in hits[0]['snippet']


def test_parse_search_within_no_results():
    assert gbooks.parse_search_within({'number_of_results': 0, 'search_results': []}) == []
    assert gbooks.parse_search_within({'number_of_results': 0}) == []


def test_parse_udm36_recorded_card():
    html = (FIX / 'udm36_rosenberg_pa120.html').read_text()
    hits = gbooks.parse_udm36(html)
    assert hits, 'recorded Books-vertical card should yield a hit'
    h = hits[0]
    assert h['volume_id'] == ROSENBERG
    assert h['page'] == 120
    assert h['page_id'] == 'PA120'
    assert 'In the fall of 1985' in h['snippet']


def test_parse_udm36_title_is_the_book_not_the_page():
    """The card sits in a full SERP; an unanchored title regex swallows the page."""
    html = (FIX / 'udm36_rosenberg_pa120.html').read_text()
    chrome = '<div>Sign in AI Mode All Images Videos News Shopping Books More Tools</div>'
    vol = gbooks.parse_udm36(chrome + html)[0]['volume']
    assert vol['title'].startswith('A Traitor to His Class')
    assert len(vol['title']) < 120
    assert 'Sign in' not in vol['title']


def test_parse_udm36_keeps_each_cards_snippet_with_its_own_volume():
    """A quote hits several books; pairing card 1's snippet with card 2 is a false pin."""
    one = (FIX / 'udm36_rosenberg_pa120.html').read_text()
    two = (one.replace(ROSENBERG, 'OTHERVOLUME1')
              .replace('PA120', 'PA999')
              .replace('In the fall of 1985', 'A WHOLLY DIFFERENT SENTENCE'))
    hits = {h['volume_id']: h for h in gbooks.parse_udm36(one + two)}
    assert set(hits) == {ROSENBERG, 'OTHERVOLUME1'}
    assert hits[ROSENBERG]['page'] == 120
    assert 'In the fall of 1985' in hits[ROSENBERG]['snippet']
    assert hits['OTHERVOLUME1']['page'] == 999
    assert 'In the fall of 1985' not in hits['OTHERVOLUME1']['snippet']


def test_parse_udm36_no_card():
    assert gbooks.parse_udm36('<div>It looks like there aren’t many matches</div>') == []


# --- book_page -------------------------------------------------------------

def _stub(mapping):
    """fetch(url) -> recorded body, by substring match on the url."""
    def fetch(url):
        for key, body in mapping.items():
            if key in url:
                return body
        raise AssertionError(f'stub has no recording for {url}')
    return fetch


def test_book_page_found_via_udm36():
    html = (FIX / 'udm36_rosenberg_pa120.html').read_text()
    r = gbooks.book_page('In the fall of 1985, IIS consisted of three people',
                         volume_id=ROSENBERG, fetch=_stub({'udm=36': html}),
                         routes=('udm36',))
    assert r['page'] == 120
    assert r['volume_id'] == ROSENBERG
    assert r['route'] == 'udm36'
    assert r['reason'] is None


def test_book_page_not_found_returns_none_with_reason():
    r = gbooks.book_page('a phrase that is in no book',
                         volume_id=ROSENBERG,
                         fetch=_stub({'udm=36': '<div>no results</div>'}),
                         routes=('udm36',))
    assert r['page'] is None
    assert r['reason']
    assert 'not found' in r['reason'].lower()


def test_book_page_refuses_a_hit_from_another_volume():
    """Never return a page the endpoint did not report FOR THIS VOLUME."""
    html = (FIX / 'udm36_rosenberg_pa120.html').read_text()
    r = gbooks.book_page('In the fall of 1985',
                         volume_id='SOME_OTHER_VOLUME',
                         fetch=_stub({'udm=36': html}),
                         routes=('udm36',))
    assert r['page'] is None
    assert 'volume' in r['reason'].lower()


def test_book_page_jscmd_route_preferred_and_reported():
    payload = (FIX / 'searchwithin_shape.json').read_text()
    r = gbooks.book_page('In the fall of 1985', volume_id=ROSENBERG,
                         fetch=_stub({'jscmd=SearchWithinVolume': payload}),
                         routes=('jscmd',))
    assert r['page'] == 120
    assert r['route'] == 'jscmd'


def test_book_page_falls_back_when_jscmd_is_blocked():
    html = (FIX / 'udm36_rosenberg_pa120.html').read_text()
    blocked = (FIX / 'sorry_interstitial.html').read_text()
    r = gbooks.book_page('In the fall of 1985', volume_id=ROSENBERG,
                         fetch=_stub({'jscmd=SearchWithinVolume': blocked,
                                      'udm=36': html}),
                         routes=('jscmd', 'udm36'))
    assert r['page'] == 120
    assert r['route'] == 'udm36'


def test_book_page_reports_a_block_as_a_block_not_as_not_found():
    """Google's interstitial has no results in it. Reading that as 'the quote is
    not in the book' is a silent false negative -- the one failure this skill
    exists to refuse."""
    blocked = (FIX / 'blocked_unusual_traffic.html').read_text()
    r = gbooks.book_page('In the fall of 1985', volume_id=ROSENBERG,
                         fetch=_stub({'udm=36': blocked}), routes=('udm36',))
    assert r['page'] is None
    assert 'not found' not in r['reason'].lower()
    assert 'blocked' in r['reason'].lower()


def test_calibrate_will_not_pass_a_book_whose_lookups_were_blocked():
    def blocked(quote, **kw):
        return {'page': None, 'reason': 'blocked by Google (unusual traffic)'}
    out = gbooks.calibrate([{'quote': 'a', 'expected_page': 116},
                            {'quote': 'b', 'expected_page': 134}], finder=blocked)
    assert out['verdict'] == 'blocked'
    assert out['blocked'] == 2


def test_book_page_needs_a_volume():
    with pytest.raises(ValueError):
        gbooks.book_page('anything', fetch=_stub({}), routes=('udm36',))


# --- calibration -----------------------------------------------------------

def _finder(pages):
    """A book_page stand-in: quote -> returned page (None = not found)."""
    def find(quote, **kw):
        return {'page': pages.get(quote), 'page_id': None, 'snippet': '',
                'volume_id': ROSENBERG, 'route': 'stub',
                'reason': None if pages.get(quote) else 'quote not found'}
    return find


def test_calibrate_reproduces():
    pins = [{'quote': 'a', 'expected_page': 116},
            {'quote': 'b', 'expected_page': 134},
            {'quote': 'c', 'expected_page': 177}]
    out = gbooks.calibrate(pins, finder=_finder({'a': 116, 'b': 134, 'c': 177}))
    assert out['verdict'] == 'reproduces'
    assert out['offset'] == 0
    assert all(p['match'] for p in out['pins'])


def test_calibrate_detects_a_consistent_offset():
    pins = [{'quote': 'a', 'expected_page': 116},
            {'quote': 'b', 'expected_page': 134},
            {'quote': 'c', 'expected_page': 177}]
    out = gbooks.calibrate(pins, finder=_finder({'a': 122, 'b': 140, 'c': 183}))
    assert out['verdict'] == 'offset'
    assert out['offset'] == 6
    assert not any(p['match'] for p in out['pins'])
    assert all(p['delta'] == 6 for p in out['pins'])


def test_calibrate_detects_an_inconsistent_book():
    pins = [{'quote': 'a', 'expected_page': 116},
            {'quote': 'b', 'expected_page': 134},
            {'quote': 'c', 'expected_page': 177}]
    out = gbooks.calibrate(pins, finder=_finder({'a': 116, 'b': 140, 'c': 200}))
    assert out['verdict'] == 'inconsistent'
    assert out['offset'] is None


def test_calibrate_compares_a_range_on_its_first_number():
    pins = [{'quote': 'a', 'expected_page': '145--48'}]
    out = gbooks.calibrate(pins, finder=_finder({'a': 145}))
    assert out['pins'][0]['expected_page'] == 145
    assert out['pins'][0]['match'] is True


def test_calibrate_counts_a_page_inside_a_cited_range_as_a_match():
    """`at 145--48` claims support across 145-148; 148 is the pin, not a 3-page miss."""
    pins = [{'quote': 'a', 'expected_page': '145--48'},
            {'quote': 'b', 'expected_page': 116},
            {'quote': 'c', 'expected_page': 147}]
    out = gbooks.calibrate(pins, finder=_finder({'a': 148, 'b': 116, 'c': 147}))
    assert out['pins'][0]['match'] is True
    assert out['pins'][0]['delta'] == 0
    assert out['pins'][0]['expected_range'] == [145, 148]
    assert out['verdict'] == 'reproduces'


def test_calibrate_expands_an_abbreviated_range_end():
    pins = [{'quote': 'a', 'expected_page': '145--48'}]
    assert gbooks.calibrate(pins, finder=_finder({'a': 148}))['pins'][0]['expected_range'] \
        == [145, 148]
    pins = [{'quote': 'a', 'expected_page': '1279--302'}]
    assert gbooks.calibrate(pins, finder=_finder({'a': 1300}))['pins'][0]['expected_range'] \
        == [1279, 1302]


def test_calibrate_still_flags_a_page_outside_the_range():
    pins = [{'quote': 'a', 'expected_page': '145--48'},
            {'quote': 'b', 'expected_page': 116}]
    out = gbooks.calibrate(pins, finder=_finder({'a': 151, 'b': 116}))
    assert out['pins'][0]['match'] is False
    assert out['pins'][0]['delta'] == 3        # distance past the nearest end
    assert out['verdict'] == 'inconsistent'


def test_calibrate_will_not_rule_on_too_few_pins():
    pins = [{'quote': 'a', 'expected_page': 116}]
    out = gbooks.calibrate(pins, finder=_finder({'a': 999}))
    assert out['verdict'] == 'insufficient'


def test_calibrate_reports_misses_without_letting_them_set_the_verdict():
    pins = [{'quote': 'a', 'expected_page': 116},
            {'quote': 'b', 'expected_page': 134},
            {'quote': 'c', 'expected_page': 177}]
    out = gbooks.calibrate(pins, finder=_finder({'a': 116, 'b': 134, 'c': None}))
    assert out['verdict'] == 'reproduces'
    miss = next(p for p in out['pins'] if p['quote'] == 'c')
    assert miss['returned_page'] is None
    assert miss['match'] is False
    assert out['found'] == 2
