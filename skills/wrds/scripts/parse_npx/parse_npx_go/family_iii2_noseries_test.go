package main

import (
	"path/filepath"
	"testing"
)

// familyIII2Dispatch runs the real dispatch on a family III no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one is
// named.
func familyIII2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_iii2", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_iii2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000105/1052864/0001104659-05-041283.txt: 1-665, 3854-3860, 64437-64447. The
// cut runs from the head so the cover-page table stays intact: parseHTMLTableRaw
// reads no rows at all from a fixture that opens mid-document. Legg Mason Charles Street Trust, Inc. declares NO series in the
// SGML header of this 2005 filing, so the resolver sees only cik_series.tsv for
// CIK 0001052864, two ids:
//
//	0001052864	S000000657	Batterymarch U.S. Small Capitalization Equity Portfolio
//	0001052864	S000013219	Global Opportunities Bond Fund
//
// The cover page prints a labelled `Name of Fund:` cell, and its value is the
// REGISTRANT's own trust name rather than a fund, wrapped across two lines:
//
//	<p style="margin:0in 0in .0001pt;"><font size="2" face="Times New Roman" style="font-size:10.0pt;">Name of Fund:</font></p>
//	...
//	<p style="margin:0in 0in .0001pt;"><b><font size="5" face="Times New Roman" style="font-size:18.0pt;font-weight:bold;">Legg
//	Mason Charles Street Trust,&nbsp;Inc.</font></b></p>
//
// htmlBareFundLine adopts that labelled value and it wins over the section
// heading printed directly above the vote table:
//
//	<p style="margin:0in 0in .0001pt;text-autospace:none;"><font size="2" face="Times New Roman" style="font-size:10.0pt;">Batterymarch&nbsp;US Small
//	Cap Equity Portfolio</font></p>
//
// A full-file dispatch emits 61 rows and ALL 61 carry the fund_name
// `Legg\nMason Charles Street Trust, Inc.` and a blank series_id -- every row of
// the filing. `Legg Mason Charles Street Trust, Inc.` is the registrant, names
// no declared series, and resolves to nothing; the registrant-prefix strip
// leaves it empty rather than pointing at a fund.
//
// The attribution is decidable from the filing's own text. Item 1 states the
// fund verbatim, and in the DICTIONARY's exact spelling rather than the section
// heading's abbreviated one:
//
//	<p style="margin:0in 0in .0001pt;text-indent:.5in;"><font size="2" face="Times New Roman" style="font-size:10.0pt;">Item 1 &#150; Proxy Voting Record &#150; Attached on
//	behalf of Batterymarch&nbsp;U.S. Small Capitalization Equity Portfolio.</font></p>
//
// so every vote row in the filing belongs to S000000657.
//
// Fix in htmlBareFundLine (layout_htmltable.go), where the labelled `Name of
// Fund:` value is adopted as the section fund: a labelled value that is the
// filing's own `COMPANY CONFORMED NAME` -- the whole value, not a prefix of it,
// which is what the registrant-prefix strip already recognises -- names the
// registrant and not a fund, and must not be adopted; the nearest heading above
// the vote table, and the `on behalf of <name>` Item 1 prose, are the fund of
// record.
func TestFamilyIII2LeggMasonNameOfFundIsRegistrantNeverResolves(t *testing.T) {
	rows := familyIII2Dispatch(t, "legg_mason_charles_street_name_of_fund.txt", "legg_mason_dict.tsv", "htmltable", 5)
	for _, r := range rows {
		if r.SeriesID != "S000000657" {
			t.Errorf("`Name of Fund: Legg Mason Charles Street Trust, Inc.` is the registrant, not a fund: fund=%q issuer=%q cusip=%q series=%q want S000000657", r.FundName, r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}
