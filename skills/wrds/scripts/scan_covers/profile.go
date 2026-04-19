package main

import "regexp"

// Reduce determines how multiple matches of a field are collapsed to one value.
type Reduce int

const (
	First  Reduce = iota // first match wins
	Max                  // numeric max (parsed as float64)
	Last                 // last match wins
)

// Field is one extraction rule within a profile.
//
// Two modes:
//
//  1. Pattern-based (default): Pattern is run with FindAllSubmatch; each
//     capture goes through Transform (optional) and the results are
//     collapsed via Reduce. Transform returning "" rejects that match.
//
//  2. Custom: when Custom is non-nil, Pattern/Reduce/Transform are ignored
//     and Custom is called with the full head buffer. Use this for
//     multi-pass or window-based extractors (e.g. Python ports that need
//     line-level logic or multi-code pipe-list outputs).
type Field struct {
	Name      string
	Pattern   *regexp.Regexp // must have exactly one capture group
	Reduce    Reduce
	Transform func(string) string
	Custom    func([]byte) string
}

// Profile describes how to extract cover-page fields from one form type.
//
// HeadBytes controls the read window per file. Only that prefix is scanned —
// everything past it is ignored. Bigger windows catch more fields but cost
// more NFS bandwidth; the speedup from concurrent opens shrinks once reads
// dominate.
//
// Forms (optional) acts as a pre-filter: files whose SGML header lists a
// form_type outside this set are skipped without running field regexes.
// Leave empty to accept any form.
type Profile struct {
	Name      string
	HeadBytes int
	Forms     []string
	Fields    []Field // determines output TSV column order
}

// registry holds all compiled profiles; populated via init() calls in
// per-profile source files.
var registry = map[string]*Profile{}

func register(p *Profile) {
	if p.HeadBytes == 0 {
		p.HeadBytes = 32768
	}
	registry[p.Name] = p
}
