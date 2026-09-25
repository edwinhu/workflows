package main

import "strings"

// proxyedge reads the Broadridge ProxyEdge ballot-detail export as rendered by
// Vintage Filings' EDGARizerAgent (144 filings, 372 MB, every one recorded as
// `skip` before 2026-09-19). Every logical column is one <td> wrapping a
// <div><font>, so after stripHTML the whole grid arrives ONE CELL PER LINE:
//
//	Guinness Atkinson Alternative Energy Fund
//	ENERGY DEVELOPMENT (EDC) CORPORATION
//	Ticker:
//	Meeting Date:
//	29-Jul-2010
//	Item / Proposal / Recommendation / For / Against / Abstain / Take No Action
//	1 / Call to order / For / 16068000 / 0 / 0 / 0
//
// htmltable cannot map this header because it names no vote column: `For` and
// `Against` here are SHARE-COUNT columns, not vote values, and the fund's ballot
// is the count under whichever disposition it was cast in. THE VOTE IS THE LABEL
// OF THE COLUMN CARRYING THE COUNT -- verbatim, as the filing spells it -- and
// the count is the shares voted. The management recommendation is a separate
// column and is never read as the vote.

// peVocabulary is the header band's whole vocabulary. A band is a RUN of
// consecutive non-blank lines every one of which is in it, which is what parts
// the header from the numbered row underneath: the row's first cell is an item
// number and belongs to no vocabulary.
var peVocabulary = map[string]string{
	"ITEM":           peItem,
	"ITEM NUMBER":    peItem,
	"PROPOSAL":       peDesc,
	"AGENDA ITEM":    peDesc,
	"RECOMMENDATION": peMgmtRec,
	"MGMT REC":       peMgmtRec,
	"MANAGEMENT":     peMgmtRec,
	"TYPE":           peBy,
	"PROPONENT":      peBy,
	"VOTE":           peVote,
	"VOTE CAST":      peVote,
	// The broker's standing instruction on this ballot -- what would have been
	// cast absent one. It is neither the management recommendation nor the
	// fund's ballot, so it has a role of its own and peVoteRow reads it into no
	// field (Cullen Funds Trust 2017 and the vendor's later template).
	"DEFAULT VOTE": peDefault,
	// The ballot dispositions. Each is a share-count column and its label is
	// what how_voted carries when the count is non-zero.
	"FOR":              peDisposition,
	"AGAINST":          peDisposition,
	"ABSTAIN":          peDisposition,
	"WITHHOLD":         peDisposition,
	"WITHHELD":         peDisposition,
	"TAKE NO ACTION":   peDisposition,
	"DO NOT VOTE":      peDisposition,
	"BROKER NON-VOTES": peDisposition,
	"NON-VOTE":         peDisposition,
	"UNVOTED":          peDisposition,
}

// peSummaryVocabulary is the header band of the OTHER grid these filings carry:
// a plain HTML summary whose FIRST column is the issuer's own name, one ballot
// per <tr>, with no identity block anywhere in it. Its columns are the ballot's
// facts spread sideways -- ticker, country, security id, meeting type and date
// -- where the ProxyEdge template prints them stacked as `Ticker:` /
// `Security:` labels above the grid.
var peSummaryVocabulary = map[string]bool{
	"COMPANY NAME": true, "ISSUER NAME": true, "SECURITY NAME": true,
	"TICKER": true, "COUNTRY": true, "SECURITY ID": true, "CUSIP": true,
	"PROVIDER SECURITY ID": true, "SECURITY ID ON BALLOT": true, "ISIN": true,
	"MEETING TYPE": true, "MEETING DATE": true, "RECORD DATE": true,
	"PROPONENT": true, "PROPOSAL NUMBER": true, "PROPOSAL TEXT": true,
	"PROPOSAL": true, "MANAGEMENT RECOMMENDATION": true, "VOTE INSTRUCTION": true,
	"VOTED": true, "VOTE AGAINST MANAGEMENT": true, "SHARES VOTED": true,
	"SHARES ON LOAN": true, "VOTE CAST": true,
}

