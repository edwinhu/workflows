package main

import (
	"strings"
	"testing"
)

// Street numbers in a holder-and-address cell must not vote it into a
// percentage column. Transcribed from 0001019687-08-001942's ownership table.
func TestTitleOfClassWithNumericHolderAddresses(t *testing.T) {
	body := `<html><body>
<p>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT</p>
<table>
<tr><td>Title of<br>Class</td><td>Name and Address<br>(1)</td><td></td><td>SharesBeneficially<br>Owned<br>(2)</td><td></td><td>Percentage of<br>Class<br>(2)</td></tr>
<tr><td></td><td>Beneficial Owners<br>of<br>More than<br>5%:</td><td></td><td>4,747,245</td><td></td><td></td></tr>
<tr><td>Common<br>Stock</td><td>Odyssey<br>Value Advisors, LLC<br>601<br>Montgomery Street, Suite 1112<br>San<br>Francisco, CA 94111</td><td></td><td>2,141,745</td><td></td><td>9.98%</td></tr>
<tr><td>Common<br>Stock</td><td>Susan<br>Jeffs<br>Third<br>Floor, 346 Kensington High Street, London, W14 8NS, United<br>Kingdom</td><td></td><td>1,500,000</td><td></td><td>6.99%</td></tr>
</table></body></html>`
	rows := ScreenRows(run(t, body))
	if len(rows) != 2 {
		t.Fatalf("want two real common-stock holders, got %d: %+v", len(rows), rows)
	}
	for _, want := range []struct {
		name        string
		shares, pct float64
	}{
		{"Odyssey Value Advisors, LLC", 2141745, 9.98},
		{"Susan Jeffs", 1500000, 6.99},
	} {
		r := find(rows, want.name, "Common Stock")
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.Percent == nil || *r.Percent != want.pct {
			t.Errorf("holder %q: want shares=%g percent=%g class=Common Stock; got %+v; all rows=%+v", want.name, want.shares, want.pct, r, rows)
		}
	}
}

// Transcribed from 0000891804-16-001267's four-holder ownership table.
func TestHTMLShareHoldingsPercentageOwned(t *testing.T) {
	body := `<html><body><p>SHARE OWNERSHIP INFORMATION</p><table>
<tr><td></td><td></td><td></td></tr>
<tr><td></td><td>Share</td><td>Percentage</td></tr>
<tr><td>Shareholder Name and Address</td><td>Holdings</td><td>Owned</td></tr>
<tr><td>Cascade Investment, L.L.C.<sup>(1)(2)</sup></td><td>13,522,751</td><td>22.10%</td></tr>
<tr><td>2365 Carillon Point,</td><td></td><td></td></tr>
<tr><td>Kirkland, WA 98033</td><td></td><td></td></tr>
<tr><td></td><td></td><td></td></tr>
<tr><td>Wells Fargo &amp; Company<sup>(3)</sup></td><td>4,408,420</td><td>7.21%</td></tr>
<tr><td>Wells Capital Management Incorporated</td><td></td><td></td></tr>
<tr><td>420 Montgomery Street</td><td></td><td></td></tr>
<tr><td>San Francisco, CA 94104</td><td></td><td></td></tr>
<tr><td></td><td></td><td></td></tr>
<tr><td>First Trust Portfolios L.P.<sup>(4)</sup></td><td>4,265,917</td><td>6.97%</td></tr>
<tr><td>First Trust Advisors L.P.</td><td></td><td></td></tr>
<tr><td>The Charger Corporation</td><td></td><td></td></tr>
<tr><td>120 East Liberty Drive, Suite 400</td><td></td><td></td></tr>
<tr><td>Wheaton, IL 60187</td><td></td><td></td></tr>
<tr><td></td><td></td><td></td></tr>
<tr><td>1607 Capital Partners, LLC<sup>(5)</sup></td><td>4,048,909</td><td>6.62%</td></tr>
<tr><td>13 S. 13th Street</td><td></td><td></td></tr>
<tr><td>Suite 400</td><td></td><td></td></tr>
<tr><td>Richmond, VA 23219</td><td></td><td></td></tr>
</table></body></html>`
	rows := ScreenRows(run(t, body))
	if len(rows) != 4 {
		t.Fatalf("want four disclosed holders, got %d: %+v", len(rows), rows)
	}
	for _, want := range []struct {
		name        string
		shares, pct float64
	}{
		{"Cascade Investment, L.L.C", 13522751, 22.10},
		{"Wells Fargo & Company", 4408420, 7.21},
		{"First Trust Portfolios L.P", 4265917, 6.97},
		{"1607 Capital Partners, LLC", 4048909, 6.62},
	} {
		r := find(rows, want.name, "")
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.Percent == nil || *r.Percent != want.pct {
			t.Errorf("holder %q: want shares=%g percent=%g; got %+v; all rows=%+v", want.name, want.shares, want.pct, r, rows)
		}
	}
	for _, tc := range []struct{ label, altered string }{
		{"not_owned", strings.Replace(body, "<td>Owned</td>", "<td>Granted</td>", 1)},
		{"not_shares", strings.Replace(body, "<td>Share</td>", "<td>Dollar</td>", 1)},
		{"compensation", strings.Replace(body, "<table>", "<table><tr><td colspan=\"3\">Summary Compensation</td></tr>", 1)},
	} {
		t.Run(tc.label, func(t *testing.T) {
			if got := ScreenRows(run(t, tc.altered)); len(got) != 0 {
				t.Fatalf("non-ownership headers must not use the stacked ownership escape: %+v", got)
			}
		})
	}
}

// 0000891804-15-000334 has a real trustee table before the ownership heading.
// Accepting the later stacked-header table must not disable its legacy fallback.
func TestStackedOwnedHeadersPreserveEarlierTrusteeHoldings(t *testing.T) {
	body := `<html><body><table>
<tr><td></td><td></td><td>Term of</td><td></td><td>Number of</td><td></td><td></td></tr>
<tr><td></td><td></td><td>Office</td><td>Principal</td><td>Portfolios In</td><td>Other</td><td>Shares of</td></tr>
<tr><td></td><td></td><td>and</td><td>Occupations</td><td>Fund Complex*</td><td>Directorships</td><td>the Fund</td></tr>
<tr><td></td><td>Position(s)</td><td>Length</td><td>During</td><td>Overseen by</td><td>Held by</td><td>Beneficially</td></tr>
<tr><td>Name</td><td>Held With</td><td>of Time</td><td>the Past</td><td>Trustee or</td><td>Trustee or</td><td>Owned on</td></tr>
<tr><td>and Age</td><td>Fund</td><td>Served</td><td>5 Years</td><td>Nominee</td><td>Nominee*</td><td>April 30, 2015</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td>Independent Trustees</td><td>Independent Trustees</td><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td>Michael Larson<br>55</td><td>Trustee and Chairperson of the Board of Trustees(1)(2)</td><td>Term expires in 2016;<br>served since May 2004</td><td>Chief Investment Officer for William H. Gates III (1994-present).</td><td>2</td><td>Republic Services, Inc. (2009-present); Grupo Televisa, S.A.B. (2009-present); Autonation, Inc. (2010-present). Fomento Economico Mexicano, SAB (2011-present); EcoLab, Inc. (2012-present).</td><td>4,534**</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td>Ronald A. Nyberg<br>61</td><td>Nominee and Trustee(1)(2)</td><td>Term expires in 2017; served since August 2003</td><td>Partner, Nyberg &amp; Cassioppi, LLC (2000-present). Formerly, Executive Vice President, General Counsel, and Corporate Secretary of Van Kampen<br>Investments (1982-1999).</td><td>93</td><td>None</td><td>809</td></tr>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td>Ronald E. Toupin, Jr.<br>56</td><td>Trustee(1)(2)</td><td>Term expires at the<br>Annual Meeting; served since August 2003</td><td>Portfolio Consultant (2010-present). Formerly, Vice President, Manager and Portfolio Manager of Nuveen Asset Management (1998-1999), Vice President and Portfolio Manager of Nuveen Investment Advisory Corporation (1992-1999), Vice President and Manager of Nuveen Unit Investment Trusts (1991-1999), and Assistant Vice President and Portfolio Manager of Nuveen Unit Investment Trusts (1988-1999), each of John Nuveen &amp; Company, Inc. (1982-1999).</td><td>90</td><td>Bennett Group of Funds (2011-2013)</td><td>919</td></tr>
</table><p>SHARE OWNERSHIP INFORMATION</p><table>
<tr><td></td><td>Share</td><td>Percentage</td></tr>
<tr><td>Shareholder Name and Address</td><td>Holdings</td><td>Owned</td></tr>
<tr><td>Cascade Investment, L.L.C.<sup>(1)(2)</sup></td><td>6,632,888</td><td>22.8%</td></tr>
<tr><td>2365 Carillon Point,</td><td></td><td></td></tr>
<tr><td>Kirkland, WA 98033</td><td></td><td></td></tr>
<tr><td></td><td></td><td></td></tr>
<tr><td>First Trust Portfolios L.P<sup>(3)</sup></td><td>4,580,326</td><td>15.71%</td></tr>
<tr><td>First Trust Advisors L.P.</td><td></td><td></td></tr>
<tr><td>The Charger Corporation</td><td></td><td></td></tr>
<tr><td>120 East Liberty Drive, Suite 400</td><td></td><td></td></tr>
<tr><td>Wheaton, IL 60187</td><td></td><td></td></tr>
<tr><td></td><td></td><td></td></tr>
<tr><td>1607 Capital Partners, LLC<sup>(4)</sup></td><td>1,750,905</td><td>6.01%</td></tr>
<tr><td>4991 Lake Brooke Drive</td><td></td><td></td></tr>
<tr><td>Suite 125</td><td></td><td></td></tr>
<tr><td>Glen Allen, VA 23060</td><td></td><td></td></tr>
</table></body></html>`
	rows := ScreenRows(run(t, body))
	for _, want := range []struct {
		name   string
		shares float64
	}{{"Ronald A. Nyberg", 809}, {"Ronald E. Toupin, Jr", 919}} {
		found := false
		for _, r := range rows {
			if r.HolderName == want.name && r.Shares != nil && *r.Shares == want.shares {
				found = true
			}
		}
		if !found {
			t.Errorf("earlier trustee holding lost: %s shares=%g; rows=%+v", want.name, want.shares, rows)
		}
	}
	for _, name := range []string{"Cascade Investment, L.L.C", "First Trust Portfolios L.P", "1607 Capital Partners, LLC"} {
		if find(rows, name, "") == nil {
			t.Errorf("stacked-header holder lost: %s; rows=%+v", name, rows)
		}
	}
}

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

