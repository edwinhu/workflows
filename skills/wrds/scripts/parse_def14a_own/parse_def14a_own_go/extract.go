package main

import (
	"regexp"
	"strings"
)

// Grid -> ownership rows.

// Row is one holder x one share class in one table.
type Row struct {
	Accession  string   `json:"accession"`
	CIK        string   `json:"cik"`
	Company    string   `json:"company"`
	FilingDate string   `json:"filing_date"`
	TableKind  string   `json:"table_kind"`
	TableIndex int      `json:"table_index"`
	RowIndex   int      `json:"row_index"`
	HolderName string   `json:"holder_name"`
	Shares     *float64 `json:"shares"`
	Percent    *float64 `json:"percent"`
	PctMarker  string   `json:"percent_marker"`
	ShareClass string   `json:"share_class"`
	IsGroupRow bool     `json:"is_group_row"`
	GroupN     int      `json:"group_n_persons"`
	Footnotes  string   `json:"footnote_markers"`
	Parser     string   `json:"parser"`
	SourceFile string   `json:"source_file"`

	// noHolder marks a row that is structurally part of the table — it counts
	// toward the two-row floor that decides whether the block is a table at
	// all — but names no holder, so it is never emitted. A row whose name is
	// only a postal address is the case this exists for.
	noHolder bool

	// classHint is a class / series / fund label recovered from a column
	// header rather than from a class-shaped value. It is copied onto
	// ShareClass by ScreenRows AFTER every drop rule has run, so recovering it
	// can populate the grain key without changing which rows are emitted.
	classHint string

	// series is per-FILING context, carried on the base Row: the fund / series
	// names the SGML header declares. Set only for a multi-series filing.
	series []string
	// seriesLocal marks a row whose fund identity came from a label row INSIDE
	// its own table, which is more specific than the document heading and must
	// not be overwritten by it.
	seriesLocal bool
}

var (
	reHdrPct    = regexp.MustCompile(`(?i)percent|%|of\s+class|of\s+outstanding`)
	reHdrShares = regexp.MustCompile(`(?i)shares|amount|number|beneficially\s+owned|ownership|aggregate`)
	reHdrClass  = regexp.MustCompile(`(?i)\bclass\s+[a-d]\b|common\s+stock|series\s+[a-z0-9]+\s+(?:common|preferred)|preferred\s+stock|ordinary\s+shares|\bclass\s+[a-d]$`)
	// reHdrNameCol matches the header of the column that names the HOLDER.
	// "Title of Class" is deliberately absent: it heads a class column, and a
	// proxy that puts one to the left of the holder column otherwise has its
	// class labels read as holder names.
	reHdrNameCol = regexp.MustCompile(`(?i)\bname\b|beneficial\s+owner|stockholder|shareholder|\bholder`)
	// reHdrClassCol matches the header of a ROW-LEVEL column stating which
	// class, series or fund the row's holding is in. Anchored at the head of
	// the header so "Percentage of Fund" is not read as a fund column.
	reHdrClassCol = regexp.MustCompile(`(?i)^\s*(?:title\s+of\s+(?:class|series)|class\s+of\s+(?:stock|shares|securities)|share\s+class|series|fund|portfolio)\b`)
	// A footnote reference trailing a column header: "... of stock (2)".
	reHdrFootnote = regexp.MustCompile(`\s*\(\d{1,2}\)\s*$`)
	// A column of MONEY, not of shares. A fund-family proxy's trustee table
	// prints compensation in dollars beside a "dollar range of fund shares
	// owned" column, so the ownership cue matches the table and the dollars are
	// read as a share count. The second half of the alternation is what keeps a
	// genuine "shares beneficially owned" column out of this.
	reHdrMoney = regexp.MustCompile(`(?i)compensation|fees\s+earned|\bsalary\b|\bbonus\b|dollar\s+(?:range|value|amount)`)
	reHdrOwned = regexp.MustCompile(`(?i)shares?\s+(?:owned|held|beneficially)|beneficially\s+owned|percent`)
	reSkipName  = regexp.MustCompile(`(?i)^(name|names?\s+(and\s+address\s+)?of\s+.*|(name\s+of\s+)?beneficial\s+owners?|title\s+of\s+class|total|subtotal|directors?|non-?employee\s+directors?|executive\s+officers?|named\s+executive\s+officers?|nominees?|continuing\s+directors?|other\s+executive\s+officers?|5%\s+.*|principal\s+.*holders?|common\s+stock|class\s+[a-d].*)$`)
	// The table must look like an ownership table, not an equity-comp-plan or
	// compensation table that also carries share counts.
	reOwnCue = regexp.MustCompile(`(?i)beneficial|percent\s*(?:age)?\s*of\s*(?:class|shares|common|outstanding)|amount\s+and\s+nature|%\s*of\s*class|shares\s+owned|owned\s+of\s+record|as\s+a\s+group|principal\s+(?:stock|share)holders`)
	// Compensation, option-grant and pay-ratio tables also carry names, share
	// counts and percents. "Percent of total options granted" is the one that
	// slips past the ownership cue, so the option-grant vocabulary is listed.
	reCompCue = regexp.MustCompile(`(?i)equity\s+compensation\s+plan|weighted[- ]average\s+exercise\s+price|securities\s+remaining\s+available|option\s+awards|stock\s+awards|salary|bonus|summary\s+compensation|options?\s+granted|exercise\s+price|expiration\s+date|grant\s+date\s+present\s+value|all\s+other\s+compensation|long[- ]term\s+incentive|individual\s+grants|realizable\s+value`)
)

