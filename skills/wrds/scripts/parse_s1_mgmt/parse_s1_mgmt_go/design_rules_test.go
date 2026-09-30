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

// sgmlHeaderFor is sgmlHeader plus the FILER block that states the issuer's
// name, which is where the founder referent test gets it. The FORMER CONFORMED
// NAME line is in every case: a header regex that matched it would take a name
// the issuer no longer uses.
func sgmlHeaderFor(conformed string) string {
	return "<SEC-HEADER>0000000000-00-000000.hdr.sgml : 20000101\n" +
		"ACCESSION NUMBER:\t\t0000000000-00-000000\n" +
		"CONFORMED SUBMISSION TYPE:\t424B4\n" +
		"FILED AS OF DATE:\t\t20000101\n" +
		"\nFILER:\n\n\tCOMPANY DATA:\t\n" +
		"\t\tCOMPANY CONFORMED NAME:\t\t\t" + conformed + "\n" +
		"\t\tCENTRAL INDEX KEY:\t\t\t0000000000\n" +
		"\tFORMER COMPANY:\t\n" +
		"\t\tFORMER CONFORMED NAME:\tShell Predecessor Holdings LLC\n" +
		"\t\tDATE OF NAME CHANGE:\t19990101\n" +
		"</SEC-HEADER>\n"
}

// mgmtSectionWithCEOBio is miniMgmtSection with the CEO's bio paragraph replaced.
func mgmtSectionWithCEOBio(bio string) string {
	return strings.Replace(miniMgmtSection,
		"<P><I>Ada Lovelace</I> has served as our Chief Executive Officer since 1843.</P>",
		"<P><I>Ada Lovelace</I> "+bio+"</P>", 1)
}

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