// runProse exercises the last-resort prose reader on its own: it is reached in
// process() only when both table paths emit nothing.
func runProse(t *testing.T, body string) []Row {
	t.Helper()
	base := Row{Accession: "acc", CIK: "cik", Company: "Co", FilingDate: "2010-01-01"}
	return ScreenRows(ExtractProse(body, base))
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

// Transcribed from 0001206774-09-000166 (Hovnanian Enterprises 2009). The
// beneficial-ownership table's own footnote carries the standard sentence
// "options exercisable within 60 days, whether or not in-the-money", and the
// option-detail reject fired on the bare phrase, throwing away a three-class
// ownership table with share counts and percents of class. In-the-money names
// an option-detail COLUMN only in "Value of Unexercised In-the-Money Options";
// in a negation it is the ordinary 60-day beneficial-ownership footnote.
const inTheMoneyFootnoteHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><th>Directors and Holders of More Than 5%</th>
    <th>Class A Amount and Nature of Beneficial Ownership</th><th>Percent of Class</th>
    <th>Class B Amount and Nature of Beneficial Ownership</th><th>Percent of Class</th></tr>
<tr><td>Kevork S. Hovnanian (4)</td><td>7,567,392</td><td>12.10 %</td><td>7,165,926</td><td>48.95 %</td></tr>
<tr><td>Ara K. Hovnanian (5)</td><td>5,736,237</td><td>8.91 %</td><td>988,915</td><td>6.76 %</td></tr>
<tr><td>Paul W. Buchanan (6)</td><td>84,981</td><td>.14 %</td><td>-</td><td>-</td></tr>
<tr><td>All Directors and Executive Officers as a Group (17 persons)</td><td>15,120,455</td><td>23.30 %</td><td>8,663,341</td><td>59.18 %</td></tr>
<tr><td>(1) Shares subject to options exercisable within 60 days, whether or not
in-the-money, include the shares shown above.</td><td></td><td></td><td></td><td></td></tr>
</table></body></html>`

func TestInTheMoneyInAFootnoteIsNotAnOptionDetailTable(t *testing.T) {
	rows := run(t, inTheMoneyFootnoteHTML)
	got := find(rows, "Kevork S. Hovnanian", "")
	if got == nil || got.Shares == nil || *got.Shares != 7567392 {
		t.Fatalf("ownership table rejected on a 60-day footnote: %d rows %+v", len(rows), rows)
	}
}

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

// Transcribed from 0000010048-03-000003 (Barnwell Industries 2003). The proxy
// prints the ownership heading once, over the 5% holders table, then a page of
// footnotes, then the DIRECTORS table on a new page under a REPRINT of the same
// column header and no heading of its own. The anchor that reaches the second
// block starts BELOW that reprinted header, so the block's ownership cue is in
// header lines the anchor window never collected and the block is rejected
// no_own_cue -- nine real holders with share counts and percents of class.
var asciiSecondTableOwnHeader = `
                SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT

     The following table sets forth information with respect to the beneficial
ownership of the Common Stock by each person who beneficially owns more than 5%
of the Common Stock.

<TABLE>
<CAPTION>
                                                                       Amount and Nature of       Percent
              Name and Address of Beneficial Owner                   Beneficial Ownership (1)    of Class
- ------------------------------------------------------------------   ------------------------    ---------
<S>                         <C>                                              <C>                   <C>
Joseph E. Magaro            401 Riversville Road                             211,510 (2)           16.1%
                            Greenwich, Connecticut

R. David Sudarsky           3050 North Ocean Boulevard                       121,600 (3)            9.2%
                            Ft. Lauderdale, Florida
<FN>
- ---------------------------------
(1)  A person is  deemed  to be the  beneficial  owner of  securities  that such
     person can acquire as of and within the 60 days  following the date of this
     table upon the exercise of options or rights of conversion. Each beneficial
     owner's  percentage  of ownership is determined by assuming that options or
     conversion  rights  that are held by such person (but not those held by any
     other person) and which are  exercisable as of and within 60 days following
     the date of this table have been  exercised.  Except  as  indicated  in the
     footnotes that follow, shares listed in the table are held with sole voting
     and investment power.

(2)  Includes  a note in the  principal  amount  of  $20,000  that is  currently
     convertible  into 1,000  shares of Common  Stock at a  conversion  price of
     $20.00 per share.

(3)  Includes  a note in the  principal  amount of  $10,000  that  is  currently
     convertible into 500 shares of Common Stock at a conversion price of $20.00
     per share.
</FN>
</TABLE>

                                       9
<PAGE>
<TABLE>
<CAPTION>

                                                                       Amount and Nature of       Percent
              Name and Address of Beneficial Owner                     Beneficial Ownership      of Class
- ------------------------------------------------------------------   ------------------------    ---------
<S>                         <C>                                              <C>                   <C>
Morton H. Kinzler           1100 Alakea Street, Suite 2900                   219,960 (4)           16.7%
                            Honolulu, Hawaii

Alan D. Hunter              44 Medford Place, S.W.                               400                 *
                            Calgary, Alberta, Canada

Daniel Jacobson             885 Third Avenue                                   5,000                 *
                            New York, New York

Martin Anderson             1099 Alakea Street, Suite 1800                    90,503                6.9%
                            Honolulu, Hawaii

Alexander C. Kinzler        671 Puuikena Drive                                56,420 (5)            4.2%
                            Honolulu, Hawaii

Russell M. Gifford          1100 Alakea Street, Suite 2900                    21,550 (6)            1.6%
                            Honolulu, Hawaii
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIISecondTableCarriesItsOwnHeader(t *testing.T) {
	rows := run(t, asciiSecondTableOwnHeader)
	if find(rows, "Joseph E. Magaro", "") == nil {
		t.Fatalf("the FIRST ascii table regressed: %+v", rows)
	}
	for _, want := range []struct {
		name string
		sh   float64
		pct  float64
	}{
		{"Morton H. Kinzler", 219960, 16.7},
		{"Martin Anderson", 90503, 6.9},
		{"Russell M. Gifford", 21550, 1.6},
	} {
		got := find(rows, want.name, "")
		if got == nil || got.Shares == nil || *got.Shares != want.sh ||
			got.Percent == nil || *got.Percent != want.pct {
			t.Fatalf("second-table holder %q wrong: %+v (all rows: %+v)", want.name, got, rows)
		}
	}
}

// Transcribed from 0000077543-03-000009 (Perini 2003). The stub column is
// "Name and Principal Occupation for The Past Five Years", so a BIOGRAPHY of up
// to seven indented lines sits under each holder's numeric line. The scan ends
// a block after a run of more than six non-row lines, so the table stops at the
// first holder and the other eight -- including the group total -- are lost.
// The bio lines are the holder's own name CELL continuing: they are indented
// past the stub's left edge and end before the value columns begin.
var asciiBioUnderEachHolder = `
                OWNERSHIP OF COMMON STOCK BY DIRECTORS AND OFFICERS

     The following table sets forth certain information concerning the
beneficial ownership of the Common Stock of the Company by each Director and
by all Directors and Executive Officers of the Company as a group.

                                                         Served    Sole Voting
                                                          as a         and
  Name and Principal Occupation for The Past            Director   Investment                                       Percentage
                  Five Years                     Age     Since        Power             Shared         Aggregate     of Class
- -----------------------------------------------  -----  ---------  ------------------ -----------     ------------ -------------
Ronald N. Tutor (4)                               62      1997      6,282,201     (5)     0            6,282,201      23.94%
  Director; Chairman and Chief Executive
  Officer since March 29, 2000, formerly
  Chairman since July 1, 1999, formerly Vice
  Chairman since January 1, 1998 and Acting
  Chief Operating Officer since January 17,
  1997, and  Chairman, President and Chief
  Executive Officer, Tutor-Saliba Corporation.

Robert Band                                       55      1999        267,405     (6)     0              267,405       1.17%
  Director; President and Chief Operating
  Officer since March 29, 2000, formerly
  President and Chief Executive Officer since
  May 12, 1999, formerly Executive Vice
  President, Chief Financial Officer since
  December 1997 and President of Perini
  Management Services, Inc. since
  January 1996.

Michael R. Klein (2)(3)(4)(7)                     60      1997        132,261     (8)     0              132,261       (a)
  Director, Vice Chairman since 2000; Chairman
  of CoStar Group, Inc. since 1987, Chairman of
  Precept Corporation since 1998 and Partner
  of Wilmer, Cutler &Pickering (law firm) since
  1974

Zohrab B. Marashlian                              58       -         477,307     (12)     0              477,307      2.06%
  President, Perini Civil Construction, a division
  of the Company.

Craig W. Shaw                                     48       -         477,120     (13)     0              477,120      2.06%
  President, Perini Building Company, Inc., a
  wholly owned subsidiary of the Company.

All Directors and Executive Officers as                             7,636,294             0            7,636,294      27.71%
  a group (10 persons)

- -----------------------------------------------

(a) Less than one percent
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIIBiographyUnderEachHolderDoesNotEndTheBlock(t *testing.T) {
	rows := run(t, asciiBioUnderEachHolder)
	for _, want := range []struct {
		name string
		sh   float64
	}{
		{"Ronald N. Tutor", 6282201},
		{"Robert Band", 267405},
		{"Zohrab B. Marashlian", 477307},
		{"Craig W. Shaw", 477120},
	} {
		got := find(rows, want.name, "")
		if got == nil || got.Shares == nil || *got.Shares != want.sh {
			t.Fatalf("holder %q wrong: %+v (%d rows: %+v)", want.name, got, len(rows), rows)
		}
	}
	var grp *Row
	for i := range rows {
		if rows[i].IsGroupRow {
			grp = &rows[i]
		}
	}
	if grp == nil || grp.Percent == nil || *grp.Percent != 27.71 || grp.GroupN != 10 {
		t.Fatalf("group row wrong: %+v (all: %+v)", grp, rows)
	}
}

// The same Perini table (0000077543-03-000009) as it really runs: a PAGE BREAK
// after the fifth director, then the identical column header reprinted on the
// new page and four more holders plus the group total. The page break is more
// than six non-row lines, so the block ends at the break and the second page --
// including the group row -- is never read.
var asciiPageBreakReprintedHeader = `
                OWNERSHIP OF COMMON STOCK BY DIRECTORS AND OFFICERS

     The following table sets forth certain information concerning the
beneficial ownership of the Common Stock of the Company by each Director and
by all Directors and Executive Officers of the Company as a group.

                                                         Served    Sole Voting
                                                          as a         and
  Name and Principal Occupation for The Past            Director   Investment                                       Percentage
                  Five Years                     Age     Since        Power             Shared         Aggregate     of Class
- -----------------------------------------------  -----  ---------  ------------------ -----------     ------------ -------------
Ronald N. Tutor (4)                               62      1997      6,282,201     (5)     0            6,282,201      23.94%
  Director; Chairman and Chief Executive
  Officer since March 29, 2000, formerly
  Chairman since July 1, 1999.

Robert Band                                       55      1999        267,405     (6)     0              267,405       1.17%
  Director; President and Chief Operating
  Officer since March 29, 2000.

Robert A. Kennedy (2)(9)                          67      2000          0                 0                0            -
  Director; Vice President of Special Projects
  for The Union Labor Life Insurance Company
  since 1997.



                                                         Served    Sole Voting
                                                          as a         and
  Name and Principal Occupation for The Past            Director   Investment                                       Percentage
                  Five Years                     Age     Since        Power             Shared         Aggregate     of Class
- -----------------------------------------------  -----  ---------  ------------------ -----------     ------------ -------------
Raymond R. Oneglia (2)(3)(4)(10)                  55      2000          0                 0                0            -
  Director; Vice Chairman, O&G Industries, Inc.
  since 1997.

Zohrab B. Marashlian                              58       -         477,307     (12)     0              477,307      2.06%
  President, Perini Civil Construction, a division
  of the Company.

Craig W. Shaw                                     48       -         477,120     (13)     0              477,120      2.06%
  President, Perini Building Company, Inc., a
  wholly owned subsidiary of the Company.

All Directors and Executive Officers as                             7,636,294             0            7,636,294      27.71%
  a group (10 persons)

- -----------------------------------------------

(a) Less than one percent
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIITableResumesAfterAReprintedHeader(t *testing.T) {
	rows := run(t, asciiPageBreakReprintedHeader)
	for _, want := range []struct {
		name string
		sh   float64
	}{
		{"Ronald N. Tutor", 6282201},
		{"Zohrab B. Marashlian", 477307},
		{"Craig W. Shaw", 477120},
	} {
		got := find(rows, want.name, "")
		if got == nil || got.Shares == nil || *got.Shares != want.sh {
			t.Fatalf("holder %q wrong: %+v (%d rows: %+v)", want.name, got, len(rows), rows)
		}
	}
	var grp *Row
	for i := range rows {
		if rows[i].IsGroupRow {
			grp = &rows[i]
		}
	}
	if grp == nil || grp.Percent == nil || *grp.Percent != 27.71 || grp.GroupN != 10 {
		t.Fatalf("group row wrong: %+v (all: %+v)", grp, rows)
	}
}

// Transcribed from 0000903594-01-500049. The column header is stacked over
// THREE lines and the cue that says this is an ownership table is spelled down
// one COLUMN -- "PERCENTAGE" / "OF SHARES" / "OUTSTANDING". Flattened row by
// row it becomes "PERCENTAGE OCCUPATION AND NUMBER OF SHARES ... OUTSTANDING",
// in which no ownership phrase survives, and the table -- nine directors with
// share counts and percents, and the group total -- is rejected no_own_cue.
var asciiStackedColumnHeader = `
                        ELECTION OF DIRECTORS

     The following table sets forth information about the nominees.

<TABLE>
<CAPTION>
                                                                    BENEFICIAL OWNERSHIP(1)
                                                                                 PERCENTAGE
                               OCCUPATION AND                         NUMBER     OF SHARES
NOMINEE               AGE        EMPLOYMENT                         OF SHARES   OUTSTANDING
<S>                   <C>   <C>                                    <C>          <C>

Ben S. Beiler          58   Director since 1989                       24,163(2)     0.79%
                            President of Beiler Enterprises, Inc.

Arthur A. Bernardon    54   Director since 1998                        4,982(3)     0.16%
                            President of Bernardon & Associates

Clyde L. Cameron       75   Director since 1979                       33,046(4)     1.09%
                            President of Cameron's Inc.

George C. Mason        65   Chairman of the Board since 1973         365,612(6)   12.03%
                            Chairman and Chief Executive Officer

All directors and executive officers as a group
  (13 persons)                                                       541,337(9)     17.80%
</TABLE>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestASCIIStackedColumnHeaderCarriesTheCue(t *testing.T) {
	rows := run(t, asciiStackedColumnHeader)
	got := find(rows, "George C. Mason", "")
	if got == nil || got.Shares == nil || *got.Shares != 365612 ||
		got.Percent == nil || *got.Percent != 12.03 {
		t.Fatalf("stacked-header ownership table rejected: %d rows %+v", len(rows), rows)
	}
}

// Transcribed from 0000950137-04-004242. A closed-end fund's 5% record-holder
// exhibit heads its columns "AMOUNT OF / OWNERSHIP AS OF / APRIL 23, 2004" and
// "APPROXIMATE / PERCENTAGE / OF OWNERSHIP" -- ownership stated as a noun, and
// nowhere the words reOwnCue looks for. Read down its columns the first one is
// "AMOUNT OF OWNERSHIP AS OF", which is what the table is.
var asciiAmountOfOwnership = `
                        SHAREHOLDER INFORMATION

  As of April 23, 2004, no person was known by the Fund to own beneficially 5%
or more of the Fund's outstanding Shares except as follows:

<Table>
<Caption>
                                                  AMOUNT OF      APPROXIMATE
NAME AND ADDRESS                               OWNERSHIP AS OF    PERCENTAGE
OF HOLDER                                      APRIL 23, 2004    OF OWNERSHIP
- ----------------                               ---------------   ------------
<S>                                            <C>               <C>
A Fletcher Sisk Jr.                                10,183               5%
3009 Larkspur Run
Williamsburg, VA 23185

Comerica Bank Detroit &                            45,045              24%
  Edward Mardigian, Trustees
Helen Mardigian Trust
P.O. Box 75000
Detroit, MI 48275-0001

Gordon E. Moore & Betty I. Moore, Trustees         11,184               6%
Gordon and Betty Moore Trust
Palo Alto, CA 94301
</Table>
` + strings.Repeat("\nplain ascii line of proxy text with no table structure at all here.", 250)

func TestAmountOfOwnershipIsAnOwnershipCue(t *testing.T) {
	rows := run(t, asciiAmountOfOwnership)
	got := find(rows, "A Fletcher Sisk Jr", "")
	if got == nil || got.Shares == nil || *got.Shares != 10183 ||
		got.Percent == nil || *got.Percent != 5 {
		t.Fatalf("record-holder table rejected: %d rows %+v", len(rows), rows)
	}
}

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

// A proxy prints an OPTION-DETAIL table under its ownership table -- shares
// owned, exercisable options, the option price RANGE, the average option price,
// the weighted average remaining contractual life, the "in-the-money" options
// and the net shares from exercising them -- once for exercisable options and
// again for outstanding ones. Its header says "Shares Owned", so reOwnCue fires
// and reCompCue's escape hatch lets it through as an ownership table: the same
// director is emitted once per copy and the rows collapse onto one grain key.
const optionDetailTableHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><th>Name and Address of Beneficial Owner</th><th>Shares Beneficially Owned (1)</th><th>Percentage Beneficially Owned (1)</th></tr>
<tr><td>State of Wisconsin Investment Board (2)</td><td>9,365,182</td><td>18.2</td></tr>
<tr><td>William A. Aylesworth (6)</td><td>353,577</td><td>1.2</td></tr>
<tr><td>A. Barr Dolan (6)(7)</td><td>6,399,809</td><td>12.3</td></tr>
</table>
<table>
<tr><th>Name</th><th>Shares Owned (1)</th><th>Exercisable Options (2)</th><th>Exercisable Option Price Range (3)</th><th>Exercisable Option Average Price (4)</th><th>Weighted Average Remaining Contractual Life (5)</th><th>Exercisable "In-the money" Options (6)</th><th>Net Shares from Exercisable Options (7)</th></tr>
<tr><td>William A. Aylesworth</td><td>20,000</td><td>333,577</td><td>$0.38-4.12</td><td>$1.35</td><td>5.90</td><td>191,765</td><td>61,150</td></tr>
<tr><td>A. Barr Dolan (8)</td><td>6,012,717</td><td>387,092</td><td>$0.38-13.75</td><td>$1.42</td><td>6.18</td><td>225,982</td><td>70,599</td></tr>
</table></body></html>`

func TestOptionDetailTableIsNotOwnership(t *testing.T) {
	rows := ScreenRows(run(t, optionDetailTableHTML))
	tabs := map[int]bool{}
	n := 0
	for _, r := range rows {
		if r.HolderName == "William A. Aylesworth" {
			n++
			tabs[r.TableIndex] = true
		}
	}
	if n == 0 {
		t.Fatalf("the real ownership table stopped emitting: %d rows", len(rows))
	}
	if len(tabs) != 1 {
		t.Fatalf("option-detail table read as ownership: %d rows over %d tables", n, len(tabs))
	}
}

// A fund-family proxy states each trustee's holding as a DOLLAR RANGE -- the
// Form N-1A disclosure, "Dollar Range of Shares Owned in the Funds" -- with one
// line per fund under the trustee's name. The ASCII path read "$10,001 -
// $50,000" as a share count of 50,000 and the FUND NAME as the holder, so one
// document emitted dozens of rows whose holder is a fund and whose shares are
// money, and those rows collapse onto one grain key across the trustees.
const asciiDollarRangeTable = `
Nominees/Trustees ownership of shares in the Funds and in the Huntington
Family of Investment Companies(1) as of December 31, 2005

- ------------------------------------------------------------------------------
Name of Nominee/Trustee  Dollar Range of        Aggregate Dollar Range of
                         Shares Owned           Equity Securities in All
                         in the Funds           Registered Investment Companies
- ------------------------------------------------------------------------------
David S. Schoedinger                                     Over $100,000
  Dividend Capture Fund    $10,001 - $50,000
  Growth Fund              $10,001 - $50,000
  Mid Corp America Fund    $10,001 - $50,000
  New Economy Fund            $1 - $10,000
  Situs Small Cap Fund     $10,001 - $50,000
`

func TestASCIIDollarRangeIsNotShares(t *testing.T) {
	rows := ScreenRows(run(t, asciiDollarRangeTable))
	for _, r := range rows {
		if r.Shares != nil && *r.Shares == 50000 {
			t.Fatalf("a dollar range was read as a share count: %+v", r)
		}
	}
	if len(rows) != 0 {
		t.Fatalf("a dollar-range table is not an ownership table, got %d rows: %+v", len(rows), rows)
	}
}

// A fund proxy's independent-trustee table states, per row, WHICH COMPANY the
// interest is in -- one row per issuer per trustee, in a "Company" column. The
// column is roled `other`, so the issuer never reaches share_class and one
// trustee's holdings in four different issuers collapse onto one grain key.
const issuerColumnHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><th>Name of Independent Trustee/Nominee</th><th>Name of Owner and Relationships to Trustee/Nominee</th><th>Company</th><th>Title of Class</th><th>Shares Beneficially Owned (1)</th><th>Percent of Class(2)</th></tr>
<tr><td>Anthonie C. van Ekris</td><td>Same</td><td>LICT Corp.</td><td>Common Stock</td><td>345,600</td><td>*</td></tr>
<tr><td>Anthonie C. van Ekris</td><td>Same</td><td>The LGL Group, Inc.</td><td>Common Stock</td><td>13,420</td><td>*</td></tr>
<tr><td>Anthonie C. van Ekris</td><td>Same</td><td>CIBL, Inc.</td><td>Common Stock</td><td>40,560</td><td>*</td></tr>
<tr><td>Anthony J. Colavita</td><td>Same</td><td>The LGL Group, Inc.</td><td>Common Stock</td><td>14,238</td><td>*</td></tr>
</table></body></html>`

func TestIssuerColumnReachesTheGrainKey(t *testing.T) {
	rows := ScreenRows(run(t, issuerColumnHTML))
	seen := map[string]int{}
	for _, r := range rows {
		if r.HolderName == "Anthonie C. van Ekris" {
			seen[r.ShareClass]++
		}
	}
	if len(seen) != 3 {
		t.Fatalf("want one key per issuer, got %d: %v", len(seen), seen)
	}
	for cls, n := range seen {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times: %v", cls, n, seen)
		}
	}
}

// A closed-end fund complex states one FUND per share column and prints the
// table again for the next three funds. With no percent anywhere, textTokens
// keeps only the LAST share column, so each table emits one unlabelled row per
// trustee and the same trustee collapses onto one grain key across the tables.
// The fund is stated over the column, positionally, and nowhere else.
const asciiFundPerShareColumn = `
Share Ownership by Trustees

                         Number of Shares owned as of May 15, 1997 of:

                     Putnam California     Putnam High      Putnam Investment
                     Investment Grade    Yield Municipal     Grade Municipal
Trustee              Municipal Trust         Trust               Trust
- ------------------------------------------------------------------------------

Jameson A. Baxter                  118                119                 119
Hans H. Estin                      121                162                 161
John A. Hill                       100                100                 100
Elizabeth T. Kennan              229(2)             222(3)              222(3)
- ------------------------------------------------------------------------------

The Trustees of Putnam California Investment Grade Municipal Trust, Putnam
High Yield Municipal Trust and Putnam Investment Grade Municipal Trust owned
a total of common shares, respectively, of the funds, comprising less than one
percent of the outstanding common shares of such funds on that date. None of
the Trustees owns any preferred shares.

Share Ownership by Trustees

                            Number of Shares owned as of May 15, 1997 of:

                        Putnam Investment  Putnam Investment   Putnam Managed
                        Grade Municipal    Grade Municipal    Municipal Income
Trustee                   Trust II           Trust III             Trust
- ------------------------------------------------------------------------------

Jameson A. Baxter                 1,227              1,457                119
Hans H. Estin                      123                111                 161
John A. Hill                       100               2,500                100
Elizabeth T. Kennan              229(2)             222(3)              222(3)
`

func TestASCIIFundNamedOverTheShareColumn(t *testing.T) {
	rows := ScreenRows(run(t, asciiFundPerShareColumn))
	seen := map[string]int{}
	for _, r := range rows {
		if r.HolderName == "Jameson A. Baxter" {
			seen[r.ShareClass]++
		}
	}
	if len(seen) < 2 {
		t.Fatalf("the two tables' funds are one key: %v", seen)
	}
	for cls, n := range seen {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times: %v", cls, n, seen)
		}
	}
}

// A fund complex's record-holder exhibit writes the holder's name across the
// lines BELOW its percent: the omnibus account's own portfolio is on the
// continuation lines and is the only thing that tells five otherwise identical
// rows of one fund and one class apart. parseTextRow reads line one, so the same
// truncated name repeated five times collapses onto one grain key.
const asciiWrappedHolderTail = `
This exhibit lists those persons who, as of March 15, 2007, owned of record or
beneficially 5% or more of the outstanding shares of any Class of a Fund.

                                             PERCENTAGE OF       PERCENTAGE OF
                                             OUTSTANDING         OUTSTANDING
FUND/                                        SHARES OWNED        SHARES OWNED
CLASS       SHAREHOLDER                      OF RECORD           BENEFICIALLY(1)
- --------------------------------------------------------------------------------
NT Large Company Value
- --------------------------------------------------------------------------------
  Institutional Class
            American Century Serv Corp       35%                 35%
            LIVESTRONG(TM)
            2025 Portfolio
            NT Large Company
            Value Omnibus
            Kansas City, Missouri

            American Century Serv Corp       23%                 23%
            LIVESTRONG(TM)
            2015 Portfolio
            NT Large Company
            Value Omnibus
            Kansas City, Missouri

            American Century Serv Corp       20%                 20%
            LIVESTRONG(TM)
            2035 Portfolio
            NT Large Company
            Value Omnibus
            Kansas City, Missouri
`

func TestASCIIWrappedHolderNameTail(t *testing.T) {
	rows := ScreenRows(run(t, asciiWrappedHolderTail))
	keys := map[string]int{}
	for _, r := range rows {
		keys[r.HolderName+"\x00"+r.ShareClass]++
	}
	if len(rows) < 3 {
		t.Fatalf("want the three record holders, got %d rows: %+v", len(rows), rows)
	}
	for k, n := range keys {
		if n > 1 {
			t.Errorf("key %q emitted %d times; the portfolio on the continuation lines was dropped", k, n)
		}
	}
	// The portfolio belongs to the HOLDER, not to a class label carried down
	// from the row above: each row's own continuation lines must reach its name.
	want := []string{"2025 Portfolio", "2015 Portfolio", "2035 Portfolio"}
	for _, w := range want {
		hit := false
		for _, r := range rows {
			if strings.Contains(r.HolderName, w) {
				hit = true
			}
		}
		if !hit {
			t.Errorf("no holder name carries %q", w)
		}
	}
}

// A two-class table whose PERCENT columns are both headed "Percent of / Class"
// and whose SHARES columns are what differ ("Number of Series A & C Depositary
// Shares" against "Number of Common Shares/Units"). pairLabels reads the percent
// column's header cell first and only falls back to the shares column when the
// percent cell is empty, so both pairs were labelled "Class" and every holder's
// two holdings collapsed onto one grain key.
const pctHeadersTieSharesDifferHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><td></td><td>Number of Series A &amp; C</td><td>Percent of</td><td>Number of Common</td><td>Percent of</td></tr>
<tr><td>Name of Person</td><td>Depositary Shares</td><td>Class</td><td>Shares/Units (1)(2)</td><td>Class</td></tr>
<tr><td>Ellen A. Rudnick</td><td>3,000</td><td></td><td>62,706</td><td></td></tr>
<tr><td>Kathryn J. Hayley</td><td>12,000</td><td></td><td>33,572</td><td></td></tr>
<tr><td>John V. Moran, IV</td><td>3,500</td><td></td><td>103,950</td><td></td></tr>
<tr><td>Directors and Executive Officers as a Group (25 persons)</td><td>27,500</td><td>0.57</td><td>2,812,205</td><td>0.87</td></tr>
</table></body></html>`

func TestPercentHeadersTieAndSharesHeadersDiffer(t *testing.T) {
	rows := ScreenRows(run(t, pctHeadersTieSharesDifferHTML))
	seen := map[string]int{}
	for _, r := range rows {
		if r.HolderName == "Ellen A. Rudnick" {
			seen[r.ShareClass]++
		}
	}
	if len(seen) != 2 {
		t.Fatalf("want one key per class column, got %d: %v", len(seen), seen)
	}
	for cls, n := range seen {
		if n > 1 {
			t.Errorf("share_class %q emitted %d times: %v", cls, n, seen)
		}
	}
}

// A 5% holder's name-and-address cell wraps the NAME over two lines before the
// address begins. holderName returned line ONE as soon as any later line looked
// like an address, so the holder came out as "State of" and "Zesiger Capital",
// which is both wrong and collides with every other holder truncated the same
// way.
const wrappedNameCellHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><th>Name and Address of Beneficial Owner</th><th>Shares Beneficially Owned (1)</th><th>Percentage Beneficially Owned (1)</th></tr>
<tr><td>State of<br>Wisconsin Investment Board (2)<br>P.O. Box 7842<br>Madison, WI 53707</td><td>9,365,182</td><td>18.2</td></tr>
<tr><td>Zesiger Capital<br>Group LLC (3)<br>320 Park Avenue, 30th Floor<br>New York, NY 10022</td><td>8,308,200</td><td>16.1</td></tr>
<tr><td>Ashford Capital<br>Management, Inc. (5)<br>1 Walkers Mill Road<br>Wilmington, DE 19807-2317</td><td>3,197,500</td><td>6.2</td></tr>
</table></body></html>`

func TestWrappedNameCellKeepsTheWholeName(t *testing.T) {
	rows := ScreenRows(run(t, wrappedNameCellHTML))
	got := map[string]bool{}
	for _, r := range rows {
		got[r.HolderName] = true
	}
	for _, w := range []string{"State of Wisconsin Investment Board", "Zesiger Capital Group LLC", "Ashford Capital Management, Inc"} {
		if !got[w] {
			t.Errorf("want holder %q, got %v", w, got)
		}
	}
}

// A fund complex's record-holder table names the holder and its city on ONE
// line: "American Funds 2010 Target Date Retirement Fund, Norfolk, VA". The line
// opens with a four-digit YEAR, so reAddrLine reads it as a street address and
// holderName dropped it, leaving every target-date fund called "American Funds" -
// one key for all of them, and a holder that does not exist.
const nameWithCityOnOneLineHTML = `<html><body>
<p>Principal Shareholders: 5% Record Holders of each Fund</p>
<table>
<tr><td>Name and<br>Address</td><td>Ownership</td><td>Class</td><td>Shares Beneficially Owned</td><td>Percent of Class</td></tr>
<tr><td>American Funds<br>2010 Target Date Retirement Fund, Norfolk, VA</td><td>Record</td><td>R-6</td><td>4,523,020</td><td>41.42</td></tr>
<tr><td>American Funds<br>2015 Target Date Retirement Fund, Norfolk, VA</td><td>Record</td><td>R-6</td><td>4,658,739</td><td>42.66</td></tr>
<tr><td>American Funds<br>2020 Target Date Retirement Fund, Norfolk, VA</td><td>Record</td><td>R-6</td><td>1,713,302</td><td>15.69</td></tr>
</table></body></html>`

func TestNameAndCityOnOneLine(t *testing.T) {
	rows := ScreenRows(run(t, nameWithCityOnOneLineHTML))
	keys := map[string]int{}
	for _, r := range rows {
		keys[r.HolderName+"\x00"+r.ShareClass]++
	}
	if len(keys) != 3 {
		t.Fatalf("want one key per target-date fund, got %d: %v", len(keys), keys)
	}
	for _, r := range rows {
		if strings.Contains(r.HolderName, ", VA") || strings.Contains(r.HolderName, "Norfolk") {
			t.Errorf("the city reached the holder name: %q", r.HolderName)
		}
	}
}

// A fund complex's per-fund section names the fund in a heading line and then
// says, in a bullet of prose, "A series of Vanguard Wellington Fund" -- the
// PARENT registrant, which is itself a declared series name and sits CLOSER to
// the table than the heading does. seriesLabels took it, so dozens of funds were
// all labelled with the parent and one record holder of each collapsed onto one
// grain key.
const seriesOfParentHTML = `<html><body>
<p>Vanguard Short-Term Tax-Exempt Bond ETF</p>
<p>A series of Vanguard Wellington Fund (FYE 11/30).</p>
<p>Shareholders with more than 5% record and/or beneficial ownership of the noted class of this fund's shares:</p>
<table>
<tr><td>Title of Class</td><td>Name and Address of Shareholder</td><td>Percent of Class</td></tr>
<tr><td>ETF Shares</td><td>Charles Schwab &amp; Co., Inc.</td><td>41.26%</td></tr>
<tr><td>ETF Shares</td><td>National Financial Services LLC</td><td>17.35%</td></tr>
</table>
<p>Vanguard Ultra-Short Tax-Exempt Bond ETF</p>
<p>A series of Vanguard Wellington Fund (FYE 11/30).</p>
<p>Shareholders with more than 5% record and/or beneficial ownership of the noted class of this fund's shares:</p>
<table>
<tr><td>Title of Class</td><td>Name and Address of Shareholder</td><td>Percent of Class</td></tr>
<tr><td>ETF Shares</td><td>Charles Schwab &amp; Co., Inc.</td><td>38.48%</td></tr>
<tr><td>ETF Shares</td><td>National Financial Services LLC</td><td>12.91%</td></tr>
</table></body></html>`

func TestASeriesOfParentIsNotTheFund(t *testing.T) {
	base := Row{Accession: "acc", CIK: "cik", Company: "Co", FilingDate: "2024-01-01",
		series: []string{"Vanguard Wellington Fund", "Vanguard Short-Term Tax-Exempt Bond ETF",
			"Vanguard Ultra-Short Tax-Exempt Bond ETF"}}
	raw, _, _ := ExtractHTML(seriesOfParentHTML, base)
	rows := ScreenRows(raw)
	seen := map[string]int{}
	for _, r := range rows {
		if strings.HasPrefix(r.HolderName, "Charles Schwab") {
			seen[r.ShareClass]++
		}
	}
	if len(seen) != 2 {
		t.Fatalf("the two funds must carry two share_class values, got %v", seen)
	}
	for cls := range seen {
		if strings.Contains(cls, "WELLINGTON") || strings.Contains(cls, "Wellington") {
			t.Errorf("the PARENT registrant was taken for the fund: %q", cls)
		}
	}
}

// A closed-end fund complex states one FUND per share column and the fund's name
// WRAPS over three header rows: "Arizona / Dividend / Advantage" beside "Arizona
// / Dividend / Advantage 2". pairLabels picks the single lowest header row that
// tells the pairs apart, so the labels became "Advantage" and "Advantage 2" --
// and the next table in the same document, whose funds are "Pennsylvania
// Dividend Advantage" and "Pennsylvania Premium Income 2", produced "Advantage"
// again. Two different funds, one grain key.
const wrappedPairLabelHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><td></td><td>Floating</td><td>Floating</td><td>Arizona</td><td>Arizona</td><td>Arizona</td><td>Arizona</td></tr>
<tr><td>Board Member</td><td>Rate</td><td>Rate</td><td>Dividend</td><td>Dividend</td><td>Dividend</td><td>Dividend</td></tr>
<tr><td>Nominees</td><td>Income</td><td>Income</td><td>Advantage</td><td>Advantage</td><td>Advantage 2</td><td>Advantage 2</td></tr>
<tr><td></td><td>Shares owned</td><td>Percent of Class</td><td>Shares owned</td><td>Percent of Class</td><td>Shares owned</td><td>Percent of Class</td></tr>
<tr><td>Carole E. Stone</td><td>1,600</td><td>1.2</td><td>10,000</td><td>2.4</td><td>4,000</td><td>1.7</td></tr>
<tr><td>Terence J. Toth</td><td>7,018</td><td>3.1</td><td>2,000</td><td>1.1</td><td>9,000</td><td>2.2</td></tr>
</table></body></html>`

func TestWrappedPairLabelKeepsTheWholeFundName(t *testing.T) {
	rows := ScreenRows(run(t, wrappedPairLabelHTML))
	seen := map[string]int{}
	for _, r := range rows {
		if r.HolderName == "Carole E. Stone" {
			seen[r.ShareClass]++
		}
	}
	if len(seen) != 3 {
		t.Fatalf("want one key per fund column, got %d: %v", len(seen), seen)
	}
	got := false
	for cls := range seen {
		if strings.Contains(cls, "Arizona") && strings.Contains(cls, "Dividend") {
			got = true
		}
	}
	if !got {
		t.Errorf("the fund name wrapped over three header rows was not assembled: %v", seen)
	}
}

// A D&O beneficial-ownership table that states NO PERCENT, because the proxy
// says in prose that no individual owns as much as 1%. The share columns name
// the COMPONENTS of the holding -- common stock, stock equivalents, options
// exercisable within 60 days, restricted stock, total -- and none of them says
// "owned", so the percent-less guard threw the whole table away. Transcribed
// from Xcel Energy's 2008 proxy (0001047469-08-003949), which emitted 19 rows
// before the duplicate rounds and zero after.
const pctlessComponentHTML = `<html><body>
<p><b>BENEFICIAL OWNERSHIP OF CERTAIN SHAREHOLDERS</b></p>
<p><b>Share Ownership of Directors and Officers</b></p>
<p>The following table sets forth information concerning beneficial ownership of
our common stock. None of the individual directors or officers beneficially
owned more than 1% of Xcel Energy's common stock.</p>
<p><b>Beneficial Ownership Table</b></p>
<table>
<tr><th>Name and Principal<br>Position of Beneficial Owner</th><th>Common Stock(1)</th><th>Stock Equivalents</th><th>Options Exercisable Within 60 Days</th><th>Restricted Stock</th><th>Total</th></tr>
<tr><td>Richard C. Kelly(2)<br>Chairman of the Board</td><td>299,508</td><td>11,183</td><td>297,750</td><td>16,020</td><td>624,461</td></tr>
<tr><td>C. Coney Burgess<br>Director</td><td>10,723</td><td>55,442</td><td>-</td><td>-</td><td>66,165</td></tr>
<tr><td>Fredric W. Corrigan<br>Director</td><td>6,168</td><td>11,000</td><td>-</td><td>-</td><td>17,168</td></tr>
<tr><td>Directors and Executive Officers as a group (26 persons)</td><td>1,211,766</td><td>510,344</td><td>1,165,051</td><td>56,684</td><td>2,943,835</td></tr>
</table></body></html>`

func TestPercentLessComponentOwnershipTable(t *testing.T) {
	rows := ScreenRows(run(t, pctlessComponentHTML))
	if len(rows) == 0 {
		t.Fatalf("a percent-less D&O ownership table emitted nothing")
	}
	k := find(rows, "Richard C. Kelly", "")
	if k == nil {
		t.Fatalf("the first director is missing: %+v", rows)
	}
	grp := 0
	for _, r := range rows {
		if r.IsGroupRow {
			grp++
		}
	}
	if grp == 0 {
		t.Errorf("the D&O group row was not emitted: %+v", rows)
	}
}

// The same class with ONE unlabelled share column: "Name | Shares(1)", under an
// ownership heading, with the D&O group row as the only ownership cue the table
// itself carries. United Technologies 2005 (0001193125-05-037477).
const pctlessBareSharesHTML = `<html><body>
<p><b>Security Ownership of Directors, Executive Officers and Certain Beneficial Owners</b></p>
<table>
<tr><th>Name</th><th>Shares(1)</th><th></th></tr>
<tr><td>Betsy J. Bernard</td><td>0</td><td>(2)(4)</td></tr>
<tr><td>George David</td><td>3,613,033</td><td></td></tr>
<tr><td>Jean-Pierre Garnier</td><td>23,050</td><td>(3)(4)</td></tr>
<tr><td>Jamie S. Gorelick</td><td>14,400</td><td>(3)(4)</td></tr>
<tr><td>Directors &amp; Executive Officers as a Group (31 in total)</td><td>8,065,646</td><td></td></tr>
</table></body></html>`

func TestPercentLessBareSharesOwnershipTable(t *testing.T) {
	rows := ScreenRows(run(t, pctlessBareSharesHTML))
	if find(rows, "George David", "") == nil {
		t.Fatalf("a percent-less Name/Shares ownership table emitted nothing usable: %+v", rows)
	}
}

// CONTROL for the two tests above: a percent-less table whose EVERY share
// column is an award column ("Number of Options Received or To Be Received")
// repeats the ownership table's people with a different count, and must stay
// rejected. Transcribed from 0000811211-07-000019.
const pctlessAwardOnlyHTML = `<html><body>
<p><b>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT</b></p>
<table>
<tr><th>Name</th><th>Number of Options Received or To Be Received</th></tr>
<tr><td>Paul R. Arena</td><td>1,000,000</td></tr>
<tr><td>James R. Rose</td><td>500,000</td></tr>
<tr><td>Douglas F. Bender</td><td>500,000</td></tr>
<tr><td>All current executive officers, as a group</td><td>2,000,000</td></tr>
</table></body></html>`

func TestPercentLessAwardOnlyTableStaysRejected(t *testing.T) {
	rows := ScreenRows(run(t, pctlessAwardOnlyHTML))
	if len(rows) != 0 {
		t.Fatalf("an options-received table was read as ownership: %d rows %+v", len(rows), rows)
	}
}

// SECOND control: a "Share Investment" plan table repeats the ownership table's
// officers with the plan's own count and no percent. Five of its rows matched the
// ownership table's exactly, so accepting it put identical rows back. Gannett
// 2015 (0001193125-15-093753).
const pctlessShareInvestmentHTML = `<html><body>
<p><b>Security Ownership of Certain Beneficial Owners and Management</b></p>
<table>
<tr><th>Name of Beneficial Owner</th><th>Shares Beneficially Owned</th><th>Percent of Class</th></tr>
<tr><td>Gracia C. Martore</td><td>806,932</td><td>*</td></tr>
<tr><td>Robert J. Dickey</td><td>290,701</td><td>*</td></tr>
<tr><td>Susan Ness</td><td>10,485</td><td>*</td></tr>
<tr><td>All directors and executive officers as a group (19 persons)</td><td>2,057,891</td><td>1.2</td></tr>
</table>
<p>The following table shows share investment by our officers and directors.</p>
<table>
<tr><th>Name of Officer or Director</th><th>Title</th><th>Share Investment</th></tr>
<tr><td>Gracia C. Martore</td><td>President and CEO, Director</td><td>827,165</td></tr>
<tr><td>Robert J. Dickey</td><td>President/USCP</td><td>290,701</td></tr>
<tr><td>Susan Ness</td><td>Director</td><td>10,485</td></tr>
<tr><td>All directors and executive officers as a group (19 persons)</td><td></td><td>2,225,917</td></tr>
</table></body></html>`

func TestShareInvestmentPlanTableStaysRejected(t *testing.T) {
	rows := ScreenRows(run(t, pctlessShareInvestmentHTML))
	tabs := map[int]bool{}
	for _, r := range rows {
		tabs[r.TableIndex] = true
	}
	if len(tabs) != 1 {
		t.Fatalf("share-investment plan table read as ownership: %d tables %+v", len(tabs), rows)
	}
	if find(rows, "Gracia C. Martore", "") == nil {
		t.Fatalf("the real ownership table stopped emitting: %+v", rows)
	}
}

// An ASCII proxy writes its column headings as ONE wide group spanning every
// value column -- "Name and Address   Number of Shares of Common Stock
// Beneficially Owned Percent" -- so the positional column label became that
// whole header row. The label carries "Options (a) Warrants (b)" from the line
// below it, and the screen's non-common-stock rule then dropped EVERY row of the
// table because its share_class said "warrant" and "option". Transcribed from
// Royal Gold's 1996 proxy (0000085535-96-000010).
const asciiWholeHeaderRowLabel = `
      SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND
                         MANAGEMENT

     The following table shows the beneficial ownership, as of
October 18, 1996, of the Company's Common Stock by each director,
by each executive officer, by any person who is known to the
Company to be the beneficial owner of more than 5% of the issued
and outstanding shares of Common Stock of the Company and by all
of the Company's directors and executive officers as a group.

Name and Address   Number of Shares of Common Stock Beneficially Owned Percent
of Beneficial                    Subject to:                             of
Owners                     Shares   Options (a) Warrants (b) Total (c)  Class

Stanley Dempsey (d)         495,167   463,000     15,000     973,167    6.3
Royal Gold, Inc.
1660 Wynkoop Street
Suite 1000
Denver, Colorado  80202

Edwin W. Peiker, Jr. (e)    455,178    17,500     15,000     487,678    3.1
Royal Gold, Inc.
1660 Wynkoop Street
Suite 1000
Denver, Colorado  80202

James W. Stuckert         1,560,874     15,000    80,000    1,655,874   10.7
Hilliard, Lyons, Inc.
P.O. Box 32760
Louisville, Kentucky  40232
`

func TestASCIIWholeHeaderRowIsNotAClassLabel(t *testing.T) {
	rows := ScreenRows(run(t, asciiWholeHeaderRowLabel))
	sd := find(rows, "Stanley Dempsey", "")
	if sd == nil {
		t.Fatalf("every row was dropped; the header row became the share class: %+v", rows)
	}
	for _, r := range rows {
		if strings.Contains(strings.ToLower(r.ShareClass), "warrant") ||
			strings.Contains(strings.ToLower(r.ShareClass), "percent") {
			t.Errorf("share_class is a whole header row: %q", r.ShareClass)
		}
	}
	if sd.Percent == nil || *sd.Percent != 6.3 {
		t.Errorf("percent lost: %+v", sd.Percent)
	}
}

// A modern D&O table carries a STUB column that names the population of each
// block ("Directors (including nominees)", "Named Executive Officers") to the
// left of the holder column. Its final row is the D&O group total, and the
// collective label is written in that stub column with the HOLDER column left
// empty -- so the row was skipped for having no holder, and the filing lost the
// only group row it has. Transcribed from Old Republic's 2025 proxy
// (0001140361-25-010962).
const stubColumnGroupRowHTML = `<html><body>
<p><b>Principal Holders of Securities</b></p>
<table>
<tr><th></th><th>Name of Beneficial Owner</th><th>Shares Subject to Stock Options</th><th>Other Shares Beneficially Owned</th><th>Total</th><th>Percent of Class</th></tr>
<tr><td>Directors (including nominees)</td><td>Barbara A. Adachi</td><td>0</td><td>8,287</td><td>8,287</td><td>**</td></tr>
<tr><td>Directors (including nominees)</td><td>Steven J. Bateman</td><td>0</td><td>29,551</td><td>29,551</td><td>**</td></tr>
<tr><td>Named Executive Officers</td><td>Craig R. Smiddy</td><td>600,000</td><td>379,786</td><td>979,786</td><td>0.39</td></tr>
<tr><td>Directors and Executive Officers as a group (20 individuals) (7)</td><td></td><td>1,805,516</td><td>920,987</td><td>2,726,503</td><td>1.1</td></tr>
</table></body></html>`

func TestStubColumnGroupRow(t *testing.T) {
	rows := ScreenRows(run(t, stubColumnGroupRowHTML))
	var g *Row
	for i := range rows {
		if rows[i].IsGroupRow {
			g = &rows[i]
		}
	}
	if g == nil {
		t.Fatalf("the group row written in the stub column was lost: %+v", rows)
	}
	if g.Percent == nil || *g.Percent != 1.1 {
		t.Errorf("group row percent: %+v", g.Percent)
	}
	if g.GroupN != 20 {
		t.Errorf("group n: %d", g.GroupN)
	}
	// The stub column must not turn the PERSON rows into group rows.
	if find(rows, "Barbara A. Adachi", "") == nil {
		t.Errorf("a person row was lost: %+v", rows)
	}
	ngrp := 0
	for _, r := range rows {
		if r.IsGroupRow {
			ngrp++
		}
	}
	if ngrp != 1 {
		t.Errorf("want exactly one group row, got %d: %+v", ngrp, rows)
	}
}

// The SHARES column is headed "Amount and Nature of Beneficial Ownership of
// Common Stock" and the HOLDER column is headed "Directors and Management", which
// names no holder. reHdrNameCol matched "beneficial owner" INSIDE "Beneficial
// OwnerSHIP", so repoint() moved the name role off the holder column and onto the
// shares column, and every person row was then skipped for having no holder --
// leaving the filing with its group row alone. Transcribed from SITE Centers'
// 2025 proxy (0001193125-25-064065).
const beneficialOwnershipHeaderHTML = `<html><body>
<p><b>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS</b></p>
<table>
<tr><td>Directors and Management</td><td colspan="2">Amount and Nature of Beneficial Ownership of Common stock(1)</td><td>Percentage Ownership (%)(2)</td></tr>
<tr><td>David R. Lukes</td><td>702,291</td><td></td><td>*</td></tr>
<tr><td>Linda B. Abraham</td><td>36,096</td><td></td><td>*</td></tr>
<tr><td>Terrance R. Ahern</td><td>68,618</td><td></td><td>*</td></tr>
<tr><td>Jane E. DeFlorio</td><td>42,488</td><td></td><td>*</td></tr>
<tr><td>Victor B. MacFarlane</td><td>17,466</td><td></td><td>*</td></tr>
<tr><td>Barry A. Sholem</td><td>110,024</td><td>(4)</td><td>*</td></tr>
<tr><td>John M. Cattonar</td><td>38,273</td><td></td><td>*</td></tr>
<tr><td>All Current Executive Officers and Directors as a Group (10 persons)</td><td>9,033,215</td><td></td><td>8.6</td></tr>
<tr><td>More Than 5% Owners</td><td colspan="2">Amount and Nature of Beneficial Ownership of Common stock</td><td>Percentage Ownership (%)(2)</td></tr>
<tr><td>Blackrock, Inc.</td><td>17,033,619</td><td>(5)</td><td>16.2</td></tr>
<tr><td>Alexander Otto</td><td>9,033,000</td><td>(3)</td><td>8.6</td></tr>
</table></body></html>`

func TestBeneficialOwnershipHeaderIsNotTheNameColumn(t *testing.T) {
	rows := ScreenRows(run(t, beneficialOwnershipHeaderHTML))
	for _, want := range []string{"David R. Lukes", "Linda B. Abraham", "Alexander Otto"} {
		if find(rows, want, "") == nil {
			t.Fatalf("%q missing; the name role moved onto the shares column: %+v", want, rows)
		}
	}
	if r := find(rows, "Alexander Otto", ""); r == nil || r.Shares == nil || *r.Shares != 9033000 {
		t.Errorf("shares wrong: %+v", r)
	}
}

// The D&O group row's label is written ENTIRELY inside parentheses -- "(All
// Directors and officers as a group 8 persons)" -- and reParenOnlyName reads a
// fully parenthesised name cell as a qualifier continuing the holder above it, so
// the group row was re-emitted under the LAST DIRECTOR'S name and the filing lost
// the only group row it has, percent and all. Transcribed from 0001493152-24-043144.
const parenthesisedGroupRowHTML = `<html><body>
<p><b>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT</b></p>
<table>
<tr><th>Name and address (1)</th><th>Number of shares beneficially owned</th><th>Percentage of ownership (2)</th></tr>
<tr><td>Kimberly Murphy (9)</td><td>71,646</td><td>*</td></tr>
<tr><td>John Gandolfo (10)</td><td>50,102</td><td>*</td></tr>
<tr><td>(All Directors and officers as a group 8 persons)</td><td>1,139,355</td><td>10.1</td></tr>
</table></body></html>`

func TestParenthesisedGroupRowIsNotAQualifier(t *testing.T) {
	rows := ScreenRows(run(t, parenthesisedGroupRowHTML))
	var g *Row
	for i := range rows {
		if rows[i].IsGroupRow {
			g = &rows[i]
		}
	}
	if g == nil {
		t.Fatalf("the parenthesised group row was read as a qualifier: %+v", rows)
	}
	if g.Percent == nil || *g.Percent != 10.1 {
		t.Errorf("group row percent: %+v", g.Percent)
	}
	if g.GroupN != 8 {
		t.Errorf("group n: %d", g.GroupN)
	}
	// It must not have been re-emitted under the last director's name.
	n := 0
	for _, r := range rows {
		if r.HolderName == "John Gandolfo" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("John Gandolfo emitted %d times", n)
	}
}

// The D&O group row's label sits beside an ENUMERATOR cell: the holder column
// holds "(iii)" and the collective label is in the column to its right. "(iii)"
// is a fully parenthesised cell, so it was read as a qualifier continuing the
// holder above and the group total was re-emitted under that holder's name.
// Transcribed from 0001193125-12-177680.
const enumeratorGroupRowHTML = `<html><body>
<p><b>Security Ownership of Certain Beneficial Owners and Management</b></p>
<table>
<tr><th>Name of Beneficial Owner</th><th>Percent of Class</th><th>Number of Shares</th><th>Percent of Class</th></tr>
<tr><td>Joseph A. Mollica</td><td></td><td>412,400</td><td>*</td></tr>
<tr><td>Ted W. Love</td><td></td><td>158,000</td><td>*</td></tr>
<tr><td>(iii)</td><td>All Director nominees and Executive Officers as a group</td><td>1,314,087</td><td>2.63</td></tr>
</table></body></html>`

func TestEnumeratorCellDoesNotHideAGroupRow(t *testing.T) {
	rows := ScreenRows(run(t, enumeratorGroupRowHTML))
	var g *Row
	for i := range rows {
		if rows[i].IsGroupRow {
			g = &rows[i]
		}
	}
	if g == nil {
		t.Fatalf("the group row beside the enumerator cell was lost: %+v", rows)
	}
	if g.Percent == nil || *g.Percent != 2.63 {
		t.Errorf("group row percent: %+v", g.Percent)
	}
	if n := 0; true {
		for _, r := range rows {
			if r.HolderName == "Ted W. Love" {
				n++
			}
		}
		if n != 1 {
			t.Errorf("Ted W. Love emitted %d times", n)
		}
	}
}

// A MUTUAL FUND's 5% record-holder table states fractional share counts, because
// a fund's register is fractional: every row of Oakmark's 2016 table
// (0001104659-16-100553) is correctly aligned -- name and address, fund and class,
// number of shares, percentage of outstanding shares held -- and all 55 were
// discarded by the screen rule that reads a fraction as a mis-read column.
const fundFractionalSharesHTML = `<html><body>
<p><b>Security Ownership of Certain Beneficial Owners</b></p>
<table>
<tr><th>Name and Address</th><th>Fund and Class</th><th>Number of Shares</th><th>Percentage of Outstanding Shares Held</th></tr>
<tr><td>Charles Schwab &amp; Co. Inc.<br>101 Montgomery St.<br>San Francisco, CA 94104-4151</td><td>Oakmark Fund, Class I</td><td>50,219,260.594</td><td>19.99%</td></tr>
<tr><td>First Clearing LLC<br>2801 Market ST.<br>Saint Louis, MO 63103-2523</td><td>Oakmark Equity &amp; Income Fund, Class I</td><td>31,193,011.956</td><td>5.43%</td></tr>
<tr><td>Great West Life &amp; Annuity<br>8515 E. Orchard Rd.<br>Greenwood Village, CO 80111-5002</td><td>Oakmark Equity &amp; Income Fund, Class II</td><td>1,496,337.559</td><td>5.28%</td></tr>
</table></body></html>`

func TestFundFractionalSharesSurviveTheScreen(t *testing.T) {
	rows := ScreenRows(run(t, fundFractionalSharesHTML))
	// Two of the three survive here; the Class II row is dropped by the
	// implied-outstanding-total rule, which is a separate question -- one class
	// with a single row cannot get a median of its own. On the real filing the
	// same change carries 44 of 55 rows, and all 18 of 0001193125-17-377627.
	if len(rows) < 2 {
		t.Fatalf("want the fractional fund rows kept, got %d: %+v", len(rows), rows)
	}
	r := find(rows, "Charles Schwab & Co. Inc", "")
	if r == nil || r.Percent == nil || *r.Percent != 19.99 {
		t.Fatalf("Schwab row wrong: %+v", r)
	}
	if r.Shares == nil || *r.Shares != 50219260.594 {
		t.Errorf("shares: %+v", r.Shares)
	}
}

// The D&O group label WRAPS over two grid rows: the first carries the numbers and
// the head of the label ("All directors & executive"), the row under it carries
// the tail and no numbers at all ("officers as a group (7 persons)"). Neither half
// reads as a collective label on its own, so the filing lost its group row and its
// 20.3%. Transcribed from 0001019687-05-000788.
const wrappedGroupLabelDOMHTML = `<html><body>
<p><b>Security Ownership of Certain Beneficial Owners and Management</b></p>
<table>
<tr><th>Title of Class</th><th></th><th>Name of Beneficial Owner</th><th>Shares</th><th></th><th>Percent of Class</th></tr>
<tr><td>Common</td><td></td><td>Jack Smith</td><td>1,200,000</td><td>(1)</td><td>5.5</td></tr>
<tr><td>Common</td><td></td><td>Mary Jones</td><td>900,000</td><td>(2)</td><td>4.1</td></tr>
<tr><td colspan="2">All directors &amp; executive</td><td></td><td>4,394,765</td><td>(9)</td><td>20.3</td></tr>
<tr><td colspan="2">officers as a group (7 persons)</td><td></td><td></td><td></td><td></td></tr>
</table></body></html>`

func TestForwardWrappedGroupLabelInTheDOM(t *testing.T) {
	rows := ScreenRows(run(t, wrappedGroupLabelDOMHTML))
	var g *Row
	for i := range rows {
		if rows[i].IsGroupRow {
			g = &rows[i]
		}
	}
	if g == nil {
		t.Fatalf("the forward-wrapped group label was lost: %+v", rows)
	}
	if g.Percent == nil || *g.Percent != 20.3 {
		t.Errorf("group row percent: %+v", g.Percent)
	}
	if g.GroupN != 7 {
		t.Errorf("group n: %d", g.GroupN)
	}
}

// "Class H Common Stock" IS common stock. The screen's non-common rule matched
// `class [b-z]` in the share_class the header assembled ("Class H Common Stock
// #") and dropped ALL of GM's director rows, leaving the filing with nothing.
// Transcribed from General Motors' 2000 proxy (0000890163-00-000125).
const classHCommonStockASCII = `
                      SECURITY OWNERSHIP OF MANAGEMENT

     In most cases, each individual has sole voting and investment power with
respect to the shares he or she beneficially owns.

                                         Shares                Deferred
                                   Beneficially Owned         Stock Units           Total Shares
                                 -----------------------   -----------------   -----------------------
                                               Class H               Class H                 Class H
                                   Common       Common     Common    Common      Common       Common
          Directors                Stock        Stock       Stock     Stock      Stock        Stock
          ---------              ----------   ----------   -------   -------   ----------   ----------
                                     #            #           #         #          #            #
P. N. Barnevik (c)............       10,000          -0-     1,093       309       11,093          309
J. H. Bryan (c)...............        7,000          -0-     8,534       962       15,534          962
T. E. Everhart (d)............          400          -0-    13,026    11,543       13,426       11,543
G. M. C. Fisher (d)...........        5,000          -0-       760     3,821        5,760        3,821
N. Idei.......................        4,250          750       -0-       -0-        4,250          750
`

func TestClassLetterCommonStockIsCommonStock(t *testing.T) {
	rows := ScreenRows(run(t, classHCommonStockASCII))
	if len(rows) < 4 {
		t.Fatalf("Class H Common Stock rows were dropped as non-common: %d %+v", len(rows), rows)
	}
	if find(rows, "J. H. Bryan", "") == nil {
		t.Errorf("row missing: %+v", rows)
	}
}

// The D&O group total is printed in its OWN one-row HTML table at the foot of the
// page, continuing the ownership table above it. The two-data-row floor -- there
// to stop a stray one-row table being read as ownership -- rejected it, so the
// filing emitted twenty person rows and no group row at all. Transcribed from
// Agilent's 2005 proxy (0001193125-05-003365).
const groupRowInItsOwnTableHTML = `<html><body>
<p><b>Security Ownership of Certain Beneficial Owners and Management</b></p>
<table>
<tr><th>Name of Beneficial Owner</th><th>Shares Beneficially Owned</th><th></th><th>Percentage(1)</th></tr>
<tr><td>William P. Sullivan</td><td>1,123,456</td><td></td><td>*</td></tr>
<tr><td>Adrian T. Dillon</td><td>654,321</td><td></td><td>*</td></tr>
<tr><td>James G. Cullen</td><td>45,678</td><td></td><td>*</td></tr>
</table>
<table>
<tr><td></td><td></td><td></td><td></td></tr>
<tr><td></td><td colspan="3">Shares of Agilent Common Stock Beneficially Owned</td></tr>
<tr><td>Name of Beneficial Owner</td><td>Number</td><td>Nature(2)</td><td>Percentage(1)</td></tr>
<tr><td>All current directors and executive officers as a group (18 persons)</td><td>7,223,483</td><td></td><td>1.5</td></tr>
</table></body></html>`

func TestGroupRowAloneInAContinuationTable(t *testing.T) {
	rows := ScreenRows(run(t, groupRowInItsOwnTableHTML))
	var g *Row
	for i := range rows {
		if rows[i].IsGroupRow {
			g = &rows[i]
		}
	}
	if g == nil {
		t.Fatalf("the group row in its own one-row table was rejected: %+v", rows)
	}
	if g.Percent == nil || *g.Percent != 1.5 {
		t.Errorf("group row percent: %+v", g.Percent)
	}
	if g.GroupN != 18 {
		t.Errorf("group n: %d", g.GroupN)
	}
	if find(rows, "William P. Sullivan", "") == nil {
		t.Errorf("a person row was lost: %+v", rows)
	}
}

// A FUND PROXY OFTEN HAS NO 5% TABLE AT ALL. The record holders are disclosed
// in running prose, one sentence per holder, under a bare fund-name line:
// "<holder>, <address>, which owned N shares (representing approximately P% of
// the Fund's then outstanding shares)". Transcribed from
// 0000728889-05-000687 (Oppenheimer/OFI Tremont 2005) and
// 0000879569-99-000012 (the "N Class A Shares (P%)" variant), both of which
// parsed to ZERO rows.
const proseFivePercentText = `
                      OFI Tremont Core Strategies Hedge Fund

American Express Trust Company, as Trustee for The American Express Retirement
Plan, 991 ACP Financial Center, Minneapolis, Minnesota 55747, which owned
25,610.010 shares of the Fund (representing approximately 10.6% of the Fund's
then outstanding shares).

SCI Cash Balance Plan, 1929 Allen Parkway, Houston, Texas 77070, which owned
24,662.463 shares of the Fund (representing approximately 10.2% of the Fund's
then outstanding shares).

                     Oppenheimer International Value Fund

Merrill Lynch, Pierce, Fenner & Smith, Jacksonville, FL, on behalf of various
customer accounts, owned approximately 1,343,257 Class A Shares (9.26% of the
outstanding Class A Shares).
`

func TestProseFivePercentHoldersRecovered(t *testing.T) {
	rows := runProse(t, proseFivePercentText)
	if len(rows) != 3 {
		t.Fatalf("want 3 prose holder rows, got %d: %+v", len(rows), rows)
	}
	for _, c := range []struct {
		name   string
		shares float64
		pct    float64
	}{
		{"American Express Trust Company", 25610.010, 10.6},
		{"SCI Cash Balance Plan", 24662.463, 10.2},
		{"Merrill Lynch", 1343257, 9.26},
	} {
		var got *Row
		for i := range rows {
			if strings.HasPrefix(rows[i].HolderName, c.name) {
				got = &rows[i]
				break
			}
		}
		if got == nil {
			t.Fatalf("no row whose name starts %q: %+v", c.name, rows)
		}
		if got.Shares == nil || *got.Shares != c.shares {
			t.Errorf("%s: shares = %v, want %v", c.name, got.Shares, c.shares)
		}
		if got.Percent == nil || *got.Percent != c.pct {
			t.Errorf("%s: percent = %v, want %v", c.name, got.Percent, c.pct)
		}
	}
}

// The prose reader must not fire on a partnership's impairment schedule, whose
// "(50% owned)" parentheticals and dollar carrying values match a careless
// share-and-percent rule. Transcribed from 0000950136-01-000330.
const proseNotOwnershipText = `
                     DESCRIPTION                 CARRYING VALUE   IMPAIRMENT

Century Park I Office Complex, Kearny Mesa, California (50% owned)
$15,923,305      $11,700,000      $4,223,305
568 Broadway Office Building, New York, New York (38.925% owned)
$15,696,401      $10,821,150      $4,875,251
`

func TestProseReaderIgnoresNonOwnershipProse(t *testing.T) {
	if rows := runProse(t, proseNotOwnershipText); len(rows) != 0 {
		t.Fatalf("want 0 rows, got %d: %+v", len(rows), rows)
	}
}

// Three name defects the first prose cut produced, transcribed from the
// filings that showed them: an initialism read as a sentence end
// (0000728889-05-000687, "The H.E.B. Savings & Retirement Plan Trust"), a
// middle initial read the same way (0000879569-99-000012, "William M.
// Whitmire"), a PO box the address cut kept (0000896923-96-000003, "Cede &
// Co., P.O. Box 20"), and a group total whose sentence opens with a date
// (0000950137-02-003588).
const proseNameEdgesText = `
The H.E.B. Savings & Retirement Plan Trust, 646 South Main Avenue, San Antonio,
Texas 78204, which owned 5,407.391 shares of the Fund (representing
approximately 7.2% of the Fund's then outstanding shares).

Mr. William M. Whitmire, Atlanta, GA, owned approximately 1,705,148 Class A
Shares (15.42% of the outstanding Class A Shares).

Cede & Co., P.O. Box 20, Bowling Green Station, New York, New York 10004, owned
of record 13,926,999 shares or 97.34% of the outstanding Common Stock.

On February 28, 2002, the Trustees and executive officers of the Funds as a
group beneficially owned 424,520 shares, or less than 1% of the outstanding
shares of the Funds.
`

func TestProseHolderNameEdges(t *testing.T) {
	rows := runProse(t, proseNameEdgesText)
	want := []struct {
		name  string
		group bool
	}{
		{"The H.E.B. Savings & Retirement Plan Trust", false},
		{"William M. Whitmire", false},
		{"Cede & Co.", false},
		{"the Trustees and executive officers of the Funds as a group", true},
	}
	if len(rows) != len(want) {
		t.Fatalf("want %d rows, got %d: %+v", len(want), len(rows), rows)
	}
	for i, w := range want {
		if rows[i].HolderName != w.name {
			t.Errorf("row %d name = %q, want %q", i, rows[i].HolderName, w.name)
		}
		if rows[i].IsGroupRow != w.group {
			t.Errorf("row %d is_group_row = %v, want %v", i, rows[i].IsGroupRow, w.group)
		}
	}
}

// A FUND'S D&O AGGREGATE, STATED IN PROSE AND NOWHERE ELSE. The collective
// label is "the Trustees and officers of the Fund", which the table path's
// collective nouns deliberately do not carry ("Trustees of the X Pension
// Trust" is a real holder), and the percent is "less than 1%", which is a
// MARKER and not the number 1. Transcribed from 0000865177-94-000007 and
// 0000081259-96-000011, both of which parsed to zero rows.
const proseTrusteeGroupText = `
As of March 15, 1994, the Trustees and officers of the Fund owned in the
aggregate 82,058 Class A shares of the Fund comprising less than 1% of the
outstanding shares.

As of March 15, 1996, the Trustees and officers of the fund owned a total of
579,458 shares of the fund, comprising 2.4% of the outstanding shares.
`

func TestProseTrusteeGroupTotal(t *testing.T) {
	rows := runProse(t, proseTrusteeGroupText)
	if len(rows) != 2 {
		t.Fatalf("want 2 rows, got %d: %+v", len(rows), rows)
	}
	if s := rows[1]; s.Shares == nil || *s.Shares != 579458 || !s.IsGroupRow ||
		s.Percent == nil || *s.Percent != 2.4 {
		t.Errorf("\"owned a total of\" row = %+v", s)
	}
	r := rows[0]
	if !r.IsGroupRow {
		t.Errorf("is_group_row = false, want true (name %q)", r.HolderName)
	}
	if r.HolderName != "the Trustees and officers of the Fund" {
		t.Errorf("name = %q", r.HolderName)
	}
	if r.Shares == nil || *r.Shares != 82058 {
		t.Errorf("shares = %v, want 82058", r.Shares)
	}
	if r.Percent != nil {
		t.Errorf("percent = %v, want nil: \"less than 1%%\" is a marker", *r.Percent)
	}
	if r.PctMarker != "<1%" {
		t.Errorf("percent_marker = %q, want %q", r.PctMarker, "<1%")
	}
}

// Transcribed from 0000950133-05-001853. The beneficial-ownership table's
// auxiliary columns are headed "Number of \"Underwater\" Options Vesting by
// June 30, 2005" and "Number of \"In the Money\" Options Vesting by June 30,
// 2005" beside its own "Number of Shares Beneficially Owned" and "Percent of
// Class", and the option-detail veto threw the whole table away -- the group
// total with it. The SEC's option-detail heading is "VALUE of Unexercised
// In-the-Money Options"; a COUNT of in-the-money options is a column an
// ownership table may carry.
const inTheMoneyCountColumnHTML = `<html><body>
<p>Security Ownership of Certain Beneficial Owners and Management</p>
<table>
<tr><th>Name of Beneficial Owner</th>
    <th>Number of Shares Beneficially Owned (1)</th>
    <th>Number of "Underwater" Options Vesting by June 30, 2005 (2)</th>
    <th>Number of "In the Money" Options Vesting by June 30, 2005 (2)</th>
    <th>Percent of Class (3)</th></tr>
<tr><td>Thomas P. Danaher</td><td>46,000</td><td>1,000</td><td>30,338</td><td>1.60 %</td></tr>
<tr><td>William M. Drohan</td><td>26,103</td><td>1,000</td><td>30,338</td><td>1.17 %</td></tr>
<tr><td>All directors &amp; executive officers as a group (12 persons)</td><td>352,730</td><td>12,000</td><td>364,056</td><td>16.84 %</td></tr>
</table></body></html>`

func TestACountOfInTheMoneyOptionsIsNotAnOptionDetailTable(t *testing.T) {
	rows := run(t, inTheMoneyCountColumnHTML)
	// Which of the three numeric columns becomes Shares is a separate
	// question; what this pins is that the table is not thrown away.
	if got := find(rows, "Thomas P. Danaher", ""); got == nil || got.Percent == nil || *got.Percent != 1.60 {
		t.Fatalf("ownership table rejected on an in-the-money COUNT column: %d rows %+v", len(rows), rows)
	}
	var grp *Row
	for i := range rows {
		if rows[i].IsGroupRow {
			grp = &rows[i]
		}
	}
	if grp == nil || grp.Percent == nil || *grp.Percent != 16.84 {
		t.Fatalf("group row lost: %+v", grp)
	}
}

func TestASCIIClassPercentsOnAddressLine(t *testing.T) {
	// 0000021847-98-000050: each class's percent is printed under its shares.
	body := `As of June 12, 1998, the following shareholder owned more than 5% of a
class of shares of the Fund and was deemed to control the Fund:

      Name and Address               Number of Shares Owned and Percent of Class

                                        Class A      Class B        Class C
Keyport Life Insurance Company          267,599      26,771        26,771
125 High Street                         99.60%       100%          100%
Boston, MA  02101

Votes cast by proxy or in person will be counted by persons appointed by
 the Fund to act as election tellers for the Meeting.`
	rows := run(t, body)
	for _, want := range []struct {
		class       string
		shares, pct float64
	}{{"Class A", 267599, 99.60}, {"Class B", 26771, 100}, {"Class C", 26771, 100}} {
		r := find(rows, "Keyport Life Insurance Company", want.class)
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.Percent == nil || *r.Percent != want.pct {
			t.Fatalf("stacked class %s not paired: %+v", want.class, rows)
		}
	}
	if len(rows) != 3 {
		t.Fatalf("address must not emit a holder or repeat a class: %+v", rows)
	}
	kept := ScreenRows(rows)
	if len(kept) != 1 || kept[0].HolderName != "Keyport Life Insurance Company" || kept[0].Shares == nil || *kept[0].Shares != 267599 || kept[0].ShareClass != "Class A" {
		t.Fatalf("common-class holding lost at screen: %+v", kept)
	}
}

// A stock-owned-by heading introduces the same table as security ownership.
func TestASCIIStockOwnedByHeading(t *testing.T) {
	body := `             COMMON STOCK OWNED BY DIRECTORS AND EXECUTIVE OFFICERS

         The shares of Cecil Bancorp's common stock that were beneficially owned
on the Record Date by persons who were directors and officers on that date, are
shown below.

                                   Amount and
                                    Nature of                   Percentage
                                   Beneficial                    of Shares
Name                               Ownership (1)               Outstanding (2)
- ----                               -------------               --------------
Donald F. Angert                      22,824                          1.40%
Matthew G. Bathon                     19,064(3)                       1.17
Mary B. Halsey                        82,134                          5.03
Robert L. Johnson                     11,393                           .70
Charles Sposato                      531,015(4)                      32.46
Thomas L. Vaughan, Sr.                24,103                          1.48
All Directors and Executive
 Officers as a Group
 (12 persons)                        731,435(5)                      44.55%

- -----------------
(1)      Beneficial ownership is defined by rules of the Securities and Exchange
         Commission, and includes shares that the person has or shares voting or`
	rows := ScreenRows(run(t, body))
	r := find(rows, "Donald F. Angert", "")
	if r == nil || r.Shares == nil || *r.Shares != 22824 || r.Percent == nil || *r.Percent != 1.40 {
		t.Fatalf("stock-owned-by table missed: %+v", rows)
	}
	j := find(rows, "Robert L. Johnson", "")
	if j == nil || j.Shares == nil || *j.Shares != 11393 || j.Percent == nil || *j.Percent != .70 {
		t.Fatalf("leading-dot percent overwrote shares: %+v", j)
	}
	for _, r := range rows {
		if strings.Contains(r.ShareClass, "Beneficial") || strings.Contains(r.ShareClass, "of Shares") {
			t.Fatalf("column header became a fund label: %+v", r)
		}
	}
	var g *Row
	for i := range rows {
		if rows[i].IsGroupRow {
			g = &rows[i]
		}
	}
	if g == nil || g.Shares == nil || *g.Shares != 731435 || g.Percent == nil || *g.Percent != 44.55 {
		t.Fatalf("real group row missed: %+v", g)
	}
}

// The ownership cue runs down a column; no accepted section heading is present.
func TestASCIIStackedOwnershipHeaderDiscoversManagementTable(t *testing.T) {
	body := `                            STOCK OWNED BY MANAGEMENT

         The following table sets forth  information as of February 9, 2001 with
respect to the shares of the Company's Common Stock  beneficially  owned by each
current  director  of the  Company,  by  each  nominee  who is not  currently  a
director,  by each executive  officer listed in the Summary  Compensation  Table
below and by all current  directors and  executive  officers of the Company as a
group. There are no arrangements  known to the Company,  including any pledge by
any  person  of  securities  of the  Company,  the  operation  of which may at a
subsequent  date  result in a change in control of the  Company.  All  ownership
consists of sole voting and dispositive power, except as noted.
<TABLE>
<CAPTION>
Name                                                      Amount and Nature                  Percent of
                                                            of Beneficial                   Common Stock
                                                             Ownership(1)                    Outstanding
<S>                                                       <C>                                <C>
Howard M. Arnold                                             7,098   (2)                         **

Thomas P. Barbera                                          633,650   (3)                         1.32%

Francis C. Bruno, M.D.                                      66,012   (4)                         **

John H. Cook, III, M.D.                                     14,095   (5)                         **

Raymond H. Cypess, D.V.M., Ph.D.                            21,106   (6)                         **

John W. Dillon                                                 0

Vera C. Dvorak, M.D.                                        86,500   (7)                         **

Robert E. Foss                                             545,383   (8)                         1.13%

Mark D. Groban, M.D.                                       701,796   (9)                         1.46%

Debbie J. Hulen                                            103,800   (10)                        **

John P. Mamana, M.D.                                        27,864   (11)                        **


Edward J. Muhl                                             17,000    (12)                        **

Janet L. Norwood                                           15,000    (13)                        **

John A. Paganelli                                          15,000    (14)                        **

Ivan R. Sabel                                              10,000    (15)                        **

James A. Wild                                              24,618    (16)                        **

All current directors, and                              2,435,079    (17)                        5.06%
executive officers as a group (20 persons)
</TABLE>`
	rows := ScreenRows(run(t, body))
	if len(rows) != 17 {
		t.Fatalf("want 17 genuine holders, got %d: %+v", len(rows), rows)
	}
	for _, want := range []struct {
		name   string
		shares float64
		pct    float64
	}{
		{"Thomas P. Barbera", 633650, 1.32},
		{"Robert E. Foss", 545383, 1.13},
		{"Mark D. Groban", 701796, 1.46},
	} {
		r := find(rows, want.name, "")
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.Percent == nil || *r.Percent != want.pct {
			t.Errorf("missing real holding %+v: %+v", want, rows)
		}
	}
	z := find(rows, "John W. Dillon", "Common Stock")
	if z == nil || z.Shares == nil || *z.Shares != 0 || z.Percent != nil {
		t.Fatalf("explicit zero holding lost or converted to a percent: %+v", z)
	}
	for _, r := range rows {
		if r.ShareClass != "Common Stock" {
			t.Errorf("common-stock caption lost: %+v", r)
		}
		if r.IsGroupRow && r.GroupN == 20 && r.Shares != nil && *r.Shares == 2435079 && r.Percent != nil && *r.Percent == 5.06 {
			return
		}
	}
	t.Fatalf("missing 20-person group holding: %+v", rows)
}

func TestASCIIStackedHeaderDiscoveryDoesNotAdmitNonOwnership(t *testing.T) {
	for _, body := range []string{
		`Name                        Amount and Nature         Percent of
                               of Annual                Compensation
                               Compensation             Outstanding
Sample Director A              $20,000                    1.2%
Sample Director B              $30,000                    1.8%`,
		`Name                        Amount and Nature         Percent of
                               of Beneficial            Common Stock
                               Ownership                Outstanding
Sample Director A              $20,000                    *
Sample Director B              $30,000                    *`,
		`Name                        Amount and Nature         Percent of
                               of Beneficial            Common Stock
                               Ownership                Outstanding
Salary and Bonus               20,000                     1.2%
All Other Compensation         30,000                     1.8%`,
		`Name                        Amount and Nature         Number of
                               of Beneficial            Unexercised
                               Ownership                Options
Sample Director A              20,000                     120
Sample Director B              30,000                     180`,
	} {
		if rows := ScreenRows(run(t, body)); len(rows) != 0 {
			t.Errorf("non-ownership table accepted: %+v", rows)
		}
	}
}

// 0001445546-11-002146: zero-value lines must not alter a legacy table's caption.
func TestASCIIHeaderFallbackPreservesLegacyFundCaption(t *testing.T) {
	body := `
BENEFICIAL OWNERSHIP

      As of December 31, 2010, the Independent Trustees of the Fund and James A.
Bowen, a Trustee and an "interested person" (as defined in the 1940 Act) of the
Fund (the "Interested Trustee"), beneficially owned the following numbers of
Shares of the Fund:

         -------------------------   --------------
         TRUSTEE
         -------------------------   --------------
         INTERESTED TRUSTEE
         -------------------------   --------------
         James A. Bowen                    0
         -------------------------   --------------
         INDEPENDENT TRUSTEES
         -------------------------   --------------
         Richard E. Erickson               0
         -------------------------   --------------
         Thomas R. Kadlec                 650
         -------------------------   --------------
         Robert F. Keith                   0
         -------------------------   --------------
         Niel B. Nielson                  386
         -------------------------   --------------

`
	rows := ScreenRows(run(t, body))
	for _, want := range []struct {
		name   string
		shares float64
	}{
		{"Thomas R. Kadlec", 650}, {"Niel B. Nielson", 386},
	} {
		r := find(rows, want.name, "Shares of the Fund")
		if r == nil || r.Shares == nil || *r.Shares != want.shares {
			t.Errorf("legacy fund caption or holding lost: %+v; rows=%+v", want, rows)
		}
	}
	if len(rows) != 2 {
		t.Fatalf("fallback changed existing table: %+v", rows)
	}
}

// 0000893220-94-000274: a new caption must not take precedence over management.
func TestASCIIHeaderFallbackPreservesLegacyManagementRows(t *testing.T) {
	body := `
SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS

     The following tables set forth information, as of April 30, 1994, with
respect to ownership of shares of Common Stock, Series B Preferred Stock, Series
C Preferred Stock and Series D Preferred Stock of the Corporation (the only
classes of outstanding voting securities of the Corporation) by each person who
is known to the Corporation to be the beneficial owner of more than five percent
of the Corporation's outstanding Common Stock, Series B Preferred Stock, Series
C Preferred Stock and Series D Preferred Stock. Statements regarding beneficial
ownership are based upon information furnished by the transfer agent and
contained in Schedule 13Ds filed with the Securities and Exchange Commission
(the "Commission"). Unless otherwise indicated below, each shareholder has sole
voting and dispositive power with respect to all shares beneficially owned.

                                       11
<PAGE>   14

COMMON STOCK

<TABLE>
<CAPTION>
     NAME AND ADDRESS OF           AMOUNT AND NATURE OF      PERCENT
       BENEFICIAL OWNER            BENEFICIAL OWNERSHIP      OF CLASS
- - - ------------------------------    ----------------------     --------
<S>                               <C>                        <C>
Comcast Corporation and                 12,627,934(1)          27.7%(2)
Barry Diller
c/o Davis, Polk & Wardell
450 Lexington Avenue
New York, New York 10017
Advance Publications, Inc.               2,958,333(3)           6.9%(2)
and its affiliates
950 Fingerboard Road
Staten Island, New York 10305
BellSouth Corporation                    8,627,934(4)          17.7%(2)
1155 Peachtree Street, N.E.
Atlanta, Georgia 30367
Comcast Corporation                      8,627,934(5)          20.2%(2)
and its affiliates
1234 Market Street
Philadelphia, PA 19107
Cox Enterprises, Inc.                    2,833,333(6)           6.6%(2)
1400 Lake Hearn Drive
Atlanta, Georgia 30319
Liberty Media Corporation               10,255,867(7)          23.3%(2)
and its affiliates
8101 E. Prentice Avenue
Englewood, Colorado 80111
Time Warner Inc.                         4,062,218(8)          10.0%(2)
and its affiliates
Time & Life Building
New York, New York 10020
</TABLE>

- - - ------------------------------
(1) In Schedule 13D filings with the Commission, Comcast and Barry Diller have
    reported that they have agreed to act as a group for the purpose of voting
    their securities of the Corporation and that they each have shared voting
    and dispositive power as to all shares beneficially owned by the group. See
    "Certain Transactions and Business Relationships" below. Includes 8,627,934
    shares beneficially owned by Comcast and 4,000,000 shares beneficially owned
    by Mr. Diller. Comcast's shares include 72,050 shares of Series C Preferred
    Stock, which are presently convertible into 720,500 shares of Common Stock,
    and warrants to purchase 1,700,000 shares of Common Stock, which are
    presently exercisable. Mr. Diller's shares include options to purchase
    3,000,000 shares of Common Stock, which are presently exercisable, but does
    not include options to purchase 3,000,000 shares of Common Stock, which are
    not presently exercisable or exercisable within 60 days after April 30,
    1994, and does not include 1,627,934 shares of Common Stock that Mr. Diller
    will be entitled to purchase from Liberty Media pursuant to the terms of the
    Stockholders Agreement and the Liberty-QVC Agreement.

(2) Under the terms of Rule 13d-3 ("Rule 13d-3") promulgated under the
    Securities Exchange Act of 1934, as amended (the "Exchange Act"), the shares
    of Series B Preferred Stock, Series C Preferred Stock and Series D Preferred
    Stock that are presently convertible or convertible within 60 days after
    April 30, 1994 into shares of Common Stock, options to purchase Common Stock
    and warrants to purchase Common Stock that are presently exercisable or
    exercisable within 60

                                       12
<PAGE>   15

    days after April 30, 1994, which are owned by each individual are deemed to
    be outstanding for purposes of computing the percentage of Common Stock
    owned by that individual. Therefore, each percentage is computed based on
    the sum of (i) the 40,214,097 shares of Common Stock actually outstanding as
    of April 30, 1994, (ii) the number of shares of Common Stock into which
    shares of Series B Preferred Stock, Series C Preferred Stock and Series D
    Preferred Stock are presently convertible or convertible within 60 days
    after April 30, 1994, and (iii) warrants to purchase Common Stock, as the
    case may be, owned by that individual or entity whose percentage of share
    ownership is being computed, but not taking account of the conversion of
    shares of Series B Preferred Stock, Series C Preferred Stock or Series D
    Preferred Stock or the exercise of warrants or options by any other person
    or entity. Without taking into consideration ownership of shares of Series B
    Preferred Stock, Series C Preferred Stock and Series D Preferred Stock, and
    warrants to purchase Common Stock, Advance Publications, Inc., BellSouth
    Corporation, Comcast and its affiliates, Cox Enterprises, Inc., Liberty
    Media and its affiliates, and Time Warner, Inc. and its affiliates own .3%,
    0%, 15.4%, 0%, 16.2% and 9.6%, respectively, of the shares of Common Stock
    actually outstanding as of April 30, 1994.

(3) Includes an option to purchase 2,833,333 shares of Common Stock which is
    exercisable within 60 days after April 30, 1994.

(4) Consists solely of an option to purchase 8,627,934 shares of Common Stock
    which is exercisable within 60 days after April 30, 1994.

(5) In Schedule 13D filings with the Commission, Comcast has reported that it
    has shared voting and dispositive power with Barry Diller with regard to all
    shares beneficially owned by the group. See footnote 1 above and "Certain
    Transactions and Business Relationships" below. Includes 72,050 shares of
    Series C Preferred Stock presently convertible into 720,500 shares of Common
    Stock and warrants to purchase 1,700,000 shares of Common Stock.

(6) Consists solely of an option to purchase 2,833,333 shares of Common Stock
    which is exercisable within 60 days after April 30, 1994.

(7) In a Schedule 13D filing with the Commission on May 19, 1994, Liberty Media
    reported that it no longer has shared voting and dispositive power with
    Comcast and Barry Diller with regard to all shares beneficially owned by the
    three of them. See "Certain Transactions and Business Relationships" below.
    Includes 372,866 shares of Series B and Series C Preferred Stock presently
    convertible into 3,728,660 shares of Common Stock. Includes 1,627,934 shares
    of Common Stock that Mr. Diller will be entitled to purchase from Liberty
    Media pursuant to the terms of the Stockholders Agreement and the
    Liberty-QVC Agreement. Does not include any shares of Common Stock
    beneficially owned by Comcast or Mr. Diller.

(8) Includes 21,250 shares of Series C Preferred Stock presently convertible
    into 212,500 shares of Common Stock.

                                       13
<PAGE>   16

SERIES B PREFERRED STOCK

<TABLE>
<CAPTION>
      NAME AND ADDRESS          AMOUNT AND NATURE OF       PERCENT
      BENEFICIAL OWNER          BENEFICIAL OWNERSHIP      OF CLASS
- - - ----------------------------    ---------------------     ---------
<S>                             <C>                       <C>
Liberty Media Corporation               17,922               64.5%
and its affiliates
8101 E. Prentice Avenue
Englewood, Colorado 80111
Viacom Cablevision Inc.                  9,398               33.9%
5924 Stoneridge Drive
Pleasonton, CA 94566
</TABLE>

SERIES C PREFERRED STOCK

<TABLE>
<CAPTION>
      NAME AND ADDRESS          AMOUNT AND NATURE OF       PERCENT
      BENEFICIAL OWNER          BENEFICIAL OWNERSHIP      OF CLASS
- - - ----------------------------    ---------------------     ---------
<S>                             <C>                       <C>
Comcast Corporation                     72,050(1)            13.6%
and Barry Diller
c/o Davis, Polk & Wardell
450 Lexington Avenue
New York, New York 10017
Comcast Corporation                     72,050(2)            13.6%
and its affiliates
1234 Market Street
Philadelphia, PA 19107
Liberty Media Corporation              372,866               70.3%
and its affiliates
8101 E. Prentice Avenue
Englewood, Colorado 80111
Viacom Cablevision, Inc.                49,300                9.3%
5924 Stoneridge Drive
Pleasonton, CA 94566
</TABLE>

- - - ------------------------------
(1) In Schedule 13D filings with the Commission, Comcast and Barry Diller have
    reported that they have agreed to act as a group for the purpose of voting
    their securities of the Corporation. See "Certain Transactions and Business
    Relationships" below. Includes 72,050 shares of Series C Preferred Stock
    beneficially owned by Comcast.

(2) In Schedule 13D filings with the Commission, Comcast has reported that it
    has shared voting and dispositive power with Barry Diller with regard to all
    shares beneficially owned by the group. See "Certain Transactions and
    Business Relationships" below.

SERIES D PREFERRED STOCK

<TABLE>
<CAPTION>
       NAME AND ADDRESS            AMOUNT AND NATURE OF       PERCENT
       BENEFICIAL OWNER            BENEFICIAL OWNERSHIP      OF CLASS
- - - -------------------------------    ---------------------     ---------
<S>                                <C>                       <C>
Harron Communications Corp.                   810               86.4%
70 East Lancaster Avenue
Frazer, PA 19355-2121
Raystay Co.                                   128               13.6%
P.O. Box 38
1312 Holly Pike
Carlisle, PA 17013
</TABLE>

                                       14
<PAGE>   17

SECURITY OWNERSHIP OF MANAGEMENT

     The following tables set forth information as of April 30, 1994, with
respect to the ownership of the Corporation's Common Stock, Series B Preferred
Stock, Series C Preferred Stock and Series D Preferred Stock by each director,
nominee for director and by all directors and officers as a group. Unless
otherwise indicated, each person has sole voting power and sole investment
power.

<TABLE>
<CAPTION>
    NAME OF DIRECTOR OR           AMOUNT AND NATURE OF        PERCENT
    NOMINEE FOR DIRECTOR        BENEFICIAL OWNERSHIP(1)      OF CLASS
- - - ----------------------------    ------------------------     ---------
<S>                             <C>                          <C>
William F. Costello                       167,500(2)(3)            *
Barry Diller                            4,000,000(4)             9.3%(2)
J. Bruce Llewellyn                              0                  *
Bruce M. Ramer                                  0                  *
Brian L. Roberts                              750(5)               *
Ralph J. Roberts                            5,000(5)               *
Joseph M. Segel                           120,000(2)(6)            *
Linda J. Wachner                                0                  *
All directors and executive
  officers as a group
  (16 persons)(7)(8)                    4,698,358(2)            10.8%(2)
</TABLE>`
	rows := ScreenRows(run(t, body))
	for _, name := range []string{"J. Bruce Llewellyn", "Bruce M. Ramer", "Linda J. Wachner"} {
		r := find(rows, name, "")
		if r == nil || r.Shares == nil || *r.Shares != 0 || r.TableKind != "management" {
			t.Errorf("legacy management holding changed: %s %+v", name, r)
		}
	}
}

// 0000950159-03-000333: unparenthesized footnotes are not a second share column.
func TestASCIIHeaderFallbackKeepsSharesBeforeBareFootnote(t *testing.T) {
	body := `
                             PRINCIPAL SHAREHOLDERS

     The  following  table  shows  the  name,  address,  amount  and  nature  of
beneficial  ownership and percent of class of outstanding  Commerce common stock
(which  for  purposes  of this  table,  includes  shares  subject  to  currently
exercisable  stock  options) of each person who we know  beneficially  owns more
than 5% of  Commerce's  common  stock (as of April  11,  2003,  the most  recent
practicable date).
<TABLE>
<CAPTION>
          Name and Address                   Amount and Nature of            Percent of Outstanding
         Of Beneficial Owner                 Beneficial Ownership                 Common Stock


<S>                                              <C>                                 <C>
      Gary L. Nalbandian                         235,992 1                            10.45%
      Pennsylvania Commerce
      Bancorp, Inc.; NAI/CIR,
      Camp Hill, PA

      Commerce Bancorp, Inc.                     174,667 2                             8.19%
      Cherry Hill, NJ

      James T. Gibson                            108,584 3                             5.09%
      Chairman/President
      Integrity Bank, Camp Hill, PA
</TABLE>`
	rows := ScreenRows(run(t, body))
	for _, want := range []struct {
		name        string
		shares, pct float64
	}{
		{"Gary L. Nalbandian", 235992, 10.45}, {"Commerce Bancorp, Inc", 174667, 8.19}, {"James T. Gibson", 108584, 5.09},
	} {
		r := find(rows, want.name, "Common Stock")
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.Percent == nil || *r.Percent != want.pct {
			t.Errorf("bare footnote overwrote holding: %+v got %+v", want, r)
		}
	}
	if len(rows) != 3 {
		t.Errorf("want3holders got%+v", rows)
	}
}

// 0000839443-96-000007: consumed holdings must end discovery, not seed a biography table.
func TestASCIIHeaderFallbackDoesNotCarryOwnershipCaptionToDirectorAges(t *testing.T) {
	body := `         NAME AND ADDRESS          AMOUNT AND NATURE OF          PERCENT
       OF BENEFICIAL OWNER         BENEFICIAL OWNERSHIP        OF CLASS (1)

H. F. (Gerry) Lenfest                61,359,424 (2)              86.9% (2)
c/o The Lenfest Group
200 Cresson Boulevard
P.O. Box 989
Oaks, PA 19456-0989
Chairman of the Board and Director
_______________________________________________

     (1)  As of the Record Date, 23,794,500 shares of Common Stock
          were outstanding.

     (2)  Includes 16,886,811 shares of Common Stock issuable upon
          conversion of Preferred Stock owned by Mr. Lenfest.
          Includes Warrants to acquire up to 29,915,160 additional
          shares of Common Stock.  Does not include principal or
          accrued but unpaid interest on the subordinated $500,000
          Note which may be converted into shares of Preferred Stock.
          Also does not include accrued interest, as of March 31,
          1996, on loans made to the Company or accrued dividends on
          the shares of Preferred Stock owned by Mr. Lenfest, either
          of which the Company may elect to pay in shares of Preferred
          Stock.

Security Ownership of Management
- --------------------------------

     The following table sets forth, as of the Record Date, certain
information with respect to the Common Stock beneficially owned by the
directors and executive officers of the Company and by all directors and
executive officers as a group.  The address of all directors and executive
officers is c/o TelVue Corporation, 16000 Horizon Way, Suite 500, Mt. Laurel,
NJ  08054.

         NAME AND ADDRESS          AMOUNT AND NATURE OF          PERCENT
       OF BENEFICIAL OWNER         BENEFICIAL OWNERSHIP        OF CLASS (1)

H.F. (Gerry) Lenfest                   61,359,424 (2)            86.9% (2)
c/o The Lenfest Group
200 Cresson Boulevard
P.O. Box 989
Oaks, PA 19456-0989
Chairman of the Board and Director

Joseph M. Murphy                           90,000 (3)              .4%
Executive Vice President Sales
and Operations

All Directors and Officers
as a Group                             61,476,224 (2)(3)(4)      87.1%

______________________________________________

     (1)  As of the Record Date, 23,794,500 shares of Preferred Stock were
          outstanding.

     (2)  Includes 16,886,811 shares of Common Stock issuable upon conversion
          of Preferred Stock owned by Mr. Lenfest.  Includes Warrants to
          acquire up to 29,915,160 additional shares of Common Stock.  Does
          not include principal or accrued but unpaid interest on the
          subordinated $500,000 Note which may be converted into shares of
          Preferred Stock.  Also does not include accrued interest, as of
          March 31, 1996, on loans made to the Company or accrued dividends
          on the shares of Preferred Stock owned by Mr. Lenfest, either of
          which the Company may elect to pay in shares of Preferred Stock.

    (3)   Includes 15,000 shares issuable to Joseph M. Murphy upon exercise
          of currently exercisable stock options held by Mr. Murphy.

    (4)   Includes 3,000 shares issuable to Randy Gilson upon exercise of
          currently exercisable incentive stock options held by such person.
          Though designated an officer, he does not have a policy
          making role with the Company.

                                  PROPOSAL 1
                             ELECTION OF DIRECTORS

     Six (6) directors will be elected to hold office subject to the
provisions of the Company's by-laws until the next Annual Meeting of
Stockholders, and until their respective successors are duly elected and
qualified.  The vote of a majority of the votes entitled to be cast by
stockholders present in person or by proxy, is required to elect members of
the Board of Directors.  The following table sets forth the name, age,
position with the Company and respective director service dates of each
person who has been nominated to be a director of the Company:

                                         POSITION(S)              DIRECTOR
     NAME                   AGE       WITH THE COMPANY             SINCE

H. F. (Gerry) Lenfest        66       Chairman and Director         1989

Frank J. Carcione            55       President, Chief Executive
                                      Officer, and Director         1990

Carl J. Cangelosi            53       Director                      1990

Robert Lawrence              38       Director                      1990

Donald L. Heller             50       Director                      1993

Thomas J. Fennell            35       Director                      1995


Principal Occupation of the Director Nominees
- ---------------------------------------------

`
	rows := ScreenRows(run(t, body))
	for _, r := range rows {
		if r.Percent == nil && r.PctMarker == "" && r.Shares != nil && (*r.Shares == 66 || *r.Shares == 53 || *r.Shares == 38 || *r.Shares == 50 || *r.Shares == 35) {
			t.Errorf("director age emitted as shares: %+v", r)
		}
	}
}

// The biography columns are not holdings; vested 60-day options are an add-on.
// Ownership section transcribed from 0001021408-02-005795, including both pages.
func TestASCIIBiographicalOwnershipAddsVestedOptions(t *testing.T) {
	body := `SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT
     executive officers, and (iii) the directors and executive officers of the
     Company as a group:

<TABLE>
<CAPTION>
                                                                                                     Common Stock
                                                                                                 Beneficially Owned on
                                                                                                   March 26, 2002/1/
                                                                                  --------------------------------------------------
                                                                  Director                                              Percentage
  Names and Offices          Principal Occupation                Since/Term          Number         Vested Option       of Shares
  Held with Company           for Past Five Years      Age       to Expire        of Shares/1/        Shares/2/       Outstanding/3/
- ------------------------     -----------------------   ---       ----------       ------------      -------------     --------------
<S>                          <C>                       <C>       <C>              <C>               <C>               <C>
Morris A. Tharp/4/           President and Owner,       62        2000/               414,480          100,000            5.51%
Chairman of the Board        E.M. Tharp, Inc. (Truck              2004
                             Sales and Repair)                   (1977)/5/

Albert L. Berra              Orthodontist/Rancher       61        2000/               267,884          100,000            3.94%
Director                                                          2003
                                                                 (1977)/5/

Gregory A. Childress/4/      Rancher                    45        2000/             1,595,548/6/       100,000           18.17%
Director                                                          2004
                                                                 (1994)/5/

Robert L. Fields/4/          Investor                   74        2000/               620,357          100,000            7.72%
Director                     (formerly Owner,                     2004
                             Bob Fields Jewelers)                (1982)/5/

James C. Holly/4/            President and Chief        61        2000/               448,776          100,000            5.88%
President, Chief             Executive Officer,                   2004
Executive Officer            Bank of the Sierra                  (1977)/5/
and Director

Vincent L. Jurkovich         President, Porterville     74        2000/               136,950          100,000            2.54%
Director                     Concrete Pipe, Inc.                  2003
                                                                 (1977)/5/
</TABLE>


____________________________

     /1/ Except as otherwise noted, may include shares held by such person's
     spouse (except where legally separated) and minor children, and by any
     other relative of such person who has the same home; shares held in "street
     name" for the benefit of such person; shares held by a family or retirement
     trust as to which such person is a trustee and primary beneficiary with
     sole voting and investment power (or shared power with a spouse); or shares
     held in an Individual Retirement Account or pension plan as to which such
     person (and/or his spouse) is the sole beneficiary and has pass-through
     voting rights and investment power.

     /2/ Consists of shares which the applicable individual or group has the
     right to acquire upon the exercise of stock options which are vested or
     will vest within 60 days of March 26, 2002 pursuant to the Company's Stock
     Option Plan. (See "Compensation of Directors" and "Stock Options.")

     /3/ The percentages are based on the total number of shares of the
     Company's Common Stock outstanding, plus the number of option shares which
     the applicable individual or group has the right to acquire upon the
     exercise of stock options which are vested or will vest within 60 days of
     March 26, 2002 pursuant to the Company's Stock Option Plan. (See
     "Compensation of Directors" and "Stock Options.")

     /4/ Mr. Tharp's address is 15243 Road 192, Porterville, California 93257;
     Mr. Childress' address is 12012 Road 200, Porterville, California 93257;
     Mr. Fields' address is 200 North Main Street, Porterville, California
     93257; Mr. Holly's address is 86 North Main Street, Porterville, California
     93257; and Mr. Smith's address is 421 East Martin Avenue, Porterville,
     California 93257.

     /5/ Year first elected or appointed a director of the Bank.

     /6/ Includes 5,280 shares owned by Childress, Bates, Childress, Inc.
     ("CBC"), a corporation of which Mr. Childress is President and a 331/3%
     shareholder; 41,000 shares owned by the CBC Defined Benefit Pension Plan,
     of which Mr. Childress is a trustee and a beneficiary; and 684,992 shares
     owned by CPG Ranch, a partnership of which Mr. Chrildress is a partner; as
     to all of which shares Mr. Childress has shared voting and investment
     power.

     (Table and footnotes continued on following page.)

                                        3

<PAGE>

<TABLE>
<CAPTION>
                                                                                                 Common Stock
                                                                                              Beneficially Owned on
                                                                                                March 26, 2002/1/
                                                                               ---------------------------------------------
                                                                 Director                                        Percentage
 Names and Offices           Principal Operation               Since/Term         Number       Vested Option     of Shares
Held with Company             for Past Five Years      Age      to expire      of Shares/1/       Shares/2/     Outstanding/3/
- -----------------            --------------------      ---      ----------     ------------     ------------    -----------
<S>                          <C>                       <C>      <C>            <C>              <C>             <C>
Howard H. Smith/4/           Retired/Investor          90       2000/           400,000           100,000          5.36%
Director                     (formerly Owner and                2004
                             Chief Executive                   (1977)/5/
                             Officer, Smith's
                             Complete Market)

Robert H. Tienken            Retired (formerly         82       2000/           187,628           100,000          3.08%
Corporate Secretary          Realtor/Farmer)                    2003
and Director                                                   (1977)/5/

Gordon T. Woods              Owner, Gordon T. Woods    65       2000/            1,386/7/         100,000          1.09%
Director                     Construction                       2003
                                                               (1977)/5/

Kenneth E. Goodwin           Executive Vice            59        n/a            152,004            60,000          2.28%
Executive Vice President     President and Chief
and Chief Operating Officer  Operating Officer,
                             Bank of the Sierra

Kenneth R. Taylor            Senior Vice President     42        n/a                  0                 0          0.00%
Senior Vice President and    and Chief Financial
Chief Financial Officer      Officer,
                             Bank of the Sierra/8/

Charlie C. Glenn             Senior Vice President     63        n/a              1,922            15,000          0.18%
Senior Vice President and    and Chief Credit
Chief Credit Officer         Officer,
                             Bank of the Sierra/8/

Directors and Executive                                                       4,226,935           975,000         50.97%
Officers as a Group (12
persons)
</TABLE>



`
	for _, tc := range []struct{ name, body string }{
		{"grant_not_holding", strings.ReplaceAll(body, "Vested Option", "Option Grants")},
		{"no_vested_60_day_disclosure", strings.ReplaceAll(body, "60 days", "five years")},
		{"no_ownership_caption", strings.ReplaceAll(body, "Beneficially Owned on", "Options Granted on")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if rows := ScreenRows(run(t, tc.body)); len(rows) != 0 {
				t.Fatalf("non-ownership variant emitted rows: %+v", rows)
			}
		})
	}
	rows := ScreenRows(run(t, body))
	if len(rows) != 13 {
		t.Fatalf("want 12 holders and one group, got %d: %+v", len(rows), rows)
	}
	for _, want := range []struct {
		name        string
		shares, pct float64
	}{
		{"Morris A. Tharp", 514480, 5.51},
		{"Albert L. Berra", 367884, 3.94},
		{"Gregory A. Childress", 1695548, 18.17},
		{"Robert L. Fields", 720357, 7.72},
		{"James C. Holly", 548776, 5.88},
		{"Vincent L. Jurkovich", 236950, 2.54},
		{"Howard H. Smith", 500000, 5.36},
		{"Robert H. Tienken", 287628, 3.08},
		{"Gordon T. Woods", 101386, 1.09},
		{"Kenneth E. Goodwin", 212004, 2.28},
		{"Kenneth R. Taylor", 0, 0},
		{"Charlie C. Glenn", 16922, 0.18},
		{"Directors and Executive Officers as a Group (12 persons)", 5201935, 50.97},
	} {
		r := find(rows, want.name, "Common Stock")
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.Percent == nil || *r.Percent != want.pct {
			t.Errorf("%q: want common-stock shares=%g pct=%g, got %+v; rows=%+v", want.name, want.shares, want.pct, r, rows)
		}
		if r != nil && strings.HasPrefix(want.name, "Directors and") && (!r.IsGroupRow || r.GroupN != 12) {
			t.Errorf("group metadata: %+v", r)
		}
	}
}