type colRole struct {
	role   string // "name" | "shares" | "pct" | "class" | "other"
	header string
}

type compacted struct {
	rows    [][]string
	pctFlag []bool
	nHeader int
	roles   []colRole
	// hdrClassCol is the class column chosen by its HEADER (repoint below),
	// as opposed to one chosen by its values matching reClassVal. Its label is
	// carried on Row.classHint rather than Row.ShareClass so that no existing
	// screen decision changes: the layout screen reads ShareClass.
	hdrClassCol int
	// series is the set of fund / series names the filing's SGML header
	// declares, folded by NormLabel. A column whose cells are those names is
	// the fund column of a fund-family proxy, whatever its header says.
	series map[string]string
}

// compact drops columns that never hold anything but $ ( ) % and whitespace —
// the fragment cells EDGAR HTML splits numbers across — while remembering that a
// dropped "%"-only column marks its left neighbour as a percent column.
func compact(g *Grid) *compacted {
	// 1. Drop footnote rows: a rowspan/colspan-expanded full-width paragraph
	//    repeats one long string across every column and would otherwise
	//    dominate every column's role vote.
	var keepRows [][]string
	for i := range g.Rows {
		distinct := map[string]bool{}
		maxLen := 0
		for _, c := range g.Rows[i] {
			if c == "" {
				continue
			}
			distinct[c] = true
			if len(c) > maxLen {
				maxLen = len(c)
			}
		}
		if len(distinct) == 1 && maxLen > 90 && len(g.Rows[i]) > 2 {
			continue
		}
		keepRows = append(keepRows, g.Rows[i])
	}

	ncol := 0
	for _, r := range keepRows {
		if len(r) > ncol {
			ncol = len(r)
		}
	}
	at := func(i, j int) string {
		if j < len(keepRows[i]) {
			return keepRows[i][j]
		}
		return ""
	}

	// 2. Drop columns that never hold anything but $ ( ) % and whitespace — the
	//    fragment cells EDGAR HTML splits numbers across — remembering that a
	//    dropped "%"-only column marks its left neighbour as a percent column.
	// Header signature per raw column, used to decide which adjacent columns
	// are one logical column split by colspan.
	hdrEnd := len(keepRows)
	for i := range keepRows {
		if rowIsData(keepRows[i]) {
			hdrEnd = i
			break
		}
	}
	sig := make([]string, ncol)
	for j := 0; j < ncol; j++ {
		var parts []string
		for i := 0; i < hdrEnd; i++ {
			if v := flat(at(i, j)); v != "" {
				parts = append(parts, v)
			}
		}
		sig[j] = strings.Join(uniq(parts), " ")
	}

	var groups [][]int
	pctFlag := []bool{}
	for j := 0; j < ncol; j++ {
		junk, sawPct := true, false
		for i := range keepRows {
			c := at(i, j)
			if c == "" {
				continue
			}
			if !reOnlyPunct.MatchString(flat(c)) {
				junk = false
			}
			if strings.Contains(c, "%") {
				sawPct = true
			}
		}
		if junk {
			if sawPct && len(pctFlag) > 0 {
				pctFlag[len(pctFlag)-1] = true
			}
			continue
		}
		// 3. Merge column j into the previous kept column when the two are one
		//    logical column the colspan expansion split: identical contents, or
		//    the same header with no row filling both.
		if len(groups) > 0 {
			prev := groups[len(groups)-1]
			p := prev[len(prev)-1]
			// Compatible = no row where the two hold DIFFERENT non-empty
			// values. Equal values are the colspan replication itself, and a
			// spanning footnote row must not block the merge.
			compatible := true
			for i := range keepRows {
				a, b := at(i, p), at(i, j)
				if a != "" && b != "" && a != b {
					compatible = false
					break
				}
			}
			if compatible && sig[p] == sig[j] {
				groups[len(groups)-1] = append(prev, j)
				continue
			}
		}
		groups = append(groups, []int{j})
		pctFlag = append(pctFlag, false)
	}
	rows := make([][]string, len(keepRows))
	for i := range keepRows {
		r := make([]string, len(groups))
		for k, g := range groups {
			for _, j := range g {
				if v := at(i, j); v != "" {
					r[k] = v
					break
				}
			}
		}
		rows[i] = r
	}
	return &compacted{rows: rows, pctFlag: pctFlag, hdrClassCol: -1}
}

