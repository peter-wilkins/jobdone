# JobDone Backend

Audio transcription and summarization service for JobDone.

## What it does

- **Transcription**: Converts audio to text using Deepgram (nova-3)
- **Summarization**: Creates clean summaries using Claude

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Set environment variables

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

**Option A: With real APIs (recommended for production)**
- `DEEPGRAM_API_KEY` — Get from https://console.deepgram.com/
- `ANTHROPIC_API_KEY` — Get from https://console.anthropic.com
- `SUPABASE_URL` and `SUPABASE_KEY` (optional, for cloud sync)

**Option B: Mock mode (for testing/demoing)**
```bash
echo "USE_MOCK_APIS=true" >> .env
```
This skips real API calls and returns hardcoded plumber job examples. Useful for:
- Testing without API credits
- Developing offline
- Demoing to users
- CI/CD pipelines

### 3. Run server

**Development (with auto-reload):**
```bash
npm run dev
```

**Production:**
```bash
npm start
```

Server runs at http://localhost:3000

## Deploy to Vercel

The backend is configured for Vercel serverless deployment from `backend/`.

### 1. Create a Vercel project

Create/import a Vercel project with `backend` as the root directory. Connect the Vercel project to this GitHub repo if you want Vercel to deploy automatically on push.

### 2. Link local project

Run this once locally from `backend/`:

```bash
vercel link
```

Do not commit `.vercel/project.json`.

### 3. Add Vercel environment variables

Add production env vars in Vercel project settings:

```text
DEEPGRAM_API_KEY
ANTHROPIC_API_KEY
VOYAGE_API_KEY
SUPABASE_URL
SUPABASE_KEY
NODE_ENV=production
USE_MOCK_APIS=false
```

### 4. Deploy

Deploy from Vercel's Git integration, or run this from `backend/`:

```bash
vercel deploy --prod
```

## API Endpoints

### GET /health
Health check endpoint.

```bash
curl http://localhost:3000/health
```

### POST /api/transcribe
Upload audio and get transcription + summary.

```bash
curl -X POST http://localhost:3000/api/transcribe \
  -F "audio=@recording.webm"
```

**Response:**
```json
{
  "transcript": "Fixed the kitchen tap...",
  "intent": "NOTE",
  "summary": "Replaced tap valve at Henderson's."
}
```

### POST /api/summarize
Summarize an existing transcript.

```bash
curl -X POST http://localhost:3000/api/summarize \
  -H "Content-Type: application/json" \
  -d '{"transcript": "Fixed the kitchen tap..."}'
```

## Architecture

```
src/
├─ index.js                 Main server
├─ routes/
│  └─ audio.js             API route handlers
│  └─ queries.js           Query persistence
│  └─ recall.js            Semantic search
│  └─ sync.js              Cloud sync
│  └─ feedback.js          Feedback collection
└─ services/
   ├─ transcription.js     Deepgram integration
   ├─ summarization.js     Claude integration
   ├─ database.js          Supabase/PostgreSQL
   └─ embedding.js         OpenAI embeddings
```

## Error handling

- Invalid/missing audio: `400 Bad Request`
- API failures: `500 Internal Server Error`
- Missing env vars: Server won't start

## Limits

- Max audio file size: 25MB
- Supported formats: WebM, MP3, MP4, WAV, FLAC, OGG, etc.
