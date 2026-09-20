package main

import (
	"path/filepath"
	"testing"
)

// familyMislink16Dispatch runs the real dispatch on the family MISLINK16
// fixture with the named dictionary loaded and no series-map overlay, and
// asserts the fixture's own preconditions -- status, layout and row count --
// so a failure below is an assertion about the series id and never a broken
// fixture.
func familyMislink16Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_mislink16", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_mislink16", fixture), sink, make([]byte, headBytes))
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

// 000113/1137761/0000935069-04-001343.txt: verbatim source lines 11-28 (the SEC
// document opener through the registrant's FISCAL YEAR END), 49-58 (the header
// closer through the `Pacific Funds` cover line), 2256-2277 (the
// `PF AIM AGGRESSIVE GROWTH FUND` banner and the whole A.G. EDWARDS block under
// it), 6342-6372 (the page footer that closes the preceding section, the
// `PF JANUS GROWTH LT FUND` banner and the ALLIED WASTE and AMAZON.COM blocks
// under it) and the filing's own last four lines. Every byte is verbatim.
//
// Pacific Funds, CIK 1137761, period 20040630, layout `votesummary`. The filing
// carries NO <SERIES-ID> in its header (`grep -c SERIES-ID` -> 0), so the whole
// declaration set is the dictionary backfill, `cikSeries.back` over the 148
// rows of `pf_dict.tsv` (CIK 0001137761's rows of cik_series.tsv, verbatim).
//
// Source line 2265 and source line 6359, verbatim, are two flush-left banners
// of the same document, printed 27 and 22 times respectively as their own
// sections:
//
//	PF AIM AGGRESSIVE GROWTH FUND
//	PF JANUS GROWTH LT FUND
//
// The current tree stamps S000001906 on BOTH -- 486 rows on the AIM banner and
// 333 on the Janus one in the real filing. S000001906 is declared, at this CIK,
// under exactly these names and no others:
//
//	S000001906  PF JANUS GROWTH LT FUND                            20060630
//	S000001906  PL GROWTH LT FUND                                  20070630
//	S000001906  PL GROWTH FUND (FORMERLY CALLED PL GROWTH LT FUND)  20130630
//	S000001906  PL GROWTH FUND                                     20130630
//	S000001906  PF Growth Fund (formerly called PL GROWTH FUND)     20150630
//	S000001906  PF Growth Fund                                     20150630
//
// None of them spells AIM and none spells AGGRESSIVE. The registrant names its
// sleeves by sub-adviser throughout (`PF VAN KAMPEN ...`, `PF OPPENHEIMER ...`,
// `PF LOOMIS SAYLES ...`), so AIM is the sleeve's discriminator, not decoration.
//
// THE RUNG IS PROBED, not judged by eye. Walking every named rung against the
// normalised banner on the index this filing builds, exactly one answers:
//
//	RUNG issSplicedDecl ["pf aim aggressive growth fund"] -> S000001906 "PF Growth Fund"
//
// -- the declared `PF Growth Fund` (three tokens, `pf growth fund`) is an
// ordered subsequence of the five-token banner, with `aim` and `aggressive`
// SPLICED into the middle, and the tokens ahead of the declared name's first
// token are the registrant's own. Sibling probes on the same index confirm the
// route rather than the outcome: `AIM AGGRESSIVE GROWTH FUND` and `AGGRESSIVE
// GROWTH FUND` both resolve blank, while `PF AIM GROWTH FUND` -- a heading the
// filing never prints -- resolves to the same S000001906, so the rung reads any
// sub-adviser word as decoration on `PF Growth Fund`.
//
// Fix location: `layout_issnpx.go`, `issSplicedDecl` -- the inserted-token
// guard at the `issSizeDiscriminator` loop. A splice already refuses an
// inserted SIZE word this registrant separates its own declared siblings by;
// it must refuse on the same evidence when the inserted run carries a STYLE
// word (`issStyleWord`: growth, value, income, equity, bond) or a token the
// registrant uses as a sub-adviser discriminator, since the surviving stem
// `PF Growth Fund` is itself a declared name of a DIFFERENT sleeve the same
// document prints under its own banner. A second, independent guard would also
// close this one path: `PF Growth Fund` is first declared 20150630, later than
// this 20040630 period and later than the registrant's own earliest 20060630
// vintage, and `issSplicedDecl` is one of the rungs that does NOT consult
// `issFutureVintage`. It would not close the SIMT hazard in
// TestFamilyMislink16SIMTMidCapGrowthNeverMidCap, whose declaration is
// header-printed and undated, so the inserted-token guard is the fix.
//
// Rows affected: 486 on this path in the real filing, currently WRONG, correct
// outcome blank -- a wrong series is worse than a blank one. The sibling
// section asserted below is measured on the same dispatch: `PF JANUS GROWTH LT
// FUND` equals a declared name exactly, with nothing spliced, and must keep its
// id.
func TestFamilyMislink16PFAimAggressiveGrowthSpliced(t *testing.T) {
	rows := familyMislink16Dispatch(t, "pf_aim_aggressive_growth.txt", "pf_dict.tsv", "votesummary", 7)
	var aim, janus int
	for _, r := range rows {
		switch r.FundName {
		case "PF AIM AGGRESSIVE GROWTH FUND":
			aim++
			if r.SeriesID != "" {
				t.Errorf("the banner names an AIM AGGRESSIVE GROWTH sleeve; S000001906 is declared only as `PF JANUS GROWTH LT FUND` / `PL GROWTH LT FUND` / `PL GROWTH FUND` / `PF Growth Fund`, none of which spells AIM or AGGRESSIVE, and the same document prints `PF JANUS GROWTH LT FUND` as its own section and stamps that id there, so the splice of `aim aggressive` into a declared `PF Growth Fund` is a guess: issuer=%q cusip=%q date=%q desc=%q series=%q want \"\"",
					r.IssuerName, r.CUSIP, r.MeetingDate, r.VoteDescription, r.SeriesID)
			}
		case "PF JANUS GROWTH LT FUND":
			janus++
			if r.SeriesID != "S000001906" {
				t.Errorf("the sibling banner equals a declared name exactly, with no token spliced in, so it must keep its id: issuer=%q series=%q want S000001906", r.IssuerName, r.SeriesID)
			}
		default:
			t.Errorf("unexpected section %q", r.FundName)
		}
	}
	if aim != 3 || janus != 4 {
		t.Fatalf("fixture sections: aim=%d janus=%d want 3/4", aim, janus)
	}
}

