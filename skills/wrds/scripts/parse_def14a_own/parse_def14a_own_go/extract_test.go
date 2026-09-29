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

// A 5% holder's name sits on the FIRST line of a name-and-address block and the
// numbers land on the LAST line, so parseTextRow reads the city line as the
// holder. Transcribed from 0001036050-00-000325 (cik 11860, "- ----" rules
// between holders) and 0000950152-96-001391 (cik 701708, a P.O. Box block).
var asciiNameAddressBlock = `
                  SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

<TABLE>
<CAPTION>
Name and Address of Beneficial Owner      Number of Shares % of Class
- ---------------------------------------------------------------------
<S>                                       <C>              <C>
State Street Bank and Trust Company(/1/)
225 Franklin Street
Boston, Massachusetts 02110                  10,446,661       7.82%
- ---------------------------------------------------------------------
FMR Corp.(/2/)
82 Devonshire Street
Boston, Massachusetts 02109                  14,608,499      11.14%
- ---------------------------------------------------------------------
Sanford C. Bernstein & Co.,
Inc.
767 Fifth Avenue
New York, New York 10153                      7,302,860       5.60%
- ---------------------------------------------------------------------
Sarah Roush Werner
  P. O. Box 611
  Marysville, Washington 98270                2,605,763       6.66%
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIINameAddressBlockKeepsTheName(t *testing.T) {
	rows := run(t, asciiNameAddressBlock)
	for _, want := range []struct {
		name string
		pct  float64
	}{
		// Names arrive already normalised by StripFootnotes, which trims
		// trailing " .,;:-" — hence "Corp" and "Co Inc", not "Corp." and
		// "Co., Inc.". The assertion is on the HEAD of the address block
		// being recovered whole, not on punctuation.
		{"State Street Bank and Trust Company", 7.82},
		{"FMR Corp", 11.14},
		{"Sanford C. Bernstein & Co Inc", 5.60},
		{"Sarah Roush Werner", 6.66},
	} {
		r := find(rows, want.name, "")
		if r == nil {
			t.Fatalf("%q missing; parsed: %v", want.name, holderNames(rows))
		}
		if r.Percent == nil || *r.Percent != want.pct {
			t.Errorf("%s percent = %v, want %v", want.name, r.Percent, want.pct)
		}
	}
	for _, r := range rows {
		if strings.Contains(r.HolderName, "Boston") || strings.Contains(r.HolderName, "Marysville") ||
			strings.Contains(r.HolderName, "Franklin Street") || strings.Contains(r.HolderName, "Devonshire") {
			t.Errorf("address line emitted as a holder: %q", r.HolderName)
		}
	}
}

// The guard: a heading or a prose lead-in directly above a numeric row must
// never be glued onto the first real holder underneath it.
var asciiHeadingAboveRow = `
                        PRINCIPAL STOCKHOLDERS

<TABLE>
<CAPTION>
             BENEFICIAL OWNER                    OWNED             PERCENT
<S>                                             <C>               <C>
100 Fifth Avenue Associates...................   343,345(1)          11.1%
Mark B. Logan.................................   183,382(2)           5.4%
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIIAddressRejoinDoesNotEatTheHeader(t *testing.T) {
	rows := run(t, asciiHeadingAboveRow)
	r := find(rows, "100 Fifth Avenue Associates", "")
	if r == nil {
		t.Fatalf("street-shaped holder name lost; parsed: %v", holderNames(rows))
	}
	for _, x := range rows {
		if strings.Contains(strings.ToUpper(x.HolderName), "BENEFICIAL OWNER") ||
			strings.Contains(strings.ToUpper(x.HolderName), "STOCKHOLDERS") {
			t.Errorf("header glued onto a holder: %q", x.HolderName)
		}
	}
}

