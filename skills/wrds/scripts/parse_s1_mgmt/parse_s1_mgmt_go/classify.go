package main

// The three derived variables: who the CEO is, whether a person describes
// themselves as a founder OF THIS COMPANY, and whether a person is affiliated
// with a venture capital firm.
//
// Both flags read one person's own Position cell and own bio and nothing else.
// Scoping is the whole difficulty. Across the seven profiled filings there are
// six live instances of a director who founded some OTHER company — Starbucks,
// Intuit, Intrinsa, Opsware, Kitty Hawk Capital, Andreessen Horowitz — plus a
// firm literally named "Founders Fund" (profile, R7). A document-level or even a
// section-level token search marks all of them as founders of the issuer.

import (
	"regexp"
	"strings"
	"unicode/utf8"
)

// ---------------------------------------------------------------------------
// CEO
// ---------------------------------------------------------------------------

var (
	rePosCEO = regexp.MustCompile(`(?i)\bchief\s+executive\s+officer\b|\bCEO\b`)
	// A qualified chief executive is somebody else's, or was.
	reCEOQualified = regexp.MustCompile(`(?i)\bformer\b|\bdeputy\b|\bemeritus\b|` +
		`\bchief\s+executive\s+officer\s+of\s+(?:our\s+\w+\s+(?:subsidiary|division)|[A-Z])`)
)

// pickCEO marks exactly one person as the chief executive: the officer whose
// Position cell names the office, earliest in table order. Google is the case
// that forces "by Position cell, not by bio": the CEO is Eric Schmidt while the
// founders Brin and Page are the two rows beneath him, and the appended roadshow
// transcript has Schmidt saying "I am the CEO of Google" all over again.
func pickCEO(persons []Person) int {
	best := -1
	for i, p := range persons {
		if !rePosCEO.MatchString(p.Position) || reCEOQualified.MatchString(p.Position) {
			continue
		}
		if best < 0 {
			best = i
			continue
		}
		// An officer outranks an unlabelled or key-employee row; otherwise the
		// earlier row wins.
		if persons[best].Section != SectionOfficer && p.Section == SectionOfficer {
			best = i
		}
	}
	return best
}

var (
	// The clause is bounded by a comma as well as a full stop, and starts on a
	// word boundary. Without the boundary the leftmost match starts mid-word and
	// the quoted evidence reads "ptember 1998, our President since ..."; without
	// the comma it drags two unrelated "since" dates in front of the one that
	// matters.
	reSinceInception = regexp.MustCompile(`(?i)\b\w[^.;,]{0,69}\bsince\s+(?:our\s+|the\s+company['\x{2019}]s\s+|its\s+)?inception\b`)
	reSinceDate      = regexp.MustCompile(`(?i)\bsince\s+(?:[A-Z][a-z]+\s+)?[0-9]{4}\b`)
)

// ceoTenure returns the "since ..." clause that dates the CEO's tenure and
// whether it is the "since inception" phrasing.
//
// The inception clause wins when both are present, because it is the whole point
// of the column: Netflix's Reed Hastings IS a co-founder and his 2002 bio says
// only "Chairman of the Board since inception", so founder_self_described reads
// false and this clause is the record of why (profile, R8).
func ceoTenure(bio string) (text string, inception bool) {
	if m := reSinceInception.FindString(bio); m != "" {
		return strings.TrimSpace(m), true
	}
	return strings.TrimSpace(reSinceDate.FindString(bio)), false
}

// ---------------------------------------------------------------------------
// founder
// ---------------------------------------------------------------------------

