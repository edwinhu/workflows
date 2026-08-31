package main

import (
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// ST1 is the FIRST 23,434 BYTES of 0001193125-17-270540 (HC Capital Trust),
// verbatim and contiguous -- a byte-for-byte prefix of the filing, cut only at
// the `</TABLE>` that closes its second page group. Nothing is spliced and
// nothing is skipped: the fixture starts at byte 0, so it carries the SGML
// header the chassis reads series declarations from and every line the parser
// has to walk before it reaches the first table. A fixture that began at the
// first `<TABLE>` would start PAST the point the parser has to survive.
//
// The grammar: one logical vote row is split across PARALLEL tables and joined
// by LINE POSITION inside a page group. Page group 1 prints three tables, page
// group 2 prints four, and in both every table's body holds the same number of
// lines -- a wrapped cell in one table is a BLANK line in each of the others,
// which is what keeps the join positional.
//
//	Institutional Account ID  Institutional Account Name  ...  Company Name  Ticker  Country
//	Institutional Account ID  Provider Security ID  Meeting Type  ...  Proponent  Proposal Code
//	Institutional Account ID  Proposal Number  Proposal Text  Management Recommendation  Vote Instruction  Voted
//	Institutional Account ID  Vote Against Management
//
// GROUND TRUTH, counted by hand off those bytes:
//
//	page group 1, body lines 458-468 / 477-487 / 496-506: 11 lines each, of which
//	line ordinal 6 carries no account id in any table (it is the wrap of item 1f)
//	-> 10 votes.
//	page group 2, body lines 518-532 / 541-555 / 564-578 / 587-601: 15 lines each,
//	of which ordinals 1, 3, 6, 12 and 14 carry no account id -> 10 votes.
//
// 20 votes in total. Every expectation below was read off the bytes; none was
// produced by running the parser.
const (
	st1Rows = 20

	stColSeriesID       = 7
	stColFundName       = 9
	stColIssuerName     = 10
	stColCUSIP          = 11
	stColTicker         = 14
	stColMeetingDate    = 15
	stColMeetingType    = 16
	stColRecordDate     = 17
	stColItemSeq        = 18
	stColVoteDesc       = 19
	stColVoteCategories = 20
	stColVoteSource     = 22
	stColHowVoted       = 25
	stColSharesVoted    = 26
	stColMgmtRec        = 27
	stColLayout         = 31
)

func TestSplitTableReadsEveryPageGroup(t *testing.T) {
	rows := runISSNPXDoc(t, loadSplitTableFixture(t, "ST1_hccapital_two_page_groups.txt"))
	if len(rows) != st1Rows {
		t.Fatalf("got %d rows, want %d (page group 1: 10, page group 2: 10)", len(rows), st1Rows)
	}
	for i, r := range rows {
		if got := r[stColLayout]; got != "splittable" {
			t.Fatalf("row %d layout = %q, want splittable", i, got)
		}
		if got := r[stColFundName]; got != "Hirtle Callaghan Value Equity Portfolio" {
			t.Errorf("row %d fund_name = %q, want the Institutional Account Name column's value", i, got)
		}
	}

	// The issuer of each vote comes from the FIRST table of its page group, and
	// the split is what makes it reachable at all: page group 2's third table --
	// the one carrying the proposals -- never names an issuer.
	perIssuer := map[string]int{}
	for _, r := range rows {
		perIssuer[r[stColIssuerName]]++
	}
	for issuer, want := range map[string]int{
		"Office Depot, Inc.":       12,
		"The Dow Chemical Company": 3,
		"B/E Aerospace, Inc.":      5,
	} {
		if got := perIssuer[issuer]; got != want {
			t.Errorf("issuer %q: got %d rows, want %d\n  seen: %v", issuer, got, want, perIssuer)
		}
	}
}

// TestSplitTableTakesHowVotedFromTheVoteColumn is the assertion this layout most
// needs. `Vote Instruction` is the vote; `Management Recommendation` sits to its
// LEFT and `Proposal Text` further left again, and the row below is the one place
// in the fixture where the two vote-shaped columns disagree:
//
//	905284  Non-Salary Comp.  2  Advisory Vote to Ratify Named
//	                             Executive Officers' Compensation  For  Against  Yes
//
// A layout that read the vote by position, or that let the wrapped proposal text
// reach the vote cell, reports `For` or a sentence here.
func TestSplitTableTakesHowVotedFromTheVoteColumn(t *testing.T) {
	rows := runISSNPXDoc(t, loadSplitTableFixture(t, "ST1_hccapital_two_page_groups.txt"))

	var checked int
	for _, r := range rows {
		if r[stColIssuerName] != "B/E Aerospace, Inc." || r[stColItemSeq] != "2" {
			continue
		}
		checked++
		got := [4]string{r[stColVoteDesc], r[stColMgmtRec], r[stColHowVoted], r[stColVoteSource]}
		want := [4]string{
			"Advisory Vote to Ratify Named Executive Officers' Compensation",
			"For", "Against", "Management",
		}
		if got != want {
			t.Errorf("B/E item 2:\n  got  %q\n  want %q", got, want)
		}
	}
	if checked != 1 {
		t.Fatalf("checked %d B/E Aerospace item-2 rows, want 1", checked)
	}

	// The bleed detector. This fixture prints exactly two distinct vote values:
	// nineteen `For` and the single `Against` above. A vocabulary wider than that
	// means description text is reaching the vote cell.
	seen := map[string]int{}
	for _, r := range rows {
		seen[r[stColHowVoted]]++
	}
	vocab := make([]string, 0, len(seen))
	for v := range seen {
		vocab = append(vocab, v)
	}
	sort.Strings(vocab)
	if len(vocab) != 2 || seen["For"] != 19 || seen["Against"] != 1 {
		t.Errorf("how_voted vocabulary = %q (%v), want exactly 19 For and 1 Against", vocab, seen)
	}
}

// TestSplitTableJoinsAWrappedProposal pins the wrap rule: a cell too wide for its
// column is printed on the line ABOVE its row, and that line carries no account
// id in any table of the group. Item 1f's text is `Elect Director Francesca Ruiz
// de` on body line 6 and `Luzuriaga` on body line 7.
func TestSplitTableJoinsAWrappedProposal(t *testing.T) {
	rows := runISSNPXDoc(t, loadSplitTableFixture(t, "ST1_hccapital_two_page_groups.txt"))
	var found bool
	for _, r := range rows {
		if r[stColItemSeq] != "1f" {
			continue
		}
		found = true
		if got := r[stColVoteDesc]; got != "Elect Director Francesca Ruiz de Luzuriaga" {
			t.Errorf("item 1f vote_description = %q, want the two printed lines joined", got)
		}
	}
	if !found {
		t.Fatalf("no row with item_seq 1f; the wrapped proposal was dropped")
	}
}

// TestSplitTableReadsIdentityFromEveryTableOfItsGroup checks one whole row against
// the bytes: its identity comes from three different tables of page group 1.
func TestSplitTableReadsIdentityFromEveryTableOfItsGroup(t *testing.T) {
	rows := runISSNPXDoc(t, loadSplitTableFixture(t, "ST1_hccapital_two_page_groups.txt"))
	var checked int
	for _, r := range rows {
		if r[stColItemSeq] != "1a" {
			continue
		}
		checked++
		for _, c := range []struct{ field, got, want string }{
			{"issuer_name", r[stColIssuerName], "Office Depot, Inc."},
			{"ticker", r[stColTicker], "ODP"},
			{"cusip", r[stColCUSIP], "676220106"},
			{"meeting_type", r[stColMeetingType], "Annual"},
			{"meeting_date", r[stColMeetingDate], "20160713"},
			{"record_date", r[stColRecordDate], "20160609"},
			{"shares_voted", r[stColSharesVoted], "255,155"},
			{"vote_source", r[stColVoteSource], "Management"},
			{"vote_categories", r[stColVoteCategories], "Directors Related"},
			{"vote_description", r[stColVoteDesc], "Elect Director Roland C. Smith"},
			{"management_recommendation", r[stColMgmtRec], "For"},
			{"how_voted", r[stColHowVoted], "For"},
		} {
			if c.got != c.want {
				t.Errorf("item 1a %s = %q, want %q", c.field, c.got, c.want)
			}
		}
	}
	if checked != 1 {
		t.Fatalf("checked %d item-1a rows, want 1", checked)
	}
}

// TestSplitTableAttributesTheFundByItsDeclaredSuffix pins series attribution to
// icrResolveFund rather than to a second copy of that rule. The body prints a
// marketing prefix the header does not carry:
//
//	printed  `Hirtle Callaghan Value Equity Portfolio`
//	declared `The Value Equity Portfolio`          S000009378
//
// so the match is the longest declared name that ends the printed one. The
// header also declares `The Institutional Value Equity Portfolio` (S000021772),
// which the same walk must NOT reach: it is not a suffix of the printed name,
// and picking it would file one fund's votes under another.
func TestSplitTableAttributesTheFundByItsDeclaredSuffix(t *testing.T) {
	rows := runISSNPXDoc(t, loadSplitTableFixture(t, "ST1_hccapital_two_page_groups.txt"))
	seen := map[string]int{}
	for _, r := range rows {
		seen[r[stColSeriesID]]++
	}
	if seen["S000009378"] != len(rows) {
		t.Fatalf("series_id: %v, want all %d rows on S000009378 (The Value Equity Portfolio)", seen, len(rows))
	}
}

func loadSplitTableFixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "splittable", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(b)
}

