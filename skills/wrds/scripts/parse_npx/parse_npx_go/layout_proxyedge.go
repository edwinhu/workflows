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
	"PROPOSED BY":    peBy,
	"VOTE":           peVote,
	"VOTE CAST":      peVote,
	// Whether the fund's ballot agreed with management -- a restatement of the
	// vote read against the proponent, not the vote itself and not a count. It
	// is in the vocabulary only so the band walk does not break on it and so
	// peVoteRow steps over its cell positionally; peVoteRow reads it into no
	// field (Guinness Atkinson 2017's `Item | Proposal | Proposed by | Vote |
	// For/Against Management` band).
	"FOR/AGAINST MANAGEMENT": peAgree,
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
	"PRIMARY ISIN": true, "MEETING TYPE": true, "MEETING DATE": true,
	"RECORD DATE": true, "PROPONENT": true, "PROPOSAL NUMBER": true,
	"PROPOSAL CODE CATEGORY": true, "PROPOSAL TEXT": true,
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
	peAgree       = "agree"
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
//
// The run test is anchored on cells the vendor printed ENTIRE, so a paragraph
// wrapped TWO lines to a container offers it no anchor anywhere and nothing here
// can mark one. peItemCell reads that shape off the line the paragraph broke on
// instead.
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
			// The run is a paragraph. Its END is where peWrapContinues lost the
			// thread, which is not the same place the paragraph ends: the test is
			// indexed on the PAIR, so one line whose own tail reads as a sentence's
			// close (`Company)`) parts the paragraph into two runs, and the line
			// after it becomes a run's first line, which nothing below marks. Past
			// a paragraph already proven by peWrapRun, the tail is walked with
			// peWrapTail instead, which asks of each line whether IT is a fragment
			// rather than whether its predecessor promised one.
			for end+1 < len(lines) && whole[end+1] && tbl[end+1] == tbl[i] &&
				peWrapTail(lines[end], lines[end+1]) {
				end++
			}
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

// peWrapContinues reports that next carries on the sentence prev broke off:
// prev ended on a word rather than on a sentence's close, and next opens where a
// name does not. A lower-case opener says that outright -- the 2012 filing's
// proposals are mixed-case prose and every continuation of them opens on a
// lower-case word. So does an opener that is not a letter at all: a wrap that
// lands inside a quoted or parenthesised phrase prints a line beginning `"TRUST
// DEED")`, and this vendor's fund and issuer banners are names, which never open
// on punctuation.
//
// An UPPER-CASE opener is the one shape a banner shares, because some templates
// print a long proposal's text ALL-CAPS or Capitalised (Guinness Atkinson's
// foreign-market ballots from 2012 through 2016 -- Singapore, Hong Kong and
// Russian resolutions -- print it ALL-CAPS, and the wrap lands on `ISSUED),`).
// There the shape of the line itself has to part the two: a banner is a NAME,
// printed short and carrying no clause punctuation, while a line the vendor's
// column ended rather than its own text is long and carries the marks of the
// sentence it is a piece of. The last line of a wrapped paragraph is short by
// construction, so a lower-case or punctuation opener is the only one this
// admits under peWrapWidth.
func peWrapContinues(prev, next string) bool {
	if prev == "" || next == "" {
		return false
	}
	if c := prev[len(prev)-1]; peWordBreak(c) && c != ',' && c != ';' && c != '-' && c != '\'' {
		return false
	}
	if peWrapOpens(next) {
		return true
	}
	return peWrapLine(next) && peWrapClause(next)
}

// peWrapOpens reports a line opening where a name does not: on a lower-case
// word, or on something that is not a letter at all. The vendor's fund and
// issuer banners are names, and a name opens upper-case.
func peWrapOpens(s string) bool {
	c := s[0]
	return c < 'A' || c > 'Z'
}

