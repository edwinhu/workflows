package main

import (
	"regexp"
	"strconv"
	"strings"
)

// The ISS-generated "FORM N-Px REPORT" is the highest-volume legacy layout: a
// fixed-width report whose funds are delimited by rules of '=' padding around a
// fund name, and whose meetings are issuer/ticker/date headers followed by a
// '#  Proposal  Mgt Rec  Vote Cast  Sponsor' column table.
//
// Two properties of the grammar drive the parser's shape.
//
// Proposal text wraps onto continuation lines carrying no item number, so a row
// is only complete once its trailing columns arrive — emitting per physical line
// would double-count every long proposal and truncate its text.
//
// And the column split cannot use column positions. Normalization collapses runs
// of spaces and strips indentation before a layout ever sees the body, which is
// what makes the same parser work on the SGML-wrapped copies of this report as
// on the plain-text ones. So the trailing cells are peeled off the right by
// vocabulary: a sponsor, then up to two vote values.
//
// The vote cells sit on the row's FIRST physical line 96.7% of the time and on
// the last in the vintages whose proposal column is narrow, so their arrival
// cannot be what closes a row: closing there dropped every continuation line of
// the dominant shape. A row is closed by the next item token, a blank line, or a
// meeting/fund boundary, exactly as in the Broadridge family.
//
// Once a row holds its trailing cells, every further line belongs to the
// proposal text and is NOT peeled. The wrapped tail of a proposal is frequently
// a bare vocabulary word -- "Management", the end of "Approve Discharge of Board
// and Senior Management" -- and peeling it would truncate the text and invent a
// sponsor the filing never printed in that position. A row still waiting for its
// cells does peel its continuations, which is how the narrow-column vintage puts
// "For For Management" on the last line of a wrapped proposal.
//
// The Mgt Rec cell is NOT required. It is genuinely blank on rows the
// report merely records ("Receive Financial Statements and Statutory Reports",
// voted None), and demanding it meant the Vote Cast and Sponsor cells of every
// such row were absorbed back into the proposal text. Peeling collects the vote
// cells right to left and assigns them by position within that run: the last one
// peeled is Vote Cast, the one to its left — when there is one — is Mgt Rec. A
// partial reading is a complete answer. The recommendation stays empty rather
// than being filled from the vote beside it, because inventing a value for a
// column the filing left blank is a worse fault than the loss it replaces.

// issItemRe matches the leading token of a proposal row: 1, 1.1, 2a, 6, 1).
// Continuation lines never carry one, which is what separates them from a new row.
var issItemRe = regexp.MustCompile(`^\d+(\.\d+)*[A-Za-z]?[.)]?$`)

// issSponsors is the rightmost column's vocabulary. It anchors the peel: an
// N-PX proposal is put forward either by management or by a shareholder.
// The banner-less vintage of the same report abbreviates the column, printing
// "Mgmt" and "ShrHoldr" where the bannered one spells the words out.
var issSponsors = map[string]bool{
	"management": true, "mgmt": true,
	"shareholder": true, "share holder": true, "shareholders": true,
	"shrholdr": true, "shrhldr": true, "shrholder": true,
	"issuer": true, "security holder": true,
}

// issVoteValues is the vocabulary of the Mgt Rec and Vote Cast columns. Entries
// are matched case-insensitively and longest-first, so "do not vote" is never
// mistaken for a bare "vote". A run of dashes is the report's own spelling of an
// absent management recommendation; it is a filled cell, not a missing one, and
// is carried through verbatim rather than blanked, so a row whose recommendation
// the filing declined to state is still emitted with its vote.
var issVoteValues = map[string]bool{
	"---": true, "----": true, "--": true, "n/m": true,
	"for": true, "against": true, "abstain": true, "abstained": true,
	"withhold": true, "withheld": true, "split": true, "none": true,
	"refer": true, "unvoted": true, "n/a": true, "na": true, "tna": true,
	"do not vote": true, "take no action": true, "no action": true,
	"did not vote": true, "non voting": true, "non-voting": true,
	"one year": true, "two years": true, "three years": true,
	"1 year": true, "2 years": true, "3 years": true,
	"1 yr": true, "2 yrs": true, "3 yrs": true,
	"for and against": true, "with management": true,
}

// issMaxCellWords bounds how many tokens one peeled cell may span.
const issMaxCellWords = 3

