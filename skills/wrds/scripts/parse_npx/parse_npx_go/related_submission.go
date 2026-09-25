package main

import (
	"bytes"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// A report too large for one dissemination file is split across two accessions,
// and the registrant says so in the document's own first paragraphs:
//
//	DUE TO SIZE CONSTRAINTS, THIS FILING IS BEING MADE IN 2 RELATED SUBMISSIONS.
//	THIS SUBMISSION IS THE SECOND OF 2 RELATED SUBMISSIONS.
//	THE ACCESSION NUMBER OF THE RELATED SUBMISSION IS AS FOLLOWS:
//	0001324443-08-000065
//
// The cut falls wherever the byte budget ran out, so the continuation's body can
// open in the middle of a fund section whose banner was printed in the earlier
// accession and is never repeated. Those leading rows belong to the fund that
// file left open.
//
// This reads ONLY the predecessor the document names, and only when the document
// declares itself a later submission of a split report. It is not, and must not
// become, a most-recently-seen-fund fallback for ordinary unbannered rows: that
// shape was tried for continuation banners inside a single file and reverted
// after it misattributed votes among candidate funds. Here the predecessor file
// is named by the filing, and the fund open at its last byte is a fact of that
// file rather than a choice among candidates.
var (
	relatedAccessionRe = regexp.MustCompile(`\b\d{10}-\d{2}-\d{6}\b`)
	// FIRST is excluded by construction: the first half names no predecessor.
	relatedLaterSubmissionRe = regexp.MustCompile(`THIS SUBMISSION IS THE (?:SECOND|THIRD|FOURTH|FIFTH)\b`)
	relatedAccessionRefRe    = regexp.MustCompile(`ACCESSION NUMBERS? OF THE RELATED SUBMISSIONS? (?:IS|ARE) AS FOLLOWS`)
)

// priorRelatedAccession returns the accession this filing's own text names as an
// earlier submission of the same report, or "" when it names none. self is the
// filing's own accession, which is never its own predecessor.
func priorRelatedAccession(head []byte, self string) string {
	// Cheap gate: the phrase is verbatim in the markup, so the strip below runs
	// only for the handful of filings that carry the declaration at all.
	if !bytes.Contains(head, []byte("RELATED SUBMISSION")) {
		return ""
	}
	text := strings.ToUpper(string(stripHTML(head)))
	if !relatedLaterSubmissionRe.MatchString(text) {
		return ""
	}
	ref := relatedAccessionRefRe.FindStringIndex(text)
	if ref == nil {
		return ""
	}
	acc := relatedAccessionRe.FindString(text[ref[1]:])
	if acc == self {
		return ""
	}
	return acc
}

// blankRelatedAccession blanks the declared predecessor's accession number
// wherever the body prints it. The declaration paragraph is a bare line holding
// nothing but that number, which the identity readers otherwise take for the
// issuer name of the unbannered block beneath it. Spaces keep every byte offset
// the layouts computed for this buffer intact.
func blankRelatedAccession(body []byte, acc string) []byte {
	return bytes.ReplaceAll(body, []byte(acc), bytes.Repeat([]byte(" "), len(acc)))
}

// relatedPredecessorFund parses the sibling file holding accession acc and
// returns the fund heading its last vote row carries -- the section still open
// where that file ran out of bytes -- with the series that file resolved it to.
//
// The sibling is looked up beside the continuation, which is where EDGAR files
// an accession's siblings: both halves are the same registrant, the same period
// and the same day.
func relatedPredecessorFund(fullPath, acc string) (fund, series string) {
	matches, err := filepath.Glob(filepath.Join(filepath.Dir(fullPath), "*"+acc+"*"))
	if err != nil {
		return "", ""
	}
	for _, m := range matches {
		if m == fullPath {
			continue
		}
		if fi, err := os.Stat(m); err != nil || fi.IsDir() {
			continue
		}
		if f, s, ok := lastOpenFundOf(m, acc); ok {
			return f, s
		}
	}
	return "", ""
}

func lastOpenFundOf(path, acc string) (fund, series string, ok bool) {
	f, err := os.Open(path)
	if err != nil {
		return "", "", false
	}
	defer f.Close()

	head := make([]byte, headBytes)
	n, err := io.ReadFull(f, head)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return "", "", false
	}
	head = head[:n]

	h := parseHeader(head)
	// The glob matched a filename; the header is what proves the file IS the
	// declared accession.
	if h.Accession != acc {
		return "", "", false
	}
	if detectMode(head) != "text" {
		// An XML filing carries its series on every voteRecord, so it can leave
		// no banner open.
		return "", "", false
	}
	cikDict.back(&h)
	h.ParseMode = "text"

	if _, err := f.Seek(0, io.SeekStart); err != nil {
		return "", "", false
	}
	body, err := io.ReadAll(f)
	if err != nil {
		return "", "", false
	}
	res := parseText(body, h)
	if res == nil {
		return "", "", false
	}
	for i := len(res.Rows) - 1; i >= 0; i-- {
		r := res.Rows[i]
		if r.FundName == "" {
			continue
		}
		if r.SeriesID == "" {
			cikDict.exactFallback(h).apply(&r)
		}
		return r.FundName, r.SeriesID, true
	}
	return "", "", false
}
