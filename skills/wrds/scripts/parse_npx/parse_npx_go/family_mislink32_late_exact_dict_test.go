package main

import (
	"path/filepath"
	"sort"
	"testing"
)

// FAMILY MISLINK32 -- AN EXACT OWN-CIK DICTIONARY NAME DATED AFTER THE FILING.
//
// `cik_series.tsv` is a HISTORY, not a snapshot: one series carries a row per
// name it has ever been filed under, each stamped with the period of the filing
// that declared it. A banner that matches such a row EXACTLY, for this
// registrant, is the strongest evidence the resolver can get -- but only if the
// row's `declDate` is at or before the filing's own period. When the exact row
// is dated AFTER the period, the banner is a name the series had not been given
// yet, so the section belongs to whichever series later took that name, and the
// parser must not fall through to a tolerance rung against a sibling.
//
// Both filings below are a section whose banner is an exact own-CIK dictionary
// name dated after the period, and both are stamped the id of a DIFFERENT
// series on HEAD (de8d7a96):
//
//   - Pax World 0000076721, period 20100630. The banner `Pax World Global
//     Women's Equality Fund` is S000019419's later name (declared 20110630;
//     the header still spells it `Pax World Women's Equity Fund`). Its 838 rows
//     go to S000021458 -- `Pax World Global Green Fund`, a sibling this filing
//     ALSO declares and ALSO reports under its own banner, so the wrong id is
//     one the resolver can see is already spoken for.
//   - KraneShares 0001547576, period 20220630. The banner `KraneShares Global
//     Carbon Transformation ETF` is S000075539 (declared 20230630); the header
//     declares no such series, only S000066286 `KraneShares Global Carbon
//     Strategy ETF`. Its 427 rows go to S000066286 -- again a live section of
//     this same filing.
//
// Each filing pins BOTH halves. The must-hold section is the sibling whose id
// is wrongly stamped on the must-change one, so a fix cannot be measured by
// moving rows off one banner and onto the other: `Pax World Global Green Fund`
// must keep S000021458 and `KraneShares Global Carbon Strategy ETF` must keep
// S000066286.
//
// The KraneShares fixture carries the extension `.npx`, not `.txt`, for the
// reason family VS1 records: TestHowVotedVocabularyInvariant sweeps every
// `*.txt` under testdata/ and this filing prints `Voted - Split`, which
// `issVoteValues` does not carry (`Voted - For` and `Voted - Split` are one
// vintage's two spellings and only the first is in the vocabulary). Both
// occurrences are verbatim corpus text and one of them is the must-hold
// section's ONLY row, so the fixture is kept out of that invariant's corpus
// rather than the section being trimmed away or the invariant weakened.
// Nothing in processFile keys on the extension.
//
// Same class as families MISLINK23 (2e2ec1c5) through MISLINK31 (de8d7a96) --
// a row of one series stamped with a wrong series -- but unlike those, the
// discriminating evidence is a DATE, not a spelling: the right answer here is
// reachable only by reading `declDate` against `PeriodOfReport`.

// familyMislink32Dispatch runs the real dispatch on one family MISLINK32
// fixture with that filing's own `cik_series.tsv` slice loaded, and asserts the
// fixture's own preconditions -- status, layout, CIK, period and
// declared-series count -- so a failure below is an assertion about the series
// id and never a broken fixture. Each fixture dispatches to the same layout,
// and yields the same (series id, fund name) groups with the same row counts,
// as the full filing it was cut from.
func familyMislink32Dispatch(t *testing.T, fixture, dict, layout, cik, period string, decls int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink32", dict))
	if err != nil {
		t.Fatal(err)
	}
	ch := make(chan *ParseResult, 4096)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink32", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) == 0 {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s, want ok/%s/>0", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg, layout)
	}
	if meta.CIK != cik || meta.PeriodOfReport != period || len(meta.SeriesDecls) != decls {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s decls=%d, want %s/%s/%d", meta.CIK, meta.PeriodOfReport, len(meta.SeriesDecls), cik, period, decls)
	}
	return rows
}

