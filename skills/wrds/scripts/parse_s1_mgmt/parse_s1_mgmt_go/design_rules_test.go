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
		{"0001193125-19-040772", "the dictionary route read a role the bio marks previous",
			"Dr. Lu previously served as a Managing Director at OrbiMed Advisors, LLC in Asia from 2011 to 2016. Prior to her work at OrbiMed, Dr. Lu spent more than five years at Piper Jaffray & Co. as an equity analyst."},
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
		{"0001193125-21-231612",
			"JeenJoo (JJ) Kang, Ph.D. has served as a member of our board of directors since August 2016. Dr. Kang has also served as a member of our compensation committee since December 2018, as a member of our audit committee since September 2019, and as our President, Treasurer and Secretary from August 2016 to June 2018. Dr. Kang has served as a Venture Partner at The Column Group since 2020, and prior to that served as an Associate beginning in 2015, then as a Partner from 2019 to 2020.",
			"Column Group"},
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
