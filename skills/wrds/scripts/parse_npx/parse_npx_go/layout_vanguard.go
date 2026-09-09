package main

import (
	"regexp"
	"strings"
)

// The vanguard layout is a block grammar rather than a table: a `FUND:` line
// opens a fund, long dashed rules separate one issuer's record from the next,
// and inside a record the identity keys (`ISSUER:`, `TICKER: ... CUSIP: ...`,
// `MEETING DATE:`) precede a `PROPOSAL:` column header and then one line per
// proposal. Both the issuer name and the proposal text wrap, and the wrap is
// what makes a naive line-per-row parser produce two half rows where the filing
// means one vote, so continuation lines are rejoined before anything is split.

// vanguardDashRule matches the long rule that separates issuer records. Short
// runs of dashes appear inside proposal text, so the rule requires a line that
// is nothing but dashes and is long enough not to be punctuation.
var vanguardDashRule = regexp.MustCompile(`^-{8,}$`)

// vanguardProposalLine captures the proposal number and whatever follows it on
// the opening line of a proposal. The number is the item_seq.
var vanguardProposalLine = regexp.MustCompile(`(?i)^PROPOSAL\s*#\s*([0-9A-Za-z][0-9A-Za-z.\-]*)\s*[:.]?\s*(.*)$`)

// vanguardTickerLine captures the ticker and CUSIP that share one line. The
// ticker runs to the CUSIP label: a Nordic share class puts a space in it
// (`TICKER: MAERSK B  CUSIP: K0514G135`, Vanguard International Equity Index
// Funds 2017, 1,779 rows with no security id).
var vanguardTickerLine = regexp.MustCompile(`(?i)^TICKER:\s*(.*?)\s*(?:CUSIP:\s*(\S+))?\s*$`)

// The trailing columns are read PRIMARILY from the column separator the filing
// printed: collapseSpaces (html.go) now squeezes a horizontal run to two spaces
// rather than one, so a gap that was column padding survives normalisation and a
// fixed-width row can be split on its own separator. Two adjacent cells that are
// both multi-word and both off-vocabulary are then told apart by the filing
// rather than guessed at, which no vocabulary rule can do.
//
// The vocabularies below remain only as a FALLBACK for lines that genuinely
// carry no wide gap -- a filer who padded one column with a single space. They
// place a cell boundary; they never decide whether a line is a row.
//
// The vocabularies are deliberately local to this layout. The broadridge family
// keeps its own copy (layout_broadridge.go) because the two grammars drift.

// vanguardColumns is the shape of the trailing column block as the filing's own
// `PROPOSAL:` header declares it: how many cells stand to the right of the
// proposal text, and whether the last of them is MGMT. It is read off the
// header line rather than assumed, so a vintage that prints a different number
// of columns is described by its own header instead of by this file.
type vanguardColumns struct {
	trailing int
	mgmt     bool
}

// vanguardReadHeader reads the column arity off a `PROPOSAL:` header line. The
// header is printed with the same padding as the rows beneath it, so splitting
// it on the column gap yields one cell per column.
func vanguardReadHeader(header string) vanguardColumns {
	cells := vanguardGapCells(header)
	return vanguardColumns{
		trailing: len(cells) - 1,
		mgmt:     strings.Contains(strings.ToUpper(header), "MGMT"),
	}
}

// vanguardGapCells splits one physical line on its column separator: a run of
// two or more spaces, or any run containing a tab. A single space is word
// spacing and never a separator. The scan is a single pass over the line.
func vanguardGapCells(line string) []string {
	var cells []string
	start := 0
	i := 0
	for i < len(line) {
		if line[i] != ' ' && line[i] != '\t' {
			i++
			continue
		}
		run := i
		tab := false
		for i < len(line) && (line[i] == ' ' || line[i] == '\t') {
			if line[i] == '\t' {
				tab = true
			}
			i++
		}
		if i-run < 2 && !tab {
			continue
		}
		if cell := strings.TrimSpace(line[start:run]); cell != "" {
			cells = append(cells, cell)
		}
		start = i
	}
	if cell := strings.TrimSpace(line[start:]); cell != "" {
		cells = append(cells, cell)
	}
	return cells
}

// vanguardMaxCellWords bounds the multi-word cell values ("Three Years",
// "Security Holder", "Take No Action").
const vanguardMaxCellWords = 3

