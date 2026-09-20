package main

import "strings"

// agenda reads the Thomson 2004 `Agenda:` block, filed through agent 0001206774
// in the first N-PX season by The Royce Fund, CDC Nvest, Manufacturers
// Investment Trust and their siblings (82 filings, 138.6 MB, every one recorded
// as `skip` before 2026-09-19):
//
//	PENNSYLVANIA MUTUAL FUND                                    ROYCE FUND
//	- ------------------------------------------------------------------
//	AAON, INC.                                        Agenda: 932150915
//	     CUSIP: 000360206              Meeting Type: Annual
//	    Ticker: AAON                   Meeting Date: 5/25/2004      ISIN:
//	                                                       For/Against
//	Proposal                           Type        Vote        Management
//	- ------------------------------------------------------------------
//	01     THOMAS E. NAUGLE             Mgmt          For           For
//	       JERRY E. RYAN                Mgmt          For           For
//
// This is the labelvalue grammar -- LABEL: VALUE identity over a proposal table
// whose roles come from the header -- with three differences that defeat every
// existing signature. The identity pairs are RIGHT-ALIGNED, so the label carries
// leading spaces. The header's last label is STACKED over two physical lines
// (`For/Against` above `Management`), so no single line names a contiguous vote
// column, and the words `Vote Cast` appear nowhere in the filing. And only the
// FIRST proposal of a slate carries an item number; the rest are bare names
// under it.
//
// ROLES COME FROM THE RIGHT-HAND ANCHOR, never from a fixed column count: the
// proponent word is the third cell from the end, the vote follows it, and the
// For/Against-Management indicator closes the row. Counting from the left would
// file a director's name as a vote on every unnumbered row.

// agProponents is the Type column's vocabulary. It is what anchors a row, so it
// stays closed.
var agProponents = []string{"MGMT", "SHLDR", "SHR", "MANAGEMENT", "SHAREHOLDER", "SHRHLDR", "ISSUER"}

func agProponent(s string) bool {
	up := strings.ToUpper(strings.TrimSpace(s))
	for _, p := range agProponents {
		if up == p {
			return true
		}
	}
	return false
}

// agColumnHeader recognises the row that names this grammar's columns: a first
// cell reading `Proposal` and a cell reading `Vote`. The `For/Against` fragment
// printed on the line above belongs to the LAST column, which this layout reads
// positionally from the right and so does not need to name.
func agColumnHeader(cells []string) bool {
	if len(cells) < 3 || !strings.EqualFold(strings.TrimSpace(cells[0]), "Proposal") {
		return false
	}
	for _, c := range cells[1:] {
		if strings.EqualFold(strings.TrimSpace(c), "Vote") {
			return true
		}
	}
	return false
}

// matchAgenda requires the header AND the block marker. The header alone is
// ordinary vocabulary; `Agenda:` beside an issuer name is what names this vendor.
func matchAgenda(head string) bool {
	var header, marker bool
	for _, line := range strings.Split(head, "\n") {
		trimmed := strings.TrimSpace(line)
		if agColumnHeader(icrCells(trimmed)) {
			header = true
		}
		if strings.Contains(trimmed, "Agenda:") {
			marker = true
		}
		if header && marker {
			return true
		}
	}
	return false
}

