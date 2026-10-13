package main

import (
	"path/filepath"
	"testing"
)

// 000091/914036/0001193125-22-231315.txt: verbatim source lines 1-52 (the SGML
// header down to `<EXISTING-SERIES-AND-CLASSES-CONTRACTS>`), 183-208 (the TWO
// `<SERIES>` declarations this fixture needs -- S000002813 is the fund under
// test, S000002815 is present only so the single-declared-series fallback does
// not fill `series_id` behind the defect), 1503-1511 (the header's close and
// `<TEXT>`), 41399-41495 (the fund banner's own page and the inline page after
// it) and 43218-43295 (the UNBANNERED page and the inline page after it). Every
// byte is a line-range cut of the source; the three closing lines ` </DIV>`,
// `</TEXT>` and `</DOCUMENT>` are the only added ones, and they close markup the
// cut opened.
//
// LINCOLN VARIABLE INSURANCE PRODUCTS TRUST, CIK 914036, period 20220630,
// dispatched `splittable` (the precondition below re-asserts it on the cut).
//
// THE GRAMMAR. The filing is the SEC's own Form N-PX template printed as
// fixed-width text inside `<PRE>`, one page per `<PRE>`, one section per fund.
// A section opens with a bare banner line naming the fund -- source line 41403,
// `LVIP Blended Large Cap Growth Managed Volatility Fund`, declared S000002813
// at source lines 185-186 -- above the stacked column header, and every page
// after it in the section prints ballots with no banner of its own.
//
// TWICE in this filing a mid-section page REPRINTS the stacked column header
// with no banner above it. Source lines 43220-43227 are the first:
//
//	<PRE>
//	(three blank lines)
//	                   Exchange                                                     Who Proposed
//	Issuer of          Ticker               Shareholder   Summary of Matter Voted  Matter: Issuer /  Whether Fund Cast
//	Portfolio Security Symbol     CUSIP #   Meeting Date            On               Shareholder      Vote on Matter
//	------------------ --------  ---------- ------------  ------------------------ ----------------  -----------------
//	Healthcare Trust                                      Elect Director Scott D.
//	of America, Inc.     HTA     42225P501   07-Jul-21    Peters                     Management            Yes
//
// The fund name is ABSENT FROM THE BYTES there -- lines 43221, 43222 and 43223
// are empty, and the page's first printed line is the header's own `Exchange` /
// `Who Proposed` run. The second such page is source lines 50213-50220.
//
// WHOSE BALLOTS THEY ARE, proved from the document and not guessed. The filing
// declares 114 series in its SGML header. Every one of the 114 is printed as a
// banner, each EXACTLY ONCE, and the 114 banners appear in strictly increasing
// alphabetical order with no banner that is not a declared series. So no series
// is left over for an unbannered block to belong to, and the block at source
// lines 43220-47375 falls inside the section opened by the banner at 41403 and
// closed by the next banner, `LVIP Blended Mid Cap Managed Volatility Fund`, at
// 47381. The second unbannered block, 50213-57398, falls the same way inside the
// Blended Mid Cap section. These are continuation pages of an open fund whose
// printer simply omitted the banner, not tables of an unnamed fund.
//
// WHAT ACTUALLY HAPPENS -- measured on this cut through the real dispatch: 38
// rows. The 22 rows of the banner's own two pages carry S000002813 and the fund
// name. The 16 rows read after the unbannered page carry BOTH FIELDS BLANK: no
// series id and no fund name, i.e. no fund identity at all.
//
// WHY. `spInstitutionalPreRows` sets the fund from the current page's banner
// whenever a banner-named header block's rule arrives (`layout_splittable.go:
// 608-615`):
//
//	ctx.bare = spBannerFund(pageBare, seriesIdx, resolved)
//	ctx.bareFund = ctx.bare != ""
//
// `pageBare` is cleared at every markup line (`layout_splittable.go:594`), so on
// a page that opens with the header itself it is empty when the rule is read,
// and the assignment is UNCONDITIONAL: the open fund is cleared rather than
// carried, for this page and every page after it until the next banner. The
// comment there defends the unconditional set on the ground that a headed page
// with no banner is a fund the template never named -- which this filing's own
// series accounting disproves for this shape.
//
// SCOPE. Whole filing, current binary, run with `-cik-series` and `-series-map`:
// 188,400 rows, of which 3,424 have both `series_id` and `fund_name` blank --
// 1,316 immediately after the 535 rows of Blended Large Cap Growth and 2,108
// immediately after the 790 rows of Blended Mid Cap. Those two runs are the
// filing's entire both-blank residue and are exactly the two unbannered pages.
//
// Fix location: the banner arm of `spInstitutionalPreRows`,
// `layout_splittable.go:605-616`.
func TestFamilyNS60LincolnUnbanneredHeaderPage(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const fixture = "lincoln_unbannered_header_page_2022.txt"
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture,
		filepath.Join("testdata", "family_ns60_lincoln_unbannered_page", fixture),
		sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "splittable" || len(rows) != 38 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/splittable/38 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	const (
		wantSeries = "S000002813"
		wantFund   = "LVIP Blended Large Cap Growth Managed Volatility Fund"
	)
	banner, after := 0, 0
	for _, r := range rows {
		switch r.IssuerName {
		case "ABIOMED, Inc.", "Adobe Inc.", "Advanced Micro Devices, Inc.":
			// The banner's own two pages, which resolve today. They guard the
			// fixture: the banner at source line 41403 is what gives them
			// S000002813, so if these go blank the cut is broken, not the grammar.
			banner++
			if r.SeriesID != wantSeries || r.FundName != wantFund {
				t.Fatalf("fixture guard: the banner's own pages stopped resolving: issuer=%q series=%q fund=%q",
					r.IssuerName, r.SeriesID, r.FundName)
			}
		case "Healthcare Trust of America, Inc.", "VMware, Inc.", "AMERCO":
			after++
			if r.SeriesID != wantSeries || r.FundName != wantFund {
				t.Errorf("the page that reprints the stacked column header with no banner above it (source lines 43220-43227, three blank lines where the fund name would print) clears the open fund instead of carrying it: issuer=%q cusip=%q date=%q desc=%q how_voted=%q series=%q fund=%q want %s / %q -- the banner this filing prints at source line 41403 and declares at source lines 185-186, the section these ballots fall inside",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.HowVoted,
					r.SeriesID, r.FundName, wantSeries, wantFund)
			}
		default:
			t.Fatalf("fixture guard: unexpected issuer %q", r.IssuerName)
		}
	}
	if banner != 22 || after != 16 {
		t.Fatalf("fixture guard: read %d rows of the banner's pages and %d after the unbannered page, want 22 and 16",
			banner, after)
	}
}
