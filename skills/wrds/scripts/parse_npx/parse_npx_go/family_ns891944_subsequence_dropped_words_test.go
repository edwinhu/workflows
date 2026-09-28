package main

import (
	"path/filepath"
	"testing"
)

const ns891944SubseqDir = "family_ns891944_cornerstone_growth_series_ii_words_dropped"

// HENNESSY FUNDS TRUST, CIK 891944, filings 000089/891944/0000894189-11-003395.txt
// (period 20110630) and 000089/891944/0000894189-12-004512.txt (period 20120630),
// both `htmltable`. Each declares exactly three series in its own
// SERIES-AND-CLASSES-CONTRACTS-DATA block (2011 fixture lines 50, 65, 80; 2012
// fixture lines 50, 65, 80 -- the two headers are identical in this respect):
//
//	S000000837  HENNESSY CORNERSTONE GROWTH FUND, SERIES II
//	S000019531  Hennessy Cornerstone Large Growth Fund
//	S000025096  Hennessy Select Large Value Fund
//
// THE FILING'S SHAPE. Each fund section opens with a free-standing italic-bold
// banner line, then a security-identity block, then the vote rows. Both filings
// print exactly THREE distinct fund banners and nothing else that could open a
// section -- counted over the whole real accessions, not the fixtures:
//
//	0000894189-11-003395.txt: `Hennessy Select Large Value` x71,
//	                          `Hennessy Large Growth` x49,
//	                          `Hennessy Cornerstone Growth II` x48
//	0000894189-12-004512.txt: `Hennessy Select Large Value` x78,
//	                          `Hennessy Large Growth` x46,
//	                          `Hennessy Cornerstone Growth II` x7
//
// Every one of the three drops whole words from the declared name it means. Two of
// them already resolve on HEAD and are NOT this test's claim; they are asserted
// only as regression guards:
//
//	`Hennessy Large Growth`       -> S000019531 (drops the interior `Cornerstone`
//	                                 AND the trailing `Fund`)
//	`Hennessy Select Large Value` -> S000025096 (drops the trailing `Fund`)
//
// THE DEFECT. The third banner, `Hennessy Cornerstone Growth II` (2011 fixture
// lines 247, 388, 575; 2012 fixture lines 265, 371, 545, 757, 931, 1111, 1292),
// resolves against nothing and opens no section. It is S000000837's declared name
// `HENNESSY CORNERSTONE GROWTH FUND, SERIES II` with TWO tokens deleted -- the
// interior `Fund` and the interior `Series` -- leaving the roman numeral glued onto
// `Growth`. The existing htmlDroppedWordDeclaredName rung (layout_htmltable.go,
// added for family NS-1040674) is the nearest rung and cannot reach this: it
// requires the declared name to run exactly ONE word longer than the banner
// (`len(dw) != len(words)+1` -> continue) and deletes exactly one interior word.
// Here the declared name runs two words longer.
//
// MEASURED ON HEAD, over the two REAL accessions with the real corpus
// cik_series.tsv installed (27 rows for this CIK): status=ok layout=htmltable for
// both; 2011 gives 897 rows of which 202 carry series_id=""; 2012 gives 672 rows of
// which 23 carry series_id="". 202+23 = 225, this CIK's entire ranked no-series
// residue, and every one of those 225 rows sits under a `Hennessy Cornerstone
// Growth II` banner -- there is no second cause. On the trimmed fixtures below the
// same failure shows as 7 blank rows (2011) and 23 blank rows (2012).
//
// WHICH ID THE BANNER NAMES IS NOT A GUESS. Normalise both sides with
// normalizeSeriesName and split on spaces. The banner is
// [hennessy cornerstone growth ii]. Take it as an IN-ORDER SUBSEQUENCE test against
// this CIK's full 27-row corpus dictionary -- not just the filing's own header --
// and exactly one name admits it:
//
//	S000000837 [hennessy cornerstone growth fund series ii]   MATCHES (drop `fund`, `series`)
//	S000019531 [hennessy cornerstone large growth fund]       no `ii`
//	S000025096 [hennessy select large value fund]             no `cornerstone`
//	S000044800 [hennessy cornerstone growth fund]             no `ii`
//	...and the remaining 22 vintages, none of which carries `ii` at all.
//
// The registrant's own name, [hennessy funds trust], admits the banner as a
// subsequence of nothing and is admitted by no banner here, so the bare-registrant
// fallback is not in competition. The same subsequence test run over the two
// already-resolving banners likewise returns exactly one series each
// (`Hennessy Large Growth` -> S000019531 only, `Hennessy Select Large Value` ->
// S000025096 only), so a generalised subsequence rung with the single-candidate
// guard the existing dropped-word rung already carries would keep both of those on
// their present ids rather than disturbing them. Whether the fix is that
// generalisation or something narrower is the implementer's call; this test asserts
// the outcome, not the mechanism.
//
// FIXTURE PROVENANCE. Both fixtures are real SEC EDGAR bytes, verbatim and in file
// order. Verified this session line-for-line against /wrds/sec/archives copies of
// the two accessions; every fixture line is a contiguous run of the real file:
//
//	cornerstone_growth_ii_2011.txt (993 lines) = real lines 1-711 (SEC-HEADER in
//	full with all three series declarations unrenumbered, the <DOCUMENT> preamble,
//	the cover page, and the first `Hennessy Cornerstone Growth II` sections) +
//	real 8856-9130 (the `Hennessy Large Growth` banner at fixture line 751 and its
//	sections) + real 19507-19508 + the real filing's own closing, real 36198-36202.
//
//	cornerstone_growth_ii_2012.txt (1587 lines) = real lines 1-1579 (same through
//	the `Hennessy Select Large Value` banner at fixture line 1468 and its first
//	section) + real 5753-5755 + the real filing's own closing, real 25021-25025.
//
// No row was fabricated, edited or reworded.
//
// The dictionary installed below is this CIK's real cik_series.tsv content, all 27
// (id, name, vintage) rows, so the unambiguity claim above is made against the full
// candidate set and not merely against the filing header.
//
// No production code is changed here.
func TestFamilyNS891944SubsequenceDroppedWords(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0000891944": {
		{SeriesID: "S000000837", Name: "HENNESSY CORNERSTONE GROWTH FUND, SERIES II", DeclDate: "20060630"},
		{SeriesID: "S000019531", Name: "Hennessy Cornerstone Large Growth Fund", DeclDate: "20090630"},
		{SeriesID: "S000025096", Name: "Hennessy Select Large Value Fund", DeclDate: "20090630"},
		{SeriesID: "S000025096", Name: "Hennessy Large Value Fund", DeclDate: "20130630"},
		{SeriesID: "S000038529", Name: "Hennessy Focus Fund", DeclDate: "20130630"},
		{SeriesID: "S000038530", Name: "Hennessy Large Cap Financial Fund", DeclDate: "20130630"},
		{SeriesID: "S000038531", Name: "Hennessy Small Cap Financial Fund", DeclDate: "20130630"},
		{SeriesID: "S000038532", Name: "Hennessy Technology Fund", DeclDate: "20130630"},
		{SeriesID: "S000038533", Name: "Hennessy Gas Utility Index Fund", DeclDate: "20130630"},
		{SeriesID: "S000038533", Name: "Hennessy Gas Utility Fund", DeclDate: "20150630"},
		{SeriesID: "S000038534", Name: "Hennessy Equity and Income Fund", DeclDate: "20130630"},
		{SeriesID: "S000038535", Name: "Hennessy Core Bond Fund", DeclDate: "20130630"},
		{SeriesID: "S000044800", Name: "Hennessy Cornerstone Growth Fund", DeclDate: "20140630"},
		{SeriesID: "S000044801", Name: "Hennessy Cornerstone Mid Cap 30 Fund", DeclDate: "20140630"},
		{SeriesID: "S000044802", Name: "Hennessy Cornerstone Value Fund", DeclDate: "20140630"},
		{SeriesID: "S000044803", Name: "Hennessy Total Return Fund", DeclDate: "20140630"},
		{SeriesID: "S000044804", Name: "Hennessy Balanced Fund", DeclDate: "20140630"},
		{SeriesID: "S000044805", Name: "Hennessy Japan Fund", DeclDate: "20140630"},
		{SeriesID: "S000044806", Name: "Hennessy Japan Small Cap Fund", DeclDate: "20140630"},
		{SeriesID: "S000063244", Name: "Hennessy BP Energy Fund", DeclDate: "20190630"},
		{SeriesID: "S000063244", Name: "Hennessy BP Energy Transition Fund", DeclDate: "20210630"},
		{SeriesID: "S000063244", Name: "Hennessy Energy Transition Fund", DeclDate: "20220630"},
		{SeriesID: "S000063245", Name: "Hennessy BP Midstream Fund", DeclDate: "20190630"},
		{SeriesID: "S000063245", Name: "Hennessy Midstream Fund", DeclDate: "20220630"},
		{SeriesID: "S000079062", Name: "Hennessy Stance ESG ETF", DeclDate: "20230630"},
		{SeriesID: "S000079062", Name: "Hennessy Sustainable ETF", DeclDate: "20250630"},
	}}}
	seriesMap = nil

	const (
		cornerstoneII       = "S000000837"
		cornerstoneIIName   = "HENNESSY CORNERSTONE GROWTH FUND, SERIES II"
		cornerstoneIIBanner = "Hennessy Cornerstone Growth II"
		largeGrowth         = "S000019531"
		selectLargeValue    = "S000025096"
	)

	// want is the series each row's own banner names. The rows are asserted
	// positionally because the fixtures preserve real document order, and each
	// row's issuer/CUSIP/meeting-date triple is carried alongside so a
	// mis-sliced section shows up as an identity failure rather than a silent
	// re-indexing.
	type row struct {
		issuer, cusip, date, want string
	}

	cases := []struct {
		fixture string
		rows    []row
	}{
		{
			fixture: "cornerstone_growth_ii_2011.txt",
			rows: []row{
				// Under `Hennessy Cornerstone Growth II`, fixture line 247.
				{"Black Box Corp.", "091826107", "20100810", cornerstoneII},
				{"Black Box Corp.", "091826107", "20100810", cornerstoneII},
				// Under the same banner reprinted at fixture line 388.
				{"UAL Corporation", "902549807", "20100917", cornerstoneII},
				{"UAL Corporation", "902549807", "20100917", cornerstoneII},
				{"UAL Corporation", "902549807", "20100917", cornerstoneII},
				// Under the same banner reprinted at fixture line 575.
				{"Standex Interntl.", "854231107", "20101027", cornerstoneII},
				{"Standex Interntl.", "854231107", "20101027", cornerstoneII},
				// Regression guard: `Hennessy Large Growth`, fixture line 751.
				// These already resolve on HEAD and must stay put.
				{"Forest Labs.", "345838106", "20100809", largeGrowth},
				{"Forest Labs.", "345838106", "20100809", largeGrowth},
				{"Forest Labs.", "345838106", "20100809", largeGrowth},
				{"Forest Labs.", "345838106", "20100809", largeGrowth},
				{"Forest Labs.", "345838106", "20100809", largeGrowth},
			},
		},
		{
			fixture: "cornerstone_growth_ii_2012.txt",
			rows: []row{
				// Under `Hennessy Cornerstone Growth II`, fixture line 265.
				{"Consolidated Graphics", "209341106", "20110825", cornerstoneII},
				{"Consolidated Graphics", "209341106", "20110825", cornerstoneII},
				{"Consolidated Graphics", "209341106", "20110825", cornerstoneII},
				{"Consolidated Graphics", "209341106", "20110825", cornerstoneII},
				// ...reprinted at fixture line 371.
				{"AAR Corporations", "000361105", "20111012", cornerstoneII},
				{"AAR Corporations", "000361105", "20111012", cornerstoneII},
				{"AAR Corporations", "000361105", "20111012", cornerstoneII},
				{"AAR Corporations", "000361105", "20111012", cornerstoneII},
				{"AAR Corporations", "000361105", "20111012", cornerstoneII},
				// ...reprinted at fixture line 545.
				{"Education Management", "28140M103", "20111028", cornerstoneII},
				{"Education Management", "28140M103", "20111028", cornerstoneII},
				{"Education Management", "28140M103", "20111028", cornerstoneII},
				{"Education Management", "28140M103", "20111028", cornerstoneII},
				// ...reprinted at fixture line 757.
				{"Dycom Industries", "267475101", "20111122", cornerstoneII},
				{"Dycom Industries", "267475101", "20111122", cornerstoneII},
				{"Dycom Industries", "267475101", "20111122", cornerstoneII},
				{"Dycom Industries", "267475101", "20111122", cornerstoneII},
				// ...reprinted at fixture line 931.
				{"DFC Global Corp", "23324T107", "20111110", cornerstoneII},
				{"DFC Global Corp", "23324T107", "20111110", cornerstoneII},
				{"DFC Global Corp", "23324T107", "20111110", cornerstoneII},
				{"DFC Global Corp", "23324T107", "20111110", cornerstoneII},
				// ...reprinted at fixture lines 1111 and 1292.
				{"IDT Corporation", "448947507", "20111215", cornerstoneII},
				{"IDT Corporation", "448947507", "20111215", cornerstoneII},
				// Regression guard: `Hennessy Select Large Value`, fixture
				// line 1468. Already resolves on HEAD.
				{"McKesson Corp", "58155Q103", "20110727", selectLargeValue},
				{"McKesson Corp", "58155Q103", "20110727", selectLargeValue},
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.fixture, func(t *testing.T) {
			sink := &rowSink{}
			meta := processFile(tc.fixture, filepath.Join("testdata", ns891944SubseqDir, tc.fixture), sink, make([]byte, headBytes))
			rows := sink.buf
			if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0000891944" {
				t.Fatalf("fixture/dispatch precondition: status=%s layout=%s CIK=%s want status=ok layout=htmltable CIK=0000891944 error=%s", meta.ParseStatus, meta.Layout, meta.CIK, meta.ErrorMsg)
			}
			if len(rows) != len(tc.rows) {
				t.Fatalf("fixture precondition: %d rows, want %d", len(rows), len(tc.rows))
			}

			// Identity regression guard, checked FIRST: issuer, CUSIP and
			// meeting date all read correctly on HEAD. A fix that recovers
			// the series by disturbing any of these has traded one defect
			// for another.
			for i, want := range tc.rows {
				r := rows[i]
				if r.IssuerName != want.issuer || r.CUSIP != want.cusip || r.MeetingDate != want.date {
					t.Errorf("row %d identity regressed: issuer=%q cusip=%q date=%q want issuer=%q cusip=%q date=%q", i, r.IssuerName, r.CUSIP, r.MeetingDate, want.issuer, want.cusip, want.date)
				}
			}

			// The claim. Every row under a `Hennessy Cornerstone Growth II`
			// banner belongs to S000000837, whose declared name the banner
			// prints with the interior `Fund` and `Series` dropped. The two
			// sibling banners already resolve and are asserted here only so
			// that a fix reaching them does not move their rows.
			for i, want := range tc.rows {
				r := rows[i]
				if r.SeriesID == want.want {
					continue
				}
				if want.want != cornerstoneII {
					t.Errorf("row %d (%s cusip=%s date=%s) regressed: series=%q fund=%q want %s -- this row already resolves on HEAD under a banner this test does not claim; a fix for the Cornerstone II banner must leave it alone",
						i, r.IssuerName, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, want.want)
					continue
				}
				t.Errorf("row %d (%s cusip=%s date=%s): series=%q fund=%q want %s -- this row sits under the banner %q, which is this filing's own declared %q = %s with the interior tokens `Fund` and `Series` dropped; no other of this CIK's 27 dictionary names admits the banner's tokens as an in-order subsequence (S000019531 and S000044800 carry no `ii`, S000025096 no `cornerstone`), so exactly one declared series answers it",
					i, r.IssuerName, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, cornerstoneII, cornerstoneIIBanner, cornerstoneIIName, cornerstoneII)
			}

			// The recovered rows must carry the registrant's declared
			// spelling, not the banner's abbreviated print. Same convention
			// as family NS-1040674 (commit d05e85e8), where the dropped word
			// is restored rather than stored as printed.
			for i, want := range tc.rows {
				if want.want != cornerstoneII {
					continue
				}
				if rows[i].FundName != cornerstoneIIName {
					t.Errorf("row %d (%s): fund_name=%q want %q -- the dropped tokens must be restored to the declared spelling, not stored as printed and not left blank",
						i, rows[i].IssuerName, rows[i].FundName, cornerstoneIIName)
				}
			}
		})
	}
}
