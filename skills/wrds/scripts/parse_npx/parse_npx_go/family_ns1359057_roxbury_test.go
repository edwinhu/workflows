package main

import (
	"path/filepath"
	"testing"
)

// The Roxbury Funds, CIK 1359057, print every fund banner as a FRAGMENT of the
// name they declare in their own SGML header: the registrant/house prefix and
// the ` - Institutional Shares` share-class tail are dropped, and a vendor
// caption (`Vote Summary`, `Proxy Voting Summary`) is glued on in their place.
// Three filings carry 1,362 known-registrant no_series rows between them, and
// measured on HEAD with this registrant's own corpus dictionary the split is:
//
//	0000950123-09-028203 (20090630, proxyedge, 611 rows)
//	  line  209  `All-Cap Fund 01-Jul-2008 To 30-Jun-2009`        -> S000012811, 234 rows  OK
//	  line 12844  `Small-Cap Growth Fund 01-Jul-2008 To 30-Jun-2009` -> blank,      377 rows  AMBIGUOUS
//	0001104659-10-045737 (20100630, htmltable, 558 rows)
//	  line  231  `Vote Summary-Small-Cap Growth Fund`             -> blank,      531 rows  DEFECT (1)
//	  line 34635  `All Cap` / `Fund Vote Summary` (wrapped)        -> S000012811,  27 rows  OK
//	0001398344-14-003643 (20140630, htmltable, 939 rows)
//	  line  187  `Roxbury/Hood River Small-Cap Growth Proxy Voting Summary` -> blank, 454 rows  DEFECT (2)
//	  line 25245  `Roxbury/Mar Vista Strategic Growth Fund Proxy Voting Summary` -> S000034445, 485 rows  OK
//
// 377 + 531 + 454 = 1,362, so the three no_series pools are exactly these three
// banners and nothing else in the family is unattributed.
//
// THE 2009 `Small-Cap Growth Fund` BANNER IS NOT A DEFECT AND IS NOT ASSERTED
// HERE. That filing's own header declares FOUR series, two of which differ only
// in share class: S000012812 `Roxbury Small-Cap Growth Fund - Investor Shares`
// and S000012813 `Roxbury Small-Cap Growth Fund - Institutional Shares`. Strip
// the `Roxbury ` prefix and the class tail and BOTH collapse onto the printed
// fragment, so the banner names two series and can name neither. Its 377 rows
// are an unreachable ambiguous fragment -- a floor, not work. (Probed: even
// rewriting the banner to `Small-Cap Growth Fund - Institutional Shares` does
// not resolve it on HEAD, so nothing short of an audited overlay reaches those
// rows.) The 2009 `All-Cap Fund` banner is unambiguous and already resolves, so
// nothing is asserted there either.
//
// DEFECT (1), the 2010 fixture. The caption is a PREFIX: `Vote Summary-Small-Cap
// Growth Fund`, one `<p align="center">` at source line 231. Its sibling banner
// 34,400 lines later spells the caption as a SUFFIX -- `All Cap` / `Fund Vote
// Summary`, wrapped across source lines 34635-34636 -- and that one resolves.
// The difference is position alone: rewriting the first banner to `Small-Cap
// Growth Fund Vote Summary` and changing nothing else makes HEAD resolve all 531
// rows to S000012813, the single Small-Cap Growth series the 2010 header
// declares. The heading reader strips a trailing vendor caption and not a
// leading one.
//
// DEFECT (2), the 2014 fixture. The banner drops the type word: `Roxbury/Hood
// River Small-Cap Growth Proxy Voting Summary`, source line 187, where the
// declared name is `Roxbury/Hood River Small-Cap Growth Fund - Institutional
// Shares`. Its sibling at source line 25245 is the identical shape WITH the word
// -- `Roxbury/Mar Vista Strategic Growth Fund Proxy Voting Summary` -- and that
// one resolves to S000034445. Again position-free and word-exact: inserting
// ` Fund` before ` Proxy Voting Summary` and changing nothing else makes HEAD
// resolve all 454 rows to S000012813. A chain rung that ADDS a missing type word
// already exists on the dictionary side (`htmlDictTypeWordAdded`,
// layout_htmltable.go:6453); the banner here needs the same tolerance before the
// trailing caption is stripped.
//
// Both defects are unambiguous within the filing's own declared set: 2010
// declares exactly S000012811 and S000012813, 2014 exactly S000012813 and
// S000034445, and in each case the failing fragment matches one of the two.
//
// Fixture provenance. Both files are line-range cuts of the real EDGAR bytes,
// concatenated; NOTHING was retyped, paraphrased or added, closing tags
// included.
//
//	roxbury_1359057_votesummary_prefix_2010.txt =
//	  0001104659-10-045737.txt lines 1-757 (SGML header with the
//	  `<SERIES-AND-CLASSES-CONTRACTS-DATA>` block declaring S000012811 and
//	  S000012813, `<DOCUMENT>`/`<TEXT>`/`<html>`, the cover page, the
//	  `Vote Summary-Small-Cap Growth Fund` banner at line 231, and the whole
//	  MACROVISION SOLUTIONS CORPORATION 15-Jul-2009 ballot under it),
//	  34629-35266 (the page break, the wrapped `All Cap`/`Fund Vote Summary`
//	  banner at lines 34635-34636, and the whole TIDEWATER INC. 09-Jul-2009
//	  ballot under it), 36209-36215 (`</body>`, `</html>`, `</TEXT>`,
//	  `</DOCUMENT>`, `</SEC-DOCUMENT>`).
//	roxbury_1359057_proxy_voting_summary_2014.txt =
//	  0001398344-14-003643.txt lines 1-532 (header declaring S000012813 and
//	  S000034445, document open, the Hood River banner at line 187 and the whole
//	  GULFPORT ENERGY CORPORATION 01-Jul-2013 ballot under it), 25231-25524 (the
//	  `</table>` closing the first section, the page break, the second section's
//	  `<table>`, the Mar Vista banner at line 25245 and the whole NIKE, INC.
//	  19-Sep-2013 ballot under it), 38937-39053 (`</table>`, the signature block
//	  and the closing tags).
//
// Each cut reproduces the whole-filing behaviour on HEAD exactly: the 2010 cut
// parses ok/htmltable/22 rows, 9 blank + 13 S000012811; the 2014 cut parses
// ok/htmltable/10 rows, 4 blank + 6 S000034445. cik_dict.tsv is verbatim the 31
// corpus `cik_series.tsv` rows for CIK 1359057.
//
// Out of scope, recorded so it is not mistaken for cut damage: in the 2014
// filing the NIKE ballot's rows carry `issuer_name` = `GULFPORT ENERGY
// CORPORATION`, the previous section's issuer. That is reproduced by the cut
// because it is in the FULL filing too (every NKE row of the real 939 carries
// it), so this test pins the ballots by CUSIP, not by issuer name.
func TestFamilyNS1359057RoxburyFragmentBanners(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	const dir = "family_ns1359057"
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, "cik_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	cases := []struct {
		fixture string
		rows    int
		// cusip -> the series the ballot's banner names.
		want map[string]string
		// banner text, for the failure message, keyed by cusip.
		banner map[string]string
		line   map[string]string
	}{
		{
			fixture: "roxbury_1359057_votesummary_prefix_2010.txt",
			rows:    22,
			want: map[string]string{
				"55611C108": "S000012813", // MACROVISION, the prefixed caption
				"886423102": "S000012811", // TIDEWATER, the suffixed caption
			},
			banner: map[string]string{
				"55611C108": "Vote Summary-Small-Cap Growth Fund",
				"886423102": "All Cap Fund Vote Summary",
			},
			line: map[string]string{"55611C108": "231", "886423102": "34635-34636"},
		},
		{
			fixture: "roxbury_1359057_proxy_voting_summary_2014.txt",
			rows:    10,
			want: map[string]string{
				"402635304": "S000012813", // GULFPORT, the banner missing `Fund`
				"654106103": "S000034445", // NIKE, the banner carrying `Fund`
			},
			banner: map[string]string{
				"402635304": "Roxbury/Hood River Small-Cap Growth Proxy Voting Summary",
				"654106103": "Roxbury/Mar Vista Strategic Growth Fund Proxy Voting Summary",
			},
			line: map[string]string{"402635304": "187", "654106103": "25245"},
		},
	}

	for _, c := range cases {
		ch := make(chan *ParseResult, 4096)
		sink := &rowSink{out: ch}
		meta := processFile(c.fixture, filepath.Join("testdata", dir, c.fixture), sink, make([]byte, headBytes))
		close(ch)
		var rows []VoteRow
		for pr := range ch {
			rows = append(rows, pr.Rows...)
		}
		rows = append(rows, sink.buf...)

		if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || len(rows) != c.rows {
			t.Fatalf("%s fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/htmltable/%d error=%s",
				c.fixture, meta.ParseStatus, meta.Layout, len(rows), c.rows, meta.ErrorMsg)
		}

		seen := map[string]int{}
		for i, r := range rows {
			want, ok := c.want[r.CUSIP]
			if !ok {
				t.Fatalf("%s fixture guard: row %d carries CUSIP %q, which is neither ballot in the cut -- the cut is broken rather than the grammar",
					c.fixture, i, r.CUSIP)
			}
			seen[r.CUSIP]++
			if r.SeriesID != want {
				t.Errorf("%s row %d (cusip %s, item %q) did not take the series of the banner at source line %s: series=%q fund=%q want %s -- the banner is %q, a fragment of the filing's own declared series name with the registrant prefix and the ` - Institutional Shares` tail dropped and a vendor caption in their place",
					c.fixture, i, r.CUSIP, r.ItemSeq, c.line[r.CUSIP], r.SeriesID, r.FundName, want, c.banner[r.CUSIP])
			}
		}
		for cusip := range c.want {
			if seen[cusip] == 0 {
				t.Fatalf("%s fixture guard: no row for the %s ballot -- the cut is broken rather than the grammar", c.fixture, cusip)
			}
		}
	}
}
