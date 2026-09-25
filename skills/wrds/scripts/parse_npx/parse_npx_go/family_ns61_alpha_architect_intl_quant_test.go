package main

import (
	"path/filepath"
	"testing"
)

// 000159/1592900/0000894189-19-005405.txt: verbatim source lines 1-144 (the SGML
// header, whose SERIES-AND-CLASSES-CONTRACTS-DATA block declares all five series
// this filing carries, down through `<TABLE>`, the `<S>` column-template line, the
// first banner's no-voting stub and the `Alpha Architect International
// Quantitative Momentum ETF` banner), 1013-1032 (the whole CI:Z HOLDINGS section
// under that Momentum banner -- the registrant's other `Alpha Architect
// International Quantitative ...` sleeve, and the one that makes the residual
// pairing UNIQUE rather than a two-way tie; its own earlier issuer sections are
// trimmed, nothing inside it is), 5926-5978 (the `Alpha Architect US Quantitative
// Value ETF` banner and the whole ALLISON TRANSMISSION section under it, which
// resolves today and guards the cut), 7638-7692 (the `Alpha Architect
// International Quantitative ETF` banner and the whole ADVANTEST CORPORATION
// section under it, the shape under test) and 10510-10532 (the table's close, the
// signature block and the closing markup). Every byte is a line-range cut of the
// source -- nothing is added, reflowed or paraphrased; md5 of the five ranges read
// back over ssh from /wrds/sec/archives equals the fixture's.
//
// The Momentum section is load-bearing, not decoration. The residual pairing is
// read from what is left UNCLAIMED on both sides, so a cut that drops the
// Momentum banner leaves its declared S000046019 unclaimed too, and the short
// banner is then one word short of TWO unclaimed names -- a tie the parser
// refuses outright (there is no ordinal tiebreak; see brResidualDeclaredBanner).
// Carrying the banner restores the real filing's 5-banners-vs-5-declarations
// accounting, so the test exercises the genuine unique-residual path.
//
// ALPHA ARCHITECT ETF TRUST, CIK 1592900, period 20190630, dispatched
// `broadridge` (the precondition below re-asserts it on the cut).
//
// THE GRAMMAR. Broadridge prints one section per fund inside a single `<TABLE>`:
// a bare banner line naming the fund, then a dashed rule, then the issuer/agenda
// blocks. The banner is the only place the fund is named, so a banner that does
// not resolve leaves every row of its section with a blank `series_id`.
//
// THE DEFECT. This filing's header declares S000046017 as `Alpha Architect
// International Quantitative Value ETF` (ticker IVAL, source lines 65-72). Its
// body prints that fund's banner one word SHORT, with `Value` dropped:
//
//	Alpha Architect International Quantitative ETF
//
// The banner resolves to nothing, and the section's rows carry no series id.
//
// WHOSE BALLOTS THEY ARE, proved from the document and not guessed. The filing
// declares FIVE series and prints FIVE banners, each exactly once. Four of the
// five banners resolve -- `Alpha Architect Value Momentum Trend ETF` (no voting
// securities), `Alpha Architect International Quantitative Momentum ETF`
// S000046019, `Alpha Architect US Quantitative Momentum ETF` S000046018 and
// `Alpha Architect US Quantitative Value ETF` S000046016, the last two matched
// across the filing's own dotted `U.S.` spelling. That leaves exactly ONE banner
// and exactly ONE declared series unclaimed, and they are the pair above: no
// other series is left for this section to belong to, and the banner is the
// declared name with a single interior word missing. EDGAR's own series index
// agrees that S000046017 is this trust's only `Alpha Architect International
// Quantitative ...Value...` series and that the trust declares no series named
// `Alpha Architect International Quantitative ETF` at all.
//
// The same accounting holds in each of the registrant's other three N-PX filings
// (0000894189-20-006191, -22-006469, -23-006743): banner count equals declared
// count, and `Alpha Architect International Quantitative ETF` is the one banner
// no declared name answers while S000046017 is the one declared name no banner
// claims.
//
// SCOPE. Whole filings, current binary, `cikDict` and `seriesMap` unset: 622 /
// 680 / 1,009 / 919 rows with a blank `series_id` across the four filings -- 3,230
// rows, which is this CIK's ENTIRE no-series residue -- and in every one of the
// four filings every single blank row sits under this one banner. No other banner
// of this registrant leaves a blank row.
//
// Fix location: the banner arm that calls `issResolveFund` from
// `layout_broadridge.go` -- the chain resolves this registrant's dotted-initialism
// banners already and refuses this one.
func TestFamilyNS61AlphaArchitectIntlQuant(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const fixture = "alpha_architect_intl_quant_2019.txt"
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture,
		filepath.Join("testdata", "family_ns61_alpha_architect_intl_quant", fixture),
		sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "broadridge" || len(rows) != 25 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/broadridge/25 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	const (
		wantSeries = "S000046017"
		wantFund   = "Alpha Architect International Quantitative ETF"
	)
	guard, momentum, under := 0, 0, 0
	for _, r := range rows {
		switch r.IssuerName {
		case "CI:Z HOLDINGS CO.,LTD.":
			// The `Alpha Architect International Quantitative Momentum ETF`
			// section. It is what claims S000046019, which is what leaves
			// S000046017 as the filing's ONE unclaimed declared series. If this
			// stops resolving, the residual pairing below becomes a two-way tie
			// and the parser is right to refuse it.
			momentum++
			if r.SeriesID != "S000046019" {
				t.Fatalf("fixture guard: the `Alpha Architect International Quantitative Momentum ETF` section stopped resolving, so the residual pairing is no longer unique: issuer=%q series=%q fund=%q",
					r.IssuerName, r.SeriesID, r.FundName)
			}
		case "ALLISON TRANSMISSION HOLDINGS, INC.":
			// The `Alpha Architect US Quantitative Value ETF` section, which
			// resolves today. It guards the cut: the banner at source line 5926
			// is what gives these rows S000046016, so if they go blank the
			// fixture is broken, not the grammar.
			guard++
			if r.SeriesID != "S000046016" {
				t.Fatalf("fixture guard: the `Alpha Architect US Quantitative Value ETF` section stopped resolving: issuer=%q series=%q fund=%q",
					r.IssuerName, r.SeriesID, r.FundName)
			}
		case "ADVANTEST CORPORATION":
			under++
			if r.SeriesID != wantSeries {
				t.Errorf("the banner the body prints one word short of the declared name (source line 7638 `Alpha Architect International Quantitative ETF` for the header's `Alpha Architect International Quantitative Value ETF`, S000046017, the filing's one unclaimed declared series) resolves to nothing: issuer=%q cusip=%q date=%q desc=%q how_voted=%q series=%q fund=%q want %s",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.HowVoted,
					r.SeriesID, r.FundName, wantSeries)
			}
			if r.FundName != wantFund {
				t.Errorf("fixture guard: the banner's printed spelling is not being carried: fund=%q want %q", r.FundName, wantFund)
			}
		default:
			t.Fatalf("fixture guard: unexpected issuer %q", r.IssuerName)
		}
	}
	if guard != 14 || momentum != 1 || under != 10 {
		t.Fatalf("fixture guard: read %d rows of the resolving section, %d under the Momentum banner and %d under the short banner, want 14, 1 and 10",
			guard, momentum, under)
	}
}
