#!/usr/bin/env python3
"""extract.py: filing list -> passage bundles (JSONL, one row per input filing, sorted by filing_id).

Input  --filings CSV/TSV with a header; columns: `accession` or `path` (EDGAR path edgar/data/<cik>/<acc>.txt), and `cik`
       (required for --source wrds; optional otherwise). Row count out == row count in; a filing that cannot be read
       becomes a row with `error` set (no sections), the run exits 3 and prints each failure.
Source --source wrds   read <wrds_clean_root>/<cik zfill10[:6]>/<cik>/<acc>.txt (run on the WRDS grid or a mount);
       --source edgar  complete submission https://www.sec.gov/Archives/edgar/data/<cik>/<acc>.txt
       --source local  <--local-dir>/<acc>.txt (saved copies; tests and re-runs)

E7 (network politeness), --source edgar only: host www.sec.gov; documented ceiling 10 requests/s per IP (SEC fair-access
policy: a rate limit, not a quota). This code spaces requests by 1/rate (config edgar_rate_per_s, default 6) through one
global lock and REFUSES a rate above edgar_rate_ceiling_per_s (8). The User-Agent comes from the environment variable
SEC_USER_AGENT (name + email) and the run refuses to start without it. 403/404 are recorded as failures, never retried;
429/5xx back off exponentially (5 tries). Fallback that was not executed: WRDS clean files (--source wrds) need no HTTP.
"""
import argparse, csv, gzip, json, os, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ProcessPoolExecutor, ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common, sections as S, rule_v3

_lock = threading.Lock(); _next = [0.0]


def throttle(gap):
    with _lock:
        t = max(time.time(), _next[0]); _next[0] = t + gap
    time.sleep(max(0.0, t - time.time()))


def http_get(url, ua, gap):
    err = None
    for a in range(5):
        throttle(gap)
        try:
            req = urllib.request.Request(url, headers={'User-Agent': ua, 'Accept-Encoding': 'gzip'})
            with urllib.request.urlopen(req, timeout=90) as r:
                b = r.read()
                return gzip.decompress(b) if r.headers.get('Content-Encoding') == 'gzip' else b
        except urllib.error.HTTPError as e:
            if e.code in (403, 404):
                raise
            err = e
        except Exception as e:  # network error: retried, and raised after the last try
            err = e
        time.sleep(5 * 2 ** a)
    raise RuntimeError(f'fetch failed {url}: {err!r}')


def read_filings(path):
    with open(path, newline='') as f:
        head = f.readline(); f.seek(0)
        rd = csv.DictReader(f, delimiter='\t' if '\t' in head else ',')
        rows = list(rd)
    out = []
    for r in rows:
        acc = common.accession_of(r.get('accession') or r.get('path') or r.get('filing_id') or '')
        cik = (r.get('cik') or '').strip()
        if not cik and r.get('path'):
            cik = r['path'].split('/')[2]
        out.append(dict(filing_id=acc, accession=acc, cik=str(int(cik)) if cik else ''))
    ids = [o['filing_id'] for o in out]
    if len(set(ids)) != len(ids):
        raise ValueError('duplicate accession in --filings')
    return out


def get_raw(rec, source, cfg, local_dir, ua):
    if source == 'wrds':
        with open(common.wrds_clean_path(cfg['wrds_clean_root'], rec['cik'], rec['accession']), 'rb') as f:
            return f.read()
    if source == 'local':
        with open(os.path.join(local_dir, rec['accession'] + '.txt'), 'rb') as f:
            return f.read()
    gap = 1.0 / cfg['edgar_rate_per_s']
    return http_get('https://www.sec.gov/Archives/' + common.edgar_path(rec['cik'], rec['accession']), ua, gap)


def build_bundle(text):
    """Pure: raw/cleaned submission text -> {sections, meta, bundle_text, rule_v3}."""
    sec, meta = S.extract(text)
    bundle = S.assemble(sec)
    r3 = rule_v3.classify(text)
    return dict(sections=sec, meta=meta, bundle_text=bundle, bundle_chars=len(bundle), est_tokens=len(bundle) / 4,
                rule_v3=dict(positive=bool(r3['v3_pos']), rule=r3['rule'], n_tokens=r3['n_tokens'], n_hits=r3['n_hits'],
                             tokens=r3['tokens']))


def _parse(args):
    rec, raw = args
    return dict(rec, raw_bytes=len(raw), **build_bundle(raw.decode('latin-1')))


def _fetch(args):
    rec, source, cfg, local_dir, ua = args
    try:
        return rec, get_raw(rec, source, cfg, local_dir, ua), None
    except Exception as e:
        return rec, None, repr(e)


def run(filings, source, cfg, local_dir=None, workers=8):
    ua = os.environ.get('SEC_USER_AGENT', '')
    if source == 'edgar':
        if not ua:
            raise SystemExit('SEC_USER_AGENT (name + email) is required for --source edgar')
        if cfg['edgar_rate_per_s'] > cfg['edgar_rate_ceiling_per_s']:
            raise SystemExit(f"edgar_rate_per_s {cfg['edgar_rate_per_s']} exceeds ceiling {cfg['edgar_rate_ceiling_per_s']}")
    if source in ('wrds', 'edgar') and any(not f['cik'] for f in filings):
        raise SystemExit(f'--source {source} needs a cik for every filing')
    jobs = [(f, source, cfg, local_dir, ua) for f in filings]
    with ThreadPoolExecutor(workers if source == 'edgar' else 8) as ex:
        res = list(ex.map(_fetch, jobs))
    ok = [(r, b) for r, b, e in res if e is None]
    bad = [dict(r, error=e) for r, b, e in res if e is not None]
    with ProcessPoolExecutor() as pp:
        built = list(pp.map(_parse, ok, chunksize=4))
    rows = sorted(built + bad, key=lambda r: r['filing_id'])
    return rows, bad


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--filings', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--source', choices=['wrds', 'edgar', 'local'], required=True)
    ap.add_argument('--local-dir'); ap.add_argument('--config'); ap.add_argument('--workers', type=int, default=8)
    a = ap.parse_args(argv)
    cfg = common.load_config(a.config)
    filings = read_filings(a.filings)
    rows, bad = run(filings, a.source, cfg, a.local_dir, a.workers)
    assert len(rows) == len(filings), 'row count chain broken'
    common.write_jsonl(a.out, rows)
    okr = [r for r in rows if 'error' not in r]
    print(f'extract: in {len(filings)} filings -> out {len(rows)} rows; ok {len(okr)}, failed {len(bad)}; '
          f'mean bundle chars {sum(r["bundle_chars"] for r in okr) / max(1, len(okr)):.0f}; '
          f'item5 found {sum(1 for r in okr if r["sections"]["item5"]["found"])}/{len(okr)}')
    for b in bad:
        print('FAIL', b['filing_id'], b['error'], file=sys.stderr)
    return 3 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
