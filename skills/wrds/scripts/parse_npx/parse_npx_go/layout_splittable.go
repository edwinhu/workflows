package main

import (
	"bytes"
	"strings"
)

// splittable reads the grammar in which ONE logical vote is SPLIT ACROSS
// PARALLEL TABLES and joined by LINE POSITION inside a page group:
//
//	<TABLE>
//	<CAPTION>
//	Institutional Account ID  Institutional Account Name  Company Name  Ticker  Country
//	------------------------  --------------------------  ------------  ------  -------
//	<S>                       <C>                         <C>           <C>     <C>
//	905284                    Hirtle Callaghan Value ...   Office Depot  ODP     USA
//	</TABLE>
//	<TABLE>
//	...
//	Institutional Account ID  Proposal Number  Proposal Text  Management Recommendation  Vote Instruction
//	905284                    1a               Elect Director Roland C. Smith  For       For
//	</TABLE>
//
// No table holds a whole vote: the issuer is in the first, the meeting in the
// second, the proposal and the vote in the third. Line n of each table is the
// same vote, and a cell too wide for its column is printed on the line ABOVE its
// row while every other table of the group leaves that line BLANK -- which is
// what keeps the join positional rather than semantic.
//
// Measured 2026-08-31: about 28 filings, 60 MB and more each, every one recorded
// as `skip`. testdata/icr/ICR3_foreign_header.txt is a verbatim excerpt of this
// family's nine-column header and is kept as the fixture proving icr must
// DECLINE it -- read under icr's rules it produced 1,882 rows whose how_voted
// held description text such as `Elect Director Orlando D. Ashford`.
//
// THIS LAYOUT READS THE RAW BYTES, not the normalized text, and that is not an
// optimization. collapseSpaces squeezes every horizontal run to two spaces, so
// by the time a line reaches a Parse layout the column offsets are gone -- and
// the offsets are the only thing that says which column an EMPTY cell belongs
// to. A cell-count split reads a row with a blank Ticker as a row whose Country
// is its ticker.

// spRoles are the column meanings this layout knows, keyed by the label the
// table's own header prints. ROLES COME FROM THE HEADER, NEVER FROM POSITION:
// the tables of one group carry between two and nine columns each and the same
// width means nothing across them.
//
// A label absent from this map is carried by no field. `Voted`, `Vote Against
// Management`, `Ballot Status`, `Meeting ID`, `Country` and the account id and
// number are all deliberately unmapped -- they are real columns of the report
// with no home in the vote schema, and inventing one for them would put
// non-votes into vote fields.
var spRoles = map[string]string{
	"INSTITUTIONAL ACCOUNT NAME": spFund,
	"COMPANY NAME":               spIssuer,
	"ISSUER NAME":                spIssuer,
	"TICKER":                     spTicker,
	"TICKER SYMBOL":              spTicker,
	"SECURITY ID":                spCUSIP,
	"PROVIDER SECURITY ID":       spCUSIP,
	"PRIMARY SECURITY ID":        spCUSIP,
	"MEETING TYPE":               spMeetingType,
	"MEETING DATE":               spMeetingDate,
	"RECORD DATE":                spRecordDate,
	"VOTABLE SHARES":             spSharesTotal,
	"SHARES VOTED":               spShares,
	"PROPONENT":                  spProponent,
	"PROPOSAL NUMBER":            spItem,
	"ITEM NUMBER":                spItem,
	"PROPOSAL TEXT":              spDescription,
	"PROPOSAL":                   spDescription,
	// The ProxyEdge text report's name for the proponent column, which holds
	// `Management` or `Shareholder`. Its neighbour `Against Mgmt.` stays
	// deliberately unmapped: the schema has no with/against-management field,
	// and filing a Yes/No into a vote field would be worse than dropping it.
	"PROPOSAL TYPE":             spProponent,
	"PROPOSAL CODE CATEGORY":    spCategory,
	"MANAGEMENT RECOMMENDATION": spMgmtRec,
	// The banner-stripped Investment Company Report spells the recommended
	// vote `RV` and prints it beside `Vote Cast`.
	"RV":                 spMgmtRec,
	"VOTE INSTRUCTION":   spVote,
	"VOTING INSTRUCTION": spVote,
	"VOTE CAST":          spVote,
	"HOW VOTED":          spVote,
}

const (
	spFund        = "fund"
	spIssuer      = "issuer"
	spTicker      = "ticker"
	spCUSIP       = "cusip"
	spMeetingType = "meeting_type"
	spMeetingDate = "meeting_date"
	spRecordDate  = "record_date"
	spShares      = "shares_voted"
	spSharesTotal = "shares_voted_total"
	spProponent   = "proponent"
	spItem        = "item"
	spDescription = "description"
	spCategory    = "category"
	spMgmtRec     = "mgmt_rec"
	spVote        = "vote"
)

