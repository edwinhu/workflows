package main

// Joining each person in the management table to the bio the same section
// carries for them.
//
// The split is keyed on the TABLE'S OWN NAME LIST, never on a lead-in pattern.
// Two incompatible conventions coexist — "<Name> has served as ..." before about
// 2010 and "<Name>. Mr. <Surname> ..." after about 2015 — and a splitter keyed on
// either one drops or truncates every bio written in the other (design profile,
// R6). Names also break mid-word across HTML block boundaries ("Nikki
// Krishnamurth" / "y", "Tony Wes" / "t"), so every comparison runs on a key with
// the punctuation and whitespace removed.

import (
	"regexp"
	"strings"
)

var reNonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// nameKey folds a name or a block of prose to the form the matcher compares on.
func nameKey(s string) string {
	return reNonAlnum.ReplaceAllString(strings.ToLower(charFix.Replace(s)), "")
}

// reBioLeadIn matches the post-2015 convention's opening: one to four
// capitalised name tokens, a full stop, then a third-person honorific. It is the
// fallback for a bio whose lead-in spells the name differently from the table —
// Uber's table says "David Trujillo" and his bio opens "David I. Trujillo. Mr.
// Trujillo is a Partner of TPG" — where the surname is the only common ground.
//
// The token shape is what keeps it narrow. A bio CONTINUATION block routinely
// contains ". Mr. Surname", so a loose "anything up to a full stop" lead would
// reassign the second half of one person's bio to another person.
var reBioLeadIn = regexp.MustCompile(
	`^((?:[A-Z][A-Za-z.'\x{2019}-]*\s*){1,4})\.\s+(?:Mr|Ms|Mrs|Dr|Prof|His|Her)\b`)

// attachBios assigns each prose block to a person and writes the joined text
// back into persons. blocks must already be in document order and confined to
// the MANAGEMENT section.
func attachBios(persons []Person, blocks []string) {
	if len(persons) == 0 {
		return
	}
	keys := make([]string, len(persons))
	surnames := make([]string, len(persons))
	for i, p := range persons {
		keys[i] = nameKey(p.Name)
		if f := strings.Fields(p.Name); len(f) > 0 {
			surnames[i] = nameKey(f[len(f)-1])
		}
	}
	parts := make([][]string, len(persons))
	current := -1

	// A name split across two blocks is rejoined before matching: the first
	// block is a strict prefix of some person's key and carries nothing else.
	joined := make([]string, 0, len(blocks))
	for i := 0; i < len(blocks); i++ {
		b := strings.TrimSpace(blocks[i])
		if b == "" {
			continue
		}
		if i+1 < len(blocks) && isPartialName(nameKey(b), keys) {
			b = strings.TrimSpace(b + " " + strings.TrimSpace(blocks[i+1]))
			i++
		}
		joined = append(joined, b)
	}

	for _, b := range joined {
		if who := matchPerson(b, keys, surnames, parts); who >= 0 {
			current = who
			parts[who] = append(parts[who], b)
			continue
		}
		// A heading is not prose. Once every person has a bio the next heading
		// is where the bios stop and the section's sub-parts begin.
		if headingShaped(b) {
			if allHaveBio(parts) {
				break
			}
			continue
		}
		if current >= 0 {
			parts[current] = append(parts[current], b)
		}
	}

	for i := range persons {
		persons[i].Bio = norm(strings.Join(parts[i], " "))
	}
}

// isPartialName reports whether a block is only the front of somebody's name,
// which means the filing broke the name across two HTML blocks.
func isPartialName(key string, keys []string) bool {
	if key == "" || len(key) > 24 {
		return false
	}
	for _, k := range keys {
		if len(key) < len(k) && strings.HasPrefix(k, key) {
			return true
		}
	}
	return false
}

// matchPerson reports which person a block opens the bio of, or -1.
func matchPerson(block string, keys, surnames []string, parts [][]string) int {
	key := nameKey(block)
	best := -1
	for i, k := range keys {
		if k == "" || len(parts[i]) > 0 || !strings.HasPrefix(key, k) {
			continue
		}
		if best < 0 || len(k) > len(keys[best]) {
			best = i
		}
	}
	if best >= 0 {
		return best
	}
	m := reBioLeadIn.FindStringSubmatch(block)
	if m == nil {
		return -1
	}
	lead := nameKey(m[1])
	for i, sn := range surnames {
		if sn == "" || len(parts[i]) > 0 || !strings.HasSuffix(lead, sn) {
			continue
		}
		if best < 0 || len(sn) > len(surnames[best]) {
			best = i
		}
	}
	return best
}

func allHaveBio(parts [][]string) bool {
	for _, p := range parts {
		if len(p) == 0 {
			return false
		}
	}
	return true
}
