package main

import (
	"path/filepath"
	"testing"
)

// familyNS51Dispatch runs the real dispatch on the family NS51 fixture with the
// registrant's own corpus dictionary loaded -- the production run loads it, the
// resolving control section in this same fixture needs it, and the defect only
// shows with it loaded -- and asserts the fixture's preconditions (status,
// layout, row count) so a failure below is an assertion about the fund banner
// and never a broken fixture.
func familyNS51Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	dir := filepath.Join("testdata", "family_ns51")
	var err error
	if cikDict, err = loadCIKSeries(filepath.Join(dir, "pvc_dict.tsv")); err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
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

// 000001/12601/0000012601-05-000038.txt: verbatim source lines 1-107,
// 5557-5582, 89909-89943, 90725-90765, 96088 and 107867-107871. Every byte is a
// line-range cut of the source, in source order; the gaps drop the filing's
// other nineteen fund sections and the bodies of the three kept ones, and the
// tail lines are the filing's own `</TEXT></DOCUMENT></SEC-DOCUMENT>`, so the
// document the fixture keeps opens and closes exactly as the source does.
// Dispatches to `text`/`votesummary` (the precondition asserts the layout).
//
// Principal Variable Contracts Fund, Inc., CIK 12601, N-PX/A period 20050630.
// This is one ISS `Vote Summary Report` export per sleeve, concatenated: each
// section prints ONE unlabelled banner line three lines under the report title,
// and every row of the section belongs to it. Measured on the whole filing with
// binary 290 (the ns50 binary, the one the current LOST_BASE was built from),
// dictionary and series map loaded as production loads them: 11,127 of its rows
// carry NO series, and they are exactly the sections whose banner carries BOTH a
// registrant brand prefix AND an adviser tail.
//
// THE CONTRAST IS INSIDE THIS ONE FILING, and the fixture keeps all three sides
// of it:
//
//	source 89920  REAL ESTATE ACCOUNT - Sub-Advised by Principal Global Investors   -> S000007673, 232 rows
//	source  5567  PVC - Balanced Account - Sub-Advised by PGI                       -> BLANK,     3,439 rows
//	source 90736  PVC - SmallCap Account - Sub-Advised by Principal Global Investors-> BLANK,       695 rows
//
// The adviser tail alone is survivable: `REAL ESTATE ACCOUNT - Sub-Advised by
// ...` reaches S000007673 (declared `Real Estate Securities Account`) through
// issSleeveStemDecl, whose stem runs through the type word `account` and is
// found in order inside exactly one declared name. The brand prefix alone is
// survivable: `pvc` IS a registrant brand -- issFilingIndex (layout_issnpx.go
// :1710-1712) pushes issInitials of the registrant's leading tokens, and
// `principal variable contracts` gives exactly `pvc` -- and `PVC Funds, Inc -
// SmallCap Blend - 481` resolves in this registrant's 2008 filing
// (0000012601-08-000027) off that brand plus an exact remainder.
//
// TOGETHER THEY DO NOT RESOLVE. The brand cut is only ever followed by an exact
// lookup, and the remainder `Balanced Account - Sub-Advised by PGI` is not a
// declared name; issCutSubAdviser (layout_issnpx.go:2238-2253) knows only the
// LABELLED spellings -- `sub-adviser:`, `sub-advisor:`, `- adviser:`,
// `- advisor:`, all of them colon-terminated -- so the unlabelled `- Sub-Advised
// by <manager>` tail this registrant prints is never cut; and issSleeveStemDecl,
// which would have carried the tail, is blocked because the stem it builds
// through the type word now begins with the brand token `pvc`, which no declared
// name contains. Each half of the banner is handled and the combination falls
// between the two.
//
// THE NAMES ARE EXACT, NOT GUESSED. Cut the brand and the adviser tail and what
// is left is the corpus dictionary's name for this CIK spelled verbatim,
// character for character:
//
//	Balanced Account      S000007666  (pvc_dict.tsv, 20070630 vintage)
//	SmallCap Account      S000007675  (pvc_dict.tsv, 20070630 vintage)
//
// ROWS REACHED, measured by substituting each blank banner of the dominant
// filing into this fixture's section A and re-dispatching, once as printed and
// once with the adviser tail deleted and nothing else changed. Seven sections,
// 6,891 of the filing's 11,127 blank rows, go from blank to a series on the
// `- Sub-Advised by <manager>` cut alone -- the brand cut, the vowel-drop
// abbreviation route and the sleeve-stem route all already work and are simply
// standing behind an uncut tail:
//
//	PVC - Balanced Account - Sub-Advised by PGI                               3,439  S000007666
//	Principal VCF - Cap Value - Sub-Advised by Principal Global Investors       884  S000007680
//	PVC - SmallCap Account - Sub-Advised by Principal Global Investors          695  S000007675
//	PRINCIPAL ... INC.- Large Cap Value Portfolio- Sub-Advised by Alliance...   663  S000007661
//	PVC - MidCap Growth Account - Sub-Advised by Mellon Equity                  546  S000007663
//	Principal VCF - MidCap - Sub-Advised by Principal Global Investors          530  S000007662
//	PVC - Growth Account - Sub-Advised by PGI                                   134  S000007685
//
// The fixture asserts two of the seven. An eighth section, `PVC- International
// Emerging Markets Account - Principal Global Investors` (1,114 rows), reaches
// S000007656 the same way but its tail names the manager with NO `Sub-Advised
// by` lead-in -- a bare-adviser-tail cut is a separate and riskier clause, and
// it is deliberately NOT asserted here.
//
// The remaining 3,122 blank rows of this filing are a DIFFERENT question and
// nothing here asks for them; deleting the tail leaves them blank too. They
// misspell the registrant (`Principle Variable Contracts Fund-Large Cap Blend
// Series` 1,622 and `Principle ... Mid Cap Value` 165 -- the same two headings
// spelled `Principal` DO resolve, to S000007658 and S000007664) or the brand
// (`Prinipal VCF-Equity Income Fund` 892), or print no fund at all (`American
// Century Equity Value Account (Principal) - 911950000` 443).
//
// The other six filings of this CIK's residue contribute NOTHING to this
// family: every one of their blank banners stays blank with the tail deleted.
// 0000811803-05-000031 and 0000870786-04-000204 (2,322 rows each, the same
// document filed and amended) and 0000898745-06-000116 (1,658) print an account
// number with no fund (`PRINCIPAL VARIABLE CONTRACTS FUND, INC./03749200 -
// 037-49200`, 809/809/678), the bare registrant name (`Principal Variable
// Contracts Fund`, 225/225), a vendor code (`PRIN01-Principal MidCap Growth`,
// 454/454/365; `PRINSV - Principal Variable Contracts - Small Cap Value`, 615;
// `PVC LARGE CAP GROWTH FUND - PVC100`, 68/68) or the `Principle` misspelling
// (766/766). 0000898745-11-000540 (47), -11-000544 (39) and
// 0000012601-08-000027 (18) are htmltable, not this layout, and print a blank
// or purely numeric heading.
func TestFamilyNS51PrincipalVariableContractsBrandPrefixPlusUnlabelledSubAdvisedTail(t *testing.T) {
	rows := familyNS51Dispatch(t, "pvc_brand_subadvised_2005.txt", "votesummary", 25)

	want := map[string]string{
		"PVC - Balanced Account - Sub-Advised by PGI":                        "S000007666",
		"PVC - SmallCap Account - Sub-Advised by Principal Global Investors": "S000007675",
		"REAL ESTATE ACCOUNT - Sub-Advised by Principal Global Investors":    "S000007673",
	}
	seen := map[string]int{}
	for _, r := range rows {
		exp, ok := want[r.FundName]
		if !ok {
			t.Errorf("unexpected fund banner %q (issuer=%q cusip=%q date=%q item=%q series=%q)", r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, r.SeriesID)
			continue
		}
		seen[r.FundName]++
		if r.SeriesID != exp {
			t.Errorf("brand prefix + unlabelled `- Sub-Advised by` tail dropped the series: fund=%q issuer=%q cusip=%q date=%q item=%q desc=%.40q series=%q want %s", r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, r.VoteDescription, r.SeriesID, exp)
		}
	}
	for banner := range want {
		if seen[banner] == 0 {
			t.Errorf("fixture precondition: no row carried banner %q", banner)
		}
	}
}
