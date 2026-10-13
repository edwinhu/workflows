package main

import "strings"

// twoband reads the First Trust plain-text record, whose grammar is TWO
// ALTERNATING COLUMN HEADERS reprinted before every meeting rather than one
// header over a table:
//
//	MEETING DATE       COMPANY                  TICKER     SECURITY ID
//	07/10/12           The Coca-Cola Company    KO         191216100
//
//	ITEM NUMBER        AGENDA ITEM              MGMT REC   VOTE CAST   PROPONENT
//	1                  Approve Stock Split      For        For         Mgmt
//
// pvtext is the layout for a two-band shape, but its meeting band is pinned to
// `ISSUER NAME TICKER CUSIP MTG DATE` with the date LAST, and its vote rows are
// the `MGMT YES FOR` grammar with the proponent in the middle. Here the date is
// first and the proponent last, so neither band parses there; every one of these
// filings was recorded as `skip` with no rows (10 filings, 24.3 MB, measured
// 2026-09-19).
//
// The bands are matched by their COLUMN SET, not by one spelling: a meeting band
// names a meeting date, a company, a ticker and a security id in any order, and
// an item band names the item, what was voted on and the vote cast.

func init() {
	entry := layoutEntry{Name: "twoband", Match: matchTwoBand, Parse: parseTwoBand,
		// The first band sits behind a cover page and the SEC's Item 1
		// instructions; 16 MB is what the sibling text layouts use.
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

// tbHasAll reports that the canonicalised line carries every phrase given.
func tbHasAll(line string, phrases ...string) bool {
	up := pvTextCanonical(line)
	for _, p := range phrases {
		if !strings.Contains(up, p) {
			return false
		}
	}
	return true
}

// tbMeetingBand is the identity header: a meeting date, the issuer under either
// of its two spellings, a ticker and a security id, in whatever order the filer
// printed them.
func tbMeetingBand(line string) bool {
	if !tbHasAll(line, "MEETING DATE", "TICKER") {
		return false
	}
	up := pvTextCanonical(line)
	issuer := strings.Contains(up, "COMPANY") || strings.Contains(up, "ISSUER")
	id := strings.Contains(up, "SECURITY ID") || strings.Contains(up, "CUSIP")
	return issuer && id
}

// tbItemBand is the proposal header. VOTE CAST is required: a band naming no
// vote column carries no vote, and reading one out of it would mean choosing a
// column by position.
func tbItemBand(line string) bool {
	if !tbHasAll(line, "VOTE CAST") {
		return false
	}
	up := pvTextCanonical(line)
	item := strings.Contains(up, "ITEM NUMBER") || strings.Contains(up, "PROPOSAL NUMBER")
	desc := strings.Contains(up, "AGENDA ITEM") || strings.Contains(up, "PROPOSAL")
	return item && desc
}

func matchTwoBand(head string) bool {
	var meeting, item bool
	for _, line := range strings.Split(head, "\n") {
		if tbMeetingBand(line) {
			meeting = true
		}
		if tbItemBand(line) {
			item = true
		}
		if meeting && item {
			return true
		}
	}
	return false
}

// tbProponents is the closed vocabulary of the trailing PROPONENT column. The
// column is what anchors the row's right-hand side, so the vote and the
// recommendation are never read off a description word.
var tbProponents = []string{"MGMT", "SHLDR", "MANAGEMENT", "SHAREHOLDER", "SHRHLDR", "ISSUER"}

func tbProponent(s string) bool {
	up := strings.ToUpper(s)
	for _, p := range tbProponents {
		if up == p {
			return true
		}
	}
	return false
}

// tbRule is the dashed line this filer draws above and below its fund heading.
func tbRule(line string) bool {
	t := strings.TrimSpace(line)
	return len(t) >= 10 && strings.Trim(t, "-") == ""
}

func parseTwoBand(text string, meta FilingMeta) ([]VoteRow, error) {
	lines := strings.Split(text, "\n")
	seriesIx := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))
	issFormerKeys(seriesIx, meta.FormerNames)
	dict := cikDict.exactFallback(meta)

	var (
		rows       []VoteRow
		fund       string
		fundSeries string
		meeting    pvTextMeeting
		haveMtg    bool
		inMeeting  bool
		inItem     bool
		ruleAt     = -2
	)

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if tbRule(lines[i]) {
			// The fund heading is the single line BETWEEN two rules. Nothing else
			// about the line makes it one, so a rule with no partner names nothing.
			if ruleAt == i-2 && strings.TrimSpace(lines[i-1]) != "" {
				fund = strings.TrimSpace(lines[i-1])
				fundSeries = icrResolveFundShared(seriesIx, fund)
				if fundSeries == "" {
					fundSeries = htmlDictionaryFund(seriesIx, dict, fund)
				}
				if fundSeries == "" {
					fundSeries = tbGenericTypeNounSeries(seriesIx, fund)
				}
				haveMtg, inMeeting, inItem = false, false, false
			}
			ruleAt = i
			continue
		}
		if line == "" {
			continue
		}
		if tbMeetingBand(line) {
			inMeeting, inItem = true, false
			continue
		}
		if tbItemBand(line) {
			inItem, inMeeting = true, false
			continue
		}
		if strings.HasPrefix(line, "<") {
			continue
		}
		fields := strings.Fields(line)
		switch {
		case inMeeting:
			inMeeting = false
			if m, ok := tbMeetingRow(fields); ok {
				meeting, haveMtg = m, true
			} else {
				haveMtg = false
			}
		case inItem && haveMtg:
			if row, ok := tbVoteRow(fields, meeting); ok {
				row.FundName, row.SeriesID = fund, fundSeries
				rows = append(rows, row)
				continue
			}
			// A line that is neither a vote nor a band closes the table until the
			// next header opens it, so foreign text can never be read as a row.
			inItem = false
		}
	}

	if len(rows) == 0 {
		return nil, errLayoutDeclined
	}
	return rows, nil
}

