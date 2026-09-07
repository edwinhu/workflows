package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func familyHOlderRows(t *testing.T, fixture string) []VoteRow {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", fixture))
	if err != nil {
		t.Fatal(err)
	}
	res := parseText(b, FilingMeta{FilePath: fixture, FormType: "N-PX"})
	if res.Meta.ParseStatus != "ok" || len(res.Rows) == 0 {
		t.Fatalf("status=%q layout=%q rows=%d error=%q", res.Meta.ParseStatus, res.Meta.Layout, len(res.Rows), res.Meta.ErrorMsg)
	}
	t.Logf("layout=%q rows=%d", res.Meta.Layout, len(res.Rows))
	return res.Rows
}

func familyHOlderDate(t *testing.T, rows []VoteRow, description, want string) {
	t.Helper()
	for _, r := range rows {
		if strings.Contains(r.VoteDescription, description) {
			if r.MeetingDate != want {
				t.Errorf("description=%q issuer=%q cusip=%q meeting_date=%q; want %q", r.VoteDescription, r.IssuerName, r.CUSIP, r.MeetingDate, want)
			}
			return
		}
	}
	t.Fatalf("missing emitted proposal containing %q", description)
}

// Original 000082/826732/0001206774-04-001292.txt, contiguous lines 115-307.
// AMD's 29-Apr-04 header precedes a continuation page with no repeated identity.
func TestFamilyHOlderCalamosContinuationDate(t *testing.T) {
	rows := familyHOlderRows(t, "family_h_older_calamos.txt")
	familyHOlderDate(t, rows, "DIRECTOR", "20040511")
	familyHOlderDate(t, rows, "RATIFICATION OF APPOINTMENT OF", "20040429")
}

// Original 000088/885980/0001214659-06-001714.txt, contiguous lines 113-256.
// Issuer and Ticker/Security ID/Meeting Date labels share one physical line.
func TestFamilyHOlderYacktmanInlineIdentityDate(t *testing.T) {
	rows := familyHOlderRows(t, "family_h_older_yacktman.txt")
	familyHOlderDate(t, rows, "Elect Elizabeth Bailey", "20060427")
	familyHOlderDate(t, rows, "Elect James Forese", "20060426")
}

// Original 000100/1000351/0000950137-05-010547.txt, contiguous lines 2204-2369.
// El Paso and EMC both continue across a report masthead without new identity.
func TestFamilyHOlderLeutholdContinuationDate(t *testing.T) {
	rows := familyHOlderRows(t, "family_h_older_leuthold.txt")
	familyHOlderDate(t, rows, "JUAN CARLOS BRANIFF", "20050526")
	familyHOlderDate(t, rows, "APPROVAL OF EL PASO CORPORATION", "20050526")
	familyHOlderDate(t, rows, "MICHAEL J. CRONIN", "20050505")
	familyHOlderDate(t, rows, "W. PAUL FITZGERALD", "20050505")
}
