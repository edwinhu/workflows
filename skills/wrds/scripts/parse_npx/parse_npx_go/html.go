package main

import (
	"bytes"
	"strconv"
	"strings"
	"unicode/utf8"
)

// Legacy N-PX filings are line-oriented grammars wrapped in tens of megabytes of
// presentational SGML. Tag removal therefore has to preserve WHERE the lines
// were: block-level markup becomes a newline, inline markup becomes nothing.

// blockTags produce a line break where they appear (opening or closing).
var blockTags = map[string]bool{
	"p": true, "div": true, "br": true, "hr": true,
	"table": true, "tr": true, "td": true, "th": true,
	"li": true, "ul": true, "ol": true, "dl": true, "dt": true, "dd": true,
	"h1": true, "h2": true, "h3": true, "h4": true, "h5": true, "h6": true,
	"blockquote": true, "pre": true, "caption": true, "center": true,
	"tbody": true, "thead": true, "tfoot": true, "form": true, "title": true,
	"page": true, // EDGAR pseudo-tag
}

// droppedTags have their entire contents discarded, not just their markup.
var droppedTags = map[string]bool{
	"script": true, "style": true,
}

// namedEntities covers the references that actually occur in EDGAR bodies.
// Anything unrecognised is left verbatim rather than silently deleted.
var namedEntities = map[string]string{
	"nbsp": " ", "amp": "&", "lt": "<", "gt": ">", "quot": "\"",
	"apos": "'", "mdash": "—", "ndash": "–",
	"lsquo": "‘", "rsquo": "’", "ldquo": "“", "rdquo": "”",
	"hellip": "…", "bull": "•", "middot": "·",
	"copy": "©", "reg": "®", "trade": "™",
	"deg": "°", "sect": "§", "para": "¶",
	"eacute": "é", "egrave": "è", "agrave": "à",
	"ccedil": "ç", "uuml": "ü", "ouml": "ö", "auml": "ä",
	"minus": "-", "shy": "", "ensp": " ", "emsp": " ", "thinsp": " ",
}

// stripHTML removes SGML/HTML markup while preserving line structure and
// decodes named and numeric character references. Runs of spaces collapse; runs
// of newlines never collapse away, because the legacy layouts are line-oriented.
func stripHTML(src []byte) []byte {
	stripped := removeMarkup(src)
	decoded := decodeEntities(stripped)
	return []byte(collapseSpaces(decoded))
}

// removeMarkup walks the byte stream once, emitting text and turning tags into
// either a newline (block), nothing (inline), or a skip past the closing tag
// (script/style).
func removeMarkup(src []byte) string {
	var b strings.Builder
	b.Grow(len(src))
	for i := 0; i < len(src); {
		c := src[i]
		if c != '<' {
			b.WriteByte(c)
			i++
			continue
		}
		if i+4 <= len(src) && string(src[i:i+4]) == "<!--" {
			end := indexFrom(src, i+4, "-->")
			if end < 0 {
				return b.String()
			}
			i = end + 3
			continue
		}
		if i+1 < len(src) && (src[i+1] == '!' || src[i+1] == '?') {
			end := indexByteFrom(src, i+1, '>')
			if end < 0 {
				return b.String()
			}
			i = end + 1
			continue
		}
		name, after, ok := tagName(src, i)
		if !ok {
			// A bare '<' that opens no tag is literal text.
			b.WriteByte(c)
			i++
			continue
		}
		if droppedTags[name] {
			closeIdx := indexFrom(src, after, "</"+name)
			if closeIdx < 0 {
				return b.String()
			}
			end := indexByteFrom(src, closeIdx, '>')
			if end < 0 {
				return b.String()
			}
			b.WriteByte('\n')
			i = end + 1
			continue
		}
		if blockTags[name] {
			b.WriteByte('\n')
		}
		end := indexByteFrom(src, after, '>')
		if end < 0 {
			return b.String()
		}
		i = end + 1
	}
	return b.String()
}

// tagName reads the element name of the tag starting at src[i] ('<'), lowercased
// and with any leading '/' consumed. ok is false when this is not a tag start.
func tagName(src []byte, i int) (name string, after int, ok bool) {
	j := i + 1
	if j < len(src) && src[j] == '/' {
		j++
	}
	start := j
	for j < len(src) {
		c := src[j]
		if c == '>' || c == '/' || c == ' ' || c == '\t' || c == '\r' || c == '\n' {
			break
		}
		if !isNameByte(c) {
			return "", i, false
		}
		j++
	}
	if j == start {
		return "", i, false
	}
	return strings.ToLower(string(src[start:j])), j, true
}

func isNameByte(c byte) bool {
	switch {
	case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9':
		return true
	case c == '-' || c == '_' || c == ':':
		return true
	}
	return false
}