// Transcribed from 0001193125-07-066315: a shared colspan caption and an
// empty spacer must not hide conflicting values in earlier group members.
const htmlColspanSharesPct = `<html><body><p>STOCK OWNERSHIP OF DIRECTORS, EXECUTIVE OFFICERS AND PRINCIPAL HOLDERS</p>
<p>The following table sets forth the beneficial ownership of our common stock.</p>
<table>
<tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td></td><td></td><td colspan="3">Shares Beneficially<br>Owned (1)</td><td></td></tr>
<tr><td>Officers, Directors and 5% Shareholders</td><td></td><td>Number</td><td></td><td>Percent</td><td></td></tr>
<tr><td>FMR Corp. (2) 82 Devonshire Street Boston, MA 02109</td><td></td><td>8,049,546</td><td></td><td>13.9</td><td>%</td></tr>
<tr><td>Royce &amp; Associates, Inc. 1414 Avenue of the Americas New York, NY 10019</td><td></td><td>3,182,300</td><td></td><td>5.5</td><td>%</td></tr>
<tr><td>T. Rowe Price Associates, Inc. (3) . 100 E. Pratt Street Baltimore, MD 21202</td><td></td><td>2,887,600</td><td></td><td>5.0</td><td>%</td></tr>
<tr><td>William M. Goodyear (4)</td><td></td><td>919,666</td><td></td><td>1.6</td><td>%</td></tr>
<tr><td>Julie M. Howard (5)</td><td></td><td>155,511</td><td></td><td>*</td><td></td></tr>
<tr><td>Ben W. Perks (6)</td><td></td><td>137,672</td><td></td><td>*</td><td></td></tr>
<tr><td>Richard X. Fischer</td><td></td><td>14,650</td><td></td><td>*</td><td></td></tr>
<tr><td>Thomas A. Gildehaus (7)</td><td></td><td>61,096</td><td></td><td>*</td><td></td></tr>
<tr><td>Valerie B. Jarrett (8)</td><td></td><td>50,820</td><td></td><td>*</td><td></td></tr>
<tr><td>Peter B. Pond (9)</td><td></td><td>128,043</td><td></td><td>*</td><td></td></tr>
<tr><td>Samuel K. Skinner (10)</td><td></td><td>28,374</td><td></td><td>*</td><td></td></tr>
<tr><td>James R. Thompson (11)</td><td></td><td>156,079</td><td></td><td>*</td><td></td></tr>
<tr><td>All Directors and Executive Officers as a group (9 persons) (12)</td><td></td><td>1,651,911</td><td></td><td>2.9</td><td>%</td></tr>
</table><p>* Less than 1%</p></body></html>`

