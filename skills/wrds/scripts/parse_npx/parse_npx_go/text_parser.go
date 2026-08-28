package main

import (
	"fmt"
	"hash/fnv"
	"sort"
	"strings"
)

// The legacy N-PX era has no common grammar: every filing agent invented its
// own line-oriented report. Detection is therefore a registry rather than a
// switch — a body is normalized once, matched against ordered signatures, and
// dispatched to the first hit. A body nothing matches is NOT dropped: it lands
// in the manifest as parse_status=skip carrying a signature derived from its own
// document body, so unparsed families are countable and coverage grows by adding
// entries.

// layoutEntry pairs a layout name with a cheap signature predicate over the head
// of the normalized text and the parser that handles that grammar.
type layoutEntry struct {
	Name  string
	Match func(head string) bool
	Parse func(text string, meta FilingMeta) ([]VoteRow, error)
}

// layoutRegistry is matched in order; the first hit wins.
var layoutRegistry = []layoutEntry{
	{
		Name:  "issnpx",
		Match: matchISSNPX,
		Parse: parseISSNPX,
	},
	{
		Name:  "vanguard",
		Match: matchVanguard,
		Parse: parseVanguard,
	},
	{
		Name:  "broadridge",
		Match: matchBroadridge,
		Parse: parseBroadridge,
	},
}

// signatureHeadBytes bounds how much normalized text a signature predicate sees.
// Signatures are banners and column headers, which live in the head; scanning a
// 200 MB body for one per registry entry would be a per-filing waste.
const signatureHeadBytes = 128 << 10

// noActivitySentinels mark a fund that had nothing to vote. A filing whose funds
// all report one of these is a real and common outcome, not a parser failure, so
// it is parse_status=ok with zero rows — the row that keeps "nothing to report"
// distinguishable from "the parser broke".
//
// The list is a vocabulary, not a set of six known filings: legacy filers phrase
// the same fact a dozen ways and the negation is what carries the meaning, so
// "held no voting securities" and "did not hold any voting securities" are one
// family and missing either loses a whole cohort of filings to the skip bucket.
// Every entry must be lowercase ASCII — hasNoActivitySentinel folds the body
// against it in place rather than lowercasing a copy.
var noActivitySentinels = []string{
	"there is no proxy voting activity for the fund",
	"there is no proxy voting activity for this fund",
	"no proxy voting activity",
	"the fund did not vote any proxies",
	"the registrant did not vote any proxies",
	"did not hold any voting securities",
	"did not hold any equity securities",
	"held no voting securities",
	"hold no voting securities",
	"held no equity securities",
	"no voting securities were held",
	"no proxies were voted",
	"no proxies voted",
	"no securities were voted",
	"not required to vote any proxies",
}

// voteTableVocabulary is the column and label vocabulary a legacy vote table
// cannot be written without. Its presence is what separates "this fund had
// nothing to vote" from "this filing carries votes we failed to parse", and the
// distinction is the manifest's whole job: a 20.5 MB filing carrying 2,242
// meeting dates was shipping as parse_status=ok with n_rows=0 because one of its
// funds reported no activity. Entries must be lowercase ASCII, and must be
// phrases a nothing-to-report sentence would never contain.
var voteTableVocabulary = []string{
	"meeting date",
	"vote cast",
	"votes cast",
	"how voted",
	"shares voted",
	"management recommendation",
	"mgt rec",
	"mgmt rec",
	"security id",
	"cusip",
}

// matchISSNPX recognises the ISS-generated report, the highest-volume legacy
// layout. The banner is the obvious signal but it is not a reliable one: 23.5%
// of all skipped legacy filings carry this exact grammar with no banner
// anywhere in the body. So the fallback is the proposal table's own column
// header, which is both the vocabulary that identifies the family and the line
// parseISSNPX keys on. Matching on anything looser would claim filings the
// parser cannot walk, turning an honest skip into an ok with too few rows.
func matchISSNPX(head string) bool {
	up := strings.ToUpper(head)
	if strings.Contains(up, "FORM N-PX REPORT") {
		return true
	}
	return hasISSColumnHeader(up)
}

// hasISSColumnHeader looks for the '#  Proposal  Mgt Rec  Vote Cast  Sponsor'
// line that opens every ISS proposal table. head must already be uppercased.
func hasISSColumnHeader(head string) bool {
	for _, line := range strings.Split(head, "\n") {
		line = strings.TrimSpace(line)
		if !strings.HasPrefix(line, "#") || !strings.Contains(line, "PROPOSAL") {
			continue
		}
		if strings.Contains(line, "VOTE CAST") || strings.Contains(line, "MGT REC") {
			return true
		}
	}
	return false
}

