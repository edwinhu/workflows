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
	// The broker's standing instruction on this ballot -- what would have been
	// cast absent one. It is neither the management recommendation nor the
	// fund's ballot, so it has a role of its own and peVoteRow reads it into no
	// field (Cullen Funds Trust 2017 and the vendor's later template).
	"DEFAULT VOTE": peDefault,
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
	peDefault     = "default"
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

// peWholeCell reports, for each line peNonBlank returned, whether it stood
// alone between the blank lines the markup leaves around a cell. A run of two
// or more adjacent lines is ONE cell the vendor hard-wrapped over source lines
// (American National 2009 prints item 8's description as three), not one cell
// per line, so neither the head nor the tail of such a run names anything.
func peWholeCell(text string) []bool {
	var out []bool
	run := 0
	end := func() {
		if run == 1 {
			out[len(out)-1] = true
		}
		run = 0
	}
	for _, l := range strings.Split(text, "\n") {
		if strings.TrimSpace(l) == "" {
			end()
			continue
		}
		out = append(out, false)
		run++
	}
	end()
	return out
}

// peHeader is one header band: its labels, one per logical column, and the
// number of physical lines they were read from. The two differ when the vendor
// wrapped a label across two cells.
type peHeader struct {
	labels   []string
	consumed int
}

// peHeaderAt returns the header band starting at i, or nil when there is none
// there. The band must open on the item column, name what was voted on, and
// carry at least two disposition columns -- one alone could be a tally rather
// than a ballot.
func peHeaderAt(lines []string, i int) *peHeader {
	if role, ok := peVocabulary[strings.ToUpper(lines[i])]; !ok || role != peItem {
		return nil
	}
	h := &peHeader{}
	for k := i; k < len(lines); k++ {
		if _, ok := peVocabulary[strings.ToUpper(lines[k])]; ok {
			h.labels = append(h.labels, lines[k])
			h.consumed++
			continue
		}
		// Some filers wrap one label onto two cells (`Take No` / `Action`,
		// `Default` / `Vote`), which otherwise cuts the band short of the
		// disposition columns. A line outside the vocabulary is one such half
		// when joining it to the next line lands inside it.
		if k+1 < len(lines) {
			joined := lines[k] + " " + lines[k+1]
			if _, ok := peVocabulary[strings.ToUpper(joined)]; ok {
				h.labels = append(h.labels, joined)
				h.consumed += 2
				k++
				continue
			}
		}
		break
	}
	desc, dispositions := false, 0
	for _, lab := range h.labels {
		switch peVocabulary[strings.ToUpper(lab)] {
		case peDesc:
			desc = true
		case peDisposition:
			dispositions++
		}
	}
	if !desc || dispositions < 2 {
		return nil
	}
	return h
}

// matchProxyEdge requires BOTH halves of this vendor's grammar: the ballot
// header band, and the identity block it prints one label per line above it.
// The band alone is not enough. `Item | Proposal | Recommendation | Default
// Vote | For | Against | Abstain | Take No Action` is also how a filer lays out
// a plain HTML tally table whose share counts belong to no ballot of the
// fund's, and reading the heading of the column carrying the count as the vote
// would be inventing one there. The label-per-line identity block -- `Ticker:`,
// `Security:`, `Meeting Date:` each alone on their own cell -- is what says the
// counts under those headings are this ballot's.
func matchProxyEdge(head string) bool {
	lines := peNonBlank(head)
	band, identity := false, false
	for i := range lines {
		if !band && peHeaderAt(lines, i) != nil {
			band = true
		}
		if !identity && peIdentityLabel(lines[i]) {
			identity = true
		}
		if band && identity {
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

// peItemCell reports that line i is a bare item number printed under a header
// band -- the cell that opens a ballot row, whatever follows it.
func peItemCell(lines []string, i int, labels []string) bool {
	if labels == nil || i < 0 {
		return false
	}
	_, ok := peCount(lines[i])
	return ok
}

// peIdentityLabel reports a line that opens a ballot's identity block.
func peIdentityLabel(line string) bool {
	if !strings.HasSuffix(line, ":") {
		return false
	}
	switch strings.ToUpper(strings.TrimSuffix(line, ":")) {
	case "TICKER", "SECURITY", "SECURITY ID", "SECURITY ID ON BALLOT", "ISIN",
		"MEETING DATE", "MEETING TYPE":
		return true
	}
	return false
}

func parseProxyEdge(text string, meta FilingMeta) ([]VoteRow, error) {
	lines := peNonBlank(text)
	whole := peWholeCell(text)
	seriesIx := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK)
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
		if h := peHeaderAt(lines, i); h != nil {
			labels = h.labels
			i += h.consumed - 1
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
		// Only a whole cell can be a heading, and never the cell that follows
		// an item number under an open band: that pair is a ballot row whose
		// description peVoteRow refused, not a fund the vendor printed.
		if whole[i] && !peItemCell(lines, i-1, labels) && peFundName(line) {
			fund = line
			fundSeries = icrResolveFundShared(seriesIx, line)
			if fundSeries == "" {
				fundSeries = htmlDictionaryFund(seriesIx, dict, line)
			}
			continue
		}
		// The issuer heading is the bare line standing above the ballot's
		// identity block. Requiring that block to follow is what tells it from
		// the other bare cells this template prints between ballots -- the
		// agenda number, its proponent, the meeting date range -- each of which
		// would otherwise be taken for a new issuer and wipe the identity.
		if i+1 < len(lines) && peIdentityLabel(lines[i+1]) {
			issuer = line
			ticker, cusip, isin, mtgDate, mtgType = "", "", "", "", ""
		}
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
