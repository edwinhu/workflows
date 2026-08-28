package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// The Broadridge / ProxyEdge family is 5,500 legacy filings, 9.3% of all legacy
// N-PX, flat at 200-350/year for nineteen years. 73% name neither "Broadridge"
// nor "ProxyEdge", so the grammar is the only reliable identifier.
//
// A filing is a sequence of MEETING BLOCKS. Each block is
//
//	<issuer name>                       [Agenda Number: 932152666]
//	Security: 060505104                 Meeting Type: Annual
//	Ticker:   BAC                       Meeting Date: 26-May-04
//	<column header, ONE OR TWO physical lines>
//	01       DIRECTOR
//	         1   WILLIAM BARNET, III    Mgmt      For        For
//	02       RATIFICATION OF ...        Mgmt      For        For
//	         ACCOUNTANTS
//
// Three properties of the format drive the parser's shape, and each of them is
// what the previous implementation got wrong. Measured against real filings it
// emitted 180 rows against 200,590 of ground truth.
//
// FIRST, the column header is TWO physical lines in both dominant sub-shapes.
// The spill line carries no item token and no value; it comes FIRST in the
// 'Prop. #' and 'ITEM' variants and SECOND in the 'Prop.#' variant. Treating it
// as an issuer name closes the table before the first proposal is read, which is
// the whole of the 0.090% recall.
//
// SECOND, 57.3% of real rows wrap onto continuation lines. Normalization
// collapses runs of spaces and strips indentation before any layout sees the
// body, so the indentation that separates a continuation from a new row is gone
// and only the LEADING TOKEN can tell them apart. The vote cells sit on the
// first physical line 96.7% of the time and on the last in the tab-delimited
// export, so a row is closed by a blank line, the next item, or the end of the
// block -- never by the arrival of a vote, and never held open past a blank line.
//
// THIRD, meeting context must survive a mid-table page break: 23,581 repeated
// column headers and 19,129 <PAGE> markers occur INSIDE a proposal table with no
// label block after them. A repeated header and a page footer therefore change
// nothing about the block. Context is cleared only at a real block boundary, so
// an identity the filing never stated stays empty rather than being inherited.

// brVoteVocabulary is the vocabulary of the VOTE and FOR/AGAINST MANAGEMENT
// columns. It is deliberately local to this layout: the ISS family's copy is
// owned by a different grammar and the two drift apart.
//
// It is DISJOINT from brTypeVocabulary, and that disjointness is load-bearing --
// brPeelColumns uses "this cell can only be a TYPE value" as its signal that the
// leftmost trailing column has been reached and peeling must stop. 'Non-Voting'
// is a TYPE value (a meeting at which nothing was voted); 'None' is a vote value
// and is also what the sixth column of the six-column shape reads.
var brVoteVocabulary = map[string]bool{
	"for": true, "against": true, "abstain": true, "abstained": true,
	"withhold": true, "withheld": true, "split": true, "none": true,
	"refer": true, "unvoted": true, "n/a": true, "na": true, "tna": true,
	"n/m": true, "---": true, "----": true, "--": true,
	"do not vote": true, "take no action": true, "no action": true,
	"did not vote": true,
	"one year":     true, "two years": true, "three years": true,
	"1 year": true, "2 years": true, "3 years": true,
	"1 yr": true, "2 yrs": true, "3 yrs": true,
	"with management": true, "against management": true, "for and against": true,
}

// brTypeVocabulary is the TYPE column: who put the proposal forward, or that the
// item was not votable at all. 'Shr' is the abbreviation the TIAA-CREF vintage
// uses for a shareholder proposal.
var brTypeVocabulary = map[string]bool{
	"mgmt": true, "mgt": true, "management": true,
	"shr": true, "shrholdr": true, "shrhldr": true, "shrholder": true,
	"shareholder": true, "shareholders": true, "share holder": true,
	"issuer": true, "security holder": true, "other": true,
	"non-voting": true, "non voting": true, "nonvoting": true,
}

// brMaxCellWords bounds how many tokens one peeled cell may span ("1 Year").
const brMaxCellWords = 3

