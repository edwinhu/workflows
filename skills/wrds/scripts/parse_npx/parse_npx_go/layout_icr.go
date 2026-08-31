package main

import "strings"

// icr reads the ISS "Investment Company Report" block grammar: a per-issuer
// block carrying its own identity header, meeting header and column header,
// followed by item-numbered vote rows whose descriptions wrap onto unnumbered
// continuation lines.
//
//	3M Company
//	Ticker           Security ID:              Meeting Date        Meeting Status
//	MMM              CUSIP 88579Y101           05/10/2011          Voted
//	Meeting Type     Country of Trade
//	Annual           United States
//	Issue No.        Description               Proponent  Mgmt Rec  Vote Cast  For/Agnst
//	                                                                            Mgmt
//
//	1                Elect Linda Alvarado      Mgmt       For       For        For
//	12               Advisory Vote on          Mgmt       For       For        For
//	                  Compensation
//
// Measured 2026-08-30 over the 1,181 still-skipping filings that carry 50 or
// more vote-like lines: 144 filings print the `Issue No.` spelling and 79 print
// the wrapped `Issue / No.` one, together 4,782,470 of the 7,851,449 lines
// (60.9%). Nothing claimed them, so every one was `skip`.
//
// THE GRAMMAR IS READ IN CELLS, NOT IN WORDS. collapseSpaces (html.go) squeezes
// a horizontal run to two spaces and a single space to one, so the boundary
// between a fixed-width cell and the words inside it survives normalisation
// exactly. Splitting a row on that two-space gap yields the filing's own six
// columns, which is why this layout needs no vote vocabulary to recognise a row
// and cannot mistake a multi-word value such as `3 Years` for two cells.

// icrColumns is the column count this layout reads: item, description,
// proponent, mgmt rec, vote cast, for/agnst mgmt. The four VALUE columns are
// counted from the RIGHT and the item from the left, so everything between is
// description. A row is never accepted BELOW this width -- a shorter split is a
// description that lost a column boundary, and guessing which cell held the vote
// would fill how_voted from the wrong one.
//
// Counting from the right rather than demanding exactly six cells is not
// defensive: `6  Elect Pierre  Nanterme  Mgmt  For  For  For` prints a double
// space INSIDE the description, which is indistinguishable from a column gap
// after normalisation. Requiring exactly six lost that row and only that row --
// 42 of 43 in the ICR1 fixture, the silent single-row loss this layout is most
// likely to suffer at corpus scale.
const icrColumns = 6

// icrIssuerLookback bounds how many lines above a block header may be read as a
// wrapped issuer name. Real names wrap twice at most (`CHINA MACHINERY
// ENGINEERING` / `CORPORATION`).
const icrIssuerLookback = 3

