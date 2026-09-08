package main

import (
	"regexp"
	"strings"
)

var pvTextDatedHeading = regexp.MustCompile(`(?i)^(.+?)\s+(\d{1,2}-\d{1,2}-\d{4})\s+through\s+(\d{1,2}-\d{1,2}-\d{4})$`)

// pvtext is a plain-text account report made of a wrapped two-line header,
// followed by meeting lines and item-numbered vote lines. The filing that exposed
// it also carries unrelated fixed-width sections, so this layout opens only on
// the complete header and closes on any line outside this grammar.

const (
	pvTextHeaderFirst = "ISSUER NAME TICKER CUSIP MTG DATE MTG TYPE"
	// The same header with MTG TYPE wrapped onto a continuation line.
	pvTextHeaderFirstMin = "ISSUER NAME TICKER CUSIP MTG DATE"
	pvTextHeaderSecond   = "Proposal Type Voted? Vote For/Agnst Mgmt"
	// The column-aligned rendering wraps `Type` and `Mgmt` onto a third line.
	pvTextHeaderSecondWrapped = "Proposal Voted? Vote For/Agnst"
	pvTextHeaderThirdWrapped  = "Type Mgmt"
	// Blank lines tolerated between the header's physical lines. Bounded so a
	// generic first line cannot pair with a distant continuation.
	pvTextHeaderGapMax = 6
	// How far past blanks, page furniture and further unnumbered lines to look for
	// the row that proves a fragment is a continuation rather than the end of the
	// table. Measured on a filing that echoes every director name beneath its vote:
	// in-table runs reach 25 lines, so a bound of 8 closed the table mid-slate. The
	// bound is generous but finite; what actually does the work is the requirement
	// that a real meeting or item row FOLLOW the run.
	pvTextContinuationLookahead = 64
	// How many following lines a wrapped description may span before its columns.
	pvTextWrapLookahead = 4
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
	entry := layoutEntry{Name: "pvtext", Match: matchPVText, Parse: parsePVText,
		// This format's header can sit megabytes into a filing: measured over 40
		// filings that yielded nothing, the offset has median 2,784 but p90
		// 2,260,260 and max 10,972,887, and one 5.5 MB filing carries its first
		// vote table at line 28,340. The default 128 KB made those invisible.
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

func matchPVText(head string) bool {
	lines := strings.Split(head, "\n")
	for i := 0; i+1 < len(lines); i++ {
		if pvTextHeaderAt(lines, i) {
			return true
		}
	}
	return false
}

func parsePVText(text string, meta FilingMeta) ([]VoteRow, error) {
	lines := strings.Split(text, "\n")
	// The Account Number heading resolves against the declared (or dictionary)
	// series under the shared rules, as in every other layout.
	seriesIx := newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))
	issFormerKeys(seriesIx, meta.FormerNames)
	var (
		rows            []VoteRow
		meeting         pvTextMeeting
		inTable         bool
		haveMtg         bool
		pendingIssuer   bool
		continuationRow = -1
		fund            string
		fundSeries      string
		bareAccount     bool
	)

	for i := 0; i < len(lines); i++ {
		if f, ok := pvTextAccountFund(lines[i]); ok {
			_, d := issResolveFund(seriesIx, f)
			// Only the first numeric account following a resolved bare heading
			// belongs to that section; later account headings are new boundaries.
			opaque := strings.HasPrefix(strings.ToUpper(strings.TrimSpace(lines[i])), "ACCOUNT NUMBER:") && len(f) > 0 && f[0] >= '0' && f[0] <= '9'
			if !bareAccount || !opaque || d != nil {
				fund, fundSeries = f, ""
				if d != nil {
					fundSeries = d.SeriesID
				}
			}
			bareAccount = false
			inTable, haveMtg, pendingIssuer, continuationRow = false, false, false, -1
			continue
		}
		if line := strings.TrimSpace(lines[i]); line != "" && i+1 < len(lines) && strings.TrimSpace(lines[i+1]) == "" {
			if _, d := issResolveFund(seriesIx, line); d != nil {
				fund, fundSeries, bareAccount = line, d.SeriesID, true
				inTable, haveMtg, pendingIssuer, continuationRow = false, false, false, -1
				continue
			}
		}
		if m := pvTextDatedHeading.FindStringSubmatch(strings.TrimSpace(lines[i])); m != nil && htmlDate(m[2]) != "" && htmlDate(m[3]) != "" {
			for j := i + 1; j < len(lines) && j <= i+pvTextHeaderGapMax; j++ {
				if pvTextHeaderAt(lines, j) {
					fund, fundSeries, bareAccount = m[1], "", false
					if _, d := issResolveFund(seriesIx, fund); d != nil {
						fundSeries = d.SeriesID
					}
					inTable, haveMtg, pendingIssuer, continuationRow = false, false, false, -1
					break
				}
			}
		}
		if n := pvTextHeaderLinesAt(lines, i); n != 0 {
			bareAccount = false
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
			// Furniture does not break the continuation anchor either. An echo's own
			// tail can be separated from it by blank lines:
			//
			//	2.00   Confirm First Interim Dividend of USD 0.255 Per
			//	       Ordinary Share and Confirm as the Final Dividend
			//	       the                              MGMT  YES  FOR
			//	       Confirm First Interim Dividend of USD 0.255 Per
			//	       Ordinary Share and Confirm as the Final Dividend
			//	       <blank>
			//	       <blank>
			//	       the
			//	3.00   Reappoint KPMG Audit Plc as Auditors of the
			//
			// Clearing the anchor here left that trailing `the` with nothing to attach
			// to, so it closed the table -- the guard had already judged it a genuine
			// continuation. What bounds the anchor is that a meeting line clears it and
			// the lookahead requires a real row to follow, not the presence of a blank.
			continue
		}
		if next, ok := pvTextMeetingLine(line); ok {
			meeting = next
			haveMtg = true
			continuationRow = -1
			pendingIssuer = true // the issuer's name may wrap onto the next line
			continue
		}

		// A WRAPPED ISSUER NAME. The line after a meeting can be the rest of the
		// issuer, and a meeting clears continuationRow, so that tail had nothing to
		// attach to and closed the table:
		//
		//	Alexandria Real   ARE  015271109  5/12/2004  Annual
		//	Estate Equities                                      <- closed the table
		//	1.01  Elect Jerry M. Sudarsky   MGMT  YES  AGNST
		//
		// Instrumented output was `CLOSE line="Estate Equities" contRow=-1 cont=true`:
		// the continuation guard already judged it a continuation. Only the line
		// IMMEDIATELY after the meeting is eligible, and only when it is neither a
		// vote nor a meeting itself, so this cannot swallow a block of text.
		if pendingIssuer {
			pendingIssuer = false
			if _, isVote := pvTextVoteLine(line, meeting); !isVote {
				if f := strings.Fields(line); len(f) > 0 && !pvTextItemLoose(f[0]) {
					meeting.issuer = strings.TrimSpace(meeting.issuer + " " + line)
					continue
				}
			}
		}
		if haveMtg {
			if row, ok := pvTextVoteLine(line, meeting); ok {
				row.FundName, row.SeriesID = fund, fundSeries
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
						row.FundName, row.SeriesID = fund, fundSeries
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
			if f := strings.Fields(line); len(f) > 0 && pvTextItem(f[0]) {
				// The description may wrap over SEVERAL lines before the columns
				// arrive, so join a bounded run rather than a single line:
				//
				//	1.00   Elect Dong Kil Cho, Marlene Davidge, William
				//	       Davis, Richard Drouin, Lise Lachapelle, Gary
				//	       Lukassen,                    MGMT   YES   AGNST
				//
				// Joining one line left this row unparsed, which closed the table and
				// cost the rest of the document. The run stops at the first line that
				// begins with an item number, so the next vote can never be absorbed.
				joined, wrapped := line, false
				for k := i + 1; k < len(lines) && k <= i+pvTextWrapLookahead; k++ {
					nf := strings.Fields(strings.TrimSpace(lines[k]))
					if len(nf) == 0 {
						break
					}
					if pvTextItem(nf[0]) {
						break
					}
					joined += " " + strings.TrimSpace(lines[k])
					if row, ok := pvTextVoteLine(joined, meeting); ok {
						row.FundName, row.SeriesID = fund, fundSeries
						rows = append(rows, row)
						continuationRow = len(rows) - 1
						i = k // every joined line belongs to this row
						wrapped = true
						break
					}
				}
				if wrapped {
					continue
				}
			}

			if continuationRow >= 0 && pvTextDescriptionContinuationAt(lines, i) {
				// An echo of the row's own lines beneath it (`1.10 ELECT
				// DIRECTOR DOUGLAS D. FRENCH ... FOR` / `ELECT DIRECTOR DOUGLAS
				// D. FRENCH`, and both lines of a wrapped item; Putnam 2004,
				// 2,529 doubled descriptions) is not a continuation: the
				// description already carries it.
				if d := rows[continuationRow].VoteDescription; strings.Contains(" "+d+" ", " "+line+" ") {
					continue
				}
				rows[continuationRow].VoteDescription += " " + line
				// continuationRow is NOT cleared: a run of echo lines all belong to
				// the row above them, and clearing after the first left the second
				// with nothing to attach to, which closed the table.
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
// pvTextHeaderLinesAt returns how many physical lines the header occupies at i, or 0
// if there is no header there.
//
// The first line is exact. What FOLLOWS it is not: four wrapping permutations of the
// same header appear in this corpus, because the column block is wider than the page
// and filers broke it wherever it happened to land --
//
//	Proposal Type Voted? Vote For/Agnst Mgmt          (one line)
//	Proposal Voted? Vote For/Agnst  /  Type Mgmt      (split, tail second)
//	FOR/AGNST  /  PROPOSAL TYPE VOTED? VOTE MGMT      (split, tail FIRST)
//	... Vote For/  /  <tail lands on the meeting line>
//
// Enumerating them was losing a variant each time, so this consumes following lines
// while they carry ONLY header vocabulary, stopping at the first meeting or item row.
// A dashed rule and the SGML <S>/<C> markers count as furniture in that run. At least
// one consumed line must mention VOTE or VOTED, so a bare first line cannot open a
// table on its own.
func pvTextHeaderLinesAt(lines []string, i int) int {
	if i < 0 || i+1 >= len(lines) {
		return 0
	}
	// The first line is a PREFIX match, not an exact one. `MTG TYPE` is the last
	// column and sometimes wraps into the continuation, leaving the first line as
	// `ISSUER NAME TICKER CUSIP MTG DATE`. Requiring the full form declined those
	// filings outright.
	first := pvTextCanonical(lines[i])
	if !strings.HasPrefix(first, pvTextHeaderFirstMin) {
		return 0
	}
	if first != pvTextHeaderFirstMin && first != strings.ToUpper(pvTextHeaderFirst) {
		return 0
	}
	sawVote, last := false, i
	for k := i + 1; k < len(lines) && k <= i+pvTextHeaderGapMax; k++ {
		t := strings.TrimSpace(lines[k])
		if t == "" || pvTextPageFurniture(t) {
			last = k
			continue
		}
		if _, ok := pvTextMeetingLine(t); ok {
			break
		}
		if f := strings.Fields(t); len(f) > 0 && pvTextItem(f[0]) {
			break
		}
		if !pvTextHeaderWords(t) {
			break
		}
		up := pvTextCanonical(t)
		if strings.Contains(up, "VOTE") {
			sawVote = true
		}
		last = k
	}
	if !sawVote {
		return 0
	}
	return last - i + 1
}

// pvTextHeaderWords reports whether every token on a line belongs to this header's
// vocabulary. It is what distinguishes a wrapped header fragment from the first row
// of data, without depending on WHERE the filer chose to break the line.
func pvTextHeaderWords(line string) bool {
	fields := strings.Fields(strings.ToUpper(line))
	if len(fields) == 0 {
		return false
	}
	for _, f := range fields {
		switch strings.Trim(f, ".,:") {
		case "ISSUER", "NAME", "TICKER", "CUSIP", "MTG", "DATE", "TYPE",
			"PROPOSAL", "VOTED?", "VOTED", "VOTE", "CAST", "MATTER", "FOR/AGNST", "FOR/", "AGNST",
			"MGMT", "FOR", "AGAINST", "<S>", "<C>", "<F>", "<FN>":
		default:
			return false
		}
	}
	return true
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
	// Look PAST blanks and page furniture for the next real line. The last echo of a
	// meeting is followed by a blank before the next meeting line, and stopping at
	// that blank rejected the echo as a continuation -- which closed the table. The
	// cost was severe and invisible: only the FIRST meeting of each section survived,
	// so one filing yielded 8 issuers out of 2,681 meetings.
	// Look past blanks, page furniture AND further unnumbered lines for the next real
	// row. A vote can be followed by a RUN of echo lines -- one filing prints three,
	// including a duplicate:
	//
	//	1.10   Elect Director Samuel Zell        MGMT  YES  FOR  FOR
	//	       Elect Director Lord James Blyth
	//	       Elect Director Lord James Blyth
	//	       Elect Director Samuel Zell
	//	1.20   Elect Director Robert L. Crandall MGMT  YES  FOR  FOR
	//
	// Stopping at the first of those found a line that was neither meeting nor item
	// and closed the table. The run is BOUNDED: what proves these are continuations
	// rather than the end of the report is that a real row follows within a few lines.
	for k := i + 1; k < len(lines) && k <= i+pvTextContinuationLookahead; k++ {
		t := strings.TrimSpace(lines[k])
		if t == "" || pvTextPageFurniture(t) {
			continue
		}
		if _, ok := pvTextMeetingLine(t); ok {
			return true
		}
		if f := strings.Fields(t); len(f) > 0 && pvTextItem(f[0]) {
			return true
		}
		// another unnumbered line: keep looking within the bound
	}
	return false
}

// pvTextMeetingLine locates the date/type pair rather than counting from the
// right: a wrapped header can leave trailing words on the same physical line as
// the meeting. The closed meeting-type vocabulary keeps this search out of prose.
func pvTextMeetingLine(line string) (pvTextMeeting, bool) {
	fields := strings.Fields(line)
	// A line that is a VOTE ROW is never a meeting. The caller tries meetings before
	// votes, and searching for the date rather than indexing from the end made a vote
	// row whose DESCRIPTION contains a date and a meeting-type word match here:
	//
	//	1.01 Approve 5/4/04 Annual Meeting MGMT YES FOR FOR
	//	  -> matched as a meeting, issuer "1.01"
	//
	// That loses the vote AND corrupts the meeting context for every row after it.
	//
	// The test is BOTH an item-shaped first token AND a parseable vote, not the item
	// token alone. Rejecting on the token alone cost 10,267 rows in one filing, because
	// issuers begin with numbers: `77 Bank 8341 J71348106 6/29/05 Annual` reads "77" as
	// an item and the meeting was declined, closing the table.
	if len(fields) > 0 && pvTextItemLoose(fields[0]) {
		if _, _, isVote := pvTextVoteParts(fields); isVote {
			return pvTextMeeting{}, false
		}
	}
	// Three fields is the floor, not five: a single-word issuer with no ticker and no
	// CUSIP prints `Accor  4/26/04  Special`. Requiring five declined it, which closed
	// the table. The strict CUSIP/ticker path below does its own bounds checking.
	if len(fields) < 3 {
		return pvTextMeeting{}, false
	}

	// Search from the right for a parseable date immediately followed by a CLOSED
	// meeting type. Words after that pair are wrapped header text, not identity fields.
	dateAt, date := -1, ""
	for i := len(fields) - 2; i >= 1; i-- {
		if parsed := htmlDate(fields[i]); parsed != "" && pvTextMeetingType(fields[i+1]) {
			dateAt, date = i, parsed
			break
		}
	}
	if dateAt < 0 {
		return pvTextMeeting{}, false
	}
	meetingType := fields[dateAt+1]

	// The CUSIP is the strongest identity anchor but it is NOT always printed:
	// foreign issuers can carry a ticker only, or neither ticker nor CUSIP.
	cusip, tickerAt := "", dateAt-2
	if dateAt >= 2 && pvTextCUSIP(fields[dateAt-1]) {
		cusip = fields[dateAt-1]
	} else {
		// No CUSIP column: the ticker sits directly before the date.
		tickerAt = dateAt - 1
	}
	if tickerAt < 1 || !pvTextTicker(fields[tickerAt]) {
		// Neither CUSIP nor ticker. Foreign issuers print only a name, a date and a
		// meeting type: `3I Group PLC (formerly Investors In Industry)  7/9/03  Annual`.
		// One filing of 16,259 vote lines yielded 70 rows because every one of its
		// meetings looks like this and none was recognised.
		issuerEnd := dateAt
		if cusip != "" {
			issuerEnd--
		}
		issuer := strings.Join(fields[:issuerEnd], " ")
		if issuer == "" {
			return pvTextMeeting{}, false
		}
		return pvTextMeeting{
			issuer:      issuer,
			cusip:       cusip,
			meetingDate: date,
			meetingType: meetingType,
		}, true
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
		meetingType: meetingType,
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

	// The VOTED? cell sits immediately right of the proponent. Recording it is
	// what makes an empty how_voted AFFIRMATIVE: `NO` says the fund declined to
	// vote, which is a fact the filing states, and without it such a row is
	// indistinguishable from one this parser failed on. Measured 2026-09-01 the
	// corpus carries 7,421 blank-vote pvtext rows and every one was classified
	// as an unexplained gap for exactly that reason. vanguard already carries
	// its own VOTED? column in this field.
	var voted string
	if p+1 < len(fields) {
		if up := strings.ToUpper(fields[p+1]); up == "YES" || up == "NO" {
			voted = fields[p+1]
		}
	}

	cast := strings.Join(rest, " ")
	if cast == "" {
		// Verbatim means verbatim: the filing printed no vote value here, so
		// how_voted stays EMPTY rather than being filled with an inferred `NOT VOTED`.
		// The row still records the proposal, its proponent and that it was reported.
		if p+1 >= len(fields) || strings.ToUpper(fields[p+1]) != "NO" {
			return VoteRow{}, false
		}
	} else if !pvTextVote(strings.ToUpper(cast)) {
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
		VoteOtherInfo:   voted,
	}, true
}

// pvTextVoteParts anchors on the proponent/voted pair rather than counting from
// the right. Multi-word vote values and an optional trailing vs-management field
// make fixed offsets ambiguous. The latter is not a manifest column.
func pvTextVoteParts(fields []string) (int, []string, bool) {
	if len(fields) < 5 || !pvTextItemLoose(fields[0]) {
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
	// A row where the fund did NOT vote prints no vote value at all:
	//	1.00   Receive Report of Management Board        MGMT   NO
	// The proposal was reported and the fund declined to vote, so there is nothing in
	// the vote column. Declining the line closed the table and cost the rest of the
	// document; one filing of 16,259 vote lines returned 70 rows because most of its
	// meetings are foreign proposals reported this way.
	if p < 1 {
		return 0, nil, false
	}
	if voteAt >= len(fields) {
		return p, nil, true
	}

	rest := fields[voteAt:]
	if len(rest) > 1 {
		// The vs-management indicator is spelled four ways in this corpus -- FOR,
		// AGNST, AGAINST and N/A. Stripping only the first two left `Withhold Against`
		// glued into one cast value, which matched no vocabulary, so the line was
		// declined and the table closed. Surveyed pairs include `WHOLD AGNST`,
		// `NOT VOTED AGAINST`, `AGNST N/A` and `FOR N/A`.
		switch strings.ToUpper(rest[len(rest)-1]) {
		case "FOR", "AGNST", "AGAINST", "N/A":
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

// pvTextMeetingType is the closed set of words this corpus prints after a meeting
// date. It exists so the CUSIP-less, ticker-less form of a meeting line is anchored
// on a vocabulary rather than on shape, which would otherwise admit prose.
func pvTextMeetingType(s string) bool {
	switch strings.ToUpper(strings.Trim(s, ".,")) {
	case "ANNUAL", "SPECIAL", "AGM", "EGM", "OGM", "MIX", "SPECIFIC",
		"COURT", "A", "S", "B", "C":
		return true
	}
	return false
}

// pvTextItemLoose accepts the item-number forms pvTextItem rejects. Surveyed over 30
// filings, the corpus prints N.NN 116,005 times but also bare integers 22,738 times,
// plus N.N (565) and N.NNN (73). A bare `1  Approve name change MGMT YES FOR FOR` was
// declined, and a declined line closes the table, so one such item cost the rest of
// its document.
//
// It is used ONLY by pvTextVoteParts, where the rest of the line must independently
// parse as a proponent, a voted flag and a vote value. Widening pvTextItem itself was
// tried and REVERTED: the strict form also gates the continuation guard and the wrap
// boundaries, and loosening it there sent one real slice from 1,370 rows to 214 while
// pushing another to 981 rows against 691 item lines -- inventing rows. The fixtures
// passed throughout; only the real slices showed it.
func pvTextItemLoose(s string) bool {
	if s == "" || len(s) > 8 {
		return false
	}
	dot := strings.IndexByte(s, '.')
	if dot == 0 || dot == len(s)-1 {
		return false
	}
	if dot > 0 && len(s)-dot-1 > 3 {
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

// pvTextAccountFund reads the fund a section opens with: `Account Number: JU77
// Alliance Growth Portfolio` above the header (SunAmerica Series Trust 2005,
// 28,965 rows with no fund on r207; 465,597 across the layout's declaring
// registrants). The account code stays in the name; the series dictionary
// reads past a leading code token.
func pvTextAccountFund(line string) (string, bool) {
	t := strings.TrimSpace(line)
	for _, label := range []string{"ACCOUNT NUMBER:", "ACCOUNT NAME:"} {
		if len(t) > len(label) && strings.EqualFold(t[:len(label)], label) {
			name := strings.TrimSpace(t[len(label):])
			return name, name != ""
		}
	}
	return "", false
}
