package main

import (
	"os"
	"strings"
	"testing"
)

// Diagnostic harness for def14a_independence. Points at a local fixture tree via
// INDEP_FIXTURES and prints why a sentence was or was not accepted.
func TestIndepDebug(t *testing.T) {
	root := os.Getenv("INDEP_FIXTURES")
	path := os.Getenv("INDEP_FILE")
	needle := os.Getenv("INDEP_NEEDLE")
	if root == "" || path == "" {
		t.Skip("set INDEP_FIXTURES and INDEP_FILE")
	}
	b, err := os.ReadFile(root + "/" + path)
	if err != nil {
		t.Fatal(err)
	}
	text := indepNormalize(b)
	for _, s := range splitSentences(text) {
		if needle != "" && !strings.Contains(s, needle) {
			continue
		}
		orig := s
		if len(s) > 4000 {
			s = s[:4000]
		}
		r := classifySentence(s)
		t.Logf("len=%d form=%s names=%v\n  indep=%v dirs=%v det=%v are=%v cmte=%v neg=%v pred=%v\n  SENT: %.400s",
			len(orig), r.form, r.names,
			reIndepWord.MatchString(s), reAboutDirectors.MatchString(s),
			reDetVerb.MatchString(s), reAreCue.MatchString(s),
			reCommitteeScope.MatchString(s), reNegDet.MatchString(s),
			rePredIndep.MatchString(s), s)
	}
}
