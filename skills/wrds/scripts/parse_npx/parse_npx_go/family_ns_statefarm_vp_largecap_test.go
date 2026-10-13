package main

import (
	"path/filepath"
	"testing"
)

// State Farm Variable Product Trust (CIK 0001034633), the sibling registrant of
// the State Farm Mutual Fund Trust family pinned by
// family_ns_statefarm_smmid_abbrev_test.go. Filing
// 000103/1034633/0001193125-12-377044.txt (period 20120630) emits 36,232 rows
// and leaves exactly 2,165 of them with a blank series_id, split across two
// banners:
//
//	1,257 rows  `State Farm Large Cap Variable Product`   <- this test
//	  908 rows  `State Farm Variable Product Trust`       <- floor, see below
//
// The remaining 34,067 rows resolve, because their banners carry the
// registrant-prefix + fund-name shape the parser already reads:
// `State Farm Variable Product Trust Small Cap Equity Index` -> S000002061,
// `... International Equity Index Fund` -> S000002062,
// `... Large Cap Equity Index` -> S000002060.
//
// # The banner
//
// At line 189 of the real filing:
//
//	==================== State Farm Large Cap Variable Product =====================
//
// This is not the registrant-prefix shape. The vendor interleaved the fund's
// distinguishing words into the trust's own name: strip the registrant tokens
// (`State`, `Farm`, `Variable`, `Product`, `Trust`) and what is left is
// `Large Cap`, which prefixes TWO of the filing's nine declared series --
// S000002060 `State Farm Large Cap Equity Index Fund` and S000002067
// `State Farm Large Cap Equity Fund`. No name-based rung can choose between
// them, so no name-based rung reaches this banner. It needs an audited alias,
// the same rung issRegistrantRenames / issAuditedRenameAliases already carries
// for the sibling CIK 0001119720 (`state farm mutual fund trust sm mid cap
// equity`).
//
// # Why S000002067 and not S000002060
//
// Four independent byte-level facts in the corpus, three of them inside this
// filing:
//
//  1. The filing is four concatenated vendor reports. This banner sits inside
//     the FIRST one, whose own header at line 176 names the sub-adviser and
//     that sub-adviser's fund scope:
//
//     ******************************* FORM N-Px REPORT *******************************
//     Bridgeway:     Large Cap Equity Fund      Small Mid Cap Equity Fund
//
//     Bridgeway's scope is two funds, and neither is an index fund.
//
//  2. The index funds are separately accounted for in the SAME filing. The
//     fourth report (line 40825) is headed `Blackrock` with scope
//     `International Equity Index / Large Cap Equity Index / Small Cap Equity
//     Index`, and its three banners already resolve to S000002062, S000002060
//     and S000002061. S000002060 is therefore spoken for; the Bridgeway
//     `Large Cap` block cannot be it.
//
//  3. Of the nine series this filing's own <SEC-HEADER> declares, exactly one
//     is named `State Farm Large Cap Equity Fund`:
//
//     <SERIES-ID>S000002067
//     <SERIES-NAME>State Farm Large Cap Equity Fund
//
//  4. The banner recurs in exactly four filings of this CIK
//     (`grep -l` over /wrds/sec/archives/000103/1034633/): 2010-200538,
//     2012-377044, 2015-306651 and 2019-014519. In every one it is the FIRST
//     of the Bridgeway report's two banners, and in the two filings where the
//     second banner is not degenerate the vendor prints that second fund by
//     name -- `State Farm Variable Product Trust Small/Mid Cap Equity Fund`
//     (2010, line 3751) and `State Farm Small Mid Cap Equity Fund` (2019,
//     line 2320). So Bridgeway's pair is {Large Cap Equity, Small Mid Cap
//     Equity} across a decade, the Small Mid Cap half is printed explicitly,
//     and the `Large Cap Variable Product` half is the other one.
//
// # What this test does NOT claim
//
// The filing's second blank banner, the bare registrant name at line 2704
// (908 rows), is FLOOR. Its 2,241-line block prints no fund identity of any
// kind -- `grep` over lines 2704-4944 for `Fund`, `Account`, `State Farm` or
// `<PAGE>` returns only the banner line itself. Reaching it would require
// pairing it positionally against a DIFFERENT filing's banner, which is a
// guess, and the same bare-registrant shape at sibling CIK 0001119720 is
// already recorded as floor in family_ns_statefarm_smmid_abbrev_test.go.
//
// The filing's third odd shape, the votesummary title `Rainer         Small Mid
// Cap Equity Fund` at line 24376, is out of scope here for a different reason:
// that block and the Marsico <TABLE> block above it emit ZERO rows today. The
// whole file dispatches to the issnpx layout, so those two vendor formats are
// unread rather than mis-attributed -- a different defect from a blank
// series_id, and not fixable by any name rung.
//
// # Fixture
//
//	statefarm_2012_largecap.txt -- 000103/1034633/0001193125-12-377044.txt
//	lines 1-225 (the SGML header including the SERIES-AND-CLASSES-CONTRACTS-DATA
//	block declaring all nine series, <DOCUMENT>/<TEXT>, the FORM N-PX preamble,
//	the Bridgeway report header, the `State Farm Large Cap Variable Product`
//	banner and its whole first ballot -- ABBOTT LABORATORIES, twenty voted
//	items -- through the separator that closes it) followed by lines
//	125843-125846 (the document's trailing tags). Byte-identical excerpts, no
//	edits: md5 of the first 225 fixture lines equals md5 of lines 1-225 of the
//	real filing, whose own md5 was checked against the copy on WRDS.
//
// Dictionary: all 15 cik_series.tsv rows this CIK carries, copied verbatim.
//
// The parser currently reads the banner verbatim into the fund-name column and
// leaves series_id blank.
func TestFamilyNSStateFarmVPLargeCap(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_statefarm_vp_largecap", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		fixture  = "statefarm_2012_largecap.txt"
		period   = "20120630"
		heading  = "State Farm Large Cap Variable Product"
		want     = "S000002067" // State Farm Large Cap Equity Fund, declared by this filing
		declared = "State Farm Large Cap Equity Fund"
	)

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_statefarm_vp_largecap", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.CIK != "0001034633" || meta.PeriodOfReport != period {
		t.Fatalf("fixture/dispatch precondition: CIK=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta.CIK, meta.PeriodOfReport, meta.Layout, meta.ParseStatus, len(sink.buf), meta.ErrorMsg)
	}
	var under []VoteRow
	for _, r := range sink.buf {
		if r.FundName == heading {
			under = append(under, r)
		}
	}
	if len(under) == 0 {
		t.Fatalf("fixture precondition: no rows under %q (fixture emitted %d rows in total)", heading, len(sink.buf))
	}
	for _, r := range under {
		if r.SeriesID != want {
			t.Errorf("heading %q (fund_name=%q): series=%q, want %q -- this filing's own <SEC-HEADER> declares %q as series %s, and its Bridgeway report header (line 176 of the real filing) scopes that report to %q and %q, neither of them an index fund",
				heading, r.FundName, r.SeriesID, want, declared, want, "Large Cap Equity Fund", "Small Mid Cap Equity Fund")
			break
		}
	}
}
