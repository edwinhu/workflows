package main

import (
	"bytes"
	"regexp"
	"strings"
	"unicode"
)

// Header parsing for the EDGAR dissemination SGML header.
//
// The header of an N-PX filing is not small: a registrant files for dozens of
// series at once, each carrying several class contracts, so the
// <SERIES-AND-CLASSES-CONTRACTS-DATA> block routinely runs past the 4 KB head
// that a 13F header parser can get away with. Everything here is bounded by the
// </SEC-HEADER> marker instead, searched within headerScanLimit bytes so a
// 200 MB filing never has its whole body scanned.

const (
	// headerScanLimit caps the search for </SEC-HEADER>.
	headerScanLimit = 1 << 20
	// headerFallback is how much of the file is treated as header when the
	// </SEC-HEADER> marker is absent or truncated away.
	headerFallback = 64 << 10
)

var (
	rePeriod      = regexp.MustCompile(`CONFORMED PERIOD OF REPORT:\s*(\d{8})`)
	reFiledDate   = regexp.MustCompile(`FILED AS OF DATE:\s*(\d{8})`)
	reSubType     = regexp.MustCompile(`CONFORMED SUBMISSION TYPE:\s*([^\r\n]+)`)
	reCompanyName = regexp.MustCompile(`COMPANY CONFORMED NAME:\s*([^\r\n]+)`)
	reCIK         = regexp.MustCompile(`CENTRAL INDEX KEY:\s*(\d+)`)
	reAccession   = regexp.MustCompile(`ACCESSION NUMBER:\s*([^\r\n]+)`)

	// One pattern for all four series tags: the records are recovered by a
	// state machine over the matches in document order, never by a first-match
	// lookup, which would report one series for a filing that carries dozens.
	reSeriesTag = regexp.MustCompile(
		`<(SERIES-ID|SERIES-NAME|CLASS-CONTRACT-ID|CLASS-CONTRACT-TICKER-SYMBOL)>([^<\r\n]*)`)
)

// headerRegion returns the slice of buf holding the SGML header.
func headerRegion(buf []byte) []byte {
	limit := buf
	if len(limit) > headerScanLimit {
		limit = limit[:headerScanLimit]
	}
	if i := bytes.Index(limit, []byte("</SEC-HEADER>")); i >= 0 {
		return limit[:i]
	}
	if len(limit) > headerFallback {
		return limit[:headerFallback]
	}
	return limit
}

// parseHeader reads the SGML header fields of a dissemination file.
func parseHeader(buf []byte) FilingMeta {
	head := headerRegion(buf)

	var meta FilingMeta
	if m := reAccession.FindSubmatch(head); m != nil {
		meta.Accession = strings.TrimSpace(string(m[1]))
	}
	if m := reSubType.FindSubmatch(head); m != nil {
		meta.FormType = strings.TrimSpace(string(m[1]))
	}
	if m := rePeriod.FindSubmatch(head); m != nil {
		meta.PeriodOfReport = string(m[1])
	}
	if m := reFiledDate.FindSubmatch(head); m != nil {
		meta.FiledDate = string(m[1])
	}
	if m := reCompanyName.FindSubmatch(head); m != nil {
		meta.CompanyName = strings.TrimSpace(string(m[1]))
	}
	if m := reCIK.FindSubmatch(head); m != nil {
		meta.CIK = string(m[1])
	}
	// The series declarations travel with the manifest row so a layout parser can
	// attribute a vote to the series its fund heading names. They are not a
	// manifest column and never reach FilingMeta.TSV.
	_, meta.SeriesDecls = parseSeriesDecls(buf)
	return meta
}

// parseSeriesClasses returns every series/class/ticker triple in the SGML
// header, in document order. A class contract with no ticker still yields a
// triple, with an empty Ticker.
func parseSeriesClasses(buf []byte) []SeriesClass {
	sc, _ := parseSeriesDecls(buf)
	return sc
}

