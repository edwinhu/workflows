package main

import (
	"path/filepath"
	"testing"
)

// familyQQ1Dispatch runs the real dispatch on a family QQ.1 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyQQ1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_qq1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_qq1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000100/1000351/0000950137-05-015211.txt: 106-151. This Broadridge vintage
// draws no rule at all -- the fund heading `LEUTHOLD CORE INVESTMENT FUND` sits
// under the page banner, one blank line above the issuer that opens the block,
// and the block's own opener carries `AGENDA NUMBER:` four lines further down.
// brHeadingSlot refuses the slot outright because lines[i-1] is not a dashed
// rule, so no heading is ever read and all 1,372 rows of the filing carry no
// series although the dictionary spells all three headings exactly.
func TestFamilyQQ1LeutholdRulelessHeading(t *testing.T) {
	rows := familyQQ1Dispatch(t, "leuthold_ruleless_heading.txt", "broadridge", 6)
	for _, r := range rows {
		if r.SeriesID != "S000000847" {
			t.Errorf("LEUTHOLD CORE INVESTMENT FUND: fund=%q series=%q want S000000847", r.FundName, r.SeriesID)
		}
	}
}

// 000035/355747/0001193125-06-182322.txt: 423-427 over 12336-12360. The issnpx
// equals-rule banner wraps over TWO rule lines, and this section's continuation
// opens with a SINGLE `=` (`= MULTIPLE DISCIPLINE FUNDS GLOBAL - BALANCED ALL CAP
// GROWTH AND VALUE FUND ==`) where every other section in the filing opens with a
// run of them. The continuation is not joined, so the heading truncates to the
// registrant plus the brand -- `LEGG MASON PARTNERS INVESTMENT FUNDS, INC. - LEGG
// MASON PARTNERS` -- which names no series. 1,360 rows.
func TestFamilyQQ1LeggMasonSingleEqualsContinuation(t *testing.T) {
	rows := familyQQ1Dispatch(t, "leggmason_single_equals_continuation.txt", "issnpx", 11)
	for _, r := range rows {
		if r.SeriesID != "S000008865" {
			t.Errorf("MULTIPLE DISCIPLINE FUNDS GLOBAL ALL CAP GROWTH AND VALUE: fund=%q series=%q want S000008865", r.FundName, r.SeriesID)
		}
	}
}

// 000091/919556/0000950116-04-002575.txt: 227-690. The section names its fund in
// a spanned one-cell table row whose text is `Account` and, on the cell's second
// line, `&#150; McM Balanced Fund` -- an en dash, not a colon, so no labelled-cell
// reader claims it, and the cell is inside the vote table rather than in the
// inter-table markup the block-heading reader looks at. The printed brand is the
// registrant's FORMER CONFORMED NAME `MCM FUNDS`; the dictionary spells the fund
// `McMorgan Balanced Fund`. All 1,349 rows of the filing carry no series.
func TestFamilyQQ1McMorganAccountDashHeading(t *testing.T) {
	rows := familyQQ1Dispatch(t, "mcmorgan_account_dash_heading.txt", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000005310" {
			t.Errorf("Account - McM Balanced Fund: fund=%q series=%q want S000005310", r.FundName, r.SeriesID)
		}
	}
}

// 000091/919160/0000894189-07-002284.txt: 300-520. Every section of this filing
// opens with the same one-cell export sentence, `In All Markets, for all statuses,
// for <FUND>.`, wrapped over three lines of the cell. Five sections resolve; the
// first one, `GUINNESS ATKINSON ASIA FOCUS FUND`, does not, and its 684 rows are
// the filing's whole no-series residue.
func TestFamilyQQ1GuinnessAllStatusesBanner(t *testing.T) {
	rows := familyQQ1Dispatch(t, "guinness_all_statuses_banner.txt", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000005893" {
			t.Errorf("for GUINNESS ATKINSON ASIA FOCUS FUND: fund=%q series=%q want S000005893", r.FundName, r.SeriesID)
		}
	}
}
