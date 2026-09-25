package main

import (
	"path/filepath"
	"testing"
)

// ns909504Dispatch runs the real dispatch on a family NS909504 fixture
// with the named dictionary rows loaded, and asserts the fixture's own
// preconditions -- status, layout and row count -- so a failure below is an
// assertion about the series id and never a broken fixture. Same mechanism as
// familyNS12Dispatch in family_ns12_test.go, pointed at its own testdata dir.
func ns909504Dispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns909504", dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_ns909504", fixture), sink, make([]byte, headBytes))
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

// CIK 0000909504 (GAMCO/Gabelli Global Series Funds, Inc.) declares four series
// and its ProxyEdge text reports name the paying account with a HOUSE
// ABBREVIATION rather than the declared name. Family NS12 closed two of the
// four (commit 78efe67d: strip the leading `NPX` report-type token, which
// reaches GLOBAL GROWTH and GLB OPPORTUNITY). The red tests below cut the same
// registrant's TELECOM, CONVERTIBLE and 2006 OPPORTUNITY pages, which that fix
// does not reach.
//
// The four declared series, verbatim from every filing's own header:
//
//	S000001064  GABELLI GLOBAL CONVERTIBLE SECURITIES FUND
//	S000001065  GABELLI GLOBAL GROWTH FUND
//	S000001066  GABELLI GLOBAL OPPORTUNITY FUND
//	S000001067  GABELLI GLOBAL TELECOMMUNICATIONS FUND
//
// All four fixtures declare ALL FOUR series in their trimmed header, so no
// abbreviation below is made unambiguous by a fixture that hid its siblings.
//
// The two account-line spellings this registrant prints, both measured over the
// real filing bytes at /wrds/sec/archives/000090/909504/ (period >= 20060101):
//
//	0000935069-07-001916 and 0000935069-08-001961 (NPX-prefixed, ProxyEdge 2007/2008)
//	    Selected Accounts: NPX GABELLI GLB TELECOM FD
//	    Selected Accounts: NPX GAB GLB CONVERTIBLE SEC FD
//	0000935069-06-002240 (GRP-suffixed, the 2006 vintage of the same report)
//	    Selected Accounts: GLOBAL TELECOMM FUND GRP
//	    Selected Accounts: GLOBAL CONVERT SECS FND GRP
//
// Measured on HEAD through the dispatch below, the two vintages do NOT behave
// alike, and neither is uniform inside itself. Most of the GRP-suffixed 2006
// spellings already resolve through the existing per-word abbreviation rungs
// (issVowelDroppedAbbrev / issDeclaredAbbrevWord at layout_issnpx.go:3197-3200),
// and are pinned as such further down.
//
// The open set, measured by running HEAD over all three FULL filings (not the
// fixtures) with -cik-series and tallying blank series_id by account line. The
// three blank totals reproduce the corpus census exactly -- 726 / 1053 / 1236:
//
//	2242  NPX GABELLI GLB TELECOM FD        blank  (1046 in 2007 + 1196 in 2008)
//	  47  NPX GAB GLB CONVERTIBLE SEC FD    blank  (7 in 2007 + 40 in 2008)
//	 726  GABELLI GLOBAL OPP FUND GRP       blank  (2006; the whole filing's blanks)
//	----
//	3015  = the family's known-registrant no_series row count
//
// and the closed set, for contrast:
//
//	GLOBAL TELECOMM FUND GRP -> S000001067      GLOBAL GROWTH FUND GRP -> S000001065
//	GLOBAL CONVERT SECS FND GRP -> S000001064   NPX GABELLI GLOBAL GROWTH FD -> S000001065
//	NPX GABELLI GLB OPPORTUNITY FD -> S000001066
//
// So the split is NOT vintage-shaped. `NPX GABELLI GLB OPPORTUNITY FD` resolves
// while its own 2006 predecessor `GABELLI GLOBAL OPP FUND GRP` does not, and
// `GLOBAL TELECOMM FUND GRP` resolves while its 2007/2008 successor does not.
// Three account spellings stay open, each pinned red below; `GLB TELECOM`,
// `GAB GLB CONVERTIBLE SEC` and `GLOBAL OPP` are the vendor abbreviations the
// chain does not reach, the same sub-floor family_ns12_test.go names in its own
// comment.

