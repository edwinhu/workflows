package main

import (
	"path/filepath"
	"testing"
)

// familyNS7Dispatch runs the real dispatch on a family NS7 fixture, loading the
// registrant's own cik_series.tsv rows as the dictionary when one is named.
func familyNS7Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns7", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns7", fixture), sink, make([]byte, headBytes))
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

// 000031/315754/0000950152-04-006465.txt: 11-31, 53-59, 124-142.
// Ohio National Fund Inc, 2004, layout `pvtext`. 10,272 of this filing's 11,459
// rows carry no series, and every one of them is stamped with an ACCOUNT CODE
// rather than a fund name:
//
//	4265 "ONF19-6562"   859 "ONF19-6543"   727 "ONF19-6561"   690 "ONF19-6559"
//	 655 "ONF19-6711"   645 "19-6558"      597 "ONF19-6712"   585 "ONF19-6556"
//
// The filing declares no series in the SGML header, so cikDict.back puts the
// registrant's dictionary in. The fund name IS printed, on the page line two
// lines above the account number (source lines 125-129 verbatim):
//
//	<PAGE>
//	OHIO NATIONAL AGGRESSIVE GROWTH PORTFOLIO
//
//	   Item 1. Proxy Voting Record
//	   Account Number: ONF19-6559
//
// The layout adopts `Account Number: ONF19-6559` as the fund heading and drops
// the page heading above it. Measured on this filing's own index through
// icrResolveFundShared:
//
//	"OHIO NATIONAL AGGRESSIVE GROWTH PORTFOLIO" -> S000007895 (exact, via the
//	                                               registrant-prefix strip)
//	"ONF19-6559"                                -> ""
//
// Sibling sections whose block prints no `Account Number:` line are stamped
// correctly in the same filing (OHIO NATIONAL CAPITAL APPRECIATION PORTFOLIO =>
// S000007893), which is why this is an adoption defect and not a resolver floor.
//
// Rows reached: 10,272 of this filing's pool rows, plus the family's second
// filing (0001144204-11-041855.txt, 5,678 rows) = 15,950 family-wide.
//
// Fix in layout_pvtext.go, the fund-heading adoption path: refuse a candidate
// heading that begins `Account Number:` and keep the `<PAGE>` heading above it.
func TestFamilyNS7OhioNationalAccountNumberDisplacesThePageHeading(t *testing.T) {
	rows := familyNS7Dispatch(t, "ohio_national_account_number.txt", "ohio_national_dict.tsv", "pvtext", 5)
	for _, r := range rows {
		if r.SeriesID != "S000007895" {
			t.Errorf("an Account Number line displaced the page fund heading: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000007895", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
