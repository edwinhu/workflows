package main

import (
	"bytes"
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// The Broadridge / ProxyEdge family is 5,500 legacy filings, 9.3% of all legacy
// N-PX, flat at 200-350/year for nineteen years. 73% name neither "Broadridge"
// nor "ProxyEdge", so the grammar is the only reliable identifier.
//
// A filing is a sequence of MEETING BLOCKS. Each block is
//
//	<issuer name>                       [Agenda Number: 932152666]
//	Security: 060505104                 Meeting Type: Annual
//	Ticker:   BAC                       Meeting Date: 26-May-04
//	<column header, ONE OR TWO physical lines>
//	01       DIRECTOR
//	         1   WILLIAM BARNET, III    Mgmt      For        For
//	02       RATIFICATION OF ...        Mgmt      For        For
//	         ACCOUNTANTS
//
// Three properties of the format drive the parser's shape, and each of them is
// what the previous implementation got wrong. Measured against real filings it
// emitted 180 rows against 200,590 of ground truth.
//
// FIRST, the column header is TWO physical lines in both dominant sub-shapes.
// The spill line carries no item token and no value; it comes FIRST in the
// 'Prop. #' and 'ITEM' variants and SECOND in the 'Prop.#' variant. Treating it
// as an issuer name closes the table before the first proposal is read, which is
// the whole of the 0.090% recall.
//
// SECOND, 57.3% of real rows wrap onto continuation lines. Normalization
// collapses runs of spaces and strips indentation before any layout sees the
// body, so the indentation that separates a continuation from a new row is gone
// and only the LEADING TOKEN can tell them apart. The vote cells sit on the
// first physical line 96.7% of the time and on the last in the tab-delimited
// export, so a row is closed by a blank line, the next item, or the end of the
// block -- never by the arrival of a vote, and never held open past a blank line.
//
// THIRD, meeting context must survive a mid-table page break: 23,581 repeated
// column headers and 19,129 <PAGE> markers occur INSIDE a proposal table with no
// label block after them. A repeated header and a page footer therefore change
// nothing about the block. Context is cleared only at a real block boundary, so
// an identity the filing never stated stays empty rather than being inherited.

// brVoteVocabulary is the vocabulary of the VOTE and FOR/AGAINST MANAGEMENT
// columns. It is deliberately local to this layout: the ISS family's copy is
// owned by a different grammar and the two drift apart.
//
// It is DISJOINT from brTypeVocabulary, and that disjointness is load-bearing --
// brPeelColumns uses "this cell can only be a TYPE value" as its signal that the
// leftmost trailing column has been reached and peeling must stop. 'Non-Voting'
// is a TYPE value (a meeting at which nothing was voted); 'None' is a vote value
// and is also what the sixth column of the six-column shape reads.
var brVoteVocabulary = map[string]bool{
	"for": true, "against": true, "abstain": true, "abstained": true,
	"withhold": true, "withheld": true, "split": true, "none": true,
	"refer": true, "unvoted": true, "n/a": true, "na": true, "tna": true,
	"n/m": true, "---": true, "----": true, "--": true,
	// The For/Against-Management column is printed as a bare asterisk by the
	// vintage Exxon Mobil files. It sits with the other placeholders rather than
	// being a rule of its own -- brPeelCell trims `.,;:` off a candidate but not
	// `*`, so without it the peel fails on the FIRST token from the right and
	// abandons the whole line: both real cells stay in the proposal text, the
	// vote is blank, and a director slate collapses into one row because no
	// nominee line ever shows a vote of its own.
	"*":           true,
	"do not vote": true, "take no action": true, "no action": true,
	"did not vote": true, "no vote": true,
	"one year": true, "two years": true, "three years": true,
	"1 year": true, "2 years": true, "3 years": true,
	"1 yr": true, "2 yrs": true, "3 yrs": true,
	"with management": true, "against management": true, "for and against": true,
}

// brTypeVocabulary is the TYPE column: who put the proposal forward, or that the
// item was not votable at all. 'Shr' is the abbreviation the TIAA-CREF vintage
// uses for a shareholder proposal.
var brTypeVocabulary = map[string]bool{
	"mgmt": true, "mgt": true, "management": true,
	"shr": true, "shrholdr": true, "shrhldr": true, "shrholder": true,
	"shareholder": true, "shareholders": true, "share holder": true,
	"issuer": true, "security holder": true, "other": true,
	"non-voting": true, "non voting": true, "nonvoting": true,
}

// brMaxCellWords bounds how many tokens one peeled cell may span ("1 Year").
const brMaxCellWords = 3

// brLabels is the label vocabulary of a meeting block, longest first so
// "MEETING DATE" is never read as a bare "MEETING" and "TICKER SYMBOL" never as
// a bare "TICKER" whose value is then the literal word SYMBOL.
//
// CITY, COUNTRY and SEDOL earn their place: they are label lines in the ITEM
// sub-shape, and a label line the vocabulary does not know becomes a free
// standing line, which is how the issuer name of that block became "SEDOL(s)".
var brLabels = []string{
	"HOLDINGS RECON DATE", "TICKER SYMBOL", "SECURITY ID",
	"AGENDA NUMBER", "MEETING DATE", "MEETING TYPE", "RECORD DATE",
	"SECURITY", "CUSIP", "TICKER", "AGENDA", "ISIN", "SEDOL",
	"CITY", "COUNTRY",
	// `TYPE: ANNUAL` closing the one-line identity (Baron 2005); without it
	// the meeting date's value ran on into the type and parsed as nothing.
	"TYPE",
}

// brColumnWords is the vocabulary of the column header and of its spill line. A
// line built only from these words is header furniture: it names columns and
// carries no value, so it is neither an issuer name nor a proposal.
var brColumnWords = map[string]bool{
	"PROP": true, "PROPOSAL": true, "PROPOSALS": true, "PROPOSED": true,
	"ITEM": true, "NO": true, "NUM": true, "NUMBER": true, "BY": true,
	"TYPE": true, "VOTE": true, "VOTES": true, "VOTED": true, "CAST": true,
	"FOR": true, "AGAINST": true, "WITHHELD": true,
	"MANAGEMENT": true, "MGMT": true, "MGT": true, "REC": true,
	"RECOMMENDATION": true, "PREFERRED": true, "PROVIDER": true,
	"SPONSOR": true, "DESCRIPTION": true, "SECURITY": true, "HOLDER": true,
}

// brItemFirstWords are the tokens that may open the column header's item
// column. '#' alone is deliberately absent: that is the ISS family's header
// ('#  Proposal  Mgt Rec  Vote Cast  Sponsor'), whose column order TRANSPOSES
// the recommendation and the vote, so claiming it would reverse every row.
var brItemFirstWords = map[string]bool{
	"PROP": true, "PROP.": true, "PROP#": true, "PROP.#": true,
	"PROP.NO": true, "PROP.NO.": true, "PROPNO": true, "ITEM": true,
}

// The item-token patterns. 4,641 of the sampled items (1.9%) are not numeric:
// roman numerals, single letters, letter-digit codes and CMMT annotations all
// occur, and each is a genuine agenda item.
//
// Numeric items are capped at three digits ON PURPOSE. Indentation is gone by
// the time this layout runs, so a continuation line beginning "2002 STOCK PLAN
// AND RESERVE 1,500,000 SHARES" is lexically indistinguishable from a new item
// without that cap -- and reading it as one splits a proposal into two rows,
// inventing an agenda item the filing never had.
var (
	brItemNumeric = regexp.MustCompile(`^[0-9]{1,3}(\.[0-9]{1,3})*[A-Za-z]?[.)]?$`)
	brItemParen   = regexp.MustCompile(`^[0-9]{1,3}\([A-Za-z]\)$`)
	brItemMixed   = regexp.MustCompile(`^[0-9]{1,3}[A-Z][0-9]{1,2}$`)
	// `S.1.1`, `S.5`: a special resolution of a Hong Kong meeting (Hartford
	// Series Fund 2006, Air China; 719 rows with no issuer on r159).
	brItemAlpha = regexp.MustCompile(`^[A-Z](\.?[0-9]{1,2})?(\.[0-9]{1,2}){0,2}$`)
	brItemRoman = regexp.MustCompile(`^([IVX]{1,4}|[ivx]{1,4})$`)
)

// brMonths maps the month spellings of the family's date formats.
var brMonths = map[string]int{
	"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
	"jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

// matchBroadridge recognises the family by its proposal column header, which is
// the line parseBroadridge itself keys on, plus a meeting label somewhere in the
// head. Matching on the labels alone would claim any legacy report that prints a
// ticker, converting an honest skip into an ok with too few rows.
func matchBroadridge(head string) bool {
	up := strings.ToUpper(head)
	if !strings.Contains(up, "MEETING DATE") && !strings.Contains(up, "MEETING TYPE") {
		return false
	}
	for _, line := range strings.Split(up, "\n") {
		if brColumnHeader(line) {
			return true
		}
	}
	return false
}

// brColumnHeader recognises the family's proposal column header in all four of
// its spellings:
//
//	Prop.#  Proposal  Proposal Type  Proposal Vote  For/Against Management
//	Prop. # Proposal  Type  Vote  Management
//	ITEM    PROPOSAL  TYPE  VOTE  FOR/AGAINST MANAGEMENT
//	Item    Proposal  Proposed by  Vote  For/Against Management
//
// 'Prop. #' with a space is 25 files, one of which carries 117,458 rows and was
// invisible to the prefix test this replaces. The match is on the header's FIRST
// TOKEN, not on a prefix, so the spill line "Proposal Proposal For/Against" --
// which begins with the letters P-R-O-P -- is correctly not a header.
func brColumnHeader(line string) bool {
	up := strings.ToUpper(strings.TrimSpace(line))
	if !strings.Contains(up, "PROPOSAL") {
		return false
	}
	if !strings.Contains(up, "VOTE") && !strings.Contains(up, "FOR/AGAINST") {
		return false
	}
	fields := strings.Fields(up)
	if len(fields) == 0 {
		return false
	}
	first := fields[0]
	if !brItemFirstWords[first] {
		// `Proposal Number` opens the item column of the transposed shape (MFS
		// Series Trust XI 2004). The second token must be NUMBER -- a bare
		// PROPOSAL is the header's own spill line, which names no column --
		// and every cell of the line must be one brColumnMap can name, so the
		// reader that claims the shape is the one that can read its columns by
		// their text rather than by position. `Proposal Number | Vote Cast |
		// RV | Proposal` (Gardner Lewis 2005) names no RV and stays with the
		// splittable layout that already reads it.
		if first != "PROPOSAL" || len(fields) < 2 || fields[1] != "NUMBER" {
			return false
		}
		if brBuildColumnMap(strings.TrimSpace(line), nil) == nil {
			return false
		}
	}
	// A bare "PROP" or "ITEM" must still be the item column, not a stray word:
	// the header always names the proposal column somewhere to its right.
	return len(fields) > 1
}

// brColumnFurniture reports whether a line is built only from column-header
// words, which makes it the header's spill line rather than content. Both
// dominant sub-shapes have a two-line header; the spill arrives BEFORE the
// header line in the 'Prop. #' and 'ITEM' variants and AFTER it in 'Prop.#'.
func brColumnFurniture(line string) bool {
	words := brAlphaWords(line)
	if len(words) == 0 {
		return false
	}
	for _, w := range words {
		if !brColumnWords[w] {
			return false
		}
	}
	return true
}

// brAlphaWords splits a line into uppercase alphabetic runs, so "For/Against"
// yields FOR and AGAINST and "Prop.#" yields PROP.
func brAlphaWords(line string) []string {
	var out []string
	var tok strings.Builder
	flush := func() {
		if tok.Len() > 0 {
			out = append(out, tok.String())
			tok.Reset()
		}
	}
	for _, r := range strings.ToUpper(line) {
		if r >= 'A' && r <= 'Z' {
			tok.WriteRune(r)
			continue
		}
		flush()
	}
	flush()
	return out
}

// brPageFurniture recognises the page break that cuts 23,581 proposal tables in
// half. It is NOT a block boundary: the meeting it interrupts continues on the
// next page under a repeated column header with no label block, so a footer must
// leave the issuer, ticker, CUSIP and meeting date exactly as they were.
//
// The date-range footer BEGINS with the words "Meeting Date" at column zero,
// which is why this test runs before the label test rather than after it.
func brPageFurniture(line string) bool {
	up := strings.ToUpper(strings.TrimSpace(line))
	if up == "" {
		return false
	}
	if brDashRule(up) {
		return true
	}
	switch {
	case up == "PROXYEDGE", strings.HasPrefix(up, "PROXYEDGE ") && strings.HasPrefix(strings.TrimSpace(up[len("PROXYEDGE "):]), "REPORT DATE:"),
		up == "INVESTMENT COMPANY REPORT",
		up == "ANNUAL REPORT OF PROXY VOTING RECORD":
		return true
	case strings.HasPrefix(up, "MEETING DATE RANGE"),
		strings.HasPrefix(up, "REPORT DATE:"),
		strings.HasPrefix(up, "PAGE:"):
		return true
	}
	// A wrapped reporting range may share its value line with the page count.
	if f := strings.Fields(up); len(f) == 3 || len(f) == 7 {
		if (f[1] == "-" || f[1] == "TO") && brDate(f[0]) != "" && brDate(f[2]) != "" {
			if len(f) == 3 {
				return true
			}
			_, pageErr := strconv.Atoi(f[4])
			_, totalErr := strconv.Atoi(f[6])
			if f[3] == "PAGE" && f[5] == "OF" && pageErr == nil && totalErr == nil {
				return true
			}
		}
	}
	// "Page 367 of 3908" on its own line, 20,132 occurrences.
	if f := strings.Fields(up); len(f) == 4 && f[0] == "PAGE" && f[2] == "OF" {
		if _, err := strconv.Atoi(f[1]); err == nil {
			return true
		}
	}
	return false
}

// brFundMasthead recognises the fund name between a report date range and
// the repeated proposal header. A name followed by meeting labels is an issuer.
func brFundMasthead(lines []string, i int) bool {
	if brDate(brFirstField(lines[i])) != "" {
		return false
	}
	j := i - 1
	for j >= 0 && strings.TrimSpace(lines[j]) == "" {
		j--
	}
	if j < 0 || !strings.HasPrefix(strings.ToUpper(strings.TrimSpace(lines[j])), "MEETING DATE RANGE") {
		return false
	}
	k := i + 1
	for k < len(lines) && strings.TrimSpace(lines[k]) == "" {
		k++
	}
	return k < len(lines) && (brColumnHeader(lines[k]) || brColumnFurniture(lines[k])) && len(brFindLabels(strings.TrimSpace(lines[i]))) == 0
}

// brDashRule reports whether a line is a horizontal rule. Both '-----' and
// '- -----' occur; the leading '- ' is SGML dash escaping, not content.
//
// The rule is SEGMENTED in one whole vintage -- it underlines each column
// separately rather than spanning the table:
//
//	ITEM   PROPOSAL   TYPE   VOTE   MANAGEMENT
//	- ----   --------   ----   ----   -----------
//
// Requiring ONE unbroken run rejected that line, and a rejected line is not
// furniture: it carries no item token and matches no label, so it fell through
// to free-standing text, which CLOSES THE TABLE. Every proposal after it then
// sat outside a table and was read as prose. The 197 filings broadridge claimed
// and returned nothing from, 155.1 MB, are that one branch. So the rule is a
// line built ONLY from rule characters and the spaces between them.
//
// The floor of three rule characters is what keeps the vote value '---' from
// becoming furniture: a cell holding it is a row with an item token, and this
// test never sees the token, only the line.
func brDashRule(up string) bool {
	s := strings.TrimSpace(up)
	if strings.HasPrefix(s, "- ") {
		s = strings.TrimSpace(s[2:])
	}
	n := 0
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '-', '=', '_':
			n++
		case ' ', '\t':
		default:
			return false
		}
	}
	return n >= 3
}

