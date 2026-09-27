package main

import (
	"path/filepath"
	"testing"
)

const ns1261788MicroCapDir = "family_ns1261788_micro_cap_liquidated_predecessor"

// ns1261788MicroCapDispatch runs the real dispatch on this family's fixture
// under PRODUCTION resolution -- the corpus dictionary and the series overlay
// are left exactly as the binary holds them, not nilled out, so the series id
// asserted below is whatever production would emit for this file. The filing's
// own <SERIES-AND-CLASSES-CONTRACTS-DATA> header dictionary is read by
// processFile regardless and is separate from either overlay. Same mechanism as
// ns1199046ItemdescDispatch, pointed at its own testdata dir.
func ns1261788MicroCapDispatch(t *testing.T, fixture, layout string) (FilingMeta, []VoteRow) {
	t.Helper()
	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1261788MicroCapDir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s want status=ok layout=%s error=%s", meta.ParseStatus, meta.Layout, layout, meta.ErrorMsg)
	}
	return meta, rows
}

// ZIEGLER LOTSOFF CAPITAL MANAGEMENT INVESTMENT TRUST, CIK 1261788, period
// 20120630, filing 000126/1261788/0001398344-12-002719.txt (`htmltable`). The
// registrant declares EXACTLY TWO series in its own SEC header -- S000000850
// LOTSOFF CAPITAL MANAGEMENT MICRO CAP FUND (real source lines 53-54, fixture
// lines 53-54) and S000034546 ZIEGLER LOTSOFF CAPITAL MANAGEMENT LONG/SHORT
// CREDIT FUND (real 62-63, fixture 62-63) -- and prints no fund masthead of any
// kind in either vote table.
//
// MEASURED ON HEAD over the whole real accession: status=ok layout=htmltable
// rows=318, and BOTH halves of the file are wrong.
//
//	296 rows  series=""            fund=""    meetings 20110706..20111215, how=For/3 Years
//	 22 rows  series="S000000850"  fund=<the liquidation sentence below>, meetings 20120501..20120509, how=*
//
// THE FILING'S SHAPE. Two vote tables, each followed by its own footnote div,
// with nothing that looks like a fund banner anywhere inside either:
//
//	real 177-9682    table A: 296 rows, every one actually VOTED (For / 3 Years)
//	real 9688        <div>The Micro Cap Fund was liquidated and ceased operations
//	                 after the close of trading on November 15, 2011.</div>
//	real 9715-10452  table B: 22 rows, every Vote cell the literal `*`
//	real 10459       <div>* The Adviser did not vote any proxies on behalf of the
//	                 Long/Short Credit Fund during the reporting period.</div>
//
// WHY THE ATTRIBUTION IS PROVABLE, not guessed. Table B's Vote column holds `*`
// in all 22 rows and the footnote keyed to that asterisk names the Long/Short
// Credit Fund as the fund that cast no votes, so table B is S000034546's record
// of proxies received and not voted. Only two series exist, so every one of
// table A's 296 actually-cast votes belongs to the other one, S000000850. The
// dates corroborate it independently and were not used to reach it: table A's
// meetings run 20110706..20111215 and stop, which is the reporting period up to
// the Micro Cap Fund's mid-period liquidation, while table B's run
// 20120501..20120509, after it. Same evidentiary shape as the closed
// family_ns1045487 (James Advantage) CIKs.
//
// THE DEFECT, part one: 296 rows with no series at all. Nothing in table A ever
// opens a section, so `fund` and `series` are never set and all 296 rows are
// emitted blank -- 93% of the filing.
//
// THE DEFECT, part two, which is worse and which the brief did not predict: the
// LIQUIDATION FOOTNOTE IS READ AS A FUND MASTHEAD. htmlBareFundLine resolves the
// whole sentence against the series index and returns
// name="The Micro Cap Fund was liquidated and ceased operations after the close
// of trading on November 15, 2011." id="S000000850" ok=true, because
// `Micro Cap Fund` stands inside it. MEASURED directly:
//
//	htmlBareFundLine(ix, <liquidation sentence>) -> "…", "S000000850", true
//	htmlBareFundLine(ix, <asterisk sentence>)    -> "", "", false
//
// That footnote sits BETWEEN the two tables, so the section it opens covers
// table B. The result is that the 22 rows belonging to the Long/Short Credit
// Fund are stamped with the OTHER series' id, S000000850, and carry a prose
// sentence as their fund_name. A row with a confidently wrong series id is a
// worse outcome than a blank one: the 296 blanks are countable residue, these 22
// are silent mis-attribution.
//
// A fix must therefore do both things: stop the footnote from opening a section,
// and attribute each table to the series the filing's own evidence assigns it.
// The assertions below demand exactly that.
//
// FIXTURE PROVENANCE. ziegler_lotsoff_micro_cap_liquidated_2012.txt is real SEC
// EDGAR bytes, accession 0001398344-12-002719, CIK 1261788, period 20120630,
// verbatim and in file order, trimmed to whole <tr>/<table> units. The ranges
// kept, by real source line: 1-87 (SEC-HEADER including both series
// declarations, <DOCUMENT>/<TEXT>/<html>/<head>/<body>), 166-305 (the
// `Item 1. Proxy Voting Record` heading, table A's <table> open, its column
// header row, and its first three data rows -- ORTHOVITA, INC. items 2, 3 and
// 4), 9682-9690 (table A's `</tr></table>` and the liquidation footnote div),
// 9711-9843 (table B's <table> open, its column header row, and its first three
// data rows -- AMERICAN CAPITAL AGENCY CORP. items 1-01, 1-02 and 1-03),
// 10452-10462 (table B's close and the asterisk footnote div), 10518-10522 (the
// accession's closing tags). No row was fabricated or edited.
//
// The fixture reproduces the real accession's behaviour proportionally --
// status=ok layout=htmltable rows=6, of which the three table-A rows carry
// series="" fund="" and the three table-B rows carry series="S000000850" plus
// the liquidation sentence as fund_name, exactly as the real file does at scale.
//
// No production code is changed here.
func TestFamilyNS1261788MicroCapLiquidatedPredecessor(t *testing.T) {
	_, rows := ns1261788MicroCapDispatch(t, "ziegler_lotsoff_micro_cap_liquidated_2012.txt", "htmltable")

	const (
		microCap   = "S000000850" // LOTSOFF CAPITAL MANAGEMENT MICRO CAP FUND
		longShort  = "S000034546" // ZIEGLER LOTSOFF CAPITAL MANAGEMENT LONG/SHORT CREDIT FUND
		footnote   = "The Micro Cap Fund was liquidated and ceased operations after the close of trading on November 15, 2011."
		votedIssue = "ORTHOVITA, INC."
		unvotedIss = "AMERICAN CAPITAL AGENCY CORP."
	)

	if len(rows) != 6 {
		t.Fatalf("fixture precondition: %d rows, want 6 (three ORTHOVITA rows from table A, three AMERICAN CAPITAL AGENCY rows from table B)", len(rows))
	}

	// The claim, part one. Table A's rows are the Micro Cap Fund's. They are the
	// only actually-cast votes in the filing, and the filing's other declared
	// series is disclaimed at fixture line 377 as having cast none.
	var tableA, tableB int
	for i, r := range rows {
		switch r.IssuerName {
		case votedIssue:
			tableA++
			if r.HowVoted != "For" {
				t.Errorf("row %d: fixture precondition broken: %s row has how_voted=%q, want For -- table A rows are voted ballots", i, votedIssue, r.HowVoted)
			}
			if r.SeriesID != microCap {
				t.Errorf("row %d (%s item=%q cusip=%q date=%q): series=%q fund=%q want %s -- table A (real source lines 177-9682, fixture 99-228) prints no masthead, so nothing opens a section and the row comes out blank; with only S000000850 and S000034546 declared and the latter disclaimed as having voted nothing (fixture line 377), these 296 real rows are provably the Micro Cap Fund's",
					i, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, microCap)
			}
		case unvotedIss:
			tableB++
			if r.HowVoted != "*" {
				t.Errorf("row %d: fixture precondition broken: %s row has how_voted=%q, want * -- table B rows are proxies received and NOT voted", i, unvotedIss, r.HowVoted)
			}
			// The claim, part two. No row may take its fund_name from the
			// liquidation footnote, and no table-B row may carry the Micro Cap
			// Fund's id.
			if r.FundName == footnote {
				t.Errorf("row %d (%s item=%q): fund_name is the LIQUIDATION FOOTNOTE at fixture line 234 (real source line 9688), a free-standing prose sentence between the two tables, not a masthead this filing printed; htmlBareFundLine accepts it because `Micro Cap Fund` stands inside it",
					i, r.IssuerName, r.ItemSeq)
			}
			if r.SeriesID == microCap {
				t.Errorf("row %d (%s item=%q cusip=%q date=%q): series=%q is the WRONG series -- this row is in table B (real 9715-10452, fixture 241-370), whose every Vote cell is `*` and whose footnote at fixture line 377 reads `* The Adviser did not vote any proxies on behalf of the Long/Short Credit Fund during the reporting period.`, so it belongs to %s; S000000850 leaked in from the liquidation footnote being read as a masthead",
					i, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.SeriesID, longShort)
			}
			if r.SeriesID != longShort {
				t.Errorf("row %d (%s item=%q): series=%q want %s -- the filing declares ZIEGLER LOTSOFF CAPITAL MANAGEMENT LONG/SHORT CREDIT FUND at fixture lines 62-63 and names it as the fund that cast no votes at fixture line 377",
					i, r.IssuerName, r.ItemSeq, r.SeriesID, longShort)
			}
		default:
			t.Errorf("row %d: unexpected issuer %q -- this fixture carries only the %s (table A) and %s (table B) blocks", i, r.IssuerName, votedIssue, unvotedIss)
		}
	}
	if tableA != 3 || tableB != 3 {
		t.Errorf("fixture precondition: table A emitted %d rows and table B %d, want 3 and 3", tableA, tableB)
	}

	// Regression guard. Both blocks' own identities already read correctly on
	// HEAD -- only fund_name and series are wrong. A fix that recovers the series
	// by disturbing issuer, cusip, meeting date or item numbering has traded one
	// defect for another.
	want := []struct {
		issuer, cusip, date, item string
	}{
		{votedIssue, "68750U102", "20110706", "2"},
		{votedIssue, "68750U102", "20110706", "3"},
		{votedIssue, "68750U102", "20110706", "4"},
		{unvotedIss, "02503X105", "20120501", "1-01"},
		{unvotedIss, "02503X105", "20120501", "1-02"},
		{unvotedIss, "02503X105", "20120501", "1-03"},
	}
	for i, w := range want {
		r := rows[i]
		if r.IssuerName != w.issuer || r.CUSIP != w.cusip || r.MeetingDate != w.date || r.ItemSeq != w.item {
			t.Errorf("row %d regressed: issuer=%q cusip=%q date=%q item=%q want issuer=%q cusip=%s date=%s item=%s",
				i, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, w.issuer, w.cusip, w.date, w.item)
		}
	}
}
