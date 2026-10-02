def _excerpt_125_195():  # excerpt wrapper: source lines 125-195 sit inside a function
    unstable = []
    grid = t[t.spec != "with_me"]          # the grid is the 5 fund-count specs
    for c in COVARS + ["block_size"]:
        col = f"b_{c}"
        if col not in t:
            continue
        sg = np.sign(grid[col].dropna())
        ok = len(set(sg)) == 1
        span = f"{grid[col].min():+.5f} .. {grid[col].max():+.5f}"
        print(f"  {c:14s} {'STABLE  ' if ok else 'UNSTABLE'} {span}")
        if not ok:
            unstable.append(c)
    if unstable:
        print(f"  -> NOT REPORTABLE as findings (sign flips across the grid): {unstable}")
    t["unstable_coefs"] = ",".join(unstable) if unstable else ""

    # log(1+n_funds) must appear in every spec that can carry it (XD-02 criterion)
    assert "b_log_block_n_funds" in t.columns and t["b_log_block_n_funds"].notna().any()

    OUT.mkdir(parents=True, exist_ok=True)
    t.to_csv(OUT / "xs_table2.csv", index=False)

    disp = t[["spec", "label", "n", "clusters", "r2"]
             + [c for c in t.columns if c.startswith(("b_", "t_"))]].round(5)
    gt = (GT(disp)
          .tab_header(title="Table 2. Determinants of index-block divergence",
                      subtitle="DV = block_for_frac − actual_forpct (raw, undeflated). "
                               "Majority-threshold items, 2005–2024. Item-category and year FE; "
                               "SEs clustered by firm (permno).")
          .tab_source_note(md(
              "The fund-count grid IS the exhibit. `corr(log(1+n_funds), |divergence|) = −0.296` and the "
              "DV's sd falls **4.4×** across the gradient, so a linear control cannot absorb the "
              "aggregation artifact by construction — the five columns show what survives it. "
              "**Pre-committed: no coefficient whose sign is unstable across the grid is reported as a "
              "finding.** `block_size` is a multiplicative factor of the DV and is therefore a control in "
              "every column, never excluded. `turnout` is omitted as a bad control (mechanically tied to "
              "`denom`, an argument of the flip identity)."))
          .tab_options(table_font_size="11px"))
    (OUT / "xs_table2.html").write_text(gt.as_raw_html())

    # ---- Figure 1: coefficient plot over the grid -------------------------
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.family": "serif", "font.size": 9})
    plot_c = [c for c in COVARS if f"b_{c}" in t.columns]
    t_grid = t[t.spec != "with_me"]
    fig, ax = plt.subplots(figsize=(7.2, 4.2), dpi=300)
    off = np.linspace(-0.28, 0.28, len(SPECS))
    for j, (spec, label) in enumerate(SPECS):
        r = t[t.spec == spec].iloc[0]
        b = [r.get(f"b_{c}", np.nan) for c in plot_c]
        se = [abs(r.get(f"b_{c}", np.nan) / r[f"t_{c}"]) if r.get(f"t_{c}") else np.nan
              for c in plot_c]
        y = np.arange(len(plot_c)) + off[j]
        ax.errorbar(b, y, xerr=[1.96 * s if s == s else 0 for s in se], fmt="o",
                    ms=3.2, lw=0.9, capsize=1.8, label=spec)
    ax.axvline(0, color="k", lw=0.7, ls="--")
    ax.set_yticks(np.arange(len(plot_c)))
    ax.set_yticklabels(plot_c)
    ax.set_xlabel("coefficient on divergence (95% CI, clustered by permno)")
    ax.set_title("Figure 1. Divergence determinants across the fund-count grid")
    ax.legend(fontsize=7, ncol=5, frameon=False, loc="lower center",
              bbox_to_anchor=(0.5, -0.28))
    fig.tight_layout()
    fig.savefig(OUT / "xs_fig1.png", bbox_inches="tight")
    print(f"\nwrote {OUT/'xs_table2.csv'} + .html + xs_fig1.png")


if __name__ == "__main__":
    main()
