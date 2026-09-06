package main

import "testing"

// Investment Managers Series Trust 2013 (0001398344-13-004105; 895 of 895 rows
// without a date, with `a` as the issuer and `c` as the CUSIP, on r187): the
// identity labels carry the form's item letter after the colon -- `Issuer: a |
// Caterpillar Inc`, `CUSIP: c | 149123101`, `Meeting Date: d | 6/12/2013 (Due
// Date)` -- so the letter was read as the value, and the date carries a
// parenthetical.
func TestHTMLTableLetteredLabelSuffix(t *testing.T) {
	htmlExpectIssuer(t, htmlBlockRows(t, "H71_lettered_label_suffix.txt"), "Caterpillar Inc", "20130612", "149123101", 2)
}

// Starboard Investment Trust 2014 (0001464413-14-000252; 594 of 877 rows
// undated on r187): the issuer spans nine columns on its own row, then spanned
// bare labels with their values further along the row -- `Security (2) | ... |
// 313855108 (2)` and `Ticker Symbol (3) | ... | FSS (3) | ... | Meeting Date
// (3) | ... | 22-Apr-2014 (4)`.
func TestHTMLTableSpannedLabelsUnderIssuerSpan(t *testing.T) {
	htmlExpectIssuer(t, htmlBlockRows(t, "H72_spanned_labels_under_issuer_span.txt"), "FEDERAL SIGNAL CORPORATION", "20140422", "313855108", 2)
}
