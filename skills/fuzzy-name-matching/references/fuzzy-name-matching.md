# Fuzzy Name Matching (TF-IDF + sparse_dot_topn)

Fast many-to-many fuzzy string matching for entity resolution — e.g.,
bridging TR personid → SEC rptOwnerCik, CRSP `comnam` → Compustat
`conm`, filer names → CIKs.

**The ING banks recipe**: char n-gram TF-IDF + cosine similarity via
sparse top-k matrix multiply. Scales to ~10⁵ × 10⁵ on a laptop in seconds;
~10⁶ × 10⁶ with chunking.

## When to use

- Deduping / linking entity names across sources with inconsistent
  spelling, punctuation, or token order (e.g., `GABELLI MARIO JOSEPH`
  vs `GABELLI MARIO J`).
- After normalization (suffix stripping, uppercasing) has been exhausted.
- When RapidFuzz's `process.extract` is too slow (>10K × 10K).

Don't use for:
- Exact joins (use pandas `merge`).
- Very short strings (<3 chars) — n-grams collapse.
- Semantic matching (`"IBM" ↔ "International Business Machines"`) — TF-IDF
  is character-level, not semantic. Use a named-entity dictionary or
  embedding model for that.

## Packages

```toml
# pixi.toml
[dependencies]
scikit-learn = "*"
[pypi-dependencies]
sparse_dot_topn = ">=1.2"      # ING's fast sparse top-k matmul
```

`sparse_dot_topn` is pypi-only — not on conda-forge as of 2026-04.

## Minimal recipe

```python
import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sparse_dot_topn import sp_matmul_topn

left  = pd.Series([...])   # names to match FROM (unmatched rows)
right = pd.DataFrame({"name": [...], "id": [...]})  # canonical source

# 1. Vectorize: char_wb = char n-grams within word boundaries.
#    ngram_range (2,4) is the sweet spot — 3 alone is OK, wider is noisy.
vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=1)
vec.fit(pd.concat([left, right["name"]], ignore_index=True))

L = vec.transform(left)          # sparse (n_left,  n_features)
R = vec.transform(right["name"]) # sparse (n_right, n_features)

# 2. Top-1 sparse matmul with threshold (cosine similarity since TF-IDF
#    is L2-normalized by default).
matches = sp_matmul_topn(L, R.T, top_n=1, threshold=0.85, sort=True)

# 3. Extract hits (COO -> DataFrame).
coo = matches.tocoo()
result = pd.DataFrame({
    "left_idx":  coo.row,
    "right_idx": coo.col,
    "score":     coo.data,
})
result["matched_id"]   = right["id"].iloc[result["right_idx"]].values
result["matched_name"] = right["name"].iloc[result["right_idx"]].values
```

## Threshold guide

| Score | Meaning | Use |
|---|---|---|
| ≥0.95 | Near-identical (punctuation/case drift) | Auto-accept everywhere |
| 0.85–0.95 | Confident variant (`MARIO JOSEPH` ↔ `MARIO J`) | Auto-accept when scoped |
| 0.75–0.85 | Plausible variant | Accept only when scoped by company/year/geo |
| <0.75 | Noisy | Discard |

**Scoped > Global**. Always scope by a secondary key (issuer_cik, year,
country, city) when possible — it lets you drop the threshold safely
because the candidate pool is tiny. Reserve the global pass for residuals
and raise the threshold (≥0.9).

## Normalize first, fuzzy second

Fuzzy matching is the *last* step. Normalize aggressively first — every
deterministic rule you apply upfront reduces false positives at the
fuzzy stage:

```python
SUFFIX_RE = re.compile(
    r"\b(JR|SR|II|III|IV|V|MD|PHD|ESQ|"
    r"LP|LLP|LLC|LTD|INC|CORP|COMPANY|CO|GP|"
    r"TRUST|PARTNERS|PARTNERSHIP|ADVISORS|CAPITAL|"
    r"MANAGEMENT|GROUP|HOLDINGS|FUND|FUNDS)\b"
)

def normalize(s: str) -> str:
    if not isinstance(s, str) or not s.strip():
        return ""
    s = s.upper()
    s = re.sub(r"[.,'\"()/\\&]", " ", s)           # punctuation -> space
    s = re.sub(r"\bL\s*L\s*C\b", "LLC", s)         # L.L.C. / L L C -> LLC
    s = re.sub(r"\bL\s*P\b",     "LP",  s)
    s = SUFFIX_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s
```

