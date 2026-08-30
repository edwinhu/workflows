package main

import "strings"

// pvtext is a plain-text account report made of a wrapped two-line header,
// followed by meeting lines and item-numbered vote lines. The filing that exposed
// it also carries unrelated fixed-width sections, so this layout opens only on
// the complete header and closes on any line outside this grammar.

const (
	pvTextHeaderFirst  = "ISSUER NAME TICKER CUSIP MTG DATE MTG TYPE"
	pvTextHeaderSecond = "Proposal Type Voted? Vote For/Agnst Mgmt"
	// The column-aligned rendering wraps `Type` and `Mgmt` onto a third line.
	pvTextHeaderSecondWrapped = "Proposal Voted? Vote For/Agnst"
	pvTextHeaderThirdWrapped  = "Type Mgmt"
)

type pvTextMeeting struct {
	issuer      string
	ticker      string
	cusip       string
	meetingDate string
	meetingType string
}

// Register pvtext ahead of the generic HTML and fixed-width fallbacks. The
// named layouts still get first refusal, while pvtext's exact two-line signature
// prevents it from claiming the other table shapes in a mixed filing.
func init() {
	entry := layoutEntry{Name: "pvtext", Match: matchPVText, Parse: parsePVText}
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

func matchPVText(head string) bool {
	lines := strings.Split(head, "\n")
	for i := 0; i+1 < len(lines); i++ {
		if pvTextHeaderAt(lines, i) {
			return true
		}
	}
	return false
}

func parsePVText(text string, _ FilingMeta) ([]VoteRow, error) {
	lines := strings.Split(text, "\n")
	var (
		rows    []VoteRow
		meeting pvTextMeeting
		inTable bool
		haveMtg bool
	)

	for i := 0; i < len(lines); i++ {
		if n := pvTextHeaderLinesAt(lines, i); n != 0 {
			inTable = true
			haveMtg = false
			i += n - 1 // header continuations are never rows
			continue
		}
		if !inTable {
			continue
		}

		line := strings.TrimSpace(lines[i])
		// Page furniture, not end of table. A meeting's votes are split across pages
		// and the footer sits between them: 43 of 60 sampled filings carry <PAGE>
		// breaks and one holds 72. Treating a footer as end-of-section discarded every
		// row after the first page break -- 47 of 109 in the two-section fixture.
		// Blank lines are furniture for the same reason: they surround every break, so
		// resetting the open meeting on one loses the rows that continue it.
		if line == "" || pvTextPageFurniture(line) {
			continue
		}
		if next, ok := pvTextMeetingLine(line); ok {
			meeting = next
			haveMtg = true
			continue
		}
		if haveMtg {
			if row, ok := pvTextVoteLine(line, meeting); ok {
				rows = append(rows, row)
				continue
			}
		}

		// This report has no continuation or furniture lines inside a block. Once a
		// line is neither its meeting nor its vote shape, later text belongs to a
		// different section unless another complete pvtext header opens it again.
		inTable = false
		haveMtg = false
	}

	if len(rows) == 0 {
		return nil, errLayoutDeclined
	}
	return rows, nil
}

// pvTextHeaderLinesAt returns how many physical lines the header occupies at i,
// or 0 if there is no header there. The format has two renderings. The COMPACT one
// puts every continuation on line two. The COLUMN-ALIGNED one is too wide for the
// page, so `Type` and `Mgmt` wrap alone onto a third line:
//
//	ISSUER NAME                       TICKER      CUSIP           MTG DATE    MTG TYPE
//	                                                              Proposal    Voted?    Vote      For/Agnst
//	                                                              Type                            Mgmt
//
// A two-line rule reads that third line as data and declines the whole block, which
// is why one 4,321-vote-line filing returned nothing.
func pvTextHeaderLinesAt(lines []string, i int) int {
	if i < 0 || i+1 >= len(lines) {
		return 0
	}
	if pvTextCanonical(lines[i]) != strings.ToUpper(pvTextHeaderFirst) {
		return 0
	}
	second := pvTextCanonical(lines[i+1])
	if second == strings.ToUpper(pvTextHeaderSecond) {
		return 2
	}
	// Column-aligned: the second line drops the words that wrapped, and the third
	// carries exactly those. Require BOTH halves so a data row cannot pose as one.
	if i+2 < len(lines) &&
		second == strings.ToUpper(pvTextHeaderSecondWrapped) &&
		pvTextCanonical(lines[i+2]) == strings.ToUpper(pvTextHeaderThirdWrapped) {
		return 3
	}
	return 0
}

func pvTextHeaderAt(lines []string, i int) bool {
	return pvTextHeaderLinesAt(lines, i) != 0
}

func pvTextCanonical(line string) string {
	return strings.ToUpper(strings.Join(strings.Fields(line), " "))
}

// pvTextMeetingLine reads the identity fields from the right because the issuer
// is free text. The exact nine-character CUSIP and parseable numeric date anchor
// the split; a line without both is not a meeting in this grammar.
func pvTextMeetingLine(line string) (pvTextMeeting, bool) {
	fields := strings.Fields(line)
	if len(fields) < 5 {
		return pvTextMeeting{}, false
	}

	n := len(fields)
	cusip := fields[n-3]
	if !pvTextCUSIP(cusip) {
		return pvTextMeeting{}, false
	}
	date := htmlDate(fields[n-2])
	if date == "" || !pvTextTicker(fields[n-4]) {
		return pvTextMeeting{}, false
	}
	issuer := strings.Join(fields[:n-4], " ")
	if issuer == "" {
		return pvTextMeeting{}, false
	}

	return pvTextMeeting{
		issuer:      issuer,
		ticker:      fields[n-4],
		cusip:       cusip,
		meetingDate: date,
		meetingType: fields[n-1],
	}, true
}

// pvTextVoteLine peels the four governed columns from the right. Everything
// between the item and the proponent is description text; none of the trailing
// For/Agnst indicator is promoted to management_recommendation, because the
// filing prints no recommendation column.
func pvTextVoteLine(line string, meeting pvTextMeeting) (VoteRow, bool) {
	fields := strings.Fields(line)
	if len(fields) < 5 || !pvTextItem(fields[0]) {
		return VoteRow{}, false
	}

	// Anchor on the proponent/voted PAIR rather than counting from the right. Two
	// shapes in this corpus break a fixed-offset split: the vote value can be
	// MULTI-WORD (`TAKE NO ACTION`), and the trailing vs-management column is
	// sometimes absent. Counting back four fields shears both. Scanning from the
	// right for `MGMT|SHLDR` followed by `YES|NO` also survives a description that
	// happens to contain one of those words.
	p := -1
	for k := len(fields) - 2; k >= 1; k-- {
		pk := strings.ToUpper(fields[k])
		vk := strings.ToUpper(fields[k+1])
		if (pk == "MGMT" || pk == "SHLDR") && (vk == "YES" || vk == "NO") {
			p = k
			break
		}
	}
	if p < 1 || p+2 >= len(fields) {
		return VoteRow{}, false
	}

	proponent := fields[p]
	rest := fields[p+2:]

	// The last field is the vs-management indicator only when something remains to
	// be the vote itself; otherwise it IS the vote.
	vsManagement := ""
	if len(rest) > 1 {
		last := strings.ToUpper(rest[len(rest)-1])
		if last == "FOR" || last == "AGNST" {
			vsManagement = rest[len(rest)-1]
			rest = rest[:len(rest)-1]
		}
	}
	cast := strings.Join(rest, " ")
	if !pvTextVote(strings.ToUpper(cast)) {
		return VoteRow{}, false
	}
	_ = vsManagement // vs-management is not a manifest column; see the header note.

	n := p
	description := strings.Join(fields[1:n], " ")
	if description == "" {
		return VoteRow{}, false
	}

	return VoteRow{
		IssuerName:      meeting.issuer,
		CUSIP:           meeting.cusip,
		Ticker:          meeting.ticker,
		MeetingDate:     meeting.meetingDate,
		MeetingType:     meeting.meetingType,
		ItemSeq:         fields[0],
		VoteDescription: description,
		VoteSource:      proponent,
		HowVoted:        cast,
	}, true
}

func pvTextItem(s string) bool {
	if len(s) < 4 {
		return false
	}
	dot := strings.IndexByte(s, '.')
	if dot <= 0 || dot != len(s)-3 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if i == dot {
			continue
		}
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

func pvTextCUSIP(s string) bool {
	if len(s) != 9 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'A' || c > 'Z') && (c < 'a' || c > 'z') {
			return false
		}
	}
	return true
}

