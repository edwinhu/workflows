package main

import (
	"fmt"
	"os"
	"regexp"
	"strings"
	"unicode"
)

// Pre-2001 plain-text (.txt / <PRE> / <TABLE> with <S><C> column markers)
// proxies. These have no <TR>, so the DOM parser turns the whole ASCII table
// into one cell; column structure lives in the whitespace instead.

var (
	reTxtTag = regexp.MustCompile(`(?i)</?(TABLE|CAPTION|S|C|PRE|PAGE|FN)[^>]*>`)
	reAnyTag = regexp.MustCompile(`<[^>]*>`)
	// The numeric tail must START with a number, $, ( or a less-than-1%
	// marker, so the split lands at the last text-to-number boundary:
	// "Dr.  Paula Stern   300   *" is one name and one tail, not the name
	// "Dr." and a tail beginning "Paula". ParsePercent accepts + # * and the
	// dagger family as that marker, so the tail class must carry all of them:
	// a proxy that marks small holders with "+" otherwise fails to parse
	// EVERY row that carries one.
	reTxtRow     = regexp.MustCompile(`^\s*(\S.*?\S)\s{2,}([\$\(\*\+#†‡0-9][\$\(\)0-9,\.\*\+#†‡\-\s%a-zA-Z]{0,79})$`)
	reBigNum     = regexp.MustCompile(`[0-9][0-9,]{2,}`)
	rePctTok     = regexp.MustCompile(`((?:[0-9]{1,3}(?:\.[0-9]+)?|\.[0-9]+))\s*%|(\*)|(?:^|\s)([0-9]{1,2}\.[0-9])(?:\s|$)`)
	reDotLeader  = regexp.MustCompile(`\.{3,}`)
	reHdrLineCue = regexp.MustCompile(`(?i)percent|shares|beneficial|amount|name\s+of`)
	reWrapCont   = regexp.MustCompile(`(?i)^(as\s+a\s+group|and\s+|as\s+a\s+)`)
	reTrailClass = regexp.MustCompile(`(?i)\s+(class\s+[a-d](?:\s+common(?:\s+stock)?)?|common\s+stock|common|series\s+[a-z0-9]+(?:\s+\w+)?|preferred(?:\s+stock)?|ordinary\s+shares)$`)
	// reClassLabelLine is a row stub that names only a share class, in the
	// "Shares" wording as well: the holder is on the line above it.
	reClassLabelLine = regexp.MustCompile(`(?i)^(?:class\s+[a-d](?:\s+(?:common|preferred|non-?voting|voting))?(?:\s+(?:stock|shares?))?|common(?:\s+(?:stock|shares?))?|preferred(?:\s+(?:stock|shares?))?|series\s+[a-z0-9]+(?:\s+(?:common|preferred))?(?:\s+(?:stock|shares?))?|ordinary\s+shares?)$`)
	reClassOnly      = regexp.MustCompile(`(?i)^(class\s+[a-d](?:\s+common(?:\s+stock)?)?|common\s+stock|common|series\s+[a-z0-9]+(?:\s+\w+)?|preferred(?:\s+stock)?|ordinary\s+shares)$`)

	// Many ASCII proxies give the 5% table no heading at all: the anchor is the
	// sentence that introduces it ("The following persons are known by the
	// Company to be the beneficial owners of / more than 5% of its Common
	// Stock"). Both halves must be present -- an ownership word AND a
	// quantified five-percent phrase -- and because the sentence wraps, the
	// test runs over the anchor line joined with the one below it.
	reOwnerWord   = regexp.MustCompile(`(?i)beneficial|owner|owns|owned|owning|holder|holds|voting\s+power|investment\s+power`)
	reFivePercent = regexp.MustCompile(`(?i)(?:more\s+than|at\s+least|greater\s+than|in\s+excess\s+of)\s*(?:5|five)\s*(?:%|per\s?cent)|(?:5|five)\s*(?:%|per\s?cent)\s+or\s+more`)
	// A heading the DOM-path anchor misses because a company name sits between
	// "ownership of" and the class ("OWNERSHIP OF SUNDSTRAND COMMON STOCK").
	reHdrPctCue       = regexp.MustCompile(`(?i)percent|%`)
	reOwnHeadingLoose = regexp.MustCompile(`(?i)ownership\s+of\s+(?:\S+\s+){0,3}(?:common|capital|voting|ordinary)\s+(?:stock|shares)|` +
		`^(?:common|capital|voting|ordinary)\s+(?:stock|shares)\s+owned\s+by\s+(?:directors?|executive\s+officers?|management)\b`)
)

// textAnchor reports whether the ASCII scan should try to find a table under
// line i. It is the DOM path's heading test widened with the two shapes that
// only appear in plain text: a loose ownership heading, and a prose lead-in
// sentence read across the line break it wraps at.
func textAnchor(clean []string, i int, t string) bool {
	if reOwnHeading.MatchString(t) || reOwnHeadingLoose.MatchString(t) {
		return true
	}
	ctx := t
	if i+1 < len(clean) {
		ctx += " " + strings.TrimSpace(clean[i+1])
	}
	return reOwnerWord.MatchString(ctx) && reFivePercent.MatchString(ctx)
}

var reTextNameHeader = regexp.MustCompile(`(?i)^name(?:\s+and\s+address)?(?:\s+of)?(?:\s*\([^)]*\))?$`)
var reTextBeneficialHeader = regexp.MustCompile(`(?i)\bamount\s+and\s+nature\s+of\s+beneficial\s+ownership\b`)

// A stacked ownership caption can be the only anchor. Require the name stub,
// aligned columns, an explicit ownership label and a percent column; never
// read past the first value row to manufacture header evidence from holders.
func textOwnershipHeaderAt(clean []string, i int) bool {
	groups := splitHdrGroups(clean[i])
	if (len(groups) == 4 || len(groups) == 5) && strings.EqualFold(groups[0].text, "Name/Address") {
		shareHeaders, count := true, 0
		for _, g := range groups[1:] {
			t := strings.ToLower(norm(g.text))
			count += strings.Count(t, "no. of shares")
			shareHeaders = shareHeaders && strings.TrimSpace(strings.ReplaceAll(t, "no. of shares", "")) == ""
		}
		shareHeaders = shareHeaders && count == 4
		var header []string
		for j := max(0, i-8); j < len(clean) && j <= i+7; j++ {
			if j > i {
				if _, _, ok := parseTextRow(clean[j]); ok {
					break
				}
			}
			header = append(header, clean[j])
		}
		hdr := strings.ToLower(norm(strings.Join(header, " ")))
		return shareHeaders && strings.Contains(hdr, "common") && strings.Contains(hdr, "preferred") &&
			strings.Contains(hdr, "beneficially") && strings.Contains(hdr, "owned") && strings.Contains(hdr, "percent") &&
			!strings.Contains(hdr, "$") && !reCompCue.MatchString(hdr) && !reOptDetailCue.MatchString(hdr)
	}
	if (len(groups) != 2 && len(groups) != 3) || !reTextNameHeader.MatchString(strings.TrimSpace(groups[0].text)) {
		return false
	}
	header := []string{clean[i]}
	for j := i + 1; j < len(clean) && j <= i+7; j++ {
		if _, _, ok := parseTextRow(clean[j]); ok {
			break
		}
		if strings.TrimSpace(clean[j]) != "" {
			header = append(header, clean[j])
		}
	}
	columns := hdrColumnText(header)
	return reTextBeneficialHeader.MatchString(columns) && reHdrPctCue.MatchString(columns)
}

var reTextHeaderFootnote = regexp.MustCompile(`([0-9]{1,3}(?:,[0-9]{3})+)\s+([1-9][0-9]?)\s+((?:[0-9]{1,3}(?:\.[0-9]+)?|\.[0-9]+)\s*%)`)

// In the three-column caption, a small bare token between shares and percent
// is a footnote, not another holding. Mask it without shifting column spans.
func textHeaderFootnotes(rest string) string {
	return reTextHeaderFootnote.ReplaceAllStringFunc(rest, func(s string) string {
		m := reTextHeaderFootnote.FindStringSubmatchIndex(s)
		return s[:m[4]] + strings.Repeat(" ", m[5]-m[4]) + s[m[5]:]
	})
}

// soleHolderRow reports whether a one-row block is a real 5% table with a
// single holder in it. All three conditions must hold: the anchor above it is a
// quantified five-percent lead-in (or an ownership heading), the column header
// names a percent, and the row's own numeric tail carries a percent. Without
// all three a lone aligned row is usually a sentence with a number in it.
func soleHolderRow(clean []string, anchor int, t string, header []string, ln int) bool {
	ctx := t
	if anchor+1 < len(clean) {
		ctx += " " + strings.TrimSpace(clean[anchor+1])
	}
	if !reFivePercent.MatchString(ctx) && !reOwnHeading.MatchString(t) && !reOwnHeadingLoose.MatchString(t) {
		return false
	}
	hdr := strings.Join(header, " ")
	if !reHdrPctCue.MatchString(hdr) {
		return false
	}
	nm, rest, ok := parseTextRow(clean[ln])
	if !ok {
		return false
	}
	// A director-bio line ("Walter A. Dods, Jr., 56, (1999) has been") and a
	// sentence with a number in it also align on their own. A holder name is
	// short and carries no age and no verb.
	if reBioCue.MatchString(nm) || len(strings.Fields(nm)) > 8 {
		return false
	}
	// The anchor promised a holder of MORE THAN 5%, so that is what the single
	// row has to be; a lone sub-5% row is not the table the anchor named.
	for _, h := range textTokens(rest) {
		if h.pct != nil && *h.pct >= 5.0 {
			return true
		}
	}
	return false
}

// An age, a parenthesised year or a biography verb: this line is a director
// profile, not a holder row.
var reBioCue = regexp.MustCompile(`(?i),\s*[0-9]{2}\s*,|\(1[89][0-9]{2}\)|\((?:19|20)[0-9]{2}\)|` +
	`\b(has\s+been|have\s+been|was\s+elected|since\s+(?:19|20)[0-9]{2}|retired|president\s+of)\b`)

// maxLinesSinceRow caps the combined run of blank and non-row lines between
// two table rows. A four-line address plus its blank separator is five;
// anything past this is the table having ended.
const maxLinesSinceRow = 12

// holding is one (shares, percent) column pair recovered from an ASCII row.
type holding struct {
	shares *float64
	pct    *float64
	marker string
	// lo/hi are the column span this holding occupies inside `rest`, so the
	// ASCII header lines above the block can be read POSITIONALLY: a class
	// stated over one (shares, percent) column pair belongs to that pair and
	// to no other. -1 means no span was recorded.
	lo, hi int
}

var reNumTok = regexp.MustCompile(`[0-9][0-9,]*(?:\.[0-9]+)?\s*%|\.[0-9]+\s*%|[0-9][0-9,]*(?:\.[0-9]+)?|\.[0-9]+|\*|(?:^|\s)[\+#†‡](?:\s|$)`)

// isStarMarker reports the less-than-1% glyphs as a standalone column value.
// They are normalised to "*" downstream so consumers see one marker, not five.
func isStarMarker(t string) bool {
	switch t {
	case "*", "+", "#", "†", "‡":
		return true
	}
	return false
}

// textTokens reads the numeric tail of an ASCII table row left to right and
// pairs each percent with the share count immediately to its left — which in
// these layouts is the "Total" column, the several columns before it being its
// sole-power / shared-power decomposition. With no percent anywhere, the last
// share token is the holding.
func textTokens(rest string) []holding {
	// Length-preserving, so every span recorded below still indexes the ORIGINAL
	// `rest` and stays comparable with the header lines' column offsets.
	rest = reFootnote.ReplaceAllStringFunc(rest, func(m string) string {
		return strings.Repeat(" ", len(m))
	})
	var out []holding
	var pendShares *float64
	pendLo, pendHi := -1, -1
	lastShares := (*float64)(nil)
	lastLo, lastHi := -1, -1
	anyPct := false
	// span merges the pending share column with the token that closes the
	// holding, so a (shares, percent) pair spans both of its columns.
	span := func(lo, hi int) (int, int) {
		if pendShares == nil || pendLo < 0 {
			return lo, hi
		}
		if pendLo < lo {
			lo = pendLo
		}
		if pendHi > hi {
			hi = pendHi
		}
		return lo, hi
	}
	for _, mi := range reNumTok.FindAllStringIndex(rest, -1) {
		raw := rest[mi[0]:mi[1]]
		t := strings.TrimSpace(raw)
		lo := mi[0] + strings.Index(raw, t)
		hi := lo + len(t)
		switch {
		case isStarMarker(t):
			anyPct = true
			l, h := span(lo, hi)
			out = append(out, holding{shares: pendShares, marker: "*", lo: l, hi: h})
			pendShares, pendLo, pendHi = nil, -1, -1
		case strings.HasSuffix(t, "%"):
			anyPct = true
			v, ok, mk, _ := ParsePercent(t)
			l, h := span(lo, hi)
			hd := holding{shares: pendShares, marker: mk, lo: l, hi: h}
			if ok {
				vv := v
				hd.pct = &vv
			}
			out = append(out, hd)
			pendShares, pendLo, pendHi = nil, -1, -1
		case strings.Contains(t, ".") && !strings.Contains(t, ","):
			// a bare decimal in the tail is the percent column
			if v, ok, _, _ := ParsePercent(t + "%"); ok && v <= 100 {
				anyPct = true
				vv := v
				l, h := span(lo, hi)
				out = append(out, holding{shares: pendShares, pct: &vv, lo: l, hi: h})
				pendShares, pendLo, pendHi = nil, -1, -1
				continue
			}
		default:
			if !strings.Contains(t, ",") && len(t) >= 4 {
				continue // a bare 4-digit number in the tail is a year
			}
			if v, ok := ParseShares(t); ok {
				vv := v
				pendShares, lastShares = &vv, &vv
				pendLo, pendHi = lo, hi
				lastLo, lastHi = lo, hi
			}
		}
	}
	if !anyPct && lastShares != nil {
		return []holding{{shares: lastShares, lo: lastLo, hi: lastHi}}
	}
	if pendShares != nil {
		out = append(out, holding{shares: pendShares, lo: pendLo, hi: pendHi})
	}
	if reLessThan.MatchString(rest) {
		out = append(out, holding{marker: "<1%", lo: -1, hi: -1})
	}
	return out
}

// commaNums keeps only share-count-shaped tokens. An ASCII proxy writes share
// counts with thousands separators, so a bare four-digit number in the tail is
// a year (the Summary Compensation Table's "1998"), not a holding.
func commaNums(rest string) []string {
	var out []string
	for _, t := range reBigNum.FindAllString(rest, -1) {
		if strings.Contains(t, ",") || len(strings.Trim(t, ",")) <= 3 {
			out = append(out, t)
		}
	}
	return out
}

// stackedClassHoldings pairs a shares-only line with the percent line directly
// below it. Each value column must have its own class and an overlapping percent;
// an address may occupy the stub of the percent line, but never a new holder.
func stackedClassHoldings(clean []string, ln, restStart int, rest string, hdr [][]hdrGroup) []holding {
	if ln+1 >= len(clean) || len(clean[ln+1]) <= restStart {
		return nil
	}
	prefix := strings.TrimSpace(clean[ln+1][:restStart])
	if prefix != "" && !isAddressLine(prefix) {
		return nil
	}
	sharesText := reFootnote.ReplaceAllStringFunc(rest, func(m string) string { return strings.Repeat(" ", len(m)) })
	percentText := clean[ln+1][restStart:]
	ss := reNumTok.FindAllStringIndex(sharesText, -1)
	pp := reNumTok.FindAllStringIndex(percentText, -1)
	if len(ss) < 2 || len(ss) != len(pp) || strings.TrimSpace(reNumTok.ReplaceAllString(sharesText, "")) != "" || strings.TrimSpace(reNumTok.ReplaceAllString(percentText, "")) != "" {
		return nil
	}
	classes := map[string]bool{}
	var out []holding
	for k, s := range ss {
		t := strings.TrimSpace(sharesText[s[0]:s[1]])
		p := pp[k]
		pt := strings.TrimSpace(percentText[p[0]:p[1]])
		if strings.ContainsAny(t, ".%*") || (!strings.HasSuffix(pt, "%") && pt != "*") || s[0] >= p[1] || p[0] >= s[1] {
			return nil
		}
		v, ok := ParseShares(t)
		if !ok {
			return nil
		}
		c := textColLabel(hdr, restStart+s[0], restStart+s[1])
		if c == "" || classes[c] {
			return nil
		}
		classes[c] = true
		pct, parsed, marker, _ := ParsePercent(pt)
		if !parsed && marker == "" {
			return nil
		}
		h := holding{shares: &v, marker: marker, lo: s[0], hi: s[1]}
		if parsed {
			h.pct = &pct
		}
		out = append(out, h)
	}
	return out
}

func stripEntities(s string) string {
	return strings.NewReplacer("&nbsp;", " ", "&amp;", "&", "&lt;", "<", "&gt;", ">",
		"&quot;", "\"", "&#151;", "-", "&#150;", "-").Replace(s)
}

// ExtractText runs the ASCII path over a proxy body.
var reASCIISlashParenNote = regexp.MustCompile(`/\(\s*([0-9]{1,2})\s*\)/`)

