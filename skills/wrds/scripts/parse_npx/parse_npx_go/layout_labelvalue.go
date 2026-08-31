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

func matchLabelValue(head string) bool {
	for _, line := range strings.Split(head, "\n") {
		if lvColumnHeader(icrCells(strings.TrimSpace(line))) {
			return true
		}
	}
	return false
}

// lvLabelled reads a `Label: value` pair out of a cell, returning the label
// uppercased and the value verbatim.
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

func parseLabelValue(text string, meta FilingMeta) ([]VoteRow, error) {
	lines := strings.Split(text, "\n")
	seriesIdx := seriesByName(meta.SeriesDecls)

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
			fund = name
			curSeries = icrResolveFund(seriesIdx, name)
			inBlock = false
			lastRow = -1
			continue
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
		if label, value, ok := lvLabelled(cells[0]); ok {
			matched := true
			switch label {
			case "TICKER":
				ticker = value
			case "MEETING DATE":
				mtgDate = htmlDate(value)
			case "RECORD DATE":
			default:
				matched = false
			}
			if matched {
				for _, c := range cells[1:] {
					if l2, v2, ok2 := lvLabelled(c); ok2 {
						switch l2 {
						case "SECURITY ID":
							cusip = v2
						case "MEETING TYPE":
							mtgType = v2
						}
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

		// A wrapped description, on the line directly under its row.
		if lastRow >= 0 && i == lastLine+1 && len(cells) == 1 && !icrItem(cells[0]) {
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
		if len(cells) == 1 {
			// The ISSUER heading, which this grammar prints above the identity
			// pairs with nothing to mark it.
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
