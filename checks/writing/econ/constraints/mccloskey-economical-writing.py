#!/usr/bin/env -S uv run python3
"""Constraint: mccloskey-economical-writing — detect word choices McCloskey marks as bad economics prose."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "constraints"))  # _writing: the contract, prose_extract
from _writing import main, prose, prose_extract
from _writing import rel as _rel

CONSTRAINT = "mccloskey-economical-writing"
SEVERITY = "soft"

# Vague nouns — prefer concrete alternatives
_VAGUE_NOUNS = [
    (r'\bthe\s+existence\s+of\b', "McCloskey: 'the existence of X' → just name X"),
    (r'\btime\s+frame\b', "McCloskey: 'time frame' → 'time' or 'period'"),
    (r'\b\w+\s+process\b', "McCloskey: 'X process' — delete 'process' (e.g., 'transition process' → 'transition')"),
    (r'\bthe\s+structure\s+of\b', "McCloskey: 'the structure of' — often meaningless; be specific"),
    (r'\bindividuals\b', "McCloskey: 'individuals' → 'people'"),
    # `agents` DELETED. writing-econ/SKILL.md:87 drops it under `### Dropped`: 1,728/M in the
    # finance corpus, where it names the modelled decision-maker — `people` is a different claim,
    # so the rule rewrote the model rather than the prose. This table is bound to --style econ.
]

# Pretentious verbs
_PRETENTIOUS_VERBS = [
    (r'\bimplement\b', "McCloskey: 'implement' — Washingtonese; use 'carry out', 'apply', 'do'"),
    # `hypothesize` DELETED. writing-econ/SKILL.md:88 drops it: 683/M in finance, naming a specific
    # move in an empirical paper with no plain-English synonym that keeps the meaning.
    (r'\bfinalize\b', "McCloskey: 'finalize' — boardroom talk; use 'finish' or 'complete'"),
    (r'\bcomprises?\b', "McCloskey: 'comprise' — fancy talk; use 'includes' or 'consists of'"),
    (r'\btry\s+and\b', "McCloskey: 'try and' → 'try to'"),
    (r'\bstate\s+(that|how|why|whether|what|who|when|where)\b',
     "McCloskey: 'state that' — overused for mere 'say'; use 'say', 'argue', 'show'"),
]

# Ersatz economics vocabulary (unironic use)
_ERSATZ_ECON = [
    (r'\bskyrocket(ing|ed|s)?\b', "McCloskey: 'skyrocketing' — popular press word, not economics prose"),
    (r'\bexorbitant\b', "McCloskey: 'exorbitant' — popular press; describe the price level specifically"),
    (r'\bgouging\b', "McCloskey: 'gouging' — popular press; state the market failure precisely"),
    (r'\bvicious\s+cycle\b|\bvicious\s+spiral\b',
     "McCloskey: 'vicious cycle/spiral' — popular press; model the mechanism"),
    (r'\bobscene\s+profit\b|\bunwarranted\s+margin\b',
     "McCloskey: 'obscene profits' — moral language; state the economic inefficiency"),
    (r'\bbargaining\s+power\b',
     "McCloskey: 'bargaining power' — vague; specify the source of market power"),
    (r'\bliving\s+wage\b',
     "McCloskey: 'living wage' — popular press term; be precise about wage levels"),
    (r'\bunfair\s+competition\b',
     "McCloskey: 'unfair competition' — popular press; specify the market practice"),
]

# Structural patterns McCloskey flags
_STRUCTURAL = [
    # "Not only...but also" — McCloskey: marks incompetence
    (r'\bnot\s+only\b.*\bbut\s+(also\s+)?\b',
     "McCloskey: 'not only...but also' — marks incompetence; English achieves coherence by repetition"),

    # Teutonism: long noun-string compounds (rough: 3+ nouns in sequence)
    (r'\b[A-Z]?[a-z]+\s+[a-z]+\s+[a-z]+\s+(process|adjustment|approach|framework|mechanism|model|structure|system|analysis|estimation|determination)\b',
     "McCloskey: possible Teutonism — long noun-string compound; try possessive or prepositional phrase"),
]


def check(context):
    """Returns list of violations. Empty list = pass."""
    cwd = Path(context.get("cwd", "."))
    violations = []
    draft_files = context["files"]  # the prose files handed in, wherever they lie

    if not draft_files:
        return violations

    all_patterns = _VAGUE_NOUNS + _PRETENTIOUS_VERBS + _ERSATZ_ECON + _STRUCTURAL

    for path in draft_files:
        try:

            line_iter = list(prose_extract.iter_lines(path))

        except OSError:

            continue
        rel = _rel(path, cwd)
        for i, line in line_iter:
            if line.strip().startswith("#"):
                continue  # skip headings
            for pattern, label in all_patterns:
                if re.search(pattern, line, re.IGNORECASE):
                    violations.append(f"{rel}:{i}: {label}")
    return violations


if __name__ == "__main__":
    raise SystemExit(main(CONSTRAINT, check, prose))
