package main

import (
	"path/filepath"
	"testing"
)

// 000077/770906/0000716792-12-000017.txt, First Investors Life Series Funds,
// CIK 770906, period 20120630. The fixture is a byte-exact line-range cut of the
// filing: its own SEC-HEADER/FILER block including the `<SERIES-ID>S000010201` /
// `<SERIES-NAME>FIRST INVESTORS LIFE SERIES GROWTH & INCOME FUND` declaration,
// the `<DOCUMENT>`/`<TEXT>` wrapper, the real banner
//
//	<p><b>First Investors Life Series Funds - Growth &amp; Income Fund</p>
//
// at source line 160, the ballots that follow it, and the first two
// director-election rows of APPLE INC.'s meeting. Only the closing
// `</TEXT>`/`</DOCUMENT>`/`</SEC-DOCUMENT>` tags are added, since the excerpt
// truncates the filing mid-table.
//
// THE REGRESSION. Commit 37c075b7 (family NS-1342947-bbh-subadviser-banner-
// wrapped-cell) taught parseProxyEdge to read a fund banner the vendor
// hard-wrapped inside ONE container: a cell of exactly two physical lines
// (`run[i] == i && cellEnd == i+1`) whose JOINED text satisfies peFundName opens
// a new section, with no check that the cell is in a fund-name position at all
// rather than inside the vote grid. This filing prints a PROPOSAL cell in exactly
// that shape -- source lines 2209-2210, the Proposal column of ballot 13 of the
// meeting above the Apple one:
//
//	<td WIDTH="38%" VALIGN="TOP" HEIGHT="17"><font FACE="Arial" SIZE="1">Amend
//	Sasol Inzalo Foundation Trust Deed</font></td>
//
// joining to `Amend Sasol Inzalo Foundation Trust Deed`, which peFundName accepts
// (verified: true) exactly as it accepts `BBH INTERNATIONAL EQUITY FUND`. The
// branch fires, sets fund to that proposal text, and since no declared series
// answers it fundSeries goes blank -- discarding the section state the banner at
// source line 160 had correctly established (series S000010201, read by a rule
// that predates 37c075b7 and still works). Every row from there onward is emitted
// with a blank series_id, which is what the two Apple rows below show.
//
// NOTE, against the reported hypothesis: the colored header band's hard-wrapped
// `Take No\n    Action` cell at source lines 2969-2970 is NOT the cell that
// fires. Measured directly, peFundName("Take No Action") is FALSE (as is
// peFundName("Recommendation")), so the band is already refused; the vocabulary
// gate catches the header row and misses the proposal text. The missing guard is
// the same one either way -- position inside the grid, not vocabulary -- but the
// witness in this filing is a proposal cell.
//
// Ground truth, by binary bisection on WRDS over this exact fixture:
// parse_npx_go_371 (pre-37c075b7) resolves both rows to S000010201;
// parse_npx_go_372 and HEAD resolve both to "".
//
// Fix location: the two-line-cell banner branch, layout_proxyedge.go:1049. No
// production code is changed here.
func TestNS770906TakeNoActionHeaderMisreadAsBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const fixture = "first_investors_takenoaction_header.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns770906", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || len(rows) != 2 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=2 error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	for _, r := range rows {
		if r.SeriesID != "S000010201" {
			t.Errorf("a two-line cell inside the vote grid was read as a new fund banner, discarding the section's real banner: series=%q fund=%q issuer=%q cusip=%q date=%q desc=%q want series S000010201, which this filing declares at source lines 138-139 and whose banner it prints at source line 160",
				r.SeriesID, r.FundName, r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription)
		}
	}
}
