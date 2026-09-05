package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Diamond Hill Funds 2011 (0000950123-11-078900, 3,820 rows with no date and
// `Yes` as the vote on r132): the header wraps over rows whose upper pieces are
// bare vote words -- `Meeting | Proposed | Matter | Vote | Against` over `Issuer
// | Ticker | CUSIP | Date | Description of Vote | by | Voted | Cast | Mgmt`. A
// row of vote values is refused as a header fragment, so the lower row alone
// became the header: `Date` named no date and `Voted` (the flag) took the vote.
// An upper piece whose vote-shaped cells all sit over labels of the row beneath
// is a fragment of that header, not a data row.
func TestHTMLTableHeaderFragmentOfVoteWordsOverLabels(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H42_fragment_over_labels.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "STERIS CORPORATION" {
			continue
		}
		seen++
		if r[colMeetingDate] != "20100729" || r[colHowVoted] != "For" || r[colCUSIP] != "859152100" {
			t.Fatalf("Steris: date %q vote %q cusip %q, want 20100729 / For / 859152100 (%s)", r[colMeetingDate], r[colHowVoted], r[colCUSIP], r[colVoteDescription])
		}
	}
	if seen == 0 {
		t.Fatalf("no Steris rows among %d", len(rows))
	}
}
