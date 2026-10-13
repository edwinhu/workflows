package main

import (
	"path/filepath"
	"testing"
)

// familyGGG2Dispatch runs the real dispatch on a family GGG no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary.
func familyGGG2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ggg2", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ggg2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000091/912577/0001056288-04-000555.txt: 12-13, 15-17, 25-26, 53-58, 108-152.
// Federated Insurance Series' 2004 N-PX declares NO series in its SGML header
// (`grep -c SERIES-ID` is 0), so every name the resolver sees is backfilled
// from cik_series.tsv for CIK 0000912577, which holds thirteen ids. The filing
// prints eight `Account Number:` sections, all the same shape:
//
//	Account Number: <u>IFISCF Federated International Small Co. Fund 2</u> <br>
//	Account Number: <u>Federated International Equity Fund II</u> <br>
//
// Seven of the eight name a fund the dictionary spells exactly. The first does
// not: no `cik_series.tsv` row, under CIK 0000912577 or under any other CIK,
// carries `Federated International Small Co. Fund 2` or any `International
// Small Co` name for this registrant.
//
// The current binary nevertheless stamps those rows S000009750 -- which is
// `Federated International Equity Fund II`, the fund the SAME filing gives its
// own separate section at line 21601. Two sections of one filing, two distinct
// funds, one series id: a full-file dispatch emits 7,213 rows of which 773
// carry S000009750 from the heading that names it and a further 141 carry
// S000009750 from this heading, contaminating the series with a fund that is
// not it. `IFISCF` is the Federated alphabetic account code, read past by the
// `accountNumber && f[1] == "Federated"` branch, and the remainder is then
// admitted by a tolerance in issResolveFund rather than refused.
//
// The fixture carries the WHOLE 22-row dictionary for the CIK, not the two
// entries the argument names: with only S000009742 and S000009750 loaded the
// heading resolves to nothing and the cut passes while the real filing leaks.
// The sibling names are what the tolerance reads against.
//
// The correct outcome is a BLANK series_id: the fund has no series in the
// dictionary, so these 141 rows are a floor, and a floor is what must be
// emitted instead of a neighbour's id.
//
// Fix in the Federated account-code branch of htmlPreTextFund
// (layout_htmltable.go, the `accountNumber && len(f) > 2 && f[1] ==
// "Federated"` block): the remainder after the code must be an EXACT dictionary
// or declared name, the way the letter-code rung in dictFallback.apply
// (cik_series.go) already requires, rather than passing through the tolerant
// resolver that folds `International Small Co. Fund 2` onto `International
// Equity Fund II`.
func TestFamilyGGG2FederatedIFISCFHeadingStampsASiblingSeries(t *testing.T) {
	rows := familyGGG2Dispatch(t, "federated_ifiscf_heading.txt", "federated_dict.tsv", "htmltable", 2)
	for _, r := range rows {
		if r.SeriesID != "" {
			t.Errorf("`IFISCF Federated International Small Co. Fund 2` has no series in the dictionary: fund=%q issuer=%q item=%q series=%q want \"\"", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000091/911637/0000950135-04-004248.txt: 12-13, 15-18, 25-26, 54-60, 105-118,
// 3118-3152. MFS Series Trust XI's 2004 N-PX declares no series in its header;
// the dictionary holds three rows for CIK 0000911637 over two ids, including
//
//	0000911637	S000002500	MFS Union Standard Equity Fund	20060630
//
// The filing is dispatched to `issnpx` on its `FORM N-Px REPORT`-family banner
// grammar, and the first two thirds of it is exactly that: `=`-ruled banners
//
//	============================ MFS MID-CAP VALUE FUND ============================
//
// over ordinary ISS proposal blocks. After the last of them the filer agent
// switches grammars mid-document. From line 3120 the file prints a bare,
// unruled fund line followed by Broadridge `<TABLE>` blocks:
//
//	MFS Union Standard Equity Fund
//
//	<TABLE>
//	3M COMPANY                                                           MMM                   ANNUAL MEETING DATE: 05/11/2004
//	ISSUER: 88579Y101     CITY:                                                                HOLDINGS RECONCILIATION DATE: 03/12/2004
//
// 52 issuers are printed under that heading. The issnpx parser owns the whole
// file and reads none of them: a full-file dispatch emits 1,108 rows, 975 under
// `MFS MID-CAP VALUE FUND` and 133 under `VERTEX INTERNATIONAL FUND`, and not
// one row carries S000002500 or names 3M. The section is not mis-attributed --
// it is absent, which is why it never appeared in the no-series count.
//
// Fix in parseISSNPX (layout_issnpx.go): the banner scan must recognise the
// grammar switch at the bare fund line above a Broadridge `ISSUER: <cusip>`
// table and hand the remainder of the body to parseBroadridge
// (layout_broadridge.go), which already reads this table shape, rather than
// dropping every line it does not recognise as an ISS proposal block.
