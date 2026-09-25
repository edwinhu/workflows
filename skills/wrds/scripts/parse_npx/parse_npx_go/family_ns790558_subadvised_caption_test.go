package main

import (
	"os"
	"path/filepath"
	"testing"
)

// 000079/790558/0000950123-09-039055.txt (HARTFORD HLS SERIES FUND II INC,
// CIK 790558, period 20090630, layout broadridge): verbatim source lines
// 27228-30698, one contiguous cut, no seams and nothing added.
//
// THE SHAPE. At source lines 30674-30677 a real fund banner is followed
// immediately by an ALL-CAPS, UNPARENTHESIZED line naming the tranche's
// sub-adviser:
//
//	HARTFORD SMALLCAP VALUE HLS FUND
//	THIS PORTION SUB-ADVISED BY SSGA FUNDS MANAGEMENT INC.
//	INVESTMENT COMPANY REPORT
//	07/01/2008 TO 06/30/2009
//
// The second line is a continuation of the banner above it -- it names a
// manager, not a registrant series -- so the block belongs to HARTFORD
// SMALLCAP VALUE HLS FUND, which this filing's own SGML header declares as
// <SERIES-ID>S000004109 at source lines 172-173.
//
// WHY THIS IS A REGRESSION AND NOT A RESOLUTION FAILURE. The SAME fund opens
// twice more inside this very cut in the LOWERCASE PARENTHESIZED form --
// source lines 27251-27252 and 28204-28205:
//
//	HARTFORD SMALLCAP VALUE HLS FUND
//	(This portion sub-advised by Kayne, Anderson, Rudnick Investment Management,
//	LLC)
//
//	HARTFORD SMALLCAP VALUE HLS FUND
//	(This portion sub-advised by Metropolitan West Capital Management, LLC)
//
// and that form resolves: measured on HEAD with no dictionary and no overlay
// loaded, 65 of the 94 rows this cut yields already carry S000004109. Only
// the ALL-CAPS spelling at line 30675 is misread as a fund banner of its own.
// It matches nothing, so series_id is blanked for every vote row that follows
// it until the next real banner.
//
// EVERY BANNER IN THIS CUT IS THE SAME FUND. Between source lines 27228 and
// 30680 the filing prints exactly three fund banners (27251, 28204, 30674) and
// all three read `HARTFORD SMALLCAP VALUE HLS FUND`; they differ only in the
// sub-adviser line under them. So no row after line 27251 can belong to any
// series but S000004109, and the assertion below is not a guess at which of
// several headings governs. (The four rows ahead of line 27251 are the tail of
// the preceding fund's ZEP INC. meeting -- source lines 27228-27247 -- which
// has to be in the cut because it is the last ICR meeting header before the
// defect, and they are skipped below.)
//
// THE COST. Running the tracked binary parse_npx_go_346 over the whole filing
// on WRDS, with the corpus's cik_series.tsv and series_map_applied.tsv loaded,
// `awk -F'\t' '$8==""{print $10}' votes.tsv | sort | uniq -c` reads:
//
//	623  fund_name="THIS PORTION SUB-ADVISED BY SSGA FUNDS MANAGEMENT INC."
//	 24  fund_name="LLC)"
//
// 623+24 = 647, the whole of this filing's no_series residue. The second is
// the wrapped tail of the parenthesized annotation at source lines 27252-27253
// leaking into fund_name -- the same family of defect, reproduced by these
// same bytes, but a separate failure and NOT asserted here.
//
// WHY THE FIXTURE IS `.npx` AND NOT `.txt`. Same reason as family VS1:
// TestHowVotedVocabularyInvariant sweeps every `*.txt` under testdata/ and
// asserts no emitted how_voted is a non-vote. Once the ZEP INC. header opens
// the icr reader, it also reads the broadridge ACCOUNT NUMBER / VOTE DATE
// footer tables of the Kayne section as vote rows (measured: 89 rows with
// how_voted spellings like `26-May-2009` and description `837`). That is a
// third defect in these same bytes; it cannot be cut away without losing the
// icr opener and with it the reproduction, so the fixture is kept out of that
// invariant's corpus rather than the invariant being weakened. Nothing in
// processFile keys on the extension.
func TestFamilyNS790558SubadvisedCaption(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	// Verbatim from the filing's own SGML header, source lines 63-188. No
	// dictionary and no overlay is loaded: the blank series is not a lookup
	// failure and nothing here depends on one.
	meta := FilingMeta{
		CIK:            "0000790558",
		CompanyName:    "HARTFORD HLS SERIES FUND II INC",
		PeriodOfReport: "20090630",
		SeriesDecls: []SeriesDecl{
			{SeriesID: "S000004101", Name: "HARTFORD BLUE CHIP STOCK HLS FUND"},
			{SeriesID: "S000004102", Name: "HARTFORD VALUE OPPORTUNITIES HLS FUND"},
			{SeriesID: "S000004103", Name: "HARTFORD CAPITAL OPPORTUNITIES HLS FUND"},
			{SeriesID: "S000004104", Name: "HARTFORD GROWTH OPPORTUNITIES HLS FUND"},
			{SeriesID: "S000004105", Name: "HARTFORD INTERNATIONAL STOCK HLS FUND"},
			{SeriesID: "S000004106", Name: "HARTFORD LARGECAP GROWTH HLS FUND"},
			{SeriesID: "S000004107", Name: "HARTFORD MIDCAP GROWTH HLS FUND"},
			{SeriesID: "S000004108", Name: "HARTFORD SMALLCAP GROWTH HLS FUND"},
			{SeriesID: "S000004109", Name: "HARTFORD SMALLCAP VALUE HLS FUND"},
			{SeriesID: "S000004110", Name: "HARTFORD U.S. GOVERNMENT SECURITIES HLS FUND"},
		},
	}

	dir := filepath.Join("testdata", "family_ns790558_subadvised_caption")
	b, err := os.ReadFile(filepath.Join(dir, "hls2009_smallcap_value_allcaps_subadvised_caption.npx"))
	if err != nil {
		t.Fatal(err)
	}
	rows, err := parseICR(string(stripHTML(b)), meta)
	if err != nil {
		t.Fatal(err)
	}

	// The control: the parenthesized spelling of the SAME banner, twice in
	// these same bytes, resolves today. If this ever stops holding, the cut is
	// broken and the assertion below proves nothing.
	resolved := 0
	for _, r := range rows {
		if r.SeriesID == "S000004109" {
			resolved++
		}
	}
	if resolved < 60 {
		t.Fatalf("fixture guard: only %d of %d rows resolve to S000004109, want at least 60 -- the parenthesized banners at source lines 27251 and 28204 stopped reading, so the cut is broken rather than the grammar", resolved, len(rows))
	}

	// The defect: the first vote row of the STANDARD MICROSYSTEMS CORP. meeting
	// at source lines 30680-30696, the first meeting under the ALL-CAPS
	// annotation. Its description is unique in these bytes.
	const marker = "Elect Director Steven J. Bilodeau"
	found := false
	for _, r := range rows {
		if r.VoteDescription != marker {
			continue
		}
		found = true
		if r.FundName == "THIS PORTION SUB-ADVISED BY SSGA FUNDS MANAGEMENT INC." {
			t.Errorf("item %q (%q): fund=%q -- source line 30675 is an ALL-CAPS continuation of the banner on line 30674 naming the tranche's sub-adviser, not a fund banner of its own", r.ItemSeq, marker, r.FundName)
		}
		if r.SeriesID != "S000004109" {
			t.Errorf("item %q (%q): series=%q fund=%q, want series S000004109 -- the banner on source line 30674 is `HARTFORD SMALLCAP VALUE HLS FUND`, an exact match to the header's own <SERIES-NAME> for S000004109 (source lines 172-173), and it is the same fund the two parenthesized banners earlier in this cut already resolve to",
				r.ItemSeq, marker, r.SeriesID, r.FundName)
		}
	}
	if !found {
		t.Fatalf("fixture guard: no row carries %q -- the STANDARD MICROSYSTEMS CORP. meeting at source lines 30680-30696 stopped reading, so the cut is broken", marker)
	}
}
