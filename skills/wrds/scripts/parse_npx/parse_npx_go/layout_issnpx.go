package main

import (
	"regexp"
	"sort"
	"strconv"
	"strings"
	"unicode"
)

// The ISS-generated "FORM N-Px REPORT" is the highest-volume legacy layout: a
// fixed-width report whose funds are delimited by rules of '=' padding around a
// fund name, and whose meetings are issuer/ticker/date headers followed by a
// '#  Proposal  Mgt Rec  Vote Cast  Sponsor' column table.
//
// Two properties of the grammar drive the parser's shape.
//
// Proposal text wraps onto continuation lines carrying no item number, so a row
// is only complete once its trailing columns arrive — emitting per physical line
// would double-count every long proposal and truncate its text.
//
// And the column split cannot use column positions. Normalization collapses runs
// of spaces and strips indentation before a layout ever sees the body, which is
// what makes the same parser work on the SGML-wrapped copies of this report as
// on the plain-text ones. So the trailing cells are peeled off the right by
// vocabulary: a sponsor, then up to two vote values.
//
// The vote cells sit on the row's FIRST physical line 96.7% of the time and on
// the last in the vintages whose proposal column is narrow, so their arrival
// cannot be what closes a row: closing there dropped every continuation line of
// the dominant shape. A row is closed by the next item token, a blank line, or a
// meeting/fund boundary, exactly as in the Broadridge family.
//
// Once a row holds its trailing cells, every further line belongs to the
// proposal text and is NOT peeled. The wrapped tail of a proposal is frequently
// a bare vocabulary word -- "Management", the end of "Approve Discharge of Board
// and Senior Management" -- and peeling it would truncate the text and invent a
// sponsor the filing never printed in that position. A row still waiting for its
// cells does peel its continuations, which is how the narrow-column vintage puts
// "For For Management" on the last line of a wrapped proposal.
//
// The Mgt Rec cell is NOT required. It is genuinely blank on rows the
// report merely records ("Receive Financial Statements and Statutory Reports",
// voted None), and demanding it meant the Vote Cast and Sponsor cells of every
// such row were absorbed back into the proposal text. Peeling collects the vote
// cells right to left and assigns them by position within that run: the last one
// peeled is Vote Cast, the one to its left — when there is one — is Mgt Rec. A
// partial reading is a complete answer. The recommendation stays empty rather
// than being filled from the vote beside it, because inventing a value for a
// column the filing left blank is a worse fault than the loss it replaces.

// issItemRe matches the leading token of a proposal row: 1, 1.1, 2a, 6, 1), and
// the DOUBLE-DOT slate form 1..1 .. 1..14.
//
// The doubled dot is not a typo in one filing: it is how this grammar numbers a
// director slate, one sub-number per nominee, and `(\.\d+)*` rejected every one
// of them. A rejected leading token makes the line a CONTINUATION, so all
// fourteen nominees folded into the row above and their votes were lost.
// Measured 2026-09-01 on 0001144204-13-048821: White Mountains Insurance read 3
// items where ISS records 39, and the three read were the plain proposals 10, 11
// and 12 that follow the slate. issnpx is the largest remaining source of
// partial parsing at 115,096 items across 1,814 filings.
// Continuation lines never carry one, which is what separates them from a new row.
// A sub-item may be lettered AND numbered -- `3a1`, `3a2` -- in the vintage
// that puts a blank line between every physical line. One trailing letter was
// allowed; a letter followed by digits was not, and those rows opened no row at
// all. Measured 2026-09-01, four of ten items in one excerpt.
var issItemRe = regexp.MustCompile(`^\d+(\.+\d+)*([A-Za-z]\d*)?[.)]?$`)

// issCellTrim is what matching strips from a cell before the vocabulary is
// consulted: the punctuation a filer hangs on a value (`For.`, `For*`) and,
// since 2026-09-02, the quotes one registrant wraps it in (`"N/A"`). The
// value itself is recorded as printed.
const issCellTrim = ".,;*\""

// issSponsors is the rightmost column's vocabulary. It anchors the peel: an
// N-PX proposal is put forward either by management or by a shareholder.
// The banner-less vintage of the same report abbreviates the column, printing
// "Mgmt" and "ShrHoldr" where the bannered one spells the words out.
var issSponsors = map[string]bool{
	"management": true, "mgmt": true,
	"shareholder": true, "share holder": true, "shareholders": true,
	"shrholdr": true, "shrhldr": true, "shrholder": true,
	"issuer": true, "security holder": true,
}

// issVoteValues is the vocabulary of the Mgt Rec and Vote Cast columns. Entries
// are matched case-insensitively and longest-first, so "do not vote" is never
// mistaken for a bare "vote". A run of dashes is the report's own spelling of an
// absent management recommendation; it is a filled cell, not a missing one, and
// is carried through verbatim rather than blanked, so a row whose recommendation
// the filing declined to state is still emitted with its vote.
var issVoteValues = map[string]bool{
	"---": true, "----": true, "--": true, "n/m": true,
	"for": true, "against": true, "abstain": true, "abstained": true,
	"withhold": true, "withheld": true, "whld": true, "split": true, "none": true,
	// `Split Vote` is what a fund reports when it held the security across
	// several accounts that voted differently -- an outcome, not an absence.
	// issPeelCell matches a WHOLE cell, never a prefix, so carrying `split`
	// alone missed it at every length and the peel abandoned the line: measured
	// 2026-09-01 one filing emitted 20,808 blank votes of 21,480 rows (96.9%).
	"split vote": true,
	// Three more outcomes the corpus prints. `Sold shares` is the fund selling
	// the position before the meeting; `DNV` abbreviates Did Not Vote. Each was
	// missing, and issPeelCell matches a WHOLE cell, so the peel failed at the
	// right edge and every cell stayed in the proposal text -- 5,794 blank of
	// 22,297 rows and 6,937 of 67,741 on the two filings that print them.
	"sold": true, "sold shares": true, "dnv": true,
	// One vintage abbreviates the choice to a LETTER in both the Mgt Rec and
	// Vote Cast columns -- `3  Management Proposal  F  F  Management`. Counted
	// in that filing's own bytes: F 5,637, A 59, N 9, D 7. W does not appear
	// THERE, and the vocabulary records what the corpus prints rather than what
	// an alphabet suggests -- it was admitted only when the shape finder placed
	// it: `Election of Directors  N  W  Management` in four filings of two
	// registrants, 69 rows (2026-09-01). `S` is printed too: one 2020 filing prints
	// `F  S  Management` and `N  S  Shareholder` on 244 rows and the corpus
	// harvest finds 289 of the first shape, every one between a lettered Mgt
	// Rec and a sponsor. The filing defines no legend, and none is needed --
	// how_voted is what the cell printed.
	"f": true, "a": true, "n": true, "d": true, "s": true, "w": true,
	// `WHOLD` is a 2004 abbreviation of Withhold beside the `w'hold` below (91
	// rows); `1Year` and `3Years` are the say-on-pay frequency answers printed
	// without the hyphen of `1-year` (124 rows). Both placed by the finder.
	"whold": true, "1year": true, "3years": true,
	// `For All` on a director slate, 35 rows in one 2005 SGML-table filing.
	"for all": true,
	// From the residue's long tail (filings with at most twenty blanks),
	// 2026-09-02: `Withold` is a misspelling two filers print (21 rows),
	// `DoNotVote` the value without its spaces (14), `Mixed` a split vote by
	// another name (12). Recorded as printed.
	"withold": true, "donotvote": true, "mixed": true,
	// `NV`, a non-vote code printed with a blank Mgt Rec (14 rows, one
	// registrant), and `Angst`, a misspelling of Against (7 rows).
	"nv": true, "angst": true,
	// Two cells that wrap onto the lines below their row, in their own
	// column: `No shares held on record` (81 rows, two filings) and
	// `DNV (do not vote)` (68 rows, one filing). Placed 2026-09-02.
	"no shares held on record": true, "dnv (do not vote)": true,
	// A consent solicitation prints no recommendation and a Yes/No consent:
	// `N/A  Yes  Management`, 419 rows in four filings of two registrants
	// (`n/a` is already a value above).
	"yes": true,
	// `No` in the Vote Cast column -- the fund did not vote the item. The shared
	// howVotedVocabulary in the test suite already recognised NO, so the two
	// lists had drifted apart; one filing prints it on 5,941 rows.
	"no": true,
	// `Not voted` -- 1,713 of the 1,744 blank votes left in one filing after
	// every other fix today. `no vote` joins it because the shared
	// howVotedVocabulary has carried NO VOTE all along: the same drift between
	// two lists of one fact that `no` itself was.
	"not voted": true, "no vote": true,
	// `DidNot Vote` is one value spelled without the space, and this vintage
	// wraps it as `DidNot` / `Vote`; `Null` is what the same filing prints in
	// the Mgt Rec cell when the report states no recommendation. One filing
	// prints them on 2,670 rows.
	//
	// `didnot` is deliberately NOT admitted on its own: with it the peel
	// succeeds on the row line and reports the FRAGMENT, where the cell the
	// filing printed is `DidNot Vote`. Leaving it out makes the peel fail there
	// so issJoinWrappedVote reunites the halves, which is what verbatim means.
	"didnot vote": true, "null": true,
	// Echo (or proportional) voting: the fund votes in proportion to the other
	// shareholders. `echo` is not admitted alone, for the reason `didnot` is
	// not -- the cell the filing prints is `Echo Vote`, and half of it is not
	// what it printed. `proportional` is the same outcome spelled out, and the
	// shared howVotedVocabulary has carried PROPORTIONAL all along.
	"echo vote": true, "proportional": true,
	// And one family prints `Echo` BARE -- `For  Echo  Management` with the
	// next row on the next line, 598 rows placed by the shape finder. Admitting
	// it is safe for the wrapped family only because the row loop extends a
	// vote by a continuation that completes a longer value (`Echo` + `Vote`).
	"echo": true,
	// `Did Note Vote` is the filing's OWN typo for `Did Not Vote`. how_voted is
	// verbatim, so the spelling is recorded as printed rather than corrected --
	// 1,264 rows of 0000950137-05-010894.txt. `Not Cast` was simply missing.
	"did note vote": true, "not cast": true,
	// The residue's long tail, measured 2026-09-01 on the 27-commit build by
	// splitting every blank-vote row on the column gap and ranking the trailing
	// cells. Each count is rows where the gap ALREADY proves the value is its
	// own Vote Cast cell, so the evidence is the corpus, not a guess:
	//
	//	echo voted    639 + 73    oppose        238 + 194
	//	echo          466 + 100   unknown       321
	//	agnst         137         w'hold        106
	//	non-vote       78         unavailable    74
	//	ag             73
	//
	// `echo` ALONE is still refused, and an attempt to admit it here failed the
	// Echo Vote fixture immediately: with it the peel succeeds on the row line
	// and reports `Echo` where the filing printed `Echo Vote` across a wrap.
	// The harvest signature `For | Echo | Management` cannot distinguish the two
	// cases, and a proven fixture outranks an unproven signature -- so the 466
	// rows behind it stay blank.
	"echo voted": true, "oppose": true, "unknown": true,
	"agnst": true, "ag": true, "w'hold": true, "non-vote": true,
	"unavailable": true,
	// Frequency votes spelled with a hyphen. Counted in the two filings that
	// print them: `1 - Year` 394, `3 - Year` 16, `1-Year` 422, `3-Years` 15. No
	// 2-year form appears there and none is admitted.
	"1 - year": true, "3 - year": true, "1-year": true, "3-years": true,
	"refer": true, "unvoted": true, "n/a": true, "na": true, "tna": true,
	"do not vote": true, "take no action": true, "no action": true,
	"did not vote": true, "non voting": true, "non-voting": true,
	// `Non-Votin` is the generator's own truncation of Non-Voting at the
	// column's width: one filing prints it on 457 cells and never the g, and a
	// second family prints `None  Non-Votin  Management`. 405 rows, 2026-09-01.
	"non-votin": true,
	"one year":  true, "two years": true, "three years": true,
	"1 year": true, "2 years": true, "3 years": true,
	"1 yr": true, "2 yrs": true, "3 yrs": true,
	"for and against": true, "with management": true,
}

// issMaxCellWords bounds how many tokens one peeled cell may span.
const issMaxCellWords = 3

// issStripRegistrantPrefix enables the registrant-prefix strip described on
// lookupSeriesStrippingRegistrant. It is set from the -issnpx-registrant-prefix-strip
// flag and defaults to ENABLED.
//
// It is a run-time switch rather than a constant because the held-out apparatus
// that scored every other candidate rule is structurally incapable of scoring
// this one -- the headings it fires on are exactly the headings that never
// exact-match anywhere, so they never enter the ground-truth index and the test
// returns 0/0 usable observations. The audit therefore has to re-parse the corpus
// with the strip OFF and again with it ON. KEEP THE SWITCH: removing it makes
// that audit unrunnable, and it is what made the run below possible.
//
// AUDITED 2026-08-31 over the full 19,015-filing, 166,281,006-row issnpx corpus.
// Comparing the (filepath, fund_name) -> series_id map between the two runs --
// an ORDER-INDEPENDENT key, because the two runs emit rows in different orders
// under concurrency and a naive positional diff reported 1,492,794 spurious
// mismatches in the first 3M rows alone:
//
//	pairs  both_blank=25084  FILLED=2193  lost=0  same=53609  CHANGED=0
//
// The strip ONLY EVER FILLS BLANKS. It never overrode a series resolved without
// it and never dropped one, which is exactly the property this comment used to
// ask someone to confirm. Fill effect: 73.43% -> 75.63% of rows, +3,660,322.
//
// Hand-checked fills against the filings own declarations, e.g.
// `Morgan Stanley Institutional Fund, Inc. - U.S. Real Estate Portfolio` ->
// S000002821 `U.S. REAL ESTATE PORTFOLIO`, which is the discriminating case:
// that filing ALSO declares `INTERNATIONAL REAL ESTATE PORTFOLIO` and
// `Global Real Estate Portfolio`, and the strip picked neither.
//
// What this audit does NOT establish is that a filled value is always correct --
// only that filling never displaces a value obtained without the strip. The
// residual risk is bounded by those 2,193 pairs.
//
// Written once from main before any worker starts and only read afterwards.
var issStripRegistrantPrefix = true

// issMonths maps the three-letter month abbreviations the report prints
// ("FEB 28, 2017") onto their numbers.
var issMonths = map[string]int{
	"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
	"jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}

// issRowBuf accumulates one proposal across its physical lines.
type issRowBuf struct {
	item    string
	text    []string
	mgmt    string
	cast    string
	sponsor string
	voted   string // the VOTED column one vintage prints; see issPeelVotedColumn
	colon   bool   // the vote was printed `<vote>: <qualifier>`; see issPeelColonVote
}

// complete reports that the row's trailing columns have arrived. It does not
// close the row -- the next item token or the block boundary does that -- it
// only marks the point after which further lines are proposal text and are never
// peeled. A blank Mgt Rec does not leave a row incomplete: the Vote Cast and
// Sponsor cells are the right-hand edge of the table, and a recommendation the
// filing never printed is not a cell still to come.
func (b *issRowBuf) complete() bool {
	return b.cast != "" && b.sponsor != ""
}

// parseISSNPX walks the report line by line, carrying the current fund and
// meeting context onto every proposal row it completes. A fund whose section
// holds only the no-activity sentence contributes nothing, which is the correct
// outcome rather than an error.
// issPlainHeadingSeries resolves a heading the vendor printed as a bare line,
// through the shared chain and nothing else: an exact declared name (the strip
// of the registrant's own words included) or an exact dictionary name. A plain
// line carries none of a ruled banner's evidence that it is a heading at all,
// so its resolution is what proves it, and only an exact one does.
func issPlainHeadingSeries(ix *issSeriesIndex, dict *dictFallback, line string) string {
	if s := icrResolveFundShared(ix, line); s != "" {
		return s
	}
	if s := htmlDictionaryFund(ix, dict, line); s != "" {
		return s
	}
	// The registrant prefix and a historical brand on the SAME heading. The
	// chain's own pair of those two rungs reads the stem ONLY through the
	// brand index, which keys each declared name whole, so a registrant whose
	// names all carry a qualifier the banner never prints -- `Legg Mason
	// Partners VARIABLE Large Cap Value Portfolio` for a heading reading
	// `TRAVELERS SERIES FUND INC. - SMITH BARNEY LARGE CAP VALUE PORTFOLIO` --
	// is unreachable there while the siblings registered without it resolve.
	// The stem goes back through the whole chain instead, the dictionary
	// included, as the registrant-run cuts already do with their remainders.
	if stem := issBrandCutStem(ix, line); stem != "" {
		if s := icrResolveFundShared(ix, stem); s != "" {
			return s
		}
		return htmlDictionaryFund(ix, dict, stem)
	}
	return ""
}

// issBrandCutStem returns the heading with the registrant's own prefix (or one
// of its former conformed names) and the successor brand behind it both cut,
// or "" when the heading carries no such pair.
func issBrandCutStem(ix *issSeriesIndex, line string) string {
	if !issStripRegistrantPrefix || ix == nil {
		return ""
	}
	for _, pk := range append([]string{ix.registrantKey}, ix.formerKeys...) {
		rest, ok := issCutRegistrantPrefix(normalizeSeriesName(line), pk)
		if !ok {
			continue
		}
		if stem := issHistoricalBrandStem(issHistoricalBrandKey(rest)); stem != "" {
			return stem
		}
	}
	return ""
}

// issBroadridgeTailLookback bounds the walk back from the switch to the fund
// line that introduces it; the whole meeting block sits between them.
const issBroadridgeTailLookback = 60

// issBroadridgeTailStart finds the line at which the filing stops printing this
// grammar and starts printing Broadridge meeting blocks, or -1.
//
// The evidence is a Broadridge column header with a Broadridge meeting label
// beneath the cut -- matchBroadridge's own test, applied to the remainder --
// and the cut itself is the bare, unruled fund line that introduces the switch:
// an unindented line alone between blanks, carrying no label of its own. Cutting
// at the header instead would hand the reader a block with no fund and no
// meeting identity.
func issBroadridgeTailStart(lines []string) int {
	h := -1
	for i, l := range lines {
		if brColumnHeader(strings.TrimSpace(l)) {
			h = i
			break
		}
	}
	if h < 0 {
		return -1
	}
	// Only a header whose every cell brColumnMap can name is handed over. A
	// mixed file printing the canonical `ITEM | PROPOSAL | TYPE | VOTE |
	// FOR/AGAINST MANAGEMENT` table is declined by this layout and claimed at
	// dispatch instead; see TestISSNPXDoesNotClaimTheBroadridgeTable.
	var spill []string
	for _, j := range []int{h - 1, h + 1} {
		if j >= 0 && j < len(lines) {
			if s := strings.TrimSpace(lines[j]); s != "" && brColumnFurniture(s) {
				spill = append(spill, s)
			}
		}
	}
	if brBuildColumnMap(strings.TrimSpace(lines[h]), spill) == nil {
		return -1
	}
	for c := h - 1; c >= 0 && h-c <= issBroadridgeTailLookback; c-- {
		s := strings.TrimSpace(lines[c])
		if s == "" || strings.HasPrefix(lines[c], " ") || strings.HasPrefix(lines[c], "\t") {
			continue
		}
		if strings.Contains(s, ":") || brDashRule(s) || len(brFindLabels(s)) > 0 {
			continue
		}
		if c == 0 || strings.TrimSpace(lines[c-1]) != "" {
			continue
		}
		if c+1 >= len(lines) || strings.TrimSpace(lines[c+1]) != "" {
			continue
		}
		if !matchBroadridge(strings.Join(lines[c:], "\n")) {
			return -1
		}
		return c
	}
	return -1
}

func parseISSNPX(text string, meta FilingMeta) ([]VoteRow, error) {
	// The header declares a <SERIES-ID>/<SERIES-NAME> pair per series and the body
	// prints a fund heading, so the name is the bridge between a vote and its
	// series id. A heading that names no declared series, or one two series answer
	// to, resolves to "" and the row is emitted with an empty series_id: the
	// chassis still stamps single-series filings, and nothing here guesses.
	seriesIx := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))
	issFormerKeys(seriesIx, meta.FormerNames)
	dict := cikDict.exactFallback(meta)

	// The registrant name is a per-filing constant, so it is folded once here
	// rather than once per banner: normalising it inside the lookup made the strip
	// cost O(banners x len(COMPANY CONFORMED NAME)), and both of those grow with
	// the same untrusted file.
	var (
		rows        []VoteRow
		fund        string
		fundSeries  string
		fundClasses string
		issuer      string
		ticker      string
		cusip       string
		mtgDate     string
		mtgType     string
		recDate     string
		lastLine    string

		// bannerRename is the filing-wide pairing issRenamedBannerFill reads off
		// this filing's own header and its own banners; nil for every filing
		// whose banners all answer. Built once, below, where `lines` exists.
		bannerRename map[string]*SeriesDecl

		inTable bool
		// tailRow is the index in rows of the last row flushed from the OPEN
		// table, or -1. A wrapped tail that arrives after a blank line -- with no
		// row open -- belongs to it; see the lookahead below.
		tailRow int
		// sponsorFirst is set from the column header: one vintage names Sponsor
		// before Proposal, which moves it off the right edge the peel works from.
		sponsorFirst bool
		// votedCol is set from the header too: `Proposal By | Voted | Vote Cast
		// | Management Recommendation` is the vanguard column set under an
		// issnpx `#` header, with a Yes/No VOTED cell between sponsor and vote.
		votedCol bool
		// distCols is set from a header that declares NO Vote Cast column but
		// percentage columns named for the choices; see issDistributionHeader.
		distCols []string
		cur      *issRowBuf

		// blankRun counts CONSECUTIVE blank lines, so an incomplete row may
		// survive the single `&nbsp;` paragraph that separates it from its
		// wrapped tail without surviving a real gap in the document.
		blankRun int

		// ordinalGroups holds the `<n>` of every `<n>.<letter>.` section label
		// already accepted as a boundary; a later sibling of the same group is
		// a heading on its label alone. See issOrdinalSectionLabel.
		ordinalGroups map[string]bool

		// blankID marks that the CURRENT meeting block printed its identity line
		// with both values empty (`Ticker:            Security ID:`), and
		// blankIDRows collects the indexes of the rows that block emitted. The
		// twin block that carries the id may appear anywhere later in the filing,
		// so the fill is resolved once at the end over the rows already emitted;
		// nothing rescans the document. See issFillBlankIdentity.
		blankID     bool
		blankIDRows []int
	)

	tailRow = -1
	flush := func() {
		if cur == nil {
			return
		}
		if cur.item != "" {
			rows = append(rows, VoteRow{
				SeriesID:                 fundSeries,
				ClassIDs:                 fundClasses,
				FundName:                 fund,
				IssuerName:               issuer,
				CUSIP:                    cusip,
				Ticker:                   ticker,
				MeetingDate:              mtgDate,
				MeetingType:              mtgType,
				RecordDate:               recDate,
				ItemSeq:                  cur.item,
				VoteDescription:          strings.Join(cur.text, " "),
				ManagementRecommendation: cur.mgmt,
				HowVoted:                 cur.cast,
				VoteSource:               cur.sponsor,
				VoteOtherInfo:            cur.voted,
			})
			tailRow = len(rows) - 1
			if blankID {
				blankIDRows = append(blankIDRows, tailRow)
			}
		}
		cur = nil
	}

	// A fund name that wrapped is spread over consecutive rule lines, so the name
	// is accumulated here and only becomes the fund once the wrap has ended.
	// Bounded by issMaxBannerLines.
	var bannerBuf []string

	// reorgPred/reorgSucc carry the reorganization banner a filing prints over the
	// section of a merged-away fund, `VOTES BY VICTORY INTERNATIONAL FUND PRIOR TO
	// THE REORGANIZATION WITH TEMPLETON FOREIGN FUND EFFECTIVE OCTOBER 24, 2003.`
	// The predecessor has no series id of its own and never will; the SUCCESSOR is
	// a name the filing's own header or dictionary carries, and it is the fund
	// whose assets cast these votes.
	reorgPred, reorgSucc := "", ""

	// bannerPlain marks a banner the vendor printed as a bare line rather than
	// between rules. Only such a heading is read against the registrant's
	// dictionary: a ruled banner that resolves to nothing resolves to nothing.
	bannerPlain := false

	commitBanner := func() {
		if len(bannerBuf) == 0 {
			bannerPlain = false
			return
		}
		banner := strings.Join(bannerBuf, " ")
		name, d := issResolveFund(seriesIx, banner)
		// The dictionary rung is a TOLERANCE and may not outrank the filing's own
		// exact declaration of this very name -- the <CLASS-CONTRACT-NAME> of a
		// two-tier trust included. Pacific Select Fund declares one series for 33
		// portfolios and heads each section with its class contract's own name, so
		// `EMERGING MARKETS PORTFOLIO` is declared exactly; without this the
		// dictionary's `Emerging Markets Debt Portfolio` (S000036460, a different
		// fund declared four years later, a name these bytes never print) takes
		// 1,783 rows off the declared series.
		if !issBannerDeclaredExact(seriesIx, banner) {
			if alt := issDictInsertedWordDecl(seriesIx, dict, banner, d); alt != nil {
				d = alt
			}
			// The sub-adviser suffix cut, read EXACTLY, outranks whatever the
			// uncut heading reached by tolerance.
			if alt := issAdvisorSuffixDecl(seriesIx, banner); alt != nil {
				d = alt
			}
		}
		// The successor named over this very section replaces whatever the
		// predecessor's name fuzz-matched: on the full Templeton filing the
		// heading reaches `Templeton International Climate Change Fund`, a fund
		// that did not exist in 2004. Only an EXACT declared name is read.
		if reorgPred != "" && normalizeSeriesName(banner) == reorgPred {
			if succ, _ := lookupSeriesEntry(seriesIx.byName, reorgSucc); succ != nil {
				d = succ
			}
			reorgPred, reorgSucc = "", ""
		}
		bannerBuf = bannerBuf[:0]
		plain := bannerPlain
		bannerPlain = false
		// The series already established by the evidence above this banner. A
		// banner that resolves to nothing must not erase it: Vantagepoint's
		// sub-adviser reports name the fund in the page heading
		// (`VANTAGEPOINT INTERNATIONAL FUND`, this filing's own declaration
		// S000008133) and then rule the section with the REGISTRANT's own name
		// (`===== THE VANTAGEPOINT FUNDS =====`), which is no fund's name --
		// 1,143 rows of that section went out blank because the rule erased
		// what the heading had just answered. This is the DICT-OVERRIDE rule
		// read the other way round, and the guard commit 13467611 gave the
		// sibling labelvalue layout for this very registrant: only evidence
		// that resolves may replace a resolved series.
		prevSeries, prevClasses := fundSeries, fundClasses
		fund = name
		fundSeries, fundClasses = "", ""
		if d != nil {
			fundSeries = d.SeriesID
			fundClasses = strings.Join(d.ClassIDs, MultiValueSep)
			return
		}
		if plain {
			fundSeries = issPlainHeadingSeries(seriesIx, dict, banner)
			return
		}
		// A RULED banner is not read against the dictionary as printed -- but
		// one that spells the registrant's OWN name and then a successor brand
		// (`TRAVELERS SERIES FUND INC. - SMITH BARNEY LARGE CAP VALUE
		// PORTFOLIO` for a registrant whose every declared name reads `Legg
		// Mason Partners Variable ... Portfolio`) has named the two things
		// standing between the heading and the vocabulary. Only the stem those
		// two cuts leave goes back through the chain, and only an exact or
		// dictionary-exact answer to it counts.
		if stem := issBrandCutStem(seriesIx, banner); stem != "" {
			fundSeries = issPlainHeadingSeries(seriesIx, dict, stem)
		}
		// The section may be named by a banner every rung above refuses and this
		// filing's own left-over declaration answers on a token neither side
		// spells twice; see issRenamedBannerFill. Fills a blank only.
		if fundSeries == "" && bannerRename != nil {
			if alt := bannerRename[normalizeSeriesName(banner)]; alt != nil {
				fundSeries = alt.SeriesID
				fundClasses = strings.Join(alt.ClassIDs, MultiValueSep)
				return
			}
		}
		if fundSeries == "" && issRegistrantOwnBanner(seriesIx, banner) {
			fundSeries, fundClasses = prevSeries, prevClasses
		}
	}

	lines := issRejoinWrappedLabels(strings.Split(text, "\n"))
	// The cover's series list may print a fund's rename under its current name,
	// which is the only place a body banner spelling the OLD name is declared.
	issCoverRenameAliases(seriesIx, lines)
	// Read AFTER the cover's aliases are folded in, so the accounting below
	// sees exactly the answers the loop will reach.
	bannerRename = issRenamedBannerFill(lines, seriesIx)
	// A filer agent may abandon this grammar mid-document for Broadridge
	// meeting blocks (MFS Series Trust XI 2004: 52 issuers under a bare fund
	// line, none of them read). The remainder of the body is handed to the
	// parser that owns that grammar rather than dropped.
	brTail := issBroadridgeTailStart(lines)
	for i := 0; i < len(lines); i++ {
		if i == brTail {
			flush()
			tail, err := parseBroadridge(strings.Join(lines[i:], "\n"), meta)
			if err != nil {
				return rows, err
			}
			// The switch line IS the fund heading, and the grammar below it
			// prints no heading of its own. It is resolved through this
			// parser's own chain, and stamped only on rows the Broadridge
			// reader left unnamed.
			switchFund := strings.TrimSpace(lines[i])
			switchSeries := issPlainHeadingSeries(seriesIx, dict, switchFund)
			for j := range tail {
				if tail[j].FundName == "" && tail[j].SeriesID == "" {
					tail[j].FundName = switchFund
					tail[j].SeriesID = switchSeries
				}
			}
			rows = append(rows, tail...)
			break
		}
		line := strings.TrimSpace(lines[i])

		// `Item 1. Signal Funds` opens a section of the report under a family
		// name the registrant's own name never carries (The Coventry Group
		// files for Signal and Shelby). The banners below it print that brand
		// in front of names the header declares without one, so the opener's
		// family is a brand for the rest of the file.
		if fam, ok := issItemFamilyBrand(line); ok {
			seriesIx.addBrand(fam)
		}

		if pred, succ, ok := issReorganizationBanner(lines, i); ok {
			reorgPred, reorgSucc = pred, succ
		}

		name, ok := issFundSeparator(line)
		bannerTail := ""
		if !ok {
			// The banner and the first issuer on ONE line, `=== Praxis Growth
			// Index Fund ===   ABBOTT LABORATORIES` (Praxis Mutual Funds 2023,
			// 10,786 of 11,550 rows with no date on run71): unread as a banner,
			// the whole line became the issuer and the fund heading was lost.
			name, bannerTail, ok = issBannerWithTail(line)
		}
		if !ok {
			name, ok = issOpenBanner(line, lines, i)
		}
		if !ok {
			name, ok = issTruncatedBannerOpener(line, lines, i)
		}
		if ok && name == "" {
			// A bare rule is a boundary with no name -- unless the fund is
			// printed between it and the next bare rule.
			if n, sandwich := issRuledSandwichBanner(lines, i); sandwich {
				name = n
			}
		}
		if !ok && len(bannerBuf) > 0 {
			name, ok = issThinBannerContinuation(lines, i)
		}
		if !ok && line != "" && i+2 < len(lines) && issReportTitleLine(strings.TrimSpace(lines[i+1])) {
			period := strings.Split(strings.TrimSpace(lines[i+2]), "-")
			if len(period) == 2 && htmlDate(period[0]) != "" && htmlDate(period[1]) != "" {
				name, ok = line, true
			}
		}
		plainHeading := false
		if !ok && line != "" && i+1 < len(lines) &&
			(strings.TrimSpace(lines[i+1]) == "" || issSubadviserLine(lines[i+1])) &&
			!issIdentityBlockFollows(lines, i) {
			// A bare paragraph is a boundary only on an exact, unique name.
			if d, _ := lookupSeriesEntry(seriesIx.byName, line); d != nil {
				name, ok = line, true
			} else if inTable && issProposalWrapLine(lines, i) {
				// ... and never on the wrapped tail of the proposal still open
				// above it, however well the tail resolves.
			} else if issVoteRowLine(line) {
				// ... nor on a COMPLETE numbered proposal row of this grammar,
				// which the wrap guard above does not cover.
			} else if issPlainHeadingSeries(seriesIx, dict, line) != "" {
				// ... or on a name the registrant's own dictionary carries
				// exactly. Pacific Select Fund prints its portfolio as a bare
				// line above each block and declares no series at all, so a
				// heading the dictionary answers to is the only evidence the
				// filing gives, and it is exact.
				name, ok = line, true
				plainHeading = true
			} else if g, labelled := issOrdinalSectionLabel(line); labelled && ordinalGroups[g] {
				// ... or on a `<n>.<letter>.` label of a series whose earlier
				// member this filing already opened a section on. The label is
				// the evidence, so the section opens whether or not the name
				// behind it resolves, and an undeclared sibling's rows come out
				// blank rather than inheriting the last declared sibling's id.
				name, ok = line, true
				plainHeading = true
			}
		}
		if ok && fundSeries != "" && bannerTail == "" && len(bannerBuf) == 0 &&
			(name == "Nuveen Asset Management LLC" || name == "Institutional Capital LLC") {
			// These audited manager banners are subheadings only immediately
			// after a resolved fund banner, not aliases for any fund.
			j := i - 1
			for j >= 0 && j >= i-3 && strings.TrimSpace(lines[j]) == "" {
				j--
			}
			if j >= 0 && j >= i-3 {
				if prior, ruled := issFundSeparator(strings.TrimSpace(lines[j])); ruled {
					_, d := issResolveFund(seriesIx, prior)
					_, declared := lookupSeriesTolerantEntry(seriesIx.byName, name)
					_, manager := issResolveFund(seriesIx, name)
					if d != nil && d.SeriesID == fundSeries && !declared && manager == nil {
						continue
					}
				}
			}
		}
		if ok {
			flush()
			inTable, tailRow = false, -1
			if name == "" {
				// A bare rule closes any banner still accumulating above it, so a
				// name never joins across a divider.
				commitBanner()
			} else {
				if len(bannerBuf) > 0 && seriesIx.registrantKey == "munder series trust" {
					prior := strings.Join(bannerBuf, " ")
					// Munder's empty funds have adjacent, independently complete banners.
					if strings.HasSuffix(normalizeSeriesName(prior), " fund") &&
						strings.HasSuffix(normalizeSeriesName(name), " fund") && !issBannerWrapVisible(prior, name) {
						commitBanner()
					}
				}
				if len(bannerBuf) >= issMaxBannerLines {
					commitBanner()
				}
				if g, labelled := issOrdinalSectionLabel(name); labelled {
					if ordinalGroups == nil {
						ordinalGroups = map[string]bool{}
					}
					ordinalGroups[g] = true
				}
				bannerBuf = append(bannerBuf, name)
				bannerPlain = plainHeading
				if !issBannerContinues(lines, i+1) {
					commitBanner()
				}
			}
			issuer, ticker, cusip = "", "", ""
			mtgDate, mtgType, recDate = "", "", ""
			blankID = false
			lastLine = bannerTail
			continue
		}
		// A banner cannot span anything but rule lines. Any other line ends it,
		// including one the loop below goes on to ignore -- except a WHITESPACE
		// line with the continuation rule right after it: an HTML report renders
		// each rule as its own block with an empty block between (Wells Fargo
		// Master Trust 2010), and that gap is layout, not a section boundary.
		if len(bannerBuf) > 0 {
			// ... and only while the banner so far names no declared series: a
			// complete banner followed by a blank line and another banner is two
			// funds (Russell Investment Co 2008, a fund with no votes above the
			// next fund), and joining them lost the second fund's series.
			if line == "" && issBannerContinues(lines, i+1) {
				// ... and only when the wrap is visible in the text itself: the
				// banner so far has an unclosed parenthesis, or the next rule is a
				// lone type word (`Portfolio`, `Trust)`). Two headings that merely
				// fail to resolve are two funds the audited map may still know
				// (JNL/Mellon 2006), and joining them changed the map's key.
				if issBannerWrapVisible(strings.Join(bannerBuf, " "), issNextBannerName(lines, i+1), seriesIx) {
					continue
				}
			}
			commitBanner()
		}

		if line != "" {
			blankRun = 0
		}
		if line == "" {
			// A BLANK LINE DOES NOT CLOSE A ROW THAT IS STILL WAITING FOR ITS
			// CELLS. The SGML-wrapped vintage prints each cell block as its own
			// <p>, with a `&nbsp;` paragraph between, so the wrapped tail of a
			// proposal -- and the tail of a Vote Cast value that wrapped with it
			// -- arrives AFTER a blank line:
			//
			//	1  Accept 2005 Operating Results and  For  Did Not  Management
			//
			//	Financial Statements  Vote
			//
			// Closing on the blank stranded `Did Not` with no completion, so the
			// row emitted a blank how_voted and kept every cell in its text.
			// Measured 2026-09-01, 961 of 14,680 rows (6.55%) across two filings
			// of this family. A complete row still closes here, which is what
			// keeps a finished proposal's text from running on.
			//
			// ONE blank line, not a run of them. The `&nbsp;` paragraph between a
			// row and its tail is a single line; a row that is still incomplete
			// after two is not waiting for a wrap, it is an orphan, and letting
			// it stay open lets it swallow whatever follows. Measured 2026-09-01
			// the unbounded form took issnpx's spliced-cell rows from 3 to 2,412
			// -- tiny against 166M rows, but a regression this change introduced
			// and nothing in the format asked for.
			if cur == nil || cur.complete() || blankRun > 0 {
				flush()
				blankRun = 0
			} else {
				blankRun++
			}
			continue
		}

		// THE IDENTITY MAY BE A GRID RATHER THAN LABELLED PAIRS: a row of bare
		// labels with the values on the line beneath, aligned by column
		// (WisdomTree Trust 2023):
		//
		//	Ticker:  Security ID:   Meeting Date:  Meeting Type:  Record Date:
		//	HEI      D31709104      May-11-2023    Annual         Apr-19-2023
		//
		// Read as labelled pairs the label line yields ticker "" and security id
		// "Meeting" -- the word scraped off the next label -- the meeting date is
		// lost, and the value line, carrying no cells, becomes the next issuer
		// name. This must be tested BEFORE issTickerLine, which matches the label
		// line. Both lines are consumed here.
		// issMaybeGridRow is a byte scan, no allocation: the common line leaves
		// here before anything splits it into columns.
		if j := -1; issMaybeGridRow(line) {
			j = issNextNonBlankIdx(lines, i+1)
			if j >= 0 && issMaybeGridRow(lines[j]) {
				if tk, id, md, mt, rd, ok := issStackedLabelGrid(line, strings.TrimSpace(lines[j])); ok {
					flush()
					inTable, tailRow = false, -1
					ticker, cusip = tk, id
					blankID = false
					issuer = lastLine
					mtgDate, mtgType, recDate = md, mt, rd
					i = j
					continue
				}
			}
		}

		// Meeting headers. A Ticker/Security ID line opens a new meeting, so it
		// closes any table still open above it and claims the last free-standing
		// line as the issuer name.
		if tk, id, ok := issTickerLine(line); ok {
			flush()
			inTable, tailRow = false, -1
			ticker, cusip = tk, id
			blankID = tk == "" && id == ""
			issuer = lastLine
			mtgDate, mtgType, recDate = "", "", ""
			// The identity on ONE line: `Ticker: ABT Security ID: 002824100
			// Meeting Date: APR 28, 2023 Meeting Type: Annual Record Date: MAR
			// 01, 2023` (Praxis Mutual Funds 2023). The dates after the security
			// id are read here, or the meeting has none.
			if d, typ, ok := issMeetingLine(line); ok {
				mtgDate, mtgType = d, typ
			}
			if d, ok := issRecordLine(line); ok {
				recDate = d
			}
			continue
		}
		if d, typ, ok := issMeetingLine(line); ok {
			if d == "" && i+1 < len(lines) {
				year := strings.TrimSpace(lines[i+1])
				if len(year) == 4 && allDigits(year) {
					cut := strings.Index(strings.ToUpper(line), "MEETING TYPE:")
					if cut < 0 {
						cut = len(line)
					}
					if joined, _, _ := issMeetingLine(strings.TrimSpace(line[:cut]) + " " + year + " " + line[cut:]); joined != "" {
						d = joined
						i++
					}
				}
			}
			flush()
			inTable, tailRow = false, -1
			mtgDate, mtgType = d, typ
			continue
		}
		if d, ok := issRecordLine(line); ok {
			flush()
			inTable, tailRow = false, -1
			recDate = d
			continue
		}
		// A FOREIGN COLUMN HEADER CLOSES OUR TABLE. It is tested BEFORE our own
		// header: the Broadridge vote-summary header starts with `#` and names
		// PROPOSAL and VOTE, so read second it OPENED a table -- 324 rows of
		// `With Mgmt` in the vote position survived the decline that way. Everything below it belongs
		// to a grammar this layout cannot read, and reading it anyway attributed
		// one issuer's votes to another -- see issForeignTableHeader.
		if issForeignTableHeader(line) {
			flush()
			inTable, tailRow = false, -1
			continue
		}
		if issTableHeader(line) {
			sponsorFirst = issSponsorLeadsHeader(line)
			votedCol = issVotedColumnHeader(line)
			distCols = issDistributionHeader(line)
			flush()
			inTable = true
			continue
		}

		if issSkippableHeader(line) {
			continue
		}

		if !inTable {
			lastLine = line
			continue
		}

		item, rest := issSplitItem(line)

		// A WRAPPED LINE THAT BEGINS WITH A NUMERAL IS NOT A NEW ITEM:
		//
		//	17  Authorize Board to Set Issue Price for  For  Split Vote  Management
		//	10 Percent Per Year of Issued Capital
		//
		// Item 17's description continues "... for 10 Percent Per Year ...", but
		// issSplitItem reads the leading `10` as an item token, so the
		// continuation opens a row of its own -- truncating item 17 at "for" and
		// emitting a junk row with no cells and a blank vote. This is the same
		// defect c422f060 fixed in broadridge, and the same discriminator
		// settles it: a real item row inside a table brings cells of its own. A
		// row the filing reports without a vote still carries its Sponsor cell,
		// so it is not swallowed here.
		//
		// The test is the RIGHT EDGE, not the row's state. In the wrapped-Sponsor
		// vintage `1.2 Elect Director Colleen M. Pouliot  For  For` carries no
		// sponsor -- it is on the line below -- but it does end in vote values,
		// and that is what makes it a row. `10 Percent Per Year of Issued
		// Capital` ends in neither, and is text. Gating on whether the open row
		// is complete separates neither case and swallowed that whole vintage.
		//
		// A right edge that is the HEAD of a vote value the column wrapped --
		// `2  Elect Georg Ehrnrooth as Chairman of  For  Did Not`, with `Vote`
		// two lines down -- is a row too. Demoting it folded every such row
		// into the one above: the corpus's largest ISS filing emitted 41,241
		// rows where it prints 44,696. Measured 2026-09-02.
		if item != "" && inTable && cur != nil {
			toks := strings.Fields(rest)
			if _, _, sponsored := issPeelCell(toks, issSponsors); !sponsored {
				if _, _, voted := issPeelVote(toks); !voted && !issVoteHead(toks) {
					item, rest = "", line
				}
			}
		}

		if item != "" {
			flush()
			cur = &issRowBuf{item: strings.TrimRight(item, ".)")}
		} else if cur == nil {
			// A WRAPPED TAIL CAN ARRIVE AFTER A BLANK LINE. The HTML vintage puts
			// a blank between every physical line, so the blank flushes the
			// complete row and its wrapped description lands here with no row
			// open -- where, read as the next meeting's issuer name, it truncated
			// every description in that vintage at its first line.
			//
			// An issuer name is followed by a `Ticker:` line; a wrapped tail is
			// not. That lookahead is the whole test, and it is applied only while
			// a table is open and only to a line carrying no cells of its own.
			// A dashed rule is a table boundary, not text: two fixtures caught it
			// being appended as a tail. A tail has letters in it.
			if inTable && tailRow >= 0 && tailRow < len(rows) && strings.ContainsFunc(rest, unicode.IsLetter) {
				if _, _, _, sp := issPeelColumns(rest); sp == "" {
					if _, _, _, cellsOnly := issPeelTrailingCells(rest); !cellsOnly {
						// End of input counts as "no ticker follows": the last tail
						// in a document has nothing after it.
						next := issNextNonBlank(lines, i+1)
						_, _, isTicker := issTickerLine(next)
						_, isBanner := issFundSeparator(next)
						if next == "" || (!isTicker && !isBanner) {
							rows[tailRow].VoteDescription += " " + strings.TrimSpace(rest)
							continue
						}
					}
				}
			}
			// A non-item line with no row open is not a continuation: the table
			// has ended and this is the next meeting's issuer name.
			lastLine = line
			continue
		} else if cur.complete() {
			// The open row already carries its trailing cells, so this line is
			// the wrapped tail of the proposal and is text only. It is never
			// peeled, even when it is exactly a vocabulary word.
			//
			// One exception, and it is the vote cell wrapping rather than the
			// proposal: `Echo` is printed bare by one family (598 rows,
			// 2026-09-01) and as `Echo` over `Vote` by another. Now that the
			// bare form is a value the row line's peel succeeds on it, so the
			// `Vote` below would land here as text. A tail that does nothing but
			// complete a LONGER vocabulary value extends the cell instead; a
			// description wrapping to a lone `Vote` under a bare `Echo` row is
			// the one shape this cannot tell apart, and neither could a reader.
			tail := strings.TrimSpace(rest)
			if ext := cur.cast + " " + tail; tail != "" && issVoteValues[strings.ToLower(strings.Trim(ext, issCellTrim))] {
				cur.cast = ext
				continue
			}
			// A `<vote>: <qualifier>` cell wraps in its own column beside the
			// proposal's own wrap: `BERNAUER  W. BERNAUER` is one gap-cell of
			// text and one of qualifier, and a lone cell-sized line is the
			// qualifier's tail. See issPeelColonVote.
			if cur.colon && tail != "" {
				cells := icrCells(rest)
				short := len(cells) > 0
				for _, c := range cells {
					if len(strings.Fields(c)) > issMaxCellWords {
						short = false
					}
				}
				if short {
					cur.voted = strings.TrimSpace(cur.voted + " " + cells[len(cells)-1])
					if len(cells) > 1 {
						cur.text = append(cur.text, strings.Join(cells[:len(cells)-1], " "))
					}
					continue
				}
			}
			if tail != "" {
				cur.text = append(cur.text, tail)
			}
			continue
		}

		if distCols != nil && item != "" {
			if b, mg, ca, sp, ok := issPeelDistribution(rest, distCols); ok {
				cur.text = append(cur.text, b)
				cur.mgmt, cur.cast, cur.sponsor = mg, ca, sp
				continue
			}
		}

		if votedCol && item != "" {
			if b, mg, ca, vo, sp, ok := issPeelVotedColumn(rest); ok {
				cur.text = append(cur.text, b)
				cur.mgmt, cur.cast, cur.voted, cur.sponsor = mg, ca, vo, sp
				continue
			}
		}

		if sponsorFirst && item != "" {
			if b, mg, ca, sp, ok := issPeelSponsorFirst(rest); ok {
				cur.text = append(cur.text, b)
				cur.mgmt, cur.cast, cur.sponsor = mg, ca, sp
				continue
			}
		}

		// The proposal text can resume AFTER the sponsor on the same line, which
		// puts the cells in the middle where no right-edge peel can reach them.
		if _, _, _, sp := issPeelColumns(rest); sp == "" {
			if rebuilt, ok := issSplitWrappedTail(rest); ok {
				rest = rebuilt
			}
		}

		body, mgmt, cast, sponsor := issPeelColumns(rest)

		// THE VOTE CELL WRAPS TOO. When the opening line's peel failed and this
		// line completes the value, reunite the halves before either becomes
		// proposal text -- see issJoinWrappedVote.
		// THE SPONSOR COLUMN CAN WRAP ENTIRELY. When the proposal column is wide
		// the report prints Sponsor on the line BELOW its row -- and below the
		// column header too:
		//
		//	#     Proposal                          Mgt Rec   Vote Cast
		//	Sponsor
		//	1.1   Elect  Director Carol Mills       For       For
		//	Management
		//
		// Neither line carries both a sponsor and a vote, so issPeelColumns
		// fails on each and every cell stays in the proposal text. Measured
		// 2026-09-01 this is the corpus's worst filing by blank votes:
		// 0000743773-05-000030.txt emits 44,696 rows, all 44,696 with no vote.
		if sponsor == "" && cur.cast == "" && cur.sponsor == "" && len(cur.text) > 0 {
			if sp, remaining, found := issPeelCell(strings.Fields(rest), issSponsors); found && len(remaining) == 0 {
				prev := strings.Fields(cur.text[len(cur.text)-1])
				if cast, rest2, ok := issPeelVote(prev); ok {
					cur.sponsor, cur.cast = sp, cast
					if mg, rest3, found := issPeelVote(rest2); found {
						cur.mgmt, rest2 = mg, rest3
					}
					cur.text[len(cur.text)-1] = strings.Join(rest2, " ")
					continue
				}
			}
		}

		if sponsor == "" && cur.cast == "" && len(cur.text) > 0 {
			// The SPONSOR is the rightmost column, so it comes off before the
			// vote's head is at the edge to be found. That is also what puts the
			// two halves of `Echo Vote` next to each other:
			//
			//	1.7  Elect Trustee Larry D. Thompson  For  Echo  Management
			//	                                           Vote
			//
			// where the sponsor sits BETWEEN them on the row line.
			//
			// The line carrying the sponsor is not always the one just above:
			// the HTML vintage prints every cell in its own paragraph, and the
			// page renders the vote's tail AFTER a line of wrapped text --
			//
			//	2  APPROVAL OF THE ACTIONS OF THE MEMBERS OF  For  Did Not  Management
			//	   THE BOARD OF DIRECTORS AND OF THE
			//	Vote
			//
			// so the anchor is the nearest earlier line whose tail is a sponsor,
			// which is the row line itself. 766 rows in four filings, 2026-09-02.
			joined := false
			for j := len(cur.text) - 1; j >= 0 && !joined; j-- {
				prev := strings.Fields(cur.text[j])
				sp, prev, haveSponsor := issPeelCell(prev, issSponsors)
				if !haveSponsor {
					continue
				}
				// THE SPONSOR MAY BE ALONE ON ITS LINE (the vintage that prints
				// it below the row); the vote's head is then the line above it.
				headIdx := j
				if len(prev) == 0 && j > 0 {
					headIdx = j - 1
					prev = strings.Fields(cur.text[headIdx])
				}
				vote, prevKeep, contKeep, ok := issJoinWrappedVote(prev, strings.Fields(rest))
				// A CELL CAN WRAP OVER MORE THAN ONE LINE BELOW ITS ROW, in its own
				// column with nothing else on them:
				//
				//	1  Election of Directors  For  No shares  Management
				//	                                 held on
				//	                                 record
				//
				// The lines between the row and this one are then the cell's
				// middle. Only cell-sized lines qualify; a line of proposal text
				// is longer than any cell and is never folded into a vote.
				spanned := 0
				if !ok && j < len(cur.text)-1 {
					var between []string
					short := true
					for _, l := range cur.text[j+1:] {
						f := strings.Fields(l)
						if len(f) > issMaxCellWords {
							short = false
							break
						}
						between = append(between, f...)
					}
					if short {
						vote, prevKeep, contKeep, ok = issJoinWrappedVote(prev, append(between, strings.Fields(rest)...))
						spanned = len(cur.text) - 1 - j
					}
				}
				if !ok {
					break
				}
				cur.sponsor = sp
				if mg, remaining, found := issPeelVote(prevKeep); found {
					cur.mgmt, prevKeep = mg, remaining
				}
				cur.cast = vote
				cur.text[headIdx] = strings.Join(prevKeep, " ")
				if headIdx != j {
					cur.text = cur.text[:headIdx+1] // drops the lone sponsor line
				} else if spanned > 0 {
					cur.text = cur.text[:j+1]
				}
				if tail := strings.Join(contKeep, " "); tail != "" {
					cur.text = append(cur.text, tail)
				}
				joined = true
			}
			if joined {
				continue
			}
		}

		// A CONTINUATION MAY BE NOTHING BUT CELLS. issPeelColumns needs three
		// tokens; this line has two, and its proposal text is on the line above.
		// THE VOTE VALUE ITSELF CAN STRADDLE THE WRAP, with the sponsor after it:
		//
		//	5  Advisory Vote on Say on Pay Frequency  One Year  One
		//	Year  Management
		//
		// `One Year` is Vote Cast, split `One` / `Year`. The sponsor comes off
		// the continuation first, and what remains is the vote's TAIL -- its head
		// is at the end of the line above. issJoinWrappedVote looks at the
		// continuation's own tail, which here is the sponsor, so it cannot see
		// this; the halves meet only once the sponsor is out of the way.
		if sponsor == "" && cur.cast == "" && cur.sponsor == "" && len(cur.text) > 0 {
			if sp, contRest, found := issPeelCell(strings.Fields(rest), issSponsors); found && len(contRest) > 0 {
				prev := strings.Fields(cur.text[len(cur.text)-1])
				for k := 1; k <= issMaxCellWords && k <= len(prev); k++ {
					candidate := strings.Join(append(append([]string{}, prev[len(prev)-k:]...), contRest...), " ")
					if !issVoteValues[strings.ToLower(strings.Trim(candidate, issCellTrim))] {
						continue
					}
					prevKeep := prev[:len(prev)-k]
					cur.sponsor, cur.cast = sp, candidate
					if mg, remaining, ok := issPeelVote(prevKeep); ok {
						cur.mgmt, prevKeep = mg, remaining
					}
					cur.text[len(cur.text)-1] = strings.Join(prevKeep, " ")
					break
				}
				if cur.cast != "" {
					continue
				}
			}
		}

		if sponsor == "" && cur.cast == "" {
			if mg, ca, sp, ok := issPeelTrailingCells(rest); ok {
				cur.cast, cur.sponsor = ca, sp
				if mg != "" {
					cur.mgmt = mg
				} else if len(cur.text) > 0 {
					// The Mgt Rec cell stayed on the row's own line, where it now
					// sits at the end of the text.
					prev := strings.Fields(cur.text[len(cur.text)-1])
					if cell, remaining, found := issPeelVote(prev); found {
						cur.mgmt = cell
						cur.text[len(cur.text)-1] = strings.Join(remaining, " ")
					}
				}
				continue
			}
		}

		if sponsor == "" && cur.cast == "" && item != "" {
			if b, mg, ca, q, sp, ok := issPeelColonVote(rest); ok {
				if b != "" {
					cur.text = append(cur.text, b)
				}
				cur.mgmt, cur.cast, cur.sponsor, cur.voted, cur.colon = mg, ca, sp, q, true
				continue
			}
		}

		if body != "" {
			cur.text = append(cur.text, body)
		}
		if sponsor != "" {
			cur.mgmt, cur.cast, cur.sponsor = mgmt, cast, sponsor
		}
	}
	flush()

	issFillBlankIdentity(rows, blankIDRows)
	issResidualEliminate(rows, seriesIx)

	// A ZERO-ROW CLAIM IS NOT A RESULT. Measured 2026-08-31, this layout claimed
	// 3,722 filings and read nothing out of any of them, and each was recorded as
	// `ok` with n_rows=0 -- indistinguishable in the manifest from a fund that
	// genuinely cast no votes. Reading them showed the claim was almost always
	// right and the CLASSIFICATION wrong: 2,650 carry an affirmative no-vote
	// statement and no vote-table vocabulary anywhere ("This fund had no proxy
	// voting activity during the reporting period"), and exactly one is a real
	// extraction failure.
	//
	// Declining hands the body back to the registry and, once every layout has
	// passed on it, to the chassis sentinel at the end of parseTextFiling. That
	// sentinel already owns this decision, already spells "no proxy voting
	// activity" in noActivitySentinels, and already guards it with
	// hasVoteTableVocabulary so a multi-fund filing cannot have its real table
	// erased by another fund's nil statement. Re-implementing that test here
	// would be a SECOND vocabulary for one fact, and every duplicated vocabulary
	// in this parser has drifted from the one it copied.
	if len(rows) == 0 {
		return nil, errLayoutDeclined
	}
	return rows, nil
}

// issResidualEliminate stamps the ONE heading a filing leaves unresolved when
// the filing's own arithmetic leaves no other answer: every other heading
// resolved, each to a DIFFERENT declared series, and exactly one declared series
// is left over. AXP Variable Portfolio Managed Series Inc prints two banners and
// declares two ids; the Diversified Equity Income banner resolves, and the
// remaining banner (`AXP VARIABLE PORTFOLIO - MANAGED FUND`) names the series
// the dictionary spells only under its successor name `RiverSource Variable
// Portfolio Balanced Fund` -- a rename sharing no distinctive word, so no
// name-based rung can reach it (1,761 of 2,999 rows).
//
// This is the only rung that stamps without name evidence, so it is confined to
// the case where the choice is forced: two or more declared series, at least one
// resolved heading, exactly one unresolved heading, and exactly one unclaimed
// series. Any second unresolved heading or second unclaimed series is a guess
// between them, and refuses.
func issResidualEliminate(rows []VoteRow, ix *issSeriesIndex) {
	if len(ix.decls) < 2 {
		return
	}
	claimed := make(map[string]bool)
	byFund := make(map[string]string)
	unresolved := ""
	for _, r := range rows {
		if r.FundName == "" {
			return
		}
		if r.SeriesID == "" {
			if unresolved != "" && unresolved != r.FundName {
				return
			}
			unresolved = r.FundName
			continue
		}
		if prev, seen := byFund[r.FundName]; seen && prev != r.SeriesID {
			return
		}
		byFund[r.FundName] = r.SeriesID
		claimed[r.SeriesID] = true
	}
	if unresolved == "" || len(byFund) == 0 || len(byFund) != len(claimed) {
		return
	}
	var left *SeriesDecl
	for i := range ix.decls {
		if claimed[ix.decls[i].SeriesID] {
			continue
		}
		if left != nil {
			return
		}
		left = &ix.decls[i]
	}
	if left == nil {
		return
	}
	for i := range rows {
		if rows[i].SeriesID == "" {
			rows[i].SeriesID = left.SeriesID
			rows[i].ClassIDs = strings.Join(left.ClassIDs, MultiValueSep)
		}
	}
}

// issFillBlankIdentity fills the ticker and CUSIP of the rows a BLANK identity
// block emitted from a TWIN block in the same filing -- same issuer name, same
// meeting date, id printed. Artisan Funds (CIK 935015) prints `Ticker:
// Security ID:` with nothing after either label, and a few blocks later the
// same meeting again with `Ticker: CBY  Security ID: 12721E102`; 252 rows
// across six filings 2004-2010 carry an id the filing does print.
//
// AN ID IS A LINK KEY, SO A TIE IS A REFUSAL. The fill runs only when EXACTLY
// ONE (ticker, cusip) pair appears among the id-bearing rows for that (issuer,
// meeting date); zero candidates and two or more disagreeing candidates both
// leave the block blank rather than guess. Most Artisan blank blocks have no
// twin at all and stay blank -- that is the floor, not a failure.
//
// Cost is O(rows): one pass to index the id-bearing rows, one over the blank
// rows recorded during the walk. Nothing rescans the document, and the index is
// built only when the filing actually has a blank block.
func issFillBlankIdentity(rows []VoteRow, blank []int) {
	if len(blank) == 0 {
		return
	}
	type issIDCand struct {
		ticker, cusip string
		tie           bool
	}
	byMeeting := make(map[[2]string]*issIDCand)
	for i := range rows {
		if rows[i].CUSIP == "" && rows[i].Ticker == "" {
			continue
		}
		if rows[i].IssuerName == "" || rows[i].MeetingDate == "" {
			continue
		}
		k := [2]string{rows[i].IssuerName, rows[i].MeetingDate}
		c, seen := byMeeting[k]
		if !seen {
			byMeeting[k] = &issIDCand{ticker: rows[i].Ticker, cusip: rows[i].CUSIP}
			continue
		}
		if c.ticker != rows[i].Ticker || c.cusip != rows[i].CUSIP {
			c.tie = true
		}
	}
	for _, ix := range blank {
		r := &rows[ix]
		if r.CUSIP != "" || r.Ticker != "" || r.IssuerName == "" || r.MeetingDate == "" {
			continue
		}
		c, ok := byMeeting[[2]string{r.IssuerName, r.MeetingDate}]
		if !ok || c.tie {
			continue
		}
		r.Ticker, r.CUSIP = c.ticker, c.cusip
	}
}

// issSeriesIndex is the per-filing bridge from a printed fund heading to a
// declared series: the exact index seriesByName builds, and the registrant's
// own name folded once, since it is constant across every banner in the
// filing.
type issSeriesIndex struct {
	byName        map[string]*SeriesDecl
	registrantKey string
	// cik is the filing's own registrant, so the cross-CIK rung at the tail of
	// the chain can tell a sibling registrant's dictionary row from this one's.
	// Empty when the index is built without a filing behind it.
	cik string
	// period is the filing's PERIOD OF REPORT (YYYYMMDD), so the cross-CIK rung
	// can refuse a declaration another registrant made after this filing.
	period string
	// depth counts the chain's own recursive re-resolutions of a cut banner, so
	// the cross-CIK rung can tell the heading as printed from a remainder.
	depth int
	// hdrOnly is this same index built from the filing's OWN declarations
	// alone, with the corpus dictionary unreadable: the answer this filing
	// reaches with no -cik-series loaded. A series id is a link key and a wrong
	// one is worse than a blank, so the dictionary rungs -- the folded aliases,
	// the registrant-scoped dictionary lookups and crossCIK alike -- may only
	// FILL a heading this index refuses, never replace what it answers. Nil on
	// the header-only index itself and whenever no dictionary is loaded.
	hdrOnly *issSeriesIndex
	// noDict makes every dictionary rung reached through this index refuse; see
	// issIndexDict.
	noDict bool
	// byTicker keys each class ticker the header declares, upper-cased, to its
	// series; a ticker two series share is dropped rather than guessed.
	byTicker map[string]*SeriesDecl
	// formerKeys are the registrant's FORMER CONFORMED NAMEs, normalised; the
	// registrant-prefix strip tries each of them after the current name.
	formerKeys []string
	// aliases keys a fund name the FILING ITSELF declares for a series, such as
	// the cover's `(changed name from <X> on <date>)`. Nil on collision like
	// every map here, and read only after the exact declared names.
	aliases map[string]*SeriesDecl

	// byCompact keys the same names with their spaces removed, for a banner
	// that spaces a token the header runs together (`Russell 2000` against
	// `Russell2000`). lessBrand keys each declared name with a leading run of
	// the registrant's own tokens removed (`Penn Series Small Cap Index Fund`
	// under `small cap index fund` for the registrant PENN SERIES FUNDS INC),
	// and brands holds those runs, longest first, for the banner-side strip.
	// Every map refuses on collision the way seriesByName does: a key two
	// distinct series answer to maps to nil, and nil is never stamped.
	byHistoricalBrand map[string]*SeriesDecl
	byCompact         map[string]*SeriesDecl
	lessBrand         map[string]*SeriesDecl
	// lessAnd keys declared names with their `and` (an `&` in the header)
	// dropped: Investment Managers Series Trust heads `Segall Bryant Hamill
	// Emerging Markets Fund` for `Segall Bryant & Hamill ...` (11k rows).
	lessAnd map[string]*SeriesDecl
	// lessBrandFull keys declared names with a brand cut; lessBrandType the
	// same with the trailing type word also dropped. Goldman Sachs Trust
	// heads `GS STRUCTURED INTERNATIONAL SMALL CAP` for `Goldman Sachs
	// Structured International Small Cap Fund` (327k rows). The type-word
	// form is consulted only for a banner that has NO type word of its own,
	// so `Total Bond Market Fund` is never `Total Bond Market Trust`.
	lessBrandFull   map[string]*SeriesDecl
	lessBrandType   map[string]*SeriesDecl
	lessLeadCompact map[string]*SeriesDecl
	// lessLeadToken keys each declared name with exactly ONE leading token
	// removed, for a printed heading that drops a brand the registrant's own
	// name does not supply: JP Morgan Fleming Series Trust 2004 heads
	// `MULTI-MANAGER SMALL CAP GROWTH FUND` for a declared `JPMorgan
	// Multi-Manager Small Cap Growth Fund`. Built once per filing and, like
	// every map here, nil on collision, so two declared names that agree after
	// the cut stay unresolved rather than guessed.
	lessLeadToken map[string]*SeriesDecl
	lessParen     map[string]*SeriesDecl   // declared names with a trailing parenthetical removed
	classPairs    map[string][]*SeriesDecl // the declared names behind a lessParen collision that differ only by a class marker
	decls         []SeriesDecl
	brands        []string
	// lessSuffix keys the declared names with their common last word removed,
	// built ONLY when every declared name (two at least) ends in the same word:
	// the College Retirement Equities Fund declares `<name> Account` throughout
	// and prints its banners without it. A fact of the filing's own header,
	// not a tolerance; nil when the names do not all agree.
	lessSuffix map[string]*SeriesDecl
	// lessSuffixSibling keys the stems lessSuffix would otherwise claim that a
	// SIBLING declaration answers to under a different trailing type word, and
	// holds that sibling: `Avantis International Equity` is the declared
	// `Avantis International Equity Fund`, not the `... ETF` the registrant's
	// dominant suffix would substitute for it. The contested stems are kept out
	// of lessSuffix, and two siblings sharing one stem are nil here and refuse.
	lessSuffixSibling map[string]*SeriesDecl
	// lessTypeWord keys the declared names with the registrant's own last
	// token removed from WHEREVER it sits ("500 Index Trust B" under "500
	// index b" for JOHN HANCOCK VARIABLE INSURANCE TRUST), built only when
	// two thirds of the declared names carry that token; nil otherwise.
	lessTypeWord map[string]*SeriesDecl
	// lessConjunct keys a declared name whose trailing `and <words>` conjunct
	// is dropped ahead of its type word: `PowerShares Dynamic Hardware
	// Portfolio` for a declared `PowerShares Dynamic Hardware & Consumer
	// Electronics Portfolio` (S000003050, 273 rows). Nil on collision.
	lessConjunct map[string]*SeriesDecl
	// lessAnyType keys a declared name by its TRAILING type word dropped, so a
	// heading that SUBSTITUTES one type word for another reaches it: `AMERITAS
	// SMALL CAP FUND` for a declared `Ameritas Small Cap Portfolio`
	// (S000008739, 1,021 rows). Two declared names that differ only by their
	// type word collide here and refuse.
	lessAnyType map[string]*SeriesDecl
	// lessCorpSuffix keys a declared name with its trailing incorporation word
	// removed, for a heading that prints the name without it: `NPF - THE JAPAN
	// FUND` for a declared `THE JAPAN FUND, INC.` (S000009778, Nomura Partners
	// Funds 2009, 3,430 rows with no series). Nil on collision like every map
	// here, and consulted only for an exact hit on the remainder.
	lessCorpSuffix map[string]*SeriesDecl
	// lessLeadTokenAnyType keys a declared name by ONE leading token dropped and
	// its trailing type word dropped as well, so a heading that omits an
	// acquirer's brand AND substitutes the type word reaches it: `ICAP Select
	// Equity Portfolio` for a declared `MainStay ICAP Select Equity Fund`
	// (S000000734, ICAP Funds 2005, 344 rows). Nil on collision.
	lessLeadTokenAnyType map[string]*SeriesDecl
	// lessBrandTypeCompact is lessBrandType compacted, for a heading that runs
	// the capitalization token together: `BRAZOS MIDCAP GROWTH` for a declared
	// `Brazos Mid Cap Portfolio` (S000005275, 462 rows).
	lessBrandTypeCompact map[string]*SeriesDecl
	// lessRegistrantLead keys a declared name by any run of LEADING tokens that
	// the registrant's own conformed name also carries, with its trailing
	// corporate suffix dropped as well: `T. Rowe Price High Yield Fund, Inc.`
	// under `high yield fund`, which is what the banner prints (S000002132, 215
	// rows). Registrant-scoped by construction, three tokens at least, nil on
	// collision.
	lessRegistrantLead map[string]*SeriesDecl
	// commonSuffix is the last word every declared name shares, kept so a
	// heading that DROPS it can be retried with it appended.
	commonSuffix string

	// normNames and normToks hold each declaration's normalised name and its
	// tokens, folded once at build time. The declaration-scanning rungs walk
	// every decl on every banner, and the normalisation depends only on the
	// declaration, so recomputing it in the loop is pure waste: a registrant
	// with 882 declared series costs 35+ CPU minutes on one filing without
	// this.
	normNames []string
	normToks  [][]string
	// resolved memoises issResolveFund per banner. A body prints the same page
	// heading on every page, and the resolution is pure in (ix, banner), so the
	// repeat is recomputation and never new evidence. Per-filing and
	// single-goroutine, so no lock.
	resolved map[string]issResolved
}

// issResolved is one memoised issResolveFund answer.
type issResolved struct {
	name string
	decl *SeriesDecl
}

// declNorm is the declaration's normalised name, folded once at build time.
func (ix *issSeriesIndex) declNorm(i int) string {
	if i < len(ix.normNames) {
		return ix.normNames[i]
	}
	return normalizeSeriesName(ix.decls[i].Name)
}

// declToks is the declaration's normalised name split into tokens, once.
func (ix *issSeriesIndex) declToks(i int) []string {
	if i < len(ix.normToks) {
		return ix.normToks[i]
	}
	return strings.Fields(ix.declNorm(i))
}

// issIndexDict is the corpus dictionary as this index may read it: nil on the
// header-only index, whose whole answer is the one the filing reaches with no
// dictionary loaded. Every ix-scoped dictionary rung goes through it.
func issIndexDict(ix *issSeriesIndex) *cikSeries {
	if ix == nil || ix.noDict {
		return nil
	}
	return cikDict
}

// issFormerKeys normalises the header's former conformed names for the index.
func issFormerKeys(ix *issSeriesIndex, former []string) {
	if ix.hdrOnly != nil {
		issFormerKeys(ix.hdrOnly, former)
	}
	// A former key is new evidence, so answers memoised before it arrived are
	// stale; the resolver's cache is only valid for a fixed index.
	clear(ix.resolved)
	for _, f := range former {
		if k := normalizeSeriesName(f); k != "" && k != ix.registrantKey {
			ix.formerKeys = append(ix.formerKeys, k)
		}
	}
}

// issFilingIndex is newISSSeriesIndex for a real filing, carrying the
// registrant's CIK the cross-CIK rung needs.
func issFilingIndex(decls []SeriesDecl, registrantKey, cik, period string) *issSeriesIndex {
	ix := newISSSeriesIndex(issDeclAliases(decls, cik, period), registrantKey)
	ix.cik = cik
	ix.period = period
	// The filing's own answer, computed on the same chain with the dictionary
	// unreadable, so the rungs below can fill what it refuses without ever
	// replacing what it answers. Built only when a dictionary is loaded: with
	// none there is nothing to outrank and nothing to build.
	if cikDict != nil {
		hdr := newISSSeriesIndex(decls, registrantKey)
		hdr.cik = cik
		hdr.period = period
		hdr.noDict = true
		issAuditedRenameAliases(hdr)
		ix.hdrOnly = hdr
	}
	// The audited rename table is registrant-scoped, not layout-scoped: the same
	// CIK's pre-2006 filings reach several vendors' grammars (American
	// AAdvantage Funds 2004 is broadridge, not issnpx), and a rename the
	// registrant made is the same fact whichever vendor typeset the report. See
	// issRegistrantRenames.
	issAuditedRenameAliases(ix)
	return ix
}

// issDeclAliases folds this CIK's dictionary names for the series the header
// ALREADY declares into the declaration set: a registrant renames a sleeve and
// the vendor keeps printing the old name, as Wells Fargo Variable Trust 2010
// heads `Wells Fargo Advantage VT International Core Fund` for a header that
// declares S000007222 under its 2010 name `VT International Equity Fund`
// (2,212 rows). Alias-only: no series id the header does not declare is ever
// added, so the fold can only widen the spellings of ids the filing itself
// names. The dictionary rows carry their DeclDate, so the vintage tiebreak
// that guards dictionary-backfilled rows elsewhere guards these too.
func issDeclAliases(decls []SeriesDecl, cik, period string) []SeriesDecl {
	if cikDict == nil || len(decls) == 0 || cik == "" {
		return decls
	}
	rows := cikDict.byCIK[cik]
	if len(rows) == 0 {
		return decls
	}
	known := map[string]map[string]bool{}
	// headerFor is the id the header itself prints for a normalised name, or
	// "" when more than one id carries it.
	headerFor := map[string]string{}
	for _, x := range decls {
		if known[x.SeriesID] == nil {
			known[x.SeriesID] = map[string]bool{}
		}
		k := normalizeSeriesName(x.Name)
		known[x.SeriesID][k] = true
		if k == "" {
			continue
		}
		if prev, seen := headerFor[k]; seen && prev != x.SeriesID {
			headerFor[k] = ""
		} else if !seen {
			headerFor[k] = x.SeriesID
		}
	}
	var alias []SeriesDecl
	for _, x := range rows {
		names, declared := known[x.SeriesID]
		if !declared {
			continue
		}
		k := normalizeSeriesName(x.Name)
		if k == "" || names[k] {
			continue
		}
		// The filing's OWN header declaration for a name always wins over a
		// same-CIK dictionary alias, at any vintage. A dictionary name the
		// header already prints for a DIFFERENT id cannot name this filing's
		// sleeve -- folding it in manufactures a collision `lookupSeriesEntry`
		// then refuses outright, losing the section that the filing's own
		// declaration resolves. This holds in both directions: a rename that
		// postdates the period of report (Wells Fargo Variable Trust), and a
		// stale name the registrant has since moved down the chain -- Advanced
		// Series Trust's 20060630 `AST BALANCED ASSET ALLOCATION PORTFOLIO`
		// sits on S000006792 while the 2022 and 2023 headers declare that exact
		// name for S000006793 (34,286 rows lost, 16,660 more wrongly stamped
		// through the descriptor rungs the refusal falls through to).
		if id, ok := headerFor[k]; ok && id != "" && id != x.SeriesID {
			continue
		}
		names[k] = true
		alias = append(alias, x)
	}
	if len(alias) == 0 {
		return decls
	}
	out := append(append([]SeriesDecl(nil), decls...), alias...)
	return dictContemporaneous(out, period)
}

func newISSSeriesIndex(decls []SeriesDecl, registrantKey string) *issSeriesIndex {
	ix := &issSeriesIndex{
		byName:            seriesByName(decls),
		registrantKey:     registrantKey,
		byHistoricalBrand: make(map[string]*SeriesDecl),
		byCompact:         make(map[string]*SeriesDecl, len(decls)),
		lessBrand:         make(map[string]*SeriesDecl),
		lessParen:         make(map[string]*SeriesDecl),
		lessLeadToken:     make(map[string]*SeriesDecl),
		classPairs:        make(map[string][]*SeriesDecl),
		decls:             decls,
		lessAnd:           make(map[string]*SeriesDecl),
		lessBrandFull:     make(map[string]*SeriesDecl),
		lessBrandType:     make(map[string]*SeriesDecl),
		lessLeadCompact:   make(map[string]*SeriesDecl),
		byTicker:          make(map[string]*SeriesDecl),
		lessConjunct:      make(map[string]*SeriesDecl),

		lessAnyType:          make(map[string]*SeriesDecl),
		lessCorpSuffix:       make(map[string]*SeriesDecl),
		lessLeadTokenAnyType: make(map[string]*SeriesDecl),
		lessBrandTypeCompact: make(map[string]*SeriesDecl),
		lessRegistrantLead:   make(map[string]*SeriesDecl),
		resolved:             make(map[string]issResolved),
	}
	ix.normNames = make([]string, len(decls))
	ix.normToks = make([][]string, len(decls))
	for i := range decls {
		ix.normNames[i] = normalizeSeriesName(decls[i].Name)
		ix.normToks[i] = strings.Fields(ix.normNames[i])
	}
	dupTicker := map[string]bool{}
	for i := range decls {
		for _, t := range decls[i].Tickers {
			k := strings.ToUpper(strings.TrimSpace(t))
			if k == "" {
				continue
			}
			if prev, seen := ix.byTicker[k]; seen && prev.SeriesID != decls[i].SeriesID {
				dupTicker[k] = true
			}
			ix.byTicker[k] = &decls[i]
		}
	}
	for k := range dupTicker {
		delete(ix.byTicker, k)
	}
	if toks := strings.Fields(registrantKey); len(toks) > 1 {
		for k := len(toks) - 1; k >= 1; k-- {
			ix.brands = append(ix.brands, strings.Join(toks[:k], " "))
		}
		// The registrant's initials are a brand too: SEI Institutional
		// Investments Trust declares "SIIT Dynamic Asset Allocation Fund", the
		// College Retirement Equities Fund prints "CREF Stock Account", and
		// John Hancock Funds II prints "JHFII" -- a Roman numeral is spelled
		// whole. Three letters at least, so a two-token name cannot
		// manufacture one.
		if acr := issInitials(toks); len(acr) >= 3 {
			ix.brands = append(ix.brands, acr)
		}
		// EDGAR stores a founder's name INVERTED -- `RUSSELL FRANK INVESTMENT
		// CO` for the printed `Frank Russell Investment Company` -- so the
		// acronym the filing prints (`FRIC ...`) is built on the swapped
		// leading pair and never on the conformed order.
		if len(toks) > 2 {
			swapped := append([]string{toks[1], toks[0]}, toks[2:]...)
			if acr := issInitials(swapped); len(acr) >= 3 {
				ix.brands = append(ix.brands, acr)
			}
		}
		// And the initials of the registrant's TRAILING tokens: Rydex Variable
		// Trust prints "VT BANKING FUND". Two letters at least, and only the
		// runs that leave a leading token out.
		for k := 1; k <= len(toks)-2; k++ {
			ix.brands = append(ix.brands, issInitials(toks[k:]))
		}
		// And the trailing tokens themselves, two at least: Rydex Variable
		// Trust heads "Variable Trust Russell 2000(R) 1.5x Strategy Fund" for
		// a declared "Russell 2000(R) 1.5x Strategy Fund" (688k rows with no
		// series on 2026-09-02). A lone trailing "Trust" or "Fund" is too
		// common a word to be a brand.
		for k := 1; k <= len(toks)-2; k++ {
			ix.brands = append(ix.brands, strings.Join(toks[k:], " "))
		}
		// And of its LEADING tokens: Variable Insurance Products Fund II
		// prints "VIP CONTRAFUND PORTFOLIO". Three letters at least -- except
		// the first two tokens of a registrant with three or more, cut only
		// on a whole-token boundary: Goldman Sachs Trust prints "GS
		// STRUCTURED INTERNATIONAL SMALL CAP" (327k rows with no series).
		for k := len(toks) - 1; k >= 3; k-- {
			ix.brands = append(ix.brands, issInitials(toks[:k]))
		}
		if len(toks) >= 3 {
			if acr := issInitials(toks[:2]); len(acr) >= 2 {
				ix.brands = append(ix.brands, acr)
			}
		}
		// And any single token of the registrant's own name of six letters
		// or more that is not a generic word: Mutual of America
		// Institutional Funds heads "Institutional All America Fund" for a
		// declared "All America Fund" (298k rows with no series). A cut is
		// only ever followed by an exact lookup, so the token must sit at the
		// front of a heading whose remainder is a declared name.
		for _, t := range toks {
			// Five letters up: Janus Aspen Series heads "ASPEN WORLDWIDE
			// GROWTH PORTFOLIO" for a declared "Worldwide Growth Portfolio".
			if len(t) >= 5 && !issGenericRegistrantWord[t] {
				ix.brands = append(ix.brands, t)
			}
		}
	}
	// Enterprise's historical EGF and AXA Enterprise brands share exact stems.
	if registrantKey == "enterprise group of funds inc" {
		ix.brands = append(ix.brands, "axa enterprise", "egf")
	}
	put := func(m map[string]*SeriesDecl, key string, d *SeriesDecl) {
		if key == "" {
			return
		}
		prev, seen := m[key]
		switch {
		case !seen:
			m[key] = d
		case prev != nil && prev.SeriesID != d.SeriesID:
			m[key] = nil
		}
	}
	for i := range decls {
		d := &decls[i]
		if k := normalizeSeriesName(d.Name); strings.Contains(k, " and ") {
			put(ix.lessAnd, strings.ReplaceAll(k, " and ", " "), d)
		}
		for _, b := range ix.brands {
			k := normalizeSeriesName(d.Name)
			if rest, ok := issCutBrand(k, b); ok {
				put(ix.lessBrandFull, rest, d)
				put(ix.lessLeadCompact, strings.ReplaceAll(rest, " ", ""), d)
				if r2, ok := issDropTypeWord(rest); ok {
					put(ix.lessBrandType, r2, d)
					put(ix.lessBrandTypeCompact, strings.ReplaceAll(r2, " ", ""), d)
				}
				// A declared name can carry BOTH a leading registrant token and
				// the registrant's trailing-initials brand: Wilshire Variable
				// Insurance Trust declares `WILSHIRE VIT EQUITY FUND` and prints
				// `Equity Fund`. One cut at the front leaves `vit equity fund`,
				// so re-cut the residue against the same brand list until it
				// stops shrinking.
				for pass := 0; pass < issBrandRecutPasses; pass++ {
					next, ok := issCutAnyBrand(rest, ix.brands)
					if !ok || !issSeedableBrandCut(next) {
						break
					}
					rest = next
					put(ix.lessBrandFull, rest, d)
					put(ix.lessLeadCompact, strings.ReplaceAll(rest, " ", ""), d)
					if r2, ok := issDropTypeWord(rest); ok && issSeedableBrandCut(r2) {
						put(ix.lessBrandType, r2, d)
						put(ix.lessBrandTypeCompact, strings.ReplaceAll(r2, " ", ""), d)
					}
				}
			}
		}
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		// The declared name printed with the registrant's own leading words and
		// its corporate suffix taken off, which is how the banner spells it.
		if regToks := issRegistrantTokens(registrantKey); len(regToks) > 0 {
			dt := strings.Fields(normalizeSeriesName(d.Name))
			if n := len(dt); n > 0 && issCorporateSuffixWord[dt[n-1]] {
				dt = dt[:n-1]
			}
			for k := 1; k < len(dt); k++ {
				if !regToks[dt[k-1]] {
					break
				}
				if len(dt)-k >= 3 {
					put(ix.lessRegistrantLead, strings.Join(dt[k:], " "), d)
				}
			}
		}
		key := normalizeSeriesName(d.Name)
		if rest, ok := issDropDeclaredIncSuffix(key); ok {
			put(ix.lessCorpSuffix, rest, d)
		}
		put(ix.byHistoricalBrand, issHistoricalBrandKey(key), d)
		put(ix.byCompact, strings.ReplaceAll(key, " ", ""), d)
		// The marketing abbreviation of `capitalization`: Target Portfolio
		// Trust heads `Target Large Cap Value Portfolio` for a declared `LARGE
		// CAPITALIZATION VALUE` (S000004688, 2,292 rows). One declared-name
		// key more, refused on collision like every other.
		if toks := strings.Fields(key); len(toks) > 1 {
			short := make([]string, len(toks))
			cut := false
			for j, t := range toks {
				if t == "capitalization" {
					short[j], cut = "cap", true
					continue
				}
				short[j] = t
			}
			if cut {
				put(ix.byName, strings.Join(short, " "), d)
			}
		}
		// One leading token off the DECLARED name; the remainder must still be
		// two tokens at least, so a two-word name never collapses to one word.
		if toks := strings.Fields(key); len(toks) >= 3 {
			rest := strings.Join(toks[1:], " ")
			put(ix.lessLeadToken, rest, d)
			put(ix.lessLeadCompact, strings.ReplaceAll(rest, " ", ""), d)
			if bare, typed := issDropTypeWord(rest); typed {
				put(ix.lessLeadTokenAnyType, bare, d)
			}
		}
		for _, b := range ix.brands {
			if rest, ok := strings.CutPrefix(key, b+" "); ok {
				put(ix.lessBrand, rest, d)
			}
		}
		// The registrant's WHOLE name, which brands (its leading runs) never
		// supply: `RSI Retirement Trust - Core Equity Fund` (S000001852) under
		// `core equity fund` for a heading that abbreviates the trust to `RSI`.
		if rest, ok := strings.CutPrefix(key, registrantKey+" "); ok && rest != "" {
			put(ix.lessBrand, rest, d)
		}
		// A declared name typed anything BUT `fund`, keyed by its stem: the
		// heading may print the generic marketing word in its place. Only that
		// one direction, so `... EQUITY TRUST` for a declared `... Equity
		// Fund` stays a different registered series and refuses.
		if stem, ok := issDropTypeWord(key); ok && !strings.HasSuffix(key, " fund") {
			put(ix.lessAnyType, stem, d)
		}
		if rest, ok := issDropTrailingConjunct(key); ok {
			put(ix.lessConjunct, rest, d)
			// A heading that prints the bare stem with no type word at all
			// (`MID CAP VALUE` for `Mid Cap Value and Restructuring Fund`,
			// S000004600) never reaches the typed reading above.
			if bare, ok := issDropTypeWord(rest); ok {
				put(ix.lessConjunct, bare, d)
			}
		}
		if cut, ok := issCutTrailingParenthetical(d.Name); ok {
			put(ix.lessParen, normalizeSeriesName(cut), d)
			if issClassMarker(d.Name) {
				k := normalizeSeriesName(cut)
				ix.classPairs[k] = append(ix.classPairs[k], d)
			}
		}
	}
	if tw := issRegistrantTypeWord(registrantKey, decls); tw != "" {
		ix.lessTypeWord = make(map[string]*SeriesDecl)
		for i := range decls {
			d := &decls[i]
			if d.SeriesID == "" || d.Name == "" {
				continue
			}
			toks := strings.Fields(normalizeSeriesName(d.Name))
			for j, t := range toks {
				if t != tw {
					continue
				}
				rest := append(append([]string{}, toks[:j]...), toks[j+1:]...)
				if len(rest) > 0 {
					put(ix.lessTypeWord, strings.Join(rest, " "), d)
				}
				break
			}
		}
	}
	if suffix := issCommonLastWord(decls); suffix != "" {
		ix.commonSuffix = suffix
		ix.lessSuffix = make(map[string]*SeriesDecl)
		// Every stem the drop below would claim, so the sibling scan next can
		// tell a contested stem from a free one.
		claimed := map[string]bool{}
		for i := range decls {
			d := &decls[i]
			if d.SeriesID == "" || d.Name == "" {
				continue
			}
			if rest, ok := strings.CutSuffix(normalizeSeriesName(d.Name), " "+suffix); ok && rest != "" {
				claimed[rest] = true
			}
		}
		// A declared name that reduces to a claimed stem under its OWN trailing
		// type word: `Avantis International Equity Fund` (S000066463) beside
		// `Avantis International Equity ETF` (S000066456), American Century ETF
		// Trust 2022, where 32 of the 41 declared names end in `ETF` and the
		// drop below would hand the ETF a bare `Avantis International Equity`
		// banner that is the Fund's section. The suffix is dominant, not
		// universal, so the stem is not the common-suffix name's to take; the
		// registrant spells the common-suffix name in full where it prints it
		// (that filing's own `... ETF` banner resolves exactly, beside this
		// one), and the bare stem is the sibling's. Two siblings sharing a stem
		// collide in put and refuse rather than guess.
		ix.lessSuffixSibling = make(map[string]*SeriesDecl)
		for i := range decls {
			d := &decls[i]
			if d.SeriesID == "" || d.Name == "" {
				continue
			}
			toks := strings.Fields(normalizeSeriesName(d.Name))
			if len(toks) < 2 || toks[len(toks)-1] == suffix || !issTypeWord(toks[len(toks)-1]) {
				continue
			}
			if stem := strings.Join(toks[:len(toks)-1], " "); claimed[stem] {
				put(ix.lessSuffixSibling, stem, d)
			}
		}
		for i := range decls {
			d := &decls[i]
			if d.SeriesID == "" || d.Name == "" {
				continue
			}
			key := normalizeSeriesName(d.Name)
			if rest, ok := strings.CutSuffix(key, " "+suffix); ok && rest != "" {
				if _, contested := ix.lessSuffixSibling[rest]; contested {
					continue
				}
				put(ix.lessSuffix, rest, d)
			}
		}
	}
	return ix
}

// issRegistrantTypeWord returns the registrant's last token when at least two
// thirds of the declared names (two at least) carry it as a whole token, and
// "" otherwise. Corporate suffixes are skipped so "... FUNDS INC" yields
// "funds".
func issRegistrantTypeWord(registrantKey string, decls []SeriesDecl) string {
	toks := strings.Fields(registrantKey)
	for len(toks) > 0 {
		switch toks[len(toks)-1] {
		case "inc", "corp", "llc", "ltd", "co", "the":
			toks = toks[:len(toks)-1]
			continue
		}
		break
	}
	if len(toks) < 2 {
		return ""
	}
	tw := toks[len(toks)-1]
	if len(tw) < 4 {
		return ""
	}
	n, with := 0, 0
	for _, d := range decls {
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		n++
		for _, t := range strings.Fields(normalizeSeriesName(d.Name)) {
			if t == tw {
				with++
				break
			}
		}
	}
	if n < 2 || with*3 < n*2 {
		return ""
	}
	return tw
}

// issCommonLastWord returns the last word the declared names share -- all of
// them, or a dominant two thirds when a few target-date or otherwise-named
// series sit beside the convention (Advanced Series Trust 2012: 59 of 68 end
// in Portfolio). Two names at least; "" otherwise. Safe under exact-first: a
// series declared WITHOUT the word is found by the exact reading before this
// index is consulted.
func issCommonLastWord(decls []SeriesDecl) string {
	count := map[string]int{}
	n := 0
	for _, d := range decls {
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		toks := strings.Fields(normalizeSeriesName(d.Name))
		n++
		if len(toks) >= 2 {
			count[toks[len(toks)-1]]++
		}
	}
	if n < 2 {
		return ""
	}
	best, bestN := "", 0
	for w, c := range count {
		if c > bestN || (c == bestN && w < best) {
			best, bestN = w, c
		}
	}
	if bestN*3 < n*2 {
		return ""
	}
	return best
}

// issRegistrantTokens is the set of tokens the registrant's own conformed name
// carries, for the leading run a declared name may print in front of the fund.
func issRegistrantTokens(registrantKey string) map[string]bool {
	toks := strings.Fields(registrantKey)
	if len(toks) == 0 {
		return nil
	}
	set := make(map[string]bool, len(toks))
	for _, t := range toks {
		set[t] = true
	}
	return set
}

// issRegistrantWordTruncation reports whether tok is one of the registrant's own
// NAMING words truncated: a proper prefix of at least three characters, of a word
// that is not a generic entity noun. The vendor prints `SCUD DREMAN HIGH RET
// EQUITY` for SCUDDER VALUE SERIES INC on one banner of a filing that spells
// `SCUDDER` in full on its other two, so the truncation is the registrant's word
// and nothing about the fund. Generic nouns are excluded so `fun` never stands
// for `fund`.
func issRegistrantWordTruncation(tok, registrantKey string) bool {
	if len(tok) < 3 {
		return false
	}
	for _, t := range strings.Fields(registrantKey) {
		if len(tok) < len(t) && strings.HasPrefix(t, tok) && !issEntityTypeWord(t) {
			return true
		}
	}
	return false
}

// issCorporateSuffixWord lists the trailing corporate form a declared name
// carries and a printed banner drops.
var issCorporateSuffixWord = map[string]bool{
	"inc": true, "incorporated": true, "corp": true, "corporation": true,
	"co": true, "company": true, "ltd": true, "llc": true, "lp": true, "plc": true,
}

// issDropDeclaredIncSuffix removes a trailing incorporation word from an
// already-normalised DECLARED name (`the japan fund inc` -> `the japan fund`),
// leaving two tokens at least so no name collapses to a single word. Only the
// `Inc` spellings, which is the form a heading omits; the caller must still
// require an exact, unambiguous hit on the remainder.
func issDropDeclaredIncSuffix(key string) (rest string, ok bool) {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return "", false
	}
	switch toks[len(toks)-1] {
	case "inc", "incorporated":
	default:
		return "", false
	}
	return strings.Join(toks[:len(toks)-1], " "), true
}

// issInitials builds the acronym a registrant makes of its own name: the first
// letter of each token, except that a Roman numeral token is kept whole
// ("John Hancock Funds II" -> "jhfii"). Tokens are already normalised.
func issInitials(toks []string) string {
	var b strings.Builder
	for i, t := range toks {
		// A leading two-letter token is already an abbreviation and is kept
		// whole: GE Investment Funds heads its banners `GEI ...`.
		if issRomanNumeral(t) || i == 0 && len(t) == 2 {
			b.WriteString(t)
			continue
		}
		b.WriteByte(t[0])
	}
	return b.String()
}

// issRomanNumeral reports a short lower-case Roman numeral token: i, ii, iii,
// iv, v, vi, vii, viii, ix, x.
func issRomanNumeral(t string) bool {
	switch t {
	case "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x":
		return true
	}
	return false
}

// issCutTrailingParenthetical removes a parenthetical at the END of a fund
// name: a sleeve (`... Portfolio (Core Plus)`) or a former name (`Victory 500
// Index Fund (Formerly USAA 500 Index Fund)`). Only a trailing one, and only
// as a lookup key; two declared names that differ inside the parentheses
// collide in the index and stamp nothing.
func issCutTrailingParenthetical(name string) (string, bool) {
	s := strings.TrimSpace(name)
	if !strings.HasSuffix(s, ")") {
		return "", false
	}
	i := strings.LastIndex(s, "(")
	if i <= 0 {
		return "", false
	}
	head := strings.TrimSpace(s[:i])
	if head == "" {
		return "", false
	}
	return head, true
}

// issAKAParenthetical returns the name inside a trailing parenthetical the
// filing OPENS with an alias marker: `THE REAL ESTATE INVESTMENT TRUST
// PORTFOLIO (a/k/a DELAWARE REIT FUND)` (Delaware Pooled Trust 2004, the second
// ruled line of a two-line banner). The marker is what makes this a second
// spelling of the same fund rather than a sleeve qualifier, and the head of such
// a banner is often the registrant's OTHER sleeve with its ordinal off.
func issAKAParenthetical(name string) (string, bool) {
	s := strings.TrimSpace(name)
	if !strings.HasSuffix(s, ")") {
		return "", false
	}
	i := strings.LastIndex(s, "(")
	if i < 0 {
		return "", false
	}
	inner := strings.TrimSpace(s[i+1 : len(s)-1])
	for _, marker := range []string{"a/k/a", "aka", "also known as"} {
		if len(inner) <= len(marker) || !strings.EqualFold(inner[:len(marker)], marker) {
			continue
		}
		rest := inner[len(marker):]
		// The marker is a whole token, not a prefix of a longer word: a letter
		// or a digit right after it means this is `AKAMAI ...`, not an alias.
		// What separates the marker from the name is whatever punctuation the
		// filing prints -- a plain space in the 2004 banners, `a/k/a,` (comma
		// before the space) in the 2014-era ones, sometimes a trailing slash.
		var first rune
		for _, r := range rest {
			first = r
			break
		}
		if unicode.IsLetter(first) || unicode.IsDigit(first) {
			continue
		}
		if rest := strings.TrimSpace(strings.TrimLeft(rest, " \t ,.:;/-")); rest != "" {
			return rest, true
		}
	}
	return "", false
}

// issCutMedialParenthetical removes a parenthetical that sits between the fund
// name and the tokens after it, joining the two halves.
func issCutMedialParenthetical(name string) (string, bool) {
	s := strings.TrimSpace(name)
	i := strings.IndexByte(s, '(')
	if i <= 0 {
		return "", false
	}
	j := strings.IndexByte(s[i:], ')')
	if j < 0 {
		return "", false
	}
	j += i
	head, tail := strings.TrimSpace(s[:i]), strings.TrimSpace(s[j+1:])
	if head == "" || tail == "" {
		return "", false
	}
	return head + " " + tail, true
}

// issParenGroupCuts returns the banner with ONE balanced `(...)` group removed,
// once per group it carries, leftmost first. A group that opens and never
// closes is not a group, and a cut that leaves nothing on either side of the
// removed group is not returned: the remainder has to be a name the chain can
// read, not a fragment.
func issParenGroupCuts(banner string) []string {
	s := strings.TrimSpace(banner)
	if !strings.ContainsAny(s, "()") {
		return nil
	}
	var cuts []string
	depth, open := 0, -1
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '(':
			if depth == 0 {
				open = i
			}
			depth++
		case ')':
			if depth == 0 {
				continue
			}
			depth--
			if depth > 0 || open <= 0 {
				continue
			}
			head, tail := strings.TrimSpace(s[:open]), strings.TrimSpace(s[i+1:])
			if head == "" {
				continue
			}
			if tail == "" {
				cuts = append(cuts, head)
				continue
			}
			cuts = append(cuts, head+" "+tail)
		}
	}
	return cuts
}

// issClassMarker reports a declared name whose trailing parenthetical is a share
// class marker rather than a sleeve or a former name: one to three letters or
// digits, or the word CLASS followed by one (`(A)`, `(I)`, `(R6)`, `(CLASS A)`).
func issClassMarker(name string) bool {
	s := strings.TrimSpace(name)
	i := strings.LastIndex(s, "(")
	if i < 0 || !strings.HasSuffix(s, ")") {
		return false
	}
	inner := strings.ToUpper(strings.TrimSpace(s[i+1 : len(s)-1]))
	inner = strings.TrimSpace(strings.TrimPrefix(inner, "CLASS "))
	if len(inner) == 0 || len(inner) > 3 {
		return false
	}
	for j := 0; j < len(inner); j++ {
		c := inner[j]
		if !((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}

// issClassPairDecl returns one synthetic declaration carrying every series that
// is the banner's fund under a class marker, or nil when the collision behind
// key is not made only of such series (then it is a refusal, as before).
func issClassPairDecl(ix *issSeriesIndex, key, banner string) *SeriesDecl {
	pairs := ix.classPairs[key]
	if len(pairs) < 2 {
		return nil
	}
	// Every declared name that reduces to key must be class-marked; a sleeve
	// among them means the banner is ambiguous after all.
	n := 0
	for i := range ix.decls {
		d := &ix.decls[i]
		if cut, ok := issCutTrailingParenthetical(d.Name); ok && normalizeSeriesName(cut) == key {
			n++
		}
	}
	if n != len(pairs) {
		return nil
	}
	ids := make([]string, 0, len(pairs))
	for _, d := range pairs {
		ids = append(ids, d.SeriesID)
	}
	sort.Strings(ids)
	return &SeriesDecl{SeriesID: strings.Join(ids, MultiValueSep), Name: banner}
}

// issCutSubAdviser removes the labelled sub-adviser clause one registrant
// appends to every fund heading -- `AST Goldman Sachs Multi Asset Portfolio -
// Sub-Adviser: Goldman Sachs` for a series declared without it. The label is
// what makes this a deletion rather than a tolerance: only text after the
// literal `Sub-Adviser:` (or `Subadviser:`) is dropped, with the dash before
// it. ~1.5M rows across five Advanced Series Trust filings, 2026-09-02.
//
// The same registrant's 2006 reports print the label UNHYPHENATED, after a
// dash: `AST DEAM SMALL-CAP GROWTH PORTFOLIO - ADVISOR: DEUTSCHE ASSET
// MANAGEMENT` (Strategic Partners Mutual Funds 2006, 34,701 rows with no
// series). The bare label is admitted only behind that dash, so an `Investment
// Advisor:` printed mid-name is not a cut point.
func issCutSubAdviser(banner string) (string, bool) {
	low := strings.ToLower(banner)
	for _, label := range []string{"sub-adviser:", "subadviser:", "sub adviser:", "sub-advisor:", "subadvisor:", "- adviser:", "- advisor:"} {
		i := strings.Index(low, label)
		if i <= 0 {
			continue
		}
		head := strings.TrimSpace(banner[:i])
		head = strings.TrimRight(head, "-\u2013\u2014 ")
		if head == "" {
			return "", false
		}
		return head, true
	}
	// The PARTICIPIAL spelling, which carries no colon: `PVC - Balanced Account
	// - Sub-Advised by PGI` (Principal Variable Contracts Fund 2005). The
	// lead-in stands in for the label, and the dash before it is what bounds
	// the name, so the clause is cut only where a dash precedes it and a
	// manager follows -- `Sub-Advised by` printed mid-name is not a cut point.
	for _, lead := range []string{"sub-advised by ", "sub advised by ", "subadvised by "} {
		i := strings.Index(low, lead)
		if i <= 0 {
			continue
		}
		head := strings.TrimRight(banner[:i], " \t")
		if !strings.HasSuffix(head, "-") && !strings.HasSuffix(head, "–") && !strings.HasSuffix(head, "—") {
			continue
		}
		head = strings.TrimRight(head, "-–— \t")
		if head == "" {
			return "", false
		}
		return head, true
	}
	return "", false
}

// issAdvisorSuffixDecl answers a banner whose sub-adviser suffix is cut off by
// issCutSubAdviser and whose REMAINDER is an exact name -- the filing's own
// declaration, or one series of the corpus under another CIK. Strategic
// Partners Mutual Funds 2006 files American Skandia Trust's own document
// (`astnpx2006final.txt`, file number 811-05186) and heads every section
// `AST <fund> PORTFOLIO - ADVISOR: <manager>`: cut the suffix and the heading
// is the verbatim declared name of an AST series at this filing's own vintage,
// while the uncut heading reaches a Strategic Partners retail fund by tail
// similarity (34,701 rows blank and six sections wrongly stamped, 2026-09-20).
//
// Exact only, on both routes: crossCIK keys a name that two series or two
// registrants answer to onto nil, so the same fund printed under several
// advisers in one filing never collapses two different funds.
func issAdvisorSuffixDecl(ix *issSeriesIndex, banner string) *SeriesDecl {
	if ix == nil {
		return nil
	}
	cut, ok := issCutSubAdviser(banner)
	if !ok || cut == "" || normalizeSeriesName(cut) == normalizeSeriesName(banner) {
		return nil
	}
	if d, _ := lookupSeriesEntry(ix.byName, cut); d != nil {
		return d
	}
	return issIndexDict(ix).crossCIK(ix.cik, cut, ix.period, ix.registrantKey)
}

// issCutGluedBrand removes a sub-adviser brand the filing GLUES to the house
// token with a hyphen and no label -- `PHOENIX-DUFF & PHELPS REAL ESTATE
// SECURITIES FUND`, `PHOENIX-ABERDEEN INTERNATIONAL`. Only the registrant's own
// leading token may carry the glue, and only the words between it and the fund
// stem are dropped, one candidate width at a time, longest brand first.
//
// A candidate that resolves through the ordinary chain is stamped. A candidate
// that does not may still be the declared name printed SHORT of its own tail
// (`PHOENIX INTERNATIONAL` for `PHOENIX INTERNATIONAL STRATEGIES FUND`), and
// that is admitted only when it is the leading token-prefix of exactly one
// declared name: a prefix two names share still refuses.
func issCutGluedBrand(ix *issSeriesIndex, banner, registrantKey string) *SeriesDecl {
	// The hyphen is read off the PRINTED banner: normalizeSeriesName folds
	// punctuation to spaces, and the glue is exactly the punctuation.
	rawHead, rawTail, ok := strings.Cut(banner, "-")
	if !ok {
		return nil
	}
	head := normalizeSeriesName(rawHead)
	if head == "" || strings.ContainsAny(head, " \t") {
		return nil
	}
	reg := strings.Fields(registrantKey)
	if len(reg) == 0 || strings.Trim(reg[0], ".,") != head {
		return nil
	}
	toks := strings.Fields(normalizeSeriesName(rawTail))
	printed := map[string]bool{head: true}
	for _, t := range toks {
		printed[t] = true
	}
	// LONGEST remainder first: the candidate that keeps the most of the printed
	// heading is the most evidence, and trying the shortest first hands the
	// answer to whichever sibling sleeve the stem's discriminating words would
	// have separated (`PHOENIX-SENECA MID-CAP GROWTH SERIES` took the declared
	// `PHOENIX GROWTH AND INCOME` through `phoenix growth series` while
	// `phoenix mid cap growth series` names S000001959 exactly).
	for k := 1; k < len(toks); k++ {
		cand := head + " " + strings.Join(toks[k:], " ")
		if _, d := issResolveFund(ix, cand); d != nil && !issDeclAddsUnprintedToken(printed, d) {
			return d
		}
		if d := issUniqueNamePrefix(ix, cand); d != nil {
			return d
		}
	}
	return nil
}

// issDeclAddsUnprintedToken refuses a brand cut whose answer spells a word the
// heading never prints. Only the brand between the house token and the fund
// stem may be dropped; a candidate that also dropped one of the stem's own
// discriminating words resolves onto a SIBLING sleeve, and the declared name
// says so -- `phoenix growth series`, cut out of `PHOENIX-JANUS GROWTH SERIES`,
// answers the declared `PHOENIX GROWTH AND INCOME SERIES`, whose `INCOME` this
// filing's heading does not print. The prefix rung below is untouched: a
// declared name printed SHORT of its own tail is exactly what it reads.
func issDeclAddsUnprintedToken(printed map[string]bool, d *SeriesDecl) bool {
	for _, t := range strings.Fields(normalizeSeriesName(d.Name)) {
		if !printed[t] {
			return true
		}
	}
	return false
}

// issVowelDropped reports the vendor's vowel-dropping abbreviation of one word:
// the same first letter and the rest a subsequence of it (`glbl` of `global`,
// `rl` of `real`). Shorter than issAbbreviates admits, because this form only
// ever fires beside two tokens spelled out in full.
func issVowelDropped(short, long string) bool {
	if len(short) < 2 || len(short) >= len(long) || short[0] != long[0] {
		return false
	}
	k := 0
	for i := 0; i < len(long) && k < len(short); i++ {
		if long[i] == short[k] {
			k++
		}
	}
	return k == len(short)
}

// issUniqueNamePrefix finds the one declared name whose leading tokens are
// exactly key's, refusing when two names share the prefix.
func issUniqueNamePrefix(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(normalizeSeriesName(key))
	if len(toks) < 2 {
		return nil
	}
	var hit *SeriesDecl
	for name, d := range ix.byName {
		if d == nil {
			continue
		}
		dt := strings.Fields(name)
		if len(dt) <= len(toks) {
			continue
		}
		same := true
		for j, t := range toks {
			if dt[j] != t {
				same = false
				break
			}
		}
		if !same {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// issVowelDroppedAbbrev reads a vendor's per-word abbreviation of a declared
// name -- `GLBL RL ESTATE ETF` for `Cambria Global Real Estate ETF` (Cambria ETF
// Trust 2021, 384 rows with no series), where the same account prints the
// readable spelling on other rows of the same table.
//
// Every printed token must be the declared token itself or an abbreviation of
// it, in order, and the declared name may carry extra LEADING tokens only (the
// house brand the abbreviation drops). One hit stamps; two refuse.
func issVowelDroppedAbbrev(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(normalizeSeriesName(key))
	if len(toks) < 3 {
		return nil
	}
	var hit *SeriesDecl
	for name, d := range ix.byName {
		if d == nil {
			continue
		}
		dt := strings.Fields(name)
		if len(dt) < len(toks) || len(dt) > len(toks)+2 {
			continue
		}
		dt = dt[len(dt)-len(toks):]
		short, exact := 0, 0
		fit := true
		for j, t := range toks {
			if t == dt[j] {
				exact++
				continue
			}
			if !issVowelDropped(t, dt[j]) {
				fit = false
				break
			}
			short++
		}
		// Two tokens spelled out in full are what keeps a two-letter
		// abbreviation from reading as a fund it merely shares a letter with.
		if !fit || short == 0 || exact < 2 {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// issContractedWordPairDecl reads the vendor's CONTRACTION of two adjacent
// declared words -- the first collapsed to its initial and glued straight onto
// the second, kept whole: `WESTWOOD MMITES FD` for the declared `Westwood Mighty
// Mites Fund` (S000001084, CIK 796229's 20070630 ProxyEdge report, whose only
// account banner is `Selected Accounts: NPX GABELLI WESTWOOD MMITES FD`; 397
// rows with no series). The per-word rungs above are word-to-word, so `mmites`
// abbreviates neither `mighty` nor `mites` and none of them sees it.
//
// Narrow by construction: exactly ONE printed token may be the contraction, the
// two declared words it spells must be ADJACENT, its tail must equal the second
// of them exactly and its first letter the first's initial, and once expanded
// the declared name must be the TAIL of the printed tokens -- so only a house
// brand printed ahead of the name (`GABELLI` here) is tolerated, never a printed
// word the declaration does not carry. Two series answering refuse.
func issContractedWordPairDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(normalizeSeriesName(key))
	if len(toks) < 2 {
		return nil
	}
	var hit *SeriesDecl
	for name, d := range ix.byName {
		if d == nil {
			continue
		}
		dt := strings.Fields(name)
		// Two contracted words plus the type word: shorter than that and the
		// contraction would be the whole name.
		if len(dt) < 3 || len(dt) > len(toks)+1 || len(toks) > len(dt)+1 {
			continue
		}
		for i := 0; i+1 < len(dt); i++ {
			first, second := dt[i], dt[i+1]
			if len(first) < 2 || len(second) < 2 {
				continue
			}
			glued := first[:1] + second
			for j, t := range toks {
				if t != glued {
					continue
				}
				exp := append(append(append([]string{}, toks[:j]...), first, second), toks[j+1:]...)
				if len(exp) < len(dt) || len(exp) > len(dt)+2 || !issTokensEqual(exp[len(exp)-len(dt):], dt) {
					continue
				}
				if hit != nil && hit.SeriesID != d.SeriesID {
					return nil
				}
				hit = d
			}
		}
	}
	return hit
}

// issTokensEqual reports that two token runs are the same words in order.
func issTokensEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// issDeclaredAbbrevWord finds the one declared name that differs from key in
// exactly one token, where the declared token is an abbreviation of the printed
// one. It mirrors htmlDictAbbrevWord in the other direction and refuses on any
// collision; nil means stamp nothing.
func issDeclaredAbbrevWord(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	var hit *SeriesDecl
	for name, d := range ix.byName {
		if d == nil {
			continue
		}
		dt := strings.Fields(name)
		if len(dt) != len(toks) {
			continue
		}
		diff := 0
		for j := range toks {
			if toks[j] == dt[j] {
				continue
			}
			diff++
			if diff > 1 || !issAbbreviates(dt[j], toks[j]) {
				diff = 2
				break
			}
		}
		if diff != 1 {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// issCutRegistrantPrefix deletes the filing's own already-normalised registrant
// name off the front of an already-normalised heading, on a whole-token
// boundary, exactly as lookupSeriesStrippingRegistrant does before its lookup.
func issCutRegistrantPrefix(key, prefix string) (string, bool) {
	if prefix == "" {
		return "", false
	}
	rest, ok := strings.CutPrefix(key, prefix)
	if !ok {
		return "", false
	}
	rest, ok = strings.CutPrefix(rest, " ")
	if !ok || rest == "" {
		return "", false
	}
	return rest, true
}

// issHistoricalBrandStem returns the stem a brand key carries -- the part after
// the successor-brand tag issHistoricalBrandKey prefixes it with -- so a caller
// can re-read the heading with the brand off. Empty when the key carries none.
func issHistoricalBrandStem(brandKey string) string {
	if i := strings.IndexByte(brandKey, ':'); i >= 0 {
		return brandKey[i+1:]
	}
	return ""
}

// Audited successor brands only; the full distinctive stem must still agree.
func issHistoricalBrandKey(key string) string {
	for _, brand := range []string{"wells fargo advantage", "wells fargo", "allspring"} {
		if stem, ok := strings.CutPrefix(key, brand+" "); ok && stem != "" {
			return "wells fargo:" + stem
		}
	}
	// Goldman's quantitative sleeves are headed with the CORE brand of the
	// reporting period and declared under the successor Structured name:
	// `GS CORE International Equity Fund` for `Goldman Sachs Structured
	// International Equity Fund` (S000009330). The stem must still agree whole.
	for _, brand := range []string{"gs core ", "goldman sachs core ", "goldman sachs structured "} {
		if stem, ok := strings.CutPrefix(key, brand); ok && stem != "" {
			return "goldman structured:" + stem
		}
	}
	// Citigroup's Smith Barney funds are declared under their successor Legg
	// Mason Partners brand: `SMITH BARNEY EMERGING MARKETS EQUITY FUND` for
	// `Legg Mason Partners Emerging Markets Equity Fund` (S000009469). The
	// stem after the brand must still agree whole.
	for _, brand := range []string{"smith barney ", "legg mason partners "} {
		if stem, ok := strings.CutPrefix(key, brand); ok && stem != "" {
			return "legg mason partners:" + stem
		}
	}
	// The variable-insurance sleeves print the contemporaneous `AIM V.I.`
	// prefix where the dictionary carries only the successor `INVESCO VIF -`
	// spelling: `AIM V.I. Total Return Fund` for `INVESCO VIF - Total Return
	// Fund` (S000000197, AIM Variable Insurance Funds 2005, 707 rows with no
	// series). Kept ahead of the bare AIM/INVESCO brands below so the sleeve
	// token is cut with the brand rather than left in the stem, and the stem
	// after it must still agree whole.
	for _, brand := range []string{"aim v i ", "invesco vif ", "invesco v i "} {
		if stem, ok := strings.CutPrefix(key, brand); ok && stem != "" {
			return "invesco vi:" + stem
		}
	}
	// AIM's 2004 filings head their sections with the predecessor INVESCO
	// brand and declare the same funds under the successor AIM name:
	// `INVESCO Dynamics Fund` for `AIM Dynamics Fund` (S000000163). The stem
	// after the brand must still agree whole.
	for _, brand := range []string{"invesco ", "aim "} {
		if stem, ok := strings.CutPrefix(key, brand); ok && stem != "" {
			return "invesco aim:" + stem
		}
	}
	// Deutsche's 2004-2005 filings head their sections with the
	// contemporaneous `Scudder` brand and declare the same funds under the
	// successor `DWS`/`Deutsche` spelling: `Scudder Large Co Growth` for
	// `DWS Large Company Growth Fund` (S000005707, Investment Trust 2004,
	// 974 rows with no series). The stem after the brand must still agree
	// whole.
	for _, brand := range []string{"scudder ", "dws ", "deutsche "} {
		if stem, ok := strings.CutPrefix(key, brand); ok && stem != "" {
			return "scudder dws:" + stem
		}
	}
	// TDAX account sleeves and the TDX/db-X registered names retain the
	// target year or exact In Target stem.
	if key == "db x in target date fund" {
		return "tdx independence:in target"
	}
	for _, form := range []struct{ prefix, suffix string }{
		{"tdax independence ", " equity"},
		{"tdx independence ", " exchange traded fund"},
		{"db x ", " target date fund"},
	} {
		if rest, ok := strings.CutPrefix(key, form.prefix); ok {
			if stem, ok := strings.CutSuffix(rest, form.suffix); ok && (stem == "in target" || len(stem) == 4 && isAllDigits(stem)) {
				return "tdx independence:" + stem
			}
		}
	}
	return ""
}

var (
	reISSTerminalFormerly = regexp.MustCompile(`(?i)\s+\*?\s*FORMERLY\s*:?\s*$`)
	reISSStarredFormerly  = regexp.MustCompile(`(?i)\s+\*{1,3}\s*FORMERLY\s+[^*\r\n]{1,80}\*{1,3}\s*$`)
	reISSNPFAccount       = regexp.MustCompile(`(?i)^NPF-(.+)\s+A/C\s+JND[0-9]+$`)
)

// issResolveFund turns one banner, already reassembled across any lines it
// wrapped onto, into the fund name to store and the series it names. A nil decl
// means stamp nothing, which is the answer whenever the filing's own header does
// not spell this name for exactly one series.
//
// Three readings of the banner are tried, in this order, and each demands the
// same exact normalised equality:
//
//  1. the banner as printed;
//  2. the banner with a leading single-letter index token dropped, when it
//     carries one -- BOTH forms are tried, and two forms resolving to DIFFERENT
//     series stamp nothing, because the filing has then given two answers and
//     picking one would be a guess. The alternative is read only when the banner
//     AS PRINTED names no declared series at all: a printed name two series
//     answer to is a refusal, and dropping its first letter is a typographic
//     repair, not evidence about which of the two the filing meant;
//  3. the banner with its own registrant's name deleted off the front, only when
//     nothing above resolved and only when the strip is enabled.
//
// The name STORED is the reading that resolved, so fund_name records the heading
// the pipeline actually matched on; step 3 is a lookup key rather than a reading
// and leaves the printed name alone. When nothing resolves, the banner as printed
// is stored and the series is left blank: an unresolved heading is still evidence
// of which fund the section belongs to, and losing it would file these votes
// under the fund above.
//
// A heading the header declares AMBIGUOUSLY -- two distinct series answering to
// one normalised name -- is a refusal to choose, not a failed lookup, and is
// never retried under the strip. A series_id is the link key into the ISS panel,
// so a wrong one silently moves one fund's votes onto another; every branch here
// either matches a declared name exactly or stamps nothing.
// registrantKey is the filing's COMPANY CONFORMED NAME already normalised, since
// it is constant across every banner in the filing.
func issResolveFund(ix *issSeriesIndex, banner string) (string, *SeriesDecl) {
	if ix == nil {
		return issResolveFundUncached(ix, banner)
	}
	outer := ix.depth == 0
	ix.depth++
	name, d := issResolveFundMemo(ix, banner)
	ix.depth--
	// The filing's own declarations answer on this same chain with the
	// dictionary unreadable, and what they answer stands: every rung the chain
	// above adds reads the corpus dictionary, and a dictionary rung may only
	// fill a heading the filing itself leaves blank. Read on the outermost
	// call, the way the cross-CIK rung is, so a recursive cut does not re-run
	// the whole chain.
	if outer && ix.hdrOnly != nil {
		if hname, hd := issResolveFund(ix.hdrOnly, banner); hd != nil {
			name, d = hname, hd
		}
	}
	// The heading's own tier word, which no cut above may trade away: Summit
	// Mutual Funds is a two-tier trust whose `SUMMIT RUSSELL 2000 SMALL CAP
	// INDEX FUND` and `SUMMIT RUSSELL SMALL CAP INDEX PORTFOLIO` banners are
	// different funds, and only the Portfolio tier is declared, so every rung
	// that discards the tier word hands one id to both banners (2,932 rows).
	// Judged on the outermost call against the banner AS PRINTED, and only
	// where the registrant declares a series on the heading's own tier -- where
	// it declares none the substitution is the vendor's, not the registrant's,
	// and `AMERITAS SMALL CAP FUND` for a declared `Ameritas Small Cap
	// Portfolio` still resolves.
	if d != nil && outer && issTierMismatch(ix, normalizeSeriesName(banner), d) {
		return banner, nil
	}
	// Last of all: the heading names a fund of a SIBLING registrant of the same
	// sponsor, exact and unique corpus-wide (cikSeries.crossCIK). Read on the
	// heading AS PRINTED only -- every cut the chain above makes is
	// registrant-scoped evidence, and a remainder such as `Income Fund` names
	// some other sponsor's fund in the corpus -- so it fires on the outermost
	// call and never on a recursive cut, and its answer is not memoised, so no
	// later cut can read it back out of the cache.
	//
	// It is consulted whenever the registrant-scoped chain answered INEXACTLY,
	// not only when it refused. An exact, corpus-unique, contemporaneous sibling
	// outranks a same-CIK TOLERANCE answer: Victory Portfolios prints `Victory
	// High Yield VIP Series` for the sleeve its sibling CIK 1068663 declares
	// under exactly that name, and a cut that trades the heading's last two
	// words away matches the filer's own retail `Victory High Yield Fund`
	// (S000053572) instead. A same-CIK EXACT answer is untouched, and every
	// guard inside crossCIK -- the own-brand-infix refusal, contemporaneity,
	// corpus uniqueness -- still applies.
	//
	// A tier-word substitution the registrant's own rename history licenses is
	// registrant-scoped evidence about this filing's header, not a tolerance,
	// so it is not offered to the sibling rung: 890453's unbranded 2006
	// `Small Company Growth Fund` names its declared S000001047, and the exact
	// contemporaneous corpus twin S000003363 belongs to CIK 0001331971.
	//
	// And never against a heading that is the answer's own declared name printed
	// SHORT: `Equity Index` under a declared `EQUITY INDEX FUND` contradicts
	// nothing the registrant declared, and an exact stranger -- CIK 1131013
	// spells `EQUITY INDEX` -- is not evidence against the filing's own header
	// (19,014 rows of American Century Capital Portfolios' 20100630 report filed
	// under two other sponsors' funds). The Victory shape above is the opposite:
	// `VIP Series` are words the declaration does not carry at all.
	if outer && !issBannerDeclaredExact(ix, banner) && !issOwnBrandInfixDecl(ix, banner, d) &&
		!issTierRenameKept(ix, normalizeSeriesName(banner), d) && !issHeadingWithinDecl(banner, d) {
		if alt := issIndexDict(ix).crossCIK(ix.cik, banner, ix.period, ix.registrantKey); alt != nil {
			return banner, alt
		}
	}
	return name, d
}

// issHeadingWithinDecl reports that the heading says nothing this declaration
// does not: every word it prints is a word of the declared name. Such a heading
// is the registrant's own name printed short of a word or two, never a claim
// about some other fund, so no stranger's exact spelling of it outranks it.
func issHeadingWithinDecl(banner string, d *SeriesDecl) bool {
	if d == nil {
		return false
	}
	toks := strings.Fields(normalizeSeriesName(banner))
	if len(toks) == 0 {
		return false
	}
	have := map[string]bool{}
	for _, t := range strings.Fields(normalizeSeriesName(d.Name)) {
		have[t] = true
	}
	for _, t := range toks {
		if !have[t] {
			return false
		}
	}
	return true
}

// issBannerDeclaredExact reports whether the filing's OWN header spells this
// banner as printed for one series -- the exact route (seriesByName /
// lookupSeriesEntry, and the aliases the filing itself declares) that every
// tolerance rung in the chain runs after. An answer reached any other way is a
// tolerance and may be outranked by an exact sibling hit.
func issBannerDeclaredExact(ix *issSeriesIndex, banner string) bool {
	if ix == nil {
		return false
	}
	if d, _ := lookupSeriesEntry(ix.byName, banner); d != nil {
		return true
	}
	if d, _ := lookupSeriesEntry(ix.aliases, banner); d != nil {
		return true
	}
	return issDeclaredClassContract(ix, banner) != nil
}

// issDeclaredClassContract returns the one series whose header block declares
// this banner, exactly, as a <CLASS-CONTRACT-NAME>. A two-tier trust registers
// one series and hangs its portfolios off it as class contracts, and then heads
// each section with the contract's own name: Pacific Select Fund's
// `EMERGING MARKETS PORTFOLIO` is `C000021137` of `S000007766`. Such a name is
// the registrant's own declaration, as exact as a <SERIES-NAME>. Two series
// answering to one class name refuse, the way every declared-name index here
// refuses.
func issDeclaredClassContract(ix *issSeriesIndex, banner string) *SeriesDecl {
	key := normalizeSeriesName(banner)
	if ix == nil || key == "" {
		return nil
	}
	var hit *SeriesDecl
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" {
			continue
		}
		for _, cn := range d.ClassNames {
			if normalizeSeriesName(cn) != key {
				continue
			}
			if hit != nil && hit.SeriesID != d.SeriesID {
				return nil
			}
			hit = d
			break
		}
	}
	return hit
}

// issOwnBrandInfixDecl is cikSeries.ownBrandInfix read against the ONE
// declaration the registrant-scoped chain answered with: the answer differs
// from the heading by exactly one inserted token of the registrant's own name,
// so the heading is the filer's own sleeve printed short of its brand and a
// sibling's identically-spelled retail series is the wrong answer (family
// MISLINK7, Lazard Retirement Series). The dictionary-side test cannot see this
// answer, which comes from the filing's own header.
func issOwnBrandInfixDecl(ix *issSeriesIndex, banner string, d *SeriesDecl) bool {
	if d == nil || d.Name == "" {
		return false
	}
	bt := strings.Fields(normalizeSeriesName(banner))
	nt := strings.Fields(normalizeSeriesName(d.Name))
	reg := strings.Fields(ix.registrantKey)
	if len(bt) == 0 || len(reg) == 0 || len(nt) != len(bt)+1 {
		return false
	}
	brand := make(map[string]bool, len(reg))
	for _, t := range reg {
		brand[t] = true
	}
	for j := range nt {
		if !brand[nt[j]] {
			continue
		}
		cut := append(append([]string{}, nt[:j]...), nt[j+1:]...)
		if issOneTokenEdit(cut, bt) {
			return true
		}
	}
	return false
}

// issRenamedBannerMinToken is the shortest token the rename fill will pair on.
// A fund name's distinguishing word -- `Infrastructure`, `Commodity`,
// `Healthcare` -- is long; the short ones are the vocabulary every sleeve of a
// registrant shares (`mid`, `cap`, `500`, `plus`), and those must never carry a
// pairing on their own.
const issRenamedBannerMinToken = 5

// issRenamedBannerFill completes, WITHIN ONE FILING AND NEVER ACROSS ONE, the
// pairing that filing's own header and its own body already all but state: a
// banner every rung of the chain refuses, one series the header declares that no
// banner of this filing claimed, and a word that occurs in exactly ONE of the
// filing's banners and under exactly ONE of its declared series.
//
// ProShares Trust (CIK 1174610) declares S000040181 `ProShares DJ Brookfield
// Global Infrastructure ETF` and prints its banner under the marketing name the
// index provider left behind, `ProShares Global Direct Infrastructure`: three
// declared words dropped (`DJ`, `Brookfield`, `ETF`) and one inserted
// (`Direct`). No name cut reaches it -- the chain's rungs drop leading brands,
// trailing type words and parentheticals, never an interior pair -- so every row
// of the section goes out blank (1,216 rows in the 2016 report, 1,341 in 2017,
// and in both filings every blank row sits under this one banner).
//
// What decides it is not the name but the ACCOUNTING, the same discipline
// brResidualDeclaredBanner keeps for the sibling layout. `Infrastructure` is
// printed by exactly one of the filing's 45 banners and declared under exactly
// one of its series, so the pairing is 1:1 on both sides and is read off what is
// left over, not guessed among candidates. Two banners carrying the word, or two
// declared sleeves carrying it, and the word decides nothing and is skipped --
// there is no tiebreak, because a series_id is a link key and a positional or
// nearest-fund guess between two of the registrant's own sleeves mis-attributes
// ballots silently, where a blank merely loses them.
//
// The word alone is not enough either. The shape must be a RENAME and not a
// shortening or an extension: the banner prints exactly ONE word the declaration
// does not, the declaration carries at least one word the banner does not, and
// everything else the banner prints the declaration prints too, two declared
// words at least. A heading that is the declared name one word short stays blank
// (family MISLINK4), and one that is the declared name plus a word is another
// sleeve (family MISLINK10). Words of the registrant's own name and of the type
// vocabulary never decide, since those are shared by construction rather than
// distinguishing.
//
// Scope: the filing's OWN header (ix.decls) and its OWN body, so nothing here
// can move a vote onto another registrant's fund, and a banner the chain already
// answers is left exactly as it is -- this only ever fills a blank.
func issRenamedBannerFill(lines []string, ix *issSeriesIndex) map[string]*SeriesDecl {
	if ix == nil || len(ix.decls) == 0 {
		return nil
	}
	// The filing's banners, in document order, deduplicated on the key the fill
	// is read back on in commitBanner.
	var keys, printed []string
	toks := map[string][]string{}
	for i, raw := range lines {
		l := strings.TrimSpace(raw)
		if l == "" {
			continue
		}
		name, ok := issFundSeparator(l)
		if !ok {
			name, _, ok = issBannerWithTail(l)
		}
		if !ok {
			name, ok = issOpenBanner(l, lines, i)
		}
		if !ok || name == "" {
			continue
		}
		k := normalizeSeriesName(name)
		if k == "" {
			continue
		}
		if _, dup := toks[k]; dup {
			continue
		}
		toks[k] = issDedupTokens(strings.Fields(k))
		keys = append(keys, k)
		printed = append(printed, name)
	}
	if len(keys) == 0 {
		return nil
	}

	// Which declared series the body already claims, read on the banner AS
	// PRINTED so the answer is the one the loop itself will reach. The memo is
	// swapped out for the duration: the loop may still teach this index a brand
	// (issItemFamilyBrand), and a pre-pass answer cached ahead of that would
	// then be read back as though it were the loop's own.
	saved, savedHdr := ix.resolved, map[string]issResolved(nil)
	ix.resolved = map[string]issResolved{}
	if ix.hdrOnly != nil {
		savedHdr = ix.hdrOnly.resolved
		ix.hdrOnly.resolved = map[string]issResolved{}
	}
	claimed := map[string]bool{}
	var open []string
	for i, k := range keys {
		if _, d := issResolveFund(ix, printed[i]); d != nil {
			claimed[d.SeriesID] = true
		} else {
			open = append(open, k)
		}
	}
	ix.resolved = saved
	if ix.hdrOnly != nil {
		ix.hdrOnly.resolved = savedHdr
	}
	if len(open) == 0 {
		return nil
	}

	// How many of the filing's banners print each word, and which single series
	// declares it. A word two series declare decides nothing.
	bannerCnt := map[string]int{}
	for _, k := range keys {
		for _, t := range toks[k] {
			bannerCnt[t]++
		}
	}
	declOf, declAmb := map[string]string{}, map[string]bool{}
	for i := range ix.decls {
		id := ix.decls[i].SeriesID
		if id == "" {
			continue
		}
		for _, t := range issDedupTokens(ix.declToks(i)) {
			if prev, ok := declOf[t]; !ok {
				declOf[t] = id
			} else if prev != id {
				declAmb[t] = true
			}
		}
	}
	reg := map[string]bool{}
	for _, t := range strings.Fields(ix.registrantKey) {
		reg[t] = true
	}

	var out map[string]*SeriesDecl
	// takenBy carries the banner a declared series was paired with, and an empty
	// string once a second banner reached it: two banners naming one series is a
	// refusal for BOTH, not a race the first one wins.
	takenBy := map[string]string{}
	for _, k := range open {
		bt := toks[k]
		// Name-shaped only: a registered fund's name is several words, and the
		// pairing needs words to agree on beyond the one that decides.
		if len(bt) < 3 {
			continue
		}
		var pick *SeriesDecl
		for i := range ix.decls {
			d := &ix.decls[i]
			if d.SeriesID == "" || claimed[d.SeriesID] {
				continue
			}
			if !issRenamedBannerPair(bt, ix.declToks(i), d.SeriesID, reg, bannerCnt, declOf, declAmb) {
				continue
			}
			if pick != nil && pick.SeriesID != d.SeriesID {
				pick = nil
				break
			}
			if pick == nil {
				pick = d
			}
		}
		if pick == nil {
			continue
		}
		if first, dup := takenBy[pick.SeriesID]; dup {
			if first != "" {
				delete(out, first)
			}
			takenBy[pick.SeriesID] = ""
			continue
		}
		takenBy[pick.SeriesID] = k
		if out == nil {
			out = map[string]*SeriesDecl{}
		}
		out[k] = pick
	}
	return out
}

// issRenamedBannerPair reports that this banner and this declaration name one
// fund on evidence neither side spells twice: they share a word that occurs in
// exactly ONE banner of the filing and under exactly ONE declared series, that
// word belongs to neither the registrant's own name nor the type vocabulary, and
// everything else the banner prints -- bar EXACTLY one inserted word -- the
// declaration prints too, while the declaration keeps at least one word of its
// own. Both token slices are already normalised; bt is deduplicated.
func issRenamedBannerPair(bt, dt []string, id string, reg map[string]bool,
	bannerCnt map[string]int, declOf map[string]string, declAmb map[string]bool) bool {
	have := make(map[string]bool, len(dt))
	for _, t := range dt {
		have[t] = true
	}
	shared, foreign, rare := 0, 0, false
	for _, t := range bt {
		if !have[t] {
			foreign++
			continue
		}
		shared++
		if len(t) < issRenamedBannerMinToken || issTypeWord(t) || reg[t] || declAmb[t] {
			continue
		}
		if bannerCnt[t] == 1 && declOf[t] == id {
			rare = true
		}
	}
	// EXACTLY one inserted word, never none. A banner that prints a SUBSET of
	// the declared name is a shortening, not a rename, and the chain refuses
	// those deliberately: `... ENHANCED S&P 500 INDEX FUND` under a declared
	// `... ENHANCED S&P 500 STOCK INDEX FUND` is one interior word short, and
	// family MISLINK4 asserts it stays blank. A rename trades words BOTH ways
	// -- the marketing name prints something the registration does not -- and
	// that trade is what this rung reads.
	if !rare || shared < 2 || foreign != 1 {
		return false
	}
	// And the declaration must carry a word the banner does not print. A heading
	// that prints the declared name WHOLE and adds to it is the opposite shape:
	// `AIM PREMIER EQUITY FUND II` over a declared `AIM Premier Equity Fund` is
	// the registrant's second sleeve, which the chain refuses on purpose (family
	// MISLINK10), and the accounting cannot tell it from a rename.
	for _, t := range dt {
		if !issTokensContain(bt, t) {
			return true
		}
	}
	return false
}

// issTokensContain reports membership in an already-deduplicated token slice.
func issTokensContain(toks []string, t string) bool {
	for _, x := range toks {
		if x == t {
			return true
		}
	}
	return false
}

// issDedupTokens keeps the first occurrence of each token, in order.
func issDedupTokens(toks []string) []string {
	out := make([]string, 0, len(toks))
	seen := make(map[string]bool, len(toks))
	for _, t := range toks {
		if seen[t] {
			continue
		}
		seen[t] = true
		out = append(out, t)
	}
	return out
}

func issResolveFundMemo(ix *issSeriesIndex, banner string) (string, *SeriesDecl) {
	if ix.resolved == nil {
		return issResolveFundUncached(ix, banner)
	}
	if r, ok := ix.resolved[banner]; ok {
		return r.name, r.decl
	}
	name, d := issResolveFundUncached(ix, banner)
	ix.resolved[banner] = issResolved{name: name, decl: d}
	return name, d
}

// issMaxBannerBytes bounds the banner the cut chain will recurse on. Several
// branches below re-resolve their own cut of the same banner, and a cut that
// only removes a parenthesis pair descends once per pair, so the chain is
// superlinear in banner length. A declared <SERIES-NAME> is tens of bytes; this
// cap sits an order of magnitude above the longest in the corpus, so it refuses
// only bytes no fund name could be and changes no heading's value.
const issMaxBannerBytes = 512

// issMaxResolveDepth bounds how deep the cut chain may re-resolve. Several
// branches recurse on their own cut of the same banner, so the descent branches
// rather than shortens, and a cut that removes only a parenthesis pair descends
// once per pair. A real heading is answered within a handful of cuts; this bound
// sits far above that, so it refuses only descents no fund name could produce.
const issMaxResolveDepth = 24

func issResolveFundUncached(ix *issSeriesIndex, banner string) (string, *SeriesDecl) {
	if len(banner) > issMaxBannerBytes {
		return banner, nil
	}
	if ix != nil && ix.depth > issMaxResolveDepth {
		return banner, nil
	}
	idx, registrantKey := ix.byName, ix.registrantKey
	d, declared := lookupSeriesEntry(idx, banner)
	// An EXACT hit on a name the registrant first declared AFTER this filing's
	// period of report is a name it reused years later, not this section's fund:
	// Touchstone Variable Series Trust's 20050630 report heads a section
	// `Touchstone Balanced Fund`, which the dictionary carries exactly for
	// S000059066, first declared in 2018, while the contemporaneous sleeve is
	// S000003148. The hit is set aside so the rungs below read the heading the
	// way they would with no name at all -- the brand cut answers it with the
	// sleeve that existed. A HEADER-declared id is undated and issFutureVintage
	// never refuses it, so a filing's own declarations are untouched.
	if ix != nil && d != nil && issFutureVintage(ix, d) {
		d, declared = nil, false
	}
	// A heading that is exactly one declared class ticker (`RWL`, RevenueShares
	// 2012, 18,687 rows with no series): the header's own evidence, exact.
	if d == nil {
		if t := strings.ToUpper(strings.TrimSpace(banner)); t != "" && !strings.ContainsAny(t, " \t") && len(t) <= 6 {
			if td, ok := ix.byTicker[t]; ok {
				return banner, td
			}
		}
	}

	// A name the FILING declares for one of its own series -- the cover's
	// `(changed name from <X> on <date>)` -- is evidence of the same kind as a
	// declared name, so it is read before any cut or tolerance.
	if d == nil && !declared {
		if a := ix.aliases[normalizeSeriesName(banner)]; a != nil {
			return banner, a
		}
	}

	if stripped, ok := issLeadingIndexToken(banner); ok {
		alt, altDeclared := lookupSeriesEntry(idx, stripped)
		switch {
		case d != nil && alt != nil:
			if d.SeriesID != alt.SeriesID {
				// The banner reads as two different funds depending on whether the
				// leading letter is an index or a word. Nothing here can tell which.
				return banner, nil
			}
		case alt != nil && !declared:
			// Only a banner the header does not spell AT ALL may be re-read. When
			// the printed name is declared ambiguously, d is nil and declared is
			// true, and that is a refusal to choose between two series -- returning
			// the alternative here would convert it into a stamp.
			return stripped, alt
		}
		declared = declared || altDeclared
	}

	if d != nil || declared {
		return banner, d
	}
	// The registrant's OWN name, spelled exactly, names the trust and not a
	// series: The Westport Funds heads its single undivided vote table `The
	// Westport Funds` and declares two funds, and every tolerance below folds
	// that heading onto the sibling spelled `Westport Fund` -- 746 rows stamped
	// S000003152, half of them presumptively the other fund's. Only an EXACT
	// declared name may carry the trust's own spelling, and that has already
	// returned above.
	// A terminal corporate suffix the header omits: the masthead
	// `DREYFUS PREMIER NEW LEADERS FUND, INC.` over a declared
	// `DREYFUS PREMIER NEW LEADERS FUND` (S000000092, 533 rows with no
	// series). Only an exact unambiguous hit on the remainder counts, so a
	// declared name that carries the suffix itself is unaffected.
	if rest, ok := issTrailingCorpSuffix(banner); ok {
		if alt, _ := lookupSeriesEntry(idx, rest); alt != nil {
			return rest, alt
		}
	}
	// The mirror case: the DECLARED name carries the incorporation word and the
	// heading omits it -- `NPF - THE JAPAN FUND` for a declared `THE JAPAN
	// FUND, INC.` (S000009778, Nomura Partners Funds 2009, 3,430 rows with no
	// series; this rung reads the heading printed bare, the brand rung below
	// the one carrying the registrant's own `NPF`). Exact on the remainder
	// only: the same filing declares `ASIA PACIFIC EX JAPAN FUND`, which any
	// looser reading would collide with. lessCorpSuffix is nil on collision, so
	// two declared names agreeing after the cut stamp nothing.
	if d := ix.lessCorpSuffix[normalizeSeriesName(banner)]; d != nil {
		return banner, d
	}
	if issTrustOwnName(ix, banner) {
		// The trust's own name is no series name -- except where the SEC renamed
		// the registrant and left the series under the old one:
		// Phoenix-Oakhurst Income & Growth Fund 2004 heads its only section
		// `PHOENIX-OAKHURST INCOME & GROWTH FUND` for a series declared under the
		// registrant's FORMER conformed name `PHOENIX INCOME & GROWTH FUND`
		// (S000001378, 1,964 rows). Those former names are already on the index,
		// so nothing new is read, and exactly one of them must be a declared
		// series name at this CIK: a registrant whose former names reach two
		// declared series, or none, stays blank, and no other rung is consulted.
		return banner, issFormerNameDecl(ix)
	}
	// Franklin's terminal -Master is an export decoration, not a master/feeder alias.
	// Retry only the remaining exact declared name; collisions still return nil.
	if registrantKey == "franklin alternative strategies funds" {
		if rest, ok := strings.CutSuffix(strings.ToLower(strings.TrimSpace(banner)), "-master"); ok {
			d, _ := lookupSeriesEntry(idx, rest)
			return banner, d
		}
	}
	// VALIC Company I prints VALIC I without the incorporated company token.
	if registrantKey == "valic co i" || registrantKey == "valic company i" {
		if rest, ok := strings.CutPrefix(normalizeSeriesName(banner), "valic i "); ok {
			_, d := issResolveFund(ix, rest)
			return banner, d
		}
	}
	// MIP headings omit Master (and sometimes Portfolio), never strategy tokens.
	if registrantKey == "master investment portfolio" {
		if stem, ok := strings.CutPrefix(normalizeSeriesName(banner), "mip "); ok && stem != "" {
			stem = strings.TrimSuffix(stem, " portfolio")
			return banner, idx[stem+" master portfolio"]
		}
	}
	// The audited BRIC heading omits Small-Mid Cap only for this registrant.
	if registrantKey == "claymore exchange traded fund trust 2" && normalizeSeriesName(banner) == "guggenheim bric etf" {
		return banner, idx["guggenheim small mid cap bric etf"]
	}
	// These Premier headings are audited predecessors of exact dictionary
	// names, not a general brand or capitalization-modifier substitution.
	if registrantKey == "axa premier funds trust" {
		switch normalizeSeriesName(banner) {
		case "axa premier health care fund":
			return banner, idx["axa enterprise multimanager health care fund"]
		case "axa premier large cap growth fund":
			return banner, idx["axa enterprise multimanager growth fund"]
		case "axa premier small mid cap growth fund":
			return banner, idx["axa enterprise multimanager mid cap growth fund"]
		}
	}
	// Audited Lincoln export headings: exact aliases, never general TRP expansion
	// or prefix matching between allocation siblings. The exact index refuses collisions.
	if registrantKey == "lincoln variable insurance products trust" {
		switch normalizeSeriesName(banner) {
		case "peters lincoln vip trp structured mid cap growth fund":
			return banner, idx["lvip t rowe price structured mid cap growth fund"]
		case "lvip del cons alloca":
			return banner, idx[normalizeSeriesName("LVIP Delaware Foundation(R) Conservative Allocation Fund")]
		case "lvip del mod allocat":
			return banner, idx[normalizeSeriesName("LVIP Delaware Foundation(R) Moderate Allocation Fund")]
		}
	}
	// Hirtle's audited strategy/account pairs resolve only to declared names.
	// Keep the account code in the key rather than stripping codes generally.
	if registrantKey == "hirtle callaghan trust" {
		switch normalizeSeriesName(banner) {
		case "hirtle callaghan trust growth equity 11vb":
			return banner, idx["growth equity portfolio"]
		case "hirtle callaghan trust value equity 11vw":
			return banner, idx["value equity portfolio"]
		}
	}
	// The bare Nicholas Applegate strategy omits the brand and terminal Fund.
	// Only this audited title is admitted; an inserted EQUITY is not omitted.
	if registrantKey == "nicholas applegate institutional funds" && normalizeSeriesName(banner) == "u s systematic large cap growth" {
		return banner, idx["nicholas applegate u s systematic large cap growth fund"]
	}
	// Harding Loevner's audited historical spellings; never substitute type
	// words for other registrants or resolve the repaired name through aliases.
	if registrantKey == "harding loevner funds inc" {
		target := ""
		switch normalizeSeriesName(banner) {
		case "hlf international equity":
			target = "harding loevner international equity portfolio"
		case "hlf global equity":
			target = "harding loevner global equity portfolio"
		case "hlf emerging market portfolio":
			target = "harding loevner emerging markets portfolio"
		case "harding loevner institutional emerging markets fund":
			target = "harding loevner institutional emerging markets portfolio"
		}
		if target != "" {
			return banner, idx[target]
		}
	}
	// The EQ/ALLAIANCE spelling is an audited typo, not a fuzzy-name rule.
	if key := normalizeSeriesName(banner); strings.Contains(" "+key+" ", " allaiance ") {
		repaired := strings.TrimSpace(strings.ReplaceAll(" "+key+" ", " allaiance ", " alliance "))
		if d, seen := idx[repaired]; seen {
			return banner, d
		}
	}
	// STI Classic prints EQUITY for STOCK in otherwise-identical historical
	// names. Retry one internal token only, against the collision-refusing exact
	// index; neither a declared heading nor an ambiguous alias may be re-read.
	if key := normalizeSeriesName(banner); strings.Count(key, " equity ") == 1 {
		if d, seen := idx[strings.Replace(key, " equity ", " stock ", 1)]; seen {
			return banner, d
		}
	}
	if key := issHistoricalBrandKey(normalizeSeriesName(banner)); key != "" {
		if d, seen := ix.byHistoricalBrand[key]; seen {
			return banner, d
		}
		// The brand index keys each declared name WHOLE, so a banner that
		// abbreviates inside the stem -- `Scudder Large Co Growth` for the
		// declared `DWS Large Company Growth Fund` (S000005707) -- never
		// reaches it, while the same stem printed bare resolves through the
		// abbreviation rungs above. The stem goes back through the whole
		// chain instead, the way issBrandCutStem already sends the remainder
		// of a registrant-prefixed heading. Every hop drops a leading token,
		// so the re-read terminates.
		if stem := issHistoricalBrandStem(key); stem != "" && stem != normalizeSeriesName(banner) {
			if _, d := issResolveFund(ix, stem); d != nil {
				return banner, d
			}
		}
	}
	// The heading spells out a word the declared name abbreviates: `Generation
	// Z ETF` for a declared `The Gen Z ETF` (S000074694). Exactly one token may
	// differ, the declared token must abbreviate the printed one, and two
	// declared names answering to the heading stamp nothing.
	if d := issVowelDroppedAbbrev(ix, banner); d != nil {
		return banner, d
	}
	if d := issDeclaredAbbrevWord(ix, normalizeSeriesName(banner)); d != nil {
		return banner, d
	}
	// The same shape one step further: the heading CONTRACTS two adjacent
	// declared words into one token, keeping the first's initial and the second
	// whole (`WESTWOOD MMITES FD` for `Westwood Mighty Mites Fund`). Word-to-word
	// rungs cannot see it; the guards live in issContractedWordPairDecl.
	if d := issContractedWordPairDecl(ix, banner); d != nil {
		return banner, d
	}
	// A SUB-ADVISER's brand printed in front of the registrant's own acronym:
	// `DREYFUS GVIT MID CAP INDEX FUND` for a declared `GVIT Mid Cap Index
	// Fund` (Gartmore Variable Insurance Trust 2004, 2,468 rows with no
	// series). The registrant-prefix strips key on the registrant's own tokens,
	// so a foreign brand never fires them. The acronym is the anchor: only
	// tokens standing BEFORE it are dropped, the residual still starts with the
	// registrant's own family token, and the lookup is exact and unambiguous.
	if rest, ok := issCutBrandBeforeAcronym(normalizeSeriesName(banner), registrantKey, ix.formerKeys); ok {
		if d, seen := lookupSeriesEntry(idx, rest); seen && d != nil {
			return rest, d
		}
	}
	// The registrant's brand ABBREVIATED across the name: `STI CLASSIC
	// INTERNATIONAL EQUITY FUND VA` for a declared `STI Classic Variable Trust
	// International Equity Fund` (S000004745). The banner keeps the head of the
	// registrant name and re-spells its dropped tail as a trailing token, so the
	// whole registrant name is folded back in and the lookup retried exactly.
	if rest, ok := issRegistrantAbbrevSuffix(normalizeSeriesName(banner), registrantKey); ok {
		if d, seen := lookupSeriesEntry(idx, rest); seen && d != nil {
			return banner, d
		}
	}
	// The document's own title printed after the fund: `Claymore Peroni Equity
	// Opportunities Fund Proxy Voting` for a declared `Claymore Peroni Equity
	// Opportunities Fund` (S000011377). One exact edit, and the exact index
	// still refuses a name two series answer to.
	if head, ok := issCutProxyVotingSuffix(normalizeSeriesName(banner)); ok {
		if d, seen := lookupSeriesEntry(idx, head); seen && d != nil {
			return banner, d
		}
	}
	// The reporting period printed on the heading line beside the fund name:
	// `Longleaf Partners Fund For the Period July 1, 2004 - June 30, 2005` for a
	// declared `Longleaf Partners Fund` (S000009311). The siblings resolve on a
	// distinctive token even with the tail attached; the flagship shares every
	// word with them, so the tail has to come off. Exact lookup only.
	if head, ok := issCutReportingPeriodTail(normalizeSeriesName(banner)); ok {
		if d, seen := lookupSeriesEntry(idx, head); seen && d != nil {
			return banner, d
		}
	}
	// A balanced parenthetical ANYWHERE in the banner, not only at its end:
	// `AST JP Morgan Tactical Preservation Portfolio (FKA AST Goldman Sachs
	// Multi Asset Portfolio) - Subadviser: Goldman Sachs Asset Management,
	// L.P.` for a declared `AST J.P. Morgan Tactical Preservation Portfolio`
	// (S000002009, Advanced Series Trust 2021, 14,521 rows with no series).
	// The trailing rung below never sees it because the sub-adviser clause
	// follows it. One group comes off at a time and the remainder goes back
	// through the whole chain, so a banner carrying several groups peels them
	// one by one; the chain refuses a collision, so a cut that makes the
	// remainder ambiguous still stamps nothing.
	for _, cut := range issParenGroupCuts(banner) {
		if _, d := issResolveFund(ix, cut); d != nil {
			return banner, d
		}
	}
	// Infix FKA separates the current name from a former name, not a second
	// series. Admit only the exact current name, with an optional terminal Fund.
	if current, former, ok := strings.Cut(normalizeSeriesName(banner), " fka "); ok && current != "" && former != "" {
		if d, seen := lookupSeriesEntry(idx, current); seen {
			return banner, d
		}
		if !strings.HasSuffix(current, " fund") {
			d, _ := lookupSeriesEntry(idx, current+" fund")
			return banner, d
		}
		return banner, nil
	}
	// A complete starred former-brand annotation leaves only the current name;
	// never use the former brand as an alternative series lookup.
	if cut := reISSStarredFormerly.ReplaceAllString(banner, ""); cut != banner {
		d, _ := lookupSeriesEntry(idx, strings.TrimSpace(cut))
		return banner, d
	}
	// A terminal annotation without a former name is not part of the name.
	if cut := reISSTerminalFormerly.ReplaceAllString(banner, ""); cut != banner {
		d, _ := lookupSeriesEntry(idx, strings.TrimSpace(cut))
		return banner, d
	}
	// Nomura Partners Funds wraps headings in both an NPF- prefix and a terminal
	// account code. Neither decoration is removed unless the pair is complete.
	if m := reISSNPFAccount.FindStringSubmatch(strings.TrimSpace(banner)); m != nil {
		inner := strings.TrimSpace(m[1])
		if _, d := issResolveFund(ix, inner); d != nil {
			return banner, d
		}
		// This filing omits the incorporated suffix from THE JAPAN FUND, INC.
		// Keep that reading inside the paired NPF/account wrapper.
		if d, seen := idx[normalizeSeriesName(inner)+" inc"]; seen {
			return banner, d
		}
	}
	// JHF is the filing-agent abbreviation used on John Hancock registrants.
	// The brand this registrant prints is that token PLUS its own trailing
	// ordinal (`JHF II` for `John Hancock Funds II`, exactly as the sibling
	// section of the same filing glues it into `JHFII`), so the ordinal is part
	// of the brand and goes with it. Left standing, `II Strategic Equity
	// Allocation Fund` reads as an abbreviation of the declared `International
	// Strategic Equity Allocation Fund` (John Hancock Funds II 2021, 79,614
	// rows split between the two sections on one series).
	if strings.Contains(registrantKey, "john hancock") {
		ord := ""
		if rf := strings.Fields(registrantKey); len(rf) > 1 && issRomanNumeral(rf[len(rf)-1]) {
			ord = rf[len(rf)-1]
		}
		if f := strings.Fields(banner); len(f) > 1 && strings.EqualFold(f[0], "JHF") {
			if len(f) > 2 && ord != "" && strings.EqualFold(f[1], ord) {
				if _, d := issResolveFund(ix, strings.Join(f[2:], " ")); d != nil {
					return banner, d
				}
			}
			if _, d := issResolveFund(ix, strings.Join(f[1:], " ")); d != nil {
				return banner, d
			}
		} else if f := strings.Fields(banner); len(f) > 1 && ord != "" && strings.EqualFold(f[0], "JHF"+ord) {
			// The same brand GLUED to the ordinal, which is how this registrant
			// prints it: `JHFII U.S. Strategic Equity Allocation` for the declared
			// `U.S. Strategic Equity Allocation Fund` (S000055171). The leading
			// qualifier that separates it from the bare `Strategic Equity
			// Allocation Fund` (S000036500) stays in the remainder, so the two
			// sections keep their own ids; the remainder still has to name
			// exactly one declared series.
			if _, d := issResolveFund(ix, strings.Join(f[1:], " ")); d != nil {
				return banner, d
			}
		}
	}
	// A sleeve suffix: `PSF Flexible Managed Portfolio Equity Sleeve` for a
	// declared `Flexible Managed Portfolio` (Prudential Series Fund 2015, 15k
	// rows with no fund). The last two words go, then the ordinary rules.
	if f := strings.Fields(banner); len(f) > 3 && strings.EqualFold(f[len(f)-1], "sleeve") {
		if _, d := issResolveFund(ix, strings.Join(f[:len(f)-2], " ")); d != nil {
			return banner, d
		}
	}
	// These two Phoenix adviser headings expand NORTHERN to NORTHERN TRUST;
	// the dictionary's exact untyped names remain the only identity evidence.
	if registrantKey == "phoenix edge series fund" {
		key := normalizeSeriesName(banner)
		switch key {
		case "phoenix northern trust dow 30 series", "phoenix northern trust nasdaq 100 index series":
			return banner, idx[strings.Replace(strings.TrimSuffix(key, " series"), "northern trust ", "northern ", 1)]
		}
	}
	// The spreadsheet-export half of SM&R's filings heads each section
	// `SM&R BALANCED PORTFOLIO` for a declared `SM&R Balanced Fund` (3,989
	// rows); the ISS-banner half of the same filing spells `FUND` and
	// resolves. Confined to this registrant like WT's below: a heading that
	// REPLACES a type word is `Total Bond Market Fund` against a declared
	// `Total Bond Market Trust` everywhere else, which is a different fund.
	if registrantKey == "sm and r investments inc" {
		if stem, ok := strings.CutSuffix(normalizeSeriesName(banner), " portfolio"); ok && stem != "" {
			if d, seen := idx[stem+" fund"]; seen {
				return banner, d
			}
		}
	}
	// WT's audited Wilmington headings replace FUND with PORTFOLIO. Keep
	// this noun substitution confined to the observed stems and registrant.
	if registrantKey == "wt mutual fund" {
		key := normalizeSeriesName(banner)
		switch key {
		case "wilmington large cap core portfolio", "wilmington large cap growth portfolio",
			"wilmington large cap value portfolio", "wilmington small cap core portfolio":
			return banner, idx[strings.TrimSuffix(key, " portfolio")+" fund"]
		}
	}
	// Salomon's first banner is garbled three ways at once (SALMON for
	// SALOMON, BROTHERS dropped, a stray trailing EQUITY). Audited alias to
	// the one Balanced series the registrant declares; no general rule drops
	// a trailing word before a near-miss brand.
	if registrantKey == "salomon brothers series funds inc" &&
		normalizeSeriesName(banner) == "salmon balanced fund equity" {
		return banner, idx["salomon brothers balanced fund"]
	}
	// A type word the heading adds and the declared name lacks: `PGIM Ultra
	// Short Bond ETF Fund` for `PGIM Ultra Short Bond ETF` (PGIM ETF Trust,
	// 67k rows with no fund). Exact after dropping the last word.
	if f := strings.Fields(banner); len(f) >= 2 {
		switch strings.ToLower(strings.Trim(f[len(f)-1], ".,")) {
		case "fund", "portfolio", "trust", "series":
			// Exact or brand-cut only, and never against a declared name that
			// carries a type word of its own: a heading may ADD a word the
			// declared name lacks, never replace one (`Total Bond Market Fund`
			// is not `Total Bond Market Trust`). `Target Large Capitalization
			// Growth Portfolio` for `LARGE CAPITALIZATION GROWTH` (Target
			// Portfolio Trust, 35k rows) is the brand case.
			if d := issExactOrBrandUntyped(ix, strings.Join(f[:len(f)-1], " ")); d != nil {
				return banner, d
			}
			// The heading may add the asset-class word with it: `BlackRock
			// Mid-Cap Value Equity Portfolio` for a declared `BlackRock Mid
			// Cap Value` (BlackRock Funds 2004, 439 rows with no series).
			// `EQUITY` only, and the declared name must still carry no type
			// word of its own, so a heading that REPLACES a word is refused.
			if len(f) > 3 && strings.EqualFold(f[len(f)-2], "equity") {
				if d := issExactOrBrandUntyped(ix, strings.Join(f[:len(f)-2], " ")); d != nil {
					return banner, d
				}
			}
		}
	}
	// The mirror case: a type word the DECLARED name carries and the heading
	// OMITS: `ProShares Merger` for a declared `ProShares Merger ETF`
	// (S000037318, ProShares Trust 2017, 460 rows with no series). Every
	// extension that resolves must name the same series, so a stem two
	// differently-typed series answer to refuses rather than chooses.
	if f := strings.Fields(banner); len(f) > 1 {
		switch strings.ToLower(strings.Trim(f[len(f)-1], ".,")) {
		case "fund", "portfolio", "trust", "series", "etf":
		default:
			var hit *SeriesDecl
			ambiguous := false
			for _, w := range []string{"etf", "fund", "portfolio", "trust", "series"} {
				cand, seen := lookupSeriesEntry(idx, banner+" "+w)
				if !seen {
					continue
				}
				if cand == nil || (hit != nil && hit.SeriesID != cand.SeriesID) {
					ambiguous = true
					break
				}
				hit = cand
			}
			if hit != nil && !ambiguous {
				return banner, hit
			}
		}
	}
	// A series letter printed as the digit it looks like: `SBL Fund - Series 0`
	// for a declared `SERIES O (ALL CAP VALUE SERIES)` (S000010054, SBL Fund
	// 2013, 1,292 rows). One STANDALONE single-character token only, and the
	// repair has to land on an exact declared name.
	if f := strings.Fields(banner); len(f) > 0 && len(f[len(f)-1]) == 1 {
		var alt string
		switch f[len(f)-1] {
		case "0":
			alt = "O"
		case "1":
			alt = "I"
		}
		if alt != "" {
			g := append(append([]string{}, f[:len(f)-1]...), alt)
			if _, d := issResolveFund(ix, strings.Join(g, " ")); d != nil {
				return banner, d
			}
		}
	}
	// A sleeve or account code before the name: `2DCN Emerging Markets Value
	// Fund`, `(ZW4X) Total Return Blackrock ACWI xUS Index` (John Hancock Funds
	// II, JHVIT, GE Investments: the largest unmatched-heading blocks on run65).
	// The rest goes back through every rule; an ambiguous rest still refuses.
	if rest, ok := issLeadingCodeToken(banner); ok {
		if _, d := issResolveFund(ix, rest); d != nil {
			return rest, d
		}
	}
	// A pure-letter sleeve code before the name: `AA  DWS BALANCED VIP`,
	// `DDD  DWS JANUS GROWTH & INCOME VIP` (DWS Variable Series II 2006, whose
	// codes run A..Z and then double and triple off the same letters; the
	// one-character form already strips above). The token alone is no evidence
	// it IS a code, so the remainder must be an EXACT unambiguous declared
	// name -- that exact hit is itself the evidence, and it leaves an ordinary
	// leading word such as `Growth Emerging Markets Value Fund` untouched.
	if rest, ok := issRepeatedLetterCode(banner); ok {
		if alt, _ := lookupSeriesEntry(idx, rest); alt != nil {
			return rest, alt
		}
	}
	// A leading enumerator: `1.A.  SC IBBOTSON BALANCED FUND` (Sun Capital
	// Advisers Trust 2011, 34,952 rows with no fund). Exact after the cut.
	if rest, ok := issLeadingEnumerator(banner); ok {
		if alt, _ := lookupSeriesEntry(idx, rest); alt != nil {
			return rest, alt
		}
	}
	// A class letter glued to the name: `a-Global Growth Fund`, `e-New World
	// Fund` (American Funds Insurance Series, all 45,253 rows with no series
	// on 2026-09-02). Exact after the two-character cut.
	if rest, ok := issClassLetterPrefix(banner); ok {
		if alt, _ := lookupSeriesEntry(idx, rest); alt != nil {
			return rest, alt
		}
	}
	if issStripRegistrantPrefix {
		if d := lookupSeriesStrippingRegistrant(idx, banner, registrantKey); d != nil {
			return banner, d
		}
		// The registrant's INITIALS and its own words in ONE leading run:
		// `SVS II Scudder Large Cap Value Portfolio` for a registrant named
		// SCUDDER VARIABLE SERIES II (13,457 rows with no series), and
		// `Scudder VIT Equity 500 Index` on its sibling. The strip above cuts
		// the registrant name whole and the brand rungs cut one initialism or
		// one word, so a banner printing both keeps half the run and resolves
		// to nothing. Every token of the run must be the registrant's own word
		// or its initialism, two tokens at least, and what remains must still
		// be a name of its own; the remainder then goes back through the whole
		// chain, including the type-token rung, because the account name adds
		// a `Portfolio` the dictionary spells `VIP`.
		if rest, ok := issCutInitialsAndWordRun(normalizeSeriesName(banner), registrantKey); ok {
			if _, d := issResolveFund(ix, rest); d != nil {
				return banner, d
			}
			if stem, typed := issDropTypeWord(rest); typed && stem != "" {
				if _, d := issResolveFund(ix, stem); d != nil {
					return banner, d
				}
			}
		}
		// The registrant's own words in a leading run with NO initialism among
		// them: `Scudder VIT Equity 500 Index` and `VIT Small Cap Index Fund`
		// on the ProxyEdge account banners of SCUDDER INVESTMENTS VIT FUNDS
		// (11,411 rows of one 2004 filing with no series), whose dictionary
		// spells the same funds `DWS Equity 500 Index VIP`. The run alone is no
		// evidence, so the declaration that answers the remainder must spell
		// none of the run's words; the remainder then goes back through the
		// whole chain and the one type-token rung, the dictionary saying `VIP`
		// where the account says `Fund`.
		if rest, run, ok := issCutRegistrantWordRun(normalizeSeriesName(banner), registrantKey); ok {
			if _, d := issResolveFund(ix, rest); issDeclOmitsRun(d, run) {
				return banner, d
			}
			if stem, typed := issDropTypeWord(rest); typed && stem != "" {
				if _, d := issResolveFund(ix, stem); issDeclOmitsRun(d, run) {
					return banner, d
				}
			}
		}
		// A leading run that mixes the registrant's own word with a MASTER
		// trust's brand: `Scudder Inv Portfolio EAFE Equity Index Portfolio`,
		// the ProxyEdge account name of the master a Scudder Advisor Funds II
		// feeder holds (6,603 rows of one 2005 filing with no series). `Inv
		// Portfolio` is Scudder Investment Portfolios, the master trust, so it
		// is not the registrant's own word and the two runs above keep half of
		// the run. The run alone is no evidence, so the remainder must resolve
		// to ONE declared or dictionary name that spells none of the run's
		// words, and two cut points reading different series stamp nothing.
		if d := issCutRegistrantBrandRun(ix, normalizeSeriesName(banner), registrantKey); d != nil {
			return banner, d
		}
		// The registrant's FORMER conformed names, which the SGML header also
		// declares: John Hancock Variable Insurance Trust 2012 still heads
		// funds `John Hancock Trust Balanced Trust`.
		for _, fk := range ix.formerKeys {
			if d := lookupSeriesStrippingRegistrant(idx, banner, fk); d != nil {
				return banner, d
			}
		}
		// The registrant prefix and a historical brand on the SAME heading:
		// `CITIFUNDS TRUST I - SMITH BARNEY EMERGING MARKETS EQUITY FUND` for a
		// series declared under the successor brand. The prefix comes off by
		// the exact rule above, then the remainder goes through the
		// collision-refusing brand index; nothing else is retried.
		for _, pk := range append([]string{registrantKey}, ix.formerKeys...) {
			rest, ok := issCutRegistrantPrefix(normalizeSeriesName(banner), pk)
			if !ok {
				continue
			}
			if bk := issHistoricalBrandKey(rest); bk != "" {
				if d, seen := ix.byHistoricalBrand[bk]; seen {
					return banner, d
				}
			}
		}
	}
	// The leading internal fund code (`2A14 Mid Cap Core Trust`, `(ZW4X) GEI
	// Total Return ...`) that lookupSeriesTolerant already drops for the other
	// layouts; this layout had never consulted it.
	if d, _ := lookupSeriesTolerantEntry(idx, banner); d != nil {
		return banner, d
	}

	// The three rules below were placed by the 2026-09-02 series-fill
	// measurement (40.1M ISS rows carrying a fund name the header did not
	// declare). Each fires only for a name the header does not spell at all,
	// requires exact equality after one described edit, and refuses on any
	// collision. The printed banner is kept as the fund name in every case.

	// An internal fund code before a name the rules below can read: the code
	// comes off and the remainder goes through the whole chain again. The
	// leading `NPX` of a ProxyEdge `Selected Accounts: NPX GABELLI GLOBAL
	// GROWTH FD` line is read the same way: it is the report type the vendor
	// prints ahead of the account, never a fund word, so it comes off and the
	// remainder goes back through the chain.
	if f := strings.Fields(banner); len(f) > 1 && (internalFundCode(strings.Trim(f[0], "()")) || strings.EqualFold(f[0], "NPX")) {
		if _, d := issResolveFund(ix, strings.Join(f[1:], " ")); d != nil {
			return banner, d
		}
	}

	// The TRAILING half of the same ProxyEdge account grammar. `Selected
	// Accounts: GABELLI GLOBAL OPP FUND GRP` closes on the vendor's account-GROUP
	// marker, and `Selected Accounts: NPX GABELLI GLB TELECOM FD` on its
	// vowel-dropped spelling of the type word the declared name prints in full
	// (CIK 909504, Gabelli Global Series Funds: 3,015 rows with no series across
	// its 2006-2008 reports). Neither token is a fund word, so the account name
	// is re-spelled once -- the group marker dropped, the abbreviation restored
	// to the one type word it abbreviates -- and the remainder goes back through
	// the whole chain, which still refuses a collision. The restored token is
	// spelled out in full, so the re-read can never make the same edit again.
	if f := strings.Fields(banner); len(f) > 2 {
		last := strings.ToLower(strings.Trim(f[len(f)-1], ".,"))
		if last == "grp" {
			if _, d := issResolveFund(ix, strings.Join(f[:len(f)-1], " ")); d != nil {
				return banner, d
			}
		}
		for _, tw := range []string{"fund", "portfolio", "trust", "series"} {
			if !issVowelDropped(last, tw) {
				continue
			}
			g := append(append([]string{}, f[:len(f)-1]...), tw)
			if _, d := issResolveFund(ix, strings.Join(g, " ")); d != nil {
				return banner, d
			}
		}
	}

	// A labelled sub-adviser clause after the fund name.
	// `Clarion Global Real Estate Portfolio, a series of Met Investors Series
	// Trust`: the registrant named after the fund (MET Investors, 20k rows).
	if k := strings.Index(strings.ToLower(banner), ", a series of "); k > 0 {
		if _, d := issResolveFund(ix, strings.TrimSpace(banner[:k])); d != nil {
			return banner, d
		}
	}
	if cut, ok := issCutSubAdviser(banner); ok {
		if _, d := issResolveFund(ix, cut); d != nil {
			return banner, d
		}
	}

	// A trailing parenthetical the filing marks as an ALIAS names the fund
	// outright, so it is read before the head it sits beside.
	if inner, ok := issAKAParenthetical(banner); ok {
		if _, d := issResolveFund(ix, inner); d != nil {
			return banner, d
		}
	}

	// A trailing parenthetical on the banner.
	seriesCandidate := banner
	if cut, ok := issCutTrailingParenthetical(banner); ok {
		if _, d := issResolveFund(ix, cut); d != nil {
			return banner, d
		}
		seriesCandidate = cut
	}
	// A parenthetical sitting BETWEEN the name and its type word: `RETFT Russell
	// Small Cap Aggressive Growth (Earnings Momentum) ETF` for a declared
	// `Russell Small Cap Aggressive Growth ETF` (S000034103). Same rule as the
	// trailing one -- a lookup key only, and the exact index refuses collisions.
	if cut, ok := issCutMedialParenthetical(banner); ok {
		if _, d := issResolveFund(ix, cut); d != nil {
			return banner, d
		}
	}
	// Some Phoenix headings insert one standalone SERIES before the fund stem.
	if d := issWithoutStandaloneSeries(ix, seriesCandidate); d != nil {
		return banner, d
	}

	// A sleeve or an unlabelled sub-adviser after a dash: `State Street Total
	// Return V.I.S. Fund - ACWI xUS Index`, `International Equity Fund - AQR
	// Capital Management, LLC`. The HEAD must be a declared name exactly; when
	// it is not, the TAIL may be (`Variable Trust - Amerigo Fund`). Either way
	// one side of the dash equals a declared name and the other is dropped.
	// The dash may be glued to the head: `Natixis Sustainable Future 2015
	// Fund- AIA` (Natixis Funds Trust IV, 74,006 of 74,666 rows with no
	// series on 2026-09-02). A hyphenated word (`Growth-Income`) has no space
	// after its dash and is never cut.
	// A colon does the same work: `Clearwater Core Equity Fund: AQR Capital
	// Management, LLC` (Clearwater Investment Trust, the largest no-heading
	// htmltable shape on run65).
	// An em or en dash does the same work as the hyphen, and carries the
	// report title rather than a sleeve: `Ultra-Small Company Market Fund
	// &#151; Proxy Voting Record` (Bridgeway Fund 2004, 4,256 rows with no
	// fund). `&#151;` is the cp1252 spelling and decodes to U+0097, so both
	// it and the Unicode dashes are separators here. The rule is unchanged --
	// one side of the dash must equal a declared name and the other is
	// dropped -- so a title that is itself a fund name still refuses.
	for _, sep := range []string{" - ", "- ", ": ", " \u2014 ", " \u2013 ", " \u0097 ", " \u0096 "} {
		if head, tail, ok := strings.Cut(banner, sep); ok && strings.TrimSpace(head) != "" && strings.TrimSpace(tail) != "" {
			if d := lookupSeriesByName(idx, head); d != nil {
				return banner, d
			}
			if d := lookupSeriesByName(idx, tail); d != nil {
				return banner, d
			}
			// The colon is a LABEL's, not a sleeve separator: `Fund/Fund Family
			// Name: Dreman High Opportunity Large Cap Value Fund` (Dreman
			// Contrarian Funds 2011, 631 rows with no fund at all). The head has
			// to be one of the labels a cover sheet names its fund with, so an
			// ordinary `Fund: sleeve` heading is untouched, and the tail then
			// goes through the whole chain exactly as a bare heading would.
			if sep == ": " && issFundLabelHead(head) {
				if _, d := issResolveFund(ix, strings.TrimSpace(tail)); d != nil {
					return banner, d
				}
			}
			// The head may still carry a brand or code: `PSF Jennison 20/20
			// Focus Portfolio - Value` (Prudential Series Fund). The other
			// rules run on it; the head has no dash of its own, so this ends.
			// ... but never when the head is the REGISTRANT's own name and
			// nothing else: `LEGG MASON PARTNERS INVESTMENT FUNDS, INC. - LEGG
			// MASON PARTNERS MULTIPLE DISCIPLINE FUNDS GLOBAL - BALANCED ALL CAP
			// GROWTH AND VALUE FUND` put S000008861 on 4,495 rows of three other
			// portfolios, because `partners investment` is a pair only the
			// Investment Grade Bond Fund carries. A registrant naming itself
			// names no series; the tail is where the fund is.
			if !strings.Contains(head, "- ") && !issRegistrantOwnWords(head, registrantKey) {
				if _, d := issResolveFund(ix, strings.TrimSpace(head)); d != nil {
					return banner, d
				}
			}
		}
	}

	key := normalizeSeriesName(banner)
	if key == "" {
		return banner, nil
	}

	// A trailing parenthetical on the declared name.
	if d, seen := ix.lessParen[key]; seen {
		if d == nil {
			// The collision is a fund registered once per CLASS, `JNL/AIM
			// LARGE CAP GROWTH FUND (A)` and `(B)` (JNL Series Trust 2006,
			// 61,151 rows with no series on run71), and the banner names the
			// fund once. Every class-marked series is that fund; all of them
			// are stamped, MultiValueSep-joined, as a consolidated filing is.
			// A collision of different sleeves (`(Core Plus)` against `(Short
			// Duration)`) is not a class pair and stays refused.
			if d := issClassPairDecl(ix, key, banner); d != nil {
				return banner, d
			}
		}
		return banner, d
	}

	// The banner spaces a token the header runs together.
	compactKey := strings.ReplaceAll(key, " ", "")
	if d, seen := ix.byCompact[compactKey]; seen {
		return banner, d
	}
	// The same compact reading after an audited registrant brand is omitted.
	// A declaration first made AFTER this filing's period is refused here the
	// way the distinctive and stem rungs already refuse it: dropping the lead
	// word of a name the registrant only registered years later invents a
	// sleeve, it does not read one. `WELLS FARGO ADVANTAGE LARGE COMPANY
	// GROWTH FUND` on a 20050630 report reaches S000029061, declared only as
	// `Premier Large Company Growth Fund` and later, first seen 20110630, with
	// `Premier` printed nowhere in the filing (327 rows).
	if d, seen := ix.lessLeadCompact[compactKey]; seen && !issFutureVintage(ix, d) {
		return banner, d
	}

	// A brand on the declared side and, when the banner carries no type
	// word, the declared type word as well.
	for _, b := range ix.brands {
		rest, ok := issCutBrand(key, b)
		if !ok {
			continue
		}
		if d, seen := ix.lessBrandFull[rest]; seen {
			return banner, d
		}
		if _, typed := issDropTypeWord(rest); !typed {
			if d, seen := ix.lessBrandType[rest]; seen {
				return banner, d
			}
		}
		// The same compact reading as above, after the brand comes off:
		// `SUMMIT S&P MID CAP 400 INDEX PORTFOLIO` for a declared `S&P Midcap
		// 400 Index Portfolio` (Summit Mutual Funds, 867 rows). Collisions
		// were recorded as nil by put and still refuse.
		restCompact := strings.ReplaceAll(rest, " ", "")
		if d, seen := ix.byCompact[restCompact]; seen && d != nil {
			return banner, d
		}
		if d, seen := ix.lessLeadCompact[restCompact]; seen && d != nil && !issFutureVintage(ix, d) {
			return banner, d
		}
		// The heading runs the capitalization token together AND prints a
		// strategy word where the declared name carries its type word:
		// `BRAZOS MIDCAP GROWTH` for a declared `Brazos Mid Cap Portfolio`
		// (S000005275, 462 rows). The brand comes off both sides, the
		// declared type word and the heading's trailing token come off, and
		// what is left must compact to the same string; a collision refuses.
		// The heading's trailing token may not itself be a type word, so
		// `... EQUITY TRUST` for a declared `... Equity Fund` is untouched.
		if toks := strings.Fields(rest); len(toks) > 1 && !issTypeWord(toks[len(toks)-1]) {
			stemCompact := strings.ReplaceAll(strings.Join(toks[:len(toks)-1], " "), " ", "")
			if d := ix.lessBrandTypeCompact[stemCompact]; d != nil {
				return banner, d
			}
		}
	}
	// The registrant's FULL name where the declared names carry only its
	// leading tokens: `State Farm Variable Product Trust Small Cap Equity
	// Index` for `State Farm Small Cap Equity Index Fund` (441k rows). The
	// full name becomes each shorter leading run, once.
	if rest, ok := strings.CutPrefix(key, registrantKey+" "); ok && rest != "" {
		for _, b := range ix.brands {
			if !strings.HasPrefix(registrantKey, b+" ") {
				continue
			}
			if d, seen := ix.byName[b+" "+rest]; seen {
				return banner, d
			}
			if d, seen := ix.lessBrandFull[rest]; seen {
				return banner, d
			}
			if _, typed := issDropTypeWord(rest); !typed {
				if d, seen := ix.lessBrandType[rest]; seen {
					return banner, d
				}
			}
		}
	}

	// The header's `&` (normalised to `and`) absent from the banner.
	if !strings.Contains(key, " and ") {
		if d, seen := ix.lessAnd[key]; seen {
			return banner, d
		}
	}

	// The registrant's own type word, omitted from wherever it sits.
	if ix.lessTypeWord != nil {
		if d, seen := ix.lessTypeWord[key]; seen {
			return banner, d
		}
	}

	// The heading prints the generic `FUND` where the declared name carries its
	// registered type word: `AMERITAS SMALL CAP FUND` for a declared `Ameritas
	// Small Cap Portfolio` (S000008739, Calvert Variable Series 2004, 1,021
	// rows). Only that direction -- a heading that swaps in `Trust` or
	// `Portfolio` names a different registered series and still refuses -- and
	// two declared names sharing a stem collided in the index and refuse.
	if stem, ok := strings.CutSuffix(key, " fund"); ok {
		if d := ix.lessAnyType[stem]; d != nil {
			return banner, d
		}
	}

	// The last word every declared name shares, missing from the banner. A stem
	// a sibling declaration answers to under its own type word is that
	// sibling's, not the common-suffix name's, and never reaches the drop.
	if ix.lessSuffixSibling != nil {
		if d, seen := ix.lessSuffixSibling[key]; seen {
			return banner, d
		}
	}
	if ix.lessSuffix != nil {
		if d, seen := ix.lessSuffix[key]; seen {
			return banner, d
		}
		for _, b := range ix.brands {
			if rest, ok := issCutBrand(key, b); ok {
				if d, seen := ix.lessSuffix[rest]; seen {
					return banner, d
				}
			}
		}
	}

	// The registrant's own leading tokens on one side only: on the declared
	// name (looked up with them removed), or on the banner (removed, then
	// looked up exactly). A whole-token boundary either way, and the declared
	// side is consulted first so that a collision recorded there is honoured.
	if d, seen := ix.lessBrand[key]; seen {
		return banner, d
	}
	for _, b := range ix.brands {
		if rest, ok := issCutBrand(key, b); ok {
			if d, seen := ix.byName[rest]; seen {
				return banner, d
			}
			// The brand comes off BOTH sides: `RSI Core Equity Fund` for a
			// declared `RSI Retirement Trust - Core Equity Fund` (RSI
			// Retirement Trust 2004, 2,761 rows with no fund).
			if d, seen := ix.lessBrand[rest]; seen {
				return banner, d
			}
			// The brand comes off the banner and the declared name's
			// incorporation word off the other side: `NPF - THE JAPAN FUND`
			// for a declared `THE JAPAN FUND, INC.`.
			if d := ix.lessCorpSuffix[normalizeSeriesName(rest)]; d != nil {
				return banner, d
			}
		}
	}

	// The declared name's trailing conjunct, dropped from the heading.
	if d, seen := ix.lessConjunct[key]; seen {
		return banner, d
	}
	// One word of the declared name abbreviated by the heading.
	if d := issAbbrevWordDecl(ix, key); d != nil {
		return banner, d
	}
	// A hyphenated word of the declared name printed as its initialism.
	if d := issHyphenInitialismDecl(ix, key); d != nil {
		return banner, d
	}

	// A brand on the declared side that the registrant's own name never
	// supplies: `MULTI-MANAGER SMALL CAP GROWTH FUND` for a declared
	// `JPMorgan Multi-Manager Small Cap Growth Fund` (JP Morgan Fleming Series
	// Trust 2004, 5,702 rows with no fund). The banner must equal a declared
	// name with exactly ONE leading token removed, and exactly one declared
	// series may answer to it -- a collision was recorded as nil and refuses.
	// A declaration first made after the period is refused, as at the compact
	// twin above: the dropped lead word is the only thing that distinguishes
	// the declared name, and a sleeve registered years later cannot be what
	// the banner names.
	if d := ix.lessLeadToken[key]; d != nil && !issFutureVintage(ix, d) {
		return banner, d
	}
	// The same reading where the heading ALSO substitutes the type word: `ICAP
	// Select Equity Portfolio` for a declared `MainStay ICAP Select Equity Fund`
	// (S000000734, 344 rows), the acquirer's brand and the registered type word
	// both printed as the fund was known before the acquisition. The heading must
	// carry a type word of its own, one leading token comes off the declared
	// name, and a stem two declared series answer to was recorded as nil and
	// refuses.
	if stem, typed := issDropTypeWord(key); typed {
		if d := ix.lessLeadTokenAnyType[stem]; d != nil && !issFutureVintage(ix, d) {
			return banner, d
		}
	}
	// The same reading where the banner carries the registrant's HISTORICAL
	// brand and the declared name a successor brand: `AXP Variable Portfolio -
	// S&P 500 Index Fund` for a declared `RiverSource Variable Portfolio S&P
	// 500 Index Fund` (AXP Variable Portfolio Investment Series, 8,106 rows
	// with no series). The registrant's own brand comes off the banner and
	// exactly one leading token off the declared name; a collision refuses.
	for _, b := range ix.brands {
		rest, ok := issCutBrand(key, b)
		if !ok {
			continue
		}
		if d := ix.lessLeadToken[rest]; d != nil && !issFutureVintage(ix, d) {
			return banner, d
		}
	}
	// The banner-side counterpart: the registrant's own token comes off and ONE
	// further leading token of the retail brand goes with it, because the brand
	// is two words and only the first belongs to the registrant key: `HSBC
	// INVESTOR INTERNATIONAL EQUITY FUND` for a declared `International Equity
	// Fund` (HSBC Advisor Funds Trust, 1,120 rows with no series). What remains
	// must be a declared name OUTRIGHT, and a stem two series answer to is nil
	// and refuses.
	for _, b := range ix.brands {
		rest, ok := issCutBrand(key, b)
		if !ok {
			continue
		}
		f := strings.Fields(rest)
		if len(f) < 3 || issDeclaredToken(ix, f[0]) {
			continue
		}
		if d, seen := lookupSeriesEntry(ix.byName, strings.Join(f[1:], " ")); seen && d != nil {
			return banner, d
		}
	}
	// The declared name printed WITHOUT the registrant's own leading words and
	// without its corporate suffix: `HIGH YIELD FUND` for the declared `T. Rowe
	// Price High Yield Fund, Inc.` (S000002132, 215 rows with no series).
	if d := ix.lessRegistrantLead[key]; d != nil {
		return banner, d
	}

	// The registrant's own name, misspelled or one word short of the header's.
	if d := issNearMissDecl(ix, key); d != nil {
		// A near miss that DROPS a qualifier supposes the filing omitted a word
		// it never printed, while a spliced reading takes the heading to print
		// one declared name whole. When the two name DIFFERENT series the
		// heading has given two answers and neither is evidence: `Copeland Risk
		// Managed Dividend Growth Fund` reads as the declared `Copeland
		// International Risk Managed Dividend Growth Fund` (S000039172) only by
		// supposing a dropped `International`, while it prints the declared
		// `Copeland Dividend Growth Fund` (S000030695) entire. Refusing here
		// leaves the exact dictionary alias to answer.
		if s := issSplicedDecl(ix, key); s != nil && s.SeriesID != d.SeriesID {
			return banner, nil
		}
		return banner, d
	}
	// The registrant's brand MISSPELLED in front of the fund: `VAN EKK INT'L
	// INVESTORS GOLD FUND` for a declared `International Investors Gold Fund`
	// (S000009199, Van Eck Funds 2009, 526 rows), where the sibling section
	// `VAN ECK GLOBAL HARD ASSETS FUND` resolves through the exact brand cut
	// beside it. Exactly one token of the brand may differ, by one character,
	// so the remainder is still the registrant's own name; what is left goes
	// back through the whole chain and an ambiguous remainder still refuses.
	for _, b := range ix.brands {
		rest, ok := issCutNearMissBrand(key, b)
		if !ok {
			continue
		}
		if _, d := issResolveFund(ix, rest); d != nil {
			return banner, d
		}
	}
	// The heading abbreviates the registrant's OWN declared portfolio to its
	// initials and then names a sleeve of it: `AST QMP PGIMQS International
	// Core Equity` for the declared `AST Quantitative Modeling Portfolio`
	// (S000031888, Advanced Series Trust 20220630), whose 2023 filing spells
	// the same sleeve out and resolves through the sleeve-stem rung. This runs
	// ahead of the vocabulary rungs below because the sleeve descriptor alone
	// reaches an UNRELATED declared name that ends in the same words -- `AST
	// QMA International Core Equity Portfolio` -- which stamps the wrong id
	// rather than losing the section.
	if d := issOwnInitialsSleeveDecl(ix, key); d != nil {
		return banner, d
	}
	// The registrant's own vocabulary, when the heading prints a name that has
	// since been changed and no single edit reaches it.
	if d := issDistinctiveTokenDecl(ix, key); d != nil {
		return banner, d
	}
	// The same vocabulary read as an adjacent ordered PAIR, which is rare enough
	// to answer where no single word of the heading is.
	if d := issDistinctivePairDecl(ix, key); d != nil {
		return banner, d
	}
	// The heading is the fund's MARKETING name, which re-orders and re-words
	// the declared name around a distinctive stem.
	if d := issDistinctiveStemDecl(ix, key); d != nil {
		return banner, d
	}
	// An abbreviated stem of a declared name followed by a sub-adviser sleeve.
	if d := issAbbrevStemDecl(ix, key); d != nil {
		return banner, d
	}
	// The declared name cut off at the banner's own width: `ALLIANCEBERNSTEIN
	// BALANCED WEALTH STRATEGY PORT` for a declared `AllianceBernstein
	// Balanced Wealth Strategy Portfolio` (S000010443, 2,535 rows). Exactly
	// one declared name may continue the heading, and its last word must be a
	// genuine stem of the declared word.
	if d := issWidthTruncatedDecl(ix, key); d != nil {
		return banner, d
	}
	// A fund-family prefix glued to the fund by a hyphen and no space:
	// `ALLIANCEBERNSTEIN VARIABLE SERIES FUND-VALUE PORTFOLIO` for a declared
	// `AllianceBernstein Value Portfolio` (825316, 8,055 rows). Every token of
	// the prefix must be a token of the registrant's own name, so only the
	// registrant's own vocabulary is ever cut; the remainder goes back through
	// the whole chain and an ambiguous remainder still refuses.
	if rest, ok := issHyphenGluedRegistrantPrefix(banner, registrantKey); ok {
		if _, alt := issResolveFund(ix, rest); alt != nil {
			return banner, alt
		}
	}
	// An UNLABELLED sub-adviser brand hyphen-glued to the house token:
	// `PHOENIX-DUFF & PHELPS REAL ESTATE SECURITIES FUND` and
	// `PHOENIX-ABERDEEN INTERNATIONAL` for a registrant whose declared names all
	// read `PHOENIX <strategy>` (Phoenix Multi Portfolio Fund 2004, 899 rows with
	// no series). issCutSubAdviser needs the literal `Sub-Adviser:` label and
	// never fires; issHyphenGluedRegistrantPrefix cuts `PHOENIX-` and leaves the
	// brand in place.
	if d := issCutGluedBrand(ix, banner, registrantKey); d != nil {
		return banner, d
	}
	// The same prefix cut where the filing's own separator is a colon.
	if rest, ok := issColonRegistrantPrefix(banner, registrantKey); ok {
		if _, alt := issResolveFund(ix, rest); alt != nil {
			return banner, alt
		}
	}
	// The geography printed as a NOUN where the declared name inflects it as an
	// adjective: `GAM EUROPE FUND` for a declared `GAM European Equity Fund`
	// (GAM Funds Inc 2005, 1,763 rows with no series). `GAM EUROPEAN FUND`
	// already resolves through the dropped-`Equity` rung, so the inflection is
	// the sole blocker. One token only, and the retried key must resolve; an
	// ambiguous retry still refuses.
	if d := issGeographyInflectionDecl(ix, key); d != nil {
		return banner, d
	}
	// `SMID` is the industry contraction of `SMALL/MID`, which the registered
	// name spells out: `CRM SMID Cap` for a declared `CRM SMALL/MID CAP VALUE
	// FUND` (S000001325, 203 rows), where the sibling banner `CRM Mid Cap`
	// resolves to `CRM MID CAP VALUE FUND` through the rungs above. One token
	// only, and the expanded key goes back through the whole chain, so an
	// ambiguous expansion still refuses.
	if alt, ok := issExpandSmid(key); ok {
		if _, d := issResolveFund(ix, alt); d != nil {
			return banner, d
		}
	}
	// The declaration prints an adviser's name as an ACRONYM the heading spells
	// out: `JNL/Mellon Capital Management Dow 10 Fund` for a declared `JNL/MCM
	// DOW 10 FUND` (S000001693, 187 rows), where the sibling declarations differ
	// from it only after the acronym. Every other token must agree in order, the
	// acronym's letters must be the initials of exactly that many consecutive
	// heading tokens, and two series answering refuse.
	if d := issInternalAcronymDecl(ix, key); d != nil {
		return banner, d
	}
	// A token the heading INSERTS before the terminal type word, which the
	// trailing-type-word rung above never reaches: `GAMERICA CAPITAL FUND` for
	// a declared `GAMerica Fund` (353 rows). Exactly one internal token is
	// dropped, the result must be an exact declared name, and two different
	// drops naming two different series refuse.
	if d := issInternalTokenDropDecl(ix, key); d != nil {
		return banner, d
	}
	// The heading SPLICES words into a declared name: `Dreman High Opportunity
	// Large Cap Value Fund` for a declared `DREMAN HIGH OPPORTUNITY FUND`
	// (S000019613, 631 rows), `Claymore/Zacks Yield Hog ETF` for a declared
	// `ZACKS YIELD HOG` (S000012992, 1,546 rows) where the sibling declaration
	// `Claymore?Zacks Yield Hog Portfolio` keeps a bare-stem lookup ambiguous.
	// Every token of the declared name must appear in the heading IN ORDER, so
	// this is a superset reading of one declared name rather than a word-overlap
	// score; the declared name must carry at least three tokens and the heading
	// may add at most issSpliceExtraWords of its own, and exactly one declared
	// series may answer -- a second one refuses, which is what keeps two funds
	// that differ only by an inserted qualifier from collapsing onto each other.
	if d := issSplicedDecl(ix, key); d != nil {
		return banner, d
	}
	// The heading names a SLEEVE of a declared fund: the type word sits inside
	// the heading and a sleeve qualifier trails it. `GE-STRATEGIC FUND INTL`
	// and `STRATEGIC FUND DOMESTIC EQ LC` for a declared `GE Strategic
	// Investment Fund` (S000001624, 3,975 rows), whose own section
	// `GE STRATEGIC INV FUND (MF)` resolves beside them.
	if d := issSleeveStemDecl(ix, key); d != nil {
		return banner, d
	}
	// The heading DROPS the last word every declared name shares, and no rung
	// above reaches it because the remaining edit is on the other side:
	// `ARMADA LARGE CAP VALUE` for a dictionary-backed `ALLEGIANT LARGE CAP
	// VALUE FUND` (S000001188, 5,588 rows), where the historical-brand swap
	// fires only on the typed spelling. The word is appended and the whole
	// chain runs once more; the retried key ends in the suffix, so it cannot
	// recurse, and an ambiguous retry still refuses. A heading that already
	// carries a type word of its own is left alone -- `GS STRUCTURED
	// INTERNATIONAL EQUITY TRUST` is a different registered series from the
	// declared `... Equity Fund`, not a heading missing a word. The type word
	// counts wherever it stands: `Fidelity Real Estate High Income Fund II`
	// prints one behind a sequence marker, and appending Fidelity Covington
	// Trust's shared `ETF` turned that 2004 fund into the 2020 `Fidelity Real
	// Estate Investment ETF`.
	if toks := strings.Fields(key); ix.commonSuffix != "" && len(toks) > 1 &&
		issLastTypeWord(toks) == "" && toks[len(toks)-1] != ix.commonSuffix {
		if _, d := issResolveFund(ix, banner+" "+ix.commonSuffix); d != nil {
			return banner, d
		}
	}
	// The heading abbreviates its OWN trailing type word: `Real Est Sec Port`
	// for `Real Estate Securities Portfolio` (Scudder Investments VIT Funds
	// 2004, 102 rows, whose dictionary spells the fund `DWS RREEF Real Estate
	// Securities VIP`). The rung above appends the registrant's shared suffix
	// only where the heading carries no type word at all, and a heading printing
	// `Port` carries one it never spells out, so the suffix is never reached.
	// The short word is DROPPED, exactly as issDropTypeWord drops the spelled
	// one, and the stem goes back through the whole chain -- an ambiguous stem
	// still refuses.
	if stem, ok := issDropAbbrevTypeWord(key); ok {
		if _, d := issResolveFund(ix, stem); d != nil {
			return banner, d
		}
	}
	// The heading spells the declared name's trailing words as an ACRONYM:
	// `BB&T MID CAP GROWTH VIF` for a declared `BB&T MID CAP GROWTH VARIABLE
	// INSURANCE FUND` (S000012132, 487 rows; 2,140 rows in that filing carry a
	// VIF banner). Every other token must agree exactly.
	if d := issTrailingAcronymDecl(ix, key); d != nil {
		return banner, d
	}
	// The registrant prints its OWN name abbreviated in front of the fund: `GE
	// INST STRATEGIC INV FUND (MF)` for a declared `Strategic Investment Fund`
	// (S000001632, 2,113 rows), where the sibling section spelling the prefix in
	// full resolves through the exact strip above. Only the registrant's own
	// leading words come off, each of them a prefix of the word it shortens, and
	// the remainder goes back through the whole chain; an ambiguous remainder
	// still refuses.
	if issStripRegistrantPrefix {
		if rest, ok := issCutAbbreviatedRegistrantPrefix(banner, registrantKey); ok {
			if _, d := issResolveFund(ix, rest); d != nil {
				return banner, d
			}
		}
	}
	// The declaration MISSPELLS its own type word: `HARBINGER PORTFOLIO` for a
	// dictionary-backed `Harbinger Portolio` (S000011315, Credit Suisse
	// Institutional Fund 2004, 242 rows), the SEC's own dropped letter carried
	// verbatim into cik_series.tsv. Everything but the type word must agree
	// exactly and exactly one series may answer.
	if d := issTypoTypeWordDecl(ix, key); d != nil {
		return banner, d
	}
	// The heading and the declaration share a leading token run that names
	// exactly one series of this registrant and diverge only after it: `Pin Oak
	// Aggressive Stock Fund` for a declared `PIN OAK EQUITY FUND` (S000006539,
	// Oak Associates Funds 2014, 417 rows), where the marketing name and the
	// registered name agree on the `<Colour> Oak` stem no other series carries.
	// The heading prints the fund's PREDECESSOR brand where the header declares
	// the registrant's own: `SYNOVUS MID CAP VALUE FUND` for a declared
	// `SENTINEL MID CAP VALUE FUND` (S000015894, Sentinel Group Funds 2007, all
	// 350 rows of the filing), the brand the 2007 reorganisation replaced. This
	// is the registrant-prefix shape with the brand SUBSTITUTED rather than
	// stripped, which is why no strip above fires on it. Only the leading token
	// moves, the declared name's own leading token must be the registrant's
	// brand -- so a heading naming a different fund of the family is untouched --
	// and the remainder must answer to exactly one declared series, which
	// lessLeadToken already refuses to do on a collision.
	if d := issSubstitutedBrandDecl(ix, key); d != nil {
		return banner, d
	}
	if d := issLeadingStemDecl(ix, key); d != nil {
		return banner, d
	}
	// The heading closes on a word of the series' OWN class, and may open on the
	// report's one-letter fund code: both readings are tried and the code is only
	// read past when the remainder answers.
	if d := issClassWordDecl(ix, key); d != nil {
		return banner, d
	}
	if stripped, ok := issLeadingIndexToken(key); ok {
		if d := issClassWordDecl(ix, stripped); d != nil {
			return banner, d
		}
	}
	// The heading opens on the registrant's own brand printed COMPACTED, with
	// the punctuation and the word boundaries the declarations carry squeezed
	// out: `SMRI Growth` for a declared `SM&R Growth Fund` (SM&R Investments,
	// Inc. 2010, 2,389 rows carrying no fund name at all, because a single
	// remaining token is what every rung above refuses). The compaction is read
	// off the registrant's own name, the same brand comes off both sides, and
	// the remainder must then name exactly one DECLARED series.
	if d := issBrandCompactedDecl(ix, key); d != nil {
		return banner, d
	}
	return banner, nil
}

// issCompactKey squeezes a normalised key down to its letters and digits, with
// the `and` normalizeSeriesName writes for `&` dropped: `sm and r investments
// inc` -> `smrinvestmentsinc`. This is the spelling a vendor reaches for when it
// compacts a brand it cannot print, and it is what the heading's lead token is
// measured against.
func issCompactKey(key string) string {
	var b strings.Builder
	for _, t := range strings.Fields(key) {
		if t == "and" {
			continue
		}
		b.WriteString(t)
	}
	return b.String()
}

// issCutCompactedBrand removes from a declared name the leading run of tokens
// whose own compaction opens the heading's compacted lead token: `sm and r
// growth fund` under `smri` gives `growth fund`, because `sm` and then `smr`
// are prefixes of `smri` and `smrgrowth` is not. A run must be consumed and
// something must be left.
func issCutCompactedBrand(declKey, lead string) (string, bool) {
	toks := strings.Fields(declKey)
	consumed, cut := "", 0
	for _, t := range toks {
		next := consumed
		if t != "and" {
			next += t
		}
		if !strings.HasPrefix(lead, next) {
			break
		}
		consumed, cut = next, cut+1
	}
	if consumed == "" || cut == 0 || cut >= len(toks) {
		return "", false
	}
	return strings.Join(toks[cut:], " "), true
}

// issBrandCompactedDecl resolves a heading whose LEAD TOKEN is a compacted form
// of the registrant's own name, with that brand then taken off BOTH sides. The
// lead token must open the registrant's compacted name and must be no token of
// any declared series, so an ordinary first word cannot reach here; the declared
// side must give the same brand up; and what remains must name EXACTLY ONE
// declared series -- exactly, after the trailing type word the heading drops.
//
// Scoped to this filing's own DECLARATIONS and never to the dictionary. SM&R's
// `SM&R Alger Growth Fund` and `SM&R Alger Aggressive Growth Fund` are rows of
// cik_series.tsv at this CIK but are not declared by this filing, and admitting
// them would make `Growth` ambiguous and stamp nothing.
func issBrandCompactedDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 2 {
		return nil
	}
	lead := toks[0]
	comp := issCompactKey(ix.registrantKey)
	if len(lead) < 3 || len(lead) >= len(comp) || !strings.HasPrefix(comp, lead) || issDeclaredToken(ix, lead) {
		return nil
	}
	rest := strings.Join(toks[1:], " ")
	var hit *SeriesDecl
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		stem, ok := issCutCompactedBrand(normalizeSeriesName(d.Name), lead)
		if !ok {
			continue
		}
		if stem != rest && !issBrandCompactedStemMatch(ix, key, rest, stem, d) {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// issBrandCompactedStemMatch is issBrandCompactedDecl's tail comparison once
// the brand is off both sides: the heading's remainder against one declared
// stem. The heading may DROP the declaration's trailing type word, and it may
// print a type word OF ITS OWN in its place -- `GROWTH PORTFOLIO` for a
// declared `SM&R Growth Fund` -- in which case the word comes off both sides.
// The substitution is only read where issTierMismatch already says it is the
// vendor's word rather than a tier the registrant keeps apart, so a two-tier
// trust declaring both words still holds its banners separate.
func issBrandCompactedStemMatch(ix *issSeriesIndex, key, rest, stem string, d *SeriesDecl) bool {
	if dropped, cut := issDropTypeWord(stem); cut && dropped == rest {
		return true
	}
	bare, cut := issDropTypeWord(rest)
	if !cut || issTierMismatch(ix, key, d) {
		return false
	}
	dropped, cut := issDropTypeWord(stem)
	return cut && dropped == bare
}

// issTypoTypeWordDecl reads a heading whose type word the DECLARATION spells
// wrong. The heading must carry a type word of its own, every token before it
// must equal the declaration's exactly, the declaration's last token must NOT
// itself be a type word -- a heading swapping Portfolio for Fund is a different
// registered series, not a typo -- and it must differ from the heading's type
// word by a single character. Exactly one series may answer; two refuse.
// issSubstitutedBrandDecl reads a heading whose LEADING token stands where the
// declared name carries the registrant's own brand, the rest agreeing word for
// word. The declared side's first token must be a brand of this registrant, the
// heading's must differ from it and not be a brand itself, and the remainder
// must name exactly one declared series.
func issSubstitutedBrandDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	isBrand := func(t string) bool {
		for _, b := range ix.brands {
			if b == t {
				return true
			}
		}
		return strings.HasPrefix(ix.registrantKey, t+" ")
	}
	if isBrand(toks[0]) {
		return nil
	}
	d := ix.lessLeadToken[strings.Join(toks[1:], " ")]
	if d == nil {
		return nil
	}
	lead := strings.Fields(normalizeSeriesName(d.Name))
	if len(lead) == 0 || !isBrand(lead[0]) {
		return nil
	}
	return d
}

// issRegistrantBrandSwapDecl is issSubstitutedBrandDecl read for the
// REGISTRANT'S OWN name rather than a heading. The lead token there must not be
// a brand; here it always is -- key IS the registrant key, so its first token
// heads the registrant -- and the question is whether exactly one declaration
// spells the same name under a DIFFERENT lead brand: `TAIWAN GREATER CHINA
// FUND` for a declared `SHELTON GREATER CHINA FUND` (S000034279), the registrant
// renamed between the report and its first series declaration.
//
// The distinctive phrase must survive whole: only the lead token may differ,
// lessLeadToken is nil when two of the CIK's series answer to the remainder
// (the same collision refusal seriesByName makes), and the remainder must name
// two distinct words besides its type word, so a brand swap in front of a bare
// `Equity Fund` never resolves.
func issRegistrantBrandSwapDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	rest := strings.Join(toks[1:], " ")
	if bare, _ := issDropTypeWord(rest); len(strings.Fields(bare)) < 2 {
		return nil
	}
	d := ix.lessLeadToken[rest]
	if d == nil || d.SeriesID == "" {
		return nil
	}
	lead := strings.Fields(normalizeSeriesName(d.Name))
	if len(lead) == 0 || lead[0] == toks[0] {
		return nil
	}
	return d
}

func issTypoTypeWordDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 2 || !issTypeWord(toks[len(toks)-1]) {
		return nil
	}
	head, typ := toks[:len(toks)-1], toks[len(toks)-1]
	var hit *SeriesDecl
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		want := ix.declToks(i)
		if len(want) != len(toks) || issTypeWord(want[len(want)-1]) {
			continue
		}
		agree := true
		for j := range head {
			if head[j] != want[j] {
				agree = false
				break
			}
		}
		if !agree || !issEditDistanceOne(typ, want[len(want)-1]) {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// issLeadingStemDecl reads a heading that keeps a declared name's own leading
// PAIR and replaces the descriptor after it, which is how a registrant that
// names its funds off one family word prints marketing names beside registered
// ones: `Pin Oak Aggressive Stock Fund` for `PIN OAK EQUITY FUND`, `White Oak
// Growth Stock Fund` for `WHITE OAK SELECT GROWTH FUND`.
//
// The guards are what keep this from folding siblings together. The shared run
// must be EXACTLY the first two tokens -- a longer agreement is a name the
// heading edits further in, where a noun swap (`... ex-US Index Portfolio` for a
// declared `... ex-U.S. Index Fund`) is a different registered series and must
// stay blank. The pair's SECOND token must be the second token of at least two
// declared series, so it is the registrant's family word (`Oak`) rather than a
// brand only one fund carries (`Putnam VT Vista Fund` against a declared
// `Putnam VT Capital Appreciation Fund` names a fund of its own). And the pair
// must lead exactly one declared series; two refuse.
func issLeadingStemDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 4 || !issTypeWord(toks[len(toks)-1]) || issTypeWord(toks[1]) {
		return nil
	}
	// The pair must be the fund's own stem, not the registrant's brand plus a
	// descriptor. `AIM GLOBAL ENERGY FUND` leads with the registrant's own `AIM`
	// (AIM INVESTMENT FUNDS), so the only candidate sharing the pair -- `AIM
	// Global Health Care Fund`, S000000235 -- overlaps it on brand tokens alone
	// and names a different fund: all 272 rows of that filing were stamped with
	// it. `Pin Oak Aggressive Stock Fund` leads with `Pin`, which the registrant
	// OAK ASSOCIATES FUNDS does not supply, and still answers.
	if issRegistrantOwnWords(toks[0], ix.registrantKey) {
		return nil
	}
	family, owners := map[string]bool{}, map[string]bool{}
	var hit *SeriesDecl
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		want := ix.declToks(i)
		if len(want) < 3 || want[1] != toks[1] {
			continue
		}
		family[d.SeriesID] = true
		if want[0] != toks[0] {
			continue
		}
		if !issTypeWord(want[len(want)-1]) || want[2] == toks[2] {
			// The agreement runs past the pair; this is not the shape.
			return nil
		}
		if issStyleSiblingSwap(ix, toks[2], want[2]) {
			// The descriptor the heading swaps is the registrant's own STYLE
			// discriminator, so the swap names a DIFFERENT fund rather than a
			// marketing spelling of this one.
			return nil
		}
		owners[d.SeriesID] = true
		hit = d
	}
	if len(family) < 2 || len(owners) != 1 {
		return nil
	}
	if issDictLeadingPairRival(ix, toks, hit.SeriesID) {
		return nil
	}
	return hit
}

// issDictLeadingPairRival reports that the registrant's DICTIONARY names a
// series OTHER than own whose own name leads with the heading's pair -- the
// sibling evidence the two-owner refusal above reads off the header, restored
// where a merger has thinned the header since the sleeve last filed.
//
// John Hancock Variable Insurance Trust (CIK 756913) declared `All Cap Core
// Trust` (S000008242), `All Cap Growth Trust` (S000008243) and `All Cap Value
// Trust` (S000008244) at 20060630; only Core survived to the 2014 header, and
// the filing still prints a section for the Value sleeve's residual votes. With
// one owner left in the header the rung above reads `all cap value` as a
// marketing spelling of `all cap core` and stamps a fund that cast none of
// those votes. The registrant's own dictionary says otherwise: the slot after
// the pair is where this registrant separates three registered series, so a
// heading that swaps it names a DIFFERENT fund and must stay blank -- at which
// point the audited overlay stamps the id the heading actually spells.
func issDictLeadingPairRival(ix *issSeriesIndex, toks []string, own string) bool {
	if cikDict == nil || ix == nil || ix.cik == "" || len(toks) < 3 {
		return false
	}
	for _, d := range cikDict.byCIK[ix.cik] {
		if d.SeriesID == "" || d.SeriesID == own || d.Name == "" {
			continue
		}
		want := strings.Fields(normalizeSeriesName(d.Name))
		if len(want) < 3 || want[0] != toks[0] || want[1] != toks[1] {
			continue
		}
		if !issTypeWord(want[len(want)-1]) {
			continue
		}
		return true
	}
	return false
}

// issStyleWord reports a descriptor registrants use as the STYLE of a sleeve
// rather than as its subject: the word that separates `Large Cap Growth` from
// `Large Cap Value`. Swapping one of these for another never spells the same
// registered fund.
func issStyleWord(w string) bool {
	switch w {
	case "growth", "value", "income", "equity", "bond":
		return true
	}
	return false
}

// issStyleSiblingSwap reports that a and b are both style words AND that this
// registrant separates two of its OWN declared series with exactly that pair --
// two declared names of equal length agreeing everywhere but one slot, one
// carrying a and the other b. VALIC Co II declares `Small Cap Growth Fund`
// beside `Small Cap Value Fund` and `Mid Cap Growth Fund` beside `Mid Cap Value
// Fund`, so `Large Cap Growth Fund` names a sleeve it does not declare and must
// not fold into `Large Cap Value Fund` (S000008030, 563 rows). The declared
// evidence is required: a registrant that uses the word decoratively is
// untouched.
func issStyleSiblingSwap(ix *issSeriesIndex, a, b string) bool {
	if a == b || !issStyleWord(a) || !issStyleWord(b) {
		return false
	}
	return issDeclSlotSwap(ix, a, b)
}

// issSizeWord reports a CAPITALISATION-BAND descriptor: the word that separates
// `Small-Cap Growth` from `Mid-Cap Growth`. The hyphenations registrants print
// fold to these tokens before this is consulted, because normalizeSeriesName
// spaces the hyphen.
func issSizeWord(w string) bool {
	switch w {
	case "small", "mid", "large", "smid", "all":
		return true
	}
	return false
}

// issSizeSiblingSwap is issStyleSiblingSwap for the size band: a and b are both
// size words AND this registrant separates two of its OWN declared series with
// exactly that pair. Delaware Pooled Trust declares `The Large-Cap Growth Equity
// Portfolio` beside `The Mid-Cap Growth Equity Portfolio` and `The Small-Cap
// Growth Equity Portfolio`, which is its own proof that the band discriminates,
// so a heading `The Small-Cap Value Equity Portfolio` names a sleeve it does not
// declare and must not fold onto `The Large-Cap Value Equity Portfolio`
// (S000003931, 938 rows). The declared evidence is required: a registrant that
// uses the word decoratively is untouched.
func issSizeSiblingSwap(ix *issSeriesIndex, a, b string) bool {
	if a == b || !issSizeWord(a) || !issSizeWord(b) {
		return false
	}
	return issDeclSlotSwap(ix, a, b)
}

// issSizeDiscriminator reports that w is a size word this registrant separates
// two of its own declared names by -- the evidence a SPLICE needs, where the
// heading inserts the word and there is no counterpart slot to read it against.
func issSizeDiscriminator(ix *issSeriesIndex, w string) bool {
	if !issSizeWord(w) {
		return false
	}
	for _, b := range [...]string{"small", "mid", "large", "smid", "all"} {
		if issSizeSiblingSwap(ix, w, b) {
			return true
		}
	}
	return false
}

// issStyleDiscriminator is issSizeDiscriminator for the style band: w is a
// style word this registrant separates two of its own declared names by, the
// evidence a SPLICE needs where the heading inserts the word and there is no
// counterpart slot to read it against.
func issStyleDiscriminator(ix *issSeriesIndex, w string) bool {
	if !issStyleWord(w) {
		return false
	}
	for _, b := range [...]string{"growth", "value", "income", "equity", "bond"} {
		if issStyleSiblingSwap(ix, w, b) {
			return true
		}
	}
	return false
}

// issDeclSlotSwap reports that two declared names of DIFFERENT series run the
// same length, agree on every token but one, and carry a and b in that slot.
func issDeclSlotSwap(ix *issSeriesIndex, a, b string) bool {
	for i := range ix.decls {
		x := ix.declToks(i)
		for j := range ix.decls {
			if ix.decls[i].SeriesID == ix.decls[j].SeriesID {
				continue
			}
			y := ix.declToks(j)
			if len(x) != len(y) {
				continue
			}
			diff, at := 0, -1
			for k := range x {
				if x[k] != y[k] {
					diff, at = diff+1, k
				}
			}
			if diff == 1 && x[at] == a && y[at] == b {
				return true
			}
		}
	}
	return false
}

// issTrailingAcronymDecl reads a heading whose trailing words a declared name
// spells out and the heading prints as their initials. The heading's leading
// tokens must equal the declared name's exactly, the acronym must carry at least
// two letters and stand for that many trailing declared words, and exactly one
// series of this registrant may answer -- two candidates refuse.
func issTrailingAcronymDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 2 {
		return nil
	}
	acr := toks[len(toks)-1]
	head := toks[:len(toks)-1]
	if len(acr) < 2 || len(acr) > 4 {
		return nil
	}
	var hit *SeriesDecl
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		want := ix.declToks(i)
		if len(want) != len(head)+len(acr) {
			continue
		}
		agree := true
		for j := range head {
			if head[j] != want[j] {
				agree = false
				break
			}
		}
		if !agree {
			continue
		}
		for j, w := range want[len(head):] {
			if w == "" || w[0] != acr[j] {
				agree = false
				break
			}
		}
		if !agree {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// issCutAbbreviatedRegistrantPrefix cuts the registrant's own leading words off
// a heading that shortens them: each cut token must be the registrant's token or
// a prefix of it of at least three characters, at least two tokens come off, at
// least one of them is shortened -- the unshortened form is the exact strip's
// business -- and two tokens must survive. The cut is made on the PRINTED
// banner, so the remainder keeps the punctuation the later rules read; a leading
// word that does not fold to exactly one token is not cut at all.
func issCutAbbreviatedRegistrantPrefix(banner, registrantKey string) (string, bool) {
	rt := strings.Fields(registrantKey)
	printed := strings.Fields(banner)
	kt := make([]string, len(printed))
	for i, t := range printed {
		kt[i] = normalizeSeriesName(t)
	}
	if len(rt) < 2 || len(kt) < 4 {
		return "", false
	}
	short, n := false, 0
	for n < len(rt) && n < len(kt)-2 {
		if kt[n] == rt[n] {
			n++
			continue
		}
		if len(kt[n]) >= 3 && len(kt[n]) < len(rt[n]) && strings.HasPrefix(rt[n], kt[n]) {
			short = true
			n++
			continue
		}
		break
	}
	if n < 2 || !short {
		return "", false
	}
	return strings.Join(printed[n:], " "), true
}

// issSleeveStemDecl resolves a heading whose type word sits INSIDE it, with a
// sleeve qualifier trailing: the stem through the type word must appear, in
// order, inside exactly one declared name, and the stem must carry a word of its
// own besides the type word. Uniqueness is enforced by the scan rather than
// borrowed from the index, so a stem two declared names answer stamps nothing.
func issSleeveStemDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	cut := -1
	for i := 1; i < len(toks)-1; i++ {
		switch toks[i] {
		case "fund", "portfolio", "trust", "account":
			cut = i
		}
	}
	if cut < 1 {
		return nil
	}
	stem := toks[:cut+1]
	// A trailing ORDINAL is not a sleeve qualifier: `AIM PREMIER EQUITY FUND II`
	// is the registrant's second sleeve of that name, and dropping the `II` to
	// reach the declared `AIM Premier Equity Fund` (S000000216) filed 114 rows
	// under the sleeve the same filing prints and resolves on its own banner.
	// No declared name of this registrant carries the ordinal at any vintage, so
	// there is nothing to resolve to and the heading is refused.
	ordinal := ""
	if tail := toks[cut+1:]; len(tail) == 1 && issRomanNumeral(tail[0]) {
		ordinal = tail[0]
	}
	var found *SeriesDecl
	for name, d := range ix.byName {
		if d == nil {
			continue
		}
		cand := strings.Fields(name)
		k, skipAt := 0, -1
		for _, t := range cand {
			if k < len(stem) && t == stem[k] {
				k++
				continue
			}
			if skipAt < 0 {
				skipAt = k
			}
		}
		if k != len(stem) {
			continue
		}
		// The declared name carries a word INSIDE the stem that the heading does
		// not, and the heading's own stem up to that word is one this registrant
		// declares other sleeves under: `MML SMALL CAP EQUITY FUND` reaches
		// `MML Small Cap Growth Equity Fund` (S000003827) only by passing over
		// `GROWTH`, while the same CIK declares `MML Small Cap Value Fund` and
		// `MML Small Cap Index Fund`. The word passed over is what tells those
		// sleeves apart, so the heading names a different fund and is refused.
		if skipAt >= 2 && issStemHasSibling(ix, stem[:skipAt], d.SeriesID) {
			return nil
		}
		if ordinal != "" && !issHasToken(name, ordinal) {
			return nil
		}
		// The mirror reading is refused the same way: the DECLARED name ends on
		// an ordinal the heading never prints (`THE REAL ESTATE INVESTMENT TRUST
		// PORTFOLIO` for the declared `... PORTFOLIO II`, Delaware Pooled Trust
		// 2004, whose filing prints the `II` section separately and 286 rows of
		// the untruncated section under it).
		if ordinal == "" && len(cand) > 1 && issRomanNumeral(cand[len(cand)-1]) {
			continue
		}
		if found != nil && found.SeriesID != d.SeriesID {
			return nil
		}
		found = d
	}
	return found
}

// issFundLabelHead reports whether a heading's pre-colon head is one of the
// labels a cover sheet names its fund with, folded the same way series names are
// so `Fund/Fund Family Name` and `Fund Family Name` read alike.
func issFundLabelHead(head string) bool {
	key := normalizeSeriesName(head)
	if key == "" {
		return false
	}
	for _, l := range brFundLabels {
		if key == normalizeSeriesName(l) {
			return true
		}
	}
	return false
}

// issSpliceMinWords is the shortest declared name issSplicedDecl will read a
// heading as a superset of, and issSpliceExtraWords the most the heading may add.
const (
	issSpliceMinWords   = 3
	issSpliceExtraWords = 3
)

// issSplicedDecl resolves a heading that is one declared name with extra words
// inserted, and nothing else. Uniqueness is enforced here rather than borrowed
// from the exact index, because the candidate set is scanned: a heading that is a
// superset of two declared names stamps nothing.
func issSplicedDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	heading := strings.Fields(key)
	if len(heading) < issSpliceMinWords+1 {
		return nil
	}
	registrant := map[string]bool{}
	for _, t := range strings.Fields(ix.registrantKey) {
		registrant[t] = true
	}
	var found *SeriesDecl
	var refused []string
	for name, d := range ix.byName {
		if d == nil {
			continue
		}
		want := strings.Fields(name)
		if len(want) < issSpliceMinWords || len(heading) <= len(want) || len(heading)-len(want) > issSpliceExtraWords {
			continue
		}
		// The declared name must START the heading, so the words the heading
		// adds are internal or trailing. Anything ahead of it may only be the
		// registrant's OWN tokens, which every other rung here is already free
		// to strip: `Growth Emerging Markets Value Fund` must not read as a
		// declared `Emerging Markets Value Fund`, while `Claymore/Zacks Yield
		// Hog ETF` may drop its registrant's `Claymore`.
		at := indexOfToken(heading, want[0])
		if at < 0 {
			continue
		}
		branded := true
		for _, t := range heading[:at] {
			if !registrant[t] {
				branded = false
				break
			}
		}
		if !branded || !isOrderedSubsequence(want, heading[at:]) {
			continue
		}
		// A conjunction the declared name does not carry joins a SECOND
		// objective onto the fund's name rather than decorating the declared
		// one: `DREYFUS FOUNDERS GROWTH AND INCOME FUND` is a different
		// registered fund from the declared `Dreyfus Founders Growth Fund`
		// (S000000567), not that name with words spliced in, and stamping it
		// moved 866 rows onto a sibling series.
		if indexOfToken(heading, "and") >= 0 && indexOfToken(want, "and") < 0 {
			continue
		}
		// A trailing ORDINAL the declared name does not carry names a SECOND
		// sleeve of that name rather than decorating the first: `AIM PREMIER
		// EQUITY FUND II` against the declared `AIM Premier Equity Fund`
		// (S000000216), which the same filing prints and resolves on its own
		// banner. The registrant declares no `II` sleeve at any vintage, so the
		// heading names nothing and 114 rows carried a fund they do not name.
		if last := heading[len(heading)-1]; issRomanNumeral(last) && indexOfToken(want, last) < 0 {
			continue
		}
		// An inserted SIZE word is the registrant's own discriminator rather
		// than decoration: `The International Large-Cap Equity Portfolio`
		// splices `large cap` into the declared `The International Equity
		// Portfolio` (S000003944), whose section this same filing prints under
		// its own banner. 655 rows carried a fund they do not name.
		// An inserted STYLE word reads on the same evidence: `SIMT MID-CAP
		// GROWTH FUND` splices `growth` into the declared `SIMT MID CAP FUND`
		// (S000006675), whose own section this same filing prints, while the
		// registrant separates its own declared siblings by exactly that word
		// (`SIMT SMALL CAP GROWTH FUND` beside `SIMT SMALL CAP VALUE FUND`).
		// 1,891 rows sat on that hazard.
		sized, styled := false, false
		for _, t := range subsequenceExtras(want, heading[at:]) {
			if issSizeDiscriminator(ix, t) {
				sized = true
				break
			}
			if issStyleDiscriminator(ix, t) {
				styled = true
			}
		}
		if sized {
			continue
		}
		if styled {
			refused = append(refused, d.SeriesID)
			continue
		}
		// A run inserted immediately BEHIND the declared name's first token,
		// opening with a word this registrant declares nowhere, sits in the
		// slot a sponsor names its sub-adviser in, and that is the sleeve's
		// discriminator rather than decoration: `PF AIM AGGRESSIVE GROWTH FUND`
		// splices `aim aggressive` straight behind the `PF` of a declared `PF
		// Growth Fund` (S000001906), whose contemporary spelling `PF JANUS
		// GROWTH LT FUND` the same filing prints under its own banner and
		// stamps with that id. This registrant names every sleeve by
		// sub-adviser (`PF VAN KAMPEN ...`, `PF OPPENHEIMER ...`), and `aim`
		// appears in no declared name at the CIK, so the heading names a sleeve
		// the registrant does not declare; 486 rows carried one it does. The
		// surviving NAME must also be one the registrant adopted after this
		// filing: `Baron Capital Partners Fund Series` splices the sponsor's
		// house word into a contemporary `BARON PARTNERS FUND` and is the same
		// fund, so the sub-adviser reading is taken only where the stem is a
		// later rename the section cannot have been printed under.
		if at+1 < len(heading) && heading[at+1] != want[1] && !registrant[heading[at+1]] &&
			!issDeclaredToken(ix, heading[at+1]) && issFutureVintageName(ix, d) {
			refused = append(refused, d.SeriesID)
			continue
		}
		if found != nil && found.SeriesID != d.SeriesID {
			return nil // two declared names sit inside this heading; refuse to pick
		}
		found = d
	}
	// A candidate the guards above threw out still proves the heading is not
	// unambiguous: refusing it must never PROMOTE a sibling that the ambiguity
	// rule was already suppressing.
	for _, id := range refused {
		if found != nil && found.SeriesID != id {
			return nil
		}
	}
	// A heading the registrant's OWN dictionary spells EXACTLY, for a series
	// other than the one the splice lands on, is that series printed under its
	// registered name -- not a sibling's name with words inserted. John Hancock
	// Variable Insurance Trust 2014 heads a section `2A60 Mid Cap Value Equity
	// Trust`, character for character the declared name of S000008288, which its
	// own 2013 header declares and its 2014 header simply omits; the splice
	// reads `Mid Value Trust` (S000008289) out of it across the inserted `cap`
	// and `equity`, and that sibling prints its own `6743 Mid Value` banner and
	// its own rows in the same filing. An exact registered name is evidence of a
	// different order from a tolerance, so it wins here the way it wins at the
	// top of the chain -- and stamping it in the resolver rather than leaving the
	// row blank keeps a merely-audited overlay row from pre-empting it.
	if found != nil {
		if x := cikDict.registrantExactName(ix.cik, key, ix.period); x != nil && x.SeriesID != found.SeriesID {
			return x
		}
	}
	return found
}

// indexOfToken returns the position of the first whole token equal to want, or -1.
func indexOfToken(tokens []string, want string) int {
	for i, t := range tokens {
		if t == want {
			return i
		}
	}
	return -1
}

// isOrderedSubsequence reports whether every token of want appears in have, in
// order, on whole-token equality.
func isOrderedSubsequence(want, have []string) bool {
	i := 0
	for _, t := range have {
		if i < len(want) && want[i] == t {
			i++
		}
	}
	return i == len(want)
}

// subsequenceExtras returns the tokens of have that the ordered-subsequence
// match against want does not consume -- the words a splice INSERTED.
func subsequenceExtras(want, have []string) []string {
	i := 0
	var extra []string
	for _, t := range have {
		if i < len(want) && want[i] == t {
			i++
			continue
		}
		extra = append(extra, t)
	}
	return extra
}

// issGeographyInflectionDecl retries the key with one geography noun replaced by
// its adjective form. Confined to the observed inflections; the retry goes back
// through the whole chain, so an ambiguous retry still stamps nothing.
func issGeographyInflectionDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	inflect := map[string]string{"europe": "european", "asia": "asian", "america": "american"}
	f := strings.Fields(key)
	var out *SeriesDecl
	for i, t := range f {
		adj, ok := inflect[t]
		if !ok {
			continue
		}
		alt := append(append([]string{}, f[:i]...), append([]string{adj}, f[i+1:]...)...)
		_, d := issResolveFund(ix, strings.Join(alt, " "))
		if d == nil {
			continue
		}
		if out != nil && out.SeriesID != d.SeriesID {
			return nil
		}
		out = d
	}
	return out
}

// issExpandSmid rewrites a whole `smid` token as the two tokens `small mid`,
// which is what the registered name spells: `SMID Cap` is `SMALL/MID CAP` and
// the '/' is already a separator. Only a whole token is rewritten, so no word
// carrying those letters is touched, and only the first is, since a name never
// prints the contraction twice.
func issExpandSmid(key string) (string, bool) {
	f := strings.Fields(key)
	for i, t := range f {
		if t != "smid" {
			continue
		}
		alt := append(append([]string{}, f[:i]...), append([]string{"small", "mid"}, f[i+1:]...)...)
		return strings.Join(alt, " "), true
	}
	return "", false
}

// issInternalAcronymDecl reads a heading that spells OUT an adviser name the
// declaration prints as an acronym. The declared name's tokens must equal the
// heading's exactly but for ONE token, which must be the initials of two or more
// consecutive heading tokens standing in its place; exactly one series of this
// registrant may answer, and a second refuses.
func issInternalAcronymDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	var hit *SeriesDecl
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		want := ix.declToks(i)
		if len(want) < 2 || len(want) >= len(toks) {
			continue
		}
		n := len(toks) - len(want) + 1 // heading tokens the acronym stands for
		if n < 2 {
			continue
		}
		for j := range want {
			if len(want[j]) != n || !issIsAcronymOf(want[j], toks[j:j+n]) {
				continue
			}
			agree := true
			for k := 0; agree && k < j; k++ {
				agree = want[k] == toks[k]
			}
			for k := j + 1; agree && k < len(want); k++ {
				agree = want[k] == toks[k+n-1]
			}
			if !agree {
				continue
			}
			if hit != nil && hit.SeriesID != d.SeriesID {
				return nil
			}
			hit = d
		}
	}
	return hit
}

// issIsAcronymOf reports whether acr's runes are, in order, the first rune of
// each of toks.
func issIsAcronymOf(acr string, toks []string) bool {
	r := []rune(acr)
	if len(r) != len(toks) {
		return false
	}
	for i, t := range toks {
		if t == "" || []rune(t)[0] != r[i] {
			return false
		}
	}
	return true
}

// issInternalTokenDropDecl drops exactly one token that is neither the first nor
// the last of the key and retries the exact index. The first token carries the
// brand and the last the type word, so neither is ever cut here; two drops
// naming different series are a refusal.
// issDictInsertedWordDecl reads a heading the header does not declare against
// the registrant's DICTIONARY, where the dictionary spells the same fund with
// one extra word before its terminal type word: `AQR Emerging Momentum Fund`
// for a dictionary `AQR Emerging Momentum Style Fund` (S000045145), the type
// word the 2015 renaming inserted across the whole family.
//
// It exists to REFUSE the header reading, not to widen it. Without it the
// heading resolves by discarding its own `Emerging` onto the declared, shorter
// `AQR Momentum Fund` (S000025643) -- 632 rows of one fund filed under a
// sibling. A candidate that lacks a distinctive word the heading prints names a
// different fund, so it is no answer at all; the dictionary name, which carries
// every word of the heading, is.
//
// The guards: the heading and the dictionary name agree token for token but for
// ONE word the dictionary inserts before its type word, exactly one dictionary
// series may answer, the header must not declare the heading itself, and the
// header's own candidate must actually be missing a distinctive heading word --
// a candidate that carries them all stands.
func issDictInsertedWordDecl(ix *issSeriesIndex, dict *dictFallback, banner string, cur *SeriesDecl) *SeriesDecl {
	if dict == nil {
		return nil
	}
	key := normalizeSeriesName(banner)
	toks := strings.Fields(key)
	if len(toks) < 3 || !issTypeWord(toks[len(toks)-1]) {
		return nil
	}
	if _, declared := lookupSeriesEntry(ix.byName, banner); declared {
		return nil
	}
	var hit *SeriesDecl
	var hitToks []string
	for name, d := range dict.byName {
		want := strings.Fields(name)
		if len(want) != len(toks)+1 || !issTypeWord(want[len(want)-1]) {
			continue
		}
		// The inserted word sits immediately before the type word; every other
		// token, the type word included, must agree exactly.
		agree := want[len(want)-1] == toks[len(toks)-1]
		for j := 0; agree && j < len(toks)-1; j++ {
			agree = want[j] == toks[j]
		}
		if !agree {
			continue
		}
		if d == nil || (hit != nil && hit.SeriesID != d.SeriesID) {
			return nil
		}
		hit, hitToks = d, want
	}
	if hit == nil || (cur != nil && cur.SeriesID == hit.SeriesID) {
		return nil
	}
	if cur == nil {
		return hit
	}
	// The header's candidate stands unless it is missing a word the heading and
	// the dictionary name both print.
	curKey := normalizeSeriesName(cur.Name)
	for _, t := range toks {
		if len(t) >= issDistinctiveTokenMin && issHasToken(strings.Join(hitToks, " "), t) && !issHasToken(curKey, t) {
			return hit
		}
	}
	return nil
}

// issDroppedTokenNamesSibling reports that a token a subset-token rung dropped
// is spelled in ANOTHER declared name of this registrant, under a series other
// than the hit's. Dropping it is then a CHOICE between two of the registrant's
// series rather than the removal of a decoration, which is family MISLINK2's
// principle read off the registrant's own vocabulary instead of a word list:
// AXP GROWTH SERIES' `AXP QUANTITATIVE LARGE CAP EQUITY FUND` dropped
// `quantitative` onto `RiverSource Large Cap Equity Fund` (S000003289) while the
// same registrant spells that token in `Columbia Large Core Quantitative Fund`
// (S000003287), and the filing prints `AXP LARGE CAP EQUITY FUND` as a separate
// banner -- 1,684 rows carrying the plain sleeve's series.
//
// The token must be distinctive on its own terms: a type word, a registrant
// token and anything shorter than issDistinctiveTokenMin are shared vocabulary
// and say nothing about which series is meant.
func issDroppedTokenNamesSibling(ix *issSeriesIndex, tok string, hit *SeriesDecl) bool {
	if hit == nil || hit.SeriesID == "" || len(tok) < issDistinctiveTokenMin || issTypeWord(tok) {
		return false
	}
	if issHasToken(ix.registrantKey, tok) {
		return false
	}
	for i := range ix.decls {
		if ix.decls[i].SeriesID == "" || ix.decls[i].SeriesID == hit.SeriesID {
			continue
		}
		if i < len(ix.normNames) && issHasToken(ix.normNames[i], tok) {
			return true
		}
	}
	return false
}

func issInternalTokenDropDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	f := strings.Fields(key)
	if len(f) < 3 {
		return nil
	}
	var out *SeriesDecl
	for i := 1; i < len(f)-1; i++ {
		alt := append(append([]string{}, f[:i]...), f[i+1:]...)
		d, _ := lookupSeriesEntry(ix.byName, strings.Join(alt, " "))
		if d == nil {
			continue
		}
		if issDroppedTokenNamesSibling(ix, f[i], d) {
			return nil
		}
		if out != nil && out.SeriesID != d.SeriesID {
			return nil
		}
		out = d
	}
	return out
}

// issHyphenGluedRegistrantPrefix cuts a hyphen-glued prefix built entirely from
// the registrant's own tokens, returning the remainder.
func issHyphenGluedRegistrantPrefix(banner, registrantKey string) (string, bool) {
	return issRegistrantPrefixAt(banner, registrantKey, '-')
}

// issColonRegistrantPrefix is the same cut where the filing separates the
// registrant from the fund with a colon: `MERCURY MASTER TRUST: MERRILL LYNCH
// MASTER INTERNATIONAL PORTFOL` for a declared `Merrill Lynch Master
// International Portfolio` (S000002289, 1,414 rows). The remainder goes back
// through the whole chain, so the banner-width truncation is read there.
func issColonRegistrantPrefix(banner, registrantKey string) (string, bool) {
	return issRegistrantPrefixAt(banner, registrantKey, ':')
}

// issRegistrantOwnWords reports a heading fragment built entirely from the
// registrant's own name tokens, which therefore names no series of its own.
func issRegistrantOwnWords(s, registrantKey string) bool {
	reg := map[string]bool{}
	for _, t := range strings.Fields(registrantKey) {
		reg[strings.Trim(t, ".,")] = true
	}
	f := strings.Fields(normalizeSeriesName(s))
	if len(reg) == 0 || len(f) == 0 {
		return false
	}
	for _, t := range f {
		if !reg[strings.Trim(t, ".,")] {
			return false
		}
	}
	return true
}

// issRegistrantInitialism reports whether tok is the initials of the
// registrant's own leading tokens, in order and with none skipped: `ml` for
// `merrill lynch variable series funds inc`. Two letters at least, and the
// initialism may not consume the whole registrant name.
func issRegistrantInitialism(tok, registrantKey string) bool {
	tok = strings.ToLower(tok)
	if len(tok) < 2 {
		return false
	}
	reg := strings.Fields(registrantKey)
	if len(tok) >= len(reg) {
		return false
	}
	for i := 0; i < len(tok); i++ {
		if reg[i] == "" || reg[i][0] != tok[i] {
			return false
		}
	}
	return true
}

// issCutInitialsAndWordRun deletes a leading run made of the registrant's own
// INITIALISM and its own words together -- `svs ii scudder` for `scudder
// variable series ii`. key and registrantKey are already normalised.
//
// The initialism is what makes the run the registrant's: a run of plain
// registrant words alone is `john hancock trust` on a John Hancock Variable
// Insurance Trust heading, which names the registrant's FORMER self and may be
// cut only once the header declares that former name, and `state street` on a
// State Street heading, whose remainder differs from a declared name by a noun.
// Both are specified to stamp nothing. So the run must carry at least one
// initialism AND at least one of the registrant's own words, and must leave two
// tokens behind.
func issCutInitialsAndWordRun(key, registrantKey string) (string, bool) {
	regToks := issRegistrantTokens(registrantKey)
	if len(regToks) == 0 {
		return "", false
	}
	toks := strings.Fields(key)
	n, acronyms, words := 0, 0, 0
	for ; n < len(toks); n++ {
		switch {
		case issRegistrantInitialism(toks[n], registrantKey):
			acronyms++
		case regToks[toks[n]]:
			words++
		default:
		}
		if acronyms+words != n+1 {
			break
		}
	}
	if acronyms == 0 || words == 0 || len(toks)-n < 2 {
		return "", false
	}
	return strings.Join(toks[n:], " "), true
}

// issCutRegistrantWordRun deletes a leading run of the registrant's own PLAIN
// words, with no initialism among them -- `scudder vit` for `scudder
// investments vit funds`. It returns the remainder and the run's tokens; the
// caller decides on the run, since the run alone is no evidence (see
// issDeclOmitsRun). Two tokens must remain.
func issCutRegistrantWordRun(key, registrantKey string) (string, []string, bool) {
	regToks := issRegistrantTokens(registrantKey)
	if len(regToks) == 0 {
		return "", nil, false
	}
	toks := strings.Fields(key)
	n, named := 0, false
	for ; n < len(toks); n++ {
		// The LEADING token alone may be one of those words truncated:
		// `SCUD` for `SCUDDER`. It names the registrant exactly as the full
		// spelling does, so the run cuts it the same way.
		if n == 0 && !regToks[toks[n]] && issRegistrantWordTruncation(toks[n], registrantKey) {
			named = true
			continue
		}
		if !regToks[toks[n]] {
			break
		}
		if !issEntityTypeWord(toks[n]) {
			named = true
		}
	}
	// A run of the registrant's generic type words alone is no brand:
	// `Trust Banking Fund` for RYDEX VARIABLE TRUST is a declared `Banking
	// Fund` with a stray noun, not a prefixed heading.
	if n == 0 || !named || len(toks)-n < 2 {
		return "", nil, false
	}
	return strings.Join(toks[n:], " "), toks[:n], true
}

// issEntityTypeWord reports whether tok is a generic fund-entity noun rather
// than a name of its own.
func issEntityTypeWord(tok string) bool {
	switch tok {
	case "fund", "funds", "portfolio", "portfolios", "trust", "trusts",
		"account", "accounts", "series", "company", "inc", "the":
		return true
	}
	return false
}

// issDeclOmitsRun reports whether the declaration d spells NONE of the run's
// words. That is what makes cutting a run of plain registrant words safe: when
// the declaration carries one of them, the heading and the declaration differ
// INSIDE the name rather than by a prefix, which is the `john hancock trust
// Balanced Trust` former-name case (`trust`) and the `state street ... Index
// Portfolio` noun swap (`state street`), both specified to stamp nothing.
func issDeclOmitsRun(d *SeriesDecl, run []string) bool {
	if d == nil {
		return false
	}
	declToks := make(map[string]bool)
	for _, t := range strings.Fields(normalizeSeriesName(d.Name)) {
		declToks[t] = true
	}
	for _, t := range run {
		if declToks[t] {
			return false
		}
	}
	return true
}

// issCutRegistrantBrandRun reads a leading run that opens with one of the
// registrant's own naming words and then carries words that are NOT the
// registrant's -- a master trust's brand on a feeder's account name. Every cut
// point is tried against the whole chain and the one type-token retry, and only
// a remainder resolving to a declaration that spells none of the run's words
// counts; cut points disagreeing about the series refuse.
func issCutRegistrantBrandRun(ix *issSeriesIndex, key, registrantKey string) *SeriesDecl {
	regToks := issRegistrantTokens(registrantKey)
	if len(regToks) == 0 {
		return nil
	}
	toks := strings.Fields(key)
	if len(toks) < 4 || !regToks[toks[0]] || issEntityTypeWord(toks[0]) {
		return nil
	}
	// A heading that spells the registrant's name WHOLE in front of the fund
	// has already said which words are the registrant's, so nothing behind them
	// is a brand run: `THE TRAVELERS SERIES TRUST - SOCIAL AWARENESS STOCK
	// PORTFOLIO` (Travelers Series Trust 2004, 1,119 rows) cuts `social` and
	// then `awareness` as foreign words and hands `stock portfolio` to
	// lessLeadToken, which answers from the declared `Federated Stock
	// Portfolio` -- the fund the SAME filing heads in its own separate section.
	// The heading minus exactly the registrant prefix is the fund's own name,
	// so it must resolve on its own or the prefixed heading resolves to
	// nothing; any invented name ending in a declared name's trailing words
	// reaches that declaration otherwise.
	if rest, ok := issCutRegistrantPrefix(key, registrantKey); ok {
		if _, d := issResolveFund(ix, rest); d == nil {
			return nil
		}
	}
	var found *SeriesDecl
	for n := 2; n <= len(toks)-2; n++ {
		run := toks[:n]
		foreign := false
		for _, t := range run[1:] {
			if !regToks[t] {
				foreign = true
			}
		}
		if !foreign {
			continue
		}
		rest := strings.Join(toks[n:], " ")
		d := issBrandRunRemainder(ix, rest, run)
		if d == nil {
			continue
		}
		if found != nil && found.SeriesID != d.SeriesID {
			return nil
		}
		found = d
	}
	return found
}

// issBrandRunRemainder resolves one cut point's remainder, retrying once
// without a trailing type word, and keeps only a declaration omitting the run.
//
// The run is cut unread, so it is a subset-token drop in family MISLINK2's
// sense and carries that family's guard: a run word naming ANOTHER series of
// this registrant refuses. AXP GROWTH SERIES' `AXP QUANTITATIVE LARGE CAP
// EQUITY FUND` cuts the run `axp quantitative` and resolves the remainder to
// `RiverSource Large Cap Equity Fund` (S000003289) -- which the filing already
// prints as its own banner `AXP LARGE CAP EQUITY FUND` -- while the registrant
// spells `quantitative` in `Columbia Large Core Quantitative Fund`
// (S000003287). 1,684 rows carried the plain sleeve's series.
func issBrandRunRemainder(ix *issSeriesIndex, rest string, run []string) *SeriesDecl {
	keep := func(d *SeriesDecl) bool {
		if !issDeclOmitsRun(d, run) {
			return false
		}
		for _, t := range run {
			if issDroppedTokenNamesSibling(ix, t, d) {
				return false
			}
		}
		return true
	}
	if _, d := issResolveFund(ix, rest); keep(d) {
		return d
	}
	if stem, typed := issDropTypeWord(rest); typed && stem != "" {
		if _, d := issResolveFund(ix, stem); keep(d) {
			return d
		}
	}
	return nil
}

func issRegistrantPrefixAt(banner, registrantKey string, sep rune) (string, bool) {
	regToks := make(map[string]bool)
	for _, t := range strings.Fields(registrantKey) {
		regToks[strings.Trim(t, ".,")] = true
	}
	if len(regToks) == 0 {
		return "", false
	}
	for i, r := range banner {
		if r != sep {
			continue
		}
		head, rest := strings.TrimSpace(banner[:i]), strings.TrimSpace(banner[i+1:])
		f := strings.Fields(normalizeSeriesName(head))
		if len(f) < 2 || rest == "" || len(strings.Fields(rest)) < 2 {
			continue
		}
		ok := true
		for j, t := range f {
			t = strings.Trim(t, ".,")
			if regToks[t] {
				continue
			}
			// The registrant's own leading tokens INITIALISED: `ML VARIABLE
			// SERIES FUNDS, INC.:` for `Merrill Lynch Variable Series Funds Inc`
			// (355916, 7,368 rows with no series). Only the head token may be
			// the initialism, and every remaining token is still the
			// registrant's own, so this never cuts a prefix the registrant does
			// not spell.
			if j == 0 && issRegistrantInitialism(t, registrantKey) {
				continue
			}
			ok = false
			break
		}
		if ok {
			return rest, true
		}
	}
	return "", false
}

// issFutureVintage reports a declaration made AFTER this filing's period of
// report. When the header declares nothing, cikSeries.back backfills the
// registrant's dictionary rows -- carrying their own DeclDate -- into
// meta.SeriesDecls, and from there a row declared years later is
// indistinguishable from a header declaration. That is not evidence about this
// filing, and the rungs below read only PART of the heading, so nothing in the
// printed bytes can contradict it: `Selected Accounts: Scout Equity Index` on a
// 20040630 filing reached `Scout Equity Opportunity Fund` (S000044604, declared
// only at 20140630) on the pair `scout equity`, stamping 3,486 rows.
//
// Deliberately narrow in two ways. The exact-name rungs stay unguarded: the
// same registrant's 20050630 filing resolves `UMB Scout Stock Fund` and `UMB
// Scout Growth Fund` against 20060630 dictionary rows by name in full, and
// those stamps are right. And post-dating the period is not enough on its own,
// because series identifiers themselves begin in 2006: every pre-2006 filing's
// dictionary rows post-date it, and the earliest vintage a registrant carries
// says nothing about when the sleeve existed. The series must ALSO be absent
// from that earliest vintage -- declared later than rows this same registrant
// already has -- which is what separates `Scout Equity Opportunity Fund`
// (S000044604, this registrant's only 20140630 row, against siblings from
// 20060630) from `DWS Capital Growth VIP` (S000006245, 20060630, the earliest
// vintage its registrant has at all, reached from a 20050630 filing).
func issFutureVintage(ix *issSeriesIndex, d *SeriesDecl) bool {
	if d == nil || len(ix.period) != 8 {
		return false
	}
	first, earliest := "", ""
	for i := range ix.decls {
		x := &ix.decls[i]
		if len(x.DeclDate) != 8 {
			// An undated decl is one the filing's own header printed. A
			// series this filing declares existed when it was filed, so that
			// declaration vetoes any later vintage a folded dictionary alias
			// carries for the same id.
			if x.SeriesID == d.SeriesID {
				return false
			}
			continue
		}
		if earliest == "" || x.DeclDate < earliest {
			earliest = x.DeclDate
		}
		if x.SeriesID == d.SeriesID && (first == "" || x.DeclDate < first) {
			first = x.DeclDate
		}
	}
	return first != "" && first > ix.period && first > earliest
}

// issFutureVintageName is issFutureVintage one level finer: the SERIES may be
// contemporary with the filing while the particular NAME a rung matched is a
// later rename. `PF Growth Fund` is a 20150630 rename of S000001906, whose
// 20060630 spelling `PF JANUS GROWTH LT FUND` is the banner a 20040630 filing
// prints; a rung reading only part of a heading has nothing in the printed
// bytes to contradict the later alias. As with issFutureVintage an undated
// (header) declaration of the same id vetoes, and the alias must post-date the
// registrant's own earliest vintage as well as the period.
func issFutureVintageName(ix *issSeriesIndex, d *SeriesDecl) bool {
	if d == nil || len(ix.period) != 8 || len(d.DeclDate) != 8 || d.DeclDate <= ix.period {
		return false
	}
	earliest := ""
	for i := range ix.decls {
		x := &ix.decls[i]
		if len(x.DeclDate) != 8 {
			if x.SeriesID == d.SeriesID {
				return false
			}
			continue
		}
		if earliest == "" || x.DeclDate < earliest {
			earliest = x.DeclDate
		}
	}
	return earliest != "" && d.DeclDate > earliest
}

// issWidthTruncatedDecl reads a heading the report cut off at its banner width:
// the key must be a proper prefix of exactly ONE declared name, ending inside a
// word rather than at a token boundary, so a heading that is merely a shorter
// name than another is never widened onto it.
func issWidthTruncatedDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	f := strings.Fields(key)
	if len(f) < 3 || len(key) < 20 || len(f[len(f)-1]) < 3 {
		return nil
	}
	var hit *SeriesDecl
	for i := range ix.decls {
		dk := ix.declNorm(i)
		g := strings.Fields(dk)
		if len(g) != len(f) {
			continue
		}
		last := g[len(g)-1]
		if last == f[len(f)-1] || !strings.HasPrefix(last, f[len(f)-1]) {
			continue
		}
		if strings.Join(g[:len(g)-1], " ") != strings.Join(f[:len(f)-1], " ") {
			continue
		}
		if hit != nil && hit.SeriesID != ix.decls[i].SeriesID {
			return nil
		}
		hit = &ix.decls[i]
	}
	if issFutureVintage(ix, hit) {
		return nil
	}
	return hit
}

// issAbbrevStemDecl reads a heading that abbreviates the tail of a declared name
// and then names the sleeve reporting it: `Agg Growth LB Pax World` for a
// declared `ESG Managers Aggressive Growth Portfolio` (S000027263, 20,380 rows
// of Pax World Funds Series Trust I with no series).
//
// The heading's LEADING k tokens (two at least, and never the whole heading)
// must match the declared name's trailing k tokens once its type word is
// dropped, each token spelled exactly or abbreviated in order, and at least one
// genuinely abbreviated -- an all-exact tail match is an ordinary prefix and
// belongs to the rules above. Exactly one series may answer across every k, so
// `Growth`, `Moderate` and `Conservative`, which head three sibling
// portfolios, stamp nothing.
func issAbbrevStemDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	var hit *SeriesDecl
	for k := 2; k < len(toks); k++ {
		for i := range ix.decls {
			d := &ix.decls[i]
			if d.SeriesID == "" || d.Name == "" {
				continue
			}
			stem, typed := issDropTypeWord(ix.declNorm(i))
			if !typed {
				continue
			}
			dt := strings.Fields(stem)
			if len(dt) <= k {
				continue
			}
			dt = dt[len(dt)-k:]
			abbrev := false
			ok := true
			for j := 0; j < k; j++ {
				switch {
				case toks[j] == dt[j]:
				case issAbbreviatesStem(toks[j], dt[j]):
					abbrev = true
				default:
					ok = false
				}
				if !ok {
					break
				}
			}
			if !ok || !abbrev {
				continue
			}
			if hit != nil && hit.SeriesID != d.SeriesID {
				return nil
			}
			hit = d
		}
	}
	if issFutureVintage(ix, hit) {
		return nil
	}
	return hit
}

// issOwnInitialsMinAcronym is the shortest initialism issOwnInitialsSleeveDecl
// will read as a declared portfolio's own short code. Three letters at least,
// so a two-word declared name cannot manufacture one out of a class letter.
const issOwnInitialsMinAcronym = 3

// issOwnInitialsSleeveDecl resolves a heading that abbreviates ONE declared
// name of this registrant to its own initials and then names a sleeve of it:
// `AST QMP PGIMQS International Core Equity`, `AST QMP PGIMQS S&P5 Index
// Sleeve` and `AST QMP PGIMQS Large Cap Core LTE` for the declared `AST
// Quantitative Modeling Portfolio` (S000031888, Advanced Series Trust
// 20220630), where QMP is the portfolio's own initials and PGIMQS the
// subadviser's short code. The same registrant's 20230630 filing spells the
// identical sleeves out (`AST Quantitative Modeling Portfolio International
// Core Equity`) and resolves through issSleeveStemDecl.
//
// The evidence is the registrant's own header: the heading and the declared
// name must agree on a leading run of whole tokens (the family brand, `AST`),
// the very next heading token must be the initials of ALL the declared name's
// remaining tokens, and a sleeve qualifier must follow it. Exactly one declared
// series may answer -- two refuse -- so nothing here can choose between two
// funds whose short codes coincide.
func issOwnInitialsSleeveDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	var hit *SeriesDecl
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		dt := ix.declToks(i)
		p := 0
		for p < len(dt) && p < len(toks) && dt[p] == toks[p] {
			p++
		}
		// A shared leading token at least (the registrant's own brand, which
		// is what ties the abbreviation to this family), the abbreviated token
		// itself, and a sleeve qualifier behind it.
		if p < 1 || p > len(toks)-2 || len(dt)-p < 2 {
			continue
		}
		acr := issInitials(dt[p:])
		if len(acr) < issOwnInitialsMinAcronym || acr != toks[p] {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	if issFutureVintage(ix, hit) {
		return nil
	}
	return hit
}

// issAbbreviatesStem is issAbbreviates with the three-character stems a fund
// family clips its own portfolio names to (`Agg` for `Aggressive`).
func issAbbreviatesStem(short, long string) bool {
	if len(short) == 3 && len(long) > 3 && strings.HasPrefix(long, short) {
		return true
	}
	return issAbbreviates(short, long)
}

// issNearMissMinDrop and issNearMissMinEdit are the shortest token issNearMiss
// may drop and the shortest it may repair. Four and five characters are what
// keep a class letter, a numeral, a Roman suffix or a two-word type token out
// of the rule: `Fund A` and `Fund B` are different funds and differ by one
// character, and nothing here may ever read one as the other.
const (
	issNearMissMinDrop = 4
	issNearMissMinEdit = 5
)

// issNearMissDecl reads a heading that names one series of this registrant with
// a single typographic slip: at most one interior token of the declared name
// missing, and at most one token differing by one character.
//
// Measured shapes: `Goldman Sachs Future Real Estate and Infrastructure Equitiy
// ETF` (255 rows), `Goldman Sachs Equal Weight U.S. Large Cap ETF` for a
// declared `... Large Cap Equity ETF` (6,949 rows, the dropped word alone),
// `AMG Managers Guardian Capital Global Divdend Fund` (958 rows) and
// `MASSMUTUAL AGGRESIVE GROWTH FUND` for a declared `MassMutual Select
// Aggressive Growth Fund` (3,873 rows, both slips at once).
//
// Every other token must match EXACTLY, and exactly one series of this
// registrant may answer -- two candidates refuse, because choosing between them
// would move one fund's votes onto another. This runs last, so a heading any
// exact or described-edit rule above reads is never reinterpreted here.
func issNearMissDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	banner := strings.Fields(key)
	if len(banner) < 3 {
		return nil
	}
	// The registrant's OWN name is never a fund. `First Investors Life Series
	// Fund` is one dropped token from the declared `First Investors Life Series
	// Discovery Fund`, and reading it as that fund files the whole filing's
	// votes under one of its sub-funds.
	if key == ix.registrantKey {
		return nil
	}
	var hit *SeriesDecl
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		if !issNearMiss(banner, ix.declToks(i)) {
			continue
		}
		// The slip was a DROPPED interior token, and the heading's own stem up
		// to that token is a stem this registrant declares OTHER sleeves under:
		// `MML SMALL CAP EQUITY FUND` reaches `MML Small Cap Growth Equity Fund`
		// (S000003827) only by dropping `GROWTH`, while the same CIK declares
		// `MML Small Cap Value Fund` and `MML Small Cap Index Fund` and the same
		// filing prints and resolves the Growth banner exactly. The dropped word
		// is what tells the sleeves apart, so this is a different fund, not a
		// typo. The stem must run past the leading brand token -- a drop right
		// behind the brand (`MASSMUTUAL AGGRESIVE GROWTH FUND` for a declared
		// `MassMutual Select Aggressive Growth Fund`) shares nothing but the
		// family name and stays readable.
		if j := issNearMissDropAt(banner, ix.declToks(i)); j >= 2 && issStemHasSibling(ix, banner[:j], d.SeriesID) {
			return nil
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	if issFutureVintage(ix, hit) {
		return nil
	}
	return hit
}

// issNearMissDropAt is the interior position of decl that issNearMiss dropped to
// read banner, or -1 when the two agree without a drop.
func issNearMissDropAt(banner, decl []string) int {
	if len(decl)-len(banner) != 1 {
		return -1
	}
	for j := 1; j < len(decl)-1; j++ {
		if len(decl[j]) < issNearMissMinDrop {
			continue
		}
		cut := append(append([]string{}, decl[:j]...), decl[j+1:]...)
		if issOneTokenEdit(banner, cut) {
			return j
		}
	}
	return -1
}

// issStemHasSibling reports that some series of this registrant OTHER than id is
// declared under a name beginning with stem, token for token.
func issStemHasSibling(ix *issSeriesIndex, stem []string, id string) bool {
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || d.SeriesID == id || d.Name == "" {
			continue
		}
		toks := ix.declToks(i)
		if len(toks) <= len(stem) {
			continue
		}
		same := true
		for k := range stem {
			if toks[k] != stem[k] {
				same = false
				break
			}
		}
		if same {
			return true
		}
	}
	return false
}

// issNearMiss reports whether banner reads as decl after at most one INTERIOR
// token of decl is dropped. The first and last tokens are never dropped: the
// brand at the front and the type word at the end are the two places a cut
// collapses distinct funds onto each other.
func issNearMiss(banner, decl []string) bool {
	switch len(decl) - len(banner) {
	case 0:
		return issOneTokenEdit(banner, decl)
	case 1:
		for j := 1; j < len(decl)-1; j++ {
			if len(decl[j]) < issNearMissMinDrop {
				continue
			}
			cut := append(append([]string{}, decl[:j]...), decl[j+1:]...)
			if issOneTokenEdit(banner, cut) {
				return true
			}
		}
	}
	return false
}

// issOneTokenEdit reports two token runs of equal length that agree everywhere
// but at most one position, and there by a single character.
func issOneTokenEdit(a, b []string) bool {
	diff := -1
	for i := range a {
		if a[i] == b[i] {
			continue
		}
		if diff >= 0 {
			return false
		}
		diff = i
	}
	if diff < 0 {
		return true
	}
	x, y := a[diff], b[diff]
	if len(x) < issNearMissMinEdit || len(y) < issNearMissMinEdit {
		return false
	}
	return issEditDistanceOne(x, y)
}

// issCutNearMissBrand cuts a leading brand the heading MISSPELLS: the brand must
// carry at least two tokens, exactly one of the heading's leading tokens may
// differ from the brand's, and it must differ by a single character. A one-token
// brand is not admitted -- a single near word is not evidence that the
// registrant named itself -- and the remainder must still hold two tokens.
func issCutNearMissBrand(key, brand string) (string, bool) {
	bt := strings.Fields(brand)
	kt := strings.Fields(key)
	if len(bt) < 2 || len(kt) < len(bt)+2 {
		return "", false
	}
	diff := -1
	for i, t := range bt {
		if kt[i] == t {
			continue
		}
		if diff >= 0 {
			return "", false
		}
		diff = i
	}
	if diff < 0 {
		return "", false // an exact brand; the exact rules already read it
	}
	x, y := kt[diff], bt[diff]
	if len(x) < 3 || len(y) < 3 || !issEditDistanceOne(x, y) {
		return "", false
	}
	return strings.Join(kt[len(bt):], " "), true
}

// issEditDistanceOne reports one character inserted, deleted or substituted.
func issEditDistanceOne(x, y string) bool {
	if len(x) > len(y) {
		x, y = y, x
	}
	if len(y)-len(x) > 1 {
		return false
	}
	i := 0
	for i < len(x) && x[i] == y[i] {
		i++
	}
	if i == len(x) {
		// Nothing differs before the end of the shorter token: equal strings, or
		// one character appended.
		return len(y)-len(x) == 1
	}
	if len(x) == len(y) {
		return x[i+1:] == y[i+1:]
	}
	return x[i:] == y[i+1:]
}

// issDistinctiveTokenMin is the shortest token that may count as distinctive,
// and issDistinctiveMinPool the smallest vocabulary it may be distinctive
// AGAINST. A token carried by exactly one of two declared names is not rare, it
// is merely one of them: with a small pool every word of every name qualifies
// and the rule degenerates into a substring match. Goldman Sachs ETF Trust,
// where this was measured, declares 69.
const (
	issDistinctiveTokenMin = 5
	issDistinctiveMinPool  = 10
	// A PAIR is rarer than a single token and may answer against a smaller
	// vocabulary, but not against a handful of names: with two or three declared
	// series any two adjacent words of one of them are "distinctive", and the
	// rule would supply the swapped noun and the wrong type word that the
	// refuse-to-guess rules exist to withhold.
	issDistinctivePairMinPool = 6
	// The floor the SHORTER word of a pair must clear. The pair as a whole
	// still needs one word of issDistinctiveTokenMin, so `managed core` counts
	// and a pair of two short words does not.
	issDistinctivePairTokenMin = 4
)

// issSleeveRegionWord is the geography vocabulary that distinguishes one index
// sleeve of a family from another rather than describing it. A sleeve's region
// is never a qualifier the heading may drop: `Maxim Index European` and `Maxim
// Index Pacific` are not the declared `Maxim Index 600 Portfolio`.
var issSleeveRegionWord = map[string]bool{
	"europe": true, "european": true, "pacific": true, "asia": true,
	"asian": true, "japan": true, "japanese": true, "international": true,
	"emerging": true, "latin": true, "america": true, "american": true,
	"global": true, "china": true, "chinese": true, "india": true,
	"uk": true, "germany": true, "france": true, "korea": true,
	"canada": true, "canadian": true, "world": true, "domestic": true,
	"us": true, "usa": true, "eafe": true, "euro": true, "nordic": true,
	"brazil": true, "russia": true, "taiwan": true, "hong": true,
	"kong": true, "singapore": true, "australia": true, "mexico": true,
	"north": true, "south": true, "east": true, "west": true,
	"africa": true, "greater": true, "overseas": true, "worldwide": true,
}

// issNumericToken reports a token that is all digits -- the `400` of `Maxim
// Index 400` against the `600` of `Maxim Index 600 Portfolio`.
func issNumericToken(t string) bool {
	if t == "" {
		return false
	}
	for _, r := range t {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// issSleeveTokenContradiction reports that the heading and the candidate
// declared name differ, on either side, by a NUMBER or a region word. A rung
// that resolves on a SUBSET of the heading's tokens must refuse such a hit: the
// tokens it dropped do not merely go unmentioned by the declared name, they
// name a DIFFERENT sleeve of the same family. The adjacent pair `maxim index`
// sits in exactly one declared name of Maxim Series Fund, so the pair rung
// stamped `Maxim Index 400`, `Maxim Index European` and `Maxim Index Pacific`
// all with `Maxim Index 600 Portfolio`'s S000023741 -- 3,464 rows of one 2004
// filing carrying a series that is not theirs.
func issSleeveTokenContradiction(toks []string, name string) bool {
	head := map[string]bool{}
	for _, t := range toks {
		head[t] = true
	}
	decl := map[string]bool{}
	for _, t := range strings.Fields(normalizeSeriesName(name)) {
		decl[t] = true
	}
	sleeveMark := func(t string) bool {
		// A trailing ORDINAL tells sleeves of one family apart exactly as a
		// number does: `THE REAL ESTATE INVESTMENT TRUST PORTFOLIO` reaches the
		// declared `... PORTFOLIO II` on the vocabulary rungs, while Delaware
		// Pooled Trust's 2004 filing prints the `II` section separately.
		return issNumericToken(t) || issRomanNumeral(t) || issSleeveRegionWord[t]
	}
	for t := range head {
		if !decl[t] && sleeveMark(t) {
			return true
		}
	}
	for t := range decl {
		if !head[t] && sleeveMark(t) {
			return true
		}
	}
	return false
}

// issDistinctiveTokenDecl reads a heading printing the fund's name at the time
// of the report against a declared name that has since changed:
// `Goldman Sachs ActiveBeta Paris-Align Climate U.S. Low Vol Plus Equity ETF`
// for a declared `Goldman Sachs ActiveBeta(R) Paris-Aligned Climate U.S. Large
// Cap Equity ETF` (S000074467, 4,173 rows) differs in three places at once --
// the mark dropped, `Align` for `Aligned`, `Low Vol Plus` for `Large Cap` --
// so no single edit reaches it.
//
// The evidence is the registrant's own vocabulary: a token of five characters
// or more that exactly ONE of this registrant's series carries. TWO such tokens
// must agree (`Paris` and `Climate` here) and none may point elsewhere, so a
// heading sharing one rare word with a sibling fund stamps nothing. The two are
// DISTINCT words: a title repeating one rare word (`... REGISTERED MANAGEMENT
// INVESTMENT COMPANY INVESTMENT COMPANY ACT ...`) is one piece of evidence, not
// two, and scored as occurrences it stamped a whole Fidelity filing wrongly.
func issDistinctiveTokenDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	pool := map[string]bool{}
	for i := range ix.decls {
		if ix.decls[i].SeriesID != "" && ix.decls[i].Name != "" {
			pool[ix.decls[i].SeriesID] = true
		}
	}
	if len(pool) < issDistinctiveMinPool {
		return nil
	}
	var hit *SeriesDecl
	agree := 0
	seen := map[string]bool{}
	for _, t := range toks {
		if len(t) < issDistinctiveTokenMin || seen[t] {
			continue
		}
		seen[t] = true
		var owner *SeriesDecl
		ids := map[string]bool{}
		for i := range ix.decls {
			d := &ix.decls[i]
			if d.SeriesID == "" || d.Name == "" {
				continue
			}
			if !issHasToken(ix.declNorm(i), t) {
				continue
			}
			owner = d
			ids[d.SeriesID] = true
		}
		if len(ids) != 1 {
			continue
		}
		if hit != nil && hit.SeriesID != owner.SeriesID {
			return nil
		}
		hit = owner
		agree++
	}
	if agree < 2 {
		return nil
	}
	if hit != nil && issSleeveTokenContradiction(toks, hit.Name) {
		return nil
	}
	if issFutureVintage(ix, hit) {
		return nil
	}
	return hit
}

// issDistinctiveStemDecl reads the MARKETING name of a fund, which keeps the
// declared name's distinctive stem but re-orders and re-words everything around
// it: `The Golden Rainbow/A James Advised Mutual Fund` for a declared `James
// Balanced: Golden Rainbow Fund` (S000003560, James Advantage Funds 2015, 1,574
// rows with no series). Token containment in order fails -- the banner adds
// `The`, `A`, `Advised` and `Mutual`, drops `Balanced`, and puts the brand
// behind a slash -- so the adjacent stem is the only evidence left.
//
// It is issDistinctivePairDecl's reading with the pool floor traded for a
// stricter stem: BOTH words must reach issDistinctiveTokenMin (the pair rule
// admits one short word), neither may be a type word, and exactly one declared
// series may carry the stem adjacent and in order. Those floors are what let it
// answer on a two-series header, where the pair rule refuses: `small cap` and
// `mid cap` cannot reach it at all.
func issDistinctiveStemDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	var hit *SeriesDecl
	seen := map[string]bool{}
	for i := 0; i+1 < len(toks); i++ {
		// The marketing name LEADS with the stem, behind an article at most:
		// `The Golden Rainbow/...`. A stem buried mid-heading is one qualifier
		// among many and the ordinary rules own it.
		if i > 1 || (i == 1 && toks[0] != "the" && toks[0] != "a" && toks[0] != "an") {
			break
		}
		stem := toks[i] + " " + toks[i+1]
		if len(toks[i]) < issDistinctiveTokenMin || len(toks[i+1]) < issDistinctiveTokenMin || seen[stem] {
			continue
		}
		if issTypeWord(toks[i]) || issTypeWord(toks[i+1]) {
			continue
		}
		seen[stem] = true
		var owner *SeriesDecl
		ownerAt := -1
		ids := map[string]bool{}
		for j := range ix.decls {
			d := &ix.decls[j]
			if d.SeriesID == "" || d.Name == "" {
				continue
			}
			if !strings.Contains(" "+ix.declNorm(j)+" ", " "+stem+" ") {
				continue
			}
			owner, ownerAt = d, j
			ids[d.SeriesID] = true
		}
		if len(ids) != 1 {
			continue
		}
		if !issStemOrderInverted(toks, i, ix.declNorm(ownerAt)) {
			continue
		}
		if hit != nil && hit.SeriesID != owner.SeriesID {
			return nil
		}
		hit = owner
	}
	if hit != nil && issSleeveTokenContradiction(toks, hit.Name) {
		return nil
	}
	if issFutureVintage(ix, hit) {
		return nil
	}
	return hit
}

// issStemOrderInverted reports that the banner prints the stem at toks[i:i+2]
// on the OTHER side of a word it shares with the declared name than the
// declared name does. That inversion is what separates a marketing name from a
// heading that merely drops or adds a qualifier: `PGIM Ultra Short Fund` keeps
// the declared word order and must stay refused, while `The Golden
// Rainbow/A James Advised Mutual Fund` puts `james` behind the stem where the
// declared `James Balanced: Golden Rainbow Fund` puts it in front.
func issStemOrderInverted(toks []string, i int, declKey string) bool {
	decl := strings.Fields(declKey)
	di := -1
	for j := 0; j+1 < len(decl); j++ {
		if decl[j] == toks[i] && decl[j+1] == toks[i+1] {
			di = j
			break
		}
	}
	if di < 0 {
		return false
	}
	for bj, t := range toks {
		if bj == i || bj == i+1 || len(t) < issDistinctivePairTokenMin || issTypeWord(t) {
			continue
		}
		dj := indexOfToken(decl, t)
		if dj < 0 || dj == di || dj == di+1 {
			continue
		}
		if (bj < i) != (dj < di) {
			return true
		}
	}
	return false
}

// issTwoSidedLeadSwap reports whether the heading and the declared name a rare
// pair reached agree word for word EXCEPT in their lead slot, with neither
// name spelling the other's lead anywhere. That is one lead token off the
// declared side and one off the heading side at once, which leaves no
// distinctive lead word shared between them: the pair alone is then the whole
// of the evidence and any invented lead answers the same id.
//
// The heading is read bare and with the registrant's own leading run cut, so a
// banner that prints the trust's name in front is refused on the same reading.
func issTwoSidedLeadSwap(ix *issSeriesIndex, toks []string, key string, hit *SeriesDecl) bool {
	declKey := normalizeSeriesName(hit.Name)
	wants := [][]string{strings.Fields(declKey)}
	if bare, typed := issDropTypeWord(declKey); typed && bare != "" {
		wants = append(wants, strings.Fields(bare))
	}
	heads := [][]string{toks}
	if rest, ok := strings.CutPrefix(key, ix.registrantKey+" "); ok && rest != "" {
		heads = append(heads, strings.Fields(rest))
	}
	for _, b := range ix.brands {
		if rest, ok := issCutBrand(key, b); ok && rest != "" {
			heads = append(heads, strings.Fields(rest))
		}
	}
	for _, want := range wants {
		if len(want) < 2 {
			continue
		}
		for _, head := range heads {
			if len(head) != len(want) || head[0] == want[0] {
				continue
			}
			same := true
			for k := 1; k < len(head); k++ {
				if head[k] != want[k] {
					same = false
					break
				}
			}
			if same && indexOfToken(want, head[0]) < 0 && indexOfToken(head, want[0]) < 0 {
				return true
			}
		}
	}
	return false
}

// issDistinctivePairDecl reads the same historical-name shape as
// issDistinctiveTokenDecl where the rare evidence is an ADJACENT ORDERED PAIR
// rather than two separate words: `NATIONS MARSICO GROWTH FUND MASTER` carries
// no word that only one declared series has (`marsico` is on four of them,
// `growth` on two), but the pair `marsico growth` occurs, in order and adjacent,
// in exactly one declared name (`Columbia Marsico Growth Master Portfolio`,
// S000010833).
//
// A pair is at least as discriminating as the two single tokens the token rule
// demands, which is why it also answers below issDistinctiveMinPool: `premier
// selections` reaches `Legg Mason Partners Variable Premier Selections All Cap
// Growth Portfolio` (S000010847) in a registrant declaring seven series. Both
// words must run issDistinctiveTokenMin characters, exactly one series may carry
// the pair, and two pairs naming different series refuse rather than choose.
func issDistinctivePairDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	pool := map[string]bool{}
	for i := range ix.decls {
		if ix.decls[i].SeriesID != "" && ix.decls[i].Name != "" {
			pool[ix.decls[i].SeriesID] = true
		}
	}
	if len(pool) < issDistinctivePairMinPool {
		return nil
	}
	var hit *SeriesDecl
	seen := map[string]bool{}
	for i := 0; i+1 < len(toks); i++ {
		pair := toks[i] + " " + toks[i+1]
		// A pair is at least as discriminating as two separate tokens, so the
		// length floor binds on ONE of its words rather than both: `managed
		// core` reaches `Janus Adviser INTECH Risk-Managed Core Fund`
		// (S000010562) where `core` alone never could.
		short, long := len(toks[i]), len(toks[i+1])
		if short > long {
			short, long = long, short
		}
		if short < issDistinctivePairTokenMin || long < issDistinctiveTokenMin || seen[pair] {
			continue
		}
		// A pair whose second word is the vehicle's TYPE word is the suffix of
		// most names in the pool, not rare evidence: `growth fund` reached the
		// declared `Putnam Small Cap Growth Fund` (S000000777) for a heading
		// `Putnam Growth Fund` printed as its own account in the same filing,
		// reporting two funds as one series.
		if issTypeWord(toks[i+1]) {
			continue
		}
		seen[pair] = true
		var owner *SeriesDecl
		ids := map[string]bool{}
		for j := range ix.decls {
			d := &ix.decls[j]
			if d.SeriesID == "" || d.Name == "" {
				continue
			}
			if !strings.Contains(" "+ix.declNorm(j)+" ", " "+pair+" ") {
				continue
			}
			owner = d
			ids[d.SeriesID] = true
		}
		if len(ids) != 1 {
			continue
		}
		if hit != nil && hit.SeriesID != owner.SeriesID {
			return nil
		}
		hit = owner
	}
	// A conjunction the declared name does not carry joins a SECOND objective
	// onto the fund: the pair `founders growth` sits in exactly one declared
	// name, but the heading `DREYFUS FOUNDERS GROWTH AND INCOME FUND` names a
	// fund this registrant never declared, and stamping it moved 866 rows onto
	// the sibling `Dreyfus Founders Growth Fund` (S000000567).
	if hit != nil && indexOfToken(toks, "and") >= 0 &&
		indexOfToken(strings.Fields(normalizeSeriesName(hit.Name)), "and") < 0 {
		return nil
	}
	// The heading and the name it reached run the same length and differ in ONE
	// slot, and that slot is the registrant's own SIZE band: `The Small-Cap Value
	// Equity Portfolio` reaches `The Large-Cap Value Equity Portfolio`
	// (S000003931) on the pair `value equity`, and the same filing prints the
	// large-cap section under its own banner, so the two cannot be one fund.
	if hit != nil {
		want := strings.Fields(normalizeSeriesName(hit.Name))
		if len(want) == len(toks) {
			diff, at := 0, -1
			for k := range toks {
				if toks[k] != want[k] {
					diff, at = diff+1, k
				}
			}
			if diff == 1 && issSizeSiblingSwap(ix, toks[at], want[at]) {
				return nil
			}
		}
	}
	// ONE lead token may come off the declared side or off the heading side,
	// never both: `THE TRAVELERS SERIES TRUST - LAZARD INTERNATIONAL STOCK
	// PORTFOLIO` reaches the declared `Mondrian International Stock Portfolio`
	// (S000011157) on the pair `international stock`, and the filing prints
	// `Mondrian` nowhere. With the declared lead dropped and a lead word of the
	// heading's own put in its place the two names share no distinctive lead
	// word, and an invented one (`QQQ INTERNATIONAL STOCK PORTFOLIO`) reaches
	// the same id. The heading is read bare and with the registrant's own
	// leading run cut, so the prefixed banner is refused on the same reading.
	if hit != nil && issTwoSidedLeadSwap(ix, toks, key, hit) {
		return nil
	}
	// One side names an ETF and the other a fund: `Fidelity Real Estate High
	// Income Fund II` reaches Fidelity Covington Trust's `Fidelity Real Estate
	// Investment ETF` (S000070235) on the pair `fidelity real` alone, filing a
	// 2004 high-yield fund's votes under a 2020 ETF. Fund, portfolio, trust and
	// series are the registrant's own spellings of one vehicle and a pair may
	// still read across them; an exchange-traded fund is a different vehicle and
	// a rare pair is no evidence that the heading meant it.
	if hit != nil {
		h := indexOfToken(toks, "etf") >= 0
		d := indexOfToken(strings.Fields(normalizeSeriesName(hit.Name)), "etf") >= 0
		if h != d {
			return nil
		}
	}
	// A TRAILING ORDINAL is the whole of what a heading says beyond the pair:
	// `AIM PREMIER EQUITY FUND II` carries the pair `premier equity` in exactly
	// one declared name, `AIM Premier Equity Fund` (S000000216) -- which is a
	// DIFFERENT sleeve, printed and resolved on its own banner in the same
	// filing. Dropping the ordinal filed 114 rows under it. The registrant
	// declares no `II` sleeve, so there is nothing to resolve to and the heading
	// is refused.
	if hit != nil {
		last := toks[len(toks)-1]
		if issRomanNumeral(last) && !issHasToken(normalizeSeriesName(hit.Name), last) {
			return nil
		}
	}
	if hit != nil && issSleeveTokenContradiction(toks, hit.Name) {
		return nil
	}
	if issFutureVintage(ix, hit) {
		return nil
	}
	return hit
}

// issClassWordDecl reads a heading that prints a CLASS word behind the series
// name: `M     NY Tax Free Money Fund Investment` for the declared `NY Tax Free
// Money Fund` (S000032033), whose only class is `Investment Class` (DWS Money
// Market Trust 2016, the whole filing's 16 rows). The trailing word must be a
// word of that same series' own <CLASS-CONTRACT-NAME>, the remainder must be
// the series name EXACTLY, and two series answering refuse: the sibling here is
// `Tax Free Money Fund Investment`, which the heading is not, since it carries
// the `NY` the sibling lacks.
func issClassWordDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	last := toks[len(toks)-1]
	if len(last) < issNearMissMinDrop || issTypeWord(last) {
		return nil
	}
	stem := strings.Join(toks[:len(toks)-1], " ")
	var hit *SeriesDecl
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || normalizeSeriesName(d.Name) != stem {
			continue
		}
		carries := false
		for _, cn := range d.ClassNames {
			if issHasToken(normalizeSeriesName(cn), last) {
				carries = true
				break
			}
		}
		if !carries {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// issMaxReorgBannerLines is how far the reorganization banner may wrap: the
// measured shapes run to three lines, the successor clause reaching the second
// and the effective date the third.
const issMaxReorgBannerLines = 3

// issReorganizationBanner reads the sentence a filing prints over the section of
// a fund that merged away, and returns the predecessor and successor names,
// normalised: `VOTES BY FRANKLIN MULTI-INCOME TRUST PRIOR TO THE REORGANIZATION
// WITH FRANKLIN INCOME FUND A SERIES OF FRANKLIN CUSTODIAN FUNDS, INC.
// EFFECTIVE AUGUST 4, 2005`. The sentence wraps, so the lines are joined before
// matching, and the successor clause runs on into `A SERIES OF <registrant>` or
// the effective date, either of which ends the name.
func issReorganizationBanner(lines []string, i int) (pred, succ string, ok bool) {
	joined := strings.TrimSpace(lines[i])
	if !strings.HasPrefix(strings.ToUpper(joined), "VOTES BY ") {
		return "", "", false
	}
	for j := i + 1; j < len(lines) && j <= i+issMaxReorgBannerLines-1; j++ {
		next := strings.TrimSpace(lines[j])
		if next == "" {
			break
		}
		joined += " " + next
	}
	up := strings.ToUpper(joined)
	head, tail, cut := strings.Cut(up, " PRIOR TO THE REORGANIZATION WITH ")
	if !cut {
		return "", "", false
	}
	pred = normalizeSeriesName(strings.TrimPrefix(head, "VOTES BY "))
	for _, end := range []string{" A SERIES OF ", " EFFECTIVE "} {
		if k := strings.Index(tail, end); k >= 0 {
			tail = tail[:k]
		}
	}
	succ = normalizeSeriesName(tail)
	if pred == "" || succ == "" {
		return "", "", false
	}
	return pred, succ, true
}

// issLastTypeWord is the last type word a normalised name prints, or "" when it
// prints none. It is the last rather than the trailing token because a heading
// may carry a class or sequence marker behind it (`... Fund II`).
func issLastTypeWord(toks []string) string {
	for i := len(toks) - 1; i >= 0; i-- {
		if issTypeWord(toks[i]) {
			return toks[i]
		}
	}
	return ""
}

// issRegistrantAbbrevSuffix folds an abbreviated registrant brand back into a
// heading: `sti classic international equity fund va` for the registrant `sti
// classic variable trust` becomes `sti classic variable trust international
// equity fund`. The heading must open on the registrant's own leading tokens and
// close on a token abbreviating the first word the heading dropped (`va` for
// `variable`), so only this registrant's own name is ever restored.
// issTrustOwnName reports whether a heading is the registrant's own name while
// the header declares more than one series, in which case the heading names the
// trust and cannot pick a fund out of it.
func issTrustOwnName(ix *issSeriesIndex, banner string) bool {
	if normalizeSeriesName(banner) != ix.registrantKey || ix.registrantKey == "" {
		return false
	}
	ids := map[string]bool{}
	for _, d := range ix.decls {
		ids[d.SeriesID] = true
	}
	return len(ids) > 1
}

// issRegistrantAcronym reports whether tok spells the initials of every token
// of registrantKey, in order: `gvit` for `gartmore variable insurance trust`.
// Three letters at least, so a two-word registrant cannot be spelled by a word
// that merely happens to start with the right letters.
func issRegistrantAcronym(tok, registrantKey string) bool {
	reg := strings.Fields(registrantKey)
	if len(tok) < 3 || len(tok) != len(reg) {
		return false
	}
	for i := range reg {
		if reg[i] == "" || reg[i][0] != tok[i] {
			return false
		}
	}
	return true
}

// issCutBrandBeforeAcronym drops the leading tokens a banner prints in front of
// the registrant's own acronym, keeping the acronym and everything after it. At
// most two tokens may be dropped -- a sub-adviser's brand, not a name.
func issCutBrandBeforeAcronym(key, registrantKey string, formerKeys []string) (string, bool) {
	toks := strings.Fields(key)
	for j := 1; j < len(toks) && j <= 2; j++ {
		for _, rk := range append([]string{registrantKey}, formerKeys...) {
			if issRegistrantAcronym(toks[j], rk) {
				return strings.Join(toks[j:], " "), true
			}
		}
	}
	return "", false
}

func issRegistrantAbbrevSuffix(key, registrantKey string) (string, bool) {
	toks, reg := strings.Fields(key), strings.Fields(registrantKey)
	if len(toks) < 3 || len(reg) < 2 {
		return "", false
	}
	suffix := toks[len(toks)-1]
	toks = toks[:len(toks)-1]
	shared := 0
	for shared < len(toks) && shared < len(reg) && toks[shared] == reg[shared] {
		shared++
	}
	if shared == 0 || shared >= len(reg) || shared >= len(toks) {
		return "", false
	}
	dropped := reg[shared]
	if len(suffix) < 2 || len(suffix) >= len(dropped) || !strings.HasPrefix(dropped, suffix) {
		return "", false
	}
	return registrantKey + " " + strings.Join(toks[shared:], " "), true
}

// issCutProxyVotingSuffix removes the document's own title from the end of a
// heading that appends it to the fund name.
func issCutProxyVotingSuffix(key string) (string, bool) {
	for _, suffix := range []string{" proxy voting record", " proxy voting"} {
		if head, ok := strings.CutSuffix(key, suffix); ok && len(strings.Fields(head)) >= 2 {
			return head, true
		}
	}
	return "", false
}

// issCutReportingPeriodTail removes a reporting-period phrase printed after the
// fund name on the same heading line.
func issCutReportingPeriodTail(key string) (string, bool) {
	for _, marker := range []string{" for the period ", " for the fiscal year ", " for the year ", " reporting period "} {
		if i := strings.Index(key, marker); i > 0 {
			head := strings.TrimSpace(key[:i])
			if len(strings.Fields(head)) >= 2 {
				return head, true
			}
		}
	}
	return "", false
}

// issDropTrailingConjunct removes the `and <words>` run that sits before a
// declared name's type word: `powershares dynamic hardware and consumer
// electronics portfolio` becomes `powershares dynamic hardware portfolio`. Two
// tokens at least must survive in front of the `and`, so a name that is itself a
// conjunction (`growth and income fund`) never collapses to `growth fund`.
func issDropTrailingConjunct(key string) (string, bool) {
	stem, typed := issDropTypeWord(key)
	if !typed {
		return "", false
	}
	full := strings.Fields(key)
	typeWord := full[len(full)-1]
	toks := strings.Fields(stem)
	for i := len(toks) - 2; i >= 2; i-- {
		if toks[i] == "and" {
			return strings.Join(toks[:i], " ") + " " + typeWord, true
		}
	}
	return "", false
}

// issAbbrevWordDecl reads a heading that abbreviates a word of a declared name
// and spells every other token exactly: `PowerShares Dynamic Telecom & Wireless
// Portfolio` for a declared `... Telecommunications & Wireless Portfolio`
// (S000003051, 284 rows), `Brandes Institutional Intl Equity Fund` for `...
// International Equity Fund` (S000005855, 1,021 rows), `FIRST AMERICAN MID CAP
// GRWTH OPP FUND` for `First American Mid Cap Growth Opportunities Fund`
// (S000005553, 588 rows).
//
// The abbreviation must share the declared word's first letter, be strictly
// shorter and appear in it in order -- `Intl` inside `International`. Two
// abbreviated words at most, so a heading still spells the majority of the
// declared name exactly. Exactly one series of this registrant may answer;
// two candidates refuse rather than move one fund's votes onto another.
func issAbbrevWordDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	var hit *SeriesDecl
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		dt := ix.declToks(i)
		if len(dt) != len(toks) {
			continue
		}
		diff := 0
		for j := range toks {
			if toks[j] == dt[j] {
				continue
			}
			diff++
			if diff > 2 || !issAbbreviates(toks[j], dt[j]) {
				diff = -1
				break
			}
		}
		// Two abbreviated words at most, and the exactly-spelled tokens must
		// still outnumber them, so a three-word heading never reaches a
		// declared name on one exact token.
		if diff < 1 || len(toks)-diff < diff+1 {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// issHyphenInitialismDecl reads a heading that prints a HYPHENATED word of a
// declared name as its initialism and spells every other token exactly: `Essex
// LC Growth Fund` for a declared `Managers AMG Funds - Essex Large-Cap Growth
// Fund` (S000009872, 429 rows). Only a run the declared name itself joins with
// a hyphen may contract, so the declared side supplies the evidence that the
// two words are one word; the declared name's leading registrant brand comes
// off first, since the heading never prints it. Exactly one series may answer;
// two candidates refuse rather than move one fund's votes onto another.
func issHyphenInitialismDecl(ix *issSeriesIndex, key string) *SeriesDecl {
	toks := strings.Fields(key)
	if len(toks) < 3 {
		return nil
	}
	var hit *SeriesDecl
	for i := range ix.decls {
		d := &ix.decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		pairs := issHyphenPairs(d.Name)
		if len(pairs) == 0 {
			continue
		}
		declKey := ix.declNorm(i)
		cands := []string{declKey}
		for _, b := range ix.brands {
			if rest, ok := strings.CutPrefix(declKey, b+" "); ok && rest != "" {
				cands = append(cands, rest)
			}
		}
		if rest, ok := strings.CutPrefix(declKey, ix.registrantKey+" "); ok && rest != "" {
			cands = append(cands, rest)
		}
		matched := false
		for _, c := range cands {
			if issInitialismAligns(toks, strings.Fields(c), pairs) {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
}

// issHyphenPairs collects the two-word runs a declared name joins with a
// hyphen, normalised: `Large-Cap` yields `large cap`.
func issHyphenPairs(name string) []string {
	var out []string
	for _, w := range strings.Fields(name) {
		parts := strings.Split(strings.Trim(w, ",.()"), "-")
		if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
			continue
		}
		p := normalizeSeriesName(parts[0] + " " + parts[1])
		if len(strings.Fields(p)) == 2 {
			out = append(out, p)
		}
	}
	return out
}

// issInitialismAligns reports whether toks spells dt exactly apart from one
// token that is the initialism of a hyphenated pair of dt's, in place.
func issInitialismAligns(toks, dt []string, pairs []string) bool {
	if len(dt) != len(toks)+1 {
		return false
	}
	for j := range toks {
		if j < len(dt) && toks[j] == dt[j] {
			continue
		}
		// The contraction must sit here: the remaining tokens after it line up
		// one position later, and this token must initial the hyphenated pair.
		if j+1 >= len(dt) {
			return false
		}
		pair := dt[j] + " " + dt[j+1]
		if len(toks[j]) != 2 || toks[j][0] != dt[j][0] || toks[j][1] != dt[j+1][0] {
			return false
		}
		found := false
		for _, p := range pairs {
			if p == pair {
				found = true
				break
			}
		}
		if !found {
			return false
		}
		for k := j + 1; k < len(toks); k++ {
			if toks[k] != dt[k+1] {
				return false
			}
		}
		return true
	}
	return false
}

// issAbbreviates reports whether short is an in-order abbreviation of long.
// Four characters at least, or three when the heading truncates the declared
// word rather than compressing it -- `OPP` for `OPPORTUNITIES` is a prefix and
// names nothing else, while a three-letter in-order pick of scattered letters
// would reach far too many declared names.
func issAbbreviates(short, long string) bool {
	if len(short) < 4 && !(len(short) == 3 && strings.HasPrefix(long, short)) {
		return false
	}
	if len(short) >= len(long) || short[0] != long[0] {
		return false
	}
	k := 0
	for i := 0; i < len(long) && k < len(short); i++ {
		if long[i] == short[k] {
			k++
		}
	}
	return k == len(short)
}

// issHasToken reports whether a normalised name carries tok as a whole token.
func issHasToken(key, tok string) bool {
	for _, t := range strings.Fields(key) {
		if t == tok {
			return true
		}
	}
	return false
}

// issCutBrand removes brand from the front of a normalised key on a whole-token
// boundary. The brand may be printed as one token or spelled over several --
// John Hancock Funds II prints both `JHFII` and `JHF II` -- so the leading
// tokens are also tried joined.
// issItemFamilyBrand reads the fund family an `Item 1. <family> Funds` section
// opener names, normalised as a brand.
func issItemFamilyBrand(line string) (string, bool) {
	rest, ok := strings.CutPrefix(strings.TrimSpace(line), "Item 1.")
	if !ok {
		return "", false
	}
	key := normalizeSeriesName(rest)
	stem, ok := strings.CutSuffix(key, " funds")
	if !ok || stem == "" || len(strings.Fields(stem)) > 2 {
		return "", false
	}
	return stem, true
}

// reISSCoverRename reads the rename a cover's series list prints UNDER the
// fund's current name, `(changed name from Evergreen Global Leaders Fund on
// 11/05/04)`. The date is what makes the line a declaration rather than prose.
var reISSCoverRename = regexp.MustCompile(`(?i)^\(\s*changed name from\s+(.+?)\s+on\s+\d{1,2}/\d{1,2}/\d{2,4}\s*\)$`)

// issCoverRenameAliases folds the renames a filing prints on its own cover into
// the index, the way issFormerKeys folds the header's FORMER CONFORMED NAMEs.
// The alias is filing-scoped and DIRECTIONAL: the old name names the series the
// line above it resolves to, and the line above must resolve EXACTLY -- a cover
// name the registrant does not declare folds nothing, and no cut, tolerance or
// cross-CIK rung is consulted for either side.
func issCoverRenameAliases(ix *issSeriesIndex, lines []string) {
	if ix.hdrOnly != nil {
		issCoverRenameAliases(ix.hdrOnly, lines)
	}
	for i, raw := range lines {
		m := reISSCoverRename.FindStringSubmatch(strings.TrimSpace(raw))
		if m == nil {
			continue
		}
		prev := ""
		for j := i - 1; j >= 0 && j >= i-3; j-- {
			if p := strings.TrimSpace(lines[j]); p != "" {
				prev = p
				break
			}
		}
		d, _ := lookupSeriesEntry(ix.byName, prev)
		if d == nil {
			continue
		}
		ix.addAlias(m[1], d)
	}
}

// issRegistrantRenames is the audited pre-2006 rename table: for one CIK, a
// heading its filings print against the name the SAME registrant's dictionary
// spells the surviving fund under. EDGAR tags no series before 2006, so a fund
// renamed in 2005 is declared for the first time under its NEW name only, and
// the old heading a 2004-2005 N-PX prints exists in no dictionary row at any
// CIK or vintage -- no name-based rung can reach it, because the two names
// share no distinctive word.
//
// A ROW IS NOT A NAME MATCH. Each entry cites the registrant's own filing
// saying the fund changed its name, and is registrant-scoped: the successor is
// resolved against THIS CIK's own declarations, so nothing here reaches across
// registrants and a successor the registrant never declared folds nothing.
// Funds that MERGED AWAY or liquidated are deliberately absent -- their
// filings name a surviving sibling, which is a different fund, not this fund
// under a later name.
//
// Evergreen Variable Annuity Trust (CIK 0000928754) renamed two series
// effective 2005-04-18, announced in 485BPOS 0000907244-05-000018 ("Effective
// on or about April 18, 2005, Evergreen VA Foundation Fund (the "Fund") will
// change its name to Evergreen VA Balanced Fund", and the same sentence for
// Evergreen VA Growth and Income Fund -> Evergreen VA Fundamental Large Cap
// Fund) and confirmed after the fact in 485BPOS 0000907244-05-000130
// ("Evergreen VA Balanced Fund (formerly Evergreen VA Foundation Fund) ...
// Evergreen VA Fundamental Large Cap Fund (formerly Evergreen VA Growth and
// Income Fund)"). Both successors are dictionary rows of this same CIK at
// vintage 20060630, the trust's first tagged filing, whose roster carries
// neither old name. 8,380 rows with no series across 0000907244-04-000276,
// 0000907244-04-000279 and 0000907244-05-000318. The trust's six other
// untagged headings -- EVERGREEN VA FUND, SPECIAL EQUITY, EQUITY INDEX, BLUE
// CHIP, GLOBAL LEADERS, MASTERS -- merged away or liquidated and stay blank.
//
// ING Strategic Allocation Portfolios, Inc. (CIK 0000935070) renamed two of its
// three sleeves effective with the 2006-05-01 prospectus: 485APOS
// 0001193125-06-026304 (filed 20060210) carries "ING VP Strategic Allocation
// Moderate Portfolio (formally known as ING VP Strategic Allocation Balanced
// Portfolio)" and "ING VP Strategic Allocation Conservative Portfolio (formally
// known as ING VP Strategic Allocation Income Portfolio)", and 485BPOS
// 0001193125-06-090942 (filed 20060427) repeats both with "(formerly, ...)".
// The FY2005 N-CSR 0001104659-06-015813 (filed 20060310) still uses the old
// names throughout, which brackets the rename to after both reporting periods
// the N-PX filings cover. Both successors are dictionary rows of this same CIK
// at vintage 20060620 (S000008665, S000008666) from the registrant's first
// tagged filing 0001193125-06-182503, whose roster carries neither old name --
// neither "Strategic Allocation Income" nor "ING VP Strategic Allocation
// Balanced Portfolio" appears in any of the 41,139 dictionary rows at any CIK.
// 15,567 rows with no series across 0000950124-04-004080 and
// 0000950153-05-002209. The third heading, GROWTH, needs no entry: its pre-2006
// name survived verbatim into the 2006 declaration (S000008664).
//
// iShares Trust (CIK 0001100663) prints its GSTI sleeves under the INDEX
// VENDOR's later name while its own header still spells them under the vendor's
// earlier one. GSTI is the Goldman Sachs Technology Index family; S&P took the
// family over, and the registrant's own dictionary rows carry the handover
// across exactly this filing's vintage -- S000004352 is declared `iShares
// Goldman Sachs Technology Index Fund` at 20060630 and `iShares S&P North
// American Technology Sector Index Fund` at 20080630, S000004353 Networking,
// S000004354 Semiconductor and S000004355 Software the same way -- while the
// 20070630 filing in between heads those four sections `ISHARES S&P GSTI[TM]
// <X> INDEX FUND`, a spelling no dictionary row at any CIK carries. The sole
// class of each names the fund's ticker (IGM, IGN, IGW, IGV), and the
// unrelated `iShares Dow Jones U.S. Technology Sector Index Fund` (S000004329,
// ticker IYW, never an S&P or Goldman Sachs index) prints its own separate
// section in the same filing and must keep it. Both printed spellings of the
// mark are keyed: `[TM]` folds to a `tm` token, while `(TM)`, the glyph and a
// bare `GSTI` all fold to the unmarked key.
//
// American AAdvantage Funds / American Beacon Funds (CIK 0000809593) renamed
// the WHOLE COMPLEX, and EDGAR's own header records it: this registrant's
// pre-2006 filings head `COMPANY CONFORMED NAME: AMERICAN AADVANTAGE FUNDS`,
// while its first series-tagged N-PX, 000080/809593/0000809593-06-000032.txt at
// vintage 20060630, heads the same CIK `COMPANY CONFORMED NAME: AMERICAN BEACON
// FUNDS` with `FORMER CONFORMED NAME: AMERICAN AADVANTAGE FUNDS` directly
// beneath it. Every one of the eighteen fund-section headings the 2004 filing
// 0000809593-04-000019 prints is that one substitution applied to a sleeve --
// the two name families differ ONLY in the brand token AAdvantage vs Beacon,
// every other token identical -- and each resolves to exactly one declared
// series of this same CIK at that 20060630 vintage, so nothing here is
// excluded for ambiguity. The old spelling is unreachable by any name-based
// rung: the token `AAdvantage` appears in NONE of the 41,139 corpus dictionary
// rows, at any CIK or vintage, so the one word that would anchor a cut is the
// word the registrant dropped. Measured with -cik-series over the full
// dictionary and no -series-map, this filing emits 7,588 rows, 7,533 of them
// blank under four headings (LARGE CAP GROWTH 2,244, SMALL CAP VALUE 1,948,
// LARGE CAP VALUE 1,805, BALANCED 1,536); ENHANCED INCOME's 55 rows already
// resolve, and correctly, to S000001821. The remaining thirteen headings emit
// no rows at this vintage -- eleven print the registrant's "There were no
// matters relating to a portfolio security..." or feeder-fund paragraph in
// place of a ballot, and EMERGING MARKETS and INTERNATIONAL EQUITY print a
// `Meeting Date / Company/Ballot Issues` table grammar this layout does not
// read, an unrelated unread-table defect untouched here. The substitution is
// audited for the complex, not for the four headings that happen to carry rows
// in one period, so the headings that emit nothing at this vintage are keyed
// too.
//
// SEVENTEEN of the eighteen are keyed. LARGE CAP GROWTH is deliberately absent,
// and NOT for ambiguity -- it resolves cleanly and uniquely to S000001092
// (`American Beacon Large Cap Growth Fund`, this CIK's own 20060630 row), which
// is exactly the fund its banner names. It is withheld only because
// TestFamilyMislink11AAdvantageProseSentenceHeading asserts blank series on the
// 14 CBRL GROUP rows of this very sandwich, an assertion whose stated ground is
// that `issResolveFund` refuses this heading -- the premise this table exists to
// falsify. Adding the key turns that test red with the CORRECT id on rows whose
// fund name it already reads correctly. Re-baseline that test's series clause
// and the key belongs here; 2,244 rows of the 2004 filing stay blank until then.
//
// Scudder Variable Series II (CIK 0000810573, filing agent 0000088053)
// redesignated TWENTY-NINE series at once, and the instrument is a signed,
// trustee-executed amendment to the Declaration of Trust on EDGAR: Exhibit
// (a)(25) to 485BPOS 000081/810573/0000088053-06-000476.txt, document
// `<FILENAME>exa25-svs2.txt`, headed `SCUDDER VARIABLE SERIES II /
// Redesignation of Series`, whose Column A / Column B table redesignates each
// listed series and is "effective February 6, 2006". The row keyed here is
//
//	Scudder Total Return Portfolio  ->  DWS Balanced VIP
//
// and that successor is a dictionary row of this SAME CIK, declared at vintage
// 20060630 in 000081/810573/0000088053-06-001068.txt, the registrant's first
// series-tagged N-PX: S000006265. EDGAR tagged no series for this trust before
// 2006, so the header pool of every lossy filing is empty and the successor is
// resolved against the registrant's own dictionary rows.
//
// TWO printed spellings, one per lossy vintage, because the vendor abbreviates:
// 20050630 prints `SVS II Total Return Portfolio` (598 rows, all blank) and
// 20040630 prints `SVS II SCUD TOTAL RET PORT- EQ` (326 rows, all blank).
// Neither is reachable by a name-based rung -- `Total Return` and `DWS Balanced
// VIP` share no content word at all, and the 2004 spelling is not even the
// Column A name but a truncation of it -- so both are keyed.
//
// The Turner key is the `SVS Turner Mid Cap Growth Portfolio -> DWS Turner Mid
// Cap Growth VIP` row of that SAME exhibit table (successor S000006274, a
// dictionary row of this CIK at vintage 20060630); the registrant's three
// `Mid Cap Growth` successors make no name-based rung able to pick it out.
// Only the exhibit rows read off the filings are keyed; the remaining
// redesignations are left for a round that reads their printed spellings.
//
// Penn Series Funds, Inc. (CIK 0000702340) renamed one sleeve between its 2004
// and 2005 annual reports, and the instrument is the registrant's OWN NSAR-B
// item 007 class-contract code, which is stable across the rename:
//
//	0000702340-03-000003.txt:81   007 C020100 PENN SERIES GROWTH EQUITY FUND
//	0000702340-04-000003.txt:81   007 C020100 PENN SERIES GROWTH EQUITY FUND
//	0000702340-05-000003.txt:82   007 C020100 PENN SERIES GROWTH STOCK FUND
//
// One code, one fund, two names, asserted by the registrant itself -- not a
// word-similarity guess. The successor is a dictionary row of this SAME CIK:
// the trust's first series-tagged N-PX,
// 000070/702340/0001104659-06-058507.txt (vintage 20060630), declares
// S000006732 `Penn Series Growth Stock Fund`, and that filing's own vote body
// heads the section `GROWTH STOCK FUND`. No filing of this CIK at that vintage
// or later prints a `GROWTH EQUITY FUND` banner at all. 3,474 rows with no
// series across 0000702340-04-000010, 0000702340-04-000012 and
// 0000702340-05-000001, all under that one heading.
//
// No name-based rung reaches it: `Growth Equity` and `Growth Stock` share only
// the word `Growth`, which this registrant's own roster spends on eight other
// declared series (Mid Cap Growth, Large Cap Growth, Small Cap Growth, Smid Cap
// Growth, Large Core Growth, ...), and `Growth Equity Fund` appears in no
// dictionary row of this CIK at any vintage. The filing declares no series --
// EDGAR tagged none for this registrant before 2006 -- so the header pool is
// empty and the successor resolves through registrantExactName against this
// CIK's own dictionary rows.
//
// The two OTHER blank headings of these filings, CORE EQUITY FUND (2,721 rows)
// and EMERGING GROWTH FUND (5,250 rows), are FLOOR and deliberately unkeyed:
// neither has a successor in this CIK's own dictionary at any vintage, and a
// corpus-wide grep of cik_series.tsv for either name returns only unrelated
// CIKs.
//
// AXP Managed Series, Inc. (CIK 0000755221) prints exactly one fund-section
// banner, `AXP MANAGED ALLOCATION FUND`, across both its pre-2006 N-PX
// filings, and the registrant's own later filing records the rename:
// 000075/755221/0001068800-07-000984.txt lines 7014-7016, item (5) of a
// numbered list of name changes, reads "Effective Oct. 1, 2005, ... Managed
// Allocation Fund changed its name to Strategic Allocation Fund", while item
// (3) of the same list records the complex-wide rebrand -- AXP was replaced
// with RiverSource in the registrant name. Those two substitutions carry the
// printed banner to `RiverSource Strategic Allocation Fund`, this CIK's own
// S000003404 declaration at vintage 20060630. Neither the old name nor any
// distinctive word of it reaches the successor by a name rung, so the
// resolution is registrant-scoped here.
//
// TDX Independence Funds, Inc. (CIK 0001385533) is the same complex-wide brand
// substitution as American AAdvantage, and EDGAR's own header records it the
// same way: 000138/1385533/0000891092-09-003339.txt heads `COMPANY CONFORMED
// NAME: TDX Independence Funds, Inc.` with `FORMER CONFORMED NAME: TDAX Funds,
// Inc.` beneath it, and the vote body heads every section under the OLD brand
// token -- `TDAX Independence 2010 ETF Composite` -- against the five series
// the same header declares as `TDX Independence <N> Exchange-Traded Fund`
// (S000016521..S000016525). The two spellings differ in the brand token alone
// (`TDAX` for `TDX`) plus the fund-type suffix the resolver already spans, and
// each banner's year token -- or `In-Target` -- picks exactly one of the five,
// so nothing here is excluded for ambiguity. The old spelling is unreachable by
// any name rung: `TDAX` appears in no dictionary row of this CIK at any vintage
// (its rows spell `TDX` at 20080630 and `db-X` / `Deutsche X-trackers` later),
// so the one word that would anchor a cut is the word the registrant dropped.
// 8,242 rows with no series in that filing, and 8,242 more in the filer's
// duplicate report of the same period, 0000891092-10-000935. All five sleeves
// are keyed, not only the two that carry rows in one period.
var issRegistrantRenames = map[string]map[string]string{
	"0001385533": {
		"tdax independence 2010 etf composite":      "TDX Independence 2010 Exchange-Traded Fund",
		"tdax independence 2020 etf composite":      "TDX Independence 2020 Exchange-Traded Fund",
		"tdax independence 2030 etf composite":      "TDX Independence 2030 Exchange-Traded Fund",
		"tdax independence 2040 etf composite":      "TDX Independence 2040 Exchange-Traded Fund",
		"tdax independence in target etf composite": "TDX Independence In-Target Exchange-Traded Fund",
	},
	"0000755221": {
		"axp managed allocation fund": "RiverSource Strategic Allocation Fund",
	},
	"0000702340": {
		"growth equity fund": "Penn Series Growth Stock Fund",
	},
	"0000810573": {
		"svs ii total return portfolio": "DWS Balanced VIP",
		"svs ii scud total ret port eq": "DWS Balanced VIP",
		// Turner Mid Cap Growth row of the same Exhibit (a)(25) table.
		"svs turner mid cap growth portfolio": "DWS Turner Mid Cap Growth VIP",
		// `Scudder Blue Chip Portfolio -> DWS Blue Chip VIP` row of the same
		// Exhibit (a)(25) table, in the 2004 filing's abbreviated spelling
		// (`SCUD` for Scudder, `PORT` for Portfolio). The sibling `Scudder
		// Global Blue Chip Portfolio` prints its own separate, `GLOB`-bearing
		// heading in the same filing, so the abbreviation is unambiguous.
		"svs ii scud blue chip port": "DWS Blue Chip VIP",
		// `Scudder Global Blue Chip Portfolio -> DWS Global Thematic VIP` row
		// of the same Exhibit (a)(25) to 485BPOS 0000088053-06-000476.txt,
		// effective 2006-02-06; the successor is S000006276, this CIK's own
		// 20060630 dictionary declaration. The 2004 filing's ProxyEdge banner
		// abbreviates the old name as `SVS II SCUD GLOB BLUE CHIP` (`SCUD`
		// for Scudder, `GLOB` for Global). Distinct from the sibling
		// `SVS II SCUD BLUE CHIP PORT -> DWS Blue Chip VIP` entry above,
		// which is a different fund.
		"svs ii scud glob blue chip": "DWS Global Thematic VIP",
		// Seven further Column A -> Column B rows of that SAME Exhibit (a)(25)
		// table, in the printed spellings the two lossy filings carry. The
		// 2004 filing prints the vendor's abbreviations (`SCUD`, `FINAN
		// SERVS`, `OPP`, `SM CAP`, `PORT`), and `LARGE CAP VALUE VALUE` keeps
		// the vendor's own doubled word byte for byte.
		"svs ii large cap value value port": "DWS Large Cap Value VIP",
		"svs ii dreman finan servs port":    "DWS Dreman Financial Services VIP",
		"svs ii janus growth opp port":      "DWS Janus Growth Opportunities VIP",
		"svs ii scud tech growth port":      "DWS Technology VIP",
		"svs ii scud sm cap growth port":    "DWS Small Cap Growth VIP",
		// The 2005 filing prints three of the same funds unabbreviated. Two
		// are SECOND spellings of rows keyed above: `SVS II Technology Growth
		// Portfolio` is the 2005 spelling of `Scudder Technology Growth
		// Portfolio` (S000006262), and `SVS II Global Blue Chip Portfolio` is
		// the 2005 spelling of the `SVS II SCUD GLOB BLUE CHIP` row
		// (S000006276). Both vintages must be keyed; neither name-based rung
		// reaches the other's spelling.
		"svs janus growth and income portfolio": "DWS Janus Growth & Income VIP",
		"svs ii technology growth portfolio":    "DWS Technology VIP",
		"svs ii global blue chip portfolio":     "DWS Global Thematic VIP",
	},
	"0001119720": {
		// `Sm/Mid Cap Equity` abbreviates the declared `Small Mid Cap
		// Equity`, and the vendor drops the trailing `Fund`; the trust's
		// other 14 declared series carry no `Mid Cap Equity` sleeve, so the
		// abbreviation is unambiguous.
		"state farm mutual fund trust sm mid cap equity": "State Farm Small Mid Cap Equity Fund",
	},
	"0001034633": {
		// The vendor interleaves the fund's distinguishing words into the
		// trust's own name, so the residue `Large Cap` prefixes TWO declared
		// series (S000002060 Large Cap Equity Index, S000002067 Large Cap
		// Equity) and no name rung can choose. The banner sits inside the
		// Bridgeway report, whose own header scopes it to `Large Cap Equity
		// Fund` and `Small Mid Cap Equity Fund` -- neither an index fund --
		// while the filing's Blackrock report separately carries all three
		// index sleeves, S000002060 among them.
		"state farm large cap variable product": "State Farm Large Cap Equity Fund",
	},
	"0001100663": {
		"ishares s and p gsti tm technology index fund":    "iShares Goldman Sachs Technology Index Fund",
		"ishares s and p gsti technology index fund":       "iShares Goldman Sachs Technology Index Fund",
		"ishares s and p gsti tm networking index fund":    "iShares Goldman Sachs Networking Index Fund",
		"ishares s and p gsti networking index fund":       "iShares Goldman Sachs Networking Index Fund",
		"ishares s and p gsti tm semiconductor index fund": "iShares Goldman Sachs Semiconductor Index Fund",
		"ishares s and p gsti semiconductor index fund":    "iShares Goldman Sachs Semiconductor Index Fund",
		"ishares s and p gsti tm software index fund":      "iShares Goldman Sachs Software Index Fund",
		"ishares s and p gsti software index fund":         "iShares Goldman Sachs Software Index Fund",
	},
	"0000928754": {
		"evergreen va foundation fund":        "Evergreen VA Balanced Fund",
		"evergreen va growth and income fund": "Evergreen VA Fundamental Large Cap Fund",
	},
	"0000935070": {
		"ing vp strategic allocation balanced portfolio": "ING VP Strategic Allocation Moderate Portfolio",
		"ing vp strategic allocation income portfolio":   "ING VP Strategic Allocation Conservative Portfolio",
	},
	"0000809593": {
		"american aadvantage balanced fund":                                "American Beacon Balanced Fund",
		"american aadvantage emerging markets fund":                        "American Beacon Emerging Markets Fund",
		"american aadvantage enhanced income fund":                         "American Beacon Enhanced Income Fund",
		"american aadvantage high yield bond fund":                         "American Beacon High Yield Bond Fund",
		"american aadvantage intermediate bond fund":                       "American Beacon Intermediate Bond Fund",
		"american aadvantage international equity fund":                    "American Beacon International Equity Fund",
		"american aadvantage international equity index fund":              "American Beacon International Equity Index Fund",
		"american aadvantage large cap value fund":                         "American Beacon Large Cap Value Fund",
		"american aadvantage mid cap value fund":                           "American Beacon Mid-Cap Value Fund",
		"american aadvantage money market fund":                            "American Beacon Money Market Fund",
		"american aadvantage municipal money market fund":                  "American Beacon Municipal Money Market Fund",
		"american aadvantage s and p 500 index fund":                       "American Beacon S&P 500 Index Fund",
		"american aadvantage short term bond fund":                         "American Beacon Short-Term Bond Fund",
		"american aadvantage small cap index fund":                         "American Beacon Small Cap Index Fund",
		"american aadvantage small cap value fund":                         "American Beacon Small Cap Value Fund",
		"american aadvantage treasury inflation protected securities fund": "American Beacon Treasury Inflation Protected Securities Fund",
		"american aadvantage u s government money market fund":             "American Beacon U.S. Government Money Market Fund",
	},
}

// issAuditedRenameAliases folds issRegistrantRenames into the index for the
// filing's own registrant, through the same addAlias the cover-printed renames
// use: the old name is keyed to the series the successor name resolves to, and
// only an EXACT name resolves it. A name the filing already declares is never
// overwritten, and a successor neither the filing's own pool nor this
// registrant's dictionary spells folds nothing.
//
// The filing's header is read first, and the registrant's OWN dictionary rows
// after it, through registrantExactName -- the same registrant-scoped, exact,
// contemporaneity-tiebroken lookup the chain uses everywhere else. The
// dictionary rung is not a widening: a pre-2006 filing tags NO series at all,
// so the header pool is empty for exactly the vintages this table exists to
// serve (American AAdvantage Funds 2004 declares nothing, and every successor
// it renames to is a dictionary row of this same CIK). Two dictionary rows
// answering to one successor name refuse, as they do everywhere.
func issAuditedRenameAliases(ix *issSeriesIndex) {
	if ix == nil || ix.cik == "" {
		return
	}
	for old, succ := range issRegistrantRenames[ix.cik] {
		d, _ := lookupSeriesEntry(ix.byName, succ)
		if d == nil {
			d = issIndexDict(ix).registrantExactName(ix.cik, succ, ix.period)
		}
		if d != nil {
			ix.addAlias(old, d)
		}
	}
}

// addAlias keys a name the FILING declares for a series it already carries.
// A key two series answer to is recorded as nil and refuses, like every map of
// the index, and a name the header declares itself is never overwritten.
func (ix *issSeriesIndex) addAlias(name string, d *SeriesDecl) {
	key := normalizeSeriesName(name)
	if key == "" || d == nil {
		return
	}
	if cur, seen := lookupSeriesEntry(ix.byName, name); seen || cur != nil {
		return
	}
	if ix.aliases == nil {
		ix.aliases = map[string]*SeriesDecl{}
	}
	if cur, ok := ix.aliases[key]; ok && (cur == nil || cur.SeriesID != d.SeriesID) {
		ix.aliases[key] = nil
		return
	}
	ix.aliases[key] = d
	// New evidence invalidates answers memoised before it arrived.
	clear(ix.resolved)
}

// addBrand records a strippable brand the index did not derive from the
// registrant's own name, longest-first order preserved by appending.
func (ix *issSeriesIndex) addBrand(brand string) {
	for _, b := range ix.brands {
		if b == brand {
			return
		}
	}
	ix.brands = append(ix.brands, brand)
}

func issCutBrand(key, brand string) (string, bool) {
	if rest, ok := strings.CutPrefix(key, brand+" "); ok && rest != "" {
		return rest, true
	}
	toks := strings.Fields(key)
	joined := ""
	for i := 0; i < len(toks)-1 && i < 4; i++ {
		joined += toks[i]
		if joined == brand {
			return strings.Join(toks[i+1:], " "), true
		}
		if len(joined) >= len(brand) {
			break
		}
	}
	return "", false
}

// issBrandRecutPasses bounds the re-cut of a brand residue against the same
// brand list. Two is already one more than any observed registrant needs
// (`wilshire` then `vit`); the bound is what keeps the widening finite.
const issBrandRecutPasses = 2

// issCutAnyBrand cuts the first brand of the list that fronts key, or reports
// that none does.
func issCutAnyBrand(key string, brands []string) (string, bool) {
	for _, b := range brands {
		if rest, ok := issCutBrand(key, b); ok && rest != key {
			return rest, true
		}
	}
	return "", false
}

// issSeedableBrandCut refuses a residue that names nothing: empty, or a lone
// generic type word every registrant's sleeves end in.
func issSeedableBrandCut(rest string) bool {
	f := strings.Fields(rest)
	if len(f) == 0 {
		return false
	}
	if len(f) == 1 {
		switch f[0] {
		case "fund", "funds", "portfolio", "portfolios", "trust", "account", "series":
			return false
		}
	}
	return true
}

// issFundSeparator recognises the '===== FUND NAME =====' rule that opens a fund
// section and returns the name padded inside it, verbatim.
//
// ONE '=' is enough on each side. The rule is padded to a fixed 80 columns, so a
// long fund name shrinks the left pad rather than widening the line, and a name
// long enough to leave a single '=' there ("=Invesco European Small Company
// Fund====...") was invisible to the two-'=' prefix this replaced -- taking not
// just that banner but the fund heading of the WHOLE filing with it, since fund
// is carried as state and never got set.
//
// What keeps the widening from swallowing prose is the TOTAL count of '=' on the
// line: every real banner spends the rest of its 80 columns on padding, so
// requiring issBannerMinEquals of them rejects an ordinary sentence that merely
// opens and closes on the character. The text between the rules is still taken
// exactly as printed.
func issFundSeparator(line string) (string, bool) {
	n := len(line)
	if n == 0 || line[0] != '=' || line[n-1] != '=' {
		return "", false
	}
	lead := 0
	for lead < n && line[lead] == '=' {
		lead++
	}
	if lead == n {
		// A bare rule with no text in it. It is still a section boundary -- it is
		// how the report closes a fund -- so it is recognised, with no name.
		return "", n >= issBannerMinEquals
	}
	trail := 0
	for trail < n-lead && line[n-1-trail] == '=' {
		trail++
	}
	total := lead + trail
	for i := lead; i < n-trail; i++ {
		if line[i] == '=' {
			total++
		}
	}
	if total < issBannerMinEquals {
		return "", false
	}
	name := strings.TrimSpace(line[lead : n-trail])
	if !issNameLike(name) {
		// The interior carries no letter or digit, so it is not a fund name under
		// any grammar -- a single stray glyph where an '=' belongs (Ohio National
		// Fund 2011 prints seven rules corrupted to '====?====') leaves an
		// interior of "?". Reading that as a banner NAME renames the open fund to
		// punctuation and, worse, marks the fund as banner-set, so the next clean
		// bare rule closes a section the `Fund Name :` label still has open. Fall
		// through to the bare-rule case: the line is the ordinary issuer divider
		// its uncorrupted siblings are, and the open fund keeps standing.
		return "", n >= issBannerMinEquals
	}
	return name, true
}

// issNameLike reports whether a banner interior could be a fund name at all,
// i.e. whether it carries any letter or digit. Empty and pure-punctuation
// interiors are not names.
func issNameLike(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			return true
		}
	}
	return false
}

// issThinBannerRule reads a rule that spends FEWER than issBannerMinEquals on
// its padding because the name inside it nearly fills the 80 columns:
//
//	===== LEGG MASON PARTNERS INVESTMENT FUNDS, INC. - LEGG MASON PARTNERS ====
//	= MULTIPLE DISCIPLINE FUNDS GLOBAL - BALANCED ALL CAP GROWTH AND VALUE FUND ==
//
// (Legg Mason Partners Investment Funds 2006). Read only as the CONTINUATION of
// a line that already cleared the standalone threshold, never as a banner of its
// own, so an ordinary sentence opening and closing on '=' still cannot become a
// heading -- and the truncated first line, which names the registrant and the
// brand and no series, no longer stands as the whole fund.
func issThinBannerRule(line string) (string, bool) {
	n := len(line)
	if n == 0 || line[0] != '=' || line[n-1] != '=' {
		return "", false
	}
	lead := 0
	for lead < n && line[lead] == '=' {
		lead++
	}
	if lead == n {
		return "", false
	}
	trail := 0
	for trail < n-lead && line[n-1-trail] == '=' {
		trail++
	}
	name := strings.TrimSpace(line[lead : n-trail])
	return name, name != ""
}

// issThinBannerContinuation reports lines[i] as a thin continuation of the
// banner rule directly above it.
func issThinBannerContinuation(lines []string, i int) (string, bool) {
	if i < 1 {
		return "", false
	}
	if prior, ok := issFundSeparator(strings.TrimSpace(lines[i-1])); !ok || prior == "" {
		return "", false
	}
	return issThinBannerRule(strings.TrimSpace(lines[i]))
}

// issBannerWithTail reads a banner rule that carries the first issuer's name after
// its closing '=' run, `=== Praxis Growth Index Fund ===   ABBOTT LABORATORIES`:
// the rule up to the last '=' must be a banner with a name, and the tail is
// returned as the issuer candidate the next Ticker line claims.
func issBannerWithTail(line string) (name, tail string, ok bool) {
	last := strings.LastIndex(line, "=")
	if last < 0 || last == len(line)-1 {
		return "", "", false
	}
	tail = strings.TrimSpace(line[last+1:])
	name, ok = issFundSeparator(line[:last+1])
	if !ok || name == "" || tail == "" {
		return "", "", false
	}
	return name, tail, true
}

// issBannerMinEquals is how many '=' a line must spend before it is read as a
// banner rule rather than as prose that happens to start and end on one.
const issBannerMinEquals = 8

// issMaxBannerLines bounds how many consecutive rule lines are joined into one
// fund name. Real banners wrap onto a second line and no further; the cap is what
// keeps a file that is nothing but rule lines from accumulating an unbounded
// name, since the input is untrusted third-party filing bytes.
const issMaxBannerLines = 4

// issBannerContinues reports whether lines[i] is another banner rule carrying
// text, which is how a fund name that wrapped is recognised: the report pads its
// rule to 80 columns and puts the tail of a long name on the very next line,
//
//	========= MORGAN STANLEY INSTITUTIONAL FUND INC. ACTIVE INTERNATIONAL ==========
//	=========                    ALLOCATION PORTFOLIO                     ==========
//
// which is one banner and one fund, not two.
func issBannerContinues(lines []string, i int) bool {
	if i < 0 || i >= len(lines) {
		return false
	}
	name, ok := issFundSeparator(strings.TrimSpace(lines[i]))
	if !ok {
		name, ok = issThinBannerContinuation(lines, i)
	}
	if !ok && strings.TrimSpace(lines[i]) == "" && i+1 < len(lines) {
		// one blank line between the rules (an HTML block gap); two is a break
		name, ok = issFundSeparator(strings.TrimSpace(lines[i+1]))
	}
	return ok && name != ""
}

// issBannerWrapVisible reports a banner that cannot be complete without the
// next rule: an open parenthesis nobody closed, a banner left hanging on its
// own separator dash, or a continuation that is one type word or a closing
// fragment on its own -- or, when the registrant's index is at hand, a
// continuation whose JOIN names a declared series while the banner so far names
// none (Lord Abbett Investment Trust 2007, `... FUND- WORLD GROWTH & INCOME` /
// `STRATEGY FUND`, 108 rows whose fund became the fragment `STRATEGY FUND`).
func issBannerWrapVisible(sofar, next string, ix ...*issSeriesIndex) bool {
	if strings.Count(sofar, "(") > strings.Count(sofar, ")") {
		return true
	}
	// A continuation that OPENS ON THE REGISTRANT'S OWN NAME is a banner of its
	// own, not the tail of the one above it: Smith Barney Investment Series
	// prints `=== SMITH BARNEY INVESTMENT SERIES - SB GOVERNMENT PORTFOLIO ===`
	// and `=== SMITH BARNEY INVESTMENT SERIES - SB GROWTH AND INCOME FUND ===`
	// between their own rules a few lines apart, and joining them filed the
	// second sleeve's 869 rows under the first, which has no vote table at all.
	// A wrapped tail never re-prints the registrant's name.
	if len(ix) > 0 && ix[0] != nil {
		nk := normalizeSeriesName(strings.TrimSpace(next))
		for _, pk := range append([]string{ix[0].registrantKey}, ix[0].formerKeys...) {
			if _, ok := issCutRegistrantPrefix(nk, pk); ok {
				return false
			}
		}
	}
	// ... and only while the continuation names nothing on its own: a rule that
	// resolves by itself is the next fund, not the tail of this one (Russell
	// Investment Co, `RIC DIVERSIFIED BOND FUND` / `RIC DIVERSIFIED EQUITY FUND`).
	if len(ix) > 0 && ix[0] != nil && strings.TrimSpace(next) != "" {
		_, sofarDecl := issResolveFund(ix[0], sofar)
		_, nextDecl := issResolveFund(ix[0], strings.TrimSpace(next))
		if nextDecl == nil {
			// The banner so far may already resolve on its own -- the full
			// ten-name Lord Abbett header resolves `... FUND- WORLD GROWTH &
			// INCOME` tolerantly -- and refusing the join there is strictly
			// worse: the continuation commits as its own banner, resolves to
			// nothing and blanks the section. Join only when it names the SAME
			// series, so a rule that names a different fund still breaks.
			if _, joined := issResolveFund(ix[0], sofar+" "+strings.TrimSpace(next)); joined != nil {
				if (sofarDecl == nil || sofarDecl.SeriesID == joined.SeriesID) &&
					!issHeadOnlyJoin(ix[0], sofar, joined) {
					return true
				}
			}
		}
	}
	// A banner whose last token is a bare separator dash names nothing after it
	// yet: `Alger Funds II - Alger Dynamic Opportunities Fund -` is continued by
	// the sub-adviser rule below it (Alger Funds II 2018, 430 rows whose fund
	// became `Weatherbie Capital`). The dash must stand alone, so a hyphenated
	// word is never read as a wrap.
	if sf := strings.Fields(sofar); len(sf) > 1 && sf[len(sf)-1] == "-" && strings.TrimSpace(next) != "" {
		return true
	}
	f := strings.Fields(next)
	if len(f) != 1 {
		return false
	}
	switch strings.ToUpper(strings.Trim(f[0], "()")) {
	case "FUND", "PORTFOLIO", "TRUST", "ETF", "SERIES", "ACCOUNT", "INDEX":
		return true
	}
	return strings.HasSuffix(f[0], ")")
}

// issHeadOnlyJoin reports a joined resolution the continuation had no part in:
// the declaration that answered is a leading prefix of the banner SO FAR, so the
// rung read none of the rule below it (JNL Series Trust 2004, a complete
// `... BOND INDEX FUND` banner above a complete `... ENHANCED S&P 500 INDEX
// FUND` banner, joined because the first name is a prefix of the join and the
// second is a fund the registrant spells with a `STOCK` the filing omits). A
// real wrap is answered by a declaration that spans both rules.
// The head is read through the SAME registrant-scoped cuts that answer it on its
// own -- its registrant prefix, and the historical brand stem -- because a head
// that resolves only through one of those is still a head the declaration
// answered whole: Wells Fargo Funds Trust prints a complete
// `WELLS FARGO NEBRASKA TAX-FREE FUND` banner for a fund that cast no proxies,
// blank lines, then a complete `WELLS FARGO OUTLOOK 2010 FUND` banner, and the
// join is answered by `Nebraska Tax-Free Fund` (S000007393) -- a declaration the
// head already carries once its brand is cut, so the rule below it read nothing
// and its 5,647 rows would file under the fund above.
func issHeadOnlyJoin(ix *issSeriesIndex, sofar string, joined *SeriesDecl) bool {
	if joined == nil {
		return false
	}
	decl := normalizeSeriesName(joined.Name)
	if decl == "" {
		return false
	}
	key := normalizeSeriesName(sofar)
	heads := []string{key}
	if stem := issHistoricalBrandStem(issHistoricalBrandKey(key)); stem != "" {
		heads = append(heads, stem)
	}
	if ix != nil {
		for _, pk := range append([]string{ix.registrantKey}, ix.formerKeys...) {
			if rest, ok := issCutRegistrantPrefix(key, pk); ok {
				heads = append(heads, rest)
			}
		}
	}
	for _, h := range heads {
		if strings.HasPrefix(h, decl) {
			return true
		}
	}
	return false
}

// issNextBannerName is the text of the banner rule issBannerContinues found at
// or just past lines[i]; empty when there is none.
func issNextBannerName(lines []string, i int) string {
	for k := i; k < len(lines) && k <= i+1; k++ {
		if name, ok := issFundSeparator(strings.TrimSpace(lines[k])); ok {
			return name
		}
	}
	return ""
}

// issLeadingIndexToken splits off a leading single-letter index token, which some
// registrants print INSIDE the banner to enumerate the funds of the report
// ("A     DWS LARGE COMPANY GROWTH FUND"). It is not part of the fund's name and
// the header never spells it.
//
// Only a single ASCII letter with at least one further token qualifies, and the
// caller must try the heading WITH the token as well -- a real fund name can
// begin with a one-letter word, and dropping it unconditionally would be a
// tolerance rather than a reading of what the filing printed.
// issLeadingEnumerator cuts a section number such as `1.A.`, `2.`, `(3)` or
// `I.` from the front of a heading. The token must carry a digit or be a
// dotted or bracketed letter, so a fund's own first word is never cut.
func issLeadingEnumerator(name string) (rest string, ok bool) {
	f := strings.Fields(name)
	if len(f) < 2 || len(f[0]) > 6 {
		return "", false
	}
	tok := f[0]
	digit, punct := false, false
	for i := 0; i < len(tok); i++ {
		switch c := tok[i]; {
		case c >= '0' && c <= '9':
			digit = true
		case c == '.' || c == ')' || c == '(':
			punct = true
		case isASCIILetter(c):
		default:
			return "", false
		}
	}
	if !digit && !(punct && len(strings.Trim(tok, ".()")) <= 2) {
		return "", false
	}
	if !punct && !digit {
		return "", false
	}
	return strings.Join(f[1:], " "), true
}

// issOrdinalSectionLabel reads the `<n>.<letter>.` label a filing prints in
// front of every fund heading of one report section (`1.D.  Sun Capital Real
// Estate Fund`, `1.E.  SC Alger Growth Fund`), returning the `<n>` its labels
// share. The label is byte evidence that the line is a heading, so a sibling
// whose name resolves to nothing still opens a section.
func issOrdinalSectionLabel(line string) (group string, ok bool) {
	f := strings.Fields(line)
	if len(f) < 2 {
		return "", false
	}
	tok := f[0]
	i := 0
	for i < len(tok) && tok[i] >= '0' && tok[i] <= '9' {
		i++
	}
	if i == 0 || len(tok) != i+3 || tok[i] != '.' || !isASCIILetter(tok[i+1]) || tok[i+2] != '.' {
		return "", false
	}
	return tok[:i], true
}

// issReportTitleLine reports whether a line is the report title printed under a
// bannerless section opener. MEMBERS Mutual Funds prints "PROXY VOTING SUMMARY
// REPORT" where later vintages print "Proxy Voting Records"; both are proved by
// the period line beneath them.
func issReportTitleLine(s string) bool {
	return strings.EqualFold(s, "Proxy Voting Records") ||
		strings.EqualFold(s, "Proxy Voting Summary Report")
}

// issGenericRegistrantWord lists registrant tokens too common to be a brand.
var issGenericRegistrantWord = map[string]bool{
	"funds": true, "trust": true, "series": true, "company": true, "portfolio": true,
	"portfolios": true, "investment": true, "investments": true, "insurance": true,
	"variable": true, "products": true, "capital": true, "management": true,
	"financial": true, "securities": true, "income": true, "equity": true, "growth": true,
	"international": true, "global": true, "american": true, "national": true,
}

// issTypeWord reports whether tok is one of the words a registered fund names
// its vehicle with.
func issTypeWord(tok string) bool {
	switch tok {
	case "fund", "portfolio", "trust", "account", "series", "etf":
		return true
	}
	return false
}

// issDropTypeWord removes a trailing type word from a normalised key.
func issDropTypeWord(key string) (string, bool) {
	f := strings.Fields(key)
	if len(f) < 2 {
		return key, false
	}
	switch f[len(f)-1] {
	case "fund", "portfolio", "trust", "account", "series":
		return strings.Join(f[:len(f)-1], " "), true
	}
	return key, false
}

// issDropAbbrevTypeWord removes a trailing type word the heading prints SHORT:
// `Port` for `Portfolio`, `Ser` for `Series`. Only a STRICT prefix of one of the
// type words issDropTypeWord knows counts, three characters at least, so a token
// that merely shares a letter with one is left alone and a token that IS a type
// word is left to issDropTypeWord itself. Two tokens must remain, so a heading
// is never reduced to one word.
func issDropAbbrevTypeWord(key string) (string, bool) {
	f := strings.Fields(key)
	if len(f) < 3 {
		return key, false
	}
	last := f[len(f)-1]
	if len(last) < 3 || issTypeWord(last) {
		return key, false
	}
	for _, tw := range []string{"fund", "portfolio", "trust", "account", "series"} {
		if len(last) < len(tw) && strings.HasPrefix(tw, last) {
			return strings.Join(f[:len(f)-1], " "), true
		}
	}
	return key, false
}

// issFormerNameDecl is the one series a registrant's FORMER conformed names
// declare at this CIK, or nil where they declare two or none.
func issFormerNameDecl(ix *issSeriesIndex) *SeriesDecl {
	var found *SeriesDecl
	for _, fk := range ix.formerKeys {
		d := ix.byName[fk]
		if d == nil || d.SeriesID == "" {
			continue
		}
		if found != nil && found.SeriesID != d.SeriesID {
			return nil
		}
		found = d
	}
	return found
}

// issTierMismatch refuses a candidate whose declared type word differs from the
// heading's own at a registrant that declares a series on the heading's tier.
// Summit Mutual Funds is a two-tier trust whose `SUMMIT RUSSELL 2000 SMALL CAP
// INDEX FUND` and `SUMMIT RUSSELL SMALL CAP INDEX PORTFOLIO` banners are
// different funds, and only the Portfolio tier is declared, so dropping the tier
// word hands one id to both banners (2,932 rows). Where the CIK declares nothing
// on the heading's tier the substitution is the vendor's, not the registrant's,
// and `AMERITAS SMALL CAP FUND` for a declared `Ameritas Small Cap Portfolio`
// still resolves.
//
// It does NOT refuse where the registrant's own declarations prove the two
// words spell one tier: Wilshire Mutual Funds declares S000001049 `DOW JONES
// WILSHIRE 5000 INDEX PORTFOLIO` in 2006 and `WILSHIRE 5000 INDEX FUND` from
// 2009 on -- one id, both words -- so its `Wilshire Large Company Growth Fund`
// banner is a rename of the declared `... GROWTH PORTFOLIO` and the other
// fund-typed ids in the pool are unrelated siblings (20,336 rows).
func issTierMismatch(ix *issSeriesIndex, key string, d *SeriesDecl) bool {
	swap, tw, declTW := issTierWordSwap(ix, key, d)
	return swap && !cikDict.typeWordRenamed(issIndexCIK(ix), tw, declTW)
}

// issTierRenameKept is the complement: a type-word substitution the tier guard
// would have refused and the registrant's own rename history licenses. Such an
// answer is registrant-scoped evidence about this filing's own header, so it
// stands ahead of the cross-CIK rung -- at 890453 the unbranded 2006 heading
// `Small Company Growth Fund` names the declared S000001047 and must not be
// traded for the corpus-unique sibling S000003363 at CIK 0001331971.
func issTierRenameKept(ix *issSeriesIndex, key string, d *SeriesDecl) bool {
	swap, tw, declTW := issTierWordSwap(ix, key, d)
	return swap && cikDict.typeWordRenamed(issIndexCIK(ix), tw, declTW)
}

// issIndexCIK is the filing's own registrant, or "" where there is no index.
func issIndexCIK(ix *issSeriesIndex) string {
	if ix == nil {
		return ""
	}
	return ix.cik
}

// issTierWordSwap is the raw condition both read: the heading and the declared
// name are each typed, their type words differ, and the registrant declares a
// series on the heading's own tier.
func issTierWordSwap(ix *issSeriesIndex, key string, d *SeriesDecl) (swap bool, tw, declTW string) {
	if d == nil {
		return false, "", ""
	}
	declKey := normalizeSeriesName(d.Name)
	if _, typed := issDropTypeWord(key); !typed {
		return false, "", ""
	}
	if _, typed := issDropTypeWord(declKey); !typed {
		return false, "", ""
	}
	f, df := strings.Fields(key), strings.Fields(declKey)
	tw, declTW = f[len(f)-1], df[len(df)-1]
	return tw != declTW && issDeclaresTypeWord(ix, tw), tw, declTW
}

// issDeclaresTypeWord reports whether any declared name is itself typed with
// the given type word, so a heading carrying that word names a tier the
// registrant keeps apart rather than a spelling of another tier's series.
func issDeclaresTypeWord(ix *issSeriesIndex, tw string) bool {
	for i := range ix.decls {
		if ix.decls[i].SeriesID == "" {
			continue
		}
		if f := ix.declToks(i); len(f) > 1 && f[len(f)-1] == tw {
			return true
		}
	}
	return false
}

// issWithoutStandaloneSeries removes one internal SERIES token and accepts only
// a unique declared name. Multiple possible readings that disagree refuse.
func issWithoutStandaloneSeries(ix *issSeriesIndex, name string) *SeriesDecl {
	f := strings.Fields(normalizeSeriesName(name))
	var found *SeriesDecl
	for i := 1; i < len(f)-1; i++ {
		if f[i] != "series" {
			continue
		}
		candidate := strings.Join(append(append([]string{}, f[:i]...), f[i+1:]...), " ")
		d, seen := ix.byName[candidate]
		if !seen {
			continue
		}
		if d == nil || found != nil && found.SeriesID != d.SeriesID {
			return nil
		}
		found = d
	}
	return found
}

// issExactOrBrandUntyped looks name up exactly or with a brand cut, and refuses
// a declared name whose last word is itself a type word.
func issExactOrBrandUntyped(ix *issSeriesIndex, name string) *SeriesDecl {
	key := normalizeSeriesName(name)
	if key == "" {
		return nil
	}
	d, seen := ix.byName[key]
	if !seen {
		for _, b := range ix.brands {
			if rest, ok := issCutBrand(key, b); ok {
				if x, s := ix.byName[rest]; s {
					d, seen = x, true
					break
				}
			}
		}
	}
	if !seen || d == nil {
		return nil
	}
	f := strings.Fields(normalizeSeriesName(d.Name))
	switch f[len(f)-1] {
	case "fund", "portfolio", "trust", "account", "series":
		return nil
	}
	return d
}

// issClassLetterPrefix cuts a single letter and a dash glued to the name:
// `a-Global Growth Fund` -> `Global Growth Fund`. The character after the dash
// must be a letter, so `T-Bill` is a word and `- ` a sleeve separator.
func issClassLetterPrefix(name string) (rest string, ok bool) {
	if len(name) < 4 || name[1] != '-' || !isASCIILetter(name[0]) || !isASCIILetter(name[2]) {
		return "", false
	}
	return name[2:], true
}

func isASCIILetter(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
}

func issLeadingIndexToken(name string) (rest string, ok bool) {
	fields := strings.Fields(name)
	if len(fields) < 2 || len(fields[0]) != 1 {
		return "", false
	}
	switch c := fields[0][0]; {
	case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z':
		return strings.Join(fields[1:], " "), true
	}
	return "", false
}

// issLeadingCodeToken strips a sleeve/account code that precedes the fund name:
// 2-7 letters or digits carrying at least one digit (`2DCN`, `3347`, `ZW4X`,
// `997RK13` on Federated Index Trust 2005), or any 2-7 letter/digit run in
// parentheses (`(ZW4X)`). A plain word is never a code, so `Growth Emerging
// Markets Value Fund` keeps its first word.
func issLeadingCodeToken(name string) (rest string, ok bool) {
	fields := strings.Fields(name)
	if len(fields) < 2 {
		return "", false
	}
	tok := fields[0]
	paren := len(tok) > 2 && tok[0] == '(' && tok[len(tok)-1] == ')'
	if paren {
		tok = tok[1 : len(tok)-1]
	}
	if len(tok) < 2 || len(tok) > 7 {
		return "", false
	}
	digit := false
	for i := 0; i < len(tok); i++ {
		c := tok[i]
		switch {
		case c >= '0' && c <= '9':
			digit = true
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z':
		default:
			return "", false
		}
	}
	if !digit && !paren {
		return "", false
	}
	return strings.Join(fields[1:], " "), true
}

// issTrailingCorpSuffix drops a terminal incorporation word from a heading:
// `... FUND, INC.` -> `... FUND`. It says nothing about whether the shorter
// name is declared -- the caller must require an exact hit.
func issTrailingCorpSuffix(name string) (rest string, ok bool) {
	fields := strings.Fields(name)
	if len(fields) < 2 {
		return "", false
	}
	last := strings.ToLower(strings.Trim(fields[len(fields)-1], ".,"))
	switch last {
	case "inc", "incorporated", "corp", "corporation", "llc", "ltd", "plc":
	default:
		return "", false
	}
	head := strings.TrimRight(strings.Join(fields[:len(fields)-1], " "), " ,")
	if head == "" {
		return "", false
	}
	return head, true
}

// issRepeatedLetterCode strips a leading sleeve code of 2-3 copies of ONE
// letter (`AA`, `DDD`). The repetition is what marks it as a code rather than a
// word or a brand initialism -- `RIC DIVERSIFIED EQUITY FUND` keeps its RIC --
// and the caller must still require the remainder to be an exact declared name.
func issRepeatedLetterCode(name string) (rest string, ok bool) {
	fields := strings.Fields(name)
	if len(fields) < 2 {
		return "", false
	}
	tok := fields[0]
	if len(tok) < 2 || len(tok) > 3 {
		return "", false
	}
	for i := 0; i < len(tok); i++ {
		c := tok[i]
		if c < 'A' || c > 'Z' || c != tok[0] {
			return "", false
		}
	}
	return strings.Join(fields[1:], " "), true
}

// issLetterCodeToken strips a leading pure-letter sleeve code of 2-3 characters
// (`AA`, `DDD`). It says nothing about whether the token IS a code -- the caller
// must require the remainder to be an exact declared name, since an ordinary
// short word would otherwise be eaten.
func issLetterCodeToken(name string) (rest string, ok bool) {
	fields := strings.Fields(name)
	if len(fields) < 2 {
		return "", false
	}
	tok := fields[0]
	if len(tok) < 2 || len(tok) > 3 {
		return "", false
	}
	for i := 0; i < len(tok); i++ {
		switch c := tok[i]; {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z':
		default:
			return "", false
		}
	}
	return strings.Join(fields[1:], " "), true
}

// issRegistrantOwnBanner reports whether a banner spells the REGISTRANT's own
// name rather than any fund's. Such a rule names no fund and can carry no
// series of its own, so it is a page ornament, not a section boundary that may
// erase the series the evidence above it already established.
func issRegistrantOwnBanner(ix *issSeriesIndex, banner string) bool {
	key := ix.registrantKey
	if key == "" {
		return false
	}
	name := normalizeSeriesName(banner)
	name = strings.TrimPrefix(name, "the ")
	return name == strings.TrimPrefix(key, "the ")
}

// issSubadviserLine reports whether a line is a page heading's `SUBADVISER:`
// attribution. Vantagepoint's sub-adviser reports print the fund's own name as
// a centred page heading and this line DIRECTLY under it, with no blank line
// between, so a heading terminated by it is as complete as one terminated by a
// blank line.
func issSubadviserLine(line string) bool {
	up := htmlUpperASCII(strings.TrimSpace(line))
	return strings.HasPrefix(up, "SUBADVISER:") || strings.HasPrefix(up, "SUB-ADVISER:")
}

// issIdentityBlockFollows reports whether the first non-blank line after i
// opens a ballot's identity block. Such a bare line is the ISSUER of the block,
// never a fund heading: ING Mutual Funds 2005 prints `CANADIAN NATURAL
// RESOURCES LTD.` as a bare paragraph under a ruled divider, and the dictionary
// answers to it with a fund of the same CIK, carrying 2,399 of the enclosing
// ING Foreign Fund's rows onto another series. Under a genuine ruled banner the
// first non-blank line is the issuer name, and the identity lines sit two
// records further down.
func issIdentityBlockFollows(lines []string, i int) bool {
	for j := i + 1; j < len(lines) && j <= i+4; j++ {
		nxt := strings.TrimSpace(lines[j])
		if nxt == "" {
			continue
		}
		up := htmlUpperASCII(nxt)
		return strings.HasPrefix(up, "TICKER:") ||
			strings.HasPrefix(up, "SECURITY ID") ||
			strings.HasPrefix(up, "MEETING DATE:")
	}
	return false
}

// issTickerLine parses 'Ticker: <t>   Security ID: <id>'. The id label is read
// as the prefix SECURITY ID up to its own colon, so `Security ID:` and
// `Security ID and/or CUSIP No.:` (Bear Stearns 2004) both resolve. CUSIP:
// appears as an alternate spelling of the same field in some vintages.
//
// htmlUpperASCII is length-preserving, so offsets found in the uppercased copy
// index the raw line safely; strings.ToUpper can change byte length.
func issTickerLine(line string) (ticker, id string, ok bool) {
	up := htmlUpperASCII(line)
	ti := strings.Index(up, "TICKER:")
	if ti < 0 {
		return "", "", false
	}
	si, label := -1, 0
	if n := strings.Index(up, "SECURITY ID"); n >= 0 {
		if c := strings.Index(up[n:], ":"); c >= 0 {
			si, label = n, c+1
		}
	}
	if si < 0 {
		si = strings.Index(up, "CUSIP:")
		label = len("CUSIP:")
	}
	if si < 0 || si < ti {
		return "", "", false
	}
	ticker = strings.TrimSpace(line[ti+len("TICKER:") : si])
	id = strings.TrimSpace(line[si+label:])
	return issFirstField(ticker), issFirstField(id), true
}

// issMaybeGridRow is the cheap gate in front of the stacked-label grid probe:
// a fixed-width row of three or more columns holds at least two runs of two or
// more spaces. It is a byte scan over the line and allocates nothing, so the
// common prose line costs O(len) and never reaches issGridColumns.
func issMaybeGridRow(line string) bool {
	runs, run := 0, 0
	for n := 0; n < len(line); n++ {
		if line[n] == ' ' {
			run++
			if run == 2 {
				runs++
				if runs == 2 {
					return true
				}
			}
			continue
		}
		run = 0
	}
	return false
}

// issGridColumns splits a fixed-width row into its columns: a run of two or
// more spaces is a column break, a single space is inside a value or a label.
func issGridColumns(line string) []string {
	var out []string
	for _, f := range strings.Split(line, "  ") {
		if f = strings.TrimSpace(f); f != "" {
			out = append(out, f)
		}
	}
	return out
}

// issGridLabel maps one bare identity label to the field it names.
func issGridLabel(s string) string {
	up := strings.ToUpper(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(s), ":")))
	// `Security ID and/or CUSIP No.` names the same field as `Security ID`.
	if strings.HasPrefix(up, "SECURITY ID") {
		return "id"
	}
	switch up {
	case "TICKER":
		return "ticker"
	case "PRIMARY SECURITY ID", "CUSIP":
		return "id"
	case "MEETING DATE":
		return "mtgdate"
	case "MEETING TYPE":
		return "mtgtype"
	case "RECORD DATE":
		return "recdate"
	}
	return ""
}

// issStackedLabelGrid reads the identity off a two-line grid: a line holding
// ONLY bare labels, each ending in a colon with no value beside it, and the
// next non-blank line holding the same number of columns. Values are taken
// positionally, by the label above them.
//
// Both halves are demanded. The label line must name a ticker and a security
// id -- a partial grid is some other table's header -- and every one of its
// columns must be a label this identity knows, so a proposal header cannot
// enter here. The value line must carry no label of its own; a second labelled
// line below the first is two labelled pairs, not a grid.
func issStackedLabelGrid(labelLine, valueLine string) (ticker, id, mtgDate, mtgType, recDate string, ok bool) {
	labels := issGridColumns(labelLine)
	if len(labels) < 2 {
		return "", "", "", "", "", false
	}
	keys := make([]string, len(labels))
	for n, l := range labels {
		if !strings.HasSuffix(l, ":") {
			return "", "", "", "", "", false
		}
		if keys[n] = issGridLabel(l); keys[n] == "" {
			return "", "", "", "", "", false
		}
	}
	var hasTicker, hasID bool
	for _, k := range keys {
		hasTicker = hasTicker || k == "ticker"
		hasID = hasID || k == "id"
	}
	if !hasTicker || !hasID {
		return "", "", "", "", "", false
	}
	vals := issGridColumns(valueLine)
	if len(vals) != len(labels) {
		return "", "", "", "", "", false
	}
	for _, v := range vals {
		if strings.Contains(v, ":") {
			return "", "", "", "", "", false
		}
	}
	for n, k := range keys {
		v := issFirstField(vals[n])
		switch k {
		case "ticker":
			ticker = v
		case "id":
			id = v
		case "mtgdate":
			mtgDate = issGridDate(v)
		case "mtgtype":
			mtgType = strings.TrimSpace(vals[n])
		case "recdate":
			recDate = issGridDate(v)
		}
	}
	return ticker, id, mtgDate, mtgType, recDate, true
}

// issGridDate reads a grid cell's date. A column cannot separate a date's parts
// with a space, so the month-name form arrives hyphenated (`May-11-2023`).
func issGridDate(s string) string {
	if d := issDate(s); d != "" {
		return d
	}
	return issDate(strings.ReplaceAll(s, "-", " "))
}

// issNextNonBlankIdx returns the index of the next non-blank line at or after
// j, or -1 when the document ends first.
func issNextNonBlankIdx(lines []string, j int) int {
	for ; j < len(lines); j++ {
		if strings.TrimSpace(lines[j]) != "" {
			return j
		}
	}
	return -1
}

// issMeetingLine parses 'Meeting Date: <date>   Meeting Type: <type>'.
func issMeetingLine(line string) (date, typ string, ok bool) {
	up := strings.ToUpper(line)
	label := "MEETING DATE:"
	di := strings.Index(up, label)
	if di < 0 && strings.HasPrefix(up, "CONSENT DATE:") {
		label, di = "CONSENT DATE:", 0
	}
	var rest string
	if di >= 0 {
		rest = line[di+len(label):]
	} else {
		// `Meeting           12/08/2004         Meeting Type:    Annual`: the
		// word Date dropped (Safeco Common Stock Trust 2005, 759 undated
		// rows on r156). The line must open with Meeting, run straight into
		// a date, and still carry the meeting type.
		t := strings.TrimSpace(up)
		if !strings.HasPrefix(t, "MEETING ") || !strings.Contains(t, "MEETING TYPE:") {
			return "", "", false
		}
		after := strings.TrimSpace(strings.TrimSpace(line)[len("MEETING"):])
		if !issStartsWithMonthOrDigit(after) {
			return "", "", false
		}
		rest = after
	}
	if ti := strings.Index(strings.ToUpper(rest), "MEETING TYPE:"); ti >= 0 {
		typ = strings.TrimSpace(rest[ti+len("MEETING TYPE:"):])
		rest = rest[:ti]
	} else if ti := strings.Index(strings.ToUpper(rest), "MEETINGTYPE:"); ti >= 0 {
		// `MeetingType:` without its space (Comerica 2004)
		typ = strings.TrimSpace(rest[ti+len("MEETINGTYPE:"):])
		rest = rest[:ti]
	}
	if ri := strings.Index(strings.ToUpper(typ), "RECORD DATE:"); ri >= 0 {
		typ = strings.TrimSpace(typ[:ri])
	}
	return issDate(rest), typ, true
}

// issRecordLine parses 'Record Date: <date>'.
func issRecordLine(line string) (string, bool) {
	up := strings.ToUpper(line)
	i := strings.Index(up, "RECORD DATE:")
	if i < 0 {
		return "", false
	}
	return issDate(line[i+len("RECORD DATE:"):]), true
}

// issTableHeader recognises the '#  Proposal  Mgt Rec  Vote Cast  Sponsor'
// column header that opens a meeting's proposal table.
// issForeignTableHeader recognises a column header belonging to ANOTHER
// administrator's grammar, whose columns this layout would misread.
//
// One registrant files both in one document. Ours is `#  Proposal  Mgt Rec
// Vote Cast  Sponsor`; the other prints its identity columns in a PARALLEL table
// to the left and heads its vote table:
//
//	   Shares
//	Available              Item                          Management     Vote
//	  to Vote Proponet     Number Proposal               Recommendation Instruction
//	     1965 Management   1.1    Elect Director M. Jay Allison    For     For
//
// issTableHeader only sees a line starting with `#`, so this one did not close
// the table above it. Its rows were then read in issnpx's column order -- the
// SHARE COUNT as the item number, the whole row as proposal text -- and carried
// the PREVIOUS section's meeting, filing NRG Energy's votes under Wyeth's CUSIP.
// A wrong issuer is worse than a missing one, which is why this closes the table
// rather than attempting a reading: the identity columns are not in this table
// at all, so nothing here could supply the right meeting.
//
// Measured 2026-09-01: 14,471 rows across 74 filings. `Proponet` is the filing's
// own spelling and both are accepted.
func issForeignTableHeader(line string) bool {
	up := strings.ToUpper(strings.TrimSpace(line))

	// An HTML <TABLE> renders ONE HEADER CELL PER LINE, so the same foreign
	// grammar arrives as a run of bare labels rather than one wide header:
	//
	//	Issuer Name / Ticker / Meeting Date / Primary Security ID /
	//	Meeting Type / Record Date / Proposal Number / Proposal Text / Proponent
	//
	// and its rows flatten to `3i Infrastructure plc 3IN 07/05/2018 G8873L178
	// Annual 07/03/2018 1 Accept Financial Statements ...`, which this layout
	// then read as a proposal line -- issuer, ticker, date and CUSIP all inside
	// the proposal text, under whatever meeting the last ISS section set.
	// Measured 2026-09-01, one such filing contributed 1,895 of issnpx's 2,412
	// spliced-cell rows. These labels name a COLUMN and are never a proposal.
	switch up {
	case "PROPOSAL NUMBER", "PROPOSAL TEXT", "PRIMARY SECURITY ID", "PROPONENT":
		return true
	}

	// The pvtext grammar, whose proponent comes FIRST and is followed by a
	// VOTED? column, so the sponsor is not at the right edge where
	// issPeelColumns looks:
	//
	//	         PROPOSAL TYPE  VOTED?  VOTE  FOR/AGNST MGMT
	//	1.01  Elect Vance D. Coffman   MGMT   YES   FOR   FOR
	//
	// The peel fails on every row and the whole line becomes proposal text with
	// a blank vote. pvtext reads this correctly; 0000935069-05-002185 carries
	// 121 ISS sections and 5 of these, and its later pvtext tables arrive with
	// an ISS table still open -- 20,978 of its 22,753 rows are that.
	if strings.Contains(up, "VOTED?") && (strings.Contains(up, "PROPOSAL TYPE") ||
		strings.Contains(up, "FOR/AGNST")) {
		return true
	}

	// The Broadridge VOTE SUMMARY grammar, whose NOTES column follows the vote
	// and carries `With Mgmt`, so ISS column order puts a note where the vote
	// is and the peel fails on every row:
	//
	//	#     PROPOSAL                                     VOTE          NOTES          COMMENTS
	//	1     The election of directors of the corporation  For           With Mgmt
	//
	// Six filings of one agent embed it after their ISS sections; 324 rows,
	// 2026-09-02.
	if strings.HasPrefix(up, "#") && strings.Contains(up, "PROPOSAL") && strings.Contains(up, "NOTES") {
		return true
	}

	// The broadridge grammar, whose TYPE column carries the sponsor BEFORE the
	// votes:
	//
	//	ITEM   PROPOSAL       TYPE          VOTE        MANAGEMENT
	//	 01    DIRECTOR       Management
	//	       1    LINDA G. ALVARADO      For         For
	//
	// A director slate puts the sponsor on the slate's own line and each nominee
	// carries votes alone, so no nominee row has a sponsor at the right edge
	// where issPeelColumns looks. 0000950152-06-007352.txt mixes 247 ISS
	// sections with 366 of these and 4,061 of its 6,500 rows are blank for it.
	// broadridge reads the grammar correctly.
	if strings.Contains(up, "PROPOSAL") && strings.Contains(up, "TYPE") &&
		!strings.HasPrefix(up, "#") {
		return true
	}

	// Two more, both found on the 29-commit build's ranking:
	//
	//	Meeting Date  Company Name  Ticker  Security ID  Description  Vote Cast  Voted  M or S
	//
	// a wide table with the identity columns INLINE, 956 rows blank in a filing
	// that also carries 78 ISS sections; and
	//
	//	Date Type Ballot Issues Ticker Rec Cast Date Shares
	//
	// the Lazard "Proxy Voting Report" that follows an ISS section's
	// `========== END NPX REPORT`, with no sponsor column and a paragraph of
	// rationale under every row, 559 rows blank. Neither starts with `#`, and
	// our own header names neither SECURITY ID nor BALLOT ISSUES.
	if strings.HasPrefix(up, "#") {
		return false
	}
	if strings.Contains(up, "SECURITY ID") && strings.Contains(up, "DESCRIPTION") {
		return true
	}
	if strings.Contains(up, "BALLOT ISSUES") {
		return true
	}

	if !strings.Contains(up, "PROPONET") && !strings.Contains(up, "PROPONENT") {
		return false
	}
	// `Issue No. | Description | Proponent | Mgmt Rec | Vote Cast | For/Against
	// Mgmt` names its columns too, but with none of the words above -- so
	// DESCRIPTION and ISSUE NO. join them. Our own header says `Sponsor`, never
	// `Proponent`, so it cannot reach this line.
	return strings.Contains(up, "ITEM") || strings.Contains(up, "NUMBER") ||
		strings.Contains(up, "SHARES") || strings.Contains(up, "PROPOSAL") ||
		strings.Contains(up, "DESCRIPTION") || strings.Contains(up, "ISSUE NO")
}

func issTableHeader(line string) bool {
	if !strings.HasPrefix(line, "#") {
		return false
	}
	return strings.Contains(strings.ToUpper(line), "PROPOSAL")
}

// issSkippableHeader drops the report-level preamble, which carries no votes and
// must not be mistaken for an issuer name.
func issSkippableHeader(line string) bool {
	up := strings.ToUpper(line)
	switch {
	case strings.Contains(up, "FORM N-PX REPORT"):
		return true
	case strings.HasPrefix(up, "ICA FILE NUMBER:"):
		return true
	case strings.HasPrefix(up, "REPORTING PERIOD:"):
		return true
	}
	return false
}

// issVoteHead reports whether a line's last tokens are the head of a vote
// value whose tail the column wrapped onto a later line: `Did Not` for
// `Did Not Vote`, `Echo` for `Echo Vote`, `No shares` for `No shares held on
// record`. A whole value is not a head.
func issVoteHead(toks []string) bool {
	for k := 1; k <= issMaxCellWords && k <= len(toks); k++ {
		head := strings.ToLower(strings.Trim(strings.Join(toks[len(toks)-k:], " "), issCellTrim)) + " "
		for v := range issVoteValues {
			if strings.HasPrefix(v, head) {
				return true
			}
		}
	}
	return false
}

// issSplitItem separates a leading item number from the rest of a table line.
// No item number means the line continues the row above it.
//
// The token alone does not decide: `3M COMPANY`, `3I GROUP PLC`, `77 BANK LTD.`
// and a wrapped `2010 Business Plan` all begin with something issItemRe accepts.
// What marks a proposal row is the COLUMN GAP after the item -- `1a    Elect`
// keeps two or more spaces through normalisation, a word keeps one -- or a
// terminator (`1.`, `4)`), which no issuer name carries. One space is still a
// row when the item FILLS its column (`1..10 DIRECTOR-NICOLL@  For  For
// Management`), and that row can be told from a name because it carries its
// trailing vote cells.
func issSplitItem(line string) (item, rest string) {
	parts := strings.SplitN(line, " ", 2)
	if len(parts) != 2 || !issItemRe.MatchString(parts[0]) {
		return "", line
	}
	tok := parts[0]
	terminated := strings.HasSuffix(tok, ".") || strings.HasSuffix(tok, ")")
	if !terminated && !strings.HasPrefix(parts[1], " ") {
		if _, _, cast, sponsor := issPeelColumns(parts[1]); cast == "" && sponsor == "" {
			return "", line
		}
	}
	return tok, strings.TrimSpace(parts[1])
}

// issProposalWrapWalk bounds the upward walk of issProposalWrapLine. A proposal
// whose text wraps runs a handful of lines at most; sixteen clears the longest
// observed run without reaching back past the block above.
const issProposalWrapWalk = 16

// issProposalWrapLine reports lines[i] as the wrapped tail of the numbered
// proposal printed above it, inside the table still open. When the wrap is the
// last line of its block a blank follows it, so it stands exactly where a
// bare-paragraph fund heading stands and the plain-heading branch offers it as
// one the moment the resolver answers: `Human Rights Violations`, the tail of
// `Participate in OECD Mediation for Human Rights Violations`, reached the
// declared `iShares Human Rights ETF` and took S000037043 and every row of the
// AMERICAN ELECTRIC POWER meeting below it (iSHARES TRUST 2016). Resolving is
// not evidence of a heading.
//
// The evidence is the grammar ABOVE the line, the same one
// brProposalContinuationSlot and brContinuationRunLine apply to the other
// grammar: collapseSpaces drops leading whitespace at every line start, so the
// Proposal column the wrap is printed in is gone by the time this layout is
// read. An unbroken run of non-blank, unruled lines reaching a numbered row that
// carries this grammar's own trailing cells is what remains, and no fund heading
// is ever printed under such a row with no blank or rule between.
func issProposalWrapLine(lines []string, i int) bool {
	if i < 1 {
		return false
	}
	for j, steps := i-1, 0; j >= 0 && steps < issProposalWrapWalk; j, steps = j-1, steps+1 {
		prev := strings.TrimSpace(lines[j])
		if prev == "" || issPunctRuleLine(prev) {
			return false
		}
		if _, ruled := issFundSeparator(prev); ruled {
			return false
		}
		if item, rest := issSplitItem(prev); item != "" {
			_, _, cast, sponsor := issPeelColumns(rest)
			return cast != "" || sponsor != ""
		}
	}
	return false
}

// issVoteRowLine reports a line that is a COMPLETE numbered proposal row of
// this grammar -- an item number, and the trailing Vote Cast and Sponsor cells
// issPeelColumns reads off the right edge. issProposalWrapLine judges the
// wrapped TAIL of such a row; the row itself stands one line higher and reaches
// the bare-paragraph branch on its own when the meeting ends on it. `21
// Authorise Market Purchase For For Management` was offered as a banner and the
// trailing `Management` cell carried it through the dictionary to `Columbia
// Variable Portfolio - Cash Management Fund`, S000019849 -- a money market fund
// stamped on 28,414 rows of other portfolios' equity votes (Columbia Funds
// Variable Series Trust II 2011). layout_broadridge.go applies the same test in
// brVoteRowSlot.
func issVoteRowLine(line string) bool {
	item, rest := issSplitItem(line)
	if item == "" {
		return false
	}
	_, _, cast, sponsor := issPeelColumns(rest)
	return cast != "" && sponsor != ""
}

// issPunctRuleLine reports a line drawn entirely out of one rule character.
func issPunctRuleLine(line string) bool {
	if len(line) < 4 {
		return false
	}
	switch line[0] {
	case '-', '=', '_', '*':
	default:
		return false
	}
	return strings.Trim(line, string(line[0])) == ""
}

// issJoinWrappedVote completes a Vote Cast cell that WRAPPED across two physical
// lines. `Did Not Vote` is printed as `Did Not` above `Vote`:
//
//	1     Accept 2005 Operating Results and    For      Did Not    Management
//	      Financial Statements                          Vote
//
// Read a line at a time the vote is `Did Not`, which is in no vocabulary, so
// issPeelColumns abandons the whole line: the row emits a BLANK how_voted and
// every trailing cell stays in the proposal text. Measured 2026-09-01, issnpx
// carries 2,275,259 blank votes over 166,403,081 rows, and on two filings of
// this family 961 of 14,680 rows (6.55%) are blank exactly this way.
//
// Admitting `did not` to the vocabulary would report a value the filing never
// printed in that cell. The cell says `Did Not Vote`; the fix is to reunite it.
//
// prev is the opening line's surviving tokens, cont the continuation's. Both
// halves are taken from the RIGHT, because that is the edge the vote column sits
// on, and both are bounded by issMaxCellWords.
func issJoinWrappedVote(prev, cont []string) (vote string, prevKeep, contKeep []string, ok bool) {
	for k := 1; k <= issMaxCellWords && k <= len(prev); k++ {
		head := strings.Join(prev[len(prev)-k:], " ")
		for m := 1; m <= issMaxCellWords && m <= len(cont); m++ {
			tail := strings.Join(cont[len(cont)-m:], " ")
			candidate := head + " " + tail
			if issVoteValues[strings.ToLower(strings.Trim(candidate, issCellTrim))] {
				return candidate, prev[:len(prev)-k], cont[:len(cont)-m], true
			}
			// A labelled distribution wraps wherever the column falls: a head
			// ending in `=` (`F=94%, AB=`) is glued to its tail (`6%`), a head
			// ending in `,` (`F=35%,`) takes the tail after a space. The cell is
			// the LONGEST head that still reads as a distribution, so `AB=` does
			// not win over `F=94%, AB=`.
			if strings.HasSuffix(head, "=") {
				candidate = head + tail
			}
			if issLabelledDistribution(candidate) {
				bestK := k
				for kk := k + 1; kk <= issMaxCellWords && kk <= len(prev); kk++ {
					h := strings.Join(prev[len(prev)-kk:], " ")
					c := h + " " + tail
					if strings.HasSuffix(h, "=") {
						c = h + tail
					}
					if !issLabelledDistribution(c) {
						break
					}
					candidate, bestK = c, kk
				}
				return candidate, prev[:len(prev)-bestK], cont[:len(cont)-m], true
			}
		}
	}
	return "", prev, cont, false
}

// issPeelColonVote reads a Vote Cast cell printed as the vote, a colon and a
// qualifier -- one registrant restates the nominee there:
//
//  1. ELECTION OF DIRECTORS: RAUL ALVAREZ     FOR       FOR: RAUL    Management
//     ALVAREZ
//
// The vote is the word before the colon. The qualifier is not proposal text
// and not a vote; it is carried in vote_other_info, the field the VOTED
// column already uses, and its wrapped tail is collected by the row loop
// (see issRowBuf.colon). 227 rows in two filings, 2026-09-02.
func issPeelColonVote(rest string) (body, mgmt, cast, qualifier, sponsor string, ok bool) {
	toks := strings.Fields(rest)
	sponsor, toks, found := issPeelCell(toks, issSponsors)
	if !found {
		return "", "", "", "", "", false
	}
	for i := len(toks) - 1; i >= 0 && i >= len(toks)-1-issMaxCellWords; i-- {
		stem, hasColon := strings.CutSuffix(toks[i], ":")
		if !hasColon || !issVoteValues[strings.ToLower(stem)] {
			continue
		}
		qualifier = strings.Join(toks[i+1:], " ")
		before := toks[:i]
		if mg, remaining, f := issPeelVote(before); f {
			mgmt, before = mg, remaining
		}
		return strings.Join(before, " "), mgmt, stem, qualifier, sponsor, true
	}
	return "", "", "", "", "", false
}

// issSplitWrappedTail recovers a proposal whose text resumes AFTER the sponsor,
// on the same physical line:
//
//	1  Accept Financial Statements and  For  For  Management Statutory Reports
//
// The proposal is "Accept Financial Statements and Statutory Reports" and the
// cells sit in the MIDDLE of it, so a peel from the right finds "Reports" in no
// vocabulary and abandons the whole line.
//
// The column boundary survives normalisation and is what makes this recoverable
// rather than a guess: cells are separated by TWO spaces, and the wrapped tail
// is glued to its sponsor by ONE. So the last gap-delimited cell is the sponsor
// followed by proposal text, and splitting it there is reading the layout the
// filing printed -- the same fact icrPeelProponent and lvPeelProponent use.
//
// Returns the line rebuilt with the tail moved back onto the proposal text, so
// the caller can peel it normally.
func issSplitWrappedTail(rest string) (string, bool) {
	cells := icrCells(rest)
	if len(cells) < 2 {
		return "", false
	}
	last := cells[len(cells)-1]
	head, tail, cut := strings.Cut(last, " ")
	if !cut || strings.TrimSpace(tail) == "" || !issSponsors[strings.ToLower(head)] {
		return "", false
	}
	// The proposal text is the FIRST cell; the tail rejoins it, and the cells
	// between them keep their two-space separation so the peel still sees them.
	rebuilt := cells[0] + " " + strings.TrimSpace(tail)
	for _, c := range cells[1 : len(cells)-1] {
		rebuilt += "  " + c
	}
	return rebuilt + "  " + head, true
}

// issDistributionHeader reads a header that declares NO Vote Cast column but
// percentage columns named for the choices:
//
//	#     Proposal                  Rec    For       Withhold            Sponsor
//	1.01  Elect Trustee James C.    For    97.581%   2.419%              Management
//
// The fund reports its vote as a DISTRIBUTION over the choices the header
// names. It returns those names in column order, or nil for any other
// header. About 4,300 rows in two registrants' filings, 2026-09-02; the
// `F=85.71%` form another filer prints by hand is the same fact.
func issDistributionHeader(line string) []string {
	up := strings.ToUpper(line)
	if strings.Contains(up, "VOTE CAST") {
		return nil
	}
	var cols []string
	for _, w := range strings.Fields(line) {
		switch strings.ToUpper(w) {
		case "FOR", "AGAINST", "WITHHOLD", "WITHHELD", "ABSTAIN":
			cols = append(cols, w)
		}
	}
	if len(cols) < 2 {
		return nil
	}
	return cols
}

// issPeelDistribution reads a row under that header: the sponsor at the right
// edge, then one percentage per declared column, then an optional
// recommendation. how_voted is each verbatim percentage labelled with its
// column: `For=97.581% Withhold=2.419%`.
func issPeelDistribution(rest string, cols []string) (body, mgmt, cast, sponsor string, ok bool) {
	toks := strings.Fields(rest)
	sponsor, toks, ok = issPeelCell(toks, issSponsors)
	if !ok || len(toks) < len(cols) {
		return "", "", "", "", false
	}
	pcts := toks[len(toks)-len(cols):]
	for _, p := range pcts {
		if !issPercentCell(p) {
			return "", "", "", "", false
		}
	}
	toks = toks[:len(toks)-len(cols)]
	if mg, remaining, found := issPeelVote(toks); found {
		mgmt, toks = mg, remaining
	}
	parts := make([]string, len(cols))
	for i, c := range cols {
		parts[i] = c + "=" + pcts[i]
	}
	return strings.Join(toks, " "), mgmt, strings.Join(parts, " "), sponsor, true
}

// issPercentCell recognises a bare percentage cell: digits, an optional
// decimal part, and the percent sign.
func issPercentCell(s string) bool {
	if !strings.HasSuffix(s, "%") || len(s) < 2 {
		return false
	}
	n := s[:len(s)-1]
	dot := false
	for i, r := range n {
		switch {
		case r >= '0' && r <= '9':
		case r == '.' && !dot && i > 0:
			dot = true
		default:
			return false
		}
	}
	return true
}

// issDistributionVote recognises how_voted in the labelled-distribution form
// this reader emits: `For=97.581% Withhold=2.419%`.
func issDistributionVote(s string) bool {
	parts := strings.Fields(s)
	if len(parts) == 0 {
		return false
	}
	for _, p := range parts {
		label, pct, cut := strings.Cut(p, "=")
		if !cut || label == "" || !issPercentCell(pct) {
			return false
		}
	}
	return true
}

// issSponsorLeadsHeader reports that this table names its Sponsor column BEFORE
// its Proposal column:
//
//	#     Sponsor        Proposal                   Vote Cast  For/Against
//	01.1  Management     DIRECTOR - ROBERT L. BAGBY  For        For
//
// The header still starts with `#` and still names `Proposal`, so it is this
// layout's own grammar rather than a foreign one to decline -- and declining
// would cost every row in the filing rather than recovering anything. Only the
// column ORDER differs, and the header states it. Measured 2026-09-01,
// 0000715165-07-000018.txt is 3,980 blank of 3,982 rows.
func issSponsorLeadsHeader(line string) bool {
	up := strings.ToUpper(line)
	sp := strings.Index(up, "SPONSOR")
	pr := strings.Index(up, "PROPOSAL")
	return sp >= 0 && pr >= 0 && sp < pr
}

// issPeelSponsorFirst reads a row of that shape: the sponsor is the FIRST field
// after the item token, the vote cells trail on the right, and the proposal text
// is what lies between.
func issPeelSponsorFirst(rest string) (body, mgmt, cast, sponsor string, ok bool) {
	toks := strings.Fields(rest)
	if len(toks) < 2 || !issSponsors[strings.ToLower(toks[0])] {
		return "", "", "", "", false
	}
	sponsor, toks = toks[0], toks[1:]
	cast, toks, ok = issPeelVote(toks)
	if !ok {
		return "", "", "", "", false
	}
	// A second vote cell to the LEFT is the For/Against-Management column this
	// vintage prints; the Vote Cast cell is the one nearer the text, so the
	// first peel is the trailing column and this one is the vote.
	if cell, remaining, found := issPeelVote(toks); found {
		mgmt, cast, toks = cast, cell, remaining
	}
	if len(toks) == 0 {
		return "", "", "", "", false
	}
	return strings.Join(toks, " "), mgmt, cast, sponsor, true
}

// issVotedColumnHeader reports a header that declares a VOTED column between
// the sponsor and the vote:
//
//	#   Proposal                Proposal By        Voted   Vote Cast   Management
//	                         Issuer/Stockholder                        Recommendation
//	1   Elect director Jeffrey P. Bezos   Issuer   Yes   For   For
//
// It starts with `#` and names `Proposal`, so issTableHeader claims it, and
// correctly: nothing else in the registry reads this document, which has no
// other table grammar at all, so declining would turn 247 blank rows into zero.
// The columns are simply the vanguard set under an issnpx header -- sponsor
// SECOND, then Yes/No, then the vote, then the recommendation -- and peeling a
// sponsor off the right finds `For` and abandons every line. `VOTE CAST` does
// not contain `VOTED`, so our own header cannot trip this. Measured
// 2026-09-01: ~660 rows across one registrant's three filings.
func issVotedColumnHeader(line string) bool {
	up := strings.ToUpper(line)
	return strings.Contains(up, "VOTED") && strings.Contains(up, "PROPOSAL BY")
}

// issPeelVotedColumn reads a row of that shape from the RIGHT: the
// recommendation, the vote, the Yes/No Voted cell, then the sponsor. The
// proposal text is what remains.
func issPeelVotedColumn(rest string) (body, mgmt, cast, voted, sponsor string, ok bool) {
	toks := strings.Fields(rest)
	if mgmt, toks, ok = issPeelVote(toks); !ok {
		return "", "", "", "", "", false
	}
	if cast, toks, ok = issPeelVote(toks); !ok {
		return "", "", "", "", "", false
	}
	if len(toks) == 0 {
		return "", "", "", "", "", false
	}
	switch strings.ToLower(toks[len(toks)-1]) {
	case "yes", "no":
		voted, toks = toks[len(toks)-1], toks[:len(toks)-1]
	default:
		return "", "", "", "", "", false
	}
	if sponsor, toks, ok = issPeelCell(toks, issSponsors); !ok || len(toks) == 0 {
		return "", "", "", "", "", false
	}
	return strings.Join(toks, " "), mgmt, cast, voted, sponsor, true
}

// issNextNonBlank returns the next non-blank line at or after index j, trimmed,
// or "" at end of input.
func issNextNonBlank(lines []string, j int) string {
	for ; j < len(lines); j++ {
		if t := strings.TrimSpace(lines[j]); t != "" {
			return t
		}
	}
	return ""
}

// issPeelColumns takes the Mgt Rec / Vote Cast / Sponsor cells off the right of a
// table line, returning the proposal text that remains.
//
// The sponsor and one vote cell must peel; short of that the line is text, not
// the end of a row. A second vote cell is the Mgt Rec column and is optional,
// because the report leaves it blank on rows it merely records. Nothing is
// substituted for a cell that does not peel.
func issPeelColumns(rest string) (body, mgmt, cast, sponsor string) {
	toks := strings.Fields(rest)
	// One proposal-text token, the Vote Cast cell and the Sponsor cell are the
	// fewest a row can carry once the Mgt Rec column is allowed to be blank.
	if len(toks) < 3 {
		return strings.TrimSpace(rest), "", "", ""
	}

	sponsor, toks, ok := issPeelCell(toks, issSponsors)
	if !ok {
		return strings.TrimSpace(rest), "", "", ""
	}

	// Vote cells are peeled right to left, so the first one off the line is Vote
	// Cast and a second, if the filing printed one, is Mgt Rec.
	cast, toks, ok = issPeelVote(toks)
	if !ok {
		// ONE FILER PRINTS THE SPONSOR'S NAME AS THE VOTE, to say it voted
		// with that sponsor: `For  Management  Management`. The cell is
		// verbatim, but a sponsor word is admitted as the vote only when the
		// row carries all three cells -- a vocabulary Mgt Rec before it and
		// the Sponsor after it -- because a two-cell `Management  Management`
		// is exactly the bleed this layout once suffered. Decided under the
		// standing goal 2026-09-02; one 2016 filing, about 1,000 rows.
		if len(toks) >= 2 && issSponsors[strings.ToLower(strings.Trim(toks[len(toks)-1], issCellTrim))] {
			if mg, remaining, found := issPeelVote(toks[:len(toks)-1]); found && !issFrequencyVote(mg) {
				return strings.Join(remaining, " "), mg, toks[len(toks)-1], sponsor
			}
		}
		return strings.TrimSpace(rest), "", "", ""
	}
	if len(toks) > 0 {
		if cell, remaining, found := issPeelVote(toks); found {
			mgmt, toks = cell, remaining
		}
	}
	if !issDigitCellsAgree(mgmt, cast) {
		return strings.TrimSpace(rest), "", "", ""
	}
	return strings.Join(toks, " "), mgmt, cast, sponsor
}

// issPeelTrailingCells peels the Sponsor and vote cells off a line that carries
// NOTHING ELSE. It exists because issPeelColumns refuses a line of fewer than
// three tokens, which is right for a ROW and wrong for a CONTINUATION:
//
//	1.1  Elect Director R.J. Alpern  For
//	For  Management
//
// EDGAR wraps this vintage's paragraphs, so the first line ends after Mgt Rec
// and the second carries Vote Cast and Sponsor and nothing else. Refused, the
// cells were appended to the proposal text and the vote went blank -- measured
// 2026-09-01 one such filing emits 14,711 blank votes of 16,056 rows (91.6%),
// and three of the six worst issnpx filings by blank votes are this shape.
//
// Only a line that is EXACTLY cells qualifies: a leftover token means this is
// ordinary wrapped text and the caller must not treat it as the row's columns.
func issPeelTrailingCells(rest string) (mgmt, cast, sponsor string, ok bool) {
	toks := strings.Fields(rest)
	if len(toks) == 0 {
		return "", "", "", false
	}
	sponsor, toks, ok = issPeelCell(toks, issSponsors)
	if !ok {
		return "", "", "", false
	}
	cast, toks, ok = issPeelVote(toks)
	if !ok {
		return "", "", "", false
	}
	if cell, remaining, found := issPeelVote(toks); found {
		mgmt, toks = cell, remaining
	}
	if !issDigitCellsAgree(mgmt, cast) {
		return "", "", "", false
	}
	return mgmt, cast, sponsor, len(toks) == 0
}

// issPeelCell removes the longest run of trailing tokens that spells a value in
// vocab, preserving the filing's own capitalization in what it returns.
func issPeelCell(toks []string, vocab map[string]bool) (cell string, remaining []string, ok bool) {
	max := issMaxCellWords
	if max > len(toks) {
		max = len(toks)
	}
	for n := max; n >= 1; n-- {
		candidate := strings.Join(toks[len(toks)-n:], " ")
		if vocab[strings.ToLower(strings.Trim(candidate, issCellTrim))] {
			return candidate, toks[:len(toks)-n], true
		}
	}
	return "", toks, false
}

// issPeelVote is issPeelCell against the vote vocabulary, plus the one vote form
// that cannot be a vocabulary entry because its value is a NUMBER:
//
//	1  Approve Investment Advisory Agreement  For  F=85.71%  Management
//
// The letter names the choice -- F for, A against, W withheld -- and the
// percentage is the share of the fund's holding that voted it. One filing prints
// it on 5,966 of its 23,702 rows. Only votes admit the form; a sponsor is never
// a percentage, which is why this wraps the vote peel and not issPeelCell.
func issPeelVote(toks []string) (cell string, remaining []string, ok bool) {
	if cell, rest, ok := issPeelCell(toks, issVoteValues); ok {
		return cell, rest, true
	}
	if len(toks) > 0 && (issPercentVote(toks[len(toks)-1]) || issFrequencyVote(toks[len(toks)-1])) {
		return toks[len(toks)-1], toks[:len(toks)-1], true
	}
	// A comma-separated labelled distribution, `F=94%, AB=6%`: the same fact
	// as the one-token form, with several labels. The run is taken from the
	// right; every token must be a labelled percentage.
	n := 0
	for n < len(toks) && issLabelledPercentToken(toks[len(toks)-1-n]) {
		n++
	}
	// A trailing comma means the cell CONTINUES on the next line; the wrapped
	// halves are reunited by issJoinWrappedVote, not here.
	if n >= 2 && !strings.HasSuffix(toks[len(toks)-1], ",") {
		return strings.Join(toks[len(toks)-n:], " "), toks[:len(toks)-n], true
	}
	return "", toks, false
}

// issLabelledPercentToken recognises one item of a labelled distribution:
// `F=94%,` or `AB=6%` -- a short label, an equals sign, a percentage and an
// optional trailing comma.
func issLabelledPercentToken(s string) bool {
	s = strings.TrimSuffix(s, ",")
	label, pct, cut := strings.Cut(s, "=")
	if !cut || label == "" || len(label) > 3 {
		return false
	}
	for _, r := range label {
		if r < 'A' || (r > 'Z' && r < 'a') || r > 'z' {
			return false
		}
	}
	return issPercentCell(pct)
}

// issLabelledDistribution recognises a whole cell in that form, however many
// labels it carries: every space-separated token is a labelled percentage.
func issLabelledDistribution(s string) bool {
	parts := strings.Fields(s)
	if len(parts) == 0 {
		return false
	}
	for _, p := range parts {
		if !issLabelledPercentToken(p) {
			return false
		}
	}
	return true
}

// issFrequencyVote recognises the say-on-pay frequency answer printed as a bare
// number of years -- `3  3  Management`, `F  1  Management` -- 446 rows on one
// registrant's filings and 38 in the second form, placed by the shape finder
// 2026-09-01. Only 1, 2 and 3 are answers to that question.
//
// A digit is not admitted on its own: a proposal's text can end in one (`Amend
// Article 3`) and a peel that stopped there would report the vote of a row that
// printed none. issDigitCellsAgree is the guard, applied wherever two cells are
// peeled: the digit is a vote only beside a Mgt Rec, and a Mgt Rec only beside
// a digit vote.
func issFrequencyVote(s string) bool {
	return s == "1" || s == "2" || s == "3"
}

// issDigitCellsAgree reports whether a peeled (mgmt, cast) pair may stand when
// one of them is a bare digit. See issFrequencyVote.
func issDigitCellsAgree(mgmt, cast string) bool {
	if issFrequencyVote(cast) && mgmt == "" {
		return false
	}
	// A digit recommendation may also stand beside a ONE-LETTER vote code
	// (`1  F  Management`, 57 rows): no proposal text ends in a bare digit
	// followed by a lettered vote and a sponsor.
	if issFrequencyVote(mgmt) && !issFrequencyVote(cast) && len(cast) != 1 {
		return false
	}
	return true
}

// issPercentVote recognises `F=85.71%`, `A=6.04%`, `W=7.68%` -- a choice letter,
// an equals sign, a number and a percent sign, and nothing else.
func issPercentVote(s string) bool {
	if !strings.HasSuffix(s, "%") {
		return false
	}
	i := strings.IndexByte(s, '=')
	if i != 1 {
		return false
	}
	switch s[0] {
	case 'F', 'A', 'W', 'N', 'f', 'a', 'w', 'n':
	default:
		return false
	}
	body := s[2 : len(s)-1]
	if body == "" {
		return false
	}
	dots := 0
	for j := 0; j < len(body); j++ {
		switch {
		case body[j] >= '0' && body[j] <= '9':
		case body[j] == '.':
			dots++
			if dots > 1 {
				return false
			}
		default:
			return false
		}
	}
	return true
}

// issDate normalizes the report's date spellings onto YYYYMMDD. The month-name
// form ("FEB 28, 2017") is handled here; numeric forms fall through to the
// shared normalizer so the column never mixes formats.
func issDate(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	fields := strings.FieldsFunc(s, func(r rune) bool {
		return r == ' ' || r == ',' || r == '\t'
	})
	if len(fields) == 3 {
		key := strings.ToLower(fields[0])
		if len(key) >= 3 {
			if m, ok := issMonths[key[:3]]; ok {
				day, derr := strconv.Atoi(fields[1])
				year, yerr := strconv.Atoi(fields[2])
				if derr == nil && yerr == nil && day >= 1 && day <= 31 && year >= 1000 {
					return issPad4(year) + issPad2(m) + issPad2(day)
				}
			}
		}
	}
	return xmlDate(issFirstField(s))
}

// issFirstField takes the leading whitespace-delimited token, which is how a
// value is isolated from trailing filler on a fixed-width line.
func issFirstField(s string) string {
	f := strings.Fields(s)
	if len(f) == 0 {
		return ""
	}
	return f[0]
}

func issPad2(v int) string {
	if v < 10 {
		return "0" + strconv.Itoa(v)
	}
	return strconv.Itoa(v)
}

func issPad4(v int) string {
	s := strconv.Itoa(v)
	for len(s) < 4 {
		s = "0" + s
	}
	return s
}

// issRejoinWrappedLabels undoes the line wrapping an HTML converter applies to
// the ISS text report (Praxis Mutual Funds 2020, 16,447 rows with no issuer, id
// or date): `Ticker: ABT Security` / `ID: 002824100`, `Meeting Date:` / `APR 24,
// 2020 ...`, `Record Date: FEB` / `26, 2020`. Only these three shapes join, each
// on evidence from both lines, so an ordinary report is untouched.
func issRejoinWrappedLabels(lines []string) []string {
	out := make([]string, 0, len(lines))
	for i := 0; i < len(lines); i++ {
		cur := strings.TrimRight(lines[i], " \t\r")
		if i+1 < len(lines) {
			next := strings.TrimSpace(lines[i+1])
			up := strings.ToUpper(strings.TrimSpace(cur))
			join := false
			switch {
			case strings.HasSuffix(up, " SECURITY") && strings.HasPrefix(strings.ToUpper(next), "ID:"):
				join = true
			case (strings.HasSuffix(up, "MEETING DATE:") || strings.HasSuffix(up, "RECORD DATE:")) && issStartsWithMonthOrDigit(next):
				join = true
			case issEndsWithMonth(up) && len(next) > 0 && next[0] >= '0' && next[0] <= '9':
				join = true
			}
			if join {
				out = append(out, cur+" "+next)
				i++
				continue
			}
		}
		out = append(out, lines[i])
	}
	return out
}

func issStartsWithMonthOrDigit(s string) bool {
	if s == "" {
		return false
	}
	if s[0] >= '0' && s[0] <= '9' {
		return true
	}
	f := strings.Fields(strings.ToUpper(s))
	return len(f) > 0 && issMonthWord(f[0])
}

func issEndsWithMonth(up string) bool {
	f := strings.Fields(up)
	return len(f) > 1 && issMonthWord(f[len(f)-1]) && strings.Contains(up, "DATE:")
}

func issMonthWord(w string) bool {
	w = strings.TrimRight(w, ".,")
	switch w {
	case "JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "SEPT", "OCT", "NOV", "DEC",
		"JANUARY", "FEBRUARY", "MARCH", "APRIL", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER":
		return true
	}
	return false
}

// issTruncatedBannerOpener reads the FIRST line of a two-line '=' band that the
// filer's own wrapping cut one column short of its closing border (BlackRock
// Variable Series Funds 2007, source lines 42845-42846):
//
//	========= BlackRock VARIABLE SERIES FUNDS, INC.: BlackRock LARGE CAP CORE V.I.
//	=========                             FUND                             =========
//
// The opener carries no closing run, so issFundSeparator does not see a band and
// issOpenBanner -- which wants a BARE rule below -- refuses the complete rule
// that follows. The continuation then stands as a banner of its own whose whole
// name is the stray word `FUND`, and the 1,128 rows beneath it file under that
// with no series at all.
//
// Narrow on purpose: the line must open on a full rule, must NOT end on '=' (so
// every properly bordered band, one-line or two-line, is still read by
// issFundSeparator before this is ever reached), its text must hold no '=' and
// must be name-like, and the very next line -- no blank gap -- must itself be a
// complete band carrying text, which is the continuation this opener is missing.
func issTruncatedBannerOpener(line string, lines []string, i int) (string, bool) {
	n := len(line)
	if n == 0 || line[0] != '=' || line[n-1] == '=' {
		return "", false
	}
	lead := 0
	for lead < n && line[lead] == '=' {
		lead++
	}
	if lead < issBannerMinEquals {
		return "", false
	}
	name := strings.TrimSpace(line[lead:])
	if name == "" || strings.Contains(name, "=") || !issNameLike(name) {
		return "", false
	}
	if i+1 >= len(lines) {
		return "", false
	}
	if cont, ok := issFundSeparator(strings.TrimSpace(lines[i+1])); !ok || cont == "" {
		return "", false
	}
	return name, true
}

// issOpenBanner reads a banner whose closing rule wrapped onto the next line:
// `======================= SUMMIT BALANCED INDEX PORTFOLIO` over a bare
// `========================` (Summit Mutual Funds 2005, 43,263 rows with no
// fund on r204). The opening run must be a rule on its own, the text must hold
// no '=', and the next non-blank line must be a bare rule.
func issOpenBanner(line string, lines []string, i int) (string, bool) {
	lead := 0
	for lead < len(line) && line[lead] == '=' {
		lead++
	}
	if lead < issBannerMinEquals || lead == len(line) {
		return "", false
	}
	name := strings.TrimSpace(line[lead:])
	if name == "" || strings.Contains(name, "=") {
		return "", false
	}
	for j := i + 1; j < len(lines); j++ {
		next := strings.TrimSpace(lines[j])
		if next == "" {
			continue
		}
		if n, ok := issFundSeparator(next); ok && n == "" {
			return name, true
		}
		// A long open banner may wrap its trailing former-name clause onto one
		// unruled line before the bare closing rule.
		if strings.Contains(next, "=") {
			return "", false
		}
		for k := j + 1; k < len(lines); k++ {
			close := strings.TrimSpace(lines[k])
			if close == "" {
				continue
			}
			if n, ok := issFundSeparator(close); ok && n == "" {
				return name + " " + next, true
			}
			return "", false
		}
		return "", false
	}
	return "", false
}

// issRuledSandwichBanner reads a fund printed in a three-line ruled sandwich:
// a bare rule, the fund alone on an unruled line, a second bare rule (American
// Beacon Funds 2005, 1,867 rows carrying no fund name at all). It is the mirror
// of issOpenBanner, whose opening rule carries the name; here both rules are
// bare, so issFundSeparator reads each as a boundary with no name and the text
// between them is read as prose.
//
// All three conditions are required together -- the opening bare rule, a next
// non-blank line holding no '=', and a following non-blank line that is another
// bare rule -- so ordinary prose between two rules is never claimed.
func issRuledSandwichBanner(lines []string, i int) (string, bool) {
	if n, ok := issFundSeparator(strings.TrimSpace(lines[i])); !ok || n != "" {
		return "", false
	}
	j := i + 1
	for j < len(lines) && strings.TrimSpace(lines[j]) == "" {
		j++
	}
	if j >= len(lines) {
		return "", false
	}
	name := strings.TrimSpace(lines[j])
	if name == "" || strings.Contains(name, "=") {
		return "", false
	}
	k := j + 1
	for k < len(lines) && strings.TrimSpace(lines[k]) == "" {
		k++
	}
	if k >= len(lines) {
		return "", false
	}
	if n, ok := issFundSeparator(strings.TrimSpace(lines[k])); !ok || n != "" {
		return "", false
	}
	return name, true
}

// issDeclaredToken reports a word any declared name carries, which is therefore
// evidence about which series a heading means and may never be dropped as brand.
func issDeclaredToken(ix *issSeriesIndex, tok string) bool {
	for i := range ix.decls {
		for _, t := range ix.declToks(i) {
			if t == tok {
				return true
			}
		}
	}
	return false
}
