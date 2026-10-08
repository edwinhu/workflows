import json
import classify, common
from schema import SCHEMA

CFG = common.load_config()
ROW = {'filing_id': '0000108601-00-000002', 'bundle_text': 'Class B Common Stock is entitled to ten votes per share. Class A one vote.', 'bundle_chars': 70}
GOOD = {'dual': 'true', 'classes': [{'name': 'Class A', 'votes_per_share': '1', 'shares_outstanding': 5},
                                    {'name': 'Class B', 'votes_per_share': '10', 'shares_outstanding': 2}],
        'evidence_quote': 'Class B Common Stock is entitled to ten votes per share', 'location': 'cover'}


def resp(obj, fr='STOP', camel=False):
    text = json.dumps(obj) if not isinstance(obj, str) else obj
    if camel:
        return {'candidates': [{'content': {'parts': [{'text': 'thinking', 'thought': True}, {'text': text}]}, 'finishReason': fr}],
                'usageMetadata': {'promptTokenCount': 900, 'candidatesTokenCount': 120}}
    return {'candidates': [{'content': {'parts': [{'text': text}]}, 'finish_reason': fr}],
            'usage_metadata': {'prompt_token_count': 900, 'candidates_token_count': 120, 'thoughts_token_count': 7}}


def test_request_shape_has_no_sampling_params_and_carries_id():
    r = classify.build_request(ROW, CFG)
    gc = r['request']['generationConfig']
    assert set(gc) == {'responseMimeType', 'responseSchema'} and gc['responseSchema'] == SCHEMA
    assert r['metadata'] == {'request_id': ROW['filing_id']}
    t = r['request']['contents'][0]['parts'][0]['text']
    assert t.startswith('FILING_ID: 0000108601-00-000002') and ROW['bundle_text'] in t
    assert 'DUAL-CLASS' in r['request']['systemInstruction']['parts'][0]['text']
    json.dumps(r)


def test_model_default_is_cheapest_listed_flash():
    assert CFG['model'] == 'gemini-3.5-flash-lite' and CFG['model'] in CFG['prices_usd_per_mtok']
    p = CFG['prices_usd_per_mtok']
    assert p[CFG['model']]['batch'][0] == min(v['batch'][0] for v in p.values())


def test_result_row_ok_snake_and_camel_and_thoughts_excluded():
    for camel in (False, True):
        r = classify.result_row(ROW, resp(GOOD, camel=camel), 'm', 'flex')
        assert r['status'] == 'ok' and r['parsed']['dual'] == 'true' and r['quote_verified'] is True and r['usage']['prompt_tokens'] == 900


def test_result_row_failures_are_errors_not_empty_success():
    assert classify.result_row(ROW, resp(GOOD, fr='MAX_TOKENS'), 'm', 'flex')['status'] == 'error'
    assert classify.result_row(ROW, resp('{}'), 'm', 'flex')['status'] == 'error'
    assert classify.result_row(ROW, resp(''), 'm', 'flex')['status'] == 'error'
    assert classify.result_row(ROW, {}, 'm', 'flex')['status'] == 'error'
    assert classify.result_row(ROW, None, 'm', 'flex', error='boom')['error'] == 'boom'


def test_fabricated_quote_is_flagged_but_row_kept():
    bad = dict(GOOD, evidence_quote='Class B holders get fifty votes per share')
    r = classify.result_row(ROW, resp(bad), 'm', 'flex')
    assert r['status'] == 'ok' and r['quote_verified'] is False


def line(rid, with_meta=True, status='', response=None):
    req = {'contents': [{'role': 'user', 'parts': [{'text': f'FILING_ID: {rid}\n\nbody'}]}]}
    d = {'request': req, 'response': response if response is not None else resp(GOOD, camel=True), 'status': status}
    if with_meta:
        d['metadata'] = {'request_id': rid}
    return d


def test_batch_join_by_id_survives_shuffle_and_missing_metadata():
    rows = [dict(ROW, filing_id=f'0000000001-99-00000{i}') for i in range(3)]
    lines = [line(rows[2]['filing_id']), line(rows[0]['filing_id'], with_meta=False)]
    out, missing = classify.parse_batch_lines(lines, rows, CFG)
    assert missing == [rows[1]['filing_id']]
    assert [r['filing_id'] for r in out] == sorted(r['filing_id'] for r in rows)
    assert [r['status'] for r in out] == ['ok', 'error', 'ok'] and out[1]['error'] == 'no output row'


def test_batch_duplicate_and_unknown_ids_raise():
    import pytest
    rows = [dict(ROW, filing_id='0000000001-99-000000')]
    with pytest.raises(ValueError):
        classify.parse_batch_lines([line(rows[0]['filing_id']), line(rows[0]['filing_id'])], rows, CFG)
    with pytest.raises(ValueError):
        classify.parse_batch_lines([line('0000000009-99-000009')], rows, CFG)


def test_batch_row_status_error_is_error_row():
    rows = [dict(ROW, filing_id='0000000001-99-000000')]
    out, _ = classify.parse_batch_lines([line(rows[0]['filing_id'], status='{"code":3}')], rows, CFG)
    assert out[0]['status'] == 'error' and 'row status' in out[0]['error']


def test_cost_formula():
    c = common.estimate_cost(1000, 12000, 250, CFG['model'], 'batch', CFG, prompt_chars=4000)
    in_tok = (12000 + 4000 + len(json.dumps(SCHEMA))) / 4
    assert abs(c['usd'] - 1000 * (in_tok * 0.15 + 250 * 1.25) / 1e6) < 1e-9