// vanguardMaxTrailingTokens bounds the tokens that may follow the VOTED? cell:
// at most two vote cells of vanguardMaxCellWords words each. It is what stops a
// run of proposal prose after the word "no" from being read as a column block.
const vanguardMaxTrailingTokens = 2 * vanguardMaxCellWords

// vanguardVoteVocabulary lists the VOTE CAST and MGMT spellings that are known
// well enough to place a CELL BOUNDARY by. It is deliberately NOT the test for
// whether a line is a row: a vote spelling nobody listed must cost the row its
// vote value at worst, never its existence, or the filing lands ok with zero
// rows and is indistinguishable from a fund that had nothing to report.
var vanguardVoteVocabulary = map[string]bool{
	"for": true, "against": true, "abstain": true, "abstained": true,
	"withhold": true, "withheld": true, "split": true, "none": true,
	"refer": true, "unvoted": true, "n/a": true, "na": true, "tna": true,
	"n/m": true, "--": true, "---": true, "----": true,
	"do not vote": true, "did not vote": true, "no vote": true,
	"take no action": true, "no action": true,
	"one year": true, "two years": true, "three years": true,
	"1 year": true, "2 years": true, "3 years": true,
	"1 yr": true, "2 yrs": true, "3 yrs": true,
	"with management": true, "against management": true,
}

// vanguardVotedVocabulary is the VOTED? column, which broadridge does not have.
// It is the ANCHOR of the trailing column block: four spellings that the SEC
// text era does not vary, against ~30 vote spellings that it varies without
// limit. Recognition rests on this cell alone; everything to its right is read
// as votes whatever the filing spelled them.
var vanguardVotedVocabulary = map[string]bool{
	"yes": true, "no": true, "y": true, "n": true,
}

// vanguardSourceVocabulary is the PROPOSED BY column: who put the item forward.
var vanguardSourceVocabulary = map[string]bool{
	"issuer": true, "management": true, "mgmt": true, "mgt": true,
	"company": true, "board": true, "other": true,
	"shareholder": true, "shareholders": true, "share holder": true,
	"security holder": true, "securityholder": true,
	"shr": true, "shrholder": true, "shrhldr": true, "shrholdr": true,
}

// vanguardKeyLine reports whether a line opens a new field rather than
// continuing the previous one. Continuation detection is negative: anything
// that is not a rule, a blank, or a known key belongs to whatever wrapped.
var vanguardKeyLine = regexp.MustCompile(`(?i)^(FUND|ISSUER|TICKER|CUSIP|MEETING\s+DATE|SECURITY|SEDOL|ISIN|MEETING\s+TYPE|RECORD\s+DATE|PROPOSAL)\b\s*[:#]`)

// vanguardRecord is the identity carried by every proposal inside one dashed
// block.
type vanguardRecord struct {
	issuer      string
	ticker      string
	cusip       string
	meetingDate string
	meetingType string
	recordDate  string
}

// vanguardJoinSplitLabels rejoins a `PROPOSAL #n:` label the filing's own markup
// broke in half:
//
//	PROPOSAL
//	#2: ELECT DIRECTOR JAMES G. CULLEN      ISSUER    YES    FOR    FOR
//
// The newline is inside the paragraph's text content, where HTML treats it as
// whitespace rather than a line break, so the two lines are one row. Left split,
// the bare `PROPOSAL` matches no rule and is dropped, and the `#2:` line opens a
// row on its trailing columns alone -- with an EMPTY item_seq and the number
// stranded in the description as `#2: `. Measured 2026-09-01, that is 1,747,946
// filing-items whose number this layout loses, the largest such block in the
// corpus by a factor of three.
//
// Only an IMMEDIATELY following line is joined: a blank line between them means
// two rows, not one.
func vanguardJoinSplitLabels(lines []string) []string {
	out := make([]string, 0, len(lines))
	for i := 0; i < len(lines); i++ {
		if strings.EqualFold(strings.TrimSpace(lines[i]), "PROPOSAL") && i+1 < len(lines) &&
			strings.HasPrefix(strings.TrimSpace(lines[i+1]), "#") {
			out = append(out, "PROPOSAL "+strings.TrimSpace(lines[i+1]))
			i++
			continue
		}
		out = append(out, lines[i])
	}
	return out
}

