#!/usr/bin/env python3
"""classify.py: one proposition per filing ("dual-class common outstanding?") with Gemini on Vertex (ADC + GCS, never AI Studio).

  dry-run  bundles -> requests.jsonl + token/cost estimate. No network, free.
  flex     <=10 rows, one synchronous Cloud Flex PayGo call per row (refuses >10).
  batch    >10 rows, GCS JSONL in/out. GATED: refused unless the latest calibration run (calibrate.py score) has precision
           and recall >= config gate on fixtures/labels.csv, for this model + prompt + schema + label file.
           `--calibrating` (calibrate.py only) bypasses the gate, and only for filings that are in the fixtures.
  collect  wait for a batch job, download its output prefix, reconcile ids, write results.jsonl.
  cost     estimate from a bundles file.

A run directory holds bundles.jsonl (input), requests.jsonl, job.json (batch), output/, results.jsonl, and
calibration.json (calibration runs) or calibration_used.json (the calibration a gated run was released on).
Retry policy: Flex capacity errors (429/503) back off 4 tries; a 400 (e.g. recitation refusal) is recorded as an error row
and the loop continues. Every row is appended to results.jsonl as soon as it returns.
"""
import argparse, json, os, re, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from schema import SCHEMA, validate_output

TERMINAL = {'JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED', 'JOB_STATE_PARTIALLY_SUCCEEDED'}
ID_RE = re.compile(r'^FILING_ID: (\S+)', re.M)


def user_text(row):
    return f"FILING_ID: {row['filing_id']}\n\n{row['bundle_text']}"


def build_request(row, cfg):
    """Cloud GenerateContentRequest wire shape (camelCase). Gemini 3: no temperature/top_p/top_k."""
    gc = {'responseMimeType': 'application/json', 'responseSchema': SCHEMA}
    if cfg.get('thinking_level'):
        gc['thinkingConfig'] = {'thinkingLevel': cfg['thinking_level']}
    return {'request': {'systemInstruction': {'parts': [{'text': common.prompt_text()}]},
                        'contents': [{'role': 'user', 'parts': [{'text': user_text(row)}]}],
                        'generationConfig': gc},
            'metadata': {'request_id': row['filing_id']}}


def answer_from_response(resp):
    """(finish_reason, text, usage) from an SDK-dumped (snake_case) or raw batch (camelCase) response dict."""
    cands = resp.get('candidates') or []
    c = cands[0] if cands else {}
    fr = c.get('finish_reason') or c.get('finishReason')
    parts = (c.get('content') or {}).get('parts') or []
    text = ''.join(p.get('text', '') for p in parts if isinstance(p.get('text'), str) and not p.get('thought'))
    u = resp.get('usage_metadata') or resp.get('usageMetadata') or {}
    usage = dict(prompt_tokens=u.get('prompt_token_count', u.get('promptTokenCount')),
                 output_tokens=u.get('candidates_token_count', u.get('candidatesTokenCount')),
                 thoughts_tokens=u.get('thoughts_token_count', u.get('thoughtsTokenCount')),
                 traffic_type=u.get('traffic_type', u.get('trafficType')))
    return (str(fr).split('.')[-1] if fr is not None else None), text, usage


def result_row(row, resp, model, tier, error=None):
    out = dict(filing_id=row['filing_id'], model=model, tier=tier, status='error', error=error, finish_reason=None,
               usage=None, raw_text=None, parsed=None, problems=[], quote_verified=None)
    if error or resp is None:
        out['error'] = error or 'no response'; return out
    fr, text, usage = answer_from_response(resp)
    out.update(finish_reason=fr, usage=usage, raw_text=text)
    if fr != 'STOP':
        out['error'] = f'finish_reason={fr}'; return out
    try:
        obj = json.loads(text)
    except ValueError as e:
        out['error'] = f'json: {e}'; return out
    probs = validate_output(obj, row['bundle_text'])
    out['parsed'] = obj
    out['problems'] = probs
    out['quote_verified'] = not any('verbatim' in p for p in probs)
    out['status'] = 'ok' if not [p for p in probs if 'verbatim' not in p] else 'error'
    if out['status'] == 'error':
        out['error'] = 'schema: ' + '; '.join(probs)
    return out


def load_bundles(path, limit=None):
    rows = [r for r in common.read_jsonl(path)]
    bad = [r['filing_id'] for r in rows if 'error' in r]
    if bad:
        print(f'WARNING: {len(bad)} bundle rows carry extraction errors and are skipped: {bad[:5]}', file=sys.stderr)
    rows = sorted((r for r in rows if 'error' not in r), key=lambda r: r['filing_id'])
    return rows[:limit] if limit else rows


