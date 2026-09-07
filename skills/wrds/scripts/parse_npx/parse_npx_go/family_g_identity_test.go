package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func familyGAssertCUSIP(t *testing.T, fixture, proposal, cusip string) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "family_g", fixture))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	t.Logf("fixture emitted %d rows", len(rows))
	found := false
	for _, r := range rows {
		t.Logf("row: issuer=%q cusip=%q isin=%q ticker=%q date=%q description=%q layout=%q", r[colIssuerName], r[colCUSIP], r[colISIN], r[colTicker], r[colMeetingDate], r[colVoteDescription], r[len(r)-1])
		if !strings.Contains(r[colVoteDescription], proposal) {
			continue
		}
		found = true
		if r[colCUSIP] != cusip {
			t.Errorf("layout=%q issuer=%q cusip=%q ticker=%q meeting_date=%q description=%q; want cusip=%s", r[len(r)-1], r[colIssuerName], r[colCUSIP], r[colTicker], r[colMeetingDate], r[colVoteDescription], cusip)
		}
	}
	if !found {
		t.Fatalf("proposal %q not emitted", proposal)
	}
}

// 0001104659-11-049717, lines 148-371 verbatim.
func TestFamilyGHQHIdentityGrid(t *testing.T) {
	familyGAssertCUSIP(t, "hqh.txt", "Elect director Ron Cohen", "00484M106")
}

// 0001318148-06-001275, lines 2596-2643 verbatim.
func TestFamilyGBBHCombinedCUSIPISIN(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_g", "bbh.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	found := false
	for _, r := range rows {
		t.Logf("layout=%q issuer=%q cusip=%q isin=%q description=%q", r[len(r)-1], r[colIssuerName], r[colCUSIP], r[colISIN], r[colVoteDescription])
		found = true
		if r[colISIN] != "DE0007600801" || r[colIssuerName] != "ALTANA AG, BAD HOMBURG" {
			t.Errorf("Altana issuer=%q ISIN=%q; want ALTANA AG, BAD HOMBURG / DE0007600801", r[colIssuerName], r[colISIN])
		}
	}
	if !found {
		t.Fatal("Altana appropriation proposal not emitted")
	}
}

// 0001193125-05-175161, lines 33330-33462 verbatim.
func TestFamilyGAITIssuerCUSIP(t *testing.T) {
	familyGAssertCUSIP(t, "ait_issuer.txt", "ELECTION OF DIRECTORS", "21036P108")
}

// 0001398344-23-017262, lines 210-265 verbatim.
func TestFamilyGFirsthandCUSPID(t *testing.T) {
	familyGAssertCUSIP(t, "firsthand.txt", "Consultative vote on the 2022 Compensation Report", "000375204")
}

// 0001266454-04-000084, lines 137-210 verbatim.
func TestFamilyGHancockSecuritySymbol(t *testing.T) {
	familyGAssertCUSIP(t, "hancock.txt", "", "037933108")
}