// brLabels is the label vocabulary of a meeting block, longest first so
// "MEETING DATE" is never read as a bare "MEETING" and "TICKER SYMBOL" never as
// a bare "TICKER" whose value is then the literal word SYMBOL.
//
// CITY, COUNTRY and SEDOL earn their place: they are label lines in the ITEM
// sub-shape, and a label line the vocabulary does not know becomes a free
// standing line, which is how the issuer name of that block became "SEDOL(s)".
var brLabels = []string{
	"HOLDINGS RECON DATE", "TICKER SYMBOL", "SECURITY ID",
	"AGENDA NUMBER", "MEETING DATE", "MEETING TYPE", "RECORD DATE",
	"SECURITY", "CUSIP", "TICKER", "AGENDA", "ISIN", "SEDOL",
	"CITY", "COUNTRY",
}

// brColumnWords is the vocabulary of the column header and of its spill line. A
// line built only from these words is header furniture: it names columns and
// carries no value, so it is neither an issuer name nor a proposal.
var brColumnWords = map[string]bool{
	"PROP": true, "PROPOSAL": true, "PROPOSALS": true, "PROPOSED": true,
	"ITEM": true, "NO": true, "NUM": true, "NUMBER": true, "BY": true,
	"TYPE": true, "VOTE": true, "VOTES": true, "VOTED": true, "CAST": true,
	"FOR": true, "AGAINST": true, "WITHHELD": true,
	"MANAGEMENT": true, "MGMT": true, "MGT": true, "REC": true,
	"RECOMMENDATION": true, "PREFERRED": true, "PROVIDER": true,
	"SPONSOR": true, "DESCRIPTION": true, "SECURITY": true, "HOLDER": true,
}

// brItemFirstWords are the tokens that may open the column header's item
// column. '#' alone is deliberately absent: that is the ISS family's header
// ('#  Proposal  Mgt Rec  Vote Cast  Sponsor'), whose column order TRANSPOSES
// the recommendation and the vote, so claiming it would reverse every row.
var brItemFirstWords = map[string]bool{
	"PROP": true, "PROP.": true, "PROP#": true, "PROP.#": true,
	"PROP.NO": true, "PROP.NO.": true, "PROPNO": true, "ITEM": true,
}

// The item-token patterns. 4,641 of the sampled items (1.9%) are not numeric:
// roman numerals, single letters, letter-digit codes and CMMT annotations all
// occur, and each is a genuine agenda item.
//
// Numeric items are capped at three digits ON PURPOSE. Indentation is gone by
// the time this layout runs, so a continuation line beginning "2002 STOCK PLAN
// AND RESERVE 1,500,000 SHARES" is lexically indistinguishable from a new item
// without that cap -- and reading it as one splits a proposal into two rows,
// inventing an agenda item the filing never had.
var (
	brItemNumeric = regexp.MustCompile(`^[0-9]{1,3}(\.[0-9]{1,3})*[A-Za-z]?[.)]?$`)
	brItemParen   = regexp.MustCompile(`^[0-9]{1,3}\([A-Za-z]\)$`)
	brItemMixed   = regexp.MustCompile(`^[0-9]{1,3}[A-Z][0-9]{1,2}$`)
	brItemAlpha   = regexp.MustCompile(`^[A-Z](\.?[0-9]{1,2})?$`)
	brItemRoman   = regexp.MustCompile(`^([IVX]{1,4}|[ivx]{1,4})$`)
)