// spSignatures are the labels that name this family. They are the join key's own
// column heading, which every filing of the family prints above every page.
var spSignatures = []string{"institutional account name", "institutional account id"}

func init() {
	entry := layoutEntry{Name: "splittable", Match: matchSplitTable, ParseRaw: parseSplitTableRaw,
		// The first table sits behind a cover page and the SEC's Item 1
		// instructions, and these filings run to 60 MB. 16 MB is what the sibling
		// text layouts use. PER-LAYOUT, never signatureHeadBytes: raising that
		// globally changes WHICH layout wins a filing and was measured at a net
		// loss of 5,673 rows.
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

// spProxyEdgeBanner is the second signature of this family: Broadridge's
// fixed-width "Investment Company Report", the plain-text sibling of the HTML
// ProxyEdge grid layout_proxyedge.go reads. It prints neither of the
// institutional-account headings, so it needs its own banner; both words are
// required, since `ProxyEdge` alone also heads the HTML grid.
var spProxyEdgeBanner = []string{"proxyedge -"}

func spIsProxyEdgeText(text string) bool {
	return containsAnyFolded(text, spProxyEdgeBanner) &&
		containsAnyFolded(text, []string{"investment company report"})
}

// spIsVoteGroupText is the third signature of this family: the same Broadridge
// fixed-width Investment Company Report with the vendor banner stripped, so
// neither `ProxyEdge -` nor `Investment Company Report` is printed anywhere.
// What it does still print is the block delimiter this reader already keys on,
// `Vote Group:`, above the rule-cut `Proposal Number` column header. Both are
// required: `Vote Group:` alone also appears in reports another layout claims.
func spIsVoteGroupText(text string) bool {
	return containsAnyFolded(text, []string{"vote group:"}) &&
		containsAnyFolded(text, []string{"proposal number"})
}

// spIsTextReport reports whether the document is one of the two fixed-width
// Broadridge text reports, which are read through the stacked-header path
// rather than the rule-cut one.
func spIsTextReport(text string) bool {
	return spIsProxyEdgeText(text) || spIsVoteGroupText(text)
}

func matchSplitTable(head string) bool {
	return containsAnyFolded(head, spSignatures) || spIsTextReport(head)
}

// spSpan is one column as the table's own rule line draws it.
type spSpan struct{ start, end int }

// spTable is one <TABLE> of a page group: the labels its header prints, the
// spans its rule line draws, and its body lines VERBATIM AND IN ORDER, blanks
// included. The blanks are load-bearing -- they are what a wrapped cell in a
// sibling table looks like from here, and dropping them would shift every row
// below onto the wrong vote.
type spTable struct {
	labels []string
	spans  []spSpan
	body   []string
}

// spIndex is the shared fund-name chain this layout resolves an institutional
// account name through: the ISS series index over the header's declarations,
// then the CIK dictionary for the names the header does not declare. The bare
// seriesByName map this layout used before is exact match plus a leading-token
// walk and nothing else, which refuses an account name spelled as the fund's
// FORMER name (`SPDR DJ Wilshire Total Market ETF` for S000006973) and every
// vendor typo the brand rungs absorb.
type spIndex struct {
	ix   *issSeriesIndex
	dict *dictFallback
}

func spSeriesIndex(meta FilingMeta) *spIndex {
	ix := newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))
	issFormerKeys(ix, meta.FormerNames)
	return &spIndex{ix: ix, dict: cikDict.exactFallback(meta)}
}

func (s *spIndex) resolve(name string) string {
	if id := icrResolveFundShared(s.ix, name); id != "" {
		return id
	}
	if id := htmlDictionaryFund(s.ix, s.dict, name); id != "" {
		return id
	}
	// A trailing parenthetical on an institutional account name is the SLEEVE --
	// the mandate a sub-adviser runs inside the portfolio -- not part of the
	// series name: `HC Capital Trust - The Small Capitalization Equity Portfolio
	// (Russell 2000 Passive Growth Sleeve)` is S000009380, the portfolio. Retried
	// only when the verbatim name resolves to nothing, and only through the
	// dictionary's exact rungs, never the leading-token walk.
	if head, cut := issCutTrailingParenthetical(name); cut && head != "" && head != name {
		return htmlDictionaryFund(s.ix, s.dict, head)
	}
	return ""
}

