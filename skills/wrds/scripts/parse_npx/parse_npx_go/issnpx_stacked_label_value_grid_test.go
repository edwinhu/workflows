package main

import (
	"os"
	"path/filepath"
	"testing"
)

// WisdomTree Trust 2023 (0001214659-23-011691; 3,199 of 295,205 rows undated on
// the current panel). The identity is not the canonical inline `Ticker: HEI
// Security ID: D31709104` pair but a two-line grid -- a row of bare labels,
// `Ticker:  Security ID:  Meeting Date:  Meeting Type:  Record Date:`, with the
// values on the line beneath, `HEI  D31709104  May-11-2023  Annual
// Apr-19-2023`. Only the label line is read, so the meeting date is lost and
// the id column is filled with the word "Meeting" off the label row; where the
// value line is taken for a heading it becomes the issuer, which is why the
// panel carries an issuer reading `TEL2.B  W95878166  May-15-2023  Annual
// May-05-2023`.
func TestISSNPXStackedLabelValueGrid(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "I_stacked_label_value_grid.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "HeidelbergCement AG" {
			continue
		}
		seen++
		if r[colMeetingDate] != "20230511" || r[colCUSIP] != "D31709104" || r[colTicker] != "HEI" {
			t.Fatalf("%s: date %q cusip %q ticker %q (%.40s), want date \"20230511\" cusip \"D31709104\" ticker \"HEI\"",
				r[colIssuerName], r[colMeetingDate], r[colCUSIP], r[colTicker], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no HeidelbergCement AG rows among %d", len(rows))
	}
}
