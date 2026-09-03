package main

import (
	"os"
	"path/filepath"
	"testing"
)

// A series map is an external (filing, heading) -> series_id table for headings
// the rules could not resolve. It fills only a blank series_id, only for the
// exact heading the parser printed, and only with a series the filing's own
// header declares -- a stale or foreign id must never move votes between funds.
func TestSeriesOverlayFillsOnlyDeclaredBlankSeries(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "map.tsv")
	body := "filing\theading\tseries_id\tconfidence\trows\n" +
		"000000/1/0001-01.txt\tALPHA GROWTH FUND\tS000000001\t1.0\t10\n" +
		"000000/1/0001-01.txt\tBETA VALUE FUND\tS000000099\t0.95\t5\n"
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	ov, err := loadSeriesOverlay(p)
	if err != nil {
		t.Fatal(err)
	}
	declared := map[string]bool{"S000000001": true, "S000000002": true}

	r := VoteRow{FundName: "ALPHA GROWTH FUND"}
	ov.apply("000000/1/0001-01.txt", declared, &r)
	if r.SeriesID != "S000000001" {
		t.Fatalf("blank series with a mapped, declared heading: got %q want S000000001", r.SeriesID)
	}

	r = VoteRow{FundName: "ALPHA GROWTH FUND", SeriesID: "S000000002"}
	ov.apply("000000/1/0001-01.txt", declared, &r)
	if r.SeriesID != "S000000002" {
		t.Fatalf("a series the rules already set must stand: got %q", r.SeriesID)
	}

	r = VoteRow{FundName: "BETA VALUE FUND"}
	ov.apply("000000/1/0001-01.txt", declared, &r)
	if r.SeriesID != "" {
		t.Fatalf("a mapped id the header does not declare must not be stamped: got %q", r.SeriesID)
	}

	r = VoteRow{FundName: "ALPHA GROWTH FUND"}
	ov.apply("000000/2/0002-01.txt", declared, &r)
	if r.SeriesID != "" {
		t.Fatalf("the map is keyed by filing; another filing's heading must not match: got %q", r.SeriesID)
	}

	var none *seriesOverlay
	r = VoteRow{FundName: "ALPHA GROWTH FUND"}
	none.apply("000000/1/0001-01.txt", declared, &r)
	if r.SeriesID != "" {
		t.Fatalf("no map loaded must be a no-op: got %q", r.SeriesID)
	}
}
