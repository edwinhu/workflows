package main

import "testing"

// 000113/1131042/0001137439-05-000199.txt: 1-30, 52-58, 1190-1215, 1575-1590.
// AssetMark Funds' 2005 N-PX declares no series and is backed by the
// dictionary, whose names for CIK 1131042 include `AssetMark Large Cap Growth
// Fund` (S000006182) exactly. The filing labels the fund above every block:
//
//	Name of Fund:                       Assetmark Large Cap Growth Fund
//	Period:                             July 1, 2004 - September 30, 2004
//	=========================================================================
//
//	Account Number: 3596 Assetmark LG CAP GR
//
//	ISSUER NAME                             TICKER      CUSIP      MTG DATE
//	Dell Inc                                DELL        24702R101  7/16/04
//	         1.01   Elect Donald J. Carty            MGMT   YES   FOR   FOR
//
// parseVanguard claims the filing on its `FUND:`/`ISSUER:` signature but never
// reads the `Name of Fund:` label, so all 544 rows carry a blank fund_name and
// a blank series. The trailing verbatim range is the `Issuer:` block that
// carries matchVanguard's second signature token in the real file's head.
func TestFamilyZZ2AssetMarkNameOfFund(t *testing.T) {
	rows := familyZZDispatch(t, "family_zz2", "assetmark_name_of_fund.txt", "assetmark_dict.tsv", "vanguard", 10)
	for _, r := range rows {
		if r.SeriesID != "S000006182" {
			t.Errorf("AssetMark Large Cap Growth: fund=%q issuer=%q item=%q series=%q want S000006182", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000073/737520/0000737520-05-000010.txt: 1-30, 59-76, 196-760. Dreyfus Premier
// New Leaders Fund's 2005 N-PX declares no series and is backed by the
// dictionary, which carries 21 names for CIK 737520 (the registrant later
// became the umbrella for the Dreyfus/BNY Mellon funds), so the chassis'
// single-series stamp does not fire. The filing names its one fund in a
// monospace masthead that sits in a <P> BEFORE the vote <TABLE>:
//
//	<FONT size=2 face="monospace">==================== DREYFUS PREMIER NEW LEADERS FUND, INC. ====================</FONT></P>
//	<TABLE border=0 cellspacing=1 cellpadding=0>
//	<TR valign="bottom">
//	        <TD width=56% nowrap colspan=5 align=left>
//	<FONT size=2 face="monospace">ALUMINA LTD (FORMERLY WMC LIMITED)</FONT>&nbsp;
//
// parseHTMLTable reads headings from inside the table, so the masthead outside
// it is never seen: all 533 rows carry a blank fund_name and a blank series.
// The dictionary spells the fund `DREYFUS PREMIER NEW LEADERS FUND`
// (S000000092), which the masthead prints plus a terminal `, INC.`.
func TestFamilyZZ2DreyfusNewLeadersMasthead(t *testing.T) {
	rows := familyZZDispatch(t, "family_zz2", "dreyfus_new_leaders_masthead.txt", "dreyfus_dict.tsv", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000000092" {
			t.Errorf("Dreyfus Premier New Leaders: fund=%q issuer=%q item=%q series=%q want S000000092", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
