package main

import (
	"regexp"
	"strings"
)

// The vanguard layout is a block grammar rather than a table: a `FUND:` line
// opens a fund, long dashed rules separate one issuer's record from the next,
// and inside a record the identity keys (`ISSUER:`, `TICKER: ... CUSIP: ...`,
// `MEETING DATE:`) precede a `PROPOSAL:` column header and then one line per
// proposal. Both the issuer name and the proposal text wrap, and the wrap is
// what makes a naive line-per-row parser produce two half rows where the filing
// means one vote, so continuation lines are rejoined before anything is split.

// vanguardDashRule matches the long rule that separates issuer records. Short
// runs of dashes appear inside proposal text, so the rule requires a line that
// is nothing but dashes and is long enough not to be punctuation.
var vanguardDashRule = regexp.MustCompile(`^-{8,}$`)

// vanguardProposalLine captures the proposal number and whatever follows it on
// the opening line of a proposal. The number is the item_seq.
var vanguardProposalLine = regexp.MustCompile(`(?i)^PROPOSAL\s*#\s*([0-9A-Za-z][0-9A-Za-z.\-]*)\s*[:.]?\s*(.*)$`)

// vanguardTickerLine captures the ticker and CUSIP that share one line.
var vanguardTickerLine = regexp.MustCompile(`(?i)^TICKER:\s*(\S*)\s*(?:CUSIP:\s*(\S+))?\s*$`)

// vanguardColumnGap splits a proposal line into logical columns. The trailing
// four columns are separated from the text, and from each other, by runs of
// two or more spaces; single spaces inside the proposal text must survive.
var vanguardColumnGap = regexp.MustCompile(` {2,}|\t+`)

// vanguardKeyLine reports whether a line opens a new field rather than
// continuing the previous one. Continuation detection is negative: anything
// that is not a rule, a blank, or a known key belongs to whatever wrapped.
var vanguardKeyLine = regexp.MustCompile(`(?i)^(FUND|ISSUER|TICKER|CUSIP|MEETING\s+DATE|SECURITY|SEDOL|ISIN|MEETING\s+TYPE|RECORD\s+DATE|PROPOSAL)\b\s*[:#]`)

// vanguardRecord is the identity carried by every proposal inside one dashed
// block.
type vanguardRecord struct {
	issuer      string
	ticker      string
	cusip       string
	meetingDate string
	meetingType string
	recordDate  string
}

// parseVanguard parses the ISSUER/PROPOSAL block grammar into one row per
// proposal.
func parseVanguard(text string, meta FilingMeta) ([]VoteRow, error) {
	var rows []VoteRow

	fund := ""
	rec := vanguardRecord{}

	// pending holds the lines of a proposal whose text has not finished
	// wrapping. It is flushed when the next proposal, key, rule, blank line or
	// end of body proves the wrap is over.
	var pending []string

	// issuerOpen is true while an ISSUER: value may still be continued by a
	// following bare line.
	issuerOpen := false

	flush := func() {
		if len(pending) == 0 {
			return
		}
		if row, ok := vanguardRowFrom(pending, fund, rec); ok {
			rows = append(rows, row)
		}
		pending = pending[:0]
	}

	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimRight(strings.ReplaceAll(raw, "\r", ""), " \t")
		trimmed := strings.TrimSpace(line)

		if trimmed == "" {
			flush()
			issuerOpen = false
			continue
		}
		if vanguardDashRule.MatchString(trimmed) {
			flush()
			issuerOpen = false
			rec = vanguardRecord{}
			continue
		}

		upper := strings.ToUpper(trimmed)

		switch {
		case strings.HasPrefix(upper, "FUND:"):
			flush()
			issuerOpen = false
			fund = strings.TrimSpace(trimmed[len("FUND:"):])
			rec = vanguardRecord{}
			continue

		case strings.HasPrefix(upper, "ISSUER:"):
			flush()
			rec.issuer = strings.TrimSpace(trimmed[len("ISSUER:"):])
			issuerOpen = true
			continue

		case strings.HasPrefix(upper, "TICKER:"):
			flush()
			issuerOpen = false
			if m := vanguardTickerLine.FindStringSubmatch(trimmed); m != nil {
				rec.ticker = strings.TrimSpace(m[1])
				if m[2] != "" {
					rec.cusip = strings.TrimSpace(m[2])
				}
			}
			continue

		case strings.HasPrefix(upper, "CUSIP:"):
			flush()
			issuerOpen = false
			rec.cusip = strings.TrimSpace(trimmed[len("CUSIP:"):])
			continue

		case strings.HasPrefix(upper, "MEETING DATE:"):
			flush()
			issuerOpen = false
			rec.meetingDate = xmlDate(strings.TrimSpace(trimmed[len("MEETING DATE:"):]))
			continue

		case strings.HasPrefix(upper, "RECORD DATE:"):
			flush()
			issuerOpen = false
			rec.recordDate = xmlDate(strings.TrimSpace(trimmed[len("RECORD DATE:"):]))
			continue

		case strings.HasPrefix(upper, "MEETING TYPE:"):
			flush()
			issuerOpen = false
			rec.meetingType = strings.TrimSpace(trimmed[len("MEETING TYPE:"):])
			continue
		}

		if m := vanguardProposalLine.FindStringSubmatch(trimmed); m != nil {
			flush()
			issuerOpen = false
			pending = append(pending, line)
			continue
		}

		// The bare `PROPOSAL:` column header carries no vote; it only marks
		// where the proposal rows begin.
		if strings.HasPrefix(upper, "PROPOSAL:") {
			flush()
			issuerOpen = false
			continue
		}

		if vanguardKeyLine.MatchString(trimmed) {
			flush()
			issuerOpen = false
			continue
		}

		// A bare line continues whatever wrapped: the proposal text if one is
		// open, otherwise the issuer name.
		if len(pending) > 0 {
			pending = append(pending, line)
			continue
		}
		if issuerOpen {
			rec.issuer = strings.TrimSpace(rec.issuer + " " + trimmed)
		}
	}
	flush()

	return rows, nil
}

