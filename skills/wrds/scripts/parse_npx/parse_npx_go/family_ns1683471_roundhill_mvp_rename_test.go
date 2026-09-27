package main

import (
	"path/filepath"
	"testing"
)

// Listed Funds Trust (CIK 0001683471), verbatim bytes from its 2022 N-PX,
// 000168/1683471/0000894189-22-006566.txt (period 20220630, md5
// e3c79e070762dc48c70754fa02177d2c, 15,990 lines), broadridge layout.
//
// Fixture roundhill_mvp_2022.txt is `sed -n '1,149p;8532,8667p;15969,15990p'`
// over that file, concatenated in that order and otherwise untouched:
//
//	1-149       the SGML header (6 <SERIES> declarations), the FORM N-PX
//	            preamble, and the document's own `<PAGE>` / `<TABLE>` /
//	            `<S> <C>` opener at lines 145-148. The opener is load-bearing
//	            for dispatch, not decoration -- the filing carries exactly one
//	            `<TABLE>` (line 147) and one `</TABLE>` (line 15972).
//	8532-8667   the `Roundhill MVP ETF` banner as printed at line 8535, plus
//	            the whole of the two ballots that follow it -- AFC AJAX N.V.
//	            agenda 714715678 (Security N01011118, AGM, 12-Nov-2021) and
//	            agenda 714987382 -- cut immediately before the next issuer's
//	            rule at 8668 (AS ROMA SPA).
//	15969-15990 the `* Management position unknown` footer, the document's
//	            own `</TABLE>`, the SIGNATURES block and the trailing
//	            `</TEXT>` / `</DOCUMENT>` / `</SEC-DOCUMENT>` tags.
//
// Dictionary: all 101 cik_series.tsv rows this CIK carries, copied verbatim
// from the corpus dictionary (`grep '^0001683471' cik_series.tsv`).
//
// THE DEFECT. The body prints EIGHT bold fund banners; the header declares
// SIX series (S000065293, S000068603, S000072321, S000073924, S000074090,
// S000074284). The two undeclared banners are `Roundhill MVP ETF` and
// `Roundhill Streaming Services & Technology ETF`.
//
// The Streaming banner already resolves, on no new rung: it is an EXACT match
// to this same CIK's own dictionary row S000070922 (`Roundhill Streaming
// Services & Technology ETF`, vintage 20210630, filing
// 000168/1683471/0000894189-21-006229.txt), which the layout-agnostic
// same-CIK fallback reaches. `Roundhill MVP ETF` does not, and all 382 of its
// rows carry a blank series_id -- measured over the REAL filing with
// `-series-map series_map_applied.tsv -cik-series cik_series.tsv`, and that
// 382 is this CIK's ENTIRE current known-registrant no_series residue.
//
// It does not resolve because the string exists in no dictionary row at all:
// `grep -ci "Roundhill MVP" cik_series.tsv` == 0, corpus-wide, at every CIK
// and every vintage. No name-based rung can reach it, because the successor
// shares no distinctive word with it.
//
// It is nonetheless a real, externally-audited, SAME-REGISTRANT rename, not
// an undeclared or unfixable fund. `Roundhill MVP ETF` (ticker MVP) was the
// fund's ORIGINAL launch name, carried by a March 2021 summary prospectus
// filed under this same CIK 1683471:
//
//	https://www.sec.gov/Archives/edgar/data/1683471/000089418921001546/roundhillmvpsummaryprospec.htm
//
// The fund was later renamed `Roundhill Pro Sports, Media & Apparel ETF`,
// which IS a dictionary row of this SAME CIK:
//
//	0001683471  S000071254  Roundhill Pro Sports, Media & Apparel ETF
//	            20210630    000168/1683471/0000894189-21-006229.txt
//
// -- declared at the vintage immediately preceding this filing, in the same
// 2021 N-PX that declares the Streaming series. Both ends of the rename are
// therefore documented and registrant-scoped: exactly the evidentiary shape
// issRegistrantRenames / issAuditedRenameAliases (layout_issnpx.go:8156-8500)
// already carries for CIKs 0001385533, 0000755221, 0000702340, 0000810573 and
// the American AAdvantage entries -- see family_ns_svs2_redesignation_test.go,
// family_ns_penn_growth_equity_test.go and family_ns_svs2_abbrev_test.go.
//
// WHERE THE FIX BELONGS -- the brief's architectural hypothesis is REFUTED,
// read off the code rather than assumed. issRegistrantRenames is NOT wired
// only through the issnpx layout. issAuditedRenameAliases is called from
// issFilingIndex (layout_issnpx.go:1911), and issFilingIndex is the
// layout-agnostic index constructor: broadridge builds it at
// layout_broadridge.go:1621, exactly as icr, labelvalue, splittable, twoband,
// agenda, vanguard, pvtext, proxyedge, votesummary, htmltable and issnpx all
// do. The file says as much in its own comment above that call -- "The audited
// rename table is registrant-scoped, not layout-scoped ... a rename the
// registrant made is the same fact whichever vendor typeset the report" --
// and names American AAdvantage Funds 2004, a broadridge filing, as the case
// that forced it there.
//
// So the fix is ONE entry in issRegistrantRenames["0001683471"] keying
// `roundhill mvp etf` onto `Roundhill Pro Sports, Media & Apparel ETF`, and it
// reaches this broadridge filing through the existing wiring. No new
// broadridge-side plumbing is needed, and none should be written: the
// successor resolves through issAuditedRenameAliases's own dictionary rung
// (issIndexDict(ix).registrantExactName), which is the registrant-scoped,
// exact, contemporaneity-tiebroken lookup, and S000071254 is the only row of
// this CIK answering to that name.
//
// The one thing worth noting for whoever lands it: every existing entry in
// issRegistrantRenames is a PRE-2006 rename, and the table's doc comment is
// written around the pre-2006 tagging gap ("EDGAR tags no series before
// 2006"). This entry is not -- it is a 2022 filing whose header tags six
// series and simply omits the two the body still prints. Neither
// issAuditedRenameAliases nor addAlias gates on period, so the mechanism
// carries it unchanged; the doc comment is what would need widening.
//
// The parser currently reads the banner verbatim into the fund-name column
// and leaves series_id blank.
func TestFamilyNS1683471RoundhillMVPRenameResolves(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns1683471_roundhill_mvp_rename", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		fixture = "roundhill_mvp_2022.txt"
		heading = "Roundhill MVP ETF"
		want    = "S000071254" // Roundhill Pro Sports, Media & Apparel ETF
		// The banner that already resolves on the ordinary same-CIK
		// dictionary fallback, asserted as a contrast so a fix that reaches
		// the MVP banner by loosening that rung is visible as a regression
		// here rather than corpus-wide.
		contrast   = "Roundhill Streaming Services & Technology ETF"
		contrastID = "S000070922"
	)

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns1683471_roundhill_mvp_rename", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.CIK != "0001683471" || meta.PeriodOfReport != "20220630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}

	var under []VoteRow
	for _, r := range sink.buf {
		if r.FundName == heading {
			under = append(under, r)
		}
	}
	if len(under) == 0 {
		t.Fatalf("fixture precondition: no rows under %q (fixture emitted %d rows in total)", heading, len(sink.buf))
	}

	blank := 0
	var first VoteRow
	for _, r := range under {
		if r.SeriesID != want {
			if blank == 0 {
				first = r
			}
			blank++
		}
	}
	if blank > 0 {
		t.Errorf("banner %q: %d of %d rows carry series=%q, want %s -- `Roundhill MVP ETF` (ticker MVP) is the ORIGINAL launch name of the fund later renamed `Roundhill Pro Sports, Media & Apparel ETF`, per the March 2021 summary prospectus filed under this same CIK 1683471 (https://www.sec.gov/Archives/edgar/data/1683471/000089418921001546/roundhillmvpsummaryprospec.htm), and that successor is this same CIK's own dictionary row `0001683471\tS000071254\tRoundhill Pro Sports, Media & Apparel ETF\t20210630\t000168/1683471/0000894189-21-006229.txt`; the printed name itself appears in NO dictionary row at any CIK or vintage (grep -ci \"Roundhill MVP\" cik_series.tsv == 0), so no name rung can reach it and only the registrant-scoped audited rename table can. First unresolved row: issuer=%q item=%q meeting=%q desc=%.60q",
			heading, blank, len(under), first.SeriesID, want,
			first.IssuerName, first.ItemSeq, first.MeetingDate, first.VoteDescription)
	}

	// Contrast: nothing about the wanted fix may disturb the banner that the
	// ordinary exact same-CIK dictionary fallback already answers. This
	// fixture cuts the Streaming section out, so assert only if it is present.
	for _, r := range sink.buf {
		if r.FundName == contrast && r.SeriesID != contrastID {
			t.Errorf("contrast banner %q regressed: series=%q, want %s (exact match to this CIK's own dictionary row, vintage 20210630)", contrast, r.SeriesID, contrastID)
			break
		}
	}
}
