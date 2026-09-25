package main

import (
	"path/filepath"
	"testing"
)

// familyNSCrossCIKAbandonedNameDispatch runs the real dispatch on the family
// fixture with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture.
func familyNSCrossCIKAbandonedNameDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_crosscik_abandoned_name", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns_crosscik_abandoned_name", fixture), sink, make([]byte, headBytes))
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

// 000158/1580843/0001398344-23-014901.txt: verbatim source lines 1-19, 41-112,
// 204, 119042-119154, 119254-119284, 322296 and 322380-322384 (the filing's own
// tail). The two cuts inside the Equity Residential block drop eight of its ten
// director-nominee sub-rows and nothing else; the whole block parses to the same
// four rows with the same ids, so the trim is size only.
//
// SYNTAX ETF TRUST (CIK 1580843), period 20230630, files an N-PX in which every
// portfolio company voted on opens with its own ruled banner. At source line
// 119042 the banner for the REIT Equity Residential wraps its name across two
// lines inside the <B> tag:
//
//	<TR STYLE="background-color: #004F75">
//	    <TD COLSPAN="13" STYLE="vertical-align: top; border-top: Black 1pt solid; border-bottom: Black 1pt solid; border-left: Black 1pt solid"><FONT STYLE="color: white"><B>EQUITY
//	    RESIDENTIAL</B></FONT></TD>
//
// Markup stripping puts each cell on its own line, so the wrapped name arrives
// as `EQUITY` then `RESIDENTIAL`, and the leading word ALONE reaches resolution
// as a fund-name candidate. The same shape is at source line 42819 for
// `GLOBAL\n    PAYMENTS INC.`, so this is not one issuer's accident.
//
// Measured on the real dispatch over the WHOLE filing (19,764,982 bytes) with
// this fixture's 14-row dictionary loaded: layout=htmltable, 15,685 rows, of
// which 8,977 carry fund=`EQUITY` / S000008805 and 4,378 carry fund=`GLOBAL` /
// S000008807 -- 13,355 mislinked rows, and the sticky fund name carries each one
// forward across the issuers that follow its banner (a `GLOBAL` row is stamped
// on PTC INC.'s meeting). On this trimmed fixture the same dispatch yields
// status=ok, layout=htmltable, 4 rows, all four fund=`EQUITY`
// issuer=`EQUITY RESIDENTIAL` cusip=29476L107 series=S000008805.
//
// The rung is cikSeries.crossCIK (cik_series.go:178). `EQUITY` is a dictionary
// name of CIK 88525 (Guggenheim Funds, formerly Rydex) under S000008805, so
// byNameAll answers it with exactly one series of exactly one registrant and the
// rung's exactness/uniqueness guard is SATISFIED. The already-present
// future-vintage guard does not refuse it either: that decl's DeclDate is
// 20060630, seventeen years BEFORE this filing's period.
//
// CIK 1580843 has no relationship of any kind to CIK 88525 -- no shared sponsor,
// no sibling trust -- so unlike the Claymore and State Farm cases crossCIK's own
// doc comment is written for, this is a bare exact-name corpus-wide collision.
// The filer's own dictionary is six Syntax Stratified ETFs and names no EQUITY
// and no GLOBAL sleeve, so the correct answer for these rows is NO series.
//
// What refuses it is ABANDONMENT, the mirror image of the existing
// future-vintage guard. S000008805's three declared names are `EQUITY`
// (20060630), `Large Cap Core` (20100630) and `Guggenheim StylePlus - Large Core
// Fund` (20130630). The matched name's DeclDate precedes the filing's period,
// but the series stopped answering to `EQUITY` in 2010: by period 20230630 its
// name is `Guggenheim StylePlus - Large Core Fund`, and the heading and the
// matched name no longer coexist any more than BlackRock's 2004 heading
// coexisted with a 2025 declaration (family MISLINK3,
// TestFamilyMislink3BlackRockCrossCIKFutureVintage). S000008807 is the same
// shape one issuer over: `GLOBAL` (20060630) superseded by `Global` (20100630),
// `MSCI EAFE Equal Weight` (20110630), `Guggenheim MSCI EAFE Equal Weight Fund`
// (20130630) and `Guggenheim World Equity Income Fund` (20140630).
//
// layout_broadridge.go:707 records the same abandoned S000008805 name taken on
// 39,356 rows of a DIFFERENT filing (John Hancock Funds II 2016) through a
// different door -- a complete proposal row read as prose and its tail `EQUITY.`
// promoted. That door was closed in the layout, by teaching brVoteRowSlot the
// `Shr`/`ShrHoldr` spellings. This filing is not that shape and not that layout:
// the candidate here is a real ruled banner, wrapped, read by htmltable, and
// three times the row count. Closing one layout's promotion path left the
// resolution rung that accepted the name still open.
//
// Fix in cik_series.go, crossCIK, beside the existing future-vintage guard:
// having matched e.decl for (e.cik, e.decl.SeriesID), scan that same series'
// other dictionary rows under that same CIK for any decl whose DeclDate lies
// strictly AFTER e.decl.DeclDate and at or before the filing's period, and whose
// normalised name DIFFERS from the matched one. Such a decl is the registrant's
// own statement that the matched name was superseded before this filing was
// filed, so the match is refused and the heading stays blank. The existing guard
// refuses a name adopted too LATE; this one refuses a name dropped too EARLY,
// and neither is a widening -- both narrow an exact match that vintage
// contradicts.
func TestFamilyNSCrossCIKAbandonedName(t *testing.T) {
	rows := familyNSCrossCIKAbandonedNameDispatch(t, "syntax_crosscik_abandoned_name.txt", "syntax_dict.tsv", "htmltable", 4)
	for _, r := range rows {
		if r.SeriesID != "S000008805" && r.SeriesID != "S000008807" {
			continue
		}
		t.Errorf("a wrapped issuer banner took an unrelated registrant's series off a name that series had abandoned before the filing's period: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want \"\"", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
	}
}
