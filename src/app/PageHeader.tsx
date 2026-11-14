import { ChevronLeft, Pin } from 'lucide-react';
import { GlobalSearch } from '../components/GlobalSearch';
import { AmbientToggle } from '../features/atmosphere/AmbientToggle';
import type { ShellRoute } from '../lib/navigation';
import type { SearchTarget } from '../lib/searchIndex';
import { headerTabs, lastAnalysisMode, pageTitle } from './shellModel';

interface PageHeaderProps {
  route: ShellRoute;
  leagueId: string;
  sport: 'football' | 'f1';
  canBack: boolean;
  onBack: () => void;
  onNavigate: (route: ShellRoute) => void;
  onSearchTarget: (target: SearchTarget) => void;
  onOpenMini: () => Promise<void>;
}

/** Thin header above the page: title, search, live mini window and the section tabs. */
export function PageHeader({
  route,
  leagueId,
  sport,
  canBack,
  onBack,
  onNavigate,
  onSearchTarget,
  onOpenMini,
}: PageHeaderProps) {
  const tabs = headerTabs(route);
  return (
    <header className="shell-header">
      <div className="shell-header-bar">
        {canBack && (
          <button
            type="button"
            className="shell-back icon-button"
            aria-label="Назад"
            title="Назад · Alt+←"
            onClick={onBack}
          >
            <ChevronLeft size={20} aria-hidden="true" />
          </button>
        )}
        <h1 className="shell-page-title">{pageTitle(route, leagueId)}</h1>
        <div className="shell-header-actions">
          <GlobalSearch onNavigate={onSearchTarget} />
          <AmbientToggle sport={sport} />
          <button
            type="button"
            className="watch-shortcut"
            aria-label="Live-мини"
            title="Мини-окно live-счёта поверх всех окон"
            onClick={() => void onOpenMini()}
          >
            <Pin size={15} aria-hidden="true" />
            <span>Live-мини</span>
          </button>
        </div>
      </div>
      {tabs.length > 0 && (
        <div className="shell-tabs" role="tablist" aria-label="Разделы страницы">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              className="shell-tab"
              aria-selected={tab.active}
              onClick={() =>
                onNavigate(
                  tab.key === 'analysis' && route.kind === 'f1'
                    ? { kind: 'f1', tab: lastAnalysisMode() }
                    : tab.route,
                )
              }
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
