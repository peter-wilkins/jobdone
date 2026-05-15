import { useState, useEffect, useRef } from 'react';
import { audioService } from './services/audioService';
import { dbService } from './services/dbService';
import { apiService } from './services/apiService';
import { syncService } from './services/syncService';
import { formatTime } from './mockData';

export function HomeScreen({ onNavigate }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

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
  const [inProgress, setInProgress] = useState([]);
  const [saved, setSaved] = useState([]);
  const [processingIds, setProcessingIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState(true);

  // Load jobs from database on mount
  useEffect(() => {
    const loadJobs = async () => {
      try {
        const inProgressJobs = await dbService.getJobs('recording');
        const readyForReviewJobs = await dbService.getJobs('ready_for_review');
        const failedJobs = await dbService.getJobs('failed');
        const confirmedJobs = await dbService.getJobs('confirmed');

        setInProgress([...inProgressJobs, ...readyForReviewJobs, ...failedJobs]);
        setSaved(confirmedJobs);

        // Check backend availability
        const isAvailable = await apiService.checkHealth();
        setBackendAvailable(isAvailable);

        // Jobs left in 'recording' state from a previous session — auto-retry or mark failed
        // processRecording fetches the full job (incl. audioBlob) by id, so the stripped list is fine here
        for (const job of inProgressJobs) {
          if (isAvailable) {
            processRecording(job.id);
          } else {
            await dbService.markJobFailed(job.id, 'Backend unavailable');
            setInProgress(prev => prev.map(j =>
              j.id === job.id ? { ...j, status: 'failed', errorMessage: 'Backend unavailable' } : j
            ));
          }
        }

        // Retry any confirmed jobs that never made it to the cloud
        if (isAvailable) {
          const pending = confirmedJobs.filter(j => j.syncStatus === 'pending' && j.transcript && j.summary);
          for (const job of pending) {
            try {
              await syncService.syncJob(job);
              await dbService.markJobSynced(job.id);
              setSaved(prev => prev.map(j => j.id === job.id ? { ...j, syncStatus: 'synced' } : j));
              console.log('[UI] Retried sync for job', job.id);
            } catch (e) {
              console.warn('[UI] Retry sync failed for job', job.id, e);
            }
          }
        }
      } catch (err) {
        console.error('Failed to load jobs:', err);
        setError('Failed to load jobs');
      } finally {
        setIsLoading(false);
      }
    };

    loadJobs();
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

  /**
   * Classify a raw fetch/API error into a user-friendly kind token
   */
  const friendlyError = (err) => {
    const msg = err?.message || '';
    if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('network'))
      return 'offline';
    return 'server';
  };

  /**
   * Process a recording: transcribe and extract
   */
  const processRecording = async (jobId) => {
    try {
      setProcessingIds(prev => new Set([...prev, jobId]));

      // Get the job with audio blob
      const job = await dbService.getJob(jobId);
      if (!job || !job.audioBlob) {
        throw new Error('Recording not found');
      }

      // Transcribe
      const result = await apiService.transcribeAudio(job.audioBlob);

      // Update job with transcription data
      const updated = await dbService.updateJobWithTranscription(jobId, {
        transcript: result.transcript,
        summary: result.summary,
        materials: result.materials,
        labour_minutes: result.labour_minutes,
        follow_ups: result.follow_ups,
        possible_future_work: result.possible_future_work,
      });

      // Update UI
      setInProgress(prev =>
        prev.map(j => (j.id === jobId ? updated : j))
      );

      setProcessingIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(jobId);
        return newSet;
      });
    } catch (err) {
      console.error('Recording processing error:', err);
      const kind = friendlyError(err);
      await dbService.markJobFailed(jobId, kind);
      setInProgress(prev => prev.map(j =>
        j.id === jobId ? { ...j, status: 'failed', errorMessage: kind } : j
      ));
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
          const jobId = await dbService.createJob(
            {
              duration: audioData.duration,
            },
            audioData.blob
          );

          // Add to in-progress list
          const newJob = await dbService.getJob(jobId);
          setInProgress(prev => [newJob, ...prev]);

          // Auto-trigger transcription if backend is available
          if (backendAvailable) {
            processRecording(jobId);
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

  const handleConfirm = async (id) => {
    try {
      setError(null);
      const job = inProgress.find(j => j.id === id);
      
      // Delete audio and move to confirmed locally
      await dbService.confirmJob(id);

      // Try to sync to cloud (optional - don't block if it fails)
      if (job && job.transcript && job.summary) {
        try {
          await syncService.syncJob(job);
          await dbService.markJobSynced(id);
          job.syncStatus = 'synced';
          console.log('[UI] Job synced to cloud');
        } catch (syncErr) {
          console.warn('[UI] Cloud sync failed, job saved locally:', syncErr);
          // Don't fail the UI - job is safe locally, will retry on next load
        }
      }

      // Update UI
      setInProgress(prev => prev.filter(j => j.id !== id));
      setSaved(prev => [...prev, job].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    } catch (err) {
      console.error('Failed to confirm job:', err);
      setError('Failed to confirm job');
    }
  };

  const handleRetry = async (id) => {
    try {
      setError(null);
      await dbService.resetJobForRetry(id);
      setInProgress(prev => prev.map(j =>
        j.id === id ? { ...j, status: 'recording', errorMessage: null } : j
      ));
      processRecording(id);
    } catch (err) {
      console.error('Failed to retry job:', err);
      setError('Failed to retry');
    }
  };

  const handleReject = async (id) => {
    try {
      setError(null);
      await dbService.rejectJob(id);
      setInProgress(inProgress.filter(j => j.id !== id));
    } catch (err) {
      console.error('Failed to reject job:', err);
      setError('Failed to reject job');
    }
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
      <div className="border-b border-gray-200 p-6 flex items-center justify-between">
        <h1 className="text-2xl font-light text-gray-900">JobDone</h1>
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
            <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded shadow-lg z-10">
              <button
                onClick={() => { setMenuOpen(false); onNavigate('feedback'); }}
                className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                Leave feedback
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Backend Status */}
      {!backendAvailable && (
        <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
          <p className="text-sm text-gray-500">
            You're offline — recordings are saved and will be processed when you're back online.
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Record Button Section */}
        <div className="p-8 flex flex-col items-center">
          <button
            onClick={handleRecord}
            className={`
              w-24 h-24 rounded-full flex flex-col items-center justify-center
              transition-all duration-200
              ${
                isRecording
                  ? 'bg-red-500 shadow-lg scale-105'
                  : inProgress.length > 0
                  ? 'bg-green-500 shadow-lg'
                  : 'bg-gray-300'
              }
            `}
            title={isRecording ? 'Stop recording' : 'Start recording'}
            disabled={isLoading}
          >
            {isRecording && (
              <>
                <span className="w-3 h-3 bg-white rounded-full animate-pulse mb-2" />
                <span className="text-white text-xs font-semibold">
                  {recordingTime}s
                </span>
              </>
            )}
            {!isRecording && inProgress.length > 0 && (
              <span className="text-white text-2xl">✓</span>
            )}
          </button>
        </div>

        {/* In Progress Section */}
        {inProgress.length > 0 && (
          <div className="px-8 py-6 border-t border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-6">
              In Progress
            </h2>
            {inProgress.map(entry => {
              const isProcessing = processingIds.has(entry.id);

              return (
                <div key={entry.id} className="mb-8 pb-8 border-b border-gray-200 last:border-b-0">
                  {entry.status === 'recording' && (
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-2 mb-4">
                        <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
                        <p className="text-sm text-gray-600">Processing...</p>
                      </div>
                      <p className="text-xs text-gray-500">
                        {entry.audioDuration}s recording
                      </p>
                    </div>
                  )}

                  {entry.status === 'failed' && (
                    <>
                      <p className="text-sm text-gray-500 mb-1">{entry.audioDuration}s recording</p>
                      <p className="text-sm text-gray-500 mb-4">
                        {entry.errorMessage === 'offline'
                          ? "Recording saved — tap Retry when you're back online."
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
                    </>
                  )}

                  {entry.status === 'ready_for_review' && (
                    <>
                      <div className="mb-4">
                        <p className="text-gray-900 mb-3">{entry.summary}</p>
                        <p className="text-sm text-gray-600 mb-4">{entry.transcript}</p>
                        <div className="text-xs text-gray-500 space-y-1 mb-4">
                          <p>• Materials: {entry.materials?.join(', ') || 'None'}</p>
                          <p>• Labour: {entry.labour_minutes || '—'} mins</p>
                          {entry.follow_ups?.length > 0 && (
                            <p>• Follow-ups: {entry.follow_ups.join(', ')}</p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button
                          onClick={() => handleConfirm(entry.id)}
                          className="flex-1 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 transition"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => handleReject(entry.id)}
                          className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition"
                        >
                          Reject
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Saved Section */}
        {saved.length > 0 && (
          <div className="px-8 py-6">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-6">
              Saved
            </h2>
            <div className="space-y-4">
              {saved.map(entry => (
                <div key={entry.id} className="py-3 border-b border-gray-200 last:border-b-0">
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
          </div>
        )}

        {saved.length === 0 && inProgress.length === 0 && !isRecording && (
          <div className="px-8 py-12 text-center text-gray-400">
            <p className="text-sm">No jobs logged yet</p>
          </div>
        )}
      </div>
    </div>
  );
}
