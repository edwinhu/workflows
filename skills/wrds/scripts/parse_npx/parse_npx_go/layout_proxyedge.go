package main

import "strings"

// proxyedge reads the Broadridge ProxyEdge ballot-detail export as rendered by
// Vintage Filings' EDGARizerAgent (144 filings, 372 MB, every one recorded as
// `skip` before 2026-09-19). Every logical column is one <td> wrapping a
// <div><font>, so after stripHTML the whole grid arrives ONE CELL PER LINE:
//
//	Guinness Atkinson Alternative Energy Fund
//	ENERGY DEVELOPMENT (EDC) CORPORATION
//	Ticker:
//	Meeting Date:
//	29-Jul-2010
//	Item / Proposal / Recommendation / For / Against / Abstain / Take No Action
//	1 / Call to order / For / 16068000 / 0 / 0 / 0
//
// htmltable cannot map this header because it names no vote column: `For` and
// `Against` here are SHARE-COUNT columns, not vote values, and the fund's ballot
// is the count under whichever disposition it was cast in. THE VOTE IS THE LABEL
// OF THE COLUMN CARRYING THE COUNT -- verbatim, as the filing spells it -- and
// the count is the shares voted. The management recommendation is a separate
// column and is never read as the vote.

// peVocabulary is the header band's whole vocabulary. A band is a RUN of
// consecutive non-blank lines every one of which is in it, which is what parts
// the header from the numbered row underneath: the row's first cell is an item
// number and belongs to no vocabulary.
var peVocabulary = map[string]string{
	"ITEM":           peItem,
	"ITEM NUMBER":    peItem,
	"PROPOSAL":       peDesc,
	"AGENDA ITEM":    peDesc,
	"RECOMMENDATION": peMgmtRec,
	"MGMT REC":       peMgmtRec,
	"MANAGEMENT":     peMgmtRec,
	"TYPE":           peBy,
	"PROPONENT":      peBy,
	"VOTE":           peVote,
	"VOTE CAST":      peVote,
	// The ballot dispositions. Each is a share-count column and its label is
	// what how_voted carries when the count is non-zero.
	"FOR":              peDisposition,
	"AGAINST":          peDisposition,
	"ABSTAIN":          peDisposition,
	"WITHHOLD":         peDisposition,
	"WITHHELD":         peDisposition,
	"TAKE NO ACTION":   peDisposition,
	"DO NOT VOTE":      peDisposition,
	"BROKER NON-VOTES": peDisposition,
	"NON-VOTE":         peDisposition,
	"UNVOTED":          peDisposition,
}

const (
	peItem        = "item"
	peDesc        = "desc"
	peMgmtRec     = "mgmtrec"
	peBy          = "by"
	peVote        = "vote"
	peDisposition = "disposition"
)

