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
		"All directors",                                   // 0000703799-00-000022
		"All directors and executive officers",            // 0000011199-96 / many
		"All executive officers and",                      // 0000103872-00-000184
		"Directors and executive officers",                // 0000057528-96-001104
		"ALL DIRECTORS AND EXECUTIVE OFFICERS",            // 0000094328-00-000012
		"(24 Persons)",                                    // 0000094328-00-000012
		"Directors (22 persons,",                          // 0000899681-97-000161
		"those listed above)",                             // 0000899681-96-000050
		"Group (18 persons)",                              // 0000025445-96-000246
		"Group (7 in number)",                             // 0000700612-98-000005
		"officers",                                        // 0000912057-97-014579
		"All nominees, directors and named officers as a", // 0000950128-98-000652
		"Non-Executive Director Group (6 persons)",        // 0000892569-98-001409
		"(28 persons, including those named above)",       // 0000950124-00-001884
		"All directors, directors emeritus and",           // 0000050863-97-000028
		"Executive Officers and Directors",                // 0000912057-96-021732
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

// A STACKED cell: one grid cell holds several values, one per share class,
// separated by line breaks. Flattening it concatenates the digits into a share
// count that cannot exist (33,870,629 / 712,172 / 631,060 read as 3.4e19) and
// collapses three real holdings onto one key.
const stackedCellHTML = `<html><body>
<p>Principal Shareholders: 5% record ownership of each fund</p>
<table>
<tr><td></td><td></td><td colspan="2">AHIM</td><td colspan="2">AHIT</td></tr>
<tr><td>Name and Address</td><td>Class</td><td>Shares Held</td><td>As % of shares outstanding, record or beneficial</td><td>Shares Held</td><td>As % of shares outstanding, record or beneficial</td></tr>
<tr><td>Edward D. Jones &amp; Co. Omnibus Account</td><td>A<br>B<br>C</td><td>33,870,629<br>712,172<br>631,060</td><td>25.03<br>20.65<br>6.56</td><td>239,940,628<br>9,218,274<br>-</td><td>24.85<br>16.75<br>-</td></tr>
<tr><td>First Clearing, LLC Custody Account</td><td>A<br>B</td><td>12,480,283<br>390,344</td><td>9.22<br>11.32</td><td>79,963,790<br>6,491,940</td><td>8.28<br>11.80</td></tr>
</table></body></html>`

func TestStackedCellSplitsIntoOneRowPerClass(t *testing.T) {
	rows := ScreenRows(run(t, stackedCellHTML))
	var got []*Row
	for i := range rows {
		if strings.HasPrefix(rows[i].HolderName, "Edward D. Jones") {
			got = append(got, &rows[i])
		}
	}
	if len(got) == 0 {
		t.Fatalf("holder lost: %v", holderNames(rows))
	}
	for _, r := range got {
		if r.Shares != nil && *r.Shares > 1e12 {
			t.Errorf("share count %v cannot exist: the stacked cell's lines were "+
				"concatenated (class %q)", *r.Shares, r.ShareClass)
		}
	}
	// A: 33,870,629 at 25.03% of AHIM is one holding; B: 712,172 at 20.65% is
	// another. Both must be present and distinguishable.
	var a, b *Row
	for _, r := range got {
		if r.Shares != nil && *r.Shares == 33870629 {
			a = r
		}
		if r.Shares != nil && *r.Shares == 712172 {
			b = r
		}
	}
	if a == nil || b == nil {
		cls := []string{}
		for _, r := range got {
			cls = append(cls, r.ShareClass)
		}
		t.Fatalf("the per-class holdings were not emitted separately; classes %v", cls)
	}
	if a.Percent == nil || *a.Percent != 25.03 {
		t.Errorf("class A percent = %v, want 25.03", a.Percent)
	}
	if b.Percent == nil || *b.Percent != 20.65 {
		t.Errorf("class B percent = %v, want 20.65", b.Percent)
	}
	if a.ShareClass == b.ShareClass {
		t.Errorf("two classes share one key: %q", a.ShareClass)
	}
	// Nine holdings: two holders x two funds x their classes, every one on its
	// own key, and the label must name the FUND as well as the class -- the
	// deepest header row ("Shares Held" / "As %...") is identical over both
	// funds and cannot be the key.
	if len(rows) != 9 {
		t.Errorf("want 9 rows (2 holders x 2 funds x classes), got %d", len(rows))
	}
	if !strings.Contains(a.ShareClass, "AHIM") {
		t.Errorf("share_class %q does not name the fund column group", a.ShareClass)
	}
	keys := map[string]int{}
	for _, r := range rows {
		keys[r.HolderName+"|"+r.ShareClass]++
	}
	for k, n := range keys {
		if n > 1 {
			t.Errorf("key %q emitted %d times", k, n)
		}
	}
}

