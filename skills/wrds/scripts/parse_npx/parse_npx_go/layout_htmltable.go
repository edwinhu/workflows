package main

import (
	"regexp"
	"sort"
	"strings"
	"time"
)

// htmltable is the generic HTML <table> layout: the residue of the legacy era
// that no named vendor layout claims but that still prints its columns in a real
// table. 17,637 of the 26,749 skipped filings are HTML table documents, and a
// strict cell-level header test keys 9,018 of them. One mapper covers Shu's
// A.1/A.2 (ISS ProxyExchange), B (Glass Lewis) and C (Broadridge) formats plus
// the family residue, because 3,073 raw header tuples collapse to 95 canonical
// field sets once HTML entities are decoded.
//
// It cannot use layoutEntry.Parse: that receives stripHTML'd text, and the table
// markup is the ONLY record of which cell belongs to which column. It therefore
// registers a ParseRaw hook over the charset-decoded bytes.
//
// THE RULE THAT SHAPES EVERY DECISION HERE: a mis-mapped column is worse than a
// skip. These filings are small family funds ISS Voting Analytics does not
// cover, so a wrong mapping cannot be caught downstream by disagreement with a
// vendor -- it enters the panel looking like good data. Two of five sampled
// filings offered a false header to a loose test (a data row
// `TMB | CUSIP 87974D100 | Voted`, and an agent-for-service paragraph). Hence
// the strict header test below, and hence errLayoutDeclined rather than a
// best-effort parse when no row qualifies.

// htmlMaxCells caps the cells read from one row. A vote table has fewer than
// twenty columns; a row past this cap is presentational markup, and the cap is
// what stops a pathological document from materialising millions of cells.
const htmlMaxCells = 512

// htmlMaxCellBytes caps the markup one cell may span before the row is dropped
// whole. Truncating a cell would corrupt a value silently, so an oversized cell
// disqualifies its row instead. A proposal description is kilobytes; a megabyte
// of markup between two </td> terminators is not a table cell, and these are
// untrusted third-party bytes read at up to 155 MB a filing.
const htmlMaxCellBytes = 1 << 20

// htmlHeaderLookahead is how far past a candidate header the arity check looks,
// and htmlHeaderConfirm how many of those rows must line up with it. A label-like
// row with no table under it is a caption, not a header.
const (
	htmlHeaderLookahead = 15
	htmlHeaderConfirm   = 3
)

// htmlMaxRepeatKeys bounds how many distinct header tuples the repeat scan will
// track. Twenty column labels of up to htmlLabelMaxLen bytes is the widest key a
// candidate can produce, so the map is bounded at roughly 1.6 MB on a document
// engineered to defeat it -- and a real filing prints a handful of distinct
// header shapes, not a thousand. Past the cap the scan stops learning NEW keys
// and keeps counting the ones it has, which degrades toward the follow-row rule
// rather than toward accepting anything.
const htmlMaxRepeatKeys = 1024

// htmlArityTolerance is how far a data row's cell count may drift from its
// header's and still be that table's row. Filers merge and pad cells; two is
// wide enough for that and narrow enough to exclude the one-cell block headings
// that separate meetings.
const htmlArityTolerance = 2

// htmlHeaderMinCells / htmlHeaderMaxCells bound how many non-empty, non-numeric
// cells a header row may carry.
const (
	htmlHeaderMinCells = 3
	htmlHeaderMaxCells = 20
)

// htmlHeaderWideMaxCells / htmlHeaderWideLabelMaxLen govern the band above
// htmlHeaderMaxCells. The ISS institutional export is an ordinary grid of 21 to
// 24 labelled columns (Ranger Funds 2020 prints 21, Johnson Mutual Funds 2011
// prints 24), and the cap refused it for its WIDTH alone even though every
// synonym it needs is already mapped. The cap guards against mistaking a wide
// prose block for a header, so past 20 the ceiling becomes conditional on the
// thing it was really protecting: every label must be SHORT. The longest label
// of that export is `Institutional Account Name`, 26 bytes.
const (
	htmlHeaderWideMaxCells    = 24
	htmlHeaderWideLabelMaxLen = 32
)

// htmlTableNilSentinels are affirmative no-vote statements seen in the SEC's
// lettered Item 1 table. They are checked only in a short governed row and only
// when no content-bearing row follows it, so a no-vote block cannot erase a real
// vote table later in the same multi-fund filing.
var htmlTableNilSentinels = []string{
	"no proxies to report",
	"no proxy votes to report",
	"did not receive any proxies",
	"no votes to report",
	"did not vote any",
	"no matters were voted",
}

// htmlLabelMaxLen caps how long an ordinary header cell may be. The SEC's own
// lettered (h) wording is a full parenthetical instruction, so a cell carrying a
// valid (a)-(i) prefix gets a separate bounded ceiling rather than weakening the
// prose guard for every other table.
const (
	htmlLabelMaxLen         = 80
	htmlLetteredLabelMaxLen = 256
)

// parseHTMLTableRaw walks the document's table rows over the charset-decoded
// bytes. It returns errLayoutDeclined when no row qualifies as a header, which
// leaves the filing parse_status=skip with a body-derived signature rather than
// parsed against a guessed header.
func parseHTMLTableRaw(raw []byte, _ string, meta FilingMeta) ([]VoteRow, error) {
	body := htmlTableBody(raw)
	// Built ONCE per filing: these bodies reach 142 MB and 452,552 vote rows, so
	// a per-row rebuild would make the job quadratic in the input.
	seriesIx := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK)
	issFormerKeys(seriesIx, meta.FormerNames)
	dict := cikDict.exactFallback(meta)
	if indexFrom(body, 0, "</tr>") < 0 {
		return nil, errLayoutDeclined
	}

	feed := &htmlRowFeed{src: body}
	repeats := &htmlHeaderRepeats{body: body}
	var (
		out           []VoteRow
		mapping       map[string]int
		headerArity   int
		carry         bool
		partitioned   bool
		sawData       bool
		ctx           htmlContext
		ctxLead       string
		leadTicker    string // a bare ticker line under the issuer heading
		stacked       map[int]string
		stackedIssuer string
		// headerCells is the row the open mapping was read from, for the
		// spacer-shift realignment (htmlRealignBySpacers).
		headerCells []string
		leadJoin    bool
		// fundCells is the set of distinct fund-cell values in the open table.
		fundCells map[string]bool
		// lastFundCell is the last value the open table's fund COLUMN printed,
		// carried onto the continuation rows that leave the column blank.
		lastFundCell   string
		lastFundSeries string
		// lastFundIssuer is the issuer that row printed, so a continuation row
		// repeating the same issuer is recognised as the same block.
		lastFundIssuer string
		ctxSealed      bool
		nilRow         bool
		// curSeries is the fund the following blocks belong to. This layout
		// stamped NO series of its own: measured 2026-08-31, 10.20% of its
		// 55,195,672 rows carried one and every such row came from the chassis
		// single-series fallback, so every multi-series filing contributed
		// nothing to the ISS link. 7,385 of its 12,546 filings declare series and
		// print a fund heading, and those filings hold 44,801,362 rows.
		curSeries string
		// curFund is the fund name as the filing printed it, recorded on every
		// row so an unattributed section shows as unmatched, not unnamed.
		curFund      string
		outerSection bool // a resolved enclosing heading, not a labelled account cell
		// reportFund is the fund a `Vote Summary Report` title page named, which
		// every continuation page of that report belongs to even though none of
		// them repeats it. It is what a page break restores, in place of
		// whatever heading the last page left standing.
		reportFund   string
		reportSeries string
		// fundCol is the column a lone `Portfolio Name` header cell opened, in
		// which a later lone cell names the block's fund.
		fundCol = -1
		// accountNames maps an internal account number to the account name the
		// filing printed beside it, for the rows that later print the number in
		// the name's own cell. "" marks a number two names answered to.
		accountNames map[string]string
		// The split-page halves: a table whose header names only identity
		// columns is the LEFT half of a page too wide to print in one table,
		// and the table that follows it carries the same rows' votes in the
		// same order (MET Investors Series Trust 2013).
		half htmlSplitHalf
		// brandOnlyFund is the heading that names the registrant's brand and a
		// type word and nothing else, and brandOnlyRows the rows standing under
		// it: a section the filing proves exists but never names, resolved by
		// elimination against the declared set once the file is read.
		brandOnlyFund string
		brandOnlyRows []int
	)

	for {
		row, ok := feed.next()
		if !ok {
			break
		}
		cells := row.cells

		// One ballot printed over two <tr>s: the upper carries the item and the
		// proposal, the lower the nominee and the vote words (Dominion Funds
		// 2010). Emitting both halves would file a vote-less parent row beside
		// the real one, so the halves are read as the one row they are.
		if mapping != nil && len(cells) == headerArity {
			if below, exists := feed.peek(0); exists && !below.newTable &&
				htmlSplitBallotRows(cells, below.cells, mapping) {
				cells = htmlMergeBallotRows(cells, below.cells, mapping)
				_, _ = feed.next()
			}
		}

		// Once the filing has stated that this block held no votes, any later row
		// carrying two values is enough to withdraw that conclusion. It may be a
		// second fund's compact table; returning skip is safer than recording those
		// votes as a successful zero-row filing.
		if nilRow && htmlNonEmptyCells(cells) >= 2 {
			nilRow = false
		}

		// A </table> normally ends the mapping with it. The two licensed exceptions
		// are proved by their headers: carry crosses one empty header-table boundary;
		// partitioned crosses repeated one-row tables only while each new row is a
		// mapped vote, a context row or the repeated header itself. An unrelated new
		// table therefore still closes the mapping rather than inheriting columns.
		if row.newTable {
			fundCells = nil
			lastFundCell, lastFundSeries, lastFundIssuer = "", "", ""
			half.closeTable(out)
		}
		deferredBoundary := row.newTable && partitioned
		if row.newTable && !partitioned {
			if carry && !sawData {
				carry = false
			} else {
				mapping, headerArity, carry = nil, 0, false
			}
		}

		// The block heading printed between the two tables carries this block's
		// meeting, and it belongs to no row's cells at all.
		// The fund heading sits BETWEEN tables, not in any row, which is why it
		// is read from row.pre rather than from cells. An unresolved heading
		// clears the carried fund rather than leaving the previous one standing:
		// a blank series_id costs coverage, a wrong one files this fund's votes
		// under the fund above it.
		// A line that RESOLVES to a declared series is the strongest evidence
		// of the fund a section belongs to, and is read first; the labelled
		// heading's positional reading (the line under the banner) comes
		// second, because one vintage prints the reporting period there and
		// the fund's name above the banner (Ivy Funds VIP, ~500k rows read as
		// `Reporting Period: ...` on 2026-09-02).
		// ... except a heading that names NOTHING while a resolved fund is
		// standing: Valued Advisers Trust prints the fund only on the section's
		// first page and heads every continuation page with the bare `Vote
		// Summary Report` banner over its reporting period (S000029069, 981 rows
		// with no series). A nameless banner is a page break, not a new section,
		// so it leaves the resolved fund alone; an unresolved one still clears.
		// A page break whose preamble is the banner over the report's own run
		// parameters names NO portfolio: the report named it once, on its first
		// page, and everything printed under the parameters is the page's own
		// first ISSUER (Met Investors Series Trust 2012, 1,091 continuation
		// pages, 15,285 rows). Nothing in such a block may be adopted, so the
		// fund resolved before the break carries across it.
		if htmlPageBreakPreamble(row.pre) {
			// The page belongs to the report, not to the heading the page
			// before it left standing: an issuer heading adopted mid-page
			// would otherwise run on through every page after it.
			if reportSeries != "" {
				curFund, curSeries, outerSection = reportFund, reportSeries, true
			}
		} else if name, id, ok := htmlFormNPXSleeveBanner(seriesIx, row.pre); ok {
			curFund, curSeries, outerSection = name, id, true
		} else if name, id, ok := htmlBareFundLine(seriesIx, row.pre, dict); ok {
			curFund, curSeries, outerSection = name, id, id != ""
			if id != "" && htmlBannerBlock(row.pre) {
				reportFund, reportSeries = name, id
			}
		} else if name, ok := htmlFundHeading(row.pre); ok && (name != "" || curSeries == "") {
			curFund = name
			curSeries = icrResolveFundShared(seriesIx, name)
			outerSection = curSeries != ""
		}
		// One vintage prints the labelled heading as TWO CELLS of a table row,
		// `Fund Name :` beside the name (Putnam, ~1M rows): the label is the
		// evidence, exactly as it is on a line.
		if label, value, ok := htmlLabelledCells(cells); ok && htmlFundLabelled(label+":") {
			id := icrResolveFundShared(seriesIx, value)
			// `Name of Fund: Legg Mason Charles Street Trust, Inc.` (Legg Mason
			// Charles Street Trust 2005, 61 rows): the labelled value is the
			// filing's own COMPANY CONFORMED NAME in full, so it names the
			// registrant and not a fund. It is not adopted at all -- the section
			// heading above the vote table, and the `on behalf of <name>` Item 1
			// prose, are the fund of record.
			if id == "" && normalizeSeriesName(value) == seriesIx.registrantKey {
				continue
			}
			// A registrant or sleeve label cannot erase a proven outer section.
			if id != "" || !outerSection {
				curFund, curSeries, outerSection = value, id, false
			}
			continue
		}
		if row.pre != "" {
			if next, labelled := htmlReadContext([]string{row.pre}); labelled {
				if ctxSealed {
					ctx = htmlContext{}
					ctxSealed = false
				}
				ctx.merge(next)
			} else if lead := htmlPreLead(row.pre, curFund); lead != "" {
				// The issuer as a paragraph BETWEEN tables, `<P>3M COMPANY</P>`
				// above the identity table (FundVantage Trust, 101,061 of
				// 108,913 rows with no issuer on 2026-09-02). A candidate only:
				// it is adopted when the row that follows carries a label.
				ctxLead = lead
			}
		}

		// The fund named inside a cover-table cell (`ProxyEdge` / `Meeting Date
		// Range: ...` / `The Gabelli Equity Income Fund`): a line of a row with at
		// most two filled cells that resolves to a declared series, under the
		// same rules as a bare paragraph.
		// The `Registrant:` label may stand in a cell of its OWN, with the fund
		// in the next cell and the exhibit marker in a third: Epiphany Funds
		// splits its cover row that way for one section and puts label and value
		// in one cell for the next (Epiphany Funds 2012, 1,441 of 1,561 rows with
		// no fund name at all). The reading is the same either way -- a label
		// cell, a fund cell, and an exhibit cell that is not part of the name --
		// so the label and its value are rejoined and the exhibit cells dropped.
		if joined, ok := htmlRegistrantSplitCells(cells); ok {
			if name, id, ok := htmlBareFundLine(seriesIx, joined, dict); ok {
				curFund, curSeries, outerSection = name, id, id != ""
				continue
			}
		}
		if htmlFilledCells(cells) <= 2 {
			heading := strings.Join(cells, "\n")
			registrantSection := false
			if htmlFilledCells(cells) == 2 {
				var filled []string
				for _, cell := range cells {
					if value := strings.TrimSpace(cell); value != "" {
						filled = append(filled, value)
					}
				}
				// Only a separate exhibit cell may follow a fund-valued Registrant;
				// do not relax the guard for prose between tables.
				if strings.HasPrefix(strings.ToLower(filled[0]), "registrant:") && reHTMLSplitExhibit.MatchString(filled[1]) {
					heading, registrantSection = filled[0], true
				}
			}
			if htmlFilledCells(cells) == 1 {
				if flat := htmlFlat(heading); strings.HasPrefix(flat, "In All Markets, for all voted ballots, for ") {
					heading = flat
				}
			}
			name, id, ok := htmlBareFundLine(seriesIx, heading, dict)
			if !ok {
				// One heading CELL may hold several paragraphs, and the name
				// runs across them: `Wright Major` / `Blue Chip Equities Fund`
				// in one <TD> (Wright Managed Equity Trust 2010, 942 rows).
				// The cell's own paragraphs are one line, and only a name that
				// still resolves is adopted.
				if flat := htmlFlattenCells(cells); flat != heading {
					name, id, ok = htmlBareFundLine(seriesIx, flat, dict)
				}
			}
			// The fund as the leading COLUMN of the vote table, named once per
			// block in the cell under a `Portfolio Name` header cell and blank
			// on every row after it (Masters Select Funds Trust 2005, 1,892
			// rows, which prints no section heading at all). The label is the
			// evidence: the value is read only from the column that header
			// cell opened, and only when it resolves.
			if !ok && fundCol >= 0 && fundCol < len(cells) && htmlFilledCells(cells) == 1 && strings.TrimSpace(cells[fundCol]) != "" {
				if value := htmlFlat(cells[fundCol]); value != "" && !htmlFundLabelled(value) {
					if fid := icrResolveFundShared(seriesIx, value); fid != "" {
						name, id, ok = value, fid, true
					} else if fid := htmlDictionaryFund(seriesIx, dict, value); fid != "" {
						name, id, ok = value, fid, true
					} else if fid := htmlFundColumnStem(seriesIx, value); fid != "" {
						name, id, ok = value, fid, true
					}
				}
			}
			if ok {
				curFund, curSeries, outerSection = name, id, registrantSection && id != ""
			} else if value, brandOnly := htmlBrandOnlyHeading(seriesIx, heading); brandOnly {
				// A heading that names the registrant and a type word and
				// nothing else cannot resolve, but it does open a section.
				curFund, curSeries, outerSection = value, "", false
				brandOnlyFund = value
			}
			// A lone header cell naming the fund column opens it for the rows
			// below; it is not itself a fund.
			if htmlFilledCells(cells) == 1 {
				for i, cell := range cells {
					if v := htmlFlat(cell); v != "" && htmlFundLabelled(v) {
						fundCol = i
					}
				}
			}
		}

		// The identity half of a split page: its header names identity columns
		// and no vote column at all, so no mapping opens on it and its rows
		// reach nothing below. Recording them here is additive -- the row is
		// still offered to every reader beneath -- and the values are used only
		// when the next table emits exactly as many rows.
		half.read(cells)

		// A label/value row whose labels wrap inside their cells (`Ticker /
		// Symbol | JAVA | Meeting / Date | 16-Jul-2009`, Green Century 2010)
		// looks like a header stacked over rows to the split-header reader,
		// which consumed it. A row that reads as context WITH a value is context.
		// So does a bare-labelled row (`Meeting Date | 22-Apr-20` between the
		// proposals, FS Series Trust 2020; `Ticker Symbol | AEM | | Meeting
		// Date | 28-Apr-2017`, CM Advisors 2017; 1,317 undated rows on r185),
		// which the split-header reader took for a header over its rows.
		if wrapped := htmlHasWrappedLabelCell(cells) || htmlBareLabelledValueRow(cells) || htmlPartialMeetingDateCell(cells); wrapped {
			next, labelled := htmlReadContext(cells)
			enough := labelled && (next.MeetingDate != "" || pvTextCUSIP(next.CUSIP) || isinToken(next.ISIN))
			if labelled && !enough && next.Issuer != "" && next.CUSIP != "" {
				// The first row of the wrapped identity strip carries the
				// issuer and a SEDOL rather than a CUSIP (Guinness Atkinson
				// Funds 2007), and its date is on the row below. Asked only
				// once the cheaper evidence is absent.
				_, enough = htmlWrappedLabelStripRow(cells)
			}
			if enough {
				if ctxSealed {
					ctx = htmlContext{}
					ctxSealed = false
				}
				if next.Issuer == "" && ctxLead != "" {
					next.Issuer = ctxLead
				}
				ctxLead, leadTicker = "", ""
				ctx.merge(next)
				continue
			}
		}
		if labels, name, ok := htmlSplitStackedLabelsWithIssuer(cells, feed); ok {
			stacked, stackedIssuer = labels, name
			continue
		}
		if m, joined, mayCarry, mayPartition, consumed, ok := htmlSplitHeaderMapping(cells, feed, repeats); consumed {
			if ok {
				if _, has := m[htmlFieldDesc]; !has && !htmlAdoptUnlabelledDesc(cells, m, feed) {
					// a split header with no description column and none to adopt
					// beneath it maps nothing (the ProxyEdge full-width table)
					ok = false
				}
			}
			if ok {
				mapping, headerArity = m, len(cells)
				headerCells = joined
				carry, partitioned, sawData = mayCarry, mayPartition, false
				ctxLead, ctxSealed = "", true
			}
			continue
		}
		if m, mayCarry, mayPartition, ok := htmlHeaderMapping(cells, feed, repeats); ok {
			mapping, headerArity = m, len(cells)
			headerCells = cells
			carry, partitioned, sawData = mayCarry, mayPartition, false
			ctxLead, ctxSealed = "", true
			continue
		}
		// A stacked label row (`ISSUER NAME | TICKER | CUSIP | MTG DATE | MTG
		// TYPE`) is header-shaped too; it must be recognised before the
		// header-shape skip below, or its values two rows down (Putnam 2005:
		// a column header sits between) lose their date. Only identity labels
		// qualify, so a vote-table header can never land here.
		if next, ok := htmlInCellStacked(cells); ok {
			// Labels stacked INSIDE one cell, values inside the next (Clearwater
			// Investment Trust 2011): each line of the label cell names the same
			// line of the value cell. The issuer printed on its own row above
			// (Gabelli's ProxyEdge grid) is this row's issuer.
			if ctxSealed {
				ctx = htmlContext{}
				ctxSealed = false
			}
			if next.Issuer == "" && ctxLead != "" {
				next.Issuer = ctxLead
			}
			ctxLead, leadTicker = "", ""
			ctx.merge(next)
			continue
		}
		if labels, name, ok := htmlStackedLabelsWithIssuer(cells); ok {
			stacked, stackedIssuer = labels, name
			continue
		}
		// A label-shaped row that lacks the required table beneath it is not data.
		// Ignoring it is safer than emitting "Vote Cast" as a fund's actual vote.
		if _, _, headerLike := htmlHeaderShape(cells); headerLike {
			continue
		}

		// Account allocations can follow the proposals inside the same table.
		// Their share counts must not inherit the proposal vote mapping.
		account, shares, class := false, false, false
		for _, c := range cells {
			switch htmlCanonLabel(c) {
			case "ACCOUNT NAME":
				account = true
			case "SHARES":
				shares = true
			case "CLASS":
				class = true
			}
		}
		if account && shares && class {
			mapping, headerArity, carry, partitioned = nil, 0, false, false
			continue
		}

		if mapping != nil && htmlIsTableNilRow(cells) {
			nilRow = true
			continue
		}

		// One-cell issuer headings are tentative until a following labelled context
		// row proves what they are. This is the split used by the partitioned export:
		// issuer, then Ticker Symbol/Cusip Number, then Record Date/Meeting Date.
		// The stacked grid: a row of bare labels (`Ticker | Security ID: |
		// Meeting Date | Meeting Status`) and the values in the SAME columns of
		// the next row (Putnam Variable Trust, 36,599 rows with the issuer read
		// as "Ticker" and no security id or date on 2026-09-02).
		if stacked != nil && htmlFilledCells(cells) == 0 {
			// A blank spacer row between the labels and their values (Buffalo
			// Funds: 124k rows with no issuer, id or date on 2026-09-02).
			continue
		}
		if stacked != nil {
			labels := stacked
			stacked = nil
			if next := htmlStackedValues(cells, labels); next != (htmlContext{}) {
				if next.Issuer == "" && stackedIssuer != "" {
					next.Issuer = stackedIssuer
				}
				stackedIssuer = ""
				if ctxSealed {
					ctx = htmlContext{}
					ctxSealed = false
				}
				if next.Issuer == "" && ctxLead != "" {
					next.Issuer = ctxLead
				}
				ctxLead = ""
				ctx.merge(next)
				continue
			}
		}
		if labels, name, ok := htmlStackedLabelsWithIssuer(cells); ok {
			stacked, stackedIssuer = labels, name
			continue
		}
		if lead, candidate := htmlContextLead(cells); candidate && (ctx.Issuer == "" || len(cells) == 0 || htmlFlat(cells[0]) != "") {
			// An issuer wrapped over two one-cell rows: `Putnam Money Market
			// Liquidity` then `Fund`. Only a short continuation joins.
			if leadJoin && htmlTickerShaped(lead) {
				// `WACHOVIA CORPORATION` over `WB` (Manning & Napier 2007): the
				// ticker on its own line is not part of the name.
				leadTicker = lead
			} else if leadJoin && len(strings.Fields(lead)) <= 2 {
				ctxLead += " " + lead
			} else {
				ctxLead = lead
			}
			leadJoin = true
			continue
		}
		leadJoin = false

		// The context test runs BEFORE the data test, and must: in this grammar the
		// meeting identity is printed in block rows whose cell count often falls
		// inside the arity tolerance of the open header. Tested second, such a row
		// is consumed as a vote, its issuer and date are never read, and the
		// PREVIOUS block's meeting stays attached to the next block's votes. A
		// labelled row arriving after a header opens a NEW block, so the previous
		// block's issuer and meeting must not leak onto it.
		// A label row that opens with the issuer's name (`Booker Group plc | |
		// Meeting Date | | Country | Security ID | ...`) is the stacked grid's,
		// and must be read as labels before htmlReadContext can take `Group
		// plc` for the issuer and `Meeting Type` for the cusip.
		if labels, name, ok := htmlStackedLabelsWithIssuer(cells); ok && name != "" {
			stacked, stackedIssuer = labels, name
			continue
		}
		if next, labelled := htmlReadContext(cells); labelled {
			if next.MeetingDate == "" {
				next.MeetingDate = htmlFollowingMeetingDate(cells, feed)
			}
			// A labelled row after a header opens a new block -- unless it
			// carries only a date: the issuer and ids of this block were
			// printed before a page-break header (Advisors' Inner Circle
			// 2023), and clearing them here files the votes under nobody.
			dateOnly := next.Issuer == "" && next.CUSIP == "" && next.Ticker == "" && next.ISIN == ""
			if dateOnly && ctxLead == "" && ctx.Issuer != "" {
				// The issuer continues; whatever one-cell line preceded this
				// (a wrapped proposal fragment, usually) is not its name.
				ctxLead = ""
			} else {
				// With no issuer to continue, a one-cell line above a date row
				// is the issuer of the interleaved export (issuer row, then
				// Meeting Date row); run59 blanked 294k such rows.
				if ctxSealed {
					ctx = htmlContext{}
					ctxSealed = false
				}
				if next.Issuer == "" && ctxLead != "" {
					next.Issuer = ctxLead
				}
				if next.Ticker == "" && leadTicker != "" {
					next.Ticker = leadTicker
				}
			}
			ctxLead, leadTicker = "", ""
			ctx.merge(next)
			continue
		}

		emitted := false
		if mapping != nil && htmlComparableArity(len(cells), headerArity) {
			if !partitioned || htmlMappedVoteValue(cells, mapping, headerArity) {
				cells = htmlRealignBySpacers(cells, headerCells, mapping)
				cells = htmlRealignTailPad(cells, headerCells, mapping)
				if r, ok := htmlDataRow(cells, mapping, headerArity, ctx); ok {
					r.SeriesID = curSeries
					r.FundName = curFund
					htmlAdoptRowFundColumn(cells, mapping, headerArity, seriesIx, dict)
					v := htmlFundCell(cells, mapping, headerArity)
					// The account-name cell degrades into the account NUMBER
					// partway through each account's block (Northern Lights
					// Fund Trust II 2022: `North Star Dividend Fund NSDVX` /
					// `6734305800` on the first rows, `6734305800` in both
					// cells thereafter; 757 rows with a numeric fund name).
					// The mapping is the filing's own -- the name is read only
					// off rows that print BOTH -- so this substitutes evidence
					// the filing states rather than guessing a fund.
					if v != "" {
						if htmlAllDigits(v) {
							if name := accountNames[v]; name != "" {
								v = name
							}
						} else if n := htmlRowAccountNumber(cells); n != "" {
							if accountNames == nil {
								accountNames = map[string]string{}
							}
							if prior, seen := accountNames[n]; !seen {
								accountNames[n] = v
							} else if prior != v {
								// Two names for one number: no substitution.
								accountNames[n] = ""
							}
						}
					}
					if v != "" {
						// The row names its own fund; the shared rules decide
						// the series. A cell they cannot read (MET Investors:
						// `MetInvestorSeriesTrustFortyPortfolio`) keeps the
						// section's series only while the table names ONE fund;
						// a table naming several refuses.
						r.FundName = v
						if fundCells == nil {
							fundCells = map[string]bool{}
						}
						fundCells[v] = true
						if id := icrResolveFundShared(seriesIx, v); id != "" {
							r.SeriesID = id
						} else if len(fundCells) > 1 && !htmlAccountCodeFundCell(v, accountNames, outerSection && curSeries != "") {
							r.SeriesID = ""
						}
						lastFundCell, lastFundSeries = r.FundName, r.SeriesID
						lastFundIssuer = htmlMappedCell(cells, mapping, headerArity, htmlFieldIssuer)
					} else if _, mapped := mapping[htmlFieldFund]; mapped && lastFundCell != "" &&
						// The EquiTrust vintage (EquiTrust Series Fund 2004) repeats the
						// issuer on every proposal row of a block while printing the fund
						// only on its first, so an issuer REPEATED from the row that named
						// the fund is the same block as a blank one.
						(htmlSameFundBlock(htmlMappedCell(cells, mapping, headerArity, htmlFieldIssuer), lastFundIssuer) ||
							// The sibling EquiTrust Variable Insurance Series Fund vintage
							// (2004, 51 rows) prints the portfolio only on the FIRST row of
							// each ISSUER block, so the next issuer opens with the cell
							// empty. In a table whose LEADING column is the fund column and
							// whose last printed value named a declared series, an empty
							// cell is that vendor's "same as above": nothing else in the
							// table names a fund, so refusing to carry it blanks the
							// section rather than protecting it.
							(htmlLeadingFundColumn(mapping) && lastFundSeries != "")) {
						// The fund column is printed once per issuer block and
						// left blank on every continuation row (The Weitz Funds
						// 2008: `BALANCED` on proposal 1, an empty cell on 2 and
						// 3; 441 of 616 rows). A blank fund cell on a row whose
						// ISSUER is carried too is a repeat of the fund above,
						// not a new nameless fund, so the value the filing
						// printed carries with the rest of the block's identity.
						r.FundName, r.SeriesID = lastFundCell, lastFundSeries
					}
					if brandOnlyFund != "" && r.SeriesID == "" && r.FundName == brandOnlyFund {
						brandOnlyRows = append(brandOnlyRows, len(out))
					}
					if u := htmlUnstackFirstItem(r); u != nil {
						r = *u
					}
					out = append(out, r)
					sawData, emitted = true, true
					// Grouped exports print the identity on a meeting's first
					// row and leave it blank on the rest (JPMorgan China Region,
					// Nuveen Investment Trust 2008): a row's own identity
					// becomes the context the next rows fall back to.
					if ctxSealed {
						ctx = htmlContext{}
						ctxSealed = false
					}
					ctx.merge(htmlContext{Issuer: r.IssuerName, CUSIP: r.CUSIP, ISIN: r.ISIN, Ticker: r.Ticker, MeetingDate: r.MeetingDate})
					// A one-cell lead is claimed by the very next context row;
					// a vote emitted in between makes it stale (a wrapped
					// proposal's first line, Advisors' Inner Circle 2023).
					ctxLead = ""
				}
			}
			if !emitted {
				// Labelled identity rows INSIDE the vote table (`Issuer | Bank
				// of America Corporation`, `Meeting Date | 22-Apr-20` between
				// the proposals, FS Series Trust 2020; CM Advisors 2017 and
				// Bragg Capital 2020 the same in their own spellings; 2,205
				// undated rows on r185): read as the block's context, the way
				// the same rows are read outside a mapped table.
				if !htmlHasVoteCell(cells) {
					if next, labelled := htmlReadContext(cells); labelled && (next.MeetingDate != "" || next.Issuer != "" || pvTextCUSIP(next.CUSIP) || isinToken(next.ISIN)) {
						if ctxSealed {
							ctx = htmlContext{}
							ctxSealed = false
						}
						ctx.merge(next)
						continue
					}
				}
				// The identity row of an export that prints issuer, ticker,
				// CUSIP and date under the SAME header as the proposals
				// (Prudential Series Fund 2005: 36,441 rows with no issuer,
				// id or date on 2026-09-02).
				next, ok := htmlIdentityRow(cells, mapping)
				if !ok {
					// The header names the columns for the ITEM rows (`CUSIP/
					// Proposal`, `Company/Ticker`), so the meeting's own row
					// is read by its shape: one date, one CUSIP, one name and
					// no vote (SSgA vote summary, Kiewit 2006).
					next, ok = htmlShapeIdentityRow(cells)
				}
				if ok {
					if ctxSealed {
						ctx = htmlContext{}
						ctxSealed = false
					}
					ctx.merge(next)
				}
			}
		}
		if deferredBoundary && !emitted {
			mapping, headerArity, carry, partitioned = nil, 0, false, false
		}
	}

	// The vote half is normally the document's last table, so its join is
	// settled here rather than at a following </table>.
	half.closeTable(out)

	if len(out) == 0 {
		if nilRow {
			return nil, errLayoutNoActivity
		}
		return nil, errLayoutDeclined
	}
	htmlStampBrandOnlyByElimination(out, brandOnlyRows, meta.SeriesDecls)
	htmlRefuseInexactSiblingHeading(out, seriesIx)
	return out, nil
}

