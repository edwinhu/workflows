# parse_s1_mgmt

Extracts the officers, directors and key employees named in the **MANAGEMENT** section of an IPO
prospectus (424B4, else 424B1/424B3; S-1 and F-1 are accepted too), identifies the CEO, and derives
two director-level variables: a **self-described-founder** flag and a **VC-affiliation** flag.

Built for the question "do VCs still replace founder-CEOs before the IPO, and has VC board
representation at IPO fallen?" — the prospectus carries a `Name | Age | Position` table plus one bio
per person back to 1996, which PitchBook cannot measure before about 2010.

Sibling of `../parse_def14a_own`. `grid.go` is copied from it verbatim (one private regex renamed, to
avoid a collision with a name the test files own) and `sgml.go` is copied with `proxyTypes` widened
to the 424 / S-1 / F-1 family. Everything else is new: `parse_def14a_own`'s row parser is built for
share counts and percentages and throws bare two-digit numbers away, while here the bare two-digit
number is the whole signal.

## Usage

```bash
cd parse_s1_mgmt_go && go build -o parse_s1_mgmt .

./parse_s1_mgmt \
  -files-from filelist.tsv \
  -archive-root /wrds/sec/archives \
  -out persons.tsv.gz \
  -filings filings.tsv.gz \
  -concurrency 16
```

`filelist.tsv` is one filing per line, tab-separated, with only the first field required:

```
relpath                                   cik      accession             form   [fdate]     [company]
000155/1559720/0001193125-20-315318.txt   1559720  0001193125-20-315318  424B4  2020-12-11  Airbnb, Inc.
```

`relpath` is resolved against `-archive-root` unless it is already absolute. A missing `cik` is taken
from the path's parent directory and a missing `accession` from the file's basename.

Output is written sorted by `(cik, accession)`, so a run is byte-identical at any `-concurrency`.

### Tests

```bash
bash test.sh                 # the known-answer suite over seven verbatim excerpts
bash test.sh -run Rule6      # one Design rule
bash check_full.sh           # fixture hashes, then the same answers on the seven COMPLETE filings
```

`check_full.sh` re-cuts every fixture from its source filing and re-hashes it before building, so a
fixture edited to make a test pass fails the gate. It then runs the binary end to end over the whole
filings, which is the only stage that can catch a regex reaching Google's appended roadshow
transcript. It needs the filings locally; point `S1_FILINGS_ROOT` at them.

## Output

### `persons.tsv.gz` — one row per person in the management table

| column | meaning |
|---|---|
| `accession`, `cik`, `form` | from the filelist |
| `seq` | 1-based row order within the table |
| `name_raw` | the name cell exactly as the filing wrote it: `Marc L. Andreessen(1)(3)`, `Scott D. Cook (1).......` |
| `name` | `name_raw` with committee footnote markers, `*`/`†` and dot leaders stripped |
| `age` | the two-digit age from the table |
| `position` | the Position/Title cell |
| `section` | `officer` \| `director` \| `key_employee` \| `unknown` |
| `is_ceo` | 1 on exactly one row per filing, when the table names a chief executive |
| `founder_self_described` | see the definition below |
| `founder_evidence` | the substring that set the flag, quoted |
| `vc_affiliated` | 1 when the bio places the person at a venture capital firm |
| `vc_firm` | the firm(s) credited, `; `-separated |
| `vc_evidence` | the substring that set the flag, quoted |

The bio itself is deliberately **not** a column — it is kilobytes per person and the two evidence
fields carry what a reader needs to audit a flag.

### `filings.tsv.gz` — one row per filing, always, even when nothing parsed

| column | meaning |
|---|---|
| `accession`, `cik`, `form` | from the filelist |
| `status` | `ok` \| `no_mgmt_section` \| `no_mgmt_table` \| `parse_error` |
| `n_persons`, `n_officers`, `n_directors` | counted from the person rows, never computed separately |
| `ceo_name` | `name` of the `is_ceo` row, `""` when none |
| `ceo_founder_self_described`, `ceo_founder_evidence` | that row's founder flag and evidence |
| `ceo_since_text` | the `since ...` clause dating the CEO's tenure |
| `ceo_since_inception` | 1 when that clause is the "since inception" phrasing — see the floor below |
| `n_vc_directors` | persons with `section = director` and `vc_affiliated = 1` |

