import { useState, useEffect } from 'react';
import { audioService } from './services/audioService';
import { dbService } from './services/dbService';
import { formatTime } from './mockData';

export function HomeScreen() {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [inProgress, setInProgress] = useState([]);
  const [saved, setSaved] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load jobs from database on mount
  useEffect(() => {
    const loadJobs = async () => {
      try {
        const inProgressJobs = await dbService.getJobs('recording');
        const readyForReviewJobs = await dbService.getJobs('ready_for_review');
        const confirmedJobs = await dbService.getJobs('confirmed');

        setInProgress([...inProgressJobs, ...readyForReviewJobs]);
        setSaved(confirmedJobs);
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
          setInProgress([newJob, ...inProgress]);
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
      await dbService.confirmJob(id);

      // Move from in-progress to saved
      const job = inProgress.find(j => j.id === id);
      setInProgress(inProgress.filter(j => j.id !== id));
      setSaved([job, ...saved]);
    } catch (err) {
      console.error('Failed to confirm job:', err);
      setError('Failed to confirm job');
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
      <div className="border-b border-gray-200 p-6">
        <h1 className="text-2xl font-light text-gray-900">JobDone</h1>
      </div>

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
            {inProgress.map(entry => (
              <div key={entry.id} className="mb-8 pb-8 border-b border-gray-200 last:border-b-0">
                {entry.status === 'recording' && (
                  <div className="text-center">
                    <p className="text-sm text-gray-600 mb-4">
                      {entry.audioDuration}s recording saved
                    </p>
                    <p className="text-xs text-gray-500">
                      Waiting for transcription...
                    </p>
                  </div>
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
            ))}
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
                  <p className="text-sm text-gray-900 font-medium">{entry.summary || entry.transcript || 'Untitled'}</p>
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