var (
	// A founder role written into the person's own Position cell: eBay's
	// "Founder, Chairman of the Board and a director", Snap's and Airbnb's
	// "Co-Founder".
	rePosFounder = regexp.MustCompile(`(?i)\b(?:co[-\s]?)?founder\b`)
	// ... but not a firm whose NAME contains the token.
	reFounderFirm = regexp.MustCompile(`(?i)\bfounders?['\x{2019}]?\s+(?:fund|circle|forum|capital|equity)\b`)

	// Same-company referents only. Each pattern requires the issuer as the thing
	// founded, which is what keeps "founder of Starbucks", "founder of Intuit",
	// "a founder and Chief Executive Officer of Intrinsa Corporation", "was a
	// founder of Kitty Hawk Capital" and "is a co-founder [of Andreessen
	// Horowitz]" from firing.
	reBioFounder = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\b(?:our|the\s+company['\x{2019}]s)\s+(?:co[-\s]?)?founders?\b`),
		regexp.MustCompile(`(?i)\bone\s+of\s+our\s+(?:co[-\s]?)?founders\b`),
		regexp.MustCompile(`(?i)\b(?:co[-\s]?)?founded\s+(?:our\s+company|our\s+business|the\s+company|us)\b`),
		regexp.MustCompile(`(?i)\b(?:co[-\s]?)?founders?\s+of\s+(?:our\s+company|our\s+business|the\s+company)\b`),
	}
)

// A founder token whose referent, if any, follows it: "founded X", "founding X",
// "founder of X", "co-founders of X". The connector is bounded so that the
// referent has to be the thing founded — "co-founder and has been a General
// Partner of Andreessen Horowitz" leaves "and has been ..." at the cursor, not a
// name.
var (
	reFounderToken     = regexp.MustCompile(`(?i)\b(?:co[-\s]?)?found(?:ed|ing|ers?)\b`)
	reFounderConnector = regexp.MustCompile(`^(?:[\s,]*of\b)?[\s]*`)
	// The possessive form, "musicmaker.com's founder": the referent is the run
	// immediately before the token, with the clitic still attached.
	reFounderPossessive = regexp.MustCompile(`(?i)\b(?:co[-\s]?)?founders?\b`)
	rePossessiveTail    = regexp.MustCompile(`(?:['\x{2019}]s|s['\x{2019}])?[\s]*$`)
	// Whose founding is it? A bio can name a FIRM as the issuer's founder:
	// Ceres's CEO's bio reads "Dr. Hamilton was a principal at Oxford Bioscience
	// Partners, one of the leading investors in the genomics field and a founder
	// of Ceres" — the referent is the issuer and the subject is the firm. The
	// clause's subject is taken to be whichever of the two markers sits NEARER
	// the founder token in the preceding window.
	rePersonMarker = regexp.MustCompile(`(?i)\b(?:mr|mrs|ms|dr|prof|professor)\.|\b(?:he|she|they|him|her|them|his|their)\b`)
	reFirmMarker   = regexp.MustCompile(`(?i)\b(?:partners?|capital|ventures?|holdings?|associates|management|corporation|corp|incorporated|inc|company|group|fund|funds|bank|llc|llp|l\.?p\.?|l\.?l\.?c\.?)\b`)

	// Corporate-form tokens a bio drops when it names the issuer, and the
	// article an SGML name never carries but a bio does.
	issuerTailToken = map[string]bool{
		"inc": true, "incorporated": true, "corp": true, "corporation": true,
		"co": true, "company": true, "companies": true, "llc": true, "lc": true,
		"lp": true, "llp": true, "plc": true, "ltd": true, "limited": true,
		"nv": true, "sa": true, "ag": true, "ab": true, "as": true, "bv": true,
		"holdings": true, "holding": true, "group": true, "trust": true,
		"the": true, "a": true, "an": true,
	}
)

// issuerRef is the pair of anchored patterns the founder referent test needs: the
// issuer's name in full, and its shortest DISTINCTIVE leading prefix, for the
// bios that drop the corporate tail ("a co-founder of Ladder" where the header
// says "Ladder Capital Corp").
//
// A bare prefix match would charge the issuer with every company whose name
// starts with the same word, so the short form is only accepted when what
// follows it is not a further capitalised word of the same name — see
// TestRule6_FounderOfACompanySharingTheIssuersFirstWordDoesNotFire.
type issuerRef struct {
	full  *regexp.Regexp
	short *regexp.Regexp
	// and the same two anchored at the END of the text, for the possessive form.
	fullEnd *regexp.Regexp
	// The header name's INITIALS, as Virtual Radiologic Corp's prospectus writes
	// them: "Prior to co-founding VRC". Case-SENSITIVE and at least three letters
	// long, so that a lower-case word and a two-letter pair cannot reach it.
	acronym *regexp.Regexp
}

// The separator between two tokens of a name as a bio writes it: the space in
// "Beyond Meat", the dot in "musicmaker.com", the ampersand in "Smith & Wesson".
const issuerSep = `[^A-Za-z0-9]{1,3}`

// issuerReferent compiles the issuer name the SGML header states. It returns nil
// when the header states none, which leaves detectFounder with only the
// "our company" referents — the behaviour before the name was plumbed through.
func issuerReferent(name string) *issuerRef {
	var core []string
	for _, f := range strings.Fields(strings.ToLower(name)) {
		t := strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
				return r
			}
			return -1
		}, f)
		if t != "" {
			core = append(core, t)
		}
	}
	all := core
	// Drop the corporate tail, but never the whole name: "The Trust Company"
	// keeps its last token rather than becoming empty.
	for len(core) > 1 && issuerTailToken[core[len(core)-1]] {
		core = core[:len(core)-1]
	}
	for len(core) > 1 && issuerTailToken[core[0]] {
		core = core[1:]
	}
	if len(core) == 0 || len(core[0]) < 2 {
		return nil
	}
	pat := func(n int) string {
		parts := make([]string, n)
		for i, t := range core[:n] {
			parts[i] = regexp.QuoteMeta(t)
		}
		return strings.Join(parts, issuerSep)
	}
	ref := &issuerRef{
		full:    regexp.MustCompile(`(?i)^` + pat(len(core)) + `\b`),
		fullEnd: regexp.MustCompile(`(?i)\b` + pat(len(core)) + `$`),
	}
	// The shortest leading prefix long enough to identify the issuer on its own.
	for n := 1; n < len(core); n++ {
		if len(strings.Join(core[:n], "")) >= 4 {
			ref.short = regexp.MustCompile(`(?i)^` + pat(n) + `\b`)
			break
		}
	}
	if alts := issuerAcronyms(all, core); len(alts) > 0 {
		ref.acronym = regexp.MustCompile(`^(?:` + strings.Join(alts, "|") + `)\b`)
	}
	return ref
}

// issuerAcronyms is the set of initial-letter forms of the header name worth
// testing: over every token, and over the tokens left once the corporate tail is
// dropped. "Virtual Radiologic Corp" gives VRC and VR; only the first is kept,
// because two initials identify nothing.
func issuerAcronyms(all, core []string) []string {
	var out []string
	seen := map[string]bool{}
	for _, toks := range [][]string{all, core} {
		if len(toks) < 3 {
			continue
		}
		var b strings.Builder
		for _, t := range toks {
			b.WriteByte(t[0])
		}
		a := strings.ToUpper(b.String())
		if seen[a] {
			continue
		}
		seen[a] = true
		out = append(out, regexp.QuoteMeta(a))
	}
	return out
}

// namesIssuer reports whether text BEGINS with the issuer's name.
func (r *issuerRef) namesIssuer(text string) bool {
	if r == nil {
		return false
	}
	if r.full.MatchString(text) {
		return true
	}
	var m []int
	if r.acronym != nil {
		m = r.acronym.FindStringIndex(text)
	}
	if m == nil {
		if r.short == nil {
			return false
		}
		if m = r.short.FindStringIndex(text); m == nil {
			return false
		}
	}
	// " Communications Corporation" continues a DIFFERENT name; ", Dr. Hecht
	// was" and " in 2012" do not. Only a space-then-capital continues a name.
	rest := text[m[1]:]
	trimmed := strings.TrimLeft(rest, " \t\n\r ")
	if len(trimmed) < len(rest) && trimmed != "" {
		if c := trimmed[0]; c >= 'A' && c <= 'Z' {
			return false
		}
	}
	return true
}

// subjectIsThePerson reports whether the founder clause that starts at tokenStart
// is about the person rather than about a firm their bio has just named. Only the
// preceding window is read, and a window with no firm marker in it always counts
// as the person's: "Prior to co-founding Twist Bioscience, Ms. Leproust served"
// names no subject at all before the token.
func subjectIsThePerson(bio string, tokenStart int, name string) bool {
	lo := tokenStart - 220
	if lo < 0 {
		lo = 0
	}
	w := bio[lo:tokenStart]
	firm := lastIndexOf(w, reFirmMarker)
	if firm < 0 {
		return true
	}
	person := lastIndexOf(w, rePersonMarker)
	if s := surnameOf(name); s != nil {
		if i := lastIndexOf(w, s); i > person {
			person = i
		}
	}
	return person > firm
}

// A coordination that begins where the founder's own object should have been:
// "is a co-founder of, and has been Chief Executive Officer ... of Rallybio".
var (
	reGappedCoordination = regexp.MustCompile(`^,\s*and\b`)
	reOfToken            = regexp.MustCompile(`(?i)\bof\b`)
)