// matchVanguard recognises the ISSUER/PROPOSAL block grammar, either by its
// column header or by a FUND: line followed by ISSUER: records.
func matchVanguard(head string) bool {
	up := strings.ToUpper(head)
	if strings.Contains(up, "PROPOSAL:") &&
		strings.Contains(up, "PROPOSED BY") && strings.Contains(up, "VOTE CAST") {
		return true
	}
	fund := strings.Index(up, "FUND:")
	if fund < 0 {
		return false
	}
	return strings.Contains(up[fund:], "ISSUER:")
}

// parseText normalizes a legacy filing body, dispatches it through
// layoutRegistry, and returns rows plus a filled-in manifest row. It never
// panics: a layout parser that panics or errors becomes parse_status=error
// carrying the message, because one malformed filing must not take a worker down.
func parseText(body []byte, meta FilingMeta) *ParseResult {
	res := &ParseResult{Meta: meta}
	res.Meta.ParseMode = "text"
	res.Meta.ErrorMsg = ""

	decoded, err := normalizeCharset(body)
	if err != nil {
		res.Meta.ParseStatus = "error"
		res.Meta.ErrorMsg = err.Error()
		res.Meta.NRows = 0
		return res
	}

	text := string(stripHTML(decoded))
	head := text
	if len(head) > signatureHeadBytes {
		head = head[:signatureHeadBytes]
	}

	// A matcher that blew up is not a match, but it is also not silence: the
	// message is carried to the skip row below so a broken signature predicate is
	// visible in the manifest instead of quietly shrinking coverage.
	matchErr := ""

	for _, entry := range layoutRegistry {
		matched, merr := runLayoutMatcher(entry, head)
		if merr != nil {
			if matchErr == "" {
				matchErr = merr.Error()
			}
			continue
		}
		if !matched {
			continue
		}
		res.Meta.Layout = entry.Name
		rows, perr := runLayoutParser(entry, text, res.Meta)
		if perr != nil {
			res.Meta.ParseStatus = "error"
			res.Meta.ErrorMsg = perr.Error()
			res.Meta.NRows = 0
			return res
		}
		res.Rows = stampRows(rows, res.Meta)
		res.Meta.ParseStatus = "ok"
		res.Meta.NRows = len(res.Rows)
		return res
	}

	// The sentinel only decides when the body shows no vote-table vocabulary. A
	// multi-fund filing where one fund reports nothing and the others report real
	// votes carries both, and calling that "nothing to report" records the loss of
	// every vote in it as a success. A body we could not parse is a skip; that is
	// the honest answer and the one the manifest exists to give.
	if hasNoActivitySentinel(text) && !hasVoteTableVocabulary(text) {
		res.Meta.Layout = "no-activity"
		res.Meta.ParseStatus = "ok"
		res.Meta.NRows = 0
		return res
	}

	res.Meta.Layout = unmatchedSignature(signatureBody(decoded, text))
	res.Meta.ParseStatus = "skip"
	res.Meta.NRows = 0
	res.Meta.ErrorMsg = matchErr
	return res
}

// runLayoutMatcher calls one registry entry's signature predicate with a panic
// recovered into an error, for the same reason runLayoutParser does: a matcher
// runs on every text filing, so a nil dereference in one would take the worker
// down on bodies that have nothing to do with that layout.
func runLayoutMatcher(entry layoutEntry, head string) (matched bool, err error) {
	defer func() {
		if r := recover(); r != nil {
			matched = false
			err = fmt.Errorf("panic in layout matcher %s: %v", entry.Name, r)
		}
	}()
	if entry.Match == nil {
		return false, nil
	}
	return entry.Match(head), nil
}

