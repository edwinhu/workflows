import json
import pytest
import common, extract
from conftest import FIX

ACC_EX13, ACC_MAIN, ACC_SINGLE = '0000108601-00-000002', '0000013573-03-000007', '0001016504-04-000069'


def bundle(acc):
    return extract.build_bundle((FIX / f'{acc}.txt').read_text(encoding='latin-1'))


def test_ex13_capital_note_is_found_and_is_in_the_bundle():
    b = bundle(ACC_EX13)
    assert b['meta']['n_ex13'] == 1
    assert [(c['doc'], c['heading']) for c in b['sections']['capnotes']] == [('EX-13#0', 'CAPITAL STOCK'), ('EX-13#0', 'COMMON STOCK')]
    assert b['sections']['item5']['found'] is True
    assert 'ten votes per share' in b['bundle_text'].lower()
    assert b['bundle_text'].count('=== ') == 4 and '--- [EX-13#0] CAPITAL STOCK ---' in b['bundle_text']


def test_missing_item5_is_marked_not_skipped():
    b = bundle(ACC_MAIN)
    assert b['sections']['item5']['found'] is False
    assert '[Item 5 not located in the main document]' in b['bundle_text']
    assert [c['heading'] for c in b['sections']['capnotes']] == ["7. STOCKHOLDERS' EQUITY"]


def test_single_class_filing_has_no_capital_note_and_marker():
    b = bundle(ACC_SINGLE)
    assert b['sections']['capnotes'] == []
    assert '[no capital stock / equity note located]' in b['bundle_text']
    assert b['rule_v3']['positive'] is False


def test_section_caps():
    for acc in (ACC_EX13, ACC_MAIN, ACC_SINGLE):
        s = bundle(acc)['sections']
        assert len(s['cover']['text']) <= 8000
        assert len(s['item5']['text'] or '') <= 8000
        assert len(s['capnotes']) <= 3 and all(len(c['text']) <= 6000 for c in s['capnotes'])
        assert sum(len(w['text']) for w in s['windows']) <= 6000


def test_bundle_is_deterministic():
    assert bundle(ACC_EX13) == bundle(ACC_EX13)


def test_cli_local_round_trip_and_row_count_chain(tmp_path):
    lst = tmp_path / 'f.csv'
    lst.write_text('accession,cik\n' + f'{ACC_SINGLE},1016504\n{ACC_EX13},108601\n{ACC_MAIN},13573\n')
    out = tmp_path / 'b.jsonl'
    rc = extract.main(['--filings', str(lst), '--out', str(out), '--source', 'local', '--local-dir', str(FIX)])
    rows = common.read_jsonl(out)
    assert rc == 0 and len(rows) == 3
    assert [r['filing_id'] for r in rows] == sorted([ACC_SINGLE, ACC_EX13, ACC_MAIN])


def test_missing_file_becomes_error_row_and_exit_3(tmp_path):
    lst = tmp_path / 'f.csv'
    lst.write_text(f'accession,cik\n{ACC_SINGLE},1016504\n0000000001-99-000001,1\n')
    out = tmp_path / 'b.jsonl'
    rc = extract.main(['--filings', str(lst), '--out', str(out), '--source', 'local', '--local-dir', str(FIX)])
    rows = common.read_jsonl(out)
    assert rc == 3 and len(rows) == 2
    assert 'error' in rows[0] and 'error' not in rows[1]


def test_duplicate_accession_rejected(tmp_path):
    lst = tmp_path / 'f.csv'
    lst.write_text(f'accession,cik\n{ACC_SINGLE},1\n{ACC_SINGLE},1\n')
    with pytest.raises(ValueError):
        extract.read_filings(lst)


def test_paths_and_ids():
    assert common.wrds_clean_path('/w', 37996, '0000037996-97-000008') == '/w/000003/37996/0000037996-97-000008.txt'
    assert common.wrds_clean_path('/w', '1166691', '0001193125-10-037551') == '/w/000116/1166691/0001193125-10-037551.txt'
    assert common.edgar_path('0000037996', '0000037996-97-000008') == 'edgar/data/37996/0000037996-97-000008.txt'
    assert common.accession_of('edgar/data/1/0000950123-99-002453.txt') == '0000950123-99-002453'
    with pytest.raises(ValueError):
        common.accession_of('nothing')


def test_edgar_refuses_without_user_agent_and_above_ceiling(monkeypatch):
    cfg = common.load_config()
    monkeypatch.delenv('SEC_USER_AGENT', raising=False)
    with pytest.raises(SystemExit):
        extract.run([dict(filing_id='x', accession='x', cik='1')], 'edgar', cfg)
    monkeypatch.setenv('SEC_USER_AGENT', 'T t@example.org')
    with pytest.raises(SystemExit):
        extract.run([dict(filing_id='x', accession='x', cik='1')], 'edgar', dict(cfg, edgar_rate_per_s=9))
