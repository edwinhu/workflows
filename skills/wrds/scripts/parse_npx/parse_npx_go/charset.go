package main

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// EDGAR bodies declare their encoding in an XML declaration or an HTML meta tag
// and are frequently wrong about it. normalizeCharset transcodes a declared
// single-byte body to UTF-8; an encoding it cannot decode is an ERROR, never an
// empty result, because a silent empty body looks exactly like a filing with
// nothing to report.

// cp1252High is the WHATWG windows-1252 mapping for bytes 0x80-0x9F. Every other
// byte in cp1252 agrees with latin-1.
var cp1252High = [32]rune{
	0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
	0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
	0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
	0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
}

// charsetKind is what a declared label resolves to.
type charsetKind int

const (
	charsetUTF8 charsetKind = iota
	charsetCP1252
	charsetLatin1
	charsetUndeclared
	charsetUnsupported
)

// declScanLimit bounds the search for a declaration: it lives in the head of the
// document, and scanning 200 MB for one would be a per-filing waste.
const declScanLimit = 8192

// normalizeCharset transcodes a body carrying a declared single-byte encoding to
// UTF-8. A UTF-8 body is returned byte-identical. An unsupported label yields a
// non-nil error.
func normalizeCharset(body []byte) ([]byte, error) {
	label := declaredEncoding(body)
	switch classifyCharset(label) {
	case charsetUTF8:
		return body, nil
	case charsetCP1252:
		return transcodeSingleByte(body, true), nil
	case charsetLatin1:
		return transcodeSingleByte(body, false), nil
	case charsetUndeclared:
		// Nothing declared: trust valid UTF-8, otherwise assume the cp1252 a
		// Windows-authored EDGAR body almost always is.
		if utf8.Valid(body) {
			return body, nil
		}
		return transcodeSingleByte(body, true), nil
	default:
		return nil, fmt.Errorf("unsupported declared encoding %q", label)
	}
}

// declaredEncoding returns the lowercased label declared by an XML declaration
// or an HTML meta charset, or "" when the body declares nothing.
func declaredEncoding(body []byte) string {
	head := body
	if len(head) > declScanLimit {
		head = head[:declScanLimit]
	}
	lower := strings.ToLower(string(head))
	for _, key := range []string{"encoding=", "charset="} {
		idx := 0
		for {
			k := strings.Index(lower[idx:], key)
			if k < 0 {
				break
			}
			pos := idx + k + len(key)
			if label := readLabel(lower[pos:]); label != "" {
				return label
			}
			idx = pos
		}
	}
	return ""
}

// readLabel reads an optionally quoted encoding label off the front of s.
func readLabel(s string) string {
	s = strings.TrimLeft(s, " \t")
	if s == "" {
		return ""
	}
	if q := s[0]; q == '"' || q == '\'' {
		end := strings.IndexByte(s[1:], q)
		if end < 0 {
			return ""
		}
		return strings.TrimSpace(s[1 : 1+end])
	}
	end := strings.IndexAny(s, " \t\r\n?>;\"'/")
	if end < 0 {
		end = len(s)
	}
	return strings.TrimSpace(s[:end])
}

// classifyCharset maps a declared label onto a decoder. us-ascii and ascii are
// deliberately decoded as latin-1: filers label a body ascii and then emit high
// bytes, and refusing those would drop real filings.
func classifyCharset(label string) charsetKind {
	norm := strings.ToLower(strings.TrimSpace(label))
	norm = strings.NewReplacer("_", "-", " ", "").Replace(norm)
	switch norm {
	case "":
		return charsetUndeclared
	case "utf-8", "utf8":
		return charsetUTF8
	case "windows-1252", "windows1252", "cp1252", "cp-1252", "1252", "ansi":
		return charsetCP1252
	case "iso-8859-1", "iso8859-1", "iso-88591", "latin-1", "latin1", "l1",
		"iso-8859-15", "iso8859-15", "us-ascii", "usascii", "ascii", "ansi-x3.4-1968":
		return charsetLatin1
	}
	return charsetUnsupported
}

// transcodeSingleByte widens each byte to its UTF-8 rune. High bytes go through
// the cp1252 table when cp1252 is true, and are latin-1 code points otherwise.
func transcodeSingleByte(body []byte, cp1252 bool) []byte {
	out := make([]byte, 0, len(body)+len(body)/4)
	var buf [4]byte
	for _, b := range body {
		if b < 0x80 {
			out = append(out, b)
			continue
		}
		r := rune(b)
		if cp1252 && b >= 0x80 && b <= 0x9f {
			r = cp1252High[b-0x80]
		}
		n := utf8.EncodeRune(buf[:], r)
		out = append(out, buf[:n]...)
	}
	return out
}
