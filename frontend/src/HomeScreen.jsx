import { useState, useEffect, useMemo, useRef } from 'react';
import { audioService } from './services/audioService';
import { dbService, validateTagLabel } from './services/dbService';
import { apiService } from './services/apiService';
import { syncService } from './services/syncService';
import { queryHistoryService } from './services/queryHistoryService';
import { preferencesService } from './services/preferencesService';
import { locationClueService } from './services/locationClueService';
import { useOutsideDismiss } from './services/outsideDismissService';
import { captureContextService } from './services/captureContextService';
import { recallLocalEntries } from './services/localRecallService';
import {
  contactDraftFromManualInput,
  isContactPickerSupported,
  pickContact,
  validateContactDraftForCreation,
} from './services/contactPickerService';
import { canStrengthenLocationDraft, strengthenLocationDraftWithClue } from './services/locationStrengtheningService';
import { applyServiceWorkerUpdate, onServiceWorkerUpdate } from './services/serviceWorker';
import { predictionSourcePresentation } from './services/predictionSourceService';
import { runPreExtraction } from './services/preExtractionService';
import { classify } from './services/classifyService';
import { setAppUpdateGuard } from './services/appUpdateGuardService';
import {
  canAddMorePhotos,
  createPendingPhotoAttachmentsFromFiles,
  formatAttachmentBytes,
  hasFailedPhotoAttachments,
  hasPendingPhotoAttachments,
  MAX_PHOTOS_PER_CAPTURE,
  preparePhotoAttachment,
} from './services/photoAttachmentService';
import {
  getSuccessfulCaptureCount,
  getLocalTranscriptionMetrics,
  maybePreloadWhisperModel,
  recordTranscriptionChoice,
  recordSuccessfulTranscription,
  shouldRaceBackendTranscription,
  tryLocalTranscribeAudio,
} from './services/localTranscriptionService';
import { GlobalMenu } from './GlobalMenu';
import { formatTime } from './mockData';

// Dev toggle for query-active state testing
const SHOW_QUERY_BAR = false;
const MOCK_QUERY_TEXT = 'Show me radiator fixes from last month';
const MIN_STOP_AFTER_MS = 1000;
const MIN_RECORDING_SECONDS = 1;
const BACKEND_FIRST_LOCAL_DELAY_MS = 750;
const BUILD_ID = import.meta.env.VITE_DEPLOYMENT_ID || import.meta.env.VITE_BUILD_ID || 'dev';
const ENABLE_TRANSCRIPTION_CAPTURE = import.meta.env.VITE_ENABLE_TRANSCRIPTION_CAPTURE === 'true';
let fastCaptureAttemptedThisRun = false;

