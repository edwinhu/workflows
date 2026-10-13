package main

import (
	"path/filepath"
	"testing"
)

// 000089/890540/0001135428-09-000435.txt: verbatim line-range cuts of the
// source, in document order --
//
//	1-514        the SGML envelope carrying all THIRTY-ONE `<SERIES>`
//	             declarations (source lines 57-476, S000005803 through
//	             S000024083), the `<DOCUMENT>`/`<TEXT>` wrapper and the report's
//	             cover page;
//	7135-7186    the FIRST page of the `FROST HOOVER SMALL-MID CAP EQUITY FUND`
//	             section (banner at source line 7139);
//	9191-9243    the FIRST page of the `FROST MULTI CAP EQUITY FUND` section
//	             (banner at source line 9195);
//	10043-10680  the WHOLE `FROST SMALL-MID CAP EQUITY FUND` section, from its
//	             leading `<PAGE>` to the line before the `<PAGE>` that opens
//	             `FROST STRATEGIC BALANCED FUND` (source line 10681). Thirteen
//	             banner reprints, source lines 10047 through 10653;
//	22637-22640  the four closing lines, `</TEXT>` through the PEM trailer.
//
// Nothing is added and nothing is rewritten. THE ADVISORS' INNER CIRCLE FUND II,
// CIK 890540, period 20090630, dispatches to `pvtext` on both the real filing
// and this cut.
//
// WHAT THE REAL FILING MEASURES (HEAD, binary built from this tree, run with
// -series-map and -cik-series, and again with each flag dropped -- all three
// runs agree row for row, so nothing below depends on the overlay or the
// dictionary):
//
//	950 rows  PERIMETER SMALL CAP GROWTH FUND         -> S000013626
//	645 rows  FROST HOOVER SMALL-MID CAP EQUITY FUND  -> S000021633
//	570 rows  GRT VALUE FUND                          -> S000021911
//	555 rows  CLEAR RIVER(SM) FUND                    -> S000024083
//	320 rows  FROST DIVIDEND VALUE FUND               -> S000021631
//	267 rows  FROST MULTI CAP EQUITY FUND             -> S000021629
//	252 rows  FROST GROWTH EQUITY FUND                -> S000021627
//	213 rows  FROST SMALL-MID CAP EQUITY FUND         -> BLANK
//	122 rows  FROST KEMPNER DEEP VALUE FUND           -> S000021632
//	 91 rows  REAVES SELECT RESEARCH FUND             -> S000006467
//	 26 rows  FROST STRATEGIC BALANCED FUND           -> S000021745
//
// This vendor prints nearly every banner with one word of the declared name
// dropped, and the chain ALREADY READS ALL BUT ONE of them. `FROST GROWTH
// EQUITY FUND` reaches the declared `Frost Core Growth Equity Fund` with `Core`
// gone; `FROST MULTI CAP EQUITY FUND` reaches `Frost LKCM Multi-Cap Equity
// Fund` with `LKCM` gone; `FROST DIVIDEND VALUE FUND` reaches `Frost Dividend
// Value Equity Fund`; `FROST KEMPNER DEEP VALUE FUND` reaches `Frost Kempner
// Multi-Cap Deep Value Equity Fund` across a THREE-token gap. The rung that
// carries the single-drop cases is `issNearMissDecl` (layout_issnpx.go:7150),
// reached from `pvTextResolveAccount` (layout_pvtext.go:964) by way of
// `issResolveFund`; measured directly against an index built from this filing's
// own header, it answers S000021627, S000021629, S000021631 and S000021633, and
// nil for the banner below.
//
// THE ONE BLANK, AND WHY. `FROST SMALL-MID CAP EQUITY FUND` normalizes to
// [frost small mid cap equity fund], and this filing's own header declares TWO
// names that reach it by dropping exactly one interior token:
//
//	S000021630  Frost LKCM Small-Mid Cap Equity Fund     (drop `lkcm`)
//	S000021633  Frost Hoover Small-Mid Cap Equity Fund   (drop `hoover`)
//
// Both drops sit at position 1, so `issNearMissDecl`'s MML sibling-stem guard
// (the `j >= 2 && issStemHasSibling` test, layout_issnpx.go:7182) never fires;
// what refuses is the two-candidate test on the next line -- `hit != nil &&
// hit.SeriesID != d.SeriesID` -> nil. Measured: deleting S000021633 from the
// index resolves the banner to S000021630, and deleting S000021630 resolves it
// to S000021633. The refusal is exactly symmetric and, read off the header
// alone, correct: choosing either arm would be a coin flip between two of this
// registrant's sleeves. The corpus dictionary cannot break the tie either --
// CIK 890540's 42 dictionary rows carry no Frost name at any vintage, the family
// having left this trust before the dictionary's earliest Frost-era period, so
// the candidate pool IS this filing's 31 header declarations and nothing else.
//
// WHAT THE DOCUMENT'S OWN BYTES SETTLE, THAT THE HEADER ALONE DOES NOT. Two
// independent readings of this filing's other banners both name S000021630, and
// neither is a guess about spelling:
//
//  1. ELIMINATION. S000021633 is claimed EXACTLY, token for token, by its own
//     banner `FROST HOOVER SMALL-MID CAP EQUITY FUND` (source line 7139, 645
//     rows in the real filing, 22 in this cut) -- an exact declared-name hit,
//     not a tolerance. Of the ambiguity's two arms one is already spoken for by
//     a banner that spells it in full, leaving exactly one seat, which is the
//     arithmetic `issResidualEliminate` already keeps for family NS-1019946 and
//     the elimination the NS-891944 subsequence rung turns on.
//  2. THE VENDOR'S OWN DROP. `LKCM` is the one word this document is observed
//     dropping: `FROST MULTI CAP EQUITY FUND` (source line 9195, 267 rows real,
//     13 in this cut) is `Frost LKCM Multi-Cap Equity Fund` with `LKCM` gone,
//     and it resolves unambiguously because no second declaration collides
//     there. The sibling brand words this filing does NOT drop -- `Hoover`,
//     `Kempner` -- it prints. So the missing token here is the same token the
//     same vendor dropped from the same brand's other sleeve.
//
// Both readings need the SET OF BANNERS IN THE DOCUMENT, which `issNearMissDecl`
// never sees: it is asked one banner at a time and knows only the header. That
// is why no narrowing of the existing rung reaches this, and why the htmltable
// peers -- `htmlDroppedWordDeclaredName` and `htmlSubsequenceDeclaredName`
// (layout_htmltable.go, families NS-1040674 and NS-891944) -- are the wrong
// shape as well as the wrong layout: both are also per-banner, and both would
// refuse this pair on their own ambiguity guards for the same reason.
//
// OUT OF SCOPE, DELIBERATELY. The real filing also prints `HANCOCK VALUE FUND`
// (27 banner reprints) and it resolves to nothing. It is NOT in this test, for
// two separate reasons. First, it is unresolvable on the evidence: no declared
// name of this filing admits [hancock value fund] as an in-order subsequence
// (`GRT Value Fund` shares only `value` and `fund`, and `Hancock Horizon ...`
// carries no `value`), so it is a floor candidate, not a defect. Second, it
// costs no rows: every HANCOCK banner section of this filing -- VALUE, GROWTH,
// BURKENROAD, DIVERSIFIED INTERNATIONAL, QUANTITATIVE LONG/SHORT -- yields ZERO
// rows on HEAD, as do the CHAMPLAIN, ABERDEEN and SMARTGROWTH sections, so
// whether their banners resolve is moot until those tables are read at all. That
// is a separate unread-vote-table defect and this cut does not carry it. The
// four Hancock banners the brief for this family listed as blank are in fact
// already resolved by `issNearMissDecl` off the header -- `HANCOCK GROWTH FUND`
// -> S000006461, `HANCOCK BURKENROAD FUND` -> S000006464, `HANCOCK DIVERSIFIED
// INTERNATIONAL FUND` -> S000023555, `HANCOCK QUANTITATIVE LONG/SHORT FUND` ->
// S000023556 -- measured against an index built from this filing's own header;
// they would cost nothing even if their sections were read.
//
// WHAT THIS CUT MEASURES: 248 rows. 22 carry S000021633 and 13 carry
// S000021629, both preconditions below. The remaining 213 are the real filing's
// ENTIRE in-scope no-series residue for this CIK, preserved row for row, and
// every one of them is asserted to S000021630.
func TestFamilyNS890540PVTextDroppedBrandWordAmbiguity(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const (
		dir     = "family_ns890540_pvtext_dropped_brand_word_ambiguity"
		fixture = "frost_small_mid_cap_equity_2009.txt"

		blankBanner = "FROST SMALL-MID CAP EQUITY FUND"
		wantSeries  = "S000021630" // Frost LKCM Small-Mid Cap Equity Fund

		hooverBanner = "FROST HOOVER SMALL-MID CAP EQUITY FUND"
		hooverSeries = "S000021633"
		multiBanner  = "FROST MULTI CAP EQUITY FUND"
		multiSeries  = "S000021629"
	)

	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.CIK != "0000890540" || len(meta.SeriesDecls) != 31 {
		t.Fatalf("fixture precondition: cik=%q series declarations=%d, want CIK 0000890540 declaring 31 series (source lines 57-476) -- the cut lost part of the SERIES-AND-CLASSES-CONTRACTS-DATA block, and the ambiguity below is measured against the header's candidate set",
			meta.CIK, len(meta.SeriesDecls))
	}
	if meta.Layout != "pvtext" {
		t.Fatalf("fixture guard: the cut dispatched to %q, not `pvtext` -- the real filing dispatches to `pvtext`, so the defect below is no longer being measured on the same code path",
			meta.Layout)
	}
	if len(rows) == 0 {
		t.Fatalf("fixture guard: no rows read out of the cut at all")
	}

	byBanner := map[string]map[string]int{}
	for _, r := range rows {
		if byBanner[r.FundName] == nil {
			byBanner[r.FundName] = map[string]int{}
		}
		byBanner[r.FundName][r.SeriesID]++
	}

	// Preconditions, not the claim. The first is the ELIMINATION the assertion
	// below rests on: S000021633 is claimed by a banner that spells its declared
	// name in full, which is what leaves S000021630 as the only seat the
	// shortened banner can take. The second is the VENDOR'S OWN DROP: the same
	// document drops `LKCM` from this brand's other sleeve and that banner
	// resolves, so the missing token here is a known decoration of this filing,
	// not an unexplained gap. If either stops holding, the reasoning above is
	// stale and the row assertion is measuring something else.
	for _, want := range []struct {
		banner, series string
		n              int
		why            string
	}{
		{hooverBanner, hooverSeries, 22, "the ambiguity's other arm is claimed EXACTLY by its own banner (source line 7139), which is the elimination the assertion below rests on"},
		{multiBanner, multiSeries, 13, "this document drops `LKCM` from the sibling sleeve too (source line 9195) and that banner resolves, so the dropped token is this vendor's own decoration"},
	} {
		got := byBanner[want.banner]
		if got[want.series] != want.n || len(got) != 1 {
			t.Fatalf("precondition: banner %q resolved %v, want exactly %d rows all carrying %s -- %s",
				want.banner, got, want.n, want.series, want.why)
		}
	}

	seen := byBanner[blankBanner]
	if len(seen) == 0 {
		t.Fatalf("fixture guard: not one row was read under the banner %q, so the 213-row residue this test exists to measure is absent from the cut -- the section at source lines 10043-10680 is no longer being read",
			blankBanner)
	}

	inSection, bad := 0, 0
	for i, r := range rows {
		if r.FundName != blankBanner {
			continue
		}
		inSection++
		if r.SeriesID == wantSeries {
			continue
		}
		bad++
		if bad <= 5 {
			t.Errorf("row %d under %q carries series %q, want %s (`Frost LKCM Small-Mid Cap Equity Fund`, declared in this filing's own header at source line 286): issuer=%q cusip=%q date=%q desc=%q",
				i, r.FundName, r.SeriesID, wantSeries,
				r.IssuerName, r.CUSIP, r.MeetingDate, truncate(r.VoteDescription, 60))
		}
	}
	if bad > 0 {
		t.Errorf("%d of the %d rows read under %q carry the wrong series (distribution %v, want all %s). `issNearMissDecl` (layout_issnpx.go:7150) refuses the banner at its two-candidate test (layout_issnpx.go:7185) because this filing's header declares BOTH `Frost LKCM Small-Mid Cap Equity Fund` (S000021630) and `Frost Hoover Small-Mid Cap Equity Fund` (S000021633), each one interior token longer, and the header alone cannot say which. The document can: S000021633 is already claimed by its own exactly-spelled banner (%d rows above), and `LKCM` is the token this same vendor drops from this brand's other sleeve (%d rows above). On the real filing this is 213 of 4,011 rows and the CIK's entire in-scope no-series residue",
			bad, inSection, blankBanner, seen, wantSeries,
			byBanner[hooverBanner][hooverSeries], byBanner[multiBanner][multiSeries])
	}
}
