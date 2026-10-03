"""R1: every random draw is seeded. Calibrated 2026-10-02, two runs: vio2 0.97, sat2 <=0.04, real run_s220 <=0.03."""
import re

from _common import render_json
from _ds import MAX_ITEMS, clip, is_py, py_files, sources, split_comments

PROPOSITION = ('A fresh re-run would NOT reproduce the result: the code makes at least one random draw '
               '(sampling, shuffling, a train/test split, bootstrap, simulation, a randomized estimator) '
               'with no seed fixed for it -- neither a seed/random_state argument on the call nor a seed set '
               'earlier in the same file. In the state, that is a random draw with seeded false.')

CRITERIA = {
    'VIOLATED': 'some random draw has no seed fixed for it',
    'SATISFIED': 'every random draw is seeded, by argument or by a seed set before it',
    'NOT_APPLICABLE': 'the code makes no random draw',
    'INSUFFICIENT_EVIDENCE': 'the state does not show enough to settle it',
}
SPANS = ('random_draws',)
# what the inventory read, whole-file: 0 over a covered file is UNAVAILABLE, never MET (rule-check.ts)
EXAMINED = 'n_lines_searched'

DRAW = re.compile(r'\bnp\.random\.(?!seed|default_rng|RandomState|Generator)\w+\(|\brandom\.(?!seed)\w+\(|'
                  r'\brng\.\w+\(|\.sample\(|\.shuffle\(|\bshuffle\(|train_test_split\(|\bKFold\(|'
                  r'RandomForest\w*\(|\bKMeans\(|\bbootstrap\w*\(|\bresample\(|permutation\w*\(|'
                  r'torch\.(rand\w*|randperm)\(')
GLOBAL_SEED = re.compile(r'\b(np\.random\.seed|random\.seed|torch\.manual_seed|set_seed|pl\.set_random_seed|'
                         r'seed_everything)\s*\(\s*[^)\s]|default_rng\(\s*[^)\s]|RandomState\(\s*[^)\s]')
CALL_SEED = re.compile(r'\b(seed|random_state|rng|generator)\s*=\s*[^,)\s]')
UNSEEDED_RNG = re.compile(r'default_rng\(\s*\)|RandomState\(\s*\)')


def evidence(files, plan_lines=None):
    draws, seeds, n_lines = [], [], 0
    for rel, lines in sources(files):
        if not is_py(rel):
            continue
        n_lines += len(lines)
        code, _ = split_comments(lines)
        seeded_from = None
        for n, t in enumerate(code, 1):
            if GLOBAL_SEED.search(t):
                seeds.append({'file': rel, 'line': n, 'text': clip(lines[n - 1])})
                seeded_from = seeded_from or n
            if UNSEEDED_RNG.search(t):
                seeds.append({'file': rel, 'line': n, 'text': clip(lines[n - 1]), 'unseeded': True})
            if DRAW.search(t):
                by_arg = bool(CALL_SEED.search(t))
                draws.append({'file': rel, 'line': n, 'text': clip(lines[n - 1]),
                              'seed_argument': by_arg,
                              'seed_set_earlier_in_file': seeded_from is not None and seeded_from < n,
                              'seeded': by_arg or (seeded_from is not None and seeded_from < n)})
    draws.sort(key=lambda d: d['seeded'])
    inventory = {
        'random_draws_note': ('a draw is a call that consumes randomness; seeded = a seed/random_state '
                              'argument on that call, or a fixed seed (np.random.seed(k), default_rng(k), '
                              'random.seed(k)) earlier in the file'),
        'random_draws': draws[:MAX_ITEMS],
        'seed_sites': seeds[:MAX_ITEMS],
        'n_random_draws': len(draws),
        'n_lines_searched': n_lines,
        'n_unseeded_draws': sum(not d['seeded'] for d in draws),
    }
    return render_json('R1', py_files(files), inventory, [])
