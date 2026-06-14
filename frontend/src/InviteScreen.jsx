import { useEffect, useRef, useState } from 'react';
import { apiService } from './services/apiService';

function inviteTokenFromLocation() {
  const params = new URLSearchParams(window.location.hash.split('?')[1] || window.location.search);
  return params.get('token') || '';
}

export function InviteScreen({ onBack, onNavigate, user }) {
  const [token] = useState(inviteTokenFromLocation);
  const [inviteState, setInviteState] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState(null);
  const acceptedRef = useRef(false);

  function destinationFromInvite(rawDestination = 'my-work') {
    if (rawDestination === 'my-work' || rawDestination === 'team-work') return 'action-inbox';
    return rawDestination;
  }

  useEffect(() => {
    let cancelled = false;
    async function loadInvite() {
      setIsLoading(true);
      setError(null);
      try {
        const state = token ? await apiService.inspectTeamInvite(token) : { available: false };
        if (!cancelled) setInviteState(state);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Could not load invite');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadInvite();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const acceptInvite = async () => {
    if (acceptedRef.current) return;
    acceptedRef.current = true;
    setIsAccepting(true);
    setError(null);
    try {
      const result = await apiService.acceptTeamInvite(token);
      onNavigate?.(destinationFromInvite(result.destination));
    } catch (err) {
      acceptedRef.current = false;
      setError(err.message || 'Could not accept invite');
    } finally {
      setIsAccepting(false);
    }
  };

  useEffect(() => {
    if (!token || !user || !inviteState?.available || acceptedRef.current) return;
    acceptInvite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, user, inviteState?.available]);

  const unavailable = !isLoading && (!inviteState?.available || !token);

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
          <h1 className="text-xl font-light text-gray-900 leading-5">Team Invite</h1>
          <p className="text-xs text-gray-500">Join a JobDone Team</p>
        </div>
      </div>

      {error && (
        <div className="px-4 py-3 bg-red-50 border-b border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      <main className="flex-1 px-4 py-6">
        {isLoading ? (
          <p className="py-8 text-center text-sm text-gray-400">Loading...</p>
        ) : unavailable ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-700">This invite is no longer available.</p>
            <button
              type="button"
              onClick={() => onNavigate?.('home')}
              className="w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800"
            >
              Open JobDone
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-500">You have been invited to join</p>
              <p className="mt-1 text-lg font-medium text-gray-900">{inviteState.team?.name || 'a JobDone Team'}</p>
            </div>
            {user ? (
              <button
                type="button"
                disabled={isAccepting}
                onClick={acceptInvite}
                className="w-full px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded hover:bg-gray-800 disabled:opacity-50"
              >
                {isAccepting ? 'Joining...' : 'Accept invite'}
              </button>
            ) : (
              <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                Use the invite email link to sign in as the invited address.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
