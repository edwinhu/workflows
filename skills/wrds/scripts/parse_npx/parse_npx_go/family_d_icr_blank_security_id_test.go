package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Thrivent 2009, 0001193125-09-182296, lines 475-501 and 3868-3884,
// copied verbatim. The empty Security ID cell must not consume VTEQINV,
// which is printed under Ticker. The PAR block retains its labelled CUSIP.
func TestFamilyDICRBlankSecurityIDKeepsTicker(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "icr", "D_thrivent_blank_security_id.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen, control := 0, 0
	for _, r := range rows {
		if r[colCUSIP] == "88580F109" {
			control++
			if r[colTicker] != "PAR" {
				t.Fatalf("control ticker=%q, want PAR", r[colTicker])
			}
		}
		if r[colIssuerName] == "Thrivent Equity Income Plus Portfolio" {
			seen++
		}
	}
	if seen == 0 || control == 0 {
		t.Fatalf("fixture did not emit both blocks: Thrivent=%d control=%d", seen, control)
	}
	for _, r := range rows {
		if r[colIssuerName] != "Thrivent Equity Income Plus Portfolio" {
			continue
		}
		if r[colTicker] != "VTEQINV" || r[colCUSIP] != "" || r[colISIN] != "" {
			t.Fatalf("%s item %s: ticker=%q cusip=%q isin=%q layout=%q; want ticker VTEQINV and blank CUSIP/ISIN",
				r[colIssuerName], r[colItemSeq], r[colTicker], r[colCUSIP], r[colISIN], r[len(r)-1])
		}
	}
}