// signatureBody returns the text a skip signature should fingerprint: the
// document body, not the SGML envelope. Every EDGAR full-submission file opens
// with the same envelope, so fingerprinting the head of the whole file gave 684
// unrelated skipped filings three labels between them and made the manifest's
// unparsed families uncountable. The envelope ends at </SEC-HEADER>, and the
// document's own wrapper tags follow it up to the first <TEXT>; both are stripped
// as markup during normalization, so the cut has to be made on the decoded bytes
// before it. Only the signature window is normalized, so this costs a bounded
// second pass on the skip path rather than a second pass over the body.
func signatureBody(decoded []byte, normalized string) string {
	i := indexFrom(decoded, 0, "</SEC-HEADER>")
	if i < 0 {
		return normalized
	}
	rest := decoded[i+len("</SEC-HEADER>"):]

	// The <DOCUMENT>/<TYPE>/<SEQUENCE>/<FILENAME> wrapper is a handful of short
	// lines; a <TEXT> further out than that belongs to something else.
	const wrapperWindow = 4 << 10
	limit := wrapperWindow
	if limit > len(rest) {
		limit = len(rest)
	}
	if j := indexFrom(rest[:limit], 0, "<TEXT>"); j >= 0 {
		rest = rest[j+len("<TEXT>"):]
	}

	if len(rest) > signatureHeadBytes {
		rest = rest[:signatureHeadBytes]
	}
	return string(stripHTML(rest))
}

// runLayoutParser calls one registry entry's parser with a panic recovered into
// an error, so a nil dereference deep in a layout is one bad manifest row rather
// than a dead worker.
func runLayoutParser(entry layoutEntry, text string, meta FilingMeta) (rows []VoteRow, err error) {
	defer func() {
		if r := recover(); r != nil {
			rows = nil
			err = fmt.Errorf("panic in layout %s: %v", entry.Name, r)
		}
	}()
	if entry.Parse == nil {
		return nil, fmt.Errorf("layout %s has no parser", entry.Name)
	}
	return entry.Parse(text, meta)
}

// stampRows carries the filing-level identity onto every row a layout produced.
// A layout that already set a field wins, because it is the only layer that
// knows which fund or series a vote belongs to.
func stampRows(rows []VoteRow, meta FilingMeta) []VoteRow {
	out := make([]VoteRow, 0, len(rows))
	for _, r := range rows {
		fill(&r.FilePath, meta.FilePath)
		fill(&r.Accession, meta.Accession)
		fill(&r.CIK, meta.CIK)
		fill(&r.PeriodOfReport, meta.PeriodOfReport)
		fill(&r.FiledDate, meta.FiledDate)
		fill(&r.FormType, meta.FormType)
		fill(&r.RegistrantName, meta.CompanyName)
		fill(&r.ParseMode, meta.ParseMode)
		fill(&r.Layout, meta.Layout)
		out = append(out, r)
	}
	return out
}

func fill(dst *string, v string) {
	if *dst == "" {
		*dst = v
	}
}

// hasNoActivitySentinel reports whether the body carries a "nothing to report"
// sentence. It does NOT on its own mean the filing had nothing to report — see
// parseText, which requires the absence of vote-table vocabulary as well.
//
// The scan is case-insensitive in place: this is the path every legacy filing no
// registry entry claimed travels, so lowercasing the whole body first allocated a
// second copy of the majority of the corpus to look for a handful of short ASCII
// phrases. The needles are ASCII, so a byte-wise fold is exact.
func hasNoActivitySentinel(text string) bool {
	return containsAnyFolded(text, noActivitySentinels)
}

// hasVoteTableVocabulary reports whether the body reads like a vote table. It is
// the guard on the sentinel: a body carrying this vocabulary is one we failed to
// parse, never one with nothing to report.
func hasVoteTableVocabulary(text string) bool {
	return containsAnyFolded(text, voteTableVocabulary)
}

// containsAnyFolded reports whether text carries any of the lowercase ASCII
// needles, comparing case-insensitively in place.
func containsAnyFolded(text string, needles []string) bool {
	for _, s := range needles {
		if s == "" || len(s) > len(text) {
			continue
		}
		lo := s[0]
		up := lo
		if lo >= 'a' && lo <= 'z' {
			up = lo - 'a' + 'A'
		}
		for i := 0; i+len(s) <= len(text); i++ {
			if c := text[i]; c != lo && c != up {
				continue
			}
			match := true
			for j := 1; j < len(s); j++ {
				d := text[i+j]
				if d >= 'A' && d <= 'Z' {
					d += 'a' - 'A'
				}
				if d != s[j] {
					match = false
					break
				}
			}
			if match {
				return true
			}
		}
	}
	return false
}