func pvTextTicker(s string) bool {
	if s == "" || len(s) > 12 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c < '0' || c > '9') && (c < 'A' || c > 'Z') && (c < 'a' || c > 'z') && c != '.' && c != '-' {
			return false
		}
	}
	return true
}

func pvTextVote(s string) bool {
	switch s {
	case "FOR", "AGNST", "ABSTAIN", "WITHHELD":
		return true
	// Multi-word values this corpus prints. `TAKE NO ACTION` appears on foreign
	// ballots the fund held but did not vote, and is what the filing said.
	case "TAKE NO ACTION", "DID NOT VOTE", "NOT VOTED", "NONE", "NON-VOTING":
		return true
	}
	return false
}

// pvTextPageFurniture reports whether a line is pagination rather than report
// content. It is deliberately narrow: the table must still CLOSE on genuinely
// foreign text, because these documents also carry unrelated sections in a
// `Mtg Date/Type | Company/Ballot Issues | Security | Mgmt Rec | Vote Cast`
// fixed-width layout under other sub-advisors, and a layout that never closes
// would run on and emit rows from a format it was never written for.
func pvTextPageFurniture(line string) bool {
	if line == "<PAGE>" || line == "\f" {
		return true
	}
	t := strings.TrimLeft(line, "\f")
	t = strings.TrimSpace(t)
	if t == "" || t == "<PAGE>" {
		return true
	}
	up := strings.ToUpper(t)
	if strings.HasPrefix(up, "PAGE ") {
		rest := strings.TrimSpace(up[len("PAGE "):])
		if rest == "" {
			return false
		}
		for _, r := range rest {
			if r < '0' || r > '9' {
				return false
			}
		}
		return true
	}
	return false
}
