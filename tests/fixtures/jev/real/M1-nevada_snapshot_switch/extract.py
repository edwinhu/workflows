# --- excerpt: source lines 39-47 ---
PROJECT_DIR = C.PROJECT_DIR
# Every file this module writes, as a literal project-relative path (T1 writablePaths); each equals
# its config OC_SNAPSHOTS entry. The 2023 extract writes no log or hash file (as before the switch).
COMPANIES_PARQUET = PROJECT_DIR / "data/interim/nv_registry/extract/companies_nv_de.parquet"
IDENTIFIERS_PARQUET = PROJECT_DIR / "data/interim/nv_registry/extract/additional_identifiers.parquet"
COMPANIES_PARQUET_2026 = PROJECT_DIR / "data/interim/nv_registry_2026/extract/companies_nv.parquet"
IDENTIFIERS_PARQUET_2026 = PROJECT_DIR / "data/interim/nv_registry_2026/extract/additional_identifiers.parquet"
EXTRACT_LOG_2026 = PROJECT_DIR / "data/interim/nv_registry_2026/extract/extract_log.txt"
EXTRACT_HASHES_2026 = PROJECT_DIR / "data/interim/nv_registry_2026/extract/output_sha256.json"
# --- excerpt: source lines 100-113 and 173-176, one function (114-172 omitted) ---
def main(argv=None) -> None:
    snapshot = parse_args(argv).snapshot
    s = C.OC_SNAPSHOTS[snapshot]
    # Each write below names one of the literal paths above.
    if snapshot == "2026":
        companies_out = COMPANIES_PARQUET_2026
        identifiers_out = IDENTIFIERS_PARQUET_2026
        log_path = EXTRACT_LOG_2026
        hashes_path = EXTRACT_HASHES_2026
    else:
        companies_out = COMPANIES_PARQUET
        identifiers_out = IDENTIFIERS_PARQUET
        log_path = None
        hashes_path = None
    if hashes_path is not None:
        hashes = {str(p.relative_to(C.PROJECT_DIR)): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in (companies_out, identifiers_out)}
        hashes_path.write_text(json.dumps(hashes, indent=2, sort_keys=True) + "\n")
