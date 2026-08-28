package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Fixtures in testdata/broadridge are VERBATIM excerpts of real N-PX filings,
// extracted with byte fidelity verified (0 trailing-whitespace lines, 0 non-ASCII,
// 0 form feeds; E7 carries 18 real tabs). Ground truth below was counted by hand
// against those bytes.
//
// They exist because the hand-written fixtures this layout was built from missed
// the shapes that actually occur. Measured against the shipped parser: over the
// 81 sampled filings the layout claimed, ground truth is 200,590 proposal rows
// and it emitted 180 -- recall 0.090%, with 78 of 81 returning zero rows.

type brCase struct {
	file        string
	rows        int
	issuer      string
	ticker      string // "" means the filing states none
	cusip       string
	meetingDate string // YYYYMMDD
	note        string
}

var broadridgeGroundTruth = []brCase{
	{"E1.txt", 24, "BANK OF AMERICA CORPORATION", "BAC", "060505104", "20040526",
		"`Prop. #` spaced header; page break mid-slate -- the last 13 rows must inherit meeting context across it"},
	{"E2.txt", 7, "1-800 CONTACTS, INC.", "CTAC", "681977104", "20040521",
		"clean block; issuer indented above labels; inline label pairs"},
	{"E3.txt", 13, "3M COMPANY", "MMM", "88579Y101", "20230509",
		"modern `Prop.#`; two-line header with the spill line SECOND; two preceding no-activity funds"},
	{"E4.txt", 10, "ADVENT SOFTWARE, INC.", "ADVS", "007974108", "20050518",
		"ITEM/TYPE shape; SGML <TABLE>/<S><C> furniture inside the block"},
	{"E5.txt", 5, "HOUSING DEVELOPMENT FINANCE CORP LTD", "", "Y37246207", "20110708",
		"SIX columns -- the sixth is PREFERRED PROVIDER RECOMMENDATION whose value `None` is a vote word; TICKER SYMBOL value is blank"},
	{"E6.txt", 11, "A.P. MOELLER - MAERSK A/S, COPENHAGEN", "", "K0514G101", "20170328",
		"CMMT annotation rows and alphabetic items A..F; every vote and management cell blank"},
	{"E7.txt", 4, "STABLE ROAD ACQUISITION CORP", "SRAC", "85236Q109", "20210506",
		"tab-delimited export; vote cells on the LAST physical line; roman-numeral items i..iv"},
	{"E8.txt", 3, "ZYMOGENETICS, INC.", "ZGEN", "98985T109", "20040610",
		"block cut short, then five no-activity funds that must NOT become issuer names"},
}

func loadBR(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "broadridge", name))
	if err != nil {
		t.Fatalf("read fixture: %v", err)
	}
	return []byte(edgarEnvelope("0001084380", "0000930413-04-004118", string(b)))
}

func TestBroadridgeRealFilings(t *testing.T) {
	for _, c := range broadridgeGroundTruth {
		t.Run(c.file, func(t *testing.T) {
			res := parseText(loadBR(t, c.file), FilingMeta{FilePath: "edgar/x.txt", FormType: "N-PX"})

			if res.Meta.ParseStatus != "ok" {
				t.Fatalf("status=%q layout=%q err=%q\nwant ok. %s",
					res.Meta.ParseStatus, res.Meta.Layout, res.Meta.ErrorMsg, c.note)
			}
			if len(res.Rows) != c.rows {
				t.Fatalf("got %d rows, want %d. %s", len(res.Rows), c.rows, c.note)
			}
			for i, r := range res.Rows {
				if r.IssuerName != c.issuer {
					t.Errorf("row %d issuer = %q, want %q", i, r.IssuerName, c.issuer)
					break
				}
				if r.Ticker != c.ticker {
					t.Errorf("row %d ticker = %q, want %q", i, r.Ticker, c.ticker)
					break
				}
				if r.CUSIP != c.cusip {
					t.Errorf("row %d cusip = %q, want %q", i, r.CUSIP, c.cusip)
					break
				}
				if r.MeetingDate != c.meetingDate {
					t.Errorf("row %d meeting_date = %q, want %q", i, r.MeetingDate, c.meetingDate)
					break
				}
			}
		})
	}
}

