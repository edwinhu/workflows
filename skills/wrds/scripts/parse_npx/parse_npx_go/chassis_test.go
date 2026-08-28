package main

import (
	"bytes"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// A real N-PX dissemination header: one registrant, two series, three
// class-contract triples, with the second series pushed well past the first
// 4 KB so a head-capped or first-match-only reader cannot pass.
func multiSeriesHeader() []byte {
	var b strings.Builder
	b.WriteString(`<SEC-DOCUMENT>0001104659-25-083794.txt : 20250630
<SEC-HEADER>0001104659-25-083794.hdr.sgml : 20250630
ACCESSION NUMBER:		0001104659-25-083794
CONFORMED SUBMISSION TYPE:	N-PX
PUBLIC DOCUMENT COUNT:		2
CONFORMED PERIOD OF REPORT:	20250630
FILED AS OF DATE:		20250825
FILER:
	COMPANY DATA:
		COMPANY CONFORMED NAME:			VANGUARD INDEX FUNDS
		CENTRAL INDEX KEY:			0000036405
		IRS NUMBER:				232839139
<SERIES-AND-CLASSES-CONTRACTS-DATA>
<EXISTING-SERIES-AND-CLASSES-CONTRACTS>
<SERIES>
<OWNER-CIK>0000036405</OWNER-CIK>
<SERIES-ID>S000002841</SERIES-ID>
<SERIES-NAME>Vanguard 500 Index Fund</SERIES-NAME>
<CLASS-CONTRACT>
<CLASS-CONTRACT-ID>C000007786</CLASS-CONTRACT-ID>
<CLASS-CONTRACT-NAME>Investor Shares</CLASS-CONTRACT-NAME>
<CLASS-CONTRACT-TICKER-SYMBOL>VFINX</CLASS-CONTRACT-TICKER-SYMBOL>
</CLASS-CONTRACT>
<CLASS-CONTRACT>
<CLASS-CONTRACT-ID>C000007787</CLASS-CONTRACT-ID>
<CLASS-CONTRACT-NAME>Admiral Shares</CLASS-CONTRACT-NAME>
<CLASS-CONTRACT-TICKER-SYMBOL>VFIAX</CLASS-CONTRACT-TICKER-SYMBOL>
</CLASS-CONTRACT>
</SERIES>
`)
	// Filler standing in for the dozens of series a real registrant carries.
	for i := 0; i < 120; i++ {
		b.WriteString("		FORMER COMPANY:				VANGUARD INDEX TRUST FILLER LINE\n")
	}
	b.WriteString(`<SERIES>
<OWNER-CIK>0000036405</OWNER-CIK>
<SERIES-ID>S000002845</SERIES-ID>
<SERIES-NAME>Vanguard Total Stock Market Index Fund</SERIES-NAME>
<CLASS-CONTRACT>
<CLASS-CONTRACT-ID>C000007806</CLASS-CONTRACT-ID>
<CLASS-CONTRACT-NAME>ETF Shares</CLASS-CONTRACT-NAME>
<CLASS-CONTRACT-TICKER-SYMBOL>VTI</CLASS-CONTRACT-TICKER-SYMBOL>
</CLASS-CONTRACT>
</SERIES>
</EXISTING-SERIES-AND-CLASSES-CONTRACTS>
</SERIES-AND-CLASSES-CONTRACTS-DATA>
</SEC-HEADER>
`)
	return []byte(b.String())
}

func buildBinary(t *testing.T) string {
	t.Helper()
	if _, err := exec.LookPath("go"); err != nil {
		t.Fatalf("go toolchain not on PATH: %v", err)
	}
	bin := filepath.Join(t.TempDir(), "parse_npx_go")
	cmd := exec.Command("go", "build", "-o", bin, ".")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("go build failed: %v\n%s", err, stderr.String())
	}
	return bin
}

func runBinary(t *testing.T, bin string, args ...string) (stdout, stderr string, code int) {
	t.Helper()
	cmd := exec.Command(bin, args...)
	var o, e bytes.Buffer
	cmd.Stdout = &o
	cmd.Stderr = &e
	err := cmd.Run()
	code = 0
	if err != nil {
		ee, ok := err.(*exec.ExitError)
		if !ok {
			t.Fatalf("running %s %v: %v", bin, args, err)
		}
		code = ee.ExitCode()
	}
	return o.String(), e.String(), code
}

