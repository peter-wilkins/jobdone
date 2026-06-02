import { useCallback, useEffect, useState } from 'react';
import { apiService } from './services/apiService';

function pointsText(item, pointsEnabled) {
  if (!pointsEnabled || !item.points) return '';
  return `${item.points} point${item.points === 1 ? '' : 's'}`;
}

function teamLabel(item) {
  return item.team?.name || 'Team';
}

function itemPointsEnabled(item, fallback) {
  return item.team?.points_enabled ?? fallback;
}

function itemUsesManualApproval(item, fallback) {
  if (!item.team?.approval_mode) return fallback;
  return item.team.approval_mode === 'manual';
}

function statusText(status, usesManualApproval = true) {
  if (status === 'needs_more_evidence') return 'Needs more evidence';
  if (status === 'submitted') return 'Submitted';
  if (status === 'approved') return usesManualApproval ? 'Approved' : 'Done';
  if (status === 'claimed') return 'Claimed';
  return 'Open';
}

function WorkItem({ item, pointsEnabled, usesManualApproval, onSubmit, busy }) {
  const [evidenceText, setEvidenceText] = useState('');
  const request = item.approval_request || {};
  const rowPointsEnabled = itemPointsEnabled(item, pointsEnabled);
  const rowUsesManualApproval = itemUsesManualApproval(item, usesManualApproval);
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 leading-5">{item.description}</p>
          <p className="mt-1 text-xs text-gray-500">
            {[teamLabel(item), statusText(item.status, rowUsesManualApproval), pointsText(item, rowPointsEnabled)].filter(Boolean).join(' · ')}
          </p>
        </div>
      </div>
      {request.evidence_text && (
        <p className="mt-2 text-sm leading-5 text-gray-700">{request.evidence_text}</p>
      )}
      {item.status !== 'submitted' && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit(item, evidenceText);
            setEvidenceText('');
          }}
          className="mt-3 space-y-2"
        >
          <textarea
            value={evidenceText}
            onChange={(event) => setEvidenceText(event.target.value)}
            rows={2}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
            placeholder="Capture what happened now so your future self can find it later."
          />
          <button
            type="submit"
            disabled={busy || !evidenceText.trim()}
            className="w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-50"
          >
            Submit evidence
          </button>
        </form>
      )}
    </div>
  );
}

function OpenItem({ item, pointsEnabled, onClaim, busy }) {
  const rowPointsEnabled = itemPointsEnabled(item, pointsEnabled);
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 leading-5">{item.description}</p>
          <p className="mt-1 text-xs text-gray-500">
            {[teamLabel(item), pointsText(item, rowPointsEnabled)].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onClaim(item)}
          className="shrink-0 px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-50"
        >
          Claim
        </button>
      </div>
    </div>
  );
}

function FinishedItem({ item, pointsEnabled }) {
  const request = item.approval_request || {};
  const points = pointsText(item, itemPointsEnabled(item, pointsEnabled));
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <p className="text-sm font-medium text-gray-900 leading-5">{item.description}</p>
      <p className="mt-1 text-xs text-gray-500">
        {[teamLabel(item), points].filter(Boolean).join(' · ')}
      </p>
      {request.evidence_text && (
        <p className="mt-2 text-sm leading-5 text-gray-700">{request.evidence_text}</p>
      )}
    </div>
  );
}

export function MyWorkScreen({ onBack }) {
  const [team, setTeam] = useState(null);
  const [inProgressItems, setInProgressItems] = useState([]);
  const [openBacklogItems, setOpenBacklogItems] = useState([]);
  const [approvedItems, setApprovedItems] = useState([]);
  const [busyItemId, setBusyItemId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [staleError, setStaleError] = useState(null);

  const loadWorkState = useCallback(async ({ showLoading = true } = {}) => {
    if (showLoading) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setStaleError(null);
    try {
      const state = await apiService.getMyWorkState();
      setTeam(state.team || null);
      setInProgressItems(state.inProgressItems || []);
      setOpenBacklogItems(state.openBacklogItems || []);
      setApprovedItems(state.approvedItems || []);
    } catch (err) {
      setStaleError(err.message || 'Could not refresh My Work');
    } finally {
      if (showLoading) {
        setIsLoading(false);
      } else {
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWorkState();
  }, [loadWorkState]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') {
        loadWorkState({ showLoading: false });
      }
    };
    window.addEventListener('focus', refreshIfVisible);
    document.addEventListener('visibilitychange', refreshIfVisible);
    return () => {
      window.removeEventListener('focus', refreshIfVisible);
      document.removeEventListener('visibilitychange', refreshIfVisible);
    };
  }, [loadWorkState]);

  const pointsEnabled = Boolean(team?.points_enabled);
  const usesManualApproval = team?.approval_mode === 'manual';

  const claimItem = async (item) => {
    setBusyItemId(item.id);
    setError(null);
    try {
      await apiService.claimTeamBacklogItem(item.id);
      await loadWorkState();
    } catch (err) {
      setError(err.message || 'Could not claim Backlog Item');
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
      setError(err.message || 'Could not submit evidence');
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
