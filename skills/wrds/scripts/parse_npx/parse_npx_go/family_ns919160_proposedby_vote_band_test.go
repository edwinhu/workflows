package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// GUINNESS ATKINSON FUNDS, CIK 919160, 000091/919160/0001398344-17-011006.txt,
// period 20170630, N-PX, dispatched `proxyedge`. 337 no_series rows in
// LOST_BASE, every one of them with a blank series and `GUINNESS ATKINSON
// FUNDS` -- the bare registrant name off the cover page -- for a fund name.
// Those 337 are the whole of what this 7.5 MB filing emits, and they are all
// upstream of the ballots this test is about.
//
// THE DEFECT: A BAND THAT NAMES THE VOTE INSTEAD OF COUNTING IT IS NOT READ AT
// ALL, AND THE STALE BAND IT LEAVES OPEN REFUSES EVERY ROW UNDER IT.
//
// From the Asia Pacific Dividend Builder section onward this filing's ballot
// header band is
//
//	Item | Proposal | Proposed by | Vote | For/Against Management
//
// -- a shape with NO disposition column at all. There are no share counts on
// these foreign ballots; the `Vote` column carries the vote itself, verbatim
// (`For`, `Against`), which is precisely what how_voted is contracted to hold.
//
// `peHeaderAt` (layout_proxyedge.go:371) cannot read it, for two reasons that
// compound. `PROPOSED BY` is in no entry of `peVocabulary`
// (layout_proxyedge.go:29-58 -- only `TYPE` and `PROPONENT` carry the `peBy`
// role), so the band walk breaks at that third cell and `h.labels` ends as
// `[Item Proposal]`; and even had it walked the whole band, the gate at
// layout_proxyedge.go:406 demands `dispositions >= 2` and this shape has zero.
// Either way `peHeaderAt` returns nil.
//
// Because it returns nil, the arm at layout_proxyedge.go:736-740 never fires,
// so `labels` is NOT updated: it keeps the eight-column band
// `Item | Proposal | Recommendation | Default Vote | For | Against | Abstain |
// Take No Action` that the Alternative Energy section installed hundreds of
// lines earlier. `peVoteRow` (layout_proxyedge.go:906) is then called at
// layout_proxyedge.go:805 with that stale eight-label slice against
// five-cell rows: it consumes eight consecutive cells positionally, the four
// labels carrying the `peDisposition` role land on `Management`, `For`, `For`
// and the NEXT row's item number, `peCount` refuses the first of them, and the
// row is rejected at layout_proxyedge.go:934-936. Every CMT row is refused
// this way.
//
// A refused row is not emitted at all -- there is no blank-series placeholder
// arm; the refusal simply falls through to the issuer scan
// (layout_proxyedge.go:833) and then the bare-heading scan
// (layout_proxyedge.go:856), which emit nothing. So the filing's 337 surviving
// rows are only the Alternative Energy section's, the one section whose
// ballots print share counts, and every ballot from the Asia Pacific section
// onward is DROPPED. The blank series on those 337 is a separate cause; what
// this test asserts is that the CMT ballots exist at all, and carry the fund
// whose banner opens their section.
//
// A SECOND CAUSE STANDS BETWEEN THE FIXED BAND AND THE RIGHT SERIES, and is
// asserted here deliberately rather than split off. From the same section
// onward the vendor also drops the colons from its identity labels -- the
// block prints `Security` / `Ticker Symbol` / `Meeting Date` where the
// Alternative Energy section printed `Security:` / `Ticker:` / `Meeting
// Date:`. `peIdentityLabel` (layout_proxyedge.go:697) requires the trailing
// colon, so the issuer scan at layout_proxyedge.go:833-839 cannot fire on
// `CAPITALAND MALL TRUST, SINGAPORE`; the cell falls through to the
// bare-heading scan instead, where `peFundName` finds `TRUST` standing as a
// word and takes the ISSUER's name for a FUND banner. `fund` is overwritten
// with it and `fundSeries` cleared, three lines after the real banner
// `Guinness Atkinson Asia Pacific Dividend Builder Fund` resolved
// S000009157. Measured on this fixture on HEAD: cut line 180 (the real banner)
// and cut line 184 (the issuer) both satisfy the bare-heading arm's whole
// condition.
//
// THE FIXTURE is the one the v4 prose-fundword family already uses, unchanged:
// testdata/family_ns919160v4_proxyedge_prose_fundword/. It already carries the
// Asia Pacific banner at source line 38583, the CAPITALAND identity block
// without colons, the `Proposed by | Vote` band at source lines 45048+ and
// items 1 through 4 with their `For`/`For`/`Against`/`For` votes. The series
// id comes from the filing's own SGML `<SERIES>` declarations, which the cut
// keeps verbatim (S000009157 at source line 112-113), so the dictionary is not
// what makes this resolvable.
func TestFamilyNS919160ProposedByVoteBand(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	const dir = "family_ns919160v4_proxyedge_prose_fundword"
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, "guinness_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "guinness_capitaland_trustdeed_prose_2017.txt"
	path := filepath.Join("testdata", dir, fixture)

	ch := make(chan *ParseResult, 8192)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, path, sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/proxyedge error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	// The four CMT resolutions, keyed by the verbatim opening of each one's
	// `Proposal` cell, with the literal value of its own `Vote` column.
	const (
		series = "S000009157"
		fund   = "Guinness Atkinson Asia Pacific Dividend Builder Fund"
	)
	want := []struct {
		item, descPrefix, howVoted string
	}{
		{"1", "TO RECEIVE AND ADOPT THE REPORT OF HSBC INSTITUTIONAL TRUST SERVICES (SINGAPORE) LIMITED", "For"},
		{"2", "TO RE-APPOINT KPMG LLP AS AUDITORS OF CMT", "For"},
		{"3", "THAT AUTHORITY BE AND IS HEREBY GIVEN TO THE MANAGER TO:", "Against"},
		{"4", "THAT: (A) THE EXERCISE OF ALL THE POWERS OF THE MANAGER TO REPURCHASE ISSUED UNITS", "For"},
	}

	for _, w := range want {
		var got *VoteRow
		for i := range rows {
			if strings.HasPrefix(rows[i].VoteDescription, w.descPrefix) {
				got = &rows[i]
				break
			}
		}
		if got == nil {
			t.Errorf("CAPITALAND MALL TRUST item %s emits no row at all: its band `Item | Proposal | Proposed by | Vote | For/Against Management` carries no disposition column, so peHeaderAt (layout_proxyedge.go:371, gate at :406) returns nil, `labels` keeps the Alternative Energy section's eight-column band (layout_proxyedge.go:736-740), and peVoteRow refuses the row against it at layout_proxyedge.go:934-936\n\twanted a row whose vote_description opens %q with how_voted=%q, series_id=%q",
				w.item, w.descPrefix, w.howVoted, series)
			continue
		}
		if got.HowVoted != w.howVoted {
			t.Errorf("CAPITALAND MALL TRUST item %s: how_voted=%q want %q -- the `Vote` column carries the vote itself on this band, verbatim",
				w.item, got.HowVoted, w.howVoted)
		}
		if got.SeriesID != series {
			t.Errorf("CAPITALAND MALL TRUST item %s: series_id=%q fund_name=%q want %q / %q -- the section's own banner at source line 38583 resolves S000009157, and the issuer name `CAPITALAND MALL TRUST, SINGAPORE` is not a fund the vendor printed (its identity block drops the colons peIdentityLabel requires at layout_proxyedge.go:697, so the issuer scan at :833 cannot claim it and the bare-heading scan at :856 takes its `TRUST` for a fund word)",
				w.item, got.SeriesID, got.FundName, series, fund)
		}
	}
}
