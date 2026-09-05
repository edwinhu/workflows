package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Kiewit Investment Fund 2007 (0001302716-07-000020, 2,766 rows with no issuer
// and the CUSIP in the vote cell on r139; the SSgA vote summary that 295
// htmltable filings print): the header wraps over two rows whose colspans
// differ from the rows', so the joined `Company/ Ballot Issues` label sits one
// column LEFT of the proposals and `Prpnent` one column left of `Mgmt`. Every
// proposal row failed the mapping and only the identity rows were emitted, as
// votes with the CUSIP in the vote cell. A field whose column is empty in every
// row that fills its unmapped neighbour belongs to the neighbour, and a
// CUSIP-shaped vote cell is never a vote row.
func TestHTMLTableSSgASummaryColspanShift(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H49_ssga_summary_colspan_shift.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if pvTextCUSIP(r[colHowVoted]) {
			t.Fatalf("identity row emitted as a vote: %q", r)
		}
		if r[colIssuerName] != "3com Corp. *COMS*" {
			continue
		}
		seen++
		if r[colCUSIP] != "885535104" || r[colMeetingDate] != "20060920" || r[colHowVoted] != "For" || r[colVoteDescription] == "" {
			t.Fatalf("3com: cusip %q date %q vote %q desc %q, want 885535104 / 20060920 / For / a proposal", r[colCUSIP], r[colMeetingDate], r[colHowVoted], r[colVoteDescription])
		}
	}
	if seen < 2 {
		t.Fatalf("%d 3com proposal rows among %d, want at least 2", seen, len(rows))
	}
}
