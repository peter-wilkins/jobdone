import { useCallback, useEffect, useRef, useState } from 'react';
import { apiService } from './services/apiService';
import { dbService } from './services/dbService';
import { CLAIM_RACE_FEEDBACK_MS } from './services/teamWorkItemService';
import { FinishedItem, OpenItem, WorkItem } from './TeamWorkItems';

export function MyWorkScreen({ onBack }) {
  const [team, setTeam] = useState(null);
  const [inProgressItems, setInProgressItems] = useState([]);
  const [openBacklogItems, setOpenBacklogItems] = useState([]);
  const [approvedItems, setApprovedItems] = useState([]);
  const [recentEntries, setRecentEntries] = useState([]);
  const [busyItemId, setBusyItemId] = useState(null);
  const [claimErrors, setClaimErrors] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [staleError, setStaleError] = useState(null);
  const claimErrorsRef = useRef({});

  const loadWorkState = useCallback(async ({ showLoading = true, showRefreshing = true } = {}) => {
    if (showLoading) {
      setIsLoading(true);
    } else if (showRefreshing) {
      setIsRefreshing(true);
    }
    setStaleError(null);
    try {
      const state = await apiService.getMyWorkState();
      const fetchedOpenItems = state.openBacklogItems || [];
      setTeam(state.team || null);
      setInProgressItems(state.inProgressItems || []);
      setOpenBacklogItems(previousOpenItems => {
        const fetchedIds = new Set(fetchedOpenItems.map(item => item.id));
        const now = Date.now();
        const staleRaceItems = previousOpenItems.filter(item => {
          const claimError = claimErrorsRef.current[item.id];
          return claimError?.expiresAt > now && !fetchedIds.has(item.id);
        });
        return [...fetchedOpenItems, ...staleRaceItems];
      });
      setApprovedItems(state.approvedItems || []);
      setClaimErrors(errors => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(errors).filter(([, claimError]) => claimError.expiresAt > now));
        claimErrorsRef.current = next;
        return next;
      });
    } catch (err) {
      setStaleError(err.message || 'Could not refresh My Work');
    } finally {
      if (showLoading) {
        setIsLoading(false);
      } else if (showRefreshing) {
        setIsRefreshing(false);
      }
    }
  }, []);

  const loadRecentEntries = useCallback(async () => {
    try {
      const entries = await dbService.getEntries('confirmed');
      setRecentEntries(entries.slice(0, 20));
    } catch {
      setRecentEntries([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWorkState();
    loadRecentEntries();
  }, [loadRecentEntries, loadWorkState]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        loadWorkState({ showLoading: false });
        loadRecentEntries();
      }
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadRecentEntries, loadWorkState]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadWorkState({ showLoading: false, showRefreshing: false });
        loadRecentEntries();
      }
    }, 10000);
    return () => clearInterval(intervalId);
  }, [loadRecentEntries, loadWorkState]);

  const pointsEnabled = Boolean(team?.points_enabled);
  const usesManualApproval = team?.approval_mode === 'manual';

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
      await loadWorkState();
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
      await loadWorkState();
    } catch (err) {
      throw new Error(err.message || 'Could not submit evidence', { cause: err });
    } finally {
      setBusyItemId(null);
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
        <div>
          <h1 className="text-xl font-light text-gray-900 leading-5">My Work</h1>
          <p className="text-xs text-gray-500">Backlog across your Teams</p>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {(staleError || isRefreshing) && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-3">
          <p className="min-w-0 flex-1 text-xs text-amber-800">
            {isRefreshing ? 'Refreshing My Work...' : 'My Work may be out of date.'}
          </p>
          {!isRefreshing && (
            <button
              type="button"
              onClick={() => loadWorkState({ showLoading: false })}
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
        ) : (
          <>
            <section>
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Claimed / In Progress</h2>
                <span className="text-xs text-gray-400">{inProgressItems.length}</span>
              </div>
              {inProgressItems.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">Nothing claimed.</p>
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
          </>
        )}
      </main>
    </div>
  );
}
