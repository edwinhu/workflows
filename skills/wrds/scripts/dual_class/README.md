# dual_class

Classifies whether a 10-K / 10-K405 / 10-KSB shows **dual-class common stock outstanding**, one proposition per filing,
Jev-shaped: a deterministic extractor cuts a small passage bundle, one model call answers the single question, and a labelled
calibration set must separate, per backend, before a bulk run is allowed. Three backends, **recommended default `hybrid`** (below). Reference with the measured extractor
validation: `../../references/dual-class.md`.

Definition (the one the 270 fixture labels use): **dual = two or more common classes outstanding with different votes per
share.** Non-voting vs voting counts; a class electing a fixed fraction of the board counts. Warrants, preferred, units,
equal-vote classes and authorized-but-unissued classes are single. Full text in `prompt.md`.

| file | role |
|---|---|
| `extract.py` | filing list → passage bundles (JSONL). Sources: `wrds` clean filings, `edgar` complete submissions, `local` copies |
| `sections.py` | the pure cutting rules R1–R6 (cover, Item 5, capital-stock / equity notes incl. EX-13, vote-phrase windows) |
| `rule_v3.py` | frozen deterministic classifier (md5 `f9aa198c…`), the free baseline; its verdict rides in every bundle |
| `classify.py` | `--backend gemini\|jev\|hybrid`: `dry-run`, `flex` (≤10), `batch` (gated), `collect`, `cost` |
| `jev.py` | the Jev backend: OpenRouter decisions endpoint, one `noul` question, P(dual); credit floor, spend cap, retries |
| `calibrate.py` | `prepare` / `submit` / `score` / `gate` for any backend; precision, recall, kappa with CIs |
| `schema.py`, `prompt.md`, `config.json` | Gemini response schema + validator, the prompt, models/project/prices/gate thresholds, Jev and hybrid settings |
| `fixtures/labels.csv` | 270 labelled filings (117 dual, 146 single, 7 unres) from jkl2 (30), jkl3 (120), jkl4 (120) |
| `tests/` | pytest, no network: `uv run --with pytest python -m pytest` from this directory |

## Backends

| backend | what runs | label | cost, 270 filings (measured) | per 8,794 (projected) |
|---|---|---|---|---|
| `gemini` | `gemini-3.5-flash-lite` on Vertex Batch (config `model`), structured output | `dual` of the answer; `unclear` = negative | $0.25 | $8.06 |
| `jev` | `typesafe/jev-1.13` via OpenRouter, one `noul` question, `--max-spend` required | P(yes) ≥ 0.5 (config `jev.threshold`) | $0.05 | $1.64 |
| `hybrid` (default) | Jev on every row, then `gemini-3.8-flash` thinking LOW (config `hybrid`) only on rows with 0.2 ≤ P < 0.8 | Gemini's inside the band, Jev's outside | $0.10 (Jev $0.05 + Gemini on 22 rows $0.05) | ≈ $3.3 |

Jev returns a probability only: its rows have no class table or evidence quote (`quote_verified` null), so the Gemini quote check applies
only to rows whose label came from Gemini. Hybrid keeps Jev's `p_yes` on every row and records `backend_used` (`jev` or `gemini`) for the
row's label. A band row whose Gemini call fails stays an error row (counted failed); it is never replaced by Jev's label. The Jev
question text (`jev.QUESTION`, sha256 in the fingerprint) is the same dual definition as `prompt.md`. Key: `$WORK_HOLD_JUDGE_TOKEN`, else
`$XDG_RUNTIME_DIR/agenix/openrouter-api-key`; never printed or stored. `--max-spend USD` is required for `jev` and `hybrid` (cap on Jev spend
for the run); the run aborts before any call when OpenRouter credits remaining are below `--abort-floor` (config `jev.abort_floor_usd`, 10),
and stops on a 402. Concurrency is 8 threads; 429/5xx back off up to 6 tries. Re-running a Jev pass skips rows already in
`jev_results.jsonl` (same model, question hash, threshold), so it costs nothing and rewrites the same file. Two identical Jev passes over
the 270 bundles differed in `p_yes` on 115 rows (max 0.14, mean 0.008) with the same labels and the same band rows; Jev is not exactly
reproducible, so a stored `jev_results.jsonl` is the record, not a re-run.

