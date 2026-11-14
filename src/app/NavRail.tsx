import { Bell, CalendarDays, Flag, Goal, Settings, Tv, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RefObject } from 'react';
import { useModules } from '../lib/modules';
import { sectionOfRoute, type Section, type ShellRoute } from '../lib/navigation';

const SECTIONS: ReadonlyArray<{ id: Section; label: string; icon: LucideIcon }> = [
  { id: 'today', label: 'Сегодня', icon: CalendarDays },
  { id: 'football', label: 'Футбол', icon: Goal },
  { id: 'f1', label: 'Формула 1', icon: Flag },
  { id: 'watch', label: 'Смотреть', icon: Tv },
  { id: 'my', label: 'Моё', icon: UserRound },
];

interface NavRailProps {
  route: ShellRoute;
  onChangeSection: (section: Section) => void;
  onOpenEvents: () => void;
  onOpenSettings: () => void;
  /** The event drawer is open, so the bell is the current place. */
  eventsOpen?: boolean;
  unreadCount?: number;
  eventsButtonRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * The permanent narrow rail of the five-section frame. It shows no sport
 * colours: its greys come from the shell tokens, not from the page theme.
 */
export function NavRail({
  route,
  onChangeSection,
  onOpenEvents,
  onOpenSettings,
  eventsOpen = false,
  unreadCount = 0,
  eventsButtonRef,
}: NavRailProps) {
  const modules = useModules();
  const section = sectionOfRoute(route);
  const sections = SECTIONS.filter(({ id }) => id !== 'watch' || modules.watch);
  const service = (name: 'events' | 'settings') => {
    if (name === 'events') return eventsOpen || route.kind === 'events';
    return !eventsOpen && (route.kind === 'settings' || route.kind === 'offline');
  };
  return (
    <aside className="nav-rail">
      <div className="nav-rail-brand" aria-hidden="true">
        SD
      </div>
      <nav className="nav-rail-nav" aria-label="Разделы">
        <div className="nav-rail-group">
          {sections.map(({ id, label, icon: Icon }) => {
            const active = !eventsOpen && section === id;
            return (
              <button
                key={id}
                type="button"
                className="nav-rail-item"
                title={label}
                aria-current={active ? 'page' : undefined}
                onClick={() => onChangeSection(id)}
              >
                <Icon size={20} aria-hidden="true" />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
        <div className="nav-rail-group nav-rail-bottom">
          <button
            ref={eventsButtonRef}
            type="button"
            className="nav-rail-item"
            title={unreadCount > 0 ? `События · непрочитанных: ${unreadCount}` : 'События'}
            aria-current={service('events') ? 'page' : undefined}
            onClick={onOpenEvents}
          >
            <span className="nav-rail-icon">
              <Bell size={20} aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="nav-rail-badge" aria-hidden="true">
                  {unreadCount}
                </span>
              )}
            </span>
            <span>События</span>
          </button>
          <button
            type="button"
            className="nav-rail-item"
            title="Настройки"
            aria-current={service('settings') ? 'page' : undefined}
            onClick={onOpenSettings}
          >
            <Settings size={20} aria-hidden="true" />
            <span>Настройки</span>
          </button>
        </div>
      </nav>
    </aside>
  );
}