// ---------------------------------------------------------------------------
// The fund heading, and why it is STATE
// ---------------------------------------------------------------------------
//
// A report body is a sequence of FUND SECTIONS. The fund's name is printed ONCE,
// on its own line immediately above the dashed rule that opens the section's
// first meeting block, and it governs every block after it until the next
// heading: one heading in the Jackson National corpus governs 156,005 lines and
// 23 blocks in the fixture cut from it. So the heading is carried across page
// breaks, repeated column headers and footers exactly as the meeting context is,
// and a rule that attributed only the block its heading physically touches would
// pass a one-block test while stamping almost nothing.
//
// Measured over all 5,412 broadridge filings: the layout stamps nothing today
// and the 6.26% that carries a series_id is entirely the chassis single-series
// fallback. Reading the heading raises that to 66.12% of the rows a filing's own
// header makes attributable.
//
// The heading is matched by EXACT normalised equality against a <SERIES-NAME>
// the filing itself declares, and a heading that resolves to nothing CLEARS the
// state rather than leaving the previous fund standing — inheriting is precisely
// how one fund's votes end up filed under another.
//
// One difference from the raw bytes matters here. The report's own grammar keys
// the heading slot on INDENT: the heading sits at column 0 and the issuer line
// one column in. Normalization strips indentation before any layout sees the
// body, so what survives is ADJACENCY — the slot is the line two above the
// block's `Agenda Number` line, with the opening rule between them — plus the
// furniture rejector below.
//
// The report says to walk upward over SGML-ONLY lines to reach that slot. By the
// time this layout runs there are no SGML lines left: removeMarkup turns a block
// tag such as <PAGE> or </TABLE> into a NEWLINE, so an SGML line standing between
// a heading and its rule arrives here as a BLANK one. The walk is therefore a
// walk over blanks — and blanks are ambiguous, because the slot is also blank in
// 95.5% of blocks, meaning "this block continues the section already open", where
// the line above it is the previous block's last proposal row.
//
// So the two paths are not treated alike. A slot reached DIRECTLY is a heading
// and sets the state, to the series it resolves to or to nothing. A slot reached
// ACROSS a blank acts only when the filing's own header DECLARES that name: being
// declared is the evidence that the line is a fund heading rather than a proposal
// row, and without it the state is left exactly as it was. Clearing on every
// blank-crossed slot would clear the fund at almost every block; stamping on one
// would file a proposal row's text as a fund name.
//
// Declared is deliberately weaker than resolved. A name the header spells for TWO
// distinct series resolves to nothing, but it is still a fund heading — the filing
// has said this section belongs to a fund and declined to say which. It therefore
// clears the state like any other unresolved heading. Requiring resolution here
// would let the section above stand and file this section's votes under it, which
// is the same transfer between funds this whole column must never make.

// brAgendaNeedles are the two spellings of the block opener, lowercase for the
// in-place case-insensitive scan.
var brAgendaNeedles = []string{"agenda number", "agenda #"}

// brSilentNeedles are the ways a fund section says it had nothing to vote. Such
// a section carries a heading and a sentence instead of a block, so no
// `Agenda Number` line ever reaches its heading — and ignoring it is what
// carried one PowerShares fund across two silent sections and onto 398 blocks
// belonging to neither. 6,668 of these resets occur in the corpus.
var brSilentNeedles = []string{
	"held no voting securities",
	"held no securities which required",
	"did not vote any securities",
	"did not vote any proxies",
	"no securities which required a proxy vote",
	"no proxies were voted",
	"held no proxy voting securities",
	"held no proxy voting",
	"report contains no data for selected criteria",
	"has not yet commenced operations",
	"did not receive any proxies",
}

// brSilentNeedleBytes is brSilentNeedles ready for a byte-wise scan of the
// already-lowercased window, built once rather than per block.
var brSilentNeedleBytes = func() [][]byte {
	out := make([][]byte, len(brSilentNeedles))
	for i, s := range brSilentNeedles {
		out[i] = []byte(s)
	}
	return out
}()

// brSilentLookahead is how many lines after the rule the no-activity sentence
// may span. The sentence wraps onto a second and occasionally a third line.
const brSilentLookahead = 3

// brSilentLineCap bounds how many bytes of each lookahead line the silent test
// reads. The longest needle is 44 characters and the sentence is printed at the
// head of its line in every observed spelling, while the lines themselves are
// untrusted third-party bytes from filings that reach 200 MB — so the window is
// capped rather than copied whole.
const brSilentLineCap = 512

// §2.2's furniture rejector — the item-token pattern, the column-header
// vocabulary and the `date of reporting period` line — is deliberately absent.
// Its only possible action on a slot that does not resolve was to leave the
// PREVIOUS fund standing, and that is a wrong series_id rather than a blank one.
// See brResolveHeading.

// brAgendaOpener reports whether a line carries the token that opens a meeting
// block. The scan is case-insensitive in place: this runs on every line of a
// corpus whose largest single filing is 94 MB, and uppercasing a copy of each
// line to find a two-word needle is a per-line allocation for nothing.
func brAgendaOpener(line string) bool {
	return containsAnyFolded(line, brAgendaNeedles)
}

// brHeadingBlankWalk is how many blank lines the upward walk may cross. One is
// the whole reachable range: collapseSpaces (html.go) collapses every run of
// newlines to at most two, so however many block tags and source newlines stand
// between a heading and its rule, they arrive here as exactly one blank line.
// Bounding it at one also keeps the walk from reaching back into the previous
// block on a body that a future normalization change leaves more sparsely spaced.
const brHeadingBlankWalk = 1

// brHeadingSlot returns the line the fund heading would occupy for the block
// opened at lines[i], or "" when that slot holds no candidate. crossedBlank
// reports that the walk stepped over a blank line to reach it, which is the shape
// an SGML line between the heading and the rule leaves behind — and which the
// caller must treat as evidence-only, since it is also the shape of an ordinary
// block continuing the section already open.
func brHeadingSlot(lines []string, i int) (slot string, crossedBlank bool) {
	if i < 2 {
		return "", false
	}
	if !brDashRule(lines[i-1]) {
		return "", false
	}
	j := i - 2
	for steps := 0; j >= 0 && steps < brHeadingBlankWalk && strings.TrimSpace(lines[j]) == ""; steps++ {
		j--
		crossedBlank = true
	}
	if j < 0 {
		return "", false
	}
	slot = strings.TrimSpace(lines[j])
	// A dated Period line sits between the fund and the rule in IronBridge.
	// Read only the immediately preceding heading, never a prior section.
	// Frontegra spells the same line `Reporting Period: 3/23/11 - 6/30/11`, whose
	// two-digit years htmlDate does not read.
	for _, label := range []string{"Period: ", "Reporting Period: "} {
		period, ok := strings.CutPrefix(slot, label)
		if !ok || j == 0 {
			continue
		}
		if start, end, ok := strings.Cut(period, " - "); ok && brPeriodEndpoint(start) && brPeriodEndpoint(end) {
			slot = strings.TrimSpace(lines[j-1])
			break
		}
	}
	if slot == "" || brDashRule(slot) {
		return "", false
	}
	return slot, crossedBlank
}

// brMeetingHeadingRun reports that the rule at lines[i-1] closes the LABEL RUN
// of the meeting heading the vendor has just opened, with no proposal table
// between it and the block opening at lines[i]: an `… Agenda Number:  N` line,
// a rule, the fixed run `Security:` / `Meeting Type:` / `Meeting Date:` /
// `Ticker:` / `ISIN:`, then the rule this block opens under. A meeting that
// carries no proposals at all leaves that run's LAST line exactly where a fund
// heading sits, so `ISIN:  US2605431038` was read as the banner of the section
// it stands inside and every row after it lost the fund (AMG Funds IV 2017,
// S000044915, 1,361 rows). The run belongs to the heading above it, not to the
// section, so the slot is refused and the section's own banner stands.
func brMeetingHeadingRun(lines []string, i int) bool {
	j := i - 2
	for j >= 0 && !brDashRule(lines[j]) && strings.TrimSpace(lines[j]) != "" && len(brFindLabels(lines[j])) > 0 {
		j--
	}
	if j == i-2 || j < 1 || !brDashRule(lines[j]) {
		return false
	}
	return brAgendaOpener(lines[j-1])
}

// brProseBannerWalk is how many unindented prose lines may stand between the
// fund banner and the block rule. The sentence this catches wraps onto two
// lines; three bounds the walk without reaching the block above it.
const brProseBannerWalk = 3

// brBannerAboveProse returns the fund banner of a section whose banner is
// followed by unindented continuation prose before the block rule. The
// registrant prints the banner on its own line and then a wrapped sentence --
// `The fund held no voting securities during the reporting period and did not
// vote any securities or` / `have any securities that were subject to a vote
// during the reporting period.` -- so the heading slot holds the sentence's
// LAST line and the whole section is filed under it (JPMorgan Insurance Trust
// 2015, S000047319, 2,509 blank rows). Prose never resolves and a banner is a
// single line this registrant's own index reads, so the heading is the nearest
// preceding unindented line that resolves. Evidence-only, and no new rung: the
// candidate goes to brResolveHeading unchanged, so a section whose lines above
// resolve to nothing leaves the reading below it standing.
func brBannerAboveProse(ix *issSeriesIndex, lines []string, i int) (string, string) {
	for j, steps := i-3, 0; j >= 0 && steps < brProseBannerWalk; j, steps = j-1, steps+1 {
		cand := lines[j]
		if strings.HasPrefix(cand, " ") || strings.HasPrefix(cand, "\t") {
			return "", ""
		}
		slot := strings.TrimSpace(cand)
		if slot == "" || brDashRule(slot) || brVoteRowSlot(slot) {
			return "", ""
		}
		if id := brResolveHeading(ix, slot); id != "" {
			return slot, id
		}
	}
	return "", ""
}

// brSilentProseRun is how many lines of the no-activity disclaimer the upward
// walk of brBannerAboveSilentProse may read before the rule under the banner.
// The sentence wraps onto two lines and occasionally three, the same span
// brSilentLookahead allows the downward test.
const brSilentProseRun = brSilentLookahead

// brBannerAboveSilentProse returns the section banner of a block whose heading
// slot holds the LAST LINE of the no-activity disclaimer, with the banner's own
// rule between them:
//
//	AMG Aston/Cornerstone Large Cap Value Fund
//	------------------------------------------
//	 The fund held no voting securities during the reporting period and did not vote any securities or have
//	 any securities that were subject to a vote during the reporting period.
//	------------------------------------------
//	 FEDEX CORPORATION                     Agenda Number:  934470218
//
// The disclaimer is BOILERPLATE this registrant prints under every banner, not
// a terminal statement: real ballots follow it in the same section. The slot
// therefore holds a sentence, and `any securities that were subject to a vote
// during the reporting period.` was filed as the fund name of every row under
// six banners of AMG Funds IV 2017 (Anchor Capital, Barings International,
// Cornerstone, Harrison Street, Herndon, TCH Fixed Income).
//
// brBannerAboveProse reads the same shape without the intervening rule and
// stops at one, so nothing reaches this banner. The rule may be crossed only
// because the run below it is the disclaimer: the run must be unbroken, at most
// brSilentProseRun lines, and must carry one of brSilentNeedles. A section that
// states it held nothing AND has no ballots never reaches here at all -- no
// `Agenda Number` line opens under it, so brSilentSection still clears the
// state for that one dormant fund.
//
// The banner is returned unresolved on purpose: this registrant's dictionary
// rung stamps it at row level, the way it does for every other banner the
// header does not declare.
func brBannerAboveSilentProse(lines []string, i int) string {
	var run strings.Builder
	for j, steps := i-2, 0; j >= 0 && steps <= brSilentProseRun; j, steps = j-1, steps+1 {
		cand := strings.TrimSpace(lines[j])
		if cand == "" || brVoteRowSlot(cand) {
			return ""
		}
		if !brDashRule(cand) {
			run.WriteString(cand)
			run.WriteByte(' ')
			continue
		}
		if steps == 0 || !containsAnyFolded(run.String(), brSilentNeedles) {
			return ""
		}
		k := j - 1
		for blanks := 0; k >= 0 && blanks < brHeadingBlankWalk && strings.TrimSpace(lines[k]) == ""; blanks++ {
			k--
		}
		if k < 0 {
			return ""
		}
		banner := strings.TrimSpace(lines[k])
		if banner == "" || brDashRule(banner) || brVoteRowSlot(banner) || brProseSentenceSlot(banner) {
			return ""
		}
		return banner
	}
	return ""
}

// brProseSentenceSlot reports a candidate heading that is a SENTENCE IN FLIGHT:
// it ends on a lower-case word, so the paragraph continues on the next line.
// American AAdvantage Funds 2004 prints an explanatory paragraph under each
// banner of a sleeve that holds no votes -- `The American AAdvantage
// International Equity Index Fund invests all of its` -- whose first line names
// the fund and therefore RESOLVES, and 5,997 rows of the sections below it were
// filed under a sleeve that reports no votes at all. A fund banner is a name,
// never a clause left open.
func brProseSentenceSlot(slot string) bool {
	f := strings.Fields(slot)
	if len(f) == 0 {
		return false
	}
	last := []rune(f[len(f)-1])[0]
	return last >= 'a' && last <= 'z'
}

// brContinuationRunWalk bounds the upward walk of brContinuationRunLine. The
// longest observed wrapped proposal runs nine lines; sixteen clears it without
// reaching back past the block above.
const brContinuationRunWalk = 16

// brContinuationRunLine reports that lines[i] is the MIDDLE of an unbroken run
// of continuation lines under a numbered vote row of this grammar. A wrapped
// proposal reaches the free-standing-text branch one line at a time, so each
// line in turn becomes pendingIssuer and the one before it is offered as a fund
// heading: `BUT NOT LIMITED TO, SHORT-TERM COMMERCIAL`, the fifth line of a
// Chinese debenture mandate, resolved against the declared `Short Term
// Government Income Fund` and stamped S000024676 on 42,761 rows (John Hancock
// Funds II 2015). The evidence is the grammar above the line, not its text: an
// unbroken run of non-blank lines up to a numbered row carrying this grammar's
// own vote cells. MIDDLE is required -- the run's last line stands where a real
// banner can stand, and brProposalContinuationSlot already judges that one.
func brContinuationRunLine(lines []string, i int) bool {
	if i < 1 || i+1 >= len(lines) || strings.TrimSpace(lines[i+1]) == "" {
		return false
	}
	for j, steps := i-1, 0; j >= 0 && steps < brContinuationRunWalk; j, steps = j-1, steps+1 {
		prev := strings.TrimSpace(lines[j])
		if prev == "" || brDashRule(prev) {
			return false
		}
		if item, _ := brSplitItem(lines[j]); item != "" && brVoteRowSlot(prev) {
			return true
		}
	}
	return false
}