func ExtractText(body string, base Row) ([]Row, int, int) {
	rows, seen, used := extractText(body, base, false)
	if len(ScreenRows(rows)) != 0 || len(ScreenRows(ExtractProse(body, base))) != 0 {
		return rows, seen, used
	}
	if rr, blocks := textSeparateClassCounts(body, base); len(ScreenRows(rr)) != 0 {
		return rr, blocks, blocks
	}
	if rebuilt, ok := textClassAddressRows(body); ok {
		if rr, ss, uu := extractText(rebuilt, base, false); len(ScreenRows(rr)) != 0 {
			return rr, ss, uu
		}
	}
	if len(rows) == 0 && reASCIISlashParenNote.MatchString(body) {
		if rr, ss, uu := extractText(body, base, true); len(ScreenRows(rr)) != 0 {
			return rr, ss, uu
		}
	}
	if rr, blocks := textNomineeShareCounts(body, base); len(ScreenRows(rr)) != 0 {
		return rr, blocks, blocks
	}
	if rr, blocks := textFundShareMatrix(body, base); len(ScreenRows(rr)) != 0 {
		return rr, blocks, blocks
	}
	if rr, blocks := textCaptionOwnershipCounts(body, base); len(ScreenRows(rr)) != 0 {
		return rr, blocks, blocks
	}
	if rr, blocks := textGroupedClassColumns(body, base); len(ScreenRows(rr)) != 0 {
		return rr, blocks, blocks
	}
	if rr, blocks := textFundRegistrationCounts(body, base); len(ScreenRows(rr)) != 0 {
		return rr, blocks, blocks
	}
	return rows, seen, used
}

var reASCIIRegistrationPage = regexp.MustCompile(`^[A-Z]-[0-9]{1,3}$`)
var reASCIIRegisteredShares = regexp.MustCompile(`^([0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)/([A-Z][A-Z0-9]{0,3})$`)

// Registration cells identify accounts; the stub identifies the fund, never the holder.
// Repeated page headers retain the fund stub, but an intervening table resets it.
func textFundRegistrationCounts(body string, base Row) ([]Row, int) {
	raw := strings.Split(stripEntities(body), "\n")
	var out []Row
	blocks, previousEnd := 0, -1
	fund, series := "", ""
	for start := 0; start < len(raw); start++ {
		if !strings.Contains(strings.ToLower(raw[start]), "<table>") {
			continue
		}
		if previousEnd >= 0 {
			continuation := start-previousEnd <= 12
			for _, gap := range raw[previousEnd+1 : start] {
				text := strings.TrimSpace(reAnyTag.ReplaceAllString(gap, ""))
				if text != "" && !reASCIIRegistrationPage.MatchString(text) {
					continuation = false
				}
			}
			if !continuation {
				fund, series = "", ""
			}
		}
		end := start + 1
		for end < len(raw) && !strings.Contains(strings.ToLower(raw[end]), "</table>") {
			end++
		}
		if end == len(raw) {
			break
		}
		previousEnd = end
		marker := -1
		var spans []int
		for j := start + 1; j < end; j++ {
			if m := reASCIIColumnMark.FindAllStringIndex(raw[j], -1); len(m) > 0 {
				marker = j
				for _, col := range m {
					spans = append(spans, col[0])
				}
				break
			}
		}
		if marker < 0 || len(spans) != 4 {
			fund, series = "", ""
			start = end
			continue
		}
		cell := func(line string, col int) string {
			boundary := func(pos int) int {
				if pos >= len(line) {
					return len(line)
				}
				for pos > 0 && line[pos] != ' ' && line[pos-1] != ' ' {
					pos--
				}
				return pos
			}
			lo, hi := boundary(spans[col]), len(line)
			if col+1 < len(spans) {
				hi = boundary(spans[col+1])
			}
			if lo >= hi {
				return ""
			}
			return strings.TrimSpace(line[lo:hi])
		}
		headers := make([]string, 4)
		for j := start + 1; j < marker; j++ {
			line := reAnyTag.ReplaceAllString(raw[j], "")
			if reRuleLine.MatchString(strings.TrimSpace(line)) {
				continue
			}
			for col := range headers {
				headers[col] += " " + cell(line, col)
			}
		}
		expected := []string{"FUND NAME", "REGISTRATION", "SHARES/CLASS", "PERCENT"}
		valid := true
		for col := range headers {
			if strings.ToUpper(norm(headers[col])) != expected[col] {
				valid = false
			}
		}
		if !valid {
			fund, series = "", ""
			start = end
			continue
		}
		var rows []Row
		for j := marker + 1; j < end; j++ {
			line := reDotLeader.ReplaceAllStringFunc(raw[j], func(m string) string { return strings.Repeat(" ", len(m)) })
			stub := cell(line, 0)
			if stub != "" && stub != "--" && !strings.Contains(stub, "<") && !reRuleLine.MatchString(stub) {
				if len(line) > 0 && line[0] == ' ' && fund != "" {
					series = norm(stub)
				} else {
					fund, series = norm(stub), ""
				}
			}
			value, pctText := cell(line, 2), cell(line, 3)
			if value == "" || value == "--" {
				continue
			}
			m := reASCIIRegisteredShares.FindStringSubmatch(value)
			pct, parsed, _, _ := ParsePercent(pctText)
			if m == nil || !parsed || pct <= 0 || pct > 100 || fund == "" {
				valid = false
				break
			}
			shares, ok := ParseShares(m[1])
			if !ok {
				panic("validated registration count failed ParseShares")
			}
			name := cell(line, 1)
			if name == "" || name == "--" || isAddressLine(name) {
				valid = false
				break
			}
			addressed, consumed := false, j
			for k := j + 1; k < end; k++ {
				next := reDotLeader.ReplaceAllStringFunc(raw[k], func(m string) string { return strings.Repeat(" ", len(m)) })
				tail, fundTail := cell(next, 1), cell(next, 0)
				if cell(next, 2) != "" || cell(next, 3) != "" || strings.TrimSpace(next) == "" || strings.Contains(next, "<") {
					break
				}
				if fundTail != "" {
					// A more-indented stub is a wrapped fund name on the same account row.
					indent := len(line) - len(strings.TrimLeft(line, " "))
					nextIndent := len(next) - len(strings.TrimLeft(next, " "))
					if stub == "" || nextIndent <= indent {
						break
					}
					series = norm(series + " " + fundTail)
				}
				consumed = k
				if tail == "" {
					continue
				}
				if isAddressLine(tail) || reASCIIStreetNumber.MatchString(tail) {
					addressed = true
				}
				if !addressed {
					name = norm(name + " " + tail)
				}
			}
			if strings.Contains(name, "$") || !hasWords(name, 1) {
				valid = false
				break
			}
			r := base
			r.HolderName, r.ShareClass = norm(name), withSeries(withSeries(fund, series), "Class "+m[2])
			r.TableIndex, r.RowIndex, r.TableKind, r.Parser = start, j, "5pct_holders", "text_table"
			r.Shares, r.Percent, r.fundRegistration = &shares, &pct, true
			rows = append(rows, r)
			j = consumed
		}
		if valid && len(rows) > 0 {
			out = append(out, rows...)
			blocks++
		} else if !valid {
			fund, series = "", ""
		}
		start = end
	}
	return out, blocks
}

var reASCIIBraceNote = regexp.MustCompile(`\{\(([0-9]+)\)\}`)
var reASCIICaptionShares = regexp.MustCompile(`(?i)beneficially\s+owned|shares\s+owned|number\s+of\s+(?:common\s+)?shares|amount\s+and\s+nature\s+of\s+beneficial\s+ownership`)
var reASCIICaptionPercent = regexp.MustCompile(`(?i)(?:percent|%)\s+(?:of\s+)?(?:class|shares|outstanding)|^shares\s+outstanding$`)
var reASCIICountOnly = regexp.MustCompile(`^(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+|--|-0-)$`)
var reASCIICaptionCount = regexp.MustCompile(`^(?:(?:[0-9]+|[0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?|--|-0-)$`)
var reASCIICaptionAge = regexp.MustCompile(`(?i),\s*age\s+[0-9]{1,3}.*$`)
var reASCIICommitteeNote = regexp.MustCompile(`\([A-Z](?:,[A-Z])+\)`)
var reASCIINameAgeTail = regexp.MustCompile(`,\s*[0-9]{1,3}\s*$`)
var reASCIIOnlyAge = regexp.MustCompile(`^[0-9]{1,3}$`)
var reASCIIOwnerStubHdr = regexp.MustCompile(`(?i)^beneficial\s+owners?$`)
var reASCIIOptionCountHdr = regexp.MustCompile(`(?i)\boptions?\b|exercisable|right\s+to\s+acquire`)
var reASCIIParenAgeOnly = regexp.MustCompile(`(?i)^\(\s*age\s+[0-9]{1,3}\s*\)$`)

// Caption columns, not numeric-tail alignment, distinguish shares from age,
// position and election-year columns. Retry only when the legacy filing is empty.
var reASCIIRecordFundClass = regexp.MustCompile(`(?i)^class\s+[a-z]\s+shares$`)
var reASCIIRecordFundHolding = regexp.MustCompile(`^([0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)\s+\(([0-9]+(?:\.[0-9]+)?%)\)$`)

func textCaptionOwnershipCounts(body string, base Row) ([]Row, int) {
	raw := strings.Split(stripEntities(body), "\n")
	clean := make([]string, len(raw))
	for i, line := range raw {
		clean[i] = reAnyTag.ReplaceAllString(line, "")
	}
	var out []Row
	blocks := 0
	for start := 0; start < len(raw); start++ {
		if !strings.Contains(strings.ToLower(raw[start]), "<table>") {
			continue
		}
		end := start + 1
		for end < len(raw) && !strings.Contains(strings.ToLower(raw[end]), "</table") && !strings.Contains(strings.ToLower(raw[end]), "<fn>") {
			end++
		}
		if end == len(raw) {
			break
		}
		marker := -1
		var spans []int
		for j := start + 1; j < end; j++ {
			if m := reASCIIColumnMark.FindAllStringIndex(raw[j], -1); len(m) >= 3 {
				marker = j
				for _, col := range m {
					spans = append(spans, col[0])
				}
				break
			}
		}
		if marker < 0 {
			start = end
			continue
		}
		cell := func(line string, col int) string {
			boundary := func(pos int) int {
				if pos >= len(line) {
					return len(line)
				}
				for pos > 0 && line[pos] != ' ' && line[pos-1] != ' ' {
					pos--
				}
				return pos
			}
			lo, hi := boundary(spans[col]), len(line)
			if col+1 < len(spans) {
				hi = boundary(spans[col+1])
			}
			if lo >= hi {
				return ""
			}
			return strings.TrimSpace(line[lo:hi])
		}
		headers := make([]string, len(spans))
		for j := start + 1; j < marker; j++ {
			if reRuleLine.MatchString(strings.TrimSpace(clean[j])) {
				continue
			}
			for col := range headers {
				headers[col] += " " + cell(clean[j], col)
			}
		}
		shareCol, pctCol, nameCol, classCol := -1, -1, -1, -1
		// "NUMBER OF SHARES SUBJECT TO VESTED STOCK OPTIONS" beside the
		// holdings column is a count of options: when another column states
		// the holding, it is never the share column. Nor, in that layout, is
		// "PERCENT OF CLASS BENEFICIALLY OWNED", which is the percent column.
		optionCol := map[int]bool{}
		holdingCols := 0
		for col, hdr := range headers {
			h := norm(strings.ReplaceAll(norm(hdr), "%", ""))
			if col == 0 || !reASCIICaptionShares.MatchString(h) {
				continue
			}
			switch {
			case reASCIIOptionCountHdr.MatchString(h):
				optionCol[col] = true
			case reASCIICaptionPercent.MatchString(norm(hdr)):
			default:
				holdingCols++
			}
		}
		if holdingCols == 0 || len(optionCol) == 0 {
			optionCol = nil
		} else {
			for col, hdr := range headers {
				if col > 0 && reASCIICaptionPercent.MatchString(norm(hdr)) {
					optionCol[col] = true
				}
			}
		}
		for col, hdr := range headers {
			headers[col] = norm(hdr)
			if strings.Contains(strings.ToLower(headers[col]), "name") {
				if nameCol != -1 {
					nameCol = -2
					break
				}
				nameCol = col
			}
			if strings.EqualFold(headers[col], "Title of Class") {
				classCol = col
			}
			if col > 0 && !optionCol[col] && reASCIICaptionShares.MatchString(norm(strings.ReplaceAll(headers[col], "%", ""))) {
				if shareCol != -1 {
					shareCol = -2
					break
				}
				shareCol = col
			}
			if col > 0 && col != shareCol && reASCIICaptionPercent.MatchString(headers[col]) {
				if pctCol != -1 {
					pctCol = -2
					break
				}
				pctCol = col
			}
		}
		hdr := strings.Join(headers, " ")
		lowerHdr := strings.ToLower(hdr)
		ctxStart := max(0, start-25)
		ctx := strings.ToLower(norm(strings.Join(clean[ctxStart:start], " ")))
		recordFund := len(spans) == 3 && nameCol == -1 && strings.EqualFold(headers[1], "Address") &&
			strings.Contains(strings.ToLower(headers[2]), "amount of securities") && strings.Contains(strings.ToLower(headers[2]), "% owned") &&
			strings.Contains(ctx, "record owners") && strings.Contains(ctx, "class of the fund") && strings.Contains(ctx, "shares")
		if recordFund {
			nameCol, shareCol, pctCol = 0, 2, 2
		}
		captionText := strings.ToLower(norm(strings.Join(clean[start+1:marker], " ")))
		nameAgeBiography := len(spans) == 5 && nameCol == 0 && shareCol == 3 && pctCol == -1 &&
			strings.Contains(strings.ToLower(headers[0]), "name and age") &&
			strings.Contains(strings.ToLower(headers[1]), "employment") &&
			strings.Contains(strings.ToLower(headers[2]), "director since") &&
			strings.Contains(captionText, "percent of") && strings.Contains(captionText, "common stock") &&
			strings.Contains(captionText, "beneficially") && strings.Contains(captionText, "owned")
		if nameAgeBiography {
			pctCol = 4
		}
		nomineeSix := len(spans) == 6 && nameCol == -1 &&
			(strings.EqualFold(headers[0], "Nominee") || strings.EqualFold(headers[0], "Director")) &&
			strings.Contains(strings.ToLower(headers[1]), "principal occupation") &&
			strings.Contains(captionText, "shares of common stock") && strings.Contains(captionText, "beneficially owned") &&
			strings.Contains(captionText, "fund") && strings.Contains(captionText, "since") &&
			strings.Contains(captionText, "age") && strings.Contains(captionText, "amount %")
		if nomineeSix {
			nameCol, shareCol, pctCol = 0, 4, 5
		}
		splitAddress := len(spans) == 3 && nameCol == -1 && shareCol == 1 && pctCol == 2 &&
			strings.EqualFold(headers[0], "Directors and Executive Officers") &&
			strings.Contains(ctx, "beneficial ownership") && strings.Contains(ctx, "common stock")
		if splitAddress {
			nameCol = 0
		}
		// A stub column headed "BENEFICIAL OWNER" names the holders without
		// the word "name".
		if nameCol == -1 && reASCIIOwnerStubHdr.MatchString(headers[0]) {
			nameCol = 0
		}
		countOnly := pctCol == -1 && (len(spans) == 4 || len(spans) == 5) && nameCol == 0 && shareCol == len(spans)-1 &&
			strings.Contains(lowerHdr, "age") && strings.Contains(lowerHdr, "principal occupation") &&
			shareCol >= 0 && strings.Contains(strings.ToLower(headers[shareCol]), "shares") &&
			(strings.Contains(lowerHdr, "director since") || strings.Contains(lowerHdr, "trustee since") || strings.Contains(lowerHdr, "became director") || strings.Contains(lowerHdr, "became trustee") || strings.Contains(lowerHdr, "became a trustee"))
		if os.Getenv("DEF14A_DEBUG_TEXTBLOCK") != "" {
			fmt.Fprintf(os.Stderr, "--- caption columns=%q shares=%d percent=%d\n", headers, shareCol, pctCol)
		}
		if nameCol < 0 || (nameCol != 0 && classCol != 0) || shareCol < 0 || (pctCol < 0 && !countOnly) || (shareCol == pctCol && !recordFund) || nameCol == shareCol || nameCol == pctCol ||
			reCompCue.MatchString(hdr) || reOptDetailCue.MatchString(hdr) || strings.Contains(strings.ToLower(hdr), "dollar") {
			start = end
			continue
		}
		commonClass := recordFund || (classCol >= 0 && strings.Contains(strings.ToLower(norm(strings.Join(clean[max(0, start-12):marker], " "))), "common stock"))
		class := ""
		if nomineeSix || nameAgeBiography || strings.Contains(strings.ToLower(headers[shareCol]), "common stock") {
			class = "Common Stock"
		}
		var rows []Row
		fundClass := ""
		var groupHead []string
		pendingName := ""
		money := false
		for j := marker + 1; j < end; j++ {
			nm := cell(clean[j], nameCol)
			count := cell(clean[j], shareCol)
			pctText := ""
			if !countOnly {
				pctText = cell(clean[j], pctCol)
			}
			if strings.Contains(count, "$") || (countOnly && strings.Contains(clean[j], "$")) {
				money = true
				break
			}
			if recordFund {
				if count == "" && reASCIIRecordFundClass.MatchString(nm) {
					fundClass = norm(nm)
					continue
				}
				m := reASCIIRecordFundHolding.FindStringSubmatch(count)
				if m == nil || fundClass == "" {
					continue
				}
				count, pctText = m[1], m[2]
			}
			if countOnly && count == "--" {
				count = "0"
			}
			if nomineeSix {
				count = strings.TrimRight(count, "*")
				nm = strings.TrimRight(nm, "*")
			}
			count = reASCIIBraceNote.ReplaceAllString(count, "($1)")
			count, notes := StripFootnotes(count)
			count = strings.TrimSpace(count)
			validCount := reASCIICountOnly.MatchString(count)
			if countOnly {
				validCount = reASCIICaptionCount.MatchString(count)
			}
			if !validCount {
				if nm != "" && !reRuleLine.MatchString(nm) && (len(groupHead) > 0 || strings.HasPrefix(strings.ToLower(nm), "all ")) {
					groupHead = append(groupHead, nm)
				} else if count == "" && pctText == "" && nm != "" && hasWords(nm, 2) && !isAddressLine(nm) && !reSkipName.MatchString(nm) && (!splitAddress || !reASCIIStreetNumber.MatchString(nm)) {
					if splitAddress && strings.HasSuffix(strings.ToLower(pendingName), " and") {
						pendingName = norm(pendingName + " " + nm)
					} else {
						pendingName = nm
					}
				}
				continue
			}
			pct, parsed, markerText, _ := ParsePercent(pctText)
			shares, ok := ParseShares(count)
			if !ok || (!countOnly && !parsed && markerText == "" && pctText != "--") {
				groupHead, pendingName = nil, ""
				continue
			}
			if nm == "" || (splitAddress && isAddressLine(nm)) {
				nm = pendingName
			} else if splitAddress && strings.HasSuffix(strings.ToLower(pendingName), " and") {
				nm = norm(pendingName + " " + nm)
			}
			pendingName = ""
			if len(groupHead) > 0 {
				nm = norm(strings.Join(groupHead, " ") + " " + nm)
				groupHead = nil
			}
			if countOnly {
				// "(Age 68)" under the name is the holder's second line, holding
				// another fund's shares: never a holder of its own.
				if reASCIIParenAgeOnly.MatchString(nm) {
					continue
				}
				stub := strings.TrimSpace(reDotLeader.ReplaceAllString(clean[j][:min(len(clean[j]), spans[shareCol])], " "))
				if grp, _ := isGroupRow(stub); grp {
					nm = stub
				}
				nm = reASCIICommitteeNote.ReplaceAllString(nm, "")
				nm = reASCIICaptionAge.ReplaceAllString(nm, "")
				nm = strings.TrimRight(strings.TrimSpace(nm), "*")
			}
			if nameAgeBiography {
				// Name wraps stay in the stub; the comma-delimited age ends the name.
				for k := j + 1; k < end && k <= j+3 && !reASCIINameAgeTail.MatchString(nm); k++ {
					if cell(clean[k], pctCol) != "" {
						break
					}
					tail := cell(clean[k], nameCol)
					if tail == "" || reASCIIOnlyAge.MatchString(tail) {
						break
					}
					nm = norm(nm + " " + tail)
				}
				nm = strings.TrimRight(reASCIINameAgeTail.ReplaceAllString(nm, ""), ", ")
			}
			nm = norm(reDotLeader.ReplaceAllString(nm, " "))
			nm, nameNotes := StripFootnotes(nm)
			if nm == "" || !hasWords(nm, 1) || reSkipName.MatchString(nm) || isAddressLine(nm) || reRuleLine.MatchString(nm) {
				continue
			}
			_, groupCount := isGroupRow(nm)
			if strings.HasPrefix(strings.ToLower(nm), "all ") && (!splitAddress || groupCount == 0) {
				for k := j + 1; k < end && k <= j+3; k++ {
					if cell(clean[k], shareCol) != "" || (!countOnly && cell(clean[k], pctCol) != "") {
						break
					}
					tail := cell(clean[k], nameCol)
					if tail == "" {
						continue
					}
					joined := norm(nm + " " + tail)
					if grp, _ := isGroupRow(joined); grp {
						nm = joined
						break
					}
				}
			}
			rowClass := class
			if recordFund {
				rowClass = fundClass
			}
			if classCol >= 0 {
				rowClass, _ = StripFootnotes(reDotLeader.ReplaceAllString(cell(clean[j], classCol), " "))
				if !reClassVal.MatchString(rowClass) {
					continue
				}
			}
			grp, gn := isGroupRow(nm)
			r := base
			r.HolderName, r.ShareClass, r.TableKind = nm, rowClass, "management"
			if recordFund {
				r.TableKind = "5pct_holders"
			}
			r.commonColumn = commonClass
			r.captionCount = countOnly
			r.captionPerson = nameAgeBiography
			r.TableIndex, r.RowIndex, r.Parser = start, j, "text_table"
			r.Shares, r.PctMarker, r.IsGroupRow, r.GroupN = &shares, markerText, grp, gn
			if parsed {
				r.Percent = &pct
			}
			r.Footnotes = strings.Join(append(nameNotes, notes...), ",")
			rows = append(rows, r)
		}
		if !money && (len(rows) >= 2 || (nomineeSix && len(rows) == 1)) {
			out = append(out, rows...)
			blocks++
		}
		start = end
	}
	return out, blocks
}

