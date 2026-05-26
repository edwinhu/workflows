package main

import "regexp"

// proxy_advisors_fast — EXPERIMENTAL, NOT RECOMMENDED.
//
// Two-stage BackFirst variant: read back ~60% of file first (where SAI
// lives), short-circuit on any advisor hit; else read the prospectus
// body. Idea was ~14% bandwidth savings.
//
// Measured on 2020 (7,756 filings, 1 SGE slot, 2026-05-26):
//
//   - Wall time: 12m1s vs baseline 9m3s (+33% SLOWER, not faster)
//   - Parity vs proxy_advisors: 27 disagreements (0.35%), all FN
//     (7 ISS, 19 GL, 1 EJ) — recall loss is small but real.
//
// Why it lost: NFS read-ahead is defeated by the back-then-front seek
// pattern. For no-hit files (~65% of corpus), total I/O is the same but
// costs an extra seek + syscall. And ~0.35% of filings disclose the
// proxy advisor in the prospectus body but not in the SAI section.
//
// Kept in tree only as documentation of the negative result. Use
// proxy_advisors. The BackFirst Profile/Field plumbing in
// profile.go and main.go remains general-purpose for future profiles
// where the back-of-file assumption is stronger.
func init() {
	register(&Profile{
		Name:            "proxy_advisors_fast",
		HeadBytes:       8192,
		BackFirst:       true,
		BackOffset:      0.40,
		BackMinFileSize: 200 * 1024,
		Forms:           []string{"485BPOS", "485APOS"},
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

			// Body hit flags — IsHit:true enables BackFirst short-circuit.
			{Name: "iss_hit", Custom: extractISSHit, IsHit: true},
			{Name: "gl_hit", Custom: extractGLHit, IsHit: true},
			{Name: "ej_hit", Custom: extractEJHit, IsHit: true},
		},
	})
}
