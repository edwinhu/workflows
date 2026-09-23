package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// family PRIMSEC -- CIK 898745 (Principal Funds Inc) filing
// 0000898745-10-000426.txt: the issuer heading and the column header share ONE
// physical row. `| Reliance Infrastructure | Meeting Country | Primary Security
// | Meeting | Record | Shares | | Shares on |` prints the company name in the
// first cell and the grid's column labels in the cells beside it, with the
// stacked second words (`Date | ID | Type | Date | Voted | Loan *`) on the row
// below and the data (`21-Jul-09 India | Y09789150 | Annual | 06-Jul-09 |
// 167,475`) on the row after that. The parser reads the column LABEL as the
// company heading: every vote row of the section is stamped with the issuer
// name literally `Primary Security`, and the meeting date and the security id
// that are present in the bytes are discarded. 6,429 of the filing's 12,280
// rows carry that issuer name on HEAD.
func TestFamilyPrimarySecurityColumnHeaderMistakenForIssuerHeading(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_primsec", "primary_security_column_header_as_issuer.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] == "Primary Security" {
			t.Errorf("issuer %q is the column header, not the company (%s)", r[colIssuerName], r[colVoteDescription])
			continue
		}
		if !strings.HasPrefix(r[colIssuerName], "Reliance Infrastructure") {
			t.Errorf("issuer %q, want the Reliance Infrastructure heading (%s)", r[colIssuerName], r[colVoteDescription])
			continue
		}
		seen++
		if r[colMeetingDate] != "20090721" {
			t.Errorf("meeting date %q, want 20090721 (%s)", r[colMeetingDate], r[colVoteDescription])
		}
		if r[colCUSIP] != "Y09789150" {
			t.Errorf("security id %q, want Y09789150 (%s)", r[colCUSIP], r[colVoteDescription])
		}
	}
	if seen < 6 {
		t.Fatalf("%d Reliance Infrastructure rows among %d", seen, len(rows))
	}
}