// ---------------------------------------------------------------------------
// The 5% table announced by a PROSE LEAD-IN rather than a heading.
// Transcribed from 0000105418-00-000012 (Weis Markets), whose table sits under
// the sentence "The following persons are known by the Company to be the
// beneficial owners of / more than 5% of its Common Stock" -- the sentence
// wraps, so the ownership cue and the 5% cue land on different lines.
var asciiProseLeadIn = `<TYPE>DEF 14A
<TEXT>
41,690,907.  The presence, in person or by proxy, of at least 20,845,454 shares
will constitute a quorum.

        The following persons are known by the Company to be the beneficial owners of
more than 5% of its Common Stock, which is its only class of voting securities,
on April 28, 2000.  Information contained in the table and footnotes below were
derived from filings made with the Securities and Exchange Commission by the
beneficial owners.

              Name and Address                 Amount and Nature          Percent
                     of                          of Beneficial              of
              Beneficial Owner                     Ownership               Class
 -------------------------------     ------------------     -------
        Robert F. Weis                       12,761,411    (1)         30.6
                c/o Weis Markets, Inc.
                1000 South Second Street
                Sunbury, PA 17801-0471

        Janet C. Weis                         8,132,411    (2)         19.5
                43 South Fifth Street
                Sunbury, PA 17801-0471

        Weis Family Holdings, L.P.            8,087,773    (3)         19.4
                919 North Market Street, Suite 200
                Wilmington, DE 19801
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIIProseLeadInAnchorsTheTable(t *testing.T) {
	rows := run(t, asciiProseLeadIn)
	// "L.P." arrives as "L.P": StripFootnotes trims trailing punctuation from
	// every holder name, which is pre-existing normalisation, not this defect.
	for _, want := range []string{"Robert F. Weis", "Janet C. Weis", "Weis Family Holdings, L.P"} {
		r := find(rows, want, "")
		if r == nil {
			t.Fatalf("holder %q not found; parsed: %v", want, holderNames(rows))
		}
		if r.Percent == nil {
			t.Errorf("holder %q parsed with no percent", want)
		}
	}
}

// A long address block between two holders must not end the table. Transcribed
// from 0001036050-99-000736 (CDI Corp): eight non-row lines -- a wrapped name,
// a c/o line, a firm, a tower, a street and a city/zip -- separate the first
// holder from the second, which the flat six-line non-row limit could not span.
var asciiLongAddressBlock = `<TYPE>DEF 14A
<TEXT>
             PRINCIPAL SHAREHOLDERS AND MANAGEMENT STOCK OWNERSHIP

  As of February 15, 1999, the following persons and entities were known by
the Company to be beneficial owners of more than 5% of the outstanding CDI
Stock.

                                              Number of Shares   Percentage of
            Name and Address of                 of CDI Stock      Outstanding
             Beneficial Owner                Owned Beneficially*   CDI Stock
            -------------------              ------------------- -------------
Donald W. Garrison, Lawrence C. Karlson,         5,672,488(1)        29.4%
Joseph A. Teti, Jr. and Barton J. Winokur,
as Trustees of various trusts for the
   benefit of Walter R. Garrison's children
   c/o Paul Wm. Putney, Esquire
   Dechert Price & Rhoads
   4000 Bell Atlantic Tower
   1717 Arch Street
   Philadelphia, PA 19103
Walter R. Garrison                               1,765,105(2)         9.2%
   1717 Arch Street, 35th Floor
   Philadelphia, PA 19103-2768
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIILongAddressBlockDoesNotEndTable(t *testing.T) {
	rows := run(t, asciiLongAddressBlock)
	r := find(rows, "Walter R. Garrison", "")
	if r == nil {
		t.Fatalf("second holder lost across an eight-line address block; parsed: %v", holderNames(rows))
	}
	if r.Percent == nil || *r.Percent < 9.1 || *r.Percent > 9.3 {
		t.Errorf("Walter R. Garrison percent = %v, want 9.2", r.Percent)
	}
}