var reASCIIMatrixCount = regexp.MustCompile(`^[0-9][0-9,]*(?:\([0-9]+\))?$`)

// SGML table boundaries isolate explicit share-count matrices from adjacent money tables.
func textFundShareMatrix(body string, base Row) ([]Row, int) {
	raw := strings.Split(stripEntities(body), "\n")
	var out []Row
	blocks := 0
	for start := 0; start < len(raw); start++ {
		if !strings.Contains(strings.ToLower(raw[start]), "<table>") {
			continue
		}
		end := start + 1
		for end < len(raw) && !strings.Contains(strings.ToLower(raw[end]), "</table>") {
			end++
		}
		if end == len(raw) {
			break
		}
		marker, header := -1, -1
		var spans []int
		for j := start + 1; j < end; j++ {
			if strings.HasPrefix(strings.TrimSpace(strings.ToUpper(raw[j])), "BOARD MEMBER") {
				header = j
			}
			if m := reASCIIColumnMark.FindAllStringIndex(raw[j], -1); len(m) >= 3 {
				marker = j
				for _, col := range m {
					spans = append(spans, col[0])
				}
				break
			}
		}
		text := strings.ToLower(strings.Join(raw[start:end], " "))
		if marker < 0 || header < 0 || header >= marker ||
			!strings.Contains(text, "fund shares owned by board members") ||
			strings.ContainsAny(text, "$%") || strings.Contains(text, "dollar") ||
			reCompCue.MatchString(strings.Join(raw[start:marker], " ")) {
			start = end
			continue
		}
		cell := func(line string, col int) string {
			boundary := func(pos int) int {
				if pos >= len(line) {
					return len(line)
				}
				for pos > 0 && line[pos] != ' ' && line[pos-1] != ' ' {
					pos--
				}
				return pos
			}
			lo, hi := boundary(spans[col]), len(line)
			if col+1 < len(spans) {
				hi = boundary(spans[col+1])
			}
			if lo >= hi {
				return ""
			}
			return strings.TrimSpace(line[lo:hi])
		}
		// Upper fund-name lines may precede the board-member stub.
		for header > start+1 && !strings.HasPrefix(strings.TrimSpace(raw[header-1]), "-") && !strings.Contains(raw[header-1], "<") {
			header--
		}
		labels := make([]string, len(spans))
		distinct := map[string]bool{}
		for col := 1; col < len(spans); col++ {
			for j := header; j < marker; j++ {
				if strings.TrimSpace(raw[j]) == "" || strings.HasPrefix(strings.TrimSpace(raw[j]), "-") {
					continue
				}
				labels[col] += " " + cell(raw[j], col)
			}
			labels[col] = norm(labels[col])
			if labels[col] != "" {
				distinct[labels[col]] = true
			}
		}
		if len(distinct) != len(spans)-1 {
			start = end
			continue
		}
		var rows []Row
		pending := ""
		for j := marker + 1; j < end; j++ {
			line := reDotLeader.ReplaceAllStringFunc(raw[j], func(m string) string { return strings.Repeat(" ", len(m)) })
			name := cell(line, 0)
			if name == "" || strings.HasPrefix(name, "-") || strings.Contains(name, "<") {
				pending = ""
				continue
			}
			if cell(line, 1) == "" {
				pending = norm(pending + " " + name)
				continue
			}
			name = norm(pending + " " + name)
			pending = ""
			name, _ = StripFootnotes(name)
			if !hasWords(name, 2) {
				continue
			}
			valid := true
			for col := 1; col < len(spans); col++ {
				if !reASCIIMatrixCount.MatchString(cell(line, col)) {
					valid = false
				}
			}
			if !valid {
				continue
			}
			group, n := isGroupRow(name)
			for col := 1; col < len(spans); col++ {
				count := cell(line, col)
				shares, ok := ParseShares(count)
				if !ok {
					panic("validated ASCII matrix count failed ParseShares")
				}
				_, notes := StripFootnotes(count)
				r := base
				r.TableIndex, r.RowIndex = start, j
				r.HolderName, r.classHint, r.TableKind = name, labels[col], "management"
				r.Shares, r.Parser, r.Footnotes = &shares, "text_table", strings.Join(notes, ",")
				r.IsGroupRow, r.GroupN = group, n
				rows = append(rows, r)
			}
		}
		if len(rows) >= 2*(len(spans)-1) {
			out = append(out, rows...)
			blocks++
		}
		start = end
	}
	return out, blocks
}

// Count-count-percent-percent ASCII columns must be paired by class, not proximity.
// This retry is available only when the legacy filing has no screened holdings.
var reASCIIPageNumber = regexp.MustCompile(`^[0-9]{1,3}$`)
var reASCIIGroupCount = regexp.MustCompile(`(?i)\(\s*[0-9]{1,3}\s+(?:persons?|people|individuals?)\s*\)`)
var reASCIIStreetNumber = regexp.MustCompile(`^\d{1,6}(?:-\d{1,6})?[A-Za-z]?\s+[A-Za-z]`)

func textSeparateClassCounts(body string, base Row) ([]Row, int) {
	raw := strings.Split(stripEntities(body), "\n")
	var out []Row
	blocks, priorEnd := 0, -1
	var priorMarks []int
	priorAmountPairs := false
	for start := 0; start < len(raw); start++ {
		if !strings.Contains(strings.ToLower(raw[start]), "<table>") {
			continue
		}
		end := start + 1
		for end < len(raw) && !strings.Contains(strings.ToLower(raw[end]), "</table>") {
			end++
		}
		if end == len(raw) {
			break
		}
		mark := -1
		var marks []int
		var header []string
		explicit := false
		amountPairs, stockPairHeader := false, false
		for j := start + 1; j < end; j++ {
			m := reASCIIColumnMark.FindAllStringIndex(raw[j], -1)
			if len(m) == 5 {
				mark = j
				for _, c := range m {
					marks = append(marks, c[0])
				}
				break
			}
			line := reAnyTag.ReplaceAllString(raw[j], "")
			if reRuleLine.MatchString(strings.TrimSpace(line)) {
				continue
			}
			header = append(header, line)
			g := splitHdrGroups(line)
			if len(g) == 2 && strings.EqualFold(g[0].text, "COMMON STOCK") && strings.EqualFold(g[1].text, "PREFERRED STOCK") {
				stockPairHeader = true
			}
			if len(g) == 5 && strings.EqualFold(g[0].text, "NAME AND ADDRESS") &&
				strings.EqualFold(g[1].text, "AMOUNT") && strings.EqualFold(g[2].text, "% OF CLASS") &&
				strings.EqualFold(g[3].text, "AMOUNT") && strings.EqualFold(g[4].text, "% OF CLASS") {
				amountPairs = true
			}
			if len(g) == 5 && strings.Contains(strings.ToLower(g[0].text), "beneficial owner") &&
				strings.EqualFold(g[1].text, "Common Stock") && strings.EqualFold(g[2].text, "Preferred Stock") &&
				strings.EqualFold(g[3].text, "Common Stock") && strings.EqualFold(g[4].text, "Stock") {
				explicit = true
			}
		}
		hdr := hdrColumnText(header)
		ctxStart := max(0, start-25)
		ctx := strings.ToLower(norm(reAnyTag.ReplaceAllString(strings.Join(raw[ctxStart:start], " "), "")))
		amountPairs = amountPairs && stockPairHeader && strings.Contains(ctx, "shares") &&
			strings.Contains(ctx, "common stock") && (strings.Contains(ctx, "beneficially") || strings.Contains(ctx, "beneficial ownership")) &&
			!reCompCue.MatchString(strings.Join(header, " ")) && !reOptDetailCue.MatchString(strings.Join(header, " "))
		explicit = explicit && reTextBeneficialHeader.MatchString(hdr) && reHdrPctCue.MatchString(hdr) &&
			!reCompCue.MatchString(hdr) && !reOptDetailCue.MatchString(hdr)
		continuation := mark >= 0 && priorEnd >= 0 && len(priorMarks) == len(marks)
		if continuation {
			for k := range marks {
				if marks[k]-priorMarks[k] < -2 || marks[k]-priorMarks[k] > 2 {
					continuation = false
				}
			}
			gap := strings.TrimSpace(reAnyTag.ReplaceAllString(strings.Join(raw[priorEnd+1:start], " "), ""))
			continuation = continuation && (gap == "" || reScreenDate.MatchString(gap) || reASCIIPageNumber.MatchString(gap)) && strings.TrimSpace(strings.Join(header, " ")) == ""
		}
		if continuation {
			amountPairs = priorAmountPairs
		}
		if mark < 0 || (!explicit && !amountPairs && !continuation) || strings.Contains(strings.Join(raw[start:end], " "), "$") {
			priorEnd, priorMarks = -1, nil
			start = end
			continue
		}
		var rows []Row
		var nameLines []string
		for j := mark + 1; j < end; j++ {
			line := reAnyTag.ReplaceAllString(raw[j], "")
			t := strings.TrimSpace(line)
			if t == "" || reRuleLine.MatchString(t) {
				nameLines = nil
				continue
			}
			g := splitHdrGroups(line)
			if len(g) == 5 && g[1].lo >= marks[1]-8 && g[2].lo >= marks[2]-8 && g[3].lo >= marks[3]-8 && g[4].lo >= marks[4]-8 {
				shares, ok := ParseShares(g[1].text)
				pctCol := 3
				if amountPairs {
					pctCol = 2
				}
				pct, parsed, marker, _ := ParsePercent(g[pctCol].text)
				if !ok || shares <= 0 || (!parsed && marker == "") {
					nameLines = nil
					continue
				}
				stub := strings.TrimSpace(g[0].text)
				if !isAddressLine(stub) {
					nameLines = append(nameLines, stub)
				}
				name := norm(strings.Join(nameLines, " "))
				grp, gn := isGroupRow(name)
				nm, notes := StripFootnotes(name)
				if gn > 0 {
					nm = reASCIIGroupCount.ReplaceAllString(nm, "")
					nm = norm(nm)
				}
				if nm == "" || reSkipName.MatchString(nm) || reHdrLineCue.MatchString(nm) || isAddressLine(nm) {
					nameLines = nil
					continue
				}
				r := base
				r.HolderName, r.ShareClass, r.TableKind = nm, "Common Stock", "management"
				r.TableIndex, r.RowIndex, r.Parser = start, j, "text_table"
				r.Shares, r.PctMarker, r.IsGroupRow, r.GroupN = &shares, marker, grp, gn
				if parsed {
					r.Percent = &pct
				}
				r.Footnotes = strings.Join(notes, ",")
				rows = append(rows, r)
				nameLines = nil
			} else if len(g) == 1 && g[0].lo < marks[1]-8 && !isAddressLine(t) && !reASCIIStreetNumber.MatchString(t) && !strings.HasPrefix(strings.ToLower(t), "c/o ") {
				nameLines = append(nameLines, t)
			}
		}
		if len(rows) >= 2 {
			out = append(out, rows...)
			blocks++
			priorEnd, priorMarks, priorAmountPairs = end, marks, amountPairs
		} else {
			priorEnd, priorMarks = -1, nil
		}
		start = end
	}
	return out, blocks
}

var reNomineeAgeYear = regexp.MustCompile(`^(.+?)\s+([0-9]{1,3})\s+\(([12][0-9]{3})\)$`)
var reASCIIBioStars = regexp.MustCompile(`\(\*+\)|\*+$`)
var reNomineeInlineAge = regexp.MustCompile(`^\*?(.+?)\s+\(([0-9]{2,3})\),\s*\S`)