// brMonths maps the month spellings of the family's date formats.
var brMonths = map[string]int{
	"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
	"jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

// matchBroadridge recognises the family by its proposal column header, which is
// the line parseBroadridge itself keys on, plus a meeting label somewhere in the
// head. Matching on the labels alone would claim any legacy report that prints a
// ticker, converting an honest skip into an ok with too few rows.
func matchBroadridge(head string) bool {
	up := strings.ToUpper(head)
	if !strings.Contains(up, "MEETING DATE") && !strings.Contains(up, "MEETING TYPE") {
		return false
	}
	for _, line := range strings.Split(up, "\n") {
		if brColumnHeader(line) {
			return true
		}
	}
	return false
}

// brColumnHeader recognises the family's proposal column header in all four of
// its spellings:
//
//	Prop.#  Proposal  Proposal Type  Proposal Vote  For/Against Management
//	Prop. # Proposal  Type  Vote  Management
//	ITEM    PROPOSAL  TYPE  VOTE  FOR/AGAINST MANAGEMENT
//	Item    Proposal  Proposed by  Vote  For/Against Management
//
// 'Prop. #' with a space is 25 files, one of which carries 117,458 rows and was
// invisible to the prefix test this replaces. The match is on the header's FIRST
// TOKEN, not on a prefix, so the spill line "Proposal Proposal For/Against" --
// which begins with the letters P-R-O-P -- is correctly not a header.
func brColumnHeader(line string) bool {
	up := strings.ToUpper(strings.TrimSpace(line))
	if !strings.Contains(up, "PROPOSAL") {
		return false
	}
	if !strings.Contains(up, "VOTE") && !strings.Contains(up, "FOR/AGAINST") {
		return false
	}
	fields := strings.Fields(up)
	if len(fields) == 0 {
		return false
	}
	first := fields[0]
	if !brItemFirstWords[first] {
		return false
	}
	// A bare "PROP" or "ITEM" must still be the item column, not a stray word:
	// the header always names the proposal column somewhere to its right.
	return len(fields) > 1
}

// brColumnFurniture reports whether a line is built only from column-header
// words, which makes it the header's spill line rather than content. Both
// dominant sub-shapes have a two-line header; the spill arrives BEFORE the
// header line in the 'Prop. #' and 'ITEM' variants and AFTER it in 'Prop.#'.
func brColumnFurniture(line string) bool {
	words := brAlphaWords(line)
	if len(words) == 0 {
		return false
	}
	for _, w := range words {
		if !brColumnWords[w] {
			return false
		}
	}
	return true
}

// brAlphaWords splits a line into uppercase alphabetic runs, so "For/Against"
// yields FOR and AGAINST and "Prop.#" yields PROP.
func brAlphaWords(line string) []string {
	var out []string
	var tok strings.Builder
	flush := func() {
		if tok.Len() > 0 {
			out = append(out, tok.String())
			tok.Reset()
		}
	}
	for _, r := range strings.ToUpper(line) {
		if r >= 'A' && r <= 'Z' {
			tok.WriteRune(r)
			continue
		}
		flush()
	}
	flush()
	return out
}

// brPageFurniture recognises the page break that cuts 23,581 proposal tables in
// half. It is NOT a block boundary: the meeting it interrupts continues on the
// next page under a repeated column header with no label block, so a footer must
// leave the issuer, ticker, CUSIP and meeting date exactly as they were.
//
// The date-range footer BEGINS with the words "Meeting Date" at column zero,
// which is why this test runs before the label test rather than after it.
func brPageFurniture(line string) bool {
	up := strings.ToUpper(strings.TrimSpace(line))
	if up == "" {
		return false
	}
	if brDashRule(up) {
		return true
	}
	switch {
	case up == "INVESTMENT COMPANY REPORT",
		up == "ANNUAL REPORT OF PROXY VOTING RECORD":
		return true
	case strings.HasPrefix(up, "MEETING DATE RANGE"),
		strings.HasPrefix(up, "REPORT DATE:"),
		strings.HasPrefix(up, "PAGE:"):
		return true
	}
	// "Page 367 of 3908" on its own line, 20,132 occurrences.
	if f := strings.Fields(up); len(f) == 4 && f[0] == "PAGE" && f[2] == "OF" {
		if _, err := strconv.Atoi(f[1]); err == nil {
			return true
		}
	}
	return false
}

// brDashRule reports whether a line is a horizontal rule. Both '-----' and
// '- -----' occur; the leading '- ' is SGML dash escaping, not content.
func brDashRule(up string) bool {
	s := strings.TrimSpace(up)
	if strings.HasPrefix(s, "- ") {
		s = strings.TrimSpace(s[2:])
	}
	if len(s) < 3 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] != '-' && s[i] != '=' && s[i] != '_' {
			return false
		}
	}
	return true
}

// brRowBuf accumulates one proposal across its physical lines.
type brRowBuf struct {
	item     string
	text     []string
	typ      string
	vote     string
	forAgnst string
}

