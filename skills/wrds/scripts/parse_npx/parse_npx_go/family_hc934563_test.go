package main

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// HC Capital Trust (formerly Hirtle Callaghan Trust, CIK 934563), N-PX
// 0000950123-11-079747, dispatches whole-document to labelvalue (manifest
// layout=labelvalue; 30,057 rows). Its `Fund Name :` sections print ICR-grammar
// blocks, which icrSupplement hands to parseICR and which read correctly:
//
//	Agilent
//	 Technologies,
//	 Inc.
//
//	Ticker           Security ID:                          Meeting Date             Meeting Status
//	A                CUSIP9 00846U101                      03/01/2011               Voted
//	...
//
// (lines 31955-32010 of the filing). What does NOT read correctly is the
// Institutional Account split table that ends the Growth Portfolio #11VA
// section, two <CAPTION> bands in one <TABLE> printed under a page footer
// (`Page 28 of 28` / `27-Jul-2011`, lines 37306-37379):
//
//	Institutional Account Name   Company Name   Ticker   Security ID on Ballot   Meeting Date
//	...
//	Shares Available to Vote  Proponent  Item Number  Proposal  Management Recommendation  Vote Instruction
//	             500  Management     1.1  Elect Director Mitchell Jacobson       For             For
//
// Nothing in that grammar closes the icr block open from the section above, so
// each `500  Management  1.1  Elect Director ...` line is read as an icr vote
// row: item `500` (a share count), the proponent in the description slot, and
// issuer/ticker/CUSIP/date of whatever block was last open. The real run emits
// 15,287 of its 30,057 rows this way, with a date (`27-Jul-2011`, the page
// footer) in the fund-name slot and no series_id.
//
// The fixture is the SEC header of testdata/splittable/ST1_hccapital_two_page_groups.txt
// (same registrant), the Agilent block (lines 31955-32010 excerpt) and the
// split-table lines 37306-37320, 37346-37354 of the filing, verbatim and
// trimmed to a few rows per band. Two things are NOT from the filing: the 1,700
// rule lines push the first `#  Proposal ... Vote Cast` header past
// signatureHeadBytes so issnpx does not claim the document (the real filing's
// header sits at line 5179 of a 24 MB file), and the one labelvalue-native
// Alexandria block under a `Fund Name :` label supplies that header.
func TestFamilyHC934563SplitTableDoesNotInheritTheOpenICRBlock(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "family_hc934563",
		"HC934563_growth_icr_blocks_under_fund_name_label.txt"))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	rows := runISSNPXDoc(t, string(b))

	date := regexp.MustCompile(`^\d{2}-[A-Z][a-z]{2}-\d{4}$`)
	n := 0
	for _, r := range rows {
		if date.MatchString(r[colFundName]) {
			t.Errorf("item %s: fund name = %q is a date, not a fund", r[colItemSeq], r[colFundName])
		}
		if !strings.Contains(r[colIssuerName], "Agilent") {
			continue
		}
		n++
		if r[colTicker] != "A" || r[colCUSIP] != "00846U101" || r[colMeetingDate] != "20110301" {
			t.Errorf("item %s: ticker=%q cusip=%q date=%q, want A 00846U101 20110301",
				r[colItemSeq], r[colTicker], r[colCUSIP], r[colMeetingDate])
		}
		if r[colFundName] != "Hirtle Callaghan Trust Growth Portfolio #11VA" {
			t.Errorf("item %s: fund name = %q, want the Fund Name label's value", r[colItemSeq], r[colFundName])
		}
		if len(r[colItemSeq]) > 2 {
			t.Errorf("Agilent row has item %q (a share count from the split table), "+
				"description slot %q: the Agilent block prints items 1-6 only",
				r[colItemSeq], r[colVoteDescription])
		}
	}
	if n != 6 {
		t.Errorf("rows under Agilent = %d, want 6 (the block prints items 1-6; the other "+
			"%d came from the split table that follows it)", n, n-6)
	}
}
