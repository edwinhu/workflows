# Dual-class common stock from 10-K text

Package: `scripts/dual_class/` (README there has commands, the gate and the cost formula). One proposition per filing: **two or
more common classes outstanding with different votes per share** (non-voting vs voting counts; a class electing a fixed fraction of
the board counts; warrants, preferred, units, equal-vote classes and authorized-but-unissued classes are single). Built after five
labelling/classifier rounds on the JKL16 dual-class list (hidden-figures `scratch/borderline3`, reports jkl2–jkl6).

## Pipeline

1. **Extract** (`extract.py`, `sections.py`): complete submission → passage bundle of ~14k chars (~3.5k tokens): cover page, Item 5,
   up to three capital-stock / equity notes (main document after Item 8, and EX-13), and 600-char windows around voting phrases
   (main, EX-13, EX-3). Absent sections are marked in the bundle text, never skipped. Sources: `wrds` clean filings, `edgar`
   complete submissions, `local` copies. Output is JSONL, one row per input filing, sorted, with the `rule_v3` verdict attached.
2. **Classify** (`classify.py --backend gemini|jev|hybrid`, `jev.py`, `prompt.md`). `gemini`: Gemini on Vertex with a response schema
   `{dual: "true"|"false"|"unclear", classes[{name, votes_per_share, shares_outstanding}], evidence_quote, location}`; Flex for ≤10
   filings, Batch beyond; model `gemini-3.5-flash-lite` (cheapest listed Flash, `gemini-vertex/references/models-and-pricing.md`).
   `jev`: `typesafe/jev-1.13` through the OpenRouter decisions endpoint, one `noul` question, P(dual). `hybrid` (**recommended
   default**): Jev on every row; Gemini 3.8 Flash (thinking LOW) only on rows with 0.2 ≤ P < 0.8; the label is Gemini's inside the band
   and Jev's outside. Costs and the head-to-head are below.
3. **Calibrate** (`calibrate.py`, `fixtures/labels.csv`, or `--labels PATH`): precision / recall / kappa on 270 labels; **a full batch is refused
   until the newest calibration of that backend, under the same backend / models / thinking level / Jev question hash / threshold /
   band / prompt / schema / labels, has precision ≥ 0.9 and recall ≥ 0.9**.

`rule_v3.py` is the free baseline: the deterministic cover-passage classifier frozen in jkl4 (md5
`f9aa198cede864761403a174ac251349`, byte-identical copy; a test pins the hash). It is run on the whole submission, which is
the "re-extract from the full filing" path of its spec.

## WRDS clean filings

Path: `/wrds/sec/wrds_clean_filings/<first 6 chars of the 10-digit zero-padded CIK>/<cik unpadded>/<accession>.txt`
(Ford 37996 → `000003/37996/`; Comcast 1166691 → `000116/1166691/`). `wrdssec_all.wrds_forms.wrdsfname` gives the same relative path
and is the join from accession. The clean file keeps the SGML envelope, Item headings and EX-13, drops HTML, images and the PEM
wrapper. Readable from the WRDS grid only. The itemised tables `wrdssec_premium` / `sec_item_*` are permission-denied for our account
and hold no character offsets in any case, so section boundaries come from our regex. Probe: hidden-figures
`scratch/borderline3/report_wrdsclean.md` (7 files; 8,714 of 8,794 sampled accessions, 99.1%, exist in `wrds_forms`; the 80 missing are
79 from 1995 and 1 from 1996).

Checked on this package: the 7 probe files give cover and Item 5 found 7/7, and the Ford FY1996 bundle built from the clean file is
**identical** (text and `rule_v3` verdict) to the one built from the EDGAR complete submission.

## Extractor validation (jkl6, measured 2026-10-08; the rules in `sections.py` are the ones measured)

Run over 8,794 filings (FY1994–2011; 3,652 reused from cache, 5,142 fetched from EDGAR, 0 fetch failures, 13.1 min).
Section-found rates (denominator 8,794): cover (Item 1 heading found) 0.953; Item 5 0.916; ≥1 capital-stock note 0.748; ≥1 vote
window 0.599; ≥1 *strong* vote phrase 0.435; filing has EX-13 0.126. By form: 10-K 6,807, 10-K405 1,351, 10KSB 539, 10KSB40 97.
Item 5 found: 0.857 in FY1994, 0.912 in FY1996, 0.965 in FY2010. 737 filings have no Item 5 found, 414 no Item 1 heading, 57 have
only a cover segment. Bundle size (chars/4): mean 3,462 tokens, p50 3,243, p95 6,214, p99 7,511, max 9,024.

