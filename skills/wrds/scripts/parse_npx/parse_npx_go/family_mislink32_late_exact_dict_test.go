package main

import (
	"path/filepath"
	"sort"
	"testing"
)

// FAMILY MISLINK32 -- AN EXACT OWN-CIK DICTIONARY NAME DATED AFTER THE FILING,
// AND THE TWO CONDITIONS THAT KEEP IT FROM REACHING TOO FAR.
//
// `cik_series.tsv` is a HISTORY, not a snapshot: one series carries a row per
// name it has ever been filed under, each stamped with the period of the filing
// that declared it. A banner that matches such a row EXACTLY, for this
// registrant, is strong evidence -- but only in one direction. When the exact
// row is dated AFTER the filing's own period, the banner is a name the series
// had not been given yet, so the section may belong to whichever series later
// took that name rather than to the sibling a tolerance rung would pick.
//
// "May", not "does". A whole-corpus re-parse of the first form of this rule --
// exact own-CIK name, later declDate, displace whatever the other rungs
// answered -- moved ~75K rows and put ~48K of them on a series the filing's own
// header does not declare. Two conditions separate the cases, and BOTH halves
// are pinned below:
//
//  1. DECLARED IN THIS FILING'S OWN SGML HEADER. A series the registrant had
//     not yet created cannot own a section of a filing it does not appear in.
//     Wells Fargo's S000029123 is first declared at 20110630 and Hartford's
//     S000084804 at 20240630; neither is in the 2006 and 2013 headers whose
//     sections the first rule moved onto them.
//  2. THE DISPLACED ANSWER MUST NOT ALREADY ACCOUNT FOR THE BANNER'S
//     DISTINCTIVE WORDS -- what is left of the banner once the house brand and
//     generic words (Fund, Portfolio) are stripped. This is the case where the
//     NAME MOVED between two siblings the filing declares side by side, and the
//     dictionary's later row records the destination rather than the origin.
//     Wells Fargo 0001081400 at 20060630 declares S000007257 `International
//     Equity Fund` AND S000007255 `International Core Fund`; by 20110630 the
//     `International Equity` name had moved to S000007255. The 2006 banner
//     `WELLS FARGO ADVANTAGE INTERNATIONAL EQUITY FUND` is therefore S000007257
//     -- whose header name already spells `International Equity` -- and the
//     later exact row for S000007255 must not take it.
//
// MUST CHANGE -- the rule reaches these, and each already passes on HEAD
// (3698c742). The later-named series is declared in the filing's own header
// under its earlier name, and the displaced answer is a sibling whose name says
// something else entirely:
//
//   - Pax World 0000076721, period 20100630. `Pax World Global Women's Equality
//     Fund` is S000019419's later name (declared 20110630; the header still
//     spells it `Pax World Women's Equity Fund`). Its 838 rows had gone to
//     S000021458 -- `Pax World Global Green Fund`, a sibling this filing ALSO
//     declares and ALSO reports under its own banner.
//   - PowerShares 0001209466, period 20060630. `PowerShares Zacks Micro Cap
//     Portfolio` is S000003035's later name (declared 20080630); the header
//     declares that series as `PowerShares Dynamic Zachs Microcap Portfolio`.
//     The displaced answer was S000011251 `PowerShares Zacks Small Cap
//     Portfolio` -- which this filing reports under its own banner, and which
//     says Small Cap where the banner says Micro Cap.
//   - Turner 0001006783, period 20090630. `TURNER QUANTITATIVE LARGE CAP VALUE
//     FUND` is S000006685's later name (declared 20100630); the header declares
//     that series as `TURNER LARGE CAP VALUE FUND`. The displaced answer was
//     S000022340 `Turner Quantitative Broad Market Equity Fund` -- again a live
//     section of this same filing, and again a different fund.
//
// MUST HOLD -- the rule must NOT reach these. On HEAD every one of them is
// moved wrongly, so these four subtests are the failing half of this family:
//
//   - Wells Fargo 0001081400 / 0001193125-06-182830, period 20060630. Blocked
//     by condition 2: the exact later row belongs to S000007255 (`Wells Fargo
//     Advantage International Equity Fund`, 20130630) and S000007255 IS
//     declared in this header -- as `International Core Fund`. But the answer
//     the rule would displace, S000007257, already accounts for the banner's
//     distinctive words, because the header spells it `International Equity
//     Fund`. HEAD stamps S000007255 on both this filing's International Equity
//     section and its International Core section.
//   - Wells Fargo 0001081400 / 0001193125-06-182796, period 20060630. Blocked
//     by condition 1: `Wells Fargo Advantage Asset Allocation Fund` is exactly
//     S000029123 at 20110630, but S000029123 is not declared anywhere in this
//     filing's header -- this registrant first declared it five years later.
//     The section is S000007370, which the header declares as `Asset Allocation
//     Fund`. HEAD stamps S000029123.
//   - Hartford 0001053425, period 20130630. Blocked by condition 1:
//     `HARTFORD SMALL CAP GROWTH HLS FUND` is exactly S000084804 at 20240630 --
//     eleven years later, and not in this header. The assertion pins
//     S000003220, which is what binary 435 answered before this family existed;
//     it says NOT MOVED BY THIS RULE and is not a claim that S000003220 is the
//     right series for the section.
//   - Touchstone 0000711080, period 20060630. Blocked by condition 1 (and by
//     condition 2 as well): `Touchstone Small Cap Growth Fund` is exactly
//     S000038006 at 20140630, which this 2006 header does not declare, and the
//     displaced S000003128 is spelled `Small Cap Growth Fund` in that header --
//     the banner's distinctive words exactly. As with Hartford, S000003220's
//     counterpart S000003128 is binary 435's answer and the assertion pins
//     only that this rule leaves it alone.
//
// KNOWN RESIDUE -- KraneShares 0001547576, period 20220630. `KraneShares Global
// Carbon Transformation ETF` is exactly S000075539 at 20230630, one period
// later, and that series is NOT declared in this filing's header, so condition
// 1 puts these 427 rows out of the narrowed rule's reach. They carry
// S000066286 -- the id of the `KraneShares Global Carbon Strategy ETF` section
// of this same filing -- and that is wrong. No id is asserted for them: the
// residue is recorded here rather than pinned, because pinning S000075539
// would re-license exactly the over-reach condition 1 exists to stop. The
// Carbon Strategy section's own id is still a must-hold.
//
// Each filing pins both halves where it can. Where the must-change section's
// wrong id belonged to a sibling reporting separately in the same filing, that
// sibling is kept in the fixture too, so a fix cannot be measured by moving
// rows off one banner and onto the other: two banners of one filing cannot both
// be one series.
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
// discriminating evidence is a DATE read against `PeriodOfReport`, and the
// guard on that evidence is the filing's own SGML header.

