import { CalendarDays } from 'lucide-react';
import { f1Nav as TABS } from '../../lib/navigationMetadata';
import { useState } from 'react';
import { ModeHero } from '../../components/ModeHero';
import { PageFrame } from '../../components/PageFrame';
import { Calendar } from './Calendar';
import { Compare } from './Compare';
import './f1.css';
import { DriverPortraitsProvider } from './DriverPortraits';
import { Overview } from './Overview';
import { SeasonProvider, useSeason } from './SeasonContext';
import { Session } from './Session';
import { Standings } from './Standings';

export type TabId = 'overview' | 'calendar' | 'standings' | 'compare' | 'pace' | 'session';

function F1Shell({
  tab: controlled,
  onTabChange,
}: {
  tab?: TabId;
  onTabChange?: (tab: TabId) => void;
}) {
  const [localTab, setLocalTab] = useState<TabId>('overview');
  const tab = controlled ?? localTab;
  const setTab = (next: TabId) => {
    setLocalTab(next);
    onTabChange?.(next);
  };
  const { year, setYear, years } = useSeason();

  return (
    <PageFrame page={`f1.${year}.${tab}`}>
      <div className="f1-root">
        {tab === 'overview' && (
          <ModeHero
            mode="f1"
            eyebrow={`FORMULA 1 / СЕЗОН ${year}`}
            title={
              <>
                На пределе.
                <br />
                <em>В каждом секторе.</em>
              </>
            }
            description="От первого круга до клетчатого флага. Всё, ради чего вы смотрите гонки."
          >
            <button className="primary-btn" onClick={() => setTab('calendar')}>
              Календарь гонок <CalendarDays size={15} />
            </button>
            <button className="hero-secondary" onClick={() => setTab('session')}>
              Открыть центр сессии
            </button>
          </ModeHero>
        )}
        <div className="f1-toolbar">
          <div
            className="f1-tabs"
            style={{ flex: '1 1 auto', borderBottom: 'none', paddingBottom: 0 }}
            role="tablist"
            aria-label="Разделы Формулы-1"
          >
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="f1-tab"
                  onClick={() => setTab(t.id)}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  <Icon size={14} aria-hidden="true" />
                  {t.label}
                </button>
              );
            })}
          </div>
          <label className="f1-muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Сезон
            <select
              className="f1-select"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              aria-label="Сезон Формулы-1"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
        </div>

        {tab === 'overview' ? <Overview /> : null}
        {tab === 'calendar' ? <Calendar /> : null}
        {tab === 'standings' ? <Standings /> : null}
        {tab === 'compare' ? <Compare /> : null}
        {tab === 'pace' ? <Session mode="pace" /> : null}
        {tab === 'session' ? <Session /> : null}

        <div className="f1-muted" style={{ fontSize: 11, marginTop: 4 }}>
          Данные Jolpica (Ergast-compatible) и OpenF1. Исторические сессии OpenF1 с 2023 года; живая
          телеметрия в бесплатном доступе недоступна.
        </div>
      </div>
    </PageFrame>
  );
}

export function F1View(props: { tab?: TabId; onTabChange?: (tab: TabId) => void } = {}) {
  return (
    <SeasonProvider>
      <DriverPortraitsProvider>
        <F1Shell {...props} />
      </DriverPortraitsProvider>
    </SeasonProvider>
  );
}

export default F1View;
