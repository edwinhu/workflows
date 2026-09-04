package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Praxis Mutual Funds 2023 (0001398344-23-013878, 10,786 of 11,550 rows with no
// date on run71): the identity is printed on ONE line, `Ticker: ABT Security ID:
// 002824100 Meeting Date: APR 28, 2023 Meeting Type: Annual Record Date: MAR 01,
// 2023`. The ticker line opened the meeting and moved on, so the date and the
// record date sitting after the security id on the same line were never read.
func TestISSNPXOneLineIdentity(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "I_one_line_identity_praxis.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) < 10 {
		t.Fatalf("rows = %d, want at least 10", len(rows))
	}
	want := map[string][3]string{
		"ABBOTT LABORATORIES": {"002824100", "20230428", "20230301"},
		"ABBVIE INC.":         {"00287Y109", "20230505", "20230306"},
	}
	seen := map[string]int{}
	for _, r := range rows {
		w, known := want[r[colIssuerName]]
		if !known {
			t.Errorf("unexpected issuer %q", r[colIssuerName])
			continue
		}
		seen[r[colIssuerName]]++
		if r[colCUSIP] != w[0] || r[colMeetingDate] != w[1] || r[colRecordDate] != w[2] {
			t.Errorf("%s: cusip %q meeting %q record %q, want %v", r[colIssuerName], r[colCUSIP], r[colMeetingDate], r[colRecordDate], w)
		}
	}
	if seen["ABBOTT LABORATORIES"] < 10 || seen["ABBVIE INC."] < 3 {
		t.Errorf("rows per issuer %v", seen)
	}
}
