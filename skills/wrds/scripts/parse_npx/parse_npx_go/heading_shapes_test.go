package main

import (
	"os"
	"path/filepath"
	"strings"
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

func TestHTMLTableProxyEdgeGrid(t *testing.T) {
	// Gabelli Equity Series Funds 2017: the ProxyEdge report as HTML. Labels
	// without colons in their own cells, the issuer on its own row, the fund
	// inside a cover-table cell. Every row lacked issuer, id, date and series.
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H19_gabelli_proxyedge.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colSeriesID] != "S000001061" || r[colIssuerName] != "BT GROUP PLC, LONDON" || r[colCUSIP] != "G16612106" || r[colISIN] != "GB0030913577" || r[colMeetingDate] != "20160713" {
			t.Errorf("series %q issuer %q cusip %q isin %q date %q", r[colSeriesID], r[colIssuerName], r[colCUSIP], r[colISIN], r[colMeetingDate])
		}
	}
}

func TestHTMLDataRowProposalTypeHoldsProponent(t *testing.T) {
	// Prudential Series Fund 2005: `Proposal Type` maps to the description,
	// but the row prints MGMT there and the proposal in an unlabelled
	// spanning cell.
	cells := []string{"", "", "", "", "", "", "1.01        Elect Directors", "", "MGMT", "", "YES", "", "FOR", "", "FOR"}
	mapping := map[string]int{htmlFieldDesc: 8, htmlFieldVote: 12, htmlFieldMgmtRec: 14}
	r, ok := htmlDataRow(cells, mapping, len(cells), htmlContext{})
	if !ok || r.VoteDescription != "1.01 Elect Directors" || r.VoteSource != "MGMT" || r.HowVoted != "FOR" {
		t.Errorf("ok %v desc %q source %q vote %q", ok, r.VoteDescription, r.VoteSource, r.HowVoted)
	}
	// The sibling shape, where Proposal Type IS the description, is unchanged.
	cells = []string{"Elect Directors", "YES", "FOR", "FOR"}
	mapping = map[string]int{htmlFieldDesc: 0, htmlFieldVote: 2, htmlFieldMgmtRec: 3}
	if r, ok := htmlDataRow(cells, mapping, len(cells), htmlContext{}); !ok || r.VoteDescription != "Elect Directors" {
		t.Errorf("sibling shape: ok %v desc %q", ok, r.VoteDescription)
	}
}

func TestHTMLTableSharedHeaderIdentityRow(t *testing.T) {
	// Prudential Series Fund 2005: issuer, ticker, CUSIP and date in a row
	// under the same header as the proposals; the proposal text spans the
	// identity columns and 'Proposal Type' holds MGMT.
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H20_prudential_shared_header.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colIssuerName] != "Ivax Corp" || r[colCUSIP] != "465823102" || r[colMeetingDate] != "20040715" || !strings.Contains(r[colVoteDescription], "Elect Directors") || r[colVoteDescription] == "MGMT" {
			t.Errorf("issuer %q cusip %q date %q desc %q", r[colIssuerName], r[colCUSIP], r[colMeetingDate], r[colVoteDescription])
		}
	}
}

func TestHTMLReadContextNotADataRow(t *testing.T) {
	// Buffalo Funds print 'Issuer' as the proponent: a four-cell vote row must
	// never be read as an identity row (173,538 rows lost across 395 filings
	// on run55).
	for _, cells := range [][]string{
		{"1", "Elect Director John Smith", "Issuer", "For"},
		{"2", "Ratify Auditors", "For", "For", "Issuer"},
		{"Ticker", "ABC", "Meeting Date", "For"},
		{"Company Name", "Ticker", "Cusip", "Meeting Date"},
	} {
		if _, labelled := htmlReadContext(cells); labelled {
			t.Errorf("%q read as an identity row", cells)
		}
	}
	// The Gabelli identity rows still read.
	if ctx, labelled := htmlReadContext([]string{"", "", "Security", "G16612106", "", "Meeting Type", "Annual General Meeting"}); !labelled || ctx.CUSIP != "G16612106" {
		t.Errorf("Gabelli security row: labelled %v cusip %q", labelled, ctx.CUSIP)
	}
}

func TestHTMLIdentityRowRefusesHeader(t *testing.T) {
	mapping := map[string]int{htmlFieldIssuer: 0, htmlFieldTicker: 1, htmlFieldDesc: 2, htmlFieldVote: 3}
	if _, ok := htmlIdentityRow([]string{"Company Name", "Ticker", "", ""}, mapping); ok {
		t.Error("a repeated header row read as an identity row")
	}
	if ctx, ok := htmlIdentityRow([]string{"Ivax Corp", "IVX", "", ""}, mapping); !ok || ctx.Issuer != "Ivax Corp" {
		t.Errorf("identity row: ok %v issuer %q", ok, ctx.Issuer)
	}
}

