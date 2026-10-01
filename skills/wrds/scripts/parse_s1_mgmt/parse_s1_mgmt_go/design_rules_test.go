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
		fixture string
		name    string // the normalised Name the row must carry
		rawHas  string // a marker the unnormalised cell still carries
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

// A post-nominal DEGREE is not part of the name. The cells below are verbatim
// from the two dev filings whose rows the degree cost: Cotherix
// (0001193125-04-095529) writes "Alan G. Walton, Ph.D., D.Sc.(2)(3)" and
// Rallybio (0001193125-21-230254) writes "Rob Hopfner, R.Ph., Ph.D." — the same
// two people whose bios the filing spells with no degree at all. A GENERATIONAL
// suffix is the other half of the rule: "Jr." is the name, and stays.
func TestRule3_PostNominalDegreesAreStrippedFromName(t *testing.T) {
	cases := []struct{ raw, want string }{
		{"Alan G. Walton, Ph.D., D.Sc.(2)(3)", "Alan G. Walton"},
		{"Alan G. Walton, Ph.D., D.Sc.", "Alan G. Walton"},
		{"Rob Hopfner, R.Ph., Ph.D.", "Rob Hopfner"},
		{"Rob Hopfner, R.Ph., Ph.D,", "Rob Hopfner"},
		{"Dennis J. Henner, Ph.D.", "Dennis J. Henner"},
		{"Woodrow A. Myers Jr., M.D.", "Woodrow A. Myers Jr."},
		{"Charles E. Adair", "Charles E. Adair"},
		{"Scott D. Cook (1).......", "Scott D. Cook"},
	}
	for _, c := range cases {
		t.Run(c.raw, func(t *testing.T) {
			if got := normName(c.raw); got != c.want {
				t.Errorf("normName(%q) = %q, want %q", c.raw, got, c.want)
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
		{"Jeffrey W. Bird", "Sutter Hill"},
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
		{"Carl Gordon", "OrbiMed Advisors"},
		{"Robert Goodman", "Bessemer Venture Partners"},
		{"Bryan E. Roberts", "Venrock"},
	} {
		p := person(t, e, c.name)
		if !containsFold(p.Bio, c.wantIn) {
			t.Errorf("%s's bio does not carry %q\n  bio = %q", c.name, c.wantIn, trunc(p.Bio))
		}
	}
	// ... and the person above each of them has not absorbed it.
	for _, c := range []struct{ name, notIn string }{
		{"Timothy Adams", "OrbiMed"},
		{"Carl Gordon", "Bessemer"},
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
		{"Carl Gordon", "OrbiMed"},
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

// The modifiers in front of "venture capital firm" are a list often enough that
// the list's own comma has to survive: "a nationally focused, private venture
// capital firm" is three modifier words, inside the four the wide appositive
// allows, but the comma after the second ended the run and the clause was never
// matched (0001047469-99-026301). The comma is punctuation inside the modifier
// list, not the end of the appositive, so a token may carry one.
//
// The same bio names a second firm in the past tense with a non-venture
// appositive, which must stay uncredited: nothing about admitting the comma
// relaxes the role or the tense.
func TestRule7_AppositiveModifierListMayCarryAComma(t *testing.T) {
	const bio = "Since September 1995, Mr. Balen has been a Principal at Canaan " +
		"Partners, a nationally focused, private venture capital firm. From June 1985 to " +
		"June 1995, Mr. Balen served as a Managing Director of Horsley Bridge Partners, a " +
		"private equity investment management firm."
	ok, firm, ev := detectVC(bio)
	if !ok {
		t.Fatalf("vc_affiliated = false, want true")
	}
	if !containsFold(firm, "Canaan Partners") {
		t.Errorf("vc_firm = %q, want it to name %q (evidence %q)", firm, "Canaan Partners", ev)
	}
	if containsFold(firm, "Horsley Bridge") {
		t.Errorf("vc_firm = %q credits the past, non-venture Horsley Bridge Partners", firm)
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
		// A private-equity appositive that ALSO says venture capital agrees with
		// the name and must not veto it; gold counts Brown (0001193125-12-126304)
		// and Lewis (0000950137-06-012322), where the saving "venture" sits past
		// the end of the veto's own lazy match.
		{"0001193125-12-126304",
			"Since 2007, Mr. Brown has been a General Partner of Battery Ventures, a private equity and venture capital firm focused on technology companies, which he initially joined in 1998.",
			"Battery Ventures"},
		{"0000950137-06-012322",
			"S. Joshua Lewis has served as a director of our company since 2000. Since 2001, Mr. Lewis has been Managing Member and a Principal of Salmon River Capital LLC, a private equity/venture capital firm he founded. He is also a Special Partner of Insight Venture Partners, a private equity/venture capital firm. During 2000, he was a General Partner of Forstmann Little & Co., an investment firm.",
			"Insight Venture Partners"},
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
		// The name says Ventures and the appositive right after it says what the
		// firm actually does: consulting. A venture-NAMED firm is credited off
		// its name alone, so this route never read the label that contradicts
		// it. Gold excludes Myers for exactly that reason - "not called venture
		// despite the name". Contrast Brandys above, whose appositive calls
		// Biobank Technology Ventures "an early-stage life sciences investment
		// company": an investment business is not a contradiction, a services
		// business is.
		{"0001047469-08-003061", "the appositive calls the venture-named firm a consulting business",
			"Dr. Myers has been a member of our board of directors since August 2007. Since December 2005, he has served as the Managing Director of Myers Ventures LLC, an investment firm with interests in health care consulting and international health."},
		// Same shape as Myers, with the contradicting appositive naming an asset
		// class instead of a service: a firm the filing calls private equity or
		// private investment is not venture capital, and gold says so
		// consistently across the batches ("a private equity firm", "a private
		// investment firm", "not called venture"). Both of these are credited
		// off the Ventures in the NAME, so the label is the only thing that can
		// stop them.
		{"0000929624-99-000832", "the appositive calls the venture-named firm a private investment firm",
			"Robert K. Dahl has served as a member of the board of directors since March 1998. Mr. Dahl has been a General Partner at Riviera Ventures, an Alameda-based private investment and management firm, since February 1998, where he specializes in investing in companies in the communications sector."},
		{"0001193125-07-032392", "the appositive calls the venture-named firm a private equity firm",
			"Mr. Gregg is the founder and Managing Director of Bluewater Ventures Ltd., a private equity firm specializing in turnarounds and investments in the media and telecommunications sectors in Europe, the U.S. and Asia."},
	}
	for _, c := range negative {
		t.Run("no/"+c.why, func(t *testing.T) {
			if ok, firm, ev := detectVC(c.bio); ok {
				t.Errorf("%s: vc_affiliated = true, want false (firm=%q evidence=%q)", c.accession, firm, ev)
			}
		})
	}
}

// A partnership the bio has CLOSED is not a VC affiliation, and the narrow
// ", a venture capital firm" appositive was the one route that never checked:
// it credited the firm on the strength of the appositive alone, so
// "From January 2011 to April 2011, Mr. Slootman served as a Partner of
// Greylock Partners, a venture capital firm" read the same as Aneel Bhusri's
// "Since 1999, Mr. Bhusri has served as a partner at Greylock Partners, a
// venture capital firm" two paragraphs above it. The dictionary route had the
// same hole.
//
// Two shapes of past tense, because the corpus writes the dates on either side
// of the appositive: a marker in the clause that introduces the role
// ("From 2011 to January 2022, ... served as", "Ms. Brege was a general
// partner at", "Dr. Lu previously served as"), and a closed range opening
// IMMEDIATELY after the appositive ("a venture capital firm from 1989 through
// 2007"). The second has to be immediate: every surviving bio below carries a
// "From ... to ..." range in the NEXT sentence, describing the job the person
// held before this one.
//
// Bios are quoted verbatim from the accession named on each line, and exercised
// through detectVC because check_full.sh re-cuts every fixture from a source
// filing this corpus does not hold.
func TestRule7_AClosedPartnershipDoesNotFire(t *testing.T) {
	negative := []struct{ accession, why, bio string }{
		{"0001193125-23-237900", "the Sequoia membership ended two months before the offering",
			"Mr. Moritz has served as a member of our board of directors since June 2013. Mr. Moritz currently serves as Senior Advisor to Sequoia Heritage, a private investment partnership, and from 1986 to July 2023, Mr. Moritz served as a Managing Member of Sequoia Capital, a venture capital firm. Mr. Moritz currently serves on the boards of directors of PhenomeX, Inc."},
		{"0001193125-23-237900", "the Greylock partnership ran January to April 2011",
			"From May 2011 to April 2017, Mr. Slootman served as President and Chief Executive Officer and as a member of the board of directors of ServiceNow, Inc. From January 2011 to April 2011, Mr. Slootman served as a Partner of Greylock Partners, a venture capital firm. From July 2009 to January 2011, Mr. Slootman served as President of the Backup Recovery Systems Division at EMC Corporation."},
		{"0001193125-23-237900", "an Executive Advisor, and only to January 2022",
			"Since February 2022, Mr. McCarthy has served as the Chief Executive Officer and President of Peloton Interactive, Inc., a fitness technology company. From 2011 to January 2022, Mr. McCarthy served as an Executive Advisor to Technology Crossover Ventures, a venture capital firm. Mr. McCarthy currently serves on the boards of directors of Peloton Interactive, Inc."},
		{"0001104659-21-042550", "the general partnership predates a 2006 role",
			"Before Onyx, Ms. Brege was a general partner at Red Rock Capital Management, a venture capital firm, and Senior Vice President and Chief Financial Officer at COR Therapeutics, Inc., a research and development company focused on cardiovascular diseases."},
		{"0001193125-24-181773", "an Associate, and the role ended in 2016",
			"Dr. Yamanaka is currently a Principal at venBio Partners LLC, a life sciences investment firm, which she joined in August 2016. From May 2015 to August 2016, Dr. Yamanaka was an Associate on the venture creation team at Flagship Pioneering, a venture capital firm focused on building innovative life sciences companies."},
		{"0001193125-12-126304", "the closed range follows the appositive, not precedes it",
			"Mr. Maudlin served as a managing partner of Medical Innovation Partners, a venture capital firm from 1989 through 2007 and as President of its management company since 1985. Mr. Maudlin has served as a director of Sucampo Pharmaceuticals, Inc., a NASDAQ-listed pharmaceutical company since September 2006."},
		// The same bio with the sentence that precedes it in the filing. The
		// dictionary route's nearest role anchor is then the bare "member" of "a
		// member of its compensation committee", 60-odd bytes ahead of the firm,
		// which leaves the closed range outside the route's 110-byte window — so
		// the range has to be read off the bio rather than off the window.
		{"0001193125-12-126304", "the closed range falls outside the role window",
			"Mr. Maudlin also serves as a director of Newegg, Inc., one of the largest online-only retailers in the United States, and is the Chairperson of its audit and governance committees and a member of its compensation committee. Mr. Maudlin served as a managing partner of Medical Innovation Partners, a venture capital firm from 1989 through 2007 and as President of its management company since 1985."},
		{"0001193125-19-040772", "the dictionary route read a role the bio marks previous",
			"Dr. Lu previously served as a Managing Director at OrbiMed Advisors, LLC in Asia from 2011 to 2016. Prior to her work at OrbiMed, Dr. Lu spent more than five years at Piper Jaffray & Co. as an equity analyst."},
		// The past marker opens the sentence and the firm closes it, 130-odd
		// bytes later, so the 90-byte lead window cannot see it: "Prior to
		// joining HBM Partners AG" is what puts the Wellington principalship in
		// the past, and nothing nearer the firm name says so.
		{"0001193125-21-199386", "the Wellington principalship predates the HBM role",
			"Chandra P. Leo, M.D. has been a member of our board of directors since September 2020. Dr. Leo has served as an Investment Advisor in the private equity team at HBM Partners AG, a Swiss healthcare investment company, since 2007. Prior to joining HBM Partners AG, Dr. Leo worked as a postdoctoral scientist at Stanford University, as a physician at the University Hospital Leipzig and as a principal at Wellington Partners, a venture capital firm. Dr. Leo currently serves as a director on the boards of Fore Biotherapeutics Inc., River 2 Renal Corp. and River 3 Renal Corp., all of which are biotechnology companies, and Gynesonics Inc., a medical device company."},
	}
	for _, c := range negative {
		t.Run("no/"+c.why, func(t *testing.T) {
			if ok, firm, ev := detectVC(c.bio); ok {
				t.Errorf("%s: vc_affiliated = true, want false (firm=%q evidence=%q)", c.accession, firm, ev)
			}
		})
	}

	// The same corpus, present tense. Every one of these carries a closed date
	// range in the sentence AFTER the appositive, or a past role in the sentence
	// before it, and none of that touches the partnership the person holds now.
	positive := []struct{ accession, bio, firm string }{
		{"0001193125-15-338931",
			"Since 2008, Mr. Speiser has served as a Managing Director at Sutter Hill Ventures, a venture capital firm. From 2007 to 2008, Mr. Speiser served as Vice President of Community Products at Yahoo! Inc.",
			"Sutter Hill Ventures"},
		{"0001047469-08-003061",
			"He has served as a General Partner with Foundation Medical Partners, a venture capital firm, since March 2003. From 1987 to 2002, Mr. Rein served as the founder and Managing General Partner of Canaan Partners, a venture capital fund focused on health care companies.",
			"Foundation Medical Partners"},
		{"0001193125-18-207640",
			"Mr. Clark has been an Operating Partner at Clarus Ventures, LLC, a venture capital firm, since September 2017. From 2003 to January 2017, Mr. Clark served in various positions at Genentech Inc., a biopharmaceutical company.",
			"Clarus Ventures"},
		{"0001193125-23-237900",
			"Since November 2019, Mr. Gupta has served as a Managing Member of Sequoia Capital, a venture capital firm. From 2015 to November 2019, Mr. Gupta served as our Chief Financial Officer.",
			"Sequoia Capital"},
		{"0001193125-21-230254",
			"Dr. Shannon has been both a Non-Managing Member of Canaan Partners IX LLC, a Managing Member of Canaan Partners X LLC, a Managing Member of Canaan Partners XI LLC, and a Managing Member of Canaan Partners XII LLC, all entities affiliated with Canaan Partners, a venture capital firm, since November 2009.",
			"Canaan Partners"},
		{"0001104659-21-042550",
			"Since 2015, Dr. Harrison has been employed as a partner by Novo Ventures (US), Inc., which provides consulting services to Novo Holdings A/S, an investment firm focused on life sciences and finance. Previously, Dr. Harrison was Senior Market Planning Manager from November 2013 to November 2015 at Genentech, Inc. Prior to joining Genentech, Dr. Harrison worked as a management consultant from September 2012 to December 2013 at L.E.K. Consulting LLC, a global management consulting firm. Previously, Dr. Harrison was Entrepreneurship Program Manager from September 2011 to September 2012 at QB3, and partner from September 2011 to September 2012 at Mission Bay Capital Management Inc., a venture capital firm.",
			"Novo Ventures"},
		// Three shapes the veto must NOT read as past. Anthony Sun's range is
		// left open — "From August 1979 to the present, he has been a general
		// partner of Venrock Associates, a venture capital partnership"
		// (0000891618-96-002428) — so a closed range needs a year on BOTH sides.
		// Matthew Foy's closed range dates his own earlier BOARD service, one
		// sentence before the partnership, so the lead stops at the sentence
		// boundary; the honorific is why that boundary cannot be the last ". "
		// in the window. And Lucio Lanza's firm is spelled "Lanza
		// techVentures": the camel-cased token stopped firmBefore dead, so the
		// only route that ever credited him was the dictionary reading his
		// CLOSED U.S. Venture Partners partnership.
		{"0000891618-96-002428",
			"ANTHONY SUN has served as a director since October 1995. From August 1979 to the present, he has been a general partner of Venrock Associates, a venture capital partnership. Mr. Sun serves on the Board of Directors of Cognex Corporation.",
			"Venrock Associates"},
		{"0001193125-21-041651",
			"Mr. Foy has served as a member of our board of directors since January 2021. He previously served as a member of our board of directors from April 2019 to November 2020. Mr. Foy has been a partner at SR One Capital Management, LP, a venture capital firm, since 2011. Previously, Mr. Foy was a vice president at Greenhill & Co, an investment bank, from 2002 to 2010.",
			"SR One Capital Management"},
		{"0001095811-01-503434",
			"Lucio L. Lanza has served as a director since November 1995. Mr. Lanza has been managing partner of Lanza techVentures, a venture capital firm, since January 2000. From 1990 to December 2000, Mr. Lanza served with U.S. Venture Partners, a venture capital firm, including as a general partner from 1996 through December 2000.",
			"Lanza techVentures"},
		// Garheng Kong's two labelled firms are BOTH closed - Sofinnova from 2010
		// to 2013, Intersouth from 2000 to 2010 - and the fund he runs now is
		// labelled "a healthcare venture growth fund", a head noun the variant
		// appositive did not reach. Vetoing the two past firms without reading
		// that one would turn a gold VC director into a miss.
		{"0001193125-19-040772",
			"In 2013, he founded, and has since served as Managing Partner of, HealthQuest Capital Management Company, LLC, a healthcare venture growth fund focused on medical products, devices, diagnostics, consumer health and healthcare IT. Dr. Kong was a general partner at Sofinnova Ventures, L.L.C., a venture firm focused on life sciences, from September 2010 to December 2013. From May 2000 to September 2010, he worked at Intersouth LLC, LTD., a venture capital firm, serving most recently as a General Partner.",
			"HealthQuest Capital Management"},
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
}

// A bio that puts the person in a partner-grade role at a firm it never labels is
// reachable only through the dictionary: Design rule 7 scopes every signal to the
// person's OWN bio, and for these eight the words "venture capital" appear
// nowhere in it — the label, when the filing carries one at all, sits in a
// sibling director's bio, which is out of bounds.
//
// The dictionary lookup also has to respect word boundaries. "NEA" is how
// 0001193125-07-233916 spells New Enterprise Associates throughout Peter
// Barris's bio, and a bare substring search for a three-letter entry hits the
// middle of any capitalised word that happens to contain it.
//
// Bios are quoted verbatim from the accession named on each line, and exercised
// through detectVC because check_full.sh re-cuts every fixture from a source
// filing this corpus does not hold.
func TestRule7_TheDictionaryReachesAFirmTheBioNeverLabels(t *testing.T) {
	positive := []struct{ accession, bio, firm string }{
		{"0000950123-12-002923",
			"Mr. Olivier has served on our board of directors since our inception in 1996. Mr. Olivier is a founding general partner of Oxford Bioscience Partners, one of the founders of Ceres. Mr. Olivier has been with Oxford Bioscience Partners since 1995.",
			"Oxford Bioscience"},
		{"0001193125-04-095529",
			"Alan G. Walton, Ph.D., D.Sc. has served as a director of our company since March 2003. Dr. Walton joined Oxford Partners as a General Partner in 1987. In 1991, he founded Oxford Bioscience Partners and he is currently Senior Partner and Chairman of Oxford Bioscience Corporation.",
			"Oxford Bioscience"},
		{"0001193125-07-233916",
			"Peter J. Barris. Mr. Barris has served as a Director since 2003. Mr. Barris is currently the Managing General Partner of NEA where he specializes in information technology investing. Mr. Barris has been with NEA since 1992, and he serves as either an executive officer or general partner of various NEA entities.",
			"NEA"},
		{"0001193125-11-313540",
			"Tim Wilson has served on our board of directors since April 2004. As a Partner of Partech International, LLC since 2001, he serves on the boards of ACCO Semiconductor, Array Converter, Five9, Prysm Inc. (formerly Spudnik) and LEDEngin, Inc.",
			"Partech"},
		{"0001193125-11-313540",
			"Amit Shah has served on our board of directors since April 2004. As a Managing Member of Artiman Management since 2000, he serves on the boards of Auryn Inc., Lightwire, Inc., Zyme Solutions, AbsolutelyNew, Inc., Guavus, Inc., and Motif, Inc.",
			"Artiman"},
		{"0001193125-19-040772",
			"Gilbert H. Kliman, M.D. has served as a member of our board of directors since November 2015. Dr. Kliman is the Managing Director at InterWest Management Partners X, LLC, where he has led their medical device team since 1999.",
			"InterWest Management Partners"},
		{"0001193125-19-177602",
			"Ran Nussbaum has served as a member of our board of directors since March 2018. Mr. Nussbaum is a managing partner and a co-founder of The Pontifax Group, or Pontifax, a group of Israel-based life sciences venture funds focusing on investments in development stage bio-pharmaceutical and med-tech technologies.",
			"Pontifax"},
		// NeuroMetrix 2004: the bio gives Whitney & Co., LLC no description at
		// all. The filing does call Laverack a director "affiliated with venture
		// capital firms that are our stockholders", but that sentence sits in the
		// director-compensation paragraph, not in his bio, so rule 7 leaves only
		// the dictionary. J.H. Whitney & Co. is one of the oldest VC houses.
		{"0001047469-04-023893",
			"William Laverack, Jr. has served as a member of our board of directors since 1998. Mr. Laverack is a Managing Partner of Whitney & Co., LLC, which he joined in 1993. Mr. Laverack is also a director of Knology, Inc., Grande Communications, Inc. and several private companies. Mr. Laverack holds a B.A. from Harvard College and an M.B.A. from Harvard Business School.",
			"Whitney & Co"},
		// Informatica 1999: "a venture partner with Asset Management Associates"
		// is the whole description the bio gives, and the phrase "venture
		// capital" appears nowhere in the filing, so only the dictionary reaches
		// it. AMA has backed Silicon Valley device and software companies since
		// 1984.
		{"0000891618-99-001884",
			"Mr. Pidwell has been one of our directors since February 1996. From January 1988 to January 1996, Mr. Pidwell was president and chief executive officer of Rasna Corporation, a software company. Mr. Pidwell is currently a venture partner with Asset Management Associates and serves on the boards of directors of a number of private companies.",
			"Asset Management Associates"},
		// Scholar Rock 2019: Omega Funds carries no label in the bio at all, and
		// the only other mention in the filing is a bare name in the list of
		// investors.
		{"0001047469-19-003926",
			"Otello Stampacchia, Ph.D. has served as a member of our board of directors since December 2018. He has served as founder and Managing Director of Omega Funds since 2004. Previously, Dr. Stampacchia was in charge of life sciences direct investments at AlpInvest Partners B.V. from 2001 to 2003, and from 2000 to 2001, he worked at Merrill Lynch.",
			"Omega Funds"},
		// Cidara 2015: the appositive the bio does supply calls SV Life Sciences
		// "an investment fund", which is not a venture label, so the appositive
		// routes cannot fire and the dictionary is the only way in.
		{"0001193125-15-131330",
			"Mr. Burgess has served as a member of our board of directors since April 2014. Mr. Burgess is currently a venture partner at SV Life Sciences, an investment fund, a position he has held since June 2014.",
			"SV Life Sciences"},
		// Avrobio 2018: the same house under its current name, and a bio that
		// walks through two seats the dictionary must NOT credit - MRL Ventures
		// is a corporate venture fund run inside Merck, and the Atlas Venture
		// partnership is in the past.
		{"0001193125-18-199473",
			"Joshua Resnick, M.D. has served as a member of our board of directors since July 2016. Dr. Resnick has been a partner at SV Health Investors, or SV, since January 2016. Before joining SV in January 2016, Dr. Resnick was president and managing partner at MRL Ventures Fund, or MRL Ventures, an early-stage therapeutics-focused corporate venture fund that he built and managed within Merck & Co from December 2014 to January 2016. Prior to MRL Ventures, Dr. Resnick was a venture partner with Atlas Venture, or Atlas, focusing on company formation, Seed and Series A investing.",
			"SV Health Investors"},
		{"0001193125-21-231612",
			"JeenJoo (JJ) Kang, Ph.D. has served as a member of our board of directors since August 2016. Dr. Kang has also served as a member of our compensation committee since December 2018, as a member of our audit committee since September 2019, and as our President, Treasurer and Secretary from August 2016 to June 2018. Dr. Kang has served as a Venture Partner at The Column Group since 2020, and prior to that served as an Associate beginning in 2015, then as a Partner from 2019 to 2020.",
			"Column Group"},
		// Integ 1996: these two bios name their firm only by the abbreviation the
		// SIBLING bio defines. Knudson's bio writes 'Medical Innovation Partners
		// II, a Limited Partnership ("MIP II")' and calls the family "early stage
		// venture/seed capital partnerships"; Nickoloff's and Maudlin's own bios
		// carry the letters and nothing else, so rule 7 leaves only the
		// dictionary. Same shape as "NEA" above, and it needs the same word
		// boundaries: the corpus writes "MIP" inside uuencoded attachments.
		{"0000950131-96-003098",
			"Robert S. Nickoloff has been a director of the Company since its inception. Mr. Nickoloff is a General Partner of MIP and MIP II, where he has been active in the formation and financing of start-up medical device and service companies since 1987. He has served as Chairman of the Board of Governors of the University of Minnesota Hospital and Clinic and is a director of Green Tree Financial Corporation, Minnesota Power and Light Co. and Northeast Venture Development Fund.",
			"MIP"},
		{"0000950131-96-003098",
			"Timothy I. Maudlin has been a director of the Company since its inception. Mr. Maudlin is the Managing General Partner of MIP and MIP II. He has been active in the formation, management, financing, and development of seed and start-up medical technology and service companies since 1982. Mr. Maudlin is currently a director of Diametrics, IVI Publishing, Inc., an interactive multimedia publisher of health and medical titles, and Curative Health Services, Inc., a health care services company.",
			"MIP"},
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

	// Constructed, not quoted: the hazard a three-letter dictionary entry creates
	// is a capitalised word with the entry in its middle, and "LINEAR" carries
	// "NEA" at offset two.
	probe := "Mr. Doe has served as a Managing Director of LINEAR Technology Corporation, a semiconductor company, since 2001."
	if ok, firm, ev := detectVC(probe); ok {
		t.Errorf("a dictionary entry matched mid-word: vc_affiliated = true (firm=%q evidence=%q)", firm, ev)
	}

	// Constructed: "MIP" is the second three-letter entry, and the word it sits
	// at the head of is a real semiconductor issuer.
	probe = "Ms. Roe has served as a General Partner of MIPS Technologies, Inc., a semiconductor design company, since 2001."
	if ok, firm, ev := detectVC(probe); ok {
		t.Errorf("a dictionary entry matched a longer word: vc_affiliated = true (firm=%q evidence=%q)", firm, ev)
	}
}

// ---------------------------------------------------------------------------
// Rule 1, the ASCII path — the table's own header furniture
// ---------------------------------------------------------------------------

// AnswerThink 1998 (0000928385-98-001146) wraps the fourth column's header over
// three lines inside the <CAPTION>: "TERM AS" / "DIRECTOR" / then the real
// NAME / AGE / POSITION line. "TERM AS" is short, all-capitals and carries no
// sentence break, so the heading test reads it as a top-level successor section
// and closes MANAGEMENT one line BEFORE the header the table parser is looking
// for. Verbatim from the filing.
const asciiCaptionWrapExcerpt = `                                  MANAGEMENT
 
DIRECTORS AND EXECUTIVE OFFICERS
 
  Set forth below is certain information as of May 1, 1998 concerning the
directors and executive officers of the Company. The Company's board of
directors is divided into three classes serving staggered three-year terms.
 
<TABLE>
<CAPTION>
                                                                          TERM AS
                                                                          DIRECTOR
  NAME                    AGE          POSITION AND OFFICES HELD          EXPIRES
  ----                    ---          -------------------------          --------
<S>                       <C> <C>                                         <C>
Ted A. Fernandez........  41  President, Chief Executive Officer and        2001
                               Chairman
Fernando Montero........  52  Director                                      2001
Bruce V. Rauner.........  42  Director                                      2001
Allan R. Frank..........  42  Executive Vice President, Chief Technology    2000
                               Officer and Director
William C. Kessinger....  32  Director                                      2000
Edmund R. Miller........  42  Director                                      1999
Ulysses S. Knotts, III..  42  Executive Vice President, Sales and           1999
                               Marketing and Director
John F. Brennan.........  40  Executive Vice President, Acquisitions and
                               Strategic Planning and Secretary
Luis E. San Miguel......  38  Executive Vice President, Finance and Chief
                               Financial Officer
</TABLE>
 
  Ted A. Fernandez is a founder of the Company and has served as Chief
Executive Officer, President and Chairman of its Board of Directors since
inception. Mr. Fernandez served as the National Managing Partner of KPMG Peat
Marwick LLP's ("KPMG's") Strategic Services Consulting, the firm's
transformation and IT consulting group, from May 1994 to January 1997. Mr.
Fernandez also served as a member of KPMG's Management Committee from May 1995
to January 1997. From 1979 to 1993, Mr. Fernandez held several industry,
executive and client service positions with KPMG.
 `

func TestRule1_AsciiCaptionHeaderDoesNotCloseTheSection(t *testing.T) {
	raw := sgmlHeaderFor("ANSWER THINK CONSULTING GROUP INC") +
		sgmlDoc("424B4", asciiCaptionWrapExcerpt+"\n\nEXECUTIVE COMPENSATION\n")
	e := ExtractManagement([]byte(raw))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q: a wrapped column header inside the CAPTION is table furniture, not a successor section",
			e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 9 {
		t.Errorf("len(persons) = %d, want 9: %v", len(e.Persons), personNames(e))
	}
	if got := squash(e.Filing.CEOName); got != "Ted A. Fernandez" {
		t.Errorf("ceo_name = %q, want %q", got, "Ted A. Fernandez")
	}
	if !e.Filing.CEOFounderSelfDescribed {
		t.Errorf("ceo_founder_self_described = 0, want 1: %q", squash(e.Filing.CEOFounderEvidence))
	}
}

// Horizon Medical Products 1998 (0000950144-98-004643) heads the name column
// with the block label itself -- "EXECUTIVE OFFICERS AND DIRECTORS:" -- and
// never writes the word NAME, so a header test requiring all three column words
// finds no table at all. AGE and POSITION are there, and the rule line under the
// header is what says the line is a header rather than prose. Verbatim.
const asciiNamelessHeaderExcerpt = `                                   MANAGEMENT
 
EXECUTIVE OFFICERS, DIRECTORS AND KEY EMPLOYEES
 
     The following table sets forth certain information concerning each of the
executive officers, directors and key employees of the Company as of April 14,
1998.
 
<TABLE>
<CAPTION>
EXECUTIVE OFFICERS AND DIRECTORS:           AGE                    POSITION
- ---------------------------------           ---                    --------
<S>                                         <C>   <C>
Marshall B. Hunt..........................  42    Director, Chairman of the Board and Chief
                                                    Executive Officer
William E. Peterson, Jr...................  42    Director and President
J. Ronald Hager...........................  54    Vice President of Operations
Mark A. Jewett............................  32    Vice President of Finance
L. Bruce Maloy............................  34    Vice President of Administration
Charles E. Adair..........................  50    Director
Robert Cohen..............................  40    Director
Robert J. Simmons.........................  55    Director
Gordon Tunstall...........................  54    Director
KEY EMPLOYEES:
 
Michael A. Crouch.........................  36    National Accounts Manager
Frank D. DeBartola........................  34    Director of Marketing
Robert R. Singer..........................  32    National Sales Manager
</TABLE>
 
     Marshall B. Hunt is a co-founder of the Company and has served as a
director and Chief Executive Officer of the Company since its inception in 1990.
Mr. Hunt has served as the Chairman of the Board of the Company since 1997.
Prior to co-founding the Company, Mr. Hunt co-founded Cardiac Medical, Inc.
("CMI"), a distributor of cardiac pacemakers, in 1987, and served as its Chief
Executive Officer until October 1997. Mr. Hunt currently serves as Secretary of
CMI. In 1981, Mr. Hunt founded Hunt Medical Systems, Inc., a distributor of
pacemaker products, and served as its President from 1981 to 1987. From 1979
through 1981, Mr. Hunt held various sales and management positions with American
Hospital Supply Corporation.
 
     William E. Peterson, Jr. is a co-founder of the Company and has served as
President of the Company since its inception in 1990. Mr. Peterson joined the
Company's Board of Directors in January 1998. Mr. Peterson served as Vice`

func TestRule1_AsciiHeaderNeedNotSayName(t *testing.T) {
	raw := sgmlHeaderFor("HORIZON MEDICAL PRODUCTS INC") +
		sgmlDoc("424B4", asciiNamelessHeaderExcerpt+"\n\nEXECUTIVE COMPENSATION\n")
	e := ExtractManagement([]byte(raw))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q: the name column is headed by the block label, not by \"NAME\"",
			e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 12 {
		t.Errorf("len(persons) = %d, want 12 (9 officers and directors + 3 key employees): %v",
			len(e.Persons), personNames(e))
	}
	if got := squash(e.Filing.CEOName); got != "Marshall B. Hunt" {
		t.Errorf("ceo_name = %q, want %q", got, "Marshall B. Hunt")
	}
	if !e.Filing.CEOFounderSelfDescribed {
		t.Errorf("ceo_founder_self_described = 0, want 1: %q", squash(e.Filing.CEOFounderEvidence))
	}
}

// A section that splits its people across TWO Name/Age/Position tables — the
// officers under "Executive Officers", the board under "Non-Employee Directors"
// — must yield both sets. TScan's 2021 S-1 (0001193125-21-218024) is the case:
// reading only the first table gives four officers, no directors at all, and
// loses every one of its four venture-capital directors. The shape below is that
// filing's, with its own names, positions and bio sentences.
func TestRule1_SecondPersonTableInTheSectionIsRead(t *testing.T) {
	body := `<HTML><BODY>
<P ALIGN="center"><B>MANAGEMENT</B></P>
<P><B>Executive Officers, Directors and Key Employees</B></P>
<P><B>Executive Officers</B></P>
<P>The following table sets forth the names and positions of our current executive officers.</P>
<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>David Southwell</TD><TD>60</TD><TD>President, Chief Executive Officer and Director</TD></TR>
<TR><TD>Brian Silver</TD><TD>52</TD><TD>Senior Vice President and Chief Financial Officer</TD></TR>
<TR><TD>Gavin MacBeath, Ph.D.</TD><TD>51</TD><TD>Chief Scientific Officer</TD></TR>
</TABLE>
<P>David Southwell has served as our President, Chief Executive Officer and as a member of our board of directors since October 2018.</P>
<P>Brian Silver has served as our Senior Vice President and Chief Financial Officer since May 2021.</P>
<P>Gavin MacBeath, Ph.D. has served as our Chief Scientific Officer since December 2018.</P>
<P><B>Non-Employee Directors</B></P>
<P>The following table sets forth the names and positions of our non-employee directors.</P>
<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>Timothy Barberich(1),(2)</TD><TD>73</TD><TD>Chairperson of the Board</TD></TR>
<TR><TD>Ittai Harel(1),(3)</TD><TD>53</TD><TD>Director</TD></TR>
<TR><TD>Andrew Hedin(5)</TD><TD>36</TD><TD>Director</TD></TR>
</TABLE>
<P>The following is a biographical summary of the experience of our non-employee directors.</P>
<P>Timothy Barberich has served as a member of our board of directors since March 2019 and as the Chair of our board of directors since June 2019.</P>
<P>Ittai Harel has served as a member of our board of directors since August 2019. Mr. Harel has served as the Managing General Partner of Pitango Venture Capital since 2006.</P>
<P>Andrew Hedin has served as a member of our board of directors since July 2020. Mr. Hedin has served as an investment professional at Bessemer Venture Partners, a venture capital firm, since 2015 and has been a partner since 2021.</P>
<P><B>Board Composition</B></P>
<P>Our board of directors currently consists of nine members.</P>
</BODY></HTML>`
	e := ExtractManagement([]byte(sgmlHeader + sgmlDoc("424B4", body)))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 6 {
		t.Fatalf("len(persons) = %d, want 6 (3 officers + 3 directors): %v",
			len(e.Persons), personNames(e))
	}
	if got := countSection(e, SectionOfficer); got != 3 {
		t.Errorf("officers = %d, want 3: %v", got, personNames(e))
	}
	if got := countSection(e, SectionDirector); got != 3 {
		t.Errorf("directors = %d, want 3: %v", got, personNames(e))
	}
	if got := squash(e.Filing.CEOName); got != "David Southwell" {
		t.Errorf("ceo_name = %q, want %q", got, "David Southwell")
	}
	// A person from the second table must carry the bio that follows it, and the
	// VC flag must fire off that bio exactly as it does from the first table.
	hedin := person(t, e, "Andrew Hedin")
	if !containsFold(hedin.Bio, "a venture capital firm") {
		t.Fatalf("Andrew Hedin bio = %q, want the sentence naming Bessemer", squash(hedin.Bio))
	}
	if !hedin.VCAffiliated {
		t.Errorf("Andrew Hedin vc_affiliated = false, want true (bio: %q)", squash(hedin.Bio))
	}
	if e.Filing.NVCDirectors < 1 {
		t.Errorf("n_vc_directors = %d, want >= 1", e.Filing.NVCDirectors)
	}
	// Seq must stay a dense 1..n over the joined set, not restart at the second
	// table: the person rows are keyed on it.
	for i, p := range e.Persons {
		if p.Seq != i+1 {
			t.Errorf("persons[%d].Seq = %d, want %d", i, p.Seq, i+1)
		}
	}
}

// Beyond Meat (0001628280-19-005740) writes every board seat as "Board Member"
// and nothing else, under a label — "Executive Officers and Directors" — that
// names both sides and so settles nothing. The Position fallback therefore
// decides, and a board seat spelled without the word "director" must still
// read as one: ten rows landed section=unknown, which drops them out of
// n_directors and out of the VC-director count even when their own bio names a
// venture capital firm.
func TestRule2_BoardMemberIsADirectorPosition(t *testing.T) {
	body := `<HTML><BODY>
<P ALIGN="center"><B>MANAGEMENT</B></P>
<P><B>Executive Officers and Directors</B></P>
<P>The following table sets forth information regarding our executive officers and directors as of March 30, 2019.</P>
<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>Ethan Brown</TD><TD>47</TD><TD>President and Chief Executive Officer, Board Member</TD></TR>
<TR><TD>Mark J. Nelson</TD><TD>50</TD><TD>Chief Financial Officer, Treasurer and Secretary</TD></TR>
<TR><TD>Gregory Bohlen</TD><TD>59</TD><TD>Board Member</TD></TR>
<TR><TD>Diane Carhart</TD><TD>64</TD><TD>Board Member</TD></TR>
</TABLE>
<P>Ethan Brown has served as our President and Chief Executive Officer since 2011.</P>
<P>Mark J. Nelson has served as our Chief Financial Officer since 2017.</P>
<P>Gregory Bohlen has served as a member of our board of directors since February 2013. Mr. Bohlen co-founded Union Grove Venture Partners, a venture capital firm, in March 2014 and serves as a Managing Partner.</P>
<P>Diane Carhart has served as a member of our board of directors since February 2016.</P>
</BODY></HTML>`
	e := ExtractManagement([]byte(sgmlHeader + sgmlDoc("424B4", body)))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
	}
	// A cell naming an executive office AND a board seat is still an officer:
	// Brown's "President and Chief Executive Officer, Board Member" must not be
	// pulled over to the director side by the new alternative.
	for _, c := range []struct{ name, section string }{
		{"Ethan Brown", SectionOfficer},
		{"Mark J. Nelson", SectionOfficer},
		{"Gregory Bohlen", SectionDirector},
		{"Diane Carhart", SectionDirector},
	} {
		if p := person(t, e, c.name); p.Section != c.section {
			t.Errorf("%s section = %q, want %q (position=%q)",
				c.name, p.Section, c.section, squash(p.Position))
		}
	}
	if e.Filing.NDirectors != 2 {
		t.Errorf("n_directors = %d, want 2", e.Filing.NDirectors)
	}
	// Bohlen's own bio labels Union Grove, so the only thing that kept him out
	// of the VC-director count was the unknown section.
	bohlen := person(t, e, "Gregory Bohlen")
	if !bohlen.VCAffiliated {
		t.Fatalf("Gregory Bohlen vc_affiliated = false, want true (bio: %q)", squash(bohlen.Bio))
	}
	if e.Filing.NVCDirectors != 1 {
		t.Errorf("n_vc_directors = %d, want 1", e.Filing.NVCDirectors)
	}
}

// ---------------------------------------------------------------------------
// Rule 7 — the role grade at a labelled venture firm
// ---------------------------------------------------------------------------

// A labelled venture capital firm in the bio is not enough: the gold counts a
// venture DIRECTOR, which means a partner-grade seat at the firm. A chairman, a
// salaried officer, a scientific advisor and an entrepreneur-in-residence all
// sit at a firm the filing calls "a venture capital firm" and none of them is
// counted.
//
// The test is a veto and not a requirement, because the narrow appositive's own
// true positives include leads with no role in them at all: "Dr. Behbahani
// joined New Enterprise Associates, Inc., a venture capital firm, in 2007 and
// is a General Partner" puts the role on the far side of the name, so a lead
// that must carry a partner-grade role would throw him away.
//
// Bios are quoted verbatim from the accession named on each line, and exercised
// through detectVC because check_full.sh re-cuts every fixture from a source
// filing this corpus does not hold.
func TestRule7_ANonPartnerRoleAtAVentureFirmDoesNotFire(t *testing.T) {
	negative := []struct{ accession, why, bio string }{
		{"0000936392-00-000157", "chairman of the firm, not a partner in it",
			"John C. Stiska has served as a Director since March 1999. Mr. Stiska currently is Chairman of Commercial Bridge Capital, LLC., a venture capital firm, and serves as of-counsel to the law firm of Latham & Watkins."},
		{"0000950123-05-008754", "an officer of the firm, and later its President",
			"Joan P. Neuscheler has been a Director since 2002. Ms. Neuscheler has 16 years of experience in private equity investing as an officer of Tullis-Dickerson & Co., Inc., a health care-focused venture capital firm. Since July 1998, Ms. Neuscheler has been the President of Tullis-Dickerson & Co., Inc."},
		{"0001193125-18-207640", "the Chief Scientific Advisor, and the managing directorship closed in 2018",
			"Dennis J. Henner, Ph.D. has served as a member of our board of directors since November 2015. He is the Chief Scientific Advisor of Clarus Ventures, LLC, a venture capital firm, where he served as Managing Director from the firm's inception in March 2005 to January 2018."},
		{"0001193125-21-231612", "an entrepreneur-in-residence at the firm",
			"Catherine Stehman-Breen, M.D. has served as a member of our board of directors since June 2020. Since March 2018, she has served as an entrepreneur-in-residence at Atlas Ventures, a venture capital firm."},
		{"0000928385-00-002071", "a consultant with the firm, not a partner in it",
			"Steven G. Finn has served as a member of our board of directors since March 1998. Dr. Finn has been a principal research scientist and lecturer at M.I.T. since 1991. Dr. Finn has also served as a consultant with Matrix Partners, a venture capital firm, since 1991."},
	}
	for _, c := range negative {
		t.Run("no/"+c.why, func(t *testing.T) {
			if ok, firm, ev := detectVC(c.bio); ok {
				t.Errorf("%s: vc_affiliated = true, want false (firm=%q evidence=%q)", c.accession, firm, ev)
			}
		})
	}

	// The partner-grade seats the veto must leave alone, including the two
	// spellings that put the role after the firm name.
	positive := []struct{ accession, bio, firm string }{
		{"0001193125-21-199386",
			"Dr. Behbahani joined New Enterprise Associates, Inc., a venture capital firm, in 2007 and is a General Partner on the healthcare team.",
			"New Enterprise Associates"},
		{"0001193125-15-338931",
			"Since 2008, Mr. Speiser has served as a Managing Director at Sutter Hill Ventures, a venture capital firm. From 2007 to 2008, Mr. Speiser served as Vice President of Community Products at Yahoo! Inc.",
			"Sutter Hill Ventures"},
		{"0001193125-19-177602",
			"Mr. Nussbaum is a managing partner and a co-founder of The Pontifax Group, or Pontifax, a group of Israel-based life sciences venture funds focusing on investments in development stage bio-pharmaceutical and med-tech technologies.",
			"Pontifax"},
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
}

// The firm can sit BEFORE the partner-grade role inside one sentence, which is
// the one arrangement neither dictionary window could see: the forward window
// opens after the role and the appositive lead test reads only what precedes
// the name. "Dr. Roberts joined Venrock, a venture capital investment firm, in
// 1997, where he serves as partner" and "He has served in various roles with
// Foresite Capital Management, an investment firm, since August 2016, including
// serving as Managing Director since May 2020" both name a dictionary firm and
// then, in the same sentence and in the present tense, the seat held at it.
//
// Bios are quoted verbatim from the accession named on each line, and exercised
// through detectVC because check_full.sh re-cuts every fixture from a source
// filing this corpus does not hold.
func TestRule7_AFirmNamedBeforeThePresentRoleInTheSameSentenceFires(t *testing.T) {
	positive := []struct{ accession, bio, firm string }{
		{"0001047469-10-000546",
			"Bryan E. Roberts has served as director since 2001. Dr. Roberts joined Venrock, a venture capital investment firm, in 1997, where he serves as partner. From 1989 to 1992, Dr. Roberts worked in the corporate finance department of Kidder, Peabody & Co., a brokerage company.",
			"Venrock"},
		{"0001140361-20-027255",
			"Michael Rome, Ph.D. has served on our board of directors since December 2019. He has served in various roles with Foresite Capital Management, an investment firm, since August 2016, including serving as Managing Director since May 2020. Prior to that, he served as an Analyst at DAFNA Capital Management LLC, a healthcare hedge fund, from September 2015 to July 2016.",
			"Foresite Capital"},
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

	// Constructed, not quoted: the backward window reads one sentence and only
	// in the present tense, so the same arrangement with the seat already closed
	// out must stay unread even though the firm name sits in that sentence.
	probe := "Mr. Doe joined Greylock Partners in 1999, where he was a general partner until 2011."
	if ok, firm, ev := detectVC(probe); ok {
		t.Errorf("a closed seat fired through the backward window: vc_affiliated = true (firm=%q evidence=%q)", firm, ev)
	}
}

// Medical Innovation / Integ Incorporated 1996 (0000950131-96-003098) runs out of
// name column on two rows and wraps the cell:
//
//	Mark B. Knudson,
//	 Ph.D.(1)(3)...............  47 Chairman of the Board of Directors
//
// The dangling line carries no age, so the row parser filed it as a section
// label and named the person "Ph.D." -- which loses the name, loses the bio that
// opens with it (it lands on the officer above instead) and collapses two rows
// onto one name in the distinct-person count. The continuation is indented past
// the left margin where a real name cell and a real section label both start,
// and the dangling line ends mid-cell on a comma. Verbatim from the filing.
const asciiWrappedNameCellExcerpt = `                                  MANAGEMENT
 
DIRECTORS AND EXECUTIVE OFFICERS
 
  The directors, executive officers and key management personnel of the
Company are as follows:
 
<TABLE>
<CAPTION>
NAME                        AGE POSITION
- ----                        --- --------
<S>                         <C> <C>
Frank A. Solomon(3)........  52 President, Chief Executive Officer and Director
Ronald M. Nelson...........  45 Chief Financial Officer
Mark B. Knudson,
 Ph.D.(1)(3)...............  47 Chairman of the Board of Directors
Frank B. Bennett(1)(2).....  39 Director
Robert S. Nickoloff........  67 Director
Walter L. Sembrowich,
 Ph.D.(3)..................  53 Director
</TABLE>
- --------
(1) Member of the Compensation Committee of the Board of Directors.
 
  Frank A. Solomon, one of the founders of the Company, served as a consultant
to the Company from July through December 1990, its President and a director
since January 1991 and as Chief Executive Officer since December 1991.
 
  Ronald M. Nelson has acted as the Company's Chief Financial Officer on a
part-time basis since January 1994. Mr. Nelson is a Certified Public
Accountant.
 
  Mark B. Knudson, Ph.D., one of the founders of the Company, served as the
President of the Company from its inception in April 1990 through December
1990, and as Chief Executive Officer from its inception through November 1991.
Since 1993, Dr. Knudson has been the Managing Venture Partner of Medical
Innovation Partners II, a Limited Partnership ("MIP II").
 
  Frank B. Bennett has been a director of the Company since 1992. Mr. Bennett
is the founder of Artesian Capital Management, Inc. ("Artesian").
 
  Robert S. Nickoloff has been a director of the Company since its inception.
Mr. Nickoloff is a General Partner of MIP and MIP II.
 
  Walter L. Sembrowich, Ph.D., has been a director of the Company since its
inception. Since co-founding Diametrics in 1990, Dr. Sembrowich held various
management positions at Diametrics through December 1995.
`

func TestRule3_AsciiWrappedNameCellIsOneRow(t *testing.T) {
	raw := sgmlHeaderFor("INTEG INCORPORATED") +
		sgmlDoc("424B4", asciiWrappedNameCellExcerpt+"\nEXECUTIVE COMPENSATION\n")
	e := ExtractManagement([]byte(raw))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 6 {
		t.Fatalf("len(persons) = %d, want 6: %v", len(e.Persons), personNames(e))
	}
	for _, p := range e.Persons {
		if squash(p.Name) == "Ph.D." || squash(p.Name) == "" {
			t.Errorf("a wrapped name cell produced the person %q: %v", squash(p.Name), personNames(e))
		}
	}
	k := person(t, e, "Mark B. Knudson")
	if k.Age != 47 {
		t.Errorf("Knudson age = %d, want 47", k.Age)
	}
	if !containsFold(k.Position, "Chairman of the Board") {
		t.Errorf("Knudson position = %q, want the chairman cell", squash(k.Position))
	}
	if !containsFold(k.Bio, "Managing Venture Partner") {
		t.Errorf("Knudson bio = %q, want his own bio", squash(k.Bio))
	}
	// The bio that opens with the wrapped name must not land on the row above it.
	n := person(t, e, "Ronald M. Nelson")
	if containsFold(n.Bio, "Managing Venture Partner") {
		t.Errorf("Knudson's bio landed on Nelson: %q", squash(n.Bio))
	}
	if n.FounderSelfDescribed {
		t.Errorf("Nelson is flagged a founder off Knudson's bio: %q", squash(n.FounderEvidence))
	}
	s := person(t, e, "Walter L. Sembrowich")
	if s.Age != 53 {
		t.Errorf("Sembrowich age = %d, want 53", s.Age)
	}
}

// Simplex Solutions 2001 (0000891618-01-500512) wraps a name cell the other way
// round: the age sits on the FIRST half and the remainder dangles under it.
//
//	Harvey C. Jones,              48     Director
//	  Jr.(1)(2).................
//
// The dangling line carries no age, sits far left of the position field so the
// position-continuation rule cannot claim it, and ends on a dot leader so the
// section-label rule rejects it too -- which ended the table three rows early
// and swept Myers', Newton's and Sonsini's bios onto Jones. Verbatim from the
// filing.
const asciiWrappedNameTailExcerpt = `                                   MANAGEMENT

EXECUTIVE OFFICERS AND DIRECTORS

     The names, ages and positions of our executive officers and directors as of
March 31, 2001 are as follows:

<TABLE>
<CAPTION>
            NAME              AGE                               POSITION
            ----              ---                               --------
<S>                           <C>    <C>
Penelope A. Herscher........  40     Chief Executive Officer and Chairman of the Board of Directors
Joseph B. Costello(1).......  47     Director
Harvey C. Jones,              48     Director
  Jr.(1)(2).................
F. Gibson Myers, Jr.(2).....  59     Director
A. Richard Newton(1)(2).....  49     Director
Larry W. Sonsini............  60     Director
</TABLE>

- ---------------
(1) Member of the Audit Committee.

     Penelope A. Herscher has served as our Chief Executive Officer since April
1996. From May 1996 to July 2000, Ms. Herscher served as our President.

     Joseph B. Costello has served on our Board of Directors since June 1996.
Mr. Costello serves on the board of directors of several private companies.

     Harvey C. Jones, Jr. has served on our Board of Directors since December
1995. From December 1987 through February 1998, Mr. Jones held various positions
at Synopsys Inc., a developer of electronic design automation software.

     F. Gibson Myers, Jr. has served on our Board of Directors since July 1995.
Mr. Myers serves as a partner emeritus of the Mayfield Fund, which he joined in
1970.

     A. Richard Newton has served on our Board of Directors since July 1995. Mr.
Newton has served as a Venture Partner at the Mayfield Fund since 1998.

     Larry W. Sonsini has served on our Board of Directors since June 1998. Mr.
Sonsini has been an attorney with the law firm of Wilson Sonsini Goodrich &
Rosati.
`

func TestRule3_AsciiWrappedNameTailIsOneRow(t *testing.T) {
	raw := sgmlHeaderFor("SIMPLEX SOLUTIONS INC") +
		sgmlDoc("424B4", asciiWrappedNameTailExcerpt+"\nEXECUTIVE COMPENSATION\n")
	e := ExtractManagement([]byte(raw))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 6 {
		t.Fatalf("len(persons) = %d, want 6: %v", len(e.Persons), personNames(e))
	}
	j := person(t, e, "Harvey C. Jones, Jr.")
	if j.Age != 48 {
		t.Errorf("Jones age = %d, want 48", j.Age)
	}
	if j.VCAffiliated {
		t.Errorf("Jones carries a VC flag off a later director's bio: firm=%q evidence=%q",
			j.VCFirm, squash(j.VCEvidence))
	}
	for _, want := range []string{"F. Gibson Myers, Jr.", "A. Richard Newton"} {
		p := person(t, e, want)
		if !p.VCAffiliated || !containsFold(p.VCFirm, "Mayfield") {
			t.Errorf("%s vc_affiliated = %v firm = %q, want the Mayfield Fund",
				want, p.VCAffiliated, p.VCFirm)
		}
	}
}

// ---------------------------------------------------------------------------
// Rule 2 — a long executive title is still an executive office
// ---------------------------------------------------------------------------

// rePosOfficer's "chief ... officer" alternative allowed at most two words
// between the two anchors and no ampersand, so three real 2021 titles fell
// through to section=unknown and the filing's own person count came up short:
// "Chief Strategy and Development Officer", "Chief Experience & Innovation
// Officer" and "Chief Medical and Quality Officer" (all 0001193125-21-118203),
// plus NuVasive's "Chief Patent Counsel" (0001047469-04-017088), which names an
// office the pattern only knew as "general counsel".
//
// Position cells are quoted verbatim from those two accessions.
func TestRule2_ALongChiefTitleIsAnOfficerPosition(t *testing.T) {
	body := `<HTML><BODY>
<P ALIGN="center"><B>MANAGEMENT</B></P>
<P><B>Executive Officers and Directors</B></P>
<TABLE>
<TR><TD>Name</TD><TD>Age</TD><TD>Position</TD></TR>
<TR><TD>Steven J. Sell</TD><TD>51</TD><TD>Director, Chief Executive Officer and President</TD></TR>
<TR><TD>Veeral Desai</TD><TD>38</TD><TD>Chief Strategy and Development Officer</TD></TR>
<TR><TD>Lisa Dombro</TD><TD>62</TD><TD>Chief Experience &amp; Innovation Officer</TD></TR>
<TR><TD>Benjamin Kornitzer, M.D.</TD><TD>41</TD><TD>Chief Medical and Quality Officer</TD></TR>
<TR><TD>Jonathan D. Spangler</TD><TD>40</TD><TD>Chief Patent Counsel</TD></TR>
<TR><TD>Michelle A. Gourdine, M.D.</TD><TD>58</TD><TD>Director</TD></TR>
</TABLE>
<P>Steven J. Sell has served as our Chief Executive Officer since June 2020.</P>
<P>Veeral Desai has served as our Chief Strategy and Development Officer since 2019.</P>
<P>Lisa Dombro has served as our Chief Experience &amp; Innovation Officer since 2019.</P>
<P>Benjamin Kornitzer, M.D. has served as our Chief Medical and Quality Officer since 2018.</P>
<P>Jonathan D. Spangler has served as our Chief Patent Counsel since 2004.</P>
<P>Michelle A. Gourdine, M.D. has served as a member of our board of directors since 2021.</P>
</BODY></HTML>`
	e := ExtractManagement([]byte(sgmlHeader + sgmlDoc("424B4", body)))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
	}
	for _, c := range []struct{ name, section string }{
		{"Steven J. Sell", SectionOfficer},
		{"Veeral Desai", SectionOfficer},
		{"Lisa Dombro", SectionOfficer},
		{"Benjamin Kornitzer", SectionOfficer},
		{"Jonathan D. Spangler", SectionOfficer},
		{"Michelle A. Gourdine", SectionDirector},
	} {
		if p := person(t, e, c.name); p.Section != c.section {
			t.Errorf("%s section = %q, want %q (position=%q)",
				c.name, p.Section, c.section, squash(p.Position))
		}
	}
	if e.Filing.NDirectors != 1 {
		t.Errorf("n_directors = %d, want 1", e.Filing.NDirectors)
	}
}

// ---------------------------------------------------------------------------
// Rule 4 — a bio may open with a bare honorific and a surname
// ---------------------------------------------------------------------------

// Object Design 1996 (0000950135-96-002496) writes EVERY bio in the section
// with a bare honorific lead-in -- "Mr. Bay has been a director of the Company
// since 1988." -- so the name never appears in the bio at all. All three of
// attachBios' routes want a name: the prefix routes want the table's spelling
// and reBioLeadIn wants "<Name>. Mr. <Surname>". Nothing matched, so every bio
// in the filing fell through to `current` and piled onto the first officer,
// leaving eleven of twelve people with no bio and both of the filing's VC
// directors (Bay, Marks) unreachable.
//
// The second half of the same defect is tense: both VC bios date the
// partnership "From 1980 to 1996" / "From 1984 to 1996" in a filing FILED in
// 1996, and then say "has been", so reVCPastLead's closed-range alternative
// read a present partnership as closed.
//
// Verbatim from the filing, officers between Goldman and Bay elided.
const asciiHonorificLeadInExcerpt = `                                   MANAGEMENT
 
EXECUTIVE OFFICERS AND DIRECTORS
 
<TABLE>
     The following table sets forth certain information with respect to the executive officers 
and directors of the Company:
<CAPTION>

    NAME                             AGE                        POSITION
    ----                             ---                        --------
    <S>                               <C>  <C>
    Robert N. Goldman..............   47   President, Chief Executive Officer and Director
    Lacey P. Brandt................   38   Chief Financial Officer
    Gerald B. Bay(1)...............   56   Director
    Arthur J. Marks(2).............   51   Director
    Tim R. Palmer(1)...............   38   Director
    Steven C. Walske...............   44   Director
<FN>
 
- ---------------
(1) Member of the Audit Committee
</TABLE>
 
     Mr. Goldman was elected President and Chief Executive Officer of the
Company in November 1995. He has been a director of Object Design since August
1995.
 
     Ms. Brandt joined Object Design as Chief Financial Officer in April 1996.
From September 1995 to April 1996, Ms. Brandt served as Director of Finance,
Controller and Treasurer of International Integration Inc., a systems
integration company.
 
     Mr. Bay has been a director of the Company since 1988. From 1980 to 1996,
Mr. Bay has a been Managing Partner of The Vista Group, a venture capital firm.
Mr. Bay served as interim President of the Company from August to November 1995.
 
     Mr. Marks has been a director of the Company since 1990. From 1984 to 1996,
Mr. Marks has been a General Partner of New Enterprise Associates, a venture
capital firm. Mr. Marks is a director of AMISYS Managed Care Systems, Inc.,
Platinum Software, Inc., NETRIX Corporation, and Progress Software Corporation.
 
     Mr. Palmer has been a director of the Company since February 1996. Since
1990, Mr. Palmer has held several positions at the Harvard Private Capital
Group, Inc., most recently as Managing Director.
 
     Mr. Walske has been a director of the Company since 1994. Since 1994, Mr.
Walske has been Chairman of the Board and Chief Executive Officer of Parametric
Technology Corporation, a mechanical design automation software firm.
`

func TestRule4_BareHonorificLeadInAttachesTheBio(t *testing.T) {
	raw := sgmlHeaderFor("OBJECT DESIGN INC") +
		sgmlDoc("424B4", asciiHonorificLeadInExcerpt+"\nEXECUTIVE COMPENSATION\n")
	e := ExtractManagement([]byte(raw))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
	}
	for _, c := range []struct{ name, want string }{
		{"Robert N. Goldman", "was elected President and Chief Executive Officer"},
		{"Lacey P. Brandt", "joined Object Design as Chief Financial Officer"},
		{"Gerald B. Bay", "Managing Partner of The Vista Group"},
		{"Arthur J. Marks", "General Partner of New Enterprise Associates"},
		{"Tim R. Palmer", "Harvard Private Capital"},
		{"Steven C. Walske", "Chairman of the Board and Chief Executive Officer of Parametric"},
	} {
		p := person(t, e, c.name)
		if !containsFold(p.Bio, c.want) {
			t.Errorf("%s bio = %q, want it to carry %q", c.name, squash(p.Bio), c.want)
		}
	}
	// No bio may bleed past its own person.
	if g := person(t, e, "Robert N. Goldman"); containsFold(g.Bio, "Vista Group") {
		t.Errorf("Bay's bio landed on Goldman: %q", squash(g.Bio))
	}
	// A closed range that ends in the filing year, followed by "has been", is a
	// present partnership.
	for _, c := range []struct{ name, firm string }{
		{"Gerald B. Bay", "Vista Group"},
		{"Arthur J. Marks", "New Enterprise Associates"},
	} {
		p := person(t, e, c.name)
		if !p.VCAffiliated {
			t.Errorf("%s vc = false, want true (bio=%q)", c.name, squash(p.Bio))
		} else if !containsFold(p.VCFirm, c.firm) {
			t.Errorf("%s vc firm = %q, want %q", c.name, squash(p.VCFirm), c.firm)
		}
	}
	// Palmer's Harvard endowment arm and Walske's software company are not
	// venture firms, and Goldman's own bio names no firm at all.
	for _, n := range []string{"Robert N. Goldman", "Lacey P. Brandt", "Tim R. Palmer", "Steven C. Walske"} {
		if p := person(t, e, n); p.VCAffiliated {
			t.Errorf("%s vc = true off %q", n, squash(p.VCEvidence))
		}
	}
}

// The typographic apostrophe EDGAR HTML writes as &#146;/&#8217; is part of the
// name, not spacing furniture. Scale Venture Partners' Rory T. O’Driscoll
// (0001193125-12-126304) is one row in the dev split whose emitted name differed
// from the filing's own bytes, and a downstream join on the name saw two
// different people. Folding it to an ASCII apostrophe is a loss of the source
// text; the possessive tests that read "the company’s founders" must therefore
// accept both characters rather than assume the fold happened.
func TestRule3_TypographicApostropheSurvivesInTheName(t *testing.T) {
	const curly = "’"
	body := `<HTML><BODY>` + strings.Replace(
		strings.Replace(miniMgmtSection, "Alan Turing", "Rory T. O"+curly+"Driscoll", -1),
		"Ada Lovelace</I> has served as our Chief Executive Officer since 1843.",
		"Ada Lovelace</I> is one of the company"+curly+"s founders and has served as our Chief Executive Officer since 1843.", 1) +
		`</BODY></HTML>`
	e := ExtractManagement([]byte(sgmlHeaderFor("Analytic Engine Corp") + sgmlDoc("424B4", body)))

	want := "Rory T. O" + curly + "Driscoll"
	p := person(t, e, want)
	if p.Name != want {
		t.Errorf("name = %q, want %q", p.Name, want)
	}
	if p.NameRaw != want {
		t.Errorf("name_raw = %q, want %q", p.NameRaw, want)
	}

	// The fold was load-bearing for the possessive patterns; widening them is
	// half the fix, so the same test pins it.
	if ceo := person(t, e, "Ada Lovelace"); !ceo.FounderSelfDescribed {
		t.Errorf("founder_self_described = false for a bio reading \"the company%ss founders\" (evidence=%q, bio=%q)",
			curly, ceo.FounderEvidence, trunc(ceo.Bio))
	}
}

// The 1990s filings label a firm without the ", a venture capital firm"
// appositive both routes read: the label sits AFTER the name, either bare on the
// far side of the defined-term parenthetical ("Kowaliga Capital, Inc.
// (\"Kowaliga\") venture capital and fund management companies") or in a relative
// clause ("Artesian Capital Limited Partnership II (\"Artesian Capital II\"),
// which are seed and start-up venture investment funds"). Neither firm is in the
// dictionary and neither name ends in "Ventures", so the post-positioned label is
// the only VC signal either bio carries.
//
// The label alone cannot fire, because the entity it labels may be a portfolio
// fund the person has nothing to do with: the lead has to put the person at a
// partner-grade seat, and "principal" counts only here, gated on the label. Gold
// excludes Arda Minocherhomjee, "a Principal" of William Blair, in
// 0001047469-04-017088, where no label follows the firm at all.
//
// Bios are quoted verbatim from the accession named on each line, and exercised
// through detectVC because check_full.sh re-cuts every fixture from a source
// filing this corpus does not hold.
func TestRule7_APostPositionedVentureLabelFires(t *testing.T) {
	positive := []struct{ accession, bio, firm string }{
		{"0000950144-98-004643",
			"Charles E. Adair joined the Company's Board of Directors in January 1998. From 1993 until present, Mr. Adair has been a principal of Cordova Capital II, Inc. (\"Cordova\") and Kowaliga Capital, Inc. (\"Kowaliga\") venture capital and fund management companies, where he serves as manager of venture capital funds. Cordova and Kowaliga are the general partners of Cordova Capital Partners, L.P. -- Enhanced Appreciation (\"Cordova -- Enhanced Appreciation\"), a venture capital fund and shareholder of the Company.",
			"Kowaliga"},
		{"0000950131-96-003098",
			"Frank B. Bennett has been a director of the Company since 1992. Mr. Bennett is the founder of Artesian Capital Management, Inc. (\"Artesian\") and Artesian Management, Inc. (\"Artesian Management\") and has served as the President of each of these entities since their inception. Artesian is the general partner of Artesian Capital Limited Partnership (\"Artesian Capital\"), and Artesian Management is the general partner of Artesian Capital Limited Partnership II (\"Artesian Capital II\"), which are seed and start-up venture investment funds.",
			"Artesian"},
		{"0000950130-03-004056",
			"Henry Shaw has served on our board of directors since September 2000. Since August 1996, Mr. Shaw has served as the Executive Managing Director of AsiaVest Partners, TCW/YFY (Taiwan), Ltd., which specializes in venture capital investment, where Mr. Shaw is responsible for assessing potential investments. Mr. Shaw was Vice President of Tanspac Capital Pte. Ltd., which specializes in regional equity investment, from 1993 to 1996 and the Chief Financial Officer of Mosel-Vitelic, Inc., a publicly-listed semiconductor memory company in Taiwan, from 1984 to 1993.",
			"AsiaVest"},
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
		{"0001047469-04-017088", "a Principal at a firm the filing never labels",
			"Arda M. Minocherhomjee, Ph.D. has served as a member of our board of directors since May 2001. Since 1992, Dr. Minocherhomjee has served in various capacities for William Blair & Company, L.L.C., including, most recently, as a Principal."},
		{"constructed", "no seat at the labelled entity, only a board seat at a company it backed",
			"Mr. Doe has served as our Chief Executive Officer since 2011. He was appointed to the board by Acme Holdings, Inc. (\"Acme\") venture capital and fund management companies."},
		{"constructed", "the principalship closed out before the filing",
			"Mr. Doe was a principal of Acme Holdings, Inc. (\"Acme\"), which is a venture capital fund."},
	}
	for _, c := range negative {
		t.Run("no/"+c.why, func(t *testing.T) {
			if ok, firm, ev := detectVC(c.bio); ok {
				t.Errorf("%s: vc_affiliated = true, want false (firm=%q evidence=%q)", c.accession, firm, ev)
			}
		})
	}
}

// Rallybio's 2021 prospectus (0001193125-21-230254) elides the founder's own
// object and shares it with the coordinated clause: "is a co-founder of, and has
// been Chief Executive Officer and Chairman of the board of directors of
// Rallybio since January 2018". Three of that filing's bios are written this
// way, so the referent has to be read at the LAST "of" of the sentence rather
// than at the connector.
func TestRule6_GappedCoordinationSharesTheFoundersObject(t *testing.T) {
	cases := []struct {
		name      string
		conformed string
		bio       string
		want      bool
	}{
		{"mackay", "Rallybio Corp", "Ada Lovelace, Ph.D., is a co-founder of, and has been Chief Executive Officer and Chairman of the board of directors of Rallybio since January 2018.", true},
		{"uden", "Rallybio Corp", "Ada Lovelace, M.D., is a co-founder of, and has been President, Chief Operating Officer and Chief Scientific Officer of Rallybio since January 2018.", true},
		{"fryer", "Rallybio Corp", "Ada Lovelace, CPA, is a co-founder of, and has been Chief Financial Officer and Treasurer of Rallybio since January 2018.", true},
		// The shared object is a DIFFERENT company whose name starts with the
		// issuer's first word — the prefix guard still has to hold.
		{"other-company", "Cascade Microtech Inc", "Ada Lovelace is a co-founder of, and has been Chief Executive Officer of, Cascade Communications Corporation, a networking company.", false},
		// The founder's object is present, so nothing is elided and the route
		// must not reach past it to a later "of".
		{"object-present", "Uber Technologies, Inc", "Ada Lovelace founded Red Swoosh and later served as an advisor of Uber Technologies.", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := ExtractManagement([]byte(sgmlHeaderFor(c.conformed) +
				sgmlDoc("424B4", "<HTML><BODY>"+mgmtSectionWithCEOBio(c.bio)+"</BODY></HTML>")))
			if e.Filing.Status != StatusOK {
				t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
			}
			p := person(t, e, "Ada Lovelace")
			if !containsFold(p.Bio, "found") {
				t.Fatalf("bio does not carry the founder sentence\n  bio = %q", p.Bio)
			}
			if p.FounderSelfDescribed != c.want {
				t.Errorf("founder_self_described = %v, want %v (evidence=%q bio=%q)",
					p.FounderSelfDescribed, c.want, p.FounderEvidence, p.Bio)
			}
		})
	}
}

// The same elision written WITHOUT the comma, and with the shared object at the
// FIRST "of" rather than the last. NorthPoint Communications (0000929624-99-000832)
// writes six bios as "is a founder and has been the <title> of NorthPoint", and
// Context Therapeutics (0001193125-21-303138) writes "is the Co-founder and Chief
// Executive Officer of Context Therapeutics and member of our board of directors",
// where the LAST "of" is "board of directors" and only an earlier one is the
// referent.
func TestRule6_GappedCoordinationWithoutACommaAndAtAnEarlierOf(t *testing.T) {
	cases := []struct {
		name      string
		conformed string
		bio       string
		want      bool
	}{
		{"northpoint", "NORTHPOINT COMMUNICATIONS GROUP INC", "Ada Lovelace is a founder and has been the Chief Executive Officer and Chairman of NorthPoint since June 1997.", true},
		{"context", "Context Therapeutics Inc.", "Ada Lovelace is the Co-founder and Chief Executive Officer of Context Therapeutics and member of our board of directors since its founding in 2015.", true},
		// The coordinated clause's object is a DIFFERENT company, so no "of" in
		// the sentence names the issuer.
		{"other-company", "Acme Bio Inc", "Ada Lovelace is a founder and has been a General Partner of Foo Ventures since 1999.", false},
		// The founder's own object is present, so nothing is elided.
		{"object-present", "Uber Technologies, Inc", "Ada Lovelace founded Red Swoosh and later served as an advisor of Uber Technologies.", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := ExtractManagement([]byte(sgmlHeaderFor(c.conformed) +
				sgmlDoc("424B4", "<HTML><BODY>"+mgmtSectionWithCEOBio(c.bio)+"</BODY></HTML>")))
			if e.Filing.Status != StatusOK {
				t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
			}
			p := person(t, e, "Ada Lovelace")
			if !containsFold(p.Bio, "found") {
				t.Fatalf("bio does not carry the founder sentence\n  bio = %q", p.Bio)
			}
			if p.FounderSelfDescribed != c.want {
				t.Errorf("founder_self_described = %v, want %v (evidence=%q bio=%q)",
					p.FounderSelfDescribed, c.want, p.FounderEvidence, p.Bio)
			}
		})
	}
}

// The issuer named by its own INITIALS. Virtual Radiologic Corp's 2007 prospectus
// (0001193125-07-248004) writes its CEO's founding twice, and only the second
// reaches the issuer: "since co-founding VRP's predecessor", where VRP is the
// filing's defined term for the predecessor LLC, and "Prior to co-founding VRC",
// which is the header name's initials.
func TestRule6_FounderFiresOnIssuerAcronym(t *testing.T) {
	cases := []struct {
		name      string
		conformed string
		bio       string
		want      bool
	}{
		{"vrc", "Virtual Radiologic CORP", "Ada Lovelace has served as our Chief Executive Officer and Chairman of the Board of Directors, or the equivalent, since co-founding VRP's predecessor in May 2001. Prior to co-founding VRC, Ada Lovelace was an associate professor at the University of Minnesota.", true},
		// A defined term for something ELSE that shares two of the issuer's
		// initials must not fire on its own.
		{"vrp-alone", "Virtual Radiologic CORP", "Ada Lovelace has served as our Chief Executive Officer since co-founding VRP's predecessor in May 2001.", false},
		// Two initials are too little to identify a company.
		{"two-initials", "Virtual Radiologic CORP", "Ada Lovelace co-founded VR in May 2001 and has served as our Chief Executive Officer since then.", false},
		// The initials of a different company entirely.
		{"other-acronym", "BEYOND MEAT, INC.", "Ada Lovelace co-founded IBM in 1911 and has served as our Chief Executive Officer since 1843.", false},
		// Lower case is a word, not an acronym.
		{"lowercase", "Virtual Radiologic CORP", "Ada Lovelace co-founded vrc in May 2001 and has served as our Chief Executive Officer since then.", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := ExtractManagement([]byte(sgmlHeaderFor(c.conformed) +
				sgmlDoc("424B4", "<HTML><BODY>"+mgmtSectionWithCEOBio(c.bio)+"</BODY></HTML>")))
			if e.Filing.Status != StatusOK {
				t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
			}
			p := person(t, e, "Ada Lovelace")
			if !containsFold(p.Bio, "found") {
				t.Fatalf("bio does not carry the founder sentence\n  bio = %q", p.Bio)
			}
			if p.FounderSelfDescribed != c.want {
				t.Errorf("founder_self_described = %v, want %v (evidence=%q bio=%q)",
					p.FounderSelfDescribed, c.want, p.FounderEvidence, p.Bio)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Rule 1 — a second <CAPTION> inside one <TABLE> is not the end of the table
// ---------------------------------------------------------------------------

// UbiquiTel (0000912057-00-027832) writes both of its blocks inside a single
// ASCII <TABLE>: "EXECUTIVE OFFICERS AND DIRECTORS:" with eight rows, then
// "OTHER KEY EMPLOYEES:" with a SECOND <CAPTION> re-declaring the NAME / AGE /
// POSITION header over Gerstenberg and Zylka. asciiLine blanks an SGML marker
// to spaces of the same width, so that <CAPTION> line read as the second blank
// line and ended the table two rows early — the filing's only defect, and the
// one row in the dev split where the parser's own person count differs from
// gold's.
//
// Table and bio openers are quoted verbatim from that accession.
const asciiSecondCaptionExcerpt = `                                   MANAGEMENT

EXECUTIVE OFFICERS, DIRECTORS AND OTHER KEY EMPLOYEES

    The following table presents information with respect to our executive
officers, directors and other key employees.

EXECUTIVE OFFICERS AND DIRECTORS:

<TABLE>
<CAPTION>
NAME                                      AGE                         POSITION
<S>                                     <C>        <C>
    Donald A. Harris..................     47      Chairman of the Board, President and Chief
                                                   Executive Officer
    Dean E. Russell...................     48      Chief Operating Officer
    Paul F. Judge.....................     34      Senior Vice President--Corporate Development
                                                   and Finance
    Andrew W. Buffmire................     53      Senior Vice President--Business Development
    Robert A. Berlacher...............     45      Director
    Peter Lucas.......................     45      Director
    Eve M. Trkla......................     37      Director
    Joseph N. Walter..................     47      Director

OTHER KEY EMPLOYEES:

<CAPTION>
NAME                                      AGE                         POSITION
<S>                                     <C>        <C>
    Debra A. Gerstenberg..............     36      Vice President of Human Resources
    David L. Zylka....................     39      Vice President of Engineering
</TABLE>

    DONALD A. HARRIS has served as President and Chief Executive Officer and as
a director since our inceptions and was appointed Chairman of the Board in
May 2000.

    DEAN E. RUSSELL has been our Chief Operating Officer since February 2000.

    PAUL F. JUDGE has been our Senior Vice President--Corporate Development and
Finance since March 2000.

    ANDREW W. BUFFMIRE has been our Senior Vice President--Business Development
since April 2000.

    ROBERT A. BERLACHER has been one of our directors since October 1999.

    PETER LUCAS has been one of our directors since October 1999.

    EVE M. TRKLA has been one of our directors since March 2000.

    JOSEPH N. WALTER has been one of our directors since October 1999.

    DEBRA A. GERSTENBERG has been our Vice President of Human Resources since
January 2000. She reports to our Chief Operating Officer and is responsible for
implementing and directing the functions of employee relations, compensation,
benefits, training, equal employment opportunity, staffing and payroll.

    DAVID L. ZYLKA has been our Vice President of Engineering since January
2000. He reports to our Chief Operating Officer and is responsible for the
quality and technical performance of all network operations.
`

func TestRule1_ASecondCaptionDoesNotEndTheAsciiTable(t *testing.T) {
	raw := sgmlHeaderFor("UBIQUITEL INC") +
		sgmlDoc("424B4", asciiSecondCaptionExcerpt+"\nEXECUTIVE COMPENSATION\n")
	e := ExtractManagement([]byte(raw))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 10 {
		t.Fatalf("len(persons) = %d, want 10 (8 officers and directors + 2 key employees): %v",
			len(e.Persons), personNames(e))
	}
	// The re-declared header line must not become an eleventh person or a
	// section label that files the two key employees under a column name.
	for _, p := range e.Persons {
		if containsFold(p.Name, "AGE") || containsFold(p.Name, "POSITION") {
			t.Errorf("the second caption's header row produced the person %q: %v",
				squash(p.Name), personNames(e))
		}
	}
	for _, name := range []string{"Debra A. Gerstenberg", "David L. Zylka"} {
		p := person(t, e, name)
		if p.Section != SectionKeyEmployee {
			t.Errorf("%s: section = %q, want %q", name, p.Section, SectionKeyEmployee)
		}
		if !containsFold(p.Bio, "since January") {
			t.Errorf("%s: bio = %q, want the bio that opens with the January 2000 date",
				name, squash(p.Bio))
		}
	}
	// The eight rows above the second caption keep their own classification:
	// four bare "Director" cells, and Harris an officer under rule 2.
	if got := countSection(e, SectionDirector); got != 4 {
		t.Errorf("directors = %d, want 4 (Berlacher, Lucas, Trkla, Walter): %v", got, personNames(e))
	}
	if got := countSection(e, SectionKeyEmployee); got != 2 {
		t.Errorf("key employees = %d, want 2: %v", got, personNames(e))
	}
	if got := squash(e.Filing.CEOName); got != "Donald A. Harris" {
		t.Errorf("ceo_name = %q, want %q", got, "Donald A. Harris")
	}
	for i, p := range e.Persons {
		if p.Seq != i+1 {
			t.Errorf("persons[%d].Seq = %d, want %d", i, p.Seq, i+1)
		}
	}
}

// "Principal" is a partner-grade seat when the firm's OWN NAME carries the
// venture label. TScan 2021 (0001193125-21-218024) writes the whole signal in
// one sentence -- "Dr. Shangari has served as a Principal at the Novartis
// Venture Fund since 2018" -- and gold counts her. The name-labelled route
// could already read "Novartis Venture Fund", but it anchors on a
// partner-grade role and "Principal" was in neither role list: the only place
// the word counted was the post-positioned-label route.
//
// The gate stays the firm, not the word. Gold excludes "a Principal" of William
// Blair (0001047469-04-017088), a principal of Global Retail Partners, L.P.
// (0001012870-99-002065) and Silver Lake's founding principal
// (0001193125-20-249257) -- in each the firm is neither labelled venture nor
// named for it.
//
// Bios are quoted verbatim from the accession named on each line, and exercised
// through detectVC because check_full.sh re-cuts every fixture from a source
// filing this corpus does not hold.
func TestRule7_APrincipalAtAVentureNamedFirmFires(t *testing.T) {
	positive := []struct{ accession, bio, firm string }{
		{"0001193125-21-218024",
			"Nandita Shangari, Ph.D. has served as a member of our board of directors since September 2020. Dr. Shangari has served as a Principal at the Novartis Venture Fund since 2018. Prior to joining NVF, she was part of the Novartis Oncology Business Development and Licensing team from 2017 to 2018 where she managed key alliances for the Oncology Portfolio.",
			"Novartis Venture Fund"},
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
		{"0001012870-99-002065", "a principal of a firm neither labelled nor named venture",
			"Linda Fayne Levinson has served as a director of the Company since June 1997. Ms. Levinson is a principal of Global Retail Partners, L.P. and related funds, which are private equity investors."},
		{"0001193125-20-249257", "a founding principal of a firm the filing calls private equity",
			"Egon Durban has served as a member of our board of directors since June 2019. Mr. Durban is a Co-Chief Executive Officer and Managing Partner of Silver Lake, a global private equity firm, where he has been a founding principal since 1999."},
		{"constructed", "the principalship closed out before the filing",
			"Mr. Doe was previously a Principal at the Acme Venture Fund."},
		// The date range that closes the seat sits AFTER the venture-named firm,
		// which is the shape the three appositive routes already veto and this
		// one did not. The lead says "Prior to that, Dr. Murdoch served as a",
		// but 35 bytes of it is all the past-tense window reads and "served" is
		// not a past marker, so the range is the only evidence in reach.
		{"0001140361-21-013962", "the principalship ran 2017 to 2018 and the seat now is an investment directorship",
			"Travis Murdoch, M.D. has served on our board of directors since September 2020. Dr. Murdoch has served as an Investment Director at Softbank Investment Advisers since January 2018, where he focuses on life sciences investments. Prior to that, Dr. Murdoch served as a Principal at Third Rock Ventures from 2017 to 2018, where he was part of the founding teams of Ambys Medicines and Rheos Medicines."},
	}
	for _, c := range negative {
		t.Run("no/"+c.why, func(t *testing.T) {
			if ok, firm, ev := detectVC(c.bio); ok {
				t.Errorf("%s: vc_affiliated = true, want false (firm=%q evidence=%q)", c.accession, firm, ev)
			}
		})
	}
}

// The appositive can sit on the far side of the date the affiliation started:
// "a co-founder of BOLD Capital Partners in 2015, a venture fund investing in
// exponential technologies" (0001193125-21-328157). The firm name runs back from
// the date phrase, not from the comma, and the lead role is a bare founder — the
// only grade a person can hold at a fund they started.
func TestRule7_AppositiveAfterStartDate(t *testing.T) {
	const bio = "Dr. Diamandis has started more than 24 companies in the areas of human longevity, " +
		"space, venture capital and education, including as a co-founder of BOLD Capital Partners " +
		"in 2015, a venture fund investing in exponential technologies, and as the founder and " +
		"Executive Chairman of the XPRIZE Foundation, a non-profit."
	ok, firm, ev := detectVC(bio)
	if !ok || !strings.Contains(firm, "BOLD Capital Partners") {
		t.Errorf("vc = %v firm = %q, want BOLD Capital Partners (evidence=%q)", ok, firm, ev)
	}
}

// The venture label can be written BEFORE the firm name, where every existing
// route is blind to it: the appositive routes read back from a label that
// follows the name, and the venture-named route wants the word inside the name.
// "Co-Managing Partner of venture capital fund DCVC" (0001140361-21-013962) and
// "founded two venture capital firms, North Bridge Venture Partners in May 1993,
// where he currently serves as a Managing Partner" (0001193125-21-221914) both
// label the firm in words and then name it.
//
// The grade is read off the label's WHOLE sentence rather than the lead,
// because North Bridge's partnership is written on the far side of the name.
// Bios are quoted verbatim from the accession named on each line.
func TestRule7_VentureLabelBeforeTheFirmName(t *testing.T) {
	positive := []struct{ accession, bio, firm string }{
		{"0001140361-21-013962",
			"Matthew A. Ocko has served on our board of directors since June 2015. Mr. Ocko is the " +
				"Co-Founder and Co-Managing Partner of venture capital fund DCVC since 2011, where his " +
				"investments span computational and synthetic biology, geospatial and space access " +
				"platforms, robotics, applied artificial intelligence, antiterror systems and large-scale " +
				"enterprise platforms including quantum computers.",
			"DCVC"},
		{"0001193125-21-221914",
			"Mr. Anderson has served as a member of our board of directors since January 2020. " +
				"Mr. Anderson founded two venture capital firms, North Bridge Venture Partners in May 1993, " +
				"where he currently serves as a Managing Partner focusing on early-stage high-tech " +
				"companies, and North Bridge Growth Equity in February 2007.",
			"North Bridge Venture Partners"},
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

	// Constructed, not quoted. The label alone is no affiliation: the sentence
	// has to put the person in a partner-grade seat at the firm, in the present.
	negative := []string{
		"Mr. Doe serves on the board of directors of venture capital firm Sequoia Growth LLC.",
		"Prior to joining us, Mr. Doe was a Managing Partner of venture capital firm Sequoia Growth LLC.",
	}
	for _, bio := range negative {
		t.Run("no", func(t *testing.T) {
			if ok, firm, ev := detectVC(bio); ok {
				t.Errorf("fired on %q: firm=%q evidence=%q", bio, firm, ev)
			}
		})
	}
}

// The founding written as a PARTICIPLE, and as a formation verb. Coaxmedia
// (0000950133-00-004018) writes three bios as "Prior to co-founding our company",
// which the -ed-only pattern could not read, and Corinthian Colleges
// (0001017062-99-000150) writes "Immediately prior to forming the Company". The
// same-company referent still carries the whole guard: the SAME Coaxmedia filing
// says "Prior to co-founding Baker Communications" of a director, and a company's
// SALES ORGANISATION is not the company.
func TestRule6_ParticipleAndFormationVerbReachTheIssuer(t *testing.T) {
	cases := []struct {
		name string
		bio  string
		want bool
	}{
		{"co-founding", "Ada Lovelace has served as our President, Chief Executive Officer and Chairman of the board of directors since our inception. Prior to co-founding our company, Ms. Lovelace served as Vice President and general manager of 3Com Corporation's Broadband Access Communications Division from August 1995 to August 1997.", true},
		{"forming", "Ada Lovelace has served as President and Chief Executive Officer and a Director of the Company since its inception in July 1995. Immediately prior to forming the Company, she was President of National Education Centers, Inc., a subsidiary of National Education Corporation.", true},
		{"hyphen-wrapped", "Ada Lovelace is a general partner of Baker Communications Fund, L.P. Prior to co- founding our company, she was a private equity investor.", true},
		{"other-company", "Ada Lovelace is a general partner of Baker Communications Fund, L.P., a private equity fund. Prior to co-founding Baker Communications, Ms. Lovelace consulted for various venture capital firms and start-up companies.", false},
		{"possessive-object", "Ada Lovelace was responsible for forming the Company's sales organization from 1995 to 1998 and has served as our Chief Executive Officer since 1999.", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := ExtractManagement([]byte(sgmlHeaderFor("Coaxmedia Inc") +
				sgmlDoc("424B4", "<HTML><BODY>"+mgmtSectionWithCEOBio(c.bio)+"</BODY></HTML>")))
			if e.Filing.Status != StatusOK {
				t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
			}
			p := person(t, e, "Ada Lovelace")
			if !containsFold(p.Bio, "form") && !containsFold(p.Bio, "found") {
				t.Fatalf("bio does not carry the founding sentence\n  bio = %q", p.Bio)
			}
			if p.FounderSelfDescribed != c.want {
				t.Errorf("founder_self_described = %v, want %v (evidence=%q bio=%q)",
					p.FounderSelfDescribed, c.want, p.FounderEvidence, p.Bio)
			}
		})
	}
}

// Coinmach Laundry 1996 (0000950130-96-002646) writes its fixed-width table with
// the AGE column LAST -- "NAME  TITLE  AGE" -- so a header pattern that requires
// AGE before POSITION finds no table and the whole filing comes back
// no_mgmt_table: no CEO, no persons, nothing. The column ORDER is not part of the
// geometry the parser depends on; the <S>/<C> marker line under the caption
// carries the real column offsets in either order. Verbatim.
const asciiAgeLastExcerpt = `                                  MANAGEMENT
 
EXECUTIVE OFFICERS AND DIRECTORS
 
  The directors and executive officers of the Company are:
 
<TABLE>
<CAPTION>
                NAME                                 TITLE                   AGE
                ----                                 -----                   ---
   <S>                             <C>                                       <C>
   Stephen R. Kerrigan............ Chairman of the Board and Chief            42
                                   Executive Officer, Director
   Mitchell Blatt................. President, Chief Operating Officer,        44
                                   Director
   Robert M. Doyle................ Chief Financial Officer, Senior Vice       39
                                   President Treasurer, Secretary
   John E. Denson................. Senior Vice President--Corporate           58
                                   Development
   Michael E. Stanky.............. Senior Vice President                      44
   R. Daniel Osborne.............. Area Vice President                        40
   David A. Siegel................ Area Vice President                        38
   Bruce V. Rauner................ Director                                   40
   David A. Donnini............... Director                                   31
   James N. Chapman............... Director                                   34
</TABLE>
 
  Pursuant to the terms of a Stockholders Agreement (the "SAS Stockholders
Agreement"), dated July 26, 1995, amended and restated as of November 30,
1995, among the Company, GTCR and the stockholders of the Company at such time
(the "SAS Stockholders"), the right of certain of the SAS Stockholders to
elect members of the Board as set forth therein automatically terminates upon
an initial public offering of the Company's common stock having an aggregate
offering value of at least $25 million. Upon the consummation of the Offering,
holders of the Common Stock of the Company prior to the Offering, who, after
consummation of the Offering will own in the aggregate approximately 60.5% of
the outstanding Common Stock, will enter into the Voting Agreement, providing
for, among other things, the designation and nomination of directors of the
Company by such stockholders. Pursuant to the Voting Agreement, each of the
stockholders party to such agreement will agree to vote its shares in favor of
the individuals designated below and to cause such individuals to be selected
as nominees to the Board, in accordance with the Bylaws of the Company, as
amended, with the effect that, at any given time, the directors of the Company
shall initially be comprised of: (i) two individuals designated by GTCR, (ii)
two members of the Company's management or employees or officers of the
Company, in each case, designated by the holders of a majority of the Common
Stock held by the executive officers (the "Executives") of the Company, which
individuals initially shall be Stephen R. Kerrigan (the "Management Director")
and Mitchell Blatt ("Blatt" and, together with the Management Director, the
"Executive Directors") (the designation of the Executive Director that will be
the Management Director shall be determined by the holders of a majority of
the Common Stock held by the Executives), and, (iii) one individual to be
jointly designated by GTCR and the Management Director, who initially shall be
James N. Chapman.
 
  The Board will be divided into three classes as nearly equal in number as
possible. Within 90 days of consummation of the Offering, the Company shall
appoint up to two additional directors who are not employees or affiliates of
the Company. At each annual meeting of stockholders, successors to the class
of directors whose term expires at such meeting will be elected to serve for
three-year terms or until their successors are duly elected and qualified. The
Board has the power to appoint the officers of the Company. Each officer will
hold office for such terms as may be prescribed by the Board and until such
person's successor is chosen and qualified or until such person's death,
resignation or removal.
 
BACKGROUND AND EXPERIENCE
 
  Mr. Kerrigan has been Chief Executive Officer of the Company since April,
1996, and of Coinmach since November, 1995. Mr. Kerrigan was President and
Treasurer of Solon and the Company from April, 1995 until April, 1996, and
Chief Executive Officer of TCC from January, 1995, until November, 1995. Mr.
Kerrigan was
 
                                      42
<PAGE>
 
appointed Chairman of the Board of the Company in April, 1995 and of Coinmach
in November, 1995. Mr. Kerrigan has been a director of the Company's
predecessor, TCC, since January, 1995 and of Solon since April, 1995. Mr.
Kerrigan served as Vice President and Chief Financial Officer of TCC's
predecessor from 1987 until 1994. Mr. Kerrigan was an executive officer of CIC
which filed a voluntary petition for reorganization under Chapter 11 of the
United States Bankruptcy Code in 1993.
 
  Mr. Blatt has been President and Chief Operating Officer of the Company
since April, 1996 and of Coinmach since November, 1995 and its predecessor,
TCC, since January, 1995. Mr. Blatt has been a director of the Company and
Coinmach since November, 1995. Mr. Blatt joined Coinmach's predecessor as Vice
President-General Manager in 1982 and was Vice President and Chief Operating
Officer from January 1988 to February 1994. Mr. Blatt was an executive officer
of CIC, which filed a voluntary petition for reorganization under Chapter 11
of the United States Bankruptcy Code in 1993.
 
  Mr. Doyle has been Chief Financial Officer, Senior Vice President and
Secretary of the Company since April, 1996 and Chief Financial Officer, Senior
Vice President, Treasurer and Secretary of Coinmach since November, 1995. Mr.
Doyle served as Vice President, Treasurer and Secretary of Coinmach's
predecessor since January, 1995. Mr. Doyle joined Coinmach's predecessor in
1987 as Controller. In 1988, he became Director of Accounting, and was
promoted in 1989 to Vice President and Controller. Mr. Doyle was an executive
officer of CIC which filed a voluntary petition for reorganization under
Chapter 11 of the United States Bankruptcy Code in 1993.
 
  Mr. Denson has been Senior Vice President of the Company since April, 1996
and of Coinmach since November, 1995. Mr. Denson was Senior Vice President,
Finance of Solon from June, 1987 until the Merger. He has served as an officer
of Solon under various titles since 1973. He served as a director and Co-Chief
Executive Officer of Solon from November, 1994 to April, 1995.
 
  Mr. Stanky has been Senior Vice President of the Company since April, 1996
and of Coinmach since November, 1995. Mr. Stanky has been Senior Vice
President of Solon since July, 1995. He joined Solon in 1976 as a sales
manager. Mr. Stanky served Solon in various capacities since 1976, and in 1985
was promoted to Area Vice President responsible for the South-Central Region.
Mr. Stanky served as a Co-Chief Executive Officer from November, 1994 to
April, 1995.
 
  Mr. Osborne has been Area Vice President of the Company since April, 1996
and of Coinmach since November, 1995. Mr. Osborne has served Solon in various
capacities since 1987. In July, 1995, he was promoted to Area Vice President
responsible for the Southeast Region.
 
  Mr. Siegel has been Area Vice President of the Company since April, 1996 and
of Coinmach since November, 1995. Mr. Siegel joined Solon in 1985 as a sales
manager. Mr. Siegel served Solon in various capacities since 1985, and in
August, 1995 was promoted to Area Vice President responsible for the Mid-
Atlantic Region.
 
  Mr. Rauner has been a Director of the Company since April, 1995, Coinmach
since November, 1995 and its predecessor, TCC, since January, 1995. Mr. Rauner
serves as a director of ERO, Inc., COREStaff, Inc. and Polymer Group, Inc. Mr.
Rauner has been a Principal and General Partner with GTCR since 1984, where he
is responsible for originating and making new investments, monitoring
portfolio companies and recruiting and training associates.
 
  Mr. Donnini has been a Director of the Company since April, 1995, Coinmach
since November 1995 and its predecessor, TCC, since January, 1995. Mr. Donnini
serves as a director of Polymer Group, Inc. Mr. Donnini has been a Principal
of GTCR since 1993. From 1991 to 1993, Mr. Donnini was an Associate with GTCR.
 
  Mr. Chapman has been a Director of the Company since April, 1995, Coinmach
since November 1995 and its predecessor, TCC, since January, 1995. Mr. Chapman
was a Principal of Fieldstone Private Capital Group, L.P. from its inception
in 1990 through May 30, 1996.
 
 
                                      43`

func TestRule1_AsciiAgeColumnMayComeLast(t *testing.T) {
	raw := sgmlHeaderFor("COINMACH LAUNDRY CORP") +
		sgmlDoc("424B1", asciiAgeLastExcerpt+"\n\nEXECUTIVE COMPENSATION\n")
	e := ExtractManagement([]byte(raw))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q: NAME/TITLE/AGE is the same table as NAME/AGE/POSITION read right to left",
			e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 10 {
		t.Errorf("len(persons) = %d, want 10: %v", len(e.Persons), personNames(e))
	}
	if got := squash(e.Filing.CEOName); got != "Stephen R. Kerrigan" {
		t.Errorf("ceo_name = %q, want %q", got, "Stephen R. Kerrigan")
	}
	// The position cell sits BETWEEN the name and the age here, and its
	// continuation line carries the word that makes Kerrigan a director.
	if got := squash(person(t, e, "Stephen R. Kerrigan").Position); got != "Chairman of the Board and Chief Executive Officer, Director" {
		t.Errorf("Kerrigan position = %q, want the joined cell", got)
	}
	// Rauner, Donnini and Chapman hold nothing but a board seat. Kerrigan and
	// Blatt are officers whose cell ALSO says Director; sectionForPosition puts
	// the officer first by design, so gold's five board seats are three here.
	if n := countSection(e, "director"); n != 3 {
		t.Errorf("directors = %d, want 3 (Rauner, Donnini, Chapman)", n)
	}
	if got := person(t, e, "Mitchell Blatt").Section; got != "officer" {
		t.Errorf("Blatt section = %q, want officer", got)
	}
	// GTCR is the company's equity sponsor, never called venture, and
	// Fieldstone Private Capital Group is unlabelled: no VC directors at all.
	for _, p := range e.Persons {
		if p.VCAffiliated {
			t.Errorf("%s vc_affiliated = 1, want 0: %q", squash(p.Name), squash(p.VCEvidence))
		}
	}
}

// The venture label written ONLY in the board-qualification sentence that
// Item 401(e) makes every post-2006 prospectus carry. Two dev filings label
// their director's firm nowhere else: Aisling Capital is introduced bare ("has
// been a partner at Aisling Capital since 2008") and its venture nature is
// stated as "his experience in the biopharmaceutical industry as a venture
// capital investor ... give him the qualifications" (0001193125-12-307785), and
// SV Health Investors carries the appositive "an investment firm focused on
// healthcare investing" with "because of his experience in venture capital in
// the life sciences industry" doing the labelling (0001104659-21-128952).
//
// The sentence is the person's own, so rule 7's scope holds; the firm is the
// proper-noun run after a present partner-grade role. Bios quoted verbatim.
func TestRule7_QualificationSentenceLabelsTheFirm(t *testing.T) {
	positive := []struct{ accession, bio, firm string }{
		{"0001193125-12-307785",
			"Dov A. Goldstein, M.D. has served as a member of our board of directors since " +
				"December 2009. Dr. Goldstein has been a partner at Aisling Capital since 2008 and was " +
				"employed as a principal at Aisling Capital from 2006 to 2008. From 2000 to 2005, " +
				"Dr. Goldstein served as Chief Financial Officer of Vicuron Pharmaceuticals Inc., which " +
				"was acquired by Pfizer in September 2005. We believe that Dr. Goldstein’s medical " +
				"training and his experience in the biopharmaceutical industry as a venture capital " +
				"investor, as an executive of Vicuron and a member of the boards of directors of other " +
				"biopharmaceutical companies give him the qualifications and skills to serve as a director, " +
				"including a valuable perspective on our business.",
			"Aisling Capital"},
		{"0001104659-21-128952",
			"Michael Ross, Ph.D. has served as a member of our board of directors since February 2020. " +
				"Since 2002, Dr. Ross has served as managing partner at SV Health Investors fka SV Life " +
				"Sciences, an investment firm focused on healthcare investing. Prior to joining SV Health, " +
				"Mike held various positions including serving as CEO of several private biotechnology " +
				"companies and as a Vice President at Genentech, Inc., a public biotechnology company, " +
				"from 1978 to 1990. We believe Dr. Ross is qualified to serve on our board of directors " +
				"because of his experience in venture capital in the life sciences industry.",
			"SV Health Investors"},
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

	// Quoted verbatim, and each one is a firm gold does NOT count. The route
	// transfers a label onto a firm the filing never labels, so it only runs
	// where the transfer has one target: a qualification sentence naming a second
	// asset class does not say which firm supplied which (Vulcan Capital, "the
	// venture capital and private equity industries"; Francisco Partners, "the
	// private equity and venture capital industries"), and a bio that labels some
	// OTHER firm as venture has already accounted for the sentence (Vulcan's
	// director sat at "Lazard Technology Partners ... an Internet and technology
	// focused venture capital firm"; TPG Growth's ran "the Qualcomm Life Fund, a
	// venture fund" until 2017).
	negativeQuoted := []struct{ accession, bio string }{
		{"0001047469-14-004991",
			"Abhishek Agrawal has served as a member of our board of directors since November 2013. " +
				"Since April 2013, Mr. Agrawal has served as Managing Director at Vulcan Capital, an " +
				"investment management firm, and head of its Palo Alto office. Prior to General Atlantic " +
				"LLC, Mr. Agrawal was with Lazard Technology Partners, or Lazard, an Internet and " +
				"technology focused venture capital firm, and previously served in Lazard’s investment " +
				"banking group. We believe Mr. Agrawal is qualified to serve as a member of our board of " +
				"directors because of his substantial corporate finance, business strategy and corporate " +
				"development expertise gained from his significant experience in the venture capital and " +
				"private equity industries, analyzing, investing in, serving on the boards of, and " +
				"providing guidance to various technology companies."},
		{"0001193125-20-253358",
			"Dipanjan Deb has served as a member of our board of directors since October 2015. Mr. Deb " +
				"is a founder of Francisco Partners and has served as the Managing Partner/Chief " +
				"Executive Officer of Francisco Partners since September 2005. Prior to founding " +
				"Francisco Partners, Mr. Deb was a principal at TPG Capital, a private equity firm. " +
				"We believe that Mr. Deb is qualified to serve as a member of our board of directors " +
				"because of his experience in the private equity and venture capital industries " +
				"analyzing, investing in and serving on the boards of directors of manufacturing and " +
				"technology companies."},
		{"0001193125-21-230254",
			"Lucian Iancovici, M.D., has served as a member of our board of directors since May 2020. " +
				"Dr. Iancovici is currently a Managing Director of TPG Growth, where he has worked since " +
				"January 2018. From September 2012 to October 2017, Dr. Iancovici served as the head of " +
				"the Qualcomm Life Fund, a venture fund focused on investing in digital health " +
				"technologies. We believe that Dr. Iancovici is qualified to serve on our board of " +
				"directors because of his extensive experience in the venture capital industry, and his " +
				"medical and scientific background and training."},
	}
	for _, c := range negativeQuoted {
		t.Run("no/"+c.accession, func(t *testing.T) {
			if ok, firm, ev := detectVC(c.bio); ok {
				t.Errorf("%s: fired, firm=%q evidence=%q", c.accession, firm, ev)
			}
		})
	}

	// Constructed, not quoted. The qualification sentence is a LABEL and never an
	// affiliation on its own: the seat still has to be partner-grade and present,
	// and a bio with no such sentence keeps the behaviour it had before.
	negative := []string{
		"Mr. Doe has served on our board since 2015. Prior to joining us, Mr. Doe was a partner " +
			"at Aisling Capital. We believe Mr. Doe is qualified to serve on our board of directors " +
			"because of his experience in venture capital.",
		"Mr. Doe has served on our board since 2015. Mr. Doe has been an advisor to Aisling Capital " +
			"since 2008. We believe Mr. Doe is qualified to serve on our board of directors because " +
			"of his experience in venture capital.",
		"Mr. Doe has served on our board since 2015. Mr. Doe has been a partner at Aisling Capital " +
			"since 2008. We believe Mr. Doe is qualified to serve on our board of directors because " +
			"of his experience in the life sciences industry.",
	}
	for _, bio := range negative {
		t.Run("no", func(t *testing.T) {
			if ok, firm, ev := detectVC(bio); ok {
				t.Errorf("fired on %q: firm=%q evidence=%q", bio, firm, ev)
			}
		})
	}
}

// Rule 7, both directions of the tense test read on the FAR side of the firm
// name. A date range written after the appositive settles the seat, and the two
// rows it settles point opposite ways.
//
// The veto side: "served as a Managing Director at OpenView Venture Partners, a
// venture capital firm, from October 2013 to September 2014"
// (0001193125-19-249577) closes the seat, but the venture-named route never saw
// it — ventureFirmAfter consumes the comma that ends the firm name, so the
// appositive that follows opens on a bare space and closedRangeAfterFirm's
// appositive skip, which anchors at offset 0, could not match.
//
// The escape side: "he was a General Partner with Oak Investment Partners, a
// venture capital firm, from 1999 until the present" (0001193125-20-316022)
// writes "he was" in the lead and then contradicts it on the far side, leaving
// the seat open. Gold counts Riley. Two things vetoed it: the appositive route
// read reVCClosedRangeTail raw, without the open-range escape closedRangeAt
// already runs, and the past-tense lead had no way to yield to an open range.
func TestRule7_ARangeAfterTheAppositiveSettlesTheSeatBothWays(t *testing.T) {
	negative := []struct{ accession, why, bio string }{
		{"0001193125-19-249577", "the venture-named route missed the closed range past its own comma",
			"Dev Ittycheria has served as a member of our board of directors since February 2014. Mr. Ittycheria has served as President and Chief Executive Officer of MongoDB, Inc. and as a member of its board of directors since September 2014. Prior to joining MongoDB, Mr. Ittycheria served as a Managing Director at OpenView Venture Partners, a venture capital firm, from October 2013 to September 2014. From February 2012 to June 2013, Mr. Ittycheria served as Venture Partner at Greylock Partners, a venture capital firm."},
	}
	for _, c := range negative {
		t.Run("no/"+c.why, func(t *testing.T) {
			if ok, firm, ev := detectVC(c.bio); ok {
				t.Errorf("%s: vc_affiliated = true, want false (firm=%q evidence=%q)", c.accession, firm, ev)
			}
		})
	}

	positive := []struct{ accession, why, bio, firm string }{
		{"0001193125-20-316022", "the open range on the far side outlives the past-tense lead",
			"Prior to Enclave, from 2015 to 2019, he was a partner and member of the executive committee with Robertson Stephens, an independent registered investment advisor. Prior to Robertson Stephens, he was a General Partner with Oak Investment Partners, a venture capital firm, from 1999 until the present. Mr. Riley also currently serves on the board of several private companies.",
			"Oak Investment Partners"},
		// The boundary the veto side must not cross. Gold COUNTS this venture
		// partnership even though the bio closes it out two years before the
		// filing, and the sentence carries no past marker for the closed range
		// to corroborate — so a closed range read past the appositive cannot
		// veto on its own.
		{"0001193125-18-208021", "a closed range alone does not end a seat gold counts",
			"Mr. Lynch has served as the interim chief executive officer of Surface Oncology, Inc., a pharmaceutical company, since September 2016. He served as a venture partner at Third Rock Ventures, a venture capital firm, from May 2013 to December 2016 and as an entrepreneur-in-residence from 2011 to May 2013.",
			"Third Rock Ventures"},
	}
	for _, c := range positive {
		t.Run("yes/"+c.why, func(t *testing.T) {
			ok, firm, ev := detectVC(c.bio)
			if !ok || !strings.Contains(firm, c.firm) {
				t.Errorf("%s: vc_affiliated = %v firm = %q, want true / %q (evidence=%q)",
					c.accession, ok, firm, c.firm, ev)
			}
		})
	}
}

// Affiliated Managers Group 1997 (0000950135-97-004756) runs its MANAGEMENT
// section as MANAGEMENT / EXECUTIVE OFFICERS / EXECUTIVE COMPENSATION /
// DIRECTORS, all four at the left margin and in the same capitals. Its own
// table of contents gives "Management....55" with "Certain Transactions....64"
// next, so the board table under DIRECTORS is INSIDE the section and the
// compensation heading between them is a sub-heading written to look like a
// successor. Two things break on it: the section closes at EXECUTIVE
// COMPENSATION, and the board table has no POSITION column at all -- its
// caption is NAME and AGE only, with the heading above it saying what the rows
// are. The filing then yields 7 people where the prospectus says "all directors
// and executive officers as a group (12 persons)", and not one director.
//
// Both slices are verbatim. Elided between them: the six remaining officer bios
// (the trailing "(1)"/"(2)" footnotes of the officers table included), and after
// them the board's remaining five bios.
const asciiCompHeadingOfficersExcerpt = `
                                   MANAGEMENT
 
EXECUTIVE OFFICERS
 
     The names, ages and positions of each of the executive officers of the
Company, as well as a description of their business experience and past
employment are as set forth below:
 
<TABLE>
<CAPTION>
             NAME                AGE                       POSITION
- ------------------------------   ---    -----------------------------------------------
<S>                              <C>    <C>
William J. Nutt...............   52     President, Chief Executive Officer and Chairman
                                        of the Board of Directors
Sean M. Healey................   36     Executive Vice President
Levon Chertavian, Jr. ........   38     Senior Vice President, Affiliate Support
Nathaniel Dalton..............   31     Senior Vice President, General Counsel and
                                        Secretary
Brian J. Girvan...............   42     Senior Vice President, Chief Financial Officer
                                        and Treasurer
Seth W. Brennan...............   27     Vice President
Jeffrey S. Murphy.............   31     Vice President
</TABLE>
 
     William J. Nutt founded the Company in December 1993 and has served as its
Chairman, President and Chief Executive Officer since that time. Mr. Nutt began
his career at the law firm of Ballard, Spahr, Andrews & Ingersoll in
Philadelphia, where he was a Partner until he joined The Boston Company in 1982.
As Senior Executive Vice President of that firm, Mr. Nutt built The Boston
Company's mutual fund administration, distribution and custody business serving
over 45 fund sponsors with assets of $119.0 billion. In 1989, he became
President, assuming overall responsibility for The Boston Company's $36.0
billion institutional money management business, its $190.0 billion master
trustee and custodian business, and the personal banking and trust business of
the Boston Safe Deposit and Trust Company. Mr. Nutt received a J.D. from the
University of Pennsylvania and a B.A. from Grove City College. From 1991 to
1994, Mr. Nutt served on the Executive Committee of the Board of Governors of
the Investment Company Institute.
 
`

const asciiCompHeadingDirectorsExcerpt = `EXECUTIVE COMPENSATION
 
     The following table sets forth information concerning the cash compensation
awarded to the Company's Chief Executive Officer and the Company's four (4)
other most highly compensated executive officers whose total salary and bonus
exceeded $100,000 during the fiscal year ended December 31, 1996 (collectively,
the "Named Executive Officers").
 
                        1996 SUMMARY COMPENSATION TABLE
 
<TABLE>
<CAPTION>
                                                             1996 ANNUAL
                                                             COMPENSATION
                                                         --------------------       ALL OTHER
             NAME AND PRINCIPAL POSITION                  SALARY      BONUS      COMPENSATION(1)
- ------------------------------------------------------   --------    --------    ----------------
<S>                                                      <C>         <C>         <C>
William J. Nutt, Chairman, President and Chief
  Executive Officer...................................   $354,350    $315,000        $ 26,750
Sean M. Healey, Executive Vice President..............    270,460     277,500          26,750
Levon Chertavian, Jr., Senior Vice President..........    159,227     116,667          24,813
Nathaniel Dalton, Senior Vice President (2)...........     98,498     100,000          17,068
Seth W. Brennan, Vice President.......................     56,277      55,000          15,806
</TABLE>
 
- ---------------
 
(1) Includes (i) contributions by the Company under its 401(k) Profit Sharing
    Plan in the amount of $22,500 on behalf of each of Messrs. Nutt, Healey and
    Chertavian, $14,755 on behalf of Mr. Dalton and $14,375 on behalf of Mr.
    Brennan; and (ii) the dollar value of insurance premiums paid by the Company
    with respect to term life and long term disability insurance policies for
    the benefit of the Named Executive Officers in the amount of $4,250 on
    behalf of Messrs. Nutt and Healey, $2,313 on behalf of Messrs. Chertavian
    and Dalton and $1,431 on behalf of Mr. Brennan.
 
(2) Mr. Dalton's employment with the Company commenced in May 1996.
 
                                       56
<PAGE>   57
 
DIRECTORS
 
     The names, ages and a description of the business experience, principal
occupation and past employment during at least the last five years of each of
the directors of the Company are set forth below.
 
<TABLE>
<CAPTION>
                                         NAME                                    AGE
        ----------------------------------------------------------------------   ---
        <S>                                                                      <C>
        William J. Nutt(1)....................................................   52
        Richard E. Floor(2)...................................................   57
        Roger B. Kafker(2)(3).................................................   35
        P. Andrews McLane(1)(3)...............................................   50
        John M. B. O'Connor(1)(3).............................................   43
        W. W. Walker, Jr.(2)(3)...............................................   50
</TABLE>
 
- ---------------
 
(1) Member of the Compensation Committee.
 
(2) Member of the Audit Committee.
 
(3) Messrs. McLane, Kafker, Walker and O'Connor were elected as directors in
    accordance with the terms of a certain Amended and Restated Stockholders'
    Agreement dated as of October 9, 1997 (the "Stockholders' Agreement") among
    the Company and certain of the Company's stockholders, including TA
    Associates, NationsBank, The Hartford and Chase Equity Associates, which was
    entered into in connection with the recent equity investment by Chase Equity
    Associates in the Company. These provisions of the Stockholders' Agreement
    will be terminated upon consummation of the Offerings.
 
     For Mr. Nutt's biographical information, see information under "--Executive
Officers".
 
     Richard E. Floor has been a director of the Company since its formation. A
professional corporation of which Mr. Floor is the sole stockholder is and has
been a partner at the law firm of Goodwin, Procter & Hoar LLP or its predecessor
since 1975. Mr. Floor is also a director of Town & Country Corporation, a
jewelry manufacturer, and New America High Income Fund, a closed-end investment
company.
 
`

func TestRule1_AsciiCompensationSubHeadingDoesNotCloseTheSection(t *testing.T) {
	raw := sgmlHeaderFor("AFFILIATED MANAGERS GROUP INC") +
		sgmlDoc("424B4", asciiCompHeadingOfficersExcerpt+asciiCompHeadingDirectorsExcerpt+
			"\nCERTAIN TRANSACTIONS\n")
	e := ExtractManagement([]byte(raw))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 12 {
		t.Fatalf("len(persons) = %d, want 12 (7 officers + 6 directors, Nutt in both): %v",
			len(e.Persons), personNames(e))
	}
	// Five, not six: Nutt sits in both tables and the officer-wins rule keeps him
	// an officer, as it does for every filing whose CEO also holds a board seat.
	if got := countSection(e, SectionDirector); got != 5 {
		t.Errorf("directors = %d, want 5: the DIRECTORS heading over a NAME/AGE table sections its rows: %v",
			got, personNames(e))
	}
	if got := squash(e.Filing.CEOName); got != "William J. Nutt" {
		t.Errorf("ceo_name = %q, want %q", got, "William J. Nutt")
	}
	if !e.Filing.CEOFounderSelfDescribed {
		t.Errorf("ceo_founder_self_described = 0, want 1: %q", squash(e.Filing.CEOFounderEvidence))
	}
	// A person reached only through the second table must carry the bio that
	// follows it, exactly as a first-table person does.
	floor := person(t, e, "Richard E. Floor")
	if !containsFold(floor.Bio, "a director of the Company since its formation") {
		t.Errorf("Richard E. Floor bio = %q, want the sentence opening his board service", squash(floor.Bio))
	}
	// Nutt sits in both tables and must be one person, not two.
	n := 0
	for _, p := range e.Persons {
		if squash(p.Name) == "William J. Nutt" {
			n++
		}
	}
	if n != 1 {
		t.Errorf("William J. Nutt appears %d times, want 1: %v", n, personNames(e))
	}
	// The five people the SUMMARY COMPENSATION table names sit between the two
	// person tables and must not become people: the section reaches through that
	// table, and only the AGE column keeps its rows out.
	if got := len(e.Persons); got != 12 {
		t.Errorf("len(persons) = %d after the compensation table: %v", got, personNames(e))
	}
}

// Groupon 2011 (0001047469-11-009142) sets the Name header and each section
// label with COLSPAN=2 over a spacer column while every body name cell sits in
// the second of the two. The grid then holds a column 0 filled only by the
// colspan shadow of "Officers:" and "Directors:", and a left-most-wins Name
// column reads that shadow: two section rows, no people, status no_mgmt_table.
// Name is the candidate column the BODY fills, not the left-most one.
func TestRule1_ColspanShadowIsNotTheNameColumn(t *testing.T) {
	const section = `<P ALIGN="center"><B>MANAGEMENT</B></P>
<P><B>Officers and Directors</B></P>
<TABLE>
<TR><TH COLSPAN=2 ALIGN="LEFT">Name</TH><TH></TH><TH COLSPAN=2 ALIGN="CENTER">Age</TH><TH></TH><TH>Position</TH></TR>
<TR><TD COLSPAN=2>Officers:</TD><TD></TD><TD></TD><TD></TD><TD></TD><TD></TD></TR>
<TR><TD></TD><TD>Ada Lovelace</TD><TD></TD><TD></TD><TD>36</TD><TD></TD><TD>Co-Founder, Chief Executive Officer and Director</TD></TR>
<TR><TD></TD><TD>Grace Hopper</TD><TD></TD><TD></TD><TD>45</TD><TD></TD><TD>Chief Financial Officer</TD></TR>
<TR><TD COLSPAN=2>Directors:</TD><TD></TD><TD></TD><TD></TD><TD></TD><TD></TD></TR>
<TR><TD></TD><TD>Alan Turing</TD><TD></TD><TD></TD><TD>41</TD><TD></TD><TD>Director</TD></TR>
<TR><TD></TD><TD>Charles Babbage</TD><TD></TD><TD></TD><TD>52</TD><TD></TD><TD>Director</TD></TR>
</TABLE>
<P><I>Ada Lovelace</I> has served as our Chief Executive Officer since 1843.</P>`
	e := ExtractManagement([]byte(sgmlHeader + sgmlDoc("424B4", "<HTML><BODY>"+section+"</BODY></HTML>")))
	if e.Filing.Status != StatusOK {
		t.Fatalf("status = %q, want %q", e.Filing.Status, StatusOK)
	}
	if len(e.Persons) != 4 {
		t.Fatalf("len(persons) = %d, want 4: %v", len(e.Persons), personNames(e))
	}
	if got := squash(e.Filing.CEOName); got != "Ada Lovelace" {
		t.Errorf("ceo_name = %q, want %q", got, "Ada Lovelace")
	}
	// The section labels must still govern: the colspan shadow is a Name-column
	// artefact, not a reason to lose the Officers:/Directors: split.
	if p := person(t, e, "Grace Hopper"); p.Section != SectionOfficer {
		t.Errorf("Grace Hopper section = %q, want %q", p.Section, SectionOfficer)
	}
	if p := person(t, e, "Alan Turing"); p.Section != SectionDirector {
		t.Errorf("Alan Turing section = %q, want %q", p.Section, SectionDirector)
	}
	for _, bad := range []string{"Officers:", "Directors:"} {
		if _, ok := findPerson(e, bad); ok {
			t.Errorf("section row %q became a person", bad)
		}
	}
}

// The appositive that names a captive fund writes "the ... venture ... arm of
// <parent>": a DEFINITE article and "arm" for a head noun, neither of which any
// appositive route accepts. Gold counts these seats — S.R. One in two filings
// and Taiho Ventures in a third — and the indefinite "a ... corporate venture
// fund" that reCorporateVenture vetoes is a different claim: that one describes
// a fund the person built inside an operating company, this one names the
// parent's standing investment house.
func TestVCCorporateArmAppositive(t *testing.T) {
	for _, c := range []struct{ acc, firm, bio string }{
		{"0001047469-19-003926", "S.R. One, Limited",
			"Vikas Goyal has served as a member of our board of directors since June 2016. Mr. Goyal is currently a Principal at S.R. One, Limited, the corporate venture capital arm of GlaxoSmithKline plc, in Cambridge, Massachusetts, where he manages investments in innovative drug discovery and development companies. He joined S.R. One, Limited in January 2011."},
		{"0001193125-18-208021", "S.R. One, Limited",
			"Brian M. Gallagher, Jr., Ph.D. has served as a member of our board of directors since 2011. Since 2010, Dr. Gallagher has served as a partner at S.R. One, Limited, the corporate venture capital arm of GlaxoSmithKline. From 2008 until 2010, Dr. Gallagher worked at Sirtris Pharmaceuticals, Inc., a biotechnology company that was acquired by GlaxoSmithKline in 2008."},
		// The head of a captive arm is titled President, not managing partner.
		// The SAME bio carries a past arm seat with a closed range (Astellas,
		// "from April 2012 until January 2016"), which must not be credited.
		{"0001193125-21-145768", "Taiho Ventures, LLC",
			"Sakae Asanuma, C.F.A., has served on our board of directors since August 2019. Mr. Asanuma established and has served since April 2016 as President of Taiho Ventures, LLC, the corporate venture arm of Taiho Pharmaceutical Co., Ltd., a Japanese specialty pharmaceutical company focusing on oncology, allergy and immunology and urology. Previously, Mr. Asanuma was President and Chief Executive Officer at Astellas Venture Management LLC, the corporate venture capital arm of Astellas Pharma, Inc. from April 2012 until January 2016, and U.S. Head of Astellas Innovation Management from 2013 to 2015."},
	} {
		ok, firm, ev := detectVC(c.bio)
		if !ok {
			t.Errorf("%s: detectVC = false, want the corporate arm %q", c.acc, c.firm)
			continue
		}
		if firm != c.firm {
			t.Errorf("%s: firm = %q, want %q (ev %q)", c.acc, firm, c.firm, ev)
		}
	}
	// The indefinite "corporate venture fund" veto stays: MRL Ventures is a fund
	// built inside Merck and gold does not count it.
	probe := "Dr. Resnick previously served as a Partner at SV Health Investors from January 2016 to September 2018 and as President and Managing Partner at MRL Ventures Fund, an early-stage therapeutics-focused corporate venture fund that he built and managed within Merck & Co., from 2014 to January 2016."
	if ok, firm, ev := detectVC(probe); ok {
		t.Errorf("MRL Ventures: detectVC = true firm=%q ev=%q, want false", firm, ev)
	}
}

// ---------------------------------------------------------------------------
// bio-misalignment — a parenthetical nickname between the name's tokens
// ---------------------------------------------------------------------------

// Two filings write the CEO's name one way in the table and another in the bio
// lead-in, and the difference is a parenthesised alias sitting BETWEEN the name
// tokens. Upland's table says "John T. McDonald" while the bio opens "John T.
// (Jack) McDonald has served as ..."; Prelude's table says "Kris Vaddi, Ph.D."
// while the bio opens "Krishna (“Kris”) Vaddi, Ph.D. has served as ...".
// Neither prefix route can see it — the block key carries "jack"/"krishna" the
// table key has not got — reBioLeadIn wants "<Name>. Mr.", and the bare
// honorific route is not reached because it only runs for a person with no bio
// and claims a block opening "Mr. <Surname>". So the CEO of each filing came
// out with NO bio at all, which cost founder_self_described in both
// (0001193125-14-401545 "Prior to founding Upland in 2010";
// 0001193125-20-254577 "as our founder and Chief Executive Officer").
//
// The two need OPPOSITE repairs: Upland's table name is the alias DROPPED,
// Prelude's is the alias SUBSTITUTED for the given name before it.
//
// Verbatim, table rows between the CEO and the last director elided.
const parenNicknameUpland = `<P STYLE="margin-top:0pt; margin-bottom:0pt; font-size:10pt; font-family:ARIAL" ALIGN="center"><B><A NAME="rom710680_12"></A>MANAGEMENT </B></P>
<P STYLE="margin-top:12pt; margin-bottom:0pt; text-indent:4%; font-size:10pt; font-family:Times New Roman">The following table sets forth the name, age and position of each of our executive officers and directors as of October 31, 2014. </P>
<P STYLE="font-size:12pt;margin-top:0pt;margin-bottom:0pt">&nbsp;</P>
<TABLE CELLSPACING="0" CELLPADDING="0" WIDTH="100%" BORDER="0" STYLE="BORDER-COLLAPSE:COLLAPSE; font-family:Times New Roman; font-size:10pt" ALIGN="center">


<TR>
<TD WIDTH="38%"></TD>
<TD VALIGN="bottom" WIDTH="2%"></TD>
<TD WIDTH="2%"></TD>
<TD VALIGN="bottom" WIDTH="2%"></TD>
<TD WIDTH="56%"></TD></TR>
<TR STYLE="font-family:Times New Roman; font-size:8pt">
<TD VALIGN="bottom" NOWRAP ALIGN="center" STYLE="border-bottom:1.00pt solid #000000"> <P STYLE="margin-top:0pt; margin-bottom:1pt; font-size:8pt; font-family:Times New Roman" ALIGN="center"><B>Name</B></P></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom" NOWRAP ALIGN="center" STYLE="border-bottom:1.00pt solid #000000"> <P STYLE="margin-top:0pt; margin-bottom:1pt; font-size:8pt; font-family:Times New Roman" ALIGN="center"><B>Age</B></P></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom" ALIGN="center" STYLE="border-bottom:1.00pt solid #000000"> <P STYLE="margin-top:0pt; margin-bottom:1pt; font-size:8pt; font-family:Times New Roman" ALIGN="center"><B>Position</B></P></TD></TR>


<TR BGCOLOR="#cceeff" STYLE="font-family:Times New Roman; font-size:10pt">
<TD VALIGN="top"> <P STYLE="margin-left:1.00em; text-indent:-1.00em; font-size:10pt; font-family:Times New Roman"><B><I>Executive Officers</I></B></P></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom"></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom"></TD></TR>
<TR STYLE="font-family:Times New Roman; font-size:10pt">
<TD VALIGN="top"> <P STYLE="margin-left:3.00em; text-indent:-1.00em; font-size:10pt; font-family:Times New Roman">John T. McDonald</P></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom" NOWRAP ALIGN="center">51</TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom">Chief Executive Officer and Chairman of the Board</TD></TR>
<TR STYLE="font-family:Times New Roman; font-size:10pt">
<TD VALIGN="top"> <P STYLE="margin-left:1.00em; text-indent:-1.00em; font-size:10pt; font-family:Times New Roman"><B><I>Non-Employee Directors</I></B></P></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom"></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom"></TD></TR>
<TR STYLE="font-family:Times New Roman; font-size:10pt">
<TD VALIGN="top"> <P STYLE="margin-left:3.00em; text-indent:-1.00em; font-size:10pt; font-family:Times New Roman">Rodney C. Favaron</P></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom" NOWRAP ALIGN="center"> <P STYLE="margin-top:0pt; margin-bottom:1pt; font-size:10pt; font-family:Times New Roman" ALIGN="center">51</P></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom"> <P STYLE="margin-top:0pt; margin-bottom:1pt; font-size:10pt; font-family:Times New Roman">Director</P></TD></TR>
</TABLE> <P STYLE="margin-top:18pt; margin-bottom:0pt; font-size:10pt; font-family:Times New Roman"><B>Executive Officers </B></P>
<P STYLE="margin-top:6pt; margin-bottom:0pt; text-indent:4%; font-size:10pt; font-family:Times New Roman"><I>John T. (Jack) McDonald</I> has served as our Chief Executive Officer and Chairman of our board of directors since our founding in July
2010. Prior to founding Upland in 2010, Mr.&nbsp;McDonald was Chief Executive Officer of Perficient, Inc. (NASDAQ: PRFT), an information technology consulting firm, from 1999 to 2009, and chairman from 2001 to 2010. Mr.&nbsp;McDonald started his
career as an attorney with Skadden, Arps, Slate, Meagher&nbsp;&amp; Flom LLP in New York, focusing on mergers and acquisitions and corporate finance, from 1987 to 1993. Mr.&nbsp;McDonald currently serves as chairman of the Greater Austin Chamber of
Commerce and is a member of the board of directors of a number of privately held companies and non-profit organizations. Mr.&nbsp;McDonald received a B.A. in Economics from Fordham University and a J.D. from Fordham Law School. </P>
<P STYLE="margin-top:12pt; margin-bottom:0pt; text-indent:4%; font-size:10pt; font-family:Times New Roman">We believe that Mr.&nbsp;McDonald is qualified to serve as a member of our board of directors because of his experience as our Chief Executive
Officer and his background in the technology industry, including serving as chairman of a public technology company. </P>
`

// Verbatim, table rows between the CEO and the last director elided.
const parenNicknamePrelude = `<P STYLE="margin-top:0pt; margin-bottom:0pt; font-size:10pt; font-family:Times New Roman" ALIGN="center"><FONT COLOR="#344274"><B><A NAME="rom935180_13"></A>MANAGEMENT </B></FONT></P>
<P STYLE="margin-top:12pt; margin-bottom:0pt; font-size:10pt; font-family:Times New Roman"><FONT COLOR="#344274"><B>Executive Officers and Directors </B></FONT></P>
<P STYLE="margin-top:6pt; margin-bottom:0pt; text-indent:4%; font-size:10pt; font-family:Times New Roman"><FONT COLOR="#344274">The following table provides information, including ages as of August&nbsp;21, 2020, regarding our executive officers and
directors: </FONT></P> <P STYLE="font-size:12pt;margin-top:0pt;margin-bottom:0pt">&nbsp;</P>
<TABLE CELLSPACING="0" CELLPADDING="0" WIDTH="100%" BORDER="0" STYLE="BORDER-COLLAPSE:COLLAPSE; font-family:Times New Roman; font-size:10pt" ALIGN="center">


<TR>

<TD WIDTH="35%"></TD>

<TD VALIGN="bottom" WIDTH="1%"></TD>
<TD></TD>
<TD></TD>
<TD></TD>

<TD VALIGN="bottom" WIDTH="1%"></TD>
<TD WIDTH="61%"></TD></TR>
<TR STYLE="page-break-inside:avoid ; font-family:Times New Roman; font-size:8pt">
<TD VALIGN="bottom" NOWRAP> <P STYLE=" margin-top:0pt ; margin-bottom:0pt; border-bottom:1.00pt solid #000000; display:table-cell; font-size:8pt; font-family:Times New Roman; "><FONT COLOR="#344274"><B>Name</B></FONT></P></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom" COLSPAN="2" NOWRAP> <P STYLE=" margin-top:0pt ; margin-bottom:0pt; border-bottom:1.00pt solid #000000; display:table-cell; font-size:8pt; font-family:Times New Roman; "><FONT COLOR="#344274"><B>Age</B></FONT></P></TD>
<TD VALIGN="bottom">&nbsp;</TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom" NOWRAP> <P STYLE=" margin-top:0pt ; margin-bottom:0pt; border-bottom:1.00pt solid #000000; display:table-cell; font-size:8pt; font-family:Times New Roman; "><FONT COLOR="#344274"><B>Position</B></FONT></P></TD></TR>


<TR BGCOLOR="#cceeff" STYLE="page-break-inside:avoid ; font-family:Times New Roman; font-size:10pt">
<TD VALIGN="top"> <P STYLE=" margin-top:0pt ; margin-bottom:0pt; margin-left:1.00em; text-indent:-1.00em; font-size:10pt; font-family:Times New Roman"><FONT COLOR="#344274"><B>Executive Officers:</B></FONT></P></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom"></TD>
<TD VALIGN="bottom"></TD>
<TD VALIGN="bottom"></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="bottom"></TD></TR>
<TR STYLE="font-size:1pt">
<TD HEIGHT="5"></TD>
<TD HEIGHT="5" COLSPAN="4"></TD>
<TD HEIGHT="5" COLSPAN="2"></TD></TR>
<TR STYLE="page-break-inside:avoid ; font-family:Times New Roman; font-size:10pt">
<TD VALIGN="top"> <P STYLE=" margin-top:0pt ; margin-bottom:0pt; margin-left:1.00em; text-indent:-1.00em; font-size:10pt; font-family:Times New Roman"><FONT COLOR="#344274">Kris Vaddi, Ph.D.</FONT></P></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="top"><FONT COLOR="#344274">&nbsp;</FONT></TD>
<TD VALIGN="top" ALIGN="right"><FONT COLOR="#344274">55</FONT></TD>
<TD NOWRAP VALIGN="top"><FONT COLOR="#344274">&nbsp;</FONT></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="top"> <P STYLE=" margin-top:0pt ; margin-bottom:0pt; margin-left:1.00em; text-indent:-1.00em; font-size:10pt; font-family:Times New Roman"><FONT COLOR="#344274">Chief Executive Officer and Director</FONT></P></TD></TR>
<TR STYLE="page-break-inside:avoid ; font-family:Times New Roman; font-size:10pt">
<TD VALIGN="top"> <P STYLE=" margin-top:0pt ; margin-bottom:0pt; margin-left:1.00em; text-indent:-1.00em; font-size:10pt; font-family:Times New Roman"><FONT COLOR="#344274">Victor Sandor, M.D.C.M.</FONT></P></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="top"><FONT COLOR="#344274">&nbsp;</FONT></TD>
<TD VALIGN="top" ALIGN="right"><FONT COLOR="#344274">53</FONT></TD>
<TD NOWRAP VALIGN="top"><FONT COLOR="#344274">&nbsp;</FONT></TD>
<TD VALIGN="bottom">&nbsp;&nbsp;</TD>
<TD VALIGN="top"> <P STYLE=" margin-top:0pt ; margin-bottom:0pt; margin-left:1.00em; text-indent:-1.00em; font-size:10pt; font-family:Times New Roman"><FONT COLOR="#344274">Director</FONT></P></TD></TR>
</TABLE> <P STYLE="margin-top:18pt; margin-bottom:0pt; margin-left:4%; font-size:10pt; font-family:Times New Roman"><FONT COLOR="#344274"><B><I>Executive Officers </I></B></FONT></P>
<P STYLE="margin-top:6pt; margin-bottom:0pt; text-indent:4%; font-size:10pt; font-family:Times New Roman"><FONT COLOR="#344274"><B>Krishna (&#147;Kris&#148;) Vaddi, Ph.D.</B> has served as our Chief Executive Officer and a member of our board of
directors since February 2016. From June 2014 to June 2016, Dr.&nbsp;Vaddi also served as Chief Executive Officer of Orsenix, LLC, a clinical stage biotechnology company. Dr.&nbsp;Vaddi previously held several roles at Incyte Corporation, most
recently as Senior Advisor from June 2015 to June 2016 and Group Vice President from March 2010 to June 2015. Dr.&nbsp;Vaddi received a BVSc in Veterinary Medicine from Acharya N.G. Ranga Agricultural University in India and a Ph.D. in Pharmacology
and Toxicology from the University of Florida. We believe that Dr.&nbsp;Vaddi&#146;s experience as our founder and Chief Executive Officer and history in the biopharmaceutical field qualifies him to serve on our board of directors. </FONT></P>
`

func TestBioParentheticalNicknameAttachesTheBio(t *testing.T) {
	for _, c := range []struct{ acc, issuer, section, ceo, bioHas string }{
		{"0001193125-14-401545", "Upland Software, Inc.", parenNicknameUpland,
			"John T. McDonald", "Prior to founding Upland in 2010"},
		{"0001193125-20-254577", "Prelude Therapeutics Inc", parenNicknamePrelude,
			"Kris Vaddi", "as our founder and Chief Executive Officer"},
	} {
		e := ExtractManagement([]byte(sgmlHeaderFor(c.issuer) +
			sgmlDoc("424B4", "<HTML><BODY>"+c.section+"</BODY></HTML>")))
		if e.Filing.Status != StatusOK {
			t.Errorf("%s: status = %q, want %q", c.acc, e.Filing.Status, StatusOK)
			continue
		}
		p, ok := findPerson(e, c.ceo)
		if !ok {
			t.Errorf("%s: no person named %q; got %v", c.acc, c.ceo, personNames(e))
			continue
		}
		if !containsFold(p.Bio, c.bioHas) {
			t.Errorf("%s: %s bio = %q, want it to carry %q",
				c.acc, c.ceo, squash(p.Bio), c.bioHas)
			continue
		}
		if !p.FounderSelfDescribed {
			t.Errorf("%s: %s founder_self_described = false, want true",
				c.acc, c.ceo)
		}
	}
}
