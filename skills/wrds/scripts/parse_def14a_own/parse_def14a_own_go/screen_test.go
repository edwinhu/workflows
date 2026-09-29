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

// ---------------------------------------------------------------------------
// The absorbed amount/percent pair, the postal-address stub, the wrap fragment,
// the 100%-of-class row and the twice-emitted holder. Every fixture below is
// transcribed from a real filing's own `-debug` output.
// ---------------------------------------------------------------------------

// 0000950117-99-000732 (cik 862510, Transatlantic Holdings), lines 487-497. The
// table carries FOUR issuers side by side -- TRH common, AIG common, STARR
// common, SICO voting -- each with its own amount and percent column pair. The
// name cell absorbed the FIRST pair, which is the registrant's own class, and
// the row was then emitted once per remaining pair, so the percent reported is
// another issuer's: Matthews holds .07% of TRH, not 10.98% (STARR) or 8.33%
// (SICO). The pair inside the name cell is the row's real holding.
func TestAbsorbedAmountPercentPairIsTheRowsOwnHolding(t *testing.T) {
	// Every row the extractor emitted for that table, from `-debug`.
	rows := []Row{
		{HolderName: "Paul A. Bonny 33,960 .10", TableIndex: 1, RowIndex: 491, Shares: pf(4468)},
		{HolderName: "M.R. Greenberg 51,250 .15", TableIndex: 1, RowIndex: 493, Shares: pf(27327297), Percent: pf(2.21)},
		{HolderName: "M.R. Greenberg 51,250 .15", TableIndex: 1, RowIndex: 493, Shares: pf(5000), Percent: pf(24.39)},
		{HolderName: "M.R. Greenberg 51,250 .15", TableIndex: 1, RowIndex: 493, Shares: pf(10), Percent: pf(8.33)},
		{HolderName: "Edward E. Matthews 25,625 .07", TableIndex: 1, RowIndex: 495, Shares: pf(2250), Percent: pf(10.98)},
		{HolderName: "Edward E. Matthews 25,625 .07", TableIndex: 1, RowIndex: 495, Shares: pf(10), Percent: pf(8.33)},
		{HolderName: "Robert V. Mucci 50,021 .14", TableIndex: 1, RowIndex: 496, Shares: pf(9393)},
		{HolderName: "Robert F. Orlich 118,113 .34", TableIndex: 1, RowIndex: 497, Shares: pf(250), Percent: pf(1.22)},
		{HolderName: "Howard I. Smith 2,000 .01", TableIndex: 1, RowIndex: 500, Shares: pf(1500), Percent: pf(7.32)},
		{HolderName: "Howard I. Smith 2,000 .01", TableIndex: 1, RowIndex: 500, Shares: pf(10), Percent: pf(8.33)},
		{HolderName: "Thomas R. Tizzio 25,625 .07", TableIndex: 1, RowIndex: 501, Shares: pf(1750), Percent: pf(8.54)},
	}
	got := ScreenRows(rows)
	n := 0
	for _, r := range got {
		if r.HolderName == "Edward E. Matthews" {
			n++
			if r.Percent == nil || *r.Percent != 0.07 || r.Shares == nil || *r.Shares != 25625 {
				t.Fatalf("want Matthews .07 on 25,625, got pct=%v shares=%v", fmtp(r.Percent), fmtp(r.Shares))
			}
		}
		if strings.ContainsAny(r.HolderName, "0123456789") {
			t.Fatalf("a numeric column is still glued to the name: %q", r.HolderName)
		}
		// No surviving row may report another issuer's percent.
		if r.Percent != nil && (*r.Percent == 8.33 || *r.Percent == 10.98 || *r.Percent == 24.39) {
			t.Fatalf("row %q kept another issuer's percent %v", r.HolderName, *r.Percent)
		}
	}
	if n != 1 {
		t.Fatalf("want exactly one Matthews row, got %d: %s", n, names(got))
	}
}

// 0000899681-99-000162 (cik 945114, Systemax), lines 448-449: "The Kaufman Fund
// (8)" sits on the line above and the numeric row carries only the address, so
// the emitted holder is a street address. No holder means no row.
func TestWholeCellPostalAddressIsNotAHolder(t *testing.T) {
	rows := []Row{
		{HolderName: "All current directors and executive officers of the Company (10 persons)",
			TableIndex: 1, RowIndex: 444, IsGroupRow: true, GroupN: 10,
			Shares: pf(26075808), Percent: pf(68.2)},
		{HolderName: "145 East 45th Street, New York, NY 10017", TableIndex: 1, RowIndex: 449,
			Shares: pf(2500000), Percent: pf(6.5)},
	}
	got := ScreenRows(rows)
	if len(got) != 1 || !got[0].IsGroupRow {
		t.Fatalf("want only the group row, got %s", names(got))
	}
}

// 0001032210-98-000209 (cik 107189, Willamette Industries), lines 294-308. Each
// holder's stub runs name / street / city / state+ZIP over four lines while the
// numbers break out Sole, Shared and Total. Three of the emitted rows are the
// address lines and one is the Total line with an empty name cell, so the share
// count slid into it.
func TestAddressAndNumberLedStubLinesAreNotHolders(t *testing.T) {
	rows := []Row{
		{HolderName: "Wells Fargo Bank", TableIndex: 1, RowIndex: 303,
			Shares: pf(4099430), Percent: pf(3.68)},
		{HolderName: "Portland, Oregon 97201", TableIndex: 1, RowIndex: 296,
			Shares: pf(6032726), Percent: pf(5.41)},
		{HolderName: "California 94163", TableIndex: 1, RowIndex: 307, Percent: pf(8.53)},
		{HolderName: "9,496,022 Total", TableIndex: 1, RowIndex: 308,
			Percent: pf(8.53), ShareClass: "COMMON STOCK"},
	}
	got := ScreenRows(rows)
	if len(got) != 1 || got[0].HolderName != "Wells Fargo Bank" {
		t.Fatalf("want only the bank, got %s", names(got))
	}
}

