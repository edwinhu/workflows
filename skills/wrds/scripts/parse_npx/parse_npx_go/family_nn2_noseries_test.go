package main

import (
	"path/filepath"
	"testing"
)

// familyNN2Dispatch runs the real dispatch on a family NN.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyNN2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_nn2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_nn2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000094/944487/0000950152-04-006570.txt: 3634-3662. The registrant is
// "STI CLASSIC VARIABLE TRUST" and the dictionary names every series with that
// whole brand infixed -- "STI Classic Variable Trust International Equity Fund"
// (S000004745). The filing's banners ABBREVIATE the brand across the name: the
// "Variable Trust" half is dropped from the prefix and reappears as a trailing
// "VA" token, so the section reads
// "=================== STI CLASSIC INTERNATIONAL EQUITY FUND VA ===================".
// The registrant-prefix strip cuts only a WHOLE leading brand ("STI CLASSIC
// VARIABLE TRUST"), which this heading never carries, and no rule removes a
// trailing "VA" before the lookup, so every one of the filing's six banners
// misses. All 6,792 rows of the filing carry a fund name and no series.
func TestFamilyNN2STIClassicVASuffix(t *testing.T) {
	rows := familyNN2Dispatch(t, "sti_classic_va_suffix.txt", "issnpx", 11)
	for _, r := range rows {
		if r.SeriesID != "S000004745" {
			t.Errorf("STI CLASSIC INTERNATIONAL EQUITY FUND VA: fund=%q series=%q want S000004745", r.FundName, r.SeriesID)
		}
	}
}

// 000101/1014913/0000894189-11-004032.txt: 15-16 + 106-130 (the SGML series
// block) + 18313-18340. Each broadridge fund section prints its name and then a
// dated period line before the block's opening rule:
//
//	Frontegra Timpani Small Cap Growth Fund
//	Reporting Period: 3/23/11 - 6/30/11
//	------------------------------------------------------------------
//	 AXT, INC.                                    Agenda Number: 933410071
//
// brHeadingSlot (layout_broadridge.go:495) steps back over such a line only when
// it is spelled "Period: <start> - <end>" with htmlDate-parsable endpoints. This
// vintage spells it "Reporting Period: " with m/d/yy dates, so the period line
// itself becomes the heading slot, resolves to nothing, and the section's rows
// carry fund_name="Reporting Period: 3/23/11 - 6/30/11" and no series even
// though the filing DECLARES <SERIES-NAME>Frontegra Timpani Small Cap Growth
// Fund for S000022841 one line above. Three sections of this filing (HEXAM,
// Phocas, Timpani) lose 1,794 of its 3,692 rows this way.
func TestFamilyNN2FrontegraReportingPeriodSlot(t *testing.T) {
	rows := familyNN2Dispatch(t, "frontegra_reporting_period_slot.txt", "broadridge", 5)
	for _, r := range rows {
		if r.SeriesID != "S000022841" {
			t.Errorf("Frontegra Timpani Small Cap Growth Fund: fund=%q series=%q want S000022841", r.FundName, r.SeriesID)
		}
	}
}

// 000131/1318342/0001193125-06-182160.txt: 25-26 + 84-87 + 114-117 (declared
// series) + 145-154 (the document preamble) + 186-290. Five of this filing's six fund sections open with
// a centred paragraph that appends the DOCUMENT TITLE to the fund name:
//
//	<B>Claymore Peroni Equity Opportunities Fund Proxy Voting </B>
//
// for a declared "Claymore Peroni Equity Opportunities Fund" (S000011377). The
// one section that resolves is the only one printed WITHOUT that suffix
// ("<B>Claymore/Zacks Multi-Cap Opportunities Fund </B>", 249 rows). The
// htmltable heading resolver matches the paragraph against the declared names
// exactly and no rule trims a trailing "Proxy Voting", so 1,777 of the filing's
// 2,026 rows carry neither fund_name nor series_id.
func TestFamilyNN2ClaymoreProxyVotingSuffix(t *testing.T) {
	rows := familyNN2Dispatch(t, "claymore_proxy_voting_suffix.txt", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000011377" {
			t.Errorf("Claymore Peroni Equity Opportunities Fund Proxy Voting: fund=%q series=%q want S000011377", r.FundName, r.SeriesID)
		}
	}
}
