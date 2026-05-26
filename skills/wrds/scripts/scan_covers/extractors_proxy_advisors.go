package main

import "regexp"

// extractors_proxy_advisors — case-insensitive substring matchers for the
// three major proxy advisors, ported from chongshu/proxy-advisor-customers
// main.py:_parse_prospectus_file.
//
// Python original (lowercased before matching):
//
//	iss: 'institutional shareholder service' OR ' iss '
//	gl:  'glass lewis' OR 'glass, lewis' OR 'glass-lewis'
//	ej:  'egan jones' OR 'egan-jones'
//
// Notable port choice — \biss\b vs literal " iss ":
//
// The Python " iss " pattern requires literal spaces. That breaks across
// HTML tag boundaries (e.g. >ISS<, &nbsp;ISS&nbsp;) and line wraps that
// are common in EDGAR HTML-format 485 filings, especially post-2015.
// Word boundaries (\b) match the same plain-text positions the Python
// pattern catches AND the HTML/wrap positions it misses. Validation
// against the published CSV will tell us whether this introduces false
// positives that need a tighter pattern.

var (
	reISSHit = regexp.MustCompile(
		`(?i)institutional shareholder service|\biss\b`)
	reGLHit = regexp.MustCompile(
		`(?i)glass lewis|glass, lewis|glass-lewis`)
	reEJHit = regexp.MustCompile(
		`(?i)egan jones|egan-jones`)
)

func boolFlag(b bool) string {
	if b {
		return "1"
	}
	return "0"
}

func extractISSHit(buf []byte) string { return boolFlag(reISSHit.Match(buf)) }
func extractGLHit(buf []byte) string  { return boolFlag(reGLHit.Match(buf)) }
func extractEJHit(buf []byte) string  { return boolFlag(reEJHit.Match(buf)) }
