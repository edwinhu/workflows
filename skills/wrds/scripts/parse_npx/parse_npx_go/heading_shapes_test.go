package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSeriesFormerRegistrantName(t *testing.T) {
	// John Hancock Variable Insurance Trust 2012 heads funds with the
	// registrant's FORMER conformed name: `2Y23 John Hancock Trust Balanced
	// Trust`. 25 of 100 headings, 128,288 of 283,367 rows, had no series on
	// 2026-09-02.
	decls := []SeriesDecl{{SeriesID: "S1", Name: "Balanced Trust"}, {SeriesID: "S2", Name: "Bond Trust"}}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("JOHN HANCOCK VARIABLE INSURANCE TRUST"))
	if got := brResolveHeading(ix, "2Y23 John Hancock Trust Balanced Trust"); got != "" {
		t.Errorf("without the former name: %q, want nothing", got)
	}
	issFormerKeys(ix, []string{"JOHN HANCOCK TRUST", "MANUFACTURERS INVESTMENT TRUST"})
	for h, want := range map[string]string{
		"2Y23 John Hancock Trust Balanced Trust":              "S1",
		"2Y31 John Hancock Trust Bond Trust":                  "S2",
		"Manufacturers Investment Trust Bond Trust":           "S2",
		"2Y50 John Hancock Trust Ultra Short Term Bond Trust": "",
	} {
		if got := brResolveHeading(ix, h); got != want {
			t.Errorf("%q -> %q, want %q", h, got, want)
		}
	}
}

func TestHTMLBareFundLineLabelled(t *testing.T) {
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Putnam VT Capital Appreciation Fund"},
		{SeriesID: "S2", Name: "TFS Market Neutral Fund"},
	}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("PUTNAM VARIABLE TRUST"))
	for pre, want := range map[string]string{
		"Registrant Name : Putnam Variable Trust\nFund Name : Putnam VT Capital Appreciation Fund\nDate of fiscal year end: 12/31/2009": "S1",
		"NAME OF FUND: TFS MARKET NEUTRAL FUND (TFSMX)\nJuly 1, 2011 - June 30, 2012":                                                   "S2",
		"Registrant Name : Putnam Variable Trust\nFund Name : Putnam VT Vista Fund":                                                     "",
	} {
		_, id, _ := htmlBareFundLine(ix, pre)
		if id != want {
			t.Errorf("%q -> %q, want %q", pre, id, want)
		}
	}
}

func TestBroadridgeRecordsHeading(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", "B9_natixis_first_heading.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colSeriesID] != "S000008059" || r[colFundName] != "AEW Global Focused Real Estate Fund" {
			t.Errorf("series %q fund %q", r[colSeriesID], r[colFundName])
		}
	}
}

func TestHTMLTableClassLetterHeading(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H17_afis_class_letter.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colSeriesID] != "S000008786" || r[colFundName] != "a-Global Growth Fund" {
			t.Errorf("series %q fund %q", r[colSeriesID], r[colFundName])
		}
	}
}

func TestHTMLBareFundLineRegistrantDashFund(t *testing.T) {
	// The Ultimus vintage (filer agent 0001580642, 809k rows with no fund on
	// 2026-09-02) labels the section `Registrant: GLOBAL ATLANTIC PORTFOLIOS -
	// Global Atlantic American Funds® Managed Risk Portfolio`. Only the part
	// after the dash may name the fund; the registrant half never does, or a
	// trust sharing its flagship's name would stamp every other section.
	decls := []SeriesDecl{
		{SeriesID: "S1", Name: "Global Atlantic American Funds Managed Risk Portfolio"},
		{SeriesID: "S2", Name: "Global Atlantic Portfolios"},
	}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("FORETHOUGHT VARIABLE INSURANCE TRUST"))
	for pre, want := range map[string]string{
		"Registrant: GLOBAL ATLANTIC PORTFOLIOS -  Global Atlantic American Funds® Managed Risk Portfolio\nItem 1, Exhibit 1": "S1",
		"Registrant: GLOBAL ATLANTIC PORTFOLIOS\nItem 1, Exhibit 1":                                                           "",
		"Registrant: GLOBAL ATLANTIC PORTFOLIOS - Something Else Portfolio":                                                   "",
	} {
		_, id, _ := htmlBareFundLine(ix, pre)
		if id != want {
			t.Errorf("%q -> %q, want %q", pre, id, want)
		}
	}
}

func TestHTMLLabelledCellsOneCell(t *testing.T) {
	for _, tc := range []struct {
		cells        []string
		label, value string
		ok           bool
	}{
		{[]string{"Fund Name : Putnam VT Capital Appreciation Fund", ""}, "Fund Name", "Putnam VT Capital Appreciation Fund", true},
		{[]string{"NAME OF FUND: TFS MARKET NEUTRAL FUND (TFSMX)"}, "NAME OF FUND", "TFS MARKET NEUTRAL FUND (TFSMX)", true},
		{[]string{"Meeting Date: 05/12/2010"}, "", "", false},
		{[]string{"Fund Name :", "Putnam VT Vista Fund"}, "Fund Name :", "Putnam VT Vista Fund", true},
	} {
		l, v, ok := htmlLabelledCells(tc.cells)
		if ok != tc.ok || l != tc.label || v != tc.value {
			t.Errorf("%q -> %q %q %v, want %q %q %v", tc.cells, l, v, ok, tc.label, tc.value, tc.ok)
		}
	}
}

