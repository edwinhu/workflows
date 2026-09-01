package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Fixtures in testdata/vanguard are VERBATIM excerpts of real N-PX filings,
// byte fidelity verified (0 non-ASCII, 0 tabs, 0 trailing-whitespace lines).
// Ground truth below was read off those bytes by hand.
//
// They exist for the same reason testdata/broadridge does: the hand-written
// fixture this layout was built from (vanguardFixture, layout_vanguard_test.go)
// misses every shape that actually occurs. Measured against the shipped parser
// on these three fixtures, ground truth is 14 proposal rows and it emits 3, of
// which 0 carry a correct vote:
//
//	V1  truth 6 rows -> emitted 1, how_voted "3,"      (from "JUNE 3, 2005")
//	V2  truth 5 rows -> emitted 2, how_voted "PUBLIC", "LLP'S"
//	V3  truth 3 rows -> emitted 0
//
// Two independent defects produce that, and both must be fixed:
//
//  1. RECALL. vanguardProposalLine (layout_vanguard.go:23) requires a
//     "PROPOSAL #n" prefix, but in the fixed-width era a director election is a
//     bare "ELECTION OF DIRECTOR: <name>" line with no such prefix, so
//     vanguardRowFrom returns false and the row is dropped silently.
//
//  2. PRECISION. collapseSpaces (html.go:303-312) squeezes every run of
//     horizontal whitespace to one space before the layout runs, so
//     vanguardColumnGap (` {2,}`) can never match and vanguardSplitColumns
//     always falls through to its strings.Fields branch -- making how_voted
//     "the third-from-last whitespace token", a positional guess that lands on
//     a description word whenever the description wraps. Column offsets are
//     therefore NOT available to a fix that runs after normalization; peel the
//     trailing cells by vocabulary from the right, the way brPeelColumns does
//     (layout_broadridge.go:571-611). Note vanguard has a fifth column
//     broadridge lacks -- VOTED? with a Yes/No vocabulary -- so brPeelColumns
//     cannot be reused unchanged.
//
// Corpus context (docs/investigations/2026-08-27_parse-npx-vs-iss.md):
// 644 of 2,510 vanguard filings and 4,813 of 20,107 issnpx filings parse "ok"
// with zero rows, which is indistinguishable from a genuine no-activity fund.
// broadridge -- the one layout rebuilt against real filings -- has 0 of 5,212.

type vgRow struct {
	seq        string // item_seq; "" where the filing numbers no item
	descPrefix string // vote_description must begin with this
	proposedBy string // PROPOSED BY  -> VoteSource
	voted      string // VOTED?       -> VoteOtherInfo
	howVoted   string // VOTE CAST    -> HowVoted
	mgmtRec    string // MGMT         -> ManagementRecommendation
}

type vgCase struct {
	file        string
	fund        string
	issuer      string
	ticker      string
	cusip       string
	meetingDate string // YYYYMMDD
	note        string
	rows        []vgRow
}