// peSummaryOpener is the column a summary band must open on. It is the one that
// says the grid's rows are ISSUERS: a band that merely carries a ticker and a
// meeting date is the stacked identity block, not this grid.
var peSummaryOpener = map[string]bool{
	"COMPANY NAME": true, "ISSUER NAME": true, "SECURITY NAME": true,
}

// peSummaryColumns is the least a band must carry before its table's rows are
// read as this grid's. The real header prints fourteen.
const peSummaryColumns = 6

const (
	peItem        = "item"
	peDesc        = "desc"
	peMgmtRec     = "mgmtrec"
	peBy          = "by"
	peVote        = "vote"
	peDefault     = "default"
	peDisposition = "disposition"
)

func init() {
	entry := layoutEntry{Name: "proxyedge", Match: matchProxyEdge, ParseRaw: parseProxyEdge,
		// The first ballot sits behind a cover page; 16 MB is what the sibling
		// text layouts use.
		HeadBytes: 16 << 20}
	for i, candidate := range layoutRegistry {
		if candidate.Name == "htmltable" {
			layoutRegistry = append(layoutRegistry, layoutEntry{})
			copy(layoutRegistry[i+1:], layoutRegistry[i:])
			layoutRegistry[i] = entry
			return
		}
	}
	layoutRegistry = append(layoutRegistry, entry)
}