func TestHTMLReadContextIssuerBeforeLabelsOnOneLine(t *testing.T) {
	// Fidelity Investment Trust 2009 prints the issuer and all three labels on
	// one line: 24,488 rows with no security id on 2026-09-02.
	ctx, labelled := htmlReadContext([]string{"TELUS CORPORATION MEETING DATE: MAY 7, 2009    TICKER: T     SECURITY ID: 87971M996"})
	if !labelled || ctx.Issuer != "TELUS CORPORATION" || ctx.CUSIP != "87971M996" || ctx.Ticker != "T" || ctx.MeetingDate != "20090507" {
		t.Errorf("labelled %v issuer %q cusip %q ticker %q date %q", labelled, ctx.Issuer, ctx.CUSIP, ctx.Ticker, ctx.MeetingDate)
	}
	// A proposal that merely mentions one label mid-sentence is not context.
	if _, labelled := htmlReadContext([]string{"Approve the change of the company's ticker: from ABC to XYZ on the exchange"}); labelled {
		t.Error("a sentence mentioning a label read as context")
	}
}

func TestHTMLTableStackedLabelsAcrossSpacer(t *testing.T) {
	// Buffalo Funds 2023: `Company Name | Meeting Date | CUSIP | Ticker` over
	// a blank spacer row over the values; the votes sit in column 0.
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H21_buffalo_stacked_spacer.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colIssuerName] != "AGILENT TECHNOLOGIES, INC." || r[colCUSIP] != "00846U101" || r[colTicker] != "A" || r[colMeetingDate] != "20230315" || r[colHowVoted] != "For" {
			t.Errorf("issuer %q cusip %q ticker %q date %q vote %q", r[colIssuerName], r[colCUSIP], r[colTicker], r[colMeetingDate], r[colHowVoted])
		}
	}
}

func TestSecurityIDThatIsAnISIN(t *testing.T) {
	if icrISIN("GB00B0BL5R37") != "GB00B0BL5R37" || icrISIN("015271109") != "" || icrCUSIP("GB00B0BL5R37") != "" {
		t.Error("ISIN/CUSIP token split")
	}
	ctx, _ := htmlReadContext([]string{"Ticker:", "Security ID: GB00B0BL5R37"})
	if ctx.ISIN != "GB00B0BL5R37" || ctx.CUSIP != "" {
		t.Errorf("htmltable: isin %q cusip %q", ctx.ISIN, ctx.CUSIP)
	}
	ctx, _ = htmlReadContext([]string{"Security ID: 015271109"})
	if ctx.CUSIP != "015271109" || ctx.ISIN != "" {
		t.Errorf("htmltable cusip: isin %q cusip %q", ctx.ISIN, ctx.CUSIP)
	}
}

func TestVanguard2004DateWithoutColon(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "vanguard", "V6_2004_no_colon_date.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	for _, r := range rows {
		if r[colIssuerName] != "1-800 CONTACTS, INC." || r[colCUSIP] != "681977104" || r[colMeetingDate] != "20040521" {
			t.Errorf("issuer %q cusip %q date %q", r[colIssuerName], r[colCUSIP], r[colMeetingDate])
		}
	}
}

func TestHTMLStackedValuesOffByOne(t *testing.T) {
	labels := map[int]string{1: "TICKER", 2: "CUSIP", 6: "MEETING DATE", 8: "MEETING STATUS"}
	cells := []string{"", "PG", "CUSIP 742718109", "", "", "10/11/2016", "", "Voted", ""}
	ctx := htmlStackedValues(cells, labels)
	if ctx.Ticker != "PG" || ctx.CUSIP != "742718109" || ctx.MeetingDate != "20161011" {
		t.Errorf("ticker %q cusip %q date %q", ctx.Ticker, ctx.CUSIP, ctx.MeetingDate)
	}
}

func TestHTMLDataRowRejectsLabelVote(t *testing.T) {
	mapping := map[string]int{htmlFieldVote: 0, htmlFieldDesc: 2, htmlFieldBy: 3}
	for _, cells := range [][]string{{"Period:", "", "July 1, 2022-June 30, 2023", ""}, {"Company Name", "", "Meeting Date", "CUSIP"}} {
		if _, ok := htmlDataRow(cells, mapping, 4, htmlContext{}); ok {
			t.Errorf("%q emitted as a vote", cells)
		}
	}
	if _, ok := htmlDataRow([]string{"For", "", "1.1 Election of Director", ""}, mapping, 4, htmlContext{}); !ok {
		t.Error("a real vote row refused")
	}
	// 'No' is a vote in a Voted? export, whatever else the word means.
	if _, ok := htmlDataRow([]string{"No", "", "Approve Discharge of Management Board", "Management"}, mapping, 4, htmlContext{}); !ok {
		t.Error("a 'No' vote refused")
	}
}