// compactWith is compact plus the per-filing context the role vote reads: the
// declared fund / series names. A filing declaring fewer than two series has
// nothing to disambiguate, so the set is left nil.
func compactWith(g *Grid, base Row) *compacted {
	c := compact(g)
	if len(base.series) >= 2 {
		c.series = make(map[string]string, len(base.series))
		for _, s := range base.series {
			c.series[NormLabel(s)] = strings.Join(strings.Fields(s), " ")
		}
	}
	return c
}

func rowIsData(raw []string) bool {
	hasName, hasNum := false, false
	for _, c0 := range raw {
		c := flat(c0)
		if c == "" {
			continue
		}
		if hasWords(c, 1) && len(c) >= 3 && !reOnlyPunct.MatchString(c) {
			hasName = true
		}
		if v, ok := ParseShares(c); ok && v >= 100 {
			hasNum = true
		}
		if _, _, mk, pi := ParsePercent(c); pi && (mk == "*" || mk == "<1%" || strings.Contains(c, "%")) {
			hasNum = true
		}
	}
	return hasName && hasNum
}

func (c *compacted) analyze() {
	// header block = rows before the first data-shaped row
	c.nHeader = 0
	for i, r := range c.rows {
		if rowIsData(r) {
			c.nHeader = i
			break
		}
		if i == len(c.rows)-1 {
			c.nHeader = len(c.rows)
		}
	}
	ncol := 0
	for _, r := range c.rows {
		if len(r) > ncol {
			ncol = len(r)
		}
	}
	c.roles = make([]colRole, ncol)
	for j := 0; j < ncol; j++ {
		var hdr []string
		for i := 0; i < c.nHeader && i < len(c.rows); i++ {
			if j < len(c.rows[i]) && c.rows[i][j] != "" {
				hdr = append(hdr, flat(c.rows[i][j]))
			}
		}
		c.roles[j].header = strings.Join(uniq(hdr), " | ")
	}
	nameCol := -1
	for j := 0; j < ncol; j++ {
		words, strongPct, bigNum, pctish, classish, seriesish, n := 0, 0, 0, 0, 0, 0, 0
		for i := c.nHeader; i < len(c.rows); i++ {
			if j >= len(c.rows[i]) {
				continue
			}
			cell := flat(c.rows[i][j])
			if cell == "" {
				continue
			}
			n++
			if hasWords(cell, 2) {
				words++
			}
			if strings.Contains(cell, "%") || reStar.MatchString(cell) || reLessThan.MatchString(cell) {
				strongPct++
			}
			if v, ok := ParseShares(cell); ok && (v >= 1000 || strings.Contains(cell, ",")) {
				bigNum++
			}
			if _, _, _, pi := ParsePercent(cell); pi {
				pctish++
			}
			if reClassVal.MatchString(cell) {
				classish++
			}
			if c.series[NormLabel(cell)] != "" {
				seriesish++
			}
		}
		hdr := c.roles[j].header
		switch {
		case n == 0:
			c.roles[j].role = "other"
		case reHdrMoney.MatchString(hdr) && !reHdrOwned.MatchString(hdr):
			// Money, not shares. Runs before the numeric votes so a dollar
			// column cannot be read as a share count.
			c.roles[j].role = "other"
		case seriesish*2 >= n && seriesish > 0 && bigNum == 0:
			// A fund-family proxy lists the fund in a column of its own; the
			// holder column is the next one along.
			c.roles[j].role = "class"
			c.hdrClassCol = j
		case classish*2 >= n && classish > 0 && bigNum == 0:
			c.roles[j].role = "class"
		case c.pctFlag[j] || strongPct > bigNum && strongPct > 0:
			c.roles[j].role = "pct"
		case bigNum > 0:
			c.roles[j].role = "shares"
		case reHdrPct.MatchString(hdr) && pctish > 0:
			c.roles[j].role = "pct"
		case reHdrShares.MatchString(hdr) && pctish > 0:
			c.roles[j].role = "shares"
		case words*2 >= n && nameCol < 0:
			c.roles[j].role = "name"
		case pctish > 0:
			c.roles[j].role = "pct"
		default:
			c.roles[j].role = "other"
		}
		if c.roles[j].role == "name" && nameCol < 0 {
			nameCol = j
		}
	}
	if nameCol < 0 {
		// first column with any words becomes the name column
		for j := 0; j < ncol; j++ {
			for i := c.nHeader; i < len(c.rows); i++ {
				if j < len(c.rows[i]) && hasWords(flat(c.rows[i][j]), 1) {
					c.roles[j].role = "name"
					nameCol = j
					break
				}
			}
			if nameCol >= 0 {
				break
			}
		}
	}
	c.repoint()
}

