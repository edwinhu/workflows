# --- excerpt: source lines 51-78 ---
PROJECT_DIR = C.PROJECT_DIR
# Every file this module writes, as a literal project-relative path (T1 writablePaths).
OUT = PROJECT_DIR / "data/processed/nv_registry_link.parquet"
INTERIM = PROJECT_DIR / "data/interim/nv_registry/link"
CANDIDATES = PROJECT_DIR / "data/interim/nv_registry/link/candidates.parquet"
CIK_NAMES = PROJECT_DIR / "data/interim/nv_registry/link/cik_names.parquet"
RATES_CSV = PROJECT_DIR / "data/interim/nv_registry/link/match_rates.csv"
HASHES = PROJECT_DIR / "data/interim/nv_registry/link/output_sha256.json"
BUILD_LOG = PROJECT_DIR / "data/interim/nv_registry/link/build_log.txt"
assert OUT == C.NV_REGISTRY_LINK_PATH, OUT
assert all(p.parent == INTERIM for p in (CANDIDATES, CIK_NAMES, RATES_CSV, HASHES, BUILD_LOG))
# --snapshot 2026 (plan .planning/fluttering-mapping-quill.md T1 writablePaths).
OUT_2026 = PROJECT_DIR / "data/processed/nv_registry_link_2026.parquet"
INTERIM_2026 = PROJECT_DIR / "data/interim/nv_registry_2026/link"
CANDIDATES_2026 = PROJECT_DIR / "data/interim/nv_registry_2026/link/candidates.parquet"
CIK_NAMES_2026 = PROJECT_DIR / "data/interim/nv_registry_2026/link/cik_names.parquet"
RATES_CSV_2026 = PROJECT_DIR / "data/interim/nv_registry_2026/link/match_rates.csv"
HASHES_2026 = PROJECT_DIR / "data/interim/nv_registry_2026/link/output_sha256.json"
BUILD_LOG_2026 = PROJECT_DIR / "data/interim/nv_registry_2026/link/build_log.txt"
# run("2023", rebuild=True), called by nevada.nv_registry.link.rebuild_check: the 2023 build written
# here, so the committed 2023 outputs above are read, never rewritten (T1 writablePaths).
OUT_REBUILD = PROJECT_DIR / "data/interim/nv_registry/rebuild_2023/nv_registry_link.parquet"
INTERIM_REBUILD = PROJECT_DIR / "data/interim/nv_registry/rebuild_2023"
CANDIDATES_REBUILD = PROJECT_DIR / "data/interim/nv_registry/rebuild_2023/candidates.parquet"
CIK_NAMES_REBUILD = PROJECT_DIR / "data/interim/nv_registry/rebuild_2023/cik_names.parquet"
RATES_CSV_REBUILD = PROJECT_DIR / "data/interim/nv_registry/rebuild_2023/match_rates.csv"
HASHES_REBUILD = PROJECT_DIR / "data/interim/nv_registry/rebuild_2023/output_sha256.json"
BUILD_LOG_REBUILD = PROJECT_DIR / "data/interim/nv_registry/rebuild_2023/build_log.txt"
# --- excerpt: source lines 780-811 and 861-872, one function (812-860 omitted) ---

def run(snapshot: str, rebuild: bool = False) -> None:
    """Build the link of `snapshot` into PATHS[snapshot]; rebuild=True (2023 only, the rebuild check)
    writes REBUILD_PATHS instead, so a re-run of 2023 never overwrites the 2023 outputs."""
    snap = snapshot_set(snapshot)
    assert not rebuild or snapshot == REF_SNAPSHOT, f"rebuild is a {REF_SNAPSHOT} check, not {snapshot}"
    # Each write below names one of the literal paths above.
    if rebuild:
        interim_dir = INTERIM_REBUILD
        build_log_path = BUILD_LOG_REBUILD
        out_path = OUT_REBUILD
        candidates_path = CANDIDATES_REBUILD
        cik_names_path = CIK_NAMES_REBUILD
        rates_path = RATES_CSV_REBUILD
        hashes_path = HASHES_REBUILD
    elif snapshot == "2026":
        interim_dir = INTERIM_2026
        build_log_path = BUILD_LOG_2026
        out_path = OUT_2026
        candidates_path = CANDIDATES_2026
        cik_names_path = CIK_NAMES_2026
        rates_path = RATES_CSV_2026
        hashes_path = HASHES_2026
    else:
        interim_dir = INTERIM
        build_log_path = BUILD_LOG
        out_path = OUT
        candidates_path = CANDIDATES
        cik_names_path = CIK_NAMES
        rates_path = RATES_CSV
        hashes_path = HASHES
    p = Paths(out_path, interim_dir, candidates_path, cik_names_path, rates_path, hashes_path, build_log_path)
    log.rows(raw, cand_out, "candidates x selected flag", key=[*CAND_KEY, "step"])
    cand_out.to_parquet(candidates_path, index=False)
    names.to_parquet(cik_names_path, index=False)
    r.to_csv(rates_path, index=False)
    back = pq.read_table(out_path).to_pandas()
    log.info(f"[write] {out_path.relative_to(PROJECT_DIR)}: {back.shape[0]:,} rows x {back.shape[1]} cols "
             f"(read back); {candidates_path.relative_to(PROJECT_DIR)} {len(cand_out):,}; "
             f"{cik_names_path.relative_to(PROJECT_DIR)} {len(names):,}; {rates_path.relative_to(PROJECT_DIR)} {len(r):,}")
    assert back.shape == out.shape
    hashes = {str(q.relative_to(PROJECT_DIR)): sha256(q) for q in (out_path, candidates_path, cik_names_path, rates_path)}
    hashes_path.write_text(json.dumps(hashes, indent=2, sort_keys=True) + "\n")
    log.info(f"[hash] {json.dumps(hashes, sort_keys=True)}")
