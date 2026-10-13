package main

import (
	"path/filepath"
	"testing"
)

func familyJJ2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_jj2", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_jj2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000092/926678/0000894189-13-004604.txt: 15-16; 45-50; 71; 103-105; 186-191;
// 335-528. The filing's FIRST fund section heads its table with an ordinary
// twelve-cell row whose first cell carries the fund and whose other eleven are
// `&#160;` spacers:
//
//	<td align="left" valign="top" width="21%">
//	<div ... align="left"><font ...>Brandes Institutional Intl Equity Fund</font></div>
//
// The later sections spell the same heading in a `colspan="2"` cell and resolve;
// this one is never read as a heading at all, so its rows carry neither a fund
// name nor a series. The name is also the registrant's abbreviated spelling --
// `Intl` for the declared and dictionary `International` (S000005855 is
// "Brandes International Equity Fund" in the header and "Brandes Institutional
// International Equity Fund" in the dictionary) -- so reading the cell is
// necessary but not sufficient. 1,021 of the filing's 3,695 rows.
func TestFamilyJJ2BrandesInstitutionalIntlHeadingCell(t *testing.T) {
	rows := familyJJ2Dispatch(t, "brandes_institutional_intl_heading.txt", "dict_926678.tsv", "htmltable", 3)
	for _, r := range rows {
		if r.CUSIP != "G5824M107" {
			t.Fatalf("identity precondition: CUSIP=%q issuer=%q", r.CUSIP, r.IssuerName)
		}
		if r.SeriesID != "S000005855" {
			t.Errorf("Brandes Institutional Intl Equity Fund: fund=%q series=%q want S000005855", r.FundName, r.SeriesID)
		}
	}
}

// 000081/810902/0001271631-06-000258.txt: 17; 25-26; 55-60; 66-70; 76-80; 86;
// 113-116; 184-230. Every fund section of this filing heads its table with the
// declared name plus a trailing type word and a colon, over a short dashed rule:
//
//	BARON ASSET FUND SERIES:
//	- ------------------------
//
// The declared name is `BARON ASSET FUND` (S000000582). The heading is not read,
// so the section's fund name is taken from wrapped proposal prose instead
// (`REGISTERED PUBLIC ACCOUNTING FIRM`) and every row of the filing -- 2,976 of
// 2,976 -- carries no series.
func TestFamilyJJ2BaronSeriesColonHeading(t *testing.T) {
	rows := familyJJ2Dispatch(t, "baron_series_colon_heading.txt", "dict_810902.tsv", "broadridge", 9)
	for _, r := range rows {
		if r.CUSIP != "00763M108" && r.CUSIP != "014752109" {
			t.Fatalf("identity precondition: CUSIP=%q issuer=%q", r.CUSIP, r.IssuerName)
		}
		if r.SeriesID != "S000000582" {
			t.Errorf("BARON ASSET FUND SERIES:: fund=%q series=%q want S000000582", r.FundName, r.SeriesID)
		}
	}
}

// 000007/76721/0000076721-12-000009.txt: 7; 15-16; 51-56; 71; 178-181; 194-198;
// 250-254; 24160-24195. The ESG Managers portfolios are reported one section per
// SLEEVE, and the heading names the portfolio by a short stem followed by the
// sub-adviser:
//
//	Fund Name : Agg Growth LB Pax World
//
// `Agg Growth` is the registrant's abbreviation of the declared `ESG Managers
// Aggressive Growth Portfolio` (S000027263); `Conservative`, `Growth` and
// `Moderate` head the other three. The sleeve suffix is not a declared name and
// the stem is never matched, so 20,380 of the filing's 25,796 rows carry no
// series while the seven `Pax World ...` sections all resolve.
func TestFamilyJJ2PaxESGSleeveHeadingStem(t *testing.T) {
	rows := familyJJ2Dispatch(t, "pax_esg_sleeve_heading.txt", "dict_76721.tsv", "icr", 13)
	for _, r := range rows {
		if r.CUSIP != "88579Y101" {
			t.Fatalf("identity precondition: CUSIP=%q issuer=%q", r.CUSIP, r.IssuerName)
		}
		if r.SeriesID != "S000027263" {
			t.Errorf("Agg Growth LB Pax World: fund=%q series=%q want S000027263", r.FundName, r.SeriesID)
		}
	}
}