// parseVanguard parses the ISSUER/PROPOSAL block grammar into one row per
// proposal.
func parseVanguard(text string, meta FilingMeta) ([]VoteRow, error) {
	var rows []VoteRow

	// Built once per filing, as in every other layout: the FUND: heading resolves
	// against the header's declared series under the shared rules (exact or one
	// described edit, refused on ambiguity), so a multi-series Vanguard filing
	// stamps the link key instead of carrying a bare fund name.
	seriesIx := newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))
	issFormerKeys(seriesIx, meta.FormerNames)

	fund := ""
	fundSeries := ""
	rec := vanguardRecord{}

	// pending holds the lines of a proposal whose text has not finished
	// wrapping. It is flushed when the next proposal, key, rule, blank line or
	// end of body proves the wrap is over.
	var pending []string

	// issuerOpen is true while an ISSUER: value may still be continued by a
	// following bare line.
	issuerOpen := false

	// cols is the shape of the trailing block, read off the column header the
	// filing itself prints, and it is what lets the gap split know how many of a
	// row's cells are columns and how many are wrapped proposal text.
	cols := vanguardColumns{}

	flush := func() {
		if len(pending) == 0 {
			return
		}
		if row, ok := vanguardRowFrom(pending, fund, rec, cols); ok {
			row.SeriesID = fundSeries
			rows = append(rows, row)
		}
		pending = pending[:0]
	}

	for _, raw := range vanguardJoinSplitLabels(strings.Split(text, "\n")) {
		line := strings.TrimRight(strings.ReplaceAll(raw, "\r", ""), " \t")
		trimmed := strings.TrimSpace(line)

		if trimmed == "" {
			flush()
			issuerOpen = false
			continue
		}
		if vanguardDashRule.MatchString(trimmed) {
			flush()
			issuerOpen = false
			rec = vanguardRecord{}
			continue
		}

		upper := strings.ToUpper(trimmed)

		switch {
		case vanguardFundLabel(trimmed) != "":
			flush()
			issuerOpen = false
			fund = vanguardFundLabel(trimmed)
			fundSeries = ""
			if _, d := issResolveFund(seriesIx, fund); d != nil {
				fundSeries = d.SeriesID
			}
			rec = vanguardRecord{}
			continue

		case strings.HasPrefix(upper, "ISSUER:"):
			flush()
			rec.issuer = strings.TrimSpace(trimmed[len("ISSUER:"):])
			issuerOpen = true
			continue

		case strings.HasPrefix(upper, "TICKER:"):
			flush()
			issuerOpen = false
			if m := vanguardTickerLine.FindStringSubmatch(trimmed); m != nil {
				rec.ticker = strings.TrimSpace(m[1])
				if m[2] != "" {
					rec.cusip = strings.TrimSpace(m[2])
				}
			}
			continue

		case strings.HasPrefix(upper, "CUSIP:"):
			flush()
			issuerOpen = false
			rec.cusip = strings.TrimSpace(trimmed[len("CUSIP:"):])
			continue

		case strings.HasPrefix(upper, "MEETING DATE:"):
			flush()
			issuerOpen = false
			rec.meetingDate = xmlDate(strings.TrimSpace(trimmed[len("MEETING DATE:"):]))
			continue

		case strings.HasPrefix(upper, "MEETING DATE "):
			// The 2004 vintage prints the label without a colon, the date in
			// the next column and a `For/Against` column header at the far
			// right of the same line (458k rows with no date on 2026-09-02).
			flush()
			issuerOpen = false
			if f := strings.Fields(trimmed[len("MEETING DATE "):]); len(f) > 0 {
				rec.meetingDate = xmlDate(f[0])
			}
			continue

		case strings.HasPrefix(upper, "RECORD DATE:"):
			flush()
			issuerOpen = false
			rec.recordDate = xmlDate(strings.TrimSpace(trimmed[len("RECORD DATE:"):]))
			continue

		case strings.HasPrefix(upper, "MEETING TYPE:"):
			flush()
			issuerOpen = false
			rec.meetingType = strings.TrimSpace(trimmed[len("MEETING TYPE:"):])
			continue
		}

		if m := vanguardProposalLine.FindStringSubmatch(trimmed); m != nil {
			flush()
			issuerOpen = false
			pending = append(pending, line)
			continue
		}

		// The bare `PROPOSAL:` column header carries no vote; it marks where the
		// proposal rows begin and it NAMES the columns those rows carry, which
		// is where the trailing block's arity comes from.
		if strings.HasPrefix(upper, "PROPOSAL:") {
			flush()
			issuerOpen = false
			cols = vanguardReadHeader(trimmed)
			continue
		}

		if vanguardKeyLine.MatchString(trimmed) {
			flush()
			issuerOpen = false
			continue
		}

		// The fixed-width era numbers only some items: a director election is a
		// bare "ELECTION OF DIRECTOR: <name>" line carrying the same trailing
		// columns and no "PROPOSAL #n" prefix at all. Such a line opens a row
		// with an empty item_seq. What identifies it is the trailing column
		// block itself, so the dashed rules, the "<PAGE>" furniture, the key
		// lines and the "PROPOSAL: PROPOSED BY VOTED? VOTE CAST MGMT" header
		// cannot be mistaken for one.
		if vanguardOpensRow(trimmed, pending, cols) {
			flush()
			issuerOpen = false
			pending = append(pending, line)
			continue
		}

		// A bare line continues whatever wrapped: the proposal text if one is
		// open, otherwise the issuer name.
		if len(pending) > 0 {
			pending = append(pending, line)
			continue
		}
		if issuerOpen {
			rec.issuer = strings.TrimSpace(rec.issuer + " " + trimmed)
		}
	}
	flush()

	return rows, nil
}