func TestHTMLColspanSpacerKeepsSharesAndPercent(t *testing.T) {
	body := htmlColspanSharesPct
	rows := ScreenRows(run(t, body))
	if len(rows) != 13 {
		t.Fatalf("want 13 real ownership rows, got %d: %+v", len(rows), rows)
	}
	for _, want := range []struct {
		name        string
		shares, pct float64
		marker      string
	}{
		{"FMR Corp. 82 Devonshire Street Boston, MA 02109", 8049546, 13.9, ""}, {"Royce & Associates, Inc. 1414 Avenue of the Americas New York, NY 10019", 3182300, 5.5, ""},
		{"T. Rowe Price Associates, Inc. . 100 E. Pratt Street Baltimore, MD 21202", 2887600, 5.0, ""}, {"William M. Goodyear", 919666, 1.6, ""},
		{"Julie M. Howard", 155511, 0, "*"}, {"Ben W. Perks", 137672, 0, "*"},
		{"Richard X. Fischer", 14650, 0, "*"}, {"Thomas A. Gildehaus", 61096, 0, "*"},
		{"Valerie B. Jarrett", 50820, 0, "*"}, {"Peter B. Pond", 128043, 0, "*"},
		{"Samuel K. Skinner", 28374, 0, "*"}, {"James R. Thompson", 156079, 0, "*"},
		{"All Directors and Executive Officers as a group (9 persons)", 1651911, 2.9, ""},
	} {
		r := find(rows, want.name, "")
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.PctMarker != want.marker {
			t.Errorf("holder %q: want shares=%g marker=%q, got %+v", want.name, want.shares, want.marker, r)
			continue
		}
		if want.marker == "" && (r.Percent == nil || *r.Percent != want.pct) {
			t.Errorf("holder %q: want percent=%g, got %+v", want.name, want.pct, r)
		}
		if want.marker != "" && r.Percent != nil {
			t.Errorf("star is not an exact percent: %+v", r)
		}
	}
}

// 0001193125-12-195958 discloses owned shares and exercisable 60-day options,
// not a total column. Recovering only the option component understates ownership.
func TestHTMLColspanOwnedPlus60DayOptions(t *testing.T) {
	body := `<html><body><p>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT</p><table>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td></td><td></td><td colspan="10">Beneficial Ownership(1)</td><td></td></tr>
<tr><td>Name and, in the Case of Greater Than 5% Stockholders, Address of Beneficial Owner</td><td></td><td colspan="2">Number of<br>Shares</td><td></td><td></td><td colspan="2">Shares Issuable<br>Under Options<br>Exercisable<br>Within 60 Days<br>of February 29, 2012</td><td></td><td></td><td colspan="2">Percent of Total<br>Outstanding<br>Shares Beneficially<br>Owned</td><td></td></tr>
<tr><td>Fidelity Management &amp; Research Company LLC(2)</td><td></td><td></td><td>7,230,479</td><td></td><td></td><td></td><td>—</td><td></td><td></td><td></td><td>11.1</td><td>%</td></tr>
<tr><td>82 Devonshire Street<br>Boston, MA 02109</td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td>Daniel G. Welch</td><td></td><td></td><td>151,600</td><td></td><td></td><td></td><td>893,208</td><td></td><td></td><td></td><td>1.6</td><td></td></tr>
<tr><td>Lars G. Ekman, M.D., Ph.D.</td><td></td><td></td><td>—</td><td></td><td></td><td></td><td>119,003</td><td></td><td></td><td></td><td>*</td><td></td></tr>
<tr><td>All executive officers and directors as a group</td><td></td><td></td><td>415,655</td><td></td><td></td><td></td><td>1,736,654</td><td></td><td></td><td></td><td>3.2</td><td></td></tr>
</table></body></html>`
	rows := ScreenRows(run(t, body))
	if len(rows) != 4 {
		t.Fatalf("want four literal holdings, got %+v", rows)
	}
	for _, want := range []struct {
		name   string
		shares float64
	}{
		{"Fidelity Management & Research Company LLC", 7230479},
		{"Daniel G. Welch", 1044808}, {"Lars G. Ekman", 119003},
		{"All executive officers and directors as a group", 2152309},
	} {
		r := find(rows, want.name, "")
		if r == nil || r.Shares == nil || *r.Shares != want.shares {
			t.Errorf("holder %q: want owned+60-day-options=%g, got %+v", want.name, want.shares, r)
		}
	}
}

// The already-emitting ownership table in 0001193125-12-191126 must not be
// reinterpreted by a zero-row recovery path.
func TestHTMLColspanRecoveryPreservesAlreadyEmittingTable(t *testing.T) {
	body := `<html><body><p>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT</p><table>
<tr><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
<tr><td></td><td></td><td colspan="6">Beneficial Ownership - as of March 15, 2012</td><td></td></tr>
<tr><td>5% Stockholders, Directors and Officers (1)</td><td></td><td colspan="2">Number of Shares (2)</td><td></td><td></td><td colspan="2">Percent of Total (2)</td><td></td></tr>
<tr><td>BlueLine Partners, L.L.C. (3)</td><td></td><td></td><td>2,477,173</td><td></td><td></td><td></td><td>27.7</td><td>%</td></tr>
<tr><td>Paragon Associates II Joint Venture (4)</td><td></td><td></td><td>750,000</td><td></td><td></td><td></td><td>8.4</td><td>%</td></tr>
<tr><td>Dominik Beck, Ph.D. (12)</td><td></td><td></td><td>0</td><td></td><td></td><td></td><td>*</td><td>%</td></tr>
</table></body></html>`
	rows := ScreenRows(run(t, body))
	if len(rows) != 1 {
		t.Fatalf("zero-row-only recovery changed an already emitting table: %+v", rows)
	}
	r := find(rows, "Dominik Beck", "")
	if r == nil || r.Shares != nil || r.Percent == nil || *r.Percent != 0 {
		t.Fatalf("preserve original literal zero-percent holding: %+v", rows)
	}
}

func TestHTMLColspanRecoveryPreservesOtherTablesInFiling(t *testing.T) {
	before := ScreenRows(run(t, simpleHTML))
	body := strings.Replace(simpleHTML, "</body></html>", strings.TrimPrefix(htmlColspanSharesPct, "<html><body>"), 1)
	after := ScreenRows(run(t, body))
	if len(after) != len(before) {
		t.Fatalf("zero-filing-only recovery changed an already emitting filing: before=%d after=%d", len(before), len(after))
	}
	for i := range before {
		if rowTSV(before[i]) != rowTSV(after[i]) {
			t.Errorf("old row changed: before=%s after=%s", rowTSV(before[i]), rowTSV(after[i]))
		}
	}
}

