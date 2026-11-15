import { ChevronLeft, Pin } from 'lucide-react';
import { GlobalSearch } from '../components/GlobalSearch';
import { AmbientToggle } from '../features/atmosphere/AmbientToggle';
import { Button, IconButton, Tabs } from '../kit';
import type { ShellRoute } from '../lib/navigation';
import type { SearchTarget } from '../lib/searchIndex';
import { CompetitionSwitcher } from './CompetitionSwitcher';
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
  const openByKey = (key: string) => {
    const tab = tabs.find((item) => item.key === key);
    if (!tab) return;
    onNavigate(
      tab.key === 'analysis' && route.kind === 'f1'
        ? { kind: 'f1', tab: lastAnalysisMode() }
        : tab.route,
    );
  };
  const football = route.kind === 'football' || route.kind === 'football-match';
  return (
    <header className="shell-header">
      <div className="shell-header-bar">
        {canBack && (
          <IconButton
            className="shell-back"
            aria-label="Назад"
            title="Назад · Alt+←"
            icon={<ChevronLeft size={20} aria-hidden="true" />}
            onClick={onBack}
          />
        )}
        {football ? (
          <h1 className="shell-page-title shell-page-title-switcher">
            <CompetitionSwitcher
              competitionId={route.competitionId}
              tab={route.kind === 'football' ? route.tab : undefined}
              suffix={route.kind === 'football-match' ? 'Матч' : undefined}
              onNavigate={onNavigate}
            />
          </h1>
        ) : (
          <h1 className="shell-page-title">{pageTitle(route, leagueId)}</h1>
        )}
        <div className="shell-header-actions">
          <GlobalSearch onNavigate={onSearchTarget} />
          <AmbientToggle sport={sport} />
          <Button
            variant="quiet"
            className="watch-shortcut"
            aria-label="Live-мини"
            title="Мини-окно live-счёта поверх всех окон"
            icon={<Pin size={15} aria-hidden="true" />}
            onClick={() => void onOpenMini()}
          >
            Live-мини
          </Button>
        </div>
      </div>
      {tabs.length > 0 && (
        <div className="shell-tabs">
          <Tabs
            mode="tabs"
            ariaLabel="Разделы страницы"
            panelId="shell-page-panel"
            active={tabs.find((tab) => tab.active)?.key}
            items={tabs.map((tab) => ({
              id: tab.key,
              domId: `shell-tab-${tab.key}`,
              label: tab.label,
            }))}
            onChange={openByKey}
          />
        </div>
      )}
    </header>
  );
}
