package main

import (
	"bytes"
	"regexp"
	"strings"
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

	// One pattern for all three series tags: the triples are recovered by a
	// state machine over the matches in document order, never by a first-match
	// lookup, which would report one series for a filing that carries dozens.
	reSeriesTag = regexp.MustCompile(
		`<(SERIES-ID|CLASS-CONTRACT-ID|CLASS-CONTRACT-TICKER-SYMBOL)>([^<\r\n]*)`)
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
	return meta
}

// parseSeriesClasses returns every series/class/ticker triple in the SGML
// header, in document order. A class contract with no ticker still yields a
// triple, with an empty Ticker.
func parseSeriesClasses(buf []byte) []SeriesClass {
	head := headerRegion(buf)

	var out []SeriesClass
	series := ""
	for _, m := range reSeriesTag.FindAllSubmatch(head, -1) {
		val := strings.TrimSpace(string(m[2]))
		switch string(m[1]) {
		case "SERIES-ID":
			series = val
		case "CLASS-CONTRACT-ID":
			out = append(out, SeriesClass{SeriesID: series, ClassID: val})
		case "CLASS-CONTRACT-TICKER-SYMBOL":
			// The ticker follows its class-contract id inside the same
			// <CLASS-CONTRACT> block, so it belongs to the last triple opened.
			if n := len(out); n > 0 && out[n-1].Ticker == "" {
				out[n-1].Ticker = val
			}
		}
	}
	return out
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