// The closing parenthesis of a shares footnote is a separate HTML cell in
// 0001144204-08-025904. Dropping it makes every holding look like a header.
func TestHTMLSplitFootnoteClosingCellKeepsOwnership(t *testing.T) {
	body := `<html><body><p>Security Ownership of Certain Beneficial Owners and Management</p><table>
<tr><td>Name and Address of Beneficial Owner</td><td></td><td colspan="2">Number of Shares (1) Beneficially Owned</td><td></td><td colspan="2">Percentage Beneficially Owned</td><td></td></tr>
<tr><td></td><td></td><td colspan="2"></td><td></td><td colspan="2"></td><td></td></tr>
<tr><td>Howard H. Hill<br>7610 Miramar Road, Ste. 6000<br>San Diego, CA 92126-4202</td><td></td><td></td><td>245,871(2</td><td>)</td><td></td><td>6.9</td><td>%</td></tr>
<tr><td>John R. Ehret<br>7610 Miramar Road, Ste. 6000<br>San Diego, CA 92126-4202</td><td></td><td></td><td>28,000(3</td><td>)</td><td></td><td>0.8</td><td>%</td></tr>
<tr><td>Robert Jacobs<br>7610 Miramar Road, Ste. 6000<br>San Diego, CA 92126-4202</td><td></td><td></td><td>8,000(4</td><td>)</td><td></td><td>0.2</td><td>%</td></tr>
<tr><td>Marvin H. Fink<br>7610 Miramar Road, Ste. 6000<br>San Diego, CA 92126-4202</td><td></td><td></td><td>37,165(5</td><td>)</td><td></td><td>1.1</td><td>%</td></tr>
<tr><td>Linde Kester<br>7610 Miramar Rd., Ste. 6000<br>San Diego, CA 92126-4202</td><td></td><td></td><td>91,472(6</td><td>)</td><td></td><td>2.7</td><td>%</td></tr>
<tr><td>William Reynolds<br>7610 Miramar Rd., Ste. 6000<br>San Diego, CA 92126-4202</td><td></td><td></td><td>20,300(7</td><td>)</td><td></td><td>0.6</td><td>%</td></tr>
<tr><td>All Directors and Officers as a Group (6 Persons)</td><td></td><td></td><td>430,808(8</td><td>)</td><td></td><td>11.8</td><td>%</td></tr>
<tr><td>Hytek International, Ltd<br>PO Box 10927 APO<br>George Town<br>Cayman Islands</td><td></td><td></td><td>450,930(9</td><td>)</td><td></td><td>13.7</td><td>%</td></tr>
<tr><td>Walrus Partners, LLC<br>8014 Olson Memorial, #232<br>Golden Valley, MN 55427</td><td></td><td></td><td>248,583 (10</td><td>)</td><td></td><td>7.5</td><td>%</td></tr>
<tr><td>Citigroup Inc.<br>399 Park Avenue<br>New York, NY 10043</td><td></td><td></td><td>216,175(11</td><td>)</td><td></td><td>6.6</td><td>%</td></tr>
</table></body></html>`
	rows := ScreenRows(run(t, body))
	if len(rows) != 10 {
		t.Fatalf("want 10 literal beneficial holdings, got %d: %+v", len(rows), rows)
	}
	for _, want := range []struct {
		name        string
		shares, pct float64
	}{
		{"Howard H. Hill", 245871, 6.9}, {"John R. Ehret", 28000, 0.8}, {"Robert Jacobs", 8000, 0.2},
		{"Marvin H. Fink", 37165, 1.1}, {"Linde Kester", 91472, 2.7}, {"William Reynolds", 20300, 0.6},
		{"All Directors and Officers as a Group", 430808, 11.8}, {"Hytek International, Ltd", 450930, 13.7},
		{"Walrus Partners, LLC", 248583, 7.5}, {"Citigroup Inc", 216175, 6.6},
	} {
		found := 0
		for _, r := range rows {
			if strings.HasPrefix(r.HolderName, want.name) {
				found++
				if r.Shares == nil || *r.Shares != want.shares || r.Percent == nil || *r.Percent != want.pct {
					t.Errorf("%s: want %g/%g got %+v", want.name, want.shares, want.pct, r)
				}
				if strings.HasPrefix(want.name, "All Directors") && (!r.IsGroupRow || r.GroupN != 6) {
					t.Errorf("want six-person group: %+v", r)
				}
			}
		}
		if found != 1 {
			t.Errorf("want exactly one %s holding, got %d: %+v", want.name, found, rows)
		}
	}
}

// 0000950123-05-003612 states share counts in millions, including .97 million.
func TestHTMLMillionShareCounts(t *testing.T) {
	body := `<html><body><p>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT</p><TABLE width="100%" align="center" cellspacing="0" cellpadding="0" border="0" style="font-size: 10pt; margin-top: 6pt; ">

<TR style="font-size: 1pt;">
    <TD width="3%">&nbsp;</TD>
    <TD width="21%">&nbsp;</TD>
    <TD width="3%">&nbsp;</TD>
    <TD width="6%">&nbsp;</TD>
    <TD width="1%">&nbsp;</TD>
    <TD width="5%">&nbsp;</TD>
    <TD width="3%">&nbsp;</TD>
    <TD width="6%">&nbsp;</TD>
    <TD width="1%">&nbsp;</TD>
    <TD width="6%">&nbsp;</TD>
    <TD width="3%">&nbsp;</TD>
    <TD width="6%">&nbsp;</TD>
    <TD width="1%">&nbsp;</TD>
    <TD width="5%">&nbsp;</TD>
    <TD width="3%">&nbsp;</TD>
    <TD width="6%">&nbsp;</TD>
    <TD width="1%">&nbsp;</TD>
    <TD width="6%">&nbsp;</TD>
    <TD width="3%">&nbsp;</TD>
    <TD width="5%">&nbsp;</TD>
    <TD width="1%">&nbsp;</TD>
    <TD width="5%">&nbsp;</TD>
</TR>

<TR style="font-size: 7pt;">
    <TD colspan="2">&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Shares of Class&nbsp;A</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Percent of Class&nbsp;A</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Shares of Class&nbsp;B</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Percent of Class&nbsp;B</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Percent of Total</B></TD><TD></TD>
</TR>

<TR style="font-size: 7pt;">
    <TD colspan="2">&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Redeemable</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Redeemable</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Convertible</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Convertible</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Outstanding</B></TD><TD></TD>
</TR>

<TR style="font-size: 7pt;">
    <TD colspan="2">&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Common Stock</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Common Stock</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Common Stock</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Common Stock</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Common Stock</B></TD><TD></TD>
</TR>

<TR style="font-size: 7pt;">
    <TD colspan="2" align="center" nowrap><B>Name and Address of</B></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Beneficially</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Beneficially</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Beneficially</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Beneficially</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Beneficially</B></TD><TD></TD>
</TR>

<TR style="font-size: 7pt;">
    <TD colspan="2" align="center" nowrap><B>Beneficial Owner</B></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Owned</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Owned</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Owned</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Owned</B></TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap><B>Owned</B></TD><TD></TD>
</TR>

<TR valign="bottom" style="font-size: 1px">
    <TD colspan="2" align="center" nowrap style="border-top: 1pt solid #000000;">&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap style="border-top: 1pt solid #000000;">&nbsp;</TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap style="border-top: 1pt solid #000000;">&nbsp;</TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap style="border-top: 1pt solid #000000;">&nbsp;</TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap style="border-top: 1pt solid #000000;">&nbsp;</TD><TD></TD>
    <TD>&nbsp;</TD>
    <TD colspan="2" align="center" nowrap style="border-top: 1pt solid #000000;">&nbsp;</TD><TD></TD>
</TR>

<TR>
    <TD colspan="2" align="left" valign="top">
    <DIV style="margin-left: 10px; text-indent: -10px">
    JPMorgan Chase&nbsp;&#38;
    Co.<SUP style="font-size: 85%; vertical-align: text-top">(1)(2)</SUP></DIV>
    </TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>9.85&nbsp;million</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>11.7</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>1.88&nbsp;million</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>11.7</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>11.7</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
</TR>

<TR>
    <TD>&nbsp;</TD>
    <TD align="left" valign="top">
    270 Park Avenue<BR>
    New York, NY 10017</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
</TR>

<TR>
    <TD colspan="2" align="left" valign="top">
    <DIV style="margin-left: 10px; text-indent: -10px">
    Citigroup,
    Inc.<SUP style="font-size: 85%; vertical-align: text-top">(3)</SUP></DIV>
    </TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>5.23&nbsp;million</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>6.2</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>1.00&nbsp;million</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>6.2</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>6.2</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
</TR>

<TR>
    <TD>&nbsp;</TD>
    <TD align="left" valign="top">
    399 Park Avenue<BR>
    New York, NY 10043</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
</TR>

<TR>
    <TD colspan="2" align="left" valign="top">
    <DIV style="margin-left: 10px; text-indent: -10px">
    Bank of America Corporation
    <SUP style="font-size: 85%; vertical-align: text-top">(4)</SUP></DIV>
    </TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>5.08&nbsp;million</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>6.0</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>.97&nbsp;million</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>6.0</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>6.0</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
</TR>

<TR>
    <TD>&nbsp;</TD>
    <TD align="left" valign="top">
    100 North Tryon Street<BR>
    Charlotte, NC 28255</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
</TR>

<TR>
    <TD colspan="2" align="left" valign="top">
    <DIV style="margin-left: 10px; text-indent: -10px">
    EURO Kartensysteme
    GmbH<SUP style="font-size: 85%; vertical-align: text-top">(5)</SUP></DIV>
    </TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>4.39&nbsp;million</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>5.2</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>.84&nbsp;million</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>5.2</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>5.2</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
</TR>

<TR>
    <TD>&nbsp;</TD>
    <TD align="left" valign="top">
    Solmsstrasse 6<BR>
    60486 Frankfurt/ Main<BR>
    Germany</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
</TR>

<TR>
    <TD colspan="2" align="left" valign="top">
    <DIV style="margin-left: 10px; text-indent: -10px">
    Europay France
    S.A.S.<SUP style="font-size: 85%; vertical-align: text-top">(6)</SUP></DIV>
    </TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>4.22&nbsp;million</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>5.0</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>.80&nbsp;million</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>5.0</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>5.0</TD>
    <TD align="left" valign="bottom" nowrap>%</TD>
</TR>

<TR>
    <TD>&nbsp;</TD>
    <TD align="left" valign="top">
    44, rue Cambronne 75740 Paris Cedex 15<BR>
    France</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD>&nbsp;</TD>
    <TD align="left" valign="bottom">&nbsp;</TD>
    <TD align="right" valign="bottom" nowrap>&nbsp;</TD>
    <TD>&nbsp;</TD>
</TR>

</TABLE></body></html>`
	rows := ScreenRows(run(t, body))
	for _, want := range []struct {
		name, class string
		shares, pct float64
	}{
		{"JPMorgan Chase", "Shares of Class A", 9850000, 11.7},
		{"JPMorgan Chase", "Shares of Class B", 1880000, 11.7},
		{"Citigroup", "Shares of Class A", 5230000, 6.2},
		{"Citigroup", "Shares of Class B", 1000000, 6.2},
		{"Bank of America", "Shares of Class A", 5080000, 6.0},
		{"Bank of America", "Shares of Class B", 970000, 6.0},
		{"EURO Kartensysteme", "Shares of Class A", 4390000, 5.2},
		{"EURO Kartensysteme", "Shares of Class B", 840000, 5.2},
		{"Europay France", "Shares of Class A", 4220000, 5.0},
		{"Europay France", "Shares of Class B", 800000, 5.0},
	} {
		found := 0
		for _, r := range rows {
			if strings.HasPrefix(r.HolderName, want.name) && r.ShareClass == want.class {
				found++
				if r.Shares == nil || *r.Shares != want.shares || r.Percent == nil || *r.Percent != want.pct {
					t.Errorf("want %+v got %+v", want, r)
				}
			}
		}
		if found != 1 {
			t.Errorf("want exactly one %+v, found %d among %+v", want, found, rows)
		}
	}

	if len(rows) != 15 {
		t.Fatalf("want 10 class holdings plus 5 total-percent disclosures, got %+v", rows)
	}
	for _, r := range rows {
		if r.ShareClass == "Common Stock" && r.Shares != nil {
			t.Errorf("total-percent column carries no share count: %+v", r)
		}
	}
	first := strings.Index(body, "JPMorgan Chase")
	start := strings.LastIndex(body[:first], "<TR>")
	end := first + strings.Index(body[first:], "</TR>") + len("</TR>")
	duplicate := strings.Replace(body, "</TABLE>", body[start:end]+"</TABLE>", 1)
	if got := ScreenRows(run(t, duplicate)); len(got) != 15 {
		t.Errorf("identical source-row copy must not add or drop holdings: %+v", got)
	}
	alreadyEmitting := strings.Replace(simpleHTML, "</body></html>", body, 1)
	before, after := ScreenRows(run(t, simpleHTML)), ScreenRows(run(t, alreadyEmitting))
	if len(before) != len(after) {
		t.Fatalf("million recovery must not reinterpret an emitting filing: before=%d after=%d", len(before), len(after))
	}
	for i := range before {
		if rowTSV(before[i]) != rowTSV(after[i]) {
			t.Errorf("emitting filing changed: %s -> %s", rowTSV(before[i]), rowTSV(after[i]))
		}
	}
}

// 0001052918-04-000521 aligns table columns with overlapping styled paragraphs.
func TestHTMLOverlappingParagraphOwnership(t *testing.T) {
	body := `<html><body><TABLE style="margin-right:72pt" cellspacing=0><TR><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=271.2><P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma"><U>Name and Position</U></P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=157.2><P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma"><U>Dollar Value (1)</U></P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=210><P style="margin:0pt; font-family:Tahoma">Number of Stock Options, <U>Granted Under the Restated Plan</U></P>
</TD></TR>
<TR><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=271.2><P style="margin:0pt; font-family:Tahoma">Maisonneuve, Andr&#233;,</P>
<P style="margin:0pt; font-family:Tahoma">&nbsp;&nbsp;&nbsp;Director, Chairman, President and Chief &nbsp;&nbsp;&nbsp;&nbsp;Executive Officer(2)</P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=157.2><P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma">$623,100</P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=210><P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma">1,005,000</P>
</TD></TR>
<TR><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=271.2><P style="margin:0pt; font-family:Tahoma">Weishaar, Tom,</P>
<P style="margin:0pt; font-family:Tahoma">&nbsp;&nbsp;&nbsp;Vice-President-Business Development (3)</P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=157.2><P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma">$623,100</P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=210><P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma">1,005,000</P>
</TD></TR>
<TR><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=271.2><P style="margin:0pt; font-family:Tahoma">All current executive officers as a group</P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=157.2><P style="margin:0pt; font-family:Tahoma">$1,246,200</P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=210><P style="margin:0pt; font-family:Tahoma">2,010,000</P>
</TD></TR>
<TR><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=271.2><P style="margin:0pt; font-family:Tahoma">All current directors who are not executive &nbsp;&nbsp;&nbsp;officers as a group</P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=157.2><P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma">$0.00</P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=210><P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;0</P>
</TD></TR>
<TR><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=271.2><P style="margin:0pt; font-family:Tahoma">All employees as a group (including all &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;current officers who are not executive &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;officers, but excluding executive officers)</P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=157.2><P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma">$674,127.24</P>
</TD><TD style="padding-left:7.2pt; padding-top:0pt; padding-right:7.2pt; padding-bottom:0pt" valign=top width=210><P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma"><BR></P>
<P style="margin:0pt; font-family:Tahoma">1,087,302</P>
</TD></TR>
</TABLE><P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma" align=center><B>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT</B></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma; font-size:8pt"><BR></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:36pt; width:540pt; font-family:Tahoma">The following table sets forth information as of December 15, 2004, with respect to any person known by us to own beneficially more than 5% of our Common Stock, Common Stock beneficially owned by each of our officers named in &#147;Executive Compensation,&#148; and each of our directors, and the amount of Common Stock beneficially owned by our officers and directors as a group. </P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma; font-size:8pt"><BR></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:353.3pt; width:540pt; font-family:Tahoma" align=justify>Approximate Percent</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma">Name &amp; Address of</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; text-indent:247.85pt; width:540pt; font-family:Tahoma">&nbsp;&nbsp;Number of Shares </P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:356.8pt; width:540pt; font-family:Tahoma">&nbsp;&nbsp;of Common Stock</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma" align=justify><U>&nbsp;&nbsp;Beneficial Owner &nbsp;</U></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; text-indent:247.85pt; width:540pt; font-family:Tahoma" align=justify><U>Beneficially Owned</U></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:363.2pt; width:540pt; font-family:Tahoma" align=justify><U>Outstanding &nbsp;(1)</U></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma; font-size:4pt" align=justify><BR></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma">Bruce Benn* (2) (7)</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; text-indent:268pt; width:540pt; font-family:Tahoma">3,080,000</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:380.6pt; width:540pt; font-family:Tahoma">10.19%</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma; font-size:4pt" align=justify><BR></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma" align=justify>Waycross Corp. &nbsp;(3)</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; text-indent:268pt; width:540pt; font-family:Tahoma" align=justify>3,400,000</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:383.1pt; width:540pt; font-family:Tahoma" align=justify>11.3%</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma" align=justify>29 Rue des Deux Communes</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma" align=justify>1226 Thonex-Geneva</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma" align=justify>Switzerland</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma; font-size:4pt" align=justify><BR></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma" align=justify>Valdosta Corp. (2)</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; text-indent:268pt; width:540pt; font-family:Tahoma" align=justify>3,400,000</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:383.1pt; width:540pt; font-family:Tahoma" align=justify>11.3%</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma" align=justify>P.O. Box 30592</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma" align=justify>Cayside, 2nd Floor, Harbour Drive</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma" align=justify>Georgetown, Grand Cayman</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma" align=justify>Cayman Islands, BWI</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma; font-size:4pt" align=justify><BR></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma" align=justify>Echo Technologies S.A. (4)</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; text-indent:268pt; width:540pt; font-family:Tahoma" align=justify>2,183,788</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:384.35pt; width:540pt; font-family:Tahoma" align=justify>6.9% </P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma" align=justify>Rte. de St. Cergue</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma" align=justify>297-1260 Nyon-Switzerland</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma; font-size:4pt" align=justify><BR></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma" align=justify>Henrik Olsen*(4)</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; text-indent:268pt; width:540pt; font-family:Tahoma" align=justify>2,183,788</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:385.6pt; width:540pt; font-family:Tahoma" align=justify>6.9%</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma; font-size:4pt" align=justify><BR></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma" align=justify>Andr&#233; Maisonneuve* (5)</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; text-indent:268pt; width:540pt; font-family:Tahoma" align=justify>1,662,500</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:385.6pt; width:540pt; font-family:Tahoma" align=justify>5.4%</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma; font-size:4pt" align=justify><BR></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma" align=justify>Tom Weishaar* (6)</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; text-indent:268pt; width:540pt; font-family:Tahoma" align=justify>1,005,000</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:385.6pt; width:540pt; font-family:Tahoma" align=justify>3.2%</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma; font-size:4pt" align=justify><BR></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma" align=justify>Ron Benn* (7)</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; text-indent:271.75pt; width:540pt; font-family:Tahoma" align=justify>575,500</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:385.6pt; width:540pt; font-family:Tahoma" align=justify>1.9%</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma; font-size:4pt" align=justify><BR></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; width:540pt; font-family:Tahoma" align=justify>All Executive Officers and Directors </P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma" align=justify>As a Group </P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; text-indent:260.9pt; width:540pt; font-family:Tahoma" align=justify>9,594,090 (8)</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:383.1pt; width:540pt; font-family:Tahoma" align=justify>28.2%</P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:-12pt; width:540pt; font-family:Tahoma" align=justify><U>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</U></P>
<P style="margin-top:0pt; margin-right:72pt; margin-bottom:0pt; text-indent:144pt; width:540pt; font-family:Tahoma" align=justify><U><BR></U></P>
</body></html>`
	if !IsHTML(body) {
		t.Fatal("literal source context must enter the HTML production path")
	}
	rows := ScreenRows(run(t, body))
	if len(rows) != 9 {
		t.Fatalf("want nine literal paragraph-aligned holdings, got %+v", rows)
	}
	for _, want := range []struct {
		name        string
		shares, pct float64
	}{
		{"Bruce Benn", 3080000, 10.19}, {"Waycross Corp", 3400000, 11.3}, {"Valdosta Corp", 3400000, 11.3}, {"Echo Technologies", 2183788, 6.9}, {"Henrik Olsen", 2183788, 6.9}, {"André Maisonneuve", 1662500, 5.4}, {"Tom Weishaar", 1005000, 3.2}, {"Ron Benn", 575500, 1.9}, {"All Executive Officers and Directors As a Group", 9594090, 28.2},
	} {
		found := 0
		for _, r := range rows {
			if strings.HasPrefix(r.HolderName, want.name) {
				found++
				if r.Shares == nil || *r.Shares != want.shares || r.Percent == nil || *r.Percent != want.pct {
					t.Errorf("want %+v got %+v", want, r)
				}
			}
		}
		if found != 1 {
			t.Errorf("want one %+v got %d among %+v", want, found, rows)
		}
	}
}

// 0001049108-05-000227 puts each holding in a separate one-row table.
func TestHTMLFragmentedOneRowOwnershipTables(t *testing.T) {
	body := `<html><body><p>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS, DIRECTORS, DIRECTOR NOMINEES AND EXECUTIVE OFFICERS</p><table border="0" cellspacing=0 cellpadding=0 width="611" style='border-collapse:collapse'>
    <tr >
        <td width="240" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><u><b><font size=2>Name of Beneficial Owner</font></b></u></p> </td>
        <td width="240" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><u><b><font size=2>of Beneficial Ownership (1)</font></b></u></p> </td>
        <td width="131" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><u><b><font size=2>Percent of Class (2)</font></b></u></p> </td> </tr></table><table border="0" cellspacing=0 cellpadding=0 width="572" style='border-collapse:collapse'>
    <tr >
        <td width="276" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><font size=2>Molly Shi Boren</font></p> </td>
        <td width="204" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><font size=2>33,411 (3)</font></p> </td>
        <td width="92" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><font size=2>Less than 1%</font></p> </td> </tr></table><table border="0" cellspacing=0 cellpadding=0 width="572" style='border-collapse:collapse'>
    <tr >
        <td width="276" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><font size=2>Thomas P. Capo</font></p> </td>
        <td width="204" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><font size=2>33,208 (4)</font></p> </td>
        <td width="92" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><font size=2>Less than 1%</font></p> </td> </tr></table><table border="0" cellspacing=0 cellpadding=0 width="527" style='border-collapse:collapse'>
    <tr >
        <td  colspan="2" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><font size=2>All directors and executive</font></p> </td>
        <td width="220" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><font size=2>1,094,944</font></p> </td>
        <td width="47" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><font size=2>4.3%</font></p> </td> </tr>
    <tr >
        <td width="119" valign=top >
            <p style='margin-left:0pt;text-indent:0pt;text-align:justify;margin-top:0pt;margin-bottom:0pt'><font size=2>officers as a group</font></p> </td>
        <td   colspan="3">
            <p style='margin-left:0pt;text-indent:0pt;text-align:left;margin-top:0pt;margin-bottom:0pt'><font size=1>&nbsp;</font></td> </tr>
    <tr>
        <td width="119" ></td>

        <td width="141" ></td>

        <td width="220" ></td>

        <td width="47" ></td> </tr> </table></body></html>`
	rows := ScreenRows(run(t, body))
	if len(rows) != 3 {
		t.Fatalf("want two literal directors and group from one-row table fragments, got %+v", rows)
	}
	for _, want := range []struct {
		name   string
		shares float64
		marker string
	}{{"Molly Shi Boren", 33411, "<1%"}, {"Thomas P. Capo", 33208, "<1%"}, {"All directors and executive officers as a group", 1094944, ""}} {
		found := 0
		for _, r := range rows {
			if strings.EqualFold(r.HolderName, want.name) {
				found++
				if r.Shares == nil || *r.Shares != want.shares || r.PctMarker != want.marker {
					t.Errorf("want %+v got %+v", want, r)
				}
				if want.marker == "" && (r.Percent == nil || *r.Percent != 4.3 || !r.IsGroupRow) {
					t.Errorf("want group total4.3%% got %+v", r)
				}
			}
		}
		if found != 1 {
			t.Errorf("missing %+v", want)
		}
	}

	first := strings.Index(body, "Molly Shi Boren")
	start := strings.LastIndex(body[:first], "<table")
	end := first + strings.Index(body[first:], "</table>") + len("</table>")
	copied := strings.Replace(body, "</body>", body[start:end]+"</body>", 1)
	if got := ScreenRows(run(t, copied)); len(got) != 3 {
		t.Fatalf("exact fragment copy must not add holdings: %+v", got)
	}
}

// 0001036050-98-000626 uses /(n)/ footnotes in literal share-count cells.
func TestASCIISlashParenthesisShareFootnotes(t *testing.T) {
	body := `PRINCIPAL STOCKHOLDERS

     The following table sets forth certain information regarding the beneficial
  ownership of the Company's Common Stock as of February 13, 1998 by (a) each
  stockholder known to the Company to be the beneficial owner, as defined in
  Rule 13d-3 under the Exchange Act, of more than 5% of the Common Stock, based
  upon Company records or Securities and Exchange Commission filings, (b) each
  director and director nominee of the Company, (c) each of the Named Officers
  and (d) all executive officers and directors of the Company as a group.  Each
  of the stockholders named below has sole voting power and sole investment
  power with respect to the shares indicated as beneficially owned, unless
  otherwise indicated.
<TABLE>
<CAPTION>

                                                                         SHARES OWNED
                                                                  -------------------------
                    NAME OF BENEFICIAL OWNER                          NUMBER       PERCEN
                    ------------------------                      ---------------  --------
<S>                                                               <C>              <C>

               Warburg, Pincus Ventures, L.P.                      6,095,238/(1)/     26.2%
                  466 Lexington Avenue
                  New York, NY 10017-3147

               Robert S. Hillas, Director                          6,095,238/(2)/     26.2
                  466 Lexington Avenue
                  New York, NY 10017-3147

               Allen & Company Incorporated                        2,625,511/(3)/     11.1
                  711 Fifth Avenue
                  New York, NY 10022

               William C. Smith, Director and                      1,048,619/(4)/      4.5
                  Named Officer

               Douglas W. Jacobson, Named Officer                  1,047,619           4.5

               Robert F. Johnston, Director                          430,000/(5)/      1.8

               Robert C. Miller, Director                            262,610/(6)/      1.1

               Robert F. Hendrickson, Director                       189,000/(7)/        *

               Ronald Unterman, Named Officer                        151,420/(8)/        *

               David N. Enegess, Named Officer                       111,220/(9)/        *

               Harcharan S. Gill, Former Director                     90,000/(10)/       *
                  and Named Officer

               Peter E. Nangeroni, Named Officer                      37,960/(11)/       *

               William J. Guarini, Named Officer                      28,140/(12)/       *

               Peter J. Neff, Director                                 7,165/(13)/       *

               Nicholas J. Lowcock, Director Nominee                           --        *

               All executive officers and directors as a group     9,362,891/(14)/    39.6
                  (nine persons)
</TABLE>`
	rows := ScreenRows(run(t, body))
	if len(rows) != 15 {
		t.Fatalf("want15positive-share holdings, got %+v", rows)
	}
	for _, want := range []struct {
		name     string
		shares   float64
		footnote string
	}{{"Warburg, Pincus Ventures", 6095238, "1"}, {"Robert S. Hillas", 6095238, "2"}, {"Allen & Company", 2625511, "3"}, {"William C. Smith", 1048619, "4"}, {"Douglas W. Jacobson", 1047619, ""}, {"Robert F. Johnston", 430000, "5"}, {"Robert C. Miller", 262610, "6"}, {"Robert F. Hendrickson", 189000, "7"}, {"Ronald Unterman", 151420, "8"}, {"David N. Enegess", 111220, "9"}, {"Harcharan S. Gill", 90000, "10"}, {"Peter E. Nangeroni", 37960, "11"}, {"William J. Guarini", 28140, "12"}, {"Peter J. Neff", 7165, "13"}, {"All executive officers and directors as a group", 9362891, "14"}} {
		found := 0
		for _, r := range rows {
			if strings.HasPrefix(r.HolderName, want.name) {
				found++
				if r.Shares == nil || *r.Shares != want.shares || r.Footnotes != want.footnote {
					t.Errorf("want %+v got %+v", want, r)
				}
			}
		}
		if found != 1 {
			t.Errorf("wantone %+v got%d", want, found)
		}
	}
}

// Literal name-above-address cells from 0000950144-01-508559.
const asciiClassAddressFixture = `                          SECURITY OWNERSHIP OF CERTAIN
                        BENEFICIAL OWNERS AND MANAGEMENT

         Unless otherwise indicated, the following table sets forth certain
information available to the Company as of September 28, 2001, regarding (a) the
ownership of the Company's common stock by (i) each of the Company's directors
and nominees; (ii) each of the Company's named executive officers; and (iii) all
directors and executive officers of the Company as a group; and (b) the
ownership of the Company's common stock by all those known by the Company to be
beneficial owners of more than five percent (5%) of its outstanding common
stock.

<TABLE>
<CAPTION>
- -------------------------------------------------------------------------------------------------------------------------
   TITLE OF CLASS            NAME AND ADDRESS OF               AMOUNT AND NATURE OF           PERCENTAGE OF CLASS (8)
                              BENEFICIAL OWNER                 BENEFICIAL OWNERSHIP
- -------------------------------------------------------------------------------------------------------------------------
<S>                   <C>                                      <C>                           <C>
                      Phil Dubois
Common Shares         Suite 200,  1727 West Broadway             3,063,050 (1),(7)                   13.0% (8)
                      Vancouver, BC V6J 4W6
- -------------------------------------------------------------------------------------------------------------------------
                      Ken Bradley
Common Shares         Suite 200,  1727 West Broadway             3,103,050 (2),(7)                   13.1% (8)
                      Vancouver, BC V6J 4W6
- -------------------------------------------------------------------------------------------------------------------------
                      Brent Forgeron
Common Shares         23-1243 Thurlow Street                       875,000 (9)                        3.8% (8)
                      Vancouver, BC V6E 1X4
- -------------------------------------------------------------------------------------------------------------------------
                      Ken Spencer
Common Shares         Suite 200,  1727 West Broadway             1,975,480 (3),(7) (10)               8.2% (8)
                      Vancouver BC V6J 4W6
- -------------------------------------------------------------------------------------------------------------------------
                      Jim MacKay
Common Shares         Suite 200,  1727 West Broadway               250,000 (4)                        1.1% (8)
                      Vancouver BC V6J 4W6
- -------------------------------------------------------------------------------------------------------------------------
                      Bob Smart
Common Shares         Suite 200,  1727 West Broadway                75,000 (6)                        0.3% (8)
                      Vancouver BC V6J 4W6
- -------------------------------------------------------------------------------------------------------------------------
                      Ian Thomas
Common Shares         Suite 200,  1727 West Broadway                75,000 (6)                        0.3% (8)
                      Vancouver BC V6J 4W6
- -------------------------------------------------------------------------------------------------------------------------
ALL OFFICERS AND DIRECTORS AS A GROUP (7)                        9,416,580                           37.1% (8)
- -------------------------------------------------------------------------------------------------------------------------
</TABLE>`