func parseSplitTableRaw(raw []byte, _ string, meta FilingMeta) ([]VoteRow, error) {
	var (
		rows      []VoteRow
		group     []spTable
		cur       *spTable
		header    []string
		haveRule  bool
		sawType   bool
		seriesIdx = spSeriesIndex(meta)
		resolved  = map[string]string{}
		ctx       spContext
		groupCtx  spContext
		lastBare  string
		proxyEdge = spIsTextReport(string(raw))
	)

	flush := func() {
		if len(group) > 0 {
			rows = append(rows, spGroupRows(group, seriesIdx, resolved, groupCtx)...)
			group = nil
		}
	}

	for _, raw := range spLines(raw) {
		trimmed := bytes.TrimSpace(raw)

		if cur == nil {
			switch {
			case bytes.EqualFold(trimmed, []byte("<TABLE>")):
				if len(group) == 0 {
					groupCtx = ctx
				}
				cur, header, haveRule, sawType = &spTable{}, nil, false, false
			case len(trimmed) == 0:
				// A blank line separates the tables of one group as readily as it
				// separates two groups; it decides nothing.
			default:
				// ANYTHING ELSE BETWEEN TABLES CLOSES THE GROUP. `<PAGE>` is what
				// this family prints there, but the rule is deliberately not a list
				// of markers: a group whose tables are joined by line position is
				// only meaningful while the tables are adjacent, and a block that
				// stays open across unrelated content is how this parser produced
				// 148,521 bogus rows once already.
				flush()
				// The ISS institutional-account report prints the whole identity
				// of a meeting OUTSIDE the table, as LABEL: VALUE pairs under a
				// bare issuer heading, and its table carries only the proposal
				// columns. Reading the pairs here is what lets that filing keep
				// its issuer, fund, security id and meeting date; a filing whose
				// tables carry those columns themselves is unaffected, because
				// the context only fills a field the columns left empty.
				lastBare = spReadContext(string(trimmed), &ctx, lastBare)
			}
			continue
		}

		if bytes.EqualFold(trimmed, []byte("</TABLE>")) {
			if haveRule {
				group = spAppend(group, *cur, flush)
			}
			cur = nil
			continue
		}
		if bytes.EqualFold(trimmed, []byte("<TABLE>")) {
			// An unclosed table: take what was read and start over rather than
			// letting one table's body run into the next one's.
			if haveRule {
				group = spAppend(group, *cur, flush)
			}
			cur, header, haveRule, sawType = &spTable{}, nil, false, false
			continue
		}

		line := string(raw)
		if !haveRule {
			if spans := spRuleSpans(line); spans != nil {
				cur.spans = spans
				cur.labels = spLabels(header, spans)
				haveRule = true
			} else if proxyEdge && spIsPlainRule(line) {
				// This vendor draws one unbroken rule rather than one dash run
				// per column, so there is nothing to cut on. The stacked column
				// labels immediately above it are: their own text runs, merged
				// where they overlap, are the columns.
				block := spTrailingBlock(header)
				if spans := spHeaderSpans(block); spans != nil {
					if labels := spLabels(block, spans); spHasVote(labels) {
						cur.spans, cur.labels = spans, labels
						haveRule = true
						continue
					}
				}
				header = append(header, line)
			} else if bytes.EqualFold(trimmed, []byte("<CAPTION>")) {
				// furniture
			} else {
				if proxyEdge {
					spReadProxyEdgeHeading(line, &ctx, &groupCtx)
				}
				header = append(header, line)
			}
			continue
		}
		if !sawType && spTypeLine(line) {
			// The SGML `<S> <C> <C>` column-type line, which is furniture.
			sawType = true
			continue
		}
		sawType = true
		cur.body = append(cur.body, line)
	}
	if cur != nil && haveRule {
		group = spAppend(group, *cur, flush)
	}
	flush()

	if len(rows) == 0 {
		// The same ISS institutional-account export printed as FIXED-WIDTH TEXT
		// inside <PRE>, with no <TABLE> of its own for the loop above to open
		// (Lincoln Variable Insurance Products Trust, 150 MB over four filings).
		rows = spInstitutionalPreRows(raw, seriesIdx, resolved)
	}

	if len(rows) == 0 {
		return nil, errLayoutDeclined
	}
	return rows, nil
}

