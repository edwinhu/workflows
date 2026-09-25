package main

import (
	"path/filepath"
	"testing"
)

// 000153/1534881/0001398344-16-017806.txt: the fixture reuses, byte for byte,
// the prefix and the tail already extracted for
// `family_ns_aspiriant_trusttype_falseheading` -- source lines 1-16, 51-104 and
// 183-284 (the SEC opener, the whole `<SERIES-AND-CLASSES-CONTRACTS-DATA>`
// block, `Item 1. Proxy Voting Record`, the fund banner, the 13-column grid's
// header row and its first ballot row), then the section's `</table>` and the
// LENOVO GROUP LIMITED block of the filing's second, genuinely ProxyEdge
// template -- and swaps the middle for source lines 484776-484865, the first
// TWO consecutive `Daito Trust Construction Co. Ltd.` ballot rows of the same
// grid, verbatim. Dispatches to `proxyedge` (the precondition asserts it).
//
// Aspiriant Trust, CIK 1534881, period 20160630. The residue is 4,830
// known-registrant no_series rows across three filings.
//
// This is NOT the `Trust-Type` cause fixed in 0271bc41. That one was a PROPOSAL
// cell whose hyphenated compound was read as the word `Trust`; word-bounding
// `peFundWord` retired it. Here the offending cell is the ISSUER NAME itself,
// and `Trust` in `Daito Trust Construction Co. Ltd.` is a genuine, space-bounded
// word -- so `peFundName` (layout_proxyedge.go:275) still says yes, and the
// word-boundary fix cannot reach it.
//
// The grammar is the second, distinct table shape in this document. Source line
// 197 declares the header row of a plain HTML summary grid, verbatim:
//
//	Company Name | Ticker | Country | Provider Security ID | Meeting Type |
//	Meeting Date | Record Date | ... | Proposal | ...
//
// The issuer name is the FIRST `<td>` of an ordinary `<tr>` (source line 484778,
// inside the `<tr>` opened at 484776), and the cell that follows it is the
// ticker `1878` (484781), then `Japan`, then the ISIN `J11151107`. It is NOT
// followed by a `Ticker:` / `Security:` / `Meeting Date:` identity label, so the
// issuer-heading guard at layout_proxyedge.go:478-492 -- which fires only when
// `peIdentityLabel(next)` holds, i.e. only inside the ProxyEdge ballot's
// identity-block grammar -- never fires on it. The cell falls through to the
// bare-heading branch at layout_proxyedge.go:502 and, because `Trust` stands as
// a whole word, is taken for a new fund banner:
//
//	if whole[i] && !peItemCell(lines, tbl, i-1, i, labels) && peFundName(line) {
//		fund = line
//		...
//
// so `fund` becomes `Daito Trust Construction Co. Ltd.`, which resolves against
// no series in the filing's own header and against nothing in the dictionary,
// and every row after it in the section carries a blank series.
//
// Measured on this fixture on the current tree: the single row it emits is the
// LENOVO item 1 ballot, and it carries fund_name
// `Daito Trust Construction Co. Ltd.` with a blank series. The same fixture with
// the two Daito rows removed and nothing else changed emits that row with
// fund_name `Aspiriant Risk-Managed Global Equity Fund`, series `S000036290`.
// The issuer-name cell is the whole cause.
//
// Fix location: `layout_proxyedge.go`. The issuer of an ordinary ballot ROW --
// the first cell of a `<tr>` whose following cells are the row's own data, under
// a `Company Name` header band -- is never a fund banner, however many fund
// words its corporate name carries. The existing guard recognises only the
// identity-block spelling of that same fact.
func TestFamilyNS1534881IssuerNameFalseFundHeading(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	// The filing declares S000036290 in its own `<SERIES>` header, so the
	// resolution under test needs no dictionary and no overlay.
	cikDict, seriesMap = nil, nil

	dir := filepath.Join("testdata", "family_ns1534881_issuer_name_banner")
	fixture := "aspiriant_issuer_name_false_fund_heading.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || len(rows) != 1 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=1 error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	// The LENOVO ballot stands AFTER the Daito rows in document order and under
	// no banner of its own, so it inherits the section's fund -- which is the
	// one the filing's header declares as S000036290.
	row := rows[0]
	if row.IssuerName != "LENOVO GROUP LIMITED" || row.CUSIP != "526250105" || row.ItemSeq != "1" {
		t.Fatalf("fixture precondition: the fixture's one row is not the LENOVO item 1 ballot: issuer=%q cusip=%q item=%q", row.IssuerName, row.CUSIP, row.ItemSeq)
	}
	if row.SeriesID != "S000036290" {
		t.Errorf("the issuer name `Daito Trust Construction Co. Ltd.` was taken for a fund banner and reset the section's fund: issuer=%q cusip=%q item=%q fund=%q series=%q; want fund=%q series=%q",
			row.IssuerName, row.CUSIP, row.ItemSeq, row.FundName, row.SeriesID,
			"Aspiriant Risk-Managed Global Equity Fund", "S000036290")
	}
	if row.FundName != "Aspiriant Risk-Managed Global Equity Fund" {
		t.Errorf("fund_name carries the issuer name rather than the fund: fund=%q want %q", row.FundName, "Aspiriant Risk-Managed Global Equity Fund")
	}
}
