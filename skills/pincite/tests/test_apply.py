"""`pincite apply` — the hand-review decisions from the review page, applied.

    cd skills/pincite && python3 -m pytest

Identity is (fn, citekey, occurrence). Every fixture here is built inline: the
manuscript these rules came from is never read.
"""
import json
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'scripts'))
import pincite as P

# fn 1: one site, unique match string -> a clean `set`.
# fn 2: the SAME citekey twice with the SAME trailing punctuation, so the match
#       string occurs twice in the span and no substitution is safe.
# fn 3: a second clean site, used to show keep/skip touch nothing.
FIXTURE = """= Introduction

Proxy advisors matter.#footnote[#emph[See] Hu, #emph[supra] note #ref(<hu2024>).]

Two cites, one work.#footnote[#emph[See] #ref(<kahan2008>). #emph[see also] #ref(<kahan2008>).]

A third claim.#footnote[#emph[See] #ref(<iliev2015>) (using deviations).]
"""


@pytest.fixture
def root(tmp_path):
    body = tmp_path / 'paper/typst/body.typ'
    body.parent.mkdir(parents=True)
    body.write_text(FIXTURE)
    (tmp_path / 'scratch').mkdir()
    P.configure(tmp_path, bio_offset=0)
    return tmp_path


def body_text(root):
    return (root / 'paper/typst/body.typ').read_text()


def classified(root):
    p = root / 'scratch/percite-classified.json'
    return json.loads(p.read_text()) if p.exists() else None


def d(fn, key, action, pin='', occurrence=1, note=''):
    return dict(fn=fn, citekey=key, occurrence=occurrence, action=action,
                pin=pin, note=note)


def test_set_lands_at_the_right_site(root):
    res = P.apply_pincites([d(1, 'hu2024', 'set', 'at 7')], confirm=True)
    assert res['ok'], res['errors']
    assert '#ref(<hu2024>), at 7.' in body_text(root)
    # nothing else moved
    assert body_text(root).count('#footnote[') == FIXTURE.count('#footnote[')
    assert '#ref(<kahan2008>), at' not in body_text(root)


def test_set_accepts_a_bare_page_number(root):
    res = P.apply_pincites([d(3, 'iliev2015', 'set', '447')], confirm=True)
    assert res['ok'], res['errors']
    assert '#ref(<iliev2015>), at 447 (using deviations)' in body_text(root)


def test_ambiguous_match_is_refused_and_nothing_is_written(root):
    before = body_text(root)
    res = P.apply_pincites([d(1, 'hu2024', 'set', 'at 7'),
                            d(2, 'kahan2008', 'set', 'at 1256')], confirm=True)
    assert not res['ok']
    assert any('occurrences' in e or 'occur' in e for e in res['errors']), res['errors']
    # the WHOLE run is refused -- fn 1 was applicable and is still unapplied
    assert body_text(root) == before
    assert classified(root) is None


def test_keep_and_skip_write_no_manuscript_bytes(root):
    before = body_text(root)
    res = P.apply_pincites([d(1, 'hu2024', 'keep', 'at 7'),
                            d(3, 'iliev2015', 'skip', note='no page in hand')],
                           confirm=True)
    assert res['ok'], res['errors']
    assert body_text(root) == before
    rows = classified(root)
    assert {r['citekey'] for r in rows} == {'hu2024', 'iliev2015'}


def test_dry_run_is_the_default_and_writes_nothing(root):
    before = body_text(root)
    res = P.apply_pincites([d(1, 'hu2024', 'set', 'at 7')])
    assert res['ok'], res['errors']
    assert res['dry_run'] is True
    assert body_text(root) == before
    assert classified(root) is None


def test_source_author_lands_in_the_classified_file(root):
    res = P.apply_pincites([d(1, 'hu2024', 'set', 'at 7', note='read it myself')],
                           confirm=True)
    assert res['ok'], res['errors']
    rows = classified(root)
    row = next(r for r in rows if r['citekey'] == 'hu2024')
    assert row['source'] == 'author'
    assert row['verified_page'] == 7
    assert row['decision'] == 'specific'
    assert row['reason'].strip()


def test_model_verified_rows_are_left_alone(root):
    prior = [dict(fn=3, citekey='iliev2015', occurrence=1, decision='specific',
                  reason='model found it', verified_page=447, quote='...',
                  source='model-verified')]
    (root / 'scratch/percite-classified.json').write_text(json.dumps(prior))
    res = P.apply_pincites([d(1, 'hu2024', 'set', 'at 7')], confirm=True)
    assert res['ok'], res['errors']
    rows = classified(root)
    keep = next(r for r in rows if r['citekey'] == 'iliev2015')
    assert keep == prior[0]
    mine = next(r for r in rows if r['citekey'] == 'hu2024')
    assert mine['source'] == 'author'


def test_keep_does_not_overwrite_a_model_rows_provenance(root):
    prior = [dict(fn=3, citekey='iliev2015', occurrence=1, decision='specific',
                  reason='model found it', verified_page=447, quote='...',
                  source='model-verified')]
    (root / 'scratch/percite-classified.json').write_text(json.dumps(prior))
    res = P.apply_pincites([d(3, 'iliev2015', 'keep', note='looks right')],
                           confirm=True)
    assert res['ok'], res['errors']
    row = next(r for r in classified(root) if r['citekey'] == 'iliev2015')
    assert row['source'] == 'model-verified'
    assert row['decision'] == 'specific'
    assert row['reason'] == 'model found it'
    assert row['author_action'] == 'keep'
    assert row['author_note'] == 'looks right'


def test_a_site_that_is_already_pinned_is_refused(root):
    P.apply_pincites([d(1, 'hu2024', 'set', 'at 7')], confirm=True)
    res = P.apply_pincites([d(1, 'hu2024', 'set', 'at 9')], confirm=True)
    assert not res['ok']
    assert any('already' in e for e in res['errors']), res['errors']
    assert '#ref(<hu2024>), at 7.' in body_text(root)


def test_an_unknown_site_is_refused(root):
    before = body_text(root)
    res = P.apply_pincites([d(9, 'nosuch', 'set', 'at 1')], confirm=True)
    assert not res['ok']
    assert body_text(root) == before
