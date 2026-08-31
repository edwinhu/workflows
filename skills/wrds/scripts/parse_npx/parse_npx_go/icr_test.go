package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The ISS "Investment Company Report" grammar was measured on 2026-08-30 over
// the 1,181 still-skipping filings carrying 50 or more vote-like lines: 144
// print the `Issue No.` column header and 79 the wrapped `Issue / No.` one,
// together 4,782,470 of the 7,851,449 lines those filings hold. No layout
// claimed any of them, so every row was lost as `skip`.
//
// Both fixtures are VERBATIM CONTIGUOUS byte ranges of real filings and every
// count below was read off those bytes by hand. Neither begins after the defect:
// each starts at the report's own `Item 1` / `Registrant Name` preamble, so the
// layout must find its first block header from the same place the corpus makes
// it find one.

type icrCase struct {
	file string
	// blocks maps each issuer the fixture prints to the number of item rows
	// under it, counted by hand from the fixture's own item numbers.
	blocks map[string]int
	rows   int
	note   string
}

var icrCases = []icrCase{
	{
		file: "ICR1_hartford_wide.txt",
		blocks: map[string]int{
			"3M Company":    14,
			"Accenture PLC": 12,
			"Ace Limited":   17,
		},
		rows: 43,
		note: "0001144204-11-049903 at the `Item 1. Proxy Voting Record` preamble;" +
			" three consecutive <TABLE> blocks in the `Issue No.` spelling",
	},
	{
		file: "ICR2_russell_wrapped.txt",
		blocks: map[string]int{
			"3M Company":                17,
			"Activision Blizzard, Inc.": 14,
		},
		rows: 31,
		note: "0001193125-12-366724 at `Registrant Name :`; the wrapped `Issue / No.`" +
			" spelling, and the fixture opens with a NIL-REPORT section whose prose" +
			" (`The fund did not vote proxies...`) must contribute no row and must not" +
			" be appended to any description",
	},
}

func loadICRFixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "icr", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(b)
}

// TestICRExtractsEveryItemRow is the coverage assertion. An exact count, not a
// floor: this grammar's failure mode is silent under-extraction -- a layout that
// closes its table on one unrecognised line loses the rest of the document --
// and a `>= 1` assertion would pass on the first block alone.
func TestICRExtractsEveryItemRow(t *testing.T) {
	for _, c := range icrCases {
		t.Run(c.file, func(t *testing.T) {
			rows := runISSNPXDoc(t, loadICRFixture(t, c.file))
			if len(rows) != c.rows {
				t.Errorf("got %d rows, want %d (%s)", len(rows), c.rows, c.note)
			}
			perIssuer := map[string]int{}
			for _, r := range rows {
				perIssuer[r[colIssuerName]]++
			}
			for issuer, want := range c.blocks {
				if got := perIssuer[issuer]; got != want {
					t.Errorf("issuer %q: got %d rows, want %d\n  issuers seen: %v",
						issuer, got, want, perIssuer)
				}
			}
		})
	}
}

// TestICRReadsEveryColumnFromItsOwnCell is the correctness assertion. The whole
// design claim is that the two-space gap collapseSpaces preserves IS the column
// boundary, so each value must come from the cell the filing printed it in. A
// row whose how_voted holds a word from the description is the defect this
// layout exists to avoid, and it would still pass a row COUNT.
func TestICRReadsEveryColumnFromItsOwnCell(t *testing.T) {
	rows := runISSNPXDoc(t, loadICRFixture(t, "ICR1_hartford_wide.txt"))
	want := map[string][6]string{
		// item, description, proponent, mgmt rec, how voted, issuer
		"3M Company|1":   {"1", "Elect Linda Alvarado", "Mgmt", "For", "For", "88579Y101"},
		"3M Company|13":  {"13", "Frequency of Advisory Vote on Executive Compensation", "Mgmt", "1 Year", "3 Years", "88579Y101"},
		"3M Company|14":  {"14", "Shareholder Proposal Regarding Political Contributions and Expenditure Report", "ShrHoldr", "Against", "Against", "88579Y101"},
		"Ace Limited|17": {"17", "Frequency of Advisory Vote on Executive Compensation", "Mgmt", "For", "1 Year", "H0023R105"},
	}
	got := map[string][6]string{}
	for _, r := range rows {
		got[r[colIssuerName]+"|"+r[colItemSeq]] = [6]string{
			r[colItemSeq], r[colVoteDescription], r[colVoteSource],
			r[colMgmtRec], r[colHowVoted], r[colCUSIP]}
	}
	for key, w := range want {
		g, ok := got[key]
		if !ok {
			t.Errorf("%s: no such row", key)
			continue
		}
		if g != w {
			t.Errorf("%s:\n  got  %q\n  want %q", key, g, w)
		}
	}
}

