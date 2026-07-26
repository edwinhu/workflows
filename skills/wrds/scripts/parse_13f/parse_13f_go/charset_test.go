package main

import (
	"strings"
	"testing"
)

func TestClassifyCharset(t *testing.T) {
	cases := map[string]charsetKind{
		"":             charsetUTF8,
		"utf-8":        charsetUTF8,
		"UTF-8":        charsetUTF8,
		"  utf8  ":     charsetUTF8,
		"windows-1252": charsetCP1252,
		"WINDOWS-1252": charsetCP1252,
		"cp1252":       charsetCP1252,
		"iso-8859-1":   charsetLatin1,
		"ISO-8859-1":   charsetLatin1,
		"latin1":       charsetLatin1,
		"us-ascii":     charsetLatin1,
		"utf-16":       charsetUnknown,
		"shift_jis":    charsetUnknown,
		"euc-jp":       charsetUnknown,
	}
	for label, want := range cases {
		if got := classifyCharset(label); got != want {
			t.Errorf("classifyCharset(%q) = %v, want %v", label, got, want)
		}
	}
}

func TestDeclaredEncoding(t *testing.T) {
	label, _, end, found := declaredEncoding([]byte(`<?xml version="1.0" encoding="windows-1252"?><a/>`))
	if !found || label != "windows-1252" {
		t.Fatalf("got (%q, %v)", label, found)
	}
	if end != len(`<?xml version="1.0" encoding="windows-1252"?>`) {
		t.Errorf("declaration end = %d", end)
	}

	if _, _, _, found := declaredEncoding([]byte(`<informationTable/>`)); found {
		t.Error("reported a declaration where there is none")
	}
	// A PI whose target merely starts with "xml" is not a declaration.
	if _, _, _, found := declaredEncoding([]byte(`<?xmlstylesheet href="x"?><a/>`)); found {
		t.Error("mistook <?xmlstylesheet?> for a declaration")
	}
	// Leading whitespace is allowed before the declaration.
	if _, _, _, found := declaredEncoding([]byte("\n  <?xml version=\"1.0\"?><a/>")); !found {
		t.Error("missed a declaration behind leading whitespace")
	}
}

func TestTranscodeCP1252(t *testing.T) {
	// 0x92 is the windows-1252 right single quote, the one that actually shows
	// up in issuer names ("MOODY'S"). In Latin-1 the same byte is a control.
	src := []byte{'M', 'O', 'O', 'D', 'Y', 0x92, 'S'}
	if got := string(transcodeSingleByte(src, charsetCP1252)); got != "MOODY’S" {
		t.Errorf("cp1252: got %q", got)
	}
	if got := string(transcodeSingleByte(src, charsetLatin1)); got != "MOODYS" {
		t.Errorf("latin1: got %q", got)
	}
	// The two agree on the whole ASCII range and on 0xA0-0xFF.
	for b := 0; b < 0x80; b++ {
		in := []byte{byte(b)}
		if string(transcodeSingleByte(in, charsetCP1252)) != string(in) {
			t.Fatalf("ASCII byte %#x was altered", b)
		}
	}
	for b := 0xA0; b <= 0xFF; b++ {
		a := transcodeSingleByte([]byte{byte(b)}, charsetCP1252)
		c := transcodeSingleByte([]byte{byte(b)}, charsetLatin1)
		if string(a) != string(c) || string(a) != string(rune(b)) {
			t.Fatalf("byte %#x: cp1252=%q latin1=%q", b, a, c)
		}
	}
}

func TestNormalizeCharsetLeavesUTF8Alone(t *testing.T) {
	// The no-op path is the one that runs 95% of the time; if it copied or
	// altered the buffer the whole optimisation would regress.
	for _, doc := range []string{
		`<?xml version="1.0" encoding="UTF-8"?><informationTable/>`,
		`<informationTable/>`,
		`<?xml version="1.0"?><informationTable/>`,
	} {
		out, changed, supported := normalizeCharset([]byte(doc))
		if changed || !supported || string(out) != doc {
			t.Errorf("%q: changed=%v supported=%v out=%q", doc, changed, supported, out)
		}
	}
}

func TestNormalizeCharsetStripsDeclarationAndTranscodes(t *testing.T) {
	raw := append([]byte(`<?xml version="1.0" encoding="windows-1252"?><n>MOODY`), 0x92)
	raw = append(raw, []byte(`S</n>`)...)
	out, changed, supported := normalizeCharset(raw)
	if !changed || !supported {
		t.Fatalf("changed=%v supported=%v", changed, supported)
	}
	if strings.Contains(string(out), "<?xml") {
		t.Errorf("declaration survived: %q", out)
	}
	if !strings.Contains(string(out), "MOODY’S") {
		t.Errorf("not transcoded: %q", out)
	}
}

func TestNormalizeCharsetRefusesUnknown(t *testing.T) {
	doc := []byte(`<?xml version="1.0" encoding="utf-16"?><a/>`)
	out, changed, supported := normalizeCharset(doc)
	if supported || changed {
		t.Errorf("utf-16 should be unsupported: changed=%v supported=%v", changed, supported)
	}
	if string(out) != string(doc) {
		t.Error("content must be returned untouched when unsupported")
	}
}

// The end-to-end claim: a windows-1252 information table produced zero rows
// before this fix and produces its holdings after it.
func TestWindows1252InfoTableRecovered(t *testing.T) {
	body := `<informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">` +
		entry("MOODY\x92S CORP", "COM", "615369105", "12345", "6789", "SH", "SOLE", "6789", "0", "0") +
		`</informationTable>`
	doc := []byte(`<?xml version="1.0" encoding="windows-1252"?>` + body)

	// Pre-fix behaviour: encoding/xml refuses the declaration, no rows.
	before, err := parseInfoTableXML(doc, "f.txt", FilingMeta{}, primaryDocInfo{})
	if err != nil || len(before) != 0 {
		t.Fatalf("expected the old path to yield zero rows, got %d (err %v)", len(before), err)
	}

	// Post-fix: decoded, parsed, and the smart quote survives as UTF-8.
	fixed, _, supported := normalizeCharset(doc)
	if !supported {
		t.Fatal("windows-1252 should be supported")
	}
	after, err := parseInfoTable(fixed, "f.txt", FilingMeta{}, primaryDocInfo{})
	if err != nil {
		t.Fatalf("parse after transcode: %v", err)
	}
	if len(after) != 1 {
		t.Fatalf("expected 1 recovered row, got %d", len(after))
	}
	if after[0].NameOfIssuer != "MOODY’S CORP" {
		t.Errorf("issuer name = %q", after[0].NameOfIssuer)
	}
	if after[0].Value != 12345 || after[0].Shares != 6789 {
		t.Errorf("value/shares = %d/%d", after[0].Value, after[0].Shares)
	}
	// And the fast scanner must agree with encoding/xml on the decoded bytes.
	mustAccept(t, "transcoded windows-1252", fixed)
}
