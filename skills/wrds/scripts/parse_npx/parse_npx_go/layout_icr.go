package main

import (
	"strings"
	"unicode"
)

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

// icrWrapLookahead bounds how many lines a description may span before its value
// columns arrive. Measured on 0000898432-08-000883, whose longest such run is
// four lines.
const icrWrapLookahead = 8

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

// icrFundNameLabel is the labelled line that names the fund a run of blocks
// belongs to. Measured 2026-08-31 over all 862 icr filings: 681 print it and
// 731 declare series in their SGML header, 575 doing both. It is a LABELLED
// field at column 0, not a heading inferred from position, which is why it can
// be trusted as evidence that a new fund section has begun.
const icrFundNameLabel = "FUND NAME"

// icrUnderscoreRule reports a rule of underscores, twenty at least.
// icrParentheticalNote reports a line that is wholly one parenthesised note.
func icrParentheticalNote(line string) bool {
	return len(line) > 2 && len(line) <= 300 && strings.HasPrefix(line, "(") && strings.HasSuffix(line, ")")
}

// icrSubadviserCaption reports the caption a Hartford HLS section prints under
// its fund banner naming the tranche's sub-adviser, in the spelling that carries
// no parentheses at all (`THIS PORTION SUB-ADVISED BY SSGA FUNDS MANAGEMENT
// INC.`, CIK 790558 2009). It names a MANAGER, never a registrant series, so it
// is an annotation on the banner above it exactly as the parenthesised spelling
// of the same sentence is.
func icrSubadviserCaption(line string) bool {
	l := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "(")))
	for _, lead := range []string{"this portion sub-advised by ", "this portion sub advised by ", "this portion subadvised by "} {
		if strings.HasPrefix(l, lead) {
			return true
		}
	}
	return false
}

// icrSectionNote reports the line at index k as commentary on the section rather
// than the name of its fund: a wholly parenthesised note, the unparenthesised
// sub-adviser caption, or the TAIL of either wrapped across two physical lines
// (`LLC)`). The tail is taken only when the line above it opens a parenthetical
// it never closes -- otherwise a name that merely ends in a bracket would be
// discarded as a note.
func icrSectionNote(lines []string, k int) bool {
	if k < 0 || k >= len(lines) {
		return false
	}
	line := strings.TrimSpace(lines[k])
	if icrParentheticalNote(line) || icrSubadviserCaption(line) {
		return true
	}
	if len(line) > 300 || !strings.HasSuffix(line, ")") || strings.Contains(line, "(") {
		return false
	}
	for j := k - 1; j >= 0 && j >= k-3; j-- {
		prev := strings.TrimSpace(lines[j])
		if prev == "" {
			continue
		}
		return strings.Contains(prev, "(") && !strings.Contains(prev, ")")
	}
	return false
}

func icrUnderscoreRule(line string) bool {
	if len(line) < 20 {
		return false
	}
	for i := 0; i < len(line); i++ {
		if line[i] != '_' {
			return false
		}
	}
	return true
}

// icrReportLine is the line one vintage prints directly under the fund name.
const icrReportLine = "Investment Company Report"

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

// icrBlockHeader recognises the identity header that opens every block. The
// three labels must be its FIRST THREE COLUMNS, which is what distinguishes this
// grammar's header from another that merely names the same things.
//
// Requiring the labels only to be PRESENT claimed a nine-cell header from an
// unrelated report --
//
//	INSTITUTIONAL ACCOUNT NAME  TICKER  COUNTRY  SECURITY ID  MEETING ID
//	  MEETING TYPE  MEETING DATE  RECORD DATE  STATUS
//
// -- and every row read out of it was wrong: measured 2026-08-30, that shape
// carried 1,882 rows whose how_voted held description text such as
// `Elect Director Orlando D. Ashford`. A wrong how_voted is worse than a missing
// one.
//
// Bounding the header's WIDTH instead would have excluded it too, and did for
// one run -- but it also declined 75 filings of this very grammar, whose own
// `MEETING STATUS` prints with a wide gap inside it and so arrives as two cells:
//
//	TICKER  SECURITY ID:  MEETING DATE  MEETING  STATUS
//
// Those 75 hold 1,014,379 vote-like lines. Anchoring on the first three columns
// admits them and still refuses the nine-cell header, because there TICKER is
// the second column and SECURITY ID the fourth.
func icrBlockHeader(cells []string) bool {
	if len(cells) < 3 {
		return false
	}
	label := func(i int) string {
		return strings.ToUpper(strings.TrimRight(strings.TrimSpace(cells[i]), ":"))
	}
	return label(0) == "TICKER" && label(1) == "SECURITY ID" && label(2) == "MEETING DATE"
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
		// One vintage prints TWO spaces between the scheme label and its value
		// (`ADTN  CUSIP  00738A106  05/04/2011`), so the Security ID column
		// arrives as two cells and the label lands where the ticker belongs.
		// Measured 2026-09-19 on 0000709364-11-000021: 1,312 of 1,902 meetings
		// carried the literal string CUSIP in the ticker column, while that
		// filing's CINS blocks, which print one space, kept their tickers.
		// Rejoining is safe because the label vocabulary is closed and the cell
		// must be the label ALONE -- no ticker is ever the string CUSIP.
		if i >= 2 && icrSchemeLabel(cells[i-2]) && icrBareID(m.securityID) {
			m.securityID = cells[i-2] + " " + m.securityID
			if i >= 3 {
				m.ticker = cells[i-3]
			}
			return m, true
		}
		if i >= 2 {
			m.ticker = cells[i-2]
		} else if i == 1 && pvTextTicker(m.securityID) && icrCUSIP(m.securityID) == "" && icrISIN(m.securityID) == "" {
			// A blank Security ID also collapses away; the sole non-ID
			// symbol before the date still belongs to the Ticker column.
			m.ticker, m.securityID = m.securityID, ""
		}
		return m, true
	}
	return icrMeeting{}, false
}