// A cell stacking a share count OVER its percent is ONE holding written on two
// lines, not one holding per class, and must be read whole. Splitting it would
// read the share count as a percent and lose the row.
func TestStackedSharesOverPercentIsOneHolding(t *testing.T) {
	for _, tc := range []struct{ in, want string }{
		{"75,000\n3.7%", "75,000 3.7%"},                // shares over percent: read whole
		{"33,870,629\n712,172\n631,060", "33,870,629"}, // one share count per class
		{"25.03\n20.65\n6.56", "25.03"},                // one percent per class
		{"A\nB\nC", "A"},                               // one class token per class
		{"-\n10,422,766\n5,344,804", "-"},              // a dash is a missing line
		{"The Vanguard Group\n100 Vanguard Blvd", "The Vanguard Group 100 Vanguard Blvd"},
	} {
		if got := stackFirst(tc.in); got != tc.want {
			t.Errorf("stackFirst(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// A fund-family proxy prints the same holder table, headers and all, once per
// page, and writes the Fund only on the row where it changes. The first rows of
// every page but the first therefore carry a blank fund that belongs to the
// page before, and without carrying it across the two tables the same broker's
// holdings in different funds collapse onto one key.
const repeatedTablePagesHTML = `<html><body>
<p>Principal Shareholders: 5% record ownership of each fund</p>
<table>
<tr><td>Fund</td><td>Class</td><td>Name</td><td>Number of Shares of Class</td><td>% of Class</td></tr>
<tr><td>AB All Market Portfolio</td><td>A</td><td>Charles Schwab &amp; Co.</td><td>328,210</td><td>23.95%</td></tr>
<tr><td></td><td>C</td><td>Charles Schwab &amp; Co.</td><td>71,452</td><td>6.11%</td></tr>
</table>
<table>
<tr><td>Fund</td><td>Class</td><td>Name</td><td>Number of Shares of Class</td><td>% of Class</td></tr>
<tr><td></td><td>R</td><td>Charles Schwab &amp; Co.</td><td>49,619</td><td>8.79%</td></tr>
<tr><td>AB Value Fund</td><td>A</td><td>Charles Schwab &amp; Co.</td><td>62,739</td><td>5.76%</td></tr>
</table></body></html>`

func TestFundCarriesToTheNextPageOfTheSameTable(t *testing.T) {
	rows := ScreenRows(run(t, repeatedTablePagesHTML))
	seen := map[string]int{}
	for _, r := range rows {
		if strings.HasPrefix(r.HolderName, "Charles Schwab") {
			seen[r.ShareClass]++
		}
	}
	if len(seen) == 0 {
		t.Fatalf("holder lost: %v", holderNames(rows))
	}
	for cls, n := range seen {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times: %v", cls, n, seen)
		}
	}
	var carried string
	for cls := range seen {
		if strings.Contains(cls, "All Market") && strings.Contains(cls, "R") {
			carried = cls
		}
	}
	if carried == "" {
		t.Errorf("the class-R row on page two did not inherit the fund from page one: %v", seen)
	}
}

// An ASCII fund-family proxy writes the fund and the share class on LABEL LINES
// of their own, indented to show which contains which. They carry no number, so
// they are not table rows at all and their identity was simply lost: one record
// holder of three classes of one fund collapsed onto one key.
var asciiFundClassLabels = `
                            PRINCIPAL SHAREHOLDERS

                                           PERCENTAGE OF
FUND/                                      OUTSTANDING
CLASS      SHAREHOLDER                     SHARES OWNED OF RECORD
- --------------------------------------------------------------------------------
LIVESTRONG Income Portfolio
- --------------------------------------------------------------------------------
  Investor Class
           The Chase Manhattan Bank NA     7%
           JPMorgan Chase Bank Trustee     34%
  Institutional Class
           The Chase Manhattan Bank NA     24%
           JPMorgan Chase Bank Trustee     21%
  R Class
           The Chase Manhattan Bank NA     50%
           JPMorgan Chase Bank Trustee     11%
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIIFundAndClassLabelLines(t *testing.T) {
	rows := ScreenRows(run(t, asciiFundClassLabels))
	seen := map[string]int{}
	for _, r := range rows {
		if strings.HasPrefix(r.HolderName, "JPMorgan Chase") {
			seen[r.ShareClass]++
		}
	}
	if len(seen) == 0 {
		t.Fatalf("holder lost: %v", holderNames(rows))
	}
	for cls, n := range seen {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times for one holder: %v", cls, n, seen)
		}
	}
	got := 0
	for cls := range seen {
		if strings.Contains(cls, "Class") {
			got++
		}
		if !strings.Contains(cls, "LIVESTRONG") {
			t.Errorf("share_class %q does not name the fund the class sits under", cls)
		}
	}
	if got < 2 {
		t.Errorf("want the class label on at least two of the holder's rows, got %v", seen)
	}
}

// An award / plan-benefits table repeats the SAME people as the ownership table
// with a different share count and no percent of its own, so the directors are
// emitted twice on one exact key. The share column says what the shares ARE —
// "Option Shares", "Number of Shares Underlying SSAR/Option Grants" — and never
// that they are OWNED, which is what separates it from a genuine ownership table
// that happens to state no percent (J&J's directors table: common shares,
// deferred units, options, total).
const awardTableHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><th>Name of Beneficial Owner</th><th>Shares Beneficially Owned</th><th colspan="2">Percent of Class</th></tr>
<tr><td>Jeffrey H. Burbank</td><td>1,200,000</td><td>4.1</td><td>%</td></tr>
<tr><td>Joseph E. Turk, Jr.</td><td>400,000</td><td>1.4</td><td>%</td></tr>
<tr><td>All directors and executive officers as a group (9 persons)</td><td>2,000,000</td><td>6.8</td><td>%</td></tr>
</table>
<p>Approval of the amendment to the equity incentive plan. The shares beneficially owned by our named executive officers are shown above.</p>
<table>
<tr><th>Name</th><th colspan="2">Option Shares</th></tr>
<tr><td>Jeffrey H. Burbank</td><td></td><td>767,955</td></tr>
<tr><td>Joseph E. Turk, Jr.</td><td></td><td>290,808</td></tr>
<tr><td>All directors and executive officers as a group (9 persons)</td><td></td><td>1,500,000</td></tr>
</table></body></html>`

func TestAwardTableIsNotOwnership(t *testing.T) {
	rows := run(t, awardTableHTML)
	n := 0
	for _, r := range rows {
		if r.HolderName == "Jeffrey H. Burbank" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("Jeffrey H. Burbank emitted %d times, want 1: %v", n, holderNames(rows))
	}
	if r := find(rows, "Jeffrey H. Burbank", ""); r == nil || r.Shares == nil || *r.Shares != 1200000 {
		t.Errorf("the ownership row was lost or replaced: %+v", r)
	}
}

// The control: a genuine ownership table with NO percent column at all. Its
// share columns say the shares are owned, so it must still be read.
const noPercentOwnershipHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><th>Name</th><th>Common Shares Owned</th><th>Deferred Units</th><th>Total Shares Beneficially Owned</th></tr>
<tr><td>Mary A. Roe</td><td>12,000</td><td>3,000</td><td>15,000</td></tr>
<tr><td>John Q. Public</td><td>8,000</td><td>1,000</td><td>9,000</td></tr>
<tr><td>All directors and executive officers as a group (11 persons)</td><td>60,000</td><td>9,000</td><td>69,000</td></tr>
</table></body></html>`

func TestNoPercentOwnershipTableStillRead(t *testing.T) {
	rows := run(t, noPercentOwnershipHTML)
	if r := find(rows, "Mary A. Roe", ""); r == nil || r.Shares == nil || *r.Shares != 15000 {
		t.Fatalf("no-percent ownership table lost: %+v (%v)", r, holderNames(rows))
	}
}

// An ADDITIVE ownership table spells the arithmetic out in columns of its own:
// record shares + savings-plan shares + deferred shares + option shares = total,
// then the percent. A lone "+" matches the star / footnote marker pattern, so
// each glue column voted itself a PERCENT column and the row was emitted once
// per component pair — four identical-key rows per holder.
const additiveGlueHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><td>Name</td><td>Record &amp; Street Name Shares(1)</td><td>+</td><td>Savings Plan Shares(2)</td><td>+</td><td>Deferred Stock Shares(3)</td><td>+</td><td>Stock Option Shares(4)</td><td>=</td><td>Total Beneficial Ownership</td><td>Percent of Class</td></tr>
<tr><td>W.N. Avrin</td><td>15,038</td><td></td><td>7,168</td><td></td><td>2,143</td><td></td><td>141,329</td><td></td><td>165,678</td><td>0.4</td></tr>
<tr><td>D.M. Drillock</td><td>37,719</td><td></td><td>25,160</td><td></td><td>14,165</td><td></td><td>120,815</td><td></td><td>197,859</td><td>0.4</td></tr>
<tr><td>S.D. Fleming</td><td>17,272</td><td></td><td>49,420</td><td></td><td>62,040</td><td></td><td>333,352</td><td></td><td>462,084</td><td>1.0</td></tr>
</table></body></html>`

func TestAdditiveGlueColumnsAreNotPercents(t *testing.T) {
	rows := run(t, additiveGlueHTML)
	n := 0
	for _, r := range rows {
		if r.HolderName == "W.N. Avrin" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("W.N. Avrin emitted %d times, want 1: %v", n, holderNames(rows))
	}
	r := find(rows, "W.N. Avrin", "")
	if r == nil || r.Shares == nil || *r.Shares != 165678 {
		t.Errorf("want the TOTAL column as the share count: %+v", r)
	}
	if r == nil || r.Percent == nil || *r.Percent != 0.4 {
		t.Errorf("percent wrong: %+v", r)
	}
}

// The control: components of ONE holding, no percent column. "Total" names one of
// them, so the table is still one row per holder.
func TestComponentColumnsStayOneRow(t *testing.T) {
	rows := run(t, noPercentOwnershipHTML)
	n := 0
	for _, r := range rows {
		if r.HolderName == "Mary A. Roe" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("component columns emitted %d rows for one holder, want 1: %v", n, holderNames(rows))
	}
}

// A percent column whose header cell IS the "%" sign and whose data cells are
// only markers ("*") is a percent column of its own. Read as the bare "%" glyph
// column that trails a value, it flagged the NUMBER column to its left as a
// percent, so every class's share count was paired as a percent and the holder
// was emitted once per column with a colliding label.
const pctHeaderGlyphHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><td></td><td colspan="2">Class A Common Stock Beneficially Owned</td><td colspan="2">Class B Common Stock Beneficially Owned</td></tr>
<tr><td>Name of Beneficial Owner</td><td>Number</td><td>%</td><td>Number</td><td>%</td></tr>
<tr><td>FI Station Investor LLC</td><td>42,199</td><td>*</td><td>22,613,985</td><td>48.2</td></tr>
<tr><td>Fertitta Business Management LLC</td><td>10,127</td><td>*</td><td>28,198,618</td><td>60.1</td></tr>
<tr><td>FBM Sub 1 LLC</td><td>-</td><td>*</td><td>6,000,000</td><td>12.8</td></tr>
</table></body></html>`

func TestPercentHeaderGlyphIsItsOwnColumn(t *testing.T) {
	rows := run(t, pctHeaderGlyphHTML)
	var got []Row
	for _, r := range rows {
		if r.HolderName == "FI Station Investor LLC" {
			got = append(got, r)
		}
	}
	if len(got) != 2 {
		t.Fatalf("want one row per class, got %d: %+v", len(got), got)
	}
	cls := map[string]bool{}
	for _, r := range got {
		cls[r.ShareClass] = true
	}
	if len(cls) != 2 {
		t.Errorf("the two class rows share a label: %v", cls)
	}
	for _, r := range got {
		if r.Shares == nil {
			t.Errorf("the Number column was not read as a share count: %+v", r)
		}
	}
}

// A multi-class table states the CLASS one header row up and the QUANTITY one
// row down: "Series A", "Series B", then "Series A and Series B" over BOTH a
// share-number pair and a combined-VOTES pair. The class row alone gives the
// last two pairs one label, so two distinct holdings landed on one key.
const tiedPairLabelHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><td colspan="9">Shares of Common Stock Beneficially Owned And Percentage of Outstanding Shares</td></tr>
<tr><td></td><td colspan="2"></td><td colspan="2"></td><td colspan="4">Combined</td></tr>
<tr><td></td><td colspan="2">Series A</td><td colspan="2">Series B</td><td colspan="2">Series A and Series B</td><td colspan="2">Series A and Series B</td></tr>
<tr><td>Name</td><td>Number</td><td>Percent</td><td>Number</td><td>Percent</td><td>Number</td><td>Percent</td><td>Votes</td><td>Percent</td></tr>
<tr><td>James M. Moroney III</td><td>179,037</td><td>1.1</td><td>602,019</td><td>24.3</td><td>781,056</td><td>3.5</td><td>6,199,227</td><td>14.0</td></tr>
<tr><td>Robert W. Decherd</td><td>467,100</td><td>2.4</td><td>1,548,000</td><td>62.3</td><td>2,015,100</td><td>9.0</td><td>15,947,100</td><td>36.1</td></tr>
</table></body></html>`

func TestTiedPairLabelsAreSplit(t *testing.T) {
	rows := ScreenRows(run(t, tiedPairLabelHTML))
	cls := map[string]int{}
	for _, r := range rows {
		if r.HolderName == "James M. Moroney III" {
			cls[r.ShareClass]++
		}
	}
	if len(cls) == 0 {
		t.Fatalf("holder lost: %v", holderNames(rows))
	}
	for c, n := range cls {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times for one holder: %v", c, n, cls)
		}
	}
}

// A target-date fund's name carries the YEAR, and the sticky-label scan rejected
// any line holding a digit, so every dated portfolio of a fund family lost its
// fund identity and its record holders collapsed onto one key per class.
var asciiDatedFundLabels = `
                            PRINCIPAL SHAREHOLDERS

                                           PERCENTAGE OF
FUND/                                      OUTSTANDING
CLASS      SHAREHOLDER                     SHARES OWNED OF RECORD
LIVESTRONG 2015 Portfolio
- --------------------------------------------------------------------------------
  Investor Class
           The Chase Manhattan Bank NA     7%
           JPMorgan Chase Bank Trustee     37%
LIVESTRONG 2025 Portfolio
- --------------------------------------------------------------------------------
  Investor Class
           The Chase Manhattan Bank NA     12%
           JPMorgan Chase Bank Trustee     26%
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIIDatedFundLabelLines(t *testing.T) {
	rows := ScreenRows(run(t, asciiDatedFundLabels))
	seen := map[string]int{}
	for _, r := range rows {
		if strings.HasPrefix(r.HolderName, "JPMorgan Chase") {
			seen[r.ShareClass]++
		}
	}
	if len(seen) == 0 {
		t.Fatalf("holder lost: %v", holderNames(rows))
	}
	for cls, n := range seen {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times for one holder: %v", cls, n, seen)
		}
		if !strings.Contains(cls, "2015") && !strings.Contains(cls, "2025") {
			t.Errorf("share_class %q does not name the dated fund: %v", cls, seen)
		}
	}
}

// A fund-family proxy states each board member's holding in ONE COLUMN PER FUND
// with no percent anywhere, and when the funds outrun the page width it repeats
// its title and a NEW column header INSIDE the same table for the next batch.
// Read as components of one holding, only the first column was emitted and every
// member came back once per batch on one empty key.
const perFundColumnsHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><td colspan="4">Fund Shares Owned by Board Members and Officers</td></tr>
<tr><td>Board Member/Nominees</td><td>All Cap Energy</td><td>Core Equity</td><td>Credit Strategies</td></tr>
<tr><td colspan="4">Board Members/Nominees who are not interested persons of the Funds</td></tr>
<tr><td>Jack B. Evans</td><td>0</td><td>0</td><td>1,600</td></tr>
<tr><td>Judith M. Stockdale</td><td>0</td><td>1,130</td><td>2,652</td></tr>
<tr><td>All Board Members and Officers as a group (11 persons)</td><td>0</td><td>1,130</td><td>4,252</td></tr>
<tr><td colspan="4">Fund Shares Owned by Board Members and Officers</td></tr>
<tr><td>Board Member/Nominees</td><td>Global Equity</td><td>Maryland Premium</td><td>Missouri Premium</td></tr>
<tr><td>Jack B. Evans</td><td>0</td><td>0</td><td>0</td></tr>
<tr><td>Judith M. Stockdale</td><td>11,000</td><td>0</td><td>0</td></tr>
<tr><td>All Board Members and Officers as a group (11 persons)</td><td>13,000</td><td>2,500</td><td>0</td></tr>
</table></body></html>`

func TestPerFundColumnsAndInteriorHeader(t *testing.T) {
	rows := ScreenRows(run(t, perFundColumnsHTML))
	seen := map[string]int{}
	vals := map[string]float64{}
	for _, r := range rows {
		if r.HolderName == "Judith M. Stockdale" {
			seen[r.ShareClass]++
			if r.Shares != nil {
				vals[r.ShareClass] = *r.Shares
			}
		}
	}
	if len(seen) != 6 {
		t.Fatalf("want one labelled row per fund column across BOTH header blocks, got %v", seen)
	}
	for cls, n := range seen {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times: %v", cls, n, seen)
		}
		if cls == "" {
			t.Errorf("a per-fund row carries no share_class: %v", seen)
		}
	}
	if vals["Core Equity"] != 1130 || vals["Global Equity"] != 11000 {
		t.Errorf("fund columns mislabelled: %v", vals)
	}
}

// A multi-security company writes ONE 5% table per class, and the only thing
// that says which class a table is about is a short heading line above it. The
// directors are listed under every one of them with no holding, so without the
// heading the same name lands on the same empty key once per class.
const classHeadingPerTableHTML = `<html><body>
<p>Beneficial Ownership</p>
<p>Series N Preferred Stock</p>
<table>
<tr><th>Name and Address of Beneficial Owner</th><th>Amount and Nature of Beneficial Ownership</th><th colspan="2">Percentage Owned</th></tr>
<tr><td>Crestview Capital Master, LLC</td><td>1,021,269</td><td>51.2</td><td>%</td></tr>
<tr><td>SF Capital Partners Ltd</td><td>477,731</td><td>23.9</td><td>%</td></tr>
<tr><td>Jeffrey Hendrickson</td><td>&#8212;</td><td>*</td><td></td></tr>
</table>
<p>Beneficial Ownership</p>
<p>Series P Preferred Stock</p>
<table>
<tr><th>Name and Address of Beneficial Owner</th><th>Amount and Nature of Beneficial Ownership</th><th colspan="2">Percentage Owned</th></tr>
<tr><td>Gryphon Master Fund, L.P.</td><td>265,319</td><td>49.9</td><td>%</td></tr>
<tr><td>GSSF Master Fund, LP</td><td>133,659</td><td>24.8</td><td>%</td></tr>
<tr><td>Jeffrey Hendrickson</td><td>&#8212;</td><td>*</td><td></td></tr>
</table></body></html>`

func TestClassHeadingLabelsItsTable(t *testing.T) {
	rows := ScreenRows(run(t, classHeadingPerTableHTML))
	seen := map[string]int{}
	for _, r := range rows {
		if r.HolderName == "Jeffrey Hendrickson" {
			seen[r.ShareClass]++
		}
	}
	if len(seen) == 0 {
		t.Fatalf("holder lost: %v", holderNames(rows))
	}
	for cls, n := range seen {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times for one holder: %v", cls, n, seen)
		}
		if !strings.Contains(cls, "Series") {
			t.Errorf("share_class %q does not name the class heading above the table: %v", cls, seen)
		}
	}
}