func init() {
	entry := layoutEntry{Name: "agenda", Match: matchAgenda, Parse: parseAgenda,
		// The first block sits behind a cover page and the SEC's Item 1
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

// agRule is the escaped dashed rule EDGAR prints between blocks (`- -----`).
func agRule(line string) bool {
	t := strings.TrimSpace(line)
	if len(t) < 10 {
		return false
	}
	return strings.Trim(t, "- ") == "" && strings.Count(t, "-") >= 8
}

func parseAgenda(text string, meta FilingMeta) ([]VoteRow, error) {
	lines := strings.Split(text, "\n")
	seriesIx := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))
	issFormerKeys(seriesIx, meta.FormerNames)
	dict := cikDict.exactFallback(meta)

	var (
		rows       []VoteRow
		fund       string
		fundSeries string
		heading    string
		issuer     string
		ticker     string
		cusip      string
		isin       string
		mtgDate    string
		mtgType    string
		inBlock    bool
		blockSeen  bool
	)

	for _, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			continue
		}
		if agRule(raw) {
			// The fund banner is the two-cell line the report prints above the
			// first rule of a page: the fund on the left, the registrant on the
			// right. A rule preceded by anything else names nothing.
			if heading != "" {
				fund = heading
				fundSeries = icrResolveFundShared(seriesIx, fund)
				if fundSeries == "" {
					fundSeries = htmlDictionaryFund(seriesIx, dict, fund)
				}
				heading = ""
				blockSeen = false
			}
			// The rule is drawn UNDER the column header as well as between
			// blocks, so it never closes a block: only a line outside the
			// grammar does.
			continue
		}
		if strings.HasPrefix(line, "<") {
			// A fresh table opens a fresh page, and the fund banner is the first
			// text on it.
			if up := strings.ToUpper(line); strings.HasPrefix(up, "<TABLE") || strings.HasPrefix(up, "<S>") {
				blockSeen = false
			}
			continue
		}
		cells := icrCells(line)
		if agColumnHeader(cells) {
			inBlock, blockSeen = true, true
			// The `For/Against` fragment stacked above this line belongs to the
			// last column, not to a fund.
			heading = ""
			continue
		}
		if inBlock {
			if row, ok := agVoteRow(cells); ok {
				row.IssuerName = issuer
				row.Ticker = ticker
				row.CUSIP = icrCUSIP(cusip)
				row.ISIN = isin
				row.MeetingDate = mtgDate
				row.MeetingType = mtgType
				row.FundName = fund
				row.SeriesID = fundSeries
				rows = append(rows, row)
				continue
			}
			inBlock = false
		}
		// Identity, as right-aligned LABEL: VALUE pairs. The label is what is
		// required; a blank Ticker or ISIN is normal on a foreign ballot.
		if pairs := lvPairs(cells); len(pairs) > 0 {
			var identity bool
			for _, p := range pairs {
				switch p.label {
				case "CUSIP":
					cusip, identity = p.value, true
				case "TICKER":
					ticker, identity = p.value, true
				case "ISIN":
					isin, identity = p.value, true
				case "MEETING DATE":
					mtgDate, identity = htmlDate(p.value), true
				case "MEETING TYPE":
					mtgType, identity = p.value, true
				case "AGENDA":
					// The issuer heading shares its line with the agenda id.
					identity = true
					if name := strings.TrimSpace(cells[0]); name != "" && !strings.Contains(name, ":") {
						issuer = name
						ticker, cusip, isin, mtgDate, mtgType = "", "", "", "", ""
					}
				}
			}
			if identity {
				continue
			}
		}
		// A line carrying no label is the page's fund banner, which the next rule
		// adopts. Royce prints it as two cells -- the fund on the left, the
		// registrant on the right -- but Manufacturers prints ONE, the account
		// code glued to the name by a single space (`2A01 MIT Emerging Small
		// Company Trust`), which icrCells does not split. A banner is printed at
		// column 0 ABOVE the page's first column header, never inside a proposal
		// table: inside one every line is a wrapped continuation of a
		// description, indented under its item, and adopting one would file the
		// rest of the page under a fragment of a proposal. The cell count does
		// not separate the two -- a continuation carrying an internal run of two
		// or more spaces comes back as two cells -- so the open block does, for
		// every cell count alike.
		_, isVote := agVoteRow(cells)
		banner := len(cells) >= 1 && !blockSeen
		// A proposal row the vote reader declined is not a fund heading. On a
		// contested or consent ballot the vendor prints the Type column and stops,
		// so the row is too short for agVoteRow and only the first proposal of a
		// slate carries an item number; a candidate whose LAST cell names the Type
		// column belongs to the open block's table whatever its cell count.
		inTable := blockSeen && (icrItem(cells[0]) || agProponent(cells[len(cells)-1]))
		if !isVote && banner && !inTable && !agPageFooter(strings.TrimSpace(cells[0])) {
			heading = strings.TrimSpace(cells[0])
		}
	}

	if len(rows) == 0 {
		return nil, errLayoutDeclined
	}
	return rows, nil
}

// agPageFooter reports a line whose whole content is a bare digit run. American
// Funds Insurance Series right-aligns the REGISTRANT'S OWN CIK on the line under
// each ruled fund banner, and the banner rule then adopts that line instead of
// the fund above it. A digit run names no fund at any rung, so it is page
// furniture and must not displace the banner it follows.
func agPageFooter(s string) bool {
	if s == "" {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// agVoteRow reads one proposal row from the right: the proponent is the third
// cell from the end, the vote follows it, and the For/Against-Management
// indicator closes the row. Only the first proposal of a slate carries an item
// number, so a leading item is optional rather than required.
func agVoteRow(cells []string) (VoteRow, bool) {
	n := len(cells)
	if n < 4 || !agProponent(cells[n-3]) {
		return VoteRow{}, false
	}
	vote := strings.TrimSpace(cells[n-2])
	if vote == "" {
		return VoteRow{}, false
	}
	head := cells[:n-3]
	item := ""
	if len(head) > 1 && icrItem(strings.TrimSpace(head[0])) {
		item = strings.TrimSpace(head[0])
		head = head[1:]
	}
	desc := strings.TrimSpace(strings.Join(head, " "))
	if desc == "" {
		return VoteRow{}, false
	}
	return VoteRow{
		ItemSeq:         item,
		VoteDescription: desc,
		VoteSource:      strings.TrimSpace(cells[n-3]),
		HowVoted:        vote,
		VoteOtherInfo:   strings.TrimSpace(cells[n-1]),
	}, true
}
