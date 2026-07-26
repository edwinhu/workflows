package main

// charset.go — transcode legacy-encoded filing XML to UTF-8.
//
// WHY THIS EXISTS. `encoding/xml` refuses any document whose declaration names
// a non-UTF-8 encoding when `Decoder.CharsetReader` is nil. It fails on the
// very first token, `parseInfoTable` breaks out of its loop, and the filing
// returns ZERO holdings rows while still recording `parse_status=ok` in the
// manifest. Measured before this file existed: 382 of 8,114 filings in 2024Q2
// (4.7%) and 115 of 4,508 in 2016Q4, every one of them an ordinary 13F-HR with
// a real holdings table whose only distinguishing feature was
// `<?xml version="1.0" encoding="windows-1252"?>`.
//
// A filing that parses to zero rows is an institution disappearing from
// ownership for that quarter, and it fails silently: a missing institution
// looks exactly like an institution that did not file. Nothing downstream —
// no orphan check, no row-count assertion — can distinguish the two.
//
// The fix is to decode the bytes rather than reject them. windows-1252 and
// ISO-8859-1 between them cover every non-UTF-8 declaration observed in the
// corpus, and both are single-byte tables, so this needs no dependency.

import (
	"bytes"
	"strings"
	"unicode/utf8"
)

// cp1252High maps the windows-1252 bytes 0x80–0x9F, the only range where it
// differs from ISO-8859-1. Values follow the WHATWG encoding standard, which
// keeps the five unassigned slots as their C1 control code points rather than
// substituting U+FFFD.
var cp1252High = [32]rune{
	0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021,
	0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F,
	0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014,
	0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178,
}

// charsetKind classifies a declared encoding.
type charsetKind int

const (
	charsetUTF8    charsetKind = iota // nothing to do
	charsetCP1252                     // windows-1252
	charsetLatin1                     // ISO-8859-1 and the ASCII labels
	charsetUnknown                    // named, but not one we can decode
)

// classifyCharset maps a declared encoding label to what we can do with it.
func classifyCharset(label string) charsetKind {
	switch strings.ToLower(strings.TrimSpace(label)) {
	case "", "utf-8", "utf8":
		return charsetUTF8
	case "windows-1252", "cp1252", "windows1252", "x-cp1252":
		return charsetCP1252
	// us-ascii is decoded as Latin-1 rather than passed through: the two agree
	// on every byte below 0x80, and a mislabelled filing with high bytes then
	// yields text instead of invalid UTF-8.
	case "iso-8859-1", "iso8859-1", "latin1", "latin-1", "us-ascii", "ascii", "iso-latin-1":
		return charsetLatin1
	}
	return charsetUnknown
}

// declaredEncoding returns the encoding named by a leading <?xml?> declaration
// along with the byte range the declaration occupies. found=false means there
// is no declaration to worry about.
func declaredEncoding(buf []byte) (label string, start, end int, found bool) {
	i := 0
	for i < len(buf) && isSpaceByte(buf[i]) {
		i++
	}
	if i+5 > len(buf) || !bytes.HasPrefix(buf[i:], []byte("<?xml")) {
		return "", 0, 0, false
	}
	// Only a genuine declaration, not a PI whose target merely starts "xml".
	if i+5 < len(buf) && !isSpaceByte(buf[i+5]) && buf[i+5] != '?' {
		return "", 0, 0, false
	}
	close := bytes.Index(buf[i:], []byte("?>"))
	if close < 0 {
		return "", 0, 0, false
	}
	end = i + close + 2
	body := buf[i+2 : i+close] // between "<?" and "?>"
	enc, present := piAttr(body, "encoding")
	if !present {
		return "", i, end, true
	}
	return enc, i, end, true
}

// transcodeSingleByte expands each byte through a single-byte code page.
func transcodeSingleByte(src []byte, kind charsetKind) []byte {
	out := make([]byte, 0, len(src)+len(src)/8)
	var scratch [4]byte
	for _, b := range src {
		switch {
		case b < 0x80:
			out = append(out, b)
		case kind == charsetCP1252 && b < 0xA0:
			n := utf8.EncodeRune(scratch[:], cp1252High[b-0x80])
			out = append(out, scratch[:n]...)
		default:
			// Both code pages map 0xA0–0xFF, and Latin-1 maps 0x80–0x9F, to
			// the code point with the same numeric value.
			n := utf8.EncodeRune(scratch[:], rune(b))
			out = append(out, scratch[:n]...)
		}
	}
	return out
}

// normalizeCharset returns xmlContent as UTF-8 with any legacy declaration
// removed, so that both the fast scanner and encoding/xml see a document they
// can read.
//
// The declaration is dropped rather than rewritten: encoding/xml reports it as
// a ProcInst that every caller here ignores, and the scanner skips processing
// instructions, so removing it changes no token either side observes — and it
// avoids having to keep the attribute's byte length intact.
//
// supported=false means a charset was declared that we cannot decode. The
// content is returned untouched, preserving the previous behaviour, and the
// caller is expected to surface it as an error rather than let it pass as a
// filing with no holdings.
func normalizeCharset(xmlContent []byte) (out []byte, changed, supported bool) {
	label, start, end, found := declaredEncoding(xmlContent)
	if !found {
		return xmlContent, false, true
	}
	switch classifyCharset(label) {
	case charsetUTF8:
		return xmlContent, false, true
	case charsetUnknown:
		return xmlContent, false, false
	}
	kind := classifyCharset(label)

	body := transcodeSingleByte(xmlContent[end:], kind)
	head := xmlContent[:start] // whitespace before the declaration, if any
	out = make([]byte, 0, len(head)+len(body))
	out = append(out, head...)
	out = append(out, body...)
	return out, true, true
}
