package main

// The plan's "Known answers" table, asserted cell by cell through
// ExtractManagement on the seven verbatim fixtures.
//
// Every want below is a literal read off the filing by hand (see the design
// profile's P4) — nothing here is computed by the code under test. The break
// each case catches: a CEO picked by position text alone (Google's Schmidt vs
// the founders), a founder flag that fires on another company's founder or on a
// firm named "Founders Fund", a VC flag that fires on a Credit Suisse Managing
// Director, a row count that silently absorbs Netflix's Key Employees block,
// and an Age column read by header index through a colspan spacer layout.

import (
	"strings"
	"testing"
)

// vcWant pins the director the plan names as VC-affiliated, plus a fragment of
// the firm the filing credits — "Benchmark", not merely "some firm".
type vcWant struct {
	name string
	firm string
}

// notFounderWant is one cell of the plan's "must NOT be founder" column. trap is
// the verbatim founder-shaped sentence the filing carries about that person, and
// the loop asserts it reached that person's own Bio before judging the flag:
// founder_self_described is false for free when the bio is empty, so the trap
// cases need the bio pinned or they assert nothing. trap is "" for a person the
// plan lists as a non-founder without naming any founder language for them
// (Schmidt, Whitman, Khosrowshahi, Khan) — those still require a non-empty bio,
// which is what proves the detector ran on real text.
type notFounderWant struct {
	name string
	trap string
}

type knownAnswer struct {
	fixture   string
	label     string
	accession string

	ceoName    string
	ceoAge     int // 0 = the plan states no age for this filing
	ceoFounder bool

	mustFounder    []string
	mustNotFounder []notFounderWant
	mustVC         []vcWant
	mustNotVC      []string

	// nOfficerDirector is the plan's "persons (officer+director)" cell and
	// nKeyEmployee its "/ key_employee" half; -1 means the plan states neither
	// (Google, whose cell names directors instead).
	nOfficerDirector int
	nKeyEmployee     int

	mustBeDirectors []string
}

