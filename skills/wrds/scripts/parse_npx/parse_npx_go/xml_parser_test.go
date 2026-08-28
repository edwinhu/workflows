package main

import (
	"regexp"
	"strings"
	"testing"
)

const npxPrimaryDoc = `<DOCUMENT>
<TYPE>N-PX
<SEQUENCE>1
<FILENAME>primary_doc.xml
<TEXT>
<XML>
<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission>
<headerData>
<filerInfo>
<periodOfReport>2025-06-30</periodOfReport>
</filerInfo>
<seriesClass>
<seriesId>S000002841</seriesId>
<classId>C000007786</classId>
</seriesClass>
</headerData>
</edgarSubmission>
</XML>
</TEXT>
</DOCUMENT>
`

const npxVoteDoc = `<DOCUMENT>
<TYPE>PROXY VOTING RECORD
<SEQUENCE>2
<FILENAME>vote.xml
<TEXT>
<XML>
<?xml version="1.0" encoding="UTF-8"?>
<proxyVoteTable>
<proxyTable>
<issuerName>APPLE INC.</issuerName>
<cusip>037833100</cusip>
<isin>US0378331005</isin>
<figi>BBG000B9XRY4</figi>
<meetingDate>02/28/2025</meetingDate>
<voteDescription>Elect Director Tim Cook</voteDescription>
<voteCategories>
<voteCategory><categoryType>DIRECTOR_ELECTION</categoryType></voteCategory>
<voteCategory><categoryType>OTHER</categoryType></voteCategory>
</voteCategories>
<otherVoteDescription>Slate item</otherVoteDescription>
<voteSource>MANAGEMENT</voteSource>
<sharesVoted>1000</sharesVoted>
<sharesOnLoan>25</sharesOnLoan>
<vote>
<voteRecord><howVoted>FOR</howVoted><sharesVoted>600</sharesVoted><managementRecommendation>FOR</managementRecommendation></voteRecord>
<voteRecord><howVoted>AGAINST</howVoted><sharesVoted>300</sharesVoted><managementRecommendation>FOR</managementRecommendation></voteRecord>
<voteRecord><howVoted>ABSTAIN</howVoted><sharesVoted>100</sharesVoted><managementRecommendation>FOR</managementRecommendation></voteRecord>
</vote>
<voteManager><otherManagers><otherManager>1</otherManager><otherManager>2</otherManager></otherManagers></voteManager>
<voteSeries>S000002841</voteSeries>
</proxyTable>
<proxyTable>
<issuerName>MICROSOFT CORP</issuerName>
<cusip>594918104</cusip>
<meetingDate>12/05/2024</meetingDate>
<voteDescription>Ratify Auditors</voteDescription>
<voteCategories>
<voteCategory><categoryType>AUDIT_RELATED</categoryType></voteCategory>
</voteCategories>
<sharesVoted>500</sharesVoted>
<sharesOnLoan>0</sharesOnLoan>
<vote>
<voteRecord><howVoted>FOR</howVoted><sharesVoted>500</sharesVoted><managementRecommendation>FOR</managementRecommendation></voteRecord>
</vote>
<voteSeries>S000002841</voteSeries>
<voteOtherInfo>N/A</voteOtherInfo>
</proxyTable>
</proxyVoteTable>
</XML>
</TEXT>
</DOCUMENT>
`

const npxSGMLHead = "<SEC-DOCUMENT>0001104659-25-083794.txt : 20250630\n" +
	"<SEC-HEADER>0001104659-25-083794.hdr.sgml : 20250630\n" +
	"ACCESSION NUMBER:\t\t0001104659-25-083794\n" +
	"CONFORMED SUBMISSION TYPE:\tN-PX\n" +
	"</SEC-HEADER>\n"

// lowerTagRe matches XML element tags, which start with a lowercase letter.
// SGML dissemination pseudo-tags (DOCUMENT, TYPE, TEXT, XML) are uppercase and
// are deliberately left alone.
var lowerTagRe = regexp.MustCompile(`<(/?)([a-z][A-Za-z0-9]*)>`)

func withNamespacePrefix(doc string) string {
	out := lowerTagRe.ReplaceAllString(doc, "<${1}ns1:${2}>")
	out = strings.Replace(out, "<ns1:proxyVoteTable>",
		`<ns1:proxyVoteTable xmlns:ns1="http://www.sec.gov/edgar/npx">`, 1)
	out = strings.Replace(out, "<ns1:edgarSubmission>",
		`<ns1:edgarSubmission xmlns:ns1="http://www.sec.gov/edgar/npx">`, 1)
	return out
}

func collectXML(t *testing.T, doc string) ([]VoteRow, FilingMeta) {
	t.Helper()
	var rows []VoteRow
	meta := FilingMeta{FilePath: "edgar/data/36405/x.txt"}
	n, err := parseNPXXML(strings.NewReader(doc), &meta, func(r VoteRow) error {
		rows = append(rows, r)
		return nil
	})
	if err != nil {
		t.Fatalf("parseNPXXML: %v", err)
	}
	if n != len(rows) {
		t.Fatalf("parseNPXXML returned count %d but emitted %d rows", n, len(rows))
	}
	return rows, meta
}

