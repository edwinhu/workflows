package main

import (
	"path/filepath"
	"testing"
)

// 000143/1437921/0000949377-12-000533.txt: 1-318, 25017-25207, 50805-50807.
// BOTH sections are in the cut on purpose: with only the Worldwide one the
// chassis stamps every row with the joined `S000023282;S000023283` and the
// fixture no longer reproduces the real filing's blank. IVA Fiduciary
// Trust declares exactly two series in the SGML header of this 2012 filing, and
// cik_series.tsv carries the same two at its ONLY vintage for CIK 0001437921:
//
//	0001437921	S000023282	IVA International Fund	20090630
//	0001437921	S000023283	IVA Worldwide Fund	20090630
//
// The filing prints one vote section per fund, each opened by a centred bold
// underlined banner. The SECOND one, at line 25021, resolves:
//
//	<p align="center"><font face="Arial" size="3"><u><b>IVA International Fund</b></u></font></p>
//
// The FIRST one, at line 141, is styled differently and does not spell the
// declared name at all. After the vendor caption prefix it prints only the one
// word that distinguishes the two funds:
//
//	<p align="center"><font face="Arial" size="3"><i><b><u>Investment Company Report - Worldwide</u></b></i></font></p>
//
// The caption-prefix path (htmlBareFundLine / icrResolveFundShared) strips
// `Investment Company Report - ` and looks up `Worldwide`, which is not a
// declared name, so the heading is never adopted. A full-file dispatch on
// parse_npx_go_362 emits 2249 rows: 1139 under the International banner
// carrying S000023282, and the 1110 rows under this banner carrying an empty
// series_id AND an empty fund_name (no registrant fallback):
//
//	1139 S000023282|C000068088;C000068089;C000068090|IVA International Fund
//	1110 ||
//
// This is not the already-fixed glued-dash shape of
// TestFamilyGGG1ZevenbergenGluedDashHeadingNeverResolves: the caption prefix
// here is typed with its spaces and strips cleanly. What remains is a single
// word rather than the whole declared name.
//
// The attribution is decidable from the registrant's own declarations alone:
// `Worldwide` is a token of `IVA Worldwide Fund` (S000023283) and of no other
// name this CIK has ever declared -- the other declared name is `IVA
// International Fund`, which carries no such token, and there is only one
// dictionary vintage, so no cross-vintage spelling can make it ambiguous.
func TestFamilyNS1437921IVAWorldwideCaptionWordNeverResolves(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns1437921", "iva_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "iva_worldwide_caption_word.txt"
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns1437921", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || len(sink.buf) != 20 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=20 error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), meta.ErrorMsg)
	}
	for _, r := range sink.buf {
		if r.SeriesID == "S000023282" {
			continue
		}
		if r.SeriesID != "S000023283" {
			t.Errorf("`Investment Company Report - Worldwide` heading not resolved: fund=%q issuer=%q item=%q series=%q want S000023283", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
