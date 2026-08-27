package main

import (
	"sort"
	"strings"
	"testing"
)

// All fixture excerpts below are VERBATIM from
// /home/eh/projects/board-structuring/data/raw/def14a/files/, including the
// converter's apostrophe deletion and its one-cell-per-line table flattening.
// Every case is prefixed with a real director-section heading because
// directorSet only walks windows reDirSection opens.

func gotSet(body string) map[string]bool {
	out := map[string]bool{}
	for _, n := range directorSet([]byte(body)) {
		out[n] = true
	}
	return out
}

func sortedKeys(m map[string]bool) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// assertContains fails when any wanted name is missing.
func assertContains(t *testing.T, got map[string]bool, want []string) {
	t.Helper()
	for _, w := range want {
		if !got[w] {
			t.Errorf("missing director %q; got %v", w, sortedKeys(got))
		}
	}
}

// assertAbsent fails when any forbidden string is present.
func assertAbsent(t *testing.T, got map[string]bool, forbidden []string) {
	t.Helper()
	for _, f := range forbidden {
		if got[f] {
			t.Errorf("false positive %q; got %v", f, sortedKeys(got))
		}
	}
}

// ---------------------------------------------------------------------------
// The Age: NN anchor — modern proxies render age as a separate labelled field
// rather than in the "Name, Age" construction the two original anchors need.
// ---------------------------------------------------------------------------

func TestDirectorsAgeLabelAnchor(t *testing.T) {
	cases := []struct {
		name     string
		body     string
		want     []string
		forbid   []string
		minCount int
	}{
		{
			// Microsoft 2024 (0001193125-24-242883): "Age: 57 | Director since: ..."
			// on the line after the name. Baseline returns 0 directors.
			name: "msft_2024_pipe_delimited_age_colon",
			body: "Election of Directors\n\nOur Director Nominees \n\n" +
				"Following are biographies for the 12 directors nominated by the Board for election during the 2024 Annual Meeting. \n\n" +
				"Reid G. Hoffman \n\n" +
				"Age: 57 | Director since: 2017 | Birthplace: United States | Independent\n\n" +
				"Experience:\n\nGreylock Partners (2009-present)\n\n(venture capital firm)\n\n" +
				"Hugh F. Johnston \n\n" +
				"Age: 63 | Director since: 2017 | Birthplace: United States | Independent\n\n" +
				"Experience:\n\nDisney (2023-present)\n\n",
			want:     []string{"Reid G. Hoffman", "Hugh F. Johnston"},
			minCount: 2,
		},
		{
			// Exxon Mobil 2026 (0001193125-26-147614): bare "Age 61", no colon,
			// four blank-line-separated cells after the name. Baseline: 0.
			name: "exxon_2026_bare_age_no_colon",
			body: "Election of Directors\n\n" +
				"The Board unanimously recommends you vote FOR each of the following candidates: \n\n" +
				"Michael J. Angelakis\n\nIndependent director\n\nDirector since 2021\n\nAge 61\n\n" +
				"Committees:\n\nAudit; Executive; Finance\n\n(Chair) \n\n" +
				"Susan K. Avery\n\nIndependent director\n\nDirector since 2017\n\nAge 74\n\n" +
				"Committees:\n\nAudit\n\n",
			want:     []string{"Michael J. Angelakis", "Susan K. Avery"},
			minCount: 2,
		},
		{
			// Eastern Co 2026 (0001654954-26-002620), lines 583-591: the name is
			// itself split across two cells and the age carries no space after
			// the colon. Baseline: 0.
			name: "eastern_2026_split_name_age_colon_nospace",
			body: "Election of Directors\n\n" +
				"Ryan A.\n\nSchroeder\n\nDirector\n\nAge:50\n\nDirector Since: 2024 \n\n" +
				"James\n\nMitarotonda\n\nDirector\n\nAge:71\n\nDirector Since: 2022 \n\n",
			want:     []string{"Ryan A. Schroeder", "James Mitarotonda"},
			minCount: 2,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := gotSet(tc.body)
			assertContains(t, got, tc.want)
			assertAbsent(t, got, tc.forbid)
			if len(got) < tc.minCount {
				t.Errorf("want >= %d directors, got %d: %v", tc.minCount, len(got), sortedKeys(got))
			}
		})
	}
}

// ---------------------------------------------------------------------------
// The table-cell anchor — a flattened nominee table row ends in "<age> <year>"
// with no comma and no role word, so neither original anchor fires.
// ---------------------------------------------------------------------------

func TestDirectorsTableCellAnchor(t *testing.T) {
	// Apple 2026 (0001308179-26-000008), lines 555-580. Baseline: 0 directors.
	body := "Election of Directors\n\n" +
		"Below are the nominees for election at our Annual Meeting.\n\n" +
		"Name Occupation Independent Age Director Since Audit \n\n" +
		"Committee People and \n\nCompensation\n\nCommittee Nominating \n\nCommittee\n\n" +
		"Art Levinson\n\nBoard Chair Founder and CEO, Calico 75 2000 \n\n" +
		"Tim Cook CEO, Apple 65 2011 \n\n" +
		"Wanda Austin Former President and CEO,\n\nThe Aerospace Corporation 71 2024 \n\n" +
		"Alex Gorsky Former Chair and CEO,\n\nJohnson & Johnson 65 2021 \n\n" +
		"Andrea Jung President and CEO,\n\nGrameen America 67 2008 \n\n" +
		"Monica Lozano Former President and CEO,\n\nCollege Futures Foundation 69 2021 \n\n" +
		"Ron Sugar Former Chair and CEO,\n\nNorthrop Grumman Corporation 77 2010 \n\n" +
		"Sue Wagner Co-founder and Director,\n\nBlackRock 64 2014 \n\n"

	got := gotSet(body)
	assertContains(t, got, []string{"Tim Cook", "Wanda Austin", "Alex Gorsky", "Andrea Jung", "Monica Lozano", "Ron Sugar", "Sue Wagner"})
	if len(got) < 7 {
		t.Errorf("want >= 7 directors from the Apple nominee table, got %d: %v", len(got), sortedKeys(got))
	}
}