// brOpenProposalTail reports that the heading slot holds a line this parser has
// ALREADY read as the tail of the proposal still open. A proposal whose text
// wraps onto a short final line above a block rule leaves that line exactly
// where a heading would sit: `AND IMPROVEMENTS.` closes a Hansberger by-laws
// proposal and then stood as the fund heading of every block after it (Natixis
// Funds Trust I 2011, 1,430 rows named after it with no series). Indentation
// cannot decide this -- the text pipeline has already trimmed the proposal
// column away by the time this grammar is read -- but the accumulated row can:
// a line the open row claims is that row's, and the section already open stands.
func brOpenProposalTail(cur *brRowBuf, slot string) bool {
	if cur == nil || len(cur.text) == 0 {
		return false
	}
	return strings.TrimSpace(cur.text[len(cur.text)-1]) == slot
}

// brProposalContinuationSlot reports that the heading slot holds the WRAPPED
// TEXT of the numbered proposal printed immediately above it, inside the block
// still open. A proposal whose text runs onto a second line leaves that line
// exactly where a fund banner sits when the block closes right after it, and
// `ATTACHED AS APPENDIX  C  TO THE CIRCULAR` became the banner of every block
// from FOREST CITY on (Touchstone Variable Series Trust 2005, 1,844 rows with no
// series). brOpenProposalTail cannot see it -- the issuer heading below closes
// the row before the slot is read -- and stripHTML has already dropped the
// indentation, so the evidence is the line ABOVE the slot: a numbered row
// carrying this grammar's own vote cells. A real banner is printed on its own,
// over a blank line or the block above it, never under a proposal row.
//
// The anchor is the line the slot was READ FROM, found by repeating
// brHeadingSlot's own blank walk: the meeting may end on the wrapped tail, so a
// blank stands between it and the rule (`THE ISSUE OF SHORT-TERM DEBENTURE`,
// John Hancock Funds II 2015, 32,630 rows). Testing lines[i-2] alone reads that
// blank and hides the numbered vote row above the tail.
//
// The anchor itself may be several lines up: a proposal whose text wraps over
// THREE lines leaves a wrapped continuation immediately above the slot, not the
// numbered row (`COMPANY IN THE INTER-BANK BOND MARKET` under `ISSUANCE OF
// MEDIUM-TERM NOTES OF THE`, John Hancock Variable Insurance Trust 2023, 5,553
// rows on S000008214). So the walk climbs the whole unbroken run of non-blank,
// unruled lines above the slot to the numbered row that opened it -- the same
// bounded upward walk brContinuationRunLine and issProposalWrapLine perform --
// rather than testing lines[j-1] alone.
func brProposalContinuationSlot(lines []string, i int, slot string, open bool) bool {
	if !open || i < 2 {
		return false
	}
	j := i - 2
	for steps := 0; j >= 0 && steps < brHeadingBlankWalk && strings.TrimSpace(lines[j]) == ""; steps++ {
		j--
	}
	if j < 1 || strings.TrimSpace(lines[j]) != slot {
		return false
	}
	for k, steps := j-1, 0; k >= 0 && steps < brContinuationRunWalk; k, steps = k-1, steps+1 {
		prev := strings.TrimSpace(lines[k])
		if prev == "" || brDashRule(prev) {
			return false
		}
		if item, _ := brSplitItem(prev); item != "" {
			return brVoteRowSlot(prev)
		}
	}
	return false
}

// brVoteRowSlot reports a heading slot that is a complete PROPOSAL ROW of this
// grammar rather than a name: a director-slate nominee carries the vote columns
// of its own row (`DONALD A. WASHBURN  Mgmt  For  For`), so it is neither the
// wrapped tail brOpenProposalTail catches nor the corporate name brStraySlot
// does, and it stood as the fund of every block after it (Touchstone Strategic
// Trust 2005, 680 rows with no series). A proposal-type token followed by a vote
// token is the grammar's own signature and never occurs in a fund name.
//
// The vocabulary carries the abbreviations this grammar's filings actually
// print. `Shr` and `ShrHoldr` are whole vintages' spelling of the shareholder
// proposal, and without them a COMPLETE row is read as prose and its tail
// promoted: `EQUITY.`, under `5. STOCKHOLDER PROPOSAL REGARDING GENDER PAY
// Shr  For  Against`, took another filer's S000008805 on 39,356 rows (John
// Hancock Funds II 2016).
//
// A COMMENT row is a complete row of this grammar too, and it carries no vote
// cell at all: its type cell reads `Non-Voting` and the FOR/AGAINST columns are
// blank (`CMMT   PLEASE NOTE MINIMUM QUANTITY FOR ATTENDANCE   Non-Voting`).
// The type/vote pair above can never match it, so its wrapped tail stood where
// a banner sits and was resolved by name against an unrelated registrant's
// series (`1000 SHARES` -> Mutual Shares Trust, John Hancock Variable Insurance
// Trust 2014). brCommentRowSlot judges that shape instead.
func brVoteRowSlot(slot string) bool {
	if brCommentRowSlot(slot) {
		return true
	}
	f := strings.Fields(slot)
	for i := 1; i+1 < len(f); i++ {
		switch strings.ToLower(f[i]) {
		case "mgmt", "mgt", "management", "shareholder", "shr", "shrholdr":
			switch strings.ToLower(f[i+1]) {
			case "for", "against", "abstain", "withheld", "withhold", "none", "split":
				return true
			}
		}
	}
	return false
}

// brCommentRowSlot reports a heading slot that is a complete COMMENT ROW of
// this grammar: an item token opening the row and a `Non-Voting` type cell
// standing where a proposal row prints its type and vote. Some vintages print
// the cell truncated by the column width (`Non-Votin`), so the token is matched
// on its prefix. A fund name carries neither an item token nor that cell.
func brCommentRowSlot(slot string) bool {
	f := strings.Fields(slot)
	if len(f) < 2 || !brIsItemToken(f[0]) {
		return false
	}
	for _, tok := range f[1:] {
		if strings.HasPrefix(strings.ToLower(tok), "non-votin") {
			return true
		}
	}
	return false
}

// brRulelessHeadingSlot returns the fund heading of a vintage that draws NO rule
// between blocks at all (Leuthold Funds 2005, 1,372 rows with no series). The
// block opener carries the agenda number, a blank line stands above it, the
// ISSUER name above that, another blank, and the section's fund heading at
// column 0 above them both. brHeadingSlot refuses the block outright because
// lines[i-1] is not a dashed rule, so no heading is ever read. Every ordinary
// continuing block reaches this slot too, which is why the caller acts only on a
// slot the registrant's own series index resolves.
func brRulelessHeadingSlot(lines []string, i int) string {
	if i < 4 || brDashRule(lines[i-1]) || strings.TrimSpace(lines[i-1]) != "" {
		return ""
	}
	j := i - 2
	for j >= 0 && strings.TrimSpace(lines[j]) == "" {
		j--
	}
	// The issuer line the block opens under.
	if j < 1 || brDashRule(lines[j]) || brAgendaOpener(lines[j]) {
		return ""
	}
	j--
	for j >= 0 && strings.TrimSpace(lines[j]) == "" {
		j--
	}
	if j < 0 {
		return ""
	}
	slot := strings.TrimSpace(lines[j])
	// Headings sit at column 0; anything indented there is body text.
	if slot == "" || brDashRule(slot) || strings.HasPrefix(lines[j], " ") || strings.HasPrefix(lines[j], "\t") {
		return ""
	}
	return slot
}

// brPageBannerSlot returns the fund banner a PAGINATED vintage reprints at
// column 0 once per page, one dashed rule further up than brHeadingSlot looks:
// the banner, a rule, the ISSUER, a rule, then the block opener (CM Advisers
// Family of Funds 2009, 43 occurrences of `CM ADVISORS FUND`, all 494 rows
// carrying the issuer as fund_name and a blank series). Every ordinary block of
// the page reaches this slot too -- it is whatever the layout printed four lines
// up -- which is why the caller acts only on a slot the registrant's own series
// index resolves.
func brPageBannerSlot(lines []string, i int) string {
	if i < 4 || !brDashRule(lines[i-1]) || !brDashRule(lines[i-3]) {
		return ""
	}
	if strings.TrimSpace(lines[i-2]) == "" {
		return ""
	}
	j := i - 4
	// Headings sit at column 0; anything indented there is body text.
	if strings.HasPrefix(lines[j], " ") || strings.HasPrefix(lines[j], "\t") {
		return ""
	}
	slot := strings.TrimSpace(lines[j])
	if slot == "" || brDashRule(slot) {
		return ""
	}
	return slot
}

// brPeriodEndpoint reports a date at one end of a printed reporting period,
// including the `3/23/11` two-digit-year spelling htmlDate declines.
func brPeriodEndpoint(s string) bool {
	if htmlDate(s) != "" {
		return true
	}
	f := strings.Split(strings.TrimSpace(s), "/")
	if len(f) != 3 {
		return false
	}
	for i, part := range f {
		want := 2
		if i < 2 {
			want = 1
		}
		if len(part) < want || len(part) > 2 || !isAllDigits(part) {
			return false
		}
	}
	return true
}

// brResolveHeading returns the series a directly-reached slot puts on the state:
// the id it resolves to, or "" when it resolves to nothing at all.
//
// The resolution is tried BEFORE §2.2's furniture rejection on purpose: a slot
// the filing's own header declares under that name is evidence, and the rejector
// is only a heuristic. That override is what recovers 'T. Rowe Price Small Cap
// Growth Portfolio', whose leading 'T.' reads as an item token, and 3,169 blocks
// besides, at a measured cost of nothing.
//
// What the rejector does NOT do is protect the fund above. A slot rejected as
// table furniture is still a heading slot, and leaving the previous fund standing
// there stamps the next section's votes with the previous section's series_id —
// the exact silent transfer between funds this column must never make. So an
// unresolved slot clears the state whether the rejector claims it or not, which
// is §2.2's "a heading that resolves to nothing clears the state" applied to the
// rejector too, and is why the rejector no longer has a branch of its own. Its
// measured cost is the residual's smallest line: 6,572 rows, 0.03%.
func brResolveHeading(ix *issSeriesIndex, slot string) string {
	if d := lookupSeriesTolerant(ix.byName, slot); d != nil {
		return d.SeriesID
	}
	// The rules the ISS layout gained on 2026-09-02 -- an internal code before
	// the name, the registrant's own tokens or initials as a brand, a sleeve
	// after a dash, a trailing parenthetical -- read this grammar's headings
	// too: John Hancock Variable Insurance Trust prints `6741 JHVIT Total Bond
	// Market Trust` for a declared `Total Bond Market Trust`, 1.1M rows with
	// no series. Same discipline: exact after one edit, refused on collision.
	if _, d := issResolveFund(ix, slot); d != nil {
		return d.SeriesID
	}
	if d := brHeadingDropsTypeTail(ix, slot); d != nil {
		return d.SeriesID
	}
	return ""
}

// brTypeTailWord is the closed set of trailing words a printed heading may drop
// off a declared name. They carry no strategy: two declared series never differ
// by these tokens alone, so dropping them cannot merge distinct funds.
var brTypeTailWord = map[string]bool{
	"value": true, "fund": true, "funds": true, "portfolio": true,
	"portfolios": true, "trust": true, "series": true,
}

