import { useEffect, useState } from 'react';
import { apiService } from './services/apiService';

function approvalStatusText(status) {
  if (status === 'needs_more_evidence') return 'Waiting for more evidence';
  if (status === 'submitted') return 'Submitted';
  return status || 'Submitted';
}

function ReviewRequestRow({ request, busy, onDecision }) {
  const item = request.backlog_item || {};
  const isSubmitted = request.status === 'submitted';
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <p className="text-sm font-medium text-gray-900 leading-5">{item.description || 'Submitted work'}</p>
      <p className="mt-1 text-xs text-gray-500">
        {[request.team?.name, approvalStatusText(request.status)].filter(Boolean).join(' · ')}
      </p>
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
        <p className="mt-2 text-xs text-gray-400">The Team Member can add evidence and resubmit.</p>
      )}
    </div>
  );
}

export function TeamReviewScreen({ onBack, onNavigate, user }) {
  const [ownedTeams, setOwnedTeams] = useState([]);
  const [activeApprovalRequests, setActiveApprovalRequests] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [busyApprovalId, setBusyApprovalId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadReviewState() {
    setIsLoading(true);
    setError(null);
    try {
      const state = await apiService.getTeamReviewState();
      setOwnedTeams(state.ownedTeams || []);
      setActiveApprovalRequests(state.activeApprovalRequests || []);
      setCanManage(Boolean(state.canManage));
    } catch (err) {
      setError(err.message || 'Could not load Team Review');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadReviewState();
  }, [user?.email]);

  useEffect(() => {
    if (!isLoading && canManage && ownedTeams.length === 0) {
      onNavigate?.('team-setup');
    }
  }, [canManage, isLoading, onNavigate, ownedTeams.length]);

  const decideApproval = async (request, decision) => {
    setBusyApprovalId(request.id);
    setError(null);
    try {
      await apiService.decideTeamApprovalRequest(request.id, decision, request.team_id);
      setActiveApprovalRequests(requests => requests.filter(existing => existing.id !== request.id));
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
          <h1 className="text-xl font-light text-gray-900 leading-5">Needs Review</h1>
          <p className="text-xs text-gray-500">Submitted work across your Teams</p>
        </div>
        {canManage && ownedTeams.length > 0 && (
          <button
            type="button"
            onClick={() => onNavigate?.('team-setup')}
            className="shrink-0 px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
          >
            Edit Teams
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-4">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
        ) : !user ? (
          <section className="py-8">
            <h2 className="text-sm font-semibold text-gray-900">Log in to review Team work</h2>
            <p className="mt-2 text-sm leading-5 text-gray-500">JobDone uses your email to find Teams you own.</p>
            <button
              type="button"
              onClick={() => onNavigate?.('login')}
              className="mt-4 w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800"
            >
              Log in
            </button>
          </section>
        ) : activeApprovalRequests.length === 0 ? (
          <p className="py-8 text-sm text-gray-400">No work needs review.</p>
        ) : (
          <section>
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
      </main>
    </div>
  );
}
