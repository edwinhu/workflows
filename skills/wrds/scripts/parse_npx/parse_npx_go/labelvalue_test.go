package main

import (
	"os"
	"path/filepath"
	"testing"
)

// LV1 is a verbatim contiguous excerpt of 0001193125-16-688441 (Lincoln Variable
// Insurance Products Trust): one fund banner and three complete issuer blocks.
// Every count below was read off those bytes.
//
// This grammar was 150 filings and 275 MB of the unread residue on 2026-08-31 --
// the largest identified block among the 2,410 filings that print vote-table
// column labels and were still recorded as `skip`.
func TestLabelValueReadsEveryBlock(t *testing.T) {
	rows := runISSNPXDoc(t, loadLVFixture(t, "LV1_lincoln_three_blocks.txt"))
	if len(rows) != 23 {
		t.Fatalf("got %d rows, want 23 (Alexandria 10, AvalonBay 11, BGP 2)", len(rows))
	}
	perIssuer := map[string]int{}
	for _, r := range rows {
		perIssuer[r[colIssuerName]]++
	}
	for issuer, want := range map[string]int{
		"ALEXANDRIA REAL ESTATE EQUITIES, INC.": 10,
		"AVALONBAY COMMUNITIES, INC.":           11,
		"BGP HOLDINGS PLC":                      2,
	} {
		if got := perIssuer[issuer]; got != want {
			t.Errorf("issuer %q: got %d rows, want %d\n  seen: %v", issuer, got, want, perIssuer)
		}
	}
}

// TestLabelValueSeparatesVoteFromSponsor is the assertion this layout most needs.
// The Sponsor column is separated from Vote Cast by a SINGLE space when the vote
// is wide:
//
//	2  Approve Auditors and Authorize Board  For  Did Not Vote Management
//
// so the gap-based cell split merges them. Without the peel, how_voted reads
// "Did Not Vote Management" -- a value the filing never printed in that cell.
func TestLabelValueSeparatesVoteFromSponsor(t *testing.T) {
	rows := runISSNPXDoc(t, loadLVFixture(t, "LV1_lincoln_three_blocks.txt"))
	var checked int
	for _, r := range rows {
		if r[colIssuerName] != "BGP HOLDINGS PLC" {
			continue
		}
		checked++
		if got := r[colHowVoted]; got != "Did Not Vote" {
			t.Errorf("item %q: how_voted = %q, want %q", r[colItemSeq], got, "Did Not Vote")
		}
		if got := r[colVoteSource]; got != "Management" {
			t.Errorf("item %q: proponent = %q, want %q", r[colItemSeq], got, "Management")
		}
		// A foreign issuer files with a Security ID and no symbol. The blank must
		// stay blank rather than absorbing the next labelled value.
		if got := r[colTicker]; got != "" {
			t.Errorf("item %q: ticker = %q, want empty -- this block prints none", r[colItemSeq], got)
		}
	}
	if checked != 2 {
		t.Fatalf("checked %d BGP rows, want 2", checked)
	}
}

// TestLabelValueReadsColumnsFromItsOwnHeader guards the confusion this grammar
// invites: it is the same WIDTH as the icr grammar and a different ORDER --
// proponent LAST here, FIRST there. Reading either by position files a sponsor
// as a vote on the other.
func TestLabelValueReadsColumnsFromItsOwnHeader(t *testing.T) {
	rows := runISSNPXDoc(t, loadLVFixture(t, "LV1_lincoln_three_blocks.txt"))
	want := map[string][4]string{
		// item -> description, mgmt rec, how voted, proponent
		"1.4": {"Elect Director Ronald L. Havner, Jr.", "For", "Withhold", "Management"},
		"3":   {"Advisory Vote to Ratify Named Executive Officers' Compensation", "For", "For", "Management"},
	}
	seen := map[string]bool{}
	for _, r := range rows {
		if r[colIssuerName] != "AVALONBAY COMMUNITIES, INC." {
			continue
		}
		w, ok := want[r[colItemSeq]]
		if !ok {
			continue
		}
		seen[r[colItemSeq]] = true
		got := [4]string{r[colVoteDescription], r[colMgmtRec], r[colHowVoted], r[colVoteSource]}
		if got != w {
			t.Errorf("item %q:\n  got  %q\n  want %q", r[colItemSeq], got, w)
		}
	}
	for k := range want {
		if !seen[k] {
			t.Errorf("no AvalonBay row with item %q", k)
		}
	}
}

func loadLVFixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "labelvalue", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(b)
}
