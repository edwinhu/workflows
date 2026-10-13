package main

import (
	"path/filepath"
	"testing"
)

// ns315774Dispatch runs the real dispatch on the family NS315774 fixture with
// this registrant's own 76 dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the garbled `Fund Name :` value and the caption above it,
// never a broken fixture. Same mechanism as ns1064641Dispatch in
// family_ns1064641_sdpr_transposition_test.go, pointed at its own testdata dir.
func ns315774Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns315774_subadviser_caption_garbled_fundname", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns315774_subadviser_caption_garbled_fundname", fixture), sink, make([]byte, headBytes))
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

// CIK 0000315774 (Forum Funds) files
// 000031/315774/0001193125-09-181820.txt (period 20090630, 275,363 source lines,
// 16,590,063 bytes) as an HTML document whose body interleaves per-sub-adviser
// vote tables with SIX `<PRE>` blocks, each one a different sub-adviser's vendor
// grammar pasted in as preformatted text. Measured on HEAD with this
// registrant's dictionary loaded, the whole filing yields 2,536 rows at layout
// issnpx, and exactly 746 of them -- ALL of them, and only them -- come out with
// a blank series_id. Every one of those 746 carries the same fund_name,
// `Absolute Forum Funds_Sub Advised`, and every one sits inside the single
// `<PRE>` block at source lines 75584-77829. The other three row-bearing blocks
// resolve: 657 rows under `ADAMS HARKNESS SMALL CAP GROWTH FUND` (S000004564),
// 651 under `GOLDEN LARGE CAP CORE FUND` (S000004561) and 482 under `GOLDEN
// SMALL CAP CORE FUND` (S000004560), all three named by a
// `===== <FUND> =====` rule banner their own vendor prints. The remaining two
// `<PRE>` blocks (source lines 40882-41327 and 2637-2663) yield no rows at all
// on HEAD, which is a separate unread-vote-table concern and not what this
// fixture is about.
//
// The defect is what the failing block prints for its own identity. Verbatim,
// source lines 75589-75597:
//
//	&lt;PRE&gt;
//
//	ABSOLUTE STRATEGIES - TWIN CAPITAL MANAGEMENT
//
//	Item 1: Proxy Voting Record - Item1 Proxy Voting Record -
//
//	Registrant :
//
//	Fund Name : Absolute Forum Funds_Sub Advised
//
// `Registrant :` is EMPTY, and the vendor's `Fund Name :` value is garbled: it
// names no fund this registrant ever declared. `Absolute Forum Funds_Sub
// Advised` is the word `Absolute` welded onto the REGISTRANT's own conformed
// name (`FORUM FUNDS`, SGML header source line 25) and an underscored
// `_Sub Advised` tag -- a vendor template that dropped the fund and interpolated
// the trust. It is the only `Fund Name :` line and the only `Registrant :` line
// in the entire 275,363-line filing (`grep -c` over the real bytes: one each, at
// source lines 75597 and 75595), so nothing later in the block restates the
// fund and no carry-forward from a sibling block can reach it.
//
// The real fund IS printed, on the caption line immediately above the item
// heading -- source line 75591, `ABSOLUTE STRATEGIES - TWIN CAPITAL
// MANAGEMENT` -- in the same `<FUND> - <SUB-ADVISER>` shape this filing's HTML
// sections use for their own captions throughout (`ABSOLUTE STRATEGIES -
// BERNZOTT CAPITAL` at 40884, `ABSOLUTE STRATEGIES - SSI INVESTMENT MANAGEMENT`
// at 73480, `ABSOLUTE STRATEGIES FUND - KINETICS ASSET MANAGEMENT` at 51692
// spelling `FUND` out, `ABSOLUTE STRATEGIES&#151;ARONSON+JOHNSON+ORTIZ LP` at
// 2667 with an em dash). `TWIN CAPITAL MANAGEMENT` is the sub-adviser, which is
// what the `_Sub Advised` tag in the garbled value is about.
//
// The fund half of that caption names exactly ONE declared series, and this
// filing's OWN SGML header is enough to say so -- the corpus dictionary is not
// even needed, since loadCIKSeries backs a filing only when its header declares
// nothing. The header's SERIES-AND-CLASSES-CONTRACTS-DATA block (source lines
// 62-391, carried into the fixture verbatim and in full) declares 25 series, of
// which two begin with the word `Absolute`:
//
//	S000004559  Absolute Strategies Fund     (source lines 196-197)
//	S000023115  Absolute Opportunities Fund  (source lines 383-384)
//
// `ABSOLUTE STRATEGIES` answers to the first and cannot answer to the second, so
// the caption pools nothing: this is one fund, S000004559. The registrant's own
// dictionary agrees and adds nothing -- dict.tsv below is this CIK's real 76
// rows, fetched verbatim from
// /scratch/nyu/eddyhu/npx-reconcile-corpus/cik_series.tsv, and in it
// S000004559 carries exactly one name at exactly one vintage,
// `Absolute Strategies Fund` at 20060630, still the latest spelling as of this
// filing's 20090630 period (no later rename row exists for that id). The seven
// `Absolute*` dictionary names across all vintages are Absolute Strategies Fund
// (S000004559), Absolute Opportunities Fund / Absolute Credit Opportunities Fund
// (S000023115), Merk Absolute Return Currency Fund (S000026460), Absolute
// Capital Opportunities Fund (S000050284), Absolute Convertible Arbitrage Fund
// (S000056818) and Absolute Flexible Fund (S000076481) -- none of them a second
// answer to `ABSOLUTE STRATEGIES`.
//
// So this is a genuine fixable shape, not a floor: the fund is printed in the
// filing, the printed name resolves to a single declared sleeve of the
// registrant's own header, and the 746 rows under it are one fund's rows.
//
// The fixture is two verbatim, unedited slices of the real filing cut at its own
// structural boundaries -- source lines 1-398 (the whole privacy-enhanced
// preamble, the SEC-HEADER including all 25 SERIES declarations, and the
// document preamble through `<TEXT>`) and source lines 75584-75673 (the failing
// block's own `<p Style='page-break-before:always'>` page break, its `<PRE>`,
// the caption, the item heading, the empty `Registrant :`, the garbled
// `Fund Name :` and the block's first TWO meetings, ACCENTURE LIMITED and Adobe
// Systems Inc), followed by the block's own real closing lines 77827-77828
// (`&lt;/PRE&gt;</PRE>` and ` </DIV>`) and a synthesised
// `</TEXT>`/`</DOCUMENT>`/`</SEC-DOCUMENT>` to close the excerpt, since the real
// ones sit at source lines 275360-275362 past the cut. Nothing inside a slice is
// edited and no line is moved between them. The trim to two meetings is at a
// meeting boundary: source line 75674 begins the third meeting (`Advance Auto`).
//
// Two fixture-level disclosures, both measured:
//
// 1. The filing-level layout label differs. The real full filing is dispatched
// as issnpx; the excerpt, with the three `=====`-bannered blocks removed, is
// dispatched as icr. That is a whole-file vote, not a per-section difference: run
// on the full 746-row block in isolation (source lines 1-398 + 75584-77829), the
// excerpt emits 746 rows byte-identical to the full filing's 746 blank-series
// rows in every field except file_path and the layout label. The same grammar
// reads the block either way, so the assertion below is measuring the real
// defect; only the label on the manifest row changes.
//
// 2. This test asserts the FIXED behaviour and therefore FAILS on HEAD, by
// design. On HEAD all 13 rows come out with series_id="" and
// fund_name="Absolute Forum Funds_Sub Advised".
func TestFamilyNS315774SubadviserCaptionGarbledFundName(t *testing.T) {
	const fixture = "absolute_strategies_twin_capital_2009.txt"

	// The fixture's two meetings, and how many item rows each contributes:
	// ACCENTURE LIMITED items 1-6 and Adobe Systems Inc items 1-7.
	wantPerIssuer := map[string]int{
		"ACCENTURE LIMITED": 6,
		"Adobe Systems Inc": 7,
	}

	rows := ns315774Dispatch(t, fixture, "dict.tsv", "icr", 13)

	// One error per distinct (fund_name, series_id) pair, not per row: the
	// failure is uniform across the block, so 13 identical lines would bury it.
	const wantSeries = "S000004559"
	seenIssuer := map[string]int{}
	blank := 0
	wrong := map[string]int{}
	var sample VoteRow
	for _, r := range rows {
		seenIssuer[r.IssuerName]++
		switch {
		case r.SeriesID == wantSeries:
		case r.SeriesID == "":
			if blank == 0 {
				sample = r
			}
			blank++
		default:
			wrong[r.SeriesID]++
		}
	}
	for issuer, want := range wantPerIssuer {
		if seenIssuer[issuer] != want {
			t.Errorf("issuer %q carried %d rows, want %d -- the fixture's own coverage changed and the series assertion below is measuring the wrong thing", issuer, seenIssuer[issuer], want)
		}
	}
	if blank > 0 {
		t.Errorf("%d of %d rows carry a blank series_id, want all %d = %s (Absolute Strategies Fund, declared in this filing's own SGML header): the block's garbled `Fund Name : %s` names no declared sleeve, and the caption line above the item heading -- `ABSOLUTE STRATEGIES - TWIN CAPITAL MANAGEMENT`, source line 75591 -- is not read as the section's fund (first blank row: issuer=%q cusip=%q meeting=%q item=%q desc=%q)",
			blank, len(rows), len(rows), wantSeries, sample.FundName, sample.IssuerName, sample.CUSIP, sample.MeetingDate, sample.ItemSeq, sample.VoteDescription)
	}
	for id, n := range wrong {
		t.Errorf("%d of %d rows resolve to series %q, want %s -- `ABSOLUTE STRATEGIES` names exactly one of this registrant's 25 declared sleeves and the sibling `Absolute Opportunities Fund` (S000023115) is not it", n, len(rows), id, wantSeries)
	}
}
