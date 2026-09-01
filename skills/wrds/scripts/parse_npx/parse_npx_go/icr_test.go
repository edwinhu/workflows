package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The ISS "Investment Company Report" grammar was measured on 2026-08-30 over
// the 1,181 still-skipping filings carrying 50 or more vote-like lines: 144
// print the `Issue No.` column header and 79 the wrapped `Issue / No.` one,
// together 4,782,470 of the 7,851,449 lines those filings hold. No layout
// claimed any of them, so every row was lost as `skip`.
//
// Both fixtures are VERBATIM CONTIGUOUS byte ranges of real filings and every
// count below was read off those bytes by hand. Neither begins after the defect:
// each starts at the report's own `Item 1` / `Registrant Name` preamble, so the
// layout must find its first block header from the same place the corpus makes
// it find one.

type icrCase struct {
	file string
	// blocks maps each issuer the fixture prints to the number of item rows
	// under it, counted by hand from the fixture's own item numbers.
	blocks map[string]int
	rows   int
	note   string
}

var icrCases = []icrCase{
	{
		file: "ICR1_hartford_wide.txt",
		blocks: map[string]int{
			"3M Company":    14,
			"Accenture PLC": 12,
			"Ace Limited":   17,
		},
		rows: 43,
		note: "0001144204-11-049903 at the `Item 1. Proxy Voting Record` preamble;" +
			" three consecutive <TABLE> blocks in the `Issue No.` spelling",
	},
	{
		file: "ICR4_split_status.txt",
		blocks: map[string]int{
			"Anheuser-Busch Companies Inc": 14,
			"Archstone Smith Trust":        2,
		},
		rows: 16,
		note: "0000898432-08-000883, one of the 75 filings (1,014,379 vote-like lines)" +
			" whose `MEETING STATUS` prints with a wide gap inside it and so arrives as" +
			" TWO header cells; it also prints four INVERTED WRAPS, where the item number" +
			" and description sit alone and the value columns arrive up to four lines later",
	},
	{
		file: "ICR2_russell_wrapped.txt",
		blocks: map[string]int{
			"3M Company":                17,
			"Activision Blizzard, Inc.": 14,
		},
		rows: 31,
		note: "0001193125-12-366724 at `Registrant Name :`; the wrapped `Issue / No.`" +
			" spelling, and the fixture opens with a NIL-REPORT section whose prose" +
			" (`The fund did not vote proxies...`) must contribute no row and must not" +
			" be appended to any description",
	},
}

func loadICRFixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "icr", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(b)
}

// TestICRExtractsEveryItemRow is the coverage assertion. An exact count, not a
// floor: this grammar's failure mode is silent under-extraction -- a layout that
// closes its table on one unrecognised line loses the rest of the document --
// and a `>= 1` assertion would pass on the first block alone.
func TestICRExtractsEveryItemRow(t *testing.T) {
	for _, c := range icrCases {
		t.Run(c.file, func(t *testing.T) {
			rows := runISSNPXDoc(t, loadICRFixture(t, c.file))
			if len(rows) != c.rows {
				t.Errorf("got %d rows, want %d (%s)", len(rows), c.rows, c.note)
			}
			perIssuer := map[string]int{}
			for _, r := range rows {
				perIssuer[r[colIssuerName]]++
			}
			for issuer, want := range c.blocks {
				if got := perIssuer[issuer]; got != want {
					t.Errorf("issuer %q: got %d rows, want %d\n  issuers seen: %v",
						issuer, got, want, perIssuer)
				}
			}
		})
	}
}

