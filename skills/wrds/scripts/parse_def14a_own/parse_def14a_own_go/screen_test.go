package main

import (
	"strings"
	"testing"
)

// runScreened mirrors process(): extract, then screen. Every fixture here is a
// LAYOUT CLASS the extractor accepts and the screen must reject.
func runScreened(t *testing.T, body string) []Row {
	t.Helper()
	return ScreenRows(run(t, body))
}

func names(rows []Row) string {
	var b strings.Builder
	for _, r := range rows {
		b.WriteString("[" + r.HolderName + "]")
	}
	return b.String()
}

// 0000912057-00-020455 (cik 799089): the EDGAR ASCII rendering of the stock
// performance graph, whose month labels run down the stub and whose indexed
// values start at 100. The rows below are transcribed from that filing's own
// parser output — 37 candidate rows, every one a false positive — because the
// block only reaches the extractor with the surrounding document in place.
func TestPerformanceGraphMonthsAreNotHolders(t *testing.T) {
	var rows []Row
	for i, tc := range []struct {
		name string
		pct  float64
	}{
		{"Dec-94", 100}, {"Jan-95", 98.44}, {"Mar-97", 94.16}, {"Apr-97", 45.53},
		{"May-97", 56.03}, {"Jun-97", 56.03}, {"Jul-97", 70.43}, {"Aug-98", 21.79},
	} {
		rows = append(rows, Row{HolderName: tc.name, TableIndex: 2078, RowIndex: 2113 + i,
			Percent: pf(tc.pct), ShareClass: "Common Stock"})
	}
	// A real holder from the same filing's ownership table, in its own table.
	rows = append(rows, Row{HolderName: "Capital Ventures International", TableIndex: 566,
		RowIndex: 612, Shares: pf(745000), Percent: pf(6.2)})
	got := ScreenRows(rows)
	if len(got) != 1 || got[0].HolderName != "Capital Ventures International" {
		t.Fatalf("want only the real holder, got %s", names(got))
	}
}

// 0000829499-00-000014 (cik 829499), lines 459-469. The same graph with the
// issuer and two S&P indices down the stub; every value is 100 in the first
// column, so all three rows reached the output at percent 100.
const perfGraphIndexed = `
                  SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

<TABLE>
<CAPTION>
Name of Beneficial Owner                     Shares          Percent of Class
<S>                                          <C>             <C>
IBC Employee Stock Plan                      4,150,000             5.9%
Mario J. Gabelli                             3,030,000             4.3%
Sierra Growth Partners, L.P.                 5,300,000             7.6%
</TABLE>

                               PERFORMANCE GRAPH
                           TOTAL SHAREHOLDER RETURNS
<TABLE>
<CAPTION>
                         6/03/95     6/01/96     5/31/97     5/30/98
<S>                       <C>         <C>         <C>         <C>
Interstate Bakeries
Corporation               100.00      193.49      381.48      467.03
S&P 500 Index             100.00      128.44      166.22      217.23
S&P Food Index            100.00      117.81      155.47      210.55
</TABLE>
`

func TestPerformanceGraphIndexNamesAreNotHolders(t *testing.T) {
	raw := run(t, perfGraphIndexed)
	if len(raw) == 0 {
		t.Fatalf("fixture extracts nothing, so the screen is untested")
	}
	if got := ScreenRows(raw); len(got) != 0 {
		t.Errorf("graph rows kept as holders: %s", names(got))
	}
}

// The screen must be inert on a clean ownership table: every row TestASCIITable
// checks has to survive it unchanged.
func TestScreenKeepsACleanOwnershipTable(t *testing.T) {
	raw := run(t, asciiProxy)
	got := ScreenRows(raw)
	if len(got) != len(raw) {
		t.Fatalf("screen dropped %d of %d clean rows: %s", len(raw)-len(got), len(raw), names(got))
	}
	w := find(got, "Walton Enterprises, LLC", "")
	if w == nil || w.Percent == nil || *w.Percent != 38.8 {
		t.Errorf("clean row changed by the screen: %+v", w)
	}
}

