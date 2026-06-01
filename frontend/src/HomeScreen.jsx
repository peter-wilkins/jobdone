import { useState, useEffect, useRef } from 'react';
import { audioService } from './services/audioService';
import { dbService, validateTagLabel } from './services/dbService';
import { apiService } from './services/apiService';
import { syncService } from './services/syncService';
import { queryHistoryService } from './services/queryHistoryService';
import { preferencesService } from './services/preferencesService';
import { locationClueService } from './services/locationClueService';
import {
  contactDraftFromManualInput,
  isContactPickerSupported,
  pickContact,
  validateContactDraftForCreation,
} from './services/contactPickerService';
import {
  FRICTION_EVENTS,
  dismissContextSourcePrompt,
  getActiveContextSourcePrompts,
  recordContextSourceFriction,
} from './services/contextSourcePromptService';
import { canStrengthenLocationDraft, strengthenLocationDraftWithClue } from './services/locationStrengtheningService';
import { applyServiceWorkerUpdate, checkForAppUpdate, onServiceWorkerUpdate } from './services/serviceWorker';
import {
  getInstallState,
  listenForInstallPrompt,
  requestInstall,
} from './services/installPromptService';
import { predictionSourcePresentation } from './services/predictionSourceService';
import { formatTime } from './mockData';

// Dev toggle for query-active state testing
const SHOW_QUERY_BAR = false;
const MOCK_QUERY_TEXT = 'Show me radiator fixes from last month';
const MIN_STOP_AFTER_MS = 1000;
const MIN_RECORDING_SECONDS = 1;
const BUILD_ID = import.meta.env.VITE_DEPLOYMENT_ID || import.meta.env.VITE_BUILD_ID || 'dev';
let fastCaptureAttemptedThisRun = false;

