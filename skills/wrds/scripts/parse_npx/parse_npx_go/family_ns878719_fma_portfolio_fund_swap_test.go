package main

import (
	"path/filepath"
	"testing"
)

const ns878719FMADir = "family_ns878719_fma_portfolio_fund_swap"

// ns878719FMADispatch runs the fixture through the same top-level entry point
// production uses -- processFile, which sniffs the layout itself -- with the
// CIK's real cik_series.tsv rows loaded and no overlay, so nothing below depends
// on a hand-built FilingMeta or a hand-picked reader.
func ns878719FMADispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns878719FMADir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns878719FMADir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	return rows
}

func TestFamilyNS878719FMAPortfolioFundSwap(t *testing.T) {
	const (
		fixture  = "fma_small_company_fund_2009.txt"
		banner   = "FMA SMALL COMPANY FUND"
		wantID   = "S000006442"
		wantRows = 371
	)

	rows := ns878719FMADispatch(t, fixture, "dict.tsv", "pvtext", wantRows)

	bad := 0
	var first VoteRow
	for _, r := range rows {
		if r.SeriesID == wantID {
			continue
		}
		if bad == 0 {
			first = r
		}
		bad++
	}
	if bad > 0 {
		t.Errorf("%d of %d rows do not carry series_id %q; the first is issuer=%q cusip=%q meeting=%q item=%q series_id=%q fund=%q; banner %q",
			bad, len(rows), wantID, first.IssuerName, first.CUSIP, first.MeetingDate, first.ItemSeq, first.SeriesID, first.FundName, banner)
	}
}
