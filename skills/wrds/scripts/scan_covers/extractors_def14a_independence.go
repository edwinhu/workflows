package main

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Board-declared director-independence extraction from DEF 14A proxies.
//
// The object is DGCL 144(d)(2)'s "the board of directors shall have determined
// that such director satisfies the applicable criteria for determining director
// independence ... under the rules ... promulgated by such exchange" — i.e. the
// board's own affirmative determination, which is a different object from a
// vendor independence label and is only in the filing.
//
// TEXT SHAPE TRAP. /wrds/sec/wrds_clean_filings is HTML-stripped but NOT
// re-flowed: roughly half of proxies arrive hard-wrapped mid-sentence (Apple,
// Ford, Alphabet, Cato in the fixture set) and half arrive one paragraph per
// line (Exxon, JPMorgan, Meta, Wendy's). Any line- or paragraph-anchored regex
// silently loses the wrapped half, so everything below runs on a
// whitespace-collapsed single-line rendering.

var (
	reITag        = regexp.MustCompile(`<[^>\n]+>`)
	reIEntity     = regexp.MustCompile(`&(?:nbsp|amp|lt|gt|quot|#\d+);`)
	reIWhitespace = regexp.MustCompile(`\s+`)

	// Sentence anchors. Two families, because a filing can state the
	// determination without the verb ("The independent directors are: ...").
	reDetVerb = regexp.MustCompile(`(?i)\bdetermin(?:ed|es|ation|ations)\b`)
	reAreCue  = regexp.MustCompile(`(?i)\bindependent\s+directors\s+(?:are|is)\s*:`)

	// Sentence is about a COMMITTEE's members, not the board's composition.
	// Committee determinations are a different (and much easier) object; letting
	// them in would report three-member "boards". The `for ... committees` arm
	// catches the heightened-standard restatement, which repeats the roster and
	// would otherwise outscore the real determination on name count (Ford).
	// The committee phrase must SCOPE the determination ("each member of the
	// Audit Committee"), not merely appear in it. Alphabet's 2024 sentence names
	// a departed director as "a member of our Board and Audit Committee" in a
	// subordinate clause and is the real board-level determination.
	reCommitteeScope = regexp.MustCompile(`(?i)((?:each|all|every)\s+(?:one\s+)?(?:of\s+(?:the|our)\s+)?(?:members?|directors?)\s+(?:of|serving\s+on|on)\s+(?:the|our)[^.]{0,120}?committee|committee\s+members?|audit\s+committee\s+financial\s+expert|compensation\s+consultant|\bcomprises?\b|\bcomprised\s+of\b|(?:standards?|requirements?|criteria)\s+(?:applicable\s+to\s+|for\s+)(?:audit|compensation|nominating)\s+committee)`)

	// A NEGATIVE determination. "Mr. John P. D. Cato, an employee of the
	// Company, is not independent" sits one sentence after the independent
	// roster and would otherwise be unioned into it.
	reNegDet = regexp.MustCompile(`(?i)\b(?:is|are|was|were|not\s+be)\s+not\s+independent|\bnon-?independent\b|\bnot\s+(?:be\s+)?(?:considered|deemed)\s+independent`)

	// The sentence must actually PREDICATE independence of someone. Without
	// this, "does not interfere with the exercise of independent judgment"
	// (the immateriality clause) reads as a determination and the directors
	// named in it become the independent set (Meta).
	rePredIndep = regexp.MustCompile(`(?i)(?:\b(?:is|are|was|were|be|been|qualif\w+|meet\w*|deemed|found|considered)\b[^.]{0,90}\bindependen|independent\s+directors?\s+(?:are|is)\b)`)

	// The sentence must be about DIRECTORS. Charter and bylaw exhibits are full
	// of "determination" and "independent" (appraisal firms, redemption terms).
	reAboutDirectors = regexp.MustCompile(`(?i)\b(?:directors?|nominees?|board\s+members?|(?:the|our)\s+board)\b`)

	// "Independent" also modifies auditors, compensation consultants, appraisal
	// firms and judgment. A sentence whose ONLY independence words are of that
	// kind is not a determination — charter and bylaw exhibits are full of them.
	reIndepOther = regexp.MustCompile(`(?i)independen\w*\s+(?:registered|auditors?|accountants?|accounting|investment|appraisal|contractor|judgment|judgement|counsel|compensation\s+consultant|third[- ]party|public\s+accounting)`)

	// Auditor independence — the other thing "independent" means in a proxy.
	reAuditorIndep = regexp.MustCompile(`(?i)independent\s+(?:registered\s+public\s+accounting|auditors?|accountants?)`)

	// Form cues.
	// Colon rosters. The lead-in routinely carries the exchange rule cite, which
	// contains periods ("Sections 303A.02(a) and (b) of the New York Stock
	// Exchange..."), so the lead-in cannot be period-free and cannot be short.
	reCueColon    = regexp.MustCompile(`(?i)(?:following|independent\s+directors?\s+(?:are|is)|independent)[^:]{0,320}:\s`)
	reCueEachOf   = regexp.MustCompile(`(?i)\beach\s+of\s+`)
	reCueDetThat  = regexp.MustCompile(`(?i)\bdetermin(?:ed|es)\b[^.]{0,40}?\bthat\s+`)
	reCueExcept   = regexp.MustCompile(`(?i)\b(?:except(?:\s+for)?|other\s+than|with\s+the\s+exception\s+of)\b[:,]?\s+`)
	reCueAllNonEm = regexp.MustCompile(`(?i)\b(?:all|each|none|every)\b[^.]{0,80}?\bnon-?\s?(?:employee|management)\b[^.]{0,10}\bdirectors?\b`)
	reCueNonEmAlt = regexp.MustCompile(`(?i)\bnon-?\s?(?:employee|management)\s+directors?\s+(?:and\s+director\s+nominees\s+)?(?:is|are|were|had|has)\b`)

	reIndepWord = regexp.MustCompile(`(?i)\bindependen`)

	// Exchange + rule citation.
	reNyseAmer   = regexp.MustCompile(`(?i)\bNYSE\s+American\b|\bNYSE\s+MKT\b|\bAmerican\s+Stock\s+Exchange\b`)
	reNyse       = regexp.MustCompile(`(?i)\bNYSE\b|\bNew\s+York\s+Stock\s+Exchange\b`)
	reNasdaq     = regexp.MustCompile(`(?i)\bNasdaq\b|\bNASDAQ\b`)
	// The INDEPENDENCE rule specifically. A bare "Rule 5605" is usually
	// 5605(c)(2) (audit committee) or 5605(d) (compensation committee); counting
	// it would report a rule citation the board never made for independence.
	reNyseRule   = regexp.MustCompile(`(?i)\b303A\s*\.\s*0?2\b`)
	reNasdaqRule = regexp.MustCompile(`(?i)\b5605\s*\(\s*a\s*\)\s*\(\s*2\s*\)`)

	// Categorical standards and where they live.
	reCatStd = regexp.MustCompile(`(?i)(categorical\s+standards?|independence\s+(?:standards?|tests?|criteria|definitions?|guidelines?)|director\s+independence\s+guidelines?|standards?\s+(?:for|of)\s+director\s+independence)`)
	reOnWeb  = regexp.MustCompile(`(?i)(?:available|posted|can\s+be\s+found|found|located|accessible)[^.]{0,80}(?:website|www\.|https?://|investor\s+relations)`)
	reInAppx = regexp.MustCompile(`(?i)(?:attached|set\s+forth|included|reproduced)\s+(?:as|in)\s+(?:Appendix|Annex|Exhibit|Schedule)\s+[A-Z0-9]`)
	// Bright-line criteria actually reproduced in the document.
	reBrightLine = regexp.MustCompile(`(?i)(?:no\s+director\s+[^.]{0,140}?\b(?:can|will|shall|is)\s+(?:be\s+)?(?:considered\s+|qualify\s+as\s+|deemed\s+)?independent|a\s+director\s+(?:will|shall|is|is\s+not)\s+not\s+be\s+(?:considered|deemed)|will\s+preclude\s+a\s+director|will\s+not\s+be\s+considered\s+(?:to\s+be\s+)?(?:a\s+)?material|a\s+director\s+who\s+(?:accepted|is|was|has)|director\s+will\s+not\s+be\s+deemed\s+independent)`)

	// THE MONEY FIELD: relationships considered and nonetheless deemed immaterial.
	reConsidered = regexp.MustCompile(`(?i)(in\s+(?:making|reaching)\s+(?:its|this|these|such|their)\s+(?:independence\s+)?determinations?|(?:board|committee)\s+(?:of\s+directors\s+)?(?:also\s+)?considered\s+(?:the\s+following|that|whether|transactions|all\s+transactions|certain)|considered\s+the\s+following\s+(?:transactions|relationships)|assessing\s+the\s+materiality)`)
	reImmaterial = regexp.MustCompile(`(?i)(deemed\s+(?:to\s+be\s+)?(?:categorically\s+)?immaterial|only\s+immaterial\s+relationships|(?:was|were|are|is)\s+not\s+(?:deemed\s+)?material|not\s+(?:to\s+be\s+)?material\s+(?:to|and|relationships?)|do(?:es)?\s+not\s+interfere\s+with\s+the\s+exercise\s+of\s+independent|deemed\s+by\s+the\s+board\s+not\s+to\s+interfere)`)
	reNoneFound  = regexp.MustCompile(`(?i)identified\s+no\s+(?:transactions|relationships)|no\s+(?:such\s+)?transactions,?\s+relationships|there\s+were\s+no\s+(?:transactions|relationships)`)

	// Counts: "Ten of the 13 members ... are independent" / "seven members, six of
	// whom are independent".
	reCountA = regexp.MustCompile(`(?i)\b([A-Za-z0-9]+)\s+of\s+(?:the\s+|our\s+)?([A-Za-z0-9]+)\s+(?:members|directors|director\s+nominees|nominees)\b[^.]{0,80}?\bindependent\b`)
	reCountB = regexp.MustCompile(`(?i)(?:composed|comprised|consists?|consisting)\s+of\s+([A-Za-z0-9]+)\s+(?:members|directors)\b[^.]{0,40}?\b([A-Za-z0-9]+)\s+of\s+whom\s+(?:are|have\s+been\s+determined\s+to\s+be)\s+independent`)
	rePctIndep = regexp.MustCompile(`(?i)\b(\d{1,3})\s*%\s+of\s+(?:our\s+|the\s+)?(?:director\s+)?(?:nominees|directors)\s+are\s+independent`)

	// Board size stated in words. def14a_directors' Name-Age anchor returns zero
	// directors on 14 of the 31 fixture proxies (modern decks write "Age: 63" in
	// a graphic, not "Smith, 63"), so the slate cannot be relied on for the
	// denominator. These two phrasings recover it directly when present.
	reBoardRatio = regexp.MustCompile(`(?i)\b([0-9]{1,2}|[a-z]{3,9})\s+of\s+(?:the\s+|our\s+)?(?:current\s+)?([0-9]{1,2}|[a-z]{3,9})\s+(?:directors?|director\s+nominees?|nominees?|board\s+members?|members\s+of\s+(?:the|our)\s+board)\s+(?:are|were|is|have\s+been\s+determined\s+to\s+be)\s+independent`)
	reBoardSize  = regexp.MustCompile(`(?i)\bboard\s+(?:of\s+directors\s+)?(?:is\s+)?(?:currently\s+)?(?:consists\s+of|consist\s+of|composed\s+of|comprised\s+of|has)\s+([0-9]{1,2}|[a-z]{3,9})\s+(?:members|directors)`)
)