// Three SGML columns isolate shares from biography/position text. Name cells
// carry either age/election year or inline age. Headerless election-year
// continuations must repeat the spans and introduce directors elected in prior years.
func textNomineeShareCounts(body string, base Row) ([]Row, int) {
	raw := strings.Split(stripEntities(body), "\n")
	clean := make([]string, len(raw))
	for i, line := range raw {
		clean[i] = reAnyTag.ReplaceAllString(line, "")
	}
	var out []Row
	blocks, priorEnd := 0, -1
	var priorSpans []int
	priorBioCount := false
	for start := 0; start < len(raw); start++ {
		if !strings.Contains(strings.ToLower(raw[start]), "<table>") {
			continue
		}
		end := start + 1
		for end < len(raw) && !strings.Contains(strings.ToLower(raw[end]), "</table>") {
			end++
		}
		if end == len(raw) {
			break
		}
		marker := -1
		var spans []int
		for j := start + 1; j < end; j++ {
			if m := reASCIIColumnMark.FindAllStringIndex(raw[j], -1); len(m) == 3 {
				marker = j
				for _, col := range m {
					spans = append(spans, col[0])
				}
				break
			}
		}
		if marker < 0 {
			priorEnd, priorSpans, priorBioCount = -1, nil, false
			start = end
			continue
		}
		cell := func(line string, col int) string {
			boundary := func(pos int) int {
				if pos >= len(line) {
					return len(line)
				}
				for pos > 0 && line[pos] != ' ' && line[pos-1] != ' ' {
					pos--
				}
				return pos
			}
			lo, hi := boundary(spans[col]), len(line)
			if col+1 < len(spans) {
				hi = boundary(spans[col+1])
			}
			if lo >= hi {
				return ""
			}
			return strings.TrimSpace(line[lo:hi])
		}
		headers := make([]string, 3)
		for col := range headers {
			for j := start + 1; j < marker; j++ {
				if reRuleLine.MatchString(strings.TrimSpace(clean[j])) {
					continue
				}
				headers[col] += " " + cell(clean[j], col)
			}
			headers[col] = strings.ToLower(norm(headers[col]))
		}
		hdr := strings.Join(headers, " ")
		explicit := strings.Contains(headers[0], "name") && strings.Contains(headers[0], "age") &&
			strings.Contains(headers[0], "year") && strings.Contains(headers[0], "director") &&
			strings.Contains(headers[1], "business experience") && strings.Contains(headers[2], "shares of common stock") &&
			strings.Contains(headers[2], "beneficially owned")
		fullHeader := strings.ToLower(norm(strings.Join(clean[start+1:marker], " ")))
		inlineAge := strings.Contains(headers[0], "name, age, business experience") &&
			strings.Contains(headers[0], "directorships") && strings.Contains(headers[1], "position with fund") &&
			strings.Contains(fullHeader, "shares owned at")
		bioCount := strings.Contains(headers[0], "name") && strings.Contains(headers[0], "age") && strings.Contains(headers[0], "address") &&
			(strings.Contains(headers[1], "business experience") || strings.Contains(headers[1], "principal occupations")) &&
			(strings.Contains(headers[2], "shares of fund owned") || strings.Contains(headers[2], "number of shares beneficially owned"))
		bioContinuation := false
		if priorBioCount && priorEnd >= 0 && strings.TrimSpace(hdr) == "" && start-priorEnd <= 12 && spans[0] == priorSpans[0] &&
			spans[1] >= priorSpans[1]-8 && spans[1] <= priorSpans[1]+8 && spans[2] >= priorSpans[2]-8 && spans[2] <= priorSpans[2]+8 {
			bioContinuation = true
			for _, gap := range clean[priorEnd+1 : start] {
				text := strings.TrimSpace(gap)
				if text != "" && !reASCIIPageNumber.MatchString(text) && !reASCIIRegistrationPage.MatchString(text) {
					bioContinuation = false
				}
			}
		}
		bioCount = bioCount || bioContinuation
		explicit = explicit || inlineAge || bioCount
		continuation := false
		if priorEnd >= 0 && len(priorSpans) == 3 && spans[0] == priorSpans[0] && spans[1] == priorSpans[1] && spans[2] == priorSpans[2] && strings.TrimSpace(hdr) == "" {
			between := strings.ToLower(strings.Join(clean[priorEnd+1:start], " "))
			continuation = strings.Contains(between, "directors") && strings.Contains(between, "elected") && strings.Contains(between, "prior years")
		}
		if (!explicit && !continuation) || reCompCue.MatchString(hdr) || reOptDetailCue.MatchString(hdr) ||
			((inlineAge || bioCount) && (strings.Contains(fullHeader, "dollar") || strings.Contains(strings.Join(raw[start:end], " "), "$"))) {
			priorEnd, priorSpans, priorBioCount = -1, nil, false
			start = end
			continue
		}
		var rows []Row
		pendingCount := ""
		for j := marker + 1; j < end; j++ {
			name := reNomineeAgeYear.FindStringSubmatch(cell(clean[j], 0))
			if inlineAge {
				name = reNomineeInlineAge.FindStringSubmatch(cell(clean[j], 0))
			}
			count := cell(clean[j], 2)
			if bioCount {
				if cell(clean[j], 0) == "" && cell(clean[j], 1) == "" {
					bare, _ := StripFootnotes(reASCIIBioStars.ReplaceAllString(count, ""))
					if reASCIICountOnly.MatchString(strings.TrimSpace(bare)) {
						pendingCount = count
					} else {
						pendingCount = ""
					}
					continue
				}
				if count == "" {
					count = pendingCount
				}
				pendingCount = ""
				nm := norm(reDotLeader.ReplaceAllString(cell(clean[j], 0), " "))
				if nm == "" || !hasWords(nm, 2) || isAddressLine(nm) || reSkipName.MatchString(nm) {
					continue
				}
				name = []string{"", reASCIIBioStars.ReplaceAllString(nm, "")}
				count = reASCIIBioStars.ReplaceAllString(count, "")
				bare, _ := StripFootnotes(count)
				if !reASCIICountOnly.MatchString(strings.TrimSpace(bare)) {
					continue
				}
			}
			if name == nil || cell(clean[j], 1) == "" || strings.ContainsAny(count, "$%") {
				continue
			}
			shares, ok := ParseShares(count)
			if !ok || shares < 0 {
				continue
			}
			nm, _ := StripFootnotes(name[1])
			_, notes := StripFootnotes(count)
			r := base
			r.TableIndex, r.RowIndex = start, j
			r.HolderName, r.ShareClass, r.TableKind = norm(nm), "Common Stock", "management"
			if inlineAge || bioCount {
				r.ShareClass = ""
			}
			r.Shares, r.Parser, r.Footnotes = &shares, "text_table", strings.Join(notes, ",")
			rows = append(rows, r)
		}
		if len(rows) >= 2 {
			out = append(out, rows...)
			blocks++
			priorEnd, priorSpans, priorBioCount = end, spans, bioCount
		} else {
			priorEnd, priorSpans, priorBioCount = -1, nil, false
		}
		start = end
	}
	return out, blocks
}

// Move the name at the head of a four-column name/address cell onto its
// numeric line. The class and value column spans remain explicit; postal
// numbers are never treated as holdings. Used only after a zero-row screen.
func textClassAddressRows(body string) (string, bool) {
	lines := strings.Split(body, "\n")
	changed := false
	start := -1
	for end, line := range lines {
		low := strings.ToLower(line)
		if strings.Contains(low, "<table") {
			start = end
		}
		if start < 0 || !strings.Contains(low, "</table") {
			continue
		}
		var header []string
		mark := -1
		nameStart, valueStart := -1, -1
		for j := start + 1; j < end; j++ {
			if reASCIIColumnMark.MatchString(lines[j]) {
				mark = j
				g := splitHdrGroups(lines[j])
				if nameStart >= 0 && len(g) == 4 {
					nameStart, valueStart = g[1].lo, g[2].lo
				} else {
					nameStart = -1
				}
				break
			}
			clean := reAnyTag.ReplaceAllString(lines[j], "")
			if strings.TrimSpace(clean) == "" || reRuleLine.MatchString(clean) {
				continue
			}
			header = append(header, clean)
			g := splitHdrGroups(clean)
			if len(g) == 4 && strings.EqualFold(strings.TrimSpace(g[0].text), "Title of Class") &&
				strings.Contains(strings.ToLower(g[1].text), "name and address") {
				nameStart, valueStart = g[1].lo, g[2].lo
			}
		}
		hdr := hdrColumnText(header)
		if mark < 0 || nameStart < 0 || !reTextBeneficialHeader.MatchString(hdr) ||
			!reHdrPctCue.MatchString(strings.Join(header, " ")) || reCompCue.MatchString(hdr) || reOptDetailCue.MatchString(hdr) {
			start = -1
			continue
		}
		for j := mark + 2; j < end; j++ {
			g := splitHdrGroups(lines[j])
			if len(g) < 4 || g[1].lo != nameStart ||
				!reASCIIAddressClass.MatchString(strings.TrimSpace(g[0].text)) {
				continue
			}
			value, percent := g[len(g)-2], g[len(g)-1]
			if value.lo < valueStart-2 || !reASCIIStreetCell.MatchString(strings.TrimSpace(lines[j][nameStart:value.lo])) {
				continue
			}
			prev := lines[j-1]
			nm := strings.TrimSpace(prev)
			if len(prev)-len(strings.TrimLeft(prev, " ")) != nameStart || len(nm) > 70 ||
				!hasWords(nm, 2) || reShareLike.MatchString(nm) || reSkipName.MatchString(nm) ||
				reHdrLineCue.MatchString(nm) || isAddressLine(nm) || reRuleLine.MatchString(nm) {
				continue
			}
			if _, ok := ParseShares(value.text); !ok {
				continue
			}
			if _, ok, marker, _ := ParsePercent(percent.text); !ok && marker == "" {
				continue
			}
			_, notes := StripFootnotes(value.text + " " + percent.text)
			if len(notes) > 0 {
				nm += " (" + strings.Join(notes, ") (") + ")"
			}
			prefix := strings.TrimSpace(g[0].text) + ":  " + nm
			if len(prefix)+2 > value.lo {
				continue
			}
			lines[j] = prefix + strings.Repeat(" ", value.lo-len(prefix)) + lines[j][value.lo:]
			lines[j-1] = ""
			changed = true
		}
		start = -1
	}
	return strings.Join(lines, "\n"), changed
}

var reASCIIAddressClass = regexp.MustCompile(`(?i)^(?:common\s+(?:shares|stock)|ordinary\s+shares|class\s+[a-z0-9]+(?:\s+common\s+stock)?)$`)
var reASCIIStreetCell = regexp.MustCompile(`(?i)^(?:suite\s+\d|\d+[a-z]?(?:-\d+)?\s+\S.*\b(?:street|st|avenue|ave|road|rd|drive|dr|broadway)\b)`)

