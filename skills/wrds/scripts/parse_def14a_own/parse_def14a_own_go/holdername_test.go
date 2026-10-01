package main

import "testing"

// Every left-hand side below is a name cell this parser EMITTED, copied from the
// -debug output of the filing named beside it. The management ownership table
// writes the holder's role, degree or footnote marker into the name cell, and
// the name is what every consumer keys on.
func TestCleanHolderNameStripsRoleDegreeAndFootnote(t *testing.T) {
	for _, tc := range []struct{ in, want, from string }{
		// trailing role clause
		{"E. Anthony Woods, Chairman of the Board", "E. Anthony Woods", "0001144204-08-016722"},
		{"John C. Hassan, Director", "John C. Hassan", "0001144204-08-016722"},
		{"Jim Albaugh Director", "Jim Albaugh", "0001193125-18-140891"},
		{"W. Douglas Parker Chairman and Chief Executive Officer", "W. Douglas Parker", "0001193125-17-150441"},
		{"Robert D. Isom, Jr. President", "Robert D. Isom, Jr.", "0001193125-17-150441"},
		{"J. Scott Kirby Former President", "J. Scott Kirby", "0001193125-17-150441"},
		{"Ernest G. Burgess III - Director", "Ernest G. Burgess III", "0001140361-23-013392"},
		{"Linda Fayne Levinson, Independent Lead Director", "Linda Fayne Levinson", "0001193125-08-052695"},
		{"Martin A. Kropelnicki Director and Executive Officer", "Martin A. Kropelnicki", "0001047469-16-012163"},
		// trailing degree
		{"Michael J. Berendt, Ph.D", "Michael J. Berendt", "0001193125-19-097303"},
		{"Laurie H. Glimcher, M.D", "Laurie H. Glimcher", "0001193125-19-097303"},
		{"James I. Healy, M.D., Ph.D", "James I. Healy", "0001564590-20-015549"},
		{"Regina E. Herzlinger, D.B.A", "Regina E. Herzlinger", "0000950137-02-001559"},
		{"Thomas M. Krummel, M.D. Director", "Thomas M. Krummel", "0001047469-16-012163"},
		// leading honorific
		{"General Joseph W. Ralston, USAF (Ret.)", "Joseph W. Ralston, USAF", "0000950149-06-000205"},
		{"Senator Donald W. Riegle, Jr", "Donald W. Riegle, Jr", "0000950131-03-001953"},
		{"Dr. Jay A. Stein", "Jay A. Stein", "0001193125-11-065578"},
		// glued footnote marker
		{"Brenda C. Barnes1 Director", "Brenda C. Barnes", "0001047469-07-001763"},
		{"Leonard P. Forman4,5 Executive Vice President and Chief Financial Officer",
			"Leonard P. Forman", "0001047469-07-001763"},
		{"Nicholas A. Mosich5", "Nicholas A. Mosich", "0001193125-11-065578"},
		// trailing parenthetical
		{"David H. Anderson (also a director)", "David H. Anderson", "0001193125-22-105360"},
		// NOT decorations: an institutional holder is built from words the role
		// clause must never claim, and a two-word person has nothing to strip.
		{"General Electric Company", "General Electric Company", "0000950123-01-505784"},
		{"Major Investments, LLC", "Major Investments, LLC", "synthetic corporate-rank guard"},
		{"Capital Research and Management Company", "Capital Research and Management Company", "-"},
		{"Wellington Management Company, LLP", "Wellington Management Company, LLP", "-"},
		{"The Vanguard Group, Inc.", "The Vanguard Group, Inc.", "-"},
		{"State Street Bank and Trust Company", "State Street Bank and Trust Company", "-"},
		{"T. Rowe Price Associates, Inc.", "T. Rowe Price Associates, Inc.", "-"},
		{"Ray Robinson", "Ray Robinson", "-"},
		{"Warren E. Buffet and Berkshire Hathaway Inc", "Warren E. Buffet and Berkshire Hathaway Inc", "-"},
		// A cell that is ONLY a role names nobody; stripping it to nothing would
		// hide that, so the two-name-words floor leaves it intact for the screen.
		{"Chief Executive Officer", "Chief Executive Officer", "-"},
	} {
		if got := cleanHolderName(tc.in); got != tc.want {
			t.Errorf("%s: cleanHolderName(%q) = %q, want %q", tc.from, tc.in, got, tc.want)
		}
	}
}

// ScreenRows must apply the cleanup to holder rows and leave a group row's
// collective label — every word of which is a title word, and whose
// parenthetical carries the person count — exactly as extracted.
func TestScreenCleansHolderNamesButNotGroupRows(t *testing.T) {
	rows := []Row{
		{HolderName: "E. Anthony Woods, Chairman of the Board", TableIndex: 1129,
			RowIndex: 8, Shares: pf(66014)},
		{HolderName: "Steven C. Straus, Chief Executive Officer, Director", TableIndex: 1129,
			RowIndex: 9, Shares: pf(7500)},
		{HolderName: "All directors and executive officers as a group (18 persons)",
			TableIndex: 1129, RowIndex: 20, Shares: pf(3275466), IsGroupRow: true, GroupN: 18},
	}
	got := ScreenRows(rows)
	if len(got) != 3 {
		t.Fatalf("want 3 rows, got %d: %s", len(got), names(got))
	}
	if got[0].HolderName != "E. Anthony Woods" || got[1].HolderName != "Steven C. Straus" {
		t.Errorf("holder names not cleaned: %s", names(got))
	}
	if got[2].HolderName != "All directors and executive officers as a group (18 persons)" {
		t.Errorf("group label was rewritten: %q", got[2].HolderName)
	}
}
