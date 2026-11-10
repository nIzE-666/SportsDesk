import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  Clock3,
  Heart,
  LayoutGrid,
  RefreshCw,
  Star,
  Trophy,
} from 'lucide-react';
import TeamBadge from '../../components/TeamBadge';
import { MatchRow } from '../../components/MatchRow';
import { LoadingBlock, ErrorBlock, EmptyBlock } from '../../components/StateViews';
import { SourceLine } from '../../components/SourceLine';
import { useFavorites, matchInvolvesFavorite } from './FavoritesProvider';
import type { UseFootballResult } from './useFootballData';
import type { MatchSummary } from './types';
import { getUserTimezone } from './storage';
import { useInterfaceDesign } from '../../lib/interfaceDesign';
import { rpc } from '../../lib/bridge';
import { FeaturedMatchCover, selectFeaturedMatch } from './FeaturedMatchCover';
import { useHomeLayout, type HomeWidgetId } from './homeLayout';
import { HomeLayoutEditor } from './HomeLayoutEditor';
import { classifyMatchStatus } from '../../lib/sportsIdentity';
import { useResultHidden } from '../spoilers/spoilerStore';
import {
  buildCalendar,
  compareUpcoming,
  formatFixtureTime,
  isUpcomingFixture,
  selectCalendarMatches,
} from './calendar';

export interface DashboardProps {
  data: UseFootballResult;
  onOpenMatch: (id: string) => void;
  onOpenTeam: (id: string, name?: string) => void;
  onSeeAllMatches: () => void;
}

/** Compact vertical feed row: fits the narrow right column at any width. */
function FeedRow({ m, onOpenMatch }: { m: MatchSummary; onOpenMatch: (id: string) => void }) {
  const timezone = getUserTimezone();
  const spoilerHidden = useResultHidden('football', m.id);
  return (
    <button
      className="recent-game"
      key={m.id}
      onClick={() => onOpenMatch(m.id)}
      title="Открыть разбор матча"
    >
      <small>{formatFixtureTime(m, timezone)}</small>
      <span>
        <TeamBadge name={m.home_team.name} imageUrl={m.home_team.image_url} size={24} />
        <strong>{m.home_team.name}</strong>
        <b>{spoilerHidden ? '?' : (m.score_home ?? '—')}</b>
      </span>
      <span>
        <TeamBadge name={m.away_team.name} imageUrl={m.away_team.image_url} size={24} />
        <strong>{m.away_team.name}</strong>
        <b>{spoilerHidden ? '?' : (m.score_away ?? '—')}</b>
      </span>
    </button>
  );
}

