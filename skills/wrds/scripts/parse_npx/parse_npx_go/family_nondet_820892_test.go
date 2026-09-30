package main

// First American's CA Intermediate banner must deterministically identify
// S000005565 (California), never S000005547 (the separate Intermediate fund).

import (
	"path/filepath"
	"testing"
)

func familyNondet820892Dispatch(t *testing.T) (FilingMeta, []VoteRow) {
	t.Helper()
	const fixture = "firstamerican2006_ca_intermediate_tx_free.txt"
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_nondet_820892", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || len(rows) != 10 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s, want ok/issnpx/10", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}
	if meta.CIK != "0000820892" || meta.PeriodOfReport != "20060630" || len(meta.SeriesDecls) != 38 {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s decls=%d, want 0000820892/20060630/38", meta.CIK, meta.PeriodOfReport, len(meta.SeriesDecls))
	}
	return meta, rows
}

func TestFamilyNondet820892(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_nondet_820892", "cikdict_firstamerican.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	const ca = "FIRST AMERICAN CA INTERMEDIATE TX FREE"
	counts := map[string]int{}
	var baseline []VoteRow
	var coBaseline string
	for run := 0; run < 40; run++ {
		meta, rows := familyNondet820892Dispatch(t)
		counts[rows[0].SeriesID]++
		if run == 0 {
			baseline = rows
		}
		wrong, forbidden, changed := 0, 0, 0
		for i, r := range rows {
			if r.FundName != ca {
				t.Fatalf("run %d: unexpected banner %q, want %q", run+1, r.FundName, ca)
			}
			if r.SeriesID != rows[0].SeriesID {
				t.Errorf("run %d: CA row %d has id %q, first row has %q", run+1, i, r.SeriesID, rows[0].SeriesID)
			}
			if r.SeriesID != baseline[i].SeriesID {
				changed++
			}
			if r.SeriesID == "S000005547" {
				forbidden++
			}
			if r.SeriesID != "S000005565" {
				wrong++
			}
		}
		if changed != 0 {
			t.Errorf("run %d: nondeterminism: %d CA rows changed from run 1 id %q to %q", run+1, changed, baseline[0].SeriesID, rows[0].SeriesID)
		}
		if wrong != 0 {
			t.Errorf("run %d: %d CA rows have id %q, want S000005565 (California); %d wrongly claim S000005547 (plain Intermediate)", run+1, wrong, rows[0].SeriesID, forbidden)
		}

		// These three original sections print no votes. Check their actual
		// banner resolver instead of manufacturing rows for a dispatch assertion.
		ix := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))
		issFormerKeys(ix, meta.FormerNames)
		for _, guard := range []struct{ banner, want string }{
			{"FIRST AMERICAN INTERMEDIATE TX FREE FUND", "S000005547"},
			{"FIRST AMERICAN CO INTERMEDIATE TX FREE", ""},
			{"FIRST AMERICAN OR INTERMEDIATE TX FREE", "S000005562"},
		} {
			_, d := issResolveFund(ix, guard.banner)
			id := ""
			if d != nil {
				id = d.SeriesID
			}
			if guard.banner == "FIRST AMERICAN CO INTERMEDIATE TX FREE" {
				if run == 0 {
					coBaseline = id
				}
				guard.want = coBaseline
			}
			if id != guard.want {
				t.Errorf("run %d: empty banner %q -> %q, want stable HEAD id %q", run+1, guard.banner, id, guard.want)
			}
		}
	}
	t.Logf("CA ids across 40 runs (10 rows per run): blank=%d S000005547=%d S000005565=%d; all ids=%v", counts[""], counts["S000005547"], counts["S000005565"], counts)
}