func init() {
	entry := layoutEntry{Name: "proxyedge", Match: matchProxyEdge, Parse: parseProxyEdge,
		// The first ballot sits behind a cover page; 16 MB is what the sibling
		// text layouts use.
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

// peNonBlank returns the document's non-blank lines with their text trimmed.
// The markup leaves a blank line between every cell, and they carry nothing.
func peNonBlank(text string) []string {
	var out []string
	for _, l := range strings.Split(text, "\n") {
		if t := strings.TrimSpace(l); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// peHeaderAt returns the roles of the header band starting at i, or nil when
// there is none there. The band must open on the item column, name what was
// voted on, and carry at least two disposition columns -- one alone could be a
// tally rather than a ballot.
func peHeaderAt(lines []string, i int) []string {
	if role, ok := peVocabulary[strings.ToUpper(lines[i])]; !ok || role != peItem {
		return nil
	}
	var roles []string
	desc, dispositions := false, 0
	for k := i; k < len(lines); k++ {
		role, ok := peVocabulary[strings.ToUpper(lines[k])]
		if !ok {
			break
		}
		if role == peDesc {
			desc = true
		}
		if role == peDisposition {
			dispositions++
		}
		roles = append(roles, role)
	}
	if !desc || dispositions < 2 {
		return nil
	}
	return roles
}

func matchProxyEdge(head string) bool {
	lines := peNonBlank(head)
	for i := range lines {
		if peHeaderAt(lines, i) != nil {
			return true
		}
	}
	return false
}

// peCount reads a share count, which the vendor prints with or without group
// separators. A cell that is not a count is not a ballot column value.
func peCount(s string) (string, bool) {
	v := strings.ReplaceAll(strings.TrimSpace(s), ",", "")
	if v == "" {
		return "", false
	}
	for i := 0; i < len(v); i++ {
		if v[i] < '0' || v[i] > '9' {
			return "", false
		}
	}
	return v, true
}

// peFundName reports a line that names a fund. The vendor prints the fund
// heading and the issuer heading identically -- both are bare lines above the
// identity labels -- so the fund is told from the issuer by its own name.
func peFundName(s string) bool {
	up := strings.ToUpper(s)
	for _, w := range []string{" FUND", " PORTFOLIO", " TRUST", " ETF", " SERIES"} {
		if strings.Contains(up, w) {
			return true
		}
	}
	return false
}

func parseProxyEdge(text string, meta FilingMeta) ([]VoteRow, error) {
	lines := peNonBlank(text)
	seriesIx := newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))
	issFormerKeys(seriesIx, meta.FormerNames)
	dict := cikDict.exactFallback(meta)

	var (
		rows       []VoteRow
		fund       string
		fundSeries string
		issuer     string
		ticker     string
		cusip      string
		isin       string
		mtgDate    string
		mtgType    string
		labels     []string
	)

	for i := 0; i < len(lines); i++ {
		line := lines[i]
		if roles := peHeaderAt(lines, i); roles != nil {
			labels = lines[i : i+len(roles)]
			i += len(roles) - 1
			continue
		}
		// A label on its own line, its value on the next. A label whose next
		// line is another label was printed empty, which is normal: a foreign
		// ballot carries a security id and no ticker.
		if strings.HasSuffix(line, ":") {
			label := strings.ToUpper(strings.TrimSuffix(line, ":"))
			value := ""
			if i+1 < len(lines) && !strings.HasSuffix(lines[i+1], ":") &&
				peHeaderAt(lines, i+1) == nil {
				value = lines[i+1]
				i++
			}
			switch label {
			case "TICKER":
				ticker = value
			case "SECURITY", "SECURITY ID", "SECURITY ID ON BALLOT":
				cusip = value
			case "ISIN":
				isin = value
			case "MEETING DATE":
				mtgDate = htmlDate(value)
			case "MEETING TYPE":
				mtgType = value
			}
			continue
		}
		if labels != nil {
			if row, ok := peVoteRow(lines, i, labels); ok {
				row.IssuerName = issuer
				row.Ticker = ticker
				row.CUSIP = icrCUSIP(cusip)
				if isin != "" {
					row.ISIN = isin
				} else {
					row.ISIN = icrISIN(cusip)
				}
				row.MeetingDate = mtgDate
				row.MeetingType = mtgType
				row.FundName = fund
				row.SeriesID = fundSeries
				rows = append(rows, row)
				i += len(labels) - 1
				continue
			}
		}
		// A bare heading. The vendor prints the fund above its ballots and the
		// issuer above each one, with nothing to mark either.
		if peFundName(line) {
			fund = line
			fundSeries = icrResolveFundShared(seriesIx, line)
			if fundSeries == "" {
				fundSeries = htmlDictionaryFund(seriesIx, dict, line)
			}
			continue
		}
		issuer = line
		ticker, cusip, isin, mtgDate, mtgType = "", "", "", "", ""
	}

	if len(rows) == 0 {
		return nil, errLayoutDeclined
	}
	return rows, nil
}

// peVoteRow reads one ballot row: len(labels) consecutive cells, positional
// against the header. The vote is the LABEL of the disposition column carrying
// a non-zero count, verbatim, and that count is the shares voted.
func peVoteRow(lines []string, i int, labels []string) (VoteRow, bool) {
	if i+len(labels) > len(lines) {
		return VoteRow{}, false
	}
	cells := lines[i : i+len(labels)]
	row := VoteRow{}
	var votedLabel, votedShares string
	var dispositions int
	for k, label := range labels {
		switch peVocabulary[strings.ToUpper(label)] {
		case peItem:
			row.ItemSeq = cells[k]
		case peDesc:
			row.VoteDescription = cells[k]
		case peMgmtRec:
			row.ManagementRecommendation = cells[k]
		case peBy:
			row.VoteSource = cells[k]
		case peVote:
			row.HowVoted = cells[k]
		case peDisposition:
			n, ok := peCount(cells[k])
			if !ok {
				return VoteRow{}, false
			}
			dispositions++
			if n != "0" && votedLabel == "" {
				votedLabel, votedShares = label, n
			}
		}
	}
	if dispositions == 0 || row.ItemSeq == "" || row.VoteDescription == "" {
		return VoteRow{}, false
	}
	if row.HowVoted == "" {
		if votedLabel == "" {
			// Every disposition is zero: the ballot was reported and nothing was
			// cast. how_voted is verbatim by contract, so it stays empty rather
			// than being filled with an inferred value.
			return VoteRow{}, false
		}
		row.HowVoted = votedLabel
		row.SharesVoted = votedShares
	}
	return row, true
}
