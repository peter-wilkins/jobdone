import { useState, useEffect } from 'react';
import { HomeScreen } from './HomeScreen';
import { FeedbackScreen } from './FeedbackScreen';
import { InboxScreen } from './InboxScreen';
import { ContactsScreen } from './ContactsScreen';
import { LocationsScreen } from './LocationsScreen';
import { LoginScreen } from './LoginScreen';
import { ShareTargetScreen } from './ShareTargetScreen';
import { TeamSetupScreen } from './TeamSetupScreen';
import { TeamReviewScreen } from './TeamReviewScreen';
import { MyWorkScreen } from './MyWorkScreen';
import { InviteScreen } from './InviteScreen';
import { GlobalMenu } from './GlobalMenu';
import { OnboardingScreen } from './OnboardingScreen';
import { authService } from './services/authService';
import { dbService } from './services/dbService';
import { syncService } from './services/syncService';
import { apiService } from './services/apiService';
import { queryHistoryService } from './services/queryHistoryService';
import { diagnosticService } from './services/diagnosticService';
import { crashReportService } from './services/crashReportService';
import { currentDeploymentEnvironment } from './services/deploymentEnvironmentService';

function screenFromLocation() {
  const hash = window.location.hash.replace('#', '').split('?')[0];
  const pathname = window.location.pathname;
  // Share target can be /share-target (SW-served) or #share-target (after redirect)
  if (pathname === '/share-target') return 'share-target';
  if (pathname === '/invite') return 'invite';
  return ['feedback', 'inbox', 'contacts', 'locations', 'login', 'onboarding', 'share-target', 'team-review', 'team-setup', 'my-work', 'team-work', 'invite'].includes(hash) ? hash : 'home';
}

function isPlainHomeOpen() {
  return window.location.pathname === '/' && window.location.search === '' && window.location.hash === '';
}