// TestICRReadsEveryColumnFromItsOwnCell is the correctness assertion. The whole
// design claim is that the two-space gap collapseSpaces preserves IS the column
// boundary, so each value must come from the cell the filing printed it in. A
// row whose how_voted holds a word from the description is the defect this
// layout exists to avoid, and it would still pass a row COUNT.
func TestICRReadsEveryColumnFromItsOwnCell(t *testing.T) {
	rows := runISSNPXDoc(t, loadICRFixture(t, "ICR1_hartford_wide.txt"))
	want := map[string][6]string{
		// item, description, proponent, mgmt rec, how voted, issuer
		"3M Company|1":   {"1", "Elect Linda Alvarado", "Mgmt", "For", "For", "88579Y101"},
		"3M Company|13":  {"13", "Frequency of Advisory Vote on Executive Compensation", "Mgmt", "1 Year", "3 Years", "88579Y101"},
		"3M Company|14":  {"14", "Shareholder Proposal Regarding Political Contributions and Expenditure Report", "ShrHoldr", "Against", "Against", "88579Y101"},
		"Ace Limited|17": {"17", "Frequency of Advisory Vote on Executive Compensation", "Mgmt", "For", "1 Year", "H0023R105"},
	}
	got := map[string][6]string{}
	for _, r := range rows {
		got[r[colIssuerName]+"|"+r[colItemSeq]] = [6]string{
			r[colItemSeq], r[colVoteDescription], r[colVoteSource],
			r[colMgmtRec], r[colHowVoted], r[colCUSIP]}
	}
	for key, w := range want {
		g, ok := got[key]
		if !ok {
			t.Errorf("%s: no such row", key)
			continue
		}
		if g != w {
			t.Errorf("%s:\n  got  %q\n  want %q", key, g, w)
		}
	}
}

// TestICRCarriesMeetingIdentity pins the block header fields. They are link
// keys: a row attributed to the wrong meeting is worse than a row with a blank
// one, so these come from the block's own identity line and never from a
// neighbouring block's.
func TestICRCarriesMeetingIdentity(t *testing.T) {
	rows := runISSNPXDoc(t, loadICRFixture(t, "ICR2_russell_wrapped.txt"))
	want := map[string][3]string{
		"3M Company":                {"MMM", "20120508", "88579Y101"},
		"Activision Blizzard, Inc.": {"ATVI", "20120607", "00507V109"},
	}
	seen := map[string]bool{}
	for _, r := range rows {
		issuer := r[colIssuerName]
		w, ok := want[issuer]
		if !ok {
			t.Errorf("row attributed to unexpected issuer %q (item %q)", issuer, r[colItemSeq])
			continue
		}
		seen[issuer] = true
		if g := [3]string{r[colTicker], r[colMeetingDate], r[colCUSIP]}; g != w {
			t.Errorf("issuer %q item %q: got ticker/date/cusip %q, want %q",
				issuer, r[colItemSeq], g, w)
		}
	}
	for issuer := range want {
		if !seen[issuer] {
			t.Errorf("no row carries issuer %q", issuer)
		}
	}
}

// TestICRNeverSwallowsNilReportProse is the safety assertion for the
// continuation rule. ICR2 opens with a fund that reports no votes, and its prose
// sits between blocks with no item number and one cell -- exactly the shape of a
// wrapped description. Anchoring the continuation to the line DIRECTLY under its
// row is what separates them; an unanchored rule appends a sentence about not
// voting to a real vote's description.
func TestICRNeverSwallowsNilReportProse(t *testing.T) {
	doc := loadICRFixture(t, "ICR2_russell_wrapped.txt")
	if !strings.Contains(doc, "did not vote proxies") {
		t.Fatalf("fixture no longer carries the nil-report section; the assertion below proves nothing")
	}
	for _, r := range runISSNPXDoc(t, doc) {
		d := r[colVoteDescription]
		for _, bad := range []string{"did not vote", "In all markets", "Key-", "Fund Name", "Registrant"} {
			if strings.Contains(d, bad) {
				t.Errorf("item %q description absorbed non-row prose %q: %q", r[colItemSeq], bad, d)
			}
		}
	}
}

