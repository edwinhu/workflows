package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// 000139/1394166/0000935069-08-001888.txt: verbatim source lines 11-80 (header
// through `<TEXT>`), 142-213 (the first `<PAGE>` and its first three meeting
// sections), 740-764 (the STATION CASINOS section) and 7715-7717 (the filing's
// own tail) -- four unedited slices of the real file. Dispatches to
// `splittable` (the precondition asserts it).
//
// The 787 Fund, Inc., 2008, filing agent 0000935069 (ProxyEdge). Measured on
// HEAD over the WHOLE file: status=ok, layout=splittable, 1,642 rows, of which
// 1,642 carry no security id and 1,642 no meeting date -- exactly the filing's
// LOST_BASE no_secid=1642 / no_date=1642. The series resolves on every row
// (S000017793 is stamped on all 1,642), so the blank is identity alone, not a
// no-series confound. Roughly 26 filings under this agent print the same shape,
// ~33,610 blank rows in total.
//
// The shape is a THIRD ProxyEdge heading template, distinct from the two the
// reader already knows. Source lines 149-155 verbatim:
//
//   - --------------------------------------------------------------------------------
//     SHAW COMMUNICATIONS INC.
//
//     ISSUER: 82028K200             SJR   SPECIAL MEETING DATE: 07/10/2007
//     SEDOL:                        ISIN:
//
//     VOTE GROUP: GLOBAL
//
// The company name sits ALONE on its own line, and the CUSIP, the ticker, the
// meeting type and the meeting date are all printed on the SINGLE `ISSUER:`
// line below it. Compare the already-supported sibling
// testdata/family_gabelliBareHeader/gabelli_bare_text_issuer_header_blocks_identity.txt
// -- same agent, CIK 901246, filing 0000935069-08-002098.txt -- which splits the
// same facts the other way round:
//
//	FREEPORT-MCMORAN COPPER & GOLD INC.     FCX      ANNUAL MEETING DATE: 07/10/2007
//	ISSUER: 35671D857                       ISIN:
//
// and which HEAD reads whole (issuer=`FREEPORT-MCMORAN COPPER & GOLD INC.`,
// cusip=`35671D857`, ticker=`FCX`, type=`ANNUAL`, date=`20070710`).
//
// Where it falls through, in layout_splittable.go: the block delimiter is
// spIsProxyEdgeHeading (:1194), which requires the line's LAST cell to carry
// `MEETING DATE:` AND its FIRST cell to be a bare name -- `issuer != "" &&
// !strings.Contains(issuer, ":")`. On this template the two requirements can
// never be met by the same line. The name line `SHAW COMMUNICATIONS INC.` has
// no `MEETING DATE:` and fails the first test; the identity line
// `ISSUER: 82028K200 ... SPECIAL MEETING DATE: 07/10/2007` does carry it, but
// its first cell is `ISSUER: 82028K200`, which contains a colon and fails the
// second. So no line in the block ever opens one: spReadProxyEdgeHeading (:1230)
// returns early at its own `!spIsProxyEdgeHeading(line)` guard, ctx.issuer is
// never set, and the `ctx.issuer != ""` precondition on the `Issuer:` body-line
// arm (:1235) -- the arm that would otherwise bank the CUSIP -- is dead too.
// The whole heading block is discarded as furniture and every proposal row in
// the section is emitted with a blank issuer, CUSIP, ticker, meeting type and
// meeting date, all five of which are printed in the bytes.
func TestFamilyICRIssuerLineCombinedIdentityLineLosesIdentity(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	dir := filepath.Join("testdata", "family_icrIssuerLine")
	var err error
	cikDict, err = loadCIKSeries(filepath.Join(dir, "fund787_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	fixture := "gabelli_787_issuer_line_identity.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "splittable" || len(rows) != 9 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=9 error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	// The fixture's first section is SHAW COMMUNICATIONS INC., whose heading
	// block prints cusip 82028K200, ticker SJR, type SPECIAL and 07/10/2007
	// (normalised to YYYYMMDD by htmlDate, as the sibling fixture's 20070710
	// shows).
	first := rows[0]
	if first.CUSIP != "82028K200" || first.Ticker != "SJR" || first.MeetingType != "SPECIAL" ||
		first.MeetingDate != "20070710" || !strings.Contains(first.IssuerName, "SHAW COMMUNICATIONS") {
		t.Errorf("the combined ISSUER:/MEETING DATE: line lost the SHAW COMMUNICATIONS identity: issuer=%q cusip=%q ticker=%q type=%q date=%q series=%q item=%q desc=%.40q; want issuer containing %q, cusip=%q ticker=%q type=%q date=%q",
			first.IssuerName, first.CUSIP, first.Ticker, first.MeetingType, first.MeetingDate, first.SeriesID, first.ItemSeq, first.VoteDescription,
			"SHAW COMMUNICATIONS", "82028K200", "SJR", "SPECIAL", "20070710")
	}

	// Every one of the fixture's four heading blocks prints a company name, an
	// `ISSUER:` CUSIP, a ticker and a `MEETING DATE:`, so no row in it may carry
	// a blank of any of them.
	var blankIssuer, blankID, blankDate int
	for _, r := range rows {
		if r.IssuerName == "" {
			blankIssuer++
		}
		if r.CUSIP == "" {
			blankID++
		}
		if r.MeetingDate == "" {
			blankDate++
		}
	}
	if blankIssuer != 0 || blankID != 0 || blankDate != 0 {
		t.Errorf("rows with no issuer name: %d/%d; rows with no security id: %d/%d; rows with no meeting date: %d/%d; every heading block in the fixture prints all three",
			blankIssuer, len(rows), blankID, len(rows), blankDate, len(rows))
	}
}
