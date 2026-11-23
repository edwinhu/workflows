# --- excerpt: source lines 58-100 ---
# Output paths: plan Data Outputs / T2 writablePaths, spelled as literals.
TABLE_PATH = PROJECT_DIR / "data/output/table_nv_de_status.csv"
FIG_PNG_PATH = PROJECT_DIR / "data/output/fig_nv_de_status.png"
FIG_SVG_PATH = PROJECT_DIR / "data/output/fig_nv_de_status.svg"
# Run log: under data/ (T2 writable path data/interim/nvde_status/logs/), never under src/.
BUILD_LOG = PROJECT_DIR / "data/interim/nvde_status/logs/build.log"
assert FIG_PNG_PATH.with_suffix("") == FIG_SVG_PATH.with_suffix(""), "PNG and SVG must share a stem"
# --snapshot 2026 outputs (T2 writablePaths), as literals.
TABLE_PATH_2026 = PROJECT_DIR / "data/output/table_nv_de_status_2026.csv"
FIG_PNG_PATH_2026 = PROJECT_DIR / "data/output/fig_nv_de_status_2026.png"
FIG_SVG_PATH_2026 = PROJECT_DIR / "data/output/fig_nv_de_status_2026.svg"
BUILD_LOG_2026 = PROJECT_DIR / "data/interim/nvde_status_2026/logs/build.log"
REPORT_HASHES_2026 = PROJECT_DIR / "data/interim/nvde_status_2026/logs/output_sha256.json"
assert FIG_PNG_PATH_2026.with_suffix("") == FIG_SVG_PATH_2026.with_suffix("")
assert REPORT_HASHES_2026.parent == BUILD_LOG_2026.parent
REPORT_HASHES = None          # 2023 logs its output sha256 lines only (as built by run 1009)
# The plotted-values block the figure script prints (check_plotted and verify.py parse it).
PLOTTED_COLS = ["statistic", "group", "field", "value"]

# --snapshot: the settings module and output paths of each snapshot. use_snapshot() rebinds S and
# the four output names above before anything is read; the 2023 entry is the module's own values.
SETTINGS = {"2023": settings_2023, "2026": settings_2026}
OUTPUT_NAMES = ("TABLE_PATH", "FIG_PNG_PATH", "FIG_SVG_PATH", "BUILD_LOG", "REPORT_HASHES")
SNAPSHOT_OUTPUTS = {
    "2023": {"TABLE_PATH": TABLE_PATH, "FIG_PNG_PATH": FIG_PNG_PATH, "FIG_SVG_PATH": FIG_SVG_PATH,
             "BUILD_LOG": BUILD_LOG, "REPORT_HASHES": REPORT_HASHES},
    "2026": {"TABLE_PATH": TABLE_PATH_2026, "FIG_PNG_PATH": FIG_PNG_PATH_2026,
             "FIG_SVG_PATH": FIG_SVG_PATH_2026, "BUILD_LOG": BUILD_LOG_2026,
             "REPORT_HASHES": REPORT_HASHES_2026},
}
assert tuple(SETTINGS) == tuple(SNAPSHOT_OUTPUTS) == C.NVDE_STATUS_SNAPSHOT_IDS
assert all(tuple(v) == OUTPUT_NAMES for v in SNAPSHOT_OUTPUTS.values())
assert not ({p for p in SNAPSHOT_OUTPUTS["2023"].values() if p is not None}
            & set(SNAPSHOT_OUTPUTS["2026"].values()))


def use_snapshot(snapshot: str) -> None:
    global S, TABLE_PATH, FIG_PNG_PATH, FIG_SVG_PATH, BUILD_LOG, REPORT_HASHES
    if snapshot not in SETTINGS:
        raise ValueError(f"snapshot {snapshot!r} not in {tuple(SETTINGS)}")
    S = SETTINGS[snapshot]
    out = SNAPSHOT_OUTPUTS[snapshot]
    TABLE_PATH, FIG_PNG_PATH, FIG_SVG_PATH, BUILD_LOG, REPORT_HASHES = (out[n] for n in OUTPUT_NAMES)
def _excerpt_656_660():  # excerpt wrapper: source lines 656-660 sit inside a function
    TABLE_PATH.parent.mkdir(parents=True, exist_ok=True)
    out = t.copy()
    for c in S.FLOAT_COLS:
        out[c] = out[c].map(fmt_float)
    out.to_csv(TABLE_PATH, index=False, lineterminator="\n")
def _excerpt_842_846():  # excerpt wrapper: source lines 842-846 sit inside a function
    if REPORT_HASHES is not None:
        hashes = {str(p.relative_to(PROJECT_DIR)): sha256(p)
                  for p in (TABLE_PATH, FIG_SVG_PATH, FIG_PNG_PATH)}
        REPORT_HASHES.write_text(json.dumps(hashes, indent=1, sort_keys=True) + "\n")
        log.info(f"[write] {REPORT_HASHES.relative_to(PROJECT_DIR)}: {len(hashes)} sha256")
