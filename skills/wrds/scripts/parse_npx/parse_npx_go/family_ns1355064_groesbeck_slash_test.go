package main

import (
	"os"
	"path/filepath"
	"testing"
)

// ns1355064Dispatch runs the real dispatch on a family NS1355064 fixture with
// the named dictionary rows loaded, and asserts the fixture's own preconditions
// -- status, layout and row count -- so a failure below is an assertion about
// the masthead fund name and its series id, never a broken fixture. Same
// mechanism as ns912036Dispatch in family_ns912036_amg_aston_prefix_test.go,
// pointed at its own testdata dir.
func ns1355064Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns1355064_groesbeck", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns1355064_groesbeck", fixture), sink, make([]byte, headBytes))
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

// CIK 0001355064 (Mutual Fund Series Trust) files 000135/1355064/0001580642-17-004483.txt
// (period 20170630, 23,418 lines) as NINE htmltable vote-table sections, each
// opened by its own `<TABLE>` carrying a `Registrant: Mutual Fund Series Trust`
// cell, a fund-name cell and an `Exhibit 1` cell. Measured with the tracked
// binary over the real bytes with -cik-series and -series-map both pointed at
// the real /scratch/nyu/eddyhu/npx-reconcile-corpus dictionaries, the filing
// yields 1,830 rows of which 1,289 carry a BLANK series_id -- the LOST_BASE
// count for this filing exactly. Sliced one section per file at its own
// `<TABLE>` boundaries (the nine slices re-parse to 146+308+314+258+263+129+0+114+298
// = 1,830 rows, so the slicing loses nothing), the blanks attribute as:
//
//	source line  masthead fund name                             rows  series_id
//	        418  Catalyst Buyback Strategy Fund                  146  BLANK
//	       2244  Catalyst Dynamic Alpha Fund                     308  BLANK
//	       6674  Catalyst Groesbeck Growth of Income Fund        314  BLANK
//	       9915  Catalyst Insider Buying Fund                    258  BLANK
//	      13085  Catalyst IPOx Allocation Fund                   263  BLANK
//	      16308  Catalyst Small Cap Insider Buying Fund          129  S000012457
//	      17919  Catalyst Groesbeck Aggressive Growth Fund         0  (nil report)
//	      18071  Catalyst/Lyons Tactical Allocation Fund         114  S000012457 (leaked)
//	      19510  Catalyst/MAP Global Equity Fund                 298  S000012457 (leaked)
//
// so the 1,289 blanks are sections 1-5, of which the Groesbeck Growth of Income
// section is 314 -- 24.4%, a PART and not the whole. Two further measured facts
// this fixture does NOT cover, recorded so nobody re-derives them: the Groesbeck
// Aggressive Growth section at line 17919 is a nil report (`No proxies were
// received or voted during the reporting period ended June 30, 2017`), so it
// contributes ZERO rows and can carry no series id on any vote row; and the 412
// rows of the last two sections are not blank but MISLABELLED S000012457,
// because the Small Cap banner captured at line 16308 survives both later
// section boundaries.
//
// The slash is NOT the barrier. This CIK's own dictionary (cik_series.tsv)
// carries the two Groesbeck sleeves ONLY with a slash --
//
//	S000027215  Catalyst/Groesbeck Growth of Income Fund     20140630
//	S000027215  CATALYST/GROESBECK GROWTH OF INCOME FUND     20100630
//	S000045924  Catalyst/Groesbeck Aggressive Growth Fund    20140630
//
// -- and this filing's own SEC-HEADER declares them the same way
// (`<SERIES-NAME>Catalyst/Groesbeck Growth of Income Fund` at source line 74,
// `<SERIES-NAME>Catalyst/Groesbeck Aggressive Growth Fund` at 218), while both
// mastheads print the name with a SPACE. But this package's own
// normalizeSeriesName (header.go) folds `/` to a space, so the slashed and
// unslashed spellings collapse to the SAME key -- measured off this fixture's
// own header index, not asserted:
//
//	"Catalyst Groesbeck Growth of Income Fund"   -> "catalyst groesbeck growth of income fund"
//	"Catalyst/Groesbeck Growth of Income Fund"   -> "catalyst groesbeck growth of income fund"
//
// and lookupSeriesByName over this filing's nine header declarations already
// returns S000027215 for the PRINTED unslashed spelling, and S000045924 for the
// Aggressive one. The resolver never gets the chance: dictFallback.apply
// (cik_series.go:515) returns immediately on `r.FundName == ""`, and the
// htmltable layout captures no fund name at all from a masthead whose name sits
// in its own cell under a `Fund Name -` label. Every one of the 1,289 blank rows
// carries a BLANK fund_name too -- which is why sections 1, 2, 4 and 5 are blank
// as well, though the dictionary holds exact-name rows for all four
// (`Catalyst Buyback Strategy Fund` S000043482 and `Catalyst/MAP Global Equity
// Fund` S000033420 are dictionary rows harvested from THIS filing's own
// 20170630 vintage). A slash-tolerance rung would fix nothing here.
//
// The fixtures are verbatim, unedited excerpts of the real filing. Both open
// with source lines 1-272 (the whole SEC-HEADER including the
// SERIES-AND-CLASSES-CONTRACTS-DATA block that declares the SLASHED names, the
// document preamble, `<TEXT>` and the `<HTML>`/`<BODY>` open) and close with
// `</BODY>`/`</HTML>`/`</TEXT>`/`</DOCUMENT>`/`</SEC-DOCUMENT>`.
// groesbeck_growth_of_income_unslashed.txt then carries source lines 6674-6882
// -- the section's opening `<TABLE>`, its `Registrant:`/`Fund Name -`/`Catalyst
// Groesbeck Growth of Income Fund`/`Exhibit 1` masthead, the reporting-period
// and `(a)`-`(i)` column-header rows, and the first fifteen ballot `<TR>`s
// (ABBOTT LABS and ABBVIE INC.), cut at a `<TR>` boundary -- plus a synthesised
// `</TABLE>` to close the excerpt. groesbeck_aggressive_growth_nil_unslashed.txt
// carries source lines 17919-18066, the Aggressive section's WHOLE table,
// masthead through its nil-report sentence. dict.tsv is all 149 real
// cik_series.tsv rows for this CIK, fetched verbatim, so nothing below is made
// unambiguous by hiding a rival spelling -- the file holds two rival
// `Catalyst Insider Buying Fund` rows (S000038434 and S000033417) and all three
// Groesbeck rows.
//
// Measured against the tracked binary, the Growth of Income fixture reproduces
// the full filing's behaviour exactly: 15 rows, layout htmltable, status ok,
// fund_name and series_id both blank on every one.
func TestNS1355064GroesbeckUnslashedMastheadRefused(t *testing.T) {
	const (
		incomeFixture = "groesbeck_growth_of_income_unslashed.txt"
		aggrFixture   = "groesbeck_aggressive_growth_nil_unslashed.txt"
		incomeFund    = "Catalyst Groesbeck Growth of Income Fund"
		aggrFund      = "Catalyst Groesbeck Aggressive Growth Fund"
		incomeID      = "S000027215"
		aggrID        = "S000045924"
	)

	// Precondition, not the claim under test: with the slash folded away by
	// normalizeSeriesName, BOTH printed unslashed banners already resolve off
	// this filing's own nine header declarations. If this ever stops holding,
	// the slash has become a real barrier and the row assertions below are
	// measuring something else.
	for _, fx := range []string{incomeFixture, aggrFixture} {
		b, err := os.ReadFile(filepath.Join("testdata", "family_ns1355064_groesbeck", fx))
		if err != nil {
			t.Fatal(err)
		}
		idx := seriesByName(parseHeader(b).SeriesDecls)
		for _, want := range []struct{ fund, id string }{{incomeFund, incomeID}, {aggrFund, aggrID}} {
			var got string
			if d := lookupSeriesByName(idx, want.fund); d != nil {
				got = d.SeriesID
			}
			if got != want.id {
				t.Fatalf("precondition: %s header index resolves printed unslashed %q to %q, want %s -- the slash IS a barrier and the rest of this test is measuring the wrong thing", fx, want.fund, got, want.id)
			}
		}
	}

	// The Aggressive Growth section is a nil report and yields no vote row, so
	// S000045924 is pinned where it can be pinned -- at the resolver -- and the
	// section's own dispatch is deliberately not asserted.

	rows := ns1355064Dispatch(t, incomeFixture, "dict.tsv", "htmltable", 15)
	for _, r := range rows {
		if r.FundName != incomeFund || r.SeriesID != incomeID {
			t.Errorf("the htmltable masthead's `Fund Name -` cell never reached the resolver: fund=%q want %q; series=%q want %s (issuer=%q cusip=%q meeting=%q desc=%q)", r.FundName, incomeFund, r.SeriesID, incomeID, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription)
		}
	}
}
