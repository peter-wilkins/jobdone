import { useState, useEffect } from 'react';
import { HomeScreen } from './HomeScreen';
import { FeedbackScreen } from './FeedbackScreen';
import { InboxScreen } from './InboxScreen';
import { PeopleScreen } from './PeopleScreen';
import { LoginScreen } from './LoginScreen';
import { ShareTargetScreen } from './ShareTargetScreen';
import { authService } from './services/authService';
import { dbService } from './services/dbService';
import { syncService } from './services/syncService';
import { apiService } from './services/apiService';
import { queryHistoryService } from './services/queryHistoryService';

function screenFromLocation() {
  const hash = window.location.hash.replace('#', '').split('?')[0];
  const pathname = window.location.pathname;
  // Share target can be /share-target (SW-served) or #share-target (after redirect)
  if (pathname === '/share-target') return 'share-target';
  return ['feedback', 'inbox', 'people', 'login', 'share-target'].includes(hash) ? hash : 'home';
}

function App() {
  const [screen, setScreen] = useState(screenFromLocation);
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
        // eslint-disable-next-line react-hooks/immutability
        await syncOnLogin();
        // Sync query history
        await queryHistoryService.syncOnLogin();
      }
    });

    return unsubscribe;
  }, []);

  // Handle browser back button
  useEffect(() => {
    const handlePopState = () => {
      setScreen(screenFromLocation());
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
      window.history.replaceState({}, '', '/');
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
        const existsByRemoteId = await dbService.getEntryByRemoteId(cloudEntry.id);
        if (existsByRemoteId) continue;

        const existingCaptureEntry = cloudEntry.capture_id
          ? await dbService.getEntryByCaptureId(cloudEntry.capture_id)
          : null;
        if (existingCaptureEntry) {
          if (!existingCaptureEntry.remoteId) {
            await dbService.markEntrySynced(existingCaptureEntry.id, cloudEntry.id);
          }
          continue;
        }

        const existingByCreatedAt = await dbService.getEntryByCreatedAt(cloudEntry.created_at);
        if (existingByCreatedAt) {
          if (!existingByCreatedAt.remoteId) {
            await dbService.markEntrySynced(existingByCreatedAt.id, cloudEntry.id);
          }
        } else {
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

  if (screen === 'inbox') {
    return <InboxScreen onBack={() => navigateTo('home')} />;
  }

  if (screen === 'people') {
    return <PeopleScreen onBack={() => navigateTo('home')} />;
  }

  if (screen === 'share-target') {
    return <ShareTargetScreen onBack={() => navigateTo('home')} user={user} />;
  }

  if (screen === 'login') {
    return <LoginScreen onBack={() => navigateTo('home')} user={user} />;
  }

  return <HomeScreen onNavigate={navigateTo} user={user} refreshKey={refreshKey} />;
}

export default App;