Rule of thumb: if your `norm_name` right-join yields <70% on ground-truth,
your normalization is leaving money on the table. Fix that *before*
reaching for TF-IDF.

## Scoped + global two-pass pattern

```python
# Pass 1: scoped — cheap, low threshold, per-key subsets.
for key, sub_left in left.groupby("company_CIK"):
    cand = right[right["company_CIK"] == key]
    if cand.empty:
        continue
    L = vec.transform(sub_left["name"])
    R = vec.transform(cand["name"])
    top = sp_matmul_topn(L, R.T, top_n=1, threshold=0.80, sort=True)
    # ... record hits

# Pass 2: global — residual rows, tighter threshold, single shot.
#         Collapse right side to one row per name first (pick modal id).
right_global = right.groupby("name")["id"].agg(lambda x: x.mode().iloc[0]).reset_index()
L = vec.transform(residual["name"])
R = vec.transform(right_global["name"])
top = sp_matmul_topn(L, R.T, top_n=1, threshold=0.90, sort=True)
```

## Gotchas

1. **`ngram_range=(3,3)` is too narrow** for short names. Use `(2,4)` —
   captures bigrams in "LI KE" and 4-grams in "SMITH".
2. **`analyzer="char"` vs `"char_wb"`**: `char_wb` pads word boundaries
   with spaces (`"_SMITH_"`), which prevents `"SMI"` in `"COSMIC"` from
   matching `"SMITH"`. Always prefer `char_wb` for names.
3. **`sparse_dot_topn` signature**: it's `sp_matmul_topn(A, B, top_n,
   threshold)` — `B` should already be transposed (`R.T`), NOT a second
   sparse matrix waiting to be transposed inside.
4. **Memory**: `L @ R.T` with sparse TF-IDF is O(nnz), not O(n_left ×
   n_right). Safe up to ~10⁶ × 10⁶ if you chunk `L` in batches of 50K.
5. **Sort matters for top-1**: pass `sort=True` so the `top_n=1` actually
   returns the best match, not an arbitrary one.
6. **IDF stability — fit once on the full corpus**: if you fit a fresh
   vectorizer per issuer subset (say 3 candidate rows), IDF weights
   become unstable and scores diverge from full-corpus runs. Fit the
   vectorizer once on `pd.concat([left_all, right_all])` and reuse its
   `.transform()` for every scoped pass. In a toy 2-row demo,
   `"GABELLI MARIO JOSEPH"` ↔ `"GABELLI MARIO J"` scores 0.69; in a 600K-
   corpus fit it scores 0.84. Same pair — IDF context changed everything.
7. **Duplicate norm_names on right side**: if two rows in `right` share a
   norm_name but have different ids, `top_n=1` returns whichever COO
   entry ripgrep-ed out first. Deduplicate the right side first with
   `.groupby("name")["id"].agg(lambda x: x.mode().iloc[0])`.

## Alternatives considered

| Library | When it wins | When it loses |
|---|---|---|
| `rapidfuzz.process.cdist` | <5K × 5K, want edit distance | O(n²), slow at 50K+ |
| `recordlinkage` | Want blocking + multiple comparators | Overkill for single-column name match |
| `dedupe` | Have labeled training pairs | Needs hand-labeling |
| Levenshtein / Jaro-Winkler | Very short strings (<10 chars) | Weak on token-reordering |

TF-IDF + `sparse_dot_topn` wins when: single field, 10K+ rows both sides,
token-reordering matters (`"SMITH JOHN" ↔ "JOHN SMITH"` — handled by
char n-grams), no training pairs.

## End-to-end worked example

See `skills/wrds/examples/blockholders_pipeline/redo_bridge.py` for the full pipeline applied to
Thomson Reuters personid → SEC rptOwnerCik bridging. Results on the
mirror-voting add-on panel (13,663 rows):

| Stage | Hits | Cumulative |
|---|---|---|
| Exact scoped join | 11,411 | 83.5% |
| Exact global (unambiguous) | +93 | 84.2% |
| Volkova name lookup | +932 | 91.0% |
| TF-IDF fuzzy scoped (≥0.80) | +858 | 97.3% |
| TF-IDF fuzzy global (≥0.90) | +11 | 97.4% |
| Residual synthetic | 358 | — |

Each fuzzy stage bought roughly an order of magnitude of effort for
what exact joins left behind. Notable: the scoped fuzzy pass converted
70% of unmatched rows; the global pass (after scoped) added only 11 —
confirming scoping is where the signal lives.