Containment of the labeller's quote in the extract, 240 labelled filings (jkl3 + jkl4), rules locked before the run (exact = every
≥15-char quote fragment is a substring; para_1seg = all class names, numbers and number words of the quote inside one extract segment;
primary = exact or para_1seg; loose adds tokens spread over segments):

| labels | n | exact | para_1seg | para_any | miss | primary | loose |
|---|---|---|---|---|---|---|---|
| all | 240 | 104 | 113 | 12 | 11 | **0.904** | 0.954 |
| dual | 112 | 63 | 46 | 2 | 1 | **0.973** | 0.991 |
| single | 121 | 41 | 62 | 9 | 9 | 0.851 | 0.926 |
| unres | 7 | 0 | 5 | 1 | 1 | 0.714 | 0.857 |

Dual evidence is in the bundle for 109 of 112 (97.3%) dual filings; the three exceptions are two split-across-segment cases (counts
on the cover, vote sentence in a note; content present) and one real miss: jkl4 id 69 (EXX, Class B elects two-thirds of the
directors), whose weak `elect … directors` window was dropped by the rule requiring a `vot` string. Single-label misses are mostly
paraphrased quotes. Exact-string matches alone are 43%, so exact is a lower bound. Two rules were set during the 10-filing test
before validation (R5 prose test, R6 weak filter); none was tuned after it.

**R6 change after that validation (2026-10-08).** A weak `elect … directors` window that lacks `vot` is now kept when it names a share
class (`Class A–E`, `Series A–B`, `common stock`); the digit-ratio filter and the `vot` rule for other weak hits are unchanged. Effect
on the 270 calibration filings (raw submissions fetched once from EDGAR, old rule = HEAD `sections.py`): mean bundle 14,427 → 14,520
chars (+93, +0.65%); 38 filings changed, one shrank by 7 chars (a window displaced inside the 6,000-char cap), largest increase
+1,939; mean windows 1.92 → 2.06; max bundle 35,296. The three test fixtures are unchanged (10,316 chars mean, no weak elect windows).
EXX (`0000950130-97-001416`, +1,300 chars) now carries both "elect two-thirds" sentences; the `gemini` calibration scored it a true
positive where the earlier run returned `unclear` (one run each, so this is suggestive, not a controlled effect). Fixture:
`tests/fixtures/0000950130-97-001416.txt`.

## `rule_v3` baseline (jkl4, measured 2026-10-07)

Fresh stratified gate sample (60 v3-positive + 60 v3-negative, single labeller blind to v3): precision 0.900 (54/60, Wilson
0.799–0.953), recall 1.000 (0 dual among 60 negatives; Wilson 0.940–1.000, ≈ up to 6% of negatives could be dual). v3 flagged 54.2%
of the 8,794 filings positive. Error structure: 5 of the 6 false positives come from the "1 token + vote hit" branch (an authorized or
eliminated Class B, or equal-vote Class A/B). Counts by year matched the published Table 1 within 15% in 6 of 16 years, so v3 was
not locked as the list builder. 150 of the 270 fixture labels were used to develop v3, so its score on the fixtures is not independent.

## Calibration set

`scripts/dual_class/fixtures/labels.csv`: 270 filings, 117 dual / 146 single / 7 unres (excluded from scoring), from jkl2 (a sample of 30), jkl3 (120) and jkl4 (120). jkl3/jkl4 are stratified draws (v2/v3-positive vs negative), so prevalence in the set (44% of
scored rows dual) is not the population rate and precision/recall are unweighted sample values. Single labeller; labels were read from
the first 400 KB for most filings and from the full submission for 20 in jkl4. jkl2's British Telecom row is labelled dual with per-share
votes unverified. A second-labeller set can be appended with a new `source_set`.

## Backends: calibration and head-to-head (measured 2026-10-08)

**Same package, same 270 labels** (`fixtures/labels.csv`; 263 scored, 7 `unres` excluded), bundles from the package extractor after the
R6 change (mean 14,520 chars), EDGAR source, `unclear`/error = negative. Run dirs `hidden-figures/scratch/borderline3/pkgcal2/runs/{jev,gemini,hybrid}`.