// issMonths maps the three-letter month abbreviations the report prints
// ("FEB 28, 2017") onto their numbers.
var issMonths = map[string]int{
	"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
	"jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

// issRowBuf accumulates one proposal across its physical lines.
type issRowBuf struct {
	item    string
	text    []string
	mgmt    string
	cast    string
	sponsor string
}

// complete reports that the row's trailing columns have arrived. It does not
// close the row -- the next item token or the block boundary does that -- it
// only marks the point after which further lines are proposal text and are never
// peeled. A blank Mgt Rec does not leave a row incomplete: the Vote Cast and
// Sponsor cells are the right-hand edge of the table, and a recommendation the
// filing never printed is not a cell still to come.
func (b *issRowBuf) complete() bool {
	return b.cast != "" && b.sponsor != ""
}

// parseISSNPX walks the report line by line, carrying the current fund and
// meeting context onto every proposal row it completes. A fund whose section
// holds only the no-activity sentence contributes nothing, which is the correct
// outcome rather than an error.
func parseISSNPX(text string, meta FilingMeta) ([]VoteRow, error) {
	var (
		rows     []VoteRow
		fund     string
		issuer   string
		ticker   string
		cusip    string
		mtgDate  string
		mtgType  string
		recDate  string
		lastLine string

		inTable bool
		cur     *issRowBuf
	)

	flush := func() {
		if cur == nil {
			return
		}
		if cur.item != "" {
			rows = append(rows, VoteRow{
				FundName:                 fund,
				IssuerName:               issuer,
				CUSIP:                    cusip,
				Ticker:                   ticker,
				MeetingDate:              mtgDate,
				MeetingType:              mtgType,
				RecordDate:               recDate,
				ItemSeq:                  cur.item,
				VoteDescription:          strings.Join(cur.text, " "),
				ManagementRecommendation: cur.mgmt,
				HowVoted:                 cur.cast,
				VoteSource:               cur.sponsor,
			})
		}
		cur = nil
	}

	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)

		if name, ok := issFundSeparator(line); ok {
			flush()
			inTable = false
			if name != "" {
				fund = name
			}
			issuer, ticker, cusip = "", "", ""
			mtgDate, mtgType, recDate = "", "", ""
			lastLine = ""
			continue
		}

		if line == "" {
			flush()
			continue
		}

		// Meeting headers. A Ticker/Security ID line opens a new meeting, so it
		// closes any table still open above it and claims the last free-standing
		// line as the issuer name.
		if tk, id, ok := issTickerLine(line); ok {
			flush()
			inTable = false
			ticker, cusip = tk, id
			issuer = lastLine
			mtgDate, mtgType, recDate = "", "", ""
			continue
		}
		if d, typ, ok := issMeetingLine(line); ok {
			flush()
			inTable = false
			mtgDate, mtgType = d, typ
			continue
		}
		if d, ok := issRecordLine(line); ok {
			flush()
			inTable = false
			recDate = d
			continue
		}
		if issTableHeader(line) {
			flush()
			inTable = true
			continue
		}
		if issSkippableHeader(line) {
			continue
		}

		if !inTable {
			lastLine = line
			continue
		}

		item, rest := issSplitItem(line)
		if item != "" {
			flush()
			cur = &issRowBuf{item: strings.TrimRight(item, ".)")}
		} else if cur == nil {
			// A non-item line with no row open is not a continuation: the table
			// has ended and this is the next meeting's issuer name.
			lastLine = line
			continue
		} else if cur.complete() {
			// The open row already carries its trailing cells, so this line is
			// the wrapped tail of the proposal and is text only. It is never
			// peeled, even when it is exactly a vocabulary word.
			if tail := strings.TrimSpace(rest); tail != "" {
				cur.text = append(cur.text, tail)
			}
			continue
		}

		body, mgmt, cast, sponsor := issPeelColumns(rest)
		if body != "" {
			cur.text = append(cur.text, body)
		}
		if sponsor != "" {
			cur.mgmt, cur.cast, cur.sponsor = mgmt, cast, sponsor
		}
	}
	flush()

	return rows, nil
}

// issFundSeparator recognises the '===== FUND NAME =====' rule that opens a fund
// section and returns the name padded inside it.
func issFundSeparator(line string) (string, bool) {
	if !strings.HasPrefix(line, "==") || !strings.HasSuffix(line, "==") {
		return "", false
	}
	return strings.TrimSpace(strings.Trim(line, "=")), true
}

// issTickerLine parses 'Ticker: <t>   Security ID: <id>'. CUSIP: appears as an
// alternate spelling of the same field in some vintages.
func issTickerLine(line string) (ticker, id string, ok bool) {
	up := strings.ToUpper(line)
	ti := strings.Index(up, "TICKER:")
	if ti < 0 {
		return "", "", false
	}
	si := strings.Index(up, "SECURITY ID:")
	label := len("SECURITY ID:")
	if si < 0 {
		si = strings.Index(up, "CUSIP:")
		label = len("CUSIP:")
	}
	if si < 0 || si < ti {
		return "", "", false
	}
	ticker = strings.TrimSpace(line[ti+len("TICKER:") : si])
	id = strings.TrimSpace(line[si+label:])
	return issFirstField(ticker), issFirstField(id), true
}

// issMeetingLine parses 'Meeting Date: <date>   Meeting Type: <type>'.
func issMeetingLine(line string) (date, typ string, ok bool) {
	up := strings.ToUpper(line)
	di := strings.Index(up, "MEETING DATE:")
	if di < 0 {
		return "", "", false
	}
	rest := line[di+len("MEETING DATE:"):]
	if ti := strings.Index(strings.ToUpper(rest), "MEETING TYPE:"); ti >= 0 {
		typ = strings.TrimSpace(rest[ti+len("MEETING TYPE:"):])
		rest = rest[:ti]
	}
	return issDate(rest), typ, true
}

