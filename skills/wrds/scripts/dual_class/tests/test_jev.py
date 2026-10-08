import json
import pytest
import calibrate, classify, common, jev

CFG = common.load_config()
TOKEN = 'sk-or-SECRET-TOKEN-xyz'


def rows(n, prefix='0000000001-99-'):
    return [{'filing_id': f'{prefix}{i:06d}', 'bundle_text': f'bundle {i}', 'bundle_chars': 8} for i in range(n)]


class FakeNet:
    """Stands in for jev._http. P(yes) comes from `p_for(state)`; every call costs `cost`."""
    def __init__(self, p_for=lambda st: 0.9, cost=0.0002, remaining=16.0, script=None):
        self.p_for, self.cost, self.remaining, self.script, self.calls, self.seen_auth = p_for, cost, remaining, list(script or []), 0, set()

    def __call__(self, url, key, payload=None, timeout=60):
        self.seen_auth.add(key)
        if url == jev.CREDITS_URL:
            return 200, json.dumps({'data': {'total_credits': self.remaining + 1.0, 'total_usage': 1.0}})
        self.calls += 1
        if self.script:
            st = self.script.pop(0)
            if st != 200:
                return st, 'insufficient credits' if st == 402 else 'busy'
        req = json.loads(payload)
        assert req['model'] == 'typesafe/jev-1.13' and req['questions'] == {'dual': {'type': 'noul', 'instructions': jev.QUESTION}}
        return 200, json.dumps({'answers': {'dual': {'type': 'noul', 'noul': self.p_for(req['state'])}},
                                'usage': {'input_tokens': 100, 'output_tokens': 5, 'cost': self.cost}})


@pytest.fixture
def net(monkeypatch):
    n = FakeNet(); monkeypatch.setattr(jev, '_http', n); monkeypatch.setenv('WORK_HOLD_JUDGE_TOKEN', TOKEN)
    monkeypatch.setattr(jev.time, 'sleep', lambda s: None)
    return n


def test_question_text_is_the_calibrated_one():
    assert jev.QUESTION.startswith('At fiscal year end the registrant had two or more classes of common equity outstanding')
    assert jev.QUESTION_SHA256 == '07fa9cce8482382ca335247d17efdadb54eae19c55fa903b11a7e558264c5c01'   # editing the question text closes the Jev/hybrid gates; update this pin with the recalibration


def test_label_threshold_and_row_shape(net, tmp_path):
    out, spent, rem = jev.run(rows(4), CFG, tmp_path / 'j.jsonl', 1.0, call_fn=None)
    assert [r['filing_id'] for r in out] == sorted(r['filing_id'] for r in out) and len(out) == 4
    r = out[0]
    assert r['status'] == 'ok' and r['parsed']['dual'] == 'true' and r['p_yes'] == 0.9 and r['backend_used'] == 'jev'
    assert r['quote_verified'] is None and r['usage']['cost_usd'] == 0.0002 and rem == pytest.approx(16.0)
    assert spent == pytest.approx(0.0008)
    net.p_for = lambda st: 0.5
    out2 = jev.run(rows(1, 'x'), CFG, tmp_path / 'k.jsonl', 1.0)[0]
    assert out2[0]['parsed']['dual'] == 'true'            # P >= threshold
    net.p_for = lambda st: 0.4999
    assert jev.run(rows(1, 'y'), CFG, tmp_path / 'l.jsonl', 1.0)[0][0]['parsed']['dual'] == 'false'


def test_key_is_never_printed_or_written(net, tmp_path, capsys):
    jev.run(rows(3), CFG, tmp_path / 'j.jsonl', 1.0)
    cap = capsys.readouterr()
    assert TOKEN not in cap.out + cap.err and TOKEN not in (tmp_path / 'j.jsonl').read_text()
    assert net.seen_auth == {TOKEN}


def test_key_falls_back_to_agenix_file(monkeypatch, tmp_path):
    monkeypatch.delenv('WORK_HOLD_JUDGE_TOKEN', raising=False); monkeypatch.setenv('XDG_RUNTIME_DIR', str(tmp_path))
    (tmp_path / 'agenix').mkdir(); (tmp_path / 'agenix' / 'openrouter-api-key').write_text(TOKEN + '\n')
    assert jev.api_key() == TOKEN


def test_max_spend_is_required(net, tmp_path):
    for bad in (None, 0, -1):
        with pytest.raises(SystemExit):
            jev.run(rows(1), CFG, tmp_path / 'j.jsonl', bad)
    assert net.calls == 0
    with pytest.raises(SystemExit):
        classify.run_backend(rows(1), CFG, tmp_path / 'r', 'jev', 'flex')