// 000090/909504/0000935069-08-001961.txt: verbatim source lines 11-28, 53-58,
// 81-84, 110-113, 137-140, 166-174 and 14789-14870, with one `</SERIES>`
// inserted after each of the four cut series blocks and the document's own
// closing tags appended. Dispatches to `splittable` (the precondition asserts
// it).
//
// Source line 14793 verbatim:
//
//	Selected Accounts: NPX GABELLI GLB TELECOM FD                      Page 1 of 102
//
// The registrant declares the fund in this filing's own header (source lines
// 139-140 verbatim: `<SERIES-ID>S000001067` / `<SERIES-NAME>GABELLI GLOBAL
// TELECOMMUNICATIONS FUND`). `TELECOM` is a prefix of the declared
// `TELECOMMUNICATIONS` and no other series this registrant declares shares that
// stem, so the abbreviation is unambiguous against the registrant's own
// vocabulary -- no cross-registrant guess and no rename inference.
func TestNS909504GamcoNPXTelecomAbbrevBlocksResolution(t *testing.T) {
	rows := ns909504Dispatch(t, "gamco_npx_telecom_abbrev_unresolved.txt", "gamco_dict.tsv", "splittable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000001067" {
			t.Errorf("the GLB TELECOM abbreviation blocked the declared Gabelli Global Telecommunications Fund: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000001067", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000090/909504/0000935069-08-001961.txt: verbatim source lines 11-28, 53-58,
// 81-84, 110-113, 137-140, 166-174 and 225-257, with one `</SERIES>` inserted
// after each of the four cut series blocks and the document's own closing tags
// appended. Dispatches to `splittable` (the precondition asserts it).
//
// Source line 233 verbatim (this page prints no trailing `Page n of m` on the
// account line; the page number sits on the line above):
//
//	Selected Accounts: NPX GAB GLB CONVERTIBLE SEC FD
//
// The registrant declares the fund in this filing's own header (source lines
// 57-58 verbatim: `<SERIES-ID>S000001064` / `<SERIES-NAME>GABELLI GLOBAL
// CONVERTIBLE SECURITIES FUND`). `CONVERTIBLE SEC` abbreviates the declared
// `CONVERTIBLE SECURITIES` and no other series this registrant declares shares
// that stem.
func TestNS909504GamcoNPXConvertibleAbbrevBlocksResolution(t *testing.T) {
	rows := ns909504Dispatch(t, "gamco_npx_convertible_abbrev_unresolved.txt", "gamco_dict.tsv", "splittable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000001064" {
			t.Errorf("the GAB GLB CONVERTIBLE SEC abbreviation blocked the declared Gabelli Global Convertible Securities Fund: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000001064", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000090/909504/0000935069-06-002240.txt: verbatim source lines 11-28, 50-55,
// 78-81, 107-110, 134-137, 163-171 and 222-266, with one `</SERIES>` inserted
// after each of the four cut series blocks and the document's own closing tags
// appended. Dispatches to `splittable` (the precondition asserts it).
//
// Source line 233 verbatim:
//
//	Selected Accounts: GLOBAL TELECOMM FUND GRP                        Page 1 of 103
//
// This one PASSES on HEAD and is pinned rather than left red: the 2006 vintage
// of the abbreviation already resolves. It is not the page heading doing it --
// the fixture's source range carries line 228, `THE GAMCO GLOBAL
// TELECOMMUNICATIONS FUND`, and deleting that line from the fixture leaves the
// three rows still stamped S000001067 (measured). The account name itself is
// what resolves, through the per-word abbreviation rungs. Keeping the case
// records that this half of the registrant's grammar is CLOSED, so a future fix
// for the NPX-prefixed half is measured against it rather than credited with it.
func TestNS909504GamcoGRPTelecomAbbrevAlreadyResolves(t *testing.T) {
	rows := ns909504Dispatch(t, "gamco_grp_telecom_abbrev_unresolved.txt", "gamco_dict.tsv", "splittable", 3)
	for _, r := range rows {
		if r.SeriesID != "S000001067" {
			t.Errorf("the GLOBAL TELECOMM FUND GRP account name stopped resolving to the declared Gabelli Global Telecommunications Fund: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000001067", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000090/909504/0000935069-06-002240.txt: verbatim source lines 11-28, 50-55,
// 78-81, 107-110, 134-137, 163-171, 27022-27052 and 27081-27088, with one
// `</SERIES>` inserted after each of the four cut series blocks and the
// document's own closing tags appended. The second body range skips the middle
// of the page's one long non-voting note. Dispatches to `splittable` (the
// precondition asserts it).
//
// Source line 27027 verbatim:
//
//	Selected Accounts: GLOBAL CONVERT SECS FND GRP                       Page 1 of 1
//
// Passes on HEAD for the same reason as the telecom case above, and pinned for
// the same reason.
func TestNS909504GamcoGRPConvertibleAbbrevAlreadyResolves(t *testing.T) {
	rows := ns909504Dispatch(t, "gamco_grp_convertible_abbrev_unresolved.txt", "gamco_dict.tsv", "splittable", 2)
	for _, r := range rows {
		if r.SeriesID != "S000001064" {
			t.Errorf("the GLOBAL CONVERT SECS FND GRP account name stopped resolving to the declared Gabelli Global Convertible Securities Fund: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000001064", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}

// 000090/909504/0000935069-06-002240.txt: verbatim source lines 11-28, 50-55,
// 78-81, 107-110, 134-137, 163-171 and 22010-22101, with one `</SERIES>`
// inserted after each of the four cut series blocks and the document's own
// closing tags appended. Dispatches to `splittable` (the precondition asserts
// it).
//
// Source line 22016 verbatim:
//
//	Selected Accounts: GABELLI GLOBAL OPP FUND GRP                      Page 1 of 57
//
// The registrant declares the fund in this filing's own header (source lines
// 107-110 verbatim: `<SERIES-ID>S000001066` / `<SERIES-NAME>GABELLI GLOBAL
// OPPORTUNITY FUND`). `OPP` is a prefix of the declared `OPPORTUNITY` and no
// other series this registrant declares shares that stem, so the abbreviation
// is unambiguous against the registrant's own vocabulary.
//
// This case is the one the vintage story above would have predicted PASSES and
// which in fact fails: it is a GRP-suffixed 2006 account line, whose three
// siblings in the same filing all resolve, and it is 726 blank rows -- every
// blank row the 2006 filing has. The page above the banner reprints
// `THE GAMCO GLOBAL OPPORTUNITY FUND` (source line 22011 verbatim), which is
// the dictionary's own 20110630 spelling for S000001066, and the heading does
// not rescue it either.
func TestNS909504GamcoGRPOpportunityAbbrevBlocksResolution(t *testing.T) {
	rows := ns909504Dispatch(t, "gamco_grp_opportunity_abbrev_unresolved.txt", "gamco_dict.tsv", "splittable", 11)
	for _, r := range rows {
		if r.SeriesID != "S000001066" {
			t.Errorf("the GLOBAL OPP FUND GRP abbreviation blocked the declared Gabelli Global Opportunity Fund: fund=%q issuer=%q cusip=%q item=%q desc=%.40q series=%q want S000001066", r.FundName, r.IssuerName, r.CUSIP, r.ItemSeq, r.VoteDescription, r.SeriesID)
		}
	}
}