// parseSeriesDecls walks the header's series tags once and returns both views of
// them, because they are not the same set.
//
// The triples exist one per <CLASS-CONTRACT-ID>, so a series declaring NO class
// contract has no triple at all — its id and name vanish together. The decls are
// one per <SERIES-ID>, so that series survives and stays available for
// attribution. <SERIES-NAME> sits between <SERIES-ID> and the first
// <CLASS-CONTRACT>, and is carried onto the decl the series opened.
//
// The triples' shape is left exactly as it was: it is the chassis's input, and
// widening it would change what a single-series filing stamps.
func parseSeriesDecls(buf []byte) ([]SeriesClass, []SeriesDecl) {
	head := headerRegion(buf)

	var (
		classes []SeriesClass
		decls   []SeriesDecl
	)
	series := ""
	open := false

	for _, m := range reSeriesTag.FindAllSubmatch(head, -1) {
		val := strings.TrimSpace(string(m[2]))
		switch string(m[1]) {
		case "SERIES-ID":
			series = val
			open = true
			decls = append(decls, SeriesDecl{SeriesID: val})
		case "SERIES-NAME":
			// Belongs to the series block it sits inside. A name arriving before
			// any <SERIES-ID> belongs to no declared series and is dropped.
			if open {
				decls[len(decls)-1].Name = val
			}
		case "CLASS-CONTRACT-ID":
			classes = append(classes, SeriesClass{SeriesID: series, ClassID: val})
			if open {
				d := &decls[len(decls)-1]
				d.ClassIDs = append(d.ClassIDs, val)
			}
		case "CLASS-CONTRACT-TICKER-SYMBOL":
			// The ticker follows its class-contract id inside the same
			// <CLASS-CONTRACT> block, so it belongs to the last triple opened.
			if n := len(classes); n > 0 && classes[n-1].Ticker == "" {
				classes[n-1].Ticker = val
			}
		}
	}
	return classes, decls
}

// seriesIDs returns the distinct series ids of the triples, in first-seen order.
func seriesIDs(sc []SeriesClass) []string {
	seen := map[string]bool{}
	var out []string
	for _, s := range sc {
		if s.SeriesID != "" && !seen[s.SeriesID] {
			seen[s.SeriesID] = true
			out = append(out, s.SeriesID)
		}
	}
	return out
}

// normalizeSeriesName folds a fund name onto the form used to match a legacy
// body heading against a declared <SERIES-NAME>. The corpus shows three
// differences and only three: the body heading is uppercased, the header spells
// the registered and trademark marks the body drops, and the surrounding
// punctuation and whitespace differ ("SPDR(R) S&P(R) China ETF" against
// "SPDR S&P CHINA ETF").
//
// It therefore folds case, deletes the mark glyphs, and treats every other
// non-alphanumeric rune as a separator. Letters and DIGITS are kept: dropping
// either would collapse "Growth Fund II" onto "Growth Fund" and silently move one
// fund's votes onto another. Nothing is stemmed, abbreviated or truncated.
//
// Three punctuation-only widenings sit on top of that, and only three. The body
// heading spells an ampersand where the header spells the word ("MML Growth &
// Income Fund"); a '/' in a registered name reaches this corpus mojibaked to '?'
// ("Claymore?Sabrient Stealth Portfolio"); and a leading article is dropped by
// one side or the other. Each is a difference in how the SAME name was printed,
// never a difference between names, which is why they are folded here and why
// nothing else is: measured across all 106,719 declared series, the three
// together merge ZERO pairs of distinct series that the folding above separates.
// Anything that stems, drops a stopword, strips a suffix noun or measures an edit
// distance does merge such pairs — "PIMCO Low Duration Fund" and "PIMCO Low
// Duration Portfolio" are different registered series — and must not be added.
func normalizeSeriesName(s string) string {
	s = strings.ToLower(s)
	// An SGML header can carry an ampersand encoded once or twice
	// (`S&amp;amp;P 500`); decode until stable so it folds like the body's `&`.
	for strings.Contains(s, "&amp;") {
		s = strings.ReplaceAll(s, "&amp;", "&")
	}
	s = seriesMarkReplacer.Replace(s)
	s = seriesPunctReplacer.Replace(s)

	var b strings.Builder
	b.Grow(len(s))
	space := false
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if space && b.Len() > 0 {
				b.WriteByte(' ')
			}
			space = false
			b.WriteRune(r)
			continue
		}
		space = true
	}
	// A leading article is dropped after folding, not before, so it is only ever
	// removed as a whole token: "The Growth Fund" folds onto "growth fund" while
	// "Theta Fund" is untouched. Never applied to a heading that is nothing but
	// the article, which would key an empty string.
	if rest, ok := strings.CutPrefix(b.String(), "the "); ok {
		return rest
	}
	return b.String()
}

