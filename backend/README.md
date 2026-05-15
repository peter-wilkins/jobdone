# JobDone Backend

Audio transcription and summarization service for JobDone.

## What it does

- **Transcription**: Converts audio to text using Whisper
- **Summarization**: Creates clean summaries using Claude
- **Extraction**: Pulls out materials, labour time, follow-ups, and future work

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
- `OPENAI_API_KEY` — Get from https://platform.openai.com/api-keys
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

## API Endpoints

### GET /health
Health check endpoint.

```bash
curl http://localhost:3000/health
```

### POST /api/transcribe
Upload audio and get transcription + summary + extracted fields.

```bash
curl -X POST http://localhost:3000/api/transcribe \
  -F "audio=@recording.webm"
```

**Response:**
```json
{
  "transcript": "Fixed the kitchen tap...",
  "summary": "Replaced tap valve at Henderson's.",
  "materials": ["valve cartridge", "plumber's tape"],
  "labour_minutes": 30,
  "follow_ups": ["bathroom inspection"],
  "possible_future_work": "Full kitchen refit"
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
└─ services/
   ├─ transcription.js     Whisper integration
   └─ summarization.js     Claude integration
```

## Error handling

- Invalid/missing audio: `400 Bad Request`
- API failures: `500 Internal Server Error`
- Missing env vars: Server won't start

## Limits

- Max audio file size: 25MB (Whisper limit)
- Supported formats: Any format Whisper accepts (MP3, MP4, WAV, WebM, etc.)
