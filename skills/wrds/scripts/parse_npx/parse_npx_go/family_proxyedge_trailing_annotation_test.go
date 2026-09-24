package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// 000008/88053/0000088053-05-000923.txt: verbatim source lines 1-58 (the
// PRIVACY-ENHANCED envelope through `<TEXT>`), 13491-13513 (the third `<PAGE>`,
// its `<TABLE>`, the YELL GROUP PLC block that HEAD already reads whole, and
// that block's first proposal), 18978-19019 (the ENI SPA, ROMA block and every
// proposal printed under it) and 19035-19044 (the ballot rows the filing prints
// after that block, which are what carry the block's context out as rows), then
// the filing's own last 26 lines 28100-28125 (`</TABLE>` through the end of the
// envelope) -- five unedited slices of the real file, no byte of which was
// retyped. Dispatches to `splittable` (the precondition asserts it).
//
// Scudder International Fund, Inc., CIK 88053, filing agent 0000088053, 2005
// (ADP/ProxyEdge plaintext report). Measured on HEAD over the WHOLE file:
// status=ok, layout=splittable, 5,286 rows, of which exactly 1,365 carry no
// security id -- and every one of those 1,365 carries issuer name
// `ENI SPA, ROMA` and meeting date 20050526. No other issuer in the filing
// loses its id. 92 lines of this one filing carry the `BLOCKING` token; ~85 of
// them are heading-block body lines of exactly the shape below.
//
// The shape. A normal ProxyEdge heading block in this filing, source lines
// 13493-13497, which HEAD reads whole (issuer=`YELL GROUP PLC`,
// cusip=`G9835W104`, type=`AGM`, date=`20040713`):
//
//   - ------------------------------------------------------------------ ... ---
//     YELL GROUP PLC                                    AGM Meeting Date: 07/13/2004
//     Issuer: G9835W104                              ISIN: GB0031718066
//     SEDOL:  3171806
//   - ------------------------------------------------------------------ ... ---
//
// The ENI block, source lines 18978-18982, differs in exactly one respect --
// a THIRD, bare, colon-free token printed after the ISIN value:
//
//   - ------------------------------------------------------------------ ... ---
//     ENI SPA, ROMA                                     OGM Meeting Date: 05/26/2005
//     Issuer: T3643A145                   ISIN: IT0003132476            BLOCKING
//     SEDOL:  7145056, 7146059, B020CR8, B07LWK9
//   - ------------------------------------------------------------------ ... ---
//
// `BLOCKING` is a printed vendor annotation -- a share-blocking notice for this
// market, the same fact the block's own non-voting proposal spells out at
// source lines 18994-18996 (`YOUR SHARES WILL BE BLOCKED UNTIL THE QUORUM IS
// MET`). It is NOT a link key and must never be captured as one. It simply must
// not stop the reader from taking the `Issuer:` and `ISIN:` pairs that ARE
// printed on the same line.
//
// Where it falls through, in layout_splittable.go. spProxyEdgeSecurityID
// (:1424) splits the body line into cells and requires
// `len(pairs) != len(cells)` to be FALSE -- i.e. it demands that EVERY cell on
// the line parse as a `LABEL: value` pair. On the YELL line the two cells are
// `Issuer: G9835W104` and `ISIN: GB0031718066`, both pairs, so the guard passes
// and `T3643A145`'s counterpart is banked. On the ENI line the third cell is
// the bare `BLOCKING` token, which lvPairs cannot pair, so `len(pairs)` is 2
// against `len(cells)` 3, the function returns `("", false)`, and BOTH callers
// go dead with it: spIsProxyEdgeHeadingBody (:1240) no longer recognises the
// line as heading-block body, and spReadProxyEdgeHeading's id arm (:1326) never
// fires. The heading line above it still opens the block, so issuer, meeting
// type and meeting date survive; the CUSIP alone is dropped, and every row the
// block goes on to carry is emitted with a blank security id even though
// `T3643A145` and `IT0003132476` are printed on the face of the filing.
//
// The guard itself is right in principle -- its comment says a stacked
// column-header line that happens to carry a colon must never be read as an id,
// and that is what the all-pairs test buys. The fix is to widen the accepted
// cell vocabulary, not to drop the test: a cell that is a `LABEL: value` pair
// OR a bare colon-free annotation token is acceptable, and the id is still
// taken only from the `CUSIP`/`ISSUER` pair, copied verbatim, never derived
// from the annotation.
//
// Rows affected: 1,365 on this filing.
func TestFamilyProxyEdgeTrailingAnnotationBlocksSecurityID(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	dir := filepath.Join("testdata", "family_proxyedge_trailing_annotation")
	fixture := "scudder_intl_blocking_annotation.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "splittable" || len(rows) != 4 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=4 error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	// Control: the YELL GROUP PLC block carries no trailing annotation and is
	// read whole on HEAD. If this row ever goes blank the fixture has stopped
	// isolating the annotation and the test below proves nothing.
	control := rows[0]
	if control.IssuerName != "YELL GROUP PLC" || control.CUSIP != "G9835W104" || control.MeetingDate != "20040713" {
		t.Fatalf("control precondition: the un-annotated YELL GROUP PLC block must still read whole; got issuer=%q cusip=%q date=%q", control.IssuerName, control.CUSIP, control.MeetingDate)
	}

	// Every row the ENI SPA, ROMA block carries must hold the id that block
	// prints -- `Issuer: T3643A145`, copied exactly as printed -- and the
	// meeting date 05/26/2005 the same heading prints (normalised to YYYYMMDD
	// by htmlDate, as the control row's 20040713 shows).
	var eni int
	for i, r := range rows {
		if !strings.Contains(r.IssuerName, "ENI SPA") {
			continue
		}
		eni++
		if r.IssuerName != "ENI SPA, ROMA" || r.CUSIP != "T3643A145" || r.MeetingDate != "20050526" {
			t.Errorf("row %d: the trailing BLOCKING annotation lost the ENI SPA, ROMA security id: issuer=%q cusip=%q type=%q date=%q item=%q desc=%.40q; want issuer=%q cusip=%q date=%q",
				i, r.IssuerName, r.CUSIP, r.MeetingType, r.MeetingDate, r.ItemSeq, r.VoteDescription,
				"ENI SPA, ROMA", "T3643A145", "20050526")
		}
		// BLOCKING is a vendor annotation, never a link key. Widening the
		// reader must not let it reach any identity field.
		if strings.Contains(strings.ToUpper(r.CUSIP), "BLOCKING") || strings.Contains(strings.ToUpper(r.Ticker), "BLOCKING") {
			t.Errorf("row %d: the BLOCKING annotation was captured as an identifier: cusip=%q ticker=%q; it is a share-blocking notice, not a link key", i, r.CUSIP, r.Ticker)
		}
	}
	if eni != 3 {
		t.Fatalf("fixture precondition: want 3 rows carrying the ENI SPA, ROMA block, got %d", eni)
	}
}
