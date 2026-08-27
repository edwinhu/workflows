package main

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// def14a_directors — extract the director slate from a DEF 14A / DEFM14A.
//
// SUPERSEDED FOR MEASUREMENT. Use src/html_slate_v3/ in the board-structuring
// project for any slate or board-size number. Clean holdout
// (board-structuring data/raw/def14a/slate_truth_holdout3.tsv, n=40, scored
// once): this regex R 0.245 / P 0.607; HTML v3 R 0.813 / P 0.950. v3 also emits
// `board_denominator` (0.806 exact on slate-bearing filings) and `slate_object`,
// which this profile has no analogue for.
// WHY: a director roster is a 2-D table relation (name x age x role x class).
// This profile reads wrds_clean_filings, which is HTML-stripped WITHOUT
// re-flowing, so rows and columns are already destroyed before any regex runs;
// v3 reads the raw HTML DOM under /wrds/sec/archives and keeps the relation.
// No anchor rewrite recovers a relation that is not in the input.
// INHERITED: profiles_def14a_independence.go calls countDirectors/
// extractDirectors for its denominator, so its independent SHARE carries this
// defect. Its own independence fields do not. Join v3's board_denominator on
// `accession` instead.
//
// Purpose: adjudicate vendor board data. Capital IQ and BoardEx disagree about
// who sat on specific boards (CIQ places Orlando Bravo on Qlik and other portfolio boards;
// BoardEx does not, while giving him 35 other seats). No aggregate can settle a
// specific seat — the company's own proxy can, because a DEF 14A must name
// every director standing for election.
//
// EXTRACTION ANCHOR: age adjacency. Proxy director disclosure is formatted many
// ways, but essentially all of them put an age next to the name — "John A.
// Smith, 54" in bio prose, "John A. Smith 54 Director" in a table, "Age: 57"
// as a labelled field, or a flattened nominee row ending "65 2011". Age is what
// separates a director from every other capitalised name in the document
// (lawyers, auditors, subsidiaries), so it is the anchor rather than an extra.
//
// FOUR anchors, in the order they were added:
//
//  1. reNameAgeComma — bio form,   "John A. Smith, 54" / "…, age 54".
//  2. reNameAgeRole  — table form, "John A. Smith  54  Director".
//  3. reAgeLabel     — labelled-field form, "Age: 57" / "Age 61" / "Age:50".
//     The name is NOT on the same line: wrds_clean_filings emits one table cell
//     per line and splits names across cells, so Eastern Co 2026 arrives as
//     "Ryan A." / "Schroeder" / "Director" / "Age:50" on four separate lines.
//     This anchor therefore scans a BOUNDED window BACKWARD (400 bytes, at most
//     6 cells, at most 4 skipped non-name cells) and joins the contiguous run of
//     name-shaped cells it lands on.
//  4. reTableRowAge — flattened nominee-table row whose tail is
//     "<age> <director-since-year>", with the name at the HEAD of the row
//     (Apple 2026: "Tim Cook CEO, Apple 65 2011"). When the row wraps, the
//     converter puts the name on the preceding line and that line ends in a
//     comma ("Wanda Austin Former President and CEO," / "The Aerospace
//     Corporation 71 2024"), so a comma-terminated predecessor is prepended
//     before the head is read.
//
// PRECISION, NOT RECALL. Piloting a permissive `Name [,\s]+ NN` version returned
// "Additional Information 32" and "Audit Committee Report 20" — title-case
// headings followed by any number — and reported 55 directors for a single
// company. Every guard applies to all four anchors: headingWords, leadNoise,
// the 25–95 age range, the 2–5 token name length, and the officer-only /
// director-cue context check.
//
// Looser variants tried and REJECTED while adding anchors 3 and 4. Each was
// measured on the 31 hand-checked fixtures in board-structuring; the false
// directors quoted below are the actual strings it returned.
//
//   - Age-label anchor reading the name from the SAME line only. Loses every
//     one-cell-per-line filing (Exxon, Eastern, Microsoft) — i.e. the whole
//     reason the anchor exists. Rejected as useless, not as imprecise.
//   - Case-INSENSITIVE, unanchored `(?i)\bage:?\s*(\d{2})`. Fires on benefit-plan
//     prose — "the participant has reached age 63", "payable at age 60",
//     "retirement prior to age 65" — and pairs it with whatever cell precedes,
//     returning "Long-Term Cash Awards", "Strong Forfeiture Provisions" and
//     "PRESENT VALUE PENSION CALCULATIONS". The shipped form requires either an
//     explicit "Age:" colon or "Age" alone at the head of a cell.
//   - Age-label anchor with no following-digit check. A board-diversity matrix
//     row is "Age 65 68 53 55 68 …"; it returned "Military Status".
//   - Age-label backward window that keeps joining name cells past a complete
//     name (up to 4 tokens). In a name-per-line nominee column it welds two
//     directors together ("Teri L. List" + "Catherine MacGregor") or picks up
//     the tail of the preceding field ("…Directorships Held in the Past Five
//     Years: None" + "Satya Nadella" -> "None Satya Nadella"). The shipped form
//     stops the moment the run reaches two tokens.
//   - Age-label backward window accepting ALL-CAPS cells. Returned
//     "QUALIFICATIONS Ryan A. Schroeder". Name cells must now be
//     initial-cap-then-lowercase or a bare initial. This gives up the all-caps
//     roster filings, which the two original anchors already cover.
//   - Age-label backward window skipping more than two intervening cells.
//     Exxon needs exactly two ("Independent director", "Director since 2021")
//     and Eastern one; four reached back into skills-matrix furniture.
//   - Table-row tail `(\d{2})\s+((?:19|20)\d{2})` without a leading \b. It takes
//     the last two digits of the first year in a career date range, so
//     "…, 1995 2015" became a row and returned "Multiple Leadership" and
//     "Trammell Crow".
//   - Table-row anchor with no entity-follow check. The head of a wrapped
//     occupation line is a firm: "Sixth Street" (Partners), "Red Cell"
//     (Partners), "Trammell Crow" (Company).
//   - Table-row anchor falling back to the previous line's head whenever the
//     row's own head is rejected (this would additionally recover Apple's
//     "Art Levinson", whose row head is the furniture "Board Chair Founder").
//     Rejected: without the comma-continuation test it also drags the previous
//     row's occupation cell in, and it is recall, not precision.
//   - Table-row anchor reusing trimName. trimName assumes the person is at the
//     END of the run, which holds for the backward window of anchor 3 but is
//     exactly wrong for anchor 4, where the name leads and the occupation
//     trails; it returned "Wagner Co-founder" for Apple's "Sue / Wagner
//     Co-founder and Director, BlackRock 62 2014". headName is head-anchored
//     instead, capped at first + optional middle initial + last.
//   - Table-row tail of "<age>" alone, without the director-since year. Matches
//     "Additional Information 32" and every page number in a table of contents.
//
// Measured effect on the 31 fixtures: filings returning an empty slate fall from
// 16 to 11, and NO name present in the baseline slate is lost on any fixture.
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

