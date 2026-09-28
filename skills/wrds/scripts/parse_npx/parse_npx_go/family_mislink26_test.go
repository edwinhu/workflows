package main

import (
	"path/filepath"
	"testing"
)

// familyMislink26Dispatch runs the real dispatch on the family MISLINK26 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout, CIK, period, declared-series count and row
// count -- so a failure below is an assertion about the series id and never a
// broken fixture.
func familyMislink26Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink26", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink26", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	if meta.CIK != "0001174610" || meta.PeriodOfReport != "20160630" || len(meta.SeriesDecls) != 2 {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s decls=%d want 0001174610/20160630/2", meta.CIK, meta.PeriodOfReport, len(meta.SeriesDecls))
	}
	return rows
}

// 000117/1174610/0001193125-16-684976.txt (ProShares Trust -- the ProFunds
// leveraged-and-inverse ETF trust, CIK 0001174610, period 20160630, form N-PX,
// layout `issnpx`).
//
// Fixture `proshares2016_ultraprofinancials.txt`, assembled from six verbatim
// extracts of the real 18MB filing, whole-line drops only:
//
//  1. the SGML header top (SEC-DOCUMENT / SEC-HEADER / acceptance datetime /
//     accession / submission type / period / dates / the whole FILER block
//     including `COMPANY CONFORMED NAME: PROSHARES TRUST`, both addresses and
//     both FORMER COMPANY blocks), then
//     `<SERIES-AND-CLASSES-CONTRACTS-DATA>` /
//     `<EXISTING-SERIES-AND-CLASSES-CONTRACTS>`.
//  2. the `<SERIES>` declaration block of S000014252 verbatim.
//  3. the `<SERIES>` declaration block of S000037029 verbatim -- every
//     `<OWNER-CIK>` / `<SERIES-ID>` / `<SERIES-NAME>` / `<CLASS-CONTRACT-ID>` /
//     `<CLASS-CONTRACT-NAME>` / `<CLASS-CONTRACT-TICKER-SYMBOL>` line kept,
//     since `parseSeriesDecls` builds the chassis's triples one per
//     `<CLASS-CONTRACT-ID>` and the declared set IS the evidence the resolver
//     reads.
//  4. the header closers, `<DOCUMENT>` / `<TYPE>N-PX` / `<SEQUENCE>` /
//     `<FILENAME>` / `<DESCRIPTION>` / `<TEXT>`, and the HTML front matter down
//     through the reporting-period table and the `<PRE>` open tag.
//  5. the single vote-table section: the ruled
//     `ProShares UltraPro Financials` banner with the whole of ACE LIMITED's
//     22-Oct-2015 special meeting and the whole of AFFILIATED MANAGERS GROUP,
//     INC.'s 14-Jun-2016 annual meeting under it, each closed by its own
//     `-----` rule.
//  6. the report's closing lines -- `========== END NPX REPORT</PRE>` onward --
//     and the trailing HTML: the did-not-vote Portfolios list and the SIGNATURES
//     block, ending `</BODY></HTML>` / `</TEXT>` / `</DOCUMENT>` /
//     `</SEC-DOCUMENT>`.
//
// Every byte of those six extracts is verbatim; nothing is hand-typed or
// paraphrased. Only whole lines were dropped: every other `<SERIES>` block this
// registrant declares -- ProShares Trust registers well over a hundred sleeves,
// and only the two that collide below are kept -- and every other banner section
// in the body.
//
// `proshares1174610_dict.tsv` is the relevant slice of `cik_series.tsv` for this
// registrant's two colliding series, verbatim -- exactly four rows, tab
// separated:
//
//	0001174610	S000014252	Ultra Financials ProShares	20070630	000117/1174610/0001193125-07-188092.txt
//	0001174610	S000014252	ProShares Ultra Financials	20090630	000117/1174610/0001193125-09-181989.txt
//	0001174610	S000037029	ProShares UltraPro Financials	20140630	000117/1174610/0001193125-14-326659.txt
//	0001174610	S000037029	ProShares UltraPro Financial Select Sector	20160630	000117/1174610/0001193125-16-684976.txt
//
// THE SHAPE, IN THE BYTES. The filing's own header declares the two series under
// the names they carry AT THIS PERIOD:
//
//	<SERIES-ID>S000014252  <SERIES-NAME>ProShares Ultra Financials
//	<SERIES-ID>S000037029  <SERIES-NAME>ProShares UltraPro Financial Select Sector
//
// and the body prints ONE section, under a banner that is NEITHER of those:
//
//	======================== ProShares UltraPro Financials =========================
//
// The banner is S000037029's OWN EARLIER NAME. The dictionary above records
// S000037029 declared as exactly `ProShares UltraPro Financials` at vintage
// 20140630 -- two years before this filing's 20160630 period -- and then
// redeclared as `ProShares UltraPro Financial Select Sector` at 20160630, this
// very accession. The vendor's plain-text vote tables still print the old,
// superseded product name as the section heading while the SGML header carries
// the new one. Nothing about this is a spelling gap: the banner is a name the
// registrant itself put in writing for this series id.
//
// THE COLLISION. The banner differs from the OTHER declared series by a single
// word. Normalised:
//
//	`ProShares UltraPro Financials`                 (banner, and S000037029 @ 20140630)
//	`ProShares Ultra Financials`                    (declared, S000014252)
//	`ProShares UltraPro Financial Select Sector`    (declared, S000037029)
//
// The banner is the declared S000014252 name with `Pro` glued onto `Ultra` --
// one token apart, an inexact near miss the registrant-scoped tolerance rungs of
// `issResolveFund` reach with room to spare -- while the declared S000037029
// name is three tokens away from the banner (`Financials` vs
// `Financial Select Sector`). So the chain's cheapest reading of the banner is
// the WRONG sleeve, and the right one is the sleeve whose own history spells the
// banner exactly.
//
// Measured on the current tree, this fixture, that dictionary:
//
//	18 S000014252 "ProShares UltraPro Financials"   -- WRONG, want S000037029
//
// Eighteen, not nineteen: the section prints nineteen numbered proposals, and the
// parser folds ACE's shareholder item `A` into the continuation lines of item
// `5` above it. That fold is unrelated to the series id and is not what this
// family is about; it is named here only so the row count below reads as
// measured rather than miscounted.
//
// THE GUARD THAT REFUSES THE RIGHT ANSWER. `layout_issnpx.go` around line 3467
// does consult the dictionary for exactly this shape: where the chain answered
// INEXACTLY, it offers the banner to `cikSeries.sameCIK` (`cik_series.go`, the
// function around line 215) and prefers its answer over the near miss.
// `sameCIK` finds the hit -- S000037029's 20140630 row is an exact,
// registrant-unique normalised match for the banner, and its declaration date
// precedes the period, so the contemporaneity half of the guard passes -- and
// then throws it away at `d.abandonedByPeriod(...)`: that predicate
// (`cik_series.go`, documented as "the other half of contemporaneity") reports
// true whenever the SAME series id under the SAME registrant carries a LATER row
// under a DIFFERENT normalised name at or before the period, which S000037029's
// own 20160630 `ProShares UltraPro Financial Select Sector` row is exactly.
// `sameCIK` returns nil, the caller keeps the inexact fuzzy match, and every row
// of the section is stamped S000014252.
//
// The abandonment guard is right about the shapes it was built for -- SYNTAX ETF
// TRUST's wrapped banner `EQUITY` must not reach a sleeve renamed twice since --
// but it is reading this registrant's rename as evidence AGAINST the sleeve when
// the filing's body is the rename's own lag. The old name did not stop being
// this series' name for these votes: the votes were cast during the period the
// rename happened in, and the body prints what the vendor's records were keyed
// on.
//
// Same class as families MISLINK23 (2e2ec1c5), MISLINK24 (0b8f5a6c) and
// MISLINK25 (66912067) -- a row of one series of a CIK is stamped with a sibling
// series of the SAME CIK -- but here the wrong id survives because a guard
// designed to refuse a STALE name refuses the one stale name that is right,
// leaving a one-token fuzzy hit on a different sleeve as the only surviving
// candidate. The dictionary knows the answer and is overruled.
//
// Fix location: `cik_series.go` -- `abandonedByPeriod` must not veto a match
// whose superseding row is declared by THIS VERY FILING (the abandoning
// declaration and the filing's period coincide, so the body cannot yet be
// expected to print the new name), or, equivalently, `sameCIK` must prefer an
// exact same-CIK historical name over a caller's inexact near miss even when the
// name was superseded at the period itself. Either predicate leaves the SYNTAX
// shape -- a name superseded one or more periods BEFORE the filing's own --
// refused exactly as it is today.
func TestFamilyMislink26ProSharesUltraProAbandonedOwnNameLosesToFuzzySibling(t *testing.T) {
	rows := familyMislink26Dispatch(t, "proshares2016_ultraprofinancials.txt", "proshares1174610_dict.tsv", "issnpx", 18)
	var banner int
	for _, r := range rows {
		switch r.FundName {
		case "ProShares UltraPro Financials":
			banner++
			if r.SeriesID != "S000037029" {
				t.Errorf("the body's banner `ProShares UltraPro Financials` is S000037029's OWN dictionary name at vintage 20140630, superseded by `ProShares UltraPro Financial Select Sector` in this very accession (20160630), so cikSeries.sameCIK finds the exact registrant-unique hit and then discards it at d.abandonedByPeriod -- that predicate reports abandonment for any later same-series row under a different name at or before the period, and S000037029's own 20160630 rename is exactly such a row -- whereupon issResolveFund (layout_issnpx.go ~3467) keeps its inexact fuzzy match to the OTHER declared sleeve S000014252 `ProShares Ultra Financials`, which the banner misses only by the word `Pro`: issuer=%q item=%q cusip=%q date=%q desc=%q series=%q want S000037029",
					r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		default:
			t.Errorf("fixture precondition: unexpected fund banner %q (series %q)", r.FundName, r.SeriesID)
		}
	}
	if banner != 18 {
		t.Fatalf("fixture section: ProShares UltraPro Financials banner rows=%d want 18", banner)
	}
}