| Backend | TP | FP | FN | Precision [Wilson 95%] | Recall [Wilson 95%] | Kappa | Measured cost (270) | Projected 8,794 |
|---|---|---|---|---|---|---|---|---|
| `jev` (P ≥ 0.5) | 116 | 3 | 1 | 0.975 [0.928, 0.991] | 0.991 [0.953, 0.999] | 0.969 | $0.051 | $1.64 |
| `gemini` (3.5 Flash-Lite, Batch) | 117 | 6 | 0 | 0.951 [0.898, 0.978] | 1.000 [0.968, 1.000] | 0.954 | $0.248 | $8.06 |
| `hybrid` (Jev + 3.8 Flash LOW on 22 band rows) | 117 | 1 | 0 | 0.992 [0.954, 0.999] | 1.000 [0.968, 1.000] | 0.992 | $0.103 | ≈ $3.3 |
| `rule_v3` (free) | 117 | 12 | 0 | 0.907 [0.844, 0.946] | 1.000 [0.968, 1.000] | 0.909 | free | free |

All three model backends open their gates (≥ 0.9 / ≥ 0.9). Dollars are Jev's reported `usage.cost` and Gemini tokens × config Batch prices
(the cloud bill was not read). The hybrid band held 22 of 270 rows (8.1%); the single remaining hybrid error is
`0001193125-11-042614` (one Silver Lake Class B share electing up to two directors, which the label calls single and the definition counts as
dual). The Jev stage was run twice (the `jev` run and the hybrid run): `p_yes` differed on 115 of 270 rows (max 0.14), with identical
threshold labels and identical band membership.

**Earlier head-to-head on the production extract (hidden-figures note 6c, 270 gold filings with `unres` counted as not dual, 3.8 Flash
batch):** Jev 1.13 precision 0.921 / recall 0.991 ($1.64 projected); Gemini 3.8 Flash LOW 0.967 / 0.991 ($17.06); MEDIUM 0.975 / 0.991 ($21.93).
All nine Jev–Gemini disagreements had Jev P between 0.49 and 0.79, and sending only 0.2 ≤ P < 0.8 (9.6% of filings) to Gemini LOW reproduced
Gemini LOW on that set. The package numbers above are not comparable cell-for-cell with that table: `unres` rows are excluded here (about half
of Jev's false positives in 6c were `unres` rows or jkl3 rows labelled from the first 400 KB only), the Jev state is the package bundle text rather than the 6c rendering, and the package
`gemini` backend is the cheaper 3.5 Flash-Lite, not 3.8 Flash.

**Recommendation: `hybrid`.** Jev alone is the cheapest and, on these labels, already more precise than 3.5 Flash-Lite, but it returns no
quote or class table and its errors cluster at P between 0.4 and 0.8; routing exactly that band to a stronger model removed two of its three
false positives and kept recall at 1.000 for about twice Jev's cost and 41% of Gemini 3.5 Flash-Lite's. Use `gemini` when every row needs a verbatim quote.
**Caveats:** the band was chosen from the earlier 270-filing analysis and scored again on the same filings (in-sample; [0.3, 0.8) and [0.4, 0.85)
gave the same result there); labels are one reader's pass, and 150 of the 270 were used to develop `rule_v3`; the three backends were run once each;
Jev is not exactly reproducible; the confidence intervals are wide (a single filing moves precision by about 0.01).

## Batch request shape (bug fixed 2026-10-08)

`classify.build_request` first emitted `{"request": …, "metadata": {"request_id": …}}`. Vertex Batch rejected the job (FAILED, no output):
`code=3 … The column or property "metadata" in the specified input data is of unsupported type. Supported types … [STRING, INTEGER, FLOAT, BOOLEAN, TIMESTAMP, DATE, DATETIME, NUMERIC]`.
The request line is now `{"request": …, "request_id": "<accession>"}`; Vertex echoes `request_id` at the top level of each output line, which
`request_id_of` reads, keeping the `FILING_ID:` line in the echoed request text as a cross-check (they must agree). Verified live: 270 of 270 and 22 of 22
output lines carried the top-level `request_id`, and both jobs reconciled with 0 missing and 0 duplicate.

**Run isolation.** Each batch submit writes to `gs://…/dual-class/<run-dir>-<sha8 of abs path + time>/`, saved in `job.json`; `collect` reads only that `dest`. A missing `google-genai` stops gemini/hybrid runs before any paid call (`uv run --with google-genai`).
