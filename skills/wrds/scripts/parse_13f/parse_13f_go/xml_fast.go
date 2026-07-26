package main

// xml_fast.go — hand-rolled scanner for the information-table XML.
//
// WHY: CPU profiling of a full quarter (2024Q2, 8,114 filings, GOMAXPROCS=4)
// attributed 63.4% of all samples to encoding/xml.(*Decoder).Token, half of
// that inside nsname/name/readName/isName. The information table is
// machine-generated, attribute-free and entity-simple, so a direct scanner
// covers it without paying for a general XML parser.
//
// SAFETY: this scanner handles a strict subset. It reproduces the exact
// StartElement / EndElement / CharData sequence encoding/xml emits for the
// documents it accepts, and REFUSES (ok=false) on anything it is not certain
// about — comments, CDATA, processing instructions, DOCTYPE, multi-colon
// names, mismatched end tags (which encoding/xml "recovers" from in
// non-strict mode via a rule we deliberately do not reimplement), unknown
// entities, and exotic character references. The caller re-parses those with
// encoding/xml, so unaccepted filings keep identical output by construction.
// Correctness never depends on this scanner being complete, only on it being
// honest about what it does not handle.

import (
	"bytes"
	"math"
	"strings"
)

// ---------------------------------------------------------------------------
// Character-data decoding
// ---------------------------------------------------------------------------

// isInCharacterRange mirrors encoding/xml's function of the same name.
func isInCharacterRange(r rune) bool {
	return r == 0x09 || r == 0x0A || r == 0x0D ||
		r >= 0x20 && r <= 0xD7FF ||
		r >= 0xE000 && r <= 0xFFFD ||
		r >= 0x10000 && r <= 0x10FFFF
}

// decodeText converts raw character data to the string encoding/xml would
// produce: CRLF and lone CR collapse to LF, and the five predefined entities
// plus numeric character references are resolved.
//
// Returns ok=false for any entity it does not fully understand, which forces
// the caller onto the encoding/xml path.
func decodeText(b []byte) (string, bool) {
	// Fast path: no entity, no CR — the overwhelming majority of fields.
	simple := true
	for _, c := range b {
		if c == '&' || c == '\r' {
			simple = false
			break
		}
	}
	if simple {
		return string(b), true
	}

	var sb strings.Builder
	sb.Grow(len(b))
	for i := 0; i < len(b); {
		switch b[i] {
		case '\r':
			// CRLF -> LF, lone CR -> LF.
			sb.WriteByte('\n')
			if i+1 < len(b) && b[i+1] == '\n' {
				i += 2
			} else {
				i++
			}
		case '&':
			// Entity names are short; bound the search so a stray '&' cannot
			// scan the whole buffer.
			semi := -1
			for j := i + 1; j < len(b) && j <= i+12; j++ {
				if b[j] == ';' {
					semi = j
					break
				}
			}
			if semi < 0 {
				return "", false // bare '&' — let encoding/xml decide
			}
			ent := b[i+1 : semi]
			switch string(ent) {
			case "amp":
				sb.WriteByte('&')
			case "lt":
				sb.WriteByte('<')
			case "gt":
				sb.WriteByte('>')
			case "apos":
				sb.WriteByte('\'')
			case "quot":
				sb.WriteByte('"')
			default:
				r, ok := decodeCharRef(ent)
				if !ok {
					return "", false
				}
				sb.WriteRune(r)
			}
			i = semi + 1
		default:
			// Copy a run of ordinary bytes at once.
			j := i
			for j < len(b) && b[j] != '&' && b[j] != '\r' {
				j++
			}
			sb.Write(b[i:j])
			i = j
		}
	}
	return sb.String(), true
}

// decodeCharRef resolves "#NN" / "#xHH" entity bodies. It refuses the
// whitespace controls and anything outside the plain character range, whose
// non-strict handling in encoding/xml we do not reimplement.
func decodeCharRef(ent []byte) (rune, bool) {
	if len(ent) < 2 || ent[0] != '#' {
		return 0, false
	}
	base := int64(10)
	digits := ent[1:]
	if ent[1] == 'x' || ent[1] == 'X' {
		base = 16
		digits = ent[2:]
	}
	if len(digits) == 0 || len(digits) > 8 {
		return 0, false
	}
	var n int64
	for _, d := range digits {
		var v int64
		switch {
		case d >= '0' && d <= '9':
			v = int64(d - '0')
		case base == 16 && d >= 'a' && d <= 'f':
			v = int64(d-'a') + 10
		case base == 16 && d >= 'A' && d <= 'F':
			v = int64(d-'A') + 10
		default:
			return 0, false
		}
		n = n*base + v
	}
	r := rune(n)
	if r == 0x09 || r == 0x0A || r == 0x0D || !isInCharacterRange(r) {
		return 0, false
	}
	return r, true
}

