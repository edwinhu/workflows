package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 000091/919160/0001398344-17-011006.txt: verbatim source lines 1-602 (the SGML
// header with all nine `<SERIES>` declarations, `<TEXT>`, `<html>`, `<body>`,
// the cover page and the FIRST counted ballot of the Alternative Energy section
// -- its `Item | Proposal | Recommendation | Default Vote | For | Against |
// Abstain | Take No Action` band and two of its rows), 38581-38593 (the
// `Guinness Atkinson Asia Pacific Dividend Builder Fund` section banner at
// source line 38583), 40086 (the `<table>` that opens that section's ballots)
// and 45048-45396 (the `CAPITALAND MALL TRUST, SINGAPORE` 13-Apr-2017 AGM --
// its banner row, its identity block, its `Item | Proposal | Proposed by | Vote
// | For/Against Management` band, items 1 through 4, the two unlabelled
// resolution-continuation `<tr>`s at source lines 45293 and 45312, and the item
// rows after them). Two added `</table>` lines close the cuts' own tables and
// the last seven lines close markup the cut opened; every other byte is a line
// range of the source.
//
// GUINNESS ATKINSON FUNDS, CIK 919160, period 20170630, N-PX, dispatched
// `proxyedge` (the precondition below re-asserts it on the cut).
//
// THE DEFECT. The bare-heading arm at `layout_proxyedge.go:917` reads ANY whole,
// un-wrapped, non-summary, non-item cell as a fund banner the moment
// `peFundName` finds FUND, PORTFOLIO, TRUST, ETF or SERIES standing as a WORD
// anywhere inside it. A ballot's own resolution text is such a cell whenever the
// vendor prints its continuation as a `<tr>` carrying one wide `<td>` and
// nothing else, which is exactly how this filing prints the CMT general mandate:
// source line 45312 is one 2,459-byte whole cell of prose, and the words `TRUST
// DEED DATED 29 OCTOBER 2001` inside it satisfy `peFundWord(up, "TRUST")`. The
// arm fires, `fund` becomes the resolution text, `icrResolveFundShared` and
// `htmlDictionaryFund` both return "" for it, and `fundSeries` is cleared. On
// the whole real filing eleven such cells fire -- the CMT and Ascendas REIT
// unitholder resolutions and the Aberdeen Asset Management director-slate text
// at source lines 92207-92352, whose `MANAGING THE FUND STICHTING DEPOSITARY`
// trips the same word test.
//
// THE ROW-LEVEL ASSERTION, NOW THAT IT IS CONSTRUCTIBLE. This test was first
// written asserting only the arm's own guard composition, because no row of this
// cut reached the paragraph at all: from the Asia Pacific section onward the
// filing's bands are `Item | Proposal | Proposed by | Vote | For/Against
// Management`, which names no disposition column, so `peHeaderAt` returned nil
// on the then-current two-dispositions-minimum gate, `labels` kept the
// eight-column band the Alternative Energy section left behind, `peVoteRow`
// refused every row against it, and the cut emitted only the TWO Alternative
// Energy rows it opens with -- both upstream of every false heading. That unread
// band was a separate defect of a separate cause, and it was what HID this one.
//
// It is fixed: `peHeaderAt` now admits the vote-named shape alongside the
// counted one, and `peIdentityLabel` now reads this vendor's colon-less
// `Security` / `Ticker Symbol` / `Meeting Date` spelling, so the issuer scan
// claims `CAPITALAND MALL TRUST, SINGAPORE` instead of letting the bare-heading
// scan take its `TRUST` for a fund word. The cut therefore emits SIX rows: the
// same two, plus the four CMT resolutions, and items 3 and 4 stand AFTER both
// unlabelled resolution-continuation `<tr>`s (source lines 45293 and 45312).
// Those two rows are the row-level proof this test could not carry before -- a
// row that survives the paragraph and still names the banner's fund. The
// guard-composition assertions below are kept: they are what makes the cause
// legible when a row-level one fails, and the real banner's own heading test is
// the regression that a guard silencing the prose too broadly would trip.
func TestFamilyNS919160V4ProseFundWordIsNotAFundHeading(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	const dir = "family_ns919160v4_proxyedge_prose_fundword"
	var err error
	// The real corpus rows for this CIK, verbatim from
	// /scratch/nyu/eddyhu/npx-reconcile-corpus/cik_series.tsv. The filing's own
	// SGML header already declares every series, so the dictionary is not what
	// makes the banner resolvable -- it is here so the defect cannot be read as
	// a missing-dictionary miss.
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, "guinness_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "guinness_capitaland_trustdeed_prose_2017.txt"
	path := filepath.Join("testdata", dir, fixture)

	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, path, sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || len(rows) != 6 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/proxyedge/6 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	const (
		banner = "Guinness Atkinson Asia Pacific Dividend Builder Fund"
		series = "S000009157"
		// The distinguishing words of source line 45312's resolution cell.
		proseMark = "TRUST DEED DATED 29 OCTOBER 2001"
		altIssuer = "CHINA LONGYUAN POWER GROUP CORPORATION LTD"
		cmtIssuer = "CAPITALAND MALL TRUST, SINGAPORE"
	)

	// The six rows are the cut's two ballots: the Alternative Energy one it opens
	// with, whose section is the only one printing share counts, and the CMT one
	// the `Proposed by | Vote` band fix made readable.
	var alt, cmt []VoteRow
	for i, r := range rows {
		switch r.IssuerName {
		case altIssuer:
			alt = append(alt, r)
		case cmtIssuer:
			cmt = append(cmt, r)
		default:
			t.Fatalf("fixture guard: row %d is neither ballot the cut carries: issuer=%q item=%q fund=%q",
				i, r.IssuerName, r.ItemSeq, r.FundName)
		}
	}
	if len(alt) != 2 || len(cmt) != 4 {
		t.Fatalf("fixture guard: cut emits %d Alternative Energy rows and %d CAPITALAND rows, want 2 and 4",
			len(alt), len(cmt))
	}

	// THE GUARD THIS TEST EXISTS FOR, asserted on every row the cut emits: no
	// row's fund name may be a ballot's own resolution text. The arm overwrites
	// `fund` with whatever cell it fires on, so a fund name carrying the
	// paragraph's own words -- or running to sentence length, or equal to the
	// issuer the vendor printed above the same band -- is the defect, whichever
	// row it lands on.
	for i, r := range rows {
		if peBallotProse(r.FundName) || strings.Contains(strings.ToUpper(r.FundName), proseMark) {
			excerpt := r.FundName
			if len(excerpt) > 180 {
				excerpt = excerpt[:180] + "..."
			}
			t.Errorf("row %d (issuer=%q item=%q) carries a ballot's resolution text for a fund name (%d bytes), not a fund the vendor printed:\n\t%s\n\tthe bare-heading arm at layout_proxyedge.go:917 fired on a prose cell, overwriting `fund` and clearing `fundSeries`",
				i, r.IssuerName, r.ItemSeq, len(r.FundName), excerpt)
		}
		if r.FundName == r.IssuerName {
			t.Errorf("row %d: fund_name=%q is the ISSUER's own name -- the bare-heading scan took a corporate-form word in it for a fund word instead of the issuer scan claiming the cell (layout_proxyedge.go:891-897, peIdentityLabel)",
				i, r.FundName)
		}
	}

	// The Alternative Energy rows stand upstream of every heading below: they say
	// the cut parses, and their blank series is a separate cause (the cover page's
	// bare registrant name is what `fund` holds there).
	for i, r := range alt {
		if r.FundName != "GUINNESS ATKINSON FUNDS" {
			t.Errorf("Alternative Energy row %d: fund_name=%q want %q -- this section is upstream of every heading in the cut, so it must still carry the cover page's registrant name",
				i, r.FundName, "GUINNESS ATKINSON FUNDS")
		}
	}

	// The four CMT resolutions, keyed by the verbatim opening of each one's
	// `Proposal` cell. Items 3 and 4 are the ones that matter to this test: both
	// stand after an unlabelled resolution-continuation `<tr>` (source lines
	// 45293 and 45312), and item 3's own continuation is the 2,459-byte
	// `TRUST DEED DATED 29 OCTOBER 2001` cell. Each must still name the banner
	// the section opened with.
	want := []struct {
		item, descPrefix, howVoted string
		afterProse                 bool
	}{
		{"1", "TO RECEIVE AND ADOPT THE REPORT OF HSBC INSTITUTIONAL TRUST SERVICES (SINGAPORE) LIMITED", "For", false},
		{"2", "TO RE-APPOINT KPMG LLP AS AUDITORS OF CMT", "For", false},
		{"3", "THAT AUTHORITY BE AND IS HEREBY GIVEN TO THE MANAGER TO:", "Against", true},
		{"4", "THAT: (A) THE EXERCISE OF ALL THE POWERS OF THE MANAGER TO REPURCHASE ISSUED UNITS", "For", true},
	}
	for _, w := range want {
		var got *VoteRow
		for i := range cmt {
			if strings.HasPrefix(cmt[i].VoteDescription, w.descPrefix) {
				got = &cmt[i]
				break
			}
		}
		if got == nil {
			t.Errorf("CAPITALAND MALL TRUST item %s emits no row: wanted a row whose vote_description opens %q",
				w.item, w.descPrefix)
			continue
		}
		if got.ItemSeq != w.item {
			t.Errorf("CAPITALAND MALL TRUST %q: item_seq=%q want %q", w.descPrefix, got.ItemSeq, w.item)
		}
		if got.HowVoted != w.howVoted {
			t.Errorf("CAPITALAND MALL TRUST item %s: how_voted=%q want %q -- the `Vote` column carries the vote itself on this band, verbatim",
				w.item, got.HowVoted, w.howVoted)
		}
		after := ""
		if w.afterProse {
			after = " -- and this row stands AFTER an unlabelled resolution-continuation <tr>, which is exactly the cell the arm at layout_proxyedge.go:917 must not read as a new fund banner"
		}
		if got.FundName != banner || got.SeriesID != series {
			t.Errorf("CAPITALAND MALL TRUST item %s: fund_name=%q series_id=%q want %q / %q%s",
				w.item, got.FundName, got.SeriesID, banner, series, after)
		}
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines, run, tbl := peCellLines(string(stripHTMLCells(raw)))
	whole := peWholeCells(run)
	summary := peSummaryBody(lines, run, tbl)
	wrapped := peWrappedProse(lines, tbl, whole)
	// The eight-column band the Alternative Energy section installs, the only one
	// either cell below is under in this cut before the CMT band opens. `labels`
	// reaches the arm only through `peItemCell`, and neither the banner nor the
	// paragraph is an item cell under any band this filing prints, so the arm's
	// verdict on both is the same either way.
	labels := []string{"Item", "Proposal", "Recommendation", "Default Vote", "For", "Against", "Abstain", "Take No Action"}

	// heading reports the bare-heading arm's own condition, verbatim from
	// layout_proxyedge.go:917.
	heading := func(i int) bool {
		return whole[i] && !summary[i] && !wrapped[i] &&
			!peItemCell(lines, tbl, i-1, i, labels) && peFundName(lines[i])
	}

	prose, bannerLine := -1, -1
	for i := range lines {
		if prose < 0 && strings.Contains(lines[i], proseMark) {
			prose = i
		}
		// The LAST occurrence before the prose cell: the name stands twice in
		// the header's own `<SERIES-NAME>` / `<CLASS-CONTRACT-NAME>` pair before
		// it is ever printed in the body, and neither of those is a cell.
		if prose < 0 && strings.TrimSpace(lines[i]) == banner {
			bannerLine = i
		}
	}
	if prose < 0 || bannerLine < 0 {
		t.Fatalf("fixture guard: cut lost its own lines: prose=%d banner=%d", prose, bannerLine)
	}

	// The real banner must stay a heading: a guard that silences the prose by
	// refusing every bare heading would blank the series on the sections that do
	// resolve today.
	if !heading(bannerLine) {
		t.Errorf("the real section banner at cut line %d (%q, source line 38583) stopped being read as a fund heading: whole=%v summary=%v wrapped=%v itemCell=%v fundName=%v",
			bannerLine, lines[bannerLine], whole[bannerLine], summary[bannerLine], wrapped[bannerLine],
			peItemCell(lines, tbl, bannerLine-1, bannerLine, labels), peFundName(lines[bannerLine]))
	}

	if heading(prose) {
		excerpt := lines[prose]
		if len(excerpt) > 180 {
			excerpt = excerpt[:180] + "..."
		}
		t.Errorf("the ballot's own resolution text at cut line %d (source line 45312, %d bytes) is read as a new fund-section heading: whole=%v summary=%v wrapped=%v itemCell=%v fundName=%v\n\t%s\n\tit is item 3's general-mandate continuation, not a fund the vendor printed -- `THE TRUST DEED DATED 29 OCTOBER 2001` makes `peFundWord(up, \"TRUST\")` true, so the arm at layout_proxyedge.go:917 overwrites `fund` with this paragraph and clears `fundSeries` for every row after it, blanking the series the banner at source line 38583 resolved",
			prose, len(lines[prose]), whole[prose], summary[prose], wrapped[prose],
			peItemCell(lines, tbl, prose-1, prose, labels), peFundName(lines[prose]), excerpt)
	}
}
