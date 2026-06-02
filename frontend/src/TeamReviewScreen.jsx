import { useEffect, useState } from 'react';
import { apiService } from './services/apiService';

const EMPTY_BACKLOG_FORM = { description: '', points: 3 };
const TEAM_EDIT_SELECTED_TEAM_KEY = 'jobdone.teamEdit.selectedTeamId';

function approvalStatusText(status) {
  if (status === 'needs_more_evidence') return 'Waiting for more evidence';
  if (status === 'submitted') return 'Submitted';
  return status || 'Submitted';
}

function pointsOptions() {
  return Array.from({ length: 10 }, (_, index) => index + 1);
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
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [isAddingBacklog, setIsAddingBacklog] = useState(false);
  const [backlogForm, setBacklogForm] = useState(EMPTY_BACKLOG_FORM);
  const [isSavingBacklog, setIsSavingBacklog] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [busyApprovalId, setBusyApprovalId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadReviewState() {
    setIsLoading(true);
    setError(null);
    try {
      const state = await apiService.getTeamReviewState();
      const nextOwnedTeams = state.ownedTeams || [];
      const nextRequests = state.activeApprovalRequests || [];
      setOwnedTeams(nextOwnedTeams);
      setActiveApprovalRequests(nextRequests);
      setCanManage(Boolean(state.canManage));
      setSelectedTeamId(currentTeamId => {
        if (nextOwnedTeams.some(team => team.id === currentTeamId)) return currentTeamId;
        const firstReviewTeamId = nextRequests.find(request =>
          nextOwnedTeams.some(team => team.id === request.team_id)
        )?.team_id;
        return firstReviewTeamId || nextOwnedTeams[0]?.id || null;
      });
    } catch (err) {
      setError(err.message || 'Could not load Team');
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

  const selectedTeam = ownedTeams.find(team => team.id === selectedTeamId) || ownedTeams[0] || null;
  const selectedTeamPointsEnabled = Boolean(selectedTeam?.points_enabled);

  const editTeams = () => {
    if (selectedTeam?.id) {
      try {
        sessionStorage.setItem(TEAM_EDIT_SELECTED_TEAM_KEY, selectedTeam.id);
      } catch {
        // Team Edit will fall back to its default Team when session storage is unavailable.
      }
    }
    onNavigate?.('team-setup');
  };

  const saveBacklogItem = async (event) => {
    event.preventDefault();
    if (!selectedTeam?.id) return;
    setIsSavingBacklog(true);
    setError(null);
    setSaveMessage('');
    try {
      await apiService.createTeamBacklogItem({
        teamId: selectedTeam.id,
        description: backlogForm.description,
        points: selectedTeamPointsEnabled ? backlogForm.points : null,
      });
      setBacklogForm(EMPTY_BACKLOG_FORM);
      setIsAddingBacklog(false);
      setSaveMessage(`Added Backlog Item to ${selectedTeam.name}`);
    } catch (err) {
      setError(err.message || 'Could not add Backlog Item');
    } finally {
      setIsSavingBacklog(false);
    }
  };

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
          <h1 className="text-xl font-light text-gray-900 leading-5">Team</h1>
          <p className="text-xs text-gray-500">Review work and keep the Backlog moving</p>
        </div>
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
        ) : (
          <div className="space-y-6">
            {ownedTeams.length > 0 && (
              <section className="space-y-3">
                {ownedTeams.length > 1 ? (
                  <label className="block">
                    <span className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Selected Team</span>
                    <select
                      value={selectedTeam?.id || ''}
                      onChange={(event) => {
                        setSelectedTeamId(event.target.value);
                        setSaveMessage('');
                      }}
                      className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                    >
                      {ownedTeams.map(team => (
                        <option key={team.id} value={team.id}>{team.name}</option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <p className="text-xs text-gray-500">Team: <span className="font-medium text-gray-700">{selectedTeam?.name}</span></p>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingBacklog(open => !open);
                      setSaveMessage('');
                    }}
                    className="px-3 py-2 text-sm font-medium text-gray-900 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Add Backlog Item
                  </button>
                  <button
                    type="button"
                    onClick={editTeams}
                    className="px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                  >
                    Edit Teams
                  </button>
                </div>

                {saveMessage && <p className="text-xs text-green-700">{saveMessage}</p>}

                {isAddingBacklog && (
                  <form onSubmit={saveBacklogItem} className="rounded border border-gray-200 px-3 py-3 space-y-3">
                    <div>
                      <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
                        Backlog Item
                      </label>
                      <textarea
                        value={backlogForm.description}
                        onChange={(event) => setBacklogForm(prev => ({ ...prev, description: event.target.value }))}
                        rows={3}
                        className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                        placeholder={`What should ${selectedTeam?.name || 'this Team'} do?`}
                      />
                    </div>
                    {selectedTeamPointsEnabled && (
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
                          setIsAddingBacklog(false);
                        }}
                        className="px-3 py-2 text-sm font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSavingBacklog || !backlogForm.description.trim() || !selectedTeam}
                        className="px-3 py-2 text-sm font-medium text-white bg-gray-900 rounded hover:bg-gray-800 disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </form>
                )}
              </section>
            )}

            <section>
              <div className="border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Needs Review</h2>
                <p className="mt-1 text-xs text-gray-500">Submitted and needs-more-evidence work across Teams you own.</p>
              </div>
              {activeApprovalRequests.length === 0 ? (
                <p className="py-8 text-sm text-gray-400">No work needs review.</p>
              ) : (
                activeApprovalRequests.map(request => (
                  <ReviewRequestRow
                    key={request.id}
                    request={request}
                    busy={busyApprovalId === request.id}
                    onDecision={decideApproval}
                  />
                ))
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
