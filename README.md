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

**Backend**
- Fastify (server)
- OpenAI Whisper (transcription)
- Claude (summarization + extraction)
- Multipart form handling for audio uploads

## Getting started

### Frontend (React app)

```bash
cd frontend
npm install
npm run dev
```

UI runs at http://localhost:5173

### Backend (Audio processing)

```bash
cd backend
npm install
cp .env.example .env  # Add your API keys
npm run dev
```

Server runs at http://localhost:3000

**Required API keys:**
- `OPENAI_API_KEY` — Whisper transcription
- `ANTHROPIC_API_KEY` — Claude summarization

## Development

- `/CONTEXT.md` — product definition and philosophy
- `/frontend/src/` — React app
- `/frontend/src/services/` — audio recording and local DB
- Prototype decisions documented in `/frontend/PROTOTYPE.md`