// Words that can lead or fill a flattened table cell but never a person's name.
// Held separate from leadNoise so trimName — and therefore the two original
// anchors — keeps its exact current behaviour. Screened by both new anchors.
var nonNameWords = map[string]bool{
	"the": true, "an": true, "our": true, "its": true, "their": true,
	"this": true, "these": true, "those": true, "his": true, "her": true,
	"former": true, "chief": true, "chair": true, "chairman": true,
	"chairwoman": true, "lead": true, "independent": true, "president": true,
	"senior": true, "vice": true, "inc": true, "llc": true, "lp": true,
	"corp": true, "corporation": true, "holdings": true, "group": true,
	"capital": true, "partners": true, "foundation": true, "university": true,
	"college": true, "school": true, "institute": true, "association": true,
	"systems": true, "technologies": true, "international": true, "ventures": true,
	"mr": true, "mrs": true, "ms": true, "dr": true, "messrs": true, "mses": true,
	"and": true, "of": true, "for": true, "with": true, "from": true, "all": true,
	"each": true, "no": true, "not": true, "age": true, "ages": true,
	"years": true, "old": true, "elected": true, "appointed": true, "retired": true,
	"managing": true, "partner": true, "member": true, "founder": true,
	"leadership": true, "multiple": true, "various": true, "roles": true,
	"management": true, "oversight": true, "risk": true, "none": true,
	"co-founder": true, "cofounder": true, "co-chair": true, "co-ceo": true,
	"co-president": true, "co-chief": true,
}

