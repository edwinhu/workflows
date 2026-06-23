# AI-tic discovery & detection harness

Semi-automates DISCOVERY and DETECTION of AI writing tics, to systematically
grow and validate the regex rules in `skills/ai-anti-patterns/`. It does **not**
fork `prose-lint.py` — confirmed tics land as `(regex, label)` tuples in the
existing `_*_PATTERNS` tables, exactly as before. This is the tooling that
*feeds* that pipeline with data-justified candidates.

## The loop

```
ELICIT  → prompt copilot (GPT) + agy (Gemini) for text in a context, cache raw output
MEASURE → tally a candidate regex's hit-rate + CROSS-MODEL agreement over the cache
JUDGE   → ask the models "is this an AI tic? name the construction"
EVAL    → precision/recall vs (mined positives) + (human-writing negatives corpus)
FP-HUNT → run a proposed regex against the human corpus alone; report every hit
LOCK-IN → paste regex+label into the right _*_PATTERNS table + add a pytest case (SOFT)
```

## CLI

```bash
scripts/ai-tic-discovery.py elicit  --context oped_closer --n 6
scripts/ai-tic-discovery.py measure --candidate <id> --show 30
scripts/ai-tic-discovery.py judge   --candidate <id>
scripts/ai-tic-discovery.py eval    --candidate <id>
scripts/ai-tic-discovery.py fp-hunt --candidate <id>     # or --regex '<pattern>'
scripts/ai-tic-discovery.py corpus
```

Run via `uv run --with pyyaml python3 scripts/ai-tic-discovery.py …` (the
shebang already does this).

## Config (git-tracked, reproducible)

- `contexts/contexts.yaml` — elicitation contexts `{id, prompt, n_samples}`.
- `contexts/candidates.yaml` — candidate patterns `{id, regex, label, context_ids}`.

## Modules

| module | role | deps |
|---|---|---|
| `models.py` | copilot/agy subprocess wrappers; ANSI + footer cleaning; graceful rate-limit/timeout | stdlib |
| `elicit.py` | fan out prompts × models × N, cache to `scratch/ai-tics/cache/` (idempotent) | stdlib |
| `measure.py` | base-rate tally + cross-model agreement; mine matching lines | stdlib |
| `judge.py` | judgment probe, cached verdicts | stdlib |
| `evaluate.py` | `evaluate_regex(pattern, positives, negatives)` — mirrors prose-lint flags | **stdlib (pytest-importable)** |
| `corpus.py` | human negatives loader (`corpus/human/*.txt`) | **stdlib (pytest-importable)** |
| `build_corpus.py` | PDF → text corpus builder (pre-2020 domain articles) | pymupdf4llm |

`evaluate.py` and `corpus.py` are stdlib-only so the pytest battery can import
them without a `uv` env. The rest run via the CLI.

## Discipline

- New rules are **conservative** (a SCHEMA, not a fixed phrase), **soft**, and
  **data-justified** (cross-model base rate + judgment), and ship with
  **0 false positives** on the human corpus.
- The human corpus is genuine pre-LLM, genre-matched prose — see
  `corpus/README.md`. It is the ship gate: a rule that hits real scholarship
  doesn't ship.

First worked example: `docs/investigations/2026-06-22_false-unity-closer.md`.
