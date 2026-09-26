package main

import (
	"path/filepath"
	"testing"
)

// 000086/865733/0000865733-11-000029.txt: 1-130, 196-226, 4726-4783, 5849-5904,
// 7546, 7569-7571. Homestead Funds, Inc., period 20110630, the CIK's only
// in-scope filing. A full-file dispatch on this binary emits 2840 rows, 1017 of
// them with neither fund nor series:
//
//	 844 S000010531|Homestead Growth Fund
//	 965 S000010530|Homestead International Value Fund
//	  14 S000010528|Homestead Value Fund
//	1017 ||
//
// The filing prints four fund sections, each opened by a padded '=' banner that
// prepends the registrant's own brand token to the bare name the SGML header
// declares (header lines 84-120 of the source):
//
//	line  201  ====================== Homestead Growth Fund ======================
//	line 1911  ====================== Homestead International Value Fund ======================
//	line 4728  ====================== Homestead Small Company Stock Fund ======================
//	line 5851  ====================== Homestead Value Fund ======================
//
// The brand-token drop already resolves all four against the header's bare
// declarations -- `Homestead Small Company Stock Fund` onto `Small-Company Stock
// Fund` (S000010529) included, the hyphen folding away under
// normalizeSeriesName. Removing the two rule lines named below from this very
// fixture and re-dispatching stamps every row, so no naming rung is missing.
//
// What loses the 1017 rows is that this filing draws its ISSUER dividers as
// BARE rules of '=' -- 80 columns in the Small-Company section, 99 to 101 in the
// Value section -- and issFundSeparator reads a bare rule as a section boundary
// with no name, which closes the fund the section's own banner opened:
//
//	line 4731  ================================================================================
//	line 5887  =====================================================================================================
//
// Line 4731 stands between the Small-Company banner and the section's first
// issuer, so the whole section is stamped blank and the banner never reaches a
// row at all (blank FundName, not just blank SeriesID). Line 5887 stands after
// the Value section's first issuer, so that issuer resolves and every issuer
// after it goes blank -- which is the entire 14-row S000010528 tally above.
//
// The Growth section carries no bare rule between its banner and its blocks (its
// issuer dividers are drawn in '-', source line 227), which is why it resolves
// and why it is the fixture's guard: the cut keeps it so that a regression in the
// brand-token drop is told apart from a regression in the rule grammar.
func TestNS865733BareEqualsIssuerRuleClosesFund(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns865733", "homestead_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "homestead_bare_equals_rule.txt"
	ch := make(chan *ParseResult, 64)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns865733", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || len(rows) != 43 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=43 error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	// Every row of the cut belongs to one of the three sections it carries, and
	// each section's series is the one the filing's own header declares for the
	// bare name inside its banner.
	wantCount := map[string]int{
		"S000010531": 14, // Homestead Growth Fund, source lines 201-226
		"S000010529": 11, // Homestead Small Company Stock Fund, source lines 4728-4783
		"S000010528": 18, // Homestead Value Fund, source lines 5851-5904
	}
	wantFund := map[string]string{
		"S000010531": "Homestead Growth Fund",
		"S000010529": "Homestead Small Company Stock Fund",
		"S000010528": "Homestead Value Fund",
	}
	got := map[string]int{}
	for _, r := range rows {
		got[r.SeriesID]++
		if want, ok := wantFund[r.SeriesID]; ok && r.FundName != want {
			t.Errorf("series %s carried fund %q, want %q (issuer=%q item=%q)", r.SeriesID, r.FundName, want, r.IssuerName, r.ItemSeq)
		}
	}
	if n := got[""]; n != 0 {
		t.Errorf("%d of 43 rows carry no series: a bare rule of '=' drawn as an ISSUER divider (source lines 4731 and 5887) closed the fund its section's own banner opened", n)
	}
	if got["S000010531"] != wantCount["S000010531"] {
		t.Fatalf("fixture guard: the Growth section, whose dividers are drawn in '-', stopped resolving: %d rows carry S000010531, want %d -- the brand-token drop regressed, not the rule grammar", got["S000010531"], wantCount["S000010531"])
	}
	for _, sid := range []string{"S000010529", "S000010528"} {
		if got[sid] != wantCount[sid] {
			t.Errorf("%d rows carry %s (%s), want %d", got[sid], sid, wantFund[sid], wantCount[sid])
		}
	}
}
