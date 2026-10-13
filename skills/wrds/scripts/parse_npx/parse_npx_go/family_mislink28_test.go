package main

import (
	"path/filepath"
	"testing"
)

// familyMislink28Dispatch runs the real dispatch on the family MISLINK28 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout, CIK, period, declared-series count and row
// count -- so a failure below is an assertion about the series id and never a
// broken fixture.
func familyMislink28Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink28", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink28", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	if meta.CIK != "0001091439" || meta.PeriodOfReport != "20100630" || len(meta.SeriesDecls) != 1 {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s decls=%d want 0001091439/20100630/1", meta.CIK, meta.PeriodOfReport, len(meta.SeriesDecls))
	}
	return rows
}

// 000109/1091439/0001091439-10-000029.txt (Allianz Variable Insurance Products
// Trust, CIK 0001091439, period 20100630, form N-PX, layout `issnpx`).
//
// Fixture `azl2010_nacminternational.txt`, assembled from six verbatim extracts
// of the real filing, whole-line drops only:
//
//  1. the SGML header top through the FILER block -- the
//     privacy-enhanced-message preamble, SEC-DOCUMENT / SEC-HEADER lines,
//     accession, submission type, period, and the whole FILER block including
//     `COMPANY CONFORMED NAME: ALLIANZ VARIABLE INSURANCE PRODUCTS TRUST` and
//     the FORMER COMPANY block.
//  2. the single `<SERIES>` declaration block for S000025368 verbatim. Every
//     other one of this registrant's ~30 declared series is dropped; this
//     filing genuinely does NOT declare S000017468 anywhere in its header.
//  3. the header closers through the HTML `<pre>` open tag.
//  4. the single vote-table section ruled `AZL NACM INTERNATIONAL FUND`, every
//     meeting in it verbatim (120 rows).
//  5. blank lines.
//  6. the report's closing lines from `========== END NPX REPORT` through
//     `</SEC-DOCUMENT>` plus the trailing privacy-enhanced-message footer.
//
// Every byte of those six extracts is verbatim; nothing is hand-typed or
// paraphrased.
//
// `azl1091439_dict.tsv` is the relevant slice of `cik_series.tsv` for this
// registrant, verbatim -- exactly two rows, tab separated:
//
//	0001091439	S000017468	AZL NACM International Fund	20070630	000109/1091439/0001091439-07-000028.txt
//	0001091439	S000025368	AZL NACM International Growth Fund	20090630	000109/1091439/0001091439-09-000032.txt
//
// THE SHAPE, IN THE BYTES. The filing's own header declares exactly ONE sleeve:
//
//	<SERIES-ID>S000025368  <SERIES-NAME>AZL NACM International Growth Fund
//
// and the body prints ONE section, under a banner that is NOT that name:
//
//	========================= AZL NACM INTERNATIONAL FUND ==========================
//
// The banner, normalized, is `AZL NACM International Fund` -- note the absent
// `Growth`. That string is the OWN EXACT DICTIONARY NAME of a DIFFERENT series of
// the SAME CIK, S000017468, declared by an earlier filing of this registrant at
// vintage 20070630. S000017468 is not declared anywhere in THIS filing's header.
// Every row of the section belongs to S000017468.
//
// Measured on the current tree, this fixture, that dictionary:
//
//	120 S000025368 "AZL NACM INTERNATIONAL FUND"   -- WRONG, want S000017468
//
// WHY THE WRONG ID SURVIVES. Every token of the banner is a subset of the tokens
// of the guessed declaration `AZL NACM International Growth Fund` -- the banner
// is that name minus `Growth` and nothing else. `issHeadingWithinDecl`
// (layout_issnpx.go:3580, consulted at :3472 and :3478) treats exactly that
// containment as proof that the heading "says nothing this declaration does not",
// so the banner is not counted as evidence AGAINST the declared sibling, the
// same-CIK correction guard never fires, and the tolerance-rung match to
// S000025368 stands for all 120 rows.
//
// The subset rule is right in general -- a body banner that merely abbreviates
// the declared name is not a contradiction -- but it is wrong here, because the
// abbreviation it produces is itself the exact, registrant-unique dictionary name
// of a DIFFERENT sleeve of the same CIK. `AZL NACM International Fund` does not
// say "less about S000025368"; it names S000017468.
//
// Fix location (for the separate fix task, not attempted here):
// `layout_issnpx.go` -- `issHeadingWithinDecl` must not report containment when
// the banner matches, exactly, a same-CIK dictionary name belonging to a series
// other than the declaration under test. Where no such rival name exists, the
// subset reading stays as it is today.
func TestFamilyMislink28AZLNACMInternationalSiblingExactDictName(t *testing.T) {
	rows := familyMislink28Dispatch(t, "azl2010_nacminternational.txt", "azl1091439_dict.tsv", "issnpx", 120)
	var banner, wrong int
	var first VoteRow
	for _, r := range rows {
		switch r.FundName {
		case "AZL NACM INTERNATIONAL FUND":
			banner++
			if r.SeriesID != "S000017468" {
				if wrong == 0 {
					first = r
				}
				wrong++
			}
		default:
			t.Errorf("fixture precondition: unexpected fund banner %q (series %q)", r.FundName, r.SeriesID)
		}
	}
	if banner != 120 {
		t.Fatalf("fixture section: AZL NACM INTERNATIONAL FUND banner rows=%d want 120", banner)
	}
	if wrong != 0 {
		t.Errorf("%d of %d rows under the body banner `AZL NACM INTERNATIONAL FUND` carry the WRONG series id: normalized, that banner is `AZL NACM International Fund`, the own exact dictionary name of a DIFFERENT same-CIK series S000017468 at vintage 20070630, which this filing's header never declares -- but because every banner token is a subset of the tokens of the one declared sleeve S000025368 `AZL NACM International Growth Fund` (the banner is that name minus `Growth`), issHeadingWithinDecl (layout_issnpx.go:3580, consulted at :3472 and :3478) reports the heading as saying nothing against that declaration, the same-CIK correction guard never fires, and the parser keeps its fuzzy/tolerance match to the declared but textually different sibling; first offender: issuer=%q item=%q cusip=%q date=%q desc=%q series=%q want S000017468",
			wrong, banner, first.IssuerName, first.ItemSeq, first.CUSIP, first.MeetingDate, first.VoteDescription, first.SeriesID)
	}
}
