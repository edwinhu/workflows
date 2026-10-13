package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 000079/790558/0000950135-06-005380.txt: verbatim source lines 10-66 (the SGML
// header down to `<TEXT>`, carrying the ONE `<SERIES>` declaration this fixture
// needs, S000004105) and 11582-11627 (the fund banner and the two issuer blocks
// printed directly under it). Every byte is a line-range cut of the source; the
// two closing lines `</TEXT>` and `</DOCUMENT>` are the only added ones, and
// they close markup the cut opened.
//
// HARTFORD HLS SERIES FUND II INC, CIK 790558, period 20060630. The real filing
// dispatches to `splittable`. Measured on the current binary, 936 of its rows
// carry a BLANK series_id, all of them inside the one undifferentiated section
// that runs from source line 11582 to the next banner, `HARTFORD LARGECAP
// GROWTH HLS FUND`, at source line 14444.
//
// THE GRAMMAR. The section opens with a bare centred banner line -- source line
// 11584, `HARTFORD INTL STOCK HLS FUND`, `INTL` abbreviating the
// `HARTFORD INTERNATIONAL STOCK HLS FUND` the header declares as S000004105 at
// source lines 54-55 -- and under it the vendor prints issuer blocks back to
// back, each one a bare issuer heading, a `Ticker:`/`Security ID:` pair, a
// `Meeting Date:`/`Meeting Type:` pair, a `Record Date:` and then a `<TABLE>`
// headed `#  Proposal  Mgt Rec  Vote Cast  Sponsor`. Blocks are parted by a
// `- ----` rule and THE BANNER IS NOT REPRINTED between them, so every block of
// the section depends on that one line for its fund.
//
// WHAT ACTUALLY HAPPENS -- measured on this cut through `parseSplitTableRaw`:
// eight rows, every one of them with series_id, fund_name and issuer all blank.
//
// WHY -- and it is NOT the abbreviation matcher. The precondition below asserts
// it directly: `spIndex.resolve("HARTFORD INTL STOCK HLS FUND")` returns
// S000004105 on this filing's own header, so `issAbbrevWordDecl`
// (`layout_issnpx.go:7026`, whose doc comment gives `Intl` inside
// `International` as its worked example) reads this banner correctly the moment
// it is handed one. It never is.
//
// In the tagged-`<TABLE>` path of `parseSplitTableRaw` the banner is read by
// `spReadContext` (`layout_splittable.go:1120`), which recognises no
// `LABEL: VALUE` pair on it and so returns it as the caller's `lastBare` and
// nothing more. `lastBare` is a single slot: the very next bare line --
// `ALLIANZ AG (FORMERLY ALLIANZ HOLDING AG)`, the issuer heading -- overwrites
// it. By the time `<TABLE>` arrives, `layout_splittable.go:341` copies that
// ISSUER into `groupCtx.bare`, and the banner is gone.
//
// `spBannerFund` (`layout_splittable.go:782`) is the only function that puts a
// banner through the shared chain, and it is called from exactly one place,
// `layout_splittable.go:634`, inside `spInstitutionalPreRows` -- the untagged
// `<PRE>` path this filing never reaches, because it opens real `<TABLE>` tags.
// So the tagged path sets `ctx.bareFund` nowhere, and `spGroupRows`
// (`layout_splittable.go:1730`) adopts `ctx.bare` only when `ctx.bareFund ||
// spIsSECFormGroup(group)`. This group's header key column is `#`, not the
// issuer of a portfolio security, so `spIsSECFormGroup` is false as well. The
// fund is dropped twice over and the rows carry none.
//
// Fix location: the between-tables arm of `parseSplitTableRaw`,
// `layout_splittable.go:350-399`, which must put a bare line through
// `spBannerFund` and record the result as a fund banner (`bare` + `bareFund`)
// that a following bare issuer heading does not clobber.
//
// FIXTURE LIMIT, stated so a later reader does not mistake it for the defect.
// This test calls `parseSplitTableRaw` directly rather than going through
// `processFile`, because a 46-line cut of this filing does NOT dispatch to
// `splittable`: `matchSplitTable` returns false on it and `matchISSNPX` returns
// true, so `processFile` hands the cut to `issnpx`, which reads all seven votes
// correctly and resolves them to S000004105. On the real filing `issnpx` is
// tried first, declines, and `splittable` claims the body -- and what makes it
// decline lives in the ~11,500 source lines ahead of this banner, which are not
// in this cut. Reproducing that would mean inventing bytes. The defect itself
// does not depend on them: it is entirely inside the function asserted below,
// which is the same function the dispatcher calls on the real filing.
func TestFamilyNS790558IntlStockAbbrev(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const fixture = "hartford_intl_stock_abbrev.txt"
	const banner = "HARTFORD INTL STOCK HLS FUND"

	raw, err := os.ReadFile(
		filepath.Join("testdata", "family_ns790558_intl_stock_abbrev", fixture))
	if err != nil {
		t.Fatalf("fixture precondition: %v", err)
	}
	meta := parseHeader(raw)
	if meta.CIK != "0000790558" || len(meta.SeriesDecls) != 1 ||
		meta.SeriesDecls[0].SeriesID != "S000004105" {
		t.Fatalf("fixture precondition: cik=%q decls=%+v want CIK 0000790558 declaring S000004105",
			meta.CIK, meta.SeriesDecls)
	}

	// The abbreviation rung is reachable and correct. If this ever fails, the
	// defect asserted below has moved into the matcher and the diagnosis above is
	// stale -- it is not a regression in the banner geometry.
	if id := spSeriesIndex(meta).resolve(banner); id != "S000004105" {
		t.Fatalf("precondition: the shared chain no longer reads %q as S000004105, it returns %q -- the banner text itself is now the problem, not the fact that the splittable layout never hands it over",
			banner, id)
	}

	rows, perr := parseSplitTableRaw(raw, string(raw), meta)
	if perr != nil {
		t.Fatalf("fixture guard: the splittable layout declined the cut: %v", perr)
	}
	// The cut holds exactly two issuer blocks -- ALLIANZ AG at source line 11586
	// and ASSICURAZIONI GENERALI SPA at source line 11610 -- and nothing else, so
	// every row read out of it belongs to one of them and asserting over all rows
	// asserts over both blocks.
	if len(rows) == 0 {
		t.Fatalf("fixture guard: the splittable layout read no rows out of the two issuer blocks")
	}

	blank := 0
	for i, r := range rows {
		if r.SeriesID == "S000004105" && r.FundName == banner {
			continue
		}
		blank++
		t.Errorf("row %d of the section under the banner carries no fund: series=%q fund=%q issuer=%q cusip=%q date=%q desc=%q want S000004105 / %q, the banner this filing prints at source line 11584 and declares as `HARTFORD INTERNATIONAL STOCK HLS FUND` at source lines 54-55",
			i, r.SeriesID, r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, banner)
	}
	if blank > 0 {
		t.Errorf("%d of %d rows across BOTH issuer blocks lost the fund: the banner reaches `spReadContext` only as `lastBare` and the issuer heading one line below it overwrites that slot before `layout_splittable.go:341` copies it into `groupCtx.bare`, so `spBannerFund` is never called on it at all",
			blank, len(rows))
	}
}