// htmlRefuseInexactSiblingHeading withdraws a series stamped on a heading that
// reached a declared name only by DROPPING one of its own words, when that
// declared name is itself printed as a heading elsewhere in the same filing:
// Stonebridge Funds 2006 heads one section `Stonebridge Aggressive Growth Fund`
// and another, 17,000 lines later, `Stonebridge Growth Fund`, and the relaxation
// filed both under S000006629 -- 40 rows of one fund's votes under the other's.
//
// Two distinct headings in one filing cannot be the same series. That is
// decidable from the filing alone and needs no guess about which id the dropped
// word names, so the inexact section is left blank rather than moved.
func htmlRefuseInexactSiblingHeading(out []VoteRow, ix *issSeriesIndex) {
	if ix == nil {
		return
	}
	exact := map[string]bool{}   // series ids a heading names exactly
	inexact := map[string]bool{} // the headings that reached one by a dropped word
	for i := range out {
		r := &out[i]
		if r.SeriesID == "" || r.FundName == "" {
			continue
		}
		d, _ := lookupSeriesEntry(ix.byName, r.FundName)
		if d != nil && d.SeriesID == r.SeriesID {
			exact[r.SeriesID] = true
			continue
		}
		if issInternalTokenDropDecl(ix, normalizeSeriesName(r.FundName)) != nil {
			inexact[r.SeriesID+"\x00"+normalizeSeriesName(r.FundName)] = true
		}
	}
	if len(exact) == 0 || len(inexact) == 0 {
		return
	}
	for i := range out {
		r := &out[i]
		if r.SeriesID != "" && exact[r.SeriesID] && inexact[r.SeriesID+"\x00"+normalizeSeriesName(r.FundName)] {
			r.SeriesID = ""
		}
	}
}

// htmlPrintsNoVoteTable recognises only the safest raw-markup form of a tableless
// HTML body: it prints a <table> wrapper but no opening cell tag at all. Any cell
// markup, even one short row, is evidence that the document may carry a compact or
// unfamiliar vote record and therefore stays skip unless the filing itself states
// that there were no votes.
//
// This deliberately asks nothing of htmlRowFeed or htmlCellText. Three successive
// defects came from treating a low parse yield as a fact about the document: first
// unclosed cells, then padded narrow rows, then a genuinely short vote table.
func htmlPrintsNoVoteTable(raw []byte) bool {
	body := htmlTableBody(raw)
	sawTable := false
	for i := 0; i < len(body); {
		j := indexByteFrom(body, i, '<')
		if j < 0 {
			break
		}
		name, after, ok := tagName(body, j, 0)
		if !ok {
			i = j + 1
			continue
		}
		end := indexByteFrom(body, after, '>')
		if end < 0 {
			break
		}
		closing := j+1 < len(body) && body[j+1] == '/'
		if !closing {
			switch name {
			case "table":
				// A BARE `<TABLE>` is EDGAR's fixed-width TEXT convention --
				// `<TABLE>`/`<CAPTION>`/`<S>`/`<C>`, no cell tags anywhere in
				// that era -- not a cell-less HTML table. Reading it as one
				// answered an HTML question of a body carrying no HTML and
				// recorded 18 filings that print real vote tables as
				// ok/cover-page. Attributes, or a <tr>, are the evidence.
				sawTable = sawTable || end > after
			case "tr":
				sawTable = true
			case "td", "th":
				return false
			}
		}
		i = end + 1
	}
	return sawTable
}

// htmlNonEmptyCells counts the cells carrying text. Emptiness is judged AFTER
// entity decoding: a signature block's spacer columns are &nbsp; runs, and
// counting those as content makes a three-line cover page look like a table.
func htmlNonEmptyCells(cells []string) int {
	n := 0
	for _, c := range cells {
		if strings.TrimSpace(c) != "" {
			n++
		}
	}
	return n
}

// htmlIsTableNilRow recognises an explicit no-vote statement only when it is the
// substance of a short governed row. A phrase buried in a wide row may describe
// one security among real votes and cannot decide the filing.
func htmlIsTableNilRow(cells []string) bool {
	if htmlNonEmptyCells(cells) > 2 {
		return false
	}
	return containsAnyFolded(strings.Join(cells, " "), htmlTableNilSentinels)
}

// htmlTableBody cuts the SGML envelope off the front so the header block cannot
// masquerade as a table. A file with no <TEXT> is scanned whole.
func htmlTableBody(raw []byte) []byte {
	if i := indexFrom(raw, 0, "<TEXT>"); i >= 0 {
		return raw[i+len("<TEXT>"):]
	}
	return raw
}

// ---------------------------------------------------------------------------
// Row and cell scanning
// ---------------------------------------------------------------------------

// htmlRowFeed yields one table row at a time as decoded cell text, with a
// bounded lookahead so the header test can inspect the rows beneath a candidate
// without materialising the document. Peak memory is the lookahead window, not
// the filing.
type htmlRowFeed struct {
	src     []byte
	pos     int
	buf     []htmlFeedRow
	pending bool // a </table> was seen after the last row's <tr>
}

// htmlFeedRow is one table row's decoded cells, plus whether a </table> closed a
// table between the previous row and this one. Column identity does not survive
// that boundary, so the reader has to see it.
//
// pre is the text of the markup BETWEEN the previous row and this row's own <tr>.
// It is not furniture: one family of this grammar prints the block's issuer,
// Security ID, ticker and meeting date in <div>s that sit outside every table,
// between the table that carries the column labels and the table that carries the
// votes. Dropping that text attaches the PREVIOUS block's meeting to this block's
// votes, which on funds ISS Voting Analytics does not cover nothing downstream
// can contradict.
//
// uncut says the splitter could not cut this row at all, because one of its
// cells is larger than htmlMaxCellBytes. It is reported rather than folded into
// "zero cells" because the two mean opposite things to the nil-report test: a
// row with no cells is evidence of no table, and a row we could not cut is
// evidence of a table we cannot read.
type htmlFeedRow struct {
	cells    []string
	pre      string
	newTable bool
	uncut    bool
}

// htmlMaxPreBytes caps the inter-row markup read for block headings. A block
// heading sits immediately above its table; a megabyte earlier is a cover page.
// The tail is taken rather than the head, and cut at a line break so a tag split
// down the middle cannot become text.
const htmlMaxPreBytes = 1 << 16

func htmlPreText(seg []byte) string {
	if len(seg) > htmlMaxPreBytes {
		seg = seg[len(seg)-htmlMaxPreBytes:]
		if j := indexByteFrom(seg, 0, '\n'); j >= 0 {
			seg = seg[j+1:]
		}
	}
	// A raw newline INSIDE a paragraph is markup wrap, not a line of the
	// grammar: Legg Mason Investors Trust wraps its section heading mid-element
	// (`<p><b><font>Legg Mason` / `Financial Services Funds</font></b></p>`),
	// and reading only the first line takes the bare brand `Legg Mason` as the
	// fund -- which stamps the wrong sibling. Unlike a CELL, whose stacked lines
	// are labels and values, the markup between rows is paragraphs, so the join
	// is on here and off there.
	return strings.TrimSpace(collapseSpaces(decodeEntities(removeMarkup(seg, true))))
}

func (f *htmlRowFeed) fill(n int) {
	for len(f.buf) < n {
		row, ok := f.scan()
		if !ok {
			return
		}
		f.buf = append(f.buf, row)
	}
}

// peek returns the i'th row ahead of the cursor without consuming it.
func (f *htmlRowFeed) peek(i int) (htmlFeedRow, bool) {
	f.fill(i + 1)
	if i < len(f.buf) {
		return f.buf[i], true
	}
	return htmlFeedRow{}, false
}

func (f *htmlRowFeed) next() (htmlFeedRow, bool) {
	f.fill(1)
	if len(f.buf) == 0 {
		return htmlFeedRow{}, false
	}
	row := f.buf[0]
	f.buf = f.buf[1:]
	return row, true
}

// scan reads the next row, delimited by </tr>. Anything before the row's own
// <tr> belongs to the markup between rows and is dropped -- but a </table> in
// that gap is not furniture: it closes the table the previous rows belonged to,
// and is reported so the reader can drop the column mapping with it.
// htmlFindOpenRow finds an opening <tr> before limit. The name boundary keeps
// <track> and other longer elements from becoming row delimiters.
func htmlFindOpenRow(src []byte, from, limit int) int {
	if limit > len(src) {
		limit = len(src)
	}
	for from < limit {
		i := indexFrom(src[:limit], from, "<tr")
		if i < 0 {
			return -1
		}
		after := i + len("<tr")
		if after >= limit || !isNameByte(src[after]) {
			return i
		}
		from = i + 1
	}
	return -1
}

func (f *htmlRowFeed) scan() (htmlFeedRow, bool) {
	if f.pos >= len(f.src) {
		return htmlFeedRow{}, false
	}
	close := indexFrom(f.src, f.pos, "</tr>")
	if close < 0 {
		f.pos = len(f.src)
		return htmlFeedRow{}, false
	}

	// HTML implicitly closes an open <tr> when the next <tr> begins. Legacy
	// exports rely on that rule for sizing rows: a row of empty width cells opens,
	// the real header starts without a </tr>, and the one eventual terminator
	// belongs to the header. Delimiting only on </tr> fuses both rows and doubles
	// the header arity. Search only as far as the known terminator, so each row is
	// still scanned a bounded number of times rather than rescanning the document.
	start := htmlFindOpenRow(f.src, f.pos, close)
	end := close
	implicit := false
	if start >= 0 {
		if next := htmlFindOpenRow(f.src, start+len("<tr"), close); next >= 0 {
			end, implicit = next, true
		}
	}
	segStart := f.pos
	seg := f.src[f.pos:end]
	if implicit {
		f.pos = end
	} else {
		f.pos = close + len("</tr>")
	}

	newTable := f.pending
	f.pending = false
	start = indexFrom(seg, 0, "<tr")
	if start < 0 {
		start = 0
		// An omitted opening row still has a cell boundary; keep the
		// paragraph before that cell available to the heading reader.
		var boundary htmlBoundaryFinder
		if at, _, closing, ok := boundary.next(seg, 0); ok && !closing {
			start = at
		}
	}
	// One scan for the terminator: before this row's <tr> it closed the previous
	// table, after it the table closes before the NEXT row.
	if t := indexFrom(seg, 0, "</table>"); t >= 0 {
		if t < start {
			newTable = true
		} else {
			f.pending = true
			// The row's own table ends inside this segment because the row was
			// never closed with a </tr>: the cover page of Undiscovered
			// Managers Funds 2006 ends `...</p></td> </table>`, so the segment
			// runs on to the next <tr> two headings below and swallows them
			// (439 rows with no fund, no series and no issuer). Markup past the
			// terminator belongs to no row; hand it back so it reaches the next
			// row as its pre, where the heading reader sees it.
			if consumed := t + len("</table>"); consumed < len(seg) {
				seg = seg[:consumed]
				f.pos = segStart + consumed
			}
		}
	}
	cells, cuttable := htmlRowCells(seg[start:])
	return htmlFeedRow{
		cells:    cells,
		pre:      htmlPreText(seg[:start]),
		newTable: newTable,
		uncut:    !cuttable,
	}, true
}

// htmlRowCells splits one row's markup into cells and decodes each. cuttable is
// false when the row could not be cut at all -- an oversized cell disqualifies
// the row, because truncating it would corrupt a value silently. That verdict
// travels with the row: "this splitter produced nothing" must never be read as
// "this document has no table", which is how a filing's votes vanish into
// ok/n_rows=0 instead of staying countable in skip.
//
// A cell ends at its own </td> or </th> -- OR at the <td>/<th> that opens the
// next one. That second rule is not a nicety: legacy EDGAR HTML routinely omits
// the closing tag, so
//
//	<TR><TD>Election of Directors<TD>MGMT<TD>YES<TD>AGNST<TD>FOR</TR>
//
// yields ZERO cells from a terminator-only splitter, and a filing of hundreds of
// such rows counts zero wide rows and looks tableless. HTML5's own parsing rule
// is that an opening cell tag implicitly closes the cell before it, so that is
// the rule here. The row's own </tr> already ended the segment, which is what
// lets the last unterminated cell be flushed at the end.
func htmlRowCells(seg []byte) (cells []string, cuttable bool) {
	var f htmlBoundaryFinder
	pos := 0
	open := -1 // where the cell now open begins; -1 when none is
	openSpan := 1
	for len(cells) < htmlMaxCells {
		at, after, isClose, ok := f.next(seg, pos)
		if !ok {
			break
		}
		start, span := open, openSpan
		if isClose && start < 0 {
			// A terminator with no opening tag before it: keep the old reading
			// and take everything since the cursor, tags and all.
			start, span = pos, 1
		}
		if start >= 0 {
			if at-start > htmlMaxCellBytes {
				return nil, false
			}
			var appended bool
			cells, appended = htmlAppendSpannedCell(cells, htmlCellText(seg[start:at]), span)
			if !appended {
				return nil, false
			}
		}
		if isClose {
			open, openSpan, pos = -1, 1, after
		} else {
			span, valid := htmlCellColspan(seg[at:after])
			if !valid {
				return nil, false
			}
			open, openSpan, pos = after, span, after
		}
	}
	if open >= 0 && open < len(seg) && len(cells) < htmlMaxCells {
		if len(seg)-open > htmlMaxCellBytes {
			return nil, false
		}
		if t := htmlCellText(seg[open:]); t != "" {
			var appended bool
			cells, appended = htmlAppendSpannedCell(cells, t, openSpan)
			if !appended {
				return nil, false
			}
		}
	}
	return cells, true
}

// htmlAppendSpannedCell expands a colspan onto the logical grid and places the
// cell's text in the final covered column. Legacy vote reports use colspan to
// cover an item gutter, its spacer and the description column; the label and
// the data it governs therefore align at the right edge of that span.
func htmlAppendSpannedCell(cells []string, text string, span int) ([]string, bool) {
	if span < 1 || span > htmlMaxCells-len(cells) {
		return nil, false
	}
	for i := 1; i < span; i++ {
		cells = append(cells, "")
	}
	return append(cells, text), true
}

// htmlCellColspan reads one bounded positive colspan from an opening cell tag.
// The attribute is filing-controlled: malformed, zero, negative and oversized
// values disqualify the row rather than allocating from the claimed width.
func htmlCellColspan(tag []byte) (int, bool) {
	const attr = "colspan"
	for from := 0; from < len(tag); {
		i := indexFrom(tag, from, attr)
		if i < 0 {
			return 1, true
		}
		beforeOK := i == 0 || !isNameByte(tag[i-1])
		after := i + len(attr)
		afterOK := after >= len(tag) || !isNameByte(tag[after])
		if !beforeOK || !afterOK {
			from = i + 1
			continue
		}
		for after < len(tag) && htmlIsSpace(tag[after]) {
			after++
		}
		if after >= len(tag) || tag[after] != '=' {
			// The word with no `=` after it is not an attribute at all: Excel's
			// export carries it inside a style string,
			// `style="...; mso-ignore: colspan" colSpan=2` (SM&R Investments
			// 2005), and disqualifying the row there dropped every identity and
			// vote row of the filing. Keep scanning for the real attribute.
			from = i + len(attr)
			continue
		}
		after++
		for after < len(tag) && htmlIsSpace(tag[after]) {
			after++
		}
		quote := byte(0)
		if after < len(tag) && (tag[after] == '\'' || tag[after] == '"') {
			quote = tag[after]
			after++
		}
		start := after
		span := 0
		for after < len(tag) && tag[after] >= '0' && tag[after] <= '9' {
			span = span*10 + int(tag[after]-'0')
			if span > htmlMaxCells {
				return 0, false
			}
			after++
		}
		if after == start || span < 1 {
			return 0, false
		}
		if quote != 0 {
			if after >= len(tag) || tag[after] != quote {
				return 0, false
			}
		} else if after < len(tag) && !htmlIsSpace(tag[after]) && tag[after] != '>' {
			return 0, false
		}
		return span, true
	}
	return 1, true
}

func htmlIsSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f'
}

// htmlBoundaryNeedles are the four markers that bound a cell, closing tags
// first so the index in htmlBoundaryFinder can be read as "is this a close".
var htmlBoundaryNeedles = [4]string{"</td>", "</th>", "<td", "<th"}

// htmlBoundaryFinder walks a row's cell boundaries left to right. Each needle is
// located ONCE and re-sought only after the cursor passes it, so a row costs one
// pass per needle rather than one pass per cell. Probing all four per cell is
// O(cells x rowlen) -- <th> is rare in EDGAR markup and a miss returns -1 only at
// end-of-segment, so on a 155 MB body that is a ~512x amplification of the single
// pass the row is worth.
type htmlBoundaryFinder struct {
	idx   [len(htmlBoundaryNeedles)]int
	begun bool
}

// next returns the first boundary at or after pos: at is where its markup
// starts, after is where the following cell's text begins.
func (f *htmlBoundaryFinder) next(seg []byte, pos int) (at, after int, isClose, ok bool) {
	best, bestK := -1, -1
	for k := range htmlBoundaryNeedles {
		if !f.begun || f.idx[k] < pos {
			f.idx[k] = htmlFindBoundary(seg, pos, k)
		}
		if f.idx[k] >= 0 && (best < 0 || f.idx[k] < best) {
			best, bestK = f.idx[k], k
		}
	}
	f.begun = true
	if best < 0 {
		return 0, 0, false, false
	}
	if bestK < 2 {
		return best, best + len("</td>"), true, true
	}
	// The opening tag's attributes are markup, not cell text, so the next cell
	// begins past its '>'. A tag left unterminated by the end of the row ends
	// the scan rather than becoming content.
	end := indexByteFrom(seg, best, '>')
	if end < 0 {
		return best, len(seg), false, true
	}
	return best, end + 1, false, true
}

// htmlFindBoundary locates needle k at or after from. For the opening tags the
// element name must END at the match: "<thead" is a section, not a cell, and
// treating it as one would cut every header row in two.
func htmlFindBoundary(seg []byte, from, k int) int {
	needle := htmlBoundaryNeedles[k]
	if k < 2 {
		return indexFrom(seg, from, needle)
	}
	for i := from; ; {
		j := indexFrom(seg, i, needle)
		if j < 0 {
			return -1
		}
		if n := j + len(needle); n >= len(seg) || !isNameByte(seg[n]) {
			return j
		}
		i = j + 1
	}
}

// htmlCellText renders one cell's markup as text: tags removed, named and
// numeric entities decoded, whitespace collapsed. Decoding is what collapses
// 3,073 raw header tuples to 95 field sets -- an undecoded &nbsp; is what
// fragmented them. Line structure inside the cell is PRESERVED, because a <br>
// is how this grammar separates "ISSUER NAME:" from "MEETING DATE:" inside one
// merged cell.
func htmlCellText(b []byte) string {
	return strings.TrimSpace(string(stripHTMLCell(b)))
}

// htmlFlat renders cell text as a single line for label and value comparison.
func htmlFlat(s string) string {
	return strings.Join(strings.Fields(s), " ")
}

// ---------------------------------------------------------------------------
// Header identification
// ---------------------------------------------------------------------------

// htmlSplitHeaderMapping joins two consecutive label fragments on their logical
// column grid. htmlRowCells has already expanded colspan, so unequal physical
// arities become equal logical widths without positional guessing. consumed is
// true when the second fragment belongs to the header even if the block lacks
// enough rows to open a new mapping (as at a repeated page-break header).
//
// header is the joined label row the mapping was read from, for the spacer
// realignment of the rows beneath (Diamond Hill 2011 prints the CUSIP one
// column left of the joined header's label).
func htmlSplitHeaderMapping(cells []string, feed *htmlRowFeed, repeats *htmlHeaderRepeats) (mapping map[string]int, header []string, carry, partitioned, consumed, ok bool) {
	if !htmlHeaderFragment(cells) {
		below, exists := feed.peek(0)
		if !exists || below.newTable || !htmlHeaderFragmentOver(cells, below.cells) {
			return nil, nil, false, false, false, false
		}
	}
	// A header wraps over two rows in most exports and over FOUR in filer
	// agent 1580642's (`Shareholder | Brief Identification | ...`, `Ticker |
	// Meeting | of the Matter | ...`, `Issuer Name | Symbol | CUSIP | Date |
	// ...`, `(Issuer/Security Holder) | (Y/N) | ...`; 13,177 rows of
	// 0001580642-23-004388 read a later fragment as the header and the one
	// beneath it as a vote, issuer "Symbol", CUSIP "Date"). Fragments are
	// joined column-wise until the join is header-shaped; the trailing
	// legend row `(Y/N) | (For/Against/Abstain)` is a fragment too and is
	// folded in so it is not read as data.
	// The DEEPEST header-shaped join wins: two rows of the four-row header
	// already look like a header (`Ticker | Shareholder Meeting | ... | How did
	// the Fund Cast its Vote?`), and stopping there reads the rows that
	// complete it as votes.
	joined := make([]string, len(cells))
	copy(joined, cells)
	var best []string
	bestDepth := 0
	for depth := 0; depth < htmlSplitHeaderMaxRows-1; depth++ {
		next, exists := feed.peek(depth)
		if !exists || next.newTable {
			break
		}
		if !htmlHeaderFragment(next.cells) {
			// A lone continuation cell is folded in only while the header still
			// needs it: once the rows read so far are header-shaped on their own,
			// the lone cell below is the block's first value -- the fund cell of
			// a `Portfolio Name` column, or an issuer heading.
			if _, _, headerLike := htmlHeaderShape(joined); headerLike ||
				!htmlHeaderTailFragment(joined, next.cells) {
				break
			}
		}
		fragment := next.cells
		// Security[Symbol] spans both header rows; the lower row omits it.
		if depth == 0 && len(fragment)+1 == len(cells) {
			for i, c := range cells {
				if htmlCanonLabel(c) == "SECURITY SYMBOL" {
					fragment = append(append(append([]string(nil), fragment[:i]...), ""), fragment[i:]...)
					break
				}
			}
		}
		if len(fragment) != len(cells) {
			break
		}
		for i := range joined {
			joined[i] = htmlFlat(joined[i] + " " + fragment[i])
		}
		if _, _, headerLike := htmlHeaderShape(joined); headerLike {
			best = append([]string(nil), joined...)
			bestDepth = depth + 1
		}
	}
	if best == nil {
		return nil, nil, false, false, false, false
	}
	for k := 0; k < bestDepth; k++ {
		_, _ = feed.next()
	}
	mapping, carry, partitioned, ok = htmlHeaderMapping(best, feed, repeats)
	if ok && len(cells) > 3 && htmlCanonLabel(cells[3]) == "SECURITY SYMBOL" && htmlCanonLabel(cells[2]) == "ISSUER" && htmlFlat(cells[1]) == "" {
		mapping[htmlFieldItem] = 1
		mapping[htmlFieldDesc] = 2
	}
	return mapping, best, carry, partitioned, true, ok
}

// htmlSplitHeaderMaxRows bounds how many rows one wrapped header may span.
const htmlSplitHeaderMaxRows = 4

func htmlHeaderFragment(cells []string) bool {
	labels := 0
	for _, c := range cells {
		flat := htmlFlat(c)
		if flat == "" {
			continue
		}
		if htmlIsNumeric(flat) || htmlLooksLikeValueLimit(flat, htmlLabelMaxLen) {
			return false
		}
		labels++
	}
	return labels >= 2 && labels <= htmlHeaderMaxCells
}

// htmlHeaderFragmentOver is htmlHeaderFragment for the upper piece of a wrapped
// header whose cells are bare vote words: `Meeting | Proposed | Matter | Vote |
// Against` over `Issuer | Ticker | CUSIP | Date | Description of Vote | by |
// Voted | Cast | Mgmt` (Diamond Hill Funds 2011, 3,820 rows with no date and
// the flag as the vote). A vote-valued cell is a label piece only when the row
// beneath prints a label, not a value, in the same column; every other cell is
// held to the ordinary fragment rule, so a data row still never qualifies.
func htmlHeaderFragmentOver(cells, below []string) bool {
	if len(below) != len(cells) {
		return false
	}
	labels := 0
	for i, c := range cells {
		flat := htmlFlat(c)
		if flat == "" {
			continue
		}
		if htmlIsVoteValue(flat) {
			b := htmlFlat(below[i])
			if b == "" || htmlIsNumeric(b) || htmlLooksLikeValueLimit(b, htmlLabelMaxLen) {
				return false
			}
		} else if htmlIsNumeric(flat) || htmlLooksLikeValueLimit(flat, htmlLabelMaxLen) {
			return false
		}
		labels++
	}
	if labels == 1 {
		// ONE label is enough only when it NAMES THE VOTE: the ISS `Vote
		// Summary Report` prints `Vote` in the last column of an otherwise
		// empty row over `Proponent | Mgmt Rec | Instruction` (TD Asset
		// Management 2012), and the join is the only way the vote column is
		// ever named. Any other lone label is an identity heading the stacked
		// readers below must keep.
		return htmlSingleVoteLabel(cells)
	}
	return labels >= 2 && labels <= htmlHeaderMaxCells
}

// htmlSplitBallotRows reports the two halves of ONE ballot the filer split over
// two rows: the upper prints the item and no vote at all, the lower prints the
// vote and no item, and neither fills a column the other filled except the
// proposal, where the upper names the matter and the lower the nominee. A row
// that carries its own vote, or one that repeats a column of the row above, is
// a ballot of its own and is never merged.
func htmlSplitBallotRows(parent, child []string, mapping map[string]int) bool {
	vote, hasVote := mapping[htmlFieldVote]
	item, hasItem := mapping[htmlFieldItem]
	desc, hasDesc := mapping[htmlFieldDesc]
	if !hasVote || !hasItem || !hasDesc || len(child) != len(parent) {
		return false
	}
	if htmlFlat(parent[vote]) != "" || htmlFlat(child[vote]) == "" {
		return false
	}
	if htmlFlat(parent[item]) == "" || htmlFlat(child[item]) != "" {
		return false
	}
	if htmlFlat(parent[desc]) == "" || htmlFlat(child[desc]) == "" {
		return false
	}
	for i := range parent {
		if i == desc {
			continue
		}
		if htmlFlat(parent[i]) != "" && htmlFlat(child[i]) != "" {
			return false
		}
	}
	return true
}

// htmlMergeBallotRows folds the lower half of a split ballot into the upper: a
// column the upper left empty takes the lower's value, and the proposal keeps
// both pieces in the order printed.
func htmlMergeBallotRows(parent, child []string, mapping map[string]int) []string {
	out := make([]string, len(parent))
	copy(out, parent)
	desc, hasDesc := mapping[htmlFieldDesc]
	for i := range out {
		if hasDesc && i == desc {
			out[i] = parent[i] + "\n" + child[i]
			continue
		}
		if htmlFlat(out[i]) == "" {
			out[i] = child[i]
		}
	}
	return out
}

// htmlHeaderTailFragment reports the lower piece of a header whose ONE non-empty
// cell continues a label already open in its own column: `For/Against` over
// `Management` (Dominion Funds 2010, the ProxyEdge word-vote grid). A row with a
// single label is otherwise an identity heading, so it is folded into the header
// only where the column above it already carries a label of this header.
func htmlHeaderTailFragment(open, cells []string) bool {
	if len(cells) != len(open) {
		return false
	}
	found := false
	for i, c := range cells {
		flat := htmlFlat(c)
		if flat == "" {
			continue
		}
		if found || htmlFlat(open[i]) == "" {
			return false
		}
		if htmlIsNumeric(flat) || htmlLooksLikeValueLimit(flat, htmlLabelMaxLen) {
			return false
		}
		found = true
	}
	return found
}

// htmlSingleVoteLabel reports a row whose only label maps to the vote column.
func htmlSingleVoteLabel(cells []string) bool {
	m := htmlMapFields(cells)
	if len(m) != 1 {
		return false
	}
	_, ok := m[htmlFieldVote]
	return ok
}

// htmlHeaderMapping accepts a row only when its shape passes every value and
// field guard and the document supplies three confirming rows: either directly
// beneath this occurrence or collectively beneath repeated identical headers.
// An already-open table is not a witness by itself.
//
// carry reports that all direct confirming rows were found across the one table
// boundary the supported split-table grammar permits. Repetition never grants it.
// partitioned reports the narrower grammar where each vote row is printed in its
// own table; that mode is granted only by three mapped rows with recognised vote
// values, not by arity alone.
func htmlHeaderMapping(cells []string, feed *htmlRowFeed, repeats *htmlHeaderRepeats) (mapping map[string]int, carry, partitioned, ok bool) {
	mapping, key, ok := htmlHeaderShape(cells)
	if !ok {
		return nil, false, false, false
	}
	// The prose lead cell htmlHeaderShape dropped is dropped here too: the
	// column under it is unlabelled, which is what lets the ballots' own
	// description be adopted into it.
	if _, has := mapping[htmlFieldDesc]; !has && !htmlAdoptUnlabelledDesc(htmlDropProseLeadCell(cells), mapping, feed) {
		return nil, false, false, false
	}
	below, crossed := htmlHasTableBelow(len(cells), feed)
	if !below && !repeats.has(key) {
		if !htmlHasPartitionedVotes(mapping, len(cells), feed) {
			return nil, false, false, false
		}
		partitioned = true
	}
	htmlAdoptUnlabelledItem(cells, mapping, feed)
	htmlAdoptBareMeetingDate(cells, mapping, feed)
	htmlShiftToFilledNeighbour(mapping, len(cells), feed)
	return mapping, below && crossed, partitioned, true
}

// A bare MEETING is a date only beside TYPE/MEETING TYPE and with dated
// values beneath it. Blank continuation cells do not disprove the column.
func htmlAdoptBareMeetingDate(cells []string, mapping map[string]int, feed *htmlRowFeed) {
	if _, taken := mapping[htmlFieldMtgDate]; taken {
		return
	}
	idx := -1
	for i, c := range cells {
		if htmlCanonLabel(c) != "MEETING" {
			continue
		}
		// A lower header row can complete MEETING even when its other
		// cells (such as Against) are not accepted as header fragments.
		if below, ok := feed.peek(0); ok && !below.newTable && len(below.cells) == len(cells) && htmlCanonLabel(below.cells[i]) == "DATE" {
			mapping[htmlFieldMtgDate] = i
			return
		}
		adjacentType := false
		for _, nb := range []int{i - 1, i + 1} {
			if nb >= 0 && nb < len(cells) {
				label := htmlCanonLabel(cells[nb])
				adjacentType = adjacentType || label == "TYPE" || label == "MEETING TYPE"
			}
		}
		if adjacentType {
			if idx >= 0 {
				return
			}
			idx = i
		}
	}
	if idx < 0 {
		return
	}
	for _, col := range mapping {
		if col == idx {
			return
		}
	}
	seen := false
	for i := 0; i < htmlHeaderLookahead; i++ {
		row, ok := feed.peek(i)
		if !ok || row.newTable {
			break
		}
		if _, _, header := htmlHeaderShape(row.cells); header {
			break
		}
		if len(row.cells) != len(cells) || htmlFlat(row.cells[idx]) == "" {
			continue
		}
		if htmlDate(row.cells[idx]) == "" {
			return
		}
		seen = true
	}
	if seen {
		mapping[htmlFieldMtgDate] = idx
	}
}

