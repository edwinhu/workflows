package main

import (
	"strings"
	"testing"
)

// Verbatim proxyTables from Northern Lights Fund Trust II 2024
// (000151/1518042/0001580642-24-004511.txt), whose vote document prints
// <cusip></cusip><isin></isin><figi></figi> on 6,096 of its 9,474 votes while
// sibling votes of the same issuer and meeting carry the identifier. Corpus
// wide, 94,094 XML vote rows carry no id element and 7,286 of those have a
// same-filing sibling of the same issuer and date that does.
//
// The blocks, in order: CIENA with its CUSIP; the same CIENA agenda item id
// less; ACADIA HEALTHCARE printing 00404A109 on 05/23/2024; ACADIA HEALTHCARE
// printing 989817101 on 5/23/2024; an id-less ACADIA HEALTHCARE vote; and
// ACADIA PHARMACEUTICALS, a different issuer carrying its own CUSIP.
const npxSiblingCusipVoteDoc = `<DOCUMENT>
<TYPE>PROXY VOTING RECORD
<SEQUENCE>2
<FILENAME>vote.xml
<TEXT>
<XML>
<?xml version="1.0" encoding="UTF-8"?>
<proxyVoteTable>
  <proxyTable>
    <issuerName>CIENA CORPORATION</issuerName>
    <cusip>171779309</cusip>
    <isin>US1717793095</isin>
    <figi></figi>
    <meetingDate>3/21/2024</meetingDate>
    <voteDescription>Ratification of the appointment of PricewaterhouseCoopers LLP as our independent registered public accounting firm for fiscal 2024</voteDescription>
    <voteCategories>
      <voteCategory>
        <categoryType>AUDIT-RELATED</categoryType>
      </voteCategory>
    </voteCategories>
    <voteSource>ISSUER</voteSource>
    <sharesVoted>102</sharesVoted>
    <sharesOnLoan>0</sharesOnLoan>
    <vote>
      <voteRecord>
        <howVoted>FOR</howVoted>
        <sharesVoted>102</sharesVoted>
        <managementRecommendation>FOR</managementRecommendation>
      </voteRecord>
    </vote>
    <voteSeries>S000063454</voteSeries>
    <voteOtherInfo></voteOtherInfo>
  </proxyTable>
  <proxyTable>
    <issuerName>CIENA CORPORATION</issuerName>
    <cusip></cusip>
    <isin></isin>
    <figi></figi>
    <meetingDate>3/21/2024</meetingDate>
    <voteDescription>Ratification of the appointment of PricewaterhouseCoopers LLP as our independent registered public accounting firm for fiscal 2024</voteDescription>
    <voteCategories>
      <voteCategory>
        <categoryType>AUDIT-RELATED</categoryType>
      </voteCategory>
    </voteCategories>
    <voteSource>ISSUER</voteSource>
    <sharesVoted>4771</sharesVoted>
    <sharesOnLoan>0</sharesOnLoan>
    <vote>
      <voteRecord>
        <howVoted>FOR</howVoted>
        <sharesVoted>4771</sharesVoted>
        <managementRecommendation>FOR</managementRecommendation>
      </voteRecord>
    </vote>
    <voteSeries>S000063456</voteSeries>
    <voteOtherInfo></voteOtherInfo>
  </proxyTable>
  <proxyTable>
    <issuerName>ACADIA HEALTHCARE COMPANY, INC.</issuerName>
    <cusip>00404A109</cusip>
    <isin>US00404A1097</isin>
    <figi></figi>
    <meetingDate>05/23/2024</meetingDate>
    <voteDescription>Election of Directors E. Perot Bissell</voteDescription>
    <voteCategories>
      <voteCategory>
        <categoryType>DIRECTOR ELECTIONS</categoryType>
      </voteCategory>
    </voteCategories>
    <voteSource>ISSUER</voteSource>
    <sharesVoted>79</sharesVoted>
    <sharesOnLoan>0</sharesOnLoan>
    <vote>
      <voteRecord>
        <howVoted>FOR</howVoted>
        <sharesVoted>79</sharesVoted>
        <managementRecommendation>FOR</managementRecommendation>
      </voteRecord>
    </vote>
    <voteSeries>S000063454</voteSeries>
    <voteOtherInfo></voteOtherInfo>
  </proxyTable>
  <proxyTable>
    <issuerName>ACADIA HEALTHCARE COMPANY, INC.</issuerName>
    <cusip>989817101</cusip>
    <isin>US9898171015</isin>
    <figi></figi>
    <meetingDate>5/23/2024</meetingDate>
    <voteDescription>Election of Directors E. Perot Bissell</voteDescription>
    <voteCategories>
      <voteCategory>
        <categoryType>DIRECTOR ELECTIONS</categoryType>
      </voteCategory>
    </voteCategories>
    <voteSource>ISSUER</voteSource>
    <sharesVoted>2363</sharesVoted>
    <sharesOnLoan>0</sharesOnLoan>
    <vote>
      <voteRecord>
        <howVoted>FOR</howVoted>
        <sharesVoted>2363</sharesVoted>
        <managementRecommendation>FOR</managementRecommendation>
      </voteRecord>
    </vote>
    <voteSeries>S000063456</voteSeries>
    <voteOtherInfo></voteOtherInfo>
  </proxyTable>
  <proxyTable>
    <issuerName>ACADIA HEALTHCARE COMPANY, INC.</issuerName>
    <cusip></cusip>
    <isin></isin>
    <figi></figi>
    <meetingDate>5/23/2024</meetingDate>
    <voteDescription>Advisory vote on the compensation of the Company's named executive officers as presented in the Proxy Statement</voteDescription>
    <voteCategories>
      <voteCategory>
        <categoryType>SECTION 14A SAY-ON-PAY VOTES</categoryType>
      </voteCategory>
    </voteCategories>
    <voteSource>ISSUER</voteSource>
    <sharesVoted>2363</sharesVoted>
    <sharesOnLoan>0</sharesOnLoan>
    <vote>
      <voteRecord>
        <howVoted>FOR</howVoted>
        <sharesVoted>2363</sharesVoted>
        <managementRecommendation>FOR</managementRecommendation>
      </voteRecord>
    </vote>
    <voteSeries>S000063456</voteSeries>
    <voteOtherInfo></voteOtherInfo>
  </proxyTable>
  <proxyTable>
    <issuerName>ACADIA PHARMACEUTICALS INC.</issuerName>
    <cusip>004225108</cusip>
    <isin>US0042251084</isin>
    <figi></figi>
    <meetingDate>05/29/2024</meetingDate>
    <voteDescription>To elect three Class II directors to hold office until the Company's 2027 Annual Meeting of Stockholders Julian C. Baker</voteDescription>
    <voteCategories>
      <voteCategory>
        <categoryType>DIRECTOR ELECTIONS</categoryType>
      </voteCategory>
    </voteCategories>
    <voteSource>ISSUER</voteSource>
    <sharesVoted>1</sharesVoted>
    <sharesOnLoan>0</sharesOnLoan>
    <vote>
      <voteRecord>
        <howVoted>FOR</howVoted>
        <sharesVoted>1</sharesVoted>
        <managementRecommendation>FOR</managementRecommendation>
      </voteRecord>
    </vote>
    <voteSeries>S000063454</voteSeries>
    <voteOtherInfo></voteOtherInfo>
  </proxyTable>
</proxyVoteTable>
</XML>
</TEXT>
</DOCUMENT>
`

