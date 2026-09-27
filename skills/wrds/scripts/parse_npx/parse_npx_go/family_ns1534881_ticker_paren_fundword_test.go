package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 000153/1534881/0001398344-17-011023.txt: source lines 196-204 verbatim, the
// ISS `Vote Summary Report` page banner that opens every one of this filing's
// 285 report pages. The fixture is bytes off the wire, not a paraphrase.
//
// Aspiriant Trust, CIK 1534881, period 20170630. The whole document dispatches
// to `proxyedge` -- a genuine ProxyEdge template stands far down the file, its
// `Item` / `Proposal` / `Recommendation` / `Default Vote` band at source line
// 113038 over the WIPRO LIMITED ballot, and `matchProxyEdge` claims the
// document for the layout from it -- so the ISS half above is read by
// `parseProxyEdge` too, and its fund can only be discovered by the
// bare-heading scan. The underlined heading at source line 190 is not read as a
// banner by this layout, so within the ProxyEdge reading the page banner is the
// only thing in the ISS half that names a fund at all.
//
// `peClauseNumber` (layout_proxyedge.go:622, added in e7b6d25e) rejects that
// banner. Its rule is any parenthesised substring of 1-3 letters-or-digits, and
// the vendor's line carries two of them that are nothing of the kind:
//
//	Institution Account(s): Aspiriant Risk-Managed Global Equity Fund (GMV)
//
// `(s)` is the English plural marker the vendor prints in its own field label,
// and `(GMV)` is the account's three-letter code. Neither numbers a resolution's
// sub-paragraph, which is what the guard was written for (`(1)`, `(A)`,
// `(II)`), but both satisfy it, so `peBallotProse` calls the line a ballot's own
// prose and `peFundName` refuses it as a banner.
//
// What the guard must keep refusing is unchanged: a resolution's enumerated
// sub-paragraphs. What it must stop refusing is a parenthesis that stands at the
// END of a name and qualifies it -- a ticker or account code -- and the plural
// marker inside a label word.
//
// Measured on the whole filing, current tree, with the fixture's own registrant
// dictionary absent (`-archive-root` over the real bytes):
//
//	$ ./parse_npx_go -files-from fl.txt -out out.tsv -manifest man.tsv
//	$ awk -F'\t' '{print $8"|"$10}' out.tsv | sort | uniq -c
//	   4059 |Issue New Series of Preferred Stock with the Right to Elect own Director
//	     59 S000049584|Aspiriant Risk-Managed Municipal Bond Fund
//
// and with `peClauseNumber` stubbed to `return false` and nothing else changed,
// the same 4,059 rows carry a fund again:
//
//	4059 |Aspiriant Risk-Managed Global Equity Fund (GMV), 616
//
// so the guard is demonstrably what is holding this filing's fund off. The
// series stays blank in BOTH runs, because the banner's trailing `(GMV), 616`
// still resolves against no declared name -- that is a separate defect of the
// same filing and this test does not assert it away. This test pins only the
// shape question `peBallotProse` exists to answer, on the real line.
//
// Fix location: `layout_proxyedge.go`, `peClauseNumber`. Do not narrow by
// listing `s` or `GMV`: the parenthesis that numbers a clause stands BEFORE the
// text it enumerates, mid-sentence, and the one that qualifies a name stands
// after it, at the end, or is glued to the word it pluralises.
func TestFamilyNS1534881TickerParenFundWord(t *testing.T) {
	dir := filepath.Join("testdata", "family_ns1534881_ticker_paren_fundword")
	fixture := "aspiriant_institution_account_ticker_paren.txt"
	b, err := os.ReadFile(filepath.Join(dir, fixture))
	if err != nil {
		t.Fatal(err)
	}

	// Take the cell text out of the fixture's own bytes rather than retyping
	// it, so the string under test is the vendor's and cannot drift from the
	// filing.
	var banner string
	for _, line := range strings.Split(string(b), "\n") {
		if !strings.Contains(line, "Institution Account(s):") {
			continue
		}
		open := strings.LastIndex(line, ">Institution")
		if open < 0 {
			t.Fatalf("fixture precondition: cannot read the cell text out of %q", line)
		}
		shut := strings.Index(line[open+1:], "<")
		if shut < 0 {
			t.Fatalf("fixture precondition: cannot read the cell text out of %q", line)
		}
		banner = line[open+1 : open+1+shut]
		break
	}
	if banner != "Institution Account(s): Aspiriant Risk-Managed Global Equity Fund (GMV)" {
		t.Fatalf("fixture precondition: the fixture's page banner is not the vendor's line: %q", banner)
	}

	if peBallotProse(banner) {
		t.Errorf("peBallotProse took the vendor's page banner for a ballot's own prose: %q\n"+
			"peClauseNumber(%q)=%v -- the plural marker `(s)` in the field label and the "+
			"account code `(GMV)` at the end of the name are read as a resolution's "+
			"sub-paragraph enumerators; want peBallotProse=false",
			banner, banner, peClauseNumber(banner))
	}
	if !peFundName(banner) {
		t.Errorf("peFundName refused the only line in this filing's ISS half that names a fund: %q; want true", banner)
	}
}
