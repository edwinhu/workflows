package main

import (
	"os"
	"path/filepath"
	"testing"
)

func familyJIdentityRows(t *testing.T, fixture string) [][]string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "family_j", fixture))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("fixture emitted no vote rows")
	}
	return rows
}

// 0001104659-04-029479, lines 195-540 verbatim.
func TestFamilyJCombinedCUSIPNumberISINCode(t *testing.T) {
	rows := familyJIdentityRows(t, "japan04_combined_isin.txt")
	if len(rows) != 6 {
		t.Fatalf("rows=%d; want 6", len(rows))
	}
	r := rows[0]
	if r[colISIN] != "JP3544000007" {
		t.Errorf("layout=%q issuer=%q isin=%q description=%q; want ISIN JP3544000007", r[len(r)-1], r[colIssuerName], r[colISIN], r[colVoteDescription])
	}
}

// 0001104659-05-040881, lines 169-396 verbatim.
func TestFamilyJPreambleCUSIPNumberISINCode(t *testing.T) {
	rows := familyJIdentityRows(t, "japan05_preamble_isin.txt")
	if len(rows) != 6 {
		t.Fatalf("rows=%d; want 6", len(rows))
	}
	r := rows[0]
	if r[colISIN] != "JP3939000000" {
		t.Errorf("layout=%q issuer=%q isin=%q description=%q; want ISIN JP3939000000", r[len(r)-1], r[colIssuerName], r[colISIN], r[colVoteDescription])
	}
}

// 0001104659-04-026883, lines 168-378 verbatim.
func TestFamilyJExchangeTickerSymbolLabel(t *testing.T) {
	rows := familyJIdentityRows(t, "thai04_exchange_ticker.txt")
	if len(rows) != 3 {
		t.Fatalf("rows=%d; want 3", len(rows))
	}
	r := rows[0]
	if r[colTicker] != "ADVANC" {
		t.Errorf("layout=%q issuer=%q ticker=%q description=%q; want ticker ADVANC", r[len(r)-1], r[colIssuerName], r[colTicker], r[colVoteDescription])
	}
}

// 0000894189-04-001643, lines 1600-1715 verbatim.
func TestFamilyJSecurityLabelAfterIssuer(t *testing.T) {
	rows := familyJIdentityRows(t, "alpine04_security_grid.txt")
	if len(rows) != 1 {
		t.Fatalf("rows=%d; want 1", len(rows))
	}
	r := rows[0]
	if r[colCUSIP] != "07556Q105" {
		t.Errorf("layout=%q issuer=%q cusip=%q description=%q; want CUSIP 07556Q105", r[len(r)-1], r[colIssuerName], r[colCUSIP], r[colVoteDescription])
	}
}

// 0000894189-07-002268, lines 905-1014 verbatim.
func TestFamilyJSecurityProponentHeader(t *testing.T) {
	rows := familyJIdentityRows(t, "aht07_security_proponent.txt")
	found := 0
	for _, r := range rows {
		if r[colVoteDescription] != "Approve Merger Agreement" && r[colVoteDescription] != "Adjourn Meeting" {
			continue
		}
		found++
		if r[colCUSIP] != "00686U104" {
			t.Errorf("layout=%q issuer=%q cusip=%q description=%q; want CUSIP 00686U104", r[len(r)-1], r[colIssuerName], r[colCUSIP], r[colVoteDescription])
		}
	}
	if found != 2 {
		t.Fatalf("found %d ADESA proposals; want 2", found)
	}
}

// 0001438934-23-000258, lines 2427-2450 verbatim.
// Keep the existing leading-security policy, excluding the list delimiter.
func TestFamilyJBroadridgeCommaTerminatedCUSIP(t *testing.T) {
	rows := familyJIdentityRows(t, "hancock23_comma_cusip.txt")
	if len(rows) != 7 {
		t.Fatalf("rows=%d; want 7 director votes", len(rows))
	}
	for _, r := range rows {
		if r[colCUSIP] != "47803N489" {
			t.Errorf("layout=%q issuer=%q cusip=%q description=%q; want leading security 47803N489 without comma", r[len(r)-1], r[colIssuerName], r[colCUSIP], r[colVoteDescription])
		}
	}
}