// TestICRCarriesMeetingIdentity pins the block header fields. They are link
// keys: a row attributed to the wrong meeting is worse than a row with a blank
// one, so these come from the block's own identity line and never from a
// neighbouring block's.
func TestICRCarriesMeetingIdentity(t *testing.T) {
	rows := runISSNPXDoc(t, loadICRFixture(t, "ICR2_russell_wrapped.txt"))
	want := map[string][3]string{
		"3M Company":                {"MMM", "20120508", "88579Y101"},
		"Activision Blizzard, Inc.": {"ATVI", "20120607", "00507V109"},
	}
	seen := map[string]bool{}
	for _, r := range rows {
		issuer := r[colIssuerName]
		w, ok := want[issuer]
		if !ok {
			t.Errorf("row attributed to unexpected issuer %q (item %q)", issuer, r[colItemSeq])
			continue
		}
		seen[issuer] = true
		if g := [3]string{r[colTicker], r[colMeetingDate], r[colCUSIP]}; g != w {
			t.Errorf("issuer %q item %q: got ticker/date/cusip %q, want %q",
				issuer, r[colItemSeq], g, w)
		}
	}
	for issuer := range want {
		if !seen[issuer] {
			t.Errorf("no row carries issuer %q", issuer)
		}
	}
}

// TestICRNeverSwallowsNilReportProse is the safety assertion for the
// continuation rule. ICR2 opens with a fund that reports no votes, and its prose
// sits between blocks with no item number and one cell -- exactly the shape of a
// wrapped description. Anchoring the continuation to the line DIRECTLY under its
// row is what separates them; an unanchored rule appends a sentence about not
// voting to a real vote's description.
func TestICRNeverSwallowsNilReportProse(t *testing.T) {
	doc := loadICRFixture(t, "ICR2_russell_wrapped.txt")
	if !strings.Contains(doc, "did not vote proxies") {
		t.Fatalf("fixture no longer carries the nil-report section; the assertion below proves nothing")
	}
	for _, r := range runISSNPXDoc(t, doc) {
		d := r[colVoteDescription]
		for _, bad := range []string{"did not vote", "In all markets", "Key-", "Fund Name", "Registrant"} {
			if strings.Contains(d, bad) {
				t.Errorf("item %q description absorbed non-row prose %q: %q", r[colItemSeq], bad, d)
			}
		}
	}
}

// TestICRDeclinesAForeignBlockHeader is the safety assertion that bounds what
// this layout may claim. ICR3 is a verbatim contiguous excerpt of
// 0001193125-15-299145, a filing in an unrelated grammar whose own header names
// the same three labels among nine columns:
//
//	INSTITUTIONAL ACCOUNT NAME  TICKER  COUNTRY  SECURITY ID  MEETING ID
//	  MEETING TYPE  MEETING DATE  RECORD DATE  STATUS
//
// A matcher that merely looked for the three labels claimed it, and the corpus
// run then produced 1,882 rows whose how_voted held description text
// (`Elect Director Orlando D. Ashford`) or an identifier run
// (`US0152711091 015271109 2009210 USA`). Declining is the whole point: this
// layout must lose a filing it cannot read rather than report values the filing
// never printed in that cell.
func TestICRDeclinesAForeignBlockHeader(t *testing.T) {
	doc := loadICRFixture(t, "ICR3_foreign_header.txt")
	if !strings.Contains(doc, "MEETING ID") {
		t.Fatalf("fixture no longer carries the nine-column header; the assertion proves nothing")
	}
	if matchICR(string(stripHTML([]byte(doc)))) {
		t.Errorf("icr claimed a nine-column header from a grammar it cannot read")
	}
}
