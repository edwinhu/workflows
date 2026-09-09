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
		return false
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
	return ""
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
			return false
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
	seriesIx := newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))
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
		headerText    string
		spill         []string

		hasType bool
		maxVote = 2

		inTable  bool
		sawTable bool
		cur      *brRowBuf

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
	}

	lines := strings.Split(text, "\n")
	for i, raw := range lines {
		line := strings.TrimSpace(raw)
		if line == "" {
			flush()
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
				if _, d := issResolveFund(seriesIx, slot); d != nil {
					flush()
					curSeries, curFund = d.SeriesID, slot
				}
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
					if d, _ := lookupSeriesEntry(seriesIdx, slot); d != nil {
						flush()
						curSeries, curFund = d.SeriesID, slot
					}
				}
				if slot, crossedBlank := brHeadingSlot(lines, i); slot != "" {
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
					}
				}
			} else if brSilentSection(lines, i, &silentBuf) {
				flush()
				curSeries = ""
				curFund = ""
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
				if pendingIssuer != "" {
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
			pendingIssuer = brIssuerName(line)
			continue
		}

		if !inTable {
			// An item-shaped token outside a table is prose, not a proposal.
			pendingIssuer = brIssuerName(line)
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
	toks := strings.Fields(rest)

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
			return candidate, toks[:len(toks)-n], false, true
		case brTypeVocabulary[key]:
			return candidate, toks[:len(toks)-n], true, true
		}
	}
	return "", toks, false, false
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
