package main

import (
	"bufio"
	"bytes"
	_ "embed"
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
)

//go:embed colswap_list.txt
var colswapRaw string

// colswapSet is populated at init time from colswap_list.txt.
var colswapSet map[string]bool

func init() {
	colswapSet = make(map[string]bool)
	sc := bufio.NewScanner(strings.NewReader(colswapRaw))
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		colswapSet[line] = true
	}
}

// Pre-compiled regexes.
var (
	// CUSIP anchor: 8-9 uppercase-alphanumeric chars.
	reCUSIPAnchor = regexp.MustCompile(`[0-9A-Z]{8,9}`)
	// CUSIP standalone token: must fill entire field.
	reCUSIPToken = regexp.MustCompile(`^[0-9A-Z]{8,9}$`)
	// Must contain at least one digit to avoid matching pure-alpha words.
	reHasDigit = regexp.MustCompile(`[0-9]`)
	// Splits on whitespace or commas for token extraction.
	reSplitTokens = regexp.MustCompile(`[\s,]+`)
	// Splits on 2+ whitespace for issuer/title extraction.
	reMultiSpace = regexp.MustCompile(`\s{2,}`)

	// Derivative filter patterns (word-bounded) — text parser specific.
	// Note: reFilterTitle in xml_parser.go covers PUT|CALL|OPT|WAR but
	// we also need CONV BD and CONV BOND for text filings.
	reFilterPUT      = regexp.MustCompile(`\bPUT\b`)
	reFilterCALL     = regexp.MustCompile(`\bCALL\b`)
	reFilterCONVBD   = regexp.MustCompile(`\bCONV BD\b`)
	reFilterCONVBOND = regexp.MustCompile(`\bCONV BOND\b`)
	reFilterOPT      = regexp.MustCompile(`\bOPT\b`)
	reFilterWAR      = regexp.MustCompile(`\bWAR\b`)

	// Embedded price: 1-2 digit integer part + 2 decimal digits, as standalone token.
	reEmbeddedPrice = regexp.MustCompile(`\b\d{1,2}\.\d{2}\b`)

	// SH/PRN indicator.
	reSHPRN = regexp.MustCompile(`\b(SH|PRN)\b`)

	// Investment discretion.
	reInvDisc = regexp.MustCompile(`\b(SOLE|DFND|OTR)\b`)

	// Number with optional commas.
	reNumber = regexp.MustCompile(`[\d,]+\.?\d*`)

	// BCS column-separator repair patterns.
	// Malformed comma grouping: 4-6 digits between commas (should be 3).
	reColSepBad = regexp.MustCompile(`,\d{4,6},`)
	// Fix: split a ,NNNM+, group into ,NNN M+,
	reColSepFix = regexp.MustCompile(`,(\d{3})(\d{1,3}),`)
	// Short middle group: NNN,N{1,2},NNN (e.g., 123,45,678)
	reColSepShortMid = regexp.MustCompile(`\d{3},\d{1,2},\d{3}`)
	// Fix: split NNN,NN,NNN into NNN NN,NNN
	reColSepShortMidFix = regexp.MustCompile(`(\d{3}),(\d{1,2}),(\d{3})`)
	// Trailing single digit after comma: ,N$
	reColSepTrailing = regexp.MustCompile(`,\d$`)

	// Header/separator line indicators.
	reHeaderLine = regexp.MustCompile(`(?i)(NAME\s+OF\s+ISSUER|TITLE\s+OF\s+CLASS|\bCUSIP\b.*\bVALUE\b)`)
	reSepLine    = regexp.MustCompile(`^[\s\-=<>SC/]+$`)

	// Dashed separator line: 3+ consecutive dashes (possibly with whitespace).
	reDashedSep = regexp.MustCompile(`^\s*-{3,}\s*$`)

	// TABLE tags.
	reTableStart = regexp.MustCompile(`(?i)<TABLE>`)
	reTableEnd   = regexp.MustCompile(`(?i)</TABLE>`)

	// F4: Pre-processing patterns to separate digits+SH / digits+PRN.
	reDigitsSH  = regexp.MustCompile(`(\d)SH\b`)
	reDigitsPRN = regexp.MustCompile(`(\d)PRN\b`)

	// F3: Fallback class+CUSIP concatenation pattern.
	// Known class keyword immediately followed by a digit-starting CUSIP.
	reClassCUSIP = regexp.MustCompile(`(COM|COMMON|CL\s*[A-Z]|PREFERRED|PREF|ORD|SHS?)([0-9][0-9A-Z]{7,8})`)

	// F4: Token ending with SH or PR or PRN — not a valid CUSIP.
	reSHPRNSuffix = regexp.MustCompile(`(SH|PRN|PR)$`)

	// F3b: Dashed/spaced CUSIP-9 normalization patterns.
	// Many text filings format CUSIP-9 with dashes or spaces between
	// the issuer code (6 chars), issue code (2 chars), and check digit (1 char).
	// E.g., "066365-10-7" or "023840 10 1" instead of "066365107" / "023840101".
	// Also handles "03189710-1" (8-char CUSIP + dash + check digit).
	reSplitCUSIP621Dash  = regexp.MustCompile(`\b([0-9A-Z]{6})-([0-9A-Z]{2})-([0-9])\b`)
	reSplitCUSIP621Space = regexp.MustCompile(`\b([0-9A-Z]{6}) ([0-9A-Z]{2}) ([0-9])\b`)
	reSplitCUSIP81Dash   = regexp.MustCompile(`\b([0-9A-Z]{8})-([0-9])\b`)
)

