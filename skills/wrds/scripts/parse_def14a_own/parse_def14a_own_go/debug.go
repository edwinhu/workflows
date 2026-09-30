package main

import (
	"fmt"
	"os"
	"strings"

	"golang.org/x/net/html"
)

// DebugFile prints, for one cached proxy, every table the DOM walk sees and why
// it was accepted or rejected. Diagnostic only; not part of the pipeline.
func DebugFile(path string, maxTables int) {
	raw, err := os.ReadFile(path)
	must(err)
	body := PrimaryDocument(string(raw))
	// The debug view must see exactly what the pipeline sees: the declared
	// fund / series names are per-filing context the extractor reads.
	base := Row{series: SeriesNames(string(raw))}
	fmt.Printf("bytes=%d isHTML=%v series=%d\n", len(body), IsHTML(body), len(base.series))
	// The prose reader runs only when both column readers emit nothing, but its
	// candidates are printed unconditionally: a filing that loses a holder to a
	// name rule is otherwise indistinguishable from one with no prose at all.
	proseDropReasons = map[string]int{}
	if pr := ExtractProse(body, base); len(pr) > 0 || len(proseDropReasons) > 0 {
		drops := proseDropReasons
		proseDropReasons = nil
		screenDropReasons = map[string]int{}
		kept := len(ScreenRows(pr))
		_ = drops
		fmt.Printf("prose path: rows=%d screened_to=%d screen=%v dropped=%v\n", len(pr), kept, screenDropReasons, drops)
		screenDropReasons = nil
		for i, r := range pr {
			if i > 40 {
				break
			}
			fmt.Printf("  PROSE %-55s shares=%v pct=%v class=%q group=%v\n",
				r.HolderName, fmtp(r.Shares), fmtp(r.Percent), r.ShareClass, r.IsGroupRow)
		}
	}
	if !IsHTML(body) {
		textBlockReasons = map[string]int{}
		screenDropReasons = map[string]int{}
		rows, seen, used := ExtractText(body, base)
		kept := len(ScreenRows(rows))
		defer func() { screenDropReasons = nil }()
		fmt.Printf("text path: blocks_seen=%d used=%d rows=%d screened_to=%d reasons=%v screen=%v\n",
			seen, used, len(rows), kept, textBlockReasons, screenDropReasons)
		for i, r := range rows {
			if i > 40 {
				break
			}
			fmt.Printf("  %-55s shares=%v pct=%v mark=%q class=%q kind=%s\n",
				r.HolderName, fmtp(r.Shares), fmtp(r.Percent), r.PctMarker, r.ShareClass, r.TableKind)
		}
		return
	}
	doc, err := html.Parse(strings.NewReader(body))
	must(err)
	items := DocumentItems(doc)
	screenDropReasons = map[string]int{}
	allRows, _, _ := ExtractHTML(body, base)
	kept := len(ScreenRows(allRows))
	fmt.Printf("html path: rows=%d screened_to=%d screen=%v\n", len(allRows), kept, screenDropReasons)
	screenDropReasons = nil
	n := 0
	for _, it := range items {
		if it.Kind == "text" {
			if isHeadingChunk(it.Text) {
				fmt.Printf("[pos %d] HEADING(%s): %s\n", it.Pos, sectionKind(it.Text), trunc(it.Text, 110))
			}
			continue
		}
		c := compactWith(it.Grid, base)
		roleVotes = map[int]string{}
		c.analyze()
		votes := roleVotes
		roleVotes = nil
		why := c.ownershipReject(it.Text)
		okOwn := why == ""
		if !okOwn && !reOwnCue.MatchString(it.Text) {
			continue
		}
		n++
		if n > maxTables {
			break
		}
		if os.Getenv("DEF14A_DEBUG_CUE") != "" {
			fmt.Printf("    CUE=%q TEXT=%q\n", reOwnCue.FindString(it.Text), trunc(flat(it.Text), 600))
		}
		if os.Getenv("DEF14A_DEBUG_ROLES") != "" {
			for j := 0; j < len(c.roles); j++ {
				fmt.Printf("    ROLE%d %-6s %s\n", j, c.roles[j].role, votes[j])
			}
		}
		roles := []string{}
		for _, r := range c.roles {
			roles = append(roles, r.role)
		}
		fmt.Printf("[pos %d] TABLE %dx%d -> compact %d cols, nHeader=%d, ownership=%v(%s) roles=%v\n",
			it.Pos, len(it.Grid.Rows), it.Grid.NCol(), len(c.roles), c.nHeader, okOwn, why, roles)
		for i := 0; i < len(it.Grid.Rows) && i < 8; i++ {
			fmt.Printf("    RAW%d: %q\n", i, it.Grid.Rows[i])
		}
		lim := 6
		if os.Getenv("DEF14A_DEBUG_ALLROWS") != "" {
			lim = len(c.rows)
		}
		for i := 0; i < len(c.rows) && i < lim; i++ {
			fmt.Printf("    row%d: %q\n", i, c.rows[i])
		}
		rows, _ := ExtractGrid(it.Grid, it.Text, base, it.Pos, nil)
		fmt.Printf("    -> %d rows\n", len(rows))
		for i, r := range rows {
			if i > 8 {
				break
			}
			fmt.Printf("       %-45s shares=%v pct=%v mark=%q class=%q\n",
				trunc(r.HolderName, 45), fmtp(r.Shares), fmtp(r.Percent), r.PctMarker, r.ShareClass)
		}
	}
}

func fmtp(f *float64) string {
	if f == nil {
		return "nil"
	}
	return fmt.Sprintf("%.4g", *f)
}

func trunc(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}
