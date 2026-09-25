package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 000106/1066980/0001193125-14-324748.txt (VANTAGEPOINT FUNDS, CIK 1066980,
// period 20140630, layout labelvalue, 63,742 rows): verbatim source lines
// 89587-89588 (the `Fund Name :` line that governs the vendor section),
// 91795-91807 (the last vendor block of that section -- its underscore rule,
// `Xenoport, Inc.`, the `Ticker / Security ID: / Meeting Date / Meeting Status`
// block header and items 1.1-1.3) and 92214-92276 (the `<PAGE>` break, the
// `INTERNATIONAL FUND` page heading, its `FORM N-Px REPORT` block, the
// `=====` banner under it and the whole ACTELION LTD. meeting). Every byte is
// a line-range cut of the source; nothing is added.
//
// NOT THE FAMILY THIS FILING WAS FILED UNDER. Commit 13467611 fixed the shape
// where a bare `===== The VantagePoint Funds =====` registrant banner erased a
// series the page heading above it had resolved, and named this filing. That
// fix holds here and is not what is left: measured on HEAD, parseLabelValue
// over this filing's whole body reads 59,370 rows with ZERO blank series, and
// the section this banner opens carries S000008133 on 1,175 rows under the
// right issuers (ACTELION LTD., AIA GROUP LTD., ...). The 1,412 blank rows the
// corpus run still reports (1,418 with no -series-map) do not come from
// layout_labelvalue.go at all.
//
// WHERE THEY COME FROM. This filing prints TWO grammars. The winner is
// labelvalue; the underscore-ruled vendor section it steps over is read by
// icrSupplement (text_parser.go:507-509), which runs parseICR over the WHOLE
// body and appends whatever the fund/issuer/meeting-date key does not already
// match. Measured on HEAD, no dictionary and no overlay loaded:
//
//	parseICR over the whole body                          4,372 rows, 1,418 blank
//	parseICR truncated at the end of the vendor section    2,691 rows,     6 blank
//
// So icr's own grammar ends with the Xenoport block, at source line 92213.
// The 1,681 rows it emits after that -- 1,412 of them blank -- are a second,
// corrupt reading of the 57,925-row region labelvalue has already read
// correctly, and they survive the supplement's dedup because none of their
// three key fields is right.
//
// THE TRIGGER LINE. The last icr block header in the body is source line 91797,
//
//	|Ticker     Security ID:             Meeting Date          Meeting Status
//
// and nothing in the ISS grammar that follows closes the block it opens. The
// `=====` banner at source line 92234 is the only marker parseICR recognises in
// the remaining 157,000 lines, and layout_icr.go:580-582 lets it reassign
// curFund and curSeries ONLY: the registrant's own name resolves to nothing, so
// curSeries goes blank, while the issuer, the CUSIP and the meeting stay
// Xenoport's. Every item-shaped line of every ISS meeting for the rest of the
// filing is then stamped `Xenoport, Inc. / 98411C100 / 20140611 / Proxy
// Contest`. In the corpus row that is 1,409 rows under fund_name
// `The VantagePoint Funds` plus 3 under `WALTER SCOTT & PARTNERS LIMITED`,
// one of which reads an ISS account-code line (`70359 / VANTAGEPOINT 100380 JP
// MORGAN`) as a vote.
//
// WHICH IS WHY THE SERIES MUST NOT BE "RECOVERED". These rows are not items
// waiting for a link key -- they are duplicates of rows that already exist,
// under the wrong issuer, the wrong CUSIP and the wrong meeting date, with
// descriptions merged across the ISS column gaps (`Elect Jean-Pierre Garnier
// as Board For For Management Chairman ...`). Answering them S000008133 would
// double-count the ACTELION meeting under a correct-looking id. The defect is
// that they are emitted, so the assertion is on the row set.
//
// THE FIXTURE, 78 lines, reproduces the whole mechanism: the vendor block opens
// an icr block that the ISS section never closes, and one ACTELION item
// (`6.2`) escapes into it. Three rows are the whole of what parseICR may read
// out of these bytes.
//
// The 6 blank rows in the legitimate 2,691 are a different shape -- the
// `VantagePoint Opportunity Fund - TimesSquare Capital` section's Xilinx rows
// -- and are not this family.
func TestFamilyNS1066980ICRSupplementCrossesIntoISSReport(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	// The two declarations these bytes can reach, verbatim from the filing's own
	// header: the fund the vendor section names and the fund the page heading
	// names. No dictionary and no overlay is loaded -- the blank series is not a
	// resolution failure and nothing here depends on one.
	meta := FilingMeta{
		CIK:            "0001066980",
		CompanyName:    "VANTAGEPOINT FUNDS",
		PeriodOfReport: "20140630",
		SeriesDecls: []SeriesDecl{
			{SeriesID: "S000008133", Name: "Vantagepoint International Fund"},
			{SeriesID: "S000020942", Name: "Vantagepoint Discovery Fund"},
		},
	}

	dir := filepath.Join("testdata", "family_ns1066980_icr_supplement_iss_report")
	b, err := os.ReadFile(filepath.Join(dir, "vantagepoint2014_icr_supplement_iss_report.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := parseICR(string(stripHTML(b)), meta)
	if err != nil {
		t.Fatal(err)
	}

	want := map[string]string{
		"1.1": "KEVIN J. CAMERON",
		"1.2": "RAEL MAZANSKY, M.D.",
		"1.3": "CHARLES A. ROWLAND, JR.",
	}
	for _, r := range rows {
		desc, ok := want[r.ItemSeq]
		if !ok {
			t.Errorf("parseICR read an item out of the `FORM N-Px REPORT` section that begins at source line 92214, which the labelvalue layout already reads under its own issuer and series: item=%q issuer=%q cusip=%q date=%q series=%q fund=%q desc=%q; the icr block opened by source line 91797 is still open and stamps Xenoport's identity on it",
				r.ItemSeq, r.IssuerName, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, r.VoteDescription)
			continue
		}
		// The control: the vendor block this fixture opens with. If these ever
		// stop reading, the cut is broken, not the grammar.
		if r.IssuerName != "Xenoport, Inc." || r.MeetingDate != "20140611" || r.VoteDescription != desc || r.SeriesID != "S000020942" {
			t.Fatalf("fixture guard: the Xenoport vendor block stopped reading: item=%q issuer=%q date=%q series=%q desc=%q", r.ItemSeq, r.IssuerName, r.MeetingDate, r.SeriesID, r.VoteDescription)
		}
	}
	if len(rows) != len(want) {
		t.Errorf("parseICR read %d rows out of these bytes, want %d: the only meeting it may read here is Xenoport's, at source lines 91795-91807", len(rows), len(want))
	}
}
