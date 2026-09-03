package main

import (
	"sort"
	"strings"
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
	seriesIx := newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))
	issFormerKeys(seriesIx, meta.FormerNames)
	if indexFrom(body, 0, "</tr>") < 0 {
		return nil, errLayoutDeclined
	}

	feed := &htmlRowFeed{src: body}
	repeats := &htmlHeaderRepeats{body: body}
	var (
		out         []VoteRow
		mapping     map[string]int
		headerArity int
		carry       bool
		partitioned bool
		sawData     bool
		ctx         htmlContext
		ctxLead     string
		stacked     map[int]string
		leadJoin    bool
		ctxSealed   bool
		nilRow      bool
		// curSeries is the fund the following blocks belong to. This layout
		// stamped NO series of its own: measured 2026-08-31, 10.20% of its
		// 55,195,672 rows carried one and every such row came from the chassis
		// single-series fallback, so every multi-series filing contributed
		// nothing to the ISS link. 7,385 of its 12,546 filings declare series and
		// print a fund heading, and those filings hold 44,801,362 rows.
		curSeries string
		// curFund is the fund name as the filing printed it, recorded on every
		// row so an unattributed section shows as unmatched, not unnamed.
		curFund string
	)

	for {
		row, ok := feed.next()
		if !ok {
			break
		}
		cells := row.cells

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
		if name, id, ok := htmlBareFundLine(seriesIx, row.pre); ok {
			curFund, curSeries = name, id
		} else if name, ok := htmlFundHeading(row.pre); ok {
			curFund = name
			curSeries = icrResolveFundShared(seriesIx, name)
		}
		// One vintage prints the labelled heading as TWO CELLS of a table row,
		// `Fund Name :` beside the name (Putnam, ~1M rows): the label is the
		// evidence, exactly as it is on a line.
		if label, value, ok := htmlLabelledCells(cells); ok && htmlFundLabelled(label+":") {
			curFund = value
			curSeries = icrResolveFundShared(seriesIx, value)
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
		if htmlFilledCells(cells) <= 2 {
			if name, id, ok := htmlBareFundLine(seriesIx, strings.Join(cells, "\n")); ok {
				curFund, curSeries = name, id
			}
		}

		if m, mayCarry, mayPartition, consumed, ok := htmlSplitHeaderMapping(cells, feed, repeats); consumed {
			if ok {
				mapping, headerArity = m, len(cells)
				carry, partitioned, sawData = mayCarry, mayPartition, false
				ctxLead, ctxSealed = "", true
			}
			continue
		}
		if m, mayCarry, mayPartition, ok := htmlHeaderMapping(cells, feed, repeats); ok {
			mapping, headerArity = m, len(cells)
			carry, partitioned, sawData = mayCarry, mayPartition, false
			ctxLead, ctxSealed = "", true
			continue
		}
		// A label-shaped row that lacks the required table beneath it is not data.
		// Ignoring it is safer than emitting "Vote Cast" as a fund's actual vote.
		if _, _, headerLike := htmlHeaderShape(cells); headerLike {
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
		if labels, ok := htmlStackedLabels(cells); ok {
			stacked = labels
			continue
		}
		if lead, candidate := htmlContextLead(cells); candidate {
			// An issuer wrapped over two one-cell rows: `Putnam Money Market
			// Liquidity` then `Fund`. Only a short continuation joins.
			if leadJoin && len(strings.Fields(lead)) <= 2 {
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
		if next, labelled := htmlReadContext(cells); labelled {
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
			}
			ctxLead = ""
			ctx.merge(next)
			continue
		}

		emitted := false
		if mapping != nil && htmlComparableArity(len(cells), headerArity) {
			if !partitioned || htmlMappedVoteValue(cells, mapping, headerArity) {
				if r, ok := htmlDataRow(cells, mapping, headerArity, ctx); ok {
					r.SeriesID = curSeries
					r.FundName = curFund
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
				// The identity row of an export that prints issuer, ticker,
				// CUSIP and date under the SAME header as the proposals
				// (Prudential Series Fund 2005: 36,441 rows with no issuer,
				// id or date on 2026-09-02).
				if next, ok := htmlIdentityRow(cells, mapping); ok {
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

	if len(out) == 0 {
		if nilRow {
			return nil, errLayoutNoActivity
		}
		return nil, errLayoutDeclined
	}
	return out, nil
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
	return htmlCellText(seg)
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
	}
	// One scan for the terminator: before this row's <tr> it closed the previous
	// table, after it the table closes before the NEXT row.
	if t := indexFrom(seg, 0, "</table>"); t >= 0 {
		if t < start {
			newTable = true
		} else {
			f.pending = true
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
			return 0, false
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
	return strings.TrimSpace(string(stripHTML(b)))
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
func htmlSplitHeaderMapping(cells []string, feed *htmlRowFeed, repeats *htmlHeaderRepeats) (mapping map[string]int, carry, partitioned, consumed, ok bool) {
	if !htmlHeaderFragment(cells) {
		return nil, false, false, false, false
	}
	next, exists := feed.peek(0)
	if !exists || next.newTable || len(next.cells) != len(cells) || !htmlHeaderFragment(next.cells) {
		return nil, false, false, false, false
	}
	joined := make([]string, len(cells))
	for i := range cells {
		joined[i] = htmlFlat(cells[i] + " " + next.cells[i])
	}
	if _, _, headerLike := htmlHeaderShape(joined); !headerLike {
		return nil, false, false, false, false
	}
	_, _ = feed.next()
	mapping, carry, partitioned, ok = htmlHeaderMapping(joined, feed, repeats)
	return mapping, carry, partitioned, true, ok
}

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
	below, crossed := htmlHasTableBelow(len(cells), feed)
	if !below && !repeats.has(key) {
		if !htmlHasPartitionedVotes(mapping, len(cells), feed) {
			return nil, false, false, false
		}
		partitioned = true
	}
	htmlAdoptUnlabelledItem(cells, mapping, feed)
	return mapping, below && crossed, partitioned, true
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
		if idx >= 0 {
			// Two blank columns: which one is the item is a guess.
			return
		}
		idx = i
	}
	if idx < 0 || !htmlItemColumnConfirmed(idx, len(cells), feed) {
		return
	}
	mapping[htmlFieldItem] = idx
}

// htmlItemColumnConfirmed reports whether every comparable row under the header
// prints an item number at idx, over at least htmlHeaderConfirm rows.
func htmlItemColumnConfirmed(idx, arity int, feed *htmlRowFeed) bool {
	seen, crossed := 0, false
	for i := 0; i < htmlHeaderLookahead; i++ {
		row, ok := feed.peek(i)
		if !ok {
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
		if idx >= len(row.cells) || !htmlIsItemNumber(htmlFlat(row.cells[idx])) {
			return false
		}
		seen++
		if seen >= htmlHeaderConfirm {
			return true
		}
	}
	return false
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
	labels := 0
	for _, c := range cells {
		flat := htmlFlat(c)
		if flat == "" {
			continue
		}
		if htmlIsNumeric(flat) {
			// A bare number in a header row is a value, not a label.
			return nil, "", false
		}
		valueText, maxLen := flat, htmlLabelMaxLen
		if label, _, lettered := htmlLetteredLabel(flat); lettered {
			valueText, maxLen = label, htmlLetteredLabelMaxLen
		}
		if htmlLooksLikeValueLimit(valueText, maxLen) {
			return nil, "", false
		}
		labels++
	}
	if labels < htmlHeaderMinCells || labels > htmlHeaderMaxCells {
		return nil, "", false
	}

	mapping := htmlMapFields(cells)
	if len(mapping) < 3 {
		return nil, "", false
	}
	if _, ok := mapping[htmlFieldVote]; !ok {
		return nil, "", false
	}
	if _, ok := mapping[htmlFieldDesc]; !ok {
		return nil, "", false
	}
	return mapping, htmlHeaderKey(cells), true
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
			break
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
	htmlFieldItem    = "item"
	htmlFieldDesc    = "desc"
	htmlFieldBy      = "by"
	htmlFieldMgmtRec = "mgmtrec"
	htmlFieldVote    = "vote"
	htmlFieldVsMgmt  = "vsmgmt"
	htmlFieldTicker  = "ticker"
	htmlFieldCUSIP   = "cusip"
	htmlFieldMtgDate = "mtgdate"
	htmlFieldIssuer  = "issuer"
	htmlFieldISIN    = "isin"
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
		// "PROPOSAL TYPE" is the description column of the 81-filing
		// `Proposal Type | Voted? | Vote | For/Agnst Mgmt` shape, which prints
		// no other column naming what was voted on. Reading it as the PROPOSER
		// left that shape one field short of the header test and skipped all 81.
		"PROPOSAL TYPE",
	},
	htmlFieldBy: {
		"PROPOSED BY", "PROPONENT", "PRPNENT", "SPONSOR", "AUTHOR",
		"PROPOSAL TYPE MGMT OR SHLDR",
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
		"VOTE", "CAST", "VOTED", "VOTE CASTS",
	},
	htmlFieldVsMgmt: {
		"FOR/AGAINST MANAGEMENT", "FOR/AGNST MGMT", "FOR/ AGNST MGMT", "WITH MGMT",
		"FOR AGAINST MANAGEMENT", "WITH MANAGEMENT",
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
	htmlFieldMtgDate: {
		"MEETING DATE", "MTG DATE", "DATE OF MEETING", "MTG DATE/TYPE",
	},
	htmlFieldIssuer: {
		"ISSUER", "ISSUER NAME", "COMPANY", "COMPANY NAME", "SECURITY NAME",
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
	htmlFieldMtgDate, htmlFieldIssuer, htmlFieldISIN,
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
			for _, s := range htmlSynonyms[field] {
				if len(s) > bestLen && htmlContainsWords(lab, s) {
					best, bestLen = field, len(s)
				}
			}
		}
		if best != "" {
			mapping[best] = i
			claimed[i] = true
		}
	}
	return mapping
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
	if strings.HasSuffix(s, "?") || htmlCanonLabel(s) == "VOTED YES OR NO" {
		return true
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
	return htmlFlat(b.String())
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
	if n.Issuer != "" {
		c.Issuer = n.Issuer
	}
	if n.CUSIP != "" {
		c.CUSIP = n.CUSIP
	}
	if n.ISIN != "" {
		c.ISIN = n.ISIN
	}
	if n.Ticker != "" {
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
	"ISSUER NAME:", "ISSUER:", "MEETING DATE:", "RECORD DATE:",
	"TICKER SYMBOL:", "TICKER:", "SECURITY ID:", "CUSIP NUMBER:", "CUSIP:", "ISIN:",
}

// htmlBareValued are bare labels printed WITH their value in the same cell
// (`Primary CUSIP 35671D857`, `Primary ISIN US35671D8570`; Deutsche's db-X
// and DBX ETF trusts, 58k rows with no issuer, id or date on 2026-09-02).
var htmlBareValued = map[string]string{
	"PRIMARY CUSIP ": "CUSIP:", "PRIMARY ISIN ": "ISIN:", "CUSIP ": "CUSIP:", "ISIN ": "ISIN:",
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
	// Not "ISSUER": it is a proponent value ('Issuer' in Buffalo Funds' Proposed
	// By column), and reading it as a label consumed 173,538 vote rows across
	// 395 filings on run55.
}

// htmlReadContext pulls the meeting identity out of a block row. labelled
// reports whether the row carried any of the labels at all, which is what tells
// a new meeting block apart from decorative furniture.
func htmlReadContext(cells []string) (ctx htmlContext, labelled bool) {
	var (
		above    string // the last unlabelled line seen
		lead     string // the unlabelled line directly above the FIRST label
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
	bare := !htmlHasVoteCell(cells) && !htmlAllLabels(cells) && (htmlFilledCells(cells) <= 4 || htmlBareLabelCount(cells) >= 2)
	for ci, cell := range cells {
		// A label wrapped at a source newline inside its cell (`Meeting
		// Date:`, GMO Trust: 38,059 of 38,551 rows with no date on
		// 2026-09-02) is one item, read whole.
		if flat := htmlFlat(cell); htmlHasLabelPrefix(htmlUpperASCII(flat)) {
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
				if strings.HasPrefix(up, prefix) {
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
			// The issuer may precede the labels on the SAME line: `TELUS
			// CORPORATION MEETING DATE: MAY 7, 2009 TICKER: T SECURITY ID:
			// 87971M996` (Fidelity Investment Trust 2009, 24,488 rows with no
			// security id). Only a line carrying at least two labels after an
			// issuer-shaped prefix is split; a sentence mentioning one label
			// is not context.
			if !htmlHasLabelPrefix(up) {
				if cut, ok := htmlLeadingIssuerCut(line, up); ok {
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
					above = line
				}
				continue
			}
			if !leadSeen {
				lead, leadSeen = above, true
			}
			for _, label := range htmlContextLabels {
				v, ok := htmlLabelValue(line, up, label)
				if !ok {
					continue
				}
				labelled = true
				// A cell that is ONLY the label has its value in the next cell:
				// `Ticker: | MMM | Security ID: | 88579Y101` (FundVantage Trust,
				// 101,061 of 108,913 rows with no issuer, id or date on 2026-09-02).
				// The value cell may wrap too (`MAY 12,` / `2005`), so it is
				// read whole.
				if strings.TrimSpace(v) == "" && strings.EqualFold(strings.TrimSpace(up), label) {
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
						}
						break
					}
				}
				switch label {
				case "ISSUER NAME:", "ISSUER:":
					if ctx.Issuer == "" {
						ctx.Issuer = htmlFlat(v)
					}
				case "MEETING DATE:":
					if ctx.MeetingDate == "" {
						ctx.MeetingDate = htmlDate(v)
					}
				case "TICKER SYMBOL:", "TICKER:":
					if ctx.Ticker == "" {
						ctx.Ticker = htmlValueOrEmpty(v)
					}
				case "SECURITY ID:", "CUSIP NUMBER:", "CUSIP:":
					// A Security ID that is an ISIN belongs in the ISIN column.
					if id := htmlValueOrEmpty(v); isinToken(id) {
						if ctx.ISIN == "" {
							ctx.ISIN = id
						}
					} else if ctx.CUSIP == "" {
						ctx.CUSIP = id
					}
				case "ISIN:":
					if ctx.ISIN == "" {
						ctx.ISIN = htmlValueOrEmpty(v)
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
	if labelled && ctx.Issuer == "" && htmlIsIssuerLine(lead) {
		ctx.Issuer = htmlFlat(lead)
	}
	return ctx, labelled
}

// htmlStackedLabelSet is the vocabulary of a bare label row, without colons.
var htmlStackedLabelSet = map[string]string{
	"TICKER": "TICKER", "TICKER SYMBOL": "TICKER",
	"SECURITY ID": "CUSIP", "CUSIP": "CUSIP", "CUSIP NUMBER": "CUSIP",
	"MEETING DATE": "MEETING DATE", "RECORD DATE": "RECORD DATE",
	"MEETING TYPE": "MEETING TYPE", "MEETING STATUS": "MEETING STATUS",
	"COUNTRY OF TRADE": "COUNTRY", "ISSUER": "ISSUER", "ISSUER NAME": "ISSUER",
	"COMPANY NAME": "ISSUER", "COMPANY": "ISSUER", "SECURITY": "CUSIP",
}

// htmlStackedLabels reports a row whose every non-empty cell is a bare context
// label, at least two of them, keyed by cell index.
func htmlStackedLabels(cells []string) (map[int]string, bool) {
	var labels map[int]string
	for i, cell := range cells {
		flat := htmlFlat(cell)
		if flat == "" {
			continue
		}
		key := strings.TrimSpace(strings.TrimSuffix(htmlUpperASCII(flat), ":"))
		canon, ok := htmlStackedLabelSet[key]
		if !ok {
			return nil, false
		}
		if labels == nil {
			labels = map[int]string{}
		}
		labels[i] = canon
	}
	return labels, len(labels) >= 2
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
	for i, label := range labels {
		if i >= len(cells) {
			continue
		}
		v := at(i)
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
		switch label {
		case "CUSIP":
			// `CUSIP 746763168`: the value carries its own label word.
			if f := strings.Fields(v); len(f) > 1 && htmlUpperASCII(f[0]) == "CUSIP" {
				v = strings.Join(f[1:], " ")
			}
			ctx.CUSIP = htmlValueOrEmpty(v)
		case "TICKER":
			ctx.Ticker = htmlValueOrEmpty(v)
		case "MEETING DATE":
			ctx.MeetingDate = htmlDate(v)
		case "ISSUER":
			ctx.Issuer = v
		}
	}
	return ctx
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
	return lead, htmlIsIssuerLine(lead)
}

// htmlIsIssuerLine reports whether an unlabelled line can be read as a block's
// issuer. Anything value-shaped -- a date, a vote, a CUSIP, a signature
// paragraph, anything longer than a column label -- is refused, leaving the
// issuer blank. A blank issuer is a gap; a wrong one is a vote booked against a
// company that never held the meeting.
func htmlIsIssuerLine(s string) bool {
	flat := htmlFlat(s)
	return flat != "" && !htmlLooksLikeValue(flat)
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
	for _, other := range htmlContextLabels {
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
	s = htmlFlat(s)
	if s == "" {
		return ""
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
	if d := brDate(s); d != "" {
		return d
	}
	if d := issDate(s); d != "" {
		return d
	}
	// The SEC lettered table prefixes the date with the meeting type, e.g.
	// "Annual; 07/10/2012". Only a suffix that independently parses as a date
	// is accepted; the prefix is never guessed through.
	if i := strings.LastIndexByte(s, ';'); i >= 0 {
		if d := brDate(strings.TrimSpace(s[i+1:])); d != "" {
			return d
		}
	}
	return ""
}

// htmlDataRow renders one table row through the header's column mapping. Cells
// are taken POSITIONALLY by the header's index, which is the whole point of
// reading the raw markup. A row carrying no vote is table furniture -- a spacer
// or a subtotal -- and emitting it as a vote record would put a non-vote into
// the how_voted column.
// htmlIdentityRow reads a row that fills the identity columns of a shared
// header and none of the vote columns.
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
	ctx.MeetingDate = htmlDate(at(htmlFieldMtgDate))
	if d := at(htmlFieldMtgDate); ctx.MeetingDate == "" && d != "" {
		// `05/02/07 - A`: the date with the meeting-type letter after a dash.
		if f := strings.Fields(d); len(f) > 0 {
			ctx.MeetingDate = htmlDate(f[0])
		}
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
	for _, f := range strings.Fields(v) {
		if isinToken(f) && isin == "" {
			isin = f
		} else if pvTextCUSIP(f) && cusip == "" {
			cusip = f
		}
	}
	return cusip, isin
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
	if vote == "" {
		return VoteRow{}, false
	}
	// A label in the vote column (`Period:`, `Company Name`) is a cover or
	// identity row that shares the table, never a vote (Special Opportunities
	// Fund 2023: 125 rows voted "Period:").
	// Identity labels only: 'No' is a vote in exports with a Voted? column and
	// also an item-number synonym (Brighthouse Funds Trust II, 8,224 rows).
	if strings.HasSuffix(vote, ":") || htmlIsIdentityLabel(vote) {
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
		ManagementRecommendation: at(htmlFieldMgmtRec),
	}

	// A table that prints its own identity columns overrides the block context
	// for that row: the row is the more specific statement.
	if v := at(htmlFieldIssuer); v != "" {
		r.IssuerName = v
	}
	if c, isin := htmlSecurityID(at(htmlFieldCUSIP)); c != "" || isin != "" {
		if c != "" {
			r.CUSIP = c
		}
		if isin != "" && r.ISIN == "" {
			r.ISIN = isin
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
	if len(vals) != 2 {
		return "", "", false
	}
	return vals[0], vals[1], true
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
func htmlBareFundLine(ix *issSeriesIndex, pre string) (name, id string, ok bool) {
	if pre == "" {
		return "", "", false
	}
	lines := strings.Split(pre, "\n")
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
		labelled := htmlFundLabelled(line)
		// `Registrant: GLOBAL ATLANTIC PORTFOLIOS - Global Atlantic American
		// Funds Managed Risk Portfolio` (the Ultimus vintage): only the part
		// after the dash may name the fund. The registrant half never does,
		// or a trust sharing its flagship's name would stamp every section.
		if low := strings.ToLower(line); strings.HasPrefix(low, "registrant") && !htmlFundLabelled(line) {
			if colon := strings.IndexByte(line, ':'); colon > 0 {
				if i := strings.LastIndex(line, " - "); i > colon {
					candidate = strings.TrimSpace(line[i+3:])
					line = candidate
				} else {
					continue
				}
			}
		}
		if htmlFundLabelled(line) {
			if colon := strings.IndexByte(line, ':'); colon > 0 {
				candidate = strings.TrimSpace(line[colon+1:])
				line = candidate
				if f := strings.Fields(candidate); len(f) > 1 && isAllDigits(f[0]) {
					candidate = strings.Join(f[1:], " ")
				}
			}
		}
		if _, d := issResolveFund(ix, candidate); d != nil {
			name, id, ok = line, d.SeriesID, true
		} else if labelled {
			// The label's value wraps onto the next line: `Institution
			// Account(s): db X-trackers MSCI Brazil` / `Hedged Equity Fund`
			// (DBX ETF Trust, 38k rows). Exact after the join.
			for _, next := range lines[li+1:] {
				if n := strings.TrimSpace(next); n != "" {
					if _, d := issResolveFund(ix, candidate+" "+n); d != nil {
						name, id, ok = line+" "+n, d.SeriesID, true
					}
					break
				}
			}
		}
	}
	return name, id, ok
}

// htmlFundLabelled reports a pre-text line that labels the fund: Putnam's
// `Fund Name : Putnam VT Capital Appreciation Fund` (450k rows with no series
// on 2026-09-02), TFS's `NAME OF FUND: TFS MARKET NEUTRAL FUND (TFSMX)`.
func htmlFundLabelled(line string) bool {
	low := strings.ToLower(line)
	for _, l := range []string{"institution account", "fund name", "name of fund", "portfolio name", "series name"} {
		if strings.HasPrefix(low, l) {
			return true
		}
	}
	return false
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

func htmlFundHeading(pre string) (string, bool) {
	if pre == "" {
		return "", false
	}
	lines := strings.Split(pre, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.EqualFold(trimmed, htmlVoteSummaryBanner) {
			for _, next := range lines[i+1:] {
				if v := strings.TrimSpace(next); v != "" {
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
			return name, true
		}
	}
	return "", false
}
