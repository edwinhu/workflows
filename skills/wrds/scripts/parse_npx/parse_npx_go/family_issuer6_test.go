package main

import (
	"path/filepath"
	"testing"
)

// familyIssuer6Dispatch runs the real dispatch on a family ISSUER6 fixture.
func familyIssuer6Dispatch(t *testing.T, fixture, layout string) []VoteRow {
	t.Helper()
	ch := make(chan *ParseResult, 1024)
	sink := &rowSink{out: ch}
	meta := processFile(fixture, filepath.Join("testdata", "family_issuer6", fixture), sink, make([]byte, headBytes))
	close(ch)
	var rows []VoteRow
	for pr := range ch {
		rows = append(rows, pr.Rows...)
	}
	rows = append(rows, sink.buf...)
	if meta.ParseStatus != "ok" || meta.Layout != layout {
		t.Fatalf("fixture/dispatch precondition: status=%s layout=%s rows=%d error=%s", meta.ParseStatus, meta.Layout, len(rows), meta.ErrorMsg)
	}
	return rows
}

// 000090/906619/0000088053-04-000666.txt: source lines 1-224 and the filing's
// own last four lines.
//
// Scudder Investment Portfolios (CIK 906619), 2004, layout `splittable`,
// ProxyEdge text report. Every section heading block prints a security
// identifier on its `Issuer:` line and the parser drops all of them:
//
//   - -------------------------------------------------------------------------
//     ANDREW CORPORATION                        ANDW       Special Meeting Date: 07/15/2003
//     Issuer: 034425                                 ISIN:
//     SEDOL:
//   - -------------------------------------------------------------------------
//
// The vendor has no full nine-character CUSIP for these securities, so it
// prints the six-digit issuer number alone with `ISIN:` and `SEDOL:` blank.
// spReadProxyEdgeHeading sets ctx.cusip to "" and never reads the
// `Issuer:`/`ISIN:`/`SEDOL:` body lines for a value, on the theory stated in
// the comment above the function that "a six-character issuer number is not a
// link key". That is the defect: a printed security id is a LINK KEY, copied
// verbatim, and whether six characters link is the linker's cusip6 rung to
// decide -- not this parser's. Every vote row of every section in this filing
// carries a blank CUSIP even though the filing prints a usable identifier.
//
// The value must reach VoteRow.CUSIP EXACTLY as printed -- "034425", never
// padded to nine characters, never looked up.
func TestFamilyIssuer6ProxyEdgeSixDigitIssuerDropped(t *testing.T) {
	rows := familyIssuer6Dispatch(t, "0000088053-04-000666.txt", "splittable")
	var seen int
	for _, r := range rows {
		if r.IssuerName != "ANDREW CORPORATION" || r.MeetingDate != "20030715" {
			continue
		}
		seen++
		if r.CUSIP == "034425" {
			return
		}
	}
	t.Fatalf("no ANDREW CORPORATION / 20030715 row carries the printed issuer id 034425: %d matching rows, all with a blank or wrong CUSIP (rows total %d)", seen, len(rows))
}
