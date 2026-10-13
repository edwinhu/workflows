package main

import (
	"path/filepath"
	"testing"
)

const ns1050918OakDir = "family_ns1050918_oak_inserted_word_typeword_swap"

// OAK ASSOCIATES FUNDS, CIK 1050918, filing
// 000105/1050918/0001193125-11-236912.txt (period 20110630, filed 20110831),
// layout `htmltable`. 205 rows with a blank series_id in the current LOST_BASE --
// this CIK's whole ranked residue for this accession.
//
// THE FILING'S SHAPE. The header declares exactly seven series, and the body
// prints exactly seven section banners delimited by runs of `=`, one per fund,
// each over a long run of issuer vote tables:
//
//	declared (SEC-HEADER)                        body banner
//	S000006541 BLACK OAK EMERGING TECHNOLOGY FUND  BLACK OAK EMERGING TECHNOLOGY SELECT PORTFOLIO
//	S000006542 LIVE OAK HEALTH SCIENCES FUND       LIVE OAK HEALTH SCIENCES FUND          (exact)
//	S000006539 PIN OAK EQUITY FUND                 PIN OAK AGGRESSIVE STOCK FUND
//	S000006540 RED OAK TECHNOLOGY SELECT FUND       RED OAK TECHNOLOGY SELECT PORTFOLIO
//	S000006544 RIVER OAK DISCOVERY FUND             RIVER OAK DISCOVERY FUND               (exact)
//	S000006543 ROCK OAK CORE GROWTH FUND            ROCK OAK CORE GROWTH FUND              (exact)
//	S000006538 WHITE OAK SELECT GROWTH FUND         WHITE OAK GROWTH STOCK FUND
//
// THE DEFECT, MEASURED RATHER THAN ASSUMED. Four of the seven banners spell no
// declared name exactly, but only ONE of those four is the residue. Run over the
// whole real accession, HEAD emits 2,212 rows and resolves six of the seven
// sections:
//
//	435 S000006539  PIN OAK AGGRESSIVE STOCK FUND
//	369 S000006540  RED OAK TECHNOLOGY SELECT PORTFOLIO
//	335 S000006543  ROCK OAK CORE GROWTH FUND
//	324 S000006542  LIVE OAK HEALTH SCIENCES FUND
//	276 S000006544  RIVER OAK DISCOVERY FUND
//	268 S000006538  WHITE OAK GROWTH STOCK FUND
//	205 (blank)
//
// The 205 blank rows are the BLACK OAK section and nothing else. The other three
// inexact banners already resolve, on rungs that exist today: `PIN OAK AGGRESSIVE
// STOCK FUND` and `WHITE OAK GROWTH STOCK FUND` on issLeadingStemDecl
// (layout_issnpx.go:5707), whose comment names this very registrant, and `RED OAK
// TECHNOLOGY SELECT PORTFOLIO` on issDistinctivePairDecl (layout_issnpx.go:7785).
// So the gap is NOT a missing brand-prefix rung -- two of them are already
// reaching this filing.
//
// WHAT IS ACTUALLY MISSING is the COMBINATION of two edits each of which the
// chain already tolerates on its own. Against the declared `BLACK OAK EMERGING
// TECHNOLOGY FUND` the banner both INSERTS an interior token (`SELECT`) and SWAPS
// the type word (`FUND` -> `PORTFOLIO`). Measured directly on issResolveFund with
// this filing's seven declarations installed:
//
//	BLACK OAK EMERGING TECHNOLOGY PORTFOLIO        -> S000006541  (type-word swap alone)
//	BLACK OAK EMERGING TECHNOLOGY SELECT FUND      -> S000006541  (inserted word alone)
//	BLACK OAK EMERGING TECHNOLOGY SELECT PORTFOLIO -> blank       (both together)
//
// issLeadingStemDecl cannot reach it because it requires the banner to DIVERGE at
// the token after the two-word stem (`want[2] == toks[2] -> return nil`,
// layout_issnpx.go:5738), and here the banner agrees with the declared name for
// four whole tokens before the tail differs -- the opposite shape. That is also
// why `PIN OAK` and `WHITE OAK`, which diverge immediately after `<colour> OAK`,
// answer while `BLACK OAK` does not. issDistinctivePairDecl reaches `RED OAK`
// because that banner differs from its declared name in the type word ALONE; the
// inserted `SELECT` puts BLACK OAK out of its shape too. The three named
// declared-name repair rungs of the htmltable layout are all out of reach for the
// same reason: htmlTypoDeclaredName (within-word edit), htmlDroppedWordDeclaredName
// (banner one word SHORT) and htmlSubsequenceDeclaredName (banner a subsequence of
// the declared name) each return nil here -- the banner is one word LONGER than
// the declared name and carries `SELECT` and `PORTFOLIO`, neither of which the
// declared name contains, so it is no subsequence of it.
//
// WHICH ID THE BANNER NAMES IS AN ELIMINATION over this filing's own seven
// declarations, not a guess: exactly one of them, S000006541, leads with the
// two-word brand `BLACK OAK`, and no other declared name in this header carries
// that pair or the token `EMERGING`.
//
// FIXTURE PROVENANCE. testdata/.../oak_inserted_word_typeword_swap.txt is real SEC
// EDGAR bytes, verbatim and in file order, assembled from these line ranges of the
// real accession (md5 6ffa4d335d486ccbd2b0ef7724e570e6, read over
// `ssh wrds cat /wrds/sec/archives/000105/1050918/0001193125-11-236912.txt`), each
// range cut at a whole `</TABLE>`/page-break boundary:
//
//	real 1-319      SEC-HEADER with all seven SERIES declarations unrenumbered,
//	                the HTML cover, the report preamble, the BLACK OAK banner
//	                (real 154-155, split across two source lines) and the whole
//	                AMERICAN SCIENCE AND ENGINEERING identity + vote tables
//	real 4155-4334  page break, LIVE OAK banner (real 4159), AFFYMETRIX tables
//	real 10227-10422  PIN OAK banner (real 10227), AMAZON.COM tables
//	real 17955-18164  RED OAK banner (real 17955), ACCENTURE PLC tables
//	real 24532-24637  RIVER OAK banner (real 24532), AEROVIRONMENT tables
//	real 30188-30455  ROCK OAK banner (real 30188-30189), AMERICAN EXPRESS tables
//	real 36344-36798  WHITE OAK banner (real 36344-36345), ACE LIMITED and
//	                  AMAZON.COM tables
//	real 41672-41674  the filing's own closing </TEXT></DOCUMENT></SEC-DOCUMENT>
//
// All seven sections are fixtured on purpose: the four that must change are only
// meaningful beside the three that already resolve exactly, and the two inexact
// banners that already answer are the regression this fix must not disturb. Only
// one issuer block per section is kept, so the fixture carries 80 rows rather than
// the real 2,212 -- enough to prove the shape and the non-ambiguity, which is a
// property of the header, not of the row count.
//
// MEASURED ON HEAD over this fixture: status=ok layout=htmltable CIK=0001050918,
// rows=80, of which the 10 AMERICAN SCIENCE AND ENGINEERING rows under the BLACK
// OAK banner carry series_id="" and fund_name="" and the other 70 resolve as
// asserted below.
//
// No production code is changed here.
func TestFamilyNS1050918OakInsertedWordTypeWordSwap(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	// This filing's own header declares every series the body prints, so the
	// claim is made with NO dictionary loaded at all: nothing here depends on a
	// corpus row of another vintage or another registrant.
	cikDict, seriesMap = nil, nil

	const fixture = "oak_inserted_word_typeword_swap.txt"

	// The banner as printed, the declared name it names, and the fixture line
	// its `=`-delimited section opens on.
	type section struct {
		issuer     string
		cusip      string
		meetDate   string
		wantSeries string
		wantFund   string
		banner     string
		bannerLine int
		wantRows   int
	}
	// Fixture row order is file order, so these run in fixture order and their
	// row counts sum to the fixture's 80.
	sections := []section{
		// THE CLAIM. Blank on HEAD. `SELECT` inserted and `FUND` swapped for
		// `PORTFOLIO` against the declared `BLACK OAK EMERGING TECHNOLOGY FUND`.
		// fund_name is asserted as the DECLARED spelling, the same convention
		// htmlDroppedWordDeclaredName and htmlSubsequenceDeclaredName already
		// follow: the printed banner is the defect being corrected.
		{"AMERICAN SCIENCE AND ENGINEERING, INC.", "029429107", "20100908",
			"S000006541", "BLACK OAK EMERGING TECHNOLOGY FUND",
			"BLACK OAK EMERGING TECHNOLOGY SELECT PORTFOLIO", 154, 10},
		// The three exact banners: UNCHANGED guards. Each spells its declared
		// name, and each records it as printed -- which is also the declared
		// spelling, so nothing here can drift.
		{"AFFYMETRIX, INC.", "00826T108", "20110505",
			"S000006542", "LIVE OAK HEALTH SCIENCES FUND",
			"LIVE OAK HEALTH SCIENCES FUND", 324, 11},
		// Already resolves on issLeadingStemDecl. fund_name is the banner as
		// printed, NOT the declared `PIN OAK EQUITY FUND` -- that is HEAD's
		// behaviour on this rung and this test pins it rather than changing it.
		{"AMAZON.COM, INC.", "023135106", "20110607",
			"S000006539", "PIN OAK AGGRESSIVE STOCK FUND",
			"PIN OAK AGGRESSIVE STOCK FUND", 500, 13},
		// Already resolves on issDistinctivePairDecl, likewise recording the
		// banner as printed rather than the declared `RED OAK TECHNOLOGY SELECT
		// FUND`.
		{"ACCENTURE PLC", "G1151C101", "20110203",
			"S000006540", "RED OAK TECHNOLOGY SELECT PORTFOLIO",
			"RED OAK TECHNOLOGY SELECT PORTFOLIO", 696, 11},
		{"AEROVIRONMENT, INC.", "008073108", "20100929",
			"S000006544", "RIVER OAK DISCOVERY FUND",
			"RIVER OAK DISCOVERY FUND", 906, 4},
		{"AMERICAN EXPRESS COMPANY", "025816109", "20110502",
			"S000006543", "ROCK OAK CORE GROWTH FUND",
			"ROCK OAK CORE GROWTH FUND", 1012, 17},
		// Already resolves on issLeadingStemDecl. HEAD reads only the first
		// proposal of this section's ACE LIMITED table for reasons unrelated to
		// the masthead, so the section's 14 fixture rows are 1 ACE row plus the
		// 13 of the AMAZON.COM block that follows it. Both are asserted, because
		// both belong to WHITE OAK and a masthead fix must leave the count alone.
		{"ACE LIMITED", "H0023R105", "20110518",
			"S000006538", "WHITE OAK GROWTH STOCK FUND",
			"WHITE OAK GROWTH STOCK FUND", 1280, 1},
		{"AMAZON.COM, INC.", "023135106", "20110607",
			"S000006538", "WHITE OAK GROWTH STOCK FUND",
			"WHITE OAK GROWTH STOCK FUND", 1280, 13},
	}

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", ns1050918OakDir, fixture), sink, make([]byte, headBytes))
	rows := sink.buf
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0001050918" || meta.PeriodOfReport != "20110630" {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s CIK=%s period=%s want status=ok layout=htmltable CIK=0001050918 period=20110630 error=%s",
			meta.ParseStatus, meta.Layout, meta.CIK, meta.PeriodOfReport, meta.ErrorMsg)
	}
	want := 0
	for _, s := range sections {
		want += s.wantRows
	}
	if len(rows) != want {
		t.Fatalf("fixture precondition: %d rows, want %d (one issuer block per fund section, in fixture order)", len(rows), want)
	}

	at := 0
	for _, s := range sections {
		block := rows[at : at+s.wantRows]
		at += s.wantRows

		// Identity regression guard, checked FIRST: issuer, CUSIP and meeting
		// date all read correctly on HEAD for every section including the blank
		// one. Only BLACK OAK's series_id and fund_name are wrong, and a fix
		// that recovers the series by disturbing any of these has traded one
		// defect for another.
		for i, r := range block {
			if r.IssuerName != s.issuer || r.CUSIP != s.cusip || r.MeetingDate != s.meetDate {
				t.Errorf("%s row %d identity regressed: issuer=%q cusip=%q date=%q want issuer=%q cusip=%s date=%s",
					s.banner, i, r.IssuerName, r.CUSIP, r.MeetingDate, s.issuer, s.cusip, s.meetDate)
			}
		}

		for i, r := range block {
			if r.SeriesID != s.wantSeries {
				t.Errorf("banner %q (fixture line %d), %s row %d (item=%q): series=%q fund=%q want %s -- this filing's own SEC-HEADER declares exactly seven series and exactly one of them, %s, leads with the banner's two-word brand, so which series the banner names is an elimination over the header, not a guess",
					s.banner, s.bannerLine, s.issuer, i, r.ItemSeq, r.SeriesID, r.FundName, s.wantSeries, s.wantSeries)
			}
			if r.FundName != s.wantFund {
				t.Errorf("banner %q (fixture line %d), %s row %d (item=%q): fund_name=%q want %q",
					s.banner, s.bannerLine, s.issuer, i, r.ItemSeq, r.FundName, s.wantFund)
			}
		}
	}
}