def make_client(cfg, flex=False):
    for v in ('GOOGLE_API_KEY', 'GEMINI_API_KEY'):
        os.environ.pop(v, None)   # Iron law: Vertex + ADC, never an API key
    from google import genai
    from google.genai import types
    import google.auth
    cr, _ = google.auth.default(quota_project_id=cfg['project'])
    kw = {}
    if flex:
        kw['http_options'] = types.HttpOptions(api_version='v1', timeout=900000,
                                               headers={'X-Vertex-AI-LLM-Shared-Request-Type': 'flex'})
    return genai.Client(vertexai=True, project=cfg['project'], location=cfg['location'], credentials=cr, **kw)


def run_flex(rows, cfg, out_path):
    if len(rows) > cfg['flex_max_rows']:
        raise SystemExit(f"flex is for <= {cfg['flex_max_rows']} rows (got {len(rows)}); use batch")
    from google.genai import types
    client = make_client(cfg, flex=True)
    results = []
    open(out_path, 'w').close()
    for row in rows:
        req = build_request(row, cfg)['request']
        gc = req['generationConfig']
        tc = types.ThinkingConfig(thinking_level=gc['thinkingConfig']['thinkingLevel']) if 'thinkingConfig' in gc else None
        conf = types.GenerateContentConfig(system_instruction=req['systemInstruction']['parts'][0]['text'],
                                           response_mime_type=gc['responseMimeType'], response_schema=SCHEMA,
                                           thinking_config=tc)
        res = None
        for a in range(4):
            try:
                r = client.models.generate_content(model=cfg['model'], contents=req['contents'][0]['parts'][0]['text'], config=conf)
                res = result_row(row, r.model_dump(mode='json', exclude_none=True), cfg['model'], 'flex')
                break
            except Exception as e:
                code = getattr(e, 'code', None)
                if code in (429, 503) and a < 3:
                    time.sleep(10 * 2 ** a); continue
                res = result_row(row, None, cfg['model'], 'flex', error=f'{type(e).__name__}: {e}'[:500])
                break
        results.append(res)
        with open(out_path, 'a') as f:
            f.write(json.dumps(res, sort_keys=True) + '\n')
    return results


def gcs(cfg, *a):
    subprocess.run(['gcloud', 'storage', *a, '--project', cfg['project']], check=True)


def submit_batch(rows, cfg, run_dir, display, calibrating=False, runs_dir=None):
    import calibrate
    run_dir = Path(run_dir)
    if calibrating:
        calibrate.require_fixture_subset([r['filing_id'] for r in rows], cfg)
        used = None
    else:
        used = calibrate.require_gate(runs_dir or run_dir.parent, cfg)   # SystemExit(4) when closed
    common.write_jsonl(run_dir / 'bundles.jsonl', rows)   # collect() reconciles against exactly what was submitted
    reqs = [build_request(r, cfg) for r in rows]
    rp = run_dir / 'requests.jsonl'
    common.write_jsonl(rp, reqs)
    src = f"{cfg['gcs_prefix']}/{run_dir.name}/requests.jsonl"
    dest = f"{cfg['gcs_prefix']}/{run_dir.name}/output/"
    gcs(cfg, 'cp', str(rp), src)
    client = make_client(cfg)
    job = client.batches.create(model='publishers/google/models/' + cfg['model'], src=src,
                                config={'display_name': display, 'dest': dest})
    (run_dir / 'job.json').write_text(json.dumps(dict(name=job.name, display=display, src=src, dest=dest, n=len(rows),
                                                      model=cfg['model']), indent=1, sort_keys=True))
    if used is not None:
        (run_dir / 'calibration_used.json').write_text(json.dumps(used, indent=1, sort_keys=True))
    print('submitted', job.name, job.state)
    return job.name


def request_id_of(line):
    """Join key of a batch output line: metadata.request_id if echoed, else FILING_ID in the echoed request text."""
    ids = set()
    md = line.get('metadata') or {}
    if md.get('request_id'):
        ids.add(md['request_id'])
    try:
        t = line['request']['contents'][0]['parts'][0]['text']
        m = ID_RE.search(t)
        if m:
            ids.add(m.group(1))
    except (KeyError, IndexError, TypeError):
        pass
    if len(ids) != 1:
        raise ValueError(f'cannot determine a single request id from {sorted(ids)}')
    return ids.pop()