func TestASCIIClassAddressNameAboveValues(t *testing.T) {
	rows, _, _ := ExtractText(asciiClassAddressFixture, Row{})
	rows = ScreenRows(rows)
	if len(rows) != 8 {
		t.Fatalf("want eight literal common-share holdings, got %+v", rows)
	}
	for _, want := range []struct {
		name        string
		shares, pct float64
	}{
		{"Phil Dubois", 3063050, 13}, {"Ken Bradley", 3103050, 13.1}, {"Brent Forgeron", 875000, 3.8}, {"Ken Spencer", 1975480, 8.2}, {"Jim MacKay", 250000, 1.1}, {"Bob Smart", 75000, 0.3}, {"Ian Thomas", 75000, 0.3}, {"ALL OFFICERS AND DIRECTORS AS A GROUP", 9416580, 37.1},
	} {
		found := 0
		for _, r := range rows {
			if strings.HasPrefix(r.HolderName, want.name) {
				found++
				if r.Shares == nil || *r.Shares != want.shares || r.Percent == nil || *r.Percent != want.pct {
					t.Errorf("want %+v, got %+v", want, r)
				}
				if want.name != "ALL OFFICERS AND DIRECTORS AS A GROUP" && r.ShareClass != "Common Shares" {
					t.Errorf("want Common Shares class, got %+v", r)
				}
			}
		}
		if found != 1 {
			t.Errorf("want exactly one %+v got %d", want, found)
		}
	}
}

func TestASCIIClassAddressNumericFootnotes(t *testing.T) {
	rows, _, _ := ExtractText(asciiClassAddressFixture, Row{})
	rows = ScreenRows(rows)
	for _, want := range []struct{ name, notes string }{
		{"Phil Dubois", "1,7,8"}, {"Ken Bradley", "2,7,8"}, {"Brent Forgeron", "8,9"},
		{"Ken Spencer", "10,3,7,8"}, {"Jim MacKay", "4,8"}, {"Bob Smart", "6,8"}, {"Ian Thomas", "6,8"},
	} {
		r := find(rows, want.name, "Common Shares")
		if r == nil || r.Footnotes != want.notes {
			t.Errorf("want %s notes %s got %+v", want.name, want.notes, r)
		}
	}
}

func TestASCIIClassAddressRetryPreservesExistingRows(t *testing.T) {
	body := `<TABLE><CAPTION>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS
Name of Beneficial Owner       Shares Owned       Percent of Class
<S>                            <C>                <C>
Alex Example                   100,000            12.0%
Blair Example                  200,000            24.0%
</TABLE>` + asciiClassAddressFixture
	rows, _, _ := ExtractText(body, Row{})
	rows = ScreenRows(rows)
	if len(rows) != 2 {
		t.Fatalf("retry must not change a nonzero legacy filing: %+v", rows)
	}
	if find(rows, "Alex Example", "") == nil || find(rows, "Blair Example", "") == nil {
		t.Fatalf("lost legacy holdings: %+v", rows)
	}
}

func TestASCIIClassAddressRequiresOwnershipCaption(t *testing.T) {
	for _, body := range []string{
		strings.ReplaceAll(asciiClassAddressFixture, "BENEFICIAL OWNERSHIP", "DOLLAR COMPENSATION"),
		strings.ReplaceAll(asciiClassAddressFixture, "TITLE OF CLASS", "YEAR OF AWARD"),
		strings.ReplaceAll(asciiClassAddressFixture, "NAME AND ADDRESS OF", "PRINCIPAL POSITION OF"),
	} {
		rows, _, _ := ExtractText(body, Row{})
		if rows = ScreenRows(rows); len(rows) != 0 {
			t.Errorf("nonownership caption must not enable class/address recovery: %+v", rows)
		}
	}
}

// Literal three-column nominee/biography ownership tables, 0001005477-00-002041.
const asciiNomineeShareFixture = `Nominees: *

      The following information, as of February 11, 2000, is provided with
respect to the nominees for election to the Board.

<TABLE>
<CAPTION>
                                                                                                Shares of
                                                                                              Common Stock
Name, Age & Year of                                                                           Beneficially
Election as Director**                          Business Experience                         Owned 2/11/99***
<S>                                     <C>                                                     <C>
Class I (to be elected for a three-year term expiring 2003):

William S. Aichele  49  (1990)          President and CEO of the Corporation and                105,776 (1)
                                            President and CEO of Union National Bank

Norman L. Keller  62  (1974)            Executive Vice President of the                          37,356 (2)
                                            Corporation and President and CEO of
                                                Pennview Savings Bank

Thomas K. Leidy  61  (1984)             Chairman & President, Leidy's, Inc.                     144,407 (3)
                                            (Pork Processing)

Merrill S. Moyer  65  (1984)            Chairman of the Corporation and                         155,426 (4)
                                            Chairman of Union National Bank

Alternate Directors (to be elected for a one-year term expiring 2001):

Richard W. Godshall  66  (1999)         Physician, Upper Bucks Orthopaedic Association            1,886

H. Ray Mininger  59  (1995)             President, H. Mininger & Son, Inc.                        6,298
                                            (General Contractor)

Margaret K. Zook  54  (1999)            Administrator, Souderton Mennonite Homes                    200
                                            (Retirement Community)
</TABLE>


                                       2
<PAGE>

The following directors are not subject to election now as they were elected in
prior years for terms expiring in future years.

<TABLE>
<S>                                     <C>                                                     <C>
Class II (continuing for a term expiring 2001):

James L. Bergey  64  (1984)             President, Abram W. Bergey and Sons, Inc.                13,988 (5)
                                            (Floor Coverings)

Charles H. Hoeflich  85  (1962)         Chairman Emeritus of the Corporation                    226,479

Clair W. Clemens  69  (1984)            Retired, Hatfield Quality Meats, Inc.                     9,495
                                            (Pork Processing)

John U. Young  61  (1988)               President, Alderfer Bologna Co. Inc.                      8,350
                                            (Meat Processing)

Class III (continuing for a term expiring 2002):

Marvin A. Anders  60  (1996)            Vice Chairman of the Corporation                        130,167 (6)
                                            and Vice Chairman of Union National Bank

R. Lee Delp  53  (1994)                 President and CEO, Moyer Packing Company                  4,011
                                            (Beef Packers and Renderers)

Harold M. Mininger  81  (1957)          Retired--H. Mininger & Son, Inc.                        111,305 (7)
                                            (General Contractor)

P. Gregory Shelly  54  (1985)           President, Shelly Enterprises, Inc.                      41,105 (8)
                                            (Building Materials)
</TABLE>

`

func TestASCIINomineeBiographyCommonShareCounts(t *testing.T) {
	rows, _, _ := ExtractText(asciiNomineeShareFixture, Row{})
	rows = ScreenRows(rows)
	if len(rows) != 15 {
		t.Fatalf("want all fifteen literal nominee and continuing-director holdings, got %+v", rows)
	}
	for _, want := range []struct {
		name   string
		shares float64
		notes  string
	}{
		{"William S. Aichele", 105776, "1"}, {"Norman L. Keller", 37356, "2"}, {"Thomas K. Leidy", 144407, "3"}, {"Merrill S. Moyer", 155426, "4"}, {"Richard W. Godshall", 1886, ""}, {"H. Ray Mininger", 6298, ""}, {"Margaret K. Zook", 200, ""}, {"James L. Bergey", 13988, "5"}, {"Charles H. Hoeflich", 226479, ""}, {"Clair W. Clemens", 9495, ""}, {"John U. Young", 8350, ""}, {"Marvin A. Anders", 130167, "6"}, {"R. Lee Delp", 4011, ""}, {"Harold M. Mininger", 111305, "7"}, {"P. Gregory Shelly", 41105, "8"},
	} {
		r := find(rows, want.name, "Common Stock")
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.Percent != nil || r.Footnotes != want.notes {
			t.Errorf("want %+v got %+v", want, r)
		}
	}
}

func TestASCIINomineeShareCountCaptionAndContinuationGuards(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		count      int
	}{
		{"no common-stock count", strings.ReplaceAll(asciiNomineeShareFixture, "Common Stock", "Preferred Stock"), 0},
		{"no beneficial count", strings.ReplaceAll(asciiNomineeShareFixture, "Beneficially", "Compensation"), 0},
		{"no biography header", strings.ReplaceAll(asciiNomineeShareFixture, "Business Experience", "Cash Compensation"), 0},
		{"no continuation evidence", strings.ReplaceAll(asciiNomineeShareFixture, "prior years", "subsequent years"), 7},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows, _, _ := ExtractText(tc.body, Row{})
			rows = ScreenRows(rows)
			if len(rows) != tc.count {
				t.Fatalf("want%d literal holdings got %+v", tc.count, rows)
			}
		})
	}
}

func TestASCIINomineeShareRetryPreservesNonzeroFiling(t *testing.T) {
	body := `<TABLE><CAPTION>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS
Name of Beneficial Owner       Shares Owned       Percent of Class
<S>                            <C>                <C>
Alex Example                   100,000            12.0%
Blair Example                  200,000            24.0%
</TABLE>` + asciiNomineeShareFixture
	rows, _, _ := ExtractText(body, Row{})
	rows = ScreenRows(rows)
	if len(rows) != 2 || find(rows, "Alex Example", "") == nil || find(rows, "Blair Example", "") == nil {
		t.Fatalf("nonzero legacy filing must be unchanged: %+v", rows)
	}
}

const asciiSeparateClassCountsFixture = `SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT

      The following table sets forth certain information with respect to the
beneficial ownership of the capital stock of the Company as of May 20, 2000 for
(i) each person who is known by the Company to beneficially own more than 5% of
any class of capital stock; (ii) each named executive officer listed in the
Summary Compensation Table below; (iii) each director of the Company; and (iv)
all directors and executive officers of the Company as a group. Except as
otherwise indicated, each listed person has sole voting power and investment
power over the respective shares owned.

<TABLE>
<CAPTION>
- ----------------------------------------------------------------------------------------------------------
                                  Amount and Nature    Amount and Nature                       Percent of
                                    of Beneficial        of Beneficial         Percent of       Class of
Name and Address of                 Ownership of          Ownership of          Class of       Preferred
Beneficial Owner(1)                 Common Stock        Preferred Stock       Common Stock       Stock
- ----------------------------------------------------------------------------------------------------------
<S>                                    <C>                <C>                    <C>              <C>
Louis S. Beck(2)                       2,927,499          12,866.06              33.8%            77%
- ----------------------------------------------------------------------------------------------------------
Harry G. Yeaggy(3)                     1,182,500           5,022.02              13.6%            30%
- ----------------------------------------------------------------------------------------------------------
Vincent W. Hatala, Jr                      --                 --                  --              --
- ----------------------------------------------------------------------------------------------------------
Arthur Lubell                              --                 --                  --              --
- ----------------------------------------------------------------------------------------------------------
Richard P. Lerner                          --                 --                  --              --
- ----------------------------------------------------------------------------------------------------------
C. Scott Bartlett, Jr                      5,000              --                   *              --
- ----------------------------------------------------------------------------------------------------------
Lucille Hart-Brown                         --                 --                  --              --
- ----------------------------------------------------------------------------------------------------------
Richard A. Tonges                          --                 --                  --              --
- ----------------------------------------------------------------------------------------------------------
Michael M. Nanosky                         --                 --                  --              --
- ----------------------------------------------------------------------------------------------------------
Paul Tipps                                 2,000              --                   *              --
- ----------------------------------------------------------------------------------------------------------
The United States Lines, Inc. and
United States Lines (S.A.), Inc.
Reorganization Trust, John Paulyson,
Trustee (4)
    184-186 North Avenue East
Cranford, New Jersey 07016               816,944              --                  9.4%            --
- ----------------------------------------------------------------------------------------------------------
</TABLE>


                                       2
<PAGE>

<TABLE>
<S>                                    <C>                <C>                    <C>             <C>
- ----------------------------------------------------------------------------------------------------------
Beck Hospitality Inc. III (5)
    8534 E. Kemper Road
    Cincinnati, Ohio 45249               310,000              1,100               3.6%             7%
- ----------------------------------------------------------------------------------------------------------
Daewoo Corporation (6)
c/o Lubell & Koven
    350 Fifth Avenue
    New York, New York 10118             623,911              --                  7.2%            --
- ----------------------------------------------------------------------------------------------------------
All directors and executive officers
as a group (10 persons)                3,806,999          16,788.08              43.9%           100%
- ----------------------------------------------------------------------------------------------------------
</TABLE>

`

func TestASCIISeparateClassCountsAndPercents(t *testing.T) {
	rows, _, _ := ExtractText(asciiSeparateClassCountsFixture, Row{})
	raw := rows
	rows = ScreenRows(rows)
	for _, want := range []struct {
		name        string
		shares, pct float64
		marker      string
	}{
		{"Louis S. Beck", 2927499, 33.8, ""},
		{"Harry G. Yeaggy", 1182500, 13.6, ""},
		{"C. Scott Bartlett, Jr", 5000, 0, "*"},
		{"Paul Tipps", 2000, 0, "*"},
		{"The United States Lines, Inc. and United States Lines (S.A.), Inc. Reorganization Trust, John Paulyson, Trustee", 816944, 9.4, ""},
		{"Beck Hospitality Inc. III", 310000, 3.6, ""},
		{"Daewoo Corporation", 623911, 7.2, ""},
		{"All directors and executive officers as a group", 3806999, 43.9, ""},
	} {
		if find(raw, want.name, "") == nil {
			t.Errorf("literal pre-screen holder missing: %q", want.name)
		}
		name := want.name
		if group, _ := isGroupRow(name); !group {
			name = cleanHolderName(name)
		}
		r := find(rows, name, "")
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.PctMarker != want.marker || (want.marker == "" && (r.Percent == nil || *r.Percent != want.pct)) || r.ShareClass != "Common Stock" {
			t.Errorf("missing literal common holding %s shares=%v pct=%v marker=%q: %+v", want.name, want.shares, want.pct, want.marker, r)

		}
	}
	if len(rows) != 8 {
		t.Errorf("want 8 disclosed nonzero common holdings; got %d: %+v", len(rows), rows)
	}
}

func TestASCIISeparateClassCountsGuards(t *testing.T) {
	t.Run("money never becomes shares", func(t *testing.T) {
		body := strings.ReplaceAll(asciiSeparateClassCountsFixture, "2,927,499", "$2,927,499")
		rows, _ := textSeparateClassCounts(body, Row{})
		if len(rows) != 0 {
			t.Fatalf("money table accepted by recovery: %+v", rows)
		}
	})
	t.Run("ownership captions required", func(t *testing.T) {
		body := strings.ReplaceAll(asciiSeparateClassCountsFixture, "of Beneficial", "of Compensation")
		rows, _ := textSeparateClassCounts(body, Row{})
		if len(rows) != 0 {
			t.Fatalf("nonownership header accepted: %+v", rows)
		}
	})
	t.Run("nonzero legacy preserved", func(t *testing.T) {
		body := `<TABLE><CAPTION>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS
Name of Beneficial Owner       Shares Owned       Percent of Class
<S>                            <C>                <C>
Alex Example                   100,000            12.0%
Blair Example                  200,000            24.0%
</TABLE>` + asciiSeparateClassCountsFixture
		rows, _, _ := ExtractText(body, Row{})
		rows = ScreenRows(rows)
		if find(rows, "Alex Example", "") == nil || find(rows, "Blair Example", "") == nil || find(rows, "Louis S. Beck", "") != nil {
			t.Fatalf("recovery changed emitting legacy filing: %+v", rows)
		}
	})
	t.Run("group and footnotes", func(t *testing.T) {
		rows, _, _ := ExtractText(asciiSeparateClassCountsFixture, Row{})
		rows = ScreenRows(rows)
		group := find(rows, "All directors and executive officers as a group", "")
		if group == nil || !group.IsGroupRow || group.GroupN != 10 {
			t.Fatalf("group count lost: %+v", group)
		}
		for name, note := range map[string]string{"Louis S. Beck": "2", "Harry G. Yeaggy": "3", "Beck Hospitality Inc. III": "5", "Daewoo Corporation": "6"} {
			r := find(rows, name, "")
			if r == nil || r.Footnotes != note {
				t.Errorf("footnote %s %s: %+v", name, note, r)
			}
		}
	})
}

const asciiInlineAgeNomineeFixture = `<TABLE>
<CAPTION>


                         Name, age, business experience                                                          Shares Owned at
               during the past five years and other directorships                     Position with Fund           May 17, 1996
               --------------------------------------------------                     ------------------         ---------------


                                Class I Directors
                (Nominated to be Elected for Term Expiring 1999)
<S>                                                                                        <C>                         <C>
Olarn  Chaipravat  (51),  President and Chief  Executive  Officer (since October           Director                    -0-
1992),  Director and Senior Executive Vice President (July  1990-September 1992)
and  Senior  Executive  Vice  President  (September  1987-June  1990),  The Siam
Commercial Bank, Public Company Limited, Thailand.


Michael J. Downey (52), Private Investor, previously,  Chairman (August 1990-May           Director                    4,674
1993),  Chief Executive  Officer and Director (June 1987-May 1993) and President
of PMF (June 1987-July  1990);  Director of Prudential  Securities  Group,  Inc.
(July 1991-May 1993);  President,  Asset  Management Group (July 1991-May 1993);
Executive Vice President,  (May 1989-May  1993),  Director (July 1985-June 1991)
and Senior Vice  President  (December  1983-May  1989) of Prudential  Securities
Incorporated (PSI); Director,  International Imaging Materials, Inc., The Merger
Fund, Value Asset Management, Inc. and The Simba Fund Limited.


</TABLE>

                                       2
<PAGE>

<TABLE>
<CAPTION>


                         Name, age, business experience                                                          Shares Owned at
               during the past five years and other directorships                     Position with Fund           May 17, 1996
               --------------------------------------------------                     ------------------         ---------------
<S>                                                                                        <C>                         <C>
John A. Morrell (68),  Principal, John  Morrell & Associates; Director,  Mercury           Director                    -0-
International  Investment Trust Ltd.; Govett Oriental Trust Plc; Govett Emerging
Markets  Investment  Trust Plc.;  Govett High Income  Investment  Trust Plc; HCG
Lloyds  Investment  Trust Plc;  Invesco Japan Discovery Trust Plc; Law Debenture
Corporation Plc.;  Lowland Investment Company Plc; Johnson Fry Utilities trusts;
PRICOA Worldwide  Investors  Portfolio;  Fidelity Asian Values Investment Trust;
The Romanian Fund and Fidelity Japan Values Trust; Member, Advisory Board to the
Trustees of the Atlantic Richfield Pension Fund. Previously, Executive Chairman,
Baring International Investment Ltd.; Director,  Baring International Investment
(Far East) Ltd.; Baring Asset Management Ltd.; Drayton Asia Trust Ltd. and Inner
London Board of National Westminster Bank.



                               Class II Directors
                              (Term Expiring 1997)


Robert H. Burns (66),  Chairman,  Robert H. Burns Holdings  Limited,  Hong Kong;           Director                   28,000
previously,  Chairman and Chief Executive Officer,  Regent International Hotels,
Limited, Hong Kong.

Douglas Tong Hsu (50), Director and President, Far Eastern Textile Ltd., Taiwan;           Director                    -0-
Director, the Baring Taiwan Fund Limited (since 1993).

*David G. P. Scholfield  (52),  Chairman,  Baring Mutual Fund  Management  S.A.;        President and                 11,700
Director, International Fund Managers UK Limited; Baring Asset Management (C.I.)           Director
Limited;  European and Asian Fund  Management  S.A.;  The Baring  Chrysalis Fund
Limited;  The Simba Fund Limited;  The Baring  Peacock Fund Limited;  The Baring
Taiwan Fund  Limited;  World Value Fund SICAF and  Divisional  Director,  Baring
International  Investment  Management  Limited.  Previously,  Managing Director,
Baring  International  Asset  Administration  Limited  and  Baring  Mutual  Fund
Management (Ireland) Limited and Director, The Greater China Fund, Inc.
</TABLE>



                                       3
<PAGE>

<TABLE>
<CAPTION>


                         Name, age, business experience                                                          Shares Owned at
               during the past five years and other directorships                     Position with Fund           May 17, 1996
               --------------------------------------------------                     ------------------         ---------------
<S>                                                                                        <C>                         <C>
                               Class III Directors
                              (Term Expiring 1998)

*Robert F. Gunia (49),  Director  (since  January  1989),  Chief  Administrative           Vice President             1,200
Officer  (since July 1990) and  Executive  Vice  President,  Treasurer and Chief            and Director
Financial  Officer (since June 1987),  Prudential  Mutual Fund Management,  Inc.
(PMF)  and  Senior  Vice  President  of PSI;  Director  (since  February  1992),
Nicholas-Applegate Growth Equity Fund, Inc.

*David J. Brennan (38),  Managing  Director,  Baring Asset  Management  Holdings          Vice President               -0-
Limited;  Baring Asset  Management  Limited;  Chairman,  Baring Asset Management           and Director
(Asia)  Limited;   Baring  Asset  Management  (Asia)  Holdings  Limited;  Baring
International Fund Managers Limited;  and Baring  International  Investment (Far
East) Limited;  Divisional Director, Baring International Investment Limited and
Baring  International  Investment  Management Limited;  Director,  Austin Assets
Limited; Baring International Fund Managers (Bermuda) Limited; Baring Korea Fund
Limited.

Don G. Hoff (60), Chairman  and  Chief Executive Officer, Intertec,  Inc. (since            Chairman of                690
1975);  Chairman  and  Chief  Executive  Officer,  Electronic Hair Styling, Inc.             the Board
(since  1995);  Director,  Prudential  Global  Fund,  Inc.;  Prudential  Pacific            and Director
Growth  Fund,  Inc.;  Prudential Global  Limited  Maturity  Fund,  Inc. and  The
Greater China Fund, Inc.


<FN>
- -----------------
*Indicates "interested" Directors of the Fund, as defined in the Investment Company Act of 1940, as amended (the Investment Company
Act). Messrs. Scholfield and Brennan are deemed to be "interested" Directors of the Fund, by reason of their affiliations with
Baring International Investment (Far East) Limited. Mr. Gunia is deemed to be an "interested" Director of the Fund, by reason of his
affiliation with PMF.
</FN>
</TABLE>`

func TestASCIIInlineAgeNomineeShareCounts(t *testing.T) {
	rows, _, _ := ExtractText(asciiInlineAgeNomineeFixture, Row{})
	rows = ScreenRows(rows)
	for _, want := range []struct {
		name   string
		shares float64
	}{
		{"Olarn Chaipravat", 0},
		{"Michael J. Downey", 4674},
		{"John A. Morrell", 0},
		{"Robert H. Burns", 28000},
		{"Douglas Tong Hsu", 0},
		{"David G. P. Scholfield", 11700},
		{"Robert F. Gunia", 1200},
		{"David J. Brennan", 0},
		{"Don G. Hoff", 690},
	} {
		r := find(rows, want.name, "")
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.Percent != nil || r.TableKind != "management" {
			t.Errorf("missing literal nominee holding %s shares=%v: %+v", want.name, want.shares, r)
		}
	}
	if len(rows) != 9 {
		t.Errorf("want 9 literal holdings including disclosed zeroes; got %d: %+v", len(rows), rows)
	}
}

func TestASCIIInlineAgeNomineeGuards(t *testing.T) {
	t.Run("ownership header required", func(t *testing.T) {
		body := strings.ReplaceAll(asciiInlineAgeNomineeFixture, "Shares Owned at", "Compensation at")
		rows, _ := textNomineeShareCounts(body, Row{})
		if len(rows) != 0 {
			t.Fatalf("nonownership table accepted: %+v", rows)
		}
	})
	t.Run("money cannot become shares", func(t *testing.T) {
		body := strings.ReplaceAll(asciiInlineAgeNomineeFixture, "4,674", "$4,674")
		body = strings.ReplaceAll(body, "Shares Owned at", "Dollar Range of Shares Owned at")
		rows, _ := textNomineeShareCounts(body, Row{})
		if len(rows) != 0 {
			t.Fatalf("money table accepted: %+v", rows)
		}
	})
	t.Run("nonzero legacy preserved", func(t *testing.T) {
		body := `<TABLE><CAPTION>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS
Name of Beneficial Owner       Shares Owned       Percent of Class
<S>                            <C>                <C>
Alex Example                   100,000            12.0%
Blair Example                  200,000            24.0%
</TABLE>` + asciiInlineAgeNomineeFixture
		rows, _, _ := ExtractText(body, Row{})
		rows = ScreenRows(rows)
		if find(rows, "Alex Example", "") == nil || find(rows, "Blair Example", "") == nil || find(rows, "Michael J. Downey", "") != nil {
			t.Fatalf("retry changed legacy-emitting filing: %+v", rows)
		}
	})
	t.Run("interested-director asterisk is not percent", func(t *testing.T) {
		rows, _, _ := ExtractText(asciiInlineAgeNomineeFixture, Row{})
		for _, r := range rows {
			if r.PctMarker != "" || r.Percent != nil || r.ShareClass != "" {
				t.Errorf("invented percentage or class: %+v", r)
			}
		}
	})
}

const asciiFundShareMatrixFixture = `<Table>
<Caption>
                          FUND SHARES OWNED BY BOARD MEMBERS AND OFFICERS(1)
- -----------------------------------------------------------------------------------------------------
BOARD MEMBER                   QUALITY       QUALITY       QUALITY         TAX-       GLOBAL   GLOBAL
NOMINEES                     PREFERRED   PREFERRED 2   PREFERRED 3   ADVANTAGED   GOVERNMENT    VALUE

- -----------------------------------------------------------------------------------------------------
<S>                          <C>         <C>           <C>           <C>          <C>          <C>

Robert P. Bremner.........         0             0            0        12,500           0          0
Lawrence H. Brown.........     1,000         1,000        1,000             0           0          0
Jack B. Evans.............         0         4,400            0             0           0          0
William C. Hunter.........         0             0            0         3,675           0          0
Daniel J. Kundert.........         0             0            0             0           0          0
William J. Schneider......         0             0        7,500             0         500          0
Timothy R. Schwertfeger...         0        50,000            0        71,032           0          0
Judith M. Stockdale.......         0             0            0             0         250          0
Carole E. Stone(2)........         0             0            0             0           0          0
Eugene S. Sunshine........     2,075(3)      2,490(3)         0         4,545           0          0
ALL BOARD MEMBERS AND
  OFFICERS AS A GROUP.....     3,075        57,890        8,500        92,052         750        900
</Table>`

func TestASCIIFundShareMatrixBoundedCounts(t *testing.T) {
	body := `<TABLE><CAPTION>DOLLAR RANGE OF EQUITY SECURITIES
BOARD MEMBER                QUALITY PREFERRED
<S>                         <C>
Robert P. Bremner           $10,001 - $50,000
Lawrence H. Brown           Over $100,000
</TABLE>
` + asciiFundShareMatrixFixture
	rows, _, _ := ExtractText(body, Row{})
	rows = ScreenRows(rows)
	for _, want := range []struct {
		name, class string
		shares      float64
	}{
		{"Robert P. Bremner", "QUALITY PREFERRED", 0},
		{"Robert P. Bremner", "TAX- ADVANTAGED", 12500},
		{"Lawrence H. Brown", "QUALITY PREFERRED 2", 1000},
		{"Eugene S. Sunshine", "QUALITY PREFERRED", 2075},
		{"ALL BOARD MEMBERS AND OFFICERS AS A GROUP", "QUALITY PREFERRED 2", 57890},
	} {
		r := find(rows, want.name, want.class)
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.Percent != nil {
			t.Errorf("missing literal matrix count %s / %s = %v: %+v", want.name, want.class, want.shares, r)
		}
	}
	if len(rows) != 66 {
		t.Errorf("want 11 holders x 6 distinct funds = 66 rows, got %d: %+v", len(rows), rows)
	}
}
func TestASCIIFundShareMatrixRejectMoney(t *testing.T) {
	body := strings.ReplaceAll(asciiFundShareMatrixFixture, "FUND SHARES OWNED", "DOLLAR RANGE OF FUND SHARES OWNED")
	rows, _, _ := ExtractText(body, Row{})
	if len(ScreenRows(rows)) != 0 {
		t.Fatalf("dollar-range matrix accepted: %+v", rows)
	}
}

const asciiFundMatrixSuperheaderFixture = `<Table>
<Caption>
                      FUND SHARES OWNED BY BOARD MEMBERS AND OFFICERS(1)
- ----------------------------------------------------------------------------------------------
                                                        NEW YORK
BOARD MEMBER                  NEW YORK     NEW YORK   INVESTMENT   NEW YORK           NEW YORK
NOMINEES                      DIVIDEND   DIVIDEND 2      QUALITY      VALUE   PERFORMANCE PLUS

- ----------------------------------------------------------------------------------------------
<S>                           <C>        <C>          <C>          <C>        <C>

Robert P. Bremner...........      0           0            0           0              0
Lawrence H. Brown...........      0           0            0           0              0
Jack B. Evans...............      0           0            0           0              0
William C. Hunter...........      0           0            0           0              0
David J. Kundert............      0           0            0           0              0
William J. Schneider........      0           0            0           0              0
Timothy R. Schwertfeger.....      0           0            0           0              0
Judith M. Stockdale.........      0           0            0           0              0
Carole E. Stone(2)..........      0           0            0           0              0
Eugene S. Sunshine..........      0           0            0           0              0
ALL BOARD MEMBERS AND
  OFFICERS AS A GROUP.......      0           0            0           0              0
- ----------------------------------------------------------------------------------------------

</Table>`

func TestASCIIFundMatrixSuperheader(t *testing.T) {
	rows, _, _ := ExtractText(asciiFundMatrixSuperheaderFixture, Row{})
	rows = ScreenRows(rows)
	if len(rows) != 55 {
		t.Fatalf("want 11 holders x 5 funds, got %d", len(rows))
	}
	r := find(rows, "Robert P. Bremner", "NEW YORK INVESTMENT QUALITY")
	if r == nil || r.Shares == nil || *r.Shares != 0 {
		t.Fatalf("lost top line of fund header: %+v", rows)
	}
}

func TestASCIIFundShareMatrixGuards(t *testing.T) {
	t.Run("money in explicit share caption", func(t *testing.T) {
		body := strings.Replace(asciiFundShareMatrixFixture, "12,500", "$12,500", 1)
		rows, _, _ := ExtractText(body, Row{})
		if len(ScreenRows(rows)) != 0 {
			t.Fatal("currency accepted as share counts")
		}
	})
	t.Run("caption required", func(t *testing.T) {
		body := strings.ReplaceAll(asciiFundShareMatrixFixture, "FUND SHARES OWNED BY BOARD MEMBERS AND OFFICERS(1)", "PAYMENTS TO BOARD MEMBERS AND OFFICERS")
		rows, _, _ := ExtractText(body, Row{})
		if len(ScreenRows(rows)) != 0 {
			t.Fatal("nonownership matrix accepted")
		}
	})
	t.Run("legacy emitting filing unchanged", func(t *testing.T) {
		body := `<TABLE><CAPTION>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS
Name of Beneficial Owner       Shares Owned       Percent of Class
<S>                            <C>                <C>
Alex Example                   100,000            12.0%
Blair Example                  200,000            24.0%
</TABLE>
` + asciiFundShareMatrixFixture
		rows, _, _ := ExtractText(body, Row{})
		rows = ScreenRows(rows)
		if len(rows) != 2 || find(rows, "Alex Example", "") == nil || find(rows, "Blair Example", "") == nil {
			t.Fatalf("retry changed legacy holdings: %d", len(rows))
		}
	})
	t.Run("malformed value rejects whole row", func(t *testing.T) {
		body := strings.Replace(asciiFundShareMatrixFixture, "12,500", "unknown", 1)
		rows, _, _ := ExtractText(body, Row{})
		rows = ScreenRows(rows)
		if len(rows) != 60 || find(rows, "Robert P. Bremner", "QUALITY PREFERRED") != nil {
			t.Fatalf("partially read malformed row: %d", len(rows))
		}
	})
}