// A fund's 5% record holder is laid out over two grid rows: the holder's name
// alone, then a parenthesised qualifier with the percent beside it. The
// qualifier row was emitted as a holder of its own, and cleanHolderName then
// stripped the parenthesis and left the name EMPTY -- so every such row in the
// document collapsed onto one empty key.
const wrappedParenNameHTML = `<html><body>
<p>Shareholders with more than 5% record or beneficial ownership of this fund</p>
<table>
<tr><th>Title of Class</th><th>Name and Address of Shareholder</th><th>Percent of Class</th></tr>
<tr><td>Investor Shares</td><td>Transamerica Premier Life Insurance Company</td><td></td></tr>
<tr><td></td><td>(Vanguard Variable Annuity)</td><td>76.56%</td></tr>
<tr><td></td><td>Transamerica Financial Life Insurance Company</td><td></td></tr>
<tr><td></td><td>(Vanguard Variable Annuity)</td><td>5.06%</td></tr>
</table></body></html>`

func TestParenContinuationTakesTheNameAbove(t *testing.T) {
	rows := ScreenRows(run(t, wrappedParenNameHTML))
	for _, r := range rows {
		if strings.TrimSpace(r.HolderName) == "" {
			t.Errorf("a row was emitted with no holder name: %+v", r)
		}
	}
	got := map[string]float64{}
	for _, r := range rows {
		if r.Percent != nil {
			got[r.HolderName] = *r.Percent
		}
	}
	if got["Transamerica Premier Life Insurance Company"] != 76.56 ||
		got["Transamerica Financial Life Insurance Company"] != 5.06 {
		t.Errorf("the qualifier row did not take the name above it: %v", got)
	}
}

