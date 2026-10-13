package main

import (
	"path/filepath"
	"testing"
)

// American AAdvantage Funds / American Beacon Funds (CIK 0000809593), verbatim
// bytes. Fixture: 000080/809593/0000809593-04-000019.txt (md5
// c8caa96da5204fbe491a23b74f37b297) lines 1-126 (the SGML header, the N-PX
// cover page, the whole `AMERICAN AADVANTAGE BALANCED FUND` banner between its
// two `=` rule lines and its first ballot, CONAGRA FOODS, INC., through the
// closing `</Table>`), lines 20593-20625 (the whole
// `AMERICAN AADVANTAGE LARGE CAP VALUE FUND` banner and its first ballot,
// ARCHER-DANIELS-MIDLAND COMPANY, through the same closing tag) and lines
// 34095-34118 (the signature block and the document's own closing tags),
// concatenated. Dictionary: all 76 cik_series.tsv rows this CIK carries,
// copied verbatim.
//
// This is a DEFECT reproduction, not a floor guard. The registrant did not
// dissolve these sleeves -- it renamed the whole complex, and EDGAR's own
// header records the rename. This filing's `COMPANY CONFORMED NAME` is
// `AMERICAN AADVANTAGE FUNDS`; the registrant's first series-tagged N-PX,
// 000080/809593/0000809593-06-000032.txt at vintage 20060630, heads the same
// CIK `COMPANY CONFORMED NAME: AMERICAN BEACON FUNDS` and carries
// `FORMER CONFORMED NAME: AMERICAN AADVANTAGE FUNDS` directly beneath it. Every
// one of this filing's eighteen fund-section headings is that same substitution
// applied to a sleeve: the two name families differ ONLY in the brand token
// AAdvantage vs Beacon, every other token identical. All eighteen resolve to
// exactly one declared series of this same CIK under the substitution, so
// nothing here is excluded for ambiguity:
//
//	BALANCED                                 -> S000000718
//	EMERGING MARKETS                         -> S000001826
//	ENHANCED INCOME                          -> S000001821
//	HIGH YIELD BOND                          -> S000001830
//	INTERMEDIATE BOND                        -> S000001831
//	INTERNATIONAL EQUITY                     -> S000001825
//	INTERNATIONAL EQUITY INDEX               -> S000001829
//	LARGE CAP GROWTH                         -> S000001092
//	LARGE CAP VALUE                          -> S000001091
//	MID-CAP VALUE                            -> S000001819
//	MONEY MARKET                             -> S000001822
//	MUNICIPAL MONEY MARKET                   -> S000001823
//	S&P 500 INDEX                            -> S000001827
//	SHORT-TERM BOND                          -> S000001832
//	SMALL CAP INDEX                          -> S000001828
//	SMALL CAP VALUE                          -> S000001818
//	TREASURY INFLATION PROTECTED SECURITIES  -> S000001820
//	U.S. GOVERNMENT MONEY MARKET             -> S000001824
//
// Negative evidence for the old names: the token `AAdvantage` appears in NONE
// of the 41,139 corpus dictionary rows, at any CIK or vintage. No name-based
// rung can reach these headings, because the brand token the registrant
// dropped is the one word the two spellings do not share.
//
// Measured with the current binary on the real filing, with -cik-series over
// the full 41,139-row dictionary and no -series-map: 7,588 rows, 7,533 of them
// blank, split exactly
//
//	AMERICAN AADVANTAGE LARGE CAP GROWTH FUND  2,244  (blank)
//	AMERICAN AADVANTAGE SMALL CAP VALUE FUND   1,948  (blank)
//	AMERICAN AADVANTAGE LARGE CAP VALUE FUND   1,805  (blank)
//	AMERICAN AADVANTAGE BALANCED FUND          1,536  (blank)
//	AMERICAN AADVANTAGE ENHANCED INCOME FUND      55  -> S000001821
//
// which is this filing's whole LOST_BASE contribution. ENHANCED INCOME needs
// no entry -- it already resolves, and it resolves CORRECTLY. The other
// thirteen headings emit no rows at this vintage: eleven print the
// registrant's "There were no matters relating to a portfolio security..."
// or feeder-fund paragraph in place of a ballot, and EMERGING MARKETS and
// INTERNATIONAL EQUITY print a second, `Meeting Date / Company/Ballot Issues`
// table grammar the broadridge layout does not read here -- an unrelated
// unread-table defect, out of scope for this rename family and untouched by it.
//
// The fixture carries two of the four defective headings. The parser currently
// reads both banners verbatim into the fund-name column and leaves series_id
// blank.
func TestFamilyNSAAdvantageBeaconRenameResolves(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_aadvantage", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	sink := &rowSink{}
	fixture := "american_aadvantage_rename.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_aadvantage", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "broadridge" || meta.CIK != "0000809593" || meta.PeriodOfReport != "20040630" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	if len(sink.buf) != 19 {
		t.Fatalf("fixture precondition: got %d rows, want 19 (9 CONAGRA under BALANCED, 10 ARCHER-DANIELS-MIDLAND under LARGE CAP VALUE)", len(sink.buf))
	}

	want := map[string]string{
		"AMERICAN AADVANTAGE BALANCED FUND":        "S000000718", // American Beacon Balanced Fund
		"AMERICAN AADVANTAGE LARGE CAP VALUE FUND": "S000001091", // American Beacon Large Cap Value Fund
	}
	wantRows := map[string]int{
		"AMERICAN AADVANTAGE BALANCED FUND":        9,
		"AMERICAN AADVANTAGE LARGE CAP VALUE FUND": 10,
	}
	seen := map[string]int{}
	for _, r := range sink.buf {
		if _, ok := want[r.FundName]; !ok {
			t.Fatalf("unexpected fund_name %q -- the fixture carries exactly two banners", r.FundName)
		}
		seen[r.FundName]++
	}
	if len(seen) != 2 {
		t.Fatalf("fixture precondition: %d distinct banners, want 2 (%v)", len(seen), seen)
	}
	for name, n := range wantRows {
		if seen[name] != n {
			t.Fatalf("fixture precondition: banner %q has %d rows, want %d", name, seen[name], n)
		}
	}

	reported := map[string]bool{}
	for _, r := range sink.buf {
		wantID := want[r.FundName]
		if r.SeriesID != wantID && !reported[r.FundName] {
			reported[r.FundName] = true
			t.Errorf("heading %q: series=%q, want %q -- 000080/809593/0000809593-06-000032.txt (the registrant's first tagged N-PX, vintage 20060630) carries `FORMER CONFORMED NAME: AMERICAN AADVANTAGE FUNDS` under `COMPANY CONFORMED NAME: AMERICAN BEACON FUNDS`, and declares this fund under the Beacon spelling",
				r.FundName, r.SeriesID, wantID)
		}
	}
}