// issRecordLine parses 'Record Date: <date>'.
func issRecordLine(line string) (string, bool) {
	up := strings.ToUpper(line)
	i := strings.Index(up, "RECORD DATE:")
	if i < 0 {
		return "", false
	}
	return issDate(line[i+len("RECORD DATE:"):]), true
}

// issTableHeader recognises the '#  Proposal  Mgt Rec  Vote Cast  Sponsor'
// column header that opens a meeting's proposal table.
func issTableHeader(line string) bool {
	if !strings.HasPrefix(line, "#") {
		return false
	}
	return strings.Contains(strings.ToUpper(line), "PROPOSAL")
}

// issSkippableHeader drops the report-level preamble, which carries no votes and
// must not be mistaken for an issuer name.
func issSkippableHeader(line string) bool {
	up := strings.ToUpper(line)
	switch {
	case strings.Contains(up, "FORM N-PX REPORT"):
		return true
	case strings.HasPrefix(up, "ICA FILE NUMBER:"):
		return true
	case strings.HasPrefix(up, "REPORTING PERIOD:"):
		return true
	}
	return false
}

// issSplitItem separates a leading item number from the rest of a table line.
// No item number means the line continues the row above it.
func issSplitItem(line string) (item, rest string) {
	parts := strings.SplitN(line, " ", 2)
	if len(parts) == 2 && issItemRe.MatchString(parts[0]) {
		return parts[0], strings.TrimSpace(parts[1])
	}
	return "", line
}

// issPeelColumns takes the Mgt Rec / Vote Cast / Sponsor cells off the right of a
// table line, returning the proposal text that remains.
//
// The sponsor and one vote cell must peel; short of that the line is text, not
// the end of a row. A second vote cell is the Mgt Rec column and is optional,
// because the report leaves it blank on rows it merely records. Nothing is
// substituted for a cell that does not peel.
func issPeelColumns(rest string) (body, mgmt, cast, sponsor string) {
	toks := strings.Fields(rest)
	// One proposal-text token, the Vote Cast cell and the Sponsor cell are the
	// fewest a row can carry once the Mgt Rec column is allowed to be blank.
	if len(toks) < 3 {
		return strings.TrimSpace(rest), "", "", ""
	}

	sponsor, toks, ok := issPeelCell(toks, issSponsors)
	if !ok {
		return strings.TrimSpace(rest), "", "", ""
	}

	// Vote cells are peeled right to left, so the first one off the line is Vote
	// Cast and a second, if the filing printed one, is Mgt Rec.
	cast, toks, ok = issPeelCell(toks, issVoteValues)
	if !ok {
		return strings.TrimSpace(rest), "", "", ""
	}
	if len(toks) > 0 {
		if cell, remaining, found := issPeelCell(toks, issVoteValues); found {
			mgmt, toks = cell, remaining
		}
	}
	return strings.Join(toks, " "), mgmt, cast, sponsor
}

// issPeelCell removes the longest run of trailing tokens that spells a value in
// vocab, preserving the filing's own capitalization in what it returns.
func issPeelCell(toks []string, vocab map[string]bool) (cell string, remaining []string, ok bool) {
	max := issMaxCellWords
	if max > len(toks) {
		max = len(toks)
	}
	for n := max; n >= 1; n-- {
		candidate := strings.Join(toks[len(toks)-n:], " ")
		if vocab[strings.ToLower(strings.Trim(candidate, ".,;"))] {
			return candidate, toks[:len(toks)-n], true
		}
	}
	return "", toks, false
}

// issDate normalizes the report's date spellings onto YYYYMMDD. The month-name
// form ("FEB 28, 2017") is handled here; numeric forms fall through to the
// shared normalizer so the column never mixes formats.
func issDate(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	fields := strings.FieldsFunc(s, func(r rune) bool {
		return r == ' ' || r == ',' || r == '\t'
	})
	if len(fields) == 3 {
		key := strings.ToLower(fields[0])
		if len(key) >= 3 {
			if m, ok := issMonths[key[:3]]; ok {
				day, derr := strconv.Atoi(fields[1])
				year, yerr := strconv.Atoi(fields[2])
				if derr == nil && yerr == nil && day >= 1 && day <= 31 && year >= 1000 {
					return issPad4(year) + issPad2(m) + issPad2(day)
				}
			}
		}
	}
	return xmlDate(issFirstField(s))
}

// issFirstField takes the leading whitespace-delimited token, which is how a
// value is isolated from trailing filler on a fixed-width line.
func issFirstField(s string) string {
	f := strings.Fields(s)
	if len(f) == 0 {
		return ""
	}
	return f[0]
}

func issPad2(v int) string {
	if v < 10 {
		return "0" + strconv.Itoa(v)
	}
	return strconv.Itoa(v)
}

func issPad4(v int) string {
	s := strconv.Itoa(v)
	for len(s) < 4 {
		s = "0" + s
	}
	return s
}
