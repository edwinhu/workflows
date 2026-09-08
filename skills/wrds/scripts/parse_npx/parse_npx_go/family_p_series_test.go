package main

import (
	"path/filepath"
	"testing"
)

// These cuts retain original filing bytes; the ranges below are one-based,
// inclusive and concatenated in source order. Dictionary declarations are real
// cik_series.tsv entries, supplied separately as on dictionary-backed grid runs.
// processFile exercises dispatch and chassis attribution without a binary build.
func familyPRows(t *testing.T, fixture, cik, layout string, decls []SeriesDecl) []VoteRow {
	t.Helper()
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{cik: decls}}
	seriesMap = nil
	sink := &rowSink{}
	path := filepath.Join("testdata", "family_p", fixture)
	meta := processFile(fixture, path, sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || meta.CIK != cik || len(sink.buf) == 0 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	t.Logf("real dispatch: CIK=%s layout=%s rows=%d", meta.CIK, meta.Layout, len(sink.buf))
	return sink.buf
}

// 000106/1066980/0000950133-05-003960.txt:
// 25-26; 60116-60135; 69013-69032 (42 lines).
// Both bare headings govern the following 3M block, not its Subadviser line.
func TestFamilyPISSBareFundBeforeSubadviser(t *testing.T) {
	rows := familyPRows(t, "P1066980_iss.txt", "0001066980", "issnpx", []SeriesDecl{
		{SeriesID: "S000008107", Name: "Vantagepoint 500 Stock Index Fund"},
		{SeriesID: "S000008127", Name: "Vantagepoint Asset Allocation Fund"},
	})
	if len(rows) != 14 {
		t.Fatalf("two seven-proposal 3M blocks: got %d rows, want 14", len(rows))
	}
	for block, want := range []struct{ name, id string }{
		{"Vantagepoint 500 Stock Index Fund", "S000008107"},
		{"Vantagepoint Asset Allocation Fund", "S000008127"},
	} {
		bad := 0
		for _, r := range rows[block*7 : (block+1)*7] {
			if r.IssuerName != "3M CO" {
				t.Fatalf("wrong issuer in real block: %q", r.IssuerName)
			}
			if r.SeriesID != want.id {
				bad++
			}
		}
		if bad != 0 {
			r := rows[block*7]
			t.Errorf("heading %q: %d/7 rows missing series %s; first item=%q fund=%q series=%q", want.name, bad, want.id, r.ItemSeq, r.FundName, r.SeriesID)
		}
	}
}

// 000092/927413/0000950116-06-000724.txt:
// 25-26; 5617-5631; 6796-6816 (38 lines).
// The terminal *FORMERLY marker has no former name following it.
func TestFamilyPISSTerminalFormerlyMarker(t *testing.T) {
	rows := familyPRows(t, "P927413.txt", "0000927413", "issnpx", []SeriesDecl{
		{SeriesID: "S000001306", Name: "ROXBURY MID-CAP FUND"},
		{SeriesID: "S000001307", Name: "ROXBURY SMALL CAP GROWTH FUND"},
	})
	counts, wrong := map[string]int{}, map[string]int{}
	for _, r := range rows {
		want := ""
		switch r.IssuerName {
		case "ACCREDITED HOME LENDERS HOLDING CO.":
			want = "S000001306"
		case "AFFILIATED MANAGERS GROUP, INC.":
			want = "S000001307"
		default:
			t.Fatalf("unexpected real issuer %q", r.IssuerName)
		}
		counts[want]++
		if r.SeriesID != want {
			wrong[want]++
		}
	}
	if counts["S000001306"] != 4 || counts["S000001307"] != 8 {
		t.Fatalf("real block counts = %v, want four Mid Cap and eight Small Cap proposals", counts)
	}
	if wrong["S000001306"] != 0 {
		t.Errorf("unadorned heading lost its existing series: %d/4 wrong", wrong["S000001306"])
	}
	if wrong["S000001307"] != 0 {
		t.Errorf("ROXBURY SMALL CAP GROWTH FUND  *FORMERLY: %d/8 rows missing series S000001307; first fund=%q series=%q", wrong["S000001307"], rows[4].FundName, rows[4].SeriesID)
	}
}

