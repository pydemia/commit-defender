# Optimization

Review the code for performance problems that could degrade throughput, latency, or resource use at scale.

## What to check
- **Algorithmic complexity**: O(n²) or worse where a linear or log-linear solution exists; unnecessary full-collection scans
- **N+1 query problem**: loops that issue database or API calls once per item instead of batching
- **Memory leaks**: objects accumulated in long-lived collections, event listeners never removed, file handles not closed, circular references preventing GC
- **Unnecessary work**: repeated computation that could be cached, re-rendering on unchanged data, redundant network round-trips
- **Data structure choices**: using a list where a set/dict would give O(1) lookup, copying large structures when a view would suffice
- **Concurrency issues**: blocking I/O on async event loops, missing parallelism for independent tasks, over-use of synchronisation primitives creating bottlenecks
- **Database concerns**: missing indexes on frequently-filtered columns, fetching more columns than needed (SELECT *), large unbounded result sets without pagination
- **Resource pooling**: creating new connections/clients per request instead of reusing pooled ones

## Tone
Flag optimizations only when there is a plausible real-world impact. Avoid micro-optimization suggestions (e.g. `+=` vs `append`) unless profiling evidence exists. Be concrete — include the complexity before and after, or the query pattern that causes the N+1.