// 000075/759947/0001104659-04-024500.txt: 17; 24-25; 56-60; 478-700. Each fund
// section of this 2004 filing prints its heading in a bold paragraph ABOVE the
// vote table rather than in a table row:
//
//	<p style="margin:0in 0in .0001pt;"><b><font ...>RSI Core Equity Fund</font></b></p>
//
// The heading is outside every `<tr>`, so the section's rows carry no fund name
// at all. The one section that does resolve heads its table `Proxy Vote Summary
// - RSI Retirement Trust Value Equity Fund`. The header declares no series and
// the dictionary backs it with four, whose names spell the trust
// (`RSI Retirement Trust - Core Equity Fund`, S000001852) where the heading
// abbreviates it to `RSI`. 2,761 of the filing's 2,971 rows.
func TestFamilyJJ2RSIParagraphHeadingAboveTable(t *testing.T) {
	rows := familyJJ2Dispatch(t, "rsi_core_equity_paragraph_heading.txt", "dict_759947.tsv", "htmltable", 1)
	for _, r := range rows {
		if r.CUSIP != "060505104" {
			t.Fatalf("identity precondition: CUSIP=%q issuer=%q", r.CUSIP, r.IssuerName)
		}
		if r.SeriesID != "S000001852" {
			t.Errorf("RSI Core Equity Fund: fund=%q series=%q want S000001852", r.FundName, r.SeriesID)
		}
	}
}

// 000120/1209466/0001438934-08-000267.txt: 17; 25-26; 49-50; 321-324; 330-334;
// 340; 825-826; 830-833; 48916-48945. The heading drops the trailing conjunct of
// the declared name:
//
//	PowerShares Dynamic Hardware Portfolio
//	- ----------------------------------------------------------------------
//
// against the declared `PowerShares Dynamic Hardware & Consumer Electronics
// Portfolio` (S000003050). 273 rows.
func TestFamilyJJ2PowerSharesTruncatedConjunctHeading(t *testing.T) {
	rows := familyJJ2Dispatch(t, "powershares_hardware_truncated_heading.txt", "dict_1209466.tsv", "broadridge", 5)
	for _, r := range rows {
		if r.CUSIP != "00846U101" {
			t.Fatalf("identity precondition: CUSIP=%q issuer=%q", r.CUSIP, r.IssuerName)
		}
		if r.SeriesID != "S000003050" {
			t.Errorf("PowerShares Dynamic Hardware Portfolio: fund=%q series=%q want S000003050", r.FundName, r.SeriesID)
		}
	}
}

// 000120/1209466/0001438934-08-000267.txt: same header ranges; 107860-107895.
// The same filing also abbreviates a WORD of the declared name -- `Telecom` for
// `Telecommunications`:
//
//	PowerShares Dynamic Telecom & Wireless Portfolio
//
// against the declared `PowerShares Dynamic Telecommunications & Wireless
// Portfolio` (S000003051). 284 rows.
func TestFamilyJJ2PowerSharesAbbreviatedWordHeading(t *testing.T) {
	rows := familyJJ2Dispatch(t, "powershares_telecom_abbrev_heading.txt", "dict_1209466.tsv", "broadridge", 5)
	for _, r := range rows {
		if r.CUSIP != "000886309" {
			t.Fatalf("identity precondition: CUSIP=%q issuer=%q", r.CUSIP, r.IssuerName)
		}
		if r.SeriesID != "S000003051" {
			t.Errorf("PowerShares Dynamic Telecom & Wireless Portfolio: fund=%q series=%q want S000003051", r.FundName, r.SeriesID)
		}
	}
}
