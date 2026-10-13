package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Masters Select 2009, 0000894189-09-002815, verbatim lines 290–580.
func TestFamilyLNumericSecurityID(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "L_split_security_id.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "American Express Co." {
			continue
		}
		seen++
		if r[colCUSIP] != "025816109" {
			t.Fatalf("issuer=%q cusip=%q want 025816109 (printed Security ID 25816109); ticker=%q date=%q layout=%q", r[colIssuerName], r[colCUSIP], r[colTicker], r[colMeetingDate], r[31])
		}
	}
	if seen == 0 {
		t.Fatalf("American Express absent among %d emitted rows", len(rows))
	}
}

// Masters Select 2009, 0000894189-09-002815, verbatim lines 74735–75000.
func TestFamilyLISINCusipHeader(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "L_isin_cusip_header.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colIssuerName] != "CIE FINANCIERE RICHEMONT SA, GENEVE" {
			continue
		}
		seen++
		if r[12] != "CH0012731458" {
			t.Fatalf("issuer=%q isin=%q want CH0012731458 from ISIN/Cusip column; description=%q layout=%q", r[colIssuerName], r[12], r[colVoteDescription], r[31])
		}
	}
	if seen == 0 {
		t.Fatalf("Richemont absent among %d emitted rows", len(rows))
	}
}

// Global X 2021, 0001135428-21-000187, verbatim lines 269349–269648.
func TestFamilyLProposalCompanyKeepsIdentity(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "L_proposal_company_context.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	seen := 0
	for _, r := range rows {
		if r[colMeetingDate] != "20210629" {
			continue
		}
		seen++
		if r[colCUSIP] != "Y7748U108" || r[colIssuerName] != "SHENZHEN YINGHE TECHNOLOGY CO LTD." {
			t.Fatalf("issuer=%q cusip=%q want SHENZHEN YINGHE TECHNOLOGY CO LTD. / Y7748U108; description=%q date=%q layout=%q", r[colIssuerName], r[colCUSIP], r[colVoteDescription], r[colMeetingDate], r[31])
		}
	}
	if seen == 0 {
		t.Fatalf("June Shenzhen vote absent among %d emitted rows", len(rows))
	}
}
