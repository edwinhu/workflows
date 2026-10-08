# dual_class

Classifies whether a 10-K / 10-K405 / 10-KSB shows **dual-class common stock outstanding**, one proposition per filing,
Jev-shaped: a deterministic extractor cuts a small passage bundle, one structured-output model call answers the single
question, and a labelled calibration set must separate before a bulk run is allowed. Reference with the measured extractor
validation: `../../references/dual-class.md`.

Definition (the one the 270 fixture labels use): **dual = two or more common classes outstanding with different votes per
share.** Non-voting vs voting counts; a class electing a fixed fraction of the board counts. Warrants, preferred, units,
equal-vote classes and authorized-but-unissued classes are single. Full text in `prompt.md`.

| file | role |
|---|---|
| `extract.py` | filing list → passage bundles (JSONL). Sources: `wrds` clean filings, `edgar` complete submissions, `local` copies |
| `sections.py` | the pure cutting rules R1–R6 (cover, Item 5, capital-stock / equity notes incl. EX-13, vote-phrase windows) |
| `rule_v3.py` | frozen deterministic classifier (md5 `f9aa198c…`), the free baseline; its verdict rides in every bundle |
| `classify.py` | Gemini on Vertex: `dry-run`, `flex` (≤10), `batch` (GCS JSONL, gated), `collect`, `cost` |
| `calibrate.py` | `prepare` / `submit` / `score` / `gate`; precision, recall, kappa with CIs |
| `schema.py`, `prompt.md`, `config.json` | response schema + validator, the prompt, model/project/prices/gate thresholds |
| `fixtures/labels.csv` | 270 labelled filings (117 dual, 146 single, 7 unres) from jkl2 (30), jkl3 (120), jkl4 (120) |
| `tests/` | pytest, no network: `uv run --with pytest python -m pytest` from this directory |

## Commands

Environment: stdlib for everything except live Gemini calls, which need `google-genai`
(`uv run --with google-genai python classify.py …`). ADC must be live (`gcloud auth application-default login`);
`classify.py` removes `GOOGLE_API_KEY` / `GEMINI_API_KEY` from its environment and always builds a `vertexai=True` client.

```bash
# 1. bundles. EDGAR needs SEC_USER_AGENT="Name email" (E7: 6 req/s, hard ceiling 8, SEC ceiling 10).
python3 extract.py --filings filings.csv --source edgar --out run/bundles.jsonl      # columns: accession[,cik] or path
python3 extract.py --filings filings.csv --source wrds  --out run/bundles.jsonl      # on the WRDS grid; needs cik

# 2. free preview: requests + token and cost estimate, no network
python3 classify.py dry-run --bundles run/bundles.jsonl

# 3a. <=10 filings: synchronous Cloud Flex PayGo, one call per filing
uv run --with google-genai python classify.py flex --bundles run/bundles.jsonl --run-dir run

# 3b. >10 filings: calibrate once per (model, prompt, schema, labels), then batch
python3 calibrate.py prepare --run-dir runs/cal1 --source edgar          # extracts the 270 labelled filings (free)
uv run --with google-genai python calibrate.py submit --run-dir runs/cal1   # PAID batch, gate bypassed, fixtures only
uv run --with google-genai python classify.py collect --run-dir runs/cal1   # waits, downloads, reconciles ids
python3 calibrate.py score --run-dir runs/cal1                              # writes runs/cal1/calibration.json
python3 calibrate.py gate --runs-dir runs                                   # exit 0 open, 4 closed
uv run --with google-genai python classify.py batch --bundles run/bundles.jsonl --run-dir runs/full1 --runs-dir runs
uv run --with google-genai python classify.py collect --run-dir runs/full1
```

Output rows (`results.jsonl`, sorted by `filing_id`): `status` ok|error, `finish_reason`, `usage`, `parsed`
(`dual` "true"|"false"|"unclear", `classes[{name, votes_per_share, shares_outstanding}]`, `evidence_quote`, `location`),
`problems`, `quote_verified` (quote found verbatim in the bundle). A `dual: "true"` row whose quote is not verbatim is kept and
flagged; filter on `quote_verified` before relying on it.

## The gate

`classify.py batch` refuses to run (exit 4, nothing uploaded) unless the **newest** `<runs-dir>/*/calibration.json`
(by its `scored_at`) was produced for the same model, `prompt.md`, response schema and `fixtures/labels.csv` (sha256 of each)
as the current config, scored at least `gate.min_scored` (100) labelled filings, and has precision ≥ 0.9 and recall ≥ 0.9 on
point estimates. Editing the prompt, switching the model or changing the labels closes the gate until a new calibration is
scored. The calibration file is the only state; a gated batch copies the one it was released on to
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

`gemini-3.5-flash-lite` (default; cheapest Flash in `gemini-vertex/references/models-and-pricing.md`): Batch and Flex
$0.15 in / $1.25 out per 1M; Standard $0.30 / $2.50. `python3 classify.py cost --bundles …` prints all three tiers. Inputs:
bundle mean 13,848 chars over the 8,794 jkl6 extracts (p95 24,849, max 36,095; 14,066 on the 240 labelled), plus ≈ 300 chars of
section markers, prompt 3.2k chars, schema ≈ 1k chars; output ≈ 234 tokens. Measured on one live Flex call (Ford FY1996): 5,005
prompt tokens against 4,679 predicted by the formula (+7%), 234 output tokens, no thinking tokens. Estimates at Batch prices:
270-filing calibration ≈ $0.26 (≈ $0.27 with the +7%); 9,000 filings ≈ $8.67 (≈ $9.10). Excludes GCS storage and egress.
`gemini-3.8-flash` roughly doubles it (≈ $19 for 9,000 at 2026 Batch prices) and needs its own calibration.

## Limitations

- **1994–96 coverage.** EDGAR phase-in leaves early filers without electronic annual reports, and WRDS `wrds_forms` is missing 80 of
  8,794 sampled accessions (79 in 1995, 1 in 1996; 99.1% present overall). A filing that cannot be fetched becomes an error row
  (exit 3), never a silent drop.
- **Incorporation by reference.** Many 1990s 10-Ks answer Item 5 and the capital-stock note by reference to the annual report to
  shareholders (EX-13) or the proxy statement. EX-13 is searched when filed with the 10-K; an annual report or proxy that was
  never filed with it is not in the bundle. Those filings come back `unclear` (the prompt says so) or fall to the cover-page
  evidence alone; they are not recoverable without another filing.
- **Cover is not the whole truth.** Two classes on the cover with no vote terms anywhere in the bundle is `unclear`, not dual.
- **Section rules are heuristic.** Heading-based cutting finds Item 5 in most but not all filings (see the reference doc for
  measured coverage); a missed section is marked in the bundle, not skipped.
- **WRDS clean files** drop HTML and images but keep EX-13; they are readable only from the WRDS grid. The item-parse tables
  (`wrdssec_premium`) are not accessible to our account and carry no offsets anyway.
- **Labels.** The 270 labels come from three single-reader passes on the first 400 KB of each filing; jkl2's British Telecom row
  is labelled dual without per-share votes verified. They measure agreement with that reading, not with a second labeller.
- **Flex tier** is Preview, global only, and sheds load at peak; a 400 (recitation refusal) is recorded per row and the loop continues.
