"""No network: GCS prefix uniqueness, collect reading only its own job output, --labels, and the google-genai preflight."""
import json
import pytest
import calibrate, classify, common

CFG = common.load_config()


def rows(n, start=0):
    return [{'filing_id': f'0000000001-99-{i:06d}', 'bundle_text': 'x', 'bundle_chars': 1} for i in range(start, start + n)]


class FakeJob:
    name = 'projects/p/locations/global/batchPredictionJobs/1'
    state = 'PENDING'


class FakeClient:
    def __init__(self, dest_uri=None):
        self.dest_uri = dest_uri
        self.batches = self
        self.created = []

    def create(self, model, src, config):
        self.created.append((src, config['dest']))
        return FakeJob()

    def get(self, name):
        done = type('S', (), {'value': 'JOB_STATE_SUCCEEDED'})()
        d = type('D', (), {'gcs_uri': self.dest_uri})()
        return type('J', (), {'state': done, 'completion_stats': None, 'dest': d})()


def submit(tmp_path, parent, monkeypatch):
    rd = tmp_path / parent / 'hybrid'
    rd.mkdir(parents=True)
    client = FakeClient()
    monkeypatch.setattr(classify, 'gcs', lambda *a, **k: None)
    monkeypatch.setattr(classify, 'make_client', lambda *a, **k: client)
    classify.submit_batch(rows(2), CFG, rd, 'x', cleared={'ok': 1}, check_rows=rows(2))
    return rd, client.created[0], json.loads((rd / 'job.json').read_text())


def test_same_basename_run_dirs_get_different_prefixes_recorded_in_job_json(tmp_path, monkeypatch):
    a, (src_a, dest_a), job_a = submit(tmp_path, 'a', monkeypatch)
    b, (src_b, dest_b), job_b = submit(tmp_path, 'b', monkeypatch)
    assert a.name == b.name == 'hybrid'
    assert src_a != src_b and dest_a != dest_b
    assert job_a['prefix'] != job_b['prefix'] and job_a['prefix'].startswith('hybrid-')
    assert job_a['dest'] == dest_a and job_a['src'] == src_a and job_a['prefix'] in dest_a
    # one dir submitted twice also gets a new folder
    assert classify.run_prefix(a) != classify.run_prefix(a)


def test_collect_reads_only_own_dest_and_ignores_foreign_objects(tmp_path, monkeypatch, capsys):
    rd, (_, dest), job = submit(tmp_path, 'a', monkeypatch)
    own = dest + 'prediction-model-1/predictions.jsonl'
    foreign = CFG['gcs_prefix'] + '/hybrid-deadbeef/output/prediction-model-2/predictions.jsonl'
    line = lambda i: json.dumps({'request_id': f'0000000001-99-{i:06d}', 'response': None, 'status': 'x'})
    store = {own: line(0) + '\n' + line(1) + '\n', foreign: line(99) + '\n'}
    monkeypatch.setattr(classify, 'list_outputs', lambda cfg, d: sorted(store))
    downloaded = []
    def fake_gcs(cfg, op, src, dst):
        downloaded.append(src)
        from pathlib import Path
        Path(dst).write_text(store[src])
    monkeypatch.setattr(classify, 'gcs', fake_gcs)
    monkeypatch.setattr(classify, 'make_client', lambda *a, **k: FakeClient(dest_uri=dest + 'prediction-model-1/'))
    monkeypatch.setattr(classify, 'genai_available', lambda: True)
    (rd / 'output').mkdir(exist_ok=True)
    (rd / 'output' / 'stale.jsonl').write_text(line(77) + '\n')   # a leftover from an earlier download must not be read
    res = classify.collect(rd, CFG, wait=False)
    assert downloaded == [own]
    assert len(res) == 2 and 'ignored 1 listed objects' in capsys.readouterr().out


def test_collect_refuses_job_output_outside_recorded_dest(tmp_path, monkeypatch):
    rd, (_, dest), _ = submit(tmp_path, 'a', monkeypatch)
    monkeypatch.setattr(classify, 'make_client', lambda *a, **k: FakeClient(dest_uri=CFG['gcs_prefix'] + '/other/output/p/'))
    monkeypatch.setattr(classify, 'genai_available', lambda: True)
    with pytest.raises(SystemExit, match='outside the dest recorded'):
        classify.collect(rd, CFG, wait=False)


def test_labels_flag_swaps_label_file_and_changes_fingerprint(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(calibrate, 'LABELS', calibrate.LABELS)   # restored on teardown
    base = calibrate.fingerprint(CFG)
    lab = tmp_path / 'my_labels.csv'
    lab.write_text('filing_id,cik,label,source_set\n0000000001-99-000001,1,dual,t\n0000000001-99-000002,1,single,t\n')
    rd = tmp_path / 'run'; rd.mkdir()
    rc = common.run_config(CFG, 'hybrid')
    common.write_jsonl(rd / 'results.jsonl', [
        {'filing_id': f'0000000001-99-00000{i}', 'status': 'ok', 'quote_verified': True, 'parsed': {'dual': d}, 'backend': 'hybrid', 'run_config': rc}
        for i, d in ((1, 'true'), (2, 'false'))])
    assert calibrate.main(['score', '--run-dir', str(rd), '--labels', str(lab)]) == 0
    out = capsys.readouterr().out
    assert 'labels 2 (unres excluded 0) -> gold 2' in out
    cal = json.loads((rd / 'calibration.json').read_text())
    assert cal['fingerprint']['labels_sha256'] == common.sha256_file(lab) != base['labels_sha256']
    # gate with the same labels sees the fingerprint match on labels; with the default labels it is stale
    assert 'labels_sha256 differs' not in ' '.join(calibrate.evaluate_gate(cal, CFG, calibrate.fingerprint(CFG, 'hybrid'))[1])
    calibrate.set_labels(calibrate.DEFAULT_LABELS)
    assert 'stale: labels_sha256 differs from the calibrated run' in calibrate.evaluate_gate(cal, CFG, calibrate.fingerprint(CFG, 'hybrid'))[1]
    with pytest.raises(SystemExit, match='no such file'):
        calibrate.main(['gate', '--runs-dir', str(tmp_path), '--labels', str(tmp_path / 'nope.csv')])
    calibrate.set_labels(calibrate.DEFAULT_LABELS)


def test_default_labels_unchanged():
    assert calibrate.LABELS == calibrate.DEFAULT_LABELS == common.PKG / 'fixtures' / 'labels.csv'
    assert len(calibrate.load_labels()) == 270


@pytest.mark.parametrize('backend', ['hybrid', 'gemini'])
def test_missing_genai_exits_before_any_jev_or_gcs_call(tmp_path, monkeypatch, backend):
    def boom(*a, **k): raise AssertionError('paid/network call made')
    monkeypatch.setattr(classify.jev, 'run', boom)
    monkeypatch.setattr(classify, 'gcs', boom); monkeypatch.setattr(classify, 'make_client', boom)
    monkeypatch.setattr(classify, 'genai_available', lambda: False)
    ids = [r['filing_id'] for r in calibrate.load_labels()]
    bundles = [{'filing_id': i, 'bundle_text': 'x', 'bundle_chars': 1} for i in ids]
    with pytest.raises(SystemExit) as e:
        classify.run_backend(bundles, CFG, tmp_path / 'r', backend, 'batch', max_spend=1.0, calibrating=True)
    assert 'uv run --with google-genai' in str(e.value) and e.value.code != 0


def test_jev_backend_does_not_need_genai(monkeypatch):
    monkeypatch.setattr(classify, 'genai_available', lambda: False)
    classify.require_genai('jev')