// A fund-family proxy heads each per-fund table with the FAMILY name, an em
// dash, the fund, and its launch year: "Vanguard Variable Insurance
// Fund—Balanced Portfolio (1991)". The declared series is "Balanced Portfolio",
// and matching only whole-line or trailing-word-dropped forms missed it, so
// every fund's record holders collapsed onto one key.
func TestMatchSeriesInsideAFamilyHeading(t *testing.T) {
	set := SeriesSet([]string{"Balanced Portfolio", "Equity Income Portfolio"})
	for _, tc := range []struct{ line, want string }{
		{"Vanguard Variable Insurance Fund—Balanced Portfolio (1991)", "Balanced Portfolio"},
		{"Vanguard Variable Insurance Fund - Equity Income Portfolio", "Equity Income Portfolio"},
		{"Balanced Portfolio", "Balanced Portfolio"},
		{"Shareholders with more than 5% record ownership of this fund", ""},
	} {
		if got := MatchSeries(set, tc.line); got != tc.want {
			t.Errorf("MatchSeries(%q) = %q, want %q", tc.line, got, tc.want)
		}
	}
}

// A closed-end fund family that declares no series in its SGML header still
// names each fund on a full-width row inside the table, ending in "Fund:". With
// no declared series to match against, the label was ignored and one record
// holder of a dozen funds collapsed onto one key.
const undeclaredFundLabelRowHTML = `<html><body>
<p>Share Ownership Over 5%</p>
<table>
<tr><th>Name and Address of Owner</th><th>Shares Owned</th><th>% of Outstanding Shares Owned</th></tr>
<tr><td colspan="3">Macquarie/First Trust Global Infrastructure Fund:</td></tr>
<tr><td>National Financial Services LLC</td><td>1,486,320</td><td>17.39%</td></tr>
<tr><td>Morgan Stanley Smith Barney LLC</td><td>507,240</td><td>5.93%</td></tr>
<tr><td colspan="3">First Trust Energy Income and Growth Fund:</td></tr>
<tr><td>National Financial Services LLC</td><td>2,121,279</td><td>10.90%</td></tr>
<tr><td>Morgan Stanley Smith Barney LLC</td><td>1,287,581</td><td>6.62%</td></tr>
</table></body></html>`

