package main

import "testing"

// Nuveen Investment Trust 2010 (000113/1131042/0001140361-10-035525.txt; 710
// of 24,942 rows undated): one section prints the identity as an unlabelled
// row whose FIRST cell is the meeting date -- `2/24/2010 | Deere &amp; Co.
// (DE/244199105) | 12/31/2009 | 412` -- so the issuer and the ticker/CUSIP
// parens are read while the bare leading date, carrying no `Meeting Date:`
// label of its own, is dropped. The same filing's other section prints the
// date in its own column (`Deere &amp; Co. | DE | 244199105 | 02/24/2010`)
// and those rows are dated.
func TestHTMLTableLeadingBareMeetingDateCell(t *testing.T) {
	htmlExpectIssuer(t, htmlBlockRows(t, "H87_leading_bare_meeting_date_cell.txt"),
		"Deere & Co.", "20100224", "244199105", 2)
}
