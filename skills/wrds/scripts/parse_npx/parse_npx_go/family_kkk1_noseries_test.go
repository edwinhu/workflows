package main

import (
	"path/filepath"
	"testing"
)

// familyKKK1Dispatch runs the real dispatch on a family KKK1 no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one
// is named.
func familyKKK1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_kkk1", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_kkk1", fixture), sink, make([]byte, headBytes))
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

// 000092/925583/0001104659-04-029977.txt: 1-30, 50-65, 315-551. Martin Currie
// Business Trust declares NO series in the SGML header of this 2004 filing, so
// the dictionary backs it with six entries under four ids, all carrying the
// registrant's `MCBT` brand:
//
//	0000925583	S000009976	MCBT Opportunistic EAFE Fund
//	0000925583	S000009977	MCBT Global Emerging Markets Fund
//
// A full-file dispatch emits 26 rows, ALL of them with an empty fund_name and
// an empty series_id, which is exactly the production census (26 rows / 26
// no-series).
//
// The filing DOES name the fund, once per section, not as a banner over the
// table but inside the ITEM 1 line, in a trailing parenthetical, verbatim:
//
//	<p style="margin:0in 0in .0001pt;"><font size="2" face="Times New Roman" style="font-size:10.0pt;">Item 1.&#160;&#160;&#160; Proxy Voting Record. (Opportunistic EAFE Fund)</font></p>
//
// and again at line 77291 for `(Global Emerging Markets Fund)`, 104395,
// 135692 and 156833 for the rest. The rows beneath the first are ordinary
// htmltable rows opening with the issuer, verbatim:
//
//	<p style="margin:0in 0in .0001pt 10.1pt;text-indent:-10.1pt;"><font size="2" face="Times New Roman" style="font-size:10.0pt;">GUS PLC</font></p>
//
// So two things have to happen and neither does: the `Item 1.` line is never
// read as a section heading (the layout treats `Item` as report scaffolding),
// and the parenthetical `Opportunistic EAFE Fund` reaches the dictionary name
// `MCBT Opportunistic EAFE Fund` only with the brand prefix supplied. The four
// parentheticals are the four dictionary names minus `MCBT `, exactly.
//
// Fix in layout_htmltable.go's section-heading recogniser (the htmlBareFundLine
// path that feeds VoteRow.FundName, alongside the `Registrant:` rule): an
// `Item 1.  Proxy Voting Record.` line whose TRAILING PARENTHETICAL matches a
// declared or dictionary series name is a section heading for the rows that
// follow -- and in cik_series.go's dictFallback.apply, a dictionary name that
// is the heading plus a leading registrant-brand token (`MCBT`, the initialism
// of `Martin Currie Business Trust`) should resolve the way the trailing
// parenthetical and leading-code cuts already do, refusing when two ids answer.
func TestFamilyKKK1MartinCurrieItem1ParentheticalNeverRead(t *testing.T) {
	rows := familyKKK1Dispatch(t, "martin_currie_item1_parenthetical.txt", "martin_currie_dict.tsv", "htmltable", 1)
	for _, r := range rows {
		if r.SeriesID != "S000009976" {
			t.Errorf("`Item 1. Proxy Voting Record. (Opportunistic EAFE Fund)` never read as a section heading: fund=%q issuer=%q desc=%.40q series=%q want S000009976", r.FundName, r.IssuerName, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000148/1489215/0001104659-21-103857.txt: 1-100, 28575-28907, 52672-52934.
// Mirae Asset Discovery Funds declares TWO series in the SGML header of this
// 2021 filing (`Emerging Markets Fund` S000029292, `Emerging Markets Great
// Consumer Fund` S000029296), and a full-file dispatch reads its headings well:
// 2606 rows, of which 2232 are stamped. The residue is 374 rows under ONE
// heading, printed 21 times, verbatim:
//
//	<DIV STYLE="break-before: page; margin-top: 6pt; margin-bottom: 12pt"><P STYLE="font-size: 10pt; text-align: center; margin-top: 0pt; margin-bottom: 0pt"><FONT STYLE="font-size: 10pt"><B>Emerging Markets Great Consumer VIT Fund</B></FONT></P></DIV>
//
// against the sibling heading it must not be confused with, verbatim:
//
//	<DIV STYLE="break-before: page; margin-top: 6pt; margin-bottom: 12pt"><P STYLE="font-size: 10pt; text-align: center; margin-top: 0pt; margin-bottom: 0pt"><FONT STYLE="font-size: 10pt"><B>Emerging Markets Great Consumer Fund</B></FONT></P></DIV>
//
// The dictionary carries the VIT fund under its own id, brand-prefixed:
//
//	0001489215	S000065276	Mirae Asset Emerging Markets Great Consumer VIT Fund
//	0001489215	S000065277	Mirae Asset Emerging Markets VIT Fund
//
// The heading differs from that dictionary name by the registrant brand
// `Mirae Asset ` alone -- the filing's own COMPANY CONFORMED NAME is `Mirae
// Asset Discovery Funds`, so the heading drops the prefix the dictionary keeps.
// `-issnpx-registrant-prefix-strip` handles the opposite direction (heading
// carries the registrant prefix, dictionary does not); nothing handles this one,
// so the row keeps a blank series_id.
//
// The fixture carries BOTH headings on purpose: cut to the VIT block alone, the
// heading resolves -- wrongly -- to the sibling S000029296 by dropping the
// internal `VIT` token (dictInternalTokenDrop), and the defect disappears. With
// the sibling heading present, the same collision protection that saves the file
// from that misattribution leaves the 374 rows blank.
//
// Fix in cik_series.go, dictFallback.apply: after the existing cuts, retry the
// lookup with the registrant's brand prefix PREPENDED -- the leading tokens of
// the filing's COMPANY CONFORMED NAME that the dictionary names share -- and
// require, as elsewhere, an exact and unambiguous dictionary hit.
func TestFamilyKKK1MiraeVITHeadingMissesBrandPrefixedDictionaryName(t *testing.T) {
	rows := familyKKK1Dispatch(t, "mirae_vit_heading.txt", "mirae_dict.tsv", "htmltable", 26)
	for _, r := range rows {
		if r.FundName != "Emerging Markets Great Consumer VIT Fund" {
			continue
		}
		if r.SeriesID != "S000065276" {
			t.Errorf("heading `Emerging Markets Great Consumer VIT Fund` never reaches the dictionary's `Mirae Asset ...` spelling: issuer=%q cusip=%q series=%q want S000065276", r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}

// 000094/945908/0000819118-04-000051.txt, whole filing (313 lines). Fidelity
// Covington Trust declares no series in this 2004 header, so the dictionary
// backs it with 78 entries -- every ETF the trust declared from 2013 on. The
// fund this 2004 filing actually reports for is named twice, verbatim:
//
//	<p>Fund Name: Fidelity Real Estate High Income Fund II</p>
//	<p align="center">VOTE SUMMARY REPORT<br>Fidelity Real Estate High Income Fund II<br>07/01/2003 - 06/30/2004<br></p>
//
// and no dictionary entry names it: the nearest are `Fidelity MSCI Real Estate
// Index ETF` (S000047984) and `Fidelity Real Estate Investment ETF`
// (S000070235). The 2004 fund has no id in the dictionary at all, so no
// attribution is possible -- a floor.
//
// But the dispatch does not leave the rows blank. All 22 come out stamped
// S000070235: a 2004 high-yield real-estate fund's votes filed under a 2020
// ETF, which is worse than the blank the production census recorded. The
// heading reaches that name only by dropping `High`, `Income` and `II` and
// adding `Investment ETF`.
//
// Fix in cik_series.go, dictFallback.apply / dictInternalTokenDrop, and the
// type-word relaxation issResolveFund applies before it: a relaxation that has
// to drop MORE THAN ONE internal token, or that changes the name's TYPE WORD
// (`Fund` to `ETF`), is not evidence of identity and must refuse. Blank is the
// correct output here.
func TestFamilyKKK1FidelityCovington2004FundStampedWithETFSeries(t *testing.T) {
	rows := familyKKK1Dispatch(t, "fidelity_covington_high_income_ii.txt", "fidelity_covington_dict.tsv", "htmltable", 22)
	for _, r := range rows {
		if r.SeriesID == "S000070235" {
			t.Errorf("2004 `Fidelity Real Estate High Income Fund II` stamped with the 2020 `Fidelity Real Estate Investment ETF` series: fund=%q issuer=%q cusip=%q series=%q want empty", r.FundName, r.IssuerName, r.CUSIP, r.SeriesID)
		}
	}
}