// The SEI Institutional Managed Trust hazard, at the same rung, on the layout
// `pvtext` dispatches: 000080/804239/0001135428-10-000346.txt, CIK 804239,
// period 20100630, 1,891 rows blank today.
//
// Source line 36907 of that filing, verbatim (as a repeated page heading,
// printed 119 times), is a section of its own:
//
//	MID-CAP GROWTH FUND
//
// It is blank in the current tree and family NS35 §2 establishes it as a FLOOR:
// no registrant declares an SEI/SIMT Mid-Cap Growth Fund at any vintage. The
// filing declares 25 series in its own header and the only one that comes near
// is S000006675, declared as
//
//	<SERIES-ID>S000006675	<SERIES-NAME>SIMT MID CAP FUND
//
// whose own 42-row `MID-CAP FUND` section this same filing prints separately and
// correctly. The rows are blank ONLY because `pvtext` hands the resolver the
// bare printed heading. Probed on the index this registrant builds,
// `SIMT MID-CAP GROWTH FUND` and `SIMT Mid-Cap Growth Fund` BOTH answer
// S000006675, at the same rung as the Pacific Funds defect above:
//
//	RUNG issSplicedDecl ["simt mid cap growth fund"] -> S000006675 "SIMT MID CAP FUND"
//
// -- `growth` spliced into the declared `SIMT MID CAP FUND`. So any future rung
// that prefixed the registrant's own abbreviation to a `pvtext` heading before
// resolving would move all 1,891 rows onto an id that the filing already, and
// correctly, gives to a different section. This is the hazard, stated as a
// resolver-level assertion through the layout's entry point
// (`pvTextResolveAccount`, `layout_pvtext.go:944`) because the form that
// exhibits it is not printed in the real bytes -- the filing prints the bare
// heading, never the prefixed one.
//
// `growth` is exactly the evidence the splice rung already knows how to read on
// the size band: this registrant separates its OWN declared siblings by it --
// `SIMT SMALL CAP GROWTH FUND` (S000006670) beside `SIMT SMALL CAP VALUE FUND`,
// `SIMT LARGE CAP GROWTH FUND` (S000006671) beside `SIMT LARGE CAP VALUE FUND`
// -- so a heading that inserts it names a sleeve the registrant does not
// declare. Fix location, as above: `layout_issnpx.go`, `issSplicedDecl`, the
// inserted-token guard, extended from `issSizeDiscriminator` to the style band.
//
// `simt_dict.tsv` is all 36 rows for CIK 0000804239 verbatim from
// `cik_series.tsv`; the dictionary route reproduces the same 37 declarations and
// the same answer as the filing's own header does.
func TestFamilyMislink16SIMTMidCapGrowthNeverMidCap(t *testing.T) {
	oldDict := cikDict
	t.Cleanup(func() { cikDict = oldDict })
	d, err := loadCIKSeries(filepath.Join("testdata", "family_mislink16", "simt_dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}
	cikDict = d
	meta := FilingMeta{CIK: "0000804239", CompanyName: "SEI INSTITUTIONAL MANAGED TRUST", PeriodOfReport: "20100630"}
	cikDict.back(&meta)
	if len(meta.SeriesDecls) != 37 {
		t.Fatalf("fixture precondition: decls=%d want 37", len(meta.SeriesDecls))
	}
	ix := issFilingIndex(meta.SeriesDecls, normalizeSeriesName(meta.CompanyName), meta.CIK, metaPeriod(meta))
	// Precondition: the registrant declares the Mid Cap sleeve, declares no
	// Mid-Cap Growth one, and separates its own siblings by the style word.
	if hit, _ := lookupSeriesEntry(ix.byName, "SIMT MID CAP FUND"); hit == nil || hit.SeriesID != "S000006675" {
		t.Fatalf("fixture precondition: SIMT MID CAP FUND is not declared as S000006675")
	}
	if hit, _ := lookupSeriesEntry(ix.byName, "SIMT MID CAP GROWTH FUND"); hit != nil {
		t.Fatalf("fixture precondition: the registrant unexpectedly declares a Mid Cap Growth sleeve (%s)", hit.SeriesID)
	}
	for _, heading := range []string{"MID-CAP GROWTH FUND", "SIMT MID-CAP GROWTH FUND", "SIMT Mid-Cap Growth Fund"} {
		hit := pvTextResolveAccount(ix, heading)
		if hit == nil {
			continue
		}
		if !issHasToken(normalizeSeriesName(hit.Name), "growth") {
			t.Errorf("a heading naming a MID-CAP GROWTH sleeve resolves to a declared name that does not spell growth: heading=%q -> %s %q; the registrant declares no Mid-Cap Growth sleeve and separates its own siblings by growth/value (S000006670/S000006672, S000006671/S000006674), and its 42-row MID-CAP FUND section carries S000006675 under its own banner; want blank",
				heading, hit.SeriesID, hit.Name)
		}
	}
	// Controls: the correctly-spelled headings must keep resolving.
	for heading, want := range map[string]string{
		"SIMT MID CAP FUND":          "S000006675",
		"SIMT SMALL CAP GROWTH FUND": "S000006670",
		"SIMT LARGE CAP VALUE FUND":  "S000006674",
	} {
		hit := pvTextResolveAccount(ix, heading)
		if hit == nil || hit.SeriesID != want {
			t.Errorf("control heading stopped resolving: heading=%q got=%v want %s", heading, hit, want)
		}
	}
}
