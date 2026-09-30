package main

// One test per numbered Design rule in the plan, plus the traps the design
// profile names explicitly: the firm literally called "Founders Fund", a
// "Managing Director" at Credit Suisse, page furniture inside a bio, a name
// split across text blocks, the colspan column misalignment, Netflix's
// "Key Employees" block, and extraction bounded to the MANAGEMENT section
// rather than the document.

import (
	"regexp"
	"strings"
	"testing"

	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
)

// ---------------------------------------------------------------------------
// Rule 1 — the management-table predicate, and columns by content
// ---------------------------------------------------------------------------

// sgmlDoc wraps a body as one EDGAR document of the given type, closers
// included, so PrimaryDocument's lazy <DOCUMENT>/<TEXT> pairing sees a real
// pair rather than falling through to "the whole file".
func sgmlDoc(docType, body string) string {
	return "<DOCUMENT>\n<TYPE>" + docType + "\n<SEQUENCE>1\n<FILENAME>d.htm\n<TEXT>\n" +
		body + "\n</TEXT>\n</DOCUMENT>\n"
}

const sgmlHeader = "<SEC-HEADER>0000000000-00-000000.hdr.sgml : 20000101\n" +
	"ACCESSION NUMBER:\t\t0000000000-00-000000\n" +
	"CONFORMED SUBMISSION TYPE:\t424B4\n" +
	"FILED AS OF DATE:\t\t20000101\n" +
	"</SEC-HEADER>\n"

// A three-person management table in the plain 3-column shape.
const miniMgmtSection = `<P ALIGN="center"><B>MANAGEMENT</B></P>
<P><B>Executive Officers and Directors</B></P>
<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>Ada Lovelace</TD><TD>36</TD><TD>Chief Executive Officer and Director</TD></TR>
<TR><TD>Grace Hopper</TD><TD>45</TD><TD>Chief Financial Officer</TD></TR>
<TR><TD>Alan Turing</TD><TD>41</TD><TD>Director</TD></TR>
</TABLE>
<P><I>Ada Lovelace</I> has served as our Chief Executive Officer since 1843.</P>
<P><I>Grace Hopper</I> has served as our Chief Financial Officer since 1951.</P>
<P><I>Alan Turing</I> has served as a member of our board of directors since 1936.</P>`

func TestRule1_ManagementSectionIsRequired(t *testing.T) {
	// The same person-shaped table, but no MANAGEMENT heading anywhere: a
	// document-wide table walk would still find it.
	body := `<HTML><BODY><P ALIGN="center"><B>RISK FACTORS</B></P>
<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>Ada Lovelace</TD><TD>36</TD><TD>Chief Executive Officer and Director</TD></TR>
<TR><TD>Grace Hopper</TD><TD>45</TD><TD>Chief Financial Officer</TD></TR>
<TR><TD>Alan Turing</TD><TD>41</TD><TD>Director</TD></TR>
</TABLE></BODY></HTML>`
	e := ExtractManagement([]byte(sgmlHeader + sgmlDoc("424B4", body)))
	if e.Filing.Status != StatusNoMgmtSection {
		t.Errorf("status = %q, want %q", e.Filing.Status, StatusNoMgmtSection)
	}
	if len(e.Persons) != 0 {
		t.Errorf("extracted %d persons from a document with no MANAGEMENT section: %v",
			len(e.Persons), personNames(e))
	}
}

func TestRule1_ProseTableIsNotAManagementTable(t *testing.T) {
	// Header words match, but there are only two body rows and neither carries a
	// bare two-digit number. The profile measured 5 such candidates in Facebook,
	// 13 in Uber and 8 in Netflix.
	body := `<HTML><BODY><P ALIGN="center"><B>MANAGEMENT</B></P>
<P>The following summarises our approach.</P>
<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>Our executive team</TD><TD>varies</TD><TD>See the discussion below</TD></TR>
<TR><TD>Our board</TD><TD>varies</TD><TD>See the discussion below</TD></TR>
</TABLE></BODY></HTML>`
	e := ExtractManagement([]byte(sgmlHeader + sgmlDoc("424B4", body)))
	if e.Filing.Status != StatusNoMgmtTable {
		t.Errorf("status = %q, want %q", e.Filing.Status, StatusNoMgmtTable)
	}
	if len(e.Persons) != 0 {
		t.Errorf("extracted %d persons from a prose table: %v", len(e.Persons), personNames(e))
	}
}

