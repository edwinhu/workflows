package main

import (
	"os"
	"path/filepath"
	"testing"
)

// MET Investors Series Trust 2013 (0001193125-13-350373; 13,313 of 34,774 rows
// with no id on the current panel, every one of them in the Schroders Global
// Multi-Asset Portfolio section). The section's report is too wide for a page,
// so the filer prints each page as two side-by-side tables carrying the SAME
// rows in the same order: a left half headed `LocationID | ... | Company Name |
// Ticker | Primary Security ID | Security ID on Ballot | ISIN | CUSIP` and a
// right half headed `Meeting Date | ... | Proposal | Vote Instruction |
// Voted_YN`. Only the right half has vote columns, so the votes are read from
// it and the identity half -- Tesco plc, TSCO, G87621101, GB0008847096 -- is
// dropped: the meeting date survives and the id does not.
//
// The fixture is the last page of that section, both halves, and is the
// shortest such pair in the filing: 404 verbatim lines, five identity rows
// against five vote rows.
//
// MET Investors 2010 (0001193125-10-201666) prints the same construction split
// three ways, with the identity half read and the `Meeting Date` half dropped;
// that is where its 2,991 undated rows come from.
func TestHTMLTableSplitPageIdentityHalf(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H83_split_page_identity_half.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := parseHTMLTableRaw(raw, "", FilingMeta{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r.IssuerName != "Tesco plc" || r.CUSIP != "G87621101" || r.MeetingDate != "20130628" {
			t.Fatalf("%q: issuer %q cusip %q isin %q ticker %q date %q, want issuer \"Tesco plc\" cusip \"G87621101\" date \"20130628\"",
				r.VoteDescription, r.IssuerName, r.CUSIP, r.ISIN, r.Ticker, r.MeetingDate)
		}
	}
}
