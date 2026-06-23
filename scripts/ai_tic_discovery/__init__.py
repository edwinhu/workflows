"""AI-tic discovery & detection harness.

Semi-automates the elicit -> measure -> judge -> detect -> lock-in loop for
growing the regex rules in skills/ai-anti-patterns/. See
docs/investigations/ai-tic-discovery-harness.md for the methodology.

Modules:
  models    — copilot (GPT) + agy (Gemini) subprocess wrappers, output cleaning.
  elicit    — fan out context prompts over models, cache raw outputs.
  measure   — regex-tally base rate + cross-model agreement over the cache.
  judge     — judgment probe: "is this an AI tic? name the construction".
  evaluate  — precision/recall of a candidate regex (positives vs human negs).
  corpus    — human-writing control corpus loader (pre-2020 domain prose).

`evaluate` and `corpus` are pure-stdlib so the pytest battery can import them
without a `uv` environment. `models`/`elicit`/`measure`/`judge` need PyYAML and
are run via the `ai-tic-discovery.py` CLI (`uv run --with pyyaml`).
"""
