# Multi-recording sessions — chronology contract

> Status: implemented contract
> Owner: Processing / session composition
> Issues: #843, #844, #845; consumed by future Session Assembly #848
> Last reviewed: 2026-09-27

This document owns the temporal semantics for composing multiple immutable Craig recordings into one logical session. The workspace may change order, offsets, trims, and relation decisions, but it never rewrites source packages or immutable ASR runs.

## Source time evidence

Craig `start_time` is classified before it can influence placement:

- `trusted_absolute`: an ISO datetime with an explicit timezone/UTC offset. It can derive an automatic offset.
- `ambiguous`: a parseable local date/time or time-of-day without a timezone.
- `opaque`: present but not parseable by the chronology contract.
- `missing`: absent or blank.

Only `trusted_absolute` is authoritative for automatic multi-part placement. Equivalent offset forms normalize to UTC. Explicit DST offsets are respected as written; the contract does not guess a timezone from locale, machine settings, campaign, or filename.

For one recording only, the source can use `single_source_origin` at offset zero even without an absolute clock. For multiple recordings, ambiguous/opaque/missing times require an explicit manual offset.

## Order and manual placement

Workspace `ordinal` is the explicit session order. Trusted clocks may detect an order conflict, but do not silently reorder the workspace.

A persisted `session_offset_seconds` is a manual override. Manual placement wins over automatic timestamp placement for that part and is included in the chronology fingerprint. This lets an operator intentionally keep an order contrary to the source-time suggestion without modifying raw source metadata.

## Trims

`trim_start_seconds` and `trim_end_seconds` are composition-only decisions. They never mutate:

- Craig package metadata;
- raw track timestamps;
- transcript segments;
- immutable run artifacts.

Changing a trim changes the effective interval and chronology fingerprint.

## Gaps

A positive distance between adjacent effective intervals is a `gap`.

The gap is preserved exactly. The system never shifts the later recording to manufacture continuity. Assembly remains blocked until the gap is explicitly confirmed with `gap_confirmed=true`.

## Overlaps

A negative distance between adjacent effective intervals is an `overlap`.

An unresolved overlap blocks `ready_for_assembly`. Accepted explicit policies are:

- `prefer_earlier_until(boundary)`
- `prefer_later_from(boundary)`

The boundary must fall inside the observed overlap before the relation is considered resolved.

The versioned segment ownership rule is `segment_start_owner_v1`: a segment belongs to the earlier side when its global start is strictly before the boundary; a segment starting exactly at the boundary belongs to the later side. A segment crossing the boundary is not split implicitly.

There is no fuzzy transcript matching, waveform guess, semantic deduplication, automatic speech deletion, or quality-based winner in this contract.

## Relation invalidation

Gap/overlap decisions are adjacency-specific.

- Reordering parts clears persisted gap/overlap confirmations.
- Detaching a part clears relation decisions for the remaining adjacency graph.
- Changing a part's offset or trim invalidates unchanged relation evidence for that part and for the following adjacency.
- A relation decision deliberately changed in the same mutation counts as an explicit reconfirmation.

This prevents an old decision from silently applying to a different pair after chronology geometry changes.

## Deterministic chronology identity

`tda_recording_chronology_v1.sha256` is SHA-256 over canonical JSON containing the versioned chronology policy, ordered part/source identity, manual offsets, trims, confirmations/resolutions, source start evidence, and local source duration.

Runtime fields such as workspace `created_at` and `updated_at` are excluded. The same source facts + workspace configuration reproduce the same fingerprint; changing order, offset, trim, gap confirmation, or overlap resolution changes it.

Session Assembly (#848) must carry this fingerprint in its immutable provenance and must not assemble while `ready_for_assembly=false`.

## Readiness and failure modes

`ready_for_assembly=true` requires all placement/duration dependencies to be resolved and every gap/overlap relation explicitly accepted under this contract.

Missing/corrupt local sources remain visible as source failures and block chronology readiness. Ambiguous, opaque, or missing multi-part clocks never gain silent offsets.

Optimistic workspace revision remains authoritative for mutations, so stale timing/reorder writes fail closed with the existing session-workspace revision conflict.

## Acceptance matrix

Synthetic coverage owns at least:

- contiguous recordings;
- 1 ms and large gaps;
- 1 ms, 30 s and multi-minute overlaps;
- same absolute start timestamp;
- equivalent explicit timezone representations;
- ambiguous/no-timezone, opaque and missing clocks;
- explicit DST offsets;
- manual order contrary to trusted-clock order;
- exact and crossing segment boundaries;
- restart persistence around chronology decisions;
- three-part sessions containing both a gap and an overlap;
- invalidation of stale relation decisions after reorder, detach, offset, or trim changes.
