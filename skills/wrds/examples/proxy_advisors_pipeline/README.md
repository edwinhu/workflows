# Proxy-Advisor-Customers Pipeline

Identifies which mutual-fund families disclosed contractual relationships with
ISS, Glass Lewis, or Egan-Jones in their 485BPOS / 485APOS prospectus filings.
Port of [chongshu/proxy-advisor-customers](https://github.com/chongshu/proxy-advisor-customers)
(JFE paper data) to the `scan_covers` Go framework + SGE.

## Pipeline

```
wrdssec_all.forms (485BPOS, 485APOS)
   │
   ▼
stage_proxy_advisors.py  ──── metadata / upload / submit / fetch
   │   ┌─────────────────────────────────────────┐
   │   │  WRDS SGE: scan_covers -profile         │
   │   │  proxy_advisors -files-from <year>.txt  │
   │   └─────────────────────────────────────────┘
   ▼
per-year TSV.gz  (filepath, accession, form_type, filed_date, cik,
                  company_name, iss_hit, gl_hit, ej_hit)
   │
   ▼
aggregate.py
   │   ─ collapse to (cik, year)
   │   ─ optional N-PX sample frame
   │   ─ CRSP mutual fund DB:  cik → mgmt_cd
   │   ─ collapse to (mgmt_cd, year)
   ▼
link_fundmgmt_proxyadvisor.csv
   │
   ▼
validate.py  vs  chongshu published CSV  → ≥98% per advisor (2007–2021)
```

## Quick start

```bash
# 1. Build the Linux binary
cd ../../scripts/scan_covers && ./build.sh

# 2. Stage and run on WRDS (2003–present; paper coverage starts 2007)
cd sge
pixi run python stage_proxy_advisors.py \
    --start 2003 --end 2025 \
    --step metadata,upload,submit,fetch

# 3. Aggregate locally
pixi run python aggregate.py \
    --scan-dir ~/projects/mirror/data/raw/proxy_advisors_go \
    --out ./link_fundmgmt_proxyadvisor.csv \
    --apply-npx-frame --wrds-user eddyhu

# 4. Validate against the published CSV
pixi run python validate.py \
    --ours ./link_fundmgmt_proxyadvisor.csv \
    --theirs /path/to/chongshu/link_fundmgmt_proxyadvisor.csv
```

## Files

- `aggregate.py` — filing-level → mgmt_cd × year panel.
- `validate.py` — per-advisor agreement vs published CSV.
- See `../../scripts/scan_covers/profiles_proxy_advisors.go` for the Go profile.
- See `../../scripts/scan_covers/extractors_proxy_advisors.go` for the name-variant regexes.
- See `../../scripts/scan_covers/sge/stage_proxy_advisors.py` for the SGE pipeline driver.
- See `../../references/proxy-advisors.md` for full methodology and validation notes.
