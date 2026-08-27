# def14a_independence — the board's own director-independence determination

## Why

DGCL 144(d)(2), added by Delaware SB 21 (2025), gives a heightened presumption of
disinterestedness where "the board of directors shall have determined that such director
satisfies the applicable criteria for determining director independence ... under the rules
... promulgated by such exchange." *Ayers v. Foley* (Del. Ch. June 15, 2026) applied it at the
Rule 23.1 demand-futility stage. The legally operative object is therefore **the board's own
determination, in the proxy** — not a vendor label. BoardEx `ned` and ISS `classification` are
vendor classifications of a different object, and both lag the filing by 9–13 months. The
EDGAR index does not lag: `wrdssec_all.wrds_forms` carried 4,310 DEF 14A + 170 DEFM14A for
2026 as of `max(fdate) = 2026-08-24`, including 3,744 filed in the March–June window.

## Pipeline

```bash
# 1. stage the index (PostgreSQL, INDEX ONLY — never filing text)
python stage.py --start-year 2015 --end-year 2026 --out .

# 2. scan (grid — reads whole filings; NEVER on the login node)
qsub ../../sge/submit_array.sh          # or, serially:
scan_covers -profile def14a_independence -files-from indep_files.txt \
    -root /wrds/sec/wrds_clean_filings > indep_raw.tsv

# 3. reduce to one row per (cik, meeting_year)
python build_panel.py --scan indep_raw.tsv --index indep_filings.tsv \
    --out data/processed
```

## The packed `indep` column

One full-body normalisation, eleven correlated outputs. Eleven `Custom` fields would
normalise a 1 MB buffer eleven times, so they are packed and `build_panel.py` splits on the
first ten pipes (every text component is pipe-sanitised in Go).

```
det_form|name_style|indep_names|n_indep|n_board|exchange|rule_cited|catstd_loc|considered|considered_names|match_text
```

| `det_form` | the filing says | names recoverable? |
|---|---|---|
| `named` | "…determined that each of Mses. Battle, Cashman … are independent" | yes, directly |
| `except_named` | "all Board members, other than Mr. Cook, are independent" | only as *slate minus the excepted* |
| `all_nonemployee` | "all ExxonMobil non-employee directors are independent" | no — categorical, no names at all |
| `count_only` | "Ten of the 13 members … have been determined to be independent" | no |
| `none` | nothing extractable | — |

`name_style` is `full`, `single` (surname-only *or* first-name-only — proxies do both) or
`none`. `considered` is `no` / `yes` / `yes_named` / `none_found`; `none_found` means the
board affirmatively said it identified no relationships, which is different evidence from
silence and is deliberately not merged with `no`.

## Measured, on the 31-filing fixture set

16 firms × pre-SB-21 (2024) and post-SB-21 (2026) where both exist; NYSE, Nasdaq and NYSE
American; mega-cap to micro-cap; four dual-class controlled firms. Ground truth was
hand-built by reading each filing. See
`board-structuring/docs/investigations/2026-08-26_def14a-independence-parsing.md`.

| field | correct | error |
|---|---|---|
| determination form | 31/31 | 0.0% |
| name set, exact (of 23 filings that state names) | 22/23 | 4.3% |
| exchange | 31/31 | 0.0% |
| exchange rule cited | 31/31 | 0.0% |
| categorical-standard location | 29/31 | 6.5% |
| relationships-considered flag | 29/31 | 6.5% |
| director tied to a named relationship (of 11) | 11/11 recall, 0 false positives | — |

Throughput: 13.4 filings/s at 8 workers on 14 MB of warm fixtures (~1.7 filings/s/core).

## Traps

- **`FullBody`, not a head window.** The determination sits anywhere from 15 KB in to most of
  the way through a 1 MB proxy. `HeadBytes` is only the form-type pre-filter.
- **The archive is HTML-stripped but NOT re-flowed.** Roughly half the corpus arrives
  hard-wrapped mid-sentence (Apple, Ford, Alphabet, Cato) and half one paragraph per line
  (Exxon, JPMorgan, Meta, Wendy's). Everything runs on a whitespace-collapsed rendering; a
  line- or paragraph-anchored regex silently loses the wrapped half.
- **The converter deletes apostrophes.** "Metas", "Companys", "Mitarotondas". `cleanNames`
  collapses the trailing-`s` variant onto the base name when both appear.
- **Do not union rosters across sentences.** Tried and reverted: it added "John P. D. Cato" —
  the CEO the same proxy declares *not* independent — to Cato Corp's independent set.
- **Do not look ahead for the money field.** A three-sentence lookahead lifts `yes_named`
  from 6/31 to 29/31 and is wrong on most of the lift (it collects the audit firm, section
  headings and statute names). Same-sentence pairing is shipped.
- **`n_directors`/`slate` come from `def14a_directors` unchanged** and return **zero
  directors on 14 of the 31 fixtures** — the Name-Age anchor does not fire on modern proxies
  that render age as "Age: 63" in a graphic. Surname→full-name resolution in `build_panel.py`
  therefore succeeds on only 8.4% of roster tokens. Fix that profile before relying on the
  independent *share*; the independent *count* does not depend on it.
- **Never run the scan on the login node.**