// gridOf parses an HTML fragment and returns the Grid of its first <table>, so
// the tests below can put ONE condition of Design rule 1 to the predicate the
// production path uses — isMgmtTable, the same function mgmtSection calls — rather
// than to the whole extraction. Going through ExtractManagement cannot isolate a
// condition: gridRows independently requires a plausible age per row and main's
// `len(persons)==0` fallback returns no_mgmt_table anyway, so a table the
// predicate wrongly ACCEPTED still yields the expected status and the assertion
// sleeps through the break.
func gridOf(t *testing.T, fragment string) *Grid {
	t.Helper()
	doc, err := html.Parse(strings.NewReader("<HTML><BODY>" + fragment + "</BODY></HTML>"))
	if err != nil {
		t.Fatalf("parsing fragment: %v", err)
	}
	var found *html.Node
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if found != nil {
			return
		}
		if n.Type == html.ElementNode && n.DataAtom == atom.Table {
			found = n
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(doc)
	if found == nil {
		t.Fatal("fragment carries no <table>")
	}
	return buildGrid(found)
}

// Design rule 1 is a conjunction — header names Age and (Position or Title), at
// least three rows, and at least half the body rows carry a bare two-digit
// number. One case per condition, each violating exactly that condition and
// satisfying the others, so a mutation that drops any single condition fails here
// and nowhere else.
func TestRule1_PredicateConditionsAreIsolated(t *testing.T) {
	cases := []struct {
		name      string
		fragment  string
		want      bool
		condition string
	}{
		{
			name:      "header and ages good but only two body rows",
			condition: "the row-count threshold",
			want:      false,
			fragment: `<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>Ada Lovelace</TD><TD>36</TD><TD>Chief Executive Officer and Director</TD></TR>
<TR><TD>Grace Hopper</TD><TD>45</TD><TD>Chief Financial Officer</TD></TR>
</TABLE>`,
		},
		{
			name:      "four body rows but only one carries a two-digit age",
			condition: "the age-majority threshold",
			want:      false,
			fragment: `<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>Ada Lovelace</TD><TD>36</TD><TD>Chief Executive Officer and Director</TD></TR>
<TR><TD>Our executive team</TD><TD>varies</TD><TD>See the discussion below</TD></TR>
<TR><TD>Our board</TD><TD>varies</TD><TD>See the discussion below</TD></TR>
<TR><TD>Our advisers</TD><TD>varies</TD><TD>See the discussion below</TD></TR>
</TABLE>`,
		},
		{
			name:      "header says Title rather than Position",
			condition: "the Title header alternative",
			want:      true,
			fragment: `<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Title</TD></TR>
<TR><TD>Ada Lovelace</TD><TD>36</TD><TD>Chief Executive Officer and Director</TD></TR>
<TR><TD>Grace Hopper</TD><TD>45</TD><TD>Chief Financial Officer</TD></TR>
<TR><TD>Alan Turing</TD><TD>41</TD><TD>Director</TD></TR>
</TABLE>`,
		},
		{
			name:      "header names no Age column",
			condition: "the Age header requirement",
			want:      false,
			fragment: `<TABLE>
<TR><TD>Name</TD><TD>Years</TD><TD>Position</TD></TR>
<TR><TD>Ada Lovelace</TD><TD>36</TD><TD>Chief Executive Officer and Director</TD></TR>
<TR><TD>Grace Hopper</TD><TD>45</TD><TD>Chief Financial Officer</TD></TR>
<TR><TD>Alan Turing</TD><TD>41</TD><TD>Director</TD></TR>
</TABLE>`,
		},
		{
			name:      "every condition satisfied",
			condition: "the positive control",
			want:      true,
			fragment: `<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>Ada Lovelace</TD><TD>36</TD><TD>Chief Executive Officer and Director</TD></TR>
<TR><TD>Grace Hopper</TD><TD>45</TD><TD>Chief Financial Officer</TD></TR>
<TR><TD>Alan Turing</TD><TD>41</TD><TD>Director</TD></TR>
</TABLE>`,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			g := gridOf(t, c.fragment)
			hdr, got := isMgmtTable(g)
			if got != c.want {
				t.Errorf("isMgmtTable = %v (hdr=%d), want %v: %s is not enforced",
					got, hdr, c.want, c.condition)
			}
			if c.want && hdr != 0 {
				t.Errorf("header row = %d, want 0", hdr)
			}
		})
	}
}

// The Title-header variant must survive the whole extraction, not only the
// predicate: a pre-2001 filing whose header reads Name | Age | Title is the
// variant Design rule 1 names the alternative for.
func TestRule1_TitleHeaderExtractsThroughTheFullPath(t *testing.T) {
	body := "<HTML><BODY>" +
		strings.Replace(miniMgmtSection, "<TD>Position</TD>", "<TD>Title</TD>", 1) +
		"</BODY></HTML>"
	if strings.Contains(body, "<TD>Position</TD>") {
		t.Fatal("the Position header cell was not replaced; this test is not exercising the Title branch")
	}
	e := ExtractManagement([]byte(sgmlHeader + sgmlDoc("424B4", body)))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q for a Name | Age | Title header", e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 3 {
		t.Errorf("len(persons) = %d, want 3: %v", len(e.Persons), personNames(e))
	}
}

