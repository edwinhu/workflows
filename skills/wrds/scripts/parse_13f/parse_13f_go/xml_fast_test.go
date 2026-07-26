package main

import (
	"fmt"
	"strconv"
	"strings"
	"testing"
)

// referenceParseInt is what the encoding/xml path does: assign the result and
// discard the error, so range errors keep their clamped bound.
func referenceParseInt(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}

// The scanner's contract is differential: for every document it ACCEPTS it
// must produce exactly what encoding/xml produces. Refusing is always allowed.
// So every case below asserts agreement-or-refusal, and the cases that are
// expected to be accepted say so explicitly, otherwise a regression that
// silently disabled the fast path would still pass.

func infoTableDoc(body string) []byte {
	return []byte(`<?xml version="1.0" encoding="UTF-8"?>` +
		`<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">` +
		body + `</informationTable>`)
}

func entry(name, class, cusip, value, shares, shType, disc, sole, shared, none string) string {
	return fmt.Sprintf(`<infoTable>`+
		`<nameOfIssuer>%s</nameOfIssuer><titleOfClass>%s</titleOfClass>`+
		`<cusip>%s</cusip><value>%s</value>`+
		`<shrsOrPrnAmt><sshPrnamt>%s</sshPrnamt><sshPrnamtType>%s</sshPrnamtType></shrsOrPrnAmt>`+
		`<investmentDiscretion>%s</investmentDiscretion>`+
		`<votingAuthority><Sole>%s</Sole><Shared>%s</Shared><None>%s</None></votingAuthority>`+
		`</infoTable>`, name, class, cusip, value, shares, shType, disc, sole, shared, none)
}

// assertAgrees runs both parsers and fails on any divergence. It returns
// whether the fast scanner accepted the document.
func assertAgrees(t *testing.T, name string, doc []byte) bool {
	t.Helper()
	meta := FilingMeta{Accession: "0000000000-24-000001", CIK: "12345"}
	pdi := primaryDocInfo{}
	fast, ok := parseInfoTableFast(doc, "f.txt", meta, pdi)
	ref, err := parseInfoTableXML(doc, "f.txt", meta, pdi)
	if err != nil {
		t.Fatalf("%s: reference parser errored: %v", name, err)
	}
	if !ok {
		return false
	}
	if !rowsEqual(fast, ref) {
		t.Errorf("%s: fast/reference divergence\n fast (%d rows): %#v\n ref  (%d rows): %#v",
			name, len(fast), fast, len(ref), ref)
	}
	return true
}

func mustAccept(t *testing.T, name string, doc []byte) {
	t.Helper()
	if !assertAgrees(t, name, doc) {
		t.Errorf("%s: fast scanner refused a document it should handle", name)
	}
}

func TestFastXMLBasicEntry(t *testing.T) {
	doc := infoTableDoc(entry("ACME CORP", "COM", "000361105", "12345",
		"6789", "SH", "SOLE", "6789", "0", "0"))
	mustAccept(t, "basic", doc)
}

func TestFastXMLWhitespaceAndNewlines(t *testing.T) {
	body := "\n  " + entry("ACME CORP", "COM", "000361105", "12345",
		"6789", "SH", "SOLE", "6789", "0", "0") + "\n  "
	mustAccept(t, "whitespace", infoTableDoc(body))
}

func TestFastXMLNamespacePrefixes(t *testing.T) {
	doc := []byte(`<?xml version="1.0"?><ns1:informationTable xmlns:ns1="x">` +
		`<ns1:infoTable><ns1:nameOfIssuer>ACME</ns1:nameOfIssuer>` +
		`<ns1:titleOfClass>COM</ns1:titleOfClass><ns1:cusip>000361105</ns1:cusip>` +
		`<ns1:value>10</ns1:value>` +
		`<ns1:shrsOrPrnAmt><ns1:sshPrnamt>20</ns1:sshPrnamt>` +
		`<ns1:sshPrnamtType>SH</ns1:sshPrnamtType></ns1:shrsOrPrnAmt>` +
		`<ns1:votingAuthority><ns1:Sole>20</ns1:Sole></ns1:votingAuthority>` +
		`</ns1:infoTable></ns1:informationTable>`)
	mustAccept(t, "namespaced", doc)
}