// seriesMarkReplacer deletes the registered/trademark marks. The ASCII spellings
// must go before punctuation folding, because "(r)" would otherwise leave a bare
// "r" token that the body heading does not carry.
var seriesMarkReplacer = strings.NewReplacer(
	"(r)", "", "(tm)", "", "(sm)", "", "(c)", "",
	"®", "", "™", "", "℠", "", "©", "",
)

// seriesPunctReplacer runs after the marks and before punctuation folding, which
// is the only point at which these two characters are still distinguishable from
// the separators everything else becomes. '&' must expand to the WORD, since
// folding alone would delete it and glue "s" to "p"; '?' must become a separator
// rather than expand to anything, because the character it stands in for is '/'.
var seriesPunctReplacer = strings.NewReplacer(
	"&", " and ",
	"?", " ",
)

// seriesByName maps each declared series name, normalised, onto its series id.
//
// A normalised name that two DISTINCT series share maps to the empty string: a
// series_id is the link key into the ISS panel, so attributing a vote to the
// wrong fund is silently worse than leaving the column blank. Nothing here
// guesses — a heading that is not in this map, or that resolves to the empty
// string, stamps nothing at all.
func seriesByName(decls []SeriesDecl) map[string]*SeriesDecl {
	out := make(map[string]*SeriesDecl, len(decls))
	for i := range decls {
		d := &decls[i]
		if d.SeriesID == "" || d.Name == "" {
			continue
		}
		key := normalizeSeriesName(d.Name)
		if key == "" {
			continue
		}
		prev, seen := out[key]
		if !seen {
			out[key] = d
			continue
		}
		if prev != nil && prev.SeriesID != d.SeriesID {
			out[key] = nil // ambiguous: two series answer to this name
		}
	}
	return out
}

// lookupSeriesByName resolves one body heading to the series the header declares
// under that name, or to nil when the heading names no declared series or an
// ambiguous one. A nil result means stamp nothing.
func lookupSeriesByName(idx map[string]*SeriesDecl, heading string) *SeriesDecl {
	d, _ := lookupSeriesEntry(idx, heading)
	return d
}

// lookupSeriesEntry is lookupSeriesByName plus the one distinction the collision
// rule needs: declared reports whether the header spells this normalised name AT
// ALL. A name two distinct series answer to is present in the index mapped to
// nil, so d==nil,declared==true is the deliberate refusal to guess between them,
// while d==nil,declared==false is simply a name the filing never declared.
//
// Only the second may be retried under a tolerance. Retrying an AMBIGUOUS name
// converts a refusal into a stamp, which is exactly what seriesByName's collision
// rule exists to prevent.
func lookupSeriesEntry(idx map[string]*SeriesDecl, heading string) (d *SeriesDecl, declared bool) {
	key := normalizeSeriesName(heading)
	if key == "" {
		return nil, false
	}
	d, declared = idx[key]
	return d, declared
}

// lookupSeriesStrippingRegistrant resolves a heading whose leading tokens are
// exactly the filing's OWN registrant name -- the COMPANY CONFORMED NAME its own
// SGML header declares -- by deleting that prefix and requiring the remainder to
// equal a declared <SERIES-NAME> under the same exact normalised equality
// everything else demands.
//
// It is a deletion of one string the filing itself spells, not a tolerance: the
// prefix removed is character-exact against the registrant name after folding,
// the boundary is a whole token so a registrant name cannot eat into the fund's,
// and the remainder must match exactly and unambiguously. It exists because the
// banner of a wrapped fund heading prints the complex before the fund
// ("MORGAN STANLEY INSTITUTIONAL FUND INC. ACTIVE INTERNATIONAL ALLOCATION
// PORTFOLIO" for a series declared "ACTIVE INTERNATIONAL ALLOCATION PORTFOLIO"),
// so reassembling the banner is necessary but not sufficient.
//
// The caller must have tried the heading AS PRINTED first and failed. A heading
// the header declares AMBIGUOUSLY has not failed -- it is a refusal to choose
// between two series -- and retrying it here would convert that refusal into a
// stamp, so the caller passes only genuinely unresolved headings.
//
// Returns nil, which means stamp nothing, whenever any of that does not hold.
//
// prefix is the registrant name ALREADY normalised. The registrant is a
// per-filing constant while this runs once per unresolved banner, so folding it
// here would make the strip cost O(banners x len(registrant name)) on input the
// filer controls end to end; the caller folds it once per filing instead.
func lookupSeriesStrippingRegistrant(idx map[string]*SeriesDecl, heading, prefix string) *SeriesDecl {
	if prefix == "" {
		return nil
	}
	rest, ok := strings.CutPrefix(normalizeSeriesName(heading), prefix)
	if !ok {
		return nil
	}
	// Normalised keys are single-space separated, so a leading space is exactly
	// the token boundary: without it "Growth Trust" would strip out of
	// "Growth Trustee Fund".
	rest, ok = strings.CutPrefix(rest, " ")
	if !ok || rest == "" {
		return nil
	}
	return lookupSeriesByName(idx, rest)
}

