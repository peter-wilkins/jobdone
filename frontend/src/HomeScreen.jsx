import { useState, useEffect, useRef, useCallback } from 'react';
import { dbService } from './services/dbService';
import { apiService } from './services/apiService';
import { syncOrchestratorService } from './services/syncOrchestratorService';
import { syncConfirmedEntryAfterReview } from './services/entryConfirmSyncService';
import { queryHistoryService } from './services/queryHistoryService';
import { preferencesService } from './services/preferencesService';
import { locationClueService } from './services/locationClueService';
import { useOutsideDismiss } from './services/outsideDismissService';
import { recallCoverageFromReplicaState, recallLocalEntriesWithCoverage } from './services/localRecallService';
import { selectPrivateTimelineEntries } from './services/teamPageService';
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
import { captureContextService } from './services/captureContextService';
import { classify } from './services/classifyService';
import { setAppUpdateGuard } from './services/appUpdateGuardService';
import { PhotoAttachmentControls, PhotoAttachmentThumb } from './PhotoAttachmentControls';
import {
  createPendingPhotoAttachmentsFromFiles,
  hasFailedPhotoAttachments,
  hasPendingPhotoAttachments,
  preparePhotoAttachment,
} from './services/photoAttachmentService';
import { GlobalMenu } from './GlobalMenu';
import { formatTime } from './mockData';

// Dev toggle for query-active state testing
const SHOW_QUERY_BAR = false;
const MOCK_QUERY_TEXT = 'Show me radiator fixes from last month';
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
    accuracyMeters: location.accuracyMeters ?? location.accuracy_meters ?? null,
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
    accuracyMeters: candidate.accuracyMeters ?? candidate.accuracy ?? null,
    source: candidate.source || null,
  };
}

function workContextLabel(item) {
  return String(item?.description || item?.title || 'Backlog Item').trim();
}

function workContextTeamLabel(item) {
  return item?.team?.name || item?.teamName || 'Team';
}

