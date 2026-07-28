package main

import (
	"regexp"
	"strings"
)

// Multi-filer expansion for blockholders_13dg.
//
// Fields/Reduce can carry one value per column per file, so a joint SC 13D/G
// collapsed to whichever filer `Reduce:First` happened to pick. That is wrong
// precisely where blockholder work is most interesting: a group filing under
// §13(d)(3) has N filers acting together, each with its OWN Item 12
// classification. mirror's src/blockholders/parser.py emits one row per
// (subject, filer) pair for that reason.
//
// This closes the gap without changing what any other profile does — Expand is
// opt-in and only this profile sets it.
//
// NO-OP ON THE COMMON CASE, BY CONSTRUCTION. Most 13D/Gs name exactly one
// filer and one subject; for those this returns `base` untouched, so output is
// byte-identical to before the hook existed. Only genuinely joint filings
// produce extra rows.

var (
	// Every column-0 SGML role label. Blocks are sliced BETWEEN these positions
	// rather than matched with a terminator pattern.
	//
	// A `FILED BY:(.*?)(?:\n[A-Z...]:\s*\n|\z)` block regex looks right and is
	// wrong: FindAll resumes at the END of each match, and the match CONSUMES
	// the next label as its terminator — so on three consecutive FILED BY
	// blocks it returns the 1st and the 3rd and silently drops the 2nd. Go's
	// RE2 has no lookahead to hold the delimiter back, so don't try; find the
	// label offsets and slice.
	reRoleLabel = regexp.MustCompile(`(?m)^[A-Z][A-Z0-9 /-]*:`)
	reBlockCIK  = regexp.MustCompile(`CENTRAL INDEX KEY:[ \t]+([0-9]+)`)
	reBlockName = regexp.MustCompile(`COMPANY CONFORMED NAME:[ \t]+([^\r\n]+)`)
)

type entity struct{ cik, name string }

// entitiesOf pulls every (cik, name) under the given column-0 role label.
func entitiesOf(buf []byte, label string) []entity {
	locs := reRoleLabel.FindAllIndex(buf, -1)
	var out []entity
	seen := map[string]bool{}
	for i, loc := range locs {
		if string(buf[loc[0]:loc[1]]) != label {
			continue
		}
		end := len(buf)
		if i+1 < len(locs) {
			end = locs[i+1][0]
		}
		body := buf[loc[1]:end]

		c := reBlockCIK.FindSubmatch(body)
		if c == nil {
			continue
		}
		cik := string(c[1])
		if seen[cik] {
			// A filing can name the same CIK twice (a filer that is also the
			// subject, or a repeated block). Dedupe, or the cartesian product
			// below squares it.
			continue
		}
		seen[cik] = true
		name := ""
		if nm := reBlockName.FindSubmatch(body); nm != nil {
			name = strings.TrimSpace(string(nm[1]))
		}
		out = append(out, entity{cik: cik, name: name})
	}
	return out
}

// Column positions in the blockholders_13dg Fields slice. `base` excludes the
// leading filepath, which main writes separately.
const (
	bhFilCIK  = 3
	bhFilName = 4
	bhSbjCIK  = 5
	bhSbjName = 6
	bhItem12  = 7
)

func expandBlockholders(buf []byte, base []string) [][]string {
	filers := entitiesOf(buf, "FILED BY:")
	subjects := entitiesOf(buf, "SUBJECT COMPANY:")

	// Single filer AND single subject (or nothing parsed) — the overwhelming
	// majority. Return base untouched so output is exactly what it was.
	if len(filers) <= 1 && len(subjects) <= 1 {
		return [][]string{base}
	}
	if len(filers) == 0 {
		filers = []entity{{cik: base[bhFilCIK], name: base[bhFilName]}}
	}
	if len(subjects) == 0 {
		subjects = []entity{{cik: base[bhSbjCIK], name: base[bhSbjName]}}
	}

	// Item 12 read once from the body; the only per-filer part is the Fidelity
	// override, which keys on the filer's own CIK. Matches parser.py, where
	// parse_item12(body, fil_cik=...) differs across filers in exactly that way.
	bodyItem12 := base[bhItem12]

	rows := make([][]string, 0, len(filers)*len(subjects))
	for _, f := range filers {
		item12 := bodyItem12
		if f.cik == "315066" { // Fidelity — filings are formatted differently
			item12 = "hc|in"
		}
		for _, s := range subjects {
			// COPY. Handing the same backing array to several rows would let
			// the last write win on all of them.
			r := make([]string, len(base))
			copy(r, base)
			r[bhFilCIK], r[bhFilName] = f.cik, f.name
			r[bhSbjCIK], r[bhSbjName] = s.cik, s.name
			r[bhItem12] = item12
			rows = append(rows, r)
		}
	}
	return rows
}
