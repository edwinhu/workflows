package main

import (
	"path/filepath"
	"testing"
)

// familyMislink27Dispatch runs the real dispatch on the family MISLINK27 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout, CIK, period, declared-series count and row
// count -- so a failure below is an assertion about the series id and never a
// broken fixture.
func familyMislink27Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink27", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink27", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	if meta.CIK != "0001174610" || meta.PeriodOfReport != "20200630" || len(meta.SeriesDecls) != 2 {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s decls=%d want 0001174610/20200630/2", meta.CIK, meta.PeriodOfReport, len(meta.SeriesDecls))
	}
	return rows
}

// 000117/1174610/0001193125-20-219113.txt (ProShares Trust, CIK 0001174610,
// period 20200630, form N-PX, layout `issnpx`).
//
// Fixture `proshares2020_ultraprofinancials.txt`, assembled from six verbatim
// extracts of the real filing, whole-line drops only:
//
//  1. the SGML header top through `<SERIES-AND-CLASSES-CONTRACTS-DATA>` (the
//     SEC-DOCUMENT / SEC-HEADER lines, accession, submission type, period, and
//     the whole FILER block including `COMPANY CONFORMED NAME: PROSHARES TRUST`
//     and both FORMER COMPANY blocks).
//  2. the `<SERIES>` declaration block of S000014252 verbatim.
//  3. the `<SERIES>` declaration block of S000037029 verbatim -- declared here
//     under its CURRENT name `ProShares UltraPro Financial Select Sector`, since
//     the 20160630 rename is four years old by this filing.
//  4. the header closers, `<DOCUMENT>` / `<TYPE>N-PX` / `<SEQUENCE>` /
//     `<FILENAME>` / `<DESCRIPTION>` / `<TEXT>`, and the HTML front matter down
//     through the `<PRE>` open tag.
//  5. the single vote-table section ruled `ProShares UltraPro Financials`, every
//     meeting in it verbatim, from its own banner through but not including the
//     next ruled banner.
//  6. the report's closing lines -- `========== END NPX REPORT</PRE>` onward --
//     the trailing did-not-vote Portfolios list and the SIGNATURES block, ending
//     `</BODY></HTML>` / `</TEXT>` / `</DOCUMENT>` / `</SEC-DOCUMENT>`.
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
// The banner is S000037029's OWN EARLIER NAME -- the dictionary records exactly
// that string for S000037029 at vintage 20140630, six years before this filing's
// period -- and the vendor's plain-text vote tables still print it long after the
// 20160630 rename the header reflects. The banner differs from the OTHER declared
// sleeve, S000014252 `ProShares Ultra Financials`, by the single glued token
// `Pro`, which the registrant-scoped tolerance rungs of `issResolveFund` reach
// with room to spare, while the declared S000037029 name is three tokens away
// (`Financials` vs `Financial Select Sector`). So the chain's cheapest reading of
// the banner is the WRONG sleeve, and the right one is the sleeve whose own
// history spells the banner exactly.
//
// Measured on the current tree, this fixture, that dictionary:
//
//	855 S000014252 "ProShares UltraPro Financials"   -- WRONG, want S000037029
//
// SAME FAMILY AS MISLINK26 (cc364fcd), ONE PERIOD FURTHER OUT. MISLINK26 fixed
// the filing whose period EQUALS the rename date (20160630), where the exact
// declared-alias guard `issBannerDeclaredExactAs` (layout_issnpx.go ~3467, ~3620)
// can still see the old name as contemporaneous. Here the rename is strictly
// before this filing's 20200630 period, so `cikSeries.abandonedByPeriod`
// (cik_series.go:280, consulted by `sameCIK` at cik_series.go:243 and :264) reads
// S000037029's 20160630 row as having superseded the 20140630 name and discards
// the exact, registrant-unique dictionary hit. `sameCIK` returns nil, the caller
// keeps its inexact fuzzy match to S000014252, and every row of the section is
// stamped the sibling.
//
// The abandonment guard is right about the shapes it was built for -- a banner
// must not reach a sleeve renamed away from it long ago -- but a vendor body that
// keeps printing the superseded product name is exactly that shape, and here the
// old name is still the only string in the corpus that names this sleeve
// uniquely. The dictionary knows the answer and is overruled.
//
// Fix location (for the separate fix task, not attempted here): `cik_series.go`
// -- `sameCIK` must be allowed to prefer an EXACT, registrant-unique historical
// name over a caller's INEXACT near miss to a different sleeve even when
// `abandonedByPeriod` reports the name superseded, at least where the surviving
// alternative is a fuzzy hit rather than an exact declared name of the sibling.
// Refusing the exact historical name only when the sibling's own declared name
// matches the banner exactly leaves the shapes the guard was built for refused as
// they are today.
func TestFamilyMislink27ProSharesUltraProOldNameLongAfterRename(t *testing.T) {
	rows := familyMislink27Dispatch(t, "proshares2020_ultraprofinancials.txt", "proshares1174610_dict.tsv", "issnpx", 855)
	var banner, wrong int
	var first VoteRow
	for _, r := range rows {
		switch r.FundName {
		case "ProShares UltraPro Financials":
			banner++
			if r.SeriesID != "S000037029" {
				if wrong == 0 {
					first = r
				}
				wrong++
			}
		default:
			t.Errorf("fixture precondition: unexpected fund banner %q (series %q)", r.FundName, r.SeriesID)
		}
	}
	if banner != 855 {
		t.Fatalf("fixture section: ProShares UltraPro Financials banner rows=%d want 855", banner)
	}
	if wrong != 0 {
		t.Errorf("%d of %d rows under the body banner `ProShares UltraPro Financials` carry the WRONG series id: that banner is S000037029's own dictionary name at vintage 20140630, strictly before this filing's 20200630 period, but cikSeries.abandonedByPeriod (cik_series.go:280) reads the sleeve's 20160630 rename to `ProShares UltraPro Financial Select Sector` as abandonment and makes sameCIK discard the exact registrant-unique hit, leaving issResolveFund's inexact fuzzy match to the sibling S000014252 `ProShares Ultra Financials` -- one glued token `Pro` away -- as the answer; first offender: issuer=%q item=%q cusip=%q date=%q desc=%q series=%q want S000037029",
			wrong, banner, first.IssuerName, first.ItemSeq, first.CUSIP, first.MeetingDate, first.VoteDescription, first.SeriesID)
	}
}
