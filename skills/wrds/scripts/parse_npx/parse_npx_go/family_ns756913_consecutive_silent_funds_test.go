package main

import (
	"path/filepath"
	"strings"
	"testing"
)

const ns756913SilentDir = "family_ns756913_consecutive_silent_funds"

// ns756913SilentDispatch runs the real dispatch on the fixture with this
// family's dictionary loaded, asserting only what a broken fixture would break
// -- status and layout -- and returning every row. Unlike the other family
// harnesses it deliberately does NOT pin the row count as a precondition: the
// row count IS the claim under test here, so a count mismatch must surface as
// the named failure below rather than as "broken fixture".
func ns756913SilentDispatch(t *testing.T, fixture, dict, layout string) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns756913SilentDir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns756913SilentDir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s want layout=%s error=%s", meta.ParseStatus, meta.Layout, layout, meta.ErrorMsg)
	}
	return rows
}

// CIK 0000756913 (John Hancock Variable Insurance Trust) filing
// 000075/756913/0001438934-12-000422.txt (N-PX/A, period 20120630, broadridge
// layout) prints one section per sleeve, and for a sleeve that held no voting
// securities it prints a BANNER, a dash rule, the two-line boilerplate
// disclaimer and a blank run -- and no ballot block at all. Source lines
// 396824-396837, verbatim:
//
//	2A55 JHVIT Total Bond Market A Trust
//	--------------------------------------------------------------------------------------------------------------------------
//	 The fund held no voting securities during the reporting period and did not vote any securities or have
//	 any securities that were subject to a vote during the reporting period.
//
//
//	2A56 Core Strategy Trust
//	--------------------------------------------------------------------------------------------------------------------------
//	 The fund held no voting securities during the reporting period and did not vote any securities or have
//	 any securities that were subject to a vote during the reporting period.
//
//
//	2A57 International Small Company Trust
//	--------------------------------------------------------------------------------------------------------------------------
//	 888 HOLDINGS PLC, GIBRALTAR                                                                 Agenda Number:  703751087
//
// layout_broadridge.go already carries machinery for this shape -- brSilentNeedles,
// brBannerAboveSilentProse, brSilentLookahead and friends -- which is supposed
// to clear parser state and emit NO rows for a silent sleeve. Measured on the
// tracked binary, that machinery leaks exactly one spurious row per silent
// banner instead: each banner produces a row with a BLANK series_id and a BLANK
// fund_name, the issuer copied forward from the last REAL issuer of the
// preceding section, and the banner text plus the leaked disclaimer glued into
// proposal_desc. On the real filing (votes.tsv rows 65078-65080, against real
// issuer XEROX CORPORATION):
//
//	ser=[] fund=[] iss=[XEROX CORPORATION] item=[2A55] desc=[JHVIT Total Bond Market A Trust The fund held no voting securities during the reporting period ...]
//	ser=[] fund=[] iss=[XEROX CORPORATION] item=[2A56] desc=[Core Strategy Trust The fund held no voting securities during the reporting period ...]
//	ser=[] fund=[] iss=[XEROX CORPORATION] item=[2A57] desc=[International Small Company Trust]
//
// The third row shows why the run matters rather than a single banner: 2A57
// International Small Company Trust is NOT silent -- it has 11 real ballot rows
// below it, which resolve correctly to S000008301 -- yet its banner ALSO leaks
// a row, because the two silent banners above it left the reader in a state
// where the banner line is consumed as prose before the section opens. The
// same filing shows the single-silent-banner case leaking too (votes.tsv rows
// 5387 and 57793), so the run is the clearest reproduction, not the only one.
//
// THE FIXTURE is a verbatim excerpt of the real filing bytes fetched from
// /wrds/sec/archives, four contiguous ranges concatenated with no byte altered:
//
//	source lines 1-2001       the whole SEC-HEADER, including the
//	                          SERIES-AND-CLASSES-CONTRACTS-DATA block that declares
//	                          Value & Restructuring Trust (S000008335, source line
//	                          999-1000) and International Small Company Trust
//	                          (S000008301, source lines 744-745), then the
//	                          <DOCUMENT> preamble, <TEXT> and the filing cover page
//	source lines 394749-394768 the tail-end real section: the `2A50 Value &
//	                          Restructuring Trust` banner, the ACE LIMITED issuer
//	                          block under it and its one ballot row, plus the blank
//	                          run that separates sections. Cut at an issuer-block
//	                          boundary -- the next line, 394769, is the dash rule
//	                          that opens AECOM TECHNOLOGY -- so no block is split
//	source lines 396824-396880 the run under test: the two silent banners, then the
//	                          `2A57 International Small Company Trust` banner and its
//	                          888 HOLDINGS PLC block with all 11 ballot rows, plus the
//	                          trailing blank run. Cut at 396880 because 396881 is the
//	                          dash rule opening A G BARR PLC
//	source lines 1808577-1808579 the filing's own three closing tags
//
// The 2,053 issuer blocks between 394769 and 396823 are dropped whole; the
// shape under test is local to the banner run, and the preceding real section
// keeps its banner and one complete ballot block so its series id is a live
// assertion rather than a leftover.
//
// dict.tsv is all 206 real cik_series.tsv rows for CIK 0000756913, verbatim, so
// no rival spelling is hidden to make anything artificially unambiguous -- it
// carries, among others, S000008214 spelled three different ways across three
// vintages.
//
// Measured against the tracked binary the fixture reproduces the filing's
// behaviour exactly: status ok, layout broadridge, 16 rows where 13 are
// correct -- 1 row S000008335 for the ACE LIMITED ballot, 12 rows S000008301
// for the 888 HOLDINGS ballots -- and 3 are the spurious blank-series rows the
// three banners leak. This test asserts 13.
func TestNS756913ConsecutiveSilentFundBannersEmitNoRows(t *testing.T) {
	const (
		fixture = "jhvit_consecutive_silent_2012.txt"

		valueFund = "2A50 Value & Restructuring Trust"
		valueID   = "S000008335"
		intlFund  = "2A57 International Small Company Trust"
		intlID    = "S000008301"

		valueRows = 1  // the one ACE LIMITED ballot row under the 2A50 banner
		intlRows  = 12 // the 888 HOLDINGS block: its heading row plus 11 proposals
		wantRows  = valueRows + intlRows

		disclaimer = "The fund held no voting securities during the reporting period"
	)

	// The banner texts of the three sleeves in the run. Rows 2A55 and 2A56 are
	// silent sleeves; 2A57 is a real sleeve whose banner must open a section
	// rather than become a row of its own.
	silentBanners := []string{
		"2A55 JHVIT Total Bond Market A Trust",
		"2A56 Core Strategy Trust",
	}

	rows := ns756913SilentDispatch(t, fixture, "dict.tsv", "broadridge")

	// Claim 1 -- no row anywhere in the output carries the boilerplate
	// disclaimer, and no row carries a bare silent-sleeve banner as its
	// proposal text. A silent sleeve reports no votes, so it has nothing to
	// emit; any row here is fabricated data attributed to a real issuer.
	for i, r := range rows {
		if strings.Contains(r.VoteDescription, disclaimer) {
			t.Errorf("row %d: a silent-fund section leaked its boilerplate disclaimer as a vote row -- series=%q fund=%q issuer=%q item=%q desc=%q",
				i, r.SeriesID, r.FundName, r.IssuerName, r.ItemSeq, r.VoteDescription)
		}
		for _, b := range silentBanners {
			// The banner minus its leading `2A55 `/`2A56 ` sleeve code is what
			// lands in the desc column.
			name := b[strings.Index(b, " ")+1:]
			if r.VoteDescription == name || strings.HasPrefix(r.VoteDescription, name+" ") {
				t.Errorf("row %d: the silent-fund banner %q leaked into proposal_desc -- series=%q fund=%q issuer=%q item=%q",
					i, b, r.SeriesID, r.FundName, r.IssuerName, r.ItemSeq)
			}
		}
		if r.VoteDescription == intlFund[strings.Index(intlFund, " ")+1:] {
			t.Errorf("row %d: the 2A57 banner was consumed as a vote row instead of opening its own section -- series=%q fund=%q issuer=%q item=%q",
				i, r.SeriesID, r.FundName, r.IssuerName, r.ItemSeq)
		}
	}

	// Claim 2 -- every emitted row belongs to one of the two REAL sleeves. A
	// blank series_id in this fixture can only be a leaked banner: both real
	// sleeves are declared in the filing's own header.
	for i, r := range rows {
		if r.SeriesID != valueID && r.SeriesID != intlID {
			t.Errorf("row %d: row belongs to no real sleeve in this fixture -- series=%q fund=%q issuer=%q item=%q desc=%q",
				i, r.SeriesID, r.FundName, r.IssuerName, r.ItemSeq, r.VoteDescription)
		}
	}

	// Claim 3 -- the two real sections still resolve, and to their OWN ids. A
	// "fix" that suppresses the leaked rows by also swallowing the 2A57 section
	// (leaving its 12 rows on the 2A50 id, or blank) fails here.
	var nValue, nIntl int
	for _, r := range rows {
		switch r.SeriesID {
		case valueID:
			nValue++
			if r.FundName != valueFund {
				t.Errorf("row: %s row carries fund_name %q, want %q", valueID, r.FundName, valueFund)
			}
		case intlID:
			nIntl++
			if r.FundName != intlFund {
				t.Errorf("row: %s row carries fund_name %q, want %q", intlID, r.FundName, intlFund)
			}
		}
	}
	if nValue != valueRows || nIntl != intlRows {
		t.Errorf("section split wrong: %d rows carry %s (want %d) and %d carry %s (want %d)",
			nValue, valueID, valueRows, nIntl, intlID, intlRows)
	}

	// Claim 4 -- restated as the whole-fixture total, so the count is asserted
	// once in a form that cannot be satisfied by a reader that suppresses the
	// three leaks while losing a real ballot row somewhere else.
	if len(rows) != wantRows {
		t.Errorf("fixture emits %d rows, want %d: the run of consecutive silent-fund banners leaks %d spurious row(s)",
			len(rows), wantRows, len(rows)-wantRows)
	}
}
