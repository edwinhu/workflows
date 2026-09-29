package main

import (
	"regexp"
	"strings"
)

// Extraction of the primary proxy document out of a raw EDGAR file, and the
// HTML-vs-ASCII decision. A pre-2001 DEF 14A arrives as one SGML dissemination
// file whose <TEXT> body is plain ASCII with <TABLE>/<S>/<C> column markers and
// no <TR>; a modern one is a standalone HTML document.

var (
	reDocOpen   = regexp.MustCompile(`(?i)<DOCUMENT>`)
	reDocClose  = regexp.MustCompile(`(?i)</DOCUMENT>`)
	reTextOpen  = regexp.MustCompile(`(?i)<TEXT>`)
	reTextClose = regexp.MustCompile(`(?i)</TEXT>`)
	reType      = regexp.MustCompile(`(?i)<TYPE>([^\n<]*)`)
	reHasTR     = regexp.MustCompile(`(?i)<tr[\s>]`)
	reHasTag    = regexp.MustCompile(`(?i)<(html|body|div|p|font|table)[\s>]`)
	reSeriesTag = regexp.MustCompile(`(?i)<SERIES-NAME>([^\n<]*)`)
	reNotAlnum  = regexp.MustCompile(`[^a-z0-9]+`)
	// A registered / trademark mark inside a fund name: "Vanguard(R) 500 Index
	// Fund". Folding it to a bare "r" token would stop the name matching the
	// <SERIES-NAME> entry that declares it.
	reTradeMark = regexp.MustCompile(`(?i)\((?:r|tm|sm|c)\)|[®™©]`)
)

// SeriesNames returns the distinct fund / series names the filing's SGML header
// declares, in document order. A registered investment company files one proxy
// covering many series and tags each of them here; an operating company
// declares none. It is the only place a fund-family proxy states, in structured
// form, which funds its repeated per-fund ownership tables belong to.
func SeriesNames(raw string) []string {
	end := len(raw)
	if i := reDocOpen.FindStringIndex(raw); i != nil {
		end = i[0]
	}
	seen := map[string]bool{}
	var out []string
	for _, m := range reSeriesTag.FindAllStringSubmatch(raw[:end], -1) {
		n := strings.TrimSpace(m[1])
		if len(n) < 6 {
			continue
		}
		k := NormLabel(n)
		if k == "" || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, n)
	}
	return out
}

// NormLabel folds a label to the form the series matcher compares on.
func NormLabel(s string) string {
	s = reTradeMark.ReplaceAllString(s, " ")
	return strings.TrimSpace(reNotAlnum.ReplaceAllString(strings.ToLower(s), " "))
}

// SeriesSet folds declared series names into the matcher's lookup: NormLabel ->
// the name as written. Returns nil unless at least two are declared, since one
// series disambiguates nothing.
func SeriesSet(series []string) map[string]string {
	if len(series) < 2 {
		return nil
	}
	m := make(map[string]string, len(series))
	for _, s := range series {
		m[NormLabel(s)] = strings.Join(strings.Fields(s), " ")
	}
	return m
}

// MatchSeries reports which declared fund / series name a line or cell states,
// allowing the short trailing parenthetical a proxy adds for the reader
// ("Vanguard(R) 500 Index Fund (1976)"). "" when it names none.
func MatchSeries(set map[string]string, cell string) string {
	if set == nil {
		return ""
	}
	n := NormLabel(cell)
	if len(n) < 6 {
		return ""
	}
	if v := set[n]; v != "" {
		return v
	}
	f := strings.Fields(n)
	for drop := 1; drop <= 2 && drop < len(f); drop++ {
		if v := set[strings.Join(f[:len(f)-drop], " ")]; v != "" {
			return v
		}
	}
	return ""
}

type span struct{ lo, hi int }

// spans replicates the pairing of a lazy <X>(.*?)</X>: each opener takes the
// first closer after it, and scanning resumes past that closer.
func spans(open, close *regexp.Regexp, s string, from, to int) []span {
	var out []span
	pos := from
	for pos < to {
		mo := open.FindStringIndex(s[pos:to])
		if mo == nil {
			return out
		}
		obeg, oend := pos+mo[0], pos+mo[1]
		_ = obeg
		mc := close.FindStringIndex(s[oend:to])
		if mc == nil {
			return out
		}
		out = append(out, span{oend, oend + mc[0]})
		pos = oend + mc[1]
	}
	return out
}

var proxyTypes = map[string]bool{"DEF14A": true, "DEFA14A": true, "PRE14A": true, "DEFR14A": true}

// PrimaryDocument returns the body of the first proxy document in a raw EDGAR
// file. A standalone document (no <DOCUMENT> wrapper) is returned unchanged.
func PrimaryDocument(raw string) string {
	docs := spans(reDocOpen, reDocClose, raw, 0, len(raw))
	if len(docs) == 0 {
		return raw
	}
	for _, d := range docs {
		tm := reType.FindStringSubmatch(raw[d.lo:d.hi])
		if tm == nil {
			continue
		}
		t := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(tm[1]), " ", ""))
		if !proxyTypes[t] {
			continue
		}
		if ts := spans(reTextOpen, reTextClose, raw, d.lo, d.hi); len(ts) > 0 {
			return raw[ts[0].lo:ts[0].hi]
		}
		return raw[d.lo:d.hi]
	}
	if ts := spans(reTextOpen, reTextClose, raw, docs[0].lo, docs[0].hi); len(ts) > 0 {
		return raw[ts[0].lo:ts[0].hi]
	}
	return raw[docs[0].lo:docs[0].hi]
}

// IsHTML reports whether the body should go through the DOM parser. An ASCII
// proxy can carry <TABLE> and <PAGE> markers without a single <TR>, which is
// exactly the shape the DOM parser turns into one giant cell.
func IsHTML(body string) bool {
	head := body
	if len(head) > 400000 {
		head = head[:400000]
	}
	return reHasTR.MatchString(head) || (reHasTag.MatchString(head) && strings.Count(head, "<") > 200 && !looksASCII(head))
}

func looksASCII(head string) bool {
	// An ASCII proxy has many hard line breaks relative to its tag count.
	nl := strings.Count(head, "\n")
	tags := strings.Count(head, "<")
	return nl > 200 && nl > tags
}
