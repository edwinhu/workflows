package main

import (
	"path/filepath"
	"testing"
)

// 000091/919160/0001398344-16-017363.txt: verbatim source lines 1-155 (the SGML
// header, including all eight `<SERIES>` declarations, down through `<TEXT>`,
// `<html>` and `<body>`), 29800-29816 (the `Guinness Atkinson Asia Pacific
// Dividend Builder Fund` section banner at source line 29806 and the `<table>`
// that opens its grid at source line 29816) and 37334-37662 (the `CAPITALAND
// MALL TRUST, SINGAPORE` 12-Apr-2016 AGM ballot -- its banner row at source
// line 37334, its identity block, its header band and its items 1-5). Every
// byte of the first 501 lines is a line-range cut of the source; the five
// closing lines `</table>`, `</body>`, `</html>`, `</TEXT>` and `</DOCUMENT>`
// are the only added ones, and they close markup the cut opened.
//
// GUINNESS ATKINSON FUNDS, CIK 919160, period 20160630, N-PX, dispatched
// `proxyedge` (the precondition below re-asserts it on the cut). On the whole
// real filing, HEAD, `-cik-series` and `-series-map` as production `residue.sh`
// passes them: 1,984 rows, 268 with `series_id` blank -- a single contiguous run
// from output row 884 (this ballot's item 4) to output row 1,151, every one of
// them carrying `"TRUST DEED") FOR THE TIME BEING IN FORCE (UNLESS OTHERWISE
// EXEMPTED OR WAIVED BY THE MONETARY AUTHORITY OF SINGAPORE);` as its
// `fund_name`.
//
// WHAT CARRIES IT. This vendor template wraps a long proposal's text by
// emitting each physical line of it as its OWN `<tr>`, one populated `<td>` per
// row, under the ballot row the text belongs to. CapitaLand's item 3 (source
// line 37513) is followed by two such continuation rows, source lines 37538 and
// 37553:
//
//	ISSUED), PROVIDED THAT: (1) THE AGGREGATE NUMBER OF UNITS TO BE ISSUED
//	PURSUANT TO THIS RESOLUTION ...
//	"TRUST DEED") FOR THE TIME BEING IN FORCE (UNLESS OTHERWISE EXEMPTED OR
//	WAIVED BY THE MONETARY AUTHORITY OF SINGAPORE);
//
// Each fragment is its own table row, so `peCellLines` / `peWholeCells`
// (`layout_proxyedge.go:143-189`) correctly report it a cell ENTIRE -- unlike
// the 2012 shape behind commit a5a47454, no cell accounting is being lost here.
// Both fragments carry a fund word: `peFundWord` accepts `TRUST` in `THE TRUST
// DEED` and `TRUST DEED`, by its own contract. The bare-heading arm at
// `layout_proxyedge.go:664-671` therefore fires on them, sets `fund = line`, and
// neither `icrResolveFundShared` nor `htmlDictionaryFund` can resolve a proposal
// fragment, so `fundSeries` goes empty and STAYS empty for every row after it.
//
// `peWrappedProse` (`layout_proxyedge.go:223-242`) is the guard that exists for
// exactly this, and it cannot reach these lines: `peWrapContinues`
// (`layout_proxyedge.go:254-265`) requires the next line to open on a LOWER-CASE
// letter (`if c := next[0]; c < 'a' || c > 'z' { return false }`,
// `layout_proxyedge.go:261-263`). The 2012 filing's wrapped proposal was
// mixed-case prose, so its continuations opened lower-case; this filing's
// foreign-market proposals are printed ALL-CAPS, and the wrap lands on `ISSUED`
// and on a double quote. Every such run therefore measures length 1, never
// reaches `peWrapRun`, and no continuation is marked.
//
// The fragments are reached by the heading scan at all only because `peVoteRow`
// refuses them: with the band `Item | Proposal | Recommendation | Default Vote |
// For | Against | Abstain | Take No Action` (8 columns, source lines
// 37372-37395) a run that opens on a sentence has no count in a disposition
// position, so `peCount` fails and the loop advances one line.
//
// The same ALL-CAPS wrap shape is what blanks the rest of this CIK's open
// residue: 0001398344-12-003055.txt (451 rows, `THE SGX-ST (THE "LISTING
// MANUAL") ...`), 0001398344-13-004040.txt (293 rows, `Company's series A and
// series B shares, and (ii)` and `OAO Gazprom of funds in the maximum amount` --
// capitalised rather than ALL-CAPS, same gate) and 0001398344-14-004527.txt (16
// rows). It is NOT what blanks 0001398344-17-011006.txt: there the section
// banner is printed `Guinness Atkinson Alternative Energy`, with the trailing
// `Fund` the header's own declaration carries dropped, so `peFundName`
// (`layout_proxyedge.go:426-434`) never admits it and the cover page's
// `GUINNESS ATKINSON FUNDS` stays the open fund for all 337 rows -- a separate
// defect of the same arm, measured but deliberately not asserted here.
//
// Fix location: `peWrappedProse` / `peWrapContinues`,
// `layout_proxyedge.go:223-265`, and/or the bare-heading arm they guard,
// `layout_proxyedge.go:664-671`.
func TestFamilyNS919160V2AllCapsWrappedProposalClearsFund(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	const dir = "family_ns919160_v2_allcaps_wrap"
	var err error
	// The real corpus rows for S000009157, verbatim from
	// /scratch/nyu/eddyhu/npx-reconcile-corpus/cik_series.tsv. The filing's own
	// SGML header already declares the series, so the dictionary is not what
	// makes these rows resolvable -- it is here so the defect cannot be read as
	// a missing-dictionary miss.
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, "guinness_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "guinness_capitaland_allcaps_wrapped_2016.txt"
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", dir, fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)

	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || len(rows) != 5 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/proxyedge/5 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	const (
		wantSeries = "S000009157"
		wantFund   = "Guinness Atkinson Asia Pacific Dividend Builder Fund"
	)

	// Items 1-3 stand upstream of the wrapped continuation rows and must still
	// carry the banner's fund, or the cut is broken rather than the grammar.
	for i, r := range rows[:3] {
		if r.IssuerName != "CAPITALAND MALL TRUST, SINGAPORE" || r.SeriesID != wantSeries || r.FundName != wantFund {
			t.Fatalf("fixture guard: a row upstream of item 3's wrapped text stopped resolving at row %d: issuer=%q item=%q series=%q fund=%q",
				i, r.IssuerName, r.ItemSeq, r.SeriesID, r.FundName)
		}
	}

	for i, r := range rows[3:] {
		if r.SeriesID != wantSeries || r.FundName != wantFund {
			t.Errorf("row %d (item %q), downstream of item 3's ALL-CAPS wrapped continuation rows (source lines 37538 and 37553), lost the open fund: desc=%q how_voted=%q series=%q fund=%q want %s / %q -- each continuation is its own `<tr>`, carries the word TRUST, and `peWrapContinues` will not admit it as a continuation because it opens upper-case, so the bare-heading arm reads it as a fund banner and clears the fund the banner at source line 29806 opened",
				i+3, r.ItemSeq, r.VoteDescription, r.HowVoted, r.SeriesID, r.FundName, wantSeries, wantFund)
		}
	}
}