// brHeadingDropsTypeTail resolves a heading that is the LEADING run of exactly
// one declared name, with every remaining declared token a type word: Third
// Avenue Trust 2012 heads `Third Ave Real Estate` over a declared `THIRD AVENUE
// REAL ESTATE VALUE FUND` (S000001466, 484 rows with no series) and `Third Ave
// Small Cap` over `THIRD AVENUE SMALL-CAP VALUE FUND` (S000001465, 378 rows) --
// the hyphen is already a token separator after folding, so `Small Cap` aligns.
// The existing tail-aligned abbreviation rule cannot reach either, because the
// tokens the heading omits are at the END rather than the front.
//
// The discipline is the one every other tolerance here carries. Each printed
// token must equal its declared token or be a vowel-dropped abbreviation of it
// (`Ave` for `Avenue`), at least two must be spelled in full, the heading must
// carry three tokens of its own, and two declared names answering stamps
// NOTHING -- which is what keeps the sibling `Third Avenue International Real
// Estate Value Fund` from ever being taken by a heading it merely neighbours.
func brHeadingDropsTypeTail(ix *issSeriesIndex, slot string) *SeriesDecl {
	toks := strings.Fields(normalizeSeriesName(slot))
	if ix == nil || len(toks) < 3 {
		return nil
	}
	var hit *SeriesDecl
	for name, d := range ix.byName {
		if d == nil {
			continue
		}
		dt := strings.Fields(name)
		if len(dt) <= len(toks) || len(dt) > len(toks)+2 {
			continue
		}
		tail := true
		for _, t := range dt[len(toks):] {
			if !brTypeTailWord[t] {
				tail = false
				break
			}
		}
		if !tail {
			continue
		}
		exact, fit := 0, true
		for j, t := range toks {
			switch {
			case t == dt[j]:
				exact++
			case issVowelDropped(t, dt[j]):
			default:
				fit = false
			}
			if !fit {
				break
			}
		}
		if !fit || exact < 2 {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// brEqualsRuleHeading reads the fund heading this vintage brackets between two
// rules of '=' instead of printing above the block's dashed rule (North Track
// Funds 2004, 4,145 rows with neither fund nor series). ONLY '=' counts: the
// dashed rule is this grammar's block separator and appears in every section,
// while a text line sandwiched between two '=' rules is a section banner and
// nothing else. The heading sits at column 0, so an indented line there is a
// wrapped proposal rather than a name.
func brEqualsRuleHeading(lines []string, i int) (string, bool) {
	if i < 1 || i+1 >= len(lines) {
		return "", false
	}
	if !brEqualsRule(lines[i-1]) || !brEqualsRule(lines[i+1]) {
		return "", false
	}
	if strings.HasPrefix(lines[i], " ") || strings.HasPrefix(lines[i], "\t") {
		return "", false
	}
	slot := strings.TrimSpace(lines[i])
	if slot == "" {
		return "", false
	}
	return slot, true
}

// brRuleSandwichHeading reads the section masthead this vintage centres between
// two DASHED rules, above the SGML table furniture rather than above the block
// (Century Capital Management Trust 2005, all 816 rows with neither fund nor
// series). The ordinary heading slot cannot reach it: `<TABLE>`, `<S> <C>...`
// and a two-line report banner stand between the masthead and the first block,
// which is more than brHeadingBlankWalk allows. Read on the masthead line
// itself, so the intervening furniture is irrelevant.
//
// The dashed rule is this grammar's block separator, so a sandwich of two is
// only a banner when EXACTLY ONE line stands between them -- the repeated
// proposal header puts two there -- and the caller stamps only on a name the
// registrant's own series index resolves.
func brRuleSandwichHeading(lines []string, i int) (string, bool) {
	if i < 1 || i+1 >= len(lines) {
		return "", false
	}
	if !brDashRule(strings.TrimSpace(lines[i-1])) || !brDashRule(strings.TrimSpace(lines[i+1])) {
		return "", false
	}
	slot := strings.TrimSpace(lines[i])
	if slot == "" || brAgendaOpener(slot) || brVoteRowSlot(slot) || brColumnHeader(lines[i]) {
		return "", false
	}
	if len(brFindLabels(slot)) != 0 {
		return "", false
	}
	return slot, true
}

// brSandwichResolves reports whether a rule-sandwiched masthead names one of
// this registrant's own series. Checked in the branch condition so a sandwich
// that names nothing falls through to the branches below rather than swallowing
// the line.
func brSandwichResolves(ix *issSeriesIndex, slot string) bool {
	_, d := issResolveFund(ix, slot)
	return d != nil
}

// brBannerAboveOpener reads the section masthead this vintage centres over the
// report's `<TABLE>` furniture rather than over a block: `BARON SELECT FUND` /
// `BARON CAPITAL PARTNERS FUND SERIES` above the first meeting (Baron Select
// Funds 2005, all 312 rows with neither fund nor series). The furniture is gone
// by the time this grammar is read and the block opener carries the meeting's
// LABELS rather than an `Agenda Number:`, so the ordinary heading slot -- which
// this grammar reads only on an agenda opener -- never reaches it.
//
// The anchor is the labelled opener two lines below: a banner stands above the
// block rule that introduces a meeting. The registrant's own name sits above the
// series line, so only the line nearest the rule is offered, and the caller
// stamps only on a name the registrant's own series index resolves -- a wrapped
// proposal tail standing in the same place resolves to nothing and leaves the
// section above alone.
func brBannerAboveOpener(lines []string, i int) (string, bool) {
	j := i + 1
	for j < len(lines) && strings.TrimSpace(lines[j]) == "" {
		j++
	}
	if j >= len(lines) || j+1 >= len(lines) || !brDashRule(lines[j]) {
		return "", false
	}
	if len(brFindLabels(lines[j+1])) == 0 {
		return "", false
	}
	slot := strings.TrimSpace(lines[i])
	if slot == "" || slot != strings.ToUpper(slot) || brAgendaOpener(slot) || brVoteRowSlot(slot) || brColumnHeader(lines[i]) {
		return "", false
	}
	if len(brFindLabels(slot)) != 0 {
		return "", false
	}
	return slot, true
}

// brColonBannerHeading reads the fund heading Baron's vintage prints as the
// declared name plus a type word and a COLON, over a rule of its own that is
// not the block opener (`BARON ASSET FUND SERIES:` above a 24-character rule,
// Baron Investment Funds Trust 2006, all 2,976 rows with no series). The colon
// is what separates this banner from the ordinary heading slot, which sits two
// lines above an `Agenda Number` line; without one, a line above a rule is read
// there and nowhere else. The heading sits at column 0.
func brColonBannerHeading(lines []string, i int) (string, bool) {
	if i+1 >= len(lines) || !brDashRule(lines[i+1]) {
		return "", false
	}
	if strings.HasPrefix(lines[i], " ") || strings.HasPrefix(lines[i], "\t") {
		return "", false
	}
	slot := strings.TrimSpace(lines[i])
	if !strings.HasSuffix(slot, ":") || brAgendaOpener(slot) {
		return "", false
	}
	return slot, true
}

// brFundLabels are the labels a cover sheet names its fund with. Unified Series
// Trust staples one sub-adviser's report per series behind a cover reading
// `Fund/Fund Family Name: The Auer Growth Fund/SB Auer Funds, LLC` (Unified
// Series Trust 2013), which this grammar has no heading slot for.
var brFundLabels = []string{"account group", "account name", "fund/fund family name", "fund family name", "fund name", "name of fund", "portfolio name", "series name"}

// brLabelledFundLine returns the value of such a label.
func brLabelledFundLine(line string) (string, bool) {
	low := strings.ToLower(line)
	for _, l := range brFundLabels {
		if !strings.HasPrefix(low, l) {
			continue
		}
		rest := strings.TrimSpace(line[len(l):])
		rest = strings.TrimSpace(strings.TrimLeft(rest, ":-"))
		if rest != "" {
			return rest, true
		}
	}
	return "", false
}

// brResolveLabelledFund resolves such a value: the whole of it, then the half
// before the slash that separates the fund from the adviser reporting it. Only
// a resolution acts -- a cover naming a fund FAMILY rather than a series leaves
// the state exactly as it was rather than clearing it.
func brResolveLabelledFund(ix *issSeriesIndex, value string) *SeriesDecl {
	if _, d := issResolveFund(ix, value); d != nil {
		return d
	}
	if head, _, ok := strings.Cut(value, "/"); ok && strings.TrimSpace(head) != "" {
		if _, d := issResolveFund(ix, strings.TrimSpace(head)); d != nil {
			return d
		}
	}
	return nil
}

// brFundTypeWords are the words a fund heading is spelled with. A slot holding
// none of them names no fund of anybody's.
var brFundTypeWords = map[string]bool{
	"fund": true, "funds": true, "series": true, "portfolio": true,
	"portfolios": true, "trust": true, "account": true, "etf": true,
}

// brStraySlot reports a heading slot that must be left alone: it resolves to
// nothing AND it is not shaped like a fund heading at all, so the section above
// it stands rather than being cleared.
//
// Two shapes reach it. A page break can leave the PREVIOUS meeting's issuer name
// alone in the slot -- `AIRBUS SE` two lines above the AIR LIQUIDE block's rule
// (Manning & Napier Fund 2023, 3,468 rows) -- and a block opened over a rule of
// '=' rather than '-' is separated from the one above it rather than introduced
// by a heading, so its slot holds the tail of the last wrapped proposal
// (`REGISTERED PUBLIC ACCOUNTING FIRM`, Baron Investment Funds Trust 2006).
// Neither is furniture the rejector can claim, and clearing on either drops the
// fund the section's own banner set.
func brStraySlot(ix *issSeriesIndex, rule, slot string) bool {
	if brResolveHeading(ix, slot) != "" {
		return false
	}
	if brEqualsRule(rule) {
		return true
	}
	// An issuer name: a corporate form as its last word and no fund word at
	// all. Furniture ("SEDOL(S) QUICK CODE") carries neither and still clears,
	// because a rejected candidate is a section boundary all the same.
	toks := strings.Fields(normalizeSeriesName(slot))
	if len(toks) < 2 || !brCorporateSuffixes[toks[len(toks)-1]] {
		return false
	}
	for _, t := range toks {
		if brFundTypeWords[t] {
			// A fund word inside a corporate-form name is only a fund signal
			// when this filing's OWN header names the line: `ASHFORD
			// HOSPITALITY TRUST, INC.` is a REIT in the issuer column of
			// Capital Management Investment Trust 2011, whose two declared
			// series are `Capital Management Small-Cap Fund` and `... Mid-Cap
			// Fund`, and reading its `trust` as a heading clears the banner
			// that opened the section and files 12 rows under the issuer.
			// `B&G FOODS, INC.` one section down carries no fund word, is read
			// as the issuer it is, and keeps its banner -- the two blocks are
			// identical in every other respect.
			//
			// Declared rather than resolved is the test, and it is the one the
			// crossedBlank branch above already applies: brResolveHeading has
			// refused this slot by the time we are here, so a header that
			// spells this name for two distinct series still answers declared
			// and is still evidence the line names a fund of this
			// registrant's. Only a name the filing never spells falls through
			// to the issuer reading.
			if _, declared := lookupSeriesTolerantEntry(ix.byName, slot); declared {
				return false
			}
			break
		}
	}
	return true
}

// brCorporateSuffixes are the corporate forms an ISSUER name ends in. A fund
// heading that carries one carries a fund word beside it.
var brCorporateSuffixes = map[string]bool{
	"se": true, "sa": true, "ag": true, "nv": true, "bv": true, "plc": true,
	"spa": true, "ab": true, "asa": true, "oyj": true, "as": true, "kgaa": true,
	"inc": true, "corp": true, "co": true, "ltd": true, "llc": true, "lp": true,
}

// brResolveColonBanner resolves such a banner: the colon comes off, and then the
// type word the banner adds and the declared name does not carry. Only an
// exact resolution counts -- this heading never clears the state, so a line that
// merely ends in a colon leaves the section above exactly as it was.
func brResolveColonBanner(ix *issSeriesIndex, slot string) *SeriesDecl {
	name := strings.TrimSpace(strings.TrimSuffix(slot, ":"))
	if name == "" {
		return nil
	}
	if _, d := issResolveFund(ix, name); d != nil {
		return d
	}
	if f := strings.Fields(name); len(f) > 2 {
		switch strings.ToLower(f[len(f)-1]) {
		case "series", "fund", "portfolio", "trust":
			if _, d := issResolveFund(ix, strings.Join(f[:len(f)-1], " ")); d != nil {
				return d
			}
		}
	}
	return nil
}

// brEqualsRule reports a rule drawn entirely of '='.
func brEqualsRule(line string) bool {
	s := strings.TrimSpace(line)
	if len(s) < 3 {
		return false
	}
	return strings.Trim(s, "=") == ""
}

// brInlineAgendaFund returns the text printed to the LEFT of the block opener's
// `Agenda Number:` label, with the two columns' gap required: a single space
// before the label would make the tail of a long issuer name a candidate.
func brInlineAgendaFund(line string) (string, bool) {
	for _, needle := range brAgendaNeedles {
		k := brIndexFolded(line, needle)
		if k <= 0 {
			continue
		}
		head := strings.TrimRight(line[:k], " \t")
		if len(line[:k])-len(head) < 2 || strings.TrimSpace(head) == "" {
			return "", false
		}
		head = strings.TrimSpace(head)
		// This vintage prints the fund behind its own label in that slot
		// (`Account Group:  FBR Small Cap Financial Fund`, FBR Funds 2004,
		// 2,420 rows with neither fund nor series). The label is what makes the
		// slot a fund rather than the issuer it usually holds, so strip it and
		// let the exact lookup at the call site judge the value.
		if v, ok := brLabelledFundLine(head); ok {
			head = v
		}
		return head, true
	}
	return "", false
}

// brIndexFolded is strings.Index with an ASCII-case-insensitive compare, in
// place: this runs once per meeting block and the corpus carries 2.9 million of
// them, so lowercasing a copy of each line would be an allocation apiece.
// needle must already be lowercase.
func brIndexFolded(text, needle string) int {
	for i := 0; i+len(needle) <= len(text); i++ {
		j := 0
		for ; j < len(needle); j++ {
			c := text[i+j]
			if c >= 'A' && c <= 'Z' {
				c += 'a' - 'A'
			}
			if c != needle[j] {
				break
			}
		}
		if j == len(needle) {
			return i
		}
	}
	return -1
}

// brSilentSection reports whether lines[i] opens a fund section that states it
// held nothing to vote: a heading, the rule under it, and the sentence instead
// of a meeting block.
//
// buf is the caller's scratch, reused across the whole filing: this runs once per
// meeting block and the corpus carries 2,949,449 of them, so a fresh window per
// block is 2.9 million short-lived allocations for one boolean.
func brSilentSection(lines []string, i int, buf *[]byte) bool {
	j := i + 1
	// The report skips SGML-only lines here; markup removal has already turned
	// those into blanks, so blanks are what is skipped. Skipping too eagerly can
	// only CLEAR the carried fund, never misattribute it.
	for j < len(lines) && j <= i+brSilentLookahead && strings.TrimSpace(lines[j]) == "" {
		j++
	}
	if j >= len(lines) || !brDashRule(lines[j]) {
		return false
	}
	end := j + 1 + brSilentLookahead
	if end > len(lines) {
		end = len(lines)
	}
	// The window is lowercased as it is copied, so the needles match with a plain
	// byte search and no second pass folds the case.
	w := (*buf)[:0]
	for k := j + 1; k < end; k++ {
		l := lines[k]
		if len(l) > brSilentLineCap {
			l = l[:brSilentLineCap]
		}
		for x := 0; x < len(l); x++ {
			c := l[x]
			if c >= 'A' && c <= 'Z' {
				c += 'a' - 'A'
			}
			w = append(w, c)
		}
		w = append(w, ' ')
	}
	*buf = w
	for _, needle := range brSilentNeedleBytes {
		if bytes.Contains(w, needle) {
			return true
		}
	}
	return false
}

// brRowBuf accumulates one proposal across its physical lines.
type brRowBuf struct {
	item     string
	text     []string
	typ      string
	vote     string
	forAgnst string
}

// brNumericBannerCode reports whether a section slot is a bare vendor code: an
// unbroken run of digits and nothing else. Capital Group Private Client Services
// Funds 2015 prints eight of them where every other vintage of the same
// registrant prints the sleeve's name (5,555 rows, all eight sections, no series
// and no fund name anywhere in the body). The all-digit shape is the whole
// scope: a named banner carries a letter and is refused here, so nothing this
// function admits could have been resolved by name.
//
// Four digits is the floor. A one- or two-digit line is an item number or a page
// number, and those are what a shorter floor would start counting.
func brNumericBannerCode(s string) bool {
	if len(s) < 4 {
		return false
	}
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return true
}

// brNumericCodeOrdinals maps each bare vendor code the body prints as a section
// banner onto the series the registrant's own header declares at that ordinal
// position, and returns nil unless the filing's shape makes that reading
// unambiguous.
//
// The gate is the count: the body must print exactly as many distinct codes as
// the header declares series, at least two of each. The 2015 Capital Group
// filing prints eight codes and declares eight series, and its own adjacent 2014
// filing prints plain fund-name banners in that same order, section for section
// -- the five sleeves holding no voting securities are the first five in both.
// A filing whose counts disagree offers no such correspondence and gets nothing:
// a wrong series is worse than a blank one.
//
// Only a line in BANNER POSITION counts: unindented, and drawn over the dashed
// rule this vintage rules every section banner with. An all-digit line inside a
// table is a share count or an agenda number, indented by the grammar that
// prints it; an all-digit line in the SGML header is an acceptance datetime or
// the CIK itself, and neither is ruled.
func brNumericCodeOrdinals(lines []string, decls []SeriesDecl) map[string]string {
	if len(decls) < 2 {
		return nil
	}
	var codes []string
	seen := map[string]bool{}
	for i, raw := range lines {
		if raw == "" || raw[0] == ' ' || raw[0] == '\t' {
			continue
		}
		s := strings.TrimSpace(raw)
		if !brNumericBannerCode(s) || seen[s] {
			continue
		}
		j := i + 1
		for j < len(lines) && strings.TrimSpace(lines[j]) == "" {
			j++
		}
		if j >= len(lines) || !brDashRule(lines[j]) {
			continue
		}
		seen[s] = true
		codes = append(codes, s)
		if len(codes) > len(decls) {
			return nil
		}
	}
	if len(codes) != len(decls) {
		return nil
	}
	out := make(map[string]string, len(codes))
	for i, c := range codes {
		if decls[i].SeriesID == "" {
			return nil
		}
		out[c] = decls[i].SeriesID
	}
	return out
}

// brOneWordShortOf reports that got is want with exactly ONE word removed, the
// removed word being neither the first -- which carries the brand -- nor the
// last, which carries the type word. Both keys are already normalised. Nothing
// fuzzy happens here: every other token must agree exactly, in order.
func brOneWordShortOf(want, got []string) bool {
	if len(want) != len(got)+1 {
		return false
	}
	p := 0
	for p < len(got) && want[p] == got[p] {
		p++
	}
	if p < 1 || p > len(want)-2 || issTypeWord(want[p]) {
		return false
	}
	for j := p; j < len(got); j++ {
		if want[j+1] != got[j] {
			return false
		}
	}
	return true
}

// brResidualDeclaredBanner completes, WITHIN ONE FILING AND NEVER ACROSS ONE,
// the pairing that filing's own header and its own body already all but state:
// a banner that resolves to nothing, one series the header declares that no
// banner of this filing claimed, and a banner name that is that declared name
// with exactly one interior word missing.
//
// Alpha Architect ETF Trust (CIK 1592900) declares S000046017 `Alpha Architect
// International Quantitative Value ETF` and prints its banner with `Value`
// dropped outright. A partial name never guesses -- `Alpha Architect
// International Quantitative` is also the declared Momentum sleeve one word
// short -- so the resolver refuses it, and every row of that section carries no
// series. What decides it is not the name but the ACCOUNTING: the banners this
// filing prints claim their declared series one for one, and the pairing is read
// only from what is left over on both sides.
//
// The discipline is the one the rest of this parser keeps -- one hit stamps, two
// refuse (see issVowelDroppedAbbrev, and lookupSeriesEntry, where a name two
// series answer to maps to nothing). A banner that is one word short of TWO
// unclaimed declared names is a choice between two of the registrant's own
// sleeves, and there is NO tiebreak: nothing is stamped and the banner stays
// unresolved. An ordinal or nearest-fund reading of the section order would
// resolve some of those, but series_id is a link key -- a positional guess
// between two of the registrant's own sleeves mis-attributes ballots silently,
// and a blank is the cheaper error. That reading was gated REVERT once already
// (CIK 1064642, the SPDR/streetTRACKS continuation banner) and does not come
// back here.
//
// Scope: the filing's OWN header (decls) and its OWN body, so nothing here can
// move a vote onto another registrant's fund. A banner the chain already resolves
// is left exactly as it is; this only ever fills a blank.
func brResidualDeclaredBanner(lines []string, decls []SeriesDecl, ix *issSeriesIndex) map[string]string {
	if ix == nil || len(decls) < 2 {
		return nil
	}
	type bannerHit struct {
		slot string
		// id is the series the chain already answers for this banner, empty
		// when it answers nothing.
		id string
	}
	var order []bannerHit
	claimed := map[string]bool{}
	seen := map[string]bool{}
	for i, raw := range lines {
		// Banner position, the same shape brNumericCodeOrdinals reads:
		// unindented and drawn over the dashed rule this vintage rules every
		// section banner with.
		if raw == "" || raw[0] == ' ' || raw[0] == '\t' {
			continue
		}
		slot := strings.TrimSpace(raw)
		if slot == "" || seen[slot] || brVoteRowSlot(slot) {
			continue
		}
		j := i + 1
		for j < len(lines) && strings.TrimSpace(lines[j]) == "" {
			j++
		}
		if j >= len(lines) || !brDashRule(lines[j]) {
			continue
		}
		seen[slot] = true
		id := ""
		if _, d := issResolveFund(ix, slot); d != nil {
			id = d.SeriesID
		}
		if id != "" {
			claimed[id] = true
		}
		order = append(order, bannerHit{slot: slot, id: id})
	}

	var out map[string]string
	// takenBy carries the banner a declared series was paired with, and an empty
	// string once a second banner reached it: two banners naming one series is a
	// refusal for BOTH, not a race the first one wins.
	takenBy := map[string]string{}
	for _, b := range order {
		if b.id != "" {
			continue
		}
		toks := strings.Fields(normalizeSeriesName(b.slot))
		// Name-shaped only: a registered fund's name carries a type word, and
		// proposal text and issuer names do not end in one.
		if len(toks) < 3 || !issTypeWord(toks[len(toks)-1]) {
			continue
		}
		var cand []int
		for i, d := range decls {
			if d.SeriesID == "" || claimed[d.SeriesID] {
				continue
			}
			if brOneWordShortOf(strings.Fields(normalizeSeriesName(d.Name)), toks) {
				cand = append(cand, i)
			}
		}
		pick := -1
		if len(cand) == 1 {
			pick = cand[0]
		}
		if pick < 0 {
			continue
		}
		id := decls[pick].SeriesID
		if first, dup := takenBy[id]; dup {
			if first != "" {
				delete(out, first)
			}
			takenBy[id] = ""
			continue
		}
		takenBy[id] = b.slot
		if out == nil {
			out = map[string]string{}
		}
		out[b.slot] = id
	}
	return out
}

// parseBroadridge walks the meeting blocks, carrying the current meeting context
// onto every proposal row it completes.
//
// A body the matcher claimed but from which no proposal row could be read is an
// error, not an empty success: reporting "we parsed it and there was nothing"
// for a filing that plainly carries a vote table is the silent loss this parser
// is being repaired for.
func parseBroadridge(text string, meta FilingMeta) ([]VoteRow, error) {
	// Built ONCE per filing: a filing reaches 2.9 million blocks, and rebuilding
	// the name index per block would make the grid job a function of the square
	// of the body. A name two distinct series answer to maps to nothing, which is
	// what keeps an ambiguous heading from stamping either of them.
	seriesIx := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))
	issFormerKeys(seriesIx, meta.FormerNames)
	seriesIdx := seriesIx.byName

	var (
		rows      []VoteRow
		curSeries string
		// curFund is the heading text as printed, recorded on every row of the
		// section whether or not it resolved, so an unresolved heading is
		// visible downstream instead of a bare blank (3.8M rows of this
		// filer-agent vintage carried neither on 2026-09-02).
		curFund string

		issuer  string
		ticker  string
		cusip   string
		isin    string
		mtgDate string
		mtgType string
		recDate string

		pendingIssuer string
		// The line pendingIssuer was read from, so the grammar above it can be
		// consulted before it is offered as a fund heading.
		pendingIssuerAt = -1
		headerText      string
		spill           []string
		// colMap is set from a header whose every cell could be named; see
		// brColumnMap.
		colMap *brColumnMap

		hasType bool
		maxVote = 2

		inTable  bool
		sawTable bool
		cur      *brRowBuf

		// framed records that the meeting's identity came from a rule-framed
		// block (brRuleFramedIdentity), which states the issuer outright. The
		// free-standing furniture this vintage prints under that block -- `VOTE
		// GROUP: GLOBAL` -- must not then be promoted into the issuer slot by
		// the `AGENDA:` line beneath it.
		framed bool

		// The item and slate head of the row flush() last emitted, so a
		// nominee line printed BELOW a blank line -- which flushed the item
		// row before it -- still hangs under that item. Cleared at boundary(),
		// because the next meeting's rows belong to no item of this one.
		lastItem  string
		lastSlate string

		// Scratch for the silent-section window, allocated once per filing.
		silentBuf = make([]byte, 0, brSilentLookahead*(brSilentLineCap+1))
	)

	// flush emits the open row. A row is emitted whenever it has an item token,
	// even with no vote and no text: an agenda item the fund reported but did
	// not vote must stay distinguishable from an item the fund never held. The
	// uncertain field is left EMPTY; the row is never discarded.
	flush := func() {
		if cur == nil {
			return
		}
		if cur.item != "" {
			rows = append(rows, VoteRow{
				SeriesID:                 curSeries,
				FundName:                 curFund,
				IssuerName:               issuer,
				Ticker:                   ticker,
				CUSIP:                    cusip,
				ISIN:                     isin,
				MeetingDate:              mtgDate,
				MeetingType:              mtgType,
				RecordDate:               recDate,
				ItemSeq:                  cur.item,
				VoteDescription:          strings.Join(cur.text, " "),
				HowVoted:                 cur.vote,
				VoteSource:               cur.typ,
				ManagementRecommendation: cur.forAgnst,
			})
			lastItem, lastSlate = cur.item, brSlateHead(cur)
		}
		cur = nil
	}

	// boundary closes the meeting block the last table belonged to. EVERY field
	// of the meeting context is cleared, so a block that states only a CUSIP and
	// a date -- routine in ProxyEdge output for unlisted and foreign holdings --
	// emits an empty ticker and issuer rather than the previous meeting's.
	// Attributing a vote to an issuer the filing never associated with that
	// CUSIP is worse than emitting no row at all.
	//
	// It is called ONLY when a new label block opens or free-standing text ends
	// the table -- never at a repeated column header or a page footer, which are
	// interruptions inside one meeting rather than the end of it.
	repeatHeader := false
	boundary := func() {
		repeatHeader = false
		if !sawTable {
			return
		}
		sawTable = false
		inTable = false
		issuer, ticker, cusip, isin = "", "", "", ""
		mtgDate, mtgType, recDate = "", "", ""
		framed = false
		lastItem, lastSlate = "", ""
	}

	lines := strings.Split(text, "\n")
	// Built once per filing, and nil for every filing that prints a fund name
	// where a fund name belongs; see brNumericCodeOrdinals.
	codeOrdinal := brNumericCodeOrdinals(lines, meta.SeriesDecls)
	// Also built once per filing, and nil for every filing whose banners all
	// answer; see brResidualDeclaredBanner.
	residual := brResidualDeclaredBanner(lines, meta.SeriesDecls, seriesIx)
	// The tail of a rule-framed identity block, read whole at its first line;
	// its remaining label lines must not open blocks of their own.
	framedUntil := -1
	for i, raw := range lines {
		if i <= framedUntil {
			continue
		}
		line := strings.TrimSpace(raw)
		if line == "" {
			flush()
			continue
		}

		// This vintage prints the whole meeting identity as a block framed by
		// two dashed rules, whose FIRST line leads with the issuer's NAME and
		// carries `<QUALIFIER> MEETING DATE:` to its right. None of its labels
		// leads a line, so brFindLabels reads none of them (and must not be
		// loosened to: its two-label floor is what keeps a proposal naming
		// "Annual Meeting Date" from closing a table). Read as a unit instead.
		if id := brRuleFramedIdentity(lines, i); id != nil {
			flush()
			boundary()
			inTable = false
			spill = nil
			pendingIssuer = ""
			issuer, ticker, cusip, mtgDate = id.issuer, id.ticker, id.cusip, id.mtgDate
			framed = true
			framedUntil = id.end
			continue
		}

		// The fund heading, before anything else this line does. Whichever way
		// the state moves, the row still open belongs to the block ABOVE this
		// one, so it is emitted under the fund that was current when it was read.
		if !brDashRule(line) {
			// A labelled line that also opens a meeting block carries the
			// agenda number to its right; it belongs to the block-opener branch
			// below, which cuts at the label before reading the slot.
			if slot, ok := brLabelledFundLine(line); ok && !brAgendaOpener(line) {
				if d := brResolveLabelledFund(seriesIx, slot); d != nil {
					flush()
					curSeries, curFund = d.SeriesID, slot
				}
			} else if slot, ok := brEqualsRuleHeading(lines, i); ok {
				// A line bracketed between two bare '=' rules is this vintage's
				// section banner and nothing else, so it NAMES the section
				// whether or not the registrant's own index reads it. American
				// AAdvantage Funds 2004 prints eighteen of them and only some
				// resolve under the 2004 spelling; acting only on the ones that
				// do leaves the sleeve above standing over a section whose own
				// banner does not name it, and 5,997 rows carried a series from
				// a section that reports no votes at all. A blank series under
				// the banner that was printed is the honest reading.
				flush()
				curFund, curSeries = slot, ""
				if _, d := issResolveFund(seriesIx, slot); d != nil {
					curSeries = d.SeriesID
				}
			} else if slot, ok := brRuleSandwichHeading(lines, i); ok && brSandwichResolves(seriesIx, slot) {
				_, d := issResolveFund(seriesIx, slot)
				flush()
				curSeries, curFund = d.SeriesID, slot
			} else if slot, ok := brBannerAboveOpener(lines, i); ok && brSandwichResolves(seriesIx, slot) {
				_, d := issResolveFund(seriesIx, slot)
				flush()
				curSeries, curFund = d.SeriesID, slot
			} else if slot, ok := brColonBannerHeading(lines, i); ok {
				if d := brResolveColonBanner(seriesIx, slot); d != nil {
					flush()
					curSeries, curFund = d.SeriesID, slot
				}
			} else if brAgendaOpener(line) {
				// The fund name may share the block-opener's line, printed to
				// the left of the `Agenda Number:` label (Calamos Investment
				// Trust 2004, 4,144 rows with neither fund nor series). That
				// slot normally holds the ISSUER, so it counts only when it
				// resolves to one of this registrant's own series; an issuer
				// name never does, and a slot that does not resolve leaves the
				// section above standing rather than clearing it.
				// EXACT only. This slot normally holds the issuer, and a
				// one-edit reading of one turns it into a fund: `PLAINS
				// EXPLORATION & PRODUCTION CO.` resolves to `PowerShares
				// Dynamic Energy Exploration & Production Portfolio` and
				// carried S000003041 onto 6,203 rows of other portfolios
				// (PowerShares Exchange Traded Fund Trust 2008). Only a name
				// the header spells outright may be read here.
				if slot, ok := brInlineAgendaFund(line); ok {
					d, _ := lookupSeriesEntry(seriesIdx, slot)
					if d == nil {
						// The slot may drop the declared name's terminal type
						// word: `TrendStar American Endeavor` for a declared
						// `TRENDSTAR AMERICAN ENDEAVOR FUND` (TrendStar
						// Investment Trust 2004, all 634 rows with neither
						// fund nor series). Still EXACT, and appending the type
						// word does not reopen the issuer failure mode above --
						// an issuer name plus `Fund` is not a declared series
						// name.
						d, _ = lookupSeriesEntry(seriesIdx, slot+" Fund")
					}
					if d != nil {
						flush()
						curSeries, curFund = d.SeriesID, slot
					}
				}
				if slot := brRulelessHeadingSlot(lines, i); slot != "" && !brVoteRowSlot(slot) {
					if _, d := issResolveFund(seriesIx, slot); d != nil {
						flush()
						curSeries, curFund = d.SeriesID, slot
					}
				}
				if slot, crossedBlank := brHeadingSlot(lines, i); slot != "" && !brOpenProposalTail(cur, slot) && !brVoteRowSlot(slot) && !brMeetingHeadingRun(lines, i) && !brProposalContinuationSlot(lines, i, slot, sawTable) {
					if crossedBlank {
						// Evidence-only: act solely on a name this filing's own
						// header declares, because this slot is also what an
						// ordinary continuing block looks like.
						//
						// DECLARED is the evidence, not resolved. A name the
						// header spells for two distinct series is still proof
						// that this line is a fund heading; what the filing
						// withholds is only WHICH fund. So it clears the state
						// like any other heading that resolves to nothing.
						// Falling through would leave the section above standing
						// and file this fund's votes under it.
						if d, declared := lookupSeriesTolerantEntry(seriesIdx, slot); declared {
							flush()
							curSeries = ""
							curFund = slot
							if d != nil {
								curSeries = d.SeriesID
							}
						} else if _, d := issResolveFund(seriesIx, slot); d != nil {
							// The <TABLE>/<S> <C> furniture normalizes to one blank
							// line, so a section's FIRST heading reaches this slot
							// with crossedBlank set (John Hancock Funds III 2008,
							// `2CVM Intrinsic Value Fund`, 2,565 rows; Touchstone
							// 2006, `Touchstone Value Plus Fund` over a declared
							// `Value Plus Fund`, 2,499). A slot this registrant's own
							// resolver reads after ONE edit -- code prefix, brand --
							// is the same evidence a declared name is, and refuses a
							// collision the same way. A continuing block's opener
							// resolves to nothing and still leaves the section above
							// standing.
							flush()
							curSeries, curFund = d.SeriesID, slot
						}
					} else if brStraySlot(seriesIx, lines[i-1], slot) {
						// A block opened over a rule of '=' is separated from the
						// one above it, not introduced by a heading: this vintage
						// draws its section banner over a DASHED rule and closes
						// each block with an equals rule, so the slot holds the
						// tail of the last proposal (`REGISTERED PUBLIC ACCOUNTING
						// FIRM`, Baron Investment Funds Trust 2006). Clearing here
						// would drop the banner's fund at the second block of every
						// section; recording the slot would file a proposal row as
						// a fund name. Only a slot that RESOLVES acts.
					} else {
						flush()
						curSeries = brResolveHeading(seriesIx, slot)
						// Headings sit at column 0; the slot is lines[i-2] when
						// reached directly. An indented line there is a wrapped
						// proposal, not a name worth recording.
						curFund = ""
						if !strings.HasPrefix(lines[i-2], " ") && !strings.HasPrefix(lines[i-2], "\t") {
							curFund = slot
						}
						// The slot may hold the last line of prose the banner
						// prints beneath itself; the banner is the nearest
						// unindented line above that resolves.
						if curSeries == "" {
							if banner, id := brBannerAboveProse(seriesIx, lines, i); id != "" {
								curSeries, curFund = id, banner
							}
						}
						// The prose may be the no-activity disclaimer printed
						// UNDER the banner's own rule, with real ballots after
						// it. The banner is one rule further up, and is taken
						// whether or not the header declares it -- the sentence
						// the slot holds is never a fund name.
						if curSeries == "" {
							if banner := brBannerAboveSilentProse(lines, i); banner != "" {
								curFund = banner
								curSeries = brResolveHeading(seriesIx, banner)
							}
						}
					}
				}
				// Read after the slot above, which on this vintage holds the
				// ISSUER and leaves the section blank: the page banner one rule
				// further up is the fund. Evidence-only, so a block whose
				// fourth line up is ordinary body text leaves the section
				// standing.
				if slot := brPageBannerSlot(lines, i); slot != "" && !brVoteRowSlot(slot) {
					if _, d := issResolveFund(seriesIx, slot); d != nil {
						flush()
						curSeries, curFund = d.SeriesID, slot
					}
				}
			} else if brSilentSection(lines, i, &silentBuf) {
				flush()
				curSeries = ""
				curFund = ""
			}

			// The section the branches above recorded may be a bare vendor
			// code rather than a name. No name-based rung can ever reach one,
			// so the ordinal run is the only identity the document offers.
			if codeOrdinal != nil && curSeries == "" && curFund != "" {
				if id, ok := codeOrdinal[curFund]; ok {
					curSeries = id
				}
			}

			// The section may be named by a banner the chain refuses and this
			// filing's own left-over declaration answers; see
			// brResidualDeclaredBanner. Fills a blank only.
			if residual != nil && curSeries == "" && curFund != "" {
				if id, ok := residual[curFund]; ok {
					curSeries = id
				}
			}
		}

		if brColumnHeader(line) {
			flush()
			// A column header repeated inside an open meeting is a page
			// break; the text that follows it before any item is the tail of
			// the row the page cut (Hartford Series Fund 2006, Air China:
			// `preliminary prospectus, the prospectus,` opened no meeting of
			// its own and closed Air China's).
			repeatHeader = sawTable
			headerText = strings.Join(append(spill, line), " ")
			colMap = brBuildColumnMap(line, spill)
			spill = nil
			hasType, maxVote = brColumnShape(headerText)
			inTable, sawTable = true, true
			continue
		}

		// The header's spill line. It must not close the table, must not become
		// an issuer name, and its words tell us whether the table has a TYPE
		// column and a sixth PREFERRED PROVIDER column.
		// `COMPANY NAME | TICKER | SECURITY ID ON BALLOT | MEETING DATE |
		// MEETING TYPE` over `Analog Devices, Inc. | ADI | 032654105 |
		// 20-Jul-09 | Special`: the identity as a column header and one value
		// line (First Trust Active Dividend Income Fund 2010, 1,101 rows with
		// no issuer, id or date on r179). The header's spill (`BALLOT`) and
		// tag furniture sit between; the value line is split on wide gaps.
		if fields := brIdentityColumnHeader(line); fields != nil {
			k := i + 1
			for k < len(lines) && (strings.TrimSpace(lines[k]) == "" || brColumnFurniture(lines[k]) || brPageFurniture(lines[k]) || brIdentityHeaderSpill(lines[k])) {
				k++
			}
			if k < len(lines) {
				if vals := brSplitWide(lines[k]); len(vals) == len(fields) {
					flush()
					boundary()
					inTable = false
					spill = nil
					pendingIssuer = ""
					for j, f := range fields {
						switch f {
						case "ISSUER":
							issuer = vals[j]
						case "TICKER":
							ticker = brFirstField(vals[j])
						case "SECURITY ID":
							if id := brFirstField(vals[j]); brLooksLikeSecurityID(id) {
								cusip = id
							}
						case "MEETING DATE":
							mtgDate = brDate(vals[j])
						case "MEETING TYPE":
							mtgType = vals[j]
						}
					}
					i = k
					continue
				}
			}
		}
		// A label line whose value carries no letter reduces to the label word
		// alone, which is itself a column word: `Security:  46655@109` (JNL
		// Series Trust 2021) reads as header spill and the id is lost, while the
		// sibling `Security:  46628D411` survives on the letter in its id. A
		// label WITH a value is never furniture.
		if cur == nil && brColumnFurniture(line) && !brValuedLabelLine(line) {
			if inTable {
				headerText += " " + line
				hasType, maxVote = brColumnShape(headerText)
			} else {
				spill = append(spill, line)
			}
			continue
		}

		if inTable && strings.EqualFold(line, "Comments:") {
			continue
		}
		if brPageFurniture(line) || brFundMasthead(lines, i) {
			continue
		}

		// A header whose every cell could be named is read BY COLUMN, never by
		// the trailing-cell order: this vintage prints the fund's vote to the
		// LEFT of the management recommendation, so the positional peel would
		// swap the two on every row. A label line still opens a meeting block
		// and is left to the branches below.
		if inTable && colMap != nil && !brDashRule(line) && len(brFindLabels(line)) == 0 {
			if it, vote, mgmt, desc, ok := colMap.read(brSplitWide(line)); ok {
				switch {
				case it != "" && brIsItemToken(it):
					flush()
					cur = &brRowBuf{item: brNormalizeItem(it)}
				case cur != nil && vote != "" && cur.vote != "":
					// A nominee of the slate above votes under the item the
					// slate opened; see the slate rule in brAbsorb's caller.
					parent := cur.item
					parentText := brSlateHead(cur)
					flush()
					cur = &brRowBuf{item: parent}
					if parentText != "" {
						cur.text = append(cur.text, parentText)
					}
				case cur == nil && vote != "" && lastItem != "":
					// A slate whose nominees are printed BELOW a blank line:
					// the blank flushed the item row, so there is no open row
					// to hang them on. The header map reads a vote in this
					// line, and an item-less row that votes can only be a
					// nominee of the item just emitted -- reopen its slate.
					cur = &brRowBuf{item: lastItem}
					if lastSlate != "" {
						cur.text = append(cur.text, lastSlate)
					}
				}
				if cur != nil {
					if desc != "" {
						cur.text = append(cur.text, desc)
					}
					if vote != "" && cur.vote == "" {
						cur.vote = vote
					}
					if mgmt != "" && cur.forAgnst == "" {
						cur.forAgnst = mgmt
					}
				}
				continue
			}
		}

		item, rest := brSplitItem(line)

		// A WRAPPED LINE THAT HAPPENS TO START WITH A NUMERAL IS NOT A NEW ITEM:
		//
		//	2      TO CONSIDER AND APPROVE THE REPORT OF THE   Mgmt   For   For
		//	       SUPERVISORY COMMITTEE OF THE COMPANY (THE
		//	       "SUPERVISORY COMMITTEE") FOR THE YEAR ENDED
		//	       31 DECEMBER 2020
		//
		// brSplitItem reads `31` as an item token, which costs twice: item 2's
		// description is truncated at "FOR THE YEAR ENDED", and a junk row
		// appears carrying item `31` with no proponent and no vote. Measured
		// 2026-09-01 on 0001438934-21-000135.txt, 3,402 of its rows carry
		// neither, led by 148 copies of `31 | DECEMBER 2020`.
		//
		// The discriminator is the slate rule in reverse: a real item row inside
		// a table brings cells of its own. An agenda item the fund reported but
		// did not vote still carries a proponent (`Mgmt`, `Non-Voting`), which
		// is a cell, so it is not swallowed here.
		if inTable && cur != nil && item != "" {
			if _, typ, vote, forAgnst := brPeelColumns(rest, hasType, maxVote); typ == "" && vote == "" && forAgnst == "" {
				item, rest = "", line
			}
		}

		// Inside a table, a line with no item token continues the row above it.
		// 1,866 continuation lines begin with a label word -- the worst being a
		// line that is exactly "MEETING DATE", the wrapped tail of "STOCKHOLDER
		// PROPOSAL - ANNUAL MEETING DATE" -- so the label test must not see it.
		// A wrapped row stays open until a line that cannot be its text: the
		// dashed rule that closes a block, or a label line. Without this the
		// rule, the next issuer's name and its `Security 968223206` line were
		// all absorbed into item 03's text, and the meeting that followed had
		// no id or issuer of its own (Clearwater Investment Trust 2007: 693 of
		// 722 meetings, their rows carrying the previous meeting's CUSIP).
		if inTable && cur != nil && item == "" && (brValuedLabelLine(line) || brIssuerHeading(lines, i)) {
			flush()
		}
		if inTable && cur != nil && item == "" {
			// A DIRECTOR SLATE'S NOMINEES CARRY THEIR OWN VOTES AND ARE NOT
			// CONTINUATIONS. One proposal number covers the whole slate and each
			// nominee is its own line, un-numbered, with its own cells:
			//
			//	1.     DIRECTOR
			//	       Alan S. Armstrong      Mgmt   Withheld   Against
			//	       C. Fred Ball, Jr.      Mgmt   For        For
			//	       Steven Bangert         Mgmt   Withheld   Against
			//
			// brAbsorb fills only columns that are still EMPTY -- which is what
			// makes the tab-delimited export work, where the vote arrives on the
			// LAST line of a wrapped proposal -- so every nominee after the first
			// had their vote silently discarded and the slate collapsed into one
			// row. Measured 2026-08-31 against ISS: BOK Financial read 3 items
			// where ISS counts 24, and the one row it did emit reported
			// `Withheld`, which is Armstrong's vote, for a slate on which Ball
			// voted For. That is a WRONG vote, not merely a missing one, and
			// broadridge carries 84% of all detected partial parsing --
			// 1,169,008 items lost across 2,128 filings at an 8.0% loss rate.
			//
			// The discriminator is that the line brings a vote of its own while
			// the row already has one. A genuine continuation carries no vote
			// cells: they sit on the first physical line 96.7% of the time, and
			// the tab-delimited case is unaffected because there cur.vote is
			// still empty when the vote line arrives.
			if _, _, vote, _ := brPeelColumns(rest, hasType, maxVote); vote != "" && cur.vote != "" {
				parent := cur.item
				parentText := brSlateHead(cur)
				flush()
				cur = &brRowBuf{item: parent}
				brAbsorb(cur, rest, hasType, maxVote)
				if parentText != "" {
					cur.text = append([]string{parentText}, cur.text...)
				}
				continue
			}
			brAbsorb(cur, rest, hasType, maxVote)
			continue
		}

		if item == "" {
			if labels := brFindLabels(line); len(labels) > 0 {
				flush()
				boundary()
				inTable = false
				spill = nil
				// A block whose identity was stated outright keeps it: the
				// free-standing `VOTE GROUP: GLOBAL` beneath it is the report's
				// own furniture, and the `AGENDA:` line below promotes whatever
				// preceded it.
				if pendingIssuer != "" && !framed {
					issuer = pendingIssuer
					pendingIssuer = ""
				}
				for label, v := range labels {
					switch label {
					case "ISSUER":
						issuer = v
					case "TICKER", "TICKER SYMBOL":
						ticker = brFirstField(v)
					case "CUSIP", "SECURITY ID", "SECURITY":
						if id := strings.TrimSuffix(brFirstField(v), ","); brLooksLikeSecurityID(id) {
							cusip = id
						}
					case "ISIN":
						isin = brFirstField(v)
					case "MEETING DATE":
						mtgDate = brDate(v)
					case "MEETING TYPE", "TYPE":
						mtgType = v
					case "RECORD DATE":
						recDate = brDate(v)
					}
				}
				continue
			}

			// Free-standing text. It ends any open table and is the candidate
			// issuer name for the block whose label lines follow it -- unless
			// it is the tail of a row a page break cut, which names nothing.
			if repeatHeader && !brIssuerHeading(lines, i) && !brNameOpensBlock(lines, i) {
				continue
			}
			// An unnumbered row that carries its vote cells (`PLEASE NOTE
			// THAT THIS IS A MIX MEETING.  Non-Voting  No vote`, the note
			// that opens a Hartford Series Fund 2006 meeting) is a row of the
			// open table, not the next meeting's name.
			if inTable && cur == nil && !brNameOpensBlock(lines, i) {
				if _, typ, vote, _ := brPeelColumns(line, hasType, maxVote); vote != "" || typ != "" {
					cur = &brRowBuf{}
					brAbsorb(cur, line, hasType, maxVote)
					continue
				}
			}
			flush()
			boundary()
			inTable = false
			spill = nil
			// TWO free-standing lines before a block's label lines: the first
			// is the section's fund heading and the second the issuer the
			// block opens under (Forum Funds 2004 prints 17 bare column-0
			// headings, one blank line above the issuer, with no rule over or
			// under them -- all 500 rows carry neither fund nor series).
			// Evidence-only, so an issuer name wrapped over two lines leaves
			// the section already open standing.
			if pendingIssuer != "" && !brProseSentenceSlot(pendingIssuer) && !brContinuationRunLine(lines, pendingIssuerAt) {
				if _, d := issResolveFund(seriesIx, pendingIssuer); d != nil {
					curSeries, curFund = d.SeriesID, pendingIssuer
				}
			}
			pendingIssuer, pendingIssuerAt = brPendingIssuerName(line), i
			continue
		}

		if !inTable {
			// An item-shaped token outside a table is prose, not a proposal.
			pendingIssuer, pendingIssuerAt = brPendingIssuerName(line), i
			continue
		}

		flush()
		repeatHeader = false
		cur = &brRowBuf{item: brNormalizeItem(item)}
		brAbsorb(cur, rest, hasType, maxVote)
	}
	flush()

	if len(rows) == 0 {
		return nil, fmt.Errorf("broadridge: column header matched but no proposal rows parsed")
	}
	return rows, nil
}

// brValuedLabelLine reports whether a line is an identity label WITH its value
// (`Security 968223206 Meeting Type Annual`, `Ticker Symbol JWA Meeting Date
// 21-Sep-2006`). A bare `MEETING DATE` is wrapped proposal text (E1:
// `STOCKHOLDER PROPOSAL - ANNUAL` / `MEETING DATE`), not a label line.
func brValuedLabelLine(line string) bool {
	for label, v := range brFindLabels(line) {
		switch label {
		case "CUSIP", "SECURITY ID", "SECURITY":
			if brLooksLikeSecurityID(brFirstField(v)) {
				return true
			}
		case "MEETING DATE", "RECORD DATE":
			if brDate(v) != "" {
				return true
			}
		}
	}
	return false
}

// brIssuerHeading reports whether lines[i] is an issuer's name printed between
// two dashed rules (`- ----`, `JOHN WILEY & SONS, INC.`, `- ----`), the report's
// heading of a new meeting block. A rule at a page break (E1: a slate continues
// across it) frames no name and opens nothing.
func brIssuerHeading(lines []string, i int) bool {
	name := strings.TrimSpace(lines[i])
	if brDashRule(name) || brPageFurniture(name) || brColumnHeader(name) || len(brFindLabels(name)) > 0 {
		return false
	}
	if item, _ := brSplitItem(name); item != "" {
		return false
	}
	j := i - 1
	for j >= 0 && strings.TrimSpace(lines[j]) == "" {
		j--
	}
	if j < 0 || !brDashRule(strings.TrimSpace(lines[j])) {
		return false
	}
	k := i + 1
	for k < len(lines) && strings.TrimSpace(lines[k]) == "" {
		k++
	}
	return k < len(lines) && brDashRule(strings.TrimSpace(lines[k]))
}

// brNameOpensBlock reports whether the free text at lines[i] opens a meeting
// block in either identity form: a dashed rule directly above it, or label
// lines directly below it (`NEXTEL COMMUNICATIONS` / `Ticker Symbol: NXTL
// CUSIP/Security ID: 65332V103`).
func brNameOpensBlock(lines []string, i int) bool {
	j := i - 1
	for j >= 0 && strings.TrimSpace(lines[j]) == "" {
		j--
	}
	if j >= 0 && brDashRule(strings.TrimSpace(lines[j])) {
		// The rule under a column header underlines it; a rule under
		// anything else closes the block above.
		j2 := j - 1
		for j2 >= 0 && strings.TrimSpace(lines[j2]) == "" {
			j2--
		}
		if j2 < 0 || !brColumnHeader(strings.TrimSpace(lines[j2])) {
			return true
		}
	}
	k := i + 1
	for k < len(lines) && strings.TrimSpace(lines[k]) == "" {
		k++
	}
	return k < len(lines) && len(brFindLabels(strings.TrimSpace(lines[k]))) > 0
}

// brAbsorb folds one physical line into the open row: the proposal text is
// appended, and any trailing cells fill the columns that are still empty.
//
// Filling only empty columns is what makes the tab-delimited export work, where
// the vote cells arrive on the LAST physical line of a wrapped proposal rather
// than the first -- the TYPE cell lands on one line and the two vote cells on
// the next, and neither overwrites the other.
func brAbsorb(cur *brRowBuf, rest string, hasType bool, maxVote int) {
	body, typ, vote, forAgnst := brPeelColumns(rest, hasType, maxVote)
	if body != "" {
		cur.text = append(cur.text, body)
	}
	if typ != "" && cur.typ == "" {
		cur.typ = typ
	}
	if vote != "" && cur.vote == "" {
		cur.vote = vote
	}
	if forAgnst != "" && cur.forAgnst == "" {
		cur.forAgnst = forAgnst
	}
}

// brColumnShape reads the table's column count off its header. hasType is
// whether a TYPE (or "Proposed by" / Sponsor) column precedes the vote columns;
// maxVote is how many vote-vocabulary cells may trail one row.
//
// The sixth column, PREFERRED PROVIDER RECOMMENDATION, holds the value 'None',
// which is itself a vote word. Peeling from the right without knowing the column
// count reads it as the management recommendation and silently reports every row
// of that filing as unopposed.
func brColumnShape(headerText string) (hasType bool, maxVote int) {
	up := strings.ToUpper(headerText)
	hasType = strings.Contains(up, "TYPE") ||
		strings.Contains(up, "PROPOSED BY") ||
		strings.Contains(up, "SPONSOR")
	maxVote = 2
	if strings.Contains(up, "PREFERRED") {
		maxVote = 3
	}
	return hasType, maxVote
}

// brSplitItem separates a leading item token from the rest of a line. No item
// token means the line continues the row above it.
func brSplitItem(line string) (item, rest string) {
	parts := strings.SplitN(line, " ", 2)
	if !brIsItemToken(parts[0]) {
		return "", line
	}
	if len(parts) == 1 {
		return parts[0], ""
	}
	return parts[0], strings.TrimSpace(parts[1])
}

// brIsItemToken reports whether tok opens a proposal row.
func brIsItemToken(tok string) bool {
	if tok == "" {
		return false
	}
	if tok == "CMMT" {
		return true
	}
	switch {
	case brItemNumeric.MatchString(tok),
		brItemParen.MatchString(tok),
		brItemMixed.MatchString(tok),
		brItemAlpha.MatchString(tok),
		brItemRoman.MatchString(tok):
		return true
	}
	return false
}

// brNormalizeItem drops the trailing punctuation of '1a.' and '3)', so the
// column holds 1a and 3 whichever vintage printed the row.
func brNormalizeItem(item string) string {
	return strings.TrimRight(item, ".)")
}

// brPeelColumns takes the trailing cells off the right of a table line and
// returns the proposal text that remains.
//
// The columns are, left to right, TYPE, VOTE, FOR/AGAINST MANAGEMENT and (in the
// six-column shape) PREFERRED PROVIDER RECOMMENDATION. So vote is how_voted and
// forAgnst is management_recommendation; transposing them mislabels every row.
//
// Peeling STOPS at a cell that can only be a TYPE value, because TYPE is the
// leftmost trailing column and nothing lies further left. That single rule is
// what keeps "SUBMISSION OF THE AUDITED ANNUAL REPORT FOR   Non-Voting" -- a
// proposal whose own text ends in the word FOR, on a meeting where nothing was
// voted -- from being read as a vote of For.
//
// A partial reading is a complete answer, not a failed one: a blank management
// column is routine on abstentions and shareholder proposals, and every column
// is blank on the 8,993 CMMT and Non-Voting rows. The uncertain field is left
// empty and the row is still emitted.
func brPeelColumns(rest string, hasType bool, maxVote int) (body, typ, vote, forAgnst string) {
	toks := brUnglueTrailingCell(strings.Fields(rest))

	var cells []string // right to left
	votes := 0
	for len(toks) > 0 {
		cell, remaining, isType, ok := brPeelCell(toks)
		if !ok {
			break
		}
		if isType {
			if !hasType {
				break
			}
			typ = cell
			toks = remaining
			break
		}
		if votes >= maxVote {
			break
		}
		cells = append(cells, cell)
		votes++
		toks = remaining
	}

	// cells were collected right to left; the vote column is the leftmost.
	for i, j := 0, len(cells)-1; i < j; i, j = i+1, j-1 {
		cells[i], cells[j] = cells[j], cells[i]
	}
	if len(cells) > 0 {
		vote = cells[0]
	}
	if len(cells) > 1 {
		forAgnst = cells[1]
	}
	// cells[2], when present, is the PREFERRED PROVIDER column. It is not a
	// vote and is deliberately not carried into any vote field.

	return strings.TrimSpace(strings.Join(toks, " ")), typ, vote, forAgnst
}

// brPeelCell removes the longest run of trailing tokens spelling one cell value,
// preserving the filing's own capitalization. isType distinguishes a TYPE value
// from a vote value; the two vocabularies are disjoint by construction.
func brPeelCell(toks []string) (cell string, remaining []string, isType, ok bool) {
	max := brMaxCellWords
	if max > len(toks) {
		max = len(toks)
	}
	for n := max; n >= 1; n-- {
		candidate := strings.Join(toks[len(toks)-n:], " ")
		key := strings.ToLower(strings.Trim(candidate, ".,;:"))
		switch {
		case brVoteVocabulary[key]:
			start := brExtendSplitCell(toks, len(toks)-n)
			return strings.Join(toks[start:], " "), toks[:start], false, true
		case brTypeVocabulary[key]:
			return candidate, toks[:len(toks)-n], true, true
		}
	}
	return "", toks, false, false
}

// brPercentToken reports whether tok is a bare percentage ('96%', '1%'), the
// tally that a compound vote cell prints between its vocabulary words.
func brPercentToken(tok string) bool {
	if len(tok) < 2 || !strings.HasSuffix(tok, "%") {
		return false
	}
	for _, r := range tok[:len(tok)-1] {
		if (r < '0' || r > '9') && r != '.' {
			return false
		}
	}
	return true
}

// brExtendSplitCell widens a peeled vote cell leftwards across the `NN% Word`
// pairs of a COMPOUND vote, returning the index the cell now starts at.
//
// A fund of funds votes one security several ways at one meeting, so broadridge
// prints the whole tally in the Proposal Vote column rather than a single
// vocabulary word: `Split 96% For 4% Withheld`. Peeling only the trailing word
// reports `Withheld` -- which is not what the row says, the fund voted 96% For
// -- and leaves `Split 96% For 4%` glued into the proposal text.
//
// The walk consumes only whole `NN% <vocabulary word>` pairs, plus a leading
// vocabulary word ('Split') once no pair remains, so ordinary prose ending in a
// vote word cannot be absorbed.
func brExtendSplitCell(toks []string, start int) int {
	for start >= 2 && brPercentToken(toks[start-1]) {
		key := strings.ToLower(strings.Trim(toks[start-2], ".,;:"))
		if !brVoteVocabulary[key] {
			break
		}
		start -= 2
	}
	return start
}

// brCompoundSplitVote reports whether s is a whole compound vote cell --
// `Split 96% For 4% Withheld` -- rather than a single vocabulary word. It is the
// validity half of brExtendSplitCell: a cell this layout emits verbatim is a
// vote value, and the how_voted invariant consults the parsers' own validators
// rather than a mirrored list.
func brCompoundSplitVote(s string) bool {
	toks := strings.Fields(s)
	if len(toks) < 3 || len(toks)%2 == 0 {
		return false
	}
	for i, tok := range toks {
		if i%2 == 1 {
			if !brPercentToken(tok) {
				return false
			}
			continue
		}
		if !brVoteVocabulary[strings.ToLower(strings.Trim(tok, ".,;:"))] {
			return false
		}
	}
	return true
}

// brUnglueTrailingCell splits a final token that two columns ran together. The
// Proposal Vote cell of a compound vote can be one character wider than its
// column, so its last word abuts the For/Against Management cell with no space
// and the filing prints `AbstainSplit` -- a token in no vocabulary, against
// which the whole-word peel matches nothing at all and the entire vote cell is
// left in the proposal text.
//
// The split is taken only when it is UNAMBIGUOUS: exactly one cut point yields
// two vote-vocabulary words. Capitalization comes from the filing's own bytes.
func brUnglueTrailingCell(toks []string) []string {
	if len(toks) == 0 {
		return toks
	}
	last := toks[len(toks)-1]
	lower := strings.ToLower(strings.Trim(last, ".,;:"))
	if len(lower) != len(last) || brVoteVocabulary[lower] || brTypeVocabulary[lower] {
		return toks
	}
	cut := -1
	for i := 2; i <= len(lower)-2; i++ {
		if brVoteVocabulary[lower[:i]] && brVoteVocabulary[lower[i:]] {
			if cut >= 0 {
				return toks
			}
			cut = i
		}
	}
	if cut < 0 {
		return toks
	}
	out := make([]string, 0, len(toks)+1)
	out = append(out, toks[:len(toks)-1]...)
	return append(out, last[:cut], last[cut:])
}

// brPendingIssuerName reads a free-standing line as the pending issuer, except
// where the line is longer than any issuer or fund name can be: stripHTML welds
// a uuencoded attachment's payload into kilobyte-long pseudo-lines, and handing
// one of those to the resolver costs a cut chain per parenthesis pair. Bounded
// by the same cap the resolver itself refuses on, so no line either would read
// is dropped here.
func brPendingIssuerName(line string) string {
	if len(line) > issMaxBannerBytes {
		return ""
	}
	return brIssuerName(line)
}

// brIssuerName strips the trailing "Agenda Number: 932152666" that the modern
// vintage prints on the same line as the issuer, so the column holds the issuer
// and not the agenda id glued to it.
func brIssuerName(line string) string {
	up := strings.ToUpper(line)
	for _, label := range []string{"AGENDA NUMBER", "AGENDA:"} {
		if i := strings.Index(up, label); i > 0 {
			line = strings.TrimSpace(line[:i])
			up = strings.ToUpper(line)
		}
	}
	return strings.TrimSpace(line)
}

// brFindLabels returns every label present on one line mapped to its value. One
// physical line may carry several ('TICKER SYMBOL    MEETING DATE  08-Jul-2011'),
// so a value runs from the end of its own label to the start of the next one --
// and is EMPTY when the next label follows immediately, which is how a blank
// ticker stays blank instead of becoming the literal word MEETING.
func brFindLabels(line string) map[string]string {
	up := strings.ToUpper(line)

	type hit struct {
		at    int
		end   int
		label string
	}
	var hits []hit
	for _, label := range brLabels {
		for i := 0; i <= len(up); {
			at, end := brLabelIndex(up, i, label)
			if at < 0 {
				break
			}
			if !brLabelBoundary(up, at, end-at) {
				i = at + 1
				continue
			}
			hits = append(hits, hit{at: at, end: end, label: label})
			i = end
		}
	}
	if len(hits) == 0 {
		return nil
	}

	// Sort by position and drop any hit a longer label already covers, so
	// "MEETING DATE" is not also reported as a bare "MEETING".
	for i := 1; i < len(hits); i++ {
		for j := i; j > 0 && hits[j].at < hits[j-1].at; j-- {
			hits[j], hits[j-1] = hits[j-1], hits[j]
		}
	}
	var kept []hit
	end := -1
	for _, h := range hits {
		if h.at < end {
			continue
		}
		kept = append(kept, h)
		end = h.end
	}

	// A label BLOCK begins with a label. A proposal whose text merely names one
	// -- '5 Approve Change of Record Date for Annual Meeting' -- is a table row,
	// and reading it as a label line would close the table and blank the meeting
	// date, dropping every later proposal of that meeting.
	lead := ""
	if kept[0].at != 0 {
		// The identity on one line LED BY THE ISSUER (Baron Investment Funds
		// 2005: `ALEXANDER'S INC.  CUSIP: 014752109  TICKER: ALX  MEETING
		// DATE: 05/18/05  TYPE: ANNUAL`): two or more labels each followed by
		// a colon are labels, whatever precedes them, and the prefix is the
		// name. A colon-less mention stays a proposal.
		if len(kept) < 2 {
			return nil
		}
		for _, h := range kept {
			if e := h.end; e >= len(line) || line[e] != ':' {
				return nil
			}
		}
		lead = strings.TrimSpace(line[:kept[0].at])
		if lead == "" || brColumnFurniture(lead) {
			return nil
		}
	}

	out := map[string]string{}
	if lead != "" {
		out["ISSUER"] = lead
	}
	for i, h := range kept {
		from := h.end
		to := len(line)
		if i+1 < len(kept) {
			to = kept[i+1].at
		}
		v := strings.TrimSpace(line[from:to])
		v = strings.TrimSpace(strings.TrimPrefix(v, ":"))
		out[h.label] = v
	}
	return out
}

// brLabelIndex finds the first occurrence of a multi-word label at or after
// `from`, returning its start and end offsets (-1, -1 when absent). The single
// space the vocabulary spells between words matches ANY run of spaces: GAMCO
// Westwood Funds 2011 doubles it in sixty-three of its identity blocks
// (`TICKER  SYMBOL     SWSH`, `MEETING  DATE       05-May-2011`), and a literal
// match there loses the meeting date and reads the ticker as the word SYMBOL.
func brLabelIndex(up string, from int, label string) (int, int) {
	first := label
	if i := strings.IndexByte(label, ' '); i >= 0 {
		first = label[:i]
	}
	for i := from; i <= len(up); {
		j := strings.Index(up[i:], first)
		if j < 0 {
			return -1, -1
		}
		at := i + j
		if end := brLabelEnd(up, at, label); end >= 0 {
			return at, end
		}
		i = at + 1
	}
	return -1, -1
}

// brLabelEnd matches `label` at `at`, treating each space in the label as one or
// more spaces in the line; it returns the offset just past the match, or -1.
func brLabelEnd(up string, at int, label string) int {
	i := at
	for j := 0; j < len(label); j++ {
		if label[j] == ' ' {
			if i >= len(up) || up[i] != ' ' {
				return -1
			}
			for i < len(up) && up[i] == ' ' {
				i++
			}
			continue
		}
		if i >= len(up) || up[i] != label[j] {
			return -1
		}
		i++
	}
	return i
}

// brLabelBoundary rejects a label that is part of a longer word, which is what
// keeps 'TICKER' from matching inside a registrant name such as TICKERTAPE.
func brLabelBoundary(up string, at, n int) bool {
	if at > 0 && brWordByte(up[at-1]) {
		return false
	}
	if at+n < len(up) && brWordByte(up[at+n]) {
		return false
	}
	return true
}

func brWordByte(c byte) bool {
	return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9'
}

// brLooksLikeSecurityID guards the CUSIP column. In the tab-delimited export the
// 'Security' label holds the company NAME and the CUSIP arrives under its own
// label further down; without this test the column would carry a fragment of the
// issuer's name and the real identifier would be the one discarded.
// A nine-character value may carry exactly one '@' among its letters and digits
// (JNL Series Trust 2021 prints `Security:  46655@109`); it is kept verbatim,
// since the character stands for one the vendor could not render and guessing it
// would invent an identifier.
func brLooksLikeSecurityID(s string) bool {
	if len(s) < 5 || len(s) > 12 {
		return false
	}
	ats := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '@' {
			ats++
			continue
		}
		if !brWordByte(s[i]) {
			return false
		}
	}
	return ats == 0 || (ats == 1 && len(s) == 9)
}

