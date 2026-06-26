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

## Ergonomics pass — RESOLVED (muni, 2026-06-26, blessed)

1. **no-deps: emit `none`, not empty.** Self-documenting; keeps every Deps cell content-bearing
   (`T1` / `T1, T2` / `none`) for a consistent scan rhythm; avoids fragile empty-cell markdown
   (`| |` vs `||` typos, trailing-space drift). The 4 keystrokes are nothing next to the row's prose.
2. **pause marker: end of the DESCRIPTION cell.** The pause is a decision about the task's
   approach/scope (the description's job); Expected Output stays a clean verifiable completion claim.
   Matches how muni actually wrote the "STOP and flag" notes. (Expected-Output placement still parses
   — tolerated, just not the emitted canonical spot.)
3. **Nothing blocks hand-typing**, and the two things that *looked* like the em-dash trap recurring
   are already safe in the parser (verified, not just documented): the `⏸` glyph is optional
   (`(?:⏸\s*)?PAUSE:`), and the `—` between id and description is not load-bearing (the parser strips
   the id token and takes the rest as the description; it never splits on `—`). The only fix needed
   was **doc clarity** — so the canonical example isn't misread as a keyboard mandate. Added as the
   "Decorative, not required" note in the spec + the ds-plan skill.

**Status: SHIPPED** — `ds-plan`'s executable-table block now emits the canonical form above (verified
the new example parses + passes the guard, with the T3 pause lifted). No parser/guard/compiler change.