func TestUndeclaredFundLabelRow(t *testing.T) {
	rows := ScreenRows(run(t, undeclaredFundLabelRowHTML))
	seen := map[string]int{}
	for _, r := range rows {
		if r.HolderName == "National Financial Services LLC" {
			seen[r.ShareClass]++
		}
	}
	if len(seen) != 2 {
		t.Fatalf("want one row per fund label, got %v", seen)
	}
	for cls, n := range seen {
		if n > 1 || cls == "" {
			t.Errorf("fund label not carried: %v", seen)
		}
	}
}

// An ASCII fund table puts the share CLASS in a column of its own, written once
// and left blank on the rows that continue it. The row splits at the first wide
// gap before a number, so the class was glued to the holder's name and the class
// identity was lost: one record holder of two classes of one fund collapsed.
var asciiLeadingClassColumn = `
                    PRINCIPAL SHAREHOLDERS

- ------------------------------- ---------------------------- -------------------
Title of Class                  Name and Address of          Percent of Class
                                Shareholder
- ------------------------------- ---------------------------- -------------------
Investor Shares:                Charles Schwab & Co. Inc.    11.01%
- ------------------------------- ---------------------------- -------------------
                                National Financial Services  6.47%
- ------------------------------- ---------------------------- -------------------
Admiral Shares:                 Charles Schwab & Co. Inc.    10.32%
- ------------------------------- ---------------------------- -------------------
                                National Financial Services  8.20%
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIILeadingClassColumn(t *testing.T) {
	rows := ScreenRows(run(t, asciiLeadingClassColumn))
	seen := map[string]int{}
	for _, r := range rows {
		if strings.HasPrefix(r.HolderName, "Charles Schwab") {
			seen[r.ShareClass]++
		}
	}
	if len(seen) != 2 {
		t.Fatalf("want one row per share class, got %v (%v)", seen, holderNames(rows))
	}
	for cls, n := range seen {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times: %v", cls, n, seen)
		}
		if !strings.Contains(cls, "Shares") {
			t.Errorf("share_class %q does not name the class column: %v", cls, seen)
		}
	}
}

// Two value-column pairs of one source row can carry the SAME label and the SAME
// (empty) values -- a "*" in both percent columns of a two-class table whose
// header rows do not tell the pairs apart. The two emitted records are then
// identical in every field, so one of them is a second reading of the same cell
// and nothing distinguishes it for any consumer.
const identicalPairRecordHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><th>Name of Beneficial Owner</th><th>Shares Beneficially Owned</th><th>Percent of Class</th><th>Shares Beneficially Owned</th><th>Percent of Class</th></tr>
<tr><td>Terry J. Heimes</td><td></td><td>*</td><td></td><td>*</td></tr>
<tr><td>Mary A. Roe</td><td>12,000</td><td>1.1</td><td>3,000</td><td>2.2</td></tr>
<tr><td>John Q. Public</td><td>40,000</td><td>3.7</td><td>9,000</td><td>4.4</td></tr>
</table></body></html>`