func TestRule1_MiniSectionExtracts(t *testing.T) {
	// The positive control for the two negatives above: the same predicate must
	// accept a real three-row Name/Age/Position table.
	e := ExtractManagement([]byte(sgmlHeader + sgmlDoc("424B4", "<HTML><BODY>"+miniMgmtSection+"</BODY></HTML>")))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 3 {
		t.Fatalf("len(persons) = %d, want 3: %v", len(e.Persons), personNames(e))
	}
	if got := squash(e.Filing.CEOName); got != "Ada Lovelace" {
		t.Errorf("ceo_name = %q, want %q", got, "Ada Lovelace")
	}
	if p := person(t, e, "Grace Hopper"); p.Age != 45 {
		t.Errorf("Grace Hopper age = %d, want 45", p.Age)
	}
}

// The prospectus is one document among many, and it is not always first:
// PrimaryDocument must select it by <TYPE>, not by position (Design: sgml.go's
// proxyTypes widened to the 424 / S-1 / F-1 family).
func TestRule1_ProspectusSelectedByTypeNotPosition(t *testing.T) {
	raw := sgmlHeader +
		sgmlDoc("GRAPHIC", "begin 644 g12345.jpg\nM0V]D92!F<F]M('1H92!G<F%P:&EC(&1O8W5M96YT+@``\nend") +
		sgmlDoc("424B4", "<HTML><BODY>"+miniMgmtSection+"</BODY></HTML>")
	e := ExtractManagement([]byte(raw))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q (the 424B4 is the second document, not the first)",
			e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 3 {
		t.Errorf("len(persons) = %d, want 3: %v", len(e.Persons), personNames(e))
	}
}

