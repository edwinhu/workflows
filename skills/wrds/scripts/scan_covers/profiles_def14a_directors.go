package main

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// def14a_directors — extract the director slate from a DEF 14A / DEFM14A.
//
// Purpose: adjudicate vendor board data. Capital IQ and BoardEx disagree about
// who sat on specific boards (CIQ places Orlando Bravo on Qlik and other portfolio boards;
// BoardEx does not, while giving him 35 other seats). No aggregate can settle a
// specific seat — the company's own proxy can, because a DEF 14A must name
// every director standing for election.
//
// EXTRACTION ANCHOR: the "Name, Age" construction. Proxy director disclosure is
// formatted many ways, but essentially all of them place an age immediately
// after the name — "John A. Smith, 54" in bio prose, or "John A. Smith 54
// Director" in a table. Age is what separates a director from every other
// capitalised name in the document (lawyers, auditors, subsidiaries), so it is
// the anchor rather than an extra.
//
// Deliberately NOT trying to classify the seat (independent, chair, class I).
// The question here is only "was this person on the board", so precision on the
// name set matters and everything else is noise.
func init() {
	register(&Profile{
		Name:      "def14a_directors",
		HeadBytes: 8192,
		FullBody:  true,
		Forms:     []string{"DEF 14A", "DEFM14A"},
		Fields: []Field{
			{Name: "accession",
				Pattern: regexp.MustCompile(`ACCESSION NUMBER:[ \t]+([^\s]+)`),
				Reduce:  First},
			{Name: "filed_date",
				Pattern: regexp.MustCompile(`FILED AS OF DATE:[ \t]+([0-9]+)`),
				Reduce:  First},
			{Name: "cik",
				Pattern: regexp.MustCompile(`CENTRAL INDEX KEY:[ \t]+([0-9]+)`),
				Reduce:  First},
			{Name: "company_name",
				Pattern: regexp.MustCompile(`COMPANY CONFORMED NAME:[ \t]+([^\r\n]+)`),
				Reduce:  First},
			{Name: "n_directors", Custom: countDirectors},
			{Name: "directors", Custom: extractDirectors},
		},
	})
}

// Two shapes only, because a looser rule matches prose headings. Piloting a
// permissive `Name [,\s]+ NN` version returned "Additional Information 32" and
// "Audit Committee Report 20" — title-case headings followed by any number —
// and reported 55 directors for a single company.
//
//	1. bio form:   "John A. Smith, 54" / "John A. Smith, age 54"  (comma required)
//	2. table form: "John A. Smith  54  Director"                  (role required)
var reNameAgeComma = regexp.MustCompile(
	`(?m)\b([A-Z][A-Za-z'\-]{1,20}(?:\s+(?:[A-Z]\.|[A-Z][A-Za-z'\-]{1,20}|van|von|de|del|di|la|Le|Mc|Mac))*\s+[A-Z][A-Za-z'\-]{1,20}(?:,?\s+(?:Jr|Sr|II|III|IV)\.?)?)\s*,\s*(?:age\s+)?(\d{2})\b`)

var reNameAgeRole = regexp.MustCompile(
	`(?m)\b([A-Z][A-Za-z'\-]{1,20}(?:\s+(?:[A-Z]\.|[A-Z][A-Za-z'\-]{1,20}|van|von|de|del|di|la|Le|Mc|Mac))*\s+[A-Z][A-Za-z'\-]{1,20}(?:,?\s+(?:Jr|Sr|II|III|IV)\.?)?)\s+(\d{2})\s+(?:Director|Chairman|Chairwoman|Chair\b|Lead\s|Independent|President|Chief)`)

// Tokens that never appear in a person's name but are common in proxy section
// headings, which is how headings sneak past a name-shaped pattern.
var headingWords = map[string]bool{
	"information": true, "report": true, "reports": true, "committee": true,
	"contents": true, "compliance": true, "ownership": true, "fees": true,
	"performance": true, "growth": true, "meeting": true, "annual": true,
	"proposal": true, "summary": true, "table": true, "election": true,
	"beneficial": true, "certain": true, "additional": true, "executive": true,
	"compensation": true, "audit": true, "corporate": true, "governance": true,
	"stock": true, "shareholders": true, "stockholders": true, "board": true,
	"directors": true, "director": true, "officers": true, "plan": true,
	"equity": true, "share": true, "shares": true, "company": true, "auditor": true,
	"matters": true, "vote": true, "voting": true, "policy": true, "review": true,
	"discussion": true, "analysis": true, "transactions": true, "relationships": true,
	"nominees": true, "nominee": true, "principal": true, "security": true,
}

