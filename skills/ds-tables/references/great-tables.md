# great_tables Reference

Publication-quality tables for Python. Port of R's `gt` package by Posit.
Works with pandas and polars DataFrames.

## Constructor

```python
from great_tables import GT, md, html, style, loc

GT(data, rowname_col=None, groupname_col=None, auto_align=True, locale=None)
```

## Method Chaining Pattern

```python
(GT(df)
 .tab_header(title="Title", subtitle="Subtitle")
 .cols_label(col1="Display Name", col2=md("**Bold**"))
 .fmt_number(columns="price", decimals=2)
 .tab_source_note("Source: ...")
 .tab_style(style=style.fill(color="lightblue"), locations=loc.body(columns="col", rows=[0,1]))
)
```

## Column Formatting (`fmt_*`)

| Method | Purpose | Key Params |
|--------|---------|------------|
| `fmt_number` | Numeric | `decimals`, `compact`, `scale_by`, `pattern="{x}"`, `sep_mark`, `force_sign` |
| `fmt_integer` | Integer | `use_seps`, `compact`, `scale_by` |
| `fmt_percent` | Percentage | `decimals`, `scale_values=True`, `placement="right"` |
| `fmt_currency` | Currency | `currency="USD"`, `placement="left"`, `use_subunits` |
| `fmt_scientific` | Scientific | `decimals`, `exp_style="x10n"` |
| `fmt_date` | Date | `date_style="iso"` |
| `fmt_markdown` | Render MD | |
| `fmt_nanoplot` | Sparklines | `plot_type="line"` |
| `fmt` | Custom fn | `fns=callable` |

All accept `columns=` (str, list, or None=all) and `rows=` (list of indices or None=all).

## Column Management

```python
.cols_label(original="Display Name", price=md("Price ($)"))
.cols_align(align="right", columns=["price", "qty"])
.cols_width(cases={"name": "200px", "price": "100px"})
.cols_move(columns="name", after="id")
.cols_hide(columns="internal_id")
```

## Headers & Structure

```python
.tab_header(title="Main Title", subtitle="Subtitle")
.tab_spanner(label="Group Header", columns=["col1", "col2"])
.tab_stubhead(label="Row Labels")
.tab_source_note("* p < 0.05, ** p < 0.01")
```

## Styling

```python
# Style specific cells
.tab_style(
    style=style.text(weight="bold", color="red"),
    locations=loc.body(columns="pvalue", rows=lambda df: df["pvalue"] < 0.05)
)

# Background fill
.tab_style(style=style.fill(color="#f0f0f0"), locations=loc.body(rows=[0, 2, 4]))

# Borders
.tab_style(
    style=style.borders(sides="bottom", weight="2px", color="black"),
    locations=loc.column_labels()
)
```

### Style Objects
- `style.text(color, font, size, weight, style, decorate, transform, align)`
- `style.fill(color)`
- `style.borders(sides, color, style, weight)` — sides: "all", "top", "bottom", "left", "right"
- `style.css(rule)` — raw CSS

### Location Targets (`loc.*`)
- `loc.body(columns, rows)` — data cells
- `loc.column_labels(columns)` — header row
- `loc.header()`, `loc.title()`, `loc.subtitle()`
- `loc.stub()`, `loc.stubhead()`
- `loc.row_groups()`, `loc.spanner_labels()`
- `loc.source_notes()`, `loc.footer()`

## Data Coloring

```python
.data_color(
    columns="value",
    palette="RdBu",       # ColorBrewer name or list of colors
    domain=[0, 100],
    na_color="#808080",
    reverse=False,
    autocolor_text=True    # auto light/dark text for contrast
)
```

## Quick Themes

```python
.opt_stylize(style=1, color="blue")  # 6 styles x 6 colors = 36 presets
.opt_row_striping()
.opt_all_caps()
.opt_vertical_padding(padding="4px")
.opt_horizontal_padding(padding="8px")
```

## Missing/Zero Substitution

```python
.sub_missing(missing_text="—")
.sub_zero(zero_text="—")
```

## Export

```python
gt.as_raw_html()        # HTML string
gt.save("table.html")   # save to file
gt.as_latex()            # LaTeX string
gt.show()               # display in notebook
```

## Helpers

- `md("**bold** _italic_")` — markdown in labels/titles
- `html("<b>bold</b>")` — HTML in labels/titles
- `from_column("col")` — dynamic styling from data values
- `px(50)`, `pct(50)` — CSS units