// gappedReferent handles the elision three of Rallybio's bios are written with
// (0001193125-21-230254): the object of "co-founder of" is dropped and shared
// with the clause coordinated onto it, so the referent sits at the LAST "of" of
// the same sentence. It reports the text following that "of", and false when
// nothing is elided — an object present right after the connector keeps the
// route from reaching past it.
func gappedReferent(rest string) (string, bool) {
	if !reGappedCoordination.MatchString(rest) {
		return "", false
	}
	s := rest
	if k := strings.Index(s, ". "); k >= 0 {
		s = s[:k]
	}
	at := lastIndexOf(s, reOfToken)
	if at < 0 {
		return "", false
	}
	return strings.TrimLeft(s[at+len("of"):], " \t\n\r"), true
}

// lastIndexOf is the start offset of re's LAST match in s, or -1.
func lastIndexOf(s string, re *regexp.Regexp) int {
	m := re.FindAllStringIndex(s, -1)
	if len(m) == 0 {
		return -1
	}
	return m[len(m)-1][0]
}

// surnameOf compiles the person's last name token, which is how a bio refers to
// them after the opening sentence ("Mr. Harris", "Dorsey co-founded").
func surnameOf(name string) *regexp.Regexp {
	f := strings.Fields(name)
	for i := len(f) - 1; i >= 0; i-- {
		t := strings.Trim(f[i], ".,()")
		if len(t) >= 3 && !reCredentialTail.MatchString(t) {
			return regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(t) + `\b`)
		}
	}
	return nil
}

// A post-nominal that is not a surname.
var reCredentialTail = regexp.MustCompile(`(?i)^(?:jr|sr|ii|iii|iv|md|phd|dds|dvm|esq|cpa|cfa|mba|ph|m|d)$`)

// detectFounder applies Design rule 6. The variable is "self-described founder"
// and it is a LOWER BOUND on founder status, not a measurement of it — see the
// README's Netflix floor.
//
// ref is the issuer name from the filing's own SGML header, or nil.
func detectFounder(p Person, ref *issuerRef) (bool, string) {
	if m := rePosFounder.FindStringIndex(p.Position); m != nil && !reFounderFirm.MatchString(p.Position) {
		return true, evidence(p.Position, m[0], m[1])
	}
	for _, re := range reBioFounder {
		m := re.FindStringIndex(p.Bio)
		if m == nil {
			continue
		}
		if reFounderFirm.MatchString(p.Bio[m[0]:m[1]]) {
			continue
		}
		return true, evidence(p.Bio, m[0], m[1])
	}
	if ref == nil {
		return false, ""
	}
	// The issuer named by name rather than as "our company".
	for _, m := range reFounderToken.FindAllStringIndex(p.Bio, -1) {
		if loc := reFounderFirm.FindStringIndex(p.Bio[m[0]:]); loc != nil && loc[0] == 0 {
			continue // the firm literally named "Founders Fund"
		}
		after := p.Bio[m[1]:]
		c := reFounderConnector.FindString(after)
		rest := after[len(c):]
		if g, ok := gappedReferent(rest); ok {
			rest = g
		}
		if ref.namesIssuer(rest) && subjectIsThePerson(p.Bio, m[0], p.Name) {
			return true, evidence(p.Bio, m[0], m[1])
		}
	}
	for _, m := range reFounderPossessive.FindAllStringIndex(p.Bio, -1) {
		before := p.Bio[:m[0]]
		if t := rePossessiveTail.FindStringIndex(before); t != nil && ref.fullEnd.MatchString(before[:t[0]]) &&
			subjectIsThePerson(p.Bio, t[0], p.Name) {
			return true, evidence(p.Bio, m[0], m[1])
		}
	}
	return false, ""
}

// evidence quotes the matched substring with enough of its sentence around it
// that a false positive is legible without re-running the parser.
//
// The window is widened to rune boundaries and then narrowed to word boundaries:
// a byte offset that lands inside a multi-byte rune would put invalid UTF-8 in
// the TSV, and one that lands inside a word yields evidence reading "ry 2004 to
// December 2004, Mr. Meresman was a Venture Partner with ...".
func evidence(src string, lo, hi int) string {
	const pad = 45
	a, b := lo-pad, hi+pad
	if a < 0 {
		a = 0
	}
	if b > len(src) {
		b = len(src)
	}
	for a > 0 && !utf8.RuneStart(src[a]) {
		a--
	}
	for b < len(src) && !utf8.RuneStart(src[b]) {
		b++
	}
	if a > 0 && isWordByte(src[a-1]) {
		if k := strings.IndexByte(src[a:lo], ' '); k >= 0 {
			a += k + 1
		}
	}
	if b < len(src) && isWordByte(src[b]) {
		if k := strings.LastIndexByte(src[hi:b], ' '); k >= 0 {
			b = hi + k
		}
	}
	return strings.TrimSpace(norm(src[a:b]))
}

func isWordByte(c byte) bool {
	return c >= '0' && c <= '9' || c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= 0x80
}

// ---------------------------------------------------------------------------
// VC affiliation
// ---------------------------------------------------------------------------

