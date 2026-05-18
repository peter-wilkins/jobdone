import { useState, useEffect } from 'react';
import { HomeScreen } from './HomeScreen';
import { FeedbackScreen } from './FeedbackScreen';
import { InboxScreen } from './InboxScreen';
import { ContactsScreen } from './ContactsScreen';
import { LoginScreen } from './LoginScreen';
import { ShareTargetScreen } from './ShareTargetScreen';
import { authService } from './services/authService';
import { dbService } from './services/dbService';
import { syncService } from './services/syncService';
import { apiService } from './services/apiService';
import { queryHistoryService } from './services/queryHistoryService';
import { diagnosticService } from './services/diagnosticService';

function screenFromLocation() {
  const hash = window.location.hash.replace('#', '').split('?')[0];
  const pathname = window.location.pathname;
  // Share target can be /share-target (SW-served) or #share-target (after redirect)
  if (pathname === '/share-target') return 'share-target';
  if (hash === 'people') return 'contacts';
  return ['feedback', 'inbox', 'contacts', 'login', 'share-target'].includes(hash) ? hash : 'home';
}

function isPlainHomeOpen() {
  return window.location.pathname === '/' && window.location.search === '' && window.location.hash === '';
}

function App() {
  const [screen, setScreen] = useState(screenFromLocation);
  const [canAutoStartHome] = useState(isPlainHomeOpen);
  const [user, setUser] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  /**
   * Push unsynced local confirmed data to cloud, then pull cloud data not yet on this device.
   */
  async function syncConfirmedData() {
    try {
      const unsynced = await dbService.getConfirmedEntriesUnsynced();
      for (const entry of unsynced) {
        try {
          const result = await syncService.syncEntry(entry);
          if (result?.entry?.id) {
            await dbService.markEntrySynced(entry.id, result.entry.id);
            await dbService.upsertCloudEntryLocations(entry.id, result.entry.id, result.entry.locations || []);
          }
        } catch (e) {
          console.warn('[Login] Failed to push entry:', entry.id, e);
        }
      }

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

      const unsyncedContacts = await dbService.getContactsUnsynced();
      const contactSyncResult = await syncService.syncContacts(unsyncedContacts);
      const syncedContacts = contactSyncResult?.contacts || contactSyncResult?.people || [];
      if (syncedContacts.length) {
        for (const cloudContact of syncedContacts) {
          await dbService.upsertCloudContact(cloudContact);
        }
      }

      const cloudContacts = await apiService.getCloudContacts();
      for (const cloudContact of cloudContacts) {
        await dbService.upsertCloudContact(cloudContact);
      }

      const cloudLocations = await apiService.getCloudLocations();
      for (const cloudLocation of cloudLocations) {
        await dbService.upsertCloudLocation(cloudLocation);
      }
    } catch (e) {
      console.error('[Sync] Confirmed data sync failed:', e);
    } finally {
      setRefreshKey(k => k + 1);
    }
  }

  useEffect(() => {
    // Restore existing session on load
    authService.init().then(session => {
      setUser(session?.user || null);
      if (session?.user) {
        syncConfirmedData();
      }
    });

    // Listen for auth state changes
    const unsubscribe = authService.onChange(async (event, session) => {
      const newUser = session?.user || null;
      setUser(newUser);

      if (event === 'SIGNED_IN' && newUser) {
        // Navigate away from login screen if open
        setScreen(s => s === 'login' ? 'home' : s);
        // Merge local ↔ cloud
        await syncConfirmedData();
        // Sync query history
        await queryHistoryService.syncOnLogin();
      }
    });

    return unsubscribe;
  }, []);

  // Handle browser back button
  useEffect(() => {
    const handlePopState = () => {
      const nextScreen = screenFromLocation();
      diagnosticService.record('screen_open', { screen: nextScreen, source: 'history' });
      setScreen(nextScreen);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Navigate with history support
  const navigateTo = (newScreen) => {
    diagnosticService.record('screen_open', { screen: newScreen, source: 'app_navigation' });
    if (newScreen !== 'home' && screen === 'home') {
      // Push state when leaving home
      window.history.pushState({ screen: newScreen }, '', `#${newScreen}`);
    } else if (newScreen === 'home' && screen !== 'home') {
      // Going back to home - replace state
      window.history.replaceState({}, '', '/');
    }
    setScreen(newScreen);
  };

  if (screen === 'feedback') {
    return <FeedbackScreen onBack={() => navigateTo('home')} />;
  }

  if (screen === 'inbox') {
    return <InboxScreen onBack={() => navigateTo('home')} />;
  }

  if (screen === 'contacts') {
    return <ContactsScreen onBack={() => navigateTo('home')} />;
  }

  if (screen === 'share-target') {
    return <ShareTargetScreen onBack={() => navigateTo('home')} user={user} />;
  }

  if (screen === 'login') {
    return <LoginScreen onBack={() => navigateTo('home')} user={user} />;
  }

  return <HomeScreen onNavigate={navigateTo} user={user} refreshKey={refreshKey} canAutoStart={canAutoStartHome} />;
}

export default App;