// holdingLine holds intermediate parsing state for one logical holdings row.
type holdingLine struct {
	nameOfIssuer         string
	titleOfClass         string
	cusip                string
	value                int64
	shares               int64
	sharesType           string
	investmentDiscretion string
	otherManager         string
	votingSole           int64
	votingShared         int64
	votingNone           int64
	rawLine              string
}

// parseHeaderLocal wraps parseHeader (from xml_parser.go) for use by the
// text parser. It uses the full buffer rather than the 4KB head limit, which
// handles filings where the header extends further than usual.
func parseHeaderLocal(buf []byte) FilingMeta {
	return parseHeader(buf)
}

// preprocessSHPRN normalizes lines where share counts are concatenated with
// the type indicator (e.g., "1,216,329SH" -> "1,216,329 SH").
func preprocessSHPRN(line string) string {
	line = reDigitsSH.ReplaceAllString(line, "${1} SH")
	line = reDigitsPRN.ReplaceAllString(line, "${1} PRN")
	return line
}

// preprocessSplitCUSIP joins CUSIPs that are split with dashes or spaces.
// "066365-10-7" → "066365107", "023840 10 1" → "023840101", "03189710-1" → "031897101".
func preprocessSplitCUSIP(line string) string {
	line = reSplitCUSIP621Dash.ReplaceAllString(line, "${1}${2}${3}")
	line = reSplitCUSIP621Space.ReplaceAllString(line, "${1}${2}${3}")
	line = reSplitCUSIP81Dash.ReplaceAllString(line, "${1}${2}")
	return line
}

// isDerivative returns true if the line (already uppercased) contains a
// derivative indicator that should be filtered out.
func isDerivative(line string) bool {
	return reFilterPUT.MatchString(line) ||
		reFilterCALL.MatchString(line) ||
		reFilterCONVBD.MatchString(line) ||
		reFilterCONVBOND.MatchString(line) ||
		reFilterOPT.MatchString(line) ||
		reFilterWAR.MatchString(line)
}

// stripEmbeddedPrice removes embedded stock prices like "25.50" from a line.
func stripEmbeddedPrice(line string) string {
	return reEmbeddedPrice.ReplaceAllString(line, " ")
}

// parseNumBCS strips commas from a number string and parses it to int64.
// Handles floats by truncating to int.
func parseNumBCS(s string) (int64, bool) {
	s = strings.ReplaceAll(s, ",", "")
	if s == "" {
		return 0, false
	}
	if strings.Contains(s, ".") {
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return 0, false
		}
		return int64(f), true
	}
	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// repairColumnSeparators applies BCS column-separator repair heuristics
