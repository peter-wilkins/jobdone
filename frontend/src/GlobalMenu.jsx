import { useRef, useState } from 'react';
import { useOutsideDismiss } from './services/outsideDismissService';
import { teamScreenId } from './services/teamNavigationService';

const MENU_ITEMS = [
  { screen: 'team-setup', label: 'Create Team' },
  { screen: 'water-walk', label: 'Water Walk' },
  { screen: 'contacts', label: 'Contacts' },
  { screen: 'locations', label: 'Locations' },
  { screen: 'onboarding', label: 'Onboarding' },
  { screen: 'feedback', label: 'Share idea' },
];

export function GlobalMenu({
  currentScreen,
  onNavigate,
  user,
  teams = [],
}) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef(null);

  useOutsideDismiss(isOpen, [menuRef], () => setIsOpen(false));

  const goTo = (screen) => {
    setIsOpen(false);
    onNavigate(screen);
  };
  return (
    <div className="fixed top-3 right-3 z-50" ref={menuRef}>
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
        <div className="absolute right-0 z-50 mt-2 w-56 bg-white border border-gray-200 rounded shadow-lg overflow-hidden">
          {user && (
            <div className="px-4 py-3 border-b border-gray-100">
              <p className="text-xs text-gray-400">Signed in as</p>
              <p className="text-xs text-gray-700 truncate">{user.email}</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => goTo('home')}
            className={`w-full text-left px-4 py-3 text-sm transition ${
              currentScreen === 'home'
                ? 'bg-gray-100 text-gray-900 font-medium'
                : 'text-gray-700 hover:bg-gray-50'
            }`}
          >
            <span>Personal</span>
          </button>
          {teams.length > 0 && (
            <div className="border-b border-gray-100 py-1">
              <p className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">Teams</p>
              {teams.map(team => {
                const screen = teamScreenId(team.id);
                return (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => goTo(screen)}
                    className={`w-full text-left px-4 py-2.5 text-sm transition ${
                      currentScreen === screen
                        ? 'bg-gray-100 text-gray-900 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <span className="block truncate">{team.name || 'Team'}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="border-t border-gray-200">
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
              </button>
            ))}
          </div>
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
