# Management Guidance (`TR.Guidance*`) — and LSEG Guidance Reports (GR)

The content set behind **guidance-reports.com** (LSEG "Guidance Reports", GR — Mayew, Pinto & Wu),
reachable as datagrid fields on the ordinary platform session. No separate entitlement was needed on
the verified account.

**Verified 2026-09-04** on the agenix platform session.

## What GR is, and what this reference gets you

GR as the website distributes it is **23,738 "Detail Guidance Report" PDFs** — 1,918 S&P 1500 firms,
FY2005–2021, 1,735,241 guidance instances over ~181 items — plus a link table to gvkey/permno/CIK and
a Python PDF parser, obtained by form from the authors and read inside Workspace.

The **underlying guidance instances are queryable as fields**, which is the path this file documents.
That is a different artifact from the PDF report: you get the instance rows, not GR's report-level
structure, its 181-item taxonomy, or its identifier link table. Reproducing GR exactly still means the
PDFs. Use the fields when what you want is the guidance data itself.

The distinction that motivates GR holds here — `Guidance Low/High Value` is populated on only **8.7%**
of instances (AAPL+MSFT, 2015–2016). The other ~91% are qualitative, i.e. outside the 13 quantitative
items I/B/E/S Guidance carries.

## The ten fields that exist

Nine of these resolve; everything else guessed from the obvious naming failed. `TR.Guidance*` is the
family — **not** `TR.CG*`, and `TR.GuidanceType`/`Topic`/`Form`/`Periodicity`/`Item`/`Level` do not
exist despite matching GR's own vocabulary.

| Field | Column label | Content |
|---|---|---|
| `TR.GuidanceDate` | Activation Date | when it was said (timestamp) |
| `TR.GuidanceText` | Guidance Text | the verbatim sentence(s) |
| `TR.GuidanceMeasure` | Guidance Measure | item, e.g. `Business Outlook`, `Revenue`, `Capital Plans` |
| `TR.GuidanceDocType` | The Doc Type | `Transcript` or `Press Release` |
| `TR.GuidancePeriodYear` | Period Year | guided fiscal year |
| `TR.GuidancePeriodMonth` | Period Month | guided fiscal month |
| `TR.GuidanceLowValue` | Guidance Low Value | numeric floor (sparse) |
| `TR.GuidanceHighValue` | Guidance High Value | numeric ceiling (sparse) |
| `TR.GuidanceCurrency` | Currency | sparse |
| `TR.GuidanceSpeaker` | Guidance Speaker | present but empty on every row inspected |

`TR.EstGuid*` (`EstGuidLowValue`, `EstGuidHighValue`, `EstGuidMeanAtDate`, `EstGuidDate`) also
resolve — the I/B/E/S quantitative side — but returned all-null for AAPL without a `Period`
parameter. They are a different surface from `TR.Guidance*`; do not mix them in one call expecting
aligned rows.

## There is no pointer to a document — the API returns the text, not a reference

**Nothing in the response links an instance back to a source document.** No document id, no URL, no
attachment, no GR report id. Twenty candidate names (`TR.Guidance{DocumentId,DocId,StoryId,URL,Link,
Source,SourceDoc,EventId,ReportId,DocTitle,DocLink,PermId,InstanceId,Id,…}`) all fail to resolve, and
the raw datagrid response confirms it structurally: `headers` carries exactly the columns you asked
for and nothing else, `links` is just `{"count": N}`, and the only identifier anywhere is
`Organization PermID` on `universe` — firm-level, not document-level.

So the traceability you get per instance is **`Activation Date` + `The Doc Type`** (`Transcript` or
`Press Release`) and nothing more. Tying an instance to the specific transcript or release means
matching on company + date + type against a separate source, and on the verified account
`trapi.data.news.read` is **not** in the token's scopes, so that source is not this API.

This is the practical trade: the field route hands you machine-readable text with no provenance
pointer; the GR PDFs carry the report structure but must be collected by hand. Neither gives you both.

## Working query

```python
import lseg.data as ld
ld.get_config().set_param("http.request-timeout", 180)   # BEFORE opening the session
# ... open platform session with signon_control=True (see SKILL.md) ...

F = ["TR.GuidanceDate", "TR.GuidanceMeasure", "TR.GuidanceDocType", "TR.GuidancePeriodYear",
     "TR.GuidanceLowValue", "TR.GuidanceHighValue", "TR.GuidanceText"]
df = ld.get_data(["AAPL.O"], F, parameters={"SDate": "2015-01-01", "EDate": "2016-12-31"})
df = df[df["Guidance Text"].notna()]        # MANDATORY — see padding, below
```

