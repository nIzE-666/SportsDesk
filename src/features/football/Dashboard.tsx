import { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight,
  CalendarDays,
  CalendarPlus,
  ChevronRight,
  Clock3,
  Heart,
  RefreshCw,
  Star,
  Trophy,
} from 'lucide-react';
import TeamBadge from '../../components/TeamBadge';
import { ModeHero } from '../../components/ModeHero';
import { MatchRow } from '../../components/MatchRow';
import { LoadingBlock, ErrorBlock, EmptyBlock } from '../../components/StateViews';
import { useFavorites, matchInvolvesFavorite } from './FavoritesProvider';
import type { UseFootballResult } from './useFootballData';
import type { MatchSummary } from './types';
import { formatDateTime, getUserTimezone } from './storage';
import { useInterfaceDesign } from '../../lib/interfaceDesign';
import { FeaturedMatchCover, selectFeaturedMatch } from './FeaturedMatchCover';

export interface DashboardProps {
  data: UseFootballResult;
  onOpenMatch: (id: string) => void;
  onOpenTeam: (id: string, name?: string) => void;
  onSeeAllMatches: () => void;
}

/** Compact vertical feed row: fits the narrow right column at any width. */
function FeedRow({ m, onOpenMatch }: { m: MatchSummary; onOpenMatch: (id: string) => void }) {
  const timezone = getUserTimezone();
  return (
    <button
      className="recent-game"
      key={m.id}
      onClick={() => onOpenMatch(m.id)}
      title="Открыть разбор матча"
    >
      <small>{formatDateTime(m.time_utc, timezone)}</small>
      <span>
        <TeamBadge name={m.home_team.name} imageUrl={m.home_team.image_url} size={24} />
        <strong>{m.home_team.name}</strong>
        <b>{m.score_home ?? '—'}</b>
      </span>
      <span>
        <TeamBadge name={m.away_team.name} imageUrl={m.away_team.image_url} size={24} />
        <strong>{m.away_team.name}</strong>
        <b>{m.score_away ?? '—'}</b>
      </span>
    </button>
  );
}