// The discriminating rows: cases where a plausible-but-wrong parser produces the
// right row COUNT with the wrong values.
func TestBroadridgeDiscriminatingRows(t *testing.T) {
	meta := FilingMeta{FilePath: "edgar/x.txt", FormType: "N-PX"}

	t.Run("E1 shareholder proposals: vote and management differ", func(t *testing.T) {
		res := parseText(loadBR(t, "E1.txt"), meta)
		if len(res.Rows) != 24 {
			t.Fatalf("got %d rows, want 24", len(res.Rows))
		}
		// A parser that copies one cell into both fields passes a count check
		// and fails here. Vote is the MIDDLE cell, management the RIGHTMOST.
		for _, w := range []struct{ seq, cast, mgmt, sponsor string }{
			{"03", "Against", "For", "Shr"},
			{"04", "Against", "For", "Shr"},
			{"05", "Against", "For", "Shr"},
		} {
			var found *VoteRow
			for i := range res.Rows {
				if res.Rows[i].ItemSeq == w.seq {
					found = &res.Rows[i]
					break
				}
			}
			if found == nil {
				t.Errorf("item %s not emitted", w.seq)
				continue
			}
			if found.HowVoted != w.cast || found.ManagementRecommendation != w.mgmt {
				t.Errorf("item %s: how_voted=%q mgmt=%q, want %q/%q -- these are the rows where the two columns disagree",
					w.seq, found.HowVoted, found.ManagementRecommendation, w.cast, w.mgmt)
			}
			if found.VoteSource != w.sponsor {
				t.Errorf("item %s: sponsor = %q, want %q", w.seq, found.VoteSource, w.sponsor)
			}
		}
		// The director slate parent carries no vote at all.
		for i := range res.Rows {
			if res.Rows[i].ItemSeq == "01" {
				if res.Rows[i].HowVoted != "" || res.Rows[i].ManagementRecommendation != "" {
					t.Errorf("item 01 (the DIRECTOR slate parent) has how_voted=%q mgmt=%q, want both empty -- inventing a vote is worse than dropping the row",
						res.Rows[i].HowVoted, res.Rows[i].ManagementRecommendation)
				}
			}
		}
	})

	t.Run("E5 the sixth column is not the management recommendation", func(t *testing.T) {
		res := parseText(loadBR(t, "E5.txt"), meta)
		if len(res.Rows) != 5 {
			t.Fatalf("got %d rows, want 5", len(res.Rows))
		}
		for i, r := range res.Rows {
			if r.HowVoted != "For" || r.ManagementRecommendation != "For" {
				t.Errorf("row %d how_voted=%q mgmt=%q, want For/For -- the trailing `None` is PREFERRED PROVIDER RECOMMENDATION, not a vote",
					i, r.HowVoted, r.ManagementRecommendation)
			}
			if r.Ticker != "" {
				t.Errorf("row %d ticker = %q, want empty -- the value after `TICKER SYMBOL` is blank, and the label's own second word is not a ticker", i, r.Ticker)
			}
		}
	})

	t.Run("E6 nothing was voted: every vote cell blank", func(t *testing.T) {
		res := parseText(loadBR(t, "E6.txt"), meta)
		if res.Meta.ParseStatus != "ok" {
			t.Fatalf("status=%q", res.Meta.ParseStatus)
		}
		for i, r := range res.Rows {
			if r.HowVoted != "" || r.ManagementRecommendation != "" {
				t.Errorf("row %d has how_voted=%q mgmt=%q, want both empty -- this meeting is Non-Voting throughout", i, r.HowVoted, r.ManagementRecommendation)
			}
		}
	})

	t.Run("E3 wrapped proposal text is retained", func(t *testing.T) {
		res := parseText(loadBR(t, "E3.txt"), meta)
		if len(res.Rows) != 13 {
			t.Fatalf("got %d rows, want 13", len(res.Rows))
		}
		// 57.3% of real rows wrap; the continuation carries the director's name.
		if !strings.Contains(res.Rows[0].VoteDescription, "Thomas") {
			t.Errorf("row 0 vote_description = %q; the continuation line carrying the nominee name was dropped", res.Rows[0].VoteDescription)
		}
		if res.Rows[0].ItemSeq != "1a" {
			t.Errorf("row 0 item_seq = %q, want 1a (trailing punctuation stripped)", res.Rows[0].ItemSeq)
		}
		last := res.Rows[12]
		if last.ItemSeq != "4" || last.HowVoted != "1 Year" || last.ManagementRecommendation != "For" {
			t.Errorf("row 12 = %q/%q/%q, want 4/'1 Year'/For -- a two-word vote value must not be split",
				last.ItemSeq, last.HowVoted, last.ManagementRecommendation)
		}
	})

	t.Run("E7 vote cells on the LAST physical line", func(t *testing.T) {
		res := parseText(loadBR(t, "E7.txt"), meta)
		if len(res.Rows) != 4 {
			t.Fatalf("got %d rows, want 4 -- roman-numeral items i..iv", len(res.Rows))
		}
		for i, want := range []string{"i", "ii", "iii", "iv"} {
			if res.Rows[i].ItemSeq != want {
				t.Errorf("row %d item_seq = %q, want %q", i, res.Rows[i].ItemSeq, want)
			}
			if res.Rows[i].HowVoted != "For" {
				t.Errorf("row %d how_voted = %q, want For", i, res.Rows[i].HowVoted)
			}
		}
		// The trailing lines open the NEXT issuer and must not be absorbed.
		for i, r := range res.Rows {
			if strings.Contains(r.VoteDescription, "GREENVISION") || r.CUSIP == "39678G103" {
				t.Errorf("row %d absorbed the following block (GREENVISION / 39678G103)", i)
			}
		}
	})
}

// E9 is the containment case: the SAME filing switches to the ISS grammar, whose
// column order transposes vote and management recommendation. If the Broadridge
// layout claims it, every row is backwards.
func TestBroadridgeDoesNotClaimISSGrammar(t *testing.T) {
	res := parseText(loadBR(t, "E9.txt"), FilingMeta{FilePath: "edgar/x.txt", FormType: "N-PX"})
	if res.Meta.Layout == "broadridge" {
		t.Fatalf("the broadridge layout claimed an ISS-grammar block; the two grammars transpose Mgt Rec and Vote Cast, so every row would be backwards")
	}
	if res.Meta.ParseStatus == "ok" && len(res.Rows) > 0 {
		if res.Rows[0].HowVoted != "None" || res.Rows[0].ManagementRecommendation != "" {
			t.Errorf("row 0 how_voted=%q mgmt=%q, want None/empty -- under the ISS grammar Mgt Rec comes FIRST and is blank here",
				res.Rows[0].HowVoted, res.Rows[0].ManagementRecommendation)
		}
	}
}
