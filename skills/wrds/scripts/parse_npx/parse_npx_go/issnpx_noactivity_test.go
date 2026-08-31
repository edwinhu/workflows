package main

import "testing"

// TestISSZeroRowsNeverReportsOK is the assertion that keeps the 40 Act coverage
// metric honest.
//
// Measured 2026-08-31, this layout claimed 3,722 filings and read nothing out of
// any of them, and every one was recorded as `ok` with n_rows=0 -- which the
// manifest cannot distinguish from a fund that genuinely cast no votes. A layout
// that claims a filing and produces nothing must SAY so, so the chassis can
// decide between "affirmatively empty" and "we could not read this".
//
// Declining is the whole fix: the chassis sentinel at the end of parseTextFiling
// already owns that decision and already guards it with hasVoteTableVocabulary.
// Re-implementing the test inside this layout was the first attempt and was
// withdrawn -- it would have been a second vocabulary for one fact.
func TestISSZeroRowsNeverReportsOK(t *testing.T) {
	for _, c := range []struct{ name, doc string }{
		{"a body with no vote table and no nil statement",
			"ANNUAL REPORT OF PROXY VOTING RECORD\nRegistrant: Some Trust\n\nSIGNATURES\n"},
		{"an affirmative nil report, verbatim shape from the corpus",
			"Item 1. Proxy Voting Record\n" +
				"====================== ING VP INTERMEDIATE BOND PORTFOLIO ======================\n" +
				"This fund had no proxy voting activity during the reporting period.\n" +
				"========== END N-PX REPORT\n"},
	} {
		t.Run(c.name, func(t *testing.T) {
			rows, err := parseISSNPX(c.doc, FilingMeta{})
			if len(rows) == 0 && err == nil {
				t.Errorf("zero rows with a nil error; the manifest records that as a successful parse")
			}
		})
	}
}

// TestChassisOwnsTheNoActivityDecision pins the division of labour the fix
// depends on: the sentinel fires on an affirmative statement, and the vote-table
// guard withholds it when the body also prints a real table -- the case where
// calling a filing empty would record the loss of every vote in it as a success.
func TestChassisOwnsTheNoActivityDecision(t *testing.T) {
	nilOnly := "This fund had no proxy voting activity during the reporting period.\n"
	withTable := nilOnly + "Issue No.  Description  Proponent  Mgt Rec  Vote Cast\n" +
		"1  Elect a Director  Mgmt  For  For\n"

	if !hasNoActivitySentinel(nilOnly) {
		t.Errorf("the sentinel does not recognise the corpus's dominant nil wording")
	}
	if hasVoteTableVocabulary(nilOnly) {
		t.Errorf("a bare nil statement must not read as a vote table")
	}
	if !hasVoteTableVocabulary(withTable) {
		t.Errorf("a body printing a real vote table must be seen as one, or its votes" +
			" are discarded as 'nothing to report'")
	}
}

// The two phrasings added on 2026-08-31, quoted verbatim from the filings they
// were measured in. Both are guarded by hasVoteTableVocabulary like every other
// sentinel, so the second case below is the one that matters: the same words
// beside a real vote table must NOT be read as "nothing to report".
func TestNoActivitySentinelsAddedFromTheResidue(t *testing.T) {
	secWording := "Item 1. Proxy Voting Record\nThere were no matters relating to a portfolio" +
		" security considered at any shareholder meetings held during the reporting period" +
		" and with respect to which the registrant was entitled to vote.\n"
	terse := "ITEM 1. PROXY VOTING RECORD\n\nNO RECORDS TO REPORT\n"

	for _, c := range []struct{ name, doc string }{
		{"the SEC's own Item 1 nil wording, 563 filings", secWording},
		{"the terse form, 93 filings", terse},
	} {
		t.Run(c.name, func(t *testing.T) {
			if !hasNoActivitySentinel(c.doc) {
				t.Errorf("not recognised as an affirmative nil report")
			}
			if hasVoteTableVocabulary(c.doc) {
				t.Errorf("a nil statement must not read as a vote table")
			}
		})
	}

	t.Run("the same words beside a real table must not erase it", func(t *testing.T) {
		mixed := secWording + "\nFund B\nIssue No.  Description  Proponent  Mgt Rec  Vote Cast\n" +
			"1  Elect a Director  Mgmt  For  For\n"
		if !hasVoteTableVocabulary(mixed) {
			t.Errorf("the guard failed to see the vote table, so this filing's votes" +
				" would be recorded as 'nothing to report'")
		}
	})
}

