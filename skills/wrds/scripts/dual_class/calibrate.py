#!/usr/bin/env python3
"""calibrate.py: score the classifier against fixtures/labels.csv and hold the gate on full batch runs.

  prepare --run-dir D --source {edgar,wrds}   extract bundles for every labelled filing -> D/bundles.jsonl (free; 270 fetches)
  submit  --run-dir D [--backend B] [--max-spend USD]   run D/bundles.jsonl with the gate bypassed (calibration only; PAID).
                                               gemini: Vertex batch (then classify.py collect). jev: synchronous, results at once.
                                               hybrid: Jev on all, Vertex batch of the band rows (then classify.py collect).
  score   --run-dir D                          D/results.jsonl vs labels -> D/calibration.json (+ printed table); the backend is
                                               read from the rows and must match the current config
  gate    --runs-dir R [--backend B]           exit 0 if the newest R/*/calibration.json FOR BACKEND B opens the gate, else 4

Gold: dual=positive, single=negative, unres=excluded (counted). Prediction: dual=="true" is positive; "unclear", an error
row or a missing row is negative and counted separately, so a model that abstains cannot raise precision unseen.
Precision/recall/accuracy carry Wilson 95% CIs. Kappa is Cohen's binary kappa with a bootstrap percentile 95% CI over
filings (seed 0, 2000 draws). The free baseline (rule_v3, carried in the bundles) is scored on the same rows.

GATE (classify.py batch, no --calibrating): the NEWEST calibration.json under runs-dir (by scored_at) of the requested backend
must (1) match the current fingerprint: backend, Gemini model + thinking level, Jev model, question-text sha, threshold, hybrid
band (the fields a backend does not use are null), plus prompt.md, schema and labels.csv hashes, (2) have n_scored >=
gate.min_scored, (3) have precision >= and recall >= the config thresholds (point estimates). Backends gate independently: a
newer calibration of another backend does not open or close this one. The calibration is the state: no separate file exists.
Score refuses result rows whose stamped run_config differs from the current one (a run made under other settings).
"""
import argparse, csv, hashlib, json, math, os, random, sys, time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common
from schema import SCHEMA

LABELS = common.PKG / 'fixtures' / 'labels.csv'


def wilson(k, n, z=1.959964):
    if n == 0:
        return (None, None)
    p = k / n; d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (round(c - h, 4), round(c + h, 4))


def kappa(tp, fp, fn, tn):
    n = tp + fp + fn + tn
    if n == 0:
        return None
    po = (tp + tn) / n
    pe = ((tp + fp) * (tp + fn) + (fn + tn) * (fp + tn)) / (n * n)
    return None if pe == 1 else (po - pe) / (1 - pe)


def confusion(pairs):
    tp = sum(1 for g, p in pairs if g and p); fp = sum(1 for g, p in pairs if not g and p)
    fn = sum(1 for g, p in pairs if g and not p); tn = sum(1 for g, p in pairs if not g and not p)
    return tp, fp, fn, tn


def metrics(pairs, seed=0, draws=2000):
    tp, fp, fn, tn = confusion(pairs)
    n = len(pairs)
    prec = tp / (tp + fp) if tp + fp else None
    rec = tp / (tp + fn) if tp + fn else None
    k = kappa(tp, fp, fn, tn)
    rng = random.Random(seed); ks = []
    for _ in range(draws):
        s = [pairs[rng.randrange(n)] for _ in range(n)] if n else []
        kk = kappa(*confusion(s)) if s else None
        if kk is not None:
            ks.append(kk)
    ks.sort()
    kci = (round(ks[int(0.025 * len(ks))], 4), round(ks[int(0.975 * len(ks)) - 1], 4)) if len(ks) > 100 else (None, None)
    return dict(n=n, tp=tp, fp=fp, fn=fn, tn=tn,
                precision=prec, precision_ci=wilson(tp, tp + fp), recall=rec, recall_ci=wilson(tp, tp + fn),
                accuracy=(tp + tn) / n if n else None, accuracy_ci=wilson(tp + tn, n),
                kappa=k, kappa_ci=kci)


def load_labels(path=LABELS):
    with open(path, newline='') as f:
        return list(csv.DictReader(f))


