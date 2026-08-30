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
	// Blank lines tolerated between the header's physical lines. Bounded so a
	// generic first line cannot pair with a distant continuation.
	pvTextHeaderGapMax = 3
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
		rows            []VoteRow
		meeting         pvTextMeeting
		inTable         bool
		haveMtg         bool
		continuationRow = -1
	)

	for i := 0; i < len(lines); i++ {
		if n := pvTextHeaderLinesAt(lines, i); n != 0 {
			inTable = true
			haveMtg = false
			continuationRow = -1
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
			continuationRow = -1
			continue
		}
		if next, ok := pvTextMeetingLine(line); ok {
			meeting = next
			haveMtg = true
			continuationRow = -1
			continue
		}
		if haveMtg {
			if row, ok := pvTextVoteLine(line, meeting); ok {
				rows = append(rows, row)
				continuationRow = len(rows) - 1
				continue
			}

			// Look ahead only when the current line ends in a proper prefix of a
			// multi-word vote. This completes wrapped values without merging the next
			// compact-rendering item into the current row.
			if pvTextIncompleteVoteLine(line) && i+1 < len(lines) {
				tail := strings.TrimSpace(lines[i+1])
				tailFields := strings.Fields(tail)
				if len(tailFields) > 0 && !pvTextItem(tailFields[0]) {
					// Insert the tail BEFORE a trailing vs-management indicator rather
					// than after it. `... MGMT YES DID NOT FOR` + `VOTE` appended
					// naively becomes `DID NOT FOR VOTE`, which no longer parses: the
					// indicator is no longer trailing, the row is dropped and the table
					// then closes, costing the following item too. This shape occurs
					// zero times in 80 sampled filings, so it is a silent row-loss path
					// rather than a live defect -- closed cheaply, not designed around.
					joined := line + " " + tail
					if f := strings.Fields(line); len(f) > 0 {
						if last := strings.ToUpper(f[len(f)-1]); last == "FOR" || last == "AGNST" {
							joined = strings.Join(f[:len(f)-1], " ") + " " + tail + " " + f[len(f)-1]
						}
					}
					if row, ok := pvTextVoteLine(joined, meeting); ok {
						rows = append(rows, row)
						continuationRow = len(rows) - 1
						i++ // the vote tail is part of this row, never a row of its own
						continue
					}
				}
			}

			// DESCRIPTION CONTINUATION -- a decision, recorded rather than implied.
			// A fragment on a line carrying no item number and no vote columns is
			// appended to the preceding row's description, but ONLY when the next line
			// is a proper meeting or item row, so a fragment must be the last line of
			// its block.
			//
			// Whether `Amend Board/Supervisory Board Size` is a second topic under item
			// 7.00's single vote or a separate agenda line is NOT decidable from these
			// bytes; European AGMs bundle both ways. The join is kept because it cannot
			// cost a ROW -- the fragment carries no vote columns and so could never be
			// one -- while dropping it would discard report text outright. What it can
			// affect is description completeness, and carrying the filing's own words
			// is the lesser risk. Review flagged the join as unconditional; it is not,
			// but the previous round did make this choice silently, which was the
			// actual defect.
			// INVERTED WRAP -- the mirror of the block above. There the vote value
			// spilled FORWARD onto the next line; here the item number and the start of
			// the description sit alone and the columns arrive on the line after:
			//
			//	2.00     PROPOSAL TO APPROVE THE ACE LIMITED 2004
			//	         LONG-TERM INCENTIVE PLAN.        MGMT   YES   FOR   FOR
			//
			// Without this the layout sees an item line carrying no vote, closes the
			// table and loses the REST OF THE DOCUMENT. In the PV5 fixture that cost
			// every meeting after the first: 23 of 40 rows, and corpus-wide it is the
			// difference between claiming 120 of 277 filings and claiming them all.
			//
			// Guarded from both sides: this line must begin with an item number and
			// carry no complete vote of its own, and the next must carry the columns
			// while beginning with no item number -- otherwise two adjacent ordinary
			// items in the compact rendering would merge into one row.
			if f := strings.Fields(line); len(f) > 0 && pvTextItem(f[0]) && i+1 < len(lines) {
				next := strings.TrimSpace(lines[i+1])
				if nf := strings.Fields(next); len(nf) > 0 && !pvTextItem(nf[0]) {
					if row, ok := pvTextVoteLine(line+" "+next, meeting); ok {
						rows = append(rows, row)
						continuationRow = len(rows) - 1
						i++ // the column line belongs to this row, never a row of its own
						continue
					}
				}
			}

			if continuationRow >= 0 && pvTextDescriptionContinuationAt(lines, i) {
				rows[continuationRow].VoteDescription += " " + line
				continuationRow = -1
				continue
			}
		}

		// A line that IS structurally a vote row -- item number, then a proponent
		// followed by a voted flag -- but whose vote value this layout does not
		// recognise must not close the table. Closing on one unknown spelling cost the
		// entire remainder of a document: a single `WHOLD` line in one filing's
		// Ameritrade block lost 26,157 of its 26,384 rows. The row is SKIPPED rather
		// than emitted, because how_voted is verbatim by contract and an unrecognised
		// token is not yet known to be a vote -- but the document keeps being read, so
		// one unfamiliar spelling costs one row instead of every row after it.
		if f := strings.Fields(line); len(f) >= 4 && pvTextItem(f[0]) {
			structural := false
			for k := 1; k+1 < len(f); k++ {
				pk := strings.ToUpper(f[k])
				vk := strings.ToUpper(f[k+1])
				if (pk == "MGMT" || pk == "SHLDR") && (vk == "YES" || vk == "NO") {
					structural = true
					break
				}
			}
			if structural {
				continue
			}
		}

		// A line that is neither a meeting, vote, nor an immediate unnumbered
		// description continuation closes this table until another full header opens it.
		inTable = false
		haveMtg = false
		continuationRow = -1
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
	// The continuation is usually the next physical line, but one rendering separates
	// the header's halves with a blank. The gap is BOUNDED on purpose: the first line
	// is generic enough that an unbounded search could pair it with a continuation
	// belonging to a different section, and these documents carry unrelated tabular
	// sections under other sub-advisors.
	j := i + 1
	for j < len(lines) && j <= i+pvTextHeaderGapMax && strings.TrimSpace(lines[j]) == "" {
		j++
	}
	if j >= len(lines) {
		return 0
	}
	second := pvTextCanonical(lines[j])
	if second == strings.ToUpper(pvTextHeaderSecond) {
		return j - i + 1
	}
	// Column-aligned: the second line drops the words that wrapped, and the third
	// carries exactly those. Require BOTH halves so a data row cannot pose as one.
	if j+1 < len(lines) &&
		second == strings.ToUpper(pvTextHeaderSecondWrapped) &&
		pvTextCanonical(lines[j+1]) == strings.ToUpper(pvTextHeaderThirdWrapped) {
		return j - i + 2
	}
	return 0
}