// colWords counts the data cells of column j that carry at least one word.
func (c *compacted) colWords(j int) int {
	n := 0
	for i := c.nHeader; i < len(c.rows); i++ {
		if j < len(c.rows[i]) && hasWords(flat(c.rows[i][j]), 1) {
			n++
		}
	}
	return n
}

// repoint fixes the two layouts where a GROUPING column stands to the left of
// the holder column and is therefore taken for it: a fund-family proxy's "Fund"
// column, and a "Title of Class" column. The first word-bearing column is the
// holder only when nothing else is headed like the holder column.
//
// It then gives a row-level class / series / fund column the "class" role
// whatever its values look like, so the identity of the holding reaches
// share_class instead of collapsing distinct rows onto one key.
func (c *compacted) repoint() {
	isNameHdr := func(j int) bool {
		h := c.roles[j].header
		return reHdrNameCol.MatchString(h) && !reHdrClassCol.MatchString(h)
	}
	nc := -1
	for j := range c.roles {
		if c.roles[j].role == "name" {
			nc = j
			break
		}
	}
	if nc >= 0 && !isNameHdr(nc) {
		for j := range c.roles {
			if j == nc || c.roles[j].role != "other" {
				continue
			}
			if isNameHdr(j) && c.colWords(j) > 0 {
				c.roles[j].role = "name"
				c.roles[nc].role = "other"
				nc = j
				break
			}
		}
	}
	for j := range c.roles {
		if j == nc || c.roles[j].role != "other" {
			continue
		}
		if reHdrClassCol.MatchString(c.roles[j].header) && c.colWords(j) > 0 {
			c.roles[j].role = "class"
			c.hdrClassCol = j
			break
		}
	}
}

