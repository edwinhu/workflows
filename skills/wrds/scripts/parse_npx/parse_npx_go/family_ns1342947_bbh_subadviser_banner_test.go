package main

import (
	"path/filepath"
	"testing"
)

// 000134/1342947/0001318148-07-001391.txt: verbatim source lines 1-143 (the
// whole SEC header, all 7 SERIES declarations, and the `<DOCUMENT>`/`<html>`
// opener) and 39729-40001 (the third section's fund banner, the sub-adviser
// stack under it, the table it opens, INDITEX's identity block, the
// `Item`/`Proposal`/... band and the first four ballots). Every byte is a
// line-range cut of the source; the six closing lines `</table>`, two `</div>`,
// `</body>`, `</html>`, `</TEXT>` and `</DOCUMENT>` are the only added ones, and
// they close markup the cut opened.
//
// BBH TRUST, CIK 1342947, period 20070630. ALL 805 of this filing's rows carry a
// blank series id, measured through the real dispatch on the whole filing -- the
// filing entire, not a section of it -- and every one of them carries the same
// fund name, `BBH Trust`, which is the REGISTRANT, off the document's own
// `<title>` at source line 141. No fund banner in this filing is ever read, so
// the registrant name the cover page left behind is what all 805 rows keep, and
// it resolves to no series. It is this CIK's largest open no-series residue and
// had never been diagnosed.
//
// THE SHAPE. The filing is three fund sections. Each opens with the fund's name
// as a STANDALONE DIV between the previous table's close and the next table's
// open, and each prints that name a second time inside the section's own
// sub-adviser stack. Source lines 39729-39737, verbatim, which is what the cut
// below begins with:
//
//	<div style="..." align="left"><font style="...">BBH
//	  INTERNATIONAL EQUITY FUND</font></div>
//	<div style="..." align="left"><br>
//	  <div style="..." align="center"><font style="...">Walter
//	    Scott &amp; Partners limited</font></div>
//	  <div style="..." align="center"><font style="...">BBH
//	    International Equity Fund</font></div>
//	  <div style="..." align="center"><font style="...">Proxy
//	    Voting Detail 7/1/2006 - 6/30/2007</font></div><br></div>
//
// `BBH INTERNATIONAL EQUITY FUND` is the name the filing's own header declares
// at source lines 62-63, `<SERIES-ID>S000015105` / `<SERIES-NAME>BBH
// International Equity Fund`. No dictionary is loaded by this test: the filing's
// own declaration is the whole of the evidence, and `icrResolveFundShared`
// answers the banner with S000015105 off that index alone. One declared series
// answers it, so nothing here is ambiguous.
//
// THE DEFECT, and it is not the sub-adviser line. `parseProxyEdge` never sees
// the banner as a banner because the vendor HARD-WRAPPED it inside its own
// container: the div holds two source lines, `BBH` and `INTERNATIONAL EQUITY
// FUND`, so `peCellLines` makes them one cell of two lines and `peWholeCells`
// marks NEITHER of them whole. Measured on this fixture through the real
// `peCellLines`/`peWholeCells`:
//
//	i= 89 run= 89 whole=false "BBH"
//	i= 90 run= 89 whole=false "INTERNATIONAL EQUITY FUND"
//	i=101 run=101 whole=false "INDUSTRIA"
//	i=102 run=101 whole=false "DE DISENO TEXTIL INDITEX SA"
//
// The bare-heading FUND scan (`layout_proxyedge.go:849`) is gated on `whole[i]`
// and tests `peFundName(line)` -- a single LINE -- so it cannot fire on either
// half. The ISSUER scan one branch above it (`layout_proxyedge.go:825`) is
// gated on `run[i] == i` only and tests the JOINED CELL from `peCellAt`, which
// is why `INDUSTRIA` / `DE DISENO TEXTIL INDITEX SA`, a cell of exactly the same
// shape, IS read and every row below carries that issuer. The two scans read the
// same grid by two different units.
//
// So the gap is general and is not about this filer: a fund banner this vendor
// wraps across two source lines of one container is invisible to the fund scan
// while the identical shape is visible to the issuer scan. The `whole[i]` gate
// exists for a real reason -- a `<BR>`-wrapped cell must not be read by its head
// or its tail (CSOP ETF Trust 2016, `SECURITY FUND AND LISTING ON THE HONG`) --
// but reading the cell JOINED is not reading a fragment of it. `peCellAt` already
// returns that join, `peFundName` already answers it (`BBH INTERNATIONAL EQUITY
// FUND`, true) and `icrResolveFundShared` already resolves it (S000015105).
//
// Fix location: the bare-heading scan, `layout_proxyedge.go:849` -- the unit it
// reads, not the vocabulary it reads with. No production code is changed here.
func TestFamilyNS1342947BBHSubadviserBannerWrappedInsideItsOwnCell(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const fixture = "bbh_trust_subadviser_banner.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns1342947_bbh_subadviser_banner", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || len(rows) != 4 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=4 error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	for _, r := range rows {
		// The fixture guard: the issuer is the cell of the SAME two-line shape as
		// the banner, and it is read. If this goes blank the cut is broken, not
		// the grammar -- and the asymmetry this test is about has gone with it.
		if r.IssuerName != "INDUSTRIA DE DISENO TEXTIL INDITEX SA" {
			t.Fatalf("fixture guard: the two-line issuer cell stopped being read: issuer=%q", r.IssuerName)
		}
		if r.FundName != "BBH INTERNATIONAL EQUITY FUND" || r.SeriesID != "S000015105" {
			t.Errorf("a fund banner the vendor hard-wrapped inside its own div was not read as the section's heading: fund=%q series=%q issuer=%q cusip=%q date=%q desc=%q want fund `BBH INTERNATIONAL EQUITY FUND`, the cell this filing prints at source lines 39729-39730, and series S000015105, which it declares at source lines 62-63",
				r.FundName, r.SeriesID, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription)
		}
	}
}