`scripts/guidance_pull.py` wraps this with the timeout, the padding drop and per-instrument batching.

## Facts

- **`SDate`/`EDate` filter the GUIDED PERIOD, not the announcement date.** `SDate=2010-01-01,
  EDate=2010-12-31` returns rows whose `Activation Date` is in **2009** and whose `Period Year` is
  2010. A 2015–2016 window returned activation dates from 2013-07-11 and period years including 2017.
  Filtering on the disclosure date means pulling a wider window and filtering `Activation Date`
  yourself.
- **Row count is not instance count — datagrid pads.** A two-instrument, two-year pull returned 29,199
  rows at exactly **0.645 non-null** on *every* content column: the block for each instrument is padded
  to the longest one. Counting rows overstates instances by ~55%. Drop null `Guidance Text` first, then
  count. The 0.645 appearing identically on unrelated columns is the tell.
- **The default HTTP timeout of 20s is what kills bulk guidance pulls**, not a row cap or an
  entitlement. Five instruments × one year raised `ReadTimeout` at the default and returned **66,447
  rows** at `http.request-timeout = 180`. Set it before opening the session. This is a general
  `lseg.data` fact that guidance hits first because the payload carries full text.
- One firm-year is thousands of instances (AAPL FY2005: 4,950 rows; MSFT 2015–2016: 22,647). Volume
  here is text, not securities — budget by firm-years, not by RIC count.
- Coverage reaches back to **FY2005**, matching GR's window. Not verified past 2021, where GR stops but
  the feed does not; AAPL returns FY2026 rows.
- **The measure vocabulary is small at the top and long-tailed.** 25 distinct measures across two firms
  × two years: `Business Outlook` (2,906), `Revenue` (2,559), `Operating Expense` (2,037), `EBIT`
  (1,906), `Capital Plans` (1,591), `Capital Expenditures`, `Tax Rate`, `Gross Profit Margin`,
  `Industry Outlook`, `Earnings Per Share`, down to `Inventory` (47). GR's ~181 items are a finer
  taxonomy than this field exposes — do not present `Guidance Measure` as GR's item list.
- **`Guidance Measure` is blank on many rows that carry text.** Filtering to non-blank measure silently
  drops qualitative instances, which are the majority and the reason to use this data at all.

## Red flags — STOP

| About to | Why wrong | Do instead |
|---|---|---|
| Report a row count as a guidance-instance count | Padding inflates it ~55% | Drop null `Guidance Text`, then count |
| Read `SDate`/`EDate` as the disclosure window | They filter the guided period; activation dates fall outside | Pull wide, filter `Activation Date` |
| Raise the batch size after a `ReadTimeout` fails | The default 20s timeout is the binding constraint | `set_param("http.request-timeout", 180)` |
| Call this "the GR data" | GR is the PDF reports plus a 181-item taxonomy and a link table | "the guidance instances underlying GR" |
| Guess more field names after one resolves | Only these ten exist; `TR.CG*` and `TR.Guidance{Type,Topic,Form}` are all invalid | Probe against the table above |

## Getting actual GR (PDFs, link table, item list)

Not an API path, and **guidance-reports.com hosts no data at all** — no PDFs, no archive, no code
repo. Verified by extracting every outbound link from all five pages: the only ones are four Google
Forms, SSRN author pages, and the RAST article. Each form emails a different artifact:

| Form (page) | What it returns |
|---|---|
| `forms.gle/XdRipz3H8HptYd1ZA` (`/gr-data-summary`) | link table for all 23,738 reports keyed to Compustat/CRSP/I/B/E/S ids, plus the full 181-item list — Excel and Stata, readme in the Excel tab |
| `/gr-data-collection` | step-by-step GR data-collection guide |
| `/gr-data-collection` | the Python PDF parser (tested on 3.11) |
| `forms.gle/8y1Gk36GyXLELTbMA` (`/other-resources`) | FLS data and code, 17,299 CIKs, 2005–2023 |

**You download the PDFs yourself from Workspace, one report at a time**, using their guide and an
active LSEG account — the site's framing is "How can I collect my *own* LSEG Detail Guidance Reports
data?". At 23,738 reports that is a scraping project, which is the practical argument for the field
route above when you want the instances rather than the report artifact.

The site currently carries a warning to check each downloaded PDF against the dashboard display:
**LSEG is re-automating the background datafeeds and PDF content may be incomplete.**
