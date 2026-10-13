package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// series_id is the link key from N-PX to the ISS fundid, and it is the binding
// constraint on the whole panel. The XML era carries it on 88.8% of rows, but
// the legacy text layouts stamp it on 6.6% (issnpx) and 6.3% (broadridge),
// which caps the N-PX-to-ISS link at 24.0% of parsed rows.
//
// The chassis stamps series_id only when a filing covers exactly ONE series
// (main.go), and an N-PX registrant files for dozens at once, so a multi-series
// legacy filing gets nothing. But the information is already present on both
// sides:
//
//   - the SGML header carries a <SERIES-ID>/<SERIES-NAME> pair per series;
//   - the issnpx grammar prints a per-fund heading inside the body, delimited by
//     rules of '=', and the layout already captures it -- fund_name is
//     non-empty on 97.4% of its 166,205,915 rows, across 22,110 distinct names.
//
// Nothing joins the two. Measured over the parsed corpus against the header
// triples of all 20,107 issnpx filings, a plain normalised name match attributes
// 106,619,563 rows -- 65.9% of issnpx rows carrying a fund_name, against the
// 6.6% stamped today.
//
// Two things block it in the code:
//
//  1. parseSeriesClasses (header.go) recognises SERIES-ID, CLASS-CONTRACT-ID and
//     CLASS-CONTRACT-TICKER-SYMBOL and nothing else; SERIES-NAME is never
//     captured. It also appends one triple per CLASS-CONTRACT-ID, so a series
//     declaring no class contract vanishes from the output entirely.
//  2. No layout parser sets SeriesID at all.
//
// A stamped series_id is a link key: a wrong one silently attributes a fund's
// votes to another fund, which is worse than leaving it blank. So the match must
// be unambiguous, and anything less than a confident match must stamp nothing.

// issnpxSeriesHeader builds an SGML header carrying the given series, each as an
// (id, name, classID) triple, in the shape the real filings use -- verified
// against 000000/2110/0001104659-08-053632.txt.
func issnpxSeriesHeader(accession string, series [][3]string) string {
	var b strings.Builder
	b.WriteString("<SEC-DOCUMENT>" + accession + ".txt : 20080630\n")
	b.WriteString("<SEC-HEADER>" + accession + ".hdr.sgml : 20080630\n")
	b.WriteString("ACCESSION NUMBER:\t\t" + accession + "\n")
	b.WriteString("CONFORMED SUBMISSION TYPE:\tN-PX\n")
	b.WriteString("CONFORMED PERIOD OF REPORT:\t20080630\n")
	b.WriteString("\tCOMPANY DATA:\n\t\tCENTRAL INDEX KEY:\t\t\t0000002110\n")
	b.WriteString("<SERIES-AND-CLASSES-CONTRACTS-DATA>\n<EXISTING-SERIES-AND-CLASSES-CONTRACTS>\n")
	for _, s := range series {
		b.WriteString("<SERIES>\n<OWNER-CIK>0000002110\n")
		b.WriteString("<SERIES-ID>" + s[0] + "\n")
		b.WriteString("<SERIES-NAME>" + s[1] + "\n")
		if s[2] != "" {
			b.WriteString("<CLASS-CONTRACT>\n<CLASS-CONTRACT-ID>" + s[2] + "\n")
			b.WriteString("<CLASS-CONTRACT-NAME>" + s[1] + " Class A\n</CLASS-CONTRACT>\n")
		}
		b.WriteString("</SERIES>\n")
	}
	b.WriteString("</EXISTING-SERIES-AND-CLASSES-CONTRACTS>\n</SERIES-AND-CLASSES-CONTRACTS-DATA>\n")
	b.WriteString("</SEC-HEADER>\n")
	return b.String()
}

// issnpxFundSection is one fund block of the ISS grammar: an '=' rule carrying
// the fund name, then one issuer with one proposal.
func issnpxFundSection(fundName, issuer, cusip string) string {
	return "\n=================== " + fundName + " ===================\n\n" +
		issuer + "\n\n" +
		"Ticker: XYZ           Security ID: " + cusip + "\n" +
		"Meeting Date: FEB 28, 2008         Meeting Type: Annual\n" +
		"Record Date: DEC 30, 2007\n\n" +
		"#     Proposal                                    Mgt Rec     Vote Cast   Sponsor\n" +
		"1.1   Elect Director Jane Doe                     For         For         Management\n"
}

func issnpxSeriesDoc(series [][3]string, sections string) string {
	body := "                        ******* FORM N-Px REPORT *******\n\n" +
		"ICA File Number: 811-01829\n" +
		"Reporting Period: 07/01/2007 - 06/30/2008\n" +
		"Columbia Acorn Trust\n" + sections
	return issnpxSeriesHeader("0001104659-08-053632", series) +
		"<DOCUMENT>\n<TYPE>N-PX\n<SEQUENCE>1\n<FILENAME>report.txt\n<TEXT>\n" +
		body + "\n</TEXT>\n</DOCUMENT>\n"
}

