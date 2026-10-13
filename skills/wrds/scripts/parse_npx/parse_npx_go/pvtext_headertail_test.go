package main

import "testing"

// A header whose TAIL LANDS ON THE FIRST MEETING LINE. The column block is wider than
// the page, so the second header line breaks mid-token and its remainder is printed
// on the same physical line as the first meeting:
//
//	ISSUER NAME              TICKER   CUSIP       MTG DATE   MTG TYPE
//	                                   Proposal Type   Voted?   Vote   For/
//	1-800 Contacts           CTAC   681977104   5/21/04   Annual        Agnst Mgmt
//	       <S>   <C>   <C>   <C>   <C>   <C>   <C>
//	       1.01  Elect Johnathan C. Coon        MGMT   YES   FOR   FOR
//
// `Agnst Mgmt` is header text trailing a meeting line. pvTextMeetingLine anchors the
// date and meeting type at fixed positions from the RIGHT, so the trailing words shear
// it and the meeting is not recognised; nothing after it is read.
//
// This is ONE filing of the 49 still yielding nothing, but it is the single largest at
// 19,429 vote lines -- which is why it is worth handling despite being a one-off. It
// was deliberately deferred twice while cheaper shapes were fixed.
//
// Ground truth read off the fixture's own bytes.

func TestPVTextHeaderTailOnMeetingLine(t *testing.T) {
	rows := runISSNPXDoc(t, loadPVFixture(t, "PV7_header_tail_on_meeting.txt"))
	if len(rows) != 87 {
		t.Fatalf("got %d rows, want 87 -- the first meeting line carries the header's"+
			" trailing `Agnst Mgmt`, so it is not recognised and nothing after it is read",
			len(rows))
	}
	for i, r := range rows {
		if r[colIssuerName] == "" {
			t.Errorf("row %d (%q) has no issuer -- the meeting was not attributed",
				i, r[colVoteDescription])
		}
		if d := r[colVoteDescription]; d == "" {
			t.Fatalf("row %d has an empty description", i)
		}
	}
}
