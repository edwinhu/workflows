package main

// shard.go — the -shard planning mode.
//
// N-PX filing size spans three orders of magnitude: a 2025 Vanguard XML filing
// is 200 MB while a legacy no-activity notice is 4 KB. Splitting a filelist into
// equal-COUNT chunks therefore leaves one grid task grinding for hours while the
// rest idle, so shards are packed on BYTES.

import (
	"bufio"
	"container/heap"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// ShardInput is one line of a sized filelist: a path and its size in bytes.
type ShardInput struct {
	Path string
	Size int64
}

// bin is one shard under construction: its byte load and its members.
type bin struct {
	load  int64
	idx   int
	files []ShardInput
}

// binHeap orders bins by load ascending, so the top is always the emptiest
// shard. Placement is worst-fit-decreasing: an item that does not fit the
// emptiest shard fits nowhere, so the decision to open a new shard is exact
// rather than a heuristic, and load is spread instead of concentrated.
type binHeap []*bin

func (h binHeap) Len() int            { return len(h) }
func (h binHeap) Less(i, j int) bool  { return h[i].load < h[j].load }
func (h binHeap) Swap(i, j int)       { h[i], h[j] = h[j], h[i] }
func (h *binHeap) Push(x interface{}) { *h = append(*h, x.(*bin)) }
func (h *binHeap) Pop() interface{} {
	old := *h
	n := len(old)
	b := old[n-1]
	*h = old[:n-1]
	return b
}

// planShards packs files into size-balanced shards, each targeting targetBytes.
//
// Guarantees the caller and the grid both depend on:
//
//   - every input file lands in exactly one shard (nothing is dropped, nothing
//     is parsed twice into a double-counted panel);
//   - no shard is empty, so an SGE array index never maps to a no-op task;
//   - a shard exceeds targetBytes only by the single file that carried it past,
//     which is unavoidable when one filing is larger than the whole target.
func planShards(files []ShardInput, targetBytes int64) [][]ShardInput {
	if len(files) == 0 {
		return nil
	}
	if targetBytes < 1 {
		targetBytes = 1
	}

	// Largest first: a file bigger than the target must claim a shard before
	// small files have filled every shard's headroom, or the packing degrades.
	ordered := make([]ShardInput, len(files))
	copy(ordered, files)
	sort.SliceStable(ordered, func(i, j int) bool {
		if ordered[i].Size != ordered[j].Size {
			return ordered[i].Size > ordered[j].Size
		}
		return ordered[i].Path < ordered[j].Path
	})

	h := &binHeap{}
	heap.Init(h)
	var bins []*bin

	for _, f := range ordered {
		if h.Len() > 0 {
			b := (*h)[0]
			if b.load+f.Size <= targetBytes {
				b.load += f.Size
				b.files = append(b.files, f)
				heap.Fix(h, 0)
				continue
			}
		}
		b := &bin{load: f.Size, idx: len(bins), files: []ShardInput{f}}
		bins = append(bins, b)
		heap.Push(h, b)
	}

	out := make([][]ShardInput, 0, len(bins))
	for _, b := range bins {
		files := b.files
		sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
		out = append(out, files)
	}
	return out
}

// ---------------------------------------------------------------------------
// -shard mode: filelist in, shard filelists out
// ---------------------------------------------------------------------------

var (
	shardList     string
	shardOutDir   string
	shardTargetMB int
)

func init() {
	flag.StringVar(&shardList, "shard", "",
		"sized filelist (path<TAB>bytes) to split into shard filelists; enables shard mode")
	flag.StringVar(&shardOutDir, "shard-out", "",
		"directory to write shard filelists into (required with -shard)")
	flag.IntVar(&shardTargetMB, "shard-target-mb", 200,
		"target uncompressed input bytes per shard, in megabytes")

	preRunHooks = append(preRunHooks, runShardMode)
}

// runShardMode is the -shard entry point consulted by main() after flag.Parse().
// It returns handled=false when -shard was not given, leaving the parse run
// untouched.
func runShardMode() (bool, int) {
	if shardList == "" {
		return false, 0
	}
	if shardOutDir == "" {
		fmt.Fprintln(os.Stderr, "error: -shard requires -shard-out")
		return true, 2
	}

	files, err := readSizedFilelist(shardList)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error reading %s: %v\n", shardList, err)
		return true, 1
	}
	if len(files) == 0 {
		fmt.Fprintf(os.Stderr, "error: %s holds no usable lines\n", shardList)
		return true, 1
	}

	target := int64(shardTargetMB) << 20
	shards := planShards(files, target)

	if err := writeShards(shardOutDir, shards); err != nil {
		fmt.Fprintf(os.Stderr, "error writing shards: %v\n", err)
		return true, 1
	}

	var minLoad, maxLoad, totalLoad int64
	for i, sh := range shards {
		var load int64
		for _, f := range sh {
			load += f.Size
		}
		if i == 0 || load < minLoad {
			minLoad = load
		}
		if load > maxLoad {
			maxLoad = load
		}
		totalLoad += load
	}
	mean := float64(totalLoad) / float64(len(shards))
	fmt.Printf("shards=%d files=%d bytes_min=%.1fMB max=%.1fMB mean=%.1fMB imbalance=%.1f%%\n",
		len(shards), len(files),
		float64(minLoad)/1e6, float64(maxLoad)/1e6, mean/1e6,
		100*(float64(maxLoad)/mean-1))
	return true, 0
}

