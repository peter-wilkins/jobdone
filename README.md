# JobDone

A mobile-first voice job log for self-employed plumbers. Record what you did after each job, get it transcribed and summarized automatically. Mental closure before you drive off.

## What it does

- **Voice-first capture**: Giant record button, no forms
- **Automatic transcription**: Powered by Whisper
- **Smart extraction**: Materials, labour time, follow-ups, future work — all extracted by Claude
- **Lightweight**: Calm, dependable, no AI hype
- **Offline-capable**: Record even without signal, sync when online
- **Local-first**: Your data stays on your device, optional cloud backup

## Status

Early MVP. Core frontend done (recording + local storage). Backend (transcription + summarization) in progress.

## Tech Stack

**Frontend**
- React + Vite
- Tailwind CSS
- IndexedDB (local persistence)
- Web Audio API (recording)

**Backend** (TBD)
- Fastify
- Whisper (transcription)
- Claude (summarization + extraction)
- Supabase (auth + Postgres)

## Getting started

```bash
cd frontend
npm install
npm run dev
```

Server runs at http://localhost:5173

## Development

- `/CONTEXT.md` — product definition and philosophy
- `/frontend/src/` — React app
- `/frontend/src/services/` — audio recording and local DB
- Prototype decisions documented in `/frontend/PROTOTYPE.md`