// structuralVocabulary is the label and column vocabulary a legacy N-PX report
// is written in. It is the ONLY thing a skip signature may be built from: every
// other word on the page — the ticker, the CUSIP, the month name, the issuer,
// the fund, the proposal text — varies filing to filing inside one family, and
// keeping any of it produces a label per FILING, which leaves unparsed families
// exactly as uncountable as one label for all of them.
//
// Membership alone is NOT enough, because most of this list is also ordinary
// English: SHARES, PROXY, RECORD, DATE, MANAGEMENT, ISSUER, REPORT, FOR and
// AGAINST all occur inside proposal text. A whitelist applied to every token
// wherever it occurs therefore made one family's signature a function of its
// AGENDA — "Approve Issuance of Shares to Management" contributed SHARES and
// MANAGEMENT, "Amend Proxy Access Bylaw" contributed PROXY, and two siblings of
// one format hashed apart. So a token counts only in a POSITION where the
// grammar puts labels and column headers, never in running text; see
// structuralTokens.
//
// Entries are uppercase and alphabetic, because tokenization is on letter runs.
// Value words that vary meeting to meeting inside a family (ABSTAIN, WITHHOLD,
// ANNUAL, SPECIAL, and the sponsor values) are deliberately ABSENT: they are not
// needed to name a grammar and would split one family across several labels the
// first time a filing carried a shareholder proposal.
var structuralVocabulary = map[string]bool{
	// security identity labels
	"TICKER": true, "SYMBOL": true, "CUSIP": true, "SEDOL": true,
	"ISIN": true, "SECURITY": true, "ID": true,
	// meeting labels
	"MEETING": true, "RECORD": true, "DATE": true, "TYPE": true,
	// agenda / proposal columns
	"ITEM": true, "PROP": true, "PROPOSAL": true, "PROPOSALS": true,
	"AGENDA": true, "BALLOT": true, "DESCRIPTION": true,
	// vote columns
	"VOTE": true, "VOTES": true, "VOTED": true, "VOTING": true,
	"CAST": true, "HOW": true, "SHARES": true,
	// recommendation columns
	"FOR": true, "AGAINST": true, "MANAGEMENT": true, "MGMT": true,
	"MGT": true, "REC": true, "RECOMMENDATION": true,
	"SPONSOR": true, "PROPOSED": true,
	// report scaffolding
	"PROXY": true, "REPORT": true, "REGISTRANT": true,
	"SIGNATURE": true, "PAGE": true, "FUND": true, "ISSUER": true,
}

// unmatchedSignature derives a stable, non-empty label for a body no registry
// entry claimed. Countability needs BOTH directions: every filing of one format
// family must land on one label, and two unrelated families must not collide.
// The label is therefore the SET of structural vocabulary the body uses — which
// is a property of the grammar, not of the issuer — rendered as a readable slug
// plus a hash. Ordering and per-line shape are deliberately not hashed: the
// proposal rows of one family differ line by line, so hashing them reintroduces
// the per-filing label this replaced.
func unmatchedSignature(text string) string {
	head := text
	if len(head) > signatureHeadBytes {
		head = head[:signatureHeadBytes]
	}

	label := ""
	seen := make(map[string]bool, len(structuralVocabulary))
	for _, line := range strings.Split(head, "\n") {
		toks := structuralTokens(line)
		if len(toks) == 0 {
			continue
		}
		if label == "" {
			label = joinLabel(toks)
		}
		for _, tok := range toks {
			seen[tok] = true
		}
	}
	if len(seen) == 0 {
		// No structural vocabulary at all: the honest answer is one bucket for
		// "we have nothing to group this by", not a per-filing label.
		return "unknown:unlabelled:00000000"
	}

	vocab := make([]string, 0, len(seen))
	for tok := range seen {
		vocab = append(vocab, tok)
	}
	sort.Strings(vocab)

	h := fnv.New32a()
	_, _ = h.Write([]byte(strings.Join(vocab, "|")))
	return fmt.Sprintf("unknown:%s:%08x", slug(label), h.Sum32())
}

// lineWord is one uppercased alphabetic run of a line together with the byte
// offsets it spans, so a caller can ask what SEPARATES two words — a colon, a
// column gap, or the single space of running prose.
type lineWord struct {
	text       string
	start, end int
}

// lineWords splits a line into its alphabetic runs. Digits and punctuation are
// separators and are not themselves words, which is what makes "Prop.#" yield
// PROP and "1a." yield A rather than either becoming an opaque token.
func lineWords(line string) []lineWord {
	up := strings.ToUpper(line)
	var out []lineWord
	i := 0
	for i < len(up) {
		if up[i] < 'A' || up[i] > 'Z' {
			i++
			continue
		}
		j := i
		for j < len(up) && up[j] >= 'A' && up[j] <= 'Z' {
			j++
		}
		out = append(out, lineWord{text: up[i:j], start: i, end: j})
		i = j
	}
	return out
}