// to a raw shares string (before comma stripping). It detects malformed
// comma patterns where value and shares are concatenated without a proper
// separator, and splits them apart.
//
// Returns (value, shares) where value > 0 only if a split was detected.
// If no repair is needed, returns (0, parsed-number).
func repairColumnSeparators(raw string) (int64, int64) {
	s := raw

	// Check 1: ,NNNN, (4-6 digits between commas) -- wrong grouping.
	// E.g., "1,2345,678" should be value=12345, shares=678.
	if reColSepBad.MatchString(s) {
		// Insert a space to split: ,NNN + M+,
		s = reColSepFix.ReplaceAllString(s, ",$1 $2,")
		s = strings.ReplaceAll(s, ",", "")
		// Now s looks like "12345 678" -- split on space.
		parts := strings.Fields(s)
		if len(parts) >= 2 {
			last := parts[len(parts)-1]
			first := strings.Join(parts[:len(parts)-1], "")
			v, vOK := parseNumBCS(first)
			sh, shOK := parseNumBCS(last)
			if vOK && shOK {
				return v, sh
			}
		}
	}

	// Check 2: NNN,N{1,2},NNN (short middle group, like 123,45,678).
	if reColSepShortMid.MatchString(s) {
		// Split: NNN space NN,NNN
		s2 := reColSepShortMidFix.ReplaceAllString(s, "$1 $2,$3")
		s2 = strings.ReplaceAll(s2, ",", "")
		parts := strings.Fields(s2)
		if len(parts) >= 2 {
			last := parts[len(parts)-1]
			first := strings.Join(parts[:len(parts)-1], "")
			v, vOK := parseNumBCS(first)
			sh, shOK := parseNumBCS(last)
			if vOK && shOK {
				return v, sh
			}
		}
	}

	// Check 3: trailing single digit after comma: ,N$ -- strip it.
	if reColSepTrailing.MatchString(s) {
		s = reColSepTrailing.ReplaceAllString(s, "")
		s = strings.ReplaceAll(s, ",", "")
		sh, ok := parseNumBCS(s)
		if ok {
			return 0, sh
		}
	}

	// No repair needed -- just parse as-is.
	s = strings.ReplaceAll(s, ",", "")
	sh, ok := parseNumBCS(s)
	if ok {
		return 0, sh
	}
	return 0, 0
}