var (
	// The appositive the filings settle into from about 2002: "Kleiner Perkins
	// Caufield & Byers, a venture capital firm".
	reVCAppositive = regexp.MustCompile(`(?i),\s+(?:a|an)\s+(?:[A-Za-z-]+\s+){0,3}venture\s+capital\s+(?:firm|partnership|investor)\b`)

	// The same clause, written the other ways the corpus writes it: "a venture
	// capital fund", "a venture fund", "a prominent venture capital investment
	// firm", "a growth equity/late-stage venture capital investment firm".
	//
	// These are credited only through vcAppositiveLeadOK, because the narrow form
	// above was doing a second job by accident: the variants it rejected are
	// disproportionately the ones advisors and ex-partners use, and widening the
	// head noun on its own bought one false positive per true one on the dev
	// split.
	// "growth" joins "capital" and "investment" as a word that can sit between
	// "venture" and the head noun: HealthQuest Capital Management, "a healthcare
	// venture growth fund", is the only firm Garheng Kong holds a PRESENT
	// partnership at, and both of his labelled firms are closed partnerships
	// (0001193125-19-040772). The run is a closed list rather than any word
	// because "a venture backed software company" is a portfolio company, not a
	// venture firm.
	reVCAppositiveWide = regexp.MustCompile(`(?i),\s+(?:a|an)\s+(?:[A-Za-z/-]+\s+){0,4}venture(?:\s+(?:capital|investment|growth|equity))*\s+(?:firm|funds?|partnership|investor|company)\b`)

	// Read immediately before the firm name. A partner-grade role must be there
	// — "an advisor to iGlobe Partners", "a Senior Advisor to Sandbox
	// Industries" and "an Investment Director of GF Xinde" are the forms the
	// gold does not count — and a past-tense marker must not be, which is what
	// keeps a partnership the bio has already closed out from firing.
	// The range needs a year on BOTH sides, because the corpus leaves ranges
	// open: "From August 1979 to the present, he has been a general partner of
	// Venrock Associates" and "From September 1991 to the present, Mr. Tai has
	// been a general partner of the Walden Group of Venture Capital Funds" are
	// both present-tense partnerships written date-first.
	reVCPastWord = regexp.MustCompile(`(?i)\b(?:previously|formerly|until|was|prior\s+to)\b`)

	// The date-first form of the same thing, read through isPastLead so a
	// present-perfect verb can override it.
	reVCPastRange = regexp.MustCompile(
		`(?i)\bfrom\s+(?:[A-Z][a-z]+\s+)?[0-9]{4}\s+(?:to|until|through)\s+(?:[A-Z][a-z]+\s+)?[0-9]{4}\b`)

	// "has been" / "have been" / the filing's own "has a been" typo. A closed
	// range whose end year is the year the prospectus was FILED is not a closed
	// partnership, and the corpus says so with the verb: "From 1984 to 1996, Mr.
	// Marks has been a General Partner of New Enterprise Associates, a venture
	// capital firm" in a 1996 filing (0000950135-96-002496). The range is read
	// against the verb rather than against the filing date because the date is
	// not in scope here, and because a range the bio itself closes out uses the
	// simple past ("was", "served"), which the word alternative already catches.
	rePresentPerfect = regexp.MustCompile(`(?i)\b(?:has|have)\b(?:\s+[a-z]+){0,2}\s+been\b`)

	// The pre-2000 fallback: a partner-grade role at a firm the dictionary knows.
	// eBay 1998 carries no appositive anywhere in its MANAGEMENT section, so
	// Robert Kagle is reachable only this way (profile, R10). "Managing Director"
	// alone is NOT a VC signal — Snap's Imran Khan was one at Credit Suisse.
	reVCRole = regexp.MustCompile(`(?i)\b(?:general\s+partner|managing\s+partner|managing\s+member|` +
		`managing\s+director|founding\s+partner|venture\s+partner|general\s+manager\s+of\s+the\s+fund|` +
		`partner|member)\b`)

	// The role grades that sit AT a venture firm without being a seat in the
	// partnership: a chairman, a salaried officer, an advisor, an
	// entrepreneur-in-residence. Each of these introduces a firm the filing
	// itself calls "a venture capital firm", so the label is no help — only the
	// grade separates them from a general partner. Read as a veto and never as
	// a requirement, because the narrow appositive's true positives include
	// leads with no role in them at all ("Dr. Behbahani joined New Enterprise
	// Associates, Inc., a venture capital firm, in 2007 and is a General
	// Partner").
	reVCNonPartnerRole = regexp.MustCompile(`(?i)\b(?:advis[eo]r|chair(?:man|woman|person)|officer|` +
		`entrepreneur[\s-]?in[\s-]?residence|investment\s+director)\b`)

	// Words that end a firm name when scanning back from the appositive. A
	// camel-cased token counts: "Lanza techVentures" and "Pivotal bioVenture
	// Partners" write the firm's own name with the capital inside the word, and
	// requiring it in first position truncated both names at the camel token.
	reFirmToken = regexp.MustCompile(`^(?:[A-Z0-9(]|&$|[a-z]+[A-Z])`)

	// A firm-name token whose alphabetic body ends in "Venture"/"Ventures":
	// Ventures, Venture, BioVentures, bioVenture. The leading capital is
	// checked separately, so the lower-case "venture" of an appositive is left
	// to the two appositive routes.
	reVentureToken = regexp.MustCompile(`(?i)^[a-z]*ventures?$`)

	// The three things that can follow the firm name and disqualify it: an
	// appositive calling it a corporate venture arm, a seat on its investment
	// committee, and an appositive that says the firm's business is consulting
	// or advisory services rather than investing. The last one matters because
	// a firm whose NAME ends in Ventures is credited off the name alone, so
	// nothing else reads the label: "Myers Ventures LLC, an investment firm
	// with interests in health care consulting and international health" is a
	// consultancy (0001047469-08-003061). An appositive that calls the firm an
	// investment business is not a contradiction and must not veto — "Biobank
	// Technology Ventures, LLC, an early-stage life sciences investment
	// company" is a true positive (0000950123-12-002923).
	reCorporateVenture = regexp.MustCompile(`(?i)^[,\s]+(?:a|an)\s[^.;]{0,80}?corporate\s+venture\b`)
	reFirmCommittee    = regexp.MustCompile(`(?i)^\s+(?:investment\s+)?committee\b`)
	reFirmIsServices   = regexp.MustCompile(`(?i)^[,\s]+(?:a|an)\s(?:(?:[^.;]{0,90}?\bconsult(?:ing|ancy)\b)|(?:[^.;]{0,90}?\badvisory\s+(?:firm|services|business)\b))`)

	// The date an affiliation started, written between the firm name and the
	// appositive that labels it: "BOLD Capital Partners in 2015, a venture fund".
	// Anchored to the end of the text firmBefore is handed, so only a date
	// sitting immediately before the appositive is stripped.
	reVCStartDateTail = regexp.MustCompile(`(?i)\s+(?:in|since|during)\s+(?:[A-Z][a-z]+\s+)?[0-9]{4}$`)

	// A person can hold no partner grade at a fund they started, so the founder
	// of a firm the filing labels a venture fund is partner-grade by itself. It
	// is read only by the wide appositive's lead test, where the label has to be
	// there in words before the lead is read at all.
	reVCFounderRole = regexp.MustCompile(`(?i)\b(?:co[\s-]?)?founder\b`)

	// A closed date range opening IMMEDIATELY after the appositive: "a managing
	// partner of Medical Innovation Partners, a venture capital firm from 1989
	// through 2007" writes the dates on the far side of the clause, where no lead
	// window can see them (0001193125-12-126304). It has to be immediate —
	// Speiser, Rein, Clark and Gupta all open the NEXT sentence with a range
	// describing the job they held before the partnership they hold now.
	reVCClosedRangeTail = regexp.MustCompile(`(?i)^[,\s]*from\s+(?:[a-z]+\s+)?[0-9]{4}\s+(?:to|until|through)\b`)

	// A venture label written on the FAR side of the firm name, which is how the
	// 1990s filings label an entity they never introduce with ", a venture
	// capital firm": bare on the far side of the defined-term parenthetical
	// ("Kowaliga Capital, Inc. (\"Kowaliga\") venture capital and fund management
	// companies", 0000950144-98-004643) or in a relative clause ("Artesian
	// Capital Limited Partnership II (\"Artesian Capital II\"), which are seed
	// and start-up venture investment funds", 0000950131-96-003098). The head
	// noun can sit a few words past the "venture capital" that modifies it.
	//
	// The parenthetical form must have whitespace right after the ")": a comma
	// there is the ordinary appositive, which the two appositive routes own.
	reVCPostLabel = regexp.MustCompile(`(?i)(?:\)|,?\s+(?:each\s+of\s+)?which\s+(?:is|are))\s+` +
		`(?:[a-z/-]+\s+){0,3}venture(?:\s+(?:capital|investment|growth|equity))*` +
		`(?:\s+[a-z/-]+){0,3}\s+(?:firm|funds?|partnership|investor|compan(?:y|ies))\b`)

	// A venture label written BEFORE the firm name, which no other route reads:
	// "Co-Managing Partner of venture capital fund DCVC" (0001140361-21-013962),
	// "founded two venture capital firms, North Bridge Venture Partners in May
	// 1993" (0001193125-21-221914). The name follows the label directly or across
	// the comma that opens the list.
	reVCPreLabel = regexp.MustCompile(`(?i)\bventure\s+(?:capital|investment)\s+` +
		`(?:firms?|funds?|partnerships?|investors?|compan(?:y|ies))[,\s]+`)

	// "principal" is a partner-grade seat only where the firm itself carries a
	// venture label, in words or in its own name, so only the post-label and
	// venture-named routes read it: gold counts a Principal at the Novartis
	// Venture Fund (0001193125-21-218024) but not "a Principal" of William Blair
	// (0001047469-04-017088).
	reVCPrincipalRole = regexp.MustCompile(`(?i)\bprincipals?\b`)

	// An OPEN date range whose preposition would otherwise read as past tense:
	// "From 1993 until present, Mr. Adair has been a principal of ..."
	// (0000950144-98-004643) ends at the filing date, not before it.
	reOpenRangeEnd = regexp.MustCompile(`(?i)\b(?:until|through|to)\s+(?:the\s+)?(?:present|now|date\s+hereof)\b`)
)

