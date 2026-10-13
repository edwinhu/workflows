package main

import (
	"os"
	"path/filepath"
	"testing"
)

// family LOCATIONNAME-SECID -- CIK 1388485 (FundVantage Trust) filing
// 0000950123-11-081621.txt, agent 0000950123. Each voted security opens with a
// bold fund-name DIV ("Corverus Strategic Equity Fund"), the issuer company
// name on the DIV below it ("MASTERCARD INCORPORATED"), and a two-column
// key/value table carrying `Location Name:`, `Primary Security ID: 57636Q104`,
// `CUSIP: 57636Q104`, `Meeting Date: 21-Sep-10` and `Record Date:`. The parser
// never reads that key/value block: it falls through to a path that takes the
// vote grid's last column -- headed `Proponent`, valued `Management` (or
// `Shareholder`) on every row -- as the issuer name, and drops the printed
// security id and meeting date. 4,466 rows of this one filing (4,414 no_secid,
// 45 no_date) carry the fake issuer on HEAD.
func TestFamilyLocationNameKeyValueBlockSecurityIDAndMeetingDate(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_locationname", "locationname_secid_block.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	seen := 0
	for _, r := range rows {
		switch r[colIssuerName] {
		case "Management", "Shareholder", "Primary Security ID", "Primary Security":
			t.Errorf("issuer %q is the Proponent column value, not the company (%s)",
				r[colIssuerName], r[colVoteDescription])
			continue
		}
		if r[colIssuerName] != "MASTERCARD INCORPORATED" {
			t.Errorf("issuer %q, want MASTERCARD INCORPORATED (%s)",
				r[colIssuerName], r[colVoteDescription])
			continue
		}
		seen++
		if r[colCUSIP] != "57636Q104" {
			t.Errorf("security id %q, want 57636Q104 -- printed on the face as"+
				" `Primary Security ID:` and `CUSIP:` (%s)", r[colCUSIP], r[colVoteDescription])
		}
		if r[colMeetingDate] != "20100921" {
			t.Errorf("meeting date %q, want 20100921 -- printed as `Meeting Date: 21-Sep-10` (%s)",
				r[colMeetingDate], r[colVoteDescription])
		}
	}
	if seen < 2 {
		t.Fatalf("%d MASTERCARD INCORPORATED rows among %d", seen, len(rows))
	}
}
