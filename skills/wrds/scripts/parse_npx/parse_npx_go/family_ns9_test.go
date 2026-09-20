package main

import (
	"path/filepath"
	"testing"
)

// familyNS9Dispatch runs the real dispatch on a family NS9 fixture, loading the
// named dictionary rows — which for this family include the SIBLING registrant's
// CIK, because that is where the printed fund names are tagged.
func familyNS9Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns9", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns9", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	return rows
}

// 000136/1365662/0000891804-14-000786.txt: 1-19, 40-51, 200-217, 28038-28078
// and the filing's own last three lines. Dispatches to `icr` (the precondition
// asserts it).
//
// Claymore Exchange-Traded Fund Trust 2, 2014. 14,290 of 17,066 rows carry no
// series, in nine fund sections, and every one of the nine names a fund of the
// SIBLING trust — Claymore Exchange-Traded Fund Trust (CIK 1364089), which is
// not the filer. The body prints the name plainly (source line 28041 verbatim):
//
//	Fund Name : Wilshire Micro Cap ETF
//
// The filing declares 17 <SERIES-ID>s and this is not among them; the heading
// therefore refuses against the registrant's own index. It matches the corpus
// dictionary exactly once, under CIK 1364089:
//
//	0001364089	S000012990	Wilshire Micro-Cap ETF
//
// and so do six of the other eight blank headings (Guggenheim Raymond James
// SB-1 Equity ETF S000023006, Insider Sentiment S000012989, Mid-Cap Core
// S000016401, Spin-Off S000014618, Wilshire US REIT S000028049, S&P Global
// Dividend Opportunities Index S000016396, Enhanced Short Duration S000020359).
// Sibling sections of the SAME filing whose fund IS declared are stamped
// (Guggenheim Multi-Asset Income Index ETF => S000017282, 2,326 rows), which is
// what makes this a dictionary-scope defect rather than a resolver floor.
//
// Rows reached: 14,290 — the whole family, one filing.
//
// Fix in cik_series.go / the resolver's dictionary fallback: when the heading
// resolves against neither the filing's declarations nor its own CIK's
// dictionary, admit a corpus-dictionary hit from another CIK only when it is
// EXACT and UNIQUE corpus-wide. Exactness and uniqueness are the whole guard:
// a loose cross-CIK rung would mislink across sponsors.
func TestFamilyNS9ClaymoreTrust2SiblingTrustFundRefusesTheHeading(t *testing.T) {
	rows := familyNS9Dispatch(t, "claymore_trust2_sibling_trust_fund.txt", "claymore_trust1_dict.tsv", "icr", 7)
	for _, r := range rows {
		if r.SeriesID != "S000012990" {
			t.Errorf("a sibling trust's fund name resolved against no CIK: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000012990", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000111/1119720/0001193125-06-183133.txt: 11-34, 50-55, 96-100, 456-460,
// 711-720, 12905-12950 and the filing's own last three lines. Dispatches to
// `votesummary` (the precondition asserts it).
//
// State Farm Mutual Fund Trust, 2006. 3,256 of 7,416 rows carry no series, all
// in the ISS Vote Summary Report section whose heading is printed on every page
// (source lines 12911-12914 verbatim):
//
//	                               Vote Summary Report
//	                           Sep 12, 2005 - Jun 30, 2006
//
//	State Farm Small Cap Equity Index Fund
//
// The filing declares 15 series and this is not among them. The two nearest
// declared names differ from the printed one by exactly the disputed words —
// `State Farm Small Cap Index Fund` (S000002048) and `State Farm Small Cap
// Equity Fund` (S000002040) — so no rung inside this registrant may pick one.
// The printed name matches the corpus dictionary exactly once, under the
// sponsor's sibling registrant:
//
//	0001034633	S000002061	State Farm Small Cap Equity Index Fund
//
// The same filing's `State Farm International Index Fund` section is stamped
// S000002049 from the identical grammar (4,160 rows), so the layout and the
// resolver are not at fault: the dictionary consulted is the wrong one.
//
// Rows reached: 3,256 in this filing; the family's other seven filings carry a
// further 11,299 pool rows and are the same filer-agent grammar.
//
// Fix as for the Claymore case above — exact and unique corpus-wide only.
// Caveat recorded in the NS9 report: CIK 1034633 filed its own N-PX the same
// day (000103/1034633/0001193125-06-183142.txt), so this attribution may
// duplicate a section that registrant also reports.
func TestFamilyNS9StateFarmSiblingTrustFundRefusesTheHeading(t *testing.T) {
	rows := familyNS9Dispatch(t, "state_farm_sibling_trust_fund.txt", "state_farm_sibling_dict.tsv", "votesummary", 15)
	for _, r := range rows {
		if r.SeriesID != "S000002061" {
			t.Errorf("a sibling trust's fund name resolved against no CIK: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000002061", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
