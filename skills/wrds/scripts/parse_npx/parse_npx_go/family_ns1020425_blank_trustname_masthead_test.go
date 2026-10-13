package main

import (
	"path/filepath"
	"testing"
)

// CIK 0001020425 (MASTERS SELECT FUNDS TRUST) files
// 000102/1020425/0000894189-10-003387.txt for period 20100630 as an EDGARizer
// htmltable document whose vendor reprints a `Name of Fund:` masthead once per
// proxy-record sub-block, each masthead a two-cell table row: the label in the
// first cell and the fund in the second.
//
// The filing's own SEC-HEADER SERIES-AND-CLASSES-CONTRACTS-DATA block (source
// lines 63-126) declares exactly five sleeves, and no dictionary or series map
// is needed to read them:
//
//	S000005593  The Masters' Select Equity Fund
//	S000005594  The Masters' Select International Fund
//	S000005595  The Masters' Select Value Fund
//	S000005596  The Masters' Select Smaller Companies Fund
//	S000012467  The Masters' Select Focused Opportunities Fund
//
// Every masthead in the filing names one of those five -- with one exception.
// The masthead at source line 20432 puts the trust's OWN umbrella name in the
// value cell, `Masters' Select Funds`, against a COMPANY CONFORMED NAME of
// `MASTERS SELECT FUNDS TRUST`. It names no sleeve, so the 360 rows of the
// sub-block it opens (source tables 20420-23859 and 23891-30555, a page-break
// continuation carrying no masthead of its own) are emitted with
// fund_name="Masters' Select Funds" and a BLANK series_id. The same shape
// recurs in this registrant's second filing of the same period,
// 000102/1020425/0000894189-10-003570.txt, at source line 20117, for another
// 360 blank rows; measured over the real full bytes of both filings with
// -series-map and -cik-series supplied, those 720 rows are the registrant's
// entire blank-series population and every one of them carries that same
// fund_name.
//
// The block is readable, and what makes it readable is the masthead that comes
// NEXT. Between the trust-name masthead at 20432 and source line 30588 there is
// no other `Name of Fund:` heading anywhere in the filing, and 30588's value
// cell reads `LITMAN GREGORY - MASTERS SELECT INTERNATIONAL FUND  (NC, LLC)`,
// which HEAD already resolves to S000005594 on its own; the masthead after that
// one (source line 39764, `MASTERS SELECT INTL FUND`) resolves to S000005594
// too. All of it sits after the Equity sleeve's own five named sub-blocks end
// (source lines 2041, 4350, 7603, 10910, 17240) and before the Value sleeve's
// named sub-blocks begin (source line 56542, `MASTERS SELECT VALUE FUND- BILL
// NYGREN'S SLEEVE`), so the blank block is bracketed by International content
// on the far side and nothing else claims it. The holdings confirm it
// independently: the blank block's eleven issuers (Amdocs, Babcock & Brown Air,
// Dell, Embraer, Gazprom, ING Groep, ORIX, Potash Corp of Saskatchewan,
// Rolls-Royce, Royal Philips Electronics) are foreign and ADR-style and share
// nothing with the 80 issuers under this filing's own Equity sleeve mastheads.
//
// The rule this test asserts is therefore a LOOK-AHEAD rung, the mirror of the
// look-behind icrCaptionFundAbove already does in layout_icr.go: a masthead
// whose value cell resolves to no declared sleeve AND equals the filing's own
// registrant name under case/whitespace normalisation (`Masters' Select Funds`
// against `MASTERS SELECT FUNDS TRUST`, the conformed name's trailing `TRUST`
// being the only difference) carries its rows forward to the NEXT masthead,
// provided that masthead resolves to exactly one declared sleeve and no other
// real fund banner intervenes. Refuse -- leave the rows blank, as today -- when
// the next masthead resolves to nothing or to more than one sleeve, or when a
// second distinct real banner sits in between. Nothing here licenses reaching
// another registrant's names: the look-ahead target must be one of this
// filing's own five header declarations.
//
// The fixture is three verbatim, unedited slices of the real filing, cut at its
// own table and div boundaries: source lines 1-144 (the whole SEC-HEADER
// including all five SERIES-NAME declarations, the document preamble, `<TEXT>`,
// `<html>` and the opening `<body>`), source lines 20416-20600 (the div wrapper
// and `<table>` that open the trust-name masthead at 20432, its `Period:` row,
// its `Company Name / Meeting Date / CUSIP / Ticker` band, the Dell Inc.
// meeting's identity row and that meeting's first eight proposals) and source
// lines 30580-30737 (the div wrapper and `<table>` that open the
// `LITMAN GREGORY - MASTERS SELECT INTERNATIONAL FUND  (NC, LLC)` masthead at
// 30588, its `Period:` row, its own five-column band and the BHP BILLITON PLC
// meeting's first four proposals) -- each slice closed with a synthesised
// `</tr></table>` plus its two `</div>`, since the real closes sit past the cut,
// and a synthesised
// `</body>/</html>/</TEXT>/</DOCUMENT>/</SEC-DOCUMENT>` to end the excerpt.
// Nothing inside a slice is edited and no line is moved between them.
//
// Measured against HEAD, the fixture reproduces the full filing's behaviour on
// both blocks: layout htmltable, status ok, 12 rows -- 8 under the trust-name
// masthead, all blank, and 4 under the International masthead, all S000005594.
func TestFamilyNS1020425BlankTrustNameMasthead(t *testing.T) {
	const fixture = "masters_select_2010_blank_trustname.txt"

	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict, seriesMap = nil, nil

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns1020425_blank_trustname_masthead", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0001020425" || meta.CompanyName != "MASTERS SELECT FUNDS TRUST" || len(sink.buf) != 12 {
		t.Fatalf("dispatch precondition: status=%s layout=%s CIK=%s company=%q rows=%d want=12 error=%s", meta.ParseStatus, meta.Layout, meta.CIK, meta.CompanyName, len(sink.buf), meta.ErrorMsg)
	}

	// The control half of the fixture. This masthead names the sleeve outright
	// and HEAD already reads it; if this side ever goes wrong the look-ahead
	// below has no target and the assertion under it would be measuring
	// nothing.
	const intlLabel = "LITMAN GREGORY - MASTERS SELECT INTERNATIONAL FUND  (NC, LLC)"
	intl, intlBad := 0, 0
	for _, r := range sink.buf {
		if r.FundName != intlLabel {
			continue
		}
		intl++
		if r.SeriesID != "S000005594" {
			intlBad++
		}
	}
	if intl != 4 {
		t.Fatalf("fixture precondition: %d rows carry the International masthead label %q, want 4 -- the fixture's second slice changed", intl, intlLabel)
	}
	if intlBad > 0 {
		t.Fatalf("control regressed: %d of %d rows under %q no longer resolve to S000005594 -- the look-ahead target below is gone, so the assertion after this one cannot mean anything", intlBad, intl, intlLabel)
	}

	// The defect. Today every one of these 8 rows comes out
	// fund_name="Masters' Select Funds" / series_id="", because the masthead
	// names the trust rather than a sleeve. They belong to the International
	// sleeve the very next masthead names.
	const trustLabel = "Masters' Select Funds"
	blank, wrong := 0, 0
	var first VoteRow
	for _, r := range sink.buf {
		if r.FundName != trustLabel {
			continue
		}
		blank++
		if r.SeriesID != "S000005594" {
			if wrong == 0 {
				first = r
			}
			wrong++
		}
	}
	if blank != 8 {
		t.Fatalf("fixture precondition: %d rows carry the bare-trust-name masthead label %q, want 8 -- the fixture's first slice changed", blank, trustLabel)
	}
	if wrong > 0 {
		t.Errorf("bare-trust-name masthead is not carried forward: %d of %d rows under %q carry series_id=%q, want S000005594 (The Masters' Select International Fund, which the very next masthead names outright and no other fund banner intervenes). First: issuer=%q cusip=%q meeting=%q desc=%q", wrong, blank, trustLabel, first.SeriesID, first.IssuerName, first.CUSIP, first.MeetingDate, first.VoteDescription)
	}
}
