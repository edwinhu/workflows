package main

import (
	"regexp"
	"strconv"
	"strings"
)

// extractors_13dg — faithful Go ports of the Python blockholder parsers.
//
// These mirror mirror/src/blockholders/parser.py so that the Go scanner can
// replace the Python `extract_filing` step with ≥95% parity on both
// max_prc and item12 (including pipe-joined multi-code outputs).

// ---------------------------------------------------------------------------
// max_prc — Python _get_lines / _get_prc_strings / _get_max_prc port.
// ---------------------------------------------------------------------------

var (
	rePercentLine = regexp.MustCompile(`(?i)percent`)
	reAnyNonWS    = regexp.MustCompile(`\S`)
	rePctStrict   = regexp.MustCompile(`\d{1,4}(?:[.,]\d{0,7})?\s?%|\d{0,3}(?:\.\d{1,7})?\s?%`)
	rePctZero     = regexp.MustCompile(`-0-`)
	rePctDecimal  = regexp.MustCompile(`\d{0,3}\.\d{1,7}`)
	reZeroAliases = regexp.MustCompile(`(?i)\bnone\b|\bn/a\b|\bless\b|-0-|lessthan5%`)
	// Collapse non-newline whitespace runs to a single space, matching
	// Python's `(?<=\s)\s+` behavior (keep one WS, drop the rest). RE2
	// lacks lookbehind, so we replace runs then trim.
	reCollapseWS = regexp.MustCompile(`[^\S\n]+`)
)

func blankStrip(lines []string) []string {
	out := make([]string, 0, len(lines))
	for _, ln := range lines {
		if reAnyNonWS.MatchString(ln) {
			out = append(out, ln)
		}
	}
	return out
}

// percentWindows returns 16-line windows starting at each line containing
// "percent" (case-insensitive). Mirrors parser.py _get_lines, including the
// 3000-line cap and blank-line strip applied before windowing.
func percentWindows(body string) []string {
	lines := strings.Split(body, "\n")
	if len(lines) > 3000 {
		lines = lines[:3000]
	}
	lines = blankStrip(lines)
	var out []string
	for i, ln := range lines {
		if rePercentLine.MatchString(ln) {
			end := i + 16
			if end > len(lines) {
				end = len(lines)
			}
			out = append(out, strings.Join(lines[i:end], " \n"))
		}
	}
	return out
}

// locatePrc applies the three percent regexes in priority order. Mirrors
// R `str_extract`: returns the FIRST match only (not all matches). The R
// original is vectorized over windows; when we call locatePrc per window,
// first-match semantics are preserved.
func locatePrc(line string) string {
	lo := strings.ToLower(line)
	for _, rx := range []*regexp.Regexp{rePctStrict, rePctZero, rePctDecimal} {
		if s := rx.FindString(lo); s != "" {
			return s
		}
	}
	return ""
}

// prcStrings expands each window from 3 to 15 lines until matches are
// found, mirroring parser.py _get_prc_strings.
func prcStrings(windows []string) []string {
	if len(windows) == 0 {
		return nil
	}
	for _, end := range []int{3, 6, 9, 12, 15} {
		var collected []string
		for _, w := range windows {
			parts := strings.Split(w, "\n")
			if end < len(parts) {
				parts = parts[:end]
			}
			firstN := strings.Join(parts, " ")
			cleaned := strings.TrimSpace(reCollapseWS.ReplaceAllString(firstN, " "))
			cleaned = strings.ReplaceAll(cleaned, "240.13", "")
			cleaned = strings.ReplaceAll(cleaned, "-0-%", "0%")
			cleaned = reZeroAliases.ReplaceAllString(cleaned, "0  %")
			if s := locatePrc(cleaned); s != "" {
				collected = append(collected, s)
			}
		}
		if len(collected) > 0 {
			return collected
		}
	}
	return nil
}

// maxPrcFromStrings applies row-number corrections (rows 9 and 11) and
// returns the largest value in [0, 100], matching parser.py _get_max_prc.
func maxPrcFromStrings(prcs []string) (float64, bool) {
	var vals []float64
	for _, s := range prcs {
		t := strings.TrimSpace(strings.ReplaceAll(s, "%", ""))
		t = strings.ReplaceAll(t, ",", ".")
		v, err := strconv.ParseFloat(t, 64)
		if err != nil {
			continue
		}
		if int(v)/100 == 9 {
			v -= 900
		}
		if int(v)/100 == 11 {
			v -= 1100
		}
		if int(v)/10 == 11 {
			v -= 110
		}
		if v >= 0 && v <= 100 {
			vals = append(vals, v)
		}
	}
	if len(vals) == 0 {
		return 0, false
	}
	best := vals[0]
	for _, v := range vals[1:] {
		if v > best {
			best = v
		}
	}
	return best, true
}