var vanguardGroundTruth = []vgCase{
	{
		file: "V1.txt", fund: "VANGUARD INFORMATION TECHNOLOGY INDEX FUND",
		issuer: "3COM CORPORATION", ticker: "COMS", cusip: "885535104",
		meetingDate: "20040922",
		note: "fixed-width era; five unnumbered ELECTION OF DIRECTOR rows the parser drops entirely," +
			" then a PROPOSAL #02 whose description wraps over two continuation lines",
		rows: []vgRow{
			{"", "ELECTION OF DIRECTOR: ERIC A. BENHAMOU", "ISSUER", "YES", "FOR", "FOR"},
			{"", "ELECTION OF DIRECTOR: GARY T. DICAMILLO", "ISSUER", "YES", "FOR", "FOR"},
			{"", "ELECTION OF DIRECTOR: JAMES R. LONG", "ISSUER", "YES", "FOR", "FOR"},
			{"", "ELECTION OF DIRECTOR: RAJ REDDY", "ISSUER", "YES", "FOR", "FOR"},
			{"", "ELECTION OF DIRECTOR: DAVID C. WAJSGRAS", "ISSUER", "YES", "FOR", "FOR"},
			{"02", "TO RATIFY THE APPOINTMENT OF DELOITTE", "ISSUER", "YES", "FOR", "FOR"},
		},
	},
	{
		file: "V2.txt", fund: "",
		issuer: "ACCENTURE LTD", ticker: "ACN", cusip: "G1150G111",
		meetingDate: "20050202",
		note: "a <PAGE> break falls between the third director row and PROPOSAL #02;" +
			" #02 wraps over four continuation lines, one of them leading-space indented",
		rows: []vgRow{
			{"", "ELECTION OF DIRECTOR: BLYTHE J. MCGARVIE", "ISSUER", "YES", "FOR", "FOR"},
			{"", "ELECTION OF DIRECTOR: JOE W. FOREHAND", "ISSUER", "YES", "FOR", "FOR"},
			{"", "ELECTION OF DIRECTOR: SIR MARK MOODY-STUART", "ISSUER", "YES", "FOR", "FOR"},
			{"02", "APPROVAL OF BYE-LAW AMENDMENTS TO RELOCATE", "ISSUER", "YES", "FOR", "FOR"},
			{"03", "RE-APPOINTMENT OF KPMG LLP AS INDEPENDENT", "ISSUER", "YES", "FOR", "FOR"},
		},
	},
	{
		file: "V3.txt", fund: "VANGUARD EXPLORER FUND",
		issuer: "3COM CORPORATION", ticker: "COMS", cusip: "885535104",
		meetingDate: "20090923",
		note: "the HTML sub-format: the same table as <p>/<font> markup with runs of &#160;" +
			" for column padding, EDGAR-wrapped at 1023 columns straight through entities" +
			" and tags. The parser emits zero rows for it today",
		rows: []vgRow{
			{"", "ELECTION OF DIRECTOR: KATHLEEN A. COTE", "ISSUER", "YES", "FOR", "FOR"},
			{"", "ELECTION OF DIRECTOR: DAVID H.Y. HO", "ISSUER", "YES", "FOR", "FOR"},
			{"", "ELECTION OF DIRECTOR: ROBERT Y.L. MAO", "ISSUER", "YES", "FOR", "FOR"},
		},
	},
	{
		file: "V5.txt", fund: "",
		issuer: "JOHNSON & JOHNSON", ticker: "JNJ", cusip: "478160104",
		meetingDate: "20110428",
		note: "the filing's own markup carries a newline INSIDE the label, so `PROPOSAL #2:`" +
			" arrives as `PROPOSAL` on one line and `#2: ELECT DIRECTOR ...` on the next." +
			" In HTML that newline is whitespace, not a line break. Only item 1, whose label" +
			" is not split, keeps its number today; the rest emit an EMPTY item_seq with the" +
			" number stranded in the description as `#2: `",
		rows: []vgRow{
			{"1", "ELECT DIRECTOR MARY SUE COLEMAN", "ISSUER", "YES", "FOR", "FOR"},
			{"2", "ELECT DIRECTOR JAMES G. CULLEN", "ISSUER", "YES", "FOR", "FOR"},
			{"3", "ELECT DIRECTOR IAN E.L. DAVIS", "ISSUER", "YES", "FOR", "FOR"},
		},
	},
}

func loadVanguardFixture(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "vanguard", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return []byte(edgarEnvelope("0000052848", "0000932471-05-001498", string(b)))
}

func TestVanguardRealFilings(t *testing.T) {
	for _, c := range vanguardGroundTruth {
		t.Run(c.file, func(t *testing.T) {
			res := parseText(loadVanguardFixture(t, c.file), FilingMeta{FilePath: c.file})

			if res.Meta.Layout != "vanguard" {
				t.Fatalf("layout = %q, want %q (%s)", res.Meta.Layout, "vanguard", c.note)
			}
			if res.Meta.ParseStatus != "ok" {
				t.Fatalf("parse_status = %q, want ok: %s", res.Meta.ParseStatus, res.Meta.ErrorMsg)
			}
			if len(res.Rows) != len(c.rows) {
				t.Fatalf("emitted %d rows, want %d\n%s\nemitted:\n%s",
					len(res.Rows), len(c.rows), c.note, dumpVanguardRows(res.Rows))
			}

			for i, want := range c.rows {
				got := res.Rows[i]
				if got.ItemSeq != want.seq {
					t.Errorf("row %d: item_seq = %q, want %q", i, got.ItemSeq, want.seq)
				}
				if !strings.HasPrefix(got.VoteDescription, want.descPrefix) {
					t.Errorf("row %d: vote_description = %q, want prefix %q",
						i, got.VoteDescription, want.descPrefix)
				}
				if got.HowVoted != want.howVoted {
					t.Errorf("row %d: how_voted = %q, want %q", i, got.HowVoted, want.howVoted)
				}
				if got.ManagementRecommendation != want.mgmtRec {
					t.Errorf("row %d: management_recommendation = %q, want %q",
						i, got.ManagementRecommendation, want.mgmtRec)
				}
				if got.VoteSource != want.proposedBy {
					t.Errorf("row %d: vote_source = %q, want %q", i, got.VoteSource, want.proposedBy)
				}
				if got.VoteOtherInfo != want.voted {
					t.Errorf("row %d: vote_other_info = %q, want %q",
						i, got.VoteOtherInfo, want.voted)
				}
				if got.IssuerName != c.issuer {
					t.Errorf("row %d: issuer_name = %q, want %q", i, got.IssuerName, c.issuer)
				}
				if got.CUSIP != c.cusip {
					t.Errorf("row %d: cusip = %q, want %q", i, got.CUSIP, c.cusip)
				}
				if got.Ticker != c.ticker {
					t.Errorf("row %d: ticker = %q, want %q", i, got.Ticker, c.ticker)
				}
				if got.MeetingDate != c.meetingDate {
					t.Errorf("row %d: meeting_date = %q, want %q",
						i, got.MeetingDate, c.meetingDate)
				}
				if c.fund != "" && got.FundName != c.fund {
					t.Errorf("row %d: fund_name = %q, want %q", i, got.FundName, c.fund)
				}
			}
		})
	}
}

