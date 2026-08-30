package main

import "strings"

// pvtext is a plain-text account report made of a wrapped two-line header,
// followed by meeting lines and item-numbered vote lines. The filing that exposed
// it also carries unrelated fixed-width sections, so this layout opens only on
// the complete header and closes on any line outside this grammar.

const (
	pvTextHeaderFirst  = "ISSUER NAME TICKER CUSIP MTG DATE MTG TYPE"
	pvTextHeaderSecond = "Proposal Type Voted? Vote For/Agnst Mgmt"
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
		if i+1 < len(lines) && pvTextHeaderAt(lines, i) {
			inTable = true
			haveMtg = false
			i++ // the second physical line is header continuation, never a row
			continue
		}
		if !inTable {
			continue
		}

		line := strings.TrimSpace(lines[i])
		if line == "" {
			haveMtg = false
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

func pvTextHeaderAt(lines []string, i int) bool {
	return i >= 0 && i+1 < len(lines) &&
		pvTextCanonical(lines[i]) == strings.ToUpper(pvTextHeaderFirst) &&
		pvTextCanonical(lines[i+1]) == strings.ToUpper(pvTextHeaderSecond)
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
	if len(fields) < 6 || !pvTextItem(fields[0]) {
		return VoteRow{}, false
	}

	n := len(fields)
	proponent := fields[n-4]
	cast := fields[n-2]
	proponentKey := strings.ToUpper(proponent)
	votedKey := strings.ToUpper(fields[n-3])
	castKey := strings.ToUpper(cast)
	vsManagementKey := strings.ToUpper(fields[n-1])
	if (proponentKey != "MGMT" && proponentKey != "SHLDR") ||
		(votedKey != "YES" && votedKey != "NO") ||
		!pvTextVote(castKey) ||
		(vsManagementKey != "FOR" && vsManagementKey != "AGNST") {
		return VoteRow{}, false
	}

	description := strings.Join(fields[1:n-4], " ")
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
	}
	return false
}