def fingerprint(cfg, backend=None):
    backend = backend or cfg['backend']
    gem = backend in ('gemini', 'hybrid')
    return dict(common.run_config(cfg, backend),
                prompt_sha256=common.sha256_file(common.PKG / 'prompt.md') if gem else None,
                schema_sha256=hashlib.sha256(json.dumps(SCHEMA, sort_keys=True).encode()).hexdigest() if gem else None,
                labels_sha256=common.sha256_file(LABELS))


def spend(results, cfg=None):
    """Tokens and USD from the result rows: Jev's reported usage.cost; Gemini tokens priced at the config batch rates."""
    cfg = cfg or common.load_config()
    jev_usd = 0.0; ptok = otok = 0; gem_usd = 0.0
    for r in results:
        u = r.get('usage') or {}
        if r.get('backend_used', 'gemini') == 'jev':
            jev_usd += u.get('cost_usd') or 0.0
            continue
        ju = r.get('jev_usage') or {}
        jev_usd += ju.get('cost_usd') or 0.0
        pt, ot = u.get('prompt_tokens') or 0, (u.get('output_tokens') or 0) + (u.get('thoughts_tokens') or 0)
        p_in, p_out = cfg['prices_usd_per_mtok'][r['model']]['batch'] if r.get('model') in cfg['prices_usd_per_mtok'] else (0, 0)
        ptok += pt; otok += ot; gem_usd += (pt * p_in + ot * p_out) / 1e6
    return dict(jev_usd=round(jev_usd, 6), gemini_prompt_tokens=ptok, gemini_output_and_thought_tokens=otok,
                gemini_batch_usd=round(gem_usd, 6), total_usd=round(jev_usd + gem_usd, 6))


def score(labels, results, bundles=None, cfg=None):
    """Join labels to results on filing_id (E3 audit returned) and compute metrics. Pure."""
    lab = {r['filing_id']: r for r in labels}
    res = {r['filing_id']: r for r in results}
    gold = {k: v for k, v in lab.items() if v['label'] in ('dual', 'single')}
    audit = dict(n_labels=len(lab), n_unres_excluded=sum(1 for v in lab.values() if v['label'] == 'unres'),
                 n_gold=len(gold), n_results=len(results), matched=sum(1 for k in gold if k in res),
                 results_not_in_labels=sorted(set(res) - set(lab)))
    audit['match_rate'] = audit['matched'] / audit['n_gold'] if audit['n_gold'] else 0.0
    pairs, unclear, failed, testable, verified = [], 0, 0, 0, 0
    for k in sorted(gold):
        r = res.get(k)
        ok = r is not None and r['status'] == 'ok'
        failed += 0 if ok else 1
        d = r['parsed']['dual'] if ok else None
        unclear += d == 'unclear'
        if ok and d == 'true' and r.get('backend_used', 'gemini') == 'gemini':   # Jev returns no quote
            testable += 1; verified += bool(r.get('quote_verified'))
        pairs.append((gold[k]['label'] == 'dual', d == 'true'))
    used = {}
    for r in results:
        used[r.get('backend_used', 'gemini')] = used.get(r.get('backend_used', 'gemini'), 0) + 1
    out = dict(audit=audit, model=metrics(pairs), n_unclear=unclear, n_failed_or_missing=failed,
               dual_true_rows=testable, dual_true_quote_verified=verified, rows_by_backend_used=used, spend=spend(results, cfg))
    if bundles is not None:
        bb = {b['filing_id']: b for b in bundles if 'error' not in b}
        bp = [(gold[k]['label'] == 'dual', bool(bb[k]['rule_v3']['positive'])) for k in sorted(gold) if k in bb]
        out['baseline_rule_v3'] = metrics(bp)
    return out


