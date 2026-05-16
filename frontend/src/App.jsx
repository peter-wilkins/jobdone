import { useState, useEffect } from 'react';
import { HomeScreen } from './HomeScreen';
import { FeedbackScreen } from './FeedbackScreen';
import { LoginScreen } from './LoginScreen';
import { authService } from './services/authService';
import { dbService } from './services/dbService';
import { syncService } from './services/syncService';
import { apiService } from './services/apiService';

function App() {
  const [screen, setScreen] = useState('home');
  const [user, setUser] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // Restore existing session on load
    authService.init().then(session => {
      setUser(session?.user || null);
    });

    // Listen for auth state changes
    const unsubscribe = authService.onChange(async (event, session) => {
      const newUser = session?.user || null;
      setUser(newUser);

      if (event === 'SIGNED_IN' && newUser) {
        // Navigate away from login screen if open
        setScreen(s => s === 'login' ? 'home' : s);
        // Merge local ↔ cloud
        await syncOnLogin();
      }
    });

    return unsubscribe;
  }, []);

  // Handle browser back button
  useEffect(() => {
    const handlePopState = () => {
      setScreen('home');
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Navigate with history support
  const navigateTo = (newScreen) => {
    if (newScreen !== 'home' && screen === 'home') {
      // Push state when leaving home
      window.history.pushState({ screen: newScreen }, '', `#${newScreen}`);
    } else if (newScreen === 'home' && screen !== 'home') {
      // Going back to home - replace state
      window.history.replaceState({}, '', window.location.pathname);
    }
    setScreen(newScreen);
  };

  /**
   * On login: push any unsynced local entries to cloud, then pull
   * any cloud entries not yet on this device.
   */
  const syncOnLogin = async () => {
    try {
      // 1. Push: sync confirmed entries that have no remoteId yet
      const unsynced = await dbService.getConfirmedEntriesUnsynced();
      for (const entry of unsynced) {
        try {
          const result = await syncService.syncEntry(entry);
          if (result?.entry?.id) {
            await dbService.markEntrySynced(entry.id, result.entry.id);
          }
        } catch (e) {
          console.warn('[Login] Failed to push entry:', entry.id, e);
        }
      }

      // 2. Pull: fetch cloud entries and add any missing locally
      const cloudEntries = await apiService.getCloudEntries();
      for (const cloudEntry of cloudEntries) {
        const exists = await dbService.getEntryByRemoteId(cloudEntry.id);
        if (!exists) {
          await dbService.addCloudEntry(cloudEntry);
        }
      }
    } catch (e) {
      console.error('[Login] Sync on login failed:', e);
    } finally {
      // Refresh HomeScreen to show merged state
      setRefreshKey(k => k + 1);
    }
  };

  if (screen === 'feedback') {
    return <FeedbackScreen onBack={() => navigateTo('home')} />;
  }

  if (screen === 'login') {
    return <LoginScreen onBack={() => navigateTo('home')} user={user} />;
  }

  return <HomeScreen onNavigate={navigateTo} user={user} refreshKey={refreshKey} />;
}

export default App;
