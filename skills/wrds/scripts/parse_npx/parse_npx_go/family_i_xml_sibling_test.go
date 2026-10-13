package main

import (
	"os"
	"path/filepath"
	"testing"
)

func familyIXMLSibling(t *testing.T, fixture, issuer, cusip, isin, date string) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "xml", fixture))
	if err != nil {
		t.Fatal(err)
	}
	doc := npxSGMLHead + npxPrimaryDoc + "<DOCUMENT>\n<TYPE>PROXY VOTING RECORD\n<SEQUENCE>2\n<FILENAME>vote.xml\n<TEXT>\n<XML>\n<inf:proxyVoteTable xmlns:inf=\"http://www.sec.gov/edgar/document/npxproxy/informationtable\">\n" + string(b) + "</inf:proxyVoteTable>\n</XML>\n</TEXT>\n</DOCUMENT>\n"
	rows := runISSNPXDoc(t, doc)
	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2 sibling votes", len(rows))
	}
	for _, r := range rows {
		if r[30] != "xml" || r[31] != "" || r[15] != date {
			t.Fatalf("mode/layout/date = %q/%q/%q, want xml/blank/%s", r[30], r[31], r[15], date)
		}
	}
	var target, donor []string
	for _, r := range rows {
		if r[10] == issuer {
			target = r
		} else {
			donor = r
		}
	}
	if target == nil || donor == nil {
		t.Fatalf("want target %q and its donor, got %v", issuer, rows)
	}
	if donor[11] != cusip || donor[12] != isin {
		t.Fatalf("donor cusip/isin = %q/%q, want %s/%s", donor[11], donor[12], cusip, isin)
	}
	if target[11] != cusip || target[12] != isin {
		t.Errorf("id-less %s: cusip/isin = %q/%q, want %s/%s from same-meeting sibling", issuer, target[11], target[12], cusip, isin)
	}
}

// Westfuller 0002000324-26-003308, verbatim lines 439-458 and 24463-24484.
func TestFamilyIXMLSiblingIssuerCase(t *testing.T) {
	familyIXMLSibling(t, "family_i_sibling_case.txt", "CORECARD CORPORATION", "45816D100", "US45816D1000", "20251028")
}

// Same filing, verbatim lines 1201-1220 and 26179-26200. The uppercase
// spelling also omits the final period in "Intapp, Inc.".
func TestFamilyIXMLSiblingIssuerPunctuation(t *testing.T) {
	familyIXMLSibling(t, "family_i_sibling_punctuation.txt", "INTAPP, INC", "45827U109", "US45827U1097", "20251118")
}

// 0001172661-26-003917, lines 106569-106590 and 106701-106720.
func TestFamilyIXMLSiblingCompanyAbbreviation(t *testing.T) {
	familyIXMLSibling(t, "family_i_sibling_company_abbreviation.txt", "VICTORIA'S SECRET & COMPANY", "926400102", "US9264001028", "20260611")
}

// Same filing, lines 2614-2635 and 2658-2677. Both spellings print the
// identical say-on-pay description and meeting date.
func TestFamilyIXMLSiblingLegalSuffix(t *testing.T) {
	familyIXMLSibling(t, "family_i_sibling_legal_suffix.txt", "AERSALE INC.", "00810F106", "US00810F1066", "20260611")
}