// spInstitutionalPreRows reads the institutional-account report when it is laid
// out as plain fixed-width text rather than as parallel <TABLE>s. There is one
// table per block and it carries the whole vote, so no positional join across
// tables is needed; what has to be read instead is the block's own furniture.
//
//	Institutional Account Name   LVIP BlackRock Dividend Value Managed Volatility
//	Fund
//	Institutional Account Number (All)
//
//	                       Primary                   Proposal          Vote
//	Company Name  Ticker  Security ID  Meeting Date  Number  ...  Instruction
//	------------  ------  -----------  ------------  ------  ---  -----------
//	Alcon Inc.                                       Accept Financial Statements
//	               ALC    H01301128     06-May-20  1  and Statutory Reports  For
//
// The block is keyed on the dashed rule under the stacked column labels, the
// fund comes from the `Institutional Account Name` label INCLUDING the tail it
// wraps onto the line below, and a ballot whose issuer is printed on its own
// line is joined to the row beneath it by spGroupRows' own wrap handling.
func spInstitutionalPreRows(raw []byte, seriesIdx *spIndex, resolved map[string]string) []VoteRow {
	var (
		rows     []VoteRow
		ctx      spContext
		header   []string
		spans    []spSpan
		labels   []string
		body     []string
		lastBare string
		fundTail bool
	)
	flush := func() {
		if len(spans) > 0 && len(body) > 0 {
			rows = append(rows, spGroupRows([]spTable{{labels: labels, spans: spans, body: body}},
				seriesIdx, resolved, ctx)...)
		}
		spans, labels, body, header = nil, nil, nil, nil
	}

	for _, rawLine := range spLines(raw) {
		line := string(rawLine)
		trimmed := strings.TrimSpace(line)

		// A tag line ends the block: the body of one <PRE> never runs into the
		// next, and the SGML header above the first one is not a table.
		if strings.HasPrefix(trimmed, "<") {
			flush()
			fundTail = false
			continue
		}
		if spans != nil {
			if trimmed == "" {
				flush()
				continue
			}
			body = append(body, line)
			continue
		}
		if r := spRuleSpans(line); r != nil {
			block := spTrailingBlock(header)
			if l := spLabels(block, r); spHasVote(l) {
				spans, labels = r, l
				continue
			}
			header = nil
			continue
		}

		if name, ok := spInstitutionalAccountName(line); ok {
			ctx = spContext{fund: name, page: ctx.page}
			if ctx.page == "" {
				ctx.page = lastBare
			}
			fundTail = name != ""
			header = append(header, line)
			continue
		}
		// The account name wraps onto the line below whenever it is wider than
		// the label's own column. Only a lone word run continues it: anything
		// carrying a second column is already the next piece of furniture.
		if fundTail {
			if trimmed != "" && len(spTextRuns(line)) == 1 && !strings.Contains(trimmed, ":") {
				ctx.fund = strings.TrimSpace(ctx.fund + " " + trimmed)
				header = append(header, line)
				continue
			}
			fundTail = false
		}
		if trimmed != "" && len(spTextRuns(line)) == 1 && !strings.Contains(trimmed, ":") {
			lastBare = trimmed
		}
		header = append(header, line)
	}
	flush()
	return rows
}

// spInstitutionalAccountName reads the `Institutional Account Name  <name>`
// label line, whose value starts on the same line. It carries no colon, so
// lvPairs never sees it, and the `Institutional Account Number` line beside it
// must not be read as one.
func spInstitutionalAccountName(line string) (string, bool) {
	const label = "INSTITUTIONAL ACCOUNT NAME"
	t := strings.TrimSpace(line)
	if len(t) < len(label) || !strings.EqualFold(t[:len(label)], label) {
		return "", false
	}
	return strings.TrimSpace(t[len(label):]), true
}

// spAppend adds one finished table to the open group, flushing first when the
// table cannot be parallel to what is already there.
//
// Two tables belong to one group when they share a JOIN KEY -- the same label in
// their first column -- and describe DIFFERENT columns otherwise. A repeated
// non-key label means the report has started printing the same view again, which
// is a new group and not a wider row. Equal body length is the third condition
// and the strictest: a positional join across tables of different heights would
// file one vote's proposal under another vote's issuer, so a mismatch starts a
// new group rather than joining on the shorter of the two.
func spAppend(group []spTable, t spTable, flush func()) []spTable {
	if len(t.labels) == 0 {
		return group
	}
	if len(group) > 0 && spParallel(group, t) {
		return append(group, t)
	}
	flush()
	return []spTable{t}
}

func spParallel(group []spTable, t spTable) bool {
	if group[0].labels[0] != t.labels[0] || len(t.body) != len(group[0].body) {
		return false
	}
	for _, existing := range group {
		for _, l := range existing.labels[1:] {
			for _, candidate := range t.labels[1:] {
				if l != "" && l == candidate {
					return false
				}
			}
		}
	}
	return true
}

