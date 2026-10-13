package main

import (
	"path/filepath"
	"testing"
)

// Scudder Variable Series II (CIK 0000810573, filing agent 0000088053), second
// audited row of the SAME instrument the committed Total Return fix used.
//
// Evidence: Exhibit (a)(25) to 485BPOS 000081/810573/0000088053-06-000476.txt
// (md5 93e8a0ca4136e10007f68aeca91274cb), document `<FILENAME>exa25-svs2.txt`,
// headed
//
//	SCUDDER VARIABLE SERIES II
//	Redesignation of Series
//
// reading "The undersigned, being a majority of the Trustees of Scudder
// Variable Series II ... The series presently designated as listed in Column A
// are each hereby redesignated as their corresponding name listed in Column B:"
// over a 29-row Column A / Column B table, closing "The foregoing
// Redesignation of Series shall be effective February 6, 2006." and carrying
// ten trustee signature blocks, dated Dec. 30, 2005. The row pinned here,
// copied from the exhibit's own bytes:
//
//	SVS Turner Mid Cap Growth Portfolio        DWS Turner Mid Cap Growth VIP
//
// The Column A spelling is BYTE-FOR-BYTE the heading the 2005 filing prints --
// no similarity judgement is involved. The Column B successor is a dictionary
// row of this SAME CIK, declared at vintage 20060630 in
// 000081/810573/0000088053-06-001068.txt (the registrant's first series-tagged
// N-PX): `DWS Turner Mid Cap Growth VIP` = S000006274. Audited on both ends,
// registrant-scoped, no cross-CIK reach.
//
// Fixture:
//
//	svs2_2005_turner.txt -- 000081/810573/0000088053-05-000968.txt (md5
//	36141336dd7a55e80f451c8c7f601dab) lines 1-186 (the SGML header, the FORM
//	N-PX preamble, and the document's FIRST ProxyEdge page -- banner
//	`SVS II Scudder Aggressive Growth Portfolio` plus its DELL INC. ballot),
//	lines 52335-52370 (the whole `SVS Turner Mid Cap Growth Portfolio` page
//	banner plus its first ballot, RESEARCH IN MOTION LIMITED) and the
//	document's own trailing tags (lines 54690-54693).
//
//	The first page is carried for the same reason the committed Total Return
//	fixture carries it: it is the only place this filing opens
//	`<TABLE>`/`<CAPTION>`/`<S> <C>`, and without it the splittable layout
//	declines the document. Its DELL rows are deliberately NOT asserted on --
//	`Scudder Aggressive Growth Portfolio` is not a Column A name (the exhibit
//	redesignates `Scudder Salomon Aggressive Growth Portfolio`) and it
//	already resolves to S000006259.
//
// Dictionary: all 58 cik_series.tsv rows this CIK carries, copied verbatim.
//
// Row count: the heading `SVS Turner Mid Cap Growth Portfolio` carries 823
// blank-series rows over the two real pre-2006 filings of this CIK -- the
// largest in-scope unfloored chunk. (The larger `SVS II Index 500 Portfolio` /
// `SVS II INDEX 500 PORTFOLIO` chunk is a CROSS-REGISTRANT floor: CIK
// 0000888568 declares DWS EQUITY 500 INDEX PORTFOLIO, S000009010, as its own
// separate registrant, so it is out of scope here.)
//
// Why no existing rung reaches it: this CIK's dictionary carries THREE
// `Mid Cap Growth` successors -- S000006274 `DWS Turner Mid Cap Growth VIP`,
// S000006257 `DWS Mid Cap Growth VIP` and S000006260 `DWS Small Mid Cap Growth
// VIP` -- so the shared content words do not pick one out. Only the exhibit's
// Column A -> Column B row does, which is exactly what a registrant-scoped
// audited alias table is for.
//
// The filing declares no series at all -- EDGAR tagged none before 2006 -- so
// the header pool is empty and the successor must be resolved against this
// CIK's own dictionary rows, the rung issAuditedRenameAliases already uses.
//
// The parser currently reads the banner verbatim into the fund-name column and
// leaves series_id blank.
func TestFamilyNSSVS2Round2TurnerResolves(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_svs2_round2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		fixture = "svs2_2005_turner.txt"
		period  = "20050630"
		heading = "SVS Turner Mid Cap Growth Portfolio"
		want    = "S000006274" // DWS Turner Mid Cap Growth VIP
		colA    = "SVS Turner Mid Cap Growth Portfolio"
	)

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_svs2_round2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.CIK != "0000810573" || meta.PeriodOfReport != period {
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
	for _, r := range under {
		if r.SeriesID != want {
			t.Errorf("heading %q (fund_name=%q): series=%q, want %q -- Exhibit (a)(25) to 485BPOS 0000088053-06-000476 redesignates %q as the Column B name whose series id that is, effective 2006-02-06",
				heading, r.FundName, r.SeriesID, want, colA)
			break
		}
	}
}