// htmlShiftToFilledNeighbour moves a mapped field one column to an unmapped
// neighbour when the header's colspan grid differs from the rows' (the SSgA
// vote summary: `Company/ Ballot Issues` joined at column 3, the proposals
// printed at 4; `Prpnent` at 9, `Mgmt` at 10; Kiewit 2007, Thrivent 2005, 295
// htmltable filings on the 2026-09-05 census). The move needs the rows'
// evidence: over the lookahead, every comparable row that fills the neighbour
// leaves the mapped column empty, at least htmlHeaderConfirm such rows exist,
// and no row fills both. A field the rows fill where the header put it stays.
func htmlShiftToFilledNeighbour(mapping map[string]int, arity int, feed *htmlRowFeed) {
	// An identity field's column does not block the move: the identity row
	// sits on its own grid and is read by shape, and a proposal row prints
	// nothing under those labels (the CUSIP label's column holds the
	// proposals in Kiewit 2007).
	identity := map[string]bool{htmlFieldIssuer: true, htmlFieldCUSIP: true, htmlFieldCUSIPPrinted: true, htmlFieldISIN: true, htmlFieldTicker: true, htmlFieldMtgDate: true, htmlFieldFund: true}
	claimed := make(map[int]bool, len(mapping))
	for f, i := range mapping {
		if !identity[f] {
			claimed[i] = true
		}
	}
	for _, field := range []string{htmlFieldDesc, htmlFieldBy, htmlFieldVote, htmlFieldMgmtRec, htmlFieldVsMgmt, htmlFieldItem} {
		col, mapped := mapping[field]
		if !mapped {
			continue
		}
		for _, nb := range []int{col + 1, col - 1} {
			if nb < 0 || nb >= arity || claimed[nb] {
				continue
			}
			seen, ok := 0, true
			for i := 0; i < htmlHeaderLookahead && ok; i++ {
				row, exists := feed.peek(i)
				if !exists {
					break
				}
				if _, _, isHeader := htmlHeaderShape(row.cells); isHeader {
					break
				}
				if len(row.cells) != arity {
					continue
				}
				here, there := htmlFlat(row.cells[col]) != "", htmlFlat(row.cells[nb]) != ""
				if here && there {
					ok = false
				} else if there {
					seen++
				}
			}
			if ok && seen >= htmlHeaderConfirm {
				delete(claimed, col)
				mapping[field] = nb
				claimed[nb] = true
				break
			}
		}
	}
}

// htmlHasPartitionedVotes recognises exports that close the table after every
// row. Crossing boundaries is safe only with stronger evidence than the normal
// arity witness: three rows must print a known vote in the mapped vote column
// and carry an item or description through the same mapping.
func htmlHasPartitionedVotes(mapping map[string]int, arity int, feed *htmlRowFeed) bool {
	seen := 0
	for i := 0; i < htmlHeaderLookahead; i++ {
		row, ok := feed.peek(i)
		if !ok {
			break
		}
		if _, _, isHeader := htmlHeaderShape(row.cells); isHeader {
			break
		}
		if !htmlComparableArity(len(row.cells), arity) ||
			!htmlMappedVoteValue(row.cells, mapping, arity) {
			continue
		}
		if _, ok := htmlDataRow(row.cells, mapping, arity, htmlContext{}); !ok {
			continue
		}
		seen++
		if seen >= htmlHeaderConfirm {
			return true
		}
	}
	return false
}

func htmlMappedVoteValue(cells []string, mapping map[string]int, headerArity int) bool {
	i, ok := mapping[htmlFieldVote]
	if !ok {
		return false
	}
	if len(cells) == headerArity+1 && htmlIsItemNumber(htmlFlat(cells[0])) {
		i++
	}
	return i >= 0 && i < len(cells) && htmlIsVoteValue(htmlFlat(cells[i]))
}

// htmlAdoptUnlabelledItem gives the item field to a header column that prints NO
// label, when the rows beneath prove that column holds item numbers. 129 filings
// print `<blank> | Proposal | Proposed by | Mgt. Position | Registrant Voted`,
// where the item column is a narrow unlabelled gutter.
//
// The proof is required of the BLOCK, not of one row: every comparable row the
// lookahead reaches must carry an item number there, and at least
// htmlHeaderConfirm of them must exist. One stray row cannot hand the field away.
// Nothing here moves another column -- the mapping stays positional and every
// field already claimed keeps its index -- so the worst case of declining is a
// blank item_seq, while the worst case of a shifted mapping is a filing of
// plausible wrong rows on funds no vendor covers.
func htmlAdoptUnlabelledItem(cells []string, mapping map[string]int, feed *htmlRowFeed) {
	if _, taken := mapping[htmlFieldItem]; taken {
		return
	}
	claimed := make(map[int]bool, len(mapping))
	for _, i := range mapping {
		claimed[i] = true
	}
	idx := -1
	for i, c := range cells {
		if claimed[i] || htmlFlat(c) != "" {
			continue
		}
		// A blank header column the rows beneath never number is a SPACER, not
		// a candidate: the ISS Vote Summary Report lays a one-character spacer
		// cell between every pair of real columns, so demanding a single blank
		// column outright would refuse a grid that names its item plainly.
		if !htmlItemColumnConfirmed(i, len(cells), feed) {
			continue
		}
		if idx >= 0 {
			// Two columns both printing item numbers: which one is the item is
			// a guess.
			return
		}
		idx = i
	}
	if idx < 0 {
		return
	}
	mapping[htmlFieldItem] = idx
}

// htmlAdoptUnlabelledDesc maps the description onto the one blank header column
// whose rows beneath carry running text (`| | | | Proponent | | Mgmt Rec | |
// Vote Instruction` over `1 | | Approve Final Dividend | | Mgmt | | For | |
// For`, Clearwater Investment Trust 2011). Every comparable row must print a
// non-numeric text of at least two words there, over htmlHeaderConfirm rows;
// two candidate columns, or a column any row leaves numeric, is a guess and
// adopts nothing.
func htmlAdoptUnlabelledDesc(cells []string, mapping map[string]int, feed *htmlRowFeed) bool {
	claimed := make(map[int]bool, len(mapping))
	for _, i := range mapping {
		claimed[i] = true
	}
	arity := len(cells)
	chosen := -1
	for idx, c := range cells {
		if claimed[idx] || htmlFlat(c) != "" {
			continue
		}
		seen, textual, ended := 0, true, false
		for i := 0; i < htmlHeaderLookahead && textual; i++ {
			row, ok := feed.peek(i)
			if !ok {
				// The document ends here. As in htmlHasTableBelow, the
				// three-row witness exists to tell a description column from a
				// label column in the MIDDLE of a document; with no rows left
				// there is nothing further to disambiguate.
				ended = true
				break
			}
			if _, _, isHeader := htmlHeaderShape(row.cells); isHeader {
				break
			}
			if !htmlComparableArity(len(row.cells), arity) || idx >= len(row.cells) {
				continue
			}
			v := htmlFlat(row.cells[idx])
			if v == "" {
				continue
			}
			if htmlIsNumeric(v) || len(strings.Fields(v)) < 2 {
				textual = false
				break
			}
			seen++
		}
		if textual && (seen >= htmlHeaderConfirm || (ended && seen > 0)) {
			if chosen >= 0 {
				return false
			}
			chosen = idx
		}
	}
	if chosen < 0 {
		return false
	}
	mapping[htmlFieldDesc] = chosen
	return true
}

// htmlItemColumnConfirmed reports whether every comparable row under the header
// prints an item number at idx, over at least htmlHeaderConfirm rows.
func htmlItemColumnConfirmed(idx, arity int, feed *htmlRowFeed) bool {
	seen, crossed, ended := 0, false, false
	for i := 0; i < htmlHeaderLookahead; i++ {
		row, ok := feed.peek(i)
		if !ok {
			// The document ends here, as in htmlAdoptUnlabelledDesc: the
			// three-row witness disambiguates a column in the MIDDLE of a
			// document, and there is nothing further to disambiguate.
			ended = true
			break
		}
		if row.newTable {
			if seen > 0 || crossed {
				break
			}
			crossed = true
		}
		if !htmlComparableArity(len(row.cells), arity) {
			continue
		}
		// A wholly empty row is the vendor's vertical spacer, not a row that
		// declines to number its item.
		if htmlFilledCells(row.cells) == 0 {
			continue
		}
		if idx >= len(row.cells) || !htmlIsItemNumber(htmlFlat(row.cells[idx])) {
			return false
		}
		seen++
		if seen >= htmlHeaderConfirm {
			return true
		}
	}
	return ended && seen > 0
}

// htmlIsItemNumber recognises the printed forms of a ballot item number -- "1",
// "1.1", "10.12", "2a". It opens with a digit and carries nothing but digits,
// dots and letters, which excludes a description, a proposer and a vote alike.
func htmlIsItemNumber(s string) bool {
	if s == "" || len(s) > htmlItemMaxLen || s[0] < '0' || s[0] > '9' {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9', c == '.':
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z':
		default:
			return false
		}
	}
	return true
}

// htmlItemMaxLen bounds a printed item number. "10.12" is five bytes; a cell
// longer than this is prose.
const htmlItemMaxLen = 8

// htmlHeaderShape applies every test that reads the candidate row ALONE, and
// returns the field mapping together with the row's normalised tuple key. It is
// deliberately separate from confirmation, because the repeat scan has to apply
// exactly these tests to every row of the document and must not be able to drift
// from what the main pass accepts.
func htmlHeaderShape(cells []string) (map[string]int, string, bool) {
	// The ISS `Vote Summary Report` opens its ballot header with a COLSPAN cell
	// of prose (`Voting Policy: Waddell & Reed     Ballot Count: 1`, Waddell &
	// Reed Advisors Funds 2012, 39.2 MB and zero rows) over an ordinary row of
	// short mapped labels. A row like that is read on those labels with the
	// prose cell DROPPED rather than refused whole. Dropping it is what makes
	// the column beneath it unlabelled, so the description the ballots print
	// there can be adopted; keeping it named the column after a sentence and
	// left the table with no description at all. The cell keeps its slot, so
	// every other column's index is unchanged.
	if _, prose := htmlProseLeadCell(cells); prose {
		if mapping, key, ok := htmlHeaderShapeStrict(htmlDropProseLeadCell(cells)); ok {
			return mapping, key, true
		}
	}
	return htmlHeaderShapeStrict(cells)
}

// htmlProseLeadCell returns the index of a leading cell that is a sentence
// rather than a column label: the FIRST filled cell, when it runs to several
// words carrying a colon or past the width a label is ever printed at AND names
// no field of its own. A cell the mapping reads is a label however long it is,
// so an issuer column spelled out in full is never dropped.
// htmlDropProseLeadCell returns the header row with its prose lead cell blanked,
// or the row unchanged when it has none. The cell keeps its slot so that every
// mapped column's index still refers to the same column.
func htmlDropProseLeadCell(cells []string) []string {
	i, ok := htmlProseLeadCell(cells)
	if !ok {
		return cells
	}
	trimmed := make([]string, len(cells))
	copy(trimmed, cells)
	trimmed[i] = ""
	return trimmed
}

func htmlProseLeadCell(cells []string) (int, bool) {
	for i, c := range cells {
		flat := htmlFlat(c)
		if flat == "" {
			continue
		}
		if htmlIsNumeric(flat) || htmlIsHeaderWord(flat) {
			return 0, false
		}
		if len(strings.Fields(flat)) < 3 ||
			(!strings.Contains(flat, ":") && len(flat) <= htmlHeaderWideLabelMaxLen) {
			return 0, false
		}
		for _, at := range htmlMapFields(cells) {
			if at == i {
				return 0, false
			}
		}
		return i, true
	}
	return 0, false
}

func htmlHeaderShapeStrict(cells []string) (map[string]int, string, bool) {
	labels := 0
	allShort := true
	for i, c := range cells {
		flat := htmlFlat(c)
		if flat == "" {
			continue
		}
		if htmlIsNumeric(flat) {
			// A bare number in a header row is a value, not a label -- except
			// a row number in the FIRST cell of a numbered grid (`1 | Company
			// Name | Ticker | CUSIP | Meeting Date | ...`, Mutual Fund Series
			// Trust 2012), which the rows beneath continue as 2, 3, 4.
			if i == 0 && htmlFilledCells(cells) >= 5 {
				continue
			}
			return nil, "", false
		}
		valueText, maxLen := flat, htmlLabelMaxLen
		if label, _, lettered := htmlLetteredLabel(flat); lettered {
			valueText, maxLen = label, htmlLetteredLabelMaxLen
		}
		// A cell that is exactly a known column label is a label even when it
		// also spells a decorated vote (`Against Mgmt`, Diamond Hill 2011).
		if htmlLooksLikeValueLimit(valueText, maxLen) && !htmlIsHeaderWord(flat) {
			return nil, "", false
		}
		labels++
		if len(valueText) > htmlHeaderWideLabelMaxLen {
			allShort = false
		}
	}
	if labels < htmlHeaderMinCells {
		return nil, "", false
	}
	if labels > htmlHeaderMaxCells && (labels > htmlHeaderWideMaxCells || !allShort) {
		return nil, "", false
	}

	mapping := htmlMapFields(cells)
	if len(mapping) < 3 {
		return nil, "", false
	}
	if _, ok := mapping[htmlFieldVote]; !ok && !htmlIdentityItemHeader(mapping) {
		return nil, "", false
	}
	if _, ok := mapping[htmlFieldDesc]; !ok {
		// No description label: only a header that names the vote AND the
		// management recommendation may go on, and htmlHeaderMapping must then
		// find the description column in the rows beneath.
		if _, rec := mapping[htmlFieldMgmtRec]; !rec {
			return nil, "", false
		}
	}
	if i, ok := mapping[htmlFieldCUSIP]; ok && i < len(cells) &&
		strings.HasPrefix(htmlCanonLabel(cells[i]), "CUSIP") {
		mapping[htmlFieldCUSIPPrinted] = i
	}
	return mapping, htmlHeaderKey(cells), true
}

// htmlIdentityItemHeader reports a header that names the issuer, the security,
// the meeting and what was voted on. A filing printing all four is an
// item-level vote table whether or not it prints a vote column at all (Eagle
// Series Trust 2016 prints none in 4.8 MB), and its rows carry an empty
// how_voted rather than a guessed one -- the same shape family CORN's
// blank-vote-cell rows already take.
func htmlIdentityItemHeader(mapping map[string]int) bool {
	for _, f := range []string{htmlFieldIssuer, htmlFieldCUSIP, htmlFieldMtgDate, htmlFieldDesc} {
		if _, ok := mapping[f]; !ok {
			return false
		}
	}
	return true
}

// htmlHeaderKey renders a candidate row as the tuple two occurrences must agree
// on. It is built from htmlCanonLabel rather than the raw cells so that the same
// header printed with different entity spellings, casing or camelCase is one
// tuple -- the same folding that collapsed 3,073 raw header tuples to 95 field
// sets. Empty cells are kept as empty positions: column COUNT and position are
// part of the tuple's identity, and a row with a cell more is a different row.
func htmlHeaderKey(cells []string) string {
	labs := make([]string, len(cells))
	for i, c := range cells {
		labs[i] = htmlCanonLabel(c)
	}
	return strings.Join(labs, "\x1f")
}

// htmlHeaderRepeats answers "does this header tuple occur more than once in this
// document", computing the answer at most once per filing and only when a
// candidate has already failed the follow-row test. Most filings never ask: they
// either have a header with a real table under it, or no candidate at all. That
// laziness is what keeps the cost of this witness off the 155 MB documents that
// have nothing for it to find.
type htmlHeaderRepeats struct {
	body []byte
	done bool
	keys map[string]bool
}

func (r *htmlHeaderRepeats) has(key string) bool {
	if !r.done {
		r.done = true
		r.keys = htmlScanRepeatedHeaders(r.body)
	}
	return r.keys[key]
}

// htmlScanRepeatedHeaders walks the body once more with a fresh feed and returns
// shape-passing tuples printed at least twice with at least htmlHeaderConfirm
// governed rows across their occurrences. Repetition alone is not evidence: a
// repeated banner contributes zero governed rows and is rejected.
func htmlScanRepeatedHeaders(body []byte) map[string]bool {
	feed := &htmlRowFeed{src: body}
	counts := make(map[string]int)
	governed := make(map[string]int)
	for {
		row, ok := feed.next()
		if !ok {
			break
		}
		_, key, ok := htmlHeaderShape(row.cells)
		if !ok {
			continue
		}
		if _, known := counts[key]; !known && len(counts) >= htmlMaxRepeatKeys {
			continue
		}
		counts[key]++
		if governed[key] < htmlHeaderConfirm {
			governed[key] += htmlGovernedRowCount(len(row.cells), feed,
				htmlHeaderConfirm-governed[key])
		}
	}
	repeated := make(map[string]bool, len(counts))
	for key, n := range counts {
		if n >= 2 && governed[key] >= htmlHeaderConfirm {
			repeated[key] = true
		}
	}
	return repeated
}

// htmlGovernedRowCount counts comparable non-header rows following one repeated
// header occurrence inside its own table, up to need. Counts accumulate across
// occurrences, so three one-proposal meetings supply the same amount of evidence
// as three rows beneath one header; a repeated banner with no data supplies none.
func htmlGovernedRowCount(arity int, feed *htmlRowFeed, need int) int {
	seen := 0
	for i := 0; i < htmlHeaderLookahead && seen < need; i++ {
		row, ok := feed.peek(i)
		if !ok || row.newTable {
			break
		}
		if !htmlComparableArity(len(row.cells), arity) {
			continue
		}
		if _, _, isHeader := htmlHeaderShape(row.cells); isHeader {
			break
		}
		seen++
	}
	return seen
}

// htmlHasTableBelow requires real rows under a candidate header. A label-like
// row with nothing beneath it is a caption or a legend, and parsing the prose
// after it as votes is exactly the failure this layout exists to avoid.
//
// crossed reports that the confirming rows were found on the FAR side of a
// </table>, which is the only circumstance in which a mapping may outlive the
// table that declared it. Because the scan stops at a boundary once it has
// counted a row, crossed=true means EVERY counted row sits beyond that one
// boundary: the header's own table printed nothing.
func htmlHasTableBelow(arity int, feed *htmlRowFeed) (found, crossed bool) {
	seen := 0
	for i := 0; i < htmlHeaderLookahead; i++ {
		row, ok := feed.peek(i)
		if !ok {
			// The document ends here. The three-row witness exists to tell a
			// label-like row in the MIDDLE of a document from a real header;
			// with no rows left there is nothing further to disambiguate, so
			// every row the table did print counts. Rows on the far side of a
			// </table> do NOT: a mapping that has to cross a boundary to find
			// its rows is the one case the witness exists to refuse.
			return seen > 0 && !crossed, false
		}
		if row.newTable {
			// Rows of the NEXT table are not this header's table -- unless this
			// header's table closed without printing one, which is how a family of
			// this grammar lays out a vote record: the column labels in a table of
			// their own, the votes in the table below the block heading. Exactly one
			// such boundary is crossed, and only before any row has been counted.
			if seen > 0 || crossed {
				break
			}
			crossed = true
		}
		if _, _, isHeader := htmlHeaderShape(row.cells); isHeader {
			break
		}
		if htmlComparableArity(len(row.cells), arity) {
			seen++
			if seen >= htmlHeaderConfirm {
				return true, crossed
			}
		}
	}
	return false, false
}

func htmlComparableArity(n, arity int) bool {
	d := n - arity
	if d < 0 {
		d = -d
	}
	return d <= htmlArityTolerance
}

// ---------------------------------------------------------------------------
// Value detection -- the half of the header test that rejects data rows
// ---------------------------------------------------------------------------

// htmlValueVotes are the bare vote values whose presence proves a row is data.
// "Yes" and "No" are deliberately ABSENT: they are votes on a consent ballot but
// they are also ordinary column labels ("No." is the item column of half this
// corpus), and rejecting every header that prints one would cost more filings
// than the ambiguity is worth. The rest have no label reading.
var htmlValueVotes = map[string]bool{
	"FOR": true, "AGAINST": true, "ABSTAIN": true,
	"WITHHOLD": true, "WITHHELD": true, "NONE": true,
	"ONE YEAR": true, "TWO YEARS": true, "THREE YEARS": true,
	"1 YEAR": true, "2 YEARS": true, "3 YEARS": true,
	"DO NOT VOTE": true, "DID NOT VOTE": true, "NO VOTE": true,
	"TAKE NO ACTION": true, "NO ACTION": true, "TNA": true,
	"PROPORTIONAL": true, "NON-VOTING": true, "SPLIT": true,
	"FOR/AGAINST": true, "REFER": true,
}

// htmlSignatureProse are the words of the certification and agent-for-service
// blocks, which are laid out in tables often enough that one of five sampled
// filings offered such a paragraph as a header row.
var htmlSignatureProse = []string{
	"pursuant", "undersigned", "telephone", "address",
}

// htmlVotePrefixes and htmlVoteSuffixes are the decorations filers hang on a
// printed vote. They are stripped before the vocabulary lookup so that
// "Voted For" and "Against Management" are recognised as the values they are;
// a bare vote word is what proves a row is data, and a decorated one is no less
// a value for being decorated.
var (
	htmlVotePrefixes = []string{"VOTED ", "VOTE ", "CAST "}
	htmlVoteSuffixes = []string{
		" MANAGEMENT", " MGMT", " MGT", " RECOMMENDATION", " REC",
		" ON MANAGEMENT", " WITH MANAGEMENT", " MANAGEMENT RECOMMENDATION",
	}
)

// htmlIsVoteValue reports whether a cell prints a vote, decoration included.
func htmlIsVoteValue(flat string) bool {
	up := htmlValueCanon(flat)
	if up == "" {
		return false
	}
	if htmlValueVotes[up] {
		return true
	}
	// A slash form is a LABEL, not a value: "For/Against Management" is a real
	// column of this corpus, and stripping its suffix would leave "FOR/AGAINST",
	// which is in the vocabulary. Only the undecorated match above may claim one.
	if strings.ContainsRune(up, '/') {
		return false
	}
	for _, p := range htmlVotePrefixes {
		if r := strings.TrimPrefix(up, p); r != up && htmlValueVotes[r] {
			return true
		}
	}
	for _, s := range htmlVoteSuffixes {
		if r := strings.TrimSuffix(up, s); r != up && htmlValueVotes[r] {
			return true
		}
	}
	return false
}

// htmlValueCanon renders a cell for vocabulary comparison: parenthesised
// footnote markers dropped, everything but letters, digits, '/' and space folded
// to a space, uppercased and collapsed. "For*", "FOR (1)" and "for." all reduce
// to "FOR".
func htmlValueCanon(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	depth := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '(' || c == '[':
			depth++
		case c == ')' || c == ']':
			if depth > 0 {
				depth--
			}
		case depth > 0:
		case c >= 'a' && c <= 'z':
			b.WriteByte(c - ('a' - 'A'))
		case c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '/', c == '-':
			b.WriteByte(c)
		default:
			b.WriteByte(' ')
		}
	}
	return htmlFlat(b.String())
}

// htmlLooksLikeValue reports whether a cell carries a datum rather than a label.
func htmlLooksLikeValue(flat string) bool {
	return htmlLooksLikeValueLimit(flat, htmlLabelMaxLen)
}

func htmlLooksLikeValueLimit(flat string, maxLen int) bool {
	if len(flat) > maxLen {
		return true
	}
	if htmlIsVoteValue(flat) {
		return true
	}
	if containsAnyFolded(flat, htmlSignatureProse) {
		return true
	}
	// The ASCII fold, not strings.ToUpper: htmlIsCUSIP keys on a token being
	// exactly nine bytes, and ToUpper can change a token's byte length.
	fields := strings.Fields(htmlUpperASCII(flat))
	for _, tok := range fields {
		tok = strings.Trim(tok, ".,;:()[]")
		if htmlIsCUSIP(tok) || htmlIsNumericDate(tok) {
			return true
		}
	}
	return htmlHasMonthNameDate(fields)
}

// htmlIsCUSIP recognises both the nine-character identifier and the printed
// 6-2-1 form (002824-10-0). Either is a value and disqualifies a header cell.
func htmlIsCUSIP(tok string) bool {
	digits, chars := 0, 0
	for i := 0; i < len(tok); i++ {
		c := tok[i]
		if c == '-' {
			if len(tok) != 11 || (i != 6 && i != 9) {
				return false
			}
			continue
		}
		switch {
		case c >= '0' && c <= '9':
			digits++
			chars++
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z':
			chars++
		default:
			return false
		}
	}
	return chars == 9 && digits > 0 && (len(tok) == 9 || len(tok) == 11)
}

// htmlIsNumericDate recognises 5/14/08, 05-14-2008 and 2008.05.14.
func htmlIsNumericDate(tok string) bool {
	parts := strings.FieldsFunc(tok, func(r rune) bool {
		return r == '/' || r == '-' || r == '.'
	})
	if len(parts) != 3 {
		return false
	}
	for _, p := range parts {
		if p == "" || len(p) > 4 || !htmlIsNumeric(p) {
			return false
		}
	}
	return true
}

// htmlHasMonthNameDate recognises "FEB 28, 2017" spread across tokens.
func htmlHasMonthNameDate(fields []string) bool {
	month := false
	year := false
	for _, tok := range fields {
		t := strings.Trim(tok, ".,;:()[]")
		if len(t) >= 3 && htmlMonths[t[:3]] {
			month = true
			continue
		}
		if len(t) == 4 && htmlIsNumeric(t) {
			year = true
		}
	}
	return month && year
}

var htmlMonths = map[string]bool{
	"JAN": true, "FEB": true, "MAR": true, "APR": true, "MAY": true, "JUN": true,
	"JUL": true, "AUG": true, "SEP": true, "OCT": true, "NOV": true, "DEC": true,
}

// htmlIsCUSIP6 reports whether a value is a CUSIP issuer number: exactly six
// characters of letters and digits, at least one of them a digit. `Issuer:
// 24702R` (Dell, SM&R Investments 2005) and `Issuer: 929903` (Wachovia,
// Manning & Napier 2007) are the id the linker's cusip6 rung reads. Requiring
// the digit keeps a six-LETTER issuer name off that rung.
func htmlIsCUSIP6(s string) bool {
	if len(s) != 6 {
		return false
	}
	digit := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
			digit = true
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z':
		default:
			return false
		}
	}
	return digit
}