// spContext is the identity a report prints BETWEEN its tables rather than in
// them: the issuer heading and the LABEL: VALUE pairs under it.
type spContext struct {
	fund string
	// page is the bare heading the report prints above the page's first rule --
	// the section's own fund banner. The institutional account name below it is
	// an ACCOUNT label and is routinely the fund's former spelling (`SPDR DJ
	// Wilshire Total Market ETF` under a banner reading `SPDR DOW JONES TOTAL
	// MARKET ETF (FORMERLY SPDR DJ WILSHIRE TOTAL MARKET ETF)`), which no index
	// declares. The banner is the filing's own evidence for the same section.
	page    string
	issuer  string
	ticker  string
	cusip   string
	mtgDate string
	mtgType string
}

// spReadContext folds one out-of-table line into the running context and returns
// the new bare-line candidate. The ISSUER is the bare line printed directly above
// the account name, which is the only thing that marks it as a heading; a line
// with a colon is a pair, and a rule or a page marker is furniture.
func spReadContext(line string, ctx *spContext, lastBare string) string {
	if fund, ok := spAccountFund(line); ok {
		ctx.fund = fund
		return lastBare
	}
	if strings.HasPrefix(line, "<") || strings.Trim(line, "- ") == "" {
		if strings.Contains(line, "----") && lastBare != "" {
			ctx.page = lastBare
		}
		return lastBare
	}
	pairs := lvPairs(icrCells(line))
	if len(pairs) == 0 {
		return line
	}
	for _, p := range pairs {
		switch {
		case p.label == "INSTITUTIONAL ACCOUNT NAME":
			// The first pair of a block: everything the previous block left is
			// stale, and the heading above this line is the issuer.
			*ctx = spContext{fund: p.value, page: ctx.page, issuer: lastBare}
		case p.label == "TICKER":
			ctx.ticker = p.value
		case p.label == "MEETING DATE":
			ctx.mtgDate = htmlDate(p.value)
		case strings.HasPrefix(p.label, "SECURITY ID"):
			ctx.cusip = p.value
		case p.label == "SELECTED ACCOUNTS":
			// The ProxyEdge text report names the account this page belongs to
			// in its banner, above every meeting on the page.
			ctx.fund = p.value
		}
	}
	return lastBare
}

// spAccountFund reads the `Account -  <name>` banner the banner-stripped
// Investment Company Report prints above every page's meetings. It carries no
// colon, so lvPairs never sees it.
func spAccountFund(line string) (string, bool) {
	t := strings.TrimSpace(line)
	const prefix = "ACCOUNT -"
	if len(t) <= len(prefix) || !strings.EqualFold(t[:len(prefix)], prefix) {
		return "", false
	}
	name := strings.TrimSpace(t[len(prefix):])
	if name == "" || strings.Contains(name, ":") {
		return "", false
	}
	return name, true
}

// spIsPlainRule recognises the single unbroken dashed rule the ProxyEdge text
// report draws, which spRuleSpans rejects because it cuts no columns.
func spIsPlainRule(line string) bool {
	t := strings.TrimSpace(line)
	return strings.Contains(t, "----") && strings.Trim(t, "- ") == ""
}

// spTrailingBlock returns the run of non-blank header lines nearest the rule --
// the column labels themselves, parted from the block heading above them by the
// blank line the vendor prints between the two.
func spTrailingBlock(header []string) []string {
	end := len(header)
	for end > 0 && strings.TrimSpace(header[end-1]) == "" {
		end--
	}
	start := end
	for start > 0 && strings.TrimSpace(header[start-1]) != "" {
		start--
	}
	return header[start:end]
}

// spHeaderSpans cuts columns from the label lines themselves: each line's runs
// of text, merged across lines wherever they overlap. A label stacked over two
// lines (`Vote` over `Cast`) merges into one span; two labels side by side stay
// apart, because the gap the vendor lays out between columns is wider than any
// word.
func spHeaderSpans(block []string) []spSpan {
	var spans []spSpan
	for _, line := range block {
		for _, r := range spTextRuns(line) {
			merged := false
			for i := range spans {
				if r.start < spans[i].end && spans[i].start < r.end {
					if r.start < spans[i].start {
						spans[i].start = r.start
					}
					if r.end > spans[i].end {
						spans[i].end = r.end
					}
					merged = true
					break
				}
			}
			if !merged {
				spans = append(spans, r)
			}
		}
	}
	if len(spans) < 2 {
		return nil
	}
	for i := 1; i < len(spans); i++ {
		s := spans[i]
		j := i - 1
		for ; j >= 0 && spans[j].start > s.start; j-- {
			spans[j+1] = spans[j]
		}
		spans[j+1] = s
	}
	for i := 1; i < len(spans); i++ {
		if spans[i].start < spans[i-1].end {
			return nil
		}
	}
	return spans
}

