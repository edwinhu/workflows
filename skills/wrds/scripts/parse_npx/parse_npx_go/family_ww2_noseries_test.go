package main

import (
	"path/filepath"
	"testing"
)

// familyWW2Dispatch runs the real dispatch on a family WW.2 no-series fixture
// with the registrants' own cik_series.tsv rows loaded as the dictionary.
func familyWW2Dispatch(t *testing.T, fixture, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ww2", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile(fixture, filepath.Join("testdata", "family_ww2", fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// 000035/353905/0000893220-04-001798.txt: 24-26, 137, 2745-2761. Gartmore
// Variable Insurance Trust prints the SUB-ADVISER's brand ahead of the declared
// fund name in the section banner:
//
//	======================= DREYFUS GVIT MID CAP INDEX FUND ========================
//
// The dictionary spells the fund without the sub-adviser -- `GVIT Mid Cap Index
// Fund` (S000005410) -- and nothing removes a leading brand token that sits in
// front of the registrant's own family token `GVIT`, so the banner resolves to
// nothing. The sibling banners that carry no added brand, or carry the
// registrant's own (`GARTMORE GVIT GROWTH FUND`), resolve. 2,468 rows in the
// full filing sit under a brand-prefixed GVIT banner whose residual stem is a
// dictionary name: MID CAP INDEX 2,400 and INTERNATIONAL VALUE 68 (`DREYFUS
// GVIT INTERNATIONAL VALUE FUND` -> S000005399).
func TestFamilyWW2GartmoreSubAdviserBrandPrefix(t *testing.T) {
	rows := familyWW2Dispatch(t, "gartmore_dreyfus_prefix.txt", "issnpx", 5)
	for _, r := range rows {
		if r.SeriesID != "S000005410" {
			t.Errorf("DREYFUS GVIT MID CAP INDEX FUND: fund=%q series=%q want S000005410", r.FundName, r.SeriesID)
		}
	}
}

// 000090/904046/0001104659-05-041297.txt: 24-26, 306-311, 312-571. Legg Mason
// Investors Trust prints the section heading hard-wrapped INSIDE one paragraph:
//
//	<p ...><b><font ...>Legg Mason
//	Financial Services Funds</font></b></p>
//
// Tag stripping preserves line structure, so the heading arrives as two lines
// and only the first, the bare registrant brand `Legg Mason`, is read as the
// fund. That fragment does not name any series -- yet the rows are stamped
// S000000669, LEGG MASON BALANCED TRUST, which is the wrong fund; the joined
// heading `Legg Mason Financial Services Funds` is S000000671. 768 rows in the
// full filing carry the truncated `Legg Mason` heading and the wrong id.
func TestFamilyWW2LeggMasonWrappedHeading(t *testing.T) {
	rows := familyWW2Dispatch(t, "leggmason_wrapped_heading.txt", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000000671" {
			t.Errorf("Legg Mason / Financial Services Funds: fund=%q series=%q want S000000671", r.FundName, r.SeriesID)
		}
	}
}

// 000151/1518042/0001580642-22-004097.txt: 14-16, 925-959, 1500-1511 (+ a closing </TABLE>). Northern
// Lights Fund Trust II reports through a wide grid whose last two columns are
// `Account Name` and `Internal Account Number`. The first rows of each account
// print both:
//
//	<TD ...>North Star Dividend Fund NSDVX</TD>
//	<TD ...>6734305800</TD></TR>
//
// and every later row of the same account repeats the NUMBER in the name cell:
//
//	<TD ...>6734305800</TD>
//	<TD ...>6734305800&nbsp;...</TD></TR>
//
// so the fund name lands as `6734305800` and resolves to nothing. The mapping
// is in the filing: 6734305800 is North Star Dividend Fund (S000040441) and
// 6734305810 is North Star Micro Cap (S000040440), each stated on the account's
// own earlier rows. 757 rows of the full filing carry a numeric fund name --
// 402 under 6734305800 and 355 under 6734305810 -- against 78 that carry the
// name and resolve.
func TestFamilyWW2NorthStarAccountNumberInNameCell(t *testing.T) {
	rows := familyWW2Dispatch(t, "northstar_account_number_cell.txt", "htmltable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000040441" {
			t.Errorf("account 6734305800: fund=%q series=%q want S000040441", r.FundName, r.SeriesID)
		}
	}
}

// 000104/1046068/0001144204-04-013573.txt: 24-26, 224-246, 359-432. The
// Westport Funds prints exactly one heading, the TRUST's name, above a single
// undivided vote table:
//
//	<DIV align=left><FONT ...>The Westport Funds</FONT></DIV></TD>
//
// The registrant declares two series -- Westport Fund (S000003152) and Westport
// Select Cap Fund (S000003153) -- and the string `Westport Select Cap` appears
// nowhere in the filing, so no row can be attributed. Every row is nonetheless
// stamped S000003152, the Westport Fund, because the trust name reduces to a
// sibling's name; 746 rows, half of them presumptively the other fund's. A
// heading that names the trust rather than a series must leave the id blank.
func TestFamilyWW2WestportTrustHeadingWrongStamp(t *testing.T) {
	rows := familyWW2Dispatch(t, "westport_trust_heading.txt", "htmltable", 2)
	for _, r := range rows {
		if r.SeriesID != "" {
			t.Errorf("The Westport Funds: fund=%q series=%q want no series (trust name, two declared series)", r.FundName, r.SeriesID)
		}
	}
}