var numWords = map[string]int{
	"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
	"eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
	"fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
	"nineteen": 19, "twenty": 20,
}

func toNum(s string) int {
	s = strings.ToLower(strings.TrimSpace(s))
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	if n, ok := numWords[s]; ok {
		return n
	}
	return 0
}

func indepNormalize(b []byte) string {
	s := reITag.ReplaceAllString(string(b), " ")
	s = reIEntity.ReplaceAllString(s, " ")
	return reIWhitespace.ReplaceAllString(s, " ")
}

// ---------------------------------------------------------------------------
// Name-run scanner
//
// Proxies name the independent set in at least five surface forms and only one
// of them is a list of full names:
//
//	full     "Kimberly A. Casiano, Adriana Cisneros, ... and John S. Weinberg"
//	surname  "Mses. Battle, Cashman and Hamlet, the Hon. Sen. Wampler and
//	          Messrs. Belk, Goergen, McDowell and Warden"
//	paren    "each non-management director (Linda B. Bammann, ...) had only
//	          immaterial relationships"
//	single   "except Larry, Sergey, and Sundar"      (FIRST names, Alphabet)
//	single   "all Board members, other than Mr. Cook" (surname, Apple)
//
// A regex that spans all five either misses the surname forms or swallows the
// lead-in ("...has determined that each of Mses. Battle"). So the scanner works
// at token level and takes the LONGEST run of comma/and-joined name items in the
// sentence: the lead-in breaks on its first lowercase verb, and organisation
// names ("New York Stock Exchange", "Securities Exchange Act") lose on length
// and are killed by the all-stopword item filter.
// ---------------------------------------------------------------------------

