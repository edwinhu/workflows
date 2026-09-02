package main

import (
	"os"
	"path/filepath"
	"testing"
)

// TestISSNPXConsentNAYes pins a consent solicitation, where the report
// prints no management recommendation and a Yes/No consent as the vote:
//
//	Meeting Date: MAR 04, 2011   Meeting Type: Consent
//	#     Proposal                                Mgt Rec   Vote Cast    Sponsor
//	1     Consent to the Indenture Amendments.    N/A       Yes          Management
//
// 419 rows in four filings of two registrants, 2026-09-02. `No` is already
// a value; `Yes` and `N/A` were not, so the whole line stayed proposal text.
func TestISSNPXConsentNAYes(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "EK_consent_na_yes.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(rows))
	}
	if v := rows[0][colHowVoted]; v != "Yes" {
		t.Errorf("how_voted = %q, want Yes", v)
	}
	if v := rows[0][colMgmtRec]; v != "N/A" {
		t.Errorf("management_recommendation = %q, want N/A", v)
	}
	if v := rows[0][colVoteDescription]; v != "Consent to the Indenture Amendments." {
		t.Errorf("description = %q", v)
	}
}