// TestICRDeclinesAForeignBlockHeader is the safety assertion that bounds what
// this layout may claim. ICR3 is a verbatim contiguous excerpt of
// 0001193125-15-299145, a filing in an unrelated grammar whose own header names
// the same three labels among nine columns:
//
//	INSTITUTIONAL ACCOUNT NAME  TICKER  COUNTRY  SECURITY ID  MEETING ID
//	  MEETING TYPE  MEETING DATE  RECORD DATE  STATUS
//
// A matcher that merely looked for the three labels claimed it, and the corpus
// run then produced 1,882 rows whose how_voted held description text
// (`Elect Director Orlando D. Ashford`) or an identifier run
// (`US0152711091 015271109 2009210 USA`). Declining is the whole point: this
// layout must lose a filing it cannot read rather than report values the filing
// never printed in that cell.
func TestICRDeclinesAForeignBlockHeader(t *testing.T) {
	doc := loadICRFixture(t, "ICR3_foreign_header.txt")
	if !strings.Contains(doc, "MEETING ID") {
		t.Fatalf("fixture no longer carries the nine-column header; the assertion proves nothing")
	}
	if matchICR(string(stripHTML([]byte(doc)))) {
		t.Errorf("icr claimed a nine-column header from a grammar it cannot read")
	}
}

// ICR5 is 0000891804-11-003797 in full, verbatim: a two-series filing, so the
// chassis single-series fallback cannot supply the answer and the layout must
// attribute from the filing's own `Fund Name :` lines. Measured 2026-08-31, the
// icr layout stamped series_id on 2.28% of its 21,534,849 rows, and a row with
// no series_id is dropped before ISS matching even begins -- 42.68% of the whole
// corpus is discarded at that prefilter -- so attribution is a precondition for
// coverage rather than a refinement of it.
const (
	icr5Voting = "S000031884" // Destra Focused Equity Fund -- governs every row
	icr5Silent = "S000031885" // Destra Preferred and Income Securities Fund
)

// TestICRStampsSeriesFromTheFundNameLine is the coverage assertion.
func TestICRStampsSeriesFromTheFundNameLine(t *testing.T) {
	rows := runISSNPXDoc(t, loadICRFixture(t, "ICR5_destra_two_series.txt"))
	if len(rows) == 0 {
		t.Fatalf("ICR5 produced no rows; it carries three meeting blocks")
	}
	seen := map[string]int{}
	for _, r := range rows {
		seen[r[colSeriesID]]++
	}
	if got := seen[icr5Voting]; got != len(rows) {
		t.Errorf("%d of %d rows carry series_id %q; the fund heading above every"+
			" block in this filing names that series\n  stamped: %v",
			got, len(rows), icr5Voting, seen)
	}
}

// TestICRNeverStampsASilentSection is the safety assertion, and the one that must
// never be relaxed to raise the coverage number. ICR5's FIRST section reports
// "The registrant held no voting securities during the period covered by this
// report" and contributes no rows. The only way its series can be stamped is if
// its heading were left standing over the NEXT fund's blocks -- which is not a
// blank series_id but a WRONG one, silently filing one fund's votes under
// another.
func TestICRNeverStampsASilentSection(t *testing.T) {
	doc := loadICRFixture(t, "ICR5_destra_two_series.txt")
	if !strings.Contains(doc, "held no voting securities") {
		t.Fatalf("fixture no longer carries the silent section; the assertion proves nothing")
	}
	for _, r := range runISSNPXDoc(t, doc) {
		if r[colSeriesID] == icr5Silent {
			t.Errorf("row (item %q) carries series_id %q, whose section reports no"+
				" voting securities at all", r[colItemSeq], icr5Silent)
		}
	}
}

// TestICRNeverStampsAnUndeclaredSeries bounds the rule from the other side: a
// stamped series must be one the filing's own header declares. Resolution is by
// exact normalised equality for that reason -- the tolerant lookup's
// leading-code strip errs about 1 in 25, which is the wrong trade for a link key.
func TestICRNeverStampsAnUndeclaredSeries(t *testing.T) {
	doc := loadICRFixture(t, "ICR5_destra_two_series.txt")
	declared := declaredSeriesIDs(doc)
	if len(declared) == 0 {
		t.Fatalf("ICR5 declares no series; the fixture is wrong, not the parser")
	}
	for i, r := range runISSNPXDoc(t, doc) {
		if id := r[colSeriesID]; id != "" && !declared[id] {
			t.Fatalf("row %d stamped series_id %q, which this filing never declares", i, id)
		}
	}
}