// readSizedFilelist reads "path<TAB>bytes" lines. Whitespace separation is
// accepted too, with the size as the trailing field, since `ls -l`-derived and
// `find -printf`-derived lists both show up in practice. A line with no
// parsable size is a hard error: silently treating it as zero bytes would hide
// the one filing large enough to unbalance the grid.
func readSizedFilelist(path string) ([]ShardInput, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	var out []ShardInput
	s := bufio.NewScanner(f)
	s.Buffer(make([]byte, 0, 64*1024), 1<<20)
	lineNo := 0
	for s.Scan() {
		lineNo++
		line := strings.TrimSpace(s.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		var p, sz string
		if i := strings.LastIndex(line, "\t"); i >= 0 {
			p, sz = strings.TrimSpace(line[:i]), strings.TrimSpace(line[i+1:])
		} else if i := strings.LastIndexAny(line, " \t"); i >= 0 {
			p, sz = strings.TrimSpace(line[:i]), strings.TrimSpace(line[i+1:])
		} else {
			return nil, fmt.Errorf("line %d: no size field: %q", lineNo, line)
		}
		n, err := strconv.ParseInt(sz, 10, 64)
		if err != nil {
			return nil, fmt.Errorf("line %d: unparsable size %q", lineNo, sz)
		}
		if p == "" {
			return nil, fmt.Errorf("line %d: empty path", lineNo)
		}
		out = append(out, ShardInput{Path: p, Size: n})
	}
	return out, s.Err()
}

// writeShards emits chunk_NNN.txt per shard plus the two index files the SGE
// array wrapper reads: chunks.txt (one shard id per line, the array index) and
// chunks_meta.tsv (shard id, file count, byte load).
func writeShards(dir string, shards [][]ShardInput) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}

	ids := make([]string, 0, len(shards))
	metaRows := make([]string, 0, len(shards))

	for i, sh := range shards {
		id := fmt.Sprintf("%03d", i)
		var load int64
		var b strings.Builder
		for _, f := range sh {
			b.WriteString(f.Path)
			b.WriteByte('\n')
			load += f.Size
		}
		name := filepath.Join(dir, "chunk_"+id+".txt")
		if err := os.WriteFile(name, []byte(b.String()), 0o644); err != nil {
			return err
		}
		ids = append(ids, id)
		metaRows = append(metaRows, fmt.Sprintf("%s\t%d\t%d", id, len(sh), load))
	}

	if err := os.WriteFile(filepath.Join(dir, "chunks.txt"),
		[]byte(strings.Join(ids, "\n")+"\n"), 0o644); err != nil {
		return err
	}
	meta := "chunk_id\tn_filings\tbytes\n" + strings.Join(metaRows, "\n") + "\n"
	return os.WriteFile(filepath.Join(dir, "chunks_meta.tsv"), []byte(meta), 0o644)
}
