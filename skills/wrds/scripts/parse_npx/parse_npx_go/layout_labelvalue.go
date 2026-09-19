package main

import "strings"

// labelvalue reads the report whose block identity is printed as LABEL: VALUE
// pairs rather than as a column table:
//
//	===================== LVIP Clarion Global Real Estate Fund =====================
//
//	ALEXANDRIA REAL ESTATE EQUITIES, INC.
//
//	Ticker:       ARE            Security ID:  015271109
//	Meeting Date: MAY 12, 2016   Meeting Type: Annual
//	Record Date:  MAR 31, 2016
//
//	#     Proposal                                Mgt Rec   Vote Cast    Sponsor
//	1.1   Elect Director Joel S. Marcus           For       For          Management
//
// Measured 2026-08-31 over the 2,410 unread filings that print vote-table
// column labels: 150 of them, holding 275 MB, are this grammar -- the largest
// identified block in that residue. Lincoln Variable Insurance Products, Pacific
// Select and Direxion all file it, and every one was recorded as `skip`.
//
// THE COLUMN ORDER IS NOT icr's, WHICH IS WHY THE HEADER DECIDES. Here the
// proponent is the LAST column and there is no For/Agnst; in the icr grammar the
// proponent is the FIRST of the four and For/Agnst is last. The two are the same
// WIDTH, so a layout that read either by position would silently file a sponsor
// as a vote on the other. Roles come from the header line each block prints.

// lvProponents is the Sponsor column's whole vocabulary. Sampled across three
// filings of this family, 230 rows read `Management` and 20 `Shareholder`, with
// nothing else -- which is what makes the peel below safe.
var lvProponents = []string{"management", "shareholder", "shrholdr", "mgmt", "issuer"}

func init() {
	// After issnpx, which claims these filings on their `=====` fund banners and
	// now declines them, and before the generic fallbacks.
	entry := layoutEntry{Name: "labelvalue", Match: matchLabelValue, Parse: parseLabelValue,
		// The first block sits behind a cover page and the SEC's Item 1
		// instructions; 16 MB is what the sibling text layouts use.
		HeadBytes: 16 << 20}
	for i, candidate := range layoutRegistry {
		if candidate.Name == "vanguard" {
			layoutRegistry = append(layoutRegistry, layoutEntry{})
			copy(layoutRegistry[i+1:], layoutRegistry[i:])
			layoutRegistry[i] = entry
			return
		}
	}
	layoutRegistry = append(layoutRegistry, entry)
}

// lvColumnHeader recognises the row that names this grammar's columns and
// returns nothing else: its presence IS the signature.
func lvColumnHeader(cells []string) bool {
	if len(cells) < 4 || cells[0] != "#" {
		return false
	}
	var haveProposal, haveVote bool
	for _, c := range cells[1:] {
		switch strings.ToUpper(strings.TrimSpace(c)) {
		case "PROPOSAL":
			haveProposal = true
		case "VOTE CAST":
			haveVote = true
		}
	}
	return haveProposal && haveVote
}

func lvHasHeaderLine(text string) bool {
	for _, line := range strings.Split(text, "\n") {
		if lvColumnHeader(icrCells(strings.TrimSpace(line))) {
			return true
		}
	}
	return false
}

// lvUnwrap rejoins a report whose filer hard-wrapped each logical line inside
// its own <div>. stripHTML leaves exactly one blank line between <div>s and
// none inside one, so a RUN of consecutive non-blank lines IS one logical line
// of the report; joining the run with a single space reconstructs it, column
// gaps and all, and every predicate below then reads it unchanged.
func lvUnwrap(text string) string {
	var out []string
	var run []string
	flush := func() {
		if len(run) > 0 {
			out = append(out, strings.Join(run, " "))
			run = run[:0]
		}
	}
	for _, line := range strings.Split(text, "\n") {
		if t := strings.TrimSpace(line); t != "" {
			run = append(run, t)
			continue
		}
		flush()
		out = append(out, "")
	}
	flush()
	return strings.Join(out, "\n")
}