// The fund-name resolution table. Every printed/declared pair below is VERBATIM
// from the filing named beside it, and every expected answer was hand-verified
// on 2026-08-31 by reading the two filings' own <SERIES-NAME> declarations
// against the `Fund Name :` lines they print: 41 of 41 correct in
// 0001193125-16-697187 and 24 of 24 in 0001135428-23-000250, with three
// principled refusals. That is the same standard the broadridge rule was held
// to, and it is required here because this is a TOLERANCE on a link key: a blank
// series_id costs coverage, a wrong one silently files one fund's votes under
// another.
//
// The two filings fail in OPPOSITE directions, which is why both walks exist:
// Russell prints a marketing prefix its header does not carry, SEI declares one
// its body does not print.
func TestICRResolveFundName(t *testing.T) {
	// Declared names, verbatim, from the two filings' SGML headers.
	decls := []SeriesDecl{
		// 0001193125-16-697187 (Russell): the header carries the bare name.
		{SeriesID: "S000001582", Name: "2020 Strategy Fund"},
		{SeriesID: "S000001575", Name: "Growth Strategy Fund"},
		{SeriesID: "S000001580", Name: "Equity Growth Strategy Fund"},
		{SeriesID: "S000045903", Name: "Select International Equity Fund"},
		{SeriesID: "S000001569", Name: "Russell Emerging Markets Fund"},
		// 0001135428-23-000250 (SEI): the header carries the SIIT prefix.
		{SeriesID: "S000006762", Name: "SIIT LONG DURATION FUND"},
		{SeriesID: "S000036875", Name: "SIIT Long Duration Credit Fund"},
		{SeriesID: "S000006763", Name: "SIIT HIGH YIELD BOND FUND"},
		// These two both END with `World Equity Ex-US Fund`, which is what makes
		// the printed form of it genuinely ambiguous.
		{SeriesID: "S000019596", Name: "SIIT WORLD EQUITY EX-US FUND"},
		{SeriesID: "S000019597", Name: "SIIT Screened World Equity Ex-US Fund"},
	}
	idx := seriesByName(decls)

	for _, c := range []struct {
		printed, want, why string
	}{
		{"Russell Emerging Markets Fund", "S000001569", "exact: printed IS declared"},
		{"RIC LifePoints Funds 2020 Strategy Fund", "S000001582",
			"printed-side prefix: several words, so the chassis one-token strip cannot reach it"},
		{"RIC LifePoints Funds Equity Growth Strategy Fund", "S000001580",
			"LONGEST suffix wins: `Growth Strategy Fund` is also declared, and taking it would" +
				" file this fund's votes under a different fund"},
		{"RIC Russell Select International Equity Fund", "S000045903",
			"the prefix runs past the manager's own name into `Russell`"},
		{"LONG DURATION FUND", "S000006762",
			"declared-side prefix: the mirror walk, matched on a word boundary"},
		{"Long Duration Credit Fund", "S000036875",
			"mirror walk must not settle for the shorter `SIIT LONG DURATION FUND`"},
		{"WORLD EQUITY EX-US FUND", "",
			"REFUSES: two declared funds end this way, so picking either is a guess"},
		{"CORE FIXED INCOME FUND", "",
			"REFUSES: the header spells `SIIT CORE FIXED INCOME`, with no trailing FUND"},
		{"Fund", "", "REFUSES: below the two-word floor, which every fund name would match"},
		{"Some Fund This Filing Never Declares", "", "REFUSES: not declared in any direction"},
	} {
		if got := icrResolveFund(idx, c.printed); got != c.want {
			t.Errorf("icrResolveFund(%q) = %q, want %q\n  %s", c.printed, got, c.want, c.why)
		}
	}
}

