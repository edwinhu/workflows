package main

import (
	"path/filepath"
	"testing"
)

// Penn Street Fund Inc (CIK 0000948666), verbatim bytes from its 2006 N-PX,
// 000094/948666/0001144204-06-036627.txt (period 20060630, md5
// c2fe5fa85925732da0ad3bb324336d5f, 20,610 lines), htmltable layout.
//
// Fixture penn_street_voting_agent_2006.txt is
// `sed -n '1,299p;300,572p;8779,8831p;8832,9076p;17834,17893p;17894,18129p;18130,18185p;18186,18383p;20517,20609p'`
// over that file, concatenated in that order and otherwise untouched (13
// `<table` openers, 13 `</table>` closers -- the slice boundaries were chosen at
// the file's own `</tr>` and `</table>` lines, so no element is cut mid-tag):
//
//	1-299       the SGML header (2 <SERIES> declarations, lines 55-91), the
//	            FORM N-PX preamble, the FIRST `Voting Agent:` masthead table
//	            (lines 270-294, banner text at 284-285, `Number of Meetings: 63`
//	            at 289-290) and the opener of the vote table it heads (line 299).
//	300-572     that table's two column-header rows and its first two issuer
//	            sections -- PROCTER & GAMBLE COMPANY (THE) 742718109 [PG],
//	            Special, 7/12/2005, 2 ballots; DELL INC. 24702R101 [DELL],
//	            Annual, 7/15/2005, 4 ballots -- cut at the `</tr>` closing
//	            DELL's spacer row, immediately before the third issuer.
//	8779-8831   the `</table>` closing the first fund's vote table, the SECOND
//	            `Voting Agent:` masthead table (8802-8827, banner at 8816-8818,
//	            `Number of Meetings: 65`) and the opener of its vote table.
//	8832-9076   that table's header rows and its first issuer section, BT GROUP
//	            PLC ADR, Annual, 7/13/2005, 7 ballots.
//	17834-17893 the `</table>` closing the second fund's vote table, a Date
//	            Range table, the THIRD `Voting Agent:` masthead (17875-17889,
//	            banner at 17879-17880, `Number of Meetings: 2`) and its vote
//	            table opener.
//	17894-18129 the whole of that third table -- AMERICAN INTERNATIONAL GROUP,
//	            INC., 8/11/2005, 2 ballots and ORACLE CORPORATION, 10/10/2005,
//	            3 ballots -- through its own `</table>`.
//	18130-18185 the FOURTH `Voting Agent:` masthead (18154-18178, banner at
//	            18168-18169, `Number of Meetings: 22`) and its vote table opener.
//	18186-18383 that table's header rows and its first issuer section, VODAFONE
//	            GROUP PLC, 7/26/2005, 5 ballots.
//	20517-20609 the `</table>` closing the last vote table, the document footer,
//	            the SIGNATURES block and the trailing `</TEXT>` / `</DOCUMENT>` /
//	            `</SEC-DOCUMENT>` tags.
//
// Dictionary: both cik_series.tsv rows this CIK carries, copied verbatim from
// the corpus dictionary (`grep 948666 cik_series.tsv` returns exactly these two
// lines, and this filing is the only filing either row cites).
//
// WHAT THE FILING PRINTS. The registrant heads each fund's vote table with a
// masthead cell reading `Voting Agent: <fund>`, word-wrapped by the filing agent
// across source lines. Four such mastheads appear, in this order:
//
//	line 284-285    Voting Agent: Penn Street Sector Rotational Portfolio
//	line 8816-8818  Voting Agent: Berkshire Advisors / Select Equity
//	                Portfolio
//	line 17879-80   Voting Agent: McGlinn Balanced Portfolio
//	line 18168-69   Voting Agent: Baldwin Large Cap Growth
//
// The filing's own SEC-HEADER declares exactly TWO series at this vintage:
//
//	S000001801  Penn Street Advisors Sector Rotational Portfolio  (C000004714
//	            Class A PSRPX, C000004715 Class C PSACX)
//	S000001802  Berkshire Advisors Select Equity Portfolio        (C000004716
//	            Class C, C000004717 Class A PBKAX)
//
// THE DEFECT, measured on HEAD over the real filing (binary built from this
// tree, run with -cik-series over this CIK's two dictionary rows; the corpus
// series_map_applied.tsv carries NO row for this accession, so the overlay is
// not in play either way): 611 rows emitted, of which
//
//	rows 1-258    series_id BLANK, fund_name BLANK
//	rows 259-611  series_id S000001802, fund_name `Agent: Berkshire Advisors / Select Equity`
//
// 258 known-registrant no_series rows, and they are exactly the first fund's
// section. The second masthead RESOLVES: the parser reads that cell as a
// masthead candidate, and `Berkshire Advisors / Select Equity` reaches
// S000001802 (the trailing wrap line `Portfolio` is dropped from the recorded
// fund_name, which is why the stamped fund_name reads as it does). The first
// masthead does NOT resolve, and the reason is one word: the filing prints
//
//	Penn Street Sector Rotational Portfolio
//
// where its own header declares `Penn Street Advisors Sector Rotational
// Portfolio`. The printed banner DROPS `Advisors`.
//
// WHY THIS IS PROVABLE, NOT A GUESS. It is a SAME-FILING, SAME-VINTAGE match,
// not a cross-filing rename inference:
//
//   - The filing declares exactly two series. The printed banner is a
//     word-subsequence of S000001801's declared name and shares no distinctive
//     word with S000001802's (`Berkshire`, `Select`, `Equity`), so it maps to
//     exactly one declared series and the other is an elimination.
//   - Corpus-wide, `grep -i 'penn street' cik_series.tsv` returns exactly ONE
//     row at ONE CIK -- S000001801 of this registrant. There is no third
//     similarly-named series anywhere to create ambiguity. (`grep -i
//     'rotational'` returns only that row and CIK 1330967's `MFS Sector
//     Rotational Fund`, a different registrant with no `Penn Street` in it.)
//   - This CIK contributes exactly two dictionary rows corpus-wide, both from
//     this accession, so there is no other vintage of this registrant that could
//     claim the name.
//
// A SECOND, DISTINCT DEFECT OF THE SAME SHAPE -- A MISLINK, NOT A BLANK. The
// third and fourth mastheads name `McGlinn Balanced Portfolio` and `Baldwin
// Large Cap Growth`. Neither fund is declared in this filing's header, and
// neither appears in ANY dictionary row at ANY CIK (`grep -i 'McGlinn'` returns
// nothing; `grep -i 'Baldwin'` returns only CIK 1281790's `Leigh Baldwin Total
// Return Fund`, a different registrant and a different fund). They are genuine
// floor -- unattributable. But because neither masthead resolves, the SECOND
// fund's section is never closed, so all 76 of their rows in the real filing
// inherit `S000001802`. That is Berkshire Advisors Select Equity Portfolio being
// credited with votes the filing attributes to two other funds. Run in
// isolation, without the second fund's table above them, those same rows carry
// the parser's own no-section fallback for a two-series registrant,
// `S000001801;S000001802` -- so the leak is the open section, not the fallback.
//
// Both halves are one defect: the `Voting Agent:` masthead cell is not read as a
// section boundary that OPENS on resolution and CLOSES the previous section
// whether or not it resolves. A fix that only teaches the first banner's name
// to resolve would leave the 76-row mislink in place, which is why this test
// asserts it too.
//
// The fixture reproduces all three behaviors on HEAD: 6 blank rows under the
// first masthead, 7 correctly-stamped rows under the second, and 10 rows of the
// third and fourth leaking the second's series_id.
func TestFamilyNS948666VotingAgentBannerResolves(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns948666_voting_agent_banner", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		fixture = "penn_street_voting_agent_2006.txt"
		// The two series this filing's own SEC-HEADER declares.
		pennStreet = "S000001801" // Penn Street Advisors Sector Rotational Portfolio
		berkshire  = "S000001802" // Berkshire Advisors Select Equity Portfolio
	)

	// (issuer, meeting date) identifies the masthead each row sits under,
	// uniquely within this fixture -- no issuer appears under two mastheads
	// here, which is why the slices above were cut where they were.
	type section struct {
		name   string // the masthead as the filing prints it
		want   int    // rows the fixture emits under it on HEAD
		issuer map[string]string
	}
	first := section{
		name: "Voting Agent: Penn Street Sector Rotational Portfolio",
		want: 6,
		issuer: map[string]string{
			"PROCTER & GAMBLE COMPANY (THE)|20050712": "",
			"DELL INC.|20050715":                      "",
		},
	}
	second := section{
		name:   "Voting Agent: Berkshire Advisors / Select Equity Portfolio",
		want:   7,
		issuer: map[string]string{"BT GROUP PLC ADR|20050713": ""},
	}
	undeclared := section{
		name: "Voting Agent: McGlinn Balanced Portfolio / Voting Agent: Baldwin Large Cap Growth",
		want: 10,
		issuer: map[string]string{
			"AMERICAN INTERNATIONAL GROUP, INC.|20050811": "",
			"ORACLE CORPORATION|20051010":                 "",
			"VODAFONE GROUP PLC|20050726":                 "",
		},
	}

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns948666_voting_agent_banner", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.CIK != "0000948666" || meta.PeriodOfReport != "20060630" || meta.Layout != "htmltable" {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}

	pick := func(s section) []VoteRow {
		var out []VoteRow
		for _, r := range sink.buf {
			if _, ok := s.issuer[r.IssuerName+"|"+r.MeetingDate]; ok {
				out = append(out, r)
			}
		}
		return out
	}

	// Preconditions: the fixture must still carry every section, at its measured
	// size, or the assertions below would pass over nothing.
	for _, s := range []section{first, second, undeclared} {
		if got := len(pick(s)); got != s.want {
			t.Fatalf("fixture precondition: %d rows under %q, want %d (fixture emitted %d rows in total)",
				got, s.name, s.want, len(sink.buf))
		}
	}

	// THE DEFECT. Every row of the first fund's section must carry S000001801.
	for _, r := range pick(first) {
		if r.SeriesID != pennStreet {
			t.Errorf("masthead %q: row issuer=%q meeting=%q item=%q carries series_id=%q fund_name=%q, want series_id=%s. The filing prints `Penn Street Sector Rotational Portfolio`; its OWN SEC-HEADER declares that fund as %s `Penn Street Advisors Sector Rotational Portfolio` -- the banner drops the single word `Advisors`. This is a same-filing, same-vintage match, not a rename inference: the header declares exactly two series, the printed banner shares no distinctive word with the other (%s `Berkshire Advisors Select Equity Portfolio`), and corpus-wide `grep -i 'penn street' cik_series.tsv` returns exactly one row -- %s of this CIK -- so no third series can claim the name. On HEAD all 258 rows of this section in the real filing 0001144204-06-036627.txt carry a blank series_id and a blank fund_name; the SECOND masthead of the same filing resolves fine, because its printed name loses no declared word. desc=%.60q",
				first.name, r.IssuerName, r.MeetingDate, r.ItemSeq, r.SeriesID, r.FundName,
				pennStreet, pennStreet, berkshire, pennStreet, r.VoteDescription)
			break
		}
		if r.FundName == "" {
			t.Errorf("masthead %q: row issuer=%q meeting=%q carries series_id=%q but a BLANK fund_name. The masthead the section opens on is printed text and must be recorded, as it is for the second masthead of this same filing (`Agent: Berkshire Advisors / Select Equity`)",
				first.name, r.IssuerName, r.MeetingDate, r.SeriesID)
			break
		}
	}

	// CONTRAST. Nothing about the wanted fix may disturb the masthead this
	// filing already answers, or the 353 rows it stamps in the real filing
	// become a regression invisible outside the corpus.
	for _, r := range pick(second) {
		if r.SeriesID != berkshire {
			t.Errorf("contrast masthead %q regressed: row issuer=%q meeting=%q item=%q carries series_id=%q, want %s (this masthead resolves on HEAD; the declared name loses no word, only a space becomes ` / `)",
				second.name, r.IssuerName, r.MeetingDate, r.ItemSeq, r.SeriesID, berkshire)
			break
		}
	}

	// THE MISLINK. `McGlinn Balanced Portfolio` and `Baldwin Large Cap Growth`
	// are declared in no header and appear in no dictionary row at any CIK, so
	// they are floor. Floor must read as floor: an unresolvable masthead has to
	// CLOSE the section above it rather than let its rows inherit that fund's
	// series_id.
	for _, r := range pick(undeclared) {
		if r.SeriesID == berkshire {
			t.Errorf("masthead %q: row issuer=%q meeting=%q item=%q carries series_id=%q -- the series of the PRECEDING masthead (`Berkshire Advisors Select Equity Portfolio`). Neither `McGlinn Balanced Portfolio` nor `Baldwin Large Cap Growth` is declared in this filing's header, and neither appears in any cik_series.tsv row at any CIK, so both are unattributable floor. Because neither masthead resolves, the Berkshire section is never closed and 76 rows of the real filing are credited to a fund the filing does not attribute them to. Run without the Berkshire table above them, these same rows carry the parser's own two-series fallback `%s;%s`, so the leak is the un-closed section, not the fallback. fund_name=%q desc=%.60q",
				undeclared.name, r.IssuerName, r.MeetingDate, r.ItemSeq, r.SeriesID,
				pennStreet, berkshire, r.FundName, r.VoteDescription)
			break
		}
	}
}