// matchSeries reports which declared fund / series name a cell states, allowing
// a short trailing parenthetical the proxy adds for the reader ("Vanguard 500
// Index Fund (1976)"). Returns "" when the cell names no declared series.
func (c *compacted) matchSeries(cell string) string {
	if c.series == nil {
		return ""
	}
	n := NormLabel(cell)
	if n == "" || len(n) < 6 {
		return ""
	}
	if v := c.series[n]; v != "" {
		return v
	}
	f := strings.Fields(n)
	for drop := 1; drop <= 2 && drop < len(f); drop++ {
		if v := c.series[strings.Join(f[:len(f)-drop], " ")]; v != "" {
			return v
		}
	}
	return ""
}

// seriesRowLabel reports the fund a full-width LABEL ROW inside the table names.
// A fund-family proxy that puts several funds in one table separates them with
// such a row; without it every fund's record holders collapse onto one key.
func (c *compacted) seriesRowLabel(r []string) string {
	if c.series == nil {
		return ""
	}
	lbl := ""
	for _, cell := range r {
		v := flat(cell)
		if v == "" {
			continue
		}
		if _, ok := ParseShares(v); ok {
			return ""
		}
		if _, _, _, pi := ParsePercent(v); pi {
			return ""
		}
		m := c.matchSeries(v)
		if m == "" {
			return ""
		}
		if lbl == "" {
			lbl = m
		}
	}
	return lbl
}

// cleanClassLabel trims a column header down to something usable as a class
// label: one line, no trailing footnote reference.
func cleanClassLabel(s string) string {
	s = strings.TrimSpace(reHdrFootnote.ReplaceAllString(flat(s), ""))
	if len(s) > 180 {
		s = strings.TrimSpace(s[:180])
	}
	return s
}

// pairLabel is the fallback identity of a (shares, percent) column pair whose
// header names no share class: the DEEPEST header cell standing over it, which
// is the one that distinguishes it from its siblings ("Total", "Percentage of
// combined voting power"). Used only where a table emits more than one pair per
// holder row, which is exactly where an unlabelled pair collapses onto its
// sibling's key.
func (c *compacted) pairLabel(p pair) string {
	cols := []int{}
	if p.shares >= 0 {
		cols = append(cols, p.shares)
	}
	if p.pct >= 0 {
		cols = append(cols, p.pct)
	}
	best := ""
	for i := 0; i < c.nHeader && i < len(c.rows); i++ {
		for _, j := range cols {
			if j < len(c.rows[i]) {
				if v := flat(c.rows[i][j]); v != "" {
					best = v
				}
			}
		}
	}
	return cleanClassLabel(best)
}

type pair struct{ shares, pct int }

func (c *compacted) pairs() []pair {
	// A table with no percent column at all (J&J's director table: common
	// shares, deferred units, options, total) is one holding per row, not one
	// per numeric column: emit only the total/beneficially-owned column, else
	// the last share column, which is the total in every layout seen.
	nPct := 0
	shareCols := []int{}
	for j, r := range c.roles {
		if r.role == "pct" {
			nPct++
		}
		if r.role == "shares" {
			shareCols = append(shareCols, j)
		}
	}
	if nPct == 0 && len(shareCols) > 1 {
		best := shareCols[len(shareCols)-1]
		for _, j := range shareCols {
			if regexp.MustCompile(`(?i)total|beneficially\s+owned`).MatchString(c.roles[j].header) {
				best = j
				break
			}
		}
		return []pair{{best, -1}}
	}
	var out []pair
	pending := -1
	for j, r := range c.roles {
		switch r.role {
		case "shares":
			if pending >= 0 {
				out = append(out, pair{pending, -1})
			}
			pending = j
		case "pct":
			out = append(out, pair{pending, j})
			pending = -1
		}
	}
	if pending >= 0 {
		out = append(out, pair{pending, -1})
	}
	// Where the table has percent columns, a share column with no percent of
	// its own is a component (options, deferred units, sole vs shared power),
	// not another class: keep only the paired columns.
	if nPct > 0 {
		var kept []pair
		for _, p := range out {
			if p.pct >= 0 {
				kept = append(kept, p)
			}
		}
		if len(kept) > 0 {
			return kept
		}
	}
	return out
}