// icrSchemeLabel reports whether a cell is a Security ID scheme word standing
// alone. The vocabulary is closed on purpose.
func icrSchemeLabel(s string) bool {
	switch strings.ToUpper(strings.TrimRight(strings.TrimSpace(s), ":")) {
	case "CUSIP", "CINS", "ISIN", "SEDOL":
		return true
	}
	return false
}

// icrBareID reports whether a cell is an identifier value with no scheme word
// of its own: a single alphanumeric token of identifier length.
func icrBareID(s string) bool {
	if len(s) < 6 || len(s) > 12 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !(c >= '0' && c <= '9') && !isASCIILetter(c) {
			return false
		}
	}
	return true
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

// icrSupplement hands the icr blocks of a MIXED document to the icr reader
// after another layout has claimed it. The registry is first-match-wins, which
// is the wrong rule for a body printing two grammars: American Beacon Funds
// 2017 (0000809593-17-000064) prints 3,223 icr blocks and 191 labelvalue ones
// under the same `Fund Name:` label, and the 191 decide the filing because
// labelvalue sits five registry slots ahead of icr. Reordering only inverts the
// loss on a labelvalue-majority hybrid; reading BOTH grammars loses neither.
//
// A block the winner already read is never read again: the dedup key is the
// (fund, issuer, meeting date) the filing itself prints, so an icr block is read
// once each and a pure labelvalue/issnpx document whose winner covered every
// block gains nothing. The FUND is part of the key because one meeting is voted
// by many funds in these reports -- keying on the meeting alone would suppress
// every fund's block after the first. matchICR is the gate -- it needs a block
// header with a resolvable identity line under it -- so a body with no icr
// grammar in it is never handed to parseICR at all.
func icrSupplement(rows []VoteRow, text string, meta FilingMeta) []VoteRow {
	if !matchICR(text) {
		return rows
	}
	extra, err := parseICR(text, meta)
	if err != nil || len(extra) == 0 {
		return rows
	}
	seen := make(map[[3]string]bool, len(rows))
	for _, r := range rows {
		seen[icrSupplementKey(r)] = true
	}
	for _, r := range extra {
		if seen[icrSupplementKey(r)] {
			continue
		}
		rows = append(rows, r)
	}
	return rows
}

