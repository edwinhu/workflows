package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Hartford Series Fund 2006 (0000950135-06-005379; 719 rows with no issuer
// and 971 with no id on r159): a Hong Kong meeting numbers its special
// resolutions `S.1.1`, `S.5`, which the item reader refused, so each such
// line was free text that closed the meeting, and its wrapped text became
// rows of its own.
func TestBroadridgeLetteredSpecialItems(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "B11_lettered_special_items.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if !strings.HasPrefix(r[colVoteDescription], "Approve the public offering of A") && !strings.HasPrefix(r[colVoteDescription], "Approve and adopt the Connected") {
			continue
		}
		seen++
		if r[colIssuerName] != "AIR CHINA LTD" || r[colCUSIP] != "Y002A6104" || r[colMeetingDate] != "20060328" || r[colHowVoted] != "For" {
			t.Fatalf("%.40s: issuer %q cusip %q date %q vote %q", r[colVoteDescription], r[colIssuerName], r[colCUSIP], r[colMeetingDate], r[colHowVoted])
		}
	}
	if seen < 10 {
		t.Fatalf("%d Air China special rows among %d", seen, len(rows))
	}
	for _, r := range rows {
		if r[colIssuerName] == "" {
			t.Fatalf("row with no issuer: %.60s", r[colVoteDescription])
		}
	}
}
