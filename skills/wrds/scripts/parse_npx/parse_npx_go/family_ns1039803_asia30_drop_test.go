package main

import (
	"path/filepath"
	"testing"
)

const ns1039803ProFundsDir = "family_ns1039803_asia30_drop"

// ns1039803ProFundsDispatch runs the real dispatch on a fixture in this family's
// testdata dir with the named dictionary loaded, asserting the fixture's own
// preconditions -- status, layout, row count -- so a failure in the body of the
// test below is an assertion about the fund each row was filed under and never a
// broken fixture. Same mechanism as ns1131042AssetMarkDispatch, pointed at its
// own testdata dir.
func ns1039803ProFundsDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1039803ProFundsDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1039803ProFundsDir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	return rows
}

// ProFunds, CIK 0001039803, filing 000103/1039803/0001193125-11-228509.txt
// (period 20110630, `issnpx`). This CIK's whole in-scope (period >= 2006)
// known-registrant no_series residue is ONE fund's banner, and the same banner
// shape recurs in at least five filings:
//
//	accession               period  no_series rows
//	0001193125-11-228509    2011    197
//	0001193125-15-291944    2015    194
//	0001193125-18-259077    2018    152
//	0001193125-20-219116    2020    142
//	0001193125-23-221601    2023    157
//	                        total   842
//
// ROOT CAUSE, read off the real bytes. Every one of those filings' own
// SEC-HEADER declares the series under its full name, with a trailing numeral:
//
//	<SERIES-ID>S000003952
//	<SERIES-NAME>PROFUND VP ASIA 30
//
// (fixture lines 817-818; the same two lines, byte for byte, are in all five
// filings' headers). But the vote-table banner the SAME filing prints for that
// fund always DROPS the trailing numeral. 2011, raw line 87450:
//
//	=============================== PROFUND VP ASIA ================================
//
// and the 2015/2018/2020/2023 filings print the identical shape in mixed case
// (`ProFund VP Asia`). No rung of the issnpx chain drops a trailing NUMBER:
// issDropTypeWord drops a trailing TYPE word (fund/portfolio/trust/series/
// account) only, and `30` is none of those. So the banner resolves to nothing and
// every row under it is emitted with a blank series_id -- 842 rows across the
// five filings, the CIK's entire in-scope residue.
//
// This is not a name the parser has to guess at. The banner is a token-for-token
// PREFIX of the filing's own declaration: banner + the single trailing token `30`
// == `PROFUND VP ASIA 30`.
//
// DISAMBIGUATION, checked against the same filing's own header. Three other
// declarations in it carry the word ASIA, and none of them matches the banner:
//
//	S000004466  ASIA 30 PROFUND        (fixture line 1195) -- different word
//	                                   order; does not share the banner's token
//	                                   order, so it is not a prefix match
//	S000012883  SHORT ASIA PROFUND     (fixture line 1942) -- extra token SHORT,
//	                                   and again the wrong order
//	S000014920  ProFund VP Short Asia  (fixture line 2157) -- same word order as
//	                                   the banner but an extra token SHORT, so
//	                                   the banner is not a prefix of it
//
// Only S000003952 satisfies "banner is an exact token-for-token prefix of a
// declared name, with exactly one trailing token left over". There is no
// ambiguity across two declarations for this filing, so a rung that drops a
// trailing numeral cannot pick the wrong series here.
//
// FIXTURE. profunds2011_vp_asia_numdrop.txt is four verbatim slices of the real
// 2011 filing, concatenated with nothing synthesised and nothing edited (md5
// 65ad719dbb897b72ecbce88d174ad872, byte-identical to the same sed recipe run on
// WRDS over /wrds/sec/archives/000103/1039803/0001193125-11-228509.txt):
//
//	sed -n -e '1,2401p' -e '87446,87468p' -e '362004,362012p' -e '362044,362048p'
//
//	1-2401         the <SEC-DOCUMENT> opener, the whole SEC-HEADER including the
//	               SERIES-AND-CLASSES-CONTRACTS-DATA block that declares all of
//	               this registrant's series (S000003952 at 817-818 and the three
//	               ASIA-bearing rivals above), the document preamble, <TEXT>,
//	               <HTML>, <PRE>, and the `FORM N-Px REPORT` / ICA-file-number
//	               masthead -- ending immediately before the filing's first banner
//	               (`BANKS ULTRASECTOR PROFUND`, raw line 2402), so the ONLY fund
//	               section in the fixture is the one under test
//	87446-87468    the blank run before it, the `PROFUND VP ASIA` banner at 87450,
//	               and the AU OPTRONICS CORP meeting printed under it (ticker
//	               2409, security id 002255107, meeting JUN 10 2011) with all five
//	               of its real ballot items, two of them carrying a wrapped
//	               continuation line
//	362004-362012  the filing's own `========== END NPX REPORT</PRE>`, </DIV>,
//	               page rule and SIGNATURES preamble
//	362044-362048  the filing's own </TABLE> </BODY></HTML> </TEXT> </DOCUMENT>
//	               </SEC-DOCUMENT> closers
//
// dict.tsv is all 222 real cik_series.tsv rows for this CIK, verbatim from
// /scratch/nyu/eddyhu/npx-reconcile-corpus/cik_series.tsv (md5
// 563ee55927f502636873d319ec5357d6) -- every later rename included, so nothing
// below is made unambiguous by hiding a spelling.
//
// This test is RED on HEAD: no rung strips the trailing numeral, so all five rows
// come back with a blank series_id.
func TestFamilyNS1039803AsiaNumeralDrop(t *testing.T) {
	rows := ns1039803ProFundsDispatch(t, "profunds2011_vp_asia_numdrop.txt", "dict.tsv", "issnpx", 5)

	// The filing's own header declares PROFUND VP ASIA 30 as S000003952, and the
	// banner over these rows is that name with its trailing numeral dropped.
	// Every row of the section must carry that series.
	const asia30 = "S000003952"
	seen := 0
	for i, r := range rows {
		if r.IssuerName != "AU OPTRONICS CORP" || r.CUSIP != "002255107" || r.MeetingDate != "20110610" {
			t.Errorf("row %d: the fixture's own identity block has moved: issuer=%q cusip=%q date=%q want %q / %q / %q",
				i+1, r.IssuerName, r.CUSIP, r.MeetingDate, "AU OPTRONICS CORP", "002255107", "20110610")
			continue
		}
		seen++
		if r.SeriesID != asia30 {
			t.Errorf("row %d (cusip %s meeting %s item %q): the banner `PROFUND VP ASIA` is this filing's own declared name `PROFUND VP ASIA 30` with the trailing numeral dropped, and no rung reads it, so the row lost its series: series=%q fund=%q want %q",
				i+1, r.CUSIP, r.MeetingDate, r.ItemSeq, r.SeriesID, r.FundName, asia30)
		}
	}
	if seen != 5 {
		t.Errorf("the fixture's own AU OPTRONICS block has moved: found %d rows at cusip 002255107 / meeting 20110610, want 5", seen)
	}
}
