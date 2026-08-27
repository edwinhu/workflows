package main

import "regexp"

// state_incorp_allforms — same SGML-header extraction as `state_incorp`, but with
// NO form-type restriction.
//
// WHY A SECOND PROFILE. `state_incorp` is pinned to 10-K/10-KSB, which makes the
// resulting panel annual and lagged: a reincorporation completed in spring 2026
// cannot appear until the next 10-K, so a point-in-time state at an event date in
// mid-2026 is unavailable by construction. EVERY EDGAR submission's SGML header
// carries `STATE OF INCORPORATION:`, so dropping the form filter yields
// near-continuous coverage (10-Q, 8-K, DEF 14A, S-8, ...) at filing-date grain.
// `state_incorp` is left untouched because other work depends on its behaviour.
//
// HeadBytes=8192 — header only, same cost per file as `state_incorp`.
// Body-text parsing is still avoided (72.7% HQ contamination; see state_incorp).
//
// `period` (CONFORMED PERIOD OF REPORT) is added so a filing can be dated by the
// period it covers as well as by its filing date.
func init() {
	register(&Profile{
		Name:      "state_incorp_allforms",
		HeadBytes: 8192,
		Forms:     nil, // accept any form; the staged filelist controls the universe
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
			{Name: "period",
				Pattern: regexp.MustCompile(`CONFORMED PERIOD OF REPORT:[ \t]+([0-9]+)`),
				Reduce:  First},
			{Name: "cik",
				Pattern: regexp.MustCompile(`CENTRAL INDEX KEY:[ \t]+([0-9]+)`),
				Reduce:  First},
			{Name: "company_name",
				Pattern: regexp.MustCompile(`COMPANY CONFORMED NAME:[ \t]+([^\r\n]+)`),
				Reduce:  First},
			{Name: "state_of_incorp",
				Pattern: regexp.MustCompile(`STATE OF INCORPORATION:[ \t]+([A-Z]{2,3})`),
				Reduce:  First},
			{Name: "fiscal_year_end",
				Pattern: regexp.MustCompile(`FISCAL YEAR END:[ \t]+([0-9]+)`),
				Reduce:  First},
			// HQ state from the BUSINESS ADDRESS block; shared with `state_incorp`.
			{Name: "hq_state", Custom: extractHQState},
		},
	})
}
