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
func normalizeSeriesName(s string) string {
	s = strings.ToLower(s)
	s = seriesMarkReplacer.Replace(s)

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
	return b.String()
}

// seriesMarkReplacer deletes the registered/trademark marks. The ASCII spellings
// must go before punctuation folding, because "(r)" would otherwise leave a bare
// "r" token that the body heading does not carry.
var seriesMarkReplacer = strings.NewReplacer(
	"(r)", "", "(tm)", "", "(sm)", "", "(c)", "",
	"®", "", "™", "", "℠", "", "©", "",
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
	key := normalizeSeriesName(heading)
	if key == "" {
		return nil
	}
	return idx[key]
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
