package main

import (
	"os"
	"path/filepath"
	"testing"
)

// GAMCO Westwood Funds 2011 (0000950123-11-080793; 633 of 8,267 rows undated on
// the current panel). Sixty-three of the filing's identity blocks double the
// space inside the label -- `TICKER  SYMBOL     SWSH` and `MEETING  DATE
// 05-May-2011` against the 777 blocks that spell `MEETING DATE` with one -- so
// the label is not recognised: the date is lost outright and the ticker is read
// as the word "SYMBOL". `SECURITY`, being one word, still yields 870808102.
func TestBroadridgeDoubledSpaceLabels(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "B14_doubled_space_labels.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "SWISHER HYGIENE INC." {
			continue
		}
		seen++
		if r[colMeetingDate] != "20110505" || r[colTicker] != "SWSH" {
			t.Fatalf("%s: date %q ticker %q cusip %q (%.40s), want date \"20110505\" ticker \"SWSH\"",
				r[colIssuerName], r[colMeetingDate], r[colTicker], r[colCUSIP], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no SWISHER HYGIENE INC. rows among %d", len(rows))
	}
}
