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
}

var (
	reHdrPct    = regexp.MustCompile(`(?i)percent|%|of\s+class|of\s+outstanding`)
	reHdrShares = regexp.MustCompile(`(?i)shares|amount|number|beneficially\s+owned|ownership|aggregate`)
	reHdrClass  = regexp.MustCompile(`(?i)\bclass\s+[a-d]\b|common\s+stock|series\s+[a-z0-9]+\s+(?:common|preferred)|preferred\s+stock|ordinary\s+shares|\bclass\s+[a-d]$`)
	reHdrName   = regexp.MustCompile(`(?i)name|beneficial\s+owner|stockholder|shareholder|holder|director|officer|title\s+of\s+class`)
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
	return &compacted{rows: rows, pctFlag: pctFlag}
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
		words, strongPct, bigNum, pctish, classish, n := 0, 0, 0, 0, 0, 0
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
		}
		hdr := c.roles[j].header
		switch {
		case n == 0:
			c.roles[j].role = "other"
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
	c := compact(g)
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
	lastName := ""
	for i := c.nHeader; i < len(c.rows); i++ {
		r := c.rows[i]
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
			if cl == "" && cc >= 0 && cc < len(r) {
				cl = r[cc]
			}
			rw.ShareClass = cl
			rw.Footnotes = strings.Join(uniq(allFns), ",")
			out = append(out, rw)
		}
	}
	return out
}
