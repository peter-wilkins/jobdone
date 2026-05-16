Smart Recall Timeline (MVP)
Goal

Help self-employed tradespeople rapidly recall previous job context at the exact moment they need it, without requiring manual organisation or admin-heavy workflows.

The product should feel like:

a conversational memory system,
not job management software.

Primary use cases:

before arriving at a property,
during incoming customer calls,
before follow-up work,
during disputes or clarification,
while quoting similar work.
Core UX Principles
1. Single conversational input

Users should not choose between:

“take note”,
“search history”,
“create task”,
etc.

All interactions happen through one input:

voice,
text,
photos.

The system infers intent automatically.

2. Immutable timeline

Every user submission becomes a timestamped event.

Raw history is never rewritten or overwritten.

AI-generated summaries are derived data only.

This preserves:

chronology,
trust,
legal defensibility.
3. Minimal cognitive load

The interface should:

avoid dashboards,
avoid forms,
avoid folders/tags/projects,
avoid setup friction.

The system extracts structure automatically.

MVP Feature Set
Feature 1 — Conversational Capture
Description

Allow users to quickly record job notes using:

voice,
text,
photos.
Example Inputs

“Temporary fix on upstairs radiator leak. Customer declined repipe.”

“Need 15mm elbows next visit.”

“What boiler did I fit here?”

Behaviour
Step 1 — Store Raw Event

Save:

raw transcript/text,
timestamp,
attachments,
customer/job association.
Step 2 — Intent Detection

Classify message into one primary intent:

Possible intents:

NOTE
QUERY
TASK
REMINDER
FOLLOW_UP

Simple classifier acceptable for MVP.

Can be:

lightweight LLM call,
heuristics,
keyword-based fallback.
Step 3 — AI Extraction

For NOTE-like messages:
extract structured metadata.

Suggested extraction fields:

customer decisions,
temporary fixes,
appliance models,
parts/materials,
recommendations,
risks/issues,
follow-up requirements.
Step 4 — Generate Searchable Summary

Create concise summary.

Example:

Temporary radiator leak repair completed.
Customer declined full repipe.
Follow-up likely required.

Store:

summary,
embeddings,
extracted entities.
Feature 2 — Smart Recall
Description

Users can ask natural-language questions about previous work.

Example Queries

“What did I do at Mrs Jones’ house?”

“Did I already replace that pump?”

“Show temporary fixes from this month.”

Behaviour
Retrieval Pipeline
Step 1 — Context Detection

Extract:

customer,
property,
appliance,
timeframe,
issue.
Step 2 — Retrieve Relevant Events

Use:

semantic/vector search,
recency weighting,
customer/property filtering,
entity matching.
Step 3 — AI Synthesis

Generate concise recall-focused response.

Requirements:

prioritise certainty,
cite timeline events,
clearly indicate uncertainty.

Example:

High confidence:
On Feb 12 you replaced the diverter valve.
A photo of the removed part was attached.
Feature 3 — Contextual Recall Surface
Description

Automatically surface relevant context at high-value moments.

Do NOT create aggressive proactive AI behaviour.

Only surface concise high-relevance reminders.

Trigger Events
Incoming customer call

Surface:

recent visits,
unresolved issues,
temporary fixes,
outstanding recommendations.
Opening customer/job thread

Surface:

latest summary,
unresolved follow-ups,
promised actions.
Arriving at property (future enhancement)

Potential geolocation trigger.

Important UX Rule

Maximum:

1 summary,
3 key reminders.

Avoid information overload.

Feature 4 — Timeline UI
Description

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