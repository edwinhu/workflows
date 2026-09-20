package main

import (
	"strings"
)

// How far back over a page's centred furniture -- report title, reporting
// period, a `VOTED BY ...:` line -- the banner search may reach when the last
// text line before the table resolves to nothing.
const vsBannerLookback = 6

// The ISS `VOTE SUMMARY REPORT` is a fixed-width text grammar wrapped in EDGAR's
// <TABLE>/<CAPTION>/<S>/<C> pseudo-markup, one section per fund per page
// (streetTRACKS Series Trust 2004 prints 1,096 of them in 2.9 MB). Its column
// header is STACKED over two physical lines --
//
//	Mtg               Company/                                   Mgmt         Vote        Record                      Shares
//	Date/Type         Ballot Issues                  Security    Rec          Cast        Date         Prpnent        Voted
//
// -- so no single line carries `Vote Cast` or `Mgt Rec` and neither
// hasISSColumnHeader nor hasVoteTableVocabulary can see it. The two lines
// together are the signature and the column ruler alike.
//
// The layout reads the RAW bytes: normalization caps a run of spaces at
// columnGapWidth and drops leading indentation, which is the whole of this
// grammar's column structure.

// matchVoteSummary keys on the LOWER of the two header lines, which is the one
// that carries the grammar's distinctive names together. The upper line alone
// ("Mtg Company/ Mgmt Vote Record Shares") is ordinary vocabulary; the lower one
// names the ballot column and the proponent, and no other legacy grammar in the
// corpus prints `Ballot Issues` and `Prpnent` on one line.
func matchVoteSummary(head string) bool {
	for _, line := range strings.Split(strings.ToUpper(head), "\n") {
		if strings.Contains(line, "BALLOT ISSUES") && strings.Contains(line, "PRPNENT") &&
			strings.Contains(line, "CAST") {
			return true
		}
	}
	return false
}

// vsRulerLookahead is how many non-blank lines past the header pair the `<S> <C>`
// ruler may be found in -- the `- -----` rule line, then the ruler itself.
const vsRulerLookahead = 2

