package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Stratus Fund 2013, 0000870156-13-000034, lines 356-459 verbatim.
// The meeting row prints 7/24/2012 | LEGG MASON, INC. | 524901105 [LM ].
// 5/24/2012 is the record date; 6/28/2012 is the vote date, not the meeting.
func TestFamilyEStratusSecuritySymbolMeeting(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "family_e_stratus_security_symbol.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no Legg Mason proposals emitted")
	}
	for _, r := range rows {
		if r[colMeetingDate] != "20120724" || r[colCUSIP] != "524901105" || r[colIssuerName] != "LEGG MASON, INC." || r[colTicker] != "LM" {
			t.Errorf("Legg Mason %q: issuer=%q cusip=%q ticker=%q meeting_date=%q; want LEGG MASON, INC. / 524901105 / LM / 20120724", r[colVoteDescription], r[colIssuerName], r[colCUSIP], r[colTicker], r[colMeetingDate])
		}
	}
}
