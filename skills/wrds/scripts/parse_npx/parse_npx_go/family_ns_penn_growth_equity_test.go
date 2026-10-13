package main

import (
	"path/filepath"
	"testing"
)

// Penn Series Funds, Inc. (CIK 0000702340), ISS plaintext N-PX, three filings
// of the 20040630 period:
//
//	000070/702340/0000702340-04-000010.txt  (md5 d13e01ab40ca78dc8d05ec637b46640b)
//	000070/702340/0000702340-04-000012.txt  (md5 92936b013446e99ba03bd1644d9312c5)
//	000070/702340/0000702340-05-000001.txt  (md5 15c87fbe98932d78ce5940f1d40a695b)
//
// Each prints a fund section headed
//
//	============================== GROWTH EQUITY FUND ==============================
//
// (line 9036 of the first, line 9033 of the other two, whose bodies are
// otherwise the same 39,132-line report), and every row under it comes out with
// a blank series_id -- 3,474 rows across the three, measured with -cik-series
// over $D/cik_series.tsv and -series-map over $D/series_map_applied.tsv.
//
// THE RENAME IS AUDITED BY THE REGISTRANT'S OWN NSAR CLASS-CONTRACT CODE, not
// by word similarity. This CIK's NSAR-B annual reports carry item 007's
// series/class-contract code beside the fund's name, and the code is stable
// across the rename:
//
//	0000702340-03-000003.txt:81   007 C020100 PENN SERIES GROWTH EQUITY FUND
//	0000702340-04-000003.txt:81   007 C020100 PENN SERIES GROWTH EQUITY FUND
//	0000702340-05-000003.txt:82   007 C020100 PENN SERIES GROWTH STOCK FUND
//
// One code, one fund, two names, and the registrant itself is the one asserting
// the identity. The successor is then a dictionary row of this SAME CIK: the
// registrant's first series-tagged N-PX,
// 000070/702340/0001104659-06-058507.txt (vintage 20060630), declares
// `<SERIES-ID>S000006732` / `<SERIES-NAME>Penn Series Growth Stock Fund` with
// `<CLASS-CONTRACT-NAME>Growth Stock Fund`, and that filing's own vote body
// prints the section banner `GROWTH STOCK FUND`. No filing under this CIK at
// that vintage or later prints a `GROWTH EQUITY FUND` banner at all. So the
// 2004/2005 N-PX heading and the 2006+ heading are the same fund under two
// names -- registrant-scoped on both ends, no cross-CIK reach, exactly the
// evidentiary shape issRegistrantRenames already carries.
//
// No name-based rung reaches it. `Growth Equity` and `Growth Stock` share only
// the word `Growth`, which this registrant's own roster spends on eight other
// declared series (Mid Cap Growth, Large Cap Growth, Small Cap Growth, Smid Cap
// Growth, Large Core Growth, ...), so a `Growth`-anchored cut is ambiguous by
// construction; and `Growth Equity Fund` appears in NO dictionary row of this
// CIK at any vintage.
//
// The two OTHER blank headings of these filings -- `CORE EQUITY FUND` (2,721
// rows) and `EMERGING GROWTH FUND` (5,250 rows) -- are FLOOR and deliberately
// untouched: neither has a successor in this CIK's own dictionary at any
// vintage, and a corpus-wide grep of cik_series.tsv for either name returns
// only unrelated CIKs. This test asserts on `GROWTH EQUITY FUND` alone.
//
// Fixture:
//
//	penn_2004_growth_equity.txt -- 0000702340-04-000010.txt lines 1-112 (the
//	SGML header through the FORM N-PX cover page and the report preamble,
//	stopping just before the first fund banner), lines 9036-9110 (the whole
//	`GROWTH EQUITY FUND` banner and its first three ballots -- ACE LTD.,
//	ADVANCED MICRO DEVICES, INC. and AETNA INC. -- through that section's own
//	`- ----` rule), lines 39106-39107 (the report's `========== END NPX
//	REPORT` terminator) and the document's trailing tags (last four lines).
//	Byte-identical excerpts, no edits.
//
// Dictionary: all 61 cik_series.tsv rows this CIK carries, copied verbatim.
//
// The filing declares no series -- EDGAR tagged none for this registrant before
// 2006 -- so the header pool is empty and the successor must be resolved
// against this CIK's own dictionary rows, the rung issAuditedRenameAliases
// already uses.
//
// The parser currently reads the banner verbatim into the fund-name column and
// leaves series_id blank.
func TestFamilyNSPennGrowthEquityRename(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_penn_growth_equity", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		fixture = "penn_2004_growth_equity.txt"
		period  = "20040630"
		heading = "GROWTH EQUITY FUND"
		want    = "S000006732" // Penn Series Growth Stock Fund, this CIK's own 20060630 declaration
		succ    = "Growth Stock Fund"
	)

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_penn_growth_equity", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.CIK != "0000702340" || meta.PeriodOfReport != period {
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
			t.Errorf("heading %q (fund_name=%q): series=%q, want %q -- this registrant's own NSAR-B item 007 carries class-contract code C020100 for `PENN SERIES GROWTH EQUITY FUND` in 0000702340-04-000003 and for `PENN SERIES GROWTH STOCK FUND` in 0000702340-05-000003, and %q is the name whose series id that is in this CIK's 20060630 declaration",
				heading, r.FundName, r.SeriesID, want, succ)
			break
		}
	}
}