// vsRulerMarkers returns the token starts of the `<S> ... <C> ...` ruler EDGAR
// prints beneath the header pair, or nil when none is printed within
// vsRulerLookahead non-blank lines. Only a line whose every token is `<S>` or
// `<C>` is a ruler; the `- -----` rule line between is stepped over.
func vsRulerMarkers(lines []string, from int) []int {
	for j, seen := from, 0; j < len(lines) && seen < vsRulerLookahead; j++ {
		line := strings.TrimRight(lines[j], "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		seen++
		if strings.HasPrefix(trimmed, "-") && strings.Trim(trimmed, "- ") == "" {
			continue
		}
		if !strings.HasPrefix(trimmed, "<") {
			return nil
		}
		var marks []int
		ok := true
		for i := 0; i < len(line) && ok; {
			if line[i] == ' ' {
				i++
				continue
			}
			end := i
			for end < len(line) && line[end] != ' ' {
				end++
			}
			switch strings.ToUpper(line[i:end]) {
			case "<S>", "<C>":
				marks = append(marks, i)
			default:
				ok = false
			}
			i = end
		}
		if ok && len(marks) > 0 {
			return marks
		}
		return nil
	}
	return nil
}

// voteSummaryColumns returns the column starts a stacked header pair defines, or
// nil when the two lines are not one. A start is a position at which either line
// begins a token AND both lines are blank in the two columns before it: that is
// what separates a real column boundary from the second word of a wrapped label
// (`Issues` in `Ballot Issues`, which begins one space after `Ballot` ends).
//
// The header labels are not always where the data is: some registrants (Wilshire
// Variable Insurance Trust) print each label 1-2 characters right of the ruler
// marker its data is laid out on, so a cell cut on the label eats the head of the
// column to its right -- `002824100` read as `02824100`, `For` as `r`. When a
// ruler is printed, each header-derived start is therefore SNAPPED BACK to the
// nearest marker at or before it; markers no header column claims are dropped.
// Snapping only ever moves a boundary left, which can only widen the cell to its
// right, so a filing whose data follows the labels instead (Select Sector SPDR,
// whose ruler carries spurious markers) still reads every token from the cell it
// belongs to. Column count and naming are unchanged either way.
func voteSummaryColumns(top, bottom string, ruler []int) []int {
	up, low := strings.ToUpper(top), strings.ToUpper(bottom)
	if !strings.Contains(low, "BALLOT ISSUES") || !strings.Contains(low, "PRPNENT") ||
		!strings.Contains(low, "CAST") || !strings.Contains(up, "MGMT") {
		return nil
	}
	blank := func(s string, i int) bool { return i < 0 || i >= len(s) || s[i] == ' ' }
	var cols []int
	seen := map[int]bool{}
	for i := 0; i < len(top) || i < len(bottom); i++ {
		starts := (i < len(top) && top[i] != ' ' && blank(top, i-1)) ||
			(i < len(bottom) && bottom[i] != ' ' && blank(bottom, i-1))
		if !starts || seen[i] {
			continue
		}
		if i > 0 && !(blank(top, i-1) && blank(top, i-2) && blank(bottom, i-1) && blank(bottom, i-2)) {
			continue
		}
		seen[i] = true
		cols = append(cols, i)
	}
	cols = vsSnapToRuler(cols, ruler)
	if len(cols) < 5 {
		return nil
	}
	return cols
}

// vsSnapToRuler moves each column start back to the nearest ruler marker at or
// before it. Two starts that snap onto the same marker collapse to one; a ruler
// of no markers leaves the starts exactly as the header defined them.
func vsSnapToRuler(cols, ruler []int) []int {
	if len(ruler) == 0 {
		return cols
	}
	out := cols[:0]
	for _, c := range cols {
		snapped := c
		for _, m := range ruler {
			if m > c {
				break
			}
			snapped = m
		}
		if len(out) > 0 && out[len(out)-1] >= snapped {
			continue
		}
		out = append(out, snapped)
	}
	return out
}

// voteSummaryFields names each column from the two header lines joined over that
// column's span, so a sibling filing printing one column more or fewer is read by
// what its header says rather than by position.
type voteSummaryFields struct {
	mtg, ballot, security, mgmtRec, vote, by int
}

func voteSummaryFieldsOf(cols []int, top, bottom string) (voteSummaryFields, bool) {
	f := voteSummaryFields{-1, -1, -1, -1, -1, -1}
	for k := range cols {
		label := strings.ToUpper(strings.TrimSpace(
			voteSummaryCell(top, cols, k) + " " + voteSummaryCell(bottom, cols, k)))
		switch {
		case strings.Contains(label, "DATE/TYPE"):
			f.mtg = k
		case strings.Contains(label, "BALLOT"):
			f.ballot = k
		case strings.Contains(label, "SECURITY"):
			f.security = k
		case strings.Contains(label, "MGMT") && strings.Contains(label, "REC"):
			f.mgmtRec = k
		case strings.Contains(label, "VOTE") && strings.Contains(label, "CAST"):
			f.vote = k
		case strings.Contains(label, "PRPNENT"), strings.Contains(label, "PROPONENT"):
			f.by = k
		}
	}
	return f, f.mtg >= 0 && f.ballot >= 0 && f.vote >= 0
}

// voteSummaryCell cuts one column out of a line. The last column runs to the end
// of the line; a line shorter than the column start has nothing in it.
func voteSummaryCell(line string, cols []int, k int) string {
	if k >= len(cols) || cols[k] >= len(line) {
		return ""
	}
	end := len(line)
	if k+1 < len(cols) && cols[k+1] < end {
		end = cols[k+1]
	}
	return strings.TrimSpace(line[cols[k]:end])
}

// vsStripAccountCode drops the registrant's internal account code from the tail
// of a fund banner (`... INDEX FUND - J920`). The code names an account, never a
// series, so it is noise to the index; a banner that carries none is returned
// unchanged.
func vsStripAccountCode(name string) string {
	i := strings.LastIndex(name, " - ")
	if i < 0 {
		return name
	}
	code := name[i+3:]
	if len(code) < 2 || (code[0] != 'J' && code[0] != 'j') {
		return name
	}
	for _, r := range code[1:] {
		if r < '0' || r > '9' {
			return name
		}
	}
	return strings.TrimSpace(name[:i])
}

// parseVoteSummaryRaw walks the sections of one filing. A section opens with the
// fund banner -- the last text line before the header pair, carried verbatim
// including the registrant's internal account code (`... INDEX FUND - J920`) --
// and holds meeting lines, each followed by its numbered proposals and their
// wrapped description continuations.
func parseVoteSummaryRaw(raw []byte, _ string, meta FilingMeta) ([]VoteRow, error) {
	lines := strings.Split(strings.ReplaceAll(string(raw), "\r\n", "\n"), "\n")

	seriesIx := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))
	issFormerKeys(seriesIx, meta.FormerNames)
	dict := cikDict.exactFallback(meta)
	resolved := map[string]string{}
	// The banner is carried verbatim, account code and all; the code is the
	// registrant's own and names no series, so it is dropped before the name is
	// offered to the index.
	resolve := func(name string) string {
		if id, seen := resolved[name]; seen {
			return id
		}
		id := icrResolveFundShared(seriesIx, name)
		if id == "" {
			id = htmlDictionaryFund(seriesIx, dict, name)
		}
		if id == "" {
			if bare := vsStripAccountCode(name); bare != name {
				id = icrResolveFundShared(seriesIx, bare)
				if id == "" {
					id = htmlDictionaryFund(seriesIx, dict, bare)
				}
			}
		}
		resolved[name] = id
		return id
	}

	var (
		out        []VoteRow
		cols       []int
		fields     voteSummaryFields
		fund       string
		fundSeries string
		last       string
		block      []string
		issuer     string
		cusip      string
		mtgDate    string
		pending    *VoteRow
	)
	flush := func() {
		if pending != nil {
			out = append(out, *pending)
			pending = nil
		}
	}

	for i := 0; i < len(lines); i++ {
		line := strings.TrimRight(lines[i], "\r")
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, "<") {
			if strings.EqualFold(trimmed, "</TABLE>") {
				flush()
				cols = nil
				block = block[:0]
			}
			continue
		}
		if i+1 < len(lines) {
			if c := voteSummaryColumns(line, strings.TrimRight(lines[i+1], "\r"), vsRulerMarkers(lines, i+2)); c != nil {
				if f, ok := voteSummaryFieldsOf(c, line, lines[i+1]); ok {
					flush()
					cols, fields, fund = c, f, last
					fundSeries = resolve(fund)
					if fundSeries == "" {
						// Some vendors centre the fund, the report title and
						// the reporting period above the table, so the last
						// text line is a date range and never the fund. Walk
						// back over the page's own lines to the nearest one
						// that resolves and take that as the banner.
						for j := len(block) - 2; j >= 0 && j >= len(block)-vsBannerLookback; j-- {
							if id := resolve(block[j]); id != "" {
								fund, fundSeries = block[j], id
								break
							}
						}
					}
					issuer, cusip, mtgDate = "", "", ""
					i++
					continue
				}
			}
		}
		if cols == nil {
			last = trimmed
			block = append(block, trimmed)
			continue
		}
		// The rule line under the header, and any page furniture, carry text in
		// the first column that is not a meeting date.
		if v := voteSummaryCell(line, cols, fields.mtg); v != "" {
			date := xmlDate(strings.Fields(v)[0])
			if date == "" {
				continue
			}
			flush()
			mtgDate = date
			issuer = voteSummaryCell(line, cols, fields.ballot)
			if fields.security >= 0 {
				cusip = voteSummaryCell(line, cols, fields.security)
			}
			continue
		}
		ballot := voteSummaryCell(line, cols, fields.ballot)
		if ballot == "" || mtgDate == "" {
			continue
		}
		item, desc := "", ballot
		if f := strings.Fields(ballot); htmlIsItemNumber(f[0]) {
			item = f[0]
			desc = strings.TrimSpace(ballot[len(f[0]):])
		}
		if item == "" {
			// A wrapped description line: the proposal's own text, printed in
			// the ballot column with every other column empty.
			if pending != nil {
				pending.VoteDescription = strings.TrimSpace(pending.VoteDescription + " " + desc)
			}
			continue
		}
		flush()
		row := VoteRow{
			FundName:        fund,
			SeriesID:        fundSeries,
			IssuerName:      issuer,
			CUSIP:           cusip,
			MeetingDate:     mtgDate,
			ItemSeq:         item,
			VoteDescription: desc,
			HowVoted:        voteSummaryCell(line, cols, fields.vote),
		}
		if fields.mgmtRec >= 0 {
			row.ManagementRecommendation = voteSummaryCell(line, cols, fields.mgmtRec)
		}
		if fields.by >= 0 {
			row.VoteSource = voteSummaryCell(line, cols, fields.by)
		}
		pending = &row
	}
	flush()

	if len(out) == 0 {
		return nil, errLayoutDeclined
	}
	return out, nil
}
