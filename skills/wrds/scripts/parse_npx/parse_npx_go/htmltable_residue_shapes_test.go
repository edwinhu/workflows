package main

import (
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

// After the v9 corpus build 13,229 filings still skip. Classified on WRDS over the
// whole residue: 4,287 HTML_table, 4,141 HTML_other, 4,069 TEXT_plain, 732
// PRE_fixed_width. The htmltable layout therefore takes 11,283 of 19,711 HTML
// filings -- 57% -- and the residue averages 12.9 MB per filing, so it is not the
// small leftovers it was being treated as.
//
// Three filings were sampled from that residue and their cell structure read
// directly. They fail for three DIFFERENT reasons, which is why one more synonym
// or one more tolerance would not have moved the number.
//
// Every count below was read out of the fixture's own bytes by walking its <tr>
// elements and printing the cells, not inferred from what the parser returned.

type residueShape struct {
	file      string
	wantRows  int
	why       string
	mustHave  []string // description substrings that must appear among extracted rows
	mustNotBe []string // header/context text that must never become a vote row
}

var residueShapes = []residueShape{
	{
		file:     "H11_split_header.txt",
		wantRows: 10,
		why: "the header is split VERTICALLY across two <tr>s -- ['Mtg','Company/','Mgmt','Vote'," +
			"'Record','Shares'] then ['Date/Type','Ballot Issues','Security','Rec','Cast','Date'," +
			"'Prpnent','Voted'] -- so the real column names are the column-wise joins 'Mtg Date/Type'," +
			" 'Vote Cast', 'Mgmt Rec'. Neither row alone carries three mapped fields, so a" +
			" single-row header test cannot see a header here at all.",
		mustHave: []string{"Amend Articles", "Authorize Share Repurchase", "Approve Arrangement"},
		// Meeting-context rows have the SAME arity (5) as vote rows; they are told apart by
		// content, not shape: context is date/company/CUSIP/date/shares, a vote row carries
		// vote values in the trailing cells. A repeated header appears at the page break.
		mustNotBe: []string{"Ballot Issues", "Meeting for ADR Holders", "Hellenic Telecommunications"},
	},
	{
		file:     "H12_interleaved_arity.txt",
		wantRows: 21,
		why: "the header ['Proposal #','Proposal','Vote','Author','MRV*','vs. Mgmt'] is present and" +
			" mappable, but the body interleaves 1-cell issuer names, 2-cell 'Ticker/Cusip' and" +
			" 2-cell 'Record Date/Meeting Date' rows between the 6-cell vote rows, and repeats the" +
			" header before every issuer. A 'following rows of comparable arity' test sees" +
			" 1,2,2,6,6,6,6,1,2,2,6 and rejects the table.",
		mustHave:  []string{"Ratification of appointment of KPMG", "Election of Director: Chansoo Joung"},
		mustNotBe: []string{"Proposal #", "Ticker Symbol", "Record Date", "ANADARKO PETROLEUM"},
	},
	{
		file:     "H13_wide_export.txt",
		wantRows: 20,
		why: "a fully labelled 13-column export: Issuer Name, Country, Meeting Date, Meeting Type," +
			" Ticker, Security ID, Symbol Type, Proposal Text, Proponent, Mgmt Reco, Vote Cast," +
			" Fund Name, Logical Ballot Status. Every field the header test asks for is named" +
			" explicitly, so whatever rejects this one is NOT a missing synonym.",
		mustHave:  []string{"Elect Kathy T. Betty", "Frequency of Advisory Vote", "Elect Dennis K. Williams"},
		mustNotBe: []string{"Issuer Name", "Proposal Text", "Symbol Type"},
	},
}

func loadResidueFixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(b)
}

// TestHTMLResidueShapesExtractVotes is the coverage assertion for the three shapes
// that account for the HTML residue.
func TestHTMLResidueShapesExtractVotes(t *testing.T) {
	for _, c := range residueShapes {
		t.Run(c.file, func(t *testing.T) {
			rows := runISSNPXDoc(t, loadResidueFixture(t, c.file))
			if len(rows) != c.wantRows {
				t.Errorf("got %d rows, want %d\n  why this filing is hard: %s",
					len(rows), c.wantRows, c.why)
			}
			joined := ""
			for _, r := range rows {
				joined += r[colVoteDescription] + "\n"
			}
			for _, want := range c.mustHave {
				if !contains(joined, want) {
					t.Errorf("no extracted row describes %q\n  extracted %d rows", want, len(rows))
				}
			}
		})
	}
}

// TestHTMLResidueNeverEmitsHeaderOrContextAsAVote is the safety assertion. Each of
// these fixtures repeats its header mid-table and carries meeting-context rows; a
// layout that relaxes its way to the row count by treating those as votes has made
// the data worse, not better.
func TestHTMLResidueNeverEmitsHeaderOrContextAsAVote(t *testing.T) {
	for _, c := range residueShapes {
		t.Run(c.file, func(t *testing.T) {
			for i, r := range runISSNPXDoc(t, loadResidueFixture(t, c.file)) {
				d := r[colVoteDescription]
				for _, bad := range c.mustNotBe {
					if contains(d, bad) {
						t.Fatalf("row %d has description %q, which is %q -- a header or"+
							" meeting-context row emitted as a vote", i, d, bad)
					}
				}
			}
		})
	}
}

func contains(h, n string) bool {
	return len(n) > 0 && len(h) >= len(n) && fmt.Sprintf("%s", h) != "" && indexOf(h, n) >= 0
}

func indexOf(h, n string) int {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return i
		}
	}
	return -1
}
