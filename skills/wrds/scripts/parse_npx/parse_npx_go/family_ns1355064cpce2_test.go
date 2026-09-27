package main

import (
	"os"
	"path/filepath"
	"testing"
)

const ns1355064CPCE2Dir = "family_ns1355064cpce2"

// ns1355064CPCE2HowVoted is the verbatim how_voted value the tracked binary at
// HEAD already emits for each of the 93 vote rows under the CPEAX masthead, in
// file order. It is pinned as a BASELINE that a masthead fix must leave
// byte-identical, not as a fresh claim about the vote column: a prior attempt
// at this same banner (journal key ns1355064-cpce-revert) made the ticker-cell
// reader fire and in doing so rewrote how_voted to "Y" across the back half of
// this section, destroying the 17 "Against" votes below and the one qualified
// "For (except for Zillmer--no vote cast)". Pinning the whole column is what
// turns that into a test failure instead of a silent corruption of the vote
// record -- a fix that reaches the right series_id by mangling how_voted is
// strictly worse than the blank it replaces.
var ns1355064CPCE2HowVoted = []string{
	"For",                                    // row 0 (J.B. Hunt Transport Services 20120426)
	"For",                                    // row 1 (J.B. Hunt Transport Services 20120426)
	"For",                                    // row 2 (J.B. Hunt Transport Services 20120426)
	"For",                                    // row 3 (The Hersey Company 20120501)
	"For",                                    // row 4 (The Hersey Company 20120501)
	"For (except for Zillmer--no vote cast)", // row 5 (Ecolab, Inc. 20120503)
	"For",                                    // row 6 (Ecolab, Inc. 20120503)
	"Against",                                // row 7 (Ecolab, Inc. 20120503)
	"For",                                    // row 8 (Ecolab, Inc. 20120503)
	"Against",                                // row 9 (Ecolab, Inc. 20120503)
	"Against",                                // row 10 (Ecolab, Inc. 20120503)
	"For",                                    // row 11 (Kirby Corp. 20120424)
	"For",                                    // row 12 (Kirby Corp. 20120424)
	"For",                                    // row 13 (Kirby Corp. 20120424)
	"For",                                    // row 14 (Kirby Corp. 20120424)
	"For",                                    // row 15 (Kirby Corp. 20120424)
	"For",                                    // row 16 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 17 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 18 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 19 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 20 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 21 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 22 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 23 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 24 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 25 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 26 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 27 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 28 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 29 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 30 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 31 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 32 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 33 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 34 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 35 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 36 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 37 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 38 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 39 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 40 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 41 (GlaxoSmithKline, PLC 20120505)
	"For",                                    // row 42 (Kimberly-Clark Corp. 20120503)
	"For",                                    // row 43 (Kimberly-Clark Corp. 20120503)
	"For",                                    // row 44 (Kimberly-Clark Corp. 20120503)
	"For",                                    // row 45 (Moody's Corp./CPEAX 20120416)
	"For",                                    // row 46 (Moody's Corp./CPEAX 20120416)
	"For",                                    // row 47 (Moody's Corp./CPEAX 20120416)
	"For",                                    // row 48 (Moody's Corp./CPEAX 20120416)
	"For",                                    // row 49 (Chevron Corp. 20120530)
	"For",                                    // row 50 (Chevron Corp. 20120530)
	"For",                                    // row 51 (Chevron Corp. 20120530)
	"Against",                                // row 52 (Chevron Corp. 20120530)
	"For",                                    // row 53 (Chevron Corp. 20120530)
	"Against",                                // row 54 (Chevron Corp. 20120530)
	"Against",                                // row 55 (Chevron Corp. 20120530)
	"Against",                                // row 56 (Chevron Corp. 20120530)
	"Against",                                // row 57 (Chevron Corp. 20120530)
	"Against",                                // row 58 (Chevron Corp. 20120530)
	"Against",                                // row 59 (Chevron Corp. 20120530)
	"For",                                    // row 60 (Macy's 20120518)
	"For",                                    // row 61 (Macy's 20120518)
	"For",                                    // row 62 (Macy's 20120518)
	"For",                                    // row 63 (Macy's 20120518)
	"Against",                                // row 64 (Macy's 20120518)
	"For",                                    // row 65 (Omnicare, Inc. 20120523)
	"For",                                    // row 66 (Omnicare, Inc. 20120523)
	"For",                                    // row 67 (Omnicare, Inc. 20120523)
	"For",                                    // row 68 (The Home Depot, Inc. 20120517)
	"For",                                    // row 69 (The Home Depot, Inc. 20120517)
	"For",                                    // row 70 (The Home Depot, Inc. 20120517)
	"For",                                    // row 71 (The Home Depot, Inc. 20120517)
	"Against",                                // row 72 (The Home Depot, Inc. 20120517)
	"Against",                                // row 73 (The Home Depot, Inc. 20120517)
	"Against",                                // row 74 (The Home Depot, Inc. 20120517)
	"For",                                    // row 75 (The Home Depot, Inc. 20120517)
	"Against",                                // row 76 (The Home Depot, Inc. 20120517)
	"Against",                                // row 77 (The Home Depot, Inc. 20120517)
	"For",                                    // row 78 (Intel Corp. 20120517)
	"For",                                    // row 79 (Intel Corp. 20120517)
	"For",                                    // row 80 (Intel Corp. 20120517)
	"Against",                                // row 81 (Intel Corp. 20120517)
	"For",                                    // row 82 (Expedia, Inc. 20120605)
	"For",                                    // row 83 (Mastercard Inc. 20120605)
	"For",                                    // row 84 (Mastercard Inc. 20120605)
	"For",                                    // row 85 (Mastercard Inc. 20120605)
	"For",                                    // row 86 (Mastercard Inc. 20120605)
	"For",                                    // row 87 (Mastercard Inc. 20120605)
	"For",                                    // row 88 (Intuitive Surgical, Inc. 20120419)
	"For",                                    // row 89 (Intuitive Surgical, Inc. 20120419)
	"For",                                    // row 90 (Intuitive Surgical, Inc. 20120419)
	"For",                                    // row 91 (Intuitive Surgical, Inc. 20120419)
	"For",                                    // row 92 (Intuitive Surgical, Inc. 20120419)
}

