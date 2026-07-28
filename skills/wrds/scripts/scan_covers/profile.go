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
	IsHit     bool // marks a binary flag field used by BackFirst short-circuit
}

// Profile describes how to extract cover-page fields from one form type.
//
// HeadBytes controls the read window per file. Only that prefix is scanned —
// everything past it is ignored. Bigger windows catch more fields but cost
// more NFS bandwidth; the speedup from concurrent opens shrinks once reads
// dominate.
//
// FullBody switches to whole-file mode: the form-type pre-filter still runs
// on the first HeadBytes (cheap), but if the form passes, the entire file is
// read into the buffer passed to Fields. Use this for body-text searches
// (e.g. prospectus 485 filings where target tokens can appear anywhere in
// 1–5 MB of text). When FullBody is true, HeadBytes acts only as the
// pre-filter window — set it just large enough to contain the SGML header
// (8 KB is typical; default 32 KB is fine).
//
// Forms (optional) acts as a pre-filter: files whose SGML header lists a
// form_type outside this set are skipped without running field regexes.
// Leave empty to accept any form.
type Profile struct {
	Name      string
	HeadBytes int
	FullBody  bool
	// BackFirst is a two-stage variant of FullBody. When true, processFile:
	//   1. reads the head buffer (SGML pre-filter + header field extraction),
	//   2. seeks to byte size*BackOffset, reads to EOF (the "back"),
	//   3. runs extractors on head+back; if ANY IsHit field returned "1",
	//      returns that result,
	//   4. else reads the gap (HeadBytes → BackOffset) and re-runs extractors
	//      on the complete buffer.
	// For 485 prospectus filings, advisor names live in the SAI (back of
	// file); this saves ~40% I/O on hit-yielding filings (~35% of corpus)
	// at zero recall cost when SAI disclosure is comprehensive. Files
	// smaller than BackMinFileSize bypass this and use straight FullBody.
	BackFirst       bool
	BackOffset      float64 // 0.40 = start back at 40% of filesize
	BackMinFileSize int64   // files smaller than this skip BackFirst (default 200 KB)
	Forms           []string
	Fields          []Field // determines output TSV column order

	// Expand turns the one extracted row into N rows. OPT-IN: leave it nil and
	// the profile emits exactly one row per file — what every profile did
	// before this existed, and what all of them still do today.
	//
	// WHY IT EXISTS. Fields/Reduce can describe only ONE value per column per
	// file, so a filing naming several entities collapses to whichever one the
	// Reduce picked. For SC 13D/G that is wrong in a way that matters: a joint
	// filing under §13(d)(3) has N filers acting as a group, each with its own
	// Item 12 classification, and Reduce:First keeps only the first. mirror's
	// src/blockholders/parser.py emits one row per (subject, filer) pair for
	// exactly that reason, which is why the Go port did not supersede it.
	//
	// CONTRACT:
	//   - `base` is the row Fields produced. TREAT IT AS READ-ONLY and copy
	//     before mutating — hand the same slice back twice and both "rows"
	//     share one backing array, so the last write wins on every one of them.
	//   - nil or empty return emits nothing; a one-row return is identical to
	//     not setting Expand.
	//   - every returned row must have len(Fields) columns, or the TSV
	//     desynchronises against the header `-list` advertises.
	//   - `buf` is the same buffer Fields saw, so Expand can re-scan for the
	//     per-entity detail the flattened row could not carry.
	Expand func(buf []byte, base []string) [][]string
}

// expand applies the profile's opt-in row multiplier. A nil Expand — the case
// for every profile that has not asked for this — is the identity.
func expand(p *Profile, buf []byte, row []string) [][]string {
	if row == nil {
		return nil
	}
	if p.Expand == nil {
		return [][]string{row}
	}
	return p.Expand(buf, row)
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
