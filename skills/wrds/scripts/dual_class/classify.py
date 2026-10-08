#!/usr/bin/env python3
"""classify.py: one proposition per filing ("dual-class common outstanding?"). Three backends (--backend, default config `backend`):
  gemini  Gemini on Vertex (ADC + GCS, never AI Studio), structured output with class table and verbatim quote.
  jev     Jev (OpenRouter decisions endpoint, jev.py): one probability P(dual) per filing, label P >= threshold. No quote.
  hybrid  Jev on every row, then Gemini (config `hybrid`: model, thinking level) only on rows with band_lo <= P < band_hi;
          the label is Gemini's inside the band and Jev's outside. Recommended default.
Jev and hybrid need --max-spend (USD cap on Jev spend for the run; no default); the Jev credit abort floor is --abort-floor.

  dry-run  bundles -> token/cost estimate (+ requests.jsonl for gemini). No network, free.
  flex     <=10 rows, synchronous: Jev calls and/or one Cloud Flex PayGo call per Gemini row (refuses >10).
  batch    >10 rows. gemini: GCS JSONL in/out. jev: synchronous Jev calls, results.jsonl written at once. hybrid: Jev on all
           rows, then a Vertex batch of the band rows only (collect merges). GATED: refused (exit 4, before any spend) unless
           the newest calibration for THIS backend (calibrate.py score) has precision and recall >= config gate on
           fixtures/labels.csv with the same run_config + prompt + schema + label file.
           `--calibrating` (calibrate.py only) bypasses the gate, and only for filings that are in the fixtures.
  collect  wait for a batch job, download its output prefix, reconcile ids, write results.jsonl (hybrid: merged with Jev).
  cost     estimate from a bundles file.

A run directory holds bundles.jsonl (input), requests.jsonl, job.json (batch), output/, jev_results.jsonl (jev, hybrid),
band_bundles.jsonl (hybrid), results.jsonl, and calibration.json (calibration runs) or calibration_used.json (the calibration a
gated run was released on). Every results row has `p_yes` (Jev probability, null for gemini), `backend_used` (jev|gemini: who
produced the label), `backend` and `run_config`.
Retry policy: Flex capacity errors (429/503) back off 4 tries; a 400 (e.g. recitation refusal) is recorded as an error row
and the loop continues. Every row is appended to results.jsonl as soon as it returns.
"""
import argparse, hashlib, importlib.util, json, os, re, subprocess, sys, time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
import jev
from schema import SCHEMA, validate_output

TERMINAL = {'JOB_STATE_SUCCEEDED', 'JOB_STATE_FAILED', 'JOB_STATE_CANCELLED', 'JOB_STATE_EXPIRED', 'JOB_STATE_PARTIALLY_SUCCEEDED'}
ID_RE = re.compile(r'^FILING_ID: (\S+)', re.M)


def user_text(row):
    return f"FILING_ID: {row['filing_id']}\n\n{row['bundle_text']}"


def build_request(row, cfg):
    """Cloud GenerateContentRequest wire shape (camelCase). Gemini 3: no temperature/top_p/top_k. The join id is a scalar
    top-level `request_id` string: Vertex batch rejects a nested `metadata` object (code 3, unsupported column type) and echoes
    scalar passthrough columns on the output line."""
    gc = {'responseMimeType': 'application/json', 'responseSchema': SCHEMA}
    if cfg.get('thinking_level'):
        gc['thinkingConfig'] = {'thinkingLevel': cfg['thinking_level']}
    return {'request': {'systemInstruction': {'parts': [{'text': common.prompt_text()}]},
                        'contents': [{'role': 'user', 'parts': [{'text': user_text(row)}]}],
                        'generationConfig': gc},
            'request_id': row['filing_id']}


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
               usage=None, raw_text=None, parsed=None, problems=[], quote_verified=None, p_yes=None, backend_used='gemini')
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


def run_prefix(run_dir, now=None):
    """GCS folder for one submit: <run-dir name>-<8 hex of sha256(absolute run dir + submit timestamp)>. Two run dirs with one
    basename, or two submits from one dir, never share a folder; job.json records the result, collect reads only that."""
    run_dir = Path(run_dir).resolve()
    stamp_ = now or time.strftime('%Y%m%dT%H%M%S', time.gmtime()) + f'{time.time_ns() % 10**9:09d}'
    return f"{run_dir.name}-{hashlib.sha256(f'{run_dir}|{stamp_}'.encode()).hexdigest()[:8]}"


def genai_available():
    try:
        return importlib.util.find_spec('google.genai') is not None
    except ModuleNotFoundError:   # no `google` package at all
        return False


