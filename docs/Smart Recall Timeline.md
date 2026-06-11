# Smart Recall Timeline

Status: superseded planning note.

This document captured an early product direction where one conversational input
classified NOTE/QUERY/TASK/REMINDER/FOLLOW_UP, generated summaries, embedded
Entries, and used backend semantic/vector recall.

That is no longer the MVP path.

Current direction:

- Capture is text-first plus attachments through the Capture Composer.
- Confirmation creates immutable Entries.
- Recall is local-first and deterministic over confirmed local Entries and
  context clues.
- Backend/vector/AI recall is a later opt-in or experiment, not the default.
- Team work uses Backlog Items, Claims, Approval Requests, and Team Timeline
  Entries rather than generic TASK intent.

Kept because it records original product motivation: rapid operational memory
for tradespeople. Do not use it as current implementation guidance.

Display chronological event history.

Each event should show:

timestamp,
event type,
summary,
photos,
raw note access.
Timeline Rules
Immutable

Original notes never edited.

AI summaries editable separately

Allow future correction of:

labels,
summaries,
extracted metadata.

Without altering source history.

Feature 5 — Voice-First Workflow
Description

Optimise for fast note capture while:

driving,
packing tools,
leaving jobs.

Target interaction time:
< 15 seconds.

Requirements
Fast transcription

Low-friction capture.

Immediate confirmation

After save:
show extracted summary.

Example:

Saved:
- Temporary fix installed
- Customer declined replacement
- Follow-up required

This builds trust.

Non-Goals for MVP

Do NOT build:

full CRM,
invoicing,
scheduling,
project management,
AI dashboards,
autonomous agents,
complex automations.

Focus exclusively on:

memory capture,
recall,
contextual retrieval.
Suggested Technical Architecture
Storage
Raw Event Store

Canonical source of truth.

Stores:

transcript,
timestamp,
media,
metadata.
Derived Data Store

Stores:

embeddings,
summaries,
extracted entities,
tags,
reminders.

Can be regenerated safely.

Retrieval Flow
User query
→ intent classification
→ context extraction
→ semantic retrieval
→ relevance ranking
→ LLM synthesis
→ concise response
Success Criteria

The MVP succeeds if users say:

“I no longer feel like I’m walking into jobs blind.”

Not:

“This is powerful AI.”

The value is confidence restoration, not AI novelty.
