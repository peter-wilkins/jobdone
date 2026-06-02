import { useEffect, useRef, useState } from 'react';

const MENU_ITEMS = [
  { screen: 'home', label: 'Home' },
  { screen: 'inbox', label: 'Inbox' },
  { screen: 'contacts', label: 'Contacts' },
  { screen: 'locations', label: 'Locations' },
  { screen: 'team-setup', label: 'Team Setup' },
  { screen: 'my-work', label: 'My Work' },
  { screen: 'feedback', label: 'Report issue' },
];

export function GlobalMenu({
  currentScreen,
  onNavigate,
  user,
  position = 'fixed',
  captureCount = 0,
  installState = null,
  installMessage = '',
  onInstall,
  fastCaptureEnabled = false,
  onFastCaptureChange,
  onCheckForUpdate,
  onClearLocalDatabase,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClick = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isOpen]);

  const goTo = (screen) => {
    setIsOpen(false);
    onNavigate(screen);
  };
  const runAndClose = (fn) => {
    setIsOpen(false);
    fn?.();
  };
  const containerClass = position === 'inline'
    ? 'relative'
    : 'fixed top-3 right-3 z-40';

  return (
    <div className={containerClass} ref={menuRef}>
      <button
        type="button"
        onClick={() => setIsOpen(open => !open)}
        className="w-9 h-9 flex flex-col items-center justify-center gap-1.5 text-gray-500 bg-white/95 border border-gray-200 rounded shadow-sm hover:text-gray-700"
        title="Menu"
      >
        <span className="w-5 h-px bg-current" />
        <span className="w-5 h-px bg-current" />
        <span className="w-5 h-px bg-current" />
      </button>
      {isOpen && (
        <div className="absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded shadow-lg overflow-hidden">
          {user && (
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs text-gray-400">Signed in as</p>
              <p className="text-xs text-gray-700 truncate">{user.email}</p>
            </div>
          )}
          {MENU_ITEMS.map(item => (
            <button
              key={item.screen}
              type="button"
              onClick={() => goTo(item.screen)}
              className={`w-full text-left px-4 py-3 text-sm transition ${
                currentScreen === item.screen
                  ? 'bg-gray-100 text-gray-900 font-medium'
                  : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span>{item.label}</span>
              {item.screen === 'inbox' && captureCount > 0 && (
                <span className="float-right text-xs bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">{captureCount}</span>
              )}
            </button>
          ))}
          {installState?.canShowAction && (
            <div className="border-t border-gray-100">
              <button
                type="button"
                onClick={() => runAndClose(onInstall)}
                className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                Install JobDone
              </button>
              {installMessage && (
                <p className="px-4 pb-3 text-xs leading-5 text-gray-500">{installMessage}</p>
              )}
            </div>
          )}
          {onFastCaptureChange && (
            <label className="flex items-start gap-3 px-4 py-3 border-t border-gray-100 text-sm text-gray-700 hover:bg-gray-50 transition cursor-pointer">
              <input
                type="checkbox"
                checked={fastCaptureEnabled}
                onChange={(event) => onFastCaptureChange(event.target.checked)}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="block font-medium">Fast Capture on this device</span>
                <span className="block text-xs text-gray-400 mt-0.5">Start recording when this device opens JobDone or returns to it</span>
              </span>
            </label>
          )}
          {onCheckForUpdate && (
            <button
              type="button"
              onClick={() => runAndClose(onCheckForUpdate)}
              className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition"
            >
              Check for update
            </button>
          )}
          {onClearLocalDatabase && (
            <button
              type="button"
              onClick={() => runAndClose(onClearLocalDatabase)}
              className="w-full text-left px-4 py-3 text-sm text-red-700 hover:bg-red-50 transition border-t border-gray-100"
            >
              Clear local database
            </button>
          )}
          <button
            type="button"
            onClick={() => goTo('login')}
            className="w-full text-left px-4 py-3 text-sm text-gray-700 hover:bg-gray-50 transition border-t border-gray-100"
          >
            {user ? 'Account' : 'Log in'}
          </button>
        </div>
      )}
    </div>
  );
}