// runISSNPXDoc drives the whole binary the way the grid does and returns the
// votes rows as field slices.
func runISSNPXDoc(t *testing.T, doc string) [][]string {
	t.Helper()
	base := t.TempDir()
	root := filepath.Join(base, "archives")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "iss.txt"), []byte(doc), 0o644); err != nil {
		t.Fatal(err)
	}
	listPath := filepath.Join(base, "files.txt")
	if err := os.WriteFile(listPath, []byte("iss.txt\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	bin := buildBinary(t)
	votesPath := filepath.Join(base, "votes.tsv.gz")
	manPath := filepath.Join(base, "manifest.tsv.gz")
	_, stderr, code := runBinary(t, bin, "-files-from", listPath, "-archive-root", root,
		"-out", votesPath, "-manifest", manPath)
	if code != 0 {
		t.Fatalf("run exited %d: %s", code, stderr)
	}
	var rows [][]string
	for _, ln := range strings.Split(strings.TrimRight(readGz(t, votesPath), "\n"), "\n") {
		if strings.TrimSpace(ln) == "" {
			continue
		}
		rows = append(rows, strings.Split(ln, "\t"))
	}
	return rows
}

// votes.tsv column order (README "Output schemas"): filepath, accession, cik,
// period_of_report, filed_date, form_type, registrant_name, series_id,
// class_ids, fund_name, ...
const (
	colSeriesID = 7
	colFundName = 9
)

func TestISSNPXStampsSeriesFromFundHeading(t *testing.T) {
	series := [][3]string{
		{"S000009184", "Columbia Acorn Fund", "C000024954"},
		{"S000009185", "Columbia Acorn International", "C000024958"},
	}
	doc := issnpxSeriesDoc(series,
		issnpxFundSection("COLUMBIA ACORN FUND", "APPLE INC.", "037833100")+
			issnpxFundSection("COLUMBIA ACORN INTERNATIONAL", "MICROSOFT CORP", "594918104"))

	rows := runISSNPXDoc(t, doc)
	if len(rows) != 2 {
		t.Fatalf("emitted %d rows, want 2 (one per fund section)", len(rows))
	}

	want := map[string]string{
		"COLUMBIA ACORN FUND":          "S000009184",
		"COLUMBIA ACORN INTERNATIONAL": "S000009185",
	}
	for i, r := range rows {
		fund := strings.ToUpper(strings.TrimSpace(r[colFundName]))
		wantID, ok := want[fund]
		if !ok {
			t.Fatalf("row %d: unexpected fund_name %q", i, r[colFundName])
		}
		if got := r[colSeriesID]; got != wantID {
			t.Errorf("row %d (%s): series_id = %q, want %q -- the header declares this"+
				" series by name and the body heading names the same fund",
				i, fund, got, wantID)
		}
	}
}

// TestISSNPXSeriesMatchIsCaseAndPunctuationInsensitive covers the shape the
// corpus actually shows: the body heading is uppercased and the registered-mark
// glyphs differ, e.g. header "SPDR(R) S&P(R) China ETF" against body
// "SPDR S&P CHINA ETF".
func TestISSNPXSeriesMatchIsCaseAndPunctuationInsensitive(t *testing.T) {
	series := [][3]string{{"S000011111", "SPDR(R) S&P(R) China ETF", "C000011111"}}
	doc := issnpxSeriesDoc(series, issnpxFundSection("SPDR S&P CHINA ETF", "APPLE INC.", "037833100"))

	rows := runISSNPXDoc(t, doc)
	if len(rows) != 1 {
		t.Fatalf("emitted %d rows, want 1", len(rows))
	}
	if got := rows[0][colSeriesID]; got != "S000011111" {
		t.Errorf("series_id = %q, want %q -- the match must survive case and the"+
			" registered-mark punctuation the header carries", got, "S000011111")
	}
}

// TestISSNPXSeriesIsBlankWhenNotConfident is the guard, and it matters more than
// the coverage: a stamped series_id is a LINK KEY, so a wrong one attributes a
// fund's votes to a different fund in the ISS panel. Silence beats a guess.
func TestISSNPXSeriesIsBlankWhenNotConfident(t *testing.T) {
	// NOTE: a filing covering exactly ONE series is stamped by the chassis
	// regardless of what the body heading says, and that is correct -- every vote
	// in a single-series filing belongs to that series. So these cases declare
	// TWO series, where the chassis stamps nothing and the attribution is the
	// only thing that could fill the column.
	t.Run("a heading matching no series stamps nothing", func(t *testing.T) {
		series := [][3]string{
			{"S000009184", "Columbia Acorn Fund", "C000024954"},
			{"S000009185", "Columbia Acorn International", "C000024958"},
		}
		doc := issnpxSeriesDoc(series,
			issnpxFundSection("SOME ENTIRELY DIFFERENT FUND", "APPLE INC.", "037833100"))
		rows := runISSNPXDoc(t, doc)
		if len(rows) != 1 {
			t.Fatalf("emitted %d rows, want 1", len(rows))
		}
		if got := rows[0][colSeriesID]; got != "" {
			t.Errorf("series_id = %q, want empty -- the body names a fund the header"+
				" does not declare, and a link key must never be guessed", got)
		}
	})

	t.Run("an ambiguous heading stamps nothing", func(t *testing.T) {
		// Two series whose names normalise to the same string. Nothing can tell
		// them apart, so neither may be stamped.
		series := [][3]string{
			{"S000022221", "Growth Fund", "C000022221"},
			{"S000022222", "GROWTH FUND", "C000022222"},
		}
		doc := issnpxSeriesDoc(series, issnpxFundSection("GROWTH FUND", "APPLE INC.", "037833100"))
		rows := runISSNPXDoc(t, doc)
		if len(rows) != 1 {
			t.Fatalf("emitted %d rows, want 1", len(rows))
		}
		if got := rows[0][colSeriesID]; got != "" {
			t.Errorf("series_id = %q, want empty -- two series in this filing carry the"+
				" same normalised name, so the attribution is ambiguous", got)
		}
	})
}

// TestISSNPXSeriesWithNoClassContract pins the header defect the fix depends
// on: parseSeriesClasses emits one triple per CLASS-CONTRACT-ID, so a series
// declaring no class contract disappears along with its id and name.
func TestISSNPXSeriesWithNoClassContract(t *testing.T) {
	// Three series so that losing one still leaves more than one, keeping the
	// chassis single-series stamp out of the picture -- otherwise this test
	// passes for the wrong reason.
	series := [][3]string{
		{"S000033331", "Classless Series Fund", ""}, // no <CLASS-CONTRACT> block
		{"S000033332", "Ordinary Fund", "C000033332"},
		{"S000033333", "Another Ordinary Fund", "C000033333"},
	}
	doc := issnpxSeriesDoc(series,
		issnpxFundSection("CLASSLESS SERIES FUND", "APPLE INC.", "037833100"))
	rows := runISSNPXDoc(t, doc)
	if len(rows) != 1 {
		t.Fatalf("emitted %d rows, want 1", len(rows))
	}
	if got := rows[0][colSeriesID]; got != "S000033331" {
		t.Errorf("series_id = %q, want %q -- a series that declares no class contract"+
			" must still be available for attribution", got, "S000033331")
	}
}

// TestISSNPXClassIDsBelongToTheRowsOwnSeries closes the hole the attribution
// opened. main.go computes one class-id string for the filing from the CHASSIS
// series (classIDsFor(sc, seriesRow)) and backfills it onto any row whose own
// ClassIDs is empty, without checking that the row's series_id is that series.
//
// Before attribution existed this was harmless: only single-series filings were
// stamped, so there was only one series the classes could belong to. Now the
// layout stamps per-fund, and a row carrying series A can be handed series B's
// class contracts. class_ids and series_id then disagree on the same row, and
// both are link keys.
//
// Observed on the current tree, two series where the first declares no class
// contract:
//
//	row 0 fund="CLASSLESS FUND" series_id="S000044441" class_ids="C000044442"
//	row 1 fund="ORDINARY FUND"  series_id="S000044442" class_ids="C000044442"
//
// Row 0 asserts one series and carries the other's class. An empty class_ids is
// correct there: that series really has no class contracts.
func TestISSNPXClassIDsBelongToTheRowsOwnSeries(t *testing.T) {
	series := [][3]string{
		{"S000044441", "Classless Fund", ""}, // declares no <CLASS-CONTRACT>
		{"S000044442", "Ordinary Fund", "C000044442"},
	}
	doc := issnpxSeriesDoc(series,
		issnpxFundSection("CLASSLESS FUND", "APPLE INC.", "037833100")+
			issnpxFundSection("ORDINARY FUND", "MICROSOFT CORP", "594918104"))

	rows := runISSNPXDoc(t, doc)
	if len(rows) != 2 {
		t.Fatalf("emitted %d rows, want 2", len(rows))
	}

	const colClassIDs = 8
	want := map[string]struct{ series, classes string }{
		"CLASSLESS FUND": {"S000044441", ""},
		"ORDINARY FUND":  {"S000044442", "C000044442"},
	}
	for i, r := range rows {
		fund := strings.ToUpper(strings.TrimSpace(r[colFundName]))
		w, ok := want[fund]
		if !ok {
			t.Fatalf("row %d: unexpected fund_name %q", i, r[colFundName])
		}
		if got := r[colSeriesID]; got != w.series {
			t.Errorf("row %d (%s): series_id = %q, want %q", i, fund, got, w.series)
		}
		if got := r[colClassIDs]; got != w.classes {
			t.Errorf("row %d (%s): class_ids = %q, want %q -- class contracts must belong"+
				" to the series this row names, and an empty string is correct for a"+
				" series that declares none; carrying another series' classes makes"+
				" series_id and class_ids disagree on one row", i, fund, got, w.classes)
		}
	}
}
