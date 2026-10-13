package main

import (
	"path/filepath"
	"testing"
)

// familyMislink25Dispatch runs the real dispatch on the family MISLINK25 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout, CIK, period, declared-series count and row
// count -- so a failure below is an assertion about the series id and never a
// broken fixture.
func familyMislink25Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink25", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink25", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	if meta.CIK != "0001121257" || meta.PeriodOfReport != "20070630" || len(meta.SeriesDecls) != 2 {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s decls=%d want 0001121257/20070630/2", meta.CIK, meta.PeriodOfReport, len(meta.SeriesDecls))
	}
	return rows
}

// 000112/1121257/0001121257-07-000037.txt (JNL Investors Series Trust -- the
// Jackson National Life variable annuity trust, CIK 0001121257, period 20070630,
// form N-PX, layout `issnpx`).
//
// Fixture `jacksonperspective2007_5fund.txt`, assembled from four verbatim
// extracts of the real filing, whole-line drops only:
//
//  1. lines 1-41: the SGML header top (SEC-DOCUMENT / SEC-HEADER / accession /
//     submission type / period / dates / the whole FILER block including
//     `COMPANY CONFORMED NAME: JNL INVESTORS SERIES TRUST` and both addresses),
//     then `<SERIES-AND-CLASSES-CONTRACTS-DATA>` /
//     `<EXISTING-SERIES-AND-CLASSES-CONTRACTS>`.
//  2. lines 51-68: the `<SERIES>` declaration blocks of S000014530 and
//     S000014531 verbatim -- every `<OWNER-CIK>` / `<SERIES-ID>` /
//     `<SERIES-NAME>` / `<CLASS-CONTRACT-ID>` / `<CLASS-CONTRACT-NAME>` line
//     kept, since `parseSeriesDecls` builds the chassis's triples one per
//     `<CLASS-CONTRACT-ID>` and the declared set IS the evidence the resolver
//     reads.
//  3. lines 132-156: the header closers, `<DOCUMENT>` / `<TYPE>N-PX` /
//     `<SEQUENCE>` / `<FILENAME>` / `<TEXT>`, and the FORM N-PX title block down
//     to the registrant's address.
//  4. lines 219-268: the ruled `JACKSON PERSPECTIVE 5 FUND` section banner with
//     the whole of ABBOTT LABORATORIES' 27-Apr-2007 annual meeting and the whole
//     of ADVANCED ENERGY INDUSTRIES, INC.'s 2-May-2007 annual meeting under it,
//     each closed by its own `- ----` rule.
//
// Every byte of those four extracts is verbatim; nothing is hand-typed or
// paraphrased. Only whole lines were dropped: the other eight `<SERIES>` blocks
// this registrant declares (S000001684 and S000014532-S000014538), the empty
// `JACKSON PERSPECTIVE 10 X 10 FUND` banner that immediately precedes the 5 Fund
// banner at line 217, the Item 1 narrative between the address block and the
// banner, and every issuer block after Advanced Energy (Altria onward) together
// with the sibling sections `JACKSON PERSPECTIVE INDEX 5 FUND`, `... MONEY
// MARKET FUND`, `... OPTIMIZED 5 FUND` and `JNL MONEY MARKET FUND`. The three
// SGML structure tags that close what those drops cut open -- `</TEXT>`,
// `</DOCUMENT>`, `</SEC-DOCUMENT>` -- are the only lines in the file that are
// not lifted from the filing, and they carry no name, id or vote.
//
// `jackson1121257_dict.tsv` is the whole of `cik_series.tsv` for this fund
// family, verbatim -- exactly three rows, tab separated:
//
//	0001121257	S000014530	Jackson Perspective 5 Fund (A)	20070630	000112/1121257/0001121257-07-000037.txt
//	0001121257	S000014530	Jackson Perspective 5 Fund	20080630	000112/1121257/0001121257-08-000026.txt
//	0001121257	S000014531	Jackson Perspective 5 Fund (C)	20070630	000112/1121257/0001121257-07-000037.txt
//
// THE SHAPE, IN THE BYTES. This registrant's own header declares two series
// whose names differ by nothing but a parenthesised share-class letter:
//
//	<SERIES-ID>S000014530  <SERIES-NAME>Jackson Perspective 5 Fund (A)
//	<SERIES-ID>S000014531  <SERIES-NAME>Jackson Perspective 5 Fund (C)
//
// and the body prints ONE section, under a banner that carries no suffix at all:
//
//	========================== JACKSON PERSPECTIVE 5 FUND ==========================
//
// THE COLLISION, PROBED rather than assumed. `header.go`'s
// `normalizeSeriesName` lower-cases, then runs `seriesMarkReplacer` (line 279,
// replacer at line 309), whose job is to delete a trademark or copyright MARK --
// `(r)`, `(tm)`, `(sm)`, `(c)` -- so that `Fund(c)` folds onto `fund`. Run on
// these two declared names and on the banner it yields, measured by calling it
// directly:
//
//	normalizeSeriesName("Jackson Perspective 5 Fund (A)") -> "jackson perspective 5 fund a"
//	normalizeSeriesName("Jackson Perspective 5 Fund (C)") -> "jackson perspective 5 fund"
//	normalizeSeriesName("JACKSON PERSPECTIVE 5 FUND")     -> "jackson perspective 5 fund"
//
// The `(A)` sibling is untouched by the replacer, so its `a` survives punctuation
// folding as a trailing token and its key does NOT collide. The `(C)` sibling's
// share-class marker is byte-identical to the copyright mark the replacer exists
// to delete, so it is deleted, and S000014531's key becomes the bare banner's own
// key, byte for byte.
//
// That collision feeds straight into `layout_issnpx.go`'s exact-match maps --
// `ix.byHistoricalBrand`, `ix.byCompact` and the rest, all built from
// `key := normalizeSeriesName(d.Name)` around line 2312 -- so the bare banner
// exact-matches S000014531, the C share class. Measured on the current tree,
// this fixture, that dictionary:
//
//	27 S000014531 "JACKSON PERSPECTIVE 5 FUND"   -- WRONG, want S000014530
//
// Nothing is guessed by fixing it. `cik_series.tsv` shows S000014530 -- the (A)
// share class -- LATER redeclared with the bare name, no suffix at all, at
// vintage 20080630 in this registrant's next annual filing
// (000112/1121257/0001121257-08-000026.txt). The bare spelling is this series'
// own eventual canonical name; it is never S000014531's, at any vintage. The
// 2007 bare banner therefore belongs to S000014530, and the only thing that
// points it at S000014531 is a mark-stripping rule misfiring on a share-class
// letter that happens to be `C`.
//
// Same class as families MISLINK23 (2e2ec1c5) and MISLINK24 (0b8f5a6c) -- an
// exact-looking match inside the layout claims a row for the wrong series of the
// same CIK -- but here the wrong match is manufactured by the KEY FUNCTION
// rather than by a rung: two distinct declared names are folded onto one string
// before any resolver runs, so no amount of rung ordering can tell them apart.
//
// Fix location: `header.go` -- `seriesMarkReplacer` must not delete `(c)` when it
// is a share-class marker rather than a copyright mark (a lone parenthesised
// letter in a family whose siblings spell `(A)`, `(B)`, `(I)` … is a class, and a
// trailing `(c)` on a name whose sibling declarations differ only by that letter
// cannot be a mark), or, equivalently, the exact-match maps built from
// `key := normalizeSeriesName(d.Name)` around `layout_issnpx.go` line 2312 must
// refuse a key that two declared names of the same registrant collapse onto and
// let the dictionary's bare-name vintage answer instead. Either predicate leaves
// the (A) sibling's key untouched.
func TestFamilyMislink25JacksonPerspectiveClassMarkerCollision(t *testing.T) {
	rows := familyMislink25Dispatch(t, "jacksonperspective2007_5fund.txt", "jackson1121257_dict.tsv", "issnpx", 27)
	var bare int
	for _, r := range rows {
		switch r.FundName {
		case "JACKSON PERSPECTIVE 5 FUND":
			bare++
			if r.SeriesID != "S000014530" {
				t.Errorf("normalizeSeriesName runs seriesMarkReplacer, which deletes the literal substring `(c)` to strip a copyright mark; on the declared name `Jackson Perspective 5 Fund (C)` it also deletes the SHARE-CLASS marker, so S000014531's key folds to `jackson perspective 5 fund` -- byte for byte the bare banner's own key -- while sibling S000014530's `(A)` survives as a trailing ` a` token and does not collide; the exact-match maps built from key := normalizeSeriesName(d.Name) around layout_issnpx.go line 2312 therefore hand this bare-banner section to the C share class, although cik_series.tsv shows S000014530 itself redeclared with the bare name at vintage 20080630 (000112/1121257/0001121257-08-000026.txt), making the bare spelling S000014530's own canonical name and never S000014531's: issuer=%q item=%q cusip=%q date=%q desc=%q series=%q want S000014530",
					r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		default:
			t.Errorf("fixture precondition: unexpected fund banner %q (series %q)", r.FundName, r.SeriesID)
		}
	}
	if bare != 27 {
		t.Fatalf("fixture section: bare Jackson Perspective 5 Fund banner rows=%d want 27", bare)
	}
}