// brFirstField takes the leading whitespace-delimited token, which is how a
// value is isolated from trailing filler on a label line.
func brFirstField(s string) string {
	f := strings.Fields(s)
	if len(f) == 0 {
		return ""
	}
	return f[0]
}

// brDate normalizes the family's date spellings onto YYYYMMDD: '26-May-04',
// '09-May-2023', the quoted '"06 May, 2021"' of the tab-delimited export, and a
// slash-separated numeric form. A value it cannot read yields an empty date
// rather than a guess.
func brDate(s string) string {
	s = strings.TrimSpace(strings.Trim(strings.TrimSpace(s), `"`))
	if s == "" {
		return ""
	}
	fields := strings.FieldsFunc(s, func(r rune) bool {
		return r == '-' || r == '/' || r == '.' || r == ',' || r == ' ' || r == '\t'
	})
	if len(fields) != 3 {
		return ""
	}

	// dd-Mon-yy(yy) and "dd Mon, yyyy".
	if m, ok := brMonths[strings.ToLower(brPrefix(fields[1], 3))]; ok {
		day, derr := strconv.Atoi(fields[0])
		year, yok := brYear(fields[2])
		if derr == nil && yok && day >= 1 && day <= 31 {
			return brPad4(year) + brPad2(m) + brPad2(day)
		}
		return ""
	}

	// Month-first full dates, e.g. February 20, 2004.
	if m, ok := brMonths[strings.ToLower(brPrefix(fields[0], 3))]; ok {
		day, err := strconv.Atoi(fields[1])
		year, yok := brYear(fields[2])
		if err == nil && yok && len(fields[2]) == 4 && day >= 1 && day <= 31 {
			return brPad4(year) + brPad2(m) + brPad2(day)
		}
		return ""
	}

	// mm/dd/yy(yy).
	month, merr := strconv.Atoi(fields[0])
	day, derr := strconv.Atoi(fields[1])
	year, yok := brYear(fields[2])
	if merr != nil || derr != nil || !yok {
		return ""
	}
	if month < 1 || month > 12 || day < 1 || day > 31 {
		return ""
	}
	return brPad4(year) + brPad2(month) + brPad2(day)
}

