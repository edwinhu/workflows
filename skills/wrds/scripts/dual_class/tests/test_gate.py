import json
import pytest
import calibrate, common

CFG = common.load_config()
FP = calibrate.fingerprint(CFG)


def cal(prec=0.95, rec=0.93, n=263, fp=None, scored_at='2026-10-08T00:00:00Z'):
    return {'fingerprint': dict(fp or FP), 'model_metrics': {'n': n, 'precision': prec, 'recall': rec}, 'scored_at': scored_at}


def test_wilson_known_values():
    lo, hi = calibrate.wilson(9, 10)
    assert (lo, hi) == (0.5958, 0.9821)
    assert calibrate.wilson(0, 0) == (None, None)
    lo, hi = calibrate.wilson(0, 10)
    assert lo == 0.0 and hi == 0.2775


def test_kappa_perfect_chance_and_degenerate():
    assert calibrate.kappa(5, 0, 0, 5) == 1.0
    assert calibrate.kappa(5, 5, 5, 5) == 0.0
    assert calibrate.kappa(10, 0, 0, 0) is None   # expected agreement 1


def test_metrics_counts():
    pairs = [(True, True)] * 8 + [(True, False)] * 2 + [(False, True)] * 1 + [(False, False)] * 9
    m = calibrate.metrics(pairs)
    assert (m['tp'], m['fp'], m['fn'], m['tn'], m['n']) == (8, 1, 2, 9, 20)
    assert m['precision'] == pytest.approx(8 / 9) and m['recall'] == pytest.approx(0.8)
    assert m['kappa'] == pytest.approx(0.7)
    assert metrics_deterministic(pairs)


def metrics_deterministic(pairs):
    return calibrate.metrics(pairs) == calibrate.metrics(pairs)


@pytest.mark.parametrize('c,ok', [
    (cal(), True), (cal(prec=0.9, rec=0.9), True), (cal(prec=0.8999), False), (cal(rec=0.89), False),
    (cal(n=99), False), (cal(prec=None), False), (None, False),
])
def test_evaluate_gate_thresholds(c, ok):
    assert calibrate.evaluate_gate(c, CFG, FP)[0] is ok


@pytest.mark.parametrize('field', ['model', 'prompt_sha256', 'schema_sha256', 'labels_sha256'])
def test_stale_calibration_closes_gate(field):
    c = cal(fp=dict(FP, **{field: 'other'}))
    ok, why = calibrate.evaluate_gate(c, CFG, FP)
    assert not ok and any(field in w for w in why)


def write(d, name, c):
    (d / name).mkdir(); (d / name / 'calibration.json').write_text(json.dumps(c))


def test_latest_calibration_is_by_scored_at_not_name(tmp_path):
    write(tmp_path, 'zzz_old', cal(scored_at='2026-10-01T00:00:00Z'))
    write(tmp_path, 'aaa_new', cal(prec=0.5, scored_at='2026-10-09T00:00:00Z'))
    assert calibrate.latest_calibration(tmp_path)['model_metrics']['precision'] == 0.5
    with pytest.raises(SystemExit) as e:          # newest one fails thresholds, an older pass does not rescue it
        calibrate.require_gate(tmp_path, CFG)
    assert e.value.code == 4


def test_require_gate_open_returns_calibration(tmp_path):
    write(tmp_path, 'cal1', cal())
    assert calibrate.require_gate(tmp_path, CFG)['model_metrics']['n'] == 263


def test_gate_closed_without_any_calibration(tmp_path):
    with pytest.raises(SystemExit) as e:
        calibrate.require_gate(tmp_path, CFG)
    assert e.value.code == 4


def test_batch_refused_before_any_network_when_gate_closed(tmp_path, monkeypatch):
    import classify
    def boom(*a, **k): raise AssertionError('network/gcs touched')
    monkeypatch.setattr(classify, 'gcs', boom); monkeypatch.setattr(classify, 'make_client', boom)
    rows = [{'filing_id': f'0000000001-99-{i:06d}', 'bundle_text': 'x', 'bundle_chars': 1} for i in range(11)]
    with pytest.raises(SystemExit) as e:
        classify.submit_batch(rows, CFG, tmp_path / 'run', 'x', runs_dir=tmp_path)
    assert e.value.code == 4


