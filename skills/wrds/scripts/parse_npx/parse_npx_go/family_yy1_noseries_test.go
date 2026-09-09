package main

import (
	"path/filepath"
	"testing"
)

// familyYY1Dispatch runs the real dispatch on a family YY.1 fixture with the
// registrant's own series dictionary loaded.
func familyYY1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_yy1", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_yy1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000125/1252867/0001206774-04-000866.txt: 15-26, 118-150. TrendStar Investment
// Trust's 2004 N-PX/A declares no series in its header and is backed by the
// dictionary. The filing names the fund on the LEFT of every block opener's
// `Agenda Number:` label, and nowhere else:
//
//	TrendStar American Endeavor                            Agenda Number:  932116026
//
// parseBroadridge reads that slot (layout_broadridge.go:1097) but requires an
// EXACT declared name, and the two names the filing prints -- `TrendStar
// American Endeavor` and `TrendStar Small Cap` -- are each the dictionary name
// minus its terminal `FUND` (`TRENDSTAR AMERICAN ENDEAVOR FUND`,
// `TRENDSTAR SMALL-CAP FUND`). All 634 rows of the filing carry a blank fund
// name and a blank series; 29 blocks print the American Endeavor label and 38
// the Small Cap one.
//
// The dictionary rows are the registrant's own EDGAR series declarations for
// CIK 1252867.
func TestFamilyYY1TrendStarInlineAgendaFund(t *testing.T) {
	rows := familyYY1Dispatch(t, "trendstar_inline_agenda_fund.txt", "trendstar_dict.tsv", "broadridge", 6)
	for _, r := range rows {
		if r.SeriesID != "S000000516" {
			t.Errorf("TrendStar American Endeavor: fund=%q issuer=%q item=%q series=%q want S000000516", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000081/810573/0000088053-06-001068.txt: 14-25, 568-572, 1583-1610. DWS
// Variable Series II's 2006 N-PX heads each section with a sleeve code and the
// fund name inside one `=` rule. The codes run A..Z and then double and triple
// off the same letters:
//
//	=========================== AA      DWS BALANCED VIP ===========================
//	===================== DDD   DWS JANUS GROWTH &amp; INCOME VIP ======================
//
// A ONE-character code is stripped by issLeadingIndexToken, so `A  DWS MFS
// STRATEGIC VALUE VIP` resolves; a multi-character one is not, because
// issLeadingCodeToken (layout_issnpx.go:4193) requires the token to carry at
// least one DIGIT and these are pure letters. The multi-letter sections that do
// resolve today get there by accident through the brand-cut rules -- `CCC  DWS
// INTERNATIONAL SELECT EQUITY VIP` and `DD  DWS JANUS GROWTH OPPORTUNITIES VIP`
// resolve while `AA  DWS BALANCED VIP` and `DDD  DWS JANUS GROWTH & INCOME VIP`
// do not, on the same dictionary. 4,166 rows sit under the AA heading and 598
// under the DDD heading; both names are declared in the filing's own header
// (S000006265 at line 217, S000006270 at line 282).