// ventureLeadWindow is how far back detectVC reads for a past-tense marker
// before the partner-grade role that introduces a venture-named firm. One
// clause is too wide here: "From September 1991 to the present, Mr. Tai has
// been a general partner of the Walden Group of Venture Capital Funds" opens
// with a date range and closes it with "to the present"
// (0000891618-96-002428), so the window is the few words that actually
// introduce the role.
const ventureLeadWindow = 35

// vcFirms is the dictionary the pre-2000 fallback needs. It is a list of firms,
// not a pattern: "Ventures" or "Capital" in a name is no evidence at all (Credit
// Suisse's Investment Banking Division, Bridgemere Capital, Skoll Engineering).
// Coverage is the known limit of the pre-2000 path — it recovers the firms that
// backed the IPOs in circulation, not every firm that ever existed.
var vcFirms = []string{
	"Accel", "Advanced Technology Ventures", "Alta Partners", "Andreessen Horowitz",
	"ARCH Venture", "Artiman", "August Capital", "Austin Ventures", "Bain Capital Ventures",
	"Battery Ventures", "Benchmark", "Bessemer Venture", "Canaan Partners",
	"Charles River Ventures", "Crosspoint Venture", "DAG Ventures", "Delphi Ventures",
	"Domain Associates", "Draper Fisher Jurvetson", "El Dorado Ventures",
	"Emergence Capital", "First Round Capital", "Flagship Pioneering", "Foresite Capital",
	"Foundation Capital", "Founders Fund", "Frazier Healthcare", "General Catalyst",
	"GGV Capital", "Greylock", "Highland Capital Partners", "Hummer Winblad",
	"Index Ventures", "Insight Partners", "Institutional Venture Partners",
	"InterWest Management Partners", "InterWest Partners", "Khosla Ventures",
	"Kleiner Perkins", "Lightspeed Venture",
	"Matrix Partners", "Mayfield", "Medical Innovation Partners", "Menlo Ventures", "Meritech Capital",
	// Integ 1996 (0000950131-96-003098) spells the firm out once, in Knudson's
	// bio, and Nickoloff's and Maudlin's bios carry only the abbreviation the
	// filing defines there — a sibling bio, so out of bounds under rule 7. Same
	// case as "NEA", and the same word-boundary hazard: "MIPS Technologies".
	"MIP",
	"Mohr Davidow", "MPM Capital", "NEA", "New Enterprise Associates",
	"Norwest Venture", "Oak Investment Partners", "OrbiMed",
	"Oxford Bioscience", "Partech", "Polaris Venture", "Pontifax",
	"Prospect Venture",
	"Redpoint Ventures", "Rho Ventures", "Scale Venture", "Sequoia Capital",
	"Sevin Rosen", "Sierra Ventures", "Sigma Partners", "Sofinnova", "Spark Capital",
	"Sprout Group", "Sutter Hill", "Technology Crossover Ventures",
	"Technology Venture Investors", "The Column Group", "Third Rock Ventures",
	"Thrive Capital",
	"Trinity Ventures", "Union Square Ventures", "U.S. Venture Partners",
	"Venrock", "Versant Ventures", "Walden International",
}

// firmInWindow finds the first dictionary firm named in window, on WORD
// boundaries. A plain substring search is wrong for a short entry: "NEA" is how
// 0001193125-07-233916 spells New Enterprise Associates throughout Peter
// Barris's bio, and unanchored it also sits in the middle of "LINEAR".
// The second return value is the offset in window just past the name.
func firmInWindow(window string) (string, int) {
	for _, f := range vcFirms {
		for at := 0; ; {
			i := strings.Index(window[at:], f)
			if i < 0 {
				break
			}
			i += at
			end := i + len(f)
			beforeOK := i == 0 || !isWordByte(window[i-1])
			afterOK := end == len(window) || !isWordByte(window[end])
			if beforeOK && afterOK {
				return f, end
			}
			at = i + 1
		}
	}
	return "", 0
}