// extractBCSCascade tries BCS's 7-pattern regex cascade to extract
// (value, shares, sharesType) from a line, anchored on the raw CUSIP.
// Returns ok=true on first match. The patterns are tried in order;
// BCS always extracts capture-group-1=value, capture-group-2=shares.
//
// After extracting, applies:
// - Column-separator repair on the shares string.
// - Suspicious-shares filtering (shares < 1000 and value > shares*50).
func extractBCSCascade(line string, cusipRaw string) (value int64, shares int64, sharesType string, ok bool) {
	q := regexp.QuoteMeta(cusipRaw)

	// Build the 8 BCS patterns dynamically anchored on this CUSIP.
	// Each pattern captures (value, shares) in that order, except P3b which
	// only captures shares (group 1 = shares, no group 2).
	patterns := []struct {
		re        string
		hasSH     bool // whether the pattern includes SH marker
		singleNum bool // P3b: only one capture group (shares); value is set to 0
	}{
		// P1 (Babson): CUSIP + check-digit + value(glued) + shares + SH
		{re: q + `\d(\d{2,})\s+([\d.,]+)\s*SH`, hasSH: true},
		// P2 (Argyle/Cortland): CUSIP + comma-delimited
		{re: q + `\d?,([\d]+),([\d]+)`},
		// P3 (standard): CUSIP + optional check-digit + value + shares + SH
		{re: q + `\d?\s+([\d.,]+)\s+([\d.,]+)\s*?SH`, hasSH: true},
		// P3b (price-stripped): CUSIP + ONE number + SH.
		// Fires when a stock-price field was stripped by stripEmbeddedPrice, leaving
		// only the shares count between the CUSIP and the SH marker.
		// BCS handles this via P4 (no CUSIP anchor), which captures the CUSIP number
		// itself as "value" and the shares as "shares", then passes the suspicious check
		// because BCS's check is shares/shrout (not value/shares ratio).
		// Our suspicious check correctly rejects that P4 match, so we add P3b to
		// directly capture the single remaining number as shares.
		{re: q + `\d?\s+([\d.,]+)\s*SH`, hasSH: true, singleNum: true},
		// P4 (fallback): two numbers before SH, no CUSIP anchor
		{re: `([\d.,]+)\s+([\d.,]+)\s*?SH`, hasSH: true},
		// P5: CUSIP + value + shares (no SH marker)
		{re: q + `\s+([\d,.]+)\s+([\d,.]+)\s`},
		// P6: CUSIP + check-digit + value + shares
		{re: q + `\d\s+([\d,.]+)\s+([\d,.]+)\s`},
		// P7: CUSIP + value + SH + voting shares
		{re: q + `\d?\s+([\d,.]+)\s+SH\s+([\d,.]+)\s`, hasSH: true},
	}

	for _, p := range patterns {
		re, err := regexp.Compile(p.re)
		if err != nil {
			continue
		}
		m := re.FindStringSubmatch(line)
		if m == nil {
			continue
		}

		// P3b: single capture group — group 1 is shares, value = 0.
		if p.singleNum {
			rawShr := m[1]
			sh, shOK := parseNumBCS(strings.ReplaceAll(rawShr, ",", ""))
			if !shOK || sh <= 0 {
				continue
			}
			if p.hasSH {
				sharesType = "SH"
			}
			return 0, sh, sharesType, true
		}

		// BCS: capture group 1 = value, group 2 = shares (always this order in Perl).
		rawVal := m[1]
		rawShr := m[2]

		// Apply column-separator repair to the shares string.
		_, repShr := repairColumnSeparators(rawShr)
		shares = repShr

		v, vOK := parseNumBCS(rawVal)
		if !vOK {
			continue
		}
		value = v

		// Determine shares type.
		if p.hasSH {
			sharesType = "SH"
		}

		// Suspicious-shares heuristic: if shares < 1000 and value > shares*50,
		// the "shares" is likely a price. Skip this pattern and try the next.
		if shares > 0 && shares < 1000 && value > shares*50 {
			continue
		}

		return value, shares, sharesType, true
	}

	return 0, 0, "", false
}

// isHeaderOrSeparator returns true if a line is a table header, separator,
// or effectively blank (should be skipped during holdings parsing).
func isHeaderOrSeparator(line string) bool {
	trimmed := strings.TrimSpace(line)
	if trimmed == "" {
		return true
	}
	if reHeaderLine.MatchString(strings.ToUpper(trimmed)) {
		return true
	}
	if reSepLine.MatchString(trimmed) {
		return true
	}
	if reDashedSep.MatchString(trimmed) {
		return true
	}
	return false
}

// isCommaDelimited detects Argyle/Cortland-style comma-delimited lines:
// the line has commas but no tabs or runs of 2+ spaces used as field separators.
func isCommaDelimited(line string) bool {
	if !strings.Contains(line, ",") {
		return false
	}
	// If the line contains a CUSIP anchor AND commas separate all fields
	// (no tabs or multi-space gaps), treat as comma-delimited.
	if strings.Contains(line, "\t") {
		return false
	}
	// Check for multi-space gaps (2+ consecutive spaces).
	if strings.Contains(line, "  ") {
		return false
	}
	return true
}

