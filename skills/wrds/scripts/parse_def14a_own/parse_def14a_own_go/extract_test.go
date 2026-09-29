package main

import (
	"strings"
	"testing"
)

func run(t *testing.T, body string) []Row {
	t.Helper()
	base := Row{Accession: "acc", CIK: "cik", Company: "Co", FilingDate: "2010-01-01"}
	var rows []Row
	if IsHTML(body) {
		rows, _, _ = ExtractHTML(body, base)
	} else {
		rows, _, _ = ExtractText(body, base)
	}
	return rows
}

func find(rows []Row, name, class string) *Row {
	for i := range rows {
		if rows[i].HolderName == name && (class == "" || rows[i].ShareClass == class) {
			return &rows[i]
		}
	}
	return nil
}

const simpleHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><th>Name of Beneficial Owner</th><th>Amount and Nature of Beneficial Ownership</th><th colspan="2">Percent of Class</th></tr>
<tr><td>Walton Enterprises, LLC (1)</td><td>1,682,130,576</td><td>41.3</td><td>%</td></tr>
<tr><td>S. Robson Walton (2)(3)</td><td>1,687,175,554</td><td>41.4</td><td>%</td></tr>
<tr><td>Jane Doe</td><td>12,345</td><td>*</td><td></td></tr>
<tr><td>All directors and executive officers as a group (23 persons)</td><td>1,700,000,000</td><td>41.8</td><td>%</td></tr>
</table></body></html>`

func TestSimpleTable(t *testing.T) {
	rows := run(t, simpleHTML)
	if len(rows) != 4 {
		t.Fatalf("want 4 rows, got %d: %+v", len(rows), rows)
	}
	w := find(rows, "Walton Enterprises, LLC", "")
	if w == nil || w.Shares == nil || *w.Shares != 1682130576 {
		t.Fatalf("Walton Enterprises shares wrong: %+v", w)
	}
	if w.Percent == nil || *w.Percent != 41.3 {
		t.Fatalf("Walton Enterprises percent wrong: %+v", w.Percent)
	}
	if w.Footnotes != "1" {
		t.Errorf("footnote markers = %q, want \"1\"", w.Footnotes)
	}
	if r := find(rows, "S. Robson Walton", ""); r == nil || r.Footnotes != "2,3" {
		t.Errorf("multi footnote: %+v", r)
	}
	jd := find(rows, "Jane Doe", "")
	if jd == nil || jd.Percent != nil || jd.PctMarker != "*" {
		t.Errorf("star marker not captured: %+v", jd)
	}
	g := find(rows, "All directors and executive officers as a group (23 persons)", "")
	if g == nil {
		// name keeps the (23 persons) parenthetical only if not stripped as a footnote
		for _, r := range rows {
			if r.IsGroupRow {
				g = &r
			}
		}
	}
	if g == nil || !g.IsGroupRow || g.GroupN != 23 {
		t.Fatalf("group row: %+v", g)
	}
	if rows[0].TableKind != "combined" {
		t.Errorf("table_kind = %q", rows[0].TableKind)
	}
}

const multiClassHTML = `<html><body>
<p>Principal Stockholders</p>
<table>
<tr><td></td><td colspan="3">Class A Common Stock</td><td colspan="3">Class B Common Stock</td></tr>
<tr><td>Name of Beneficial Owner</td><td>Shares</td><td colspan="2">Percent</td><td>Shares</td><td colspan="2">Percent</td></tr>
<tr><td>Brian L. Roberts (1)</td><td>$</td><td>1,000,000</td><td>1.2%</td><td></td><td>9,444,375</td><td>33.3%</td></tr>
<tr><td>FMR LLC</td><td>$</td><td>50,000,000</td><td>5.9%</td><td></td><td>0</td><td>&#151;</td></tr>
</table></body></html>`

func TestMultiClass(t *testing.T) {
	rows := run(t, multiClassHTML)
	if len(rows) != 4 {
		t.Fatalf("want 4 rows (2 holders x 2 classes), got %d: %+v", len(rows), rows)
	}
	a := find(rows, "Brian L. Roberts", "Class A Common Stock")
	b := find(rows, "Brian L. Roberts", "Class B Common Stock")
	if a == nil || a.Shares == nil || *a.Shares != 1000000 || a.Percent == nil || *a.Percent != 1.2 {
		t.Fatalf("class A row wrong: %+v", a)
	}
	if b == nil || b.Shares == nil || *b.Shares != 9444375 || b.Percent == nil || *b.Percent != 33.3 {
		t.Fatalf("class B row wrong: %+v", b)
	}
	if rows[0].TableKind != "5pct_holders" {
		t.Errorf("table_kind = %q, want 5pct_holders", rows[0].TableKind)
	}
}

const lessThanHTML = `<html><body>
<div>Beneficial Ownership of Directors and Executive Officers</div>
<table>
<tr><td>Name</td><td>Shares Beneficially Owned</td><td>Percent of Class</td></tr>
<tr><td>A. Director</td><td>1,234</td><td>Less than 1%</td></tr>
<tr><td>B. Officer</td><td>5,678</td><td>less than one percent</td></tr>
<tr><td>All directors and officers as a group (9 persons)</td><td>99,999</td><td>1.1%</td></tr>
</table></body></html>`

func TestLessThanOnePercent(t *testing.T) {
	rows := run(t, lessThanHTML)
	if len(rows) != 3 {
		t.Fatalf("want 3 rows, got %d: %+v", len(rows), rows)
	}
	if r := find(rows, "A. Director", ""); r == nil || r.PctMarker != "<1%" || r.Percent != nil {
		t.Fatalf("less-than marker: %+v", r)
	}
	if rows[0].TableKind != "management" {
		t.Errorf("table_kind = %q, want management", rows[0].TableKind)
	}
}

// An equity compensation plan table carries names and share counts but is not
// an ownership table.
const compPlanHTML = `<html><body>
<p>Equity Compensation Plan Information</p>
<table>
<tr><td>Plan Category</td><td>Number of securities to be issued upon exercise</td><td>Weighted-average exercise price</td></tr>
<tr><td>Equity compensation plans approved by security holders</td><td>12,345,678</td><td>$45.67</td></tr>
<tr><td>Equity compensation plans not approved by security holders</td><td>1,000,000</td><td>$12.00</td></tr>
</table></body></html>`

func TestCompensationTableRejected(t *testing.T) {
	if rows := run(t, compPlanHTML); len(rows) != 0 {
		t.Fatalf("equity comp plan table should not yield ownership rows: %+v", rows)
	}
}

var asciiProxy = `
                    SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

