package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Summit Mutual Funds 2005 (0000743773-05-000030, 43,263 rows with no series
// on r204): the fund banner is an opening rule and the name,
// `======================= SUMMIT BALANCED INDEX PORTFOLIO`, with the closing
// rule wrapped onto the next line. A banner must end in '=' today, so the
// heading was lost and every row left without a fund.
func TestISSNPXOpenBannerRuleBelow(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "issnpx", "I_open_banner_rule_below.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "ADOBE SYSTEMS INC." {
			continue
		}
		seen++
		if r[colFundName] != "SUMMIT BALANCED INDEX PORTFOLIO" || r[colMeetingDate] != "20050428" {
			t.Fatalf("Adobe: fund %q date %q (%s)", r[colFundName], r[colMeetingDate], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no Adobe rows among %d", len(rows))
	}
}