// The prose-lead-in anchor must not fire on ordinary 5% prose that has no
// table under it: a Section 16 / quorum paragraph followed by the summary
// compensation table must still yield nothing.
var asciiFivePctProseNoTable = `<TYPE>DEF 14A
<TEXT>
Each person who beneficially owns more than 5% of the Company's common stock
is required to file reports under Section 16(a), and the Company believes all
such reports were filed on time during the last fiscal year.

                           SUMMARY COMPENSATION TABLE

    Name and Principal Position        Year      Salary ($)      Bonus ($)
    ---------------------------        ----      ----------      ---------
    Jane Q. Executive, CEO             1999         550,000        275,000
    John R. Officer, CFO               1999         310,000        120,000
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIIProseLeadInDoesNotGrabCompensationTable(t *testing.T) {
	rows := run(t, asciiFivePctProseNoTable)
	for _, x := range rows {
		if strings.Contains(x.HolderName, "Executive") || strings.Contains(x.HolderName, "Officer") {
			t.Errorf("compensation row parsed as ownership: %q", x.HolderName)
		}
	}
}

// --- collective (group) labels that carry no "as a group" -----------------
//
// The D&O aggregate row is written a dozen ways and most of them never say
// "as a group": the label wraps and the phrase lands on a line the numbers are
// not on, or the proxy simply writes "All directors" / "(24 Persons)". Every
// positive below is transcribed from a dev filing that emitted the fragment as
// a NON-group holder row, which is a false positive in the holder set AND a
// missing group row for the same filing.
func TestCollectiveLabelsAreGroupRows(t *testing.T) {
	yes := []string{
		"All directors",                                    // 0000703799-00-000022
		"All directors and executive officers",              // 0000011199-96 / many
		"All executive officers and",                        // 0000103872-00-000184
		"Directors and executive officers",                  // 0000057528-96-001104
		"ALL DIRECTORS AND EXECUTIVE OFFICERS",              // 0000094328-00-000012
		"(24 Persons)",                                      // 0000094328-00-000012
		"Directors (22 persons,",                            // 0000899681-97-000161
		"those listed above)",                               // 0000899681-96-000050
		"Group (18 persons)",                                // 0000025445-96-000246
		"Group (7 in number)",                               // 0000700612-98-000005
		"officers",                                          // 0000912057-97-014579
		"All nominees, directors and named officers as a",    // 0000950128-98-000652
		"Non-Executive Director Group (6 persons)",           // 0000892569-98-001409
		"(28 persons, including those named above)",          // 0000950124-00-001884
		"All directors, directors emeritus and",              // 0000050863-97-000028
		"Executive Officers and Directors",                   // 0000912057-96-021732
	}
	for _, name := range yes {
		if g, _ := isGroupRow(name); !g {
			t.Errorf("isGroupRow(%q) = false, want true", name)
		}
	}
	// Real holders whose names brush against the collective vocabulary. Every
	// one of these is a scored TRUE POSITIVE in the dev set, so flagging it as
	// a group row would delete a real holding.
	no := []string{
		"FMR Corp.",
		"The Goldman Sachs Group, Inc.",
		"Trustees of General Electric Pension Trust",
		"Royce Group",
		"The Capital Group",
		"Baron Capital Group",
		"Wellington Management Group",
		"Zacchello Family Group",
		"Management, Inc",
		"Directors Investment Group, Inc.",
		"Richard M. Schulze Founder, Chairman, Chief Executive Officer and Director",
		"Employees' Savings Plan of Panhandle Eastern Corporation",
		"Group Vice President and General Counsel",
		"First Manhattan Co.",
		"Officer's Trust of the Ekco Group, Inc",
	}
	for _, name := range no {
		if g, _ := isGroupRow(name); g {
			t.Errorf("isGroupRow(%q) = true, want false", name)
		}
	}
}

// The group label wraps FORWARD: the numbers sit on the first line and the rest
// of the label runs BELOW it. Transcribed from 0000703799-00-000022 (cik
// 703799), which emitted holder "All directors" at 10.8% with no group flag and
// no person count.
var asciiGroupForwardWrap = `
         VOTING SECURITIES AND PRINCIPAL HOLDERS THEREOF

<TABLE>
<CAPTION>
               Name and                         Amount and
              Address of                        Nature of
 Title of     Beneficial                        Beneficial        Percent
  Class         Owner                           Ownership         of Class
 --------     ----------                        ----------        --------
<S>          <C>                                <C>                 <C>
             Quaker Capital                       807,351 (2)       11.91%
               Management Corporation
             1300 Arrott Building
             401 Wood Street
             Pittsburgh, PA 15222

             Arthur Zankel                        171,463 (8)          2.52%
             437 Madison Avenue
             New York, NY 10022

             All directors                        775,973             10.80%
             and executive officers
             as a group (11 persons
             including those
             named above)
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIIGroupLabelWrapsForward(t *testing.T) {
	rows := run(t, asciiGroupForwardWrap)
	var g *Row
	for i := range rows {
		if rows[i].IsGroupRow {
			g = &rows[i]
		}
	}
	if g == nil {
		t.Fatalf("forward-wrapped group label not flagged; parsed: %v", holderNames(rows))
	}
	if g.Percent == nil || *g.Percent != 10.8 {
		t.Errorf("group percent = %v, want 10.8", g.Percent)
	}
	if g.GroupN != 11 {
		t.Errorf("group_n_persons = %d, want 11 (the count is on a line below)", g.GroupN)
	}
	if r := find(rows, "Arthur Zankel", ""); r == nil || r.Percent == nil || *r.Percent != 2.52 {
		t.Errorf("the holder above the group row: %+v", r)
	}
	for _, r := range rows {
		if strings.Contains(r.HolderName, "Madison") || strings.Contains(r.HolderName, "New York") {
			t.Errorf("address line emitted as a holder: %q", r.HolderName)
		}
	}
}