// ns1355064CPCE2Dispatch runs the real dispatch on the fixture with this
// family's dictionary loaded, asserting the fixture's own preconditions --
// status, layout, row count -- so a failure in the body of the test below is
// an assertion about the two mastheads and the vote column, never a broken
// fixture. Same mechanism as ns1355064EmptySuffixDispatch in
// family_ns1355064_registrant_empty_suffix_test.go, pointed at its own dir.
func ns1355064CPCE2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", ns1355064CPCE2Dir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1355064CPCE2Dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	return rows
}

// CIK 0001355064 (Mutual Fund Series Trust) filing
// 000135/1355064/0000910472-12-002620.txt is an htmltable filing whose每 fund
// section is its own <BODY>. Its FIRST section, at source line 654, prints a
// masthead whose bold label cell carries a TICKER where every other section in
// the corpus carries the fund name, and puts the fund name itself -- lowercased
// -- in a separate colspan cell two cells later, with the trailing `Item 1`
// marker cell last:
//
//	<TR><TD ... colspan="2"><P style="margin:0px"><B>Registrant:</B> CPEAX</P>
//	</TD><TD ... colspan="3"><P style="margin:0px; padding:0px">
//		Catalyst/CP core equity fund</P></TD><TD ...>&nbsp;</TD> ... <TD ...>Item 1</P>
//	</TD></TR>
//
// CPEAX is the Class A ticker of Catalyst/CP Core Equity Fund, and the filing's
// OWN SEC-HEADER declares that fund at source line 401:
//
//	<SERIES-ID>S000035242
//	<SERIES-NAME>Catalyst/CP Core Equity Fund
//
// so the name printed in the split cell is an exact (case-insensitive)
// declared-series name -- this is a masthead CAPTURE gap, not a dictionary gap
// and not a resolver gap. The same split-cell shape is already pinned for this
// CIK in family_ns1355064_registrant_empty_suffix_test.go, where the bold cell
// ends at the dash with nothing after it; here the bold cell is followed by a
// ticker instead of by nothing, which is the one difference.
//
// The SECOND section, at source line 2149, prints the ordinary inline shape
// with real text after the dash -- NOT the empty-suffix shape -- and already
// resolves at HEAD:
//
//	<TR><TD ... colspan=5><P style="margin:0px"><B>Registrant:</B> Mutual Fund Series Trust- &nbsp;Catalyst International Value Fund</P>
//
// declared in the same header at source line 321 as S000033418.
//
// Why both sections are in ONE fixture. A prior attempt at this banner
// (journal key ns1355064-cpce-registrant-ticker-cell) made the ticker-cell
// masthead resolve and thereby turned 187 blank rows in the following sections
// into WRONG ids, because the CPEAX id carried forward past a sibling masthead
// that no reader opened. Measured on the tracked binary at HEAD today the
// carry-forward hazard is still live in principle but the sibling section
// already opens correctly, so the assertion below is a GUARD: rows 93..167 must
// still be S000033418 after the ticker-cell half ships. A fix that resolves the
// CPEAX rows by widening section detection in a way that swallows the sibling
// masthead fails here rather than in the corpus.
//
// The fixture is a verbatim excerpt of the real filing bytes fetched from
// /wrds/sec/archives: source lines 1-3163 -- the whole SEC-HEADER including the
// SERIES-AND-CLASSES-CONTRACTS-DATA block, the document preamble, the signature
// <BODY>, the CPEAX <BODY> (source lines 648-2143) and the Catalyst
// International Value <BODY> (source lines 2144-3163) -- followed by the four
// close tags </HTML> </TEXT> </DOCUMENT> </SEC-DOCUMENT> that the real file
// carries after its last section. No byte inside the excerpt is altered.
//
// TWO whole <TR>...</TR> ballot rows are DROPPED from the excerpt: source lines
// 754-768 (Hershey, meeting 20120501) and 1954-1968 (Expedia, meeting
// 20120605). Both are rows on which this filing ALREADY emits the ballot's
// director list into the how_voted column at HEAD -- a pre-existing wrong-VALUE
// defect in a different column and a different reader, which this family
// neither causes nor fixes. Kept in, they make the corpus-wide
// TestHowVotedVocabularyInvariant (vanguard_real_test.go) red, so a correct fix
// for THIS family could never take the suite green. Dropping exactly those two
// <TR> blocks is the narrowest excision that leaves the invariant measuring
// what it measures and this test measuring what it measures; every remaining
// byte is the real filing's. The CPEAX section keeps 93 of its 95 vote rows,
// including all 17 "Against" votes -- the values the reverted attempt
// destroyed.
//
// dict.tsv is all 149 real cik_series.tsv rows for this CIK, verbatim, so
// nothing here is made unambiguous by hiding a rival spelling -- the file holds
// a later reuse of S000035242 under the renamed sleeve Catalyst Dynamic Alpha
// Fund (20140630).
//
// Measured against the tracked binary at HEAD the fixture reproduces the
// filing's behaviour on every row it keeps: status ok, layout htmltable, 168
// rows, rows 0-92 blank fund_name and blank series_id, rows 93-167 S000033418.
func TestNS1355064CPCoreEquityTickerMastheadAndSiblingSection(t *testing.T) {
	const (
		fixture   = "mfst_cpeax_2012.txt"
		cpceFund  = "Catalyst/CP Core Equity Fund"
		cpceID    = "S000035242"
		intlFund  = "Catalyst International Value Fund"
		intlID    = "S000033418"
		cpceRows  = 93  // rows 0..92, the CPEAX <BODY>
		totalRows = 168 // + rows 93..167, the Catalyst International Value <BODY>
	)

	// Precondition, not the claim under test: both names printed in the two
	// mastheads already resolve off the fixture's OWN header declarations. If
	// this stops holding, the names have become genuinely unresolvable and
	// everything below is measuring something else.
	b, err := os.ReadFile(filepath.Join("testdata", ns1355064CPCE2Dir, fixture))
	if err != nil {
		t.Fatal(err)
	}
	idx := seriesByName(parseHeader(b).SeriesDecls)
	for _, p := range []struct{ name, want string }{{cpceFund, cpceID}, {intlFund, intlID}} {
		var got string
		if d := lookupSeriesByName(idx, p.name); d != nil {
			got = d.SeriesID
		}
		if got != p.want {
			t.Fatalf("precondition: header index resolves %q to %q, want %s", p.name, got, p.want)
		}
	}

	if len(ns1355064CPCE2HowVoted) != cpceRows {
		t.Fatalf("precondition: how_voted baseline has %d entries, want %d", len(ns1355064CPCE2HowVoted), cpceRows)
	}

	rows := ns1355064CPCE2Dispatch(t, fixture, "dict.tsv", "htmltable", totalRows)

	// Claim 1 -- the ticker masthead's own 93 rows carry the fund the split
	// cell names, WITH their real votes. Both halves are asserted on every
	// row: a fix that reaches the id by mangling the vote column is not a fix.
	for i := 0; i < cpceRows; i++ {
		r := rows[i]
		if r.SeriesID != cpceID || r.FundName != cpceFund {
			t.Errorf("row %d: the CPEAX masthead's split fund-name cell never reached the resolver: fund=%q want %q; series=%q want %s (issuer=%q cusip=%q meeting=%q)",
				i, r.FundName, cpceFund, r.SeriesID, cpceID, r.IssuerName, r.CUSIP, r.MeetingDate)
		}
		if r.HowVoted != ns1355064CPCE2HowVoted[i] {
			t.Errorf("row %d: how_voted corrupted by the masthead fix: got %q want %q (issuer=%q meeting=%q item=%q)",
				i, r.HowVoted, ns1355064CPCE2HowVoted[i], r.IssuerName, r.MeetingDate, r.ItemSeq)
		}
	}

	// Claim 2 -- the sibling section opens its own section and keeps its own
	// id. This is the no-carryover guard: before the ticker-cell half existed
	// there was no id to carry, so this can only fail once a fix ships.
	for i := cpceRows; i < totalRows; i++ {
		r := rows[i]
		if r.SeriesID != intlID || r.FundName != intlFund {
			t.Errorf("row %d: the Catalyst International Value masthead did not open its own section -- the CPEAX id carried forward: fund=%q want %q; series=%q want %s (issuer=%q meeting=%q)",
				i, r.FundName, intlFund, r.SeriesID, intlID, r.IssuerName, r.MeetingDate)
		}
	}

	// Claim 3 -- restated as a whole-fixture count so a fix that resolves the
	// CPEAX rows by widening the FIRST section to swallow the second one fails
	// on the totals even if the per-row loops were somehow satisfied.
	var nCPCE, nIntl int
	for _, r := range rows {
		switch r.SeriesID {
		case cpceID:
			nCPCE++
		case intlID:
			nIntl++
		}
	}
	if nCPCE != cpceRows || nIntl != totalRows-cpceRows {
		t.Errorf("section split wrong: %d rows carry %s (want %d) and %d carry %s (want %d)",
			nCPCE, cpceID, cpceRows, nIntl, intlID, totalRows-cpceRows)
	}
}
