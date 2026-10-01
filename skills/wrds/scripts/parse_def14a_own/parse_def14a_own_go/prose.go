package main

import (
	"regexp"
	"strconv"
	"strings"
)

// A LAST-RESORT READER FOR OWNERSHIP DISCLOSED AS PROSE, NOT AS A TABLE.
//
// A fund proxy frequently has no 5% table at all: the record holders are stated
// one sentence each, under a bare fund-name line —
//
//	American Express Trust Company, as Trustee for The American Express
//	Retirement Plan, 991 ACP Financial Center, Minneapolis, Minnesota 55747,
//	which owned 25,610.010 shares of the Fund (representing approximately 10.6%
//	of the Fund's then outstanding shares).
//
// and an operating company sometimes states only the group total that way
// ("all directors and executive officers as a group owned 193,404 shares or
// 27.47%"). There is nothing for a column reader to align, so both parse to
// zero rows.
//
// This runs ONLY when the DOM and text-table paths have both emitted nothing,
// which is why it cannot re-introduce a duplicate row: every row it produces
// comes from a filing that currently produces none.

var (
	// own(ed|s) [of record] [approximately] <count> [Class X] [shares] … <pct>%
	//
	// The percent must come AFTER the count: "(50% owned) $15,923,305" — a
	// partnership's impairment schedule — is not a holding and must not match.
	reProseHolding = regexp.MustCompile(`(?i)\bown(?:ed|s|ing)\b\s+((?:of\s+record\s+)?(?:and\s+)?(?:beneficially\s+)?(?:of\s+record\s+)?)(?:approximately\s+|about\s+|in\s+the\s+aggregate\s+|(?:a|an)\s+(?:combined\s+|aggregate\s+)?(?:total|aggregate)\s+of\s+)?([0-9][0-9,]{2,}(?:\.[0-9]+)?)\s*((?:Class|Series)\s+[A-Za-z0-9]{1,3}\b\s*)?((?:shares?|units?)\b)?([^.;]{0,140}?)([0-9]{1,3}(?:\.[0-9]+)?)\s*(?:%|\bpercent\b)`)

	// A segment of the comma-separated run before the verb that can only be a
	// postal address: everything from the first one on is dropped from the name.
	reProseStateSeg = regexp.MustCompile(`(?i)^(?:Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|` +
		`Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|` +
		`Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New\s+Hampshire|` +
		`New\s+Jersey|New\s+Mexico|New\s+York|North\s+Carolina|North\s+Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|` +
		`Rhode\s+Island|South\s+Carolina|South\s+Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|` +
		`West\s+Virginia|Wisconsin|Wyoming|A[LKZR]|C[AOT]|DC|FL|GA|HI|I[ADLN]|K[SY]|M[ADENIOST]|N[CDEHJMVY]|` +
		`O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\.?\s*(?:\d{5}(?:-\d{4})?)?$`)
	reProseZipSeg  = regexp.MustCompile(`^\d{5}(-\d{4})?$`)
	reProseCitySeg = regexp.MustCompile(`^[A-Z][A-Za-z.'\-]+(?:\s+[A-Z][A-Za-z.'\-]+){0,2}$`)
	// Lead-in noise at the head of the name run, left behind by the previous
	// sentence's terminator or by a list conjunction.
	reProseNameLead = regexp.MustCompile(`(?i)^[\s;:,.)\]]*(?:and\s+|or\s+|that\s+|which\s+|who\s+|the\s+following\s+)?`)
	reProseParaSep  = regexp.MustCompile(`\n[ \t]*\n`)
	// "On February 28, 2002," / "As of the Record Date," at the head of the run.
	reProseAsOfLead = regexp.MustCompile(`(?i)^\s*(?:on|as\s+of|at|in)\s+[^,]{3,40},\s*(?:\d{4},\s*)?`)
	// A PO box written as its own comma segment: "Cede & Co., P.O. Box 20".
	reProseBoxSeg = regexp.MustCompile(`(?i)^p\.?\s*o\.?$|^post\s+office$`)
	// "the Trustees and officers of the Fund" -- a FUND's collective label. The
	// table path's collective nouns leave "trustees" out on purpose, because
	// "Trustees of the General Electric Pension Trust" is a real holder; in a
	// prose sentence whose verb is the holding itself the ambiguity is gone.
	reProseTrusteeGroup = regexp.MustCompile(`(?i)^(?:all\s+(?:of\s+)?)?(?:the\s+)?(?:current\s+)?trustees\b[^.]{0,70}?\b(?:officers|nominees|as\s+a\s+group)\b`)
	// The trailing "of the Fund" that makes every such label carry an entity
	// word and so vetoes the weak collective arms.
	reProseOfTheFund = regexp.MustCompile(`(?i)\s+of\s+(?:the\s+)?(?:fund|funds|trust|company|corporation|portfolio|registrant)s?\b.*$`)
	// The verb's own adverb, stranded on the end of the name run.
	reProseVerbTail = regexp.MustCompile(`(?i)\s+(?:beneficially|directly|indirectly|jointly|collectively|in\s+the\s+aggregate|of\s+record)$`)
)

