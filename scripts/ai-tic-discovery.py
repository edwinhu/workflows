#!/usr/bin/env -S uv run --with pyyaml python3
"""AI-tic discovery & detection harness — CLI.

Semi-automates growing the regex rules in skills/ai-anti-patterns/ via the
validated loop: ELICIT model text in a context -> MEASURE a candidate's base
rate + cross-model agreement -> JUDGE whether it reads as a tic -> EVAL a
candidate regex's precision/recall against mined positives + a human negatives
corpus -> FP-HUNT the regex against the whole human corpus before shipping.

Subcommands:
  elicit    Run context prompts over copilot+agy, cache raw outputs.
  measure   Tally a candidate regex's hit-rate (+ cross-model agreement) over cache.
  judge     Ask the models whether example sentences read as AI tics.
  eval      Precision/recall of a candidate regex: positives (cache) vs human corpus.
  fp-hunt   Run a regex against the human corpus alone; list every hit.
  corpus    Show human-corpus stats.

Configs (git-tracked, reproducible):
  contexts/contexts.yaml     elicitation contexts {id, prompt, n_samples}
  contexts/candidates.yaml   candidate patterns {id, regex, label, context_ids}

Examples:
  ./ai-tic-discovery.py elicit --context oped_closer --n 6
  ./ai-tic-discovery.py measure --candidate whether_universal_lesson
  ./ai-tic-discovery.py eval --candidate whether_universal_lesson
  ./ai-tic-discovery.py fp-hunt --regex '\\bWhether\\b.*\\bthe\\s+lesson\\b'
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS_DIR))

from ai_tic_discovery import elicit as _elicit  # noqa: E402
from ai_tic_discovery import judge as _judge  # noqa: E402
from ai_tic_discovery import measure as _measure  # noqa: E402
from ai_tic_discovery import corpus as _corpus  # noqa: E402
from ai_tic_discovery.evaluate import evaluate_regex  # noqa: E402

REPO_ROOT = SCRIPTS_DIR.parent
CONTEXTS_FILE = REPO_ROOT / "contexts" / "contexts.yaml"
CANDIDATES_FILE = REPO_ROOT / "contexts" / "candidates.yaml"


def _load_yaml(path: Path):
    import yaml
    if not path.exists():
        return []
    return yaml.safe_load(path.read_text(encoding="utf-8")) or []


def _contexts():
    return {c["id"]: c for c in _load_yaml(CONTEXTS_FILE)}


def _candidates():
    return {c["id"]: c for c in _load_yaml(CANDIDATES_FILE)}


def _resolve_candidate(args):
    """Return (regex, label, context_ids) from --candidate id or --regex."""
    if args.regex:
        return args.regex, args.label or "(ad-hoc)", None
    cand = _candidates().get(args.candidate)
    if not cand:
        sys.exit(f"unknown candidate {args.candidate!r}; see {CANDIDATES_FILE}")
    return cand["regex"], cand.get("label", cand["id"]), cand.get("context_ids")


def _samples_for(context_ids):
    """Load cached samples for the given context ids (or all if None)."""
    ids = context_ids or list(_contexts())
    out = []
    for cid in ids:
        out.extend(_elicit.load_samples(cid))
    return out


# ── subcommands ────────────────────────────────────────────────────────────

def cmd_elicit(args):
    ctxs = _contexts()
    targets = [args.context] if args.context else list(ctxs)
    for cid in targets:
        c = ctxs.get(cid)
        if not c:
            print(f"!! unknown context {cid!r}", file=sys.stderr)
            continue
        n = args.n or c.get("n_samples", 5)
        print(f"== elicit {cid} (n={n} per model) ==")
        _elicit.elicit_context(cid, c["prompt"], n,
                               refresh=args.refresh, timeout=args.timeout)


def cmd_measure(args):
    regex, label, ctx_ids = _resolve_candidate(args)
    samples = _samples_for(ctx_ids)
    if not samples:
        sys.exit("no cached samples — run `elicit` first")
    r = _measure.measure_pattern(samples, regex)
    print(f"candidate: {label}\nregex: {regex}\n")
    for model, c in r["per_model"].items():
        print(f"  {model:10s} {c['hits']:>3}/{c['total']:<3} ({c['rate']:.0%})")
    o = r["overall"]
    print(f"  {'OVERALL':10s} {o['hits']:>3}/{o['total']:<3} ({o['rate']:.0%})")
    print(f"\ncross-model agreement: {r['cross_model_agreement']} "
          f"(models hit: {', '.join(r['models_hit']) or 'none'})")
    if args.show:
        print("\nmatching lines:")
        for cid, model, line in _measure.matching_lines(samples, regex, args.show):
            print(f"  [{model}/{cid}] {line}")


def cmd_judge(args):
    if args.example:
        examples = [args.example]
    else:
        regex, _, ctx_ids = _resolve_candidate(args)
        examples = [ln for _, _, ln in
                    _measure.matching_lines(_samples_for(ctx_ids), regex,
                                            args.max or 10)]
    if not examples:
        sys.exit("no examples to judge")
    for ex in examples:
        v = _judge.judge_example(ex, refresh=args.refresh)
        cons = v.pop("_consensus")
        print(f"\n• {ex}")
        for model, d in v.items():
            print(f"    {model:10s} {d.get('verdict') or d.get('error')}"
                  f"  — {d.get('name') or ''}")
        print(f"    consensus: {cons['ai_tic_votes']}/{cons['n_models']} AI-TIC")


def _positives_for(regex, ctx_ids, limit):
    """Mine positives: lines from cache that match the candidate regex."""
    return [ln for _, _, ln in
            _measure.matching_lines(_samples_for(ctx_ids), regex, limit)]


def cmd_eval(args):
    regex, label, ctx_ids = _resolve_candidate(args)
    positives = _positives_for(regex, ctx_ids, args.max_pos)
    if not positives and not args.positives_file:
        sys.exit("no positives — run `elicit`/`measure` first, or pass "
                 "--positives-file")
    if args.positives_file:
        positives += [l.strip() for l in
                      Path(args.positives_file).read_text().splitlines()
                      if l.strip()]
    negatives = _corpus.load_negatives()
    if not negatives:
        print("WARN: human corpus empty — FP side is untested "
              "(populate corpus/human/*.txt)", file=sys.stderr)
    res = evaluate_regex(regex, positives, negatives)
    print(f"candidate: {label}\nregex: {regex}\n")
    print(res.summary())
    if res.fp_examples:
        print("\nFALSE POSITIVES (human prose the rule wrongly flags):")
        for s in res.fp_examples:
            print(f"  ✗ {s}")
    if res.fn_examples and args.show_fn:
        print("\nmissed positives:")
        for s in res.fn_examples:
            print(f"  · {s}")
    sys.exit(0 if res.ship_ready else 1)


def cmd_fp_hunt(args):
    regex = args.regex
    if not regex:
        regex, _, _ = _resolve_candidate(args)
    rx = re.compile(regex, re.IGNORECASE | re.MULTILINE)
    hits = 0
    for name, sent in _corpus.iter_sentences():
        if rx.search(sent):
            hits += 1
            print(f"  [{name}] {sent}")
    stats = _corpus.corpus_stats()
    print(f"\n{hits} hit(s) across {stats['sentences']} human sentences "
          f"in {stats['files']} files.", file=sys.stderr)
    sys.exit(1 if hits else 0)


def cmd_corpus(args):
    s = _corpus.corpus_stats()
    print(f"human corpus: {s['files']} files, {s['sentences']} sentences, "
          f"{s['chars']:,} chars")
    for f in _corpus.corpus_files():
        print(f"  {f.name}")


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    pe = sub.add_parser("elicit", help="run context prompts over models")
    pe.add_argument("--context", help="single context id (default: all)")
    pe.add_argument("--n", type=int, help="samples per model")
    pe.add_argument("--refresh", action="store_true", help="ignore cache")
    pe.add_argument("--timeout", type=int, default=180)
    pe.set_defaults(func=cmd_elicit)

    def add_candidate_args(sp):
        sp.add_argument("--candidate", help="candidate id from candidates.yaml")
        sp.add_argument("--regex", help="ad-hoc regex (overrides --candidate)")
        sp.add_argument("--label", help="label for an ad-hoc regex")

    pm = sub.add_parser("measure", help="tally a candidate's base rate")
    add_candidate_args(pm)
    pm.add_argument("--show", type=int, default=0, help="show N matching lines")
    pm.set_defaults(func=cmd_measure)

    pj = sub.add_parser("judge", help="ask models whether examples are AI tics")
    add_candidate_args(pj)
    pj.add_argument("--example", help="judge a single literal sentence")
    pj.add_argument("--max", type=int, help="max mined examples to judge")
    pj.add_argument("--refresh", action="store_true")
    pj.set_defaults(func=cmd_judge)

    pv = sub.add_parser("eval", help="precision/recall vs human corpus")
    add_candidate_args(pv)
    pv.add_argument("--positives-file", help="extra positives, one per line")
    pv.add_argument("--max-pos", type=int, default=200)
    pv.add_argument("--show-fn", action="store_true", help="show missed positives")
    pv.set_defaults(func=cmd_eval)

    pf = sub.add_parser("fp-hunt", help="run a regex against the human corpus")
    add_candidate_args(pf)
    pf.set_defaults(func=cmd_fp_hunt)

    pc = sub.add_parser("corpus", help="human-corpus stats")
    pc.set_defaults(func=cmd_corpus)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