// extractMaxPrc is the Custom extractor for the max_prc field. Falls back
// to the XBRL cover-page extractor for SCHEDULE 13D/G filings where the
// legacy "percent" anchor phrases don't appear.
func extractMaxPrc(buf []byte) string {
	prcs := prcStrings(percentWindows(string(buf)))
	if v, ok := maxPrcFromStrings(prcs); ok {
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return extractMaxPrcXbrl(buf)
}

// ---------------------------------------------------------------------------
// item12 — Python parse_item12 port.
// ---------------------------------------------------------------------------

// item12CodeList preserves the priority order used by parser.py _CODE_LIST.
var item12CodeList = []string{
	"bd", "bk", "ic", "iv", "ia", "ep", "hc", "sa", "cp", "co", "pn", "in", "fi", "oo",
}

// buildCodeRegexes mirrors parser.py _build_code_regexes. Each code gets an
// alternation of spelled-out phrase variants plus the literal 2-letter
// code, plus three artifact suffixes (code+"2", code+"page", "person"+code).
func buildCodeRegexes() []*regexp.Regexp {
	variants := [][]string{
		{`broker\s+dealer`, `bd`},
		{`bank`, `bk`},
		{`insurance\s+company`, `ic`},
		{`investment\s+company`, `iv`},
		{`investment\s+advisor`, `ia`},
		{`employee\s+benefit`, `ep`},
		{`holding\s+company`, `hc`},
		{`savings\s+association`, `sa`},
		{`church\s+plan`, `cp`},
		{`corporation`, `co\s`, `c0`},
		{`partnership`, `pn`},
		{`individual`, `in`},
		{`non-U\.S\.\s+institution`, `fi`},
		{`other`, `oo`, `o0`, `00`, `0\.0`, `o\.o`, `o\.0`, `0\.o`},
	}
	out := make([]*regexp.Regexp, len(variants))
	for i, grp := range variants {
		code := item12CodeList[i]
		all := append([]string{}, grp...)
		all = append(all, code+"2", code+"page", "person"+code)
		parts := make([]string, len(all))
		for j, v := range all {
			parts[j] = `(\b` + v + `\b)`
		}
		out[i] = regexp.MustCompile(`(?i)` + strings.Join(parts, "|"))
	}
	return out
}

var (
	codeRegexes          = buildCodeRegexes()
	reReportingPerson    = regexp.MustCompile(`(?i)type\s+(?:of|in|or)\s+reporting\s+person`)
	reReportingPersonAlt = regexp.MustCompile(`(?i)type\s+(?:of|in|or)\s+person\s+reporting`)
	reWS                 = regexp.MustCompile(`\s+`)
)

// item12Line is Volkova's R get_phares: for each offset 0..5, gather the
// lines at (hit+offset) across all hit indices, and for each code return
// TRUE if ANY of those lines matches. Emits the pipe-joined union of
// matching codes at the first offset that yields any match.
func item12Line(body string) string {
	rawLines := strings.Split(body, "\n")
	lines := make([]string, 0, len(rawLines))
	for _, ln := range rawLines {
		if reAnyNonWS.MatchString(ln) {
			lines = append(lines, strings.ToLower(ln))
		}
	}
	var hits []int
	for i, ln := range lines {
		if reReportingPerson.MatchString(ln) {
			hits = append(hits, i)
		}
	}
	if len(hits) == 0 {
		return ""
	}
	for offset := 0; offset < 6; offset++ {
		targets := make([]string, 0, len(hits))
		for _, idx := range hits {
			if idx+offset < len(lines) {
				targets = append(targets, lines[idx+offset])
			}
		}
		var matches []string
		for i, rx := range codeRegexes {
			for _, t := range targets {
				if rx.MatchString(t) {
					matches = append(matches, item12CodeList[i])
					break
				}
			}
		}
		if len(matches) > 0 {
			return strings.Join(matches, "|")
		}
	}
	return ""
}

// item12Oneline is Python _get_item12_oneline: collapsed-text matcher
// trying progressive spans from each phrase location.
func item12Oneline(body string) string {
	rawLines := strings.Split(body, "\n")
	lines := make([]string, 0, len(rawLines))
	for _, ln := range rawLines {
		if reAnyNonWS.MatchString(ln) {
			lines = append(lines, ln)
		}
	}
	if len(lines) > 3000 {
		lines = lines[:3000]
	}
	text := strings.ToLower(strings.Join(lines, " "))
	text = strings.TrimSpace(reWS.ReplaceAllString(text, " "))
	locs := reReportingPerson.FindAllStringIndex(text, -1)
	if len(locs) == 0 {
		locs = reReportingPersonAlt.FindAllStringIndex(text, -1)
	}
	if len(locs) == 0 {
		return ""
	}
	for _, span := range []int{20, 40, 60, 80, 100, 120, 160} {
		fragments := make([]string, 0, len(locs))
		for _, loc := range locs {
			start := loc[0]
			end := start + span
			if end > len(text) {
				end = len(text)
			}
			fragments = append(fragments, text[start:end])
		}
		var matches []string
		for i, rx := range codeRegexes {
			for _, frag := range fragments {
				if rx.MatchString(frag) {
					matches = append(matches, item12CodeList[i])
					break
				}
			}
		}
		if len(matches) > 0 {
			return strings.Join(matches, "|")
		}
	}
	return ""
}

// reFilerCIK locates the filing-party CIK in the SGML header. Used for
// the Fidelity/FMR (315066) special case, which Python returns as
// "hc|in" without running the normal extractors.
var reFilerCIK = regexp.MustCompile(`(?s)FILED BY:.*?CENTRAL INDEX KEY:[ \t]+0*(\d+)`)

// extractItem12 is the Custom extractor for the item12 field. Two-pass:
// Fidelity special case first, then line-based, then collapsed-text; falls
// back to the XBRL cover-page extractor when legacy passes return empty.
func extractItem12(buf []byte) string {
	if m := reFilerCIK.FindSubmatch(buf); m != nil && string(m[1]) == "315066" {
		return "hc|in"
	}
	body := string(buf)
	if v := item12Line(body); v != "" {
		return v
	}
	if v := item12Oneline(body); v != "" {
		return v
	}
	return extractItem12Xbrl(buf)
}
