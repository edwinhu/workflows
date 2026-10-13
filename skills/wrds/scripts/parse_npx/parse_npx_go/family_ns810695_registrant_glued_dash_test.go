package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 000081/810695/0001580642-17-004563.txt (Mutual Fund & Variable Insurance
// Trust, CIK 810695, period 20170630, 27,029 lines): 356 of 1,291 rows come out
// with no fund name and no series at all. Measured on HEAD over the filing as
// EDGAR serves it, with no dictionary and no overlay loaded -- the filing's own
// SGML header declares all twelve of this registrant's series, so nothing here
// depends on a lookup:
//
//	FULL REAL FILING: status=ok layout=htmltable rows=1291 blank_series=356
//	  356  |
//	  777  S000005874|Rational Defensive Growth Fund
//	  158  S000057627|Rational Select Asset Fund
//
// THE BANNER THE FILING PRINTS. Source line 460, the first filled cell of the
// first section's cover row, glues the registrant and the sleeve into ONE cell
// on either side of a dash:
//
//	<TD COLSPAN="5"><B>Registrant:  Mutual Fund &amp; Variable Insurance Trust-&nbsp;&nbsp;Rational Dividend Capture Fund&nbsp;...</B></TD>
//	<TD>&nbsp;</TD>
//	<TD STYLE="text-align: center"><B>Rational Dividend Capture Fund</B></TD>
//	... spacers ...
//	<TD STYLE="text-align: right"><FONT ...>Exhibit 1</FONT></TD>
//
// Three filled cells once the spacers are dropped, measured off these bytes
// with htmlRowCells:
//
//	cuttable=true filled=3 ncells=11
//	  cell[4]="Registrant:  Mutual Fund & Variable Insurance Trust-  Rational Dividend Capture Fund"
//	  cell[6]="Rational Dividend Capture Fund"
//	  cell[10]="Exhibit 1"
//
// IT FALLS THROUGH EVERY READER. All three `Registrant:` helpers refuse it, and
// the count of filled cells keeps it away from the two-cell heading path:
//
//		htmlRegistrantSplitCells      -> "" ok=false
//		htmlRegistrantEmptySuffixFund -> "" ok=false
//		htmlRegistrantMastheadBanner  -> "" ok=false
//
//	  - htmlRegistrantSplitCells wants the label alone in its cell; here filled[0]
//	    is the whole glued string, so the `Registrant` equality fails.
//	  - htmlRegistrantEmptySuffixFund wants the cell to END at the dash
//	    (reHTMLRegistrantEmptySuffix). Measured on this cell: reEmptySuffix=false,
//	    because the sleeve follows the dash inside the same cell.
//	  - htmlRegistrantMastheadBanner is the one reader whose regexp DOES accept
//	    the shape -- reMasthead=true on this cell -- but it refuses on position:
//	    the label is filled[0], so `at == 0` and `if at < 1` returns. Its doc
//	    comment sends that case to "the readers above", and neither reader above
//	    accepts content after the dash. Nothing owns the row.
//	  - htmlFilledCells(cells) == 3, so the `<= 2` path never sees it either. The
//	    two extra cells are the repeated sleeve name and the exhibit marker.
//
// A second measured fact for whoever fixes this, so the fix is not attempted at
// `at < 1` alone: the masthead reader also requires every cell AFTER the label
// to match reHTMLSplitExhibit, which is anchored on `Item N, Exhibit X`. This
// row prints a bare `Exhibit 1` -- reHTMLSplitExhibit=false,
// reHTMLRegistrantRowMarker=true -- and a repeated sleeve name besides. Two
// conditions, not one.
//
// THE COST IS LARGER THAN THE 356, and the rest of it is silent. The filing
// prints this glued shape FOUR times and the dash-terminated shape
// htmlRegistrantEmptySuffixFund does read once (source line 4802). Each section
// measured in isolation, header attached, same binary:
//
//	lines 458-4800:    rows=356  map[|:356]                                        <- Rational Dividend Capture Fund
//	lines 4800-7245:   rows=197  map[S000005874|Rational Defensive Growth Fund:197] <- dash-terminated, read
//	lines 7245-11509:  rows=349  map[|:349]                                        <- Rational Dividend Capture VA Fund
//	lines 11509-14359: rows=231  map[|:231]                                        <- Rational Insider Buying VA Fund
//	lines 16317-16397: rows=2    map[|:2]                                          <- Rational Strategic Allocation Fund
//
// 938 rows in total belong to a banner no reader takes. Only the first 356 show
// up blank in a whole-file run because a fall-through leaves curFund untouched:
// once section two sets S000005874, sections three through five INHERIT it, so
// 582 rows are stamped `Rational Defensive Growth Fund` while the filing prints
// `Rational Dividend Capture VA Fund`, `Rational Insider Buying VA Fund` and
// `Rational Strategic Allocation Fund` over them. The blank count understates
// the defect; the misattribution is the same missing read.
//
// SO THIS IS NOT A FLOOR AND NOT A LOOKUP FAILURE. The sleeve is printed in the
// filing, twice in the same row, and the filing's own header declares it:
//
//	<OWNER-CIK>0000810695
//	<SERIES-ID>S000005856
//	<SERIES-NAME>Rational Dividend Capture Fund
//
// The fixture is two contiguous cuts of the filing as EDGAR serves it, byte for
// byte: lines 1-309 (the whole SGML header through `<BODY>`, all twelve series
// declarations intact) and lines 458-529 (the `<TABLE>`, the glued banner row,
// the File #/Reporting Period/column-header rows, and the first Accenture PLC
// ballot). The header is kept whole on purpose: twelve declared series are in
// scope, so no single-series fallback can resolve this row for the wrong reason.
func TestFamilyNS810695RegistrantGluedDashBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	// No dictionary and no overlay: the filing's own header is the only source
	// of S000005856, exactly as in the measurement above.
	cikDict, seriesMap = nil, nil

	const (
		fixture  = "mfvit2017_registrant_glued_dash_banner.txt"
		wantID   = "S000005856"
		wantFund = "Rational Dividend Capture Fund"
		// banner is the glued cell at source line 460, as it reads once the
		// entities are decoded.
		banner = "Registrant:  Mutual Fund &amp; Variable Insurance Trust-&nbsp;&nbsp;Rational Dividend Capture Fund"
	)
	path := filepath.Join("testdata", "family_ns810695_registrant_glued_dash", fixture)

	// The cut still carries the banner. Without this the assertions below could
	// pass or fail for a reason that is not the grammar.
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), banner) {
		t.Fatalf("fixture guard: the cut does not contain the glued banner cell %q -- source line 460 is no longer in it", banner)
	}

	sink := &rowSink{}
	meta := processFile(fixture, path, sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || len(sink.buf) != 1 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=1 error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	// Twelve declared series, S000005856 among them: the row cannot resolve by
	// being the registrant's only sleeve.
	declared := false
	for _, d := range meta.SeriesDecls {
		if d.SeriesID == wantID {
			declared = true
		}
	}
	if len(meta.SeriesDecls) != 12 || !declared {
		t.Fatalf("fixture guard: the header should declare 12 series including %s, got %d declarations declared=%v -- the cut lost the SERIES-AND-CLASSES-CONTRACTS-DATA block", wantID, len(meta.SeriesDecls), declared)
	}

	r := sink.buf[0]
	if r.IssuerName != "Accenture PLC" || r.ItemSeq != "1" {
		t.Fatalf("fixture guard: the row read is issuer=%q item=%q, want the first Accenture PLC proposal at source lines 518-529", r.IssuerName, r.ItemSeq)
	}
	if r.SeriesID != wantID || r.FundName != wantFund {
		t.Errorf("the Accenture PLC proposal 1 row of the section opened at source line 460: fund=%q series=%q, want fund=%q series=%s -- the section's banner glues `Registrant: <registrant>-  <sleeve>` into one cell with the sleeve AFTER the dash, and the filing's own header declares that sleeve; htmlRegistrantSplitCells, htmlRegistrantEmptySuffixFund and htmlRegistrantMastheadBanner all refuse the row and htmlFilledCells==3 keeps it off the two-cell path, so the banner is never read",
			r.FundName, r.SeriesID, wantFund, wantID)
	}
}
