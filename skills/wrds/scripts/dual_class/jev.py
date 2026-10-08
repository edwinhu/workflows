"""jev.py: the Jev backend. One `noul` question per filing against the OpenRouter decisions endpoint -> P(dual) in [0, 1].

  POST https://openrouter.ai/api/alpha/decisions  {state, model, questions:{dual:{type:"noul", instructions: QUESTION}}}
  -> {answers:{dual:{type:"noul", noul: 0..1}}, usage:{input_tokens, output_tokens, cost}}

State = the extractor's bundle text. The label is P >= threshold (config jev.threshold, 0.5). Jev returns a probability only: no
classes, no quote, so a Jev row has no evidence_quote and `quote_verified` is None.
Key: $WORK_HOLD_JUDGE_TOKEN, else $XDG_RUNTIME_DIR/agenix/openrouter-api-key. Never printed or written to a file.
Spend: --max-spend is required (no default). The run aborts before any call when remaining credits < abort floor (config
jev.abort_floor_usd, default 10, or --abort-floor), stops when this run's summed usage.cost exceeds --max-spend, stops when remaining
credits at start minus this run's cost fall under the floor, and stops on HTTP 402 / an "insufficient credits" body.
E7 (rate): OpenRouter is a paid API with no documented per-key request ceiling for paid models; the bound here is concurrency,
8 worker threads (config jev.workers), roughly 8 / 1.5 s = 5 requests/s at the observed latency. 429 and 5xx back off 2^n s (max
30 s) for 6 tries; 402 is never retried. Resumable: rows already in <run-dir>/jev_results.jsonl for the same model and question
hash are not re-called, so running twice is running once.
"""
import hashlib, json, os, re, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common

URL = 'https://openrouter.ai/api/alpha/decisions'
CREDITS_URL = 'https://openrouter.ai/api/v1/credits'
QKEY = 'dual'
QUESTION = ('At fiscal year end the registrant had two or more classes of common equity outstanding with different '
            'votes per share (counting a class that elects a fixed fraction of the board; not counting warrants, '
            'preferred, partnership/LLC units of a partnership registrant, equal-vote classes, or '
            'authorized-but-unissued classes).')
QUESTION_SHA256 = hashlib.sha256(QUESTION.encode()).hexdigest()


class OutOfCredits(Exception):
    pass


def api_key():
    k = os.environ.get('WORK_HOLD_JUDGE_TOKEN', '')
    if not k:
        k = open(f"{os.environ.get('XDG_RUNTIME_DIR', '/run/user/1000')}/agenix/openrouter-api-key").read().strip()
    assert k, 'empty openrouter key'
    return k


def out_of_credits(status, body):
    return status == 402 or bool(re.search(r'insufficient credits|out of credits|requires more credits', body[:2000], re.I))


def _http(url, key, payload=None, timeout=60):
    """(status, body). One place that touches the network; tests monkeypatch it."""
    headers = {'Authorization': 'Bearer ' + key}
    if payload is not None:
        headers['Content-Type'] = 'application/json'
    req = urllib.request.Request(url, data=payload, method='POST' if payload is not None else 'GET', headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors='replace')
    except (urllib.error.URLError, TimeoutError) as e:
        return 599, str(e)


def credits_remaining(key):
    status, body = _http(CREDITS_URL, key, timeout=30)
    if status != 200:
        raise RuntimeError(f'credits endpoint HTTP {status}: {body[:200]}')
    d = json.loads(body)['data']
    return d['total_credits'] - d['total_usage'], d['total_usage']


def call(key, state, model, retries=6):
    payload = json.dumps({'state': state, 'model': model,
                          'questions': {QKEY: {'type': 'noul', 'instructions': QUESTION}}}).encode()
    status, body = None, ''
    for att in range(retries):
        status, body = _http(URL, key, payload)
        if out_of_credits(status, body):
            raise OutOfCredits(body[:300])
        if status == 429 or status >= 500:
            time.sleep(min(30, 2 ** att)); continue
        if status >= 400:
            raise RuntimeError(f'HTTP {status}: {body[:300]}')
        return json.loads(body)
    raise RuntimeError(f'gave up after {retries} tries, last status {status}: {body[:200]}')


