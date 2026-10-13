package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// First Trust Active Dividend Income Fund 2010 (0001445546-10-003495; 1,101 of
// 1,101 rows with no issuer, id or date on r179): each meeting opens with a
// column header, `COMPANY NAME | TICKER | SECURITY ID ON BALLOT | MEETING DATE
// | MEETING TYPE`, wrapped over two lines, and the identity as one value line
// beneath it -- `Analog Devices, Inc. | ADI | 032654105 | 20-Jul-09 | Special`
// -- before the item table's own header.
func TestBroadridgeColumnHeaderIdentityLine(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "B12_column_header_identity_line.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if !strings.HasPrefix(r[colVoteDescription], "Approve Repricing") {
			continue
		}
		seen++
		if r[colIssuerName] != "Analog Devices, Inc." || r[colCUSIP] != "032654105" || r[colMeetingDate] != "20090720" || r[colHowVoted] != "For" {
			t.Fatalf("issuer %q cusip %q date %q vote %q", r[colIssuerName], r[colCUSIP], r[colMeetingDate], r[colHowVoted])
		}
	}
	if seen != 1 {
		t.Fatalf("%d Analog Devices rows among %d", seen, len(rows))
	}
	for _, r := range rows {
		if r[colIssuerName] == "" || r[colMeetingDate] == "" {
			t.Fatalf("row with no issuer or date: %.60s", r[colVoteDescription])
		}
	}
}
