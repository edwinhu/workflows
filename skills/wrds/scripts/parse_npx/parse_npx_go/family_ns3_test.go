package main

import (
	"path/filepath"
	"testing"
)

// familyNS3Dispatch runs the real dispatch on a family NS3 fixture, loading the
// registrant's own cik_series.tsv rows as the dictionary. The 2004 filings of
// this family declare NO series in the SGML header, so the dictionary is the
// only index a fund heading can resolve against.
func familyNS3Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns3", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns3", fixture), sink, make([]byte, headBytes))
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

// 000075/756913/0001206774-04-001363.txt: 11-28, 54-60, 121-125, 11973-11980,
// 11985-11990, 11997-12006, 278106-278109. Manufacturers Investment Trust,
// 2004, layout `agenda`. The sibling -001273.txt is the same shape; CIK 756913
// contributes 117K no-series rows over 29 pool filings.
//
// Batch 75 taught the banner branch to refuse a candidate whose first cell is
// an item number or whose LAST cell names the Type column. Neither refusal
// touches the shape that is left: a WRAPPED PROPOSAL DESCRIPTION. On binary 214
// both filings still emit 53K of their 57K rows with no series, and the fund
// column of those rows holds description fragments -- 28,048 rows under
// `ADOPT THE FOLLOWING RESOLUTION:`, 10,796 under
// `AGGREGATE AMOUNT OF DIRECTORS`, 5,645 under `INTERNATIONAL, INC.,`, 2,745
// under `AS FOLLOWS:`, then `DIRECTORS`, `NON-EMPLOYEE DIRECTORS`,
// `REPSOL YPF, S.A.,`, `COMPANY S NAME TO`, `PARACHUTE`.
//
// The bytes (lines 11988-11996 verbatim; every continuation line is indented
// SEVEN spaces under the proposal column):
//
//	03     STOCKHOLDER PROPOSAL ENTITLED                                    Shr         For          Against
//	       SHAREHOLDER VOTE ON POISON PILLS TO
//	       ADOPT THE FOLLOWING RESOLUTION:  THE
//	       SHAREHOLDERS OF OUR COMPANY REQUEST
//	       ...
//	       THE ADOP
//
// The vendor hard-wraps the description at the column width, and a wrapped line
// that happens to carry an internal RUN OF TWO OR MORE SPACES is split by
// icrCells into two cells -- here `ADOPT THE FOLLOWING RESOLUTION:` and `THE`.
// `len(cells) >= 2` makes it a banner candidate; its first cell is not an
// icrItem and its last cell is not an agProponent, so neither batch-75 refusal
// fires; `heading` becomes the fragment, and the rule that opens the next
// issuer's block adopts it as the fund for everything below. The same line
// printed with single spaces (line 63935,
// `       AGGREGATE AMOUNT OF DIRECTORS FEES`) is one cell and is correctly
// refused; the double-spaced twin at line 148345,
// `       AGGREGATE AMOUNT OF DIRECTORS  FEES`, is the 10,796-row heading. The
// filing carries 40,717 indented continuation lines with an internal multi-space
// gap.
//
// THE BOUNDED RULE THE BYTES SUPPORT IS INDENTATION, not a dictionary lookup.
// Classifying every column-0 body line of this filing (awk over the raw bytes,
// excluding rules, `<`-lines and `... Agenda: NNNNNNNNN` issuer lines) leaves
// exactly three populations: 30,263 item rows, 10,350 `Proposal ... Type Vote
// Management` column headers, and the 82 coded fund banners -- and all 82
// banners start at column 0:
//
//	123:   2A01 MIT Emerging Small Company Trust
//	7323:  2A09 MIT Equity Index Trust
//	111782:2C72 Total Stock Market Index Trust
//
// Not one genuine banner is indented, and not one continuation line is
// unindented. `parseAgenda` trims the line before it decides, so the indent is
// thrown away: the alternative rule ("follows a vote row without an intervening
// rule") is true of these bytes too but is parser state rather than a property
// of the line, and it would still admit the first wrapped line of a description
// that opens a page. The layout's own comment already states the indentation
// rule -- "A one-cell candidate must start at column 0: the wrapped
// continuation of a proposal description is indented under its item" -- but the
// code spells it `!blockSeen` and applies it to one-cell candidates only.
//
// The banner governing these rows resolves through the chain the layout already
// calls: icrResolveFundShared returns S000008227 for
// `2A01 MIT Emerging Small Company Trust` on this filing's own index after
// cikDict.back. Only the coded banners survive today
// (`2A01 ... Trust` 3,650 rows -> S000008227, `2A07 MIT Pacific Rim Trust` ->
// S000008295, `2C69 MIT International Index Trust` -> S000025519).
//
// Fix in layout_agenda.go, parseAgenda's banner branch (the `banner :=` /
// `inTable` pair): a candidate must start at column 0 of the RAW line. The loop
// already holds `raw`; carry its leading-whitespace test into the banner
// decision and drop the `!blockSeen` proxy, so an indented continuation line is
// never promoted to a fund heading whatever its cell count.
//
// Rows reached: 53K of the two named filings' 57K; CIK 756913's 29 pool filings
// hold 117K no-series rows (scratchpad/lost_known_rbN.tsv), and the coded
// banners resolve at the 96.6% rate measured in family NS2, so ~113K.
func TestFamilyNS3ManufacturersWrappedDescriptionBecomesTheFundBanner(t *testing.T) {
	rows := familyNS3Dispatch(t, "mit_wrapped_description_banner.txt", "manufacturers_dict.tsv", "agenda", 6)
	for _, r := range rows {
		if r.SeriesID != "S000008227" || r.FundName != "2A01 MIT Emerging Small Company Trust" {
			t.Errorf("a wrapped proposal-description line was adopted as the fund banner: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want fund=%q S000008227", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID, "2A01 MIT Emerging Small Company Trust")
		}
	}
}
