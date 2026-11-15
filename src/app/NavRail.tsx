import { Bell, CalendarDays, Flag, Goal, Settings, Tv, UserRound } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RefObject } from 'react';
import { Tabs } from '../kit';
import { useModules } from '../lib/modules';
import { sectionOfRoute, type Section, type ShellRoute } from '../lib/navigation';

const SECTIONS: ReadonlyArray<{ id: Section; label: string; icon: LucideIcon }> = [
  { id: 'today', label: 'Сегодня', icon: CalendarDays },
  { id: 'football', label: 'Футбол', icon: Goal },
  { id: 'f1', label: 'Формула 1', icon: Flag },
  { id: 'watch', label: 'Смотреть', icon: Tv },
  { id: 'my', label: 'Моё', icon: UserRound },
];

type RailItem = Section | 'events' | 'settings';

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
  const active: RailItem | undefined =
    eventsOpen || route.kind === 'events'
      ? 'events'
      : route.kind === 'settings'
        ? 'settings'
        : section;
  const items = [
    ...sections.map(({ id, label, icon: Icon }) => ({
      id,
      domId: `rail-${id}`,
      title: label,
      label,
      icon: <Icon size={20} aria-hidden="true" />,
    })),
    {
      id: 'events' as const,
      domId: 'rail-events',
      title: unreadCount > 0 ? `События · непрочитанных: ${unreadCount}` : 'События',
      icon: undefined,
      ref: eventsButtonRef
        ? (element: HTMLElement | null) => {
            eventsButtonRef.current = element instanceof HTMLButtonElement ? element : null;
          }
        : undefined,
      label: (
        <>
          <span className="nav-rail-icon">
            <Bell size={20} aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="nav-rail-badge" aria-hidden="true">
                {unreadCount}
              </span>
            )}
          </span>
          <span>События</span>
        </>
      ),
    },
    {
      id: 'settings' as const,
      domId: 'rail-settings',
      title: 'Настройки',
      icon: <Settings size={20} aria-hidden="true" />,
      label: 'Настройки',
    },
  ];
  const choose = (id: string) => {
    if (id === 'events') onOpenEvents();
    else if (id === 'settings') onOpenSettings();
    else onChangeSection(id as Section);
  };
  return (
    <aside className="nav-rail">
      <div className="nav-rail-brand" aria-hidden="true">
        SD
      </div>
      <div className="nav-rail-nav">
        <Tabs mode="nav" ariaLabel="Разделы" active={active} items={items} onChange={choose} />
      </div>
    </aside>
  );
}