def test_abort_floor_blocks_every_call(net, tmp_path):
    net.remaining = 9.99
    with pytest.raises(SystemExit) as e:
        jev.run(rows(3), CFG, tmp_path / 'j.jsonl', 1.0)
    assert 'abort floor' in str(e.value) and net.calls == 0
    net.remaining = 3.0                                   # a configurable floor
    assert len(jev.run(rows(3), CFG, tmp_path / 'j.jsonl', 1.0, abort_floor=2.0)[0]) == 3


def test_spend_cap_stops_the_run_loudly(net, tmp_path):
    net.cost = 0.01
    with pytest.raises(RuntimeError) as e:
        jev.run(rows(40), CFG, tmp_path / 'j.jsonl', 0.05)
    assert 'not scored' in str(e.value)
    saved = common.read_jsonl(tmp_path / 'j.jsonl')
    assert 0 < len(saved) < 40 and sum(r['usage']['cost_usd'] for r in saved) <= 0.05 + 8 * 0.01 + 1e-9   # at most one in-flight batch of overshoot


def test_402_stops_and_is_not_retried(net, tmp_path):
    net.script = [402] * 50
    with pytest.raises(RuntimeError) as e:
        jev.run(rows(10), CFG, tmp_path / 'j.jsonl', 1.0)
    assert 'OUT OF CREDITS' in str(e.value) and net.calls <= 8      # one call per worker at most, none retried


def test_429_and_5xx_are_retried(net, tmp_path):
    net.script = [429, 503, 200]
    out = jev.run(rows(1), CFG, tmp_path / 'j.jsonl', 1.0)[0]
    assert len(out) == 1 and net.calls == 3
    net.script = [500] * 6
    with pytest.raises(RuntimeError):
        jev.run(rows(1, 'z'), CFG, tmp_path / 'k.jsonl', 1.0)


def test_rerun_is_idempotent_and_does_not_respend(net, tmp_path):
    p = tmp_path / 'j.jsonl'
    a = jev.run(rows(5), CFG, p, 1.0)[0]; first = net.calls
    b, spent, _ = jev.run(rows(5), CFG, p, 1.0)
    assert net.calls == first and spent == 0 and a == b
    assert [json.loads(l)['filing_id'] for l in p.read_text().splitlines()] == [r['filing_id'] for r in a]


# ---- hybrid / backend orchestration -------------------------------------------------------------------------------

def gem_row(fid, dual='true'):
    return {'filing_id': fid, 'model': 'gemini-3.8-flash', 'tier': 'flex', 'status': 'ok', 'error': None, 'finish_reason': 'STOP',
            'usage': {'prompt_tokens': 5000, 'output_tokens': 100, 'thoughts_tokens': 4}, 'raw_text': '{}', 'problems': [],
            'quote_verified': True, 'p_yes': None, 'backend_used': 'gemini',
            'parsed': {'dual': dual, 'classes': [], 'evidence_quote': 'x', 'location': 'cover'}}


def jrow(fid, p):
    return jev.result_row({'filing_id': fid}, {'answers': {'dual': {'noul': p}}, 'usage': {'cost': 0.0002}}, CFG['jev'])


def test_band_edges_lo_inclusive_hi_exclusive():
    assert [classify.in_band(p, CFG) for p in (0.19, 0.2, 0.5, 0.7999, 0.8, 0.95)] == [False, True, True, True, False, False]


def test_merge_hybrid_label_source_by_band():
    ps = [0.05, 0.2, 0.5, 0.8, 0.97]
    jr = [jrow(f'0000000001-99-00000{i}', p) for i, p in enumerate(ps)]
    gem = [gem_row(jr[1]['filing_id'], 'false'), gem_row(jr[2]['filing_id'], 'unclear')]
    out = classify.merge_hybrid(jr, gem, CFG)
    assert [r['backend_used'] for r in out] == ['jev', 'gemini', 'gemini', 'jev', 'jev']
    assert [r['parsed']['dual'] for r in out] == ['false', 'false', 'unclear', 'true', 'true']   # Gemini overrides Jev inside the band
    assert [r['p_yes'] for r in out] == ps and out[1]['jev_usage']['cost_usd'] == 0.0002
    with pytest.raises(ValueError):                         # a band row without a Gemini row is never papered over
        classify.merge_hybrid(jr, gem[:1], CFG)
    with pytest.raises(ValueError):
        classify.merge_hybrid(jr, gem + [gem_row(jr[0]['filing_id'])], CFG)