func extractText(body string, base Row, slashParenRecovery bool) ([]Row, int, int) {
	body = stripEntities(body)
	lines := strings.Split(body, "\n")
	clean := make([]string, len(lines))
	inTable, headerDone, slashEligible := false, false, false
	var tableHeader []string
	for i, l := range lines {
		raw := strings.ToLower(l)
		if strings.Contains(raw, "<table") {
			inTable = true
			headerDone = false
			slashEligible = false
			tableHeader = nil
		}
		if inTable && !headerDone {
			tableHeader = append(tableHeader, reAnyTag.ReplaceAllString(l, ""))
			if reASCIIColumnMark.MatchString(l) {
				hdr := strings.ToLower(flat(strings.Join(tableHeader, " ")))
				slashEligible = strings.Contains(hdr, "name of beneficial owner") && strings.Contains(hdr, "shares owned")
				headerDone = true
			}
		}
		if strings.Contains(raw, "</table") {
			inTable = false
			slashEligible = false
		}
		l = reTxtTag.ReplaceAllString(l, "")
		l = reAnyTag.ReplaceAllString(l, "")
		// Dot leaders are the ASCII table's column separator ("Ellison(2).....
		// 344,039,276  24.0%"), so they become whitespace rather than a reason
		// to skip the line.
		l = reDotLeader.ReplaceAllStringFunc(l, func(m string) string {
			return strings.Repeat(" ", len(m))
		})
		// Preserve the footnote while removing its slash delimiters before
		// numeric-tail detection, only after the legacy filing parsed to zero.
		if slashParenRecovery && slashEligible {
			l = reASCIISlashParenNote.ReplaceAllString(l, "($1)")
		}
		clean[i] = strings.ReplaceAll(l, "\t", "    ")
	}
	out, consumed, bioBlocks := textBiographicalOwnership(lines, clean, base)
	blocksSeen, blocksUsed := bioBlocks, bioBlocks
	// A fund-family proxy in ASCII prints the fund's name on its own line above
	// each per-fund holder table. Record which fund is in force at every line so
	// a block can be labelled with it: without the fund, the same record holder
	// of a hundred funds collapses onto one grain key.
	seriesAt := textSeriesLabels(clean, base.series)

	// Preserve legacy anchors and their row context before trying header-only discovery.
	for discovery := 0; discovery < 2; discovery++ {
		for i, l := range clean {
			t := strings.TrimSpace(l)
			if len(t) < 6 || len(t) > 200 || reTOCish.MatchString(t) {
				continue
			}
			if (discovery == 0 && !textAnchor(clean, i, t)) || (discovery == 1 && !textOwnershipHeaderAt(clean, i)) {
				continue
			}
			kind := sectionKind(t)
			stackedHeader := discovery == 1
			// scan forward for tabular lines
			j := i + 1
			limit := i + 400
			if limit > len(clean) {
				limit = len(clean)
			}
			var block []int
			var header []string
			// Three counters, not one. A 5% holder's ADDRESS sits on the lines under
			// its name with a blank line before the next holder, so a shared counter
			// reaches the blank-line limit on the first holder and ends the table
			// after one row. blankRun ends it only on a real run of blank lines,
			// nonRowRun on a run of prose, sinceRow caps the two together.
			blankRun, nonRowRun, sinceRow := 0, 0, 0
			var lone []int // a lone lead-in row set aside; see below
			hdrAfterLone, loneHdr := false, 0
			pastTable := false // the scan has crossed a table another anchor took
			// The block's own column header, normalised, filled in once the first row
			// is seen. A table that runs over a page break REPRINTS it on the new
			// page, which is the only thing distinguishing a page break from the end
			// of the table.
			var ownHdrSet map[string]bool
			// One row and then a run of prose: the row was a sentence in the lead-in
			// ("The following table sets forth, as of March 31, 1995,"), and the
			// table under this heading may still be below. Set it aside and keep
			// scanning; the rows found instead are kept only if a column-header line
			// separates them from it -- the lead-in sits ABOVE the table's header --
			// so a sole 5% holder followed by its footnotes and another table still
			// stands.
			setAside := func() bool {
				if len(block) != 1 || lone != nil {
					return false
				}
				lone, block, ownHdrSet = block, nil, nil
				loneHdr = len(header)
				nonRowRun, sinceRow = 0, 0
				return true
			}
			resume := func() bool {
				if ownHdrSet == nil {
					return false
				}
				if k := reprintedHeaderAt(clean, j, limit, ownHdrSet); k > 0 {
					j = k
					blankRun, nonRowRun, sinceRow = 0, 0, 0
					return true
				}
				return false
			}
			for ; j < limit; j++ {
				if consumed[j] {
					if stackedHeader && len(block) == 0 {
						break
					}
					pastTable = true
					continue
				}
				lt := strings.TrimSpace(clean[j])
				if lt == "" {
					blankRun++
					if len(block) > 0 {
						sinceRow++
						if blankRun >= 3 || sinceRow >= maxLinesSinceRow {
							if resume() {
								continue
							}
							// A lead-in sentence row still followed by prose, then the
							// blank lines a <TABLE>/<CAPTION> wrapper leaves behind. A
							// lead-in sits above its table, so never once the scan is
							// past a table: that lone row is a footnote under it.
							if nonRowRun >= 2 && !pastTable && setAside() {
								continue
							}
							break
						}
					}
					continue
				}
				blankRun = 0
				if reHdrLineCue.MatchString(lt) && len(block) == 0 {
					header = append(header, clean[j])
					if lone != nil && columnarHdrLine(lt) {
						hdrAfterLone = true
					}
				}
				if len(block) == 0 && j-i > 60 {
					break // the heading's table is not here
				}
				if _, _, _, ok := parseTextRowAtWithZero(clean[j], stackedHeader); ok {
					block = append(block, j)
					nonRowRun, sinceRow = 0, 0
					if ownHdrSet == nil {
						ownHdrSet = headerLineSet(clean, block[0])
					}
				} else if len(block) > 0 {
					// A holder's postal address is not prose: it does not count
					// toward the run of non-row lines that ends the table. Only
					// sinceRow caps it, so a c/o line plus a firm, a tower, a
					// street and a city/zip cannot separate two holders forever.
					if !isAddressLine(lt) && !stubCellCont(clean, block[0], j) {
						nonRowRun++
					}
					sinceRow++
					if nonRowRun > 6 || sinceRow >= maxLinesSinceRow {
						if resume() {
							continue
						}
						if setAside() {
							continue
						}
						break
					}
				}
			}
			if lone != nil && (len(block) == 0 || !hdrAfterLone) {
				block, header = lone, header[:loneHdr]
			}
			block = alignedRows(clean, block, stackedHeader)
			// A proxy with exactly ONE 5% holder writes a one-row table, and the
			// footnote rule under it ends the block before a second row can join.
			// The floor stays at two rows in general -- a lone row that lines up
			// with nothing is usually a sentence with a number in it -- and is
			// relaxed only when the anchor was a quantified five-percent lead-in,
			// the header names a percent column, and the row itself carries one.
			sole := len(block) == 1 && soleHolderRow(clean, i, t, header, block[0])
			if len(block) == 0 || (len(block) == 1 && !sole) {
				continue
			}
			blocksSeen++
			// The header lines above the block, split into column groups with their
			// character spans, so a class stated over ONE (shares, percent) pair can
			// be attached to that pair and to no other. Computed BEFORE the cue tests
			// because it is also the block's own statement of what its columns are.
			hdrRows := textHeaderRows(clean, block[0])
			hdr := strings.Join(header, " ")
			// A proxy that runs its ownership table over a page break REPRINTS the
			// column header on the new page and states the heading only once, above
			// the first page. `header` is collected between the anchor and the block,
			// and the anchor that reaches a continuation block starts BELOW that
			// reprinted header, so the block's own column header -- the thing that
			// says "Amount and Nature of Beneficial Ownership / Percent of Class" --
			// is absent from `hdr` and the block reads as cueless. Read it off the
			// lines immediately above the block instead, which is where it is.
			ownHdr := hdrRowsText(hdrRows)
			textReason := func(why string) {
				if textBlockReasons != nil {
					textBlockReasons[why]++
				}
				// DEF14A_DEBUG_TEXTBLOCK dumps the rejected block verbatim, so a reason
				// name can be turned into the layout that produced it without
				// re-deriving the block boundaries by hand.
				if os.Getenv("DEF14A_DEBUG_TEXTBLOCK") != "" {
					fmt.Fprintf(os.Stderr, "--- textblock reject=%s hdr=%q own=%q\n", why, hdr, ownHdr)
					for _, ln := range block {
						fmt.Fprintf(os.Stderr, "    | %s\n", clean[ln])
					}
				}
			}
			// Same guard as the DOM path: the block itself, not the heading above
			// it, must read as an ownership table. Without this the scan runs on
			// into the Summary Compensation Table.
			// The header read DOWN its columns as well as across its lines: a
			// stacked ASCII header spells its column labels vertically and the
			// row-wise flattening interleaves them into nonsense.
			colHdr := hdrColumnText(header)
			body := hdr + " " + ownHdr + " " + colHdr + " " +
				strings.Join(sliceLines(clean, block), " ")
			switch {
			case !reOwnCue.MatchString(body):
				textReason("no_own_cue")
				continue
			case reCompCue.MatchString(reSCTReference.ReplaceAllString(textCompCueText(clean, header, block, body), " ")):
				textReason("comp_cue")
				continue
			case reOptDetailCue.MatchString(body):
				textReason("opt_detail_cue")
				continue
			}
			if textMoneyBlock(clean, block) {
				textReason("money_block")
				continue
			}
			classes := classLabelsFromHeader(hdr)
			// A fund-family proxy in ASCII writes the fund and the share class on
			// LABEL LINES of their own between the holder rows, indented to show
			// which contains which. Those lines carry no number so they are not
			// block rows at all and the identity was simply lost.
			stickyAt := textStickyLabels(clean, block)
			tailAt := textNameTails(clean, block)
			var rows []Row
			lastHolder := ""
			// The class column's last value, forward-filled over the rows that leave
			// it blank. Local to the block, which is one fund's table.
			lastColClass := ""
			holderAt := map[int]string{}
			percentContinuations := map[int]bool{}
			priced := 0
			for _, ln := range block {
				if percentContinuations[ln] {
					continue
				}
				consumed[ln] = true
				name, rest, restStart, ok := parseTextRowAtWithZero(clean[ln], stackedHeader)
				captionClass := textStandaloneClassCaption(lines, ln)
				// A tail made only of dollar amounts is a price, never a holding or
				// a percent: "exercise price of between  $.8125-$3.00" in a
				// footnote under the table.
				if ok && textDollarOnlyTail(rest) {
					priced++
					continue
				}
				if !ok || ((stackedHeader || captionClass != "") && strings.Contains(rest, "$")) {
					continue
				}
				// An ASCII fund table puts the share CLASS in a column of its own,
				// written once and left blank on the rows that continue it. The row
				// splits at the first wide gap before a number, so the class arrives
				// glued to the front of the holder's name -- read it off the RAW
				// half, where the gap between the columns is still there.
				leadClass := ""
				if m := reLeadClassCol.FindStringSubmatch(name); m != nil {
					leadClass = norm(strings.TrimRight(m[1], ": "))
					lastColClass = leadClass
					name = strings.TrimSpace(m[2])
				} else if lastColClass != "" {
					// the column is written once and left blank under it
					leadClass = lastColClass
				}
				nm, fns := StripFootnotes(name)
				// An ASCII "Title of class" column sits inside the name half,
				// because the row splits at the first gap before a number:
				// "Warren E. Buffett     Class A     478,232(2)   35.6".
				rowClass := ""
				// A stub that is wholly a class label ("Class B Common Stock....")
				// is never split into a holder "Class B" of class "Common Stock".
				if m := reTrailClass.FindStringSubmatch(nm); m != nil && !reClassLabelLine.MatchString(strings.TrimSpace(reDotLeader.ReplaceAllString(nm, " "))) {
					rowClass = norm(m[1])
					nm = strings.TrimSpace(nm[:len(nm)-len(m[0])])
				}
				labelRow := false
				if stub := strings.TrimSpace(reDotLeader.ReplaceAllString(nm, " ")); nm == "" || reClassOnly.MatchString(nm) || reClassLabelLine.MatchString(stub) {
					// a continuation line: the second class of the holder above
					if rowClass == "" && stub != "" {
						rowClass = stub
					}
					// the label wraps: "Class B" / "Common Stock....."
					if stub != "" && ln > 0 && !strings.HasPrefix(strings.ToLower(stub), "class") {
						head, _ := StripFootnotes(strings.TrimSpace(clean[ln-1]))
						if head = strings.TrimSpace(head); reClassOnly.MatchString(head) && strings.HasPrefix(strings.ToLower(head), "class") {
							rowClass = norm(head + " " + stub)
						}
					}
					nm = lastHolder
					// A labelled class row takes its holder from the document,
					// never from whatever row this block happened to see last:
					// the holder's other rows can sit in another block.
					if stub != "" {
						labelRow = true
						head, sib, ok := holderOverClassLine(clean, ln, 0)
						switch {
						case !ok:
							continue
						case sib >= 0 && holderAt[sib] != "":
							nm = holderAt[sib]
						default:
							nm = head
						}
					}
				}
				nm = strings.TrimSpace(reDotLeader.ReplaceAllString(nm, " "))
				nm = strings.TrimSpace(nm)
				if nm == "" || !hasWords(nm, 1) || reSkipName.MatchString(nm) {
					continue
				}
				// The holder's name continues on the lines BELOW the numbers, and
				// that continuation is the only thing telling two otherwise
				// identical rows apart. Never on a group row: the group label is
				// followed by whatever prose closes the table.
				if tl := tailAt[ln]; tl != "" && !labelRow {
					if grp, _ := isGroupRow(nm); !grp {
						nm = strings.TrimSpace(nm + " " + tl)
					}
				}
				// A group row wraps: "All current executive officers and directors"
				// / " as a group (17 persons)....  356,679,528  24.7%".
				// A label row's holder is whole from holderOverClassLine.
				if labelRow {
				} else if joined, ok := joinWrappedLabel(clean, ln, nm); ok {
					nm = joined
				} else if head, ok := headNameAbove(clean, ln, nm); ok {
					nm = head
				} else if reWrapCont.MatchString(nm) && ln > 0 {
					prev := strings.TrimSpace(clean[ln-1])
					if prev != "" && !reBigNum.MatchString(prev) && len(prev) < 90 {
						nm = strings.TrimSpace(prev + " " + nm)
					}
				}
				// A name that is nothing but a postal address, with no head to
				// recover above it, carries no holder: emitting it invents one.
				// The row still counts toward the block's two-row floor.
				noHolder := isAddressLine(nm)
				if nm != "" && !noHolder && !reClassOnly.MatchString(nm) {
					lastHolder = nm
					holderAt[ln] = nm
				}
				grp, gn := isGroupRow(nm)
				// The group label can wrap FORWARD, leaving the person count on a
				// line BELOW the numbers: "All directors" / "and executive officers"
				// / "as a group (11 persons".
				if grp && gn == 0 {
					if joined, n, ok := joinForwardLabel(clean, ln, nm); ok {
						nm, gn = joined, n
					}
				}
				if stackedHeader {
					rest = textHeaderFootnotes(rest)
				}
				cells := textTokens(rest)
				if len(cells) == 1 && cells[0].pct == nil && cells[0].marker == "" {
					if stacked := stackedClassHoldings(clean, ln, restStart, rest, hdrRows); len(stacked) > 0 {
						cells = stacked
						percentContinuations[ln+1] = true
						consumed[ln+1] = true
					}
				}
				// One ASCII line is one holding unless it carries two COMPLETE
				// (shares + percent) pairs, which is what a genuine two-class row
				// looks like. Otherwise the extra percent tokens are the voting-
				// power and economic-interest columns, not another class.
				complete := 0
				for _, h := range cells {
					if h.shares != nil && (h.pct != nil || h.marker != "") {
						complete++
					}
				}
				if complete < 2 && len(cells) > 1 {
					cells = cells[:1]
				}
				n := len(cells)
				if n == 0 {
					continue
				}
				// Under a class-label row the percent of CLASS is set on the line
				// below, aligned with the holding; a percent on the row itself is
				// then a further column (aggregate voting power).
				if labelRow && n == 1 && cells[0].lo >= 0 && ln+1 < len(clean) {
					if pct, marker, ok := percentBelow(clean[ln+1], restStart+cells[0].lo, restStart+cells[0].hi); ok {
						cells[0].pct, cells[0].marker = pct, marker
						consumed[ln+1] = true
					}
				}
				// The class stated over each value column, read off the header lines
				// by POSITION. Used only when the header really distinguishes the
				// columns -- two or more different labels over this row's cells --
				// which is exactly the multi-class shape and nothing else.
				colClass := make([]string, n)
				// One holding out of SEVERAL value columns: a fund complex states one
				// FUND per share column and, with no percent anywhere, textTokens
				// keeps only the last column. The row is one holding and the header
				// says WHICH, positionally -- take the label even though there is
				// only one cell to label.
				if n == 1 && len(commaNums(rest)) > 1 && cells[0].lo >= 0 {
					colClass[0] = textColLabel(hdrRows, restStart+cells[0].lo, restStart+cells[0].hi)
				}
				if n > 1 {
					distinct := map[string]bool{}
					for k := 0; k < n; k++ {
						if cells[k].lo < 0 {
							continue
						}
						c := textColLabel(hdrRows, restStart+cells[k].lo, restStart+cells[k].hi)
						colClass[k] = c
						if c != "" {
							distinct[c] = true
						}
					}
					if len(distinct) < 2 {
						for k := range colClass {
							colClass[k] = ""
						}
					}
				}
				for k := 0; k < n; k++ {
					rw := base
					rw.TableIndex = i
					rw.RowIndex = ln
					rw.HolderName = nm
					rw.IsGroupRow = grp
					rw.GroupN = gn
					rw.noHolder = noHolder
					rw.Parser = "text_table"
					if slashParenRecovery {
						for _, m := range reASCIISlashParenNote.FindAllStringSubmatch(lines[ln], -1) {
							fns = append(fns, m[1])
						}
					}
					rw.Footnotes = strings.Join(uniq(fns), ",")
					if cells[k].shares != nil {
						vv := *cells[k].shares
						rw.Shares = &vv
					}
					if cells[k].pct != nil {
						vv := *cells[k].pct
						rw.Percent = &vv
					}
					rw.PctMarker = cells[k].marker
					switch {
					case colClass[k] != "":
						rw.ShareClass = colClass[k]
					case rowClass != "":
						rw.ShareClass = rowClass
					case n > 1 && k < len(classes):
						rw.ShareClass = classes[k]
					case len(classes) == 1:
						rw.ShareClass = classes[0]
					}
					if n == 1 && rw.ShareClass == "" && captionClass != "" {
						rw.ShareClass = captionClass
						rw.commonColumn = strings.EqualFold(captionClass, "Common Stock")
					}
					// The class column composes with the fund the block is under
					// rather than replacing it: ShareClass alone would make one
					// holder of Investor Shares of a hundred funds one key.
					rw.classHint = withSeries(stickyAt[ln], leadClass)
					if rw.Shares == nil && rw.Percent == nil && rw.PctMarker == "" {
						continue
					}
					rows = append(rows, rw)
				}
			}
			// With its price lines set aside the block can be a one-holder
			// table, held to the same test as a block of one line. The holder's
			// row states shares, never money: a loan row keeps its "$".
			if !sole && len(rows) == 1 && priced > 0 && len(block)-priced == 1 &&
				!strings.Contains(clean[rows[0].RowIndex], "$") {
				sole = soleHolderRow(clean, i, t, header, rows[0].RowIndex)
			}
			if len(rows) < 2 && !(sole && len(rows) == 1) {
				textReason("rows_lt_2")
				continue
			}
			textReason("accepted")
			blocksUsed++
			blockText := hdr + " " + strings.Join(sliceLines(clean, block), " ")
			kd := tableKind(kind, rows, blockText+" "+t)
			fund := ""
			if len(block) > 0 && seriesAt != nil {
				fund = seriesAt[block[0]]
			}
			for k := range rows {
				rows[k].TableKind = kd
				rows[k].classHint = withSeries(fund, rows[k].classHint)
			}
			for _, rw := range rows {
				if rw.noHolder {
					continue
				}
				out = append(out, rw)
			}
		}
	}
	return out, blocksSeen, blocksUsed
}

var (
	reASCIIColumnMark = regexp.MustCompile(`(?i)<(?:S|C)>`)
	reASCIISlashNote  = regexp.MustCompile(`/([0-9]{1,2})/`)
	reBioOccupation   = regexp.MustCompile(`(?i)principal\s+(?:occupation|operation)`)
	reSixtyDays       = regexp.MustCompile(`(?i)(?:60|sixty)\s+days`)
)

// SGML column markers preserve the biography/ownership boundary. Vested
// 60-day options are additive, not a replacement for the owned-share column.
func textBiographicalOwnership(raw, clean []string, base Row) ([]Row, map[int]bool, int) {
	consumed := map[int]bool{}
	var out []Row
	blocks := 0
	for start := 0; start < len(raw); start++ {
		if !strings.Contains(strings.ToUpper(raw[start]), "<TABLE>") {
			continue
		}
		end := start + 1
		for end < len(raw) && !strings.Contains(strings.ToUpper(raw[end]), "</TABLE>") {
			end++
		}
		if end == len(raw) {
			continue
		}
		marker := -1
		var spans [][]int
		for ln := start + 1; ln < end; ln++ {
			if m := reASCIIColumnMark.FindAllStringIndex(raw[ln], -1); len(m) == 7 {
				marker, spans = ln, m
				break
			}
		}
		if marker < 0 {
			continue
		}
		cell := func(l string, col int) string {
			// A right-aligned count can straddle the nominal marker by one
			// character. Never cut a token in half at a column boundary.
			boundary := func(pos int) int {
				if pos >= len(l) {
					return len(l)
				}
				for pos > 0 && l[pos] != ' ' && l[pos-1] != ' ' {
					pos--
				}
				return pos
			}
			lo, hi := boundary(spans[col][0]), len(l)
			if col+1 < len(spans) {
				hi = boundary(spans[col+1][0])
			}
			if lo >= hi {
				return ""
			}
			return strings.TrimSpace(l[lo:hi])
		}
		headers := make([]string, 7)
		for col := range headers {
			var parts []string
			for ln := start + 1; ln < marker; ln++ {
				parts = append(parts, cell(clean[ln], col))
			}
			headers[col] = norm(strings.Join(parts, " "))
		}
		hdr := norm(strings.Join(clean[start+1:marker], " "))
		if !strings.Contains(strings.ToLower(hdr), "beneficially owned") ||
			!strings.Contains(strings.ToLower(hdr), "common stock") ||
			!reBioOccupation.MatchString(headers[1]) ||
			!strings.Contains(strings.ToLower(headers[0]), "names and offices") ||
			!strings.Contains(strings.ToLower(headers[2]), "age") ||
			!strings.Contains(strings.ToLower(headers[3]), "director") ||
			!strings.Contains(strings.ToLower(headers[4]), "number") ||
			!strings.Contains(strings.ToLower(headers[4]), "shares") ||
			!strings.Contains(strings.ToLower(hdr), "vested option") ||
			!strings.Contains(strings.ToLower(headers[5]), "option") ||
			!strings.Contains(strings.ToLower(headers[5]), "shares") ||
			!strings.Contains(strings.ToLower(headers[6]), "percentage") ||
			reCompCue.MatchString(hdr) || reOptDetailCue.MatchString(hdr) {
			continue
		}
		lo, hi := start-100, end+100
		if lo < 0 {
			lo = 0
		}
		if hi > len(clean) {
			hi = len(clean)
		}
		if !reSixtyDays.MatchString(strings.Join(clean[lo:hi], " ")) {
			continue
		}
		var rows []Row
		for ln := marker + 1; ln < end; ln++ {
			name := cell(clean[ln], 0)
			ownedText := reASCIISlashNote.ReplaceAllString(cell(clean[ln], 4), "")
			optionText := reASCIISlashNote.ReplaceAllString(cell(clean[ln], 5), "")
			pctText := reASCIISlashNote.ReplaceAllString(cell(clean[ln], 6), "")
			if name == "" || strings.Contains(ownedText+optionText, "$") || !strings.Contains(pctText, "%") {
				continue
			}
			owned, ok := ParseShares(ownedText)
			if !ok || owned < 0 {
				continue
			}
			options, ok := ParseShares(optionText)
			if !ok || options < 0 {
				continue
			}
			pct, ok, _, _ := ParsePercent(pctText)
			if !ok {
				continue
			}
			// Only the collective stub wraps forward; biography continuation text
			// below a person's name is their office, not part of their identity.
			if strings.Contains(strings.ToLower(name), "directors and executive") {
				for k := ln + 1; k < end && k <= ln+3; k++ {
					tail := cell(clean[k], 0)
					if tail == "" || cell(clean[k], 4) != "" {
						break
					}
					name += " " + tail
				}
			}
			name, fns := StripFootnotes(reASCIISlashNote.ReplaceAllString(name, "($1)"))
			grp, gn := isGroupRow(name)
			total := owned + options
			r := base
			r.TableIndex, r.RowIndex = start, ln
			r.HolderName, r.ShareClass = name, "Common Stock"
			r.Shares, r.Percent = &total, &pct
			r.IsGroupRow, r.GroupN = grp, gn
			r.Footnotes, r.Parser = strings.Join(fns, ","), "text_table"
			rows = append(rows, r)
		}
		if len(rows) < 2 {
			continue
		}
		blocks++
		for ln := start; ln <= end; ln++ {
			consumed[ln] = true
		}
		for k := range rows {
			rows[k].TableKind = "management"
		}
		out = append(out, rows...)
		start = end
	}
	return out, consumed, blocks
}

