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

**✓ Complete**
- Voice recording (Web Audio API)
- Local storage (IndexedDB)
- Minimal calm UI
- Backend transcription (Whisper)
- Smart extraction (Claude)
- Auto-sync from recording → transcription → review

**TODO**
- Auth + cloud sync (Supabase)
- Search across jobs
- Edit confirmed entries
- Native mobile app (iOS/Android)
- Offline sync with retry queue

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

### 1. Frontend

```bash
cd frontend
npm install
npm run dev
```

✓ UI runs at http://localhost:5173
✓ Recording works (audio stored locally)
✓ Can review & save jobs offline

### 2. Backend (for transcription)

```bash
cd backend
npm install
cp .env.example .env

# Add these API keys to .env:
# OPENAI_API_KEY=sk_...
# ANTHROPIC_API_KEY=sk-ant-...

npm run dev
```

✓ Server runs at http://localhost:3000
✓ Frontend auto-detects it
✓ Recordings auto-transcribe

### Get API keys

- **OpenAI (Whisper)**: https://platform.openai.com/api-keys
- **Anthropic (Claude)**: https://console.anthropic.com

## Development

**Product**
- `/CONTEXT.md` — product definition, philosophy, features
- `/PROTOTYPE.md` — UI design decision & variant analysis

**Frontend** (`/frontend`)
- `/src/HomeScreen.jsx` — main UI
- `/src/services/audioService.js` — Web Audio API
- `/src/services/dbService.js` — IndexedDB persistence
- `/src/services/apiService.js` — backend communication

**Backend** (`/backend`)
- `/src/routes/audio.js` — API endpoints
- `/src/services/transcription.js` — Whisper integration
- `/src/services/summarization.js` — Claude integration
