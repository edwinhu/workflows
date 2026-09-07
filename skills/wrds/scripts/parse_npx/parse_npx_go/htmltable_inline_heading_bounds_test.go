package main

import "testing"

func TestHTMLTableInlineHeadingBounds(t *testing.T) {
	const doc = `<p>ACME CORPORATION *A* CUSIP MEETING</p>
<table>
<tr><th></th><th>Proposal<br>Description</th><th>Proposed<br>By</th><th>Our<br>Vote</th><th>Agree With<br>Management</th></tr>
<tr><td>1</td><td>Elect Directors</td><td>Mgmt</td><td>For</td><td>Yes</td></tr>
<tr><td>2</td><td>Ratify Auditors</td><td>Mgmt</td><td>For</td><td>Yes</td></tr>
<tr><td>3</td><td>Approve Incentive Plan</td><td>Mgmt</td><td>For</td><td>Yes</td></tr>
</table>`
	rows := runISSNPXDoc(t, doc)
	if len(rows) != 3 {
		t.Fatalf("got %d rows; want 3 (a recovered heading panic must not discard the table)", len(rows))
	}
	for i, want := range []string{"Elect Directors", "Ratify Auditors", "Approve Incentive Plan"} {
		r := rows[i]
		if r[31] != "htmltable" || r[colVoteDescription] != want {
			t.Fatalf("row %d: layout=%q description=%q; want htmltable / %q", i, r[31], r[colVoteDescription], want)
		}
		if r[colCUSIP] != "" || r[colMeetingDate] != "" {
			t.Fatalf("row %d: cusip=%q date=%q; want both empty", i, r[colCUSIP], r[colMeetingDate])
		}
	}
}