// tbMeetingRow reads the identity row under a meeting band: the date first, the
// security id last, the ticker before it and the issuer in between.
func tbMeetingRow(fields []string) (pvTextMeeting, bool) {
	if len(fields) < 3 {
		return pvTextMeeting{}, false
	}
	date := htmlDate(fields[0])
	if date == "" {
		return pvTextMeeting{}, false
	}
	end := len(fields)
	cusip := ""
	if pvTextCUSIP(fields[end-1]) {
		cusip = fields[end-1]
		end--
	}
	ticker := ""
	if end > 1 && pvTextTicker(fields[end-1]) {
		ticker = fields[end-1]
		end--
	}
	issuer := strings.Join(fields[1:end], " ")
	if issuer == "" {
		return pvTextMeeting{}, false
	}
	return pvTextMeeting{
		issuer:      issuer,
		ticker:      ticker,
		cusip:       cusip,
		meetingDate: date,
	}, true
}

// tbVoteRow reads one proposal row. The proponent column is the anchor: the vote
// cast sits immediately left of it and the management recommendation left of
// that, so the description is whatever remains after the item number.
func tbVoteRow(fields []string, meeting pvTextMeeting) (VoteRow, bool) {
	if len(fields) < 5 || !tbProponent(fields[len(fields)-1]) {
		return VoteRow{}, false
	}
	n := len(fields)
	vote := fields[n-2]
	if !pvTextVote(strings.ToUpper(vote)) {
		return VoteRow{}, false
	}
	desc := strings.Join(fields[1:n-3], " ")
	if desc == "" {
		return VoteRow{}, false
	}
	return VoteRow{
		IssuerName:               meeting.issuer,
		Ticker:                   meeting.ticker,
		CUSIP:                    icrCUSIP(meeting.cusip),
		ISIN:                     icrISIN(meeting.cusip),
		MeetingDate:              meeting.meetingDate,
		ItemSeq:                  fields[0],
		VoteDescription:          desc,
		ManagementRecommendation: fields[n-3],
		HowVoted:                 vote,
		VoteSource:               fields[n-1],
	}, true
}

// tbGenericFundTypeNouns are the two trailing generic nouns this filer's own
// section headings and its SGML header interchange. `etf` is deliberately NOT a
// type word of the shared vocabulary (issDropTypeWord) and is not added there:
// the fold below is per-filing and refuses on collision, whereas a shared
// vocabulary entry would widen every registrant-scoped rung in the corpus.
var tbGenericFundTypeNouns = map[string]bool{"fund": true, "etf": true}

// tbGenericTypeNounMinStem is the shortest stem the fold accepts, in tokens, so
// a heading is never resolved on a generic noun plus one word.
const tbGenericTypeNounMinStem = 2

// tbGenericTypeNounSeries resolves a fund banner that differs from a series the
// FILING'S OWN HEADER declares by exactly its trailing generic noun -- `First
// Trust Eurozone AlphaDEX(R) Fund` printed for a declared `First Trust Eurozone
// AlphaDEX ETF` (CIK 1510337, S000047035, 2015 N-PX: one banner, 19 declared
// series, every row blank). The registrant renamed its own product mid-life and
// the vendor's plain-text template kept the older house style; normalizeSeriesName
// folds the `(R)` but by design never a suffix noun, because folding one globally
// would merge genuinely distinct registered series elsewhere in the corpus.
//
// The claim is narrow by construction and never leaves the filing:
//
//   - the candidate is read against the filing's OWN declarations alone (the
//     header-only index), never the corpus dictionary and never a sibling CIK;
//   - only the single TRAILING token folds, and only within the two nouns above;
//   - the stem must be two tokens at least;
//   - the noun must actually differ, so this adds nothing an exact match already
//     reached;
//   - and EXACTLY ONE declared series may answer. Two declared names sharing a
//     stem under different nouns are two registered series, and the collision
//     withdraws the claim rather than choosing between them.
func tbGenericTypeNounSeries(ix *issSeriesIndex, banner string) string {
	if ix == nil {
		return ""
	}
	// The filing's own header declarations, with the dictionary unreadable.
	own := ix
	if ix.hdrOnly != nil {
		own = ix.hdrOnly
	}
	toks := strings.Fields(normalizeSeriesName(banner))
	if len(toks) < tbGenericTypeNounMinStem+1 {
		return ""
	}
	noun := toks[len(toks)-1]
	if !tbGenericFundTypeNouns[noun] {
		return ""
	}
	stem := strings.Join(toks[:len(toks)-1], " ")
	id := ""
	for i := range own.decls {
		d := &own.decls[i]
		if d.SeriesID == "" {
			continue
		}
		dt := own.declToks(i)
		if len(dt) < tbGenericTypeNounMinStem+1 {
			continue
		}
		dn := dt[len(dt)-1]
		if dn == noun || !tbGenericFundTypeNouns[dn] {
			continue
		}
		if strings.Join(dt[:len(dt)-1], " ") != stem {
			continue
		}
		if id != "" && id != d.SeriesID {
			return "" // two declared series answer this stem; refuse
		}
		id = d.SeriesID
	}
	return id
}