func TestHTMLTableStackedLabels(t *testing.T) {
	// Putnam Variable Trust 2010: a row of bare labels (`Ticker | Security ID:
	// | Meeting Date | Meeting Status`) over a row of values, the issuer
	// wrapped across two bold rows above. All 36,599 rows read the issuer as
	// "Ticker" with no security id or meeting date on 2026-09-02.
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H18_putnam_stacked_labels.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colIssuerName] != "Putnam Money Market Liquidity Fund" || r[colCUSIP] != "746763168" || r[colMeetingDate] != htmlDate("11/19/2009") || r[colMeetingDate] == "" {
			t.Errorf("issuer %q cusip %q date %q", r[colIssuerName], r[colCUSIP], r[colMeetingDate])
		}
	}
}

func TestHTMLReadContextValueInNextCell(t *testing.T) {
	ctx, labelled := htmlReadContext([]string{"Ticker:", "MMM", "Security ID:", "88579Y101"})
	if !labelled || ctx.Ticker != "MMM" || ctx.CUSIP != "88579Y101" {
		t.Errorf("ticker %q cusip %q labelled %v", ctx.Ticker, ctx.CUSIP, labelled)
	}
	ctx, _ = htmlReadContext([]string{"Meeting Date:", " MAY 12, 2020", "Meeting Type:", "Annual"})
	if ctx.MeetingDate != "20200512" {
		t.Errorf("date %q", ctx.MeetingDate)
	}
	// Two label cells in a row: the empty one stays empty.
	ctx, _ = htmlReadContext([]string{"Ticker:", "Security ID:", "88579Y101"})
	if ctx.Ticker != "" || ctx.CUSIP != "88579Y101" {
		t.Errorf("ticker %q cusip %q", ctx.Ticker, ctx.CUSIP)
	}
	// The same-cell form is unchanged.
	ctx, _ = htmlReadContext([]string{"Ticker: ARE   Security ID: 015271109"})
	if ctx.Ticker != "ARE" || ctx.CUSIP != "015271109" {
		t.Errorf("same cell: ticker %q cusip %q", ctx.Ticker, ctx.CUSIP)
	}
}

func TestLVPairsValueInNextCell(t *testing.T) {
	got := lvPairs(icrCells("Ticker:       ACGL           Security ID:  G0450A105"))
	want := []lvPair{{"TICKER", "ACGL"}, {"SECURITY ID", "G0450A105"}}
	if len(got) != 2 || got[0] != want[0] || got[1] != want[1] {
		t.Errorf("got %v want %v", got, want)
	}
	got = lvPairs(icrCells("Ticker:                      Security ID:  H01531104"))
	if len(got) != 2 || got[0].value != "" || got[1].value != "H01531104" {
		t.Errorf("foreign issuer without a symbol: %v", got)
	}
}

func TestHTMLPreLead(t *testing.T) {
	for _, tc := range []struct{ pre, fund, want string }{
		{"Gotham Absolute 500 Core Fund\n3M COMPANY", "Gotham Absolute 500 Core Fund", "3M COMPANY"},
		{"Gotham Absolute 500 Core Fund", "Gotham Absolute 500 Core Fund", ""},
		{"3M COMPANY\n\n", "", "3M COMPANY"},
		{"The fund did not hold any votable positions during the reporting period and so has nothing to report here.", "", ""},
	} {
		if got := htmlPreLead(tc.pre, tc.fund); got != tc.want {
			t.Errorf("%q -> %q, want %q", tc.pre, got, tc.want)
		}
	}
}

func TestHTMLReadContextWrappedLabel(t *testing.T) {
	// GMO Trust 2005: the label cell wraps at a source newline.
	ctx, labelled := htmlReadContext([]string{"Meeting\n  Date:", "MAY 18, 2005", "Meeting\n  Type:", "Annual"})
	if !labelled || ctx.MeetingDate != "20050518" {
		t.Errorf("date %q labelled %v", ctx.MeetingDate, labelled)
	}
	// ... and so does the value cell.
	ctx, _ = htmlReadContext([]string{"Meeting\n  Date:", "MAY 12,\n  2005", "Meeting\n  Type:", "Annual"})
	if ctx.MeetingDate != "20050512" {
		t.Errorf("wrapped value: date %q", ctx.MeetingDate)
	}
	if got := htmlPreLead("GMO Trust\n\nGENTING\n  LEISURE LTD.\n\n", ""); got != "GENTING LEISURE LTD." {
		t.Errorf("wrapped issuer paragraph: %q", got)
	}
}
