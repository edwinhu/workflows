package main

import (
	"fmt"
	"regexp"
	"strings"
)

// Bylaw quorum-threshold extraction from DEF 14A proxy statements.
//
// WHY THIS EXISTS. ISS Voting Analytics carries the PASS-vote mechanics (`base`,
// `voterequirement`) but not the QUORUM threshold, and no WRDS table has a
// quorum column at all — `iss_va_shareholder.chars`, `risk.chars` and
// `risk.chars_us` all return zero rows for `%quorum%`. The only source is the
// proxy text itself.
//
// PORTED, NOT REWRITTEN, from mirror `scripts/bylaw_quorum/parse_quorum_go/`,
// which is where the 96.6% explicit-parse-coverage figure was measured. It
// arrives here as a scan_covers profile rather than a fourth standalone binary
// because this skill's own Red Flags section says so: "Create a new standalone
// Go binary for EDGAR extraction -> STOP. scan_covers is a generic
// profile-based framework. Add a profiles_*.go file, not a new binary."
//
// The behaviour is deliberately unchanged from the standalone. If you tune a
// pattern here, mirror's copy and the published coverage number are both stale.

var (
	// <[^>]+> would span newlines when brackets are unbalanced (e.g. math
	// comparisons like "<=-500 bps" and "> 500 bps" on separate lines), eating
	// huge text spans. Restricting to a single line leaves unbalanced brackets
	// as literal text, which the proximity checks tolerate fine.
	reQTag        = regexp.MustCompile(`<[^>\n]+>`)
	reQEntity     = regexp.MustCompile(`&(?:nbsp|amp|lt|gt|quot|#\d+);`)
	reQWhitespace = regexp.MustCompile(`\s+`)
	reQuorumWord  = regexp.MustCompile(`(?i)quorum`)

	// Threshold patterns, ordered by specificity. Per DGCL §216 the only legal
	// quorum values for public-company bylaws are in [0.333, 0.50] — one-third
	// statutory floor, majority default. Higher values are recognised in order
	// to FLAG oddities, not to accept them silently.
	quorumThresholds = []struct {
		rx    *regexp.Regexp
		value float64
		conf  string
		label string
	}{
		{regexp.MustCompile(`(?i)\b(?:one[-\s]third|1/3|33[-\s]*1/3[-\s]*%|33\.?3[3]?\s*%|33\s*(?:%|percent)|thirty[-\s]three\s+(?:percent|and\s+(?:one[-\s]third|a\s+third)))`),
			0.3333, "high", "one-third"},
		{regexp.MustCompile(`(?i)\b(?:two[-\s]fifths|40\s*%|forty\s+percent)`),
			0.40, "high", "two-fifths"},
		{regexp.MustCompile(`(?i)\b(?:45\s*%|forty[-\s]five\s+percent)`),
			0.45, "high", "45-percent"},
		// Non-Delaware: Canadian CBCA and some state defaults.
		{regexp.MustCompile(`(?i)\b(?:one[-\s]quarter|1/4|25\s*%|twenty[-\s]five\s+percent)`),
			0.25, "high", "one-quarter"},
		// DGCL default. "med" not "high" — boilerplate majority is the most
		// easily confused with the PASS rule.
		{regexp.MustCompile(`(?i)\b(?:a\s+(?:simple\s+)?majority|(?:simple\s+)?majority\s+of\s+the|one[-\s]half|1/2|50\s*%|fifty\s+percent)`),
			0.50, "med", "majority"},
	}

	// Tier-1 anchor. The text must reference shares OUTSTANDING (or equivalently
	// voting power / entitled to vote) — this is what discriminates the QUORUM
	// rule from the PASS rule ("majority of votes cast", "majority of shares
	// present and voting"). Loose on purpose, because proxy templates vary:
	// "a majority of the outstanding shares", "...of the shares outstanding",
	// "...of the shares of common stock outstanding", "...of the voting power".
	// False positives from unrelated uses ("outstanding performance") are killed
	// downstream by the 150-char proximity check plus the quorum-context bound.
	reQOutstanding = regexp.MustCompile(`(?i)\b(?:outstanding|entitled\s+to\s+(?:vote|cast|be\s+cast)|voting\s+power|issued\s+and\s+outstanding|possible\s+votes|votes\s+that\s+(?:may|can)\s+be\s+cast|votes\s+(?:that\s+)?may\s+be\s+cast|total\s+(?:number\s+of\s+)?votes|number\s+of\s+votes\s+entitled)\b`)

	// Tier-2 anchor. Canonical quorum verbs, for thresholds stated without an
	// explicit "outstanding" qualifier ("a majority of common stock will
	// constitute a quorum"). Capped at "med" confidence, because the missing
	// outstanding signal is exactly the ambiguity tier-1 resolves.
	reQVerb = regexp.MustCompile(`(?i)\b(?:constitute[s]?\s+a\s+quorum|will\s+be\s+a\s+quorum|necessary\s+(?:for|to\s+(?:constitute|have))\s+a\s+quorum|quorum\s+(?:will\s+exist|is\s+met|exists|consisting\s+of|consists\s+of|requires|at\s+(?:all\s+)?meetings)|have\s+a\s+quorum|for\s+there\s+to\s+be\s+a\s+quorum|is\s+required\s+for\s+a\s+quorum)\b`)

	// Pass-rule phrases. If one appears inside the threshold+anchor clause, the
	// match is pass-rule context and is discarded. `plurality` is here because
	// it is a DIRECTOR-vote rule, never a meeting quorum.
	reQReject = regexp.MustCompile(`(?i)\b(?:plurality|vote[s]?\s+(?:cast|properly\s+cast)|shares\s+present\s+and\s+voting|present\s+in\s+person\s+or\s+by\s+proxy\s+and\s+entitled\s+to\s+vote\s+on\s+the\s+matter)`)
)