// spTextRuns returns the byte spans of one line's text, split on runs of two or
// more spaces -- the same cut spFields makes.
func spTextRuns(line string) []spSpan {
	var out []spSpan
	for i := 0; i < len(line); {
		if line[i] == ' ' || line[i] == '\t' {
			i++
			continue
		}
		start, gap, end := i, 0, i
		for ; i < len(line); i++ {
			if line[i] == ' ' || line[i] == '\t' {
				gap++
				if gap >= 2 {
					break
				}
				continue
			}
			gap = 0
			end = i + 1
		}
		out = append(out, spSpan{start, end})
	}
	return out
}

func spHasVote(labels []string) bool {
	for _, l := range labels {
		if spRoles[l] == spVote {
			return true
		}
	}
	return false
}

// spReadProxyEdgeHeading reads the block identity the ProxyEdge text report
// prints between its two rules: the issuer at column 0, its ticker to the
// right, and `<type> Meeting Date: <date>` last. Only the line carrying the
// meeting date is a heading; the security-id and SEDOL lines below it are
// label:value pairs the schema has no full CUSIP for, and a six-character
// issuer number is not a link key.
func spReadProxyEdgeHeading(line string, ctx, groupCtx *spContext) {
	if fund, ok := spAccountFund(line); ok {
		ctx.fund = fund
		return
	}
	cells := icrCells(strings.TrimSpace(line))
	if len(cells) < 2 || !strings.Contains(cells[len(cells)-1], "Meeting Date:") {
		return
	}
	issuer := strings.TrimSpace(cells[0])
	if issuer == "" || strings.Contains(issuer, ":") {
		return
	}
	ctx.issuer, ctx.ticker, ctx.cusip, ctx.mtgDate = issuer, "", "", ""
	tail := cells[len(cells)-1]
	i := strings.Index(tail, "Meeting Date:")
	ctx.mtgDate = htmlDate(strings.TrimSpace(tail[i+len("Meeting Date:"):]))
	if mt := strings.TrimSpace(tail[:i]); mt != "" {
		ctx.mtgType = mt
	}
	if len(cells) > 2 {
		if t := strings.TrimSpace(cells[1]); t != "" && !strings.Contains(t, ":") {
			ctx.ticker = t
		}
	}
	if ctx.ticker == "" {
		// The banner-stripped template LABELS the ticker (`Ticker:  CNC`)
		// instead of printing it bare in the second column.
		for _, p := range lvPairs(cells[1:]) {
			if p.label == "TICKER" && p.value != "" {
				ctx.ticker = p.value
				break
			}
		}
	}
	fund := groupCtx.fund
	if fund == "" {
		fund = ctx.fund
	}
	*groupCtx = *ctx
	groupCtx.fund = fund
	ctx.fund = fund
}

