package main

import (
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
	rePctTok     = regexp.MustCompile(`([0-9]{1,3}(?:\.[0-9]+)?)\s*%|(\*)|(?:^|\s)([0-9]{1,2}\.[0-9])(?:\s|$)`)
	reDotLeader  = regexp.MustCompile(`\.{3,}`)
	reHdrLineCue = regexp.MustCompile(`(?i)percent|shares|beneficial|amount|name\s+of`)
	reWrapCont   = regexp.MustCompile(`(?i)^(as\s+a\s+group|and\s+|as\s+a\s+)`)
	reTrailClass = regexp.MustCompile(`(?i)\s+(class\s+[a-d](?:\s+common(?:\s+stock)?)?|common\s+stock|common|series\s+[a-z0-9]+(?:\s+\w+)?|preferred(?:\s+stock)?|ordinary\s+shares)$`)
	reClassOnly  = regexp.MustCompile(`(?i)^(class\s+[a-d](?:\s+common(?:\s+stock)?)?|common\s+stock|common|series\s+[a-z0-9]+(?:\s+\w+)?|preferred(?:\s+stock)?|ordinary\s+shares)$`)
)

// maxLinesSinceRow caps the combined run of blank and non-row lines between
// two table rows. A four-line address plus its blank separator is five;
// anything past this is the table having ended.
const maxLinesSinceRow = 12

// holding is one (shares, percent) column pair recovered from an ASCII row.
type holding struct {
	shares *float64
	pct    *float64
	marker string
}

