package main

import (
	"path/filepath"
	"strings"
	"testing"
)

const ns837274FranklinRenameDir = "family_ns837274_franklin_allocation_rename_banner"

// ns837274FranklinRenameDispatch runs the real dispatch on this family's fixture
// under PRODUCTION resolution -- the corpus dictionary and the series overlay are
// left exactly as the binary holds them, not nilled out, so the series ids
// asserted below are whatever production would emit for this file. The filing's
// own <SERIES-AND-CLASSES-CONTRACTS-DATA> header dictionary is read by
// processFile regardless and is separate from either overlay. Same mechanism as
// ns1261788MicroCapDispatch, pointed at its own testdata dir.
func ns837274FranklinRenameDispatch(t *testing.T, fixture, layout string) (FilingMeta, []VoteRow) {
	t.Helper()
	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns837274FranklinRenameDir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s want status=ok layout=%s error=%s", meta.ParseStatus, meta.Layout, layout, meta.ErrorMsg)
	}
	return meta, rows
}

// FRANKLIN TEMPLETON VARIABLE INSURANCE PRODUCTS TRUST, CIK 837274, period
// 20190630, filing 000083/837274/0001137439-19-000407.txt (`htmltable`). The
// registrant declares many series in its own SEC header, two of which matter
// here: S000017299 `Franklin Allocation VIP Fund` (real source lines 304-312,
// fixture lines 302-312) and S000007312 `Franklin Flex Cap Growth VIP Fund`
// (real 50-51, fixture 50-51).
//
// THE FILING'S SHAPE. Sections are opened by a free-standing <p> carrying a
// bare `FTVIPT - <fund name>` banner, followed by one <table> per issuer
// meeting. The FIRST banner, real source line 489 (fixture line 489), has a
// rename annotation welded onto it inside a separate <i> tag:
//
//	<p class="MsoNormal"><font …>FTVIPT - Franklin Allocation VIP Fund -<i>Named
//	changed from Franklin Founding Funds Allocation VIP Fund effective 5/1/19</i></font></p>
//
// After tag stripping that is ONE line whose text is
// `FTVIPT - Franklin Allocation VIP Fund -Named changed from Franklin Founding
// Funds Allocation VIP Fund effective 5/1/19` -- the annotation glued on with a
// bare hyphen and no space, because the <i> element carries no whitespace of its
// own. The SECOND banner, real 6166 (fixture 641), is the same shape with no
// annotation: `FTVIPT - Franklin Flex Cap Growth VIP Fund`.
//
// MEASURED ON HEAD over the whole real accession, with the production binary
// (bin/parse_npx_go_411, -series-map series_map_applied.tsv -cik-series
// cik_series.tsv): status=ok, 13593 rows emitted, of which
//
//	283 rows  series_id="" AND fund_name=""   (every blank row in the filing)
//
// Those 283 are exactly and only the rows of the FIRST section -- everything
// between the annotated banner at real 489 and the next banner at real 6166.
// Confirmed on the real bytes that no OTHER masthead of any kind stands in that
// span: the 20 issuer tables there (ALTABA INC., BNP PARIBAS SA, ROYAL DUTCH
// SHELL PLC, COMPAGNIE DE SAINT-GOBAIN SA, LANDIS+GYR GROUP AG, TOTAL SA, NXP
// SEMICONDUCTORS NV, LYONDELLBASELL INDUSTRIES N.V., HIKMA PHARMACEUTICALS PLC,
// KEYWORDS STUDIOS PLC, BOOHOO GROUP PLC, INTERXION HOLDING NV, SINOPHARM GROUP
// CO. LTD., CHINA MOBILE LIMITED, TEVA PHARMACEUTICAL INDUSTRIES LIMITED,
// GERRESHEIMER AG, VMWARE INC., WABCO HOLDINGS INC., CENTENE CORPORATION,
// DSV A/S) are separated from one another only by hidden spacer paragraphs
// (`<p class="MsoNormal"><font …;display:none;mso-hide:all">&#160;</font></p>`),
// so the annotated banner is the sole section-opening candidate for all 283.
//
// THE DEFECT. The htmltable layout's bare-fund-banner reader requires the banner
// text to resolve against the series index; the appended rename annotation makes
// the line fail to resolve, so the banner opens NO section at all. Every row
// until the next banner falls through with blank fund_name AND blank series_id.
// This is not a mis-attribution (contrast family_ns1261788, where a prose
// sentence was READ as a masthead and stamped the wrong id) -- here nothing is
// stamped at all, and the filing's own header declares the exact name that
// stands inside the banner.
//
// The SECOND banner already resolves correctly on HEAD, which is why the
// regression guard below asserts it: a fix that reaches the first banner by
// loosening the resolver must not disturb the sections that already work, and
// must not blank-fill or fan out across the registrant's many declared series.
//
// FIXTURE PROVENANCE. franklin_templeton_vip_allocation_rename_2019.txt is real
// SEC EDGAR bytes, accession 0001137439-19-000407, CIK 837274, period 20190630,
// verbatim and in file order, trimmed to whole <p>/<tr>/<table> units. The
// ranges kept, by real source line:
//
//	1-488        <SEC-DOCUMENT>, the SEC-HEADER in FULL with EVERY series
//	             declaration verbatim and unrenumbered (header ends real 333),
//	             <DOCUMENT>/<TEXT>/<html>/<head>/<body>, the cover table through
//	             its `Item 1. Proxy Voting Records.` heading (real 482), that
//	             table's `</table>` (486) and the two spacer <p> after it
//	489-563      the FIRST, annotated banner and the COMPLETE ALTABA INC. table
//	             (both its items, 1 `Approve Plan of Liquidation` and 2
//	             `Adjourn Meeting`) through its own `</table>`
//	564-636      the hidden spacer <p>, the BNP PARIBAS SA table open, its column
//	             header rows, and its first TWO data rows (items 1 and 2) through
//	             the second row's `</tr>`
//	909-910      that same table's own real closing bytes (blank line, `</table>`)
//	6164-6238    the page-break <font><br> pair, the SECOND banner (real 6166),
//	             its table open, its column header rows, and its first TWO data
//	             rows -- ADOBE INC. items 1a `Elect Director Amy L. Banse` and
//	             1b `Elect Director Frank A. Calderoni` -- through the second
//	             row's `</tr>`
//	6460-6461    that table's own real closing bytes (blank line, `</table>`)
//	278671-278675 `</body></html></TEXT></DOCUMENT></SEC-DOCUMENT>`
//
// No row was fabricated, edited or reworded; no series declaration was dropped
// or renumbered.
//
// The fixture reproduces the real accession's behaviour proportionally --
// status=ok layout=htmltable rows=6, of which the four rows under the first
// banner carry series="" fund="" and the two under the second resolve to
// S000007312, exactly as the real file does at scale.
//
// No production code is changed here.
func TestFamilyNS837274FranklinAllocationRenameBanner(t *testing.T) {
	_, rows := ns837274FranklinRenameDispatch(t, "franklin_templeton_vip_allocation_rename_2019.txt", "htmltable")

	const (
		allocation  = "S000017299" // Franklin Allocation VIP Fund
		flexCap     = "S000007312" // Franklin Flex Cap Growth VIP Fund
		allocName   = "Franklin Allocation VIP Fund"
		annotation  = "Named changed from Franklin Founding Funds Allocation VIP Fund"
		firstIssuer = "ALTABA INC."
		secondIssue = "BNP PARIBAS SA"
		thirdIssuer = "ADOBE INC."
	)

	if len(rows) != 6 {
		t.Fatalf("fixture precondition: %d rows, want 6 (two ALTABA INC. rows and two BNP PARIBAS SA rows under the first banner, two ADOBE INC. rows under the second)", len(rows))
	}

	// The claim. Every row under the FIRST banner belongs to S000017299, the
	// series the filing's own header declares at fixture lines 302-312 under the
	// exact name that stands inside that banner.
	var firstSection, secondSection int
	for i, r := range rows {
		switch r.IssuerName {
		case firstIssuer, secondIssue:
			firstSection++
			if r.SeriesID != allocation {
				t.Errorf("row %d (%s item=%q cusip=%q date=%q): series=%q fund=%q want %s -- this row is under the FIRST banner at fixture line 489, `FTVIPT - Franklin Allocation VIP Fund -<i>Named changed from Franklin Founding Funds Allocation VIP Fund effective 5/1/19</i>`, whose rename annotation (bare hyphen, no space, from a separate <i> tag) makes the bare-fund-banner reader fail to resolve the line, so the banner opens no section and the row falls through blank; the filing declares `Franklin Allocation VIP Fund` = %s in its own SEC header at fixture lines 302-312",
					i, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, allocation, allocation)
			}
			if !strings.Contains(r.FundName, allocName) {
				t.Errorf("row %d (%s item=%q): fund_name=%q does not contain %q -- the banner names the fund plainly before the annotation begins",
					i, r.IssuerName, r.ItemSeq, r.FundName, allocName)
			}
			if strings.Contains(r.FundName, annotation) {
				t.Errorf("row %d (%s item=%q): fund_name=%q carries the RENAME ANNOTATION -- the trailing `-Named changed from … effective 5/1/19` is editorial prose from a sibling <i> tag, not part of the fund's name, and must not be stored as one",
					i, r.IssuerName, r.ItemSeq, r.FundName)
			}
		case thirdIssuer:
			secondSection++
			// Regression guard. This section's banner (fixture line 641, real
			// 6166) carries no annotation and already resolves on HEAD. A fix
			// that recovers the first banner by loosening resolution must not
			// disturb it, blank-fill it, or fan it out over the registrant's
			// other declared series.
			if r.SeriesID != flexCap {
				t.Errorf("row %d (%s item=%q cusip=%q date=%q): series=%q fund=%q want %s -- the SECOND banner `FTVIPT - Franklin Flex Cap Growth VIP Fund` (fixture line 641) already resolves correctly on HEAD and must stay resolved",
					i, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, flexCap)
			}
		default:
			t.Errorf("row %d: unexpected issuer %q -- this fixture carries only the %s and %s blocks (first banner) and the %s block (second banner)", i, r.IssuerName, firstIssuer, secondIssue, thirdIssuer)
		}
	}
	if firstSection != 4 || secondSection != 2 {
		t.Errorf("fixture precondition: first banner's section emitted %d rows and the second's %d, want 4 and 2", firstSection, secondSection)
	}

	// Regression guard, part two. Issuer, cusip, meeting date and item numbering
	// all read correctly on HEAD -- only fund_name and series are wrong. A fix
	// that recovers the series by disturbing any of these has traded one defect
	// for another.
	want := []struct {
		issuer, cusip, date, item string
	}{
		{firstIssuer, "021346101", "20190627", "1"},
		{firstIssuer, "021346101", "20190627", "2"},
		{secondIssue, "F1058Q238", "20190523", "1"},
		{secondIssue, "F1058Q238", "20190523", "2"},
		{thirdIssuer, "00724F101", "20190411", "1a"},
		{thirdIssuer, "00724F101", "20190411", "1b"},
	}
	for i, w := range want {
		r := rows[i]
		if r.IssuerName != w.issuer || r.CUSIP != w.cusip || r.MeetingDate != w.date || r.ItemSeq != w.item {
			t.Errorf("row %d regressed: issuer=%q cusip=%q date=%q item=%q want issuer=%q cusip=%s date=%s item=%s",
				i, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, w.issuer, w.cusip, w.date, w.item)
		}
	}
}