// ---------------------------------------------------------------------------
// PRECISION. The header comment records that a permissive `Name [,\s]+ NN`
// pattern returned "Additional Information 32" and "Audit Committee Report 20"
// and reported 55 directors for one company. Neither new anchor may reopen it.
// ---------------------------------------------------------------------------

func TestDirectorsHeadingFollowedByNumberIsNotADirector(t *testing.T) {
	body := "Election of Directors\n\n" +
		"Additional Information 32\n\n" +
		"Audit Committee Report 20\n\n" +
		"Compensation Discussion and Analysis 41\n\n" +
		"Beneficial Ownership 58\n\n" +
		"Corporate Governance 12\n\n" +
		"Executive Compensation 44\n\n" +
		"Related Party Transactions 61\n\n" +
		"Report of the Audit Committee Age 55\n\n" +
		"Director Compensation Table 39 2011 \n\n"

	got := gotSet(body)
	if len(got) != 0 {
		t.Errorf("section headings followed by a page number must yield no directors, got %d: %v",
			len(got), sortedKeys(got))
	}
}

func TestDirectorsColumnFurnitureIsNotADirector(t *testing.T) {
	// A flattened header row must not itself become a person once an Age anchor
	// exists: "Name Age Position" sits immediately left of the first real cell.
	body := "Nominees for Election as Directors\n\n" +
		"Name Age Position Since\n\nAge: 62\n\n" +
		"Principal Occupation Age 58\n\n" +
		"Class Term Expires Age 44\n\n"

	got := gotSet(body)
	assertAbsent(t, got, []string{"Name Age Position", "Age Position", "Principal Occupation", "Term Expires", "Class Term Expires"})
	for _, n := range sortedKeys(got) {
		low := strings.ToLower(n)
		if strings.Contains(low, "occupation") || strings.Contains(low, "expires") || strings.Contains(low, "position") {
			t.Errorf("column furniture extracted as a director: %q", n)
		}
	}
}

// Cato Corp: the CEO IS a director and belongs in the slate; the sentence that
// declares him NOT independent must not be read as evidence of a second person,
// and no phrase from it may become a name.
func TestDirectorsCatoCeoIsInSlateAndNoPhantomFromNotIndependent(t *testing.T) {
	// Cato Corp 2024 (0001206774-24-000333) L610-614 and 2026 (0001206774-26-000206) L437.
	body := "Election of Directors\n\n" +
		"Information with respect\nto the four continuing members of the Board of Directors, including biographical data for at least the last five years, is set forth below.\n\n" +
		"John P. D. Cato, 75,\nhas been employed as an officer of the Company since 1981 and has been a director of the Company since 1986. Since January 2004, he has\nserved as Chairman, President and Chief Executive Officer.\n\n" +
		"The Board of Directors determined that each of the following Board members is independent: Dr. Pamela L. Davies, Ms. Theresa J. Drew, Mr. Thomas\nB. Henson, Mr. Bryan F. Kennedy, III, Mr. Thomas E. Meckley, Mr. Bailey W. Patrick and Mr. D. Harding Stowe. The Board determined that\nMr. John P. D. Cato, an employee of the Company, is not independent. The Board made these determinations based upon the definition of\nan independent director set forth in the NYSE listing standards (the NYSE Independence Tests).\n\n"

	got := gotSet(body)
	assertContains(t, got, []string{"John P. D. Cato"})
	assertAbsent(t, got, []string{"Company Is", "Independence Tests", "NYSE Independence Tests", "Independent Director", "Board Members"})
}

// ---------------------------------------------------------------------------
// PARITY. The two original anchors must keep working exactly as they do now.
// ---------------------------------------------------------------------------

func TestDirectorsOriginalAnchorsStillWork(t *testing.T) {
	t.Run("bio_comma_form", func(t *testing.T) {
		body := "Election of Directors\n\n" +
			"John A. Smith, 54, has served as a director of the Company since 2011.\n\n" +
			"Mary B. Jones, age 61, has served as a director since 2015.\n\n"
		got := gotSet(body)
		assertContains(t, got, []string{"John A. Smith", "Mary B. Jones"})
	})

	t.Run("table_role_form", func(t *testing.T) {
		body := "Election of Directors\n\n" +
			"Robert C. Nolan  62  Director\n" +
			"Helen T. Ward  58  Chairman\n"
		got := gotSet(body)
		assertContains(t, got, []string{"Robert C. Nolan", "Helen T. Ward"})
	})

	t.Run("age_out_of_range_rejected", func(t *testing.T) {
		body := "Election of Directors\n\n" +
			"Peter Q. Young, 19, is a summer intern.\n\n" +
			"Carla V. Reed, 99, is a former founder.\n\n"
		got := gotSet(body)
		assertAbsent(t, got, []string{"Peter Q. Young", "Carla V. Reed"})
	})
}
