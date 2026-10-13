package main

import (
	"path/filepath"
	"testing"
)

// Both fixtures delete whole source lines only. Layout was measured by
// processFile on each complete accession: proxyedge. The otherwise empty
// Item/Proposal header tables preserve that dispatch rather than silently
// testing htmltable. Source line references below are BEFORE deletion.
func TestFamilyFundProp(t *testing.T) {
	for _, tc := range []struct {
		name, fixture, fund, offending string
		minRows                        int
	}{
		{
			name:    "litman_2019",
			fixture: "litman_2019.txt",
			// 0001193125-19-224376: heading 175, repeated fund cell 11611.
			fund:      "Litman Gregory Masters Alternative Strategies Fund",
			offending: "Approve Fees of the Trustees of Group Share Schemes/Other Personnel Funds", // 7962
			// 34 NASPERS votes (7669-8008), 3 NAVER votes (8092-8121),
			// 31 dated grid votes (11610-12539); no votes in the dispatch-only table.
			minRows: 68,
		},
		{
			name:    "principal_2008",
			fixture: "principal_2008.txt",
			// 0000898745-08-000051: current section heading at 1339098 is
			// "Principal Funds, Inc. - SmallCap Value Fund III". The per-row
			// fund cell (1424268, 1424333) names the former fund, so (c)
			// checks continuity with the source vote, not a fixed name.
			offending: "Eliminate Provisions Authorizing Series B", // 1424248
			// 9 ACTUANT votes (1238812-1239036), then 65 + 67 dated vote
			// TRs in complete tables 1420470-1424321 and 1424330-1428181.
			// Description-only continuation TRs are NOT counted as votes.
			minRows: 141,
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ch := make(chan *ParseResult, 4096)
			sink := &rowSink{out: ch}
			meta := processFile(tc.fixture, filepath.Join("testdata", "family_fundprop", tc.fixture), sink, make([]byte, headBytes))
			close(ch)
			if meta.Layout != "proxyedge" {
				t.Fatalf("invalid fixture: layout=%q, full filing uses proxyedge", meta.Layout)
			}
			if meta.ParseStatus != "ok" {
				t.Fatalf("parse failed: status=%s error=%s", meta.ParseStatus, meta.ErrorMsg)
			}
			var rows []VoteRow
			for pr := range ch {
				rows = append(rows, pr.Rows...)
			}
			rows = append(rows, sink.buf...)

			if len(rows) < tc.minRows {
				t.Errorf("(d) emitted %d rows, want at least %d source vote data rows", len(rows), tc.minRows)
			}
			descriptions := make(map[string]bool)
			for _, r := range rows {
				if r.VoteDescription != "" {
					descriptions[r.VoteDescription] = true
				}
			}
			badNames := make(map[string]int)
			for _, r := range rows {
				if r.FundName == tc.offending || descriptions[r.FundName] {
					badNames[r.FundName]++
				}
			}
			for name, count := range badNames {
				t.Errorf("(a) %d rows use proposal text as FundName: %q", count, name)
			}

			if tc.name == "litman_2019" {
				found, following := false, false
				badLater := 0
				for _, r := range rows {
					// 7959-7968: item "1.13", offending description, and
					// Vote Cast "For" (7966), distinct from Mgt Rec at 7964.
					if r.IssuerName == "NASPERS LTD." && r.ItemSeq == "1.13" &&
						r.VoteDescription == tc.offending && r.HowVoted == "For" {
						found = true
					}
					// First following ballot table: NAVER, 8092-8101,
					// item "1.1", description 8095, Vote Cast "For" at 8099.
					if r.IssuerName == "NAVER CORP." && r.ItemSeq == "1.1" &&
						r.VoteDescription == "Amend Articles of Incorporation (Business Objectives)" && r.HowVoted == "For" {
						following = true
					}
					// All retained rows belong to the same source fund, including
					// the 31 later dated grid rows beginning at 11610.
					if r.FundName != tc.fund {
						badLater++
					}
				}
				if !found {
					t.Errorf("(b) missing source vote: NASPERS LTD. / 1.13 / %q / For", tc.offending)
				}
				if !following {
					t.Error("(c) missing following-table vote: NAVER CORP. / 1.1 / Amend Articles of Incorporation (Business Objectives) / For")
				}
				if badLater != 0 {
					t.Errorf("(c) %d rows have wrong fund; want %q", badLater, tc.fund)
				}
			} else {
				// 1424211-1424265 is a description-only continuation TR:
				// item/vote/issuer cells are blank. Do not invent a standalone
				// vote with that text. The next real vote is item "3",
				// "Cumulative Preferred Stock", "For" (1424298/4303/4313).
				// The following table starts with item "4", "Ratification of
				// Auditor", "For" (1424363/4368/4378), also Owens & Minor Inc.
				// The source vote before the continuation is item "2",
				// "Declassify the Board", "For". The continuation must not start
				// a new fund: later votes keep the source vote's fund and series.
				var source *VoteRow
				seenAfter, seenFollowing := false, false
				type fundKey struct{ fund, series string }
				badLater := make(map[fundKey]int)
				for i := range rows {
					r := rows[i]
					if r.IssuerName == "Owens & Minor Inc" && r.VoteDescription == "Declassify the Board" && r.HowVoted == "For" {
						source = &rows[i]
					}
					if r.IssuerName == "Owens & Minor Inc" && r.VoteDescription == "Cumulative Preferred Stock" && r.HowVoted == "For" {
						seenAfter = true
					}
					if seenAfter && !seenFollowing && source != nil &&
						(r.FundName != source.FundName || r.SeriesID != source.SeriesID) {
						badLater[fundKey{r.FundName, r.SeriesID}]++
					}
					if r.IssuerName == "Owens & Minor Inc" && r.VoteDescription == "Ratification of Auditor" && r.HowVoted == "For" {
						seenFollowing = true
					}
				}
				if source == nil {
					t.Fatal("(c) missing source vote before continuation: Owens & Minor Inc / Declassify the Board / For")
				}
				if source.FundName == "" || source.FundName == tc.offending || descriptions[source.FundName] {
					t.Errorf("(c) source vote fund is empty or proposal text: %q", source.FundName)
				}
				if !seenAfter || !seenFollowing {
					t.Errorf("(c) missing later source votes: immediate=%v following-table=%v", seenAfter, seenFollowing)
				}
				for k, count := range badLater {
					t.Errorf("(c) %d later rows have fund=%q series=%q, want source vote's fund=%q series=%q",
						count, k.fund, k.series, source.FundName, source.SeriesID)
				}
			}
		})
	}
}