func TestChassis(t *testing.T) {
	t.Run("missing required flags exit 2", func(t *testing.T) {
		bin := buildBinary(t)
		_, stderr, code := runBinary(t, bin)
		if code != 2 {
			t.Fatalf("no-flag invocation: exit code = %d, want 2 (stderr: %q)", code, stderr)
		}
		if strings.Contains(stderr, "panic:") {
			t.Fatalf("no-flag invocation panicked instead of reporting the missing flags:\n%s", stderr)
		}
		if !strings.Contains(stderr, "-files-from") {
			t.Fatalf("stderr must name the missing required flag -files-from, got:\n%s", stderr)
		}
	})

	t.Run("version flag", func(t *testing.T) {
		bin := buildBinary(t)
		stdout, stderr, code := runBinary(t, bin, "-version")
		if code != 0 {
			t.Fatalf("-version: exit code = %d, want 0 (stderr: %q)", code, stderr)
		}
		if !strings.Contains(stdout, "parse_npx") {
			t.Fatalf("-version stdout must name the program, got %q", stdout)
		}
	})

	t.Run("every series class ticker triple", func(t *testing.T) {
		got := parseSeriesClasses(multiSeriesHeader())
		want := []SeriesClass{
			{SeriesID: "S000002841", ClassID: "C000007786", Ticker: "VFINX"},
			{SeriesID: "S000002841", ClassID: "C000007787", Ticker: "VFIAX"},
			{SeriesID: "S000002845", ClassID: "C000007806", Ticker: "VTI"},
		}
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("parseSeriesClasses:\n got %+v\nwant %+v", got, want)
		}
	})

	t.Run("sgml header fields", func(t *testing.T) {
		m := parseHeader(multiSeriesHeader())
		for _, c := range []struct{ name, got, want string }{
			{"Accession", m.Accession, "0001104659-25-083794"},
			{"FormType", m.FormType, "N-PX"},
			{"PeriodOfReport", m.PeriodOfReport, "20250630"},
			{"FiledDate", m.FiledDate, "20250825"},
			{"CompanyName", m.CompanyName, "VANGUARD INDEX FUNDS"},
			{"CIK", m.CIK, "0000036405"},
		} {
			if c.got != c.want {
				t.Errorf("parseHeader %s = %q, want %q", c.name, c.got, c.want)
			}
		}
	})

	t.Run("sanitize scrubs tabs and newlines", func(t *testing.T) {
		if got, want := sanitize("a\tb\nc\rd"), "a b cd"; got != want {
			t.Fatalf("sanitize = %q, want %q", got, want)
		}
	})

	t.Run("vote row serializes in voteColumns order", func(t *testing.T) {
		// Each field is set to the name of the column it must occupy, so the
		// serialized line is the column order itself.
		var r VoteRow
		v := reflect.ValueOf(&r).Elem()
		if v.NumField() != len(voteColumns) {
			t.Fatalf("VoteRow has %d fields but voteColumns has %d entries",
				v.NumField(), len(voteColumns))
		}
		for i := 0; i < v.NumField(); i++ {
			v.Field(i).SetString(voteColumns[i])
		}
		got := r.TSV()
		want := strings.Join(voteColumns, "\t")
		if got != want {
			t.Fatalf("VoteRow.TSV column order:\n got %q\nwant %q", got, want)
		}
	})

	t.Run("manifest row serializes in manifestColumns order", func(t *testing.T) {
		m := FilingMeta{
			FilePath: "filepath", Accession: "accession", CIK: "cik",
			PeriodOfReport: "period_of_report", FiledDate: "filed_date",
			FormType: "form_type", CompanyName: "company_name", NRows: 7,
			ParseMode: "parse_mode", Layout: "layout",
			ParseStatus: "parse_status", ErrorMsg: "error_msg",
		}
		fields := strings.Split(m.TSV(), "\t")
		if len(fields) != len(manifestColumns) {
			t.Fatalf("FilingMeta.TSV emitted %d columns, want %d: %q",
				len(fields), len(manifestColumns), m.TSV())
		}
		for i, name := range manifestColumns {
			want := name
			if name == "n_rows" {
				want = "7"
			}
			if fields[i] != want {
				t.Errorf("column %d (%s) = %q, want %q", i, name, fields[i], want)
			}
		}
	})
}