// The dash-qualifier cases, verbatim from 0000035315-23-000529 (Fidelity), which
// prints 85 fund headings against 85 declared series. Measured 2026-08-31: 49
// resolved without this rule and 35 more with it.
//
// The negative cases are the point. A trailing token is what DISTINGUISHES funds
// in this corpus, so this rule must fire only on a ` - ` delimited annotation and
// never on a bare trailing word.
func TestICRResolveQualifiedFundName(t *testing.T) {
	decls := []SeriesDecl{
		{SeriesID: "S000033635", Name: "Fidelity Emerging Markets Index Fund"},
		{SeriesID: "S000050321", Name: "Fidelity SAI Small-Mid Cap 500 Index Fund"},
		// Two funds distinguished ONLY by a trailing token, and neither heading
		// is dash-delimited, so the rule must leave both alone.
		{SeriesID: "S000000111", Name: "Acme Growth Fund"},
		{SeriesID: "S000000222", Name: "Acme Growth Fund II"},
	}
	idx := seriesByName(decls)

	for _, c := range []struct {
		printed, want, why string
	}{
		{"FIDELITY EMERGING MARKETS INDEX FUND - SUB-ADVISER: GEODE", "S000033635",
			"the dash-delimited tail is an annotation, not part of the name"},
		{"FIDELITY SAI SMALL-MID CAP 500 INDEX FUND - SUB-ADVISER: GEODE", "S000050321",
			"the hyphen in SMALL-MID carries no spaces, so it is not a delimiter"},
		{"Acme Growth Fund II", "S000000222",
			"exact match wins; the trailing II must never be stripped"},
		{"Acme Growth Fund", "S000000111", "exact match on the shorter name"},
		{"Acme Growth Fund - Sub-Adviser: Nobody", "S000000111",
			"a dash-delimited annotation strips to the exact declared name"},
		{"Acme Growth Fund II - Sub-Adviser: Nobody", "S000000222",
			"stripping the annotation must land on Fund II, NOT collapse onto Fund"},
		{"Some Fund - With A Tail", "",
			"REFUSES: neither the whole nor the head is declared"},
	} {
		if got := icrResolveFund(idx, c.printed); got != c.want {
			t.Errorf("icrResolveFund(%q) = %q, want %q\n  %s", c.printed, got, c.want, c.why)
		}
	}
}

// ICR6 is a verbatim contiguous meeting block from 0001193125-15-307095, cut
// rule to rule: TE Connectivity's 2015 annual meeting, 36 items -- the count ISS
// records for it.
//
// This filing's description column is narrow, so a description that exactly
// FILLS it leaves one space before the proponent and the two-space cell split
// merges them:
//
//	1   Elect Pierre R. Brondeau Mgmt   For   For   For   <- one space, merged
//	2   Elect Juergen W. Gromer  Mgmt   For   For   For   <- two, splits
//
// The merged row is one cell short and was rejected, so the filing lost exactly
// those rows whose description happened to reach the column width: items 1, 3,
// 10, 16 and 36 here. Scattered rather than a run, which is why it reads as
// noise instead of a defect -- and why only a per-meeting count against ISS
// surfaced it.
func TestICRReadsAColumnFillingDescription(t *testing.T) {
	rows := runISSNPXDoc(t, loadICRFixture(t, "ICR6_te_filled_description.txt"))
	if len(rows) != 36 {
		t.Fatalf("got %d rows, want 36 -- the count ISS records for this meeting", len(rows))
	}
	want := map[string][3]string{
		"1":  {"Elect Pierre R. Brondeau", "Mgmt", "For"},
		"3":  {"Elect William A. Jeffrey", "Mgmt", "For"},
		"36": {"Right to Adjourn Meeting", "Mgmt", "For"},
		// A row that already split, to prove the peel did not disturb it.
		"2": {"Elect Juergen W. Gromer", "Mgmt", "For"},
	}
	got := map[string][3]string{}
	for _, r := range rows {
		got[r[colItemSeq]] = [3]string{r[colVoteDescription], r[colVoteSource], r[colHowVoted]}
	}
	for item, w := range want {
		if got[item] != w {
			t.Errorf("item %q:\n  got  %q\n  want %q", item, got[item], w)
		}
	}
}