func TestIdenticalRecordsFromOneRowCollapse(t *testing.T) {
	rows := run(t, identicalPairRecordHTML)
	n := 0
	for _, r := range rows {
		if r.HolderName == "Terry J. Heimes" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("identical records emitted %d times, want 1: %+v", n, rows)
	}
	m := 0
	for _, r := range rows {
		if r.HolderName == "Mary A. Roe" {
			m++
		}
	}
	if m != 2 {
		t.Errorf("rows carrying DIFFERENT values must not be collapsed, got %d", m)
	}
}

// A fund-family proxy that declares no series names each fund in a short TEXT
// line above its table rather than in a row inside it. Every fund's record
// holders otherwise collapse onto one key per share class.
const fundHeadingAboveTableHTML = `<html><body>
<p>Principal Shareholders of the Funds</p>
<p>Invesco American Franchise Fund</p>
<table>
<tr><th>Name and Address of Principal Holder</th><th colspan="2">Amount of Shares Owned / Percent of Class</th></tr>
<tr><th></th><th>Class A</th><th>Class Y</th></tr>
<tr><td>EDWARD D JONES &amp; CO</td><td>35.85%</td><td>—</td></tr>
<tr><td>LPL FINANCIAL</td><td>6.64%</td><td>—</td></tr>
</table>
<p>Invesco Global Core Equity Fund</p>
<table>
<tr><th>Name and Address of Principal Holder</th><th colspan="2">Amount of Shares Owned / Percent of Class</th></tr>
<tr><th></th><th>Class A</th><th>Class Y</th></tr>
<tr><td>EDWARD D JONES &amp; CO</td><td>26.86%</td><td>—</td></tr>
<tr><td>LPL FINANCIAL</td><td>6.92%</td><td>—</td></tr>
</table></body></html>`

