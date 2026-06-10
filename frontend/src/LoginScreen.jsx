import { useEffect, useState } from 'react';
import { authService } from './services/authService';
import { apiService } from './services/apiService';
import { dbService } from './services/dbService';
import { FloatingRecordButton } from './FloatingRecordButton';
import {
  dismissInstallPrompt,
  getInstallState,
  listenForInstallPrompt,
  requestInstall,
} from './services/installPromptService';

export function LoginScreen({ onBack, onRecord, user }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [installState, setInstallState] = useState(getInstallState);
  const [installMessage, setInstallMessage] = useState(null);

  useEffect(() => listenForInstallPrompt(setInstallState), []);

  const handleGoogleSignIn = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      await authService.signInWithGoogle();
      // browser will redirect — no further action needed
    } catch (err) {
      setError(err.message || 'Google sign-in failed');
      setGoogleLoading(false);
    }
  };

  const handleSend = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authService.sendMagicLink(email.trim());
      setSent(true);
    } catch (err) {
      setError(err.message || 'Failed to send link');
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = async () => {
    await authService.signOut();
    onBack();
  };

  const handleDeleteConfirm = async () => {
    setDeleteLoading(true);
    setError(null);
    try {
      await dbService.clearAll();
      await apiService.deleteUserData();
      await authService.signOut();
      onBack();
    } catch (err) {
      setError(err.message || 'Failed to delete data');
      setShowDeleteConfirm(false);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleInstall = async () => {
    setInstallMessage(null);
    const result = await requestInstall();
    if (result.mode === 'manual') {
      setInstallMessage('In Chrome, open the menu and choose Install app. You can keep using JobDone here too.');
    } else if (result.outcome === 'dismissed') {
      setInstallMessage('No problem. You can install from the menu later.');
    }
    setInstallState(getInstallState());
  };

  const handleDismissInstall = () => {
    dismissInstallPrompt();
    setInstallMessage(null);
    setInstallState(getInstallState());
  };

  return (
    <div className="h-screen bg-white flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 p-6 flex items-center gap-4">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-600 transition"
        >
          ←
        </button>
        <h1 className="text-2xl font-light text-gray-900">Account</h1>
      </div>

      <div className="flex-1 flex flex-col justify-center px-8">
        {installState.canShowOnboardingPrompt && (
          <div className="mb-6 rounded border border-blue-100 bg-blue-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-blue-950">Install JobDone for Android sharing</p>
                <p className="mt-1 text-xs leading-5 text-blue-800">
                  Installed JobDone can appear when you share contacts, photos, and links from Android. Browser use still works.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDismissInstall}
                className="text-blue-400 hover:text-blue-700 transition"
                title="Dismiss"
              >
                ×
              </button>
            </div>
            <button
              type="button"
              onClick={handleInstall}
              className="mt-3 px-3 py-2 bg-blue-500 text-white text-xs font-medium rounded hover:bg-blue-600 transition"
            >
              Install JobDone
            </button>
            {installMessage && (
              <p className="mt-2 text-xs leading-5 text-blue-800">{installMessage}</p>
            )}
          </div>
        )}

        {user ? (
          /* Logged-in state */
          <div className="space-y-6">
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Signed in as</p>
              <p className="text-gray-900">{user.email}</p>
              <p className="text-xs text-gray-400 mt-2">
                Your entries sync across all your devices.
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            {showDeleteConfirm ? (
              <div className="space-y-3 p-4 border border-red-200 rounded-lg bg-red-50">
                <p className="text-sm text-red-900 font-medium">Delete all your data?</p>
                <p className="text-xs text-red-700">
                  This permanently deletes all entries, queries, and feedback. Cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleDeleteConfirm}
                    disabled={deleteLoading}
                    className="flex-1 px-4 py-2 bg-red-500 text-white text-sm font-medium rounded hover:bg-red-600 disabled:opacity-50 transition"
                  >
                    {deleteLoading ? 'Deleting…' : 'Delete everything'}
                  </button>
                  <button
                    onClick={() => { setShowDeleteConfirm(false); setError(null); }}
                    className="flex-1 px-4 py-2 border border-red-300 text-red-700 text-sm font-medium rounded hover:bg-red-100 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="w-full px-4 py-3 border border-red-300 text-red-700 text-sm font-medium rounded hover:bg-red-50 transition"
              >
                Delete my data
              </button>
            )}

            <button
              onClick={handleSignOut}
              className="w-full px-4 py-3 border border-gray-300 text-gray-700 text-sm font-medium rounded hover:bg-gray-50 transition"
            >
              Sign out
            </button>
          </div>
        ) : sent ? (
          /* Link sent state */
          <div className="space-y-4 text-center">
            <p className="text-2xl">📬</p>
            <p className="text-gray-900 font-medium">Check your inbox</p>
            <p className="text-sm text-gray-500">
              We sent a link to <strong>{email}</strong>.
              Tap it to sign in — no password needed.
            </p>
            <button
              onClick={() => { setSent(false); setEmail(''); }}
              className="text-sm text-gray-400 hover:text-gray-600 transition"
            >
              Use a different email
            </button>
          </div>
        ) : (
          /* Sign-in form */
          <div className="space-y-6">
            <div>
              <p className="text-gray-900 font-medium mb-1">Sign in</p>
              <p className="text-sm text-gray-500">
                Enter your email and we'll send you a link. Tap it to sign in — no password needed.
                Your entries sync across all your devices.
              </p>
            </div>

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {googleLoading ? 'Redirecting…' : (
                <>
                  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                    <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
                    <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.909-2.259c-.805.54-1.836.86-3.047.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                    <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                    <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
                  </svg>
                  Sign in with Google
                </>
              )}
            </button>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gray-200" />
              <span className="text-xs text-gray-400">or</span>
              <div className="flex-1 h-px bg-gray-200" />
            </div>

            <form onSubmit={handleSend} className="space-y-3">
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                autoFocus
                className="w-full px-4 py-3 border border-gray-300 rounded text-sm focus:outline-none focus:border-blue-400 transition"
              />
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="w-full px-4 py-3 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {loading ? 'Sending…' : 'Send magic link'}
              </button>
            </form>
          </div>
        )}
      </div>
      <FloatingRecordButton onRecord={onRecord} />
    </div>
  );
}
