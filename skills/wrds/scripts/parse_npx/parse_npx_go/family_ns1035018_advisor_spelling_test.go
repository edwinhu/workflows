package main

import (
	"path/filepath"
	"testing"
)

// familyNS1035018Dispatch runs the real dispatch on a family NS-1035018 fixture
// with the named dictionary loaded and NO series-map overlay, and asserts the
// fixture's own preconditions -- status, layout and row count -- so a failure
// below is an assertion about the series id and never a broken fixture.
func familyNS1035018Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns1035018", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns1035018", fixture), sink, make([]byte, headBytes))
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

// 000103/1035018/0000067590-06-000187.txt: verbatim source lines 11-592 (the SEC
// document opener, the registrant's FORMER COMPANY block, all fourteen <SERIES>
// blocks of the header, </SEC-HEADER>, the <DOCUMENT>/<TEXT> opener and the
// document's own FORM N-PX masthead -- which names `American Skandia Trust` and
// file number 811-05186, NOT the filer), 41299-41340 (the two-line AST JP MORGAN
// INTERNATIONAL EQUITY banner and the ABN AMRO HOLDING NV meeting beneath it),
// 89675-89696 (the one-line AST T. ROWE GLOBAL BOND banner, the TRAVEL CENTERS
// AMERICA written consent beneath it, and the AST T. ROWE PRICE ASSET
// ALLOCATION banner that closes that section in the source -- it opens a section
// the range carries no meeting for, which is why it emits no row) and the
// filing's own last six lines. Every byte is verbatim.
//
// Strategic Partners Mutual Funds, Inc., CIK 1035018, period 20060630, layout
// `issnpx` (the precondition asserts it). This filing carries 1,794 rows with no
// series id today -- the largest still-open known-registrant no_series residue.
//
// This is the SECOND defect on the AST advisor-suffix path, not a re-run of
// NS37. Commit aadcb960 taught `issCutSubAdviser` to cut the ` - ADVISOR:
// <manager>` suffix, and the banner joiner already joins a suffix that WRAPS
// onto the following ruled line, so both shapes below arrive at the resolver
// with the suffix removed. What still blocks them is that `issAdvisorSuffixDecl`
// answers the cut remainder EXACTLY, on both its routes, and the filing spells
// the base fund name a little differently from the declaration:
//
//	==========  AST JP MORGAN INTERNATIONAL EQUITY PORTFOLIO - ADVISOR: JP ==========
//	==========                           MORGAN                           ==========
//
//	========== AST T. ROWE GLOBAL BOND PORTFOLIO - ADVISOR: T. ROWE PRICE ==========
//
// The first banner prints `JP MORGAN` where the declaration at this filing's own
// vintage spells the house one word, `JPMORGAN`; the second drops `PRICE` out of
// `T. ROWE PRICE`. THE ROUTE IS PROBED, not judged by eye. Against this filing's
// own index -- `issFilingIndex(meta.SeriesDecls,
// normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))` plus
// `issFormerKeys` -- `icrResolveFundShared` answers:
//
//	"AST JP MORGAN INTERNATIONAL EQUITY PORTFOLIO - ADVISOR: JP MORGAN" -> ""
//	"AST JP MORGAN INTERNATIONAL EQUITY PORTFOLIO"                      -> ""
//	"AST JPMORGAN INTERNATIONAL EQUITY PORTFOLIO"                       -> "S000001976"
//	"AST T. ROWE GLOBAL BOND PORTFOLIO - ADVISOR: T. ROWE PRICE"        -> ""
//	"AST T. ROWE GLOBAL BOND PORTFOLIO"                                 -> ""
//	"AST T. ROWE PRICE GLOBAL BOND PORTFOLIO"                           -> "S000001979"
//
// So the suffix is already off -- cutting it changes nothing here, which is what
// separates this family from NS37 -- and the remainder reaches the exact-name
// rung one space or one word short of the declaration it names.
//
// Both target names are corpus-unique, checked against the whole
// `cik_series.tsv`: `AST JPMORGAN INTERNATIONAL EQUITY PORTFOLIO` (20060630) and
// `AST J.P. MORGAN INTERNATIONAL EQUITY PORTFOLIO` (20120630) are the SAME
// series S000001976 under CIK 814679 -- the corpus itself records that this
// house is spelled both ways for this one fund -- and `AST T. ROWE PRICE GLOBAL
// BOND PORTFOLIO` (20060630) is S000001979 under the same CIK and nothing else.
// Neither banner can mean a second series, so nothing is guessed.
//
// Rows affected in this filing: 1,124 under the JP MORGAN banner and 1 under the
// T. ROWE GLOBAL BOND banner. The same exact-only rung leaves a further 669 rows
// blank under three `AST MID-CAP VALUE PORTFOLIO - ADVISOR: <manager>` banners,
// whose remainder IS exact but collides across vintages (S000002001 at 20060630,
// S000002008 at 20210630) -- a different defect, deliberately not fixtured here.
//
// Fix location: `layout_issnpx.go`, `issAdvisorSuffixDecl` -- the cut remainder
// is currently admitted only by `lookupSeriesEntry` and `crossCIK`, both exact.
// A remainder that names exactly one declaration of the corpus once house
// spelling is folded should be admitted on the same terms the exact routes use:
// one candidate, or nothing.
func TestFamilyNS1035018AdvisorRemainderSpellingBlocksTheDeclaredName(t *testing.T) {
	rows := familyNS1035018Dispatch(t, "ast_advisor_spelling.txt", "dict.tsv", "issnpx", 17)
	var jpm, trp int
	for _, r := range rows {
		switch r.FundName {
		case "AST JP MORGAN INTERNATIONAL EQUITY PORTFOLIO - ADVISOR: JP MORGAN":
			jpm++
			if r.SeriesID != "S000001976" {
				t.Errorf("the banner names `AST JP MORGAN INTERNATIONAL EQUITY PORTFOLIO` plus a ` - ADVISOR:` sub-adviser suffix that wraps onto the rule below it; the suffix is already cut, and the remainder differs from S000001976's declaration at this filing's own 20060630 vintage only in spelling the house `JP MORGAN` where the corpus spells it `JPMORGAN` -- and the corpus spells that same series `AST J.P. MORGAN INTERNATIONAL EQUITY PORTFOLIO` at 20120630: issuer=%q cusip=%q date=%q desc=%q series=%q want S000001976",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		case "AST T. ROWE GLOBAL BOND PORTFOLIO - ADVISOR: T. ROWE PRICE":
			trp++
			if r.SeriesID != "S000001979" {
				t.Errorf("the banner names `AST T. ROWE GLOBAL BOND PORTFOLIO`; the only declaration of the corpus it can mean is `AST T. ROWE PRICE GLOBAL BOND PORTFOLIO`, S000001979 under CIK 814679 at this filing's own 20060630 vintage, which the banner prints one word short: issuer=%q cusip=%q date=%q desc=%q series=%q want S000001979",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		default:
			t.Errorf("unexpected section %q", r.FundName)
		}
	}
	if jpm != 16 || trp != 1 {
		t.Fatalf("fixture sections: jpm=%d trp=%d want 16/1", jpm, trp)
	}
}
