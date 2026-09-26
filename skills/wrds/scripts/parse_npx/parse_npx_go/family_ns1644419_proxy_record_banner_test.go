package main

import (
	"os"
	"path/filepath"
	"testing"
)

const ns1644419ProxyRecordDir = "family_ns1644419_proxy_record_banner"

// ns1644419ProxyRecordDispatch runs the real dispatch on a fixture in this
// family's testdata dir with the named dictionary loaded, asserting the
// fixture's own preconditions -- status, layout, row count -- so a failure in
// the body of the test below is an assertion about which section's fund each row
// was filed under, never a broken fixture. Same mechanism as
// ns1355064EmptySuffixDispatch, pointed at its own testdata dir.
func ns1644419ProxyRecordDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1644419ProxyRecordDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1644419ProxyRecordDir, fixture), sink, make([]byte, headBytes))
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

// CIK 0001644419 (Northern Lights Fund Trust IV) splits its 2022 htmltable
// N-PX into one vote table per sleeve, and prints the sleeve's banner in TWO
// shapes inside the SAME filing. Only one of the two is read, so seven of the
// eight sections in 000164/1644419/0001580642-22-003900.txt are filed under a
// fund the filing never named there.
//
// The shape that IS read puts the `Registrant:` label in the row's FIRST cell,
// with nothing beside it but the exhibit marker -- source line 15725:
//
//	<TD COLSPAN="6" STYLE="font-weight: bold">Registrant: <FONT ...><U>NORTHERN LIGHTS FUND TRUST IV - Inspire Corporate Bond Impact ETF</U></FONT></TD>
//	<TD>&nbsp;</TD>  (x4)
//	<TD STYLE="text-align: right">Item 1, Exhibit 11</TD></TR>
//
// Two filled cells, so it clears the `htmlFilledCells(cells) <= 2` gate at
// layout_htmltable.go:373 and is adopted by the two-cell registrant branch
// immediately below it (layout_htmltable.go:376-388).
//
// The shape that is NOT read prints the same banner inside the vendor's own
// masthead row, behind two cells of scaffolding -- source line 309-320, and
// again at 16236, 21067, 25284, 110532, 164029 and 232547:
//
//	<TR STYLE="vertical-align: bottom">
//	  <TD>Inspire Proxy Record</TD>
//	  <TD>N-PX</TD>
//	  <TD>&nbsp;</TD>  (x4, one of them text-align: right)
//	  <TD COLSPAN="2">Registrant: NORTHERN LIGHTS FUND TRUST IV - Inspire 100 ETF</TD>
//	  <TD>&nbsp;</TD>  (x4)
//	  <TD>Item 1, Exhibit&nbsp;&nbsp;10</TD></TR>
//
// FOUR filled cells -- `Inspire Proxy Record`, `N-PX`, the Registrant cell and
// the exhibit marker -- measured on the real bytes. So:
//
//   - `htmlFilledCells(cells) == 4` fails the `<= 2` gate at
//     layout_htmltable.go:373, and the whole heading reader below it, including
//     the two-cell registrant branch, is skipped.
//   - `htmlRegistrantSplitCells` (layout_htmltable.go:6711) refuses it too: it
//     requires the row's FIRST filled cell to be the bare label `Registrant`,
//     and here that cell is `Inspire Proxy Record`
//     (layout_htmltable.go:6722).
//   - `htmlRegistrantEmptySuffixFund` (layout_htmltable.go:6763) refuses it as
//     well: the Registrant cell does not end at a dash.
//
// The row therefore reaches no Registrant reader at all inside
// parseHTMLTableRaw (layout_htmltable.go:114), and `curFund` / `curSeries` are
// left exactly as the previous section left them. The COLSPAN on the Registrant
// cell varies across this filing's own sections (2 at source lines 315 and
// 25291, 3 at 16243 and 21074) and is not what decides this -- the leading
// scaffolding cells are.
//
// Measured on the whole filing against the tracked binary, with -cik-series
// loaded, the resulting attribution is:
//
//	section  banner shape  sleeve printed in the banner                  series_id stamped
//	1        masthead      Inspire 100 ETF                               (blank)     rows 1-1097
//	2        first cell    Inspire Corporate Bond Impact ETF             S000056116  row 1098, correct
//	3        masthead      Inspire Faithward Large Cap Momentum ESG ETF  S000056116  WRONG
//	4        masthead      Inspire Faithward Mid Cap Momentum ESG ETF    S000056116  WRONG
//	5        masthead      Inspire Global Hope ETF                       S000056116  WRONG
//	6        masthead      Inspire International ESG ETF                 S000056116  WRONG
//	7        masthead      Inspire Small / Mid Cap ESG ETF               S000056116  WRONG
//	8        masthead      Inspire Tacical Balanced ESG ETF              S000056116  WRONG
//
// The filing emits 17,606 rows. Rows 1-1097 are section 1's and carry a blank
// series_id; rows 1098-17606 ALL carry S000056116, with no further transition
// anywhere in the file, and only row 1098 -- section 2's own `No proxies voted`
// row -- is entitled to it. This reads like an off-by-one -- the first
// section blank, the second section's id then held forever -- but it is not: it
// is one rule missing. Section 2 is the ONLY section whose banner is in the
// readable shape, and it happens to sit between masthead-bannered sections, so
// its correctly-read id is what leaks forward.
//
// Every sleeve printed in a masthead banner is resolvable. Sections 3 and 4 are
// spelled exactly as this filing's own SEC-HEADER declares them (S000070124 and
// S000070125, source lines 105-106 and 115-116). Sections 1 and 5 use the
// 2017/2018-vintage short name (`Inspire 100 ETF`, `Inspire Global Hope ETF`)
// rather than the filing-period `... ESG ETF` spelling, and both are own-CIK
// cik_series.tsv rows for this registrant at those vintages -- so the ordinary
// multi-vintage own-CIK dictionary lookup answers them, with no cross-CIK guess
// needed. The precondition below asserts that for the two sleeves this fixture
// pins rather than assuming it, so a failure in the body is about attribution.
//
// A second filing of the same CIK, 000164/1644419/0001580642-22-004047.txt
// (proxyedge, 25 rows), loses its sleeves too, but NOT through this rule: all
// five of its banners are in the first-cell shape, its fund_name values retain
// the literal `Registrant: ` label (so peRegistrantFund at
// layout_proxyedge.go:581 never ran on them), and its single-line banners at
// source lines 1033 and 1533 fail identically to its newline-wrapped ones at
// 277 and 1991. The wrap is not the discriminator there and that is a separate
// defect, not this one; it is not pinned here.
//
// FIXTURE. inspire_2022_proxy_record_banner.txt is an unedited excerpt of the
// real filing bytes, fetched from /wrds/sec/archives. It opens with the whole
// SEC-HEADER -- including the SERIES-AND-CLASSES-CONTRACTS-DATA block declaring
// all eight series -- the document preamble, <TEXT>, <HTML>, <BODY> and the OMB
// cover table, and then carries three consecutive vote-table sections cut at
// <TR> boundaries, in the filing's own order:
//
//	source lines      section                                            content kept
//	1-400             1  Inspire 100 ETF (masthead banner)               banner, scaffolding, column header, first 3 vote rows
//	15718-15805       2  Inspire Corporate Bond Impact ETF (first cell)  banner, scaffolding, its `No proxies voted` row
//	16216-16327       3  Inspire Faithward Large Cap Momentum ESG ETF    banner, scaffolding, column header, first 3 vote rows
//	                     (masthead banner)
//
// Only three things are synthesised: a `  </TABLE>` closing each of the three
// truncated tables, and the filing's own `</BODY> </HTML> </TEXT> </DOCUMENT>
// </SEC-DOCUMENT>` tail. Section 2 is kept because it is the source of the
// leaked id -- without it the staleness has nothing to be stale with -- and
// section 3 is kept to show the leak survives a section transition rather than
// being a one-section slip.
//
// dict.tsv is all 76 real cik_series.tsv rows for this CIK, verbatim, so
// nothing below is made unambiguous by hiding a rival spelling: the file holds
// three rival names for S000056116 and four for S000070125.
//
// Measured against the tracked binary at HEAD, the fixture reproduces the full
// filing's behaviour on both sections: section 1's three rows carry a blank
// series_id and section 3's three rows carry S000056116.
func TestNS1644419ProxyRecordMastheadRegistrantBanner(t *testing.T) {
	const fixture = "inspire_2022_proxy_record_banner.txt"

	rows := ns1644419ProxyRecordDispatch(t, fixture, "dict.tsv", "htmltable", 6)

	// Precondition, not the claim under test: the sleeve name printed in each
	// masthead banner already resolves for this filing -- section 3's off its
	// own header, section 1's off this registrant's own multi-vintage
	// dictionary rows. If this stops holding, the names have become genuinely
	// unresolvable and the row assertions below measure something else.
	b, err := os.ReadFile(filepath.Join("testdata", ns1644419ProxyRecordDir, fixture))
	if err != nil {
		t.Fatal(err)
	}
	meta := parseHeader(b)
	fb := cikDict.exactFallback(meta)
	hdr := seriesByName(meta.SeriesDecls)
	for _, pc := range []struct {
		fund, series string
	}{
		{"Inspire 100 ETF", "S000059335"},
		{"Inspire Faithward Large Cap Momentum ESG ETF", "S000070124"},
	} {
		var got string
		if d := lookupSeriesByName(hdr, pc.fund); d != nil {
			got = d.SeriesID
		}
		if got == "" {
			probe := VoteRow{FundName: pc.fund}
			fb.apply(&probe)
			got = probe.SeriesID
		}
		if got != pc.series {
			t.Fatalf("precondition: %q resolves to %q, want %s -- the sleeve is not resolvable for this filing and the rest of this test measures the wrong thing", pc.fund, got, pc.series)
		}
	}

	// Each section's rows must carry that section's OWN sleeve. Keyed on
	// issuer, which is what tells the two sections apart in the fixture:
	// section 1 votes ALBEMARLE CORPORATION, section 3 votes ALIGN TECHNOLOGY.
	want := map[string]struct {
		fund, series string
	}{
		"ALBEMARLE CORPORATION":  {"Inspire 100 ETF", "S000059335"},
		"ALIGN TECHNOLOGY, INC.": {"Inspire Faithward Large Cap Momentum ESG ETF", "S000070124"},
	}
	seen := map[string]int{}
	for i, r := range rows {
		w, ok := want[r.IssuerName]
		if !ok {
			t.Errorf("row %d: unexpected issuer %q -- the fixture's own sections have moved", i+1, r.IssuerName)
			continue
		}
		seen[r.IssuerName]++
		if r.SeriesID != w.series || r.FundName != w.fund {
			t.Errorf("row %d (%s): the masthead Registrant banner never reached the resolver -- series=%q want %s; fund=%q want %q (cusip=%q meeting=%q desc=%q)",
				i+1, r.IssuerName, r.SeriesID, w.series, r.FundName, w.fund, r.CUSIP, r.MeetingDate, r.VoteDescription)
		}
	}
	for issuer := range want {
		if seen[issuer] != 3 {
			t.Errorf("issuer %q contributed %d rows, want 3 -- the fixture's section slices have moved", issuer, seen[issuer])
		}
	}
}
