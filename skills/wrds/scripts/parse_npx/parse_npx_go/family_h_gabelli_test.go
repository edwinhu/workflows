package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFamilyHGabelliContinuationDate(t *testing.T) {
	for _, tc := range []struct {
		fixture, before, after, date string
	}{
		// 0000950123-11-080786, lines 941-1048.
		{"gabelli_continuation.txt", "RAYMOND V. GILMARTIN", "DOROTHY A. TERRELL", "20100927"},
		// 0000950123-11-080847, lines 577-617.
		{"gabelli_asset_continuation.txt", "JOHN T. CAHILL", "AMENDMENT TO THE LEGG MASON", "20100727"},
		// 0000950123-11-080784, lines 441-512.
		{"gabelli_multimedia_continuation.txt", "ALAN M. BENNETT", "BRUCE C. ROHDE", "20100930"},
		// 0000950123-11-080849, lines 211-275.
		{"gabelli_utilities_continuation.txt", "JOHN BOND", "NICK LAND", "20100727"},
	} {
		t.Run(tc.fixture, func(t *testing.T) {
			b, err := os.ReadFile(filepath.Join("testdata", "family_h", tc.fixture))
			if err != nil {
				t.Fatal(err)
			}
			rows := runISSNPXDoc(t, string(b))
			for _, target := range []string{tc.before, tc.after} {
				found := false
				for _, r := range rows {
					if !strings.Contains(r[19], target) {
						continue
					}
					found = true
					if r[15] != tc.date {
						t.Errorf("layout=%q issuer=%q cusip=%q description=%q meeting_date=%q; want %s", r[31], r[10], r[11], r[19], r[15], tc.date)
					}
				}
				if !found {
					t.Errorf("vote containing %q not emitted", target)
				}
			}
		})
	}
}