// labelRunLimit caps how many words a label may span. Real N-PX labels are one
// to three words ("Ticker", "Meeting Date", "Holdings Recon Date"); the cap is
// what stops a back-walk from a stray colon in proposal text from swallowing a
// clause that happens to be built from vocabulary words.
const labelRunLimit = 4

// structuralTokens returns the grammar tokens one line contributes to a skip
// signature, in order of appearance. A vocabulary word counts ONLY in a position
// the grammar reserves for labels and column headers:
//
//   - the whole line is column-header vocabulary and nothing else, two words or
//     more — that is a column header, wherever it is indented to;
//   - a run of vocabulary words ending immediately before a colon — "Ticker:",
//     "Meeting Date:", "Security:";
//   - a run of vocabulary words opening the line at column 0 — labels and
//     footers start there, while proposal text is always preceded by an item
//     token and continuation lines are indented past the item column.
//
// Everything else on the line is discarded, so an agenda that says "Approve
// Issuance of Shares to Management" contributes nothing and two filings of one
// family agree. Words are joined into a run only across spaces and tabs: any
// other character between them means they are not one label.
func structuralTokens(line string) []string {
	words := lineWords(line)
	if len(words) == 0 {
		return nil
	}

	var out []string
	inOut := make(map[string]bool, len(words))
	add := func(toks []string) {
		for _, t := range toks {
			if !inOut[t] {
				inOut[t] = true
				out = append(out, t)
			}
		}
	}

	// A line made entirely of column vocabulary is a column header.
	allVocab := true
	for _, w := range words {
		if !structuralVocabulary[w.text] {
			allVocab = false
			break
		}
	}
	if allVocab && len(words) >= 2 {
		toks := make([]string, 0, len(words))
		for _, w := range words {
			toks = append(toks, w.text)
		}
		add(toks)
		return out
	}

	// Label position 1: a run opening the line at column 0.
	if words[0].start == 0 {
		add(labelRunForward(line, words, 0))
	}

	// Label position 2: a run ending immediately before a colon.
	for i, w := range words {
		if w.end < len(line) && line[w.end] == ':' {
			add(labelRunBackward(line, words, i))
		}
	}
	return out
}

// labelRunForward collects vocabulary words from index i rightwards while each is
// separated from the last by spaces alone.
func labelRunForward(line string, words []lineWord, i int) []string {
	var out []string
	for ; i < len(words) && len(out) < labelRunLimit; i++ {
		if !structuralVocabulary[words[i].text] {
			break
		}
		if i > 0 && !onlySpaces(line[words[i-1].end:words[i].start]) {
			break
		}
		out = append(out, words[i].text)
	}
	return out
}

// labelRunBackward collects vocabulary words from index i leftwards, returning
// them in reading order.
func labelRunBackward(line string, words []lineWord, i int) []string {
	var rev []string
	for ; i >= 0 && len(rev) < labelRunLimit; i-- {
		if !structuralVocabulary[words[i].text] {
			break
		}
		if i > 0 && !onlySpaces(line[words[i-1].end:words[i].start]) {
			rev = append(rev, words[i].text)
			break
		}
		rev = append(rev, words[i].text)
	}
	out := make([]string, 0, len(rev))
	for j := len(rev) - 1; j >= 0; j-- {
		out = append(out, rev[j])
	}
	return out
}

// onlySpaces reports whether a gap between two words is nothing but spaces and
// tabs. Any other character — a colon, a digit, a dash — means the words belong
// to different fields.
func onlySpaces(gap string) bool {
	for i := 0; i < len(gap); i++ {
		if gap[i] != ' ' && gap[i] != '\t' {
			return false
		}
	}
	return true
}

// joinLabel renders one line's structural tokens as the readable half of a
// signature.
func joinLabel(toks []string) string {
	out := strings.Join(toks, " ")
	if len(out) > 60 {
		out = strings.TrimSpace(out[:60])
	}
	return out
}

// slug renders a fingerprint line as a short TSV-safe token.
func slug(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if r >= 'a' && r <= 'z' {
			b.WriteRune(r)
			continue
		}
		if b.Len() > 0 && !strings.HasSuffix(b.String(), "-") {
			b.WriteByte('-')
		}
	}
	out := strings.Trim(b.String(), "-")
	if len(out) > 32 {
		out = strings.Trim(out[:32], "-")
	}
	if out == "" {
		return "unlabelled"
	}
	return out
}