func htmlIsNumeric(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// ---------------------------------------------------------------------------
// Field mapping
// ---------------------------------------------------------------------------

const (
	htmlFieldItem           = "item"
	htmlFieldDesc           = "desc"
	htmlFieldBy             = "by"
	htmlFieldMgmtRec        = "mgmtrec"
	htmlFieldVote           = "vote"
	htmlFieldVsMgmt         = "vsmgmt"
	htmlFieldTicker         = "ticker"
	htmlFieldCUSIP          = "cusip"
	htmlFieldMtgDate        = "mtgdate"
	htmlFieldIssuer         = "issuer"
	htmlFieldISIN           = "isin"
	htmlFieldFund           = "fund"
	htmlFieldSecuritySymbol = "securitysymbol"
	htmlFieldRecordDate     = "recorddate"
	// htmlFieldVotedFlag is the did-the-fund-vote column ("Voted", Yes/No) that
	// sits beside a header naming the vote itself. It is never the vote; it
	// keeps an unvoted agenda item (flag NO, vote cell empty) from reading as
	// table furniture.
	htmlFieldVotedFlag = "votedflag"
	// htmlFieldCUSIPPrinted marks the CUSIP column of a header that NAMES it
	// CUSIP, as against one labelled `Security ID`. It is not a column of its
	// own: it records which claim the header made about the column it shares
	// with htmlFieldCUSIP, so a short id can be kept as printed there.
	htmlFieldCUSIPPrinted = "cusipprinted"
)

// htmlSynonyms is the canonical label vocabulary, keyed by schema field. Labels
// are written as htmlCanonLabel renders them: uppercase, camelCase split,
// punctuation folded to spaces.
var htmlSynonyms = map[string][]string{
	htmlFieldItem: {
		"#", "NO", "NO.", "ITEM", "ITEM NO", "PROPOSAL NO", "PROPOSAL NUMBER",
		"ISSUE NO", "BALLOT ITEM", "PROP", "PROP NO", "SEQ",
	},
	htmlFieldDesc: {
		"PROPOSAL", "PROPOSALS", "DESCRIPTION", "MATTER", "MATTERS",
		"BALLOT ISSUE", "BALLOT ISSUES", "AGENDA", "ITEM DESC", "ITEM DESCRIPTION",
		"PROPOSAL DESCRIPTION", "MEETING AGENDA",
		// Eagle Series Trust decorates its column names with a parenthetical
		// gloss. The gloss carries the word VOTED, which the word-sequence
		// fallback reads as the vote column; the exact phrase claims the
		// description before that can happen.
		"ISSUE WHAT ISSUE WAS VOTED ON",
		// "PROPOSAL TYPE" is the description column of the 81-filing
		// `Proposal Type | Voted? | Vote | For/Agnst Mgmt` shape, which prints
		// no other column naming what was voted on. Reading it as the PROPOSER
		// left that shape one field short of the header test and skipped all 81.
		"PROPOSAL TYPE",
		// The SEC's Item 1(c) wording (Carillon Series Trust 2020).
		"ISSUE",
	},
	htmlFieldBy: {
		"PROPOSED BY", "PROPONENT", "PRPNENT", "SPONSOR", "AUTHOR",
		"PROPOSAL TYPE MGMT OR SHLDR",
		// The SEC's Item 1(d) wording; it carries MATTER, which the
		// word-sequence fallback otherwise reads as the description.
		"WHO PROPOSED MATTER ISSUER / SHAREHOLDER",
		// The same question as Carillon Series Trust 2020 spells it.
		"WAS THIS A SHAREHOLDER MGMT OR ISSUER PROPOSAL",
	},
	htmlFieldMgmtRec: {
		"MGT REC", "MGMT REC", "MGMT RECO", "MANAGEMENT REC", "MANAGEMENT RECOMMENDATION",
		"MGMT RECOMMENDATION", "REC", "RECOMMENDATION", "POSITION", "DEFAULT",
		// MRV is this family's abbreviation for the management recommendation
		// (423 filings print `Proposal # | Proposal | Vote | Author | MRV* | vs.
		// Mgmt`). The trailing asterisk is a footnote marker: htmlCanonLabel
		// folds it to a space, so "MRV*" arrives here as "MRV" and no separate
		// starred entry is reachable.
		"MRV",
	},
	htmlFieldVote: {
		"VOTE CAST", "VOTES CAST", "REGISTRANT VOTED", "FUND VOTE", "HOW VOTED",
		"VOTE", "CAST", "VOTED", "VOTE CASTS", "VOTE INSTRUCTION", "HOW VOTE WAS CAST",
		// Item 1(e) as Carillon Series Trust 2020 spells it.
		"HOW THE FUND CAST ITS VOTE",
		// The SEC's own Item 1(e) column wording, printed verbatim as the header
		// by filers who copy the form (ETFis Series Trust 2015, Van Wagoner
		// Funds 2008). At 96 bytes it is longer than htmlLabelMaxLen, so it is
		// listed here as an exact phrase: that both maps the column and makes
		// htmlIsHeaderWord exempt it from the length ceiling. The second entry
		// is 40|86 Series Trust's printing of the same sentence, typo included.
		"FUND S VOTE FOR OR AGAINST PROPOSAL OR ABSTAIN FOR OR WITHHOLD REGARDING ELECTION OF DIRECTORS",
		"FUND S VOTE FOR OR AGAINST OR ABSTAIN FOR OF WITHHOLD REGARDING ELECTION OF DIRECTORS",
	},
	htmlFieldVsMgmt: {
		"FOR/AGAINST MANAGEMENT", "FOR/AGNST MGMT", "FOR/ AGNST MGMT", "WITH MGMT",
		"FOR AGAINST MANAGEMENT", "WITH MANAGEMENT",
		// `Against Mgmt`, the lower half of a wrapped `For / Against Mgmt`
		// (Diamond Hill Funds 2011).
		"AGAINST MGMT", "AGAINST MANAGEMENT",
	},
	htmlFieldTicker: {"TICKER", "SYMBOL", "TICKER SYMBOL"},
	// "SECURITY" is the CUSIP column of the Vote Summary Report (SSGA Funds,
	// Thrivent: 'Mtg Date/Type | Company/Ballot Issues | Security | ...'); a
	// value that is not CUSIP- or ISIN-shaped is dropped, so a "Security"
	// column holding names cannot pollute the id.
	htmlFieldCUSIP: {"CUSIP", "SECURITY ID", "CUSIP NUMBER", "SECURITY IDENTIFIER", "SECURITY", "SECURITYID"},
	// An ISIN column of its own (JPMorgan China Region Fund: \'Meeting Date |
	// Company Name | ISIN | Sedol | ...\', 4,743 rows with no id).
	htmlFieldISIN: {"ISIN"},
	// The fund as a column of the vote table (FQF Trust: 'Fund Name | Company
	// Name | Ticker | Primary CUSIP | Meeting Date | ...', 86k rows with no
	// fund).
	// `Portfolio Name` heads the leading column of the Masters' Select vintage
	// (Masters Select Funds Trust 2005, 1,892 rows), which prints no section
	// heading at all and names the fund once per block in this column.
	// `Fund #` heads the leading column of the Amidex vintage (Amidex Funds
	// 2005, 332 rows), which prints no section heading and names the fund on
	// every row in that column. Without the exact label the bare `#` synonym
	// claims it for the item sequence and the fund name lands in item_seq.
	// `Series Fund` heads the leading column of the EquiTrust vintage (EquiTrust
	// Series Fund 2004, 115 rows), which prints no section heading and names the
	// portfolio on every row in that column.
	htmlFieldFund: {"FUND NAME", "INSTITUTIONAL ACCOUNT NAME", "ACCOUNT NAME", "PORTFOLIO NAME", "FUND #", "SERIES FUND"},
	htmlFieldMtgDate: {
		"MEETING DATE", "MEETING DAT", "MTG DATE", "DATE OF MEETING", "MTG DATE/TYPE", "SHAREHOLDER MEETING DATE",
		// `Meeting Dt` beside a `Holding Dt` record date (Stadion Investment
		// Trust 2016, 942 undated rows on r182; the agent's 15 filings 5,349).
		"MEETING DT", "MTG DT",
		// `(d) Shareholder Meeting Date/Type` over `05/11/2023 - Annual`
		// (Advisors Preferred Trust 2023).
		"MEETING DATE/TYPE", "SHAREHOLDER MEETING DATE/TYPE",
		// A bare `Date` beside Issuer, Ticker and CUSIP: the qualifier sat in
		// a fragment row above the header that the forward join cannot reach
		// (`Meeting | Proposed | Vote | Against` over `Issuer | Ticker | CUSIP
		// | Date | ...`, American Pension Investors Trust 2018, 1,946 undated
		// rows on r159). A record date is always labelled as one.
		"DATE",
		// `(d) Shareholder Meeting Type & Date` with the date alone beneath
		// (Mutual Fund Series Trust 2018 and the agent's siblings).
		// (the canonical label drops the ampersand).
		"SHAREHOLDER MEETING TYPE DATE", "MEETING TYPE DATE", "MEETING TYPE AND DATE",
		// `Meeting Data`, the filer's spelling (PFM Multi-Manager Series Trust
		// 2023, 13,154 rows with no date on run71).
		"MEETING DATA",
	},
	htmlFieldIssuer: {
		"ISSUER", "ISSUER NAME", "COMPANY", "COMPANY NAME", "SECURITY NAME",
		// A bare `Name` heading the first column of `Name | Ticker | Cusip |
		// Meeting Data | ...` (PFM Multi-Manager Series Trust 2023). Exact
		// only: `Fund Name` and `Director Name` are other labels.
		"NAME",
		// The SEC's Item 1(a) wording. It ends in SECURITY, which the
		// word-sequence fallback reads as the CUSIP column, so the exact phrase
		// has to claim it first.
		"ISSUER OF PORTFOLIO SECURITY",
		// Item 1(a) as Carillon Series Trust 2020 spells it.
		"ISSUER/COMPANY NAME",
	},
}

// htmlFieldOrder is the order htmlMapFields offers fields to a cell. It exists
// because ranging over htmlSynonyms would not be an order at all: Go randomises
// map iteration, so two fields whose synonyms both match one cell -- or match it
// with equal-length synonyms -- would be resolved by whichever the runtime
// visited first, and the SAME filing would map differently between runs. A
// dataset nobody can reproduce is worse than one that is wrong the same way
// twice. The listed order is deliberate rather than alphabetical: the fields the
// header test requires come first, so an ambiguous cell is offered to them
// before it is offered to the identity columns.
var htmlFieldOrder = htmlBuildFieldOrder([]string{
	htmlFieldVote, htmlFieldDesc, htmlFieldItem, htmlFieldMgmtRec,
	htmlFieldBy, htmlFieldVsMgmt, htmlFieldCUSIP, htmlFieldTicker,
	htmlFieldMtgDate, htmlFieldIssuer, htmlFieldISIN, htmlFieldFund,
})

// htmlBuildFieldOrder returns want filtered to fields htmlSynonyms actually
// defines, followed by any remaining field sorted by name. The sorted tail is
// what keeps the order total if a field is ever added to htmlSynonyms alone.
func htmlBuildFieldOrder(want []string) []string {
	seen := make(map[string]bool, len(want))
	order := make([]string, 0, len(htmlSynonyms))
	for _, f := range want {
		if _, ok := htmlSynonyms[f]; ok && !seen[f] {
			order = append(order, f)
			seen[f] = true
		}
	}
	rest := make([]string, 0, len(htmlSynonyms))
	for f := range htmlSynonyms {
		if !seen[f] {
			rest = append(rest, f)
		}
	}
	sort.Strings(rest)
	return append(order, rest...)
}

// htmlMapFields maps header cells to schema fields positionally. Exact label
// matches are resolved for EVERY cell first, then the remainder is offered the
// word-sequence fallback against fields still unclaimed. That ordering is what
// keeps "Proposal No | Proposal" from collapsing: "Proposal" takes desc on its
// exact match no matter which column it sits in, so the fallback can never hand
// desc to a column that merely contains the word.
//
// Each field is claimed by at most one column and each column carries at most
// one field.
func htmlMapFields(cells []string) map[string]int {
	mapping := make(map[string]int, len(cells))
	claimed := make([]bool, len(cells))
	canon := make([]string, len(cells))

	for i, c := range cells {
		if htmlIsGateLabel(c) {
			// An empty canon label is skipped by the exact pass and by the
			// word-sequence pass alike, so a gate column reaches no field at all.
			continue
		}
		canon[i] = htmlCanonLabel(c)
		if canon[i] == "CUSIP/ISIN" || canon[i] == "ISIN/CUSIP" {
			mapping[htmlFieldCUSIP] = i
			claimed[i] = true
		}
		if canon[i] == "SECURITY / PROPONENT" || canon[i] == "SECURITY/PROPONENT" {
			mapping[htmlFieldCUSIP] = i
			mapping[htmlFieldBy] = i
			claimed[i] = true
		}

		// This split label names the proposal's source, not the company.
		// Claim it before the ISSUER/PROPOSAL word-sequence fallbacks.
		if canon[i] == "ISSUER I OR SHAREHOLDER S" || canon[i] == "ISSUER I OR SHAREHOLDER S PROPOSAL" {
			if _, taken := mapping[htmlFieldBy]; !taken {
				mapping[htmlFieldBy] = i
				claimed[i] = true
			}
		}

		// In the SEC's lettered Item 1 wording, column (f) is named "Proposal
		// Type" but carries MGMT/SHOLDER -- the source of the proposal. Outside
		// that fixed wording, "Proposal Type" remains the description synonym
		// needed by the unlettered four-column family.
		if label, letter, ok := htmlLetteredLabel(c); ok && letter == 'f' &&
			htmlContainsWords(htmlCanonLabel(label), "PROPOSAL TYPE") {
			mapping[htmlFieldBy] = i
			claimed[i] = true
		}
	}

	// A bare "Voted" or "Cast" column beside a header that names the vote itself
	// ("Vote Instruction", "Vote Cast", "How Voted") is the WHETHER-voted flag,
	// Yes/No, not the vote. FQF Trust / O'Shares 2018 print `Vote Instruction |
	// Voted | Vote Against Management`, and reading "Voted" as the vote emitted
	// "Yes" on 103,215 matched rows, 4,759 of them against an ISS AGAINST. The
	// vote field is offered to the strong names first, whatever their column
	// position, so the flag can claim nothing.
	for i, lab := range canon {
		if lab == "" || claimed[i] {
			continue
		}
		if _, taken := mapping[htmlFieldVote]; taken {
			break
		}
		if htmlExactSynonym(lab, htmlSynonyms[htmlFieldVote]) && !htmlWeakVoteLabel(lab) {
			mapping[htmlFieldVote] = i
			claimed[i] = true
		}
	}
	if _, taken := mapping[htmlFieldVote]; taken {
		for i, lab := range canon {
			if (lab == "VOTED" || (strings.HasPrefix(lab, "DID ") && strings.Contains(lab, "VOTE"))) && !claimed[i] {
				mapping[htmlFieldVotedFlag] = i
				claimed[i] = true
				break
			}
		}
	}

	for i, lab := range canon {
		if lab == "" || claimed[i] {
			continue
		}
		for _, field := range htmlFieldOrder {
			if _, taken := mapping[field]; taken {
				continue
			}
			if htmlExactSynonym(lab, htmlSynonyms[field]) {
				mapping[field] = i
				claimed[i] = true
				break
			}
		}
	}

	// The tie-break is total: the longest matching synonym wins, and among equal
	// lengths the field earliest in htmlFieldOrder does, because the scan visits
	// them in that order and only a STRICTLY longer match displaces the incumbent.
	for i, lab := range canon {
		if lab == "" || claimed[i] {
			continue
		}
		best, bestLen := "", 0
		for _, field := range htmlFieldOrder {
			if _, taken := mapping[field]; taken {
				continue
			}
			if field == htmlFieldVote && strings.HasPrefix(lab, "DID ") {
				// `Did Fund Cast Vote on Matter (Y/N)` asks whether the fund
				// voted: the flag, never the vote (Tributary Funds 2021).
				continue
			}
			if field == htmlFieldDesc && strings.Contains(lab, "VOTABLE") {
				// `Votable Proposal` heads a Yes/No column in the ProxyEdge
				// full-width table (Clearwater 2011); the proposal text sits in
				// an unlabelled column the description adoption finds.
				continue
			}
			for _, s := range htmlSynonyms[field] {
				if len(s) > bestLen && htmlContainsWords(lab, s) {
					best, bestLen = field, len(s)
				}
			}
		}
		if best == "" && ((strings.HasPrefix(lab, "DID ") && strings.Contains(lab, "VOTE")) || strings.Contains(lab, "VOTABLE")) {
			if _, taken := mapping[htmlFieldVotedFlag]; !taken {
				best = htmlFieldVotedFlag
			}
		}
		if best != "" {
			mapping[best] = i
			claimed[i] = true
		}
	}
	// A spanned issuer heading covers the item number and proposal text;
	// the combined ID column distinguishes this shared identity/vote grid.
	if id, hasID := mapping[htmlFieldCUSIP]; hasID && canon[id] == "CUSIP/ISIN" {
		if issuer, hasIssuer := mapping[htmlFieldIssuer]; hasIssuer && issuer > 0 && issuer+1 < len(canon) &&
			canon[issuer] == "ISSUER NAME" && canon[issuer-1] == "" && canon[issuer+1] == "PROPOSAL TYPE" {
			mapping[htmlFieldItem] = issuer - 1
			mapping[htmlFieldDesc] = issuer
			mapping[htmlFieldBy] = issuer + 1
		}
	}
	// This mixed header labels identity rows above proposal rows on the same
	// grid: Issuer/Agenda Items is the issuer or item number, and
	// Security[Symbol] is the combined identifier or proposal description.
	for i, lab := range canon {
		meeting, item := i-2, i-1
		if i >= 3 && canon[i-3] == "MEETING DATE" && canon[i-2] == "" {
			meeting, item = i-3, i-2
		}
		if lab == "SECURITY SYMBOL" && i >= 2 && i+4 < len(canon) &&
			(canon[meeting] == "MEETING" || canon[meeting] == "MEETING DATE") && canon[i-1] == "ISSUER AGENDA ITEMS" &&
			canon[i+1] == "MEET TYPE PROP TYPE" && canon[i+4] == "RECORD DATE" {
			mapping[htmlFieldMtgDate] = meeting
			mapping[htmlFieldIssuer] = i - 1
			mapping[htmlFieldItem] = item
			mapping[htmlFieldDesc] = i
			mapping[htmlFieldCUSIP] = i
			mapping[htmlFieldSecuritySymbol] = i
			mapping[htmlFieldBy] = i + 1
			mapping[htmlFieldRecordDate] = i + 4
			delete(mapping, htmlFieldTicker)
			break
		}
	}
	return mapping
}

// htmlWeakVoteLabel is a vote synonym that, on its own, cannot tell a vote column
// from a did-the-fund-vote flag; it claims the vote only when no strong name does.
func htmlWeakVoteLabel(canon string) bool {
	// `Did Fund Cast Vote on Matter (Y/N)` (Tributary Funds 2021) asks WHETHER
	// the fund voted; it is the voted flag, never the vote.
	return canon == "VOTED" || canon == "CAST" || strings.HasPrefix(canon, "DID ")
}

// htmlIsGateLabel reports whether a header cell asks a yes/no QUESTION about the
// row rather than naming a value the row carries. `Voted?` is the case that
// matters: 81 filings print `Proposal Type | Voted? | Vote | For/Agnst Mgmt`,
// where that column answers WHETHER the fund cast a ballot -- its values are Yes
// and No -- and the fund's actual vote sits in the NEXT column. The vanguard
// layout already reads the same column as VoteOtherInfo rather than a vote.
//
// htmlCanonLabel folds punctuation away, so "Voted?" and "Voted" are one label by
// the time the synonym table sees them; the question mark has to be read here,
// before that. A gate column is mapped to NOTHING: if it claimed the vote field
// every row of those filings would report how_voted = "Yes", a value the filing
// never recorded, on funds ISS Voting Analytics does not cover -- so nothing
// downstream could contradict it.
//
// Trailing footnote markers are stripped first: "Voted?*" is the same question.
func htmlIsGateLabel(cell string) bool {
	s := strings.TrimRight(htmlFlat(cell), "*†‡§ ")
	if htmlCanonLabel(s) == "VOTED YES OR NO" {
		return true
	}
	// A legend after the question, `Did the Fund Vote? (Y/N)` (filer agent
	// 1580642's four-row header), is not the label; the question mark before
	// it is what is read. A question that asks HOW the fund voted names the
	// vote itself and is no gate.
	q := s
	if strings.HasSuffix(q, ")") {
		if i := strings.LastIndex(q, "("); i > 0 {
			q = strings.TrimSpace(q[:i])
		}
	}
	if strings.HasSuffix(q, "?") {
		return !strings.HasPrefix(htmlUpperASCII(q), "HOW ")
	}
	label, letter, ok := htmlLetteredLabel(s)
	return ok && letter == 'g' && htmlCanonLabel(label) == "VOTED"
}

func htmlExactSynonym(lab string, syns []string) bool {
	for _, s := range syns {
		if lab == s {
			return true
		}
	}
	return false
}

// htmlContainsWords reports whether sub occurs in lab as a whole word sequence,
// so "PROPOSAL" matches "SHAREHOLDER PROPOSAL" but not "PROPOSALS".
func htmlContainsWords(lab, sub string) bool {
	if lab == sub {
		return true
	}
	for i := 0; i+len(sub) <= len(lab); i++ {
		if lab[i:i+len(sub)] != sub {
			continue
		}
		if i > 0 && lab[i-1] != ' ' {
			continue
		}
		if i+len(sub) < len(lab) && lab[i+len(sub)] != ' ' {
			continue
		}
		return true
	}
	return false
}

// htmlLetteredLabel removes the SEC Item 1 prefix from a printed label and
// returns its letter. The prefix is evidence about the label -- notably (g)
// Voted is a gate -- but is not itself part of any synonym.
func htmlLetteredLabel(s string) (label string, letter byte, ok bool) {
	s = htmlFlat(s)
	if len(s) < 3 || s[0] != '(' || s[2] != ')' {
		return s, 0, false
	}
	letter = lowerASCII(s[1])
	if letter < 'a' || letter > 'i' {
		return s, 0, false
	}
	return strings.TrimSpace(s[3:]), letter, true
}

// htmlCanonLabel renders a header cell as a comparable label: the SEC's
// lettered prefix removed, camelCase split so "VoteCast" reads as "Vote Cast",
// uppercased, and punctuation other than '/' and '#' folded to a space. '/'
// survives because "For/Against Management" is a real column and '#' because it
// is the item column of a whole format family.
func htmlCanonLabel(s string) string {
	if label, _, ok := htmlLetteredLabel(s); ok {
		s = label
	}
	s = htmlSplitCamel(htmlFlat(s))
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z':
			b.WriteByte(c - ('a' - 'A'))
		case c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '/', c == '#':
			b.WriteByte(c)
		default:
			b.WriteByte(' ')
		}
	}
	out := htmlFlat(b.String())
	// Vericimetry and its siblings glue the item-number sign to the next column
	// name, printing one cell `#PROPOSAL` where the grammar has `# | Proposal`.
	// A bare `#` is still the item column, so only strip the sign when a name
	// follows it.
	if len(out) > 1 && out[0] == '#' {
		out = htmlFlat(out[1:])
	}
	return out
}

// htmlSplitCamel inserts a space at every lower-to-upper transition and before
// the last capital of a run that starts a new word ("ITEMDesc" -> "ITEM Desc").
func htmlSplitCamel(s string) string {
	var b strings.Builder
	b.Grow(len(s) + 8)
	for i := 0; i < len(s); i++ {
		c := s[i]
		if i > 0 && c >= 'A' && c <= 'Z' {
			p := s[i-1]
			nextLower := i+1 < len(s) && s[i+1] >= 'a' && s[i+1] <= 'z'
			if (p >= 'a' && p <= 'z') || (p >= '0' && p <= '9') ||
				(p >= 'A' && p <= 'Z' && nextLower) {
				b.WriteByte(' ')
			}
		}
		b.WriteByte(c)
	}
	return b.String()
}

// ---------------------------------------------------------------------------
// Meeting context and row emission
// ---------------------------------------------------------------------------

// htmlContext is the meeting identity this grammar prints in the block rows
// ABOVE a header rather than in the table itself.
type htmlContext struct {
	Issuer      string
	CUSIP       string
	ISIN        string
	Ticker      string
	MeetingDate string
}

func (c *htmlContext) merge(n htmlContext) {
	// A column label is never an identity value, whichever reader offered it
	// (MET Investors 2010: `Security ID on Ballot` as the CUSIP and the
	// ticker of 2,639 rows through a reader the row-level guards did not
	// cover).
	if name, tic, cus, ok := htmlIssuerTickerCUSIPParens(n.Issuer); ok {
		n.Issuer = name
		if n.Ticker == "" {
			n.Ticker = tic
		}
		if n.CUSIP == "" {
			n.CUSIP = cus
		}
	}
	if n.Issuer != "" && !htmlIsBareLabel(n.Issuer) {
		c.Issuer = n.Issuer
	}
	if n.CUSIP != "" && !htmlIsBareLabel(n.CUSIP) {
		c.CUSIP = n.CUSIP
	}
	if n.ISIN != "" {
		c.ISIN = n.ISIN
	}
	if n.Ticker != "" && !htmlIsBareLabel(n.Ticker) {
		c.Ticker = n.Ticker
	}
	if n.MeetingDate != "" {
		c.MeetingDate = n.MeetingDate
	}
}

// htmlContextLabels is the label vocabulary of the block rows. It doubles as the
// cut list: a value runs to the end of its line or to the next label, whichever
// comes first, because filers put two labels on one line.
var htmlContextLabels = []string{
	"ISSUER NAME:", "ISSUER:", "MEETING DATE:", "SHAREHOLDER MEETING:", "RECORD DATE:",
	"EXCHANGE TICKER SYMBOL:", "TICKER SYMBOL:", "TICKER:", "SECURITY ID:", "SECURITY:",
	"CUSIP NUMBER / ISIN CODE:", "CUSIP NUMBER/ISIN CODE:", "CUSIP NUMBER:", "CUSIP:", "CUSIP/SEDOL:", "ISIN:",
}

// htmlContextCutLabels end a value without being read: `Meeting Date: JUL 25,
// 2018 Meeting Type: Annual` (Keeley Funds 2019, 3,017 rows with no date on
// r133). Reading the type as context of its own would let a lone `Meeting
// Type:` row open a new, empty meeting.
var htmlContextCutLabels = []string{"MEETING TYPE:", "MTG TYPE:", "QUICK CODE:"}

// htmlBareValued are bare labels printed WITH their value in the same cell
// (`Primary CUSIP 35671D857`, `Primary ISIN US35671D8570`; Deutsche's db-X
// and DBX ETF trusts, 58k rows with no issuer, id or date on 2026-09-02).
var htmlBareValued = map[string]string{
	"PRIMARY CUSIP ": "CUSIP:", "PRIMARY ISIN ": "ISIN:", "CUSIP ": "CUSIP:", "ISIN ": "ISIN:",
	// `Meeting Date/Type 05/06/08 AGM | Security H01301102 | Shares Voted
	// 74,800` (Principal Variable Contracts Funds 2008, 431 of 513 rows with
	// no date on r155). `Security` is read only before an id-shaped value,
	// because it also opens an issuer's name (Security Capital Corp).
	"MEETING DATE/TYPE ": "MEETING DATE:", "SECURITY ": "SECURITY ID:",
	// `Meeting\nDate 28-Apr-05`, one cell wrapped at a newline (North Track
	// Funds 2005, 3,148 undated rows on r156); read only before a date.
	"MEETING DATE ": "MEETING DATE:",
}

// htmlBareValuedOK reports whether a bare label printed with its value may be
// read: an id label needs an id-shaped value.
func htmlBareValuedOK(prefix, rest string) bool {
	if prefix == "MEETING DATE " {
		return htmlDate(rest) != ""
	}
	if prefix != "SECURITY " {
		return true
	}
	f := strings.Fields(rest)
	if len(f) != 1 {
		return false
	}
	id := htmlPadCUSIP(f[0])
	return pvTextCUSIP(id) || isinToken(id)
}

// htmlBareLabels are the labels the ProxyEdge grammar prints WITHOUT a colon,
// each in its own cell with the value in the next (`Security | G16612106`,
// `ISIN | GB0030913577`, `Meeting Date | 13-Jul-2016`; Gabelli's filer-agent
// vintage, 616k rows in 256 filings with no id, date or issuer on 2026-09-02).
// They are read as the colon form.
var htmlBareLabels = map[string]string{
	"SECURITY": "SECURITY ID:", "SECURITY ID": "SECURITY ID:", "CUSIP": "CUSIP:",
	"TICKER": "TICKER:", "TICKER SYMBOL": "TICKER SYMBOL:", "ISIN": "ISIN:",
	"MEETING DATE": "MEETING DATE:", "ISSUER NAME": "ISSUER NAME:",
	"PROVIDER SECURITY ID": "SECURITY ID:", "RECORD DATE": "RECORD DATE:",
	// Donnelley's identity grid alternates label and value cells across one row
	// (`Meeting Date | | 07/15/2014 | | Country | | Spain | | Primary Security
	// ID | | E6282J109`); with only one known label among six filled cells the
	// row was too wide to be bare, and 17,472 rows of 0001193125-15-291803 lost
	// their date on run71.
	"PRIMARY SECURITY ID": "SECURITY ID:",
	// `Meeting Date/Type | | 06/10/08 AGM` (CRM Mutual Fund Trust 2008, 1,408
	// rows with no date on r154): the type rides in the label and the value.
	"MEETING DATE/TYPE": "MEETING DATE:",
	// `Record | Meeting | 4/23/2020`: the dates row of Bragg Capital Trust
	// 2020 (888 undated rows on r185) labels the meeting date with the bare
	// word, beside a record-date label that carries no value.
	"MEETING": "MEETING DATE:", "RECORD": "RECORD DATE:",
	// `Cusip/Sedol | B02ZK79`: the non-US sections of Guinness Atkinson Funds
	// 2007 (1,653 of 2,882 rows with no id and no date on r206) label the one
	// id column for both markets, and print a SEDOL under it.
	"CUSIP/SEDOL": "CUSIP/SEDOL:",
	// Not "ISSUER": it is a proponent value ('Issuer' in Buffalo Funds' Proposed
	// By column), and reading it as a label consumed 173,538 vote rows across
	// 395 filings on run55.
}

// A label at the end of the identity row can put its value directly below.
// Join adjacent label cells, but take only the date under the label's last cell.
func htmlFollowingMeetingDate(cells []string, feed *htmlRowFeed) string {
	last := len(cells) - 1
	for last >= 0 && htmlFlat(cells[last]) == "" {
		last--
	}
	if last < 0 || !strings.HasSuffix(htmlUpperASCII(htmlFlat(strings.Join(cells[:last+1], " "))), "MEETING DATE:") {
		return ""
	}
	below, ok := feed.peek(0)
	if !ok || below.newTable || len(below.cells) != len(cells) || htmlHasVoteCell(below.cells) {
		return ""
	}
	return htmlDate(below.cells[last])
}

// A labelled month fragment is context, not a header over the following row.
func htmlPartialMeetingDateCell(cells []string) bool {
	for _, cell := range cells {
		flat := htmlUpperASCII(htmlFlat(cell))
		if strings.HasPrefix(flat, "MEETING DATE:") && htmlMonths[strings.TrimSpace(flat[len("MEETING DATE:"):])] {
			return true
		}
	}
	return false
}