// parseBroadridge walks the meeting blocks, carrying the current meeting context
// onto every proposal row it completes.
//
// A body the matcher claimed but from which no proposal row could be read is an
// error, not an empty success: reporting "we parsed it and there was nothing"
// for a filing that plainly carries a vote table is the silent loss this parser
// is being repaired for.
func parseBroadridge(text string, meta FilingMeta) ([]VoteRow, error) {
	var (
		rows    []VoteRow
		issuer  string
		ticker  string
		cusip   string
		isin    string
		mtgDate string
		mtgType string
		recDate string

		pendingIssuer string
		headerText    string
		spill         []string

		hasType bool
		maxVote = 2

		inTable  bool
		sawTable bool
		cur      *brRowBuf
	)

	// flush emits the open row. A row is emitted whenever it has an item token,
	// even with no vote and no text: an agenda item the fund reported but did
	// not vote must stay distinguishable from an item the fund never held. The
	// uncertain field is left EMPTY; the row is never discarded.
	flush := func() {
		if cur == nil {
			return
		}
		if cur.item != "" {
			rows = append(rows, VoteRow{
				IssuerName:               issuer,
				Ticker:                   ticker,
				CUSIP:                    cusip,
				ISIN:                     isin,
				MeetingDate:              mtgDate,
				MeetingType:              mtgType,
				RecordDate:               recDate,
				ItemSeq:                  cur.item,
				VoteDescription:          strings.Join(cur.text, " "),
				HowVoted:                 cur.vote,
				VoteSource:               cur.typ,
				ManagementRecommendation: cur.forAgnst,
			})
		}
		cur = nil
	}

	// boundary closes the meeting block the last table belonged to. EVERY field
	// of the meeting context is cleared, so a block that states only a CUSIP and
	// a date -- routine in ProxyEdge output for unlisted and foreign holdings --
	// emits an empty ticker and issuer rather than the previous meeting's.
	// Attributing a vote to an issuer the filing never associated with that
	// CUSIP is worse than emitting no row at all.
	//
	// It is called ONLY when a new label block opens or free-standing text ends
	// the table -- never at a repeated column header or a page footer, which are
	// interruptions inside one meeting rather than the end of it.
	boundary := func() {
		if !sawTable {
			return
		}
		sawTable = false
		inTable = false
		issuer, ticker, cusip, isin = "", "", "", ""
		mtgDate, mtgType, recDate = "", "", ""
	}

	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" {
			flush()
			continue
		}

		if brColumnHeader(line) {
			flush()
			headerText = strings.Join(append(spill, line), " ")
			spill = nil
			hasType, maxVote = brColumnShape(headerText)
			inTable, sawTable = true, true
			continue
		}

		// The header's spill line. It must not close the table, must not become
		// an issuer name, and its words tell us whether the table has a TYPE
		// column and a sixth PREFERRED PROVIDER column.
		if cur == nil && brColumnFurniture(line) {
			if inTable {
				headerText += " " + line
				hasType, maxVote = brColumnShape(headerText)
			} else {
				spill = append(spill, line)
			}
			continue
		}

		if brPageFurniture(line) {
			continue
		}

		item, rest := brSplitItem(line)

		// Inside a table, a line with no item token continues the row above it.
		// 1,866 continuation lines begin with a label word -- the worst being a
		// line that is exactly "MEETING DATE", the wrapped tail of "STOCKHOLDER
		// PROPOSAL - ANNUAL MEETING DATE" -- so the label test must not see it.
		if inTable && cur != nil && item == "" {
			brAbsorb(cur, rest, hasType, maxVote)
			continue
		}

		if item == "" {
			if labels := brFindLabels(line); len(labels) > 0 {
				flush()
				boundary()
				inTable = false
				spill = nil
				if pendingIssuer != "" {
					issuer = pendingIssuer
					pendingIssuer = ""
				}
				for label, v := range labels {
					switch label {
					case "TICKER", "TICKER SYMBOL":
						ticker = brFirstField(v)
					case "CUSIP", "SECURITY ID", "SECURITY":
						if id := brFirstField(v); brLooksLikeSecurityID(id) {
							cusip = id
						}
					case "ISIN":
						isin = brFirstField(v)
					case "MEETING DATE":
						mtgDate = brDate(v)
					case "MEETING TYPE":
						mtgType = v
					case "RECORD DATE":
						recDate = brDate(v)
					}
				}
				continue
			}

			// Free-standing text. It ends any open table and is the candidate
			// issuer name for the block whose label lines follow it.
			flush()
			boundary()
			inTable = false
			spill = nil
			pendingIssuer = brIssuerName(line)
			continue
		}

		if !inTable {
			// An item-shaped token outside a table is prose, not a proposal.
			pendingIssuer = brIssuerName(line)
			continue
		}

		flush()
		cur = &brRowBuf{item: brNormalizeItem(item)}
		brAbsorb(cur, rest, hasType, maxVote)
	}
	flush()

	if len(rows) == 0 {
		return nil, fmt.Errorf("broadridge: column header matched but no proposal rows parsed")
	}
	return rows, nil
}

