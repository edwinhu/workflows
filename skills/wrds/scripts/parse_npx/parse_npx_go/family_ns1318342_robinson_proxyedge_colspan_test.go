package main

import (
	"path/filepath"
	"testing"
)

// 000131/1318342/0001398344-18-011974.txt: verbatim source lines 1-386 (the
// SGML header, including the `<SERIES-AND-CLASSES-CONTRACTS-DATA>` block that
// declares BOTH S000046847 `Robinson Tax Advantaged Income Fund` and S000052274
// `Robinson Opportunistic Income Fund`, then `<DOCUMENT>`/`<TEXT>`/`<HTML>`, the
// cover page, the Form N-PX report header, the first `Fund Name:` banner at
// source lines 264-274 and the whole `EATON VANCE INSD. MUN BD FD` 20-Jul-2017
// ballot printed under it), 5361-5504 (the `</TABLE>` that closes the preceding
// section, the page break, the next `<TABLE>`, the SECOND `Fund Name:` banner at
// source lines 5382-5392 and the whole `VOYA GBL ADVANTAGE AND PREMIUM OPP FD`
// 06-Jul-2017 ballot printed under it) and 9425-9429 (`</BODY>`, `</HTML>`,
// `</TEXT>`, `</DOCUMENT>`, `</SEC-DOCUMENT>`). Three line-range cuts of the
// real file; NOTHING was added or retyped, closing tags included.
//
// Investment Managers Series Trust (IMST), CIK 1318342, period 20180630, N-PX,
// dispatched `proxyedge` (the precondition below re-asserts it on the cut).
// Measured on HEAD over the WHOLE real filing with this same dictionary: status
// ok, layout proxyedge, 198 rows, of which 198 carry `series_id` blank and all
// 198 carry `fund_name` = `INVESTMENT MANAGERS SERIES TRUST` -- the bare
// registrant. The filing's two per-fund sections are not read as sections at
// all; the whole document comes out as one undifferentiated registrant-level
// block.
//
// TWO defects are bundled here, and the assertions below fail on the first.
//
// (1) THE BANNER SHAPE IS NOT A SECTION BOUNDARY. This filer prints the fund
// heading as an uppercase-tag table header row with the label in one cell and
// the value in a COLSPAN=3 cell, source lines 264-267:
//
//	<TR STYLE="vertical-align: bottom">
//	    <TD STYLE="white-space: nowrap"><B>Fund Name:</B></TD>
//	    <TD COLSPAN="3" STYLE="white-space: nowrap"><B>Robinson Tax Advantage Income Fund</B></TD>
//	    <TD STYLE="white-space: nowrap">&nbsp;</TD>
//
// and identically at source lines 5382-5385 for `Robinson Opportunistic Income
// Fund`. That is a label cell followed by a value cell, which `parseProxyEdge`
// (`layout_proxyedge.go:612`) already reads: the line ends in `:`, so the label
// branch (`layout_proxyedge.go:650-657`) fires, takes `FUND NAME` as the label
// and consumes `Robinson Tax Advantage Income Fund` out of the next cell as its
// value. The `switch label` that follows (`layout_proxyedge.go:661-686`) has
// cases for TICKER, SECURITY, SECURITY ID, SECURITY ID ON BALLOT, ISIN, MEETING
// DATE, MEETING TYPE and REGISTRANT -- and NO case for FUND NAME. The value is
// read and dropped, `fund`/`fundSeries` are never re-seeded, and every row in
// both sections keeps the registrant-level fund the cover page left behind.
// `peFundName`/`peFundWord` (`layout_proxyedge.go:502-534`), the bare-heading
// scan that this vendor's OTHER filings use, never sees these names either:
// they are not bare headings, they are the value half of a label/value pair the
// label branch has already consumed.
//
// (2) ONE LETTER IN THE FIRST NAME. Even once the banner is read, the printed
// value `Robinson Tax Advantage Income Fund` is not the declared spelling. The
// filing's OWN `<SERIES-NAME>` (source line 51) and this registrant's OWN
// dictionary row both read `Robinson Tax Advantaged Income Fund` -- the banner
// drops the trailing `d` of `Advantaged`. It is a one-word spelling variant of
// the filer's own declared series, not a guess and not a cross-registrant
// borrow. The second banner, `Robinson Opportunistic Income Fund`, matches its
// declaration exactly, so it isolates defect (1) cleanly.
//
// The dictionary rows in `cik_dict.tsv` are verbatim from the real corpus
// `cik_series.tsv`. S000052274's vintage is 20200630, two years FORWARD of this
// 2018 filing; the corpus already supports a forward-dated exact-name match for
// this very CIK (see `docs/investigations/2026-09-04_hill-climb-rounds-1-5.md`,
// the `ns1318342` entries, where CIK 1318342's 2013 filing matches a 20140630
// vintage one year forward). This filing's own SGML header declares both series
// outright in any case, so neither resolution depends on the dictionary alone.
//
// Fix location: the `switch label` in `parseProxyEdge`
// (`layout_proxyedge.go:661-686`), which needs a `FUND NAME` case that re-seeds
// `fund`/`fundSeries` the way the `REGISTRANT` case does, plus a spelling
// tolerance on the resolve path (`icrResolveFundShared` /
// `htmlDictionaryFund`) that admits a one-word variant of the filer's OWN
// declared series.
func TestFamilyNS1318342RobinsonProxyEdgeColspanFundBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	const dir = "family_ns1318342_robinson_proxyedge_colspan"
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, "cik_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "imst_1318342_robinson_colspan_2018.txt"
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || len(rows) != 4 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/proxyedge/4 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	// Rows 0-1 are the EATON VANCE ballot printed under the first banner
	// (source lines 264-274); rows 2-3 are the VOYA ballot printed under the
	// second (source lines 5382-5392). The cut keeps exactly one ballot per
	// section, so the split is positional and the issuer name pins it.
	want := []struct {
		issuer string
		banner string
		series string
		line   string
	}{
		{"EATON VANCE INSD. MUN BD FD", "Robinson Tax Advantage Income Fund", "S000046847", "264-274"},
		{"EATON VANCE INSD. MUN BD FD", "Robinson Tax Advantage Income Fund", "S000046847", "264-274"},
		{"VOYA GBL ADVANTAGE AND PREMIUM OPP FD", "Robinson Opportunistic Income Fund", "S000052274", "5382-5392"},
		{"VOYA GBL ADVANTAGE AND PREMIUM OPP FD", "Robinson Opportunistic Income Fund", "S000052274", "5382-5392"},
	}

	for i, w := range want {
		r := rows[i]
		if r.IssuerName != w.issuer {
			t.Fatalf("fixture guard: row %d should be the %q ballot, got issuer %q -- the cut is broken rather than the grammar",
				i, w.issuer, r.IssuerName)
		}
		if r.SeriesID != w.series {
			t.Errorf("row %d (issuer %q, item %q) did not take the series of the `Fund Name:` banner at source lines %s: series=%q fund=%q want %s (banner %q) -- the banner is a <TD><B>Fund Name:</B></TD><TD COLSPAN=\"3\"><B>%s</B></TD> pair, so parseProxyEdge's label branch consumes the value and the `switch label` at layout_proxyedge.go:661-686 drops it for want of a FUND NAME case, leaving every row on the bare registrant",
				i, r.IssuerName, r.ItemSeq, w.line, r.SeriesID, r.FundName, w.series, w.banner, w.banner)
		}
	}
}
