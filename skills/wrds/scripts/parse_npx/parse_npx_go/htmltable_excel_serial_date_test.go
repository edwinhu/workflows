package main

import "testing"

// Glenmede Fund 2009 (0001144204-09-046301; 1,148 of 9,024 rows without a date
// on full71w): the International Portfolio's table prints its dates as Excel
// serial numbers -- `39930` under `Meeting Date`, `39902` under `Record Date` --
// where the same meetings in the Long/Short table read `4/27/2009` and
// `3/30/2009`. A five-digit integer in the mapped date column is a serial day
// count from 1899-12-30.
func TestHTMLTableExcelSerialDates(t *testing.T) {
	htmlExpectIssuer(t, htmlBlockRows(t, "H74_excel_serial_dates.txt"), "Akzo Nobel N.V.", "20090427", "N01803100", 3)
}

func TestHTMLExcelSerialDate(t *testing.T) {
	for in, want := range map[string]string{"39930": "20090427", "39902": "20090330", "1": "", "123456": "", "4503": "", "45000": "20230315"} {
		if got := htmlExcelSerialDate(in); got != want {
			t.Fatalf("htmlExcelSerialDate(%q) = %q, want %q", in, got, want)
		}
	}
}
