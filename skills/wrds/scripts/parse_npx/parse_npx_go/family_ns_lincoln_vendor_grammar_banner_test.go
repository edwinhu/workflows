package main

import (
	"path/filepath"
	"testing"
)

// 000091/914036/0001193125-22-231315.txt: verbatim line-range cuts of the source
// -- the SGML header, three `<SERIES>` declarations (S000015976 at source lines
// 1002-1003, plus the two neighbouring sections' series so the cut's header
// fallback has the same shape as the filing's), and source lines 376945-377060,
// which print three consecutive fund sections: the two that precede the failing
// one, then the failing one itself and the bannerless continuation page after it.
// The only added bytes are the closing `</PRE>`, ` </DIV>`, `</TEXT>` and
// `</DOCUMENT>` that close markup the cut opened.
//
// LINCOLN VARIABLE INSURANCE PRODUCTS TRUST, CIK 914036, period 20220630,
// dispatching to `splittable` (the precondition below re-asserts it on the cut).
//
// THE GRAMMAR. Every section of this filing opens the same way -- a page break,
// a rule, `<PRE>`, a blank line, then a bare banner line naming the fund. Most
// sections then print the SEC's own Form N-PX column stack, source lines
// 376953-376956 in this cut's first section:
//
//	                   Exchange                                                      Who Proposed
//	Issuer of          Ticker               Shareholder   Summary of Matter Voted   Matter: Issuer /  Whether Fund Cast
//	Portfolio Security Symbol     CUSIP #   Meeting Date             On               Shareholder      Vote on Matter
//	------------------ --------  ---------- ------------- ------------------------- ----------------  -----------------
//
// The section at source line 377007 opens IDENTICALLY -- same page break, same
// rule, same `<PRE>`, same blank line, same bare banner, `LVIP Franklin Templeton
// Global Equity Managed Volatility Fund`, which this filing declares as
// S000015976 at source lines 1002-1003 and which `cik_series.tsv` carries under
// that id for this CIK. Only the COLUMN STACK below it differs: a vendor grammar
// with nine columns instead of seven, source lines 377009-377011, reproduced
// verbatim in the fixture at lines 169-171:
//
//	                            Provider                                                                 Vote      Vote Against
//	Company Name       Ticker  Security ID  Meeting Date       Proposal Text       Proponent   Voted  Instruction  Management
//	------------       ------  -----------  ------------  ------------------------ ----------- -----  -----------  ------------
//
// `Company Name` / `Provider Security ID` / `Proposal Text` / `Proponent` /
// `Voted` / `Vote Instruction` / `Vote Against Management` in place of `Issuer of
// Portfolio Security` / `CUSIP #` / `Summary of Matter Voted On` / `Who Proposed
// Matter` / `Whether Fund Cast Vote on Matter`. It is also ONE blank line below
// the banner rather than three.
//
// WHAT ACTUALLY HAPPENS -- measured on this cut through the real dispatch: all
// twenty ballots parse. Issuer, CUSIP, meeting date and proposal text are all
// read correctly. But every row carries `FundName == ""` and the three-way header
// fallback `S000015976;S000031867;S000040169` as its series -- the banner
// directly above the table is never attached to the section. In the full filing
// the same fallback spans every series the registrant declares, which is what
// LOST_BASE records as blank series_id.
//
// SCOPE, measured over the whole filing with the current binary: 6,989 of
// 188,400 rows carry a blank series_id, in three runs. The third run, 3,565
// rows, is this section -- `LVIP Franklin Templeton Global Equity Managed
// Volatility Fund` resolves for NOT ONE of its rows, while all 44 sections that
// print the SEC column stack resolve for all of theirs. The other two runs
// (1,316 and 2,108 rows, source lines 43225 and 50218) are the separate
// `ctx.bare` clobber already described in
// family_ns_lincoln_splittable_first_block_test.go.
//
// This is NOT a floor: the fund name is printed in the filing, in the section's
// own banner, and it is a verbatim dictionary name for S000015976.
func TestFamilyNSLincolnVendorGrammarBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const fixture = "lincoln_vendor_grammar_banner.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture,
		filepath.Join("testdata", "family_ns_lincoln_vendor_grammar_banner", fixture),
		sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "splittable" {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s want ok/splittable error=%s",
			meta.ParseStatus, meta.Layout, meta.ErrorMsg)
	}

	// Fixture guard: the vendor-grammar table itself reads. If this count moves,
	// the cut is broken and the attribution assertion below means nothing.
	if len(rows) != 20 {
		t.Fatalf("fixture guard: read %d rows of the vendor-grammar table, want 20 (4 Snowflake at fixture lines 172-181, 16 Burberry at 182-193 and on the continuation page at 199-221)", len(rows))
	}

	const wantSeries = "S000015976"
	const wantFund = "LVIP Franklin Templeton Global Equity Managed Volatility Fund"
	for _, r := range rows {
		if r.SeriesID != wantSeries || r.FundName != wantFund {
			t.Errorf("the section whose banner is printed at source line 377007 carries no fund: issuer=%q cusip=%q desc=%q series=%q fund=%q want series=%q fund=%q -- the banner is a bare line directly above the table, exactly as in the sections that resolve, and the only thing that differs is the nine-column vendor stack below it (fixture lines 169-171) in place of the SEC Form N-PX stack",
				r.IssuerName, r.CUSIP, r.VoteDescription, r.SeriesID, r.FundName, wantSeries, wantFund)
			return
		}
	}
}