// parseCommaLine parses a comma-delimited holdings line.
func parseCommaLine(line string) *holdingLine {
	fields := strings.Split(line, ",")
	if len(fields) < 6 {
		return nil
	}
	// Find the field containing the CUSIP.
	cusipIdx := -1
	for i, f := range fields {
		f = strings.TrimSpace(f)
		if (len(f) == 8 || len(f) == 9) && reCUSIPToken.MatchString(f) && reHasDigit.MatchString(f) {
			cusipIdx = i
			break
		}
	}
	if cusipIdx < 0 || cusipIdx < 2 {
		return nil
	}

	h := &holdingLine{}
	// Issuer name: everything before the title field (cusipIdx-1).
	issuerParts := make([]string, 0, cusipIdx-1)
	for i := 0; i < cusipIdx-1; i++ {
		issuerParts = append(issuerParts, strings.TrimSpace(fields[i]))
	}
	h.nameOfIssuer = strings.Join(issuerParts, " ")
	h.titleOfClass = strings.TrimSpace(fields[cusipIdx-1])
	h.cusip = strings.TrimSpace(fields[cusipIdx])

	// Fields after CUSIP: value, shares, SH/PRN, [discretion], [sole, shared, none]
	remaining := fields[cusipIdx+1:]
	nums := extractNumbers(strings.Join(remaining, " "))

	// Find SH/PRN.
	restStr := strings.Join(remaining, " ")
	if m := reSHPRN.FindString(restStr); m != "" {
		h.sharesType = m
	}
	// Find investment discretion.
	if m := reInvDisc.FindString(restStr); m != "" {
		h.investmentDiscretion = m
	}

	if len(nums) >= 2 {
		h.value = nums[0]
		h.shares = nums[1]
	}
	if len(nums) >= 5 {
		h.votingSole = nums[2]
		h.votingShared = nums[3]
		h.votingNone = nums[4]
	} else if len(nums) >= 3 {
		// Sometimes voting is only sole.
		h.votingSole = nums[2]
	}

	return h
}

// parseLine parses a single whitespace-delimited holdings line, anchored on CUSIP.
func parseLine(line string) *holdingLine {
	upper := strings.ToUpper(line)

	// Find the CUSIP anchor using standalone token matching.
	cusipStr, cusipIdx := findCUSIPToken(upper)
	if cusipIdx < 0 {
		return nil
	}

	h := &holdingLine{}
	h.cusip = cusipStr

	// Left of CUSIP: issuer name and title of class.
	left := strings.TrimSpace(upper[:cusipIdx])
	// Split on 2+ whitespace characters.
	leftParts := reMultiSpace.Split(left, -1)
	// Clean up empty parts.
	cleaned := make([]string, 0, len(leftParts))
	for _, p := range leftParts {
		p = strings.TrimSpace(p)
		if p != "" {
			cleaned = append(cleaned, p)
		}
	}
	if len(cleaned) >= 2 {
		h.nameOfIssuer = strings.Join(cleaned[:len(cleaned)-1], " ")
		h.titleOfClass = cleaned[len(cleaned)-1]
	} else if len(cleaned) == 1 {
		h.nameOfIssuer = cleaned[0]
	}

	// Right of CUSIP: value, shares, type, discretion, voting.
	right := strings.TrimSpace(upper[cusipIdx+len(cusipStr):])

	// Find SH/PRN indicator.
	if m := reSHPRN.FindString(right); m != "" {
		h.sharesType = m
	}

	// Find investment discretion.
	if m := reInvDisc.FindString(right); m != "" {
		h.investmentDiscretion = m
	}

	// Try BCS cascade first for value/shares extraction.
	bcsVal, bcsShr, bcsSHType, bcsOK := extractBCSCascade(upper, cusipStr)
	if bcsOK {
		h.value = bcsVal
		h.shares = bcsShr
		if bcsSHType != "" && h.sharesType == "" {
			h.sharesType = bcsSHType
		}

		// Still need voting authority from the right side.
		nums := extractNumbers(right)
		if len(nums) >= 5 {
			h.votingSole = nums[len(nums)-3]
			h.votingShared = nums[len(nums)-2]
			h.votingNone = nums[len(nums)-1]
		} else if len(nums) >= 4 {
			// Fewer numbers than expected — try last 3 as voting.
			h.votingSole = nums[len(nums)-3]
			h.votingShared = nums[len(nums)-2]
			h.votingNone = nums[len(nums)-1]
		} else if len(nums) >= 3 {
			h.votingSole = nums[len(nums)-1]
		}

		// F6: If BCS captured a concatenated value+shares as one
		// number (P3b), try to split using any other number on the
		// right that is a suffix of the huge shares number.
		if bcsVal == 0 && bcsShr > 1_000_000_000 && len(nums) >= 2 {
			sharesStr := strconv.FormatInt(bcsShr, 10)
			for i := 1; i < len(nums); i++ {
				cand := nums[i]
				if cand > 0 && cand < bcsShr {
					candStr := strconv.FormatInt(cand, 10)
					if strings.HasSuffix(sharesStr, candStr) && len(sharesStr) > len(candStr) {
						valStr := sharesStr[:len(sharesStr)-len(candStr)]
						if v, err := strconv.ParseInt(valStr, 10, 64); err == nil {
							h.value = v
							h.shares = cand
							break
						}
					}
				}
			}
		}
		return h
	}

	// Fallback: extract all numbers from the right side.
	nums := extractNumbers(right)

	if len(nums) >= 2 {
		h.value = nums[0]
		h.shares = nums[1]
	} else if len(nums) == 1 {
		// Might be shares only or value only; assign as shares.
		h.shares = nums[0]
	}

	// Voting authority: the last 3 numbers (if we have enough).
	// Pattern: value, shares, [sole, shared, none]
	if len(nums) >= 5 {
		h.votingSole = nums[len(nums)-3]
		h.votingShared = nums[len(nums)-2]
		h.votingNone = nums[len(nums)-1]
	}

	return h
}

