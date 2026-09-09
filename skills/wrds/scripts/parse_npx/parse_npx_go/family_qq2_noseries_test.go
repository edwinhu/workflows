package main

import (
	"path/filepath"
	"testing"
)

// familyQQ2Dispatch runs the real dispatch on a family QQ.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyQQ2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_qq2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_qq2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000117/1174610/0001193125-17-269827.txt: 15-16 + 1031-1050 + 98809-98824. The
// ProShares banner drops the type word its OWN header declares:
//
//	=============================== ProShares Merger ===============================
//
// for a declared <SERIES-NAME>ProShares Merger ETF (S000037318). Every rung that
// reads a type word admits a heading that ADDS one the declared name lacks; none
// reads a heading that OMITS the declared name's own terminal ETF, and ix.lessSuffix
// does not answer because ETF is not the last word every declared name shares. This
// is the filing's only unresolved heading: 460 of its 168,452 rows, and every other
// row of the filing carries a series.
func TestFamilyQQ2ProSharesMergerTypeWordOmitted(t *testing.T) {
	rows := familyQQ2Dispatch(t, "proshares_merger_type_word.txt", "issnpx", 3)
	for _, r := range rows {
		if r.SeriesID != "S000037318" {
			t.Errorf("ProShares Merger: fund=%q series=%q want S000037318", r.FundName, r.SeriesID)
		}
	}
}

// 000021/217087/0000740583-13-000277.txt: 15-16 + 222-240. SBL Fund prints the
// letter of one series as the DIGIT zero:
//
//	============================= SBL Fund - Series 0 ==============================
//
// for a declared SERIES O (ALL CAP VALUE SERIES) (S000010054). Its eleven sibling
// sections ("SBL Fund - Series B", "- Series V", "- Series Q", ...) resolve through
// the dash rung on the same spelling, so the single glyph is the whole blocker.
// This is the filing's only unresolved heading: 1,292 of its 20,642 rows.
func TestFamilyQQ2SBLSeriesLetterOAsZero(t *testing.T) {
	rows := familyQQ2Dispatch(t, "sbl_series_letter_o_as_zero.txt", "issnpx", 10)
	for _, r := range rows {
		if r.SeriesID != "S000010054" {
			t.Errorf("SBL Fund - Series 0: fund=%q series=%q want S000010054", r.FundName, r.SeriesID)
		}
	}
}

// 000035/355916/0000900092-04-000229.txt: 25-26 + 22787-22807. Merrill Lynch heads
// every section with its own name ABBREVIATED, then a colon, then the fund:
//
//	============ ML VARIABLE SERIES FUNDS, INC.: ML INDEX 500 V.I. FUND ============
//
// The registrant is MERRILL LYNCH VARIABLE SERIES FUNDS INC, so issColonRegistrantPrefix
// refuses the cut -- "ml" is not one of the registrant's own tokens -- and the
// dash/colon rung finds neither side declared. The tail alone resolves: "ML INDEX 500
// V.I. FUND" reaches the declared "Mercury Index 500 V.I. Fund" (S000002875) through
// lessLeadToken once the prefix is off. Four sections carry this shape ("ML INDEX 500"
// 4,689 rows, "ML LARGE CAP CORE" 1,025, "ML LARGE CAP VALUE" 850, and the
// "MERCURY V.I. FUND, INC:" spelling of "MERRILL LYNCH LARGE CAP GROWTH" 804), 7,368
// of the filing's 8,656 rows with no series.
func TestFamilyQQ2MLAbbreviatedRegistrantColonPrefix(t *testing.T) {
	rows := familyQQ2Dispatch(t, "ml_abbreviated_registrant_colon_prefix.txt", "issnpx", 7)
	for _, r := range rows {
		if r.SeriesID != "S000002875" {
			t.Errorf("ML VARIABLE SERIES FUNDS, INC.: ML INDEX 500 V.I. FUND: fund=%q series=%q want S000002875", r.FundName, r.SeriesID)
		}
	}
}

// 000111/1110822/0001110822-04-000006.txt: 25-26 + 16917-16937. Janus heads its
// quantitative sleeves without the INTECH sub-brand the dictionary carries:
//
//	======================== ADVISER RISK-MANAGED CORE FUND ========================
//
// for "Janus Adviser INTECH Risk-Managed Core Fund" (S000010562). The three sibling
// sleeves in the same filing resolve through issDistinctivePairDecl on the adjacent
// pair "managed value" / "managed growth" / "managed international"; this one does
// not, because issDistinctiveTokenMin is 5 and "core" is four characters, so the
// pair "managed core" -- which exactly one declared name carries -- is never tested.
// 3,196 of the filing's 4,560 rows with no series sit under this heading.
func TestFamilyQQ2JanusIntechRiskManagedCore(t *testing.T) {
	rows := familyQQ2Dispatch(t, "janus_intech_risk_managed_core.txt", "issnpx", 7)
	for _, r := range rows {
		if r.SeriesID != "S000010562" {
			t.Errorf("ADVISER RISK-MANAGED CORE FUND: fund=%q series=%q want S000010562", r.FundName, r.SeriesID)
		}
	}
}

// 000071/711080/0001144204-05-027165.txt: 25-26 + 8609-8611 + 8732-8762. A block
// whose last line is a DIRECTOR-SLATE row -- a nominee name carrying the vote
// columns -- leaves that whole row in the next block's heading slot:
//
//	       DONALD A. WASHBURN                                        Mgmt          For                            For
//	- --------------------------------------------------------------------------------------------------------------------------
//	 AMERICAN DENTAL PARTNERS, INC.                                                              Agenda Number:  932286695
//
// brOpenProposalTail declines it: that guard asks whether the open ROW's accumulated
// text ends in the slot line, and a slate nominee is a row of its own rather than the
// wrapped tail of one. So the section's fund is cleared and every block after it is
// emitted under fund_name "DONALD A. WASHBURN  Mgmt  For  For" with no series. Eighteen
// such pseudo-headings carry all 680 of this filing's no-series rows; the six real
// headings resolve.
func TestFamilyQQ2TouchstoneDirectorRowAsHeading(t *testing.T) {
	rows := familyQQ2Dispatch(t, "touchstone_director_row_as_heading.txt", "broadridge", 9)
	for _, r := range rows[6:] {
		if r.SeriesID != "S000038006" {
			t.Errorf("block after a director-slate row: fund=%q series=%q want S000038006", r.FundName, r.SeriesID)
		}
	}
}
