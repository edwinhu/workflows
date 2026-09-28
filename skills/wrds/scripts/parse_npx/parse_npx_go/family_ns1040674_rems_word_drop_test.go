package main

import (
	"path/filepath"
	"testing"
)

const ns1040674REMSDir = "family_ns1040674_rems_word_drop"

// WORLD FUNDS INC /MD/, CIK 1040674, filings 000104/1040674/0001209286-13-000352.txt
// (period 20130630) and 000104/1040674/0001209286-14-000485.txt (period 20140630),
// both `htmltable`. Each filing declares exactly two series in its own
// SERIES-AND-CLASSES-CONTRACTS-DATA block:
//
//	S000008412  REMS Real Estate Income 50/50 Fund      (2013 fixture line 46, 2014 fixture line 46)
//	S000008421  REMS Real Estate Value Opportunity Fund (2013 fixture line 68, 2014 fixture line 61)
//
// THE FILING'S SHAPE. Each fund section opens with a free-standing bold fund-name
// line, then the security-identity table, then one <TABLE> of vote rows. Every
// single body banner in BOTH filings prints the name with the word `Income`
// dropped:
//
//	2013, fixture line 120: <p><font face="Arial" size="2"><b>REMS Real Estate 50/50 Fund</b></font></p>
//	2014, fixture line 108: <div><font face="Arial" size="2"><b>REMS Real Estate 50/50 Fund</b></font></div>
//
// The two vintages differ only in the wrapper element (<p> vs <div>), which is why
// both are fixtured: a fix must read the banner text, not one vendor's tag.
// `REMS Real Estate 50/50 Fund` is not the declared name, and it is not any
// dictionary vintage for this CIK at any period either -- the corpus dictionary
// carries sixteen (id, name, vintage) rows for CIK 0001040674, installed verbatim
// below, and none of them spells the banner.
//
// THE DEFECT. Every masthead rung in the htmltable layout resolves a banner by
// matching its text against the registrant's declared names -- exactly, or after
// normalisation that folds punctuation, case and known caption words. None of them
// tolerates a whole dropped word inside the fund name, so the banner resolves
// against nothing and opens no section. In the real accessions that leaves 175 rows
// (2013) and 55 rows (2014) with a blank series_id -- 230 rows, this CIK's entire
// known-registrant no-series residue.
//
// MEASURED ON HEAD over these fixtures, with the dictionary installed below:
// status=ok layout=htmltable for both, rows=7 (2013) and rows=6 (2014), and every
// row of both carries series_id="" and fund_name="".
//
// Which id the banner names is not a guess. Dropping `Income` from
// `REMS Real Estate Income 50/50 Fund` yields the banner exactly; the sibling
// declared series is `REMS Real Estate Value Opportunity Fund`, which shares the
// `REMS Real Estate` stem but differs by whole words after it and carries no
// `50/50`, and no other name in this CIK's dictionary contains `50/50` at all. So
// exactly one declared name of the filing's own header reduces to the banner by
// dropping one interior word -- an elimination, not a guess. Equally, a fix must be
// a WITHIN-FILING declared-name match: both filings happen to declare the same two
// series, so nothing here licenses a blind global `50/50` -> S000008412 rename, and
// the assertion is written against each filing's own header.
//
// FIXTURE PROVENANCE. Both fixtures are real SEC EDGAR bytes, verbatim and in file
// order, trimmed to whole <TABLE>/<TR> units:
//
//	rems_word_drop_2013.txt = real lines 1-87 (SEC-HEADER in full with both series
//	declarations unrenumbered, plus <DOCUMENT>/<TYPE>/<SEQUENCE>/<FILENAME>/<TEXT>)
//	+ real lines 230-614 (the page-header table, the banner at real line 262, the
//	AGREE REALTY CORPORATION identity table and its whole vote table) + the real
//	filing's own closing </TEXT></DOCUMENT></SEC-DOCUMENT>.
//
//	rems_word_drop_2014.txt = real lines 1-80 (same, through <TEXT><html><body>)
//	+ real lines 230-527 (page-header table, the banner at real line 257, the AGREE
//	REALTY CORPORATION identity table and its whole vote table) + the real filing's
//	own closing </body></html></TEXT></DOCUMENT></SEC-DOCUMENT> (real lines
//	34363-34367).
//
// Verified byte-for-byte against /wrds/sec/archives over ssh. No row was
// fabricated, edited or reworded.
//
// The dictionary installed below is this CIK's real cik_series.tsv content, all
// sixteen rows, so the assertion does not depend on the filing header alone and the
// unambiguity claim is made against the full candidate set.
//
// No production code is changed here.
func TestFamilyNS1040674REMSWordDrop(t *testing.T) {
	savedDict, savedMap := cikDict, seriesMap
	t.Cleanup(func() { cikDict, seriesMap = savedDict, savedMap })
	cikDict = &cikSeries{byCIK: map[string][]SeriesDecl{"0001040674": {
		{SeriesID: "S000008412", Name: "CSI Equity Fund", DeclDate: "20060630"},
		{SeriesID: "S000008412", Name: "REMS Real Estate Income 50/50 Fund", DeclDate: "20100630"},
		{SeriesID: "S000008413", Name: "Epoch Global Equity Shareholder Yield Fund", DeclDate: "20060630"},
		{SeriesID: "S000008414", Name: "New Market Fund", DeclDate: "20060630"},
		{SeriesID: "S000008415", Name: "Third Millennium Russia Fund", DeclDate: "20060630"},
		{SeriesID: "S000008416", Name: "GenomicsFund", DeclDate: "20060630"},
		{SeriesID: "S000008416", Name: "Satuit Capital Management Small Cap Fund", DeclDate: "20070630"},
		{SeriesID: "S000008417", Name: "Epoch International Small Cap Fund", DeclDate: "20060630"},
		{SeriesID: "S000008418", Name: "Eastern European Equity Fund", DeclDate: "20060630"},
		{SeriesID: "S000008418", Name: "European Equity Fund", DeclDate: "20120630"},
		{SeriesID: "S000008419", Name: "Dividend Capital Realty Income Fund", DeclDate: "20060630"},
		{SeriesID: "S000008420", Name: "Epoch U.S. All Cap Equity Fund", DeclDate: "20060630"},
		{SeriesID: "S000008421", Name: "REMS Real Estate Value Opportunity Fund", DeclDate: "20060630"},
		{SeriesID: "S000014247", Name: "Osprey Concentrated Large Cap Value Equity Fund", DeclDate: "20060630"},
		{SeriesID: "S000020337", Name: "The Exceptionator Fund", DeclDate: "20080630"},
		{SeriesID: "S000024249", Name: "Epoch U.S. Large Cap Equity Fund", DeclDate: "20090630"},
	}}}
	seriesMap = nil

	const (
		income5050   = "S000008412"
		declaredName = "REMS Real Estate Income 50/50 Fund"
		printedName  = "REMS Real Estate 50/50 Fund"
	)

	cases := []struct {
		fixture    string
		bannerLine int
		wantRows   int
		meetDate   string
		// wantItems is asserted only where HEAD already reads the item text
		// whole. The 2014 vintage truncates wrapped proposal cells for an
		// unrelated reason, so that vintage asserts identity on issuer, CUSIP
		// and meeting date only rather than baking a truncated string in as
		// expected.
		wantItems []string
	}{
		{
			fixture:    "rems_word_drop_2013.txt",
			bannerLine: 120,
			wantRows:   7,
			meetDate:   "20130506",
			wantItems: []string{
				"DIRECTOR",
				"JOEY AGREE",
				"LEON M. SCHURGIN",
				"WILLIAM S. RUBENFAER",
				"TO RATIFY THE APPOINTMENT OF GRANT THORNTON LLP AS THE COMPANY’S INDEPENDENT REGISTERED PUBLIC ACCOUNTING FIRM FOR 2013.",
				"TO APPROVE, BY NON-BINDING VOTE, EXECUTIVE COMPENSATION.",
				"TO APPROVE AN AMENDMENT TO THE COMPANY’S CHARTER TO INCREASE THE NUMBER AUTHORIZED SHARES.",
			},
		},
		{
			fixture:    "rems_word_drop_2014.txt",
			bannerLine: 108,
			wantRows:   6,
			meetDate:   "20140505",
		},
	}

	for _, tc := range cases {
		t.Run(tc.fixture, func(t *testing.T) {
			sink := &rowSink{}
			meta := processFile(tc.fixture, filepath.Join("testdata", ns1040674REMSDir, tc.fixture), sink, make([]byte, headBytes))
			rows := sink.buf
			if meta.ParseStatus != "ok" || meta.Layout != "htmltable" || meta.CIK != "0001040674" {
				t.Fatalf("fixture/dispatch precondition: status=%s layout=%s CIK=%s want status=ok layout=htmltable CIK=0001040674 error=%s", meta.ParseStatus, meta.Layout, meta.CIK, meta.ErrorMsg)
			}
			if len(rows) != tc.wantRows {
				t.Fatalf("fixture precondition: %d rows, want %d (the AGREE REALTY CORPORATION vote rows under the banner at fixture line %d)", len(rows), tc.wantRows, tc.bannerLine)
			}

			// Identity regression guard, checked FIRST: issuer, CUSIP and
			// meeting date all read correctly on HEAD. Only fund_name and
			// series_id are wrong, and a fix that recovers the series by
			// disturbing any of these has traded one defect for another.
			for i, r := range rows {
				if r.IssuerName != "AGREE REALTY CORPORATION" || r.CUSIP != "008492100" || r.MeetingDate != tc.meetDate {
					t.Errorf("row %d identity regressed: issuer=%q cusip=%q date=%q want issuer=%q cusip=008492100 date=%s", i, r.IssuerName, r.CUSIP, r.MeetingDate, "AGREE REALTY CORPORATION", tc.meetDate)
				}
				if tc.wantItems != nil && r.VoteDescription != tc.wantItems[i] {
					t.Errorf("row %d vote description regressed: %q want %q", i, r.VoteDescription, tc.wantItems[i])
				}
			}

			// The claim. Every row under the banner at fixture line
			// tc.bannerLine belongs to S000008412 and carries the fund's
			// declared name. The banner prints `REMS Real Estate 50/50 Fund`
			// -- the word `Income` dropped -- which no existing masthead rung
			// tolerates, so on HEAD these rows carry a blank series_id and no
			// section is opened at all.
			for i, r := range rows {
				if r.SeriesID != income5050 {
					t.Errorf("row %d (%s item=%q cusip=%q date=%q): series=%q fund=%q want %s -- this row sits under the banner at fixture line %d, printed %q with the word `Income` dropped by the filing agent; this filing's own header declares %q = %s (fixture line 46), the sibling declared series is `REMS Real Estate Value Opportunity Fund` and no other name in this CIK's sixteen-row dictionary contains `50/50`, so exactly one declared name reduces to the printed text by dropping one interior word",
						i, r.IssuerName, r.ItemSeq, r.CUSIP, r.MeetingDate, r.SeriesID, r.FundName, income5050, tc.bannerLine, printedName, declaredName, income5050)
				}
				if r.FundName != declaredName {
					t.Errorf("row %d (%s item=%q): fund_name=%q want %q -- the dropped word must be restored to the registrant's declared spelling, not stored as printed and not left blank",
						i, r.IssuerName, r.ItemSeq, r.FundName, declaredName)
				}
			}
		})
	}
}