// brAbsorb folds one physical line into the open row: the proposal text is
// appended, and any trailing cells fill the columns that are still empty.
//
// Filling only empty columns is what makes the tab-delimited export work, where
// the vote cells arrive on the LAST physical line of a wrapped proposal rather
// than the first -- the TYPE cell lands on one line and the two vote cells on
// the next, and neither overwrites the other.
func brAbsorb(cur *brRowBuf, rest string, hasType bool, maxVote int) {
	body, typ, vote, forAgnst := brPeelColumns(rest, hasType, maxVote)
	if body != "" {
		cur.text = append(cur.text, body)
	}
	if typ != "" && cur.typ == "" {
		cur.typ = typ
	}
	if vote != "" && cur.vote == "" {
		cur.vote = vote
	}
	if forAgnst != "" && cur.forAgnst == "" {
		cur.forAgnst = forAgnst
	}
}

// brColumnShape reads the table's column count off its header. hasType is
// whether a TYPE (or "Proposed by" / Sponsor) column precedes the vote columns;
// maxVote is how many vote-vocabulary cells may trail one row.
//
// The sixth column, PREFERRED PROVIDER RECOMMENDATION, holds the value 'None',
// which is itself a vote word. Peeling from the right without knowing the column
// count reads it as the management recommendation and silently reports every row
// of that filing as unopposed.
func brColumnShape(headerText string) (hasType bool, maxVote int) {
	up := strings.ToUpper(headerText)
	hasType = strings.Contains(up, "TYPE") ||
		strings.Contains(up, "PROPOSED BY") ||
		strings.Contains(up, "SPONSOR")
	maxVote = 2
	if strings.Contains(up, "PREFERRED") {
		maxVote = 3
	}
	return hasType, maxVote
}

// brSplitItem separates a leading item token from the rest of a line. No item
// token means the line continues the row above it.
func brSplitItem(line string) (item, rest string) {
	parts := strings.SplitN(line, " ", 2)
	if !brIsItemToken(parts[0]) {
		return "", line
	}
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], strings.TrimSpace(parts[1])
}

// brIsItemToken reports whether tok opens a proposal row.
func brIsItemToken(tok string) bool {
	if tok == "" {
		return false
	}
	if tok == "CMMT" {
		return true
	}
	switch {
	case brItemNumeric.MatchString(tok),
		brItemParen.MatchString(tok),
		brItemMixed.MatchString(tok),
		brItemAlpha.MatchString(tok),
		brItemRoman.MatchString(tok):
		return true
	}
	return false
}

// brNormalizeItem drops the trailing punctuation of '1a.' and '3)', so the
// column holds 1a and 3 whichever vintage printed the row.
func brNormalizeItem(item string) string {
	return strings.TrimRight(item, ".)")
}