def require_genai(backend):
    """Exit 1 before any paid call when the Gemini side of `backend` cannot import google-genai."""
    if backend in ('gemini', 'hybrid') and not genai_available():
        raise SystemExit(f"backend {backend} needs the google-genai package, which this interpreter lacks. Nothing was spent. "
                         'Re-run the same command as: uv run --with google-genai python <script>.py ...')


def list_outputs(cfg, dest):
    """URIs of the .jsonl objects under `dest` (recursive gcloud listing)."""
    r = subprocess.run(['gcloud', 'storage', 'ls', '-r', dest, '--project', cfg['project']], check=True, capture_output=True, text=True)
    return sorted(u for u in r.stdout.split() if u.endswith('.jsonl'))


def fetch_job_outputs(cfg, dest, out):
    """Download exactly the objects under this job's own `dest` into `out`; any listed object outside `dest` is ignored (counted
    on stdout). Returns the local files, which are the only ones collect reads."""
    dest = dest.rstrip('/') + '/'
    uris = list_outputs(cfg, dest)
    own = [u for u in uris if u.startswith(dest)]
    if len(own) != len(uris):
        print(f'collect: ignored {len(uris) - len(own)} listed objects outside {dest}')
    if not own:
        raise SystemExit(f'collect: no .jsonl output under {dest}')
    files = []
    for u in own:
        local = Path(out) / u[len(dest):]
        local.parent.mkdir(parents=True, exist_ok=True)
        gcs(cfg, 'cp', u, str(local))
        files.append(local)
    return sorted(files)


def submit_batch(rows, cfg, run_dir, display, calibrating=False, runs_dir=None, backend='gemini', cleared=None, check_rows=None,
                 bundles_name='bundles.jsonl'):
    """Submit `rows` to Vertex Batch with the Gemini side of `backend`. Gate (or fixture) check first, before any write or call,
    unless the caller already cleared it (`cleared` = the calibration released on; hybrid clears before its Jev spend).
    `check_rows`: the rows the fixture check applies to when `rows` is only a subset (hybrid band)."""
    import calibrate
    run_dir = Path(run_dir)
    used = cleared
    if cleared is None:
        if calibrating:
            calibrate.require_fixture_subset([r['filing_id'] for r in (check_rows or rows)], cfg)
        else:
            used = calibrate.require_gate(runs_dir or run_dir.parent, cfg, backend)   # SystemExit(4) when closed
    g = common.gemini_cfg(cfg, backend)
    common.write_jsonl(run_dir / bundles_name, rows)   # collect() reconciles against exactly what was submitted
    reqs = [build_request(r, g) for r in rows]
    rp = run_dir / 'requests.jsonl'
    common.write_jsonl(rp, reqs)
    prefix = run_prefix(run_dir)
    src = f"{g['gcs_prefix']}/{prefix}/requests.jsonl"
    dest = f"{g['gcs_prefix']}/{prefix}/output/"
    gcs(g, 'cp', str(rp), src)
    client = make_client(g)
    job = client.batches.create(model='publishers/google/models/' + g['model'], src=src,
                                config={'display_name': display, 'dest': dest})
    (run_dir / 'job.json').write_text(json.dumps(dict(name=job.name, display=display, src=src, dest=dest, prefix=prefix, n=len(rows),
                                                      model=g['model'], backend=backend, bundles_file=bundles_name),
                                                 indent=1, sort_keys=True))
    if used is not None:
        (run_dir / 'calibration_used.json').write_text(json.dumps(used, indent=1, sort_keys=True))
    print('submitted', job.name, job.state)
    return job.name


def request_id_of(line):
    """Join key of a batch output line: the echoed top-level request_id, else FILING_ID in the echoed request text. If both
    are present they must agree."""
    ids = set()
    if line.get('request_id'):
        ids.add(line['request_id'])
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


def stamp(results, cfg, backend):
    rc = common.run_config(cfg, backend)
    return [dict(r, backend=backend, run_config=rc) for r in results]


def band_of(cfg):
    return cfg['hybrid']['band_lo'], cfg['hybrid']['band_hi']


def in_band(p, cfg):
    lo, hi = band_of(cfg)
    return lo <= p < hi


def merge_hybrid(jev_rows, gem_rows, cfg):
    """Final hybrid rows: Gemini's row inside the band, Jev's outside. Every band row must have a Gemini row (it may be an
    error row, which scores as a failure; it is never silently replaced by Jev's label)."""
    gem = {r['filing_id']: r for r in gem_rows}
    band = {r['filing_id'] for r in jev_rows if in_band(r['p_yes'], cfg)}
    if set(gem) != band:
        raise ValueError(f'gemini rows {len(gem)} != band rows {len(band)}; extra {sorted(set(gem) - band)[:3]}, missing {sorted(band - set(gem))[:3]}')
    out = []
    for j in sorted(jev_rows, key=lambda r: r['filing_id']):
        if j['filing_id'] in band:
            g = gem[j['filing_id']]
            out.append(dict(g, p_yes=j['p_yes'], backend_used='gemini', jev_usage=j['usage']))
        else:
            out.append(j)
    print(f'hybrid: jev rows {len(jev_rows)}; band [{band_of(cfg)[0]}, {band_of(cfg)[1]}) {len(band)} '
          f'({len(band) / max(1, len(jev_rows)):.1%}) -> gemini; final label from jev {len(out) - len(band)}, gemini {len(band)}')
    return out


