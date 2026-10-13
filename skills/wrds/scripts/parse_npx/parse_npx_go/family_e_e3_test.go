package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 0000816153-04-000070, lines 178–214: the H3 heading prints the identity and date.
func TestFamily_e_e3_Thornburg(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_e_e3", "thornburg.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colMeetingDate] != "20031030" || r[colCUSIP] != "008190100" {
			t.Fatalf("layout=%s issuer=%q cusip=%q date=%q; want Affiliated Computer Services, Inc. / 008190100 / 20031030", r[31], r[colIssuerName], r[colCUSIP], r[colMeetingDate])
		}
	}
}

// 0001104659-05-040914, lines 10068–10266: Shareholder Meeting is not Record Date.
func TestFamily_e_e3_ShareholderMeeting(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_e_e3", "rmr.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colMeetingDate] != "20050506" || r[colCUSIP] != "42725M107" {
			t.Fatalf("layout=%s issuer=%q cusip=%q date=%q; want Heritage Property Investment Trust, Inc. / 42725M107 / 20050506", r[31], r[colIssuerName], r[colCUSIP], r[colMeetingDate])
		}
	}
}

// American Fidelity: an unvoted election parent must not replace the meeting
// identity. The ordinary voted rows are dated controls from the same filings.
func TestFamily_e_e3_UnvotedElectionParent(t *testing.T) {
	for _, tc := range []struct {
		name, file, date, cusip string
	}{
		{"dated_2006", "first06.txt", "20060328", "00724F101"},       // 0000909334-06-000332: 149–253
		{"dated_2008", "first08.txt", "20070710", "82028K200"},       // 0000909334-08-000281: 176–280
		{"undated_2006", "directors06.txt", "20050801", "205363104"}, // 0000909334-06-000332: 7892–8007
		{"undated_2008", "directors08.txt", "20080129", "22160K105"}, // 0000909334-08-000281: 3526–3641
	} {
		t.Run(tc.name, func(t *testing.T) {
			b, err := os.ReadFile(filepath.Join("testdata", "family_e_e3", tc.file))
			if err != nil {
				t.Fatal(err)
			}
			rows := runISSNPXDoc(t, string(b))
			if len(rows) == 0 {
				t.Fatal("no rows")
			}
			for _, r := range rows {
				if r[colMeetingDate] != tc.date || r[colCUSIP] != tc.cusip {
					t.Fatalf("layout=%s issuer=%q cusip=%q date=%q description=%q; want %s / %s", r[31], r[colIssuerName], r[colCUSIP], r[colMeetingDate], r[colVoteDescription], tc.cusip, tc.date)
				}
			}
		})
	}
}