// extractNumbers finds all numeric tokens in a string, strips commas,
// and converts them to int64.
func extractNumbers(s string) []int64 {
	tokens := reNumber.FindAllString(s, -1)
	result := make([]int64, 0, len(tokens))
	for _, tok := range tokens {
		tok = strings.ReplaceAll(tok, ",", "")
		// Handle floats by truncating.
		if strings.Contains(tok, ".") {
			f, err := strconv.ParseFloat(tok, 64)
			if err != nil {
				continue
			}
			result = append(result, int64(f))
		} else {
			n, err := strconv.ParseInt(tok, 10, 64)
			if err != nil {
				continue
			}
			result = append(result, n)
		}
	}
	return result
}

// parseContinuationLine tries to extract voting authority numbers from a
// continuation line (a line without a CUSIP).
func parseContinuationLine(line string) (sole, shared, none int64, ok bool) {
	nums := extractNumbers(line)
	if len(nums) == 3 {
		return nums[0], nums[1], nums[2], true
	}
	if len(nums) == 1 {
		return nums[0], 0, 0, true
	}
	return 0, 0, 0, false
}

// parseText parses a pre-2013Q3 text/SGML 13F filing.
// buf is the full file content. filePath is for diagnostics.
func parseText(buf []byte, filePath string) (*ParseResult, error) {
	result := &ParseResult{
		Meta: FilingMeta{
			FilePath:  filePath,
			ParseMode: "text",
		},
	}

	if len(buf) == 0 {
		result.Meta.ParseStatus = "error"
		result.Meta.ErrorMsg = "empty filing"
		return result, nil
	}

	// 1. Extract SGML header fields.
	meta := parseHeaderLocal(buf)
	result.Meta.Accession = meta.Accession
	result.Meta.CIK = meta.CIK
	result.Meta.PeriodOfReport = meta.PeriodOfReport
	result.Meta.FiledDate = meta.FiledDate
	result.Meta.FormType = meta.FormType
	result.Meta.CompanyName = meta.CompanyName

	if result.Meta.PeriodOfReport == "" {
		result.Meta.ParseStatus = "error"
		result.Meta.ErrorMsg = "cannot find CONFORMED PERIOD OF REPORT"
		return result, nil
	}

	// Determine amendment status.
	isAmendment := strings.Contains(result.Meta.FormType, "/A")
	amendmentType := ""
	if isAmendment {
		upper := strings.ToUpper(string(buf))
		if strings.Contains(upper, "RESTATEMENT") {
			amendmentType = "RESTATEMENT"
		} else if strings.Contains(upper, "NEW HOLDINGS") {
			amendmentType = "NEW HOLDINGS"
		}
	}

	// Determine column swap.
	needSwap := colswapSet[result.Meta.Accession]
	// Dutch pension CIK 918509 pre-2005.
	cikTrimmed := strings.TrimLeft(result.Meta.CIK, "0")
	if cikTrimmed == "918509" && result.Meta.PeriodOfReport < "20050101" {
		needSwap = true
	}

	// 2. Find the holdings table body.
	// Multi-page filings may have multiple <TABLE>...</TABLE> blocks
	// (e.g., American Century with 27 <PAGE>/<TABLE> blocks). We must
	// scan ALL such blocks, not just the first one.
	upperBuf := bytes.ToUpper(buf)
	lines := splitLines(upperBuf)

	// Collect line indices that are inside any <TABLE>...</TABLE> pair.
	// If no <TABLE> tags exist, fall back to scanning from after the
	// SEC-HEADER / DOCUMENT tag.
	var scanLines []int
	hasTableTag := false
	inTable := false
	for i, line := range lines {
		if reTableStart.Match(line) {
			hasTableTag = true
			inTable = true
			continue // skip the <TABLE> tag line itself
		}
		if reTableEnd.Match(line) {
			inTable = false
			continue // skip the </TABLE> tag line itself
		}
		if inTable {
			scanLines = append(scanLines, i)
		}
	}
	if !hasTableTag {
		// No <TABLE> tag found. Scan from after the SEC-HEADER or
		// the first <DOCUMENT> tag, whichever comes later, to avoid
		// matching SGML header content as holdings data.
		startFrom := 0
		for i, line := range lines {
			lineStr := string(line)
			if strings.Contains(lineStr, "</SEC-HEADER>") ||
				strings.Contains(lineStr, "<DOCUMENT>") {
				startFrom = i + 1
			}
		}
		for i := startFrom; i < len(lines); i++ {
			scanLines = append(scanLines, i)
		}
	}

	// 3. Parse holdings lines.
	var holdings []*holdingLine
	for _, i := range scanLines {
		lineStr := string(lines[i])

		// Normalize tabs to double-space (prevents tab bleed into TSV output
		// and ensures reMultiSpace splits on tab positions).
		lineStr = strings.ReplaceAll(lineStr, "\t", "  ")

		// Normalize pipe column separators to spaces (handles pipe-delimited filings).
		lineStr = strings.ReplaceAll(lineStr, "|", " ")

		// Skip header/separator lines (including dashed separators).
		if isHeaderOrSeparator(lineStr) {
			continue
		}

		// Pre-process: join split/dashed CUSIPs (e.g., "066365-10-7" → "066365107").
		lineStr = preprocessSplitCUSIP(lineStr)

		// Pre-process: separate digits+SH / digits+PRN concatenation.
		lineStr = preprocessSHPRN(lineStr)

		// Strip embedded prices.
		lineStr = stripEmbeddedPrice(lineStr)

		// Strip quotes.
		lineStr = strings.ReplaceAll(lineStr, "\"", "")

		// Check if line has a valid standalone CUSIP token.
		hasCUSIP := containsValidCUSIP(lineStr)

		if hasCUSIP {
			var h *holdingLine
			if isCommaDelimited(lineStr) {
				h = parseCommaLine(lineStr)
			} else {
				h = parseLine(lineStr)
			}
			if h != nil {
				h.rawLine = lineStr
				holdings = append(holdings, h)
			}
		} else if len(holdings) > 0 {
			// Continuation line: append voting authority to the last holding.
			sole, shared, none, ok := parseContinuationLine(lineStr)
			if ok {
				last := holdings[len(holdings)-1]
				// Only set if the previous holding doesn't already have voting.
				if last.votingSole == 0 && last.votingShared == 0 && last.votingNone == 0 {
					last.votingSole = sole
					last.votingShared = shared
					last.votingNone = none
				}
			}
		}
	}

	// 4. Apply filters and build output rows.
	for _, h := range holdings {
		// Filter derivatives: check the full raw line (matches BCS grep behavior).
		if isDerivative(h.rawLine) {
			continue
		}

		// Filter PRN (principal amount / bonds).
		if h.sharesType == "PRN" {
			continue
		}

		// Default shares type to SH if not set.
		if h.sharesType == "" {
			h.sharesType = "SH"
		}

		// Apply column swap.
		value := h.value
		shares := h.shares
		if needSwap {
			value, shares = shares, value
		}

		// Normalize CUSIP.
		cusip9, cusip8, cusip6, valid := normalizeCUSIP(h.cusip)

		row := Row{
			FilePath:             filePath,
			Accession:            result.Meta.Accession,
			CIK:                  result.Meta.CIK,
			PeriodOfReport:       result.Meta.PeriodOfReport,
			FiledDate:            result.Meta.FiledDate,
			FormType:             result.Meta.FormType,
			NameOfIssuer:         h.nameOfIssuer,
			TitleOfClass:         h.titleOfClass,
			CUSIP9:               cusip9,
			CUSIP8:               cusip8,
			CUSIP6:               cusip6,
			Value:                value,
			Shares:               shares,
			SharesType:           h.sharesType,
			InvestmentDiscretion: h.investmentDiscretion,
			OtherManager:         h.otherManager,
			VotingSole:           h.votingSole,
			VotingShared:         h.votingShared,
			VotingNone:           h.votingNone,
			CUSIPValid:           valid,
			IsAmendment:          isAmendment,
			AmendmentType:        amendmentType,
			ParseMode:            "text",
		}
		result.Rows = append(result.Rows, row)
	}

	result.Meta.NRows = len(result.Rows)
	if result.Meta.ParseStatus == "" {
		result.Meta.ParseStatus = "ok"
	}

	return result, nil
}

