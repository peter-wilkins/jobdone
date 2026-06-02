---
name: ui-ux-review
description: Review product UI/UX across screens, devices, and user flows with practical attention to layout, hierarchy, thumb reach, click count, consistency, and visual polish. Use when the user asks for a UI review, UX review, design QA, multi-device screen check, flow friction audit, or whether controls are obvious and placed well.
---

# UI/UX Review

## Quick Start

Review the working product, not just code. Inspect the relevant screens on mobile and desktop when practical, then report concrete findings ranked by user impact.

## Workflow

1. Define the user job.
   - Who is using this screen?
   - What are they trying to do right now?
   - What is the next most likely action?

2. Walk the flow.
   - Count taps/clicks for the main job.
   - Note any backtracking, hidden actions, or mode confusion.
   - Check whether the next action is where the eye and thumb naturally go.

3. Check multiple viewports.
   - Mobile narrow.
   - Mobile/touch landscape if relevant.
   - Desktop/tablet width.
   - Installed/PWA mode if the issue depends on browser chrome, share target, or install behavior.

4. Inspect visual quality.
   - No overlapping text or controls.
   - No floating controls that collide with page content or look detached.
   - Clear hierarchy: urgent work above slow configuration.
   - Primary actions are obvious; destructive actions are visible but not dominant.
   - Repeated controls are consistent across screens.
   - Empty, loading, error, and stale/offline states are useful but quiet.

5. Check ergonomics.
   - Common mobile actions are reachable by thumb.
   - Buttons have stable tap targets.
   - Dense lists remain scannable.
   - Critical actions do not require tiny precision taps.

6. Produce findings.
   - Lead with bugs and friction, ordered by severity.
   - Include screen/route and viewport.
   - Describe the user consequence and the smallest useful fix.
   - Separate implementation suggestions from product decisions.

## Output Shape

Use this structure:

- Findings
- Flow Friction
- Suggested Fixes
- Checks Run
- Open Product Questions

If the review finds implementation work, create focused issues or implement only the smallest agreed slice.