// lvWrapped reports a document none of whose physical lines is the column
// header but whose unwrapping has one. Unwrapping is applied only then: in
// every other filing of this family a run of consecutive non-blank lines is a
// run of separate rows, and joining them would destroy the table.
func lvWrapped(text string) bool {
	return !lvHasHeaderLine(text) && lvHasHeaderLine(lvUnwrap(text))
}

func matchLabelValue(head string) bool {
	return lvHasHeaderLine(head) || lvWrapped(head)
}

// lvLabelled reads a `Label: value` pair out of a cell, returning the label
// uppercased and the value verbatim.
type lvPair struct{ label, value string }

// lvPairs reads the LABEL: VALUE pairs of an identity line. The gap-based cell
// split parts a wide label from its value -- `Ticker:       ACGL` arrives as
// two cells -- so a label cell with nothing after its colon takes the next
// cell as its value, unless that cell is itself a label (Vantagepoint Funds:
// every one of 1.25M labelvalue rows had no security id on 2026-09-02).
func lvPairs(cells []string) []lvPair {
	var pairs []lvPair
	for i := 0; i < len(cells); i++ {
		label, value, ok := lvLabelled(cells[i])
		if !ok {
			continue
		}
		if value == "" && i+1 < len(cells) {
			if _, _, next := lvLabelled(cells[i+1]); !next {
				value = strings.TrimSpace(cells[i+1])
				i++
			}
		}
		pairs = append(pairs, lvPair{label, value})
	}
	return pairs
}

func lvLabelled(cell string) (string, string, bool) {
	i := strings.IndexByte(cell, ':')
	if i < 0 {
		return "", "", false
	}
	return strings.ToUpper(strings.TrimSpace(cell[:i])), strings.TrimSpace(cell[i+1:]), true
}

