package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Glass Lewis (Shu format B) in FIXED-WIDTH TEXT rather than HTML. Measured over
// the 13,801 filings still skipped after the v9 corpus build, the non-HTML
// remainder is where the volume now is:
//
//	7,136  plain text          ~10,523,925 estimated vote lines  (1,475 each)
//	  786  <PRE> fixed width    ~1,761,706 estimated vote lines  (2,241 each)
//	2,074  HTML residue         ~1,100,117                       (  530 each)
//
// The PRE bucket is the densest per filing and is NOT LLM territory: it is
// column-positional text, the grammar issnpx and broadridge already parse. One
// deterministic layout is worth ~1.76M rows.
//
// THE FIXTURE'S THREE DIFFICULTIES, all visible in its bytes:
//
//	Issue No.  Description              Proponent  Mgmt Rec   Vote Cast  For/Against
//	                                                                      Mgmt
//	1.1        Elect Douglas R. Conant  Mgmt       For        For        For
//	1.2        Elect W. Don Cornwell     Mgmt       For        Withhold   Against
//	1.5        Elect Maria Elena              Mgmt       For        Withhold   Against
//	            Lagomasino
//
//  1. the HEADER wraps -- `For/Against` on one line, `Mgmt` on the next;
//  2. column starts DRIFT row to row (`Mgmt` at three different offsets above),
//     so a rigid column map cut from the header will shear;
//  3. DESCRIPTIONS wrap onto continuation lines that carry no other cell.
//
// A layout that mistakes a continuation line for a row emits a vote with no
// description; one that mistakes drift for a new column emits a description with
// the proposer glued on. Both are wrong rows on filings ISS Voting Analytics does
// not cover, so the tests below assert exact field values rather than row counts.

func loadFixed(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "fixedwidth", name))
	if err != nil {
		t.Fatalf("read fixture %s: %v", name, err)
	}
	return string(b)
}

// TestFixedWidthGlassLewisExtractsRows: eleven proposals under one meeting block,
// with the meeting context taken from the lines above the column header.
func TestFixedWidthGlassLewisExtractsRows(t *testing.T) {
	rows := runISSNPXDoc(t, loadFixed(t, "F1_glasslewis_fixedwidth.txt"))
	if len(rows) != 11 {
		t.Fatalf("produced %d rows, want 11 (items 1.1-1.10 and item 2)", len(rows))
	}
	first := rows[0]
	for _, f := range []struct{ name, got, want string }{
		{"issuer_name", first[colIssuerName], "Avon Products, Inc."},
		{"ticker", first[colTicker], "AVP"},
		{"cusip", first[colCUSIP], "054303102"},
		{"meeting_date", first[colMeetingDate], "20130502"},
		{"item_seq", first[colItemSeq], "1.1"},
		{"vote_description", first[colVoteDescription], "Elect Douglas R. Conant"},
		{"vote_source", first[colVoteSource], "Mgmt"},
		{"management_recommendation", first[colMgmtRec], "For"},
		{"how_voted", first[colHowVoted], "For"},
	} {
		if f.got != f.want {
			t.Errorf("row 0 %s = %q, want %q", f.name, f.got, f.want)
		}
	}
}

// TestFixedWidthColumnDriftDoesNotShearFields: rows 1.2 through 1.10 start their
// `Mgmt` cell at several different offsets. A column map cut rigidly from the
// header assigns those to the wrong field; every row must still carry a clean
// proposer and a vote.
func TestFixedWidthColumnDriftDoesNotShearFields(t *testing.T) {
	for i, r := range runISSNPXDoc(t, loadFixed(t, "F1_glasslewis_fixedwidth.txt")) {
		if got := strings.TrimSpace(r[colVoteSource]); got != "Mgmt" {
			t.Errorf("row %d vote_source = %q, want %q -- column drift sheared the field",
				i, got, "Mgmt")
		}
		if v := strings.TrimSpace(r[colHowVoted]); !isVoteValue(v) {
			t.Errorf("row %d how_voted = %q is not a vote value", i, v)
		}
		if d := strings.TrimSpace(r[colVoteDescription]); d == "" {
			t.Errorf("row %d has an empty description", i)
		}
	}
}

// TestFixedWidthWrappedDescriptionIsJoined: item 1.5's description continues on
// the next line and item 2's over two. A continuation line is not a row, and the
// text it carries belongs to the row above.
func TestFixedWidthWrappedDescriptionIsJoined(t *testing.T) {
	rows := runISSNPXDoc(t, loadFixed(t, "F1_glasslewis_fixedwidth.txt"))
	find := func(item string) []string {
		for _, r := range rows {
			if strings.TrimSpace(r[colItemSeq]) == item {
				return r
			}
		}
		return nil
	}
	if r := find("1.5"); r == nil {
		t.Errorf("item 1.5 missing")
	} else if got := r[colVoteDescription]; got != "Elect Maria Elena Lagomasino" {
		t.Errorf("item 1.5 description = %q, want %q -- the continuation line was dropped"+
			" or emitted as its own row", got, "Elect Maria Elena Lagomasino")
	}
	if r := find("2"); r == nil {
		t.Errorf("item 2 missing")
	} else if got := r[colVoteDescription]; got != "Advisory Vote on Executive Compensation" {
		t.Errorf("item 2 description = %q, want %q -- two continuation lines", got,
			"Advisory Vote on Executive Compensation")
	}
}
