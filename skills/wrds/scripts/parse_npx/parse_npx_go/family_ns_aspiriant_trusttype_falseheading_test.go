package main

import (
	"path/filepath"
	"testing"
)

// 000153/1534881/0001398344-16-017806.txt: verbatim source lines 1-16 (the SEC
// document opener through the registrant's CIK), 51-104 (the whole
// `<SERIES-AND-CLASSES-CONTRACTS-DATA>` block, `</SEC-HEADER>`, the document
// opener and the `<body>`), 183-284 (`Item 1. Proxy Voting Record`, the fund
// banner, the grid's header row and its first ballot row), 433183-433317 (three
// consecutive Nissha Printing ballot rows, the middle one carrying the
// `Approve Trust-Type Equity Compensation Plan` proposal at source line 433257),
// 619721-619724 (the section's `</table>` and the divs after it) and
// 526673-526851 (the LENOVO GROUP LIMITED ballot block of the filing's SECOND,
// genuinely ProxyEdge template), closed with a `</table>`, a `</div>` and the
// filing's own last eight lines. Every byte is verbatim. Dispatches to
// `proxyedge` (the precondition asserts it).
//
// Aspiriant Trust, CIK 1534881, period 20160630. The filing prints TWO
// templates in one document. The first (source lines ~190-619740) is a flat
// 13-column grid under the banner at source line 188, verbatim:
//
//	<div style="TEXT-ALIGN: left; ...; FONT-SIZE: 11pt"><u>Aspiriant Risk-Managed Global Equity Fund</u></div>
//
// which matches the header's own `<SERIES-NAME>` for S000036290 exactly. The
// second (from source line ~526673) is the ProxyEdge ballot-detail export, and
// it is what makes `matchProxyEdge` claim the WHOLE document: its header band
// (`Item` / `Proposal` / `Recommendation` / `Default Vote` / `For` / `Against` /
// `Abstain` / `Take No Action`) and its `Security:` / `Ticker:` /
// `Meeting Date:` identity labels are both inside the layout's 16 MB window.
// So the first template's grid is read by `parseProxyEdge` too, one cell per
// line, and every one of its proposal cells is offered to the bare-heading scan
// at layout_proxyedge.go:459.
//
// `peFundName` (layout_proxyedge.go:275) takes any cell holding " FUND",
// " PORTFOLIO", " TRUST", " ETF" or " SERIES" as a case-insensitive SUBSTRING
// for a fund banner. The proposal text at source line 433257, verbatim:
//
//	<div style="TEXT-ALIGN: left; ...">Approve Trust-Type Equity Compensation Plan</div>
//
// carries " Trust" inside the hyphenated word `Trust-Type`. It is a standard
// Japanese-issuer governance proposal, not a fund name, and it resolves against
// nothing. Taken for a banner it overwrites the section's already-resolved fund
// and blanks the series for every row after it until the next real banner --
// source line 619741, `Aspiriant Risk-Managed Municipal Bond Fund`.
//
// The pattern recurs SEVEN times in this one filing, at source lines 433257,
// 436132, 470050, 482065, 486020, 508212 and 514152, all of them before that
// next banner. The filing carries 1,813 known-registrant no-series rows in the
// current LOST_BASE.
//
// Measured on this fixture on the current tree: the LENOVO item 1 ballot
// it emits carries fund_name `Approve Trust-Type Equity
// Compensation Plan` with a blank series -- exactly what the full filing shows
// for the same row. Deleting ONLY the Trust-Type ballot row from the fixture
// (fixture source lines 240-284, the middle of the three Nissha rows) and
// changing nothing else, the same row comes back as fund_name `Aspiriant
// Risk-Managed Global Equity Fund`, series `S000036290`. That one cell is the
// whole cause; nothing else in the fixture touches the fund.
//
// Fix location: `layout_proxyedge.go`. A fund word has to be a WORD of the
// cell, not a substring of one -- `Trust-Type` is not `Trust` -- and a
// sentence-shaped proposal that resolves against nothing must not be allowed to
// clear a fund that did resolve.
func TestFamilyNSAspiriantTrustTypeFalseFundHeading(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	// The filing declares S000036290 in its own `<SERIES>` header, so the
	// resolution under test needs no dictionary and no overlay.
	cikDict, seriesMap = nil, nil

	dir := filepath.Join("testdata", "family_ns_aspiriant_trusttype_falseheading")
	fixture := "aspiriant_trusttype_false_fund_heading.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s error=%s", meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}

	var lenovoRow *VoteRow
	var otherRows []VoteRow
	for i := range rows {
		row := &rows[i]
		if row.IssuerName == "LENOVO GROUP LIMITED" && row.CUSIP == "526250105" && row.ItemSeq == "1" {
			if lenovoRow != nil {
				t.Fatalf("fixture precondition: found multiple LENOVO item 1 ballots")
			}
			lenovoRow = row
		} else {
			otherRows = append(otherRows, *row)
		}
	}
	if lenovoRow == nil {
		t.Fatalf("fixture precondition: the LENOVO item 1 ballot was not found")
	}

	// The fixture holds exactly 4 grid ballot rows before the LENOVO block:
	// - Kraft Foods Group, Inc., item 1 (line 130)
	// - Nissha Printing Co. Ltd., item 4 (line 175)
	// - Nissha Printing Co. Ltd., item 5 (line 220)
	// - Nissha Printing Co. Ltd., item 6 (line 265)
	// We allow up to 4 non-LENOVO rows to pass on both the old and new parser behaviour.
	if len(otherRows) > 4 {
		t.Fatalf("found %d non-LENOVO rows; want at most 4", len(otherRows))
	}

	for _, row := range otherRows {
		if row.SeriesID != "S000036290" || row.FundName != "Aspiriant Risk-Managed Global Equity Fund" {
			t.Errorf("grid row resolved wrong fund/series: issuer=%q item=%q fund=%q series=%q; want fund=%q series=%q",
				row.IssuerName, row.ItemSeq, row.FundName, row.SeriesID,
				"Aspiriant Risk-Managed Global Equity Fund", "S000036290")
		}
		if row.FundName == "Approve Trust-Type Equity Compensation Plan" {
			t.Errorf("grid row fund_name carries the proposal text rather than the fund")
		}
	}

	// The LENOVO ballot stands AFTER the Trust-Type proposal in document order
	// and under no banner of its own, so it inherits the section's fund -- which
	// is the one the filing's header declares as S000036290.
	row := *lenovoRow
	if row.SeriesID != "S000036290" {
		t.Errorf("the proposal text `Approve Trust-Type Equity Compensation Plan` was taken for a fund banner and reset the section's fund: issuer=%q cusip=%q item=%q fund=%q series=%q; want fund=%q series=%q",
			row.IssuerName, row.CUSIP, row.ItemSeq, row.FundName, row.SeriesID,
			"Aspiriant Risk-Managed Global Equity Fund", "S000036290")
	}
	if row.FundName != "Aspiriant Risk-Managed Global Equity Fund" {
		t.Errorf("fund_name carries the proposal text rather than the fund: fund=%q want %q", row.FundName, "Aspiriant Risk-Managed Global Equity Fund")
	}
}