// htmlReadContext pulls the meeting identity out of a block row. labelled
// reports whether the row carried any of the labels at all, which is what tells
// a new meeting block apart from decorative furniture.
func htmlReadContext(cells []string) (ctx htmlContext, labelled bool) {
	var (
		above    string // the last unlabelled line seen
		above2   string // the unlabelled line before that
		lead     string // the unlabelled line directly above the FIRST label
		leadPrev string // the unlabelled line above lead
		leadSeen bool
	)
	var (
		items  []string
		cellOf []int // the cell each item came from
	)
	// Bare labels are read only on a short identity row. A data row of a wide
	// export carries the WORD `CUSIP` as a column value (Brighthouse Funds
	// Trust II: 5,021 vote rows consumed as context on 2026-09-02).
	// ... and never on a repeated header row, whose every filled cell is a
	// column label (`Company Name | Ticker | ...`, Buffalo Funds: every issuer
	// read as "Company Name" on 2026-09-02).
	// A row of up to four cells may carry one bare label; a wider row must
	// carry two (Deutsche's grid: three labels to a row), because a wide
	// export's data row can print CUSIP as a value and 'No' as its vote
	// (Brighthouse Funds Trust II: 8,224 rows consumed as context once).
	hasVote := htmlHasVoteCell(cells)
	allLabels := htmlAllLabels(cells)
	bare := !hasVote && !allLabels && (htmlFilledCells(cells) <= 4 || htmlBareLabelCount(cells) >= 2)
	// The Security label grid opens a meeting with the issuer's name in the
	// leading unlabelled cell and its id behind a bare `Security` label
	// (`Electrolux AB | | Shares Voted | 0 | Security | W24713120 | Meeting
	// Status | Submitted`, Lincoln Variable Insurance Products Trust 2005:
	// 2,054 of 7,890 rows with no id, and the centered page-break paragraph
	// before the table read as the issuer instead). Seven filled cells with one
	// bare label is too wide for the rule above, so the shape is asked for only
	// AFTER that rule refused the row -- the common row pays nothing for it, and
	// hasVote and allLabels are already established here, so the detector never
	// scans for them again.
	gridIssuer := ""
	if !bare && !hasVote && !allLabels {
		if issuer, ok := htmlSecurityLabelGridIssuer(cells); ok {
			gridIssuer, bare = issuer, true
		} else if issuer, ok := htmlWrappedLabelStripRow(cells); ok {
			// The wrapped two-row identity strip (Guinness Atkinson Funds
			// 2007): same reason for asking only here -- the row is too wide
			// for the bare rule, and the common row never pays for the scan.
			gridIssuer, bare = issuer, true
		}
	}
	for ci, cell := range cells {
		// Firsthand prints `Ticker :` and misspells the id label `CUSPID :`.
		// Canonicalize only the label; leave its printed value untouched.
		if colon := strings.IndexByte(cell, ':'); colon >= 0 {
			key := htmlUpperASCII(strings.TrimSpace(cell[:colon]))
			if key == "CUSPID" || key == "TICKER" {
				if key == "CUSPID" {
					key = "CUSIP"
				}
				items = append(items, key+":"+htmlFlat(cell[colon+1:]))
				cellOf = append(cellOf, ci)
				continue
			}
		}
		// A label wrapped at a source newline inside its cell (`Meeting
		// Date:`, GMO Trust: 38,059 of 38,551 rows with no date on
		// 2026-09-02) is one item, read whole.
		if flat := htmlFlat(cell); htmlHasLabelPrefix(htmlUpperASCII(flat)) || htmlMeetingTypeCut(htmlUpperASCII(flat)) > 0 {
			items = append(items, flat)
			cellOf = append(cellOf, ci)
			continue
		} else if label, ok := htmlBareLabels[htmlUpperASCII(flat)]; ok && bare {
			items = append(items, label)
			cellOf = append(cellOf, ci)
			continue
		} else if bare {
			up := htmlUpperASCII(flat)
			valued := false
			for prefix, label := range htmlBareValued {
				if strings.HasPrefix(up, prefix) && htmlBareValuedOK(prefix, flat[len(prefix):]) {
					items = append(items, label+" "+strings.TrimSpace(flat[len(prefix):]))
					cellOf = append(cellOf, ci)
					valued = true
					break
				}
			}
			if valued {
				continue
			}
		}
		for _, line := range strings.Split(cell, "\n") {
			items = append(items, strings.TrimSpace(line))
			cellOf = append(cellOf, ci)
		}
	}
	for i, line := range items {
		{
			// The fold is hoisted out of the six-label loop: done inside it, every
			// line of every row of a 155 MB body is uppercased six times over.
			up := htmlUpperASCII(line)
			if bare && htmlFilledCells(cells) == 1 {
				if next, ok := htmlInlineMeetingHeading(line, up); ok {
					ctx.merge(next)
					labelled = true
					continue
				}
			}
			// The issuer may precede the labels on the SAME line: `TELUS
			// CORPORATION MEETING DATE: MAY 7, 2009 TICKER: T SECURITY ID:
			// 87971M996` (Fidelity Investment Trust 2009, 24,488 rows with no
			// security id). Only a line carrying at least two labels after an
			// issuer-shaped prefix is split; a sentence mentioning one label
			// is not context.
			if !htmlHasLabelPrefix(up) {
				if expanded, ok := htmlExpandMtgDateLabel(line, up); ok {
					line, up = expanded, htmlUpperASCII(expanded)
				}
			}
			if !htmlHasLabelPrefix(up) {
				if cut := htmlMeetingTypeCut(up); cut > 0 {
					// `Special Meeting Date: 08/31/2006`, `AGM Meeting Date:`
					// (Manning & Napier 2007, 10,822 rows with no date): the
					// meeting type rides inside the label.
					line, up = line[cut:], up[cut:]
				} else if cut, ok := htmlLeadingIssuerCut(line, up); ok {
					above = strings.TrimSpace(line[:cut])
					line, up = line[cut:], up[cut:]
				}
			}
			// A line is context only if it BEGINS with one of the labels. Without
			// that anchor a proposal description that merely mentions a ticker or a
			// CUSIP is read as a meeting heading, and the vote it carries is lost
			// while the meeting identity is corrupted. Labels FOLLOWING the first on
			// the same line are still read: filers print two per line.
			if !htmlHasLabelPrefix(up) {
				if line != "" {
					above2, above = above, line
				}
				continue
			}
			if !leadSeen {
				lead, leadPrev, leadSeen = above, above2, true
			}
			for _, label := range htmlContextLabels {
				v, ok := htmlLabelValue(line, up, label)
				if !ok {
					continue
				}
				labelled = true
				// `Issuer: a | Caterpillar Inc`, `Meeting Date: d | 6/12/2013`: the
				// form's item letter after the colon is no value (Investment
				// Managers Series Trust 2013, 895 rows with `a` for the issuer
				// on r187); the value is in the next cell.
				letterOnly := false
				if t := strings.TrimSpace(v); len(t) == 1 && t[0] >= 'a' && t[0] <= 'i' {
					v, letterOnly = "", true
				}
				// A cell that is ONLY the label has its value in the next cell:
				// `Ticker: | MMM | Security ID: | 88579Y101` (FundVantage Trust,
				// 101,061 of 108,913 rows with no issuer, id or date on 2026-09-02).
				// The value cell may wrap too (`MAY 12,` / `2005`), so it is
				// read whole.
				bareUp := strings.TrimSpace(up)
				if letterOnly {
					bareUp = strings.TrimSpace(bareUp[:len(bareUp)-1])
				}
				if label == "MEETING DATE:" {
					if cut := htmlMeetingTypeCut(bareUp); cut > 0 {
						bareUp = strings.TrimSpace(bareUp[cut:])
					}
				}
				if strings.TrimSpace(v) == "" && strings.EqualFold(bareUp, label) {
					// `Annual Meeting Date:<br> 07/31/2003` (Ivy Funds 2004, 3,153 of
					// 3,530 rows without a date on r174b): the value is the label
					// cell's own next line, before any other cell is asked.
					for j := i + 1; j < len(items) && cellOf[j] == cellOf[i]; j++ {
						if items[j] == "" {
							continue
						}
						if label == "MEETING DATE:" && htmlDate(items[j]) != "" {
							v = items[j]
						}
						break
					}
				}
				if label == "MEETING DATE:" && strings.TrimSpace(v) != "" && htmlDate(v) == "" {
					// `Meeting Date:  MAY` / `09, 2014 Record Date: ...`: the value
					// wraps over the line break inside the cell (Oppenheimer Rising
					// Dividends 2014, 1,047 undated rows on r179). The next line's
					// text before any label joins when the pair parses.
					for j := i + 1; j < len(items) && cellOf[j] == cellOf[i]; j++ {
						if items[j] == "" {
							continue
						}
						rest := items[j]
						restUp := htmlUpperASCII(rest)
						cut := len(rest)
						for _, other := range append(append([]string(nil), htmlContextLabels...), htmlContextCutLabels...) {
							if k := strings.Index(restUp, other); k >= 0 && k < cut {
								cut = k
							}
						}
						if joined := strings.TrimSpace(v) + " " + strings.TrimSpace(rest[:cut]); htmlDate(joined) != "" {
							v = joined
						}
						break
					}
				}
				// Join a date's printed fragments across adjacent value cells,
				// stopping at the next label or a complete date.
				if label == "MEETING DATE:" && htmlDate(v) == "" {
					joined, parts := strings.TrimSpace(v), 0
					for ci := cellOf[i] + 1; ci < len(cells) && parts < 3; ci++ {
						next := htmlFlat(cells[ci])
						if next == "" {
							continue
						}
						if strings.Contains(next, ":") {
							break
						}
						joined = strings.TrimSpace(joined + " " + next)
						parts++
						if htmlDate(joined) != "" {
							v = joined
							break
						}
					}
				}
				if strings.TrimSpace(v) == "" && strings.EqualFold(bareUp, label) {
					for j := i + 1; j < len(items); j++ {
						if cellOf[j] == cellOf[i] {
							continue
						}
						flat := htmlFlat(cells[cellOf[j]])
						if flat == "" {
							continue
						}
						if !htmlHasLabelPrefix(htmlUpperASCII(flat)) {
							v = flat
							// `Meeting Date: | MAY | 17, 2005` (T. Rowe Price
							// Small-Cap Stock Fund 2005, 1,855 undated rows): the
							// value is split over two cells, and the month alone is
							// no date. The next filled cell joins when the pair
							// parses and the first cell alone does not.
							if label == "MEETING DATE:" && htmlDate(v) == "" {
								for k := j + 1; k < len(items); k++ {
									if cellOf[k] == cellOf[j] {
										continue
									}
									next := htmlFlat(cells[cellOf[k]])
									if next == "" {
										continue
									}
									if !htmlHasLabelPrefix(htmlUpperASCII(next)) && htmlDate(v+" "+next) != "" {
										v = v + " " + next
									}
									break
								}
							}
						}
						break
					}
				}
				switch label {
				case "ISSUER NAME:", "ISSUER:":
					// `Issuer: 929903` is an issuer NUMBER (Manning & Napier
					// 2007), never the name; the heading line above keeps it.
					// Six characters of it are the CUSIP issuer number (929903
					// is Wachovia's, 501049 Kroll's in SM&R 2005), the id the
					// linker's cusip6 rung reads.
					// A full CUSIP under Issuer: is also an id, not a replacement
					// for the company name in the preceding meeting row.
					if num := strings.TrimSpace(htmlFlat(v)); htmlIsNumeric(num) || htmlIsCUSIP6(num) || pvTextCUSIP(num) {
						if ctx.CUSIP == "" && (htmlIsCUSIP6(num) || pvTextCUSIP(num)) {
							ctx.CUSIP = num
						}
					} else if ctx.Issuer == "" {
						ctx.Issuer = htmlFlat(v)
					}
				case "MEETING DATE:", "SHAREHOLDER MEETING:":
					if ctx.MeetingDate == "" {
						ctx.MeetingDate = htmlDate(v)
					}
				case "EXCHANGE TICKER SYMBOL:", "TICKER SYMBOL:", "TICKER:":
					if ctx.Ticker == "" {
						ctx.Ticker = htmlValueOrEmpty(v)
					}
				case "CUSIP/SEDOL:":
					// A mixed-market label provides no evidence that a short numeric
					// id lost leading zeros: padding a SEDOL fabricates a CUSIP.
					if id := htmlValueOrEmpty(v); ctx.CUSIP == "" && pvTextCUSIP(id) {
						ctx.CUSIP = id
					}
				case "CUSIP NUMBER / ISIN CODE:", "CUSIP NUMBER/ISIN CODE:":
					cusip, isin := htmlSecurityID(v)
					if ctx.CUSIP == "" {
						ctx.CUSIP = cusip
					}
					if ctx.ISIN == "" {
						ctx.ISIN = isin
					}
				case "SECURITY:", "SECURITY ID:", "CUSIP NUMBER:", "CUSIP:":
					// A Security ID that is an ISIN belongs in the ISIN column.
					if id := htmlPadCUSIP(htmlValueOrEmpty(v)); isinToken(id) {
						if ctx.ISIN == "" {
							ctx.ISIN = id
						}
					} else if ctx.CUSIP == "" {
						ctx.CUSIP = id
					}
				case "ISIN:":
					// `ISIN | Agenda 932273458 - Management` (North Track 2005):
					// only an ISIN-shaped value is one.
					if id := htmlValueOrEmpty(v); ctx.ISIN == "" && isinToken(id) {
						ctx.ISIN = id
					}
				}
			}
		}
	}
	// The issuer is the one field of a block heading this grammar often prints
	// with no label of its own: `ABBOTT LABORATORIES` on the line above
	// `Security ID: ... Ticker: ...`. It is read only when the block carried a
	// label but no ISSUER NAME:, and only from the line DIRECTLY above the first
	// label, so a paragraph elsewhere in the same chunk cannot supply it.
	// The grid's own leading cell is the issuer, and it outranks the line-above
	// fallback: on this shape the line above the first label is the value of a
	// preceding label pair (`0`), not a company.
	// The wrapped two-row identity strip leads its first row with a bare
	// issuer name (Guinness Atkinson Funds 2007), and its labels are numerous
	// enough that the bare rule above already accepted the row -- so the shape
	// is asked for here instead, and only for a bare identity row that reached
	// the line-above fallback with no issuer of its own.
	if labelled && bare && ctx.Issuer == "" && gridIssuer == "" {
		if issuer, ok := htmlWrappedLabelStripRow(cells); ok {
			gridIssuer = issuer
		}
	}
	if labelled && ctx.Issuer == "" && gridIssuer != "" {
		ctx.Issuer = gridIssuer
	}
	if labelled && ctx.Issuer == "" {
		// `WACHOVIA CORPORATION` / `WB` / `Special Meeting Date: ...` in one row
		// (Manning & Napier 2007): the line above the label is the ticker, and
		// the issuer is the line above that.
		if htmlTickerShaped(lead) && htmlIsIssuerLine(leadPrev) && !htmlTickerShaped(leadPrev) {
			ctx.Issuer = htmlFlat(leadPrev)
			if ctx.Ticker == "" {
				ctx.Ticker = strings.TrimSpace(lead)
			}
		} else if htmlIsIssuerLine(lead) && !htmlIsBareLabel(lead) {
			ctx.Issuer = htmlFlat(lead)
		}
	}
	return ctx, labelled
}

// htmlStackedLabelSet is the vocabulary of a bare label row, without colons.
var htmlStackedLabelSet = map[string]string{
	"TICKER": "TICKER", "TICKER SYMBOL": "TICKER", "SYMBOL": "TICKER",
	"SECURITY ID": "CUSIP", "CUSIP": "CUSIP", "CUSIP NUMBER": "CUSIP",
	"MEETING DATE": "MEETING DATE", "MTG DATE": "MEETING DATE", "DATE OF MEETING": "MEETING DATE",
	"MEETING COUNTRY DATE": "MEETING DATE COUNTRY",
	"RECORD DATE":          "RECORD DATE",
	"MEETING TYPE":         "MEETING TYPE", "MTG TYPE": "MEETING TYPE", "MEETING STATUS": "MEETING STATUS",
	"COUNTRY OF TRADE": "COUNTRY", "COUNTRY": "COUNTRY", "ISSUER": "ISSUER", "ISSUER NAME": "ISSUER",
	"COMPANY NAME": "ISSUER", "COMPANY": "ISSUER", "SECURITY": "CUSIP",
	// Labels of an identity header that carry no identity: the meeting's
	// running number and its share count (`NUMBER | Company Name | Meeting
	// Date | Shares Voted | CUSIP (2) | Ticker (2)`, Allied Asset Advisors
	// 2004: 1,077 rows whose hyphenated CUSIPs the shape reader refused, so
	// each meeting inherited the identity of the last one read by shape).
	"NUMBER": "NUMBER", "SHARES VOTED": "SHARES",
	// `SEDOL` heads a foreign issuer's id (M Fund 2017: `Company Name | Meeting
	// Date | SEDOL | Ticker`); the linker reads no SEDOL, but the name and the
	// date beside it are the meeting's, and refusing the row left the proposals
	// with the cover page as their issuer.
	"SEDOL": "SEDOL",
	// The account grid MET Investors Series Trust 2010 prints above each
	// meeting: the location and account labels carry no identity, the two
	// security-id labels carry the CUSIP.
	"LOCATION ID": "LOCATION", "LOCATION NAME": "LOCATION",
	"INSTITUTIONAL ACCOUNT NAME": "ACCOUNT", "INSTITUTIONAL ACCOUNT NUMBER": "ACCOUNT",
	"CUSTODIAN": "ACCOUNT", "CUSTODIAN ACCOUNT NUMBER": "ACCOUNT",
	"PRIMARY SECURITY ID": "CUSIP", "SECURITY ID ON BALLOT": "CUSIP",
	// The words run together (`Issuer Name | Ticker | MeetingDate | Country |
	// SecurityID | MeetingType | RecordDate | SharesVoted | SharesAvailable |
	// ISIN | SEDOL`; 0001193125-13-348301, 1,795 of 1,925 rows with no
	// issuer, id or date on r159).
	"MEETINGDATE": "MEETING DATE", "SECURITYID": "CUSIP", "MEETINGTYPE": "MEETING TYPE",
	"RECORDDATE": "RECORD DATE", "SHARESVOTED": "SHARES", "SHARESAVAILABLE": "SHARES",
	// `... | SharesInstructed | SharesAvailable | Shares onLoan` (Ivy Funds
	// 2011, 1,542 undated rows on r202): one unknown label rejects the row.
	"SHARESINSTRUCTED": "SHARES", "SHARES INSTRUCTED": "SHARES",
	"SHARES ONLOAN": "SHARES", "SHARES ON LOAN": "SHARES",
	"SHARES AVAILABLE": "SHARES", "ISIN": "ISIN",
	// US Bancorp's grammar heads each meeting with `Company Name | Meeting
	// Date | Provider Security ID | Ticker | Meeting Type` (Listed Funds
	// Trust 2022) or `... | Cusip | Ticker | For/Against Mgmnt` (Hennessy
	// 2011) over one value row; the last label of each carries no identity.
	"PROVIDER SECURITY ID": "CUSIP", "FOR/AGAINST MGMNT": "NUMBER",
}

// htmlStackedLabelKey is the label-set key of a stacked label cell: upper
// ASCII, no trailing colon, and no trailing footnote marker (`CUSIP (2)`,
// `Ticker (2)`, `CUSIP(2)`).
func htmlStackedLabelKey(flat string) string {
	key := strings.TrimSpace(strings.TrimRight(htmlUpperASCII(flat), ":* "))
	if strings.HasSuffix(key, ")") {
		if i := strings.LastIndex(key, "("); i > 0 && htmlIsNumeric(key[i+1:len(key)-1]) {
			key = strings.TrimSpace(key[:i])
		}
	}
	return key
}

// htmlInCellStacked reads a row whose label cell stacks several bare labels on
// its own lines and whose next filled cell stacks the values the same way:
// `Security ID / Ticker Symbol / ISIN` beside `151290889 / CX / US1512908898`,
// and `Meeting Type / Meeting Date / Agenda` beside `Special / 24-Feb-2011 /
// 933370796`. A bare one-line label with its value in the next cell (`Issuer` |
// `CEMEX, S.A.B. DE C.V.`) is the one-line case. Lines pair by position, so a
// label cell and a value cell of different heights carry nothing.
func htmlInCellStacked(cells []string) (ctx htmlContext, ok bool) {
	lines := func(s string) []string {
		var out []string
		for _, l := range strings.Split(s, "\n") {
			if l = htmlFlat(l); l != "" {
				out = append(out, l)
			}
		}
		return out
	}
	// A source newline inside the markup splits a label across lines too
	// (`Security` / `ID`), so fragments are joined until they spell a label.
	labelOf := func(key string) (string, bool) {
		if c, known := htmlStackedLabelSet[key]; known {
			return c, true
		}
		switch key {
		case "ISIN", "ISN":
			return "ISIN", true
		case "AGENDA", "FUND NAME":
			return "", true
		}
		return "", false
	}
	keyOf := func(v string) string { return strings.TrimSpace(strings.TrimSuffix(htmlUpperASCII(v), ":")) }
	// A value must have its field's shape; a cell that is neither a label nor
	// a shaped value leaves the row to the other readers.
	take := func(c, v string) bool {
		switch c {
		case "CUSIP":
			if f := strings.Fields(v); len(f) > 1 && htmlUpperASCII(f[0]) == "CUSIP" {
				v = strings.Join(f[1:], " ")
			}
			if !pvTextCUSIP(v) {
				return false
			}
			ctx.CUSIP = v
		case "ISIN":
			if !isinToken(v) {
				return false
			}
			ctx.ISIN = v
		case "TICKER":
			if !htmlTickerShaped(v) {
				return false
			}
			ctx.Ticker = v
		case "MEETING DATE":
			d := htmlDate(v)
			if d == "" {
				return false
			}
			ctx.MeetingDate = d
		case "ISSUER":
			if !htmlIsIssuerLine(v) {
				return false
			}
			ctx.Issuer = v
		default:
			// a label this reader carries no field for (`Meeting Type`, `Agenda`):
			// its value is accepted and dropped
		}
		return true
	}
	assigned := 0
	for i := 0; i < len(cells); i++ {
		labels := lines(cells[i])
		if len(labels) == 0 {
			continue
		}
		// The longest run of fragments that spells a label wins: `Security`
		// alone is a label, but `Security` / `ID` is the label printed.
		var canon []string
		for a := 0; a < len(labels); {
			took := 0
			for b := len(labels); b > a; b-- {
				if c, known := labelOf(keyOf(strings.Join(labels[a:b], " "))); known {
					canon = append(canon, c)
					took = b - a
					break
				}
			}
			if took == 0 {
				canon = nil
				break
			}
			a += took
		}
		if len(canon) == 0 {
			// not a label cell: only a value that follows a label may sit here
			return htmlContext{}, false
		}
		j := i + 1
		for j < len(cells) && htmlFlat(cells[j]) == "" {
			j++
		}
		if j >= len(cells) {
			break
		}
		values := lines(cells[j])
		if len(canon) == 1 {
			values = []string{htmlFlat(cells[j])}
		}
		if _, nextIsLabel := labelOf(keyOf(htmlFlat(cells[j]))); nextIsLabel && len(canon) == 1 {
			// a label with no value on this row (`Ticker Symbol | | | Meeting
			// Date | 07-Jul-10`, Clearwater 2011): the next label follows
			continue
		}
		if len(values) != len(canon) {
			return htmlContext{}, false
		}
		for k, c := range canon {
			if !take(c, values[k]) {
				return htmlContext{}, false
			}
		}
		assigned++
		i = j
	}
	if assigned == 0 || ctx == (htmlContext{}) {
		return htmlContext{}, false
	}
	return ctx, true
}

// htmlStackedLabels reports a row whose every non-empty cell is a bare context
// label, at least two of them, keyed by cell index.
func htmlStackedLabels(cells []string) (map[int]string, bool) {
	labels, _, ok := htmlStackedLabelsWithIssuer(cells)
	return labels, ok
}

// The merged date/country header wraps its other labels over the next row.
// Join only within the same table and column grid; every joined cell must be
// an identity label (apart from the leading issuer) before consuming that row.
func htmlSplitStackedLabelsWithIssuer(cells []string, feed *htmlRowFeed) (map[int]string, string, bool) {
	merged := false
	for _, cell := range cells {
		if htmlStackedLabelKey(htmlFlat(cell)) == "MEETING COUNTRY" {
			merged = true
			break
		}
	}
	if !merged {
		return nil, "", false
	}
	next, exists := feed.peek(0)
	if !exists || next.newTable || len(next.cells) != len(cells) {
		return nil, "", false
	}
	joined := make([]string, len(cells))
	for i := range cells {
		joined[i] = htmlFlat(cells[i] + " " + next.cells[i])
		// Colspan values are anchored at the right edge. The lower `Date`
		// can occupy the left half of the merged Meeting Country cell.
		if i > 0 && htmlStackedLabelKey(htmlFlat(cells[i])) == "MEETING COUNTRY" &&
			htmlFlat(cells[i-1]) == "" && htmlFlat(next.cells[i]) == "" &&
			htmlStackedLabelKey(htmlFlat(next.cells[i-1])) == "DATE" {
			joined[i] = htmlFlat(cells[i] + " " + next.cells[i-1])
			joined[i-1] = ""
		}
	}
	labels, issuer, ok := htmlStackedLabelsWithIssuer(joined)
	if !ok || issuer == "" {
		return nil, "", false
	}
	for _, label := range labels {
		if label == "MEETING DATE COUNTRY" {
			_, _ = feed.next()
			return labels, issuer, true
		}
	}
	return nil, "", false
}

// htmlStackedLabelsWithIssuer is htmlStackedLabels allowing the FIRST filled
// cell to be the issuer's name instead of a label (`Booker Group plc | | Meeting
// Date | | Country | Security ID | ...`, Clearwater Investment Trust 2011): the
// name is returned beside the labels and stamps the values row's issuer.
func htmlStackedLabelsWithIssuer(cells []string) (map[int]string, string, bool) {
	var labels map[int]string
	issuer := ""
	first := true
	for i, cell := range cells {
		flat := htmlFlat(cell)
		if flat == "" {
			continue
		}
		canon, ok := htmlStackedLabelSet[htmlStackedLabelKey(flat)]
		if !ok {
			if first && !htmlIsHeaderWord(flat) && len(strings.Fields(flat)) <= 8 {
				issuer = flat
				first = false
				continue
			}
			return nil, "", false
		}
		first = false
		if labels == nil {
			labels = map[int]string{}
		}
		labels[i] = canon
	}
	if len(labels) == 1 {
		// A row holding the single label `Meeting Date`, with or without the
		// issuer beside it (`Textron Inc. | | Meeting Date`, Donnelley 2010):
		// the date is on the next row, and a date is the one value that proves
		// itself, so the one-label row is admitted for that label alone.
		for _, c := range labels {
			return labels, issuer, c == "MEETING DATE"
		}
	}
	return labels, issuer, len(labels) >= 2
}

// htmlStackedValues reads the row under a stacked label row, column by column.
func htmlStackedValues(cells []string, labels map[int]string) (ctx htmlContext) {
	// A colspan on the label row can put a label one column off its value
	// (Neuberger Berman: `Meeting Date` at column 6, the date at column 5;
	// 185k rows with no date on 2026-09-02). An empty cell under a label
	// takes the neighbour that no other label claims.
	at := func(i int) string {
		if i < 0 || i >= len(cells) {
			return ""
		}
		return htmlFlat(cells[i])
	}
	// A value printed with its own label word in a cell no label claims
	// (`Ticker BOKl` in the issuer's column).
	for i := range cells {
		if _, claimed := labels[i]; claimed {
			continue
		}
		f := strings.Fields(at(i))
		if len(f) == 2 {
			switch htmlUpperASCII(f[0]) {
			case "TICKER":
				ctx.Ticker = f[1]
			case "CUSIP":
				ctx.CUSIP = htmlValueOrEmpty(f[1])
			}
		}
	}
	// When the value row's spacer cells differ from the label row's (`Ticker
	// | Security ID: | Meeting Date | Meeting Status` over `AKAM | CUSIP
	// 00971T101 | 05/14/2014 | | Voted`, Brown Capital Management 2014:
	// 1,575 rows with no date on r160b), the columns no longer meet. With as
	// many filled values as labels, the k-th label takes the k-th value.
	var labelOrder []int
	for i := range labels {
		labelOrder = append(labelOrder, i)
	}
	sort.Ints(labelOrder)
	var filled []string
	for i := range cells {
		if w := at(i); w != "" {
			filled = append(filled, w)
		}
	}
	byRank := map[int]string{}
	if len(filled) == len(labelOrder) {
		for k, i := range labelOrder {
			byRank[i] = filled[k]
		}
	}
	for i, label := range labels {
		v := ""
		if i < len(cells) {
			v = at(i)
		}
		if v == "" {
			for _, j := range []int{i - 1, i + 1} {
				if _, claimed := labels[j]; claimed {
					continue
				}
				if w := at(j); w != "" && !htmlIsHeaderWord(w) {
					v = w
					break
				}
			}
		}
		if v == "" {
			v = byRank[i]
		}
		// A label is never a value: a second label row under the first
		// (MET Investors 2010) read `Country` as the issuer and `Security ID
		// on Ballot` as the CUSIP of 3,328 rows.
		if _, isLabel := htmlStackedLabelSet[htmlStackedLabelKey(v)]; isLabel || htmlIsHeaderWord(v) {
			continue
		}
		switch label {
		case "CUSIP":
			// `CUSIP 746763168`: the value carries its own label word.
			if f := strings.Fields(v); len(f) > 1 && htmlUpperASCII(f[0]) == "CUSIP" {
				v = strings.Join(f[1:], " ")
			}
			// `091 826 107`: printed in groups (Hennessy Funds 2011).
			if joined := strings.ReplaceAll(v, " ", ""); pvTextCUSIP(joined) {
				v = joined
			}
			ctx.CUSIP = htmlValueOrEmpty(v)
		case "TICKER":
			ctx.Ticker = htmlValueOrEmpty(v)
		case "MEETING DATE":
			ctx.MeetingDate = htmlDate(v)
		case "MEETING DATE COUNTRY":
			// Country is not carried in htmlContext; it must not be parsed as
			// part of the date in the merged `24-Jul-09 USA` value cell.
			date, country, ok := strings.Cut(v, " ")
			if ok && strings.TrimSpace(country) != "" {
				ctx.MeetingDate = htmlDate(date)
			}
		case "ISSUER":
			ctx.Issuer = v
		}
	}
	return ctx
}

// htmlInlineMeetingHeading reads `Issuer *TICKER* CUSIP 008190100, 10/30/03 Meeting`.
// All four parts must be present so prose mentioning a CUSIP is not context.
func htmlInlineMeetingHeading(line, up string) (htmlContext, bool) {
	if close := strings.Index(up, ") MEETING "); close > 0 {
		open := strings.LastIndexByte(line[:close], '(')
		cut := strings.Index(up[:close], ", CUSIP ")
		if open > 0 && cut > open {
			issuer := strings.TrimSpace(line[:open])
			ticker := strings.TrimSpace(line[open+1 : cut])
			cusip := strings.TrimSpace(line[cut+len(", CUSIP ") : close])
			date := htmlDate(line[close+len(") MEETING "):])
			if htmlIsIssuerLine(issuer) && htmlTickerShaped(ticker) && htmlIsCUSIP(cusip) && date != "" {
				return htmlContext{Issuer: issuer, Ticker: ticker, CUSIP: cusip, MeetingDate: date}, true
			}
		}
	}
	const suffix = " MEETING"
	if !strings.HasSuffix(up, suffix) {
		return htmlContext{}, false
	}
	cut := strings.Index(up, " CUSIP ")
	if cut < 0 {
		return htmlContext{}, false
	}
	head := strings.TrimSpace(line[:cut])
	if head == "" || !strings.HasSuffix(head, "*") {
		return htmlContext{}, false
	}
	star := strings.LastIndexByte(head[:len(head)-1], '*')
	if star <= 0 {
		return htmlContext{}, false
	}
	issuer, ticker := strings.TrimSpace(head[:star]), head[star+1:len(head)-1]
	if !htmlIsIssuerLine(issuer) || !htmlTickerShaped(ticker) {
		return htmlContext{}, false
	}
	if cut+len(" CUSIP ") > len(line)-len(suffix) {
		return htmlContext{}, false
	}
	rest := line[cut+len(" CUSIP ") : len(line)-len(suffix)]
	cusip, date, ok := strings.Cut(rest, ",")
	cusip = strings.TrimSpace(cusip)
	if !ok || !htmlIsCUSIP(cusip) {
		return htmlContext{}, false
	}
	date = htmlDate(date)
	if date == "" {
		return htmlContext{}, false
	}
	return htmlContext{Issuer: issuer, Ticker: ticker, CUSIP: cusip, MeetingDate: date}, true
}

// htmlPreLead returns the last non-empty line of the text before a row when
// it is issuer-shaped and is not the fund heading just read from that text.
func htmlPreLead(pre, fund string) string {
	lines := strings.Split(pre, "\n")
	end := len(lines)
	for end > 0 && strings.TrimSpace(lines[end-1]) == "" {
		end--
	}
	if end == 0 {
		return ""
	}
	// The paragraph may wrap at source newlines (`GENTING` / `LEISURE LTD.`):
	// the trailing run of non-blank lines is one paragraph, since the blank
	// paragraphs between headings arrive as blank lines.
	start := end
	for start > 0 && strings.TrimSpace(lines[start-1]) != "" {
		start--
	}
	// The fund heading may abut the issuer with no blank between; it is not
	// part of the issuer's paragraph.
	for i := start; i < end; i++ {
		if strings.TrimSpace(lines[i]) == fund {
			start = i + 1
		}
	}
	if start >= end {
		return ""
	}
	line := htmlFlat(strings.Join(lines[start:end], " "))
	if line == fund || !htmlIsIssuerLine(line) {
		return ""
	}
	return line
}

// htmlHasVoteCell reports a row with a vote value in any cell: a data row,
// whatever labels its other cells happen to spell.
func htmlHasVoteCell(cells []string) bool {
	for _, c := range cells {
		if htmlIsVoteValue(htmlFlat(c)) {
			return true
		}
	}
	return false
}

func htmlFilledCells(cells []string) int {
	n := 0
	for _, c := range cells {
		if htmlFlat(c) != "" {
			n++
		}
	}
	return n
}

// htmlContextLead retains a one-value issuer row only as a candidate. It becomes
// context only when the following row supplies an explicit context label.
// htmlIsMeetingTypePhrase reports a cell that names a meeting's type in words
// (`Annual Meeting`, `Special Meeting of Shareholders`, `Annual General
// Meeting`): every word is type vocabulary and one of them is a type.
func htmlIsMeetingTypePhrase(s string) bool {
	words := strings.Fields(strings.Trim(htmlUpperASCII(htmlFlat(s)), ".,"))
	if len(words) < 2 {
		return false
	}
	typed := false
	for _, w := range words {
		switch w {
		case "ANNUAL", "SPECIAL", "EXTRAORDINARY", "AGM", "EGM", "COURT", "CONTESTED":
			typed = true
		case "MEETING", "GENERAL", "OF", "SHAREHOLDERS", "STOCKHOLDERS", "SHAREOWNERS", "PROXY", "CONTEST", "WRITTEN", "CONSENT", "SOLICITATION":
		default:
			return false
		}
	}
	return typed
}

// htmlIsBareLabel reports a cell that is one of the block-row labels on its
// own (`Country`, `Meeting Date`): furniture that names a column, never a value
// and never the issuer (MET Investors 2010 led a label row with `Country`).
func htmlIsBareLabel(s string) bool {
	_, isLabel := htmlStackedLabelSet[htmlStackedLabelKey(htmlFlat(s))]
	return isLabel || htmlIsHeaderWord(s)
}

func htmlContextLead(cells []string) (string, bool) {
	lead := ""
	for _, cell := range cells {
		flat := htmlFlat(cell)
		if flat == "" {
			continue
		}
		if lead != "" {
			return "", false
		}
		lead = flat
	}
	// A one-cell row that carries a context label (`TICKER: III SECURITY ID:
	// ...` in one spanning cell; Fidelity Fixed Income Trust, 26,992 rows with
	// no security id on 2026-09-02) is context, not an issuer candidate.
	if htmlHasLabelPrefix(htmlUpperASCII(lead)) {
		return "", false
	}
	if htmlDate(lead) != "" {
		// A date on its own row is a value (the one under a `Meeting Date`
		// label row), never the issuer of the block.
		return "", false
	}
	if htmlIsBareLabel(lead) {
		return "", false
	}
	return lead, htmlIsIssuerLine(lead)
}

// htmlIsIssuerLine reports whether an unlabelled line can be read as a block's
// issuer. Anything value-shaped -- a date, a vote, a CUSIP, a signature
// paragraph, anything longer than a column label -- is refused, leaving the
// issuer blank. A blank issuer is a gap; a wrong one is a vote booked against a
// company that never held the meeting.
func htmlIsIssuerLine(s string) bool {
	flat := htmlFlat(s)
	// A page-break paragraph prints the page number alone, centered, right
	// before a meeting's table (`30`, Lincoln Variable Insurance Products Trust
	// 2005). A bare integer names no company: reading it as one booked every
	// proposal of the page against an issuer called `30`.
	if htmlIsNumeric(flat) {
		return false
	}
	return flat != "" && !htmlLooksLikeValue(flat)
}

// htmlSecurityLabelGridIssuer reads the one-row label/value grid that opens a
// meeting with its issuer in the leading unlabelled cell: `Electrolux AB | |
// Shares Voted | 0 | Security | W24713120 | Meeting Status | Submitted`. It
// returns that name when the cells after it alternate label, value, label,
// value with at least two known labels, one of them naming the security's id.
//
// The caller has ALREADY established that the row carries no vote cell and is
// not an all-label header row, so neither is checked again here; the row is
// walked exactly once.
func htmlSecurityLabelGridIssuer(cells []string) (string, bool) {
	issuer := ""
	labels, idLabel := 0, false
	wantLabel := false // set once the issuer is seen: the next filled cell is a label
	for _, cell := range cells {
		flat := htmlFlat(cell)
		if flat == "" {
			continue
		}
		canon, isLabel := htmlStackedLabelSet[htmlStackedLabelKey(flat)]
		if issuer == "" {
			// The grid must LEAD with the name; a row opening with a label is
			// the ordinary stacked shape and belongs to its own reader.
			if isLabel || !htmlIsIssuerLine(flat) || len(strings.Fields(flat)) > 8 {
				return "", false
			}
			issuer, wantLabel = flat, true
			continue
		}
		if wantLabel {
			if !isLabel {
				return "", false
			}
			labels++
			if canon == "CUSIP" {
				idLabel = true
			}
		} else if isLabel {
			// Two labels running: no value between them, so the pairing this
			// reading depends on does not hold.
			return "", false
		}
		wantLabel = !wantLabel
	}
	// Every pair closed leaves the walk expecting the next label; a trailing
	// label with no value leaves it expecting a value, and does not pair.
	return issuer, labels >= 2 && idLabel && wantLabel
}

