package main

import "regexp"

// tender_sc_to — Schedule TO cover-page and body extractor.
//
// Extracts key fields from SC TO-T, SC TO-T/A, SC TO-I, and SC TO-I/A
// filings. Designed for the 20-to-10 tender offer duration study: captures
// expiration dates, extension indicators, final-amendment flags, offer
// prices, and tender results.
//
// HeadBytes=65536 (64 KB) covers the SGML header + cover page + opening
// paragraphs for both initial filings (~465 KB total, but key fields in
// first ~10 KB) and amendments (~7-10 KB total).
func init() {
	register(&Profile{
		Name:      "tender_sc_to",
		HeadBytes: 65536,
		Forms: []string{
			"SC TO-T", "SC TO-T/A",
			"SC TO-I", "SC TO-I/A",
		},
		Fields: []Field{
			// --- Header fields (SGML) ---
			{Name: "accession", Pattern: regexp.MustCompile(`ACCESSION NUMBER:[ \t]+([^\s]+)`), Reduce: First},
			{Name: "form_type", Pattern: regexp.MustCompile(`CONFORMED SUBMISSION TYPE:[ \t]+([^\r\n]+)`), Reduce: First},
			{Name: "filed_date", Pattern: regexp.MustCompile(`FILED AS OF DATE:[ \t]+([0-9]+)`), Reduce: First},

			// Filer = bidder (SC TO-T) or issuer (SC TO-I)
			{Name: "fil_cik", Pattern: regexp.MustCompile(`(?s)FILED BY:.*?CENTRAL INDEX KEY:[ \t]+([0-9]+)`), Reduce: First},
			{Name: "fil_name", Pattern: regexp.MustCompile(`(?s)FILED BY:.*?COMPANY CONFORMED NAME:[ \t]+([^\r\n]+)`), Reduce: First},

			// Subject company = target
			{Name: "sbj_cik", Pattern: regexp.MustCompile(`(?s)SUBJECT COMPANY:.*?CENTRAL INDEX KEY:[ \t]+([0-9]+)`), Reduce: First},
			{Name: "sbj_name", Pattern: regexp.MustCompile(`(?s)SUBJECT COMPANY:.*?COMPANY CONFORMED NAME:[ \t]+([^\r\n]+)`), Reduce: First},

			// --- Cover page fields ---

			// CUSIP: 9-char alphanumeric on line preceding "(CUSIP Number"
			{Name: "cusip9", Pattern: regexp.MustCompile(`([0-9A-Z]{9})\s*\n[^\n]*\(CUSIP\s+Number`), Reduce: First},

			// Amendment number: "(Amendment No. X)"
			{Name: "amendment_no", Pattern: regexp.MustCompile(`\(Amendment\s+No\.\s+(\d+)\)`), Reduce: First},

			// Offer price: "$X.XX per Share" — use Max to skip small filing-fee
			// amounts ($0.001 per share) and capture the real offer price.
			{Name: "offer_price", Pattern: regexp.MustCompile(`\$(\d+\.?\d*)\s+per\s+[Ss]hare`), Reduce: Max},

			// --- Body fields (custom extractors) ---
			{Name: "expiration_date", Custom: extractExpirationDate},
			{Name: "is_extension", Custom: extractIsExtension},
			{Name: "is_final", Custom: extractIsFinal},
			{Name: "shares_tendered", Custom: extractSharesTendered},
			{Name: "pct_tendered", Custom: extractPctTendered},
		},
	})
}