// peWrapTail reports that next is still inside a paragraph peWrapRun has
// already proven, having walked to prev. peWrapContinues answers a harder
// question -- may a run START here -- and to answer it safely it reads prev's
// tail, refusing any successor to a line the vendor's column happened to break
// after a close-paren or a period. Inside a paragraph already established that
// tail says much less: a resolution enumerates counterparties `(Open Joint
// Stock Company)` and cites `U.S. Dollars` mid-sentence, and the line after
// either is prose, not the banner of a fund.
//
// So the tail is walked on the SUCCESSOR's shape. A line that opens where a
// name does not is a fragment however prev ended (Guinness Atkinson 2012 item
// 9, `regarding receipt by OAO Gazprom of funds with a`). An upper-case opener
// is the shape a banner shares, and two things part it from one here: the
// banner is a name, printed short, so a long line is already unlike one; and a
// paragraph's last line is short by construction, so a long line standing after
// ANOTHER long line that broke off mid-word -- no punctuation ended it at all
// -- is the next line of that same break, not a heading the vendor printed
// between two ballots (item 10, `Gazprom of funds with a maximum amount of one
// billion`, which carries none of the `;:()"` peWrapClause demands).
func peWrapTail(prev, next string) bool {
	if peWrapContinues(prev, next) {
		return true
	}
	if prev == "" || next == "" || !peWrapLine(next) {
		return false
	}
	if peWrapOpens(next) {
		return true
	}
	return peWrapLine(prev) && !peWordBreak(prev[len(prev)-1])
}

// peWrapClause reports the punctuation a clause of a proposal carries and a
// name printed as a banner does not. The vendor's fund and issuer banners are
// names -- `Guinness Atkinson Asia Pacific Dividend Builder Fund`, `CAPITALAND
// MALL TRUST, SINGAPORE` -- and what little punctuation they carry is a comma
// or a period; a resolution's text enumerates, quotes and parenthesises.
func peWrapClause(s string) bool {
	return strings.ContainsAny(s, ";:()\"")
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
// then EITHER carry at least two disposition columns -- one alone could be a
// tally rather than a ballot -- OR name the vote outright in a single vote
// column. The second shape has no share counts at all (foreign ballots, where
// the `Vote` cell carries `For`/`Against` verbatim), so the disposition rule
// can never be satisfied by it; a lone tally column still cannot pass, because
// a tally is a disposition and one disposition is still one.
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
	desc, dispositions, votes := false, 0, 0
	for _, lab := range h.labels {
		switch peVocabulary[strings.ToUpper(lab)] {
		case peDesc:
			desc = true
		case peDisposition:
			dispositions++
		case peVote:
			votes++
		}
	}
	if !desc || (dispositions < 2 && !(dispositions == 0 && votes == 1)) {
		return nil
	}
	return h
}