func looksLikeHeading(name string) bool {
	for _, tok := range strings.Fields(strings.ToLower(name)) {
		if headingWords[strings.Trim(tok, ".,")] {
			return true
		}
	}
	return false
}

// Column labels that sit immediately left of a name once the clean-text
// converter flattens a table: "Name Age Position Ruben Mendoza".
var leadNoise = map[string]bool{
	"name": true, "age": true, "position": true, "title": true, "officer": true,
	"financial": true, "marketing": true, "operating": true, "since": true,
	"fiscal": true, "year": true, "class": true, "term": true, "expires": true,
	"principal": true, "occupation": true, "other": true, "current": true,
	"nominee": true, "continuing": true, "office": true, "served": true,
}

// trimName keeps the trailing 2-3 tokens that actually form the name.
//
// The capture is greedy to the LEFT because a flattened table puts column
// headers and prior-cell text on the same line, so "Financial Officer Pete
// Welly" and "Name Age Position Ruben Mendoza" both arrive as one match. The
// person is always at the END of the run.
func trimName(name string) string {
	toks := strings.Fields(name)
	// Drop leading tokens that are table furniture.
	for len(toks) > 2 && leadNoise[strings.ToLower(strings.Trim(toks[0], ".,"))] {
		toks = toks[1:]
	}
	// A name is at most first + middle-initial + last (+ suffix).
	if len(toks) > 4 {
		toks = toks[len(toks)-3:]
	}
	// A middle initial cannot start a name.
	if len(toks) > 2 && len(strings.Trim(toks[0], ".")) == 1 {
		toks = toks[1:]
	}
	return strings.Join(toks, " ")
}

// Sections that actually enumerate directors. Restricting to these windows
// keeps executive-compensation tables and 5% holder lists out of the slate.
var reDirSection = regexp.MustCompile(
	`(?is)(ELECTION\s+OF\s+DIRECTORS|NOMINEES?\s+FOR\s+(?:ELECTION\s+AS\s+)?DIRECTORS?|` +
		`DIRECTORS?\s+CONTINUING\s+IN\s+OFFICE|OUR\s+BOARD\s+OF\s+DIRECTORS|` +
		`INFORMATION\s+(?:ABOUT|REGARDING)\s+(?:THE\s+)?(?:BOARD|DIRECTORS|NOMINEES))`)

// Titles that mark the match as an officer-only mention rather than a director.
// A person can be both, so this only rejects when NO director cue is nearby.
var reDirectorCue = regexp.MustCompile(
	`(?i)\b(director|chairman|chair of the board|board member|nominee)\b`)

var reOfficerOnly = regexp.MustCompile(
	`(?i)\b(chief executive|chief financial|chief operating|president|executive vice|senior vice|general counsel|treasurer|secretary)\b`)

// directorSet walks each director section and returns the deduplicated names.
func directorSet(body []byte) []string {
	locs := reDirSection.FindAllIndex(body, -1)
	if len(locs) == 0 {
		return nil
	}
	seen := map[string]bool{}
	for _, loc := range locs {
		// Window from the heading forward. 60k covers a full slate of bios;
		// beyond that the next major section has usually started.
		end := loc[1] + 60000
		if end > len(body) {
			end = len(body)
		}
		win := body[loc[1]:end]
		hits := reNameAgeComma.FindAllSubmatchIndex(win, -1)
		hits = append(hits, reNameAgeRole.FindAllSubmatchIndex(win, -1)...)
		for _, m := range hits {
			name := strings.TrimSpace(string(win[m[2]:m[3]]))
			age, err := strconv.Atoi(string(win[m[4]:m[5]]))
			if err != nil || age < 25 || age > 95 {
				continue
			}
			if n := len(strings.Fields(name)); n < 2 || n > 5 {
				continue
			}
			name = trimName(name)
			if looksLikeHeading(name) || len(strings.Fields(name)) < 2 {
				continue
			}
			// Look at the 400 bytes around the hit for a director cue.
			cs := m[0] - 200
			if cs < 0 {
				cs = 0
			}
			ce := m[1] + 400
			if ce > len(win) {
				ce = len(win)
			}
			ctx := win[cs:ce]
			if !reDirectorCue.Match(ctx) && reOfficerOnly.Match(ctx) {
				continue
			}
			seen[normName(name)] = true
		}
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

// normName collapses whitespace and strips trailing punctuation so the same
// person spelled with a stray comma does not appear twice.
func normName(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	return strings.Trim(s, " ,.;:")
}

func extractDirectors(body []byte) string {
	return strings.Join(directorSet(body), "|")
}

func countDirectors(body []byte) string {
	return strconv.Itoa(len(directorSet(body)))
}
