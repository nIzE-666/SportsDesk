import { viewState } from '../../lib/viewState';
import { PageFrame } from '../../components/PageFrame';
import { Calendar } from './Calendar';
import './f1.css';
import { DriverPortraitsProvider } from './DriverPortraits';
import { f1TabFor, type TabId } from './f1Tabs';
import { F1Analysis } from './F1Analysis';
import { Overview } from './Overview';
import { SeasonProvider, useSeason } from './SeasonContext';
import { Standings } from './Standings';
import { SourceRefresh, SourceSummary, SourceSummaryProvider } from './SourceSummary';

export type { TabId } from './f1Tabs';

function F1Shell({ tab, onTabChange }: { tab: TabId; onTabChange: (tab: TabId) => void }) {
  const setTab = (next: TabId) => onTabChange(next);
  const { year, setYear, years } = useSeason();
  const activeTab = f1TabFor(tab);

  return (
    <PageFrame page={`f1.${year}.${activeTab.id}`}>
      <div className="f1-root">
        <div className="f1-toolbar">
          <div className="broadcast-f1-heading">
            <h1>{tab === 'overview' ? 'Ваш гоночный уикенд' : activeTab.label}</h1>
          </div>
          <label className="f1-muted f1-season">
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
          <SourceRefresh />
        </div>

        {tab === 'overview' ? (
          <Overview
            onOpenCalendar={(round) => {
              viewState.write(`f1.${year}.calendar.round`, Number(round));
              viewState.write(`f1.${year}.calendar.filter`, 'all');
              setTab('calendar');
            }}
          />
        ) : null}
        {tab === 'calendar' ? <Calendar /> : null}
        {tab === 'standings' ? <Standings /> : null}
        {tab === 'compare' || tab === 'pace' || tab === 'session' ? (
          <F1Analysis mode={tab} onModeChange={setTab} />
        ) : null}

        <SourceSummary />
      </div>
    </PageFrame>
  );
}

export function F1View(props: { tab: TabId; onTabChange: (tab: TabId) => void }) {
  return (
    <SeasonProvider>
      <DriverPortraitsProvider>
        <SourceSummaryProvider>
          <F1Shell {...props} />
        </SourceSummaryProvider>
      </DriverPortraitsProvider>
    </SeasonProvider>
  );
}

export default F1View;