export function Dashboard({ data, onOpenMatch, onOpenTeam, onSeeAllMatches }: DashboardProps) {
  const broadcast = useInterfaceDesign() === 'broadcast';
  const { teamIds, favoriteTeamNames, seedFromCatalogue, toggleTeam } = useFavorites();
  useEffect(() => seedFromCatalogue(data.teams), [data.teams, seedFromCatalogue]);
  const homeDesign = broadcast ? 'broadcast' : 'classic';
  const homeLayout = useHomeLayout(homeDesign);
  const [editingLayout, setEditingLayout] = useState(false);
  const league = data.leagues.find((l) => l.id === data.selectedLeagueId);
  const favoriteTeams = data.teams.filter((t) => teamIds.includes(t.id));

  // Расписание ВЫБРАННОЙ лиги/сезона — главный левый столбец обзора.
  const leagueUpcoming = useMemo(
    () => data.matches.filter((m) => isUpcomingFixture(m)).sort(compareUpcoming),
    [data.matches],
  );
  const leagueResults = useMemo(
    () =>
      data.matches
        .filter((m) => classifyMatchStatus(m.status) === 'finished')
        .sort((a, b) => (b.time_utc ?? '').localeCompare(a.time_utc ?? '')),
    [data.matches],
  );

  // Матчи команд, за которыми следит пользователь, по всем загруженным лигам — отдельный правый столбец.
  const favFeed = useMemo(() => {
    const selected = data.allMatches.filter(
      (m) =>
        teamIds.includes(m.home_team.id) ||
        teamIds.includes(m.away_team.id) ||
        matchInvolvesFavorite(m.home_team.name, m.away_team.name, favoriteTeamNames),
    );
    return {
      upcoming: selected.filter((m) => isUpcomingFixture(m)).sort(compareUpcoming),
      results: selected
        .filter((m) => classifyMatchStatus(m.status) === 'finished')
        .sort((a, b) => (b.time_utc ?? '').localeCompare(a.time_utc ?? '')),
    } as const;
  }, [data.allMatches, teamIds, favoriteTeamNames]);
  const favUpcoming: MatchSummary[] = favFeed.upcoming;
  const favResults: MatchSummary[] = favFeed.results;

  const next = favUpcoming[0];
  const favTotal = favUpcoming.length + favResults.length;
  const featured = selectFeaturedMatch(
    data.matches,
    (m) =>
      teamIds.includes(m.home_team.id) ||
      teamIds.includes(m.away_team.id) ||
      matchInvolvesFavorite(m.home_team.name, m.away_team.name, favoriteTeamNames),
  );
  const resultsBlock = leagueResults.length > 0 && (
    <>
      <div className={broadcast ? 'section-title' : 'section-title dashboard-sub'}>
        <h2>
          <Trophy size={15} /> {broadcast ? 'Последние матчи' : 'Финальный свисток'}
        </h2>
        <span className="muted small">{league?.name}</span>
      </div>
      <div className="recent-games">
        {leagueResults.slice(0, 4).map((m) => (
          <FeedRow key={m.id} m={m} onOpenMatch={onOpenMatch} />
        ))}
      </div>
    </>
  );

  // Экспорт в календарь: будущие матчи отслеживаемых команд -> .ics с VALARM.
  const [calBusy, setCalBusy] = useState(false);
  const [calMessage, setCalMessage] = useState<string | null>(null);
  const exportToCalendar = async () => {
    setCalBusy(true);
    setCalMessage(null);
    try {
      const { events, skipped, fallback, skippedFavorites } = selectCalendarMatches(
        favUpcoming,
        leagueUpcoming,
      );
      if (!events.length) {
        setCalMessage(
          skipped
            ? `Нет матчей с известной датой для экспорта (пропущено: ${skipped}).`
            : 'Нет будущих матчей для экспорта.',
        );
        return;
      }
      const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
      let path: string;
      if (isTauri) {
        const dlg = await import('@tauri-apps/plugin-dialog');
        const chosen = await dlg.save({
          title: 'Сохранить календарь матчей',
          defaultPath: 'sportsdesk-matches.ics',
          filters: [{ name: 'Календарь iCal', extensions: ['ics'] }],
        });
        if (!chosen) {
          return;
        }
        path = chosen;
        await rpc('export_calendar', {
          matches: events,
          path,
          reminderMinutes: 15,
        });
      } else {
        // Браузерный dev: скачиваем файл напрямую.
        path = 'sportsdesk-matches.ics';
        const blob = new Blob([buildCalendar(events)], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = path;
        a.click();
        URL.revokeObjectURL(url);
      }
      const allDay = events.filter((event) => event.time.length === 10).length;
      const notes = [
        `${events.length} матчей`,
        ...(fallback ? ['матчи выбранной лиги'] : []),
        ...(skippedFavorites ? [`избранных без даты: ${skippedFavorites}`] : []),
        ...(events.length > allDay
          ? ['напоминание за 15 мин для матчей с известным временем']
          : []),
        ...(allDay ? [`без времени: ${allDay}, событие на весь день`] : []),
        ...(skipped ? [`без даты, пропущено: ${skipped}`] : []),
      ];
      setCalMessage(`Сохранено: ${path} (${notes.join('; ')}).`);
    } catch (e) {
      setCalMessage(e instanceof Error ? e.message : 'Экспорт не удался.');
    } finally {
      setCalBusy(false);
    }
  };

  const insightsBlock = (
    <div className="insights-row">
      <div>
        <Heart size={18} />
        <span>
          <strong>{favoriteTeamNames.length || '—'}</strong>
          <small>клубов под присмотром</small>
        </span>
      </div>
      <div>
        <CalendarDays size={18} />
        <span>
          <strong>{leagueUpcoming.length}</strong>
          <small>матчей {league?.name ?? 'лиги'} впереди</small>
        </span>
      </div>
      <div className="next-insight">
        <Clock3 size={18} />
        <span>
          <strong>
            {next ? formatFixtureTime(next, getUserTimezone()) : 'Нет ближайшего матча'}
          </strong>
          <small>
            {next ? `${next.home_team.name} — ${next.away_team.name}` : 'Среди ваших клубов'}
          </small>
        </span>
      </div>
    </div>
  );

  const calendarExportBlock = (
    <div className="calendar-export-bar">
      <button className="ghost-btn" onClick={() => void exportToCalendar()} disabled={calBusy}>
        <CalendarPlus size={14} /> {calBusy ? 'Сохраняем…' : 'Матчи в календарь (.ics)'}
      </button>
      <span className="muted small">
        {calMessage ?? 'Будущие матчи отслеживаемых команд — с системным напоминанием за 15 минут.'}
      </span>
    </div>
  );

  const favoriteClubsBlock = (
    <section className="favorite-section">
      <div className="section-title">
        <h2>
          <Heart size={16} /> Ваши клубы
        </h2>
        <span className="muted small">Звёздочка убирает из списка</span>
      </div>
      <div className="club-rail">
        {favoriteTeams.map((t) => (
          <div className="club-tile-wrap" key={t.id}>
            <button
              className="club-tile"
              onClick={() => onOpenTeam(t.id, t.name)}
              title={`Открыть ${t.name}`}
            >
              <span className="club-logo">
                <TeamBadge name={t.name} imageUrl={t.image_url} size={33} />
              </span>
              <strong>{t.name}</strong>
              <small>{t.leagueName}</small>
            </button>
            <button
              className="club-star"
              onClick={() => toggleTeam(t.id)}
              aria-label={`Убрать ${t.name} из отслеживаемых`}
              title="Убрать из отслеживаемых"
            >
              <Star size={12} fill="currentColor" />
            </button>
          </div>
        ))}
      </div>
      {!favoriteTeams.length && !data.matchesLoading && (
        <p className="muted small">
          Добавьте команды звёздочкой в разделе «Матчи» — они появятся здесь и в колонке справа.
        </p>
      )}
    </section>
  );

  const noticesBlock = (
    <>
      {data.matchesLoading && data.matches.length === 0 && data.allMatches.length === 0 && (
        <LoadingBlock label="Собираем ваш спортивный день…" rows={4} />
      )}
      {data.matchesError && (
        <ErrorBlock
          title="Расписание временно недоступно"
          message={data.matchesError}
          onRetry={data.reload}
        />
      )}
    </>
  );

  const editorialBlock = (
    <div className="editorial-grid">
      <section className="panel schedule-card">
        {broadcast && resultsBlock}
        <div
          className={
            broadcast && leagueResults.length ? 'section-title dashboard-sub' : 'section-title'
          }
        >
          <h2>
            <CalendarDays size={17} />{' '}
            {broadcast ? 'Дальше по расписанию' : `${league?.name ?? 'Лига'} · расписание`}
          </h2>
          <button className="text-link" onClick={onSeeAllMatches}>
            Все матчи <ChevronRight size={14} />
          </button>
        </div>
        <div className="game-list">
          {leagueUpcoming.slice(0, broadcast ? 4 : 7).map((m) => (
            <MatchRow key={m.id} match={m} onClick={() => onOpenMatch(m.id)} />
          ))}
        </div>
        {data.matches.length > 0 && !leagueUpcoming.length && !data.matchesLoading && (
          <EmptyBlock
            title="Следим за расписанием"
            message={`Будущие матчи ${league?.name ?? 'лиги'} в сезоне ${data.season ?? ''} пока не опубликованы.`}
          />
        )}
        {!broadcast && resultsBlock}
      </section>
      <section className="panel recent-card">
        <div className="section-title">
          <h2>
            <Heart size={17} /> За кем вы следите
          </h2>
          <span className="muted small">{favTotal ? `${favTotal} матчей` : ''}</span>
        </div>
        <div className="recent-games">
          {favUpcoming.slice(0, 4).map((m) => (
            <FeedRow key={m.id} m={m} onOpenMatch={onOpenMatch} />
          ))}
          {favResults.slice(0, 3).map((m) => (
            <FeedRow key={m.id} m={m} onOpenMatch={onOpenMatch} />
          ))}
        </div>
        {data.allMatches.length > 0 && !favTotal && !data.matchesLoading && (
          <EmptyBlock
            title="Пока никого под присмотром"
            message="Отметьте команды звёздочкой в разделе «Матчи» — их расписание и результаты появятся в этой колонке."
          />
        )}
      </section>
    </div>
  );

  const homeBlocks: Record<HomeWidgetId, ReactNode> = {
    insights: insightsBlock,
    calendar: calendarExportBlock,
    clubs: favoriteClubsBlock,
    editorial: editorialBlock,
  };
  const visibleWidgets = homeLayout.order.filter((id) => !homeLayout.hidden.includes(id));

  return (
    <div className="football-dashboard">
      <div className="section-heading">
        <div>
          <h1>{broadcast ? 'Ваш спорт сегодня' : 'Мой обзор'}</h1>
        </div>
        <div className="home-heading-actions">
          <button
            className="ghost-btn"
            onClick={() => setEditingLayout((v) => !v)}
            aria-expanded={editingLayout}
          >
            <LayoutGrid size={14} /> Настроить главную
          </button>
          <button className="ghost-btn" onClick={data.reload} disabled={data.matchesLoading}>
            <RefreshCw size={14} /> Обновить
          </button>
        </div>
      </div>
      {editingLayout && (
        <HomeLayoutEditor design={homeDesign} onClose={() => setEditingLayout(false)} />
      )}
      {broadcast && (
        <FeaturedMatchCover
          match={featured}
          league={league?.name ?? 'Футбол'}
          season={data.season}
          loading={data.matchesLoading}
          onOpenMatch={onOpenMatch}
          onSeeAllMatches={onSeeAllMatches}
        />
      )}
      {noticesBlock}
      {visibleWidgets.map((id) => (
        <Fragment key={id}>{homeBlocks[id]}</Fragment>
      ))}
      {!visibleWidgets.length && (
        <EmptyBlock
          title="Все блоки главной скрыты"
          message="Нажмите «Настроить главную», чтобы вернуть нужные блоки."
        />
      )}
      <SourceLine sources={['pitch']} fetchedAt={data.fetchedAt} stale={data.stale} />
    </div>
  );
}
