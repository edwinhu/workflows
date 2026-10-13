package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// familyMislink12Dispatch runs the real dispatch on a family MISLINK12 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislink12Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink12", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink12", fixture), sink, make([]byte, headBytes))
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

// 000087/875352/0000910682-04-000022.txt: verbatim source line ranges 1-60 of
// the NS28 excerpt of this same filing (the SEC document opener, the SGML
// header, the FORM N-PX cover and `ITEM 1. PROXY VOTING RECORD.`), then source
// lines 5524-5537, 7570-7583, 14442-14453 and 21848-21859 -- the four ruled
// banners this defect is about, each with the whole first issuer block under it
// -- and the filing's own last four lines. Every byte is verbatim. Dispatches to
// `issnpx` (the precondition asserts it).
//
// Delaware Pooled Trust, period 20040630. TWO WRONG SERIES, not blanks. Measured
// on the current tree with the full 41,139-row dictionary, the four sections of
// this filing that matter here:
//
//	938 S000003931  "THE SMALL-CAP VALUE EQUITY PORTFOLIO"          <-- WRONG
//	932 S000003931  "THE LARGE-CAP VALUE EQUITY PORTFOLIO"
//	655 S000003944  "THE INTERNATIONAL LARGE-CAP EQUITY PORTFOLIO"  <-- WRONG
//	751 S000003944  "THE INTERNATIONAL EQUITY PORTFOLIO"
//
// Each wrong stamp is the id of a sibling THIS FILING PRINTS AS ITS OWN RULED
// SECTION, so the two cannot be one fund. Source lines 21848, 14442, 7570 and
// 5524 verbatim:
//
//	===================== THE SMALL-CAP VALUE EQUITY PORTFOLIO =====================
//	===================== THE LARGE-CAP VALUE EQUITY PORTFOLIO =====================
//	================= THE INTERNATIONAL LARGE-CAP EQUITY PORTFOLIO =================
//	====================== THE INTERNATIONAL EQUITY PORTFOLIO ======================
//
// The registrant declares no Small-Cap Value and no International Large-Cap at
// any vintage: the dictionary's 33 rows for this CIK carry `THE LARGE-CAP VALUE
// EQUITY PORTFOLIO` (S000003931) and `THE INTERNATIONAL EQUITY PORTFOLIO`
// (S000003944), each already claimed by its own banner above.
//
// PROBED, not judged by eye, against this filing's own index (33
// dictionary-backfilled decls; the 2004 filing declares no `<SERIES>` blocks).
// Two DIFFERENT rungs, each swallowing a SIZE word:
//
//	issResolveFund(ix, "THE SMALL-CAP VALUE EQUITY PORTFOLIO")
//	    -> issDistinctivePairDecl -> S000003931 "THE LARGE-CAP VALUE EQUITY PORTFOLIO"
//	issResolveFund(ix, "THE INTERNATIONAL LARGE-CAP EQUITY PORTFOLIO")
//	    -> issSplicedDecl         -> S000003944 "THE INTERNATIONAL EQUITY PORTFOLIO"
//
// `issDistinctivePairDecl` reads the heading's distinctive PAIR (`value equity`)
// and lets the slot before it differ, so `small` answers to `large`.
// `issSplicedDecl` reads the declared name as a subsequence of the heading and
// tolerates up to issSpliceExtraWords inserted tokens, so the heading's own
// `large cap` is read as decoration on `THE INTERNATIONAL EQUITY PORTFOLIO`.
// Neither guard knows that `small`/`large`/`mid` are the registrant's own SIZE
// discriminator -- the size analogue of the STYLE guard `issStyleSiblingSwap`
// added for VALIC (family MISLINK11 item 3), which fires on growth/value/income
// and does not carry the cap words.
//
// Fix location: `layout_issnpx.go` -- a size-word guard in the same place as
// `issStyleSiblingSwap`, consulted by `issDistinctivePairDecl` (the swapped
// slot) and by `issSplicedDecl` (the spliced tokens). `small`/`mid`/`large`/
// `smid`/`all` in front of `cap` is the registrant's own discriminator whenever
// its declared set separates two names by exactly that word (this CIK declares
// LARGE-CAP GROWTH beside MID-CAP GROWTH beside SMALL-CAP GROWTH), and a swap or
// an insertion across it names a DIFFERENT fund. A wrong series is worse than a
// blank one, so both headings must stamp "".
//
// The two control sections must keep their own ids, so a fix that merely deleted
// either rung fails this test rather than passing it.
func TestFamilyMislink12DelawareSizeWordSiblings(t *testing.T) {
	rows := familyMislink12Dispatch(t, "delaware_sizeword_siblings.txt", "delaware_dict.tsv", "issnpx", 9)
	for _, r := range rows {
		fund := strings.ToUpper(r.FundName)
		var want, why string
		switch {
		case strings.Contains(fund, "SMALL-CAP VALUE"):
			want, why = "", "the registrant declares no Small-Cap Value at any vintage and this filing prints THE LARGE-CAP VALUE EQUITY PORTFOLIO as its own ruled section, so the size word must not be swallowed"
		case strings.Contains(fund, "INTERNATIONAL LARGE-CAP"):
			want, why = "", "the registrant declares no International Large-Cap at any vintage and this filing prints THE INTERNATIONAL EQUITY PORTFOLIO as its own ruled section, so the inserted size word must not be read as decoration"
		case strings.Contains(fund, "LARGE-CAP VALUE"):
			want, why = "S000003931", "control: the declared Large-Cap Value section keeps its own id"
		case strings.Contains(fund, "INTERNATIONAL EQUITY"):
			want, why = "S000003944", "control: the declared International Equity section keeps its own id"
		default:
			t.Fatalf("fixture carries an unexpected fund heading %q", r.FundName)
		}
		if r.SeriesID != want {
			t.Errorf("%s: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want %q",
				why, r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID, want)
		}
	}
}

