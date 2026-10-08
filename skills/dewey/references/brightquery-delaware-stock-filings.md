# BrightQuery — Delaware Stock Filings

Dataset page: `app.deweydata.io/data/BrightQuery/<dataset>?datasetSlug=<table>` (UVA account 17881).
Measured 2026-10-08 by driving the app over CDP. The page banner reads "Dewey Subscription: You have
access to this dataset through your Dewey subscription".

## Scope

- **Coverage:** private companies whose ultimate parent is incorporated in Delaware. Legal entity ids look like `BQ_US_DE_<file number>`.
- **Refresh:** monthly, on the 11th.
- **9 tables.** Counting against a project's limit, they are ONE dataset (see `access-options.md`).

| Table | Rows | Cols | Size / format | Notes |
|---|---|---|---|---|
| Legal Entity (**PRIMARY**) | 1,386,531 | 75 | 252 MB Parquet, 32 files | |
| Corporate Status | | | | |
| Stock Class | | | | Get Sample works; **Get Data is disabled** |
| Stock Event Timeline | 1,963,609 | 7 | 53 MB CSV | |
| Stock Group | 1,137,654 | 12 | 42 MB CSV | |
| Stock Group - Most Recent | | | | |
| Stock Time Series | 422,987 | 7 | 17 MB CSV | carries stock class names; tax years 2019-2023 |
| Stock Time Series - Daily | | | | |
| Stock Time Series - Most Recent | | | | |

Blank cells were not recorded. `catalog.md` lists these tables as separate BrightQuery rows with older sizes.

## Coverage limit

The modern window (tax years 2019-2023) **cannot rebuild a 1994-2011 dual-class list on its own**. Plan any historical dual-class work around a different source.

## The Data Request Form is not a block

On Continue (primary table) or Save (supplementary table), a modal "Data Request Form: This dataset requires an institutional Dewey license..." (Email, Reason, Submit) opens **at the same time as** the download dialog. The table **is** added to the project anyway; the project's dataset list confirms it. An earlier session wrongly concluded the dataset was license-gated from this form.

- Cancel the form. Never submit it without the user's OK.
- Verify access in the project's dataset list, not from the modal.
- Add-to-project flow and project limits: `access-options.md`.