// ---------------------------------------------------------------------------
// Tag scanning
// ---------------------------------------------------------------------------

// localName strips a namespace prefix the way encoding/xml's nsname does:
// a single interior colon splits prefix from local name; zero colons, a
// leading colon, or a trailing colon leave the name intact. More than one
// colon is a syntax error there, so we refuse it here.
func localName(s []byte) (string, bool) {
	first := -1
	n := 0
	for i, c := range s {
		if c == ':' {
			n++
			if first < 0 {
				first = i
			}
		}
	}
	if n > 1 {
		return "", false
	}
	if n == 1 && first >= 1 && first <= len(s)-2 {
		return string(s[first+1:]), true
	}
	return string(s), true
}

// isSpaceByte reports the whitespace bytes XML treats as tag separators.
func isSpaceByte(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}

// skipMarkup consumes a processing instruction or a comment starting at
// buf[i] (which must be '<'). encoding/xml turns these into ProcInst and
// Comment tokens, which both parseInfoTable and parseOneInfoTable ignore
// without touching depth, so skipping them here is equivalent.
//
// Returns handled=false when buf[i] does not begin one of those two forms,
// and ok=false when it does but is unterminated (a syntax error there).
// Everything else beginning "<!" — CDATA, DOCTYPE — stays unhandled and
// falls back, since those do affect the token stream.
func skipMarkup(buf []byte, i int) (next int, handled, ok bool) {
	if i+1 >= len(buf) {
		return 0, false, false
	}
	switch {
	case buf[i+1] == '?':
		end := indexFrom(buf, i+2, "?>")
		if end < 0 {
			return 0, true, false
		}
		// An <?xml?> declaration naming a non-UTF-8 encoding, or a version
		// other than 1.0, makes encoding/xml fail on its very first token
		// with no CharsetReader installed — which yields zero holdings rows
		// for the whole filing. That outcome is wrong but it is the shipped
		// behaviour, so refuse here and let the reference path reproduce it.
		if xmlDeclUnsupported(buf[i+2 : end]) {
			return 0, true, false
		}
		return end + 2, true, true
	case i+3 < len(buf) && buf[i+1] == '!' && buf[i+2] == '-' && buf[i+3] == '-':
		end := indexFrom(buf, i+4, "-->")
		if end < 0 {
			return 0, true, false
		}
		return end + 3, true, true
	}
	return 0, false, true
}

// xmlDeclUnsupported reports whether a processing instruction is an <?xml?>
// declaration that encoding/xml would reject: a version other than "1.0", or
// any encoding that is not UTF-8. Ambiguity resolves to true, since refusing
// the fast path is always safe and only costs speed.
func xmlDeclUnsupported(pi []byte) bool {
	k := 0
	for k < len(pi) && isSpaceByte(pi[k]) {
		k++
	}
	if k+3 > len(pi) || !strings.EqualFold(string(pi[k:k+3]), "xml") {
		return false // some other processing-instruction target
	}
	if v, found := piAttr(pi, "version"); found && v != "1.0" {
		return true
	}
	if v, found := piAttr(pi, "encoding"); found && !strings.EqualFold(v, "utf-8") {
		return true
	}
	return false
}

// piAttr pulls a quoted param="value" out of a processing instruction body,
// mirroring encoding/xml's procInst helper closely enough for a gate whose
// false positives are harmless.
func piAttr(pi []byte, param string) (string, bool) {
	idx := bytes.Index(pi, []byte(param+"="))
	if idx < 0 {
		return "", false
	}
	j := idx + len(param) + 1
	if j >= len(pi) || (pi[j] != '"' && pi[j] != '\'') {
		return "", true // malformed: treat as present-and-unrecognised
	}
	q := pi[j]
	end := bytes.IndexByte(pi[j+1:], q)
	if end < 0 {
		return "", true
	}
	return string(pi[j+1 : j+1+end]), true
}

// indexFrom returns the index of sub in buf at or after start, or -1.
func indexFrom(buf []byte, start int, sub string) int {
	if start >= len(buf) {
		return -1
	}
	n := bytes.Index(buf[start:], []byte(sub))
	if n < 0 {
		return -1
	}
	return start + n
}

