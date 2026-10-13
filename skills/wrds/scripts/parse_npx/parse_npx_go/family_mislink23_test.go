package main

import (
	"path/filepath"
	"testing"
)

// familyMislink23Dispatch runs the real dispatch on a family MISLINK23 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyMislink23Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict = nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink23", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink23", fixture), sink, make([]byte, headBytes))
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

// ITEM 1 -- 000108/1081400/0001193125-06-183294.txt (Wells Fargo Funds Trust,
// period 20060630, form N-PX/A, `issnpx`).
//
// Fixture `wellsfargo_amendment_cb_midcap.txt`: verbatim source lines 1-84 (the
// SGML header through the document opener and `<TEXT>`/`<PAGE>`), 171-203 (the
// `Item 1. Proxy Voting Record` line, the ruled
// `WELLS FARGO ADVANTAGE C&B MID CAP VALUE FUND` banner, the ALBEMARLE CORP.
// block under it and the `- ---` rule that closes it), 6106-6128 (the ruled
// `WELLS FARGO ADVANTAGE MID CAP GROWTH FUND` banner, the ABERCROMBIE & FITCH
// CO. block under it and the rule that closes it) and the filing's own last six
// lines (18205-18210). Every byte is verbatim. Dispatches to `issnpx` (the
// precondition asserts it). Dictionary `wellsfargo_dict.tsv`, all 395 rows for
// CIK 0001081400 verbatim from `cik_series.tsv`.
//
// FIXTURE LINE COUNT: 146 lines, above the ~120-line guide, and the excess is
// the untrimmed header. The MISLINK10/MISLINK11 precedent trims a declaration
// block to its `<SERIES>` / `<OWNER-CIK>` / `<SERIES-ID>` / `<SERIES-NAME>` /
// `</SERIES>` lines; doing that HERE deletes the defect. Measured, all other
// bytes held fixed:
//
//	header lines 50-77                      series on the C&B section
//	trimmed to the 5 declaration lines      ""           -- the defect is gone
//	verbatim, class contracts included      S000007347   -- the defect
//
// `parseSeriesDecls` (`header.go:175`) builds the chassis's triples one per
// `<CLASS-CONTRACT-ID>`, so a series declaring no class contract produces no
// triple at all, `seriesIDs(sc)` comes back empty and the single-series stamp in
// `processFile` never fires. The four `<CLASS-CONTRACT>` blocks of S000007347
// are therefore load-bearing and the header is kept whole.
//
// THE SHAPE, IN THE BYTES. This is an AMENDMENT. Its own `<DESCRIPTION>` line
// names the filing it amends -- source line 83, verbatim:
//
//	<DESCRIPTION>TO THE N-PX FILED UNDER ACCESSION# 0001193125-06-182909
//
// and its own header declares exactly ONE series -- source lines 52-55,
// verbatim:
//
//	<SERIES>
//	<OWNER-CIK>0001081400
//	<SERIES-ID>S000007347
//	<SERIES-NAME>Mid Cap Growth Fund
//
// The BODY nonetheless reprints the whole Wells Fargo Advantage complex under
// separate ruled sandwiches. Source lines 177 and 6111, verbatim:
//
//	================= WELLS FARGO ADVANTAGE C&B MID CAP VALUE FUND =================
//	================== WELLS FARGO ADVANTAGE MID CAP GROWTH FUND ===================
//
// So this filing's own header is a poor guide to what series a section belongs
// to. The CIK-wide dictionary is the good one: `cik_series.tsv` at CIK
// 0001081400 carries both sleeves at this filing's own 20060630 vintage, the
// second declared by the very sibling this amendment names -- verbatim:
//
//	0001081400	S000007347	Mid Cap Growth Fund	20060630	000108/1081400/0001193125-06-183294.txt
//	0001081400	S000007348	C&B Mid Cap Value Fund	20060630	000108/1081400/0001193125-06-182909.txt
//
// Measured on the current tree, this fixture, that dictionary:
//
//	14 S000007347 "WELLS FARGO ADVANTAGE C&B MID CAP VALUE FUND"   -- WRONG, want S000007348
//	 5 S000007347 "WELLS FARGO ADVANTAGE MID CAP GROWTH FUND"      -- correct
//
// Every section of this filing whose banner is not literally the Mid Cap Growth
// one is stamped with the single series the header happens to declare.
//
// THE PATH, TRACED RATHER THAN ASSUMED. Four measurements, each made by calling
// the named function directly on this fixture's own index and fallback:
//
//		issResolveFund       "WELLS FARGO ADVANTAGE C&B MID CAP VALUE FUND" -> ""           (the layout refuses it)
//		issPlainHeadingSeries "WELLS FARGO ADVANTAGE C&B MID CAP VALUE FUND" -> "S000007348" (the dictionary answers it)
//		dictFallback.apply   "WELLS FARGO ADVANTAGE C&B MID CAP VALUE FUND" -> "S000007348" (so does the chassis-level fallback)
//		dictFallback.apply   "WELLS FARGO ADVANTAGE MID CAP GROWTH FUND"    -> ""
//
//	 1. `layout_issnpx.go`, `commitBanner` -- `issResolveFund` refuses the C&B
//	    banner, and because the banner is RULED (`plain == false`) the dictionary
//	    route `issPlainHeadingSeries`, which WOULD answer S000007348, is never
//	    consulted. `issBrandCutStem` does not reach it either: the banner leads
//	    with `WELLS FARGO ADVANTAGE`, not with this filing's COMPANY CONFORMED
//	    NAME `WELLS FARGO FUNDS TRUST`. So the row leaves the layout with
//	    `SeriesID == ""` and `FundName` set to the banner.
//	 2. `main.go`, the `stamp` closure (lines 477-490). It runs
//	    `if r.SeriesID == "" { r.SeriesID = seriesRow }` -- the chassis
//	    single-declared-series stamp, S000007347 -- BEFORE `dictFB.apply(&r)`.
//	 3. `cik_series.go`, `dictFallback.apply` (line 585) opens with
//	    `if f == nil || r.SeriesID != "" || r.FundName == "" { return }`, so it
//	    bails on the id the chassis just wrote and never runs the brand-prefix
//	    strip that answers S000007348. The brand is derivable from this CIK's own
//	    later dictionary aliases (`Wells Fargo Advantage C&B Mid Cap Value Fund`,
//	    20130630), which is why the third measurement above answers at all.
//
// So the chassis stamp STARVES the CIK-wide dictionary fallback on every filing
// whose header declares exactly one series -- including, as here, sections whose
// own banner exactly names a DIFFERENT series the dictionary knows for the same
// CIK at the filing's own vintage.
//
// Nothing is guessed by fixing it. The banner's registrant-brand-stripped form
// is `C&B MID CAP VALUE FUND`, which equals the 20060630 dictionary name of
// S000007348 exactly and of nothing else at this CIK; the sleeve the header does
// declare keeps its own banner and its own rows (the control below).
//
// Fix location: `main.go`, the `stamp` closure -- `dictFB.apply` must be given
// the row before the chassis single-series stamp claims it, so that a section
// whose own banner exactly names another series of the same CIK takes that id
// and only a section the dictionary cannot answer falls back to the header's
// lone declaration. (`layout_issnpx.go`'s `commitBanner` is the second, weaker
// lever: a ruled banner whose registrant-brand-stripped form is an exact
// dictionary name could be answered there instead.)
func TestFamilyMislink23WellsFargoAmendmentSingleSeriesStarvesDict(t *testing.T) {
	rows := familyMislink23Dispatch(t, "wellsfargo_amendment_cb_midcap.txt", "wellsfargo_dict.tsv", "issnpx", 19)
	cb, growth := 0, 0
	for _, r := range rows {
		want := ""
		switch r.FundName {
		case "WELLS FARGO ADVANTAGE C&B MID CAP VALUE FUND":
			want = "S000007348"
			cb++
		case "WELLS FARGO ADVANTAGE MID CAP GROWTH FUND":
			// Control: this section's banner IS the name the header declares, and
			// the layout resolves it on its own (issResolveFund -> S000007347),
			// independent of the chassis stamp. It must keep its id after any fix.
			want = "S000007347"
			growth++
		default:
			t.Errorf("fixture precondition: unexpected fund banner %q", r.FundName)
			continue
		}
		if r.SeriesID != want {
			t.Errorf("the chassis single-declared-series stamp in main.go's stamp closure runs before dictFB.apply, which bails on any non-empty SeriesID, so this section is stamped the amendment header's lone series instead of the same-CIK series its own banner exactly names in cik_series.tsv at this filing's own 20060630 vintage: fund=%q issuer=%q cusip=%q date=%q desc=%q series=%q want %s",
				r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID, want)
		}
	}
	if cb != 14 || growth != 5 {
		t.Errorf("fixture precondition: cb=%d want 14, growth=%d want 5", cb, growth)
	}
}
