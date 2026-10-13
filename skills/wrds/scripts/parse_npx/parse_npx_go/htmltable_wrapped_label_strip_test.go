package main

import "testing"

// Guinness Atkinson Funds 2007 (000091/919160/0000894189-07-002284.txt; 1,653
// of 2,882 rows both undated and id-less): the non-US sections carry a
// two-row identity strip whose labels are wrapped inside their own cells --
// `PT Telekomunikasi Indonesia Tbk | Shares Voted | 1,812,000 | Cusip/Sedol |
// B02ZK79 | Ticker | TLKM IJ` over `Meeting Date | 6/30/2006 | Shares |
// 1,812,000 | Meeting Type | AGM`, where the label text itself is split over a
// line break (`Meeting\n  Date`, `Shares\n  Voted`). Neither row is read as
// identity, so every vote under the strip emits a blank issuer, a blank
// identifier and a blank meeting date.
func TestHTMLTableWrappedLabelStripTwoRows(t *testing.T) {
	htmlExpectIssuer(t, htmlBlockRows(t, "H85_wrapped_label_strip_two_rows.txt"),
		"PT Telekomunikasi Indonesia Tbk", "20060630", "", 3)
}

// Same filing, contiguous lines 702-861: numeric SEDOL 6491318 must not
// become fabricated CUSIP 006491318.
func TestHTMLTableWrappedLabelStripNumericSEDOL(t *testing.T) {
	rows := htmlBlockRows(t, "H88_numeric_sedol_strip.txt")
	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(rows))
	}
	htmlExpectIssuer(t, rows, "Kingboard Chemical Holdings Ltd", "20060704", "", 1)
}