def evaluate_gate(cal, cfg, current):
    """(ok, reasons) for a calibration dict against thresholds and the current fingerprint. Pure."""
    g = cfg['gate']; why = []
    if cal is None:
        return False, ['no calibration.json found for this backend']
    for k, v in current.items():
        if cal.get('fingerprint', {}).get(k) != v:
            why.append(f'stale: {k} differs from the calibrated run')
    m = cal.get('model_metrics', {})
    if m.get('n', 0) < g['min_scored']:
        why.append(f"n_scored {m.get('n', 0)} < {g['min_scored']}")
    for name in ('precision', 'recall'):
        v = m.get(name)
        if v is None or v < g['min_' + name]:
            why.append(f"{name} {v} < {g['min_' + name]}")
    return not why, why


def latest_calibration(runs_dir, backend=None):
    cands = []
    for p in Path(runs_dir).glob('*/calibration.json'):
        c = json.loads(p.read_text()); c['_path'] = str(p)
        if backend is None or c.get('fingerprint', {}).get('backend') == backend:
            cands.append(c)
    return max(cands, key=lambda c: c['scored_at']) if cands else None


def require_gate(runs_dir, cfg, backend=None):
    backend = backend or cfg['backend']
    cal = latest_calibration(runs_dir, backend)
    ok, why = evaluate_gate(cal, cfg, fingerprint(cfg, backend))
    if not ok:
        print(f'GATE CLOSED ({runs_dir}, backend {backend}): ' + '; '.join(why) + '. Run calibrate.py prepare/submit/score first.', file=sys.stderr)
        raise SystemExit(4)
    return cal


def require_fixture_subset(ids, cfg):
    lab = {r['filing_id'] for r in load_labels()}
    extra = sorted(set(ids) - lab)
    if extra:
        raise SystemExit(f'--calibrating accepts only fixture filings; {len(extra)} are not in labels.csv, e.g. {extra[:3]}')
    if len(ids) < cfg['gate']['min_scored']:
        raise SystemExit(f"--calibrating needs >= {cfg['gate']['min_scored']} filings (got {len(ids)})")


def backend_of(results, cfg, asked=None):
    """The one backend all rows were produced under; refuses mixed rows, rows without a stamp, and rows whose stamped run_config
    differs from the current config (settings changed after the run)."""
    stamps = {json.dumps([r.get('backend'), r.get('run_config')], sort_keys=True) for r in results}
    if len(stamps) != 1:
        raise SystemExit(f'results rows carry {len(stamps)} different backend/run_config stamps (need exactly 1)')
    backend, rc = json.loads(next(iter(stamps)))
    if backend is None or rc is None:
        raise SystemExit('results rows have no backend/run_config stamp; re-run them with this version of classify.py')
    if asked and asked != backend:
        raise SystemExit(f'--backend {asked} but the rows were produced by {backend}')
    if rc != common.run_config(cfg, backend):
        raise SystemExit(f'rows were produced under {rc} but the current config is {common.run_config(cfg, backend)}')
    return backend


