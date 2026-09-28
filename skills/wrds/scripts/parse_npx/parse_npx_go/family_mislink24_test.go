package main

import (
	"path/filepath"
	"testing"
)

// familyMislink24Dispatch runs the real dispatch on a family MISLINK24 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout, CIK, period and row count -- so a failure
// below is an assertion about the series id and never a broken fixture.
func familyMislink24Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink24", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink24", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	if meta.CIK != "0000822977" || meta.PeriodOfReport != "20130630" || len(meta.SeriesDecls) != 2 {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s decls=%d want 0000822977/20130630/2", meta.CIK, meta.PeriodOfReport, len(meta.SeriesDecls))
	}
	return rows
}

// 000082/822977/0001193125-13-346121.txt (Goldman Sachs Trust, CIK 0000822977,
// period 20130630, form N-PX, layout `issnpx`).
//
// Fixture `goldmansachs2013_structured_largecap.txt`, assembled from three
// verbatim extracts of the real filing, whole-line drops only:
//
//  1. the SGML header top (SEC-DOCUMENT / SEC-HEADER / accession / submission
//     type / period / dates / the whole FILER block including
//     `COMPANY CONFORMED NAME: GOLDMAN SACHS TRUST` and the two FORMER COMPANY
//     entries), then the `<SERIES>` declaration blocks of S000009317 and
//     S000009326 verbatim -- every `<CLASS-CONTRACT-ID>` /
//     `<CLASS-CONTRACT-NAME>` / `<CLASS-CONTRACT-TICKER-SYMBOL>` line kept --
//     then the header closer, `<DOCUMENT>`/`<TYPE>N-PX`/`<TEXT>`/`<PAGE>` and
//     the FORM N-PX title block down to the registrant's address.
//  2. the ruled `Goldman Sachs Large Cap Value Fund` section banner with the
//     whole of ADOBE SYSTEMS INCORPORATED's 11-Apr-2013 annual meeting under it
//     and the `-----` rule that closes the block.
//  3. the ruled `Goldman Sachs Structured Large Cap Value Fund` section banner
//     with the whole of ABBOTT LABORATORIES' 26-Apr-2013 annual meeting under
//     it.
//
// Every byte of those three extracts is verbatim; nothing is hand-typed or
// paraphrased. Only whole lines were dropped: the sibling issuer blocks the two
// sections continue into (AETNA INC. after Adobe), the S000009317 declaration's
// remaining class contracts, and the one truncated proposal line the third
// extract ended on. The four SGML structure tags that close what those drops
// cut open -- `</SERIES>`, `</EXISTING-SERIES-AND-CLASSES-CONTRACTS>`,
// `</TEXT>`, `</DOCUMENT>`, `</SEC-DOCUMENT>` -- are the only lines in the file
// that are not lifted from the filing, and they carry no name, id or vote.
//
// The header is kept WHOLE for both series, class contracts included, for the
// MISLINK23 reason: the declared set IS the evidence the resolver reads, and
// `parseSeriesDecls` builds the chassis's triples one per `<CLASS-CONTRACT-ID>`.
//
// `goldmansachs_dict.tsv` is the one `cik_series.tsv` row that matters here,
// verbatim:
//
//	0000822977	S000009326	Goldman Sachs Structured Large Cap Value Fund	20060630	000082/822977/0000950123-06-010957.txt
//
// THE SHAPE, IN THE BYTES. This registrant's own header declares two series
// whose names differ by nothing but the words `Insights`:
//
//	<SERIES-ID>S000009317  <SERIES-NAME>Goldman Sachs Large Cap Value Fund
//	<SERIES-ID>S000009326  <SERIES-NAME>Goldman Sachs Large Cap Value Insights Fund
//
// S000009326 was renamed to `... Insights Fund` effective this filing's own
// period end, 2013-06-30; its 20060630 dictionary vintage spells it verbatim
// `Goldman Sachs Structured Large Cap Value Fund`. The body still prints the
// OLD name as a section banner, and the two banners of this fixture are:
//
//	====================== Goldman Sachs Large Cap Value Fund ======================   <- S000009317
//	================ Goldman Sachs Structured Large Cap Value Fund =================   <- S000009326
//
// The string `Goldman Sachs Structured Large Cap Value Fund` is NOT a name this
// filing's own header declares for ANY series -- not as a `<SERIES-NAME>` and
// not as a `<CLASS-CONTRACT-NAME>`.
//
// Measured on the current tree, this fixture, that dictionary:
//
//	17 S000009317 "Goldman Sachs Structured Large Cap Value Fund"   -- WRONG, want S000009326
//	16 S000009317 "Goldman Sachs Large Cap Value Fund"              -- correct
//
// THE PATH, PROBED rather than assumed. Four measurements, each made by calling
// the named function directly on the index this dispatch builds
// (`newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))`,
// 2 decls) and on this filing's own `cikDict.exactFallback(meta)`:
//
//	issResolveFundUncached      "Goldman Sachs Structured Large Cap Value Fund" -> S000009317 "Goldman Sachs Large Cap Value Fund"
//	issInternalTokenDropDecl    "goldman sachs structured large cap value fund" -> S000009317 "Goldman Sachs Large Cap Value Fund"
//	issDroppedTokenNamesSibling (ix, "structured", thatHit)                     -> false      (the guard does not fire)
//	dictFallback.apply          "Goldman Sachs Structured Large Cap Value Fund" -> S000009326  (the dictionary answers it)
//
//  1. `layout_issnpx.go`, `issInternalTokenDropDecl` (line 6631). It drops one
//     INTERIOR token from the banner and looks the remainder up in `ix.byName`
//     -- this filing's own header-declared names and nothing else. Dropping
//     `structured` leaves `goldman sachs large cap value fund`, which is
//     S000009317's declared name exactly, so the rung claims the row for
//     S000009317: a different fund that was never named `Structured` anything
//     and that already has its own separate banner and its own rows in this same
//     filing.
//  2. Its sibling-collision guard `issDroppedTokenNamesSibling` (line 6613)
//     refuses a drop only when the dropped token is spelled in some OTHER
//     CURRENT header-declared name of this registrant. The 2013 header spells
//     S000009326 as `... Insights Fund`, so the token `structured` appears in no
//     declared name at all and the guard returns false (probe above). It never
//     consults `cik_series.tsv`, so it cannot see that `Structured` is itself
//     the distinctive pre-rename name of a DIFFERENT series of this same CIK.
//  3. The row therefore leaves `issResolveFundUncached` with a non-empty
//     SeriesID, and `cik_series.go`'s `dictFallback.apply` (line 585) opens with
//     `if f == nil || r.SeriesID != "" || r.FundName == "" { return }` -- so the
//     dictionary's EXACT vintage match for S000009326 is never consulted,
//     although it answers on its own the moment it is asked (fourth probe; the
//     same row also answers `cikSeries.registrantExactName` at this filing's
//     period).
//
// Same class as family MISLINK23 (2e2ec1c5, `give dictFB a chance before the
// single-series chassis stamp`) -- a rung that resolves inside the layout
// starves the CIK-wide dictionary that has the right answer -- but here the
// thief is the layout's OWN header-declared-name rung, not the chassis
// single-series fallback, and this filing declares two series, so the chassis
// stamp is not even in play.
//
// Nothing is guessed by fixing it. `Goldman Sachs Structured Large Cap Value
// Fund` is the 20060630 dictionary name of S000009326 EXACTLY and of nothing
// else at this CIK, S000009317 keeps its own banner and its own rows (the
// control below), and the interior-drop reading is the weaker evidence by
// construction: it is an EDIT of a declared name, while the dictionary row is
// that string verbatim.
//
// Fix location: `layout_issnpx.go` -- `issDroppedTokenNamesSibling` must also
// refuse when the dropped token is distinctive in a CONTEMPORANEOUS dictionary
// name of another series of the same CIK (the registrant's own vocabulary at a
// vintage the header no longer carries), or, equivalently, an interior-drop hit
// must yield to an EXACT same-CIK dictionary name for the un-edited banner.
// Either predicate refuses this row and neither touches the control.
func TestFamilyMislink24GoldmanSachsStructuredNameStealsSibling(t *testing.T) {
	rows := familyMislink24Dispatch(t, "goldmansachs2013_structured_largecap.txt", "goldmansachs_dict.tsv", "issnpx", 33)
	var plain, structured int
	for _, r := range rows {
		switch r.FundName {
		case "Goldman Sachs Large Cap Value Fund":
			// Control: this banner IS the name the header declares for S000009317,
			// it resolves on an exact match with no token dropped and no dictionary
			// row involved, and it must keep its id after any fix.
			plain++
			if r.SeriesID != "S000009317" {
				t.Errorf("the plain Large Cap Value banner is the control -- it is this filing's own header-declared name for S000009317 and resolves on an exact match -- and must keep its id: issuer=%q item=%q cusip=%q date=%q series=%q want S000009317",
					r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.SeriesID)
			}
		case "Goldman Sachs Structured Large Cap Value Fund":
			structured++
			if r.SeriesID != "S000009326" {
				t.Errorf("issInternalTokenDropDecl drops the interior token `Structured` from this banner, lands on S000009317's header-declared name `Goldman Sachs Large Cap Value Fund` and claims the row -- for a fund that was never named `Structured` anything and that already prints its own separate banner in this same filing; issDroppedTokenNamesSibling cannot refuse the drop because it reads only CURRENT header-declared names, and the 2013 header spells the real owner as `Goldman Sachs Large Cap Value Insights Fund` after its 2013-06-30 rename, while cik_series.tsv carries `Goldman Sachs Structured Large Cap Value Fund` verbatim for S000009326 at CIK 0000822977; the layout resolving the row means dictFallback.apply, which bails on any non-empty SeriesID, never gets to offer it: issuer=%q item=%q cusip=%q date=%q desc=%q series=%q want S000009326",
					r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		default:
			t.Errorf("fixture precondition: unexpected fund banner %q (series %q)", r.FundName, r.SeriesID)
		}
	}
	if plain != 16 || structured != 17 {
		t.Fatalf("fixture sections: plain=%d want 16, structured=%d want 17", plain, structured)
	}
}