// 000092/923524/0000930413-04-004119.txt:
// 25-26; 118-145; 155-179 (55 lines).
// The authorized dictionary query returns exactly this one distinct series.
// Pin two real director votes, not the parser's additional director-header rows.
func TestFamilyPSingleDictionarySeriesAttribution(t *testing.T) {
	rows := familyPRows(t, "P923524.txt", "0000923524", "broadridge", []SeriesDecl{
		{SeriesID: "S000005098", Name: "Stock Index Account"},
	})
	seen := map[string]bool{}
	for _, r := range rows {
		if r.ItemSeq != "1" {
			continue
		}
		if r.IssuerName != "1-800 CONTACTS, INC." && r.IssuerName != "1-800-FLOWERS.COM, INC." {
			t.Fatalf("unexpected director-vote issuer %q", r.IssuerName)
		}
		seen[r.IssuerName] = true
		if r.SeriesID != "S000005098" {
			t.Errorf("%s director item %s: series=%q fund=%q; want sole dictionary series S000005098 (Stock Index Account)", r.IssuerName, r.ItemSeq, r.SeriesID, r.FundName)
		}
	}
	if len(seen) != 2 {
		t.Fatalf("want director votes from both real meetings, saw %v", seen)
	}
}

// 000108/1081400/0000914229-05-000086.txt:
// 25-26; 118-146; 209-227 (50 lines). The complete 395-entry CIK dictionary
// identifies the distinctive C&B Large Cap Value fund stem only as S000007271,
// under its later Allspring name. No ID is inferred for Diversified Equity.
func TestFamilyPISSHistoricalWellsFargoBrand(t *testing.T) {
	rows := familyPRows(t, "P1081400_05.txt", "0001081400", "issnpx", []SeriesDecl{
		{SeriesID: "S000007271", Name: "Allspring C&B Large Cap Value Fund"},
		{SeriesID: "S000007271", Name: "Allspring Large Cap Value Fund"},
		{SeriesID: "S000007255", Name: "Wells Fargo International Equity Fund"},
	})
	count, bad := 0, 0
	for _, r := range rows {
		if r.IssuerName != "FREDDIE MAC" {
			continue
		}
		count++
		if r.SeriesID != "S000007271" {
			bad++
		}
	}
	if count != 16 {
		t.Fatalf("got %d Freddie Mac proposals, want 16", count)
	}
	if bad != 0 {
		t.Errorf("WELLS FARGO ADVANTAGE C&B LARGE CAP VALUE FUND: %d/16 proposals missing S000007271 (Allspring C&B Large Cap Value Fund); first fund=%q series=%q", bad, rows[0].FundName, rows[0].SeriesID)
	}
}

// 000138/1385533/0001193125-12-332271.txt, 47 lines per fixture:
// 2010: 15-16; 140-142; 185; 196-203; 216-231; 237-244; 250-257; 570.
// 2020: 15-16; 73382-73384; 73427; 73438-73445; 73458-73473;
//
//	73479-73486; 73492-73499; 73812.
//
// Three proposals are necessary for htmlAdoptUnlabelledDesc's confirmation.
// The original header (lines 52-64) declares the unique 2010/2020 target-date
// series below. Its former registrant name is TDAX Funds, Inc. (line 47), while
// the dictionary's older TDX Independence names retain each target year.
// Keep the real TDAX body spelling; do not invent a matching dictionary alias.
func TestFamilyPHTMLInstitutionAccountInsteadOfReportPeriod(t *testing.T) {
	decls := []SeriesDecl{
		{SeriesID: "S000016521", Name: "db-X 2010 Target Date Fund"},
		{SeriesID: "S000016522", Name: "db-X 2020 Target Date Fund"},
		{SeriesID: "S000016523", Name: "db-X 2030 Target Date Fund"},
		{SeriesID: "S000016524", Name: "db-X 2040 Target Date Fund"},
		{SeriesID: "S000016525", Name: "db-X In-Target Date Fund"},
		{SeriesID: "S000016521", Name: "TDX Independence 2010 Exchange-Traded Fund"},
		{SeriesID: "S000016522", Name: "TDX Independence 2020 Exchange-Traded Fund"},
	}
	for _, c := range []struct{ file, name, id string }{
		{"P1385533_2010.txt", "TDAX Independence 2010 - Equity", "S000016521"},
		{"P1385533_2020.txt", "TDAX Independence 2020 - Equity", "S000016522"},
	} {
		t.Run(c.file, func(t *testing.T) {
			rows := familyPRows(t, c.file, "0001385533", "htmltable", decls)
			if len(rows) != 3 {
				t.Fatalf("got %d real proposals, want 3", len(rows))
			}
			bad := 0
			for _, r := range rows {
				if r.IssuerName != "Tesco plc" || r.CUSIP != "G87621101" {
					t.Fatalf("identity precondition: issuer=%q CUSIP=%q", r.IssuerName, r.CUSIP)
				}
				if r.FundName != c.name || r.SeriesID != c.id {
					bad++
				}
			}
			if bad != 0 {
				t.Errorf("Institution Account(s) %q: %d/3 proposals missing heading/series %s; first fund=%q series=%q", c.name, bad, c.id, rows[0].FundName, rows[0].SeriesID)
			}
		})
	}
}