def cmd_score(run_dir, cfg, backend=None):
    rd = Path(run_dir)
    results = common.read_jsonl(rd / 'results.jsonl')
    backend = backend_of(results, cfg, backend)
    bp = rd / 'bundles.jsonl'
    s = score(load_labels(), results, common.read_jsonl(bp) if bp.exists() else None, cfg)
    fp = fingerprint(cfg, backend)
    cal = dict(fingerprint=fp, model_metrics=s['model'], baseline_rule_v3=s.get('baseline_rule_v3'),
               audit=s['audit'], n_unclear=s['n_unclear'], n_failed_or_missing=s['n_failed_or_missing'],
               dual_true_rows=s['dual_true_rows'], dual_true_quote_verified=s['dual_true_quote_verified'],
               rows_by_backend_used=s['rows_by_backend_used'], spend=s['spend'],
               results_sha256=common.sha256_file(rd / 'results.jsonl'),
               scored_at=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()))
    (rd / 'calibration.json').write_text(json.dumps(cal, indent=1, sort_keys=True))
    a = s['audit']
    print(f"backend {backend}: " + ', '.join(f'{k}={v}' for k, v in fp.items() if k not in ('backend', 'labels_sha256') and v is not None))
    print(f"join: labels {a['n_labels']} (unres excluded {a['n_unres_excluded']}) -> gold {a['n_gold']}; results {a['n_results']}; "
          f"matched {a['matched']} ({a['match_rate']:.1%}); results not in labels {len(a['results_not_in_labels'])}")
    def show(tag, m):
        f = lambda v: 'NA' if v is None else f'{v:.3f}'
        ci = lambda c: f'[{f(c[0])},{f(c[1])}]'
        print(f"{tag:14s} n={m['n']} TP={m['tp']} FP={m['fp']} FN={m['fn']} TN={m['tn']} precision={f(m['precision'])}{ci(m['precision_ci'])} "
              f"recall={f(m['recall'])}{ci(m['recall_ci'])} kappa={f(m['kappa'])}{ci(m['kappa_ci'])} accuracy={f(m['accuracy'])}{ci(m['accuracy_ci'])}")
    show('model', s['model'])
    if s.get('baseline_rule_v3'):
        show('rule_v3', s['baseline_rule_v3'])
    print(f"unclear {s['n_unclear']}, failed/missing {s['n_failed_or_missing']}, label produced by {s['rows_by_backend_used']}, "
          f"gemini dual=true rows {s['dual_true_rows']} of which quote verbatim in bundle {s['dual_true_quote_verified']}")
    sp = s['spend']
    print(f"spend: jev ${sp['jev_usd']:.4f}; gemini {sp['gemini_prompt_tokens']} prompt / {sp['gemini_output_and_thought_tokens']} output+thought tokens "
          f"= ${sp['gemini_batch_usd']:.4f} at config batch prices; total ${sp['total_usd']:.4f}")
    ok, why = evaluate_gate(cal, cfg, fp)
    print('GATE', 'OPEN' if ok else 'CLOSED: ' + '; '.join(why))
    return 0


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sp = ap.add_subparsers(dest='cmd', required=True)
    p = sp.add_parser('prepare'); p.add_argument('--run-dir', required=True); p.add_argument('--source', choices=['edgar', 'wrds', 'local'], required=True)
    p.add_argument('--local-dir')
    p = sp.add_parser('submit'); p.add_argument('--run-dir', required=True); p.add_argument('--backend', choices=['gemini', 'jev', 'hybrid'])
    p.add_argument('--max-spend', type=float, help='USD cap on Jev spend; required for jev and hybrid')
    p.add_argument('--abort-floor', type=float, help='abort when OpenRouter credits remaining < this (config jev.abort_floor_usd)')
    p = sp.add_parser('score'); p.add_argument('--run-dir', required=True); p.add_argument('--backend', choices=['gemini', 'jev', 'hybrid'])
    p = sp.add_parser('gate'); p.add_argument('--runs-dir', required=True); p.add_argument('--backend', choices=['gemini', 'jev', 'hybrid'])
    ap.add_argument('--config')
    a = ap.parse_args(argv)
    cfg = common.load_config(a.config)
    if a.cmd == 'prepare':
        import extract
        rd = Path(a.run_dir); rd.mkdir(parents=True, exist_ok=True)
        flist = rd / 'filings.csv'
        with open(flist, 'w', newline='') as f:
            w = csv.writer(f, lineterminator='\n'); w.writerow(['accession', 'cik'])
            for r in load_labels():
                w.writerow([r['filing_id'], r['cik']])
        return extract.main(['--filings', str(flist), '--out', str(rd / 'bundles.jsonl'), '--source', a.source] +
                            (['--local-dir', a.local_dir] if a.local_dir else []))
    if a.cmd == 'submit':
        import classify
        rd = Path(a.run_dir)
        classify.run_backend(classify.load_bundles(rd / 'bundles.jsonl'), cfg, rd, a.backend or cfg['backend'], 'batch',
                             a.max_spend, a.abort_floor, calibrating=True, display='dual-class-calibration')
        return 0
    if a.cmd == 'score':
        return cmd_score(a.run_dir, cfg, a.backend)
    backend = a.backend or cfg['backend']
    cal = latest_calibration(a.runs_dir, backend)
    ok, why = evaluate_gate(cal, cfg, fingerprint(cfg, backend))
    print('GATE', 'OPEN' if ok else 'CLOSED: ' + '; '.join(why), f'(backend {backend}' + (', ' + cal['_path'] if cal else '') + ')')
    return 0 if ok else 4


if __name__ == '__main__':
    sys.exit(main())
