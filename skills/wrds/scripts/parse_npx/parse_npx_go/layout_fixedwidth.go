package main

import "strings"

// fixedwidth reads the Glass Lewis text table printed inside <PRE>. Its cells are
// separated by horizontal runs, not by stable byte offsets: the same Proponent
// cell drifts across physical lines in real filings. stripHTML preserves that
// distinction by squeezing a wide run to two spaces while leaving a single word
// space alone, so splitting on the surviving gaps recovers the printed cells
// without cutting a column map from one row and imposing it on the next.
//
// A wrong column mapping is worse than a skip on this population. The layout
// therefore claims only the complete six-field Glass Lewis header, including its
// wrapped For/Against Management label, and declines a body from which no such
// governed row can be read.

const fixedWidthHeaderCells = 6

// matchFixedWidth recognises the layout by the same printed header parseFixedWidth
// consumes. The registry hands it only the bounded normalised head; parseFixedWidth
// repeats the test over the whole body before emitting anything.
func matchFixedWidth(head string) bool {
	lines := strings.Split(head, "\n")
	for i := range lines {
		if _, _, _, ok := fixedWidthHeader(lines, i); ok {
			return true
		}
	}
	return false
}

// parseFixedWidth walks one or more Glass Lewis meeting blocks. A proposal stays
// open until the next item, blank, header or context block so a one-cell physical
// line can be joined to the description above it rather than emitted as a row of
// its own or discarded.
func parseFixedWidth(text string, _ FilingMeta) ([]VoteRow, error) {
	lines := strings.Split(text, "\n")
	var (
		out         []VoteRow
		cur         *VoteRow
		mapping     map[string]int
		headerArity int
		ctx         htmlContext
		inTable     bool
	)

	flush := func() {
		if cur == nil {
			return
		}
		cur.VoteDescription = htmlFlat(cur.VoteDescription)
		out = append(out, *cur)
		cur = nil
	}

	for i := 0; i < len(lines); i++ {
		if cells, m, consumed, ok := fixedWidthHeader(lines, i); ok {
			flush()
			mapping, headerArity = m, len(cells)
			ctx = fixedWidthContext(lines, i)
			inTable = true
			i += consumed
			continue
		}

		line := strings.TrimSpace(lines[i])
		if line == "" {
			flush()
			continue
		}
		if !inTable {
			continue
		}

		// A new issuer/context block ends the table above it. The issuer is the
		// one-cell line immediately before the label row, so it must be recognised
		// with lookahead before it can be mistaken for a wrapped description.
		if fixedWidthStartsContext(lines, i) || fixedWidthRule(line) {
			flush()
			mapping, headerArity = nil, 0
			inTable = false
			continue
		}

		cells := vanguardGapCells(line)
		if len(cells) == headerArity {
			if row, ok := fixedWidthDataRow(cells, mapping, headerArity, ctx); ok {
				flush()
				cur = &row
				continue
			}
		}

		// Within an open row, a physical line carrying exactly one cell is the
		// description's continuation. It has no item or trailing cells of its own.
		if cur != nil && len(cells) == 1 {
			part := htmlFlat(cells[0])
			if part != "" {
				cur.VoteDescription = htmlFlat(cur.VoteDescription + " " + part)
			}
			continue
		}

		// An unrecognised multi-cell line is furniture, not a licence to reinterpret
		// its fields. Close the pending row but keep the identified header active;
		// page furniture may sit between proposals of the same table.
		flush()
	}
	flush()

	if len(out) == 0 {
		return nil, errLayoutDeclined
	}
	return out, nil
}

// fixedWidthHeader joins the wrapped header before deriving its mapping. The
// fixture prints `For/Against` on the first line and `Mgmt` on the next; mapping
// the first line alone would leave the last column unnamed.
func fixedWidthHeader(lines []string, i int) (cells []string, mapping map[string]int, consumed int, ok bool) {
	if i < 0 || i >= len(lines) {
		return nil, nil, 0, false
	}
	base := vanguardGapCells(strings.TrimSpace(lines[i]))
	if len(base) == 0 {
		return nil, nil, 0, false
	}

	if i+1 < len(lines) && fixedWidthHeaderSpill(base, lines[i+1]) {
		joined := append([]string(nil), base...)
		joined[len(joined)-1] = htmlFlat(joined[len(joined)-1] + " " + lines[i+1])
		if m, good := fixedWidthHeaderMapping(joined); good {
			return joined, m, 1, true
		}
	}

	if m, good := fixedWidthHeaderMapping(base); good {
		return base, m, 0, true
	}
	return nil, nil, 0, false
}

func fixedWidthHeaderSpill(cells []string, next string) bool {
	if len(cells) == 0 || htmlCanonLabel(cells[len(cells)-1]) != "FOR/AGAINST" {
		return false
	}
	parts := vanguardGapCells(strings.TrimSpace(next))
	return len(parts) == 1 && htmlCanonLabel(parts[0]) == "MGMT"
}

