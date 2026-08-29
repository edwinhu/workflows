package main

import (
	"strings"
	"testing"
)

// Header shapes the shipped layout declines, collected from the 15,871 filings
// still skipped after the htmltable layout landed. Counts are filings carrying
// that exact header. Every entry below was observed in a real document; none is
// invented.
//
//	423  proposal # | proposal | vote | author | mrv* | vs. mgmt
//	159  (a) issuer's name | (b) exchange ticker symbol | (c) "cusip" # |
//	     (d) shareholder meeting date | (e) matter identification | (f) proposal type ...
//	130  proposal | proposed by | mgt. position | registrant voted
//	107  date/type | ballot issues | security | rec | cast | date | prpnent | voted
//	 81  proposal type | voted? | vote | for/agnst mgmt
//	 59  item | proposal | proposed by | vote | for/against management
//	 20  issue no. | description | proponent | mgmt rec | vote cast | for/agnst mgmt   (Glass Lewis)
//
// THE DISTINCTION THIS FILE EXISTS TO PIN. `Voted?` is not a vote. It is a yes/no
// gate meaning "did the fund cast a ballot", and it sits BESIDE the real vote
// column. A synonym table that maps it to `vote` produces how_voted = "Yes",
// which is not a vote the filing ever recorded and is exactly the kind of value
// that survives every downstream check because it looks plausible. The same holds
// for a trailing `Voted` column that carries share counts.
//
// These filings are small family funds ISS Voting Analytics does not cover, so a
// wrong vote column cannot be caught by agreement with ISS. Widening synonyms is
// the cheapest way to raise coverage and the cheapest way to poison it.

type synCase struct {
	name     string
	header   []string
	data     []string
	wantDesc string
	wantVote string
	wantBy   string
	wantMgmt string
}

var synonymCases = []synCase{
	{
		name:     "author_and_mrv",
		header:   []string{"Proposal #", "Proposal", "Vote", "Author", "MRV*", "vs. Mgmt"},
		data:     []string{"1", "ELECT DIRECTOR JANE DOE", "For", "Management", "For", "For"},
		wantDesc: "ELECT DIRECTOR JANE DOE", wantVote: "For",
		wantBy: "Management", wantMgmt: "For",
	},
	{
		name:     "mgt_position_registrant_voted",
		header:   []string{"Proposal", "Proposed By", "Mgt. Position", "Registrant Voted"},
		data:     []string{"RATIFY AUDITORS", "Management", "For", "Against"},
		wantDesc: "RATIFY AUDITORS", wantVote: "Against",
		wantBy: "Management", wantMgmt: "For",
	},
	{
		name:     "glass_lewis_format_b",
		header:   []string{"Issue No.", "Description", "Proponent", "Mgmt Rec", "Vote Cast", "For/Agnst Mgmt"},
		data:     []string{"1.1", "ELECT DIRECTOR JOHN ROE", "Management", "For", "Withhold", "Against"},
		wantDesc: "ELECT DIRECTOR JOHN ROE", wantVote: "Withhold",
		wantBy: "Management", wantMgmt: "For",
	},
	{
		name:     "item_proposed_by_vote",
		header:   []string{"Item", "Proposal", "Proposed By", "Vote", "For/Against Management"},
		data:     []string{"2", "APPROVE EXECUTIVE COMPENSATION", "Management", "Abstain", "Against"},
		wantDesc: "APPROVE EXECUTIVE COMPENSATION", wantVote: "Abstain",
		wantBy: "Management", wantMgmt: "",
	},
}

func synDoc(header, data []string) string {
	return htmlDoc(
		htmlRow("ISSUER NAME: ALPHA CORP", "", "MEETING DATE: 05/14/2008", "", "") +
			htmlRow("TICKER: ALPH", "", "SECURITY ID: 111111111", "", "") +
			htmlRow(header...) + htmlRow(data...) + htmlRow(data...) + htmlRow(data...))
}

