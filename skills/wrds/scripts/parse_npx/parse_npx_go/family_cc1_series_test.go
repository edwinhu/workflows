package main

import (
	"path/filepath"
	"testing"
)

func cc1Rows(t *testing.T, fixture, cik, layout string, decls []SeriesDecl) []VoteRow {
	t.Helper()
	savedD, savedM := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedD, savedM })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{cik: decls}}
	seriesMap = nil
	sink := &rowSink{}
	m := processFile(fixture+".txt", filepath.Join("testdata", "family_cc1", fixture+".txt"), sink, make([]byte, headBytes))
	wantRows := map[string]int{"valic_asset": 6, "valic_sleeve": 10, "valic_reference": 10, "clearwater_outer": 3, "clearwater_eagle": 3}[fixture]
	if m.ParseStatus != "ok" || m.Layout != layout || len(sink.buf) != wantRows {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", m.ParseStatus, m.Layout, len(sink.buf), m.ErrorMsg)
	}
	return sink.buf
}

// 000071/719423/0000950129-05-008752.txt: 11-18, 25-26, 63-69,
// 1566-1574, 2820-2828 (35 verbatim lines).
func TestFamilyCC1VALICAssetAccountDecoration(t *testing.T) {
	rows := cc1Rows(t, "valic_asset", "0000719423", "pvtext", []SeriesDecl{{SeriesID: "S000007994", Name: "Asset Allocation Fund"}, {SeriesID: "S000008006", Name: "Small Cap Fund"}})
	for _, r := range rows {
		if r.CUSIP == "" || r.MeetingDate == "" {
			t.Fatal("fixture missing security or date")
		}
		if r.SeriesID != "S000007994" {
			t.Errorf("fund=%q CUSIP=%s series=%q want S000007994", r.FundName, r.CUSIP, r.SeriesID)
		}
	}
}

// Same VALIC filing: 11-18, 25-26, 63-69, 11067-11076,
// 13218-13228 (38 verbatim lines).
func TestFamilyCC1VALICNumberedSleeve(t *testing.T) {
	rows := cc1Rows(t, "valic_sleeve", "0000719423", "pvtext", []SeriesDecl{{SeriesID: "S000008004", Name: "Science & Technology Fund"}, {SeriesID: "S000007999", Name: "Large Capital Growth Fund"}})
	for _, r := range rows {
		want := "S000008004"
		if r.FundName == "F442 VCI Large Capital Growth-2" {
			want = "S000007999"
		}
		if r.CUSIP == "" || r.MeetingDate == "" {
			t.Fatal("fixture missing security or date")
		}
		if r.SeriesID != want {
			t.Errorf("fund=%q CUSIP=%s series=%q want %s", r.FundName, r.CUSIP, r.SeriesID, want)
		}
	}
}

// Same VALIC filing: 11-18, 25-26, 63-69, 14049-14057,
// 15943-15951, 17586-17595 (45 verbatim lines).
func TestFamilyCC1VALICAccountReference(t *testing.T) {
	rows := cc1Rows(t, "valic_reference", "0000719423", "pvtext", []SeriesDecl{{SeriesID: "S000008006", Name: "Small Cap Fund"}, {SeriesID: "S000007994", Name: "Asset Allocation Fund"}})
	for _, r := range rows {
		if r.CUSIP == "" || r.MeetingDate == "" {
			t.Fatal("fixture missing security or date")
		}
		if r.SeriesID != "S000008006" {
			t.Errorf("fund=%q CUSIP=%s series=%q want S000008006", r.FundName, r.CUSIP, r.SeriesID)
		}
	}
}

// 000081/811161/0000897101-11-001772.txt: both use 2, 5, 15-16, 81-83, 87.
// Growth: 151, 788, 798-866 (79 verbatim lines).
// International: 271960-271963, 271972-271990, 271997-272005,
// 272013-272049 (77 verbatim lines). Three vote rows confirm the HTML header.
func TestFamilyCC1ClearwaterOuterSectionAuthority(t *testing.T) {
	for _, tc := range []struct{ fixture, want string }{{"clearwater_outer", "S000000697"}, {"clearwater_eagle", "S000024756"}} {
		t.Run(tc.fixture, func(t *testing.T) {
			rows := cc1Rows(t, tc.fixture, "0000811161", "htmltable", []SeriesDecl{{SeriesID: "S000000697", Name: "Clearwater Growth Fund"}, {SeriesID: "S000000698", Name: "Clearwater Small Cap Fund"}, {SeriesID: "S000000699", Name: "Clearwater Tax-Exempt Bond Fund"}, {SeriesID: "S000024756", Name: "CLEARWATER INTERNATIONAL FUND"}})
			for _, r := range rows {
				if (r.CUSIP == "" && r.ISIN == "") || r.MeetingDate == "" {
					t.Fatalf("fixture missing security or date: %+v", r)
				}
				if r.SeriesID != tc.want {
					t.Errorf("fund=%q issuer=%q series=%q want %s", r.FundName, r.IssuerName, r.SeriesID, tc.want)
				}
			}
		})
	}
}