`n_officers + n_directors` excludes `key_employee`. Netflix 2002's table has a third block headed
`Key Employees`, and the co-founder Marc Randolph sits in it; a rule that counted every row of the
table would file him as an officer.

## `founder_self_described` — what it is, and what it is not

**The variable is "the filing describes this person as a founder of THIS company". It is a lower
bound on founder status, not a measurement of it. Do not label it "founder-CEO".**

It fires on one of two things, and only within the person's own record:

1. Their **own Position cell** naming the role — eBay's `Founder, Chairman of the Board and a
   director`, Snap's and Airbnb's `Co-Founder`.
2. Their **own bio**, with the issuer as the thing founded: `our founder` / `our co-founder`, `one of
   our founders`, `co-founded our company`, `founded the Company`, `founder of our company`.
3. Their **own bio**, with the issuer named **by name**: `founded LogMeIn`, `is the founder of Beyond
   Meat`, `co-founded ExactTarget`, `Prior to co-founding Twist Bioscience`, `musicmaker.com's
   founder`. The name is not guessed from the prose — it is the `COMPANY CONFORMED NAME` the
   dissemination file's SGML header states, so this referent is as strict as the `our company` one.
   A bio that drops the corporate tail (`a co-founder of Ladder` where the header says `Ladder
   Capital Corp`) matches on a leading prefix, but only when what follows the prefix is not a
   further capitalised word — `co-founded Cascade Communications Corporation` is a different company
   from `Cascade Microtech`. And the clause's subject has to be the person: Ceres's CEO's bio says
   he `was a principal at Oxford Bioscience Partners, one of the leading investors in the genomics
   field and a founder of Ceres` — the firm founded the issuer, not him.

Never the document, never the section, never another person's bio. That scoping is the entire
difficulty. Seven filings carry six live instances of a director who founded some *other* company:

| filing | person | the bio says | fires? |
|---|---|---|---|
| eBay 1998 | Howard D. Schultz | `is the founder of Starbucks Corp` | no |
| eBay 1998 | Scott D. Cook | `is the founder of Intuit Inc.` | no |
| Netflix 2002 | Michael N. Schuh | `was a founder and Chief Executive Officer of Intrinsa Corporation` | no |
| Netflix 2002 | Timothy M. Haley | `is a co-founder of Redpoint Ventures` | no |
| Facebook 2012 | Marc L. Andreessen | `is a co-founder` (of Andreessen Horowitz), `co-founded ... Opsware, Inc.` | no |
| Facebook 2012 | Erskine B. Bowles | `was a founder of Kitty Hawk Capital` | no |

and one pure string trap: Peter Thiel's firm is literally named **Founders Fund**. A document-level
or section-level token search marks all seven as founders of the issuer.

### The Netflix floor

**Reed Hastings is a Netflix co-founder. This variable reads `0` for him, by design.** His 2002
prospectus bio says only:

> Reed Hastings has served as our Chief Executive Officer since September 1998, our President since
> July 1999 and **Chairman of the Board since inception**.

No "founder", no "founded". There is nothing in the filing to key on, so the flag is false and
`ceo_since_inception = 1` is the record of why — that column exists precisely to mark the
false negatives, and it is the column to condition on when the floor matters.

The gap is **not random**: the terse "since inception" phrasing is concentrated in the earlier, more
compressed era, so a falling time series in this variable is partly a change in prospectus drafting
convention. Any trend claim needs `ceo_since_inception` reported beside it.

Two more known false negatives, both measured: Uber 2019's Garrett Camp and Travis Kalanick. Their
bios say `co-founded Uber` and `one of the co-founders ... of our company` — a company-name referent
and a split phrasing that the patterns above do not reach. The extractor is never given the issuer's
name, so the company-name form is out of reach by construction.

## `vc_affiliated`

Fires on either route, within the person's own bio:

1. The **appositive** the filings settle into from about 2002: `Kleiner Perkins Caufield & Byers, a
   venture capital firm`. The firm name is read back from the comma as the trailing run of
   proper-noun tokens, which is what stops at the `General Partner of` introducing it.
2. A **partner-grade role at a firm in a built-in dictionary** (`classify.go`'s `vcFirms`):
   `General Partner`, `Managing Partner`, `Managing Director`, `Venture Partner`, `Partner`,
   `Member`. This is the pre-2000 path — eBay 1998 carries **no appositive anywhere** in its
   MANAGEMENT section, so Robert Kagle (Benchmark) is reachable only this way.

`Managing Director` alone is not a signal: Snap's Imran Khan was a Managing Director in the
Investment Banking Division at Credit Suisse, and reads `0`. The role must land next to a firm the
dictionary knows.

Known limits, both worth carrying into any analysis:

- **The dictionary's coverage is the pre-2000 recall ceiling.** It lists the firms that backed the
  IPOs in circulation, not every firm that existed. A 1997 prospectus naming a firm it omits, with no
  appositive, reads `0`. Measure this against a known-VC-backed sample before trusting a pre-2000
  level; a falling or rising series across the 2000 boundary is a coverage artefact until shown
  otherwise.
- **The flag is affiliation as the bio states it, not a board designation.** Facebook's Erskine
  Bowles reads `1` because his bio says he `was a founder of Kitty Hawk Capital, a venture capital
  firm` — decades earlier, and he is not a VC's designee on Facebook's board. Where a filing states
  designations structurally, in the voting-agreement paragraph ("one director designated by Benchmark
  Capital Partners VII, L.P., currently Mr. Cohler"), that is a cleaner source and is **not** read
  here; its coverage across the sample is unmeasured.

## How the section and table are found

Design rules, each of which is a test in `parse_s1_mgmt_go/*_test.go`:

1. **Management table** = the header names `Age` and (`Position` or `Title`), ≥3 non-empty body rows
   sit under that header, and ≥half of those carry a bare two-digit number. The header words alone produce
   false positives — the design profile measured 5 candidates in Facebook, 13 in Uber, 8 in Netflix,
   one real table each.
2. **Columns are identified by content, not header index.** Facebook, Snap and Uber set the header
   cells with a colspan covering the spacer columns while the body cells do not, so the header's
   "Age" lands at grid column 2 and every body age at column 3. Mapping by header index reads every
   age as empty on three of the seven filings.
3. **A row with an empty Age cell is a section row** and labels the rows beneath it. A label naming
   both officers and directors (Netflix's `Executive Officers and Directors`) settles nothing and
   hands those rows to the Position-text fallback, which is also what Google and Facebook need — they
   carry no section rows at all.
4. **Bios are keyed on the table's own name list**, never on a lead-in pattern. Two conventions
   coexist — `<Name> has served as ...` before about 2010, `<Name>. Mr. <Surname> ...` after about
   2015 — and names break mid-word across HTML block boundaries (`Nikki Krishnamurth` / `y`), so every
   comparison runs on a key with punctuation and whitespace removed. Page furniture (a bare page
   number, a `Table of Contents` link) appears *inside* bios and is dropped without ending them.
5. **Extraction is bounded to the MANAGEMENT section.** Google's 424B4 appends the roadshow
   transcript and a Playboy interview, both of which say "CEO" and could say "founder".

The pre-2001 ASCII path (`ascii.go`) is a separate fixed-width parser: 515 of the 2,226 VC-backed
IPOs in the 1996-2025 window priced before 2001. The age's column in the header row anchors the
split, and the age itself identifies a person row.

## Cost

Measured on the seven profiled filings (67.2 MB raw) on a 32-core host: **218 MiB peak RSS**, under a
second wall clock.

The binary streams the prospectus out of the dissemination file rather than reading the file: it
buffers only the `<TEXT>` body of the document whose `<TYPE>` is wanted, decided from the `<TYPE>`
line that always precedes it. Every filing bundles 3-72 uuencoded `GRAPHIC` documents beside the one
prospectus, and the bigger the filing the larger their share:

| filing | file | prospectus body | body/file |
|---|---|---|---|
| eBay 1998 | 446 KB | 445 KB | 99.7% |
| Netflix 2002 | 1.9 MB | 1.7 MB | 90.8% |
| Google 2004 | 4.4 MB | 2.9 MB | 66.2% |
| Snap 2017 | 6.2 MB | 2.2 MB | 35.3% |
| Uber 2019 | 18.4 MB | 4.7 MB | 25.7% |
| Airbnb 2020 | 28.4 MB | 5.0 MB | 17.8% |

The 2020 424B4 maximum is 107.8 MB. Reading whole files at 16 workers is ~1.7 GB resident on that
tail; the streamed body is a fraction of it. The DOM of the prospectus body is still held whole,
so memory scales with the body, not the file — size a grid job's request on the p99 body, not the
median file.