func sliceLines(clean []string, idx []int) []string {
	out := make([]string, 0, len(idx))
	for _, i := range idx {
		out = append(out, clean[i])
	}
	return out
}

// parseTextRow splits "Name .... 1,234,567(1)   5.6%" into name and the numeric tail.
func parseTextRow(l string) (name, rest string, ok bool) {
	name, rest, _, ok = parseTextRowAt(l)
	return
}

func parseTextRowAt(l string) (name, rest string, restStart int, ok bool) {
	return parseTextRowAtWithZero(l, false)
}

func parseTextRowAtWithZero(l string, allowZero bool) (name, rest string, restStart int, ok bool) {
	if strings.TrimSpace(l) == "" {
		return "", "", 0, false
	}
	s := strings.TrimRight(l, " ")
	m := reTxtRow.FindStringSubmatchIndex(s)
	if m == nil {
		return "", "", 0, false
	}
	name, rest, restStart = s[m[2]:m[3]], s[m[4]:m[5]], m[4]
	if !reBigNum.MatchString(rest) && !strings.Contains(rest, "%") && !strings.Contains(rest, "*") && !(allowZero && strings.TrimSpace(rest) == "0") {
		return "", "", 0, false
	}
	// the name half must be text, not another number column
	if !hasWords(name, 1) {
		return "", "", 0, false
	}
	// A value column is NUMBERS. A footnote sentence splits at one of its own
	// wide gaps and its tail carries a grouped number -- "additional 100,000
	// common shares at a price of $0.30 per share, which" -- so it read as a
	// row, and four of them outvoted a real table in alignedRows' modal
	// alignment. Five or more words in the TAIL is prose, not columns; the
	// widest real tails seen carry two ("Director since", "President and").
	// A NATURE OF BENEFICIAL OWNERSHIP column is the exception: the shares cell
	// is followed directly by "Sole voting and investment power" or "shares
	// with shared voting power", a column of words that is still a column.
	if len(reTailWord.FindAllString(rest, -1)) >= 5 && !reNatureColumn.MatchString(rest) {
		return "", "", 0, false
	}
	return name, rest, restStart, true
}

// A shares cell (footnote markers, "shares", a share-class cell allowed)
// followed at once by the nature of the holder's power. Prose puts a verb
// between them: "26,940 shares held with sole investment".
var reNatureColumn = regexp.MustCompile(`(?i)^\s*(?:-0-|\d[\d,]*)\s*(?:(?:\(\w{1,3}\)|<F\d+>|\*+)\s*)*(?:shares?\b\s*(?:(?:\(\w{1,3}\)|<F\d+>|\*+)\s*)*)?(?:with\s+|common\s+)?(?:sole|shared)\s+(?:voting|dispositive|investment)`)

// A word in a row's numeric tail: three letters or more, so column markers and
// the odd initial do not count.
var reTailWord = regexp.MustCompile(`[A-Za-z]{3,}`)

// alignedRows keeps only the lines whose numeric tail starts at the table's
// modal column. A proxy paragraph ("There were  2,266,000,000  shares
// outstanding") parses as a row on its own but never lines up with the table.
func alignedRows(clean []string, block []int, allowZero bool) []int {
	if len(block) < 3 {
		return block
	}
	counts := map[int]int{}
	starts := map[int]int{}
	for _, ln := range block {
		_, _, st, ok := parseTextRowAtWithZero(clean[ln], allowZero)
		if !ok {
			continue
		}
		starts[ln] = st
		counts[st/4]++
	}
	bestBucket, bestN := -1, 0
	for b, n := range counts {
		if n > bestN || (n == bestN && b < bestBucket) {
			bestBucket, bestN = b, n
		}
	}
	var out []int
	for _, ln := range block {
		st, ok := starts[ln]
		if !ok {
			continue
		}
		if st/4 >= bestBucket-1 && st/4 <= bestBucket+1 {
			out = append(out, ln)
			continue
		}
		// The GROUP label wraps FORWARD -- "All Directors and Executive Officers
		// as" on the numeric line, "a group (10 persons)" on the line below --
		// so the stub is short and the first value sits to the RIGHT of the
		// modal column. Keep such a line only when the continuation below it
		// completes the label into a group row WITH a person count, which a
		// stray proxy paragraph carrying a number cannot do.
		if st/4 > bestBucket {
			if nm, _, _, ok2 := parseTextRowAtWithZero(clean[ln], allowZero); ok2 {
				if g, n := isGroupRow(nm); g {
					if _, _, joined := joinForwardLabel(clean, ln, nm); n > 0 || joined {
						out = append(out, ln)
					}
				}
			}
		}
	}
	return out
}

type pctTok struct {
	val    float64
	marker string
}

func extractPcts(rest string) []pctTok {
	var out []pctTok
	for _, m := range rePctTok.FindAllStringSubmatch(rest, -1) {
		switch {
		case m[1] != "":
			v, ok, _, _ := ParsePercent(m[1] + "%")
			if ok {
				out = append(out, pctTok{val: v})
			}
		case m[2] != "":
			out = append(out, pctTok{marker: "*"})
		case m[3] != "":
			v, ok, _, _ := ParsePercent(m[3] + "%")
			if ok {
				out = append(out, pctTok{val: v})
			}
		}
	}
	if reLessThan.MatchString(rest) {
		out = append(out, pctTok{marker: "<1%"})
	}
	return out
}

func classLabelsFromHeader(hdr string) []string {
	var out []string
	for _, m := range reHdrClass.FindAllString(hdr, -1) {
		out = append(out, norm(m))
	}
	return uniq(out)
}

// --- wrapped group labels -------------------------------------------------
//
// In an ASCII proxy the group label routinely wraps, leaving only its tail on
// the line that carries the numbers:
//
//	All directors and officers as a group (16
//	  persons, consisting of 11 officers and 5
//	  non-employee directors)                   6,152,000       1.7%
//
// parseTextRow sees the holder name "non-employee directors)", which no group
// pattern matches, so the filing scores as group_row_missing even though the
// row was read correctly.

var (
	// A name that can only be the TAIL of a wrapped label. Anchoring on this
	// is what stops a prose lead-in ending "...as a group:" from being glued
	// onto the first real 5% holder underneath it.
	reContFrag = regexp.MustCompile(`(?i)^(as\s+an?\s+group\b|as\s+group\b|and\s+|as\s+a\s+|those\s+|persons?\b|people\b|individuals?\b|above\b|including\b|consisting\b|\()`)
	// A share count, as distinct from the "(16" of a wrapped "(16 persons".
	reShareLike = regexp.MustCompile(`[0-9][0-9]{3,}|[0-9],[0-9]`)
)

func isContinuationFragment(nm string) bool {
	if nm == "" {
		return false
	}
	if reContFrag.MatchString(nm) {
		return true
	}
	if strings.Count(nm, ")") > strings.Count(nm, "(") {
		return true // "persons)", "above)" — the opening paren is a line up
	}
	r := []rune(nm)[0]
	return unicode.IsLower(r)
}

// joinWrappedLabel walks back over the contiguous non-tabular lines above ln
// and returns the shortest rejoined label that reads as a group row. It
// returns false unless the numeric row's own name is continuation-shaped AND
// the rejoined label is a group row, so it can only ever convert a fragment
// into the group row it belongs to.
func joinWrappedLabel(clean []string, ln int, nm string) (string, bool) {
	if !isContinuationFragment(nm) {
		return "", false
	}
	var pre []string
	best := ""
	for k := ln - 1; k >= 0 && len(pre) < 3; k-- {
		p := strings.TrimSpace(clean[k])
		if p == "" || len(p) > 90 || reShareLike.MatchString(p) {
			break
		}
		if _, _, ok := parseTextRow(clean[k]); ok {
			break // a table row of its own, not a wrapped label line
		}
		// the wrapped line can end in the title-of-class cell
		if m := reTrailClass.FindStringSubmatch(p); m != nil && len(p) > len(m[0]) {
			p = strings.TrimSpace(p[:len(p)-len(m[0])])
		}
		pre = append([]string{p}, pre...)
		cand := strings.TrimSpace(strings.Join(append(append([]string{}, pre...), nm), " "))
		g, n := isGroupRow(cand)
		if !g {
			continue
		}
		if best == "" {
			best = cand // shortest join that reads as the group row
		}
		if n > 0 {
			return cand, true // keep walking only until the person count is in
		}
	}
	if best == "" {
		return "", false
	}
	return best, true
}

// joinForwardLabel walks FORWARD over the contiguous non-tabular lines below a
// group row and returns the label with its continuation appended, plus the
// person count once one appears:
//
//	All directors                        775,973      10.80%
//	and executive officers
//	as a group (11 persons
//	including those named above)
//
// It fires only on a row already read as a group row, and stops at the first
// line that is a table row of its own, so it can never reach a real holder.
func joinForwardLabel(clean []string, ln int, nm string) (string, int, bool) {
	parts := []string{nm}
	for k := ln + 1; k < len(clean) && k <= ln+5; k++ {
		p := strings.TrimSpace(clean[k])
		if p == "" || len(p) > 90 || reShareLike.MatchString(p) || isAddressLine(p) {
			break
		}
		if _, _, ok := parseTextRow(clean[k]); ok {
			break
		}
		if reHdrLineCue.MatchString(p) || reSkipName.MatchString(p) {
			break
		}
		parts = append(parts, p)
		joined := strings.TrimSpace(strings.Join(parts, " "))
		if g, n := isGroupRow(joined); g && n > 0 {
			return joined, n, true
		}
	}
	return "", 0, false
}

// --- name-and-address blocks ---------------------------------------------
//
// The 5% holder table of an ASCII proxy puts the holder on the first line of a
// "Name and Address" cell and the numbers on the LAST line of it:
//
//	FMR Corp.(/2/)
//	82 Devonshire Street
//	Boston, Massachusetts 02109                  14,608,499      11.14%
//
// parseTextRow reads the holder as "Boston, Massachusetts 02109", which matches
// no gold name, so the row is a false positive AND the real holder is a recall
// miss. The same shape appears when only a corporate suffix wraps
// ("Mellon Financial" / "Corporation.....1,339,369  8.8%").

var (
	// A line that can only be part of a postal address, never a holder name.
	// The street word must END the line, so "100 Fifth Avenue Associates" —
	// a real holder — is not read as an address.
	reStreetLine = regexp.MustCompile(`(?i)^(\d{1,6}[a-z]?|one|two|three|four|five|six|seven|eight|nine|ten)\s+\S.*\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|place|pl|plaza|way|parkway|pkwy|highway|hwy|circle|court|ct|square|sq|building|bldg|tower|center|centre|floor|fl|broadway|park|row|terrace|walk|wharf)\b\.?,?$`)
	reBoxLine    = regexp.MustCompile(`(?i)^(p\.?\s*o\.?\s+box\b|post\s+office\s+box\b|c/o\b|suite\s+\d|\d+(st|nd|rd|th)\s+floor\b)`)
	reCityZip    = regexp.MustCompile(`^[A-Za-z][A-Za-z.\-' ]{1,40},\s+([A-Z]{2}|[A-Z][a-z]+(\s+[A-Z][a-z]+)?)\.?\s+\d{5}(-\d{4})?$`)
	// "Greenwich, Connecticut" / "Boston, MA" — the same city line with the ZIP
	// left off. A two-letter abbreviation that is also an English word ("Co",
	// "In", "Or") is excluded: "Capital Research and Management Co" is a
	// holder, not a city.
	reCityState = regexp.MustCompile(`^[A-Z][A-Za-z.\-' ]{1,40},\s+(?:Alabama|Alaska|Arizona|Arkansas|California|` +
		`Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|` +
		`Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|` +
		`Nevada|New\s+Hampshire|New\s+Jersey|New\s+Mexico|New\s+York|North\s+Carolina|North\s+Dakota|Ohio|` +
		`Oklahoma|Oregon|Pennsylvania|Rhode\s+Island|South\s+Carolina|South\s+Dakota|Tennessee|Texas|Utah|` +
		`Vermont|Virginia|Washington|West\s+Virginia|Wisconsin|Wyoming|` +
		`A[LKZR]|C[AT]|DC|FL|GA|HI|I[AL]|K[SY]|M[ADINOST]|N[CDHJMVY]|O[HK]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])\.?$`)
	// A city/state/ZIP with a second address glued on: "Kirkland, WA 98033 &
	// One Microsoft Way". Still nothing but address.
	reCityZipIn = regexp.MustCompile(`^[A-Z][A-Za-z.\-' ]{1,40},\s+[A-Z][A-Za-z ]{1,20}\s+\d{5}(-\d{4})?\b`)
	// A bare corporate suffix: all that is left of a name whose head wrapped.
	reBareSuffix = regexp.MustCompile(`(?i)^[\(,]?\s*(inc|inc\.|corp|corp\.|corporation|incorporated|company|co|co\.|l\.?\s?p\.?|llc|l\.l\.c\.|llp|ltd|ltd\.|limited|n\.?\s?a\.?|trust|plc|s\.a\.|n\.v\.|a\.g\.|partners|holdings|associates|management)\s*[\.,]?\s*\)?$`)
	// "- --------------------" separator rules between holders.
	reRuleLine = regexp.MustCompile(`^[-=_\s\.\*]+$`)
	// A line INSIDE a name-and-address cell that opens with a street number:
	// "2365 Carillion Point", "6410 Poplar Avenue, Suite 900". Used only on the
	// walk-back, where the numeric row has already been read as an address, so
	// a holder actually named "100 Fifth Avenue Associates" is never touched.
	reNumLedLine = regexp.MustCompile(`^\d{1,6}[A-Za-z]?\s+[A-Za-z]`)
)

func isAddressLine(s string) bool {
	s = strings.TrimSpace(s)
	return reStreetLine.MatchString(s) || reBoxLine.MatchString(s) || reCityZip.MatchString(s) ||
		reCityState.MatchString(s) || reCityZipIn.MatchString(s)
}

// holderOverClassLine resolves the holder of a row whose stub is only a class
// label, from the document. Between the row and its holder's cell it passes
// over blank lines (an SGML <S> line cleans to blank), the wrapped head of the
// label ("Class B" / "Common Stock....") and the previous holding's percent
// line. A numeric row met there is a sibling holding one class up: its holder
// is this row's holder, and its line is returned so the caller can reuse the
// name it already gave that row. Otherwise the cell runs up to a blank, a
// numeric row, a rule or a line indented right of the label (a section heading
// centred over the table); the holder is the top line of the cell plus the
// lines that continue it, up to the first address line.
// columnarHdrLine reports a column-header line: a header cue on a line laid
// out in columns (or short enough to be one cell). A justified sentence, such
// as a footnote under a table, also says "shares" but is not one.
func columnarHdrLine(lt string) bool {
	return reHdrLineCue.MatchString(lt) && (reWideGap.MatchString(lt) || len(lt) <= 40)
}

func holderOverClassLine(clean []string, ln, depth int) (string, int, bool) {
	if depth > 4 {
		return "", -1, false
	}
	indent := len(clean[ln]) - len(strings.TrimLeft(clean[ln], " "))
	var cell []string
	for k, steps := ln-1, 0; k >= 0 && steps < 8; k, steps = k-1, steps+1 {
		p := strings.TrimRight(clean[k], " ")
		t := strings.TrimSpace(p)
		u, _ := StripFootnotes(t)
		u = strings.TrimSpace(reDotLeader.ReplaceAllString(u, " "))
		if len(cell) == 0 {
			if t == "" || reClassOnly.MatchString(u) || reClassLabelLine.MatchString(u) || reContinuationLine.MatchString(t) {
				continue
			}
			if stub, _, ok := parseTextRow(p); ok {
				stub, _ = StripFootnotes(stub)
				stub = strings.TrimSpace(reDotLeader.ReplaceAllString(stub, " "))
				if m := reTrailClass.FindStringSubmatch(stub); m != nil {
					stub = strings.TrimSpace(stub[:len(stub)-len(m[0])])
				}
				if stub == "" || reClassOnly.MatchString(stub) || reClassLabelLine.MatchString(stub) {
					nm, _, ok := holderOverClassLine(clean, k, depth+1)
					return nm, k, ok
				}
				// "Holder   Common Stock--2,746,642": the stub carries the
				// holding itself, so it is no clean name to inherit.
				if reShareLike.MatchString(stub) {
					return "", k, false
				}
				return norm(stub), k, true
			}
		}
		if t == "" || len(p)-len(strings.TrimLeft(p, " ")) > indent || len(t) > 90 || reRuleLine.MatchString(t) ||
			reContinuationLine.MatchString(t) || reClassOnly.MatchString(u) || reClassLabelLine.MatchString(u) {
			break
		}
		if _, _, ok := parseTextRow(p); ok {
			break
		}
		// The name line can end in the title-of-class cell: "Andre..... Common Stock".
		g := reDotLeader.ReplaceAllString(t, " ")
		if m := reTrailClass.FindStringSubmatch(u); m != nil && len(u) > len(m[0]) {
			u = strings.TrimSpace(u[:len(u)-len(m[0])])
		}
		if m := reTrailClass.FindStringSubmatch(g); m != nil && len(g) > len(m[0]) {
			g = strings.TrimSpace(g[:len(g)-len(m[0])])
		}
		// A name cell is one column; a line of several is the column header.
		if (!hasWords(u, 1) && !reZipOnly.MatchString(u)) || reSkipName.MatchString(u) || reHdrLineCue.MatchString(u) || reWideGap.MatchString(g) {
			break
		}
		cell = append([]string{u}, cell...)
		if len(cell) == 6 {
			break
		}
	}
	var name []string
	for _, c := range cell {
		if isAddressLine(c) || reNumLedLine.MatchString(c) || reZipOnly.MatchString(c) || reShareLike.MatchString(c) || len(name) == 3 {
			break
		}
		name = append(name, c)
	}
	if len(name) == 0 {
		return "", -1, false
	}
	return norm(strings.Join(name, " ")), -1, true
}

