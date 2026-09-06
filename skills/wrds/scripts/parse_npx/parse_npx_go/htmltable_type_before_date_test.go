package main

import "testing"

// Mutual Fund Series Trust 2018 and Northern Lights Fund Trust IV 2017
// (0001580642-18-004114, 0001580642-17-004442; 1,053 and 1,169 undated rows on
// r181): the grid's date cell reads `Annual 04-May-2018` or `Annual 5/18/2017`
// -- the meeting type BEFORE the date in one cell, where the reader knew only
// the type after a dash.
func TestHTMLDateMeetingTypeBeforeDate(t *testing.T) {
	for in, want := range map[string]string{
		"Annual 04-May-2018":   "20180504",
		"Annual 5/18/2017":     "20170518",
		"Special 12/01/2016":   "20161201",
		"Annual":               "",
		"Annual Report 2017":   "",
		"04-May-2018 - Annual": "20180504",
	} {
		if got := htmlDate(in); got != want {
			t.Fatalf("htmlDate(%q) = %q, want %q", in, got, want)
		}
	}
}