func TestFastXMLPredefinedEntities(t *testing.T) {
	// "&amp;" is extremely common in issuer names; if this fell back, the
	// fast path would almost never fire.
	doc := infoTableDoc(entry("AT&amp;T INC", "COM &lt;A&gt;", "00206R102",
		"1", "2", "SH", "SOLE", "2", "0", "0"))
	mustAccept(t, "entities", doc)
	rows, ok := parseInfoTableFast(doc, "f.txt", FilingMeta{}, primaryDocInfo{})
	if !ok || len(rows) != 1 {
		t.Fatalf("expected one accepted row, got ok=%v n=%d", ok, len(rows))
	}
	if rows[0].NameOfIssuer != "AT&T INC" {
		t.Errorf("entity not decoded: %q", rows[0].NameOfIssuer)
	}
	if rows[0].TitleOfClass != "COM <A>" {
		t.Errorf("entity not decoded: %q", rows[0].TitleOfClass)
	}
}

func TestFastXMLNumericCharRef(t *testing.T) {
	mustAccept(t, "decimal ref", infoTableDoc(entry("A&#38;B", "COM", "000361105",
		"1", "2", "SH", "SOLE", "2", "0", "0")))
	mustAccept(t, "hex ref", infoTableDoc(entry("A&#x26;B", "COM", "000361105",
		"1", "2", "SH", "SOLE", "2", "0", "0")))
}

func TestFastXMLCarriageReturns(t *testing.T) {
	// encoding/xml normalises CRLF and lone CR to LF before the caller's
	// TrimSpace/replace runs; the scanner has to do the same.
	doc := infoTableDoc(`<infoTable><nameOfIssuer>ACME` + "\r\n" + `CORP</nameOfIssuer>` +
		`<titleOfClass>C` + "\r" + `OM</titleOfClass><cusip>000361105</cusip>` +
		`<value>1</value></infoTable>`)
	mustAccept(t, "carriage returns", doc)
}

func TestFastXMLSelfClosingElements(t *testing.T) {
	mustAccept(t, "self-closing field", infoTableDoc(
		`<infoTable><nameOfIssuer>ACME</nameOfIssuer><otherManager/>`+
			`<cusip>000361105</cusip><value>1</value></infoTable>`))
	mustAccept(t, "self-closing group", infoTableDoc(
		`<infoTable><nameOfIssuer>ACME</nameOfIssuer><shrsOrPrnAmt/>`+
			`<cusip>000361105</cusip><value>1</value></infoTable>`))
	// An empty entry still emits an all-empty row through encoding/xml.
	mustAccept(t, "self-closing infoTable", infoTableDoc(`<infoTable/>`))
}

func TestFastXMLFilters(t *testing.T) {
	mustAccept(t, "PRN filtered", infoTableDoc(entry("ACME", "BOND", "000361105",
		"1", "2", "PRN", "SOLE", "2", "0", "0")))
	mustAccept(t, "putCall filtered", infoTableDoc(
		`<infoTable><nameOfIssuer>ACME</nameOfIssuer><cusip>000361105</cusip>`+
			`<value>1</value><putCall>Put</putCall></infoTable>`))
	mustAccept(t, "derivative title filtered", infoTableDoc(entry("ACME", "COM PUT",
		"000361105", "1", "2", "SH", "SOLE", "2", "0", "0")))
}

func TestFastXMLMultipleEntries(t *testing.T) {
	body := entry("A CORP", "COM", "000361105", "1", "2", "SH", "SOLE", "2", "0", "0") +
		entry("B CORP", "COM", "00206R102", "3", "4", "SH", "DFND", "0", "4", "0") +
		entry("C CORP", "COM", "037833100", "5", "6", "SH", "OTR", "0", "0", "6")
	mustAccept(t, "three entries", infoTableDoc(body))
}

func TestFastXMLIntegerEdgeCases(t *testing.T) {
	// ParseInt's discarded error is observable: a syntax error leaves 0, a
	// range error leaves the clamped bound. Both must match.
	for _, v := range []string{"0", "-5", "+7", "abc", "1.5", "",
		"9223372036854775807", "9223372036854775808", "99999999999999999999",
		"-9223372036854775808", "-9223372036854775809"} {
		doc := infoTableDoc(`<infoTable><cusip>000361105</cusip><value>` + v +
			`</value><shrsOrPrnAmt><sshPrnamt>` + v + `</sshPrnamt>` +
			`<sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt></infoTable>`)
		mustAccept(t, "value="+v, doc)
	}
}

func TestParseInt64LaxMatchesStrconv(t *testing.T) {
	for _, s := range []string{"0", "1", "-1", "+1", "007", "abc", "1a", " 1", "1 ",
		"", "-", "+", "9223372036854775807", "9223372036854775808",
		"-9223372036854775808", "-9223372036854775809", "18446744073709551616",
		"999999999999999999999999999999"} {
		got := parseInt64Lax(s)
		want := referenceParseInt(s)
		if got != want {
			t.Errorf("parseInt64Lax(%q) = %d, strconv path gives %d", s, got, want)
		}
	}
}