// A name-and-address cell whose city line carries no ZIP, or carries a ZIP plus
// a second address glued on. Transcribed from 0000916641-00-000488 (cik
// 1025361) and 0000100166-96-000005 (cik 100166): both emitted the city line as
// the holder name.
var asciiCityLineNoZip = `
                  SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

<TABLE>
<CAPTION>
Name and Address of Beneficial Owner            Number of Shares   Percent
<S>                                             <C>                <C>
Cascade Investment LLC & William H. Gates
 III
 2365 Carillion Point
 Kirkland, WA 98033 & One Microsoft Way
 Redmond, WA 98052.......................       2,562,900(f)        8.21%

Sound Shore Management, Inc. 8 Sound Shore Drive
  Greenwich, Connecticut..........................     1,772,600(6)            5.95
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIICityLineWithoutZipIsNotAHolder(t *testing.T) {
	rows := run(t, asciiCityLineNoZip)
	if r := find(rows, "Cascade Investment LLC & William H. Gates III", ""); r == nil ||
		r.Percent == nil || *r.Percent != 8.21 {
		t.Errorf("Cascade/Gates head not recovered: %+v (parsed %v)", r, holderNames(rows))
	}
	for _, r := range rows {
		for _, bad := range []string{"Redmond", "Greenwich, Connecticut", "Kirkland"} {
			if r.HolderName == bad || strings.HasPrefix(r.HolderName, bad) {
				t.Errorf("address line emitted as a holder: %q", r.HolderName)
			}
		}
	}
}

// A percent of a class cannot exceed 100. When a column role is misread the
// share count lands in the percent slot ("5,509" -> 5509, a director's age ->
// 119), which is never a holding. Transcribed from 0000912057-01-003040-shaped
// director tables in the dev set.
func TestPercentOverOneHundredIsNotAPercent(t *testing.T) {
	for _, s := range []string{"119", "436", "5509", "1,886", "119.4%"} {
		if v, ok, _, _ := ParsePercent(s); ok {
			t.Errorf("ParsePercent(%q) = %v, want not-a-percent (over 100)", s, v)
		}
	}
	for _, tc := range []struct {
		in   string
		want float64
	}{{"100", 100}, {"100.0%", 100}, {"99.9%", 99.9}, {"8.21", 8.21}} {
		v, ok, _, _ := ParsePercent(tc.in)
		if !ok || v != tc.want {
			t.Errorf("ParsePercent(%q) = %v %v, want %v true", tc.in, v, ok, tc.want)
		}
	}
}

// A row whose name is only a postal address and whose head cannot be recovered
// carries no holder at all; emitting it is a false holder. The table below puts
// the address line FIRST, so there is nothing above it to recover.
var asciiOrphanAddressRow = `
                  PRINCIPAL STOCKHOLDERS

<TABLE>
<CAPTION>
Name and Address of Beneficial Owner            Number of Shares   Percent
<S>                                             <C>                <C>
  Boston, MA 02110...............................    1,918,000        6.43%
  Wayne, PA......................................    1,772,600        5.10%
Mark B. Logan....................................      183,382        5.40%
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestOrphanAddressRowIsDropped(t *testing.T) {
	rows := run(t, asciiOrphanAddressRow)
	if r := find(rows, "Mark B. Logan", ""); r == nil || r.Percent == nil || *r.Percent != 5.4 {
		t.Fatalf("real holder lost: %+v (parsed %v)", r, holderNames(rows))
	}
	for _, r := range rows {
		if strings.HasPrefix(r.HolderName, "Boston") || strings.HasPrefix(r.HolderName, "Wayne") {
			t.Errorf("orphan address row emitted as a holder: %q", r.HolderName)
		}
	}
}

