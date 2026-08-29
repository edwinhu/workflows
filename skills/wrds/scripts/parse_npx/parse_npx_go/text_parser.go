package main

import (
	"errors"
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
//
// ParseRaw is the alternative to Parse for a grammar whose structure normalization
// destroys. stripHTML preserves WHERE the lines were, which is all a line-oriented
// layout needs, but a <table> grammar's only record of which cell belongs to which
// column is the markup itself. A layout setting ParseRaw receives the
// charset-decoded bytes and is preferred over Parse; the two are never both used.
type layoutEntry struct {
	Name     string
	Match    func(head string) bool
	Parse    func(text string, meta FilingMeta) ([]VoteRow, error)
	ParseRaw func(raw []byte, text string, meta FilingMeta) ([]VoteRow, error)
}

// errLayoutDeclined is returned by a layout that matched on its cheap signature
// but, having read the body, cannot parse it. The registry then treats the entry
// as no match and carries on, so the filing lands in parse_status=skip with a
// body-derived signature rather than being parsed against a guess.
//
// This exists for htmltable, whose match test IS the header search: whether a
// document prints an identifiable column header cannot be decided from the
// stripped head, and a mis-mapped column on this population cannot be caught
// downstream, so declining is the only safe answer.
var errLayoutDeclined = errors.New("layout declined the body")

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
	// htmltable is LAST and must stay last: it is the generic fallback for the
	// unclaimed HTML-table residue, and it offers itself to every body the named
	// layouts declined. Ahead of any of them it would steal filings whose vendor
	// grammar a specific parser reads better.
	{
		Name:     "htmltable",
		Match:    matchHTMLTable,
		ParseRaw: parseHTMLTableRaw,
	},
}

// matchHTMLTable admits every body the named layouts declined. There is nothing
// cheaper it could honestly test: the head it is handed has already had its
// markup stripped, so the table this layout keys on is not visible here. The
// real gate is parseHTMLTableRaw, which declines a body with no identifiable
// header; the cheap bail for a document with no table markup at all lives there,
// where the raw bytes are.
func matchHTMLTable(string) bool { return true }

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
// Every entry must be lowercase ASCII with single spaces between words —
// hasNoActivitySentinel folds the body against it in place rather than
// lowercasing a copy, and each of those spaces matches a whole run of
// whitespace, the line break included.
//
// Each phrase is the SHORTEST form that still carries the negation. A longer
// spelling that merely prefixes a subject ("the fund did not vote any proxies")
// is not a separate entry: the scan is a substring search run over the whole
// body of every filing no layout claimed, so a redundant needle is a full extra
// pass over the corpus that can never match anything the short form missed.
var noActivitySentinels = []string{
	"no proxy voting activity",
	"did not vote any proxies",
	"no matters were voted",
	"there were no proxy votes",
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
	if hasVanguardColumnHeader(up) {
		return true
	}
	fund := strings.Index(up, "FUND:")
	if fund < 0 {
		return false
	}
	return strings.Contains(up[fund:], "ISSUER:")
}