// Entity words. If one of these follows a head-anchored name, the "name" is the
// leading words of an organisation ("Sixth Street Partners", "Trammell Crow
// Company", "Red Cell Partners"), not a person.
var reEntityFollow = regexp.MustCompile(
	`^(?i:partners?|company|companies|corporation|corp|inc|llc|llp|lp|ltd|group|` +
		`capital|ventures|holdings|bank|foundation|university|college|school|` +
		`institute|hospital|systems|technologies|associates|advisors|advisers|` +
		`management|media|health|international|fund|trust|association)\b`)

// badNameToken screens one token against every heading/furniture vocabulary.
// Single letters are middle initials and are exempt.
func badNameToken(tok string) bool {
	bare := strings.ToLower(strings.Trim(tok, ".,"))
	if len(bare) <= 1 {
		return false
	}
	return headingWords[bare] || leadNoise[bare] || nonNameWords[bare]
}

// A whole flattened cell that is nothing but name-shaped tokens. Tokens must be
// initial-capital-then-lowercase or a bare initial: an ALL-CAPS run is a heading
// ("QUALIFICATIONS", "PRESENT VALUE PENSION CALCULATIONS"), and the two original
// anchors already cover the all-caps-roster filings.
var reNameCell = regexp.MustCompile(
	`^(?:[A-Z][a-z][A-Za-z'\-]*|[A-Z]\.)(?:[ \t]+(?:[A-Z][a-z][A-Za-z'\-]*|[A-Z]\.|van|von|de|del|di|la|Le|Mc|Mac))*$`)

func isNameCell(cell string) bool {
	cell = strings.TrimSpace(cell)
	if cell == "" || !reNameCell.MatchString(cell) {
		return false
	}
	toks := strings.Fields(cell)
	if len(toks) == 0 || len(toks) > 4 {
		return false
	}
	for _, t := range toks {
		if badNameToken(t) {
			return false
		}
	}
	return true
}

// Labelled age, in two forms, both case-SENSITIVE and both requiring the label
// to be a field rather than prose. Lower-case "age 63" in benefit-plan prose
// ("the participant has reached age 63", "payable at age 60") was the single
// largest source of false directors when this was (?i) and unanchored.
var reAgeColon = regexp.MustCompile(`\bAge:[ \t]*(\d{2})\b`)          // "Age: 57", "Age:50"
var reAgeCell = regexp.MustCompile(`(?m)^[ \t]*Age[ \t]+(\d{2})\b`)   // "Age 61" alone in a cell
var reMoreDigits = regexp.MustCompile(`^[ \t]+\d`)                    // "Age 65 68 53" is a matrix row

// nameFromBackwardCells walks the flattened cells immediately left of a
// labelled age and returns the contiguous run of name cells it finds. It may
// step over role/date cells ("Director", "Director since 2021") before the run
// starts, but stops at the first non-name cell once it has begun — which is
// what joins "Ryan A." to "Schroeder" without also taking "Director".
func nameFromBackwardCells(win []byte, at int) string {
	start := at - 400
	if start < 0 {
		start = 0
	}
	cells := make([]string, 0, 16)
	for _, c := range strings.Split(string(win[start:at]), "\n") {
		if c = strings.TrimSpace(c); c != "" {
			cells = append(cells, c)
		}
	}
	var parts []string
	skipped, ntok := 0, 0
	for i := len(cells) - 1; i >= 0 && len(cells)-i <= 5; i-- {
		if isNameCell(cells[i]) {
			parts = append([]string{cells[i]}, parts...)
			// Stop the moment the run is a whole name. Continuing past it
			// concatenates the previous nominee in a name-per-line column
			// ("Teri L. List" + "Catherine MacGregor") or the tail of the
			// previous field ("…Past Five Years: None" + "Satya Nadella").
			if ntok += len(strings.Fields(cells[i])); ntok >= 2 {
				break
			}
			continue
		}
		if len(parts) > 0 {
			break
		}
		// At most two intervening role/date cells — Exxon needs exactly two
		// ("Independent director", "Director since 2021"), Eastern one.
		if skipped++; skipped > 2 {
			break
		}
	}
	return strings.Join(parts, " ")
}

