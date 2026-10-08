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
2. **Classify** (`classify.py`, `prompt.md`): Gemini on Vertex with a response schema `{dual: "true"|"false"|"unclear",
   classes[{name, votes_per_share, shares_outstanding}], evidence_quote, location}`. Flex for ≤10 filings, Batch beyond. Default
   model `gemini-3.5-flash-lite` (cheapest listed Flash, `gemini-vertex/references/models-and-pricing.md`).
3. **Calibrate** (`calibrate.py`, `fixtures/labels.csv`): precision / recall / kappa on 270 labels; **a full batch is refused
   until the newest calibration for this model + prompt + schema + labels has precision ≥ 0.9 and recall ≥ 0.9**.

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
paraphrased quotes. Exact-string matches alone are 43%, so exact is a lower bound. The first change to consider is relaxing the weak
filter. Two rules were set during the 10-filing test before validation (R5 prose test, R6 weak filter); none was tuned after it.

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

## Not yet measured

The LLM classifier has had exactly one live call (Ford FY1996 → `dual: "true"`, Common Stock one vote and Class B Stock 40% of the
general voting power, quote verbatim in the bundle, 5,005 prompt / 234 output tokens on Flex). Its precision, recall and kappa on the
fixtures are unknown until `calibrate.py` is run; the gate stays closed until then.
