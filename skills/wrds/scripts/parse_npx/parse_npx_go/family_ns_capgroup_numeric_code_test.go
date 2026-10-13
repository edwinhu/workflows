package main

import (
	"path/filepath"
	"testing"
)

// Capital Group Private Client Services Funds (CIK 0001474365), verbatim bytes.
// Fixture: 000147/1474365/0000051931-15-000689.txt (26,433 lines) lines 1-248
// (the whole SGML header with all eight <SERIES-ID>/<SERIES-NAME>
// declarations, the FORM N-PX cover page, the `<TABLE>` open, the first six
// numeric-code banners 70455000..70455500 and the 3M COMPANY ballot that opens
// the sixth section), 12081-12145 (the seventh banner 70455600 and the head of
// its AA PUBLIC LIMITED COMPANY ballot), 21473-21501 (the eighth banner
// 70455700 and its complete ABBVIE INC. ballot) and 26410-26433 (the
// `* Management position unknown` footnote, the `</TABLE>`, the signature block
// and the document's own closing tags), concatenated. Dictionary: all 17
// cik_series.tsv rows this CIK carries, copied verbatim.
//
// This is a DEFECT reproduction, not a floor guard. This one filing prints no
// fund name anywhere in its body. Where every other vintage from this
// registrant prints the sleeve's name as the section banner, the 2015 filing
// prints a bare eight-digit vendor code:
//
//	  173:70455000      179:70455100      185:70455200      191:70455300
//	  197:70455400      203:70455500    12081:70455600    21473:70455700
//	(fixture line numbers; 173/179/185/191/197/203/12081/21473 in the real file)
//
// Eight codes, contiguous and consecutive in the low three digits, and the
// registrant declares exactly eight series in this filing's own SGML header, in
// this order: S000027394 Capital Group Core Municipal Fund, S000027395
// Short-Term Municipal, S000027396 California Core Municipal, S000027397
// California Short-Term Municipal, S000027398 Core Bond, S000031199 Global
// Equity, S000031200 Non-U.S. Equity, S000031201 U.S. Equity. No name-based
// rung can reach any of them: grep for every declared series name over the
// whole document returns hits only inside the SEC header.
//
// The ordinal correspondence is not an inference from the code arithmetic. It
// is corroborated by this registrant's OWN adjacent filing, same CIK, same
// vendor grammar, 000147/1474365/0000051931-14-000712.txt, which prints plain
// fund-name banners in exactly this order and is already fully resolved:
//
//	  176:Capital Group Core Municipal Fund
//	  182:Capital Group Short-Term Municipal Fund
//	  188:Capital Group California Core Municipal Fund
//	  194:Capital Group California Short-Term Municipal Fund
//	  200:Capital Group Core Bond Fund
//	  206:Capital Group Global Equity Fund
//	11647:Capital Group Non-U.S. Equity Fund
//	19984:Capital Group U.S. Equity Fund
//
// The two filings agree section by section, not merely in count. In the 2014
// filing the first five sections carry no ballots at all -- each is the single
// sentence `The fund held no voting securities during the reporting period` --
// and the first section with a real ballot is the sixth, Global Equity, whose
// first issuer is 3M COMPANY. The 2015 filing prints that same sentence under
// each of 70455000..70455400 and opens 70455500 with a 3M COMPANY ballot. The
// municipal and bond sleeves hold no proxy-voting securities and the equity
// sleeves do; the shape the numeric codes describe is the shape the names
// describe, position for position.
//
// The overlay is not an alternative route and cannot become one:
// series_map_applied.tsv carries zero rows for this filing (its six rows at
// this CIK are the 2016 and 2017 filings, which print names). A numeric code is
// not a heading a name-matching overlay can ever resolve.
//
// Measured on the real filing: 5,555 rows, all eight sections, every one with
// series_id blank. The registrant-scoped ordinal position of the code within
// the filing's own declared-series list is the only identity the document
// offers, and it is unambiguous -- eight codes, eight series, one order.
//
// The parser currently reads the numeric code into the fund-name column and
// leaves series_id blank.
func TestFamilyNSCapGroupNumericCodeBannerResolvesByOrdinal(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_capgroup", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	sink := &rowSink{}
	fixture := "cgpcs_numeric_code_banners.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_capgroup", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "broadridge" || meta.CIK != "0001474365" || meta.PeriodOfReport != "20150630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}

	// Ordinal position of each numeric code within this registrant's eight
	// declared series, in the order the SGML header declares them.
	want := map[string]string{
		"70455500": "S000031199", // 6th code, 6th series: Capital Group Global Equity Fund
		"70455600": "S000031200", // 7th: Capital Group Non-U.S. Equity Fund
		"70455700": "S000031201", // 8th: Capital Group U.S. Equity Fund
	}
	// The first five codes govern sections with no ballots, so they emit no
	// rows and cannot be asserted on; the fixture carries them so that a fix
	// keyed on ordinal position sees the full eight-code run it must count.
	seen := map[string]int{}
	reported := map[string]bool{}
	for _, r := range sink.buf {
		seen[r.FundName]++
		w, ok := want[r.FundName]
		if !ok {
			t.Fatalf("unexpected section: fund_name=%q issuer=%q -- the fixture carries only the three code sections that emit rows",
				r.FundName, r.IssuerName)
		}
		if r.SeriesID != w && !reported[r.FundName] {
			reported[r.FundName] = true
			t.Errorf("row fund_name=%q issuer=%q item=%q series=%q, want %q -- the banner is a bare vendor code, no fund name appears anywhere in this filing's body, and the code's ordinal position among the eight consecutive codes this filing prints selects the same series as the plain-name banner in the registrant's own 2014 filing 0000051931-14-000712.txt at that position",
				r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID, w)
		}
	}
	// 3M: 1A-1J plus items 2 and 3 = 12. AA PLC: items 1-17 = 17 (the fixture
	// cuts that ballot after 17). ABBVIE: item 1's three directors plus items 2
	// and 3 = 5.
	if seen["70455500"] != 12 || seen["70455600"] != 17 || seen["70455700"] != 5 {
		t.Fatalf("fixture precondition: rows per section 70455500=%d (want 12) 70455600=%d (want 17) 70455700=%d (want 5), of %d total",
			seen["70455500"], seen["70455600"], seen["70455700"], len(sink.buf))
	}
}