// ST2 is bytes 628336..644301 of 0001193125-17-270540 (HC Capital Trust),
// verbatim and contiguous from a <TABLE> boundary. It exists to reproduce a
// defect the ST1 fixture cannot: in these page groups the JOIN KEY ITSELF wraps,
//
//	HC Capital Trust The Value
//	Equity Portfolio                 One Year         One Year       Yes        No
//
// so the row's key arrives on one line and its data on the next. The first
// corpus run read 1,531 rows as `Year` and 1,491 as `One` where the filing
// prints `One Year`, and 205 as `Vote Do Not` where it prints `Do Not Vote` --
// a pending fragment applied as a PREFIX to the wrong row. About 5,000 of
// 74,294 rows.
//
// The vote column here has exactly three values in the bytes: For, One Year and
// Against. Any other value is bleed.
func TestSplitTableWrappedJoinKey(t *testing.T) {
	rows := runISSNPXDoc(t, loadSplitTableFixture(t, "ST2_hccapital_wrapped_key.txt"))
	if len(rows) == 0 {
		t.Fatal("no rows; the fixture carries several complete page groups")
	}
	allowed := map[string]bool{"For": true, "One Year": true, "Against": true, "Withhold": true}
	bad := map[string]int{}
	for _, r := range rows {
		if v := r[stColHowVoted]; !allowed[v] {
			bad[v]++
		}
	}
	if len(bad) > 0 {
		t.Errorf("how_voted carries values the filing never prints in that cell: %v\n"+
			"  fragments like One / Year / Vote Do Not mean the wrapped-key join drifted", bad)
	}
	for _, r := range rows {
		if r[stColFundName] != "HC Capital Trust The Value Equity Portfolio" {
			t.Errorf("fund_name = %q, want the two wrapped lines joined", r[stColFundName])
			break
		}
	}
}

