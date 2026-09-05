package main

import (
	"os"
	"path/filepath"
	"testing"
)

// Clearwater Investment Trust 2011 (0000897101-11-001512): the ProxyEdge
// full-width table's item header is 19 cells with two labels, `Votable Proposal`
// over a Yes/No column and `Vote Instruction` over the vote, while the proposal
// text sits in an unlabelled column. `Votable Proposal` was read as the
// description, so every item carried `Yes`, and the block's identity rows were
// emitted as votes with a ticker for the issuer and a CUSIP for the text
// (11,641 such rows in the filing). `Votable` is the voted flag, the description
// is adopted from the unlabelled column on the split-header path too, and an
// identity row is never a vote.
func TestHTMLTableSparseProxyEdgeHeader(t *testing.T) {
	b, err := os.ReadFile(filepath.Join("testdata", "htmltable", "H39_sparse_proxyedge_header.txt"))
	if err != nil {
		t.Fatal(err)
	}
	rows := runISSNPXDoc(t, string(b))
	if len(rows) == 0 {
		t.Fatal("no rows")
	}
	dated := 0
	for _, r := range rows {
		if r[colIssuerName] == "Ticker" || r[colVoteDescription] == "Yes" || pvTextCUSIP(r[colVoteDescription]) {
			t.Fatalf("junk row: issuer %q desc %q vote %q", r[colIssuerName], r[colVoteDescription], r[colHowVoted])
		}
		if r[colMeetingDate] != "" {
			dated++
		}
	}
	if dated == 0 {
		t.Fatal("no dated rows")
	}
}