// brPeelColumns takes the trailing cells off the right of a table line and
// returns the proposal text that remains.
//
// The columns are, left to right, TYPE, VOTE, FOR/AGAINST MANAGEMENT and (in the
// six-column shape) PREFERRED PROVIDER RECOMMENDATION. So vote is how_voted and
// forAgnst is management_recommendation; transposing them mislabels every row.
//
// Peeling STOPS at a cell that can only be a TYPE value, because TYPE is the
// leftmost trailing column and nothing lies further left. That single rule is
// what keeps "SUBMISSION OF THE AUDITED ANNUAL REPORT FOR   Non-Voting" -- a
// proposal whose own text ends in the word FOR, on a meeting where nothing was
// voted -- from being read as a vote of For.
//
// A partial reading is a complete answer, not a failed one: a blank management
// column is routine on abstentions and shareholder proposals, and every column
// is blank on the 8,993 CMMT and Non-Voting rows. The uncertain field is left
// empty and the row is still emitted.
func brPeelColumns(rest string, hasType bool, maxVote int) (body, typ, vote, forAgnst string) {
	toks := strings.Fields(rest)

	var cells []string // right to left
	votes := 0
	for len(toks) > 0 {
		cell, remaining, isType, ok := brPeelCell(toks)
		if !ok {
			break
		}
		if isType {
			if !hasType {
				break
			}
			typ = cell
			toks = remaining
			break
		}
		if votes >= maxVote {
			break
		}
		cells = append(cells, cell)
		votes++
		toks = remaining
	}

	// cells were collected right to left; the vote column is the leftmost.
	for i, j := 0, len(cells)-1; i < j; i, j = i+1, j-1 {
		cells[i], cells[j] = cells[j], cells[i]
	}
	if len(cells) > 0 {
		vote = cells[0]
	}
	if len(cells) > 1 {
		forAgnst = cells[1]
	}
	// cells[2], when present, is the PREFERRED PROVIDER column. It is not a
	// vote and is deliberately not carried into any vote field.

	return strings.TrimSpace(strings.Join(toks, " ")), typ, vote, forAgnst
}

// brPeelCell removes the longest run of trailing tokens spelling one cell value,
// preserving the filing's own capitalization. isType distinguishes a TYPE value
// from a vote value; the two vocabularies are disjoint by construction.
func brPeelCell(toks []string) (cell string, remaining []string, isType, ok bool) {
	max := brMaxCellWords
	if max > len(toks) {
		max = len(toks)
	}
	for n := max; n >= 1; n-- {
		candidate := strings.Join(toks[len(toks)-n:], " ")
		key := strings.ToLower(strings.Trim(candidate, ".,;:"))
		switch {
		case brVoteVocabulary[key]:
			return candidate, toks[:len(toks)-n], false, true
		case brTypeVocabulary[key]:
			return candidate, toks[:len(toks)-n], true, true
		}
	}
	return "", toks, false, false
}

// brIssuerName strips the trailing "Agenda Number: 932152666" that the modern
// vintage prints on the same line as the issuer, so the column holds the issuer
// and not the agenda id glued to it.
func brIssuerName(line string) string {
	up := strings.ToUpper(line)
	for _, label := range []string{"AGENDA NUMBER", "AGENDA:"} {
		if i := strings.Index(up, label); i > 0 {
			line = strings.TrimSpace(line[:i])
			up = strings.ToUpper(line)
		}
	}
	return strings.TrimSpace(line)
}

// brFindLabels returns every label present on one line mapped to its value. One
// physical line may carry several ('TICKER SYMBOL    MEETING DATE  08-Jul-2011'),
// so a value runs from the end of its own label to the start of the next one --
// and is EMPTY when the next label follows immediately, which is how a blank
// ticker stays blank instead of becoming the literal word MEETING.
func brFindLabels(line string) map[string]string {
	up := strings.ToUpper(line)

	type hit struct {
		at    int
		label string
	}
	var hits []hit
	for _, label := range brLabels {
		for i := 0; ; {
			j := strings.Index(up[i:], label)
			if j < 0 {
				break
			}
			at := i + j
			if !brLabelBoundary(up, at, len(label)) {
				i = at + 1
				continue
			}
			hits = append(hits, hit{at: at, label: label})
			i = at + len(label)
		}
	}
	if len(hits) == 0 {
		return nil
	}

	// Sort by position and drop any hit a longer label already covers, so
	// "MEETING DATE" is not also reported as a bare "MEETING".
	for i := 1; i < len(hits); i++ {
		for j := i; j > 0 && hits[j].at < hits[j-1].at; j-- {
			hits[j], hits[j-1] = hits[j-1], hits[j]
		}
	}
	var kept []hit
	end := -1
	for _, h := range hits {
		if h.at < end {
			continue
		}
		kept = append(kept, h)
		end = h.at + len(h.label)
	}

	// A label BLOCK begins with a label. A proposal whose text merely names one
	// -- '5 Approve Change of Record Date for Annual Meeting' -- is a table row,
	// and reading it as a label line would close the table and blank the meeting
	// date, dropping every later proposal of that meeting.
	if kept[0].at != 0 {
		return nil
	}

	out := map[string]string{}
	for i, h := range kept {
		from := h.at + len(h.label)
		to := len(line)
		if i+1 < len(kept) {
			to = kept[i+1].at
		}
		v := strings.TrimSpace(line[from:to])
		v = strings.TrimSpace(strings.TrimPrefix(v, ":"))
		out[h.label] = v
	}
	return out
}

