package main

import (
	"path/filepath"
	"testing"
)

// 000090/901246/0000935069-08-002098.txt: verbatim source lines 11-72, 123-1208
// and 17410-17435 (the filing's own tail), three unedited slices of the real
// file. Dispatches to `splittable` (the precondition asserts it).
//
// Gabelli Capital Series Funds, Inc., 2008, filing agent 0000935069 (ProxyEdge).
// 3,779 of 3,779 rows in the whole filing carry no security id and no meeting
// date, and absent_by_bytes is 0 -- every one of the filing's 463 meetings
// PRINTS both. Source lines 129-134 verbatim:
//
//   - --------------------------------------------------------------------------------
//     FREEPORT-MCMORAN COPPER & GOLD INC.     FCX      ANNUAL MEETING DATE: 07/10/2007
//     ISSUER: 35671D857                       ISIN:
//     SEDOL:
//
//     VOTE GROUP: GLOBAL
//
// The heading block sits BETWEEN a `</TABLE>` and the next `<TABLE>`, as bare
// text. The already-supported sibling fixture
// testdata/family_ns12/gamco_npx_account_prefix_blocks_resolution.txt -- same
// filing agent, CIK 909504, filing 0000935069-08-001961.txt -- prints the
// structurally identical block INSIDE its own `<TABLE>...</TABLE>`, and the
// parser reads it whole: measured on HEAD, every one of that fixture's 6 rows
// carries issuer=`BANK OF IRELAND (...)`, cusip=`G49374146`, date=`20070717`.
// Measured on this fixture, all 160 rows carry issuer=“, cusip=“, date=“.
// The series resolves either way (S000001060 is stamped on all 160), so the
// blank is identity alone, not a no-series confound.
//
// Rows reached: 3,779 in this filing; the agent-0000935069 bare-header family is
// at least 10 filings and ~30,514 attributable blank rows, including
// 000078/783898/0000935069-08-001991.txt (7,358) and
// 000139/1394166/0000935069-08-001888.txt (3,284).
//
// Where it falls through, in layout_splittable.go's parseSplitTableRaw: the two
// call sites of spReadProxyEdgeHeading are at :409 and :442, and BOTH are inside
// the `cur != nil` arm -- i.e. reachable only while a `<TABLE>` is open. The
// out-of-table arm at :324-353 routes its lines to spReadContext (:944) instead,
// whose switch matches only the labels `INSTITUTIONAL ACCOUNT NAME`, `TICKER`,
// `MEETING DATE`, `SECURITY ID*` and `SELECTED ACCOUNTS`. This vendor's heading
// line spells the date label `ANNUAL MEETING DATE:` (the meeting type is glued
// to it) and its body line spells the id label `ISSUER:`, so neither pair is
// matched and the whole block is discarded as furniture. spIsProxyEdgeHeading
// (:1178) recognises the line correctly; it is simply never asked.
func TestFamilyGabelliBareHeaderBareTextIssuerBlockLosesIdentity(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	dir := filepath.Join("testdata", "family_gabelliBareHeader")
	var err error
	cikDict, err = loadCIKSeries(filepath.Join(dir, "gabelli_capital_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	fixture := "gabelli_bare_text_issuer_header_blocks_identity.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "splittable" || len(rows) != 160 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=160 error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	// The fixture's first section is FREEPORT-MCMORAN, whose heading block
	// prints cusip 35671D857 and 07/10/2007 (normalised YYYYMMDD by htmlDate,
	// as the table-wrapped sibling's 20070717 shows).
	first := rows[0]
	if first.CUSIP != "35671D857" || first.MeetingDate != "20070710" || first.IssuerName != "FREEPORT-MCMORAN COPPER & GOLD INC." {
		t.Errorf("the bare-text heading block lost the FREEPORT-MCMORAN identity: issuer=%q cusip=%q date=%q item=%q desc=%.40q series=%q; want issuer=%q cusip=%q date=%q",
			first.IssuerName, first.CUSIP, first.MeetingDate, first.ItemSeq, first.VoteDescription, first.SeriesID,
			"FREEPORT-MCMORAN COPPER & GOLD INC.", "35671D857", "20070710")
	}

	// Every one of the fixture's 25 heading blocks prints both an `ISSUER:` id
	// and a `MEETING DATE:`, so no row in it may carry a blank of either.
	var blankID, blankDate int
	for _, r := range rows {
		if r.CUSIP == "" {
			blankID++
		}
		if r.MeetingDate == "" {
			blankDate++
		}
	}
	if blankID != 0 || blankDate != 0 {
		t.Errorf("rows with no security id: %d/%d; rows with no meeting date: %d/%d; every heading block in the fixture prints both", blankID, len(rows), blankDate, len(rows))
	}
}