var nameTitles = map[string]bool{
	"mr": true, "mrs": true, "ms": true, "dr": true, "prof": true, "messrs": true,
	"mses": true, "mmes": true, "hon": true, "sen": true, "gen": true, "amb": true,
	"ambassador": true, "rev": true, "sir": true, "lord": true, "capt": true,
	"col": true, "maj": true, "gov": true, "judge": true, "honorable": true,
	"admiral": true, "adm": true, "rep": true,
}

var nameSuffixes = map[string]bool{
	"jr": true, "sr": true, "ii": true, "iii": true, "iv": true, "v": true,
	"phd": true, "md": true, "esq": true,
}

var nameParticles = map[string]bool{
	"van": true, "von": true, "de": true, "del": true, "di": true, "da": true,
	"la": true, "le": true, "der": true, "den": true, "ter": true, "bin": true,
	"al": true, "st": true,
}

// Capitalised tokens that are never a person here. Combined with
// def14a_directors' headingWords, which already covers board/committee/company/
// governance/compensation/audit and friends.
var indepStopWords = map[string]bool{
	"the": true, "our": true, "we": true, "us": true, "a": true, "an": true,
	"new": true, "york": true, "exchange": true, "act": true, "sec": true,
	"nasdaq": true, "nyse": true, "american": true, "market": true, "llc": true,
	"inc": true, "corp": true, "corporation": true, "code": true, "internal": true,
	"revenue": true, "securities": true, "standards": true, "guidelines": true,
	"independence": true, "independent": true, "listing": true, "rule": true,
	"rules": true, "section": true, "sections": true, "item": true,
	"regulation": true, "delaware": true, "sarbanes": true, "oxley": true,
	"exchanges": true, "act.": true, "global": true, "select": true,
	"stock": true, "members": true, "member": true, "nominees": true,
	"chairman": true, "chairwoman": true, "chair": true, "each": true,
	"all": true, "other": true, "than": true, "following": true, "current": true,
	"non": true, "employee": true, "management": true, "whom": true, "who": true,
	"is": true, "are": true, "and": true, "no": true, "none": true,
	"guideline": true, "principles": true, "charter": true, "charters": true,
	"annual": true, "meeting": true, "proxy": true, "statement": true,
	"however": true, "based": true, "under": true, "in": true, "as": true,
	"his": true, "her": true, "their": true,
}