var (
	// reContinuationLine is a line holding nothing but the previous row's
	// percent and footnote marks: "*   61.9%", "(73.8%)", "(6)(7)   9.6%".
	reContinuationLine = regexp.MustCompile(`^(?:\s*(?:\*|\(?[0-9]{0,3}(?:\.[0-9]+)?\s*%\)?|(?:\([0-9a-z]{1,3}\))+))+\s*$`)
	reZipOnly          = regexp.MustCompile(`^[0-9]{5}(?:-[0-9]{4})?$`)
	reWideGap          = regexp.MustCompile(`\S\s{3,}\S`)
)

// percentBelow reads the one percent token of a line made of nothing but
// percent tokens ("*", "61.9%", "(73.8%)") that overlaps the column span
// [lo, hi).
var reFootnoteOnlyTok = regexp.MustCompile(`^(?:\([0-9a-z]{1,3}\))+$`)

var rePctOnlyTok = regexp.MustCompile(`^(?:\*|\(?[0-9]{1,3}(?:\.[0-9]+)?\s*%\)?)$`)

func percentBelow(line string, lo, hi int) (*float64, string, bool) {
	var pick string
	hits := 0
	for _, f := range regexp.MustCompile(`\S+`).FindAllStringIndex(line, -1) {
		tok := line[f[0]:f[1]]
		if reFootnoteOnlyTok.MatchString(tok) {
			continue
		}
		if !rePctOnlyTok.MatchString(tok) {
			return nil, "", false
		}
		if f[0] < hi && f[1] > lo {
			pick = tok
			hits++
		}
	}
	if hits != 1 {
		return nil, "", false
	}
	if pick == "*" {
		return nil, "*", true
	}
	v, ok, mk, _ := ParsePercent(strings.Trim(pick, "()"))
	if !ok {
		return nil, "", false
	}
	return &v, mk, true
}

// headNameAbove walks back from the numeric row at ln over the address and
// bare-suffix lines of the same table cell and returns the holder name at the
// head of that cell, with the address lines dropped. It fires only when the
// numeric row's own name is itself an address line or a bare corporate suffix,
// which is what keeps a heading or a prose lead-in from being glued onto the
// first real holder beneath it.
func headNameAbove(clean []string, ln int, nm string) (string, bool) {
	addr, suffix := isAddressLine(nm), reBareSuffix.MatchString(nm)
	if !addr && !suffix {
		return "", false
	}
	if g, _ := isGroupRow(nm); g {
		return "", false
	}
	// Lines of the cell that are part of the NAME, in document order. The
	// numeric row's own fragment joins them only when it is a wrapped suffix;
	// an address line is dropped outright.
	var name []string
	if suffix {
		name = []string{nm}
	}
	nameLines := 0
	for k, steps := ln-1, 0; k >= 0 && steps < 6; k, steps = k-1, steps+1 {
		p := strings.TrimSpace(clean[k])
		if p == "" || len(p) > 90 || reRuleLine.MatchString(p) {
			break
		}
		if _, _, ok := parseTextRow(clean[k]); ok {
			break // the previous holder's own numeric row
		}
		p = strings.TrimSpace(reDotLeader.ReplaceAllString(p, " "))
		p, _ = StripFootnotes(p)
		p = strings.TrimSpace(p)
		if p == "" {
			break
		}
		if isAddressLine(p) || reNumLedLine.MatchString(p) {
			continue // an address line is never part of the name
		}
		// A share-shaped number outside an address line means this is not a
		// wrapped name cell at all.
		if reShareLike.MatchString(p) {
			break
		}
		// A column header, a skip word or a line with no word in it ends the
		// cell: this is what keeps a heading or a prose lead-in from being
		// glued onto the first real holder beneath it.
		if !hasWords(p, 1) || reSkipName.MatchString(p) || reHdrLineCue.MatchString(p) {
			break
		}
		name = append([]string{p}, name...)
		if !reBareSuffix.MatchString(p) {
			nameLines++
		}
		if nameLines >= 3 {
			break // a holder name does not run past three lines
		}
	}
	if nameLines == 0 {
		return "", false
	}
	return strings.TrimSpace(strings.Join(name, " ")), true
}

// textSeriesReach bounds how far a fund label carries, in ASCII lines: a fund's
// holder table sits directly under its name and its bullet list.
const textSeriesReach = 60

// textSeriesLabels records, for every line, the fund / series the most recent
// standalone label line named. nil when the filing declares fewer than two
// series, which is every operating company.
func textSeriesLabels(clean []string, series []string) []string {
	set := SeriesSet(series)
	if set == nil {
		return nil
	}
	out := make([]string, len(clean))
	cur, at := "", 0
	for i, l := range clean {
		t := strings.TrimSpace(l)
		if len(t) >= 6 && len(t) <= 120 {
			if v := MatchSeries(set, t); v != "" {
				cur, at = v, i
			}
		}
		if cur != "" && i-at <= textSeriesReach {
			out[i] = cur
		}
	}
	return out
}

// reTextStickyLabel matches an ASCII LABEL LINE: a line naming a share class,
// a fund or a portfolio and nothing else. Such a line carries no number, so it
// is never a holder row; it says which class or fund the rows under it belong
// to. Anchored on the trailing noun so a prose sentence cannot match.
// A share CLASS written in a column of its own at the head of an ASCII row,
// separated from the holder name by the gap between the columns.
var reLeadClassCol = regexp.MustCompile(`(?i)^((?:[A-Z][\w.&/-]*\s+){0,3}(?:shares|class\s+[a-z0-9]+|series\s+[a-z0-9]+))\s*:\s{2,}(\S.*)$`)

var reTextStickyLabel = regexp.MustCompile(`(?i)^[A-Z0-9][\w.,'&()/ -]{0,58}?\b(?:class|classes|shares|portfolio|fund|series|trust)\s*:?$`)
var reTextStickyProse = regexp.MustCompile(`(?i)\b(?:was|were|is|are|be)\s+(?:deemed|known)\b`)

func textStickyLabel(t string) bool {
	if !reTextStickyLabel.MatchString(t) || reTextStickyProse.MatchString(t) {
		return false
	}
	// Two header columns flattened into one line can end in "shares".
	// Their column gap and independent header cues distinguish them from a label.
	groups := splitHdrGroups(t)
	headerColumns := 0
	for _, g := range groups {
		if reHdrLineCue.MatchString(g.text) {
			headerColumns++
		}
	}
	return headerColumns < 2
}

// textStickyLabels maps every line of a block to the label in force at it. A
// label written at a SMALLER indent contains the ones written further in, so a
// fund line resets the class line under it and the two compose. Returns nil when
// no label line is found, which is every ordinary proxy.
func textStickyLabels(clean []string, block []int) map[int]string {
	if len(block) == 0 {
		return nil
	}
	lo, hi := block[0], block[len(block)-1]
	// Look above the first row: the label sits over it, and in a fund proxy that
	// breaks its per-class pages there can be a page footer, a page number and a
	// repeated column header in between. The scan stops at the previous TABLE
	// ROW, which is the end of the block before this one, so a label can never
	// be taken from above another table's rows.
	stop := lo - 40
	if stop < 0 {
		stop = 0
	}
	for lo--; lo > stop; lo-- {
		if _, _, ok := parseTextRow(clean[lo]); ok {
			break
		}
	}
	if lo < 0 {
		lo = 0
	}
	byIndent := map[int]string{}
	var indents []int
	out := map[int]string{}
	found := false
	for ln := lo; ln <= hi && ln < len(clean); ln++ {
		t := strings.TrimSpace(clean[ln])
		if t != "" && !reTextValueish.MatchString(t) && textStickyLabel(t) {
			ind := len(clean[ln]) - len(strings.TrimLeft(clean[ln], " "))
			var keep []int
			for _, k := range indents {
				if k < ind {
					keep = append(keep, k)
				} else {
					delete(byIndent, k)
				}
			}
			byIndent[ind] = strings.TrimRight(t, ":")
			indents = append(keep, ind)
			found = true
			continue
		}
		if len(indents) == 0 {
			continue
		}
		parts := make([]string, 0, len(indents))
		for _, k := range indents {
			parts = append(parts, byIndent[k])
		}
		out[ln] = strings.Join(parts, " | ")
	}
	if !found {
		return nil
	}
	// The ENCLOSING label may be further up than the window above: a fund proxy
	// writes the fund once at indent 0 and then runs its share classes over
	// several pages, each of which is a block of its own. Walk up for a label
	// written at a SHALLOWER indent than anything this block found, and prefix
	// it. Only a shallower indent is accepted, so a sibling label of the same
	// rank can never be borrowed.
	minInd := -1
	for _, k := range indents {
		if minInd < 0 || k < minInd {
			minInd = k
		}
	}
	if minInd > 0 {
		for ln := lo - 1; ln >= 0 && ln > lo-200; ln-- {
			t := strings.TrimSpace(clean[ln])
			if t == "" || reTextValueish.MatchString(t) || !textStickyLabel(t) {
				continue
			}
			if ind := len(clean[ln]) - len(strings.TrimLeft(clean[ln], " ")); ind < minInd {
				enc := strings.TrimRight(t, ":")
				for k, v := range out {
					out[k] = enc + " | " + v
				}
				break
			}
		}
	}
	return out
}

// A label line may carry a YEAR — every target-date fund is named for one
// ("LIVESTRONG 2015 Portfolio") — so only a line that carries a VALUE is
// excluded: a percent, a comma-grouped number or a decimal.
var reTextValueish = regexp.MustCompile(`%|\d{1,3}(?:,\d{3})+|\d+\.\d`)

// --- positional column labels --------------------------------------------
//
// An ASCII proxy states each class over its OWN (shares, percent) column pair,
// on caption lines above the dashed rule:
//
//	                  BENEFICIAL OWNERSHIP OF         BENEFICIAL OWNERSHIP OF
//	                  CLASS A COMMON STOCK(1)           CLASS B COMMON STOCK
//	                 --------------------------     ----------------------------  PERCENTAGE
//	                   NUMBER         PERCENT         NUMBER           PERCENT    OF COMBINED
//	                 OF SHARES      OF CLASS(2)      OF SHARES       OF CLASS(3)  VOTING POWER
//	Bradley Currey..  3,510,616(5)     13.64%        2,766,180(6)       23.56%      20.23%
//
// The class belongs to the COLUMN, not to a position in a list of class tokens
// found anywhere in the header, and the class line itself carries none of the
// "percent / shares / beneficial / amount" cues that collect a header line — so
// every holding of a holder came out with one share_class and the rows collapsed
// onto one grain key.

type hdrGroup struct {
	lo, hi int
	text   string
}

var (
	// A label that distinguishes one value column from another: a class or
	// series, or the combined / total / voting-power column a multi-class table
	// adds beside them.
	reColLabelKeep = regexp.MustCompile(`(?i)\bclass\s+[a-d0-9]\b|\bcommon\s+stock\b|\bpreferred\b|\bordinary\s+shares\b|\bseries\s+[a-z0-9]+\b|\bvoting\s+power\b|\bcombined\b|\btotal\b|\bdepositary\b|\bunits?\b|\bfund\b|\btrust\b|\bportfolio\b`)
	// Header text that is only the shape of the column, never its identity.
	reColLabelDrop = regexp.MustCompile(`(?i)^(?:(?:no\.?\s+of\s+shares\s*)+|number|percent|percentage|amount|shares?(?:\s+of)?|no\.?(?:\s+of\s+shares)?|of\s+shares|of\s+class|beneficially|owned|%)[\s.():0-9]*$`)
	// A WHOLE HEADER ROW, not a column label. An ASCII proxy routinely writes its
	// headings as one wide group spanning every value column ("Number of Shares
	// of Common Stock Beneficially Owned Percent"), which reColLabelDrop cannot
	// catch because the shape words are not the whole of it and reColLabelKeep
	// then admits it on the "Common Stock" inside it. Such a group identifies the
	// SECURITY, or the table, never one column among several. A fund or class
	// label never states the shape of the column it stands over.
	// Counted, not matched once: TWO OR MORE distinct shape words in one group is
	// a header row ("Options (a) Warrants (b) Total (c)", "Number of Shares of
	// Common Stock Beneficially Owned Percent"). A class or fund label states an
	// identity and carries at most one of these ("Total Return Fund").
	reColLabelShapeWord = regexp.MustCompile(`(?i)\bshares?\b|\boptions?\b|\bwarrants?\b|\btotal\b|` +
		`\bpercent(?:age)?\b|\bnumber\b|\bamount\b|\bsubject\s+to\b|exercisab|beneficially|\bowned\b`)
	// A preposition left at the head of a label whose first words were the
	// dropped shape word on the line above.
	reColLabelLead = regexp.MustCompile(`(?i)^(?:of|in|and|the)\s+`)
)

// textHeaderRows returns the header lines above a block, top to bottom, split
// into whitespace-separated column groups with their character spans.
func textHeaderRows(clean []string, first int) [][]hdrGroup {
	lines := textHeaderLines(clean, first)
	var out [][]hdrGroup
	for i := len(lines) - 1; i >= 0; i-- {
		if g := splitHdrGroups(clean[lines[i]]); len(g) > 0 {
			out = append(out, g)
		}
	}
	return out
}

// textHeaderLines returns the line numbers of the header above a block, bottom
// to top.
func textHeaderLines(clean []string, first int) []int {
	var lines []int
	blanks := 0
	for ln := first - 1; ln >= 0 && first-ln <= 12; ln-- {
		t := strings.TrimSpace(clean[ln])
		if t == "" {
			blanks++
			if blanks >= 2 {
				break
			}
			continue
		}
		blanks = 0
		if _, _, ok := parseTextRow(clean[ln]); ok {
			break // the previous block's last row: not this block's header
		}
		if reRuleLine.MatchString(t) {
			lines = append(lines, ln)
			continue
		}
		// Prose runs edge to edge with no interior column gap; a header line is
		// columns, so it must have one (or be short enough to be a caption).
		if !strings.Contains(t, "  ") && len(t) > 40 {
			break
		}
		if reTextValueish.MatchString(t) && !reRuleLine.MatchString(t) {
			break // a numeric line above the block is data, not a header
		}
		lines = append(lines, ln)
	}
	return lines
}

// textProseLine reports a justified sentence: long, and with no column gap of
// three or more spaces. Justification and a sentence break leave double spaces,
// so two is not a column gap.
func textProseLine(l string) bool {
	// A footnote's marker is set off from its sentence by a wide gap.
	t := reLeadNoteMarker.ReplaceAllString(strings.TrimSpace(l), "")
	return len(t) > 40 && !reWideGap.MatchString(t)
}

var reLeadNoteMarker = regexp.MustCompile(`^(?:\(\w{1,2}\)|\*+)\s+`)

// textCompCueText is the text the compensation screen reads. When the table's
// own column header reads as ownership, every prose sentence is dropped from
// it: an ownership table mentions salary or option grants only in a lead-in or
// footnote sentence ("does not include stock options granted under the ...
// Plan"). Otherwise the whole body is read, since a remuneration table may name
// its subject only in the sentence above it.
func textCompCueText(clean, header []string, block []int, body string) string {
	var keep []string
	for _, l := range header {
		if !textProseLine(l) {
			keep = append(keep, l)
		}
	}
	if len(block) > 0 {
		hl := textHeaderLines(clean, block[0]) // bottom to top
		for i := len(hl) - 1; i >= 0; i-- {
			if !textProseLine(clean[hl[i]]) {
				keep = append(keep, clean[hl[i]])
			}
		}
	}
	hdr := strings.Join(keep, " ")
	if !reOwnCue.MatchString(hdr) {
		return body
	}
	parts := []string{hdr, hdrColumnText(keep)}
	tabular := false
	for _, ln := range block {
		if !textProseLine(clean[ln]) {
			parts = append(parts, clean[ln])
			tabular = true
		}
	}
	if !tabular {
		return body // a block of sentences is no table, whatever stands above it
	}
	return strings.Join(parts, " ")
}

