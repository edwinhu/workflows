package main

import (
	"path/filepath"
	"testing"
)

// 000153/1534881/0001398344-23-015308.txt: verbatim source lines 1-104 (the SEC
// opener, the whole `<SERIES-AND-CLASSES-CONTRACTS-DATA>` block, `</SEC-HEADER>`,
// the document opener and the `<BODY>`), 226-235 (`Item 1. Proxy Voting Record`,
// the fund banner and the blank line after it), 20703-20717 (the opener and the
// seven-column header row of the filing's second flat grid), 25238-25245 (ONE
// `<TR>` of that grid -- a Taiwan Semiconductor ballot -- verbatim), 25630 (that
// grid's `</TABLE>`), 25638-25749 (the AVANGRID, INC. banner, its
// `Security:`/`Ticker:`/`ISIN`/`Agenda` identity block, the
// `Item`/`Proposal`/`Recommendation`/`Default Vote` header band and the DIRECTOR
// item with its first two nominee rows), a `</TABLE>`, and the filing's own last
// six lines. Every byte is verbatim. Dispatches to `proxyedge` (the precondition
// asserts it).
//
// Aspiriant Trust, CIK 1534881, period 20230630. On the whole filing the current
// binary emits 1,133 rows, and EVERY ONE carries a blank series_id and, for
// fund_name, the proposal text below rather than a fund. Measured, HEAD:
//
//	$ ./parse_npx_go -files-from fl.txt -out out.tsv -manifest man.tsv
//	$ awk -F'\t' '{print $8"|"$10}' out.tsv | sort | uniq -c
//	   1133 |Amend the Name of Audit Committee in the Policies (I)Procedures for ...
//
// The filing's heading is NOT the cause. It is printed with a raw line break
// inside its own `<U>` span, at source lines 231-232, verbatim:
//
//	...font-size: 11pt"><U>Aspiriant
//	Risk-Managed Equity Allocation Fund</U></FONT></P>
//
// and the same fixture with the one grid `<TR>` below removed and nothing else
// changed emits the AVANGRID row with series `S000036290` and fund_name
// `Aspiriant Risk-Managed Equity Allocation Fund`. The wrapped heading rejoins
// and exact-matches the header's own `<SERIES-NAME>` already; that one `<TR>` is
// the whole difference.
//
// The cause is the grid's PROPOSAL cell at source line 25243, verbatim:
//
//	Amend the Name of Audit Committee in the Policies (I)Procedures for
//	Acquisition or Disposal of Assets (II)Procedures for Financial Derivatives
//	Transactions (III)Procedures for Lending Funds to Other Parties
//	(IV)Procedures for Endorsement and Guarantee
//
// `matchProxyEdge` claims the whole document -- the AVANGRID ballot's identity
// labels and header band are both inside the layout's window -- so this flat
// grid is read by `parseProxyEdge` too, one cell per line, and every proposal
// cell is offered to the bare-heading scan at layout_proxyedge.go:755.
//
// `peFundWord` (layout_proxyedge.go:519) accepts the PLURAL of a fund word as
// that word, by design (layout_proxyedge.go:525-527):
//
//	if end < len(up) && up[end] == 'S' && !strings.HasSuffix(w, "S") {
//		end++
//	}
//
// That is right for a fund name -- a registrant may print `XYZ Funds` -- and it
// is what `Lending Funds to Other Parties` trips: `FUNDS` stands space-bounded,
// so `peFundName` says yes, `fund` becomes the whole proposal text, and it
// matches no series in the filing's own header and nothing in the dictionary.
// The 1,133 ballot rows all stand after it in document order and inherit it.
//
// This is a THIRD distinct false-banner cell in this registrant's grid, and
// neither existing guard reaches it. `family_ns_aspiriant_trusttype_falseheading`
// retired the HYPHENATED compound (`Trust-Type`) by word-bounding `peFundWord`,
// and that same change deliberately kept the plural. `family_ns1534881_issuer_name_banner`
// covers the ISSUER-NAME cell of an ordinary grid row. Here the offending cell
// is neither: it is a proposal cell in which a genuine, space-bounded plural
// fund word appears in ordinary prose.
//
// Fix location: `layout_proxyedge.go`. A proposal cell of a flat vote grid --
// a `<td>` under a `Proposal Text` column, in a row whose other cells are the
// row's own ballot data -- is never a fund banner, whatever fund word its prose
// carries. Narrowing the plural rule alone would be wrong: `XYZ Funds` is a real
// banner spelling, and this cell would still carry `FUND` in a longer sentence.
func TestFamilyNS1534881PluralFundWordProposalBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	// The filing declares S000036290 in its own `<SERIES>` header, so the
	// resolution under test needs no dictionary and no overlay.
	cikDict, seriesMap = nil, nil

	dir := filepath.Join("testdata", "family_ns1534881_plural_fund_word")
	fixture := "aspiriant_lending_funds_proposal_banner.txt"
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

	// The AVANGRID ballot stands AFTER the grid row in document order and under
	// no banner of its own, so it inherits the section's fund -- which is the
	// one the filing's header declares as S000036290.
	const wantFund = "Aspiriant Risk-Managed Equity Allocation Fund"
	row := rows[0]
	if row.IssuerName != "AVANGRID, INC." || row.CUSIP != "05351W103" {
		t.Fatalf("fixture precondition: the fixture's one row is not the AVANGRID ballot: issuer=%q cusip=%q", row.IssuerName, row.CUSIP)
	}
	if row.SeriesID != "S000036290" {
		t.Errorf("the proposal text `... Procedures for Lending Funds to Other Parties ...` was taken for a fund banner and reset the section's fund: issuer=%q cusip=%q fund=%q series=%q; want fund=%q series=%q",
			row.IssuerName, row.CUSIP, row.FundName, row.SeriesID, wantFund, "S000036290")
	}
	if row.FundName != wantFund {
		t.Errorf("fund_name carries the proposal text rather than the fund: fund=%q want %q", row.FundName, wantFund)
	}
}