// familyMislink32Assert checks that every row of every listed banner carries
// that banner's expected series id and that no row is blank, and that each
// listed banner produced at least one row. `wrong` names the id HEAD stamps, so
// a failure reads as the specific defect rather than as a bare mismatch.
func familyMislink32Assert(t *testing.T, rows []VoteRow, want, wrong map[string]string, why string) {
	t.Helper()
	seen := map[string]int{}
	for _, r := range rows {
		w, ok := want[r.FundName]
		if !ok {
			t.Errorf("fixture precondition: unexpected fund banner %q (series %q)", r.FundName, r.SeriesID)
			continue
		}
		seen[r.FundName]++
		if r.SeriesID == "" {
			t.Errorf("banner %q -> BLANK series id, want %s. %s", r.FundName, w, why)
			continue
		}
		if r.SeriesID != w {
			note := ""
			if r.SeriesID == wrong[r.FundName] {
				note = " -- this is EXACTLY the id HEAD stamps"
			}
			t.Errorf("banner %q -> series %q, want %s%s. %s. row: issuer=%q item=%q cusip=%q date=%q desc=%q",
				r.FundName, r.SeriesID, w, note, why, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.VoteDescription)
		}
	}
	banners := make([]string, 0, len(want))
	for b := range want {
		banners = append(banners, b)
	}
	sort.Strings(banners)
	for _, b := range banners {
		if seen[b] == 0 {
			t.Fatalf("fixture section: banner %q produced no rows", b)
		}
	}
}

func TestFamilyMislink32LateExactDictName(t *testing.T) {
	// 000007/76721/0000076721-10-000019.txt (Pax World Funds Series Trust I,
	// CIK 0000076721, period 20100630, layout `icr`).
	//
	// The fixture keeps the SGML header, the cover page, and the whole Global
	// Women's Equality (raw lines 6077-8457) and Global Green (9887-11573)
	// sections; it reproduces the full filing's layout, 11 declarations, and both
	// groups at 838 and 550 rows.
	//
	// MUST CHANGE. `Fund Name : Pax World Global Women's Equality Fund` is
	// S000019419: the dictionary row `0000076721 S000019419 Pax World Global
	// Women's Equality Fund 20110630` spells it exactly, and the filing's own
	// header declares that series under its earlier name `Pax World Women's
	// Equity Fund`. The 20110630 declDate is AFTER this 20100630 period, which is
	// why no exact rung fires and the answer falls onto S000021458.
	//
	// MUST HOLD. `Fund Name : Pax World Global Green Fund` is S000021458, exactly
	// as the header declares it and exactly as the dictionary spells it at
	// 20080630 -- at or before the period. That it is the very id stamped on the
	// Women's Equality section is the arithmetic that proves a rung is answering:
	// two banners of one filing cannot both be one series.
	t.Run("0000076721", func(t *testing.T) {
		rows := familyMislink32Dispatch(t, "pax2010_womens_equality_late_name.txt", "cikdict_pax.tsv", "icr", "0000076721", "20100630", 11)
		familyMislink32Assert(t, rows,
			map[string]string{
				"Fund Name : Pax World Global Women's Equality Fund": "S000019419",
				"Fund Name : Pax World Global Green Fund":            "S000021458",
			},
			map[string]string{
				"Fund Name : Pax World Global Women's Equality Fund": "S000021458",
			},
			"the banner is the EXACT own-CIK dictionary name of S000019419, dated 20110630 -- after this 20100630 period -- so the series that was renamed into it owns the section, and S000021458 is a sibling reporting separately in the same filing")
	})

	// 000154/1547576/0001135428-22-000130.txt (KraneShares Trust,
	// CIK 0001547576, period 20220630, layout `htmltable`).
	//
	// The real filing is 62 MB; the fixture keeps the SGML header, the cover and
	// non-voting-funds pages, and the whole Global Carbon Transformation
	// (raw lines 1461015-1481444) and Global Carbon Strategy (1481445-1481526)
	// pages, cut on the `page-break-before` boundaries. It reproduces the full
	// filing's layout, 30 declarations, and both groups at 427 and 1 rows.
	//
	// MUST CHANGE. `KraneShares Global Carbon Transformation ETF` is S000075539,
	// spelled exactly in the dictionary at 20230630 -- one period later, which is
	// when this registrant first declared it. This filing's header does not
	// declare it at all, so every header-side rung must decline and the 427 rows
	// fall onto the nearest sibling.
	//
	// MUST HOLD. `KraneShares Global Carbon Strategy ETF` is S000066286, declared
	// by this filing's header and spelled exactly in the dictionary at 20220630 --
	// this very period. Its single row is the whole of the section, so a fix that
	// moves rows off the Transformation banner must not disturb it.
	t.Run("0001547576", func(t *testing.T) {
		rows := familyMislink32Dispatch(t, "krane2022_carbon_transformation_late_name.npx", "cikdict_krane.tsv", "htmltable", "0001547576", "20220630", 30)
		familyMislink32Assert(t, rows,
			map[string]string{
				"KraneShares Global Carbon Transformation ETF": "S000075539",
				"KraneShares Global Carbon Strategy ETF":       "S000066286",
			},
			map[string]string{
				"KraneShares Global Carbon Transformation ETF": "S000066286",
			},
			"the banner is the EXACT own-CIK dictionary name of S000075539, dated 20230630 -- after this 20220630 period -- and the id stamped instead belongs to the Global Carbon Strategy section of this same filing")
	})
}
