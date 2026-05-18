# JobDone Frontend

React PWA for voice job logging.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure backend URL (optional)

The frontend defaults to `http://localhost:3000` for the backend. If you're running it elsewhere, create `.env.local`:

```bash
cp .env.example .env.local
# Edit .env.local to set VITE_API_URL
```

### 3. Run development server

```bash
npm run dev
```

UI runs at http://localhost:5173

## Features

### Recording
- Click giant button to record
- Displays elapsed time during recording
- Audio stored locally in IndexedDB

### Processing
- Auto-transcribes with backend (if available)
- Shows "Processing..." while waiting
- Backend creates a narrative summary

### Reviewing
- See transcript and summary
- Confirm to save (deletes audio blob)
- Reject to discard

### Persistence
- All data stored locally in IndexedDB
- Survives page reload
- Ready for backend sync (future)

## Architecture

```
src/
├─ HomeScreen.jsx           Main UI component
├─ services/
│  ├─ audioService.js       Web Audio API wrapper
│  ├─ dbService.js          IndexedDB persistence
│  └─ apiService.js         Backend communication
├─ mockData.js              Test data & utilities
└─ App.jsx, main.jsx        Entry points
```

## Backend Integration

### For transcription to work:

1. **Start the backend:**
   ```bash
   cd ../backend
   npm install
   cp .env.example .env
   # Add OPENAI_API_KEY and ANTHROPIC_API_KEY
   npm run dev
   ```

2. **Frontend will auto-detect** and transcribe recordings

3. **If backend is down**, you can still record. Transcription is optional.

## Build for production

```bash
npm run build
```

Output in `dist/` directory.

## Testing

1. Click record button
2. Say something about a job ("Fixed a tap, took 30 minutes")
3. Stop recording
4. Watch it auto-transcribe (if backend running)
5. Confirm entry → moves to Saved section
6. Reload page → data persists