def test_calibrating_only_accepts_fixture_filings():
    labels = calibrate.load_labels()
    ids = [r['filing_id'] for r in labels]
    calibrate.require_fixture_subset(ids, CFG)
    with pytest.raises(SystemExit):
        calibrate.require_fixture_subset(ids[:150] + ['0000000001-99-000001'], CFG)
    with pytest.raises(SystemExit):
        calibrate.require_fixture_subset(ids[:20], CFG)


def test_flex_refuses_more_than_ten_rows():
    import classify
    with pytest.raises(SystemExit):
        classify.run_flex([{}] * 11, CFG, '/nonexistent/x')


def results(labels, dual_for):
    return [{'filing_id': r['filing_id'], 'status': 'ok', 'quote_verified': True, 'parsed': {'dual': dual_for(r)}} for r in labels]


def test_score_perfect_and_audit():
    labels = calibrate.load_labels()
    s = calibrate.score(labels, results(labels, lambda r: 'true' if r['label'] == 'dual' else 'false'))
    m = s['model']
    assert s['audit']['n_labels'] == 270 and s['audit']['n_unres_excluded'] == 7 and s['audit']['n_gold'] == 263
    assert s['audit']['matched'] == 263 and s['audit']['match_rate'] == 1.0
    assert (m['precision'], m['recall'], m['kappa']) == (1.0, 1.0, 1.0)
    assert calibrate.evaluate_gate({'fingerprint': FP, 'model_metrics': m}, CFG, FP)[0]


def test_abstaining_cannot_open_gate():
    labels = calibrate.load_labels()
    s = calibrate.score(labels, results(labels, lambda r: 'unclear'))
    assert s['n_unclear'] == 263 and s['model']['recall'] == 0.0 and s['model']['precision'] is None
    assert not calibrate.evaluate_gate({'fingerprint': FP, 'model_metrics': s['model']}, CFG, FP)[0]


def test_missing_and_error_rows_count_as_negative():
    labels = calibrate.load_labels()
    res = results(labels, lambda r: 'true' if r['label'] == 'dual' else 'false')[:200]
    res[0] = dict(res[0], status='error', parsed=None)
    s = calibrate.score(labels, res)
    assert s['audit']['matched'] < 263 and s['n_failed_or_missing'] >= 64 and s['model']['n'] == 263


def test_fixture_labels_file():
    labels = calibrate.load_labels()
    assert len(labels) == 270 and len({r['filing_id'] for r in labels}) == 270
    assert {r['label'] for r in labels} == {'dual', 'single', 'unres'}
    assert {r['source_set'] for r in labels} == {'jkl2', 'jkl3', 'jkl4'}


def test_score_command_writes_calibration_that_opens_the_gate(tmp_path, capsys):
    labels = calibrate.load_labels()
    rd = tmp_path / 'cal1'; rd.mkdir()
    common.write_jsonl(rd / 'results.jsonl', results(labels, lambda r: 'true' if r['label'] == 'dual' else 'false'))
    assert calibrate.cmd_score(rd, CFG) == 0
    out = capsys.readouterr().out
    assert 'matched 263 (100.0%)' in out and 'GATE OPEN' in out
    cal_ = json.loads((rd / 'calibration.json').read_text())
    assert cal_['fingerprint'] == FP and cal_['model_metrics']['precision'] == 1.0
    assert calibrate.require_gate(tmp_path, CFG)['_path'].endswith('cal1/calibration.json')
    assert calibrate.main(['gate', '--runs-dir', str(tmp_path)]) == 0
    (tmp_path / 'empty').mkdir()
    assert calibrate.main(['gate', '--runs-dir', str(tmp_path / 'empty')]) == 4
