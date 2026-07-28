// scan_covers — targeted EDGAR cover-page extractor.
//
// Reads a list of filing paths, fetches the first N bytes of each, and
// emits one TSV row per file with fields defined by the selected profile.
//
// Companion binary `scan_headers` walks shards and emits role-block CIKs
// from the SGML header. Use scan_headers when you don't have a filelist
// yet (indexing) and scan_covers when you do (extraction).
//
// Usage:
//   scan_covers -profile <name> -files-from list.txt [-root /wrds/sec/archives] \
//               [-concurrency N]
//
// The list file must be one path per line. Paths may be absolute, or
// relative to -root (convenient if the list comes from wrdssec_all.forms
// (or wrds_forms) fname with its "edgar/data/CIK/ACCESSION.txt" structure
// — map to <root>/<CIK6>/<CIK>/<ACCESSION>.txt upstream).
//
// Output columns match the profile's Fields slice, prefixed with the
// filepath column. No header row — consumers pin columns by profile.
package main

import (
	"bufio"
	"bytes"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
)

var (
	reFormType = regexp.MustCompile(`CONFORMED SUBMISSION TYPE:[ \t]+([^\r\n]+)`)
)

func extract(buf []byte, fields []Field) []string {
	out := make([]string, len(fields))
	for i, f := range fields {
		if f.Custom != nil {
			out[i] = f.Custom(buf)
			continue
		}
		matches := f.Pattern.FindAllSubmatch(buf, -1)
		if len(matches) == 0 {
			continue
		}
		apply := func(raw string) string {
			s := cleanField(raw)
			if f.Transform != nil {
				s = f.Transform(s)
			}
			return s
		}
		switch f.Reduce {
		case First:
			for _, m := range matches {
				if s := apply(string(m[1])); s != "" {
					out[i] = s
					break
				}
			}
		case Last:
			for j := len(matches) - 1; j >= 0; j-- {
				if s := apply(string(matches[j][1])); s != "" {
					out[i] = s
					break
				}
			}
		case Max:
			var best float64
			var bestStr string
			var haveBest bool
			for _, m := range matches {
				s := apply(string(m[1]))
				if s == "" {
					continue
				}
				v, err := strconv.ParseFloat(s, 64)
				if err != nil {
					continue
				}
				if !haveBest || v > best {
					best = v
					bestStr = s
					haveBest = true
				}
			}
			out[i] = bestStr
		}
	}
	return out
}

func cleanField(s string) string {
	return strings.TrimSpace(strings.Trim(s, " \t\r\n"))
}

func hasAnyHit(vals []string, fields []Field) bool {
	for i, f := range fields {
		if f.IsHit && i < len(vals) && vals[i] == "1" {
			return true
		}
	}
	return false
}

func formAllowed(form string, allowed []string) bool {
	if len(allowed) == 0 {
		return true
	}
	form = strings.TrimSpace(form)
	for _, a := range allowed {
		if form == a {
			return true
		}
	}
	return false
}

func processFile(path string, prof *Profile) [][]string {
	f, err := os.Open(path)
	if err != nil {
		return nil
	}
	defer f.Close()

	buf := make([]byte, prof.HeadBytes)
	n, _ := io.ReadFull(f, buf)
	if n <= 0 {
		return nil
	}
	buf = buf[:n]

	// Form-type whitelist check happens on the head buffer (cheap regex).
	if len(prof.Forms) > 0 {
		m := reFormType.FindSubmatch(buf)
		if m == nil {
			return nil
		}
		if !formAllowed(string(m[1]), prof.Forms) {
			return nil
		}
	}

	// BackFirst: try the back of the file first (where SAI lives), fall
	// back to reading the gap only if no hit fields fired. See Profile
	// docstring for rationale.
	if prof.BackFirst {
		fi, err := f.Stat()
		if err != nil {
			return nil
		}
		size := fi.Size()
		minSize := prof.BackMinFileSize
		if minSize == 0 {
			minSize = 200 * 1024
		}
		backOff := int64(float64(size) * prof.BackOffset)
		if backOff < int64(prof.HeadBytes) {
			backOff = int64(prof.HeadBytes)
		}
		if size < minSize || backOff >= size {
			// Small file — straight FullBody read.
			rest, _ := io.ReadAll(f)
			buf = append(buf, rest...)
			return expand(prof, buf, extract(buf, prof.Fields))
		}
		// Read the back half.
		if _, err := f.Seek(backOff, 0); err != nil {
			return nil
		}
		back, _ := io.ReadAll(f)
		headLen := len(buf)
		backBuf := make([]byte, 0, headLen+len(back))
		backBuf = append(backBuf, buf...)
		backBuf = append(backBuf, back...)
		result := extract(backBuf, prof.Fields)
		if hasAnyHit(result, prof.Fields) {
			return expand(prof, backBuf, result)
		}
		// Miss — read the gap between head and backOff.
		if _, err := f.Seek(int64(headLen), 0); err != nil {
			return expand(prof, backBuf, result) // best-effort; back-only if seek fails
		}
		gapLen := backOff - int64(headLen)
		gap := make([]byte, gapLen)
		if _, err := io.ReadFull(f, gap); err != nil {
			return expand(prof, backBuf, result)
		}
		full := make([]byte, 0, headLen+int(gapLen)+len(back))
		full = append(full, buf...)
		full = append(full, gap...)
		full = append(full, back...)
		return expand(prof, full, extract(full, prof.Fields))
	}

	// FullBody mode: append the rest of the file. Header pre-filter has
	// already passed, so the additional NFS bandwidth is committed only
	// for forms we actually care about.
	if prof.FullBody {
		rest, err := io.ReadAll(f)
		if err == nil && len(rest) > 0 {
			buf = append(buf, rest...)
		}
		return expand(prof, buf, extract(buf, prof.Fields))
	}

	// Head-only mode: truncate at last newline if buffer filled (avoid
	// partial-line regex false matches on the tail).
	if n == prof.HeadBytes {
		if nl := bytes.LastIndexByte(buf, '\n'); nl >= 0 {
			buf = buf[:nl]
		}
	}

	return expand(prof, buf, extract(buf, prof.Fields))
}