func quorumStripHTML(s string) string {
	s = reQTag.ReplaceAllString(s, " ")
	s = reQEntity.ReplaceAllString(s, " ")
	s = reQWhitespace.ReplaceAllString(s, " ")
	return s
}

func quorumAbs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}

// extractQuorum returns "threshold|confidence|match_text".
//
// THREE VALUES IN ONE FIELD, deliberately. The Field.Custom contract returns a
// single string, and this is one expensive extraction (a full-body proximity
// scan) that yields three correlated outputs — registering three Custom fields
// would run it three times. profiles/quorum/build_panel.py splits on the first
// two pipes; the snippet is pipe-sanitised so the split is unambiguous.
//
// Confidence ladder, most to least trustworthy:
//
//	high              explicit fraction/percent, anchored to an "outstanding" qualifier
//	med               boilerplate majority, or a high pattern reached only via tier-2
//	default           filing mentions quorum but no threshold parsed -> DGCL §216 0.50
//	default-noquorum  filing contains NO quorum text at all -> DGCL §216 0.50
//	low               nothing usable
//
// The two `default*` tiers return the same 0.50 and are kept separate on
// purpose: "we read it and could not find a threshold" and "there was nothing
// to read" are different claims, and collapsing them would hide which.
func extractQuorum(buf []byte) string {
	text := quorumStripHTML(string(buf))

	hits := reQuorumWord.FindAllStringIndex(text, -1)
	if len(hits) == 0 {
		// Likely a supplemental / notice-only DEF 14A that references an earlier
		// filing. DGCL §216 majority is the legal baseline absent an explicit bylaw.
		return quorumOut(0.50, "default-noquorum",
			"(default: filing contains no quorum text; DGCL 216 majority applied)")
	}

	// Scan 250 chars BOTH SIDES of each "quorum" hit — proxies phrase it either
	// direction:
	//   forward:  "quorum. This means a majority of outstanding shares..."
	//   backward: "a majority of outstanding shares must be present ... to have a quorum"
	// The threshold and its anchor must co-occur within 150 chars (same
	// sentence); the closest pairing across all hits wins.
	bestVal, bestConf, bestMatch := 0.0, "", ""
	bestDist := 1 << 30
	found := false

	for _, h := range hits {
		lo, hi := h[0]-250, h[1]+250
		if lo < 0 {
			lo = 0
		}
		if hi > len(text) {
			hi = len(text)
		}
		ctx := text[lo:hi]
		quorumLocal := h[0] - lo

		outAll := reQOutstanding.FindAllStringIndex(ctx, -1)
		verbAll := reQVerb.FindAllStringIndex(ctx, -1)
		if len(outAll) == 0 && len(verbAll) == 0 {
			continue
		}

		for _, p := range quorumThresholds {
			// ALL occurrences, not the first. A proxy typically carries several
			// "majority"s — "majority of votes cast" (pass rule, rejected) and
			// "majority of outstanding shares" (quorum rule, accepted) — and
			// stopping at the first misses the real definition whenever the pass
			// rule is stated earlier.
			for _, m := range p.rx.FindAllStringIndex(ctx, -1) {
				var anchor []int
				anchorDist := 1 << 30
				for _, o := range outAll {
					if d := quorumAbs(m[0] - o[0]); d < anchorDist {
						anchorDist, anchor = d, o
					}
				}
				conf := p.conf
				if anchor == nil || anchorDist > 150 {
					// Tier-2 fallback, tighter window.
					anchor, anchorDist = nil, 1<<30
					for _, v := range verbAll {
						if d := quorumAbs(m[0] - v[0]); d < anchorDist {
							anchorDist, anchor = d, v
						}
					}
					if anchor == nil || anchorDist > 100 {
						continue
					}
					if conf == "high" {
						conf = "med"
					}
				}

				clauseLo := m[0]
				if anchor[0] < clauseLo {
					clauseLo = anchor[0]
				}
				clauseHi := m[1]
				if anchor[1] > clauseHi {
					clauseHi = anchor[1]
				}
				if clauseHi+40 < len(ctx) {
					clauseHi += 40
				} else {
					clauseHi = len(ctx)
				}
				if reQReject.MatchString(ctx[clauseLo:clauseHi]) {
					continue
				}

				dist := quorumAbs(m[0] - quorumLocal)
				if !found || dist < bestDist || (dist == bestDist && conf == "high" && bestConf != "high") {
					sLo := clauseLo - 60
					if sLo < 0 {
						sLo = 0
					}
					sHi := clauseHi + 100
					if sHi > len(ctx) {
						sHi = len(ctx)
					}
					snippet := strings.TrimSpace(ctx[sLo:sHi])
					if len(snippet) > 300 {
						snippet = snippet[:300]
					}
					bestVal, bestConf, bestMatch = p.value, conf, snippet
					bestDist = dist
					found = true
				}
			}
		}
	}

	if found {
		return quorumOut(bestVal, bestConf, bestMatch)
	}
	// Mentions quorum but no threshold was extractable. Labelled `default` so
	// downstream can see the value is inferred rather than read.
	return quorumOut(0.50, "default",
		"(default: DGCL 216 / most state-law default - filing mentions quorum but no explicit threshold found)")
}

// quorumOut joins the triple, stripping pipes and tabs from the snippet so the
// field survives both the TSV writer and the downstream split.
func quorumOut(v float64, conf, match string) string {
	match = strings.NewReplacer("|", "/", "\t", " ", "\r", " ", "\n", " ").Replace(match)
	return fmt.Sprintf("%.4f|%s|%s", v, conf, match)
}
