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

// htmlLabelMaxLen caps how long a header cell may be. Real column labels are a
// few words; the signature and agent-for-service paragraphs that fooled a loose
// test are sentences.
const htmlLabelMaxLen = 80

// parseHTMLTableRaw walks the document's table rows over the charset-decoded
// bytes. It returns errLayoutDeclined when no row qualifies as a header, which
// leaves the filing parse_status=skip with a body-derived signature rather than
// parsed against a guessed header.
func parseHTMLTableRaw(raw []byte, _ string, _ FilingMeta) ([]VoteRow, error) {
	body := htmlTableBody(raw)
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
		sawData     bool
		ctx         htmlContext
		ctxSealed   bool
	)

	for {
		row, ok := feed.next()
		if !ok {
			break
		}
		cells := row.cells

		// A </table> ends the mapping with it. Column identity belongs to ONE
		// table; letting a mapping outlive its table means the next table's rows
		// are read through the previous table's columns, and its own header row --
		// which this layout would otherwise never recognise -- is emitted as a vote.
		//
		// The ONE exception is a header htmlHasTableBelow confirmed by rows on the
		// far side of this very boundary: a family of this grammar prints the
		// column labels in a table of their own and the votes in the table
		// beneath it. That licence is carried on the mapping itself (carry), is
		// spent on the first boundary, and is void once the mapping has read a
		// row. "The mapping has emitted nothing yet" is NOT a licence: a label
		// that repeats with nothing under it emits nothing either, and letting it
		// cross means the next table's cells are read through a header belonging
		// to a different table -- an issuer in the description, a CUSIP in the
		// proposer, a share count in how_voted, on funds no vendor covers.
		if row.newTable {
			if carry && !sawData {
				carry = false
			} else {
				mapping, headerArity, carry = nil, 0, false
			}
		}

		// The block heading printed between the two tables carries this block's
		// meeting, and it belongs to no row's cells at all.
		if row.pre != "" {
			if next, labelled := htmlReadContext([]string{row.pre}); labelled {
				if ctxSealed {
					ctx = htmlContext{}
					ctxSealed = false
				}
				ctx.merge(next)
			}
		}

		if m, mayCarry, ok := htmlHeaderMapping(cells, feed, mapping != nil, repeats); ok {
			mapping, headerArity, carry, sawData = m, len(cells), mayCarry, false
			ctxSealed = true
			continue
		}

		// The context test runs BEFORE the data test, and must: in this grammar the
		// meeting identity is printed in block rows whose cell count often falls
		// inside the arity tolerance of the open header. Tested second, such a row
		// is consumed as a vote, its issuer and date are never read, and the
		// PREVIOUS block's meeting stays attached to the next block's votes. A
		// labelled row arriving after a header opens a NEW block, so the previous
		// block's issuer and meeting must not leak onto it.
		if next, labelled := htmlReadContext(cells); labelled {
			if ctxSealed {
				ctx = htmlContext{}
				ctxSealed = false
			}
			ctx.merge(next)
			continue
		}

		if mapping != nil && htmlComparableArity(len(cells), headerArity) {
			if r, ok := htmlDataRow(cells, mapping, ctx); ok {
				out = append(out, r)
				sawData = true
			}
		}
	}

	if len(out) == 0 {
		return nil, errLayoutDeclined
	}
	return out, nil
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
type htmlFeedRow struct {
	cells    []string
	pre      string
	newTable bool
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
func (f *htmlRowFeed) scan() (htmlFeedRow, bool) {
	if f.pos >= len(f.src) {
		return htmlFeedRow{}, false
	}
	i := indexFrom(f.src, f.pos, "</tr>")
	if i < 0 {
		f.pos = len(f.src)
		return htmlFeedRow{}, false
	}
	seg := f.src[f.pos:i]
	f.pos = i + len("</tr>")

	newTable := f.pending
	f.pending = false
	start := indexFrom(seg, 0, "<tr")
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
	return htmlFeedRow{
		cells:    htmlRowCells(seg[start:]),
		pre:      htmlPreText(seg[:start]),
		newTable: newTable,
	}, true
}

// htmlRowCells splits one row's markup on </td> and </th> and decodes each cell.
// Both terminators are five bytes, which is what lets the scan advance uniformly.
//
// Each terminator is located ONCE and re-sought only after the cursor passes it.
// Probing for </th> per cell instead costs a full scan to end-of-segment on every
// cell of every row, because <th> is rare in EDGAR markup and a miss returns -1
// only at the end: O(cells x rowlen), which on a 155 MB body is a ~512x
// amplification of the one pass the row is worth. The </td> search is likewise
// bounded by the largest cell that could still be kept, so an unterminated cell
// costs the cap rather than the remainder of the document.
func htmlRowCells(seg []byte) []string {
	const termLen = len("</td>")
	var cells []string
	pos := 0
	th := indexFrom(seg, 0, "</th>")
	for pos < len(seg) && len(cells) < htmlMaxCells {
		if th >= 0 && th < pos {
			th = indexFrom(seg, pos, "</th>")
		}
		limit, truncated := len(seg), false
		if limit-pos > htmlMaxCellBytes+termLen {
			limit, truncated = pos+htmlMaxCellBytes+termLen, true
		}
		end := indexFrom(seg[:limit], pos, "</td>")
		if th >= 0 && th < limit && (end < 0 || th < end) {
			end = th
		}
		if end < 0 {
			if truncated {
				// Truncating a cell would corrupt a value silently, so an
				// oversized one disqualifies its row whole.
				return nil
			}
			break
		}
		if end-pos > htmlMaxCellBytes {
			return nil
		}
		cells = append(cells, htmlCellText(seg[pos:end]))
		pos = end + termLen
	}
	return cells
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

// htmlHeaderMapping decides whether a row is a column header and, if so, which
// schema field each column carries. Every condition is a rejection: a row is a
// header only if it is label-shaped, carries no value, maps at least three
// distinct fields including both the vote and the description, and is CONFIRMED
// by one of the three witnesses below.
//
// inTable says a header has already been confirmed for the table now open. The
// confirmation is what proves a label-shaped row is not a caption, and it is only
// needed to OPEN a table: inside one already proven, a row that passes every
// other condition is this grammar's repeated header, and reading it as a header
// is what stops it being emitted as a vote.
//
// THE SECOND WITNESS, and why the first is not enough. Requiring three following
// rows of comparable arity rejects a genuine header that has only ONE proposal
// under it -- a written consent with a single item, which is an ordinary filing
// shape and not a degenerate one. Dropping the follow-row rule to reach those
// filings is not the fix: that rule is the only thing standing between a data row
// and the header slot, and losing it reopens the mis-mapped-column failure this
// whole layout is built around. A repeated tuple is STRICTER evidence, not
// looser: a data row does not print itself verbatim twice, because its item
// number, its description and its vote all change from row to row, while a per-
// meeting grammar reprints its column labels character for character. So a
// candidate is confirmed when the identical normalised header tuple occurs at
// least twice in the document AND at least one of those occurrences has a
// governed row under it in its own table, and every occurrence opens its own
// block with its own meeting context. The governed-row half is what keeps the
// witness honest: without it a tuple that recurs with nothing beneath it -- a
// banner, a legend -- is accepted as a header for a document that prints no
// rows it could possibly head.
//
// The witnesses are tried cheapest-first: the lookahead is bounded by
// htmlHeaderLookahead rows, while the repeat scan costs one extra pass over the
// body and is therefore asked last and only once per filing.
//
// carry reports that this header may outlive its own </table>. ONLY the
// follow-row witness can grant it, and only when the rows that confirmed the
// header were themselves found beyond that boundary. Repetition says a row is a
// label rather than data; it says nothing about which table's rows that label
// governs, so a repeat-confirmed header dies with its table like any other.
func htmlHeaderMapping(cells []string, feed *htmlRowFeed, inTable bool, repeats *htmlHeaderRepeats) (mapping map[string]int, carry, ok bool) {
	mapping, key, ok := htmlHeaderShape(cells)
	if !ok {
		return nil, false, false
	}
	var below, crossed bool
	if !inTable {
		below, crossed = htmlHasTableBelow(len(cells), feed)
	}
	if inTable || below || repeats.has(key) {
		htmlAdoptUnlabelledItem(cells, mapping, feed)
		return mapping, below && crossed, true
	}
	return nil, false, false
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
		if htmlLooksLikeValue(flat) {
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

// htmlScanRepeatedHeaders walks the body once more with a FRESH feed -- the main
// pass's cursor has already moved and its lookahead buffer is live -- and returns
// the set of shape-passing tuples that are printed at least twice AND govern a
// row under at least one of those occurrences.
//
// Repetition alone is not enough. It proves a row is a LABEL rather than data,
// which is what a one-proposal-per-meeting filing needs; it does not prove the
// label heads a table. A tuple that recurs with nothing beneath any occurrence is
// a page banner or a column legend, and accepting it hands a mapping to a
// document that never printed a governed row -- the exact "confidently wrong
// rows" outcome this layout declines filings to avoid.
func htmlScanRepeatedHeaders(body []byte) map[string]bool {
	feed := &htmlRowFeed{src: body}
	counts := make(map[string]int)
	governs := make(map[string]bool)
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
		if !governs[key] && htmlGovernsARow(len(row.cells), feed) {
			governs[key] = true
		}
	}
	repeated := make(map[string]bool, len(counts))
	for key, n := range counts {
		if n >= 2 && governs[key] {
			repeated[key] = true
		}
	}
	return repeated
}

// htmlGovernsARow reports whether a governed row follows this occurrence inside
// its OWN table: comparable arity, and not itself header-shaped.
//
// Both exclusions are load-bearing. Stopping at the boundary is what keeps the
// witness from reaching into the next table for its evidence -- that is the same
// leak read the other way round. Skipping header-shaped rows is what keeps the
// second printing of a repeated banner from counting as the first's data: the
// two have identical arity by construction, so without this a banner printed
// twice in a row would witness itself.
func htmlGovernsARow(arity int, feed *htmlRowFeed) bool {
	for i := 0; i < htmlHeaderLookahead; i++ {
		row, ok := feed.peek(i)
		if !ok || row.newTable {
			return false
		}
		if !htmlComparableArity(len(row.cells), arity) {
			continue
		}
		if _, _, isHeader := htmlHeaderShape(row.cells); isHeader {
			continue
		}
		return true
	}
	return false
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
	if len(flat) > htmlLabelMaxLen {
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

// htmlIsCUSIP reports whether a token has the shape of a security identifier:
// nine alphanumerics carrying at least one digit. That is the token that turned
// `TMB | CUSIP 87974D100 | Voted` into a false header.
func htmlIsCUSIP(tok string) bool {
	if len(tok) != 9 {
		return false
	}
	digits := 0
	for i := 0; i < len(tok); i++ {
		c := tok[i]
		switch {
		case c >= '0' && c <= '9':
			digits++
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z':
		default:
			return false
		}
	}
	return digits > 0
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
		"BALLOT ISSUE", "AGENDA", "ITEM DESC", "ITEM DESCRIPTION",
		"PROPOSAL DESCRIPTION", "MEETING AGENDA",
		// "PROPOSAL TYPE" is the description column of the 81-filing
		// `Proposal Type | Voted? | Vote | For/Agnst Mgmt` shape, which prints
		// no other column naming what was voted on. Reading it as the PROPOSER
		// left that shape one field short of the header test and skipped all 81.
		"PROPOSAL TYPE",
	},
	htmlFieldBy: {
		"PROPOSED BY", "PROPONENT", "PRPNENT", "SPONSOR", "AUTHOR",
	},
	htmlFieldMgmtRec: {
		"MGT REC", "MGMT REC", "MANAGEMENT REC", "MANAGEMENT RECOMMENDATION",
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
		"FOR/AGAINST MANAGEMENT", "FOR/AGNST MGMT", "WITH MGMT",
		"FOR AGAINST MANAGEMENT", "WITH MANAGEMENT",
	},
	htmlFieldTicker: {"TICKER", "SYMBOL", "TICKER SYMBOL"},
	htmlFieldCUSIP:  {"CUSIP", "SECURITY ID", "CUSIP NUMBER", "SECURITY IDENTIFIER"},
	htmlFieldMtgDate: {
		"MEETING DATE", "MTG DATE", "DATE OF MEETING",
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
	htmlFieldMtgDate, htmlFieldIssuer,
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
	}

	for i, lab := range canon {
		if lab == "" {
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
	return strings.HasSuffix(s, "?")
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

// htmlCanonLabel renders a header cell as a comparable label: camelCase split so
// "VoteCast" reads as "Vote Cast", uppercased, and punctuation other than '/'
// and '#' folded to a space. '/' survives because "For/Against Management" is a
// real column and '#' because it is the item column of a whole format family.
func htmlCanonLabel(s string) string {
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
	"ISSUER NAME:", "ISSUER:", "MEETING DATE:", "TICKER:",
	"SECURITY ID:", "CUSIP:",
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
	for _, cell := range cells {
		for _, line := range strings.Split(cell, "\n") {
			// The fold is hoisted out of the six-label loop: done inside it, every
			// line of every row of a 155 MB body is uppercased six times over.
			line = strings.TrimSpace(line)
			up := htmlUpperASCII(line)
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
				switch label {
				case "ISSUER NAME:", "ISSUER:":
					if ctx.Issuer == "" {
						ctx.Issuer = htmlFlat(v)
					}
				case "MEETING DATE:":
					if ctx.MeetingDate == "" {
						ctx.MeetingDate = htmlDate(v)
					}
				case "TICKER:":
					if ctx.Ticker == "" {
						ctx.Ticker = htmlValueOrEmpty(v)
					}
				case "SECURITY ID:", "CUSIP:":
					if ctx.CUSIP == "" {
						ctx.CUSIP = htmlValueOrEmpty(v)
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

// htmlIsIssuerLine reports whether an unlabelled line can be read as a block's
// issuer. Anything value-shaped -- a date, a vote, a CUSIP, a signature
// paragraph, anything longer than a column label -- is refused, leaving the
// issuer blank. A blank issuer is a gap; a wrong one is a vote booked against a
// company that never held the meeting.
func htmlIsIssuerLine(s string) bool {
	flat := htmlFlat(s)
	return flat != "" && !htmlLooksLikeValue(flat)
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
	if d := brDate(s); d != "" {
		return d
	}
	return issDate(s)
}

// htmlDataRow renders one table row through the header's column mapping. Cells
// are taken POSITIONALLY by the header's index, which is the whole point of
// reading the raw markup. A row carrying no vote is table furniture -- a spacer
// or a subtotal -- and emitting it as a vote record would put a non-vote into
// the how_voted column.
func htmlDataRow(cells []string, mapping map[string]int, ctx htmlContext) (VoteRow, bool) {
	at := func(field string) string {
		i, ok := mapping[field]
		if !ok || i >= len(cells) {
			return ""
		}
		return htmlFlat(cells[i])
	}

	vote := at(htmlFieldVote)
	if vote == "" {
		return VoteRow{}, false
	}
	item, desc := at(htmlFieldItem), at(htmlFieldDesc)
	if item == "" && desc == "" {
		return VoteRow{}, false
	}

	r := VoteRow{
		IssuerName:               ctx.Issuer,
		CUSIP:                    ctx.CUSIP,
		Ticker:                   ctx.Ticker,
		MeetingDate:              ctx.MeetingDate,
		ItemSeq:                  item,
		VoteDescription:          desc,
		VoteSource:               at(htmlFieldBy),
		HowVoted:                 vote,
		ManagementRecommendation: at(htmlFieldMgmtRec),
	}

	// A table that prints its own identity columns overrides the block context
	// for that row: the row is the more specific statement.
	if v := at(htmlFieldIssuer); v != "" {
		r.IssuerName = v
	}
	if v := htmlValueOrEmpty(at(htmlFieldCUSIP)); v != "" {
		r.CUSIP = v
	}
	if v := htmlValueOrEmpty(at(htmlFieldTicker)); v != "" {
		r.Ticker = v
	}
	if v := htmlDate(at(htmlFieldMtgDate)); v != "" {
		r.MeetingDate = v
	}

	// series_id is deliberately NOT set. The chassis stamps it when the header
	// declares exactly one series; guessing which fund a table belongs to would
	// move one fund's votes onto another, which is far worse than a blank.
	return r, true
}
