package main

import (
	"path/filepath"
	"testing"
)

// familyNS37Dispatch runs the real dispatch on a family NS37 fixture with the
// named dictionary loaded and NO series-map overlay, and asserts the fixture's
// own preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyNS37Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns37", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns37", fixture), sink, make([]byte, headBytes))
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

// 000103/1035018/0000067590-06-000187.txt: verbatim source lines 11-55 (the SEC
// document opener through the registrant's FORMER COMPANY block and the two
// opening SERIES-AND-CLASSES tags), 574-592 (the two closing SERIES-AND-CLASSES
// tags, </SEC-HEADER>, the <DOCUMENT>/<TEXT> opener and the document's own FORM
// N-PX masthead -- which names `American Skandia Trust` and file number
// 811-05186, NOT the filer), 22419-22437 (the two-line AST DEAM SMALL-CAP
// GROWTH banner and the AAR CORP. meeting beneath it), 57853-57872 (the AST MFS
// GLOBAL EQUITY banner and the 3M CO meeting beneath it) and the filing's own
// last four lines. Every byte is verbatim. The 14 <SERIES> blocks of the header
// are cut out by that line range: all fourteen are STRATEGIC PARTNERS sleeves,
// none of which this document's body names, and cutting them changes nothing
// about the shape below -- with them the real filing resolves these two
// headings exactly as the fixture does (measured on the whole filing: 905 rows
// blank under DEAM, 1,281 rows stamped S000002192 under MFS GLOBAL EQUITY).
//
// Strategic Partners Mutual Funds, Inc., CIK 1035018, period 20060630, layout
// `issnpx` (the precondition asserts it).
//
// Heading bytes, source lines 22419-22420 and 57854, verbatim:
//
//	=========== AST DEAM SMALL-CAP GROWTH PORTFOLIO - ADVISOR: DEUTSCHE ============
//	===========                    ASSET MANAGEMENT                     ============
//
//	================ AST MFS GLOBAL EQUITY PORTFOLIO - ADVISOR: MFS ================
//
// Both banners carry a ` - ADVISOR: <manager>` suffix. That suffix is not part
// of any fund's name -- it names the sub-adviser of the sleeve -- and it is
// what blocks the resolution. THE ROUTE IS PROBED, not judged by eye. Against
// this filing's own index -- `issFilingIndex(meta.SeriesDecls,
// normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))` plus
// `issFormerKeys` -- `icrResolveFundShared` answers:
//
//	"AST DEAM SMALL-CAP GROWTH PORTFOLIO - ADVISOR: DEUTSCHE ASSET MANAGEMENT" -> ""
//	"AST DEAM SMALL-CAP GROWTH PORTFOLIO"                                      -> "S000001994"
//	"AST MFS GLOBAL EQUITY PORTFOLIO - ADVISOR: MFS"                           -> "S000002192"  <- WRONG
//	"AST MFS GLOBAL EQUITY PORTFOLIO"                                          -> "S000001995"
//	"AST MFS GROWTH PORTFOLIO - ADVISOR: MFS"                                  -> ""
//	"AST MFS GROWTH PORTFOLIO"                                                 -> "S000001996"
//	"AST T. ROWE PRICE ASSET ALLOCATION PORTFOLIO - ADVISOR: T. ROWE PRICE"    -> ""
//	"AST T. ROWE PRICE ASSET ALLOCATION PORTFOLIO"                             -> "S000002011"
//	"AST XYZZY PORTFOLIO"                                                      -> ""
//
// Cut the suffix and every heading is a VERBATIM declared name. The ids are
// American Skandia Trust's (CIK 814679) -- `AST DEAM SMALL-CAP GROWTH
// PORTFOLIO` S000001994 and `AST MFS GLOBAL EQUITY PORTFOLIO` S000001995, both
// declared at vintage 20060630, this filing's own period -- and the document's
// own masthead in this fixture says `American Skandia Trust`, file number
// 811-05186, which is 814679's, not the filer's 811-08085. Nothing is guessed:
// the bytes print the declared name and a suffix.
//
// The second assertion below is the more serious half. With the suffix present
// the chain does not merely fail, it answers S000002192 -- `STRATEGIC PARTNERS
// EQUITY INCOME FUND` -- for a banner whose bytes read `AST MFS GLOBAL EQUITY
// PORTFOLIO`. That is a wrong series, not a missing one: 1,281 rows of the real
// filing carry it today.
//
// Fix location: `layout_issnpx.go`, `issSectionFundName` / the banner
// normalisation that feeds `icrResolveFundShared` -- cut a trailing
// ` - ADVISOR: <rest>` (and the two-line banner's wrapped continuation of it)
// from the heading before resolution, and resolve the cut form first so the
// exact declared name wins over any tolerance hit on the uncut string.
//
// Rows affected on this path: 34,701 blank rows charged by the pool, plus the
// wrongly-stamped sections -- 1,281 (MFS GLOBAL EQUITY -> S000002192), 1,535
// (ALLIANCEBERNSTEIN CORE VALUE -> S000002186), 535 (MARSICO CAPITAL GROWTH ->
// S000002194), 1,263 (WILLIAM BLAIR INTERNATIONAL GROWTH -> S000002193), 370
// (GOLDMAN SACHS CONCENTRATED GROWTH -> S000002178) and 13 (HIGH YIELD ->
// S000002191).
func TestFamilyNS37ASTAdvisorSuffixBlocksTheDeclaredName(t *testing.T) {
	rows := familyNS37Dispatch(t, "ast_advisor_suffix.txt", "ast_dict.tsv", "issnpx", 13)
	var deam, mfs int
	for _, r := range rows {
		switch r.FundName {
		case "AST DEAM SMALL-CAP GROWTH PORTFOLIO - ADVISOR: DEUTSCHE ASSET MANAGEMENT":
			deam++
			if r.SeriesID != "S000001994" {
				t.Errorf("the banner names `AST DEAM SMALL-CAP GROWTH PORTFOLIO` plus a ` - ADVISOR:` sub-adviser suffix; cut the suffix and the heading is the verbatim declared name of S000001994 at this filing's own 20060630 vintage: issuer=%q cusip=%q date=%q desc=%q series=%q want S000001994",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		case "AST MFS GLOBAL EQUITY PORTFOLIO - ADVISOR: MFS":
			mfs++
			if r.SeriesID != "S000001995" {
				t.Errorf("the banner names `AST MFS GLOBAL EQUITY PORTFOLIO`, the verbatim declared name of S000001995; with the ` - ADVISOR: MFS` suffix left on, the chain answers S000002192 (`STRATEGIC PARTNERS EQUITY INCOME FUND`) instead -- a series these bytes do not name: issuer=%q cusip=%q date=%q desc=%q series=%q want S000001995",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		default:
			t.Errorf("unexpected section %q", r.FundName)
		}
	}
	if deam != 4 || mfs != 9 {
		t.Fatalf("fixture sections: deam=%d mfs=%d want 4/9", deam, mfs)
	}
}