export function HomeScreen({
  onNavigate,
  user,
  refreshKey = 0,
  canAutoStart = false,
  recordRequestId = 0,
  onRecordRequestHandled,
  onSyncResult,
  readableTeams = [],
}) {
  const handledRecordRequestRef = useRef(0);

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
  const [, setReviewWorkContextErrors] = useState({});
  const [reviewAttachmentErrors, setReviewAttachmentErrors] = useState({});
  const [reviewNewWorkDescriptions, setReviewNewWorkDescriptions] = useState({});
  const [, setReviewNewWorkTeamIds] = useState({});
  const [reviewTextDrafts, setReviewTextDrafts] = useState({});
  const [debouncedReviewTextDrafts, setDebouncedReviewTextDrafts] = useState({});
  const [, setReviewIntentOverrides] = useState({});
  const [focusEntryId, setFocusEntryId] = useState(null);
  const [busyWorkContextIds, setBusyWorkContextIds] = useState(new Set());
  const [teamWorkContext, setTeamWorkContext] = useState({ hasTeams: false, teams: [], claimedItems: [], openBacklogItems: [] });
  const [reviewExplanationKeys, setReviewExplanationKeys] = useState({});
  const [confirmingIds, setConfirmingIds] = useState(new Set());
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [backendAvailable, setBackendAvailable] = useState(true);
  const [fastCaptureEnabled] = useState(() => preferencesService.isFastCaptureEnabled());
  const [foregroundReturnCount, setForegroundReturnCount] = useState(0);
  const [updateRegistration, setUpdateRegistration] = useState(null);
  const [updateStatus, setUpdateStatus] = useState(null);
  const fastCaptureEnabledAtOpenRef = useRef(fastCaptureEnabled);
  const wasBackgroundedRef = useRef(document.visibilityState === 'hidden');
  const handledForegroundReturnRef = useRef(0);
  const structurePredictionRequestedRef = useRef(new Set());
  const preExtractionFingerprintsRef = useRef(new Map());
  const confirmingIdsRef = useRef(new Set());
  const textAreaRefs = useRef(new Map());
  const textDraftSaveTimersRef = useRef(new Map());
  const compressingAttachmentIdsRef = useRef(new Set());

  // Query/Recall state
  const [activeQuery, setActiveQuery] = useState(null);
  const [queryResults, setQueryResults] = useState(null);
  const [queryCoverage, setQueryCoverage] = useState(null);
  const [isRecalling, setIsRecalling] = useState(false);
  const [queryInputText, setQueryInputText] = useState('');
  const querySearchTimerRef = useRef(null);

  // Query history dropdown state
  const [queryDropdownOpen, setQueryDropdownOpen] = useState(false);
  const [recentQueries, setRecentQueries] = useState([]);
  const dropdownRef = useRef(null);

  // Load query history on mount
  useEffect(() => {
    queryHistoryService.getRecent().then(setRecentQueries);
  }, []);

  const runLocalRecallQuery = useCallback(async (text, { persistToHistory = false } = {}) => {
    setQueryDropdownOpen(false);
    const trimmedText = String(text || '').trim();
    if (!trimmedText) {
      setActiveQuery(null);
      setQueryResults(null);
      setQueryCoverage(null);
      setError(null);
      return;
    }

    setError(null);

    const publishResults = async (results, coverage = null) => {
      setActiveQuery(trimmedText);
      setQueryResults(results);
      setQueryCoverage(coverage);
      if (persistToHistory) {
        await queryHistoryService.add(trimmedText);
        setRecentQueries(await queryHistoryService.getRecent());
      }
    };

    const runPrivateTimelineRecall = async () => {
      const coverage = user
        ? recallCoverageFromReplicaState(await dbService.getLocalReplicaState())
        : null;
      const result = recallLocalEntriesWithCoverage(trimmedText, selectPrivateTimelineEntries(entries), { coverage });
      await publishResults(result.entries, result.coverage);
    };

    setIsRecalling(true);
    try {
      await runPrivateTimelineRecall();
    } catch (err) {
      if (err?.message === 'Failed to fetch' || err?.message?.includes('NetworkError') || !navigator.onLine) {
        await runPrivateTimelineRecall();
      } else if (err?.status === 401 || err?.status === 403) {
        await runPrivateTimelineRecall();
      } else if (err?.status === 400) {
        setError(err?.message || null);
      } else {
        setError('Something went wrong — try again.');
      }
    } finally {
      setIsRecalling(false);
    }
  }, [entries, user]);

  useEffect(() => {
    const trimmedQueryInput = queryInputText.trim();

    if (querySearchTimerRef.current) {
      window.clearTimeout(querySearchTimerRef.current);
      querySearchTimerRef.current = null;
    }

    if (!trimmedQueryInput) {
      void runLocalRecallQuery('');
      return;
    }

    querySearchTimerRef.current = window.setTimeout(() => {
      void runLocalRecallQuery(trimmedQueryInput);
    }, 180);

    return () => {
      if (querySearchTimerRef.current) {
        window.clearTimeout(querySearchTimerRef.current);
        querySearchTimerRef.current = null;
      }
    };
  }, [queryInputText, runLocalRecallQuery]);

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
                captureContext: captureContextService.get(),
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

  useEffect(() => {
    if (!recordRequestId || handledRecordRequestRef.current === recordRequestId) return;
    if (isLoading || activeQuery) return;
    if (document.visibilityState !== 'visible') return;

    handledRecordRequestRef.current = recordRequestId;
    const timer = window.setTimeout(() => {
      startTextCapture();
      onRecordRequestHandled?.();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordRequestId, isLoading, activeQuery]);

  useEffect(() => {
    const isForegroundReturn = foregroundReturnCount > handledForegroundReturnRef.current;
    const isInitialAutoStart = foregroundReturnCount === 0;

    if (!fastCaptureEnabled) return;
    if (isInitialAutoStart && !fastCaptureEnabledAtOpenRef.current) return;
    if (isInitialAutoStart && !canAutoStart) return;
    if (isInitialAutoStart && fastCaptureAttemptedThisRun) return;
    if (!isInitialAutoStart && !isForegroundReturn) return;
    if (isLoading || activeQuery) return;
    if (document.visibilityState !== 'visible') return;

    if (isForegroundReturn) {
      handledForegroundReturnRef.current = foregroundReturnCount;
    } else {
      fastCaptureAttemptedThisRun = true;
    }

    const timer = window.setTimeout(() => {
      startTextCapture();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fastCaptureEnabled, canAutoStart, foregroundReturnCount, isLoading, activeQuery]);

  const handleApplyUpdate = async () => {
    if (updateRegistration) {
      await applyServiceWorkerUpdate(updateRegistration);
      return;
    }
    window.location.reload();
  };

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
      const nextIntent = 'NOTE';
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

      // Move the local Entry draft into confirmed state after Confirmation.
      const locationText = (reviewLocations[id] || '').trim();
      const selectedLocationDraft = reviewLocationDrafts[id];
      const locations = locationText
        ? [{ ...(selectedLocationDraft || {}), displayName: locationText, placeText: selectedLocationDraft?.placeText || locationText }]
        : [];
      const { contact } = selectedPredictionCandidates(id);
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
      const confirmedEntry = await dbService.confirmEntry(id, { locations, contacts, tags: [], workContexts: [] });
      let timelineEntry = { ...entry, ...confirmedEntry };

      // Try to sync to cloud (optional - don't block if it fails)
      if (timelineEntry && timelineEntry.transcript && timelineEntry.summary) {
        try {
          const syncOutcome = await syncConfirmedEntryAfterReview({
            entryId: id,
            entry: timelineEntry,
            user,
            reason: 'entry_confirm',
          });
          if (syncOutcome.entry) {
            timelineEntry = syncOutcome.entry;
          }
          if (syncOutcome.syncResult?.ok === false) {
            console.warn('[UI] Cloud sync had issues, entry saved locally:', syncOutcome.syncResult.issues);
          }
        } catch (syncErr) {
          console.warn('[UI] Cloud sync failed, entry saved locally:', syncErr);
          // Don't fail the UI - entry is safe locally, will retry on next login
        }
      }

      // Update UI ordering: move confirmed Entries to the confirmed section after Confirmation.
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

  const refreshBackendStatus = async () => {
    const isAvailable = await apiService.checkHealth();
    setBackendAvailable(isAvailable);
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
        accuracyMeters: clue.payload.accuracyMeters ?? clue.payload.accuracy ?? null,
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
        accuracyMeters: strengthenedDraft.accuracyMeters ?? null,
        source: selectedDraft.source || 'location_history',
      });
    } catch (err) {
      console.error('Failed to strengthen Location:', err);
      setReviewLocationErrors(prev => ({ ...prev, [entry.id]: 'Current location is unavailable right now.' }));
    }
  };

  // Load entries from database on mount
  useEffect(() => {
    const loadJobs = async () => {
      try {
        const readyForReviewEntries = await dbService.getEntries('ready_for_review');
        const failedEntries = await dbService.getEntries('failed');
        const confirmedEntries = await dbService.getEntries('confirmed');

        // Merge all entries: in-review first, then confirmed (newest first)
        const allInProgress = [...readyForReviewEntries, ...failedEntries];
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

        const isAvailable = await refreshBackendStatus();

        // Retry any confirmed entries that never made it to the cloud
        if (isAvailable) {
          const pending = sortedConfirmed.filter(e => e.syncStatus === 'pending' && e.transcript && e.summary);
          if (pending.length) {
            try {
              const result = await syncOrchestratorService.syncConfirmedData({ reason: 'home_load_retry' });
              onSyncResult?.(result);
              if (result?.ok === false) {
                console.warn('[UI] Retry sync had issues:', result.issues);
              } else {
                const refreshedConfirmed = await dbService.getEntries('confirmed');
                const refreshedById = new Map(refreshedConfirmed.map(entry => [entry.id, entry]));
                setEntries(prev => prev.map(entry => refreshedById.get(entry.id) || entry));
              }
            } catch (e) {
              console.warn('[UI] Retry sync failed for confirmed Entries', e);
              onSyncResult?.({ ok: false, issues: [{ message: e?.message || 'Sync failed' }] });
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
  }, []);

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
              setQueryInputText('');
              setQueryResults(null);
              setQueryCoverage(null);
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
            void runLocalRecallQuery(queryInputText, { persistToHistory: true });
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
              onFocus={() => {
                setQueryDropdownOpen(true);
              }}
              placeholder="Search private Timeline"
              className="h-9 w-full rounded-full border border-gray-200 bg-gray-50 pl-9 pr-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:bg-white focus:ring-2 focus:ring-gray-100"
              aria-label="Search private Timeline"
            />
          </div>
        </form>

        {/* Dropdown */}
        {queryDropdownOpen && !trimmedQueryInput && visibleRecentQueries.length > 0 && (
          <div className="absolute left-4 right-4 top-12 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
            <div className="p-2">
              {visibleRecentQueries.map((q, i) => (
                <button
                  key={q.id || i}
                  onClick={() => {
                    setQueryInputText(q.text);
                    void runLocalRecallQuery(q.text, { persistToHistory: true });
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

  const renderEntry = (entry) => {
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

    if (entry.status === 'ready_for_review') {
      const { candidateSet, contact: selectedContact } = selectedPredictionCandidates(entry.id);
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
      const reviewEntryText = entry.summary || entry.transcript || '';
      const editableReviewText = Object.prototype.hasOwnProperty.call(reviewTextDrafts, entry.id)
        ? reviewTextDrafts[entry.id]
        : reviewEntryText;
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
              intent: 'NOTE',
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
            intent: 'NOTE',
          });
        } catch (err) {
          console.warn('[Capture] Draft save failed:', err);
        }
      };
      const showSeparateTranscript = Boolean(entry.transcript && entry.transcript !== entry.summary);
      const attachments = entry.attachments || [];
      const attachmentError = reviewAttachmentErrors[entry.id];
      const photosPending = hasPendingPhotoAttachments(attachments);
      const photosFailed = hasFailedPhotoAttachments(attachments);
      const canConfirm = Boolean(editableReviewText.trim() || attachments.some(attachment => attachment.kind === 'photo' && attachment.status === 'ready'));
      const shouldShowWorkContext = false;
      const selectedWorkContextItems = [];
      const workContextPanelOpen = false;
      const workContextPanelError = null;
      const workContextItems = [];
      const openWorkContextItems = [];
      const creatableTeams = [];
      const selectedCreateTeamId = '';
      const selectedWorkContextIds = new Set();
      const showTags = false;
      const structure = {};
      const tagGroups = {};
      const selectedTagIds = new Set();

      return (
        <div key={entry.id} className="py-4 border-b border-gray-100 last:border-b-0">
          <div className="mb-4">
              <textarea
                ref={(node) => {
                  if (node) textAreaRefs.current.set(entry.id, node);
                  else textAreaRefs.current.delete(entry.id);
                }}
                value={editableReviewText}
                onChange={(event) => updateReviewText(event.target.value)}
                onBlur={saveReviewTextNow}
                rows={Math.max(5, Math.min(18, editableReviewText.split('\n').length + Math.ceil(editableReviewText.length / 44) + 2))}
                placeholder="Type here or use keyboard dictation."
                className="mb-3 min-h-32 w-full resize-y rounded border border-gray-200 px-3 py-2 text-sm leading-6 text-gray-900 placeholder:text-gray-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
              {showSeparateTranscript && (
                <p className="text-sm text-gray-600 mb-3">{entry.transcript}</p>
              )}

              <PhotoAttachmentControls
                attachments={attachments}
                onAddFiles={(files) => handleAddPhotoAttachments(entry.id, files)}
                onRemove={(attachmentId) => removePhotoAttachment(entry.id, attachmentId)}
                error={attachmentError}
                disabled={isConfirming}
              />

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

              {showTags && (
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
              )}
            </div>
          
          {isConfirming && (
            <div className="mb-3 flex items-center gap-2 rounded bg-blue-50 px-3 py-2 text-sm text-blue-700">
              <span className="h-4 w-4 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <span>{user ? 'Saving and syncing...' : 'Saving locally...'}</span>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Discard this capture?')) handleReject(entry.id);
              }}
              disabled={isConfirming}
              className="flex h-9 w-9 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-50 transition disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
              title="Discard"
              aria-label="Discard"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => handleConfirm(entry.id)}
              disabled={isConfirming || photosPending || photosFailed || !canConfirm}
              className="flex h-9 w-9 items-center justify-center rounded bg-gray-900 text-white hover:bg-gray-800 transition disabled:cursor-not-allowed disabled:bg-gray-300"
              title="Confirm"
              aria-label="Confirm"
            >
              {isConfirming ? (
                <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
              ) : (
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              )}
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
      {/* Header */}
      <div className="border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="min-w-0">
          <h1 className="text-xl font-light text-gray-900 leading-5">JobDone</h1>
          <p className="text-[10px] leading-4 text-gray-400 font-mono">build {BUILD_ID}</p>
        </div>

        <GlobalMenu
          currentScreen="home"
          onNavigate={onNavigate}
          user={user}
          teams={readableTeams}
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
            {queryCoverage?.status && queryCoverage.status !== 'complete' && (
              <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {queryCoverage.message || 'Search is still catching up.'}
              </p>
            )}
            {queryResults === null ? (
              <div className="py-12 text-center text-gray-400">
                <p className="text-sm">Searching...</p>
              </div>
            ) : queryResults.length === 0 ? (
              <div className="py-12 text-center text-gray-400">
                <p className="text-sm">Nothing found in private Timeline.</p>
                <p className="mt-2 text-xs leading-5 text-gray-400">Try the relevant Team, Contacts, or Locations page.</p>
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
    </div>
  );
}
