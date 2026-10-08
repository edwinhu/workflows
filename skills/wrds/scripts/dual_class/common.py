"""Shared helpers: config, hashes, filing ids, cost formula. Stdlib only."""
import hashlib, json, re
from pathlib import Path

PKG = Path(__file__).resolve().parent
ACC_RE = re.compile(r'(\d{10}-\d{2}-\d{6})')


def load_config(path=None):
    return json.loads(Path(path or PKG / 'config.json').read_text())


def gemini_cfg(cfg, backend):
    """The config the Gemini side of a backend runs with: hybrid overrides model and thinking level (config `hybrid`)."""
    if backend == 'hybrid':
        return dict(cfg, model=cfg['hybrid']['model'], thinking_level=cfg['hybrid']['thinking_level'])
    return cfg


def run_config(cfg, backend):
    """Every setting that changes a backend's labels; None for fields the backend does not use. Stamped on result rows and
    folded into the calibration fingerprint, so a changed model, thinking level, Jev model, question text, threshold or band
    closes the gate."""
    if backend not in ('gemini', 'jev', 'hybrid'):
        raise ValueError(f'unknown backend {backend!r}')
    g = gemini_cfg(cfg, backend); gem = backend in ('gemini', 'hybrid'); jev = backend in ('jev', 'hybrid')
    if jev:
        import jev as _jev
    return {'backend': backend,
            'model': g['model'] if gem else None, 'thinking_level': g.get('thinking_level') if gem else None,
            'jev_model': cfg['jev']['model'] if jev else None,
            'question_sha256': _jev.QUESTION_SHA256 if jev else None,
            'threshold': cfg['jev']['threshold'] if jev else None,
            'band': [cfg['hybrid']['band_lo'], cfg['hybrid']['band_hi']] if backend == 'hybrid' else None}


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def prompt_text():
    return (PKG / 'prompt.md').read_text()


def accession_of(s):
    """0000037996-97-000008 from an accession, an EDGAR path or a wrds_clean path; ValueError otherwise."""
    m = ACC_RE.search(str(s))
    if not m:
        raise ValueError(f'no accession number in {s!r}')
    return m.group(1)


def edgar_path(cik, accession):
    return f'edgar/data/{int(cik)}/{accession}.txt'


def wrds_clean_path(root, cik, accession):
    """<root>/<first 6 of 10-digit zero-padded CIK>/<cik>/<accession>.txt (== wrdssec_all.wrds_forms.wrdsfname)."""
    c = int(cik)
    return f'{root}/{str(c).zfill(10)[:6]}/{c}/{accession}.txt'


def read_jsonl(path):
    import gzip
    op = gzip.open if str(path).endswith('.gz') else open
    with op(path, 'rt') as f:
        return [json.loads(l) for l in f if l.strip()]


def write_jsonl(path, rows):
    import gzip
    op = gzip.open if str(path).endswith('.gz') else open
    with op(path, 'wt') as f:
        for r in rows:
            f.write(json.dumps(r, sort_keys=True) + '\n')


def estimate_cost(n, mean_bundle_chars, mean_out_tokens, model, tier, cfg, prompt_chars=None):
    """USD = n * (in_tok * p_in + out_tok * p_out) / 1e6; in_tok = (bundle_chars + prompt_chars + schema_chars) / 4."""
    from schema import SCHEMA
    pc = len(prompt_text()) if prompt_chars is None else prompt_chars
    in_tok = (mean_bundle_chars + pc + len(json.dumps(SCHEMA))) / 4
    p_in, p_out = cfg['prices_usd_per_mtok'][model][tier]
    return dict(n=n, in_tokens_per_filing=in_tok, out_tokens_per_filing=mean_out_tokens,
                usd=n * (in_tok * p_in + mean_out_tokens * p_out) / 1e6)