func init() {
	entry := layoutEntry{Name: "icr", Match: matchICR, Parse: parseICR,
		// This grammar's first block sits arbitrarily deep: measured offsets run
		// from 20,961 bytes to 594,880 in the five filings it was cut from, and
		// the default 128 KB window made the deepest invisible. The window is
		// per-layout on purpose -- raising signatureHeadBytes globally was
		// measured on 2026-08-30 and cost 5,673 rows by changing which layout
		// won the filing.
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

type icrMeeting struct {
	issuer      string
	ticker      string
	securityID  string
	meetingDate string
	meetingType string
}

// icrCells splits a normalised line into the filing's own columns on the
// two-space gap collapseSpaces preserves. Leading indentation is already gone
// by then, so a continuation line yields exactly one cell.
func icrCells(line string) []string {
	var out []string
	for _, part := range strings.Split(line, "  ") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// icrHeaderCells is the exact width of the block header: Ticker, Security ID,
// Meeting Date, Meeting Status. The bound is load-bearing rather than tidy.
// Requiring the three labels merely to be PRESENT claimed a different grammar
// whose own header is nine cells wide --
//
//	INSTITUTIONAL ACCOUNT NAME  TICKER  COUNTRY  SECURITY ID  MEETING ID
//	  MEETING TYPE  MEETING DATE  RECORD DATE  STATUS
//
// -- and every row read out of it was wrong: measured 2026-08-30, that shape
// carried 1,882 rows whose how_voted held description text such as
// `Elect Director Orlando D. Ashford` or an identifier run
// `US0152711091 015271109 2009210 USA`. A wrong how_voted is worse than a
// missing one, so the header this layout opens on is its OWN header and no
// other: four cells, and the three labels in the order it prints them.
const icrHeaderCells = 4

// icrBlockHeader recognises the identity header that opens every block.
func icrBlockHeader(cells []string) bool {
	if len(cells) > icrHeaderCells {
		return false
	}
	ticker, security, date := -1, -1, -1
	for i, c := range cells {
		switch strings.ToUpper(strings.TrimRight(strings.TrimSpace(c), ":")) {
		case "TICKER":
			ticker = i
		case "SECURITY ID":
			security = i
		case "MEETING DATE":
			date = i
		}
	}
	return ticker >= 0 && ticker < security && security < date
}

// icrIdentity reads the values line under a block header. It anchors on the
// DATE rather than on cell position: a blank ticker column collapses away
// entirely, so `CUSIP G87621101  02-Jul-10  Voted` and `MMM  CUSIP 88579Y101
// 05/10/2011  Voted` must both resolve, and counting from the left would read
// the security id as the ticker in the first.
func icrIdentity(cells []string) (icrMeeting, bool) {
	for i := len(cells) - 1; i >= 0; i-- {
		date := htmlDate(cells[i])
		if date == "" {
			continue
		}
		m := icrMeeting{meetingDate: date}
		if i >= 1 {
			m.securityID = cells[i-1]
		}
		if i >= 2 {
			m.ticker = cells[i-2]
		}
		return m, true
	}
	return icrMeeting{}, false
}

// icrItem reports whether a cell is an item number: digits, optionally with
// dotted or lettered sub-numbering. It is deliberately strict -- an issuer name
// beginning with a number reaches this layout only inside a cell that also has
// five siblings, so the loose reading that cost 10,267 rows in the pvtext
// layout is not reachable here.
func icrItem(s string) bool {
	if s == "" || len(s) > 12 {
		return false
	}
	digits := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
			digits = true
		case c == '.' || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'):
		default:
			return false
		}
	}
	return digits
}

func matchICR(head string) bool {
	lines := strings.Split(head, "\n")
	for i := 0; i+1 < len(lines); i++ {
		if !icrBlockHeader(icrCells(lines[i])) {
			continue
		}
		// A header with no resolvable identity line under it is a coincidence,
		// not this grammar. Blank lines never separate the two in the corpus,
		// but a page break can, so look a bounded distance.
		for k := i + 1; k < len(lines) && k <= i+3; k++ {
			if _, ok := icrIdentity(icrCells(lines[k])); ok {
				return true
			}
		}
	}
	return false
}

// icrFurniture is scaffolding printed between blocks: it can never be part of an
// issuer name.
func icrFurniture(line string) bool {
	s := strings.TrimSpace(line)
	if s == "" {
		return true
	}
	if strings.HasPrefix(s, "<") {
		return true // <TABLE>, <S>, <PAGE>, <CAPTION>
	}
	if strings.Trim(s, "-=_") == "" {
		return true // a dashed or underscored rule
	}
	return false
}

// icrIssuerAbove reads the issuer name printed above a block header. The name
// sits on its own line or two, separated from the header by nothing or by a
// single blank, and bounded above by furniture.
func icrIssuerAbove(lines []string, header int) string {
	i := header - 1
	for i >= 0 && strings.TrimSpace(lines[i]) == "" {
		i--
	}
	var parts []string
	for n := 0; i >= 0 && n < icrIssuerLookback; i, n = i-1, n+1 {
		line := strings.TrimSpace(lines[i])
		if icrFurniture(line) {
			break
		}
		// Another block's column header or identity line is not a name.
		cells := icrCells(line)
		if icrBlockHeader(cells) || len(cells) >= icrColumns {
			break
		}
		parts = append([]string{line}, parts...)
	}
	return strings.TrimSpace(strings.Join(parts, " "))
}

// icrVoteRow reads one row. Every column comes from the cell the filing printed
// it in, so how_voted is verbatim by construction rather than by a vocabulary
// check that would have to be widened for every new spelling.
func icrVoteRow(cells []string, m icrMeeting) (VoteRow, bool) {
	if len(cells) < icrColumns || !icrItem(cells[0]) {
		return VoteRow{}, false
	}
	n := len(cells)
	description := strings.Join(cells[1:n-4], " ")
	return VoteRow{
		IssuerName:               m.issuer,
		CUSIP:                    icrCUSIP(m.securityID),
		Ticker:                   m.ticker,
		MeetingDate:              m.meetingDate,
		MeetingType:              m.meetingType,
		ItemSeq:                  cells[0],
		VoteDescription:          description,
		VoteSource:               cells[n-4],
		ManagementRecommendation: cells[n-3],
		HowVoted:                 cells[n-2],
	}, true
}

// icrCUSIP extracts the identifier from a security-id cell. The cell prints the
// scheme beside the value -- `CUSIP 88579Y101`, `CINS Y1501U108` -- and only a
// nine-character CUSIP belongs in the cusip column; anything else is left out
// rather than mislabelled.
func icrCUSIP(cell string) string {
	fields := strings.Fields(cell)
	for _, f := range fields {
		if pvTextCUSIP(f) {
			return f
		}
	}
	return ""
}

func parseICR(text string, _ FilingMeta) ([]VoteRow, error) {
	lines := strings.Split(text, "\n")
	var (
		rows    []VoteRow
		meeting icrMeeting
		haveMtg bool
		// lastRow indexes the row a continuation may extend, and lastLine the
		// line it was read from. A continuation must sit IMMEDIATELY under the
		// row or under a previous continuation of it: between blocks these
		// filings print nil-report prose ("The fund did not vote proxies
		// relating to portfolio securities"), and an unanchored rule would
		// append that prose to the last row of the block above it.
		lastRow  = -1
		lastLine = -2
	)

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		cells := icrCells(line)

		if icrBlockHeader(cells) {
			for k := i + 1; k < len(lines) && k <= i+3; k++ {
				next, ok := icrIdentity(icrCells(strings.TrimSpace(lines[k])))
				if !ok {
					continue
				}
				next.issuer = icrIssuerAbove(lines, i)
				meeting, haveMtg = next, true
				lastRow, lastLine = -1, -2
				i = k
				break
			}
			continue
		}
		if !haveMtg {
			continue
		}

		// The meeting-type header and its values line. Both are consumed here so
		// the values line cannot be mistaken for anything else.
		if len(cells) > 0 && strings.EqualFold(cells[0], "Meeting Type") {
			for k := i + 1; k < len(lines) && k <= i+2; k++ {
				vals := icrCells(strings.TrimSpace(lines[k]))
				if len(vals) > 0 {
					meeting.meetingType = vals[0]
					i = k
					break
				}
			}
			continue
		}

		if row, ok := icrVoteRow(cells, meeting); ok {
			rows = append(rows, row)
			lastRow, lastLine = len(rows)-1, i
			continue
		}

		// A DESCRIPTION CONTINUATION: an unnumbered fragment on the line directly
		// under its row. Anchored by line adjacency rather than by content, so a
		// fragment can carry any words at all without a vocabulary deciding
		// whether it belongs -- and prose that is merely NEAR a row never does.
		if lastRow >= 0 && i == lastLine+1 && len(cells) == 1 && !icrItem(cells[0]) {
			rows[lastRow].VoteDescription += " " + cells[0]
			lastLine = i
		}
	}

	if len(rows) == 0 {
		return nil, errLayoutDeclined
	}
	return rows, nil
}
