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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [installState, setInstallState] = useState(getInstallState);
  const [installMessage, setInstallMessage] = useState(null);

  useEffect(() => listenForInstallPrompt(setInstallState), []);

  const handleGoogleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      await authService.signInWithGoogle();
    } catch (err) {
      setError(err.message || 'Failed to start Google sign-in');
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
        ) : (
          /* Sign-in form */
          <div className="space-y-6">
            <div>
              <p className="text-gray-900 font-medium mb-1">Sign in</p>
              <p className="text-sm text-gray-500">
                Use Google to sync entries across your devices. You can keep using JobDone on this device without signing in.
              </p>
            </div>

            {!authService.isConfigured() && (
              <p className="text-sm text-amber-700">
                Sign-in is not configured in this build. Local capture still works.
              </p>
            )}

            {error && (
              <p className="text-sm text-red-600">{error}</p>
            )}

            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading || !authService.isConfigured()}
              className="w-full px-4 py-3 bg-blue-500 text-white text-sm font-medium rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? 'Opening Google…' : 'Continue with Google'}
            </button>
          </div>
        )}
      </div>
      <FloatingRecordButton onRecord={onRecord} />
    </div>
  );
}