// TestFamilyNS1050918OakInsertedWordTypeWordSwapAmbiguityGuard pins the refusal
// the fix must keep. The BLACK OAK banner is resolvable only because ONE declared
// name of this filing's own header reduces to it; a registrant that declares TWO
// names the banner reaches the same way has told us nothing about which sleeve
// cast the votes, and a wrong series_id is a wrong link key -- strictly worse than
// a blank.
//
// The synthetic header below declares `PIN OAK AGGRESSIVE FUND` and `PIN OAK STOCK
// FUND`. The banner `PIN OAK AGGRESSIVE STOCK PORTFOLIO` reaches BOTH by the same
// pair of edits this family needs -- insert one interior token, swap the type word:
// insert `STOCK` into the first, insert `AGGRESSIVE` into the second. They share
// the two-word brand `PIN OAK`, so brand-prefix elimination cannot break the tie
// either.
//
// THIS TEST DOES NOT REQUIRE THE NEW RUNG TO RESOLVE THIS CASE. It requires the
// opposite: the result must be neither id. A blank is the correct answer and is
// what HEAD already gives, so this assertion passes today and must keep passing --
// it is the guard on the fix, not part of the red.
func TestFamilyNS1050918OakInsertedWordTypeWordSwapAmbiguityGuard(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict, seriesMap = nil, nil

	ix := newISSSeriesIndex([]SeriesDecl{
		{SeriesID: "S000006539", Name: "PIN OAK AGGRESSIVE FUND"},
		{SeriesID: "S000009999", Name: "PIN OAK STOCK FUND"},
	}, normalizeSeriesName("OAK ASSOCIATES FUNDS"))

	const banner = "PIN OAK AGGRESSIVE STOCK PORTFOLIO"
	if _, d := issResolveFund(ix, banner); d != nil {
		t.Errorf("%q resolved to %s (%q): two declared names of this header reach it by the same insert-one-word-plus-swap-the-type-word reading (`PIN OAK AGGRESSIVE FUND` + STOCK, `PIN OAK STOCK FUND` + AGGRESSIVE) and both share the two-word brand `PIN OAK`, so nothing breaks the tie; the banner must stay blank",
			banner, d.SeriesID, d.Name)
	}

	// The same guard read the other way: with only ONE of the two declared, the
	// banner is unambiguous, which is the shape the real BLACK OAK section has.
	// Asserted as the fix's target, so this half is RED today alongside the
	// fixture test above.
	one := newISSSeriesIndex([]SeriesDecl{
		{SeriesID: "S000006539", Name: "PIN OAK AGGRESSIVE FUND"},
		{SeriesID: "S000006544", Name: "RIVER OAK DISCOVERY FUND"},
	}, normalizeSeriesName("OAK ASSOCIATES FUNDS"))
	if _, d := issResolveFund(one, banner); d == nil || d.SeriesID != "S000006539" {
		got := "blank"
		if d != nil {
			got = d.SeriesID
		}
		t.Errorf("%q resolved to %s, want S000006539 -- with a single declared name reachable by inserting one interior token and swapping the type word, and no sibling sharing the `PIN OAK` brand, the banner is an elimination over this header",
			banner, got)
	}
}
