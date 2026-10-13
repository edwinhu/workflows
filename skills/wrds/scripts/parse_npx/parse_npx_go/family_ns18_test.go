package main

import (
	"path/filepath"
	"testing"
)

// familyNS18Dispatch runs the real dispatch on a family NS18 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS18Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns18", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns18", fixture), sink, make([]byte, headBytes))
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

// 000076/766351/0001206774-04-001285.txt: verbatim source lines 11-19, 21-27,
// 52-58 (the SEC header the dispatch reads), 117-134 (the first `<PAGE>`, the
// `<TABLE>`/`<S>` opener, the `ASF-Index 400` banner and the AGL RESOURCES
// block beneath it), 7080-7094 (the second `<PAGE>`, the `ASF-Index 500`
// banner and the ADC TELECOMMUNICATIONS block beneath it) and the filing's own
// last four lines. Every byte is verbatim. Dispatches to `agenda` (the
// precondition asserts it).
//
// Advantus Series Fund Inc, 2004, period 20040630. All 5,542 rows of this
// filing carry no series, and all 5,542 are attributed to ONE fund name.
// Measured on the current tree with the full 41,139-row dictionary:
//
//	=== 000076/766351/0001206774-04-001285.txt layout=agenda status=ok rows=5542 blank=5542
//	    5542 blank "ASF-Index 400"
//
// The filing prints THREE section banners in the same grammar -- a `<PAGE>`,
// a blank line, the bare name. Source lines 121, 7082 and 17308, verbatim:
//
//	ASF-Index 400
//	ASF-Index 500
//	F-Real Estate
//
// The `agenda` layout reads only the FIRST of them and carries it filing-wide.
// Measured: handed a dictionary that names the two printed banners exactly --
// `ASF-Index 400` -> S000024506 and `ASF-Index 500` -> S000024507, the pairing
// `series_map_applied.tsv` itself records for this registrant's later filings,
// which print the identical strings (e.g. `000076/766351/0001438934-12-000276.txt
// ASF-Index 400 S000024506` and `... ASF-Index 500 S000024507` on the same
// filing) -- the whole document still comes back under the first banner:
//
//	5542 S000024506 "ASF-Index 400"
//	ADC row: fund="ASF-Index 400" series="S000024506"
//	first ADC row index=1982 of 5542
//
// So this is not a naming miss. The ADC TELECOMMUNICATIONS vote (source line
// 7085, the only occurrence in the filing) is printed under `ASF-Index 500`,
// and the tree stamps it with the series of a fund its bytes do not name. That
// is a wrong series, not a blank one, and it also means the second and third
// sections of this filing -- 3,560 of its 5,542 rows, everything from row index
// 1982 on -- are unreachable by any future naming fix.
//
// Separately -- and not what this test asserts -- none of the three printed
// names matches any declaration at this CIK under any vintage (the registrant's
// 48 dictionary rows are `Index 400 Mid-Cap Portfolio`, `Advantus Index 500
// Fund`, `SFT Real Estate Securities Fund` and the like, all vintage 20060630
// or later, i.e. after this filing's 20040630 period). The naming gap is a
// FLOOR; the section-attribution defect below is not.
func TestFamilyNS18AdvantusSecondBannerOpensSection(t *testing.T) {
	rows := familyNS18Dispatch(t, "advantus_two_banners.txt", "advantus_dict.tsv", "agenda", 9)
	for _, r := range rows {
		if r.CUSIP != "000886101" {
			continue
		}
		if r.SeriesID != "S000024507" {
			t.Errorf("the second `<PAGE>` banner did not open a section: the ADC TELECOMMUNICATIONS vote is printed under `ASF-Index 500` but carries the first banner's fund: fund=%q issuer=%q cusip=%q item=%q desc=%q series=%q want S000024507",
				r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