// brLabelBoundary rejects a label that is part of a longer word, which is what
// keeps 'TICKER' from matching inside a registrant name such as TICKERTAPE.
func brLabelBoundary(up string, at, n int) bool {
	if at > 0 && brWordByte(up[at-1]) {
		return false
	}
	if at+n < len(up) && brWordByte(up[at+n]) {
		return false
	}
	return true
}

func brWordByte(c byte) bool {
	return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9'
}

// brLooksLikeSecurityID guards the CUSIP column. In the tab-delimited export the
// 'Security' label holds the company NAME and the CUSIP arrives under its own
// label further down; without this test the column would carry a fragment of the
// issuer's name and the real identifier would be the one discarded.
func brLooksLikeSecurityID(s string) bool {
	if len(s) < 5 || len(s) > 12 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if !brWordByte(s[i]) {
			return false
		}
	}
	return true
}

// brFirstField takes the leading whitespace-delimited token, which is how a
// value is isolated from trailing filler on a label line.
func brFirstField(s string) string {
	f := strings.Fields(s)
	if len(f) == 0 {
		return ""
	}
	return f[0]
}

// brDate normalizes the family's date spellings onto YYYYMMDD: '26-May-04',
// '09-May-2023', the quoted '"06 May, 2021"' of the tab-delimited export, and a
// slash-separated numeric form. A value it cannot read yields an empty date
// rather than a guess.
func brDate(s string) string {
	s = strings.TrimSpace(strings.Trim(strings.TrimSpace(s), `"`))
	if s == "" {
		return ""
	}
	fields := strings.FieldsFunc(s, func(r rune) bool {
		return r == '-' || r == '/' || r == '.' || r == ',' || r == ' ' || r == '\t'
	})
	if len(fields) != 3 {
		return ""
	}

	// dd-Mon-yy(yy) and "dd Mon, yyyy".
	if m, ok := brMonths[strings.ToLower(brPrefix(fields[1], 3))]; ok {
		day, derr := strconv.Atoi(fields[0])
		year, yok := brYear(fields[2])
		if derr == nil && yok && day >= 1 && day <= 31 {
			return brPad4(year) + brPad2(m) + brPad2(day)
		}
		return ""
	}

	// mm/dd/yy(yy).
	month, merr := strconv.Atoi(fields[0])
	day, derr := strconv.Atoi(fields[1])
	year, yok := brYear(fields[2])
	if merr != nil || derr != nil || !yok {
		return ""
	}
	if month < 1 || month > 12 || day < 1 || day > 31 {
		return ""
	}
	return brPad4(year) + brPad2(month) + brPad2(day)
}

// brYear resolves a year field, expanding the two-digit form. N-PX did not exist
// before 2003, so a two-digit year is in this century; the 1900s branch exists
// only so a stray '97' is not reported as a meeting held in 2097.
func brYear(s string) (int, bool) {
	v, err := strconv.Atoi(s)
	if err != nil || v < 0 {
		return 0, false
	}
	if len(s) <= 2 {
		if v >= 90 {
			return 1900 + v, true
		}
		return 2000 + v, true
	}
	if v < 1000 {
		return 0, false
	}
	return v, true
}

// brPrefix takes the first n bytes of s, or all of s when it is shorter.
func brPrefix(s string, n int) string {
	if len(s) < n {
		return s
	}
	return s[:n]
}

func brPad2(v int) string {
	if v < 10 {
		return "0" + strconv.Itoa(v)
	}
	return strconv.Itoa(v)
}

func brPad4(v int) string {
	s := strconv.Itoa(v)
	for len(s) < 4 {
		s = "0" + s
	}
	return s
}