def test_hybrid_flex_sends_only_band_rows_to_gemini(net, tmp_path, monkeypatch):
    net.p_for = lambda st: {'bundle 0': 0.9, 'bundle 1': 0.5, 'bundle 2': 0.1, 'bundle 3': 0.79}[st]
    sent = []
    def fake_flex(rs, g, path):
        sent.extend(r['filing_id'] for r in rs); assert g['model'] == 'gemini-3.8-flash' and g['thinking_level'] == 'LOW'
        return [gem_row(r['filing_id'], 'false') for r in rs]
    monkeypatch.setattr(classify, 'run_flex', fake_flex)
    rs = rows(4)
    res = classify.run_backend(rs, CFG, tmp_path / 'h', 'hybrid', 'flex', max_spend=1.0)
    assert sent == [rs[1]['filing_id'], rs[3]['filing_id']]
    assert [(r['backend_used'], r['parsed']['dual']) for r in res] == [('jev', 'true'), ('gemini', 'false'), ('jev', 'false'), ('gemini', 'false')]
    saved = common.read_jsonl(tmp_path / 'h' / 'results.jsonl')
    assert all(r['backend'] == 'hybrid' and r['run_config'] == common.run_config(CFG, 'hybrid') for r in saved)


def test_hybrid_empty_band_needs_no_gemini(net, tmp_path, monkeypatch):
    monkeypatch.setattr(classify, 'run_flex', lambda *a: pytest.fail('gemini called'))
    res = classify.run_backend(rows(3), CFG, tmp_path / 'h', 'hybrid', 'flex', max_spend=1.0)
    assert {r['backend_used'] for r in res} == {'jev'}


def test_hybrid_batch_submits_band_rows_only_with_job_metadata(net, tmp_path, monkeypatch):
    net.p_for = lambda st: 0.5 if st in ('bundle 1', 'bundle 12') else 0.95
    seen = {}
    monkeypatch.setattr(classify, 'gcs', lambda *a, **k: None)
    class Job: name = 'jobs/1'; state = 'JOB_STATE_PENDING'
    class Client:
        class batches:
            @staticmethod
            def create(model, src, config): seen['model'] = model; return Job()
    monkeypatch.setattr(classify, 'make_client', lambda g, flex=False: Client)
    labels = calibrate.load_labels()
    rs = [{'filing_id': r['filing_id'], 'bundle_text': f'bundle {i}', 'bundle_chars': 8} for i, r in enumerate(labels)]
    classify.run_backend(rs, CFG, tmp_path / 'h', 'hybrid', 'batch', max_spend=1.0, calibrating=True)
    job = json.loads((tmp_path / 'h' / 'job.json').read_text())
    assert job['backend'] == 'hybrid' and job['n'] == 2 and job['bundles_file'] == 'band_bundles.jsonl'
    assert job['model'] == 'gemini-3.8-flash' and seen['model'] == 'publishers/google/models/gemini-3.8-flash'
    assert len(common.read_jsonl(tmp_path / 'h' / 'band_bundles.jsonl')) == 2 and net.calls == 270
    req = common.read_jsonl(tmp_path / 'h' / 'requests.jsonl')
    assert req[0]['request']['generationConfig']['thinkingConfig'] == {'thinkingLevel': 'LOW'} and 'request_id' in req[0]


def test_gate_closed_stops_jev_and_hybrid_before_any_spend(net, tmp_path):
    for b in ('jev', 'hybrid'):
        with pytest.raises(SystemExit) as e:
            classify.run_backend(rows(11), CFG, tmp_path / b, b, 'batch', max_spend=1.0, runs_dir=tmp_path)
        assert e.value.code == 4
    assert net.calls == 0 and net.seen_auth == set()


def test_calibrating_rejects_non_fixture_filings_before_spend(net, tmp_path):
    with pytest.raises(SystemExit):
        classify.run_backend(rows(150), CFG, tmp_path / 'j', 'jev', 'batch', max_spend=1.0, calibrating=True)
    assert net.calls == 0


def test_jev_backend_batch_gated_then_open(net, tmp_path):
    runs = tmp_path / 'runs'; (runs / 'cal').mkdir(parents=True)
    fp = calibrate.fingerprint(CFG, 'jev')
    (runs / 'cal' / 'calibration.json').write_text(json.dumps({'fingerprint': fp, 'scored_at': '2026-10-08T00:00:00Z',
                                                              'model_metrics': {'n': 263, 'precision': 0.93, 'recall': 0.99}}))
    res = classify.run_backend(rows(12), CFG, runs / 'full', 'jev', 'batch', max_spend=1.0, runs_dir=runs)
    assert len(res) == 12 and (runs / 'full' / 'calibration_used.json').exists()
    assert len(common.read_jsonl(runs / 'full' / 'results.jsonl')) == 12


def test_cost_estimates_per_backend(capsys, tmp_path):
    b = tmp_path / 'b.jsonl'; common.write_jsonl(b, [dict(r, bundle_chars=14000) for r in rows(100)])
    for backend in ('jev', 'gemini', 'hybrid'):
        classify.cost_cmd(b, CFG, 250, backend)
    out = capsys.readouterr().out
    assert out.count('jev       n=100') == 2 and 'hybrid total' in out and 'gemini-3.5-flash-lite batch' in out and 'gemini-3.8-flash batch' in out
