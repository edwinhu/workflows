import hashlib
from pathlib import Path
import rule_v3

FROZEN_MD5 = 'f9aa198cede864761403a174ac251349'   # md5 recorded in report_jkl4.md before the validation run


def doc(cover, rest=''):
    return '<DOCUMENT><TYPE>10-K<TEXT>' + cover + ' The registrant is filing this report. ' * 60 + ' Item 1. Business ' + rest


def test_file_is_the_frozen_rule():
    assert hashlib.md5(Path(rule_v3.__file__).read_bytes()).hexdigest() == FROZEN_MD5


def test_two_lettered_classes_positive():
    t = doc('Class A Common Stock outstanding: 1,000,000 shares. Class B Common Stock outstanding: 500,000 shares.')
    r = rule_v3.classify(t)
    assert r['v3_pos'] is True and r['rule'] == 'ge2_tokens' and r['tokens'] == 'Class A,Class B'


def test_single_class_negative():
    r = rule_v3.classify(doc('The registrant had 12,505,990 shares of Common Stock outstanding.'))
    assert r['v3_pos'] is False and r['n_tokens'] == 0


def test_zero_share_class_ignored():
    t = doc('Class A Common Stock outstanding: 1,000,000 shares. Class B Common Stock outstanding: none.')
    r = rule_v3.classify(t)
    assert r['n_tokens'] == 1 and r['v3_pos'] is False


def test_warrants_and_preferred_ignored():
    t = doc('Common Stock outstanding: 3,000,000 shares. Class A Warrants outstanding: 400,000. Series A preferred outstanding: 50,000.')
    assert rule_v3.classify(t)['n_tokens'] == 0


def test_one_token_plus_vote_phrase_positive():
    t = doc('Class A Common Stock outstanding: 2,000,000 shares.', 'Each share of Class B common stock is entitled to ten votes per share.')
    r = rule_v3.classify(t)
    assert r['n_tokens'] == 1 and r['n_hits'] >= 1 and r['v3_pos'] is True and r['rule'] == '1token_vote'


def test_preferred_vote_phrase_not_counted():
    t = doc('Common Stock outstanding: 2,000,000 shares.', 'The preferred stock is entitled to ten votes per share.')
    assert rule_v3.classify(t)['n_hits'] == 0


def test_respectively_counts_assigned_in_order():
    t = doc('Class A Common Stock and Class B Common Stock outstanding: 1,000 and 0, respectively.')
    assert rule_v3.classify(t)['n_tokens'] == 1
