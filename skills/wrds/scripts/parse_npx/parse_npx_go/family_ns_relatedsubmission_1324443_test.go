package main

import (
	"path/filepath"
	"testing"
)

// American Independence Funds Trust (CIK 0001324443), period 20080630, filed
// 2008-08-26 as TWO accessions of one logical report. The registrant says so in
// its own bytes, in both files:
//
//	DUE TO SIZE CONSTRAINTS, THIS FILING IS BEING MADE IN 2 RELATED SUBMISSIONS.
//	THIS SUBMISSION IS THE SECOND OF 2 RELATED SUBMISSIONS.
//	THE ACCESSION NUMBER OF THE RELATED SUBMISSION IS AS FOLLOWS:
//	0001324443-08-000065
//
// -- 0001324443-08-000067.txt lines 289-292, and the mirror declaration
// ("THIS SUBMISSION IS THE FIRST OF THE 2 RELATED SUBMISSIONS") at
// 0001324443-08-000065.txt lines 1636974-1636975. The SGML also labels the
// halves: <DESCRIPTION>NPX063008_PART_1 (065 line 276) and
// <DESCRIPTION>NPX063008_PART_2 (067 line 276).
//
// Every fund section in this document opens with a banner rule. Verified on the
// real bytes over ssh wrds, `grep -n '=========='` returns the COMPLETE banner
// list for each file and nothing else:
//
//	065: 345 AMERICAN INDEPENDENCE FINANCIAL SERVICES FUND
//	     6079 AMERICAN INDEPENDENCE INTERNATIONAL EQUITY FUND
//	     54640 AMERICAN INDEPENDENCE STOCK FUND
//	     54642 NESTEGG DOW JONES U.S. 2010
//	     731721 NESTEGG DOW JONES U.S. 2015
//	     1389037 NESTEGG DOW JONES U.S. 2020        <- last banner, 1636985 lines total
//	067: 381601 NESTEGG DOW JONES U.S. 2030
//	     1017755 NESTEGG DOW JONES U.S. 2040
//	     1643957 ========== END NPX REPORT          <- 1644140 lines total
//
// So 065 opens NESTEGG DOW JONES U.S. 2020 at its line 1389037 and never closes
// it: there is no further banner, and no `END NPX REPORT` anywhere in 065
// (`grep -n 'END NPX'` on 065 returns nothing; it appears only in 067). 067 then
// runs 381600 lines of vote body with NO banner at all before its first one.
// Exactly one fund is open at the boundary, so there is nothing to choose
// between.
//
// The split is mid-ISSUER, not merely mid-fund, which is what makes the join
// unambiguous rather than inferred. 065's final lines 1636970-1636972 print an
// identity header with no vote table under it --
//
//	HYSAN DEVELOPMENT CO. LTD.
//	Ticker:
//	Security ID: Y38203124
//
// -- and 067's body opens at line 293 with a bare vote table whose first rows
// are `Meeting Date: MAY 14, 2008` / `Record Date: APR 8, 2008` and the ballot
// `Accept Financial Statements and Statutory Reports`, `Approve Final Dividend
// (with Scrip`, carrying no issuer name and no Security ID of its own. That
// table is the continuation of the HYSAN block begun in 065.
//
// Scale of the defect, measured on the real bytes: in 067, `Security ID` occurs
// 892 times before line 381601, so the unbannered head is the HYSAN
// continuation plus 892 whole issuer/meeting blocks -- 893 blocks, the 8263
// known-registrant no_series rows this CIK contributes.
//
// The carried-forward name is dictionary-resolvable under this same CIK. The
// corpus dictionary row is verbatim:
//
//	0001324443	S000011455	NestEgg Dow Jones U.S. 2020 Fund	20060630	000132/1324443/0000950123-06-011541.txt
//
// and the registrant's series lineup has no 2025 fund -- 2010, 2015, 2020, 2030,
// 2040 are the whole ladder (065/067 SGML lines 85-153), so no intervening
// banner can have been missed.
//
// This is NOT the reverted "most-recently-seen-fund-in-this-file" heuristic
// (closed floor 1064642-streettracks-continuation-banner-misattribution). That
// one guessed among many candidate funds inside one file and was shown to
// misattribute. Here the predecessor FILE is named by the document itself, and
// that named file has exactly one fund open at its end.
//
// FIXTURES, verbatim. Both were cut on the WRDS host and are byte-identical to
// the concatenation of those source ranges; `{ sed -n ...; } | md5sum` on WRDS
// and `md5sum` on the committed file agree:
//
//	part1_0001324443-08-000065.txt  = 065 lines 1-285, 1389031-1389935, 1636969-1636985
//	                                  md5 37cbe41855b7df6de6a75fc4dbe11d0b (1207 lines)
//	part2_0001324443-08-000067.txt  = 067 lines 1-1493, 381590-382448, 1644126-1644140
//	                                  md5 f26a8916d694eccefe392aac9ccb4c74 (2367 lines)
//
// part1 carries the SGML header, the 2020 banner and its first ballot (77 BANK
// LTD., J71348106), then the real trailing HYSAN identity header and the FIRST-OF-2
// footer -- the true open state at the boundary. part2 carries the SGML header,
// the SECOND-OF-2 declaration naming 065, the HYSAN continuation ballot and the
// following blocks, then the 2030 banner with its own ballot as an in-fixture
// control, then the document's real closing declaration. dict.tsv is all 53
// cik_series.tsv rows this CIK carries, copied verbatim.
//
// ON HEAD this fails. The parser has no cross-file state at all: main.go fans
// `-files-from` paths into an unordered worker pool and calls
// processFile(path, ...) once per path, one file -> one manifest row plus its
// own votes, so nothing in 067's parse can know what 065 left open. The 36
// leading rows of part2 come back with fund_name and series_id both blank, and
// their issuer_name is the literal accession string `0001324443-08-000065`
// scavenged from the declaration paragraph. The 27 rows after the 2030 banner
// resolve correctly to S000011456, which is the control: the layout itself is
// fine, only the inherited open banner is missing.
func TestFamilyNSRelatedSubmission1324443ContinuationInheritsPriorFund(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	seriesMap = nil
	var err error
	cikDict, err = loadCIKSeries(filepath.Join("testdata", "family_ns_relatedsubmission_1324443", "dict.tsv"))
	if err != nil {
		t.Fatal(err)
	}

	const (
		dir        = "testdata/family_ns_relatedsubmission_1324443"
		part1      = "part1_0001324443-08-000065.txt"
		part2      = "part2_0001324443-08-000067.txt"
		wantFund   = "NESTEGG DOW JONES U.S. 2020"
		wantSeries = "S000011455" // NestEgg Dow Jones U.S. 2020 Fund, this CIK's own dictionary
		nextFund   = "NESTEGG DOW JONES U.S. 2030"
		nextSeries = "S000011456"
	)

	run := func(name string) ([]VoteRow, FilingMeta) {
		sink := &rowSink{}
		meta := processFile(name, filepath.Join(dir, name), sink, make([]byte, headBytes))
		return sink.buf, meta
	}

	// Precondition, and the whole basis of the claim: the predecessor file's
	// open fund at its final byte is 2020 and nothing else. This half already
	// passes on HEAD -- 065 prints the banner, so its rows resolve.
	rows1, meta1 := run(part1)
	if meta1.ParseStatus != "ok" || meta1.Layout != "htmltable" || meta1.CIK != "0001324443" ||
		meta1.Accession != "0001324443-08-000065" || meta1.PeriodOfReport != "20080630" {
		t.Fatalf("part1 dispatch precondition: cik=%q acc=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta1.CIK, meta1.Accession, meta1.PeriodOfReport, meta1.Layout, meta1.ParseStatus, len(rows1), meta1.ErrorMsg)
	}
	if len(rows1) != 28 {
		t.Fatalf("part1 fixture precondition: got %d rows, want 28 (the 77 BANK LTD. ballot under the 2020 banner)", len(rows1))
	}
	for i, r := range rows1 {
		if r.FundName != wantFund || r.SeriesID != wantSeries {
			t.Fatalf("part1 row %d: fund=%q series=%q, want %q/%q -- the fixture carries exactly one banner, so the fund open at 065's last byte is unambiguous",
				i, r.FundName, r.SeriesID, wantFund, wantSeries)
		}
	}

	rows2, meta2 := run(part2)
	if meta2.ParseStatus != "ok" || meta2.Layout != "htmltable" || meta2.CIK != "0001324443" ||
		meta2.Accession != "0001324443-08-000067" || meta2.PeriodOfReport != "20080630" {
		t.Fatalf("part2 dispatch precondition: cik=%q acc=%q period=%q layout=%q status=%q rows=%d error=%q",
			meta2.CIK, meta2.Accession, meta2.PeriodOfReport, meta2.Layout, meta2.ParseStatus, len(rows2), meta2.ErrorMsg)
	}
	if len(rows2) != 63 {
		t.Fatalf("part2 fixture precondition: got %d rows, want 63 (36 continuation rows, then 27 under the 2030 banner)", len(rows2))
	}

	// The control half: everything from the 2030 banner onward already resolves,
	// so the layout reads this document correctly. Only the inherited banner is
	// missing.
	split := -1
	for i, r := range rows2 {
		if r.FundName == nextFund {
			split = i
			break
		}
	}
	if split != 36 {
		t.Fatalf("part2 fixture precondition: first %q row at index %d, want 36", nextFund, split)
	}
	for i := split; i < len(rows2); i++ {
		if rows2[i].SeriesID != nextSeries {
			t.Fatalf("part2 control row %d: fund=%q series=%q, want %q -- the post-banner half must already resolve, or this fixture is not isolating the continuation",
				i, rows2[i].FundName, rows2[i].SeriesID, nextSeries)
		}
	}

	// The defect. These 36 rows are the tail of the NestEgg Dow Jones U.S. 2020
	// section opened in 0001324443-08-000065, the accession 067 names in its own
	// first four body paragraphs.
	for i := 0; i < split; i++ {
		r := rows2[i]
		if r.SeriesID != wantSeries {
			t.Errorf("part2 row %d (issuer=%q cusip=%q date=%q item=%q desc=%q): fund=%q series=%q, want fund %q series %q -- 067 declares itself \"THE SECOND OF 2 RELATED SUBMISSIONS\" of accession 0001324443-08-000065, whose last banner (065 line 1389037) opens %q and never closes it",
				i, r.IssuerName, r.CUSIP, r.MeetingDate, r.ItemSeq, r.VoteDescription,
				r.FundName, r.SeriesID, wantFund, wantSeries, wantFund)
			break
		}
	}

	// The same miss shows up as a second, independently visible symptom: with no
	// issuer header of its own, the continuation block scavenges the declaration
	// paragraph and files these votes under the predecessor's accession number as
	// if it were a company name.
	if rows2[0].IssuerName == "0001324443-08-000065" {
		t.Errorf("part2 row 0: issuer_name=%q -- the prior accession number is being read as an issuer; these rows continue HYSAN DEVELOPMENT CO. LTD. (Security ID Y38203124), whose identity header is the last thing 065 prints (065 lines 1636970-1636972)",
			rows2[0].IssuerName)
	}
}