// htmlMeetingTypeCut returns the length of a meeting-type word that precedes
// `MEETING DATE:` on an uppercased line (`SPECIAL MEETING DATE:`, `AGM MEETING
// DATE:`), or 0 when the line does not open that way.
func htmlMeetingTypeCut(up string) int {
	i := strings.Index(up, " MEETING DATE:")
	if i > 0 && up[:i] == "SPECIAL SHAREHOLDER" {
		return i + 1
	}
	if i <= 0 || i > 12 {
		return 0
	}
	for j := 0; j < i; j++ {
		if !isASCIILetter(up[j]) {
			return 0
		}
	}
	return i + 1
}

// htmlExpandMtgDateLabel rewrites the abbreviated meeting-date label into the
// vocabulary form, so the value after it is read as the meeting date. The label
// may carry a leading meeting-type word and may be wrapped at a source newline
// inside its own cell -- `<strong>Annual` / `Mtg Date: 10/20/2004` (Hillview
// Investment Trust II 2005, 2,646 undated rows over a sibling pair). The type
// word is cut like `Special Meeting Date:` already is; only the label is
// rewritten, so the value stays verbatim. up must be line folded by
// htmlUpperASCII, which is length-preserving.
func htmlExpandMtgDateLabel(line, up string) (string, bool) {
	i := strings.Index(up, "MTG DATE:")
	if i < 0 {
		return line, false
	}
	// At the start of the line, or after exactly one leading word of ASCII
	// letters (the meeting type). Anything else is prose that mentions the
	// abbreviation, not a label.
	if i > 0 {
		head := strings.TrimSpace(up[:i])
		if head == "" {
			return line, false
		}
		for j := 0; j < len(head); j++ {
			if !isASCIILetter(head[j]) {
				return line, false
			}
		}
	}
	return "MEETING DATE:" + line[i+len("MTG DATE:"):], true
}

// htmlTickerShaped reports a bare exchange symbol: one token of one to five
// ASCII capitals, optionally with a dot (`BRK.B`).
func htmlTickerShaped(s string) bool {
	s = strings.TrimSpace(s)
	if len(s) < 1 || len(s) > 6 {
		return false
	}
	letters := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			letters++
			continue
		}
		if c == '.' && i > 0 && i < len(s)-1 {
			continue
		}
		return false
	}
	return letters >= 1 && letters <= 5
}

// htmlIssuerTickerCUSIPParens splits an issuer that carries its ticker and
// CUSIP in a trailing parenthetical -- `Wal-Mart Stores, Inc. (WMT/931142103)`
// under a combined `Company (Ticker/CUSIP) / Ballot Issues` column (MET
// Investors Series Trust 2010, the Rainier Large Cap Equity Portfolio section,
// 1,112 rows with no id). Both halves must be shaped, so an ordinary
// parenthetical in a name is left alone.
func htmlIssuerTickerCUSIPParens(issuer string) (name, ticker, cusip string, ok bool) {
	s := strings.TrimSpace(issuer)
	if !strings.HasSuffix(s, ")") {
		return "", "", "", false
	}
	open := strings.LastIndexByte(s, '(')
	if open <= 0 {
		return "", "", "", false
	}
	inner := s[open+1 : len(s)-1]
	slash := strings.IndexByte(inner, '/')
	if slash < 0 {
		return "", "", "", false
	}
	tic := strings.TrimSpace(inner[:slash])
	cus := strings.TrimSpace(inner[slash+1:])
	if !htmlTickerShaped(htmlUpperASCII(tic)) || !htmlIsCUSIP(cus) {
		return "", "", "", false
	}
	name = strings.TrimSpace(s[:open])
	if name == "" {
		return "", "", "", false
	}
	return name, tic, cus, true
}

// htmlLeadingIssuerCut finds where the labels begin on a line that opens with
// the issuer, when at least two labels follow and the prefix is issuer-shaped.
func htmlLeadingIssuerCut(line, up string) (int, bool) {
	first, n := -1, 0
	for _, label := range htmlContextLabels {
		if i := strings.Index(up, " "+label); i >= 0 {
			n++
			if first < 0 || i+1 < first {
				first = i + 1
			}
		}
	}
	if n < 2 || first <= 0 {
		return 0, false
	}
	prefix := strings.TrimSpace(line[:first])
	if prefix == "" || !htmlIsIssuerLine(prefix) {
		return 0, false
	}
	return first, true
}

// htmlHasLabelPrefix reports whether an already-folded line opens with one of
// the context labels.
func htmlHasLabelPrefix(up string) bool {
	for _, label := range htmlContextLabels {
		if strings.HasPrefix(up, label) {
			return true
		}
	}
	return false
}

// htmlLabelValue returns the value printed after label on one line, cut at the
// next label on that same line. up is line folded by htmlUpperASCII, which is
// LENGTH-PRESERVING, so every offset found in it indexes line itself.
func htmlLabelValue(line, up, label string) (string, bool) {
	i := strings.Index(up, label)
	if i < 0 {
		return "", false
	}
	rest := line[i+len(label):]
	restUp := up[i+len(label):]
	cut := len(rest)
	for _, other := range append(append([]string(nil), htmlContextLabels...), htmlContextCutLabels...) {
		if j := strings.Index(restUp, other); j >= 0 && j < cut {
			cut = j
		}
	}
	return strings.TrimSpace(rest[:cut]), true
}

// htmlUpperASCII folds a-z to A-Z and leaves every other byte alone, so the
// result has exactly the length of its input and an index into it is a valid
// index into the original. strings.ToUpper is NOT length-preserving -- U+0250,
// U+025C, U+0261, U+026B and the U+027x block all change byte length when
// uppercased -- so searching an uppercased copy and slicing the original with
// the copy's offset can run past the end and panic on filing bytes that are
// third-party and untrusted.
func htmlUpperASCII(s string) string {
	var b []byte
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < 'a' || c > 'z' {
			continue
		}
		if b == nil {
			b = []byte(s)
		}
		b[i] = c - ('a' - 'A')
	}
	if b == nil {
		return s
	}
	return string(b)
}

// htmlValueOrEmpty folds a printed placeholder to the empty string. This
// grammar writes "TICKER: --" for a security with no ticker, and carrying "--"
// into the ticker column would make a placeholder look like a symbol.
// htmlPadCUSIP restores the leading zeros a spreadsheet dropped from an
// all-digit CUSIP (`4498101` for ACI Worldwide's 004498101; CRM Mutual Fund
// Trust 2008). Only a seven- or eight-digit number is padded: six digits is
// an issuer number, and a nine-character id is complete.
func htmlPadCUSIP(id string) string {
	if n := len(id); (n == 7 || n == 8) && htmlIsNumeric(id) {
		return strings.Repeat("0", 9-n) + id
	}
	return id
}

func htmlValueOrEmpty(v string) string {
	v = htmlFlat(v)
	if v == "" {
		return ""
	}
	if strings.Trim(v, "-—–_.") == "" {
		return ""
	}
	switch strings.ToUpper(v) {
	case "N/A", "NA", "NONE":
		return ""
	}
	return v
}

// htmlDate normalizes this grammar's date spellings onto YYYYMMDD, the same
// column shape every other layout writes. brDate reads the numeric and
// day-month-year forms; issDate reads "FEB 28, 2017".
func htmlDate(s string) string {
	// `07/13/2020; Special`: the meeting type after a semicolon (Timothy Plan
	// 2021's Israel Common Values Fund section, 1,275 undated rows on r194).
	if k := strings.Index(s, ";"); k > 0 {
		if d := htmlDate(strings.TrimSpace(s[:k])); d != "" {
			return d
		}
	}
	// `6/12/2013 (Due Date)`: a parenthetical after the date (Investment
	// Managers Series Trust 2013).
	if k := strings.Index(s, " ("); k > 0 {
		if d := htmlDate(strings.TrimSpace(s[:k])); d != "" {
			return d
		}
	}
	// `Annual 04-May-2018`, `Special 12/01/2016`: the meeting type BEFORE the
	// date in one cell (Mutual Fund Series Trust 2018 and Northern Lights Fund
	// Trust IV 2017, 2,222 undated rows on r181). One leading type word goes
	// when what follows is a date.
	f := strings.Fields(strings.TrimSpace(s))
	// A printed year may qualify the meeting type, but is never the date.
	if len(f) >= 3 && len(f[0]) == 4 && htmlIsNumeric(f[0]) && f[0] >= "1900" && f[0] <= "2099" && htmlMeetingTypeWord(f[1]) {
		f = f[1:]
	}
	if len(f) >= 2 && htmlMeetingTypeWord(f[0]) {
		rest := f[1:]
		// `Special Meeting 4/3/2014` (Advisors Preferred Trust 2014).
		if len(rest) >= 2 && strings.EqualFold(rest[0], "meeting") {
			rest = rest[1:]
		}
		if len(rest) >= 2 && rest[0] == "-" {
			rest = rest[1:]
		}
		if d := htmlDate(strings.Join(rest, " ")); d != "" {
			return d
		}
	}
	s = htmlFlat(s)
	if s == "" {
		return ""
	}
	if k := strings.IndexAny(s, ", "); k > 0 {
		switch strings.ToUpper(s[:k]) {
		case "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY":
			s = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(s[k:]), ","))
		}
	}
	// `15-Oct-14 11:30`: a two-digit year and a meeting time (JPMorgan China
	// Region Fund, 4,743 rows with no date on 2026-09-02). The time is
	// dropped and the year expanded before the ordinary parse.
	if f := strings.Fields(s); len(f) >= 1 {
		if p := strings.Split(f[0], "-"); len(p) == 3 && len(p[2]) == 2 && len(p[1]) == 3 && isASCIILetter(p[1][0]) {
			s = p[0] + "-" + p[1] + "-20" + p[2]
		} else if len(f) >= 2 && strings.Contains(f[1], ":") {
			s = f[0]
		}
	}
	// `05/24/06 - A`: the meeting type after a dash (the SSgA vote summary
	// grid, Kiewit Investment Fund 2006), or spelt out, `05/11/2023 - Annual`
	// (Advisors Preferred Trust 2023, 450 undated rows on r155). Only a tail
	// of letters and spaces is cut, and the head must still parse on its own.
	if i := strings.Index(s, " - "); i > 0 {
		tail := strings.TrimSpace(s[i+3:])
		if n := len(tail); n >= 1 && n <= 24 && strings.IndexFunc(tail, func(r rune) bool { return r != ' ' && !isASCIILetter(byte(r)) }) < 0 {
			if d := brDate(strings.TrimSpace(s[:i])); d != "" {
				return d
			}
		}
	}
	if d := brDate(s); d != "" {
		return d
	}
	if d := issDate(s); d != "" {
		return d
	}
	// `2005 0715`: the year, a space, then the month and day (Heritage Series
	// Trust 2006, 3,481 rows with no date on r133). Both halves must be
	// digits of the right width and the month and day in range.
	if f := strings.Fields(s); len(f) == 2 && len(f[0]) == 4 && len(f[1]) == 4 && htmlIsNumeric(f[0]) && htmlIsNumeric(f[1]) && (f[0][:2] == "19" || f[0][:2] == "20") {
		if mm, dd := f[1][:2], f[1][2:]; mm >= "01" && mm <= "12" && dd >= "01" && dd <= "31" {
			return f[0] + f[1]
		}
	}
	// The SEC lettered table prefixes the date with the meeting type, e.g.
	// "Annual; 07/10/2012". Only a suffix that independently parses as a date
	// is accepted; the prefix is never guessed through.
	if i := strings.LastIndexByte(s, ';'); i >= 0 {
		if d := brDate(strings.TrimSpace(s[i+1:])); d != "" {
			return d
		}
	}
	// `ANNUAL: 07/01/2022`: the same, with a colon (Northern Lights Fund Trust
	// III 2023; the agent's 107 filings held 42,450 undated rows on r132). The
	// head must be one word of letters, so a time (`11:30`) never matches.
	if i := strings.IndexByte(s, ':'); i > 0 {
		head := strings.TrimSpace(s[:i])
		if len(strings.Fields(head)) == 1 && strings.IndexFunc(head, func(r rune) bool { return !isASCIILetter(byte(r)) }) < 0 {
			if d := brDate(strings.TrimSpace(s[i+1:])); d != "" {
				return d
			}
		}
	}
	return ""
}

// htmlDataRow renders one table row through the header's column mapping. Cells
// are taken POSITIONALLY by the header's index, which is the whole point of
// reading the raw markup. A row carrying no vote is table furniture -- a spacer
// or a subtotal -- and emitting it as a vote record would put a non-vote into
// the how_voted column.
// htmlShapeIdentityRow reads a meeting's identity row by the shape of its
// values alone: the leftmost date-shaped cell is the meeting date, exactly one
// nine-character CUSIP-shaped cell is the security id, exactly one cell reads as
// an issuer name, and no cell is a vote. Anything else (two names, no id, a vote
// value) is refused, so an item row can never be mistaken for an identity.
func htmlShapeIdentityRow(cells []string) (ctx htmlContext, ok bool) {
	names, cusips := 0, 0
	for _, c := range cells {
		v := htmlFlat(c)
		if v == "" {
			continue
		}
		if htmlIsVoteValue(v) {
			return htmlContext{}, false
		}
		if d := htmlDate(v); d != "" {
			if ctx.MeetingDate == "" {
				ctx.MeetingDate = d
			}
			continue
		}
		if open := strings.IndexByte(v, '['); open > 0 && strings.HasSuffix(v, "]") && pvTextCUSIP(v[:open]) && htmlTickerShaped(v[open+1:len(v)-1]) {
			cusips++
			ctx.CUSIP = v[:open]
			ctx.Ticker = v[open+1 : len(v)-1]
			continue
		}
		if pvTextCUSIP(v) {
			cusips++
			ctx.CUSIP = v
			continue
		}
		// `4,000` (a share count with a thousands separator) is a number.
		if htmlIsNumeric(v) || htmlIsNumeric(strings.ReplaceAll(v, ",", "")) {
			continue
		}
		// `AGM` and `Vote For All Proposals` beside the name (Nomura Partners
		// 2010), `Annual Meeting` (Mutual Fund Series Trust 2012): the meeting
		// type and a voting instruction are not names.
		if pvTextMeetingType(v) || htmlIsMeetingTypePhrase(v) || strings.HasPrefix(htmlUpperASCII(v), "VOTE ") {
			continue
		}
		// `RDS.B` beside the name: a ticker-shaped cell is the ticker.
		if htmlTickerShaped(v) {
			if ctx.Ticker == "" {
				ctx.Ticker = v
			}
			continue
		}
		if htmlIsIssuerLine(v) {
			names++
			ctx.Issuer = v
		}
	}
	if ctx.MeetingDate == "" || cusips != 1 || names != 1 {
		return htmlContext{}, false
	}
	return ctx, true
}

// htmlHasWrappedLabelCell reports a row with a bare context label broken over
// two lines inside one cell (`Ticker\n Symbol`, `Meeting\n Date`), the shape
// the split-header reader mistakes for a header stacked over rows.
func htmlHasWrappedLabelCell(cells []string) bool {
	for _, c := range cells {
		if !strings.Contains(strings.TrimSpace(c), "\n") {
			continue
		}
		key := strings.TrimSpace(strings.TrimSuffix(htmlUpperASCII(htmlFlat(c)), ":"))
		if _, ok := htmlBareLabels[key]; ok {
			return true
		}
	}
	return false
}

// htmlStripOnlyLabels are identity-strip labels that carry no field of their
// own and are absent from the stacked vocabulary, where a bare `Shares` would
// make too many vote-table headers read as identity.
var htmlStripOnlyLabels = map[string]bool{"SHARES": true, "CUSIP/SEDOL": true}

// htmlWrappedLabelStripRow reads one row of the two-row identity strip Guinness
// Atkinson Funds 2007 prints above each non-US meeting: alternating label and
// value cells (`Shares Voted | 1,812,000 | Cusip/Sedol | B02ZK79 | Ticker |
// TLKM IJ`, `Meeting Date | 6/30/2006 | Shares | 1,812,000 | Meeting Type |
// AGM`), each label broken over a line break inside its own cell, and the first
// row led by a bare issuer name under no label at all. Seven filled cells with
// one bare label is too wide for the bare rule, so 1,653 of 2,882 rows emitted
// a blank issuer, id and date on r206.
//
// The shape is refused unless it is strictly a leading issuer name (optional)
// followed by at least two label/value pairs, with at least one label wrapped
// inside its cell and at least one label the context reader can act on. A vote
// row, whose values sit under no label, can therefore never match.
func htmlWrappedLabelStripRow(cells []string) (issuer string, ok bool) {
	pairs, wrapped, known := 0, false, false
	wantLabel := true
	for i, c := range cells {
		flat := htmlFlat(c)
		if flat == "" {
			continue
		}
		key := htmlCanonLabel(c)
		_, stacked := htmlStackedLabelSet[key]
		_, bare := htmlBareLabels[key]
		if stacked || bare || htmlStripOnlyLabels[key] {
			if !wantLabel {
				return "", false
			}
			if strings.Contains(strings.TrimSpace(c), "\n") {
				wrapped = true
			}
			if bare {
				known = true
			}
			wantLabel = false
			continue
		}
		if wantLabel {
			// Only the row's leading cell may be an unlabelled value, and only
			// as the issuer's name.
			if pairs > 0 || issuer != "" || i != htmlFirstFilled(cells) || !htmlIsIssuerLine(flat) {
				return "", false
			}
			issuer = flat
			continue
		}
		wantLabel = true
		pairs++
	}
	if !wantLabel || pairs < 2 || !wrapped || !known {
		return "", false
	}
	return issuer, true
}

// htmlFirstFilled returns the index of the row's first non-empty cell, or -1.
func htmlFirstFilled(cells []string) int {
	for i, c := range cells {
		if htmlFlat(c) != "" {
			return i
		}
	}
	return -1
}

// htmlRealignBySpacers moves a data row's values back under the header's
// labels when a colspan puts the header's spacer blank at one column and the
// row's at the next (Tributary Funds 2021: `CUSIP # | | Shareholder Meeting
// Date | ...` over `21036P108 | 21-Jul-2020 | | DIRECTOR | ...`). It fires only
// when the row and the header are the same width with the same number of filled
// cells, every value the row holds under a header blank is matched by a header
// label the row leaves blank, and the header's blanks are unmapped columns;
// any other shape is returned untouched. A row that already reads as a
// meeting's identity by shape (one date, one CUSIP, one issuer name, no vote)
// is never a shifted vote row: under a split header the identity row and the
// vote header leave the same cells blank (Allied Asset Advisors 2004), and
// shifting it emitted the issuer name as the vote.
func htmlRealignBySpacers(cells, header []string, mapping map[string]int) []string {
	if len(header) == 0 || len(cells) != len(header) {
		return cells
	}
	if _, identity := htmlShapeIdentityRow(cells); identity {
		return cells
	}
	mapped := map[int]bool{}
	for _, i := range mapping {
		mapped[i] = true
	}
	var hf, cf []int
	underBlank, labelBlank := 0, 0
	for i := range header {
		h, c := htmlFlat(header[i]) != "", htmlFlat(cells[i]) != ""
		if h {
			hf = append(hf, i)
		} else if mapped[i] {
			return cells
		}
		if c {
			cf = append(cf, i)
		}
		if !h && c {
			underBlank++
		}
		if h && !c {
			labelBlank++
		}
	}
	if len(hf) != len(cf) || len(hf) < 3 || underBlank == 0 || underBlank != labelBlank {
		return cells
	}
	out := make([]string, len(cells))
	for k := range hf {
		out[hf[k]] = cells[cf[k]]
	}
	return out
}

// htmlStackedItemNum finds the numbered proposals a vendor STACKS inside one
// description cell (`1. Directors 2. Auditors 3. Cumulative Voting`).
var htmlStackedItemNum = regexp.MustCompile(`(?:^|\s)(\d{1,2})\.\s+`)

// htmlUnstackFirstItem unstacks the row a vendor prints as ONE <TR> per issuer
// with every item's number, text and vote stacked as separate paragraphs inside
// single cells (Choice Funds 2004: twelve proposals, twelve votes, one row).
// Flattened, the vote cell reads `For For For Against` -- a join, never a value
// any consumer can read.
//
// The split is decidable from the row alone: the vote cell is a run of two or
// more values that are each a vote on their own, and the description cell numbers
// exactly that many proposals. Each emitted row then carries the VERBATIM text of
// one vote and the text of its own item; a row whose counts disagree is left
// exactly as printed rather than guessed apart.
func htmlUnstackFirstItem(r VoteRow) *VoteRow {
	votes := strings.Fields(r.HowVoted)
	if len(votes) < 2 {
		return nil
	}
	for _, v := range votes {
		if !htmlIsVoteValue(v) {
			return nil
		}
	}
	m := htmlStackedItemNum.FindAllStringSubmatchIndex(r.VoteDescription, -1)
	if len(m) != len(votes) {
		return nil
	}
	// Only the FIRST stacked proposal is read. The extra paragraphs stay unread
	// rather than becoming extra rows: this vendor's row is one <TR> per issuer,
	// and the row count is the filing's own.
	r.ItemSeq = r.VoteDescription[m[0][2]:m[0][3]]
	r.VoteDescription = strings.TrimSpace(r.VoteDescription[m[0][1]:m[1][0]])
	r.HowVoted = votes[0]
	return &r
}

// htmlBallotStatusWord reports a Logical Ballot Status value.
func htmlBallotStatusWord(v string) bool {
	switch strings.ToUpper(strings.TrimSpace(v)) {
	case "VOTED", "UNVOTED", "NOT VOTED":
		return true
	}
	return false
}

// htmlRealignTailPad repairs the row that OMITS one value mid-row and pads its
// tail with an empty cell, keeping the row the header's width so every value
// after the omission sits one column to the LEFT of its label (Federated Hermes
// Income Securities Trust 2023: 48 of 3573 rows drop `Proponent` or `Record
// Date`, and the `Fund Name` column then reads `Voted`, the Logical Ballot
// Status, so the votes keep a blank series_id).
//
// The trigger is decidable from the row alone: the last cell is empty and the
// fund column holds a ballot status. The repair shifts the tail right by one
// from the LATEST column at which every mapped column of the shifted row reads
// as its own header again -- the status column holds the status, the fund column
// holds something that is not one, the vote column holds a vote, and the date,
// ticker and security id keep their shapes. The latest such column is the one
// that disturbs the fewest values the filing printed correctly; when no column
// qualifies the row is left exactly as printed.
func htmlRealignTailPad(cells, header []string, mapping map[string]int) []string {
	if len(header) == 0 || len(cells) != len(header) || len(cells) < 3 {
		return cells
	}
	fund, ok := mapping[htmlFieldFund]
	if !ok || fund >= len(cells) {
		return cells
	}
	if htmlFlat(cells[len(cells)-1]) != "" || !htmlBallotStatusWord(htmlFlat(cells[fund])) {
		return cells
	}
	fits := func(out []string, field string, ok func(string) bool) bool {
		i, has := mapping[field]
		if !has || i >= len(out) {
			return true
		}
		return ok(htmlFlat(out[i]))
	}
	for j := len(cells) - 2; j >= 0; j-- {
		out := make([]string, len(cells))
		copy(out, cells[:j])
		copy(out[j+1:], cells[j:len(cells)-1])
		v := htmlFlat(out[fund])
		if v == "" || htmlBallotStatusWord(v) || !htmlBallotStatusWord(htmlFlat(out[len(out)-1])) {
			continue
		}
		if !fits(out, htmlFieldVote, htmlIsVoteValue) ||
			!fits(out, htmlFieldMtgDate, func(s string) bool { return htmlDate(s) != "" }) ||
			!fits(out, htmlFieldCUSIP, func(s string) bool { return pvTextCUSIP(s) || isinToken(s) }) ||
			!fits(out, htmlFieldTicker, htmlTickerShaped) ||
			!fits(out, htmlFieldIssuer, func(s string) bool { return s != "" }) {
			continue
		}
		return out
	}
	return cells
}

// htmlSplitHalf joins the two tables a filer prints when one page's report is
// too wide for the page: a LEFT half headed by identity columns alone
// (`... | Company Name | Ticker | Primary Security ID | ISIN | CUSIP`) and a
// RIGHT half headed by the vote columns, carrying the SAME rows in the SAME
// order (MET Investors Series Trust 2013, 13,313 rows with no id). Only the
// right half maps, so today every one of those votes is filed under no issuer
// and no id.
//
// The join is by row ORDINAL and is licensed by one fact only: the vote half
// emitted exactly as many rows as the identity half printed. A short count is
// evidence that the two halves are not the same rows -- a dropped row would
// shift every id below it onto the wrong meeting -- so an inexact match fills
// nothing. Reading is additive: every row is still offered to every reader
// below this one, and a field the vote half printed itself is never overwritten.
//
// Cost is one pass: the identity rows of one table are held, and each is
// visited once when the next table closes.
type htmlSplitHalf struct {
	// rows of the identity half now being read, and the mapping it was read
	// under; nil mapping means no identity half is open.
	mapping map[string]int
	arity   int
	rows    []htmlContext
	// armed is the identity half of the table now open, and at is the index in
	// out where that table's first row landed.
	armed []htmlContext
	at    int
}

// read offers a row to the open identity half: a header that names identity
// columns and no vote column opens one, and a row beneath it that fills those
// columns is held.
func (h *htmlSplitHalf) read(cells []string) {
	if m, ok := htmlIdentityOnlyHeader(cells); ok {
		h.mapping, h.arity, h.rows = m, len(cells), nil
		return
	}
	if h.mapping == nil || htmlFilledCells(cells) == 0 {
		return
	}
	if !htmlComparableArity(len(cells), h.arity) {
		// Content the identity half did not print: the halves can no longer be
		// paired by ordinal.
		h.mapping, h.rows = nil, nil
		return
	}
	ctx, ok := htmlIdentityRow(cells, h.mapping)
	if !ok {
		h.mapping, h.rows = nil, nil
		return
	}
	if i, m := h.mapping[htmlFieldISIN]; m && ctx.ISIN == "" && i >= 0 && i < len(cells) {
		if v := htmlFlat(cells[i]); isinToken(v) {
			ctx.ISIN = v
		}
	}
	h.rows = append(h.rows, ctx)
}

// closeTable settles the join for the table that just ended and arms the next
// one with the identity half read since.
func (h *htmlSplitHalf) closeTable(out []VoteRow) {
	if len(h.armed) > 0 && len(out)-h.at == len(h.armed) {
		for k, id := range h.armed {
			r := &out[h.at+k]
			if r.IssuerName == "" {
				r.IssuerName = id.Issuer
			}
			if r.CUSIP == "" {
				r.CUSIP = id.CUSIP
			}
			if r.ISIN == "" {
				r.ISIN = id.ISIN
			}
			if r.Ticker == "" {
				r.Ticker = id.Ticker
			}
			// Identity columns only. The three-way split whose middle half
			// carries `Meeting Date` (MET Investors 2010) is a separate shape,
			// and filling a date by ordinal here would date a vote from a half
			// this join never proved belongs to it.
		}
	}
	h.armed, h.at = h.rows, len(out)
	h.mapping, h.rows = nil, nil
}

// htmlIdentityOnlyHeader recognises the header of a split page's identity half:
// a label row that names the issuer and at least one id column and NO vote
// column at all. A header naming any vote-side column belongs to a table this
// layout maps itself, and never reaches here.
func htmlIdentityOnlyHeader(cells []string) (map[string]int, bool) {
	labels := 0
	for _, c := range cells {
		flat := htmlFlat(c)
		if flat == "" {
			continue
		}
		if htmlIsNumeric(flat) {
			return nil, false
		}
		if htmlLooksLikeValueLimit(flat, htmlLabelMaxLen) && !htmlIsHeaderWord(flat) {
			return nil, false
		}
		labels++
	}
	if labels < htmlHeaderMinCells || labels > htmlHeaderMaxCells {
		return nil, false
	}
	mapping := htmlMapFields(cells)
	for _, f := range []string{
		htmlFieldItem, htmlFieldDesc, htmlFieldBy, htmlFieldMgmtRec,
		htmlFieldVote, htmlFieldVsMgmt, htmlFieldVotedFlag,
	} {
		if _, has := mapping[f]; has {
			return nil, false
		}
	}
	if _, has := mapping[htmlFieldIssuer]; !has {
		return nil, false
	}
	for _, f := range []string{htmlFieldCUSIP, htmlFieldISIN, htmlFieldTicker} {
		if _, has := mapping[f]; has {
			return mapping, true
		}
	}
	return nil, false
}

// htmlIdentityRow reads a row that fills the identity columns of a shared
// header and none of the vote columns.
// htmlAdoptLeadingBareDate reads the meeting date out of the unlabelled cell
// that precedes a `Name (TICKER/CUSIP)` identity cell -- `2/24/2010 | Deere &
// Co. (DE/244199105) | 12/31/2009 | 412` under a header whose spanned `Meeting
// Date` leaves the row's mapped cell empty (Nuveen Investment Trust 2010, 710
// undated rows). The shape is the whole warrant, so all three hold: the issuer
// cell carries the ticker/CUSIP parens, no mapped meeting date is filled, and
// the nearest non-empty cell to the LEFT of the issuer parses as a date. The
// record date sits to the RIGHT and is never reached.
func htmlAdoptLeadingBareDate(cells []string, mapping map[string]int) string {
	issuerIdx, mapped := mapping[htmlFieldIssuer]
	if !mapped || issuerIdx <= 0 || issuerIdx >= len(cells) {
		return ""
	}
	if _, _, _, shaped := htmlIssuerTickerCUSIPParens(htmlFlat(cells[issuerIdx])); !shaped {
		return ""
	}
	if di, m := mapping[htmlFieldMtgDate]; m && di >= 0 && di < len(cells) && htmlFlat(cells[di]) != "" {
		return ""
	}
	for i := issuerIdx - 1; i >= 0; i-- {
		v := htmlFlat(cells[i])
		if v == "" {
			continue
		}
		return htmlDate(v)
	}
	return ""
}

