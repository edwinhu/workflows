package main

import (
	"path/filepath"
	"testing"
)

const ns1026977BrandDropDir = "family_ns1026977_cni_charter_brand_drop"

// ns1026977BrandDropDispatch runs the fixture through the same top-level entry
// point production uses -- processFile, which sniffs the layout itself -- with
// the CIK's real cik_series.tsv rows loaded and no overlay, so nothing below
// depends on a hand-built FilingMeta or a hand-picked reader.
func ns1026977BrandDropDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1026977BrandDropDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1026977BrandDropDir, fixture), sink, make([]byte, headBytes))
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

// 000102/1026977/0001135428-07-000386.txt (CNI CHARTER FUNDS, CIK 1026977,
// period 20070630, manifest layout `pvtext`) and its 2008 sibling
// 000102/1026977/0001135428-08-000354.txt (period 20080630) carry this CIK's
// entire known-registrant no_series residue: 319 + 251 = 570 rows. Run on HEAD
// against the real filings, with -cik-series loaded, every blank row belongs to
// one of three section banners, and each banner's rows are blank to the last:
//
//	filing                 banner                     series_id   rows
//	0001135428-07-000386   Large Cap Value Fund       (blank)      170
//	0001135428-07-000386   Large Cap Growth Fund      (blank)      121
//	0001135428-07-000386   Technology Fund            (blank)       28
//	0001135428-08-000354   Large Cap Value Fund       (blank)      141
//	0001135428-08-000354   Large Cap Growth Fund      (blank)      110
//	                                                              ----
//	                                                               570
//
// and the banners that DO resolve resolve wholly:
//
//	0001135428-07-000386   AHA Balanced Fund          S000005765   112
//	0001135428-07-000386   RCB Small Cap Value Fund   S000005831    22
//	0001135428-08-000354   AHA Diversified Equity     S000005770   162
//	0001135428-08-000354   AHA Balanced Fund          S000005765   151
//	0001135428-08-000354   RCB Small Cap Value Fund   S000005831   117
//
// The corpus dictionary is not what resolves them: cik_series.tsv holds 12 rows
// for this CIK and every one of them is a later City National Rochdale name
// (S000005828 CITY NATIONAL ROCHDALE HIGH YIELD BOND FUND and siblings, decl
// dates 20200630/20220630). Running the two filings with and without
// -cik-series gives byte-identical series_id columns. Everything below is the
// filing's OWN <SERIES-AND-CLASSES-CONTRACTS-DATA> header.
//
// THE THREE BLANK BANNERS ARE EACH A DECLARED NAME WITH THE REGISTRANT BRAND
// CUT AND ONE INTERNAL QUALIFIER DROPPED:
//
//	banner    Large Cap Growth | Fund
//	declared  CNI CHARTER | LARGE CAP GROWTH | EQUITY | FUND   S000005827
//
//	banner    Large Cap Value | Fund
//	declared  CNI | LARGE CAP VALUE | EQUITY | FUND            S000005829
//
//	banner    Technology | Fund
//	declared  CNI CHARTER | TECHNOLOGY | GROWTH | FUND         S000005830
//
// WHY THE BRAND HALF ALREADY WORKS AND THE INTERNAL HALF DOES NOT. pvtext
// resolves its banners through the shared chain (layout_pvtext.go:167,
// issResolveFund). The chain's declared-side index keys every declaration by
// any run of LEADING tokens the registrant's own conformed name also carries --
// ix.lessRegistrantLead (layout_issnpx.go:1539, populated at :1888). The
// registrant is `CNI CHARTER FUNDS`, so S000005831 `CNI CHARTER RCB SMALL CAP
// VALUE FUND` is keyed under `rcb small cap value fund`, which is the banner
// exactly -- that is why the RCB control section in this fixture resolves. The
// same map keys S000005827 under `large cap growth equity fund`, and the banner
// prints `large cap growth fund`: one internal token short, so the key misses.
//
// No other rung closes that one token:
//
//   - ix.lessAnyType (layout_issnpx.go:1517, :1942) drops a declaration's
//     TRAILING type word, and refuses outright when that word is `fund`, which
//     it is for all three.
//   - ix.lessConjunct / ix.lessBrand / ix.lessBrandType / ix.lessLeadToken all
//     cut at an END of the declared name, never inside it.
//   - dictInternalTokenDrop (cik_series.go:733) is the only internal-token drop
//     in the parser and it runs the WRONG WAY: it drops a token from the
//     HEADING and looks the remainder up. Here the heading is the SHORTER
//     string, so dropping from it can only move further from the declaration.
//   - issBrandPrefixGenericSuffixSeries (layout_issnpx.go:2972) cuts one
//     leading token plus a trailing generic noun off the BANNER, leaving `cap
//     growth` / `cap value` / nothing -- no declared series answers any of
//     those, and `Technology Fund` is below its two-token stem floor anyway.
//   - issHeadingWithinDecl (layout_issnpx.go:3029) is true for all three
//     banners (every printed word is a word of the declaration), but it is a
//     GUARD against the cross-CIK rung, not a resolver, and stamps nothing.
//
// NO COLLISION IS AVAILABLE, in either filing. Taking each declared name, cutting
// zero, one or two leading tokens and then dropping at most one internal token,
// exactly one declaration answers each banner and no banner is answered twice:
//
//	Large Cap Growth Fund      <- S000005827  CNI CHARTER LARGE CAP GROWTH EQUITY FUND  (cut CNI CHARTER, drop EQUITY)
//	Large Cap Value Fund       <- S000005829  CNI LARGE CAP VALUE EQUITY FUND           (cut CNI, drop EQUITY)
//	Technology Fund            <- S000005830  CNI CHARTER TECHNOLOGY GROWTH FUND        (cut CNI CHARTER, drop GROWTH)
//	RCB Small Cap Value Fund   <- S000005831  CNI CHARTER RCB SMALL CAP VALUE FUND      (cut CNI CHARTER, drop nothing)
//
// and no banner equals a different declared series' full name with nothing cut.
// The 2007 header declares 17 series and the 2008 header 17 (S000005830
// Technology is gone by 2008 and the 2008 body prints no Technology banner
// either, so the mapping table is unchanged where it is exercised).
//
// THE FIXTURE is the 2007 filing's SGML header verbatim (source lines 1-336,
// the whole <SERIES-AND-CLASSES-CONTRACTS-DATA> block included) followed by
// four whole <PAGE> blocks copied byte for byte -- Large Cap Growth (source
// 8562-8630), Large Cap Value (11204-11276), RCB Small Cap Value (14114-14186,
// the CONTROL) and Technology (14696-14769) -- and the filing's closing five
// lines (15332-15336). Fixture banner lines: 341, 410, 483, 556.
//
// THE ASSERTION BELOW IS FIX-DIRECTION-AGNOSTIC. It reads only series_id, never
// fund_name -- keeping the printed banner text as the emitted fund_name while
// stamping the declared id is a perfectly good fix, and so is rewriting it to
// the declared name. The RCB control is asserted alongside so that a fix which
// resolves the three by breaking the one that already works cannot pass.
func TestFamilyNS1026977CNICharterBrandDrop(t *testing.T) {
	const (
		fixture = "cni_charter_brand_drop_2007.txt"
		// MEASURED on the fixture, not derived: the four pages' ballot rows as
		// the current binary reads them. A fixture tripwire only -- it says the
		// cut still sniffs as pvtext and still yields the rows the assertions
		// below are about.
		wantRows = 50
	)

	// banner text as printed -> the one series the filing's own header declares
	// that it names, and the row count this fixture carries for it.
	want := []struct {
		banner   string
		wantID   string
		rows     int
		declared string
		defect   bool
	}{
		{"Large Cap Growth Fund", "S000005827", 13, "CNI CHARTER LARGE CAP GROWTH EQUITY FUND", true},
		{"Large Cap Value Fund", "S000005829", 13, "CNI LARGE CAP VALUE EQUITY FUND", true},
		{"Technology Fund", "S000005830", 5, "CNI CHARTER TECHNOLOGY GROWTH FUND", true},
		{"RCB Small Cap Value Fund", "S000005831", 19, "CNI CHARTER RCB SMALL CAP VALUE FUND", false},
	}

	rows := ns1026977BrandDropDispatch(t, fixture, "dict.tsv", "pvtext", wantRows)

	for _, w := range want {
		var bad int
		var seen int
		var first VoteRow
		for _, r := range rows {
			if r.FundName != w.banner {
				continue
			}
			seen++
			if r.SeriesID == w.wantID {
				continue
			}
			if bad == 0 {
				first = r
			}
			bad++
		}
		if seen != w.rows {
			t.Fatalf("fixture precondition: banner %q carries %d rows, want %d", w.banner, seen, w.rows)
		}
		if bad == 0 {
			continue
		}
		note := "This banner ALREADY resolved on HEAD -- a fix has broken the control."
		if w.defect {
			note = "The banner is the declared name with the registrant brand cut (ix.lessRegistrantLead, layout_issnpx.go:1888) AND one internal qualifier token dropped. The brand half already works -- that is how RCB Small Cap Value Fund resolves -- but no rung in the chain closes the internal token, so the whole section falls to a blank series_id."
		}
		t.Errorf("banner %q: %d of %d rows do not carry series_id %q; the first is issuer=%q cusip=%q meeting=%q item=%q series_id=%q fund=%q.\n"+
			"  The filing's own SGML header declares %s as %q.\n"+
			"  %s",
			w.banner, bad, seen, w.wantID, first.IssuerName, first.CUSIP, first.MeetingDate, first.ItemSeq, first.SeriesID, first.FundName,
			w.wantID, w.declared, note)
	}
}
