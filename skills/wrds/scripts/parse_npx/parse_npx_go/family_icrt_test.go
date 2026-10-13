package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Royce Fund 2011 (0000709364-11-000021), lines 1-19, 601-606, 660-670 and
// 1640-1651 copied verbatim. This vintage prints the identifier cell with TWO
// spaces between the scheme label and the value:
//
//	ADTN             CUSIP  00738A106                      05/04/2011               Voted
//	FRES             CINS G371E2108                        05/17/2011               Voted
//
// icrCells splits on the two-space gap collapseSpaces preserves, so the CUSIP
// cell arrives as two cells and icrIdentity, counting back from the date, reads
// the scheme label as the ticker. Measured on the whole filing: 1,312 of its
// 1,902 distinct meetings carry the literal string CUSIP in the ticker column.
// The CINS block prints ONE space and so keeps its ticker, which is why the
// failure splits by scheme within a single filing.
func TestFamilyICRTWideLabelGapKeepsTicker(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_icrt", "ICRT_royce_2011_wide_label_gap.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	want := map[string]struct{ ticker, cusip, date string }{
		"ADTRAN, Inc.":  {"ADTN", "00738A106", "20110504"},
		"Fresnillo Plc": {"FRES", "G371E2108", "20110517"},
	}
	seen := map[string]bool{}
	for _, r := range rows {
		w, ok := want[r[colIssuerName]]
		if !ok {
			continue
		}
		seen[r[colIssuerName]] = true
		if r[colTicker] != w.ticker || r[colCUSIP] != w.cusip || r[colMeetingDate] != w.date {
			t.Errorf("%s item %s: ticker=%q cusip=%q date=%q; want ticker=%q cusip=%q date=%q",
				r[colIssuerName], r[colItemSeq], r[colTicker], r[colCUSIP], r[colMeetingDate],
				w.ticker, w.cusip, w.date)
		}
	}
	for name := range want {
		if !seen[name] {
			t.Fatalf("fixture emitted no rows for %s (rows=%d)", name, len(rows))
		}
	}
}