def result_row(row, d, jcfg):
    """One result row in the shape calibrate.score reads. `d` is the decisions response."""
    p = d['answers'][QKEY]['noul']
    assert isinstance(p, (int, float)) and 0 <= p <= 1, d
    u = d.get('usage') or {}
    cost = u.get('cost')
    assert isinstance(cost, (int, float)), f'no cost in usage: {u}'
    dual = 'true' if p >= jcfg['threshold'] else 'false'
    return dict(filing_id=row['filing_id'], model=jcfg['model'], tier='jev', status='ok', error=None, finish_reason='STOP',
                usage=dict(prompt_tokens=u.get('input_tokens'), output_tokens=u.get('output_tokens'), thoughts_tokens=None,
                           traffic_type=None, cost_usd=cost),
                raw_text=None, problems=[], quote_verified=None, p_yes=float(p), backend_used='jev',
                parsed=dict(dual=dual, classes=[], evidence_quote='', location='none'),
                jev=dict(model=jcfg['model'], question_sha256=QUESTION_SHA256, threshold=jcfg['threshold']))


def run(rows, cfg, out_path, max_spend, abort_floor=None, call_fn=None, key=None):
    """Score every row (resumable through out_path). Returns (result rows sorted by filing_id, spent_this_run, remaining_at_start).
    Raises SystemExit before any call when credits are below the floor; raises RuntimeError after the loop on a stop."""
    jcfg = cfg['jev']
    if max_spend is None or max_spend <= 0:
        raise SystemExit('--max-spend (USD, > 0) is required for the jev and hybrid backends')
    floor = jcfg['abort_floor_usd'] if abort_floor is None else abort_floor
    key = key or api_key()
    rem, used0 = credits_remaining(key)
    print(f'jev: credits remaining ${rem:.4f} (usage so far ${used0:.4f}); abort floor ${floor}; max spend ${max_spend}', flush=True)
    if rem < floor:
        raise SystemExit(f'ABORT: remaining ${rem:.2f} < abort floor ${floor}')
    done = {}
    if os.path.exists(out_path):
        for r in common.read_jsonl(out_path):
            if r.get('jev', {}).get('model') == jcfg['model'] and r['jev'].get('question_sha256') == QUESTION_SHA256 \
                    and r['jev'].get('threshold') == jcfg['threshold'] and r['status'] == 'ok':
                done[r['filing_id']] = r
    todo = [r for r in rows if r['filing_id'] not in done]
    print(f'jev: rows {len(rows)}; already done {len(rows) - len(todo)}; to call {len(todo)}', flush=True)
    lock = threading.Lock(); spent = [0.0]; stop = threading.Event(); new = []
    call_fn = call_fn or (lambda st: call(key, st, jcfg['model']))
    open(out_path, 'a').close()

    def work(row):
        if stop.is_set():
            return None
        try:
            res = result_row(row, call_fn(row['bundle_text']), jcfg)
        except BaseException:
            stop.set()          # no other worker starts a new call after a failure or a 402
            raise
        with lock:
            spent[0] += res['usage']['cost_usd']
            with open(out_path, 'a') as f:      # appended as soon as it returns; sorted at the end
                f.write(json.dumps(res, sort_keys=True) + '\n')
            if stop.is_set():
                pass
            elif spent[0] > max_spend:
                stop.set(); print(f'jev: STOP, spent ${spent[0]:.5f} > max spend ${max_spend}', flush=True)
            elif rem - spent[0] < floor:
                stop.set(); print(f'jev: STOP, remaining credits would fall under ${floor}', flush=True)
        return res

    err = None
    with ThreadPoolExecutor(jcfg['workers']) as ex:
        futs = [ex.submit(work, r) for r in todo]
        for f in futs:
            try:
                x = f.result()
                if x:
                    new.append(x)
            except OutOfCredits as e:
                stop.set(); err = err or f'OUT OF CREDITS: {e}'
            except Exception as e:
                stop.set(); err = err or f'{type(e).__name__}: {e}'
    allrows = sorted(list(done.values()) + new, key=lambda r: r['filing_id'])
    common.write_jsonl(out_path, allrows)        # deterministic order, one row per filing
    skipped = len(todo) - len(new)
    print(f'jev: wrote {len(allrows)} rows to {out_path}; called {len(new)}, skipped after stop {skipped}; '
          f'this run cost ${spent[0]:.5f}', flush=True)
    if err:
        raise RuntimeError(err)
    if skipped:
        raise RuntimeError(f'stopped with {skipped} rows not scored (spend or credit floor)')
    return allrows, spent[0], rem
