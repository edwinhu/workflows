package main

import (
	"path/filepath"
	"testing"
)

func familyHH1Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_hh1", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_hh1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000077/775689/0000897101-04-001645.txt: 2573-2607. The bare fund
// heading is bracketed by "=" rules inside the broadridge fixed-width report.
func TestFamilyHH1NorthTrackEqualsRuleHeading(t *testing.T) {
	rows := familyHH1Dispatch(t, "north_track_equals_heading.txt", "broadridge", 19)
	for _, r := range rows {
		if r.MeetingDate != "20031121" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000005901" {
			t.Errorf("S&P 100 INDEX FUND: fund=%q series=%q want S000005901", r.FundName, r.SeriesID)
		}
	}
}

// 000082/826732/0001206774-04-001292.txt: 117-146. The fund name shares its line
// with the "Agenda Number:" cell of the Broadridge Investment Company Report.
func TestFamilyHH1CalamosInlineAgendaFund(t *testing.T) {
	rows := familyHH1Dispatch(t, "calamos_inline_agenda_fund.txt", "broadridge", 8)
	for _, r := range rows {
		if r.CUSIP != "88579Y101" || r.MeetingDate != "20040511" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000004059" {
			t.Errorf("Calamos Blue Chip Fund: fund=%q series=%q want S000004059", r.FundName, r.SeriesID)
		}
	}
}

// 000091/916006/0000950129-04-006426.txt: 12365-12374, 12393-12496. The heading carries
// a report-title suffix after an em dash: "... Fund &#151; Proxy Voting Record".
func TestFamilyHH1BridgewayReportSuffixHeading(t *testing.T) {
	rows := familyHH1Dispatch(t, "bridgeway_report_suffix.txt", "htmltable", 3)
	for _, r := range rows {
		if r.CUSIP == "" || r.MeetingDate == "" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000004424" {
			t.Errorf("Ultra-Small Company Market Fund: fund=%q series=%q want S000004424", r.FundName, r.SeriesID)
		}
	}
}

// 000147/1479026/0001193125-22-230515.txt: 470, 49288-49307. The heading drops the
// dictionary name's "Equity" type word: "Equal Weight U.S. Large Cap ETF".
func TestFamilyHH1GoldmanDroppedEquityWord(t *testing.T) {
	rows := familyHH1Dispatch(t, "goldman_missing_equity.txt", "issnpx", 5)
	for _, r := range rows {
		if r.CUSIP != "88025U109" || r.MeetingDate != "20220615" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000058070" {
			t.Errorf("Equal Weight U.S. Large Cap ETF: fund=%q series=%q want S000058070", r.FundName, r.SeriesID)
		}
	}
}

// 000147/1479026/0001193125-22-230515.txt: 470, 68228-68248. The heading misspells the
// type word: "... Infrastructure Equitiy ETF".
func TestFamilyHH1GoldmanEquitiyTypoHeading(t *testing.T) {
	rows := familyHH1Dispatch(t, "goldman_equitiy_typo.txt", "issnpx", 8)
	for _, r := range rows {
		if r.CUSIP == "" || r.MeetingDate == "" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000072818" {
			t.Errorf("Future Real Estate and Infrastructure Equitiy ETF: fund=%q series=%q want S000072818", r.FundName, r.SeriesID)
		}
	}
}

// 000147/1479026/0001193125-22-230515.txt: 470, 562-578. The wrapped heading carries
// the fund's historical name — "ActiveBeta Paris-Align Climate U.S. Low Vol Plus
// Equity ETF" — against the declared "ActiveBeta(R) Paris-Aligned Climate U.S.
// Large Cap Equity ETF".
func TestFamilyHH1GoldmanParisAlignLowVolHeading(t *testing.T) {
	rows := familyHH1Dispatch(t, "goldman_paris_align_lowvol.txt", "issnpx", 5)
	for _, r := range rows {
		if r.CUSIP != "88025U109" || r.MeetingDate != "20220615" {
			t.Fatalf("identity precondition: CUSIP=%q date=%q", r.CUSIP, r.MeetingDate)
		}
		if r.SeriesID != "S000074467" {
			t.Errorf("ActiveBeta Paris-Align Climate U.S. Low Vol Plus Equity ETF: fund=%q series=%q want S000074467", r.FundName, r.SeriesID)
		}
	}
}