func icrSupplementKey(r VoteRow) [3]string {
	return [3]string{
		strings.ToUpper(strings.TrimSpace(r.FundName)),
		strings.ToUpper(strings.TrimSpace(r.IssuerName)),
		r.MeetingDate,
	}
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
func icrVoteRow(cells []string, m icrMeeting, series, fund string) (VoteRow, bool) {
	// The length guard comes FIRST: cells can be empty, and reading cells[0]
	// before checking that panics the whole binary, which surfaces as a filing
	// yielding zero rows rather than as a crash.
	if len(cells) < icrColumns-1 || !icrItem(cells[0]) {
		return VoteRow{}, false
	}
	// THE DESCRIPTION COLUMN IS PADDED, so a description that exactly FILLS it
	// leaves one space before the proponent and the two-space cell split merges
	// the two:
	//
	//	1   Elect Pierre R. Brondeau Mgmt   For   For   For    <- one space, merged
	//	2   Elect Juergen W. Gromer  Mgmt   For   For   For    <- two, splits
	//
	// The merged row is one cell short and was rejected outright, so a filing lost
	// exactly those rows whose description happened to reach the column width --
	// scattered, never a run, which is why it reads as noise rather than a bug.
	// Measured 2026-09-01 on 0001193125-15-307095: TE Connectivity read 31 items
	// where ISS records 36, missing 1, 3, 10, 16 and 36, every one of them a
	// column-filling description.
	//
	// Only a known proponent word is peeled, so a description can never be
	// truncated by this: the proponent column's vocabulary is closed.
	if len(cells) == icrColumns-1 {
		if head, prop := icrPeelProponent(cells[len(cells)-4]); prop != "" {
			merged := append([]string{}, cells[:len(cells)-4]...)
			merged = append(merged, head, prop)
			cells = append(merged, cells[len(cells)-3:]...)
		}
	}
	if len(cells) < icrColumns {
		return VoteRow{}, false
	}
	n := len(cells)
	description := strings.Join(cells[1:n-4], " ")
	return VoteRow{
		IssuerName:  m.issuer,
		CUSIP:       icrCUSIP(m.securityID),
		ISIN:        icrISIN(m.securityID),
		Ticker:      m.ticker,
		MeetingDate: m.meetingDate,
		MeetingType: m.meetingType,
		SeriesID:    series, FundName: fund,
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

// icrISIN returns the ISIN token in a Security ID cell, if any: two letters,
// nine alphanumerics, a check digit. Foreign issuers file with an ISIN in the
// Security ID field and no CUSIP at all (College Retirement Equities Fund
// 2007: 47,660 rows with no id on 2026-09-02).
func icrISIN(cell string) string {
	for _, f := range strings.Fields(cell) {
		if isinToken(f) {
			return f
		}
	}
	return ""
}

func isinToken(s string) bool {
	if len(s) != 12 || !isASCIILetter(s[0]) || !isASCIILetter(s[1]) || s[11] < '0' || s[11] > '9' {
		return false
	}
	for i := 2; i < 11; i++ {
		c := s[i]
		if !(c >= '0' && c <= '9') && !isASCIILetter(c) {
			return false
		}
	}
	return true
}

func parseICR(text string, meta FilingMeta) ([]VoteRow, error) {
	lines := strings.Split(text, "\n")
	// Built ONCE per filing: these filings reach 171,705 vote-like lines, and a
	// per-section rebuild would make the job quadratic in the body.
	seriesIx := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))
	issFormerKeys(seriesIx, meta.FormerNames)
	// Donors are collected before any fill; conflicting identities stay blank.
	identities := make(map[[2]string][3]string)
	conflicts := make(map[[2]string]bool)
	identityKey := func(issuer, date string) [2]string {
		return [2]string{strings.TrimRight(strings.TrimSpace(issuer), ".,;:!? "), date}
	}
	var (
		rows    []VoteRow
		meeting icrMeeting
		haveMtg bool
		// curSeries is the fund the following blocks belong to. It is STATE: one
		// `Fund Name :` line governs every block until the next one, exactly as
		// the fund heading does in the broadridge layout.
		curSeries string
		// curFund is the fund name as the filing printed it, recorded on every
		// row of the section so an unattributed section is still visible as
		// unmatched rather than unnamed.
		curFund string
		// fundFromBanner records that the carried fund came from a '=====' banner
		// rule, the one grammar in which a bare rule is a section end. Under the
		// labelled grammar a bare rule is the divider between issuer blocks
		// (Royce Fund 2011) and must not clear the fund.
		fundFromBanner bool
		// prevText is the previous non-blank line, for the vintage that names
		// the fund on the line above its Investment Company Report line, and
		// prevTextLine the line it was read from, so a heading test can tell
		// whether that line belongs to the proposal row still open.
		prevText     string
		prevTextLine = -1
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
		// Read before this line is classified, so the heading test sees the line above it.
		lineAbove, lineAboveIdx := prevText, prevTextLine
		if line != "" {
			prevText, prevTextLine = line, i
		}
		cells := icrCells(line)

		// THE ISS REPORT HEADER CLOSES ANY OPEN ICR BLOCK. A mixed document
		// prints both grammars, and this one's block is opened by a header line
		// and closed only by the next one -- a marker the ISS grammar never
		// prints. Left open, the last vendor block of an icr section stamps its
		// issuer, CUSIP and meeting date on every item-shaped line of every ISS
		// meeting behind it (Vantagepoint Funds 2014, 1,681 rows, 1,412 of them
		// with no series, duplicating a region the labelvalue layout already read
		// correctly). The `FORM N-Px REPORT` banner is the ISS report's own
		// header: no icr block can span it, so the open meeting ends here.
		if isISSReportBanner(line) {
			haveMtg = false
			lastRow, lastLine = -1, -2
			continue
		}

		// THE FUND SECTION MARKER. Resolution is by EXACT normalised equality
		// against a <SERIES-NAME> the filing itself declares -- never the
		// tolerant lookup, whose leading-code strip errs about 1 in 25, which is
		// the wrong trade for a link key: a blank series_id costs coverage, a
		// WRONG one silently files this fund's votes under another fund.
		//
		// An unresolved marker CLEARS rather than leaving the previous fund
		// standing. Both nil cases clear and for the same reason: the filing has
		// said a new section began, so whatever governed the section above cannot
		// govern this one. Carrying it forward is precisely the silent transfer
		// between funds this rule exists to prevent.
		if name, ok := icrFundName(line); ok {
			curFund = name
			curSeries = icrResolveFundShared(seriesIx, name)
			// The value WRAPS, with the filing's own blank line between the
			// halves (`Fund Name: RETFT Russell 2000 High` / `Volatility ETF`,
			// Russell Exchange Traded Funds Trust 2013, 703 rows). The first
			// line alone is a stem three declared series share; the
			// continuation names the fund exactly. Joined only when the label
			// line does not resolve on its own and the joined value does, so a
			// resolved section is never re-read.
			if curSeries == "" && name != "" {
				if joined, id := icrJoinWrappedFundValue(seriesIx, lines, i, name); id != "" {
					curFund, curSeries = joined, id
				}
			}
			fundFromBanner = false
		} else if icrUnderscoreRule(line) && lineAbove != "" && !(lastRow >= 0 && lineAboveIdx == lastLine) && icrResolveFundShared(seriesIx, lineAbove) != "" {
			// Another vintage names the fund on the bare line ABOVE a rule of
			// underscores (T. Rowe Price Index Trust, 2026-09-02). The rule is
			// the marker, and the line is taken only when it resolves to a
			// declared series -- the header's own evidence -- so an issuer name
			// above the same rule is never mistaken for a fund.
			//
			// A line that belongs to the proposal row still open is refused
			// BEFORE it is offered to the resolver. This filing also prints the
			// rule as the divider between issuer blocks, so when the block it
			// closes ends on a wrapped continuation the line above is that
			// wrap's tail (`2020`), which a dictionary spelling of the section's
			// own fund answers. A continuation is never a banner, and whether it
			// resolves is not evidence that it is one.
			curFund = lineAbove
			curSeries = icrResolveFundShared(seriesIx, lineAbove)
		} else if strings.EqualFold(line, icrReportLine) && lineAbove != "" {
			// One vintage names the fund on a bare line ABOVE its `Investment
			// Company Report` line (Hartford Mutual Funds, ~180k rows with no
			// fund read, 2026-09-02). The report line is the marker; the line
			// above it is the name, resolved like any other heading.
			curFund = lineAbove
			if icrSectionNote(lines, lineAboveIdx) {
				// A note -- a merger successor, a sub-adviser attribution, in or
				// out of parentheses -- is commentary on the section, not its
				// fund. Skip the notes and read the first line above them.
				curSeries = ""
				for k := i - 1; k >= 0 && k >= i-6; k-- {
					candidate := strings.TrimSpace(lines[k])
					if candidate == "" || icrSectionNote(lines, k) {
						continue
					}
					if id := icrResolveFundShared(seriesIx, candidate); id != "" {
						curFund, curSeries = candidate, id
					}
					break
				}
			} else {
				curSeries = icrResolveFundShared(seriesIx, lineAbove)
			}
		} else if name, ok := issFundSeparator(line); ok {
			// The '=====' banner rule the ISS report opens a fund with, printed
			// by one registrant in this grammar too (the College Retirement
			// Equities Fund, 6.2M rows with no fund name read, 2026-09-02). A
			// structural marker, resolved like the labelled line; a bare rule
			// with no name clears a fund a banner set, and is only the divider
			// between issuer blocks under a `Fund Name :` label.
			if name != "" {
				curFund, curSeries = name, icrResolveFundShared(seriesIx, name)
				fundFromBanner = true
			} else if fundFromBanner {
				curFund, curSeries = "", ""
			}
			continue
		} else if icrItemOneMarker(line) {
			// Hartford's HLS reports open each sub-adviser tranche with an
			// `ITEM 1: PROXY VOTING RECORD` line and print the fund name on the
			// first line below it (CIK 790558, 2007, 3,085 rows with no series).
			// The marker is the line; the name below it is resolved like any
			// other heading, and adopted only when it resolves -- so the
			// `This portion sub-advised by ...` line that follows the name names
			// a manager, never a series, and nothing is cleared.
			if name, ok := icrHeadingBelowMarker(lines, i); ok {
				if id := icrResolveFundShared(seriesIx, name); id != "" {
					curFund, curSeries = name, id
					fundFromBanner = false
				}
			}
		} else if icrReportPeriodLine(line) {
			// Neuberger Berman heads each section with a bare fund line above the
			// reporting period and no rule or label at all, and wraps a rename
			// parenthetical across two physical lines:
			//
			//	Neuberger Berman Small and Mid Cap Growth Fund (formerly, Neuberger Berman All
			//	Cap Growth Fund)
			//
			// The period line is the marker; the name above it is rejoined and
			// resolved like any other heading (S000013239, 1,002 rows with no fund).
			// It is adopted only when it resolves, so an issuer printed above the
			// same line is never mistaken for a fund and nothing is cleared.
			if name, ok := icrHeadingAbovePeriod(lines, i); ok {
				if id := icrResolveFundShared(seriesIx, name); id != "" {
					curFund, curSeries = name, id
					fundFromBanner = false
				}
			}
		}

		if icrBlockHeader(cells) {
			for k := i + 1; k < len(lines) && k <= i+3; k++ {
				next, ok := icrIdentity(icrCells(strings.TrimSpace(lines[k])))
				if !ok {
					continue
				}
				next.issuer = icrIssuerAbove(lines, i)
				key := identityKey(next.issuer, next.meetingDate)
				id := [3]string{icrCUSIP(next.securityID), icrISIN(next.securityID), next.ticker}
				if key[0] != "" && key[1] != "" && (id[0] != "" || id[1] != "") {
					if prev, ok := identities[key]; ok && prev != id {
						conflicts[key] = true
					}
					identities[key] = id
				}
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

		if row, ok := icrVoteRow(cells, meeting, curSeries, curFund); ok {
			rows = append(rows, row)
			lastRow, lastLine = len(rows)-1, i
			continue
		}

		// AN INVERTED WRAP -- the item number and the start of its description
		// sit alone and the value columns arrive on a later line:
		//
		//	3   APPROVAL OF INDEPENDENT REGISTERED PUBLIC ACCOUNTING
		//	    FIRM.                                Mgmt   For   For   For
		//
		// The columns are read from the accumulated cells exactly as on a
		// single-line row, so nothing about how a value is chosen changes here.
		// Bounded on both sides: the run stops at the next item number, so a
		// following row can never be absorbed into this one, and a row is taken
		// only after a line that carries the value columns itself.
		if len(cells) > 0 && icrItem(cells[0]) {
			joined, wrapped := cells, false
			for k := i + 1; k < len(lines) && k <= i+icrWrapLookahead; k++ {
				next := icrCells(strings.TrimSpace(lines[k]))
				if len(next) == 0 || icrItem(next[0]) || icrBlockHeader(next) {
					break
				}
				joined = append(joined, next...)
				if len(next) < icrColumns-2 {
					continue // this line carried no value columns
				}
				if row, ok := icrVoteRow(joined, meeting, curSeries, curFund); ok {
					rows = append(rows, row)
					lastRow, lastLine = len(rows)-1, k
					i, wrapped = k, true
					break
				}
			}
			if wrapped {
				continue
			}
		}

		// A DESCRIPTION CONTINUATION: an unnumbered fragment on the line directly
		// under its row. Anchored by line adjacency rather than by content, so a
		// fragment can carry any words at all without a vocabulary deciding
		// whether it belongs -- and prose that is merely NEAR a row never does.
		//
		// An item-LOOKING fragment (`2020`, the tail of `Personnel Option Plan
		// 2020`) reaches here only after the inverted-wrap branch above failed
		// to turn it into a row of its own, so on this line adjacency it is the
		// open row's tail, not a new item. Appending it also advances lastLine,
		// which keeps any further continuation behind it anchored.
		if lastRow >= 0 && i == lastLine+1 && len(cells) == 1 {
			rows[lastRow].VoteDescription += " " + cells[0]
			lastLine = i
		}
	}

	if len(rows) == 0 {
		return nil, errLayoutDeclined
	}
	for i := range rows {
		r := &rows[i]
		if r.CUSIP != "" || r.ISIN != "" {
			continue
		}
		key := identityKey(r.IssuerName, r.MeetingDate)
		id, ok := identities[key]
		if !ok || conflicts[key] || (r.Ticker != "" && r.Ticker != id[2]) {
			continue
		}
		r.CUSIP, r.ISIN = id[0], id[1]
		if r.Ticker == "" {
			r.Ticker = id[2]
		}
	}
	return rows, nil
}

// isISSReportBanner reports whether a line is the ISS report's own header rule,
// `***** FORM N-Px REPORT *****`. The same text is what matchISSNPX and
// issSkippableHeader key on; here it is a section boundary rather than a
// signature.
func isISSReportBanner(line string) bool {
	return strings.Contains(strings.ToUpper(line), "FORM N-PX REPORT")
}

// icrReportPeriodLine reports whether a line is nothing but the section's
// reporting period: `07/01/2007 - 06/30/2008`. Some filers separate the two
// dates with a double hyphen instead -- `JULY 1, 2010 -- JUNE 30, 2011`
// (Vantagepoint Funds, CIK 1066980) -- which parseLabelValue already allows.
// Both halves must still be dates, so a line carrying a stray dash is refused.
func icrReportPeriodLine(line string) bool {
	for _, sep := range [...]string{" -- ", " - "} {
		head, tail, ok := strings.Cut(line, sep)
		if !ok {
			continue
		}
		if htmlDate(strings.TrimSpace(head)) != "" && htmlDate(strings.TrimSpace(tail)) != "" {
			return true
		}
	}
	return false
}

// icrItemOneMarker reports whether a line is nothing but the N-PX item heading
// `ITEM 1: PROXY VOTING RECORD`, matched on the collapsed line so neither case
// nor the spacing around the colon decides whether a section is seen. Nothing
// but that heading matches: a line carrying any further text is refused, so a
// proposal description mentioning the phrase cannot open a fund section.
func icrItemOneMarker(line string) bool {
	return strings.EqualFold(strings.Join(strings.Fields(line), " "), "ITEM 1: PROXY VOTING RECORD")
}

// icrHeadingBelowMarker returns the nearest nonblank line below a marker line,
// refused when it is a table marker or a labelled field rather than a name.
func icrHeadingBelowMarker(lines []string, i int) (string, bool) {
	for k := i + 1; k < len(lines) && k <= i+3; k++ {
		name := strings.TrimSpace(lines[k])
		if name == "" {
			continue
		}
		if strings.ContainsAny(name, ":<") {
			return "", false
		}
		return name, true
	}
	return "", false
}

// icrHeadingAbovePeriod returns the nearest nonblank line above a reporting
// period line, rejoined with the line above IT when the slot closes a
// parenthesis it never opened -- the filer wrapped a `(formerly, ...)` marker
// mid-parenthetical and the head of the name is on the previous line.
func icrHeadingAbovePeriod(lines []string, i int) (string, bool) {
	k := i - 1
	for k >= 0 && strings.TrimSpace(lines[k]) == "" {
		k--
	}
	if k < 0 {
		return "", false
	}
	name := strings.TrimSpace(lines[k])
	if strings.Count(name, ")") > strings.Count(name, "(") && k > 0 {
		prev := strings.TrimSpace(lines[k-1])
		if prev == "" || strings.Count(prev, "(") <= strings.Count(prev, ")") {
			return "", false
		}
		name = prev + " " + name
	}
	if name == "" || strings.HasPrefix(name, "<") {
		return "", false
	}
	return name, true
}

// icrFundName reads the labelled fund-section marker, returning the name it
// prints. The label is matched on the normalised line so the spacing around the
// colon -- `Fund Name : X`, `Fund Name:X` -- cannot decide whether a section is
// seen. An EMPTY value still reports ok: the filing has opened a section it
// declines to name, which must clear the carried fund rather than be ignored.
func icrFundName(line string) (string, bool) {
	colon := strings.IndexByte(line, ':')
	if colon < 0 {
		return "", false
	}
	label := strings.TrimSpace(line[:colon])
	// `Portfolio Name :` is the same label under the other noun (Ohio
	// National Fund, 2026-09-02).
	if !strings.EqualFold(label, icrFundNameLabel) && !strings.EqualFold(label, "PORTFOLIO NAME") {
		return "", false
	}
	return strings.TrimSpace(line[colon+1:]), true
}

// icrJoinWrappedFundValue reads the continuation of a wrapped `Fund Name:`
// value: the first nonblank line below the label, taken only when it is not
// itself a labelled field or a table marker, and only when the joined value
// resolves to a declared series.
func icrJoinWrappedFundValue(ix *issSeriesIndex, lines []string, i int, name string) (string, string) {
	for k := i + 1; k < len(lines) && k <= i+3; k++ {
		cont := strings.TrimSpace(lines[k])
		if cont == "" {
			continue
		}
		if strings.ContainsAny(cont, ":<") {
			return "", ""
		}
		joined := name + " " + cont
		return joined, icrResolveFundShared(ix, joined)
	}
	return "", ""
}

// icrResolveFundShared is icrResolveFund followed, when it resolves nothing,
// by the rule chain the ISS layout gained on 2026-09-02 (the registrant's
// tokens or initials as a brand, the last word every declared series shares,
// a dash sleeve, a trailing parenthetical). The College Retirement Equities
// Fund's icr-era reports print `CREF Equity Index` for a declared `Equity
// Index Account`: 1.9M rows this layout could name but not resolve. The
// chain fires only for a name the header does not declare, so icrResolveFund's
// refusal of an ambiguous declared name stands.
func icrResolveFundShared(ix *issSeriesIndex, name string) string {
	// The filing's own declarations answer first, with the dictionary
	// unreadable: a dictionary rung may only fill a heading they leave blank.
	// See issSeriesIndex.hdrOnly.
	if ix != nil && ix.hdrOnly != nil {
		if id := icrResolveFundShared(ix.hdrOnly, name); id != "" {
			return id
		}
	}
	if id := icrResolveFundVintage(ix, ix.byName, name); id != "" {
		// Its own first rung is the exact route; every rung after it cuts the
		// printed name. An INEXACT answer of this registrant's own does not
		// outrank an exact, corpus-unique, contemporaneous sibling hit.
		if !issBannerDeclaredExact(ix, name) {
			if d := issIndexDict(ix).crossCIK(ix.cik, name, ix.period, ix.registrantKey); d != nil {
				return d.SeriesID
			}
		}
		return id
	}
	if _, d := issResolveFund(ix, name); d != nil {
		return d.SeriesID
	}
	// Both registrant-scoped chains have refused: the heading may name a fund
	// of a SIBLING registrant, admitted only on an exact, corpus-wide unique
	// dictionary hit under one other CIK (cikSeries.crossCIK).
	if d := issIndexDict(ix).crossCIK(ix.cik, name, ix.period, ix.registrantKey); d != nil {
		return d.SeriesID
	}
	return ""
}

// icrMinSuffixWords is the shortest declared name a printed fund name may be
// resolved to by suffix. Two, because a one-word declared name -- `Fund`,
// `Trust` -- is the last word of almost every fund name in the corpus, and
// matching on it would attribute a whole section to whichever series happened to
// be spelled that way.
const icrMinSuffixWords = 2

// icrResolveFund maps a printed `Fund Name :` value onto a series the filing
// declares, returning "" when it cannot do so honestly.
//
// EXACT FIRST. 575 of the 862 icr filings print this line and declare series,
// and for most the printed name IS the declared name.
//
// THEN LONGEST SUFFIX, because a large minority print a marketing prefix the
// header does not carry. Measured on 0001193125-16-697187, which declares 41
// series and prints 41 fund names, none of them equal:
//
//	printed  `RIC LifePoints Funds 2020 Strategy Fund`
//	declared `2020 Strategy Fund`
//
// The prefix is several words, so the chassis tolerance -- which drops ONE
// leading internal code -- does not reach it, and that filing alone leaves
// 147,136 rows unattributed.
//
// Leading tokens are dropped one at a time and the FIRST hit wins, so the match
// is always the LONGEST declared name that ends the printed one. That ordering
// is what keeps `Moderate Growth Strategy Fund` from resolving to a declared
// `Growth Strategy Fund` while both are declared.
//
// AMBIGUITY REFUSES RATHER THAN GUESSES. seriesByName maps a normalised name
// that two distinct series answer to onto nil-but-declared, and this stops there
// instead of stripping further: continuing would convert the collision rule's
// deliberate refusal into a stamp, which is the silent transfer between funds
// that rule exists to prevent. An unresolved name returns "" and the caller
// CLEARS, so the section above never governs the section below.
func icrResolveFund(idx map[string]*SeriesDecl, printed string) string {
	return icrResolveFundVintage(nil, idx, printed)
}

// icrResolveFundVintage is icrResolveFund with the filing's own index in hand,
// so the declared-side suffix walk can refuse a spelling the filing could not
// have known. ix is nil for a caller that holds only the name map, and the
// vintage refusal is then not made.
func icrResolveFundVintage(ix *issSeriesIndex, idx map[string]*SeriesDecl, printed string) string {
	fields := strings.Fields(printed)
	for k := 0; k+icrMinSuffixWords <= len(fields); k++ {
		d, declared := lookupSeriesEntry(idx, strings.Join(fields[k:], " "))
		if d != nil {
			return d.SeriesID
		}
		if declared {
			return "" // the filing names this section and refuses to say which fund
		}
	}
	if id := icrResolveDeclaredSuffix(ix, idx, printed, len(fields)); id != "" {
		return id
	}
	if id := icrResolveQualified(ix, idx, printed); id != "" {
		return id
	}
	return icrResolveInteriorStyleWord(ix, printed)
}

// icrQualifierDelim introduces a trailing ANNOTATION rather than part of the
// fund's name:
//
//	FIDELITY EMERGING MARKETS INDEX FUND - SUB-ADVISER: GEODE
//	declared `Fidelity Emerging Markets Index Fund`
//
// Measured 2026-08-31 on 0000035315-23-000529, which prints 85 fund headings
// against 85 declared series: 49 resolved without this, 35 more resolve with it,
// and the one remainder was an artefact of reading raw bytes rather than the
// decoded text the layout actually sees.
const icrQualifierDelim = " - "

// icrResolveQualified drops a dash-delimited trailing annotation and resolves
// what is left. It is deliberately NOT the mirror of the leading-token walk:
// leading words in this corpus are marketing prefixes, but TRAILING words are
// what DISTINGUISH funds -- `Fund II`, `Class A`, `2020 Strategy Fund` -- so
// stripping bare trailing tokens would collapse genuinely different series onto
// each other. Requiring the ` - ` delimiter is what keeps this to annotations,
// and `SMALL-MID CAP` is untouched because its hyphen carries no spaces.
//
// Candidate heads are tried LONGEST first, and each is resolved through the full
// rule above, so a head still has to match exactly or by a unique suffix.
func icrResolveQualified(ix *issSeriesIndex, idx map[string]*SeriesDecl, printed string) string {
	for cut := strings.LastIndex(printed, icrQualifierDelim); cut > 0; {
		head := strings.TrimSpace(printed[:cut])
		if fields := strings.Fields(head); len(fields) >= icrMinSuffixWords {
			if d, _ := lookupSeriesEntry(idx, head); d != nil {
				return d.SeriesID
			}
			if id := icrResolveDeclaredSuffix(ix, idx, head, len(fields)); id != "" {
				return id
			}
		}
		next := strings.LastIndex(printed[:cut], icrQualifierDelim)
		if next <= 0 {
			break
		}
		cut = next
	}
	return ""
}

// icrStyleConnectors are the lowercase words a multi-word style slot may carry
// INSIDE it (`Growth and Income`). A candidate prefix may never begin or end on
// one.
var icrStyleConnectors = map[string]bool{"and": true, "of": true, "the": true}

// icrStyleWord reports whether a printed token is a style word -- one initial
// capital and lowercase letters after it (`Conservative`, `Moderate`, `Income`).
// An all-caps or digit-bearing token (`LV`, `LB`, `MID`, `WS`, `SB`, `MUTUAL`,
// `IPB`, `FUNDS`) is NOT one, which is what ends the leading run.
func icrStyleWord(tok string) bool {
	rs := []rune(tok)
	if len(rs) < 2 || !unicode.IsUpper(rs[0]) {
		return false
	}
	for _, r := range rs[1:] {
		if !unicode.IsLetter(r) || unicode.IsUpper(r) {
			return false
		}
	}
	return true
}

// icrHeaderDecls is the filing's OWN declared series, or nil when this index's
// declaration set has been widened by the corpus dictionary. issFilingIndex
// folds dictionary aliases into the outer index and keeps the unwidened set on
// hdrOnly, so the set is the header's exactly when the dictionary is unreadable
// here (noDict) or was never loaded (no hdrOnly to hold it).
func icrHeaderDecls(ix *issSeriesIndex) *issSeriesIndex {
	if ix == nil || len(ix.decls) == 0 {
		return nil
	}
	if ix.noDict || ix.hdrOnly == nil {
		return ix
	}
	return nil
}

// icrResolveInteriorStyleWord resolves a banner that prints only the STYLE SLOT
// of a manager-of-managers portfolio plus a sub-adviser code. Pax World Funds
// Series Trust I (CIK 0000076721) prints one section per (portfolio,
// sub-adviser) pair and heads each `Conservative LV Clear Bridge`, `Moderate
// MUTUAL FUNDS`, `Growth and Income LB Pax World` -- never the declared `ESG
// Managers <Style> Portfolio`. The style word sits in the INTERIOR of the
// declared name, which no rung above reaches: the leading-token walk lifts
// tails, the declared-suffix mirror matches ends, and the qualified rung needs
// a ` - ` this line does not have. 5,062 rows across two filings.
//
// THE FILING'S OWN HEADER IS THE ONLY EVIDENCE ADMITTED. This registrant's
// dictionary SHUFFLES which id owns which style word across vintages --
// S000027264 is `ESG Managers Conservative Portfolio` at 20100630 and `ESG
// Managers Income Portfolio` at 20130630 -- so a style word resolved against
// the corpus would attribute one filing's sections to another filing's id.
// icrHeaderDecls is what keeps the candidate set to the series THIS filing
// declares.
//
// UNIQUENESS AND WORD BOUNDARY DO THE REST. The leading run of style words is
// tried longest first (`Growth and Income` before `Growth`), matched as a whole
// TOKEN sequence strictly inside a declared name -- a token before it and a
// token after it -- and resolved only when exactly ONE declared name answers.
// Two declared names carrying the same style word refuse rather than pick, so a
// `Balanced` that is interior to both `ESG Managers Balanced Portfolio` and a
// sibling `PAX WORLD BALANCED FUND` stays blank instead of being guessed.
func icrResolveInteriorStyleWord(ix *issSeriesIndex, printed string) string {
	hdr := icrHeaderDecls(ix)
	if hdr == nil {
		return ""
	}
	fields := strings.Fields(printed)
	// The leading run ends at the first token that is neither a style word nor
	// an interior connector; with no such token the banner is a plain name, not
	// a style slot followed by a code, and this rung has nothing to say.
	run := 0
	for run < len(fields) && (icrStyleWord(fields[run]) || icrStyleConnectors[strings.ToLower(fields[run])]) {
		run++
	}
	if run == 0 || run >= len(fields) {
		return ""
	}
	for k := run; k >= 1; k-- {
		if !icrStyleWord(fields[0]) || !icrStyleWord(fields[k-1]) {
			continue
		}
		if id := icrInteriorUnique(hdr, strings.Fields(normalizeSeriesName(strings.Join(fields[:k], " ")))); id != "" {
			return id
		}
	}
	return ""
}

// icrInteriorUnique returns the one declared series whose normalised name
// carries toks as a strictly interior token run, or "" when none or more than
// one does.
func icrInteriorUnique(ix *issSeriesIndex, toks []string) string {
	if len(toks) == 0 {
		return ""
	}
	found := ""
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || icrFutureDeclName(ix, d) {
			continue
		}
		if !icrInteriorRun(ix.declToks(i), toks) {
			continue
		}
		if found != "" && found != d.SeriesID {
			return "" // two declared funds carry this style word; refuse to pick
		}
		found = d.SeriesID
	}
	return found
}

// icrInteriorRun reports whether toks occurs in decl as a whole-token run with
// at least one token before it and one after it.
func icrInteriorRun(decl, toks []string) bool {
	for start := 1; start+len(toks) < len(decl); start++ {
		hit := true
		for j, t := range toks {
			if decl[start+j] != t {
				hit = false
				break
			}
		}
		if hit {
			return true
		}
	}
	return false
}

// icrResolveDeclaredSuffix is the MIRROR of the walk above, for the filings that
// carry the prefix on the DECLARED side instead of the printed one. Measured on
// 0001135428-23-000250, which declares 28 series and prints 27 fund names, none
// of them equal and none reachable by stripping the printed name:
//
//	printed  `LONG DURATION FUND`
//	declared `SIIT LONG DURATION FUND`
//
// That filing alone leaves 156,184 rows unattributed under the printed-side rule.
//
// The safety argument cannot be borrowed from above, because there the exact-key
// lookup did the work and seriesByName's collision rule guarded ambiguity for
// free. Here the candidate set is scanned, so uniqueness is enforced HERE: a
// printed name that ends more than one declared name resolves to nothing rather
// than to whichever was seen first. Matching is on a WORD boundary, so `Bond
// Fund` cannot match `Municipal Bond Fund` by accident of spelling, and the
// two-word floor still applies.
func icrResolveDeclaredSuffix(ix *issSeriesIndex, idx map[string]*SeriesDecl, printed string, words int) string {
	if words < icrMinSuffixWords {
		return ""
	}
	key := normalizeSeriesName(printed)
	if key == "" {
		return ""
	}
	found := ""
	for declaredName, d := range idx {
		if d == nil || !strings.HasSuffix(declaredName, " "+key) {
			continue
		}
		// The declared spelling that carries the suffix post-dates the filing:
		// `BALANCED FUND` ends only the 20110630 alias `Sterling Capital
		// Strategic Allocation Balanced Fund`, whose id S000003554 was named
		// `BB&T Capital Manager Moderate Growth Fund` at the 20040630 period of
		// report -- a fund that filing prints as its own section. The suffix
		// walk's uniqueness guard cannot see seven years forward, so the vintage
		// refusal issFutureVintage makes for an exact hit is made here too.
		if icrFutureDeclName(ix, d) {
			continue
		}
		if found != "" && found != d.SeriesID {
			return "" // more than one declared fund ends this way; refuse to pick
		}
		found = d.SeriesID
	}
	return found
}

// icrFutureDeclName is issFutureVintage at NAME granularity: the declared
// spelling itself post-dates the filing's period of report, and post-dates the
// earliest vintage this registrant carries at all. The second half is what keeps
// a pre-2006 filing resolving, since series identifiers begin in 2006 and every
// dictionary row such a filing reads post-dates it.
func icrFutureDeclName(ix *issSeriesIndex, d *SeriesDecl) bool {
	if ix == nil || d == nil || len(d.DeclDate) != 8 || len(ix.period) != 8 || d.DeclDate <= ix.period {
		return false
	}
	earliest := ""
	for i := range ix.decls {
		if x := &ix.decls[i]; len(x.DeclDate) == 8 && (earliest == "" || x.DeclDate < earliest) {
			earliest = x.DeclDate
		}
	}
	return earliest != "" && d.DeclDate > earliest
}

// icrPeelProponent splits a trailing proponent word off a cell that merged the
// description and proponent columns. Returns the description and the proponent,
// or the cell unchanged and "" when the last word is not a proponent.
func icrPeelProponent(cell string) (head, proponent string) {
	fields := strings.Fields(cell)
	if len(fields) < 2 {
		return cell, ""
	}
	last := strings.ToLower(fields[len(fields)-1])
	for _, p := range lvProponents {
		if last == p {
			return strings.Join(fields[:len(fields)-1], " "), fields[len(fields)-1]
		}
	}
	return cell, ""
}