func htmlIdentityRow(cells []string, mapping map[string]int) (ctx htmlContext, ok bool) {
	at := func(f string) string {
		i, m := mapping[f]
		if !m || i < 0 || i >= len(cells) {
			return ""
		}
		return htmlFlat(cells[i])
	}
	// The description column may double as the meeting-type column under a
	// two-row header (`MTG TYPE` over `Proposal Type`), so only the vote
	// columns must be empty.
	if at(htmlFieldVote) != "" || at(htmlFieldMgmtRec) != "" {
		return ctx, false
	}
	// A repeated header row (`Company Name | Ticker | ...`) has empty vote
	// columns too; its cells are labels, not an identity.
	for _, f := range []string{htmlFieldIssuer, htmlFieldCUSIP, htmlFieldTicker, htmlFieldMtgDate} {
		if v := at(f); v != "" && (htmlIsGateLabel(v) || htmlIsHeaderWord(v)) {
			return htmlContext{}, false
		}
	}
	ctx.Issuer = at(htmlFieldIssuer)
	ctx.CUSIP, ctx.ISIN = htmlSecurityID(at(htmlFieldCUSIP))
	ctx.Ticker = htmlValueOrEmpty(at(htmlFieldTicker))
	if v := at(htmlFieldSecuritySymbol); ctx.CUSIP != "" && strings.HasSuffix(v, "]") {
		if open := strings.LastIndexByte(v, '['); open > 0 {
			ticker := strings.TrimSpace(v[open+1 : len(v)-1])
			if htmlTickerShaped(ticker) {
				ctx.Ticker = ticker
			}
		}
	}
	ctx.MeetingDate = htmlDate(at(htmlFieldMtgDate))
	if ctx.MeetingDate == "" {
		ctx.MeetingDate = htmlExcelSerialDate(at(htmlFieldMtgDate))
	}
	if d := at(htmlFieldMtgDate); ctx.MeetingDate == "" && d != "" {
		// `05/02/07 - A`: the date with the meeting-type letter after a dash.
		if f := strings.Fields(d); len(f) > 0 {
			ctx.MeetingDate = htmlDate(f[0])
		}
	}
	if ctx.MeetingDate == "" {
		ctx.MeetingDate = htmlAdoptLeadingBareDate(cells, mapping)
	}
	if ctx.MeetingDate == "" && (ctx.Issuer != "" || ctx.CUSIP != "") {
		// A split header can put the date column under a vote-side label
		// (Putnam 2005: `MTG DATE` and `Proposal Type` share an index after
		// colspan padding), so the date has no mapping. An identity row that
		// prints exactly one date-shaped cell prints its meeting date there;
		// two candidates settle nothing (803k htmltable rows on run66).
		found := ""
		for _, c := range cells {
			v := htmlFlat(c)
			if v == "" || len(v) > 12 {
				continue
			}
			if d := htmlDate(v); d != "" {
				if found != "" {
					found = ""
					break
				}
				found = d
			}
		}
		ctx.MeetingDate = found
	}
	if _, hasIssuer := mapping[htmlFieldIssuer]; !hasIssuer && ctx.Issuer == "" && (ctx.CUSIP != "" || ctx.ISIN != "" || ctx.MeetingDate != "") {
		// The Vote Summary Report prints the issuer in the proposal column of
		// the identity row, the ticker in asterisks: `Advanced Energy
		// Industries, Inc. *AEIS*` (SSGA Funds 2007, Thrivent 2008: 23k rows).
		if name := at(htmlFieldDesc); name != "" && htmlIsIssuerLine(name) {
			ctx.Issuer = name
			if i := strings.LastIndex(name, " *"); i > 0 && strings.HasSuffix(name, "*") {
				ctx.Issuer = strings.TrimSpace(name[:i])
				if ctx.Ticker == "" {
					ctx.Ticker = strings.Trim(name[i+2:], "*")
				}
			}
		}
	}
	if ctx.Issuer == "" && ctx.CUSIP == "" && ctx.ISIN == "" && ctx.MeetingDate == "" {
		return htmlContext{}, false
	}
	if ctx.Issuer != "" && !htmlIsIssuerLine(ctx.Issuer) {
		return htmlContext{}, false
	}
	return ctx, true
}

// htmlAllLabels reports a row whose every filled cell is a column label.
// htmlBareLabelCount counts cells that are a bare label or a bare label with
// its value.
func htmlBareLabelCount(cells []string) int {
	n := 0
	for _, c := range cells {
		up := htmlUpperASCII(htmlFlat(c))
		if _, ok := htmlBareLabels[up]; ok {
			n++
			continue
		}
		for prefix := range htmlBareValued {
			if strings.HasPrefix(up, prefix) {
				n++
				break
			}
		}
	}
	return n
}

func htmlAllLabels(cells []string) bool {
	filled := 0
	for _, c := range cells {
		if htmlFlat(c) == "" {
			continue
		}
		filled++
		if !htmlIsHeaderWord(c) {
			return false
		}
	}
	return filled > 0
}

// htmlSecurityID splits a security-id cell into its CUSIP and ISIN by shape;
// anything else (a name under a "Security" header) is dropped.
func htmlSecurityID(v string) (cusip, isin string) {
	v = htmlValueOrEmpty(v)
	if v == "" {
		return "", ""
	}
	if open := strings.LastIndexByte(v, '['); open > 0 && strings.HasSuffix(v, "]") &&
		htmlTickerShaped(strings.TrimSpace(v[open+1:len(v)-1])) {
		v = strings.TrimSpace(v[:open])
	}
	for _, f := range strings.Fields(v) {
		// Seven-character security ids may be SEDOLs, not truncated CUSIPs.
		if len(f) == 8 && htmlIsNumeric(f) {
			f = htmlPadCUSIP(f)
		}
		if isinToken(f) && isin == "" {
			isin = f
		} else if pvTextCUSIP(f) && htmlHasDigit(f) && cusip == "" {
			// A CUSIP always carries digits; a nine-letter word in a
			// proposal cell ("selection", "Incentive") never does.
			cusip = f
		}
	}
	return cusip, isin
}

// htmlAllDigits reports a value that is nothing but digits, long enough to be
// an internal account number rather than an item or a share count.
// htmlAccountCodeFundCell reports whether an unresolvable fund cell is the
// registrant's internal ACCOUNT CODE rather than a second fund: upper-case
// letters and digits with no space and no word in it, unknown to the filing's
// own number/name pairing (AdvisorShares Trust 2023 prints `RK2404400N` in the
// `Account Name` column partway through the Gerber Kawasaki block, on 765 lines
// and beside a fund name on none of them; 78 rows with no series). A code is
// not a fund, so it must not withdraw the series of a resolved enclosing
// section heading -- which is why the caller only allows it there.
func htmlAccountCodeFundCell(v string, accountNames map[string]string, inResolvedSection bool) bool {
	if !inResolvedSection || accountNames[v] != "" {
		return false
	}
	if len(v) < 4 || len(v) > 16 || strings.ContainsAny(v, " \t") {
		return false
	}
	digit, letter := false, false
	for i := 0; i < len(v); i++ {
		switch c := v[i]; {
		case c >= '0' && c <= '9':
			digit = true
		case c >= 'A' && c <= 'Z':
			letter = true
		case c == '-':
		default:
			return false
		}
	}
	return digit && letter
}

func htmlAllDigits(s string) bool {
	if len(s) < 6 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// htmlRowAccountNumber returns the internal account number a row prints beside
// its account name: the LAST all-digit cell, since the account number column
// stands to the right of the name and a security id stands to its left.
func htmlRowAccountNumber(cells []string) string {
	for i := len(cells) - 1; i >= 0; i-- {
		if v := htmlFlat(cells[i]); htmlAllDigits(v) {
			return v
		}
	}
	return ""
}

func htmlHasDigit(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] >= '0' && s[i] <= '9' {
			return true
		}
	}
	return false
}

// htmlFundCell returns the row's own fund-name cell under a mapped Fund
// column, honouring the one-cell item offset htmlDataRow applies.
func htmlFundCell(cells []string, mapping map[string]int, headerArity int) string {
	return htmlMappedCell(cells, mapping, headerArity, htmlFieldFund)
}

// htmlAdoptRowFundColumn claims an UNLABELLED leading column as the fund column
// when the row prints a fund name in it. One vintage heads that column with a
// label no vocabulary knows -- `Choice Product` over `Choice Balanced Fund`
// (Choice Funds 2004, 48 rows carrying no fund name at all) -- and names the
// fund there on the first row of each block, blank thereafter.
//
// The claim is made only off a cell that resolves EXACTLY to one of this
// registrant's declared or dictionary series names, so a leading column of
// anything else is never taken for the fund; once claimed the column is the
// filing's own fund column and the blank-cell carry below reads it.
func htmlAdoptRowFundColumn(cells []string, mapping map[string]int, headerArity int, ix *issSeriesIndex, dict *dictFallback) {
	if mapping == nil {
		return
	}
	if _, mapped := mapping[htmlFieldFund]; mapped {
		return
	}
	for _, i := range mapping {
		if i == 0 {
			return
		}
	}
	i := 0
	if len(cells) == headerArity+1 && htmlIsItemNumber(htmlFlat(cells[0])) {
		i++
	}
	if i >= len(cells) {
		return
	}
	v := htmlFlat(cells[i])
	if v == "" {
		return
	}
	if icrResolveFundShared(ix, v) == "" {
		if dict == nil {
			return
		}
		if d, _ := lookupSeriesEntry(dict.byName, v); d == nil {
			return
		}
	}
	mapping[htmlFieldFund] = 0
}

// htmlMappedCell returns the row's own cell under one mapped column, honouring
// the one-cell item offset htmlDataRow applies.
func htmlMappedCell(cells []string, mapping map[string]int, headerArity int, field string) string {
	i, ok := mapping[field]
	if !ok {
		return ""
	}
	if len(cells) == headerArity+1 && htmlIsItemNumber(htmlFlat(cells[0])) {
		i++
	}
	if i < 0 || i >= len(cells) {
		return ""
	}
	return htmlFlat(cells[i])
}

// htmlIsIdentityLabel reports a cell that is an identity-grid label.
func htmlIsIdentityLabel(s string) bool {
	key := htmlCanonLabel(s)
	_, bare := htmlBareLabels[key]
	_, stacked := htmlStackedLabelSet[key]
	return bare || stacked || key == "COMPANY NAME"
}

// htmlIsHeaderWord reports a cell whose text is one of the column labels this
// grammar maps, in any field's vocabulary.
func htmlIsHeaderWord(s string) bool {
	key := htmlCanonLabel(s)
	if key == "" {
		return false
	}
	for _, syns := range htmlSynonyms {
		for _, syn := range syns {
			if key == syn {
				return true
			}
		}
	}
	_, bare := htmlBareLabels[key]
	_, stacked := htmlStackedLabelSet[key]
	return bare || stacked || key == "COMPANY NAME" || key == "ISSUER NAME"
}

// htmlProponentWord reports a cell that names who proposed rather than what.
func htmlProponentWord(s string) bool {
	switch htmlUpperASCII(htmlFlat(s)) {
	case "MGMT", "MANAGEMENT", "SHRHLDR", "SHRHOLDER", "SHAREHOLDER", "ISSUER", "SH", "MGT":
		return true
	}
	return false
}

// htmlUnclaimedText returns the longest text in a cell no field claims, when
// it is longer than minLen; "" otherwise.
func htmlUnclaimedText(cells []string, mapping map[string]int, minLen int) string {
	claimed := make(map[int]bool, len(mapping))
	for f, i := range mapping {
		// The identity columns belong to the identity row of a shared-header
		// export; a proposal row prints its text across them.
		switch f {
		case htmlFieldIssuer, htmlFieldTicker, htmlFieldCUSIP, htmlFieldMtgDate:
			continue
		}
		claimed[i] = true
	}
	best := ""
	for i, c := range cells {
		if claimed[i] {
			continue
		}
		if t := htmlFlat(c); len(t) > len(best) {
			best = t
		}
	}
	if len(best) <= minLen {
		return ""
	}
	return best
}

func htmlDataRow(cells []string, mapping map[string]int, headerArity int, ctx htmlContext) (VoteRow, bool) {
	// Some lettered tables prepend an unlabelled item number to only the first
	// row. The shift is decided per row: applying one block-wide offset would fix
	// that row by corrupting every later row whose arity matches the header.
	offset := 0
	leadingItem := ""
	if len(cells) == headerArity+1 {
		if v := htmlFlat(cells[0]); htmlIsItemNumber(v) {
			offset, leadingItem = 1, v
		}
	}

	at := func(field string) string {
		if _, mixed := mapping[htmlFieldSecuritySymbol]; mixed &&
			(field == htmlFieldIssuer || field == htmlFieldCUSIP || field == htmlFieldTicker) {
			// These columns carry item numbers and descriptions on vote rows.
			return ""
		}
		i, ok := mapping[field]
		if !ok {
			return ""
		}
		i += offset
		if i >= len(cells) {
			return ""
		}
		return htmlFlat(cells[i])
	}

	vote := at(htmlFieldVote)
	votedFlag := ""
	blankVote := false
	if vote == "" {
		// An unvoted agenda item under a `Voted | Vote` header: the flag says
		// NO and the vote cell is empty. The row is real; the vote is blank.
		if f := at(htmlFieldVotedFlag); f != "" && htmlIsYesNo(f) {
			votedFlag = f
		} else if _, mapped := mapping[htmlFieldVote]; !mapped {
			// The header names no vote column at all (Eagle Series Trust 2016
			// prints none in 4.8 MB of item records). The vote is not a cell
			// this row left empty, it is a column the filing never printed, so
			// the row stands on its identity and its proposal with how_voted
			// empty rather than guessed.
		} else {
			// No flag column to appeal to (Cornerstone 2013 prints no `Ballot
			// Status`, and stops printing the vote part-way through a meeting
			// while keeping the row). The row's own completeness decides:
			// both an item number and a description, checked below.
			blankVote = true
		}
	}
	// A label in the vote column (`Period:`, `Company Name`) is a cover or
	// identity row that shares the table, never a vote (Special Opportunities
	// Fund 2023: 125 rows voted "Period:").
	// Identity labels only: 'No' is a vote in exports with a Voted? column and
	// also an item-number synonym (Brighthouse Funds Trust II, 8,224 rows).
	if strings.HasSuffix(vote, ":") || htmlIsIdentityLabel(vote) {
		return VoteRow{}, false
	}
	// A CUSIP in the vote column is a meeting's identity row printed on a
	// colspan grid the header does not share (the SSgA vote summary, Kiewit
	// 2007: 2,766 rows voted their CUSIP); it is never a vote.
	if pvTextCUSIP(vote) && htmlHasDigit(vote) {
		return VoteRow{}, false
	}
	item, desc := at(htmlFieldItem), at(htmlFieldDesc)
	// `Proposal Type` maps to the description for the shape that prints no
	// other proposal column; Prudential Series Fund 2005 prints MGMT under it
	// and the text in an unlabelled spanning cell (36,441 rows read as
	// "MGMT" on 2026-09-02). When the mapped description is a proponent word
	// and an unclaimed cell carries longer text, the text is the description
	// and the word is the source.
	src := at(htmlFieldBy)
	if htmlProponentWord(desc) {
		if t := htmlUnclaimedText(cells, mapping, len(desc)); t != "" {
			if src == "" {
				src = desc
			}
			desc = t
		}
	}
	if item == "" {
		item = leadingItem
	}
	if item == "" && desc == "" {
		return VoteRow{}, false
	}
	// A row whose vote cell is blank with no flag column to explain it is kept
	// only when it is unmistakably an agenda row: an item number AND a
	// description. The vote stays blank -- the filing prints it nowhere and the
	// neighbouring `Mgmt Rec` / `For / Against Mgmt` cells only imply it.
	if blankVote && (item == "" || desc == "" || !htmlIsItemNumber(item)) {
		return VoteRow{}, false
	}

	r := VoteRow{
		IssuerName:               ctx.Issuer,
		CUSIP:                    ctx.CUSIP,
		ISIN:                     ctx.ISIN,
		Ticker:                   ctx.Ticker,
		MeetingDate:              ctx.MeetingDate,
		ItemSeq:                  item,
		VoteDescription:          desc,
		VoteSource:               src,
		HowVoted:                 vote,
		VoteOtherInfo:            htmlVotedFlagInfo(votedFlag),
		ManagementRecommendation: at(htmlFieldMgmtRec),
	}

	// A table that prints its own identity columns overrides the block context
	// for that row: the row is the more specific statement.
	if v := at(htmlFieldIssuer); v != "" {
		if descCol, shared := mapping[htmlFieldDesc]; !shared || descCol != mapping[htmlFieldIssuer] {
			r.IssuerName = v
		}
	}
	if c, isin := htmlSecurityID(at(htmlFieldCUSIP)); c != "" || isin != "" {
		if c != "" {
			r.CUSIP = c
		}
		if isin != "" && r.ISIN == "" {
			r.ISIN = isin
		}
	}
	// A column the header names CUSIP prints the identifier the filing means to
	// publish. When it prints eight digits, WHICH leading zero a spreadsheet
	// dropped is not printed anywhere, so the link key stands as filed rather
	// than padded on a guess. A column labelled only `Security ID` carries no
	// such claim and keeps htmlSecurityID's reconstruction.
	if _, verbatim := mapping[htmlFieldCUSIPPrinted]; verbatim {
		if v := htmlFlat(at(htmlFieldCUSIP)); len(v) == 8 && htmlIsNumeric(v) {
			r.CUSIP = v
		}
	}
	if v := htmlValueOrEmpty(at(htmlFieldTicker)); v != "" {
		r.Ticker = v
	}
	if v := htmlValueOrEmpty(at(htmlFieldISIN)); isinToken(v) {
		r.ISIN = v
	}
	if v := htmlDate(at(htmlFieldMtgDate)); v != "" {
		r.MeetingDate = v
	} else if v := htmlExcelSerialDate(at(htmlFieldMtgDate)); v != "" {
		// `39930` under `Meeting Date`: a spreadsheet serial (Glenmede 2009).
		r.MeetingDate = v
	} else if _, mapped := mapping[htmlFieldMtgDate]; mapped && r.MeetingDate == "" {
		// A spanned header label lands in the LAST column it covers, so `(d)
		// Shareholder Meeting Date` over two columns maps to the meeting-type
		// column beside the date (Northern Lights Fund Trust 2021 and its filer
		// agent's 91 filings, 17,778 undated rows on r179). A vote row that
		// prints exactly one date-shaped cell prints its meeting date there;
		// two candidates (a record date beside it) settle nothing.
		found := ""
		for _, c := range cells {
			v := htmlFlat(c)
			if v == "" || len(v) > 12 {
				continue
			}
			if d := htmlDate(v); d != "" {
				if found != "" {
					found = ""
					break
				}
				found = d
			}
		}
		r.MeetingDate = found
	}

	// series_id is deliberately NOT set. The chassis stamps it when the header
	// declares exactly one series; guessing which fund a table belongs to would
	// move one fund's votes onto another, which is far worse than a blank.
	return r, true
}

// htmlLabelledCells reads a row made of a label cell and a value cell, with
// nothing else in it: `Fund Name :` | `Putnam Absolute Return 100 Fund`.
func htmlLabelledCells(cells []string) (label, value string, ok bool) {
	var vals []string
	for _, c := range cells {
		if v := strings.TrimSpace(c); v != "" {
			vals = append(vals, v)
		}
	}
	// Putnam prints label and value in ONE cell: `Fund Name : Putnam VT
	// Capital Appreciation Fund` (36,599 of 36,599 rows with no fund in the
	// 2010 filing on 2026-09-02).
	if len(vals) == 1 && htmlFundLabelled(vals[0]) {
		if colon := strings.IndexByte(vals[0], ':'); colon > 0 {
			return strings.TrimSpace(vals[0][:colon]), strings.TrimSpace(vals[0][colon+1:]), true
		}
	}
	// One vintage opens each fund section with the registrant, the label and
	// the fund in THREE cells: `Registrant:  Mutual Fund & Variable Insurance
	// Trust` | `Fund Name -` | `Rational Dynamic Brands Fund` (3,744 of 4,221
	// rows with no fund on 2026-09-08). The registrant cell is dropped and the
	// remaining pair read as label and value, exactly as a two-cell row.
	// An earlier vintage of that same banner glues the label to the fund in ONE
	// cell and still prints the form item beside it: `Registrant:  Mutual Fund
	// Series Trust` | `Fund Name - Eventide Health Care & Life Sciences Fund` |
	// `Item 1` (Mutual Fund Series Trust 2018, 502 of 1,433 rows with no
	// series). The registrant and the item cell are dropped and the glued cell
	// split on its own separator, as the Putnam single-cell path above does.
	if len(vals) == 3 && strings.HasPrefix(strings.ToLower(vals[0]), "registrant:") &&
		reHTMLBannerItemCell.MatchString(vals[2]) && htmlFundLabelled(vals[1]) {
		if l, v, ok := htmlSplitGluedLabelCell(vals[1]); ok {
			return l, v, true
		}
	}
	if len(vals) == 3 && strings.HasPrefix(strings.ToLower(vals[0]), "registrant:") &&
		!reHTMLBannerItemCell.MatchString(vals[2]) {
		vals = vals[1:]
	}
	// A later vintage of the same banner prints the form item in a FOURTH cell
	// after the fund: `Registrant:  Mutual Fund Series Trust` | `Fund Name -` |
	// `Eventide Gilead Fund` | `Item 1` (Mutual Fund Series Trust 2019, 1,359
	// of 3,340 rows with no series). The item cell is dropped like the
	// registrant cell.
	if len(vals) == 4 && strings.HasPrefix(strings.ToLower(vals[0]), "registrant:") && reHTMLBannerItemCell.MatchString(vals[3]) {
		vals = vals[1:3]
	}
	// Hodges prints the registrant's internal account code in a THIRD cell
	// after the fund: `Name of Fund:` | `Hodges Blue Chip 25 Fund` | `19-3657`
	// (Professionally Managed Portfolios 2010, 1,012 of 1,651 rows with no
	// fund). The code cell is dropped like the registrant cell above; only a
	// hyphenated all-digit code qualifies, so a numbered fund name is safe.
	// M Fund's code cell is alphanumeric instead -- `Name of Fund:` | `M
	// International Equity Fund  (NC, LLC)` | `1TM0` (M Fund Inc 2012, 961 of
	// 2,113 rows with no fund) -- and the same leading-account-code shape the
	// labelled path already cuts admits it; a code carries no space, so a fund
	// name never qualifies.
	if len(vals) == 3 && htmlFundLabelled(vals[0]) && (isBannerNumericAccountCode(vals[2]) || isLeadingAccountCode(vals[2])) {
		vals = vals[:2]
	}
	// The cover row prints TWO label/value pairs side by side: `Fund Name:` |
	// `Vivaldi Multi-Strategy Fund` | `# Voted Against Management:` | `0`
	// (Investment Managers Series Trust II 2021, 392 of 1,046 rows with no fund
	// at all). The second pair is a count of the section's own votes, not part
	// of the name, so the fund pair is read and the rest dropped; the third cell
	// must carry a label's colon, which an ordinary continuation cell does not.
	if len(vals) == 4 && htmlFundLabelled(vals[0]) && strings.HasSuffix(vals[2], ":") {
		vals = vals[:2]
	}
	if len(vals) != 2 {
		return "", "", false
	}
	return vals[0], vals[1], true
}

// isBannerNumericAccountCode reports whether a banner cell is nothing but a
// hyphenated run of digits, the shape of the internal account code some filers
// append to the fund cell.
func isBannerNumericAccountCode(s string) bool {
	if len(s) < 3 || len(s) > 12 || !strings.Contains(s, "-") {
		return false
	}
	for i := 0; i < len(s); i++ {
		if c := s[i]; (c < '0' || c > '9') && c != '-' {
			return false
		}
	}
	return true
}

var reHTMLRegistrantExhibit = regexp.MustCompile(`(?i)^Item [0-9]{1,2}, Exhibit [0-9]{1,3}$`)

// htmlFlattenCells renders each cell as ONE line, so a heading split over the
// paragraphs of a single cell reads as one name.
func htmlFlattenCells(cells []string) string {
	flat := make([]string, len(cells))
	for i, c := range cells {
		flat[i] = strings.Join(strings.Fields(c), " ")
	}
	return strings.Join(flat, "\n")
}

// reHTMLBannerItemCell matches the bare form-item cell some fund banners trail.
var reHTMLBannerItemCell = regexp.MustCompile(`(?i)^Item [0-9]{1,2}\.?$`)

// htmlSplitGluedLabelCell splits a banner cell that carries both the label and
// the fund: `Fund Name - Eventide Health Care & Life Sciences Fund`, or the
// colon form the Putnam path reads. The separator must be followed by text.
func htmlSplitGluedLabelCell(cell string) (label, value string, ok bool) {
	for _, sep := range []string{":", " - ", " -- ", " – "} {
		if i := strings.Index(cell, sep); i > 0 {
			l := strings.TrimSpace(cell[:i])
			v := strings.TrimSpace(cell[i+len(sep):])
			if l != "" && v != "" {
				return l, v, true
			}
		}
	}
	return "", "", false
}

// htmlBareFundLine reads a fund name printed as a bare paragraph between two
// tables, with no label at all. One vintage prints every fund that way
// (Workiva-built filings such as American Century ETF Trust, 713k rows;
// htmltable's series fill was 34.5% on 2026-09-02), and another prints it with
// the sub-adviser clause the ISS layout learned to cut (Advanced Series Trust,
// `AST AB Global Bond Portfolio- Sub-Adviser: AllianceBernstein`, 1.6M rows).
//
// A line that resolves to a declared series through the shared rules -- exact
// after one described edit, refused on collision -- is the header's own
// evidence of which fund follows; a line that does not is left alone, and
// nothing positional is guessed. The text between two tables can hold several
// such names when the funds between them reported no activity; the fund that
// follows is the NEAREST name above the table, so the last match wins.
// htmlFormNPXSleeveBanner reads the sub-adviser sleeve one vintage prints as its
// only section heading, between the tables: `Form N-PX Sector` over the section
// declared as `Penn Street Advisors Sector Rotational Portfolio` (S000001801),
// `Form N-PX Berkshire` over `Berkshire Advisors Select Equity Portfolio`
// (S000001802) -- Penn Street Fund, Inc. 2004, 877 rows carrying no fund name at
// all. The sleeve is what the filing prints, so it is stored as the fund name.
//
// The banner must be the whole line after the form title, at most two words of
// five letters or more, and every one of them must sit in exactly ONE of this
// registrant's declared names: a sleeve two series answer to stamps nothing,
// which is what leaves the filing's Baldwin, Cumberland and McGlinn sleeves --
// words no declared name carries -- blank rather than guessed.
func htmlFormNPXSleeveBanner(ix *issSeriesIndex, pre string) (name, id string, ok bool) {
	for _, line := range strings.Split(pre, "\n") {
		line = strings.TrimSpace(line)
		rest, cut := strings.CutPrefix(line, "Form N-PX ")
		if !cut {
			continue
		}
		words := strings.Fields(normalizeSeriesName(rest))
		if len(words) == 0 || len(words) > 2 {
			continue
		}
		var hit *SeriesDecl
		for _, w := range words {
			if len(w) < 5 {
				return "", "", false
			}
			var owner *SeriesDecl
			ids := map[string]bool{}
			for i := range ix.decls {
				d := &ix.decls[i]
				if d.SeriesID == "" || d.Name == "" || !issHasToken(normalizeSeriesName(d.Name), w) {
					continue
				}
				owner = d
				ids[d.SeriesID] = true
			}
			if len(ids) != 1 || hit != nil && hit.SeriesID != owner.SeriesID {
				return "", "", false
			}
			hit = owner
		}
		if hit != nil {
			return line, hit.SeriesID, true
		}
	}
	return "", "", false
}

// htmlSameFundBlock reports a row whose blank fund cell repeats the fund above
// it: the row carries no issuer of its own, or prints the same issuer as the row
// that named the fund.
// htmlLeadingFundColumn reports whether the fund column is the leftmost mapped
// column of the table: the vintages that name the fund per row print it first,
// ahead of the issuer, and a table that maps the fund somewhere in the middle is
// not one of them.
func htmlLeadingFundColumn(mapping map[string]int) bool {
	fund, ok := mapping[htmlFieldFund]
	if !ok {
		return false
	}
	for _, i := range mapping {
		if i < fund {
			return false
		}
	}
	return true
}

func htmlSameFundBlock(issuer, fundIssuer string) bool {
	return issuer == "" || issuer == fundIssuer && fundIssuer != ""
}

// htmlRegistrantIntervening reports content between a direct `Registrant:`
// heading and the table that is not the form metadata printed with it: the
// Investment Company Act file number, the reporting period, the FORM N-PX
// banner and the bare `01-Jul-2015 To 30-Jun-2016` range.
func htmlRegistrantIntervening(lines []string) bool {
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		low := strings.ToLower(line)
		if strings.HasPrefix(low, "investment company act file number") ||
			strings.HasPrefix(low, "reporting period") ||
			strings.HasPrefix(low, "form n-px") {
			continue
		}
		if period := strings.Split(low, " to "); len(period) == 2 &&
			htmlDate(strings.TrimSpace(period[0])) != "" && htmlDate(strings.TrimSpace(period[1])) != "" {
			continue
		}
		return true
	}
	return false
}

// htmlPrevNonblank returns the index of the nearest nonblank line above i, or
// -1 when none stands there.
func htmlPrevNonblank(lines []string, i int) int {
	for j := i - 1; j >= 0; j-- {
		if strings.TrimSpace(lines[j]) != "" {
			return j
		}
	}
	return -1
}

