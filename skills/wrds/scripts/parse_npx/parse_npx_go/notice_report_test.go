package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A modern N-PX filing may be a NOTICE REPORT: the filer declares it had no
// votes to report, or that another filer reports them. Such a filing carries a
// primary_doc.xml and NO PROXY VOTING RECORD document, by design. It is the
// N-PX analogue of 13F-NT, and README.md ("Vocabularies") requires it to land
// parse_status=ok with n_rows=0 -- not parse_status=error.
//
// Measured over the 90,661-filing corpus (docs/investigations/
// 2026-08-27_parse-npx-vs-iss.md): 15,181 filings returned the error
// "no <DOCUMENT> with <TYPE>PROXY VOTING RECORD found", and reading the
// reportType element out of every one of them on the grid found
//
//	INSTITUTIONAL MANAGER NOTICE REPORT        12,307
//	FUND NOTICE REPORT                          2,832
//	(no reportType element)                        39
//	FUND VOTING REPORT                              2
//	INSTITUTIONAL MANAGER COMBINATION REPORT        1
//
// so 15,139 of 15,181 (99.72%) are notices. The manifest therefore advertises a
// 17.0% filing-level failure rate for a corpus whose real failure rate is 243
// filings, or 0.27%, and the 42 genuinely anomalous filings are invisible
// inside the 15,181.
//
// Detection must be POSITIVE -- read from reportType -- and never inferred from
// the absence of a vote table. A vote table that is missing, misnamed or
// unreachable on a filing that does NOT declare itself a notice is still an
// error, and the two must stay apart. TestNoticeReportRequiresPositiveDeclaration
// below is what holds that line.

// noticePrimaryDoc builds a primary_doc.xml carrying the given reportType in
// the place the SEC schema puts it: formData/coverPage/reportInfo/reportType.
// Verified against the real filing 000079/793597/0000088053-24-000859.txt.
func noticePrimaryDoc(reportType string) string {
	return `<DOCUMENT>
<TYPE>N-PX
<SEQUENCE>1
<FILENAME>primary_doc.xml
<TEXT>
<XML>
<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission>
<headerData>
<filerInfo>
<periodOfReport>06/30/2024</periodOfReport>
</filerInfo>
<seriesClass>
<seriesId>S000005466</seriesId>
<classId>C000014875</classId>
</seriesClass>
</headerData>
<formData>
<coverPage>
<yearOrQuarter>YEAR</yearOrQuarter>
<reportCalendarYear>2024</reportCalendarYear>
<reportInfo>
<reportType>` + reportType + `</reportType>
</reportInfo>
</coverPage>
</formData>
</edgarSubmission>
</XML>
</TEXT>
</DOCUMENT>
`
}

// TestNoticeReportIsOkWithZeroRows is the defect. Both spellings the corpus
// actually carries must parse clean.
func TestNoticeReportIsOkWithZeroRows(t *testing.T) {
	for _, reportType := range []string{
		"FUND NOTICE REPORT",
		"INSTITUTIONAL MANAGER NOTICE REPORT",
	} {
		t.Run(reportType, func(t *testing.T) {
			meta := FilingMeta{FilePath: "x"}
			n, err := parseNPXXML(
				strings.NewReader(npxSGMLHead+noticePrimaryDoc(reportType)),
				&meta, func(VoteRow) error { return nil })
			if err != nil {
				t.Fatalf("a %s parsed as an error: %v", reportType, err)
			}
			if n != 0 {
				t.Fatalf("a notice report yielded %d rows, want 0", n)
			}
			if meta.ParseMode != "xml" {
				t.Errorf("parse_mode = %q, want %q", meta.ParseMode, "xml")
			}
		})
	}
}

// TestNoticeReportRequiresPositiveDeclaration is the guard against the fix
// degenerating into "no vote table means ok". A filing that declares a
// reporting type OTHER than a notice, or declares nothing at all, and still has
// no vote table, is a real failure and must keep saying so -- otherwise the fix
// destroys the very distinction the manifest exists to preserve, which is what
// the doc comment on parseNPXXML has always said.
func TestNoticeReportRequiresPositiveDeclaration(t *testing.T) {
	cases := []struct {
		name string
		doc  string
	}{
		{"no reportType element at all", npxPrimaryDoc},
		{"FUND VOTING REPORT", noticePrimaryDoc("FUND VOTING REPORT")},
		{"INSTITUTIONAL MANAGER COMBINATION REPORT",
			noticePrimaryDoc("INSTITUTIONAL MANAGER COMBINATION REPORT")},
		{"INSTITUTIONAL MANAGER VOTING REPORT",
			noticePrimaryDoc("INSTITUTIONAL MANAGER VOTING REPORT")},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			meta := FilingMeta{FilePath: "x"}
			n, err := parseNPXXML(strings.NewReader(npxSGMLHead+c.doc),
				&meta, func(VoteRow) error { return nil })
			if err == nil {
				t.Fatalf("a non-notice filing with no vote table parsed clean, yielding %d rows;"+
					" absence of a vote table must never on its own mean ok", n)
			}
		})
	}
}

// TestNoticeReportManifestRow is the same fact at the grain the user actually
// reads: one row of manifest.tsv.gz, produced by the binary the grid runs.
// The unit tests above prove parseNPXXML's return; this proves the manifest
// column a coverage query would group by.
func TestNoticeReportManifestRow(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "archives")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}

	files := map[string]string{
		"notice_fund.txt": npxSGMLHead + noticePrimaryDoc("FUND NOTICE REPORT"),
		"notice_im.txt":   npxSGMLHead + noticePrimaryDoc("INSTITUTIONAL MANAGER NOTICE REPORT"),
		// Still an error: no positive notice declaration.
		"novotes.txt": npxSGMLHead + npxPrimaryDoc,
	}
	var names []string
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(root, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	listPath := filepath.Join(base, "files.txt")
	if err := os.WriteFile(listPath, []byte(strings.Join(names, "\n")+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	bin := buildBinary(t)
	votesPath := filepath.Join(base, "votes.tsv.gz")
	manPath := filepath.Join(base, "manifest.tsv.gz")
	_, stderr, code := runBinary(t, bin,
		"-files-from", listPath, "-archive-root", root,
		"-out", votesPath, "-manifest", manPath)
	if code != 0 {
		t.Fatalf("run exited %d: %s", code, stderr)
	}
	manifest := readGz(t, manPath)

	want := []struct{ name, status, mode, nRows string }{
		{"notice_fund.txt", "ok", "xml", "0"},
		{"notice_im.txt", "ok", "xml", "0"},
		{"novotes.txt", "error", "xml", "0"},
	}
	for _, w := range want {
		row := manifestRow(t, manifest, w.name)
		if got := manifestField(t, row, "parse_status"); got != w.status {
			t.Errorf("%s: parse_status = %q, want %q (%s)", w.name, got, w.status,
				manifestField(t, row, "error_msg"))
		}
		if got := manifestField(t, row, "parse_mode"); got != w.mode {
			t.Errorf("%s: parse_mode = %q, want %q", w.name, got, w.mode)
		}
		if got := manifestField(t, row, "n_rows"); got != w.nRows {
			t.Errorf("%s: n_rows = %q, want %q", w.name, got, w.nRows)
		}
		if w.status == "ok" {
			if got := manifestField(t, row, "error_msg"); strings.TrimSpace(got) != "" {
				t.Errorf("%s: parse_status=ok carrying error_msg %q", w.name, got)
			}
		}
	}
}