// A one-row 5% table. Transcribed from 0000057131-99-000013 (cik 57131): the
// proxy has exactly one 5% holder, laid out as a name line plus a city line
// carrying the numbers, with the footnote rule right under it — so the block
// scan collects ONE row and the two-row floor threw the whole table away. The
// filing then scored table_found_no_percent even though its only 5% holder is
// printed with a percent.
var asciiSingleHolderTable = `<TYPE>DEF 14A
<TEXT>
     Table I below identifies each person known to the Company to be a
beneficial owner of more than 5% of the Company's common shares and the number
of common shares owned by such person as of the record date for the annual
meeting.

                                    TABLE I

    Name and Address            Number of Shares          Percent of Class

Monroe Bank & Trust,
Monroe, Michigan  48161           11,859,137(1)              22.691%
- ----------
      (1) The shares reported are held in various trusts of which Monroe Bank &
Trust is the trustee or a co-trustee. In such capacities, Monroe Bank & Trust
has sole or shared investment and/or voting power over these shares.
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIISingleHolderTableIsKept(t *testing.T) {
	rows := run(t, asciiSingleHolderTable)
	r := find(rows, "Monroe Bank & Trust", "")
	if r == nil {
		t.Fatalf("the only 5%% holder was dropped by the two-row floor; parsed: %v", holderNames(rows))
	}
	if r.Percent == nil || *r.Percent != 22.691 {
		t.Errorf("percent = %v, want 22.691", r.Percent)
	}
	if r.Shares == nil || *r.Shares != 11859137 {
		t.Errorf("shares = %v, want 11859137", r.Shares)
	}
}

// A percent written with no leading digit — ".152%", ".077%" — is what a proxy
// prints for a sub-1% holding in a table whose other rows read "22.691%".
func TestLeadingDotPercent(t *testing.T) {
	for _, tc := range []struct {
		in   string
		want float64
	}{{".152%", 0.152}, {".077%", 0.077}, {".5%", 0.5}} {
		v, ok, _, _ := ParsePercent(tc.in)
		if !ok || v != tc.want {
			t.Errorf("ParsePercent(%q) = %v %v, want %v true", tc.in, v, ok, tc.want)
		}
	}
}

// ---------------------------------------------------------------------------
// Class / series / fund identity must reach share_class.
//
// The documented grain is one row per (filing, holder row x share class), so a
// value column pair whose class the parser never labels collapses onto the same
// exact key as its sibling. Three layout classes leave share_class empty.

// M1 — a multi-class table whose LAST column pairs carry no class-shaped header:
// a "Total" column and a "combined voting power" column. Every holder therefore
// emits four rows, two of them with share_class empty and hence duplicate.
const multiClassTotalHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><td colspan="9">Beneficial Ownership</td></tr>
<tr><td></td><td colspan="3">Number of shares beneficially owned</td><td colspan="5">Percentage of shares beneficially owned (1)</td></tr>
<tr><td>Name</td><td>Class A</td><td>Class B</td><td>Total</td><td>Class A</td><td>Class B</td><td>Total</td><td>Percentage of combined voting power of all classes of stock (2)</td></tr>
<tr><td>Michael S. Dunlap</td><td>3,250,452</td><td>9,805,545</td><td>13,055,997</td><td>12.9%</td><td>92.4%</td><td>36.4%</td><td>77.1%</td></tr>
<tr><td>Shelby J. Butterfield</td><td>510</td><td>2,693,178</td><td>2,693,688</td><td>1.2%</td><td>25.4%</td><td>7.5%</td><td>20.5%</td></tr>
</table></body></html>`

func TestMultiClassTotalColumnsGetDistinctShareClass(t *testing.T) {
	rows := ScreenRows(run(t, multiClassTotalHTML))
	seen := map[string]int{}
	n := 0
	for _, r := range rows {
		if r.HolderName != "Michael S. Dunlap" {
			continue
		}
		n++
		seen[r.ShareClass]++
	}
	if n < 2 {
		t.Fatalf("holder emitted %d rows, want the multi-class pairs: %v", n, rows)
	}
	for cls, k := range seen {
		if k > 1 {
			t.Errorf("share_class %q emitted %d times for one holder in one table; "+
				"every value column pair must carry its own label (got %v)", cls, k, seen)
		}
	}
	if seen[""] > 0 {
		t.Errorf("a value column pair was emitted with an empty share_class: %v", seen)
	}
}