func TestHTMLReadContextDeutscheGrid(t *testing.T) {
	// db-X Exchange-Traded Funds 2014: labels two cells before their values,
	// six filled cells to a row, 'Primary CUSIP <value>' in one cell.
	ctx, labelled := htmlReadContext([]string{"Meeting Date", "", "07/16/2013", "", "Country", "", "USA", "", "Provider Security ID", "", "35671D857"})
	if !labelled || ctx.MeetingDate != "20130716" || ctx.CUSIP != "35671D857" {
		t.Errorf("row 1: labelled %v date %q cusip %q", labelled, ctx.MeetingDate, ctx.CUSIP)
	}
	ctx, _ = htmlReadContext([]string{"Record Date", "", "05/24/2013", "", "Meeting Type", "", "Annual", "", "Ticker", "", "FCX"})
	if ctx.Ticker != "FCX" {
		t.Errorf("row 2: ticker %q", ctx.Ticker)
	}
	ctx, _ = htmlReadContext([]string{"Shares Voted 100", "", "Primary CUSIP 35671D857", "", "Primary ISIN US35671D8570", "", "Primary SEDOL 2352118"})
	if ctx.CUSIP != "35671D857" || ctx.ISIN != "US35671D8570" {
		t.Errorf("row 3: cusip %q isin %q", ctx.CUSIP, ctx.ISIN)
	}
}

func TestHTMLReadContextWideDataRowWithNoVote(t *testing.T) {
	// Brighthouse prints 'No' as the vote of an unvoted item; the row's CUSIP
	// value must not make it an identity row.
	if _, labelled := htmlReadContext([]string{"Aalberts NV", "", "20230101", "", "AALB", "", "N0300L103", "", "CUSIP", "", "1", "", "Accept Financial Statements", "", "MGMT", "", "For", "", "No"}); labelled {
		t.Error("a wide data row read as identity")
	}
}

func TestHTMLIdentityRowVoteSummaryReport(t *testing.T) {
	// SSGA Funds 2007 / Thrivent 2008: 'Mtg Date/Type | Company/Ballot Issues |
	// Security | Mgmt Rec | Vote Cast | Record Date | Prpnent | Shares Voted'.
	mapping := map[string]int{htmlFieldMtgDate: 0, htmlFieldDesc: 2, htmlFieldCUSIP: 3, htmlFieldMgmtRec: 4, htmlFieldVote: 5, htmlFieldBy: 7}
	ctx, ok := htmlIdentityRow([]string{"05/02/07 - A", "", "Advanced\nEnergy Industries, Inc. *AEIS*", "007973100", "", "", "03/12/07", "", "4,125"}, mapping)
	if !ok || ctx.Issuer != "Advanced Energy Industries, Inc." || ctx.Ticker != "AEIS" || ctx.CUSIP != "007973100" || ctx.MeetingDate != "20070502" {
		t.Errorf("ok %v issuer %q ticker %q cusip %q date %q", ok, ctx.Issuer, ctx.Ticker, ctx.CUSIP, ctx.MeetingDate)
	}
	// A "Security" column holding a name never becomes a CUSIP.
	if c, i := htmlSecurityID("Advanced Energy Industries"); c != "" || i != "" {
		t.Errorf("name as id: %q %q", c, i)
	}
}

func TestHTMLDataRowISINColumnAndCarry(t *testing.T) {
	mapping := map[string]int{htmlFieldMtgDate: 0, htmlFieldIssuer: 1, htmlFieldISIN: 2, htmlFieldItem: 4, htmlFieldDesc: 5, htmlFieldBy: 6, htmlFieldMgmtRec: 7, htmlFieldVote: 8}
	r, ok := htmlDataRow([]string{"05/27/2015", "GCL-Poly Energy Holdings Ltd.", "KYG3774X1088", "B4XZWN4", "1", "Approve Share Option Scheme", "Mgmt", "For", "Against"}, mapping, 9, htmlContext{})
	if !ok || r.ISIN != "KYG3774X1088" || r.MeetingDate != "20150527" || r.IssuerName != "GCL-Poly Energy Holdings Ltd." {
		t.Errorf("ok %v isin %q date %q issuer %q", ok, r.ISIN, r.MeetingDate, r.IssuerName)
	}
	// The next row prints no identity; it falls back to the context carried from the first.
	ctx := htmlContext{Issuer: r.IssuerName, ISIN: r.ISIN, MeetingDate: r.MeetingDate}
	r2, ok := htmlDataRow([]string{"", "", "", "", "2", "Approve Co-establishment of Joint Venture", "Mgmt", "For", "Against"}, mapping, 9, ctx)
	if !ok || r2.ISIN != "KYG3774X1088" || r2.MeetingDate != "20150527" || r2.IssuerName != "GCL-Poly Energy Holdings Ltd." {
		t.Errorf("carry: ok %v isin %q date %q issuer %q", ok, r2.ISIN, r2.MeetingDate, r2.IssuerName)
	}
}