var knownAnswers = []knownAnswer{
	{
		fixture:   "google.txt",
		label:     "Google 2004",
		accession: "0001193125-04-143377",

		ceoName:    "Eric Schmidt",
		ceoFounder: false,

		mustFounder:    []string{"Sergey Brin", "Larry Page"},
		mustNotFounder: []notFounderWant{{name: "Eric Schmidt"}},
		mustVC: []vcWant{
			{"L. John Doerr", "Kleiner Perkins"},
			{"Michael Moritz", "Sequoia"},
		},

		nOfficerDirector: -1,
		nKeyEmployee:     -1,
		mustBeDirectors: []string{
			"L. John Doerr", "John L. Hennessy", "Arthur D. Levinson",
			"Michael Moritz", "Paul S. Otellini", "K. Ram Shriram",
		},
	},
	{
		fixture:   "facebook.txt",
		label:     "Facebook 2012",
		accession: "0001193125-12-240111",

		ceoName:    "Mark Zuckerberg",
		ceoAge:     27,
		ceoFounder: true,

		mustFounder:    []string{"Mark Zuckerberg"},
		mustNotFounder: []notFounderWant{
			{"Marc L. Andreessen", "is a co-founder and has been a General Partner of Andreessen Horowitz"},
			{"Erskine B. Bowles", "was a founder of Kitty Hawk Capital"},
			{"Peter A. Thiel", "has been a Partner of Founders Fund"},
		},
		mustVC: []vcWant{
			{"Marc L. Andreessen", "Andreessen Horowitz"},
			{"James W. Breyer", "Accel"},
			{"Peter A. Thiel", "Founders Fund"},
		},
		mustNotVC: []string{"Sheryl K. Sandberg"},

		nOfficerDirector: 12,
		nKeyEmployee:     0,
	},
	{
		fixture:   "snap.txt",
		label:     "Snap 2017",
		accession: "0001193125-17-068848",

		ceoName:    "Evan Spiegel",
		ceoFounder: true,

		mustFounder:    []string{"Evan Spiegel", "Robert Murphy"},
		mustNotFounder: []notFounderWant{{name: "Imran Khan"}},
		mustVC:         []vcWant{{"Mitchell Lasky", "Benchmark"}},
		mustNotVC:      []string{"Imran Khan"},

		nOfficerDirector: 14,
		nKeyEmployee:     0,
	},
	{
		fixture:   "uber.txt",
		label:     "Uber 2019",
		accession: "0001193125-19-144716",

		ceoName:    "Dara Khosrowshahi",
		ceoFounder: false,

		mustNotFounder: []notFounderWant{{name: "Dara Khosrowshahi"}},
		mustVC:         []vcWant{{"Matt Cohler", "Benchmark"}},

		nOfficerDirector: 19,
		nKeyEmployee:     0,
	},
	{
		fixture:   "airbnb.txt",
		label:     "Airbnb 2020",
		accession: "0001193125-20-315318",

		ceoName:    "Brian Chesky",
		ceoFounder: true,

		mustFounder: []string{"Brian Chesky", "Joseph Gebbia", "Nathan Blecharczyk"},
		mustVC: []vcWant{
			{"Kenneth Chenault", "General Catalyst"},
			{"Alfred Lin", "Sequoia"},
		},

		nOfficerDirector: 12,
		nKeyEmployee:     0,
	},
	{
		fixture:   "ebay.txt",
		label:     "eBay 1998 (ASCII)",
		accession: "0001012870-98-002475",

		ceoName:    "Margaret C. Whitman",
		ceoFounder: false,

		mustFounder:    []string{"Pierre M. Omidyar"},
		mustNotFounder: []notFounderWant{
			{"Howard D. Schultz", "is the founder of Starbucks Corp"},
			{"Scott D. Cook", "is the founder of Intuit Inc."},
			{name: "Margaret C. Whitman"},
		},
		mustVC:         []vcWant{{"Robert C. Kagle", "Benchmark"}},

		nOfficerDirector: 11,
		nKeyEmployee:     0,
	},
	{
		fixture:   "netflix.txt",
		label:     "Netflix 2002",
		accession: "0001012870-02-002475",

		ceoName:    "Reed Hastings",
		ceoFounder: false, // documented floor: the bio says only "since inception"

		mustNotFounder: []notFounderWant{
			{"Michael N. Schuh", "was a founder and Chief Executive Officer of Intrinsa Corporation"},
		},
		mustVC: []vcWant{
			{"Timothy M. Haley", "Institutional Venture Partners"},
			{"Jay C. Hoag", "Technology Crossover Ventures"},
		},

		nOfficerDirector: 10,
		nKeyEmployee:     7,
	},
}

func TestKnownAnswers_Status(t *testing.T) {
	for _, ka := range knownAnswers {
		t.Run(ka.label+" "+ka.accession, func(t *testing.T) {
			e := extractFixture(t, ka.fixture)
			if e.Filing.Status != StatusOK {
				t.Errorf("status = %q, want %q", e.Filing.Status, StatusOK)
			}
		})
	}
}

