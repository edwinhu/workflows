package main

import (
	"path/filepath"
	"testing"
)

// ns914243VintageDispatch runs the real dispatch on the family
// NS914243-vintage-collision fixture with this registrant's own dictionary rows
// loaded, and asserts the fixture's own preconditions -- status, layout and row
// count -- so a failure below is an assertion about the section banner's series
// id, never a broken fixture. Same mechanism as ns931491CorpSuffixDispatch in
// family_ns931491_corpsuffix_gap_test.go, pointed at its own testdata dir.
func ns914243VintageDispatch(t *testing.T, fixture, dict, layout string, count int) []VoteRow {
	t.Helper()
	dir := filepath.Join("testdata", "family_ns914243_vintage_collision")
	oldDict, oldMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = oldDict, oldMap })
	var err error
	cikDict, err = loadCIKSeries(filepath.Join(dir, dict))
	if err != nil {
		t.Fatal(err)
	}
	seriesMap = nil
	sink := &rowSink{}
	meta := processFile("000091/914243/0001144204-17-045152.txt", filepath.Join(dir, fixture), sink, make([]byte, headBytes))
	if meta.ParseStatus != "ok" || meta.Layout != layout || len(sink.buf) != count {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d want=%d error=%s", meta.ParseStatus, meta.Layout, len(sink.buf), count, meta.ErrorMsg)
	}
	return sink.buf
}

// CIK 0000914243 (Touchstone Funds Group Trust) files
// 000091/914243/0001144204-17-045152.txt (period of report 20170630) as a
// broadridge vote table whose every fund section is opened by a banner built
// from the registrant initialism TFGT plus the fund stem -- `TFGT Mid Cap
// Fund`, `TFGT Sands Capital Select Growth Fund`, `TFGT Small Cap Fund`. Every
// one of those resolves on the production binary EXCEPT the last, whose 285
// rows all come out with a blank series_id.
//
// The fixture is that filing's real bytes, sliced and never edited: the
// SEC-HEADER (including its <SERIES-AND-CLASSES-CONTRACTS-DATA> block) plus the
// document preamble through the opening <pre> (source lines 1-493), then the
// `TFGT Small Cap Fund` banner and its first issuer block, ALEXANDER & BALDWIN,
// INC., with that block's five real vote rows -- three DIRECTOR rows and two
// further proposals, source lines 11805-11831 -- then
// the filing's own closing tail. The filing's other fund sections are skipped:
// they already resolve, and the defect is entirely inside this one section.
//
// The defect is NOT the banner. `TFGT Small Cap Fund` reaches the dictionary the
// same way its siblings do; what fails is the dictionary lookup itself, because
// this CIK declares TWO different series under the same normalized name
// `touchstone small cap fund` at two different vintages:
//
//	S000005843  TOUCHSTONE SMALL CAP FUND     DeclDate 20070630
//	S000026601  Touchstone Small Cap Fund     DeclDate 20160630
//	                                          (renamed from `Touchstone Small
//	                                          Cap Core Fund`, decl 20100630)
//
// Neither id is in THIS filing's own header, so the heading can only be reached
// through the registrant's dictionary -- and seriesByName, seeing one normalized
// name mapped to two series ids, refuses it by mapping the name to nil. That
// refusal is correct in general and wrong here, because the ambiguity is a
// vintage collision that the filing's period already breaks: 20170630 is
// nearest the 20160630 declaration, so S000026601 is the fund this 2017 filing
// means.
//
// cik_series.go already carries the resolver for exactly this collision.
// dictContemporaneous (cik_series.go:367) keeps only the declaration whose
// DeclDate is nearest the filing's period; its own doc comment cites CIK 1217286
// `JPMorgan Market Neutral Fund`, declared for two different series eight years
// apart, as the precedent. But it is invoked only inside cikSeries.poolFor,
// which backs cikSeries.back -- the path for a filing whose header declares
// NOTHING. The other reader of the same per-CIK rows, cikSeries.exactFallback
// (cik_series.go:461), builds its `extra` list straight from d.byCIK[meta.CIK]
// and hands it to seriesByName without ever calling dictContemporaneous. This
// filing's header declares plenty, just not this series, so it takes that second
// path and gets the refusal instead of the resolution.
//
// Every row of the block is therefore blank on HEAD, and the assertion below is
// the exact id, not merely non-blank: a wrong id resolved by some other rung
// would be a different bug, not a pass.
func TestFamilyNS914243VintageCollision(t *testing.T) {
	const fixture = "touchstone_smallcap_2017.txt"

	const (
		wantIssuer = "ALEXANDER & BALDWIN, INC."
		wantID     = "S000026601"
	)

	rows := ns914243VintageDispatch(t, fixture, "dict.tsv", "broadridge", 5)

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
		t.Errorf("section `TFGT Small Cap Fund` (period 20170630): %d of %d rows carry series=%q, want %s -- the same-name/two-vintage dictionary collision is resolved by dictContemporaneous on the poolFor path and not on the exactFallback path (first: fund=%q item=%q meeting=%q desc=%q)", bad, len(rows), first.SeriesID, wantID, first.FundName, first.ItemSeq, first.MeetingDate, first.VoteDescription)
	}
}