func TestFastXMLRefusesConstructsItCannotMirror(t *testing.T) {
	// Each of these must be REFUSED, not silently mishandled.
	cases := map[string][]byte{
		"non-utf8 declaration": []byte(`<?xml version="1.0" encoding="windows-1252"?>` +
			`<informationTable>` + entry("ACME", "COM", "000361105", "1", "2", "SH", "SOLE", "2", "0", "0") +
			`</informationTable>`),
		"bad version": []byte(`<?xml version="1.1"?><informationTable>` +
			entry("ACME", "COM", "000361105", "1", "2", "SH", "SOLE", "2", "0", "0") +
			`</informationTable>`),
		"cdata": infoTableDoc(`<infoTable><nameOfIssuer><![CDATA[ACME]]></nameOfIssuer>` +
			`<cusip>000361105</cusip><value>1</value></infoTable>`),
		"doctype": []byte(`<!DOCTYPE informationTable><informationTable>` +
			entry("ACME", "COM", "000361105", "1", "2", "SH", "SOLE", "2", "0", "0") +
			`</informationTable>`),
		"unknown entity": infoTableDoc(entry("A&nbsp;B", "COM", "000361105",
			"1", "2", "SH", "SOLE", "2", "0", "0")),
		"bare ampersand": infoTableDoc(entry("A & B", "COM", "000361105",
			"1", "2", "SH", "SOLE", "2", "0", "0")),
		"mismatched end tag": infoTableDoc(
			`<infoTable><nameOfIssuer>ACME</titleOfClass><cusip>000361105</cusip>` +
				`<value>1</value></infoTable>`),
		"multi-colon name": infoTableDoc(
			`<a:b:infoTable><cusip>000361105</cusip></a:b:infoTable>`),
	}
	for name, doc := range cases {
		if _, ok := parseInfoTableFast(doc, "f.txt", FilingMeta{}, primaryDocInfo{}); ok {
			t.Errorf("%s: fast scanner accepted a document it must refuse", name)
		}
	}
}

func TestFastXMLCommentsAndProcInstsAreSkipped(t *testing.T) {
	// encoding/xml emits Comment and ProcInst tokens that both loops ignore
	// without touching depth, so these must be accepted, not refused.
	doc := infoTableDoc(`<!-- leading --><infoTable><nameOfIssuer>ACME</nameOfIssuer>` +
		`<!-- inline --><cusip>000361105</cusip><?target data?><value>1</value>` +
		`</infoTable><!-- trailing -->`)
	mustAccept(t, "comments and PIs", doc)
}

func TestFastXMLTruncatedEntryIsDropped(t *testing.T) {
	doc := []byte(`<?xml version="1.0"?><informationTable>` +
		entry("A CORP", "COM", "000361105", "1", "2", "SH", "SOLE", "2", "0", "0") +
		`<infoTable><nameOfIssuer>TRUNCATED</nameOfIssuer>`)
	mustAccept(t, "truncated tail", doc)
	rows, ok := parseInfoTableFast(doc, "f.txt", FilingMeta{}, primaryDocInfo{})
	if !ok || len(rows) != 1 {
		t.Errorf("expected the complete entry only, got ok=%v n=%d", ok, len(rows))
	}
}

func TestFastXMLAttributesWithAngleBrackets(t *testing.T) {
	doc := []byte(`<?xml version="1.0"?><informationTable note="a &gt; b">` +
		entry("ACME", "COM", "000361105", "1", "2", "SH", "SOLE", "2", "0", "0") +
		`</informationTable>`)
	mustAccept(t, "attribute with entity", doc)
}

func TestLocalName(t *testing.T) {
	cases := []struct {
		in   string
		want string
		ok   bool
	}{
		{"infoTable", "infoTable", true},
		{"n1:infoTable", "infoTable", true},
		{":infoTable", ":infoTable", true}, // leading colon: encoding/xml keeps it whole
		{"infoTable:", "infoTable:", true}, // trailing colon: likewise
		{"a:b:c", "", false},               // encoding/xml treats this as a syntax error
	}
	for _, c := range cases {
		got, ok := localName([]byte(c.in))
		if ok != c.ok || (ok && got != c.want) {
			t.Errorf("localName(%q) = (%q, %v), want (%q, %v)", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestDecodeTextLeavesPlainTextAlone(t *testing.T) {
	in := "PLAIN TEXT WITH SPACES"
	got, ok := decodeText([]byte(in))
	if !ok || got != in {
		t.Errorf("decodeText(%q) = (%q, %v)", in, got, ok)
	}
	if strings.Contains(got, "&") {
		t.Errorf("unexpected entity in output")
	}
}