func htmlBareFundLine(ix *issSeriesIndex, pre string, fallback ...*dictFallback) (name, id string, ok bool) {
	if pre == "" {
		return "", "", false
	}
	var dict *dictFallback
	if len(fallback) > 0 {
		dict = fallback[0]
	}
	lines := strings.Split(pre, "\n")
	adoptedAt, adoptedLine := -1, ""
	for li, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// `===== Clarion Global Real Estate Portfolio =====`: the ISS banner
		// printed between HTML tables (MET Investors Series Trust).
		if strings.HasPrefix(line, "==") && strings.HasSuffix(line, "==") {
			line = strings.TrimSpace(strings.Trim(line, "="))
			if line == "" {
				continue
			}
		}
		// The export field `Institution Account(s): 90 Ivy Funds VIP Asset
		// Strategy` names the fund behind an account code, where the line
		// under the banner is the reporting period (Ivy Funds VIP, ~500k
		// rows named `Reporting Period: ...` on 2026-09-02). The value is
		// recorded as printed; the code is dropped only for the lookup.
		candidate := line
		// `Item 1 - Proxy Voting Record - Attached on behalf of Batterymarch
		// U.S. Small Capitalization Equity Portfolio.` (Legg Mason Charles
		// Street Trust 2005, 61 rows): the Item 1 prose states the fund in the
		// declared spelling where the section heading above the table prints an
		// abbreviated one. Adopted only on an exact declared match, so prose
		// that names no series stamps nothing.
		if i := strings.Index(line, "behalf of "); i >= 0 {
			stated := strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(line[i+len("behalf of "):]), "."))
			if stated != "" {
				if d, _ := lookupSeriesEntry(ix.byName, stated); d != nil {
					name, id, ok = stated, d.SeriesID, true
					adoptedAt, adoptedLine = li, stated
					continue
				}
			}
		}
		// `Item 1.    Proxy Voting Record. (Opportunistic EAFE Fund)` (Martin
		// Currie Business Trust 2004, all 26 rows of the filing): the fund is
		// named nowhere else, in a trailing parenthetical on the item line the
		// layout otherwise reads as report scaffolding. Adopted only when the
		// parenthetical NAMES a series -- an item line carrying a note, a date
		// range or an account marker resolves to nothing and stays scaffolding.
		if low := strings.ToLower(line); strings.HasPrefix(low, "item 1") && strings.HasSuffix(line, ")") {
			if o := strings.LastIndex(line, "("); o > 0 {
				inner := strings.TrimSpace(line[o+1 : len(line)-1])
				if _, d := issResolveFund(ix, inner); d != nil {
					name, id, ok = inner, d.SeriesID, true
					adoptedAt, adoptedLine = li, inner
					continue
				}
				if dictID := htmlDictionaryFund(ix, dict, inner); dictID != "" {
					name, id, ok = inner, dictID, true
					adoptedAt, adoptedLine = li, inner
					continue
				}
			}
		}
		// This complete one-cell export sentence is a fund boundary even when
		// its name is unresolved; do not carry the preceding fund across it.
		if rest, wrapped := strings.CutPrefix(line, "In All Markets, for all voted ballots, for "); wrapped && strings.TrimSpace(pre) == line {
			if fund, terminated := strings.CutSuffix(rest, "."); terminated && strings.TrimSpace(fund) != "" {
				if _, d := issResolveFund(ix, strings.TrimSpace(fund)); d != nil {
					return line, d.SeriesID, true
				}
				return line, "", true
			}
		}
		// `Fund: PSF: SP Aim Aggressive Growth Portfolio` (Prudential Series
		// Fund 2005, 36k rows): the bare `Fund:` label is accepted only here,
		// where a value must RESOLVE to count -- on the labelled-cell path it
		// cleared series on Putnam's `Fund: With Performance Fees Only`.
		labelled := htmlFundLabelled(line) || strings.HasPrefix(strings.ToLower(line), "fund:")
		// `Registrant: GLOBAL ATLANTIC PORTFOLIOS - Global Atlantic American
		// Funds Managed Risk Portfolio` (the Ultimus vintage): only the part
		// after the dash may name the fund. The registrant half never does,
		// or a trust sharing its flagship's name would stamp every section.
		if low := strings.ToLower(line); strings.HasPrefix(low, "registrant") && !htmlFundLabelled(line) {
			if colon := strings.IndexByte(line, ':'); colon > 0 {
				if i := strings.LastIndex(line, " - "); i > colon {
					candidate = htmlCutFormItemSuffix(strings.TrimSpace(line[i+3:]))
					line = candidate
				} else {
					// A direct Registrant value counts only when it is the nearest
					// nonblank line above the table; Ultimus prints form metadata after
					// the registrant name and must not turn that name into a fund.
					// ... looking past the form metadata this vendor prints under the
					// registrant inside the same cell (AmericaFirst Quantitative Funds
					// 2016: file number, reporting period, the FORM N-PX banner and the
					// bare date range), which is not another heading.
					if htmlRegistrantIntervening(lines[li+1:]) {
						continue
					}
					candidate = htmlCutFormItemSuffix(strings.TrimSpace(line[colon+1:]))
					if candidate == "" || normalizeSeriesName(candidate) == ix.registrantKey {
						continue
					}
					line = candidate
				}
			}
		}
		if labelled {
			if colon := strings.IndexByte(line, ':'); colon > 0 {
				accountNumber := strings.EqualFold(strings.TrimSpace(line[:colon]), "Account Number")
				candidate = strings.TrimSpace(line[colon+1:])
				line = candidate
				// Federated prints alphabetic account codes before exact fund names.
				// Keep the printed value and never reinterpret a declared full name.
				if f := strings.Fields(candidate); accountNumber && len(f) > 2 && f[1] == "Federated" && strings.Trim(f[0], "ABCDEFGHIJKLMNOPQRSTUVWXYZ") == "" {
					_, declared := lookupSeriesEntry(ix.byName, candidate)
					if dict != nil {
						_, seen := lookupSeriesEntry(dict.byName, candidate)
						declared = declared || seen
					}
					if !declared {
						remainder := strings.Join(f[1:], " ")
						if d, seen := lookupSeriesEntry(ix.byName, remainder); seen {
							if d != nil {
								name, id, ok = line, d.SeriesID, true
								continue
							}
						} else if dictID := htmlDictionaryFund(ix, dict, remainder); dictID != "" {
							name, id, ok = line, dictID, true
							continue
						}
						// Reading past the account code is licensed by an EXACT hit
						// on the remainder and by nothing else. `IFISCF Federated
						// International Small Co. Fund 2` (Federated Insurance
						// Series 2004, 141 rows) names a fund no dictionary row of
						// the registrant carries, and the tolerant resolver folds it
						// onto the sibling `Federated International Equity Fund II`
						// (S000009750), which the SAME filing gives its own section.
						// The section is named and its series refused.
						name, id, ok = line, "", true
						continue
					}
				}
				if f := strings.Fields(candidate); len(f) > 1 && (isAllDigits(f[0]) || isLeadingAccountCode(f[0])) {
					candidate = strings.Join(f[1:], " ")
				}
				// `Fund Name : Columbia Liberty Fund-C7P3` (Columbia Funds
				// Series Trust I 2007, 1,711 rows): the portfolio code is glued
				// to the declared `Columbia Liberty Fund` with a hyphen rather
				// than standing as a token of its own. Cut for the lookup only,
				// and only when what remains resolves.
				if stem, ok := htmlCutGluedCode(candidate); ok {
					if _, d := issResolveFund(ix, stem); d != nil {
						candidate = stem
					}
				}
				// `Fund: Jennison Growth Fund #19F2` (Prudential Investment
				// Portfolios 2004, 5,658 rows): the account code trails the
				// name instead of leading it. Cut for the lookup only.
				if f := strings.Fields(candidate); len(f) > 1 && isAccountCodeToken(f[len(f)-1]) {
					candidate = strings.Join(f[:len(f)-1], " ")
				}
			}
		}
		// `Investment Company Report --Zevenbergen Genea Fund` (Trust for Advised
		// Portfolios 2016, 158 rows): the dash run is glued to the brand token,
		// where the sibling banner of the same filing types a space after it and
		// resolves. Split the run off for the lookup only, and only when the split
		// candidate resolves -- the printed heading is what gets recorded.
		if _, d := issResolveFund(ix, candidate); d == nil {
			if split := htmlSplitGluedDashRun(candidate); split != candidate {
				if _, sd := issResolveFund(ix, split); sd != nil {
					candidate = split
				}
			}
		}
		if _, d := issResolveFund(ix, candidate); d != nil {
			// A banner wrapped over two elements resolves TWICE -- once per
			// half -- and the later half wins by standing last: `Portfolio I`
			// under `Large Cap Growth` is a suffix of all six declared names
			// and lands on another fund (Multi-Select Securities Fund for
			// Puerto Rico Residents 2023, 709 rows stamped S000074350 for
			// S000074347). When this line directly follows the one already
			// adopted and the JOIN resolves, the two are one heading.
			// The join must be a name the header spells OUTRIGHT: the tolerant
			// resolver answers for `Large Cap Growth Portfolio I Large Cap
			// Growth` too, and adopting that would make every following line
			// join onto a heading that never existed.
			if ok && !labelled && adoptedAt == htmlPrevNonblank(lines, li) {
				joined := adoptedLine + " " + line
				if jd, _ := lookupSeriesEntry(ix.byName, joined); jd != nil {
					name, id = joined, jd.SeriesID
					adoptedAt, adoptedLine = li, joined
					continue
				}
			}
			name, id, ok = line, d.SeriesID, true
			adoptedAt, adoptedLine = li, line
		} else if dictID := htmlDictionaryFund(ix, dict, candidate); dictID != "" {
			name, id, ok = line, dictID, true
		} else if labelled {
			// The label's value wraps onto the next line: `Institution
			// Account(s): db X-trackers MSCI Brazil` / `Hedged Equity Fund`
			// (DBX ETF Trust, 38k rows). Exact after the join.
			for _, next := range lines[li+1:] {
				if n := strings.TrimSpace(next); n != "" {
					if _, d := issResolveFund(ix, candidate+" "+n); d != nil {
						name, id, ok = strings.TrimSpace(line+" "+n), d.SeriesID, true
					}
					break
				}
			}
		} else {
			// An unlabelled portfolio heading may be split across two block
			// lines. Adopt the join only when the declared-series lookup resolves.
			for _, next := range lines[li+1:] {
				if n := strings.TrimSpace(next); n != "" {
					joined := line + " " + n
					if _, d := issResolveFund(ix, joined); d != nil {
						name, id, ok = joined, d.SeriesID, true
					}
					break
				}
			}
		}
	}
	return name, id, ok
}

// htmlDictionaryFund only admits names the header does not declare, even
// ambiguously. Additional readings are bounded sub-adviser and Lincoln brand cuts.
// htmlFundColumnStem reads the bare stem a `Portfolio Name` column prints for a
// fund the registrant brands and types in full: `Equity` for a declared `The
// Masters' Select Equity Fund` (S000005593). The stem must end exactly one
// declared name once its type word is dropped, at least one leading token must
// precede it, and exactly one series may answer -- two series answering refuse.
//
// It is asked ONLY of a cell in the column a fund-labelled header cell opened.
// A stem this short is not evidence on its own; the column label is.
func htmlFundColumnStem(ix *issSeriesIndex, stem string) string {
	key := normalizeSeriesName(stem)
	if key == "" || ix == nil {
		return ""
	}
	id := ""
	for i := range ix.decls {
		base, typed := issDropTypeWord(normalizeSeriesName(ix.decls[i].Name))
		if !typed || !strings.HasSuffix(base, " "+key) {
			continue
		}
		if id != "" && id != ix.decls[i].SeriesID {
			return ""
		}
		id = ix.decls[i].SeriesID
	}
	return id
}

// htmlCutFormItemSuffix drops the form item printed after the fund on a
// Registrant line: `Registrant: Dunham Funds - Dunham Corporate/Government Bond
// Fund    Item 1` (the Ultimus vintage, 2017+), and the same suffix on the
// vintage that glues the registrant to the fund with a hyphen.
func htmlCutFormItemSuffix(candidate string) string {
	if k := strings.Index(candidate, "  Item "); k > 0 {
		return strings.TrimSpace(candidate[:k])
	}
	if k := strings.LastIndex(candidate, " Item "); k > 0 && strings.Trim(candidate[k+6:], "0123456789, ExhibitBIT") == "" {
		return strings.TrimSpace(candidate[:k])
	}
	return candidate
}

// htmlSplitGluedDashRun puts a space between a leading run of dashes and the
// word it is glued to, so the resolver's leading-token walk makes the cut it
// already makes when the filing types that space.
func htmlSplitGluedDashRun(candidate string) string {
	f := strings.Fields(candidate)
	changed := false
	for i, tok := range f {
		rest := strings.TrimLeft(tok, "-")
		if rest == tok || rest == "" {
			continue
		}
		f[i] = tok[:len(tok)-len(rest)] + " " + rest
		changed = true
	}
	if !changed {
		return candidate
	}
	return strings.Join(f, " ")
}

func htmlDictionaryFund(ix *issSeriesIndex, fallback *dictFallback, candidate string) string {
	if fallback == nil {
		return ""
	}
	if _, declared := lookupSeriesEntry(ix.byName, candidate); declared {
		return ""
	}
	if d, seen := lookupSeriesEntry(fallback.byName, candidate); seen {
		if d != nil {
			return d.SeriesID
		}
		return ""
	}
	// The banner may carry a trailing parenthetical the dictionary name lacks --
	// `Institution Account(s): Aspiriant Risk-Managed Global Equity Fund (GMV)`,
	// a FORMER name of a declared series (Aspiriant Trust 2017, 2,631 rows with
	// no series). Same cut the header rules and dictFallback.apply already make,
	// and a class marker still stays: `FUND (A)` is a class-pair question.
	if !htmlDeclaredClassMarker(ix, candidate) {
		if head, cut := issCutTrailingParenthetical(candidate); cut {
			if _, declared := lookupSeriesEntry(ix.byName, head); declared {
				return ""
			}
			if d, seen := lookupSeriesEntry(fallback.byName, head); seen {
				if d != nil {
					return d.SeriesID
				}
				return ""
			}
		}
	}
	// This registrant prints its Cavanal Hill brand before unbranded dictionary
	// names. Never reread a name the native header declares, even ambiguously.
	if ix.registrantKey == "cavanal hill funds" {
		if rest, ok := issCutBrand(normalizeSeriesName(candidate), "cavanal hill"); ok {
			if _, declared := lookupSeriesEntry(ix.byName, rest); declared {
				return ""
			}
			if d, _ := lookupSeriesEntry(fallback.byName, rest); d != nil {
				return d.SeriesID
			}
			return ""
		}
	}
	if rest, ok := issCutBrand(normalizeSeriesName(candidate), "lincoln"); ok && fallback.byHeadingName != nil {
		if d, _ := lookupSeriesEntry(fallback.byHeadingName, rest); d != nil {
			return d.SeriesID
		}
		return ""
	}
	if cut, ok := issCutSubAdviser(candidate); ok {
		if _, declared := lookupSeriesEntry(ix.byName, cut); declared {
			return ""
		}
		if d, _ := lookupSeriesEntry(fallback.byName, cut); d != nil {
			return d.SeriesID
		}
	}
	// The registrant's own brand in front of an unbranded dictionary name:
	// `Commerce Growth Fund` for the dictionary's `The Growth Fund` (Commerce
	// Funds 2005, S000010025). The same brand list the declared-name path uses,
	// and a name the native header declares is still never reread.
	for _, b := range ix.brands {
		rest, ok := issCutBrand(normalizeSeriesName(candidate), b)
		if !ok {
			continue
		}
		if _, declared := lookupSeriesEntry(ix.byName, rest); declared {
			return ""
		}
		if d, _ := lookupSeriesEntry(fallback.byName, rest); d != nil {
			return d.SeriesID
		}
	}
	// The registrant's own name glued to the fund by a hyphen and no space:
	// `Registrant: Saratoga Advantage Trust- Health & Biotechnology Portfolio`
	// for the dictionary's `Health & Biotechnology Portfolio` (S000010884),
	// whose spelling in this filing's own header is a typo. Every token of the
	// prefix must be a token of the registrant's name, and a name the native
	// header declares is still never reread.
	if rest, ok := issHyphenGluedRegistrantPrefix(candidate, ix.registrantKey); ok {
		if _, declared := lookupSeriesEntry(ix.byName, rest); declared {
			return ""
		}
		if d, _ := lookupSeriesEntry(fallback.byName, rest); d != nil {
			return d.SeriesID
		}
	}
	// One word of the dictionary name abbreviated by the heading: `Brandes
	// Institutional Intl Equity Fund` for `... International Equity Fund`
	// (Brandes Investment Trust 2013, S000005855, 1,021 rows). The same edit
	// issAbbrevWordDecl admits on the declared side, and a heading the native
	// header declares is still never reread.
	if d := htmlDictAbbrevWord(fallback, normalizeSeriesName(candidate)); d != nil {
		return d.SeriesID
	}
	// The heading drops the type word the dictionary name carries: `Core Equity
	// Plus` for the dictionary's `CORE EQUITY PLUS FUND` (American Century
	// Quantitative Equity Funds 2020, S000021731, 1,091 rows over five such
	// headings). The declared-name path already reads a heading this way; the
	// dictionary path had no such rung. Two type words naming two different
	// series refuse, and a name the native header declares is never reread.
	if d := htmlDictTypeWordAdded(ix, fallback, normalizeSeriesName(candidate)); d != nil {
		return d.SeriesID
	}
	// The heading drops the registrant brand the dictionary name keeps, the same
	// reading dictFallback.apply makes: `Opportunistic EAFE Fund` for `MCBT
	// Opportunistic EAFE Fund` (S000009976).
	if d := fallback.brandPrefixed(candidate); d != nil {
		return d.SeriesID
	}
	return ""
}

// htmlDictTypeWordAdded finds the one dictionary name key equals once a type
// word is appended. Nil when key already carries one, when the native header
// declares the result, or when two type words name different series.
func htmlDictTypeWordAdded(ix *issSeriesIndex, fallback *dictFallback, key string) *SeriesDecl {
	if key == "" {
		return nil
	}
	if _, typed := issDropTypeWord(key); typed {
		return nil
	}
	var hit *SeriesDecl
	for _, tw := range []string{"fund", "portfolio", "trust", "account", "series"} {
		try := key + " " + tw
		if _, declared := lookupSeriesEntry(ix.byName, try); declared {
			return nil
		}
		d, seen := lookupSeriesEntry(fallback.byName, try)
		if !seen {
			continue
		}
		if d == nil || hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// htmlDictAbbrevWord finds the one dictionary name key differs from by exactly
// one abbreviated word. Two candidates that name different series refuse.
func htmlDictAbbrevWord(fallback *dictFallback, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	var hit *SeriesDecl
	for name, d := range fallback.byName {
		if d == nil {
			continue
		}
		dt := strings.Fields(name)
		if len(dt) != len(toks) {
			continue
		}
		diff := 0
		for j := range toks {
			if toks[j] == dt[j] {
				continue
			}
			diff++
			if diff > 1 || !issAbbreviates(toks[j], dt[j]) {
				diff = 2
				break
			}
		}
		if diff != 1 {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// htmlFundLabelled reports a pre-text line that labels the fund: Putnam's
// `Fund Name : Putnam VT Capital Appreciation Fund` (450k rows with no series
// on 2026-09-02), TFS's `NAME OF FUND: TFS MARKET NEUTRAL FUND (TFSMX)`.
// reHTMLSplitExhibit is reHTMLRegistrantExhibit widened to the LETTERED exhibit
// this cover row prints (`Item 1, Exhibit A`). Kept separate from the two-cell
// path's regexp, which decides whether a heading is read at all elsewhere.
var reHTMLSplitExhibit = regexp.MustCompile(`(?i)^Item [0-9]{1,2}, Exhibit [0-9A-Z]{1,3}$`)

// htmlRegistrantSplitCells rejoins a cover row whose `Registrant:` label, fund
// value and exhibit marker each occupy a cell of their own, returning the label
// and value as one line. Exactly one filled cell may remain once the label and
// the exhibit markers are accounted for: a row carrying two candidate values is
// not this shape and is left to the readers below.
func htmlRegistrantSplitCells(cells []string) (string, bool) {
	var filled []string
	for _, cell := range cells {
		if v := strings.TrimSpace(cell); v != "" {
			filled = append(filled, v)
		}
	}
	if len(filled) < 3 {
		return "", false
	}
	label := strings.TrimSpace(strings.TrimSuffix(filled[0], ":"))
	if !strings.EqualFold(label, "Registrant") {
		return "", false
	}
	value := ""
	for _, v := range filled[1:] {
		if reHTMLSplitExhibit.MatchString(v) {
			continue
		}
		if value != "" {
			return "", false
		}
		value = v
	}
	if value == "" {
		return "", false
	}
	return filled[0] + " " + value, true
}

// htmlBrandOnlyHeading reads a section heading that names the registrant's own
// brand and a type word and NOTHING else: `Account Name: Neiman Fund` over a
// header declaring `Neiman Large Cap Value Fund` and `Neiman Small Cap Value
// Fund` (Neiman Funds 2006, 216 of 297 rows with no fund name and no series).
// Such a heading carries no token separating one declaration from another, so
// it can never resolve; what it does establish is that a section opened here.
func htmlBrandOnlyHeading(ix *issSeriesIndex, pre string) (string, bool) {
	if pre == "" || ix == nil || len(ix.decls) < 2 {
		return "", false
	}
	// The brand is what EVERY declared name carries: a heading built of nothing
	// but those words and a type word names no one of them in particular.
	shared := map[string]bool{}
	for i := range ix.decls {
		toks := strings.Fields(normalizeSeriesName(ix.decls[i].Name))
		if i == 0 {
			for _, t := range toks {
				shared[t] = true
			}
			continue
		}
		seen := map[string]bool{}
		for _, t := range toks {
			seen[t] = true
		}
		for t := range shared {
			if !seen[t] {
				delete(shared, t)
			}
		}
	}
	for _, line := range strings.Split(pre, "\n") {
		line = htmlFlat(line)
		if line == "" {
			continue
		}
		low := strings.ToLower(line)
		if !htmlFundLabelled(line) && !strings.HasPrefix(low, "account name") {
			continue
		}
		colon := strings.IndexByte(line, ':')
		if colon <= 0 {
			continue
		}
		value := strings.TrimSpace(line[colon+1:])
		toks := strings.Fields(normalizeSeriesName(value))
		if len(toks) < 2 || len(toks) > 3 {
			continue
		}
		brandTok, typeTok := false, false
		for _, t := range toks {
			switch {
			case htmlBrandOnlyTypeWord[t]:
				typeTok = true
			case shared[t]:
				brandTok = true
			default:
				return "", false
			}
		}
		if brandTok && typeTok && icrResolveFundShared(ix, value) == "" {
			return value, true
		}
	}
	return "", false
}

// htmlBrandOnlyTypeWord lists the words a brand-only heading may carry beside
// the registrant's own name.
var htmlBrandOnlyTypeWord = map[string]bool{
	"fund": true, "funds": true, "portfolio": true, "portfolios": true,
	"trust": true, "series": true, "account": true,
}

// htmlStampBrandOnlyByElimination attributes the rows of a brand-only section
// when the filing's own declarations settle it: the other sections named their
// series outright, and exactly one declaration is left for the section that
// named none. Nothing is stamped when more than one remains.
func htmlStampBrandOnlyByElimination(out []VoteRow, rows []int, decls []SeriesDecl) {
	if len(rows) == 0 || len(decls) < 2 {
		return
	}
	claimed := map[string]bool{}
	for i := range out {
		if out[i].SeriesID != "" {
			claimed[out[i].SeriesID] = true
		}
	}
	if len(claimed) == 0 {
		return
	}
	unclaimed := ""
	for i := range decls {
		id := decls[i].SeriesID
		if id == "" || claimed[id] {
			continue
		}
		if unclaimed != "" {
			return
		}
		unclaimed = id
	}
	if unclaimed == "" {
		return
	}
	for _, i := range rows {
		if i < len(out) && out[i].SeriesID == "" {
			out[i].SeriesID = unclaimed
		}
	}
}

func htmlFundLabelled(line string) bool {
	low := strings.ToLower(line)
	// `Account Number: Putnam Asset Allocation: Balanced Portfolio` (the 2005
	// Putnam filer agent, 55k rows with no fund on run68): the "number" is a name.
	for _, l := range []string{"institution account", "fund name", "name of fund", "portfolio name", "series name", "account number"} {
		if strings.HasPrefix(low, l) {
			return true
		}
	}
	return false
}

// isLeadingAccountCode reports the alphanumeric account code some agents print
// in front of the fund name: `CBNA-4C13 Commerce Growth Fund` (Commerce Funds
// 2005, 3,348 rows with no fund). Upper-case letters, digits and hyphens only,
// one of each at least, so neither a word (`Commerce`) nor a Roman numeral is
// one.
func isLeadingAccountCode(s string) bool {
	if len(s) < 3 || len(s) > 12 {
		return false
	}
	digit, letter := false, false
	for i := 0; i < len(s); i++ {
		switch c := s[i]; {
		case c >= '0' && c <= '9':
			digit = true
		case c >= 'A' && c <= 'Z':
			letter = true
		case c == '-':
		default:
			return false
		}
	}
	return digit && letter
}

// htmlCutGluedCode removes a hyphen-attached code from the last word of a fund
// name: `Columbia Liberty Fund-C7P3`. Two to eight upper-case letters or digits
// with a digit among them, so a hyphenated word (`Mid-Cap`) is never cut.
func htmlCutGluedCode(name string) (string, bool) {
	f := strings.Fields(name)
	if len(f) < 2 {
		return "", false
	}
	last := f[len(f)-1]
	i := strings.LastIndexByte(last, '-')
	if i <= 0 {
		return "", false
	}
	code := last[i+1:]
	if len(code) < 2 || len(code) > 8 {
		return "", false
	}
	digit := false
	for j := 0; j < len(code); j++ {
		switch c := code[j]; {
		case c >= '0' && c <= '9':
			digit = true
		case c >= 'A' && c <= 'Z':
		default:
			return "", false
		}
	}
	if !digit {
		return "", false
	}
	f[len(f)-1] = last[:i]
	return strings.Join(f, " "), true
}

// isAccountCodeToken reports a trailing account code printed beside the fund
// name: `#19F2`, `#146996`. Two to eight letters or digits after the `#`, so a
// bare `#` or a footnote marker such as `#*` is not one.
func isAccountCodeToken(s string) bool {
	if len(s) < 3 || s[0] != '#' {
		return false
	}
	body := s[1:]
	if len(body) > 8 {
		return false
	}
	for i := 0; i < len(body); i++ {
		c := body[i]
		if (c < '0' || c > '9') && (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') {
			return false
		}
	}
	return true
}

func isAllDigits(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// htmlVoteSummaryBanner is the heading this grammar prints above each fund's
// section. The fund's name is the line UNDER it:
//
//	VOTE SUMMARY REPORT
//	FIDELITY CORPORATE BOND FUND
//	07/01/2022 - 06/30/2023
//
// Measured 2026-08-31, 7,385 of the 12,546 htmltable filings declare series and
// print no `Fund Name :` line at all; this banner is what they print instead,
// and those filings hold 44,801,362 rows.
const htmlVoteSummaryBanner = "VOTE SUMMARY REPORT"

// htmlVoteSummaryTitle is the same banner shortened to a page title, which names
// no fund at all.
const htmlVoteSummaryTitle = "VOTE SUMMARY"

// htmlFundHeading reads the fund a section belongs to out of the markup between
// two tables. Both spellings are LABELLED -- a banner line or a `Fund Name :`
// field -- so neither is a heading guessed from position, and a section this
// layout cannot name returns ok with an empty string so the caller clears rather
// than carrying the previous fund forward.
// htmlIsPeriodLine reports a reporting-period line: a `Period` label, or a
// line that opens with a date.
func htmlIsPeriodLine(s string) bool {
	low := strings.ToLower(s)
	if strings.HasPrefix(low, "reporting period") || strings.HasPrefix(low, "period") {
		return true
	}
	f := strings.Fields(s)
	if len(f) >= 3 && htmlDate(strings.Join(f[:3], " ")) != "" {
		return true
	}
	return len(f) >= 1 && htmlDate(f[0]) != ""
}

// htmlReportParameterLine reports whether a line is one of the export's own run
// parameters printed under the Vote Summary Report banner. These never name a
// fund.
func htmlReportParameterLine(s string) bool {
	low := strings.ToLower(strings.TrimSpace(s))
	for _, p := range []string{"report was run from:", "location(s):", "ballot status(es):", "account group(s):"} {
		if strings.HasPrefix(low, p) {
			return true
		}
	}
	// `Institution Account(s):` names a fund in other vintages, so only its
	// blanket value counts as a parameter here.
	if rest, ok := strings.CutPrefix(low, "institution account(s):"); ok {
		return strings.HasPrefix(strings.TrimSpace(rest), "all ")
	}
	// The plural spelling is a different field: `Institutional Account(s): US
	// Mid-Cap - 3619770182, 3609770181, ...` lists the report's ACCOUNT CODES
	// under a portfolio named once on the report's first page (Met Investors
	// Series Trust 2012, 15,285 rows named after it). It never names a fund, so
	// it is a run parameter whatever it carries.
	return strings.HasPrefix(low, "institutional account(s):")
}

// htmlBannerBlock reports a block that carries the `Vote Summary Report`
// banner, which is what makes a fund named in it the REPORT's fund rather than
// one section's.
func htmlBannerBlock(pre string) bool {
	for _, line := range strings.Split(pre, "\n") {
		if strings.EqualFold(strings.TrimSpace(line), htmlVoteSummaryBanner) {
			return true
		}
	}
	return false
}

// htmlPageBreakPreamble reports the ISS report preamble as it is reprinted at
// the top of a continuation page: the `Vote Summary Report` banner, with the
// report's run parameters under it and nothing above it. The report's title page
// prints its portfolio ABOVE the banner, so a block that names the fund is not
// one of these.
func htmlPageBreakPreamble(pre string) bool {
	if pre == "" {
		return false
	}
	banner := -1
	for i, line := range strings.Split(pre, "\n") {
		v := strings.TrimSpace(line)
		if v == "" {
			continue
		}
		if banner < 0 {
			if !strings.EqualFold(v, htmlVoteSummaryBanner) {
				return false
			}
			banner = i
			continue
		}
		return htmlReportParameterLine(v)
	}
	return false
}

func htmlFundHeading(pre string) (string, bool) {
	if pre == "" {
		return "", false
	}
	lines := strings.Split(pre, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		// The same banner without its `Report`: a page title naming NO fund,
		// printed over an ISS vote block whose own rows carry no fund column
		// (Investment Managers Series Trust II 2021, 392 of 1,046 rows). The
		// fund was stated once above the block by the `Fund Name:` label row,
		// and the line under this banner is the ISSUER, so nothing here names a
		// fund: the standing one carries into the block.
		if strings.EqualFold(trimmed, htmlVoteSummaryTitle) {
			return "", true
		}
		if strings.EqualFold(trimmed, htmlVoteSummaryBanner) {
			// The banner may be followed only by the report's own run
			// parameters (Ashmore Funds 2012, 2,199 rows named `Report was run
			// from: 7/1/11 to 6/30/12`): that block continues the section above
			// it, so no boundary opens and the section fund carries into it.
			for _, next := range lines[i+1:] {
				if v := strings.TrimSpace(next); v != "" {
					// A run parameter under the banner SEALS the preamble: what
					// follows it is the page's own content, not the section's
					// name. Met Investors' continuation pages print the banner,
					// `Report was run from:` and `Institutional Account(s):`
					// above the first ISSUER of the page, and reading that
					// issuer as the fund loses the portfolio the report named on
					// its first page (15,285 rows).
					if htmlReportParameterLine(v) {
						return "", false
					}
					// The line under the banner is the reporting period in
					// some vintages (`Reporting Period: 07/01/2013 to
					// 06/30/2014`, `July 1, 2009 - June 30, 2010`; DBX ETF
					// Trust and MET Investors, 74k rows named after it).
					if htmlIsPeriodLine(v) {
						return "", true
					}
					return v, true
				}
			}
			return "", true
		}
		if name, ok := icrFundName(trimmed); ok {
			if name == "" {
				// The label's value WRAPS onto the next line: `Fund Name :`
				// then `Columbia International Fund, VS` (Columbia Funds
				// Variable Insurance Trust 2007, 9,934 rows with no series,
				// 5,695 of them with no name at all). The section IS named,
				// just not on the label's own line, so the wrapped value is
				// read rather than the carried fund cleared. A period line or
				// a further labelled line is not the value, and those still
				// clear.
				for _, next := range lines[i+1:] {
					v := strings.TrimSpace(next)
					if v == "" {
						continue
					}
					if !htmlIsPeriodLine(v) && !strings.Contains(v, ":") {
						name = v
					}
					break
				}
			}
			return name, true
		}
	}
	return "", false
}

// htmlIsYesNo reports a did-vote flag value.
func htmlIsYesNo(v string) bool {
	switch strings.ToUpper(strings.TrimSpace(v)) {
	case "YES", "NO", "Y", "N":
		return true
	}
	return false
}

// htmlVotedFlagInfo renders the flag for vote_other_info; empty when unset.
func htmlVotedFlagInfo(flag string) string {
	if flag == "" {
		return ""
	}
	return "Voted: " + strings.TrimSpace(flag)
}

// htmlMeetingTypeWord reports a bare meeting-type word.
func htmlMeetingTypeWord(w string) bool {
	switch strings.ToUpper(strings.Trim(w, ":;,")) {
	case "ANNUAL", "SPECIAL", "AGM", "EGM", "CONSENT", "CONTEST", "CONTESTED", "ANNUAL/SPECIAL", "SPECIAL/ANNUAL":
		return true
	}
	return false
}

// htmlBareLabelledValueRow reports a row in which a bare label is followed, in
// the same row, by a filled cell that is no label: `Meeting Date | 22-Apr-20`.
// A stacked grid's label-only row (`Ticker | Security ID: | Meeting Date`) has
// no such value and stays with the stacked and split-header readers.
func htmlBareLabelledValueRow(cells []string) bool {
	if htmlHasVoteCell(cells) || htmlAllLabels(cells) {
		return false
	}
	for i, c := range cells {
		if _, ok := htmlBareLabels[htmlUpperASCII(htmlFlat(c))]; !ok {
			continue
		}
		for j := i + 1; j < len(cells); j++ {
			v := htmlFlat(cells[j])
			if v == "" {
				continue
			}
			up := htmlUpperASCII(v)
			if _, lab := htmlBareLabels[up]; lab || htmlHasLabelPrefix(up) || htmlIsHeaderWord(v) {
				break
			}
			return true
		}
	}
	return false
}

// htmlExcelSerialDate reads a date printed as a spreadsheet serial day count
// (`39930` for 2009-04-27; Glenmede 2009's International Portfolio table).
// Only five-digit counts between 1998 and 2036 are read, and only from a
// mapped date column, because a share count is a five-digit integer too.
func htmlExcelSerialDate(s string) string {
	s = strings.TrimSpace(s)
	if len(s) != 5 {
		return ""
	}
	n := 0
	for i := 0; i < 5; i++ {
		if s[i] < '0' || s[i] > '9' {
			return ""
		}
		n = n*10 + int(s[i]-'0')
	}
	if n < 35800 || n > 50000 {
		return ""
	}
	return time.Date(1899, time.December, 30, 0, 0, 0, 0, time.UTC).AddDate(0, 0, n).Format("20060102")
}

// htmlDeclaredClassMarker reports a trailing parenthetical this registrant
// spells as one of its OWN class tickers, which makes the name a class-pair
// question rather than a stem to cut. A marker the filing never declares --
// Aspiriant's `(GMV)` -- is an account code, and the collision refusal in the
// dictionary lookup still settles a stem two series answer to.
func htmlDeclaredClassMarker(ix *issSeriesIndex, name string) bool {
	if !issClassMarker(name) {
		return false
	}
	s := strings.TrimSpace(name)
	i := strings.LastIndex(s, "(")
	inner := strings.ToUpper(strings.TrimSpace(s[i+1 : len(s)-1]))
	inner = strings.TrimSpace(strings.TrimPrefix(inner, "CLASS "))
	if _, ok := ix.byTicker[inner]; ok {
		return true
	}
	return len(inner) <= 2
}
