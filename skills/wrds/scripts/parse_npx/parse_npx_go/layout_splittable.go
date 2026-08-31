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
	"MEETING TYPE":               spMeetingType,
	"MEETING DATE":               spMeetingDate,
	"RECORD DATE":                spRecordDate,
	"VOTABLE SHARES":             spSharesTotal,
	"SHARES VOTED":               spShares,
	"PROPONENT":                  spProponent,
	"PROPOSAL NUMBER":            spItem,
	"PROPOSAL TEXT":              spDescription,
	"PROPOSAL CODE CATEGORY":     spCategory,
	"MANAGEMENT RECOMMENDATION":  spMgmtRec,
	"VOTE INSTRUCTION":           spVote,
	"VOTING INSTRUCTION":         spVote,
	"VOTE CAST":                  spVote,
	"HOW VOTED":                  spVote,
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

func matchSplitTable(head string) bool { return containsAnyFolded(head, spSignatures) }

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

func parseSplitTableRaw(raw []byte, _ string, meta FilingMeta) ([]VoteRow, error) {
	var (
		rows      []VoteRow
		group     []spTable
		cur       *spTable
		header    []string
		haveRule  bool
		sawType   bool
		seriesIdx = seriesByName(meta.SeriesDecls)
		resolved  = map[string]string{}
	)

	flush := func() {
		if len(group) > 0 {
			rows = append(rows, spGroupRows(group, seriesIdx, resolved)...)
			group = nil
		}
	}

	for _, raw := range spLines(raw) {
		trimmed := bytes.TrimSpace(raw)

		if cur == nil {
			switch {
			case bytes.EqualFold(trimmed, []byte("<TABLE>")):
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
			} else if len(trimmed) > 0 && !bytes.EqualFold(trimmed, []byte("<CAPTION>")) {
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
		return nil, errLayoutDeclined
	}
	return rows, nil
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

// spGroupRows joins one page group's parallel tables into votes.
func spGroupRows(group []spTable, seriesIdx map[string]*SeriesDecl, resolved map[string]string) []VoteRow {
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
		// A row with no vote in the vote cell is table furniture -- a spacer or a
		// subtotal -- and emitting it would record a vote the filing never cast.
		if row.HowVoted == "" || (row.ItemSeq == "" && row.VoteDescription == "") {
			continue
		}
		if row.FundName != "" {
			id, seen := resolved[row.FundName]
			if !seen {
				id = icrResolveFund(seriesIdx, row.FundName)
				resolved[row.FundName] = id
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
