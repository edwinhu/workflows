package main

import (
	"path/filepath"
	"testing"
)

// familyFFF1Dispatch runs the real dispatch on a family FFF no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one is
// named.
func familyFFF1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_fff1", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_fff1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000075/754915/0000754915-04-000013.txt: 12-30, 46-51, 92-120. T. Rowe Price
// High Yield Fund, Inc. declares NO series in its SGML header, so every series
// name the resolver sees is backfilled from cik_series.tsv for CIK 0000754915,
// which holds exactly two:
//
//	0000754915	S000002132	T. Rowe Price High Yield Fund, Inc.
//	0000754915	S000057617	T. Rowe Price U.S. High Yield Fund
//
// Two ids, so the single-series stamp never fires. The filing prints one ISS
// banner, ruled with `=` to column 80, and it names the fund WITHOUT the
// registrant brand the dictionary spells out and without the corporate suffix:
//
//	=============================== HIGH YIELD FUND ================================
//
// against the registrant's own `COMPANY CONFORMED NAME: PRICE T ROWE HIGH YIELD
// FUND INC` and the body's `(Registrant) T. Rowe Price High Yield Fund, Inc.`.
// Under the banner, ordinary ISS proposal blocks:
//
//	ALAMOSA DELAWARE, INC 12.50%
//	Ticker:                      Security ID:  011588AB6
//	Meeting Date: SEP 30, 2003   Meeting Type: Bondholders
//	1     Accept the prepackaged plan and vote for  For       For        Management
//
// A full-file dispatch emits 215 rows and ALL 215 carry a blank series_id: the
// heading stem `HIGH YIELD FUND` is a proper SUFFIX of the declared name rather
// than a prefix-stripped or type-word-stripped form of it, and `U.S.` is the
// only token that separates the two declarations, so the surviving candidate is
// unique.
//
// Fix in issResolveFund (layout_issnpx.go), on the same axis as the
// `-issnpx-registrant-prefix-strip` rule but in the opposite direction: that
// rule strips the registrant prefix from the HEADING, and what this filing needs
// is the heading matched against a DECLARED name whose leading tokens are the
// registrant's own brand (`T. ROWE PRICE`) plus a trailing corporate suffix
// (`, INC.`) that the banner omits.
func TestFamilyFFF1TRowePriceHighYieldBannerNeverResolves(t *testing.T) {
	rows := familyFFF1Dispatch(t, "trowe_high_yield_heading.txt", "trowe_dict.tsv", "issnpx", 2)
	for _, r := range rows {
		if r.SeriesID != "S000002132" {
			t.Errorf("`HIGH YIELD FUND` banner not resolved: fund=%q issuer=%q item=%q series=%q want S000002132", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000121/1215880/0001162044-06-000404.txt: 12-20, 44-80, 134-149, 166-212,
// 1960-1973, 1989-2026, 2964, 2983-2988. BOTH sections are in the cut on
// purpose: with only the first one the whole filing is unresolved and the
// chassis stamps every row with the joined `S000005312;S000005313`, so the
// fixture passes while the real filing still leaks.
//
// Neiman Funds' 2006 N-PX declares its two series in the SGML header:
//
//	<SERIES-ID>S000005312
//	<SERIES-NAME>Neiman Large Cap Value Fund
//	<SERIES-ID>S000005313
//	<SERIES-NAME>Neiman Small Cap Value Fund
//
// and prints one HTML vote table per fund, each opened by a maroon banner row
// whose single filled cell carries an `Account Name:` label. The second one
// resolves:
//
//	<font color="#FFFFFF"><B>Account Name: Neiman Small Cap Value Fund</B></font></P>
//
// The first names the fund by the registrant brand alone:
//
//	<font color="#FFFFFF"><B>Account Name: Neiman Fund</B></font></P>
//
// `Neiman Fund` carries no token that separates `Neiman Large Cap Value Fund`
// from `Neiman Small Cap Value Fund`, so the heading resolves to nothing and is
// not even carried as a fund name: a full-file dispatch emits 297 rows of which
// 216 -- the whole of that first table, from `MAY DEPT. STORES COMPANY` on --
// come out with an empty fund_name AND an empty series_id, while the 81 rows of
// the second table carry S000005313.
//
// The filing prints `Large Cap` nowhere outside the header declaration, so the
// evidence for the attribution is the declaration set itself: two declared
// series, two printed sections, one of them named exactly. The section that
// names the OTHER declaration by name eliminates it, leaving S000005312 as the
// only series the unnamed section can be.
//
// Fix in parseHTMLTableRaw (layout_htmltable.go), in the labelled-heading path
// around the `htmlBareFundLine` / `icrResolveFundShared` call at the top of the
// row loop: a heading that names the registrant and nothing else must be
// resolved by elimination against the declared set when exactly one declaration
// is left unclaimed by the filing's other resolved sections.
func TestFamilyFFF1NeimanAccountNameBrandOnlyHeadingNeverResolves(t *testing.T) {
	rows := familyFFF1Dispatch(t, "neiman_account_name_heading.txt", "", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID == "S000005313" {
			continue
		}
		if r.SeriesID != "S000005312" {
			t.Errorf("`Account Name: Neiman Fund` heading not resolved: fund=%q issuer=%q item=%q series=%q want S000005312", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