def collect(run_dir, cfg, wait=True):
    run_dir = Path(run_dir)
    job = json.loads((run_dir / 'job.json').read_text())
    backend = job.get('backend', 'gemini')
    g = common.gemini_cfg(cfg, backend)
    require_genai(backend)
    client = make_client(g)
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
    own_dest = job['dest'].rstrip('/') + '/'
    if j.dest and j.dest.gcs_uri and not j.dest.gcs_uri.startswith(own_dest):
        raise SystemExit(f'job {job["name"]} reports output {j.dest.gcs_uri}, outside the dest recorded at submit ({own_dest})')
    files = fetch_job_outputs(g, own_dest, out)
    lines = []
    for f in files:
        lines += [json.loads(l) for l in f.read_text().splitlines() if l.strip()]
    rows = load_bundles(run_dir / job.get('bundles_file', 'bundles.jsonl'))
    results, missing = parse_batch_lines(lines, rows, g)
    nok = sum(r['status'] == 'ok' for r in results)
    print(f'collect: bundles {len(rows)} -> output lines {len(lines)} -> results {len(results)}; ok {nok}, error {len(results) - nok}, '
          f'missing {len(missing)}; job state {j.state.value}')
    if backend == 'hybrid':
        results = merge_hybrid(common.read_jsonl(run_dir / 'jev_results.jsonl'), results, cfg)
    common.write_jsonl(run_dir / 'results.jsonl', stamp(results, cfg, backend))
    return results


def need_spend(backend, max_spend):
    if backend in ('jev', 'hybrid') and (max_spend is None or max_spend <= 0):
        raise SystemExit(f'--max-spend (USD, > 0) is required for backend {backend}')


def run_backend(rows, cfg, rd, backend, mode, max_spend=None, abort_floor=None, calibrating=False, runs_dir=None, display='dual-class'):
    """flex or batch for any backend. Order: spend flag, gate/fixture check (SystemExit 4 / message), then spend.
    mode 'flex': synchronous (<= flex_max_rows rows). mode 'batch': gemini and hybrid-band rows go to a Vertex batch job."""
    import calibrate
    rd = Path(rd); rd.mkdir(parents=True, exist_ok=True)
    need_spend(backend, max_spend)
    if mode == 'flex' and len(rows) > cfg['flex_max_rows']:
        raise SystemExit(f"flex is for <= {cfg['flex_max_rows']} rows (got {len(rows)}); use batch")
    cleared = None
    if mode == 'batch':
        if calibrating:
            calibrate.require_fixture_subset([r['filing_id'] for r in rows], cfg)
        else:
            cleared = calibrate.require_gate(runs_dir or rd.parent, cfg, backend)
    require_genai(backend)   # before the Jev stage spends anything
    g = common.gemini_cfg(cfg, backend)
    if backend == 'gemini':
        if mode == 'flex':
            res = run_flex(rows, g, rd / 'results.jsonl')
            common.write_jsonl(rd / 'results.jsonl', stamp(res, cfg, backend)); return res
        submit_batch(rows, cfg, rd, display, calibrating=calibrating, cleared=cleared, check_rows=rows, backend=backend)
        return None
    jrows, spent, _ = jev.run(rows, cfg, rd / 'jev_results.jsonl', max_spend, abort_floor)
    if backend == 'jev':
        common.write_jsonl(rd / 'results.jsonl', stamp(jrows, cfg, backend))
        if cleared is not None:
            (rd / 'calibration_used.json').write_text(json.dumps(cleared, indent=1, sort_keys=True))
        return jrows
    by = {r['filing_id']: r for r in rows}
    band = [by[r['filing_id']] for r in jrows if in_band(r['p_yes'], cfg)]
    if not band:
        res = merge_hybrid(jrows, [], cfg)
        common.write_jsonl(rd / 'results.jsonl', stamp(res, cfg, backend)); return res
    if mode == 'flex':
        res = merge_hybrid(jrows, run_flex(band, g, rd / 'gemini_flex_results.jsonl'), cfg)
        common.write_jsonl(rd / 'results.jsonl', stamp(res, cfg, backend)); return res
    submit_batch(band, cfg, rd, display, calibrating=calibrating, cleared=cleared, check_rows=rows, backend=backend,
                 bundles_name='band_bundles.jsonl')
    return None