// Facebook / Snap / Uber put the age at compacted body index 2 while the header
// row's cells land at 0/1/3 — a colspan artefact. A grid mapped by header index
// reads every age as empty.
func TestRule1_ColspanColumnMisalignment(t *testing.T) {
	cases := []struct {
		fixture string
		name    string
		age     int
		pos     string
	}{
		{"facebook.txt", "Mark Zuckerberg", 27, "Chairman and CEO"},
		{"facebook.txt", "Erskine B. Bowles", 66, "Director"},
		{"snap.txt", "Evan Spiegel", 26, "Co-Founder, Chief Executive Officer, and Director"},
		{"snap.txt", "Christopher Young", 44, "Director"},
		{"uber.txt", "Dara Khosrowshahi", 49, "Chief Executive Officer and Director"},
		{"uber.txt", "David Trujillo", 43, "Director"},
	}
	for _, c := range cases {
		t.Run(c.fixture+"/"+c.name, func(t *testing.T) {
			p := person(t, extractFixture(t, c.fixture), c.name)
			if p.Age != c.age {
				t.Errorf("age = %d, want %d", p.Age, c.age)
			}
			if got := squash(p.Position); got != c.pos {
				t.Errorf("position = %q, want %q", got, c.pos)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Rule 2 — section rows label the rows beneath them; Key Employees is neither
// ---------------------------------------------------------------------------

func TestRule2_SectionRowsAreNotPersons(t *testing.T) {
	for _, fixture := range []string{"snap.txt", "uber.txt", "airbnb.txt", "netflix.txt"} {
		t.Run(fixture, func(t *testing.T) {
			e := extractFixture(t, fixture)
			for _, bad := range []string{
				"Executive Officers:", "Non-Employee Directors:", "Key Employees",
				"Executive Officers", "Non-Employee Directors",
				"Executive Officers and Directors",
			} {
				if p, ok := findPerson(e, bad); ok {
					t.Errorf("section row %q became a person row (age=%d position=%q)",
						bad, p.Age, p.Position)
				}
			}
		})
	}
}

func TestRule2_SectionRowLabelsTheRowsBeneathIt(t *testing.T) {
	cases := []struct {
		fixture, name, section string
	}{
		{"snap.txt", "Evan Spiegel", SectionOfficer},
		{"snap.txt", "Imran Khan", SectionOfficer},
		{"snap.txt", "Michael Lynton", SectionDirector},
		{"snap.txt", "Mitchell Lasky", SectionDirector},
		{"uber.txt", "Nelson Chai", SectionOfficer},
		{"uber.txt", "Matt Cohler", SectionDirector},
		{"airbnb.txt", "Dave Stephenson", SectionOfficer},
		{"airbnb.txt", "Ann Mather", SectionDirector},
	}
	for _, c := range cases {
		t.Run(c.fixture+"/"+c.name, func(t *testing.T) {
			p := person(t, extractFixture(t, c.fixture), c.name)
			if p.Section != c.section {
				t.Errorf("section = %q, want %q (position=%q)", p.Section, c.section, squash(p.Position))
			}
		})
	}
}

// Netflix's third block. Marc Randolph — the actual co-founder — sits in it,
// and a "every row of the table" rule silently counts him as an officer.
func TestRule2_KeyEmployeesAreNeitherOfficerNorDirector(t *testing.T) {
	e := extractFixture(t, "netflix.txt")
	keyEmployees := []string{
		"Marc B. Randolph", "Neil Hunt", "J. Mitchell Lowe",
		"Patricia J. McCord", "Michael Osier", "Ted Sarandos", "David Hyman",
	}
	for _, name := range keyEmployees {
		p := person(t, e, name)
		if p.Section != SectionKeyEmployee {
			t.Errorf("%s: section = %q, want %q", name, p.Section, SectionKeyEmployee)
		}
	}
	for _, name := range []string{"Reed Hastings", "W. Barry McCarthy, Jr.", "Leslie J. Kilgore"} {
		if p := person(t, e, name); p.Section != SectionOfficer {
			t.Errorf("%s: section = %q, want %q", name, p.Section, SectionOfficer)
		}
	}
	for _, name := range []string{"Timothy M. Haley", "Jay C. Hoag", "Michael N. Schuh"} {
		if p := person(t, e, name); p.Section != SectionDirector {
			t.Errorf("%s: section = %q, want %q", name, p.Section, SectionDirector)
		}
	}
	if e.Filing.NOfficers+e.Filing.NDirectors != 10 {
		t.Errorf("n_officers+n_directors = %d, want 10 (the Key Employees block must not be counted)",
			e.Filing.NOfficers+e.Filing.NDirectors)
	}
}

// Google and Facebook carry no section rows at all, so officer vs director has
// to come from the Position text.
func TestRule2_NoSectionRowsFallsBackToPositionText(t *testing.T) {
	cases := []struct {
		fixture, name, section string
	}{
		{"google.txt", "Eric Schmidt", SectionOfficer},
		{"google.txt", "Omid Kordestani", SectionOfficer},
		{"google.txt", "L. John Doerr", SectionDirector},
		{"facebook.txt", "Sheryl K. Sandberg", SectionOfficer},
		{"facebook.txt", "Theodore W. Ullyot", SectionOfficer},
		{"facebook.txt", "Peter A. Thiel", SectionDirector},
		{"facebook.txt", "Donald E. Graham", SectionDirector},
	}
	for _, c := range cases {
		t.Run(c.fixture+"/"+c.name, func(t *testing.T) {
			p := person(t, extractFixture(t, c.fixture), c.name)
			if p.Section != c.section {
				t.Errorf("section = %q, want %q (position=%q)", p.Section, c.section, squash(p.Position))
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Rule 3 — name normalisation
// ---------------------------------------------------------------------------

func TestRule3_NameNormalisation(t *testing.T) {
	cases := []struct {
		fixture  string
		name     string // the normalised Name the row must carry
		rawHas   string // a marker the unnormalised cell still carries
	}{
		{fixture: "facebook.txt", name: "Marc L. Andreessen", rawHas: "(1)"},
		{fixture: "facebook.txt", name: "Donald E. Graham", rawHas: "*"},
		{fixture: "facebook.txt", name: "James W. Breyer", rawHas: "(2)"},
		{fixture: "snap.txt", name: "Michael Lynton", rawHas: "(1)"},
		{fixture: "airbnb.txt", name: "Brian Chesky", rawHas: "(4)"},
		{fixture: "uber.txt", name: "Ronald Sugar", rawHas: "(1)"},
		{fixture: "netflix.txt", name: "Timothy M. Haley", rawHas: "(1)"},
		{fixture: "ebay.txt", name: "Scott D. Cook", rawHas: ".."}, // dot leaders
		{fixture: "ebay.txt", name: "Robert C. Kagle", rawHas: "(1)"},
	}
	for _, c := range cases {
		t.Run(c.fixture+"/"+c.name, func(t *testing.T) {
			e := extractFixture(t, c.fixture)
			p := person(t, e, c.name) // fails outright if Name was left unnormalised
			if squash(p.Name) != c.name {
				t.Errorf("name = %q, want %q", squash(p.Name), c.name)
			}
			if !strings.Contains(p.NameRaw, c.rawHas) {
				t.Errorf("name_raw = %q, want it to preserve %q as the filing wrote it",
					p.NameRaw, c.rawHas)
			}
		})
	}
}

// Every name in the 1998 ASCII table arrives padded with dot leaders; none of
// them may survive into Name.
func TestRule3_AsciiDotLeadersStripped(t *testing.T) {
	e := extractFixture(t, "ebay.txt")
	if len(e.Persons) == 0 {
		t.Fatal("no persons extracted from the ASCII fixture")
	}
	for _, p := range e.Persons {
		if strings.Contains(p.Name, "..") {
			t.Errorf("name = %q still carries dot leaders", p.Name)
		}
		if regexp.MustCompile(`\(\d\)`).MatchString(p.Name) {
			t.Errorf("name = %q still carries a committee marker", p.Name)
		}
	}
}

// ---------------------------------------------------------------------------
// Rule 4 — bios found by the table's own names
// ---------------------------------------------------------------------------

func TestRule4_BioLeadInConventions(t *testing.T) {
	cases := []struct {
		fixture, name, wantIn string
	}{
		// "<Name> has served as ..." — the pre-2010 form.
		{"google.txt", "Eric Schmidt", "has served as our Chief Executive Officer since July 2001"},
		{"netflix.txt", "Reed Hastings", "Chairman of the Board since inception"},
		{"ebay.txt", "Margaret C. Whitman",
			"has served as President and Chief Executive Officer of the Company since February 1998"},
		// "<Name>. Mr. <Surname> ..." — the post-2015 form.
		{"snap.txt", "Evan Spiegel", "Mr. Spiegel is our co-founder"},
		{"uber.txt", "Matt Cohler", "a venture capital firm, since 2008"},
		// A name split across two text blocks.
		{"uber.txt", "Dara Khosrowshahi",
			"Mr. Khosrowshahi has served as our Chief Executive Officer and as a member of our board of directors since September 2017"},
		{"airbnb.txt", "Brian Chesky", "co-founded our company in 2008"},
		{"airbnb.txt", "Nathan Blecharczyk", "co-founded our company in 2008"},
	}
	for _, c := range cases {
		t.Run(c.fixture+"/"+c.name, func(t *testing.T) {
			p := person(t, extractFixture(t, c.fixture), c.name)
			if !strings.Contains(squash(p.Bio), squash(c.wantIn)) {
				t.Errorf("bio does not carry %q\n  bio = %q", c.wantIn, trunc(p.Bio))
			}
		})
	}
}

// Uber's CEO bio is interrupted by a page break: the page number "209" and a
// "Table of Contents" link sit between two halves of the same paragraph. The
// splitter must drop the furniture and keep reading, not stop at it.
func TestRule4_PageFurnitureInsideABio(t *testing.T) {
	p := person(t, extractFixture(t, "uber.txt"), "Dara Khosrowshahi")
	bio := squash(p.Bio)

	const afterTheBreak = "IAC/InterActiveCorp from January 2002 to January 2005"
	if !strings.Contains(bio, afterTheBreak) {
		t.Errorf("bio stops at the page break: it does not carry %q\n  bio = %q", afterTheBreak, trunc(bio))
	}
	if strings.Contains(bio, "Table of Contents") {
		t.Errorf("bio carries the page-break link %q\n  bio = %q", "Table of Contents", trunc(bio))
	}
	if regexp.MustCompile(`(^|\s)209(\s|$)`).MatchString(bio) {
		t.Errorf("bio carries the bare page number 209\n  bio = %q", trunc(bio))
	}
}

// Forty Seven's page breaks carry TWO jump links, not one: "Table of Contents"
// and, beneath it, "Index to Financial Statements". The second is also the name
// of a real top-level section, so a section scan that reads it as a heading
// closes MANAGEMENT at the first page break — three paragraphs in — and nine of
// the eleven people lose their bio. Every VC director in this filing sits past
// that break.
func TestRule4_FinancialStatementsJumpLinkIsPageFurniture(t *testing.T) {
	e := extractFixture(t, "fortyseven.txt")
	for _, p := range e.Persons {
		if strings.TrimSpace(p.Bio) == "" {
			t.Errorf("%s has no bio: the section was cut short at a page break\n  names=%v",
				squash(p.Name), personNames(e))
		}
		if containsFold(p.Bio, "Index to Financial Statements") {
			t.Errorf("%s's bio carries the page-break jump link\n  bio = %q", squash(p.Name), trunc(p.Bio))
		}
	}
	for _, want := range []vcWant{
		{"Jeffrey W. Bird, M.D.", "Sutter Hill"},
		{"Ian T. Clark", "Clarus"},
		{"Christopher J. Schaepe", "Lightspeed"},
	} {
		p := person(t, e, want.name)
		if !p.VCAffiliated {
			t.Errorf("%s: vc_affiliated = false, want true (bio=%q)", want.name, trunc(p.Bio))
			continue
		}
		if !containsFold(p.VCFirm, want.firm) {
			t.Errorf("%s: vc_firm = %q, want it to name %q", want.name, p.VCFirm, want.firm)
		}
	}
}

// A bio must belong to its own person. Google runs nine bios back to back; if
// the splitter keys on a lead-in pattern rather than the table's name list, one
// bio swallows the next.
func TestRule4_BiosDoNotBleedIntoEachOther(t *testing.T) {
	e := extractFixture(t, "google.txt")
	schmidt := squash(person(t, e, "Eric Schmidt").Bio)
	if schmidt == "" {
		t.Fatal("Eric Schmidt has no bio")
	}
	for _, other := range []string{"one of our founders", "Kleiner Perkins", "Sequoia Capital"} {
		if strings.Contains(schmidt, other) {
			t.Errorf("Schmidt's bio has absorbed %q from a later bio\n  bio = %q", other, trunc(schmidt))
		}
	}
	doerr := squash(person(t, e, "L. John Doerr").Bio)
	if !strings.Contains(doerr, "General Partner of Kleiner Perkins") {
		t.Errorf("Doerr's bio does not carry his own firm\n  bio = %q", trunc(doerr))
	}
	if strings.Contains(doerr, "Sequoia Capital") {
		t.Errorf("Doerr's bio has absorbed Moritz's firm\n  bio = %q", trunc(doerr))
	}
}

// ---------------------------------------------------------------------------
// Rule 5 — extraction is bounded to the MANAGEMENT section
// ---------------------------------------------------------------------------

// Google's prospectus appends the roadshow transcript and a Playboy interview,
// both of which say "CEO" and could say "founder". This appends a block of
// exactly that shape AFTER the verbatim MANAGEMENT fixture (the fixture's own
// bytes are untouched) and asserts nothing in it reaches the result.
func TestRule5_ExtractionIsBoundedToTheManagementSection(t *testing.T) {
	base := extractFixture(t, "google.txt")

	trap := `
<P><B>TRANSCRIPT OF THE ROADSHOW PRESENTATION</B></P>
<P>My name is Eric Schmidt and I am the CEO of Google. I am our founder and a co-founder of our company.</P>
<P><B>PLAYBOY INTERVIEW</B></P>
<P>PLAYBOY: Who ultimately decides what is evil? Eric Schmidt, your CEO, is one of our founders.</P>
<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>Hugh M. Hefner</TD><TD>78</TD><TD>Interviewer, Founder and Chief Executive Officer</TD></TR>
<TR><TD>Roadshow Host</TD><TD>45</TD><TD>Director</TD></TR>
<TR><TD>Playboy Reader</TD><TD>33</TD><TD>Director</TD></TR>
</TABLE>
<P><I>Hugh M. Hefner</I> has served as our founder since 1953. Mr. Hefner has been a General Partner of Bunny Ventures, a venture capital firm, since 1953.</P>
`
	e := ExtractManagement(append(fixtureBytes(t, "google.txt"), []byte(trap)...))

	if len(e.Persons) != len(base.Persons) {
		t.Errorf("len(persons) = %d with the appended transcript, want %d; names=%v",
			len(e.Persons), len(base.Persons), personNames(e))
	}
	for _, bad := range []string{"Hugh M. Hefner", "Roadshow Host", "Playboy Reader"} {
		if _, ok := findPerson(e, bad); ok {
			t.Errorf("%q from outside the MANAGEMENT section became a person row", bad)
		}
	}
	if got := squash(e.Filing.CEOName); got != "Eric Schmidt" {
		t.Errorf("ceo_name = %q, want %q", got, "Eric Schmidt")
	}
	if e.Filing.CEOFounderSelfDescribed {
		t.Errorf("ceo_founder_self_described = true: founder language from the roadshow transcript leaked in (evidence=%q)",
			e.Filing.CEOFounderEvidence)
	}
	if p := person(t, e, "Eric Schmidt"); p.FounderSelfDescribed {
		t.Errorf("Eric Schmidt founder_self_described = true (evidence=%q)", p.FounderEvidence)
	}
}

// ---------------------------------------------------------------------------
// Rule 6 — founder_self_described: own position cell or own bio, same-company
// ---------------------------------------------------------------------------

func TestRule6_FounderFiresOnOwnPositionCell(t *testing.T) {
	// eBay states founder status only in the table: "Founder, Chairman of the
	// Board and a director". Snap and Airbnb do the same with "Co-Founder".
	cases := []struct{ fixture, name string }{
		{"ebay.txt", "Pierre M. Omidyar"},
		{"snap.txt", "Evan Spiegel"},
		{"snap.txt", "Robert Murphy"},
		{"airbnb.txt", "Joseph Gebbia"},
	}
	for _, c := range cases {
		t.Run(c.fixture+"/"+c.name, func(t *testing.T) {
			p := person(t, extractFixture(t, c.fixture), c.name)
			if !p.FounderSelfDescribed {
				t.Errorf("founder_self_described = false, want true (position=%q)", squash(p.Position))
			}
		})
	}
}

// The plan names five specific instances that must NOT fire, plus the firm
// name. Each is a live sentence in its fixture — and `trap` is that sentence
// verbatim, asserted present in the person's OWN bio before the flag is judged.
// Without that half, the case is vacuous: bio.go leaving Bio empty for exactly
// these five names also yields founder_self_described = false, so the negative
// assertion would pass while the detector never saw the trap language at all.
func TestRule6_FounderOfAnotherCompanyDoesNotFire(t *testing.T) {
	cases := []struct {
		fixture, name, trap string
	}{
		{"ebay.txt", "Howard D. Schultz", "is the founder of Starbucks Corp"},
		{"ebay.txt", "Scott D. Cook", "is the founder of Intuit Inc."},
		{"netflix.txt", "Michael N. Schuh", "was a founder and Chief Executive Officer of Intrinsa Corporation"},
		{"facebook.txt", "Marc L. Andreessen", "is a co-founder and has been a General Partner of Andreessen Horowitz"},
		{"facebook.txt", "Erskine B. Bowles", "was a founder of Kitty Hawk Capital"},
		{"facebook.txt", "Peter A. Thiel", "has been a Partner of Founders Fund"},
	}
	for _, c := range cases {
		t.Run(c.fixture+"/"+c.name, func(t *testing.T) {
			p := person(t, extractFixture(t, c.fixture), c.name)
			if !containsFold(p.Bio, c.trap) {
				t.Errorf("bio does not carry the trap sentence %q, so the founder detector is not being exercised on it\n  bio = %q",
					c.trap, trunc(p.Bio))
			}
			if p.FounderSelfDescribed {
				t.Errorf("founder_self_described = true because of %q; want false (evidence=%q)",
					c.trap, p.FounderEvidence)
			}
		})
	}
}

// Peter Thiel's firm is literally named "Founders Fund". A founder-token regex
// hits the firm name. (The trap-sentence guard for him lives in the table above;
// this pins the firm-name token itself, which is the mutation that matters here.)
func TestRule6_FirmNamedFoundersFundDoesNotFire(t *testing.T) {
	p := person(t, extractFixture(t, "facebook.txt"), "Peter A. Thiel")
	if p.FounderSelfDescribed {
		t.Errorf("founder_self_described = true, want false (evidence=%q)", p.FounderEvidence)
	}
	if !containsFold(p.Bio, "Founders Fund") {
		t.Errorf("bio does not carry the firm name, so this case is not being exercised\n  bio = %q",
			trunc(p.Bio))
	}
}

// The documented floor: Reed Hastings IS a Netflix co-founder, and his 2002 bio
// says only "Chairman of the Board since inception". The variable is
// "self-described founder", so this must read false — and ceo_since_inception
// is the column that records why.
func TestRule6_NetflixFounderFloorIsRecordedNotGuessed(t *testing.T) {
	e := extractFixture(t, "netflix.txt")
	if e.Filing.CEOFounderSelfDescribed {
		t.Errorf("ceo_founder_self_described = true, want false (evidence=%q)", e.Filing.CEOFounderEvidence)
	}
	if !e.Filing.CEOSinceInception {
		t.Errorf("ceo_since_inception = false, want true: Hastings' bio says %q",
			"Chairman of the Board since inception")
	}
	if !containsFold(e.Filing.CEOSinceText, "inception") {
		t.Errorf("ceo_since_text = %q, want it to quote the \"since inception\" phrasing",
			e.Filing.CEOSinceText)
	}
}

// Google's founders are marked in their own bios ("one of our founders"), not
// in the table and not in the CEO's bio.
func TestRule6_FounderFiresOnOwnBioWithSameCompanyReferent(t *testing.T) {
	e := extractFixture(t, "google.txt")
	for _, name := range []string{"Sergey Brin", "Larry Page"} {
		p := person(t, e, name)
		if !p.FounderSelfDescribed {
			t.Errorf("%s: founder_self_described = false, want true (bio=%q)", name, trunc(p.Bio))
		}
		if !containsFold(p.FounderEvidence, "founder") {
			t.Errorf("%s: founder_evidence = %q, want it to quote the founder language",
				name, p.FounderEvidence)
		}
	}
	if p := person(t, e, "Eric Schmidt"); p.FounderSelfDescribed {
		t.Errorf("Eric Schmidt founder_self_described = true (evidence=%q)", p.FounderEvidence)
	}
}

// ---------------------------------------------------------------------------
// Rule 7 — vc_affiliated
// ---------------------------------------------------------------------------

// The 2002+ appositive.
func TestRule7_VentureCapitalFirmAppositive(t *testing.T) {
	cases := []struct{ fixture, name, firm string }{
		{"google.txt", "L. John Doerr", "Kleiner Perkins"},
		{"google.txt", "Michael Moritz", "Sequoia"},
		{"netflix.txt", "Timothy M. Haley", "Institutional Venture Partners"},
		{"netflix.txt", "Jay C. Hoag", "Technology Crossover Ventures"},
		{"facebook.txt", "James W. Breyer", "Accel"},
		{"snap.txt", "Mitchell Lasky", "Benchmark"},
		{"uber.txt", "Matt Cohler", "Benchmark"},
		{"airbnb.txt", "Alfred Lin", "Sequoia"},
	}
	for _, c := range cases {
		t.Run(c.fixture+"/"+c.name, func(t *testing.T) {
			p := person(t, extractFixture(t, c.fixture), c.name)
			if !p.VCAffiliated {
				t.Fatalf("vc_affiliated = false, want true (bio=%q)", trunc(p.Bio))
			}
			if !containsFold(p.VCFirm, c.firm) {
				t.Errorf("vc_firm = %q, want it to name %q", p.VCFirm, c.firm)
			}
		})
	}
}

// "Managing Director" is a VC signal only when the firm is one. Snap's Imran
// Khan was a Managing Director at Credit Suisse.
func TestRule7_ManagingDirectorOfANonVCFirmDoesNotFire(t *testing.T) {
	p := person(t, extractFixture(t, "snap.txt"), "Imran Khan")
	if p.VCAffiliated {
		t.Errorf("vc_affiliated = true, want false (firm=%q evidence=%q)", p.VCFirm, p.VCEvidence)
	}
	if !containsFold(p.Bio, "Managing Director in the Investment Banking Division at Credit Suisse") {
		t.Errorf("bio does not carry the Credit Suisse sentence, so this case is not being exercised\n  bio = %q",
			trunc(p.Bio))
	}
	// Airbnb's Kenneth Chenault is the positive twin: Managing Director of a
	// firm the filing calls a venture capital firm.
	c := person(t, extractFixture(t, "airbnb.txt"), "Kenneth Chenault")
	if !c.VCAffiliated {
		t.Errorf("Kenneth Chenault vc_affiliated = false, want true (bio=%q)", trunc(c.Bio))
	}
}

// eBay 1998 carries no ", a venture capital firm" appositive anywhere in its
// MANAGEMENT section, so Kagle can only be found through the firm dictionary.
func TestRule7_Pre2000NeedsTheFirmDictionary(t *testing.T) {
	if n := strings.Count(string(fixtureBytes(t, "ebay.txt")), "venture capital firm"); n != 0 {
		t.Fatalf("the eBay fixture carries %d appositives; this test assumed none", n)
	}
	p := person(t, extractFixture(t, "ebay.txt"), "Robert C. Kagle")
	if !p.VCAffiliated {
		t.Errorf("vc_affiliated = false, want true (bio=%q)", trunc(p.Bio))
	}
	if !containsFold(p.VCFirm, "Benchmark") {
		t.Errorf("vc_firm = %q, want it to name Benchmark", p.VCFirm)
	}
}

// Officers are not VC directors, whatever their bios mention.
func TestRule7_NonDirectorsAreNotCountedAsVCDirectors(t *testing.T) {
	for _, fixture := range []string{"google.txt", "facebook.txt", "snap.txt", "uber.txt", "airbnb.txt", "ebay.txt", "netflix.txt"} {
		t.Run(fixture, func(t *testing.T) {
			e := extractFixture(t, fixture)
			for _, p := range e.Persons {
				if p.VCAffiliated && p.VCFirm == "" {
					t.Errorf("%s: vc_affiliated with an empty vc_firm", squash(p.Name))
				}
			}
			if e.Filing.NVCDirectors > e.Filing.NDirectors {
				t.Errorf("n_vc_directors = %d > n_directors = %d", e.Filing.NVCDirectors, e.Filing.NDirectors)
			}
		})
	}
}
