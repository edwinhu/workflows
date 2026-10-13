package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 0001144204-05-027488, lines 241-677 verbatim. Issuer: 221485105
// follows the unlabelled COST PLUS, INC. / CPWM meeting row.
func TestFamilyFCostPlusIssuerCUSIP9(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "family_f_costplus_issuer_cusip9.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	t.Logf("fixture emitted %d rows", len(rows))
	found := false
	for _, r := range rows {
		if r[colVoteDescription] != "ELECTION OF DIRECTORS" {
			continue
		}
		found = true
		if r[colCUSIP] != "221485105" || r[colTicker] != "CPWM" {
			t.Errorf("Cost Plus election: layout=%q issuer=%q cusip=%q ticker=%q meeting_date=%q; want cusip=221485105 ticker=CPWM", r[len(r)-1], r[colIssuerName], r[colCUSIP], r[colTicker], r[colMeetingDate])
		}
	}
	if !found {
		t.Fatal("Cost Plus election proposal not emitted")
	}
}

// 0001144204-05-027715, lines 245-481 verbatim. The two-row header's
// Security[Symbol] column carries 423074103[HNZ] in the Heinz meeting row.
func TestFamilyFMcGlinnSecuritySymbol(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "family_f_mcglinn_security_symbol.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	t.Logf("fixture emitted %d rows", len(rows))
	found := false
	for _, r := range rows {
		if !strings.EqualFold(r[colVoteDescription], "Election of Directors") {
			continue
		}
		found = true
		if r[colCUSIP] != "423074103" || r[colTicker] != "HNZ" {
			t.Errorf("Heinz election: layout=%q issuer=%q cusip=%q ticker=%q meeting_date=%q; want cusip=423074103 ticker=HNZ", r[len(r)-1], r[colIssuerName], r[colCUSIP], r[colTicker], r[colMeetingDate])
		}
	}
	if !found {
		t.Fatal("Heinz election proposal not emitted")
	}
}