// spGroupRows joins one page group's parallel tables into votes.
func spGroupRows(group []spTable, seriesIdx *spIndex, resolved map[string]string, ctx spContext) []VoteRow {
	// role -> (table, column). First occurrence wins, so a label repeated across a
	// group that slipped the parallel test cannot silently override the first.
	type at struct{ table, col int }
	where := map[string]at{}
	for ti, t := range group {
		for ci, label := range t.labels {
			role, ok := spRoles[label]
			if !ok {
				continue
			}
			if _, seen := where[role]; !seen {
				where[role] = at{ti, ci}
			}
		}
	}
	// A group with no vote column carries no vote. Reading one out of it would
	// mean choosing a column by position, which is exactly the mistake that made
	// icr's 1,882 wrong rows.
	if _, ok := where[spVote]; !ok {
		return nil
	}

	roleSet := make(map[string]bool, len(where))
	for role := range where {
		roleSet[role] = true
	}

	n := len(group[0].body)
	fields := make([][]string, len(group))
	pending := map[string][]string{}
	var rows []VoteRow

	for k := 0; k < n; k++ {
		for ti := range group {
			fields[ti] = spFields(group[ti].body[k], group[ti].spans)
		}
		value := func(role string) string {
			w, ok := where[role]
			if !ok {
				return ""
			}
			return fields[w.table][w.col]
		}
		// The join key is the first column of the group's first table. A line that
		// does not carry it is the WRAP of the row below: its cells are the leading
		// fragment of that row's cells, in every table at once.
		// A line is a WRAP when it carries no data of its own -- either its join
		// key is blank, or the key column is the ONLY thing on it across every
		// table in the group. The second case is the one ST2 reproduces: this
		// report wraps the KEY ITSELF,
		//
		//	HC Capital Trust The Value
		//	Equity Portfolio                 One Year   One Year   Yes   No
		//
		// so the first line has key text and nothing else, and testing only for a
		// blank key read it as a complete row -- emitting a vote-less row that was
		// dropped and leaving the real row's fund name truncated to `Equity
		// Portfolio`. Requiring every OTHER column to be empty is what separates a
		// key continuation from a short but genuine row.
		if spIsWrapLine(value, roleSet) {
			for role := range where {
				if v := value(role); v != "" {
					pending[role] = append(pending[role], v)
				}
			}
			continue
		}
		joined := func(role string) string {
			v := value(role)
			if frag := pending[role]; len(frag) > 0 {
				v = strings.TrimSpace(strings.Join(frag, " ") + " " + v)
			}
			return v
		}
		row := VoteRow{
			FundName:                 joined(spFund),
			IssuerName:               joined(spIssuer),
			Ticker:                   joined(spTicker),
			CUSIP:                    icrCUSIP(joined(spCUSIP)),
			MeetingType:              joined(spMeetingType),
			MeetingDate:              htmlDate(joined(spMeetingDate)),
			RecordDate:               htmlDate(joined(spRecordDate)),
			ItemSeq:                  joined(spItem),
			VoteDescription:          joined(spDescription),
			VoteCategories:           joined(spCategory),
			VoteSource:               joined(spProponent),
			SharesVoted:              joined(spShares),
			SharesVotedTotal:         joined(spSharesTotal),
			ManagementRecommendation: joined(spMgmtRec),
			HowVoted:                 joined(spVote),
		}
		for role := range pending {
			delete(pending, role)
		}
		// Context fills only what the columns left empty, so a filing whose
		// tables carry their own identity is read exactly as before.
		if row.FundName == "" {
			row.FundName = ctx.fund
		}
		if row.IssuerName == "" {
			row.IssuerName = ctx.issuer
		}
		if row.Ticker == "" {
			row.Ticker = ctx.ticker
		}
		if row.CUSIP == "" {
			row.CUSIP = icrCUSIP(ctx.cusip)
		}
		if row.MeetingDate == "" {
			row.MeetingDate = ctx.mtgDate
		}
		if row.MeetingType == "" {
			row.MeetingType = ctx.mtgType
		}
		// A row with no vote in the vote cell is table furniture -- a spacer or a
		// subtotal -- and emitting it would record a vote the filing never cast.
		if row.HowVoted == "" || (row.ItemSeq == "" && row.VoteDescription == "") {
			continue
		}
		if row.FundName != "" {
			id, seen := resolved[row.FundName]
			if !seen {
				id = seriesIdx.resolve(row.FundName)
				resolved[row.FundName] = id
			}
			// An account label the index does not declare falls back to the
			// section's own printed banner, and only when that banner itself
			// resolves exactly through the same chain.
			if id == "" && ctx.page != "" {
				pid, pseen := resolved[ctx.page]
				if !pseen {
					pid = seriesIdx.resolve(ctx.page)
					resolved[ctx.page] = pid
				}
				id = pid
			}
			row.SeriesID = id
		}
		rows = append(rows, row)
	}
	return rows
}

// spLines splits the raw document into lines without copying it, and without
// materializing a slice of every line in a 60 MB filing.
func spLines(raw []byte) [][]byte {
	out := make([][]byte, 0, bytes.Count(raw, []byte("\n"))+1)
	for len(raw) > 0 {
		i := bytes.IndexByte(raw, '\n')
		if i < 0 {
			out = append(out, bytes.TrimRight(raw, "\r"))
			break
		}
		out = append(out, bytes.TrimRight(raw[:i], "\r"))
		raw = raw[i+1:]
	}
	return out
}

// spRuleSpans reads the rule line that draws a table's columns, returning one
// span per dash run. A line of anything but dashes and spaces is not a rule, and
// a single run is a horizontal divider rather than a column layout.
func spRuleSpans(line string) []spSpan {
	// EDGAR escapes a line that begins with a dash by printing `- ` in front of
	// it, so the ISS institutional-account report draws its rule as
	// `- ------  ------`. The escape is two characters wide and sits over the
	// first column, so filling it keeps every span at the offset the header
	// words are laid out on; stripping it would shift them.
	if strings.HasPrefix(line, "- -") {
		line = "--" + line[2:]
	}
	var spans []spSpan
	start := -1
	for i := 0; i <= len(line); i++ {
		var c byte = ' '
		if i < len(line) {
			c = line[i]
		}
		switch c {
		case '-':
			if start < 0 {
				start = i
			}
		case ' ', '\t':
			if start >= 0 {
				if i-start < 2 {
					return nil
				}
				spans = append(spans, spSpan{start, i})
				start = -1
			}
		default:
			return nil
		}
	}
	if len(spans) < 2 {
		return nil
	}
	return spans
}

