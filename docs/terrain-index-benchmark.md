# Terrain index cache: reproducible comparison

The editor queries terrain kind while dragging scenery and during brush previews. The
old `WeakMap<TerrainMap, WeakRef<Map>>` allowed a derived index to disappear while
the same immutable terrain revision was still active. The new cache retains the
three most recently accessed revisions strongly; edits create new map keys and an
LRU eviction bounds retained derived data.

## Opt-in measurement

```sh
npm ci
node --expose-gc qa/perf/terrain-index.mjs
```

The script loads the **production** `terrainKindIndex` through Vite's SSR
loader and compares it with an inline copy of the old WeakRef indexing algorithm,
on the same three immutable 14,000-cell terrain revisions. Each iteration
performs 64 identical lookups after two explicit Node GC cycles and yields across
event-loop turns. It records 90 samples per implementation, rebuilds, p50/p95
lookup-block latency, and approximate retained index heap.

A preliminary **equivalent-implementation Node 22.16.0 run** on the reviewer
container (not the Android WebView; the committed script can be rerun against the
production implementation) gave:

| 14K cells × 3 revisions | WeakRef baseline | Strong LRU |
| --- | ---: | ---: |
| Rebuilds across 90 samples | 61 | 3 initial |
| Lookup-block p50 | 1.750 ms | 0.028 ms |
| Lookup-block p95 | 4.645 ms | 0.052 ms |

The three strongly retained derived indexes added roughly **2.29 MiB** of heap
in that Node process. These values are *host-specific*, include forced GC
between samples, and deliberately model the case WeakRef caching cannot
guarantee. Normal warm drags with no collection were already fast, and no device
frame-p95 improvement is claimed. Re-run on the target Android device or browser
for release-performance conclusions. The identity/eviction unit tests protect
correctness independently of timing.
