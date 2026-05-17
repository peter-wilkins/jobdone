import { useState, useEffect, useRef } from 'react';
import { audioService } from './services/audioService';
import { dbService } from './services/dbService';
import { apiService } from './services/apiService';
import { syncService } from './services/syncService';
import { queryHistoryService } from './services/queryHistoryService';
import { formatTime } from './mockData';

// Dev toggle for query-active state testing
const SHOW_QUERY_BAR = false;
const MOCK_QUERY_TEXT = 'Show me radiator fixes from last month';

export function HomeScreen({ onNavigate, user, refreshKey = 0 }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const processingIdsRef = useRef(new Set());

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [entries, setEntries] = useState([]);
  const [captureCount, setCaptureCount] = useState(0);
  const [processingIds, setProcessingIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState(true);

  // Query/Recall state
  const [activeQuery, setActiveQuery] = useState(null);
  const [queryResults, setQueryResults] = useState(null);
  const [isRecalling, setIsRecalling] = useState(false);

  // Query history dropdown state
  const [queryDropdownOpen, setQueryDropdownOpen] = useState(false);
  const [recentQueries, setRecentQueries] = useState([]);
  const dropdownRef = useRef(null);

  // Load query history on mount
  useEffect(() => {
    queryHistoryService.getRecent().then(setRecentQueries);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    if (!queryDropdownOpen) return;
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setQueryDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [queryDropdownOpen]);

  /**
   * Classify a raw fetch/API error into a user-friendly kind token
   */
  const friendlyError = (err) => {
    const msg = err?.message || '';
    if (err?.name === 'AbortError' || msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('network'))
      return 'offline';
    return 'server';
  };

  /**
   * Process a recording: transcribe and extract
   */
  const processRecording = async (jobId) => {
    if (processingIdsRef.current.has(jobId)) return;

    try {
      processingIdsRef.current.add(jobId);
      setProcessingIds(prev => new Set([...prev, jobId]));

      // Get the entry with audio blob
      const entry = await dbService.getEntry(jobId);
      if (!entry || !entry.audioBlob) {
        throw new Error('Recording not found');
      }

      // Transcribe - backend returns intent in response
      const result = await apiService.transcribeAudio(entry.audioBlob);

      // Update entry with transcription data and intent (goes to ready_for_review)
      const updated = await dbService.updateEntryWithTranscription(jobId, {
        transcript: result.transcript,
        summary: result.summary,
        materials: result.materials,
        labour_minutes: result.labour_minutes,
        follow_ups: result.follow_ups,
        possible_future_work: result.possible_future_work,
        intent: result.intent || 'NOTE',
      });

      // Update UI
      setEntries(prev =>
        prev.map(e => (e.id === jobId ? updated : e))
      );
      setBackendAvailable(true);
    } catch (err) {
      console.error('Recording processing error:', err);
      const kind = friendlyError(err);
      if (kind === 'offline') setBackendAvailable(false);
      try {
        if (kind === 'offline') {
          const queued = await dbService.updateEntry(jobId, {
            errorMessage: 'offline',
          });
          setEntries(prev => prev.map(e =>
            e.id === jobId ? queued : e
          ));
          return;
        }
        await dbService.markEntryFailed(jobId, kind);
        setEntries(prev => prev.map(e =>
          e.id === jobId ? { ...e, status: 'failed', errorMessage: kind } : e
        ));
      } catch (dbErr) {
        console.error('Failed to mark recording failed:', dbErr);
        setError('Recording processing failed');
      }
    } finally {
      processingIdsRef.current.delete(jobId);
      setProcessingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(jobId);
        return newSet;
      });
    }
  };

  const handleRecord = async () => {
    try {
      setError(null);

      if (!isRecording) {
        // Start recording
        await audioService.startRecording();
        setIsRecording(true);
        setRecordingTime(0);
      } else {
        // Stop recording and save to DB
        setIsRecording(false);
        const audioData = await audioService.stopRecording();

        if (audioData) {
          const jobId = await dbService.createEntry(
            {
              duration: audioData.duration,
            },
            audioData.blob
          );

          // Add to entries list (at the top, as in-progress)
          const newEntry = await dbService.getEntry(jobId);
          setEntries(prev => [newEntry, ...prev]);

          // Auto-trigger transcription if backend is available
          if (backendAvailable) {
            processRecording(jobId);
          } else {
            const queuedEntry = await dbService.updateEntry(jobId, {
              errorMessage: 'offline',
            });
            setEntries(prev => prev.map(e => e.id === jobId ? queuedEntry : e));
          }
        }
      }
    } catch (err) {
      console.error('Recording error:', err);
      setError(err.message);
      setIsRecording(false);
      audioService.cancelRecording();
    }
  };

  const OFFLINE_MSG = 'Recall isn\'t available right now. Try again in a moment.';
  const isOffline = () => !navigator.onLine || !backendAvailable;

  const handleConfirm = async (id) => {
    try {
      setError(null);
      const entry = entries.find(e => e.id === id);

      // Handle QUERY intent
      if (entry.intent === 'QUERY') {
        // Offline: show message, keep entry for later retry
        if (isOffline()) {
          setError('Recall isn\'t available right now. Your recording has been saved locally.');
          return;
        }
        await dbService.rejectEntry(id);
        setEntries(prev => prev.filter(e => e.id !== id));
        await executeQuery(entry.transcript);
        return;
      }

      // Handle NOTE intent - save to entries, proceed as before
      // Delete audio and move to confirmed locally
      await dbService.confirmEntry(id);

      // Try to sync to cloud (optional - don't block if it fails)
      if (entry && entry.transcript && entry.summary) {
        if (!user) {
          // Not logged in — entry saved locally, will sync when user logs in
          console.log('[Sync] Skipped — not logged in. Will retry on login.');
        } else {
          try {
            const result = await syncService.syncEntry(entry);
            if (result !== null) {
              await dbService.markEntrySynced(id, result?.entry?.id);
              entry.syncStatus = 'synced';
            }
          } catch (syncErr) {
            console.warn('[UI] Cloud sync failed, entry saved locally:', syncErr);
            // Don't fail the UI - entry is safe locally, will retry on next login
          }
        }
      }

      // Update UI: move to confirmed section (re-sort)
      setEntries(prev => {
        const updated = prev.map(e => e.id === id ? { ...e, status: 'confirmed' } : e);
        const inProgress = updated.filter(e => e.status !== 'confirmed');
        const confirmed = updated.filter(e => e.status === 'confirmed').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return [...inProgress, ...confirmed];
      });
    } catch (err) {
      console.error('Failed to confirm entry:', err);
      setError('Failed to confirm entry');
    }
  };

  const handleRetry = async (id) => {
    try {
      setError(null);
      await dbService.resetEntryForRetry(id);
      setEntries(prev => prev.map(e =>
        e.id === id ? { ...e, status: 'recording', errorMessage: null } : e
      ));
      processRecording(id);
    } catch (err) {
      console.error('Failed to retry entry:', err);
      setError('Failed to retry');
    }
  };

  const handleReject = async (id) => {
    try {
      setError(null);
      await dbService.rejectEntry(id);
      setEntries(prev => prev.filter(e => e.id !== id));
    } catch (err) {
      console.error('Failed to reject entry:', err);
      setError('Failed to reject entry');
    }
  };

  const retryPendingRecordings = async () => {
    const [recordingEntries, failedEntries] = await Promise.all([
      dbService.getEntries('recording'),
      dbService.getEntries('failed'),
    ]);
    const retryableFailed = failedEntries.filter(entry =>
      ['offline', 'Backend unavailable'].includes(entry.errorMessage)
    );

    for (const entry of [...recordingEntries, ...retryableFailed]) {
      if (entry.status === 'failed') {
        await dbService.resetEntryForRetry(entry.id);
        setEntries(prev => prev.map(e =>
          e.id === entry.id ? { ...e, status: 'recording', errorMessage: null } : e
        ));
      }
      processRecording(entry.id);
    }
  };

  const refreshBackendStatus = async () => {
    const isAvailable = await apiService.checkHealth();
    setBackendAvailable(isAvailable);
    if (isAvailable) {
      await retryPendingRecordings();
    }
    return isAvailable;
  };

  /**
   * Execute a query: call recall, show results, save to history.
   * Used for both confirm-screen queries and re-runs from dropdown.
   */
  const executeQuery = async (text) => {
    setQueryDropdownOpen(false);
    // Offline: show message, no network call
    if (isOffline()) {
      setError(OFFLINE_MSG);
      return;
    }
    setIsRecalling(true);
    try {
      const results = await apiService.recall(text);
      setActiveQuery(text);
      setQueryResults(results);
      // Save to local + server history
      await queryHistoryService.add(text);
      setRecentQueries(await queryHistoryService.getRecent());
    } catch (err) {
      if (err?.message === 'Failed to fetch' || err?.message?.includes('NetworkError') || !navigator.onLine) {
        setError(OFFLINE_MSG);
      } else {
        setError('Something went wrong — try again.');
      }
    } finally {
      setIsRecalling(false);
    }
  };

  // Load entries from database on mount
  useEffect(() => {
    const loadJobs = async () => {
      try {
        const captures = await dbService.getCaptures();
        setCaptureCount(captures.length);

        const inProgressEntries = await dbService.getEntries('recording');
        const readyForReviewEntries = await dbService.getEntries('ready_for_review');
        const failedEntries = await dbService.getEntries('failed');
        const confirmedEntries = await dbService.getEntries('confirmed');

        // Merge all entries: in-progress first, then confirmed (newest first)
        const allInProgress = [...inProgressEntries, ...readyForReviewEntries, ...failedEntries];
        const sortedConfirmed = confirmedEntries.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        setEntries([...allInProgress, ...sortedConfirmed]);

        // Check backend availability
        const isAvailable = await refreshBackendStatus();

        // Entries left in 'recording' state from a previous session — auto-retry or mark failed
        for (const entry of inProgressEntries) {
          if (isAvailable) {
            processRecording(entry.id);
          } else {
            setEntries(prev => prev.map(e =>
              e.id === entry.id ? { ...e, errorMessage: 'offline' } : e
            ));
          }
        }

        // Retry any confirmed entries that never made it to the cloud
        if (isAvailable) {
          const pending = sortedConfirmed.filter(e => e.syncStatus === 'pending' && e.transcript && e.summary);
          for (const entry of pending) {
            try {
              const result = await syncService.syncEntry(entry);
              if (result !== null) {
                await dbService.markEntrySynced(entry.id, result?.entry?.id);
                setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, syncStatus: 'synced' } : e));
              }
            } catch (e) {
              console.warn('[UI] Retry sync failed for entry', entry.id, e);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load entries:', err);
        setError('Failed to load entries');
      } finally {
        setIsLoading(false);
      }
    };

    loadJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    const handlePossibleReconnect = () => {
      refreshBackendStatus().catch(err => {
        console.warn('[Online] Backend refresh failed:', err);
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') handlePossibleReconnect();
    };

    window.addEventListener('online', handlePossibleReconnect);
    window.addEventListener('focus', handlePossibleReconnect);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('online', handlePossibleReconnect);
      window.removeEventListener('focus', handlePossibleReconnect);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update recording time display
  useEffect(() => {
    if (!isRecording) return;

    const interval = setInterval(() => {
      const status = audioService.getStatus();
      setRecordingTime(status.elapsedSeconds);
    }, 100);

    return () => clearInterval(interval);
  }, [isRecording]);

  // Capture Bar states
  const renderCaptureBar = () => {
    // Query recall loading state
    if (isRecalling) {
      return (
        <div className="flex items-center justify-center px-4 h-12">
          <div className="flex items-center gap-2">
            <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            <span className="text-sm text-gray-600">Searching...</span>
          </div>
        </div>
      );
    }

    // Active query state
    if (activeQuery) {
      return (
        <div className="flex items-center gap-3 px-4 h-12">
          <button
            onClick={() => {
              setActiveQuery(null);
              setQueryResults(null);
            }}
            className="shrink-0 w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-700 transition"
            title="Back to timeline"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900 truncate">{activeQuery}</p>
          </div>
        </div>
      );
    }

    // Dev toggle: query-active state (for testing)
    if (SHOW_QUERY_BAR) {
      return (
        <div className="flex items-center gap-3 px-4 h-12">
          <button
            onClick={() => { /* TODO: return to full timeline */ }}
            className="shrink-0 w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-700 transition"
            title="Back to timeline"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-gray-900 truncate">{MOCK_QUERY_TEXT}</p>
          </div>
        </div>
      );
    }

    if (isRecording) {
      // Timer now shown in header
      return <div className="h-12" />;
    }

    // Idle state - clickable bar body opens query history dropdown
    return (
      <div className="relative h-12" ref={dropdownRef}>
        <button
          onClick={() => setQueryDropdownOpen(o => !o)}
          className="w-full h-12 px-4 flex items-center justify-between text-left hover:bg-gray-50 transition"
        >
          <span className="text-sm text-gray-400">Recent searches…</span>
          <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown */}
        {queryDropdownOpen && (
          <div className="absolute left-4 right-4 top-12 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
            {recentQueries.length === 0 ? (
              <div className="px-4 py-6 text-center text-gray-400 text-sm">No recent searches</div>
            ) : (
              <div className="p-2">
                {recentQueries.map((q, i) => (
                  <button
                    key={q.id || i}
                    onClick={() => executeQuery(q.text)}
                    className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 transition text-sm text-gray-700 truncate"
                  >
                    {q.text}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Floating mic button state colors: grey (idle), red (recording), green (has in-progress entries)
  const getMicColorClass = () => {
    if (isRecording) return 'bg-red-500';
    const hasInProgress = entries.some(e => e.status !== 'confirmed');
    if (hasInProgress) return 'bg-green-500';
    return 'bg-gray-500';
  };

  const renderEntry = (entry) => {
    const isProcessing = processingIds.has(entry.id);

    if (entry.status === 'recording' || isProcessing) {
      const isQueued = entry.errorMessage === 'offline';
      return (
        <div key={entry.id} className="py-4 border-b border-gray-100 last:border-b-0">
          <div className="flex items-center gap-3">
            <div
              className={`h-4 w-4 border-2 rounded-full ${
                isQueued ? 'border-gray-300 border-t-transparent' : 'animate-spin border-blue-500 border-t-transparent'
              }`}
            />
            <div className="flex-1">
              <p className="text-sm text-gray-600">
                {isQueued ? 'There is an issue with Sync right now but carry on.' : 'Processing...'}
              </p>
              <p className="text-xs text-gray-400">{entry.audioDuration}s recording</p>
            </div>
          </div>
        </div>
      );
    }

    if (entry.status === 'failed') {
      return (
        <div key={entry.id} className="py-4 border-b border-gray-100 last:border-b-0">
          <div className="flex items-start gap-2 mb-3">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
              Failed
            </span>
            <p className="text-xs text-gray-500">{entry.audioDuration}s recording</p>
          </div>
          <p className="text-sm text-gray-600 mb-3">
            {entry.errorMessage === 'offline'
              ? 'There is an issue with Sync right now but carry on.'
              : 'Something went wrong. Tap Retry to try again.'}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => handleRetry(entry.id)}
              className="flex-1 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 transition"
            >
              Retry
            </button>
            <button
              onClick={() => handleReject(entry.id)}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition"
            >
              Discard
            </button>
          </div>
        </div>
      );
    }

    if (entry.status === 'ready_for_review') {
      const isQuery = entry.intent === 'QUERY';
      
      const toggleIntent = async () => {
        const newIntent = isQuery ? 'NOTE' : 'QUERY';
        await dbService.updateEntry(entry.id, { intent: newIntent });
        setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, intent: newIntent } : e));
      };

      return (
        <div key={entry.id} className="py-4 border-b border-gray-100 last:border-b-0">
          <div className="flex items-start gap-2 mb-3">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
              Review
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
              {isQuery ? 'Search' : 'Note'}
            </span>
          </div>
          
          {isQuery ? (
            // QUERY layout
            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-1">Searching for:</p>
              <p className="text-gray-900">{entry.transcript}</p>
            </div>
          ) : (
            // NOTE layout
            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-1">Saving entry:</p>
              <p className="text-gray-900 mb-2">{entry.summary}</p>
              <p className="text-sm text-gray-600 mb-3">{entry.transcript}</p>
              <div className="text-xs text-gray-500 space-y-1">
                <p>• Materials: {entry.materials?.join(', ') || 'None'}</p>
                <p>• Labour: {entry.labour_minutes || '—'} mins</p>
                {entry.follow_ups?.length > 0 && (
                  <p>• Follow-ups: {entry.follow_ups.join(', ')}</p>
                )}
              </div>
            </div>
          )}
          
          {/* Intent toggle */}
          <button
            onClick={toggleIntent}
            className="text-sm text-blue-600 underline mb-4 hover:text-blue-800 transition"
          >
            {isQuery ? 'Save as note instead' : 'Search instead'}
          </button>
          
          <div className="flex gap-3">
            <button
              onClick={() => handleConfirm(entry.id)}
              className="flex-1 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 transition"
            >
              {isQuery ? 'Search' : 'Confirm'}
            </button>
            <button
              onClick={() => handleReject(entry.id)}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition"
            >
              Reject
            </button>
          </div>
        </div>
      );
    }

    // Confirmed entry
    return (
      <div key={entry.id} className="py-3 border-b border-gray-100 last:border-b-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-gray-900 font-medium">{entry.summary || entry.transcript || 'Untitled'}</p>
          <span className="text-xs shrink-0" title={entry.syncStatus === 'synced' ? 'Saved to cloud' : 'Pending sync'}>
            {entry.syncStatus === 'synced' ? '☁️' : '⏳'}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">{formatTime(new Date(entry.created_at))}</p>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="h-screen bg-white flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <h1 className="text-xl font-light text-gray-900">JobDone</h1>
        
        {/* Recording timer in header */}
        {isRecording && (
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
            <span className="text-sm font-medium text-gray-900">
              {Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}
            </span>
          </div>
        )}
        
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="w-8 h-8 flex flex-col items-center justify-center gap-1.5 text-gray-400 hover:text-gray-600 transition"
            title="Menu"
          >
            <span className="w-5 h-px bg-current" />
            <span className="w-5 h-px bg-current" />
            <span className="w-5 h-px bg-current" />
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded shadow-lg z-20">
              {user ? (
                <div className="px-4 py-3 border-b border-gray-100">
                  <p className="text-xs text-gray-400">Signed in as</p>
                  <p className="text-xs text-gray-700 truncate">{user.email}</p>
                </div>
              ) : (
                <button
                  onClick={() => { setMenuOpen(false); onNavigate('login'); }}
                  className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
                >
                  Log in
                </button>
              )}
              <button
                onClick={() => { setMenuOpen(false); onNavigate('inbox'); }}
                className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition flex items-center justify-between"
              >
                <span>Inbox</span>
                {captureCount > 0 && (
                  <span className="text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">{captureCount}</span>
                )}
              </button>
              <button
                onClick={() => { setMenuOpen(false); onNavigate('people'); }}
                className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                People
              </button>
              <button
                onClick={() => { setMenuOpen(false); onNavigate('feedback'); }}
                className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                Leave feedback
              </button>
              {user && (
                <button
                  onClick={() => { setMenuOpen(false); onNavigate('login'); }}
                  className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition border-t border-gray-100"
                >
                  Account
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Login nudge */}
      {!user && entries.some(e => e.status === 'confirmed' && e.syncStatus !== 'synced') && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 flex items-center justify-between gap-4">
          <p className="text-sm text-blue-700">
            💾 {entries.filter(e => e.status === 'confirmed' && e.syncStatus !== 'synced').length} entr{entries.filter(e => e.status === 'confirmed' && e.syncStatus !== 'synced').length === 1 ? 'y' : 'ies'} saved locally — log in to sync to cloud.
          </p>
          <button
            onClick={() => onNavigate('login')}
            className="text-sm font-medium text-blue-700 underline shrink-0"
          >
            Log in
          </button>
        </div>
      )}

      {/* Backend Status */}
      {!backendAvailable && (
        <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
          <p className="text-sm text-gray-500">
            There is an issue with Sync right now but carry on.
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Capture Bar */}
      <div className="border-b border-gray-200 bg-white z-10">
        {renderCaptureBar()}
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto px-4">
        {/* Query Results View */}
        {activeQuery && (
          <div className="py-2">
            <p className="text-sm text-gray-500 mb-4">
              Showing results for: <span className="font-medium text-gray-900">{activeQuery}</span>
            </p>
            {queryResults === null ? (
              <div className="py-12 text-center text-gray-400">
                <p className="text-sm">Searching...</p>
              </div>
            ) : queryResults.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <p className="text-sm">Nothing found — try rephrasing.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {queryResults.map((entry, index) => (
                  <div key={entry.id || index} className="py-3 border-b border-gray-100 last:border-b-0">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-gray-900 font-medium">{entry.summary || entry.transcript || 'Untitled'}</p>
                      <span className="text-xs shrink-0" title={entry.syncStatus === 'synced' ? 'Saved to cloud' : 'Pending sync'}>
                        {entry.syncStatus === 'synced' ? '☁️' : '⏳'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{formatTime(new Date(entry.created_at))}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Normal Timeline View */}
        {!activeQuery && entries.length === 0 && (
          <div className="py-12 text-center text-gray-400">
            <p className="text-sm">No entries logged yet</p>
            <p className="text-xs mt-1">Tap the mic to start recording</p>
          </div>
        )}
        {!activeQuery && entries.length > 0 && (
          <div className="py-2">
            {entries.map(renderEntry)}
          </div>
        )}
      </div>

      {/* Floating mic button - bottom right, 50% larger (w-15 h-15 = 60px) */}
      <button
        onClick={handleRecord}
        className={`fixed bottom-6 right-6 w-14 h-14 flex items-center justify-center ${getMicColorClass()} text-white rounded-full shadow-lg hover:opacity-90 transition z-50`}
        title={isRecording ? 'Stop recording' : 'Start recording'}
        disabled={isLoading}
      >
        {isRecording ? (
          <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        ) : (
          <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
          </svg>
        )}
      </button>
    </div>
  );
}