// containsValidCUSIP checks if the line contains a token that looks like a
// valid CUSIP (8-9 chars of [0-9A-Z], standalone, with at least one digit).
// It checks both whitespace-delimited and comma-delimited tokens.
// Also detects class+CUSIP concatenation as a fallback.
func containsValidCUSIP(line string) bool {
	fields := reSplitTokens.Split(line, -1)
	for _, f := range fields {
		f = strings.TrimSpace(f)
		if (len(f) == 8 || len(f) == 9) && reCUSIPToken.MatchString(f) && reHasDigit.MatchString(f) {
			if reSHPRNSuffix.MatchString(f) {
				continue
			}
			return true
		}
	}
	// Fallback: check for class+CUSIP concatenation.
	if reClassCUSIP.MatchString(strings.ToUpper(line)) {
		return true
	}
	return false
}

// findCUSIPToken returns the first standalone CUSIP-like token in the line
// and its byte offset, or ("", -1) if none found.
// It rejects tokens ending with SH/PR/PRN (share-count bleed).
// If no standalone CUSIP is found, it falls back to extracting a CUSIP
// concatenated with a class prefix (e.g., COMMON88579Y101).
func findCUSIPToken(line string) (string, int) {
	fields := strings.Fields(line)
	for _, f := range fields {
		if (len(f) == 8 || len(f) == 9) && reCUSIPToken.MatchString(f) && reHasDigit.MatchString(f) {
			// Reject tokens that end with SH, PR, or PRN — these are
			// share counts bleeding into the next field.
			if reSHPRNSuffix.MatchString(f) {
				continue
			}
			idx := strings.Index(line, f)
			return f, idx
		}
	}

	// Fallback: try to find a class keyword concatenated with a CUSIP.
	m := reClassCUSIP.FindStringSubmatchIndex(line)
	if m != nil {
		// m[4] and m[5] are the start/end of the CUSIP capture group.
		cusip := line[m[4]:m[5]]
		if len(cusip) >= 8 && len(cusip) <= 9 && reHasDigit.MatchString(cusip) {
			// Return the CUSIP and the byte offset of the CUSIP within the
			// concatenated token. This way left = everything before the
			// class prefix+CUSIP, and right = everything after the CUSIP.
			return cusip, m[4]
		}
	}

	return "", -1
}

// splitLines splits a byte buffer into lines, preserving line content.
func splitLines(buf []byte) [][]byte {
	var lines [][]byte
	scanner := bufio.NewScanner(bytes.NewReader(buf))
	// Increase buffer size for very long lines.
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := make([]byte, len(scanner.Bytes()))
		copy(line, scanner.Bytes())
		lines = append(lines, line)
	}
	if err := scanner.Err(); err != nil {
		fmt.Fprintf(os.Stderr, "text_parser: splitLines error: %v\n", err)
	}
	return lines
}
