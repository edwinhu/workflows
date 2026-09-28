package main

import (
	"path/filepath"
	"testing"
)

// ns914243NoTypeDispatch runs the real dispatch on the family
// NS914243-notype-2008 fixture with this registrant's own dictionary rows
// loaded, and asserts the fixture's own preconditions -- status, layout and row
// count -- so a failure below is an assertion about the section banner's series
// id, never a broken fixture. Same mechanism as ns914243VintageDispatch in
// family_ns914243_vintage_collision_test.go, pointed at its own testdata dir
// and at this registrant's 2008 accession.
func ns914243NoTypeDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	dir := filepath.Join("testdata", "family_ns914243_notype_2008")
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join(dir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("000091/914243/0001144204-08-049597.txt", filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// CIK 0000914243 (Touchstone Funds Group Trust) files
// 000091/914243/0001144204-08-049597.txt (period of report 20080630) as a
// broadridge vote table whose small-cap section is opened, at source line
// 19608, by the banner `TFGT Small Cap` -- the registrant initialism TFGT plus
// the fund stem and NOTHING ELSE. There is no trailing `Fund`, no type word of
// any kind. All 177 rows of that section come out of the production binary with
// a blank series_id.
//
// The fixture is that filing's real bytes, sliced and never edited: the
// SEC-HEADER (including every <SERIES-ID>/<SERIES-NAME> pair of its
// <SERIES-AND-CLASSES-CONTRACTS-DATA> block, source lines 11-229) plus the
// document preamble through the opening <BODY> (lines 230-239), then the
// `TFGT Small Cap` banner's own <PRE> and its first issuer block, AAR CORP.,
// with that block's real ballot -- four DIRECTOR nominees and the KPMG
// ratification, source lines 19606-19631 -- then the filing's own closing tail
// (lines 46894-46900, </PRE> through </SEC-DOCUMENT>). The filing's other fund
// sections are skipped: they already resolve, and the defect is entirely inside
// this one section.
//
// HEAD emits SIX rows from those five printed ballot lines: item 02 comes out
// twice, once with its first line alone and once with the continuation lines
// joined. That is not an artifact of the slice -- a two-issuer fixture of the
// same filing yields 15 rows, six for AAR and nine for ASYST TECHNOLOGIES,
// INC., so the duplicate sits mid-section in the real bytes. It is a separate,
// pre-existing behavior of this vendor arm and is NOT what this test pins; the
// count is asserted at 6 only so that a change to it fails loudly as a
// precondition rather than quietly shifting what the series assertion measures.
//
// This is NOT the vintage collision that family_ns914243_vintage_collision_test.go
// pins. There the banner was the complete `TFGT Small Cap Fund` and reached the
// dictionary intact, only to be refused because one normalized name answered to
// two series ids. Here the banner never reaches a dictionary name at all,
// because it is missing the type word the dictionary name carries.
//
// acronymForBrand (cik_series.go:684) is the rung that should own this heading,
// and it gets halfway: it splits `tfgt small cap` into three tokens, confirms
// via issRegistrantAcronym that `tfgt` spells every token of
// `touchstone funds group trust` in order, strips it, and hands the remainder
// `small cap` to brandPrefixed. brandPrefixed then demands that a dictionary
// brand prefix plus that remainder be a dictionary name of this registrant
// EXACTLY -- it looks up `touchstone small cap` and finds nothing, because
// every name this registrant declares closes on a type word:
//
//	S000005843  TOUCHSTONE SMALL CAP FUND                       DeclDate 20070630
//	S000006456  TOUCHSTONE SMALL CAP VALUE OPPORTUNITIES FUND   DeclDate 20070630
//	                                                            (renamed TOUCHSTONE
//	                                                            SMALL CAP VALUE FUND
//	                                                            at 20110630)
//	S000026601  Touchstone Small Cap Core Fund                  DeclDate 20100630
//	                                                            (renamed Touchstone
//	                                                            Small Cap Fund at
//	                                                            20160630)
//
// So the exact-match fails and the section falls through blank. No other rung
// picks it up: dictInternalTokenDrop and headingLeadingTokenDrop both CUT from
// the printed heading, and this heading is already shorter than the name it
// means; the sibling-registrant rung has no sibling to offer.
//
// The answer this filing means is S000005843. The period of report is 20080630,
// and dictContemporaneous's own rule -- keep the declaration whose DeclDate is
// nearest the filing's period -- puts 20070630 one year away and both other
// candidates eight and two years away respectively; S000006456's name carries
// the extra VALUE/OPPORTUNITIES tokens the banner does not, and S000026601 did
// not exist as `Small Cap` under any spelling until 2016, eight years after this
// filing. The assertion below is therefore the exact id, not merely non-blank: a
// row resolved to S000026601 by some type-word-blind rung would be the 2016
// fund stamped on a 2008 filing, a different bug, not a pass.
func TestFamilyNS914243NoTypeWordAcronym(t *testing.T) {
	const fixture = "touchstone_smallcap_2008.txt"

	const (
		wantIssuer = "AAR CORP."
		wantID     = "S000005843"
	)

	rows := ns914243NoTypeDispatch(t, fixture, "dict.tsv", "broadridge", 6)

	bad := 0
	var first VoteRow
	for _, r := range rows {
		if r.IssuerName != wantIssuer {
			t.Fatalf("fixture precondition: row carries unexpected issuer %q (fund=%q series=%q meeting=%q) -- the issuer capture changed and the assertion below is measuring the wrong thing", r.IssuerName, r.FundName, r.SeriesID, r.MeetingDate)
		}
		if r.SeriesID != wantID {
			if bad == 0 {
				first = r
			}
			bad++
		}
	}
	if bad > 0 {
		t.Errorf("section `TFGT Small Cap` (period 20080630): %d of %d rows carry series=%q, want %s -- the banner supplies the registrant acronym but NO type word, so acronymForBrand strips `tfgt` and brandPrefixed then fails its exact match of `touchstone small cap` against a dictionary that spells `touchstone small cap fund` (first: fund=%q item=%q meeting=%q desc=%q)", bad, len(rows), first.SeriesID, wantID, first.FundName, first.ItemSeq, first.MeetingDate, first.VoteDescription)
	}
}