// lvPeelProponent splits the trailing proponent off a cell. The Sponsor column
// is separated from Vote Cast by a SINGLE space when the vote is wide --
//
//	1     Accept Financial Statements and         For       Did Not Vote Management
//
// -- so the gap-based cell split merges the two, and without this the row would
// report `Did Not Vote Management` as the vote. Only a known proponent word is
// peeled, so a vote value can never be truncated by it.
func lvPeelProponent(cell string) (rest, proponent string) {
	fields := strings.Fields(cell)
	if len(fields) == 0 {
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

// lvReportTitle is the one title this reader anchors on. A heading slot is only
// a heading because the line under it is this exact sentence; nothing else about
// a line makes it one.
const lvReportTitle = "PROXY VOTING SUMMARY REPORT"

// lvReportTitleBelow reports that the next nonblank line after lines[i] is the
// report title, which makes lines[i] the fund heading of the page.
func lvReportTitleBelow(lines []string, i int) bool {
	for _, next := range lines[i+1:] {
		if v := strings.TrimSpace(next); v != "" {
			return strings.EqualFold(v, lvReportTitle)
		}
	}
	return false
}

// lvMarkMarkup are the tags a vendor wraps a service or trade mark in. Their
// CONTENT is the mark, so the element goes whole.
var lvMarkMarkup = []string{"sup", "sub"}

// lvStripMarkMarkup drops a mark element that survives ENTITY DECODING from a
// fund-heading candidate: Wells Fargo escapes its service mark in the source
// (`Wells Fargo Advantage Opportunity Fund&lt;sup&gt;SM&lt;/sup&gt;`), so the
// decoder hands this layout a literal `<sup>SM</sup>` that is markup, not part
// of the name. Narrow to the heading candidate on purpose -- a filing whose
// escaped angle brackets are content keeps them everywhere else.
func lvStripMarkMarkup(name string) string {
	out := name
	for _, tag := range lvMarkMarkup {
		open, shut := "<"+tag+">", "</"+tag+">"
		for {
			i := strings.Index(out, open)
			if i < 0 {
				break
			}
			j := strings.Index(out[i:], shut)
			if j < 0 {
				break
			}
			out = out[:i] + out[i+j+len(shut):]
		}
	}
	if out == name {
		return name
	}
	return strings.TrimSpace(strings.Join(strings.Fields(out), " "))
}

// lvResolveBanner is the banner-to-series resolution this layout uses: the
// shared text rules first, then the registrant's dictionary.
func lvResolveBanner(ix *issSeriesIndex, dict *dictFallback, name string) string {
	name = lvStripMarkMarkup(name)
	if id := icrResolveFundShared(ix, name); id != "" {
		return id
	}
	return htmlDictionaryFund(ix, dict, name)
}

func parseLabelValue(text string, meta FilingMeta) ([]VoteRow, error) {
	if lvWrapped(text) {
		text = lvUnwrap(text)
	}
	lines := strings.Split(text, "\n")
	sharedIdx := newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))
	dict := cikDict.exactFallback(meta)

	var (
		rows      []VoteRow
		curSeries string
		fund      string
		issuer    string
		ticker    string
		cusip     string
		mtgDate   string
		mtgType   string
		inBlock   bool
		lastRow   = -1
		lastLine  = -2
	)

	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		cells := icrCells(line)

		// The fund banner is issnpx's `===== NAME =====` rule, reused verbatim:
		// this grammar is filed by houses that print both.
		if name, ok := issFundSeparator(line); ok {
			// A banner too long for the rule wraps onto the next rule, which
			// carries the tail of the SAME name:
			//
			//	========= MLIG VARIABLE INSURANC TRUST ROSZEL/LOOMIS SAYLES LARGE CAP ==========
			//	=========                      GROWTH PORTFOLIO                       ==========
			//
			// (MLIG Variable Insurance Trust 2008, all 590 rows under
			// `GROWTH PORTFOLIO` with no series). Both halves are full-width, so
			// issThinBannerContinuation does not join them and the second was
			// read as a fresh section. The join is admitted only when the second
			// line alone resolves to nothing and the JOINED text resolves, which
			// is the evidence that it is a tail and not a fund of its own.
			// One blank line between the two rules is an HTML block gap, the
			// same allowance issBannerContinues makes; two is a break.
			j := i + 1
			if j < len(lines) && strings.TrimSpace(lines[j]) == "" {
				j++
			}
			if j < len(lines) {
				if tail, ok2 := issFundSeparator(strings.TrimSpace(lines[j])); ok2 && tail != "" && name != "" {
					if lvResolveBanner(sharedIdx, dict, tail) == "" &&
						lvResolveBanner(sharedIdx, dict, name+" "+tail) != "" {
						name = name + " " + tail
						i = j
					}
				}
			}
			fund = name
			// The banner goes through the same rules the sibling text layouts use,
			// so a hybrid filing that falls to this layout rather than issnpx reads
			// its banners the same way: `PF LAZARD INTERNATIONAL VALUE FUND` names
			// the fund by its then sub-adviser for a declared `PF International
			// Value Fund` (S000001888, Pacific Funds 2006, 498 rows).
			curSeries = lvResolveBanner(sharedIdx, dict, name)
			inBlock = false
			lastRow = -1
			continue
		}
		// `Fund Name: <name>` -- the LABELLED fund heading the icr grammar reads
		// (icrFundNameLabel). This layout had no reader for it, so every row of a
		// `Fund Name:`-sectioned filing came out fundless and series-less, and
		// consolidatedSeries (main.go) then joined all 32 declared ids onto every
		// one of American Beacon 2017's rows. A link key is never guessed: a
		// heading that resolves to nothing leaves series_id blank.
		if pairs := lvPairs(cells); len(pairs) == 1 && pairs[0].label == icrFundNameLabel && pairs[0].value != "" {
			fund = pairs[0].value
			curSeries = lvResolveBanner(sharedIdx, dict, fund)
			inBlock = false
			lastRow = -1
			continue
		}
		// The fund printed on the line ABOVE the report's own title, with no rule
		// and no label to mark it: Ultra Series Fund heads every page of its
		// report `ULTRA SERIES INTERNATIONAL STOCK FUND` over `PROXY VOTING
		// SUMMARY REPORT`, and this layout read neither, leaving all 1,515 rows
		// of the filing with no fund name at all. The TITLE is the evidence --
		// the heading is the nearest nonblank line above a line that is exactly
		// the report's title -- so no line is read as a name on its own account.
		// Resolution goes through the same rules the sibling text layouts use,
		// and an unresolved heading is still recorded, as they record theirs.
		if lvReportTitleBelow(lines, i) {
			fund = line
			curSeries = icrResolveFundShared(sharedIdx, line)
			if curSeries == "" {
				curSeries = htmlDictionaryFund(sharedIdx, dict, line)
			}
			inBlock = false
			lastRow = -1
			continue
		}
		// Vantagepoint's mixed reports print a bare fund before Subadviser,
		// including sections with no declared series. Account numbers below it
		// are sleeve metadata, not replacement fund headings.
		if sharedIdx.registrantKey == "vantagepoint funds" && strings.HasPrefix(strings.ToLower(line), "vantagepoint ") && strings.HasSuffix(strings.ToLower(line), " fund") {
			j := i + 1
			for j < len(lines) && strings.TrimSpace(lines[j]) == "" {
				j++
			}
			if j < len(lines) {
				next := strings.ToLower(strings.TrimSpace(lines[j]))
				_, d := issResolveFund(sharedIdx, line)
				// The period-only form requires a declared fund, not a manager.
				period := strings.Split(next, "--")
				periodHeading := d != nil && len(period) == 2 && htmlDate(period[0]) != "" && htmlDate(period[1]) != ""
				if strings.HasPrefix(next, "subadviser:") || periodHeading {
					fund, curSeries = line, ""
					if d != nil {
						curSeries = d.SeriesID
					}
					inBlock, lastRow = false, -1
					continue
				}
			}
		}
		if strings.Trim(line, "-") == "" {
			inBlock = false // the rule between issuer blocks
			lastRow = -1
			continue
		}

		if lvColumnHeader(cells) {
			inBlock = true
			lastRow = -1
			continue
		}

		// Identity, as LABEL: VALUE pairs. A blank Ticker is normal -- foreign
		// issuers file with a Security ID and no symbol -- so the label is what
		// is required here, never a value in a position.
		if pairs := lvPairs(cells); len(pairs) > 0 {
			switch pairs[0].label {
			case "TICKER", "MEETING DATE", "RECORD DATE":
				for _, p := range pairs {
					switch p.label {
					case "TICKER":
						ticker = p.value
					case "MEETING DATE":
						mtgDate = htmlDate(p.value)
						// `Meeting Date: APR 17` with `2019 Meeting Type: Annual` on
						// the next line: the year wraps (Timothy Plan 2019, 867
						// undated rows on r185). The next line's leading year joins.
						if mtgDate == "" {
							k := i + 1
							for k < len(lines) && strings.TrimSpace(lines[k]) == "" {
								k++
							}
							if k < len(lines) {
								if f := strings.Fields(strings.TrimSpace(lines[k])); len(f) > 0 && lvYear(f[0]) {
									mtgDate = htmlDate(p.value + " " + f[0])
								}
							}
						}
					case "SECURITY ID":
						cusip = p.value
					case "MEETING TYPE":
						mtgType = p.value
					}
				}
				continue
			}
		}

		if row, ok := lvVoteRow(cells, issuer, ticker, cusip, mtgDate, mtgType, fund, curSeries); ok && inBlock {
			rows = append(rows, row)
			lastRow, lastLine = len(rows)-1, i
			continue
		}

		// A wrapped description, on the line directly under its row -- or under
		// the blank lines the cell markup leaves there (`Approve Consolidated
		// Financial` / `Statements`, Timothy Plan 2019: every item after the
		// first of a block was lost when the wrap closed it).
		if lastRow >= 0 && lvOnlyBlankBetween(lines, lastLine, i) && len(cells) == 1 && !icrItem(cells[0]) {
			rows[lastRow].VoteDescription += " " + cells[0]
			lastLine = i
			continue
		}

		// NOTHING ELSE BELONGS TO A BLOCK, so reaching here closes it. The filings
		// carry OTHER wide tables -- a manager/fund/security summary running
		// thousands of lines --
		//
		//	AQR  Products Trust - LVIP AQR
		//	Management  Fund  LVIPEQ  plc  MNK  Ireland G5785G107 Annual 16-Mar-16
		//
		// and without this the block stayed open across them: rows whose first
		// cell happened to be item-shaped were read as votes, which is where
		// `L10`, `L3` and `DQ` came from in the first corpus run. A block that
		// closes on the first line outside its grammar costs at most the rest of
		// one issuer's items, and the next column header reopens it.
		inBlock = false
		lastRow = -1
		if len(cells) == 1 && !lvYear(cells[0]) {
			// The ISSUER heading, which this grammar prints above the identity
			// pairs with nothing to mark it. A lone year is the wrapped tail of
			// a `Record Date:` line, not a name.
			issuer = cells[0]
			ticker, cusip, mtgDate, mtgType = "", "", "", ""
		}
	}

	if len(rows) == 0 {
		return nil, errLayoutDeclined
	}
	return rows, nil
}

