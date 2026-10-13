package main

import (
	"path/filepath"
	"strings"
	"testing"
)

const ns1199046ItemdescDir = "family_ns1199046_itemdesc_as_fundname"

// ns1199046ItemdescDispatch runs the real dispatch on this family's fixture
// under PRODUCTION resolution -- the corpus dictionary and the series overlay
// are left exactly as the binary holds them, not nilled out, so the series id
// asserted below is whatever production would emit for this file. The filing's
// own <SERIES-AND-CLASSES-CONTRACTS-DATA> header dictionary is read by
// processFile regardless and is separate from either overlay. Same mechanism as
// ns1199046WrappedTailDispatch, pointed at its own testdata dir.
func ns1199046ItemdescDispatch(t *testing.T, fixture, layout string) (FilingMeta, []VoteRow) {
	t.Helper()
	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", ns1199046ItemdescDir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s want status=ok layout=%s error=%s", meta.ParseStatus, meta.Layout, layout, meta.ErrorMsg)
	}
	return meta, rows
}

// UNIFIED SERIES TRUST, CIK 1199046, period 20080630, filing
// 000119/1199046/0001035449-08-000455.txt (`proxyedge`). 386 rows across 46
// issuers -- VITERRA, THE KROGER CO., ALTRIA GROUP INC and 43 others -- come out
// of the whole accession with fund_name set to the literal string
// `Approve Liquidation and Dissolution of the Fund` and a BLANK series id.
//
// MEASURED ON HEAD over the whole real accession (not the deployed
// parse_npx_go_402 binary, which agrees): status=ok layout=proxyedge rows=2306,
// of which 386 carry that fund_name. On this trimmed fixture the same mechanism
// yields status=ok layout=proxyedge rows=17, ALL SEVENTEEN carrying it.
//
// THE TRAP STRING IS NOT A MASTHEAD. It is the PROPOSAL-DESCRIPTION cell of one
// ordinary, self-contained ballot row: issuer `ACM Managed Income Fund`, ticker
// `AMF`, cusip `000919100`, meeting date 8/9/2007 -- a closed-end fund that held
// its own 2007 shareholder vote on liquidating itself. Its <tr> carries the same
// eleven <td>s in the same order as the `Crescent Real Estate` row above it and
// the `EGL, Inc` row below it, both of which the parser treats as ballot rows:
//
//	issuer | ticker | cusip | meeting date | PROPOSAL | M/S | Y/N | result |
//	result | date voted | rationale
//
// Real accession source lines 264267-264311 (<tr>), the issuer cell at 264269
// and the proposal cell carrying the trap at 264285. In this fixture: <tr> at
// 688-732, issuer cell 690, trap cell 706.
//
// THE RUNG THAT MISFIRES is the bare-fund-heading arm of parseProxyEdge,
// layout_proxyedge.go:1350-1358 -- the arm guarded by
//
//	whole[i] && !summary[i] && !wrapped[i] && !peItemCell(...) &&
//	    !peBandCell(...) && peFundName(line)
//
// peFundName is pure vocabulary once peBallotProse has passed a line, and
// peBallotProse passes this one: at 47 runes and 7 words it is inside
// peHeadingRunes (90) and peHeadingWords (14), it carries no `;` and no `"`, and
// peClauseNumber finds no parenthesised enumerator. peFundWord then finds FUND
// standing as a word at the END of the sentence, so peFundName returns true.
// MEASURED directly: peFundName("Approve Liquidation and Dissolution of the
// Fund") = true, peBallotProse(same) = false. The cell is its own whole <td>, so
// whole[i] holds, and with the open grid's labels in the state this filing
// reaches the ACM row in, neither peItemCell nor peBandCell refuses it. The arm
// fires, sets `fund` to the proposal text and clears the series, and every later
// row inherits it.
//
// CAUSALLY CONFIRMED, not inferred: deleting ONLY that one <tr> from the real
// accession (source lines 264267-264311, nothing else touched) drops the trap
// fund_name from all 2306 rows; deleting it from this fixture does the same.
//
// THE SECOND HALF OF THE DEFECT, disclosed because the brief did not predict it.
// Suppressing the trap alone does NOT make these rows right. With the ACM <tr>
// removed, the VITERRA rows fall back to the PREVIOUS section's fund -- measured
// `Polynous Growth Fund` / S000002754 on the real accession, from the bare
// heading at real source line 262751 (fixture line 471) belonging to the section
// that reports it filed no proxy record. The real masthead for the VITERRA and
// WHIRLPOOL blocks, `Fund/Fund Family Name: Roosevelt Multi-Cap Fund` at real
// source line 268577 (fixture line 746), is NOT read as a banner in this state
// at all. So the correct fund_name is reachable and printed, this is NOT a
// floor, but a fix must both stop the proposal cell from opening a section AND
// let that masthead open one. The assertions below demand exactly that.
//
// The filing's own header declares <SERIES-ID>S000002749 /
// <SERIES-NAME>ROOSEVELT MULTI-CAP FUND (real source lines 166-167, fixture
// lines 166-167), which is what the masthead names.
//
// FIXTURE PROVENANCE. unified_acm_liquidation_itemdesc_2008.txt is real SEC
// EDGAR bytes, accession 0001035449-08-000455, CIK 1199046, period 20080630,
// verbatim and in file order, trimmed to whole <tr>/<table> units. The ranges
// kept, by real source line: 1-419 (privacy header, SEC-HEADER, series
// declarations, <DOCUMENT>/<TEXT>/<html>/<body>), 139429 (the <table> that opens
// the VALERO grid), 160714-160752 (that grid's `Item | Proposal | ... | Type |
// Vote | For/Against Management` header row -- the row that sets the labels the
// trap row is read under; bisected to the <tr>, dropping it makes the defect
// vanish), 262741-262845 (the Polynous Growth Fund heading, then the Quixote
// Capital Management / QCM Absolute Return Fund table's own masthead and column
// header rows), 264145-264311 (the Crescent Real Estate and ACM Managed Income
// Fund ballot rows), 268564-269861 (the Roosevelt Multi-Cap Fund masthead and
// the VITERRA and WHIRLPOOL CORPORATION blocks), plus a closing </table> and the
// accession's own last seven lines. The fixture reproduces the real accession's
// behaviour on BOTH arms of the experiment: trap present -> trap fund_name; ACM
// <tr> deleted -> `Polynous Growth Fund` / S000002754, exactly as the real file.
//
// No production code is changed here.
func TestFamilyNS1199046ItemdescAsFundname(t *testing.T) {
	_, rows := ns1199046ItemdescDispatch(t, "unified_acm_liquidation_itemdesc_2008.txt", "proxyedge")

	const (
		trap      = "Approve Liquidation and Dissolution of the Fund"
		wantFund  = "Roosevelt Multi-Cap Fund"
		wantSerie = "S000002749"
		carryover = "Polynous Growth Fund"
	)

	if len(rows) != 17 {
		t.Fatalf("fixture precondition: %d rows, want 17 (VITERRA and WHIRLPOOL CORPORATION under the Roosevelt masthead)", len(rows))
	}

	// The claim, part one. No row anywhere may take its fund_name from a ballot's
	// proposal text. `Approve Liquidation and Dissolution of the Fund` is the
	// ACM Managed Income Fund row's own Proposal cell (fixture line 706), not a
	// banner this filing printed.
	var trapped int
	for _, r := range rows {
		if r.FundName == trap {
			trapped++
		}
	}
	if trapped != 0 {
		t.Errorf("%d of %d rows took fund_name=%q -- that string is the PROPOSAL cell of the ACM Managed Income Fund ballot row (fixture line 706, real source line 264285), an ordinary 11-<td> row shaped exactly like the Crescent Real Estate row above it; parseProxyEdge's bare-heading arm (layout_proxyedge.go:1350-1358) read it as a fund masthead because peFundName sees FUND standing as a word and peBallotProse does not refuse a 47-rune, 7-word sentence",
			trapped, len(rows), trap)
	}

	// The claim, part two. The VITERRA and WHIRLPOOL CORPORATION blocks sit under
	// the masthead `Fund/Fund Family Name: Roosevelt Multi-Cap Fund` (fixture line
	// 746, real source line 268577), which the filing's own header declares as
	// S000002749. They must carry it -- neither the trap, nor the previous
	// section's Polynous Growth Fund carried forward.
	for i, r := range rows {
		if !strings.Contains(r.FundName, wantFund) {
			t.Errorf("row %d (issuer=%q cusip=%q date=%q): fund_name=%q must name %q -- the masthead this filing prints for this block at fixture line 746",
				i, r.IssuerName, r.CUSIP, r.MeetingDate, r.FundName, wantFund)
		}
		if r.FundName == carryover || strings.Contains(r.FundName, carryover) {
			t.Errorf("row %d (issuer=%q): fund_name=%q is the PREVIOUS section's heading carried forward (fixture line 471); the Roosevelt masthead at fixture line 746 opens a new section and must be read",
				i, r.IssuerName, r.FundName)
		}
		if r.SeriesID != wantSerie {
			t.Errorf("row %d (issuer=%q): series=%q fund=%q want %q -- this filing's own header declares <SERIES-ID>S000002749 / <SERIES-NAME>ROOSEVELT MULTI-CAP FUND at fixture lines 166-167",
				i, r.IssuerName, r.SeriesID, r.FundName, wantSerie)
		}
	}

	// Regression guard. The two blocks' own identities already read correctly on
	// HEAD -- only fund_name and series are wrong. A fix that recovers the fund by
	// disturbing issuer, cusip or meeting date has traded one defect for another.
	want := map[string]struct{ cusip, date string }{
		"VITERRA":               {"803914209", "20080312"},
		"WHIRLPOOL CORPORATION": {"963320106", "20080415"},
	}
	seen := map[string]int{}
	for i, r := range rows {
		w, ok := want[r.IssuerName]
		if !ok {
			t.Errorf("row %d: unexpected issuer %q -- this fixture carries only the VITERRA and WHIRLPOOL CORPORATION blocks", i, r.IssuerName)
			continue
		}
		seen[r.IssuerName]++
		if r.CUSIP != w.cusip || r.MeetingDate != w.date {
			t.Errorf("row %d: the %s block regressed: cusip=%q date=%q want cusip=%s date=%s",
				i, r.IssuerName, r.CUSIP, r.MeetingDate, w.cusip, w.date)
		}
	}
	for issuer := range want {
		if seen[issuer] == 0 {
			t.Errorf("the %s block emitted no rows at all", issuer)
		}
	}
}
