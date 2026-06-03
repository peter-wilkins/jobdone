import { useEffect, useRef, useState } from 'react';
import { apiService } from './services/apiService';
import { useOutsideDismiss } from './services/outsideDismissService';

const EMPTY_FORM = { description: '', points: 3 };
const DEFAULT_TEAM = { name: '', template: 'high_trust', points_enabled: false, require_owner_self_review: false };
const TEAM_EDIT_SELECTED_TEAM_KEY = 'jobdone.teamEdit.selectedTeamId';

const TEAM_TEMPLATES = [
  { value: 'high_trust', label: 'High Trust', hint: 'Fast coordination, auto-approval, no points.' },
  { value: 'low_trust', label: 'Low Trust', hint: 'Manual approval before work is accepted.' },
  { value: 'family', label: 'Family', hint: 'Manual approval with points enabled.' },
];

function pointsOptions() {
  return Array.from({ length: 10 }, (_, index) => index + 1);
}

function consumeRequestedTeamId() {
  try {
    const teamId = sessionStorage.getItem(TEAM_EDIT_SELECTED_TEAM_KEY);
    sessionStorage.removeItem(TEAM_EDIT_SELECTED_TEAM_KEY);
    return teamId || null;
  } catch {
    return null;
  }
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

function TeamMemberRow({ member }) {
  return (
    <div className="py-3 border-b border-gray-100 last:border-b-0">
      <p className="break-all text-sm font-medium leading-5 text-gray-900">{member.email}</p>
      <p className="mt-1 text-xs text-gray-500">{member.role === 'owner' ? 'Owner' : 'Member'}</p>
    </div>
  );
}

export function TeamSetupScreen({ onBack, onNavigate, user }) {
  const [team, setTeam] = useState(DEFAULT_TEAM);
  const [ownedTeams, setOwnedTeams] = useState([]);
  const [memberTeams, setMemberTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(null);
  const [isCreatingNewTeam, setIsCreatingNewTeam] = useState(false);
  const [memberTeamsOpen, setMemberTeamsOpen] = useState(false);
  const memberTeamsRef = useRef(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [inviteEmail, setInviteEmail] = useState('');
  const [pendingTeamInvites, setPendingTeamInvites] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [openBacklogItems, setOpenBacklogItems] = useState([]);
  const [canManage, setCanManage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeletingTeam, setIsDeletingTeam] = useState(false);
  const [busyInviteId, setBusyInviteId] = useState(null);
  const [inviteCopyMessage, setInviteCopyMessage] = useState('');
  const [inviteError, setInviteError] = useState(null);
  const [error, setError] = useState(null);

  async function loadTeamState(teamId = selectedTeamId) {
    setIsLoading(true);
    setError(null);
    try {
      const state = await apiService.getTeamSetupState(teamId);
      setTeam(state.team || DEFAULT_TEAM);
      setOwnedTeams(state.ownedTeams || []);
      setMemberTeams(state.memberTeams || []);
      setSelectedTeamId(state.team?.id || null);
      setIsCreatingNewTeam(false);
      setCanManage(Boolean(state.canManage));
      setPendingTeamInvites(state.pendingTeamInvites || []);
      setTeamMembers(state.teamMembers || []);
      setOpenBacklogItems(state.openBacklogItems || []);
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
    loadTeamState(consumeRequestedTeamId());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const pointsEnabled = Boolean(team.points_enabled);
  const hasManagedTeam = Boolean(team.id);
  const selectedOwnedTeamId = hasManagedTeam ? team.id : selectedTeamId;
  const editorTitle = isCreatingNewTeam || !hasManagedTeam ? 'Create Team' : `Edit ${team.name}`;

  useOutsideDismiss(memberTeamsOpen, [memberTeamsRef], () => setMemberTeamsOpen(false));

  const selectOwnedTeam = async (ownedTeam) => {
    setSelectedTeamId(ownedTeam.id);
    setIsCreatingNewTeam(false);
    resetForm();
    await loadTeamState(ownedTeam.id);
  };

  const startCreateTeam = () => {
    setTeam(DEFAULT_TEAM);
    setSelectedTeamId(null);
    setIsCreatingNewTeam(true);
    setPendingTeamInvites([]);
    setTeamMembers([]);
    setOpenBacklogItems([]);
    resetForm();
    setError(null);
    setInviteError(null);
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
  };

  const saveTeam = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const result = await apiService.updateTeamSetup({
        id: hasManagedTeam ? team.id : null,
        name: team.name,
        template: team.template,
        requireOwnerSelfReview: Boolean(team.require_owner_self_review),
        createNewTeam: isCreatingNewTeam || !hasManagedTeam,
      });
      setTeam(result.team || team);
      setSelectedTeamId(result.team?.id || null);
      await loadTeamState(result.team?.id || null);
    } catch (err) {
      setError(err.message || 'Could not save Team');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteTeam = async () => {
    if (!hasManagedTeam || isCreatingNewTeam) return;
    const confirmed = window.confirm(
      `Delete Team "${team.name}"? This removes its Backlog Items, invites, members, and approvals.`
    );
    if (!confirmed) return;

    setIsDeletingTeam(true);
    setError(null);
    try {
      await apiService.deleteTeam(team.id);
      const remainingOwnedTeams = ownedTeams.filter(ownedTeam => ownedTeam.id !== team.id);
      setOwnedTeams(remainingOwnedTeams);
      if (remainingOwnedTeams.length) {
        await loadTeamState(remainingOwnedTeams[0].id);
      } else {
        setTeam(DEFAULT_TEAM);
        setSelectedTeamId(null);
        setIsCreatingNewTeam(true);
        setPendingTeamInvites([]);
        setOpenBacklogItems([]);
        resetForm();
      }
    } catch (err) {
      setError(err.message || 'Could not delete Team');
    } finally {
      setIsDeletingTeam(false);
    }
  };

  const saveBacklogItem = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      if (editingId) {
        const result = await apiService.updateTeamBacklogItem(editingId, {
          teamId: selectedOwnedTeamId,
          description: form.description,
          points: pointsEnabled ? form.points : null,
        });
        const savedItem = result.backlogItem;
        setOpenBacklogItems(items => items.map(item => item.id === editingId ? savedItem : item));
      } else {
        const result = await apiService.createTeamBacklogItem({
          teamId: selectedOwnedTeamId,
          description: form.description,
          points: pointsEnabled ? form.points : null,
        });
        setOpenBacklogItems(items => [result.backlogItem, ...items]);
      }
      resetForm();
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
      await apiService.deleteTeamBacklogItem(item.id, selectedOwnedTeamId);
      setOpenBacklogItems(items => items.filter(existing => existing.id !== item.id));
    } catch (err) {
      setError(err.message || 'Could not delete Backlog Item');
    }
  };

  const createInvite = async (event) => {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    setInviteCopyMessage('');
    try {
      const result = await apiService.createTeamInvite({ teamId: selectedOwnedTeamId, email: inviteEmail });
      const invitedEmail = result.invite?.email || inviteEmail;
      setInviteEmail('');
      setInviteError(null);
      await loadTeamState();
      setInviteCopyMessage(`Invite email sent to ${invitedEmail}`);
    } catch (err) {
      setInviteError(err.message || 'Could not create invite');
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
    setInviteError(null);
    setInviteCopyMessage('');
    try {
      const result = await apiService.resendTeamInvite(invite.id, selectedOwnedTeamId);
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
    setInviteError(null);
    setInviteCopyMessage('');
    try {
      await apiService.revokeTeamInvite(invite.id, selectedOwnedTeamId);
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
          <h1 className="text-xl font-light text-gray-900 leading-5">Team Edit</h1>
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
        <section>
          <div className="flex items-baseline justify-between border-b border-gray-200 pb-2">
            <h2 className="text-sm font-semibold text-gray-900">Teams</h2>
            <button
              type="button"
              onClick={startCreateTeam}
              className="text-xs font-medium text-gray-700 hover:text-gray-900"
            >
              Create new
            </button>
          </div>
          {ownedTeams.length === 0 && memberTeams.length === 0 ? (
            <p className="py-3 text-sm text-gray-400">No Teams yet.</p>
          ) : (
            <div className="py-2 space-y-2">
              {ownedTeams.length > 0 && (
                <label className="block">
                  <span className="block text-xs font-medium uppercase tracking-wide text-gray-500 mb-1">Owned Teams</span>
                  <select
                    value={isCreatingNewTeam ? '__new__' : (selectedOwnedTeamId || '')}
                    onChange={(event) => {
                      if (event.target.value === '__new__') {
                        startCreateTeam();
                        return;
                      }
                      const ownedTeam = ownedTeams.find(candidate => candidate.id === event.target.value);
                      if (ownedTeam) selectOwnedTeam(ownedTeam);
                    }}
                    className="w-full rounded border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-gray-500 focus:outline-none"
                  >
                    <option value="__new__">Create new Team</option>
                    {ownedTeams.map(ownedTeam => (
                      <option key={ownedTeam.id} value={ownedTeam.id}>{ownedTeam.name}</option>
                    ))}
                  </select>
                </label>
              )}
              {memberTeams.length > 0 && (
                <div className="rounded border border-gray-100" ref={memberTeamsRef}>
                  <button
                    type="button"
                    onClick={() => setMemberTeamsOpen(open => !open)}
                    className="w-full px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500"
                  >
                    Member Teams ({memberTeams.length}) {memberTeamsOpen ? 'hide' : 'show'}
                  </button>
                  {memberTeamsOpen && (
                    <div className="border-t border-gray-100">
                      {memberTeams.map(({ team: memberTeam, role }) => (
                        <div key={memberTeam.id} className="px-3 py-2 border-b border-gray-50 last:border-b-0">
                          <span className="block text-sm font-medium text-gray-500">{memberTeam.name}</span>
                          <span className="block text-xs text-gray-400">{role || 'Member'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="rounded border border-gray-200 px-3 py-3">
        <div className="mb-3 flex items-start justify-between gap-3 border-b border-gray-100 pb-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-gray-900">{editorTitle}</h2>
            <p className="text-xs text-gray-500">
              {hasManagedTeam && !isCreatingNewTeam ? 'Changes apply only to this owned Team.' : 'This creates a separate Team.'}
            </p>
          </div>
          {hasManagedTeam && !isCreatingNewTeam && (
            <button
              type="button"
              onClick={deleteTeam}
              disabled={isDeletingTeam}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-red-200 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              title={`Delete ${team.name}`}
              aria-label={`Delete ${team.name}`}
            >
              x
            </button>
          )}
        </div>

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
          <label className="flex items-start gap-3 rounded border border-gray-200 px-3 py-2">
            <input
              type="checkbox"
              checked={Boolean(team.require_owner_self_review)}
              onChange={(event) => setTeam(prev => ({ ...prev, require_owner_self_review: event.target.checked }))}
              className="mt-1"
            />
            <span>
              <span className="block text-sm font-medium text-gray-900">Owners review their own work</span>
              <span className="block text-xs text-gray-500">Default is off, so owner-submitted work keeps an evidence trail and is approved automatically.</span>
            </span>
          </label>
          <button
            type="submit"
            disabled={isSaving || !String(team.name || '').trim()}
            className="w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-50"
          >
            {hasManagedTeam ? 'Save Team' : 'Create Team'}
          </button>
        </form>
        </section>

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
                    onChange={(event) => {
                      setInviteEmail(event.target.value);
                      setInviteError(null);
                    }}
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
                {inviteError && (
                  <p className="text-xs text-red-700">{inviteError}</p>
                )}
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
              <div className="mt-4">
                <div className="flex items-baseline justify-between border-b border-gray-100 pb-2">
                  <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">Team Members</h3>
                  <span className="text-xs text-gray-400">{teamMembers.length}</span>
                </div>
                {teamMembers.length === 0 ? (
                  <p className="py-3 text-sm text-gray-400">No accepted members yet.</p>
                ) : (
                  teamMembers.map(member => (
                    <TeamMemberRow key={member.id || member.email} member={member} />
                  ))
                )}
              </div>
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

          </>
        )}
      </main>
    </div>
  );
}
