package main

import (
	"sort"
	"testing"
)

// An inexact answer must yield to blank when its sibling owns an exact banner
// in the same filing and the disputed banner exactly names another dictionary
// series only after the period, absent from the header. ProShares and
// KraneShares pin both halves; VALIC's legitimate repeated account sections hold.
func familyMislink33Assert(t *testing.T, rows []VoteRow, want map[string]string) {
	t.Helper()
	banners := make([]string, 0, len(want))
	for banner := range want {
		banners = append(banners, banner)
	}
	sort.Strings(banners)
	for _, banner := range banners {
		seen, bad := 0, 0
		var first VoteRow
		for _, r := range rows {
			if r.FundName != banner {
				continue
			}
			seen++
			if r.SeriesID != want[banner] {
				if bad == 0 {
					first = r
				}
				bad++
			}
		}
		if seen == 0 {
			t.Fatalf("fixture section: banner %q produced no rows", banner)
		}
		t.Logf("banner %q: %d rows", banner, seen)
		if bad != 0 {
			t.Errorf("banner %q: %d/%d rows carry wrong series id; first series=%q, want %q (blank refuses the sibling's inexact answer, not a guess at the undeclared future series); issuer=%q cusip=%q date=%q item=%q",
				banner, bad, seen, first.SeriesID, want[banner], first.IssuerName, first.CUSIP, first.MeetingDate, first.ItemSeq)
		}
	}
}

func TestFamilyMislink33DupSibling(t *testing.T) {
	t.Run("ProShares", func(t *testing.T) {
		rows := familyMislink32Dispatch(t,
			"../family_mislink33/proshares2013_ultrapro_financials_dup_sibling.txt",
			"../family_mislink33/cikdict_proshares.tsv", "issnpx", "0001174610", "20130630", 108)
		t.Run("UltraProFinancialsMustBlank", func(t *testing.T) {
			familyMislink33Assert(t, rows, map[string]string{"ProShares UltraPro Financials": ""})
		})
		t.Run("ExactSiblingMustHold", func(t *testing.T) {
			familyMislink33Assert(t, rows, map[string]string{"ProShares Ultra Financials": "S000014252"})
		})
		t.Run("NeighbourMustHold", func(t *testing.T) {
			familyMislink33Assert(t, rows, map[string]string{"ProShares UltraPro Dow 30": "S000024918"})
		})
	})
	t.Run("KraneShares", func(t *testing.T) {
		rows := familyMislink32Dispatch(t, "krane2022_carbon_transformation_late_name.npx", "cikdict_krane.tsv", "htmltable", "0001547576", "20220630", 30)
		t.Run("CarbonTransformationMustBlank", func(t *testing.T) {
			familyMislink33Assert(t, rows, map[string]string{"KraneShares Global Carbon Transformation ETF": ""})
		})
		t.Run("ExactSiblingMustHold", func(t *testing.T) {
			familyMislink33Assert(t, rows, map[string]string{"KraneShares Global Carbon Strategy ETF": "S000066286"})
		})
	})
	t.Run("LegitimateRepeatedAccountsMustHold", func(t *testing.T) {
		// Real VALIC 2005 account banners decorate the same Asset Allocation
		// fund; neither is a dictionary name of the other series, Small Cap.
		rows := cc1Rows(t, "valic_asset", "0000719423", "pvtext", []SeriesDecl{
			{SeriesID: "S000007994", Name: "Asset Allocation Fund"},
			{SeriesID: "S000008006", Name: "Small Cap Fund"},
		})
		familyMislink33Assert(t, rows, map[string]string{
			"F446 VALIC I Asset Allocation F446": "S000007994",
			"F447 VALIC I Asset Allocation":      "S000007994",
		})
	})
}