func pvTextHeaderAt(lines []string, i int) bool {
	return pvTextHeaderLinesAt(lines, i) != 0
}

func pvTextCanonical(line string) string {
	return strings.ToUpper(strings.Join(strings.Fields(line), " "))
}

// pvTextDescriptionContinuationAt accepts one unnumbered agenda fragment only
// when the next physical line resumes the grammar with a meeting or item. Upstream
// whitespace normalization removes indentation, so the following structural line
// is the available boundary between a continuation and foreign text.
func pvTextDescriptionContinuationAt(lines []string, i int) bool {
	if i+1 >= len(lines) {
		return false
	}
	next := strings.TrimSpace(lines[i+1])
	if next == "" || pvTextPageFurniture(next) {
		return false
	}
	if _, ok := pvTextMeetingLine(next); ok {
		return true
	}
	fields := strings.Fields(next)
	return len(fields) > 0 && pvTextItem(fields[0])
}

// pvTextMeetingLine reads the identity fields from the right because the issuer
// is free text. The exact nine-character CUSIP and parseable numeric date anchor
// the split; a line without both is not a meeting in this grammar.
func pvTextMeetingLine(line string) (pvTextMeeting, bool) {
	fields := strings.Fields(line)
	if len(fields) < 5 {
		return pvTextMeeting{}, false
	}

	// The CUSIP is the strongest anchor but it is NOT always printed: foreign
	// issuers appear as `Abitibi Consolidated Inc.  A.  4/29/04  Annual` and
	// `Ace Ltd.  ACE  5/27/04  Annual`, with a ticker and no CUSIP. Requiring one
	// meant those meetings were not recognised, the table closed on them, and the
	// REST OF THE DOCUMENT was lost -- in the PV5 fixture every meeting after the
	// first, 23 of 40 rows.
	//
	// Without a CUSIP the remaining anchor is a parseable date immediately before a
	// meeting type, preceded by a ticker-shaped token. That is a narrower net than it
	// looks: an item or vote line begins with an item number, which is checked by the
	// caller before this is reached, and prose rarely ends in `<TICKER> <date> <type>`.
	n := len(fields)
	date := htmlDate(fields[n-2])
	if date == "" {
		return pvTextMeeting{}, false
	}

	cusip, tickerAt := "", n-4
	if pvTextCUSIP(fields[n-3]) {
		cusip = fields[n-3]
	} else {
		// No CUSIP column: the ticker sits directly before the date.
		tickerAt = n - 3
	}
	if tickerAt < 1 || !pvTextTicker(fields[tickerAt]) {
		return pvTextMeeting{}, false
	}
	issuer := strings.Join(fields[:tickerAt], " ")
	if issuer == "" {
		return pvTextMeeting{}, false
	}

	return pvTextMeeting{
		issuer:      issuer,
		ticker:      fields[tickerAt],
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
	p, rest, ok := pvTextVoteParts(fields)
	if !ok {
		return VoteRow{}, false
	}

	cast := strings.Join(rest, " ")
	if !pvTextVote(strings.ToUpper(cast)) {
		return VoteRow{}, false
	}

	description := strings.Join(fields[1:p], " ")
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
		VoteSource:      fields[p],
		HowVoted:        cast,
	}, true
}

