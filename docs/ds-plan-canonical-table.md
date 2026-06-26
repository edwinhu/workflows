# Proposal: canonical Task-Breakdown format (the ds-plan emitter spec)

> For muni's ergonomics pass. Principle (the resume-leg finding applied to format):
> **strictness at the EMITTER, tolerance at the PARSER.** `ds-plan` *emits* one canonical
> form; the parser/guard *accept* a wider tolerated set so a hand-edit is never blocked.
> Every canonical token must be something you'd be willing to type by hand in a planning chat.

## The canonical row (what ds-plan emits)

```
| Task | Deps | Outputs | Expected Output | Verify | Implements |
|------|------|---------|-----------------|--------|------------|
| **T1** [engineer] — <imperative description> | none | `path/to/out.parquet` | <verifiable claim w/ numbers> | `<cmd; exit 0 = pass>` | CAT-01 |
| **T2** [analyst] `[x]` — <description> ⏸ PAUSE: <decision to surface> | T1 | `path/b.csv` | <claim> | `<cmd>` | CAT-02, CAT-03 |
| **T3** — <description> | T1, T2 | `path/c` | <claim> | `<cmd>` | CAT-04 |
```

## Token spec — EMIT (canonical) vs TOLERATE (parser accepts, never blocks)

| Field | EMIT (canonical) | TOLERATE (parser) | Notes |
|-------|------------------|-------------------|-------|
| **id** | `**T1**` (bold, `T`-prefixed integer) | `T1` / `**T1**` / `1.` | T-ids are insertion-safe labels, not positions — insert `T7…T10` mid-plan without renumbering; no markdown `1.` auto-renumber footgun; greppable; split-friendly (`T2a`/`T2b`). |
| **kind** | `[engineer]` / `[analyst]` after the id, optional | same / absent → `unspecified` | cheap to type; only when the role matters. |
| **done** | `` `[x]` `` after the kind, optional | `` `[x]` `` / `[x]` | set by the implement loop after ground-truth; hand-writable. |
| **pause** | `⏸ PAUSE: <decision>` inline at the END of the description (or Expected Output) | `⏸ PAUSE:` / `PAUSE:` (glyph optional) | declares a planned decision pause; absent → none. |
| **Deps** | `none` \| `T1` \| `T1, T2` | `none`/empty/`-`/`--`/`---`/`—`/`–` and `after T1,T2` / bare `T1, T2` | `none` is ASCII + self-documenting (the em-dash `—` is what tripped the old guard and isn't on most keyboards). |
| **Outputs** | `` `path` `` (comma/semicolon-separated) | same | repo- or DATA_DIR-relative artifact path(s). |
| **Expected Output** | verifiable claim with specific numbers | same | never "looks right". |
| **Verify** | `` `<cmd>` `` — exit 0 = pass | same | the per-task gate; never empty. |
| **Implements** | `CAT-01` (comma-separated for many) | same | SPEC requirement id(s). |

## What changes in ds-plan (today → canonical)

- ids: `N. <name>` → **`**Tn** <name>`** (drop integer-position ids — the renumber/auto-renumber footgun).
- deps: `---` / `after N` → **`none`** / **`T1, T2`** (drop the `after` keyword and the em-dash; bare id list).
- ADD the `⏸ PAUSE:` marker to the documented format (planned decision pauses; the compiler lifts it to `pauseAfter`).
- keep unchanged: `[engineer]`/`[analyst]`, `` `[x]` ``, Outputs, Expected Output, Verify, Implements, the
  coverage invariant (every v1 SPEC id appears in ≥1 row).

## Why this is safe to ship

- The **parser/guard already accept the canonical form** — `none` is already in the no-deps set; T-ids,
  bare comma-deps, `⏸ PAUSE:`, `[x]`, `[engineer]` all already parse (proven in `tests/ds_plan_table_test.py`
  + the real muni plan). So this is a `ds-plan` *output* change only; no parser/guard/compiler change needed.
- The guard stays **tolerant** (rejects only genuinely broken plans: missing cells, cycles, dangling deps) —
  we do NOT reintroduce the old guard's sin of rejecting a legitimate hand-written plan.

## Open ergonomics checks for muni

1. `none` vs leaving the Deps cell **empty** for no-deps — `none` is more self-documenting, but is an empty
   cell faster to type? (Parser accepts both; canonical pick is yours.)
2. Pause marker placement — end of the **description** cell (as above) vs the **Expected Output** cell? muni's
   real "STOP and flag" notes lived in the description-ish prose; the parser checks Expected Output first then
   the whole row, so either works.
3. Anything in this spec you would NOT want to type by hand mid-conversation?
