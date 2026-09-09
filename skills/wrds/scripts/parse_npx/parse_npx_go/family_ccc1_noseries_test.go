package main

import (
	"path/filepath"
	"testing"
)

// familyCCC1Dispatch runs the real dispatch on a family CCC no-series fixture,
// loading the registrant's own cik_series.tsv rows as the dictionary when one
// is named.
func familyCCC1Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	if dict != "" {
		oldDict, oldMap := cikDict, seriesMap
		t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ccc1", dict))
		if err != nil {
			t.Fatal(err)
		}
		seriesMap = nil
	}
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ccc1", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000158/1587982/0001398344-21-018043.txt: 4-5, 7-8, 15-16, 37-73, 76,
// 6236-7472, 7480-7640. Investment Managers Series Trust II's 2021 N-PX declares
// two series and prints each fund's report as a `Fund Name:` label row over an
// `Institutional Account Name` vote table:
//
//	<TD ...>Fund Name:</FONT></TD>
//	<TD ...>Vivaldi Multi-Strategy Fund</FONT></TD>
//
// Each fund's report then continues into an ISS `Vote Summary` block whose rows
// carry no fund column at all -- the fund is stated once, above, by that label
// row:
//
//	<P STYLE="text-align: center; ..."><B><I>Vote Summary</I></B></FONT></P>
//	...
//	    <TD COLSPAN="20" STYLE="background-color: #004F75; ..."><B>LEGG MASON</B></FONT></TD>
//
// The blue COLSPAN=20 banner is the ISSUER, not the fund. The section's fund
// context does not survive into the block: its rows come out with a blank
// fund_name, a blank series_id, and the page banner `Vote Summary` standing in
// the issuer column.
//
// 392 of the filing's 1,046 rows are such Vote Summary rows -- every row the
// filing prints outside the two `Institutional Account Name` tables.
//
// Fix in parseHTMLTableRaw (layout_htmltable.go:99), at the heading read near
// layout_htmltable.go:214: `Vote Summary` is a page banner naming no fund, so it
// must leave the standing fund alone rather than clear it (the nameless-banner
// case the comment at layout_htmltable.go:208 already licenses for Valued
// Advisers Trust), and the COLSPAN=20 issuer banner beneath it is not a fund
// heading either.
//
// The fixture keeps the whole second `Institutional Account Name` table: the
// header mapping is only accepted over that table in full, so a shorter cut of
// it is not parsed at all and the Vote Summary rows lose their contrast.
func TestFamilyCCC1VivaldiVoteSummaryLosesFundContext(t *testing.T) {
	rows := familyCCC1Dispatch(t, "vivaldi_vote_summary_fund_context.txt", "", "htmltable", 111)
	for _, r := range rows {
		if r.SeriesID != "S000055376" {
			t.Errorf("Vote Summary block loses the `Fund Name:` context: fund=%q issuer=%q item=%q series=%q want S000055376", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}

// 000144/1444822/0001085146-14-001809.txt: 4-5, 7-8, 15-16, 41-59, 90-102,
// 324-328, 331, 25063-25073. AQR Funds' 2014 N-PX declares 21 series and prints
// an equals-rule heading over every section. Two of its sections name funds the
// header does not declare and the dictionary carries only under their `Style`
// spelling:
//
//	========================== AQR Emerging Momentum Fund ==========================
//
//	ASTRO MALAYSIA HOLDINGS BHD.
//
//	Ticker:       ASTRO          Security ID:  Y04323104
//
// cik_series.tsv holds `AQR Emerging Momentum Style Fund` for S000045145 -- the
// same fund, with the type word `Style` inserted, exactly as the dictionary
// holds `AQR Large Cap Momentum Style Fund` beside `AQR Momentum Fund` for
// S000025643.
//
// The resolver does not reach S000045145. It drops the distinctive token
// `Emerging` and matches the header's SHORTER declared name instead, so the
// section's 632 rows are filed under S000025643 -- the AQR Momentum Fund, a
// different fund. `AQR Emerging Core Equity Fund` fails the same way, 373 rows
// filed under S000040063 (`AQR Core Equity Fund` / `AQR Large Cap Multi-Style
// Fund`) instead of S000045144 (`AQR Emerging Multi-Style Fund`).
//
// Fix in issResolveFund (layout_issnpx.go): a heading token the candidate name
// does not carry must refuse the match, so `Emerging` cannot be dropped on the
// way to a shorter name; the type-word tolerance that maps `Momentum Fund` to
// `Momentum Style Fund` then finds S000045145.
func TestFamilyCCC1AQREmergingMomentumDropsDistinctiveToken(t *testing.T) {
	rows := familyCCC1Dispatch(t, "aqr_emerging_momentum_heading.txt", "aqr_dict.tsv", "issnpx", 1)
	for _, r := range rows {
		if r.SeriesID != "S000045145" {
			t.Errorf("`Emerging` dropped on the way to a shorter declared name: fund=%q issuer=%q item=%q series=%q want S000045145", r.FundName, r.IssuerName, r.ItemSeq, r.SeriesID)
		}
	}
}