// pvTextVoteParts anchors on the proponent/voted pair rather than counting from
// the right. Multi-word vote values and an optional trailing vs-management field
// make fixed offsets ambiguous. The latter is not a manifest column.
func pvTextVoteParts(fields []string) (int, []string, bool) {
	if len(fields) < 5 || !pvTextItem(fields[0]) {
		return 0, nil, false
	}

	// Anchor on the proponent, preferring the proponent/voted PAIR. Some renderings
	// omit the `Voted?` column entirely and print the vote straight after the
	// proponent -- `1.00 Elect Michael T. Dugan<TAB>MGMT NOT VOTED` -- so demanding
	// YES/NO there declines every line of those filings. The pair is tried first
	// because it is what stops a description word being read as the proponent; the
	// fallback compensates by requiring everything after the proponent to form a
	// COMPLETE known vote value, which is the stricter test of the two.
	p, voteAt := -1, -1
	for k := len(fields) - 2; k >= 1; k-- {
		pk := strings.ToUpper(fields[k])
		vk := strings.ToUpper(fields[k+1])
		if (pk == "MGMT" || pk == "SHLDR") && (vk == "YES" || vk == "NO") {
			p, voteAt = k, k+2
			break
		}
	}
	if p < 0 {
		for k := len(fields) - 2; k >= 1; k-- {
			pk := strings.ToUpper(fields[k])
			if pk != "MGMT" && pk != "SHLDR" {
				continue
			}
			tail := fields[k+1:]
			if len(tail) > 1 {
				if last := strings.ToUpper(tail[len(tail)-1]); last == "FOR" || last == "AGNST" {
					tail = tail[:len(tail)-1]
				}
			}
			if pvTextVote(strings.ToUpper(strings.Join(tail, " "))) {
				p, voteAt = k, k+1
				break
			}
		}
	}
	if p < 1 || voteAt >= len(fields) {
		return 0, nil, false
	}

	rest := fields[voteAt:]
	if len(rest) > 1 {
		last := strings.ToUpper(rest[len(rest)-1])
		if last == "FOR" || last == "AGNST" {
			rest = rest[:len(rest)-1]
		}
	}
	return p, rest, true
}

func pvTextIncompleteVoteLine(line string) bool {
	_, rest, ok := pvTextVoteParts(strings.Fields(line))
	if !ok {
		return false
	}
	prefix := strings.ToUpper(strings.Join(rest, " "))
	for _, vote := range []string{"TAKE NO ACTION", "DID NOT VOTE", "NOT VOTED"} {
		if strings.HasPrefix(vote, prefix+" ") {
			return true
		}
	}
	return false
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
	// Surveyed across 40 filings of this family: WHOLD is this corpus's spelling of
	// Withhold and occurs 12,936 times, more than any value except FOR and AGNST.
	// Its absence did not merely lose those rows -- an unrecognised vote CLOSED THE
	// TABLE, so one WHOLD line cost the entire rest of the document. In the worst
	// filing that was 26,157 of its 26,384 rows.
	case "WHOLD", "AGAINST", "WITHHOLD", "REFER", "SPLIT", "UNVOTED":
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
	// EDGAR table furniture printed between the header and the first meeting: a
	// dashed rule, and the <S>/<C> column-width markers SGML uses to size columns.
	// The layout used to close the table on the first of these, so filings carrying
	// them yielded nothing at all rather than a partial read.
	if strings.Trim(t, "- ") == "" && strings.Contains(t, "--") {
		return true
	}
	if fs := strings.Fields(strings.ToUpper(t)); len(fs) > 0 {
		allMarkers := true
		for _, f := range fs {
			if f != "<S>" && f != "<C>" && f != "<F>" && f != "<FN>" {
				allMarkers = false
				break
			}
		}
		if allMarkers {
			return true
		}
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
