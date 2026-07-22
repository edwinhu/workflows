---
name: fuzzy-name-matching
version: 1.0
description: "Use when linking or deduping datasets by entity name rather than a shared key — 'fuzzy match', 'fuzzy name matching', 'entity resolution', 'record linkage', 'match company/person names', 'dedupe entity names', 'name-based join', 'bridge identifiers' (CIK ↔ permno ↔ gvkey ↔ wficn ↔ EIN ↔ personid), or any use of char n-gram TF-IDF, cosine similarity on names, `sparse_dot_topn`, or RapidFuzz at scale."
user-invocable: true
---

## Contents

- [Match Enforcement](#match-enforcement)
- [When to Use](#when-to-use)
- [The Pipeline](#the-pipeline)
- [Packages](#packages)
- [Additional Resources](#additional-resources)

# Fuzzy Name Matching

Fast many-to-many fuzzy entity matching: char n-gram TF-IDF + sparse top-k
cosine similarity (the ING banks recipe). Scales to ~10⁵ × 10⁵ on a laptop
in seconds, ~10⁶ × 10⁶ with chunking.

The full recipe — code, threshold guide, gotchas, alternatives considered —
is in **`references/fuzzy-name-matching.md`**. Read it before writing match
code; a runnable template is in **`examples/fuzzy_name_match_sample.py`**.

## Match Enforcement

### IRON LAW: NO FUZZY MATCH WITHOUT NORMALIZATION FIRST

Fuzzy matching is the *last* step of a linkage, never the first:

1. **NORMALIZE** both sides (uppercase, punctuation → space, strip entity
   suffixes/titles) — see the `normalize()` function in the reference
2. **JOIN** exactly on the normalized name, scoped by a secondary key
3. **MEASURE** the exact-join hit rate
4. **FUZZY-MATCH** only the residual rows
5. **INSPECT** a sample of accepted pairs at the chosen threshold
6. **CLAIM** a hit rate only after inspecting matched pairs

Skipping straight to TF-IDF is NOT HELPFUL — every deterministic rule you
skip upfront comes back as false positives the user has to find later, in a
join they now believe is clean.

### Fuzzy Matching Facts

- If the normalized-name exact join yields <70% on ground truth, normalization is leaving money on the table — fix that before reaching for TF-IDF. Fuzzy matching a badly normalized field buys false positives, not coverage.
- IDF weights are corpus-dependent: fitting a fresh vectorizer per scoped subset makes scores incomparable across subsets. `"GABELLI MARIO JOSEPH"` ↔ `"GABELLI MARIO J"` scores 0.69 in a 2-row toy fit and 0.84 in a 600K-corpus fit — same pair, different context. Fit once on `pd.concat([left_all, right_all])`, reuse `.transform()` everywhere.
- Scoping is where the signal lives. On the 13,663-row blockholder bridge, the scoped fuzzy pass (≥0.80, per issuer_cik) converted 70% of unmatched rows; the global pass afterward (≥0.90) added 11. Scope by issuer/year/geo and the smaller candidate pool lets you *lower* the threshold safely.
- TF-IDF on characters is not semantic. `"IBM"` ↔ `"International Business Machines"` will never match at any threshold — that needs a name dictionary or an embedding model.
- `sp_matmul_topn(A, B, ...)` wants `B` **already transposed** (`R.T`), and `top_n=1` returns an arbitrary hit unless you pass `sort=True`.
- Duplicate normalized names on the right side with different ids make `top_n=1` return whichever COO entry landed first — non-deterministic id assignment. Deduplicate the right side first.

### Red Flags — STOP If About To:

- Run `sp_matmul_topn` before an exact normalized join has been tried and measured → STOP. You cannot tell false positives from real coverage without the exact-join baseline.
- Fit a `TfidfVectorizer` inside a per-key loop → STOP. Scores become incomparable across keys; fit once on the full corpus outside the loop.
- Accept matches below 0.75, or below 0.85 on an unscoped global pass → STOP. See the threshold guide in the reference; that band is noise.
- Report a hit rate without eyeballing matched pairs near the threshold → STOP. Reporting an unverified hit rate is presenting an unverified claim as fact.
- Reach for TF-IDF on <5K × 5K, or on strings under ~3 characters → STOP. RapidFuzz edit distance is better there; n-grams collapse on short strings.

## When to Use

Reach for this when linking two datasets whose only shared field is an
entity name — bridging identifiers (CIK ↔ permno ↔ gvkey ↔ wficn ↔ EIN ↔
TR personid), deduping filer/fund/insider names, or resolving vendor
records that share no key at all.

Don't use it for exact joins (pandas `merge`), for semantic equivalence, or
below ~5K × 5K rows where RapidFuzz is simpler. The reference's
"Alternatives considered" table covers `rapidfuzz`, `recordlinkage`,
`dedupe`, and edit-distance metrics and when each wins.

## The Pipeline

```
normalize both sides
    ↓
exact scoped join (issuer/year/geo + norm_name)   ← most of your hits
    ↓
exact global join (unambiguous norm_names only)
    ↓
fuzzy SCOPED pass   — threshold ≈0.80, per-key candidate pools
    ↓
fuzzy GLOBAL pass   — threshold ≥0.90, residuals only, dedup right side first
    ↓
residual: synthetic ids / leave unmatched — never force a match
```

Code for each stage, and the threshold table that governs what to accept at
each one, is in `references/fuzzy-name-matching.md`.

## Packages

```toml
# pixi.toml
[dependencies]
scikit-learn = "*"
[pypi-dependencies]
sparse_dot_topn = ">=1.2"      # ING's fast sparse top-k matmul
```

`sparse_dot_topn` is pypi-only — not on conda-forge as of 2026-04. Add it
with `pixi add --pypi sparse_dot_topn`, not `pixi add`.

## Additional Resources

### Reference Files

- **`references/fuzzy-name-matching.md`** — the full recipe: minimal code, threshold guide, normalize-first rule, scoped + global two-pass pattern, seven gotchas, alternatives considered, end-to-end results table

### Example Files

- **`examples/fuzzy_name_match_sample.py`** — runnable template: `normalize()`, `fuzzy_match()`, `fuzzy_match_scoped()`, plus a toy demo linking insider names to reporting-owner CIKs

### Related

- **`skills/wrds/examples/blockholders_pipeline/redo_bridge.py`** — production pipeline this recipe came out of (TR `personid` → SEC `rptOwnerCik`, 97.4% hit rate)
- **`skills/wrds/references/linkage.md`** — try a real link table *first*; fuzzy matching is for identifiers that genuinely don't cross vendors
