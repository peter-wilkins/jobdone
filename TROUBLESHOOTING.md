# Troubleshooting JobDone

## Audio transcription not working

### "Transcription endpoint error: multipart data terminated early"

This happens when the audio blob isn't being sent properly.

**Check:**

1. **Is the backend running?**
   ```bash
   curl http://localhost:3000/health
   ```
   Should return `{"status":"ok",...}`

2. **Do you have API keys?**
   ```bash
   cd backend
   cat .env | grep -E "OPENAI|ANTHROPIC"
   ```
   Should show both keys set. If not:
   ```bash
   cp .env.example .env
   # Edit .env and add your actual keys
   ```

3. **Check console logs:**
   
   **Browser console** (F12 → Console tab):
   ```
   [API] Transcribing audio: { size: XXXX, type: "audio/webm" }
   [API] Sending to backend: http://localhost:3000/api/transcribe
   ```
   
   If audio size is 0, the blob is empty. This shouldn't happen if you recorded for >1 second.

   **Backend terminal:**
   ```
   [Transcribe] Received audio file: recording.webm, size: XXXX bytes
   [Whisper] Buffer size: XXXX bytes
   [Whisper] Temp file created: /tmp/audio-...
   ```

4. **Test with curl:**
   ```bash
   # Create a test audio file first
   curl -X POST http://localhost:3000/api/transcribe \
     -F "audio=@/path/to/audio.webm"
   ```

### "Failed to transcribe audio: 401 Unauthorized"

Your OpenAI API key is wrong or has no quota.

**Fix:**
- Go to https://platform.openai.com/account/billing/limits
- Check you have credit
- Check your key is fresh and hasn't been revoked
- Update `.env` and restart backend

### "Failed to summarize transcript: ..."

Your Anthropic API key is wrong.

**Fix:**
- Go to https://console.anthropic.com/keys
- Create a new key if expired
- Update `.env` and restart backend

### No error, but nothing happens

The backend might be on a different port or URL.

**Check:**

1. What's `VITE_API_URL` in frontend?
   ```bash
   cat frontend/.env.local 2>/dev/null || echo "Not set (using default)"
   ```
   Should default to `http://localhost:3000`

2. Is backend on a different port?
   ```bash
   ps aux | grep "node.*index.js"
   ```
   Look for the port in the output

3. If backend is on different port, update frontend:
   ```bash
   cd frontend
   echo "VITE_API_URL=http://localhost:XXXX" > .env.local
   npm run dev
   ```

## Recording not working

### Microphone access denied

**In browser:**
- Check permissions (browser settings)
- Reload page and allow microphone again
- Try a different browser

### Recording button does nothing

Check browser console for errors. If you see:
```
Microphone access denied. Please check your browser permissions.
```

Allow microphone access in:
- Chrome: Settings → Privacy → Microphone → Allow localhost:5173
- Firefox: about:permissions → Microphone → Allow
- Safari: System Preferences → Security → Microphone

## Data not persisting

### Jobs disappear on reload

This should NOT happen — they're stored in IndexedDB.

**Check:**
1. Open DevTools → Application → IndexedDB → plumber-job-log → jobs
2. Do you see entries?

**If yes but they're not showing:**
- Reload page harder: `Ctrl+Shift+R` (hard refresh, clears cache)
- Check browser console for errors

**If no entries:**
- Recording might not be working (see above)
- Try recording something again

## Need more help?

1. **Check logs:**
   - Browser: F12 → Console
   - Backend: Terminal where you ran `npm run dev`

2. **Provide these when asking for help:**
   ```bash
   # Browser
   [Copy console output]
   
   # Backend
   [Copy last 20 lines of server log]
   
   # Environment
   node --version
   npm --version
   ```
