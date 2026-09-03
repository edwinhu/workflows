package main

import (
	"os"
	"path/filepath"
	"testing"
)

// EDGAR headers carry no <SERIES-ID> tags before 2006, so a 2004-2005 N-PX
// declares nothing and every row it holds is unattributable by the header alone.
// A per-registrant dictionary built from the SAME CIK's later filings supplies
// the ids the header would have declared; the layouts then resolve headings
// against it under the ordinary rules. It applies only when the header declares
// no series -- a header that declares any is the authority for that filing.
func TestCIKSeriesDictionaryBacksAnUndeclaredHeader(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "cik_series.tsv")
	body := "778207\tS000000001\tAEGON BOND\t20070630\t000077/778207/x.txt\n" +
		"778207\tS000000002\tAMERICAN CENTURY INTERNATIONAL\t20070630\t000077/778207/x.txt\n" +
		"778207\tS000000002\tTA AMERICAN CENTURY INTERNATIONAL\t20090630\t000077/778207/y.txt\n" +
		"999999\tS000000009\tOTHER FUND\t20070630\t000099/999999/z.txt\n"
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	dict, err := loadCIKSeries(p)
	if err != nil {
		t.Fatal(err)
	}

	meta := FilingMeta{CIK: "778207"}
	dict.back(&meta)
	if len(meta.SeriesDecls) != 3 {
		t.Fatalf("undeclared header, known CIK: want 3 dictionary decls, got %+v", meta.SeriesDecls)
	}
	if meta.SeriesDecls[1].SeriesID != "S000000002" || meta.SeriesDecls[1].Name != "AMERICAN CENTURY INTERNATIONAL" {
		t.Fatalf("decl order and fields must follow the file: %+v", meta.SeriesDecls[1])
	}

	meta = FilingMeta{CIK: "778207", SeriesDecls: []SeriesDecl{{SeriesID: "S000000005", Name: "DECLARED"}}}
	dict.back(&meta)
	if len(meta.SeriesDecls) != 1 || meta.SeriesDecls[0].SeriesID != "S000000005" {
		t.Fatalf("a header that declares series is the authority: got %+v", meta.SeriesDecls)
	}

	meta = FilingMeta{CIK: "123"}
	dict.back(&meta)
	if len(meta.SeriesDecls) != 0 {
		t.Fatalf("unknown CIK must stay undeclared: got %+v", meta.SeriesDecls)
	}

	var none *cikSeries
	meta = FilingMeta{CIK: "778207"}
	none.back(&meta)
	if len(meta.SeriesDecls) != 0 {
		t.Fatalf("no dictionary loaded must be a no-op: got %+v", meta.SeriesDecls)
	}
}
