# pyfixest Table Formatting Reference

`pyfixest.etable()` produces publication-ready regression tables via great_tables.
Output renders natively in marimo and Jupyter.

## Basic Usage

```python
import pyfixest as pf

fit1 = pf.feols("y ~ x1 + x2 | fe1", data=df, vcov={"CRV1": "cluster_var"})
fit2 = pf.feols("y ~ x1 + x2 | fe1 + fe2", data=df, vcov={"CRV1": "cluster_var"})

pf.etable([fit1, fit2])  # returns great_tables GT object
```

## etable() Parameters

### Format & Output

| Param | Default | Description |
|-------|---------|-------------|
| `type` | `"gt"` | Output: `"gt"` (great_tables), `"df"`, `"md"`, `"tex"`, `"html"` |
| `file_name` | `None` | Save path for tex/html output |

### coef_fmt — Coefficient Display Format

Signature default: `None` — which resolves to a built-in format that **does**
include significance stars. (Verified on 0.60.0: bare `etable([fit])` prints
`1.873***`.) The `"b \n (se)"` form below is what you get if you pass it
explicitly, and it has no star token — see the note under Tokens.

**Tokens:**
- `b` — coefficient estimate
- `se` — standard error
- `t` — t-statistic
- `p` — p-value
- Custom tokens from `custom_stats`

**Format specifiers** (after colon): `b:.3f`, `se:.2e`, `b:,.0f`

**Significance stars** (append `*`): `b*`, `b:.3f*`

Once you pass `coef_fmt` explicitly, stars render only if it contains `*`. A
custom format without it silently removes the stars the default supplied, and
`signif_code` cannot restore them — it sets the thresholds, not whether stars
appear.

**Layout:** `\n` = line break, `()` = parens, `[]` = brackets

**Common patterns:**
```
"b \n (se)"           — default: coef + SE
"b* \n (se)"          — with significance stars
"b* [t]\n(se)"        — stars, t-stat in brackets, SE below
"b:.3f* \n (se:.3f)"  — explicit 3 decimal places
"b* \n [ci95l, ci95u]" — stars + 95% CI
```

### Significance Stars

| Param | Default | Description |
|-------|---------|-------------|
| `signif_code` | `[0.001, 0.01, 0.05]` | Three ascending p-value thresholds for `***`, `**`, `*` |

Example: `[0.01, 0.05, 0.10]` for less stringent levels.

### Variable Selection

| Param | Default | Description |
|-------|---------|-------------|
| `keep` | `None` | Regex patterns to retain (str or list). Output follows pattern order |
| `drop` | `None` | Regex patterns to exclude. Applied after `keep` |
| `exact_match` | `False` | Treat keep/drop as exact names, not regex |

### Labels

| Param | Default | Description |
|-------|---------|-------------|
| `labels` | `None` | `{original: display}` dict for variable names |
| `cat_template` | `None` | Template for categoricals: `"{variable}={value}"` |
| `felabels` | `None` | `{fe_name: display}` dict for fixed effects rows |

### Model Headers

| Param | Default | Description |
|-------|---------|-------------|
| `model_heads` | `None` | List of custom column headers (one per model) |
| `head_order` | `"dh"` | `"dh"` dep var then custom, `"hd"` custom then dep var, `"d"` dep var only, `"h"` custom only |

### Fixed Effects Display

| Param | Default | Description |
|-------|---------|-------------|
| `show_fe` | `True` | Show FE indicator panel |
| `fe_present` | `"x"` | Symbol when FE present |
| `fe_absent` | `"-"` | Symbol when FE absent |

### Custom Statistics

```python
# Per-coefficient custom values (displayed in coef cells)
custom_stats={"wild_p": [[0.03, 0.12], [0.01, 0.08]]}
# Then: coef_fmt="b* \n (se) \n [wild_p]"

# Per-model stats (displayed as bottom-panel rows)
custom_model_stats={"Adj. R²": [0.45, 0.52], "AIC": [1200, 1180]}
```

### Notes

| Param | Default | Description |
|-------|---------|-------------|
| `notes` | `""` | Custom footer text. Empty string = auto-generated |

## Visualization

```python
pf.coefplot([fit1, fit2], alpha=0.05)   # coefficient plot with CIs
pf.iplot(fit_event, alpha=0.05)          # interaction/event study plot
```

Both accept `keep`, `drop`, `labels`, `figsize`, `title`.

## Common Gotchas

1. **Stars need `*` in coef_fmt** — `signif_code` alone won't show stars
2. **`keep` patterns are regex** — use `r"^X"` for prefix, `exact_match=True` for literals
3. **Singleton FE dropped** — pyfixest drops singletons by default (warning printed)
4. **IV syntax**: `"y ~ exog | fe | endog ~ instrument"`
5. **Interaction terms**: labels auto-combined from component labels