// proseDropReasons counts, when non-nil, the matched sentences the reader threw
// away and why. Diagnostic only, set by the -debug path.
var proseDropReasons map[string]int

func proseDrop(why string) {
	if proseDropReasons != nil {
		proseDropReasons[why]++
	}
}

// ExtractProse reads holder rows out of running prose. It returns nil when the
// text carries no such sentence, which is the ordinary case.
func ExtractProse(body string, base Row) []Row {
	body = stripEntities(body)
	body = reTxtTag.ReplaceAllString(body, "")
	body = reAnyTag.ReplaceAllString(body, "")
	var out []Row
	idx := 0
	for _, para := range reProseParaSep.Split(body, -1) {
		flat := strings.Join(strings.Fields(para), " ")
		if len(flat) < 20 || len(flat) > 20000 {
			continue
		}
		prev := 0
		for _, m := range reProseHolding.FindAllStringSubmatchIndex(flat, -1) {
			g := func(k int) string {
				if m[2*k] < 0 {
					return ""
				}
				return flat[m[2*k]:m[2*k+1]]
			}
			lead, sharesTxt, class, unit, gap, pctTxt := g(1), g(2), g(3), g(4), g(5), g(6)
			before := flat[prev:m[0]]
			prev = m[1]
			// The count must be a share count: either the word is written, or
			// the sentence says "of record", which only a holding is.
			low := strings.ToLower(gap)
			if unit == "" && !strings.Contains(low, "share") && !strings.Contains(low, "unit") &&
				!strings.Contains(strings.ToLower(lead), "record") {
				proseDrop("no_share_word")
				continue
			}
			// A dollar figure between the count and the percent means the two
			// belong to different facts (a fee schedule, a carrying value).
			if strings.Contains(gap, "$") {
				proseDrop("dollar_between")
				continue
			}
			shares, err := strconv.ParseFloat(strings.ReplaceAll(sharesTxt, ",", ""), 64)
			if err != nil || shares < 100 {
				proseDrop("bad_shares")
				continue
			}
			pct, err := strconv.ParseFloat(pctTxt, 64)
			if err != nil || pct <= 0 || pct > 100 {
				proseDrop("bad_percent")
				continue
			}
			// "comprising less than 1% of the outstanding shares" states a
			// CEILING, not a holding of one percent.
			pctp, marker := &pct, "%"
			if reLessThan.MatchString(gap + pctTxt + "%") {
				pctp, marker = nil, "<1%"
			}
			name := proseHolderName(before)
			if name == "" {
				proseDrop("no_name")
				continue
			}
			r := base
			r.TableKind = "5pct_holders"
			r.TableIndex = 0
			r.RowIndex = idx
			r.HolderName = name
			r.Shares = &shares
			r.Percent = pctp
			r.PctMarker = marker
			r.Parser = "text_prose"
			if class != "" {
				r.ShareClass = strings.Join(strings.Fields(class), " ")
			}
			if grp, n := proseGroupRow(name); grp {
				r.IsGroupRow, r.GroupN, r.TableKind = true, n, "combined"
			}
			idx++
			out = append(out, r)
		}
	}
	if len(out) == 0 {
		return extractPassiveHoldings(body, base)
	}
	return out
}

var rePassiveHolding = regexp.MustCompile(`(?i)(?:^|[^0-9,$A-Za-z])([0-9][0-9,]{2,})\s+((?:[A-Za-z][A-Za-z'\-]*\s+){0,6}shares)\s+held\s+by\s+([^();$]{3,120}?)\s*\(\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*%\s+of\s+([^()$]{1,120})\)`)
var rePassiveShareBase = regexp.MustCompile(`(?i)\bshares\b.*\b(?:outstanding|entitled\s+to\s+vote)\b|\boutstanding\b.*\bshares\b`)

// Passive disclosures put the count before the holder. Require an explicit
// share-count noun and a percent of outstanding or voting-entitled shares,
// rather than a vote result or a fee. Existing active prose retains priority.
func extractPassiveHoldings(body string, base Row) []Row {
	var out []Row
	for _, para := range reProseParaSep.Split(body, -1) {
		flat := strings.Join(strings.Fields(para), " ")
		if len(flat) < 20 || len(flat) > 20000 {
			continue
		}
		for _, m := range rePassiveHolding.FindAllStringSubmatch(flat, -1) {
			if !rePassiveShareBase.MatchString(m[5]) {
				continue
			}
			shares, err := strconv.ParseFloat(strings.ReplaceAll(m[1], ",", ""), 64)
			if err != nil || shares < 100 {
				continue
			}
			pct, err := strconv.ParseFloat(m[4], 64)
			if err != nil || pct <= 0 || pct > 100 {
				continue
			}
			name := proseHolderName(m[3])
			if name == "" {
				continue
			}
			r := base
			r.TableKind, r.TableIndex, r.RowIndex = "5pct_holders", 0, len(out)
			r.HolderName, r.Shares, r.Percent = name, &shares, &pct
			r.Parser, r.PctMarker = "text_prose", "%"
			r.ShareClass = reHdrClass.FindString(m[2])
			if grp, n := proseGroupRow(name); grp {
				r.IsGroupRow, r.GroupN, r.TableKind = true, n, "combined"
			}
			out = append(out, r)
		}
	}
	return out
}

