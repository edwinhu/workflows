package main

import "regexp"

// quorum — bylaw quorum threshold from DEF 14A proxy statements.
//
// FullBody, not a head window. Every other profile in this framework reads a
// header prefix; this one cannot. The quorum sentence lives in the "Questions
// and Answers About the Meeting" / "Voting Information" section, which sits
// anywhere from a few KB to most of the way through a proxy that can run
// several hundred KB. A head window large enough to be safe would be most of
// the file anyway, so read the file and say so.
//
// HeadBytes stays small because under FullBody it acts only as the form-type
// pre-filter window — 8 KB always contains the SGML header, so non-DEF-14A
// filings are rejected after one cheap read.
//
// BackFirst is deliberately NOT used. It pays off for 485 prospectuses where
// the target reliably sits in the back (the SAI); quorum text has no such
// positional prior, so a back-first pass would just add a seek and re-read.
//
// Forms: DEF 14A and DEFM14A carry the meeting mechanics. PRE 14A is the
// preliminary version — excluded, because a firm that files both would appear
// twice with possibly different text, and the definitive one is what governs.
//
// See profiles/quorum/README.md for the pipeline and the measured coverage.
func init() {
	register(&Profile{
		Name:      "quorum",
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
			// "threshold|confidence|match_text" — one extraction, three
			// correlated outputs. See extractQuorum for why it is not three
			// separate Custom fields.
			{Name: "quorum", Custom: extractQuorum},
		},
	})
}
