# form4 — insider ownership from Form 4

Two independent routes to insider holdings. They answer different questions and
are not substitutes.

## Route A — Thomson Reuters insiders (SAS, on the grid)

`pull_tr_insiders.sas` + `run_insider_array.sh`. Year-parallel extract of the TR
insider tables into a stacked panel. This is the fast, curated route.

```bash
scp pull_tr_insiders.sas run_insider_array.sh wrds:~/projects/<proj>/
ssh wrds "cd ~/projects/<proj> && qsub run_insider_array.sh"          # 1994-2024
ssh wrds "cd ~/projects/<proj> && qsub -t 2005-2025 run_insider_array.sh"
```

The `#$ -t` range is an SGE directive, parsed **before** the shell runs, so it
cannot read an environment variable. Override on the `qsub` line — `-t` there
wins over the one in the file.

## Route B — parse the Form 4 XMLs yourself (three steps)

Use when TR coverage is short or you need fields TR does not carry.

```bash
FORM4_YEAR_MIN=2019 FORM4_YEAR_MAX=2024 python step1_query_filings.py
bash step2_download_xmls.sh          # rclone pull to $WRDS_SCRATCH, tar back
python step3_parse_xmls.py           # -> form4_owner_bridge.parquet
```

`pull_insider_ownership.py` is the standalone WRDS pull that seeds the CIK/CUSIP
side.

## Configuration

Nothing names a user, an institution, or a project tree:

| Variable | Default |
|---|---|
| `FORM4_ROOT` | the repo root (`parents[4]` from these scripts) — set it to the **consuming** project when vendored |
| `WRDS_SCRATCH` | `/scratch/${WRDS_INST:-nyu}/$WRDS_USER` |
| `WRDS_USER` | asked of the remote (`ssh wrds whoami`), not assumed from the local login |
| `WRDS_PGHOST` / `WRDS_PGPORT` / `WRDS_USER` | `wrds-pgdata.wharton.upenn.edu` / `9737` / `$USER` |
| `FORM4_YEAR_MIN` / `FORM4_YEAR_MAX` | `2019` / `2024` |

mirror imported `src.wrds_pull` for the database handle. That package does not
exist here, so the connection is `psycopg2` direct against `~/.pgpass` — one
fewer dependency, and the same credentials.

## Grain, and the trap

`references/insider-form4.md` has the full table reference. The one thing to
carry in your head: the row PK is **`(dcn, seqnum)`**, not the accession. Form 4
amendments (`4/A`) are separate submissions with their own accessions, so
deduping on accession alone silently keeps both the original and its correction.
Supersede by `(person, transaction date, code)` taking the latest filing.

## Provenance

Copied from mirror (`scripts/form4_step*`, `scripts/pull_insider_ownership.py`,
`sas/pull_tr_insiders.sas`, `sas/run_insider_array.sh`). mirror keeps its copies —
its counterfactual stack and notebooks consume the outputs — so this is a copy,
not a move, and the two can drift. If you change the parse here, say so there.