// detectVC applies Design rule 7 and returns the flag, the firms it credits and
// the quoted evidence.
func detectVC(bio string) (bool, string, string) {
	var firms, ev []string
	// Both routes can name the same firm at different lengths — the appositive
	// yields "Accel Partners" and the dictionary "Accel" — so containment, not
	// equality, is what deduplicates, keeping the longer spelling.
	add := func(firm, e string) {
		if firm == "" {
			return
		}
		lf := strings.ToLower(firm)
		for i, got := range firms {
			lg := strings.ToLower(got)
			if strings.Contains(lg, lf) {
				return
			}
			if strings.Contains(lf, lg) {
				firms[i] = firm
				return
			}
		}
		firms = append(firms, firm)
		ev = append(ev, e)
	}

	for _, m := range reVCAppositive.FindAllStringIndex(bio, -1) {
		firm, at := firmBefore(bio[:m[0]])
		if firm == "" || vcLeadIsPast(bio[:at]) || vcLeadIsNonPartner(bio[:at]) ||
			reVCClosedRangeTail.MatchString(bio[m[1]:]) {
			continue
		}
		add(firm, evidence(bio, m[0], m[1]))
	}
	for _, m := range reVCAppositiveWide.FindAllStringIndex(bio, -1) {
		firm, at := firmBefore(bio[:m[0]])
		if firm == "" || !vcAppositiveLeadOK(bio[:at]) || reVCClosedRangeTail.MatchString(bio[m[1]:]) {
			continue
		}
		add(firm, evidence(bio, m[0], m[1]))
	}
	for _, m := range reVCPostLabel.FindAllStringIndex(bio, -1) {
		// The label opens on the firm name's closing ")" in the bare form and on
		// the comma before "which" in the relative-clause one, so the name runs
		// back from the paren in the first case and from the comma in the second.
		head := bio[:m[0]]
		if bio[m[0]] == ')' {
			head = bio[:m[0]+1]
		}
		firm, at := firmBefore(head)
		if firm == "" || !vcPostLabelLeadOK(bio[:at]) ||
			reVCClosedRangeTail.MatchString(bio[m[1]:]) {
			continue
		}
		add(firm, evidence(bio, at, m[1]))
	}
	// The role window read with the firm's OWN NAME as the label, shared by the
	// two role anchors below.
	ventureNamed := func(roleLo, roleHi int, window string) {
		lead := bio[:roleLo]
		if len(lead) > ventureLeadWindow {
			lead = lead[len(lead)-ventureLeadWindow:]
		}
		if isPastLead(lead) {
			return
		}
		firm, end := ventureFirmAfter(window)
		if firm == "" {
			return
		}
		// A role word inside the captured name means the run started at a role
		// and not at the firm: anchored on the bare "member" of "a member of our
		// board of directors", the window swallows "Chief Scientific Advisor of
		// Clarus Ventures LLC" whole (0001193125-18-207640). No firm is called
		// that, and the grade that reaches the name is not a partnership.
		if reVCNonPartnerRole.MatchString(firm) {
			return
		}
		tail := window[end:]
		if reCorporateVenture.MatchString(tail) || reFirmCommittee.MatchString(tail) {
			return
		}
		// A services appositive only contradicts the name when it does not also
		// say "venture": "a venture capital and advisory firm" labels the firm
		// the way the name does. Read off the whole bio, not off window: the
		// 110-byte window cuts Myers' appositive two words before "consulting".
		if s := reFirmIsServices.FindString(bio[roleHi+end:]); s != "" &&
			!strings.Contains(strings.ToLower(s), "venture") {
			return
		}
		add(firm, evidence(bio, roleLo, roleHi+end))
	}

	for _, m := range reVCRole.FindAllStringIndex(bio, -1) {
		hi := m[1] + 110
		if hi > len(bio) {
			hi = len(bio)
		}
		window := bio[m[1]:hi]
		if !vcLeadIsPast(bio[:m[0]]) {
			if f, end := firmInWindow(window); f != "" {
				// The tail is read off the whole bio, not off window: the
				// 110-byte window routinely truncates the range mid-word.
				if !closedRangeAfterFirm(bio[m[1]+end:]) {
					add(f, evidence(bio, m[0], m[1]+end))
				}
			} else if sent := roleSentence(bio[:m[0]]); !isPastLead(sent) {
				// The firm can be named BEFORE the role, in the same sentence:
				// "Dr. Roberts joined Venrock, a venture capital investment
				// firm, in 1997, where he serves as partner". The forward window
				// opens on the far side of the role and the appositive lead test
				// wants the role first, so this arrangement is invisible to
				// both. The window is the role's own sentence rather than
				// vcLead's 90 bytes, which cut "Venrock" off by two characters,
				// and the tense test is re-run over that whole sentence so the
				// wider read cannot smuggle a closed seat in with it.
				if f, _ := firmInWindow(sent); f != "" {
					add(f, evidence(bio, m[0], m[1]))
				}
			}
		}
		ventureNamed(m[0], m[1], window)
	}
	for _, m := range reVCPreLabel.FindAllStringIndex(bio, -1) {
		firm, end := firmAfterLabel(bio[m[1]:])
		if firm == "" {
			continue
		}
		// The label alone is no affiliation: the sentence it sits in has to put
		// the person in a partner-grade seat, in the present. The grade is read
		// off the WHOLE sentence and not off the lead, because North Bridge's
		// partnership is written on the far side of the name ("where he
		// currently serves as a Managing Partner").
		sent := sentenceAround(bio, m[0])
		if !reVCRole.MatchString(sent) || isPastLead(sent) {
			continue
		}
		add(firm, evidence(bio, m[0], m[1]+end))
	}
	// "Principal" reaches a firm the FILING labels through the post-positioned
	// route above, and a firm its own NAME labels here: "Dr. Shangari has served
	// as a Principal at the Novartis Venture Fund since 2018"
	// (0001193125-21-218024). Only that route, because the word alone is no
	// grade -- gold excludes "a Principal" of William Blair
	// (0001047469-04-017088), a principal of Global Retail Partners, L.P.
	// (0001012870-99-002065) and Silver Lake's founding principal
	// (0001193125-20-249257), none of whose firms is venture in name or label.
	for _, m := range reVCPrincipalRole.FindAllStringIndex(bio, -1) {
		hi := m[1] + 110
		if hi > len(bio) {
			hi = len(bio)
		}
		ventureNamed(m[0], m[1], bio[m[1]:hi])
	}
	if len(firms) == 0 {
		return false, "", ""
	}
	return true, strings.Join(firms, "; "), ev[0]
}

