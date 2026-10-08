import copy
import pytest
import schema

GOOD = {'dual': 'true',
        'classes': [{'name': 'Class A Common', 'votes_per_share': '1', 'shares_outstanding': 1000},
                    {'name': 'Class B Common', 'votes_per_share': '10', 'shares_outstanding': None}],
        'evidence_quote': 'Class B Common Stock is entitled to ten votes per share', 'location': 'capital_stock_note'}
BUNDLE = 'Note 5. Each share of Class B Common Stock is entitled to ten votes per share, Class A one vote.'


def test_valid_answer_passes_with_and_without_bundle():
    assert schema.validate_output(GOOD) == []
    assert schema.validate_output(GOOD, BUNDLE) == []


@pytest.mark.parametrize('mutate,needle', [
    (lambda o: o.pop('location'), 'missing location'),
    (lambda o: o.update(dual='yes'), 'dual not in'),
    (lambda o: o.update(dual=True), 'dual not in'),
    (lambda o: o.update(location='page 3'), 'location not in'),
    (lambda o: o['classes'][0].update(shares_outstanding='1000'), 'integer or null'),
    (lambda o: o['classes'][0].update(shares_outstanding=True), 'integer or null'),
    (lambda o: o['classes'][0].update(votes_per_share=1), 'must be strings'),
    (lambda o: o['classes'][0].pop('name'), 'missing name'),
    (lambda o: o.update(classes='none'), 'classes not an array'),
    (lambda o: o.update(classes=o['classes'][:1]), 'needs >=2 classes'),
    (lambda o: o.update(evidence_quote='  '), 'needs evidence_quote'),
])
def test_invalid_answers_are_rejected(mutate, needle):
    o = copy.deepcopy(GOOD); mutate(o)
    assert any(needle in p for p in schema.validate_output(o)), schema.validate_output(o)


def test_non_object_rejected():
    assert schema.validate_output([]) == ['not an object']


def test_fabricated_quote_flagged_only_against_bundle():
    o = copy.deepcopy(GOOD); o['evidence_quote'] = 'Class B holders are entitled to fifty votes per share'
    assert schema.validate_output(o) == []
    assert any('verbatim' in p for p in schema.validate_output(o, BUNDLE))


def test_quote_with_ellipsis_fragments_and_punctuation_drift():
    assert schema.quote_in_bundle('Each share of Class B Common Stock ... Class A one vote', BUNDLE)
    assert schema.quote_in_bundle('each share of class b common stock is entitled to TEN votes per share', BUNDLE)
    assert not schema.quote_in_bundle('short', BUNDLE)   # fragment under 15 normalised chars is no evidence


def test_false_and_unclear_need_no_classes():
    for d in ('false', 'unclear'):
        assert schema.validate_output({'dual': d, 'classes': [], 'evidence_quote': '', 'location': 'none'}) == []


def test_schema_declares_the_four_contract_fields():
    assert set(schema.SCHEMA['required']) == {'dual', 'classes', 'evidence_quote', 'location'}
    assert schema.SCHEMA['properties']['dual']['enum'] == ['true', 'false', 'unclear']
    assert set(schema.SCHEMA['properties']['classes']['items']['properties']) == {'name', 'votes_per_share', 'shares_outstanding'}