function reviewText(entry) {
  return String([entry?.summary, entry?.transcript].filter(Boolean).join(' '))
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function containsContactName(entry, contact) {
  const name = String(contact?.displayName || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return Boolean(name) && ` ${reviewText(entry)} `.includes(` ${name} `);
}

function contactConfidenceForEntry(entry, contact) {
  if (containsContactName(entry, contact)) return 'strong';
  const firstName = String(contact?.displayName || '')
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0]
    ?.toLowerCase();
  if (firstName && ` ${reviewText(entry)} `.includes(` ${firstName} `)) return 'medium';
  return 'weak';
}

function localContactCandidate(contact, confidence = 'medium') {
  const label = String(contact.displayName || '').trim();
  if (!contact.id || !label) return null;
  return {
    id: contact.id,
    label,
    primaryPhone: contact.primaryPhone || null,
    primaryEmail: contact.primaryEmail || null,
    phones: contact.phones || [],
    emails: contact.emails || [],
    normalizedPhones: contact.normalizedPhones || [],
    normalizedEmails: contact.normalizedEmails || [],
    source: 'local_contacts',
    confidence,
    visible: confidence !== 'weak',
  };
}

function mergeCandidatesById(primary = [], secondary = []) {
  const seen = new Set();
  return [...primary, ...secondary].filter(candidate => {
    if (!candidate?.id || seen.has(candidate.id)) return false;
    seen.add(candidate.id);
    return true;
  });
}

function locationDraftFromCandidate(candidate) {
  if (!candidate) return null;
  const isContextSuggestion = candidate.source === 'device_location' || candidate.source === 'context_clue';
  return {
    id: isContextSuggestion || candidate.id?.startsWith('clue-location-') ? null : candidate.id,
    displayName: candidate.label,
    placeText: candidate.placeText || candidate.label,
    addressText: candidate.addressText || '',
    latitude: candidate.latitude ?? null,
    longitude: candidate.longitude ?? null,
    source: candidate.source || null,
  };
}

export function HomeScreen({
  onNavigate,
  user,
  refreshKey = 0,
  canAutoStart = false,
  recordRequestId = 0,
  onRecordRequestHandled,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const processingIdsRef = useRef(new Set());
  const handledRecordRequestRef = useRef(0);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const [isRecording, setIsRecording] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [isStoppingRecording, setIsStoppingRecording] = useState(false);
  const [recordingFlashActive, setRecordingFlashActive] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [entries, setEntries] = useState([]);
  const [reviewLocations, setReviewLocations] = useState({});
  const [reviewLocationDrafts, setReviewLocationDrafts] = useState({});
  const [reviewContacts, setReviewContacts] = useState({});
  const [reviewContactPanels, setReviewContactPanels] = useState({});
  const [reviewContactSearch, setReviewContactSearch] = useState({});
  const [reviewContactOptions, setReviewContactOptions] = useState({});
  const [reviewManualContacts, setReviewManualContacts] = useState({});
  const [reviewTags, setReviewTags] = useState({});
  const [reviewStructure, setReviewStructure] = useState({});
  const [reviewSelectedTags, setReviewSelectedTags] = useState({});
  const [reviewExplanationKeys, setReviewExplanationKeys] = useState({});
  const [contextSourcePrompts, setContextSourcePrompts] = useState(() => getActiveContextSourcePrompts());
  const [confirmingIds, setConfirmingIds] = useState(new Set());
  const [captureCount, setCaptureCount] = useState(0);
  const [processingIds, setProcessingIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [fastCaptureEnabled, setFastCaptureEnabled] = useState(() => preferencesService.isFastCaptureEnabled());
  const [installState, setInstallState] = useState(getInstallState);
  const [installMessage, setInstallMessage] = useState(null);
  const [foregroundReturnCount, setForegroundReturnCount] = useState(0);
  const [updateRegistration, setUpdateRegistration] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);
  const fastCaptureEnabledAtOpenRef = useRef(fastCaptureEnabled);
  const wasBackgroundedRef = useRef(document.visibilityState === 'hidden');
  const handledForegroundReturnRef = useRef(0);
  const structurePredictionRequestedRef = useRef(new Set());
  const confirmingIdsRef = useRef(new Set());

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

  const selectedPredictionCandidates = (entryId) => {
    const structure = reviewStructure[entryId] || {};
    const candidateSet = structure.candidateSet || {};
    const prediction = structure.prediction || {};
    const location = (candidateSet.locations || []).find(candidate => candidate.id === prediction.locationIds?.[0]);
    const contact = (candidateSet.contacts || []).find(candidate => candidate.id === reviewContacts[entryId]);
    const selectedTagIds = new Set(reviewSelectedTags[entryId] || []);
    const tags = (candidateSet.tags || []).filter(candidate => selectedTagIds.has(candidate.id));
    return { structure, candidateSet, prediction, location, contact, tags };
  };

  const resetContactCorrection = (entryId) => {
    setReviewContactPanels(prev => ({ ...prev, [entryId]: false }));
    setReviewContactSearch(prev => ({ ...prev, [entryId]: '' }));
    setReviewManualContacts(prev => ({ ...prev, [entryId]: { displayName: '', phone: '', email: '' } }));
  };

  const refreshContextSourcePrompts = () => {
    setContextSourcePrompts(getActiveContextSourcePrompts());
  };

  const recordSourceFriction = (event) => {
    recordContextSourceFriction(event);
    refreshContextSourcePrompts();
  };

  const handleDismissContextSourcePrompt = (promptId) => {
    dismissContextSourcePrompt(promptId);
    refreshContextSourcePrompts();
  };

  const togglePredictedTag = (entryId, tagId) => {
    setReviewSelectedTags(prev => {
      const selected = new Set(prev[entryId] || []);
      if (selected.has(tagId)) selected.delete(tagId);
      else selected.add(tagId);
      return { ...prev, [entryId]: Array.from(selected) };
    });
  };

  const candidateExplanationKey = (entryId, kind, candidate) =>
    `${entryId}:${kind}:${candidate.id || candidate.label}`;

  const toggleCandidateExplanation = (entryId, kind, candidate) => {
    const key = candidateExplanationKey(entryId, kind, candidate);
    setReviewExplanationKeys(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const renderCandidateSource = (entryId, kind, candidate, colorClass = 'text-gray-500') => {
    const presentation = predictionSourcePresentation(candidate, kind);
    const key = candidateExplanationKey(entryId, kind, candidate);
    const isOpen = Boolean(reviewExplanationKeys[key]);

    return (
      <div className="mt-1">
        <div className={`flex items-center gap-2 text-left text-xs ${colorClass}`}>
          <span>{presentation.hint}</span>
          <button
            type="button"
            onClick={() => toggleCandidateExplanation(entryId, kind, candidate)}
            aria-expanded={isOpen}
            aria-label={`Why suggested: ${candidate.label}`}
            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] font-semibold"
          >
            ?
          </button>
        </div>
        {isOpen && (
          <p className="mt-1 max-w-56 text-left text-xs leading-snug text-gray-500">
            {presentation.explanation}
          </p>
        )}
      </div>
    );
  };

  useEffect(() => {
    return onServiceWorkerUpdate((registration) => {
      setUpdateRegistration(registration);
      setUpdateStatus(null);
    });
  }, []);

  useEffect(() => listenForInstallPrompt(setInstallState), []);

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
    if (err?.code === 'empty_transcription') return 'empty_transcription';
    if (err?.name === 'AbortError' || msg === 'Failed to fetch' || msg.includes('NetworkError') || msg.includes('network'))
      return 'offline';
    return 'server';
  };

  useEffect(() => {
    const readyNotes = entries.filter(entry =>
      entry.status === 'ready_for_review' &&
      entry.intent !== 'QUERY' &&
      entry.summary &&
      !structurePredictionRequestedRef.current.has(entry.id)
    );

    for (const entry of readyNotes) {
      structurePredictionRequestedRef.current.add(entry.id);
      (async () => {
        let localMatchedContact = null;
        let localContactCandidates = [];
        try {
          const localContacts = await dbService.getContacts('confirmed');
          localContactCandidates = localContacts
            .map(contact => localContactCandidate(contact, contactConfidenceForEntry(entry, contact)))
            .filter(candidate => candidate?.visible)
            .filter(Boolean)
            .slice(0, 5);
          localMatchedContact = localContactCandidates.find(candidate => candidate.confidence === 'strong') || null;

          const contextClues = entry.captureId
            ? await dbService.getContextCluesForCapture(entry.captureId)
            : await dbService.getContextCluesForEntry(entry.id);
          const result = user && backendAvailable
            ? await apiService.predictStructure({
                entryData: {
                  summary: entry.summary,
                  transcript: entry.transcript,
                },
                contextClues,
              })
            : { candidateSet: {}, prediction: {} };
          const candidateSet = {
            ...(result.candidateSet || {}),
            contacts: mergeCandidatesById(localContactCandidates, result.candidateSet?.contacts || []),
          };
          const prediction = {
            ...(result.prediction || {}),
            contactIds: localMatchedContact
              ? [localMatchedContact.id, ...(result.prediction?.contactIds || []).filter(id => id !== localMatchedContact.id)]
              : result.prediction?.contactIds || [],
          };
          const predictedLocation = (candidateSet.locations || []).find(candidate => candidate.id === prediction.locationIds?.[0]);
          const predictedContact = (candidateSet.contacts || []).find(candidate => candidate.id === prediction.contactIds?.[0]);

          setReviewStructure(prev => ({ ...prev, [entry.id]: { candidateSet, prediction } }));
          const isDeviceLocationOnly = predictedLocation?.source === 'device_location';
          if (predictedLocation && !isDeviceLocationOnly) {
            setReviewLocations(prev => prev[entry.id] ? prev : { ...prev, [entry.id]: predictedLocation.label });
            setReviewLocationDrafts(prev => prev[entry.id] ? prev : { ...prev, [entry.id]: locationDraftFromCandidate(predictedLocation) });
          }
          if (predictedContact) {
            setReviewContacts(prev => prev[entry.id] ? prev : { ...prev, [entry.id]: predictedContact.id });
          }
          if (Array.isArray(prediction.tagIds) && prediction.tagIds.length) {
            setReviewSelectedTags(prev => prev[entry.id]?.length ? prev : { ...prev, [entry.id]: prediction.tagIds });
          }
        } catch (err) {
          console.warn('[Structure] Prediction unavailable:', err);
          if (localMatchedContact) {
            setReviewStructure(prev => ({
              ...prev,
              [entry.id]: {
                error: true,
                candidateSet: { locations: [], contacts: localContactCandidates, tags: [] },
                prediction: { contactIds: [localMatchedContact.id] },
              },
            }));
            setReviewContacts(prev => prev[entry.id] ? prev : { ...prev, [entry.id]: localMatchedContact.id });
            return;
          }
          setReviewStructure(prev => ({
            ...prev,
            [entry.id]: { error: true, candidateSet: { locations: [], contacts: [], tags: [] }, prediction: {} },
          }));
        }
      })();
    }
  }, [entries, user, backendAvailable]);

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

  const startRecording = async ({ flash = false } = {}) => {
    if (isStartingRecording || isStoppingRecording) return;

    try {
      setError(null);
      setIsStartingRecording(true);
      await audioService.startRecording();
      setIsRecording(true);
      setRecordingTime(0);
      setRecordingFlashActive(flash);
    } catch (err) {
      console.error('Recording start error:', err);
      setError(err.message);
      setIsRecording(false);
      setRecordingFlashActive(false);
      audioService.cancelRecording();
    } finally {
      setIsStartingRecording(false);
    }
  };

  useEffect(() => {
    if (!recordRequestId || handledRecordRequestRef.current === recordRequestId) return;
    if (isLoading || activeQuery || isRecording || isStartingRecording || isStoppingRecording) return;
    if (document.visibilityState !== 'visible') return;

    handledRecordRequestRef.current = recordRequestId;
    const timer = window.setTimeout(() => {
      startRecording({ flash: true });
      onRecordRequestHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordRequestId, isLoading, activeQuery, isRecording, isStartingRecording, isStoppingRecording]);

  useEffect(() => {
    const isForegroundReturn = foregroundReturnCount > handledForegroundReturnRef.current;
    const isInitialAutoStart = foregroundReturnCount === 0;

    if (!fastCaptureEnabled) return;
    if (isInitialAutoStart && !fastCaptureEnabledAtOpenRef.current) return;
    if (isInitialAutoStart && !canAutoStart) return;
    if (isInitialAutoStart && fastCaptureAttemptedThisRun) return;
    if (!isInitialAutoStart && !isForegroundReturn) return;
    if (isLoading || activeQuery || isRecording || isStartingRecording || isStoppingRecording) return;
    if (document.visibilityState !== 'visible') return;

    if (isForegroundReturn) {
      handledForegroundReturnRef.current = foregroundReturnCount;
    } else {
      fastCaptureAttemptedThisRun = true;
    }

    const timer = window.setTimeout(() => {
      startRecording({ flash: true });
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fastCaptureEnabled, canAutoStart, foregroundReturnCount, isLoading, activeQuery, isRecording, isStartingRecording, isStoppingRecording]);

  const handleFastCaptureChange = (enabled) => {
    preferencesService.setFastCaptureEnabled(enabled);
    setFastCaptureEnabled(enabled);
  };

  const handleInstall = async () => {
    setInstallMessage(null);
    const result = await requestInstall();
    if (result.mode === 'manual') {
      setInstallMessage('In Chrome, open the menu and choose Install app. You can keep using JobDone here too.');
    } else if (result.outcome === 'dismissed') {
      setInstallMessage('No problem. You can install from this menu later.');
    } else {
      setMenuOpen(false);
    }
    setInstallState(getInstallState());
  };

  const handleApplyUpdate = async () => {
    if (updateRegistration) {
      await applyServiceWorkerUpdate(updateRegistration);
      return;
    }
    window.location.reload();
  };

  const handleCheckForUpdate = async () => {
    setUpdateStatus('checking');
    try {
      const hasUpdate = await checkForAppUpdate();
      if (hasUpdate) {
        setUpdateStatus('available');
        window.location.reload();
      } else {
        setUpdateStatus('current');
      }
    } catch (err) {
      console.warn('[PWA] Update check failed:', err);
      setUpdateStatus('failed');
    }
  };

  const stopRecording = async () => {
    if (!isRecording || isStoppingRecording) return;

    try {
      setError(null);

      if (audioService.getStatus().elapsedMs < MIN_STOP_AFTER_MS) {
        return;
      }

      setIsStoppingRecording(true);
      setIsRecording(false);
      const audioData = await audioService.stopRecording();

      if (!audioData) return;

      if (audioData.duration < MIN_RECORDING_SECONDS || audioData.size === 0) {
        setError('Recording was too short. Hold the mic a little longer.');
        return;
      }

      const jobId = await dbService.createEntry(
        {
          duration: audioData.duration,
        },
        audioData.blob
      );

      try {
        const locationResult = await locationClueService.captureCurrentLocation({ allowPrompt: false });
        if (locationResult.ok) {
          await dbService.createDeviceLocationContextClue({ entryId: jobId, clue: locationResult.clue });
        }
      } catch (locationErr) {
        console.warn('[Location] Capture-time location clue unavailable:', locationErr);
      }

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
    } catch (err) {
      console.error('Recording stop error:', err);
      setError(err.message);
      setIsRecording(false);
      setRecordingFlashActive(false);
      audioService.cancelRecording();
    } finally {
      setIsStoppingRecording(false);
    }
  };

  const cancelRecording = () => {
    if (!isRecording && !isStartingRecording) return;

    try {
      setError(null);
      audioService.cancelRecording();
    } catch (err) {
      console.error('Recording cancel error:', err);
    } finally {
      setIsRecording(false);
      setIsStartingRecording(false);
      setIsStoppingRecording(false);
      setRecordingFlashActive(false);
      setRecordingTime(0);
    }
  };

  const OFFLINE_MSG = 'Recall isn\'t available right now. Try again in a moment.';
  const isOffline = () => !navigator.onLine || !backendAvailable;

  const handleConfirm = async (id) => {
    if (confirmingIdsRef.current.has(id)) return;
    confirmingIdsRef.current.add(id);
    setConfirmingIds(prev => new Set([...prev, id]));

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
      const locationText = (reviewLocations[id] || '').trim();
      const selectedLocationDraft = reviewLocationDrafts[id];
      const locations = locationText
        ? [{ ...(selectedLocationDraft || {}), displayName: locationText, placeText: selectedLocationDraft?.placeText || locationText }]
        : [];
      const { contact, tags: selectedPredictedTags } = selectedPredictionCandidates(id);
      const contacts = contact ? [{
        id: contact.id,
        displayName: contact.label,
        primaryPhone: contact.primaryPhone,
        primaryEmail: contact.primaryEmail,
        phones: contact.phones || [],
        emails: contact.emails || [],
        normalizedPhones: contact.normalizedPhones || [],
        normalizedEmails: contact.normalizedEmails || [],
      }] : [];
      const tagDrafts = [
        ...selectedPredictedTags.map(tag => ({ label: tag.label, categoryName: tag.categoryName || 'General' })),
        ...(reviewTags[id] || '').split(',').map(label => ({ label, categoryName: 'General' })),
      ]
        .map(tag => ({ ...tag, label: tag.label.trim() }))
        .filter(tag => tag.label)
        .reduce((map, tag) => map.set(tag.label.toLowerCase(), tag), new Map());
      const tagValidations = Array.from(tagDrafts.values()).map(tag => ({
        ...validateTagLabel(tag.label),
        categoryName: tag.categoryName,
      }));
      const invalidTag = tagValidations.find(result => !result.valid);
      if (invalidTag) {
        setError(invalidTag.error);
        return;
      }
      const tags = tagValidations.map(result => ({ label: result.label, categoryName: result.categoryName || 'General' }));
      const confirmedEntry = await dbService.confirmEntry(id, { locations, contacts, tags });
      let timelineEntry = { ...entry, ...confirmedEntry };
      if (!locationText) {
        recordSourceFriction(FRICTION_EVENTS.BLANK_LOCATION);
      } else if (!selectedLocationDraft) {
        recordSourceFriction(FRICTION_EVENTS.MANUAL_LOCATION);
      }

      // Try to sync to cloud (optional - don't block if it fails)
      if (timelineEntry && timelineEntry.transcript && timelineEntry.summary) {
        if (!user) {
          // Not logged in — entry saved locally, will sync when user logs in
          console.log('[Sync] Skipped — not logged in. Will retry on login.');
        } else {
          try {
            const result = await syncService.syncEntry(timelineEntry);
            if (result !== null) {
              await dbService.markEntrySynced(id, result?.entry?.id);
              await dbService.upsertCloudEntryLocations(id, result?.entry?.id, result?.entry?.locations || []);
              await dbService.upsertCloudEntryTags(id, result?.entry?.id, result?.entry?.tags || []);
              timelineEntry = {
                ...timelineEntry,
                syncStatus: 'synced',
                remoteId: result?.entry?.id || timelineEntry.remoteId,
              };
            }
          } catch (syncErr) {
            console.warn('[UI] Cloud sync failed, entry saved locally:', syncErr);
            // Don't fail the UI - entry is safe locally, will retry on next login
          }
        }
      }

      // Update UI: move to confirmed section (re-sort)
      setEntries(prev => {
        const updated = prev.map(e => e.id === id ? { ...e, ...timelineEntry, status: 'confirmed' } : e);
        const inProgress = updated.filter(e => e.status !== 'confirmed');
        const confirmed = updated.filter(e => e.status === 'confirmed').sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        return [...inProgress, ...confirmed];
      });
      setReviewLocations(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewLocationDrafts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewContacts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewContactPanels(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewContactSearch(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewContactOptions(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewManualContacts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewTags(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      console.error('Failed to confirm entry:', err);
      setError('Failed to confirm entry');
    } finally {
      confirmingIdsRef.current.delete(id);
      setConfirmingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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

  const handleClearLocalDatabase = async () => {
    setMenuOpen(false);
    const confirmed = window.confirm('Clear all local JobDone data on this device? This removes local entries, captures, contacts, tags, feedback, and query history.');
    if (!confirmed) return;

    try {
      await dbService.clearAll();
      setEntries([]);
      setCaptureCount(0);
      setRecentQueries([]);
      setActiveQuery(null);
      setQueryResults(null);
      setReviewLocations({});
      setReviewContacts({});
      setReviewContactPanels({});
      setReviewContactSearch({});
      setReviewContactOptions({});
      setReviewManualContacts({});
      setReviewTags({});
      setReviewStructure({});
      setReviewSelectedTags({});
      setError(null);
      window.location.reload();
    } catch (err) {
      console.error('Failed to clear local database:', err);
      setError('Failed to clear local database');
    }
  };

  const addLocationCandidateForEntry = (entryId, candidate) => {
    setReviewStructure(prev => {
      const current = prev[entryId] || {};
      const candidateSet = current.candidateSet || {};
      return {
        ...prev,
        [entryId]: {
          ...current,
          candidateSet: {
            locations: mergeCandidatesById([candidate], candidateSet.locations || []),
            contacts: candidateSet.contacts || [],
            tags: candidateSet.tags || [],
          },
          prediction: current.prediction || {},
        },
      };
    });
  };

  const addContactCandidateForEntry = (entryId, candidate) => {
    setReviewStructure(prev => {
      const current = prev[entryId] || {};
      const candidateSet = current.candidateSet || {};
      return {
        ...prev,
        [entryId]: {
          ...current,
          candidateSet: {
            locations: candidateSet.locations || [],
            contacts: mergeCandidatesById([candidate], candidateSet.contacts || []),
            tags: candidateSet.tags || [],
          },
          prediction: current.prediction || {},
        },
      };
    });
  };

  const loadContactOptions = async (entryId, query = '') => {
    try {
      const contacts = query.trim()
        ? await dbService.searchContacts(query)
        : await dbService.getContacts('confirmed');
      setReviewContactOptions(prev => ({
        ...prev,
        [entryId]: contacts.map(localContactCandidate).filter(Boolean).slice(0, 8),
      }));
    } catch (err) {
      console.error('Failed to load Contacts for review:', err);
      setError('Failed to load Contacts');
    }
  };

  const openContactCorrection = async (entryId) => {
    recordSourceFriction(FRICTION_EVENTS.CONTACT_CORRECTION);
    setReviewContactPanels(prev => ({ ...prev, [entryId]: true }));
    setReviewManualContacts(prev => ({
      ...prev,
      [entryId]: prev[entryId] || { displayName: '', phone: '', email: '' },
    }));
    await loadContactOptions(entryId, reviewContactSearch[entryId] || '');
  };

  const selectReviewContactCandidate = (entryId, candidate) => {
    addContactCandidateForEntry(entryId, candidate);
    setReviewContacts(prev => ({ ...prev, [entryId]: candidate.id }));
    resetContactCorrection(entryId);
  };

  const handleContactSearchChange = async (entryId, value) => {
    setReviewContactSearch(prev => ({ ...prev, [entryId]: value }));
    await loadContactOptions(entryId, value);
  };

  const handlePickNativeContact = async (entryId) => {
    try {
      setError(null);
      const result = await pickContact();
      if (!result.ok) {
        setError(result.reason === 'unsupported' ? 'Contact Picker is unavailable on this device.' : 'No Contact was selected.');
        return;
      }

      const savedContact = await dbService.upsertContact(result.contact);
      const candidate = localContactCandidate(savedContact);
      if (!candidate) {
        setError('Could not use selected Contact');
        return;
      }
      selectReviewContactCandidate(entryId, candidate);
    } catch (err) {
      console.error('Failed to pick Contact:', err);
      setError('Could not pick Contact');
    }
  };

  const handleCreateManualContact = async (entryId) => {
    try {
      setError(null);
      const draft = contactDraftFromManualInput(reviewManualContacts[entryId]);
      const validation = validateContactDraftForCreation(draft);
      if (!validation.valid) {
        setError(validation.error);
        return;
      }

      const savedContact = await dbService.upsertContact(draft);
      const candidate = localContactCandidate(savedContact);
      if (!candidate) {
        setError('Could not create Contact');
        return;
      }
      selectReviewContactCandidate(entryId, candidate);
    } catch (err) {
      console.error('Failed to create Contact:', err);
      setError('Could not create Contact');
    }
  };

  const handleUseCurrentLocation = async (entry) => {
    try {
      setError(null);
      const result = await locationClueService.captureCurrentLocation({ allowPrompt: true });
      if (!result.ok) {
        setError('Current location is unavailable right now.');
        return;
      }

      const clue = await dbService.createDeviceLocationContextClue({ entryId: entry.id, clue: result.clue });
      addLocationCandidateForEntry(entry.id, {
        id: clue.id,
        label: clue.payload.locationText || 'Current location',
        placeText: clue.payload.locationText || 'Current location',
        latitude: clue.payload.latitude ?? null,
        longitude: clue.payload.longitude ?? null,
        source: 'device_location',
      });
    } catch (err) {
      console.error('Failed to use current location:', err);
      setError('Current location is unavailable right now.');
    }
  };

  const handleStrengthenLocationHere = async (entry) => {
    const selectedDraft = reviewLocationDrafts[entry.id];
    if (!canStrengthenLocationDraft(selectedDraft)) return;

    try {
      setError(null);
      const result = await locationClueService.captureCurrentLocation({ allowPrompt: true });
      if (!result.ok) {
        setError('Current location is unavailable right now.');
        return;
      }

      const clue = await dbService.createDeviceLocationContextClue({ entryId: entry.id, clue: result.clue });
      const strengthenedDraft = strengthenLocationDraftWithClue(selectedDraft, clue);
      setReviewLocationDrafts(prev => ({ ...prev, [entry.id]: strengthenedDraft }));
      addLocationCandidateForEntry(entry.id, {
        id: selectedDraft.id,
        label: selectedDraft.displayName,
        placeText: selectedDraft.placeText || selectedDraft.displayName,
        addressText: selectedDraft.addressText || '',
        latitude: strengthenedDraft.latitude,
        longitude: strengthenedDraft.longitude,
        source: selectedDraft.source || 'location_history',
      });
    } catch (err) {
      console.error('Failed to strengthen Location:', err);
      setError('Current location is unavailable right now.');
    }
  };

  const handleContextSourcePromptAction = async (prompt, entry) => {
    if (prompt.id === 'location') {
      await handleUseCurrentLocation(entry);
      return;
    }
    if (prompt.id === 'contact') {
      if (isContactPickerSupported()) {
        await handlePickNativeContact(entry.id);
      } else {
        await openContactCorrection(entry.id);
      }
    }
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
      const localEntriesByRemoteId = new Map(
        entries
          .filter(entry => entry.remoteId)
          .map(entry => [entry.remoteId, entry])
      );
      const enrichedResults = results.map(result => {
        const localEntry = localEntriesByRemoteId.get(result.remoteId || result.id);
        if (!localEntry) return result;

        return {
          ...result,
          locationSnapshots: result.locationSnapshots || localEntry.locationSnapshots,
          contactSnapshots: result.contactSnapshots || localEntry.contactSnapshots,
          tagSnapshots: result.tagSnapshots || localEntry.tagSnapshots,
          syncStatus: result.syncStatus || localEntry.syncStatus,
        };
      });
      setActiveQuery(text);
      setQueryResults(enrichedResults);
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
    const markForegroundReturn = () => {
      if (!wasBackgroundedRef.current || document.visibilityState !== 'visible') return;
      wasBackgroundedRef.current = false;
      setForegroundReturnCount(count => count + 1);
    };
    const handlePossibleReconnect = () => {
      refreshBackendStatus().catch(err => {
        console.warn('[Online] Backend refresh failed:', err);
      });
    };
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        wasBackgroundedRef.current = true;
        return;
      }
      markForegroundReturn();
      handlePossibleReconnect();
    };
    const handlePageHide = () => {
      wasBackgroundedRef.current = true;
    };
    const handlePageShow = () => {
      markForegroundReturn();
      handlePossibleReconnect();
    };

    window.addEventListener('online', handlePossibleReconnect);
    window.addEventListener('focus', handlePossibleReconnect);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('pageshow', handlePageShow);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('online', handlePossibleReconnect);
      window.removeEventListener('focus', handlePossibleReconnect);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
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

  useEffect(() => {
    if (!recordingFlashActive) return;
    const timer = window.setTimeout(() => {
      setRecordingFlashActive(false);
    }, 1600);
    return () => window.clearTimeout(timer);
  }, [recordingFlashActive]);

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

    if (isStartingRecording) {
      return (
        <div className="flex items-center justify-center px-4 h-12">
          <div className="flex items-center gap-2">
            <div className="animate-spin h-4 w-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            <span className="text-sm text-gray-600">Starting recording...</span>
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
    if (isStartingRecording || isStoppingRecording) return 'bg-blue-500';
    if (isRecording) return 'bg-red-500';
    const hasInProgress = entries.some(e => e.status !== 'confirmed');
    if (hasInProgress) return 'bg-green-500';
    return 'bg-gray-500';
  };

  const renderEntry = (entry) => {
    const isProcessing = processingIds.has(entry.id);
    const primaryLocation = Array.isArray(entry.locationSnapshots) && entry.locationSnapshots.length > 0
      ? entry.locationSnapshots[0]
      : null;
    const primaryContact = Array.isArray(entry.contactSnapshots) && entry.contactSnapshots.length > 0
      ? entry.contactSnapshots[0]
      : null;
    const entryTags = Array.isArray(entry.tagSnapshots) && entry.tagSnapshots.length > 0
      ? entry.tagSnapshots
      : [];

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
      const isEmptyTranscription = entry.errorMessage === 'empty_transcription';
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
              : isEmptyTranscription
                ? 'No speech detected. Try recording again.'
              : 'Something went wrong while processing this recording.'}
          </p>
          <div className="flex gap-3">
            {!isEmptyTranscription && (
              <button
                onClick={() => handleRetry(entry.id)}
                className="flex-1 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 transition"
              >
                Retry processing
              </button>
            )}
            <button
              onClick={() => handleReject(entry.id)}
              className={`${isEmptyTranscription ? 'w-full' : 'flex-1'} px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition`}
            >
              {isEmptyTranscription ? 'Dismiss' : 'Discard'}
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
      const { structure, candidateSet, contact: selectedContact } = selectedPredictionCandidates(entry.id);
      const locationCandidates = candidateSet.locations || [];
      const selectedLocationDraft = reviewLocationDrafts[entry.id];
      const canStrengthenSelectedLocation = canStrengthenLocationDraft(selectedLocationDraft);
      const contactCandidates = candidateSet.contacts || [];
      const contactPanelOpen = Boolean(reviewContactPanels[entry.id]);
      const contactOptions = reviewContactOptions[entry.id] || [];
      const contactSearch = reviewContactSearch[entry.id] || '';
      const manualContact = reviewManualContacts[entry.id] || { displayName: '', phone: '', email: '' };
      const isConfirming = confirmingIds.has(entry.id);
      const tagCandidates = candidateSet.tags || [];
      const selectedTagIds = new Set(reviewSelectedTags[entry.id] || []);
      const tagGroups = tagCandidates.reduce((groups, tag) => {
        const category = tag.categoryName || 'General';
        groups[category] = groups[category] || [];
        groups[category].push(tag);
        return groups;
      }, {});

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
              {contextSourcePrompts.length > 0 && (
                <div className="mb-3 space-y-2">
                  {contextSourcePrompts.map(prompt => (
                    <div key={prompt.id} className="rounded border border-blue-100 bg-blue-50 px-3 py-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-blue-900">{prompt.title}</p>
                          <p className="mt-1 text-xs leading-snug text-blue-700">{prompt.body}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDismissContextSourcePrompt(prompt.id)}
                          className="shrink-0 text-xs text-blue-500 underline"
                        >
                          Dismiss
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleContextSourcePromptAction(prompt, entry)}
                        disabled={prompt.disabled}
                        className="mt-2 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:bg-gray-200 disabled:text-gray-500"
                      >
                        {prompt.action}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mb-3 flex flex-wrap gap-2">
                {reviewLocations[entry.id] ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReviewLocations(prev => ({ ...prev, [entry.id]: '' }));
                      setReviewLocationDrafts(prev => {
                        const next = { ...prev };
                        delete next[entry.id];
                        return next;
                      });
                    }}
                    className="inline-flex max-w-full items-center rounded bg-emerald-50 px-2.5 py-1 text-sm font-medium text-emerald-700"
                  >
                    <span className="truncate">{reviewLocations[entry.id]}</span>
                    <span className="ml-1 text-emerald-500">x</span>
                  </button>
                ) : (
                  <span className="inline-flex items-center rounded border border-dashed border-emerald-300 px-2.5 py-1 text-sm text-emerald-700">
                    + Location
                  </span>
                )}
                {selectedContact ? (
                  <button
                    type="button"
                    onClick={() => {
                      setReviewContacts(prev => ({ ...prev, [entry.id]: null }));
                      openContactCorrection(entry.id);
                    }}
                    className="inline-flex max-w-full items-center rounded bg-violet-50 px-2.5 py-1 text-sm font-medium text-violet-700"
                  >
                    <span className="truncate">{selectedContact.label}</span>
                    <span className="ml-1 text-violet-500">x</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openContactCorrection(entry.id)}
                    className="inline-flex items-center rounded border border-dashed border-violet-300 px-2.5 py-1 text-sm text-violet-700"
                  >
                    + Contact
                  </button>
                )}
              </div>

              <label className="block">
                <span className="text-sm text-gray-500">Location</span>
                <input
                  type="text"
                  value={reviewLocations[entry.id] || ''}
                  onChange={(event) => {
                    setReviewLocations(prev => ({ ...prev, [entry.id]: event.target.value }));
                    setReviewLocationDrafts(prev => {
                      const next = { ...prev };
                      delete next[entry.id];
                      return next;
                    });
                  }}
                  placeholder="+ Location"
                  className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
                />
              </label>
              {locationCandidates.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {locationCandidates.map(candidate => (
                    <div
                      key={candidate.id}
                      className="shrink-0 rounded border border-emerald-200 bg-white px-2.5 py-1 text-emerald-700"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setReviewLocations(prev => ({ ...prev, [entry.id]: candidate.label }));
                          setReviewLocationDrafts(prev => ({ ...prev, [entry.id]: locationDraftFromCandidate(candidate) }));
                        }}
                        className="block max-w-56 text-left text-sm font-medium"
                      >
                        <span className="block truncate">{candidate.label}</span>
                      </button>
                      {renderCandidateSource(entry.id, 'location', candidate, 'text-emerald-600')}
                    </div>
                  ))}
                </div>
              )}
              {canStrengthenSelectedLocation && (
                <div className="mt-2 rounded border border-emerald-100 bg-emerald-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-emerald-900">Are you here now?</p>
                    <button
                      type="button"
                      onClick={() => handleStrengthenLocationHere(entry)}
                      className="shrink-0 rounded bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700 transition"
                    >
                      Add map pin
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-emerald-700">This will save today&apos;s location to {selectedLocationDraft.displayName} when you confirm.</p>
                </div>
              )}
              {!reviewLocations[entry.id] && (
                <button
                  type="button"
                  onClick={() => handleUseCurrentLocation(entry)}
                  className="mt-2 text-sm text-emerald-700 underline"
                >
                  Use current location for suggestions
                </button>
              )}

              <div className="mt-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm text-gray-500">Contact</span>
                  <button
                    type="button"
                    onClick={() => openContactCorrection(entry.id)}
                    className="text-sm text-violet-700 underline"
                  >
                    {selectedContact ? 'Change Contact' : '+ Contact'}
                  </button>
                </div>
                {contactCandidates.length > 0 ? (
                  <div className="mt-1 flex gap-2 overflow-x-auto pb-1">
                    {contactCandidates.map(candidate => (
                      <div
                        key={candidate.id}
                        className={`shrink-0 rounded border bg-white px-2.5 py-1 ${
                          reviewContacts[entry.id] === candidate.id
                            ? 'border-violet-300 bg-violet-50 text-violet-700'
                            : 'border-gray-200 text-gray-700'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setReviewContacts(prev => ({ ...prev, [entry.id]: candidate.id }))}
                          className="block max-w-56 text-left text-sm font-medium"
                        >
                          <span className="block truncate">{candidate.label}</span>
                        </button>
                        {renderCandidateSource(entry.id, 'contact', candidate, 'text-violet-600')}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-gray-400">No Contact selected. This is fine if none applies.</p>
                )}
                {contactPanelOpen && (
                  <div className="mt-3 rounded border border-violet-100 bg-violet-50/30 p-3">
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={contactSearch}
                        onChange={(event) => handleContactSearchChange(entry.id, event.target.value)}
                        placeholder="Search saved Contacts"
                        className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-violet-500"
                      />
                      <button
                        type="button"
                        onClick={() => resetContactCorrection(entry.id)}
                        className="rounded border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600"
                      >
                        Close
                      </button>
                    </div>

                    {contactOptions.length > 0 && (
                      <div className="mt-2 max-h-36 overflow-y-auto rounded border border-white bg-white">
                        {contactOptions.map(candidate => (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() => selectReviewContactCandidate(entry.id, candidate)}
                            className="block w-full border-b border-gray-100 px-3 py-2 text-left text-sm text-gray-800 last:border-b-0 hover:bg-violet-50"
                          >
                            <span className="block font-medium">{candidate.label}</span>
                            {(candidate.primaryPhone || candidate.primaryEmail) && (
                              <span className="block text-xs text-gray-400">{candidate.primaryPhone || candidate.primaryEmail}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handlePickNativeContact(entry.id)}
                        disabled={!isContactPickerSupported()}
                        className="rounded bg-violet-600 px-3 py-2 text-sm font-medium text-white disabled:bg-gray-200 disabled:text-gray-500"
                      >
                        Pick from phone
                      </button>
                      {!isContactPickerSupported() && (
                        <span className="self-center text-xs text-gray-500">Phone picker unavailable here.</span>
                      )}
                    </div>

                    <div className="mt-3 grid gap-2">
                      <input
                        type="text"
                        value={manualContact.displayName}
                        onChange={(event) => setReviewManualContacts(prev => ({
                          ...prev,
                          [entry.id]: { ...(prev[entry.id] || {}), displayName: event.target.value },
                        }))}
                        placeholder="New Contact name"
                        className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-violet-500"
                      />
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input
                          type="tel"
                          value={manualContact.phone}
                          onChange={(event) => setReviewManualContacts(prev => ({
                            ...prev,
                            [entry.id]: { ...(prev[entry.id] || {}), phone: event.target.value },
                          }))}
                          placeholder="Phone"
                          className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-violet-500"
                        />
                        <input
                          type="email"
                          value={manualContact.email}
                          onChange={(event) => setReviewManualContacts(prev => ({
                            ...prev,
                            [entry.id]: { ...(prev[entry.id] || {}), email: event.target.value },
                          }))}
                          placeholder="Email"
                          className="rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-violet-500"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCreateManualContact(entry.id)}
                        className="justify-self-start rounded border border-violet-200 bg-white px-3 py-2 text-sm font-medium text-violet-700"
                      >
                        Create Contact
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3">
                <span className="text-sm text-gray-500">Tags</span>
                {structure.error && (
                  <p className="mt-1 text-xs text-gray-400">Suggestions unavailable.</p>
                )}
                {Object.entries(tagGroups).map(([category, tags]) => (
                  <div key={category} className="mt-2">
                    <p className="mb-1 text-xs font-medium text-gray-400">{category}</p>
                    <div className="flex flex-wrap gap-2">
                      {tags.map(tag => (
                        <div
                          key={tag.id}
                          className={`rounded px-2.5 py-1 ${
                            selectedTagIds.has(tag.id)
                              ? 'bg-sky-50 text-sky-700'
                              : 'border border-gray-200 text-gray-700'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => togglePredictedTag(entry.id, tag.id)}
                            className="block max-w-56 text-left text-sm font-medium"
                          >
                            <span className="block truncate">
                              {tag.label}{selectedTagIds.has(tag.id) ? ' x' : ''}
                            </span>
                          </button>
                          {renderCandidateSource(entry.id, 'tag', tag, 'text-sky-600')}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <input
                  type="text"
                  value={reviewTags[entry.id] || ''}
                  onChange={(event) => setReviewTags(prev => ({ ...prev, [entry.id]: event.target.value }))}
                  placeholder="+ Custom Tag"
                  className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}
          
          {/* Intent toggle */}
          <button
            onClick={toggleIntent}
            disabled={isConfirming}
            className="text-sm text-blue-600 underline mb-4 hover:text-blue-800 transition disabled:text-gray-400 disabled:no-underline"
          >
            {isQuery ? 'Save as note instead' : 'Search instead'}
          </button>
          
          {isConfirming && (
            <div className="mb-3 flex items-center gap-2 rounded bg-blue-50 px-3 py-2 text-sm text-blue-700">
              <span className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <span>{isQuery ? 'Starting search...' : user ? 'Saving and syncing...' : 'Saving locally...'}</span>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={() => handleConfirm(entry.id)}
              disabled={isConfirming}
              className="flex-1 px-4 py-2 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 transition disabled:cursor-not-allowed disabled:bg-blue-300"
            >
              {isConfirming ? (
                <span className="inline-flex items-center justify-center gap-2">
                  <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  {isQuery ? 'Searching...' : 'Confirming...'}
                </span>
              ) : (
                isQuery ? 'Search' : 'Confirm'
              )}
            </button>
            <button
              onClick={() => handleReject(entry.id)}
              disabled={isConfirming}
              className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
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
        {primaryLocation && (
          <div className="mt-2">
            <span className="inline-flex max-w-full items-center rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              <span className="truncate">{primaryLocation.displayName || primaryLocation.placeText}</span>
            </span>
          </div>
        )}
        {primaryContact && (
          <div className="mt-2">
            <span className="inline-flex max-w-full items-center rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
              <span className="truncate">{primaryContact.displayName}</span>
            </span>
          </div>
        )}
        {entryTags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entryTags.map(tag => (
              <span key={tag.id || tag.label} className="inline-flex max-w-full items-center rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                <span className="truncate">{tag.label}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderLocationPill = (entry) => {
    const primaryLocation = Array.isArray(entry.locationSnapshots) && entry.locationSnapshots.length > 0
      ? entry.locationSnapshots[0]
      : Array.isArray(entry.locations) && entry.locations.length > 0
        ? {
            displayName: entry.locations[0].display_name || entry.locations[0].displayName,
            placeText: entry.locations[0].place_text || entry.locations[0].placeText,
          }
        : null;

    if (!primaryLocation) return null;

    return (
      <div className="mt-2">
        <span className="inline-flex max-w-full items-center rounded bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
          <span className="truncate">{primaryLocation.displayName || primaryLocation.placeText}</span>
        </span>
      </div>
    );
  };

  const renderContactPill = (entry) => {
    const primaryContact = Array.isArray(entry.contactSnapshots) && entry.contactSnapshots.length > 0
      ? entry.contactSnapshots[0]
      : Array.isArray(entry.contacts) && entry.contacts.length > 0
        ? {
            displayName: entry.contacts[0].display_name || entry.contacts[0].displayName || entry.contacts[0].label,
          }
        : null;

    if (!primaryContact?.displayName) return null;

    return (
      <div className="mt-2">
        <span className="inline-flex max-w-full items-center rounded bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">
          <span className="truncate">{primaryContact.displayName}</span>
        </span>
      </div>
    );
  };

  const renderTagPills = (entry) => {
    const tags = Array.isArray(entry.tagSnapshots) && entry.tagSnapshots.length > 0
      ? entry.tagSnapshots
      : Array.isArray(entry.tags) && entry.tags.length > 0
        ? entry.tags.map(tag => ({
            id: tag.local_id || tag.localId || tag.id,
            label: tag.label,
            categoryName: tag.category_name || tag.categoryName || tag.tag_categories?.name || 'General',
          }))
        : [];

    if (!tags.length) return null;

    return (
      <div className="mt-2 flex flex-wrap gap-1.5">
        {tags.map(tag => (
          <span key={tag.id || tag.label} className="inline-flex max-w-full items-center rounded bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
            <span className="truncate">{tag.label}</span>
          </span>
        ))}
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
      {isRecording && (
        <div
          className="fixed inset-0 pointer-events-none z-40 bg-red-500/10"
          aria-hidden="true"
          style={recordingFlashActive ? { animation: 'recording-start-flash 1.6s ease-out' } : undefined}
        />
      )}

      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-light text-gray-900 leading-5">JobDone</h1>
          <p className="text-[10px] leading-4 text-gray-400 font-mono">build {BUILD_ID}</p>
        </div>
        
        {/* Recording timer in header */}
        {(isRecording || isStartingRecording) && (
          <div className="flex items-center gap-2">
            <span className={`${isRecording ? 'bg-red-500' : 'bg-blue-500'} w-2 h-2 rounded-full animate-pulse`} />
            {isRecording ? (
              <span className="text-sm font-medium text-gray-900">
                {Math.floor(recordingTime / 60)}:{String(recordingTime % 60).padStart(2, '0')}
              </span>
            ) : (
              <span className="text-sm font-medium text-gray-900">Starting...</span>
            )}
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
              {installState.canShowAction && (
                <div className="border-t border-gray-100">
                  <button
                    onClick={handleInstall}
                    className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
                  >
                    Install JobDone
                  </button>
                  {installMessage && (
                    <p className="px-4 pb-3 text-xs leading-5 text-gray-500">{installMessage}</p>
                  )}
                </div>
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
                onClick={() => { setMenuOpen(false); onNavigate('contacts'); }}
                className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                Contacts
              </button>
              <button
                onClick={() => { setMenuOpen(false); onNavigate('locations'); }}
                className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                Locations
              </button>
              <button
                onClick={() => { setMenuOpen(false); onNavigate('feedback'); }}
                className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                Report issue
              </button>
              <label className="flex items-start gap-3 px-4 py-3 border-t border-gray-100 text-sm text-gray-700 hover:bg-gray-50 transition cursor-pointer">
                <input
                  type="checkbox"
                  checked={fastCaptureEnabled}
                  onChange={(event) => handleFastCaptureChange(event.target.checked)}
                  className="mt-0.5 h-4 w-4"
                />
                <span>
                  <span className="block font-medium">Fast Capture on this device</span>
                  <span className="block text-xs text-gray-400 mt-0.5">Start recording when this device opens JobDone or returns to it</span>
                </span>
              </label>
              <button
                onClick={() => { setMenuOpen(false); handleCheckForUpdate(); }}
                className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                Check for update
              </button>
              <button
                onClick={handleClearLocalDatabase}
                className="w-full text-left px-4 py-3 text-sm text-red-700 hover:bg-red-50 transition border-t border-gray-100"
              >
                Clear local database
              </button>
              {user && (
                <button
                  onClick={() => { setMenuOpen(false); onNavigate('login'); }}
                  className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
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

      {(updateRegistration || updateStatus) && (
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-4">
          <p className="text-sm text-amber-800">
            {updateRegistration || updateStatus === 'available'
              ? 'Update available.'
              : updateStatus === 'checking'
                ? 'Checking for update...'
                : updateStatus === 'failed'
                  ? 'Could not check for update.'
                  : 'App is up to date.'}
          </p>
          {(updateRegistration || updateStatus === 'available') && (
            <button
              onClick={handleApplyUpdate}
              className="text-sm font-medium text-amber-900 underline shrink-0"
            >
              Reload
            </button>
          )}
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
                    {renderLocationPill(entry)}
                    {renderContactPill(entry)}
                    {renderTagPills(entry)}
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

      {isRecording ? (
        <div className="fixed bottom-6 right-6 flex items-center gap-3 z-50">
          <button
            onClick={cancelRecording}
            className="w-12 h-12 flex items-center justify-center bg-gray-500 text-white rounded-full shadow-lg hover:opacity-90 transition"
            title="Cancel recording"
            disabled={isStoppingRecording}
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
          <button
            onClick={stopRecording}
            className="w-14 h-14 flex items-center justify-center bg-red-500 text-white rounded-full shadow-lg hover:opacity-90 transition disabled:opacity-70"
            title="Stop and review"
            disabled={isStoppingRecording}
          >
            {isStoppingRecording ? (
              <span className="w-7 h-7 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            )}
          </button>
        </div>
      ) : (
        <button
          onClick={startRecording}
          className={`fixed bottom-6 right-6 w-14 h-14 flex items-center justify-center ${getMicColorClass()} text-white rounded-full shadow-lg hover:opacity-90 transition z-50`}
          title={isStartingRecording ? 'Starting recording' : 'Start recording'}
          disabled={isLoading || isStartingRecording || isStoppingRecording}
        >
          {isStartingRecording || isStoppingRecording ? (
            <span className="w-7 h-7 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-7 h-7" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
