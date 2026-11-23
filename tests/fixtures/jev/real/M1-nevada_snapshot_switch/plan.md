# Nevada vs Delaware standing on the 2026-11-09 OpenCorporates delivery

## Data Outputs

| Path | Grain | Key Columns | Required Window |
|---|---|---|---|
| data/processed/nv_registry_link_2026.parquet | one row per sample unit (listed mover event, OTC mover event, full-sample Nevada firm-year) with reference date on or before 2026-11-09; unlinked units kept with link_method none | pk: sample, unit_id; freetext: company_number, entity_name, candidate_numbers, link_note; sparse: company_number, entity_name, current_status, status_class, incorporation_date, candidate_numbers | n/a |
| data/processed/nvde_status_firm_years_2026.parquet | one row per full-sample firm-year (role nevada or control) with reference fdate on or before 2022-11-01; unlinked rows kept with link_method none | pk: snapshot_year, cik, role, match_cik; sparse: status_label, status_class, bq_company_number, entity_number, link_method_detail, last_10k_date; freetext: status_label, link_method_detail | n/a |
| data/output/table_nv_de_status_2026.csv | one row per statistic × group; numerator/denominator null by design on difference, SE and cluster-count rows | pk: statistic, group; sparse: numerator, denominator | n/a |
| data/processed/nv_status_transitions_2023_2026.parquet | one row per eligible full_nevada firm-year (fdate on or before 2022-11-01) | pk: snapshot_year, cik; sparse: status_class_2023, status_class_2026, company_number_2023, company_number_2026, current_status_2023, current_status_2026 | n/a |
| data/output/table_nv_de_status_2026_dategap.csv | one row per statistic × group; numerator/denominator null by design on difference and bound rows | pk: statistic, group; sparse: numerator, denominator | n/a |

## Side outputs

Build logs, sha256 json, match-rate and coverage diagnostics, and intermediate parquets. They are written only under these directories, which are not in the Data Outputs table:

- data/interim/nv_registry_2026/extract/ and data/interim/nv_registry_2026/link/ (2026 extract, candidates, cik names, match_rates.csv, output_sha256.json, build logs)
- data/interim/nv_registry/rebuild_2023/ (rebuild_check.json and the 2023 rebuild log; the committed 2023 interim files are not rewritten)
- data/interim/nvde_status_2026/, data/interim/nvde_status_2026/logs/ and data/interim/nvde_status_2026/dategap/ (coverage.csv, status_label_map.csv, corrected-links parquets, build logs, output_sha256.json)
- data/raw/opencorporates_20261109/provenance.json, data/raw/nvde_link_corrections/ and data/raw/nv_gap_census_20261010/ (copied inputs)

## Inherited artifacts

Read, never rebuilt: the 2023 outputs (`nv_registry_link.parquet`, `nvde_status_firm_years.parquet`, `table_nv_de_status.csv`, figure), `data/interim/nvde_status/{de_entity_status,de_link,alive_10k}.parquet`, `full_rpt_firm_panel.parquet`, `full_nv_firms.parquet`, `full_matched_controls.parquet`, and both raw OpenCorporates deliveries. This run edits committed code in `src/nevada/nv_registry/` and `src/nevada/nvde_status/` only to add the snapshot switch. The 2023 path must behave exactly as before.

T1 and T2 writablePaths (plan lines 124-133 and 150-160):
        "writablePaths": [
          "src/nevada/config.py",
          "src/nevada/nv_registry/extract.py",
          "src/nevada/nv_registry/link/",
          "tests/test_oc_snapshot.py",
          "data/raw/opencorporates_20261109/provenance.json",
          "data/interim/nv_registry_2026/",
          "data/interim/nv_registry/",
          "data/processed/nv_registry_link_2026.parquet"
        ],
        "writablePaths": [
          "src/nevada/config.py",
          "src/nevada/nvde_status/link/",
          "src/nevada/nvde_status/report/",
          "data/raw/nvde_link_corrections/",
          "data/interim/nvde_status_2026/",
          "data/processed/nvde_status_firm_years_2026.parquet",
          "data/output/table_nv_de_status_2026.csv",
          "data/output/fig_nv_de_status_2026.png",
          "data/output/fig_nv_de_status_2026.svg"
        ],
