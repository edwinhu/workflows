# --- excerpt: source lines 50-52 ---
SAMPLE_OUT = config.DATA_PROCESSED / "agk_sample.parquet"
CHAIN_OUT = config.DATA_OUTPUT / "agk_sample_chain.csv"
PROVENANCE = config.DATA_OUTPUT / "provenance.json"
def _excerpt_566_571():  # excerpt wrapper: source lines 566-571 sit inside a function
    # --- write ----------------------------------------------------------------------------
    config.DATA_PROCESSED.mkdir(parents=True, exist_ok=True)
    config.DATA_OUTPUT.mkdir(parents=True, exist_ok=True)
    sample.write_parquet(SAMPLE_OUT)
    chain.write_csv(CHAIN_OUT)
    print(f"[write] {SAMPLE_OUT}  shape={sample.shape}")
def _excerpt_691_696():  # excerpt wrapper: source lines 691-696 sit inside a function
    existing = json.loads(PROVENANCE.read_text()) if PROVENANCE.exists() else {}
    existing["t11_agk_sample"] = block
    existing["output_digests"] = refresh_output_digests(existing)
    PROVENANCE.write_text(json.dumps(existing, indent=2, sort_keys=True, default=str) + "\n")
    print(f"[write] {PROVENANCE}  key t11_agk_sample "
          f"({len(existing)} top-level keys preserved)")