// brYear resolves a year field, expanding the two-digit form. N-PX did not exist
// before 2003, so a two-digit year is in this century; the 1900s branch exists
// only so a stray '97' is not reported as a meeting held in 2097.
func brYear(s string) (int, bool) {
	v, err := strconv.Atoi(s)
	if err != nil || v < 0 {
		return 0, false
	}
	if len(s) <= 2 {
		if v >= 90 {
			return 1900 + v, true
		}
		return 2000 + v, true
	}
	if v < 1000 {
		return 0, false
	}
	return v, true
}

// brPrefix takes the first n bytes of s, or all of s when it is shorter.
func brPrefix(s string, n int) string {
	if len(s) < n {
		return s
	}
	return s[:n]
}

func brPad2(v int) string {
	if v < 10 {
		return "0" + strconv.Itoa(v)
	}
	return strconv.Itoa(v)
}

func brPad4(v int) string {
	s := strconv.Itoa(v)
	for len(s) < 4 {
		s = "0" + s
	}
	return s
}

// brSlateHead returns the proposal text a slate's nominees hang under -- the
// `DIRECTOR` line -- so each nominee row records what it was an election to,
// rather than a bare name. Only the FIRST line of the open row is taken: the
// rest is the previous nominee.
func brSlateHead(cur *brRowBuf) string {
	if len(cur.text) == 0 {
		return ""
	}
	return cur.text[0]
}