// lookupSeriesTolerant resolves a body heading to a declared series, allowing
// the ONE tolerance a full-corpus recon could justify: several registrants print
// the heading with a leading internal fund code ("2A14 Mid Cap Core Trust",
// "2CZ5 High Yield Fund") that the header never spells. That token is dropped and
// the remainder retried, and ONLY after the heading as printed has failed —
// hand-verified at 0 errors in 25 accepts, 883 distinct headings.
//
// Nothing else is tolerated. Suffix stripping (dropping a trailing "fund",
// "trust", "portfolio") was measured at 1 WRONG accept in 25: it collapses the
// REGISTRANT name "The Tocqueville Trust" onto its own series "The Tocqueville
// Fund" and moves 309 blocks of votes onto a fund that did not cast them. A
// series_id is a link key, so a wrong one silently transfers votes between funds
// and is far worse than a blank; no fuzzy, prefix, substring or edit-distance
// rule may be added here.
func lookupSeriesTolerant(idx map[string]*SeriesDecl, heading string) *SeriesDecl {
	d, _ := lookupSeriesTolerantEntry(idx, heading)
	return d
}

// lookupSeriesTolerantEntry is lookupSeriesTolerant plus the declared bit, under
// the same tolerance: declared reports that the filing's own header spells this
// normalised name — as printed, or with the leading internal fund code dropped —
// whether or not it spells it for exactly one series.
//
// The distinction is what a caller needs to tell a name the filing DECLARES
// TWICE from a line the filing does not name at all. Both stamp nothing, but only
// the first is evidence that the line is a fund heading: the filing has said this
// section belongs to some fund and refused to say which. A caller carrying a fund
// as state must CLEAR on it, because leaving the previous fund standing there
// files this section's votes under the section above — the silent transfer
// between funds the collision rule exists to prevent, one step along.
func lookupSeriesTolerantEntry(idx map[string]*SeriesDecl, heading string) (d *SeriesDecl, declared bool) {
	d, declared = lookupSeriesEntry(idx, heading)
	if d != nil || declared {
		// declared with d==nil is the header naming two distinct series. That is
		// a refusal to stamp, not a failed lookup, so the code strip must not
		// reopen it.
		return d, declared
	}
	fields := strings.Fields(heading)
	// The code may be printed in parentheses: `(ZW4X) GEI Total Return ...`.
	if len(fields) < 2 || !internalFundCode(strings.Trim(fields[0], "()")) {
		return nil, false
	}
	return lookupSeriesEntry(idx, strings.Join(fields[1:], " "))
}

// internalFundCode reports whether tok is a registrant's internal fund code:
// EXACTLY four alphanumeric characters carrying at least one digit. The digit is
// what keeps a real leading word of a fund name — "Core", "Gold", "High" — from
// ever being stripped, and the exact length is what keeps a longer word from it.
func internalFundCode(tok string) bool {
	if len(tok) != 4 {
		return false
	}
	digit := false
	for i := 0; i < len(tok); i++ {
		switch c := tok[i]; {
		case c >= '0' && c <= '9':
			digit = true
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z':
		default:
			return false
		}
	}
	return digit
}

// classIDsFor returns the class-contract ids belonging to one series id.
func classIDsFor(sc []SeriesClass, seriesID string) []string {
	var out []string
	for _, s := range sc {
		if s.SeriesID == seriesID && s.ClassID != "" {
			out = append(out, s.ClassID)
		}
	}
	return out
}