const asciiCaptionBraceFootnotesFixture = `<TABLE>
<CAPTION>
                                                            COMMON STOCK      PERCENT OF
 NAME                                                    BENEFICIALLY OWNED     CLASS
 <S>                                                          <C>              <C>
 Walter Alexander                                                31,212 {(1)}      *
 Harry R. Baker                                                  28,473 {(1)}      *
 Gary W. Freels                                                 995,085 {(2)}   1.93%
 Thomas J. Howatt                                               506,041 {(1)}      *
 Dennis J. Kuester                                               15,000 {(3)}      *
 San W. Orr, Jr.                                              1,195,820 {(4)}   2.31%
 Richard L. Radt                                                 48,546 {(1)}      *
 David B. Smith, Jr.                                          2,417,491 {(5)}   4.69%
 Stuart R. Carlson                                              129,791 {(1)}      *
 David L. Canavera                                              167,514 {(1)}      *
 Dennis M. Urbanek                                              148,369 {(1)}      *
 John J. Schievelbein                                           100,000 {(1)}      *

 All directors and executive officers as a group (15 persons) 5,994,080 {(6)}  11.31%
</TABLE>`

const asciiCaptionAgePositionFixture = `<TABLE>
<CAPTION>
                                                                                         POSITIONS
NAME                                            NUMBER OF           % SHARES                WITH            DIRECTOR
                                       AGE        SHARES           OUTSTANDING             COMPANY          SINCE(1)
                                       ---        ------           -----------             -------          --------

<S>                                    <C>     <C>                        <C>        <C>                      <C>
Ronald K. Earnest                      48      113,256  (2)                5.4%        President and          1998
381 Halton Road                                                                           Director
Greenville, S.C.

Harold E. Garrett                      34       46,830                     2.2%           Director            1998
Fountain Inn, S.C.

Mason Y. Garrett                       60      161,271  (3)                7.7%         Chairman and          1998
325 South Main Street                                                                 Chief Executive
Fountain Inn, S.C.                                                                        Officer

Michael L. Gault                       47       28,875  (4)                1.4%           Director            1998
Fountain Inn, S.C.

Baety O. Gross, Jr.                    55       28,182  (5)                1.3%           Director            1998
Simpsonville, S.C.

S. Hunter Howard, Jr.                  50       11,550                        *           Director            2000
Columbia, S.C.

S. Blanton Phillips                    34        2,310                        *           Director            2001
Fountain Inn, S.C.
                                              ---------
All Directors, nominees and
executive officers as a group
(7 persons)                                    392,274                    18.7%
</TABLE>`

func TestASCIICaptionOwnershipDiscovery(t *testing.T) {
	for _, tc := range []struct {
		label, body, name, class string
		shares                   float64
		count                    int
	}{
		{"brace footnotes", asciiCaptionBraceFootnotesFixture, "Gary W. Freels", "Common Stock", 995085, 13},
		{"age and position columns", asciiCaptionAgePositionFixture, "Ronald K. Earnest", "", 113256, 8},
	} {
		t.Run(tc.label, func(t *testing.T) {
			rows, _, _ := ExtractText(tc.body, Row{})
			rows = ScreenRows(rows)
			r := find(rows, tc.name, tc.class)
			if r == nil || r.Shares == nil || *r.Shares != tc.shares {
				t.Errorf("missing caption holding %s shares=%v: %+v", tc.name, tc.shares, rows)
			}
			if len(rows) != tc.count {
				t.Errorf("want %d literal ownership rows, got %d", tc.count, len(rows))
			}
			groups := 0
			for _, row := range rows {
				if row.IsGroupRow {
					groups++
					if row.Percent == nil {
						t.Error("lost group percentage")
					}
				}
			}
			if groups != 1 {
				t.Errorf("want one disclosed group, got %d", groups)
			}
		})
	}
}

func TestASCIICaptionOwnershipGuards(t *testing.T) {
	for _, tc := range []struct{ label, old, replacement string }{
		{"currency rejected", "995,085", "$995,085"},
		{"dollar caption rejected", "COMMON STOCK", "DOLLAR RANGE OF COMMON STOCK"},
		{"ownership label required", "BENEFICIALLY OWNED", "PAYMENT RECEIVED"},
		{"percent header required", "PERCENT OF", "SIZE OF"},
	} {
		t.Run(tc.label, func(t *testing.T) {
			body := strings.ReplaceAll(asciiCaptionBraceFootnotesFixture, tc.old, tc.replacement)
			rows, _, _ := ExtractText(body, Row{})
			if len(ScreenRows(rows)) != 0 {
				t.Fatalf("nonownership caption accepted: %+v", rows)
			}
		})
	}
	t.Run("malformed count not partially parsed", func(t *testing.T) {
		body := strings.ReplaceAll(asciiCaptionBraceFootnotesFixture, "995,085", "995x085")
		rows, _, _ := ExtractText(body, Row{})
		rows = ScreenRows(rows)
		if len(rows) != 12 || find(rows, "Gary W. Freels", "Common Stock") != nil {
			t.Fatalf("malformed count read: %+v", rows)
		}
	})
	t.Run("legacy emitting table preserved", func(t *testing.T) {
		body := `<TABLE><CAPTION>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS
Name of Beneficial Owner       Shares Owned       Percent of Class
<S>                            <C>                <C>
Alex Example                   100,000            12.0%
Blair Example                  200,000            24.0%
</TABLE>
` + asciiCaptionBraceFootnotesFixture
		rows, _, _ := ExtractText(body, Row{})
		rows = ScreenRows(rows)
		if len(rows) != 2 || find(rows, "Alex Example", "") == nil || find(rows, "Gary W. Freels", "Common Stock") != nil {
			t.Fatalf("retry changed legacy output: %+v", rows)
		}
	})
}

const asciiCaptionEmptyPercentFixture = `<TABLE>
<CAPTION>
                                                                          Number of Shares  Percent of Class
                      Name                               Position        Beneficially Owned (if more than 1%)
                      ----                        ---------------------- ------------------ -----------------
<S>                                               <C>                    <C>                <C>
Susan B. Bayh.................................... Director                        0                --
Larry C. Glasscock............................... President and Chief
                                                  Executive Officer and
                                                  Director                        0                --
William B. Hart.................................. Director                        0                --
Allan B. Hubbard................................. Director                        0                --
Victor S. Liss................................... Director                        0                --
L. Ben Lytle..................................... Chairman of the Board
                                                  of Directors                    0                --
William G. Mays.................................. Director                        0                --
James W. McDowell, Jr............................ Director                        0                --
B. LaRae Orullian................................ Director                        0                --
Senator Donald W. Riegle, Jr..................... Director                        0                --
William J. Ryan.................................. Director                        0                --
George A. Schaefer, Jr........................... Director                        0                --
Dennis J. Sullivan, Jr........................... Director                        0                --
David R. Frick................................... Executive Vice
                                                  President and Chief
                                                  Legal and
                                                  Administrative Officer          0                --
Michael L. Smith................................. Executive Vice
                                                  President and Chief
                                                  Financial and
                                                  Accounting Officer              0                --
Marjorie W. Dorr................................. President, Anthem East          0                --
Keith R. Faller.................................. President, Anthem
                                                  Midwest                         0                --
All current directors and executive officers as a
  group (22 persons).............................                                24                --
</TABLE>`

func TestASCIICaptionZeroCountsWithPositionWrap(t *testing.T) {
	rows, _, _ := ExtractText(asciiCaptionEmptyPercentFixture, Row{})
	rows = ScreenRows(rows)
	if len(rows) != 18 {
		t.Errorf("want 18 literal zero/small holdings, got %d: %+v", len(rows), rows)
	}
	for _, name := range []string{"Susan B. Bayh", "Larry C. Glasscock", "L. Ben Lytle", "David R. Frick", "Michael L. Smith", "Keith R. Faller"} {
		r := find(rows, name, "")
		if r == nil || r.Shares == nil || *r.Shares != 0 || r.Percent != nil {
			t.Errorf("lost disclosed zero for %s: %+v", name, r)
		}
	}
	groups := 0
	for _, r := range rows {
		if r.IsGroupRow {
			groups++
			if r.GroupN != 22 || r.Shares == nil || *r.Shares != 24 || r.Percent != nil {
				t.Errorf("wrong literal group: %+v", r)
			}
		}
	}
	if groups != 1 {
		t.Errorf("want one group, got %d", groups)
	}
}

const asciiCaptionClassStubFixture = `         SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS AND MANAGEMENT

     The following table sets forth certain information known to us with respect
to beneficial ownership of the Company's Common Stock as of July 26, 2001 by (1)
each stockholder known by the Company to be the beneficial owner of more than
five percent of either class; (2) each of the Directors and named executive
officers and (3) the Directors and named executive officers as a group.

<Table>
<Caption>
                                                                       AMOUNT AND NATURE OF
TITLE OF CLASS                 NAME AND ADDRESS OF BENEFICIAL OWNER    BENEFICIAL OWNERSHIP   % OF CLASS
- --------------                 ------------------------------------    --------------------   ----------
<S>                           <C>                                      <C>                    <C>
Class B(1)..................  Vincent K. McMahon(2)                         56,100,330           99.0%
Class A.....................  General Electric Company(3)                    2,307,692           14.2%
                              3135 Easton Turnpike
                              Fairfield, CT 06431
Class A.....................  Viacom Inc.(4)                                 2,281,492           14.0%
                              1515 Broadway
                              New York, New York 10036
Class A.....................  Citigroup Inc.(5)                              1,133,976            7.0%
                              399 Park Avenue
                              New York, New York 10043
Class A.....................  Capital Group International, Inc.(6)           1,409,750            8.7%
                              Capital Guardian Trust Company
                              11100 Santa Monica Blvd.
                              Los Angeles, CA 90025
Class A.....................  Mario J. Gabelli and Marc J. Gabelli(7)          822,800            5.1%
                              One Corporate Center
                              Rye, New York 10580
Class B(1)..................  Linda E. McMahon                                 566,770(8)         1.0%
Class A.....................  Stuart C. Snyder                                  75,000(9)           *
Class A.....................  August J. Liguori                                 75,000(9)           *
Class A.....................  David Kenin                                       12,500(9)           *
Class A.....................  Joseph Perkins                                    12,500(9)           *
Class A.....................  Lowell P. Weicker, Jr.                            14,500(9)           *
Class A and Class B(10).....  All Named Executive Officers and              56,856,600           78.0%
                              Directors as a Group (7 persons)
</Table>`

func TestASCIICaptionClassStubCounts(t *testing.T) {
	rows, _, _ := ExtractText(asciiCaptionClassStubFixture, Row{})
	rows = ScreenRows(rows)
	if len(rows) != 13 {
		t.Errorf("want 13 class-specific holdings, got %d", len(rows))
	}
	for _, want := range []struct {
		name, class string
		shares      float64
	}{
		{"Vincent K. McMahon", "Class B", 56100330},
		{"General Electric Company", "Class A", 2307692},
		{"Viacom Inc", "Class A", 2281492},
		{"Linda E. McMahon", "Class B", 566770},
	} {
		r := find(rows, want.name, want.class)
		if r == nil || r.Shares == nil || *r.Shares != want.shares {
			t.Errorf("missing literal class holding %+v: %+v", want, r)
		}
	}
	groups := 0
	for _, r := range rows {
		if r.IsGroupRow {
			groups++
			if r.GroupN != 7 || r.ShareClass != "Class A and Class B" || r.Shares == nil || *r.Shares != 56856600 || r.Percent == nil || *r.Percent != 78 {
				t.Errorf("wrong group: %+v", r)
			}
		}
	}
	if groups != 1 {
		t.Errorf("want one forward-wrapped group, got %d", groups)
	}
}

func TestASCIICaptionClassContextAndCurrencyGuards(t *testing.T) {
	t.Run("common class requires source evidence", func(t *testing.T) {
		body := strings.ReplaceAll(asciiCaptionClassStubFixture, "Company's Common Stock", "Company's Securities")
		rows, _, _ := ExtractText(body, Row{})
		rows = ScreenRows(rows)
		if find(rows, "Linda E. McMahon", "Class B") != nil || find(rows, "Vincent K. McMahon", "Class B") != nil {
			t.Fatal("unsupported common class exemption")
		}
		if find(rows, "Viacom Inc", "Class A") == nil {
			t.Fatal("unrelated class A holding lost")
		}
	})
	t.Run("share currency forbidden in class table", func(t *testing.T) {
		body := strings.ReplaceAll(asciiCaptionClassStubFixture, "2,281,492", "$2,281,492")
		rows, _, _ := ExtractText(body, Row{})
		if len(ScreenRows(rows)) != 0 {
			t.Fatal("currency read as class holding")
		}
	})
}

const asciiFundRegistrationFixture = `<Table>
<Caption>
FUND NAME                                               REGISTRATION               SHARES/CLASS     PERCENT
- ---------                                   ------------------------------------  ---------------   --------
<S>                                         <C>                                   <C>               <C>
CMF

  California Series.......................  Pershing LLC                                 20,251/C      10.0%
                                            P.O. Box 2052
                                            Jersey City, NJ

                                            Mr. Jergen Sorensen &                        10,478/C       5.2%
                                            Mrs. Karen Sorensen JT TEN
                                            17711 Kennison Ln
                                            Lodi, CA 95240-0806

                                            Paine Webber                                 13,221/C       6.5%
                                            For the Benefit of
                                            Terrance J. Chan
                                            Karen Chan JTWROS
                                            1518 Ruby Ct
                                            Diamond Bar, CA 91765

                                            Mrs. Margaret Abdun - Nur Succ               24,124/C      11.9%
                                            Ttee
                                            Of the Amean & Wydea Haddad
                                            Living Trust UA DTD 01-18-78
                                            Tarzana, CA 91356

                                            SEI Private Trust Company C/F                21,046/Z       5.2%
                                            C/O TIAA-CREF
                                            Attn: Mutual Funds Administration
                                            One Freedom Valley Dr
                                            Oaks, PA 19456

                                            Principia Inv. Partners Plus                 33,337/Z       9.6%
                                            C/O North Shore Capital Mgt.
                                            11621 Kew Gardens Ave, Ste 210
                                            Palm Bch Gdns, FL 33410

  California Income Series................  Mrs. Hazel L. Mortensen TTEE                 52,960/C       6.1%
                                            L J & H Mortensen Trust B
                                            UA DTD 05/05/81
                                            PO Box 443
                                            Salinas, CA 93902-0443

                                            SEI Trust Company                           175,893/Z      31.7%
                                            C/O Prudential Bache
                                            Attn: Mutual Fund Admistrato
                                            One Freedom Valley Dr
                                            Oaks, PA 19456
</Table>


                                      A-1
<Page>


<Table>
<Caption>
FUND NAME                                               REGISTRATION               SHARES/CLASS     PERCENT
- ---------                                   ------------------------------------  ---------------   --------
<S>                                         <C>                                   <C>               <C>
                                            Mr. Gurjot Singh                             30,270/Z       5.5%
                                            Mrs. Jasjit Singh CO-TTEES
                                            Of the Singh Family Living Revocable
                                            Trust
                                            UA DTD 05/20/95
                                            19040 Loree Ave
                                            Cupertino, CA 95014-3526

                                            Ms. Nairn Kirkpatrick TTEE                   51,486/Z       9.3%
                                            Nairn Kirkpatrick Trust
                                            UA DTD 08/26/82
                                            7677 Greenridge Way
                                            Fair Oaks, CA 95628-4808

  California Money Market Series..........                   --                         --             --

GIF.......................................  Prudential Retirement Services              712,249/Z       6.1%
                                            As Nominee For Plan 326812
                                            Farm Fresh Retirement Plan
                                            PO Box 5310
                                            Scranton, PA 18505

HYF.......................................  Prudential Retirement Services            4,443,962/Z      38.1%
                                            Nominee For Trustee PI W68700
                                            Prudential Securities Inc.
                                            PO Box 5310
                                            Scranton, PA 18505

MBF

  High Income Series......................  Mr. Joseph A. Fiore                         300,499/Z      19.3%
                                            1 Green Meadow Ln
                                            Cincinnati, OH 45242

                                            New Beginning                               174,197/Z      11.2%
                                            Family Limited Partnership #1
                                            101 Convention Center Dr, Suite 700
                                            Las Vegas, NV 89101

  Insured Series..........................  Herman Zeidman TTEE                          60,502/C       8.2%
                                            Herman M. Zeidman
                                            TR UA DTD 08/09/85
                                            FBO Herman Zeidman
                                            3100 Estates Dr
                                            Pompano Beach, FL 33069-3809

                                            Mr. Larry A. Harris TTEE                     91,099/Z      11.6%
                                            Harris Trust
                                            UA DTD 03-04-97
                                            FBO Larry A. Harris
                                            3637 W. Camino Del Norte
                                            Tuscan, AZ 85742

                                            Mr. Thomas D. Meyer TTEE                     85,574/Z      10.5%
                                            Thomas D. Meyer Rev Lvg Trust
                                            UA DTD 9-20-80
                                            PO Box 350
                                            Three Rivers, MI 49093
</Table>


                                      A-2
<Page>


<Table>
<Caption>
FUND NAME                                               REGISTRATION               SHARES/CLASS     PERCENT
- ---------                                   ------------------------------------  ---------------   --------
<S>                                         <C>                                   <C>               <C>
MSF

  Florida Series..........................  Betty Louise Sikes TTEE                      35,747/C       6.4%
                                            Betty Louise Sikes
                                            Rev Trust UA DTD 06/23/83
                                            FBO Betty Louise Sikes
                                            4011 NE 25th Ave.
                                            Ft Lauderdale, FL 33308-5726

                                            RELF Limited Partnership, LLLP               74,286/C      13.4%
                                            Attn: Randall E.L. Falck, Pres
                                            Of RELF Enterprises G.P.
                                            8049 Whisper Lake Ln W
                                            Ponte Vedra Bch, FL 32082-3115

                                            Mrs. Carole L. Parsons &                     15,890/Z       8.6%
                                            Mr. William T. Parsons JT TEN
                                            6111 Bay Lake Dr N
                                            St. Petersburg, FL 32082-3115

                                            Shorewood LLC                                43,755/Z      23.8%
                                            Attn: Doug Reich
                                            11621 Kew Gardens Ave, Ste 210
                                            Palm Beach Garde, FL 33410

                                            Gerald W. Bobo &                             12,501/Z       6.8%
                                            Susan O. Bobo TEN ENT
                                            8089 SE Country Estates Way
                                            Jupiter, FL 33458-1045

                                            Lilla A. Grim TTEE                           27,111/Z      14.7%
                                            Lilla A. Grim Revocable Living
                                            Trust UA DTD 04-11-01
                                            730 Osprey Ave, Apt 414
                                            Sarasota, FL 34236

  New Jersey Series.......................  Mrs. Gail W. Bennett                         35,862/C       6.6%
                                            2 S Rohallion Dr
                                            Rumson, NJ 07760-1221

                                            Mr. Richard L. Bennet                        35,862/C       6.6%
                                            2 S Rohallion Dr
                                            Rumson, NJ 07760-1221

                                            Maria Claudia Fricchione                     17,627/Z       5.8%
                                            7 Pershing Blvd
                                            Lavallette, NJ 08735-2832

                                            Tammy Perconti                              101,003/Z      33.1%
                                            105 Waters Edge Ct
                                            Brick, NJ 08724
</Table>


                                      A-3
<Page>


<Table>
<Caption>
FUND NAME                                               REGISTRATION               SHARES/CLASS     PERCENT
- ---------                                   ------------------------------------  ---------------   --------
<S>                                         <C>                                   <C>               <C>
                                            Shorewood LLC                                41,371/Z      13.6%
                                            Attn: Doug Reich
                                            11621 Kew Gardens Ave, Ste 210
                                            Palm Beach Garden, FL 33410

  New Jersey Money Market Series..........                   --                         --             --

  New York Series.........................  Raymond James & Assoc Inc.                   18,904/C       6.7%
                                            FBO Weinstock Mario
                                            BIN# 47549721
                                            880 Carillon PKWY
                                            St. Petersburg, FL 33716

                                            Henry Hocker &                               20,807/C       7.4%
                                            Gloria Hocker JT TEN
                                            15 West Suffolk Ave
                                            Central Islip, NY 11722-2142

                                            Mrs. Mary B. Walsh                           14,079/C       5.0%
                                            103 Ashland Ave
                                            Pleasantville, NY 10570

                                            Mrs. Jill C. Davila                          11,947/Z       5.2%
                                            Mr. Sean E. Hattrick Co-TTEES
                                            Jill C. Davila Trust
                                            UA DTD 12-15-00
                                            PO Box 391
                                            South Hampton, NY 11969

                                            Denise Oakley                                35,557/Z      15.5%
                                            33 William Puckey Dr
                                            Cortland Mnr, NY 10567-6215

                                            Mr. Jonathan Stern                           13,964/Z       6.1%
                                            127 E. 30th St. Apt. 14D
                                            New York, NY 10016

                                            Dr. Janet Jeppson Amimov                     14,090/Z       6.1%
                                            10 W 66th St. Apt. 33A
                                            New York, NY 10023-6213

  New York Money Market Series............                   --                         --             --

  Pennsylvania Series.....................  Dr. Mark J. Sey &                             5,939/C       5.3%
                                            Mrs. Merle L Sey JT TEN
                                            2143 Mount Vernon St
                                            Philadelphia, PA 19130-3133

                                            Mr. Edward Dress &                           10,693/C       9.5%
                                            Mrs. Marion M. Dress JT TEN
                                            151 Forest Rd
                                            Mountain Top, PA 18707-1316

                                            Mr. Rudolph J. Peischler                      6,333/C       5.6%
                                            3243 Old Post Rd
                                            Slatington, PA 18080-3209

                                            Mr. Trueman Helms TTEE                       13,338/C      11.9%
                                            Nichols Family 1998 Trust
                                            UA DTD 12-12-98
                                            1035 Boulder Hill Rd
                                            Green Lane, PA 18504
</Table>


                                      A-4
<Page>


<Table>
<Caption>
FUND NAME                                               REGISTRATION               SHARES/CLASS     PERCENT
- ---------                                   ------------------------------------  ---------------   --------
<S>                                         <C>                                   <C>               <C>
NMF.......................................  Worldwide Fowarders Inc.                     35,255/C       9.2%
                                            9706 SW 155th CT
                                            Miami, FL 33196-3830

                                            Pro. Pay LLC                                 19,355/Z       6.2%
                                            10300 W. 103rd St, Ste 303
                                            Overland Park, KS 66214

                                            Mrs. Audrey L. Wittmann TTEE                 16,801/Z       5.4%
                                            Julius & Audrey Wittmann Trust
                                            UA DTD 06/28/83
                                            3351 257th CT SE
                                            Sammamish, WA 98075

                                            Principia C                                  29,885/Z       9.6%
                                            C/O Northshore Capital Mgmt
                                            11621 Kew Gardens Ave, Ste 210
                                            Palm Bch Gdns, FL 33410

STBF

  Prudential Short-Term Corporate Bond      Prudential Retirement Services              224,555/Z       5.0%
    Fund..................................  As nominee for TTEE Cust 300215
                                            Sierra Health Automatic
                                            PO Box 9999
                                            Scranton, PA 18507

  Dryden Ultra Short Bond Fund............  Jeff Filmore                                400,059/A       7.8%
                                            87 Lothrop St.
                                            Beverly, MA 01951

                                            Mr. George Perkins Jr.                      409,899/A       8.0%
                                            PO Box 388
                                            Park City, UT 84060

                                            Prudential Securities C/F                   291,459/A       5.7%
                                            Dr. Herbert Kasnetz
                                            IRA Rollover DTD 4-4-02
                                            3883 Turtle Creek BLVD
                                            APT# 1411
                                            Dallas, TX 75219

                                            Mrs. Mary Jo Schlomann                      433,211/A       8.4%
                                            EST Mrs. Frances Morris
                                            805 Taylor Rd
                                            Downingtown, PA 19335

                                            Mr. Alvin E. McQuinn                        300,111/A       5.8%
                                            C/O Quinstar Investment Ptnrs
                                            5201 Eden Ave, STE 350
                                            Minneapolis, MN 55436

                                            Prudential Securities C/F                     8,950/B       9.3%
                                            Mr. Thomas F. Dougherty
                                            IRA DTD 11-16-99
                                            331 Williams St
                                            Pittsfield, MA 01201

                                            Mr. Jacques Bouvard                           5,969/B       6.2%
                                            Ms. Marguerite A. Bouvard Jt Ten
                                            6 Brookfield Cir
                                            Wellesley, MA 02481
</Table>


                                      A-5
<Page>


<Table>
<Caption>
FUND NAME                                               REGISTRATION               SHARES/CLASS     PERCENT
- ---------                                   ------------------------------------  ---------------   --------
<S>                                         <C>                                   <C>               <C>
                                            Jean R. Dickey                                9,711/B      10.1%
                                            PO Box 279
                                            W. Friendship, MD 21794

                                            Prudential Securities C/F                     6,313/B       6.5%
                                            Mrs. Marion M. Wolfert
                                            IRA DTD 05-16-02
                                            618 Wayland Rd
                                            Plymouth Mtng, PA 19462

                                            New Psalmist Baptist Church                  34,372/B      35.6%
                                            Line of Credit Account
                                            4501 1/2 Frederick Rd
                                            Baltimore, MD 21229

                                            Richard R. Surles                             9,377/B       9.7%
                                            Patricia A. Surles Com. Prop.
                                            3656 Angeles Rd
                                            Santa Maria, CA 93455

                                            Mr. Kevin S. Pitts                            4,664/C      49.9%
                                            Mrs. Linda M. Pitts Co-TTEES
                                            FBO Dana Cleary Pitts Trust
                                            Declaration UA DTD 9-24-96
                                            1627 Highland Dr
                                            Newport Beach, CA 92660

                                            Mr. Kevin S. Pitts                            4,664/C      49.9%
                                            Mrs. Linda M. Pitts Co-TTEES
                                            Allison Christin Pitts Trust
                                            Declaration UA DTD 9-24-96
                                            1627 Highland Dr
                                            Newport Beach, CA 92660

                                            Ms. Janet L. Filipowski TTEE                200,144/Z       6.2%
                                            Janet L. Filipowski Trust
                                            UA DTD 6-7-96
                                            1513 Burning Tree Ct
                                            Lisle, IL 60532

TRBF......................................  Stanton Trust Co Cust For                 1,031,018/Z      19.6%
                                            State of Hawaii Deferred
                                            Compensation Plan
                                            3405 Annapolis Lane N# 100
                                            Plymouth, MN 55447

                                            Summership & Co C/F                         417,628/Z       7.9%
                                            Moderate W14D
                                            Attn: Hector Camacho
                                            100 Franklin St
                                            Boston, MA 02110

                                            Prudential Retirement Services            1,312,969/Z      25.0%
                                            Nominee For Trustee PI W68700
                                            Prudential Securities Inc.
                                            PO Box 5310
                                            Scranton, PA 18505
</Table>


                                      A-6
<Page>


<Table>
<Caption>
FUND NAME                                               REGISTRATION               SHARES/CLASS     PERCENT
- ---------                                   ------------------------------------  ---------------   --------
<S>                                         <C>                                   <C>               <C>
                                            Prudential Retirement Services              392,426/Z       7.5%
                                            As Nominee for TTEE Cust S3000047
                                            Pinnacle Health System
                                            PO Box 9999
                                            Scranton, PA 18507
</Table>


                                      A-7
<Page>`

func TestASCIIFundRegistrationOwnership(t *testing.T) {
	rows, _, _ := ExtractText(asciiFundRegistrationFixture, Row{})
	rows = ScreenRows(rows)
	if len(rows) != 62 {
		t.Errorf("want all 62 literal registration holdings, got %d: %+v", len(rows), rows)
	}
	for _, want := range []struct {
		name, class string
		shares, pct float64
	}{
		{"Pershing LLC", "CMF | California Series | Class C", 20251, 10.0},
		{"SEI Trust Company", "CMF | California Income Series | Class Z", 175893, 31.7},
		{"Prudential Retirement Services As Nominee For Plan 326812 Farm Fresh Retirement Plan", "GIF | Class Z", 712249, 6.1},
		{"Prudential Retirement Services Nominee For Trustee PI W68700 Prudential Securities Inc.", "HYF | Class Z", 4443962, 38.1},
		{"Prudential Retirement Services As nominee for TTEE Cust 300215 Sierra Health Automatic", "STBF | Prudential Short-Term Corporate Bond Fund | Class Z", 224555, 5.0},
		{"Kevin S. Pitts Mrs. Linda M. Pitts Co-TTEES FBO Dana Cleary Pitts Trust Declaration UA DTD 9-24-96", "STBF | Dryden Ultra Short Bond Fund | Class C", 4664, 49.9},
		{"Kevin S. Pitts Mrs. Linda M. Pitts Co-TTEES Allison Christin Pitts Trust Declaration UA DTD 9-24-96", "STBF | Dryden Ultra Short Bond Fund | Class C", 4664, 49.9},
		{"Stanton Trust Co Cust For State of Hawaii Deferred Compensation Plan", "TRBF | Class Z", 1031018, 19.6},
		{"Prudential Retirement Services As Nominee for TTEE Cust S3000047 Pinnacle Health System", "TRBF | Class Z", 392426, 7.5},
	} {
		r := find(rows, want.name, want.class)
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.Percent == nil || *r.Percent != want.pct || r.TableKind != "5pct_holders" {
			t.Errorf("missing literal registered holding %s / %s shares=%v percent=%v: %+v", want.name, want.class, want.shares, want.pct, r)
			for _, actual := range rows {
				if actual.Shares != nil && *actual.Shares == want.shares {
					t.Logf("ACTUAL_REGISTRATION %+v", actual)
				}
			}
		}
	}
	seen := map[string]bool{}
	for _, r := range rows {
		sig := r.HolderName + "|" + r.ShareClass
		if seen[sig] {
			t.Errorf("duplicate registration identity %s", sig)
		}
		seen[sig] = true
	}
}

