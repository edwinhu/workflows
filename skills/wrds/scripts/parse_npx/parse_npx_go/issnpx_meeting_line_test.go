package main

import "testing"

// Safeco Common Stock Trust 2005 (0000867579-05-000020; 759 rows, none dated,
// on r156): the meeting line drops the word Date -- `Meeting
// 12/08/2004         Meeting Type:    Annual`.
func TestISSMeetingLineWithoutDateWord(t *testing.T) {
	d, typ, ok := issMeetingLine("Meeting           12/08/2004         Meeting Type:    Annual")
	if !ok || d != "20041208" || typ != "Annual" {
		t.Fatalf("got %q %q %v", d, typ, ok)
	}
	if _, _, ok := issMeetingLine("Meeting notes and other matters"); ok {
		t.Fatalf("a sentence beginning with Meeting is not a meeting line")
	}
}