// TestHTMLTableSynonymShapes: each observed header must map its columns to the
// right fields. A missing synonym leaves the layout unable to reach three fields
// and the filing stays skipped; a WRONG synonym shifts the mapping silently.
func TestHTMLTableSynonymShapes(t *testing.T) {
	for _, c := range synonymCases {
		t.Run(c.name, func(t *testing.T) {
			rows := runISSNPXDoc(t, synDoc(c.header, c.data))
			if len(rows) != 3 {
				t.Fatalf("header %v produced %d rows, want 3", c.header, len(rows))
			}
			r := rows[0]
			if got := r[colVoteDescription]; got != c.wantDesc {
				t.Errorf("vote_description = %q, want %q", got, c.wantDesc)
			}
			if got := r[colHowVoted]; got != c.wantVote {
				t.Errorf("how_voted = %q, want %q", got, c.wantVote)
			}
			if c.wantBy != "" {
				if got := r[colVoteSource]; got != c.wantBy {
					t.Errorf("vote_source = %q, want %q", got, c.wantBy)
				}
			}
			if c.wantMgmt != "" {
				if got := r[colMgmtRec]; got != c.wantMgmt {
					t.Errorf("management_recommendation = %q, want %q", got, c.wantMgmt)
				}
			}
		})
	}
}

// TestHTMLTableVotedGateIsNotTheVote is the assertion that must not be traded for
// coverage. `Voted?` answers "did the fund vote", not "how". Its values are Yes
// and No. The real vote is the NEXT column. If the synonym table lets `Voted?`
// claim the vote field, every row of these 81 filings reports how_voted = "Yes".
func TestHTMLTableVotedGateIsNotTheVote(t *testing.T) {
	doc := synDoc(
		[]string{"Proposal Type", "Voted?", "Vote", "For/Agnst Mgmt"},
		[]string{"ELECT DIRECTORS", "Yes", "For", "For"})

	rows := runISSNPXDoc(t, doc)
	if len(rows) != 3 {
		t.Fatalf("produced %d rows, want 3", len(rows))
	}
	for i, r := range rows {
		v := strings.TrimSpace(r[colHowVoted])
		if strings.EqualFold(v, "Yes") || strings.EqualFold(v, "No") {
			t.Fatalf("row %d how_voted = %q -- that is the `Voted?` gate, which says WHETHER"+
				" the fund voted, not how. The real vote is the adjacent `Vote` column."+
				" Reporting Yes as a vote invents a value the filing never recorded.", i, v)
		}
		if v != "For" {
			t.Errorf("row %d how_voted = %q, want %q from the Vote column", i, v, "For")
		}
	}
}

// TestHTMLTableTallyLayoutIsDeclined: 118 filings use
// `Item | Proposal | Recommendation | Default Vote | For | Against | Abstain | Take No Action`,
// where the vote is expressed as SHARE COUNTS spread across four columns rather
// than one categorical cell. That is a different row model. Mapping `For` to the
// vote field would report the string "For" as the vote regardless of whether the
// fund voted for -- the column header, not the fund's choice. Until the tally
// model is implemented, these must be DECLINED, not guessed.
func TestHTMLTableTallyLayoutIsDeclined(t *testing.T) {
	doc := synDoc(
		[]string{"Item", "Proposal", "Recommendation", "Default Vote", "For", "Against", "Abstain", "Take No Action"},
		[]string{"1", "ELECT DIRECTORS", "For", "For", "1000", "0", "0", "0"})

	for i, r := range runISSNPXDoc(t, doc) {
		v := strings.TrimSpace(r[colHowVoted])
		if strings.EqualFold(v, "For") || strings.EqualFold(v, "Against") ||
			strings.EqualFold(v, "Abstain") || strings.EqualFold(v, "Take No Action") {
			t.Fatalf("row %d how_voted = %q, but in a tally layout that string is a COLUMN"+
				" HEADING, not this fund's vote -- the vote is which column carries the"+
				" shares. Decline the layout rather than reporting the heading as a vote.", i, v)
		}
	}
}
