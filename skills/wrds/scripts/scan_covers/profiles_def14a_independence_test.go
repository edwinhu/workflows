package main

import (
	"strings"
	"testing"
)

// Regression fixtures. Every string below is VERBATIM from the DEF 14A named in
// the comment, as /wrds/sec/wrds_clean_filings renders it (apostrophes deleted
// by the converter, whitespace collapsed here for the test).
func TestClassifySentenceForms(t *testing.T) {
	cases := []struct {
		name  string
		sent  string
		form  string
		style string
		names []string
	}{
		{
			// Cato Corp DEF 14A 2026-04-10 (0001206774-26-000206)
			name: "named_colon_full",
			sent: "The Board of Directors determined that each of the following Board members is independent: " +
				"Dr. Pamela L. Davies, Ms. Theresa J. Drew, Mr. Thomas B. Henson, Mr. Bryan F. Kennedy, III, " +
				"Mr. Bailey W. Patrick and Mr. D. Harding Stowe.",
			form: "named", style: "full",
			names: []string{"Pamela L. Davies", "Theresa J. Drew", "Thomas B. Henson",
				"Bryan F. Kennedy III", "Bailey W. Patrick", "D. Harding Stowe"},
		},
		{
			// Bassett Furniture DEF 14A 2026-02-11 (0001437749-26-003747).
			// Surname-only, two gender-group prefixes and a legislative honorific.
			name: "named_surname_groups",
			sent: "The Board of Directors has determined that each of Mses. Battle, Cashman and Hamlet, " +
				"the Hon. Sen. Wampler and Messrs. Belk, Goergen, McDowell and Warden are independent, " +
				"as defined by NASDAQ.",
			form: "named", style: "single",
			names: []string{"Battle", "Cashman", "Hamlet", "Wampler", "Belk", "Goergen",
				"McDowell", "Warden"},
		},
		{
			// JPMorganChase DEF 14A 2026-04-06 (0000019617-26-000096).
			name: "named_parenthetical",
			sent: "The Board, having reviewed the relevant relationships between the Firm and each " +
				"non-management director, determined, in accordance with the NYSEs listing standards and " +
				"the Firms independence standards, that each non-management director (Linda B. Bammann, " +
				"Michele G. Buck, Stephen B. Burke, Alicia Boler Davis, Alex Gorsky, Mellody Hobson, " +
				"Phebe N. Novakovic, Virginia M. Rometty, Brad D. Smith, and Mark A. Weinberger) had only " +
				"immaterial relationships with JPMorganChase and accordingly is independent.",
			form: "named", style: "full",
			names: []string{"Linda B. Bammann", "Michele G. Buck", "Stephen B. Burke",
				"Alicia Boler Davis", "Alex Gorsky", "Mellody Hobson", "Phebe N. Novakovic",
				"Virginia M. Rometty", "Brad D. Smith", "Mark A. Weinberger"},
		},
		{
			// Apple DEF 14A 2026-01-08 (0001308179-26-000008). MUST NOT read as a
			// one-director independent board.
			name: "except_surname",
			sent: "The Board has determined that all Board members, other than Mr. Cook, are independent " +
				"under applicable rules of The Nasdaq Stock Market LLC (Nasdaq).",
			form: "except_named", style: "single", names: []string{"Cook"},
		},
		{
			// Alphabet DEF 14A 2026-04-24 (0001308179-26-000342). FIRST names only.
			name: "except_firstname",
			sent: "Our Board has determined that each of the director nominees standing for election, " +
				"except Larry, Sergey, and Sundar, are independent directors under these standards.",
			form: "except_named", style: "single",
			names: []string{"Larry", "Sergey", "Sundar"},
		},
		{
			// Exxon Mobil DEF 14A 2026-04-08 (0001193125-26-147614). No names at all.
			name: "all_nonemployee",
			sent: "Based on that review, the Board determined that all ExxonMobil non-employee directors " +
				"are independent.",
			form: "all_nonemployee", style: "none",
		},
		{
			// Cato Corp, one sentence after the roster. A NEGATIVE determination:
			// must not contribute names.
			name: "negative_determination_rejected",
			sent: "The Board determined that Mr. John P. D. Cato, an employee of the Company, is not independent.",
			form: "none",
		},
		{
			// Alphabet 2026. Committee-scoped: a three-member "board" if accepted.
			name: "committee_scope_rejected",
			sent: "Our Board has determined that each of the directors serving on the Audit Committee is " +
				"independent under applicable Nasdaq Stock Market (Nasdaq) and SEC rules for Audit " +
				"Committee membership.",
			form: "none",
		},
		{
			// Meta DEF 14A 2026-04-16 (0001628280-26-025532). The IMMATERIALITY
			// clause, not a determination — the directors it names are the ones
			// whose relationships were excused, not the independent roster.
			name: "immateriality_clause_rejected",
			sent: "With regard to each of Ms. Alford, Mr. Andreessen, Mr. Collison, Mr. Elkann, " +
				"Mr. Houston, Mr. White, and Mr. Xu, our board of directors determined that such " +
				"arrangements, transactions, or relationships do not interfere with the exercise of " +
				"independent judgment by these directors in carrying out their responsibilities as our directors.",
			form: "none",
		},
		{
			// Alphabet DEF 14A 2024-04-26. A departed director is described as
			// "a member of our Board and Audit Committee" in a subordinate clause;
			// this is still the board-level determination.
			name: "committee_mention_is_not_committee_scope",
			sent: "Our Board has determined that Ann Mather, who served as a member of our Board and " +
				"Audit Committee until October 31, 2023, and each of the director nominees standing for " +
				"election, except Larry, Sergey, and Sundar, are independent directors under these standards.",
			form: "except_named",
			names: []string{"Larry", "Sergey", "Sundar"},
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := classifySentence(c.sent)
			if got.form != c.form {
				t.Fatalf("form = %q, want %q (names=%v)", got.form, c.form, got.names)
			}
			if c.style != "" && got.style != c.style {
				t.Errorf("style = %q, want %q", got.style, c.style)
			}
			if c.names != nil {
				g := strings.Join(cleanNames(got.names), "|")
				w := strings.Join(c.names, "|")
				if g != w {
					t.Errorf("names =\n  %s\nwant\n  %s", g, w)
				}
			}
		})
	}
}

