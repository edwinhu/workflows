package main

import (
	"bufio"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeTmp(t *testing.T, name, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(p, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	return p
}

func TestReadFileListFullRow(t *testing.T) {
	p := writeTmp(t, "list.tsv",
		"000010/104169/0000104169-24-000123.txt\t104169\t0000104169-24-000123\tDEF 14A\t2024-04-25\tWAL MART STORES INC\n"+
			"\n"+
			"000078/777676/0000777676-01-500011.txt\t777676\t0000777676-01-500011\tDEF 14A\t2001-09-04\n")
	jobs, err := readFileList(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 2 {
		t.Fatalf("want 2 jobs (blank line skipped), got %d", len(jobs))
	}
	if jobs[0].CIK != "104169" || jobs[0].FilingDate != "2024-04-25" || jobs[0].Company != "WAL MART STORES INC" {
		t.Errorf("row 1 parsed wrong: %+v", jobs[0])
	}
	if jobs[1].Company != "" || jobs[1].Form != "DEF 14A" {
		t.Errorf("row 2 parsed wrong: %+v", jobs[1])
	}
}

// A filelist of bare archive paths must still yield cik and accession, because
// a shard built by hand (or by rebuilding from an existing out/ directory)
// carries no metadata columns.
func TestReadFileListPathOnly(t *testing.T) {
	p := writeTmp(t, "list.txt", "000010/104169/0000104169-24-000123.txt\n")
	jobs, err := readFileList(p)
	if err != nil {
		t.Fatal(err)
	}
	if len(jobs) != 1 {
		t.Fatalf("want 1 job, got %d", len(jobs))
	}
	if jobs[0].CIK != "104169" {
		t.Errorf("cik from path: want 104169, got %q", jobs[0].CIK)
	}
	if jobs[0].Accession != "0000104169-24-000123" {
		t.Errorf("accession from path: want 0000104169-24-000123, got %q", jobs[0].Accession)
	}
}

func TestRowTSVFieldCountAndEscaping(t *testing.T) {
	sh, pc := 1234.0, 38.4
	r := Row{
		Accession: "0000104169-24-000123", CIK: "104169",
		Company: "WAL\tMART", FilingDate: "2024-04-25",
		TableKind: "combined", TableIndex: 2, RowIndex: 7,
		HolderName: "Jim C. Walton\n(trustee)", Shares: &sh, Percent: &pc,
		PctMarker: "", ShareClass: "Common Stock", IsGroupRow: false, GroupN: 0,
		Footnotes: "1,2", Parser: "html_dom", SourceFile: "000010/104169/x.txt",
	}
	line := rowTSV(r)
	if strings.Contains(line, "\n") {
		t.Fatalf("row carries a newline: %q", line)
	}
	fs := strings.Split(line, "\t")
	want := len(strings.Split(rowHeader, "\t"))
	if len(fs) != want {
		t.Fatalf("field count %d != header %d", len(fs), want)
	}
	if fs[2] != "WAL MART" {
		t.Errorf("tab in company not folded: %q", fs[2])
	}
	if fs[7] != "Jim C. Walton (trustee)" {
		t.Errorf("newline in holder not folded: %q", fs[7])
	}
	if fs[8] != "1234" || fs[9] != "38.4" {
		t.Errorf("numbers: %q %q", fs[8], fs[9])
	}
	if fs[17] != "2024" {
		t.Errorf("proxy_year: %q", fs[17])
	}
	if fs[18] != "0" {
		t.Errorf("is_institution on a natural person: %q", fs[18])
	}
}

// A nil share or percent must be an EMPTY field, never a zero: "0 shares" and
// "not disclosed" are different facts and the scorer compares on them.
func TestRowTSVNilsAreEmpty(t *testing.T) {
	fs := strings.Split(rowTSV(Row{HolderName: "X", FilingDate: "1999-04-20"}), "\t")
	if fs[8] != "" || fs[9] != "" {
		t.Errorf("nil shares/percent should be empty, got %q %q", fs[8], fs[9])
	}
}

func TestIsInstitution(t *testing.T) {
	inst := []string{"The Vanguard Group, Inc.", "BlackRock, Inc.", "FMR Corp",
		"State Street Corporation", "Capital Research and Management Company",
		"Dodge & Cox", "Wellington Management Company, LLP"}
	notInst := []string{"Jim C. Walton", "S. Robson Walton", "Walton Enterprises, L.L.C.",
		"Directors and executive officers as a group (12 persons)", "Hershey Trust Company"}
	for _, n := range inst {
		if !reInst.MatchString(n) {
			t.Errorf("want institution: %q", n)
		}
	}
	for _, n := range notInst {
		if reInst.MatchString(n) {
			t.Errorf("want NOT institution: %q", n)
		}
	}
}

func TestManifestTSVFieldCount(t *testing.T) {
	m := Manifest{Accession: "a", CIK: "1", FilingDate: "2000-01-01", Form: "DEF 14A",
		SourceFile: "p", Bytes: 10, Parser: "text_table", Status: "error",
		Err: "open x:\nno such file"}
	line := manTSV(m)
	if strings.Contains(line, "\n") {
		t.Fatalf("manifest row carries a newline: %q", line)
	}
	if got, want := len(strings.Split(line, "\t")), len(strings.Split(manifestHeader, "\t")); got != want {
		t.Fatalf("manifest field count %d != header %d", got, want)
	}
}

func TestWriteGzHeaderAndRows(t *testing.T) {
	p := filepath.Join(t.TempDir(), "o.tsv.gz")
	if err := writeGz(p, "a\tb", 2, func(i int) string {
		return []string{"1\t2", "3\t4"}[i]
	}); err != nil {
		t.Fatal(err)
	}
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	sc := bufio.NewScanner(gz)
	for sc.Scan() {
		got = append(got, sc.Text())
	}
	if err := sc.Err(); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, "|") != "a\tb|1\t2|3\t4" {
		t.Errorf("gz contents: %q", got)
	}
}

// A filing the archive does not hold must produce a manifest row with
// parse_status=error, not a silently missing filing.
func TestProcessMissingFileIsLoud(t *testing.T) {
	rows, man := process(t.TempDir(), job{RelPath: "nope/nope.txt", CIK: "1", Accession: "a"})
	if len(rows) != 0 {
		t.Errorf("want no rows, got %d", len(rows))
	}
	if man.Status != "error" || man.Err == "" {
		t.Errorf("want error status with a message, got %+v", man)
	}
}

// End-to-end on a synthetic HTML proxy: the driver must find the table, emit
// holder rows, flag the group row, and report it all in the manifest.
func TestProcessSyntheticProxy(t *testing.T) {
	dir := t.TempDir()
	rel := "000010/104169/0000104169-99-000001.txt"
	if err := os.MkdirAll(filepath.Join(dir, filepath.Dir(rel)), 0o755); err != nil {
		t.Fatal(err)
	}
	html := `<html><body>
<p>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT</p>
<table>
<tr><td>Name of Beneficial Owner</td><td>Shares Beneficially Owned</td><td>Percent of Class</td></tr>
<tr><td>Walton Enterprises, L.P.</td><td>1,707,772,848</td><td>38.1%</td></tr>
<tr><td>The Vanguard Group, Inc.</td><td>120,000,000</td><td>5.4%</td></tr>
<tr><td>Jane Q. Public (1)</td><td>12,345</td><td>*</td></tr>
<tr><td>Directors and executive officers as a group (14 persons)</td><td>1,750,000,000</td><td>40.1%</td></tr>
</table>
<p>* Less than 1%.</p>
</body></html>`
	if err := os.WriteFile(filepath.Join(dir, rel), []byte(html), 0o644); err != nil {
		t.Fatal(err)
	}
	rows, man := process(dir, job{RelPath: rel, CIK: "104169",
		Accession: "0000104169-99-000001", Form: "DEF 14A", FilingDate: "1999-04-20"})
	if man.Status != "ok" || man.Parser != "html_dom" {
		t.Fatalf("manifest: %+v", man)
	}
	if man.NRows != 4 || len(rows) != 4 {
		t.Fatalf("want 4 holder rows, got NRows=%d len=%d", man.NRows, len(rows))
	}
	if man.NPctParsed != 3 {
		t.Errorf("want 3 parsed percents (the '*' row has none), got %d", man.NPctParsed)
	}
	if !man.HasGroup {
		t.Error("group row not flagged")
	}
	byName := map[string]Row{}
	for _, r := range rows {
		byName[r.HolderName] = r
		t.Logf("emitted holder=%q shares=%v pct=%v marker=%q group=%v",
			r.HolderName, fnum(r.Shares), fnum(r.Percent), r.PctMarker, r.IsGroupRow)
	}
	// StripFootnotes trims trailing punctuation, so "L.P." arrives as "L.P" and
	// "Inc." as "Inc". Asserted rather than fixed: the scorer normalises names
	// before matching, and changing it here would change every emitted name.
	if r, ok := byName["Walton Enterprises, L.P"]; !ok || r.Percent == nil || *r.Percent != 38.1 {
		t.Errorf("Walton row wrong: %+v ok=%v", r, ok)
	}
	if r, ok := byName["The Vanguard Group, Inc"]; !ok || r.Shares == nil || *r.Shares != 120000000 {
		t.Errorf("Vanguard row wrong: %+v ok=%v", r, ok)
	}
	if g := byName["Directors and executive officers as a group (14 persons)"]; !g.IsGroupRow || g.GroupN != 14 {
		t.Errorf("group row: IsGroupRow=%v GroupN=%d", g.IsGroupRow, g.GroupN)
	}
	// Named "Public", not the pun "Director": the screen now strips a trailing
	// role clause from a holder cell, so a synthetic surname that IS a role word
	// would test the cleaner rather than the footnote/marker plumbing this case
	// is about.
	if r := byName["Jane Q. Public"]; r.PctMarker != "*" || r.Footnotes != "1" {
		t.Errorf("star/footnote row wrong: %+v", r)
	}
	if !reInst.MatchString("The Vanguard Group, Inc.") {
		t.Error("Vanguard must flag as institutional")
	}
}

// A footnote sentence is not a table row. 0001163238-03-000122's notes read
// "(3) Anton Drescher owns an additional 100,000 warrants to purchase up to an
// / additional 100,000 common shares at a price of $0.30 per share, which /
// warrants expire on August 8, 2003." The middle line splits at a wide gap and
// its tail carries a grouped number, so parseTextRowAt read it as a row; four
// of them then outvoted the real table in alignedRows' modal alignment and the
// group total was dropped. A value column is numbers, not a sentence.
func TestAFootnoteSentenceIsNotATableRow(t *testing.T) {
	for _, l := range []string{
		"     additional  100,000  common  shares  at  a  price of $0.30 per share, which",
		"     an  additional  25,000  common  shares at a price of $0.30 per share, which",
	} {
		if _, _, _, ok := parseTextRowAt(l); ok {
			t.Errorf("footnote sentence read as a table row: %q", l)
		}
	}
	// Real rows, which must still parse.
	for _, l := range []string{
		" as a Group [four persons]                     2,507,213                    24.82%",
		"Morton H. Kinzler           1100 Alakea Street, Suite 2900                   219,960 (4)           16.7%",
		"Ronald K. Earnest                      48      113,256  (2)                5.4%        President and          1998",
		"Ronald N. Tutor (4)                               62      1997      6,282,201     (5)     0            6,282,201      23.94%",
	} {
		if _, _, _, ok := parseTextRowAt(l); !ok {
			t.Errorf("real table row rejected: %q", l)
		}
	}
}

// Transcribed from 0000890566-00-000062 (Snap-on/Ampco 2000). The ownership
// table carries a FACE VALUE OF DEBENTURES column in dollars beside the share
// counts, and its percent column is the less-than-1% marker "*" for all but
// two rows. textMoneyBlock vetoes itself on a literal "%" only, so a block of
// such rows read as money and the table -- group total included -- was thrown
// away. A percent MARKER is a percent of class just as "%" is.
func TestAPercentMarkerVetoesTheMoneyBlock(t *testing.T) {
	clean := []string{
		"John D. O' Connell                        $ 12,500             10,710           17,396          *",
		"Vincent R. Scorsone                       $100,000              5,000           24,174          *",
		"Michael J. Sebastian                      $150,000             21,000           13,760          *",
		"All officers and directors as a group",
		"  (15 persons)                            $312,500            140,042          658,011           4.5",
	}
	if textMoneyBlock(clean, []int{0, 1, 2, 4}) {
		t.Errorf("an ownership table with a dollar column and a 4.5 percent read as money")
	}
	// A fund DOLLAR-RANGE table still must read as money: its "*" is a
	// footnote marker on a dollar band, not a percent of class. These are the
	// rows of 0000930413-02-002213 and 0001072613-08-000788, the filings the
	// exclusion clauses X2 and X3 were written from.
	money := []string{
		"Martin J. Whitman                         $0*                Over $100,000*",
		"David M. Barse                            $0*                Over $100,000*",
		"Jack W. Aber                              $0*                $50,001 - $100,000*",
	}
	if !textMoneyBlock(money, []int{0, 1, 2}) {
		t.Errorf("a dollar-range block stopped being money")
	}
}

func TestProcessIndependentProseOwnershipLayouts(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		want, pct  int
	}{
		{"biography", biographyHoldings55, 4, 0},
		{"exception", ownershipException55, 1, 0},
		{"record", recordCommonShares55, 1, 1},
		{"passive_group", passiveGroupCount55, 2, 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			if err := os.WriteFile(filepath.Join(dir, "proxy.txt"), []byte(tc.body), 0o644); err != nil {
				t.Fatal(err)
			}
			j := job{RelPath: "proxy.txt", CIK: "1", Accession: "a"}
			rows, man := process(dir, j)
			if man.Status != "ok" || man.Parser != "text_prose" || man.NRows != tc.want || len(rows) != tc.want || man.NPctParsed != tc.pct {
				t.Fatalf("wrong process result rows=%+v manifest=%+v", rows, man)
			}
		})
	}
}
