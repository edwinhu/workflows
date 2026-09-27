package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 000091/919160/0001398344-17-011006.txt: verbatim source lines 1-807 (the SGML
// header with all eight `<SERIES>` declarations, `<TEXT>`, `<html>`, `<body>`,
// the cover page, the THREE-LINE bold `<div>` banner block that opens the
// filing's first vote-table section at source lines 294/296/298 -- `Guinness
// Atkinson Alternative Energy` / `Meeting Date Range: 01-Jul-2016 To
// 30-Jun-2017` / `Selected Accounts` -- and that section's first TWO ballots:
// `CHINA LONGYUAN POWER GROUP CORPORATION LTD` 10-Aug-2016 (its issuer banner
// row, its `Security:` / `Ticker:` / `Meeting Date:` identity block, its `Item |
// Proposal | Recommendation | Default Vote | For | Against | Abstain | Take No
// Action` band and items 1-3) and `JOHNSON CONTROLS, INC.` 17-Aug-2016 (the same
// block and band, items 1-3)). The cut stops at the `</tr>` immediately before
// the TRINA SOLAR LIMITED issuer banner row; one added `</table>` closes the
// cut's own table and the last seven lines close markup the cut opened. Every
// other byte is a line range of the source, `cmp`-verified against
// `/wrds/sec/archives/000091/919160/0001398344-17-011006.txt`.
//
// GUINNESS ATKINSON FUNDS, CIK 919160, period 20170630, N-PX, dispatched
// `proxyedge` (the precondition below re-asserts it on the cut). Despite this
// test's file name, the layout is proxyedge, not htmltable: the div-banner
// reader that fails here lives in `parseProxyEdge`.
//
// THE SHAPE. This filing prints seven sections, each opened by the same
// three-line bold-`<div>` block. Six of them print the fund's FULL declared name
// on the block's first line -- `Guinness Atkinson Asia Focus Fund` (source line
// 18408), `Guinness Atkinson Asia Pacific Dividend Builder Fund` (38583),
// `Guinness Atkinson China &amp; Hong Kong Fund` (59666), `Guinness Atkinson
// Dividend Builder Fund` (84456), `Guinness Atkinson Global Energy Fund`
// (90105) -- and those sections resolve. The FIRST section, at source line 294,
// prints the declared name `Guinness Atkinson Alternative Energy Fund`
// (S000009156, declared at header line 103) with its trailing type word `Fund`
// DROPPED: the cell reads `Guinness Atkinson Alternative Energy` and nothing
// else. It is the only banner in the filing that drops it.
//
// THE DEFECT. The bare-heading arm of `parseProxyEdge` (layout_proxyedge.go,
// the `whole[i] && !summary[i] && !wrapped[i] && !peItemCell(...) &&
// !peBandCell(...) && peFundName(line)` branch) opens a new fund section only
// when `peFundName` finds FUND, PORTFOLIO, TRUST, ETF or SERIES standing as a
// WORD inside the cell. That test is pure vocabulary: it has no access to the
// filing's own `<SERIES-NAME>` declarations, so a banner carrying none of those
// five words is not a banner to it at all -- however exactly it names a series
// the filing declares. Dropping the trailing `Fund` removes the only such word
// this name ever had, so the arm never fires, `fund` is never set, and the
// section stays closed for its whole length. Every row of it falls back to the
// filing-level registrant name `GUINNESS ATKINSON FUNDS` with a blank series --
// 337 rows on the real filing, the five rows of this cut.
//
// The guard composition below is the point: on this line EVERY other condition
// of the arm already holds. `whole[i]` is true (the banner is one `<div>`, one
// line, its own cell), `summary[i]` and `wrapped[i]` are both false, and no band
// is open yet so neither `peItemCell` nor `peBandCell` can refuse it. The arm is
// blocked by `peFundName` alone.
//
// WHAT AN ADMISSIBLE FIX LOOKS LIKE, AND WHY IT NEED NOT GUESS. The filing's own
// header settles the name with no inference: `issDropTypeWord` -- the closed
// trailing-type-word vocabulary (`fund`, `portfolio`, `trust`, `account`,
// `series`) already shared across this package -- reduces the declared
// `Guinness Atkinson Alternative Energy Fund` to exactly the normalised key the
// banner prints, and to that of no other series this filing declares. The
// assertions below hold the rung to that: an EXACT match against the filing's
// own declarations after one type word is dropped, never a spell-match and never
// the corpus dictionary. The same block's other two bold lines -- the meeting
// date range and `Selected Accounts` -- match no declared stem at all, so a rung
// keyed on that match cannot fire on either of them; that is asserted too, since
// a rung that opened a section on `Selected Accounts` would clear the fund it
// had just resolved.
//
// WHY THIS IS NOT ANY PRIOR NS-919160 HYPOTHESIS. V4 (prose fund word) and V6
// (two-line prose cell) both aim at the arm firing where it must NOT; this is
// the arm not firing where it must, on a line neither of those tests reads. V4
// asserts, verbatim, that these same Alternative Energy rows must still carry
// `GUINNESS ATKINSON FUNDS` because they are upstream of every heading in that
// cut, and names their blank series a separate cause. This is that cause.
func TestFamilyNS919160V7TrailingTypeWordDropBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })

	const dir = "family_ns919160_v7_htmltable_trailing_type_drop"
	var err error
	// The real corpus rows for this CIK, verbatim from
	// /scratch/nyu/eddyhu/npx-reconcile-corpus/cik_series.tsv. The filing's own
	// SGML header already declares every series, so the dictionary is not what
	// makes the banner resolvable -- it is here so the defect cannot be read as
	// a missing-dictionary miss.
	cikDict, err = loadCIKSeries(filepath.Join("testdata", dir, "guinness_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil

	const fixture = "guinness_alternative_energy_typedrop_2017.txt"
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

	if meta.ParseStatus != "ok" || meta.Layout != "proxyedge" || len(rows) != 5 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want ok/proxyedge/5 error=%s",
			meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	const (
		banner     = "Guinness Atkinson Alternative Energy"
		declared   = "Guinness Atkinson Alternative Energy Fund"
		series     = "S000009156"
		registrant = "GUINNESS ATKINSON FUNDS"
		dateLine   = "Meeting Date Range: 01-Jul-2016 To 30-Jun-2017"
		acctLine   = "Selected Accounts"
	)

	// Both ballots the cut carries stand under the one banner at source line 294
	// and under no other: the cut opens with it and no other fund-named cell
	// appears before the TRINA SOLAR row the cut stops at. Every row is
	// therefore an Alternative Energy row.
	longyuan, jci := 0, 0
	for i, r := range rows {
		switch r.IssuerName {
		case "CHINA LONGYUAN POWER GROUP CORPORATION LTD":
			longyuan++
		case "JOHNSON CONTROLS, INC.":
			jci++
		default:
			t.Fatalf("fixture guard: row %d is neither ballot the cut carries: issuer=%q item=%q fund=%q",
				i, r.IssuerName, r.ItemSeq, r.FundName)
		}
	}
	if longyuan != 2 || jci != 3 {
		t.Fatalf("fixture guard: cut emits %d CHINA LONGYUAN rows and %d JOHNSON CONTROLS rows, want 2 and 3",
			longyuan, jci)
	}

	// THE ASSERTION. Every row of the section must carry the series the banner
	// names. The registrant name is the tell: `GUINNESS ATKINSON FUNDS` is the
	// filing-level fallback, printed on the cover page, and a row carrying it
	// says the section was never opened at all.
	for i, r := range rows {
		if r.SeriesID != series {
			t.Errorf("row %d (issuer=%q item=%q desc=%q): series_id=%q want %q -- the banner at source line 294 names the declared series %q (header line 103), with its trailing type word dropped",
				i, r.IssuerName, r.ItemSeq, truncate(r.VoteDescription, 50), r.SeriesID, series, declared)
		}
		if r.FundName == registrant {
			t.Errorf("row %d (issuer=%q item=%q): fund_name=%q is the filing-level registrant name from the cover page, not the fund the vendor printed above this ballot -- the bare-heading arm never fired on %q, so the section it opens stayed closed",
				i, r.IssuerName, r.ItemSeq, r.FundName, banner)
		}
	}

	// The arm's own guard composition, read on the banner line: every condition
	// but `peFundName` already holds, so `peFundName` is the whole cause. A
	// failure here says the diagnosis moved, not that the fix regressed.
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines, run, tbl := peCellLines(string(stripHTMLCells(raw)))
	whole := peWholeCells(run)
	summary := peSummaryBody(lines, run, tbl)
	wrapped := peWrappedProse(lines, tbl, whole)

	// The banner stands before the first vote table, so no band is open when the
	// scan reaches it: `labels` is nil and `band` is -1, exactly as
	// `parseProxyEdge` holds them there.
	find := func(want string) int {
		for i := range lines {
			if strings.TrimSpace(lines[i]) == want {
				return i
			}
		}
		return -1
	}
	bannerLine := find(banner)
	if bannerLine < 0 {
		t.Fatalf("fixture guard: cut lost its banner line %q", banner)
	}

	if !whole[bannerLine] || summary[bannerLine] || wrapped[bannerLine] ||
		peItemCell(lines, tbl, bannerLine-1, bannerLine, nil) ||
		peBandCell(tbl, -1, bannerLine, nil) {
		t.Errorf("the banner at cut line %d (%q, source line 294) is refused by a guard OTHER than peFundName: whole=%v summary=%v wrapped=%v itemCell=%v bandCell=%v\n\tthis test's diagnosis is that peFundName is the sole blocker; if that is no longer true the cause has moved",
			bannerLine, lines[bannerLine], whole[bannerLine], summary[bannerLine], wrapped[bannerLine],
			peItemCell(lines, tbl, bannerLine-1, bannerLine, nil), peBandCell(tbl, -1, bannerLine, nil))
	}

	if peFundName(banner) {
		t.Errorf("peFundName(%q) is true -- this test's premise is that it is FALSE, because the trailing type word `Fund` is dropped and the name carries no other FUND/PORTFOLIO/TRUST/ETF/SERIES word; the cause has moved",
			banner)
	}

	// The exact declared-name match an admissible fix rests on, asserted against
	// the FILING'S OWN header declarations and nothing else. Exactly one
	// declared series must reduce to the banner's key after one trailing type
	// word is dropped -- no spell-match, no dictionary, no ambiguity.
	bannerKey := normalizeSeriesName(banner)
	var hit []SeriesDecl
	for _, d := range meta.SeriesDecls {
		if stem, typed := issDropTypeWord(normalizeSeriesName(d.Name)); typed && stem == bannerKey {
			hit = append(hit, d)
		}
	}
	if len(hit) != 1 || hit[0].SeriesID != series {
		got := make([]string, 0, len(hit))
		for _, d := range hit {
			got = append(got, d.SeriesID+" "+d.Name)
		}
		t.Errorf("the banner %q matches %d of the filing's own %d <SERIES-NAME> declarations after issDropTypeWord (%v), want exactly one and that one %s %q -- without a unique exact match a fix here would be guessing, which this test refuses to license",
			banner, len(hit), len(meta.SeriesDecls), got, series, declared)
	}

	// The refusal that keeps such a rung narrow: the other two bold lines of the
	// SAME three-line block match no declared stem, so a rung keyed on the match
	// above cannot open a section on either one and clear the fund it just
	// resolved.
	for _, other := range []string{dateLine, acctLine} {
		key := normalizeSeriesName(other)
		for _, d := range meta.SeriesDecls {
			if stem, typed := issDropTypeWord(normalizeSeriesName(d.Name)); typed && stem == key {
				t.Errorf("the banner block's line %q matches declared series %s %q after issDropTypeWord -- a rung keyed on that match would open a section on it",
					other, d.SeriesID, d.Name)
			}
		}
		if find(other) < 0 {
			t.Errorf("fixture guard: cut lost the banner block's line %q, so the refusal above is asserted over nothing", other)
		}
	}
}