function reviewText(entry) {
  return String([entry?.summary, entry?.transcript].filter(Boolean).join(' '))
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function textEditDistance(left = '', right = '') {
  const a = String(left);
  const b = String(right);
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function transcriptionSourceLabel(source) {
  if (source === 'backend') return 'Backend';
  if (source === 'local') return 'Local';
  return source || 'Unknown';
}

function PhotoAttachmentThumb({ attachment }) {
  const blob = attachment?.blob || attachment?.originalBlob;
  const url = useMemo(() => blob ? URL.createObjectURL(blob) : '', [blob]);

  useEffect(() => {
    if (!url) return undefined;
    return () => URL.revokeObjectURL(url);
  }, [url]);

  if (!url) {
    return (
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border border-gray-200 bg-gray-50 text-xs text-gray-400">
        Photo
      </div>
    );
  }

  return (
    <img
      src={url}
      alt={attachment.originalName || 'Photo attachment'}
      className="h-16 w-16 shrink-0 rounded border border-gray-200 object-cover"
    />
  );
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

function localLocationCandidate(location) {
  const label = String(location.displayName || location.display_name || location.placeText || location.addressText || '').trim();
  if (!location.id || !label) return null;
  return {
    id: location.id,
    label,
    displayName: label,
    placeText: location.placeText || location.place_text || label,
    addressText: location.addressText || location.address_text || '',
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    source: 'local_locations',
  };
}

function localTagCandidate(tag) {
  const label = String(tag.label || tag.name || '').trim();
  if (!tag.id || !label) return null;
  return {
    id: tag.id,
    label,
    categoryId: tag.categoryId || tag.category_id || null,
    categoryName: tag.categoryName || tag.category_name || 'General',
    source: 'local_tags',
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

function suggestionIdsToPreselect(suggestions = [], { keywordThreshold = null } = {}) {
  return suggestions
    .filter(candidate =>
      !candidate.ambiguous &&
      (
        candidate.reason === 'exact_name_match' ||
        (keywordThreshold != null && candidate.reason === 'keyword_match' && candidate.score >= keywordThreshold)
      )
    )
    .map(candidate => candidate.id)
    .filter(Boolean);
}

function mergeIds(primary = [], secondary = []) {
  const seen = new Set();
  return [...primary, ...secondary].filter(id => {
    if (!id || seen.has(id)) return false;
    seen.add(id);
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

function workContextLabel(item) {
  return String(item?.description || item?.title || 'Backlog Item').trim();
}

function workContextTeamLabel(item) {
  return item?.team?.name || item?.teamName || 'Team';
}

function workContextSnapshot(item) {
  return {
    id: item.id,
    type: 'backlog_item',
    label: workContextLabel(item),
    description: item.description || item.title || '',
    teamId: item.team?.id || item.team_id || null,
    teamName: workContextTeamLabel(item),
    status: item.status || null,
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
  const processingIdsRef = useRef(new Set());
  const handledRecordRequestRef = useRef(0);

  const [isRecording, setIsRecording] = useState(false);
  const [isStartingRecording, setIsStartingRecording] = useState(false);
  const [isStoppingRecording, setIsStoppingRecording] = useState(false);
  const [recordingFlashActive, setRecordingFlashActive] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [entries, setEntries] = useState([]);
  const [reviewLocations, setReviewLocations] = useState({});
  const [reviewLocationErrors, setReviewLocationErrors] = useState({});
  const [reviewLocationPanels, setReviewLocationPanels] = useState({});
  const [reviewLocationDrafts, setReviewLocationDrafts] = useState({});
  const [reviewContacts, setReviewContacts] = useState({});
  const [reviewContactErrors, setReviewContactErrors] = useState({});
  const [reviewContactPanels, setReviewContactPanels] = useState({});
  const [reviewContactSearch, setReviewContactSearch] = useState({});
  const [reviewContactOptions, setReviewContactOptions] = useState({});
  const [reviewManualContacts, setReviewManualContacts] = useState({});
  const [reviewTags, setReviewTags] = useState({});
  const [reviewStructure, setReviewStructure] = useState({});
  const [reviewSelectedTags, setReviewSelectedTags] = useState({});
  const [reviewWorkContextPanels, setReviewWorkContextPanels] = useState({});
  const [reviewSelectedWorkContexts, setReviewSelectedWorkContexts] = useState({});
  const [reviewWorkContextErrors, setReviewWorkContextErrors] = useState({});
  const [reviewAttachmentErrors, setReviewAttachmentErrors] = useState({});
  const [reviewNewWorkDescriptions, setReviewNewWorkDescriptions] = useState({});
  const [reviewNewWorkTeamIds, setReviewNewWorkTeamIds] = useState({});
  const [reviewTextDrafts, setReviewTextDrafts] = useState({});
  const [debouncedReviewTextDrafts, setDebouncedReviewTextDrafts] = useState({});
  const [reviewIntentOverrides, setReviewIntentOverrides] = useState({});
  const [focusEntryId, setFocusEntryId] = useState(null);
  const [busyWorkContextIds, setBusyWorkContextIds] = useState(new Set());
  const [teamWorkContext, setTeamWorkContext] = useState({ hasTeams: false, teams: [], claimedItems: [], openBacklogItems: [] });
  const [reviewExplanationKeys, setReviewExplanationKeys] = useState({});
  const [confirmingIds, setConfirmingIds] = useState(new Set());
  const [processingIds, setProcessingIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [fastCaptureEnabled] = useState(() => preferencesService.isFastCaptureEnabled());
  const [captureContext] = useState(() => captureContextService.get());
  const [, setLocalTranscriptionMetrics] = useState(() => getLocalTranscriptionMetrics());
  const [, setSuccessfulCaptureCount] = useState(0);
  const [foregroundReturnCount, setForegroundReturnCount] = useState(0);
  const [updateRegistration, setUpdateRegistration] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);
  const fastCaptureEnabledAtOpenRef = useRef(fastCaptureEnabled);
  const wasBackgroundedRef = useRef(document.visibilityState === 'hidden');
  const handledForegroundReturnRef = useRef(0);
  const localTranscriptionPreloadAttemptedRef = useRef(false);
  const structurePredictionRequestedRef = useRef(new Set());
  const preExtractionFingerprintsRef = useRef(new Map());
  const confirmingIdsRef = useRef(new Set());
  const textAreaRefs = useRef(new Map());
  const photoInputRefs = useRef(new Map());
  const textDraftSaveTimersRef = useRef(new Map());
  const compressingAttachmentIdsRef = useRef(new Set());

  // Query/Recall state
  const [activeQuery, setActiveQuery] = useState(null);
  const [queryResults, setQueryResults] = useState(null);
  const [isRecalling, setIsRecalling] = useState(false);
  const [queryInputText, setQueryInputText] = useState('');

  // Query history dropdown state
  const [queryDropdownOpen, setQueryDropdownOpen] = useState(false);
  const [recentQueries, setRecentQueries] = useState([]);
  const dropdownRef = useRef(null);

  // Load query history on mount
  useEffect(() => {
    queryHistoryService.getRecent().then(setRecentQueries);
  }, []);

  const refreshTeamWorkContext = async () => {
    if (!user || !backendAvailable) {
      setTeamWorkContext({ hasTeams: false, teams: [], claimedItems: [], openBacklogItems: [] });
      return;
    }

    try {
      const state = await apiService.getMyWorkState();
      const teams = state.teams || (state.team ? [state.team] : []);
      const claimedItems = (state.inProgressItems || [])
        .filter(item => ['claimed', 'submitted', 'needs_more_evidence'].includes(item.status))
        .filter(item => item?.id && workContextLabel(item))
        .slice(0, 8);
      setTeamWorkContext({
        hasTeams: teams.length > 0,
        teams,
        claimedItems,
        openBacklogItems: state.openBacklogItems || [],
      });
    } catch (err) {
      console.warn('[Team] Work Context unavailable:', err);
      setTeamWorkContext({ hasTeams: false, teams: [], claimedItems: [], openBacklogItems: [] });
    }
  };

  useEffect(() => {
    refreshTeamWorkContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, backendAvailable, refreshKey]);

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

  useEffect(() => {
    if (teamWorkContext.claimedItems.length !== 1) return;
    const [onlyClaimedItem] = teamWorkContext.claimedItems;
    const readyNoteIds = entries
      .filter(entry => entry.status === 'ready_for_review' && entry.intent !== 'QUERY')
      .map(entry => entry.id);
    if (!readyNoteIds.length) return;

    setReviewSelectedWorkContexts(prev => {
      let changed = false;
      const next = { ...prev };
      for (const entryId of readyNoteIds) {
        if (Object.prototype.hasOwnProperty.call(next, entryId)) continue;
        next[entryId] = [onlyClaimedItem.id];
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [entries, teamWorkContext.claimedItems]);

  const resetContactCorrection = (entryId) => {
    setReviewContactPanels(prev => ({ ...prev, [entryId]: false }));
    setReviewContactSearch(prev => ({ ...prev, [entryId]: '' }));
    setReviewManualContacts(prev => ({ ...prev, [entryId]: { displayName: '', phone: '', email: '' } }));
    setReviewContactErrors(prev => ({ ...prev, [entryId]: null }));
  };

  const updateEntryAttachments = async (entryId, updater) => {
    const currentEntry = await dbService.getEntry(entryId);
    const nextAttachments = updater(currentEntry?.attachments || []);
    const updated = await dbService.updateEntry(entryId, { attachments: nextAttachments });
    setEntries(prev => prev.map(entry => entry.id === entryId ? { ...entry, ...updated } : entry));
    return updated;
  };

  const compressAndPersistAttachment = async (entryId, attachment) => {
    if (!attachment?.id || compressingAttachmentIdsRef.current.has(attachment.id)) return;
    compressingAttachmentIdsRef.current.add(attachment.id);
    try {
      const compressed = await preparePhotoAttachment(attachment);
      await updateEntryAttachments(entryId, attachments =>
        attachments.map(item => item.id === attachment.id ? compressed : item)
      );
      setReviewAttachmentErrors(prev => ({ ...prev, [entryId]: null }));
    } catch (err) {
      console.warn('[Attachments] Photo compression failed:', err);
      await updateEntryAttachments(entryId, attachments =>
        attachments.map(item => item.id === attachment.id
          ? { ...item, status: 'failed', errorMessage: err.message || 'Photo compression failed.' }
          : item)
      );
      setReviewAttachmentErrors(prev => ({ ...prev, [entryId]: err.message || 'Photo compression failed.' }));
    } finally {
      compressingAttachmentIdsRef.current.delete(attachment.id);
    }
  };

  const handleAddPhotoAttachments = async (entryId, fileList) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    try {
      setReviewAttachmentErrors(prev => ({ ...prev, [entryId]: null }));
      const currentEntry = await dbService.getEntry(entryId);
      const pending = await createPendingPhotoAttachmentsFromFiles(files, currentEntry?.attachments || []);
      if (!pending.length) return;
      const updated = await updateEntryAttachments(entryId, attachments => [...attachments, ...pending]);
      const added = (updated.attachments || [])
        .filter(attachment => attachment.status === 'pending_compression' && attachment.originalBlob);
      for (const attachment of added) {
        void compressAndPersistAttachment(entryId, attachment);
      }
    } catch (err) {
      console.error('[Attachments] Failed to add Photos:', err);
      setReviewAttachmentErrors(prev => ({ ...prev, [entryId]: err.message || 'Could not add Photos.' }));
    }
  };

  const removePhotoAttachment = async (entryId, attachmentId) => {
    try {
      setReviewAttachmentErrors(prev => ({ ...prev, [entryId]: null }));
      await updateEntryAttachments(entryId, attachments => attachments.filter(attachment => attachment.id !== attachmentId));
    } catch (err) {
      setReviewAttachmentErrors(prev => ({ ...prev, [entryId]: err.message || 'Could not remove Photo.' }));
    }
  };

  const persistReviewDraft = (entryId, updates) => {
    dbService.updateEntry(entryId, updates).then(updated => {
      setEntries(prev => prev.map(entry => entry.id === entryId ? { ...entry, ...updated } : entry));
    }).catch(err => {
      console.warn('[Capture] Review draft save failed:', err);
    });
  };

  useEffect(() => {
    for (const entry of entries) {
      if (entry.status !== 'ready_for_review') continue;
      for (const attachment of entry.attachments || []) {
        if (attachment.status === 'pending_compression' && attachment.originalBlob) {
          void compressAndPersistAttachment(entry.id, attachment);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const toggleLocationPanel = (entryId) => {
    setReviewLocationPanels(prev => ({ ...prev, [entryId]: !prev[entryId] }));
  };

  const togglePredictedTag = (entryId, tagId) => {
    setReviewSelectedTags(prev => {
      const selected = new Set(prev[entryId] || []);
      if (selected.has(tagId)) selected.delete(tagId);
      else selected.add(tagId);
      const nextIds = Array.from(selected);
      persistReviewDraft(entryId, { draftReviewTagIds: nextIds });
      return { ...prev, [entryId]: nextIds };
    });
  };

  const toggleWorkContextPanel = (entryId) => {
    setReviewWorkContextPanels(prev => ({ ...prev, [entryId]: !prev[entryId] }));
  };

  const toggleReviewWorkContext = (entryId, itemId) => {
    setReviewSelectedWorkContexts(prev => {
      const selected = new Set(prev[entryId] || []);
      if (selected.has(itemId)) selected.delete(itemId);
      else selected.add(itemId);
      const nextIds = Array.from(selected);
      persistReviewDraft(entryId, { draftReviewWorkContextIds: nextIds });
      return { ...prev, [entryId]: nextIds };
    });
  };

  const markWorkContextBusy = (key, busy) => {
    setBusyWorkContextIds(prev => {
      const next = new Set(prev);
      if (busy) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const selectClaimedWorkContext = (entryId, item) => {
    setTeamWorkContext(prev => {
      const exists = prev.claimedItems.some(claimed => claimed.id === item.id);
      return {
        ...prev,
        claimedItems: exists ? prev.claimedItems : [item, ...prev.claimedItems],
        openBacklogItems: prev.openBacklogItems.filter(openItem => openItem.id !== item.id),
      };
    });
    setReviewSelectedWorkContexts(prev => {
      const selected = new Set(prev[entryId] || []);
      selected.add(item.id);
      const nextIds = Array.from(selected);
      persistReviewDraft(entryId, { draftReviewWorkContextIds: nextIds });
      return { ...prev, [entryId]: nextIds };
    });
    setReviewWorkContextErrors(prev => ({ ...prev, [entryId]: null }));
  };

  const claimReviewBacklogItem = async (entryId, item) => {
    const busyKey = `claim:${item.id}`;
    markWorkContextBusy(busyKey, true);
    setReviewWorkContextErrors(prev => ({ ...prev, [entryId]: null }));
    try {
      const result = await apiService.claimTeamBacklogItem(item.id);
      selectClaimedWorkContext(entryId, result.backlogItem || item);
    } catch (err) {
      setReviewWorkContextErrors(prev => ({
        ...prev,
        [entryId]: err.message || 'Great news! Someone else just claimed this task.',
      }));
      await refreshTeamWorkContext();
    } finally {
      markWorkContextBusy(busyKey, false);
    }
  };

  const createAndClaimReviewBacklogItem = async (entryId, teamId) => {
    const description = String(reviewNewWorkDescriptions[entryId] || '').trim();
    if (!description) {
      setReviewWorkContextErrors(prev => ({ ...prev, [entryId]: 'Add a short description first.' }));
      return;
    }

    const busyKey = `create:${entryId}`;
    markWorkContextBusy(busyKey, true);
    setReviewWorkContextErrors(prev => ({ ...prev, [entryId]: null }));
    try {
      const result = await apiService.createAndClaimTeamBacklogItem({ teamId, description });
      selectClaimedWorkContext(entryId, result.backlogItem);
      setReviewNewWorkDescriptions(prev => ({ ...prev, [entryId]: '' }));
    } catch (err) {
      setReviewWorkContextErrors(prev => ({ ...prev, [entryId]: err.message || 'Could not create Team work here.' }));
    } finally {
      markWorkContextBusy(busyKey, false);
    }
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

  useEffect(() => {
    if (!ENABLE_TRANSCRIPTION_CAPTURE) return;
    if (localTranscriptionPreloadAttemptedRef.current) return;
    if (getSuccessfulCaptureCount() < 1) return;

    const preload = maybePreloadWhisperModel();
    if (!preload) {
      setLocalTranscriptionMetrics(getLocalTranscriptionMetrics());
      return;
    }

    localTranscriptionPreloadAttemptedRef.current = true;
    preload.then(setLocalTranscriptionMetrics).catch(() => {
      setLocalTranscriptionMetrics(getLocalTranscriptionMetrics());
    });
  }, [foregroundReturnCount]);

  useOutsideDismiss(queryDropdownOpen, [dropdownRef], () => setQueryDropdownOpen(false));

  useEffect(() => {
    const hasOpenReviewPanel = [
      reviewLocationPanels,
      reviewContactPanels,
      reviewWorkContextPanels,
    ].some(panelState => Object.values(panelState).some(Boolean));
    if (!hasOpenReviewPanel) return undefined;

    const closeOnOutsidePointer = (event) => {
      if (event.target?.closest?.('[data-review-dismiss-root]')) return;
      setReviewLocationPanels({});
      setReviewContactPanels({});
      setReviewWorkContextPanels({});
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      setReviewLocationPanels({});
      setReviewContactPanels({});
      setReviewWorkContextPanels({});
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [reviewContactPanels, reviewLocationPanels, reviewWorkContextPanels]);

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
    const timer = window.setTimeout(() => {
      setDebouncedReviewTextDrafts(reviewTextDrafts);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [reviewTextDrafts]);

  useEffect(() => {
    const timers = textDraftSaveTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const readyNotes = entries.filter(entry =>
      entry.status === 'ready_for_review' &&
      entry.intent !== 'QUERY' &&
      ((debouncedReviewTextDrafts[entry.id] || entry.summary || entry.transcript || '').trim()) &&
      classify(debouncedReviewTextDrafts[entry.id] || entry.summary || entry.transcript || '') !== 'QUERY'
    );

    for (const entry of readyNotes) {
      (async () => {
        let localMatchedContact = null;
        let localContactCandidates = [];
        let preExtraction = null;
        try {
          const [localContacts, localLocations, localTags] = await Promise.all([
            dbService.getContacts('confirmed'),
            dbService.getLocations('confirmed'),
            dbService.getTags('confirmed'),
          ]);
          const draftText = Object.prototype.hasOwnProperty.call(debouncedReviewTextDrafts, entry.id)
            ? debouncedReviewTextDrafts[entry.id]
            : '';
          const captureText = (draftText || [entry.summary, entry.transcript].filter(Boolean).join(' ')).trim();
          const predictionEntry = { ...entry, summary: captureText, transcript: captureText };
          localContactCandidates = localContacts
            .map(contact => localContactCandidate(contact, contactConfidenceForEntry(predictionEntry, contact)))
            .filter(candidate => candidate?.visible)
            .filter(Boolean)
            .slice(0, 5);
          const localLocationCandidates = localLocations.map(localLocationCandidate).filter(Boolean);
          const localTagCandidates = localTags.map(localTagCandidate).filter(Boolean);
          localMatchedContact = localContactCandidates.find(candidate => candidate.confidence === 'strong') || null;

          const allWorkContextCandidates = [
            ...(teamWorkContext.claimedItems || []),
            ...(teamWorkContext.openBacklogItems || []),
          ];
          const preExtractionCandidates = {
            contacts: localContactCandidates,
            locations: localLocationCandidates,
            tags: localTagCandidates,
            teams: teamWorkContext.teams || [],
            backlogItems: allWorkContextCandidates,
          };
          const preExtractionFingerprint = JSON.stringify({
            entryId: entry.id,
            captureText,
            candidateIds: Object.fromEntries(Object.entries(preExtractionCandidates).map(([key, values]) => [
              key,
              values.map(candidate => `${candidate.id}:${candidate.status || ''}`).join('|'),
            ])),
          });
          const shouldRunPreExtraction = preExtractionFingerprintsRef.current.get(entry.id) !== preExtractionFingerprint;
          if (shouldRunPreExtraction) {
            preExtractionFingerprintsRef.current.set(entry.id, preExtractionFingerprint);
            preExtraction = runPreExtraction({
              captureText,
              candidates: preExtractionCandidates,
              userId: user?.id || '',
              userSelections: {
                contacts: reviewContacts[entry.id] ? [reviewContacts[entry.id]] : [],
                locations: reviewLocationDrafts[entry.id]?.id ? [reviewLocationDrafts[entry.id].id] : [],
                tags: reviewSelectedTags[entry.id] || [],
                backlogItems: reviewSelectedWorkContexts[entry.id] || [],
              },
            });
          }
          const shouldRunBackendPrediction = !draftText && user && backendAvailable && !structurePredictionRequestedRef.current.has(entry.id);
          if (!shouldRunPreExtraction && !shouldRunBackendPrediction) {
            return;
          }
          if (shouldRunBackendPrediction) {
            structurePredictionRequestedRef.current.add(entry.id);
          }
          const contextClues = shouldRunBackendPrediction
            ? entry.captureId
              ? await dbService.getContextCluesForCapture(entry.captureId)
              : await dbService.getContextCluesForEntry(entry.id)
            : [];
          let backendPredictionError = false;
          let result = { candidateSet: {}, prediction: {} };
          if (shouldRunBackendPrediction) {
            try {
              result = await apiService.predictStructure({
                entryData: {
                  summary: captureText || entry.summary,
                  transcript: entry.transcript,
                },
                contextClues,
              });
            } catch (err) {
              backendPredictionError = true;
              console.warn('[Structure] Backend prediction unavailable:', err);
            }
          }
          const preSuggestions = preExtraction?.suggestions || {};
          const candidateSet = {
            ...(result.candidateSet || {}),
            locations: mergeCandidatesById(preSuggestions.locations || [], result.candidateSet?.locations || []),
            contacts: mergeCandidatesById(preSuggestions.contacts || [], mergeCandidatesById(localContactCandidates, result.candidateSet?.contacts || [])),
            tags: mergeCandidatesById(preSuggestions.tags || [], result.candidateSet?.tags || []),
          };
          const prediction = {
            ...(result.prediction || {}),
            locationIds: mergeIds(
              suggestionIdsToPreselect(preSuggestions.locations || [], { keywordThreshold: 90 }),
              result.prediction?.locationIds || []
            ),
            contactIds: mergeIds(
              localMatchedContact
                ? [localMatchedContact.id, ...suggestionIdsToPreselect(preSuggestions.contacts || [], { keywordThreshold: 80 })]
                : suggestionIdsToPreselect(preSuggestions.contacts || [], { keywordThreshold: 80 }),
              result.prediction?.contactIds || []
            ),
            tagIds: mergeIds(
              suggestionIdsToPreselect(preSuggestions.tags || []),
              result.prediction?.tagIds || []
            ),
          };
          const preselectedWorkContextIds = suggestionIdsToPreselect(preSuggestions.backlogItems || [], { keywordThreshold: 90 });
          const predictedLocation = (candidateSet.locations || []).find(candidate => candidate.id === prediction.locationIds?.[0]);
          const predictedContact = (candidateSet.contacts || []).find(candidate => candidate.id === prediction.contactIds?.[0]);

          setReviewStructure(prev => ({
            ...prev,
            [entry.id]: { error: backendPredictionError && !preExtraction, candidateSet, prediction },
          }));
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
          if (preselectedWorkContextIds.length) {
            setReviewSelectedWorkContexts(prev => prev[entry.id]?.length ? prev : { ...prev, [entry.id]: preselectedWorkContextIds });
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
  }, [
    entries,
    debouncedReviewTextDrafts,
    user,
    backendAvailable,
    teamWorkContext.teams,
    teamWorkContext.claimedItems,
    teamWorkContext.openBacklogItems,
    reviewContacts,
    reviewLocationDrafts,
    reviewSelectedTags,
    reviewSelectedWorkContexts,
  ]);

  /**
   * Process a recording: transcribe and classify
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

      const timedLocal = async () => {
        const startedAt = performance.now();
        try {
          const value = await tryLocalTranscribeAudio(entry.audioBlob, { captureContext });
          return { source: 'local', value, latencyMs: value.latencyMs ?? Math.round(performance.now() - startedAt) };
        } catch (error) {
          return { source: 'local', value: { ok: false, reason: error?.message || 'local_failed' }, latencyMs: Math.round(performance.now() - startedAt) };
        }
      };
      const timedBackend = async () => {
        const startedAt = performance.now();
        try {
          const value = await apiService.transcribeAudio(entry.audioBlob, { captureContext });
          return { source: 'backend', value: { ...value, ok: true }, latencyMs: Math.round(performance.now() - startedAt) };
        } catch (error) {
          return { source: 'backend', value: { ok: false, reason: error?.message || 'backend_failed', error }, latencyMs: Math.round(performance.now() - startedAt) };
        }
      };

      const raceBackend = shouldRaceBackendTranscription();
      const localPromise = raceBackend
        ? new Promise(resolve => window.setTimeout(resolve, BACKEND_FIRST_LOCAL_DELAY_MS)).then(timedLocal)
        : timedLocal();
      const backendPromise = raceBackend ? timedBackend() : null;
      const firstResult = backendPromise ? await Promise.race([localPromise, backendPromise]) : await localPromise;
      let localOutcome = firstResult.source === 'local' ? firstResult : null;
      let backendOutcome = firstResult.source === 'backend' ? firstResult : null;

      if (!firstResult.value.ok) {
        if (firstResult.source === 'backend' && firstResult.value.error?.code === 'empty_transcription') {
          throw firstResult.value.error;
        }
        const fallback = firstResult.source === 'local'
          ? (backendPromise ? await backendPromise : await timedBackend())
          : await localPromise;
        if (fallback.source === 'local') localOutcome = fallback;
        else backendOutcome = fallback;
      }

      const selectedOutcome = firstResult.value.ok
        ? firstResult
        : [localOutcome, backendOutcome].find(outcome => outcome?.value?.ok);
      if (!selectedOutcome?.value?.ok) {
        const failed = firstResult.value.error || new Error(firstResult.value.reason || 'Transcription failed');
        throw failed;
      }

      const result = selectedOutcome.value;
      const selectedSource = selectedOutcome.source;
      if (selectedSource === 'backend' && !localOutcome?.value?.ok) {
        console.debug('[LocalTranscription] Backend fallback:', localOutcome?.value?.reason || 'local_unavailable');
      }
      const transcriptionCandidates = [
        {
          source: 'backend',
          provider: 'deepgram',
          transcript: backendOutcome?.value?.ok ? backendOutcome.value.transcript : '',
          selectable: Boolean(backendOutcome?.value?.ok),
          selected: selectedSource === 'backend',
          latencyMs: backendOutcome?.latencyMs ?? null,
          status: backendOutcome?.value?.ok ? 'ok' : (raceBackend ? 'failed' : 'suppressed'),
          reason: backendOutcome?.value?.ok ? null : (backendOutcome?.value?.reason || (raceBackend ? null : 'local_preferred')),
        },
        {
          source: 'local',
          provider: localOutcome?.value?.provider || 'whisper.cpp',
          transcript: localOutcome?.value?.ok ? localOutcome.value.transcript : '',
          selectable: Boolean(localOutcome?.value?.ok),
          selected: selectedSource === 'local',
          latencyMs: localOutcome?.latencyMs ?? null,
          status: localOutcome?.value?.ok ? 'ok' : 'placeholder',
          reason: localOutcome?.value?.ok ? null : (localOutcome?.value?.reason || 'runtime_not_integrated'),
        },
      ];
      const successfulCaptures = recordSuccessfulTranscription();
      setSuccessfulCaptureCount(successfulCaptures);
      const preload = maybePreloadWhisperModel();
      preload?.then(setLocalTranscriptionMetrics).catch(() => {
        setLocalTranscriptionMetrics(getLocalTranscriptionMetrics());
      });

      // Update entry with raw transcription data and intent (goes to ready_for_review).
      const updated = await dbService.updateEntryWithTranscription(jobId, {
        transcript: result.transcript,
        summary: result.summary || result.transcript,
        intent: result.intent || 'NOTE',
        transcriptionSource: selectedSource,
        transcriptionCandidates,
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
        if (kind === 'empty_transcription') {
          const updated = await dbService.updateEntry(jobId, {
            status: 'ready_for_review',
            intent: 'NOTE',
            errorMessage: kind,
            transcriptionPending: false,
          });
          setEntries(prev => prev.map(e =>
            e.id === jobId ? { ...e, ...updated } : e
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

  const selectTranscriptionCandidate = async (entry, candidate) => {
    if (!candidate?.selectable || !candidate.transcript) return;
    const existingDraft = reviewTextDrafts[entry.id];
    const nextText = existingDraft?.trim()
      ? `${existingDraft.trim()}\n\n${candidate.transcript}`
      : candidate.transcript;
    const candidates = (entry.transcriptionCandidates || []).map(item => ({
      ...item,
      selected: item.source === candidate.source,
    }));
    const updates = {
      transcript: candidate.transcript,
      summary: nextText,
      transcriptionSource: candidate.source,
      transcriptionCandidates: candidates,
    };
    const updated = await dbService.updateEntry(entry.id, updates);
    setReviewTextDrafts(prev => ({ ...prev, [entry.id]: nextText }));
    setEntries(prev => prev.map(item => item.id === entry.id ? { ...item, ...updated } : item));
  };

  const startTextCapture = async () => {
    try {
      setError(null);
      const entryId = await dbService.createTextEntry({ source: 'text', intent: 'NOTE' });
      const newEntry = await dbService.getEntry(entryId);
      setReviewTextDrafts(prev => ({ ...prev, [entryId]: '' }));
      setFocusEntryId(entryId);
      setEntries(prev => [newEntry, ...prev]);

      void (async () => {
        const locationResult = await locationClueService.captureCurrentLocation({ allowPrompt: false });
        if (locationResult.ok) {
          await dbService.createDeviceLocationContextClue({ entryId, clue: locationResult.clue });
        }
      })().catch(locationErr => {
        console.warn('[Location] Capture-time location clue unavailable:', locationErr);
      });
    } catch (err) {
      console.error('Text capture start error:', err);
      setError('Could not start a new entry.');
    }
  };

  useEffect(() => {
    if (!focusEntryId) return;
    const timer = window.setTimeout(() => {
      const textarea = textAreaRefs.current.get(focusEntryId);
      textarea?.focus();
      textarea?.setSelectionRange?.(textarea.value.length, textarea.value.length);
      setFocusEntryId(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusEntryId, entries]);

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
      if (ENABLE_TRANSCRIPTION_CAPTURE) startRecording({ flash: true });
      else startTextCapture();
      onRecordRequestHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordRequestId, isLoading, activeQuery, isRecording, isStartingRecording, isStoppingRecording]);

  useEffect(() => {
    const isForegroundReturn = foregroundReturnCount > handledForegroundReturnRef.current;
    const isInitialAutoStart = foregroundReturnCount === 0;

    if (!ENABLE_TRANSCRIPTION_CAPTURE) return;
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

  const handleApplyUpdate = async () => {
    if (updateRegistration) {
      await applyServiceWorkerUpdate(updateRegistration);
      return;
    }
    window.location.reload();
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
          audioDiagnostics: audioData.diagnostics,
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
      setEntries(prev => [{
        ...newEntry,
        status: 'ready_for_review',
        intent: 'NOTE',
        transcriptionPending: true,
      }, ...prev]);

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

  const isOffline = () => !navigator.onLine || !backendAvailable;

  const handleConfirm = async (id) => {
    if (confirmingIdsRef.current.has(id)) return;
    confirmingIdsRef.current.add(id);
    setConfirmingIds(prev => new Set([...prev, id]));

    try {
      setError(null);
      let entry = entries.find(e => e.id === id);
      if (hasPendingPhotoAttachments(entry?.attachments || [])) {
        setReviewAttachmentErrors(prev => ({ ...prev, [id]: 'Photos are still preparing. Confirm when they are ready.' }));
        return;
      }
      if (hasFailedPhotoAttachments(entry?.attachments || [])) {
        setReviewAttachmentErrors(prev => ({ ...prev, [id]: 'Remove failed Photos before confirming.' }));
        return;
      }
      const hasReviewDraft = Object.prototype.hasOwnProperty.call(reviewTextDrafts, id);
      const reviewText = String(hasReviewDraft ? reviewTextDrafts[id] : (entry.summary || entry.transcript || '')).trim();
      const nextIntent = reviewIntentOverrides[id] || classify(reviewText);
      if (nextIntent === 'QUERY' && !reviewText) {
        setError('Type a search query first.');
        return;
      }
      if (reviewText && reviewText !== (entry.summary || entry.transcript || '').trim()) {
        entry = await dbService.updateEntry(id, {
          transcript: entry.transcript || reviewText,
          summary: reviewText,
          intent: nextIntent,
        });
        setEntries(prev => prev.map(e => e.id === id ? { ...e, ...entry } : e));
      } else if (nextIntent !== entry.intent) {
        entry = await dbService.updateEntry(id, { intent: nextIntent });
        setEntries(prev => prev.map(e => e.id === id ? { ...e, ...entry } : e));
      }

      // Handle QUERY intent
      if (nextIntent === 'QUERY') {
        // Offline: show message, keep entry for later retry
        if (isOffline()) {
          setError('Recall isn\'t available right now. Your recording has been saved locally.');
          return;
        }
        await dbService.rejectEntry(id);
        setEntries(prev => prev.filter(e => e.id !== id));
        await executeQuery(reviewText);
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
      const selectedWorkContextIds = new Set(reviewSelectedWorkContexts[id] || []);
      const workContexts = [
        ...(teamWorkContext.claimedItems || []),
        ...(teamWorkContext.openBacklogItems || []),
      ]
        .filter(item => selectedWorkContextIds.has(item.id))
        .map(workContextSnapshot);
      const confirmedEntry = await dbService.confirmEntry(id, { locations, contacts, tags, workContexts });
      let timelineEntry = { ...entry, ...confirmedEntry };

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

      if (entry.transcriptionCandidates?.length) {
        try {
          const selectedSource = entry.transcriptionSource || entry.transcriptionCandidates.find(candidate => candidate.selected)?.source || 'backend';
          const selectedCandidate = entry.transcriptionCandidates.find(candidate => candidate.source === selectedSource);
          const editDistance = selectedCandidate?.transcript
            ? textEditDistance(selectedCandidate.transcript, timelineEntry.summary || timelineEntry.transcript || '')
            : null;
          recordTranscriptionChoice({
            selectedSource,
            editDistance,
            originalLength: selectedCandidate?.transcript?.length || 0,
          });
          await apiService.saveTranscriptionEvaluation({
            captureId: entry.captureId || entry.id,
            entryId: timelineEntry.remoteId || null,
            selectedSource,
            reviewText: timelineEntry.summary || timelineEntry.transcript || '',
            editDistance,
            candidates: entry.transcriptionCandidates,
            metadata: {
              buildId: BUILD_ID,
              intent: entry.intent,
              localFirst: selectedSource === 'local',
            },
          });
        } catch (evaluationErr) {
          console.warn('[TranscriptionEvaluation] Save failed:', evaluationErr);
        }
      }

      // Update UI: move to confirmed section (re-sort)
      setEntries(prev => {
        const updated = prev.map(e => e.id === id ? { ...e, ...timelineEntry, status: 'confirmed' } : e);
        const inProgress = updated.filter(e => e.status !== 'confirmed');
        const confirmed = updated.filter(e => e.status === 'confirmed').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        return [...inProgress, ...confirmed];
      });
      setReviewLocations(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewLocationErrors(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewLocationPanels(prev => {
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
      setReviewContactErrors(prev => {
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
      setReviewWorkContextPanels(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewSelectedWorkContexts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewWorkContextErrors(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewNewWorkDescriptions(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewNewWorkTeamIds(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewTextDrafts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      const textDraftTimer = textDraftSaveTimersRef.current.get(id);
      if (textDraftTimer) window.clearTimeout(textDraftTimer);
      textDraftSaveTimersRef.current.delete(id);
      setDebouncedReviewTextDrafts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewIntentOverrides(prev => {
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
      setReviewTextDrafts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      const textDraftTimer = textDraftSaveTimersRef.current.get(id);
      if (textDraftTimer) window.clearTimeout(textDraftTimer);
      textDraftSaveTimersRef.current.delete(id);
      setDebouncedReviewTextDrafts(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setReviewIntentOverrides(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
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

  useEffect(() => {
    setAppUpdateGuard(() => entries.some(entry => entry.status !== 'confirmed'));
    return () => setAppUpdateGuard(null);
  }, [entries]);

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
      setReviewContactErrors(prev => ({ ...prev, [entryId]: null }));
      const contacts = query.trim()
        ? await dbService.searchContacts(query)
        : await dbService.getContacts('confirmed');
      setReviewContactOptions(prev => ({
        ...prev,
        [entryId]: contacts.map(localContactCandidate).filter(Boolean).slice(0, 8),
      }));
    } catch (err) {
      console.error('Failed to load Contacts for review:', err);
      setReviewContactErrors(prev => ({ ...prev, [entryId]: 'Could not load Contacts here.' }));
    }
  };

  const openContactCorrection = async (entryId) => {
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
      setReviewContactErrors(prev => ({ ...prev, [entryId]: null }));
      const result = await pickContact();
      if (!result.ok) {
        setReviewContactErrors(prev => ({
          ...prev,
          [entryId]: result.reason === 'unsupported' ? 'Contact Picker is unavailable on this device.' : 'No Contact was selected.',
        }));
        return;
      }

      const savedContact = await dbService.upsertContact(result.contact);
      const candidate = localContactCandidate(savedContact);
      if (!candidate) {
        setReviewContactErrors(prev => ({ ...prev, [entryId]: 'Could not use selected Contact.' }));
        return;
      }
      selectReviewContactCandidate(entryId, candidate);
    } catch (err) {
      console.error('Failed to pick Contact:', err);
      setReviewContactErrors(prev => ({ ...prev, [entryId]: 'Could not pick Contact.' }));
    }
  };

  const handleCreateManualContact = async (entryId) => {
    try {
      setError(null);
      setReviewContactErrors(prev => ({ ...prev, [entryId]: null }));
      const draft = contactDraftFromManualInput(reviewManualContacts[entryId]);
      const validation = validateContactDraftForCreation(draft);
      if (!validation.valid) {
        setReviewContactErrors(prev => ({ ...prev, [entryId]: validation.error }));
        return;
      }

      const savedContact = await dbService.upsertContact(draft);
      const candidate = localContactCandidate(savedContact);
      if (!candidate) {
        setReviewContactErrors(prev => ({ ...prev, [entryId]: 'Could not create Contact.' }));
        return;
      }
      selectReviewContactCandidate(entryId, candidate);
    } catch (err) {
      console.error('Failed to create Contact:', err);
      setReviewContactErrors(prev => ({ ...prev, [entryId]: 'Could not create Contact.' }));
    }
  };

  const handleUseCurrentLocation = async (entry) => {
    try {
      setError(null);
      setReviewLocationErrors(prev => ({ ...prev, [entry.id]: null }));
      const result = await locationClueService.captureCurrentLocation({ allowPrompt: true });
      if (!result.ok) {
        setReviewLocationErrors(prev => ({ ...prev, [entry.id]: 'Current location is unavailable right now.' }));
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
      setReviewLocationErrors(prev => ({ ...prev, [entry.id]: 'Current location is unavailable right now.' }));
    }
  };

  const handleStrengthenLocationHere = async (entry) => {
    const selectedDraft = reviewLocationDrafts[entry.id];
    if (!canStrengthenLocationDraft(selectedDraft)) return;

    try {
      setError(null);
      setReviewLocationErrors(prev => ({ ...prev, [entry.id]: null }));
      const result = await locationClueService.captureCurrentLocation({ allowPrompt: true });
      if (!result.ok) {
        setReviewLocationErrors(prev => ({ ...prev, [entry.id]: 'Current location is unavailable right now.' }));
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
      setReviewLocationErrors(prev => ({ ...prev, [entry.id]: 'Current location is unavailable right now.' }));
    }
  };

  /**
   * Execute a query: call recall, show results, save to history.
   * Used for both confirm-screen queries and re-runs from dropdown.
   */
  const executeQuery = async (text) => {
    setQueryDropdownOpen(false);
    const trimmedText = String(text || '').trim();
    if (!trimmedText) {
      setError('Type a search query first.');
      return;
    }
    setError(null);

    const publishResults = async (results) => {
      setActiveQuery(trimmedText);
      setQueryResults(results);
      await queryHistoryService.add(trimmedText);
      setRecentQueries(await queryHistoryService.getRecent());
    };

    const runLocalRecall = async () => {
      await publishResults(recallLocalEntries(trimmedText, entries));
    };

    setIsRecalling(true);
    try {
      if (!user || isOffline()) {
        await runLocalRecall();
        return;
      }

      const results = await apiService.recall(trimmedText);
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
          locations: result.locations || localEntry.locations,
          contacts: result.contacts || localEntry.contacts,
          tags: result.tags || localEntry.tags,
          syncStatus: result.syncStatus || localEntry.syncStatus,
        };
      });
      await publishResults(enrichedResults);
    } catch (err) {
      if (err?.message === 'Failed to fetch' || err?.message?.includes('NetworkError') || !navigator.onLine) {
        await runLocalRecall();
      } else if (err?.status === 401 || err?.status === 403) {
        await runLocalRecall();
      } else if (err?.status === 400) {
        setError(err?.message || 'Type a search query first.');
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
        const inProgressEntries = await dbService.getEntries('recording');
        const readyForReviewEntries = await dbService.getEntries('ready_for_review');
        const failedEntries = await dbService.getEntries('failed');
        const confirmedEntries = await dbService.getEntries('confirmed');

        // Merge all entries: in-progress first, then confirmed (newest first)
        const allInProgress = [...inProgressEntries, ...readyForReviewEntries, ...failedEntries];
        const sortedConfirmed = confirmedEntries.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        const loadedEntries = [...allInProgress, ...sortedConfirmed];
        setEntries(loadedEntries);
        setReviewLocations(prev => {
          const next = { ...prev };
          for (const entry of loadedEntries) {
            if (entry.status !== 'confirmed' && entry.draftReviewLocationText) {
              next[entry.id] = entry.draftReviewLocationText;
            }
          }
          return next;
        });
        setReviewLocationDrafts(prev => {
          const next = { ...prev };
          for (const entry of loadedEntries) {
            if (entry.status !== 'confirmed' && entry.draftReviewLocationDraft) {
              next[entry.id] = entry.draftReviewLocationDraft;
            }
          }
          return next;
        });
        setReviewContacts(prev => {
          const next = { ...prev };
          for (const entry of loadedEntries) {
            if (entry.status !== 'confirmed' && entry.draftReviewContactId) {
              next[entry.id] = entry.draftReviewContactId;
            }
          }
          return next;
        });
        setReviewSelectedTags(prev => {
          const next = { ...prev };
          for (const entry of loadedEntries) {
            if (entry.status !== 'confirmed' && Array.isArray(entry.draftReviewTagIds)) {
              next[entry.id] = entry.draftReviewTagIds;
            }
          }
          return next;
        });
        setReviewSelectedWorkContexts(prev => {
          const next = { ...prev };
          for (const entry of loadedEntries) {
            if (entry.status !== 'confirmed' && Array.isArray(entry.draftReviewWorkContextIds)) {
              next[entry.id] = entry.draftReviewWorkContextIds;
            }
          }
          return next;
        });

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

    const trimmedQueryInput = queryInputText.trim();
    const visibleRecentQueries = recentQueries
      .filter(q => {
        if (!trimmedQueryInput) return true;
        return q.text.toLowerCase().includes(trimmedQueryInput.toLowerCase());
      })
      .slice(0, 6);

    // Idle state - browser-bar search with recent query suggestions
    return (
      <div className="relative h-12" ref={dropdownRef}>
        <form
          className="flex h-12 items-center px-3"
          onSubmit={(event) => {
            event.preventDefault();
            executeQuery(queryInputText);
          }}
        >
          <div className="relative w-full">
            <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35m1.6-5.4a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="search"
              value={queryInputText}
              onChange={(event) => setQueryInputText(event.target.value)}
              onFocus={() => setQueryDropdownOpen(true)}
              placeholder="Search your entries"
              className="h-9 w-full rounded-full border border-gray-200 bg-gray-50 pl-9 pr-12 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-100"
              aria-label="Search entries"
            />
            <button
              type="submit"
              disabled={!trimmedQueryInput || isRecalling}
              className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-gray-900 text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400"
              title="Search"
              aria-label="Search"
            >
              {isRecalling ? (
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-6-6l6 6-6 6" />
                </svg>
              )}
            </button>
          </div>
        </form>

        {/* Dropdown */}
        {queryDropdownOpen && visibleRecentQueries.length > 0 && (
          <div className="absolute left-4 right-4 top-12 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
            <div className="p-2">
              {visibleRecentQueries.map((q, i) => (
                <button
                  key={q.id || i}
                  onClick={() => {
                    setQueryInputText(q.text);
                    executeQuery(q.text);
                  }}
                  className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 transition text-sm text-gray-700 truncate"
                >
                  {q.text}
                </button>
              ))}
            </div>
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
    const primaryLocation = Array.isArray(entry.locations) && entry.locations.length > 0
      ? entry.locations[0]
      : null;
    const primaryContact = Array.isArray(entry.contacts) && entry.contacts.length > 0
      ? entry.contacts[0]
      : null;
    const entryTags = Array.isArray(entry.tags) && entry.tags.length > 0
      ? entry.tags
      : [];
    const entryWorkContexts = Array.isArray(entry.workContexts) && entry.workContexts.length > 0
      ? entry.workContexts
      : [];

    if (entry.status === 'recording') {
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
          {entry.audioDiagnostics && (
            <div className="mb-3 rounded border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-900">
              <p>
                Audio debug: {entry.audioSize || 0} bytes, {entry.audioDiagnostics.chunkCount ?? '?'} chunks
                {entry.audioDiagnostics.track?.muted ? ', mic muted' : ''}
                {entry.audioDiagnostics.track?.readyState ? `, track ${entry.audioDiagnostics.track.readyState}` : ''}
              </p>
              {entry.audioDiagnostics.track?.lastEvent && (
                <p className="mt-1">Last mic event: {entry.audioDiagnostics.track.lastEvent}</p>
              )}
            </div>
          )}
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
      const { structure, candidateSet, contact: selectedContact } = selectedPredictionCandidates(entry.id);
      const locationCandidates = candidateSet.locations || [];
      const selectedLocationDraft = reviewLocationDrafts[entry.id];
      const locationPanelOpen = Boolean(reviewLocationPanels[entry.id]);
      const locationPanelError = reviewLocationErrors[entry.id];
      const canStrengthenSelectedLocation = canStrengthenLocationDraft(selectedLocationDraft);
      const contactCandidates = candidateSet.contacts || [];
      const contactPanelOpen = Boolean(reviewContactPanels[entry.id]);
      const contactPanelError = reviewContactErrors[entry.id];
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
      const workContextItems = teamWorkContext.claimedItems || [];
      const openWorkContextItems = teamWorkContext.openBacklogItems || [];
      const allWorkContextItems = [...workContextItems, ...openWorkContextItems];
      const creatableTeams = (teamWorkContext.teams || []).filter(team => team.workers_can_create_backlog_items);
      const selectedCreateTeamId = reviewNewWorkTeamIds[entry.id] || creatableTeams[0]?.id || '';
      const selectedWorkContextIds = new Set(reviewSelectedWorkContexts[entry.id] || []);
      const selectedWorkContextItems = allWorkContextItems.filter(item => selectedWorkContextIds.has(item.id));
      const workContextPanelOpen = Boolean(reviewWorkContextPanels[entry.id]);
      const workContextPanelError = reviewWorkContextErrors[entry.id];
      const transcriptionPending = Boolean(entry.transcriptionPending || isProcessing);
      const transcriptionFailed = entry.errorMessage === 'empty_transcription';
      const reviewEntryText = entry.summary || entry.transcript || '';
      const editableReviewText = Object.prototype.hasOwnProperty.call(reviewTextDrafts, entry.id)
        ? reviewTextDrafts[entry.id]
        : reviewEntryText;
      const isQuery = (reviewIntentOverrides[entry.id] || classify(editableReviewText)) === 'QUERY';
      const shouldShowWorkContext = teamWorkContext.hasTeams && !isQuery;
      const toggleIntent = async () => {
        const newIntent = isQuery ? 'NOTE' : 'QUERY';
        await dbService.updateEntry(entry.id, { intent: newIntent });
        setReviewIntentOverrides(prev => ({ ...prev, [entry.id]: newIntent }));
        setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, intent: newIntent } : e));
      };
      const updateReviewText = (text) => {
        setReviewTextDrafts(prev => ({ ...prev, [entry.id]: text }));
        const existingTimer = textDraftSaveTimersRef.current.get(entry.id);
        if (existingTimer) window.clearTimeout(existingTimer);
        const timer = window.setTimeout(async () => {
          textDraftSaveTimersRef.current.delete(entry.id);
          try {
            await dbService.updateEntry(entry.id, {
              summary: text,
              transcript: entry.transcript || text,
              intent: reviewIntentOverrides[entry.id] || classify(text),
            });
          } catch (err) {
            console.warn('[Capture] Draft save failed:', err);
          }
        }, 300);
        textDraftSaveTimersRef.current.set(entry.id, timer);
      };
      const saveReviewTextNow = async () => {
        const existingTimer = textDraftSaveTimersRef.current.get(entry.id);
        if (existingTimer) {
          window.clearTimeout(existingTimer);
          textDraftSaveTimersRef.current.delete(entry.id);
        }
        try {
          await dbService.updateEntry(entry.id, {
            summary: editableReviewText,
            transcript: entry.transcript || editableReviewText,
            intent: reviewIntentOverrides[entry.id] || classify(editableReviewText),
          });
        } catch (err) {
          console.warn('[Capture] Draft save failed:', err);
        }
      };
      const showSeparateTranscript = Boolean(entry.transcript && entry.transcript !== entry.summary);
      const transcriptionCandidates = entry.transcriptionCandidates || [];
      const selectedTranscriptionSource = entry.transcriptionSource || transcriptionCandidates.find(candidate => candidate.selected)?.source;
      const attachments = entry.attachments || [];
      const photoAttachments = attachments.filter(attachment => attachment.kind === 'photo');
      const attachmentError = reviewAttachmentErrors[entry.id];
      const photosPending = hasPendingPhotoAttachments(attachments);
      const photosFailed = hasFailedPhotoAttachments(attachments);
      const canAddPhotos = canAddMorePhotos(attachments);
      const queryTextEmpty = isQuery && editableReviewText.trim().length === 0;

      return (
        <div key={entry.id} className="py-4 border-b border-gray-100 last:border-b-0">
          <div className="flex items-start gap-2 mb-3">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-800">
              Review
            </span>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
              {isQuery ? 'Search' : 'Note'}
            </span>
            {transcriptionPending && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700">
                Transcribing...
              </span>
            )}
            {transcriptionFailed && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                No speech detected
              </span>
            )}
          </div>
          
          {isQuery ? (
            // QUERY layout
            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-1">Searching for:</p>
              <textarea
                ref={(node) => {
                  if (node) textAreaRefs.current.set(entry.id, node);
                  else textAreaRefs.current.delete(entry.id);
                }}
                value={editableReviewText}
                onChange={(event) => updateReviewText(event.target.value)}
                onBlur={saveReviewTextNow}
                rows={Math.max(3, Math.min(8, editableReviewText.split('\n').length + 2))}
                placeholder="Type a question to search your Timeline."
                className="w-full rounded border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
          ) : (
            // NOTE layout
            <div className="mb-4">
              <p className="text-sm text-gray-500 mb-1">Saving entry:</p>
              {transcriptionCandidates.length > 0 && (
                <div className="mb-3 grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                      Transcription: evaluation
                    </span>
                    {selectedTranscriptionSource && (
                      <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
                        {transcriptionSourceLabel(selectedTranscriptionSource)} selected
                      </span>
                    )}
                  </div>
                  {transcriptionCandidates.map(candidate => {
                    const selected = candidate.source === selectedTranscriptionSource;
                    const disabled = !candidate.selectable || !candidate.transcript;
                    return (
                      <button
                        key={candidate.source}
                        type="button"
                        disabled={disabled}
                        onClick={() => selectTranscriptionCandidate(entry, candidate)}
                        className={`rounded border px-3 py-2 text-left ${
                          selected
                            ? 'border-blue-300 bg-blue-50 text-blue-950'
                            : disabled
                              ? 'border-gray-200 bg-gray-50 text-gray-500'
                              : 'border-gray-200 bg-white text-gray-900'
                        }`}
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="text-sm font-medium">{transcriptionSourceLabel(candidate.source)}</span>
                          <span className="text-xs text-gray-500">
                            {candidate.latencyMs != null ? `${candidate.latencyMs}ms` : candidate.status || 'pending'}
                          </span>
                        </span>
                        {candidate.transcript ? (
                          <span className="mt-1 block text-sm">{candidate.transcript}</span>
                        ) : (
                          <span className="mt-1 block text-xs">{candidate.reason || 'Not ready yet'}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <textarea
                ref={(node) => {
                  if (node) textAreaRefs.current.set(entry.id, node);
                  else textAreaRefs.current.delete(entry.id);
                }}
                value={editableReviewText}
                onChange={(event) => updateReviewText(event.target.value)}
                onBlur={saveReviewTextNow}
                rows={Math.max(3, Math.min(8, editableReviewText.split('\n').length + 2))}
                placeholder="Type here or use keyboard dictation."
                className="mb-2 w-full rounded border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              {!reviewEntryText && transcriptionPending && (
                <p className="mb-2 text-xs text-gray-500">Audio is transcribing. You can add context or type while it runs.</p>
              )}
              {transcriptionFailed && (
                <p className="mb-2 text-xs text-red-700">Transcription did not hear speech. Type here or use keyboard dictation.</p>
              )}
              {transcriptionFailed && entry.audioDiagnostics && (
                <p className="mb-3 rounded border border-red-100 bg-red-50 px-3 py-2 text-xs text-red-900">
                  Audio debug: {entry.audioSize || 0} bytes, {entry.audioDiagnostics.chunkCount ?? '?'} chunks
                  {entry.audioDiagnostics.track?.muted ? ', mic muted' : ''}
                  {entry.audioDiagnostics.track?.readyState ? `, track ${entry.audioDiagnostics.track.readyState}` : ''}
                </p>
              )}
              {showSeparateTranscript && (
                <p className="text-sm text-gray-600 mb-3">{entry.transcript}</p>
              )}

              <div className="mb-3">
                <input
                  ref={(node) => {
                    if (node) photoInputRefs.current.set(entry.id, node);
                    else photoInputRefs.current.delete(entry.id);
                  }}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    void handleAddPhotoAttachments(entry.id, event.target.files);
                    event.target.value = '';
                  }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => photoInputRefs.current.get(entry.id)?.click()}
                    disabled={!canAddPhotos}
                    className="inline-flex items-center rounded border border-dashed border-gray-300 px-2.5 py-1 text-sm text-gray-700 disabled:border-gray-200 disabled:text-gray-400"
                  >
                    + Photos
                  </button>
                  <span className="text-xs text-gray-400">
                    {photoAttachments.length}/{MAX_PHOTOS_PER_CAPTURE}
                  </span>
                </div>
                {photoAttachments.length > 0 && (
                  <div className="mt-2 grid gap-2">
                    {photoAttachments.map(attachment => (
                      <div key={attachment.id} className="flex items-center gap-3 rounded border border-gray-200 bg-white px-3 py-2">
                        <PhotoAttachmentThumb attachment={attachment} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-900">{attachment.originalName || 'Photo'}</p>
                          <p className="text-xs text-gray-500">
                            {attachment.status === 'pending_compression'
                              ? 'Preparing Photo...'
                              : attachment.status === 'failed'
                                ? (attachment.errorMessage || 'Compression failed')
                                : `${attachment.width || '?'}x${attachment.height || '?'} · ${formatAttachmentBytes(attachment.size)}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removePhotoAttachment(entry.id, attachment.id)}
                          className="shrink-0 text-sm text-gray-500 underline"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {attachmentError && (
                  <p className="mt-2 text-sm text-red-700">{attachmentError}</p>
                )}
              </div>

              {shouldShowWorkContext && (
                <div className="mb-3" data-review-dismiss-root="work-context">
                  <div className="flex flex-wrap gap-2">
                    {selectedWorkContextItems.length > 0 ? (
                      selectedWorkContextItems.map(item => (
                        <span
                          key={item.id}
                          className="inline-flex max-w-full items-center rounded bg-amber-50 text-sm font-medium text-amber-800"
                        >
                          <button
                            type="button"
                            onClick={() => toggleWorkContextPanel(entry.id)}
                            className="min-w-0 px-2.5 py-1 text-left"
                          >
                            <span className="block truncate">{workContextLabel(item)}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleReviewWorkContext(entry.id, item.id)}
                            className="px-2 py-1 text-amber-500"
                            aria-label={`Remove ${workContextLabel(item)}`}
                          >
                            x
                          </button>
                        </span>
                      ))
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggleWorkContextPanel(entry.id)}
                        className="inline-flex items-center rounded border border-dashed border-amber-300 px-2.5 py-1 text-sm text-amber-800"
                      >
                        + Backlog Item
                      </button>
                    )}
                  </div>
                  {workContextPanelOpen && (
                    <div className="mt-3 rounded border border-amber-100 bg-amber-50/40 p-3" data-review-dismiss-root="work-context-panel">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-amber-950">Backlog Item</span>
                        <button
                          type="button"
                          onClick={() => toggleWorkContextPanel(entry.id)}
                          className="text-sm text-amber-800 underline"
                        >
                          Close
                        </button>
                      </div>
                      <p className="mt-1 text-xs text-amber-800">
                        Link this Entry to the work it evidences. You can leave this blank.
                      </p>
                      {workContextItems.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {workContextItems.map(item => {
                            const selected = selectedWorkContextIds.has(item.id);
                            return (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => toggleReviewWorkContext(entry.id, item.id)}
                                className={`block w-full rounded border px-3 py-2 text-left ${
                                  selected
                                    ? 'border-amber-300 bg-white text-amber-900'
                                    : 'border-amber-100 bg-white/80 text-gray-800'
                                }`}
                              >
                                <span className="block text-sm font-medium">{workContextLabel(item)}</span>
                                <span className="mt-0.5 block text-xs text-gray-500">
                                  {[workContextTeamLabel(item), item.status === 'needs_more_evidence' ? 'Needs more evidence' : item.status === 'submitted' ? 'Submitted' : 'Claimed'].filter(Boolean).join(' · ')}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {openWorkContextItems.length > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-medium text-amber-900">Open Backlog</p>
                          <div className="mt-2 space-y-2">
                            {openWorkContextItems.map(item => {
                              const busyKey = `claim:${item.id}`;
                              const busy = busyWorkContextIds.has(busyKey);
                              return (
                                <div key={item.id} className="rounded border border-amber-100 bg-white/80 px-3 py-2">
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="text-sm font-medium text-gray-900">{workContextLabel(item)}</p>
                                      <p className="mt-0.5 text-xs text-gray-500">{workContextTeamLabel(item)}</p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => claimReviewBacklogItem(entry.id, item)}
                                      disabled={busy}
                                      className="shrink-0 rounded bg-amber-700 px-3 py-1.5 text-xs font-medium text-white disabled:bg-amber-200"
                                    >
                                      {busy ? 'Claiming...' : 'Claim'}
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {creatableTeams.length > 0 ? (
                        <div className="mt-3 rounded border border-amber-100 bg-white/70 p-3">
                          <p className="text-xs font-medium text-amber-900">Create new work</p>
                          <div className="mt-2 grid gap-2">
                            {creatableTeams.length > 1 && (
                              <select
                                value={selectedCreateTeamId}
                                onChange={(event) => setReviewNewWorkTeamIds(prev => ({ ...prev, [entry.id]: event.target.value }))}
                                className="rounded border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900"
                              >
                                {creatableTeams.map(team => (
                                  <option key={team.id} value={team.id}>{team.name}</option>
                                ))}
                              </select>
                            )}
                            <input
                              type="text"
                              value={reviewNewWorkDescriptions[entry.id] || ''}
                              onChange={(event) => setReviewNewWorkDescriptions(prev => ({ ...prev, [entry.id]: event.target.value }))}
                              placeholder="Short Backlog Item"
                              className="rounded border border-amber-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-amber-500"
                            />
                            <button
                              type="button"
                              onClick={() => createAndClaimReviewBacklogItem(entry.id, selectedCreateTeamId)}
                              disabled={!selectedCreateTeamId || busyWorkContextIds.has(`create:${entry.id}`)}
                              className="justify-self-start rounded bg-amber-700 px-3 py-2 text-sm font-medium text-white disabled:bg-amber-200"
                            >
                              {busyWorkContextIds.has(`create:${entry.id}`) ? 'Creating...' : 'Create and claim'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-3 rounded border border-amber-100 bg-white/70 px-3 py-2 text-xs text-amber-800">
                          This Team only allows planned Backlog work. Claim an open item or talk to the Team Owner.
                        </p>
                      )}

                      {workContextItems.length === 0 && openWorkContextItems.length === 0 && creatableTeams.length === 0 && (
                        <p className="mt-3 text-xs text-amber-800">No open Backlog Items are available right now.</p>
                      )}

                      {workContextPanelError && (
                        <p className="mt-2 text-sm text-red-700">{workContextPanelError}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
              <div className="mb-3 flex flex-wrap gap-2">
                {reviewLocations[entry.id] ? (
                  <span className="inline-flex max-w-full items-center rounded bg-emerald-50 text-sm font-medium text-emerald-700" data-review-dismiss-root="location-trigger">
                    <button
                      type="button"
                      onClick={() => toggleLocationPanel(entry.id)}
                      className="min-w-0 px-2.5 py-1 text-left"
                    >
                      <span className="block truncate">{reviewLocations[entry.id]}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setReviewLocations(prev => ({ ...prev, [entry.id]: '' }));
                        setReviewLocationDrafts(prev => {
                          const next = { ...prev };
                          delete next[entry.id];
                          return next;
                        });
                        persistReviewDraft(entry.id, {
                          draftReviewLocationText: '',
                          draftReviewLocationDraft: null,
                        });
                      }}
                      className="px-2 py-1 text-emerald-500"
                      aria-label="Remove Location"
                    >
                      x
                    </button>
                  </span>
                ) : (
                  <button
                    type="button"
                    data-review-dismiss-root="location-trigger"
                    onClick={() => toggleLocationPanel(entry.id)}
                    className="inline-flex items-center rounded border border-dashed border-emerald-300 px-2.5 py-1 text-sm text-emerald-700"
                  >
                    + Location
                  </button>
                )}
                {selectedContact ? (
                  <button
                    type="button"
                    data-review-dismiss-root="contact-trigger"
                    onClick={() => {
                      openContactCorrection(entry.id);
                    }}
                    className="inline-flex max-w-full items-center rounded bg-violet-50 px-2.5 py-1 text-sm font-medium text-violet-700"
                    >
                      <span className="truncate">{selectedContact.label}</span>
                    </button>
                ) : (
                  <button
                    type="button"
                    data-review-dismiss-root="contact-trigger"
                    onClick={() => openContactCorrection(entry.id)}
                    className="inline-flex items-center rounded border border-dashed border-violet-300 px-2.5 py-1 text-sm text-violet-700"
                  >
                    + Contact
                  </button>
                )}
              </div>

              {locationPanelOpen && (
                <div className="mt-3 rounded border border-emerald-100 bg-emerald-50/30 p-3" data-review-dismiss-root="location-panel">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-emerald-900">Location</span>
                    <button
                      type="button"
                      onClick={() => toggleLocationPanel(entry.id)}
                      className="text-sm text-emerald-700 underline"
                    >
                      Close
                    </button>
                  </div>
                  <label className="mt-2 block">
                    <input
                      type="text"
                      value={reviewLocations[entry.id] || ''}
                      onChange={(event) => {
                        const nextText = event.target.value;
                        setReviewLocations(prev => ({ ...prev, [entry.id]: nextText }));
                        setReviewLocationDrafts(prev => {
                          const next = { ...prev };
                          delete next[entry.id];
                          return next;
                        });
                        persistReviewDraft(entry.id, {
                          draftReviewLocationText: nextText,
                          draftReviewLocationDraft: null,
                        });
                      }}
                      placeholder="+ Location"
                      className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-emerald-500"
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
                              const draft = locationDraftFromCandidate(candidate);
                              setReviewLocations(prev => ({ ...prev, [entry.id]: candidate.label }));
                              setReviewLocationDrafts(prev => ({ ...prev, [entry.id]: draft }));
                              setReviewLocationPanels(prev => ({ ...prev, [entry.id]: false }));
                              persistReviewDraft(entry.id, {
                                draftReviewLocationText: candidate.label,
                                draftReviewLocationDraft: draft,
                              });
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
                  {locationPanelError && (
                    <p className="mt-2 text-sm text-red-700">{locationPanelError}</p>
                  )}
                </div>
              )}

              {contactPanelOpen && (
              <div className="mt-3 rounded border border-violet-100 bg-violet-50/30 p-3" data-review-dismiss-root="contact-panel">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-violet-900">Contact</span>
                    <button
                      type="button"
                      onClick={() => resetContactCorrection(entry.id)}
                      className="text-sm text-violet-700 underline"
                    >
                      Close
                    </button>
                  </div>
                  {selectedContact && (
                    <button
                      type="button"
                      onClick={() => {
                        setReviewContacts(prev => ({ ...prev, [entry.id]: null }));
                        persistReviewDraft(entry.id, { draftReviewContactId: null });
                      }}
                      className="mt-2 text-sm text-violet-700 underline"
                    >
                      Remove Contact
                    </button>
                  )}
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
                            onClick={() => {
                              setReviewContacts(prev => ({ ...prev, [entry.id]: candidate.id }));
                              resetContactCorrection(entry.id);
                              persistReviewDraft(entry.id, { draftReviewContactId: candidate.id });
                            }}
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
                  <div className="mt-3">
                    <div className="flex gap-2">
                        <input
                          type="text"
                          value={contactSearch}
                          onChange={(event) => handleContactSearchChange(entry.id, event.target.value)}
                          placeholder="Search saved Contacts"
                          className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-violet-500"
                        />
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
                    {contactPanelError && (
                      <p className="mt-2 text-sm text-red-700">{contactPanelError}</p>
                    )}
                  </div>
                </div>
              )}

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
              disabled={isConfirming || photosPending || photosFailed || queryTextEmpty}
              title={queryTextEmpty ? 'Type a search query first' : undefined}
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
    const confirmedPhotoAttachments = (entry.attachments || []).filter(attachment => attachment.kind === 'photo' && attachment.status === 'ready');
    return (
      <div key={entry.id} className="py-3 border-b border-gray-100 last:border-b-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm text-gray-900 font-medium">{entry.summary || entry.transcript || 'Untitled'}</p>
          <span className="text-xs shrink-0" title={entry.syncStatus === 'synced' ? 'Saved to cloud' : 'Pending sync'}>
            {entry.syncStatus === 'synced' ? '☁️' : '⏳'}
          </span>
        </div>
        <p className="text-xs text-gray-500 mt-1">{formatTime(new Date(entry.createdAt))}</p>
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
        {confirmedPhotoAttachments.length > 0 && (
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {confirmedPhotoAttachments.map(attachment => (
              <PhotoAttachmentThumb key={attachment.id} attachment={attachment} />
            ))}
          </div>
        )}
        {entryWorkContexts.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {entryWorkContexts.map(context => (
              <span key={context.id || context.label} className="inline-flex max-w-full items-center rounded bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                <span className="truncate">{context.label || context.description}</span>
              </span>
            ))}
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
    const primaryLocation = Array.isArray(entry.locations) && entry.locations.length > 0
      ? entry.locations[0]
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
    const primaryContact = Array.isArray(entry.contacts) && entry.contacts.length > 0
      ? entry.contacts[0]
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
    const tags = Array.isArray(entry.tags) && entry.tags.length > 0
      ? entry.tags
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
        
        <GlobalMenu
          currentScreen="home"
          onNavigate={onNavigate}
          user={user}
        />
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
                    <p className="text-xs text-gray-500 mt-1">{formatTime(new Date(entry.createdAt))}</p>
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
            <p className="text-xs mt-1">Tap + to start an entry</p>
          </div>
        )}
        {!activeQuery && entries.length > 0 && (
          <div className="py-2">
            {entries.map(renderEntry)}
          </div>
        )}
      </div>

      {ENABLE_TRANSCRIPTION_CAPTURE && isRecording ? (
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
      ) : ENABLE_TRANSCRIPTION_CAPTURE ? (
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
      ) : (
        <button
          onClick={startTextCapture}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-white shadow-lg transition hover:bg-gray-800 disabled:opacity-70"
          title="Start entry"
          aria-label="Start entry"
          disabled={isLoading}
        >
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>
      )}
    </div>
  );
}