// The clean-filings archive is HTML-stripped but NOT re-flowed. Half the corpus
// arrives hard-wrapped mid-sentence; a line-anchored extractor silently loses
// exactly that half.
func TestHardWrappedTextIsRecovered(t *testing.T) {
	wrapped := []byte("Board Independence\nApples Corporate Governance Guidelines\n" +
		"require a majority of Board members to be independent. The Board has determined " +
		"that all Board members, other than Mr. Cook, are\nindependent under applicable " +
		"rules of The Nasdaq Stock Market LLC (Nasdaq).\n")
	out := extractIndependence(wrapped)
	parts := strings.Split(out, "|")
	if len(parts) != 11 {
		t.Fatalf("packed field has %d parts, want 11: %q", len(parts), out)
	}
	if parts[0] != "except_named" || parts[2] != "Cook" {
		t.Errorf("det_form=%q names=%q, want except_named / Cook", parts[0], parts[2])
	}
	if parts[5] != "nasdaq" {
		t.Errorf("exchange = %q, want nasdaq", parts[5])
	}
}

// The packed column must survive the TSV writer and build_panel.py's split.
func TestIndepOutIsPipeSafe(t *testing.T) {
	out := indepOut("named", "full", "A|B", 1, 0, "nyse", "", "none", "no", "",
		"text with | pipe\tand tab")
	if n := strings.Count(out, "|"); n != 10 {
		t.Fatalf("packed field has %d pipes, want exactly 10: %q", n, out)
	}
	if strings.ContainsAny(out, "\t\n\r") {
		t.Errorf("packed field contains a TSV-breaking character: %q", out)
	}
}
