package main

import "regexp"

// def14a_independence — the BOARD'S OWN director-independence determination.
//
// WHY THIS IS NOT A VENDOR FIELD. DGCL 144(d)(2) (Delaware SB 21, 2025) gives a
// heightened presumption of disinterestedness where "the board of directors
// shall have determined that such director satisfies the applicable criteria for
// determining director independence ... under the rules ... promulgated by such
// exchange". The legally operative object is the board's own determination, in
// the proxy. BoardEx `ned` and ISS `classification` are vendor labels applied ex
// post and are a different object; they also lag 9-13 months, while the EDGAR
// index is current to within days.
//
// RELATIONSHIP TO def14a_directors. That profile answers "who sat on the board"
// off the Name-Age anchor and deliberately does not classify the seat. This one
// classifies. It CALLS `extractDirectors`/`directorSet` rather than duplicating
// them, and changes nothing about that profile's behaviour — the slate column
// here is byte-identical to what def14a_directors emits for the same file.
//
// The packed `indep` column carries nine correlated outputs from ONE full-body
// normalisation pass; nine Custom fields would normalise a 1 MB buffer nine
// times. See extractIndependence for the layout and profiles/def14a_independence
// /build_panel.py for the split.
func init() {
	register(&Profile{
		Name:      "def14a_independence",
		HeadBytes: 8192,
		FullBody:  true,
		Forms:     []string{"DEF 14A", "DEFM14A"},
		Fields: []Field{
			{Name: "accession",
				Pattern: regexp.MustCompile(`ACCESSION NUMBER:[ \t]+([^\s]+)`),
				Reduce:  First},
			{Name: "form_type",
				Pattern: regexp.MustCompile(`CONFORMED SUBMISSION TYPE:[ \t]+([^\r\n]+)`),
				Reduce:  First},
			{Name: "filed_date",
				Pattern: regexp.MustCompile(`FILED AS OF DATE:[ \t]+([0-9]+)`),
				Reduce:  First},
			{Name: "cik",
				Pattern: regexp.MustCompile(`CENTRAL INDEX KEY:[ \t]+([0-9]+)`),
				Reduce:  First},
			{Name: "company_name",
				Pattern: regexp.MustCompile(`COMPANY CONFORMED NAME:[ \t]+([^\r\n]+)`),
				Reduce:  First},
			// Field 6 of the brief: board size and slate, from the filing itself.
			// Reuses def14a_directors' machinery verbatim.
			{Name: "n_directors", Custom: countDirectors},
			{Name: "slate", Custom: extractDirectors},
			// det_form|name_style|indep_names|n_indep|n_board|exchange|rule|
			// catstd_loc|considered|considered_names|match_text
			{Name: "indep", Custom: extractIndependence},
		},
	})
}