// The table and the bio disagree about how much of the name to print. Four
// spellings measured on the dev split, all of them a director whose bio the
// strict prefix test cannot claim:
//
//	table "Carl Gordon, Ph.D., C.F.A."  bio "Carl L. Gordon, Ph.D., C.F.A. has served ..."
//	                                        (Prevail, 0001193125-19-177602)
//	table "Carl Gordon, Ph.D."          bio "Carl Gordon, CFA, Ph.D . has served ..."
//	                                        (Kinnate, 0001140361-20-027255)
//	table "Robert Goodman"              bio "Robert P. Goodman has served ..."
//	                                        (ACV Auctions, 0001193125-21-092803)
//	table "Bryan E. Roberts, Ph.D."     bio "Bryan E. Roberts has served ..."
//	                                        (Ironwood, 0001047469-10-000546)
//
// Each one costs two disagreements, not one: the block falls through to the
// PRECEDING person, so the VC firm in it is credited to the wrong director and
// the right one is left with no bio at all.
func TestRule4_TheBioSpellsTheNameWithOtherInitialsAndCredentials(t *testing.T) {
	body := `<HTML><BODY><P ALIGN="center"><B>MANAGEMENT</B></P>
<P><B>Executive Officers and Directors</B></P>
<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>Ada Lovelace</TD><TD>36</TD><TD>Chief Executive Officer and Director</TD></TR>
<TR><TD>Timothy Adams</TD><TD>55</TD><TD>Director</TD></TR>
<TR><TD>Carl Gordon, Ph.D., C.F.A.</TD><TD>57</TD><TD>Director</TD></TR>
<TR><TD>Robert Goodman</TD><TD>60</TD><TD>Director</TD></TR>
<TR><TD>Bryan E. Roberts, Ph.D.</TD><TD>44</TD><TD>Director</TD></TR>
</TABLE>
<P>Ada Lovelace has served as our Chief Executive Officer since 1843.</P>
<P>Timothy Adams has served as a member of our board since April 2019. Mr. Adams has served as Chief Financial Officer of ObsEva SA since January 2017.</P>
<P>Carl L. Gordon, Ph.D., C.F.A. has served as a member of our board since August 2017. Dr. Gordon is a founding Partner and Co-Head of Global Private Equity at OrbiMed Advisors, LLC, an investment firm focused on the healthcare sector.</P>
<P>Robert P. Goodman has served as a member of our board of directors since February 2017. Mr. Goodman is a Partner at Bessemer Venture Partners, a venture capital firm which he joined in 1998.</P>
<P>Bryan E. Roberts has served as director since 2001. Dr. Roberts joined Venrock, a venture capital investment firm, in 1997, where he serves as partner.</P>
</BODY></HTML>`
	e := ExtractManagement([]byte(sgmlHeader + sgmlDoc("424B4", body)))

	for _, c := range []struct{ name, wantIn string }{
		{"Carl Gordon, Ph.D., C.F.A.", "OrbiMed Advisors"},
		{"Robert Goodman", "Bessemer Venture Partners"},
		{"Bryan E. Roberts, Ph.D.", "Venrock"},
	} {
		p := person(t, e, c.name)
		if !containsFold(p.Bio, c.wantIn) {
			t.Errorf("%s's bio does not carry %q\n  bio = %q", c.name, c.wantIn, trunc(p.Bio))
		}
	}
	// ... and the person above each of them has not absorbed it.
	for _, c := range []struct{ name, notIn string }{
		{"Timothy Adams", "OrbiMed"},
		{"Carl Gordon, Ph.D., C.F.A.", "Bessemer"},
		{"Robert Goodman", "Venrock"},
	} {
		p := person(t, e, c.name)
		if containsFold(p.Bio, c.notIn) {
			t.Errorf("%s's bio has absorbed %q from the bio beneath it\n  bio = %q",
				c.name, c.notIn, trunc(p.Bio))
		}
	}
	// The whole point of the join: the firm lands on the right director.
	if p := person(t, e, "Timothy Adams"); p.VCAffiliated {
		t.Errorf("Timothy Adams: vc_affiliated = true (firm %q) from a bio that is not his", p.VCFirm)
	}
	for _, want := range []vcWant{
		{"Carl Gordon, Ph.D., C.F.A.", "OrbiMed"},
		{"Robert Goodman", "Bessemer Venture"},
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

// The referent the same-company patterns cannot see: the bio names the issuer
// rather than saying "our company". Ten of the dev split's fifteen
// ceo_founder_self_described misses are this one form — "founded LogMeIn",
// "is the founder of Beyond Meat", "co-founded ExactTarget", "Prior to
// co-founding Twist Bioscience", "musicmaker.com's founder". The issuer name is
// not a guess: the dissemination file's SGML header states it as COMPANY
// CONFORMED NAME, so the referent test stays as strict as the "our company" one.
func TestRule6_FounderFiresOnIssuerNamedByName(t *testing.T) {
	cases := []struct {
		conformed string // COMPANY CONFORMED NAME, verbatim from a real header
		bio       string
	}{
		// The header name in full, after the verb and after the noun.
		{"LogMeIn, Inc.", "Ada Lovelace founded LogMeIn and has served as our Chief Executive Officer since 1843."},
		{"BEYOND MEAT, INC.", "Ada Lovelace is the founder of Beyond Meat and has served as our Chief Executive Officer since 1843."},
		{"ExactTarget Inc", "Ada Lovelace co-founded ExactTarget in December 2000 and has served as our Chief Executive Officer since 1843."},
		{"Twist Bioscience Corp", "Prior to co-founding Twist Bioscience, Ada Lovelace served in various positions at Agilent."},
		{"i3 Verticals, Inc.", "Ada Lovelace has served as our Chief Executive Officer since she founded i3 Verticals, LLC (formerly Charge Payment, LLC) in 2012."},
		// A short form: the bio drops the corporate tail the header carries.
		{"Ladder Capital Corp", "Ada Lovelace is a co-founder of Ladder and has served as our Chief Executive Officer since 1843."},
		{"Ironwood Pharmaceuticals, Inc.", "Prior to founding Ironwood, Ada Lovelace was a research fellow at the Whitehead Institute."},
		// The possessive form.
		{"MUSICMAKER COM INC", "Ada Lovelace is musicmaker.com's founder, Chairman of the Board and Chief Executive Officer."},
	}
	for _, c := range cases {
		t.Run(c.conformed, func(t *testing.T) {
			e := ExtractManagement([]byte(sgmlHeaderFor(c.conformed) +
				sgmlDoc("424B4", "<HTML><BODY>"+mgmtSectionWithCEOBio(c.bio)+"</BODY></HTML>")))
			if e.Filing.Status != StatusOK {
				t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
			}
			p := person(t, e, "Ada Lovelace")
			if !containsFold(p.Bio, "found") {
				t.Fatalf("bio does not carry the founder sentence, so the detector is not exercised\n  bio = %q", p.Bio)
			}
			if !p.FounderSelfDescribed {
				t.Errorf("founder_self_described = false, want true (bio=%q)", p.Bio)
			}
			if !e.Filing.CEOFounderSelfDescribed {
				t.Errorf("ceo_founder_self_described = false, want true")
			}
		})
	}
}

// ... and the reason the issuer-name test cannot be a bare prefix match: a firm
// whose name STARTS with the issuer's first word is a different company.
func TestRule6_FounderOfACompanySharingTheIssuersFirstWordDoesNotFire(t *testing.T) {
	cases := []struct {
		conformed string
		bio       string
	}{
		{"Cascade Microtech Inc", "Ada Lovelace co-founded Cascade Communications Corporation, a networking company, and has served as our Chief Executive Officer since 1843."},
		{"Ladder Capital Corp", "Ada Lovelace is a co-founder of Ladder Industries Limited, a manufacturer, and has served as our Chief Executive Officer since 1843."},
		{"Uber Technologies, Inc", "Prior to Uber, Ada Lovelace founded Red Swoosh, a networking software company, where she served as Chief Executive Officer."},
		// The referent IS the issuer and the subject is a firm the bio has just
		// named: Ceres's 2012 prospectus says its CEO "was a principal at Oxford
		// Bioscience Partners, one of the leading investors in the genomics field
		// and a founder of Ceres". Oxford founded Ceres; he did not.
		{"CERES, INC.", "From 1992 to 1997, Ada Lovelace was a principal at Oxford Bioscience Partners, one of the leading investors in the genomics field and a founder of Ceres."},
	}
	for _, c := range cases {
		t.Run(c.conformed, func(t *testing.T) {
			e := ExtractManagement([]byte(sgmlHeaderFor(c.conformed) +
				sgmlDoc("424B4", "<HTML><BODY>"+mgmtSectionWithCEOBio(c.bio)+"</BODY></HTML>")))
			p := person(t, e, "Ada Lovelace")
			if p.FounderSelfDescribed {
				t.Errorf("founder_self_described = true, want false (evidence=%q)", p.FounderEvidence)
			}
		})
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

// The appositive is not always ", a venture capital firm". Across the dev split
// the same clause is written ", a venture capital fund", ", a venture fund",
// ", a prominent venture capital investment firm" and ", a growth
// equity/late-stage venture capital investment firm" — and the narrow form was
// accidentally doing a second job: because the variants it rejected happen to be
// the ones advisors and ex-partners use, widening it alone bought as many false
// positives as true ones on dev (8 of each). So the variant forms are credited
// only when the bio ALSO puts the person in a partner-grade role at that firm,
// in the present tense.
//
// Bios are quoted verbatim from the accession named on each line; they are
// exercised through detectVC rather than a fixture because none of the seven
// profiled filings carries a variant appositive, and check_full.sh re-cuts every
// fixture from a source filing this corpus does not hold.
func TestRule7_VariantAppositiveNeedsAPresentPartnerGradeRole(t *testing.T) {
	positive := []struct{ accession, bio, firm string }{
		{"0001032210-00-001406",
			"Since August 1997, Mr. Huseby has served as managing partner of SeaPoint Ventures, a venture capital fund focused on communications and Internet infrastructure.",
			"SeaPoint Ventures"},
		{"0001047469-13-010949",
			"Mr. Werner is a co-founder and since 1985 is a General Partner of HealthCare Ventures LLC, a venture capital fund specializing in the health-care industry.",
			"HealthCare Ventures"},
		{"0001047469-16-015606",
			"He is a co-founder and managing partner at Founder Collective, a seed stage venture capital fund.",
			"Founder Collective"},
		{"0001193125-12-126304",
			"Mr. Maxwell has been the Senior Managing Director of OpenView Venture Partners, a venture capital fund with a focus on software, the Internet and technology-enabled companies that he founded, since 2006.",
			"OpenView Venture Partners"},
		{"0001193125-13-395408",
			"Dr. Raffin is a Founder and Partner of Telegraph Hill Partners, a growth equity/late-stage venture capital investment firm focused exclusively on healthcare related companies, since its inception in 2001.",
			"Telegraph Hill Partners"},
		{"0001193125-18-314672",
			"Mr. Conley is a Partner and Managing Director at Paladin Capital Group, a prominent venture capital investment firm, a position he has held since November 2007.",
			"Paladin Capital Group"},
	}
	for _, c := range positive {
		t.Run("yes/"+c.firm, func(t *testing.T) {
			ok, firm, ev := detectVC(c.bio)
			if !ok {
				t.Fatalf("%s: vc_affiliated = false, want true", c.accession)
			}
			if !containsFold(firm, c.firm) {
				t.Errorf("%s: vc_firm = %q, want it to name %q (evidence %q)", c.accession, firm, c.firm, ev)
			}
		})
	}

	// Advisor-grade, an "Investment Director" the gold does not count, a
	// corporate venture fund run inside Merck, a fund headed in a closed
	// 2012-2017 spell, and a partnership the bio puts in the past.
	negative := []struct{ accession, why, bio string }{
		{"0001193125-18-314672", "advisor, not a principal",
			"Mr. Johannessen currently serves as an advisor to iGlobe Partners, a venture capital company. Mr. Johannessen served as Chief Operating Officer and Secretary at Conexant Systems, LLC, a semiconductor company, from May 2013 to August 2017."},
		{"0001193125-18-314672", "Investment Director is not partner-grade",
			"Ms. Mai is an Investment Director of GF Xinde Investment Management Co. Ltd, a venture capital investment firm based in China that specializes in investing in biotechnology companies, a position she has held since June 2015."},
		{"0001193125-20-175569", "Senior Advisor, not a principal",
			"Dr. Nussbaum has also served as a Senior Advisor to Sandbox Industries, a venture fund, since January 2017, and Ontario Teachers' Pension Fund since August 2016."},
		{"0001193125-21-031436", "the partnership is over",
			"Dr. Resnick previously served as a Partner at SV Health Investors from January 2016 to September 2018 and as President and Managing Partner at MRL Ventures Fund, an early-stage therapeutics-focused corporate venture fund that he built and managed within Merck & Co., from 2014 to January 2016."},
		{"0001193125-21-230254", "headed the fund from 2012 to 2017, not now",
			"From September 2012 to October 2017, Dr. Iancovici served as the head of the Qualcomm Life Fund, a venture fund focused on investing in digital health technologies."},
		{"0001047469-14-004991", "was with the firm, and the role is not named",
			"Prior to General Atlantic LLC, Mr. Agrawal was with Lazard Technology Partners, or Lazard, an Internet and technology focused venture capital firm, and previously served in Lazard's investment banking group."},
	}
	for _, c := range negative {
		t.Run("no/"+c.why, func(t *testing.T) {
			if ok, firm, ev := detectVC(c.bio); ok {
				t.Errorf("%s: vc_affiliated = true, want false (firm=%q evidence=%q)", c.accession, firm, ev)
			}
		})
	}
}

// A year is not a firm name. "a co-founder of BOLD Capital Partners in 2015, a
// venture fund investing in exponential technologies" put the appositive after
// the date, and firmBefore credited the firm "2015" (0001193125-21-328157).
func TestRule7_FirmNameIsNeverABareNumber(t *testing.T) {
	const bio = "Dr. Diamandis has started more than 24 companies in the areas of human longevity, " +
		"space, venture capital and education, including as a co-founder of BOLD Capital Partners " +
		"in 2015, a venture fund investing in exponential technologies."
	_, firm, _ := detectVC(bio)
	for _, f := range strings.Split(firm, "; ") {
		if f != "" && strings.IndexFunc(f, func(r rune) bool { return r < '0' || r > '9' }) < 0 {
			t.Errorf("vc_firm = %q credits the bare number %q as a firm", firm, f)
		}
	}
}

// A firm whose own NAME ends in "Venture"/"Ventures" needs no appositive: the
// filing has already said what kind of firm it is. The dictionary route cannot
// reach these because the dictionary is a list of specific firms — "Versant
// Ventures" is in it and "Versant Venture Management, LLC" is not, and neither
// "Quaker BioVentures" nor "Biobank Technology Ventures" ever will be.
//
// The token, not the word "Capital": "Ventures" in a name is evidence, while
// "Capital" is not (Bridgemere Capital, Skoll Engineering). Three guards keep
// the route honest — a past-tense marker in the clause introducing the role, a
// "corporate venture" appositive (gold does not count a fund run inside Merck
// or AstraZeneca), and an "investment committee" seat, which is not a
// partner-grade role at the firm.
//
// Bios are quoted verbatim from the accession named on each line, and exercised
// through detectVC because check_full.sh re-cuts every fixture from a source
// filing this corpus does not hold.
func TestRule7_VentureInTheFirmNameIsTheLabel(t *testing.T) {
	positive := []struct{ accession, bio, firm string }{
		{"0000891618-96-002428",
			"From September 1991 to the present, Mr. Tai has been a general partner of the Walden Group of Venture Capital Funds. Concurrently, from August 1995 to the present, he has been Chairman and Chief Executive Officer of AUNET Corporation.",
			"Walden Group of Venture Capital Funds"},
		{"0000892569-03-002445",
			"Since 1990, Dr. Royston has served as a partner at Forward Ventures, a firm he co-founded, and is currently Managing Member of that firm.",
			"Forward Ventures"},
		{"0000936392-00-000157",
			"Mr. Loarie is currently a managing member of Morgan Stanley Venture Partners III, L.L.C. and Morgan Stanley Dean Witter Venture Partners IV, L.L.C.",
			"Morgan Stanley Venture Partners"},
		{"0000950123-07-008163",
			"Mr. Neff is a founding partner and has served as managing partner of Quaker BioVentures, L.P. since 2002.",
			"Quaker BioVentures"},
		{"0000950123-12-002923",
			"Mr. Brandys is the President and managing member of Biobank Technology Ventures, LLC, an early-stage life sciences investment company which he co-founded in 2001.",
			"Biobank Technology Ventures"},
		{"0001193125-20-167812",
			"Mr. Rhodes has been a partner at Atlas Venture since 2014.",
			"Atlas Venture"},
		{"0001193125-21-199386",
			"Dr. Bolzon has served as Chairman and Managing Director of Versant Venture Management, LLC, where he has been employed since May 2004.",
			"Versant Venture Management"},
		{"0001193125-21-230254",
			"Dr. Parmar is currently a Member of 5AM Venture Management, LLC, where he has worked since 2010.",
			"5AM Venture Management"},
	}
	for _, c := range positive {
		t.Run("yes/"+c.firm, func(t *testing.T) {
			ok, firm, ev := detectVC(c.bio)
			if !ok {
				t.Fatalf("%s: vc_affiliated = false, want true", c.accession)
			}
			if !containsFold(firm, c.firm) {
				t.Errorf("%s: vc_firm = %q, want it to name %q (evidence %q)", c.accession, firm, c.firm, ev)
			}
		})
	}

	negative := []struct{ accession, why, bio string }{
		{"0001047469-13-010949", "an investment-committee seat is not a partner-grade role at the firm",
			"From January 2011 to May 2013, Mr. Saran was Senior Vice President, Corporate Development & Ventures of MedImmune and a member of the MedImmune Ventures investment committee, and from September 2008 to January 2011, he served as the Vice President of Corporate Development."},
		{"0001193125-21-031436", "a corporate venture fund run inside Merck",
			"Dr. Resnick previously served as a Partner at SV Health Investors from January 2016 to September 2018 and as President and Managing Partner at MRL Ventures Fund, an early-stage therapeutics-focused corporate venture fund that he built and managed within Merck & Co., from 2014 to January 2016."},
		{"0001193125-07-265545", "the general partnership is in the past",
			"Mr. Saalfield was a General Partner of Fleet Financial Group's venture capital funds, Fleet Venture Partners I-IV from 1994 to 1999."},
	}
	for _, c := range negative {
		t.Run("no/"+c.why, func(t *testing.T) {
			if ok, firm, ev := detectVC(c.bio); ok {
				t.Errorf("%s: vc_affiliated = true, want false (firm=%q evidence=%q)", c.accession, firm, ev)
			}
		})
	}
}
