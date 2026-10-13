package main

import (
	"path/filepath"
	"testing"
)

// familyGGG1Dispatch runs the real dispatch on a family GGG no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one is
// named.
func familyGGG1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ggg1", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ggg1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000078/788422/0000788422-05-000024.txt: 11-30, 57-63, 124-143. Midas Special
// Equities Fund, Inc. declares NO series in its SGML header, so every name the
// resolver can see is backfilled from cik_series.tsv for CIK 0000788422, which
// holds four rows over three ids:
//
//	0000788422	S000011690	MIDAS SPECIAL EQUITIES FUND INC /MD	20060630
//	0000788422	S000011690	MIDAS SPECIAL FUND, INC.	20100630
//	0000788422	S000038965	Midas Fund	20120630
//	0000788422	S000038966	Midas Perpetual Portfolio	20120630
//
// Three distinct ids, so the chassis single-series stamp never fires.
//
// The filing prints NO fund section heading at all. The whole body is one
// stream of ISS proposal blocks under a single cover page, and the only place
// the fund is named is the registrant's own identity, in the SGML header:
//
//	COMPANY CONFORMED NAME:			MIDAS SPECIAL EQUITIES FUND INC /MD
//
// and on the cover, verbatim:
//
//	                        Midas Special Equities Fund, Inc.
//	- ------------------------------------------------------------------------
//	               (Exact name of registrant as specified in charter)
//
// followed straight by the blocks:
//
//	3M CO
//
//	Ticker:       MMM            Security ID:  88579Y101
//	Meeting Date: MAY 10, 2005   Meeting Type: Annual
//	Record Date:  MAR 11, 2005
//
//	#     Proposal                                  Mgt Rec   Vote Cast  Sponsor
//	1.1   Elect Director Vance D. Coffman           For       For        Management
//
// A full-file dispatch emits 163 rows and ALL 163 carry a blank series_id AND a
// blank fund_name: with no heading, dictFallback.apply returns on its
// `r.FundName == ""` guard before any lookup happens.
//
// This is NOT the known "no fund headings at all with several declared series"
// floor, because the registrant's own conformed name is itself one of the
// dictionary names, character for character apart from EDGAR's `/MD` state
// suffix: `MIDAS SPECIAL EQUITIES FUND INC /MD` is the 2006 declaration of
// S000011690. The other two ids are named `Midas Fund` and `Midas Perpetual
// Portfolio`, neither of which the registrant name can be read as, so exactly
// one dictionary series answers to the filer's own identity.
//
// Fix in the dictionary path -- cikSeries.exactFallback / dictFallback.apply in
// cik_series.go: when the header declares nothing, the filing prints no fund
// heading, and the registrant's COMPANY CONFORMED NAME resolves to exactly one
// dictionary series of that CIK, that series is the answer for every row. It is
// the registrant-as-fund case that a single-fund N-PX registrant always is, and
// it is decidable without reading a heading that does not exist.
func TestFamilyGGG1MidasRegistrantNameNeverResolves(t *testing.T) {
	rows := familyGGG1Dispatch(t, "midas_no_heading.txt", "midas_dict.tsv", "issnpx", 7)
	for _, r := range rows {
		if r.SeriesID != "S000011690" {
			t.Errorf("registrant-as-fund not resolved: fund=%q issuer=%q item=%q series=%q want S000011690", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000126/1261788/0000894189-16-011666.txt: 11-20, 50-430, 8400-8660. BOTH
// sections are in the cut on purpose: with only the Genea one the chassis
// stamps every row with the joined `S000050413;S000050414` and the fixture no
// longer reproduces the real filing's blank. Trust for Advised Portfolios
// declares exactly two series in the SGML header of this 2016 filing:
//
//	<SERIES-ID>S000050413
//	<SERIES-NAME>Zevenbergen Growth Fund
//	<SERIES-ID>S000050414
//	<SERIES-NAME>Zevenbergen Genea Fund
//
// and prints one HTML vote table per fund, each opened by a centred blue
// italic heading in the table's own first cell. The SECOND one resolves:
//
//	<div style="...TEXT-ALIGN: center">Investment Company Report -- Zevenbergen Growth Fund</div>
//
// The FIRST one prints the same banner with no space after the dashes:
//
//	<div style="...TEXT-ALIGN: center">Investment Company Report --Zevenbergen Genea Fund</div>
//
// icrResolveFund walks the leading tokens off the printed name one at a time,
// so the Growth banner reaches `Zevenbergen Growth Fund` and matches the
// declaration exactly. On the Genea banner the dashes are glued to the brand
// token, so the walk yields `--Zevenbergen Genea Fund` and then `Genea Fund`,
// and neither is declared; the heading is never adopted, so its 158 rows come
// out with an empty fund_name AND an empty series_id, and the heading text is
// carried into the issuer cell instead:
//
//	issuer_name = `Investment Company Report --Zevenbergen Genea Fund CRITEO SA`
//
// A full-file dispatch emits 472 rows: 314 under the Growth banner carrying
// S000050413, and 158 under the Genea banner carrying nothing.
//
// Fix in htmlBareFundLine (layout_htmltable.go), on the candidate the labelled
// and bare heading paths hand to icrResolveFundShared: a leading dash run that
// is glued to the first word of the name must be split off the token before the
// leading-token walk, the same cut the walk already makes when the filing types
// the space.
func TestFamilyGGG1ZevenbergenGluedDashHeadingNeverResolves(t *testing.T) {
	rows := familyGGG1Dispatch(t, "zevenbergen_genea_heading.txt", "", "htmltable", 6)
	for _, r := range rows {
		if r.SeriesID == "S000050413" {
			continue
		}
		if r.SeriesID != "S000050414" {
			t.Errorf("`Investment Company Report --Zevenbergen Genea Fund` heading not resolved: fund=%q issuer=%q item=%q series=%q want S000050414", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000109/1092720/0001104659-05-041501.txt: 11-20, 55-360. Rydex
// Dynamic Funds declares NO series in the SGML header of this 2005 filing, so
// the resolver sees only cik_series.tsv for CIK 0001092720 -- 32 rows over 18
// ids, among them:
//
//	0001092720	S000003700	Dynamic Dow Master Fund
//	0001092720	S000003705	Dow 2x Strategy Fund
//	0001092720	S000003705	Dynamic Dow Fund
//	0001092720	S000003706	Inverse Dynamic Dow Fund
//
// The filing prints three headings, each a bare paragraph above its table, and
// each naming the fund by its RETAIL MARKETING name behind an account number:
//
//	<p style="..."><font ...>Account Number: 48&#160; Long Dynamic Dow 30 Fund</font></p>
//	<p style="..."><font ...>Account Number: 28&#160; Velocity 100 Fund </font></p>
//
// htmlBareFundLine already reads `Account Number:` as a fund label and already
// drops the leading all-digit account code, so the candidate handed to the
// resolver is `Long Dynamic Dow 30 Fund`. That name is not in the dictionary:
// the dictionary spells the same fund `Dynamic Dow Fund`, without the `Long`
// qualifier and without the `30` index token. Neither the leading-token walk
// (`Dynamic Dow 30 Fund`, `Dow 30 Fund`, `30 Fund`) nor the suffix rules reach
// it, because the extra token sits INSIDE the name rather than at either end.
//
// A full-file dispatch emits 145 rows and ALL 145 carry a blank series_id and a
// blank fund_name.
//
// The attribution is decidable from the dictionary alone: dropping the two
// tokens the dictionary does not carry leaves `Dynamic Dow Fund`, which exactly
// names S000003705 and nothing else, and the `Long` qualifier is what
// distinguishes it from `Inverse Dynamic Dow Fund` (S000003706) while the
// absence of `Master` distinguishes it from `Dynamic Dow Master Fund`
// (S000003700).
//
// Fix in issResolveFund (layout_issnpx.go), the shared resolver
// icrResolveFundShared calls after the exact and suffix rules fail: an INTERIOR
// extra token -- a `Long` qualifier, an index number -- must be droppable the
// way a leading marketing prefix already is, accepted only when exactly one
// declared or dictionary name survives.
