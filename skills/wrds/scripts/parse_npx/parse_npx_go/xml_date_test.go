package main

import "testing"

// Two date spellings of the 2024 XML filers: a five-digit year with its last
// digit doubled (`06/12/20244`, Hussman 2024; `10/10/20233`, Unified Series
// Trust 2024; filer agent 0001580642, 8,568 undated rows on r156) and a
// day-month-year with the month spelt (`05-Jul-2023`, Empower Advisory Group
// 2024 and the agent 0001420506's siblings, 5,150 undated rows).
func TestXMLDateSpellings(t *testing.T) {
	cases := map[string]string{
		"06/12/20244": "20240612",
		"10/10/20233": "20231010",
		"05-Jul-2023": "20230705",
		"27-May-2024": "20240527",
		"2024-06-12":  "20240612",
		"06/12/2024":  "20240612",
		"22024-06-12": "",
		"05-Jux-2023": "",
	}
	for in, want := range cases {
		if got := xmlDate(in); got != want {
			t.Errorf("xmlDate(%q) = %q, want %q", in, got, want)
		}
	}
}
