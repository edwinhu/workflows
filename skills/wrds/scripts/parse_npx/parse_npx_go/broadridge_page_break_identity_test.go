package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Clearwater Investment Trust 2007 (0001169232-07-003503; 693 of 722 meetings
// with no CUSIP of their own on r159, their 5,100 identified rows carrying a
// stale one): a page break falls INSIDE the identity lines -- `Security
// 968223206 ... Meeting Type Annual`, then `</TABLE>`, `<TABLE>`, then `Ticker
// Symbol JWA ... Meeting Date 21-Sep-2006` -- and the id read before the break
// was cleared at it.
func TestBroadridgePageBreakInsideIdentity(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "B10_page_break_in_identity.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colVoteDescription] != "KIM JONES" && r[colVoteDescription] != "R.W. MCDANIEL, JR." {
			continue
		}
		seen++
		if r[colCUSIP] != "968223206" || r[colIssuerName] != "JOHN WILEY & SONS, INC." || r[colMeetingDate] != "20060921" {
			t.Fatalf("%s: issuer %q cusip %q date %q", r[colVoteDescription], r[colIssuerName], r[colCUSIP], r[colMeetingDate])
		}
	}
	if seen != 2 {
		t.Fatalf("%d Wiley nominee rows among %d", seen, len(rows))
	}
}