func TestKnownAnswers_CEO(t *testing.T) {
	for _, ka := range knownAnswers {
		t.Run(ka.label+" "+ka.accession, func(t *testing.T) {
			e := extractFixture(t, ka.fixture)

			if got := squash(e.Filing.CEOName); got != ka.ceoName {
				t.Errorf("filing ceo_name = %q, want %q", got, ka.ceoName)
			}
			if e.Filing.CEOFounderSelfDescribed != ka.ceoFounder {
				t.Errorf("filing ceo_founder_self_described = %v, want %v",
					e.Filing.CEOFounderSelfDescribed, ka.ceoFounder)
			}

			// Exactly one person row carries is_ceo, and it is that person.
			var ceos []string
			for _, p := range e.Persons {
				if p.IsCEO {
					ceos = append(ceos, squash(p.Name))
				}
			}
			if len(ceos) != 1 {
				t.Fatalf("is_ceo rows = %v, want exactly one (%q)", ceos, ka.ceoName)
			}
			if ceos[0] != ka.ceoName {
				t.Errorf("is_ceo row = %q, want %q", ceos[0], ka.ceoName)
			}

			ceo := person(t, e, ka.ceoName)
			if ceo.FounderSelfDescribed != ka.ceoFounder {
				t.Errorf("%s founder_self_described = %v, want %v (filing-level and person-level must agree)",
					ka.ceoName, ceo.FounderSelfDescribed, ka.ceoFounder)
			}
			if ka.ceoAge != 0 && ceo.Age != ka.ceoAge {
				t.Errorf("%s age = %d, want %d", ka.ceoName, ceo.Age, ka.ceoAge)
			}
		})
	}
}

func TestKnownAnswers_Founder(t *testing.T) {
	for _, ka := range knownAnswers {
		t.Run(ka.label+" "+ka.accession, func(t *testing.T) {
			e := extractFixture(t, ka.fixture)
			for _, name := range ka.mustFounder {
				p := person(t, e, name)
				if !p.FounderSelfDescribed {
					t.Errorf("%s: founder_self_described = false, want true (evidence=%q, bio=%q)",
						name, p.FounderEvidence, trunc(p.Bio))
				}
				if strings.TrimSpace(p.FounderEvidence) == "" {
					t.Errorf("%s: founder flagged with no founder_evidence", name)
				}
			}
			for _, want := range ka.mustNotFounder {
				p := person(t, e, want.name)
				// The bio is what the detector reads. Judging the flag without
				// pinning the text it read makes every must-not case pass for a
				// person whose bio never arrived.
				if strings.TrimSpace(p.Bio) == "" {
					t.Errorf("%s: empty bio, so founder_self_described = false proves nothing about the detector",
						want.name)
				}
				if want.trap != "" && !containsFold(p.Bio, want.trap) {
					t.Errorf("%s: bio does not carry the trap sentence %q, so the founder detector is not being exercised on it\n  bio = %q",
						want.name, want.trap, trunc(p.Bio))
				}
				if p.FounderSelfDescribed {
					t.Errorf("%s: founder_self_described = true, want false (evidence=%q)",
						want.name, p.FounderEvidence)
				}
			}
		})
	}
}

func TestKnownAnswers_VC(t *testing.T) {
	for _, ka := range knownAnswers {
		t.Run(ka.label+" "+ka.accession, func(t *testing.T) {
			e := extractFixture(t, ka.fixture)
			for _, want := range ka.mustVC {
				p := person(t, e, want.name)
				if !p.VCAffiliated {
					t.Errorf("%s: vc_affiliated = false, want true (bio=%q)", want.name, trunc(p.Bio))
					continue
				}
				if !containsFold(p.VCFirm, want.firm) {
					t.Errorf("%s: vc_firm = %q, want it to name %q", want.name, p.VCFirm, want.firm)
				}
				if strings.TrimSpace(p.VCEvidence) == "" {
					t.Errorf("%s: vc flagged with no vc_evidence", want.name)
				}
			}
			for _, name := range ka.mustNotVC {
				p := person(t, e, name)
				if p.VCAffiliated {
					t.Errorf("%s: vc_affiliated = true, want false (firm=%q evidence=%q)",
						name, p.VCFirm, p.VCEvidence)
				}
			}
		})
	}
}

