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
import { authService, consumeAuthErrorFromLocation } from './services/authService';
import { apiService } from './services/apiService';
import { syncOrchestratorService } from './services/syncOrchestratorService';
import { queryHistoryService } from './services/queryHistoryService';
import { diagnosticService } from './services/diagnosticService';
import { crashReportService } from './services/crashReportService';
import { currentDeploymentEnvironment } from './services/deploymentEnvironmentService';
import { debugApiDetailsEnabledForUser } from './services/debugUserService';
import {
  API_ERROR_DETAIL_EVENT,
  setApiErrorDetailsEnabled,
} from './services/requestDiagnosticsService';

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
  const [authNotice, setAuthNotice] = useState(null);
  const [syncNotice, setSyncNotice] = useState(null);
  const [apiDebugDetail, setApiDebugDetail] = useState(null);
  const [apiDebugReportStatus, setApiDebugReportStatus] = useState(null);

  async function runConfirmedDataSync(reason) {
    const syncUser = authService.getUser();
    setApiErrorDetailsEnabled(debugApiDetailsEnabledForUser(syncUser));
    try {
      const result = await syncOrchestratorService.syncConfirmedData({ reason });
      if (result.ok) {
        setSyncNotice(null);
      } else {
        setSyncNotice({
          message: 'Cloud sync hit a problem. Local data is safe; JobDone will retry.',
          debugDetail: result.issues?.[0]?.debugDetail || null,
        });
      }
      return result;
    } catch (error) {
      console.error('[Sync] Confirmed data sync failed:', error);
      setSyncNotice({
        message: 'Cloud sync hit a problem. Local data is safe; JobDone will retry.',
      });
      return { ok: false, issues: [{ message: error?.message || 'Sync failed' }] };
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
    const enabled = debugApiDetailsEnabledForUser(user);
    setApiErrorDetailsEnabled(enabled);
  }, [user]);

  useEffect(() => {
    const onApiErrorDetail = (event) => {
      if (debugApiDetailsEnabledForUser(authService.getUser())) {
        setApiDebugDetail(event.detail || null);
        setApiDebugReportStatus(null);
      }
    };
    window.addEventListener(API_ERROR_DETAIL_EVENT, onApiErrorDetail);
    return () => window.removeEventListener(API_ERROR_DETAIL_EVENT, onApiErrorDetail);
  }, []);

  useEffect(() => {
    diagnosticService.record('screen_open', { screen: screenFromLocation(), source: 'initial_load' });

    const stopCrashReporting = crashReportService.start({
      api: apiService,
      onStatus: setCrashNotice,
    });

    const authError = consumeAuthErrorFromLocation();
    if (authError) {
      const message = authError.code === 'otp_expired'
        ? 'That sign-in link has expired. Send yourself a fresh magic link.'
        : authError.message;
      queueMicrotask(() => setAuthNotice({ message }));
    }

    // Restore existing session on load
    authService.init().then(session => {
      setUser(session?.user || null);
      if (session?.user) {
        runConfirmedDataSync('initial_session');
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
        await runConfirmedDataSync('signed_in');
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

  const sendApiDebugReport = async () => {
    if (!apiDebugDetail) return;
    setApiDebugReportStatus('sending');
    try {
      await apiService.saveFeedback({
        transcript: `API debug report: ${apiDebugDetail.method || 'GET'} ${apiDebugDetail.endpoint || 'unknown'} returned ${apiDebugDetail.status || 'non-200'}.`,
        created_at: new Date().toISOString(),
        diagnostic_bundle: {
          report_type: 'api_debug_report',
          bridge_requested: true,
          route: {
            screen,
            path: window.location.pathname,
            hash: window.location.hash,
          },
          api_error_detail: apiDebugDetail,
        },
      });
      setApiDebugReportStatus('sent');
    } catch (error) {
      setApiDebugReportStatus(error?.message || 'failed');
    }
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
  const debugApiNotice = debugApiDetailsEnabledForUser(user) && apiDebugDetail
    ? {
        message: `API debug: ${apiDebugDetail.method || 'GET'} ${apiDebugDetail.endpoint || 'unknown'} returned ${apiDebugDetail.status || 'non-200'}.`,
        debugDetail: apiDebugDetail,
      }
    : null;
  const syncNoticeWithDebug = syncNotice
    ? { ...syncNotice, debugDetail: syncNotice.debugDetail || apiDebugDetail }
    : null;
  const activeNotice = authNotice || syncNoticeWithDebug || debugApiNotice;
  const activeDebugDetail = activeNotice?.debugDetail || null;
  const authStatusBar = activeNotice ? (
    <div className={`fixed ${deploymentEnvironment ? 'top-7' : 'top-0'} inset-x-0 z-50 bg-red-600 text-white shadow-sm`}>
      <div className="max-w-3xl mx-auto px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium flex-1">{activeNotice.message}</span>
          <button
            type="button"
            className="text-xs font-semibold uppercase tracking-wide text-white/90 hover:text-white"
            onClick={() => {
              setAuthNotice(null);
              setSyncNotice(null);
              setApiDebugDetail(null);
            }}
          >
            Dismiss
          </button>
        </div>
        {activeDebugDetail && (
          <details className="mt-2 rounded border border-white/30 bg-black/20 px-2 py-1 text-xs">
            <summary className="cursor-pointer font-semibold">Debug details</summary>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                className="rounded bg-white px-2 py-1 text-xs font-semibold text-red-700"
                disabled={apiDebugReportStatus === 'sending'}
                onClick={sendApiDebugReport}
              >
                {apiDebugReportStatus === 'sending' ? 'Sending...' : 'Send debug report'}
              </button>
              {apiDebugReportStatus && apiDebugReportStatus !== 'sending' && (
                <span className="text-white/90">
                  {apiDebugReportStatus === 'sent' ? 'Sent' : `Failed: ${apiDebugReportStatus}`}
                </span>
              )}
            </div>
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words">
              {JSON.stringify(activeDebugDetail, null, 2)}
            </pre>
          </details>
        )}
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
    return <>{environmentBanner}{crashStatusBar}{authStatusBar}{globalMenu}<FeedbackScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} /></>;
  }

  if (screen === 'inbox') {
    return <>{environmentBanner}{crashStatusBar}{authStatusBar}{globalMenu}<InboxScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} /></>;
  }

  if (screen === 'contacts') {
    return <>{environmentBanner}{crashStatusBar}{authStatusBar}{globalMenu}<ContactsScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} /></>;
  }

  if (screen === 'locations') {
    return <>{environmentBanner}{crashStatusBar}{authStatusBar}{globalMenu}<LocationsScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} /></>;
  }

  if (screen === 'share-target') {
    return <>{environmentBanner}{crashStatusBar}{authStatusBar}{globalMenu}<ShareTargetScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} user={user} /></>;
  }

  if (screen === 'login') {
    return <>{environmentBanner}{crashStatusBar}{authStatusBar}{globalMenu}<LoginScreen onBack={() => navigateTo('home')} onRecord={startRecordingFromShortcut} user={user} /></>;
  }

  if (screen === 'onboarding') {
    return <>{environmentBanner}{crashStatusBar}{authStatusBar}{globalMenu}<OnboardingScreen onBack={() => navigateTo('home')} /></>;
  }

  if (screen === 'team-setup') {
    return <>{environmentBanner}{crashStatusBar}{authStatusBar}{globalMenu}<TeamSetupScreen onBack={() => navigateTo('home')} onNavigate={navigateTo} user={user} /></>;
  }

  if (screen === 'team-review') {
    return <>{environmentBanner}{crashStatusBar}{authStatusBar}{globalMenu}<TeamReviewScreen onBack={() => navigateTo('home')} onNavigate={navigateTo} user={user} /></>;
  }

  if (screen === 'my-work' || screen === 'team-work') {
    return <>{environmentBanner}{crashStatusBar}{authStatusBar}{globalMenu}<MyWorkScreen onBack={() => navigateTo('home')} /></>;
  }

  if (screen === 'invite') {
    return <>{environmentBanner}{crashStatusBar}{authStatusBar}{globalMenu}<InviteScreen onBack={() => navigateTo('home')} onNavigate={navigateTo} user={user} /></>;
  }

  return (
    <>
      {environmentBanner}
      {crashStatusBar}
      {authStatusBar}
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
