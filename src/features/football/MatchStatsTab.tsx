import { EmptyBlock } from '../../components/StateViews';
import TeamBadge from '../../components/TeamBadge';
import { useViewState } from '../../lib/useViewState';
import { useInterfaceDesign } from '../../lib/interfaceDesign';
import { formatTeamStat, statGroupLabel, statLabel, statsPeriodLabel } from './statLabels';
import type { MatchDetail, StatGroup, StatsPayload } from './types';

export function MatchStatsTab({
  payload,
  error,
  detail,
}: {
  payload: StatsPayload | null;
  error?: string;
  detail: MatchDetail;
}) {
  const [selectedPeriod, setSelectedPeriod] = useViewState(`match.${detail.id}.period`, 'All');
  const broadcast = useInterfaceDesign() === 'broadcast';
  if (error) return <EmptyBlock title="Статистика недоступна" message={error} />;
  if (!payload || !Array.isArray(payload.periods) || payload.periods.length === 0) {
    const upcoming = ['not_started', 'scheduled', 'upcoming'].includes(detail.status.toLowerCase());
    return (
      <EmptyBlock
        title={upcoming ? 'Матч ещё не начался' : 'Статистика не загружена'}
        message={
          upcoming
            ? 'Показатели появятся после начала матча.'
            : 'Источник не передал статистику матча.'
        }
      />
    );
  }
  const period = payload.periods.find((p) => p.period === selectedPeriod) ?? payload.periods[0];
  const periodOrder = [
    'All',
    'FirstHalf',
    'SecondHalf',
    'FirstExtraHalf',
    'ExtraFirstHalf',
    'SecondExtraHalf',
    'ExtraSecondHalf',
    'ExtraTime',
    'PenaltyShootout',
  ];
  const periods = payload.periods
    .slice()
    .sort((a, b) => periodOrder.indexOf(a.period) - periodOrder.indexOf(b.period));
  const home = detail.home_team,
    away = detail.away_team;
  const groups = broadcast
    ? [...(period?.groups ?? [])].sort((a, b) => {
        const priority = (g: StatGroup) => {
          const label = statGroupLabel(g.group_name);
          return [
            'Основные показатели',
            'Ожидаемые голы (xG)',
            'Удары',
            'Передачи',
            'Атака',
            'Оборона',
            'Единоборства',
            'Дисциплина',
          ].indexOf(label);
        };
        const x = priority(a),
          y = priority(b);
        return (x < 0 ? 99 : x) - (y < 0 ? 99 : y);
      })
    : (period?.groups ?? []);
  return (
    <section
      className="match-statistics panel"
      aria-label={`Сравнение статистики: ${home.name} и ${away.name}`}
    >
      <div className="stats-context">
        <div className="stats-period-nav" role="tablist" aria-label="Период статистики">
          {periods.map((p) => (
            <button
              key={p.period}
              role="tab"
              aria-selected={p.period === period?.period}
              onClick={() => setSelectedPeriod(p.period)}
            >
              {statsPeriodLabel(p.period)}
            </button>
          ))}
        </div>
        <div className="stats-column-head stat-grid">
          <div className="stats-team stats-home-team">
            <TeamBadge name={home.name} imageUrl={home.image_url} size={34} />
            <span>
              <small>СЛЕВА · ХОЗЯЕВА</small>
              <strong>{home.name}</strong>
            </span>
          </div>
          <div className="stats-center-heading">
            <strong>Показатели команд</strong>
            <span>{statsPeriodLabel(period?.period ?? 'All')}</span>
          </div>
          <div className="stats-team stats-away-team">
            <span>
              <small>СПРАВА · ГОСТИ</small>
              <strong>{away.name}</strong>
            </span>
            <TeamBadge name={away.name} imageUrl={away.image_url} size={34} />
          </div>
        </div>
      </div>
      <div className="stats-groups">
        {groups.map((g) => (
          <StatGroupBlock key={g.group_name} group={g} homeName={home.name} awayName={away.name} />
        ))}
      </div>
    </section>
  );
}

function StatGroupBlock({
  group,
  homeName,
  awayName,
}: {
  group: StatGroup;
  homeName: string;
  awayName: string;
}) {
  return (
    <div className="stat-group">
      <h3>{statGroupLabel(group.group_name)}</h3>
      {group.items.map((item) => {
        const label = statLabel(item.key, item.title);
        return (
          <div
            key={item.key}
            className="match-stat-row stat-grid"
            aria-label={`${label}: ${homeName} ${item.home || 'нет данных'}, ${awayName} ${item.away || 'нет данных'}`}
          >
            <span className="stat-value stat-home" title={homeName}>
              {formatTeamStat(item.home, item.format_type)}
            </span>
            <span className="stat-label">{label}</span>
            <span className="stat-value stat-away" title={awayName}>
              {formatTeamStat(item.away, item.format_type)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
