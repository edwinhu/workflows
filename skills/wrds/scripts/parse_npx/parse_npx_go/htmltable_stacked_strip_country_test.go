package main

import "testing"

// Ivy Funds 2011 (0001193125-11-237466; 1,542 of 3,336 rows without a date on
// r202): the non-US blocks print a stacked identity strip -- `Ticker | Meeting
// Date | Country | Security ID | Meeting Type | Record Date | Shares Voted |
// Shares Instructed | Shares Available | Shares on Loan` over `600016 |
// 04-May-11 | China | Y1495M104 | Special | 01-Apr-11 | 12,995,000 | ...` --
// where the id is read and the date is not.
func TestHTMLTableStackedStripCountryColumn(t *testing.T) {
	htmlExpectIssuer(t, htmlBlockRows(t, "H76_stacked_strip_country_column.txt"), "China Minsheng Banking Corp Ltd.", "20110504", "Y1495M104", 1)
}