// idlessRow returns the one row of issuer whose description starts with prefix.
func idlessRow(t *testing.T, rows []VoteRow, issuer, prefix string, wantBlank bool) VoteRow {
	t.Helper()
	var hits []VoteRow
	for _, r := range rows {
		if r.IssuerName != issuer || !strings.HasPrefix(r.VoteDescription, prefix) {
			continue
		}
		if wantBlank && r.SharesVoted != "2363" {
			continue
		}
		hits = append(hits, r)
	}
	if len(hits) != 1 {
		t.Fatalf("issuer %q prefix %q: matched %d rows, want 1", issuer, prefix, len(hits))
	}
	return hits[0]
}

// A vote whose cusip, isin and figi are all empty takes the identifier its
// same-filing siblings print for the same issuerName and the same meetingDate,
// but only when those siblings agree on exactly one CUSIP. CIENA is that case
// in this filing: votes printing 171779309 on 3/21/2024 and a repeat of the
// same agenda item with all three id elements empty.
func TestXMLIdlessVoteTakesSiblingCUSIP(t *testing.T) {
	rows, _ := collectXML(t, npxSGMLHead+npxPrimaryDoc+npxSiblingCusipVoteDoc)

	// The two CIENA rows share a description; the id-less one is the one that
	// arrived with no identifier, so find it by the shares it voted.
	var got VoteRow
	n := 0
	for _, r := range rows {
		if r.IssuerName == "CIENA CORPORATION" && r.SharesVoted == "4771" {
			got, n = r, n+1
		}
	}
	if n != 1 {
		t.Fatalf("CIENA: matched %d id-less rows, want 1", n)
	}
	if got.CUSIP != "171779309" {
		t.Errorf("id-less CIENA vote %q: cusip = %q, want 171779309 from its printed sibling",
			got.VoteDescription, got.CUSIP)
	}
	if got.ISIN != "US1717793095" {
		t.Errorf("id-less CIENA vote: isin = %q, want US1717793095 from its printed sibling", got.ISIN)
	}

	// The other issuer is untouched: it printed its own CUSIP and keeps it.
	other := idlessRow(t, rows, "ACADIA PHARMACEUTICALS INC.", "To elect three Class II directors", false)
	if other.CUSIP != "004225108" || other.ISIN != "US0042251084" {
		t.Errorf("ACADIA PHARMACEUTICALS: cusip/isin = %q/%q, want 004225108/US0042251084 unchanged",
			other.CUSIP, other.ISIN)
	}
}

// The guard: two different sibling CUSIPs leave the vote as printed. ACADIA
// HEALTHCARE is that case in this same filing — its votes print 00404A109 on
// 05/23/2024 and 989817101 on 5/23/2024, one normalized meeting date carrying
// two disagreeing identifiers. Neither may be borrowed; the id-less vote stays
// blank rather than take a coin flip, and 989817101 is not even ACADIA's.
func TestXMLIdlessVoteWithDisagreeingSiblingsStaysBlank(t *testing.T) {
	rows, _ := collectXML(t, npxSGMLHead+npxPrimaryDoc+npxSiblingCusipVoteDoc)

	got := idlessRow(t, rows, "ACADIA HEALTHCARE COMPANY, INC.", "Advisory vote on the compensation", true)
	if got.MeetingDate != "20240523" {
		t.Fatalf("fixture: id-less ACADIA meeting date = %q, want 20240523", got.MeetingDate)
	}
	if got.CUSIP != "" {
		t.Errorf("id-less ACADIA vote: cusip = %q, want blank — its siblings print both 00404A109 and 989817101",
			got.CUSIP)
	}
	if got.ISIN != "" {
		t.Errorf("id-less ACADIA vote: isin = %q, want blank", got.ISIN)
	}
}
