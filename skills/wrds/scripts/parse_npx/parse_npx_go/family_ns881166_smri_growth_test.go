package main

import (
	"os"
	"path/filepath"
	"testing"
)

// ns881166Dispatch runs the real dispatch on a family NS881166 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// vote-table banner and its series id, never a broken fixture. Same mechanism as
// ns1355064Dispatch in family_ns1355064_groesbeck_slash_test.go, pointed at its
// own testdata dir.
func ns881166Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns881166_smri_growth", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns881166_smri_growth", fixture), sink, make([]byte, headBytes))
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

// CIK 0000881166 (SM&R Investments, Inc.) files 000088/881166/0000881166-07-000015.txt
// (period 20070630, 130,996 lines) as ONE Excel-exported `<table>` -- the file
// carries a single `<table` at source line 540 and its `</table>` at 130990 --
// inside which each fund's vote record is opened by a bare banner cell. Measured
// with the tracked binary parse_npx_go_355 over the real bytes, -cik-series and
// -series-map both pointed at the real /scratch/nyu/eddyhu/npx-reconcile-corpus
// dictionaries, the filing yields 5,940 rows on layout htmltable, which attribute
// as:
//
//	source line  banner as printed                    rows  series_id
//	        719  SMRI GROWTH PORTFOLIO                1147  BLANK (fund_name blank too)
//	      22160  SMRI EQUITY INCOME PORTFOLIO         2639  S000010239
//	      77354  SM & R ALGER\nAGGRESSIVE GROWTH FUND   725  S000010237
//	      95161  SM & R ALGER GROWTH\nFUND              700  S000010245
//	     111018  SM & R ALGER SMALL-CAP FUND            413  S000010246
//	     123085  SM & R ALGER TECHNOLOGY FUND           316  S000010238
//
// The 1,147 blanks are the whole SMRI GROWTH PORTFOLIO block and nothing else,
// and they carry a BLANK fund_name as well: the banner is never adopted, because
// htmltable's heading branch (layout_htmltable.go, `if ok { curFund, curSeries,
// ... = name, id, ... }`) adopts a heading only when htmlBareFundLine RESOLVES
// it, so a refused banner leaves the still-blank fund standing. The filing's own
// SEC-HEADER declares eleven series for this CIK, S000010236 `SM&R Growth Fund`
// through S000010246 `SM&R Alger Small Cap Fund`, and this block is S000010236.
//
// The markup is NOT the barrier. The refused banner and the resolving one sit in
// the same shape, one merged cell in a row of empties, differing only in the
// Excel style class:
//
//	<td colspan=24 class=xl45>SMRI GROWTH PORTFOLIO</td>          (line 719)
//	<td colspan=24 class=xl47>SMRI EQUITY INCOME PORTFOLIO</td>   (line 22160)
//
// and the resolver refuses the first when handed it directly.
//
// The COLLISION with the sibling S000010245 `SM&R Alger Growth Fund` is not the
// barrier either, and this is measured rather than argued: before the fix,
// rebuilding this filing's index from its own declarations with S000010245
// REMOVED still refused `SMRI GROWTH PORTFOLIO`; after it, that same index
// resolves the heading to S000010236 exactly as the full one does. The sibling
// is irrelevant to the outcome in both directions, which is what the assertion
// below now pins -- nothing about the Alger sleeve is what loses the block.
//
// What refuses it is one asymmetry in issBrandCompactedDecl
// (layout_issnpx.go:4646), which is already the rung that resolves this
// registrant's compacted brand -- traced on the real declarations,
// `SMRI GROWTH` and `SMRI GROWTH FUND` both reach S000010236 through it, so the
// `SMRI` -> `SM&R` compaction is understood. Its comparison at the tail drops the
// trailing type word from the DECLARED side only:
//
//	stem := issCutCompactedBrand("sm and r growth fund", "smri")  // "growth fund"
//	rest := "growth portfolio"                                    // the heading, as printed
//	stem != rest, and issDropTypeWord(stem) == "growth" != rest   // refused
//
// so a heading that carries a type word OF ITS OWN can never match: the rung
// tolerates the heading dropping `Fund`, never the heading printing `Portfolio`
// in its place. `SMRI EQUITY INCOME PORTFOLIO` is not evidence against this --
// it does not reach this rung at all. It resolves several rungs earlier, at
// issDistinctiveTokenDecl (layout_issnpx.go:4376), on the registrant's own
// vocabulary: `equity`/`income` are distinctive across the eleven declarations
// where `growth` is a word of three of them, so the vocabulary rung answers for
// one banner and cannot for the other. Both facts were traced, not inferred.
//
// The tier-word substitution is licensed here for the reason issTierMismatch
// already encodes: no declared series of this registrant is typed `Portfolio`,
// so `PORTFOLIO` is the vendor's word for `Fund` and not a second registered
// tier. With the type word dropped on BOTH sides the answer stays unique --
// under lead `smri`, S000010236's stem is `growth`, while S000010245's is
// `alger growth` and S000010237's is `alger aggressive growth`, neither of which
// the heading spells -- which is why the assertion below pairs the fix with the
// sibling that must not move.
//
// The fixture is a verbatim, unedited splice of the real filing: source lines
// 1-825 (the whole SEC-HEADER including the SERIES-AND-CLASSES-CONTRACTS-DATA
// block that declares all eleven series, the document preamble, `<TEXT>`, the
// `<html>`/`<head>` style block, `<body>`, the `<table>` open at 540, the cover
// page, the `SMRI GROWTH PORTFOLIO` banner at 719 and the first four ballot rows
// of its 3M COMPANY meeting), then source lines 95159-95329 (the
// `SM & R ALGER GROWTH`/`FUND` banner wrapped across two lines in one `<td>` and
// the first five ballot rows of its own 3M meeting), then source lines
// 130990-130996 (`</table>` through the end of the submission). Both slices are
// cut at `<tr>` boundaries and nothing is rewritten. dict.tsv is all eleven real
// cik_series.tsv rows for this CIK, fetched verbatim, so the rival
// `SM&R Alger Growth Fund` spelling is present and nothing below is made
// unambiguous by hiding it.
//
// Measured against the tracked binary, the fixture reproduces the full filing's
// behaviour: 9 rows, layout htmltable, status ok, of which the 4 rows of the
// SMRI GROWTH PORTFOLIO block carry fund_name AND series_id both blank, and the
// 5 rows of the Alger block carry fund_name `SM & R ALGER GROWTH` and
// S000010245.
func TestNS881166SMRIGrowthPortfolioTierWordRefused(t *testing.T) {
	const (
		fixture      = "smri_growth_portfolio_and_alger_growth.txt"
		growthBanner = "SMRI GROWTH PORTFOLIO"
		growthID     = "S000010236"
		algerBanner  = "SM & R ALGER GROWTH"
		algerID      = "S000010245"
	)

	b, err := os.ReadFile(filepath.Join("testdata", "family_ns881166_smri_growth", fixture))
	if err != nil {
		t.Fatal(err)
	}
	meta := parseHeader(b)
	if len(meta.SeriesDecls) != 11 {
		t.Fatalf("fixture precondition: header declares %d series, want 11 -- the splice lost the SERIES-AND-CLASSES-CONTRACTS-DATA block", len(meta.SeriesDecls))
	}
	newIx := func(drop string) *issSeriesIndex {
		var decls []SeriesDecl
		for _, d := range meta.SeriesDecls {
			if drop != "" && d.SeriesID == drop {
				continue
			}
			decls = append(decls, d)
		}
		return issFilingIndex(decls, normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))
	}
	resolve := func(ix *issSeriesIndex, banner string) string {
		if _, d := issResolveFund(ix, banner); d != nil {
			return d.SeriesID
		}
		return ""
	}

	// Precondition, not the claim under test: the compacted brand is already
	// understood off this filing's own declarations, so the barrier below is the
	// heading's own type word and nothing else. If either of these stops
	// holding, issBrandCompactedDecl is no longer the rung in question and the
	// row assertions are measuring something else.
	hdr := newIx("")
	for _, want := range []struct{ banner, id string }{
		{"SMRI GROWTH", growthID},
		{"SMRI GROWTH FUND", growthID},
	} {
		if got := resolve(hdr, want.banner); got != want.id {
			t.Fatalf("precondition: %q resolves to %q, want %s -- the SMRI->SM&R compaction is not understood and this test is measuring the wrong rung", want.banner, got, want.id)
		}
	}

	// Precondition: the blank was never a collision with the Alger sleeve. The
	// barrier is the heading's trailing type word, not an ambiguity between two
	// declared sleeves, so dropping S000010245 from the filing's own
	// declarations must not change the answer -- the heading resolves to its own
	// series with the sibling present and with it absent alike. If this ever
	// starts depending on the sibling, the rung under test has turned into an
	// ambiguity check and the row assertions are measuring something else.
	if got := resolve(newIx(algerID), growthBanner); got != growthID {
		t.Fatalf("precondition: with %s dropped, %q resolves to %q, want %s -- resolution must not depend on the sibling, since the refusal this family fixes was never a collision", algerID, growthBanner, got, growthID)
	}

	// The claim, at the resolver. The heading substitutes PORTFOLIO for the
	// declared FUND and must still reach its own series, and the sibling that
	// spells ALGER must keep its own.
	if got := resolve(hdr, growthBanner); got != growthID {
		t.Errorf("issBrandCompactedDecl drops the type word on the declared side only: %q resolves to %q, want %s (declared `SM&R Growth Fund`, stem `growth` under lead `smri`)", growthBanner, got, growthID)
	}
	if got := resolve(hdr, "SMRI ALGER GROWTH PORTFOLIO"); got != algerID {
		t.Errorf("the sibling must not move: %q resolves to %q, want %s", "SMRI ALGER GROWTH PORTFOLIO", got, algerID)
	}

	// And through the real dispatch, where the refusal costs the block its
	// fund name as well as its series id.
	rows := ns881166Dispatch(t, fixture, "dict.tsv", "htmltable", 9)
	var growth, alger int
	for _, r := range rows {
		switch r.SeriesID {
		case growthID:
			growth++
			if r.FundName != growthBanner {
				t.Errorf("row stamped %s carries fund_name %q, want %q", growthID, r.FundName, growthBanner)
			}
		case algerID:
			alger++
			if r.FundName != algerBanner {
				t.Errorf("row stamped %s carries fund_name %q, want %q", algerID, r.FundName, algerBanner)
			}
		default:
			t.Errorf("row carries series_id %q fund_name %q -- the %q banner was never adopted, so the block kept the blank fund standing (issuer=%q cusip=%q meeting=%q desc=%q)", r.SeriesID, r.FundName, growthBanner, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription)
		}
	}
	if growth != 4 || alger != 5 {
		t.Errorf("block sizes: %s=%d (want 4) %s=%d (want 5)", growthID, growth, algerID, alger)
	}
}
