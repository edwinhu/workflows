package main

import (
	"path/filepath"
	"testing"
)

// SEI INSTITUTIONAL INVESTMENTS TRUST (CIK 939934), three filings on the
// pvtext SEI shape -- 0001135428-08-000362, -09-000428, -10-000369 -- carry
// 58,865 rows with a blank security id or a blank meeting date. The same
// registrant's 2013 filing (0001135428-13-000469) parses through issnpx with
// zero blanks, so the gap is the older rendering, not the registrant.
//
// Three separate causes, all of them a value the filing DOES print and
// parsePVTextSEI (layout_pvtext.go:1340-1369) then drops:
//
//  1. 2010 -- the vendor relabelled the identity line. 2008 and 2009 print
//     `CUSIP: 300250602`; 2010 prints `Issuer: 88579Y101 Ticker: MMM` for the
//     identical field (3M's CUSIP, byte-identical to the `Security ID:
//     88579Y101` the 2013 filing prints). The label switch at
//     layout_pvtext.go:1271 has cases for CUSIP, TICKER, MEETING DATE and
//     MEETING TYPE; ISSUER matches none, so the pair is consumed and
//     discarded. The 2010 filing has 8,622 `Issuer:` lines and zero `CUSIP:`
//     lines -- every one of its 38,717 rows comes out with no security id.
//
//  2. 2009 -- a meeting that continues across a page break loses its identity
//     block. The vendor reprints the FUND heading and the column header after
//     `<PAGE>` and resumes the item numbering; it does not reprint the issuer.
//     The reprinted fund heading is a bare single-cell line, so the
//     `len(cells) == 1` branch at layout_pvtext.go:1362 reads it as the next
//     issuer heading and clears ticker/cusip/mtgDate/mtgType. In the fixture,
//     TIME WARNER CABLE INC. (CUSIP 88732J207, meeting 6/3/2009) prints
//     directors 1-5 on page 8 and 6-13 on page 9; the page-9 rows come out
//     stamped issuer "HIGH YIELD BOND FUND" with no cusip and no date.
//
//  3. 2008 -- a wrapped proposal description does the same thing. A proposal
//     too long for the description column is continued on its own indented
//     line with no vote columns, which is also a bare single cell, so it too
//     lands in the issuer-heading branch. AOZORA BANK, LTD.'s item 1 wraps
//     across three lines; every row after it in that meeting (2.1 through
//     2.13) comes out with issuer "in Electronic Format - Update Terminology
//     to Match", no cusip and no date.
//
// Fixtures are byte-verbatim concatenations of two ranges of the real filing:
//
//	siit_2010_issuer_label.txt       10-000369 lines 1-247,  20086-20119
//	siit_2009_page_break_carry.txt   09-000428 lines 1-202,  450-513
//	siit_2008_wrapped_proposal.txt   08-000362 lines 1-238,  1850-1895
//
// Note what these fixtures also expose, which this test does NOT assert
// because it is a row-loss defect rather than a blank-key one: icrCells splits
// on two-or-more spaces, so an item number the vendor separates from its
// description by two spaces (`6.  Elect Director Peter R. Haje`, ` 1.   Elect
// Director Linda G. Alvarado`) becomes a cell of its own, and
// pvSEIItemPrefix's `len(fields) < 2` guard (layout_pvtext.go:1197) then
// rejects it and the row is never emitted at all. That is why the 3M block in
// the 2010 fixture contributes no rows and the assertions below run on
// A. O. SMITH CORPORATION instead.
func TestFamilyNS49SEISIITIdentityCarry(t *testing.T) {
	dir := filepath.Join("testdata", "family_ns49_sei_siit")

	cases := []struct {
		name      string
		fixture   string
		relPath   string
		issuer    string
		cusip     string
		date      string
		items     []string
		whyBroken string
	}{
		{
			name:    "2010_issuer_label_is_the_security_id",
			fixture: "siit_2010_issuer_label.txt",
			relPath: "000093/939934/0001135428-10-000369.txt",
			issuer:  "A. O. SMITH CORPORATION",
			cusip:   "831865209",
			date:    "20100412",
			items:   []string{"1.1", "1.2", "1.3", "1.4"},
			whyBroken: "the filing prints ` Issuer: 831865209 Ticker: AOS`; the label switch at " +
				"layout_pvtext.go:1271 has no ISSUER case, so lvPairs consumes the line and the id is dropped",
		},
		{
			name:    "2009_meeting_continues_across_page_break",
			fixture: "siit_2009_page_break_carry.txt",
			relPath: "000093/939934/0001135428-09-000428.txt",
			issuer:  "TIME WARNER CABLE INC.",
			cusip:   "88732J207",
			date:    "20090603",
			items:   []string{"10", "11", "12", "13"},
			whyBroken: "the reprinted fund heading `HIGH YIELD BOND FUND` after <PAGE> is a bare single cell, " +
				"so layout_pvtext.go:1362 reads it as the next issuer heading and clears the carried identity",
		},
		{
			name:    "2008_wrapped_proposal_is_not_an_issuer_heading",
			fixture: "siit_2008_wrapped_proposal.txt",
			relPath: "000093/939934/0001135428-08-000362.txt",
			issuer:  "AOZORA BANK, LTD.",
			cusip:   "J0172K107",
			date:    "20080626",
			items:   []string{"2.10", "2.11", "2.12"},
			whyBroken: "the wrapped continuation line `in Electronic Format - Update Terminology to Match` is a " +
				"bare single cell, so layout_pvtext.go:1362 reads it as the next issuer heading",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			sink := &rowSink{}
			meta := processFile(tc.relPath, filepath.Join(dir, tc.fixture), sink, make([]byte, headBytes))
			if meta.ParseStatus != "ok" || meta.Layout != "pvtext" {
				t.Fatalf("fixture/dispatch precondition: status=%s layout=%s error=%s",
					meta.ParseStatus, meta.Layout, meta.ErrorMsg)
			}
			if len(sink.buf) == 0 {
				t.Fatalf("fixture precondition: %s parsed to no rows", tc.fixture)
			}

			for _, item := range tc.items {
				var got *VoteRow
				for i := range sink.buf {
					if sink.buf[i].ItemSeq == item {
						got = &sink.buf[i]
						break
					}
				}
				if got == nil {
					t.Fatalf("fixture precondition: item %s not emitted from %s", item, tc.fixture)
				}
				if got.IssuerName != tc.issuer {
					t.Errorf("item %s: issuer_name=%q, want %q (%s)", item, got.IssuerName, tc.issuer, tc.whyBroken)
				}
				if got.CUSIP != tc.cusip {
					t.Errorf("item %s: cusip=%q, want %q as the filing prints it (%s)",
						item, got.CUSIP, tc.cusip, tc.whyBroken)
				}
				if got.MeetingDate != tc.date {
					t.Errorf("item %s: meeting_date=%q, want %q (%s)", item, got.MeetingDate, tc.date, tc.whyBroken)
				}
			}
		})
	}
}