// hasVanguardColumnHeader looks for the one physical line that carries
// PROPOSAL:, PROPOSED BY and VOTE CAST together — the column header the grammar
// actually prints, and the same line parseVanguard reads its column arity off:
//
//	PROPOSAL:              PROPOSED BY      VOTED?      VOTE CAST           MGMT
//
// Anchoring to a line is what makes this a signature. The three tokens searched
// for separately over the whole 128 KB window claimed 288 filings in an
// unrelated HTML <table> grammar, where "Proposed By" and "Vote Cast" are <th>
// cells alone on their own lines and "PROPOSAL:" is the tail of the phrase
// "SHAREHOLDER PROPOSAL:" inside a proposal description; that grammar orders its
// columns differently, so the 60,719 rows it yielded were shredded across the
// wrong ones. A layout must not claim what it cannot parse — the registry lands
// an unclaimed family in parse_status=skip with a body-derived signature, which
// keeps it countable instead of silently wrong.
//
// head must already be uppercased. The scan walks the window once, without
// materialising a slice of its lines.
func hasVanguardColumnHeader(head string) bool {
	for len(head) > 0 {
		line := head
		if i := strings.IndexByte(head, '\n'); i >= 0 {
			line, head = head[:i], head[i+1:]
		} else {
			head = ""
		}
		if strings.Contains(line, "PROPOSAL:") &&
			strings.Contains(line, "PROPOSED BY") &&
			strings.Contains(line, "VOTE CAST") {
			return true
		}
	}
	return false
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
		rows, perr := runLayoutParser(entry, decoded, text, res.Meta)
		if errors.Is(perr, errLayoutDeclined) {
			// Not a parse failure: the layout read the body and found nothing it
			// can key on. Unset the name so the filing keeps its body-derived
			// skip signature and stays countable in the manifest.
			res.Meta.Layout = ""
			continue
		}
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
	if !hasVoteTableVocabulary(text) {
		if hasNoActivitySentinel(text) {
			res.Meta.Layout = "no-activity"
			res.Meta.ParseStatus = "ok"
			res.Meta.NRows = 0
			return res
		}
		// A cover page says nothing at all rather than saying it has nothing:
		// registrant, address, signature, and a proxy voting record that is simply
		// absent. 2,792 of the 5,529 HTML documents still declining are this shape.
		// `skip` on one of them asserts we failed to read a filing that holds
		// nothing to read, and buries the filings we genuinely cannot parse under
		// five times their number in noise.
		//
		// The table test is not decoration. ~300 of the same 5,529 also carry no
		// vocabulary and hundreds of real votes, in a table whose columns are
		// positional and unlabelled; vocabulary alone would declare those empty.
		if htmlPrintsNoVoteTable(decoded) {
			res.Meta.Layout = "cover-page"
			res.Meta.ParseStatus = "ok"
			res.Meta.NRows = 0
			return res
		}
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
func runLayoutParser(entry layoutEntry, raw []byte, text string, meta FilingMeta) (rows []VoteRow, err error) {
	defer func() {
		if r := recover(); r != nil {
			rows = nil
			err = fmt.Errorf("panic in layout %s: %v", entry.Name, r)
		}
	}()
	if entry.ParseRaw != nil {
		return entry.ParseRaw(raw, text, meta)
	}
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
// needles, comparing case-insensitively in place and letting ONE space in a
// needle match a whole run of whitespace in the text.
//
// The whitespace run is what makes this work on HTML bodies. A filer's editor
// hard-wraps prose mid-sentence and stripHTML preserves the break, so
// "There is no\nproxy voting activity for the Fund" carries the sentinel with a
// newline inside it; an exact-space needle misses it and the filing lands in
// parse_status=skip, claiming we failed to read a document that says in plain
// English it has nothing in it to read. Block tags contribute breaks the same
// way, so the wrap column is not the only place this happens.
//
// text is already whitespace-collapsed by stripHTML, so the run a space consumes
// is short; the scan stays O(len(text)) per needle with no allocation.
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
		// A match is at least len(s) bytes long -- a space may consume more than
		// one byte, never fewer -- so this bound cannot cut a real match short.
		for i := 0; i+len(s) <= len(text); i++ {
			if c := text[i]; c != lo && c != up {
				continue
			}
			if matchFoldedAt(text, i, s) {
				return true
			}
		}
	}
	return false
}

// matchFoldedAt matches needle s against text starting at i, folding ASCII case
// and expanding each space in s to one or more whitespace bytes.
func matchFoldedAt(text string, i int, s string) bool {
	t := i
	for j := 0; j < len(s); j++ {
		if s[j] == ' ' {
			n := 0
			for t < len(text) && isASCIISpace(text[t]) {
				t++
				n++
			}
			if n == 0 {
				return false
			}
			continue
		}
		if t >= len(text) {
			return false
		}
		d := text[t]
		if d >= 'A' && d <= 'Z' {
			d += 'a' - 'A'
		}
		if d != s[j] {
			return false
		}
		t++
	}
	return true
}

func isASCIISpace(c byte) bool {
	switch c {
	case ' ', '\t', '\n', '\r', '\v', '\f':
		return true
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