Measured head-to-head and the calibration of each backend are in `../../references/dual-class.md`.

## Commands

Environment: stdlib for everything except live Gemini calls, which need `google-genai`
(`uv run --with google-genai python classify.py …`). ADC must be live (`gcloud auth application-default login`);
`classify.py` removes `GOOGLE_API_KEY` / `GEMINI_API_KEY` from its environment and always builds a `vertexai=True` client.
Batch jobs carry the join id as a scalar top-level `request_id` string; Vertex Batch rejects a nested `metadata` object
(`code=3 … column "metadata" … unsupported type`, job FAILED with no output), which the first version emitted.

```bash
# 1. bundles. EDGAR needs SEC_USER_AGENT="Name email" (E7: 6 req/s, hard ceiling 8, SEC ceiling 10).
python3 extract.py --filings filings.csv --source edgar --out run/bundles.jsonl      # columns: accession[,cik] or path
python3 extract.py --filings filings.csv --source wrds  --out run/bundles.jsonl      # on the WRDS grid; needs cik

# 2. free preview: requests + token and cost estimate, no network
python3 classify.py dry-run --bundles run/bundles.jsonl

# 3a. <=10 filings: synchronous Cloud Flex PayGo, one call per filing
uv run --with google-genai python classify.py flex --bundles run/bundles.jsonl --run-dir run

# 3b. >10 filings: calibrate once per backend, then run. B = gemini | jev | hybrid (default hybrid)
python3 calibrate.py prepare --run-dir runs/hyb --source edgar                      # extracts the 270 labelled filings (free)
uv run --with google-genai python calibrate.py submit --run-dir runs/hyb --backend hybrid --max-spend 0.20   # PAID, gate bypassed
uv run --with google-genai python classify.py collect --run-dir runs/hyb            # gemini + hybrid only: waits, downloads, merges
python3 calibrate.py score --run-dir runs/hyb                                       # writes runs/hyb/calibration.json (backend read from the rows)
python3 calibrate.py gate --runs-dir runs --backend hybrid                          # exit 0 open, 4 closed
uv run --with google-genai python classify.py batch --backend hybrid --max-spend 5 --bundles run/bundles.jsonl --run-dir runs/full1 --runs-dir runs
uv run --with google-genai python classify.py collect --run-dir runs/full1          # not needed for --backend jev (results.jsonl is written at once)
```

`--backend jev` needs no Google credentials and no `collect`. Hybrid `flex` (≤10 filings) runs the band rows through Flex instead of Batch.

Output rows (`results.jsonl`, sorted by `filing_id`): `backend`, `run_config`, `p_yes` (Jev probability; null for `gemini`),
`backend_used` (who produced the label), `status` ok|error, `finish_reason`, `usage`, `parsed`
(`dual` "true"|"false"|"unclear", `classes[{name, votes_per_share, shares_outstanding}]`, `evidence_quote`, `location`),
`problems`, `quote_verified` (quote found verbatim in the bundle). A `dual: "true"` row whose quote is not verbatim is kept and
flagged; filter on `quote_verified` before relying on it.

## The gate

`classify.py batch` refuses to run (exit 4, before any upload or Jev spend) unless the **newest** `<runs-dir>/*/calibration.json`
of that backend (by its `scored_at`) was produced under the same fingerprint, scored at least `gate.min_scored` (100) labelled filings,
and has precision ≥ 0.9 and recall ≥ 0.9 on point estimates. The fingerprint holds: backend, Gemini model and thinking level, Jev model,
sha256 of the Jev question text, Jev threshold, hybrid band, and the sha256 of `prompt.md`, the response schema and `fixtures/labels.csv`
(fields a backend does not use are null: a Jev calibration ignores the prompt, a Gemini one ignores the threshold). Editing the prompt
or question, switching a model, changing the threshold or band, or changing the labels closes that backend's gate until a new
calibration is scored. Backends gate independently. `score` also refuses result rows stamped with a different `run_config`. The calibration file is the only state; a gated batch copies the one it was released on to
`<run-dir>/calibration_used.json`. `--calibrating` skips the gate only for filings present in `labels.csv`.