func TestHTMLDateTwoDigitYearWithTime(t *testing.T) {
	for in, want := range map[string]string{"15-Oct-14 11:30": "20141015", "10-Nov-14 15:00": "20141110", "05/27/2015 10:00": "20150527", "24-May-2012": "20120524", "11/19/2009": "20091119"} {
		if got := htmlDate(in); got != want {
			t.Errorf("htmlDate(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestHTMLFundHeadingSkipsPeriodLine(t *testing.T) {
	for _, pre := range []string{"Vote Summary Report\nReporting Period: 07/01/2013 to 06/30/2014\n", "Vote Summary Report\nJuly 1, 2009 - June 30, 2010\n"} {
		if name, _ := htmlFundHeading(pre); name != "" {
			t.Errorf("period line read as fund: %q", name)
		}
	}
	if name, ok := htmlFundHeading("Vote Summary Report\nIvy Funds VIP Asset Strategy\n"); !ok || name != "Ivy Funds VIP Asset Strategy" {
		t.Errorf("real heading: %q %v", name, ok)
	}
}

func TestHTMLBareFundLineWrappedLabelValueAndBanner(t *testing.T) {
	decls := []SeriesDecl{{SeriesID: "S1", Name: "db X-trackers MSCI Brazil Hedged Equity Fund"}, {SeriesID: "S2", Name: "Clarion Global Real Estate Portfolio"}}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("DBX ETF TRUST"))
	if _, id, _ := htmlBareFundLine(ix, "Reporting Period: 07/01/2013 to 06/30/2014\nInstitution Account(s): db X-trackers MSCI Brazil\nHedged Equity Fund\nBanco Santander Brasil SA"); id != "S1" {
		t.Errorf("wrapped label value: %q", id)
	}
	if _, id, _ := htmlBareFundLine(ix, "MET INVESTORS SERIES TRUST\n===================== Clarion Global Real Estate Portfolio =====================\n"); id != "S2" {
		t.Errorf("banner: %q", id)
	}
	if _, d := issResolveFund(ix, "Clarion Global Real Estate Portfolio, a series of Met Investors Series Trust"); d == nil || d.SeriesID != "S2" {
		t.Error("', a series of' clause")
	}
}

func TestSeriesLeadingEnumerator(t *testing.T) {
	decls := []SeriesDecl{{SeriesID: "S1", Name: "SC Ibbotson Balanced Fund"}, {SeriesID: "S2", Name: "Sun Capital Global Real Estate Fund"}}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("SUN CAPITAL ADVISERS TRUST"))
	for h, want := range map[string]string{
		"1.A.  SC IBBOTSON BALANCED FUND":        "S1",
		"2. Sun Capital Global Real Estate Fund": "S2",
		"(3) SC Ibbotson Balanced Fund":          "S1",
		"I. SC Ibbotson Balanced Fund":           "S1",
		"SC Ibbotson Balanced Fund":              "S1",
		"1.A. SC Ibbotson Growth Fund":           "", // not declared
	} {
		_, d := issResolveFund(ix, h)
		got := ""
		if d != nil {
			got = d.SeriesID
		}
		if got != want {
			t.Errorf("%q -> %q, want %q", h, got, want)
		}
	}
	if _, ok := issLeadingEnumerator("Core Fund"); ok {
		t.Error("a fund's first word cut as an enumerator")
	}
}

func TestHTMLBareFundLineFundLabel(t *testing.T) {
	decls := []SeriesDecl{{SeriesID: "S1", Name: "SP AIM Aggressive Growth Portfolio"}, {SeriesID: "S2", Name: "Money Market Portfolio"}}
	ix := newISSSeriesIndex(decls, normalizeSeriesName("PRUDENTIAL SERIES FUND INC"))
	_, id, _ := htmlBareFundLine(ix, "Trust: Prudential Series Fund\nManager: Prudential\nFund: PSF: SP Aim Aggressive Growth Portfolio\n")
	if id != "S1" {
		t.Errorf("Fund: label: %q", id)
	}
	// A footnote 'Fund:' that resolves to nothing sets nothing.
	if _, id, ok := htmlBareFundLine(ix, "Fund: With Performance Fees Only\n"); ok || id != "" {
		t.Errorf("footnote: %q %v", id, ok)
	}
}
