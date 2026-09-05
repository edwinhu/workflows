package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Trust for Professional Managers' filer 2013 (0001193125-13-348301; 1,795 of
// 1,925 rows with no issuer, id or date on r159): the identity header runs
// its words together -- `Issuer Name | Ticker | MeetingDate | Country |
// SecurityID | MeetingType | RecordDate | SharesVoted | SharesAvailable |
// ISIN | SEDOL` -- and the reader knew none of the joined forms. The `ISIN |
// SEDOL` pair also fed the word SEDOL into the ISIN column.
func TestHTMLTableRunTogetherLabels(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H58_run_together_labels.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "Estacio Participacoes SA" {
			continue
		}
		seen++
		if r[colMeetingDate] == "" || r[colCUSIP] == "" || r[colISIN] == "SEDOL" {
			t.Fatalf("Estacio: date %q cusip %q isin %q (%s)", r[colMeetingDate], r[colCUSIP], r[colISIN], r[colVoteDescription])
		}
	}
	if seen < 2 {
		t.Fatalf("%d Estacio rows among %d", seen, len(rows))
	}
}
