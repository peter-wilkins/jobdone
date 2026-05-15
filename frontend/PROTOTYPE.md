# JobDone: Prototype Decision — UI Layout

**Date:** 2026-05-15  
**Question:** What should the mobile-first job log UI look like?  
**Variants tested:** A (minimal), B (card-based), C (two-column)

## Decision: Variant A (Minimal)

**Why:**
- Best for small phone screens (primary use case: sitting in van)
- Calm, uncluttered aesthetic matches product philosophy
- Giant record button is the primary affordance (no friction)
- In-progress and Saved sections are clear mental separation
- Minimal cognitive load after a job

**What was rejected:**
- Variant B (card-based): Too visually dense for phone screens
- Variant C (two-column): Desktop/tablet-oriented, not van-friendly

## Implementation

Variant A code is now in `src/HomeScreen.jsx`. The prototype switcher and other variants have been deleted.

Next steps:
1. Wire up Web Audio API for recording
2. Implement IndexedDB for local storage
3. Build Service Worker for sync queue
4. Connect to backend (transcription + summarization)