// lvVoteRow reads one row. Columns are counted from the RIGHT after the
// proponent is peeled, because the description is the only field that wraps.
func lvVoteRow(cells []string, issuer, ticker, cusip, mtgDate, mtgType, fund, series string) (VoteRow, bool) {
	if len(cells) < 3 {
		return VoteRow{}, false
	}
	// THE ITEM COLUMN IS PADDED TO A FIXED WIDTH, so a wide item leaves only ONE
	// space before the description and the two-space cell split merges them:
	//
	//	1a.9  Elect Director Cynthia A. Montgomery   For  For  Management
	//	1a.10 Elect Director Donald C. Opatrny       For  For  Management
	//
	// `1a.9` is padded to two trailing spaces and splits; `1a.10` fills the column
	// and does not. Requiring cells[0] to BE the item therefore dropped every row
	// from the tenth sub-item on, silently and without touching the row count of
	// anything else -- measured 2026-08-31, ZERO of 208,284 labelvalue rows had an
	// item of five characters or more, in a corpus full of director slates longer
	// than nine. A Gemini pilot on one filing read 45 rows where this layout read
	// 27, and the fifteen it found were real.
	if !icrItem(cells[0]) {
		head, rest, ok := strings.Cut(cells[0], " ")
		if !ok || !icrItem(head) {
			return VoteRow{}, false
		}
		cells = append([]string{head, strings.TrimSpace(rest)}, cells[1:]...)
	}
	tail, proponent := lvPeelProponent(cells[len(cells)-1])
	trimmed := append([]string(nil), cells...)
	if proponent != "" {
		if tail == "" {
			trimmed = trimmed[:len(trimmed)-1]
		} else {
			trimmed[len(trimmed)-1] = tail
		}
	}
	if len(trimmed) < 3 {
		return VoteRow{}, false
	}
	n := len(trimmed)
	return VoteRow{
		IssuerName:               issuer,
		CUSIP:                    icrCUSIP(cusip),
		ISIN:                     icrISIN(cusip),
		Ticker:                   ticker,
		MeetingDate:              mtgDate,
		MeetingType:              mtgType,
		FundName:                 fund,
		SeriesID:                 series,
		ItemSeq:                  trimmed[0],
		VoteDescription:          strings.Join(trimmed[1:n-2], " "),
		VoteSource:               proponent,
		ManagementRecommendation: trimmed[n-2],
		HowVoted:                 trimmed[n-1],
	}, true
}

// lvYear reports a bare four-digit year.
func lvYear(s string) bool {
	if len(s) != 4 {
		return false
	}
	for i := 0; i < 4; i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return s[0] == '1' || s[0] == '2'
}

// lvOnlyBlankBetween reports that every line strictly between from and to is
// blank.
func lvOnlyBlankBetween(lines []string, from, to int) bool {
	if to <= from {
		return false
	}
	for k := from + 1; k < to; k++ {
		if strings.TrimSpace(lines[k]) != "" {
			return false
		}
	}
	return true
}
