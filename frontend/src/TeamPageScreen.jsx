import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from './services/apiService';
import { dbService } from './services/dbService';
import { selectTeamTimelineEntries } from './services/teamPageService';
import { CLAIM_RACE_FEEDBACK_MS } from './services/teamWorkItemService';
import { FinishedItem, OpenItem, WorkItem } from './TeamWorkItems';

const TEAM_EDIT_SELECTED_TEAM_KEY = 'jobdone.teamEdit.selectedTeamId';

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
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <p className="text-sm text-gray-800 leading-5 max-h-16 overflow-hidden">{entryText(entry)}</p>
      <p className="mt-1 text-xs text-gray-400">
        {entry.createdAt || entry.created_at || ''}
      </p>
    </div>
  );
}

export function TeamPageScreen({ teamId, onBack, onNavigate, user }) {
  const [team, setTeam] = useState(null);
  const [inProgressItems, setInProgressItems] = useState([]);
  const [openBacklogItems, setOpenBacklogItems] = useState([]);
  const [approvedItems, setApprovedItems] = useState([]);
  const [activeApprovalRequests, setActiveApprovalRequests] = useState([]);
  const [recentEntries, setRecentEntries] = useState([]);
  const [busyItemId, setBusyItemId] = useState(null);
  const [busyApprovalId, setBusyApprovalId] = useState(null);
  const [claimErrors, setClaimErrors] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [staleError, setStaleError] = useState(null);
  const claimErrorsRef = useRef({});

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
      setTeam(nextTeam);
      setInProgressItems(workState.inProgressItems || []);
      setOpenBacklogItems(previousOpenItems => {
        const fetchedIds = new Set(fetchedOpenItems.map(item => item.id));
        const now = Date.now();
        const staleRaceItems = previousOpenItems.filter(item => {
          const claimError = claimErrorsRef.current[item.id];
          return claimError?.expiresAt > now && !fetchedIds.has(item.id);
        });
        return [...fetchedOpenItems, ...staleRaceItems];
      });
      setApprovedItems(workState.approvedItems || []);
      setActiveApprovalRequests((reviewState.activeApprovalRequests || []).filter(request => request.team_id === teamId));
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
  }, [teamId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTeamState();
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
  const teamTimelineEntries = selectTeamTimelineEntries(recentEntries, teamId, team?.name).slice(0, 10);

  const editTeam = () => {
    try {
      if (teamId) sessionStorage.setItem(TEAM_EDIT_SELECTED_TEAM_KEY, teamId);
    } catch {
      // Team Edit will fall back to the default Team.
    }
    onNavigate?.('team-setup');
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

  const submitItem = async (item, evidenceText) => {
    setBusyItemId(item.id);
    setError(null);
    try {
      await apiService.submitTeamBacklogItem(item.id, { evidence_text: evidenceText });
      await loadTeamState();
    } catch (err) {
      setError(err.message || 'Could not submit evidence');
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
        <button
          type="button"
          onClick={editTeam}
          className="shrink-0 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
        >
          Edit
        </button>
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
        ) : !user ? (
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
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Open Backlog</h2>
                <span className="text-xs text-gray-400">{openBacklogItems.length}</span>
              </div>
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
                <h2 className="text-sm font-semibold text-gray-900">
                  {usesManualApproval ? 'Approved / History' : 'Done / History'}
                </h2>
                <span className="text-xs text-gray-400">{approvedItems.length}</span>
              </div>
              {approvedItems.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">
                  {usesManualApproval ? 'No approved work yet.' : 'No finished work yet.'}
                </p>
              ) : (
                approvedItems.map(item => (
                  <FinishedItem
                    key={item.id}
                    item={item}
                    pointsEnabled={pointsEnabled}
                  />
                ))
              )}
            </section>

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