Scoring: gold dual = positive, single = negative, `unres` excluded and counted. Predicted positive = `dual: "true"`;
`unclear`, an error row or a missing row is negative and reported separately (`n_unclear`, `n_failed_or_missing`), so abstaining
cannot raise precision unseen. Precision, recall and accuracy carry Wilson 95% CIs; kappa is binary Cohen's kappa with a
bootstrap percentile 95% CI over filings (seed 0, 2000 draws). The `rule_v3` baseline is scored on the same rows. The count of
`dual=true` rows and how many have a verbatim quote is printed next to the rates, because a quote-only check rewards a model
that claims nothing. A second-labeller set can be added by appending rows to `labels.csv` (new `source_set`); doing so changes
its hash and closes the gate until the next calibration.

## Cost

```
tokens_in  = (bundle_chars + len(prompt.md) + len(json(schema))) / 4          # per filing
usd        = n * (tokens_in * p_in + tokens_out * p_out) / 1e6                 # prices per 1M tokens in config.json
```

`gemini-3.5-flash-lite` (the `gemini` backend; cheapest Flash in `gemini-vertex/references/models-and-pricing.md`): Batch and Flex
$0.15 in / $1.25 out per 1M; Standard $0.30 / $2.50. `python3 classify.py cost --bundles …` prints all three tiers. Inputs:
bundle mean 13,848 chars over the 8,794 jkl6 extracts (p95 24,849, max 36,095; 14,066 on the 240 labelled), plus ≈ 300 chars of
section markers, prompt 3.2k chars, schema ≈ 1k chars; output ≈ 234 tokens. Measured on one live Flex call (Ford FY1996): 5,005
prompt tokens against 4,679 predicted by the formula (+7%), 234 output tokens, no thinking tokens. Estimates at Batch prices:
estimate 270 filings ≈ $0.27, 9,000 ≈ $8.67 (≈ $9.10); measured on the 270 calibration filings: $0.248 (1,372,065 prompt / 34,006 output
tokens, 126 output tokens per filing, 8,794 filings ≈ $8.06). Excludes GCS storage and egress. Jev: ≈ $0.0002 per filing
(`usage.cost` summed over calls; $0.0509 for 270). Hybrid = Jev on all + Gemini 3.8 Flash on the band (8.1% of the 270, 9.6% in the
6c sample): $0.103 for 270, ≈ $3.3 projected for 8,794. `python3 classify.py cost --backend B …` and `dry-run` print the estimate.

## Limitations

- **1994–96 coverage.** EDGAR phase-in leaves early filers without electronic annual reports, and WRDS `wrds_forms` is missing 80 of
  8,794 sampled accessions (79 in 1995, 1 in 1996; 99.1% present overall). A filing that cannot be fetched becomes an error row
  (exit 3), never a silent drop.
- **Incorporation by reference.** Many 1990s 10-Ks answer Item 5 and the capital-stock note by reference to the annual report to
  shareholders (EX-13) or the proxy statement. EX-13 is searched when filed with the 10-K; an annual report or proxy that was
  never filed with it is not in the bundle. Those filings come back `unclear` (the prompt says so) or fall to the cover-page
  evidence alone; they are not recoverable without another filing.
- **Cover is not the whole truth.** Two classes on the cover with no vote terms anywhere in the bundle is `unclear`, not dual.
- **Hybrid band was found in-sample.** [0.2, 0.8) was examined on the 270 gold filings, then scored on the same filings; the result was
  the same for [0.3, 0.8) and [0.4, 0.85), but no held-out set has confirmed it.
- **Section rules are heuristic.** Heading-based cutting finds Item 5 in most but not all filings (see the reference doc for
  measured coverage); a missed section is marked in the bundle, not skipped.
- **WRDS clean files** drop HTML and images but keep EX-13; they are readable only from the WRDS grid. The item-parse tables
  (`wrdssec_premium`) are not accessible to our account and carry no offsets anyway.
- **Labels.** The 270 labels come from three single-reader passes on the first 400 KB of each filing; jkl2's British Telecom row
  is labelled dual without per-share votes verified. They measure agreement with that reading, not with a second labeller.
- **Flex tier** is Preview, global only, and sheds load at peak; a 400 (recitation refusal) is recorded per row and the loop continues.
