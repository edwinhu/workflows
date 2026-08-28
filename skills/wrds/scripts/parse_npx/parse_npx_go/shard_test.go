package main

import (
	"fmt"
	"testing"
)

func TestShardPlanner(t *testing.T) {
	// N-PX filing size spans three orders of magnitude: a handful of very large
	// XML filings alongside thousands of small legacy ones.
	const mb = int64(1) << 20
	var files []ShardInput
	files = append(files,
		ShardInput{Path: "big/a.txt", Size: 200 * mb},
		ShardInput{Path: "big/b.txt", Size: 150 * mb},
		ShardInput{Path: "big/c.txt", Size: 90 * mb},
	)
	for i := 0; i < 500; i++ {
		files = append(files, ShardInput{Path: fmt.Sprintf("small/%03d.txt", i), Size: int64(i%17)*mb/8 + 4096})
	}

	target := 64 * mb
	shards := planShards(files, target)

	if len(shards) == 0 {
		t.Fatalf("planShards returned no shards for %d files", len(files))
	}

	seen := map[string]int{}
	var largest int64
	for _, f := range files {
		if f.Size > largest {
			largest = f.Size
		}
	}

	for i, sh := range shards {
		if len(sh) == 0 {
			t.Errorf("shard %d is empty", i)
			continue
		}
		var total, biggest int64
		for _, f := range sh {
			seen[f.Path]++
			total += f.Size
			if f.Size > biggest {
				biggest = f.Size
			}
		}
		// A shard may only overshoot the target by the one file that carried it
		// past — anything more means the planner is not balancing by size.
		if total > target+biggest {
			t.Errorf("shard %d totals %d bytes, over target %d by more than its largest file %d",
				i, total, target, biggest)
		}
	}

	for _, f := range files {
		switch seen[f.Path] {
		case 1:
		case 0:
			t.Errorf("file %s appears in no shard", f.Path)
		default:
			t.Errorf("file %s appears in %d shards, want exactly 1", f.Path, seen[f.Path])
		}
	}
	if len(seen) != len(files) {
		t.Errorf("shards cover %d distinct paths, want %d", len(seen), len(files))
	}

	t.Run("single oversized file gets its own shard", func(t *testing.T) {
		out := planShards([]ShardInput{{Path: "huge.txt", Size: 900 * mb}}, target)
		if len(out) != 1 || len(out[0]) != 1 || out[0][0].Path != "huge.txt" {
			t.Fatalf("a lone oversized file must still be planned into exactly one shard, got %+v", out)
		}
	})

	t.Run("empty input yields no shards", func(t *testing.T) {
		if out := planShards(nil, target); len(out) != 0 {
			t.Fatalf("planShards(nil) = %+v, want no shards", out)
		}
	})

	t.Run("shard mode is wired into the CLI", func(t *testing.T) {
		if len(preRunHooks) == 0 {
			t.Fatalf("no preRunHooks registered; -shard mode is not reachable from the command line")
		}
	})
}