// brIdentityColumnHeader recognises a line that heads the identity columns --
// it names COMPANY NAME and MEETING DATE and at least one of TICKER, SECURITY
// ID and CUSIP, and nothing else -- and returns the fields in column order.
func brIdentityColumnHeader(line string) []string {
	up := strings.ToUpper(strings.TrimSpace(line))
	if !strings.Contains(up, "COMPANY NAME") || !strings.Contains(up, "MEETING DATE") {
		return nil
	}
	known := []struct{ text, field string }{
		{"COMPANY NAME", "ISSUER"}, {"TICKER", "TICKER"}, {"SECURITY ID", "SECURITY ID"},
		{"CUSIP", "SECURITY ID"}, {"MEETING DATE", "MEETING DATE"}, {"MEETING TYPE", "MEETING TYPE"},
	}
	type at struct {
		pos   int
		field string
	}
	var hits []at
	rest := up
	for _, k := range known {
		if j := strings.Index(up, k.text); j >= 0 {
			hits = append(hits, at{j, k.field})
			rest = strings.Replace(rest, k.text, strings.Repeat(" ", len(k.text)), 1)
		}
	}
	// Every other word on the line must belong to a wrapped label (`ON`, `BALLOT`).
	for _, w := range strings.Fields(rest) {
		if w != "ON" && w != "BALLOT" && w != "SYMBOL" {
			return nil
		}
	}
	sort.Slice(hits, func(a, b int) bool { return hits[a].pos < hits[b].pos })
	fields := make([]string, 0, len(hits))
	hasID := false
	for _, h := range hits {
		if h.field == "TICKER" || h.field == "SECURITY ID" {
			hasID = true
		}
		fields = append(fields, h.field)
	}
	if !hasID || len(fields) < 3 {
		return nil
	}
	return fields
}