def parse_batch_lines(lines, rows, cfg):
    by = {r['filing_id']: r for r in rows}
    seen = {}
    for ln in lines:
        rid = request_id_of(ln)
        if rid in seen:
            raise ValueError(f'duplicate output for {rid}')
        if rid not in by:
            raise ValueError(f'output id {rid} not in bundles')
        seen[rid] = result_row(by[rid], None if ln.get('status') else ln.get('response'), cfg['model'], 'batch',
                               error=(f"row status: {ln['status']}"[:500] if ln.get('status') else None))
    missing = sorted(set(by) - set(seen))
    for m in missing:
        seen[m] = result_row(by[m], None, cfg['model'], 'batch', error='no output row')
    return [seen[k] for k in sorted(seen)], missing


def collect(run_dir, cfg, wait=True):
    run_dir = Path(run_dir)
    job = json.loads((run_dir / 'job.json').read_text())
    client = make_client(cfg)
    while True:
        j = client.batches.get(name=job['name'])
        print(time.strftime('%H:%M:%S'), j.state.value, j.completion_stats, flush=True)
        if j.state.value in TERMINAL or not wait:
            break
        time.sleep(60)
    if j.state.value not in TERMINAL:
        raise SystemExit(f'job not finished: {j.state.value}')
    out = run_dir / 'output'
    out.mkdir(exist_ok=True)
    gcs(cfg, 'cp', '-r', j.dest.gcs_uri.rstrip('/') + '/*', str(out))
    lines = []
    for f in sorted(out.rglob('*.jsonl')):
        lines += [json.loads(l) for l in f.read_text().splitlines() if l.strip()]
    rows = load_bundles(run_dir / 'bundles.jsonl')
    results, missing = parse_batch_lines(lines, rows, cfg)
    common.write_jsonl(run_dir / 'results.jsonl', results)
    nok = sum(r['status'] == 'ok' for r in results)
    print(f'collect: bundles {len(rows)} -> output lines {len(lines)} -> results {len(results)}; ok {nok}, error {len(results) - nok}, '
          f'missing {len(missing)}; job state {j.state.value}')
    return results


def cost_cmd(bundles, cfg, out_tokens):
    rows = load_bundles(bundles)
    mc = sum(r['bundle_chars'] for r in rows) / len(rows)
    for tier in ('batch', 'flex', 'standard'):
        c = common.estimate_cost(len(rows), mc, out_tokens, cfg['model'], tier, cfg)
        print(f"{tier:9s} n={c['n']} in_tok/filing={c['in_tokens_per_filing']:.0f} out_tok={c['out_tokens_per_filing']} -> ${c['usd']:.2f}")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sp = ap.add_subparsers(dest='cmd', required=True)
    for name in ('dry-run', 'flex', 'batch', 'cost'):
        p = sp.add_parser(name); p.add_argument('--bundles', required=True); p.add_argument('--limit', type=int)
        p.add_argument('--config'); p.add_argument('--run-dir')
    sp.choices['batch'].add_argument('--display', default='dual-class'); sp.choices['batch'].add_argument('--calibrating', action='store_true')
    sp.choices['batch'].add_argument('--runs-dir', help='where calibration.json files are looked for (default: parent of run-dir)')
    sp.choices['cost'].add_argument('--out-tokens', type=int, default=250)
    p = sp.add_parser('collect'); p.add_argument('--run-dir', required=True); p.add_argument('--config'); p.add_argument('--no-wait', action='store_true')
    a = ap.parse_args(argv)
    cfg = common.load_config(a.config)
    if a.cmd == 'collect':
        collect(a.run_dir, cfg, wait=not a.no_wait); return 0
    if a.cmd == 'cost':
        cost_cmd(a.bundles, cfg, a.out_tokens); return 0
    rows = load_bundles(a.bundles, a.limit)
    rd = Path(a.run_dir or Path(a.bundles).parent); rd.mkdir(parents=True, exist_ok=True)
    if a.cmd == 'dry-run':
        common.write_jsonl(rd / 'requests.jsonl', [build_request(r, cfg) for r in rows])
        print(f'dry-run: {len(rows)} requests -> {rd / "requests.jsonl"}'); cost_cmd(a.bundles, cfg, 250); return 0
    if a.cmd == 'flex':
        res = run_flex(rows, cfg, rd / 'results.jsonl')
        print(f'flex: {len(rows)} rows -> {len(res)} results; ok {sum(r["status"] == "ok" for r in res)}')
        for r in res:
            print(json.dumps(r, indent=1, sort_keys=True))
        return 0
    submit_batch(rows, cfg, rd, a.display, calibrating=a.calibrating, runs_dir=a.runs_dir)
    return 0


if __name__ == '__main__':
    sys.exit(main())