// stubCellCont reports whether line ln is the STUB CELL of the block's table
// continuing below its own numeric line, rather than prose that ends the table.
// A proxy whose stub column is "Name and Principal Occupation for the Past Five
// Years" writes a biography of up to seven lines under every holder, and the
// six-line prose run ends the block after the first one. The test is the ASCII
// table's own geometry: a continuation is INDENTED past the stub's left edge
// and ENDS before the value columns begin, where a paragraph closing the table
// runs out to the full measure.
func stubCellCont(clean []string, first, ln int) bool {
	_, _, restStart, ok := parseTextRowAt(clean[first])
	if !ok || restStart < 12 {
		return false
	}
	nameStart := len(clean[first]) - len(strings.TrimLeft(clean[first], " "))
	l := strings.TrimRight(clean[ln], " ")
	indent := len(l) - len(strings.TrimLeft(l, " "))
	return indent > nameStart && len(l) < restStart
}

// headerLineSet is the block's own column-header lines, normalised to
// whitespace-collapsed text, for recognising the same header reprinted on the
// next page. Rule lines are excluded: a row of dashes appears under every table
// in the document and identifies none of them.
func headerLineSet(clean []string, first int) map[string]bool {
	out := map[string]bool{}
	for _, r := range textHeaderRows(clean, first) {
		var parts []string
		for _, g := range r {
			parts = append(parts, g.text)
		}
		t := strings.TrimSpace(strings.Join(parts, " "))
		if len(t) < 20 || reRuleLine.MatchString(t) || !hasWords(t, 3) {
			continue
		}
		out[t] = true
	}
	return out
}

// reprintedHeaderAt looks forward from a would-be end of block for the SAME
// column header printed again, which is how an ASCII proxy carries one table
// over a page break. It returns the line index of the reprint, so the scan can
// resume below it, or -1. Nothing but an exact repeat of a header line this
// block already has will do: a different table's header is a different table.
func reprintedHeaderAt(clean []string, from, limit int, want map[string]bool) int {
	if len(want) == 0 {
		return -1
	}
	stop := from + 25
	if stop > limit {
		stop = limit
	}
	for k := from; k < stop; k++ {
		var parts []string
		for _, g := range splitHdrGroups(clean[k]) {
			parts = append(parts, g.text)
		}
		if want[strings.TrimSpace(strings.Join(parts, " "))] {
			return k
		}
	}
	return -1
}

// hdrColumnText reads a stacked ASCII column header DOWN each column instead
// of across each line. "PERCENTAGE" over "OF SHARES" over "OUTSTANDING" is one
// column label; flattened row by row it interleaves with its neighbours
// ("PERCENTAGE OCCUPATION AND NUMBER OF SHARES ... OUTSTANDING") and no
// ownership phrase survives for the cue test to match. Each column of the
// BOTTOM header line collects the groups above it whose character spans
// overlap it.
func hdrColumnText(lines []string) string {
	var rows [][]hdrGroup
	for _, l := range lines {
		if g := splitHdrGroups(l); len(g) > 0 {
			rows = append(rows, g)
		}
	}
	if len(rows) < 2 {
		return ""
	}
	last := rows[len(rows)-1]
	var out []string
	for _, g := range last {
		var parts []string
		for _, r := range rows[:len(rows)-1] {
			for _, h := range r {
				if h.lo < g.hi && g.lo < h.hi {
					parts = append(parts, strings.TrimSpace(h.text))
				}
			}
		}
		if len(parts) == 0 {
			continue
		}
		parts = append(parts, strings.TrimSpace(g.text))
		out = append(out, strings.Join(parts, " "))
	}
	return strings.Join(out, " | ")
}

// hdrRowsText flattens the block's own header lines back into one string, so
// the cue tests can read what the columns say about themselves.
func hdrRowsText(rows [][]hdrGroup) string {
	var parts []string
	for _, r := range rows {
		for _, g := range r {
			if t := strings.TrimSpace(g.text); t != "" {
				parts = append(parts, t)
			}
		}
	}
	return strings.Join(parts, " ")
}

// splitHdrGroups cuts a header line at every run of two or more spaces.
func splitHdrGroups(l string) []hdrGroup {
	var out []hdrGroup
	i := 0
	for i < len(l) {
		if l[i] == ' ' {
			i++
			continue
		}
		j := i
		for j < len(l) {
			if l[j] == ' ' && j+1 < len(l) && l[j+1] == ' ' {
				break
			}
			if l[j] == ' ' && j+1 >= len(l) {
				break
			}
			j++
		}
		t := strings.TrimSpace(l[i:j])
		if t != "" {
			out = append(out, hdrGroup{lo: i, hi: j, text: t})
		}
		i = j
	}
	return out
}

// textColLabel reads the class stated over the column span [lo,hi) off the
// header lines, keeping only the groups that identify the column rather than
// describe its shape. Returns "" when the header states nothing positional.
func textColLabel(hdr [][]hdrGroup, lo, hi int) string {
	if lo < 0 || len(hdr) == 0 {
		return ""
	}
	// The label is assembled from EVERY group over the column, top to bottom,
	// because it routinely wraps across the header lines ("Putnam Investment" /
	// "Grade Municipal" / "Trust") and names the fund only as a whole. Groups
	// that state the column's SHAPE rather than its identity are dropped, and
	// the assembled label must itself read as a class or fund -- that test is
	// what stops an ordinary column header from becoming one.
	var all []string
	for _, line := range hdr {
		// The value column is RIGHT-aligned and its header sits over it but
		// need not overlap it, so a group one or two characters short of the
		// column still labels it. Overlap wins; nearness is the tie-break.
		best, bestOv, bestGap := -1, 0, 1<<30
		for k, g := range line {
			ov := min(g.hi, hi) - max(g.lo, lo)
			gap := max(g.lo-hi, lo-g.hi)
			switch {
			case ov > bestOv:
				best, bestOv, bestGap = k, ov, 0
			case bestOv == 0 && gap >= 0 && gap <= 4 && gap < bestGap:
				best, bestGap = k, gap
			}
		}
		if best < 0 {
			continue
		}
		t := line[best].text
		if reRuleLine.MatchString(t) || reColLabelDrop.MatchString(t) {
			continue
		}
		if isHeaderRowText(t) {
			continue // a whole header row, spanning every value column
		}
		all = append(all, t)
	}
	parts := all
	if len(parts) == 0 || !reColLabelKeep.MatchString(strings.Join(parts, " ")) {
		return ""
	}
	// The label wraps mid-phrase ("PERCENTAGE" / "OF COMBINED" / "VOTING
	// POWER"), and the shape word above it was dropped, so a kept part can open
	// with the preposition that joined it to the line above.
	lbl := strings.Join(parts, " ")
	lbl = reColLabelLead.ReplaceAllString(lbl, "")
	return norm(cleanClassLabel(lbl))
}

// A trustee's holding in a fund family is disclosed as a DOLLAR RANGE, not a
// share count ("Dollar Range of Shares Owned in the Funds", "$10,001 -
// $50,000"), with one line per fund under the trustee's name. The tail parses as
// a share count of 50,000 and the FUND becomes the holder. The values are money
// and the block is not an ownership table at all.
var reMoneyTail = regexp.MustCompile(`\$\s*[0-9]`)

// A PERCENT anywhere in the block vetoes the veto: a real ownership table that
// happens to price something in dollars still reports a percent of class, and
// the per-year yield floor counts filings with a parsed percent. Only a block
// that is money and nothing but money is dropped.
func textMoneyBlock(clean []string, block []int) bool {
	money, rows := 0, 0
	for _, ln := range block {
		_, rest, ok := parseTextRow(clean[ln])
		if !ok {
			continue
		}
		rows++
		if strings.Contains(rest, "%") {
			return false
		}
		// A bare decimal percent is a percent of class just as "%" is. An
		// ownership table with a "face value of debentures" column in dollars
		// beside its share counts writes its percents as 1.4 and 4.5 with no
		// sign, and reading the block as money threw the table away. The
		// less-than-1% MARKER does NOT count: a fund dollar-range table marks
		// its rows "$0*" and "over $100,000*", and accepting those is the
		// defect the exclusion clauses X2 and X3 exist to describe.
		for _, h := range textTokens(rest) {
			if h.pct != nil {
				return false
			}
		}
		if reMoneyTail.MatchString(rest) {
			money++
		}
	}
	return rows > 0 && money*2 >= rows
}

// textNameTails returns, for each block row, the continuation of its holder NAME
// written on the lines BELOW the numbers. A fund complex's record-holder exhibit
// writes an omnibus account over five lines -- the intermediary, then the
// portfolio the account belongs to, then the city -- and the portfolio is the
// only thing that tells five otherwise identical rows of one fund and one class
// apart. It fires ONLY for a name that repeats inside the block, which is
// exactly when the continuation is load-bearing, and never on an ordinary table.
func textNameTails(clean []string, block []int) map[int]string {
	rowAt := map[int]bool{}
	for _, ln := range block {
		rowAt[ln] = true
	}
	names := map[string]int{}
	raw := map[int]string{}
	tail := map[int]string{}
	for i, ln := range block {
		nm, _, ok := parseTextRow(clean[ln])
		if !ok {
			continue
		}
		nm, _ = StripFootnotes(nm)
		nm = strings.TrimSpace(reDotLeader.ReplaceAllString(nm, " "))
		if nm == "" {
			continue
		}
		raw[ln] = nm
		names[nm]++
		stop := ln + 6
		if i+1 < len(block) && block[i+1] < stop {
			stop = block[i+1]
		}
		if stop > len(clean) {
			stop = len(clean)
		}
		var parts []string
		for k := ln + 1; k < stop && len(parts) < 4; k++ {
			t := strings.TrimSpace(clean[k])
			if t == "" || rowAt[k] || len(t) > 60 {
				break
			}
			if reRuleLine.MatchString(t) || isAddressLine(t) || reTextValueish.MatchString(t) {
				break
			}
			// A GROUP label under the last holder of the table is the next row's
			// name, not this holder's tail: gluing it on both invents a holder
			// and hides a group row.
			if g, _ := isGroupRow(t); g {
				break
			}
			parts = append(parts, t)
		}
		if len(parts) > 0 {
			tail[ln] = strings.Join(parts, " ")
		}
	}
	out := map[int]string{}
	for ln, t := range tail {
		if names[raw[ln]] >= 2 {
			out[ln] = t
		}
	}
	return out
}

// textBlockReasons, when non-nil, tallies why each ASCII block was accepted or
// rejected. Set by the -debug path only; nil in the pipeline.
var textBlockReasons map[string]int

// isHeaderRowText reports whether a header group is a whole header ROW rather
// than one column's label: two or more DISTINCT shape words in one group.
func isHeaderRowText(t string) bool {
	seen := map[string]bool{}
	for _, m := range reColLabelShapeWord.FindAllString(t, -1) {
		seen[strings.ToLower(m)] = true
	}
	return len(seen) >= 2
}

var reASCIIGroupedClass = regexp.MustCompile(`(?i)\bCLASS\s+([A-Z])\b`)
var reASCIIGroupedValues = regexp.MustCompile(`^(.*?)\s{2,}([0-9][0-9,]*(?:\([a-z0-9]+\))?|--)\s+([0-9][0-9,]*(?:\([a-z0-9]+\))?|--)\s+([0-9]+(?:\.[0-9]+)?%?|\*|--)\s+([0-9]+(?:\.[0-9]+)?%?|\*|--)\s+([0-9]+(?:\.[0-9]+)?%?|\*|--)\s*$`)

// Two share columns precede three percent columns; the last percent is voting
// power, not another share count. The repeated class headers lock the pairing.
func textGroupedClassColumns(body string, base Row) ([]Row, int) {
	lines := strings.Split(stripEntities(body), "\n")
	var out []Row
	blocks := 0
	for start, line := range lines {
		if !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(line)), "NAME AND ADDRESS OF") {
			continue
		}
		endHeader := start + 1
		for endHeader < len(lines) && endHeader <= start+3 && !reRuleLine.MatchString(strings.TrimSpace(lines[endHeader])) {
			endHeader++
		}
		if endHeader >= len(lines) || endHeader > start+3 {
			continue
		}
		hdr := strings.ToUpper(norm(strings.Join(lines[max(0, start-7):endHeader], " ")))
		classes := reASCIIGroupedClass.FindAllStringSubmatch(hdr, -1)
		if len(classes) != 2 || classes[0][1] != classes[1][1] || strings.Count(hdr, "COMMON") != 4 ||
			!strings.Contains(hdr, "OF BENEFICIAL") || !strings.Contains(hdr, "OWNERSHIP") || !strings.Contains(hdr, "PERCENT OF") ||
			!strings.Contains(hdr, "COMBINED") || reCompCue.MatchString(hdr) || reOptDetailCue.MatchString(hdr) || strings.ContainsAny(hdr, "$") {
			continue
		}
		class := "Class " + classes[0][1] + " Common Stock"
		var rows []Row
		pending := ""
		addressed, invalid := false, false
		for j := endHeader + 1; j < len(lines); j++ {
			raw := lines[j]
			if reRuleLine.MatchString(strings.TrimSpace(raw)) || strings.Contains(raw, "<") {
				break
			}
			if strings.Contains(raw, "$") {
				invalid = true
				break
			}
			text := reDotLeader.ReplaceAllStringFunc(raw, func(m string) string { return strings.Repeat(" ", len(m)) })
			m := reASCIIGroupedValues.FindStringSubmatch(text)
			if m == nil {
				name := norm(text)
				if name == "" {
					continue
				}
				if strings.HasPrefix(name, "(") || strings.HasPrefix(name, "*") {
					break
				}
				if isAddressLine(name) || reASCIIStreetNumber.MatchString(name) {
					addressed = true
					continue
				}
				if addressed {
					continue
				}
				pending = norm(pending + " " + name)
				continue
			}
			name := norm(m[1])
			if addressed || isAddressLine(name) || reASCIIStreetNumber.MatchString(name) {
				name = pending
			} else if pending != "" {
				name = norm(pending + " " + name)
			}
			pending, addressed = "", false
			name, nameNotes := StripFootnotes(name)
			if name == "" || !hasWords(name, 2) || isAddressLine(name) || reSkipName.MatchString(name) {
				invalid = true
				break
			}
			grp, gn := isGroupRow(name)
			var holdingRows []Row
			for col := 0; col < 3; col++ {
				pctText := m[4+col]
				pct, parsed, mark, _ := ParsePercent(pctText)
				if !parsed && mark == "" && pctText != "--" {
					invalid = true
					break
				}
				r := base
				r.HolderName, r.TableKind, r.TableIndex, r.RowIndex, r.Parser = name, "management", start, j, "text_table"
				r.IsGroupRow, r.GroupN, r.commonColumn = grp, gn, true
				r.PctMarker = mark
				if parsed {
					r.Percent = &pct
				}
				r.Footnotes = strings.Join(nameNotes, ",")
				if col == 2 {
					r.ShareClass = "Combined Voting Power"
				} else {
					r.ShareClass = "Common Stock"
					if col == 1 {
						r.ShareClass = class
					}
					count, notes := StripFootnotes(m[2+col])
					if m[2+col] == "--" {
						count = "0"
					}
					shares, ok := ParseShares(count)
					if !ok {
						invalid = true
						break
					}
					r.Shares = &shares
					r.Footnotes = strings.Join(append(append([]string{}, nameNotes...), notes...), ",")
				}
				holdingRows = append(holdingRows, r)
			}
			if invalid {
				break
			}
			rows = append(rows, holdingRows...)
		}
		if !invalid && len(rows) >= 6 {
			kind := tableKind("management", rows, strings.Join(lines[max(0, start-25):endHeader], " "))
			for k := range rows {
				rows[k].TableKind = kind
			}
			out = append(out, rows...)
			blocks++
		}
	}
	return out, blocks
}

var reASCIIStandaloneStock = regexp.MustCompile(`(?i)^(?:common stock|(?:convertible )?preferred stock)$`)

func textStandaloneClassCaption(lines []string, row int) string {
	marker := -1
	var header []string
	for j := row - 1; j >= max(0, row-20); j-- {
		low := strings.ToLower(lines[j])
		if strings.Contains(low, "</table>") || strings.Contains(low, "<fn>") {
			return ""
		}
		if marker < 0 {
			if marks := reASCIIColumnMark.FindAllStringIndex(lines[j], -1); len(marks) > 0 {
				if len(marks) != 3 {
					return ""
				}
				marker = j
			}
			continue
		}
		text := norm(reAnyTag.ReplaceAllString(lines[j], ""))
		if reASCIIStandaloneStock.MatchString(text) {
			hdr := strings.ToLower(strings.Join(header, " "))
			if strings.Contains(hdr, "name and address of beneficial owner") && strings.Contains(hdr, "amount") && strings.Contains(hdr, "percent of class") {
				return text
			}
			return ""
		}
		if strings.Contains(low, "<caption>") || strings.Contains(low, "<table>") {
			return ""
		}
		header = append(header, text)
	}
	return ""
}

// textDollarOnlyTail reports a value tail whose every number carries a "$".
func textDollarOnlyTail(rest string) bool {
	t := strings.TrimSpace(rest)
	if !strings.HasPrefix(t, "$") {
		return false
	}
	return !reAnyDigit.MatchString(reDollarAmount.ReplaceAllString(t, " "))
}

var (
	reDollarAmount = regexp.MustCompile(`\$\s*[\d.,]+`)
	reAnyDigit     = regexp.MustCompile(`\d`)
)
