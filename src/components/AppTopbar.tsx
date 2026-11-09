import { Bell, ChevronLeft, Flag, Goal, Pin, Settings, Trophy, Tv, Zap } from 'lucide-react';
import { GlobalSearch } from './GlobalSearch';
import type { SearchTarget } from '../lib/searchIndex';
import type { ShellRoute, Sport } from '../lib/navigation';
import { DesignToggle } from './DesignChooser';
import { AmbientToggle } from '../features/atmosphere/AmbientToggle';
interface Props {
  sport: Sport;
  route: ShellRoute;
  date: string;
  reset: () => void;
  changeMode: (mode: Sport) => void;
  openMini: () => Promise<void>;
  onWatch: () => void;
  onSettings: () => void;
  onBack: () => void;
  canBack: boolean;
  onSearchTarget: (target: SearchTarget) => void;
  onEvents: () => void;
}
export function AppTopbar({
  sport,
  route,
  date,
  reset,
  changeMode,
  openMini,
  onWatch,
  onSettings,
  onBack,
  canBack,
  onSearchTarget,
  onEvents,
}: Props) {
  return (
    <header className="topbar">
      <button className="brand" aria-label="SportsDesk — главная" onClick={reset}>
        <span className="brand-mark">
          <Zap size={22} fill="currentColor" />
        </span>
        <span className="brand-text">
          <strong>
            sports<span>desk</span>
            <em>●</em>
          </strong>
          <small>ВАША ИГРА. КАЖДЫЙ ДЕНЬ.</small>
        </span>
      </button>
      <button
        className="icon-button history-back"
        onClick={onBack}
        disabled={!canBack}
        aria-label="Назад по истории"
        title="Назад · Alt+←"
      >
        <ChevronLeft size={20} />
      </button>
      <div className="sport-toggle" role="tablist" aria-label="Вид спорта">
        {(
          [
            { id: 'football', name: 'Футбол', icon: Goal },
            { id: 'f1', name: 'Формула 1', icon: Flag },
            { id: 'ucl', name: 'Лига чемпионов', icon: Trophy },
            { id: 'cup', name: 'Кубки', icon: Trophy },
          ] as const
        ).map(({ id, name, icon: Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={sport === id}
            onClick={() => changeMode(id)}
            className={sport === id ? 'active' : ''}
          >
            <Icon size={16} />
            <span>{name}</span>
          </button>
        ))}
      </div>
      <div className="topbar-actions">
        <GlobalSearch onNavigate={onSearchTarget} />
        <button
          className="icon-button"
          aria-label="Центр событий"
          title="Центр событий"
          onClick={onEvents}
        >
          <Bell size={18} />
        </button>
        <AmbientToggle sport={sport} />
        <span className="header-date">{date}</span>
        <button
          className="watch-shortcut"
          aria-label="Live-мини"
          onClick={() => void openMini()}
          title="Мини-окно live-счёта поверх всех окон"
        >
          <Pin size={15} />
          <span>Live-мини</span>
        </button>
        <button
          className={`watch-shortcut ${route.kind === 'watch' ? 'active' : ''}`}
          aria-label="Смотреть"
          onClick={onWatch}
        >
          <Tv size={16} />
          <span>Смотреть</span>
        </button>
        <DesignToggle />
        <button className="icon-button" aria-label="Настройки" onClick={onSettings}>
          <Settings size={18} />
        </button>
        <button
          className="profile-monogram"
          title="Личное пространство"
          aria-label="Профиль и настройки"
          onClick={onSettings}
        >
          W
        </button>
      </div>
    </header>
  );
}