// vanguardOpensRow reports whether a line that matched no key and no
// "PROPOSAL #n" prefix nevertheless opens a proposal row of its own.
//
// The signal is the trailing column block: a VOTED? cell with at least one vote
// cell to its right, and some proposal text left over once they are peeled off.
// A continuation line of a proposal that has not yet shown its columns is NOT a
// new row, because the columns may sit on the continuation rather than the
// opening line; but once the open proposal has its columns, the next line
// carrying a block of its own is the next vote, not more of the same one.
func vanguardOpensRow(trimmed string, pending []string, cols vanguardColumns) bool {
	rest, _, _, _, _, ok := vanguardPeelColumns(trimmed, cols)
	if !ok || strings.TrimSpace(rest) == "" {
		return false
	}
	if len(pending) == 0 {
		return true
	}
	return vanguardHasColumns(pending, cols)
}

// vanguardHasColumns reports whether any line of an open proposal has already
// yielded its trailing column block.
func vanguardHasColumns(lines []string, cols vanguardColumns) bool {
	for _, l := range lines {
		if _, _, _, _, _, ok := vanguardPeelColumns(l, cols); ok {
			return true
		}
	}
	return false
}

// vanguardRowFrom turns the rejoined lines of one proposal into a row.
//
// The trailing columns are peeled off whichever physical line carries them --
// the opening line in the fixed-width vintage, a continuation line where the
// proposal text wrapped before the columns -- and the remaining text of every
// line, in order, is the description. Joining first and splitting afterwards
// buries the columns in the middle of the description whenever the text wraps.
func vanguardRowFrom(lines []string, fund string, rec vanguardRecord, cols vanguardColumns) (VoteRow, bool) {
	parts := make([]string, len(lines))
	for i, l := range lines {
		parts[i] = strings.TrimSpace(l)
	}

	seq := ""
	if m := vanguardProposalLine.FindStringSubmatch(parts[0]); m != nil {
		seq = m[1]
		parts[0] = m[2]
	}

	var proposedBy, voted, cast, mgmt string
	for i, p := range parts {
		rest, pb, v, c, mg, ok := vanguardPeelColumns(p, cols)
		if !ok {
			continue
		}
		parts[i] = rest
		proposedBy, voted, cast, mgmt = pb, v, c, mg
		break
	}

	desc := strings.Join(strings.Fields(strings.Join(parts, " ")), " ")
	if desc == "" && cast == "" {
		return VoteRow{}, false
	}

	row := VoteRow{
		FundName:                 fund,
		IssuerName:               rec.issuer,
		Ticker:                   rec.ticker,
		CUSIP:                    rec.cusip,
		MeetingDate:              rec.meetingDate,
		MeetingType:              rec.meetingType,
		RecordDate:               rec.recordDate,
		ItemSeq:                  seq,
		VoteDescription:          desc,
		VoteSource:               proposedBy,
		HowVoted:                 cast,
		ManagementRecommendation: mgmt,
		VoteOtherInfo:            voted,
	}
	return row, true
}

