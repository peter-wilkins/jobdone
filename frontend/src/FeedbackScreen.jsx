import { useCallback, useEffect, useState } from 'react';
import { audioService } from './services/audioService';
import { dbService } from './services/dbService';
import { apiService } from './services/apiService';
import { authService } from './services/authService';
import { diagnosticService } from './services/diagnosticService';
import {
  canCreateTextFeedback,
  defaultTranscriptForTriage,
  FEEDBACK_DATA_LOSS,
  FEEDBACK_IMPACTS,
  FEEDBACK_KINDS,
  feedbackTriageSummary,
  normalizeFeedbackTriage,
  parseFeedbackTriageFromLocation,
} from './services/feedbackTriageService';
import { formatTime } from './mockData';
import { FloatingRecordButton } from './FloatingRecordButton';

const BUILD_ID = import.meta.env.VITE_DEPLOYMENT_ID || import.meta.env.VITE_BUILD_ID || 'dev';

function optionLabel(options, value) {
  return options.find(option => option.value === value)?.label || value;
}

function SegmentedButtons({ label, options, value, onChange, tone = 'gray' }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">{label}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map(option => {
          const selected = option.value === value;
          const selectedClass = tone === 'red'
            ? 'border-red-500 bg-red-50 text-red-800'
            : 'border-gray-900 bg-gray-900 text-white';
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`min-h-10 rounded border px-3 py-2 text-sm font-medium transition ${
                selected ? selectedClass : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TriageSummary({ triage }) {
  if (!triage) return null;
  const normalized = normalizeFeedbackTriage(triage);
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
        {optionLabel(FEEDBACK_KINDS, normalized.kind)}
      </span>
      <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
        {optionLabel(FEEDBACK_IMPACTS, normalized.impact)}
      </span>
      <span className={`rounded px-2 py-1 text-xs ${
        normalized.data_loss === 'yes' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-700'
      }`}>
        Data loss: {optionLabel(FEEDBACK_DATA_LOSS, normalized.data_loss)}
      </span>
      {normalized.surface && (
        <span className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700">
          {normalized.surface}
        </span>
      )}
    </div>
  );
}

function DiagnosticPreview({ bundle }) {
  if (!bundle) return null;

  const recentEvents = bundle.recent_events || [];

  return (
    <details className="mb-4 rounded border border-gray-200 bg-gray-50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-gray-700">
        Diagnostic preview
      </summary>
      <dl className="mt-3 space-y-2 text-xs text-gray-600">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-400">Build</dt>
          <dd className="font-mono text-right">{bundle.build_id}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-400">Screen</dt>
          <dd className="text-right">{bundle.route?.screen || 'unknown'}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-400">Backend</dt>
          <dd className="text-right">
            {bundle.backend?.available === null ? 'unknown' : bundle.backend?.available ? 'available' : 'unavailable'}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-gray-400">Device</dt>
          <dd className="text-right">{bundle.environment?.platform || 'unknown'}</dd>
        </div>
        <div>
          <dt className="text-gray-400">Recent app events</dt>
          <dd className="mt-1 space-y-1">
            {recentEvents.length ? recentEvents.slice(-5).map((event, index) => (
              <div key={`${event.at}-${index}`} className="font-mono text-[11px] text-gray-500">
                {event.event}
                {event.detail?.screen ? `:${event.detail.screen}` : ''}
                {event.detail?.source ? `:${event.detail.source}` : ''}
                {' · '}
                {new Date(event.at).toLocaleTimeString()}
              </div>
            )) : (
              <span>No recent events captured</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-gray-400">Excluded by default</dt>
          <dd className="mt-1">{bundle.privacy?.excludes?.join(', ')}</dd>
        </div>
      </dl>
    </details>
  );
}

export function FeedbackScreen({ onBack, onRecord }) {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [submitted, setSubmitted] = useState([]);
  const [pending, setPending] = useState([]);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [sendStatus, setSendStatus] = useState(null);
  const [typedReport, setTypedReport] = useState('');
  const [backendAvailable, setBackendAvailable] = useState(null);
  const [triage, setTriage] = useState(() => parseFeedbackTriageFromLocation());

  const updateTriage = useCallback((updates) => {
    setTriage(current => normalizeFeedbackTriage({ ...current, ...updates }));
  }, []);

  const friendlyError = (err) => {
    const msg = err?.message || '';
    if (msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('network')) {
      return 'offline';
    }
    return 'server';
  };

  const refreshLists = useCallback(async () => {
    const recording = await dbService.getFeedbackItems('recording');
    const readyForReview = await dbService.getFeedbackItems('ready_for_review');
    const failed = await dbService.getFeedbackItems('failed');
    const confirmed = await dbService.getFeedbackItems('confirmed');

    setPending([...recording, ...readyForReview, ...failed, ...confirmed.filter(item => item.syncStatus === 'pending')]);
    setSubmitted(confirmed.filter(item => item.syncStatus !== 'pending'));
    return { recording };
  }, []);

  const buildDiagnosticBundle = useCallback(async (triageState = triage) => {
    const isAvailable = await apiService.checkHealth();
    setBackendAvailable(isAvailable);
    const bundle = await diagnosticService.buildBundle({
      screen: 'report_issue',
      backendAvailable: isAvailable,
    });
    return {
      ...bundle,
      feedback: feedbackTriageSummary(triageState),
    };
  }, [triage]);

  const syncFeedbackItem = useCallback(async (item) => {
    await apiService.saveFeedback({
      transcript: item.transcript,
      created_at: item.created_at,
      diagnostic_bundle: item.diagnosticBundle,
      kind: item.triage?.kind,
      impact: item.triage?.impact,
      data_loss: item.triage?.data_loss,
    });
    return dbService.markFeedbackSynced(item.id);
  }, []);

  const sendFeedbackItem = useCallback(async (item) => {
    await dbService.confirmFeedback(item.id);
    const confirmed = { ...item, audioBlob: null, status: 'confirmed', syncStatus: 'pending' };
    setPending(prev => [confirmed, ...prev.filter(f => f.id !== item.id)]);

    try {
      const synced = await syncFeedbackItem(confirmed);
      setPending(prev => prev.filter(f => f.id !== item.id));
      setSubmitted(prev =>
        [synced, ...prev.filter(f => f.id !== item.id)]
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      );
      diagnosticService.record('issue_report_submitted', {
        source: item.audioDuration ? 'audio' : 'typed',
        synced: true,
        identity: authService.isLoggedIn() ? 'signed_in' : 'anonymous',
        ...feedbackTriageSummary(item.triage),
      });
      return true;
    } catch (syncErr) {
      console.warn('Feedback sync failed:', syncErr);
      diagnosticService.record('issue_report_submitted', {
        source: item.audioDuration ? 'audio' : 'typed',
        synced: false,
        identity: authService.isLoggedIn() ? 'signed_in' : 'anonymous',
        ...feedbackTriageSummary(item.triage),
      });
      return false;
    }
  }, [syncFeedbackItem]);

  const handleSendPending = useCallback(async (id) => {
    try {
      setError(null);
      setSendStatus('Sending report...');
      let item = pending.find(f => f.id === id) || submitted.find(f => f.id === id);
      if (!item) return;
      if (item.status === 'recording' && item.audioBlob) {
        const result = await apiService.transcribeAudio(item.audioBlob);
        item = await dbService.updateFeedbackWithTranscript(id, result.transcript || 'Voice feedback report');
      }
      if (item.status !== 'confirmed') {
        await dbService.confirmFeedback(id);
        item = { ...item, status: 'confirmed', syncStatus: 'pending', audioBlob: null };
      }
      const synced = await syncFeedbackItem(item);
      setPending(prev => prev.filter(f => f.id !== id));
      setSubmitted(prev => {
        const withoutOld = prev.filter(f => f.id !== id);
        return [synced, ...withoutOld].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      });
      setSendStatus('Report sent.');
    } catch (err) {
      console.warn('Pending feedback sync failed:', err);
      setError('Could not send yet. Try again later.');
      setSendStatus('Saved. Will retry when Sync is available.');
    }
  }, [pending, submitted, syncFeedbackItem]);

  useEffect(() => {
    diagnosticService.record('report_issue_opened', { build: BUILD_ID });
    const load = async () => {
      try {
        await refreshLists();

        const isAvailable = await apiService.checkHealth();
        setBackendAvailable(isAvailable);
      } catch (err) {
        console.error('Failed to load feedback:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, [refreshLists]);

  useEffect(() => {
    if (!isRecording) return;
    const interval = setInterval(() => {
      setRecordingTime(audioService.getStatus().elapsedSeconds);
    }, 100);
    return () => clearInterval(interval);
  }, [isRecording]);

  const handleRecord = async () => {
    try {
      setError(null);
      if (!isRecording) {
        diagnosticService.record('issue_report_record_start');
        await audioService.startRecording();
        setIsRecording(true);
        setRecordingTime(0);
      } else {
        setIsRecording(false);
        const audioData = await audioService.stopRecording();
        if (audioData) {
          const currentTriage = normalizeFeedbackTriage(triage);
          diagnosticService.record('issue_report_record_stop', {
            duration: audioData.duration,
            ...feedbackTriageSummary(currentTriage),
          });
          setSendStatus('Transcribing voice detail...');
          const diagnosticBundle = await buildDiagnosticBundle(currentTriage);
          let transcript = 'Voice feedback report';
          try {
            const result = await apiService.transcribeAudio(audioData.blob);
            transcript = result.transcript || transcript;
            diagnosticService.record('issue_report_transcribed', {
              duration: audioData.duration,
              status: 'sending',
            });
          } catch (transcriptionErr) {
            const kind = friendlyError(transcriptionErr);
            diagnosticService.record('issue_report_processing_failed', { kind });
          }
          setSendStatus('Sending report...');
          const id = await dbService.createFeedbackTextReport({
            transcript,
            diagnosticBundle,
            triage: currentTriage,
          });
          const newItem = await dbService.getFeedbackItem(id);
          const synced = await sendFeedbackItem(newItem);
          setSendStatus(synced ? 'Report sent.' : 'Saved. Will retry when Sync is available.');
        }
      }
    } catch (err) {
      console.error('Recording error:', err);
      setError(err.message);
      setIsRecording(false);
      audioService.cancelRecording();
    }
  };

  const handleTypedSubmit = async () => {
    const trimmed = typedReport.trim();
    const currentTriage = normalizeFeedbackTriage(triage);
    if (!canCreateTextFeedback({ text: trimmed, triage: currentTriage })) {
      setError('Describe the issue before creating a report.');
      return;
    }

    try {
      setError(null);
      setSendStatus('Sending report...');
      diagnosticService.record('issue_report_typed_created', {
        length: trimmed.length,
        ...feedbackTriageSummary(currentTriage),
      });
      const diagnosticBundle = await buildDiagnosticBundle(currentTriage);
      const id = await dbService.createFeedbackTextReport({
        transcript: trimmed || defaultTranscriptForTriage(currentTriage),
        diagnosticBundle,
        triage: currentTriage,
      });
      const newItem = await dbService.getFeedbackItem(id);
      setTypedReport('');
      const synced = await sendFeedbackItem(newItem);
      setSendStatus(synced ? 'Report sent.' : 'Saved. Will retry when Sync is available.');
    } catch (err) {
      console.error('Failed to create typed report:', err);
      setError('Failed to create issue report');
    }
  };

  const handleDiscard = async (id) => {
    try {
      await dbService.rejectFeedback(id);
      setPending(prev => prev.filter(f => f.id !== id));
    } catch (err) {
      console.error('Failed to discard feedback:', err);
    }
  };

  const handleRetry = async (id) => {
    try {
      setError(null);
      await handleSendPending(id);
    } catch (err) {
      console.error('Failed to retry:', err);
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
      <div className="border-b border-gray-200 p-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-600 transition"
          title="Back"
        >
          ←
        </button>
        <div>
          <h1 className="text-2xl font-light text-gray-900">Report issue</h1>
          <p className="text-[10px] leading-4 text-gray-400 font-mono">build {BUILD_ID}</p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="px-6 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Report input */}
        <div className="p-8 flex flex-col gap-4">
          <div className={`rounded border p-4 ${
            triage.data_loss === 'yes' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'
          }`}>
            <div className="space-y-4">
              <SegmentedButtons
                label="Kind"
                options={FEEDBACK_KINDS}
                value={triage.kind}
                onChange={(kind) => updateTriage({ kind })}
                tone={triage.kind === 'data_loss' ? 'red' : 'gray'}
              />
              <SegmentedButtons
                label="Impact"
                options={FEEDBACK_IMPACTS}
                value={triage.impact}
                onChange={(impact) => updateTriage({ impact })}
              />
              <SegmentedButtons
                label="Lost work or missing data?"
                options={FEEDBACK_DATA_LOSS}
                value={triage.data_loss}
                onChange={(data_loss) => updateTriage({
                  data_loss,
                  kind: data_loss === 'yes'
                    ? 'data_loss'
                    : triage.kind === 'data_loss' ? 'bug' : triage.kind,
                })}
                tone={triage.data_loss === 'yes' ? 'red' : 'gray'}
              />
            </div>
          </div>

          <textarea
            value={typedReport}
            onChange={(event) => setTypedReport(event.target.value)}
            rows={4}
            className="w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
            placeholder={triage.data_loss === 'yes' ? 'What is missing? (optional)' : 'What went wrong?'}
          />
          <button
            onClick={handleTypedSubmit}
            className={`w-full rounded px-4 py-2 text-sm font-medium text-white transition disabled:bg-gray-300 ${
              triage.data_loss === 'yes' ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-900 hover:bg-gray-700'
            }`}
            disabled={!canCreateTextFeedback({ text: typedReport, triage })}
          >
            {triage.data_loss === 'yes' ? 'Send data-loss report' : 'Send report'}
          </button>
          {sendStatus && (
            <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {sendStatus}
            </div>
          )}
          <div className="flex flex-col items-center gap-3 pt-4">
            <button
              onClick={handleRecord}
              className={`
                w-24 h-24 rounded-full flex flex-col items-center justify-center
                transition-all duration-200
                ${isRecording ? 'bg-red-500 shadow-lg scale-105' : 'bg-gray-300'}
              `}
              title={isRecording ? 'Stop' : 'Record issue'}
            >
              {isRecording ? (
                <>
                  <span className="w-3 h-3 bg-white rounded-full animate-pulse mb-2" />
                  <span className="text-white text-xs font-semibold">{recordingTime}s</span>
                </>
              ) : (
                <span className="text-gray-500 text-xs text-center leading-tight px-2">
                  Record issue
                </span>
              )}
            </button>
            <p className="text-xs text-gray-400 text-center max-w-xs">
              Voice or text reports attach build, device, status, and recent app events. Private Entry content and Contact details are excluded by default.
            </p>
            {backendAvailable === false && (
              <p className="text-xs text-amber-700 text-center">
                There is an issue with Sync right now but carry on.
              </p>
            )}
          </div>
        </div>

        {/* Pending items */}
        {pending.length > 0 && (
          <div className="px-8 py-6 border-t border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-6">
              Waiting to send
            </h2>
            {pending.map(item => (
              <div key={item.id} className="mb-8 pb-8 border-b border-gray-200 last:border-b-0">
                <TriageSummary triage={item.triage} />
                {item.transcript && (
                  <p className="text-gray-900 mb-4 whitespace-pre-wrap">{item.transcript}</p>
                )}
                {!item.transcript && (
                  <p className="text-sm text-gray-500 mb-4">
                    {item.audioDuration ? `${item.audioDuration}s voice report` : 'Report saved locally'}
                  </p>
                )}
                <DiagnosticPreview bundle={item.diagnosticBundle} />
                <div className="flex gap-3">
                  <button
                    onClick={() => handleRetry(item.id)}
                    className="flex-1 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 transition"
                  >
                    Retry send
                  </button>
                  <button
                    onClick={() => handleDiscard(item.id)}
                    className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Submitted feedback */}
        {submitted.length > 0 && (
          <div className="px-8 py-6">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wide mb-6">
              Sent reports
            </h2>
            <div className="space-y-4">
              {submitted.map(item => (
                <div key={item.id} className="py-3 border-b border-gray-200 last:border-b-0">
                  <TriageSummary triage={item.triage} />
                  <p className="text-sm text-gray-900">{item.transcript}</p>
                  <div className="mt-1 flex items-center justify-between gap-3">
                    <p className="text-xs text-gray-400">{formatTime(new Date(item.created_at))}</p>
                    {item.syncStatus === 'pending' ? (
                      <button
                        type="button"
                        onClick={() => handleSendPending(item.id)}
                        className="text-xs font-medium text-amber-700 hover:text-amber-900"
                      >
                        Waiting to send
                      </button>
                    ) : (
                      <p className="text-xs text-gray-400">Sent</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {pending.length === 0 && submitted.length === 0 && !isRecording && (
          <div className="px-8 py-4 text-center text-gray-400">
            <p className="text-sm">No issue reports sent yet</p>
          </div>
        )}
      </div>
      <FloatingRecordButton onRecord={onRecord} />
    </div>
  );
}
