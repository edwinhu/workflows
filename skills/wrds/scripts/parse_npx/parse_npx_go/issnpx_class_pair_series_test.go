package main

import (
	"strings"
	"testing"
)

// Jackson National's JNL Series Trust registers a fund's classes as SEPARATE series
// -- `JNL/AIM LARGE CAP GROWTH FUND (A)` and `... (B)` -- while the body banner
// names the fund once, `JNL/AIM LARGE CAP GROWTH FUND` (0000933691-06-000078,
// 61,151 rows with no series on run71; the family holds about 200k). The
// parenthetical-stripped index collided on the two and stamped nothing. A banner
// that names every series of one fund, differing only by class, stamps them ALL,
// MultiValueSep-joined, exactly as a consolidated filing does; a collision with a
// genuinely different name inside the parentheses still stamps nothing.
func TestISSNPXClassPairSeriesStampsBoth(t *testing.T) {
	series := [][3]string{
		{"S000010001", "JNL/AIM LARGE CAP GROWTH FUND (A)", "C000027001"},
		{"S000010002", "JNL/AIM LARGE CAP GROWTH FUND (B)", "C000027002"},
		{"S000010003", "JNL/AIM REAL ESTATE FUND (A)", "C000027003"},
		{"S000010004", "JNL/AIM REAL ESTATE FUND (B)", "C000027004"},
	}
	doc := issnpxSeriesDoc(series,
		issnpxFundSection("JNL/AIM LARGE CAP GROWTH FUND", "APPLE INC.", "037833100")+
			issnpxFundSection("JNL/AIM REAL ESTATE FUND", "MICROSOFT CORP", "594918104"))
	rows := runISSNPXDoc(t, doc)
	if len(rows) != 2 {
		t.Fatalf("rows = %d, want 2", len(rows))
	}
	want := map[string]string{
		"JNL/AIM LARGE CAP GROWTH FUND": "S000010001" + MultiValueSep + "S000010002",
		"JNL/AIM REAL ESTATE FUND":      "S000010003" + MultiValueSep + "S000010004",
	}
	for _, r := range rows {
		fund := strings.ToUpper(strings.TrimSpace(r[colFundName]))
		if got := r[colSeriesID]; got != want[fund] {
			t.Errorf("%s: series_id %q, want %q", fund, got, want[fund])
		}
	}
}

func TestISSNPXParentheticalCollisionOfDifferentSleevesStaysBlank(t *testing.T) {
	series := [][3]string{
		{"S000020001", "Core Bond Portfolio (Core Plus)", "C000037001"},
		{"S000020002", "Core Bond Portfolio (Short Duration)", "C000037002"},
	}
	doc := issnpxSeriesDoc(series, issnpxFundSection("CORE BOND PORTFOLIO", "APPLE INC.", "037833100"))
	rows := runISSNPXDoc(t, doc)
	if len(rows) != 1 {
		t.Fatalf("rows = %d, want 1", len(rows))
	}
	if rows[0][colSeriesID] != "" {
		t.Errorf("series_id %q, want blank: the sleeves are different funds", rows[0][colSeriesID])
	}
}