func dumpVanguardRows(rows []VoteRow) string {
	var b strings.Builder
	for i, r := range rows {
		b.WriteString("  [")
		b.WriteString(itoa(i))
		b.WriteString("] seq=")
		b.WriteString(quote(r.ItemSeq))
		b.WriteString(" how_voted=")
		b.WriteString(quote(r.HowVoted))
		b.WriteString(" desc=")
		b.WriteString(quote(truncate(r.VoteDescription, 70)))
		b.WriteString("\n")
	}
	if b.Len() == 0 {
		return "  (none)\n"
	}
	return b.String()
}

// ---------------------------------------------------------------------------
// The corpus lint, as a unit invariant.
// ---------------------------------------------------------------------------

// howVotedVocabulary is every value a filing may legitimately record as a vote,
// uppercased and whitespace-collapsed. It is the union of the ISS fundvote
// enumeration (skills/wrds/references/iss-voting.md: For, Against, Withhold,
// Abstain, One Year, Two Years, Three Years) and the spellings filers actually
// use, which were read off the parsed corpus and are faithful transcriptions
// rather than parser defects -- "1 Year", "3 Years", "Take No Action", "Did Not
// Vote", "TNA", "Yes"/"No" on a consent ballot.
//
// This is a validity vocabulary, not a normalisation map: parse_npx stores
// how_voted verbatim and must keep doing so. Its only job is to answer "is this
// string a vote at all", which is a question the parser can ask of its own
// output with no vendor data.
var howVotedVocabulary = map[string]bool{
	"":    true, // a genuinely blank vote cell is a real outcome
	"FOR": true, "AGAINST": true, "ABSTAIN": true,
	"WITHHOLD": true, "WITHHELD": true,
	"ONE YEAR": true, "TWO YEARS": true, "THREE YEARS": true,
	"1 YEAR": true, "2 YEARS": true, "3 YEARS": true,
	"DO NOT VOTE": true, "DID NOT VOTE": true, "NO VOTE": true,
	"TAKE NO ACTION": true, "TAKENOACTION": true, "NO ACTION": true, "TNA": true,
	"NONE": true, "N/A": true, "UNKNOWN": true, "REFER": true,
	"YES": true, "NO": true, "SPLIT": true,
	// `Split Vote` is the same outcome spelled in full: the fund held the
	// security across several accounts that voted differently. One filing prints
	// it on 20,808 of its 21,480 rows, each beside a coherent description and
	// management recommendation. Recognising the spelling is the same decision
	// PROPORTIONAL below records -- how_voted is verbatim by contract, so the
	// vocabulary grows rather than the parser rewriting what the filing printed.
	"SPLIT VOTE": true,
	// `Sold shares` is the fund selling the position before the meeting and
	// `DNV` abbreviates Did Not Vote -- both are outcomes the corpus prints in
	// the Vote Cast column, on 5,794 and 6,937 rows of the two filings that use
	// them. See the note on PROPORTIONAL below: the vocabulary records the
	// spelling because how_voted is verbatim by contract.
	"SOLD": true, "SOLD SHARES": true, "DNV": true,
	// The single-letter abbreviation one vintage uses in both vote columns:
	// F 5,637, A 59, N 9, D 7 in the filing that prints it. W is absent there
	// and is deliberately not admitted.
	"F": true, "A": true, "N": true, "D": true,
	// `DidNot Vote` spelled without the space, and the `Null` recommendation
	// that vintage prints beside it.
	"DIDNOT VOTE": true, "NULL": true, "ECHO VOTE": true,
	// `Did Note Vote` is one filing's own typo for `Did Not Vote`, on 1,264 of
	// its rows; how_voted is verbatim, so the spelling is recorded rather than
	// corrected. `Not Cast` is a further spelling of the same outcome.
	"DID NOTE VOTE": true, "NOT CAST": true,
	// The residue's long tail, each a gap-delimited Vote Cast cell in the
	// corpus: ECHO VOTED 712, OPPOSE 432, W'HOLD 106,
	// NON-VOTE 78, UNAVAILABLE 74, AG 73. AGNST and UNKNOWN were already carried.
	"ECHO VOTED": true, "OPPOSE": true,
	"AG": true, "W'HOLD": true, "NON-VOTE": true, "UNAVAILABLE": true,
	// Proportional (or "echo") voting: the fund votes in proportion to the
	// other shareholders rather than forming a view. It is a real vote value,
	// not a parse defect -- 7,270 rows carry it in the revalidation run, each
	// with a coherent description and management recommendation beside it.
	"PROPORTIONAL": true, "NON-VOTING": true,
	// "Voted - <choice>" is one registrant family's spelling of the vote cell:
	// the prefix records THAT a ballot was cast and the suffix records how. It is
	// the value the filing prints, and how_voted is verbatim by contract, so the
	// vocabulary recognises the spelling rather than the parser rewriting it.
	// Seen in testdata/htmltable/H5_unlabelled_item_col.txt and 129 corpus filings
	// sharing that header shape.
	"VOTED - FOR": true, "VOTED - AGAINST": true, "VOTED - ABSTAIN": true,
	"VOTED - WITHHOLD": true, "VOTED - WITHHELD": true, "VOTED - NONE": true,
	"VOTED": true, "NOT VOTED": true,

	// Read off 000000/2230/0000002230-06-000041.txt and its family (1,223 filings
	// carrying the `Description | Proposal Type | Voted | Vote | For/ Agnst Mgmt`
	// header). `AGNST` is that filer's spelling of Against and `FOR ALL-DIRS` its
	// spelling of a for-all-directors slate vote. Both are what the filing PRINTED,
	// and how_voted is verbatim by contract, so they belong in the validity
	// vocabulary rather than being normalised away or dropped. Admitting a real
	// spelling is not the same as relaxing this invariant: junk like `31,` or
	// `#160;`, which is what this test was built to catch, is still rejected.
	"AGNST": true, "FOR ALL-DIRS": true,
}

