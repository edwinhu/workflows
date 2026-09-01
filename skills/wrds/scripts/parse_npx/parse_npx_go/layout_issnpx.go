package main

import (
	"regexp"
	"strconv"
	"strings"
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
var issItemRe = regexp.MustCompile(`^\d+(\.+\d+)*[A-Za-z]?[.)]?$`)

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
	"withhold": true, "withheld": true, "split": true, "none": true,
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
	// in that filing's own bytes: F 5,637, A 59, N 9, D 7. W does not appear and
	// is not admitted, because the vocabulary records what the corpus prints
	// rather than what an alphabet suggests.
	"f": true, "a": true, "n": true, "d": true,
	// `No` in the Vote Cast column -- the fund did not vote the item. The shared
	// howVotedVocabulary in the test suite already recognised NO, so the two
	// lists had drifted apart; one filing prints it on 5,941 rows.
	"no":    true,
	"refer": true, "unvoted": true, "n/a": true, "na": true, "tna": true,
	"do not vote": true, "take no action": true, "no action": true,
	"did not vote": true, "non voting": true, "non-voting": true,
	"one year": true, "two years": true, "three years": true,
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
	seriesIdx := seriesByName(meta.SeriesDecls)

	// The registrant name is a per-filing constant, so it is folded once here
	// rather than once per banner: normalising it inside the lookup made the strip
	// cost O(banners x len(COMPANY CONFORMED NAME)), and both of those grow with
	// the same untrusted file.
	registrantKey := normalizeSeriesName(meta.CompanyName)

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
		cur     *issRowBuf

		// blankRun counts CONSECUTIVE blank lines, so an incomplete row may
		// survive the single `&nbsp;` paragraph that separates it from its
		// wrapped tail without surviving a real gap in the document.
		blankRun int
	)

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
			})
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
		name, d := issResolveFund(seriesIdx, strings.Join(bannerBuf, " "), registrantKey)
		bannerBuf = bannerBuf[:0]
		fund = name
		fundSeries, fundClasses = "", ""
		if d != nil {
			fundSeries = d.SeriesID
			fundClasses = strings.Join(d.ClassIDs, MultiValueSep)
		}
	}

	lines := strings.Split(text, "\n")
	for i := 0; i < len(lines); i++ {
		line := strings.TrimSpace(lines[i])

		if name, ok := issFundSeparator(line); ok {
			flush()
			inTable = false
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
			inTable = false
			ticker, cusip = tk, id
			issuer = lastLine
			mtgDate, mtgType, recDate = "", "", ""
			continue
		}
		if d, typ, ok := issMeetingLine(line); ok {
			flush()
			inTable = false
			mtgDate, mtgType = d, typ
			continue
		}
		if d, ok := issRecordLine(line); ok {
			flush()
			inTable = false
			recDate = d
			continue
		}
		if issTableHeader(line) {
			flush()
			inTable = true
			continue
		}
		// A FOREIGN COLUMN HEADER CLOSES OUR TABLE. Everything below it belongs
		// to a grammar this layout cannot read, and reading it anyway attributed
		// one issuer's votes to another -- see issForeignTableHeader.
		if issForeignTableHeader(line) {
			flush()
			inTable = false
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
		if item != "" && inTable && cur != nil {
			toks := strings.Fields(rest)
			if _, _, sponsored := issPeelCell(toks, issSponsors); !sponsored {
				if _, _, voted := issPeelVote(toks); !voted {
					item, rest = "", line
				}
			}
		}

		if item != "" {
			flush()
			cur = &issRowBuf{item: strings.TrimRight(item, ".)")}
		} else if cur == nil {
			// A non-item line with no row open is not a continuation: the table
			// has ended and this is the next meeting's issuer name.
			lastLine = line
			continue
		} else if cur.complete() {
			// The open row already carries its trailing cells, so this line is
			// the wrapped tail of the proposal and is text only. It is never
			// peeled, even when it is exactly a vocabulary word.
			if tail := strings.TrimSpace(rest); tail != "" {
				cur.text = append(cur.text, tail)
			}
			continue
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
			// vote's head is at the edge to be found.
			prev := strings.Fields(cur.text[len(cur.text)-1])
			sp, prev, haveSponsor := issPeelCell(prev, issSponsors)
			if vote, prevKeep, contKeep, joined := issJoinWrappedVote(prev, strings.Fields(rest)); haveSponsor && joined {
				cur.sponsor = sp
				if mg, remaining, found := issPeelVote(prevKeep); found {
					cur.mgmt, prevKeep = mg, remaining
				}
				cur.cast = vote
				cur.text[len(cur.text)-1] = strings.Join(prevKeep, " ")
				if tail := strings.Join(contKeep, " "); tail != "" {
					cur.text = append(cur.text, tail)
				}
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
					if !issVoteValues[strings.ToLower(strings.Trim(candidate, ".,;"))] {
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
func issResolveFund(idx map[string]*SeriesDecl, banner, registrantKey string) (string, *SeriesDecl) {
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
	if !issStripRegistrantPrefix {
		return banner, nil
	}
	return banner, lookupSeriesStrippingRegistrant(idx, banner, registrantKey)
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

	if !strings.Contains(up, "PROPONET") && !strings.Contains(up, "PROPONENT") {
		return false
	}
	return strings.Contains(up, "ITEM") || strings.Contains(up, "NUMBER") ||
		strings.Contains(up, "SHARES") || strings.Contains(up, "PROPOSAL")
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

// issSplitItem separates a leading item number from the rest of a table line.
// No item number means the line continues the row above it.
func issSplitItem(line string) (item, rest string) {
	parts := strings.SplitN(line, " ", 2)
	if len(parts) == 2 && issItemRe.MatchString(parts[0]) {
		return parts[0], strings.TrimSpace(parts[1])
	}
	return "", line
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
			if issVoteValues[strings.ToLower(strings.Trim(candidate, ".,;"))] {
				return candidate, prev[:len(prev)-k], cont[:len(cont)-m], true
			}
		}
	}
	return "", prev, cont, false
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
		return strings.TrimSpace(rest), "", "", ""
	}
	if len(toks) > 0 {
		if cell, remaining, found := issPeelVote(toks); found {
			mgmt, toks = cell, remaining
		}
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
		if vocab[strings.ToLower(strings.Trim(candidate, ".,;"))] {
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
	if len(toks) > 0 && issPercentVote(toks[len(toks)-1]) {
		return toks[len(toks)-1], toks[:len(toks)-1], true
	}
	return "", toks, false
}

// issPercentVote recognises `F=85.71%`, `A=6.04%`, `W=7.68%` -- a choice letter,
// an equals sign, a number and a percent sign, and nothing else.
func issPercentVote(s string) bool {
	i := strings.IndexByte(s, '=')
	if i != 1 || !strings.HasSuffix(s, "%") {
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