// closedRangeAfterFirm reports whether a closed date range opens immediately
// after a firm name the dictionary matched, optionally across the appositive
// that labels it. The two appositive routes read the same range off the far side
// of their own match; the dictionary route anchors on the firm, so the label sits
// between it and the dates: "a managing partner of Medical Innovation Partners,
// a venture capital firm from 1989 through 2007" (0001193125-12-126304).
//
// The range has to open right there. A later clause in the same sentence is not
// the same claim — "a Venture Partner at The Column Group since 2020, and prior
// to that served as an Associate beginning in 2015, then as a Partner from 2019
// to 2020" closes out a JUNIOR seat and holds the partnership (0001193125-21-231612).
func closedRangeAfterFirm(tail string) bool {
	if reVCClosedRangeTail.MatchString(tail) {
		return true
	}
	for _, re := range []*regexp.Regexp{reVCAppositive, reVCAppositiveWide} {
		if m := re.FindStringIndex(tail); m != nil && m[0] == 0 &&
			reVCClosedRangeTail.MatchString(tail[m[1]:]) {
			return true
		}
	}
	return false
}

// firmBefore reads the firm name off the text immediately before a
// ", a venture capital firm" appositive: the trailing run of proper-noun tokens.
// It stops at the first lower-case function word, which is what separates
// "Andreessen Horowitz" from the "General Partner of" that introduces it. The
// second return value is the byte offset the name starts at, which is where
// vcAppositiveLeadOK reads back from.
//
// The date the affiliation STARTED can sit between the name and the appositive:
// "a co-founder of BOLD Capital Partners in 2015, a venture fund investing in
// exponential technologies" (0001193125-21-328157). That phrase is stripped
// before the name is read, because the year is not the firm and neither is the
// month in front of it. A run that is nothing but digits is still rejected, for
// the date forms the strip does not reach.
func firmBefore(head string) (string, int) {
	head = strings.TrimRight(head, " \t")
	if m := reVCStartDateTail.FindStringIndex(head); m != nil {
		head = strings.TrimRight(head[:m[0]], " \t")
	}
	toks := strings.Fields(head)
	i := len(toks)
	for i > 0 {
		t := strings.TrimRight(toks[i-1], ",;:")
		if t == "" || !reFirmToken.MatchString(t) {
			break
		}
		i--
		if len(toks)-i >= 8 {
			break
		}
	}
	if i == len(toks) {
		return "", 0
	}
	firm := strings.TrimRight(strings.TrimSpace(strings.Join(toks[i:], " ")), ",;:")
	if firm == "" || !strings.ContainsFunc(firm, func(r rune) bool { return r < '0' || r > '9' }) {
		return "", 0
	}
	at := strings.LastIndex(head, firm)
	if at < 0 {
		at = len(head)
	}
	return firm, at
}

// vcAppositiveLeadOK reports whether the text running up to the firm name puts
// the person in a partner-grade role at it, in the present tense. The window is
// one clause wide: wider and it reaches the previous sentence's employer, which
// on this corpus is routinely the job the person left.
func vcAppositiveLeadOK(lead string) bool {
	l := vcLead(lead)
	return (reVCRole.MatchString(l) || reVCFounderRole.MatchString(l)) && !vcLeadIsPast(lead)
}

// vcPostLabelLeadOK reports whether the clause running up to a firm the filing
// labels on the FAR side of its name puts the person at a present partner-grade
// seat there. Unlike the appositive routes this one is a requirement and not a
// veto: the label can just as easily be attached to a portfolio fund the person
// only sits on the board of, and the lead is all that separates the two.
func vcPostLabelLeadOK(lead string) bool {
	l := vcLead(lead)
	if isPastLead(l) || (reVCNonPartnerRole.MatchString(l) && !reVCRole.MatchString(l)) {
		return false
	}
	return reVCRole.MatchString(l) || reVCPrincipalRole.MatchString(l)
}

// vcLeadIsPast reports whether the clause that runs up to the firm name puts the
// affiliation in the past. It is the only tense test the narrow appositive and
// the firm dictionary get: neither reads a role, because the narrow appositive's
// own true positives include "Dr. Behbahani joined New Enterprise Associates,
// Inc., a venture capital firm, in 2007 and is a General Partner" and
// "all entities affiliated with Canaan Partners, a venture capital firm", where
// the role sits on the far side of the name.
//
// The tense test reads the firm's WHOLE sentence and not just vcLead's 90
// bytes, because the corpus writes the marker at the head of a sentence whose
// firm is at its tail: "Prior to joining HBM Partners AG, Dr. Leo worked as a
// postdoctoral scientist at Stanford University, as a physician at the
// University Hospital Leipzig and as a principal at Wellington Partners, a
// venture capital firm" (0001193125-21-199386) puts 130 bytes between the two.
// Only the tense test is widened: the ROLE requirement in vcAppositiveLeadOK
// stays on vcLead, where a partner-grade word has to sit next to the name it
// grades rather than anywhere in the sentence. Both reads are kept because the
// wider one can pick up a present-perfect verb that cancels a closed range the
// narrow one reads as past.
func vcLeadIsPast(lead string) bool {
	return isPastLead(vcLead(lead)) || isPastLead(roleSentence(lead))
}

// isPastLead reports whether the text puts the affiliation in the past. A closed
// date range says so only when no present-perfect verb contradicts it.
func isPastLead(s string) bool {
	s = reOpenRangeEnd.ReplaceAllString(s, " ")
	if reVCPastWord.MatchString(s) {
		return true
	}
	return reVCPastRange.MatchString(s) && !rePresentPerfect.MatchString(s)
}

// roleSentence is the sentence the role sits in, from its first word up to the
// role itself. It is vcLead without the byte cap, and only the firm dictionary's
// backward window uses it: a name as short as "Venrock" can sit just outside 90
// bytes and still be in the same clause as the seat held at it.
func roleSentence(lead string) string {
	if at := lastSentenceStart(lead); at > 0 {
		return lead[at:]
	}
	return lead
}

// vcLeadIsNonPartner reports whether the clause that runs up to the firm name
// puts the person in a role at it that is not a seat in the partnership, AND in
// no partner-grade role. Both halves are needed: "Managing Partner and Chairman
// of X Ventures" names a chairmanship and a partnership in one breath, and it
// is the partnership that decides.
func vcLeadIsNonPartner(lead string) bool {
	l := vcLead(lead)
	return reVCNonPartnerRole.MatchString(l) && !reVCRole.MatchString(l)
}