// Flattened nominee row ending "<age> <director-since-year>". The \b before the
// age is load-bearing: without it "…, 1995 2015" matches with age "95" taken out
// of the year 1995, which turns every date range in a career history into a row.
var reTableRowAge = regexp.MustCompile(`(?m)^[ \t]*([^\n]*?)\b(\d{2})[ \t]+((?:19|20)\d{2})[ \t]*\r?$`)

var reNameTok = regexp.MustCompile(`^(?:[A-Z][a-z][A-Za-z'\-]*|[A-Z]\.)$`)

// headName reads a name from the HEAD of a flattened row and also returns the
// token that follows it. trimName is deliberately NOT reused here: it keeps the
// TRAILING tokens, which for a row like "Tim Cook CEO, Apple" is the occupation
// rather than the person.
func headName(row string) (string, string) {
	toks := strings.Fields(row)
	var out []string
	for _, t := range toks {
		if len(out) >= 4 || !reNameTok.MatchString(t) {
			break
		}
		out = append(out, t)
	}
	if len(out) < 2 {
		return "", ""
	}
	// first + optional middle initial + last, never more.
	if len(out) >= 3 && len(strings.Trim(out[1], ".")) == 1 {
		out = out[:3]
	} else {
		out = out[:2]
	}
	for _, t := range out {
		if badNameToken(t) {
			return "", ""
		}
	}
	next := ""
	if len(toks) > len(out) {
		next = toks[len(out)]
	}
	return strings.Join(out, " "), next
}

// prevCell returns the last non-empty flattened cell before offset at.
func prevCell(win []byte, at int) string {
	start := at - 300
	if start < 0 {
		start = 0
	}
	last := ""
	for _, c := range strings.Split(string(win[start:at]), "\n") {
		if c = strings.TrimSpace(c); c != "" {
			last = c
		}
	}
	return last
}

// contextAllows applies the officer-only / director-cue check. A person can be
// both an officer and a director, so an officer title only rejects when no
// director cue sits anywhere in the surrounding window.
func contextAllows(win []byte, mStart, mEnd int) bool {
	cs := mStart - 200
	if cs < 0 {
		cs = 0
	}
	ce := mEnd + 400
	if ce > len(win) {
		ce = len(win)
	}
	ctx := win[cs:ce]
	return reDirectorCue.Match(ctx) || !reOfficerOnly.Match(ctx)
}

// acceptName applies every shared guard and records the name.
func acceptName(win []byte, name string, age int, mStart, mEnd int, seen map[string]bool) {
	if name == "" || age < 25 || age > 95 {
		return
	}
	toks := strings.Fields(name)
	if len(toks) < 2 || len(toks) > 5 {
		return
	}
	for _, t := range toks {
		if badNameToken(t) {
			return
		}
	}
	if looksLikeHeading(name) {
		return
	}
	if !contextAllows(win, mStart, mEnd) {
		return
	}
	seen[normName(name)] = true
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

		// Anchor 3: labelled age, name recovered from the cells to its left.
		ageHits := reAgeColon.FindAllSubmatchIndex(win, -1)
		ageHits = append(ageHits, reAgeCell.FindAllSubmatchIndex(win, -1)...)
		for _, m := range ageHits {
			age, err := strconv.Atoi(string(win[m[2]:m[3]]))
			if err != nil {
				continue
			}
			// A run of further numbers means a board-diversity matrix row
			// ("Age 65 68 53 55 …"), not one director's age field.
			if reMoreDigits.Match(win[m[3]:min(m[3]+4, len(win))]) {
				continue
			}
			name := trimName(nameFromBackwardCells(win, m[0]))
			acceptName(win, name, age, m[0], m[1], seen)
		}

		// Anchor 4: flattened nominee row ending "<age> <since-year>".
		for _, m := range reTableRowAge.FindAllSubmatchIndex(win, -1) {
			age, err := strconv.Atoi(string(win[m[4]:m[5]]))
			if err != nil {
				continue
			}
			row := string(win[m[2]:m[3]])
			start := m[0]
			// A wrapped row leaves the name on a comma-terminated predecessor.
			if p := prevCell(win, m[0]); strings.HasSuffix(p, ",") {
				row = p + " " + row
				start = m[0] - len(p)
				if start < 0 {
					start = 0
				}
			}
			name, next := headName(row)
			if next != "" && reEntityFollow.MatchString(next) {
				continue // "Sixth Street" + "Partners" is a firm, not a person.
			}
			acceptName(win, name, age, start, m[1], seen)
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