// vanguardRowFrom turns the rejoined lines of one proposal into a row. The
// trailing four columns are taken off the right, because the proposal text is
// the only field of unbounded width and the column header does not align with
// the data in practice.
func vanguardRowFrom(lines []string, fund string, rec vanguardRecord) (VoteRow, bool) {
	joined := strings.TrimSpace(lines[0])
	for _, l := range lines[1:] {
		joined = joined + " " + strings.TrimSpace(l)
	}

	m := vanguardProposalLine.FindStringSubmatch(joined)
	if m == nil {
		return VoteRow{}, false
	}
	seq := m[1]
	body := m[2]

	desc, proposedBy, voted, cast, mgmt := vanguardSplitColumns(body)
	desc = strings.Join(strings.Fields(desc), " ")
	if desc == "" && cast == "" {
		return VoteRow{}, false
	}

	row := VoteRow{
		FundName:                 fund,
		IssuerName:               rec.issuer,
		Ticker:                   rec.ticker,
		CUSIP:                    rec.cusip,
		MeetingDate:              rec.meetingDate,
		MeetingType:              rec.meetingType,
		RecordDate:               rec.recordDate,
		ItemSeq:                  seq,
		VoteDescription:          desc,
		VoteSource:               proposedBy,
		HowVoted:                 cast,
		ManagementRecommendation: mgmt,
		VoteOtherInfo:            voted,
	}
	return row, true
}

// vanguardSplitColumns peels PROPOSED BY / VOTED? / VOTE CAST / MGMT off the
// right of a proposal body. Wide gaps are the column separator; a body with too
// few gaps falls back to plain whitespace fields so a squeezed line still yields
// its vote rather than nothing.
func vanguardSplitColumns(body string) (desc, proposedBy, voted, cast, mgmt string) {
	segs := vanguardColumnGap.Split(strings.TrimSpace(body), -1)
	segs = vanguardNonEmpty(segs)

	if len(segs) >= 5 {
		n := len(segs)
		return strings.Join(segs[:n-4], " "),
			segs[n-4], segs[n-3], segs[n-2], segs[n-1]
	}

	fields := strings.Fields(body)
	if len(fields) >= 5 {
		n := len(fields)
		return strings.Join(fields[:n-4], " "),
			fields[n-4], fields[n-3], fields[n-2], fields[n-1]
	}
	return strings.TrimSpace(body), "", "", "", ""
}

func vanguardNonEmpty(in []string) []string {
	out := in[:0]
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}
