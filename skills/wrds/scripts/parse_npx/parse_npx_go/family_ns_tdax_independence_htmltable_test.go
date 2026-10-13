package main

import (
	"path/filepath"
	"testing"
)

// familyNSTDAXIndependenceDispatch runs the real dispatch on the family fixture
// with NO dictionary and NO overlay loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
//
// The dictionary is deliberately absent: the filing's own <SERIES-AND-CLASSES-
// CONTRACTS-DATA> header declares all five series of CIK 1385533, so the header
// alone is the evidence and the assertion does not depend on a corpus file.
func familyNSTDAXIndependenceDispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_tdax_independence_htmltable", fixture), sink, make([]byte, headBytes))
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

// 000138/1385533/0000891092-09-003339.txt: THREE verbatim slices of the real
// filing, concatenated and nothing else. Byte-for-byte, the fixture is
//
//	source[0:35811]             -- lines 1-2156: the SEC header (including the
//	                               five <SERIES-ID>/<SERIES-NAME> declarations),
//	                               the cover pages, and the filing's FIRST vote
//	                               table, banner `TDAX Independence 2010 ETF
//	                               Composite` at source line 215
//	source[4693285:4720439]     -- lines 276346-277884: one whole later vote
//	                               table, banner `TDAX Independence 2020 ETF
//	                               Composite` at source line 276374
//	source[22810282:22810377]   -- the filing's own last eleven lines, </BODY>
//	                               through -----END PRIVACY-ENHANCED MESSAGE-----
//
// No byte is paraphrased, reflowed or invented; the only edit is the two splice
// points, which are at <TABLE>/</TABLE> boundaries so each slice is a complete
// page table. Dispatches to `htmltable` (the precondition asserts it).
//
// TDX Independence Funds, Inc., CIK 1385533, period 20090630, 8,242 vote rows in
// the real filing. Its header declares exactly five series:
//
//	S000016521 TDX Independence 2010 Exchange-Traded Fund
//	S000016522 TDX Independence 2020 Exchange-Traded Fund
//	S000016523 TDX Independence 2030 Exchange-Traded Fund
//	S000016524 TDX Independence 2040 Exchange-Traded Fund
//	S000016525 TDX Independence In-Target Exchange-Traded Fund
//
// and its vote body prints a clean banner for each one, repeated ~200 times
// across the 983 page tables, in this shape (source lines 211-217):
//
//	<TR valign="bottom">
//
//	    <TD align=left colspan=3>
//	<B><FONT size=2>TDAX Independence 2010 ETF Composite</FONT></B>
//	        </TD>
//
// followed by six `&nbsp;` cells. Measured on the real filing with the real
// dictionary, HEAD emits all 8,242 rows with a BLANK series_id AND a blank
// fund_name; the filer's duplicate report of the same period,
// 0000891092-10-000935, repeats it for 8,242 more.
//
// THE PLUMBING IS NOT THE DEFECT. The banner row is a one-filled-cell row, so
// layout_htmltable.go:355 (`if htmlFilledCells(cells) <= 2`) already reaches it
// and hands the cell text to htmlBareFundLine at :412. Proved by running the
// real parser over this exact fixture with the single letter `A` removed from
// each banner (`TDAX` -> `TDX`, nothing else changed):
//
//	4 rows S000016521 fund_name `TDX Independence 2010 ETF Composite`
//	4 rows S000016522 fund_name `TDX Independence 2020 ETF Composite`
//
// So colspan handling, the <B>/<FONT> strip, the one-filled-cell heading path
// and the context update all work on this shape, and the tolerant resolver
// already spans `ETF Composite` against the declared `Exchange-Traded Fund`.
//
// THE DEFECT is one letter in the brand token. Probed directly against the
// index built from the filing's own five declarations:
//
//	issResolveFund("TDX Independence 2010 ETF Composite")  -> S000016521
//	issResolveFund("TDAX Independence 2010 ETF Composite") -> nil
//	issResolveFund("TDAX Independence 2010 Exchange-Traded Fund") -> nil
//
// normalizeSeriesName lowercases and folds punctuation but does not touch the
// token itself, so the banner normalises to `tdax independence 2010 etf
// composite` against a declared `tdx independence 2010 exchange traded fund`,
// and the leading token differs. Every rung below issResolveFund is then closed
// too: htmlDictionaryFund answers on names the header does NOT declare and this
// registrant's dictionary rows spell `TDX` at 20080630 and `db-X` / `db
// X-trackers` / `Deutsche X-trackers` at every later vintage, so no dictionary
// key reads `TDAX` either; htmlFundColumnStem is never asked because no
// fund-labelled header cell opens a fund column in this vintage; and crossCIK
// cannot fire because `tdax independence 2010 etf composite` is not a name any
// registrant in the corpus declares. Nothing resolves, and an unresolved
// heading deliberately CLEARS the carried fund rather than leaving a stale one
// standing (layout_htmltable.go:248-251), which is why every row is blank
// rather than wrong. That behaviour is correct; the missing rung is what is
// being asserted here.
//
// WHY THIS IS NOT A FLOOR. `TDAX` is the registrant's OWN name -- the filing's
// header carries `FORMER CONFORMED NAME: TDAX Funds, Inc.` beside `COMPANY
// CONFORMED NAME: TDX Independence Funds, Inc.` (source lines 24 and 48), so
// the one-letter variant is declared in the same header block that declares the
// series. The banner is unambiguous besides: the year token (or `In-Target`)
// picks exactly one of the five declared sleeves, each banner is printed on its
// own page table with its own vote rows under it, and no two banners pool. This
// is a resolvable name under a brand alias, not a heading that names nothing.
//
// THE FIX belongs in the resolution chain, not in layout_htmltable.go: a banner
// whose only departure from a declared name is the registrant's own alternate
// brand spelling -- evidenced by the filing header's own FORMER CONFORMED NAME,
// not by edit distance in general -- must resolve, and only when exactly one
// declared series answers the remainder.
//
// CONFLICT RESOLVED WITH THE FIX. TestFamilyNSTDAXCrossCIKProseFragmentBanner
// in family_ns_tdax_crosscik_fragment_test.go used this same banner as its
// blank CONTRAST, on the stated ground that "nothing in the chain can reach
// S000016521 from it". That ground was half wrong even then -- the `ETF
// Composite` / `Exchange-Traded Fund` half already resolved, as the probe above
// shows, and only `TDAX` blocked it -- and the issRegistrantRenames entry for
// 0001385533 closes the other half, so both of that fixture's sections now
// resolve to S000016521 and its assertions were re-expressed accordingly. The
// fragment defect it really tests -- the `global` stamp reaching CIK 88525's
// S000008807 -- is independent of this and unchanged.
func TestFamilyNSTDAXIndependenceETFCompositeBanner(t *testing.T) {
	rows := familyNSTDAXIndependenceDispatch(t, "tdax_independence_etf_composite.txt", "htmltable", 8)
	// SECTION, not issuer, is what the banner governs, and each of the two
	// spliced page tables prints BOTH of its meetings under its own banner:
	// Greenlight Capital Re (two rows) then BT Group plc (two rows), four rows
	// per section, in document order. So the sections partition the row slice
	// and the issuer names repeat across them; the expectation is keyed by the
	// section's row range and the issuer only supplies the per-section count.
	sections := []struct {
		series, banner, declared string
		issuers                  map[string]int
	}{
		// The section the first page table opens, banner at source line 215.
		{"S000016521", "TDAX Independence 2010 ETF Composite", "TDX Independence 2010 Exchange-Traded Fund",
			map[string]int{"Greenlight Capital Re, Ltd.": 2, "BT Group plc": 2}},
		// A second sleeve, so the assertion is not one banner's accident:
		// banner at source line 276374.
		{"S000016522", "TDAX Independence 2020 ETF Composite", "TDX Independence 2020 Exchange-Traded Fund",
			map[string]int{"Greenlight Capital Re, Ltd.": 2, "BT Group plc": 2}},
	}
	at := 0
	for _, s := range sections {
		want := 0
		for _, n := range s.issuers {
			want += n
		}
		if at+want > len(rows) {
			t.Fatalf("fixture precondition: section %q wants rows [%d:%d] of %d", s.banner, at, at+want, len(rows))
		}
		seen := map[string]int{}
		for _, r := range rows[at : at+want] {
			if _, known := s.issuers[r.IssuerName]; !known {
				t.Errorf("fixture precondition: unexpected issuer %q in section %q", r.IssuerName, s.banner)
				continue
			}
			seen[r.IssuerName]++
			if r.SeriesID != s.series {
				t.Errorf("banner %q left the section unresolved: issuer=%q cusip=%q item=%q desc=%.40q fund=%q series=%q want series=%q (CIK 1385533 declares %q as %s in this filing's own header, and the banner differs from it only by the registrant's own brand spelling `TDAX` for `TDX` -- FORMER CONFORMED NAME `TDAX Funds, Inc.` at source line 48 -- plus `ETF Composite` for `Exchange-Traded Fund`, which the resolver already spans)", s.banner, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.FundName, r.SeriesID, s.series, s.series, s.declared)
			}
			if r.FundName != s.banner {
				t.Errorf("banner %q was not recorded as the section's fund name: issuer=%q item=%q fund=%q want %q (the name is recorded as PRINTED; only the lookup reads through the brand variant)", s.banner, r.IssuerName, r.ItemSeq, r.FundName, s.banner)
			}
		}
		for issuer, n := range s.issuers {
			if seen[issuer] != n {
				t.Errorf("fixture precondition: issuer %q contributed %d rows to section %q, want %d", issuer, seen[issuer], s.banner, n)
			}
		}
		at += want
	}
	if at != len(rows) {
		t.Errorf("fixture precondition: %d rows accounted for across the two sections, want all %d", at, len(rows))
	}
}
