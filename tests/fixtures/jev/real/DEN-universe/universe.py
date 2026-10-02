# --- excerpt: source lines 205-222 ---


def join_audit(label: str, left_n: int, right_col: pd.Series, result_n: int,
               key: pd.Series) -> None:
    """E3: every join reports row counts in/out, match rate and key uniqueness."""
    matched = int(right_col.notna().sum())
    dupes = int(key.duplicated().sum())
    JOINS.append({"join": label, "left_rows": left_n, "result_rows": result_n,
                  "matched": matched, "unmatched": left_n - matched,
                  "match_rate": round(matched / left_n, 6),
                  "post_join_key_dupes": dupes})
    print(f"[join] {label}: LEFT={left_n:,} rows -> RESULT={result_n:,} rows "
          f"({result_n / left_n:.1%} of left); matched={matched:,} "
          f"({matched / left_n:.1%} of {left_n:,}); unmatched={left_n - matched:,}; "
          f"post-join key dupes={dupes:,}")


# --------------------------------------------------------------------------- #
def _excerpt_355_421():  # excerpt wrapper: source lines 355-421 sit inside a function
    for col in ("permno", "dual", "founding"):
        base[col] = base[col].astype("Int64")
    if base["rid"].duplicated().any():
        raise RuntimeError("rid is not unique in the base")
    n_permno = int(base["permno"].notna().sum())
    n_cusip8 = int(base["cusip8"].notna().sum())
    print(f"            rid unique: {base['rid'].is_unique}; "
          f"permno present {n_permno:,}/{len(base):,} ({n_permno / len(base):.1%}); "
          f"cusip8 present {n_cusip8:,}/{len(base):,} ({n_cusip8 / len(base):.1%})")
    exp = params["expected"]["base_rows"]
    if len(base) != exp:
        raise RuntimeError(f"base rows {len(base)} != expected {exp}")
    return base


def ritter_cte(base: pd.DataFrame, permno_col: str) -> str:
    """The key list as a VALUES CTE (a read-only session forbids a temp table)."""
    cols = ", ".join(RITTER_CTE_COLS)
    vals = []
    for row in base.itertuples(index=False):
        d = row._asdict()
        vals.append("(" + ",".join(sql_lit(v) for v in (
            d["rid"], d["offer_date"], d["ipo_year"], d["ipo_name"], d["ticker"],
            d["cusip"], d["cusip8"], d[permno_col], d["vc"], d["dual"], d["founding"],
        )) + ")")
    raw = f"WITH ritter_raw({cols}) AS (\n  VALUES " + ",\n         ".join(vals) + "\n)"
    cast = (
        "\n, ritter AS (\n"
        "  SELECT rid::int AS rid, offer_date::date AS offer_date,\n"
        "         ipo_year::int AS ipo_year, ipo_name::text AS ipo_name,\n"
        "         ticker::text AS ticker, cusip::text AS cusip, cusip8::text AS cusip8,\n"
        "         permno::int AS permno, vc::int AS vc, dual::int AS dual,\n"
        "         founding::int AS founding\n"
        "  FROM ritter_raw\n)"
    )
    return raw + cast


# --------------------------------------------------------------------------- #
# step 3 -- PERMNO-vs-CUSIP audit, run as a gate
# --------------------------------------------------------------------------- #
def audit_permno(base: pd.DataFrame, params: dict) -> pd.DataFrame:
    hr("STEP 3  join audit / gate: does Ritter's PERMNO carry Ritter's CUSIP-8?")
    body = ritter_cte(base, "permno") + "\n" + sql_text("audit_permno.sql")
    aud = copy_csv(body, params, "audit_permno")
    aud["rid"] = to_int(aud["rid"], "int32")
    aud["cusip_agrees"] = to_bool(aud["cusip_agrees"])
    aud["permno_from_cusip"] = to_int(aud["permno_from_cusip"], "Int32")

    n_check = len(aud)
    n_agree = int((aud["cusip_agrees"] == True).sum())
    dis = aud[aud["cusip_agrees"] == False]
    dis_other = dis[dis["permno_from_cusip"].notna()]
    dis_unknown = dis[dis["permno_from_cusip"].isna()]
    print(f"checkable rows (permno and cusip8 both present): {n_check:,} "
          f"of {len(base):,} base rows")
    print(f"agree                                          : {n_agree:,} "
          f"({n_agree / n_check:.1%} of {n_check:,})")
    print(f"disagree, CUSIP-8 unknown to crsp.stocknames   : {len(dis_unknown):,} "
          f"({len(dis_unknown) / n_check:.1%} of {n_check:,})")
    print(f"disagree, CUSIP-8 maps to a DIFFERENT permno   : {len(dis_other):,} "
          f"({len(dis_other) / n_check:.1%} of {n_check:,})")
    if len(dis_other):
        print("\nthe rows where the two identifiers name different firms:")
        print(dis_other[["rid", "ipo_year", "ipo_name", "cusip8", "permno",
                         "comnam_of_permno", "permno_from_cusip",
                         "comnam_of_cusip"]].to_string(index=False))