func assertNPXRows(t *testing.T, rows []VoteRow) {
	t.Helper()
	if len(rows) != 4 {
		t.Fatalf("got %d rows, want 4 (one per voteRecord)", len(rows))
	}

	for i, r := range rows[:3] {
		if r.IssuerName != "APPLE INC." {
			t.Errorf("row %d IssuerName = %q, want %q", i, r.IssuerName, "APPLE INC.")
		}
		if r.CUSIP != "037833100" {
			t.Errorf("row %d CUSIP = %q, want %q", i, r.CUSIP, "037833100")
		}
		if r.ISIN != "US0378331005" {
			t.Errorf("row %d ISIN = %q", i, r.ISIN)
		}
		if r.FIGI != "BBG000B9XRY4" {
			t.Errorf("row %d FIGI = %q", i, r.FIGI)
		}
		if r.VoteCategories != "DIRECTOR_ELECTION"+MultiValueSep+"OTHER" {
			t.Errorf("row %d VoteCategories = %q, want the two categories joined with %q",
				i, r.VoteCategories, MultiValueSep)
		}
		if r.OtherVoteDescription != "Slate item" {
			t.Errorf("row %d OtherVoteDescription = %q", i, r.OtherVoteDescription)
		}
		if r.VoteSource != "MANAGEMENT" {
			t.Errorf("row %d VoteSource = %q", i, r.VoteSource)
		}
		if r.SharesVotedTotal != "1000" {
			t.Errorf("row %d SharesVotedTotal = %q, want the record-level sharesVoted 1000", i, r.SharesVotedTotal)
		}
		if r.SharesOnLoan != "25" {
			t.Errorf("row %d SharesOnLoan = %q, want 25 carried onto every row", i, r.SharesOnLoan)
		}
		if r.OtherManagers != "1"+MultiValueSep+"2" {
			t.Errorf("row %d OtherManagers = %q", i, r.OtherManagers)
		}
		if r.SeriesID != "S000002841" {
			t.Errorf("row %d SeriesID = %q, want voteSeries S000002841 on every row", i, r.SeriesID)
		}
		if r.ParseMode != "xml" {
			t.Errorf("row %d ParseMode = %q, want xml", i, r.ParseMode)
		}
		if r.MeetingDate != "20250228" {
			t.Errorf("row %d MeetingDate = %q, want 20250228 (normalized)", i, r.MeetingDate)
		}
		if r.FilePath != "edgar/data/36405/x.txt" {
			t.Errorf("row %d FilePath = %q, want the filing path stamped from meta", i, r.FilePath)
		}
	}

	for i, want := range []struct{ how, shares string }{
		{"FOR", "600"}, {"AGAINST", "300"}, {"ABSTAIN", "100"},
	} {
		if rows[i].HowVoted != want.how {
			t.Errorf("row %d HowVoted = %q, want %q", i, rows[i].HowVoted, want.how)
		}
		if rows[i].SharesVoted != want.shares {
			t.Errorf("row %d SharesVoted = %q, want %q", i, rows[i].SharesVoted, want.shares)
		}
		if rows[i].ManagementRecommendation != "FOR" {
			t.Errorf("row %d ManagementRecommendation = %q, want FOR", i, rows[i].ManagementRecommendation)
		}
	}

	r := rows[3]
	if r.IssuerName != "MICROSOFT CORP" {
		t.Errorf("row 3 IssuerName = %q, want MICROSOFT CORP", r.IssuerName)
	}
	if r.VoteCategories != "AUDIT_RELATED" {
		t.Errorf("row 3 VoteCategories = %q", r.VoteCategories)
	}
	if r.SharesVotedTotal != "500" {
		t.Errorf("row 3 SharesVotedTotal = %q", r.SharesVotedTotal)
	}
	if r.MeetingDate != "20241205" {
		t.Errorf("row 3 MeetingDate = %q, want 20241205 (normalized)", r.MeetingDate)
	}
	if r.VoteOtherInfo != "N/A" {
		t.Errorf("row 3 VoteOtherInfo = %q", r.VoteOtherInfo)
	}
	if r.OtherManagers != "" {
		t.Errorf("row 3 OtherManagers = %q, want empty", r.OtherManagers)
	}
}

func TestXMLParser(t *testing.T) {
	plain := npxSGMLHead + npxPrimaryDoc + npxVoteDoc

	t.Run("one row per voteRecord", func(t *testing.T) {
		rows, meta := collectXML(t, plain)
		assertNPXRows(t, rows)
		if meta.PeriodOfReport != "20250630" {
			t.Errorf("meta.PeriodOfReport = %q, want 20250630 from primary_doc.xml", meta.PeriodOfReport)
		}
	})

	t.Run("namespace prefixes parse identically", func(t *testing.T) {
		base, _ := collectXML(t, plain)
		prefixed, meta := collectXML(t, npxSGMLHead+withNamespacePrefix(npxPrimaryDoc+npxVoteDoc))
		assertNPXRows(t, prefixed)
		if len(base) != len(prefixed) {
			t.Fatalf("prefixed document produced %d rows, plain produced %d", len(prefixed), len(base))
		}
		for i := range base {
			if base[i] != prefixed[i] {
				t.Errorf("row %d differs between plain and namespace-prefixed documents:\n plain %+v\nprefix %+v",
					i, base[i], prefixed[i])
			}
		}
		if meta.PeriodOfReport != "20250630" {
			t.Errorf("prefixed meta.PeriodOfReport = %q, want 20250630", meta.PeriodOfReport)
		}
	})

	t.Run("documents are segmented by TYPE not position", func(t *testing.T) {
		// The vote table arrives first and primary_doc.xml second. A parser that
		// assumes document 1 is the header and document 2 the table breaks here.
		rows, meta := collectXML(t, npxSGMLHead+npxVoteDoc+npxPrimaryDoc)
		assertNPXRows(t, rows)
		if meta.PeriodOfReport != "20250630" {
			t.Errorf("meta.PeriodOfReport = %q, want 20250630 regardless of document order", meta.PeriodOfReport)
		}
	})
}
