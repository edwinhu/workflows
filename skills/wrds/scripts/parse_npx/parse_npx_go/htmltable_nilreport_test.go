package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Two shapes that keep real HTML filings in parse_status=skip for reasons that
// are not "we cannot read this". Both fixtures are VERBATIM excerpts of filings
// taken from the 6,709 HTML documents still skipped after the htmltable layout
// landed.
//
// Measured on a 40-filing local sample of that residue: 24 have no table row
// wider than two cells. Of those, 5 state in plain language that the fund had no
// proxy voting activity and 8 are cover pages carrying no vote vocabulary at all.
// So a large part of what remains is not unparsed data -- it is filings with no
// votes in them, sitting in the wrong manifest status.
//
// THE DISTINCTION THE MANIFEST EXISTS TO CARRY. README: `ok` with n_rows=0 is a
// legitimate outcome and is how "the fund had nothing to vote" is recorded -- the
// N-PX analogue of 13F-NT. `skip` means NO LAYOUT MATCHED, i.e. we may have lost
// data. Filing a nil report as `skip` overstates the loss and hides real gaps
// behind noise; it is the same error in the other direction as reporting a parse
// failure as success.

// runISSNPXDocStatus drives the whole binary like runISSNPXDoc and additionally
// returns the manifest's parse_status, because the distinction this file tests --
// ok/0-rows versus skip -- lives in the manifest and not in the votes file.
func runISSNPXDocStatus(t *testing.T, doc string) ([][]string, string) {
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
	status := ""
	for _, ln := range strings.Split(strings.TrimRight(readGz(t, manPath), "\n"), "\n") {
		if strings.TrimSpace(ln) == "" {
			continue
		}
		f := strings.Split(ln, "\t")
		if len(f) > 10 {
			status = f[10]
		}
	}
	return rows, status
}

func loadNil(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(b)
}

// TestHTMLNilReportIsOkNotSkip: the fixture says "There is no proxy voting
// activity for the Fund, as the Fund did not hold..." in an HTML document with no
// vote table. That is a nil report and belongs in ok/0 rows.
func TestHTMLNilReportIsOkNotSkip(t *testing.T) {
	rows, status := runISSNPXDocStatus(t, loadNil(t, "H4_no_activity.txt"))
	if len(rows) != 0 {
		t.Fatalf("nil report produced %d vote rows, want 0 -- the filing states the fund"+
			" held no voting securities", len(rows))
	}
	if status != "ok" {
		t.Errorf("parse_status = %q, want \"ok\" -- a fund reporting no proxy voting activity"+
			" is a real and common outcome, and recording it as %q claims we failed to read a"+
			" filing that has nothing in it to read", status, status)
	}
}

// TestHTMLRepeatingHeaderIsAHeader: this filing carries a clean Shu-A.2 header
// (`Proposal No | Proposal | Proposed By | Management Recommendation | Vote Cast`)
// followed by exactly ONE proposal row, and repeats that pair per meeting. The
// header test requires at least three following rows of comparable arity, so a
// genuine header is rejected and the whole filing is skipped.
//
// The fix must not be to drop the follow-row requirement, which is what stops a
// data row being read as a header. An IDENTICAL header tuple recurring in the
// document is stronger evidence than three following rows: a data row does not
// repeat itself verbatim, and a one-proposal meeting is a normal filing shape --
// a written consent with a single item.
func TestHTMLRepeatingHeaderIsAHeader(t *testing.T) {
	rows := runISSNPXDoc(t, loadNil(t, "H3_repeating_header.txt"))
	if len(rows) == 0 {
		t.Fatalf("produced 0 rows: the fixture repeats a Proposal No / Proposal / Proposed By /" +
			" Management Recommendation / Vote Cast header with one proposal under each," +
			" and the >=3-following-rows rule rejects it")
	}
	for i, r := range rows {
		if got := r[colHowVoted]; got == "" {
			t.Errorf("row %d has an empty how_voted", i)
		}
		if got := r[colCUSIP]; got == "" {
			t.Errorf("row %d has no CUSIP; each block carries its own Security ID line", i)
		}
	}
}
