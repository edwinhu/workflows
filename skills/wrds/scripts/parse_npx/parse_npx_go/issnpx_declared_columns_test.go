package main

import "testing"

// TestISSNPXForeignHeaderProponentFirst covers the FIFTH foreign column order.
//
//	Issue No.  Description           Proponent  Mgmt Rec  Vote Cast  For/Against
//	                                                                   Mgmt
//	1.1        Elect Paul A. Maeder  Mgmt       For       For        For
//
// The proponent comes BEFORE the two vote cells and a fourth For/Against-Mgmt
// column follows, so nothing at the right edge is a sponsor and issPeelColumns
// abandons every line.
//
// WHY THIS IS A UNIT TEST AND NOT A FIXTURE. The table sits at line 905 of
// 0001144204-18-046939.txt and the first ISS section at 3098, so a contiguous
// excerpt covering both would be 2,200 lines; and the table ALONE is claimed by
// fixedwidth, which reads it correctly, so a small fixture cannot reproduce the
// defect at all. That is exactly what misled an earlier attempt here: the rows
// parsed in isolation, which looked like evidence that declining would destroy
// good rows. Split by table format, the filing is 3,914 blank of 3,915 rows on
// THIS grammar and 21 blank of 14,897 on its ISS sections -- declining costs one
// row, not 14,900.
//
// So the decision function is tested directly, on the header line as the filing
// prints it.
func TestISSNPXForeignHeaderProponentFirst(t *testing.T) {
	foreign := []string{
		"Issue No.  Description              Proponent  Mgmt Rec   Vote Cast  For/Against",
		"  to Vote Proponet     Number Proposal               Recommendation Instruction",
		"ITEM   PROPOSAL                                         TYPE          VOTE",
	}
	for _, line := range foreign {
		if !issForeignTableHeader(line) {
			t.Errorf("issForeignTableHeader(%q) = false, want true", line)
		}
	}

	// This layout's OWN header must never be mistaken for a foreign one.
	ours := []string{
		"#     Proposal                                Mgt Rec   Vote Cast    Sponsor",
		"#     Proposal                                  Mgt Rec   Vote Cast",
	}
	for _, line := range ours {
		if issForeignTableHeader(line) {
			t.Errorf("issForeignTableHeader(%q) = true, want false -- that is our own header", line)
		}
	}
}