// vanguardPeelColumns takes PROPOSED BY / VOTED? / VOTE CAST / MGMT off the
// right of one physical line. The proposal text that remains is returned as
// body.
//
// The PRIMARY path is the column separator the filing printed: split the line on
// its wide gaps and take the last cols.trailing cells, which is the only reading
// that is the filing's own rather than a guess. It needs no vocabulary at all,
// so a vote or a proposer spelled in a way nobody listed costs the row nothing.
//
// The FALLBACK, for a line whose columns were padded with a single space and so
// carry no surviving gap, locates the VOTED? cell and reads the columns outwards
// from it. There too, ok is decided STRUCTURALLY -- a VOTED? cell with a
// cell-shaped run of tokens to its right -- and the vote vocabulary only places
// the boundary between VOTE CAST and MGMT. Its scan is bounded to the last
// vanguardMaxTrailingTokens+1 tokens of the line, so its cost is constant per
// line rather than a function of length.
//
// Cell values are returned VERBATIM, in the filing's own capitalization;
// nothing here rewrites what the filing said.
func vanguardPeelColumns(line string, cols vanguardColumns) (body, proposedBy, voted, cast, mgmt string, ok bool) {
	if b, pb, v, c, mg, found := vanguardPeelByGap(line, cols); found {
		return b, pb, v, c, mg, true
	}

	toks := strings.Fields(line)

	// Anchor on the VOTED? cell: one token from a four-word set the text era
	// does not vary, so it can carry recognition where the open-ended vote
	// column cannot. Candidates are tried LEFTMOST first, so a VOTE CAST that
	// itself opens with "No" ("No Action.") is read as a vote rather than
	// mistaken for the anchor.
	//
	// A column cell is printed bare, so the anchor is matched WITHOUT the
	// punctuation trim vanguardCellKey applies to values: the "NO." of
	// "PROPOSAL NO. 1 ISSUER YES FOR FOR" is a sentence, not a cell, and letting
	// it anchor is what made a slice spanning three columns look like a vote.
	anchor := -1
	lo := len(toks) - 1 - vanguardMaxTrailingTokens
	if lo < 0 {
		lo = 0
	}
	for i := lo; i <= len(toks)-2; i++ {
		if !vanguardVotedVocabulary[strings.ToLower(toks[i])] {
			continue
		}
		c, mg, good := vanguardSplitVoteCells(toks[i+1:], cols.mgmt)
		if !good {
			continue
		}
		anchor, cast, mgmt = i, c, mg
		break
	}
	if anchor < 0 {
		return line, "", "", "", "", false
	}
	voted = toks[anchor]
	toks = toks[:anchor]

	if cell, rest, found := vanguardPeelCell(toks, vanguardSourceVocabulary); found {
		proposedBy = cell
		toks = rest
	}

	return strings.Join(toks, " "), proposedBy, voted, cast, mgmt, true
}

// vanguardPeelByGap splits one physical line on the column separator the filing
// printed and reads the trailing cells positionally, right-anchored, against the
// arity the filing's own `PROPOSAL:` header declared.
//
// Right-anchored because it is the proposal text on the LEFT that wraps and may
// itself contain a wide gap; the column block is flush to the right edge. Any
// cells beyond the declared arity therefore belong to the description and are
// rejoined into it.
//
// found is false when this line carries no usable separator -- no header was
// seen, the header declared a shape this grammar does not have, the line splits
// into too few cells, or nothing is left over for the description. The caller
// then falls back to the vocabulary reading. Nothing here consults a vocabulary:
// the boundary comes from the filing.
func vanguardPeelByGap(line string, cols vanguardColumns) (body, proposedBy, voted, cast, mgmt string, found bool) {
	// PROPOSED BY / VOTED? / VOTE CAST, with MGMT optional, is the block this
	// grammar knows how to name, and the header's cell COUNT must agree with the
	// names it printed: a header whose own padding failed to survive splits into
	// too few cells, and mapping a row's cells against that count would put the
	// vote in the wrong column silently. Any disagreement is left to the fallback
	// rather than mapped by guesswork.
	want := 3
	if cols.mgmt {
		want = 4
	}
	if cols.trailing != want {
		return "", "", "", "", "", false
	}
	cells := vanguardGapCells(line)
	if len(cells) < cols.trailing+1 {
		return "", "", "", "", "", false
	}
	split := len(cells) - cols.trailing
	tail := cells[split:]
	body = strings.Join(cells[:split], " ")
	if strings.TrimSpace(body) == "" {
		return "", "", "", "", "", false
	}
	proposedBy, voted, cast = tail[0], tail[1], tail[2]
	if cols.mgmt {
		mgmt = tail[3]
	}
	return body, proposedBy, voted, cast, mgmt, true
}