// mislink32NoAssert is the `want` value for a section whose rows the fixture
// keeps on purpose but whose series id this family does not pin -- see the
// KraneShares residue above. The banner must still produce rows.
const mislink32NoAssert = "*"

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
// listed banner produced at least one row. A `want` of mislink32NoAssert skips
// the id check for that banner while still requiring its rows. `wrong` names the
// id HEAD stamps, so a failure reads as the specific defect rather than as a
// bare mismatch.
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
		if w == mislink32NoAssert {
			continue
		}
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
	// KNOWN RESIDUE, NOT PINNED. `KraneShares Global Carbon Transformation ETF`
	// is spelled exactly in the dictionary as S000075539 at 20230630 -- one
	// period later, which is when this registrant first declared it -- and this
	// filing's header does not declare it at all. Condition 1 therefore puts the
	// 427 rows outside the narrowed rule: they stay on S000066286, which is
	// wrong, and no id is asserted for them. Asserting S000075539 here would
	// require the rule to reach a series the filing never declares, which is the
	// ~48K-row over-reach condition 1 exists to stop.
	//
	// MUST HOLD. `KraneShares Global Carbon Strategy ETF` is S000066286, declared
	// by this filing's header and spelled exactly in the dictionary at 20220630 --
	// this very period. Its single row is the whole of the section.
	t.Run("0001547576", func(t *testing.T) {
		rows := familyMislink32Dispatch(t, "krane2022_carbon_transformation_late_name.npx", "cikdict_krane.tsv", "htmltable", "0001547576", "20220630", 30)
		familyMislink32Assert(t, rows,
			map[string]string{
				"KraneShares Global Carbon Transformation ETF": mislink32NoAssert,
				"KraneShares Global Carbon Strategy ETF":       "S000066286",
			},
			nil,
			"the Global Carbon Strategy section is declared by this filing's header and spelled exactly in the dictionary at this very period, so nothing may move it; the Transformation rows above it are a known residue this family does not reach")
	})

	// 000120/1209466/0001104659-06-057235.txt (PowerShares Exchange-Traded Fund
	// Trust, CIK 0001209466, period 20060630, layout `broadridge`).
	//
	// The real filing is 32 MB of HTML wrapped at 1023 columns, so line numbers
	// are not section boundaries; the fixture keeps the SGML header and cover
	// page, then ONE `page-break-before:always` page of the Zacks Micro Cap
	// section and one of the Zacks Small Cap section, each cut to start at the
	// `<p>` element that prints its banner so no rows of a neighbouring fund come
	// with it. It reproduces the full filing's layout, 37 declarations, and the
	// same id for each banner; the row counts are the kept pages' 17 and 44, not
	// the full filing's 668 and 356.
	//
	// MUST CHANGE. `PowerShares Zacks Micro Cap Portfolio` is S000003035: the
	// dictionary row `0001209466 S000003035 PowerShares Zacks Micro Cap Portfolio
	// 20080630` spells it exactly, and this filing's own header declares that
	// series under its earlier name `PowerShares Dynamic Zachs Microcap
	// Portfolio`. Both conditions are met -- the series is in the header, and the
	// displaced S000011251 says Small Cap where the banner says Micro Cap -- so
	// the rule reaches it, as binary 435 did not.
	//
	// MUST HOLD. `PowerShares Zacks Small Cap Portfolio` is S000011251, exactly
	// as the header declares it and exactly as the dictionary spells it at
	// 20060630. That it is the very id binary 435 stamped on the Micro Cap
	// section is the arithmetic that proves a rung is answering.
	t.Run("0001209466", func(t *testing.T) {
		rows := familyMislink32Dispatch(t, "powershares2006_zacks_micro_cap_late_name.txt", "cikdict_powershares.tsv", "broadridge", "0001209466", "20060630", 37)
		familyMislink32Assert(t, rows,
			map[string]string{
				"PowerShares Zacks Micro Cap Portfolio": "S000003035",
				"PowerShares Zacks Small Cap Portfolio": "S000011251",
			},
			map[string]string{
				"PowerShares Zacks Micro Cap Portfolio": "S000011251",
			},
			"the banner is the EXACT own-CIK dictionary name of S000003035, dated 20080630 -- after this 20060630 period -- and that series IS declared in this filing's header as `PowerShares Dynamic Zachs Microcap Portfolio`, while S000011251 is a sibling reporting separately in the same filing")
	})

	// 000100/1006783/0001135428-09-000388.txt (Turner Funds, CIK 0001006783,
	// period 20090630, layout `issnpx`).
	//
	// The fixture keeps the SGML header and cover page, the whole Quantitative
	// Broad Market Equity (raw lines 12997-15659) and Quantitative Large Cap
	// Value (15660-17884) sections, cut on the `=====` banner rules, and the
	// signature page. It reproduces the full filing's layout, 14 declarations,
	// and both groups at 1316 and 1094 rows.
	//
	// MUST CHANGE. `TURNER QUANTITATIVE LARGE CAP VALUE FUND` is S000006685: the
	// dictionary spells it exactly at 20100630, and this filing's own header
	// declares that series as `TURNER LARGE CAP VALUE FUND`. Binary 435 answered
	// S000022340.
	//
	// MUST HOLD. `TURNER QUANTITATIVE BROAD MARKET EQUITY FUND` is S000022340,
	// declared by this header and spelled in the dictionary at 20080630 -- before
	// the period. It is the id 435 stamped on the Large Cap Value section, so the
	// two assertions cannot both be satisfied by moving rows between them.
	t.Run("0001006783", func(t *testing.T) {
		rows := familyMislink32Dispatch(t, "turner2009_quantitative_large_cap_value_late_name.txt", "cikdict_turner.tsv", "issnpx", "0001006783", "20090630", 14)
		familyMislink32Assert(t, rows,
			map[string]string{
				"TURNER QUANTITATIVE LARGE CAP VALUE FUND":     "S000006685",
				"TURNER QUANTITATIVE BROAD MARKET EQUITY FUND": "S000022340",
			},
			map[string]string{
				"TURNER QUANTITATIVE LARGE CAP VALUE FUND": "S000022340",
			},
			"the banner is the EXACT own-CIK dictionary name of S000006685, dated 20100630 -- after this 20090630 period -- and that series IS declared in this filing's header as `TURNER LARGE CAP VALUE FUND`, while S000022340 is a sibling reporting separately in the same filing")
	})

	// 000108/1081400/0001193125-06-182830.txt (Wells Fargo Funds Trust,
	// CIK 0001081400, period 20060630, layout `issnpx`).
	//
	// The fixture keeps the SGML header and cover page, the whole International
	// Core (raw lines 8430-12166) and International Equity (12167-23739)
	// sections, cut on the `=====` banner rules, and the closing tags. It
	// reproduces the full filing's layout, 7 declarations, and both groups at
	// 1268 and 3893 rows.
	//
	// MUST HOLD -- CONDITION 2. The banner `WELLS FARGO ADVANTAGE INTERNATIONAL
	// EQUITY FUND` is S000007257, which this header declares as `International
	// Equity Fund`: the displaced answer already accounts for every distinctive
	// word of the banner. The dictionary's exact later row
	// `0001081400 S000007255 Wells Fargo Advantage International Equity Fund
	// 20130630` records where the NAME went, not where this section belongs --
	// S000007255 is `International Core Fund` at this period and is reported
	// under that banner in this very filing, so HEAD's answer makes one series
	// own two sections at once.
	t.Run("0001081400_international_equity", func(t *testing.T) {
		rows := familyMislink32Dispatch(t, "wellsfargo2006_international_equity_late_name.txt", "cikdict_wellsfargo.tsv", "issnpx", "0001081400", "20060630", 7)
		familyMislink32Assert(t, rows,
			map[string]string{
				"WELLS FARGO ADVANTAGE INTERNATIONAL EQUITY FUND": "S000007257",
				"WELLS FARGO ADVANTAGE INTERNATIONAL CORE FUND":   "S000007255",
			},
			map[string]string{
				"WELLS FARGO ADVANTAGE INTERNATIONAL EQUITY FUND": "S000007255",
			},
			"S000007257 is what this filing's header spells `International Equity Fund`, so it already accounts for the banner's distinctive words and the later exact row for S000007255 -- the `International Core Fund` of this same filing -- must not displace it")
	})

	// 000108/1081400/0001193125-06-182796.txt (Wells Fargo Funds Trust,
	// CIK 0001081400, period 20060630, layout `issnpx`).
	//
	// The fixture keeps the SGML header, the cover page and the feeder-fund note
	// pages, the whole Asset Allocation section (raw lines 278-9254) cut on the
	// `=====` banner rules, and the END NPX REPORT and signature pages. It
	// reproduces the full filing's layout, 6 declarations, and the group at 4061
	// rows.
	//
	// MUST HOLD -- CONDITION 1. `WELLS FARGO ADVANTAGE ASSET ALLOCATION FUND` is
	// spelled exactly in the dictionary as S000029123 at 20110630, but this
	// filing's header does not declare S000029123 at all -- the registrant first
	// declared it five years after this period, so it cannot own a section here.
	// The section is S000007370, which the header declares as `Asset Allocation
	// Fund`, and which the dictionary also spells exactly at this very 20060630
	// period.
	t.Run("0001081400_asset_allocation", func(t *testing.T) {
		rows := familyMislink32Dispatch(t, "wellsfargo2006_asset_allocation_late_name.txt", "cikdict_wellsfargo.tsv", "issnpx", "0001081400", "20060630", 6)
		familyMislink32Assert(t, rows,
			map[string]string{
				"WELLS FARGO ADVANTAGE ASSET ALLOCATION FUND": "S000007370",
			},
			map[string]string{
				"WELLS FARGO ADVANTAGE ASSET ALLOCATION FUND": "S000029123",
			},
			"S000029123's exact row is dated 20110630 and this filing's header never declares that series, so the later name cannot reach this section; S000007370 is the `Asset Allocation Fund` the header does declare")
	})

	// 000105/1053425/0001144204-13-046733.txt (Hartford Series Fund, Inc.,
	// CIK 0001053425, period 20130630, layout `icr`).
	//
	// The real filing is 6.4 MB; the fixture keeps the SGML header and cover
	// page, the whole Small Cap Growth HLS section (raw lines 122824-131105) cut
	// on the `Registrant :` boundaries, and the signature page. It reproduces the
	// full filing's layout, 30 declarations, and the group at 2523 rows.
	//
	// MUST HOLD -- CONDITION 1. `Hartford Small Cap Growth HLS Fund` is spelled
	// exactly in the dictionary as S000084804 at 20240630 -- eleven years after
	// this period -- and this filing's header does not declare S000084804. The
	// assertion pins S000003220, which is the id binary 435 answered before this
	// family existed: it says the section is NOT MOVED BY THIS RULE, and is NOT a
	// claim that S000003220 is the right series for the section. (S000003220 is
	// `HARTFORD SMALL COMPANY HLS FUND` in this header, and carries two other
	// banners of the full filing besides.)
	t.Run("0001053425", func(t *testing.T) {
		rows := familyMislink32Dispatch(t, "hartford2013_small_cap_growth_late_name.txt", "cikdict_hartford.tsv", "icr", "0001053425", "20130630", 30)
		familyMislink32Assert(t, rows,
			map[string]string{
				"Fund Name : Hartford Small Cap Growth HLS Fund": "S000003220",
			},
			map[string]string{
				"Fund Name : Hartford Small Cap Growth HLS Fund": "S000084804",
			},
			"S000084804's exact row is dated 20240630 and this filing's header never declares that series, so this family must leave the section where the other rungs put it -- S000003220 is that prior answer, not an assertion that it is correct")
	})

	// 000071/711080/0001144204-06-036226.txt (Touchstone Strategic Trust,
	// CIK 0000711080, period 20060630, layout `broadridge`).
	//
	// The fixture keeps the SGML header and cover page, the whole Small Cap
	// Growth section (raw lines 9083-13080) AND the Value Plus section that
	// follows it (13081-14906), cut on the `</TABLE>`/`<PAGE>` boundaries, plus
	// the signature page. `Touchstone Value Plus Fund` is not a series this
	// header declares and does not open a group of its own, so its rows fold into
	// the Small Cap Growth banner; keeping it is what reproduces the full
	// filing's group at 1540 rows, along with its layout and 8 declarations.
	//
	// MUST HOLD -- CONDITIONS 1 AND 2. `Touchstone Small Cap Growth Fund` is
	// spelled exactly in the dictionary as S000038006 at 20140630, which this
	// 2006 header does not declare (S000038006's first name here is `Touchstone
	// Micro Cap Value Fund` at 20120630). Condition 2 blocks it independently:
	// the displaced S000003128 is `Small Cap Growth Fund` in this header, the
	// banner's distinctive words exactly. As with Hartford, S000003128 is binary
	// 435's answer and the assertion pins only that this rule leaves it alone.
	t.Run("0000711080", func(t *testing.T) {
		rows := familyMislink32Dispatch(t, "touchstone2006_small_cap_growth_late_name.txt", "cikdict_touchstone.tsv", "broadridge", "0000711080", "20060630", 8)
		familyMislink32Assert(t, rows,
			map[string]string{
				"Touchstone Small Cap Growth Fund": "S000003128",
			},
			map[string]string{
				"Touchstone Small Cap Growth Fund": "S000038006",
			},
			"S000038006's exact row is dated 20140630 and this filing's header never declares that series, and S000003128 -- the header's own `Small Cap Growth Fund` -- already accounts for every distinctive word of the banner, so both conditions decline")
	})
}
