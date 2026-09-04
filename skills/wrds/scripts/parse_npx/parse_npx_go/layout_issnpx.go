package main

import (
	"regexp"
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
func parseISSNPX(text string, meta FilingMeta) ([]VoteRow, error) {
	// The header declares a <SERIES-ID>/<SERIES-NAME> pair per series and the body
	// prints a fund heading, so the name is the bridge between a vote and its
	// series id. A heading that names no declared series, or one two series answer
	// to, resolves to "" and the row is emitted with an empty series_id: the
	// chassis still stamps single-series filings, and nothing here guesses.
	seriesIx := newISSSeriesIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName))
	issFormerKeys(seriesIx, meta.FormerNames)

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
		}
		cur = nil
	}

	// A fund name that wrapped is spread over consecutive rule lines, so the name
	// is accumulated here and only becomes the fund once the wrap has ended.
	// Bounded by issMaxBannerLines.
	var bannerBuf []string

	commitBanner := func() {
		if len(bannerBuf) == 0 {
			return
		}
		name, d := issResolveFund(seriesIx, strings.Join(bannerBuf, " "))
		bannerBuf = bannerBuf[:0]
		fund = name
		fundSeries, fundClasses = "", ""
		if d != nil {
			fundSeries = d.SeriesID
			fundClasses = strings.Join(d.ClassIDs, MultiValueSep)
		}
	}

	lines := issRejoinWrappedLabels(strings.Split(text, "\n"))
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])

		if name, ok := issFundSeparator(line); ok {
			flush()
			inTable, tailRow = false, -1
			if name == "" {
				// A bare rule closes any banner still accumulating above it, so a
				// name never joins across a divider.
				commitBanner()
			} else {
				if len(bannerBuf) >= issMaxBannerLines {
					commitBanner()
				}
				bannerBuf = append(bannerBuf, name)
				if !issBannerContinues(lines, i+1) {
					commitBanner()
				}
			}
			issuer, ticker, cusip = "", "", ""
			mtgDate, mtgType, recDate = "", "", ""
			lastLine = ""
			continue
		}
		// A banner cannot span anything but rule lines. Any other line ends it,
		// including one the loop below goes on to ignore.
		if len(bannerBuf) > 0 {
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

		// Meeting headers. A Ticker/Security ID line opens a new meeting, so it
		// closes any table still open above it and claims the last free-standing
		// line as the issuer name.
		if tk, id, ok := issTickerLine(line); ok {
			flush()
			inTable, tailRow = false, -1
			ticker, cusip = tk, id
			issuer = lastLine
			mtgDate, mtgType, recDate = "", "", ""
			continue
		}
		if d, typ, ok := issMeetingLine(line); ok {
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

// issSeriesIndex is the per-filing bridge from a printed fund heading to a
// declared series: the exact index seriesByName builds, and the registrant's
// own name folded once, since it is constant across every banner in the
// filing.
type issSeriesIndex struct {
	byName        map[string]*SeriesDecl
	registrantKey string
	// formerKeys are the registrant's FORMER CONFORMED NAMEs, normalised; the
	// registrant-prefix strip tries each of them after the current name.
	formerKeys []string

	// byCompact keys the same names with their spaces removed, for a banner
	// that spaces a token the header runs together (`Russell 2000` against
	// `Russell2000`). lessBrand keys each declared name with a leading run of
	// the registrant's own tokens removed (`Penn Series Small Cap Index Fund`
	// under `small cap index fund` for the registrant PENN SERIES FUNDS INC),
	// and brands holds those runs, longest first, for the banner-side strip.
	// Every map refuses on collision the way seriesByName does: a key two
	// distinct series answer to maps to nil, and nil is never stamped.
	byCompact map[string]*SeriesDecl
	lessBrand map[string]*SeriesDecl
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
	lessBrandFull map[string]*SeriesDecl
	lessBrandType map[string]*SeriesDecl
	lessParen     map[string]*SeriesDecl // declared names with a trailing parenthetical removed
	brands        []string
	// lessSuffix keys the declared names with their common last word removed,
	// built ONLY when every declared name (two at least) ends in the same word:
	// the College Retirement Equities Fund declares `<name> Account` throughout
	// and prints its banners without it. A fact of the filing's own header,
	// not a tolerance; nil when the names do not all agree.
	lessSuffix map[string]*SeriesDecl
	// lessTypeWord keys the declared names with the registrant's own last
	// token removed from WHEREVER it sits ("500 Index Trust B" under "500
	// index b" for JOHN HANCOCK VARIABLE INSURANCE TRUST), built only when
	// two thirds of the declared names carry that token; nil otherwise.
	lessTypeWord map[string]*SeriesDecl
}

// issFormerKeys normalises the header's former conformed names for the index.
func issFormerKeys(ix *issSeriesIndex, former []string) {
	for _, f := range former {
		if k := normalizeSeriesName(f); k != "" && k != ix.registrantKey {
			ix.formerKeys = append(ix.formerKeys, k)
		}
	}
}

func newISSSeriesIndex(decls []SeriesDecl, registrantKey string) *issSeriesIndex {
	ix := &issSeriesIndex{
		byName:        seriesByName(decls),
		registrantKey: registrantKey,
		byCompact:     make(map[string]*SeriesDecl, len(decls)),
		lessBrand:     make(map[string]*SeriesDecl),
		lessParen:     make(map[string]*SeriesDecl),
		lessAnd:       make(map[string]*SeriesDecl),
		lessBrandFull: make(map[string]*SeriesDecl),
		lessBrandType: make(map[string]*SeriesDecl),
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
			if acr := issInitials(toks[:2]); len(acr) == 2 {
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
			if len(t) >= 6 && !issGenericRegistrantWord[t] {
				ix.brands = append(ix.brands, t)
			}
		}
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
				if r2, ok := issDropTypeWord(rest); ok {
					put(ix.lessBrandType, r2, d)
				}
			}
		}
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		key := normalizeSeriesName(d.Name)
		put(ix.byCompact, strings.ReplaceAll(key, " ", ""), d)
		for _, b := range ix.brands {
			if rest, ok := strings.CutPrefix(key, b+" "); ok {
				put(ix.lessBrand, rest, d)
			}
		}
		if cut, ok := issCutTrailingParenthetical(d.Name); ok {
			put(ix.lessParen, normalizeSeriesName(cut), d)
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
		ix.lessSuffix = make(map[string]*SeriesDecl)
		for i := range decls {
			d := &decls[i]
			if d.SeriesID == "" || d.Name == "" {
				continue
			}
			key := normalizeSeriesName(d.Name)
			if rest, ok := strings.CutSuffix(key, " "+suffix); ok && rest != "" {
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

// issInitials builds the acronym a registrant makes of its own name: the first
// letter of each token, except that a Roman numeral token is kept whole
// ("John Hancock Funds II" -> "jhfii"). Tokens are already normalised.
func issInitials(toks []string) string {
	var b strings.Builder
	for _, t := range toks {
		if issRomanNumeral(t) {
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

// issCutSubAdviser removes the labelled sub-adviser clause one registrant
// appends to every fund heading -- `AST Goldman Sachs Multi Asset Portfolio -
// Sub-Adviser: Goldman Sachs` for a series declared without it. The label is
// what makes this a deletion rather than a tolerance: only text after the
// literal `Sub-Adviser:` (or `Subadviser:`) is dropped, with the dash before
// it. ~1.5M rows across five Advanced Series Trust filings, 2026-09-02.
func issCutSubAdviser(banner string) (string, bool) {
	low := strings.ToLower(banner)
	for _, label := range []string{"sub-adviser:", "subadviser:", "sub adviser:", "sub-advisor:", "subadvisor:"} {
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
	return "", false
}

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
	idx, registrantKey := ix.byName, ix.registrantKey
	d, declared := lookupSeriesEntry(idx, banner)

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
	// A sleeve suffix: `PSF Flexible Managed Portfolio Equity Sleeve` for a
	// declared `Flexible Managed Portfolio` (Prudential Series Fund 2015, 15k
	// rows with no fund). The last two words go, then the ordinary rules.
	if f := strings.Fields(banner); len(f) > 3 && strings.EqualFold(f[len(f)-1], "sleeve") {
		if _, d := issResolveFund(ix, strings.Join(f[:len(f)-2], " ")); d != nil {
			return banner, d
		}
	}
	// A type word the heading adds and the declared name lacks: `PGIM Ultra
	// Short Bond ETF Fund` for `PGIM Ultra Short Bond ETF` (PGIM ETF Trust,
	// 67k rows with no fund). Exact after dropping the last word.
	if f := strings.Fields(banner); len(f) > 2 {
		switch strings.ToLower(strings.Trim(f[len(f)-1], ".,")) {
		case "fund", "portfolio", "trust":
			// Exact or brand-cut only, and never against a declared name that
			// carries a type word of its own: a heading may ADD a word the
			// declared name lacks, never replace one (`Total Bond Market Fund`
			// is not `Total Bond Market Trust`). `Target Large Capitalization
			// Growth Portfolio` for `LARGE CAPITALIZATION GROWTH` (Target
			// Portfolio Trust, 35k rows) is the brand case.
			if d := issExactOrBrandUntyped(ix, strings.Join(f[:len(f)-1], " ")); d != nil {
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
		// The registrant's FORMER conformed names, which the SGML header also
		// declares: John Hancock Variable Insurance Trust 2012 still heads
		// funds `John Hancock Trust Balanced Trust`.
		for _, fk := range ix.formerKeys {
			if d := lookupSeriesStrippingRegistrant(idx, banner, fk); d != nil {
				return banner, d
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
	// comes off and the remainder goes through the whole chain again.
	if f := strings.Fields(banner); len(f) > 1 && internalFundCode(strings.Trim(f[0], "()")) {
		if _, d := issResolveFund(ix, strings.Join(f[1:], " ")); d != nil {
			return banner, d
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

	// A trailing parenthetical on the banner.
	if cut, ok := issCutTrailingParenthetical(banner); ok {
		if _, d := issResolveFund(ix, cut); d != nil {
			return banner, d
		}
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
	for _, sep := range []string{" - ", "- ", ": "} {
		if head, tail, ok := strings.Cut(banner, sep); ok && strings.TrimSpace(head) != "" && strings.TrimSpace(tail) != "" {
			if d := lookupSeriesByName(idx, head); d != nil {
				return banner, d
			}
			if d := lookupSeriesByName(idx, tail); d != nil {
				return banner, d
			}
			// The head may still carry a brand or code: `PSF Jennison 20/20
			// Focus Portfolio - Value` (Prudential Series Fund). The other
			// rules run on it; the head has no dash of its own, so this ends.
			if !strings.Contains(head, "- ") {
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
		return banner, d
	}

	// The banner spaces a token the header runs together.
	if d, seen := ix.byCompact[strings.ReplaceAll(key, " ", "")]; seen {
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

	// The last word every declared name shares, missing from the banner.
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
		}
	}
	return banner, nil
}

// issCutBrand removes brand from the front of a normalised key on a whole-token
// boundary. The brand may be printed as one token or spelled over several --
// John Hancock Funds II prints both `JHFII` and `JHF II` -- so the leading
// tokens are also tried joined.
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
	return strings.TrimSpace(line[lead : n-trail]), true
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
	return ok && name != ""
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

// issGenericRegistrantWord lists registrant tokens too common to be a brand.
var issGenericRegistrantWord = map[string]bool{
	"funds": true, "trust": true, "series": true, "company": true, "portfolio": true,
	"portfolios": true, "investment": true, "investments": true, "insurance": true,
	"variable": true, "products": true, "capital": true, "management": true,
	"financial": true, "securities": true, "income": true, "equity": true, "growth": true,
	"international": true, "global": true, "american": true, "national": true,
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
// 2-6 letters or digits carrying at least one digit (`2DCN`, `3347`, `ZW4X`), or
// any 2-6 letter/digit run in parentheses (`(ZW4X)`). A plain word is never a
// code, so `Growth Emerging Markets Value Fund` keeps its first word.
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
	if len(tok) < 2 || len(tok) > 6 {
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

// issTickerLine parses 'Ticker: <t>   Security ID: <id>'. CUSIP: appears as an
// alternate spelling of the same field in some vintages.
func issTickerLine(line string) (ticker, id string, ok bool) {
	up := strings.ToUpper(line)
	ti := strings.Index(up, "TICKER:")
	if ti < 0 {
		return "", "", false
	}
	si := strings.Index(up, "SECURITY ID:")
	label := len("SECURITY ID:")
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

// issMeetingLine parses 'Meeting Date: <date>   Meeting Type: <type>'.
func issMeetingLine(line string) (date, typ string, ok bool) {
	up := strings.ToUpper(line)
	di := strings.Index(up, "MEETING DATE:")
	if di < 0 {
		return "", "", false
	}
	rest := line[di+len("MEETING DATE:"):]
	if ti := strings.Index(strings.ToUpper(rest), "MEETING TYPE:"); ti >= 0 {
		typ = strings.TrimSpace(rest[ti+len("MEETING TYPE:"):])
		rest = rest[:ti]
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