// vanguardSplitVoteCells divides the tokens standing to the right of the VOTED?
// cell into VOTE CAST and an optional MGMT. Values are returned as the filing
// wrote them; no vocabulary decides whether the block EXISTS, only where the
// boundary between its two cells falls.
//
// The boundary is looked for in descending order of evidence, and the first
// reading that fits wins:
//
//  1. the whole run spells one listed value ("Three Years.", "With Management")
//  2. the run ENDS in a listed value, which is the MGMT cell
//  3. the run ends in a cell whose own head word is a listed value
//     ("Withhold All"), the rest being VOTE CAST
//  4. the run OPENS with a listed value and is short enough to be one cell,
//     which is that same "listed head plus qualifier" read as a single VOTE CAST
//  5. two tokens, nothing listed anywhere, and the filing's column header
//     declared a MGMT column: the arity settles it -- two cells of one token
//  6. one unlisted cell of up to vanguardMaxCellWords words
//
// good is false when the run is not cell-shaped at all, which is what keeps
// proposal prose out of the row set.
func vanguardSplitVoteCells(tail []string, mgmtColumn bool) (cast, mgmt string, good bool) {
	if len(tail) == 0 || len(tail) > vanguardMaxTrailingTokens {
		return "", "", false
	}
	if len(tail) == 1 {
		return tail[0], "", true
	}

	if len(tail) <= vanguardMaxCellWords &&
		vanguardVoteVocabulary[vanguardCellKey(strings.Join(tail, " "))] {
		return strings.Join(tail, " "), "", true
	}

	maxMgmt := vanguardMaxCellWords
	if maxMgmt > len(tail)-1 {
		maxMgmt = len(tail) - 1
	}
	for _, n := range [2]int{
		vanguardTrailingListedCell(tail, maxMgmt),
		vanguardTrailingHeadedCell(tail, maxMgmt),
	} {
		if n == 0 {
			continue
		}
		castToks := tail[:len(tail)-n]
		if len(castToks) <= vanguardMaxCellWords && !vanguardSpansVotedColumn(castToks) {
			return strings.Join(castToks, " "), strings.Join(tail[len(tail)-n:], " "), true
		}
	}

	// The mirror image: the run OPENS with a listed value of two words or more,
	// so VOTE CAST is that value and the rest is MGMT ("Three Years Non-Voting").
	// A one-word leading match is not enough -- "Withhold All" opens with a
	// listed word and is nonetheless one cell, which the next rule reads.
	if n := vanguardLeadingListedCell(tail); n >= 2 && len(tail)-n <= vanguardMaxCellWords {
		return strings.Join(tail[:n], " "), strings.Join(tail[n:], " "), true
	}

	if len(tail) <= vanguardMaxCellWords && vanguardVoteVocabulary[vanguardCellKey(tail[0])] {
		return strings.Join(tail, " "), "", true
	}

	// The arity of the trailing block is the last structural fact left once the
	// vocabulary has nothing to say and this line printed no gap to split on:
	// the column header the filing printed still says a MGMT column is there,
	// and two tokens filling two cells admit only one boundary.
	if mgmtColumn && len(tail) == 2 {
		return tail[0], tail[1], true
	}

	if len(tail) <= vanguardMaxCellWords && !vanguardSpansVotedColumn(tail) {
		return strings.Join(tail, " "), "", true
	}
	return "", "", false
}

