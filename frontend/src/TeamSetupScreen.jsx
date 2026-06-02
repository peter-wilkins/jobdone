import { useEffect, useState } from 'react';
import { apiService } from './services/apiService';

const EMPTY_FORM = { description: '', points: 3 };
const DEFAULT_TEAM = { name: '', template: 'high_trust', points_enabled: false };

const TEAM_TEMPLATES = [
  { value: 'high_trust', label: 'High Trust', hint: 'Fast coordination, auto-approval, no points.' },
  { value: 'low_trust', label: 'Low Trust', hint: 'Manual approval before work is accepted.' },
  { value: 'family', label: 'Family', hint: 'Manual approval with points enabled.' },
];

function pointsOptions() {
  return Array.from({ length: 10 }, (_, index) => index + 1);
}

function BacklogItemRow({ item, pointsEnabled, onEdit, onDelete }) {
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 leading-5">{item.description}</p>
          {pointsEnabled && (
            <p className="mt-1 text-xs text-gray-500">{item.points || 0} point{item.points === 1 ? '' : 's'}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-300 rounded hover:bg-gray-50"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            className="px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function ApprovalRequestRow({ request, onDecision, busy }) {
  const item = request.backlog_item || {};
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <p className="text-sm font-medium text-gray-900 leading-5">{item.description || 'Submitted work'}</p>
      <p className="mt-1 text-xs text-gray-500">
        {item.points ? `${item.points} point${item.points === 1 ? '' : 's'} · ` : ''}Submitted for approval
      </p>
      {request.evidence_text && (
        <p className="mt-2 text-sm leading-5 text-gray-700">{request.evidence_text}</p>
      )}
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
    </div>
  );
}

function InviteRow({ invite, onCopy, onResend, onRemove, busy }) {
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <div className="space-y-2 sm:flex sm:items-start sm:gap-3 sm:space-y-0">
        <div className="min-w-0 flex-1">
          <p className="break-all text-sm font-medium leading-5 text-gray-900">{invite.email}</p>
          <p className="mt-1 text-xs text-gray-500">Pending invite email</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => onResend(invite)}
            className="px-3 py-1.5 text-xs font-medium text-gray-900 bg-gray-100 border border-gray-200 rounded hover:bg-gray-200 disabled:opacity-50"
          >
            Resend
          </button>
          <button
            type="button"
            onClick={() => onCopy(invite)}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded hover:bg-gray-50"
          >
            Copy fallback
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onRemove(invite)}
            className="px-3 py-1.5 text-xs font-medium text-red-700 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

export function TeamSetupScreen({ onBack, onNavigate, user }) {
  const [team, setTeam] = useState(DEFAULT_TEAM);
  const [form, setForm] = useState(EMPTY_FORM);
  const [inviteEmail, setInviteEmail] = useState('');
  const [pendingTeamInvites, setPendingTeamInvites] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [openBacklogItems, setOpenBacklogItems] = useState([]);
  const [submittedApprovalRequests, setSubmittedApprovalRequests] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [busyApprovalId, setBusyApprovalId] = useState(null);
  const [busyInviteId, setBusyInviteId] = useState(null);
  const [inviteCopyMessage, setInviteCopyMessage] = useState('');
  const [error, setError] = useState(null);

  async function loadTeamState() {
    setIsLoading(true);
    setError(null);
    try {
      const state = await apiService.getTeamSetupState();
      setTeam(state.team || DEFAULT_TEAM);
      setCanManage(Boolean(state.canManage));
      setPendingTeamInvites(state.pendingTeamInvites || []);
      setOpenBacklogItems(state.openBacklogItems || []);
      setSubmittedApprovalRequests(state.submittedApprovalRequests || []);
    } catch (err) {
      setCanManage(false);
      setError(err.message || 'Could not load Team');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    // Initial screen load is the synchronization point for Team backlog state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTeamState();
  }, []);

  const pointsEnabled = Boolean(team.points_enabled);
  const hasManagedTeam = Boolean(team.id);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const saveTeam = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      let result;
      try {
        result = await apiService.updateTeamSetup({ name: team.name, template: team.template });
      } catch (err) {
        if (!hasManagedTeam && err.status === 409 && window.confirm(err.message)) {
          result = await apiService.updateTeamSetup({ name: team.name, template: team.template, allowSeparateTeam: true });
        } else {
          throw err;
        }
      }
      setTeam(result.team || team);
      await loadTeamState();
    } catch (err) {
      setError(err.message || 'Could not save Team');
    } finally {
      setIsSaving(false);
    }
  };

  const saveBacklogItem = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      if (editingId) {
        await apiService.updateTeamBacklogItem(editingId, {
          description: form.description,
          points: pointsEnabled ? form.points : null,
        });
      } else {
        await apiService.createTeamBacklogItem({
          description: form.description,
          points: pointsEnabled ? form.points : null,
        });
      }
      resetForm();
      await loadTeamState();
    } catch (err) {
      setError(err.message || 'Could not save Backlog Item');
    } finally {
      setIsSaving(false);
    }
  };

  const startEditing = (item) => {
    setEditingId(item.id);
    setForm({ description: item.description || '', points: item.points || 3 });
  };

  const deleteItem = async (item) => {
    setError(null);
    try {
      await apiService.deleteTeamBacklogItem(item.id);
      await loadTeamState();
    } catch (err) {
      setError(err.message || 'Could not delete Backlog Item');
    }
  };

  const decideApproval = async (request, decision) => {
    setBusyApprovalId(request.id);
    setError(null);
    try {
      await apiService.decideTeamApprovalRequest(request.id, decision);
      await loadTeamState();
    } catch (err) {
      setError(err.message || 'Could not update Approval Request');
    } finally {
      setBusyApprovalId(null);
    }
  };

  const createInvite = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setInviteCopyMessage('');
    try {
      const result = await apiService.createTeamInvite({ email: inviteEmail });
      const invitedEmail = result.invite?.email || inviteEmail;
      setInviteEmail('');
      await loadTeamState();
      setInviteCopyMessage(`Invite email sent to ${invitedEmail}`);
    } catch (err) {
      setError(err.message || 'Could not create invite');
    } finally {
      setIsSaving(false);
    }
  };

  const copyInviteUrl = async (invite) => {
    setInviteCopyMessage('');
    try {
      await navigator.clipboard.writeText(invite.invite_url);
      setInviteCopyMessage(`Copied invite link for ${invite.email}`);
    } catch {
      setInviteCopyMessage(invite.invite_url);
    }
  };

  const resendInvite = async (invite) => {
    setBusyInviteId(invite.id);
    setError(null);
    setInviteCopyMessage('');
    try {
      const result = await apiService.resendTeamInvite(invite.id);
      const invitedEmail = result.invite?.email || invite.email;
      setInviteCopyMessage(`Invite email resent to ${invitedEmail}`);
      await loadTeamState();
    } catch (err) {
      setError(err.message || 'Could not resend invite');
    } finally {
      setBusyInviteId(null);
    }
  };

  const removeInvite = async (invite) => {
    setBusyInviteId(invite.id);
    setError(null);
    setInviteCopyMessage('');
    try {
      await apiService.revokeTeamInvite(invite.id);
      await loadTeamState();
    } catch (err) {
      setError(err.message || 'Could not remove invite');
    } finally {
      setBusyInviteId(null);
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
          <h1 className="text-xl font-light text-gray-900 leading-5">Team Setup</h1>
          <p className="text-xs text-gray-500">{isLoading ? 'Loading...' : (team.name || 'Create Team')}</p>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-4 space-y-6">
        {isLoading ? (
          <div className="py-8 text-center text-sm text-gray-400">Loading...</div>
        ) : !canManage ? (
          <section className="py-8">
            <h2 className="text-sm font-semibold text-gray-900">
              {user ? 'Team Setup is owner-only' : 'Log in to create a Team'}
            </h2>
            {user ? (
              <p className="mt-2 text-sm leading-5 text-gray-500">
                You can do Team work from My Work, but only the Team Owner can change settings, invites, Backlog Items, and approvals.
              </p>
            ) : (
              <p className="mt-2 text-sm leading-5 text-gray-500">
                Log in so JobDone can attach the Team to your email.
              </p>
            )}
            <button
              type="button"
              onClick={() => onNavigate?.(user ? 'my-work' : 'login')}
              className="mt-4 w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800"
            >
              {user ? 'Go to My Work' : 'Log in'}
            </button>
          </section>
        ) : (
          <>
        <form onSubmit={saveTeam} className="space-y-3">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
              Team name
            </label>
            <input
              value={team.name || ''}
              onChange={(event) => setTeam(prev => ({ ...prev, name: event.target.value }))}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              placeholder="Team name, e.g. Chawmore"
            />
          </div>
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
              Starting point
            </label>
            <div className="grid gap-2">
              {TEAM_TEMPLATES.map(template => (
                <label
                  key={template.value}
                  className={`block rounded border px-3 py-2 ${team.template === template.value ? 'border-gray-900 bg-gray-50' : 'border-gray-200'}`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="team-template"
                      value={template.value}
                      checked={team.template === template.value}
                      onChange={() => setTeam(prev => ({ ...prev, template: template.value }))}
                      className="mt-1"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{template.label}</p>
                      <p className="text-xs text-gray-500">{template.hint}</p>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <button
            type="submit"
            disabled={isSaving || !String(team.name || '').trim()}
            className="w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-50"
          >
            {hasManagedTeam ? 'Save Team' : 'Create Team'}
          </button>
        </form>

        {hasManagedTeam && (
        <section>
          <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
            <h2 className="text-sm font-semibold text-gray-900">Team Invites</h2>
            <span className="text-xs text-gray-400">{pendingTeamInvites.length}</span>
          </div>
          {!user ? (
            <div className="py-4">
              <p className="text-sm text-gray-500">Log in to invite Team Members.</p>
              <button
                type="button"
                onClick={() => onNavigate?.('login')}
                className="mt-3 w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800"
              >
                Log in
              </button>
            </div>
          ) : (
            <>
              <form onSubmit={createInvite} className="py-3 space-y-2">
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500">
                  Email
                </label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    className="min-w-0 flex-1 rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                    placeholder="team.member@example.com"
                  />
                  <button
                    type="submit"
                    disabled={isSaving || !inviteEmail.trim()}
                    className="shrink-0 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-50"
                  >
                    Create invite
                  </button>
                </div>
                <p className="text-xs text-gray-400">JobDone emails a sign-in link to the invited address.</p>
              </form>
              {inviteCopyMessage && (
                <p className="pb-2 text-xs text-gray-500 break-all">{inviteCopyMessage}</p>
              )}
              {pendingTeamInvites.length > 0 && (
                <div>
                  {pendingTeamInvites.map(invite => (
                    <InviteRow
                      key={invite.id}
                      invite={invite}
                      busy={busyInviteId === invite.id}
                      onCopy={copyInviteUrl}
                      onResend={resendInvite}
                      onRemove={removeInvite}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </section>
        )}

        {hasManagedTeam && (
        <form onSubmit={saveBacklogItem} className="space-y-3">
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
              Backlog item
            </label>
            <textarea
              value={form.description}
              onChange={(event) => setForm(prev => ({ ...prev, description: event.target.value }))}
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
              placeholder="What needs doing?"
            />
          </div>
          <div className="flex items-end gap-3">
            {pointsEnabled && (
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">
                  Points
                </label>
                <select
                  value={form.points}
                  onChange={(event) => setForm(prev => ({ ...prev, points: Number(event.target.value) }))}
                  className="rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                >
                  {pointsOptions().map(value => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </div>
            )}
            <button
              type="submit"
              disabled={isSaving || !form.description.trim()}
              className="flex-1 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-50"
            >
              {editingId ? 'Save changes' : 'Add to backlog'}
            </button>
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="px-4 py-2 border border-gray-300 text-sm font-medium text-gray-700 rounded hover:bg-gray-50"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
        )}

            {hasManagedTeam && (
            <section>
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Open Backlog Items</h2>
                <span className="text-xs text-gray-400">{openBacklogItems.length}</span>
              </div>
              {openBacklogItems.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">No open Backlog Items.</p>
              ) : (
                <div>
                  {openBacklogItems.map(item => (
                    <BacklogItemRow
                      key={item.id}
                      item={item}
                      pointsEnabled={pointsEnabled}
                      onEdit={startEditing}
                      onDelete={deleteItem}
                    />
                  ))}
                </div>
              )}
            </section>
            )}

            {hasManagedTeam && (
            <section>
              <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
                <h2 className="text-sm font-semibold text-gray-900">Submitted For Approval</h2>
                <span className="text-xs text-gray-400">{submittedApprovalRequests.length}</span>
              </div>
              {submittedApprovalRequests.length === 0 ? (
                <p className="py-5 text-sm text-gray-400">No work waiting for approval.</p>
              ) : (
                <div>
                  {submittedApprovalRequests.map(request => (
                    <ApprovalRequestRow
                      key={request.id}
                      request={request}
                      busy={busyApprovalId === request.id}
                      onDecision={decideApproval}
                    />
                  ))}
                </div>
              )}
            </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
