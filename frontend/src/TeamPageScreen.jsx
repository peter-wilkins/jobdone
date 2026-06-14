import { useCallback, useEffect, useRef, useState } from 'react';
import { CaptureComposer } from './CaptureComposer';
import { PhotoAttachmentControls } from './PhotoAttachmentControls';
import { apiService } from './services/apiService';
import { authService } from './services/authService';
import { dbService } from './services/dbService';
import { syncConfirmedEntryAfterReview } from './services/entryConfirmSyncService';
import { usePhotoAttachments } from './services/photoAttachmentHooks';
import {
  backlogItemContextSnapshot,
  canLoadTeamPageState,
  loadCachedTeamPageState,
  buildTeamTimelineEntries,
  searchTeamContext,
  saveCachedTeamPageState,
  teamContextSnapshot,
} from './services/teamPageService';
import { CLAIM_RACE_FEEDBACK_MS } from './services/teamWorkItemService';
import { OpenItem, WorkItem } from './TeamWorkItems';

const EMPTY_BACKLOG_FORM = { description: '', points: 3 };

function pointsOptions() {
  return Array.from({ length: 10 }, (_, index) => index + 1);
}

function approvalStatusText(status) {
  if (status === 'needs_more_evidence') return 'Needs more evidence';
  if (status === 'submitted') return 'Submitted';
  return status || 'Submitted';
}

function ReviewRequestRow({ request, busy, onDecision }) {
  const item = request.backlog_item || {};
  const isSubmitted = request.status === 'submitted';
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <p className="text-sm font-medium text-gray-900 leading-5">{item.description || 'Submitted work'}</p>
      <p className="mt-1 text-xs text-gray-500">{approvalStatusText(request.status)}</p>
      {request.evidence_text && (
        <p className="mt-2 text-sm leading-5 text-gray-700">{request.evidence_text}</p>
      )}
      {isSubmitted ? (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision(request, 'needs_more_evidence')}
            className="px-3 py-2 text-sm font-medium text-amber-800 border border-amber-200 rounded hover:bg-amber-50 disabled:opacity-50"
          >
            Needs more evidence
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecision(request, 'approved')}
            className="px-3 py-2 text-sm font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50"
          >
            Approve
          </button>
        </div>
      ) : (
        <p className="mt-2 text-xs text-gray-400">Waiting for more evidence.</p>
      )}
    </div>
  );
}

function entryText(entry) {
  return entry?.text || entry?.transcript || entry?.summary || entry?.cleanedText || 'Entry';
}

function TimelineItem({ entry }) {
  const timelineContext = entry?.timelineContext || null;
  const timelineMeta = [timelineContext?.label, timelineContext?.statusText]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <p className="text-sm text-gray-800 leading-5 max-h-16 overflow-hidden">{entryText(entry)}</p>
      {timelineMeta && (
        <p className="mt-1 text-xs text-gray-500">{timelineMeta}</p>
      )}
      <p className="mt-1 text-xs text-gray-400">
        {entry.createdAt || entry.created_at || ''}
      </p>
    </div>
  );
}

