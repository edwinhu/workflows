package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 26,749 of the corpus's 92,379 filings (29%) parse to parse_status=skip: no
// layout claims them, so they contribute zero vote rows. Measured over that skip
// pile, 17,637 are HTML <table> documents and 9,112 are not. A header test that
// requires LABEL-like cells -- no CUSIP, no date, no bare vote value, no
// signature-block prose -- and at least three following rows of comparable arity
// keys 9,018 of them (33.7% of the skip pile).
//
// Those filings are the ones Shu (2024, JFE 154, 103810) classifies as formats
// A.1/A.2 (ISS ProxyExchange), B (Glass Lewis Viewpoint) and C (Broadridge
// ProxyEdge), plus a large residue of family-specific in-house formats that his
// taxonomy books as "Others". A single cell-level field mapper covers all of
// them: 3,073 raw header tuples collapse to 95 canonical field sets once HTML
// entities are decoded, and the top 15 sets cover 95.1%.
//
// WHY THIS CANNOT USE THE EXISTING LAYOUT INTERFACE. layoutEntry.Parse receives
// stripHTML'd text, so the table markup -- the only thing that says which cell
// belongs to which column -- is destroyed before any layout runs. That is the
// same defect class as the Vanguard column-gap bug: normalisation discarding the
// structure the layout needs. A table layout must see the charset-decoded bytes,
// which parseText already holds.
//
// THE FAILURE MODE THAT MATTERS. These filings are disproportionately small,
// family-specific funds, which is exactly the population ISS Voting Analytics
// does NOT cover -- so a mis-mapped column cannot be caught by agreement with
// ISS. Two of five sampled filings had rows that a loose header test accepted as
// headers: a data row (`TMB | CUSIP 87974D100 | Voted`) and an agent-for-service
// prose block. Either would map every field to the wrong column and emit a whole
// filing of confidently wrong rows. Skipping is strictly better than that, so the
// tests below assert exact field values, not merely that rows were produced.

type htmlCase struct {
	file        string
	rows        int
	issuer      string
	cusip       string
	ticker      string // "" means the filing prints none
	meetingDate string // YYYYMMDD
	firstItem   string
	firstDesc   string
	howVoted    string
	mgmtRec     string
	proposedBy  string
}

// Ground truth read by hand off the fixture bytes. Both are Shu format A.2:
// `Proposal No | Proposal | Proposed By | Management Recommendation | Vote Cast`,
// with the meeting context in preamble rows ABOVE the header rather than in a
// block heading. "Proportional" is a real vote value (echo voting), not a parse
// artifact -- a vote vocabulary that rejects it is wrong.
var htmlGroundTruth = []htmlCase{
	{
		file: "H1_a2_iss.txt", rows: 10,
		issuer: "VIP CONTRAFUND PORTFOLIO", cusip: "922175773", ticker: "",
		meetingDate: "20080514",
		firstItem:   "1. 1", firstDesc: "ELECT JAMES C. CURVEY AS A DIRECTOR",
		howVoted: "Proportional", mgmtRec: "For", proposedBy: "Management",
	},
	{
		file: "H2_a2_iss.txt", rows: 8,
		issuer: "FIDELITY ADVISOR DIVERSIFIED INTERNATIONAL FUND", cusip: "315920686",
		ticker: "FDVIX", meetingDate: "20060920",
		firstItem: "1. 1", firstDesc: "ELECT DENNIS J. DIRKS AS A DIRECTOR",
		howVoted: "Proportional", mgmtRec: "For", proposedBy: "Management",
	},
}

func loadHTMLFixture(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(b)
}

// TestHTMLTableExtractsRows is the coverage assertion: these filings must stop
// being skipped and must yield exactly the rows their table holds.
func TestHTMLTableExtractsRows(t *testing.T) {
	for _, c := range htmlGroundTruth {
		t.Run(c.file, func(t *testing.T) {
			got := runISSNPXDoc(t, loadHTMLFixture(t, c.file))
			if len(got) != c.rows {
				t.Fatalf("produced %d rows, want %d -- the fixture's table holds exactly"+
					" %d proposal rows under one header", len(got), c.rows, c.rows)
			}
		})
	}
}

// TestHTMLTableMapsColumnsToTheRightFields is the assertion that a wrong header
// row would fail. Every value below sits in a specific column of the fixture; a
// mis-mapped header shifts them and this test catches it.
func TestHTMLTableMapsColumnsToTheRightFields(t *testing.T) {
	for _, c := range htmlGroundTruth {
		t.Run(c.file, func(t *testing.T) {
			got := runISSNPXDoc(t, loadHTMLFixture(t, c.file))
			if len(got) == 0 {
				t.Fatalf("%s produced no rows", c.file)
			}
			r := got[0]
			for _, f := range []struct{ name, got, want string }{
				{"issuer_name", r[colIssuerName], c.issuer},
				{"cusip", r[colCUSIP], c.cusip},
				{"ticker", r[colTicker], c.ticker},
				{"meeting_date", r[colMeetingDate], c.meetingDate},
				{"item_seq", r[colItemSeq], c.firstItem},
				{"vote_description", r[colVoteDescription], c.firstDesc},
				{"how_voted", r[colHowVoted], c.howVoted},
				{"management_recommendation", r[colMgmtRec], c.mgmtRec},
				{"vote_source", r[colVoteSource], c.proposedBy},
			} {
				if f.got != f.want {
					t.Errorf("row 0 %s = %q, want %q", f.name, f.got, f.want)
				}
			}
		})
	}
}

// TestHTMLTableVoteValuesAreVotes guards the mis-mapped-column failure directly:
// if `how_voted` picks up the wrong column it lands on a proposal description, a
// proposer or a CUSIP. Every emitted value must be a vote the filing printed.
func TestHTMLTableVoteValuesAreVotes(t *testing.T) {
	for _, c := range htmlGroundTruth {
		t.Run(c.file, func(t *testing.T) {
			for i, r := range runISSNPXDoc(t, loadHTMLFixture(t, c.file)) {
				v := strings.TrimSpace(r[colHowVoted])
				if v == "" {
					t.Errorf("row %d has an empty how_voted", i)
					continue
				}
				if !isVoteValue(v) {
					t.Errorf("row %d how_voted = %q, which is not a vote -- the vote column"+
						" is mapped to the wrong cell", i, v)
				}
			}
		})
	}
}

// votes.tsv column indices, derived from the VoteRow field order in types.go.
// series_id and class_ids are 7 and 8 there; the rest follow the struct.
const (
	colIssuerName      = 10
	colCUSIP           = 11
	colTicker          = 14
	colMeetingDate     = 15
	colItemSeq         = 18
	colVoteDescription = 19
	colHowVoted        = 25
	colMgmtRec         = 27
	colVoteSource      = 22
)