// ST3 is bytes 13094708..13102325 of 0001193125-17-270540, verbatim and
// contiguous from a <TABLE> boundary. It reproduces the shape ST2 does not: the
// VOTE VALUE ITSELF wraps, so a fragment of it sits on the key-continuation line.
//
//	HC Capital Trust The Institutional Value Equity                     One
//	Portfolio                       One Year       Year   Yes   No
//
// The filing's value is `One Year` in both the recommendation and the vote cell.
// Reading the fragment line as a row is what produced 1,531 rows of `Year` and
// 1,491 of `One` across the corpus.
func TestSplitTableWrappedVoteValue(t *testing.T) {
	rows := runISSNPXDoc(t, loadSplitTableFixture(t, "ST3_hccapital_wrapped_vote.txt"))
	if len(rows) == 0 {
		t.Fatal("no rows; the fixture carries a complete table")
	}
	for _, r := range rows {
		for _, frag := range []string{"One", "Year", "Do Not", "Vote"} {
			if r[stColHowVoted] == frag {
				t.Errorf("how_voted = %q, a FRAGMENT of the value the filing prints;"+
					" the wrapped vote was read as a row of its own", frag)
			}
		}
		if r[stColFundName] != "HC Capital Trust The Institutional Value Equity Portfolio" {
			t.Errorf("fund_name = %q, want the two wrapped lines joined", r[stColFundName])
			break
		}
	}
	var oneYear int
	for _, r := range rows {
		if r[stColHowVoted] == "One Year" {
			oneYear++
		}
	}
	if oneYear == 0 {
		t.Errorf("no row reads `One Year`, which this fixture prints in the vote cell")
	}
}
