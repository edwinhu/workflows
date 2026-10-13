package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 0000898745-10-000429, lines 2256–2393. Meeting Country / Date and
// Primary / Security ID are split across rows; 27-May-09 is the record date.
func TestFamily_e_e4_MergedMeetingCountrySplitIdentity(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "family_e_e4_meeting_country.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	found := false
	for _, r := range rows {
		if r[19] != "Elect Director Michael L. Hackworth" {
			continue
		}
		found = true
		if r[31] != "htmltable" {
			t.Fatalf("layout = %q, want htmltable", r[31])
		}
		if r[15] != "20090724" || r[10] != "Cirrus Logic, Inc." || r[11] != "172755100" {
			t.Errorf("Hackworth: date=%q issuer=%q cusip=%q; want date=20090724 issuer=Cirrus Logic, Inc. cusip=172755100", r[15], r[10], r[11])
		}
	}
	if !found {
		t.Fatal("missing Michael L. Hackworth vote")
	}
}
