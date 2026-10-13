package main

import (
	"os"
	"path/filepath"
	"testing"
)

// MET Investors Series Trust 2010 (0001193125-10-201666; 1,112 of 24,569 rows
// with no id on the current panel, all of them in the Rainier Large Cap Equity
// Portfolio section). The section heads one column `Company (Ticker/CUSIP) /
// Ballot Issues` and prints the identity as a single value in it --
// `Wal-Mart Stores, Inc. (WMT/931142103)` -- so the whole string is kept as the
// issuer name and neither the ticker nor the CUSIP is read. The meeting date,
// which has a column of its own, survives.
func TestHTMLTableCompanyTickerCUSIPParens(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H84_company_ticker_cusip_parens.txt"))
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
		if r.IssuerName != "Wal-Mart Stores, Inc." || r.CUSIP != "931142103" || r.Ticker != "WMT" {
			t.Fatalf("%q: issuer %q cusip %q ticker %q date %q, want issuer \"Wal-Mart Stores, Inc.\" cusip \"931142103\" ticker \"WMT\"",
				r.VoteDescription, r.IssuerName, r.CUSIP, r.Ticker, r.MeetingDate)
		}
	}
}