func TestKnownAnswers_PersonCounts(t *testing.T) {
	for _, ka := range knownAnswers {
		if ka.nOfficerDirector < 0 {
			continue
		}
		t.Run(ka.label+" "+ka.accession, func(t *testing.T) {
			e := extractFixture(t, ka.fixture)
			officers := countSection(e, SectionOfficer)
			directors := countSection(e, SectionDirector)
			keys := countSection(e, SectionKeyEmployee)

			if got := officers + directors; got != ka.nOfficerDirector {
				t.Errorf("officer+director rows = %d (%d officer, %d director), want %d; names=%v",
					got, officers, directors, ka.nOfficerDirector, personNames(e))
			}
			if keys != ka.nKeyEmployee {
				t.Errorf("key_employee rows = %d, want %d; names=%v", keys, ka.nKeyEmployee, personNames(e))
			}
			if unknown := countSection(e, SectionUnknown); unknown != 0 {
				t.Errorf("unknown-section rows = %d, want 0; names=%v", unknown, personNames(e))
			}
			if want := ka.nOfficerDirector + ka.nKeyEmployee; len(e.Persons) != want {
				t.Errorf("len(persons) = %d, want %d; names=%v", len(e.Persons), want, personNames(e))
			}
		})
	}
}

// The filing summary is what the pilot joins on; it must agree with the person
// rows it summarises rather than being computed a second, divergent way.
func TestKnownAnswers_FilingSummaryAgreesWithPersons(t *testing.T) {
	for _, ka := range knownAnswers {
		t.Run(ka.label+" "+ka.accession, func(t *testing.T) {
			e := extractFixture(t, ka.fixture)
			if e.Filing.NPersons != len(e.Persons) {
				t.Errorf("n_persons = %d, want %d", e.Filing.NPersons, len(e.Persons))
			}
			if got, want := e.Filing.NOfficers, countSection(e, SectionOfficer); got != want {
				t.Errorf("n_officers = %d, want %d", got, want)
			}
			if got, want := e.Filing.NDirectors, countSection(e, SectionDirector); got != want {
				t.Errorf("n_directors = %d, want %d", got, want)
			}
			nVC := 0
			for _, p := range e.Persons {
				if p.Section == SectionDirector && p.VCAffiliated {
					nVC++
				}
			}
			if e.Filing.NVCDirectors != nVC {
				t.Errorf("n_vc_directors = %d, want %d", e.Filing.NVCDirectors, nVC)
			}
			if e.Filing.CEOFounderSelfDescribed && strings.TrimSpace(e.Filing.CEOFounderEvidence) == "" {
				t.Errorf("ceo_founder_self_described set with empty ceo_founder_evidence")
			}
		})
	}
}

// Every person row in these seven filings carries a plausible age. A parser
// that maps columns by header index reads every Facebook/Snap/Uber age as 0
// (Design rule 1: columns are identified by content).
func TestKnownAnswers_EveryPersonHasAnAge(t *testing.T) {
	for _, ka := range knownAnswers {
		t.Run(ka.label+" "+ka.accession, func(t *testing.T) {
			e := extractFixture(t, ka.fixture)
			if len(e.Persons) == 0 {
				t.Fatalf("no persons extracted")
			}
			for _, p := range e.Persons {
				if p.Age < 20 || p.Age > 90 {
					t.Errorf("%s: age = %d, want a two-digit age in [20,90]", squash(p.Name), p.Age)
				}
				if strings.TrimSpace(p.Position) == "" {
					t.Errorf("%s: empty position", squash(p.Name))
				}
			}
		})
	}
}

func TestKnownAnswers_GoogleOutsideDirectors(t *testing.T) {
	e := extractFixture(t, "google.txt")
	for _, name := range knownAnswers[0].mustBeDirectors {
		p := person(t, e, name)
		if p.Section != SectionDirector {
			t.Errorf("%s: section = %q, want %q (position=%q)", name, p.Section, SectionDirector, p.Position)
		}
	}
}

func trunc(s string) string {
	s = squash(s)
	if len(s) > 200 {
		return s[:200] + "..."
	}
	if s == "" {
		return "<empty>"
	}
	return s
}
