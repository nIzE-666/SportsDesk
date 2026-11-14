import { Bell, CalendarDays, Flag, Goal, Settings, Tv, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
}

/**
 * The permanent narrow rail of the five-section frame. It shows no sport
 * colours: its greys come from the shell tokens, not from the page theme.
 */
export function NavRail({ route, onChangeSection, onOpenEvents, onOpenSettings }: NavRailProps) {
  const section = sectionOfRoute(route);
  const service = (name: 'events' | 'settings') => {
    if (name === 'events') return route.kind === 'events';
    return route.kind === 'settings' || route.kind === 'offline';
  };
  return (
    <aside className="nav-rail">
      <div className="nav-rail-brand" aria-hidden="true">
        SD
      </div>
      <nav className="nav-rail-nav" aria-label="Разделы">
        <div className="nav-rail-group">
          {SECTIONS.map(({ id, label, icon: Icon }) => {
            const active = section === id;
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
            type="button"
            className="nav-rail-item"
            title="События"
            aria-current={service('events') ? 'page' : undefined}
            onClick={onOpenEvents}
          >
            <Bell size={20} aria-hidden="true" />
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