// brFramedIdentity is one meeting's identity, read whole from the rule-framed
// block that states it. end is the index of the block's closing rule.
type brFramedIdentity struct {
	issuer  string
	ticker  string
	cusip   string
	mtgDate string
	end     int
}

// brRuleFramedIdentity reads the identity block this 2004 vintage prints above
// every proposal table, framed by two dashed rules:
//
//   - ------------------------------------------------------------…
//     3M COMPANY                       MMM        ANNUAL MEETING DATE: 05/11/2004
//     ISSUER: 88579Y101   CITY:                   HOLDINGS RECONCILIATION DATE: 03/12/2004
//     ISIN:               COUNTRY: UNITED STATES  VOTE DEADLINE DATE: 05/11/2004
//   - ------------------------------------------------------------…
//
// Every field is printed and none of it is reachable line by line: the first
// line's only label does not open it, and `ISSUER` is not a label word at all --
// here it holds the SECURITY ID, so its value goes to the cusip and never to the
// issuer name, which is the bare text left of the first wide gap on the line
// above.
//
// lines[i] must be the block's first line. The block is recognised only when
// both rules are present, so a name printed under a rule for any other reason
// reads nothing.
func brRuleFramedIdentity(lines []string, i int) *brFramedIdentity {
	head := strings.TrimSpace(lines[i])
	if head == "" || brDashRule(head) || brColumnHeader(head) || brPageFurniture(head) {
		return nil
	}
	cells := brSplitWide(lines[i])
	if len(cells) < 2 {
		return nil
	}
	// The date cell names MEETING DATE behind a qualifier word (`ANNUAL`,
	// `SPECIAL`) and is never the first cell: a line that OPENS with the label
	// is an ordinary label line and belongs to brFindLabels.
	date := -1
	for j := 1; j < len(cells); j++ {
		if k := strings.Index(strings.ToUpper(cells[j]), "MEETING DATE:"); k > 0 {
			date = j
			break
		}
	}
	if date < 1 {
		return nil
	}

	// The rule above, and the rule that closes the block below.
	j := i - 1
	for j >= 0 && strings.TrimSpace(lines[j]) == "" {
		j--
	}
	if j < 0 || !brDashRule(strings.TrimSpace(lines[j])) {
		return nil
	}
	end := -1
	for k := i + 1; k < len(lines) && k <= i+brFramedIdentityLines; k++ {
		body := strings.TrimSpace(lines[k])
		if body == "" {
			continue
		}
		if brDashRule(body) {
			end = k
			break
		}
		// Every other line of the block is labelled.
		if !strings.Contains(body, ":") {
			return nil
		}
	}
	if end < 0 {
		return nil
	}

	id := &brFramedIdentity{issuer: cells[0], end: end}
	if v := strings.TrimSpace(cells[date][strings.Index(strings.ToUpper(cells[date]), "MEETING DATE:")+len("MEETING DATE:"):]); v != "" {
		id.mtgDate = brDate(v)
	}
	// The bare cell between the name and the date is the ticker.
	if date == 2 {
		if t := brFirstField(cells[1]); t == cells[1] && !strings.Contains(t, ":") && len(t) <= 6 {
			id.ticker = t
		}
	}
	for k := i + 1; k < end; k++ {
		for _, cell := range brSplitWide(lines[k]) {
			up := strings.ToUpper(cell)
			if !strings.HasPrefix(up, "ISSUER:") {
				continue
			}
			if v := brFirstField(cell[len("ISSUER:"):]); brLooksLikeSecurityID(v) {
				id.cusip = v
			}
		}
	}
	return id
}

// brFramedIdentityLines bounds the search for the block's closing rule: the
// vintage prints three lines between its rules.
const brFramedIdentityLines = 6

// brSplitWide splits a printed row on runs of two or more spaces, the gaps a
// fixed-width report leaves between its cells.
func brSplitWide(line string) []string {
	var out []string
	for _, part := range strings.Split(strings.TrimSpace(line), "  ") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// brColumnMap names a header's cells by their TEXT -- `Vote Cast` is the fund's
// vote wherever on the line it is printed -- and records the ORDER those named
// columns are printed in.
//
// Every spelling the positional peel in brPeelColumns handles orders its
// trailing cells TYPE, VOTE, MANAGEMENT. This vintage TRANSPOSES the two vote
// columns (`Proposal Number | Vote Cast | Mgt Rec | Proposal`), so a positional
// read of it would emit every row with the vote and the recommendation swapped
// -- strictly worse than the blank the filing gets without it, because the rows
// it inverts are exactly the ones that carry a dissent. A map is built only for
// a header whose every cell can be named; any other header keeps the peel.
type brColumnMap struct {
	// fields holds one name per header cell, in printed order: "item",
	// "vote", "mgmt" or "desc".
	fields []string
}

// brColumnField names one header cell. Only the spellings of the transposed
// shape are named: a header this cannot name in full builds no map at all.
func brColumnField(text string) string {
	switch strings.Join(strings.Fields(strings.ToUpper(text)), " ") {
	case "PROPOSAL NUMBER", "PROPOSAL NO", "PROPOSAL NO.", "PROPOSAL #":
		return "item"
	case "VOTE CAST", "VOTES CAST":
		return "vote"
	case "REC", "REC.", "MGT REC", "MGT REC.", "MGMT REC", "MGMT REC.",
		"MANAGEMENT REC", "MGT RECOMMENDATION", "MGMT RECOMMENDATION",
		"MANAGEMENT RECOMMENDATION":
		return "mgmt"
	case "PROPOSAL", "PROPOSAL DESCRIPTION":
		return "desc"
	}
	return ""
}

// brBuildColumnMap builds the map from the header's cells and the words of its
// spill line, and returns nil unless every cell is named exactly once.
//
// A cell printed over two physical lines (`Mgt` above `Rec`) is joined by TEXT
// rather than by column offset: collapseSpaces (html.go) squeezes every gap to
// two spaces and drops indentation before any layout runs, so the offsets the
// filer printed are gone by the time this reads them.
func brBuildColumnMap(header string, spill []string) *brColumnMap {
	cells := brSplitWide(header)
	if len(cells) < 2 {
		return nil
	}
	var spillWords []string
	for _, s := range spill {
		spillWords = append(spillWords, brSplitWide(s)...)
	}
	m := &brColumnMap{fields: make([]string, len(cells))}
	seen := map[string]bool{}
	for i, c := range cells {
		f := brColumnField(c)
		for _, w := range spillWords {
			if f != "" {
				break
			}
			if f = brColumnField(w + " " + c); f == "" {
				f = brColumnField(c + " " + w)
			}
		}
		if f == "" || seen[f] {
			return nil
		}
		seen[f] = true
		m.fields[i] = f
	}
	if !seen["vote"] || !seen["desc"] {
		return nil
	}
	return m
}

// read pulls one printed row apart by column.
//
// A blank cell collapses away with the spacing, so the columns are anchored on
// what a cell can BE rather than counted off: the item token opens the row, the
// trailing run of cells that are not vote words is the description, and the
// vote words between them fill the map's vote-bearing columns.
//
// They fill from the RIGHT on a row that carries an item token, because that is
// the column this vintage leaves blank -- a slate's own line prints the
// management recommendation with no fund vote beside it. A line with no item
// token is a nominee of the slate above, which prints its own vote under the
// vote column and no recommendation, so those fill from the LEFT.
func (m *brColumnMap) read(cells []string) (item, vote, mgmt, desc string, ok bool) {
	var voteCols []int
	hasItem := false
	for i, f := range m.fields {
		switch f {
		case "vote", "mgmt":
			voteCols = append(voteCols, i)
		case "item":
			hasItem = true
		}
	}
	lo := 0
	if len(cells) > 0 && brIsItemToken(cells[0]) {
		if !hasItem {
			return "", "", "", "", false
		}
		item, lo = cells[0], 1
	}
	hi := len(cells)
	for hi > lo && !brVoteVocabulary[strings.ToLower(strings.Trim(cells[hi-1], ".,;:"))] {
		hi--
	}
	desc = strings.Join(cells[hi:], " ")
	mid := cells[lo:hi]
	if len(mid) > len(voteCols) {
		return "", "", "", "", false
	}
	vals := make([]string, len(m.fields))
	if item != "" {
		for k := range mid {
			vals[voteCols[len(voteCols)-1-k]] = mid[len(mid)-1-k]
		}
	} else {
		for k := range mid {
			vals[voteCols[k]] = mid[k]
		}
	}
	for i, f := range m.fields {
		switch f {
		case "vote":
			vote = vals[i]
		case "mgmt":
			mgmt = vals[i]
		}
	}
	return item, vote, mgmt, desc, true
}

// brIdentityHeaderSpill reports a line built only from the words of a wrapped
// identity column label (`BALLOT` under `SECURITY ID ON`).
func brIdentityHeaderSpill(line string) bool {
	words := brAlphaWords(line)
	if len(words) == 0 {
		return false
	}
	for _, w := range words {
		switch w {
		case "ON", "BALLOT", "SYMBOL", "NAME", "ID", "DATE", "TYPE", "COMPANY", "TICKER", "SECURITY", "MEETING", "CUSIP":
		default:
			return false
		}
	}
	return true
}
