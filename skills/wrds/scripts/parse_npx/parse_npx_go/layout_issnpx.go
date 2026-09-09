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
		if !ok && len(bannerBuf) > 0 {
			name, ok = issThinBannerContinuation(lines, i)
		}
		if !ok && line != "" && i+2 < len(lines) && issReportTitleLine(strings.TrimSpace(lines[i+1])) {
			period := strings.Split(strings.TrimSpace(lines[i+2]), "-")
			if len(period) == 2 && htmlDate(period[0]) != "" && htmlDate(period[1]) != "" {
				name, ok = line, true
			}
		}
		if !ok && line != "" && i+1 < len(lines) && strings.TrimSpace(lines[i+1]) == "" {
			// A bare paragraph is a boundary only on an exact, unique name.
			if d, _ := lookupSeriesEntry(seriesIx.byName, line); d != nil {
				name, ok = line, true
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
				bannerBuf = append(bannerBuf, name)
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
				if issBannerWrapVisible(strings.Join(bannerBuf, " "), issNextBannerName(lines, i+1)) {
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
	// byTicker keys each class ticker the header declares, upper-cased, to its
	// series; a ticker two series share is dropped rather than guessed.
	byTicker map[string]*SeriesDecl
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
	// commonSuffix is the last word every declared name shares, kept so a
	// heading that DROPS it can be retried with it appended.
	commonSuffix string
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
		lessLeadTokenAnyType: make(map[string]*SeriesDecl),
		lessBrandTypeCompact: make(map[string]*SeriesDecl),
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
			}
		}
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		key := normalizeSeriesName(d.Name)
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
	// AIM's 2004 filings head their sections with the predecessor INVESCO
	// brand and declare the same funds under the successor AIM name:
	// `INVESCO Dynamics Fund` for `AIM Dynamics Fund` (S000000163). The stem
	// after the brand must still agree whole.
	for _, brand := range []string{"invesco ", "aim "} {
		if stem, ok := strings.CutPrefix(key, brand); ok && stem != "" {
			return "invesco aim:" + stem
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
	idx, registrantKey := ix.byName, ix.registrantKey
	d, declared := lookupSeriesEntry(idx, banner)
	// A heading that is exactly one declared class ticker (`RWL`, RevenueShares
	// 2012, 18,687 rows with no series): the header's own evidence, exact.
	if d == nil {
		if t := strings.ToUpper(strings.TrimSpace(banner)); t != "" && !strings.ContainsAny(t, " \t") && len(t) <= 6 {
			if td, ok := ix.byTicker[t]; ok {
				return banner, td
			}
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
	}
	// The heading spells out a word the declared name abbreviates: `Generation
	// Z ETF` for a declared `The Gen Z ETF` (S000074694). Exactly one token may
	// differ, the declared token must abbreviate the printed one, and two
	// declared names answering to the heading stamp nothing.
	if d := issDeclaredAbbrevWord(ix, normalizeSeriesName(banner)); d != nil {
		return banner, d
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
	if strings.Contains(registrantKey, "john hancock") {
		if f := strings.Fields(banner); len(f) > 1 && strings.EqualFold(f[0], "JHF") {
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
	if f := strings.Fields(banner); len(f) > 2 {
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
	seriesCandidate := banner
	if cut, ok := issCutTrailingParenthetical(banner); ok {
		if _, d := issResolveFund(ix, cut); d != nil {
			return banner, d
		}
		seriesCandidate = cut
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
	if d, seen := ix.lessLeadCompact[compactKey]; seen {
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
		if d, seen := ix.lessLeadCompact[restCompact]; seen && d != nil {
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
			// The brand comes off BOTH sides: `RSI Core Equity Fund` for a
			// declared `RSI Retirement Trust - Core Equity Fund` (RSI
			// Retirement Trust 2004, 2,761 rows with no fund).
			if d, seen := ix.lessBrand[rest]; seen {
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
	if d := ix.lessLeadToken[key]; d != nil {
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
		if d := ix.lessLeadTokenAnyType[stem]; d != nil {
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
		if d := ix.lessLeadToken[rest]; d != nil {
			return banner, d
		}
	}

	// The registrant's own name, misspelled or one word short of the header's.
	if d := issNearMissDecl(ix, key); d != nil {
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
	// declared `... Equity Fund`, not a heading missing a word.
	if toks := strings.Fields(key); ix.commonSuffix != "" && len(toks) > 1 &&
		!issTypeWord(toks[len(toks)-1]) && toks[len(toks)-1] != ix.commonSuffix {
		if _, d := issResolveFund(ix, banner+" "+ix.commonSuffix); d != nil {
			return banner, d
		}
	}
	return banner, nil
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
	var found *SeriesDecl
	for name, d := range ix.byName {
		if d == nil {
			continue
		}
		cand := strings.Fields(name)
		k := 0
		for _, t := range cand {
			if k < len(stem) && t == stem[k] {
				k++
			}
		}
		if k != len(stem) {
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
		if found != nil && found.SeriesID != d.SeriesID {
			return nil // two declared names sit inside this heading; refuse to pick
		}
		found = d
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

// issInternalTokenDropDecl drops exactly one token that is neither the first nor
// the last of the key and retries the exact index. The first token carries the
// brand and the last the type word, so neither is ever cut here; two drops
// naming different series are a refusal.
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
		dk := normalizeSeriesName(ix.decls[i].Name)
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
			stem, typed := issDropTypeWord(normalizeSeriesName(d.Name))
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
		if !issNearMiss(banner, strings.Fields(normalizeSeriesName(d.Name))) {
			continue
		}
		if hit != nil && hit.SeriesID != d.SeriesID {
			return nil
		}
		hit = d
	}
	return hit
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
			if !issHasToken(normalizeSeriesName(d.Name), t) {
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
	return hit
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
		seen[pair] = true
		var owner *SeriesDecl
		ids := map[string]bool{}
		for j := range ix.decls {
			d := &ix.decls[j]
			if d.SeriesID == "" || d.Name == "" {
				continue
			}
			if !strings.Contains(" "+normalizeSeriesName(d.Name)+" ", " "+pair+" ") {
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
	return hit
}

// issRegistrantAbbrevSuffix folds an abbreviated registrant brand back into a
// heading: `sti classic international equity fund va` for the registrant `sti
// classic variable trust` becomes `sti classic variable trust international
// equity fund`. The heading must open on the registrant's own leading tokens and
// close on a token abbreviating the first word the heading dropped (`va` for
// `variable`), so only this registrant's own name is ever restored.
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
		dt := strings.Fields(normalizeSeriesName(d.Name))
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
		declKey := normalizeSeriesName(d.Name)
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
// next rule: an open parenthesis nobody closed, or a continuation that is one
// type word or a closing fragment on its own.
func issBannerWrapVisible(sofar, next string) bool {
	if strings.Count(sofar, "(") > strings.Count(sofar, ")") {
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
