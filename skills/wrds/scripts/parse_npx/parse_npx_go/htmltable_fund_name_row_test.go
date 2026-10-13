package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestHTMLTableFundNameRow pins the HTML vintage that prints each fund's name
// as a ONE-CELL ROW of the table itself, not as a heading between tables:
//
//	|American Century Focused Dynamic Growth ETF|
//	|AMAZON.COM, INC. ... Meeting Date: MAY 24, 2023 ...|
//	|1a|Elect Director Jeffrey P. Bezos|Management|For|For|
//
// htmlFundHeading reads only the markup between tables, so this vintage
// stamped nothing: American Century ETF Trust alone is 713k rows with no
// fund name read, and htmltable's series fill is 34.5% (2026-09-02). A row
// whose sole cell equals a declared series name exactly is the header's own
// evidence of which fund follows; nothing positional is guessed.
func TestHTMLTableFundNameRow(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H15_fund_name_row.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows; the fixture's first voting table must parse")
	}
	amazon := 0
	for _, r := range rows {
		if r[colIssuerName] != "AMAZON.COM, INC." {
			continue
		}
		amazon++
		if v := r[colSeriesID]; v != "S000063004" {
			t.Errorf("item %s: series_id = %q, want S000063004 (American Century Focused Dynamic Growth ETF)", r[colItemSeq], v)
		}
	}
	if amazon == 0 {
		t.Fatalf("no AMAZON.COM rows among %d", len(rows))
	}
}