// M2 — a row-level "Title of Class" column to the LEFT of the holder column.
// The class label is read as the holder name and the real holder is lost.
const titleOfClassHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners</p>
<table>
<tr><th>Title of Class</th><th>Name and Address of Shareholder</th><th>Percent of Class</th></tr>
<tr><td>Admiral Shares</td><td>Charles Schwab &amp; Co., Inc.</td><td>9.14%</td></tr>
<tr><td></td><td>National Financial Services LLC</td><td>5.90%</td></tr>
<tr><td>ETF Shares</td><td>Charles Schwab &amp; Co., Inc.</td><td>17.49%</td></tr>
<tr><td></td><td>Vanguard Marketing Corporation</td><td>12.46%</td></tr>
</table></body></html>`

func TestTitleOfClassColumnIsClassNotName(t *testing.T) {
	rows := ScreenRows(run(t, titleOfClassHTML))
	if r := find(rows, "Admiral Shares", ""); r != nil {
		t.Errorf("the Title of Class cell was emitted as a holder name: %+v", r)
	}
	r := find(rows, "National Financial Services LLC", "")
	if r == nil {
		t.Fatalf("holder lost; parsed: %v", holderNames(rows))
	}
	if r.ShareClass != "Admiral Shares" {
		t.Errorf("share_class = %q, want %q (forward-filled from the row above)", r.ShareClass, "Admiral Shares")
	}
	if s := find(rows, "Charles Schwab & Co., Inc", "ETF Shares"); s == nil {
		t.Errorf("the two Schwab rows must differ by share_class: %v", rows)
	}
}

// M4 — a per-fund 5% record-holder table in a fund-family proxy. The leading
// "Fund" column is taken as the holder name, so every row of the table carries
// the fund's name and the real record holders vanish.
const perFundHolderHTML = `<html><body>
<p>Principal Shareholders: beneficial ownership of record</p>
<table>
<tr><th>Fund</th><th>Name and Address</th><th>Percentage of Class and Type of Ownership</th><th>Percentage of Fund</th></tr>
<tr><td>ING Classic Money Market Fund</td><td>Pershing Div of DLJ Secs Corp</td><td>91.5%</td><td>88.9%</td></tr>
<tr><td>ING Classic Money Market Fund</td><td>Citigroup Global Markets, Inc.</td><td>6.0%</td><td>0.9%</td></tr>
<tr><td>ING Disciplined SmallCap Fund</td><td>LPL Financial Services</td><td>16.3%</td><td>0.4%</td></tr>
</table></body></html>`

func TestPerFundColumnIsClassNotName(t *testing.T) {
	rows := ScreenRows(run(t, perFundHolderHTML))
	if r := find(rows, "ING Classic Money Market Fund", ""); r != nil {
		t.Errorf("the Fund cell was emitted as a holder name: %+v", r)
	}
	r := find(rows, "Pershing Div of DLJ Secs Corp", "")
	if r == nil {
		t.Fatalf("record holder lost; parsed: %v", holderNames(rows))
	}
	if !strings.HasPrefix(r.ShareClass, "ING Classic Money Market Fund") {
		t.Errorf("share_class = %q, want it to lead with the fund name", r.ShareClass)
	}
	// The two percent columns of one fund row are two different figures and must
	// not collapse onto one key.
	f := find(rows, "Pershing Div of DLJ Secs Corp", "")
	_ = f
	seen := map[string]int{}
	for _, x := range rows {
		if x.HolderName == "Pershing Div of DLJ Secs Corp" {
			seen[x.ShareClass]++
		}
	}
	for cls, k := range seen {
		if k > 1 {
			t.Errorf("share_class %q emitted %d times for one holder: %v", cls, k, seen)
		}
	}
}

// M3 — a fund-family proxy's director COMPENSATION table. It carries trustee
// names, dollar amounts and the phrase "fund shares owned", so the ownership
// cue matches and the dollars land in `shares`. The table is repeated once per
// fund, so every trustee is emitted dozens of times. These rows are not
// ownership at all and must not be emitted.
const trusteeCompHTML = `<html><body>
<p>Trustee compensation and ownership of fund shares</p>
<table>
<tr><td>Name</td><td>Aggregate compensation from Fund (inc. voluntarily deferred compensation)</td><td>Total compensation from all Funds</td><td>Dollar range of Fund shares owned</td></tr>
<tr><td>William H. Baribault</td><td>$3,306</td><td>$390,631</td><td>None</td></tr>
<tr><td>James G. Ellis</td><td>3,294</td><td>393,969</td><td>None</td></tr>
<tr><td>Leonard R. Fuller</td><td>3,215</td><td>387,131</td><td>$10,001 - $50,000</td></tr>
</table></body></html>`

func TestTrusteeCompensationTableIsNotOwnership(t *testing.T) {
	rows := ScreenRows(run(t, trusteeCompHTML))
	if len(rows) != 0 {
		t.Fatalf("a compensation table was read as ownership: %d rows, %v", len(rows), rows)
	}
}

// M4, second shape — several funds in ONE table, separated by a full-width label
// row naming the fund. The fund names come from the filing's own SGML header
// (<SERIES-NAME>), so the label row is identifiable without guessing.
const inTableFundLabelHTML = `<html><body>
<p>Shareholders with more than 5% record and/or beneficial ownership</p>
<table>
<tr><td colspan="3">Vanguard 500 Index Fund (1976)</td></tr>
<tr><td>Title of Class</td><td>Name and Address of Shareholder</td><td>Percent of Class</td></tr>
<tr><td>Investor Shares</td><td>Charles Schwab &amp; Co., Inc.</td><td>8.59%</td></tr>
<tr><td colspan="3">Vanguard Balanced Index Fund (1992)</td></tr>
<tr><td>Investor Shares</td><td>Charles Schwab &amp; Co., Inc.</td><td>6.11%</td></tr>
</table></body></html>`

func TestInTableFundLabelRowSeparatesFunds(t *testing.T) {
	base := Row{Accession: "acc", CIK: "cik", Company: "Co", FilingDate: "2017-01-01",
		series: []string{"Vanguard 500 Index Fund", "Vanguard Balanced Index Fund"}}
	raw, _, _ := ExtractHTML(inTableFundLabelHTML, base)
	rows := ScreenRows(raw)
	seen := map[string]int{}
	for _, r := range rows {
		if strings.HasPrefix(r.HolderName, "Charles Schwab") {
			seen[r.ShareClass]++
		}
	}
	if len(seen) != 2 {
		t.Fatalf("the same holder in two funds must carry two share_class values, got %v (rows %v)", seen, rows)
	}
	for cls, k := range seen {
		if k != 1 {
			t.Errorf("share_class %q emitted %d times: %v", cls, k, seen)
		}
		if !strings.Contains(cls, "Index Fund") {
			t.Errorf("share_class %q does not name the fund", cls)
		}
	}
}

// An operating company declares no series, so none of the fund machinery may
// fire: one series name is not enough to disambiguate anything.
func TestSeriesLabellingOffWithoutTwoSeries(t *testing.T) {
	base := Row{Accession: "acc", CIK: "cik", FilingDate: "2017-01-01",
		series: []string{"Vanguard 500 Index Fund"}}
	a, _, _ := ExtractHTML(simpleHTML, base)
	b, _, _ := ExtractHTML(simpleHTML, Row{Accession: "acc", CIK: "cik", FilingDate: "2017-01-01"})
	if len(a) != len(b) {
		t.Fatalf("row count differs with one declared series: %d vs %d", len(a), len(b))
	}
	for i := range a {
		if a[i].ShareClass != b[i].ShareClass || a[i].classHint != b[i].classHint {
			t.Errorf("row %d labelled differently: %q/%q vs %q/%q", i,
				a[i].ShareClass, a[i].classHint, b[i].ShareClass, b[i].classHint)
		}
	}
}

// A fund table states BOTH the fund and the share class, in two columns of
// their own, and needs both to identify the holding: one broker is a 5% record
// holder of class A and class C of the same fund, and of several funds.
const fundAndClassColumnsHTML = `<html><body>
<p>Principal shareholders: 5% record ownership of each fund</p>
<table>
<tr><td>Fund</td><td>Class</td><td>Name</td><td>Location</td><td>Number of Shares of Class</td><td>% of Class</td></tr>
<tr><td>AB Value Fund</td><td>A</td><td>Pershing LLC</td><td>Jersey City, NJ</td><td>195,416</td><td>16.71%</td></tr>
<tr><td></td><td>C</td><td>Pershing LLC</td><td>Jersey City, NJ</td><td>71,452</td><td>6.11%</td></tr>
<tr><td>AB Select US Equity</td><td>A</td><td>Pershing LLC</td><td>Jersey City, NJ</td><td>54,234</td><td>7.73%</td></tr>
</table></body></html>`

func TestFundAndClassColumnsBothReachShareClass(t *testing.T) {
	rows := ScreenRows(run(t, fundAndClassColumnsHTML))
	seen := map[string]int{}
	for _, r := range rows {
		if r.HolderName == "Pershing LLC" {
			seen[r.ShareClass]++
		}
	}
	if len(seen) != 3 {
		t.Fatalf("one broker, three (fund, class) holdings, want 3 distinct share_class, got %v", seen)
	}
	for cls, k := range seen {
		if k != 1 {
			t.Errorf("share_class %q emitted %d times: %v", cls, k, seen)
		}
	}
}

// The class column's header is often more than the bare keyword ("Fund and
// Share Class", "Fund/Share Class"), and a table also carries a full-width
// sub-heading row that colspan expansion repeats across every column. Neither
// may cost the row-level class column its role.
const fundShareClassHeaderHTML = `<html><body>
<p>Beneficial Ownership of Certain Beneficial Owners</p>
<table>
<tr><td>Fund and Share Class</td><td>Name of Beneficial Owner</td><td>Shares</td><td>Percent of Class</td></tr>
<tr><td colspan="4">Board Members/Nominees who are not interested persons of the Funds</td></tr>
<tr><td>Senior Income (NSL) - Common Shares</td><td>Jack B. Evans</td><td>10,000</td><td>6.1%</td></tr>
<tr><td>Floating Rate Income (JRO) - Common Shares</td><td>Jack B. Evans</td><td>1,600</td><td>5.4%</td></tr>
</table></body></html>`

func TestFundShareClassHeaderKeepsClassRole(t *testing.T) {
	rows := ScreenRows(run(t, fundShareClassHeaderHTML))
	seen := map[string]int{}
	for _, r := range rows {
		if r.HolderName == "Jack B. Evans" {
			seen[r.ShareClass]++
		}
	}
	if len(seen) != 2 {
		t.Fatalf("two funds, want 2 distinct share_class, got %v (rows %v)", seen, rows)
	}
	if seen[""] > 0 {
		t.Errorf("a row was emitted with no class though the table states one: %v", seen)
	}
}

// A per-fund holder table that runs over a page break arrives as a SECOND table
// with no header of its own. Without the first table's headers the parser cannot
// tell its two percent columns apart, so both of a holder's figures land on one
// key. The continuation table must inherit the headers it is a continuation of.
const continuationTableHTML = `<html><body>
<p>Principal Shareholders: 5% record and beneficial ownership</p>
<table>
<tr><td>Fund</td><td>Name and Address</td><td>Percentage of Class and Type of Ownership</td><td>Percentage of Fund</td></tr>
<tr><td>Acme Money Market Fund</td><td>Pershing Div of DLJ Secs Corp</td><td>91.5% Class A; Beneficial</td><td>88.9%</td></tr>
<tr><td>Acme Money Market Fund</td><td>Citigroup Global Markets, Inc.</td><td>6.0% Class B; Beneficial</td><td>0.9%</td></tr>
</table>
<table>
<tr><td>Acme SmallCap Fund</td><td>LPL Financial Services</td><td>16.3% Class A; Beneficial</td><td>4.4%</td></tr>
<tr><td>Acme SmallCap Fund</td><td>Pershing Div of DLJ Secs Corp</td><td>11.7% Class A; Beneficial</td><td>3.1%</td></tr>
</table></body></html>`

func TestContinuationTableInheritsHeaders(t *testing.T) {
	rows := ScreenRows(run(t, continuationTableHTML))
	seen := map[string]int{}
	for _, r := range rows {
		if r.HolderName == "Pershing Div of DLJ Secs Corp" {
			seen[r.ShareClass]++
		}
	}
	if len(seen) == 0 {
		t.Fatalf("holder lost entirely: %v", holderNames(rows))
	}
	for cls, k := range seen {
		if k > 1 {
			t.Errorf("share_class %q emitted %d times for one holder; the continuation "+
				"table's percent columns were not told apart: %v", cls, k, seen)
		}
	}
	if len(seen) != 4 {
		t.Errorf("two funds x two percent columns = 4 keys, got %d: %v", len(seen), seen)
	}
}