export function Dashboard({ data, onOpenMatch, onOpenTeam, onSeeAllMatches }: DashboardProps) {
  const broadcast = useInterfaceDesign() === 'broadcast';
  const { teamIds, favoriteTeamNames, seedFromCatalogue, toggleTeam } = useFavorites();
  useEffect(() => seedFromCatalogue(data.teams), [data.teams, seedFromCatalogue]);
  const league = data.leagues.find((l) => l.id === data.selectedLeagueId);
  const favoriteTeams = data.teams.filter((t) => teamIds.includes(t.id));

  // Расписание ВЫБРАННОЙ лиги/сезона — главный левый столбец обзора.
  const leagueUpcoming = useMemo(
    () =>
      data.matches
        .filter(
          (m) =>
            m.status !== 'finished' &&
            new Date(m.time_utc ?? m.date ?? '').getTime() > Date.now() - 7200000,
        )
        .sort((a, b) => (a.time_utc ?? '').localeCompare(b.time_utc ?? '')),
    [data.matches],
  );
  const leagueResults = useMemo(
    () =>
      data.matches
        .filter((m) => m.status === 'finished')
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
      upcoming: selected
        .filter(
          (m) =>
            m.status !== 'finished' &&
            new Date(m.time_utc ?? m.date ?? '').getTime() > Date.now() - 7200000,
        )
        .sort((a, b) => (a.time_utc ?? '').localeCompare(b.time_utc ?? '')),
      results: selected
        .filter((m) => m.status === 'finished')
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
      const upcomingAll = favUpcoming.length > 0 ? favUpcoming : leagueUpcoming;
      if (upcomingAll.length === 0) {
        setCalMessage('Нет будущих матчей для экспорта.');
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
        const { rpc } = await import('../../lib/bridge');
        await rpc('export_calendar', {
          matches: upcomingAll.map((m) => ({
            id: m.id,
            home: m.home_team.name,
            away: m.away_team.name,
            time: m.time_utc ?? m.date ?? '',
          })),
          path,
          reminderMinutes: 15,
        });
      } else {
        // Браузерный dev: скачиваем файл напрямую.
        path = 'sportsdesk-matches.ics';
        const lines = [
          'BEGIN:VCALENDAR',
          'VERSION:2.0',
          'PRODID:-//SportsDesk//Personal Sports Hub//RU',
          'CALSCALE:GREGORIAN',
        ];
        for (const m of upcomingAll) {
          const t = (m.time_utc ?? m.date ?? '').replace(' ', 'T');
          if (!t) {
            continue;
          }
          lines.push(
            'BEGIN:VEVENT',
            `UID:${m.id}@sportsdesk.local`,
            `DTSTAMP:${t}`,
            `DTSTART:${t}`,
            `SUMMARY:${m.home_team.name} — ${m.away_team.name}`,
            `BEGIN:VALARM`,
            `TRIGGER:-PT15M`,
            'ACTION:DISPLAY',
            'DESCRIPTION:Матч скоро начнётся',
            'END:VALARM',
            'END:VEVENT',
          );
        }
        lines.push('END:VCALENDAR');
        const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = path;
        a.click();
        URL.revokeObjectURL(url);
      }
      setCalMessage(`Сохранено: ${path} (${upcomingAll.length} матчей, напоминание за 15 мин).`);
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
            {next ? formatDateTime(next.time_utc, getUserTimezone()) : 'Нет ближайшего матча'}
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

  return (
    <div className="football-dashboard">
      <div className="section-heading">
        <div>
          {!broadcast && <span className="eyebrow">ВАШ ЛИЧНЫЙ СПОРТИВНЫЙ ЦЕНТР</span>}
          {broadcast ? (
            <h1>Ваш спорт сегодня</h1>
          ) : (
            <h2>
              Мой обзор<span className="heading-dot">.</span>
            </h2>
          )}
        </div>
        <button className="ghost-btn" onClick={data.reload} disabled={data.matchesLoading}>
          <RefreshCw size={14} /> Обновить
        </button>
      </div>
      {broadcast ? (
        <FeaturedMatchCover
          match={featured}
          league={league?.name ?? 'Футбол'}
          season={data.season}
          loading={data.matchesLoading}
          onOpenMatch={onOpenMatch}
          onSeeAllMatches={onSeeAllMatches}
        />
      ) : (
        <ModeHero
          eyebrow={`${league?.name ?? 'ФУТБОЛ'} / ${data.season ?? ''}`}
          title={
            <>
              В центре
              <br />
              <em>вашей игры.</em>
            </>
          }
          description="Расписание выбранной лиги — слева. Матчи команд, за которыми вы следите, — в отдельной колонке. Всё в одном месте."
        >
          <button className="primary-btn" onClick={onSeeAllMatches}>
            Перейти к матчам <ArrowUpRight size={16} />
          </button>
          <span className="hero-small-label">
            <i className="status-dot" />
            Ваш сезон начинается здесь
          </span>
        </ModeHero>
      )}
      {broadcast ? (
        <>
          {noticesBlock}
          {editorialBlock}
          {favoriteClubsBlock}
          {insightsBlock}
          {calendarExportBlock}
        </>
      ) : (
        <>
          {insightsBlock}
          {calendarExportBlock}
          {favoriteClubsBlock}
          {noticesBlock}
          {editorialBlock}
        </>
      )}
      <div className="source-foot">
        Матчи и подробная статистика: PitchAPI
        {data.fetchedAt ? ` · Обновлено ${formatDateTime(data.fetchedAt, getUserTimezone())}` : ''}
        {data.stale ? ' · Сохранённые данные' : ''}
      </div>
    </div>
  );
}