<TABLE>
<CAPTION>
Name and Address of Beneficial Owner       Shares Owned      Percent of Class
<S>                                        <C>               <C>
<S>
Walton Enterprises, LLC                    1,338,382,752            38.8%
Helen R. Walton                              215,000,000             6.2%
S. Robson Walton (1)                       1,344,000,000            39.0%
All directors and executive officers
  as a group (25 persons)                  1,400,000,000            40.6%
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIITable(t *testing.T) {
	if IsHTML(asciiProxy) {
		t.Fatalf("ascii proxy misrouted to the DOM parser")
	}
	rows := run(t, asciiProxy)
	if len(rows) < 3 {
		t.Fatalf("want >=3 rows, got %d: %+v", len(rows), rows)
	}
	w := find(rows, "Walton Enterprises, LLC", "")
	if w == nil || w.Shares == nil || *w.Shares != 1338382752 || w.Percent == nil || *w.Percent != 38.8 {
		t.Fatalf("ascii row wrong: %+v", w)
	}
	if w.Parser != "text_table" {
		t.Errorf("parser = %q", w.Parser)
	}
}

// Real ASCII group-label wraps, one per filing, transcribed from the archive.
// In every one the numeric line carries only the TAIL of the label, so the row
// is parsed but never flagged as the group row.
var asciiWrapCases = []struct {
	name    string   // the filing it came from
	lines   []string // the wrapped group row, as it appears in the proxy
	wantPct float64
	wantN   int
}{
	{
		// 0000899243-01-000692 (cik 941548): four-line label, tail "above)".
		name: "four-line-above",
		lines: []string{
			"  All directors, the director nominee",
			"   and executive officers as a group",
			"   (16 persons including those named",
			"   above)                                   1,288,900          3.9%",
		},
		wantPct: 3.9, wantN: 16,
	},
	{
		// 0000912057-00-012766 (cik 102729): "As Group", with no "a".
		name: "as-group-no-article",
		lines: []string{
			"All Executive Officers and Directors",
			"  As Group (15 persons)                     8,934,656         38.3%",
		},
		wantPct: 38.3, wantN: 15,
	},
	{
		// 0000950135-01-000352 (cik 6281): tail "non-employee directors)".
		name: "three-line-nonemployee",
		lines: []string{
			"All directors and officers as a group (16",
			"  persons, consisting of 11 officers and 5",
			"  non-employee directors)                   6,152,000          1.7%",
		},
		wantPct: 1.7, wantN: 16,
	},
	{
		// 0000912057-00-013742 (cik 52827): tail "(15 persons)".
		name: "three-line-paren-persons",
		lines: []string{
			"Directors and executive",
			"  officers as a group",
			"  (15 persons)                                428,019          1.6%",
		},
		wantPct: 1.6, wantN: 15,
	},
	{
		// 0000950135-99-002820 (cik 875404): tail "persons)".
		name: "two-line-persons",
		lines: []string{
			"All executive officers and directors as a group (9",
			"  persons)                                  2,560,902         11.4%",
		},
		wantPct: 11.4, wantN: 9,
	},
	{
		// 0000950134-98-002658 (cik 71824): tail "those named above (41 persons)".
		name: "two-line-those-named-above",
		lines: []string{
			"All directors and executive officers as a group, including",
			"  those named above (41 persons)              991,192          5.2%",
		},
		wantPct: 5.2, wantN: 41,
	},
}