// scanTag parses the tag starting at buf[i] (which must be '<') and returns
// the local element name, whether it is an end tag, whether it is
// self-closing, and the index just past '>'.
func scanTag(buf []byte, i int) (name string, isEnd, selfClose bool, next int, ok bool) {
	i++ // consume '<'
	if i >= len(buf) {
		return "", false, false, 0, false
	}
	// CDATA and DOCTYPE change the token stream; processing instructions and
	// comments are stripped upstream by skipMarkup.
	if buf[i] == '!' || buf[i] == '?' {
		return "", false, false, 0, false
	}
	if buf[i] == '/' {
		isEnd = true
		i++
	}
	start := i
	for i < len(buf) && !isSpaceByte(buf[i]) && buf[i] != '>' && buf[i] != '/' {
		i++
	}
	if i >= len(buf) || i == start {
		return "", false, false, 0, false
	}
	name, ok = localName(buf[start:i])
	if !ok {
		return "", false, false, 0, false
	}
	// Skip attributes, honouring quoted values so a '>' inside one is safe.
	for i < len(buf) {
		switch buf[i] {
		case '"', '\'':
			q := buf[i]
			i++
			for i < len(buf) && buf[i] != q {
				i++
			}
			if i >= len(buf) {
				return "", false, false, 0, false
			}
			i++
		case '/':
			if i+1 < len(buf) && buf[i+1] == '>' {
				if isEnd {
					return "", false, false, 0, false // "</x/>" is not XML
				}
				return name, false, true, i + 2, true
			}
			i++
		case '>':
			return name, isEnd, false, i + 1, true
		default:
			i++
		}
	}
	return "", false, false, 0, false
}

// ---------------------------------------------------------------------------
// Information-table scan
// ---------------------------------------------------------------------------

// maxFastDepth bounds the element stack we are willing to track inside one
// <infoTable>. Real filings nest two levels; anything deeper falls back.
const maxFastDepth = 16

