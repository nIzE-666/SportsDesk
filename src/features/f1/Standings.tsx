import { ChevronDown, Star } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useViewState } from '../../lib/useViewState';
import { useApiResource } from './api';
import { parseConstructorStandings, parseDriverStandings } from './parsing';
import { useSeason } from './SeasonContext';
import { DriverName, SourceBar, State, TeamDot } from './shared';
import { teamColor } from './teamColors';
import type { JolpicaConstructorStanding, JolpicaDriverStanding } from './types';
import { useFavoriteDrivers, useFavoriteTeams } from './useFavorites';

function FavoriteToggle({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        padding: 4,
        color: active ? 'var(--accent,#ff3b3b)' : 'var(--muted,#8b9099)',
        lineHeight: 0,
      }}
    >
      <Star size={16} fill={active ? 'currentColor' : 'none'} />
    </button>
  );
}

function DriverRow({ s }: { s: JolpicaDriverStanding }) {
  const [open, setOpen] = useState(false);
  const [favs, toggleFav] = useFavoriteDrivers();
  const fav = favs.includes(s.Driver.driverId);
  return (
    <>
      <tr className={`f1-clickable${fav ? ' is-fav' : ''}`} onClick={() => setOpen((v) => !v)}>
        <td style={{ width: 34 }}>{open ? <ChevronDown size={14} /> : null}</td>
        <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 16 }}>{s.position ?? '—'}</td>
        <td>
          <DriverName givenName={s.Driver.givenName} familyName={s.Driver.familyName} />
        </td>
        <td>
          {(s.Constructors ?? []).map((c) => (
            <span
              key={c.constructorId}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginRight: 10 }}
            >
              <TeamDot color={teamColor(c.constructorId)} />
              {c.name}
            </span>
          ))}
          {(s.Constructors ?? []).length === 0 ? <span className="f1-muted">—</span> : null}
        </td>
        <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{s.points ?? '—'}</td>
        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.wins ?? '—'}</td>
        <td style={{ width: 34 }}>
          <FavoriteToggle
            active={fav}
            onClick={() => toggleFav(s.Driver.driverId)}
            label={fav ? 'Убрать из избранных' : 'В избранные'}
          />
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={7} style={{ padding: 0 }}>
            <div className="f1-expand" style={{ padding: 12, fontSize: 12.5 }}>
              <div className="f1-kv">
                <span>
                  Код: <b>{s.Driver.code ?? '—'}</b>
                </span>
                <span>
                  Номер: <b>{s.Driver.permanentNumber ?? '—'}</b>
                </span>
                <span>
                  Национальность: <b>{s.Driver.nationality ?? '—'}</b>
                </span>
                <span>
                  Дата рождения: <b>{s.Driver.dateOfBirth ?? '—'}</b>
                </span>
              </div>
              {(s.Constructors ?? []).length > 1 ? (
                <div className="f1-muted" style={{ marginTop: 6 }}>
                  Несколько команд за сезон (возможен переход); актуальная — по последнему этапу.
                </div>
              ) : null}
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ConstructorRow({ s }: { s: JolpicaConstructorStanding }) {
  const [open, setOpen] = useState(false);
  const [favs, toggleFav] = useFavoriteTeams();
  const fav = favs.includes(s.Constructor.constructorId);
  return (
    <>
      <tr className={`f1-clickable${fav ? ' is-fav' : ''}`} onClick={() => setOpen((v) => !v)}>
        <td style={{ width: 34 }}>{open ? <ChevronDown size={14} /> : null}</td>
        <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 16 }}>{s.position ?? '—'}</td>
        <td>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <TeamDot color={teamColor(s.Constructor.constructorId)} />
            <b style={{ fontWeight: 600 }}>{s.Constructor.name}</b>
          </span>
        </td>
        <td style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{s.points ?? '—'}</td>
        <td style={{ fontVariantNumeric: 'tabular-nums' }}>{s.wins ?? '—'}</td>
        <td>
          <FavoriteToggle
            active={fav}
            onClick={() => toggleFav(s.Constructor.constructorId)}
            label={fav ? 'Убрать из избранных' : 'В избранные'}
          />
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} style={{ padding: 0 }}>
            <div className="f1-expand" style={{ padding: 12, fontSize: 12.5 }}>
              <div className="f1-kv">
                <span>
                  Национальность: <b>{s.Constructor.nationality ?? '—'}</b>
                </span>
                <span className="f1-muted">ID: {s.Constructor.constructorId}</span>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function Standings() {
  const { year } = useSeason();
  const [tab, setTab] = useViewState<'drivers' | 'constructors'>(
    `f1.${year}.standings.tab`,
    'drivers',
    (v) => v === 'drivers' || v === 'constructors',
  );
  const d = useApiResource(
    `${year}-standings-d`,
    `${year}/driverStandings.json`,
    parseDriverStandings,
  );
  const c = useApiResource(
    `${year}-standings-c`,
    `${year}/constructorStandings.json`,
    parseConstructorStandings,
  );
  const [favDrivers] = useFavoriteDrivers();
  const [favTeams] = useFavoriteTeams();

  const drivers = d.data?.standings ?? [];
  const teams = c.data?.standings ?? [];

  const sortedDrivers = useMemo(
    () =>
      [...drivers].sort((a, b) => {
        const fa = favDrivers.includes(a.Driver.driverId) ? 0 : 1;
        const fb = favDrivers.includes(b.Driver.driverId) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return Number(a.position ?? 999) - Number(b.position ?? 999);
      }),
    [drivers, favDrivers],
  );

  const sortedTeams = useMemo(
    () =>
      [...teams].sort((a, b) => {
        const fa = favTeams.includes(a.Constructor.constructorId) ? 0 : 1;
        const fb = favTeams.includes(b.Constructor.constructorId) ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return Number(a.position ?? 999) - Number(b.position ?? 999);
      }),
    [teams, favTeams],
  );

  const active = tab === 'drivers' ? d : c;
  const rows = tab === 'drivers' ? sortedDrivers : sortedTeams;

  return (
    <div className="f1-card">
      <div className="f1-toolbar">
        <div className="f1-tabs" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'drivers'}
            className="f1-tab"
            onClick={() => setTab('drivers')}
          >
            Пилоты
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'constructors'}
            className="f1-tab"
            onClick={() => setTab('constructors')}
          >
            Команды
          </button>
        </div>
        <span className="sep" />
        {d.data?.round ? <span className="f1-muted">После раунда {d.data.round}</span> : null}
      </div>
      {active.loading && !active.data ? <State kind="loading" title="Загрузка таблицы…" /> : null}
      {active.error && !active.data ? (
        <State kind="error" title="Таблица недоступна">
          {active.error}
        </State>
      ) : null}
      {active.data && rows.length === 0 ? (
        <State kind="empty" title="Нет данных для этого сезона" />
      ) : null}
      {rows.length > 0 ? (
        <div className="f1-scroll">
          {tab === 'drivers' ? (
            <table className="f1-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Поз.</th>
                  <th>Пилот</th>
                  <th>Команда(ы) в сезоне</th>
                  <th>Очки</th>
                  <th>Победы</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedDrivers.map((s) => (
                  <DriverRow key={s.Driver.driverId} s={s} />
                ))}
              </tbody>
            </table>
          ) : (
            <table className="f1-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Поз.</th>
                  <th>Команда</th>
                  <th>Очки</th>
                  <th>Победы</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sortedTeams.map((s) => (
                  <ConstructorRow key={s.Constructor.constructorId} s={s} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
      <SourceBar
        source={active.source}
        fetchedAt={active.fetchedAt}
        stale={active.stale}
        onRefresh={active.reload}
        refreshing={active.loading}
      />
    </div>
  );
}