// spTypeLine recognises the SGML `<S> <C> <C>` column-type line EDGAR text
// tables print under their rule.
func spTypeLine(line string) bool {
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return false
	}
	for _, f := range fields {
		switch strings.ToUpper(f) {
		case "<S>", "<C>", "<CAPTION>":
		default:
			return false
		}
	}
	return true
}

// spLabels folds the header lines above a rule into one label per column. A
// label stacked over two or three lines -- `Vote` over `Instruction` -- is read
// top to bottom, which is the only way to tell `Vote Instruction` from the `Vote
// Against Management` column beside it.
func spLabels(header []string, spans []spSpan) []string {
	out := make([]string, len(spans))
	for _, line := range header {
		for i, v := range spFields(line, spans) {
			if v == "" {
				continue
			}
			if out[i] == "" {
				out[i] = v
			} else {
				out[i] += " " + v
			}
		}
	}
	for i := range out {
		out[i] = spNormalizeLabel(out[i])
	}
	return out
}

func spNormalizeLabel(s string) string {
	s = strings.ToUpper(strings.Join(strings.Fields(s), " "))
	return strings.TrimSpace(strings.Trim(s, ":#"))
}

// spFields slices one line into its columns. Text is split on runs of two or
// more spaces -- the same gap collapseSpaces preserves -- and each run is filed
// under the column its bytes OVERLAP MOST. Overlap rather than containment is
// what tolerates the right-aligned numbers and the wide header words this
// report prints, and it is what leaves a genuinely empty cell empty instead of
// shifting the row.
func spFields(line string, spans []spSpan) []string {
	out := make([]string, len(spans))
	for i := 0; i < len(line); {
		if line[i] == ' ' || line[i] == '\t' {
			i++
			continue
		}
		start := i
		gap := 0
		end := i
		for ; i < len(line); i++ {
			if line[i] == ' ' || line[i] == '\t' {
				gap++
				if gap >= 2 {
					break
				}
				continue
			}
			gap = 0
			end = i + 1
		}
		text := strings.TrimSpace(line[start:end])
		if text == "" {
			continue
		}
		j := spColumnFor(start, end, spans)
		if out[j] == "" {
			out[j] = text
		} else {
			out[j] += " " + text
		}
	}
	return out
}

// spColumnFor picks the column a run of text belongs to: the one it overlaps
// most, and failing any overlap the nearest one.
func spColumnFor(start, end int, spans []spSpan) int {
	best, bestOverlap := -1, 0
	for i, s := range spans {
		lo, hi := start, end
		if s.start > lo {
			lo = s.start
		}
		if s.end < hi {
			hi = s.end
		}
		if hi-lo > bestOverlap {
			best, bestOverlap = i, hi-lo
		}
	}
	if best >= 0 {
		return best
	}
	best, bestDist := 0, -1
	for i, s := range spans {
		d := 0
		switch {
		case end <= s.start:
			d = s.start - end
		case start >= s.end:
			d = start - s.end
		}
		if bestDist < 0 || d < bestDist {
			best, bestDist = i, d
		}
	}
	return best
}

// spIsWrapLine reports whether a line continues the row below rather than being
// a row itself. A complete vote row in this grammar carries BOTH a management
// recommendation and a vote instruction; a continuation carries at most a
// fragment of one. Every core role the group actually has must be populated, so
// a group missing one of them is judged on the other.
//
// Three shapes reach this, and each defeated a simpler test:
//
//	(a) a blank join key -- the plain continuation.
//	(b) the KEY ITSELF wrapped, so the line carries key text and nothing else:
//	      HC Capital Trust The Value
//	      Equity Portfolio    ...   One Year   Yes   No
//	    Testing for a blank key read (b) as a complete row and truncated the fund
//	    name to `Equity Portfolio`.
//	(c) the key AND THE VOTE wrapped, so the line carries key text and a fragment
//	    of the vote itself:
//	      HC Capital Trust The Institutional Value Equity            One
//	      Portfolio                       One Year       Year   Yes   No
//	    Testing for an empty VOTE cell read (c) as a row too, because `One` is in
//	    the vote column -- which is how 1,531 rows came out as `Year` and 1,491 as
//	    `One` where the filing prints `One Year`. The recommendation cell is what
//	    separates them: it is empty on the fragment line and `One Year` on the row.
func spIsWrapLine(value func(string) string, roles map[string]bool) bool {
	complete := false
	for _, core := range []string{spMgmtRec, spVote} {
		if !roles[core] {
			continue
		}
		if strings.TrimSpace(value(core)) == "" {
			return true
		}
		complete = true
	}
	return !complete
}