// isVoteValue consults the PARSERS' OWN validators before falling back to the static
// list. Three times in one session a layout learned a real spelling -- SPLIT, WHOLD --
// and this hand-maintained map did not, so a clean parser failed its own invariant and
// each drift cost a diagnosis. A vocabulary duplicated between the code under test and
// the test is two sources of truth for one fact.
//
// The static map still carries the spellings no single layout owns (the XML era, the
// ISS enumeration, vanguard's `VOTED - FOR` family), so it cannot simply be deleted.
func isVoteValue(s string) bool {
	v := strings.ToUpper(strings.Join(strings.Fields(s), " "))
	if howVotedVocabulary[v] {
		return true
	}
	// A proportional vote is reported as a PERCENTAGE -- `F=85.71%` -- whose
	// value is the number, so it cannot be a vocabulary entry.
	if issPercentVote(strings.Fields(s)[len(strings.Fields(s))-1]) {
		return true
	}
	// A value either layout accepts is a value the corpus really prints.
	return pvTextVote(v) || htmlIsVoteValue(v)
}

// TestHowVotedVocabularyInvariant is the check that would have caught the
// vanguard defect before it shipped, and it needs no vendor data to run: a
// how_voted that is not a vote is a defect by inspection.
//
// It runs every real-filing fixture in testdata/ through the dispatcher and
// asserts that every emitted how_voted is a vote. Over the whole corpus this
// invariant currently fails on 1,109,496 of 5,047,339 vanguard rows (21.98%),
// against 0.03% for issnpx, 0.07% for broadridge and 0.18% for the XML era.
func TestHowVotedVocabularyInvariant(t *testing.T) {
	dirs, err := os.ReadDir("testdata")
	if err != nil {
		t.Fatalf("read testdata: %v", err)
	}
	checked := 0
	for _, d := range dirs {
		if !d.IsDir() {
			continue
		}
		files, err := os.ReadDir(filepath.Join("testdata", d.Name()))
		if err != nil {
			t.Fatalf("read testdata/%s: %v", d.Name(), err)
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".txt") {
				continue
			}
			path := filepath.Join("testdata", d.Name(), f.Name())
			b, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("read %s: %v", path, err)
			}
			body := []byte(edgarEnvelope("0001084380", "0000930413-04-004118", string(b)))
			res := parseText(body, FilingMeta{FilePath: path})
			for i, r := range res.Rows {
				checked++
				if !isVoteValue(r.HowVoted) {
					t.Errorf("%s row %d: how_voted = %q is not a vote value\n  desc: %q",
						path, i, r.HowVoted, truncate(r.VoteDescription, 90))
				}
			}
		}
	}
	if checked == 0 {
		t.Fatalf("the invariant checked no rows at all; it proves nothing")
	}
	t.Logf("checked %d emitted how_voted values across testdata/", checked)
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

func quote(s string) string { return "\"" + s + "\"" }

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b []byte
	for i > 0 {
		b = append([]byte{byte('0' + i%10)}, b...)
		i /= 10
	}
	return string(b)
}
