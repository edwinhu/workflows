package main

import (
	"regexp"
	"strings"
)

// extractors_sc_to — Schedule TO custom field extractors.
//
// These handle multi-pattern extraction for fields that appear in different
// forms across initial filings vs amendments vs final amendments.

// ---------------------------------------------------------------------------
// Expiration date — extracts the tender offer expiration date.
//
// Multiple patterns tried in priority order:
//   1. Extension amendment: "is being extended...to...on [DATE]"
//   2. Expired: "Offer expired at...on [DATE]"
//   3. Banner: "THE OFFER AND WITHDRAWAL RIGHTS EXPIRE...ON [DATE]"
//   4. Summary: "Scheduled Expiration of Offer...on [DATE]"
// ---------------------------------------------------------------------------

// reMonthDate matches "January 29, 2025", "MAY 15, 2026", etc.
// Used as a suffix in expiration-date patterns to avoid lazy quantifiers
// eating the first letter of the month name.
const monthDatePat = `((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})`

var reExpirationPatterns = []*regexp.Regexp{
	// Extension: "extended to [DATE]" or "extended...to...on [DATE]"
	// Match "to" then optional filler then the month-day-year date.
	regexp.MustCompile(`(?i)(?:is\s+being|has\s+been)\s+extended[\s\S]{0,300}?(?:to|until)\s+[\s\S]{0,100}?` + monthDatePat),

	// Expired: "Offer expired at...on [DATE]"
	regexp.MustCompile(`(?i)(?:the\s+)?[Oo]ffer\s+expired[\s\S]{0,200}?on\s+(?:\w+,?\s+)?` + monthDatePat),

	// Banner (initial filings, often ALL CAPS): "EXPIRE...ON [DATE]"
	regexp.MustCompile(`(?i)OFFER\s+AND\s+WITHDRAWAL\s+RIGHTS\s+EXPIRE[\s\S]{0,200}?ON\s+` + monthDatePat),

	// Summary term sheet: "Scheduled Expiration of Offer...on [DATE]"
	regexp.MustCompile(`(?i)Scheduled\s+Expiration\s+of\s+Offer[\s\S]{0,300}?on\s+` + monthDatePat),
}

func extractExpirationDate(buf []byte) string {
	text := string(buf)
	for _, re := range reExpirationPatterns {
		if m := re.FindStringSubmatch(text); m != nil {
			return cleanField(m[1])
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// is_extension — detects if this amendment extends the offer period.
// Returns "1" for extension, "0" for explicit non-extension, "" for unknown.
// ---------------------------------------------------------------------------

var (
	// Positive extension: the offer IS BEING / HAS BEEN extended (present/past
	// tense). "previously scheduled to expire...is being extended" is the
	// strongest signal. Exclude hypothetical language like "unless...extended"
	// or "can the offer be extended".
	reIsExtension = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(?:the\s+)?[Oo]ffer[\s\S]{0,100}?is\s+being\s+extended`),
		regexp.MustCompile(`(?i)(?:the\s+)?[Oo]ffer[\s\S]{0,100}?has\s+been\s+extended`),
		regexp.MustCompile(`(?i)[Ee]xtends?\s+(?:the\s+)?[Tt]ender\s+[Oo]ffer`),
		regexp.MustCompile(`(?i)extending\s+the\s+(?:expiration|offer)`),
	}
	reNotExtension = []*regexp.Regexp{
		regexp.MustCompile(`(?i)(?:the\s+)?[Oo]ffer\s+was\s+not\s+extended`),
		regexp.MustCompile(`(?i)expired\s+as\s+scheduled`),
	}
	// Hypothetical / generic language that should NOT trigger is_extension.
	reExtensionFalsePositive = []*regexp.Regexp{
		regexp.MustCompile(`(?i)unless[\s\S]{0,40}?extended`),
		regexp.MustCompile(`(?i)can\s+the\s+offer\s+be\s+extended`),
		regexp.MustCompile(`(?i)may\s+be\s+extended`),
	}
)

func extractIsExtension(buf []byte) string {
	text := string(buf)

	// Check explicit non-extension first (strongest signal)
	for _, re := range reNotExtension {
		if re.MatchString(text) {
			return "0"
		}
	}

	// Check positive extension signals
	for _, re := range reIsExtension {
		if re.MatchString(text) {
			return "1"
		}
	}

	return ""
}

// ---------------------------------------------------------------------------
// is_final — detects if this is a final amendment reporting tender results.
// Returns "1" if final, "" otherwise.
// ---------------------------------------------------------------------------

var reIsFinal = []*regexp.Regexp{
	// Accepted for payment
	regexp.MustCompile(`(?i)(?:accepted|irrevocably\s+accepted)\s+for\s+payment\s+all\s+(?:\w+\s+)?[Ss]hares`),

	// Tender results with share counts
	regexp.MustCompile(`(?i)total\s+of\s+[\d,]+\s+(?:\w+\s+)?[Ss]hares\s+(?:had\s+been|were)\s+validly\s+tendered`),

	// Merger completion
	regexp.MustCompile(`(?i)(?:effected|completed)\s+the\s+[Mm]erger`),
	regexp.MustCompile(`(?i)merged\s+with\s+and\s+into`),

	// Delisting
	regexp.MustCompile(`(?i)[Ss]hares\s+ceased\s+to\s+trade`),
}

func extractIsFinal(buf []byte) string {
	text := string(buf)

	// Only flag amendments as "final" — initial filings (SC TO-T, SC TO-I
	// without /A) contain Letter of Transmittal boilerplate with "accepted
	// for payment" language that triggers false positives.
	m := reFormType.FindSubmatch(buf)
	if m == nil {
		return ""
	}
	form := strings.TrimSpace(string(m[1]))
	if !strings.HasSuffix(form, "/A") {
		return ""
	}

	for _, re := range reIsFinal {
		if re.MatchString(text) {
			return "1"
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// shares_tendered — extracts the total number of shares validly tendered
// from final amendments. Returns the raw count string (with commas stripped).
// ---------------------------------------------------------------------------

var reSharesTendered = regexp.MustCompile(
	`(?i)total\s+of\s+([\d,]+)\s+(?:\w+\s+)?[Ss]hares\s+(?:had\s+been|were)\s+validly\s+tendered`,
)

func extractSharesTendered(buf []byte) string {
	m := reSharesTendered.FindSubmatch(buf)
	if m == nil {
		return ""
	}
	return strings.ReplaceAll(string(m[1]), ",", "")
}

// ---------------------------------------------------------------------------
// pct_tendered — extracts the percentage of outstanding shares tendered.
// Returns the numeric percentage (e.g., "81.8").
// ---------------------------------------------------------------------------

var rePctTendered = regexp.MustCompile(
	`(?i)representing\s+approximately\s+([\d.]+)\s*%`,
)

func extractPctTendered(buf []byte) string {
	m := rePctTendered.FindSubmatch(buf)
	if m == nil {
		return ""
	}
	return string(m[1])
}
