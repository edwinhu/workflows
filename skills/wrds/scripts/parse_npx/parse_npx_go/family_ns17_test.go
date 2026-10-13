package main

import (
	"path/filepath"
	"testing"
)

// familyNS17Dispatch runs the real dispatch on a family NS17 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS17Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns17", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns17", fixture), sink, make([]byte, headBytes))
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

// 000080/802716/0001683863-21-004726.txt: verbatim source lines 1-10, 12-16,
// 21-22 (the SEC header the dispatch reads), 1200-1252, one `</table>` to close
// the table the line-range cut opened, verbatim source lines 56718-56757, a
// second `</table>` for the same reason, and the filing's own last seven lines
// (100496-100499 plus the three closing lines). The two `</table>` lines are the
// only bytes in the fixture that are not verbatim. Dispatches to `htmltable`
// (the precondition asserts it).
//
// Victory Portfolios / Victory Variable Insurance, 2021, period 20210630.
// 6,098 of 10,768 rows carry no series and no fund name at all -- the whole of
// the first section, `Victory 500 Index VIP Series`. The heading's position is
// NOT the defect: measured, a resolvable banner in exactly that position is
// adopted (substituting `Victory High Yield VIP Series` for the first banner
// puts S000053572 on all four rows). The heading is dropped because it resolves
// to nothing, and `htmlBareFundLine` adopts a between-tables line only when it
// resolves.
//
// The banner, source line 1214, verbatim:
//
//	<br style='page-break-after:always;'><p align='center'>Victory 500 Index VIP Series</p>
//
// The registrant declares fifteen `<SERIES-ID>`s and none of them is a VIP
// sleeve; the VIP series are declared at CIK 1068663 (Victory Variable
// Insurance Funds), which is why the six sibling sections of this filing
// resolve through the cross-CIK rung. The dictionary rows for this series, all
// three of them, verbatim from cik_series.tsv:
//
//	0001068663	S000053591	Victory S&P 500 Index VIP Series	20170630
//	0001068663	S000053591	Victory 500 Index VIP Series (formerly Victory S&P 500 Index VIP Series)	20200630
//	0001068663	S000053591	Victory 500 Index VIP Series	20230630
//
// The clean spelling is vintage 20230630, AFTER this filing's period, so the
// cross-CIK rung refuses it (family MISLINK3). The one pre-period row that
// spells the printed name carries a trailing `(formerly ...)` parenthetical,
// and the declared name is indexed whole, so the banner misses it by the
// parenthetical alone. Measured: deleting `(formerly Victory S&P 500 Index VIP
// Series)` from that one dictionary row -- and changing nothing else -- puts
// S000053591 on both rows of the first section.
func TestFamilyNS17VictoryFormerlyParenthetical(t *testing.T) {
	rows := familyNS17Dispatch(t, "victory_first_section_heading.txt", "victory_dict.tsv", "htmltable", 4)
	for _, r := range rows {
		if r.IssuerName != "10X GENOMICS, INC." {
			continue
		}
		if r.SeriesID != "S000053591" {
			t.Errorf("the first section's banner did not reach the declaration whose name carries a trailing (formerly ...) parenthetical: fund=%q issuer=%q cusip=%q item=%q desc=%q series=%q want S000053591",
				r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
