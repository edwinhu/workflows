package main

import (
	"regexp"
	"strings"
)

// A management ownership table names the holder and then says who he is, in the
// SAME cell: "E. Anthony Woods, Chairman of the Board", "Jim Albaugh Director",
// "Michael J. Berendt, Ph.D", "Brenda C. Barnes1 Director". The title, the
// degree and the footnote marker are not part of the holder's name, and every
// downstream consumer keys on the name.
//
// cleanHolderName removes exactly four decorations and nothing else:
//
//	a trailing parenthetical    "(also a director)", "(Ret.)"
//	a trailing role clause      "Chairman of the Board and Chief Executive Officer"
//	a trailing degree           "Ph.D", "M.D.", "J.D."
//	a leading honorific         "Dr.", "General", "Senator"
//	a glued footnote marker     "Barnes1", "Forman4,5"
//
// It never runs on a group row: "All directors and executive officers as a
// group (18 persons)" is a collective label whose every word is a title word
// and whose parenthetical carries the person count.

var (
	// A word inside a trailing role clause. Corporate-form words (Inc, Company,
	// Management, Capital) are deliberately ABSENT: an institutional holder's
	// name is built from them and must survive untouched.
	titleClauseWord = wordSet(`director directors chairman chairwoman chairperson chair chairmen
		president officer officers ceo cfo coo cto cio evp svp vp chief
		vice executive executives senior lead leading independent principal
		nominee nominees former retired emeritus emerita interim acting
		trustee trustees secretary treasurer controller counsel general
		managing manager founder cofounder partner head group co
		operating financial accounting operations administrative technology
		information legal medical scientific commercial marketing strategy
		corporate affairs business development board boards the of and
		also a an our its named current presiding deputy assistant
		publisher editor counselor advisor`)
	// A trailing clause is a role only when it contains one of these. "of the
	// board" alone is a wrapped name fragment, not a title.
	titleClauseHead = wordSet(`director directors chairman chairwoman chairperson chair chairmen
		president officer officers ceo cfo coo cto cio evp svp
		trustee trustees secretary treasurer controller counsel nominee
		nominees emeritus founder cofounder partner publisher editor`)
	// A professional degree or licence written after the name. The scorer's own
	// suffix list already drops these when they arrive as ONE token; "Ph.D"
	// arrives as two, and the second is the surname position.
	degreeWord = wordSet(`phd md jd mba mph dba edd dds dvm rn cpa esq ms ma
		dsc scd pe cfa lld llm dphil psyd pharmd msc bs ba ab`)
	// A rank or courtesy title written before the name, which otherwise takes
	// the first-initial position.
	honorificWord = wordSet(`dr mr mrs ms miss prof professor rev hon sen senator
		rep gov governor amb ambassador gen general adm admiral
		col colonel capt captain lt maj major sgt sir honorable`)

	reNameWord  = regexp.MustCompile(`[A-Za-z0-9'&.]+`)
	reNameParen = regexp.MustCompile(`\s*\([^()]*\)`)
	// A footnote marker glued to the end of a name word: "Barnes1", "Forman4,5".
	// Anchored on a letter so a share count or a year is never touched.
	reNameFootnote = regexp.MustCompile(`([A-Za-z])\d+((?:\s*,\s*\d+)*)\b`)

	nameTrimCut = " ,-;:*–—"
)

func wordSet(s string) map[string]bool {
	m := map[string]bool{}
	for _, w := range strings.Fields(s) {
		m[strings.ToUpper(w)] = true
	}
	return m
}

// nameWord is one word of a name cell with its folded form and its byte span.
type nameWord struct {
	fold       string
	start, end int
}

func nameWords(s string) []nameWord {
	locs := reNameWord.FindAllStringIndex(s, -1)
	out := make([]nameWord, 0, len(locs))
	for _, lo := range locs {
		fold := strings.Map(func(r rune) rune {
			switch {
			case r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
				return r
			case r >= 'a' && r <= 'z':
				return r - 32
			}
			return -1
		}, s[lo[0]:lo[1]])
		if fold == "" {
			continue
		}
		out = append(out, nameWord{fold: fold, start: lo[0], end: lo[1]})
	}
	return out
}

// cleanHolderName strips the decorations above from a non-group holder name.
func cleanHolderName(s string) string {
	s = reNameFootnote.ReplaceAllString(s, "$1")
	s = strings.TrimSpace(reNameParen.ReplaceAllString(s, ""))
	s = stripTrailingTitle(s)
	s = stripTrailingDegree(s)
	s = stripLeadingHonorific(s)
	return strings.Trim(s, nameTrimCut+" ")
}

// stripTrailingTitle removes the longest suffix of title-clause words, provided
// it names a role and at least two name words remain in front of it.
func stripTrailingTitle(s string) string {
	w := nameWords(s)
	if len(w) < 3 {
		return s
	}
	i := len(w)
	for i > 0 && titleClauseWord[w[i-1].fold] {
		i--
	}
	if i == len(w) || i < 2 {
		return s
	}
	head := false
	for _, x := range w[i:] {
		if titleClauseHead[x.fold] {
			head = true
			break
		}
	}
	if !head {
		return s
	}
	return strings.TrimRight(s[:w[i-1].end], nameTrimCut+" ")
}

func stripTrailingDegree(s string) string {
	for {
		w := nameWords(s)
		if len(w) < 3 || !degreeWord[w[len(w)-1].fold] {
			return s
		}
		s = strings.TrimRight(s[:w[len(w)-1].start], nameTrimCut+" ")
	}
}

func stripLeadingHonorific(s string) string {
	for {
		w := nameWords(s)
		if len(w) < 2 || !honorificWord[w[0].fold] {
			return s
		}
		// A rank before a corporate name is part of that name, not a person's title.
		switch w[len(w)-1].fold {
		case "COMPANY", "CO", "CORP", "CORPORATION", "INC", "INCORPORATED", "LLC", "LLP", "LP", "LTD", "LIMITED", "PLC":
			return s
		}
		s = strings.TrimLeft(s[w[0].end:], " .,")
	}
}