// peSummaryHeaderAt returns the number of lines the summary grid's header band
// at i occupies, or 0 when there is none there. The band opens on the
// issuer-name column, runs over CELLS of the summary vocabulary in one table,
// and must name at least peSummaryColumns of them.
//
// The band is read one CELL at a time, not one line: this vendor hard-wraps a
// column label inside its own <td> exactly as it wraps a proposal's text
// (Aspiriant Trust 2023 prints `<B>Company` / `Name</B>`, and every one of that
// grid's seven labels is wrapped that way), and a band read line-wise breaks on
// the first half of the first label -- leaving the grid's own body unmarked, so
// that every data cell in it is offered to the bare-heading scan. A proposal
// cell reaching that scan is taken for a fund banner the moment its prose
// happens to carry a fund word (`... Procedures for Lending Funds to Other
// Parties ...` blanked the series on all 1,133 rows of that filing).
//
// The count returned stays a LINE count: it is what peSummaryBody steps over to
// reach the body, and a wrapped band occupies more lines than it names columns.
func peSummaryHeaderAt(lines []string, run []int, tbl []int, i int) int {
	if run[i] != i {
		return 0
	}
	if opener, _ := peCellAt(lines, run, i); !peSummaryOpener[strings.ToUpper(opener)] {
		return 0
	}
	n, columns := 0, 0
	for k := i; k < len(lines) && tbl[k] == tbl[i] && run[k] == k; {
		cell, end := peCellAt(lines, run, k)
		if !peSummaryVocabulary[strings.ToUpper(cell)] {
			break
		}
		columns++
		n += end - k + 1
		k = end + 1
	}
	if columns < peSummaryColumns {
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
func peSummaryBody(lines []string, run []int, tbl []int) []bool {
	out := make([]bool, len(lines))
	for i := 0; i < len(lines); i++ {
		n := peSummaryHeaderAt(lines, run, tbl, i)
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
		// Dispatch keeps the colon. Inside a filing already known to be this
		// vendor's a bare `Security` is unambiguous, but as the test that
		// CLAIMS a document for this layout it would be one common English
		// word standing alone, so the colon-less spelling is read only after
		// the match, not to make it.
		if !identity && strings.HasSuffix(lines[i], ":") {
			if _, ok := peIdentityLabel(lines[i]); ok {
				identity = true
			}
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

// peItemNumber reports a cell that prints a ballot's item number: one short
// token carrying a digit, which is what parts `1`, `4` and `2a` from the
// sentence a wrapped resolution's tail puts in the same position. It is asked
// only of the band that names its vote and counts nothing, where there is no
// share count to refuse a non-row with.
func peItemNumber(s string) bool {
	v := strings.TrimSpace(s)
	if v == "" || len(v) > 8 || strings.ContainsAny(v, " \t") {
		return false
	}
	return strings.ContainsAny(v, "0123456789")
}

// peFundName reports a line that names a fund. The vendor prints the fund
// heading and the issuer heading identically -- both are bare lines above the
// identity labels -- so the fund is told from the issuer by its own name.
//
// A name is also told from a SENTENCE by its shape, which is what peBallotProse
// asks first: a cell carrying a fund word may still be a ballot's own
// resolution text rather than a banner the vendor printed.
func peFundName(s string) bool {
	if peBallotProse(s) {
		return false
	}
	up := strings.ToUpper(s)
	for _, w := range []string{"FUND", "PORTFOLIO", "TRUST", "ETF", "SERIES"} {
		if peFundWord(up, w) {
			return true
		}
	}
	return false
}

// peHeadingRunes and peHeadingWords are the most a fund banner runs to. The
// longest names this vendor prints are of the order of `Guinness Atkinson Asia
// Pacific Dividend Builder Fund` (51 characters, 7 words) and
// `Investment Managers Series Trust - AXS Sustainable Income Fund`; the
// resolutions that defect here run to thousands of characters, because they are
// paragraphs.
const (
	peHeadingRunes = 90
	peHeadingWords = 14
)

// peBallotProse reports a whole cell that reads as a ballot's own text rather
// than as the NAME of a fund. peWholeCells, peSummaryBody and peWrappedProse
// each disqualify a cell by where it stands -- hard-wrapped, inside a summary
// grid's body, a fragment of a paragraph broken across containers -- and none of
// them can reach a genuine whole, un-wrapped cell that the vendor printed as one
// wide <td> of prose. That is how a foreign ballot's resolution arrives
// (CapitaLand Mall Trust's general mandate in Guinness Atkinson Funds 2017 is
// one 2.4 KB cell, and `THE TRUST DEED DATED 29 OCTOBER 2001` inside it
// satisfies peFundWord), and taking one for a banner clears the section's fund
// and blanks the series for every row after it.
//
// What parts the two is the shape of the text, not its words. A banner is a
// name: short, a handful of words, no clause punctuation and no enumeration. A
// resolution is a sentence: long, and it semicolons, quotes and numbers its own
// sub-paragraphs.
func peBallotProse(s string) bool {
	if len([]rune(s)) > peHeadingRunes || len(strings.Fields(s)) > peHeadingWords {
		return true
	}
	// A semicolon parts one clause of a resolution from the next, and a quote
	// opens a defined term (`(THE "TRUST DEED")`). A fund's name carries neither.
	if strings.ContainsAny(s, ";\"") {
		return true
	}
	return peClauseNumber(s)
}

// peClauseNumber reports the parenthesised enumerator a resolution numbers its
// sub-paragraphs with -- `(1)`, `(A)`, `(II)`. A fund name parenthesises only
// words (`(Class A)`, `(formerly ABC Fund)`), so only a SHORT parenthesis
// counts, and it must not merely be a number the name itself carries in a
// longer phrase.
//
// Short is not enough on its own. A short alphanumeric parenthesis is also how
// this vendor prints two things that number nothing: the account or ticker code
// glued to the end of a fund's name (`Aspiriant Risk-Managed Global Equity Fund
// (GMV)`), and the English plural marker inside its own field labels
// (`Institution Account(s):`). Aspiriant Trust's 2017 N-PX carries both on the
// one line that is the whole document's only route to a fund, and taking that
// line for a ballot's prose blanked all 4,059 of its rows. So the test is the
// FORM an enumerator actually takes -- digits, one ordinal letter, or a roman
// numeral -- rather than the length of the run.
func peClauseNumber(s string) bool {
	for off := 0; off < len(s); {
		open := strings.IndexByte(s[off:], '(')
		if open < 0 {
			return false
		}
		open += off
		shut := strings.IndexByte(s[open:], ')')
		if shut < 0 {
			return false
		}
		if peEnumerator(s[open+1 : open+shut]) {
			return true
		}
		off = open + 1
	}
	return false
}

// peEnumerator reports the three forms a resolution's sub-paragraph label takes
// inside its parentheses:
//
//	(1), (12)     a numbered clause -- digits alone
//	(A), (a), (i) a lettered clause -- ONE letter, and never `s`, which is the
//	              plural marker the vendor glues to a label's own word
//	(II), (IV)    a roman ordinal -- and a GENUINE one, so a code that merely
//	              borrows roman letters (`(MVC)`) is refused along with one that
//	              carries a letter no roman numeral holds (`(GMV)`)
//
// Everything else -- a two-to-four letter account or ticker code at the end of a
// name, a word, anything mixing letters and digits -- numbers nothing.
func peEnumerator(s string) bool {
	if s == "" {
		return false
	}
	if peDigits(s) {
		return true
	}
	if len(s) == 1 {
		c := s[0]
		if c == 's' || c == 'S' {
			return false
		}
		return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z'
	}
	return peRoman(s)
}

// peDigits reports a run of decimal digits alone.
func peDigits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return len(s) > 0
}

// peRoman reports a valid roman numeral in canonical form -- thousands, then
// hundreds, then tens, then units, each written the way the numeral system
// writes it. Membership in the alphabet I V X L C D M is NOT enough: `MVC` and
// `IIII` are made only of roman letters and neither is a number, and an account
// code that happens to avoid the other twenty letters must not read as one. The
// case must be uniform, since the vendor's codes are all-caps and a resolution's
// ordinals are written one way within a document.
func peRoman(s string) bool {
	lower := s == strings.ToLower(s)
	upper := s == strings.ToUpper(s)
	if !lower && !upper {
		return false
	}
	rest := strings.ToUpper(s)
	// Each group is read greedily, longest form first; what a group cannot
	// account for is left for the next, and anything left at the end is not a
	// numeral.
	for _, group := range [][]string{
		{"MMM", "MM", "M"},
		{"CM", "CD", "DCCC", "DCC", "DC", "D", "CCC", "CC", "C"},
		{"XC", "XL", "LXXX", "LXX", "LX", "L", "XXX", "XX", "X"},
		{"IX", "IV", "VIII", "VII", "VI", "V", "III", "II", "I"},
	} {
		for _, form := range group {
			if strings.HasPrefix(rest, form) {
				rest = rest[len(form):]
				break
			}
		}
	}
	return rest == ""
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

// peItemCell reports that `heading` stands INSIDE a ballot row already open
// under a header band rather than being a heading the vendor printed between two
// rows. The claim is about the ballot line `heading` stands in, so both lines
// must stand in the same table run: a count in the PREVIOUS table is the tail of
// a ballot that closed with `</table>`, and the centred banner the vendor prints
// between two sections is a fund heading, not the continuation of a row (CSOP
// ETF Trust 2016 opens each of its three sleeves that way, and reading table 1's
// last `Take No Action` count as this heading's item cell stamped all three
// sleeves with sleeve 1's series).
//
// Two shapes of open row are recognised, and line i -- the line before the
// heading -- is what tells them apart.
//
// A bare item number, or any share count, is the cell that opens such a row, so
// whatever follows it is one of that row's own columns.
//
// A line the vendor's COLUMN broke off mid-sentence says the same thing about
// the Proposal column: the row is open and the heading is a further container of
// its resolution text. Some templates print that text as sibling containers of
// two physical lines each (Guinness Atkinson Funds 2009 prints YANZHOU COAL's
// item 4 as sixteen such <div>s, breaking on the bare word `of` before
// `Insurance Fund Administrative` / `Services Agreement`). peWrappedProse cannot
// reach that shape -- it anchors its runs on cells the vendor printed entire and
// a paragraph wrapped two lines to a container has none -- so without this the
// fragment satisfies peFundName and clears the section's fund for every row
// after it.
//
// What the vendor prints ahead of a real banner is none of these: a table
// boundary, an identity label, an issuer's name, a count, or a heading of its
// own. A banner that OPENS its table is already refused by the table test above.
//
// Neither shape reaches the SECOND continuation row of a run, which is what
// peBandCell is for.
func peItemCell(lines []string, tbl []int, i, heading int, labels []string) bool {
	if labels == nil || i < 0 || tbl[i] != tbl[heading] {
		return false
	}
	if _, ok := peCount(lines[i]); ok {
		return true
	}
	return peBrokenOffMidWord(lines[i])
}

// peBandCell reports that `heading` stands inside the proposal grid itself --
// the very table the open header band was printed in -- and so is one column of
// one of that grid's rows rather than a heading the vendor printed between them.
//
// This is peItemCell's claim made of a CONTINUATION RUN instead of an immediate
// predecessor. This vendor wraps a long proposal over several ITEM ROWS, each
// printing an empty Item cell and the next slice of the description. peItemCell
// holds on the FIRST such row, whose predecessor is the wrapped row's own item
// number; it cannot hold on the SECOND, whose predecessor is the first
// continuation cell's prose -- upper case, finished on a word, neither a count
// nor broken off mid-word -- and an empty Item cell leaves no line at all for it
// to look at, since peCellLines drops a blank cell. Two Roads Shared Trust 2021
// wraps ZHUZHOU CRRC TIMES ELECTRIC's proposal 29 that way, and `FROM
// APPROPRIATING / FUNDS` carries a fund word: read as a banner it cleared the
// section's series for the 730 rows after it, a regression that arrived with the
// joining of hard-wrapped cells.
//
// The row structure that would settle it is gone by this point, so the table
// stands in for it: inside the grid every cell is a column of some row, because
// the grid holds the ballot's rows and nothing else. A banner between two
// sections is printed outside that table (Two Roads prints its `Registrant:`
// banner in a table of its own), which is the same boundary peItemCell's own
// table test already rests on -- so a real banner is untouched by this.
func peBandCell(tbl []int, band, heading int, labels []string) bool {
	return labels != nil && band >= 0 && tbl[heading] == band
}

// peNumberedRowCell reports that `heading` is the cell standing immediately
// after an item NUMBER in the same table -- the Proposal column of a numbered
// ballot row -- whether or not a header band was ever read for that grid.
//
// peItemCell asks the same question of the same predecessor but only under an
// open band, and peBandCell needs a band to have been read at all: both are
// silent in a grid whose header row this layout never recognised. This vendor
// prints such a grid (First Investors Life Series Funds 2012 prints its first
// ballot table with no header row of its own), so every cell of it is reached by
// the heading scans with labels still nil, and a two-line-wrapped proposal there
// -- `Amend` / `Sasol Inzalo Foundation Trust Deed` -- satisfies peFundName and
// clears the section's banner for every row after it.
//
// The item number is the structural evidence, not the vocabulary: a bare count
// standing in the cell before this one, inside the same table, is the ballot's
// own numbering, and what follows it is that ballot's description. A banner the
// vendor printed between two sections never has one before it -- it stands
// outside the grid's table (BBH Trust prints its wrapped banner in a div between
// two tables, after the registrant name), which the table test refuses.
func peNumberedRowCell(lines []string, tbl []int, i, heading int) bool {
	if i < 0 || tbl[i] != tbl[heading] {
		return false
	}
	_, ok := peCount(lines[i])
	return ok
}

// peBrokenOffMidWord reports a line the vendor's column ended rather than its
// own text: it closes on a lower-case letter, so no punctuation finished it and
// the word it closes on is not the last word of a name. peWrapContinues asks a
// wider question of the same tail -- it admits a comma, a semicolon and a hyphen
// -- because it is walking a run already known to be prose; here the tail is the
// ONLY evidence, so only the shape that cannot be anything else counts.
func peBrokenOffMidWord(s string) bool {
	if s == "" {
		return false
	}
	c := s[len(s)-1]
	return c >= 'a' && c <= 'z'
}

// peIdentityLabel reports a line that opens a ballot's identity block, and
// returns the label's own name with the colon taken off.
//
// The colon is the vendor's ordinary spelling but not its only one: from its
// later template onward the same block prints `Security` / `Ticker Symbol` /
// `Meeting Date` bare (Guinness Atkinson 2017, from the Asia Pacific section
// onward, in the same filing whose first section printed them with colons).
// The colon-less form is accepted only for THIS closed set of names, which is
// what keeps the issuer scan's guard intact: what the scan needs of the cell
// below a heading is that it be one of these labels, and the colon was never
// more than one way of telling that. Any other bare cell is still no label, so
// a heading standing above ordinary prose is still not an issuer.
func peIdentityLabel(line string) (string, bool) {
	name := strings.ToUpper(strings.TrimSuffix(line, ":"))
	switch name {
	case "TICKER", "TICKER SYMBOL", "SECURITY", "SECURITY ID",
		"SECURITY ID ON BALLOT", "ISIN", "MEETING DATE", "MEETING TYPE":
		return name, true
	}
	return "", false
}

// peFieldLabel reports a label name the label branch of parseProxyEdge has a
// case for, and so the only names for which a colon-terminated cell may consume
// the cell after it as its value.
//
// The colon alone is not evidence of a label. `ITEM 1. PROXY VOTING RECORD:` is
// the N-PX item heading -- a document marker printed once on the cover page, not
// a field -- and Two Roads Shared Trust 2021 prints it in the cell immediately
// above section 1's `Registrant:` banner. Read as a label it swallowed that
// banner as its value, no case matched, and the whole section's 573 rows kept
// the fund the cover page's agent-for-service paragraph had left behind. An
// unrecognised colon cell has no value to take: it falls through as an ordinary
// cell and the cell after it is read on its own terms.
func peFieldLabel(name string) bool {
	switch name {
	case "TICKER", "TICKER SYMBOL", "SECURITY", "SECURITY ID",
		"SECURITY ID ON BALLOT", "ISIN", "MEETING DATE", "MEETING TYPE",
		"FUND NAME", "PORTFOLIO NAME", "REGISTRANT":
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
	summary := peSummaryBody(lines, run, tbl)
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
		// band is the table the open header band was printed in, i.e. the
		// proposal grid whose rows are being read. Every cell inside it is one
		// column of one row, which is what tells a wrapped proposal's
		// continuation cell from a fund banner (peBandCell).
		band = -1
	)

	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if h := peHeaderAt(lines, i); h != nil {
			labels = h.labels
			band = tbl[i]
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
		if !strings.HasSuffix(line, ":") && run[i] == i && cellEnd > i {
			if _, ok := peIdentityLabel(cell); ok {
				labelText, labelEnd = cell, cellEnd
			}
		}
		// A label is a cell ending in a colon, or one of the identity labels
		// this vendor also prints without one -- and in either spelling only a
		// name the switch below has a case for, since an unrecognised label
		// consuming the next cell hides whatever the vendor printed there
		// (peFieldLabel).
		label, isLabel := "", false
		if strings.HasSuffix(labelText, ":") {
			if name := strings.ToUpper(strings.TrimSuffix(labelText, ":")); peFieldLabel(name) {
				label, isLabel = name, true
			}
		} else if name, ok := peIdentityLabel(labelText); ok && run[i] == i {
			label, isLabel = name, true
		}
		if isLabel {
			i = labelEnd
			value := ""
			if i+1 < len(lines) && peHeaderAt(lines, i+1) == nil {
				next, nextEnd := peCellAt(lines, run, i+1)
				// A label's value is never another label. With the colon gone
				// that test cannot be the colon's absence: this block leaves a
				// label empty whenever the ballot carries no such id (the
				// foreign ballots print `Ticker Symbol` with nothing under it),
				// and reading the NEXT label as the value would eat that
				// label's own value one cell later.
				_, nextIsLabel := peIdentityLabel(next)
				if !strings.HasSuffix(next, ":") && !nextIsLabel {
					value = next
					i = nextEnd
				}
			}
			switch label {
			case "TICKER", "TICKER SYMBOL":
				ticker = value
			case "SECURITY", "SECURITY ID", "SECURITY ID ON BALLOT":
				cusip = value
			case "ISIN":
				isin = value
			case "MEETING DATE":
				mtgDate = htmlDate(value)
			case "MEETING TYPE":
				mtgType = value
			case "FUND NAME", "PORTFOLIO NAME":
				// The same section banner the bare-heading scan below reads,
				// printed instead as a label cell and a value cell
				// (`<TD><B>Fund Name:</B></TD><TD COLSPAN="3"><B>...</B></TD>`,
				// Investment Managers Series Trust 2018). The label branch has
				// already consumed the value, so the bare-heading scan never
				// sees it; without this case the value is dropped and every row
				// keeps the registrant-level fund the cover page left behind.
				if name := strings.TrimSpace(value); name != "" {
					fund = name
					fundSeries = icrResolveFundShared(seriesIx, name)
					if fundSeries == "" {
						fundSeries = htmlDictionaryFund(seriesIx, dict, name)
					}
				}
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
			next, _ := peCellAt(lines, run, cellEnd+1)
			if _, ok := peIdentityLabel(next); ok {
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
		// Nor is any cell of the open proposal grid itself: the second and later
		// continuation rows of a wrapped proposal are reached by neither of the
		// two tests above, so the grid's own table is the boundary (peBandCell).
		if whole[i] && !summary[i] && !wrapped[i] && !peItemCell(lines, tbl, i-1, i, labels) &&
			!peBandCell(tbl, band, i, labels) && peFundName(line) {
			fund = line
			fundSeries = icrResolveFundShared(seriesIx, line)
			if fundSeries == "" {
				fundSeries = htmlDictionaryFund(seriesIx, dict, line)
			}
			continue
		}
		// The same bare heading, printed by a vendor that hard-wrapped it inside
		// ONE container: `BBH` / `INTERNATIONAL EQUITY FUND` is a single div of
		// two source lines, so peWholeCells marks neither of them whole and the
		// test above cannot fire on either half. The heading is the cell, not
		// the line -- which is how the issuer scan above already reads exactly
		// this shape -- so the cell is joined and the name tested against the
		// JOIN. Only the cell's own start line may open it, and only a cell of
		// two lines: three or more is the paragraph run peWrappedProse refuses,
		// and reading a fragment of one as a name is the defect that gate
		// exists for. Every guard above is asked of the START line, as the
		// issuer scan asks them.
		// A section that prints its own name a second time -- this vendor
		// repeats it inside the sub-adviser stack under the banner, in a
		// different case -- is not opening a new section, so the banner's own
		// spelling stands rather than the restatement's.
		// Nor is the Proposal column of a numbered ballot row in a grid whose
		// header row was never read: with labels still nil neither peItemCell
		// nor peBandCell can refuse it, so the item number before it does
		// (peNumberedRowCell).
		if run[i] == i && cellEnd == i+1 && !summary[i] && !wrapped[i] &&
			!peItemCell(lines, tbl, i-1, i, labels) && !peBandCell(tbl, band, i, labels) &&
			!peNumberedRowCell(lines, tbl, i-1, i) && peFundName(cell) {
			if fund != "" && normalizeSeriesName(cell) == normalizeSeriesName(fund) {
				i = cellEnd
				continue
			}
			fund = cell
			fundSeries = icrResolveFundShared(seriesIx, cell)
			if fundSeries == "" {
				fundSeries = htmlDictionaryFund(seriesIx, dict, cell)
			}
			i = cellEnd
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
	// A band with no disposition column at all is the vote-named shape
	// peHeaderAt admits alongside the counted one: the vote came straight from
	// the `Vote` cell above and there is no share count to report, so
	// shares_voted stays empty.
	//
	// That shape has no counts, so it also loses what the count check above is
	// doing for every other band: REFUSING the cells that are not a row. The
	// vendor prints a wrapped resolution's tail, and its `CMMT` note, as <tr>s
	// of fewer cells, and consumed positionally either one reads as a ballot
	// whose item cell is a sentence and whose columns are the NEXT row's. What
	// stands in for the count here is the two cells the shape does define: the
	// vote column prints its value verbatim, so a cell there naming no vote is
	// not this band's row, and the item column prints a number. (Without the
	// first, the tail of item 3 claims item 4's cells and item 4 is never read;
	// without the second, the tail of item 4 claims the `CMMT` note's, emitting
	// a ballot whose description is `CMMT` and eating the next issuer's banner
	// as its last column.)
	if dispositions == 0 && (!htmlIsVoteValue(row.HowVoted) || !peItemNumber(row.ItemSeq)) {
		return VoteRow{}, i, false
	}
	if row.ItemSeq == "" || row.VoteDescription == "" {
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