func TestASCIIGroupRowWrap(t *testing.T) {
	for _, tc := range asciiWrapCases {
		t.Run(tc.name, func(t *testing.T) {
			body := `
                    SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

<TABLE>
<CAPTION>
Name of Beneficial Owner                     Shares Owned      Percent of Class
<S>                                          <C>               <C>
FMR Corp.                                      8,093,000         15.0%
Massachusetts Financial Services Co.           4,114,000          7.6%
Jane Q. Director                                  25,030            *
` + strings.Join(tc.lines, "\n") + `
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

			rows := run(t, body)
			var g *Row
			for i := range rows {
				if rows[i].IsGroupRow {
					g = &rows[i]
				}
			}
			if g == nil {
				t.Fatalf("no group row flagged; parsed rows: %+v", holderNames(rows))
			}
			if g.Percent == nil || *g.Percent != tc.wantPct {
				t.Errorf("group percent = %v, want %v", g.Percent, tc.wantPct)
			}
			if g.GroupN != tc.wantN {
				t.Errorf("group n_persons = %d, want %d", g.GroupN, tc.wantN)
			}
			// The named 5% holders must survive the wrap join untouched.
			if r := find(rows, "FMR Corp", ""); r == nil || r.IsGroupRow {
				t.Errorf("FMR Corp row lost or mis-flagged as group: %+v", r)
			}
		})
	}
}

// A prose lead-in that ends "...as a group:" sits directly above the first
// holder row. Joining it onto that row would flag a real 5% holder as the
// group row and delete it from the holder metrics.
func TestASCIIGroupWrapDoesNotSwallowFirstHolder(t *testing.T) {
	body := `
                    SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

<TABLE>
<CAPTION>
Name of Beneficial Owner                     Shares Owned      Percent of Class
<S>                                          <C>               <C>
The following sets forth the shares held by all
directors and executive officers as a group:
FMR Corp.                                      8,093,000         15.0%
Massachusetts Financial Services Co.           4,114,000          7.6%
Jane Q. Director                                  25,030            *
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

	rows := run(t, body)
	for _, r := range rows {
		if r.IsGroupRow {
			t.Fatalf("prose lead-in flagged a holder as the group row: %q", r.HolderName)
		}
	}
	if r := find(rows, "FMR Corp", ""); r == nil {
		t.Fatalf("FMR Corp row missing: %+v", holderNames(rows))
	}
}

func holderNames(rows []Row) []string {
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.HolderName)
	}
	return out
}

func TestGroupRowPhrasing(t *testing.T) {
	yes := map[string]int{
		"All executive officers and directors As Group (15 persons)":                                15,
		"All directors and executive officers as a group (12 persons)":                              12,
		"Directors and executive officers as a group  (15 persons)":                                 15,
		"All directors and officers as a group (16 persons, consisting)":                            16,
		"All directors and executive officers as a group, including those named above (41 persons)": 41,
	}
	for name, n := range yes {
		g, got := isGroupRow(name)
		if !g || got != n {
			t.Errorf("isGroupRow(%q) = %v %d, want true %d", name, g, got, n)
		}
	}
	for _, name := range []string{
		"Group Vice President and General Counsel",
		"Greencore Group plc",
		"FMR Corp.",
		"The Goldman Sachs Group, Inc.",
	} {
		if g, _ := isGroupRow(name); g {
			t.Errorf("isGroupRow(%q) = true, want false", name)
		}
	}
}

func TestPrimaryDocument(t *testing.T) {
	raw := "<SEC-DOCUMENT>x\n<DOCUMENT>\n<TYPE>DEF 14A\n<TEXT>\nBODY-ONE\n</TEXT>\n</DOCUMENT>\n" +
		"<DOCUMENT>\n<TYPE>GRAPHIC\n<TEXT>\nJUNK\n</TEXT>\n</DOCUMENT>"
	got := PrimaryDocument(raw)
	if !strings.Contains(got, "BODY-ONE") || strings.Contains(got, "JUNK") {
		t.Fatalf("primary document = %q", got)
	}
}

func TestParseHelpers(t *testing.T) {
	if v, ok := ParseShares(" $ 1,234,567 (3) "); !ok || v != 1234567 {
		t.Errorf("ParseShares = %v %v", v, ok)
	}
	if _, ok := ParseShares("—"); ok {
		t.Errorf("em dash should not parse as shares")
	}
	v, ok, mk, pi := ParsePercent("12.5 %")
	if !ok || v != 12.5 || mk != "" || !pi {
		t.Errorf("ParsePercent = %v %v %q %v", v, ok, mk, pi)
	}
	if n, f := StripFootnotes("John Q. Public (1)(2)"); n != "John Q. Public" || len(f) != 2 {
		t.Errorf("StripFootnotes = %q %v", n, f)
	}
	if g, n := isGroupRow("All directors and executive officers as a group (12 persons)"); !g || n != 12 {
		t.Errorf("isGroupRow = %v %v", g, n)
	}
}

// SEC rules make a proxy print the 5% holder's ADDRESS, and ASCII proxies put
// it on the lines underneath the name, with a blank line before the next
// holder. Transcribed from 0000930661-00-000895 (cik 202890), where the block
// scan died after one row and the filing scored no_table_found_plain_text.
var asciiAddressBlock = `
                       VOTING AND PRINCIPAL STOCKHOLDERS

  The following table sets forth as of March 17, 2000, certain information with
regard to the beneficial ownership of Common Stock by (i) all persons known by
the Corporation to be the beneficial owner of more than 5% of the outstanding
Common Stock of the Corporation; (ii) each director and nominee for director of
the Corporation; and (iv) all executive officers and directors as a group.

<TABLE>
<CAPTION>
                             Number       Shares Underlying    Total    Percent
         Name of               of        Options Exercisable Beneficial   of
     Beneficial Owner       Shares(1)      Within 60 Days    Ownership   Class
     ----------------       ---------    ------------------- ---------- -------
<S>                         <C>          <C>                 <C>        <C>
Don V. Ingram.............  1,261,710(2)        414,787      1,676,497   10.7%
 2200 Ross Ave., Suite
  4500-E
 L.B. 170
 Dallas, Texas 75201

William Warshauer.........  1,135,743(3)          3,000      1,138,743    7.5%
 430 W. Garfield Ave.
 Coldwater, Michigan 49036

Mellon Financial
 Corporation..............  1,339,369(4)            -0-      1,339,369    8.8%
 One Mellon Bank Center
 Pittsburgh, PA 15258
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIIAddressBlockDoesNotEndTable(t *testing.T) {
	rows := run(t, asciiAddressBlock)
	for _, want := range []struct {
		name string
		pct  float64
	}{
		{"Don V. Ingram", 10.7},
		{"William Warshauer", 7.5},
	} {
		r := find(rows, want.name, "")
		if r == nil {
			t.Fatalf("%s missing; parsed: %v", want.name, holderNames(rows))
		}
		if r.Percent == nil || *r.Percent != want.pct {
			t.Errorf("%s percent = %v, want %v", want.name, r.Percent, want.pct)
		}
	}
	// A street address is not a holder.
	for _, r := range rows {
		if strings.Contains(r.HolderName, "Ross Ave") || strings.Contains(r.HolderName, "Coldwater") {
			t.Errorf("address line emitted as a holder: %q", r.HolderName)
		}
	}
}

// ParsePercent already accepts + # † ‡ as less-than-1% markers, but the ASCII
// row regex's numeric-tail character class did not, so every row carrying one
// failed to parse at all. Transcribed from 0000891618-99-001377 (cik 837991),
// where nine of ten rows used "+" and the filing scored
// no_table_found_plain_text.
var asciiPlusMarker = `
                             PRINCIPAL STOCKHOLDERS

     The following table sets forth certain information regarding the
beneficial ownership of the Company's Common Stock by each person known to
own more than 5%, each director, and all directors and executive officers
as a group.

<TABLE>
<CAPTION>
                                                   COMMON         APPROXIMATE
                                                   STOCK            PERCENT
                                                BENEFICIALLY      BENEFICIALLY
               BENEFICIAL OWNER                    OWNED             OWNED
<S>                                             <C>               <C>
Mark B. Logan.................................    343,345(1)          1.1%
Elizabeth H. Davila...........................    183,382(2)            +
Glendon E. French.............................     14,290(3)            +
John W. Galiardo..............................     25,791(4)            +
Jay T. Holmes.................................     35,190(5)            +
All directors and executive officers as a
  group (14 persons)..........................    828,513(10)         2.6%
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIIPlusLessThanMarker(t *testing.T) {
	rows := run(t, asciiPlusMarker)
	d := find(rows, "Elizabeth H. Davila", "")
	if d == nil {
		t.Fatalf("row with a + marker never parsed; parsed: %v", holderNames(rows))
	}
	if d.Shares == nil || *d.Shares != 183382 {
		t.Errorf("Davila shares = %v, want 183382", d.Shares)
	}
	if d.PctMarker != "*" {
		t.Errorf("Davila marker = %q, want %q (less-than-1%%)", d.PctMarker, "*")
	}
	if d.Percent != nil {
		t.Errorf("a + marker is not a numeric percent, got %v", *d.Percent)
	}
	if r := find(rows, "Mark B. Logan", ""); r == nil || r.Percent == nil || *r.Percent != 1.1 {
		t.Errorf("Logan row: %+v", r)
	}
	var g *Row
	for i := range rows {
		if rows[i].IsGroupRow {
			g = &rows[i]
		}
	}
	if g == nil || g.Percent == nil || *g.Percent != 2.6 || g.GroupN != 14 {
		t.Fatalf("group row: %+v", g)
	}
}