type nameItem struct {
	name  string
	title bool // arrived with a Mr./Mses./Dr. prefix
}

// splitTokens pads punctuation so commas, parens and colons are separate
// tokens, which is what makes the run boundaries decidable.
func splitTokens(s string) []string {
	r := strings.NewReplacer(
		",", " , ", "(", " ( ", ")", " ) ", ":", " : ", ";", " ; ",
		"—", " ) ", "–", " ) ")
	return strings.Fields(r.Replace(s))
}

func isInitial(t string) bool {
	return len(t) == 2 && t[1] == '.' && t[0] >= 'A' && t[0] <= 'Z'
}

func capWord(t string) bool {
	c := strings.Trim(t, ".'\"")
	if len(c) < 2 {
		return false
	}
	if c[0] < 'A' || c[0] > 'Z' {
		return false
	}
	for _, ch := range c[1:] {
		if !((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '\'' || ch == '-') {
			return false
		}
	}
	return true
}

func isStop(w string) bool {
	w = strings.ToLower(strings.Trim(w, ".,'\""))
	return indepStopWords[w] || headingWords[w]
}

// allStop reports whether every token of an item is furniture.
func allStop(name string) bool {
	for _, t := range strings.Fields(name) {
		if !isStop(t) {
			return false
		}
	}
	return true
}

// nameRuns returns every maximal comma/and-joined run of name items in s.
func nameRuns(s string) [][]nameItem {
	toks := splitTokens(s)
	var runs [][]nameItem
	var cur []nameItem
	var item []string
	var itemTitle bool

	flushItem := func() {
		if len(item) == 0 {
			return
		}
		n := strings.Join(item, " ")
		if !allStop(n) {
			cur = append(cur, nameItem{name: n, title: itemTitle})
		}
		item = nil
		itemTitle = false
	}
	flushRun := func() {
		flushItem()
		if len(cur) > 0 {
			runs = append(runs, cur)
		}
		cur = nil
	}

	for i := 0; i < len(toks); i++ {
		t := toks[i]
		lt := strings.ToLower(strings.Trim(t, ".,"))

		switch {
		case t == "(" || t == ")" || t == ":" || t == ";":
			flushRun()
		case t == ",":
			// Separator between items; a following suffix reattaches.
			if i+1 < len(toks) && nameSuffixes[strings.ToLower(strings.Trim(toks[i+1], ".,"))] &&
				len(item) > 0 {
				continue
			}
			flushItem()
		case lt == "and" || t == "&":
			flushItem()
		case nameTitles[lt] && strings.HasSuffix(t, "."):
			if len(item) > 0 {
				flushItem()
			}
			itemTitle = true
		case lt == "the" && i+1 < len(toks) &&
			nameTitles[strings.ToLower(strings.Trim(toks[i+1], ".,"))]:
			// "the Hon. Sen. Wampler"
			continue
		case nameSuffixes[lt] && len(item) > 0:
			item = append(item, strings.Trim(t, ",."))
		case isInitial(t) || capWord(t):
			if len(item) >= 5 {
				flushItem()
			}
			item = append(item, strings.Trim(t, ",\"'"))
		case nameParticles[lt] && len(item) > 0 && i+1 < len(toks) && capWord(toks[i+1]):
			item = append(item, t)
		default:
			flushRun()
		}
	}
	flushRun()
	return runs
}

// runStartsAt requires the run to begin where the cue ended, not somewhere
// downstream. Without it a colon or an "except" hands the extractor whatever
// capitalised text happens to appear later in a 4,000-character sentence.
func runStartsAt(tail string, run []nameItem) bool {
	if len(run) == 0 {
		return false
	}
	head := run[0].name
	i := strings.Index(tail, head)
	// Allow a leading title ("Mr. ", "the Hon. Sen. ") and nothing else.
	return i >= 0 && i <= 24
}

func longestRun(s string) []nameItem {
	var best []nameItem
	for _, r := range nameRuns(s) {
		if len(r) > len(best) {
			best = r
		}
	}
	return best
}

func firstRun(s string) []nameItem {
	for _, r := range nameRuns(s) {
		if len(r) > 0 {
			return r
		}
	}
	return nil
}

func runNames(run []nameItem) []string {
	out := make([]string, 0, len(run))
	for _, it := range run {
		out = append(out, it.name)
	}
	return out
}

// nameStyle: "full" when most items carry >=2 tokens, else "single".
func nameStyle(run []nameItem) string {
	if len(run) == 0 {
		return "none"
	}
	multi := 0
	for _, it := range run {
		if len(strings.Fields(it.name)) >= 2 {
			multi++
		}
	}
	switch {
	case multi == len(run):
		return "full"
	case multi == 0:
		return "single"
	default:
		return "mixed"
	}
}

// ---------------------------------------------------------------------------
// Sentence handling
// ---------------------------------------------------------------------------

var sentAbbrev = map[string]bool{
	"mr": true, "mrs": true, "ms": true, "dr": true, "prof": true, "messrs": true,
	"mses": true, "mmes": true, "hon": true, "sen": true, "gen": true, "jr": true,
	"sr": true, "st": true, "inc": true, "corp": true, "co": true, "ltd": true,
	"llc": true, "llp": true, "no": true, "vs": true, "etc": true, "u.s": true,
	"e.g": true, "i.e": true, "amb": true, "col": true, "gov": true, "adm": true,
}

// splitSentences cuts on ". " but not after an abbreviation, an initial, or a
// roman numeral — "Mr. D. Harding Stowe, III. The Board..." must yield one
// sentence containing the whole name list.
func splitSentences(s string) []string {
	var out []string
	start := 0
	for i := 0; i+1 < len(s); i++ {
		if s[i] != '.' || s[i+1] != ' ' {
			continue
		}
		j := i - 1
		for j >= start && s[j] != ' ' {
			j--
		}
		prev := strings.ToLower(strings.Trim(s[j+1:i], ".,()"))
		if sentAbbrev[prev] || len(prev) <= 1 || nameSuffixes[prev] {
			continue
		}
		out = append(out, strings.TrimSpace(s[start:i+1]))
		start = i + 2
	}
	if start < len(s) {
		out = append(out, strings.TrimSpace(s[start:]))
	}
	return out
}

type detResult struct {
	form   string // named | except_named | all_nonemployee | count_only | none
	names  []string
	style  string
	nIndep int
	nBoard int
	text   string
}

// classifySentence decides which determination form, if any, a sentence states.
func classifySentence(sent string) detResult {
	r := detResult{form: "none"}
	if !reIndepWord.MatchString(sent) || !reAboutDirectors.MatchString(sent) {
		return r
	}
	hasDet := reDetVerb.MatchString(sent)
	hasAre := reAreCue.MatchString(sent)
	if !hasDet && !hasAre {
		return r
	}
	if reCommitteeScope.MatchString(sent) || reNegDet.MatchString(sent) {
		return r
	}
	if !rePredIndep.MatchString(sent) {
		return r
	}
	// At least one independence mention must be about a person's status, not
	// about an auditor, an appraisal firm, or "independent judgment".
	if len(reIndepWord.FindAllString(sent, -1)) <= len(reIndepOther.FindAllString(sent, -1)) {
		return r
	}
	if reAuditorIndep.MatchString(sent) && !regexp.MustCompile(`(?i)independent\s+director|director[^.]{0,30}\bis\b[^.]{0,20}independent`).MatchString(sent) {
		return r
	}

	// 1. NAMED, colon form: "...are independent: A, B and C". The roster must
	//    begin AT the colon; a colon 300 characters later introducing something
	//    else would otherwise donate whatever capitalised text follows it.
	if loc := reCueColon.FindStringIndex(sent); loc != nil {
		tail := strings.TrimSpace(sent[loc[1]:])
		if run := firstRun(tail); len(run) >= 1 && runStartsAt(tail, run) {
			return detResult{form: "named", names: runNames(run), style: nameStyle(run),
				nIndep: len(run), text: sent}
		}
	}

	// 2. NAMED, parenthetical roster: "each non-management director (A, B, ...)".
	for _, m := range regexp.MustCompile(`\(([^)]{15,900})\)`).FindAllStringSubmatch(sent, -1) {
		if run := longestRun(m[1]); len(run) >= 3 && nameStyle(run) != "none" {
			return detResult{form: "named", names: runNames(run), style: nameStyle(run),
				nIndep: len(run), text: sent}
		}
	}

	// 3. EXCEPT form. Checked BEFORE the bare "each of"/"determined that" name
	//    cue: "all Board members, other than Mr. Cook, are independent" would
	//    otherwise be read as a one-director independent board.
	if loc := reCueExcept.FindStringIndex(sent); loc != nil {
		tail := strings.TrimSpace(sent[loc[1]:])
		if run := firstRun(tail); len(run) >= 1 && runStartsAt(tail, run) {
			return detResult{form: "except_named", names: runNames(run),
				style: nameStyle(run), text: sent}
		}
	}

	// 4. NAMED, "each of <NAMES>" / "determined that <NAMES>".
	//
	//    TWO NAMES MINIMUM. A single-item run after "determined that" is almost
	//    never a roster — it is the subject of some other clause ("determined
	//    that Meta's professional engagement of WilmerHale does not interfere").
	for _, cue := range []*regexp.Regexp{reCueEachOf, reCueDetThat} {
		for _, loc := range cue.FindAllStringIndex(sent, -1) {
			rest := strings.TrimSpace(sent[loc[1]:])
			run := firstRun(rest)
			if len(run) < 2 || !runStartsAt(rest, run) {
				continue
			}
			return detResult{form: "named", names: runNames(run), style: nameStyle(run),
				nIndep: len(run), text: sent}
		}
	}

	// 5. Categorical: "all non-employee directors are independent" — no names.
	if reCueAllNonEm.MatchString(sent) || reCueNonEmAlt.MatchString(sent) {
		return detResult{form: "all_nonemployee", style: "none", text: sent}
	}

	// 6. Count only.
	if m := reCountB.FindStringSubmatch(sent); m != nil {
		if b, i := toNum(m[1]), toNum(m[2]); b > 0 && i > 0 {
			return detResult{form: "count_only", style: "none", nIndep: i, nBoard: b, text: sent}
		}
	}
	if m := reCountA.FindStringSubmatch(sent); m != nil {
		if i, b := toNum(m[1]), toNum(m[2]); i > 0 && b > 0 && i <= b && b <= 30 {
			return detResult{form: "count_only", style: "none", nIndep: i, nBoard: b, text: sent}
		}
	}
	return r
}

var formRank = map[string]int{
	"named": 0, "except_named": 1, "all_nonemployee": 2, "count_only": 3, "none": 4,
}

// extractIndependence returns 11 pipe-separated fields:
//
//	det_form|name_style|indep_names|n_indep|n_board|exchange|rule_cited|
//	catstd_loc|considered|considered_names|match_text
//
// ONE normalisation, eleven correlated outputs — eleven Custom fields would
// re-normalise a 1 MB buffer eleven times. build_panel.py splits on the first
// ten pipes; every text component is pipe-sanitised.
func extractIndependence(buf []byte) string {
	text := indepNormalize(buf)
	sents := splitSentences(text)

	// ONE sentence wins; the roster is NOT unioned across sentences. Union was
	// tried and it is wrong: a proxy states the independent roster once and then
	// says several adjacent things that also parse as name lists (the negative
	// determination, the committee restatement, a page header caught in the same
	// pseudo-sentence). Union added "John P. D. Cato" — the CEO the same proxy
	// declares NOT independent — to Cato Corp's independent set.
	best := detResult{form: "none"}
	for _, s := range sents {
		if len(s) > 4000 {
			s = s[:4000]
		}
		r := classifySentence(s)
		if r.form == "none" {
			continue
		}
		if formRank[r.form] < formRank[best.form] ||
			(r.form == best.form && len(r.names) > len(best.names)) {
			best = r
		}
	}
	best.names = cleanNames(best.names)
	if best.form == "named" {
		best.nIndep = len(best.names)
	}

	// Exchange and rule citation are scoped to a window around the determination
	// before falling back to the document. Document-wide presence gives "both"
	// for any NYSE filer whose audit-committee section happens to mention
	// Nasdaq, which is a listing-venue error, not a citation.
	scope := determinationWindow(text, best.text)
	exch := whichExchange(scope)
	if exch == "unknown" || exch == "both" {
		if d := whichExchangeByCount(text); d != "unknown" {
			exch = d
		}
	}
	rule := whichRule(scope)
	if rule == "" {
		rule = whichRule(text)
	}

	// Stated counts, so the independent SHARE has a denominator from the filing.
	if m := reBoardRatio.FindStringSubmatch(text); m != nil {
		if i, b := toNum(m[1]), toNum(m[2]); i > 0 && b > 0 && i <= b && b <= 30 {
			if best.nIndep == 0 {
				best.nIndep = i
			}
			if best.nBoard == 0 {
				best.nBoard = b
			}
		}
	}
	if best.nBoard == 0 {
		if m := reBoardSize.FindStringSubmatch(text); m != nil {
			if b := toNum(m[1]); b >= 3 && b <= 30 {
				best.nBoard = b
			}
		}
	}

	catstd := catStdLocation(text, best.text)

	// Money field: relationships considered and nonetheless deemed immaterial.
	// SCOPED TO THE DETERMINATION NEIGHBOURHOOD. Document-wide, the cue fires on
	// any "in making this determination, the Board considered ..." — Apple's
	// 2026 proxy uses that exact phrase about waiving its age-75 retirement
	// guideline for Levinson and Sugar, which is not an independence
	// determination and produced two false "yes_named" directors.
	considered, consNames := consideredEvidence(splitSentences(consideredWindow(text, best.text)))

	return indepOut(best.form, best.style, strings.Join(best.names, ";"),
		best.nIndep, best.nBoard, exch, rule, catstd, considered,
		strings.Join(consNames, ";"), best.text)
}

// cleanNames strips the artefacts the HTML-to-text converter leaves behind —
// trailing sentence periods and the apostrophe-less possessive ("Metas",
// "Companys") that the converter creates by deleting the apostrophe — and
// deduplicates.
// dropOrgs removes entity names that the person-run scanner cannot distinguish
// from a surname list: audit firms ("Forvis Mazars LLP"), section headings
// ("Related Party Transactions Policy") and statutes.
func dropOrgs(in []string) []string {
	orgTok := map[string]bool{"llp": true, "llc": true, "inc": true, "corp": true,
		"corporation": true, "ltd": true, "plc": true, "pc": true, "pllc": true,
		"lp": true, "l.p": true, "association": true, "foundation": true,
		"university": true, "bank": true, "group": true, "partners": true,
		"holdings": true, "capital": true, "trust": true, "fund": true}
	out := in[:0:0]
	for _, n := range in {
		toks := strings.Fields(n)
		bad := false
		for _, t := range toks {
			lt := strings.ToLower(strings.Trim(t, ".,"))
			if orgTok[lt] {
				bad = true
			}
			// A multi-token item containing section-heading furniture is a
			// heading, not a person.
			if len(toks) >= 2 && isStop(t) {
				bad = true
			}
		}
		if !bad {
			out = append(out, n)
		}
	}
	return out
}

func cleanNames(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, n := range in {
		n = strings.TrimRight(n, ".,;: ")
		n = strings.TrimSuffix(n, "'s")
		// The converter deletes apostrophes, so "Mitarotondas" and
		// "Mitarotonda" are the same director in the same sentence.
		if strings.HasSuffix(n, "s") && seen[strings.TrimSuffix(n, "s")] {
			continue
		}
		if n == "" || seen[n] {
			continue
		}
		if seen[n+"s"] {
			continue
		}
		seen[n] = true
		out = append(out, n)
	}
	return out
}

// determinationWindow returns +-4000 characters around the winning sentence,
// or the whole document when no determination was found.
func determinationWindow(text, sent string) string {
	if sent == "" {
		return text
	}
	i := strings.Index(text, sent)
	if i < 0 {
		return sent
	}
	lo, hi := i-4000, i+len(sent)+4000
	if lo < 0 {
		lo = 0
	}
	if hi > len(text) {
		hi = len(text)
	}
	return text[lo:hi]
}

// consideredWindow is +-8,000 characters around the determination sentence.
func consideredWindow(text, sent string) string {
	if sent == "" {
		return text
	}
	i := strings.Index(text, sent)
	if i < 0 {
		return text
	}
	lo, hi := i-8000, i+len(sent)+8000
	if lo < 0 {
		lo = 0
	}
	if hi > len(text) {
		hi = len(text)
	}
	return text[lo:hi]
}

func whichRule(s string) string {
	switch {
	case reNyseRule.MatchString(s) && reNasdaqRule.MatchString(s):
		return "both"
	case reNyseRule.MatchString(s):
		return "303A"
	case reNasdaqRule.MatchString(s):
		return "5605"
	}
	return ""
}

// whichExchangeByCount breaks a both/unknown tie on mention counts. A Nasdaq
// filer says "Nasdaq" dozens of times and "NYSE" once, in a peer table.
func whichExchangeByCount(s string) string {
	if len(reNyseAmer.FindAllString(s, -1)) >= 2 {
		return "nyse_american"
	}
	n := len(reNyse.FindAllString(s, -1))
	q := len(reNasdaq.FindAllString(s, -1))
	switch {
	case n >= 3*maxInt(q, 1) && n >= 3:
		return "nyse"
	case q >= 3*maxInt(n, 1) && q >= 3:
		return "nasdaq"
	}
	return "unknown"
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func whichExchange(s string) string {
	amer := reNyseAmer.MatchString(s)
	nyse := reNyse.MatchString(s)
	nas := reNasdaq.MatchString(s)
	switch {
	case amer:
		return "nyse_american"
	case nyse && nas:
		return "both"
	case nyse:
		return "nyse"
	case nas:
		return "nasdaq"
	}
	return "unknown"
}

// catStdLocation answers field 3 of the brief: are the categorical standards in
// the proxy, in an appendix, or only incorporated by reference to a website?
// Precedence is by evidentiary strength — text actually reproduced beats a
// pointer to text that is not in the filing.
func catStdLocation(text, detText string) string {
	// Bright-line criteria REPRODUCED in the filing settle it on their own. They
	// are the thing DGCL 144(d)(2) points at, and a filing can reproduce them
	// without ever using the phrase "categorical standards" (Acme United, Ford).
	// Scoped to the determination neighbourhood: equity-plan and bylaw exhibits
	// elsewhere in the same .txt carry "no director shall ..." constructions
	// that have nothing to do with independence.
	// ONE reproduced criterion is enough. Cato Corp and Eastern Co state exactly
	// one ("a director will not be deemed independent if:", followed by a
	// bulleted list the converter flattens into the same run), and requiring two
	// scored both as pointer-only when the standard is in fact in the filing.
	if len(reBrightLine.FindAllString(catStdWindow(text, detText), -1)) >= 1 {
		return "proxy"
	}
	locs := reCatStd.FindAllStringIndex(catStdWindow(text, detText), -1)
	text = catStdWindow(text, detText)
	if len(locs) == 0 {
		if reBrightLine.MatchString(text) {
			return "mention_only"
		}
		return "none"
	}
	best := "mention_only"
	rank := map[string]int{"proxy": 0, "appendix": 1, "website": 2, "mention_only": 3, "none": 4}
	for _, loc := range locs {
		near := text[loc[0]:min(loc[1]+400, len(text))]
		var got string
		switch {
		case reInAppx.MatchString(near):
			got = "appendix"
		case reOnWeb.MatchString(near):
			got = "website"
		default:
			continue
		}
		if rank[got] < rank[best] {
			best = got
		}
	}
	return best
}

// catStdWindow is +-12,000 characters around the determination — wide enough
// for a reproduced bright-line list, narrow enough to exclude the exhibits.
func catStdWindow(text, sent string) string {
	if sent == "" {
		return text
	}
	i := strings.Index(text, sent)
	if i < 0 {
		return text
	}
	lo, hi := i-12000, i+len(sent)+12000
	if lo < 0 {
		lo = 0
	}
	if hi > len(text) {
		hi = len(text)
	}
	return text[lo:hi]
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// consideredEvidence returns the immateriality flag and any directors tied to a
// specific considered relationship.
//
//	yes_named  a sentence names directors AND deems the relationship immaterial
//	yes        the board says it considered relationships, no director named
//	none_found the board affirmatively says it found none
//	no         no such language
func consideredEvidence(sents []string) (string, []string) {
	flag := "no"
	var names []string
	seenName := map[string]bool{}

	// The LONGEST run in a considered-relationship sentence is usually the
	// counterparty ("Eastern and Barington Capital Group"), not the director.
	// Score every run and keep the longest that passes the person test.
	titledRun := func(s string) []string {
		var best []nameItem
		for _, run := range nameRuns(s) {
			titled := 0
			for _, it := range run {
				if it.title {
					titled++
				}
			}
			if titled == 0 && nameStyle(run) != "full" {
				continue
			}
			if titled > 0 || len(run) > len(best) {
				if len(run) > len(best) || titled > 0 && len(best) == 0 {
					best = run
				}
			}
		}
		return cleanNames(dropOrgs(runNames(best)))
	}

	for i, s := range sents {
		if reNoneFound.MatchString(s) && reIndepWord.MatchString(s) {
			if flag == "no" {
				flag = "none_found"
			}
			continue
		}
		if !reConsidered.MatchString(s) && !reImmaterial.MatchString(s) {
			continue
		}
		if !reIndepWord.MatchString(s) && !reAboutDirectors.MatchString(s) {
			continue
		}
		if flag == "no" || flag == "none_found" {
			flag = "yes"
		}
		// SAME SENTENCE ONLY. A three-sentence lookahead was measured on the
		// fixture set: it lifts yes_named from 6/31 to 29/31 and is wrong on
		// most of the lift — it collects the audit firm ("Forvis Mazars LLP"),
		// section headings ("Retirement Age", "Director Tenure") and statute
		// names ("Sarbanes-Oxley Act"). Ford and Gray Media genuinely put the
		// director names one sentence after the "the Board considered ..." cue
		// and are therefore scored "yes" rather than "yes_named"; that is a
		// recall loss taken deliberately to keep the field's precision.
		lookahead := 0
		for j := i; j < len(sents) && j <= i+lookahead; j++ {
			got := titledRun(sents[j])
			if len(got) == 0 {
				continue
			}
			for _, n := range got {
				if len(names) < 25 && !seenName[n] {
					seenName[n] = true
					names = append(names, n)
				}
			}
			flag = "yes_named"
		}
	}
	return flag, names
}

func indepOut(form, style, names string, nIndep, nBoard int,
	exch, rule, catstd, considered, consNames, matchText string) string {
	san := strings.NewReplacer("|", "/", "\t", " ", "\r", " ", "\n", " ")
	if len(matchText) > 500 {
		matchText = matchText[:500]
	}
	return fmt.Sprintf("%s|%s|%s|%d|%d|%s|%s|%s|%s|%s|%s",
		form, style, san.Replace(names), nIndep, nBoard, exch, rule, catstd,
		considered, san.Replace(consNames), san.Replace(matchText))
}