// TestNonNilSentencesAreNotSentinels is the negative half of the sentinel work.
// Each sentence below was surfaced by the same residue sweep that produced the
// additions, looks like a nil report, and appears on filings that DO carry
// votes. Promoting any of them would silently record real vote tables as
// "nothing to report" -- the exact loss hasVoteTableVocabulary exists to stop.
func TestNonNilSentencesAreNotSentinels(t *testing.T) {
	table := "\nIssue No.  Description  Proponent  Mgt Rec  Vote Cast\n1  Elect a Director  Mgmt  For  For\n"
	for _, c := range []struct{ name, text string }{
		{"a table's own legend explaining N/A",
			"Where management made no recommendation on a ballot item, 'N/A' is used to" +
				" indicate that there is no management recommendation."},
		{"a regulatory disclaimer",
			"The votes reported do not reflect any votes cast pursuant to a regulatory requirement."},
		{"a methodology note",
			"In determining votes against management, any ballot that management did not support is counted."},
		{"a per-vote footnote explaining ONE uncast vote",
			"The registrant did not cast a vote since the securities in question were preferred shares."},
		{"an ADJOURNMENT PROPOSAL -- the text of a ballot item",
			"To permit further solicitation of proxies if there are not sufficient votes."},
	} {
		t.Run(c.name, func(t *testing.T) {
			doc := c.text + table
			if !hasVoteTableVocabulary(doc) {
				t.Fatalf("guard failed to see the vote table; this filing's votes would be lost")
			}
			if hasNoActivitySentinel(c.text) {
				t.Errorf("this sentence is being read as an affirmative nil report, but it" +
					" appears on filings that carry votes")
			}
		})
	}
}

// TestWeakVocabularyNeedsRepetition pins the split that recovered 606 filings on
// 2026-08-31. The ISS "VOTE SUMMARY REPORT" header prints a note explaining what
// a CUSIP is, above every fund's section whether or not that fund voted, and the
// guard read it as a vote table -- so a filing saying "There is no proxy voting
// activity for the fund" was withheld from the sentinel and recorded as `skip`.
func TestWeakVocabularyNeedsRepetition(t *testing.T) {
	note := "VOTE SUMMARY REPORT\nFIDELITY CORPORATE BOND FUND\n07/01/2022 - 06/30/2023\n" +
		"Note: The Security ID will be the CUSIP (Committee on Uniform Securities" +
		" Identification Procedures) when available. When CUSIP is not available, an" +
		" alternate identifier, e.g., CINS, will be provided.\n" +
		"There is no proxy voting activity for the fund, as the fund did not hold any" +
		" votable positions during the reporting period.\n"

	if hasVoteTableVocabulary(note) {
		t.Errorf("a sentence EXPLAINING what a CUSIP is still reads as a vote table")
	}
	if !hasNoActivitySentinel(note) {
		t.Errorf("the filing's own nil statement is not being recognised")
	}

	t.Run("one strong label is decisive on its own", func(t *testing.T) {
		small := "Issuer Corp\nMeeting Date: 05/10/2011  CUSIP 88579Y101\n" +
			"Issue No.  Description  Proponent  Mgt Rec  Vote Cast\n" +
			"1  Elect a Director  Mgmt  For  For\n"
		if !hasVoteTableVocabulary(small) {
			t.Errorf("a small but real table must still be seen as one; its votes" +
				" would otherwise be recorded as 'nothing to report'")
		}
	})

	t.Run("weak labels repeated ARE a table, with no strong label present", func(t *testing.T) {
		var b []byte
		for i := 0; i < voteTableWeakMin+5; i++ {
			b = append(b, "Meeting Date: 05/10/2011\n"...)
		}
		if !hasVoteTableVocabulary(string(b)) {
			t.Errorf("a weak label repeated %d times is a table by any reading", voteTableWeakMin+5)
		}
	})
}
