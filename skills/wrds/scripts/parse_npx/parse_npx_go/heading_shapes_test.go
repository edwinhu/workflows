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