// classLabel reads the multi-class column header spanning a (shares, pct) pair.
// colspan expansion has already replicated a "Class B Common Stock" header
// across both of its columns, so the label is simply the topmost class-shaped
// header cell over either column.
func (c *compacted) classLabel(p pair) string {
	cols := []int{}
	if p.shares >= 0 {
		cols = append(cols, p.shares)
	}
	if p.pct >= 0 {
		cols = append(cols, p.pct)
	}
	for i := 0; i < c.nHeader && i < len(c.rows); i++ {
		for _, j := range cols {
			if j < len(c.rows[i]) {
				v := flat(c.rows[i][j])
				if v != "" && reHdrClass.MatchString(v) {
					return v
				}
			}
		}
	}
	return ""
}

func (c *compacted) nameCol() int {
	for j, r := range c.roles {
		if r.role == "name" {
			return j
		}
	}
	return 0
}

func (c *compacted) classCol() int {
	for j, r := range c.roles {
		if r.role == "class" {
			return j
		}
	}
	return -1
}

// looksLikeOwnershipTable is the guard against compensation and equity-plan
// tables, which also carry names and share counts.
func (c *compacted) looksLikeOwnership(tableText string) bool {
	if reCompCue.MatchString(tableText) && !reOwnCue.MatchString(tableText) {
		return false
	}
	if !reOwnCue.MatchString(tableText) {
		return false
	}
	ndata := 0
	for i := c.nHeader; i < len(c.rows); i++ {
		if rowIsData(c.rows[i]) {
			ndata++
		}
	}
	if ndata < 2 {
		return false
	}
	hasP := false
	for _, r := range c.roles {
		if r.role == "pct" || r.role == "shares" {
			hasP = true
		}
	}
	return hasP
}

var reAddrLine = regexp.MustCompile(`(?i)^(\d|P\.?\s?O\.?\s+box|one\s+\w+\s+(street|plaza|place|way|center|centre|avenue)|c/o\b|[\w\s]+,\s*[A-Z]{2}\s+\d{5})`)

// holderName takes the first line of a 5% holder's cell when the lines that
// follow are the mailing address EDGAR proxies put under the name.
func holderName(cell string) string {
	lines := strings.Split(cell, "\n")
	if len(lines) < 2 {
		return flat(cell)
	}
	first := strings.TrimSpace(lines[0])
	if !hasWords(first, 1) {
		return flat(cell)
	}
	for _, l := range lines[1:] {
		if reAddrLine.MatchString(strings.TrimSpace(l)) {
			return first
		}
	}
	return flat(cell)
}

// dropAddress trims a mailing address that a proxy wrote inline with the name:
// "The Vanguard Group, 100 Vanguard Blvd., Malvern, PA 19355".
func dropAddress(name string) string {
	parts := strings.Split(name, ", ")
	if len(parts) < 2 {
		return name
	}
	for i := 1; i < len(parts); i++ {
		if reAddrLine.MatchString(strings.TrimSpace(parts[i])) {
			return strings.TrimSpace(strings.Join(parts[:i], ", "))
		}
	}
	return name
}