export function TeamPageScreen({ teamId, onBack, onNavigate, user }) {
  const initialCache = loadCachedTeamPageState(teamId);
  const [team, setTeam] = useState(() => initialCache?.team || null);
  const [inProgressItems, setInProgressItems] = useState(() => initialCache?.inProgressItems || []);
  const [openBacklogItems, setOpenBacklogItems] = useState(() => initialCache?.openBacklogItems || []);
  const [approvedItems, setApprovedItems] = useState(() => initialCache?.approvedItems || []);
  const [activeApprovalRequests, setActiveApprovalRequests] = useState(() => initialCache?.activeApprovalRequests || []);
  const [recentEntries, setRecentEntries] = useState([]);
  const [teamAccess, setTeamAccess] = useState(() => initialCache?.teamAccess || { canCreateBacklogItems: false, canEditTeam: false, canCreateTimelineEntries: false });
  const [isAddingBacklog, setIsAddingBacklog] = useState(false);
  const [backlogForm, setBacklogForm] = useState(EMPTY_BACKLOG_FORM);
  const [isSavingBacklog, setIsSavingBacklog] = useState(false);
  const [isSavingTeamCapture, setIsSavingTeamCapture] = useState(false);
  const [backlogError, setBacklogError] = useState(null);
  const [busyItemId, setBusyItemId] = useState(null);
  const [busyApprovalId, setBusyApprovalId] = useState(null);
  const [claimErrors, setClaimErrors] = useState({});
  const [teamSearchText, setTeamSearchText] = useState('');
  const teamCapturePhotos = usePhotoAttachments();
  const [isLoading, setIsLoading] = useState(() => !initialCache);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [staleError, setStaleError] = useState(null);
  const [restoredUser, setRestoredUser] = useState(() => user || authService.getUser());
  const [isAuthChecking, setIsAuthChecking] = useState(() => !user?.id && !authService.getUser()?.id);
  const claimErrorsRef = useRef({});
  const hasInitialCacheRef = useRef(Boolean(initialCache));
  const effectiveUser = user?.id ? user : restoredUser?.id ? restoredUser : authService.getUser();

  useEffect(() => {
    let cancelled = false;
    const applyUser = (nextUser) => {
      if (cancelled) return;
      setRestoredUser(nextUser || null);
      setIsAuthChecking(false);
    };

    const unsubscribe = authService.onChange((_event, session) => {
      applyUser(session?.user || null);
    });

    if (!user?.id && !authService.getUser()?.id) {
      authService.init()
        .then(session => applyUser(session?.user || null))
        .catch(() => applyUser(null));
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [user]);

  const loadRecentEntries = useCallback(async () => {
    try {
      const entries = await dbService.getEntries('confirmed');
      setRecentEntries(entries.slice(0, 50));
    } catch {
      setRecentEntries([]);
    }
  }, []);

  const loadTeamState = useCallback(async ({ showLoading = true, showRefreshing = true } = {}) => {
    if (!teamId) return;
    if (!canLoadTeamPageState({ teamId, user: effectiveUser })) {
      if (showLoading) setIsLoading(false);
      return;
    }
    if (showLoading) {
      setIsLoading(true);
    } else if (showRefreshing) {
      setIsRefreshing(true);
    }
    setStaleError(null);
    try {
      const [workState, reviewState] = await Promise.all([
        apiService.getTeamWorkState(teamId),
        apiService.getTeamReviewState().catch(() => ({ activeApprovalRequests: [], ownedTeams: [] })),
      ]);
      const nextTeam = workState.team || (workState.teams || []).find(candidate => candidate.id === teamId) || null;
      const fetchedOpenItems = workState.openBacklogItems || [];
      const nextTeamAccess = workState.teamAccess || { canCreateBacklogItems: false, canEditTeam: false };
      const nextInProgressItems = workState.inProgressItems || [];
      const nextApprovedItems = workState.approvedItems || [];
      const nextActiveApprovalRequests = (reviewState.activeApprovalRequests || []).filter(request => request.team_id === teamId);
      setTeam(nextTeam);
      setTeamAccess(nextTeamAccess);
      setInProgressItems(nextInProgressItems);
      setOpenBacklogItems(previousOpenItems => {
        const fetchedIds = new Set(fetchedOpenItems.map(item => item.id));
        const now = Date.now();
        const staleRaceItems = previousOpenItems.filter(item => {
          const claimError = claimErrorsRef.current[item.id];
          return claimError?.expiresAt > now && !fetchedIds.has(item.id);
        });
        return [...fetchedOpenItems, ...staleRaceItems];
      });
      setApprovedItems(nextApprovedItems);
      setActiveApprovalRequests(nextActiveApprovalRequests);
      saveCachedTeamPageState(teamId, {
        team: nextTeam,
        teamAccess: nextTeamAccess,
        inProgressItems: nextInProgressItems,
        openBacklogItems: fetchedOpenItems,
        approvedItems: nextApprovedItems,
        activeApprovalRequests: nextActiveApprovalRequests,
      });
      setClaimErrors(errors => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(errors).filter(([, claimError]) => claimError.expiresAt > now));
        claimErrorsRef.current = next;
        return next;
      });
    } catch (err) {
      setStaleError(err.message || 'Could not refresh Team');
    } finally {
      if (showLoading) {
        setIsLoading(false);
      } else if (showRefreshing) {
        setIsRefreshing(false);
      }
    }
  }, [teamId, effectiveUser]);

  useEffect(() => {
    loadTeamState({ showLoading: !hasInitialCacheRef.current });
    loadRecentEntries();
  }, [loadRecentEntries, loadTeamState]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        loadTeamState({ showLoading: false });
        loadRecentEntries();
      }
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadRecentEntries, loadTeamState]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadTeamState({ showLoading: false, showRefreshing: false });
        loadRecentEntries();
      }
    }, 10000);
    return () => clearInterval(intervalId);
  }, [loadRecentEntries, loadTeamState]);

  const pointsEnabled = Boolean(team?.points_enabled);
  const usesManualApproval = team?.approval_mode === 'manual';
  const canCreateBacklogItems = Boolean(teamAccess?.canCreateBacklogItems);
  const canEditTeam = Boolean(teamAccess?.canEditTeam);
  const canCreateTimelineEntries = Boolean(teamAccess?.canCreateTimelineEntries || canCreateBacklogItems || canEditTeam);
  const teamTimelineEntries = buildTeamTimelineEntries({
    entries: recentEntries,
    teamId,
    teamName: team?.name,
    inProgressItems,
    approvedItems,
  }).slice(0, 10);
  const trimmedTeamSearchText = teamSearchText.trim();
  const teamSearchResults = trimmedTeamSearchText
    ? searchTeamContext({
        query: trimmedTeamSearchText,
        team,
        teamId,
        entries: recentEntries,
        openBacklogItems,
        inProgressItems,
        approvedItems,
        activeApprovalRequests,
      })
    : null;

  const editTeam = () => {
    onNavigate?.(`team-setup?team_id=${encodeURIComponent(teamId)}`);
  };

  const claimItem = async (item) => {
    setBusyItemId(item.id);
    setError(null);
    try {
      await apiService.claimTeamBacklogItem(item.id);
      setClaimErrors(errors => {
        const next = { ...errors };
        delete next[item.id];
        claimErrorsRef.current = next;
        return next;
      });
      await loadTeamState();
    } catch (err) {
      const claimError = {
        message: err.message || 'Great news! Someone else just claimed this task.',
        expiresAt: Date.now() + CLAIM_RACE_FEEDBACK_MS,
      };
      setClaimErrors(errors => {
        const next = { ...errors, [item.id]: claimError };
        claimErrorsRef.current = next;
        return next;
      });
    } finally {
      setBusyItemId(null);
    }
  };

  const submitItem = async (item, evidenceText, attachments = []) => {
    setBusyItemId(item.id);
    setError(null);
    try {
      const trimmedEvidenceText = String(evidenceText || '').trim();
      const entryText = trimmedEvidenceText || 'Photo evidence attached.';
      const contextSnapshot = backlogItemContextSnapshot(item);
      if (entryText || attachments.length) {
        const entryId = await dbService.createTextEntry({
          source: 'team_backlog_evidence',
          intent: 'NOTE',
          text: entryText,
          attachments,
        });
        let entry = await dbService.confirmEntry(entryId, {
          workContexts: contextSnapshot ? [contextSnapshot] : [],
        });
        try {
          const syncOutcome = await syncConfirmedEntryAfterReview({
            entryId,
            entry,
            user: effectiveUser,
            reason: 'team_backlog_evidence',
          });
          if (syncOutcome.entry) entry = syncOutcome.entry;
        } catch (syncErr) {
          console.warn('[Team] Evidence Entry sync failed, entry saved locally:', syncErr);
        }
        setRecentEntries(previous => [entry, ...previous.filter(existing => existing.id !== entry.id)].slice(0, 50));
      }
      await apiService.submitTeamBacklogItem(item.id, { evidence_text: entryText });
      await loadTeamState();
    } catch (err) {
      throw new Error(err.message || 'Could not submit evidence', { cause: err });
    } finally {
      setBusyItemId(null);
    }
  };

  const decideApproval = async (request, decision) => {
    setBusyApprovalId(request.id);
    setError(null);
    try {
      await apiService.decideTeamApprovalRequest(request.id, decision, teamId);
      await loadTeamState({ showLoading: false });
    } catch (err) {
      setError(err.message || 'Could not update Approval Request');
    } finally {
      setBusyApprovalId(null);
    }
  };

  const saveBacklogItem = async (event) => {
    event.preventDefault();
    if (!team?.id) return;
    setIsSavingBacklog(true);
    setBacklogError(null);
    try {
      await apiService.createTeamBacklogItem({
        teamId: team.id,
        description: backlogForm.description,
        points: pointsEnabled ? backlogForm.points : null,
      });
      setBacklogForm(EMPTY_BACKLOG_FORM);
      setIsAddingBacklog(false);
      await loadTeamState({ showLoading: false });
    } catch (err) {
      setBacklogError(err.message || 'Could not add Backlog Item');
    } finally {
      setIsSavingBacklog(false);
    }
  };

  const saveTeamCapture = async ({ text, attachments = [] }) => {
    const teamSnapshot = teamContextSnapshot(team);
    if (!teamSnapshot) throw new Error('Team is not ready yet.');

    setIsSavingTeamCapture(true);
    try {
      const entryText = String(text || '').trim();
      const entryId = await dbService.createTextEntry({
        source: 'team_page',
        intent: 'NOTE',
        text: entryText,
        attachments,
      });
      let entry = await dbService.updateEntry(entryId, {
        summary: entryText,
        transcript: entryText,
        intent: 'NOTE',
      });
      const confirmedEntry = await dbService.confirmEntry(entryId, {
        workContexts: [teamSnapshot],
      });
      entry = { ...entry, ...confirmedEntry };

      try {
        const syncOutcome = await syncConfirmedEntryAfterReview({
          entryId,
          entry,
          user: effectiveUser,
          reason: 'team_page_capture',
        });
        if (syncOutcome.entry) entry = syncOutcome.entry;
      } catch (syncErr) {
        console.warn('[Team] Team Entry sync failed, entry saved locally:', syncErr);
      }

      setRecentEntries(previous => [entry, ...previous.filter(item => item.id !== entry.id)].slice(0, 50));
      await loadRecentEntries();
      teamCapturePhotos.reset();
      return entry;
    } catch (err) {
      throw new Error(err?.message || 'Could not save Team entry', { cause: err });
    } finally {
      setIsSavingTeamCapture(false);
    }
  };

  const renderTeamSearchResults = () => {
    if (!teamSearchResults) return null;

    return (
      <section className="rounded border border-gray-200 px-3 py-3">
        <div className="flex items-baseline justify-between border-b border-gray-100 pb-2">
          <h2 className="text-sm font-semibold text-gray-900">Search Results</h2>
          <span className="text-xs text-gray-400">{trimmedTeamSearchText}</span>
        </div>
        {!teamSearchResults.hasResults ? (
          <div className="py-5 text-sm text-gray-400">
            <p>No Team matches.</p>
            <p className="mt-2 text-xs leading-5">Try Home for private notes, or Contacts/Locations for clues.</p>
          </div>
        ) : (
          <div className="space-y-4 pt-3">
            {teamSearchResults.backlogItems.length > 0 && (
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Backlog</h3>
                  <span className="text-xs text-gray-400">{teamSearchResults.backlogItems.length}</span>
                </div>
                <div>
                  {teamSearchResults.backlogItems.map(item => (
                    <div key={item.id} className="py-2 border-b border-gray-100 last:border-b-0">
                      <p className="text-sm font-medium text-gray-900 leading-5">{item.description || item.title || 'Backlog Item'}</p>
                      <p className="mt-1 text-xs text-gray-500">{item.status || 'backlog'}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {teamSearchResults.entries.length > 0 && (
              <div>
                <div className="mb-1 flex items-baseline justify-between">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Entries</h3>
                  <span className="text-xs text-gray-400">{teamSearchResults.entries.length}</span>
                </div>
                <div>
                  {teamSearchResults.entries.map(entry => (
                    <TimelineItem key={entry.id} entry={entry} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      <div className="border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="w-8 h-8 flex items-center justify-center text-gray-500 hover:text-gray-700"
          title="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Team Context</p>
          <h1 className="truncate text-xl font-light text-gray-900 leading-6">{team?.name || 'Team'}</h1>
        </div>
        {canEditTeam && (
          <button
            type="button"
            onClick={editTeam}
            className="mr-12 shrink-0 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
          >
            Edit
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {(staleError || isRefreshing) && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-amber-800">
            {isRefreshing ? 'Refreshing Team...' : 'Team may be out of date.'}
          </p>
          {!isRefreshing && (
            <button
              type="button"
              onClick={() => loadTeamState({ showLoading: false })}
              className="shrink-0 text-xs font-medium text-amber-900 hover:text-amber-700"
            >
              Retry
            </button>
          )}
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
        ) : isAuthChecking && !effectiveUser ? (
          <div className="py-8 text-center text-sm text-gray-400">Checking sign-in...</div>
        ) : !effectiveUser ? (
          <section className="py-8">
            <h2 className="text-sm font-semibold text-gray-900">Log in to open this Team</h2>
            <p className="mt-2 text-sm leading-5 text-gray-500">JobDone uses your email to find Teams you can read.</p>
            <button
              type="button"
              onClick={() => onNavigate?.('login')}
              className="mt-4 w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800"
            >
              Log in
            </button>
          </section>
        ) : !team ? (
          <section className="py-8">
            <h2 className="text-sm font-semibold text-gray-900">Team not found</h2>
            <p className="mt-2 text-sm leading-5 text-gray-500">This Team is not available to this account.</p>
          </section>
        ) : (
          <>
            <section>
              <input
                type="search"
                value={teamSearchText}
                onChange={(event) => setTeamSearchText(event.target.value)}
                placeholder={`Search ${team?.name || 'this Team'}`}
                aria-label="Search this Team"
                className="w-full rounded border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
              />
            </section>

            {renderTeamSearchResults()}

            {canCreateTimelineEntries ? (
              <section className="rounded border border-gray-200 px-3 py-3">
                <div className="flex items-baseline justify-between border-b border-gray-100 pb-2">
                  <h2 className="text-sm font-semibold text-gray-900">Team Entry</h2>
                  <span className="text-xs text-gray-400">Timeline</span>
                </div>
                <CaptureComposer
                  draftKey={`team-capture:${team.id}`}
                  label={`Entry for ${team.name}`}
                  placeholder={`Capture an update for ${team.name}.`}
                  helperText="Saved to this Team Timeline."
                  submitLabel="Save to Team"
                  discardLabel="Clear"
                  busy={isSavingTeamCapture}
                  requireText={false}
                  attachments={teamCapturePhotos.attachments}
                  rows={4}
                  attachmentSlot={(
                    <PhotoAttachmentControls
                      attachments={teamCapturePhotos.attachments}
                      onAddFiles={teamCapturePhotos.addFiles}
                      onRemove={teamCapturePhotos.removeAttachment}
                      error={teamCapturePhotos.error}
                      disabled={isSavingTeamCapture}
                    />
                  )}
                  onConfirm={saveTeamCapture}
                  onReject={() => teamCapturePhotos.reset()}
                />
              </section>
            ) : (
              <section className="rounded border border-gray-200 px-3 py-3">
                <h2 className="text-sm font-semibold text-gray-900">Team Timeline</h2>
                <p className="mt-2 text-sm leading-5 text-gray-500">
                  This Team Timeline is owner guidance. Add evidence from your claimed Backlog Items.
                </p>
              </section>
            )}

            <section>
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Claimed / In Progress</h2>
                <span className="text-xs text-gray-400">{inProgressItems.length}</span>
              </div>
              {inProgressItems.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">Nothing claimed in this Team.</p>
              ) : (
                inProgressItems.map(item => (
                  <WorkItem
                    key={item.id}
                    item={item}
                    pointsEnabled={pointsEnabled}
                    usesManualApproval={usesManualApproval}
                    recentEntries={recentEntries}
                    busy={busyItemId === item.id}
                    onSubmit={submitItem}
                  />
                ))
              )}
            </section>

            <section>
              <div className="flex items-center justify-between gap-3 border-b border-gray-200 pb-2">
                <div className="flex min-w-0 items-baseline gap-2">
                  <h2 className="text-sm font-semibold text-gray-900">Open Backlog</h2>
                  <span className="text-xs text-gray-400">{openBacklogItems.length}</span>
                </div>
                {canCreateBacklogItems && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingBacklog(open => !open);
                      setBacklogError(null);
                    }}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-gray-300 text-lg leading-none text-gray-700 hover:bg-gray-50"
                    title="Add Backlog Item"
                    aria-label="Add Backlog Item"
                  >
                    +
                  </button>
                )}
              </div>
              {isAddingBacklog && (
                <form onSubmit={saveBacklogItem} className="mt-3 rounded border border-gray-200 px-3 py-3 space-y-3">
                  <div>
                    <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
                      Backlog Item
                    </label>
                    <textarea
                      value={backlogForm.description}
                      onChange={(event) => setBacklogForm(prev => ({ ...prev, description: event.target.value }))}
                      rows={3}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                      placeholder={`What should ${team?.name || 'this Team'} do?`}
                    />
                    {backlogError && (
                      <p className="mt-2 text-xs font-medium text-red-700">{backlogError}</p>
                    )}
                  </div>
                  {pointsEnabled && (
                    <label className="block">
                      <span className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Points</span>
                      <select
                        value={backlogForm.points}
                        onChange={(event) => setBacklogForm(prev => ({ ...prev, points: Number(event.target.value) }))}
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                      >
                        {pointsOptions().map(points => (
                          <option key={points} value={points}>{points}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setBacklogForm(EMPTY_BACKLOG_FORM);
                        setBacklogError(null);
                        setIsAddingBacklog(false);
                      }}
                      className="px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSavingBacklog || !backlogForm.description.trim()}
                      className="px-3 py-2 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-50"
                    >
                      {isSavingBacklog ? 'Adding...' : 'Add'}
                    </button>
                  </div>
                </form>
              )}
              {openBacklogItems.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">No open Backlog Items.</p>
              ) : (
                openBacklogItems.map(item => (
                  <OpenItem
                    key={item.id}
                    item={item}
                    pointsEnabled={pointsEnabled}
                    busy={busyItemId === item.id}
                    claimError={claimErrors[item.id]?.message}
                    onClaim={claimItem}
                  />
                ))
              )}
            </section>

            {activeApprovalRequests.length > 0 && (
              <section>
                <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                  <h2 className="text-sm font-semibold text-gray-900">Needs Review</h2>
                  <span className="text-xs text-gray-400">{activeApprovalRequests.length}</span>
                </div>
                {activeApprovalRequests.map(request => (
                  <ReviewRequestRow
                    key={request.id}
                    request={request}
                    busy={busyApprovalId === request.id}
                    onDecision={decideApproval}
                  />
                ))}
              </section>
            )}

            <section>
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Team Timeline</h2>
                <span className="text-xs text-gray-400">{teamTimelineEntries.length}</span>
              </div>
              {teamTimelineEntries.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">No confirmed entries linked to this Team yet.</p>
              ) : (
                teamTimelineEntries.map(entry => (
                  <TimelineItem key={entry.id} entry={entry} />
                ))
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
