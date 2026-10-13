package main

import (
	"path/filepath"
	"testing"
)

// familyNS12Dispatch runs the real dispatch on a family NS12 fixture with the
// named dictionary rows loaded, and asserts the fixture's own preconditions --
// status, layout and row count -- so a failure below is an assertion about the
// series id and never a broken fixture.
func familyNS12Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns12", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns12", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	return rows
}

// 000091/919557/0001193125-05-177809.txt: verbatim source lines 11-65, 96-99,
// 10588-10620 and 20469-20486 (the filing's own tail). Dispatches to `issnpx`
// (the precondition asserts it).
//
// Travelers Series Fund Inc., 2005. 7,753 of 8,407 rows carry no series. The
// layout reads the wrapped ruled banner correctly -- the emitted fund_name is
// the whole printed heading -- and the resolver then refuses it. Source lines
// 10588-10589 verbatim:
//
//	========== TRAVELERS SERIES FUND INC. - SMITH BARNEY LARGE CAP VALUE ===========
//	==========                         PORTFOLIO                         ===========
//
// The registrant declares no <SERIES-ID> (grep -c = 0), so cikDict.exactFallback
// supplies its 9 dictionary rows, every one of them spelled under the successor
// brand `Legg Mason Partners Variable <X> Portfolio`. The bare remainder
// resolves exactly, and one SIBLING banner in the same filing resolves with the
// brand still on it -- measured through issPlainHeadingSeries on this filing's
// own index plus that dictionary:
//
//	"TRAVELERS SERIES FUND INC. - SMITH BARNEY AGGRESSIVE GROWTH PORTFOLIO"    => S000004454
//	"TRAVELERS SERIES FUND INC. - SMITH BARNEY HIGH INCOME PORTFOLIO"          => S000004455
//	"TRAVELERS SERIES FUND INC. - SMITH BARNEY LARGE CAP VALUE PORTFOLIO"      => ""
//	"TRAVELERS SERIES FUND INC. - SMITH BARNEY MID CAP PORTFOLIO"              => ""
//	"TRAVELERS SERIES FUND INC. - SMITH BARNEY INTERNATIONAL ALL CAP GROWTH PORTFOLIO" => ""
//	"LARGE CAP VALUE PORTFOLIO"             => S000004457
//	"MID CAP PORTFOLIO"                     => S000004459
//	"INTERNATIONAL ALL CAP GROWTH PORTFOLIO" => S000004456
//
// i.e. the declared vocabulary already answers each of the three; only the
// Smith Barney -> Legg Mason Partners historical-brand rung fails to reach them
// while reaching two of their siblings.
//
// Rows reached: LARGE CAP VALUE (939), INTERNATIONAL ALL CAP GROWTH (930) and
// MID CAP (735) are 2,604 of this filing's 7,753 blank rows; the family is 2
// filings and 9,432 pool rows.
//
// Fix in layout_issnpx.go, issResolveFundUncached at :2764-2779 (the
// registrant-prefix + issHistoricalBrandKey pair at :2115/:1519): the stem
// after the `smith barney ` cut must agree with a declared name whole, and this
// registrant's declared names all carry a `Variable` the heading never prints,
// so only the stems registered without it are reachable.
func TestFamilyNS12TravelersSmithBarneyBrandBlocksResolution(t *testing.T) {
	rows := familyNS12Dispatch(t, "travelers_smith_barney_brand_blocks_resolution.txt", "travelers_dict.tsv", "issnpx", 8)
	for _, r := range rows {
		if r.SeriesID != "S000004457" {
			t.Errorf("the Smith Barney brand blocked the declared Large Cap Value Portfolio: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000004457", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000090/909504/0000935069-08-001961.txt: verbatim source lines 11-28, 52-58,
// 81-85, 165-174, 484-512 and 23532-23535 (the filing's own tail), with one
// `</SERIES>` line inserted to close the first series block the cut opened.
// Dispatches to `splittable` (the precondition asserts it).
//
// GAMCO Global Series Funds, 2008. 3,327 of 3,327 rows carry no series. The
// layout reads the ProxyEdge account line correctly; the resolver refuses it
// because of the report-type token the vendor prints first. Source line 488
// verbatim:
//
//	Selected Accounts: NPX GABELLI GLOBAL GROWTH FD                    Page 1 of 101
//
// The filing DECLARES the fund in its own header (source lines 83-84 verbatim:
// `<SERIES-ID>S000001065` / `<SERIES-NAME>GABELLI GLOBAL GROWTH FUND`), and the
// remainder after the leading `NPX` resolves against that declaration --
// measured through issPlainHeadingSeries on this filing's own index plus the
// registrant's 13 dictionary rows:
//
//	"NPX GABELLI GLOBAL GROWTH FD"     => ""            "GABELLI GLOBAL GROWTH FD"     => S000001065
//	"NPX GABELLI GLB OPPORTUNITY FD"   => ""            "GABELLI GLB OPPORTUNITY FD"   => S000001066
//	"NPX GABELLI GLB TELECOM FD"       => ""            "GABELLI GLB TELECOM FD"       => ""
//	"NPX GAB GLB CONVERTIBLE SEC FD"   => ""            "GAB GLB CONVERTIBLE SEC FD"   => ""
//
// i.e. the FD/FUND tolerance already handles the grammar; only the leading
// report-type token is missing. (TELECOM and GAB GLB CONVERTIBLE SEC stay
// unresolved even bare -- abbreviations the dictionary never carries, a
// sub-floor inside the family.)
//
// Rows reached: GLOBAL GROWTH (1,327) and GLB OPPORTUNITY (764) are 2,091 of
// this filing's 3,327 rows; the family is 3 filings and 9,487 pool rows.
//
// Fix in layout_splittable.go / the shared chain in layout_issnpx.go
// (issResolveFundUncached's leading-token rungs at :2277 and :2781): `NPX` on a
// ProxyEdge `Selected Accounts:` line is the report type, never a fund word,
// and the remainder must go back through the chain.
func TestFamilyNS12GamcoNPXAccountPrefixBlocksResolution(t *testing.T) {
	rows := familyNS12Dispatch(t, "gamco_npx_account_prefix_blocks_resolution.txt", "gamco_dict.tsv", "splittable", 6)
	for _, r := range rows {
		if r.SeriesID != "S000001065" {
			t.Errorf("the leading NPX report-type token blocked the declared Gabelli Global Growth Fund: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000001065", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