// peNonBlank returns the document's non-blank lines with their text trimmed.
// The markup leaves a blank line between every cell, and they carry nothing.
func peNonBlank(text string) []string {
	var out []string
	for _, l := range strings.Split(text, "\n") {
		if t := strings.TrimSpace(l); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// peCellLines returns the layout's line stream and, for each line, the index of
// the first line of the CELL it belongs to and the ordinal of the TABLE RUN it
// stands in -- the stretch of the document between two <table> boundaries, which
// is the widest span a guard about one ballot may read. It reads the marked
// strip, whose
// container boundaries are the only record of where one <td> ends: after
// stripHTML a hard-wrapped cell and a run of whole cells look alike, because
// <BR> emits a break and the source newline that follows it emits a second, so
// each wrap line stands alone between blank lines exactly as a cell does (CSOP
// ETF Trust 2016 wraps every proposal that way, and the wrap line `SECURITY
// FUND AND LISTING ON THE HONG` was read as a fund banner on 17,653 rows). A
// blank line INSIDE a container is therefore part of its cell and does not end
// it; only a container boundary does.
//
// Before the document's first boundary there are no containers -- that is the
// SGML envelope, which carries no block markup -- so a blank line parts the
// lines there, as it does for the whole stream when a body prints none.
func peCellLines(marked string) ([]string, []int, []int) {
	var (
		lines   []string
		run     []int
		tbl     []int
		start   = -1
		inCells bool
		table   int
	)
	for _, l := range strings.Split(marked, "\n") {
		t := strings.TrimSpace(l)
		if t == cellMark || t == tableMark {
			if t == tableMark {
				table++
			}
			inCells = true
			start = -1
			continue
		}
		if t == "" {
			if !inCells {
				start = -1
			}
			continue
		}
		if start < 0 {
			start = len(lines)
		}
		lines = append(lines, t)
		run = append(run, start)
		tbl = append(tbl, table)
	}
	return lines, run, tbl
}

// peWholeCells reports, for each line, whether it is a cell ENTIRE -- the only
// line of its own cell. A cell the vendor hard-wrapped over several lines names
// nothing by its head or its tail, so no heading scan may fire on one.
func peWholeCells(run []int) []bool {
	out := make([]bool, len(run))
	for i := range run {
		if run[i] == i && (i+1 >= len(run) || run[i+1] != i) {
			out[i] = true
		}
	}
	return out
}

// peWrapWidth is the least width a line must carry before a run of them reads
// as a paragraph the vendor wrapped at a fixed column. A fund banner is a name
// and is printed short; the wrapped proposals that defect here run to sixty
// characters a line because the column, not the sentence, ends them.
const peWrapWidth = 40

// peWrapRun is the least number of consecutive lines such a paragraph must
// carry. Two lines are how this vendor hard-wraps an ordinary cell -- a fund
// name over `Guinness Atkinson Global` / `Energy Fund`, an issuer over
// `NOVOLIPETSK` / `STEEL` -- and those are already one cell by their container.
const peWrapRun = 3

// peWrappedProse reports, for each line, whether it is a CONTINUATION line of a
// paragraph the vendor wrapped across several containers. Some templates print
// a long proposal's text as one <div> PER PHYSICAL LINE inside a single <td>
// (Guinness Atkinson Funds 2012 wraps Canadian Natural's item 18 over seven of
// them). Each of those divs IS a container, so peCellLines parts them and
// peWholeCells calls every one of them a cell entire -- the protection those two
// give a <BR>-wrapped cell cannot reach a cell wrapped this way, because the
// markup no longer says where the <td> ended.
//
// What still says it is the shape of the run: a paragraph broken at a column
// prints several long lines in a row, and every line after the first opens
// mid-sentence, on a lower-case word that the line before it did not finish. A
// heading never opens that way -- the vendor's fund and issuer banners are names
// standing alone in their own cell -- so a line that does is a fragment of the
// cell above it, whatever words it happens to carry, and no heading scan may
// fire on one.
//
// Only the continuations are marked, never the run's first line: that line does
// begin a cell, and a banner the vendor happened to print above a wrapped
// paragraph is still a banner.
func peWrappedProse(lines []string, tbl []int, whole []bool) []bool {
	out := make([]bool, len(lines))
	for i := 0; i < len(lines); i++ {
		if !whole[i] || !peWrapLine(lines[i]) {
			continue
		}
		end := i
		for end+1 < len(lines) && whole[end+1] && tbl[end+1] == tbl[i] &&
			peWrapContinues(lines[end], lines[end+1]) {
			end++
		}
		if end-i+1 >= peWrapRun {
			for k := i + 1; k <= end; k++ {
				out[k] = true
			}
		}
		i = end
	}
	return out
}

// peWrapLine reports a line long enough to have been ended by the column rather
// than by its own text.
func peWrapLine(s string) bool {
	return len([]rune(s)) >= peWrapWidth
}

// peWrapContinues reports that next carries on the sentence prev broke off: prev
// ended on a word rather than on a sentence's close, and next opens on a
// lower-case word rather than on a name. The last line of a wrapped paragraph is
// short by construction, so it is the only one this admits under peWrapWidth.
func peWrapContinues(prev, next string) bool {
	if prev == "" || next == "" {
		return false
	}
	if c := prev[len(prev)-1]; peWordBreak(c) && c != ',' && c != ';' && c != '-' && c != '\'' {
		return false
	}
	if c := next[0]; c < 'a' || c > 'z' {
		return false
	}
	return true
}

// peCellAt returns the whole text of the cell beginning at line i and the index
// of its last line. Two Roads 2021 wraps `NOVOLIPETSK` / `STEEL`, `Meeting` /
// `Type:` and `ExtraOrdinary` / `General Meeting` this way, and neither half of
// such a pair names anything on its own.
func peCellAt(lines []string, run []int, i int) (string, int) {
	end := i
	for end+1 < len(lines) && run[end+1] == run[i] {
		end++
	}
	if end == i {
		return lines[i], i
	}
	return strings.Join(lines[i:end+1], " "), end
}

// peHeader is one header band: its labels, one per logical column, and the
// number of physical lines they were read from. The two differ when the vendor
// wrapped a label across two cells.
type peHeader struct {
	labels   []string
	consumed int
}

// peHeaderAt returns the header band starting at i, or nil when there is none
// there. The band must open on the item column, name what was voted on, and
// carry at least two disposition columns -- one alone could be a tally rather
// than a ballot.
func peHeaderAt(lines []string, i int) *peHeader {
	if role, ok := peVocabulary[strings.ToUpper(lines[i])]; !ok || role != peItem {
		return nil
	}
	h := &peHeader{}
	for k := i; k < len(lines); k++ {
		if _, ok := peVocabulary[strings.ToUpper(lines[k])]; ok {
			h.labels = append(h.labels, lines[k])
			h.consumed++
			continue
		}
		// Some filers wrap one label onto two cells (`Take No` / `Action`,
		// `Default` / `Vote`), which otherwise cuts the band short of the
		// disposition columns. A line outside the vocabulary is one such half
		// when joining it to the next line lands inside it.
		if k+1 < len(lines) {
			joined := lines[k] + " " + lines[k+1]
			if _, ok := peVocabulary[strings.ToUpper(joined)]; ok {
				h.labels = append(h.labels, joined)
				h.consumed += 2
				k++
				continue
			}
		}
		break
	}
	desc, dispositions := false, 0
	for _, lab := range h.labels {
		switch peVocabulary[strings.ToUpper(lab)] {
		case peDesc:
			desc = true
		case peDisposition:
			dispositions++
		}
	}
	if !desc || dispositions < 2 {
		return nil
	}
	return h
}

// peSummaryHeaderAt returns the number of lines the summary grid's header band
// at i occupies, or 0 when there is none there. The band opens on the
// issuer-name column, runs over whole cells of the summary vocabulary in one
// table, and must name at least peSummaryColumns of them.
func peSummaryHeaderAt(lines []string, tbl []int, whole []bool, i int) int {
	if !whole[i] || !peSummaryOpener[strings.ToUpper(lines[i])] {
		return 0
	}
	n := 0
	for k := i; k < len(lines) && tbl[k] == tbl[i] && whole[k]; k++ {
		if !peSummaryVocabulary[strings.ToUpper(lines[k])] {
			break
		}
		n++
	}
	if n < peSummaryColumns {
		return 0
	}
	return n
}

// peSummaryBody reports, for each line, whether it stands in the BODY of a
// summary grid -- after that grid's own header band and before its table
// closes. Every cell there is a data cell of an ordinary ballot row, so the
// first of them is the ISSUER's name however many fund words that corporate
// name carries (Aspiriant Trust 2016 votes `Daito Trust Construction Co. Ltd.`,
// and taking it for a fund banner blanked the section's series for every row
// after it). The existing issuer guard cannot reach these: it recognises only
// the stacked spelling, where an identity label follows the name.
//
// Only the body is marked, never the whole run: a vendor that prints the fund
// banner as a spanning row ABOVE this header is still naming a fund there.
func peSummaryBody(lines []string, tbl []int, whole []bool) []bool {
	out := make([]bool, len(lines))
	for i := 0; i < len(lines); i++ {
		n := peSummaryHeaderAt(lines, tbl, whole, i)
		if n == 0 {
			continue
		}
		for k := i + n; k < len(lines) && tbl[k] == tbl[i]; k++ {
			out[k] = true
		}
		i += n - 1
	}
	return out
}

// matchProxyEdge requires BOTH halves of this vendor's grammar: the ballot
// header band, and the identity block it prints one label per line above it.
// The band alone is not enough. `Item | Proposal | Recommendation | Default
// Vote | For | Against | Abstain | Take No Action` is also how a filer lays out
// a plain HTML tally table whose share counts belong to no ballot of the
// fund's, and reading the heading of the column carrying the count as the vote
// would be inventing one there. The label-per-line identity block -- `Ticker:`,
// `Security:`, `Meeting Date:` each alone on their own cell -- is what says the
// counts under those headings are this ballot's.
func matchProxyEdge(head string) bool {
	lines := peNonBlank(head)
	band, identity := false, false
	for i := range lines {
		if !band && peHeaderAt(lines, i) != nil {
			band = true
		}
		if !identity && peIdentityLabel(lines[i]) {
			identity = true
		}
		if band && identity {
			return true
		}
	}
	return false
}

// peCount reads a share count, which the vendor prints with or without group
// separators. A cell that is not a count is not a ballot column value.
func peCount(s string) (string, bool) {
	v := strings.ReplaceAll(strings.TrimSpace(s), ",", "")
	if v == "" {
		return "", false
	}
	for i := 0; i < len(v); i++ {
		if v[i] < '0' || v[i] > '9' {
			return "", false
		}
	}
	return v, true
}

// peFundName reports a line that names a fund. The vendor prints the fund
// heading and the issuer heading identically -- both are bare lines above the
// identity labels -- so the fund is told from the issuer by its own name.
func peFundName(s string) bool {
	up := strings.ToUpper(s)
	for _, w := range []string{"FUND", "PORTFOLIO", "TRUST", "ETF", "SERIES"} {
		if peFundWord(up, w) {
			return true
		}
	}
	return false
}

// peFundWord reports that w stands as a WORD of up, not merely as a substring
// of one. It is still never the first word -- the vendor's fund names carry a
// brand ahead of the fund word -- so a space must precede it, and nothing that
// glues it into a longer word may follow: `Trust-Type` in a proposal's text is
// not the word `Trust` (Aspiriant Trust 2016 prints seven such proposals inside
// the grid the bare-heading scan reads, and each one taken for a banner blanked
// the section's series for every row after it). The plural is the same word.
func peFundWord(up, w string) bool {
	for off := 0; off+len(w) <= len(up); {
		j := strings.Index(up[off:], w)
		if j < 0 {
			return false
		}
		k := off + j
		end := k + len(w)
		if end < len(up) && up[end] == 'S' && !strings.HasSuffix(w, "S") {
			end++
		}
		if k > 0 && peSpace(up[k-1]) && (end == len(up) || peWordBreak(up[end])) {
			return true
		}
		off = k + 1
	}
	return false
}

// peSpace reports the blank the fund word stands behind.
func peSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\v' || c == '\f'
}

// peWordBreak reports a byte that ends a word. A hyphen and an apostrophe do
// not: they bind what stands on either side of them into one word.
func peWordBreak(c byte) bool {
	switch {
	case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9':
		return false
	case c == '-' || c == '\'' || c == '_':
		return false
	}
	return true
}

// peRegistrantFund reads the fund out of a `Registrant:` banner, which this
// vendor prints as `<REGISTRANT NAME> - <FUND NAME>`. The right-hand side is
// the fund, and it is taken only when the left-hand side is the registrant's
// own name -- otherwise the banner is handed over whole, since nothing says
// which side of the dash is the brand. A banner naming the registrant alone
// names no fund and leaves the section's fund where it was.
func peRegistrantFund(value, company string) string {
	v := strings.TrimSpace(value)
	if v == "" {
		return ""
	}
	if k := strings.LastIndex(v, " - "); k >= 0 {
		left, right := strings.TrimSpace(v[:k]), strings.TrimSpace(v[k+3:])
		if right != "" && normalizeSeriesName(left) == normalizeSeriesName(company) {
			return right
		}
	}
	if normalizeSeriesName(v) == normalizeSeriesName(company) {
		return ""
	}
	return v
}

// peItemCell reports that line i is a bare item number printed under a header
// band -- the cell that opens a ballot row, whatever follows it. The claim is
// about the ballot line `heading` stands in, so both lines must stand in the
// same table run: a count in the PREVIOUS table is the tail of a ballot that
// closed with `</table>`, and the centred banner the vendor prints between two
// sections is a fund heading, not the continuation of a row (CSOP ETF Trust
// 2016 opens each of its three sleeves that way, and reading table 1's last
// `Take No Action` count as this heading's item cell stamped all three sleeves
// with sleeve 1's series).
func peItemCell(lines []string, tbl []int, i, heading int, labels []string) bool {
	if labels == nil || i < 0 || tbl[i] != tbl[heading] {
		return false
	}
	_, ok := peCount(lines[i])
	return ok
}

// peIdentityLabel reports a line that opens a ballot's identity block.
func peIdentityLabel(line string) bool {
	if !strings.HasSuffix(line, ":") {
		return false
	}
	switch strings.ToUpper(strings.TrimSuffix(line, ":")) {
	case "TICKER", "SECURITY", "SECURITY ID", "SECURITY ID ON BALLOT", "ISIN",
		"MEETING DATE", "MEETING TYPE":
		return true
	}
	return false
}

// parseProxyEdge reads the raw markup rather than the stripped text: this is a
// <table> grammar, and which lines belong to which cell is a fact only the
// markup holds.
func parseProxyEdge(raw []byte, _ string, meta FilingMeta) ([]VoteRow, error) {
	lines, run, tbl := peCellLines(string(stripHTMLCells(raw)))
	whole := peWholeCells(run)
	summary := peSummaryBody(lines, tbl, whole)
	wrapped := peWrappedProse(lines, tbl, whole)
	seriesIx := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))
	issFormerKeys(seriesIx, meta.FormerNames)
	dict := cikDict.exactFallback(meta)

	var (
		rows       []VoteRow
		fund       string
		fundSeries string
		issuer     string
		ticker     string
		cusip      string
		isin       string
		mtgDate    string
		mtgType    string
		labels     []string
	)

	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if h := peHeaderAt(lines, i); h != nil {
			labels = h.labels
			i += h.consumed - 1
			continue
		}
		cell, cellEnd := peCellAt(lines, run, i)
		// A label on its own cell, its value on the next. A label whose next
		// cell is another label was printed empty, which is normal: a foreign
		// ballot carries a security id and no ticker. The label and the value
		// are each read whole, since this vendor hard-wraps either of them
		// across source lines (`Meeting` / `Type:`).
		labelText, labelEnd := line, i
		if !strings.HasSuffix(line, ":") && run[i] == i && cellEnd > i && peIdentityLabel(cell) {
			labelText, labelEnd = cell, cellEnd
		}
		if strings.HasSuffix(labelText, ":") {
			label := strings.ToUpper(strings.TrimSuffix(labelText, ":"))
			i = labelEnd
			value := ""
			if i+1 < len(lines) && peHeaderAt(lines, i+1) == nil {
				next, nextEnd := peCellAt(lines, run, i+1)
				if !strings.HasSuffix(next, ":") {
					value = next
					i = nextEnd
				}
			}
			switch label {
			case "TICKER":
				ticker = value
			case "SECURITY", "SECURITY ID", "SECURITY ID ON BALLOT":
				cusip = value
			case "ISIN":
				isin = value
			case "MEETING DATE":
				mtgDate = htmlDate(value)
			case "MEETING TYPE":
				mtgType = value
			case "REGISTRANT":
				// The banner that opens a section. It names the section's fund
				// outright, so it overrides whatever the bare-heading scan took
				// before it -- on the cover page that is the agent-for-service
				// paragraph, which names no fund -- and it re-seeds at every
				// section, not once per document.
				if name := peRegistrantFund(value, meta.CompanyName); name != "" {
					fund = name
					fundSeries = icrResolveFundShared(seriesIx, name)
					if fundSeries == "" {
						fundSeries = htmlDictionaryFund(seriesIx, dict, name)
					}
				}
			}
			continue
		}
		if labels != nil && run[i] == i {
			if row, rowEnd, ok := peVoteRow(lines, run, i, labels); ok {
				row.IssuerName = issuer
				row.Ticker = ticker
				row.CUSIP = icrCUSIP(cusip)
				if isin != "" {
					row.ISIN = isin
				} else {
					row.ISIN = icrISIN(cusip)
				}
				row.MeetingDate = mtgDate
				row.MeetingType = mtgType
				row.FundName = fund
				row.SeriesID = fundSeries
				rows = append(rows, row)
				i = rowEnd
				continue
			}
		}
		// The issuer heading is the bare line standing above the ballot's
		// identity block. Requiring that block to follow is what tells it from
		// the other bare cells this template prints between ballots -- the
		// agenda number, its proponent, the meeting date range -- each of which
		// would otherwise be taken for a new issuer and wipe the identity.
		// This runs BEFORE the fund test because an issuer whose own name
		// carries a fund word -- a real estate investment TRUST -- is still the
		// issuer, and taking it for a fund would wipe the fund for the rest of
		// the filing. The heading is the whole CELL: the tail of a hard-wrapped
		// cell is not a heading, and the reset below must never fire on one.
		if run[i] == i && cellEnd+1 < len(lines) {
			if next, _ := peCellAt(lines, run, cellEnd+1); peIdentityLabel(next) {
				issuer = cell
				ticker, cusip, isin, mtgDate, mtgType = "", "", "", "", ""
				i = cellEnd
				continue
			}
		}
		// A bare heading. The vendor prints the fund above its ballots and the
		// issuer above each one, with nothing to mark either.
		// Only a whole cell can be a heading, and never the cell that follows
		// an item number under an open band IN THE SAME TABLE: that pair is a
		// ballot row whose description peVoteRow refused, not a fund the vendor
		// printed. Across a table boundary the pair is two different ballots.
		// Nothing inside a summary grid's body is a heading at all: every cell
		// there is one column of one ballot row, the first of them the issuer's
		// own name.
		// Nor is a continuation line of a paragraph the vendor wrapped across
		// several containers: peWholeCells cannot tell one from a cell, so
		// peWrappedProse tells it from the run's shape instead. Such a line is
		// reached at all only because peVoteRow refused the row it splits, and
		// clearing the open fund on a sentence fragment blanks the series for
		// every row after it.
		if whole[i] && !summary[i] && !wrapped[i] && !peItemCell(lines, tbl, i-1, i, labels) && peFundName(line) {
			fund = line
			fundSeries = icrResolveFundShared(seriesIx, line)
			if fundSeries == "" {
				fundSeries = htmlDictionaryFund(seriesIx, dict, line)
			}
			continue
		}
	}

	if len(rows) == 0 {
		return nil, errLayoutDeclined
	}
	return rows, nil
}