var reNumTok = regexp.MustCompile(`[0-9][0-9,]*(?:\.[0-9]+)?\s*%|[0-9][0-9,]*(?:\.[0-9]+)?|\*|(?:^|\s)[\+#†‡](?:\s|$)`)

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
	rest = reFootnote.ReplaceAllString(rest, " ")
	var out []holding
	var pendShares *float64
	lastShares := (*float64)(nil)
	anyPct := false
	for _, tok := range reNumTok.FindAllString(rest, -1) {
		t := strings.TrimSpace(tok)
		switch {
		case isStarMarker(t):
			anyPct = true
			out = append(out, holding{shares: pendShares, marker: "*"})
			pendShares = nil
		case strings.HasSuffix(t, "%"):
			anyPct = true
			v, ok, mk, _ := ParsePercent(t)
			h := holding{shares: pendShares, marker: mk}
			if ok {
				vv := v
				h.pct = &vv
			}
			out = append(out, h)
			pendShares = nil
		case strings.Contains(t, ".") && !strings.Contains(t, ","):
			// a bare decimal in the tail is the percent column
			if v, ok, _, _ := ParsePercent(t + "%"); ok && v <= 100 {
				anyPct = true
				vv := v
				out = append(out, holding{shares: pendShares, pct: &vv})
				pendShares = nil
				continue
			}
		default:
			if !strings.Contains(t, ",") && len(t) >= 4 {
				continue // a bare 4-digit number in the tail is a year
			}
			if v, ok := ParseShares(t); ok {
				vv := v
				pendShares, lastShares = &vv, &vv
			}
		}
	}
	if !anyPct && lastShares != nil {
		return []holding{{shares: lastShares}}
	}
	if pendShares != nil {
		out = append(out, holding{shares: pendShares})
	}
	if reLessThan.MatchString(rest) {
		out = append(out, holding{marker: "<1%"})
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

func stripEntities(s string) string {
	return strings.NewReplacer("&nbsp;", " ", "&amp;", "&", "&lt;", "<", "&gt;", ">",
		"&quot;", "\"", "&#151;", "-", "&#150;", "-").Replace(s)
}

// ExtractText runs the ASCII path over a proxy body.
func ExtractText(body string, base Row) ([]Row, int, int) {
	body = stripEntities(body)
	lines := strings.Split(body, "\n")
	clean := make([]string, len(lines))
	for i, l := range lines {
		l = reTxtTag.ReplaceAllString(l, "")
		l = reAnyTag.ReplaceAllString(l, "")
		// Dot leaders are the ASCII table's column separator ("Ellison(2).....
		// 344,039,276  24.0%"), so they become whitespace rather than a reason
		// to skip the line.
		l = reDotLeader.ReplaceAllStringFunc(l, func(m string) string {
			return strings.Repeat(" ", len(m))
		})
		clean[i] = strings.ReplaceAll(l, "\t", "    ")
	}
	var out []Row
	blocksSeen, blocksUsed := 0, 0
	consumed := map[int]bool{}

	for i, l := range clean {
		t := strings.TrimSpace(l)
		if len(t) < 6 || len(t) > 200 || reTOCish.MatchString(t) {
			continue
		}
		if !reOwnHeading.MatchString(t) {
			continue
		}
		kind := sectionKind(t)
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
		for ; j < limit; j++ {
			if consumed[j] {
				continue
			}
			lt := strings.TrimSpace(clean[j])
			if lt == "" {
				blankRun++
				if len(block) > 0 {
					sinceRow++
					if blankRun >= 3 || sinceRow >= maxLinesSinceRow {
						break
					}
				}
				continue
			}
			blankRun = 0
			if reHdrLineCue.MatchString(lt) && len(block) == 0 {
				header = append(header, clean[j])
			}
			if len(block) == 0 && j-i > 60 {
				break // the heading's table is not here
			}
			if _, _, ok := parseTextRow(clean[j]); ok {
				block = append(block, j)
				nonRowRun, sinceRow = 0, 0
			} else if len(block) > 0 {
				nonRowRun++
				sinceRow++
				if nonRowRun > 6 || sinceRow >= maxLinesSinceRow {
					break
				}
			}
		}
		block = alignedRows(clean, block)
		if len(block) < 2 {
			continue
		}
		blocksSeen++
		hdr := strings.Join(header, " ")
		// Same guard as the DOM path: the block itself, not the heading above
		// it, must read as an ownership table. Without this the scan runs on
		// into the Summary Compensation Table.
		body := hdr + " " + strings.Join(sliceLines(clean, block), " ")
		if !reOwnCue.MatchString(body) || reCompCue.MatchString(body) {
			continue
		}
		classes := classLabelsFromHeader(hdr)
		var rows []Row
		lastHolder := ""
		for _, ln := range block {
			consumed[ln] = true
			name, rest, ok := parseTextRow(clean[ln])
			if !ok {
				continue
			}
			nm, fns := StripFootnotes(name)
			// An ASCII "Title of class" column sits inside the name half,
			// because the row splits at the first gap before a number:
			// "Warren E. Buffett     Class A     478,232(2)   35.6".
			rowClass := ""
			if m := reTrailClass.FindStringSubmatch(nm); m != nil {
				rowClass = norm(m[1])
				nm = strings.TrimSpace(nm[:len(nm)-len(m[0])])
			}
			if nm == "" || reClassOnly.MatchString(nm) {
				// a continuation line: the second class of the holder above
				if rowClass == "" && reClassOnly.MatchString(nm) {
					rowClass = nm
				}
				nm = lastHolder
			}
			nm = strings.TrimSpace(reDotLeader.ReplaceAllString(nm, " "))
			nm = strings.TrimSpace(nm)
			if nm == "" || !hasWords(nm, 1) || reSkipName.MatchString(nm) {
				continue
			}
			// A group row wraps: "All current executive officers and directors"
			// / " as a group (17 persons)....  356,679,528  24.7%".
			if joined, ok := joinWrappedLabel(clean, ln, nm); ok {
				nm = joined
			} else if reWrapCont.MatchString(nm) && ln > 0 {
				prev := strings.TrimSpace(clean[ln-1])
				if prev != "" && !reBigNum.MatchString(prev) && len(prev) < 90 {
					nm = strings.TrimSpace(prev + " " + nm)
				}
			}
			if nm != "" && !reClassOnly.MatchString(nm) {
				lastHolder = nm
			}
			grp, gn := isGroupRow(nm)
			cells := textTokens(rest)
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
			for k := 0; k < n; k++ {
				rw := base
				rw.TableIndex = i
				rw.RowIndex = ln
				rw.HolderName = nm
				rw.IsGroupRow = grp
				rw.GroupN = gn
				rw.Parser = "text_table"
				rw.Footnotes = strings.Join(fns, ",")
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
				case rowClass != "":
					rw.ShareClass = rowClass
				case n > 1 && k < len(classes):
					rw.ShareClass = classes[k]
				case len(classes) == 1:
					rw.ShareClass = classes[0]
				}
				if rw.Shares == nil && rw.Percent == nil && rw.PctMarker == "" {
					continue
				}
				rows = append(rows, rw)
			}
		}
		if len(rows) < 2 {
			continue
		}
		blocksUsed++
		blockText := hdr + " " + strings.Join(sliceLines(clean, block), " ")
		kd := tableKind(kind, rows, blockText+" "+t)
		for k := range rows {
			rows[k].TableKind = kd
		}
		out = append(out, rows...)
	}
	return out, blocksSeen, blocksUsed
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
	if strings.TrimSpace(l) == "" {
		return "", "", 0, false
	}
	s := strings.TrimRight(l, " ")
	m := reTxtRow.FindStringSubmatchIndex(s)
	if m == nil {
		return "", "", 0, false
	}
	name, rest, restStart = s[m[2]:m[3]], s[m[4]:m[5]], m[4]
	if !reBigNum.MatchString(rest) && !strings.Contains(rest, "%") && !strings.Contains(rest, "*") {
		return "", "", 0, false
	}
	// the name half must be text, not another number column
	if !hasWords(name, 1) {
		return "", "", 0, false
	}
	return name, rest, restStart, true
}

// alignedRows keeps only the lines whose numeric tail starts at the table's
// modal column. A proxy paragraph ("There were  2,266,000,000  shares
// outstanding") parses as a row on its own but never lines up with the table.
func alignedRows(clean []string, block []int) []int {
	if len(block) < 3 {
		return block
	}
	counts := map[int]int{}
	starts := map[int]int{}
	for _, ln := range block {
		_, _, st, ok := parseTextRowAt(clean[ln])
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
	for k := ln - 1; k >= 0 && len(pre) < 3; k-- {
		p := strings.TrimSpace(clean[k])
		if p == "" || len(p) > 90 || reShareLike.MatchString(p) {
			break
		}
		if _, _, ok := parseTextRow(clean[k]); ok {
			break // a table row of its own, not a wrapped label line
		}
		pre = append([]string{p}, pre...)
		if g, _ := isGroupRow(strings.Join(append(append([]string{}, pre...), nm), " ")); g {
			break // shortest join that reads as the group row
		}
	}
	if len(pre) == 0 {
		return "", false
	}
	joined := strings.TrimSpace(strings.Join(append(pre, nm), " "))
	if g, _ := isGroupRow(joined); !g {
		return "", false
	}
	return joined, true
}
