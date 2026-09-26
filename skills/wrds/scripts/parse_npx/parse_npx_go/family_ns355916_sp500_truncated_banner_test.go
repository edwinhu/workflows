package main

import (
	"path/filepath"
	"testing"
)

// 000035/355916/0000900092-07-000345.txt: verbatim source lines 1-288 (the
// whole SEC header, all 16 SERIES declarations, through `<TEXT>`), 356-400 (the
// BALANCED CAPITAL page banner and the 3M CO block under it, which resolves
// today and guards the cut) and 42845-42906 (the LARGE CAP CORE banner and the
// ABERCROMBIE / AETNA / AGILENT blocks under it, which do not). Every byte is a
// line-range cut of the source; the two closing tags `</TEXT>` and
// `</DOCUMENT>` are the only added lines, and they close markup the cut opened.
// md5 of the fixture 4a16cf8cff0415fe799d3c534bec41de, cut on the WRDS login
// node from the real archive bytes.
//
// BLACKROCK VARIABLE SERIES FUNDS, INC., CIK 355916, period 20070630. Every
// page banner in this filing is a bordered `=====` band printed across TWO
// lines, e.g. source lines 28646-28647:
//
// |========= BlackRock VARIABLE SERIES FUNDS, INC.: BlackRock HIGH INCOME ========
// |=========                          V.I. FUND                          =========
//
// THE BRIEF THIS TEST WAS WRITTEN FROM NAMED THE WRONG BANNER, AND THE WRONG
// SERIES. The filing does carry a one-line S&P 500 banner at source line 28672,
// `========= BlackRock VARIABLE SERIES FUNDS, INC.: BlackRock S&P 500 V.I.`,
// truncated mid-name with no closing border and no continuation line at all --
// but measured on the whole filing through parse_npx_go_358 with `-cik-series`
// and `-series-map`, those 5,113 rows DO resolve, to S000002875, and they do so
// with the overlay withheld as well. They are not the residue. The 1,128
// blank-series rows are one contiguous block, output rows 17184-18311, running
// ABERCROMBIE & FITCH CO. through ZIMMER HOLDINGS INC, and they sit under a
// DIFFERENT truncation, source lines 42845-42846:
//
// |========= BlackRock VARIABLE SERIES FUNDS, INC.: BlackRock LARGE CAP CORE V.I.
// |=========                             FUND                             =========
//
// The first line of the band is truncated at exactly 78 columns, one column
// short of its own closing border, so nothing marks it as a band that opens.
// The SECOND line is a complete, bordered band in its own right, and the parser
// reads it as a fresh page banner whose entire content is the stray word `FUND`.
// All 1,128 rows that follow carry `fund_name` literally `FUND` and a blank
// `series_id`. That single block is this CIK's entire current known-registrant
// no_series residue -- the run over the isolated filing produced 22,250 rows,
// 1,128 of them blank, and `FUND` was the only fund_name among them.
//
// The right answer needs no dictionary: the filing's OWN header declares it, at
// source lines 95-96, `<SERIES-ID>S000002876` / `<SERIES-NAME>BlackRock Large
// Cap Core V.I. Fund`. Joining the truncated first line to its continuation
// yields `BlackRock VARIABLE SERIES FUNDS, INC.: BlackRock LARGE CAP CORE V.I.
// FUND`, which is the same registrant-prefixed shape the eleven bands that DO
// resolve in this filing produce, and which answers to S000002876. Accordingly
// this test loads no dictionary and no overlay -- `cikDict` and `seriesMap` are
// nil -- so the filing's own declaration is the whole of the evidence.
//
// Fix location: whatever decides that a `=====` band line opens a two-line
// banner. It must not require the closing border on the first line, because
// this filer's own line wrapping drops it; and a bordered line that follows
// such a truncated opener is that opener's continuation, not a banner of its
// own.
func TestFamilyNS355916TruncatedBannerContinuationReadAsOwnBanner(t *testing.T) {
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil

	const fixture = "blackrock_large_cap_core_truncated_banner.txt"
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns355916", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != "issnpx" || len(rows) != 40 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=40 error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}

	const wantFund = "BlackRock VARIABLE SERIES FUNDS, INC.: BlackRock LARGE CAP CORE V.I. FUND"
	guard, affected := 0, 0
	for _, r := range rows {
		switch r.IssuerName {
		case "3M CO":
			// The intact two-line band at source lines 371-372. It guards the
			// fixture: if this ever goes blank the cut is broken, not the grammar.
			guard++
			if r.SeriesID != "S000002874" {
				t.Fatalf("fixture guard: the intact BALANCED CAPITAL band stopped resolving: series=%q fund=%q", r.SeriesID, r.FundName)
			}
		case "ABERCROMBIE & FITCH CO.", "AETNA INC.", "AGILENT TECHNOLOGIES INC.":
			affected++
			if r.SeriesID != "S000002876" || r.FundName != wantFund {
				t.Errorf("a truncated banner's continuation line was read as a banner of its own: fund=%q series=%q issuer=%q cusip=%q date=%q item=%q desc=%q want fund %q, the join of source lines 42845-42846, and series S000002876, which this filing declares at source lines 95-96",
					r.FundName, r.SeriesID, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, r.VoteDescription, wantFund)
			}
		default:
			t.Fatalf("fixture guard: unexpected issuer %q", r.IssuerName)
		}
	}
	if guard != 16 {
		t.Fatalf("fixture guard: read %d rows of the 3M CO block, want 16", guard)
	}
	if affected != 24 {
		t.Fatalf("fixture guard: read %d rows under the truncated LARGE CAP CORE banner, want 24", affected)
	}
}
