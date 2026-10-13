package main

import (
	"path/filepath"
	"testing"
)

// familyFFF2Dispatch runs the real dispatch on a family FFF no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary. Both
// filings in this family declare NO series in the SGML header, so the
// dictionary is the only source of series names and every attribution runs
// through the backfill.
func familyFFF2Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_fff2", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_fff2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000035/351601/0000950149-04-001415.txt: 14-18, 23-26, 119-127, 54761-54782.
// Frank Russell Investment Company's 2004 N-PX declares no series in its SGML
// header, so every name the resolver sees is backfilled from cik_series.tsv for
// CIK 0000351601. The filing prints one `=`-ruled banner per fund, each of them
// the declared name behind the registrant's ACRONYM:
//
//	=========================== FRIC INTERNATIONAL FUND ============================
//	...
//	============================== FRIC EQUITY I FUND ==============================
//
// and under each, ISS proposal blocks:
//
//	3I GROUP PLC (FORMERLY INVESTORS IN INDUSTRY)
//
//	Ticker:                      Security ID:  G4708P104
//	Meeting Date: JUL 9, 2003    Meeting Type: Annual
//	1     Accept Financial Statements and Statutory For       For        Management
//
// The acronym is never cut, because EDGAR stores the registrant's name INVERTED
// -- `COMPANY CONFORMED NAME: RUSSELL FRANK INVESTMENT CO`, whose initials are
// `RFIC`, while the banner and the filing's own title line (`Frank Russell
// Investment Company`) spell `FRIC`. `FRIC` therefore never enters ix.brands,
// so the banner reaches issDistinctiveTokenDecl instead of an exact lookup, and
// that rule needs TWO tokens each owned by exactly one declared series.
// Fifteen of the filing's banners clear that bar by accident; eight do not, and
// a full-file dispatch emits 59,660 rows of which 28,643 carry no series --
// INTERNATIONAL (9,658), EQUITY II (5,107), EQUITY I (4,458), QUANTITATIVE
// EQUITY (3,452), EQUITY Q (3,226), TAX-MANAGED MID & SMALL CAP (2,553),
// EQUITY III (150), LIFEPOINTS AGGRESSIVE STRATEGY (21), LIFEPOINTS EQUITY
// AGGRESSIVE STRATEGY (18). Every one of those names resolves the moment the
// `FRIC ` prefix comes off: bare `INTERNATIONAL FUND` is the declared
// S000001588 exactly.
//
// Fix in newISSSeriesIndex (layout_issnpx.go), where ix.brands is built from
// issInitials(toks) of the registrant key: the initialism has to be computed
// over the registrant's PRINTED word order as well as EDGAR's inverted one, so
// `FRIC` is a brand for `RUSSELL FRANK INVESTMENT CO` the way `AIM` already is
// for `AIM INVESTMENT FUNDS`. Registering it resolves six of the eight residue
// banners (28,454 of the 28,643 rows); EQUITY III and the two LIFEPOINTS
// AGGRESSIVE banners are dictionary floors.
func TestFamilyFFF2FRICAcronymPrefixNeverCut(t *testing.T) {
	rows := familyFFF2Dispatch(t, "fric_international_heading.txt", "fric_dict.tsv", "issnpx", 9)
	for _, r := range rows {
		if r.SeriesID != "S000001588" {
			t.Errorf("`FRIC INTERNATIONAL FUND` banner not resolved: fund=%q issuer=%q item=%q series=%q want S000001588", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000101/1010296/0000950152-04-006430.txt: 14-19, 22-25, 127-133, 147-166.
// HSBC Advisor Funds Trust's 2004 N-PX also declares no series, and its three
// dictionary names are bare: `Core Plus Fixed Income Fund` (S000009283),
// `International Equity Fund` (S000009284), `Opportunity Fund` (S000009285).
// The filing prints each section under the retail BRAND, which is the
// registrant's first token plus a marketing word the registrant name never
// carries:
//
//	======================= HSBC INVESTOR FIXED INCOME FUND ========================
//	...
//	=================== HSBC INVESTOR INTERNATIONAL EQUITY FUND ====================
//
// A lone `HSBC` is a registrant token and cuts -- `HSBC INTERNATIONAL EQUITY
// FUND` resolves to S000009284 -- but `HSBC INVESTOR` is not a brand the
// registrant key can supply, and after `HSBC` comes off, `INVESTOR
// INTERNATIONAL EQUITY FUND` is not a declared name, so nothing is stamped. A
// full-file dispatch emits 1,304 rows and ALL 1,304 carry no series: 1,120
// under the International Equity banner and 184 under `HSBC INVESTOR SMALL CAP
// EQUITY FUND`, which is a dictionary floor (no small-cap series is declared
// for this CIK in any year).
//
// Fix in issResolveFundUncached (layout_issnpx.go), in the ix.brands cut loop:
// after the registrant's own leading token comes off the banner, one further
// unknown leading token may be dropped before the exact byName lookup -- the
// banner-side counterpart of the lessLeadToken rule that already allows exactly
// one leading token off the DECLARED name.
func TestFamilyFFF2HSBCInvestorBrandPrefixNeverCut(t *testing.T) {
	rows := familyFFF2Dispatch(t, "hsbc_investor_heading.txt", "hsbc_dict.tsv", "issnpx", 8)
	for _, r := range rows {
		if r.SeriesID != "S000009284" {
			t.Errorf("`HSBC INVESTOR INTERNATIONAL EQUITY FUND` banner not resolved: fund=%q issuer=%q item=%q series=%q want S000009284", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
