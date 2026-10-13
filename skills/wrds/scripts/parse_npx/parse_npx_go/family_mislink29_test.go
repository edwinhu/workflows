package main

import (
	"path/filepath"
	"testing"
)

// familyMislink29Dispatch runs the real dispatch on the family MISLINK29 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout, CIK, period, declared-series count and row
// count -- so a failure below is an assertion about the series id and never a
// broken fixture.
func familyMislink29Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	cikDict, seriesMap = nil, nil
	if dict != "" {
		var err error
		cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink29", dict))
		if err != nil {
			t.Fatal(err)
		}
	}
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink29", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(rows) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), count, meta.ErrorMsg)
	}
	if meta.CIK != "0001091439" || meta.PeriodOfReport != "20190630" || len(meta.SeriesDecls) != 1 {
		t.Fatalf("fixture/dispatch precondition: cik=%s period=%s decls=%d want 0001091439/20190630/1", meta.CIK, meta.PeriodOfReport, len(meta.SeriesDecls))
	}
	return rows
}

// 000109/1091439/0001438934-19-000067.txt (Allianz Variable Insurance Products
// Trust, CIK 0001091439, period 20190630, form N-PX, layout `broadridge`
// (NOT `issnpx`: the filing prints no `FORM N-PX REPORT` banner anywhere in its
// 769,923 lines, its document is `<FILENAME>BRDWE2_0001091439_2019.txt`, and its
// proposal tables are ruled `Prop.# Proposal / Proposal Type / Proposal Vote /
// For/Against Management`, which is the Broadridge column header and not the ISS
// `# Proposal / Mgt Rec / Vote Cast / Sponsor` one that `hasISSColumnHeader`
// tests for).
//
// Fixture `azl2019_dfaemergingmarkets.txt`, assembled from seven verbatim
// extracts of the real filing, whole-line drops only:
//
//  1. lines 1-42 -- the SGML preamble through the FILER block, ending just
//     before `<SERIES-AND-CLASSES-CONTRACTS-DATA>`: SEC-DOCUMENT /
//     SEC-HEADER lines, accession, submission type, `CONFORMED PERIOD OF
//     REPORT: 20190630`, and the whole FILER block including `COMPANY
//     CONFORMED NAME: ALLIANZ VARIABLE INSURANCE PRODUCTS TRUST`, `CENTRAL
//     INDEX KEY: 0001091439` and the FORMER COMPANY block.
//  2. lines 43-44 -- the `<SERIES-AND-CLASSES-CONTRACTS-DATA>` and
//     `<EXISTING-SERIES-AND-CLASSES-CONTRACTS>` opening tags.
//  3. lines 54-66 -- ONLY the single `<SERIES>`...`</SERIES>` block that
//     declares S000009945, verbatim (both of its class contracts included).
//     Every other one of this registrant's 22 declared series blocks (the
//     rest of lines 45-298) is dropped; the filing genuinely does NOT declare
//     S000046864 anywhere in its header, before or after this edit.
//  4. lines 299-301 -- the header closers
//     `</EXISTING-SERIES-AND-CLASSES-CONTRACTS>`,
//     `</SERIES-AND-CLASSES-CONTRACTS-DATA>`, `</SEC-HEADER>`.
//  5. lines 302-342 -- the DOCUMENT/TEXT open, the FORM N-PX cover page
//     (registrant, agent, fiscal year end, `DATE OF REPORTING PERIOD:
//     07/01/2018 - 06/30/2019`), the `<PAGE>` break, and the `<TABLE>` tag
//     with its `<S> <C> ...` column-header row. The `AZL BLACKROCK GLOBAL
//     ALLOCATION FUND` banner at line 344 and its entire section (through
//     line ~41243) are dropped -- that section belongs to a different fund.
//  6. lines 41244-41339 -- the `AZL DFA EMERGING MARKETS CORE EQUITY FUND`
//     banner (line 41244) and its separator, then the first THREE meetings
//     verbatim: 3M INDIA LIMITED / Agenda Number 709684939 / OTH
//     26-Jul-2018 (1 voted proposal), 3M INDIA LIMITED / Agenda Number
//     709740585 / AGM 10-Aug-2018 (3 voted proposals), and AARTI INDUSTRIES
//     LIMITED / Agenda Number 709881999 / AGM 21-Sep-2018, truncated after
//     its proposal 4 (`... FOR A PERIOD OF 4 (FOUR) YEARS`). AARTI's
//     proposals 5-15, the rest of this fund's section (hundreds of thousands
//     of lines) and every other fund's section in the filing are dropped.
//  7. lines 41378-41382 -- AARTI's own trailing blank lines and closing
//     separator rule, verbatim; then the real file's last 22 lines (`*
//     Management position unknown`, blank, `</TABLE>`, `<PAGE>`, the
//     SIGNATURES block through `Date 08/07/2019`, `</TEXT>`, `</DOCUMENT>`,
//     `</SEC-DOCUMENT>`).
//
// Every byte of those seven extracts is verbatim; nothing is hand-typed or
// paraphrased.
//
// `azl1091439_dict.tsv` is the relevant slice of `cik_series.tsv` for this
// registrant, verbatim -- exactly two rows, tab separated:
//
//	0001091439	S000009945	AZL MSCI Emerging Markets Equity Index Fund	20170630	000109/1091439/0001438934-17-000473.txt
//	0001091439	S000046864	AZL DFA Emerging Markets Core Equity Fund	20140630	000109/1091439/0001438934-14-000309.txt
//
// THE SHAPE, IN THE BYTES. The filing's own header declares exactly ONE sleeve
// in this fixture (and 22 in the real file, none of them S000046864):
//
//	<SERIES-ID>S000009945  <SERIES-NAME>AZL MSCI Emerging Markets Equity Index Fund
//
// and the body section under test is ruled by a banner that is NOT that name:
//
//	AZL DFA EMERGING MARKETS CORE EQUITY FUND
//
// The banner, normalized, is `AZL DFA Emerging Markets Core Equity Fund`. That
// string is the EXACT, registrant-unique dictionary name of a DIFFERENT series
// of the SAME CIK, S000046864, whose name was declared at vintage 20140630 --
// five years BEFORE this 20190630 filing. S000046864 is not declared anywhere in
// this filing's header. Meanwhile S000009945's own dictionary history --
// `AZL Oppenheimer Developing Markets Fund` (20060630), `AZL Schroder Emerging
// Markets Equity Fund` (20080630), `AZL MSCI Emerging Markets Equity Index
// Fund` (20170630) -- never contains the string `DFA` at any vintage. Every row
// of this section belongs to S000046864.
//
// THE REPORTED BUG DOES NOT REPRODUCE. This fixture was built to pin an alleged
// mislink -- the section stamped S000009945, the one declared sleeve, on the
// strength of the tokens `AZL`/`Emerging`/`Markets`/`Equity`/`Fund` it shares
// with the banner, the way MISLINK23/25/27/28 let a declared-but-textually-
// different sibling outrank an exact same-CIK dictionary name. It does not
// happen. Measured, this fixture, both a two-row and the full 99-row registrant
// slice of `cik_series.tsv`:
//
//	12 S000046864 "AZL DFA EMERGING MARKETS CORE EQUITY FUND"   -- CORRECT
//
// and measured on the REAL 40 MB filing with the full registrant dictionary,
// all 4,884 rows under this banner carry S000046864 and no row anywhere in the
// filing carries S000009945. Rebuilding the four previous HEADs
// (268fe2e1, 66912067, cc364fcd, 8be423eb) and re-parsing the real filing gives
// 4,884 S000046864 at every one of them, so this is not a fix that landed
// recently either -- the exact same-CIK dictionary name has been winning here
// all along. The test therefore stands as a REGRESSION GUARD on a shape that is
// already right, not as a failing bug pin.
//
// Kept because the shape is the one MISLINK23/25/27/28 are about and is worth
// nailing down: an exact registrant-unique dictionary name for an UNDECLARED
// same-CIK series, competing against a declared sibling that shares four of its
// six tokens.
//
// Incidental, and NOT what this test asserts: the fixture reproduces the real
// filing row for row, including a separate defect visible in both. The second
// meeting's issuer header line
//
//	3M INDIA LIMITED     Agenda Number:  709740585
//
// is consumed as a proposal row (`item_seq=3M`, description
// `INDIA LIMITED Agenda Number: 709740585`), and that meeting's four real rows
// then carry a BLANK issuer_name. That is a broadridge issuer-header bug, has
// nothing to do with the series id, and belongs in its own fixture.
func TestFamilyMislink29AZLDFAEmergingMarketsSameCIKExactDictName(t *testing.T) {
	rows := familyMislink29Dispatch(t, "azl2019_dfaemergingmarkets.txt", "azl1091439_dict.tsv", "broadridge", 12)
	var banner, wrong int
	var first VoteRow
	for _, r := range rows {
		switch r.FundName {
		case "AZL DFA EMERGING MARKETS CORE EQUITY FUND":
			banner++
			if r.SeriesID != "S000046864" {
				if wrong == 0 {
					first = r
				}
				wrong++
			}
		default:
			t.Errorf("fixture precondition: unexpected fund banner %q (series %q)", r.FundName, r.SeriesID)
		}
	}
	if banner != 12 {
		t.Fatalf("fixture section: AZL DFA EMERGING MARKETS CORE EQUITY FUND banner rows=%d want 12", banner)
	}
	if wrong != 0 {
		t.Errorf("REGRESSION: %d of %d rows under the body banner `AZL DFA EMERGING MARKETS CORE EQUITY FUND` carry the WRONG series id. Normalized, that banner is `AZL DFA Emerging Markets Core Equity Fund`, the exact registrant-unique dictionary name of a same-CIK series S000046864 at vintage 20140630 (five years before this 20190630 filing) that this filing's header never declares -- and the one sleeve it DOES declare, S000009945, never carries the string `DFA` at any vintage of its own history (AZL Oppenheimer Developing Markets Fund 20060630, AZL Schroder Emerging Markets Equity Fund 20080630, AZL MSCI Emerging Markets Equity Index Fund 20170630). Every row here is S000046864's, and was on this tree and on the four previous HEADs; a non-S000046864 id means a declared-but-textually-different sibling (they share four tokens: AZL/Emerging/Markets/Equity/Fund) has started outranking the exact same-CIK dictionary name, which is the MISLINK23/25/27/28 failure. First offender: issuer=%q item=%q cusip=%q date=%q desc=%q series=%q want S000046864",
			wrong, banner, first.IssuerName, first.ItemSeq, first.CUSIP, first.MeetingDate, first.VoteDescription, first.SeriesID)
	}
}
