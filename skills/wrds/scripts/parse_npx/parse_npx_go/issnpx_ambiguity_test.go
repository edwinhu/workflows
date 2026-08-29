package main

import "testing"

// An AMBIGUOUS banner is the filing declining to say which fund a section is.
// seriesByName maps a normalised name shared by two distinct series to nothing
// precisely so that refusal is preserved, and issResolveFund's own doc comment
// says an ambiguous heading "is a refusal to choose, not a failed lookup, and is
// never retried".
//
// The D2 index-letter repair can violate that. When the banner as PRINTED is
// ambiguous, the lookup returns no entry but sets `declared`; the leading-letter
// alternative then resolves cleanly and is returned before `declared` is ever
// consulted. The result is a stamp on a name the filing refused to disambiguate,
// chosen by a rule that exists only to strip a typographic index marker.
//
// This matters more than its frequency suggests: series_id is the link key into
// the ISS panel, so the wrong one moves a fund's votes to another fund. Every
// other path in this file already refuses to reopen an ambiguous name.

func TestISSNPXAmbiguousBannerIsNotRescuedByTheIndexLetter(t *testing.T) {
	// "A Growth Fund" is declared by TWO distinct series, so the printed banner
	// is ambiguous. Dropping the leading "A" as an index marker yields
	// "Growth Fund", which resolves uniquely -- the shape that triggers the
	// early return.
	series := [][3]string{
		{"S000000111", "A Growth Fund", "C000000111"},
		{"S000000222", "A Growth Fund", "C000000222"},
		{"S000000333", "Growth Fund", "C000000333"},
	}
	doc := issnpxSeriesDoc(series, issnpxFundSection("A GROWTH FUND", "APPLE INC.", "037833100"))

	for i, r := range runISSNPXDoc(t, doc) {
		if got := r[colSeriesID]; got != "" {
			t.Errorf("row %d stamped series_id %q. The banner prints \"A GROWTH FUND\","+
				" which TWO distinct series answer to, so the filing has not said which"+
				" fund this section is and the only correct answer is no stamp."+
				" Dropping the leading letter as an index marker is a typographic repair,"+
				" not evidence about which fund the filing meant.", i, got)
		}
	}
}