func TestFundHeadingAboveTable(t *testing.T) {
	rows := ScreenRows(run(t, fundHeadingAboveTableHTML))
	seen := map[string]int{}
	for _, r := range rows {
		if r.HolderName == "EDWARD D JONES & CO" {
			seen[r.ShareClass]++
		}
	}
	if len(seen) < 2 {
		t.Fatalf("want a key per fund, got %v (%v)", seen, holderNames(rows))
	}
	for cls, n := range seen {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times: %v", cls, n, seen)
		}
		if !strings.Contains(cls, "Fund") {
			t.Errorf("share_class %q does not name the fund heading: %v", cls, seen)
		}
	}
}

// A fund-family 5% table states the CLASS inside the percent cell itself --
// "6.0% Class B; Beneficial" -- with one row per holder per class of a fund. The
// class was dropped, so one record holder of three classes of one fund collapsed
// onto one key.
const classInPercentCellHTML = `<html><body>
<p>Beneficial Owners of More than 5% of a Class of each Fund</p>
<table>
<tr><th>Fund</th><th>Name and Address</th><th>Percentage of Class and Type of Ownership</th><th>Percentage of Fund</th></tr>
<tr><td>ING Classic Money Market Fund</td><td>State Street Bk &amp; Tr Co Cust IRA</td><td>91.5% Class A; Beneficial</td><td>88.9%</td></tr>
<tr><td>ING Classic Money Market Fund</td><td>State Street Bk &amp; Tr Co Cust IRA</td><td>6.0% Class B; Beneficial</td><td>0.0%</td></tr>
<tr><td>ING Classic Money Market Fund</td><td>State Street Bk &amp; Tr Co Cust IRA</td><td>12.1% Class C; Beneficial</td><td>0.1%</td></tr>
</table></body></html>`

