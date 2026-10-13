package main

import (
	"path/filepath"
	"testing"
)

// 000074/745968/0001056288-04-000553.txt: 26; 109-160 (53 verbatim
// lines). The account label prefixes the dictionary fund name with FCAF.
func TestFamilyW1FederatedAccountCodeHeading(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{
		"0000745968": {
			{SeriesID: "S000009728", Name: "Federated Capital Appreciation Fund"},
			{SeriesID: "S000009729", Name: "Federated Kaufmann Fund"},
		},
	}}
	seriesMap = nil
	sink := &rowSink{}
	fixture := "federated_account_code.txt"
	meta := processFile(fixture, filepath.Join("testdata", "family_w1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0000745968" || len(sink.buf) != 3 {
		t.Fatalf("fixture/dispatch precondition: CIK=%q layout=%q status=%q rows=%d error=%q", meta.CIK, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	for _, row := range sink.buf {
		if row.IssuerName != "3M Co" || row.CUSIP != "88579Y101" || row.MeetingDate != "20040511" {
			t.Fatalf("identity precondition: issuer=%q CUSIP=%q date=%q", row.IssuerName, row.CUSIP, row.MeetingDate)
		}
		if row.SeriesID != "S000009728" {
			t.Errorf("Account Number: FCAF Federated Capital Appreciation Fund: item %s series=%q fund=%q, want S000009728", row.ItemSeq, row.SeriesID, row.FundName)
		}
	}
}