function App() {
  const deploymentEnvironment = currentDeploymentEnvironment;
  const [screen, setScreen] = useState(screenFromLocation);
  const [canAutoStartHome] = useState(isPlainHomeOpen);
  const [user, setUser] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recordRequestId, setRecordRequestId] = useState(0);
  const [crashNotice, setCrashNotice] = useState(null);

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
            await dbService.upsertCloudEntryTags(entry.id, result.entry.id, result.entry.tags || []);
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
      const syncedContacts = contactSyncResult?.contacts || [];
      if (syncedContacts.length) {
        for (const cloudContact of syncedContacts) {
          await dbService.upsertCloudContact(cloudContact);
        }
      }

      const cloudContacts = await apiService.getCloudContacts();
      for (const cloudContact of cloudContacts) {
        await dbService.upsertCloudContact(cloudContact);
      }

      const unsyncedLocations = await dbService.getLocationsUnsynced();
      const locationSyncResult = await syncService.syncLocations(unsyncedLocations);
      const syncedLocations = locationSyncResult?.locations || [];
      if (syncedLocations.length) {
        for (const cloudLocation of syncedLocations) {
          await dbService.upsertCloudLocation(cloudLocation);
        }
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
    const previousPaddingTop = document.body.style.paddingTop;
    if (deploymentEnvironment) {
      document.body.style.paddingTop = '28px';
      document.title = deploymentEnvironment.appName;
    }
    return () => {
      document.body.style.paddingTop = previousPaddingTop;
    };
  }, [deploymentEnvironment]);

  useEffect(() => {
    diagnosticService.record('screen_open', { screen: screenFromLocation(), source: 'initial_load' });

    const stopCrashReporting = crashReportService.start({
      api: apiService,
      onStatus: setCrashNotice,
    });

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

    return () => {
      unsubscribe();
      stopCrashReporting();
    };
  }, []);

  // Handle browser back button
  useEffect(() => {
    const handlePopState = () => {
      const nextScreen = screenFromLocation();
      diagnosticService.record('screen_open', { screen: nextScreen, source: 'history' });
      if (nextScreen === 'home') {
        setRecordRequestId(0);
      }
      setScreen(nextScreen);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Navigate with history support
  const navigateTo = (newScreen) => {
    diagnosticService.record('screen_open', { screen: newScreen, source: 'app_navigation' });
    if (newScreen === 'home') {
      setRecordRequestId(0);
    }
    if (newScreen !== 'home' && screen === 'home') {
      // Push state when leaving home
      window.history.pushState({ screen: newScreen }, '', `#${newScreen}`);
    } else if (newScreen === 'home' && screen !== 'home') {
      // Going back to home - replace state
      window.history.replaceState({}, '', '/');
    }
    setScreen(newScreen);
  };

  const handleRecordRequestHandled = () => {
    setRecordRequestId(0);
  };

  const startRecordingFromShortcut = () => {
    diagnosticService.record('record_shortcut_used', { from: screen });
    setRecordRequestId(id => id + 1);
    window.history.replaceState({}, '', '/');
    setScreen('home');
  };

  const crashStatusBar = crashNotice ? (
    <div className="fixed top-0 inset-x-0 z-50 bg-red-600 text-white shadow-sm">
      <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-3">
        <span className="text-sm font-medium flex-1">{crashNotice.message}</span>
        <button
          type="button"
          className="text-xs font-semibold uppercase tracking-wide text-white/90 hover:text-white"
          onClick={() => setCrashNotice(null)}
        >
          Dismiss
        </button>
      </div>
    </div>
  ) : null;
  const environmentBanner = deploymentEnvironment ? (
    <div className={`fixed top-0 inset-x-0 z-[60] h-7 px-3 text-center text-[11px] font-semibold tracking-wide leading-7 shadow-sm ${deploymentEnvironment.bannerClassName}`}>
      {deploymentEnvironment.label} - {deploymentEnvironment.appName}
    </div>
  ) : null;
  const globalMenu = screen === 'home'
    ? null
    : <GlobalMenu currentScreen={screen} onNavigate={navigateTo} user={user} />;

  if (screen === 'feedback') {
    return <>{environmentBanner}{crashStatusBar}{globalMenu}<FeedbackScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} /></>;
  }

  if (screen === 'inbox') {
    return <>{environmentBanner}{crashStatusBar}{globalMenu}<InboxScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} /></>;
  }

  if (screen === 'contacts') {
    return <>{environmentBanner}{crashStatusBar}{globalMenu}<ContactsScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} /></>;
  }

  if (screen === 'locations') {
    return <>{environmentBanner}{crashStatusBar}{globalMenu}<LocationsScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} /></>;
  }

  if (screen === 'share-target') {
    return <>{environmentBanner}{crashStatusBar}{globalMenu}<ShareTargetScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} user={user} /></>;
  }

  if (screen === 'login') {
    return <>{environmentBanner}{crashStatusBar}{globalMenu}<LoginScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} user={user} /></>;
  }

  if (screen === 'onboarding') {
    return <>{environmentBanner}{crashStatusBar}{globalMenu}<OnboardingScreen onBack={() => navigateTo('home')} /></>;
  }

  if (screen === 'team-setup') {
    return <>{environmentBanner}{crashStatusBar}{globalMenu}<TeamSetupScreen onBack={() => navigateTo('home')} onNavigate={navigateTo} user={user} /></>;
  }

  if (screen === 'team-review') {
    return <>{environmentBanner}{crashStatusBar}{globalMenu}<TeamReviewScreen onBack={() => navigateTo('home')} onNavigate={navigateTo} user={user} /></>;
  }

  if (screen === 'my-work' || screen === 'team-work') {
    return <>{environmentBanner}{crashStatusBar}{globalMenu}<MyWorkScreen onBack={() => navigateTo('home')} /></>;
  }

  if (screen === 'invite') {
    return <>{environmentBanner}{crashStatusBar}{globalMenu}<InviteScreen onBack={() => navigateTo('home')} onNavigate={navigateTo} user={user} /></>;
  }

  return (
    <>
      {environmentBanner}
      {crashStatusBar}
      <HomeScreen
        onNavigate={navigateTo}
        user={user}
        refreshKey={refreshKey}
        canAutoStart={canAutoStartHome}
        recordRequestId={recordRequestId}
        onRecordRequestHandled={handleRecordRequestHandled}
      />
    </>
  );
}

export default App;