// 0000101063-96-000016 (cik 101063) and 0000944209-00-000113 (cik 1002037): a
// single percent broadcast down a mis-aligned column, so three or more distinct
// holders in one table carry the identical value. No table discloses the same
// percent for three separate holders; the column read is wrong.
const broadcastPercent = `
                  SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

<TABLE>
<CAPTION>
Name of Beneficial Owner                     Shares          Percent of Class
<S>                                          <C>             <C>
David C. Collins                               432,100            26.8%
Mary C. Adams                                  118,900            26.8%
Peter Q. Lyons                                  96,400            26.8%
Alice R. Chen                                   11,200               *
</TABLE>
`

func TestBroadcastPercentIsNotAPercent(t *testing.T) {
	rows := runScreened(t, broadcastPercent)
	for _, r := range rows {
		if r.Percent != nil && *r.Percent == 26.8 {
			t.Errorf("broadcast percent kept: %+v", r)
		}
	}
}

// 0000914039-00-000150 (cik 865084): the name cell absorbed the shares column,
// so the value read as a share count carries a fractional part ("187861.2411")
// and the percent read beside it (80) belongs to another column entirely.
const fractionalShares = `
                  SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

<TABLE>
<CAPTION>
Name of Beneficial Owner                     Shares          Percent of Class
<S>                                          <C>             <C>
TPG Partners II, L.P.                      187861.2411           80.0%
Ridgewood Holdings Inc.                      4,210,000           11.2%
Sierra Growth Partners, L.P.                 2,300,000            6.1%
</TABLE>
`

func TestFractionalShareCountInvalidatesTheRow(t *testing.T) {
	// The row exactly as 0000914039-00-000150 emitted it: the name cell ran on
	// into the share column, the share count came out fractional, and the 80
	// beside it is not this holder's percent (blockw has 22.0).
	rows := ScreenRows([]Row{
		{HolderName: "TPG Partners II, L.P., et. al. 18,", TableIndex: 1, RowIndex: 1,
			Shares: pf(187861.2411), Percent: pf(80)},
		{HolderName: "Ridgewood Holdings Inc", TableIndex: 1, RowIndex: 2,
			Shares: pf(4210000), Percent: pf(11.2)},
	})
	if len(rows) != 1 || rows[0].HolderName != "Ridgewood Holdings Inc" {
		t.Fatalf("want only the clean row, got %s", names(rows))
	}
	// And the whole-table fixture must not lose its clean rows.
	got := runScreened(t, fractionalShares)
	if find(got, "Ridgewood Holdings Inc", "") == nil {
		t.Errorf("the clean row was dropped too: %s", names(got))
	}
}

// 0000950134-99-007134 (cik 50104) and 0000950131-97-002052 (cik 726513): one
// row's shares and percent imply a total share count many times the rest of the
// table's, which can only mean the two cells came from different columns.
const impliedTotalOutlier = `
                  SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

<TABLE>
<CAPTION>
Name of Beneficial Owner                     Shares          Percent of Class
<S>                                          <C>             <C>
Alpha Advisers LLC                          10,000,000           10.0%
Beta Partners LP                             8,000,000            8.0%
Gamma Trust                                  6,000,000            6.0%
The Northern Trust Company                   1,387,624          100.0%
</TABLE>
`

func TestImpliedTotalOutlierIsDropped(t *testing.T) {
	rows := runScreened(t, impliedTotalOutlier)
	if r := find(rows, "The Northern Trust Company", ""); r != nil {
		t.Errorf("implied-total outlier kept: %+v", r)
	}
	if len(rows) != 3 {
		t.Errorf("want the 3 consistent rows, got %d: %s", len(rows), names(rows))
	}
}

