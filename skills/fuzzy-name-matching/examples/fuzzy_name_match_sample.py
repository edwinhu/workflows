"""Fuzzy name matching — minimal end-to-end sample.

Copy-paste pattern for entity resolution via char n-gram TF-IDF +
sparse top-k cosine similarity. See ../references/fuzzy-name-matching.md
for theory and gotchas.

Dependencies (pixi):
  pixi add scikit-learn
  pixi add --pypi sparse_dot_topn

Run:
  pixi run python fuzzy_name_match_sample.py
"""
from __future__ import annotations

import re

import pandas as pd
from sklearn.feature_extraction.text import TfidfVectorizer
from sparse_dot_topn import sp_matmul_topn


# ---- Normalization (always do this first) ---------------------------------

SUFFIX_RE = re.compile(
    r"\b(JR|SR|II|III|IV|V|MD|PHD|ESQ|CPA|MR|MRS|MS|DR|"
    r"LP|LLP|LLC|LTD|INC|CORP|CORPORATION|COMPANY|CO|GP|PLC|"
    r"NV|SA|AG|TRUST|PARTNERS|PARTNERSHIP|ADVISORS|ADVISERS|"
    r"CAPITAL|MANAGEMENT|GROUP|HOLDINGS|FUND|FUNDS|ASSOCIATES|"
    r"INVESTMENTS|INVESTMENT)\b"
)


def normalize(s: str) -> str:
    """Canonicalize a name for matching.

    - Uppercase
    - Punctuation -> space
    - Collapse letter-run entity suffixes: L.L.C. / L L C -> LLC
    - Drop noise tokens (suffixes, titles, entity types)
    - Squeeze whitespace
    """
    if not isinstance(s, str) or not s.strip():
        return ""
    s = s.upper()
    s = re.sub(r"[.,'\"()/\\&]", " ", s)
    s = re.sub(r"\bL\s*L\s*C\b", "LLC", s)
    s = re.sub(r"\bL\s*P\b", "LP", s)
    s = re.sub(r"\bL\s*L\s*P\b", "LLP", s)
    s = SUFFIX_RE.sub(" ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


# ---- Core fuzzy match -----------------------------------------------------

def fuzzy_match(
    left: pd.Series,
    right: pd.Series,
    threshold: float = 0.85,
    ngram_range: tuple[int, int] = (2, 4),
    top_n: int = 1,
) -> pd.DataFrame:
    """Match each `left` name to its best `right` name above `threshold`.

    Returns DataFrame with columns [left_idx, right_idx, score] for hits
    only (non-matches are absent). Scores are cosine similarity in [0, 1].

    Indices are positional — use `.iloc[result["left_idx"]]` to recover
    the original rows.
    """
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=ngram_range, min_df=1)
    vec.fit(pd.concat([left, right], ignore_index=True))

    L = vec.transform(left)
    R = vec.transform(right)

    top = sp_matmul_topn(L, R.T, top_n=top_n, threshold=threshold, sort=True)
    coo = top.tocoo()
    return pd.DataFrame(
        {"left_idx": coo.row, "right_idx": coo.col, "score": coo.data}
    )


def fuzzy_match_scoped(
    left: pd.DataFrame,
    right: pd.DataFrame,
    name_col: str,
    key_col: str,
    threshold: float = 0.80,
    ngram_range: tuple[int, int] = (2, 4),
) -> pd.DataFrame:
    """Per-key fuzzy match: for each shared `key_col` value, match only
    within the subset of `right` sharing that key. Cheaper and more
    accurate than a global match because candidate pools are tiny.

    Both frames must have columns [`name_col`, `key_col`].

    Returns hits with [left_idx, right_idx, score] where indices are
    positional in the *input* DataFrames (not the subsets).
    """
    hits = []
    # Fit vectorizer once on the full vocabulary for stable IDF.
    vec = TfidfVectorizer(analyzer="char_wb", ngram_range=ngram_range, min_df=1)
    vec.fit(pd.concat([left[name_col], right[name_col]], ignore_index=True))

    for key, sub_l in left.reset_index().groupby(key_col):
        sub_r = right.reset_index()
        sub_r = sub_r[sub_r[key_col] == key]
        if sub_r.empty:
            continue
        L = vec.transform(sub_l[name_col])
        R = vec.transform(sub_r[name_col])
        top = sp_matmul_topn(L, R.T, top_n=1, threshold=threshold, sort=True)
        coo = top.tocoo()
        for li, ri, score in zip(coo.row, coo.col, coo.data):
            hits.append(
                {
                    "left_idx":  int(sub_l["index"].iloc[li]),
                    "right_idx": int(sub_r["index"].iloc[ri]),
                    "score":     float(score),
                }
            )
    return pd.DataFrame(hits)


# ---- Demo ------------------------------------------------------------------

if __name__ == "__main__":
    # Toy data: link TR-style insider names to SEC-style reporting owners.
    left = pd.DataFrame(
        {
            "issuer": [100, 100, 200, 200, 300],
            "name": [
                "GABELLI MARIO JOSEPH",
                "GADICKE ANSBERT S.",
                "KATZ AVISHAY S.",
                "ORBIMED ADVISORS, L.L.C.",
                "BAKER BROS ADVISORS L.P.",
            ],
        }
    )
    right = pd.DataFrame(
        {
            "issuer": [100, 100, 200, 200, 300, 999],
            "name": [
                "GABELLI MARIO J",
                "GADICKE ANSBERT",
                "KATZ AVISHAY",
                "Orbimed Advisors LLC",
                "Baker Bros. Advisors LP",
                "UNRELATED ENTITY",
            ],
            "cik": [1185533, 1134655, 1111111, 2222222, 3333333, 9999999],
        }
    )

    left["norm"]  = left["name"].map(normalize)
    right["norm"] = right["name"].map(normalize)

    print("Left (normalized):")
    print(left[["issuer", "name", "norm"]])
    print("\nRight (normalized):")
    print(right[["issuer", "name", "norm"]])

    # Scoped pass: lower threshold is safe because pool is tiny.
    print("\n--- Scoped pass (threshold=0.80) ---")
    scoped = fuzzy_match_scoped(
        left=left.rename(columns={"norm": "norm_name"}),
        right=right.rename(columns={"norm": "norm_name"}),
        name_col="norm_name",
        key_col="issuer",
        threshold=0.80,
    )
    for _, row in scoped.iterrows():
        li, ri = int(row["left_idx"]), int(row["right_idx"])
        print(
            f"  {left['name'].iloc[li]!r:40s} "
            f"-> {right['name'].iloc[ri]!r:30s} "
            f"[cik={right['cik'].iloc[ri]}, score={row['score']:.3f}]"
        )

    # Global pass: tighter threshold, no issuer filter.
    print("\n--- Global pass (threshold=0.90) ---")
    global_hits = fuzzy_match(
        left=left["norm"], right=right["norm"], threshold=0.90
    )
    for _, row in global_hits.iterrows():
        li, ri = int(row["left_idx"]), int(row["right_idx"])
        print(
            f"  {left['name'].iloc[li]!r:40s} "
            f"-> {right['name'].iloc[ri]!r:30s} "
            f"[score={row['score']:.3f}]"
        )