// ExtractGrid emits one Row per (data row x class pair).
func ExtractGrid(g *Grid, tableText string, base Row, tableIdx int) []Row {
	c := compactWith(g, base)
	c.analyze()
	if !c.looksLikeOwnership(tableText) {
		return nil
	}
	nc := c.nameCol()
	cc := c.classCol()
	ps := c.pairs()
	// A percent column with no share column of its own, sharing a class label
	// with a complete pair, is the same logical column the colspan split in a
	// way compaction could not repair. Emitting it duplicates the holder.
	if len(ps) > 1 {
		labels := map[string]bool{}
		for _, p := range ps {
			if p.shares >= 0 {
				labels[c.classLabel(p)] = true
			}
		}
		var kept []pair
		for _, p := range ps {
			if p.shares < 0 && labels[c.classLabel(p)] {
				continue
			}
			kept = append(kept, p)
		}
		ps = kept
	}
	if len(ps) == 0 {
		return nil
	}
	var out []Row
	lastName, lastClass, lastSeries := "", "", ""
	// The first fund's label row sits in the header block, above the column
	// headings, so the walk below would never see it.
	for i := 0; i < c.nHeader && i < len(c.rows); i++ {
		if lbl := c.seriesRowLabel(c.rows[i]); lbl != "" {
			lastSeries = lbl
		}
	}
	for i := c.nHeader; i < len(c.rows); i++ {
		r := c.rows[i]
		// A full-width label row naming one of the filing's funds separates the
		// funds a single table covers. It names no holder and carries no number.
		if lbl := c.seriesRowLabel(r); lbl != "" {
			lastSeries, lastClass = lbl, ""
			continue
		}
		// The row-level class / fund column is written once and left blank on
		// the rows that continue the same class, so it is forward-filled —
		// before the name checks below, which may skip this row entirely.
		rowClass, rowHint := "", ""
		if cc >= 0 {
			v := ""
			if cc < len(r) {
				v = r[cc]
			}
			if cc == c.hdrClassCol {
				if fv := flat(v); fv != "" {
					lastClass = fv
				}
				rowHint = lastClass
			} else {
				rowClass = v
			}
		}
		if nc >= len(r) {
			continue
		}
		name, fns := StripFootnotes(holderName(r[nc]))
		name = dropAddress(name)
		// A 5% holder is often laid out over two grid rows: the name alone,
		// then the address with the numbers beside it.
		if reAddrLine.MatchString(name) && lastName != "" {
			name = lastName
		} else if name != "" {
			lastName = name
		}
		if name == "" || !hasWords(name, 1) || reSkipName.MatchString(name) {
			continue
		}
		// Still nothing but an address after the two recovery attempts above:
		// the cell names no holder.
		if isAddressLine(name) {
			continue
		}
		grp, gn := isGroupRow(name)
		for _, p := range ps {
			rw := base
			rw.TableIndex = tableIdx
			rw.RowIndex = i
			rw.HolderName = name
			rw.IsGroupRow = grp
			rw.GroupN = gn
			rw.Parser = "html_dom"
			allFns := append([]string{}, fns...)
			if p.shares >= 0 && p.shares < len(r) {
				if v, ok := ParseShares(r[p.shares]); ok {
					vv := v
					rw.Shares = &vv
				}
				if _, f := StripFootnotes(r[p.shares]); len(f) > 0 {
					allFns = append(allFns, f...)
				}
			}
			if p.pct >= 0 && p.pct < len(r) {
				v, ok, mk, _ := ParsePercent(r[p.pct])
				if ok {
					vv := v
					rw.Percent = &vv
				}
				rw.PctMarker = mk
			}
			if rw.Shares == nil && rw.Percent == nil && rw.PctMarker == "" {
				continue
			}
			cl := c.classLabel(p)
			hint := rowHint
			if cl == "" && rowClass != "" {
				cl = rowClass
			}
			// Several value column pairs per holder row and no class-shaped
			// header over them: the pair's own deepest header is what tells
			// them apart, and it composes with a fund label rather than
			// replacing it.
			if cl == "" && len(ps) > 1 {
				hint = withSeries(hint, c.pairLabel(p))
			}
			if lastSeries != "" {
				hint = withSeries(lastSeries, hint)
				rw.seriesLocal = true
			}
			rw.ShareClass = cl
			rw.classHint = cleanClassLabel(hint)
			rw.Footnotes = strings.Join(uniq(allFns), ",")
			out = append(out, rw)
		}
	}
	return out
}
