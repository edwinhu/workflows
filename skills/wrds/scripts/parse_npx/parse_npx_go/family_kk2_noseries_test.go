package main

import (
	"path/filepath"
	"testing"
)

// familyKK2Dispatch runs the real dispatch on a family KK.2 no-series fixture
// with the registrant's own cik_series.tsv rows loaded as the dictionary.
func familyKK2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_kk2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_kk2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000132/1329954/0001438934-08-000229.txt: 575-600. The first section's heading,
// "2CVM Intrinsic Value Fund", is separated from its block's dashed rule by the
// <TABLE>/<S> <C> lines, which normalization leaves as one blank line. That is
// brHeadingSlot's crossedBlank shape, and the crossedBlank branch acts only on a
// name lookupSeriesTolerantEntry finds DECLARED -- it never consults
// issResolveFund, so the internal-code prefix the direct path strips is fatal
// here. 2,565 rows of the filing's first section carry no series.
func TestFamilyKK2JohnHancockTableGapCodeHeading(t *testing.T) {
	rows := familyKK2Dispatch(t, "jh_table_gap_code_heading.txt", "broadridge", 5)
	for _, r := range rows {
		if r.SeriesID != "S000001413" {
			t.Errorf("2CVM Intrinsic Value Fund: fund=%q series=%q want S000001413", r.FundName, r.SeriesID)
		}
	}
}

// 000092/920547/0001144204-06-036222.txt: 279-305. Same crossedBlank branch,
// reached by a heading that carries the registrant's own brand rather than a
// code: "Touchstone Value Plus Fund" over a declared "Value Plus Fund", with
// <TABLE>/<CAPTION>/<S> <C> between it and the rule. Every heading in this
// filing that IS printed directly above its rule resolves; the five printed over
// a <TABLE> do not, and 2,499 rows carry no series.
func TestFamilyKK2TouchstoneTableGapBrandHeading(t *testing.T) {
	rows := familyKK2Dispatch(t, "touchstone_table_gap_brand_heading.txt", "broadridge", 6)
	for _, r := range rows {
		if r.SeriesID != "S000003143" {
			t.Errorf("Touchstone Value Plus Fund: fund=%q series=%q want S000003143", r.FundName, r.SeriesID)
		}
	}
}

// 000127/1277946/0001206774-04-001216.txt: 7143-7184. This vintage prints the
// fund on the block-opener line itself, behind an "Account Group:" label and to
// the left of "Agenda Number:". brInlineAgendaFund hands the whole head to an
// EXACT declared lookup, label and all, so "Account Group:  FBR Small Cap
// Financial Fund" resolves to nothing and no heading is ever read. All 2,420
// rows of the filing carry no series.
func TestFamilyKK2FBRAccountGroupOnAgendaLine(t *testing.T) {
	rows := familyKK2Dispatch(t, "fbr_account_group_agenda_line.txt", "broadridge", 2)
	for _, r := range rows {
		if r.SeriesID != "S000009264" {
			t.Errorf("Account Group: FBR Small Cap Financial Fund: fund=%q series=%q want S000009264", r.FundName, r.SeriesID)
		}
	}
}

// 000081/817841/0001169232-04-004745.txt: 18240-18270. The section names its
// fund on an "Account Name:" line and then prints "Account Number: 9485" on the
// next line. Both lines are pvTextAccountFund headings, and the second one
// overwrites the resolved name with the opaque code, so the fund_name column
// carries "9485" and the series is dropped. 646 rows.
func TestFamilyKK2SeligmanAccountNumberAfterName(t *testing.T) {
	rows := familyKK2Dispatch(t, "seligman_account_number_after_name.txt", "pvtext", 19)
	for _, r := range rows {
		if r.SeriesID != "S000009638" {
			t.Errorf("Account Name: Seligman International Growth Portfolio: fund=%q series=%q want S000009638", r.FundName, r.SeriesID)
		}
	}
}
