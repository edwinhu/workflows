package main

import (
	"path/filepath"
	"testing"
)

const ns1109957CullenDir = "family_ns1109957_proxyedge_lowercase_banner"

// ns1109957CullenDispatch runs the real dispatch on a fixture in this family's
// testdata dir with the named dictionary loaded, asserting the fixture's own
// preconditions -- status, layout, row count -- so a failure in the body of the
// test below is an assertion about the fund each row was filed under and never a
// broken fixture. Same mechanism as ns1650TwoRoadsDispatch, pointed at its own
// testdata dir.
func ns1109957CullenDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1109957CullenDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1109957CullenDir, fixture), sink, make([]byte, headBytes))
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

// Cullen Funds Trust, CIK 0001109957, period 20090630, filing
// 000110/1109957/0000891092-09-003149.txt (`proxyedge`, 679 rows). LOST_BASE
// records 629 of those 679 rows as no_series, which makes this the CIK's top
// open known-registrant residue. THAT CENSUS IS STALE, and this test is a
// regression guard over the shape that produced it, not a pin on an open defect.
//
// MEASURED on the real filing, running the tracked binaries over
// /wrds/sec/archives with -cik-series and -series-map pointed at the real corpus
// files (rows, then blank series_id, field 8 of the votes TSV):
//
//	b340 679/629   b360 679/629   b370 679/629   b375 679/249
//	b376 679/0     b377 679/0     b378 679/0     b380 679/0   b385 679/0
//
// So the 629 blanks were real through binary 370, were cut to 249 at 375 and
// reached zero at 376; LOST_BASE's row for this filing predates that, because
// the filing has been in no delta round since. HEAD emits 0/679 blank on the
// whole real document, with the fund transitioning exactly twice -- row 0 to
// S000006835 and row 380 to S000006836, one per printed banner.
//
// The document prints TWO fund banners, and the CASING of their markup is NOT
// what parts them. Source lines 205-207, section 1's banner -- uppercase tags
// inside one <font face="Arial">, the name and `Selected Accounts` in a SINGLE
// <p> container, so peCellLines reads them as one cell of two lines:
//
//	<P align=left><font face="Arial"><B>Cullen High Dividend Equity Fund: 01-Jul-2008 To 30-Jun-2009</B><br>
//	  <BR>
//	  <B>Selected Accounts</B></font></P>
//
// Source lines 31306-31309, section 2's banner -- lowercase tags, no <font>
// wrapper, and TWO separate <p> containers, so each line is a whole cell of its
// own:
//
//	<p><b>Cullen International High Dividend Fund: 01-Jul-2008 To 30-Jun-2009</b>
//	</p>
//	<p><b>Selected Accounts</b>
//	</p>
//
// The lowercase form is the one the bare-heading scan
// (layout_proxyedge.go:1127) has always read: it is a whole cell, so
// peWholeCells marks it and peFundName resolves `Cullen International High
// Dividend Fund: 01-Jul-2008 To 30-Jun-2009` against the filing's own
// declarations. PROBED on this very fixture, same dictionary, binaries only
// differing: b370 emits [] [] [S000006836] -- section 2's LOWERCASE banner
// resolved even then, and it was section 1's UPPERCASE two-line-joined cell that
// blanked. b375, b376 and b385 all emit [S000006835] [S000006835] [S000006836].
// The joined-cell arm at layout_proxyedge.go:1152 (commit 37c075b7, binary 372)
// is what reads section 1's banner, and the guards added by 01dc4eec, e7b47836,
// 27378faa and 7d168ae5 are what keep that arm off wrapped proposal prose.
//
// Neither fund name is invented. The filing's own SEC-HEADER declares three
// series (source lines 53, 83, 113): S000006835 `Cullen High Dividend Equity
// Fund`, S000006836 `Cullen International High Dividend Fund`, S000026472
// `Cullen Small Cap Value Fund`, and the fixture carries that block verbatim.
// dict.tsv is all seven real cik_series.tsv rows for this CIK, verbatim,
// including the rival 20070630 spelling `Cullen High Dividend Fund` for
// S000006835 -- so nothing below is made unambiguous by hiding a spelling.
//
// FIXTURE. cullen2009_lowercase_banner.txt is verbatim source lines 1-151 (the
// PRIVACY-ENHANCED MESSAGE opener, the whole SEC-HEADER including the
// SERIES-AND-CLASSES-CONTRACTS-DATA block declaring all three series, the
// document preamble, <TEXT>, <HTML>, <BODY>), 201-438 (the page-break rule,
// section 1's uppercase banner, the VODAFONE GROUP PLC identity block, the
// uppercase `Item / Proposal / Recommendation / For / Against / Abstain / Take
// No Action` header band and its first two ballot rows), 31293-31522 (the
// `</table>` closing section 1's grid, the page-break rule between the two
// sections, section 2's lowercase banner, its own VODAFONE GROUP PLC identity
// block, its lowercase header band and its first ballot row) and 61492-61499
// (the filing's own last eight lines). Nothing is synthesised and nothing is
// edited: md5 of the concatenated slices matches the md5 of the same sed range
// taken on WRDS.
func TestFamilyNS1109957CullenBothBannerCasings(t *testing.T) {
	rows := ns1109957CullenDispatch(t, "cullen2009_lowercase_banner.txt", "dict.tsv", "proxyedge", 3)
	want := []struct {
		fund   string
		series string
	}{
		// Section 1, the uppercase banner joined from two lines of one <p>.
		{"Cullen High Dividend Equity Fund: 01-Jul-2008 To 30-Jun-2009 Selected Accounts", "S000006835"},
		{"Cullen High Dividend Equity Fund: 01-Jul-2008 To 30-Jun-2009 Selected Accounts", "S000006835"},
		// Section 2, the lowercase banner standing alone in its own <p>.
		{"Cullen International High Dividend Fund: 01-Jul-2008 To 30-Jun-2009", "S000006836"},
	}
	for i, r := range rows {
		if r.IssuerName != "VODAFONE GROUP PLC" || r.CUSIP != "92857W209" || r.MeetingDate != "20080729" {
			t.Errorf("row %d: the fixture's own identity block has moved: issuer=%q cusip=%q date=%q want %q / %q / %q",
				i+1, r.IssuerName, r.CUSIP, r.MeetingDate, "VODAFONE GROUP PLC", "92857W209", "20080729")
		}
		if r.FundName != want[i].fund || r.SeriesID != want[i].series {
			t.Errorf("row %d: a printed fund banner stopped being read, so the row is filed under the wrong section: fund=%q series=%q want %q / %q (issuer=%q date=%q desc=%q)",
				i+1, r.FundName, r.SeriesID, want[i].fund, want[i].series,
				r.IssuerName, r.MeetingDate, r.VoteDescription)
		}
	}
}
