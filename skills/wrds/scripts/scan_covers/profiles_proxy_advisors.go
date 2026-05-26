package main

import "regexp"

// proxy_advisors — port of chongshu/proxy-advisor-customers (JFE).
//
// Full-text scans Forms 485BPOS and 485APOS for mentions of the three
// major proxy advisors (ISS, Glass Lewis, Egan-Jones). Emits per-filing
// binary flags; downstream aggregation collapses to fund-family × year
// via CRSP Mutual Fund DB (CIK → mgmt_cd).
//
// Sample frame (N-PX-derived CIK × year) is applied downstream of this
// scan — the scan itself runs on all 485BPOS/485APOS regardless and lets
// the aggregation step filter. This keeps the parser stateless.
//
// HeadBytes=8192 is the SGML-header pre-filter window. Because FullBody
// is true, the whole file (typically 1–5 MB) is then read into the body
// buffer that the Custom extractors search.
//
// Validation target: ≥98% (mgmt_cd, year, advisor) parity with the
// chongshu published link_fundmgmt_proxyadvisor.csv for 2007–2021.
// See references/proxy-advisors.md.
func init() {
	register(&Profile{
		Name:      "proxy_advisors",
		HeadBytes: 8192,
		FullBody:  true,
		Forms:     []string{"485BPOS", "485APOS"},
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

			// Body hit flags.
			{Name: "iss_hit", Custom: extractISSHit},
			{Name: "gl_hit", Custom: extractGLHit},
			{Name: "ej_hit", Custom: extractEJHit},
		},
	})
}