// vanguardSpansVotedColumn reports whether a candidate cell carries a VOTED?
// spelling anywhere but its first token. VOTED? stands immediately LEFT of VOTE
// CAST, so a run containing one in its interior was sliced across a column
// boundary and is not a cell -- the "1 ISSUER YES" of
// "PROPOSAL NO. 1 ISSUER YES FOR FOR". Only the interior is checked, because a
// genuine cell may OPEN with one ("No Action.").
func vanguardSpansVotedColumn(cell []string) bool {
	if len(cell) == 0 {
		return false
	}
	for _, t := range cell[1:] {
		if vanguardVotedVocabulary[vanguardCellKey(t)] {
			return true
		}
	}
	return false
}

// vanguardTrailingListedCell returns the length of the longest trailing run of
// at most maxLen tokens that the vote vocabulary spells out exactly, or 0.
func vanguardTrailingListedCell(toks []string, maxLen int) int {
	for n := maxLen; n >= 1; n-- {
		if vanguardVoteVocabulary[vanguardCellKey(strings.Join(toks[len(toks)-n:], " "))] {
			return n
		}
	}
	return 0
}

// vanguardLeadingListedCell returns the length of the longest LEADING run of at
// most vanguardMaxCellWords tokens that the vote vocabulary spells out exactly
// and that leaves at least one token behind, or 0.
func vanguardLeadingListedCell(toks []string) int {
	maxLen := vanguardMaxCellWords
	if maxLen > len(toks)-1 {
		maxLen = len(toks) - 1
	}
	for n := maxLen; n >= 1; n-- {
		if vanguardVoteVocabulary[vanguardCellKey(strings.Join(toks[:n], " "))] {
			return n
		}
	}
	return 0
}

// vanguardTrailingHeadedCell returns the length of the longest trailing run of
// at most maxLen tokens whose FIRST token is a listed vote spelling, or 0. It is
// what recognises a cell the vocabulary knows the head of but not the whole of
// ("Withhold All", "For All").
func vanguardTrailingHeadedCell(toks []string, maxLen int) int {
	for n := maxLen; n >= 1; n-- {
		if vanguardVoteVocabulary[vanguardCellKey(toks[len(toks)-n])] {
			return n
		}
	}
	return 0
}

// vanguardPeelCell removes the longest run of trailing tokens spelling one value
// of the given vocabulary, preserving the filing's own capitalization.
func vanguardPeelCell(toks []string, vocab map[string]bool) (cell string, remaining []string, ok bool) {
	max := vanguardMaxCellWords
	if max > len(toks) {
		max = len(toks)
	}
	for n := max; n >= 1; n-- {
		candidate := strings.Join(toks[len(toks)-n:], " ")
		if vocab[vanguardCellKey(candidate)] {
			return candidate, toks[:len(toks)-n], true
		}
	}
	return "", toks, false
}

// vanguardCellKey is the lookup form of a cell as printed: case and the
// sentence punctuation filers trail their cells with are not part of the value.
// It is used only for vocabulary lookup; what is RECORDED stays verbatim.
func vanguardCellKey(candidate string) string {
	return strings.ToLower(strings.Trim(candidate, ".,;:"))
}

// vanguardFundLabel reads the fund a `FUND: name` line opens. The 2004-06 cover
// block prints it with a column gap and no colon, `Fund             VANGUARD
// TOTAL STOCK MARKET INDEX FUND` (Vanguard Index Funds 2004: 24,050 rows with
// no series on r204, 457,261 across the filer agent's 95 single-fund filings);
// two spaces after the word are the gap, one space is prose.
func vanguardFundLabel(trimmed string) string {
	upper := strings.ToUpper(trimmed)
	if strings.HasPrefix(upper, "FUND:") {
		return strings.TrimSpace(trimmed[len("FUND:"):])
	}
	// `Name of Fund:   Assetmark Large Cap Growth Fund` (AssetMark Funds 2005,
	// 544 rows with no fund name) is the same label spelled long.
	if strings.HasPrefix(upper, "NAME OF FUND:") {
		return strings.TrimSpace(trimmed[len("NAME OF FUND:"):])
	}
	if strings.HasPrefix(upper, "FUND  ") {
		name := strings.TrimSpace(trimmed[len("FUND"):])
		if name != "" && !strings.Contains(name, ":") {
			return name
		}
	}
	return ""
}
