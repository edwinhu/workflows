package main

import (
	"os"
	"path/filepath"
	"testing"
)

// JNL Series Trust 2021 (0001438934-21-000421; 577 of 345,827 rows with no id
// on the current panel). Ninety-six identity blocks print `Security:
// 46655@109` -- a nine-character id whose sixth character Broadridge renders as
// `@` -- and the id rule takes the value to be no id at all rather than reading
// the nine characters it was given. The sibling block in the same fixture,
// `Security:  46628D411`, is read, so the loss is the `@` alone.
func TestBroadridgeSecurityIDAtSign(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "B13_security_id_at_sign.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "JNL GOVERNMENT MONEY MARKET FUND" {
			continue
		}
		seen++
		if r[colCUSIP] != "46655@109" {
			t.Fatalf("%s: cusip %q date %q (%.50s), want cusip \"46655@109\"",
				r[colIssuerName], r[colCUSIP], r[colMeetingDate], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no JNL GOVERNMENT MONEY MARKET FUND rows among %d", len(rows))
	}
}