// proseHolderName reduces the run of text before the verb to the holder's name:
// it keeps the last sentence, then drops every comma-separated segment from the
// first postal one on. Extra leading tokens only ever help a name match, so the
// cut is deliberately conservative — it removes addresses and nothing else.
func proseHolderName(before string) string {
	// Keep only what follows the last clause or sentence terminator. A "." is a
	// sentence end only when the token before it is not an abbreviation: an
	// initialism ("H.E.B."), a middle initial ("William M.") and a corporate
	// form ("Inc.") all sit INSIDE the holder's name.
	if i := strings.LastIndexAny(before, ";:"); i >= 0 {
		before = before[i+1:]
	}
	for i := 0; i+1 < len(before); i++ {
		if before[i] != '.' || before[i+1] != ' ' {
			continue
		}
		head := before[:i]
		tok := head[strings.LastIndexAny(head, " \t")+1:]
		if isProseAbbrev(tok) {
			continue
		}
		if r := before[i+2]; r < 'A' || r > 'Z' {
			continue
		}
		before = before[i+2:]
		i = -1
	}
	// "On February 28, 2002, the Trustees ..." -- the sentence opens with the
	// as-of date, which is not part of anyone's name.
	before = reProseAsOfLead.ReplaceAllString(before, "")
	s := strings.TrimSpace(reProseNameLead.ReplaceAllString(before, ""))
	if s == "" {
		return ""
	}
	segs := strings.Split(s, ",")
	cut := len(segs)
	for i, seg := range segs {
		t := strings.TrimSpace(seg)
		if t == "" {
			continue
		}
		if reProseStateSeg.MatchString(t) || reProseZipSeg.MatchString(t) || reProseBoxSeg.MatchString(t) ||
			reStreetLine.MatchString(t) || reBoxLine.MatchString(t) || reNumLedLine.MatchString(t) {
			cut = i
			// A bare city immediately before a state is part of the address.
			if i > 0 && reProseCitySeg.MatchString(strings.TrimSpace(segs[i-1])) &&
				(reProseStateSeg.MatchString(t) || reProseZipSeg.MatchString(t)) {
				cut = i - 1
			}
			break
		}
	}
	if cut == 0 {
		return ""
	}
	name := strings.TrimSpace(strings.Join(segs[:cut], ","))
	// The adverb that qualifies the VERB, left on the end because the verb is
	// what the match started at: "... as a group beneficially" / "... of record".
	name = reProseVerbTail.ReplaceAllString(strings.TrimSpace(name), "")
	name = strings.Trim(name, " ,;:-")
	if len(name) > 120 {
		name = strings.TrimSpace(name[:120])
	}
	// A run that starts mid-sentence is not a name. A COLLECTIVE label is the
	// exception: "all directors and officers as a group" opens lower-case and
	// is the row the group-row gate is about.
	if len(name) < 3 {
		return ""
	}
	if g, _ := proseGroupRow(name); !g && !isProseNameStart(name) {
		return ""
	}
	return name
}

// isProseAbbrev reports whether tok, the word before a ".", is an abbreviation
// rather than the end of a sentence.
func isProseAbbrev(tok string) bool {
	tok = strings.TrimLeft(tok, "(\"'")
	if len(tok) <= 2 || strings.Contains(tok, ".") {
		return true
	}
	return proseAbbrevWords[strings.ToUpper(tok)]
}

var proseAbbrevWords = map[string]bool{
	"INC": true, "CORP": true, "CO": true, "LTD": true, "LLC": true, "LLP": true, "LP": true,
	"MR": true, "MRS": true, "MS": true, "DR": true, "JR": true, "SR": true, "ST": true,
	"NO": true, "MESSRS": true, "BROS": true, "ASSN": true, "NA": true, "PLC": true,
}

// proseGroupRow is isGroupRow plus the fund-trustee arm above.
func proseGroupRow(name string) (bool, int) {
	if g, n := isGroupRow(name); g {
		return g, n
	}
	bare := strings.TrimSpace(reProseOfTheFund.ReplaceAllString(name, ""))
	if reProseTrusteeGroup.MatchString(bare) && !reEntityWord.MatchString(bare) {
		return true, groupN(name)
	}
	return false, 0
}

func isProseNameStart(s string) bool {
	r := []rune(s)[0]
	return r >= 'A' && r <= 'Z'
}
