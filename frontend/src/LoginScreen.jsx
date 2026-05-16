import { useState } from 'react';
import { authService } from './services/authService';
import { apiService } from './services/apiService';

export function LoginScreen({ onBack, user }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  const handleDeleteData = async () => {
    if (!window.confirm(
      'This will permanently delete all your entries, queries, and feedback. This cannot be undone. Continue?'
    )) return;

    try {
      await apiService.deleteUserData();
      alert('All your data has been deleted.');
      await authService.signOut();
      onBack();
    } catch (err) {
      alert('Failed to delete data: ' + (err.message || 'Unknown error'));
    }
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
            <button
              onClick={handleDeleteData}
              className="w-full px-4 py-3 border border-red-300 text-red-700 text-sm font-medium rounded hover:bg-red-50 transition"
            >
              Delete my data
            </button>
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
    </div>
  );
}
