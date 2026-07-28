package main

import "regexp"

// blockholders_13dg — ports the Volkova SC 13D/G cover-page extraction.
//
// HeadBytes=131072 (128 KB) covers the SGML header + cover pages for
// essentially all single-filer filings and the vast majority of multi-
// filer 13Ds. Larger windows trade NFS bandwidth for higher parity;
// 32 KB left ~1% of max_prc values truncated beyond the buffer.
//
// Header fields use the shared pattern-based path. Body fields (item12,
// max_prc) use Custom extractors that mirror parser.py line-window and
// two-pass code-matching logic for full Python parity.
//
// THIS PROFILE DOES NOT SUPERSEDE mirror's src/blockholders/parser.py, and the
// gap is structural rather than drift. Checked 2026-07-28:
//
//	parser.py emits ONE ROW PER (subject, filer) PAIR and computes item12
//	PER FILER — parse_item12(body, fil_cik=fil["cik"]).
//
//	This profile emits one row per FILING. fil_cik / fil_name / sbj_cik /
//	sbj_name are Reduce:First, so a joint filing collapses to its first
//	filer and the single item12 is that filer's.
//
// One row per filing is right for the common case — most 13D/Gs have exactly
// one filer and one subject. It is wrong for group filings under §13(d)(3),
// which are precisely the ones blockholder work cares about: N filers acting
// together, each with its own Item 12 classification.
//
// Use this profile for scale and for the single-filer majority; use parser.py
// when joint filings matter. Do NOT delete parser.py assuming this replaces it.
// Making it a true replacement means letting the framework emit multiple rows
// per file, which the Field/Reduce contract cannot express today.
func init() {
	register(&Profile{
		Name:      "blockholders_13dg",
		HeadBytes: 131072,
		// SEC rule change effective 2024-09/11: "SC 13D/G" renamed to
		// "SCHEDULE 13D/G" with structured XBRL submissions. Accept both
		// legacy and new form names so scans work across the transition.
		Forms: []string{
			"SC 13D", "SC 13D/A", "SC 13G", "SC 13G/A",
			"SCHEDULE 13D", "SCHEDULE 13D/A", "SCHEDULE 13G", "SCHEDULE 13G/A",
		},
		Fields: []Field{
			// Header fields — always emitted.
			{Name: "accession", Pattern: regexp.MustCompile(`ACCESSION NUMBER:[ \t]+([^\s]+)`), Reduce: First},
			{Name: "form_type", Pattern: regexp.MustCompile(`CONFORMED SUBMISSION TYPE:[ \t]+([^\r\n]+)`), Reduce: First},
			{Name: "filed_date", Pattern: regexp.MustCompile(`FILED AS OF DATE:[ \t]+([0-9]+)`), Reduce: First},
			{Name: "fil_cik", Pattern: regexp.MustCompile(`(?s)FILED BY:.*?CENTRAL INDEX KEY:[ \t]+([0-9]+)`), Reduce: First},
			{Name: "fil_name", Pattern: regexp.MustCompile(`(?s)FILED BY:.*?COMPANY CONFORMED NAME:[ \t]+([^\r\n]+)`), Reduce: First},
			{Name: "sbj_cik", Pattern: regexp.MustCompile(`(?s)SUBJECT COMPANY:.*?CENTRAL INDEX KEY:[ \t]+([0-9]+)`), Reduce: First},
			{Name: "sbj_name", Pattern: regexp.MustCompile(`(?s)SUBJECT COMPANY:.*?COMPANY CONFORMED NAME:[ \t]+([^\r\n]+)`), Reduce: First},

			// Body fields — Python-parity custom extractors.
			{Name: "item12", Custom: extractItem12},
			{Name: "max_prc", Custom: extractMaxPrc},

			// cusip6: pattern-based, first 6 of any 9-char CUSIP token.
			{Name: "cusip6", Pattern: regexp.MustCompile(`(?i)CUSIP\s*(?:NO\.?|NUMBER)?[^\w]*([0-9A-Z]{6})[0-9A-Z]{3}?`), Reduce: First},
		},
	})
}