// vcLead is the one clause before the firm name: the last 90 bytes, cut back to
// the start of the sentence the role sits in. The sentence cut is what keeps
// Matthew Foy's own board service — "He previously served as a member of our
// board of directors from April 2019 to November 2020. Mr. Foy has been a
// partner at SR One Capital Management, LP, a venture capital firm, since 2011"
// — from reading as a closed partnership.
//
// The boundary cannot be the last ". " in the window, because the honorific in
// "Mr. Slootman served as a Partner of Greylock Partners" is one, and cutting
// there would throw away the date range that sentence opens with.
func vcLead(lead string) string {
	const window = 90
	if len(lead) > window {
		lead = lead[len(lead)-window:]
	}
	if at := lastSentenceStart(lead); at > 0 {
		lead = lead[at:]
	}
	return lead
}

// An abbreviation whose full stop does not end a sentence. A single letter is
// one too: "Rory T. O'Driscoll", "Woodrow A. Myers".
var reNotSentenceEnd = regexp.MustCompile(`(?i)(?:^|[\s(])(?:[a-z]|mr|mrs|ms|dr|prof|jr|sr|st|no|inc|corp|co|ltd|llc|llp|lp|l\.p|u\.s|ph|approx|e\.g|i\.e)\.\s+$`)

// lastSentenceStart is the offset just past the LAST sentence-ending full stop
// in s, or 0 when s holds none.
func lastSentenceStart(s string) int {
	at := 0
	for i := 0; i < len(s)-1; i++ {
		if s[i] != '.' || (s[i+1] != ' ' && s[i+1] != '\t' && s[i+1] != '\n') {
			continue
		}
		j := i + 1
		for j < len(s) && (s[j] == ' ' || s[j] == '\t' || s[j] == '\n') {
			j++
		}
		if !reNotSentenceEnd.MatchString(s[:j]) {
			at = j
		}
	}
	return at
}

// ventureFirmAfter reads a firm name out of the window that follows a
// partner-grade role, when the name itself carries the label: a token ending in
// "Venture"/"Ventures", with the run of proper-noun tokens either side of it.
// The second return value is the offset in window just past the name, which is
// where detectVC checks for the "corporate venture" and "investment committee"
// disqualifiers.
//
// "of", "the" and "and" are crossed when a firm token sits beyond them, which is
// what keeps "Walden Group of Venture Capital Funds" whole. Nothing else
// lower-case is, so the "a venture capital firm" of an appositive cannot be read
// as part of a name.
func ventureFirmAfter(window string) (string, int) {
	type tok struct {
		lo, hi int
		text   string
	}
	var toks []tok
	for i := 0; i < len(window); {
		for i < len(window) && (window[i] == ' ' || window[i] == '\t' || window[i] == '\n') {
			i++
		}
		start := i
		for i < len(window) && window[i] != ' ' && window[i] != '\t' && window[i] != '\n' {
			i++
		}
		if i > start {
			toks = append(toks, tok{start, i, strings.Trim(window[start:i], `.,;:()"`)})
		}
	}
	for i, t := range toks {
		if t.text == "" || !isUpperASCII(t.text[0]) || !reVentureToken.MatchString(t.text) {
			continue
		}
		lo := i
		for lo > 0 {
			p := toks[lo-1].text
			if p != "" && reFirmToken.MatchString(p) {
				lo--
				continue
			}
			lower := strings.ToLower(p)
			if (lower == "of" || lower == "the" || lower == "and") && lo-2 >= 0 &&
				toks[lo-2].text != "" && reFirmToken.MatchString(toks[lo-2].text) {
				lo--
				continue
			}
			break
		}
		hi := i + 1
		for hi < len(toks) && hi-i < 5 && toks[hi].text != "" && reFirmToken.MatchString(toks[hi].text) {
			hi++
		}
		parts := make([]string, 0, hi-lo)
		for k := lo; k < hi; k++ {
			parts = append(parts, toks[k].text)
		}
		firm := strings.Trim(strings.Join(parts, " "), " ,;:")
		if firm == "" {
			return "", 0
		}
		return firm, toks[hi-1].hi
	}
	return "", 0
}

func isUpperASCII(c byte) bool { return c >= 'A' && c <= 'Z' }

// firmAfterLabel reads a firm name written immediately after a venture label,
// as the run of proper-noun tokens that opens the window. It is the forward
// twin of firmBefore: the first token must itself be a firm token, so a label
// followed by ordinary prose ("venture capital firms in the Boston area")
// yields nothing. "of", "the" and "and" are crossed when a firm token follows,
// which is what keeps a name like "Bank of America Ventures" whole.
func firmAfterLabel(window string) (string, int) {
	toks := strings.Fields(window)
	if len(toks) == 0 {
		return "", 0
	}
	n := 0
	for n < len(toks) && n < 8 {
		t := strings.TrimRight(toks[n], ",;:.")
		if t != "" && reFirmToken.MatchString(t) {
			n++
			continue
		}
		lower := strings.ToLower(t)
		if (lower == "of" || lower == "the" || lower == "and") && n+1 < len(toks) {
			next := strings.TrimRight(toks[n+1], ",;:.")
			if next != "" && reFirmToken.MatchString(next) {
				n++
				continue
			}
		}
		break
	}
	if n == 0 {
		return "", 0
	}
	firm := strings.TrimRight(strings.Join(toks[:n], " "), " ,;:.")
	if firm == "" || !strings.ContainsFunc(firm, func(r rune) bool { return r < '0' || r > '9' }) {
		return "", 0
	}
	end := strings.Index(window, firm)
	if end < 0 {
		return firm, len(window)
	}
	return firm, end + len(firm)
}

// sentenceAround is the whole sentence holding the byte at lo: lastSentenceStart
// gives its head and the next sentence-ending full stop its tail. The routes
// that read only a lead cannot use it, but a label written in front of the firm
// name can have its grade on either side of that name.
func sentenceAround(s string, lo int) string {
	start := lastSentenceStart(s[:lo])
	rest := s[lo:]
	end := len(rest)
	for i := 0; i < len(rest)-1; i++ {
		if rest[i] != '.' || (rest[i+1] != ' ' && rest[i+1] != '\t' && rest[i+1] != '\n') {
			continue
		}
		if !reNotSentenceEnd.MatchString(rest[:i+2]) {
			end = i + 1
			break
		}
	}
	return s[start : lo+end]
}