// 000088/889284/0000092230-04-000064.txt -- BB&T Funds, CIK 889284, period
// 20040630, `issnpx`, 682 rows under the banner at source line 143:
//
//	========================== BB&T BALANCED FUND =================================
//
// This is a HAZARD, not a wrong stamp: the issnpx chain refuses the heading
// today (`issResolveFund` -> "") because the registrant prefix is `BB&T FUNDS`
// rather than the bare brand `BB&T`, so the 682 rows are blank. The shared
// resolver entry point `icrResolveFundShared` -- the one every other layout
// reaches this CIK's index through, and the one any future bare-brand strip
// would hand the cut heading to -- answers the brand-cut name with a DIFFERENT
// fund of this same filing.
//
// PROBED against this filing's own index (72 dictionary-backfilled decls):
//
//	icrResolveFundShared(ix, "BB&T BALANCED FUND")  -> ""            (the issnpx chain's refusal)
//	icrResolveFundShared(ix, "BALANCED FUND")       -> "S000003554"  <-- the defect
//	icrResolveFundShared(ix, "BB&T MID CAP VALUE FUND") -> "S000003539"  (contrast: resolves)
//
// S000003554 is `BB&T CAPITAL MANAGER MODERATE GROWTH FUND` at the 20060630
// vintage -- a fund this filing prints as its OWN separate section -- and it is
// reached only through the 20110630 alias `STERLING CAPITAL STRATEGIC ALLOCATION
// BALANCED FUND`, whose trailing two words the printed heading happens to equal.
// The rung is `icrResolveDeclaredSuffix` (`layout_icr.go`), the declared-side
// suffix walk: `balanced fund` ends exactly one declared name, so its uniqueness
// guard is satisfied, and nothing on that path consults the vintage the way
// `issFutureVintage` does inside the issnpx chain. The heading names a BALANCED
// fund; the id it lands on is named MODERATE GROWTH in every spelling this
// filing could have known.
//
// Fix location: `layout_icr.go`, `icrResolveDeclaredSuffix` (reached from
// `icrResolveFund`, which `icrResolveFundShared` calls first) -- a declared-side
// suffix hit must be refused when the declared name that carries the suffix
// post-dates the filing's period of report, the same refusal
// `issFutureVintage` already makes for an exact hit in `issResolveFundUncached`.
func TestFamilyMislink12BBTBalancedBrandCut(t *testing.T) {
	cikDict = nil
	oldDict := cikDict
	t.Cleanup(func() { cikDict = oldDict })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink12", "bbt_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	h := FilingMeta{CIK: "0000889284", CompanyName: "BB&T FUNDS /", PeriodOfReport: "20040630"}
	cikDict.back(&h)
	if len(h.SeriesDecls) == 0 {
		t.Fatalf("precondition: the dictionary backfilled no declarations for this CIK")
	}
	ix := issFilingIndex(h.SeriesDecls, normalizeSeriesName(h.CompanyName), h.CIK, metaPeriod(h))
	if got := icrResolveFundShared(ix, "BB&T MID CAP VALUE FUND"); got != "S000003539" {
		t.Fatalf("precondition: a sibling BB&T banner must still resolve, got %q want S000003539", got)
	}
	if got := icrResolveFundShared(ix, "BALANCED FUND"); got != "" {
		var names []string
		for i := range ix.decls {
			if ix.decls[i].SeriesID == got {
				names = append(names, ix.decls[i].Name+" @"+ix.decls[i].DeclDate)
			}
		}
		t.Errorf("a brand-cut `BALANCED FUND` resolves to %s, whose names at this CIK are %v -- the 20040630 spelling is BB&T CAPITAL MANAGER MODERATE GROWTH FUND, a fund this same filing prints as its own section, and no name of this id at the filing's own vintage contains `balanced`: want \"\"",
			got, names)
	}
}