// fixedWidthHeaderMapping requires every column of the Glass Lewis shape. It does
// not infer a missing field from position: a header that names fewer or more
// columns belongs to another grammar and remains a skip.
func fixedWidthHeaderMapping(cells []string) (map[string]int, bool) {
	if len(cells) != fixedWidthHeaderCells {
		return nil, false
	}
	mapping, _, ok := htmlHeaderShape(cells)
	if !ok {
		return nil, false
	}
	// The wrapped spelling is literally `For/Against` + `Mgmt`. The generic HTML
	// vocabulary carries the unabbreviated and For/Agnst variants; this exact joined
	// form is the fixed-width format's sixth column and names no other field.
	last := len(cells) - 1
	if htmlCanonLabel(cells[last]) == "FOR/AGAINST MGMT" {
		mapping[htmlFieldVsMgmt] = last
	}
	for _, field := range []string{
		htmlFieldItem,
		htmlFieldDesc,
		htmlFieldBy,
		htmlFieldMgmtRec,
		htmlFieldVote,
		htmlFieldVsMgmt,
	} {
		if _, present := mapping[field]; !present {
			return nil, false
		}
	}
	return mapping, true
}

// fixedWidthDataRow applies the header's indices to cells split independently on
// this row's own gaps. The independent split is the tolerance for drifting column
// starts: only cell order is stable. A vote-shaped value is required at the vote
// index so a shifted or furniture row is skipped rather than emitted.
func fixedWidthDataRow(cells []string, mapping map[string]int, arity int, ctx htmlContext) (VoteRow, bool) {
	itemAt, ok := mapping[htmlFieldItem]
	if !ok || itemAt >= len(cells) || !htmlIsItemNumber(htmlFlat(cells[itemAt])) {
		return VoteRow{}, false
	}
	r, ok := htmlDataRow(cells, mapping, arity, ctx)
	if !ok || r.VoteDescription == "" || !htmlIsVoteValue(r.HowVoted) {
		return VoteRow{}, false
	}
	return r, true
}

// fixedWidthContext reads the label/value pair above one header. All three
// positional identity labels must be present and the value row must have the same
// arity; otherwise the context stays blank rather than shifting values by guess.
func fixedWidthContext(lines []string, header int) htmlContext {
	const lookback = 16
	lo := header - lookback
	if lo < 0 {
		lo = 0
	}
	for i := header - 1; i >= lo; i-- {
		labels := vanguardGapCells(strings.TrimSpace(lines[i]))
		mapping, ok := fixedWidthContextMapping(labels)
		if !ok {
			continue
		}
		j := fixedWidthNextNonEmpty(lines, i+1, header)
		if j < 0 {
			continue
		}
		values := vanguardGapCells(strings.TrimSpace(lines[j]))
		if len(values) != len(labels) {
			continue
		}
		at := func(field string) string {
			idx := mapping[field]
			if idx < 0 || idx >= len(values) {
				return ""
			}
			return htmlFlat(values[idx])
		}
		ctx := htmlContext{
			Ticker:      htmlValueOrEmpty(issFirstField(at(htmlFieldTicker))),
			CUSIP:       fixedWidthCUSIP(at(htmlFieldCUSIP)),
			MeetingDate: htmlDate(at(htmlFieldMtgDate)),
		}
		ctx.Issuer = fixedWidthIssuerAbove(lines, i, lo)
		return ctx
	}
	return htmlContext{}
}

func fixedWidthContextMapping(cells []string) (map[string]int, bool) {
	if len(cells) < 3 {
		return nil, false
	}
	mapping := htmlMapFields(cells)
	for _, field := range []string{htmlFieldTicker, htmlFieldCUSIP, htmlFieldMtgDate} {
		if _, ok := mapping[field]; !ok {
			return nil, false
		}
	}
	return mapping, true
}

func fixedWidthIssuerAbove(lines []string, labels, lo int) string {
	for i := labels - 1; i >= lo; i-- {
		line := strings.TrimSpace(lines[i])
		if line == "" {
			continue
		}
		if fixedWidthRule(line) || !htmlIsIssuerLine(line) {
			return ""
		}
		return htmlFlat(line)
	}
	return ""
}

func fixedWidthCUSIP(s string) string {
	s = htmlFlat(s)
	up := htmlUpperASCII(s)
	for _, prefix := range []string{"CUSIP:", "CUSIP"} {
		if !strings.HasPrefix(up, prefix) {
			continue
		}
		if len(up) > len(prefix) && prefix == "CUSIP" && !isASCIISpace(up[len(prefix)]) {
			continue
		}
		s = strings.TrimSpace(s[len(prefix):])
		break
	}
	return htmlValueOrEmpty(issFirstField(s))
}

// fixedWidthStartsContext recognises both the label row and its one-cell issuer
// immediately above it. This lookahead is what keeps a new issuer from being
// appended to the last proposal description of the preceding block.
func fixedWidthStartsContext(lines []string, i int) bool {
	if i < 0 || i >= len(lines) {
		return false
	}
	if _, ok := fixedWidthContextMapping(vanguardGapCells(strings.TrimSpace(lines[i]))); ok {
		return true
	}
	cells := vanguardGapCells(strings.TrimSpace(lines[i]))
	if len(cells) != 1 {
		return false
	}
	j := fixedWidthNextNonEmpty(lines, i+1, len(lines))
	if j < 0 {
		return false
	}
	_, ok := fixedWidthContextMapping(vanguardGapCells(strings.TrimSpace(lines[j])))
	return ok
}

func fixedWidthNextNonEmpty(lines []string, from, limit int) int {
	if limit > len(lines) {
		limit = len(lines)
	}
	for i := from; i < limit; i++ {
		if strings.TrimSpace(lines[i]) != "" {
			return i
		}
	}
	return -1
}

func fixedWidthRule(line string) bool {
	line = strings.TrimSpace(line)
	if len(line) < 8 {
		return false
	}
	for i := 0; i < len(line); i++ {
		switch line[i] {
		case '_', '-', '=':
		default:
			return false
		}
	}
	return true
}
