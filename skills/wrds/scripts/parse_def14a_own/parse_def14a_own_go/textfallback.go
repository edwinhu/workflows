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
	rePctTok     = regexp.MustCompile(`((?:[0-9]{1,3}(?:\.[0-9]+)?|\.[0-9]+))\s*%|(\*)|(?:^|\s)([0-9]{1,2}\.[0-9])(?:\s|$)`)
	reDotLeader  = regexp.MustCompile(`\.{3,}`)
	reHdrLineCue = regexp.MustCompile(`(?i)percent|shares|beneficial|amount|name\s+of`)
	reWrapCont   = regexp.MustCompile(`(?i)^(as\s+a\s+group|and\s+|as\s+a\s+)`)
	reTrailClass = regexp.MustCompile(`(?i)\s+(class\s+[a-d](?:\s+common(?:\s+stock)?)?|common\s+stock|common|series\s+[a-z0-9]+(?:\s+\w+)?|preferred(?:\s+stock)?|ordinary\s+shares)$`)
	reClassOnly  = regexp.MustCompile(`(?i)^(class\s+[a-d](?:\s+common(?:\s+stock)?)?|common\s+stock|common|series\s+[a-z0-9]+(?:\s+\w+)?|preferred(?:\s+stock)?|ordinary\s+shares)$`)

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
	reOwnHeadingLoose = regexp.MustCompile(`(?i)ownership\s+of\s+(?:\S+\s+){0,3}(?:common|capital|voting|ordinary)\s+(?:stock|shares)`)
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

var reNumTok = regexp.MustCompile(`[0-9][0-9,]*(?:\.[0-9]+)?\s*%|\.[0-9]+\s*%|[0-9][0-9,]*(?:\.[0-9]+)?|\*|(?:^|\s)[\+#†‡](?:\s|$)`)

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
	// A fund-family proxy in ASCII prints the fund's name on its own line above
	// each per-fund holder table. Record which fund is in force at every line so
	// a block can be labelled with it: without the fund, the same record holder
	// of a hundred funds collapses onto one grain key.
	seriesAt := textSeriesLabels(clean, base.series)

	for i, l := range clean {
		t := strings.TrimSpace(l)
		if len(t) < 6 || len(t) > 200 || reTOCish.MatchString(t) {
			continue
		}
		if !textAnchor(clean, i, t) {
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
				// A holder's postal address is not prose: it does not count
				// toward the run of non-row lines that ends the table. Only
				// sinceRow caps it, so a c/o line plus a firm, a tower, a
				// street and a city/zip cannot separate two holders forever.
				if !isAddressLine(lt) {
					nonRowRun++
				}
				sinceRow++
				if nonRowRun > 6 || sinceRow >= maxLinesSinceRow {
					break
				}
			}
		}
		block = alignedRows(clean, block)
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
		hdr := strings.Join(header, " ")
		// Same guard as the DOM path: the block itself, not the heading above
		// it, must read as an ownership table. Without this the scan runs on
		// into the Summary Compensation Table.
		body := hdr + " " + strings.Join(sliceLines(clean, block), " ")
		if !reOwnCue.MatchString(body) || reCompCue.MatchString(body) ||
			reOptDetailCue.MatchString(body) {
			continue
		}
		if textMoneyBlock(clean, block) {
			continue
		}
		classes := classLabelsFromHeader(hdr)
		// A fund-family proxy in ASCII writes the fund and the share class on
		// LABEL LINES of their own between the holder rows, indented to show
		// which contains which. Those lines carry no number so they are not
		// block rows at all and the identity was simply lost.
		stickyAt := textStickyLabels(clean, block)
		// The header lines above the block, split into column groups with their
		// character spans, so a class stated over ONE (shares, percent) pair can
		// be attached to that pair and to no other.
		hdrRows := textHeaderRows(clean, block[0])
		var rows []Row
		lastHolder := ""
		// The class column's last value, forward-filled over the rows that leave
		// it blank. Local to the block, which is one fund's table.
		lastColClass := ""
		for _, ln := range block {
			consumed[ln] = true
			name, rest, restStart, ok := parseTextRowAt(clean[ln])
			if !ok {
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
			// The class stated over each value column, read off the header lines
			// by POSITION. Used only when the header really distinguishes the
			// columns -- two or more different labels over this row's cells --
			// which is exactly the multi-class shape and nothing else.
			colClass := make([]string, n)
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
				case colClass[k] != "":
					rw.ShareClass = colClass[k]
				case rowClass != "":
					rw.ShareClass = rowClass
				case n > 1 && k < len(classes):
					rw.ShareClass = classes[k]
				case len(classes) == 1:
					rw.ShareClass = classes[0]
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
		if len(rows) < 2 && !(sole && len(rows) == 1) {
			continue
		}
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
	best := ""
	for k := ln - 1; k >= 0 && len(pre) < 3; k-- {
		p := strings.TrimSpace(clean[k])
		if p == "" || len(p) > 90 || reShareLike.MatchString(p) {
			break
		}
		if _, _, ok := parseTextRow(clean[k]); ok {
			break // a table row of its own, not a wrapped label line
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
		if t != "" && !reTextValueish.MatchString(t) && reTextStickyLabel.MatchString(t) {
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
			if t == "" || reTextValueish.MatchString(t) || !reTextStickyLabel.MatchString(t) {
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
	reColLabelKeep = regexp.MustCompile(`(?i)\bclass\s+[a-d0-9]\b|\bcommon\s+stock\b|\bpreferred\b|\bordinary\s+shares\b|\bseries\s+[a-z0-9]+\b|\bvoting\s+power\b|\bcombined\b|\btotal\b|\bdepositary\b|\bunits?\b`)
	// Header text that is only the shape of the column, never its identity.
	reColLabelDrop = regexp.MustCompile(`(?i)^(?:number|percent|percentage|amount|shares?|no\.?|of\s+shares|of\s+class|%)[\s.():0-9]*$`)
	// A preposition left at the head of a label whose first words were the
	// dropped shape word on the line above.
	reColLabelLead = regexp.MustCompile(`(?i)^(?:of|in|and|the)\s+`)
)

// textHeaderRows returns the header lines above a block, top to bottom, split
// into whitespace-separated column groups with their character spans.
func textHeaderRows(clean []string, first int) [][]hdrGroup {
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
	var out [][]hdrGroup
	for i := len(lines) - 1; i >= 0; i-- {
		if g := splitHdrGroups(clean[lines[i]]); len(g) > 0 {
			out = append(out, g)
		}
	}
	return out
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
	var parts []string
	for _, line := range hdr {
		best, bestOv := -1, 0
		for k, g := range line {
			ov := min(g.hi, hi) - max(g.lo, lo)
			if ov > bestOv {
				best, bestOv = k, ov
			}
		}
		if best < 0 {
			continue
		}
		t := line[best].text
		if reRuleLine.MatchString(t) || reColLabelDrop.MatchString(t) {
			continue
		}
		if !reColLabelKeep.MatchString(t) {
			continue
		}
		parts = append(parts, t)
	}
	if len(parts) == 0 {
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
		if reMoneyTail.MatchString(rest) {
			money++
		}
	}
	return rows > 0 && money*2 >= rows
}