// parseInfoTableFast is a drop-in equivalent of parseInfoTable for the subset
// of documents the scanner accepts. ok=false means "not handled — use
// encoding/xml", never "no rows".
func parseInfoTableFast(xmlContent []byte, filePath string, meta FilingMeta, pdi primaryDocInfo) ([]Row, bool) {
	var rows []Row

	// Per-entry accumulators, mirroring parseOneInfoTable.
	var (
		nameOfIssuer         string
		titleOfClass         string
		cusipRaw             string
		value                int64
		shares               int64
		sharesType           string
		investmentDiscretion string
		otherManager         string
		votingSole           int64
		votingShared         int64
		votingNone           int64
		putCall              string
	)

	var current string
	var inShrsOrPrnAmt, inVotingAuthority bool
	var stack [maxFastDepth]string
	depth := 0 // 0 = outside an entry, mirrors parseOneInfoTable's counter

	openEntry := func() {
		nameOfIssuer, titleOfClass, cusipRaw = "", "", ""
		value, shares = 0, 0
		sharesType, investmentDiscretion, otherManager, putCall = "", "", "", ""
		votingSole, votingShared, votingNone = 0, 0, 0
		current = ""
		inShrsOrPrnAmt, inVotingAuthority = false, false
		depth = 1
	}

	// emit applies parseOneInfoTable's post-loop filters and appends the row.
	emit := func() {
		if sharesType == "PRN" || putCall != "" {
			return
		}
		if reFilterTitle.MatchString(strings.ToUpper(titleOfClass)) {
			return
		}
		cusip9, cusip8, cusip6, cusipValid := normalizeCUSIP(cusipRaw)
		rows = append(rows, Row{
			FilePath:             filePath,
			Accession:            meta.Accession,
			CIK:                  meta.CIK,
			PeriodOfReport:       meta.PeriodOfReport,
			FiledDate:            meta.FiledDate,
			FormType:             meta.FormType,
			NameOfIssuer:         nameOfIssuer,
			TitleOfClass:         titleOfClass,
			CUSIP9:               cusip9,
			CUSIP8:               cusip8,
			CUSIP6:               cusip6,
			Value:                value,
			Shares:               shares,
			SharesType:           sharesType,
			InvestmentDiscretion: investmentDiscretion,
			OtherManager:         otherManager,
			VotingSole:           votingSole,
			VotingShared:         votingShared,
			VotingNone:           votingNone,
			CUSIPValid:           cusipValid,
			IsAmendment:          pdi.IsAmendment,
			AmendmentType:        pdi.AmendmentType,
			ParseMode:            "xml",
		})
	}

	i := 0
	for i < len(xmlContent) {
		if xmlContent[i] != '<' {
			// Character data up to the next '<'.
			j := i
			allSpace := true
			for j < len(xmlContent) && xmlContent[j] != '<' {
				if allSpace && !isSpaceByte(xmlContent[j]) {
					allSpace = false
				}
				j++
			}
			// encoding/xml emits the token; the caller TrimSpace-skips blanks,
			// so a whitespace-only run is unobservable and can be skipped here.
			if !allSpace && depth > 0 {
				s, ok := decodeText(xmlContent[i:j])
				if !ok {
					return nil, false
				}
				s = strings.TrimSpace(s)
				if s != "" {
					s = strings.ReplaceAll(s, "\t", " ")
					s = strings.ReplaceAll(s, "\n", " ")
					switch {
					case current == "nameOfIssuer":
						nameOfIssuer = s
					case current == "titleOfClass":
						titleOfClass = s
					case current == "cusip":
						cusipRaw = s
					case current == "value":
						value = parseInt64Lax(s)
					case inShrsOrPrnAmt && current == "sshPrnamt":
						shares = parseInt64Lax(s)
					case inShrsOrPrnAmt && current == "sshPrnamtType":
						sharesType = strings.ToUpper(s)
					case current == "investmentDiscretion":
						investmentDiscretion = strings.ToUpper(s)
					case current == "putCall":
						putCall = strings.ToUpper(s)
					case current == "otherManager":
						otherManager = s
					case inVotingAuthority && (current == "Sole" || current == "sole"):
						votingSole = parseInt64Lax(s)
					case inVotingAuthority && (current == "Shared" || current == "shared"):
						votingShared = parseInt64Lax(s)
					case inVotingAuthority && (current == "None" || current == "none"):
						votingNone = parseInt64Lax(s)
					}
				}
			}
			i = j
			continue
		}

		if next, handled, ok := skipMarkup(xmlContent, i); handled {
			if !ok {
				return nil, false
			}
			i = next
			continue
		}

		name, isEnd, selfClose, next, ok := scanTag(xmlContent, i)
		if !ok {
			return nil, false
		}
		i = next

		if depth == 0 {
			// Outside an entry: only an <infoTable> start opens one. A
			// self-closing <infoTable/> yields an all-empty row in the
			// encoding/xml path, so reproduce that.
			if !isEnd && name == "infoTable" {
				openEntry()
				if selfClose {
					depth = 0
					emit()
				}
			}
			continue
		}

		// Inside an entry — mirror parseOneInfoTable's depth bookkeeping.
		if selfClose {
			// StartElement immediately followed by EndElement: depth nets out
			// and the trailing EndElement clears `current`.
			current = ""
			switch name {
			case "shrsOrPrnAmt":
				inShrsOrPrnAmt = false
			case "votingAuthority":
				inVotingAuthority = false
			}
			continue
		}

		if !isEnd {
			if depth >= maxFastDepth {
				return nil, false
			}
			stack[depth] = name
			depth++
			switch name {
			case "shrsOrPrnAmt":
				inShrsOrPrnAmt = true
				current = ""
			case "votingAuthority":
				inVotingAuthority = true
				current = ""
			default:
				current = name
			}
			continue
		}

		// End tag. encoding/xml in non-strict mode silently repairs a
		// mismatched close by rewriting the token; rather than reimplement
		// that recovery, refuse the document.
		want := "infoTable"
		if depth > 1 {
			want = stack[depth-1]
		}
		if name != want {
			return nil, false
		}
		depth--
		switch name {
		case "shrsOrPrnAmt":
			inShrsOrPrnAmt = false
		case "votingAuthority":
			inVotingAuthority = false
		}
		current = ""

		if depth == 0 {
			emit()
		}
	}

	// An unterminated entry is dropped, exactly as the encoding/xml path drops
	// it when parseOneInfoTable returns an error at EOF.
	return rows, true
}

// parseInt64Lax reproduces `n, _ := strconv.ParseInt(s, 10, 64)` including the
// discarded error: a syntax error leaves 0, a range error leaves the clamped
// bound. The value is assigned either way, so both cases are observable.
func parseInt64Lax(s string) int64 {
	i := 0
	neg := false
	if i < len(s) && (s[i] == '+' || s[i] == '-') {
		neg = s[i] == '-'
		i++
	}
	if i == len(s) {
		return 0 // no digits: syntax error
	}
	var n uint64
	const cutoff = uint64(1) << 63
	for ; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			return 0 // syntax error
		}
		d := uint64(c - '0')
		if n > (math.MaxUint64-d)/10 {
			if neg {
				return math.MinInt64
			}
			return math.MaxInt64
		}
		n = n*10 + d
		if !neg && n >= cutoff {
			return math.MaxInt64
		}
		if neg && n > cutoff {
			return math.MinInt64
		}
	}
	if neg {
		return -int64(n)
	}
	return int64(n)
}