// 0000950130-00-001959 (cik 920148, Genentech): the name column wraps, so
// "PricewaterhouseCoopers / Company, LLP" and "Thomas P. Mac Mahon, / Jr" leave
// a tail made of nothing but corporate-form words. A name with no identifying
// token names nobody. "U.S. Trust Corporation" is the same shape with an
// initialism and is a real holder, so it stays.
func TestCorporateFormOnlyFragmentIsNotAHolder(t *testing.T) {
	rows := []Row{
		{HolderName: "Company, LLP", TableIndex: 1, RowIndex: 480,
			Shares: pf(12310000), Percent: pf(9.3), ShareClass: "Common Stock"},
		{HolderName: "Jr", TableIndex: 1, RowIndex: 496, Percent: pf(8.6)},
		{HolderName: "Inc., et al", TableIndex: 1, RowIndex: 498, Percent: pf(8.7)},
		{HolderName: "U.S. Trust Corporation", TableIndex: 1, RowIndex: 500, Percent: pf(6.4)},
		{HolderName: "Roche Holdings, Inc", TableIndex: 1, RowIndex: 470,
			Shares: pf(61330000), Percent: pf(46.2), ShareClass: "Common Stock"},
	}
	got := ScreenRows(rows)
	if names(got) != "[U.S. Trust Corporation][Roche Holdings, Inc]" {
		t.Fatalf("want the initialism and the real holder, got %s", names(got))
	}
}

// 0000912057-01-007088 (cik 1004980, PG&E): a compact HTML table whose name
// column holds the surname alone and whose third column is the FOOTNOTE number,
// read as a percent. A lone surname with no initial, no punctuation and no
// corporate word is the tail of a wrapped name column.
func TestBareSurnameIsNotAHolder(t *testing.T) {
	rows := []Row{
		{HolderName: "Gorter", TableIndex: 19, RowIndex: 3, Shares: pf(49359), Percent: pf(10)},
		{HolderName: "Magowan", TableIndex: 19, RowIndex: 4, Shares: pf(319249), Percent: pf(11)},
		{HolderName: "AMVESCAP P.L.C", TableIndex: 4, RowIndex: 9, Percent: pf(6.6)},
		{HolderName: "Barton, Jr.", TableIndex: 4, RowIndex: 10, Percent: pf(7.1)},
	}
	got := ScreenRows(rows)
	if names(got) != "[AMVESCAP P.L.C][Barton, Jr.]" {
		t.Fatalf("want the two punctuated names, got %s", names(got))
	}
}

// 0000950152-01-500914 (cik 1042809, OfficeMax), lines 433-447: a table of
// SERIES A VOTING PREFERENCE SHARES with one holder at 100% of that class. A
// registrant that files a DEF 14A has public voting shareholders, so a single
// non-group holder of exactly 100.00% of a class is never the common stock the
// proxy is soliciting -- it is another class, or a total line.
func TestExactlyOneHundredPercentOfAClassIsNotCommonStock(t *testing.T) {
	rows := []Row{
		{HolderName: "Orient Star Holdings LLC", TableIndex: 1, RowIndex: 400,
			Shares: pf(16910000), Percent: pf(14.94)},
		{HolderName: "Gateway Companies, Inc", TableIndex: 2, RowIndex: 444,
			Shares: pf(3076923), Percent: pf(100)},
	}
	got := ScreenRows(rows)
	if len(got) != 1 || got[0].HolderName != "Orient Star Holdings LLC" {
		t.Fatalf("want only the common-stock holder, got %s", names(got))
	}
}

// 0000898430-99-000684 (cik 900075, Whittaker): the 5% table and the combined
// D&O table both disclose Alibrandi, so the same holding is emitted twice. One
// holder, one row per filing -- but a second row carrying a DIFFERENT percent is
// a different holding and is left alone.
func TestTheSameHolderAndPercentIsEmittedOnce(t *testing.T) {
	rows := []Row{
		{HolderName: "Joseph F. Alibrandi", TableIndex: 200, RowIndex: 210,
			Shares: pf(658000), Percent: pf(5.77)},
		{HolderName: "Joseph F. Alibrandi", TableIndex: 253, RowIndex: 264,
			Shares: pf(658000), Percent: pf(5.77)},
		{HolderName: "Carl H. Lindner", TableIndex: 253, RowIndex: 270, Percent: pf(5.8)},
		{HolderName: "Carl H. Lindner III", TableIndex: 253, RowIndex: 271, Percent: pf(9.8)},
	}
	got := ScreenRows(rows)
	if names(got) != "[Joseph F. Alibrandi][Carl H. Lindner][Carl H. Lindner III]" {
		t.Fatalf("want one Alibrandi and both Lindners, got %s", names(got))
	}
}

// 0000072162-98-000011 (cik 72162, NL Industries): the lead-in sentence's tail
// reaches the name column -- "Contran are the holders of approximately" -- with
// the sentence's own percent beside it.
func TestProseTailIsNotAHolder(t *testing.T) {
	rows := []Row{
		{HolderName: "Contran are the holders of approximately", TableIndex: 1, RowIndex: 120,
			Percent: pf(74.8)},
		{HolderName: "Valhi, Inc", TableIndex: 1, RowIndex: 130, Percent: pf(56.3)},
	}
	got := ScreenRows(rows)
	if len(got) != 1 || got[0].HolderName != "Valhi, Inc" {
		t.Fatalf("want only Valhi, got %s", names(got))
	}
}
