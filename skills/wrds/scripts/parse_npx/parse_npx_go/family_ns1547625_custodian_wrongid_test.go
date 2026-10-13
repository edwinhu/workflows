package main

import (
	"path/filepath"
	"testing"
)

// 000154/1547625/0000930413-15-003531.txt: verbatim source lines 1-93 (the SGML
// header with both `<SERIES>` declarations and all their class contracts,
// `<DOCUMENT>`, `<TEXT>`, `<HTML>`, `<HEAD>` and `<BODY>`), 135470-135568 (the
// first `Custodian Account Name` table -- its header row and the first six vote
// rows, which name `Aurora Horizons Fund`, `Aurora Horizons Fund`, `K2`, `K2`,
// `Aurora Horizons Fund`, `Aurora Horizons Fund`) and 203352-203482 (the second
// such table -- its header row and the first four vote rows, every one of them
// named `ARDEN ALTERNATIVE STRATEGIES FUND II 1`). Two added closing table tags
// close the cuts' own tables and the last five lines close the markup the header
// cut opened; every other byte is a line range of the source.
//
// ARDEN INVESTMENT SERIES TRUST, CIK 1547625, period 20150630, N-PX, dispatched
// `htmltable` (the precondition below re-asserts it on the cut).
//
// THE SHAPE. This filing prints no per-fund masthead at all. Every vote row
// carries the fund in its own leading `Custodian Account Name` cell, which
// `htmlFundCell` reads and `icrResolveFundShared` resolves per row. Three
// distinct labels appear across the whole filing -- 443 rows `Aurora Horizons
// Fund`, 302 rows `ARDEN ALTERNATIVE STRATEGIES FUND II 1`, 406 rows `K2`. The
// registrant declares exactly two series, in its own header and in the corpus
// dictionary alike:
//
//	S000037639  Arden Alternative Strategies Fund
//	S000040927  Arden Alternative Strategies II
//
// Neither is named `Aurora Horizons Fund`, and neither is spelled with a
// trailing `1`.
//
// DEFECT 1 -- THE CROSS-CIK HOMONYM. `Aurora Horizons Fund` names no series of
// this registrant, so every registrant-scoped rung refuses and the chain falls
// through to the sibling rung, `cikSeries.crossCIK`, which finds the name spelled
// exactly, contemporaneously and corpus-uniquely under a DIFFERENT registrant --
// CIK 1141819, S000040227, declared 20130630. The two CIKs share no sponsor,
// no brand and no filing agent; the match is a name-string coincidence. 443 rows
// of Arden Investment Series Trust's own report are filed under another trust's
// series id.
//
// DEFECT 2 -- THE GLUED FOOTNOTE DIGIT. `ARDEN ALTERNATIVE STRATEGIES FUND II 1`
// is the real fund `Arden Alternative Strategies Fund II` with a footnote
// reference `1` welded on, no separator. The same label appears in this
// registrant's neighbouring filings WITHOUT the digit, where it resolves
// correctly: probed on this filing's own declarations,
// `ARDEN ALTERNATIVE STRATEGIES FUND II` answers S000040927. The digit alone
// flips the answer to the SIBLING, S000037639.
//
// The route is measured, not inferred (instrumented copy of the package, every
// `return` in `issResolveFundUncached` traced):
//
//	enter "ARDEN ALTERNATIVE STRATEGIES FUND II 1"
//	  enter "ARDEN ALTERNATIVE STRATEGIES FUND II I"     <- layout_issnpx.go:3809
//	    ...
//	  return L4507 for "ARDEN ALTERNATIVE STRATEGIES FUND II I"
//	return L3821 for "ARDEN ALTERNATIVE STRATEGIES FUND II 1"
//
// layout_issnpx.go:3809 is the series-letter rung -- `SBL Fund - Series 0` for a
// declared `SERIES O` -- which rewrites a STANDALONE trailing single character
// `1` into the letter `I` and re-resolves. The footnote digit is exactly such a
// character, so the heading becomes `... FUND II I`. layout_issnpx.go:4507 is
// then `issSleeveStemDecl`: the declared name `Arden Alternative Strategies Fund`
// has its type word `fund` standing inside the heading with `II I` trailing it,
// which reads as a SLEEVE qualifier of that fund. Both rungs are sound on the
// shapes they were built for; their composition here turns a footnote marker into
// a claim about which sibling the section belongs to.
//
// This is NOT the prefix-matching rung an earlier pass on this CIK supposed. No
// rung matches the declared name as a leading substring here; the digit has to be
// read as a Roman numeral first, and the fold that follows is a sleeve read, not
// a prefix read.
//
// K2 IS OUT OF SCOPE. The third label carries no identifying context anywhere in
// the filing -- no masthead, no ticker, no account number, no dictionary name.
// Its rows stay blank today and must stay blank: the guard below is a regression
// check on a fix for the two above, not an attempt to resolve it.
//
// THE ASSERTION. No row of this registrant's report may carry a series id that
// belongs to another CIK, and no row of the Fund II section may carry Fund I's
// id. A fix that resolves the Fund II label to S000040927 and one that refuses it
// outright are both correct; stamping S000037639 is not.
func TestFamilyNS1547625CustodianAccountNameWrongID(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	const dir = "family_ns1547625_custodian_wrongid"
	var err error
	// The real corpus rows for BOTH CIKs, verbatim from the reconcile corpus's
	// cik_series.tsv: this registrant's two series, and every series CIK 1141819
	// ever declared -- the homonym S000040227 among them. The sibling rung
	// demands corpus-wide uniqueness, so 1141819's full declaration set has to be
	// present for the defect to reproduce the way it does on the whole corpus.
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, "arden_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	// No overlay. series_map_applied.tsv does carry a row for this filing and
	// this heading (`ARDEN ALTERNATIVE STRATEGIES FUND II 1` -> S000040927), and
	// running the real filing WITH `-series-map` changes nothing: the overlay
	// fills a blank series, and these rows are not blank -- they are wrong.
	seriesMap = nil

	const fixture = "arden_custodian_account_name_2015.txt"
	path := filepath.Join("testdata", dir, fixture)

	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, path, sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || len(rows) != 10 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/htmltable/10 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	const (
		auroraCell = "Aurora Horizons Fund"
		ardenCell  = "ARDEN ALTERNATIVE STRATEGIES FUND II 1"
		k2Cell     = "K2"

		// CIK 1141819's series, declared 20130630. Not this registrant's.
		strangerID = "S000040227"
		// This registrant's `Arden Alternative Strategies Fund` -- the SIBLING of
		// the fund the Arden rows name.
		siblingID = "S000037639"
		// This registrant's `Arden Alternative Strategies II` -- the fund the
		// Arden rows do name, and what the same label resolves to once the
		// footnote digit is gone.
		fundIIID = "S000040927"
	)

	// ownSeries is every series id this registrant declares, in its own header
	// and in the corpus dictionary alike. A row of this filing may carry one of
	// these or nothing; anything else is another registrant's fund.
	ownSeries := map[string]bool{siblingID: true, fundIIID: true}

	var aurora, arden, k2 int
	for i, r := range rows {
		switch r.FundName {
		case auroraCell:
			aurora++
		case ardenCell:
			arden++
		case k2Cell:
			k2++
		default:
			t.Errorf("row %d: fund_name=%q is none of this filing's three custodian account labels",
				i, r.FundName)
			continue
		}

		if r.SeriesID != "" && !ownSeries[r.SeriesID] {
			t.Errorf("row %d (custodian account %q, issuer %q): series_id=%q belongs to CIK 0001141819, not to this filing's CIK 0001547625\n\tthe registrant-scoped rungs all refuse this label and the chain falls through to cikSeries.crossCIK, which matches the literal name under an unrelated trust; this registrant declares only %s and %s",
				i, r.FundName, truncate(r.IssuerName, 40), r.SeriesID, siblingID, fundIIID)
		}

		if r.FundName == ardenCell && r.SeriesID == siblingID {
			t.Errorf("row %d (custodian account %q, issuer %q): series_id=%q is `Arden Alternative Strategies Fund`, the SIBLING of the fund this row names\n\tthe trailing footnote digit `1` is rewritten to the Roman numeral `I` by the series-letter rung (layout_issnpx.go:3809), and issSleeveStemDecl (layout_issnpx.go:4507) then reads the remainder `II I` as a sleeve qualifier of that sibling; without the digit the same label answers %s\n\tstaying blank is acceptable, stamping %s is not",
				i, r.FundName, truncate(r.IssuerName, 40), r.SeriesID, fundIIID, siblingID)
		}

		// K2 names nothing the filing or the dictionary can read. It is out of
		// scope for the two defects above and must not acquire an id from a fix
		// for them.
		if r.FundName == k2Cell && r.SeriesID != "" {
			t.Errorf("row %d: the `K2` custodian account acquired series_id=%q -- this label carries no identifying context anywhere in the filing",
				i, r.SeriesID)
		}
	}

	// The cut's own census, so a fixture that stopped carrying one of the three
	// labels fails loudly rather than passing vacuously.
	if aurora != 4 || arden != 4 || k2 != 2 {
		t.Fatalf("fixture guard: cut lost a custodian label: aurora=%d arden=%d k2=%d want 4/4/2", aurora, arden, k2)
	}
}