def cost_cmd(bundles, cfg, out_tokens, backend=None):
    backend = backend or cfg['backend']
    rows = load_bundles(bundles)
    mc = sum(r['bundle_chars'] for r in rows) / len(rows)
    g = common.gemini_cfg(cfg, backend)
    jev_usd = 0.0
    if backend in ('jev', 'hybrid'):
        in_tok = mc / 4 + len(jev.QUESTION) / 4
        jev_usd = len(rows) * in_tok * cfg['jev']['est_usd_per_mtok_in'] / 1e6
        print(f"jev       n={len(rows)} in_tok/filing={in_tok:.0f} -> ${jev_usd:.2f} (est at ${cfg['jev']['est_usd_per_mtok_in']}/Mtok in; "
              f"measured gold-set mean $0.000186/filing)")
    if backend in ('gemini', 'hybrid'):
        share = cfg['hybrid']['band_share_est'] if backend == 'hybrid' else 1.0
        n = max(1, round(len(rows) * share))
        for tier in ('batch', 'flex', 'standard'):
            c = common.estimate_cost(n, mc, out_tokens, g['model'], tier, g)
            tag = f"{g['model']} {tier}" + (f" (band share {share:.1%}, n={n})" if backend == 'hybrid' else '')
            print(f"{tag:46s} n={c['n']} in_tok/filing={c['in_tokens_per_filing']:.0f} out_tok={c['out_tokens_per_filing']} -> ${c['usd']:.2f}"
                  + (f"; hybrid total ${jev_usd + c['usd']:.2f}" if backend == 'hybrid' and tier == 'batch' else ''))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sp = ap.add_subparsers(dest='cmd', required=True)
    for name in ('dry-run', 'flex', 'batch', 'cost'):
        p = sp.add_parser(name); p.add_argument('--bundles', required=True); p.add_argument('--limit', type=int)
        p.add_argument('--config'); p.add_argument('--run-dir')
        p.add_argument('--backend', choices=['gemini', 'jev', 'hybrid'], help='default: config `backend`')
    for name in ('flex', 'batch'):
        sp.choices[name].add_argument('--max-spend', type=float, help='USD cap on Jev spend this run; required for jev and hybrid')
        sp.choices[name].add_argument('--abort-floor', type=float, help='abort when OpenRouter credits remaining < this (config jev.abort_floor_usd)')
    sp.choices['batch'].add_argument('--display', default='dual-class'); sp.choices['batch'].add_argument('--calibrating', action='store_true')
    sp.choices['batch'].add_argument('--labels', help='labels CSV the calibration was scored against (default fixtures/labels.csv)')
    sp.choices['batch'].add_argument('--runs-dir', help='where calibration.json files are looked for (default: parent of run-dir)')
    sp.choices['cost'].add_argument('--out-tokens', type=int, default=250)
    p = sp.add_parser('collect'); p.add_argument('--run-dir', required=True); p.add_argument('--config'); p.add_argument('--no-wait', action='store_true')
    a = ap.parse_args(argv)
    cfg = common.load_config(a.config)
    if a.cmd == 'collect':
        collect(a.run_dir, cfg, wait=not a.no_wait); return 0
    backend = a.backend or cfg['backend']
    if a.cmd == 'cost':
        cost_cmd(a.bundles, cfg, a.out_tokens, backend); return 0
    if getattr(a, 'labels', None):
        import calibrate
        calibrate.set_labels(a.labels)
    rows = load_bundles(a.bundles, a.limit)
    rd = Path(a.run_dir or Path(a.bundles).parent); rd.mkdir(parents=True, exist_ok=True)
    if a.cmd == 'dry-run':
        if backend == 'gemini':
            common.write_jsonl(rd / 'requests.jsonl', [build_request(r, cfg) for r in rows])
            print(f'dry-run: {len(rows)} requests -> {rd / "requests.jsonl"}')
        else:
            print(f'dry-run: backend {backend}: no request file ({"Jev calls carry the bundle text" if backend == "jev" else "Gemini requests exist only for rows in the Jev band"})')
        cost_cmd(a.bundles, cfg, 250, backend); return 0
    res = run_backend(rows, cfg, rd, backend, a.cmd, a.max_spend, a.abort_floor, calibrating=getattr(a, 'calibrating', False),
                      runs_dir=getattr(a, 'runs_dir', None), display=getattr(a, 'display', 'dual-class'))
    if a.cmd == 'flex' and res is not None:
        print(f'flex: {len(rows)} rows -> {len(res)} results; ok {sum(r["status"] == "ok" for r in res)}')
        for r in res:
            print(json.dumps(r, indent=1, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
