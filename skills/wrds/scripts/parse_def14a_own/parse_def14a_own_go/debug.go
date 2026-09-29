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
	if !IsHTML(body) {
		rows, seen, used := ExtractText(body, base)
		fmt.Printf("text path: blocks_seen=%d used=%d rows=%d\n", seen, used, len(rows))
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
	n := 0
	for _, it := range items {
		if it.Kind == "text" {
			if isHeadingChunk(it.Text) {
				fmt.Printf("[pos %d] HEADING(%s): %s\n", it.Pos, sectionKind(it.Text), trunc(it.Text, 110))
			}
			continue
		}
		c := compactWith(it.Grid, base)
		c.analyze()
		okOwn := c.looksLikeOwnership(it.Text)
		if !okOwn && !reOwnCue.MatchString(it.Text) {
			continue
		}
		n++
		if n > maxTables {
			break
		}
		roles := []string{}
		for _, r := range c.roles {
			roles = append(roles, r.role)
		}
		fmt.Printf("[pos %d] TABLE %dx%d -> compact %d cols, nHeader=%d, ownership=%v roles=%v\n",
			it.Pos, len(it.Grid.Rows), it.Grid.NCol(), len(c.roles), c.nHeader, okOwn, roles)
		for i := 0; i < len(it.Grid.Rows) && i < 8; i++ {
			fmt.Printf("    RAW%d: %q\n", i, it.Grid.Rows[i])
		}
		for i := 0; i < len(c.rows) && i < 6; i++ {
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