// 0000898430-96-005359 (cik 716634) and 0000912057-00-042248 (cik 802301): a
// prose fragment or a foreign address line reaches the output as a holder name.
const proseAndForeignAddress = `
                  SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

<TABLE>
<CAPTION>
Name of Beneficial Owner                     Shares          Percent of Class
<S>                                          <C>             <C>
Great-West Lifeco Inc.                       4,120,000            6.2%
Winnipeg, Manitoba R3C 3B6 Canada            4,120,000            6.2%
Sceptre Investment Counsel Limited           3,300,000            9.9%
Toronto ON M5X 1E5, Canada                   3,300,000            9.9%
as investment adviser with sole voting       2,100,000            5.9%
</TABLE>
`

func TestProseAndForeignAddressAreNotHolders(t *testing.T) {
	rows := runScreened(t, proseAndForeignAddress)
	for _, bad := range []string{
		"Winnipeg, Manitoba R3C 3B6 Canada",
		"Toronto ON M5X 1E5, Canada",
		"as investment adviser with sole voting",
	} {
		if r := find(rows, bad, ""); r != nil {
			t.Errorf("non-holder kept: %+v", r)
		}
	}
	if find(rows, "Great-West Lifeco Inc", "") == nil {
		t.Errorf("the real holder was dropped: %s", names(rows))
	}
}

// 0000950130-99-001572 (cik 912513) and 0000950124-96-005419 (cik 53669): the
// share-class column is a PREFIX on the name, and the class is not common
// stock. blockw records common-stock ownership, so a Series C preferred or an
// ESOP voting-junior row is a different security, not a blockholder row.
const nonCommonClassPrefix = `
                  SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

<TABLE>
<CAPTION>
Title of Class      Name                          Shares      Percent of Class
<S>                 <C>                           <C>         <C>
Common Stock        Wellington Management Co.   3,786,250            6.1%
Series C Cumulative American Cyanamid Co        4,000,000           11.0%
Class M ESOP Voting Junior State Street Bank    1,669,444            8.4%
</TABLE>
`

func TestNonCommonShareClassRowsAreDropped(t *testing.T) {
	rows := runScreened(t, nonCommonClassPrefix)
	for _, r := range rows {
		if strings.Contains(r.HolderName, "Series C") || strings.Contains(r.HolderName, "ESOP") {
			t.Errorf("non-common class row kept: %+v", r)
		}
	}
}

// The screen must never touch a group row: group_row_detection_rate is a gated
// metric and a collective label legitimately starts lowercase after a wrap.
func TestScreenNeverDropsAGroupRow(t *testing.T) {
	rows := []Row{
		{HolderName: "officers as a group (12 persons)", TableIndex: 1, RowIndex: 1,
			Percent: pf(44.4), Shares: pf(24850000), IsGroupRow: true, GroupN: 12},
		{HolderName: "directors and officers as a group (9 persons)", TableIndex: 1, RowIndex: 2,
			Percent: pf(44.4), Shares: pf(24850000), IsGroupRow: true, GroupN: 9},
		{HolderName: "all directors as a group (4 persons)", TableIndex: 1, RowIndex: 3,
			Percent: pf(44.4), Shares: pf(24850000), IsGroupRow: true, GroupN: 4},
	}
	got := ScreenRows(rows)
	if len(got) != 3 {
		t.Fatalf("screen dropped a group row: %d of 3 survived: %s", len(got), names(got))
	}
}

func pf(f float64) *float64 { return &f }

// ScreenRows must be a pure function of its input order: two runs over the same
// rows produce the same rows, and the input slice is left alone.
func TestScreenIsDeterministic(t *testing.T) {
	for _, body := range []string{perfGraphIndexed, broadcastPercent, impliedTotalOutlier,
		proseAndForeignAddress, nonCommonClassPrefix, asciiProxy} {
		in := run(t, body)
		before := len(in)
		a, b := ScreenRows(in), ScreenRows(in)
		if names(a) != names(b) {
			t.Fatalf("not deterministic:\n%s\n%s", names(a), names(b))
		}
		if len(in) != before {
			t.Fatalf("ScreenRows mutated its input: %d -> %d", before, len(in))
		}
	}
}