func TestASCIIFundRegistrationGuards(t *testing.T) {
	first := asciiFundRegistrationFixture[:strings.Index(asciiFundRegistrationFixture, "</Table>")+len("</Table>")]
	for _, tc := range []struct{ name, old, replacement string }{
		{"currency is not shares", "20,251/C", "$20,251/C"},
		{"malformed grouping", "20,251/C", "20,25/C"},
		{"class required", "20,251/C", "20,251"},
		{"percent required", "10.0%", "unknown"},
		{"registration caption required", "REGISTRATION", "COMPENSATION"},
		{"share caption required", "SHARES/CLASS", "DOLLARS/CLASS"},
		{"currency cannot be holder", "Pershing LLC", "$10,001-$50,000"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows, _, _ := ExtractText(strings.Replace(first, tc.old, tc.replacement, 1), Row{})
			if len(ScreenRows(rows)) != 0 {
				t.Fatalf("invalid registered holdings accepted: %+v", rows)
			}
		})
	}
	t.Run("exact copies stay suppressed", func(t *testing.T) {
		row := "  California Series.......................  Pershing LLC                                 20,251/C      10.0%"
		body := strings.Replace(first, row, row+"\n"+row, 1)
		rows, _, _ := ExtractText(body, Row{})
		rows = ScreenRows(rows)
		if len(rows) != 8 {
			t.Fatalf("want 8 unique holdings, got %d: %+v", len(rows), rows)
		}
	})
	t.Run("nonzero legacy preserved", func(t *testing.T) {
		body := `<TABLE><CAPTION>SECURITY OWNERSHIP OF CERTAIN BENEFICIAL OWNERS
Name of Beneficial Owner       Shares Owned       Percent of Class
<S>                            <C>                <C>
Alex Example                   100,000            12.0%
Blair Example                  200,000            24.0%
</TABLE>
` + first
		rows, _, _ := ExtractText(body, Row{})
		rows = ScreenRows(rows)
		if len(rows) != 2 || find(rows, "Alex Example", "") == nil || find(rows, "Pershing LLC", "") != nil {
			t.Fatalf("registration retry changed legacy-emitting filing: %+v", rows)
		}
	})
	t.Run("fund identity cannot cross unrelated prose", func(t *testing.T) {
		continuation := asciiFundRegistrationFixture[strings.LastIndex(asciiFundRegistrationFixture, "<Table>"):]
		rows, _ := textFundRegistrationCounts(first+"\nUnrelated disclosure begins here.\n"+continuation, Row{})
		rows = ScreenRows(rows)
		if len(rows) != 8 {
			t.Fatalf("fund identity leaked into unrelated table: %d %+v", len(rows), rows)
		}
	})
}

func TestASCIIFundRegistrationWrappedStubPersists(t *testing.T) {
	body := `<Table>
<Caption>
FUND NAME                                               REGISTRATION               SHARES/CLASS     PERCENT
- ---------                                   ------------------------------------  ---------------   --------
<S>                                         <C>                                   <C>               <C>
STBF
  Prudential Short-Term Corporate Bond      Prudential Retirement Services              224,555/Z       5.0%
    Fund..................................  As nominee for TTEE Cust 300215
                                            Sierra Health Automatic
                                            PO Box 9999
                                            Scranton, PA 18507

                                            Registered Account Two                       449,110/Z      10.0%
</Table>`
	rows, _, _ := ExtractText(body, Row{})
	rows = ScreenRows(rows)
	r := find(rows, "Registered Account Two", "STBF | Prudential Short-Term Corporate Bond Fund | Class Z")
	if len(rows) != 2 || r == nil || r.Shares == nil || *r.Shares != 449110 || r.Percent == nil || *r.Percent != 10 {
		t.Fatalf("wrapped fund stub must persist for next account: %+v", rows)
	}
}

const asciiBioFundCountsFixture = `<TABLE>
<CAPTION>
                                                                                          SHARES
                                                    BUSINESS EXPERIENCE                  OF FUND
      NAME, ADDRESS AND AGE(1)                  DURING THE PAST FIVE YEARS               OWNED(2)
      ------------------------                  --------------------------               --------
<S>                                    <C>                                            <C>
Martin E. Zweig* ....................  Chairman of the Board and President of the          93,823(3)
  900 Third Avenue                     Fund since 1986; President of Zweig
  New York, New York 10022               Consulting LLC (the "Sub-Adviser") and
  57                                     Phoenix-Zweig Trust; Chairman of the Board
                                         and President of The Zweig Total Return
                                         Fund, Inc. since 1988; Managing Director of
                                         Zweig-DiMenna Associates LLC; President of
                                         Zweig-DiMenna International Managers Inc.,
                                         Zweig-DiMenna Associates, Inc. and Gotham
                                         Advisors, Inc.; Shareholder, Watermark
                                         Securities, Inc.; formerly President and
                                         Director of Zweig Total Return
                                         Advisors, Inc. and of Zweig Advi-
                                         sors, Inc.; formerly Chairman of
                                         Zweig/Glaser Advisers and Euclid Advisors
                                         LLC; Member of the Undergraduate Executive
                                         Board of The Wharton School, University of
                                         Pennsylvania; Trustee of the Manhattan
                                         Institute.
Charles H. Brunie ...................  Director of the Fund since 1998; Director of           30,000
  21 Elm Rock Road                     The Zweig Total Return Fund, Inc. since 1988;
  Bronxville, NY 10708                   Chairman Emeritus of Oppenheimer Capital;
  69                                     and Chairman Emeritus, Board of Trustees of
                                         the Manhattan Institute.
Elliot S. Jaffe .....................  Director of the Fund since 1988; Director of        12,400(4)
  30 Dunnigan Drive                    The Zweig Total Return Fund, Inc. since 1988;
  Suffern, NY 10901                      Chairman and Chief Executive Officer of The
  73                                     Dress Barn, Inc.; Director of National
                                         Retail Federation; Director of Shearson
                                         Appreciation Fund; Director of Shearson
                                         Managed Governments, Inc.; Director of
                                         Shearson Income Trust; Director of Shearson
                                         Lehman Small Capitalization Fund; Director
                                         of Stamford Hospital Foundation; Member of
                                         the Board of Overseers of The School of
                                         Arts and Sciences, University of
                                         Pennsylvania; Trustee Teachers College,
                                         Columbia University.
</TABLE>

                                       2
<PAGE>

<TABLE>
<CAPTION>
                                                                                          SHARES
                                                    BUSINESS EXPERIENCE                  OF FUND
      NAME, ADDRESS AND AGE(1)                  DURING THE PAST FIVE YEARS               OWNED(2)
      ------------------------                  --------------------------               --------
<S>                                    <C>                                            <C>
Alden C. Olson ......................  Director of the Fund since 1996; Director of         2,000(5)
  2711 Ramparte Path                   The Zweig Total Return Fund, Inc. since 1996;
  Holt, Michigan 48842                   Chartered Financial Analyst; formerly
  71                                     Director of First National Bank of
                                         Michigan; formerly Professor of Financial
                                         Management, Investments at Michigan State
                                         University.
James B. Rogers, Jr. ................  Director of the Fund since 1986; Director of            4,449
  352 Riverside Drive                  The Zweig Total Return Fund, Inc. since 1988;
  New York, NY 10025                     Private Investor; Chairman of Beeland
  57                                     Interests; Regular Commentator on CNBC;
                                         Author of "Investment Biker: On the Road
                                         with Jim Rogers"; Director of Emerging
                                         Markets Brewery Fund; Director of Levco
                                         Series Trust; Sometimes Visiting Professor
                                         at Columbia University; Columnist for WORTH
                                         Magazine.
Anthony M. Santomero ................  Director of the Fund since 1986; Director of            3,000
  Steinberg-Dietrich Hall              The Zweig Total Return Fund, Inc. since 1988;
  Wharton School                         Richard K. Mellon Professor of Finance, The
  University of Pennsylvania             Wharton School, University of Pennsylvania;
  Philadelphia, PA 19104                 Director of Wharton Financial Institution
  53                                     Center; Trustee of Blackrock Funds;
                                         formerly Director of Municipal Fund for New
                                         York Investors; formerly Director of
                                         Municipal Fund for California Investors;
                                         formerly Trustee of Compass Capital Funds.
</TABLE>`

const asciiBioOwnedCountsFixture = `<TABLE>
<CAPTION>
                                                                                                    Number of
                                                                                                      Shares
  Name, Age, Position with                                 Principal Occupations and               Beneficially
the Fund and Business Address                   Other Affiliations During the Past Five Years          Owned
- -----------------------------                   -----------------------------------------------    -------------
<S>                                             <C>                                                <C>
James S. Holbrook, Jr.(*),                      Chairman of the Board and CEO of Sterne,               8,000(**)
59, Chairman of the Board,                      Agee & Leach, Inc., the managing underwriter
Trustee and President since 1999,               for the fund's initial public offering,
800 Shades Creek Parkway,                       since 1990 and Co-Chairman of the Board and
Suite 700                                       CEO of its holding company, Sterne, Agee &
Birmingham, Alabama 35209                       Leach Group, Inc. ("SAL Group"), since SAL
                                                Group's formation in 1996. Mr. Holbrook
                                                serves as the Chairman of the Board for each
                                                of SAL Group's other subsidiaries, which
                                                include the investment advisor to the fund,
                                                Sterne Agee Asset Management, Inc., and the
                                                custodian of the fund, The Trust Company of
                                                Sterne, Agee & Leach, Inc.

Robert M. Couch,                                Executive Vice President of New South                      -0-
47, Trustee since 1999,                         Bancshares, Inc. since 1994; President of New
1900 Crestwood Boulevard,                       South Federal Savings Bank since June 1997;
Birmingham, AL 35210                            Director of New South Federal Savings Bank
                                                since January 1995; Vice Chairman of New South
                                                Federal Savings Bank from March 1995 until June
                                                1997; President of Collateral Mortgage Ltd.
                                                since August 1995; and Executive Vice President
                                                of Collateral Mortgage, Ltd. from October 1993
                                                to August 1995.
</TABLE>

                                       2

<PAGE>

<TABLE>
<S>                                              <C>                                                     <C>
James A. Taylor                                  Chairman of the Board and Chief Executive               -0-
62, Trustee since 1999,                          Officer of The Banc Corporation, a Delaware
17 North 20th Street,                            bank holding company based in Birmingham,
Birmingham, Alabama 35203                        Alabama since its incorporation in April
                                                 1998; President of The Banc Corporation
                                                 since its incorporation in April 1998 until
                                                 November 1998 and from February 1999 until
                                                 September 2000; Chairman of the Board,
                                                 President and Chief Executive Officer of
                                                 Warrior Capital Corporation, an Alabama
                                                 banking corporation from October 1997 until
                                                 its merger into The Banc Corporation in
                                                 September 1998; Founder, Chairman of the
                                                 Board and Chief Executive Officer of Alabama
                                                 National BanCorporation ("ANB"), a
                                                 publicly-traded bank holding company based
                                                 in Birmingham, Alabama from its
                                                 incorporation in 1986 until his retirement
                                                 in April 1996; Chairman of the Board and
                                                 Chief Executive Officer of various banks and
                                                 bank holding companies that ultimately
                                                 comprised ANB from 1981 until 1996. Mr.
                                                 Taylor also currently serves on the Board of
                                                 Directors of Southern Energy Homes, Inc.

F. Eugene Woodham(*),                            Chief Operating Officer of SAL Group since              -0-
52, Secretary and Treasurer since 1999,          2002, Chief Financial Officer of SAL Group
800 Shades Creek Parkway,                        from 1996 to 2002 and Sterne, Agee & Leach,
Suite 700                                        Inc., the managing underwriter for the
Birmingham, Alabama 35209                        fund's initial public offering, from 1995 to
                                                 2002. Mr. Woodham serves on the Board of
                                                 Directors for each of SAL Group's other
                                                 subsidiaries, which include the investment
                                                 advisor to the fund, Sterne Agee Asset
                                                 Management, Inc., and the custodian of the
                                                 fund, The Trust Company of Sterne, Agee &
                                                 Leach, Inc. For the nine years prior to
                                                 1995, Mr. Woodham served in various
                                                 capacities with Secor Bank, Federal Savings
                                                 Bank, most recently as President and
                                                 Chairman of the Board of Directors (after
                                                 its acquisition by Regions Bank in 1993).
</TABLE>`

func TestASCIIBiographyCountOnlyColumns(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		count      int
		holdings   map[string]float64
	}{
		{"business experience, fund counts", asciiBioFundCountsFixture, 6, map[string]float64{
			"Martin E. Zweig": 93823, "Charles H. Brunie": 30000, "Elliot S. Jaffe": 12400,
			"Alden C. Olson": 2000, "James B. Rogers, Jr": 4449, "Anthony M. Santomero": 3000,
		}},
		{"number beneficially owned, page continuation", asciiBioOwnedCountsFixture, 4, map[string]float64{
			"James S. Holbrook, Jr": 8000, "Robert M. Couch": 0, "James A. Taylor": 0, "F. Eugene Woodham": 0,
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows, _, _ := ExtractText(tc.body, Row{})
			rows = ScreenRows(rows)
			if len(rows) != tc.count {
				t.Errorf("want %d literal holdings, got %d: %+v", tc.count, len(rows), rows)
			}
			for name, shares := range tc.holdings {
				r := find(rows, name, "")
				if r == nil || r.Shares == nil || *r.Shares != shares || r.Percent != nil || r.PctMarker != "" || r.ShareClass != "" || r.TableKind != "management" {
					t.Errorf("missing literal count-only holder %s shares=%v: %+v", name, shares, r)
				}
			}
		})
	}
}

const asciiBioCountBeforeNameFixture = `<TABLE>
<CAPTION>
                                                                                       Number of
                                                                                        Shares
Name, Age, Position with                      Principal Occupations and              Beneficially
the Fund and Business Address      Other Affiliations During the Past Five Years         Owned
- -----------------------------      ----------------------------------------------    -------------
<S>                                <C>                                               <C>
James S. Holbrook, Jr.(*),         Chairman of the Board and CEO of Sterne, Agee &     7,700(**)
57, Chairman of the Board,         Leach, Inc., the managing underwriter for the
Trustee and President,             fund's initial public offering, since 1990 and
800 Shades Creek Parkway,          Co-Chairman of the Board and CEO of its holding
Suite 700                          company, Sterne, Agee & Leach Group, Inc. ("SAL
Birmingham, Alabama 35209          Group"), since SAL Group's formation in 1996. Mr.
                                   Holbrook serves as the Chairman of the Board for
                                   each of SAL Group's other subsidiaries, which
                                   include the investment advisor to the fund, Sterne
                                   Agee Asset Management, Inc., and the custodian of
                                   the fund, The Trust Company of Sterne, Agee &
                                   Leach, Inc. Mr. Holbrook also serves as a director
                                   for Bobby Allison Wireless Corporation.
                                                                                          -0-
Robert M. Couch,                   Executive Vice President of New South Bancshares,
44, Trustee,                       Inc. since 1994; President of New South Federal
1900 Crestwood Boulevard,          Savings Bank since June 1997; Director of New
Birmingham, AL 35210               South Federal Savings Bank since January 1995;
                                   Vice Chairman of New South Federal Savings Bank
                                   from March 1995 until June 1997; President of
                                   Collateral Mortgage Ltd. since August 1995; and
                                   Executive Vice President of Collateral Mortgage,
                                   Ltd. from October 1993 to August 1995.
</TABLE>


                                       2
<PAGE>   5

<TABLE>
<S>                                <C>                                                    <C>
James A. Taylor                    Chairman of the Board and Chief Executive              -0-
59, Trustee,                       Officer of The Banc Corporation, a Delaware
17 North 20th Street,              bank holding company based in Birmingham,
Birmingham, Alabama 35203          Alabama since its incorporation in April 1998;
                                   President of The Banc Corporation since its
                                   incorporation in April 1998 until November 1998;
                                   Chairman of the Board, President and Chief
                                   Executive Officer of Warrior Capital Corporation,
                                   an Alabama banking corporation from October 1997
                                   until its merger into The Banc Corporation in
                                   September 1998; Founder, Chairman of the Board and
                                   Chief Executive Officer of Alabama National
                                   BanCorporation ("ANB"), a publicly-traded bank
                                   holding company based in Birmingham, Alabama from
                                   its incorporation in 1986 until his retirement in
                                   April 1996; Chairman of the Board and Chief Executive
                                   Officer of various banks and bank holding companies
                                   that ultimately comprised ANB from 1981 until 1996.
                                   Mr. Taylor also currently serves on the Board of
                                   Directors of the American Sports Medicine Institute
                                   and Southern Energy Homes, Inc.

F. Eugene Woodham(*),              Chief Financial Officer of Sterne, Agee &              -0-
49, Secretary and Treasurer,       Leach, Inc., the managing underwriter for the
800 Shades Creek Parkway,          fund's initial public offering, since 1995 and
Suite 125                          its holding company SAL Group, since SAL
Birmingham, Alabama 35209          Group's formation in 1996. Mr. Woodham serves
                                   on the Board of Directors for each of SAL Group's
                                   other subsidiaries, which include the investment
                                   advisor to the fund, Sterne Agee Asset Management,
                                   Inc., and the custodian of the fund, The Trust
                                   Company of Sterne, Agee & Leach, Inc. For the nine
                                   years prior to 1995, Mr. Woodham served in various
                                   capacities with Secor Bank, Federal Savings Bank,
                                   most recently as President and Chairman of the
                                   Board of Directors (after its acquisition by Regions
                                   Bank in 1993).
</TABLE>`

func TestASCIIBiographyCountPrecedesName(t *testing.T) {
	rows, _, _ := ExtractText(asciiBioCountBeforeNameFixture, Row{})
	rows = ScreenRows(rows)
	if len(rows) != 4 {
		t.Errorf("want4 literal biography counts, got%d: %+v", len(rows), rows)
	}
	for _, want := range []struct {
		name   string
		shares float64
	}{
		{"James S. Holbrook, Jr", 7700}, {"Robert M. Couch", 0}, {"James A. Taylor", 0}, {"F. Eugene Woodham", 0},
	} {
		r := find(rows, want.name, "")
		if r == nil || r.Shares == nil || *r.Shares != want.shares || r.Percent != nil || r.PctMarker != "" {
			t.Errorf("missing forward count %s shares=%v: %+v", want.name, want.shares, r)
		}
	}
}
func TestASCIIBiographyCountOnlyGuards(t *testing.T) {
	for _, tc := range []struct{ name, old, replacement string }{
		{"dollar ranges", "OF FUND", "DOLLAR RANGE"},
		{"currency", "93,823", "$93,823"},
		{"missing share caption", "SHARES", "AGE"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := strings.ReplaceAll(asciiBioFundCountsFixture, tc.old, tc.replacement)
			rows, _, _ := ExtractText(body, Row{})
			if tc.name == "currency" {
				for _, r := range ScreenRows(rows) {
					if r.HolderName == "Martin E. Zweig" {
						t.Fatalf("currency accepted: %+v", r)
					}
				}
			} else if len(ScreenRows(rows)) != 0 {
				t.Fatalf("nonownership biography accepted: %+v", rows)
			}
		})
	}
}

const asciiDelayedPercent1997Fixture = `Name and Address of              Amount and Nature
Beneficial Owner and             of Beneficial                 Percent of
Identity of Group (1)(2)         Ownership                     Class
- - ------------------------         -----------------             ----------

Richard D. Fain                         31,200(3)                   *

Kenneth J. Huth                         58,550(4)                   *

Andrew A. Lozyniak                      36,000(5)                   *

John U. Moorhead, II                    72,600(6)                 1.2%

Mark Pinto                              44,000(7)                   *

Frank J. Polese                        452,834(8)                 7.4%

Gilbert D. Raker                       786,775(9)                12.7%

Steven B. Sands                        190,750(10)                3.1%


All executive officers               1,690,529(11)               26.6%
and Directors as a group
(10 persons)



- - --------------------
`

const asciiDelayedPercent1998Fixture = `Name and Address of                 Amount and Nature
Beneficial Owner and                of Beneficial                Percent of
Identity of Group (1)(2)            Ownership                    Class

Richard D. Fain (3)                         33,700                  *

Kenneth J. Huth (4)                         58,550                  *

Andrew A. Lozyniak (5)                      49,075                  *

John U. Moorhead, II (6)                    75,100                  1.2%

Mark A. Pinto (7)                           51,500                  *

Frank J. Polese (8)                        454,734                  7.4%

Gilbert D. Raker (9)                       798,775                 12.9%

Steven B. Sands (10)                       253,250                  4.2%

All executive officers                   1,774,684                 27.8%
and Directors as a group
(8 persons) (11)

Kennedy Capital                            323,900(a)              5.3%
10829 Olive Boulevard
St. Louis, Missouri 63141

- --------------------
`

func TestASCIIDelayedStackedPercentHeader(t *testing.T) {
	for _, tc := range []struct {
		name, body  string
		count       int
		shares, pct float64
	}{
		{"1997", asciiDelayedPercent1997Fixture, 9, 1690529, 26.6},
		{"1998", asciiDelayedPercent1998Fixture, 10, 1774684, 27.8},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows, _, _ := ExtractText(tc.body, Row{})
			rows = ScreenRows(rows)
			if len(rows) != tc.count {
				t.Errorf("want %d literal holdings, got %d: %+v", tc.count, len(rows), rows)
			}
			r := find(rows, "Richard D. Fain", "")
			if r == nil || r.Shares == nil || (tc.name == "1997" && *r.Shares != 31200) || (tc.name == "1998" && *r.Shares != 33700) || r.PctMarker != "*" {
				t.Errorf("missing first literal holding: %+v", r)
			}
			found := false
			for _, r := range rows {
				if r.IsGroupRow && r.Shares != nil && *r.Shares == tc.shares && r.Percent != nil && *r.Percent == tc.pct && ((tc.name == "1997" && r.GroupN == 10) || (tc.name == "1998" && r.GroupN == 8)) {
					found = true
				}
			}
			if !found {
				t.Errorf("missing literal wrapped group shares=%v pct=%v: %+v", tc.shares, tc.pct, rows)
			}
		})
	}
}

func TestASCIIDelayedStackedPercentGuards(t *testing.T) {
	for _, tc := range []struct{ name, old, replacement string }{
		{"missing percent", "Percent of", "Salary"},
		{"missing ownership", "Ownership", "Compensation"},
		{"currency values", "31,200", "$31,200"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := strings.ReplaceAll(asciiDelayedPercent1997Fixture, tc.old, tc.replacement)
			rows, _, _ := ExtractText(body, Row{})
			if tc.name == "currency values" {
				for _, r := range ScreenRows(rows) {
					if r.HolderName == "Richard D. Fain" {
						t.Fatalf("currency emitted: %+v", r)
					}
				}
			} else if len(ScreenRows(rows)) != 0 {
				t.Fatalf("invalid caption emitted: %+v", rows)
			}
		})
	}
}

const asciiCaptionOccupationCountsFixture = `<TABLE>
<CAPTION>
                                                                                                     COMMON
                                                                                                  SHARES OF THE
                                                                                                   ASSOCIATION
                                                                                                  BENEFICIALLY
                                         AGE AT                                                     OWNED AT
                                      DECEMBER 31,                                      TRUSTEE    JANUARY 2,
                NAME                      1997             PRINCIPAL OCCUPATION          SINCE       1998(A)
                ----                  ------------         --------------------         -------   -------------
<S>                                   <C>            <C>                                <C>       <C>
Russell A. Boss (F,P)                      59        President and Chief Executive       1989          1,000(b)
                                                     Officer, A.T. Cross Company
                                                     (writing instruments
                                                     manufacturer), Lincoln, Rhode
                                                     Island
John D. Carney                             53        Executive Vice President of the       --         10,734(c)
                                                     Association
Paul J. Choquette, Jr. (C,F)               59        Chairman and Chief Executive        1992          2,137(f)
                                                     Officer of Gilbane Building
                                                     Company (building construction),
                                                     Providence, Rhode Island
Peter S. Damon (A,C)                       62        President and Chief Executive       1991          1,190(d)
                                                     Officer, Bank of Newport,
                                                     Newport, Rhode Island
Peter B. Freeman (F,P)                     65        Corporate Director and Trustee,     1979          2,500
                                                     Providence, Rhode Island
Clifford J. Hebert, Jr.                    50        Treasurer and Secretary               --         11,879(c)
Larry A. Liebenow (A,C)                    54        President and Chief Executive       1994          1,000
                                                     Officer of Quaker Fabric
                                                     Corporation (upholstery
                                                     manufacturer), Fall River,
                                                     Massachusetts
Jacek Makowski (F,P)                       67        Chairman, Poseidon Resources        1995            200
                                                     Corporation (origination and
                                                     development of major capital
                                                     projects), Stamford, Connecticut
Wesley W. Marple, Jr. (A,C)                65        Professor of Business               1976          1,885(e)
                                                     Administration, Northeastern
                                                     University, Boston, Massachusetts
Donald G. Pardus                           57        Chairman of the Board of Trustees   1982         49,725(c)
                                                     and Chief Executive Officer of
                                                     the Association
Robert G. Powderly                         50        Executive Vice President of the       --         14,789(c)
                                                     Association
Margaret M. Stapleton (A,P)                61        Vice President, John Hancock        1977          1,577
                                                     Mutual Life Insurance Company,
                                                     Boston, Massachusetts
John R. Stevens                            57        President and Chief Operating       1990         28,068(c)
                                                     Officer of the Association
W. Nicholas Thorndike (A,F)                64        Corporate Director and Trustee,     1991          2,146
                                                     Brookline, Massachusetts
Trustees and executive officers as a group.....................................................      128,832(g)
</TABLE>`

const asciiCaptionDirectorClassCountsFixture = `<TABLE>
<CAPTION>

                                                                                     AMOUNT AND NATURE
                                                                                       OF BENEFICIAL
                                                                                       OWNERSHIP(2)
      NAME, AGE, PRINCIPAL OCCUPATION AND OTHER          SERVED AS A               OF SHARES OF THE FUND
     DIRECTORSHIPS(1) DURING THE PAST FIVE YEARS        DIRECTOR SINCE   CLASS     AS OF MARCH 31, 1997
- ------------------------------------------------------  --------------   -----   -------------------------
<S>                                                     <C>              <C>     <C>
Thomas J. Gibbons, age 49.............................       1993         III                 --
  President, Cornerstone Associates (Management
  Consulting Firm)

Harvey B. Kaplan(3), age 59...........................       1990         III              1,000
  Controller (Chief Financial Officer), Easter
  Unlimited, Inc. (toy manufacturer and importer);
  Trustee, BJB Investment Funds

Bernard Spilko*, age 55...............................       1993         III              2,300
  President of the Fund; Senior Vice President, Bank
  Julius Baer & Co., Ltd. (New York Branch); Director
  and Managing Director, Julius Baer Securities Inc.;
  Director, Baer American Banking Corp.; Treasurer and
  Chief Financial Officer of BJB Investment Funds


Martin Vogel*(4), age 33..............................       1997          I                  --
  Director of the Legal and Tax Department, Julius
  Baer Investment Funds Services, Ltd. (Zurich)
  (1996-present); Attorney, Schaufelberger & van
  Hoboken (1994-1996); Attorney, Rohner & Partner
  (1993-1994); Attorney, Rinderknecht Schaufelberger
  Glaus & Stadelhofer (prior to 1993). Secretary of
  the Board of Directors of the Luxembourg domiciled
  investment companies and of Julius Baer Investment
  Funds Services, Ltd. (1996-present)
</TABLE>

     The following Directors of the Fund will continue to serve in such capacity
until their terms of office expire and their successors are elected and
qualified:


<TABLE>
<CAPTION>
                                                                                    AMOUNT AND NATURE
                                                                                OF BENEFICIAL OWNERSHIP(2)
      NAME, AGE, PRINCIPAL OCCUPATION AND OTHER         SERVED AS A               OF SHARES OF THE FUND
     DIRECTORSHIPS(1) DURING THE PAST FIVE YEARS       DIRECTOR SINCE   CLASS      AS OF MARCH 31, 1997
- -----------------------------------------------------  --------------   -----   --------------------------
<S>                                                    <C>              <C>     <C>
Antoine Bernheim, age 43.............................       1990          I                   --
  President, Dome Capital Management Inc.; Chairman,
  Dome Securities Corp. (1995-present); President,
  The U.S. Offshore Funds Directory Inc.; Director,
  Dome Capital Ltd.; Director, W. P. Stewart & Co.
  Growth Fund, Inc.; Director, College Savings Bank

David E. Bodner*(5), age 63..........................       1995         II                  200
  Chairman of the Fund; Chairman, Julius Baer
  Securities Inc.; President and Director, Baer
  American Banking Corp.; Executive Vice President,
  North America, Bank Julius Baer & Co., Ltd.;
  President, BJB Investment Funds

Lawrence A. Fox, age 74..............................       1990         II               677.81
  Consulting Economist
</TABLE>`

func TestASCIICaptionCountOnlyOccupations(t *testing.T) {
	for _, tc := range []struct {
		name, body string
		count      int
		holdings   map[string]float64
	}{
		{"separate age and trustee year", asciiCaptionOccupationCountsFixture, 15, map[string]float64{"Russell A. Boss": 1000, "John D. Carney": 10734, "W. Nicholas Thorndike": 2146, "Trustees and executive officers as a group": 128832}},
		{"inline age and director class", asciiCaptionDirectorClassCountsFixture, 7, map[string]float64{"Thomas J. Gibbons": 0, "Harvey B. Kaplan": 1000, "Bernard Spilko": 2300, "Martin Vogel": 0, "Antoine Bernheim": 0, "David E. Bodner": 200, "Lawrence A. Fox": 677.81}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			rows, _, _ := ExtractText(tc.body, Row{})
			rows = ScreenRows(rows)
			if len(rows) != tc.count {
				t.Errorf("want%d literal counts, got%d: %+v", tc.count, len(rows), rows)
			}
			for name, shares := range tc.holdings {
				r := find(rows, name, "")
				if r == nil || r.HolderName != name || r.Shares == nil || *r.Shares != shares || r.Percent != nil || r.PctMarker != "" || r.ShareClass != "" {
					t.Errorf("missing literal holder %s shares=%v: %+v", name, shares, r)
				}
			}
			if tc.name == "separate age and trustee year" {
				r := find(rows, "Trustees and executive officers as a group", "")
				if r == nil || !r.IsGroupRow {
					t.Error("literal group not flagged")
				}
			}
		})
	}
}

func TestASCIICaptionCountOnlyGuards(t *testing.T) {
	for _, tc := range []struct{ name, old, replacement string }{
		{"currency", "10,734", "$10,734"},
		{"missing share caption", "SHARES", "AGE"},
		{"missing beneficial caption", "BENEFICIALLY", "COMPENSATION"},
		{"option grants", "COMMON", "OPTIONS GRANTED"},
		{"missing biography structure", "PRINCIPAL OCCUPATION", "POSITION"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := strings.ReplaceAll(asciiCaptionOccupationCountsFixture, tc.old, tc.replacement)
			rows, _, _ := ExtractText(body, Row{})
			if len(ScreenRows(rows)) != 0 {
				t.Fatalf("nonownership caption emitted: %+v", rows)
			}
		})
	}
	body := asciiCaptionOccupationCountsFixture + `
SUMMARY COMPENSATION TABLE
<TABLE><CAPTION>
Name                     Salary        Bonus
<S>                      <C>           <C>
Jane Example             $125,000      $25,000
John Example             $175,000      $30,000
</TABLE>`
	rows, _, _ := ExtractText(body, Row{})
	if len(ScreenRows(rows)) != 15 {
		t.Fatalf("adjacent compensation changes bounded count table: %+v", rows)
	}
	plain := Row{HolderName: "Lawrence A. Fox", Shares: pf(677.81), TableKind: "management"}
	if len(ScreenRows([]Row{plain})) != 0 {
		t.Fatal("unverified fractional row screen weakened")
	}
}