// peVoteRow reads one ballot row: len(labels) consecutive cells, positional
// against the header. The vote is the LABEL of the disposition column carrying
// a non-zero count, verbatim, and that count is the shares voted. It returns
// the index of the last LINE the row consumed, which is not i+len(labels)-1
// whenever the vendor hard-wrapped a cell across lines.
func peVoteRow(lines []string, run []int, i int, labels []string) (VoteRow, int, bool) {
	cells := make([]string, 0, len(labels))
	pos := i
	for range labels {
		if pos >= len(lines) {
			return VoteRow{}, i, false
		}
		cell, end := peCellAt(lines, run, pos)
		cells = append(cells, cell)
		pos = end + 1
	}
	row := VoteRow{}
	var votedLabel, votedShares string
	var dispositions int
	for k, label := range labels {
		switch peVocabulary[strings.ToUpper(label)] {
		case peItem:
			row.ItemSeq = cells[k]
		case peDesc:
			row.VoteDescription = cells[k]
		case peMgmtRec:
			row.ManagementRecommendation = cells[k]
		case peBy:
			row.VoteSource = cells[k]
		case peVote:
			row.HowVoted = cells[k]
		case peDisposition:
			n, ok := peCount(cells[k])
			if !ok {
				return VoteRow{}, i, false
			}
			dispositions++
			if n != "0" && votedLabel == "" {
				votedLabel, votedShares = label, n
			}
		}
	}
	if dispositions == 0 || row.ItemSeq == "" || row.VoteDescription == "" {
		return VoteRow{}, i, false
	}
	if row.HowVoted == "" {
		if votedLabel == "" {
			// Every disposition is zero: the ballot was reported and nothing was
			// cast. how_voted is verbatim by contract, so it stays empty rather
			// than being filled with an inferred value.
			return VoteRow{}, i, false
		}
		row.HowVoted = votedLabel
		row.SharesVoted = votedShares
	}
	return row, pos - 1, true
}
