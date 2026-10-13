package main

import (
	"path/filepath"
	"testing"
)

// State Farm Mutual Fund Trust (CIK 0001119720), the largest unfloored family
// in the current no-series ranking: 11,299 known-registrant no_series rows
// across 7 filings. Most of that mass is genuine floor -- a
// `State Farm Large Cap Growth Fund` heading that appears nowhere in the corpus
// dictionary under any CIK, and a bare `State Farm Mutual Fund Trust`
// registrant-name-only banner that pools several funds with no fund identity
// printed at all. This test pins the one part of the family that is NOT floor.
//
// Filing 000111/1119720/0001193125-18-259938.txt (period 20180630) prints, at
// line 2865 of the real filing, a combined registrant+fund banner:
//
//	====== State Farm Mutual Fund Trust Sm/Mid Cap Equity==================
//
// 794 rows of that filing sit under this heading with series_id blank.
//
// The expansion is unambiguous. The filing's own <SEC-HEADER> declares exactly
// 15 series for this CIK at this vintage (all 15 are in the fixture's verbatim
// header excerpt), and exactly one of them can be spelled `Sm/Mid Cap Equity`:
//
//	<SERIES-ID>S000002040
//	<SERIES-NAME>State Farm Small Mid Cap Equity Fund
//
// No other declared series name carries `Small`/`Sm`, `Mid`, `Cap` and `Equity`
// in that combination -- the rest of the pool is Equity, LifePath
// Retirement/2020/2030/2040/2050, International Equity, S & P 500 Index, Small
// Cap Index, International Index, Equity and Bond, Bond, Tax Advantaged Bond
// and Money Market. `State Farm Small Cap Index Fund` is the nearest neighbour
// and it has no `Mid` and no `Equity`. So `Sm/Mid Cap Equity` resolves against
// the registrant's own declared pool, with no cross-CIK reach.
//
// The registrant-name-prefix pattern itself is already handled: the SAME filing
// correctly resolves other combined banners of the form
// `State Farm Mutual Fund Trust <suffix>`, e.g.
// `State Farm Mutual Fund Trust - International Index` and
// `State Farm Mutual Fund Trust - Small Cap Index` (with a ` - ` separator) and
// `State Farm Mutual Fund Trust State Farm S&P 500 Index Fund` (full fund name,
// no separator). What fails is only the ABBREVIATED suffix form: the vendor
// contracts `Small Mid` to `Sm/Mid` and drops the trailing `Fund`, so no
// name-based rung reaches it.
//
// Same shape as the already-fixed family_ns_svs2_abbrev row (`SVS II SCUD BLUE
// CHIP PORT`): a vendor abbreviation of a same-CIK dictionary series, audited
// against the filing's own declared pool.
//
// Fixture:
//
//	statefarm_2018_smmid.txt -- 000111/1119720/0001193125-18-259938.txt lines
//	1-741 (the SGML header through the SERIES-AND-CLASSES-CONTRACTS-DATA block
//	declaring all 15 series, plus <DOCUMENT>/<TEXT> and the FORM N-PX preamble
//	and report header, stopping immediately before the filing's first fund
//	banner), lines 2865-2890 (the `Sm/Mid Cap Equity` banner plus its whole
//	first ballot, ACCO BRANDS CORPORATION, twelve voted items, through the
//	separator that closes it), and lines 108177-108180 (the document's trailing
//	tags). Byte-identical excerpts, no edits.
//
// Dictionary: all 17 cik_series.tsv rows this CIK carries, copied verbatim.
//
// The parser currently reads the banner verbatim into the fund-name column and
// leaves series_id blank.
func TestFamilyNSStateFarmSmMidAbbrev(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_statefarm_smmid_abbrev", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		fixture  = "statefarm_2018_smmid.txt"
		period   = "20180630"
		heading  = "State Farm Mutual Fund Trust Sm/Mid Cap Equity"
		want     = "S000002040" // State Farm Small Mid Cap Equity Fund, declared by this filing
		declared = "State Farm Small Mid Cap Equity Fund"
	)

	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_statefarm_smmid_abbrev", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.CIK != "0001119720" || meta.PeriodOfReport != period {
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
			t.Errorf("heading %q (fund_name=%q): series=%q, want %q -- this filing's own <SEC-HEADER> declares %q as series %s, the only one of its 15 declared series that %q can abbreviate",
				heading, r.FundName, r.SeriesID, want, declared, want, "Sm/Mid Cap Equity")
			break
		}
	}
}
