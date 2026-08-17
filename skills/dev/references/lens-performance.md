# Lens: performance

Judges only the runtime cost of the changed code. Not security, not test quality — another lens owns
each of those.

## What counts as a finding

A **measurable** regression **introduced by these changes** on a path that runs often enough to
matter — a request handler, a render path, a loop over user-scaled data, a startup path a user
waits on. A finding names a file and line and states the cost as Big-O over the input that actually
grows, or as concrete latency/memory.

## Finding classes

**Algorithmic complexity**

- a nested scan where a hash/set lookup is available: `for a in A: for b in B if a.id == b.id`, or
  `array.find`/`includes`/`indexOf` inside a loop over a collection of the same order
- repeated linear work inside a loop that is invariant to the loop (recompiled regex, re-parsed
  config, re-sorted list, `len`/`count` over a rebuilt collection)
- accidental quadratic string or array building (`s += x` in a hot loop, `list = list + [x]`,
  `concat` per iteration)
- a data structure mismatched to its access pattern — linear membership tests against an array,
  repeated `shift`/`unshift`, sorting to find a min/max

**Database and remote-call patterns**

- N+1: a query, HTTP call, or RPC issued per row of a result set, including lazy relations touched
  inside a serializer or template loop
- a query filtering, joining, or ordering on an unindexed column, or one whose predicate is
  non-sargable (function applied to the indexed column)
- `SELECT *` or unbounded fetch where the code uses a few columns or a page
- per-item writes where the driver offers a batch/bulk path
- a query inside a transaction held open across network I/O

**Memory and lifetime**

- a listener, subscription, interval, observer, or watcher registered without a paired teardown on
  the unmount/close path
- an unbounded cache, map, or array keyed by something that grows without eviction
- a closure or long-lived object retaining a large buffer, DOM node, or full result set past its use
- a large structure deep-copied per call where a reference or a slice suffices

**Blocking the wrong thread**

- synchronous file, network, or crypto work inside a request handler, event loop tick, render, or UI
  thread (`readFileSync`, blocking `sleep`, sync hashing/compression on a large input)
- an `await` inside a loop over independent operations that could be issued concurrently

**Re-render / recomputation**

- a new object, array, or inline function identity passed as a prop or dependency each render,
  defeating memoization
- an effect whose dependency list makes it run every render
- a derived value recomputed per render over a large collection with no memoization
- state stored at a level that re-renders a large subtree on every keystroke or tick

## Not a finding

- "looks inefficient" with no complexity estimate and no measurement
- a micro-optimization: a constant-factor change on a path that is not hot
- cold code — one-time startup, migrations, build scripts, CLI flag parsing — unless the cost is
  large and user-visible
- a pre-existing cost the changes did not introduce or worsen
- an optimization style preference where the current code's cost is acceptable

If a hunk you must judge is cut off, or the cost depends on data scale the diff does not reveal, say
what you would need to see rather than guessing a verdict in either direction.
