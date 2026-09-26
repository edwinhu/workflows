package main

import (
	"os"
	"path/filepath"
	"testing"
)

const ns1355064EmptySuffixDir = "family_ns1355064_registrant_empty_suffix"

// ns1355064EmptySuffixDispatch runs the real dispatch on a fixture in this
// family's testdata dir with the named dictionary loaded, asserting the
// fixture's own preconditions -- status, layout, row count -- so a failure in
// the body of the test below is an assertion about the masthead's fund name and
// its series id, never a broken fixture. Same mechanism as ns1355064Dispatch in
// family_ns1355064_groesbeck_slash_test.go, pointed at its own testdata dir.
func ns1355064EmptySuffixDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1355064EmptySuffixDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1355064EmptySuffixDir, fixture), sink, make([]byte, headBytes))
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

// CIK 0001355064 (Mutual Fund Series Trust) prints its htmltable vote-table
// masthead TWO ways in the SAME filing, and one of them loses the fund name.
// The working spelling puts the name inline after the dash, inside the one bold
// cell -- measured verbatim at source line 2018 of
// 000135/1355064/0001580642-18-004116.txt:
//
//	<B>Registrant: Mutual Fund Series Trust-&nbsp;&nbsp;Catalyst Hedged Futures Strategy Fund</B>
//
// The broken spelling ends the bold cell AT the dash, with nothing after it, and
// carries the fund name in a SEPARATE bold <TD> a few cells later in the same
// <TR> -- source line 579 of the same filing:
//
//	<TD NOWRAP COLSPAN="3" ...><FONT ...><B>Registrant: Mutual Fund Series Trust- </B></FONT></TD>
//	<TD ...>&nbsp;</TD>
//	<TD ...>&nbsp;</TD>
//	<TD COLSPAN="2" ...><FONT ...><B>Catalyst Buyback Strategy Fund</B></FONT></TD>
//	<TD ...>&nbsp;</TD>
//	<TD ...>&nbsp;</TD>
//	<TD ...><FONT ...>Item 1</FONT></TD></TR>
//
// Both spellings recur across this CIK's filings; measured over the real bytes,
// the broken one appears at least at:
//
//	filing                  source line  masthead fund name printed in the split cell
//	0001580642-18-004116.txt        579  Catalyst Buyback Strategy Fund
//	0001580642-18-004116.txt       3423  Catalyst Macro Strategy Fund
//	0001580642-17-004483.txt        420  Catalyst Buyback Strategy Fund (Previously Catalyst/EquityCompass Buyback Strategy Fund)
//	0001580642-17-004479.txt        407  Catalyst Insider Income Fund
//	0001580642-17-004483.txt      13087  Catalyst IPOx Allocation Fund
//
// and 18-004116 carries BOTH spellings -- four inline mastheads (lines 2018,
// 2117, 3714, 7874) beside the two split ones -- so the split cell is a per-
// section vendor variation, not a per-filing one.
//
// The trailing-marker cell is NOT a reliable discriminator by boldness. In
// 18-004116 line 579 the marker reads `Item 1` and is NOT bold; in 17-004483
// line 420 it reads `Exhibit 1` and is NOT bold; but in 17-004479 line 407 it
// reads `Exhibit 1` and IS bold, inside the same <B> wrapper the fund name uses.
// What IS invariant across every observed instance is ORDER: the fund-name cell
// comes before the Exhibit/Item cell. So the rule a fix should implement -- and
// the reason the bold-Exhibit filing is pinned here as its own fixture -- is
// "first non-empty bold cell in the row whose text does not match
// /^(Exhibit|Item)\s*\d+$/", never "first bold cell".
//
// Every vote row under a split masthead carries a BLANK fund_name, and hence a
// BLANK series_id, though all four sleeves are real, exactly-spelled, already-
// declared series for this CIK in cik_series.tsv:
//
//	S000043482  Catalyst/EquityCompass Buyback Strategy Fund  20140630
//	S000043482  Catalyst Buyback Strategy Fund                20170630
//	S000044450  Catalyst Macro Strategy Fund                  20140630
//	S000045921  Catalyst Insider Income Fund                  20140630
//	S000050258  Catalyst IPOx Allocation Fund                 20150630
//
// and each is declared in its own filing's SEC-HEADER too (18-004116 declares
// Buyback at source line 194 and Macro at 218; 17-004479 declares Insider Income
// at 170), which the preconditions below assert rather than assume. The rows
// themselves parse fine -- issuer, meeting date and description all land -- so
// this is a masthead capture gap in the htmltable layout, not a dictionary gap
// and not a resolver gap: dictFallback.apply (cik_series.go) returns immediately
// on `r.FundName == ""`, so a blank capture is never given to the resolver at all.
// This is the same failure mode as the `Fund Name -` label-cell masthead pinned
// in family_ns1355064_groesbeck_slash_test.go, with the name in a bare adjacent
// cell instead of one behind a label.
//
// The fixtures are verbatim, unedited excerpts of the real filing bytes, fetched
// from /wrds/sec/archives. Each opens with its filing's whole SEC-HEADER --
// including the SERIES-AND-CLASSES-CONTRACTS-DATA block -- the document
// preamble, <TEXT>, <HTML> and <BODY> (source lines 1-396 for 18-004116, 1-252
// for 17-004479), then carries one vote-table section cut at a <TR> boundary,
// then closes the excerpt:
//
//	buyback_2018_empty_suffix.txt        18-004116 lines  577-701  + synthesised </TABLE> and close tags (6 rows)
//	macro_2018_empty_suffix.txt          18-004116 lines 3421-3514 (the section's own </TABLE>) + close tags (3 rows)
//	insider_income_2017_bold_exhibit.txt 17-004479 lines  405-500  + synthesised </TABLE> and close tags (2 rows)
//
// dict.tsv is all 149 real cik_series.tsv rows for this CIK, verbatim, so
// nothing below is made unambiguous by hiding a rival spelling -- the file holds
// two rival `Catalyst Insider Buying Fund` rows and three later reuses of
// S000043482 and S000050258 under renamed sleeves.
//
// Measured against the tracked binary at HEAD, all three fixtures reproduce the
// full filings' behaviour: status ok, layout htmltable, and fund_name and
// series_id both blank on all 11 rows.
func TestNS1355064RegistrantEmptySuffixSplitFundNameCell(t *testing.T) {
	for _, tc := range []struct {
		fixture string
		fund    string
		series  string
		rows    int
	}{
		{"buyback_2018_empty_suffix.txt", "Catalyst Buyback Strategy Fund", "S000043482", 6},
		{"macro_2018_empty_suffix.txt", "Catalyst Macro Strategy Fund", "S000044450", 3},
		{"insider_income_2017_bold_exhibit.txt", "Catalyst Insider Income Fund", "S000045921", 2},
	} {
		t.Run(tc.fixture, func(t *testing.T) {
			// Precondition, not the claim under test: the name printed in the
			// split cell already resolves off the fixture's OWN header
			// declarations. If this stops holding, the name has become
			// genuinely unresolvable and the row assertions below are
			// measuring something else.
			b, err := os.ReadFile(filepath.Join("testdata", ns1355064EmptySuffixDir, tc.fixture))
			if err != nil {
				t.Fatal(err)
			}
			var got string
			if d := lookupSeriesByName(seriesByName(parseHeader(b).SeriesDecls), tc.fund); d != nil {
				got = d.SeriesID
			}
			if got != tc.series {
				t.Fatalf("precondition: %s header index resolves printed %q to %q, want %s -- the name is not resolvable and the rest of this subtest measures the wrong thing", tc.fixture, tc.fund, got, tc.series)
			}

			rows := ns1355064EmptySuffixDispatch(t, tc.fixture, "dict.tsv", "htmltable", tc.rows)
			for _, r := range rows {
				if r.FundName != tc.fund || r.SeriesID != tc.series {
					t.Errorf("the split fund-name cell never reached the resolver: fund=%q want %q; series=%q want %s (issuer=%q cusip=%q meeting=%q desc=%q)", r.FundName, tc.fund, r.SeriesID, tc.series, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription)
				}
			}
		})
	}
}