func TestClassInsideThePercentCell(t *testing.T) {
	rows := ScreenRows(run(t, classInPercentCellHTML))
	seen := map[string]int{}
	for _, r := range rows {
		if strings.HasPrefix(r.HolderName, "State Street") {
			seen[r.ShareClass]++
		}
	}
	if len(seen) < 3 {
		t.Fatalf("want a key per class named in the percent cell, got %v", seen)
	}
	for cls, n := range seen {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times: %v", cls, n, seen)
		}
	}
}

// An ASCII proxy states each class over its own (shares, percent) COLUMN PAIR,
// on caption lines above the dashed rule, and adds a third column for the
// combined voting power. classLabelsFromHeader reads class tokens out of the
// joined header in ORDER, and the class line itself carries no "percent /
// shares / beneficial / amount" cue, so it was never collected as a header line
// at all: every one of the three holdings of a holder came out with the same
// share_class and three rows collapsed onto one grain key.
const asciiSpanningClassColumns = `
     The table below sets forth certain information regarding the beneficial
ownership of each class of Common Stock as of December 4, 1998 by each person
who is known to the Company to be the beneficial owner of more than 5% of the
outstanding Class A Common Stock or Class B Common Stock.

                                   BENEFICIAL OWNERSHIP OF         BENEFICIAL OWNERSHIP OF
                                   CLASS A COMMON STOCK(1)           CLASS B COMMON STOCK
                                  --------------------------     ----------------------------    PERCENTAGE
                                    NUMBER         PERCENT         NUMBER           PERCENT     OF COMBINED
                                  OF SHARES      OF CLASS(2)      OF SHARES       OF CLASS(3)   VOTING POWER
                                  ----------     -----------     -----------      -----------   ------------
Bradley Currey, Jr.(4)..........   3,510,616(5)     13.64%        2,766,180(6)       23.56%        20.23%
Jay Shuster.....................     751,858(7)      3.18           599,769(8)        5.10          4.37
Edward E. Bowns.................     316,211(9)      1.36           211,364(10)       1.80          1.58
J. Hyatt Brown(17)..............   5,208,935(18)    20.06         3,020,795(19)      25.73         23.08
`

func TestASCIISpanningClassColumns(t *testing.T) {
	rows := run(t, asciiSpanningClassColumns)
	byClass := map[string]*Row{}
	n := 0
	for i := range rows {
		if rows[i].HolderName != "Bradley Currey, Jr" {
			continue
		}
		n++
		byClass[rows[i].ShareClass] = &rows[i]
	}
	if n != 3 {
		t.Fatalf("want 3 holdings for Bradley Currey, got %d: %+v", n, rows)
	}
	if len(byClass) != 3 {
		t.Fatalf("want 3 DISTINCT share_class labels, got %d: %v", len(byClass), keysOf(byClass))
	}
	var a, b *Row
	for cls, r := range byClass {
		lc := strings.ToLower(cls)
		if strings.Contains(lc, "class a") {
			a = r
		}
		if strings.Contains(lc, "class b") {
			b = r
		}
	}
	if a == nil || a.Shares == nil || *a.Shares != 3510616 {
		t.Errorf("class A column not labelled from the caption: %v", keysOf(byClass))
	}
	if b == nil || b.Shares == nil || *b.Shares != 2766180 {
		t.Errorf("class B column not labelled from the caption: %v", keysOf(byClass))
	}
}

func keysOf(m map[string]*Row) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}
