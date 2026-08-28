"""Schema contract for the EDGAR record-table parsers.

The column ORDER is authoritative in Go source and is never restated here. The
binaries write no header row, so any column list duplicated in Python is a second
representation of one fact -- which is how ``build_blockholders_panel.py``'s
``GO_COLUMNS`` came to exist and how it drifts. ``edgar_parquet.go_columns()``
reads the order out of ``types.go`` at run time instead.

What DOES live here is the per-parser typing table, because it is a genuine
choice rather than a copy: 13F share counts are integers, N-PX share counts are
decimals in the source XML (``66301.000000`` in real filings), so one recipe
cannot serve both.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ParserSpec:
    """One record-table parser's output contract."""

    name: str
    types_go: str          # path relative to skills/wrds/scripts/
    columns_var: str       # the Go []string var holding the column order
    int_columns: frozenset  # -> int64
    float_columns: frozenset  # -> float64
    bool_columns: frozenset  # -> bool
    year_column: str       # column the Hive partition key is derived from
    quarterly: bool        # True -> year=YYYY/QN.parquet ; False -> year=YYYY/part-NNN.parquet
    dataset: str           # output directory name
    manifest_dataset: str  # manifest parquet basename


PARSERS = {
    "13f": ParserSpec(
        name="13f",
        types_go="parse_13f/parse_13f_go/types.go",
        columns_var="holdingsColumns",
        int_columns=frozenset({"value", "shares", "voting_sole", "voting_shared", "voting_none"}),
        float_columns=frozenset(),
        bool_columns=frozenset({"cusip_valid", "is_amendment"}),
        year_column="period_of_report",
        quarterly=True,
        dataset="holdings_13f",
        manifest_dataset="parse_13f_manifest",
    ),
    "npx": ParserSpec(
        name="npx",
        types_go="parse_npx/parse_npx_go/types.go",
        columns_var="voteColumns",
        int_columns=frozenset(),
        # Decimal in the source XML per eis_NPX_PROXY_VOTING_RECORD.xsd, and
        # decimal in real filings. int64 would reject the whole column.
        float_columns=frozenset({"shares_voted_total", "shares_on_loan", "shares_voted"}),
        bool_columns=frozenset(),
        year_column="period_of_report",
        quarterly=False,  # N-PX is an annual report; there is no quarter to split on.
        dataset="votes_npx",
        manifest_dataset="parse_npx_manifest",
    ),
}

# A filing whose period_of_report falls outside this range is quarantined rather
# than partitioned. holdings_13f/ on rjds carries a `year=3006` directory because
# nothing validated the key.
MIN_YEAR = 1993
MAX_YEAR_SLACK = 1