func readFilelist(path string) ([]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	var paths []string
	s := bufio.NewScanner(f)
	s.Buffer(make([]byte, 0, 64*1024), 1<<20)
	for s.Scan() {
		line := strings.TrimSpace(s.Text())
		if line != "" {
			paths = append(paths, line)
		}
	}
	return paths, s.Err()
}

func main() {
	var (
		profileName string
		filesFrom   string
		root        string
		concurrency int
		listProf    bool
	)
	flag.StringVar(&profileName, "profile", "", "profile name (required)")
	flag.StringVar(&filesFrom, "files-from", "", "filelist, one path per line (required)")
	flag.StringVar(&root, "root", "", "prepended to relative paths")
	flag.IntVar(&concurrency, "concurrency", runtime.NumCPU()*4, "worker goroutines")
	flag.BoolVar(&listProf, "list", false, "list registered profiles and exit")
	flag.Parse()

	if listProf {
		names := make([]string, 0, len(registry))
		for n := range registry {
			names = append(names, n)
		}
		sort.Strings(names)
		for _, n := range names {
			p := registry[n]
			cols := []string{"filepath"}
			for _, f := range p.Fields {
				cols = append(cols, f.Name)
			}
			fmt.Printf("%s\t(head=%d, forms=%v)\n\tcolumns: %s\n",
				n, p.HeadBytes, p.Forms, strings.Join(cols, "\t"))
		}
		return
	}

	if profileName == "" || filesFrom == "" {
		fmt.Fprintln(os.Stderr, "error: -profile and -files-from required")
		flag.Usage()
		os.Exit(2)
	}
	prof, ok := registry[profileName]
	if !ok {
		fmt.Fprintf(os.Stderr, "error: unknown profile %q; run -list to see available\n", profileName)
		os.Exit(2)
	}

	paths, err := readFilelist(filesFrom)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading filelist: %v\n", err)
		os.Exit(1)
	}

	jobs := make(chan string, 1024)
	type outRow struct {
		path string
		vals []string
	}
	results := make(chan outRow, 1024)

	var wg sync.WaitGroup
	for i := 0; i < concurrency; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range jobs {
				full := p
				if root != "" && !strings.HasPrefix(p, "/") {
					full = strings.TrimRight(root, "/") + "/" + p
				}
				rows := processFile(full, prof)
				for _, vals := range rows {
					results <- outRow{path: p, vals: vals}
				}
			}
		}()
	}

	var writerWG sync.WaitGroup
	writerWG.Add(1)
	go func() {
		defer writerWG.Done()
		bw := bufio.NewWriterSize(os.Stdout, 1<<20)
		defer bw.Flush()
		for r := range results {
			bw.WriteString(r.path)
			for _, v := range r.vals {
				bw.WriteByte('\t')
				bw.WriteString(v)
			}
			bw.WriteByte('\n')
		}
	}()

	for _, p := range paths {
		jobs <- p
	}
	close(jobs)
	wg.Wait()
	close(results)
	writerWG.Wait()
}
