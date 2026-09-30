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
	reSinceInception = regexp.MustCompile(`(?i)\b\w[^.;,]{0,69}\bsince\s+(?:our\s+|the\s+company's\s+|its\s+)?inception\b`)
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
	reFounderFirm = regexp.MustCompile(`(?i)\bfounders?'?\s+(?:fund|circle|forum|capital|equity)\b`)

	// Same-company referents only. Each pattern requires the issuer as the thing
	// founded, which is what keeps "founder of Starbucks", "founder of Intuit",
	// "a founder and Chief Executive Officer of Intrinsa Corporation", "was a
	// founder of Kitty Hawk Capital" and "is a co-founder [of Andreessen
	// Horowitz]" from firing.
	reBioFounder = []*regexp.Regexp{
		regexp.MustCompile(`(?i)\b(?:our|the\s+company's)\s+(?:co[-\s]?)?founders?\b`),
		regexp.MustCompile(`(?i)\bone\s+of\s+our\s+(?:co[-\s]?)?founders\b`),
		regexp.MustCompile(`(?i)\b(?:co[-\s]?)?founded\s+(?:our\s+company|our\s+business|the\s+company|us)\b`),
		regexp.MustCompile(`(?i)\b(?:co[-\s]?)?founders?\s+of\s+(?:our\s+company|our\s+business|the\s+company)\b`),
	}
)

// detectFounder applies Design rule 6. The variable is "self-described founder"
// and it is a LOWER BOUND on founder status, not a measurement of it — see the
// README's Netflix floor.
func detectFounder(p Person) (bool, string) {
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
	reVCAppositiveWide = regexp.MustCompile(`(?i),\s+(?:a|an)\s+(?:[A-Za-z/-]+\s+){0,4}venture(?:\s+capital)?(?:\s+investment)?\s+(?:firm|funds?|partnership|investor|company)\b`)

	// Read immediately before the firm name. A partner-grade role must be there
	// — "an advisor to iGlobe Partners", "a Senior Advisor to Sandbox
	// Industries" and "an Investment Director of GF Xinde" are the forms the
	// gold does not count — and a past-tense marker must not be, which is what
	// keeps a partnership the bio has already closed out from firing.
	reVCPastLead = regexp.MustCompile(`(?i)\b(?:previously|formerly|until|was|prior\s+to)\b|` +
		`\bfrom\s+(?:[A-Z][a-z]+\s+)?[0-9]{4}\s+(?:to|until|through)\b`)

	// The pre-2000 fallback: a partner-grade role at a firm the dictionary knows.
	// eBay 1998 carries no appositive anywhere in its MANAGEMENT section, so
	// Robert Kagle is reachable only this way (profile, R10). "Managing Director"
	// alone is NOT a VC signal — Snap's Imran Khan was one at Credit Suisse.
	reVCRole = regexp.MustCompile(`(?i)\b(?:general\s+partner|managing\s+partner|managing\s+member|` +
		`managing\s+director|founding\s+partner|venture\s+partner|general\s+manager\s+of\s+the\s+fund|` +
		`partner|member)\b`)

	// Words that end a firm name when scanning back from the appositive.
	reFirmToken = regexp.MustCompile(`^(?:[A-Z0-9(]|&$)`)
)

// vcFirms is the dictionary the pre-2000 fallback needs. It is a list of firms,
// not a pattern: "Ventures" or "Capital" in a name is no evidence at all (Credit
// Suisse's Investment Banking Division, Bridgemere Capital, Skoll Engineering).
// Coverage is the known limit of the pre-2000 path — it recovers the firms that
// backed the IPOs in circulation, not every firm that ever existed.
var vcFirms = []string{
	"Accel", "Advanced Technology Ventures", "Alta Partners", "Andreessen Horowitz",
	"ARCH Venture", "August Capital", "Austin Ventures", "Bain Capital Ventures",
	"Battery Ventures", "Benchmark", "Bessemer Venture", "Canaan Partners",
	"Charles River Ventures", "Crosspoint Venture", "DAG Ventures", "Delphi Ventures",
	"Domain Associates", "Draper Fisher Jurvetson", "El Dorado Ventures",
	"Emergence Capital", "First Round Capital", "Flagship Pioneering",
	"Foundation Capital", "Founders Fund", "Frazier Healthcare", "General Catalyst",
	"GGV Capital", "Greylock", "Highland Capital Partners", "Hummer Winblad",
	"Index Ventures", "Insight Partners", "Institutional Venture Partners",
	"InterWest Partners", "Khosla Ventures", "Kleiner Perkins", "Lightspeed Venture",
	"Matrix Partners", "Mayfield", "Menlo Ventures", "Meritech Capital",
	"Mohr Davidow", "MPM Capital", "New Enterprise Associates", "Norwest Venture",
	"Oak Investment Partners", "OrbiMed", "Polaris Venture", "Prospect Venture",
	"Redpoint Ventures", "Rho Ventures", "Scale Venture", "Sequoia Capital",
	"Sevin Rosen", "Sierra Ventures", "Sigma Partners", "Sofinnova", "Spark Capital",
	"Sprout Group", "Sutter Hill", "Technology Crossover Ventures",
	"Technology Venture Investors", "Third Rock Ventures", "Thrive Capital",
	"Trinity Ventures", "Union Square Ventures", "U.S. Venture Partners",
	"Venrock", "Versant Ventures", "Walden International",
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
		if firm, _ := firmBefore(bio[:m[0]]); firm != "" {
			add(firm, evidence(bio, m[0], m[1]))
		}
	}
	for _, m := range reVCAppositiveWide.FindAllStringIndex(bio, -1) {
		firm, at := firmBefore(bio[:m[0]])
		if firm == "" || !vcAppositiveLeadOK(bio[:at]) {
			continue
		}
		add(firm, evidence(bio, m[0], m[1]))
	}
	for _, m := range reVCRole.FindAllStringIndex(bio, -1) {
		hi := m[1] + 110
		if hi > len(bio) {
			hi = len(bio)
		}
		window := bio[m[1]:hi]
		for _, f := range vcFirms {
			if at := strings.Index(window, f); at >= 0 {
				add(f, evidence(bio, m[0], m[1]+at+len(f)))
				break
			}
		}
	}
	if len(firms) == 0 {
		return false, "", ""
	}
	return true, strings.Join(firms, "; "), ev[0]
}

// firmBefore reads the firm name off the text immediately before a
// ", a venture capital firm" appositive: the trailing run of proper-noun tokens.
// It stops at the first lower-case function word, which is what separates
// "Andreessen Horowitz" from the "General Partner of" that introduces it. The
// second return value is the byte offset the name starts at, which is where
// vcAppositiveLeadOK reads back from.
//
// A run that is nothing but digits is rejected: "a co-founder of BOLD Capital
// Partners in 2015, a venture fund investing in exponential technologies" puts
// the appositive after the date, and the year is not the firm.
func firmBefore(head string) (string, int) {
	head = strings.TrimRight(head, " \t")
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
	const window = 90
	if len(lead) > window {
		lead = lead[len(lead)-window:]
	}
	return reVCRole.MatchString(lead) && !reVCPastLead.MatchString(lead)
}