// indexFrom finds sub in src at or after from, matching ASCII case-insensitively.
// It never materializes a lowercased copy of the remainder: lowercasing src[from:]
// on every call makes markup removal O(comments x len(src)), which is the OOM path
// on the 66 MB legacy bodies. The needles are short and known, so anchoring on the
// first byte and comparing in place is enough.
func indexFrom(src []byte, from int, sub string) int {
	if from >= len(src) || sub == "" {
		return -1
	}
	lo, up := lowerASCII(sub[0]), upperASCII(sub[0])
	for i := from; i+len(sub) <= len(src); {
		j := indexEitherByte(src, i, lo, up)
		if j < 0 || j+len(sub) > len(src) {
			return -1
		}
		if equalFoldASCII(src[j:j+len(sub)], sub) {
			return j
		}
		i = j + 1
	}
	return -1
}

// indexEitherByte returns the first index at or after from holding lo or up.
func indexEitherByte(src []byte, from int, lo, up byte) int {
	if lo == up {
		k := bytes.IndexByte(src[from:], lo)
		if k < 0 {
			return -1
		}
		return from + k
	}
	for j := from; j < len(src); j++ {
		if src[j] == lo || src[j] == up {
			return j
		}
	}
	return -1
}

func equalFoldASCII(b []byte, s string) bool {
	for k := 0; k < len(s); k++ {
		if lowerASCII(b[k]) != lowerASCII(s[k]) {
			return false
		}
	}
	return true
}

func lowerASCII(c byte) byte {
	if c >= 'A' && c <= 'Z' {
		return c + ('a' - 'A')
	}
	return c
}

func upperASCII(c byte) byte {
	if c >= 'a' && c <= 'z' {
		return c - ('a' - 'A')
	}
	return c
}

func indexByteFrom(src []byte, from int, c byte) int {
	for j := from; j < len(src); j++ {
		if src[j] == c {
			return j
		}
	}
	return -1
}

// decodeEntities resolves named references and both decimal and hex numeric
// character references in a single left-to-right pass, so a decoded '&' is never
// re-read as the start of another reference.
func decodeEntities(s string) string {
	if !strings.ContainsRune(s, '&') {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for i := 0; i < len(s); {
		if s[i] != '&' {
			b.WriteByte(s[i])
			i++
			continue
		}
		semi := strings.IndexByte(s[i:], ';')
		// A reference body is short; anything longer is stray punctuation.
		if semi < 0 || semi > 12 {
			b.WriteByte('&')
			i++
			continue
		}
		if repl, ok := resolveEntity(s[i+1 : i+semi]); ok {
			b.WriteString(repl)
			i += semi + 1
			continue
		}
		b.WriteByte('&')
		i++
	}
	return b.String()
}

func resolveEntity(body string) (string, bool) {
	if body == "" {
		return "", false
	}
	if body[0] == '#' {
		digits := body[1:]
		base := 10
		if digits != "" && (digits[0] == 'x' || digits[0] == 'X') {
			base = 16
			digits = digits[1:]
		}
		if digits == "" {
			return "", false
		}
		n, err := strconv.ParseInt(digits, base, 32)
		if err != nil || n <= 0 || n > utf8.MaxRune {
			return "", false
		}
		// Filers emit cp1252 code points as numeric references in the C1 range.
		if n >= 0x80 && n <= 0x9f {
			return string(cp1252High[n-0x80]), true
		}
		return string(rune(n)), true
	}
	if repl, ok := namedEntities[strings.ToLower(body)]; ok {
		return repl, true
	}
	return "", false
}

// collapseSpaces squeezes runs of horizontal whitespace to a single space and
// drops spaces adjacent to a newline, while keeping the line structure itself.
// Runs of more than two newlines shrink to two so that page furniture does not
// bury the grammar; newlines are never collapsed away entirely.
func collapseSpaces(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	var b strings.Builder
	b.Grow(len(s))
	pendingSpace := false
	newlines := 0
	atLineStart := true
	for _, r := range s {
		switch {
		case isLineBreak(r):
			pendingSpace = false
			if newlines < 2 {
				b.WriteByte('\n')
				newlines++
			}
			atLineStart = true
		case isHorizontalSpace(r):
			if !atLineStart {
				pendingSpace = true
			}
		default:
			if pendingSpace {
				b.WriteByte(' ')
				pendingSpace = false
			}
			b.WriteRune(r)
			newlines = 0
			atLineStart = false
		}
	}
	return b.String()
}

func isLineBreak(r rune) bool {
	switch r {
	case '\n', '\r', '\v', '\f', 0x2028, 0x2029:
		return true
	}
	return false
}

func isHorizontalSpace(r rune) bool {
	switch {
	case r == ' ' || r == '\t':
		return true
	case r == 0x00a0 || r == 0x202f || r == 0x205f || r == 0x3000 || r == 0xfeff:
		return true
	case r >= 0x2000 && r <= 0x200b:
		return true
	}
	return false
}
